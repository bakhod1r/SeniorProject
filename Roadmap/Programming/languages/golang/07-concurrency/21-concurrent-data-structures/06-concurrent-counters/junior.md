---
layout: default
title: Junior
parent: Concurrent Counters
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/06-concurrent-counters/junior/
---

# Concurrent Counters — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use--feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction
> Focus: "Why does `count++` from many goroutines give the wrong number? What is the simplest correct counter?"

You have probably written this Go program at least once in your life, or something just like it:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var count int
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            count++
        }()
    }
    wg.Wait()
    fmt.Println(count)
}
```

You expect `1000`. You get `987`, or `942`, or sometimes `1000`. Run it again — a different answer. Run it under `go run -race main.go` and the Go race detector prints a long, scary report.

This file is about why that program is broken, and the smallest amount of theory and code you need to fix it. By the end you will:

- Know what a **race condition** is, and why `count++` is the textbook example
- Use `sync.Mutex` to protect a counter (the safe, obvious solution)
- Know about `sync/atomic` and use `atomic.AddInt64` / `atomic.Int64` for a faster, simpler solution
- Understand the difference between **monotonic** counters (only go up) and **gauge** counters (go up and down)
- Recognise the `int` vs `int64` choice and why atomic operations require a fixed-width type
- Know the three ways an `int` increment can go wrong concurrently: lost updates, torn reads, and visibility delays
- Be able to write a simple `RequestCount` metric that survives 100 concurrent goroutines hammering it
- Know when to reach for a counter and when to reach for a richer primitive

You do not need to know about cache lines, false sharing, sharded counters, sloppy counters, HDR histograms, or `expvar` yet. Those come at the middle, senior, and professional levels. This file is about the moment you accept that "one number, many writers" needs help.

---

## Prerequisites

- **Required:** A Go installation, version 1.19 or newer. Versions before 1.19 do not have the new `atomic.Int64`/`atomic.Uint64` typed wrappers — only the older `atomic.AddInt64(&x, 1)` functions. Both work, but the newer API is friendlier.
- **Required:** Comfort writing a `main` function and using `go func()`. You should be able to run the broken example above by yourself.
- **Required:** Familiarity with `sync.WaitGroup`. You will use it in nearly every example here to make sure the program does not exit before all the increments finish.
- **Helpful:** Awareness that modern computers run instructions out of order, and that a value written by one CPU core may sit in a cache for some time before another core sees it. You do not need to understand cache coherence yet.
- **Helpful:** Some experience with `-race` (the Go race detector). If you have never run `go test -race`, try it once before continuing.

If `go run hello.go` works on your machine, and you can already write `var wg sync.WaitGroup; wg.Add(1); go func() { defer wg.Done() }(); wg.Wait()` from memory, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Counter** | A number that goes up (and sometimes down) to record how many times something has happened. The simplest concurrent primitive in the world, and one of the trickiest to make fast and correct. |
| **Monotonic counter** | A counter that only ever increases. Examples: request count, bytes received, errors, total bytes written to disk. Decreasing a monotonic counter is almost always a bug. |
| **Gauge** | A number that goes both up and down. Examples: in-flight requests, queue depth, open connections. Gauges need both increment and decrement; monotonic counters do not. |
| **Race condition** | When the result of a program depends on the relative timing of operations from multiple goroutines. The classic example is two goroutines doing `count++` and one of the increments being lost. |
| **Lost update** | The specific failure mode of `count++` under concurrency: two goroutines read the same old value, both add one, and both write back the same new value. One increment effectively vanishes. |
| **Torn read** | Reading a value while it is being written, getting half the old bytes and half the new bytes. On 64-bit CPUs reading a 64-bit aligned `int64` is normally atomic, but on 32-bit CPUs it is not — and the language spec does not guarantee atomicity for plain `int64` even on 64-bit. |
| **`sync.Mutex`** | A mutual exclusion lock. Wraps a critical section so only one goroutine at a time may execute it. Slow for short operations like `count++`, but always correct. |
| **`sync/atomic`** | A package of functions and types that perform single-word memory operations in a way the CPU guarantees to be atomic — no other thread can see a partial state. |
| **`atomic.Int64`** | A typed wrapper around an atomically-accessed `int64`, introduced in Go 1.19. Has `Load`, `Store`, `Add`, `CompareAndSwap`, `Swap` methods. The modern way to write a simple atomic counter. |
| **`atomic.AddInt64`** | The older package-level function that adds a delta to a `*int64`. Still works, still common in older code. Slightly easier to misuse because it takes a pointer to a plain `int64`. |
| **Critical section** | A region of code that must execute atomically with respect to other goroutines. With a mutex, the critical section is between `Lock()` and `Unlock()`. With an atomic, the critical section is a single machine instruction. |
| **Race detector** | The `-race` flag for `go run` and `go test`. Instruments memory accesses and reports any race it observes during the run. It does not catch *every* race, but it catches almost every real one if your test is even a little adversarial. |

---

## Core Concepts

### Why `count++` is not safe

`count++` looks atomic. In English it is a single verb: "increment". In machine code it is *three* operations:

1. **Read** the current value of `count` from memory into a CPU register
2. **Add** one to the register
3. **Write** the new value back to memory

In Go's runtime, even on a single CPU, the scheduler may pause a goroutine between any of these steps. On multiple CPUs, two goroutines may execute step 1 at the same instant, both reading the same old value. Both then add one to it. Both write the same new value back. The counter has gone up by one, not by two. One increment is *lost*.

Concretely, imagine `count` starts at 5 and two goroutines both run `count++`:

```
Goroutine A                Goroutine B
read count   -> 5
                           read count   -> 5
add 1        -> 6
                           add 1        -> 6
write 6 to count
                           write 6 to count
```

End result: `count == 6`, not `7`. The longer the program runs and the more goroutines you spawn, the more increments are silently dropped.

This is called a **lost update** or, more generally, a **read–modify–write race**.

### Three ways the wrong thing can happen

When multiple goroutines touch the same variable without synchronisation, three distinct problems can occur. All three apply to counters:

1. **Lost updates**: described above. Two writers step on each other's read-modify-write.
2. **Torn reads / writes**: a reader sees half the old bytes and half the new bytes. This is rare on a 64-bit CPU for a 64-bit aligned value but is *not* guaranteed by the Go memory model. On 32-bit ARM, writing an `int64` is two 32-bit stores and a concurrent reader can absolutely see a torn value.
3. **Stale visibility**: even after writer A has written, reader B may not see the new value for some unbounded amount of time, because the write sits in A's CPU cache. Without a memory barrier (which atomic operations provide), there is no guarantee about *when* B will see the update.

A correct concurrent counter must address all three.

### Solution 1: `sync.Mutex`

The simplest fix: wrap the increment in a mutex.

```go
type SafeCounter struct {
    mu    sync.Mutex
    count int64
}

func (c *SafeCounter) Inc() {
    c.mu.Lock()
    c.count++
    c.mu.Unlock()
}

func (c *SafeCounter) Get() int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.count
}
```

This is correct under any concurrency, on any architecture. It is also slow for such a small operation — a mutex involves at least one atomic instruction itself, plus the bookkeeping of holding and releasing the lock, plus potential goroutine sleeps if the lock is contended.

For a counter that is hit a million times a second from 64 goroutines, a mutex is the wrong choice. But it is always a correct first step. Make it work, then make it fast.

### Solution 2: `sync/atomic`

The standard library gives us a much faster primitive: atomic operations. On any modern CPU, an atomic add on a 64-bit aligned address is a single hardware instruction (`LOCK XADD` on x86, `LDADD` on ARMv8.1, or a load-linked / store-conditional loop on older ARM). It is faster than a mutex by an order of magnitude.

The modern, type-safe API since Go 1.19:

```go
import "sync/atomic"

type AtomicCounter struct {
    count atomic.Int64
}

func (c *AtomicCounter) Inc() {
    c.count.Add(1)
}

func (c *AtomicCounter) Get() int64 {
    return c.count.Load()
}
```

`atomic.Int64` is a struct that wraps an `int64` and gives it atomic methods. Its zero value is a usable counter at zero. It is safe to copy *only* before any goroutine has touched it; once it is in use, you must pass it by pointer.

The older, still-supported API:

```go
type AtomicCounter struct {
    count int64
}

func (c *AtomicCounter) Inc() {
    atomic.AddInt64(&c.count, 1)
}

func (c *AtomicCounter) Get() int64 {
    return atomic.LoadInt64(&c.count)
}
```

Both are correct. The new API is preferred for new code because it makes the contract visible at the type level — you cannot accidentally write `c.count++` next to `atomic.LoadInt64(&c.count)` and get a silent race.

### Monotonic vs gauge

A counter that only goes up (request count, bytes received) needs only `Add(1)` and `Load()`. A counter that can also go down (in-flight requests, queue depth) needs both `Add(+1)` and `Add(-1)`. `atomic.Int64` supports both with a single method:

```go
inflight.Add(1)   // request started
defer inflight.Add(-1) // request finished
```

Decrementing an `atomic.Uint64` requires a small trick: you cannot pass `-1` to an unsigned add. Use `Add(^uint64(0))` (the two's-complement of one) or, more readably, choose `atomic.Int64` if you need decrement.

### What you do *not* yet need

You do not need to think about:

- Cache lines and false sharing (senior level)
- Per-CPU sharding (senior level)
- HDR histograms (professional level)
- `expvar` and metric registration (middle level)
- `atomic.Value` or `atomic.Pointer` (different topic)

For everything you will write as a junior — a request counter for an HTTP handler, an error tally for a worker pool, a "bytes processed" meter for a log shipper — `atomic.Int64` and `atomic.Uint64` are the right answer.

---

## Real-World Analogies

### A scoreboard at a sports stadium

Imagine a stadium scoreboard. Many referees can call "add one point". If two referees press the "+1" button on a board that simply reads the current number, adds one, and writes it back, two simultaneous presses might only increase the score by one.

A mutex is like saying: "only one referee may touch the scoreboard at a time; everyone else queues up." Correct, but slow.

An atomic operation is like a special button that *atomically* increments the displayed number — the hardware itself guarantees both presses count, regardless of timing.

### Hotel front-desk room-count

Multiple receptionists check guests in and out. The hotel has a "current occupied rooms" gauge. If receptionist A reads "47", receptionist B reads "47", both check in a guest, and both write "48", one guest is invisible to the count.

A shared variable with a lock is one receptionist with a master ledger that everyone passes around. An atomic gauge is an electronic counter that all receptionists trigger but which itself runs in hardware.

### Newsroom ticker tape

In old newsrooms a single "wire ticker" produced sentences character by character. If two operators tried to add words at the same moment, the tape became gibberish. The fix was either a shared editor (mutex) or a special device that accepted whole words at a time and serialised them internally (atomic).

---

## Mental Models

### The read-modify-write cycle

Every counter increment is a read-modify-write cycle. Either:

- **No one else may read or write while my cycle runs** (mutex), or
- **The entire cycle is one indivisible hardware step** (atomic).

There is no third option. Anything else is a race.

### "Atomic" means "no one sees the in-between"

It does not mean fast. It does not mean lock-free in the abstract sense. It means: from the perspective of every other goroutine, the operation either has not happened or has fully happened. There is no observable partial state.

### Counter, gauge, and the difference

| Pattern | What it measures | Direction | Examples |
|---------|------------------|-----------|----------|
| **Counter** | A monotonic total | Up only | requests_total, bytes_received_total |
| **Gauge** | A snapshot value | Up and down | inflight_requests, queue_depth |
| **Distribution** | A set of observations | N/A | request latency, response size |

For a junior, the first two are everything. Distributions (histograms, summaries) are a senior/professional concern.

---

## Pros & Cons

### `sync.Mutex` counter

**Pros**
- Simple to reason about; no atomic-memory subtleties
- Works for any operation, not just a single increment (e.g. `count++; lastEvent = time.Now()` together)
- Works on every architecture without alignment worries
- Easy to extend — add a field, no API change

**Cons**
- Slower for hot single-counter increments (often 5-20× slower than a single atomic)
- Lock contention scales poorly: 64 cores hammering one mutex is a disaster
- Holding a lock for any unrelated logic blocks other increments

### `sync/atomic` counter

**Pros**
- Very fast — one CPU instruction in the uncontended case
- No lock to forget to release
- The modern `atomic.Int64` type makes intent clear in the type system

**Cons**
- Each method call is its own atomic; you cannot atomically do "load, compute, store" without `CompareAndSwap` or a mutex
- Still scales poorly under heavy contention because the cache line ping-pongs between cores (senior topic: false sharing)
- Requires 64-bit alignment of the value (the typed wrappers handle this; the raw `int64`+package-level functions do not on 32-bit ARM)

### Plain `int` with no protection

**Pros**
- None worth mentioning

**Cons**
- Races, lost updates, torn reads, and the Go race detector hates it
- The compiler is free to optimise it in surprising ways because it sees no synchronisation

---

## Use Cases

### HTTP request counter

Every web framework has one. Each request increments a counter; an admin endpoint or `/metrics` page exposes the total.

```go
var requestsTotal atomic.Int64

