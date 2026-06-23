# Memory Model — Junior Level

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
> Focus: "What is a data race, what is happens-before, how do channels and mutexes guarantee visibility, and how does `-race` catch bugs?"

When you write `x = 1` in one goroutine and `fmt.Println(x)` in another, you might expect the second goroutine to see `1`. But Go does not guarantee that — not without synchronisation. The compiler may reorder instructions. The CPU may delay writes in its store buffer. The cache hierarchy may not have published the new value yet. The result: the reader might see `0`, or `1`, or anything else, including a partial write of a multi-byte value.

This is the *memory model* problem. Every concurrent language has one. The Go memory model formally defines:

1. **When a data race exists.** Two goroutines access the same memory, at least one writes, no synchronisation — that is a race.
2. **What "synchronisation" means.** A channel send, mutex unlock, atomic store, goroutine creation — each establishes an ordering relationship.
3. **What programs with races are allowed to do.** Officially, racy programs have undefined behaviour. The compiler may crash, return wrong values, or "appear to work" until it doesn't.
4. **How to write race-free code.** Use the standard synchronisation primitives; the standard library guarantees their semantics.

The good news: in Go, you rarely need to reason from first principles. The standard library's primitives — channels, mutexes, `sync.Once`, `sync.WaitGroup`, `sync/atomic` — give you everything you need. As long as you use them, you do not have a data race. The race detector catches the cases where you forget.

After this you will:

- Know what a data race is and how to recognise one.
- Understand the happens-before relation informally.
- Know which Go primitives establish happens-before.
- Be able to read and apply the output of `go test -race`.
- Recognise the worst kinds of racy code in your own work.

You do not need to know about acquire-release semantics, CPU memory models, or the formal mathematical definition. Those come in the middle, senior, and professional levels.

---

## Prerequisites

- **Required:** Familiarity with goroutines and channels. See [01-goroutines/01-overview](../../01-goroutines/01-overview/) and [02-csp-model](../02-csp-model/).
- **Required:** Basic Go syntax and how to run `go test`.
- **Helpful:** Some exposure to concurrent programming bugs in any language. Even a vague memory of "we got a deadlock" or "the result was sometimes wrong" helps.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Memory model** | The rules a language defines for when one thread's writes are visible to another thread's reads. |
| **Data race** | Two goroutines access the same memory concurrently, at least one of them writes, and there is no synchronisation between them. Per the Go memory model, a program with data races has undefined behaviour. |
| **Happens-before** | A partial order on memory operations. If event A happens-before event B, then B is guaranteed to see any writes made before or during A. |
| **Synchronisation** | An operation that establishes happens-before between goroutines. Channel sends/receives, mutex lock/unlock, atomics, goroutine creation, etc. |
| **Race detector** | A tool (`go run -race`, `go test -race`) that instruments memory accesses and reports unsynchronised concurrent access. |
| **Atomic operation** | A read, write, or read-modify-write that is indivisible — no goroutine sees a partial value. `sync/atomic` package. |
| **Mutex** | A primitive that allows only one goroutine into a critical section. `sync.Mutex` in Go. |
| **Memory ordering** | The order in which a goroutine's writes become visible to other goroutines. Without synchronisation, ordering is undefined. |
| **Visibility** | Whether one goroutine's write is observable by another. Without synchronisation, no visibility guarantees. |
| **Atomic load / store** | A read or write that is indivisible and synchronises with other atomic ops on the same variable. |
| **Reordering** | The compiler or CPU rearranging instructions for performance. Allowed except across synchronisation. |
| **Word tear** | When a multi-word write (e.g., a struct or large value) appears partially to another goroutine. |

---

## Core Concepts

### A data race is not just a "race condition"

A *race condition* is any bug where the result depends on timing. A *data race* is a specific kind of race: unsynchronised concurrent access to memory with at least one writer.

```go
// Data race:
var x int
go func() { x = 1 }()
fmt.Println(x) // race: read in main, write in goroutine, no sync
```

Race conditions exist even in synchronised code — for example, two goroutines correctly contending for a mutex, but the "winner" is non-deterministic. That is not a data race, but it can still be a logic bug.

Throughout the Go memory model, "race" means *data race*.

### Why synchronisation is needed

You might think "well, the goroutine writes `1`, the main reads, of course it sees `1`." But:

1. **Compiler reorders.** The compiler may move the write of `x` past the goroutine's exit, or hoist the read of `x` in main out of the print call.
2. **CPU reorders.** Modern CPUs execute instructions out of order. The write of `x` may be sitting in a store buffer waiting to be flushed to cache.
3. **Cache invalidation.** Even if the write is in cache, another core's cache may not see the new value until coherence protocols update it.
4. **Garbage collection or other runtime work.** Goroutine creation, channel sends, mutex acquires — all involve memory operations the runtime treats specially.

Without synchronisation, all bets are off. With synchronisation, the runtime and the language guarantee certain orderings.

### Happens-before, informally

The Go memory model defines an ordering on memory operations called **happens-before**. If A happens-before B:

- Any write that A made (or that happened-before A) is visible to B.
- B cannot see writes that B's goroutine has not yet made.

Without happens-before, you have no guarantees.

Examples of operations that establish happens-before:

- The `go f()` statement happens-before f's first instruction.
- A send on a channel happens-before the corresponding receive completes.
- A receive from a closed channel happens-after the close.
- A mutex unlock happens-before the next mutex lock by another goroutine.
- A `sync.Once.Do` first call happens-before any subsequent `Do` call returns.
- A `sync.WaitGroup.Wait` returns after the corresponding `Done` calls.
- An atomic operation happens-before any subsequent atomic operation on the same variable.

If A happens-before B, and B happens-before C, then A happens-before C (transitivity).

### Channels as synchronisation

The most common synchronisation in Go is via channels:

```go
var x int
done := make(chan struct{})

go func() {
    x = 42         // write
    close(done)    // synchronisation
}()

<-done             // synchronisation
fmt.Println(x)     // read — guaranteed to see 42
```

The `close(done)` happens-before the `<-done` (which returns immediately because the channel is closed). Transitively, the write to `x` happens-before the print. The print sees `42`.

This is why CSP-discipline code is automatically race-free for any data passed through channels.

### Mutexes as synchronisation

```go
var (
    mu sync.Mutex
    x  int
)

go func() {
    mu.Lock()
    x = 42
    mu.Unlock()
}()

mu.Lock()
fmt.Println(x) // may print 0 or 42 depending on lock order, but not garbage
mu.Unlock()
```

The unlock by one goroutine happens-before the next lock by another goroutine. If the spawned goroutine locks first, its write to `x` is visible to the main goroutine after its lock. If the main locks first, the spawned write happens after the print.

Either way, the main goroutine sees `0` or `42` — not corrupted memory.

### The race detector

The race detector instruments every memory access and tracks happens-before relationships. When it detects an unsynchronised concurrent access, it reports the location of both accesses.

```bash
go run -race main.go
go test -race ./...
```

The race detector is on of the most important tools in Go. Run it in CI. Run it in your local tests. It catches the vast majority of data races before they reach production.

Cost: race-instrumented code is 2–10x slower and uses more memory. Use the detector during development and testing; do not run it in production.

### Atomic operations

`sync/atomic` provides operations that are guaranteed atomic and (since the 2022 memory model) sequentially consistent:

```go
var counter int64
atomic.AddInt64(&counter, 1)
n := atomic.LoadInt64(&counter)
```

Each atomic op is one indivisible action and synchronises with other atomic ops on the same variable.

`atomic` is faster than mutex for simple operations (a few nanoseconds vs 20+ for mutex), but more limited — only single-word operations.

---

## Real-World Analogies

### The shared whiteboard