func handler(w http.ResponseWriter, r *http.Request) {
    requestsTotal.Add(1)
    // ... handle the request
}
```

### Error count per worker

A worker pool that processes jobs. Whenever a job fails, increment an error counter. After the pool finishes, log the count.

```go
type Pool struct {
    errors atomic.Int64
}

func (p *Pool) runJob(j Job) {
    if err := j.Do(); err != nil {
        p.errors.Add(1)
    }
}
```

### Bytes-processed meter

A log shipper that reads bytes off a TCP connection. Each goroutine periodically adds its share to a global meter.

### In-flight requests gauge

For a server that wants to gracefully drain on shutdown, an `atomic.Int64` of in-flight requests is exactly the right tool. Increment on entry, decrement on exit, refuse new requests when set to "draining", wait for the gauge to reach zero, then exit.

### "Test instrumentation"

Tests often want to assert "the callback was invoked N times". An atomic counter is the easiest way:

```go
var called atomic.Int64
client.OnEvent = func() { called.Add(1) }
// ... do work
if got := called.Load(); got != 3 {
    t.Errorf("expected 3 calls, got %d", got)
}
```

### A "we have started" sentinel

Sometimes you do not need a count but a flag. Atomics work here too:

```go
var started atomic.Bool
if started.CompareAndSwap(false, true) {
    // first arrival; run startup logic
}
```

---

## Code Examples

### The broken program, fully spelled out

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var count int
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            count++
        }()
    }
    wg.Wait()
    fmt.Println("count =", count) // probably not 1000
}
```

Run it. Run it ten times. Note the variation. Then run it with `go run -race main.go` and notice the screaming.

### Fix 1: mutex

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var (
        mu    sync.Mutex
        count int
    )
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            count++
            mu.Unlock()
        }()
    }
    wg.Wait()
    fmt.Println("count =", count) // always 1000
}
```

### Fix 2: atomic, modern API

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var count atomic.Int64
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            count.Add(1)
        }()
    }
    wg.Wait()
    fmt.Println("count =", count.Load()) // always 1000
}
```

### Fix 3: atomic, older API

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var count int64
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            atomic.AddInt64(&count, 1)
        }()
    }
    wg.Wait()
    fmt.Println("count =", atomic.LoadInt64(&count)) // always 1000
}
```

Note: this version is safe on 64-bit platforms but on 32-bit ARM it requires `count` to be 64-bit aligned. The typed `atomic.Int64` handles alignment for you.

### A reusable counter type

Most codebases wrap their counter in a small named type with a clear API:

```go
package metrics

import "sync/atomic"

// Counter is a monotonically-increasing 64-bit value safe for
// concurrent use from any number of goroutines.
type Counter struct {
    v atomic.Int64
}

// Inc increments the counter by one and returns the new value.
func (c *Counter) Inc() int64 {
    return c.v.Add(1)
}

// Add adds delta to the counter and returns the new value.
// For a monotonic counter, delta should be non-negative; for
// a gauge use the Gauge type instead.
func (c *Counter) Add(delta int64) int64 {
    return c.v.Add(delta)
}

// Get returns the current value.
func (c *Counter) Get() int64 {
    return c.v.Load()
}

// Reset sets the counter back to zero and returns the previous
// value. Useful for periodic flushing.
func (c *Counter) Reset() int64 {
    return c.v.Swap(0)
}
```

```go
package metrics

import "sync/atomic"

// Gauge is a 64-bit value that may increase or decrease.
type Gauge struct {
    v atomic.Int64
}

func (g *Gauge) Inc()        { g.v.Add(1) }
func (g *Gauge) Dec()        { g.v.Add(-1) }
func (g *Gauge) Add(d int64) { g.v.Add(d) }
func (g *Gauge) Set(v int64) { g.v.Store(v) }
func (g *Gauge) Get() int64  { return g.v.Load() }
```

### In-flight request guard

```go
type Server struct {
    inflight atomic.Int64
    drain    atomic.Bool
}

func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {
    if s.drain.Load() {
        http.Error(w, "shutting down", http.StatusServiceUnavailable)
        return
    }
    s.inflight.Add(1)
    defer s.inflight.Add(-1)
    // ... real handler
}

func (s *Server) Shutdown(ctx context.Context) error {
    s.drain.Store(true)
    for {
        if s.inflight.Load() == 0 {
            return nil
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(50 * time.Millisecond):
        }
    }
}
```

### Counter that gets snapshotted periodically

```go
func report(c *Counter, interval time.Duration, stop <-chan struct{}) {
    ticker := time.NewTicker(interval)
    defer ticker.Stop()
    for {
        select {
        case <-stop:
            return
        case <-ticker.C:
            n := c.Reset()
            log.Printf("requests in last interval: %d", n)
        }
    }
}
```

Note the use of `Swap(0)` (via `Reset`) instead of `Load()` + `Store(0)`. Doing those two operations separately would lose any increments that occur between them.

---

## Coding Patterns

### Pattern: defer-decrement for gauges

```go
gauge.Add(1)
defer gauge.Add(-1)
```

If you forget `defer`, a panic between the two lines will leak the increment forever. Always pair with `defer`.

### Pattern: take a snapshot, do not poll

If you need to log or expose a counter, do one `Load()` and use that value for everything in the line:

```go
// Bad: two reads, value may change between them
log.Printf("requests=%d, percent_of_max=%.2f", c.Get(), float64(c.Get())/float64(max))

// Good: one read
n := c.Get()
log.Printf("requests=%d, percent_of_max=%.2f", n, float64(n)/float64(max))
```

### Pattern: counter per category

If you want to count *kinds* of errors, use one counter per kind, not a `map[string]*Counter` keyed by string — map access is not safe for concurrent writes, and locking the map defeats the purpose.

```go
type ErrorStats struct {
    Timeout    Counter
    BadRequest Counter
    Unknown    Counter
}
```

For dynamic keys you would use `sync.Map` or a `sync.Mutex` over a `map`; that is a middle-level pattern.

### Pattern: counter as method receiver

Always make counter methods on a pointer receiver. Copying a counter loses safety:

```go
// Wrong: value receiver. Each call sees its own copy.
func (c Counter) Inc() { c.v.Add(1) }

// Right: pointer receiver. All callers share the same atomic.
func (c *Counter) Inc() { c.v.Add(1) }
```

### Pattern: never `vet`-suppress an atomic value

`go vet` flags any `copy of atomic.Int64`. Do not silence the warning — fix the code by passing a `*Counter` instead of a `Counter`.

---

## Clean Code

### Name the unit

`requestsTotal`, `bytesProcessed`, `inflightRequests`. Avoid `count`, `total`, `n` — they tell the reader nothing about what is being counted or in what unit.

### Suffix `_total` for monotonic counters

A widely-adopted convention (Prometheus, OpenMetrics) is to suffix monotonically-increasing counters with `_total`: `http_requests_total`, `bytes_received_total`. The suffix signals intent.

### Suffix nothing for gauges

Gauges name the *thing*, not the action: `queue_depth`, `inflight_requests`, `goroutines`. No `_total`.

### Wrap atomics in a named type

A bare `atomic.Int64` field in a struct invites mistakes. A named `Counter` type with methods is harder to misuse and clearer at call sites.

### Document the unit in the type or the field comment

```go
// BytesSent counts bytes written to the wire, including headers
// and TLS overhead. It is monotonically increasing.
type BytesSent struct{ v atomic.Int64 }
```

---

## Product Use / Feature

### Rate-limiting

A request counter that resets every second, combined with a check `if c.Get() > limit { reject() }`, is the simplest token bucket. The senior version uses sliding windows and is more accurate.

### Health-check signal

A counter that records "last successful operation" timestamp is a one-line liveness probe. Use `atomic.Int64` to store unix nanos and compare against `time.Now().UnixNano()`.

### Backpressure

`if inflight.Load() > maxInflight { return Busy }` is the textbook backpressure mechanism. The counter is the only thing standing between you and an overload.

### Per-feature analytics

Counters per feature flag, per request type, per cache hit/miss — every observability story starts with counters.

---

## Error Handling

Atomic operations *never* return an error. They cannot fail. The contract is: the operation either happens entirely or has not yet been issued; there is no in-between failure mode.

This is one reason atomics are nice — there is no error to forget to handle. But it also means atomics cannot tell you anything went wrong. If `Inc()` is called from a goroutine that panics afterwards, your gauge will be one too high forever. That is why gauges should always use `defer`.

For *recoverable* errors involving counters, the typical pattern is:

```go
n := c.Inc()
if n > limit {
    c.Add(-1) // undo
    return ErrTooMany
}
```

Use this sparingly. It is correct under any concurrency, but if you find yourself "undoing" counters often, you might want `CompareAndSwap`-based admission control instead — a middle-level topic.

---

## Security Considerations

### Counter overflow

`int64` overflows after about 9.2 × 10^18 increments. At a billion increments per second, that is ~292 years. Practically irrelevant for monotonic counters, but watch out for *delta* arithmetic: subtracting two large `uint64` values can underflow if the order is wrong.

### Side-channel leaks

Counters exposed to untrusted clients (e.g. `/metrics` endpoints) can leak information about request volumes, errors, and internal state. Always authenticate `/metrics`.

### Counter-based authorisation is almost always wrong

Logic like "the third request from this IP is privileged" using an atomic counter has subtle races and should be reviewed carefully. Prefer explicit per-session state.

### `expvar` exposes counters by default

By importing `expvar`, you implicitly register `/debug/vars` on `http.DefaultServeMux`. Do not expose `DefaultServeMux` to the public internet without thinking about what it leaks. (More on this at the middle and professional levels.)

---

## Performance Tips

These are all you need at junior level. The deeper performance work belongs to the senior file.

1. **Prefer `sync/atomic` over `sync.Mutex` for single-word increments.** Atomic is typically 5–20× faster.
2. **Use the typed `atomic.Int64` API in new code.** It avoids the alignment trap of the old API on 32-bit ARM and reads better.
3. **Do not allocate a new counter per request.** Allocate once, reuse across all goroutines.
4. **Do not read a counter inside a tight inner loop if you do not have to.** A `Load()` is cheap but not free; cache it locally if you reuse it many times.
5. **Bench before you tune.** A 5 ns difference per increment may be irrelevant if your handler runs in 5 ms.

---

## Best Practices

- **Always use a pointer receiver** for methods on a struct containing an atomic.
- **Always pair `Add(+1)` with `defer Add(-1)`** for gauges.
- **Use `Swap(0)` to reset, never `Load() + Store(0)`** — the latter loses increments.
- **Name counters with units** (`bytes`, `requests`, `_total`).
- **Wrap the atomic in a named type** rather than exposing the field directly.
- **Run your tests with `-race`.** It will catch the day-one mistakes for free.
- **Prefer `atomic.Int64` over `atomic.Uint64`** unless you genuinely need unsigned semantics and never need to decrement.
- **Document the monotonicity** in a comment near the field.

---

## Edge Cases & Pitfalls

### Copying a struct that contains an atomic

```go
type Counter struct{ v atomic.Int64 }