Two people share a whiteboard. Without rules, Alice may erase and rewrite while Bob is reading. Bob sees half-erased nonsense. With rules — "only one person at the board at a time" (mutex) — both see consistent state.

Without rules: garbage. With rules: deterministic.

### The mail relay

Alice sends a postcard to Bob's house. Without proof of delivery, Alice does not know Bob has read it. With a "receipt received" signal (channel close), Alice knows Bob has the message. Anything Alice put on the postcard is now part of Bob's reality.

Channels provide that receipt — when a receive succeeds, the sender's prior writes are visible.

### Cache coherence in a kitchen

Two chefs in a shared kitchen. Each has their own notepad with the day's specials. They periodically sync up via the central whiteboard (cache flush). Without explicit syncing, one chef may serve the old menu while the other has updated.

In computers, each CPU core has its own cache; explicit "fences" force them to sync.

---

## Mental Models

### Model 1: "Sync points create reality"

Without a synchronisation event, each goroutine has its own private notion of memory. Synchronisation events are when those notions merge. The synchronisation primitives are the only events Go guarantees to merge memory across goroutines.

### Model 2: "Race detector = sanity check"

You cannot reason perfectly about happens-before. The race detector does the bookkeeping for you. Run it; trust it; fix what it reports.

### Model 3: "If you cannot point at the sync, you have a race"

For every shared variable accessed by multiple goroutines, ask: what specific synchronisation guarantees ordering between the access in goroutine A and the access in goroutine B? If you cannot point at a channel send, a mutex acquire, an atomic op, or a goroutine creation, you have a race.

### Model 4: "Atomics for primitives, mutexes for structures, channels for ownership transfer"

A rough taxonomy:

- One `int64` updated by many goroutines: atomic.
- A `map[string]Foo`: mutex.
- A stream of values flowing between goroutines: channel.

Each primitive's cost matches its use.

---

## Pros & Cons

### Pros of the Go memory model

- **Clear rules.** The spec tells you exactly what is allowed.
- **Standard primitives.** Channels, mutexes, atomics, `sync.Once`, `sync.WaitGroup` all establish happens-before.
- **Race detector.** A tool that finds violations automatically.
- **Sequentially consistent atomics.** Since 2022, easier to reason about than C++'s memory orders.

### Cons

- **Easy to misuse.** Sharing a slice or pointer is sharing memory; you must synchronise.
- **Surprising reorderings.** Without sync, the compiler may eliminate or reorder code aggressively.
- **Undefined behaviour for races.** A racy program may crash, hang, or produce wrong results unpredictably.
- **Performance trade-offs.** Synchronisation costs nanoseconds to microseconds; over-synchronising hurts performance.

---

## Use Cases

| Scenario | Synchronisation tool |
|---|---|
| Goroutine A produces, B consumes | Channel |
| Many goroutines update a counter | atomic |
| Many goroutines read-mostly a config | `sync.RWMutex` or `atomic.Value` |
| Two goroutines coordinate completion | `sync.WaitGroup` |
| One-time initialisation | `sync.Once` |
| Mutating a shared map | `sync.Mutex` or `sync.Map` |
| Hot pointer swap | `atomic.Value` |
| Custom signalling | `sync.Cond` (rarely needed) |

---

## Code Examples

### Example 1: The classic data race

```go
package main

import "fmt"

func main() {
    var x int
    go func() {
        x = 42
    }()
    fmt.Println(x)
}
```

Run with `go run -race main.go`. The race detector reports:

```
WARNING: DATA RACE
Write at 0x... by goroutine 7:
  main.main.func1()
      main.go:8 +0x30

Previous read at 0x... by main goroutine:
  main.main()
      main.go:10 +0x40
```

The fix is to add synchronisation.

### Example 2: Fix with WaitGroup

```go
var x int
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    x = 42
}()
wg.Wait()
fmt.Println(x) // race-free, prints 42
```