a := Counter{}
b := a // copy! b.v is now an independent atomic with value 0
a.v.Add(1)
fmt.Println(b.v.Load()) // 0, not 1
```

`go vet` warns. Listen to it. Always pass `*Counter`, never `Counter` by value.

### Counter inside a value-receiver method

```go
func (c Counter) Inc() { c.v.Add(1) } // wrong
```

The receiver is a copy. The increment goes into a value about to be thrown away. Use `*Counter`.

### 32-bit ARM alignment

On 32-bit ARM, calling `atomic.AddInt64(&someField, 1)` requires the field to be 64-bit aligned. If your struct layout puts the `int64` at an odd offset, the program panics. The typed `atomic.Int64` handles this automatically by embedding alignment-forcing padding. The package-level functions do not. The standard fix: put the `int64` first in the struct, or migrate to `atomic.Int64`.

### Mixing atomic and non-atomic access

```go
atomic.AddInt64(&count, 1) // atomic write
fmt.Println(count)         // non-atomic read — race!
```

Once a variable is written atomically by anyone, *every* read must also be atomic. The race detector will catch this.

### Counters in maps

A `map[string]*Counter` is fine if the map itself never changes (build it once at startup). A `map[string]*Counter` you write to concurrently is not safe — the map is not goroutine-safe even if the pointer values are.

### `Load()` then act-on-the-value

```go
if c.Load() > 0 {
    c.Add(-1)
    work()
}
```

Two goroutines may both see `> 0`, both decrement, and double-spend the slot. Use `CompareAndSwap` (middle level) or a mutex.

### Forgetting to start at zero

The zero value of `atomic.Int64` is a usable counter at zero. You do not need an explicit constructor. Some teams write one anyway for symmetry with other types — that is fine but not required.

### `atomic.Uint64` decrement

```go
var u atomic.Uint64
u.Add(^uint64(0)) // subtract 1 by adding (-1) two's-complement
```

Surprising and ugly. If you need decrement, use `atomic.Int64`.

---

## Common Mistakes

1. **Reading without `Load`.** Once a variable is touched atomically anywhere, every read must be `Load`.
2. **Writing without `Store`.** Likewise for every write.
3. **Holding a mutex around an atomic.** Redundant and slow.
4. **Copying the struct.** Loses safety, loses identity.
5. **Adding `_total` to a gauge.** Confuses operators reading metrics.
6. **Using `int` instead of `int64` and then passing `&intValue` to `atomic.AddInt64`.** Compile error — `int` and `int64` are different types in Go.
7. **Treating an atomic as a transaction.** Two atomic operations are not atomic together. Use `CompareAndSwap` or a mutex.
8. **Forgetting the race detector.** It is the cheapest tool you will ever own.

---

## Common Misconceptions

- **"Atomic means lock-free."** They are related but not the same. All single-instruction atomics are lock-free, but a *lock-free data structure* is usually much more than one atomic.
- **"Atomics are slow."** Compared to a mutex they are fast. Compared to a plain memory write they cost a CPU pipeline stall. Both are true.
- **"On a single core I do not need atomics."** Wrong. The Go scheduler can preempt a goroutine in the middle of a read-modify-write even on one core. Atomics are still required.
- **"`int64` reads and writes are atomic on x86-64."** Reads of an *aligned* `int64` are atomic at the hardware level on x86-64, but the *Go memory model* does not guarantee this for plain assignments. The compiler is free to introduce intermediate writes or reorder. Use `atomic.LoadInt64` / `atomic.StoreInt64`.
- **"`sync.Once` solves my counter problem."** It runs once. A counter runs many times. Different tool.

---

## Tricky Points

### `atomic.Int64{}` is zero-initialized

You do not need to call a constructor. The zero value works.

### `atomic.Int64.Add` returns the new value

```go
n := c.Add(1)
log.Printf("we are now at %d", n)
```

This avoids a second `Load()` after the add and is also race-free with respect to other increments.

### `atomic.Int64.Swap` returns the previous value

Useful for "report and reset" patterns:

```go
prev := c.Swap(0)
metrics.Send(prev)
```

### `atomic.Int64.CompareAndSwap` returns a bool

```go
ok := c.CompareAndSwap(0, 1)
```

Returns `true` if the value was `0` and is now `1`; `false` otherwise. The simplest building block for higher-level concurrent algorithms.

### `Load`/`Store` are not "free"

They are cheaper than `Add` but they still cross the memory barrier on most architectures. In a billion-iteration inner loop you may be able to *cache* a counter's value locally and `Add` the total at the end. That is a middle-level optimisation — but worth being aware of.

### Negative gauges are a bug signal

If you ever see a gauge go below zero, *somebody decremented without incrementing*. Add `if g.Add(-1) < 0 { log.Panic("gauge underflow") }` in tests.

---

## Test

```go
package metrics

import (
    "sync"
    "testing"
)

func TestCounter_Inc(t *testing.T) {
    var c Counter
    const N = 10_000
    var wg sync.WaitGroup
    wg.Add(N)
    for i := 0; i < N; i++ {
        go func() {
            defer wg.Done()
            c.Inc()
        }()
    }
    wg.Wait()
    if got := c.Get(); got != N {
        t.Errorf("expected %d, got %d", N, got)
    }
}

func TestGauge_AddDec(t *testing.T) {
    var g Gauge
    const N = 1_000
    var wg sync.WaitGroup
    wg.Add(N * 2)
    for i := 0; i < N; i++ {
        go func() { defer wg.Done(); g.Inc() }()
        go func() { defer wg.Done(); g.Dec() }()
    }
    wg.Wait()
    if got := g.Get(); got != 0 {
        t.Errorf("expected 0, got %d", got)
    }
}

func TestCounter_Reset(t *testing.T) {
    var c Counter
    c.Add(42)
    if prev := c.Reset(); prev != 42 {
        t.Errorf("expected swap to return 42, got %d", prev)
    }
    if got := c.Get(); got != 0 {
        t.Errorf("expected reset to 0, got %d", got)
    }
}
```

Run with `-race`:

```
$ go test -race -count=10 ./metrics
ok      metrics 0.231s
```

If you see *any* DATA RACE report from this, your atomics are not actually atomic — go check that you used `Load`/`Add`/`Store` everywhere.

---

## Tricky Questions

**Q: Is `count++` ever safe across goroutines?**
A: Only if exactly one goroutine ever writes `count` and no other goroutine reads it. As soon as a second writer or any concurrent reader exists, it is a race.

**Q: Why does `count++` sometimes give the right answer in a small test?**
A: With few goroutines and a fast machine, the OS scheduler may serialise them. The race is *latent*. Run it under `-race`, or with millions of iterations, and it will surface.

**Q: Does `sync.Mutex` protect against torn reads?**
A: Yes — every reader and writer holds the lock, so no one ever sees an intermediate state.

**Q: Does `atomic.Int64` protect a *struct* containing an `int64`?**
A: No. It protects only the single `int64`. A struct with multiple fields needs a mutex or a `atomic.Pointer[Snapshot]` swap pattern.

**Q: Can I use `atomic.Int64` on a 32-bit system?**
A: Yes. The typed wrapper enforces alignment. The old `atomic.AddInt64(&x, 1)` against a plain `int64` field may panic if the field is not 64-bit aligned.

**Q: What is the cost of an atomic add on modern x86-64?**
A: Roughly 10–20 ns when no contention, rising sharply with the number of contending cores because the cache line bounces.

**Q: Does `atomic.Int64.Load()` require a write barrier?**
A: It requires whatever the platform needs to guarantee sequential consistency for that load. On x86-64 it is usually a plain `MOV` (the architecture is strong enough). On ARM it is a load-acquire instruction.

**Q: Are `expvar` counters atomic?**
A: Yes. `expvar.Int.Add(int64)` uses `atomic.AddInt64` internally. You learn that at the middle level.

---

## Cheat Sheet

```go
import "sync/atomic"

// declare
var c atomic.Int64

// increment
c.Add(1)

// decrement (only for gauges; never on monotonic counters)
c.Add(-1)

// read
v := c.Load()

// reset (atomic exchange to zero, returns previous)
prev := c.Swap(0)

// "first arrival" — set to 1 only if currently 0
first := c.CompareAndSwap(0, 1)

// old API (still works, still common)
var raw int64
atomic.AddInt64(&raw, 1)
v := atomic.LoadInt64(&raw)
atomic.StoreInt64(&raw, 0)
```

When in doubt, choose:

| Need | Type |
|------|------|
| Counter that only goes up | `atomic.Int64` |
| Gauge that goes up and down | `atomic.Int64` |
| Unsigned semantics, never decrement | `atomic.Uint64` |
| Two related fields | `sync.Mutex` |
| A whole snapshot replaced atomically | `atomic.Pointer[T]` |
| Boolean flag | `atomic.Bool` |

---

## Self-Assessment Checklist

- [ ] I can explain in one sentence why `count++` is unsafe across goroutines
- [ ] I can fix it with `sync.Mutex`
- [ ] I can fix it with `atomic.Int64`
- [ ] I know the difference between a monotonic counter and a gauge
- [ ] I know to use `defer Add(-1)` for gauges
- [ ] I know to use `Swap(0)` to reset, not `Load()`+`Store(0)`
- [ ] I know that copying a struct containing an atomic is a bug `go vet` will flag
- [ ] I run my tests with `-race`

---

## Summary

A concurrent counter looks like the most boring possible exercise in concurrency and turns out to teach the central lessons of the whole field: read-modify-write atomicity, visibility, and the cost of synchronisation. The junior toolkit is:

- `sync.Mutex` when in doubt — always correct, sometimes slow
- `sync/atomic`'s `atomic.Int64`/`atomic.Uint64` for fast single-counter increments
- Distinguish monotonic counters from gauges; name them accordingly
- Always pair gauge increments with `defer` decrements
- Run the race detector

When you reach the middle level you will add `CompareAndSwap` loops, `expvar` integration, and start thinking about the multi-counter coordination problem. When you reach the senior level you will discover that even `atomic.Int64.Add(1)` is too slow under heavy contention, and you will learn about cache lines, false sharing, sharded counters, and sloppy counters. When you reach the professional level you will deal with HDR histograms, percentile-preserving merges, NUMA effects, and the design of an observability subsystem.

But it all starts with `count++` being wrong, and `atomic.Int64` being a one-line fix.

---

## What You Can Build

With only the junior-level material you can confidently build:

- A request counter for an HTTP handler
- A bytes-processed meter for a copy loop
- An in-flight gauge for a server that needs to drain on shutdown
- A "first arrival wins" sentinel using `CompareAndSwap`
- A periodic "report and reset" worker
- A test assertion that "callback X was invoked exactly N times"
- A basic admission controller: refuse work when gauge exceeds threshold
- A simple per-error-type tally for an aggregating worker

---

## Further Reading

- The Go Memory Model: <https://go.dev/ref/mem>
- `sync/atomic` package docs: <https://pkg.go.dev/sync/atomic>
- `sync.Mutex` package docs: <https://pkg.go.dev/sync#Mutex>
- "What is a data race?" — the official guide: <https://go.dev/doc/articles/race_detector>
- "The Cost of Mutexes vs Atomics" — a classic blog series; search for benchmarks
- Russ Cox, "Hardware Memory Models" series on research.swtch.com

---

## Related Topics

- Goroutines (start, lifecycle, leaks)
- `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`
- `sync/atomic` (this file's other API surfaces: `Bool`, `Pointer[T]`, `Value`)
- The Go race detector
- Memory ordering and the Go memory model
- The Prometheus client library (which builds on these primitives)
- `expvar` (middle level)
- Sharded counters and `LongAdder` (senior level)
- HDR histograms (professional level)

---

## Diagrams & Visual Aids

### The lost-update timeline

```
time  →
G1:  read(5) -------- +1 -------- write(6)
G2:        read(5) -------- +1 -------- write(6)