`wg.Wait` happens-after `wg.Done`, which happens-after the write to `x`.

### Example 3: Fix with channel

```go
var x int
done := make(chan struct{})
go func() {
    x = 42
    close(done)
}()
<-done
fmt.Println(x) // race-free, prints 42
```

`close(done)` happens-before `<-done` returns; the write is visible.

### Example 4: Fix with mutex

```go
var x int
var mu sync.Mutex
go func() {
    mu.Lock()
    x = 42
    mu.Unlock()
}()
mu.Lock()
fmt.Println(x)
mu.Unlock()
```

Either order of locking; both observe a consistent state.

### Example 5: Fix with atomic

```go
var x int64
go func() {
    atomic.StoreInt64(&x, 42)
}()
v := atomic.LoadInt64(&x)
fmt.Println(v)
```

`atomic.Store` and `atomic.Load` synchronise; the load sees 0 or 42, never garbage.

### Example 6: Two-counter race

```go
var counter int
var wg sync.WaitGroup
for i := 0; i < 1000; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        counter++
    }()
}
wg.Wait()
fmt.Println(counter)
```

`counter++` is not atomic. Result varies from run to run, usually less than 1000.

### Example 7: Fix with atomic

```go
var counter int64
// ...
atomic.AddInt64(&counter, 1)
// ...
fmt.Println(counter)
```

Always 1000.

### Example 8: Shared map race

```go
m := map[string]int{}
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        m[fmt.Sprintf("k%d", i)] = i
    }(i)
}
wg.Wait()
```

Go's built-in map is not safe for concurrent writes. The race detector catches; the runtime may also panic with "concurrent map writes."

### Example 9: Fix with mutex around map

```go
var (
    mu sync.Mutex
    m  = map[string]int{}
)
go func(i int) {
    mu.Lock()
    m[key] = i
    mu.Unlock()
}(i)
```

### Example 10: Fix with sync.Map

```go
var m sync.Map
m.Store(key, i)
v, ok := m.Load(key)
```

Designed for concurrent use, no manual locking.

---

## Coding Patterns

### Pattern 1: Lock around shared structure

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]string
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    v, ok := c.m[k]
    return v, ok
}
```

### Pattern 2: Atomic counter

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc() { c.n.Add(1) }
func (c *Counter) Load() int64 { return c.n.Load() }
```

### Pattern 3: Once for lazy init

```go
var (
    once  sync.Once
    cache *Cache
)

func getCache() *Cache {
    once.Do(func() {
        cache = newCache()
    })
    return cache
}
```

### Pattern 4: Channel for state transfer

```go
result := make(chan Result, 1)
go func() { result <- compute() }()
r := <-result
use(r)
```

---

## Clean Code

- **Always use the race detector during development.** It is your safety net.
- **Document concurrent access.** Methods that are safe for concurrent use deserve a `// Safe for concurrent use.` comment.
- **Embed sync primitives in structs where appropriate.** Keeps state and lock together.
- **Prefer fewer locks.** A struct with one mutex protecting everything is simpler than many fine-grained locks.
- **Avoid global mutable state.** Encapsulate in structs with their own synchronisation.

---

## Product Use / Feature

| Feature | Memory model concern |
|---|---|
| Auth session cache | Cache must be concurrent-safe (mutex or `sync.Map`). |
| Counter metrics | Atomic for cheap increments. |
| Hot config (rare write, many read) | `atomic.Value` or `RWMutex`. |
| Connection state | Mutex per connection (low contention if connections are independent). |
| Event log | Buffered channel or mutex-protected slice. |
| Cancellation across goroutines | `context.Context` (which uses channels internally). |

---

## Error Handling

The Go memory model itself does not produce errors. But races produce errors *somewhere*:

- The race detector reports them with a clear stack trace.
- Without `-race`, the program may silently produce wrong results.
- Concurrent map writes panic at runtime ("fatal error: concurrent map writes").
- Some races corrupt internal state and cause crashes later.

The lesson: detect early. Run `-race` in CI. Run stress tests.

---

## Security Considerations

- **Races on auth state.** A race on a session token or permission check can momentarily grant the wrong access. Always synchronise auth state.
- **Races on configuration.** Half-updated config may be read by a request handler. Use `atomic.Value` for atomic updates.
- **Race in cryptographic code.** Crypto state must be either single-goroutine-owned or synchronised. The Go standard library is careful here; custom crypto often is not.
- **Compiler optimisations on racy code.** The compiler may assume no races and optimise aggressively. Racy code may pass tests but fail in production.

---

## Performance Tips

- **Atomics for single primitives.** Faster than mutexes for `int64` etc.
- **RWMutex for read-heavy workloads.** Multiple readers in parallel.
- **`sync.Map` for highly-concurrent map access.** Read path is lock-free.
- **Per-CPU sharding for very hot data.** Combine local results periodically.
- **`atomic.Value` for pointer updates.** A `Load` is a normal load; `Store` is a CAS.
- **Avoid lock contention.** Profile with `pprof -mutex`; refactor if a single lock dominates.

---

## Best Practices

1. Run `go test -race` in CI on every commit.
2. Document concurrent-safety of every public method.
3. Use channels for ownership transfer, mutexes for protected state.
4. Use atomics for simple counters and flags.
5. Use `sync.Once` for one-time initialisation.
6. Use `sync.WaitGroup` or `errgroup` for joining.
7. Keep critical sections short.
8. Avoid `time.Sleep` for synchronisation.
9. Never share without synchronisation, even briefly.
10. Suspect any "rare" failure under load — it may be a race.

---

## Edge Cases & Pitfalls

### Loop variable captured by goroutine (pre-1.22)

```go
for i := 0; i < 5; i++ {
    go func() { fmt.Println(i) }()
}
```

Pre-1.22, all goroutines share `i`. They likely all print 5. Not technically a memory-model issue, but a race on `i`. Fixed in 1.22 by giving each iteration its own variable.

### Shared slice mutation

```go
buf := make([]byte, 100)
go func() { buf[0] = 1 }()
go func() { buf[99] = 2 }()
```

These two writes are to *different* bytes, but they share the *slice header*. The race detector reports a race on the slice variable. Real bug: any reader sees inconsistent state.

Fix: synchronise, or partition the work so each goroutine has its own slice.

### Pointer publication

```go
var p *Config

go func() {
    p = newConfig() // write
}()
use(p) // read — race
```

Fix with `atomic.Value`:

```go
var p atomic.Value

go func() {
    p.Store(newConfig())
}()
cfg := p.Load().(*Config)
```

### Read-modify-write without atomicity

```go
x = x + 1 // not atomic, even if x is int64
```

Fix:

```go
atomic.AddInt64(&x, 1)
```

### Visibility on shutdown

```go
var shutdown bool

go func() {
    for !shutdown {
        work()
    }
}()

shutdown = true // race
```

Fix:

```go
var shutdown atomic.Bool

go func() {
    for !shutdown.Load() {
        work()
    }
}()

shutdown.Store(true)
```

Or use `context.Context`.

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| Reading a shared variable without synchronisation | Add mutex / atomic / channel synchronisation. |
| `counter++` from multiple goroutines | Use `atomic.AddInt64`. |
| Concurrent map writes | Use mutex or `sync.Map`. |
| Captured loop variable in goroutine | Pass as parameter (pre-1.22) or use 1.22+. |
| "It works on my machine" | Run with `-race` and on multiple machines. |
| Synchronising with `time.Sleep` | Use proper synchronisation. |
| Forgetting to release a lock on every path | Use `defer mu.Unlock()`. |

---

## Common Misconceptions

> *"Go automatically synchronises shared variables."* — No. Without explicit synchronisation, there are no guarantees.