result: count == 6, not 7
```

### Mutex vs atomic vs raw

```
+--------+----------+-----------------+-------------------+
| Tool   | Correct? | Speed (1 core)  | Speed (16 cores)  |
+--------+----------+-----------------+-------------------+
| ++     | NO       | "fast"          | "fast" but wrong  |
| Mutex  | yes      | ~50 ns / op     | ~500 ns / op      |
| atomic | yes      | ~5 ns / op      | ~150 ns / op      |
+--------+----------+-----------------+-------------------+
```

(Numbers are illustrative; measure on your own hardware.)

### Counter, gauge, distribution

```
Counter (monotonic)        Gauge (snapshot)       Distribution (histogram)
       ↑                       ↑↓                       _.--._
       |                       /\                      /      \
       |                     _/  \_                  _/        \_
       |________            ________                ______________
```

### `Add` returns the new value, not the old

```
before:  count = 10
call:    n := count.Add(3)
after:   count = 13,  n = 13
```

### `Swap` returns the old value

```
before:  count = 42
call:    prev := count.Swap(0)
after:   count = 0,   prev = 42
```

That is everything you need to start. Build the broken example, watch it fail, fix it both ways, and move on to the middle level when you are ready to think about contention.

---

## Deeper Dive: Why `count++` is Three Instructions

Let us look at what the Go compiler actually produces for `count++` where `count` is an `int64`. You can ask for the assembly with:

```bash
go build -gcflags="-S" main.go 2>&1 | grep -A 5 "INC"
```

For an unsynchronised `count++` on x86-64 you typically see something like:

```
MOVQ "".count(SB), AX   ; read count into register AX
INCQ AX                 ; AX = AX + 1
MOVQ AX, "".count(SB)   ; write AX back to count
```

Three instructions. Between any two of them another thread on another core could read and write the same memory location. That is the lost update.

Now look at the assembly for `atomic.AddInt64(&count, 1)` on x86-64:

```
LOCK
XADDQ AX, "".count(SB)
```

A single instruction, prefixed with `LOCK`. The `LOCK` prefix tells the CPU: "for the duration of this instruction, I have exclusive access to the cache line containing this memory address; no other core may interleave." That is what `atomic` buys you.

On ARMv8 the equivalent is `LDADD` (a single instruction since ARMv8.1). On older ARM cores it is a `LDREX`/`STREX` (load-exclusive / store-exclusive) loop:

```
loop:
  LDREX r0, [count]
  ADD   r0, r0, #1
  STREX r1, r0, [count]
  CBNZ  r1, loop        ; retry if the exclusive bit was cleared
```

The CPU monitors whether anyone else touched that cache line between the LDREX and the STREX; if they did, the STREX fails and the whole sequence retries. This is called *optimistic concurrency* at the hardware level. It is the foundation of all lock-free programming.

When you call `atomic.Int64.Add(1)`, Go's `sync/atomic` package compiles to whichever of these instruction sequences is best for your CPU. You never see it — but you should know it is there.

---

## Deeper Dive: The Race Detector Walkthrough

Let us run the broken program under `-race` and read the output. Save this as `bad_count.go`:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var count int
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            count++
        }()
    }
    wg.Wait()
    fmt.Println(count)
}
```

Run it:

```
$ go run -race bad_count.go
==================
WARNING: DATA RACE
Read at 0x00c00001a0a0 by goroutine 8:
  main.main.func1()
      /tmp/bad_count.go:13 +0x44

Previous write at 0x00c00001a0a0 by goroutine 7:
  main.main.func1()
      /tmp/bad_count.go:13 +0x55

Goroutine 8 (running) created at:
  main.main()
      /tmp/bad_count.go:11 +0xb0

Goroutine 7 (finished) created at:
  main.main()
      /tmp/bad_count.go:11 +0xb0
==================
997
Found 1 data race(s)
exit status 66
```

Three things to notice:

1. **The line numbers point to `count++`.** That is the racy access.
2. **Both goroutines were created on line 11.** The race detector tells you exactly which `go` statement spawned the racers.
3. **The program still finished and printed `997`.** A race does not necessarily crash; it silently produces wrong answers. That is what makes races so dangerous in production.

The exit status `66` is what `-race` uses to signal "races found". Your CI should treat that as a failure.

Now fix it and re-run:

```go
var count atomic.Int64
// ... count.Add(1) instead of count++
```

```
$ go run -race fix_count.go
1000
```

Clean exit, correct answer. The race detector is the single most valuable tool in your concurrency toolkit. Use it in every test run, every CI build, every time you touch a shared variable.

---

## Deeper Dive: When the Race Detector Misses Races

The race detector observes accesses that *actually happened* during the run. It is sound — every race it reports is a real race — but it is not *complete*: it can miss races that happen to not occur during the particular execution it observed.

Concrete example:

```go
var count int64
go func() { time.Sleep(time.Second); count++ }()
fmt.Println(count)
```

If the race detector runs and the `Println` happens before the goroutine wakes up, no concurrent access has occurred *yet* and no race is reported. The race is *latent*.

Mitigations:

1. **Run tests many times under `-race`:** `go test -race -count=100`
2. **Use stress-testing tools** like `golang.org/x/tools/cmd/stress`
3. **Write tests with `runtime.Gosched()` injections** at the suspect points
4. **Trust the principle**, not just the detector: if two goroutines touch the same memory, *one of them must use synchronisation*. The detector confirms; it does not prove.

---

## Deeper Dive: `atomic.Int64` vs Older Functions, Side-by-Side

```go
// Old API
var x int64
atomic.AddInt64(&x, 1)
v := atomic.LoadInt64(&x)
atomic.StoreInt64(&x, 0)
old, swapped := atomic.CompareAndSwapInt64(&x, 0, 1), true
prev := atomic.SwapInt64(&x, 99)
```

```go
// New API (Go 1.19+)
var x atomic.Int64
x.Add(1)
v := x.Load()
x.Store(0)
swapped := x.CompareAndSwap(0, 1)
prev := x.Swap(99)
```

Differences:

| Aspect | Old | New |
|--------|-----|-----|
| Field declaration | `int64` | `atomic.Int64` |
| Alignment on 32-bit | manual | automatic |
| Easy to misuse with `x++` | yes | no (no `++` defined on the type) |
| Easy to misuse with `x` directly | yes | impossible — methods only |
| `go vet` copy detection | no | yes |
| Available since | Go 1.0 | Go 1.19 |
| Source readability | function calls | method chains |

For new code, always use the new API. For old code, leave it alone unless you are refactoring nearby.

---

## Deeper Dive: Counters and the Memory Model

The Go memory model (see `https://go.dev/ref/mem`) says, in part:

> The APIs in the `sync/atomic` package are collectively "atomic operations" that can be used to synchronise the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronised before B.

In plain English: every `Load` is guaranteed to see *every* `Store`/`Add` that finished before it, in a consistent global order. There is no "I saw 42 in this goroutine but 41 in that one at the same nanosecond" — atomics are *sequentially consistent* in Go.

This is a strong guarantee. C and C++ let you choose weaker orderings (relaxed, acquire, release) for performance. Go has decided: every atomic is fully ordered. That is one fewer footgun for you. The trade-off is a tiny bit of unnecessary work on weakly-ordered architectures (ARM, POWER) — Go emits stronger fences than absolutely necessary so that you do not have to think about it.

Practically, the only thing you need to remember:

- If goroutine A `Add`s and goroutine B subsequently `Load`s, B sees the new value.
- If goroutine A writes a *non-atomic* variable and *then* `Store`s to an atomic, goroutine B that `Load`s the atomic and then reads the non-atomic variable sees A's write to the non-atomic variable too.

The last point is the "release/acquire" pattern: `Store` releases prior writes, `Load` acquires them. It lets you build more complex structures (one of which is the sharded counter at the senior level).

---

## Deeper Dive: When a Counter is the Wrong Tool

Sometimes a junior engineer reaches for a counter when something else would serve better. Examples:

### "How many goroutines are alive?"

Use `runtime.NumGoroutine()`. It is already a counter inside the runtime.

### "Has this work been done?"

Use `sync.Once` — it solves "exactly once" execution. A counter compared against 1 is a worse version of this.

### "Notify me when N tasks are done"

Use `sync.WaitGroup`. It is a counter, but with built-in blocking and panic-on-misuse.

### "What is the rate of requests per second?"

A counter alone is not enough — you also need time. Combine a counter with a periodic sampler, or use a sliding-window structure (middle/senior level).

### "How long did each request take?"

A counter cannot answer this. You need a distribution: a histogram or a summary. Histograms come at the professional level.

### "What was the value at time T?"

A bare counter loses history. If you need history, log the value over time or use a time-series database.

### "What is the maximum we ever reached?"

You need a `MaxOf` operation. With atomics:

```go
type AtomicMax struct{ v atomic.Int64 }
func (m *AtomicMax) Observe(x int64) {
    for {
        cur := m.v.Load()
        if x <= cur {
            return
        }
        if m.v.CompareAndSwap(cur, x) {
            return
        }
    }
}
```

That `CompareAndSwap` loop is your first taste of lock-free programming. We will see many more at the senior level.

---

## Deeper Dive: Counter Naming Conventions Across Frameworks

Different ecosystems have different conventions. Junior code often mixes them; senior code picks one and sticks to it.

| Ecosystem | Counter style | Gauge style |
|-----------|---------------|-------------|
| Prometheus / OpenMetrics | `http_requests_total{code="200"}` | `inflight_requests` |
| StatsD | `app.requests.count` | `app.connections.active` |
| OpenTelemetry | `http.server.request.count` | `http.server.active_requests` |
| Datadog | `app.requests` (rate-derived) | `app.queue.depth` |
| Honeycomb | event-based, no counters per se | derived from event count |