> *"`go run` does not show races."* — Correct — without `-race`, races may silently succeed or fail.

> *"A race is just non-determinism, not a bug."* — Per the Go memory model, racy programs have undefined behaviour. The compiler may do anything.

> *"`int64` reads and writes are atomic on x86, so I don't need atomic."* — On some hardware, yes; on others, no. The Go memory model still says you need atomic for visibility.

> *"Mutexes are slow, atomics are always faster."* — Atomics are faster for single-word ops. For multiple correlated variables, you need a mutex anyway.

> *"The race detector catches every race."* — Only races that occur during the test run. Add stress tests for thoroughness.

---

## Tricky Points

### A buffered channel synchronisation rule

For a buffered channel of capacity C, the kth receive happens-after the (k - C)th send. The intervening sends and receives are not ordered relative to each other.

### Multiple `sync.Once` arguments

```go
once.Do(func() { ... })
once.Do(func() { /* not called */ })
```

The function passed to the first Do runs once. Subsequent `Do` calls return immediately. The function is bound to the first call only.

### `atomic.Value` and types

```go
var v atomic.Value
v.Store(1)
v.Store("hello") // PANIC: inconsistent type
```

`atomic.Value` requires all stored values to be of the same concrete type. Mixing types panics.

### Reading uninitialised atomic

```go
var v atomic.Int64
v.Load() // returns 0
```

Safe. Zero value is valid.

---

## Test

```go
package memorymodel_test

import (
    "sync"
    "sync/atomic"
    "testing"
)

func TestAtomicAddIsAtomic(t *testing.T) {
    var n atomic.Int64
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            n.Add(1)
        }()
    }
    wg.Wait()
    if v := n.Load(); v != 1000 {
        t.Fatalf("expected 1000, got %d", v)
    }
}
```

Run with `go test -race`.

---

## Tricky Questions

**Q.** What is wrong with this code?

```go
var x int
done := false

go func() {
    x = 42
    done = true
}()

for !done { }
fmt.Println(x)
```

**A.** Two races: on `done` and on `x`. Without synchronisation, the main goroutine may never see `done = true` (compiler may hoist the read out of the loop), or may see `done = true` but read `x = 0`.

Fix: use `atomic.Bool` for `done` and `atomic.Int64` for `x`, or just close a channel.

---

**Q.** Does `go run` always catch races?

**A.** No. `go run` without `-race` does not check for races. You must use `-race` explicitly.

---

**Q.** Why is `counter++` not atomic for `int64`?

**A.** `counter++` is read-modify-write: load the value, add 1, store it. Three operations. Without atomic instructions or a lock, two goroutines can both read the same value, both add 1, and both store — losing one increment.

---

**Q.** What does the race detector cost?

**A.** Race-instrumented code runs 2–10x slower, uses ~2x more memory, and has higher initialisation cost. Use for testing, not production.

---

**Q.** Why does the spec say "racy programs have undefined behaviour"?

**A.** Because the compiler and runtime are allowed to optimise based on the assumption that there are no races. Racy code may "work" for years until a compiler upgrade or hardware change makes it fail.

---

## Cheat Sheet

```
Data race = concurrent access, at least one write, no synchronisation.
Synchronisation tools that establish happens-before:
  - Channel send/receive/close
  - sync.Mutex.Lock/Unlock
  - sync.RWMutex.RLock/RUnlock
  - sync.Once.Do
  - sync.WaitGroup.Wait/Done
  - sync/atomic operations
  - goroutine creation (go f() happens-before f)

Tools:
  go test -race    : detect races during tests
  go run -race     : detect races during run
  pprof -mutex     : find lock contention
  goleak           : detect goroutine leaks

Primitives:
  sync.Mutex       : exclusive access
  sync.RWMutex     : multiple readers, one writer
  sync.Once        : run once
  sync.WaitGroup   : wait for N
  sync.Map         : concurrent-safe map
  sync.Pool        : per-goroutine cache
  sync/atomic      : atomic int / pointer ops
  atomic.Value     : atomic interface{} swap
  context.Context  : cancellation tree
  channels         : communication + sync
```