If your service emits to Prometheus, name your Go variable in a way that matches the metric name: `httpRequestsTotal` for the metric `http_requests_total`. The visual match helps grepping production alerts back to code.

---

## Deeper Dive: Two Common Counter Idioms

### Idiom 1: counter with derived rate

```go
type RateCounter struct {
    count atomic.Int64
    start time.Time
}

func NewRateCounter() *RateCounter {
    return &RateCounter{start: time.Now()}
}

func (r *RateCounter) Inc() { r.count.Add(1) }

func (r *RateCounter) PerSecond() float64 {
    n := r.count.Load()
    elapsed := time.Since(r.start).Seconds()
    if elapsed == 0 {
        return 0
    }
    return float64(n) / elapsed
}
```

Beware: the rate is the *average since start*, which is rarely what operators want. They want the rate over the last minute. Use a sliding-window structure for that (senior topic).

### Idiom 2: counter with periodic flush

```go
type FlushCounter struct {
    cur  atomic.Int64
    sink func(int64)
}

func (f *FlushCounter) Inc() { f.cur.Add(1) }

func (f *FlushCounter) RunFlusher(interval time.Duration, stop <-chan struct{}) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-stop:
            return
        case <-t.C:
            f.sink(f.cur.Swap(0))
        }
    }
}
```

The `Swap(0)` reads and resets in one atomic step. Reads done between the read and the reset would lose increments; the swap prevents that.

---

## Deeper Dive: Test Your Understanding With Variations

### Variation 1: Make the broken program *more* broken

```go
for i := 0; i < 1000; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := 0; j < 1000; j++ {
            count++
        }
    }()
}
```

Now you have a million increments split across 1000 goroutines. The error becomes far more visible — typically you will see a final count in the low hundreds of thousands instead of 1,000,000. The losses scale with contention.

### Variation 2: Add `runtime.Gosched()` between read and write

```go
go func() {
    defer wg.Done()
    cur := count
    runtime.Gosched()
    count = cur + 1
}()
```

Now you have explicitly opened the race window. The final count will be close to *the number of distinct schedule points*, which on a 16-core machine might be very small indeed.

### Variation 3: Add a single mutex around a single increment

You should always get 1000, even with millions of iterations. But notice the wall-clock time grows enormously — the lock becomes the bottleneck. Compare to atomics, which scale much better.

### Variation 4: One goroutine increments, one reads

```go
go func() {
    for i := 0; i < 1_000_000; i++ {
        count++
    }
}()
go func() {
    for {
        if count >= 1_000_000 {
            break
        }
    }
}()
```

The reader may never see `1_000_000` because the writer's updates may stay in its cache forever. With `-race`, this is flagged immediately. Even without `-race`, on weakly-ordered architectures (ARM) the reader can deadlock. The fix is the same: `atomic`.

---

## Deeper Dive: When `int32` Is Enough

If your counter genuinely fits in 31 bits (a counter that resets every second and counts at most a few million events), `atomic.Int32` is a bit cheaper on 32-bit ARM and identical on x86-64. It also gives you slightly clearer intent: "this never gets big."

Most counters do not benefit. `atomic.Int64` is the default for a reason — `int64` math is free on 64-bit architectures, overflow is functionally impossible for normal workloads, and you do not have to think about it.

---

## Deeper Dive: Counter vs Generation Number

A related pattern: the "generation number" or "version stamp". Each time some structure changes, bump an atomic counter. Readers compare before/after to detect concurrent modification:

```go
type SeqCounter struct{ g atomic.Uint64 }

func (s *SeqCounter) Bump() uint64   { return s.g.Add(1) }
func (s *SeqCounter) Current() uint64 { return s.g.Load() }
```

This is the foundation of *seqlocks* (a senior topic) and of many lock-free read paths. The atomic counter is the primitive; the seqlock is the algorithm built on top.

---

## Deeper Dive: Counters in Standard Library Code

If you grep the Go standard library for `atomic.Int64`, you find dozens of places where the runtime uses exactly the pattern this file teaches. Some examples:

- `net/http`: `Server.inFlight` is an atomic counter of in-flight requests.
- `runtime/metrics`: many internal counters expose stop-the-world durations, GC pause counts, and goroutine counts.
- `database/sql`: `DB.numClosed` and various connection-state counters.
- `expvar`: every `expvar.Int` is an `atomic.Int64` underneath.
- `sync/atomic` tests: every micro-benchmark for atomic ops is itself a counter.

Reading any of these is a quick way to internalise the idioms.

---

## Deeper Dive: Counters and Context Cancellation

A subtle pattern: when a request is cancelled, do you decrement the in-flight gauge?

```go
func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {
    s.inflight.Add(1)
    defer s.inflight.Add(-1) // always
    select {
    case <-r.Context().Done():
        return
    case res := <-s.process(r):
        write(w, res)
    }
}
```

`defer` runs whether the context cancels or not. The gauge stays consistent. If you put the decrement only in the success path, cancellation will leak the gauge upward forever — a very common production bug.

---

## Deeper Dive: Counters in Benchmark Code

When you write a Go benchmark, `b.N` is itself a counter the framework manages. Inside the benchmark, your counters should be reset between iterations:

```go
func BenchmarkCounter(b *testing.B) {
    var c atomic.Int64
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Add(1)
        }
    })
    if c.Load() != int64(b.N) {
        b.Fatalf("expected %d, got %d", b.N, c.Load())
    }
}
```

Run with: `go test -bench=BenchmarkCounter -cpu=1,4,16` to see how the same counter scales with parallelism. Spoiler: it does not, very much, and the senior file explains why.

---

## Final Word for Juniors

Memorise these three lines and you have 90% of what you need:

```go
var c atomic.Int64
c.Add(1)
v := c.Load()
```

Use `-race`. Always.

That is it. Build something. The middle file will be waiting when contention starts to bite.

---

## Extended Walkthrough: Building a Real Request Counter Step-by-Step

Let us walk through building a request counter for a real HTTP server, from naive to safe to fast, watching each version's behaviour in detail.

### Step 1: The naive version

```go
package main

import (
    "fmt"
    "net/http"
)

var requests int

func handler(w http.ResponseWriter, r *http.Request) {
    requests++
    fmt.Fprintf(w, "request %d", requests)
}

func metrics(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "total = %d", requests)
}

func main() {
    http.HandleFunc("/", handler)
    http.HandleFunc("/metrics", metrics)
    http.ListenAndServe(":8080", nil)
}
```

Hammer it with `wrk -c 64 -t 8 -d 10s http://localhost:8080/`. Then call `/metrics`. The number you see will be *lower* than the actual number of requests served, because the increments are racing with each other. The Go race detector run (`go run -race main.go`) will be screaming.

### Step 2: Add a mutex

```go
var (
    mu       sync.Mutex
    requests int
)

func handler(w http.ResponseWriter, r *http.Request) {
    mu.Lock()
    requests++
    cur := requests
    mu.Unlock()
    fmt.Fprintf(w, "request %d", cur)
}

func metrics(w http.ResponseWriter, r *http.Request) {
    mu.Lock()
    cur := requests
    mu.Unlock()
    fmt.Fprintf(w, "total = %d", cur)
}
```

Notice the patterns:

- Read into a local under the lock, *then* release the lock, *then* format the response. Holding a lock during `fmt.Fprintf` would serialise every request on the lock.
- The local `cur` cannot change after the unlock, so we can use it freely.

`-race` is silent now. But under heavy load you will see lock contention show up in `go tool pprof` as time spent in `sync.(*Mutex).Lock`.

### Step 3: Switch to atomic

```go
var requests atomic.Int64

func handler(w http.ResponseWriter, r *http.Request) {
    cur := requests.Add(1)
    fmt.Fprintf(w, "request %d", cur)
}

func metrics(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "total = %d", requests.Load())
}
```

Three lines shorter, much faster, still correct. The `Add(1)` returns the new value, so you do not need a separate `Load`.

### Step 4: What we have NOT yet solved

If your server runs on 64 cores and every request increments the *same* `atomic.Int64`, the cache line holding `requests` ping-pongs between all 64 cores. Throughput collapses as you add cores. The senior file solves this with sharded counters. For most workloads — say, anything under a million RPS per machine — the single atomic is fine. Past that, you need to know about cache lines.

### Step 5: Adding a gauge for in-flight requests

```go
var (
    requests atomic.Int64
    inflight atomic.Int64
)

func handler(w http.ResponseWriter, r *http.Request) {
    requests.Add(1)
    inflight.Add(1)
    defer inflight.Add(-1)
    // ... do work
}

func metrics(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "total=%d inflight=%d", requests.Load(), inflight.Load())
}
```

Two counters, two `atomic.Int64`s, no lock anywhere. This is the standard shape of a modern Go service's metrics block.

### Step 6: Per-route counters

What if you want a separate counter per route? Tempting:

```go
var routeCounts = make(map[string]*atomic.Int64)
```

But `map` writes are not concurrency-safe. You must protect it:

```go
type Counters struct {
    mu     sync.RWMutex
    routes map[string]*atomic.Int64
}

func (c *Counters) Inc(route string) {
    c.mu.RLock()
    cnt, ok := c.routes[route]
    c.mu.RUnlock()
    if ok {
        cnt.Add(1)
        return
    }
    c.mu.Lock()
    defer c.mu.Unlock()
    if cnt, ok := c.routes[route]; ok {
        cnt.Add(1)
        return
    }
    cnt = &atomic.Int64{}
    c.routes[route] = cnt
    cnt.Add(1)
}
```

The double-checked locking pattern minimises write-lock acquisitions. Or you can use `sync.Map`:

```go
type Counters struct {
    m sync.Map // map[string]*atomic.Int64
}

func (c *Counters) Inc(route string) {
    v, ok := c.m.Load(route)
    if !ok {
        v, _ = c.m.LoadOrStore(route, &atomic.Int64{})
    }
    v.(*atomic.Int64).Add(1)
}
```

`sync.Map.LoadOrStore` returns the existing value if there is one, or stores and returns the new one. It is a textbook atomic compare-and-swap for maps.

For dynamic per-key counters at high cardinality, `sync.Map` plus `atomic.Int64` is the standard idiom.

### Step 7: Exposing through `expvar`

The standard library has a built-in metric endpoint at `/debug/vars`. Counters registered with `expvar.NewInt` show up there automatically:

```go
import "expvar"

var requests = expvar.NewInt("requests")
var inflight = expvar.NewInt("inflight")

func handler(w http.ResponseWriter, r *http.Request) {
    requests.Add(1)
    inflight.Add(1)
    defer inflight.Add(-1)
}
```

Now `curl http://localhost:8080/debug/vars` returns a JSON blob with `requests` and `inflight` (and a bunch of runtime metrics for free). This is the cheapest way to add a metrics endpoint to a Go service. The middle file covers `expvar` in depth.

---

## Extended Walkthrough: Counters in a Worker Pool

Picture a worker pool consuming jobs from a channel. You want:

- A counter of jobs processed
- A counter of errors
- A gauge of currently-running jobs
- A counter per error class

Here is the whole thing, idiomatic and correct:

```go
package pool

import (
    "context"
    "sync"
    "sync/atomic"
)

type Stats struct {
    Processed atomic.Int64
    Errors    atomic.Int64
    Running   atomic.Int64
    byClass   sync.Map // map[string]*atomic.Int64
}

func (s *Stats) incClass(class string) {
    if v, ok := s.byClass.Load(class); ok {
        v.(*atomic.Int64).Add(1)
        return
    }
    v, _ := s.byClass.LoadOrStore(class, &atomic.Int64{})
    v.(*atomic.Int64).Add(1)
}

func (s *Stats) ClassCount(class string) int64 {
    if v, ok := s.byClass.Load(class); ok {
        return v.(*atomic.Int64).Load()
    }
    return 0
}

type Pool struct {
    Stats Stats
    jobs  chan Job
    wg    sync.WaitGroup
}

type Job interface {
    Do(ctx context.Context) error
}

func New(workers int) *Pool {
    p := &Pool{jobs: make(chan Job, 1024)}
    p.wg.Add(workers)
    for i := 0; i < workers; i++ {
        go p.worker()
    }
    return p
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for j := range p.jobs {
        p.Stats.Running.Add(1)
        err := j.Do(context.Background())
        p.Stats.Running.Add(-1)
        p.Stats.Processed.Add(1)
        if err != nil {
            p.Stats.Errors.Add(1)
            p.Stats.incClass(errorClass(err))
        }
    }
}

func (p *Pool) Submit(j Job) { p.jobs <- j }
func (p *Pool) Close()       { close(p.jobs); p.wg.Wait() }

func errorClass(err error) string {
    // simplified
    return err.Error()
}
```

Every counter in there is `atomic.Int64`. No mutex. The only synchronisation is the channel and the `sync.Map`. This pattern scales linearly to hundreds of workers because nobody is contending on a single lock.

If you needed even more scale, you would shard the counters by worker ID — but the senior file covers that.

---

## Extended Walkthrough: Failing Tests You Can Write

Writing a test that demonstrates a race is harder than it sounds, because races are timing-dependent. Here are reliable techniques.

### Technique 1: many goroutines, many iterations

```go
func TestRaceBait(t *testing.T) {
    var count int
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 1000; j++ {
                count++
            }
        }()
    }
    wg.Wait()
    if count != 1_000_000 {
        t.Errorf("races dropped %d", 1_000_000-count)
    }
}
```

Run with `go test -race`. The race detector will fire immediately; the assertion will *also* fire often, even without `-race`, because the increments truly are being lost.

### Technique 2: a sleep between read and write

```go
go func() {
    cur := count
    time.Sleep(time.Microsecond)
    count = cur + 1
}()
```

Now you have a hand-rolled, guaranteed race. Useful for teaching, not for production.

### Technique 3: `runtime.Gosched()` injection

`runtime.Gosched()` is a hint to the scheduler "let other goroutines run". Inserting it between read and write opens the race window without using a sleep.

```go
go func() {
    cur := count
    runtime.Gosched()
    count = cur + 1
}()
```

### Technique 4: GODEBUG=gctrace=1

Garbage collection pauses can change scheduling and may surface races that otherwise stay hidden. Run with `GODEBUG=gctrace=1` to interleave GC events with your code.

### Technique 5: the `stress` tool

```
go install golang.org/x/tools/cmd/stress@latest
go test -race -c -o tests
stress ./tests
```

`stress` runs your test binary in a loop, in parallel, until it fails. Catches races that hit only one in a thousand runs.

---

## Extended Walkthrough: A Day in the Life of an Increment

Let us trace exactly what happens when you call `count.Add(1)` on a modern multi-core x86-64 machine, starting from the Go source line and ending with the cache coherence protocol updating the L3 cache.

1. **Compiler emits an `XADD` with a `LOCK` prefix.** The Go compiler knows `(*atomic.Int64).Add` and lowers it to one machine instruction. No function call overhead; the call is inlined.

2. **CPU decode.** The instruction enters the CPU pipeline. The decoder sees `LOCK XADD` and routes it to the memory subsystem with the lock prefix set.

3. **Cache line fetch.** The address of `count` lives in some cache line of L1 or L2. If it is not present, the cache controller issues a request to L2/L3 to bring it in. If another core has the line in *Modified* state, that core must write back (or transfer) the line first. This is the MESI/MOESI cache coherence protocol in action.

4. **Cache line lock.** The cache controller marks the line as exclusively owned. No other core may read or write it until this instruction completes.

5. **Atomic add.** The CPU reads the value, adds 1, writes back, and (with `XADD`) returns the *previous* value in the register. All as one indivisible step from any other core's perspective.

6. **Cache line release.** The exclusive lock is released. Other cores can now request the line.

7. **Return to your Go code.** The result is back in your goroutine's register, ready for the next instruction.

Total latency: 10–50 nanoseconds on a quiet machine, climbing to hundreds of nanoseconds under contention. Throughput per core: tens of millions of ops per second. Across many cores hammering the same address: the cache line ping-pongs and throughput per core falls to a few hundred thousand ops per second.

This is the universe `atomic.Int64.Add` lives in. It looks like a free function call. It is anything but.

---

## Extended Q&A: Things Juniors Actually Ask

**Q: Should I prefer `atomic.Uint64` for counters because they are never negative?**

A: Tempting but no. `atomic.Int64` has the same operations plus `Add(-1)`, plus easier-to-read decrement semantics. The negative range is wasted, but in 64 bits you can afford it. Reach for `Uint64` only if you genuinely need unsigned arithmetic (e.g., wraparound modular arithmetic for hash mixing).

**Q: Why is the `expvar.Int` type a struct wrapper around `int64` instead of just being `atomic.Int64`?**

A: Historical. `expvar` predates `atomic.Int64` by a decade. The wrapper also adds an `Add(int64)` method that returns nothing (matching the older API style) and a `String()` method for JSON serialisation. Internally it uses `atomic.AddInt64` and `atomic.LoadInt64`.

**Q: Can I use `sync.Atomic` instead of `sync/atomic`?**

A: No. The package is `sync/atomic`, accessed as `atomic`. There is no `sync.Atomic` symbol.

**Q: Does the Go race detector slow my program down?**

A: Yes — typically 2–10× slower and 5–10× more memory. That is why you use it in tests and CI, not in production. Modern projects run their entire test suite under `-race` in CI as a matter of course.

**Q: My counter occasionally returns an old value. Bug?**

A: If you are using `atomic.Int64`, no — every `Load` is sequentially consistent. You may be reading at a slightly different moment than you think. Print timestamps to verify ordering. If you are *not* using atomic, every read is a coin flip.

**Q: I want to count requests per minute. Should I have 60 atomic counters?**

A: Not quite. The classic structure is a ring buffer of one counter per second (or per minute), with a current-time index. Increment the slot for "now", report the sum of recent slots. The shard-by-time idea generalises beautifully to sliding windows. Middle/senior topic.

**Q: Are atomic ops safe across goroutines on different machines?**

A: No. They are CPU-level instructions; they do not cross machine boundaries. For cross-machine counters use a database `INCREMENT`, Redis `INCR`, or a dedicated counter service.

**Q: Can I `atomic.AddInt64(&x, -1)` to decrement?**

A: Yes — the second argument is an `int64` delta, signed. Pass `-1`. Works the same way on `atomic.Int64.Add(-1)`.

**Q: Is `atomic.LoadInt64` safer than reading the variable directly because of the memory barrier?**

A: Yes — it is the only correct way to read a value that any other goroutine has atomic-written. Direct reads may see stale values (most architectures) or torn values (32-bit ARM).

**Q: Should I document my counter as monotonic in the type system?**

A: Some teams have a `MonotonicCounter` type with no `Dec` or `Add(-1)` methods to enforce it at compile time. Others rely on convention. Either is fine.

**Q: What if I want a counter that wraps at some N?**

A: Use `CompareAndSwap`:

```go
func (c *WrappingCounter) Inc() int64 {
    for {
        cur := c.v.Load()
        next := (cur + 1) % c.modulus
        if c.v.CompareAndSwap(cur, next) {
            return next
        }
    }
}
```

The CAS loop is your first taste of lock-free programming. Middle topic.

---

## Walkthrough: Reading `expvar.Int` Source

Reading well-written standard library source is one of the best ways to absorb idioms. Here is the gist of `expvar.Int` (paraphrased and shortened):

```go
type Int struct {
    i atomic.Int64
}

func (v *Int) Value() int64 { return v.i.Load() }
func (v *Int) String() string {
    return strconv.FormatInt(v.i.Load(), 10)
}
func (v *Int) Add(delta int64) { v.i.Add(delta) }
func (v *Int) Set(value int64) { v.i.Store(value) }
```

That is it. A four-method struct wrapping an `atomic.Int64`, plus the `String()` method that makes it serialise as JSON. The whole "expvar counter" abstraction is this.

The other half is the registry: `expvar.NewInt(name string)` allocates an `Int`, stores it in a global map keyed by name, and returns the pointer. Then `/debug/vars` walks the map and serialises everything. Trivial code, enormous operational value. Middle file covers it in depth.

---

## Walkthrough: Reading `sync.WaitGroup` Source (How Atomic Counters Build Bigger Things)

You already know `WaitGroup`. Look at it from a counter angle:

```go
type WaitGroup struct {
    noCopy noCopy
    state  atomic.Uint64 // high 32 bits: counter; low 32 bits: waiters
    sema   uint32
}

func (wg *WaitGroup) Add(delta int) {
    state := wg.state.Add(uint64(delta) << 32)
    v := int32(state >> 32)
    w := uint32(state)
    if v < 0 {
        panic("sync: negative WaitGroup counter")
    }
    if w != 0 && delta > 0 && v == int32(delta) {
        panic("sync: WaitGroup misuse: Add called concurrently with Wait")
    }
    if v > 0 || w == 0 {
        return
    }
    // last decrement; release all waiters
    runtime_Semrelease(&wg.sema, false, 0)
}
```

Key takeaways:

- A `WaitGroup` is, fundamentally, two counters packed into one `atomic.Uint64` so they can be updated together atomically.
- `Add` is a single `atomic.Uint64.Add` plus some inspection of the result.
- The whole synchronisation guarantee of `WaitGroup` rests on the atomic counter.

When you read standard library code with the question "where are the counters?" in mind, you find them everywhere. They are the load-bearing primitive of concurrent Go.

---

## Closing Thought

A counter looks like nothing. A correct counter is a small lesson in CPU architecture, the Go memory model, and operational discipline. A *fast* counter is a much bigger lesson — it is what the next three files (middle, senior, professional) are about. Master the simple case here and the rest will land easily.

Always:

- `atomic.Int64` for new counters.
- `defer Add(-1)` for gauges.
- `-race` in every test run.
- Pointer receivers.
- Wrapping types.
- Document units.

The middle file picks up with `CompareAndSwap`, `expvar`, and the multi-counter coordination problem. See you there.

---

## Appendix A: A Long Side-by-Side Comparison

Suppose you have a service that wants to expose `requests_total` and `inflight_requests`. Here are five versions of the same code, in increasing sophistication.

### Version 1: broken

```go
var requests int
var inflight int

func handler(w http.ResponseWriter, r *http.Request) {
    requests++
    inflight++
    defer func() { inflight-- }()
    process(r)
}
```

Three races: `requests++`, `inflight++`, `inflight--`. All silently dropping increments. Never ship.

### Version 2: mutex per counter

```go
var (
    reqMu sync.Mutex
    requests int
    inMu sync.Mutex
    inflight int
)

func handler(w http.ResponseWriter, r *http.Request) {
    reqMu.Lock(); requests++; reqMu.Unlock()
    inMu.Lock(); inflight++; inMu.Unlock()
    defer func() {
        inMu.Lock(); inflight--; inMu.Unlock()
    }()
    process(r)
}
```