---

## Self-Assessment Checklist

- [ ] I can define a data race in one sentence.
- [ ] I have run `go test -race` and seen a real race report.
- [ ] I know at least four operations that establish happens-before.
- [ ] I have fixed a data race using a mutex, an atomic, and a channel.
- [ ] I know the difference between `sync.Mutex` and `sync.RWMutex`.
- [ ] I have used `sync.Once` for lazy initialisation.
- [ ] I have used `sync.WaitGroup` to join goroutines.
- [ ] I know what `atomic.Value` is for.
- [ ] I have considered concurrent safety in at least one struct I designed.
- [ ] I run `go test -race` in CI for my projects.

---

## Summary

The Go memory model formalises when one goroutine's writes are visible to another's reads. The answer is: only when separated by a synchronisation event. The standard library's primitives — channels, mutexes, atomics, `sync.Once`, `sync.WaitGroup` — establish such events. Code that uses them is race-free; code that does not has undefined behaviour.

The race detector is the tool that catches violations. Run it in development, in tests, and in CI. It is fast enough for testing and catches the vast majority of issues.

In practice, the rules collapse to: do not share variables across goroutines without synchronisation. If you do share, use the right primitive (mutex for structures, atomic for primitives, channels for ownership transfer). And run `-race`.

The next files dive deeper: middle covers atomics in detail, senior covers race-free API design, professional covers hardware memory models.

---

## What You Can Build

- A concurrent-safe counter, cache, or session store.
- A goroutine-safe configuration loader using `atomic.Value`.
- A worker pool with atomically tracked statistics.
- A pub/sub system where subscribers are added/removed safely.
- A small load test that detects races by running thousands of concurrent operations.

---

## Further Reading

- The Go Memory Model (2022 revision): <https://go.dev/ref/mem>
- Russ Cox, *Updating the Go Memory Model* (2022): <https://research.swtim.com/mm/go.html>
- The race detector: <https://go.dev/doc/articles/race_detector>
- Russ Cox, *Hardware Memory Models*: <https://research.swtim.com/mm/hwmm.html>
- Russ Cox, *Programming Language Memory Models*: <https://research.swtim.com/mm/plmm.html>
- *The Art of Multiprocessor Programming* by Maurice Herlihy and Nir Shavit.

---

## Related Topics

- [01-what-is-concurrency](../01-what-is-concurrency/) — broader concurrency framing.
- [02-csp-model](../02-csp-model/) — channels as synchronisation.
- [03-go-runtime-gmp](../03-go-runtime-gmp/) — the runtime that enforces the memory model.
- [05-when-to-use-concurrency](../05-when-to-use-concurrency/) — decision framework.

---

## Diagrams & Visual Aids

### Happens-before

```
Goroutine A:                Goroutine B:
   x = 1                       /* nothing yet */
   ch <- v   ----- sync ---->  v := <-ch
   /* a/x already visible */   fmt.Println(x)  <-- sees 1
```

### Without synchronisation

```
Goroutine A:                Goroutine B:
   x = 1                       /* no sync */
   /* no sync */                fmt.Println(x)  <-- may print 0
```

### Atomic operations

```
Atomic Add:
   [load value][add 1][store] -- indivisible
   No other goroutine sees a partial state.
```

### Mutex critical section

```
   Goroutine A: Lock() ... write x = 1 ... Unlock()
                                                  | sync edge
                                                  v
   Goroutine B:                              Lock() ... read x ... Unlock()
                                              (sees 1)
```

### Race detector output

```
WARNING: DATA RACE
Read at 0x... by goroutine 7:    <-- the unsynchronised read
  main.read()
      file.go:20

Previous write at 0x... by goroutine 8:    <-- the conflicting write
  main.write()
      file.go:14
```