Correct, but verbose. Two locks for two counters. Imagine ten counters: ten locks, twenty Lock/Unlock pairs per request. Tedious and slow.

### Version 3: one mutex over both

```go
var (
    mu sync.Mutex
    requests int
    inflight int
)

func handler(w http.ResponseWriter, r *http.Request) {
    mu.Lock()
    requests++
    inflight++
    mu.Unlock()
    defer func() {
        mu.Lock(); inflight--; mu.Unlock()
    }()
    process(r)
}
```

Correct, fewer locks, but worse contention — every request blocks every other request on the same lock. Acceptable at low RPS, catastrophic at high.

### Version 4: atomics

```go
var (
    requests atomic.Int64
    inflight atomic.Int64
)

func handler(w http.ResponseWriter, r *http.Request) {
    requests.Add(1)
    inflight.Add(1)
    defer inflight.Add(-1)
    process(r)
}
```

Correct, fast, zero lock contention, three lines, easy to read.

### Version 5: `expvar`

```go
var (
    requests = expvar.NewInt("requests")
    inflight = expvar.NewInt("inflight")
)

func handler(w http.ResponseWriter, r *http.Request) {
    requests.Add(1)
    inflight.Add(1)
    defer inflight.Add(-1)
    process(r)
}
```

Same speed as version 4, plus you get a free `/debug/vars` endpoint. This is the production-ready, idiomatic Go shape. Use it.

---

## Appendix B: A Long List of Counter Names That Tell Operators What They Mean

Names matter. A counter called `errors` tells the operator nothing. Here are names that do.

| Field name | Meaning | Unit | Direction |
|-----------|---------|------|-----------|
| `requests_total` | All requests served | requests | up only |
| `requests_2xx_total` | Successful requests | requests | up only |
| `requests_4xx_total` | Client-error requests | requests | up only |
| `requests_5xx_total` | Server-error requests | requests | up only |
| `inflight_requests` | Currently-handling requests | requests | up & down |
| `bytes_in_total` | Bytes received from clients | bytes | up only |
| `bytes_out_total` | Bytes sent to clients | bytes | up only |
| `connections_accepted_total` | Sockets accepted | connections | up only |
| `connections_closed_total` | Sockets closed cleanly | connections | up only |
| `connections_open` | Currently-open sockets | connections | up & down |
| `db_queries_total` | DB queries issued | queries | up only |
| `db_query_errors_total` | DB queries that errored | queries | up only |
| `cache_hits_total` | Cache reads that hit | reads | up only |
| `cache_misses_total` | Cache reads that missed | reads | up only |
| `goroutines` | runtime.NumGoroutine() snapshot | goroutines | up & down |
| `heap_bytes` | runtime.MemStats.HeapAlloc | bytes | up & down |
| `gc_pause_ns_total` | sum of GC pauses | ns | up only |
| `panics_total` | recovered panics | panics | up only |

A junior who internalises this naming convention writes code that operators thank them for.

---

## Appendix C: Counters as Building Blocks for Higher-Level Patterns

Once you have a fast atomic counter, you can build:

- **Sequence numbers**: each call returns a unique, monotonically increasing ID.
- **Token buckets**: a counter holding "tokens" plus a refill ticker — the simplest rate limiter.
- **CountDownLatch**: a counter that starts at N, decrements as workers finish, and signals when it hits zero.
- **Reference counting**: increment when a reference is acquired, decrement when released, free when zero.
- **Reader/writer count for a seqlock**: writers bump the counter twice (odd before, even after); readers check parity.
- **Heartbeat counter**: bumped by a background goroutine, read by a watchdog; if it stops changing, something is stuck.
- **Lock-free queue index**: head and tail counters, with the queue being `slots[index % len]`.
- **GC tick counter**: each minor cycle increments; consumers detect epochs by reading the value.

Every one of these is a senior or professional topic in its own right. They all start with the same `atomic.Int64.Add(1)`.

---

## Appendix D: A Long Bug Story

This is a true story, slightly anonymised. A service team had a counter called `failed_logins`. They used `int32`, no atomic, no mutex. For two years it appeared to work — the numbers were always plausible. Then they added a feature that ran `failed_logins` through an alert: if the rate exceeded 100 per minute, page the on-call.

The alerts never fired. Reviewers eventually noticed that `failed_logins` *only ever decreased on Mondays*. After hours of investigation, the bug was:

- Friday afternoon, traffic spike, lots of failed logins, counter races up to ~5,000.
- Monday morning, a cron job snapshot of the counter recorded the value... but the cron ran with `GODEBUG=cpuid.SSE2=off` for unrelated reasons. The `int32` was decremented *twice* by the snapshot code because of a separate cpu-bug workaround that read-modified-wrote the variable.
- The snapshot also reset the counter, but the reset was a plain `failed_logins = 0` which raced with new increments, sometimes losing them.

The team replaced the counter with `atomic.Int64`, added a `Swap(0)` for snapshots, and added alerts based on `Swap`'s return value. Alerts started firing within an hour. The bug had been invisible for two years because the *value* of the counter was wrong, not because it crashed.

Moral: a counter that looks plausible is not the same as a counter that is correct. Always atomic. Always tested with `-race`. Always snapshot with `Swap`, not `Load + Store`.

---

## Appendix E: Things You Will Read That Are Subtly Wrong

The internet has a lot of Go code that is *almost* right about counters. Here are warning signs.

### "Just use `int64`, reads and writes are atomic on 64-bit."

Half true. On a 64-bit machine, an aligned `int64` *load* compiled to a single `MOV` is atomic at the hardware level. But:

- The Go *compiler* does not promise to emit a single `MOV`. It may split or reorder.
- On 32-bit ARM, an `int64` is two 32-bit accesses.
- The race detector will flag it.
- Even if no torn read occurs, there is no memory barrier; readers may see stale values.

Always use `atomic.LoadInt64` / `atomic.Int64.Load`.

### "Mutexes are slower than atomics, so always use atomics."

A simplification. For a single counter, atomics are faster. For a *group* of related state, a single mutex is often faster than multiple atomic-fenced operations, because you avoid the multiple atomic instructions. Measure.

### "Cache lines do not matter at low concurrency."

True up to a point — say, a single counter incremented by 4 cores at moderate rate. False at higher core counts or higher rates. The transition happens earlier than you think; senior file explores it.

### "`atomic.Value` is for atomic counters."

No. `atomic.Value` (and its generic successor `atomic.Pointer[T]`) is for atomic *snapshots* of arbitrary types — you replace the whole value, you do not increment it. For counters, `atomic.Int64`/`Uint64`.

### "I do not need `defer` on the gauge because my code never panics."

Code panics. Always. Even production code. Especially production code on Friday afternoon. Always `defer`.

### "Atomic ops are lock-free, so they never block."

The instruction itself does not put the goroutine to sleep. But under heavy contention, the cache coherence traffic causes the CPU pipeline to stall — equivalent to blocking, just not in software terms. Atomics are *not blocked* but they are *not free*.

---

## Appendix F: Frequently Re-Visited Idioms

Bookmark these. You will write them dozens of times in your career.

### Counter increment

```go
c.Add(1)
```

### Counter snapshot

```go
n := c.Load()
```

### Gauge increment/decrement around work

```go
g.Add(1)
defer g.Add(-1)
```

### Read-and-reset (for periodic flush)

```go
prev := c.Swap(0)
```

### First arrival sentinel

```go
if c.CompareAndSwap(0, 1) { /* first */ }
```

### Maximum tracker

```go
for {
    cur := m.Load()
    if x <= cur { break }
    if m.CompareAndSwap(cur, x) { break }
}
```

### Counter per dynamic key

```go
v, _ := counts.LoadOrStore(key, &atomic.Int64{})
v.(*atomic.Int64).Add(1)
```

### Counter exposed via `expvar`

```go
var requests = expvar.NewInt("requests")
requests.Add(1)
```

That is the junior counter toolkit, complete. Build, ship, iterate, and graduate to middle when you start asking "but why is my counter slow at 32 cores?"

---

## Appendix G: Walkthrough of Real Production Counter Code

Here is a sketch of counter code from a real-world Go service (sanitised). Annotate each line with what it teaches.

```go
package server

import (
    "context"
    "expvar"
    "net/http"
    "sync/atomic"
    "time"
)

var (
    // Monotonic counters — only ever increase. Exposed via expvar.
    requestsTotal = expvar.NewInt("server_requests_total")
    errors4xxTotal = expvar.NewInt("server_errors_4xx_total")
    errors5xxTotal = expvar.NewInt("server_errors_5xx_total")
    bytesInTotal   = expvar.NewInt("server_bytes_in_total")
    bytesOutTotal  = expvar.NewInt("server_bytes_out_total")
    // Gauges — go up and down. Note: NOT suffixed _total.
    inflight = expvar.NewInt("server_inflight")
    // Sentinel — set once when shutdown begins.
    draining atomic.Bool
)

type Server struct {
    h http.Handler
}

func New(h http.Handler) *Server { return &Server{h: h} }

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    if draining.Load() {
        // Refuse new work during graceful shutdown.
        http.Error(w, "draining", http.StatusServiceUnavailable)
        return
    }

    // Count *every* request, before any conditional logic.
    requestsTotal.Add(1)

    // Track in-flight with the defer pattern. If anything below
    // panics, the deferred decrement still runs.
    inflight.Add(1)
    defer inflight.Add(-1)

    // bytesInTotal: count what the client sent us. Use the
    // Content-Length header if available; otherwise wrap the
    // body in a counting reader (omitted here for brevity).
    if r.ContentLength > 0 {
        bytesInTotal.Add(r.ContentLength)
    }

    // Wrap the writer to count the response status and bytes.
    rw := &countingWriter{ResponseWriter: w}
    s.h.ServeHTTP(rw, r)

    // After the handler returns, sort the status into a counter.
    switch {
    case rw.status >= 500:
        errors5xxTotal.Add(1)
    case rw.status >= 400:
        errors4xxTotal.Add(1)
    }
    bytesOutTotal.Add(int64(rw.bytes))
}

type countingWriter struct {
    http.ResponseWriter
    status int
    bytes  int
}

func (c *countingWriter) WriteHeader(s int) {
    c.status = s
    c.ResponseWriter.WriteHeader(s)
}

func (c *countingWriter) Write(b []byte) (int, error) {
    if c.status == 0 {
        c.status = http.StatusOK
    }
    n, err := c.ResponseWriter.Write(b)
    c.bytes += n
    return n, err
}

func (s *Server) Shutdown(ctx context.Context) error {
    draining.Store(true)
    deadline := time.Now().Add(30 * time.Second)
    for {
        if inflight.Value() == 0 {
            return nil
        }
        if time.Now().After(deadline) {
            return ctx.Err()
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(50 * time.Millisecond):
        }
    }
}
```

Things to notice:

1. **Counter names match the metric names.** `requestsTotal` is the variable for `server_requests_total`. Easy to grep production alerts back to code.
2. **The `_total` suffix is reserved for monotonic counters.** Gauges (`inflight`) do not get it.
3. **Drain check first.** No counter increment for refused requests — they are not "served".
4. **`defer Add(-1)` for the gauge.** Panic-safe.
5. **Counting is done in the wrapper, not in the handler.** The handler does not know about metrics; the server does.
6. **Shutdown loops on `Value() == 0`.** The atomic counter is the heart of graceful shutdown.

This is what idiomatic, production-quality Go counter usage looks like. Junior engineers who internalise this template will write good metrics code on day one of every job.

---

## Appendix H: Counters and the Question of Sampling

At very high RPS — say, 1M+ requests per second — even an atomic counter can become a bottleneck *per core*. One mitigation: do not increment every time; increment with some probability and scale up at read time.

```go
const sample = 100 // 1 in 100

func handler(...) {
    if rand.IntN(sample) == 0 {
        c.Add(int64(sample))
    }
}

// reading: c.Load() approximates the true count
```

Two things to keep in mind:

- This introduces sampling error of roughly sqrt(N/sample). For a true count of 1,000,000 with sample=100, expected error ~316.
- `rand.IntN` itself contends on a global RNG (the older `math/rand`) or is goroutine-local (`math/rand/v2`). Use v2.

For most workloads, sampling is unnecessary — atomic.Int64 keeps up fine. For the few workloads where it does not, the senior file's sharded-counter approach is usually better than sampling because it preserves exact counts.

---

## Appendix I: Counters in Tests vs Production

A counter that lives only in your test should *still* use `atomic.Int64`. It is the same primitive, and the race detector treats it the same.

```go
func TestEventBus_FanOut(t *testing.T) {
    bus := NewBus()
    var calls atomic.Int64
    bus.Subscribe(func(e Event) { calls.Add(1) })
    for i := 0; i < 1000; i++ {
        bus.Publish(Event{})
    }
    bus.Wait()
    if got := calls.Load(); got != 1000 {
        t.Errorf("expected 1000, got %d", got)
    }
}
```

The principle "if more than one goroutine writes it, atomic" applies just as strongly in tests. Tests that race are flaky tests, and flaky tests destroy CI trust.

---

## Appendix J: When to Read the Standard Library

Whenever you find yourself wondering "is this the right way to do X with counters?", grep the standard library for `atomic.Int64`. The Go authors are excellent practitioners; their patterns are usually the right ones to copy.

```
$ grep -rn "atomic.Int64" $(go env GOROOT)/src | head -20
```

You will find counters in:

- `net/http` (server bookkeeping)
- `database/sql` (connection pool stats)
- `runtime/metrics` (everything)
- `testing` (parallel test scheduling)
- `expvar` (every `Int` is one)
- `time` (timer firings and resets)

Read them. They are excellent examples.

---

## Truly Final Word

A counter is small. The lessons are large. Go forth, increment safely, and run `-race`.

When you start measuring increments per second and find them disappointing, the middle and senior files are waiting for you. But you do not need them yet. Build something first.

---

## Appendix K: Building a Counter Library From Scratch (Exercise Walkthrough)

To consolidate, build a tiny `counters` package from scratch. It should expose:

- `Counter` — monotonic
- `Gauge` — up & down
- `Max` — tracks the largest observed value
- `Min` — tracks the smallest (skip if always positive)
- A `Registry` that holds named counters and can dump them as JSON

```go
package counters

import (
    "encoding/json"
    "math"
    "sync"
    "sync/atomic"
)

type Counter struct{ v atomic.Int64 }

func (c *Counter) Inc()            { c.v.Add(1) }
func (c *Counter) Add(n int64)     { c.v.Add(n) }
func (c *Counter) Get() int64      { return c.v.Load() }
func (c *Counter) Reset() int64    { return c.v.Swap(0) }

type Gauge struct{ v atomic.Int64 }

func (g *Gauge) Inc()         { g.v.Add(1) }
func (g *Gauge) Dec()         { g.v.Add(-1) }
func (g *Gauge) Add(n int64)  { g.v.Add(n) }
func (g *Gauge) Set(n int64)  { g.v.Store(n) }
func (g *Gauge) Get() int64   { return g.v.Load() }

type Max struct{ v atomic.Int64 }

func (m *Max) Observe(x int64) {
    for {
        cur := m.v.Load()
        if x <= cur {
            return
        }
        if m.v.CompareAndSwap(cur, x) {
            return
        }
    }
}
func (m *Max) Get() int64 { return m.v.Load() }

type Min struct{ v atomic.Int64 }

func NewMin() *Min {
    var m Min
    m.v.Store(math.MaxInt64)
    return &m
}
func (m *Min) Observe(x int64) {
    for {
        cur := m.v.Load()
        if x >= cur {
            return
        }
        if m.v.CompareAndSwap(cur, x) {
            return
        }
    }
}
func (m *Min) Get() int64 { return m.v.Load() }

type Registry struct {
    mu sync.RWMutex
    m  map[string]any
}

func New() *Registry { return &Registry{m: map[string]any{}} }

func (r *Registry) MustRegister(name string, v any) {
    r.mu.Lock()
    defer r.mu.Unlock()
    if _, ok := r.m[name]; ok {
        panic("counters: duplicate name: " + name)
    }
    r.m[name] = v
}

func (r *Registry) JSON() ([]byte, error) {
    r.mu.RLock()
    defer r.mu.RUnlock()
    out := make(map[string]int64, len(r.m))
    for name, v := range r.m {
        switch t := v.(type) {
        case *Counter:
            out[name] = t.Get()
        case *Gauge:
            out[name] = t.Get()
        case *Max:
            out[name] = t.Get()
        case *Min:
            out[name] = t.Get()
        }
    }
    return json.Marshal(out)
}
```

Test it:

```go
package counters

import (
    "sync"
    "testing"
)

func TestCounter(t *testing.T) {
    var c Counter
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); for j := 0; j < 1000; j++ { c.Inc() } }()
    }
    wg.Wait()
    if got := c.Get(); got != 100_000 {
        t.Errorf("expected 100000, got %d", got)
    }
}

func TestMax(t *testing.T) {
    var m Max
    var wg sync.WaitGroup
    for i := int64(0); i < 1000; i++ {
        i := i
        wg.Add(1)
        go func() { defer wg.Done(); m.Observe(i) }()
    }
    wg.Wait()
    if got := m.Get(); got != 999 {
        t.Errorf("expected 999, got %d", got)
    }
}

func TestRegistryJSON(t *testing.T) {
    r := New()
    c := &Counter{}
    g := &Gauge{}
    r.MustRegister("requests", c)
    r.MustRegister("inflight", g)
    c.Add(5)
    g.Set(3)
    b, err := r.JSON()
    if err != nil { t.Fatal(err) }
    if string(b) != `{"inflight":3,"requests":5}` && string(b) != `{"requests":5,"inflight":3}` {
        t.Errorf("unexpected: %s", b)
    }
}
```

Run with `-race -count=10`. You now have:

- Two simple atomic types (Counter, Gauge)
- Two CAS-loop atomic types (Max, Min)
- A registry pattern (the foundation of `expvar`, Prometheus, OpenTelemetry, etc.)
- JSON output (the foundation of `/debug/vars`)

You wrote your own `expvar`. Read its source after this exercise — you will recognise almost everything.

---

## Appendix L: A Truly Final Cheat Card

```
+-------------------------------------------------------------+
| ATOMIC COUNTERS - 60 SECOND SUMMARY                         |
+-------------------------------------------------------------+
| Declare:    var c atomic.Int64                              |
| Inc:        c.Add(1)                                         |
| Dec:        c.Add(-1)                                        |
| Read:       c.Load()                                         |
| Reset:      c.Swap(0)                                        |
| CAS:        c.CompareAndSwap(old, new)                       |
|                                                             |
| Wrap:       type MyCounter struct{ v atomic.Int64 }          |
| Pointer:    use *MyCounter receivers                         |
| Gauge:      g.Add(1); defer g.Add(-1)                        |
| Test:       go test -race -count=10                          |
| expvar:     var c = expvar.NewInt("name")                    |
+-------------------------------------------------------------+
```

Print it. Tape it to your monitor. Refer to it for one week. After that you will not need to.

---

## Appendix M: Twenty Tiny Programs to Write

Each of these is a 20–50-line program that exercises one counter idea. Doing them all will give you fluency.

1. Spawn 1,000 goroutines that each `count++` a plain `int`. Print the result. Run 10 times.
2. Do (1) again with a `sync.Mutex`. Confirm the answer is always 1,000.
3. Do (1) again with `atomic.Int64`. Confirm. Benchmark vs (2).
4. Do (3) but with `atomic.AddInt64(&x, 1)` (old API). Confirm and compare assembly with `go build -gcflags=-S`.
5. Write a server that increments an in-flight gauge on entry and decrements on exit. Crash it under load; verify the gauge stays bounded.
6. Write a server with a request counter. Expose it via `expvar.NewInt`. Curl `/debug/vars` to see it.
7. Write a `MaxObserved` that tracks the largest value ever passed to `Observe`. Use `CompareAndSwap`.
8. Write a counter that resets every second by spawning a goroutine that calls `Swap(0)` periodically. Print the per-second rate.
9. Write a "first arrival" sentinel using `atomic.Bool.CompareAndSwap(false, true)`.
10. Write a `WaitGroup` from scratch using `atomic.Int64` and a channel. Compare to `sync.WaitGroup`.
11. Build a simple token-bucket rate limiter using one atomic counter and a periodic refill.
12. Write a benchmark that increments a counter from `BenchmarkXXX(b *testing.B) { b.RunParallel(...) }` and run it with `-cpu=1,2,4,8,16`.
13. Take (12) and watch what happens to ops/sec as parallelism grows. Note the scaling.
14. Add `atomic.Pointer[T]` to your toolkit: store a snapshot struct of multiple counters in one atomic pointer.
15. Use `sync.Map` plus `atomic.Int64` to build a per-key counter.
16. Build a "circular" counter that wraps around modulo N using `CompareAndSwap`.
17. Build a "report and reset" worker: every 5 seconds, `Swap(0)` and emit the value.
18. Write a heartbeat: a goroutine that increments a counter every second; a watchdog that panics if it stops.
19. Write a leader-election sentinel: many goroutines call `CompareAndSwap(0, myID)`; the winner becomes leader.
20. Write a test that fails *without* `-race` and passes *with* the fix. Verify both.

Twenty exercises. You can do them all in a long weekend. After that, you are no longer a counter junior.

---

## Truly Truly Final Word

If you remember nothing else from this file, remember:

```go
var c atomic.Int64
c.Add(1)
```

And run `-race`. Always.

---

## Final Appendix: A Junior-Level Quiz

Quickly test your understanding without re-reading.

1. What is the result of `count++` from 1000 goroutines on a non-atomic `int`?
2. Which is faster for a simple counter: `sync.Mutex` or `atomic.Int64`?
3. Why is `Swap(0)` preferable to `Load()+Store(0)`?
4. When do you use `defer counter.Add(-1)`?
5. What does `atomic.Int64.Add(1)` return?
6. What is the difference between a counter and a gauge?
7. Why must you use a pointer receiver for methods on a struct with `atomic.Int64`?
8. What does the `-race` flag do?
9. What is a "lost update"?
10. How would you expose a counter via `/debug/vars`?

If you can answer all ten without looking, you have absorbed the junior level. If any feel uncertain, revisit the relevant section.

---

## Final Appendix: Five Common Junior Mistakes

Mistakes I see junior engineers make every week:

1. **Forgetting `-race`**: tests pass, production has races.
2. **Mixing atomic and non-atomic reads**: the writer uses Add, the reader uses direct access. Race.
3. **Copy-paste mutex around atomic**: redundant, slower, sometimes wrong.
4. **Reset via Load+Store**: loses concurrent increments.
5. **Forgetting `defer` on gauge decrement**: gauge leaks on panic.

Avoid these and you are ahead of 80% of junior Go engineers.

---

End of Junior File. Truly.







