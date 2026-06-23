---
layout: default
title: Middle
parent: Concurrent Counters
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/06-concurrent-counters/middle/
---

# Concurrent Counters — Middle Level

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
> Focus: "When `atomic.Int64.Add(1)` is not enough — multi-counter coordination, `CompareAndSwap` loops, `expvar`, and the basic shard pattern."

At the junior level we treated a counter as a single atomic value. That works beautifully for the textbook cases. As soon as you need any of the following, the junior toolbox runs out:

- "Increment counter A *and* set counter B, atomically." (Two atomics are not atomic together.)
- "Increment only if the result would not exceed a limit." (A read-then-add race.)
- "Track the maximum value ever observed." (A CAS loop.)
- "Expose dozens of counters to operators." (You need a registry.)
- "Take a consistent snapshot of multiple related counters." (A read race.)
- "Make this counter scale past one cache line of contention." (Sharding.)

This file covers the next layer. You will learn:

- How `CompareAndSwap` works and the loop pattern around it
- How to use `atomic.Pointer[T]` to swap an entire snapshot struct atomically
- The `expvar` package end-to-end: `expvar.Int`, `expvar.Float`, `expvar.Map`, `expvar.Func`, and the registry behind `/debug/vars`
- The basic shard pattern: N independent counters per "slot", summed at read time
- How to integrate counters with Prometheus / OpenTelemetry while still using `atomic.Int64` underneath
- When a counter is fundamentally the wrong primitive (and you really need a histogram)

You do not yet need to know about cache-line padding, sloppy/per-CPU counters, LongAdder-style designs, or HDR histograms. Those come at the senior and professional levels.

---

## Prerequisites

- **Required:** Junior-level fluency with `atomic.Int64`, `sync.Mutex`, `sync.WaitGroup`, `defer`, and the race detector.
- **Required:** Familiarity with Go generics (the typed `atomic.Pointer[T]` API from Go 1.19+).
- **Required:** Comfort writing test benchmarks (`func BenchmarkXxx(b *testing.B)`).
- **Helpful:** Some operational experience — what a `/metrics` endpoint is, what an alert is, what an SRE looks at when paging on a counter.
- **Helpful:** Awareness of the broader observability landscape: Prometheus, OpenTelemetry, StatsD, Datadog. You do not need to be an expert; the names should ring bells.

If you can write the broken `count++` program, fix it three different ways, and explain the race detector's output to a colleague, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **CompareAndSwap (CAS)** | An atomic operation that sets a value to `new` *only if* its current value equals `old`. Returns true on success, false if someone else changed it first. The foundation of lock-free programming. |
| **CAS loop** | The pattern: read current, compute new, CAS — if CAS fails (someone else won), repeat. The cost of contention is wasted CPU on retries; the benefit is no blocking. |
| **Snapshot** | A consistent view of multiple values, taken at "one point in time". For multi-value counters, snapshots typically use `atomic.Pointer[T]` to swap an immutable struct. |
| **`atomic.Pointer[T]`** | A type-safe atomic pointer (Go 1.19+). Methods: `Load`, `Store`, `Swap`, `CompareAndSwap`. Lets you atomically replace a pointer to a struct, giving "snapshot" semantics for arbitrarily complex state. |
| **`expvar`** | The standard library's metrics package. Registers a `/debug/vars` HTTP endpoint that emits JSON of all registered variables. Each `expvar.Int` is an `atomic.Int64` under the hood. |
| **Registry** | A keyed collection of named metric values. `expvar` has one built in; Prometheus and OpenTelemetry each have their own; you can write your own in 20 lines. |
| **Sharded counter (basic form)** | A counter that internally maintains N independent atomic counters, each incremented by a different "shard key" (often a hash of the goroutine ID or a per-P slot). Reads sum all shards. Reduces contention proportionally to N. |
| **Sloppy counter** | A counter that is "approximately right". The increment goes to a goroutine-local accumulator and is periodically flushed to a global counter. Trades exact freshness for vastly higher throughput. (Senior-level topic; introduced here.) |
| **`LongAdder`** | Java's class that internally maintains a base value and a contention-driven dynamically-grown table of cells. The Go community has several analogs (the senior file covers them). Mentioned here for vocabulary. |
| **HDR histogram** | High-Dynamic-Range histogram — a bucketed distribution with very low recording overhead and bounded memory across many orders of magnitude. (Professional level; named here for vocabulary.) |
| **Counter vs histogram** | A counter measures *how many*. A histogram measures *what shape*. If you want p95 latency, you need a histogram, not a counter. |
| **Cache line** | The unit of memory cache coherence — typically 64 bytes on x86-64. Two variables sharing a cache line ping-pong between cores when written from different cores, even if they are logically unrelated. (Senior-level topic.) |
| **False sharing** | The performance pathology where two unrelated atomics share a cache line and contend invisibly. The fix is padding. (Senior-level topic.) |

---

## Core Concepts

### CompareAndSwap and the lock-free loop

The fundamental building block for any algorithm that wants to read a value, compute a derived value, and write the derived value without using a mutex is `CompareAndSwap` (CAS).

```go
type AtomicMax struct{ v atomic.Int64 }

func (m *AtomicMax) Observe(x int64) {
    for {
        cur := m.v.Load()
        if x <= cur {
            return // already the max or larger; nothing to do
        }
        if m.v.CompareAndSwap(cur, x) {
            return // we won the race; cur was still the value, now it is x
        }
        // we lost; someone else changed the value; reread and retry
    }
}
```

The pattern is:

1. Read the current value.
2. Decide what the new value should be (here, `x` if `x > cur`, otherwise do nothing).
3. Atomically set the value to `new` only if it is still `cur`.
4. If the CAS fails, someone else changed the value; go back to step 1.

This is *lock-free*: no goroutine blocks, no goroutine sleeps, no mutex is held. Under contention, some retries are wasted, but no goroutine ever stops making progress. Compared to a mutex, the latency for an uncontended operation is roughly the same (both are one atomic instruction); under contention, the CAS loop tends to do more wasted work but avoids OS-level park/unpark.

The same pattern builds:

- `AtomicMin` (mirror image)
- `AtomicAverage` (CAS-loop over sum and count)
- `AtomicSet` (CAS-loop adding an element)
- Linked lists, queues, stacks (with much more care)

### `atomic.Pointer[T]` and snapshots

Sometimes you do not want to track one number — you want to atomically replace a *whole struct*. Example: a snapshot of metrics that operators read.

```go
type Snapshot struct {
    Requests  int64
    Errors    int64
    InFlight  int64
    Timestamp time.Time
}

type Metrics struct {
    snap atomic.Pointer[Snapshot]
}

func (m *Metrics) Publish(s *Snapshot) {
    m.snap.Store(s)
}

func (m *Metrics) Read() *Snapshot {
    return m.snap.Load()
}
```

Two threads cannot accidentally see "Requests from time T1 but InFlight from time T2" — the pointer swap is atomic, and the struct is immutable after `Publish`. The reader either sees the old snapshot or the new one, never a mix.

For *writes* you typically have one goroutine producing snapshots (a "metrics publisher"); for *reads*, any number of goroutines may call `Read`. This decouples the cost of recording from the cost of reading.

### `expvar` end-to-end

The standard library's `expvar` package gives you a registry of named metrics, a JSON endpoint at `/debug/vars`, and types for the common metric shapes — for free.

```go
import (
    "expvar"
    "net/http"
)

var (
    requests = expvar.NewInt("requests_total")
    errors   = expvar.NewInt("errors_total")
    inflight = expvar.NewInt("inflight")
)

func handler(w http.ResponseWriter, r *http.Request) {
    requests.Add(1)
    inflight.Add(1)
    defer inflight.Add(-1)
    if err := doWork(r); err != nil {
        errors.Add(1)
        http.Error(w, err.Error(), 500)
        return
    }
    w.Write([]byte("ok"))
}

func main() {
    http.HandleFunc("/", handler)
    // /debug/vars is automatically registered when you import expvar
    http.ListenAndServe(":8080", nil)
}
```

`curl localhost:8080/debug/vars` returns:

```json
{
  "cmdline": ["./yourbinary"],
  "memstats": { ... runtime stats ... },
  "requests_total": 14,
  "errors_total": 1,
  "inflight": 0
}
```

The package's types include:

- `Int` — atomic int64
- `Float` — atomic-ish float64 (uses `math.Float64bits` + `atomic.Uint64`)
- `String` — atomic-ish string (mutex-protected)
- `Map` — keyed collection of named vars
- `Func` — a function that returns any JSON-serialisable value (for live-computed metrics)

```go
var memStats = expvar.NewMap("mem")
memStats.Set("heap_alloc", expvar.Func(func() any {
    var s runtime.MemStats
    runtime.ReadMemStats(&s)
    return s.HeapAlloc
}))
```

`expvar.Func` is a clever escape hatch: if you do not want to maintain a metric — you just want to compute and emit it at scrape time — wrap the producer in `expvar.Func`.

### The basic sharded counter

When one `atomic.Int64` is hit by 32 cores at very high rate, the cache line holding it ping-pongs between cores. Throughput per core falls dramatically. The basic fix:

```go
type Sharded struct {
    shards [16]atomic.Int64
}

func (s *Sharded) Inc() {
    // Pick a shard. The choice of which shard a goroutine uses
    // is the interesting design question; here we use the goroutine
    // address as a cheap proxy.
    n := uintptr(unsafe.Pointer(&s)) // or pid, goroutine id, etc.
    s.shards[n%16].Add(1)
}

func (s *Sharded) Get() int64 {
    var total int64
    for i := range s.shards {
        total += s.shards[i].Load()
    }
    return total
}
```

Each shard lives at a different address; in the ideal case, each shard sits on its own cache line and the cores rarely fight over the same line. The cost is `Get()` becomes O(shards) — but reads of metrics are typically rare (once per scrape, every 15 seconds) while writes are common (once per request, every microsecond).

This is the basic idea. The *good* version of this is the senior file's topic: cache-line padding, the right shard count, the right hashing strategy, and (for the truly hot case) per-CPU shards via `runtime_procPin`. For now, the basic "N shards picked by a cheap hash" is enough to dramatically reduce contention.

### Counter vs histogram

A counter answers "how many?" A histogram answers "what shape?".

If your operations team asks "what is the p99 latency of this handler?", a counter cannot tell you. You need a histogram (a bucketed distribution of observations). The professional file covers HDR histograms. For now: know the distinction. Many engineers reach for a counter when they need a histogram and end up with `total_latency_ns / total_requests` as their only signal — which discards all the tail behaviour and misleads operators.

Counters are great for:

- Counts of events (requests, errors, bytes)
- Sums of values (total bytes transferred)
- Gauges (current value of something)

Counters are wrong for:

- Distributions (latency, response size)
- Percentiles (p50, p95, p99)
- Anomaly detection on tail behaviour

---

## Real-World Analogies

### The CAS loop as "trying to grab the last seat"

Imagine a single chair in the middle of a room, and ten people who all want to sit in it. The CAS-loop way to grab the chair:

1. Look at the chair: is it empty?
2. If empty, simultaneously sit down (the "compare and swap" — sit only if still empty).
3. If two people try at the exact same moment, only one of them actually sits; the others bounce off.
4. The losers go back to step 1 (look again).

No queueing, no announcer, no one in charge. Sometimes you bounce off and have to try again. But under low contention, you always sit on the first try.

### `expvar` as a public bulletin board

`expvar` is a bulletin board outside the building. Anyone who needs to publish a number tacks up a card with `NewInt("requests_total")`. Anyone who wants to know the current state walks by and reads all the cards. The publisher does not have to know who is reading; the readers do not need to coordinate.

### Sharded counters as 16 separate tip jars

A bar with one tip jar and 16 bartenders: every tip causes a small fight as the bartenders reach in at once. Replace with one tip jar per bartender: no fights, and at the end of the night the manager sums up all the jars.

### `atomic.Pointer[Snapshot]` as a presidential briefing

The president needs a daily briefing. Staff write a fresh briefing each morning and put it on the president's desk; the old one is discarded. The president reads the briefing as a whole; she never gets a half-old, half-new document. The "atomic pointer swap" is the assistant placing the new briefing on the desk and removing the old one.

---

## Mental Models

### CAS is "I bet the value is still X"

Every CAS is a bet. You read X, you compute a new value, you bet that the value is still X by the time you try to write. If the bet wins, your write succeeds. If the bet loses, you retry. Lock-free programming is the art of structuring algorithms around CAS bets.

### Atomic pointer = swap the whole world

When the state you need is more than one word, you cannot atomic-update each word individually — you would get torn snapshots. Instead, build an immutable struct, allocate a new one when you want to change state, and atomic-swap the pointer. Every reader sees a consistent view of *some* version, even if not the latest.

### A registry is just a `map[string]Stringer`

`expvar` looks magical until you read the source. It is:

```go
var vars sync.Map // map[string]Var
```

with a `Publish(name, v)` that does `vars.Store(name, v)`, a `Do(f)` that iterates the map, and an HTTP handler that walks the map and writes JSON. That is the whole package.

### Sharding is "make the hot spot N times less hot"

Instead of one atomic that everyone contends on, have N atomics. If your sharding is good (uniform distribution, separate cache lines), per-shard contention falls roughly to 1/N. For N=16 and 32 cores, contention is moderate; for N=128 and 32 cores, contention is essentially gone. The cost is N×8 bytes of memory and an O(N) read.

---

## Pros & Cons

### CompareAndSwap loops

**Pros**
- Lock-free; no goroutine ever sleeps on a lock
- Excellent latency under low contention
- Works for arbitrary read-modify-write operations
- Composable with other atomics

**Cons**
- Live-lock under extreme contention: many goroutines repeatedly fail their CAS
- Harder to reason about than a mutex
- ABA problem: if a value goes A → B → A between your read and your CAS, the CAS succeeds but the value "really" changed twice. For monotonic counters this is rarely an issue; for pointer-based structures it is a major concern.

### `atomic.Pointer[T]` snapshots

**Pros**
- Atomic update of arbitrarily complex state
- Wait-free reads (one atomic load)
- Natural fit for "read-mostly, occasionally publish" workloads

**Cons**
- Allocates a new snapshot on every update (GC pressure)
- Old snapshots can outlive the swap if readers are slow (memory waste)
- Cannot update *part* of the snapshot; always whole-replacement

### `expvar`

**Pros**
- Standard library, zero dependencies
- Automatic JSON endpoint
- Free runtime metrics (memstats, cmdline)
- Atomic underneath; no special care needed

**Cons**
- JSON only — no Prometheus, no OpenTelemetry, no histograms
- Registers globally; tests that import `expvar` get the endpoint as a side effect
- The default endpoint is on `http.DefaultServeMux`, which is a security hazard if exposed publicly
- `String` type uses a mutex internally (not atomic for the string itself)

### Basic sharded counter

**Pros**
- Dramatically reduces contention
- Simple to implement
- Reads are still cheap if shards are few (16 fits in one cache line group)

**Cons**
- Picking the right shard count and hashing strategy is workload-dependent
- Reads scale O(shards), so you should not read in a hot loop
- The naive version still suffers from false sharing (shards adjacent in memory); the senior file's padded version fixes it

---

## Use Cases

### Use case: atomic "increment with cap"

```go
type Capped struct {
    v   atomic.Int64
    max int64
}

func (c *Capped) Inc() bool {
    for {
        cur := c.v.Load()
        if cur >= c.max {
            return false
        }
        if c.v.CompareAndSwap(cur, cur+1) {
            return true
        }
    }
}
```

Returns true if the increment was allowed, false if at cap. Used in admission controllers, rate limiters, and worker-pool size limits.

### Use case: leader election by atomic stamp

```go
type Leader struct {
    holder atomic.Int64 // pid of current leader, or 0
}

func (l *Leader) TryClaim(myPID int64) bool {
    return l.holder.CompareAndSwap(0, myPID)
}

func (l *Leader) Release(myPID int64) bool {
    return l.holder.CompareAndSwap(myPID, 0)
}
```

The first goroutine to CAS from 0 to its PID is the leader. Others fall through and become followers.

### Use case: epoch-based reclamation stamp

The "atomic counter as logical clock" pattern: bump on every write, readers compare before-and-after to detect concurrent modification. Building block for seqlocks, RCU, and STM.

### Use case: read-mostly stats snapshot

A long-running daemon that updates its statistics every few seconds and serves them on an HTTP endpoint. Updates are infrequent; reads are frequent. `atomic.Pointer[Stats]` is the perfect tool.

### Use case: per-route HTTP counter

Tens of routes, each wanting its own counter. `sync.Map[string]*atomic.Int64` plus a `LoadOrStore` is the textbook pattern.

### Use case: bytes-per-second meter

A counter that resets every second; an external scraper reads `Swap(0)` and reports the per-second rate. The CAS-loop version supports millisecond windows too.

---

## Code Examples

### CAS-loop maximum

```go
package counters

import "sync/atomic"

type Max struct{ v atomic.Int64 }

// Observe records x; the value stored becomes max(prev, x).
func (m *Max) Observe(x int64) {
    for {
        cur := m.v.Load()
        if x <= cur {
            return
        }
        if m.v.CompareAndSwap(cur, x) {
            return
        }
        // Lost the CAS; reread and retry.
    }
}

func (m *Max) Get() int64 { return m.v.Load() }
```

### CAS-loop running sum

For a "running average" you would track sum and count separately, but you cannot atomically update two `int64`s. Pack them:

```go
type Avg struct {
    state atomic.Uint64 // high 32 bits: count; low 32 bits: sum
}

func (a *Avg) Observe(x int32) {
    if x < 0 {
        x = 0
    }
    for {
        cur := a.state.Load()
        count := uint32(cur >> 32)
        sum := uint32(cur)
        next := uint64(count+1)<<32 | uint64(sum+uint32(x))
        if a.state.CompareAndSwap(cur, next) {
            return
        }
    }
}

func (a *Avg) Mean() float64 {
    cur := a.state.Load()
    count := uint32(cur >> 32)
    sum := uint32(cur)
    if count == 0 {
        return 0
    }
    return float64(sum) / float64(count)
}
```

This is correct but inelegant. For real averages you would use HDR histograms (professional level) or accept the slight cost of a mutex.

### `atomic.Pointer[T]` snapshot

```go
package metrics

import (
    "sync/atomic"
    "time"
)

type Snapshot struct {
    At        time.Time
    Requests  int64
    Errors    int64
    InFlight  int64
}

type Publisher struct {
    requests atomic.Int64
    errors   atomic.Int64
    inflight atomic.Int64
    current  atomic.Pointer[Snapshot]
}

func (p *Publisher) RecordRequest()      { p.requests.Add(1) }
func (p *Publisher) RecordError()        { p.errors.Add(1) }
func (p *Publisher) Inflight() func()    { p.inflight.Add(1); return func() { p.inflight.Add(-1) } }

func (p *Publisher) RefreshSnapshot() {
    s := &Snapshot{
        At:       time.Now(),
        Requests: p.requests.Load(),
        Errors:   p.errors.Load(),
        InFlight: p.inflight.Load(),
    }
    p.current.Store(s)
}

func (p *Publisher) Current() *Snapshot {
    return p.current.Load()
}
```

`RefreshSnapshot` should be called periodically (every second is typical). `Current` is wait-free — one atomic load.

Note: the three `Load()` calls inside `RefreshSnapshot` are not all at the same instant. The snapshot is an approximation. For exact consistency you would need a more elaborate scheme (versioned counters, RCU). For metrics, "approximate at second resolution" is the standard.

### `expvar` integration

```go
package server

import (
    "expvar"
    "net/http"
)

var (
    requests = expvar.NewInt("server_requests_total")
    inflight = expvar.NewInt("server_inflight")
    errors   = expvar.NewMap("server_errors")
)

func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    requests.Add(1)
    inflight.Add(1)
    defer inflight.Add(-1)
    if err := s.process(r); err != nil {
        errors.Add(classify(err), 1)
        http.Error(w, err.Error(), 500)
        return
    }
    w.Write([]byte("ok"))
}

func classify(err error) string {
    // map any error to a stable bucket name
    switch {
    case errors.Is(err, context.DeadlineExceeded):
        return "timeout"
    case errors.Is(err, io.EOF):
        return "eof"
    default:
        return "unknown"
    }
}
```

`server_errors` becomes a `Map` in JSON:

```json
"server_errors": { "timeout": 12, "unknown": 3 }
```

`Map.Add` is goroutine-safe; it uses an internal mutex around an `atomic.Int64` per key. The middle-level lesson: when you need per-key counts and the key set is unbounded, `expvar.Map` is the easy answer.

### A basic sharded counter

```go
package counters

import "sync/atomic"

const shards = 64

type Sharded struct {
    cells [shards]atomic.Int64
}

func (s *Sharded) Inc(shardKey uint64) {
    s.cells[shardKey%shards].Add(1)
}

func (s *Sharded) Get() int64 {
    var total int64
    for i := range s.cells {
        total += s.cells[i].Load()
    }
    return total
}
```

The shard key is the caller's responsibility. Typical choices:

- `uint64(runtime_procPin())` — the current P's index (runtime-private; senior topic)
- A goroutine-local random seed
- `uint64(uintptr(unsafe.Pointer(localObject)))` — address of some thread-local
- A "good enough" fast hash of the goroutine ID

A naive but workable choice is to use `rand.Uint64()` per increment — random shard selection. This loses the locality benefit of always hitting the same shard but is trivially uniform.

The senior file shows the *right* way to pick a shard, with padding for false sharing and per-P locality.

### A "sloppy" counter (preview)

A sloppy counter trades exact freshness for throughput. Each goroutine maintains a *local* counter that it can increment without any synchronisation; periodically, the local value is added to a global atomic.

```go
type Sloppy struct {
    global atomic.Int64
}

type LocalCounter struct {
    local  int64
    flush  int64
    parent *Sloppy
}

func (s *Sloppy) Local(flushAt int64) *LocalCounter {
    return &LocalCounter{flush: flushAt, parent: s}
}

func (l *LocalCounter) Inc() {
    l.local++
    if l.local >= l.flush {
        l.parent.global.Add(l.local)
        l.local = 0
    }
}

func (l *LocalCounter) Flush() {
    if l.local > 0 {
        l.parent.global.Add(l.local)
        l.local = 0
    }
}

func (s *Sloppy) Get() int64 {
    return s.global.Load()
}
```

Caveats:

- The `LocalCounter` is *not* safe to share across goroutines — each goroutine must hold its own.
- The global count lags reality by up to `flushAt - 1` per goroutine.
- You must call `Flush()` when the goroutine exits or the local count is lost.

Sloppy counters are the senior-level next step from sharded counters. Mentioned here so you know the term.

---

## Coding Patterns

### Pattern: increment-with-undo

```go
n := c.Add(1)
if n > limit {
    c.Add(-1)
    return ErrTooMany
}
```

Slight over-shoot: between the `Add` and the `Add(-1)`, the counter is briefly past the limit. Other concurrent increments might see this state. For an exact cap, use CAS:

```go
for {
    cur := c.Load()
    if cur >= limit {
        return ErrTooMany
    }
    if c.CompareAndSwap(cur, cur+1) {
        return nil
    }
}
```

### Pattern: snapshot-and-reset

```go
prev := c.Swap(0)
report(prev)
```

`Swap(0)` is atomic — you cannot lose increments between the read and the reset. Anything done after `Swap` is on the captured value `prev`; the counter is freshly zero.

### Pattern: publish-snapshot

For multi-field state, replace the whole struct atomically:

```go
type State struct { ... }
var state atomic.Pointer[State]

// publisher (rare):
state.Store(&newState)

// reader (frequent):
s := state.Load()
use(s)
```

### Pattern: per-key counter via `sync.Map`

```go
type Counters struct{ m sync.Map }

func (c *Counters) Inc(key string) {
    v, ok := c.m.Load(key)
    if !ok {
        v, _ = c.m.LoadOrStore(key, &atomic.Int64{})
    }
    v.(*atomic.Int64).Add(1)
}
```

For a fixed key set known at startup, use a `map[string]*atomic.Int64` built once — no `sync.Map` needed.

### Pattern: counter exposed via `expvar.Func` for derived metrics

```go
expvar.Publish("avg_request_size", expvar.Func(func() any {
    n := requestsTotal.Value()
    if n == 0 {
        return 0.0
    }
    return float64(bytesInTotal.Value()) / float64(n)
}))
```

`expvar.Func` evaluates at scrape time. Use it for computed metrics that you do not want to maintain incrementally.

### Pattern: sharded write, summed read

```go
type Sharded struct{ cells [N]atomic.Int64 }

func (s *Sharded) Inc(key uint64)     { s.cells[key%N].Add(1) }
func (s *Sharded) Get() (n int64)     {
    for i := range s.cells { n += s.cells[i].Load() }
    return
}
```

### Pattern: thread-local accumulation + periodic flush

```go
type local struct{ n int64 }

var localStats sync.Pool // pool of *local, one per goroutine

func record() {
    l := localStats.Get().(*local)
    l.n++
    if l.n >= 1024 {
        global.Add(l.n)
        l.n = 0
    }
    localStats.Put(l)
}
```

`sync.Pool` gives near-per-goroutine semantics. Not exact, but the GC will reclaim unused locals, which is desirable.

### Pattern: CAS-loop accumulator

```go
func atomicMax(p *atomic.Int64, x int64) {
    for {
        cur := p.Load()
        if x <= cur { return }
        if p.CompareAndSwap(cur, x) { return }
    }
}

func atomicMin(p *atomic.Int64, x int64) {
    for {
        cur := p.Load()
        if x >= cur { return }
        if p.CompareAndSwap(cur, x) { return }
    }
}

func atomicAddIfLT(p *atomic.Int64, delta, cap int64) bool {
    for {
        cur := p.Load()
        if cur+delta > cap { return false }
        if p.CompareAndSwap(cur, cur+delta) { return true }
    }
}
```

These three are the workhorses of middle-level lock-free counter code.

---

## Clean Code

### Wrap atomics in domain types

```go
// BAD: callers see raw atomics; easy to misuse.
var requestCount atomic.Int64

// GOOD: callers see a domain type with named operations.
type RequestCounter struct{ v atomic.Int64 }
func (r *RequestCounter) Increment()  { r.v.Add(1) }
func (r *RequestCounter) Value() int64 { return r.v.Load() }
```

### Document monotonicity in the type system, not just comments

```go
// MonotonicCounter never decreases.
type MonotonicCounter struct{ v atomic.Int64 }
func (m *MonotonicCounter) Inc() { m.v.Add(1) }
func (m *MonotonicCounter) Add(n uint64) { m.v.Add(int64(n)) } // never negative
func (m *MonotonicCounter) Value() int64 { return m.v.Load() }
// No Dec, no Set, no Reset.
```

### Name registry keys with care

`expvar` registrations live forever. Two packages registering the same name will panic at init. Establish a project-wide naming convention:

```
<service>_<subsystem>_<metric>_<unit>
```

e.g., `myapi_db_queries_total`, `myapi_cache_hits_total`, `myapi_inflight_requests`.

### Snapshot types are immutable

If you use `atomic.Pointer[Snapshot]`, declare `Snapshot` as a value with no setters. Each snapshot is "frozen" the moment it is published.

```go
type Snapshot struct {
    At        time.Time
    Requests  int64
    Errors    int64
    InFlight  int64
}
```

No methods that modify. If you need to derive a new snapshot, allocate a new one.

### Avoid global counters in libraries

A library that internally uses `expvar.NewInt("foo")` registers a globally-visible metric on import. That is rarely what library users want. Prefer to expose a `*Counters` struct that callers can register where they like:

```go
type Counters struct {
    Requests atomic.Int64
    Errors   atomic.Int64
}

func (c *Counters) RegisterTo(m *expvar.Map) {
    m.Set("requests", expvar.Func(func() any { return c.Requests.Load() }))
    m.Set("errors", expvar.Func(func() any { return c.Errors.Load() }))
}
```

---

## Product Use / Feature

### Admission control

`atomic.Int64` plus a CAS-loop cap gives you a perfect "max in-flight" gate.

### Quota enforcement

Per-user atomic counters with periodic reset. For low cardinality (a few users), `sync.Map[uid]*atomic.Int64`; for high cardinality, you need a distributed scheme (Redis INCR, database token bucket).

### Rate-derived metrics

Combine a counter with a periodic snapshotter to produce a per-second rate. Operations teams almost always want rates, not totals.

### Feature flag rollouts

A counter per (flag, bucket) tracks how often each variant was selected. `expvar.Map` is the natural fit.

### Per-tenant accounting

Counters per tenant for billing. Use sharded counters within a tenant if the tenant is hot; otherwise a single `atomic.Int64` per tenant is fine.

### Internal observability

Goroutine pools, channel depths, retry counts, breaker trips — all naturally counters. The middle-level shape is: one counter per state transition, summed at read time, exposed via `expvar`.

---

## Error Handling

Atomic operations cannot fail. CAS *can* "fail" — meaning the swap did not happen — but that is part of normal operation, not an error. Wrap CAS loops carefully:

```go
func (c *Capped) Inc() error {
    for {
        cur := c.v.Load()
        if cur >= c.max {
            return ErrAtCap
        }
        if c.v.CompareAndSwap(cur, cur+1) {
            return nil
        }
    }
}
```

The only "error" is hitting the cap. CAS loop retries are *not* errors.

For `expvar`, the failure modes are:

- `NewInt(name)` panics if `name` is already registered. Catch this at init.
- The HTTP handler can panic if a `Func`-backed var panics during serialisation. Always recover in custom `Func` implementations.
- The default `/debug/vars` is wired to `http.DefaultServeMux`. If you also serve user traffic on the default mux, you have leaked your metrics. Always use a dedicated `http.ServeMux` for `/debug/*`.

---

## Security Considerations

### Counter-based authorisation is fragile

"Allow the third request from this user" using a per-user atomic counter has race windows. Two requests arriving simultaneously may both see the count at 2, both CAS to 3, and the third request is not the "third" one — it is the first to succeed. For real authorisation, use explicit per-session state with proper synchronisation, not raw counters.

### Exposing `expvar` to the public internet

`/debug/vars` reveals all your metrics — request volumes, error rates, internal state. Attackers can profile your service from outside. Always authenticate `/debug/*` or bind it to a private interface.

### Counter overflow as a DoS vector

If an attacker can drive a counter at line rate, can they overflow it? `int64` is impractical to overflow (~292 years at 1 billion ops/sec). But `int32` (~4 billion ops, achievable in tens of minutes at peak) is risky. Use `int64` unless you have a specific reason not to.

### Information leakage through timing

A CAS loop that retries under contention has *measurable* timing variance. In theory an attacker can use this as a side channel to infer concurrent load. In practice, this matters for cryptographic counters but rarely for application metrics.

### Don't log raw counter values per request

Including a global counter value in every request log line can reveal request ordering to anyone who reads the logs. Not always a problem, but worth thinking about for sensitive deployments.

---

## Performance Tips

### Bench, do not guess

Every claim in this section should be re-verified on your hardware:

```go
func BenchmarkAtomicAdd(b *testing.B) {
    var c atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Add(1)
        }
    })
}
```

Run with `-cpu=1,2,4,8,16,32`. Watch ops/sec per CPU drop as parallelism grows. That drop is your contention cost — and the motivation for sharding.

### Atomic ops are ~5 ns each, but not free

A single uncontended atomic add is 5–15 ns on modern x86-64. Under contention it can be hundreds of nanoseconds. Mutex Lock/Unlock is 25–50 ns uncontended; under contention it can blow up to microseconds or more (if it ends up parking goroutines).

### `Load` is cheaper than `Add`

A bare `Load` is typically a single MOV with an acquire fence — half the cost of an `Add` (which involves a `LOCK XADD`). If you can replace many `Add(1)`s with a single accumulated `Add(n)`, do it.

### `Swap` is cheaper than `Load` + `Store` combined

Plus it is atomic with respect to other operations. Always prefer `Swap`.

### CAS loops are cheap in low contention, expensive in high contention

Under low contention, a CAS loop almost always succeeds first try and is the same cost as an `Add`. Under high contention, retries waste CPU. If your CAS is failing more than ~50% of the time, you have a contention problem that sharding (or a mutex with backoff) might solve better.

### Shard count: 2–4× the number of cores

Too few shards: still contention. Too many shards: cache-thrashing on the read path. 64 is a defensible default for most workloads. 16 for low core counts (4–8 cores). 256 only for very-large boxes (64+ cores).

### Read latency matters less than write latency

If reads happen once per scrape (every 15 seconds), spending 1 microsecond summing 1024 shards is fine. If reads happen on every request, sum fewer shards or use a periodic-snapshot pattern.

---

## Best Practices

- **Default to `atomic.Int64`.** Reach for fancier patterns only when measurement shows a problem.
- **Use `CompareAndSwap` for read-modify-write where the new value depends on the old.**
- **Use `atomic.Pointer[T]` for multi-field consistent snapshots.**
- **Use `expvar` for "expose me to the operators with no ceremony".**
- **Use a dedicated `ServeMux` for `/debug/*`; never expose the default mux publicly.**
- **Document monotonicity in the type system if possible.**
- **Benchmark with `-cpu` to confirm scaling behaviour.**
- **Avoid registering metrics in `init()` from a library — let the caller register.**
- **Always use pointer receivers for atomic-bearing structs.**
- **`go vet` warnings about copying atomics are never spurious.**

---

## Edge Cases & Pitfalls

### CAS loop on a hot location

If 32 goroutines are all CAS-looping the same counter, most retries will fail. Throughput collapses. Solutions: switch to plain `Add` if you only need increment; shard; or use a mutex with backoff.

### ABA in CAS loops on pointers

If a CAS loops on a pointer that goes from A to B and back to A between read and CAS, the CAS succeeds — but the meaning of A may have changed. For counters this is rarely an issue (counts going down and back up is suspicious anyway); for pointer-based data structures it requires versioned pointers or epoch-based reclamation. Senior topic.

### `atomic.Pointer[T]` swap leaves old snapshot allocated

Until the last reader drops the old snapshot, it stays in memory. Long-lived readers can pin many generations of snapshots. Mitigation: short-lived readers, snapshot size budget, periodic forced refresh.

### `expvar.Int.Set` is non-atomic-relative-to-Add

`Set(x)` is `atomic.StoreInt64`; `Add(y)` is `atomic.AddInt64`. If two goroutines do `Set(0)` and `Add(1)` simultaneously, the result is one of {0, 1} depending on order. This is "atomic" in the safety sense but not "atomic" in the transaction sense. For "reset and resume", use `Swap(0)`.

### Sharded counter shard skew

If your shard-key choice is correlated with which goroutine is hot (e.g., always shard 0 because the hash of the master goroutine ID is 0), you have not solved contention. Verify shard balance empirically.

### `expvar.Map.Init()` vs `expvar.NewMap`

`NewMap(name)` registers globally; `Init()` initialises an existing map without registering. Mixing them in tests is a source of "duplicate name" panics. Use `NewMap` once at process startup, `Init` never (for most cases).

### `atomic.Int64{}.Add` on a copy

Copying a struct that holds an `atomic.Int64` is a bug `go vet` will flag. Confirmed by reading: every method must be on a pointer receiver.

### `atomic.Pointer[T]` to nil

`Load()` on a never-Stored `atomic.Pointer[T]` returns `nil`. Always handle that case:

```go
s := state.Load()
if s == nil {
    s = &Snapshot{} // safe default
}
```

### Snapshot publisher that itself races

The publisher reads all the underlying atomics and packages them into a snapshot. If the underlying atomics are still being updated, the snapshot reflects a slightly inconsistent moment. For metrics, this is acceptable; for transactional state, it is not.

---

## Common Mistakes

1. **Using `Load` + `Store` instead of `Swap` for reset.** Loses increments in between.
2. **CAS-looping on a field that is also `Add`-updated by others.** The CAS keeps failing.
3. **Registering the same `expvar` name twice.** Panic at init.
4. **Holding a mutex while calling `expvar.Int.Add`.** The mutex is unnecessary; remove it.
5. **Forgetting to `Flush()` a sloppy counter on goroutine exit.** Up to `flushAt` increments are lost.
6. **Using sharded counters when an unsharded counter is fine.** Premature optimisation.
7. **Snapshotting a multi-counter struct with multiple `Load`s instead of `atomic.Pointer[T]`.** Inconsistent snapshots.
8. **`expvar` exposed on default mux that is also the public mux.** Information leak.
9. **`int32` counter that can be driven to overflow.** DoS vector.
10. **Treating CAS failure as an error.** It is not; just retry.

---

## Common Misconceptions

- **"CAS is wait-free."** It is *lock-free*, not wait-free. Some goroutines may retry many times; only the system as a whole is guaranteed to make progress.
- **"`atomic.Pointer[T]` is free."** It allocates on every `Store` (you allocated the struct yourself). GC pressure is real.
- **"`expvar` is for production monitoring."** It is fine for low-traffic JSON-scraping monitoring but not as scalable or expressive as Prometheus client libraries. Use as a "starter" tool.
- **"Sharded counters always help."** Not at low contention. They add read cost and code complexity for no benefit unless you have measured contention.
- **"Sloppy counters lose data."** They lose *freshness*, not correctness — the total is right once everyone flushes.

---

## Tricky Points

### `CompareAndSwap` returns whether the swap happened

```go
if !c.CompareAndSwap(0, 1) {
    // someone else has already set it
}
```

The boolean is the only signal. There is no "previous value" returned by Go's CAS API; if you need both, use `Swap` (which atomically replaces and returns the prior value).

### `atomic.Pointer[T]` is a value, not a pointer

```go
var p atomic.Pointer[State] // a value containing a pointer
p.Store(&State{})           // OK
```

The type itself contains the pointer. Do not pass an `atomic.Pointer[State]` by value — that copies the embedded atomic, which is a bug.

### `expvar` is initialised lazily

`expvar.NewInt("foo")` may not be visible at `/debug/vars` until you actually call `http.ListenAndServe` (which triggers the side-effect registration via `init`). In tests, force-import `_ "expvar"` to register.

### `expvar.Map.Add` does an atomic op per call

You might be tempted to grab the inner `*atomic.Int64` and call `Add` directly:

```go
v := stats.Get("foo")
if v == nil {
    stats.Set("foo", new(expvar.Int))
    v = stats.Get("foo")
}
v.(*expvar.Int).Add(1)
```

Beware races between `Get` and `Set`. The `Add(key, delta)` method on `expvar.Map` is atomic; prefer it.

### Sharded counter alignment

If your shards live in adjacent memory (e.g., `[64]atomic.Int64`), several may share the same 64-byte cache line. False sharing! Senior file shows the padded version.

### CAS-loop livelock

In the worst case, all goroutines may keep retrying without anyone making progress. Probability is low but non-zero. The standard mitigation is exponential backoff inside the loop:

```go
backoff := time.Nanosecond
for {
    cur := p.Load()
    next := compute(cur)
    if p.CompareAndSwap(cur, next) {
        return
    }
    time.Sleep(backoff)
    backoff *= 2
}
```

Rarely needed in practice for simple counters, but worth knowing.

### Snapshot freshness vs cost

How often should you `RefreshSnapshot`? Too often and you waste CPU on snapshot work; too rare and operators see stale data. Match scrape interval (typically 5–15s for Prometheus).

---

## Test

```go
package counters

import (
    "sync"
    "sync/atomic"
    "testing"
)

func TestMax_Observe(t *testing.T) {
    var m Max
    var wg sync.WaitGroup
    for i := int64(0); i < 100; i++ {
        i := i
        wg.Add(1)
        go func() { defer wg.Done(); m.Observe(i) }()
    }
    wg.Wait()
    if got := m.Get(); got != 99 {
        t.Errorf("expected 99, got %d", got)
    }
}

func TestCAS_Capped(t *testing.T) {
    c := &Capped{max: 100}
    var ok atomic.Int64
    var fail atomic.Int64
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            if c.Inc() { ok.Add(1) } else { fail.Add(1) }
        }()
    }
    wg.Wait()
    if got := ok.Load(); got != 100 {
        t.Errorf("expected 100 successes, got %d", got)
    }
    if got := fail.Load(); got != 900 {
        t.Errorf("expected 900 failures, got %d", got)
    }
}

func TestSharded(t *testing.T) {
    var s Sharded
    var wg sync.WaitGroup
    for i := uint64(0); i < 10000; i++ {
        i := i
        wg.Add(1)
        go func() { defer wg.Done(); s.Inc(i) }()
    }
    wg.Wait()
    if got := s.Get(); got != 10000 {
        t.Errorf("expected 10000, got %d", got)
    }
}

func BenchmarkSingleAtomic(b *testing.B) {
    var c atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Add(1)
        }
    })
}

func BenchmarkSharded(b *testing.B) {
    var s Sharded
    var key uint64
    b.RunParallel(func(pb *testing.PB) {
        myKey := atomic.AddUint64(&key, 1)
        for pb.Next() {
            s.Inc(myKey)
        }
    })
}
```

Run both benchmarks at `-cpu=1,8,32` and watch the ratio. At `-cpu=1`, single-atomic wins (no contention; sharded pays extra for shard lookup). At `-cpu=32`, sharded should be 5–20× faster.

---

## Tricky Questions

**Q: What happens if a CAS loop runs forever?**
A: In theory, livelock — possible but extremely rare for simple counters. In practice, exponential backoff or switching to a mutex when contention is detected solves it. Lock-free algorithms are still *guaranteed to make progress* overall — at least one operation succeeds per cycle — but individual operations can starve.

**Q: Is `atomic.Pointer[T].Load()` wait-free?**
A: Yes — single atomic load, never retries, never blocks. The most predictable read primitive Go offers.

**Q: Why doesn't Go provide a typed `atomic.Map`?**
A: `sync.Map` exists; it is mutex-and-atomic-based, not fully atomic. A truly atomic map (CAS on the whole table) would have poor write performance. The standard library's choice is the right trade-off.

**Q: Does `expvar.Int.Add` work concurrently with `expvar.Int.Set`?**
A: Yes — both go through `atomic.AddInt64` / `atomic.StoreInt64`. But the result is the *last writer wins* in the temporal sense; concurrent `Set` and `Add` can produce any value in `{x, x+delta}` depending on ordering. Sequence them carefully.

**Q: How do I monitor a sharded counter without expensive reads?**
A: Either (a) accept the O(shards) read cost (cheap for shards ≤ 1024); (b) maintain a published snapshot updated by a background goroutine.

**Q: Can I use `atomic.Pointer[T]` to implement copy-on-write?**
A: Yes — it is the textbook implementation. Read the old snapshot, copy with modifications, CAS the pointer. Retry on CAS failure.

**Q: What's the difference between `expvar.Map` and a `sync.Map` of `atomic.Int64`?**
A: `expvar.Map` exposes to `/debug/vars` automatically and uses a mutex (not lock-free). `sync.Map[string, *atomic.Int64]` is faster for hot keys but you have to expose it yourself.

**Q: When should I use `expvar` over Prometheus client lib?**
A: `expvar` for tiny services, internal tools, and "just give me a JSON endpoint". Prometheus for production-scale, multi-label, multi-histogram metrics. They can coexist.

**Q: Can I use atomics to implement a queue?**
A: Yes — Michael-Scott queue, LMAX Disruptor, ring buffers — all are atomic-based. They are not simple; senior/professional topic. For most use cases, `chan` is the right answer.

**Q: Is `atomic.Pointer[T].CompareAndSwap` ABA-safe?**
A: No — if a pointer goes A → B → A, the CAS sees it as unchanged. For counter-like uses this is rarely an issue (you usually use `atomic.Int64` for counters, not pointers). For pointer-based data structures, you need versioned pointers or hazard pointers — senior/professional topic.

**Q: Why does `expvar.Float` exist when `atomic` doesn't have a `Float64`?**
A: It uses `atomic.Uint64` plus `math.Float64bits` / `math.Float64frombits` to store and load. The same trick works for any non-int atomic.

---

## Cheat Sheet

```go
// CAS loop
for {
    cur := v.Load()
    if !canApply(cur, x) { return }
    if v.CompareAndSwap(cur, apply(cur, x)) { return }
}

// Snapshot publisher
var snap atomic.Pointer[State]
snap.Store(&State{...}) // publish
s := snap.Load()        // read

// expvar
var c = expvar.NewInt("name")
c.Add(1)
c.Value()

// Sharded
var s [64]atomic.Int64
s[key%64].Add(1)
total := int64(0)
for i := range s { total += s[i].Load() }
```

| Need | Pattern |
|------|---------|
| Cap-enforced increment | CAS-loop |
| Max/min tracker | CAS-loop |
| Snapshot of multiple counters | `atomic.Pointer[T]` |
| Per-key counter, unknown keys | `sync.Map` of `*atomic.Int64` |
| Per-key counter, known at startup | `map[string]*atomic.Int64` built once |
| JSON metric endpoint | `expvar` |
| High-contention counter | sharded (junior to senior bridge) |
| Latency distribution | HDR histogram (professional) |

---

## Self-Assessment Checklist

- [ ] I can write a CAS loop for max/min/cap-enforced increment without looking it up
- [ ] I can explain when `Swap(0)` is correct and when `Load()`+`Store(0)` is broken
- [ ] I can use `atomic.Pointer[T]` for multi-field snapshots
- [ ] I have written a small `expvar`-backed metrics endpoint
- [ ] I understand the difference between counter and histogram
- [ ] I know the basic shape of a sharded counter and when it helps
- [ ] I can write a benchmark with `RunParallel` and read its scaling
- [ ] I know when *not* to shard

---

## Summary

The middle level of concurrent counters is about composition and exposure: composing multiple atomics into consistent snapshots (`atomic.Pointer[T]`), composing read-modify-write into lock-free operations (CAS loops), composing per-key counters (`sync.Map` + atomic), and exposing all of it to operators (`expvar`).

The basic sharded counter sits at the bridge between middle and senior. It is the answer to "my one atomic is the bottleneck"; the senior file refines it with cache-line padding, sloppy / per-CPU semantics, and `LongAdder`-style dynamic sharding.

The professional file completes the story with HDR histograms (for distributions, not just counts), NUMA-aware shard placement, and the design of an observability subsystem that exposes everything to Prometheus, OpenTelemetry, and custom backends — all built on the primitives you learned here.

---

## What You Can Build

- A cap-enforced admission controller
- A leader election by atomic stamp
- A multi-field snapshot publisher
- An HTTP server with `expvar`-exposed metrics
- A sharded counter (basic; the senior version is harder)
- A per-route HTTP counter with `sync.Map`
- A `MaxLatencyTracker` with CAS-loop max
- A sloppy counter (the senior file polishes this)
- A read-mostly state publisher

---

## Further Reading

- `sync/atomic` package docs: <https://pkg.go.dev/sync/atomic>
- `expvar` package docs: <https://pkg.go.dev/expvar>
- The Go memory model: <https://go.dev/ref/mem>
- Russ Cox, "Updating the Go Memory Model" (2021): <https://research.swtch.com/gomm>
- Maurice Herlihy & Nir Shavit, *The Art of Multiprocessor Programming* — chapters on CAS and lock-free algorithms
- Doug Lea's `java.util.concurrent.LongAdder` source (for inspiration on dynamic sharding)
- LMAX Disruptor papers on cache-aware concurrent data structures

---

## Related Topics

- Junior counters (this file's prerequisite)
- Senior counters (cache-line padding, sharded counters in depth, sloppy counters)
- Professional counters (HDR histograms, expvar+Prometheus integration, NUMA)
- `atomic.Pointer[T]` (broader use beyond snapshots)
- `sync.Map`
- The Go race detector
- Memory ordering in the Go memory model
- Lock-free data structures (queues, stacks)
- RCU and epoch-based reclamation (advanced)

---

## Diagrams & Visual Aids

### CAS loop flow

```
read current value
  |
  v
compute desired new value
  |
  v
attempt CAS(current, new)
  |
  +----- success: return
  |
  +----- failure: someone changed it; restart
```

### Snapshot publisher

```
+-------------+       +-------------+       +-------------+
| publisher   | ----> | atomic.     | <---- | reader      |
| (1/sec)     |       | Pointer[S]  |       | (frequent)  |
+-------------+       +-------------+       +-------------+
       |                     ^                     |
       v                     |                     v
   allocates              swaps in                Load()
   new Snapshot           atomically              returns
                                                  current S
```

### Sharded counter

```
goroutine A --hash--> shard 3 ----+
goroutine B --hash--> shard 7 ----|
goroutine C --hash--> shard 3 ----|----- sum at read time ----> total
goroutine D --hash--> shard 1 ----|
goroutine E --hash--> shard 9 ----+
```

### `expvar` registry

```
init():                              GET /debug/vars:
  expvar.NewInt("requests")
  expvar.NewInt("errors")            for each name in registry:
  expvar.NewMap("by_route")            write name, JSON value
                                     (memstats, cmdline auto-included)
```

That is the middle-level toolkit. The senior file picks up at the question "but why does my sharded counter scale only 4×, not 16×?" The answer is cache-line padding, and the rabbit hole goes deep.

---

## Deep Dive: CAS in Detail

The CAS instruction is the single most important primitive in modern concurrent programming. Almost every lock-free algorithm boils down to one or more CAS loops. Understanding it deeply pays off forever.

### What the hardware does

`CMPXCHG` on x86-64 (with the `LOCK` prefix for atomicity across cores) compares the value at a memory address with a value in the AX register. If equal, the register's content is stored to memory; if not, the memory value is loaded into AX. Either way, the result is reported via the zero flag (ZF).

```
LOCK CMPXCHG [counter], ebx   ; if [counter] == eax, [counter] <- ebx; else eax <- [counter]
```

The `LOCK` prefix means: for the duration of this instruction, the cache line containing `[counter]` is exclusively owned. No other CPU may read or write it. This is what makes the operation atomic.

On ARMv8.1+ there is `LDADD`-style atomic that does load-add-store as one operation. On older ARM cores, CAS is built from `LDREX`/`STREX` (load-exclusive / store-exclusive) — the CPU monitors whether anyone else touched the cache line between LDREX and STREX, and STREX fails if so:

```
loop:
  LDREX r0, [counter]    ; load with exclusive monitor
  CMP   r0, r1            ; compare with expected
  BNE   fail              ; not equal, return false
  STREX r2, r3, [counter] ; store new value if monitor still set
  CBNZ  r2, loop          ; STREX failed (someone interfered); retry
  MOV   r0, #1            ; success
fail:
  ...
```

Notice how the ARM "single CAS" is actually a retry loop in the instruction set itself. The `sync/atomic` package wraps this so you never see it.

### Why CAS loops are needed

A single CAS is *one attempt*. The CAS loop turns that into a logical "atomic update with a computed new value". The compute is *not* protected by the CAS — it sees only the cur value at the moment of the read. If anyone else changes the value between your read and your CAS, your CAS fails and you start over.

```go
for {
    cur := v.Load()
    next := f(cur)      // computation outside any lock
    if v.CompareAndSwap(cur, next) {
        return next
    }
    // Lost; cur is stale; reread.
}
```

This is the structure. It is universal. Memorise it.

### When CAS loops are the wrong tool

- **Long compute between read and CAS.** The longer `f(cur)` takes, the more likely someone else will win the race. Throughput drops.
- **Pointer-based ABA.** If `cur` and `next` are pointers and `cur` could be reallocated between your read and your CAS, the CAS may succeed despite the meaning having changed.
- **Multi-word atomicity.** CAS works on one word. Multi-word CAS exists in hardware (DCAS, LL/SC variants) but is not exposed by Go.
- **High contention.** A live-locking CAS storm at 32 cores is worse than a mutex. The mutex parks losers; CAS keeps them spinning.

### CAS loop with limited retries

In rare cases you want to give up if CAS keeps failing — for instance, an admission controller that should not spin forever:

```go
const maxRetries = 10

func (c *Capped) IncWithLimit() bool {
    for i := 0; i < maxRetries; i++ {
        cur := c.v.Load()
        if cur >= c.max {
            return false
        }
        if c.v.CompareAndSwap(cur, cur+1) {
            return true
        }
    }
    return false // assume overload
}
```

Use sparingly. Returning `false` after maxRetries is a heuristic, not a correctness guarantee.

### CAS loop with exponential backoff

Under extreme contention, spinning hurts everyone. Adding a tiny backoff helps:

```go
func (m *Max) Observe(x int64) {
    backoff := 1
    for {
        cur := m.v.Load()
        if x <= cur {
            return
        }
        if m.v.CompareAndSwap(cur, x) {
            return
        }
        for i := 0; i < backoff; i++ {
            runtime.Gosched()
        }
        if backoff < 1024 {
            backoff *= 2
        }
    }
}
```

`runtime.Gosched()` yields to other goroutines, giving the contender a chance to publish. Doubling the wait time reduces overall contention. Rarely necessary for counters; very useful for high-contention data structures.

### Spurious-failure CAS variants

Some platforms have a "weak CAS" that can fail even when the value matches, in exchange for slightly cheaper execution. Go's `CompareAndSwap` is the *strong* form on all platforms — it fails only if the value differs. You do not need to worry about spurious failure.

---

## Deep Dive: `atomic.Pointer[T]` and Snapshot Patterns

### The shape

```go
var snap atomic.Pointer[Snapshot]

// publisher
new := buildSnapshot()
snap.Store(new) // atomic

// reader
s := snap.Load() // atomic
use(s)
```

The snapshot itself must be immutable after `Store`. If you ever mutate a published snapshot, a reader may see a half-updated state.

### Copy-on-write update

```go
func (m *Metrics) update(fn func(s Snapshot) Snapshot) {
    for {
        cur := m.snap.Load()
        var curVal Snapshot
        if cur != nil {
            curVal = *cur
        }
        next := fn(curVal)
        if m.snap.CompareAndSwap(cur, &next) {
            return
        }
    }
}

// usage
m.update(func(s Snapshot) Snapshot {
    s.Requests++
    s.LastAt = time.Now()
    return s
})
```

Every update allocates a new `Snapshot`. Concurrent updates retry. The result: a fully consistent multi-field state, updated atomically.

Cost: allocation per update. For metrics updated thousands of times per second, this is too expensive — prefer separate `atomic.Int64`s and snapshot-by-copy at scrape time. For state updated rarely (configuration changes, leader elections), copy-on-write via `atomic.Pointer[T]` is excellent.

### The seqlock alternative

For data that is written rarely and read frequently, a *seqlock* can outperform `atomic.Pointer[T]` by avoiding allocations:

```go
type SeqLock struct {
    seq  atomic.Uint64
    data Snapshot // protected by seq's parity
}

func (s *SeqLock) Write(fn func(*Snapshot)) {
    s.seq.Add(1)  // make odd
    fn(&s.data)
    s.seq.Add(1)  // make even
}

func (s *SeqLock) Read() Snapshot {
    for {
        v1 := s.seq.Load()
        if v1%2 == 1 {
            continue // write in progress
        }
        d := s.data // copy
        v2 := s.seq.Load()
        if v1 == v2 {
            return d
        }
        // changed during read; retry
    }
}
```

Caveats: the reader is *not* lock-free in the strict sense (it may retry forever if writes are constant), and the data copy can be expensive for large structs. For small, frequently-read snapshots, seqlocks are excellent. For Go specifically, `atomic.Pointer[T]` is simpler and usually fast enough. Seqlocks are more common in the Linux kernel and embedded systems.

### `atomic.Value`: the predecessor

Before `atomic.Pointer[T]` (Go 1.19+) there was `atomic.Value` — an untyped, interface-based atomic-stored value. It still works:

```go
var snap atomic.Value
snap.Store(&Snapshot{...})
s := snap.Load().(*Snapshot)
```

The downsides vs `atomic.Pointer[T]`:

- Type-asserted on every Load — runtime cost and no compile-time safety.
- Once you call `Store(x)`, all subsequent `Store`s must be the same concrete type — accidental mismatch panics.
- No `CompareAndSwap` method (until Go 1.17 added it; the typed `Pointer[T]` is still cleaner).

In new code, prefer `atomic.Pointer[T]`. In old code, leave `atomic.Value` alone unless refactoring nearby.

---

## Deep Dive: Reading `expvar` Source

The entire `expvar` package is ~250 lines. Read it. Some excerpts (paraphrased):

```go
// expvar.Int
type Int struct {
    i atomic.Int64
}

func (v *Int) Value() int64       { return v.i.Load() }
func (v *Int) String() string {
    return strconv.FormatInt(v.i.Load(), 10)
}
func (v *Int) Add(delta int64) { v.i.Add(delta) }
func (v *Int) Set(value int64) { v.i.Store(value) }
```

```go
// expvar.Float
type Float struct {
    f atomic.Uint64 // store float64 bits
}

func (v *Float) Value() float64 {
    return math.Float64frombits(v.f.Load())
}
func (v *Float) Add(delta float64) {
    for {
        cur := v.f.Load()
        nxtVal := math.Float64frombits(cur) + delta
        nxt := math.Float64bits(nxtVal)
        if v.f.CompareAndSwap(cur, nxt) {
            return
        }
    }
}
```

Notice: `Float.Add` is a *CAS loop* because there is no atomic float-add instruction. Under contention this can be much slower than `Int.Add`. Knowing this helps: if you find yourself adding to an `expvar.Float` from many goroutines, consider keeping it as `Int` of nanoseconds (for time) or basis-points (for ratios) and converting at read time.

```go
// expvar.Map
type Map struct {
    m      sync.Map // map[string]Var
    keysMu sync.RWMutex
    keys   []string // sorted; for stable iteration
}

func (v *Map) Add(key string, delta int64) {
    i, ok := v.m.Load(key)
    if !ok {
        var dup bool
        i, dup = v.m.LoadOrStore(key, new(Int))
        if !dup {
            v.addKey(key)
        }
    }
    if iv, ok := i.(*Int); ok {
        iv.Add(delta)
    }
}
```

`Map.Add` is the double-checked load-or-store pattern, with the inner increment delegated to `Int.Add` (atomic). Reading this teaches you the idiomatic concurrent map+counter combo for free.

```go
// expvar.Func
type Func func() any
func (f Func) Value() any   { return f() }
func (f Func) String() string {
    v, _ := json.Marshal(f())
    return string(v)
}
```

`Func` is the bridge from "I have a derived value" to "I need to expose it as JSON". The function runs at scrape time.

```go
// expvar's HTTP handler
func expvarHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json; charset=utf-8")
    fmt.Fprintf(w, "{\n")
    first := true
    Do(func(kv KeyValue) {
        if !first { fmt.Fprintf(w, ",\n") }
        first = false
        fmt.Fprintf(w, "%q: %s", kv.Key, kv.Value)
    })
    fmt.Fprintf(w, "\n}\n")
}
```

That is the whole "metrics endpoint". A `Do(func)` iterates the global registry, calling your callback for each registered variable. The handler formats them as a JSON object.

The entire metrics-exposure pattern of Go's standard library fits in this short snippet. Operational simplicity has a price (limited expressivity — no histograms, no labels) but the price is often worth paying.

---

## Deep Dive: Building Your Own Registry

If `expvar` is too limited (you want labels, you want histograms, you want Prometheus format), you can roll your own — but it is more work than you think. The basic shape:

```go
package metrics

import (
    "encoding/json"
    "io"
    "sort"
    "strings"
    "sync"
)

type Metric interface {
    WriteTo(w io.Writer, name string) error
}

type Registry struct {
    mu sync.RWMutex
    m  map[string]Metric
}

func New() *Registry { return &Registry{m: map[string]Metric{}} }

func (r *Registry) Register(name string, m Metric) {
    r.mu.Lock()
    defer r.mu.Unlock()
    if _, ok := r.m[name]; ok {
        panic("metrics: duplicate name: " + name)
    }
    r.m[name] = m
}

func (r *Registry) Names() []string {
    r.mu.RLock()
    defer r.mu.RUnlock()
    names := make([]string, 0, len(r.m))
    for n := range r.m {
        names = append(names, n)
    }
    sort.Strings(names)
    return names
}

func (r *Registry) WriteJSON(w io.Writer) error {
    r.mu.RLock()
    defer r.mu.RUnlock()
    io.WriteString(w, "{\n")
    first := true
    for _, name := range r.sortedNames() {
        if !first {
            io.WriteString(w, ",\n")
        }
        first = false
        b, _ := json.Marshal(name)
        w.Write(b)
        io.WriteString(w, ": ")
        if err := r.m[name].WriteTo(w, name); err != nil {
            return err
        }
    }
    io.WriteString(w, "\n}\n")
    return nil
}

func (r *Registry) sortedNames() []string {
    names := make([]string, 0, len(r.m))
    for n := range r.m {
        names = append(names, n)
    }
    sort.Strings(names)
    return names
}
```

Now you can add a Counter that writes a Prometheus-format line:

```go
type PromCounter struct {
    v     atomic.Int64
    help  string
}

func (c *PromCounter) WriteTo(w io.Writer, name string) error {
    fmt.Fprintf(w, "# HELP %s %s\n", name, c.help)
    fmt.Fprintf(w, "# TYPE %s counter\n", name)
    fmt.Fprintf(w, "%s %d\n", name, c.v.Load())
    return nil
}
```

Etc. for `Gauge`, `Histogram`, `Summary`. The point: registries are *not* magic. The hard work is in the metric *types* (especially histograms, professional level), not the registry.

For production, use Prometheus's `client_golang` instead of rolling your own — it handles edge cases, multi-process gathering, label cardinality limits, and dozens of other concerns. Roll your own only as a teaching exercise or for very constrained deployments.

---

## Deep Dive: Sharded Counter Design Choices

### Choice 1: shard count

Too few shards → contention persists. Too many → false sharing on the read path, GC pressure, memory waste.

| Cores | Reasonable shard count |
|-------|-----------------------|
| 1-4   | unsharded (1)         |
| 4-16  | 16                    |
| 16-64 | 64                    |
| 64+   | 128 or 256            |

A common compromise: 64. Fits in 4096 bytes (with padding to 64-byte lines), uniformly maps to most core counts via modulo, and reads are cheap (64 atomic loads ~ 200 ns).

### Choice 2: shard key

The key determines which shard a goroutine writes to. Options:

- **Random per call.** `rand.Intn(N)`. Uniform but loses locality; every increment touches a different shard.
- **Random per goroutine.** Each goroutine picks a shard once and sticks to it. Better locality; risk of skew if goroutine count is small.
- **`runtime_procPin`.** The current P (processor) index. Per-CPU, uniform under heavy load, best locality. Requires runtime-private API (senior).
- **Hash of goroutine address.** `uintptr(unsafe.Pointer(&local)) % N`. Cheap, stable per goroutine, no API leak.

For most middle-level uses, random-per-goroutine is the sweet spot of simplicity and effectiveness.

### Choice 3: padding (preview)

A naive `[64]atomic.Int64` puts shards 0 and 1 in the same cache line. When two cores hit them, they ping-pong the line even though they are "different" shards. Padding the shards out to one cache line each fixes this. Senior topic.

### Choice 4: read aggregation

`Get()` sums all shards. Cost is O(N). For N=64 this is ~200 ns. If `Get` is rare (every 15s for a Prometheus scrape), this is irrelevant. If `Get` is hot (every request), consider a periodic-snapshot pattern.

### Code: a "good enough" middle-level sharded counter

```go
package counters

import (
    "math/rand/v2"
    "sync/atomic"
)

const shards = 64

type Sharded struct {
    cells [shards]atomic.Int64
}

func (s *Sharded) Inc() {
    s.cells[rand.IntN(shards)].Add(1)
}

func (s *Sharded) Add(delta int64) {
    s.cells[rand.IntN(shards)].Add(delta)
}

func (s *Sharded) Get() int64 {
    var total int64
    for i := range s.cells {
        total += s.cells[i].Load()
    }
    return total
}

func (s *Sharded) Reset() int64 {
    var total int64
    for i := range s.cells {
        total += s.cells[i].Swap(0)
    }
    return total
}
```

`rand.IntN` (math/rand/v2) is per-goroutine internally. Use v2, not the old `math/rand` which contends on a global RNG.

This sharded counter is significantly faster than a single atomic at 32 cores (5-10× on typical workloads). It is *not* the fastest possible — that requires cache-line padding (senior) and per-CPU sharding (senior). But it is a huge improvement and easy to ship.

---

## Deep Dive: Building a Periodic Reporter

A common pattern: counters accumulate, and a goroutine periodically emits the values to a sink (log, network, file). Here is a clean implementation:

```go
package metrics

import (
    "context"
    "log"
    "sync"
    "sync/atomic"
    "time"
)

type Reporter struct {
    interval time.Duration
    counters []*expvar.Int
    names    []string
    mu       sync.Mutex
    onValue  func(name string, value int64)
}

func NewReporter(interval time.Duration, onValue func(name string, value int64)) *Reporter {
    return &Reporter{interval: interval, onValue: onValue}
}

func (r *Reporter) Add(name string, c *expvar.Int) {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.counters = append(r.counters, c)
    r.names = append(r.names, name)
}

func (r *Reporter) Run(ctx context.Context) {
    t := time.NewTicker(r.interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            r.mu.Lock()
            for i, c := range r.counters {
                r.onValue(r.names[i], c.Value())
            }
            r.mu.Unlock()
        }
    }
}
```

Notice: the reporter holds a mutex during the snapshot to avoid the counter slice growing mid-iteration. Counters are still updated freely while the reporter runs — they are atomic.

A common variant uses `Swap(0)` instead of `Value()` for "per-interval rate":

```go
type rateReporter struct {
    interval time.Duration
    counters []*atomic.Int64
    names    []string
    onRate   func(name string, perSec float64)
}

func (r *rateReporter) Run(ctx context.Context) {
    t := time.NewTicker(r.interval)
    defer t.Stop()
    secs := r.interval.Seconds()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            for i, c := range r.counters {
                delta := c.Swap(0)
                r.onRate(r.names[i], float64(delta)/secs)
            }
        }
    }
}
```

Trade-off: the rate reporter resets counters, so any other observer that wants the cumulative total will not see it. Choose carefully.

---

## Deep Dive: Working with Prometheus client_golang

The Prometheus client library uses atomic counters internally and exposes them in Prometheus's text format. Bridging from raw `atomic.Int64` to a Prometheus counter:

```go
import "github.com/prometheus/client_golang/prometheus"

var (
    requestsTotal = prometheus.NewCounter(prometheus.CounterOpts{
        Name: "myapp_requests_total",
        Help: "Total number of requests served.",
    })
)

func init() {
    prometheus.MustRegister(requestsTotal)
}

func handler(w http.ResponseWriter, r *http.Request) {
    requestsTotal.Inc()
    // ...
}
```

Internally, `requestsTotal.Inc()` is an `atomic.Int64.Add(1)` (well, float64-via-uint64 in newer versions). The library handles the formatting, the scrape endpoint, the label cardinality limits, and the multi-process gathering.

If you have an existing `atomic.Int64` and want to expose it via Prometheus without changing the increment site, use a `prometheus.CounterFunc`:

```go
var myCounter atomic.Int64

func init() {
    prometheus.MustRegister(prometheus.NewCounterFunc(prometheus.CounterOpts{
        Name: "myapp_requests_total",
        Help: "Total requests.",
    }, func() float64 { return float64(myCounter.Load()) }))
}
```

The `CounterFunc` is evaluated at scrape time. This is the easiest migration path from `expvar` to Prometheus.

---

## Deep Dive: When Atomic Is Not Enough

There are real workloads where even `atomic.Int64.Add(1)` becomes the bottleneck. Symptoms:

- `pprof` shows hot time in `runtime.atomic.Add64` or `cmpxchg`.
- Throughput drops as cores increase past some point.
- `perf top` shows cache-coherence traffic dominating.

If you see these, the fix is *not* "use a mutex" (worse) or "remove the counter" (loses data). The fix is sharding, padding, or sloppy semantics. The senior file covers all three in depth. Here is a quick summary so you know what is coming:

1. **Sharding** — N atomic counters, sum at read. Reduces per-shard contention proportional to N.
2. **Padding** — ensure each shard sits on its own cache line. Eliminates false sharing.
3. **Sloppy** — per-goroutine local accumulator that flushes to global periodically. Vastly higher throughput; lags reality.

In Java, the `LongAdder` class combines all three: dynamically grows a sharded array based on observed contention, pads each cell to a cache line, and lazily aggregates. The Go ecosystem has community packages that do similar things (none in the standard library yet). The senior file walks through writing one.

---

## Deep Dive: Counter Across Service Boundaries

Atomic counters only work within a single process. For cross-process or cross-machine counters you need:

- **Database INCREMENT.** `UPDATE counter SET v = v + 1 WHERE k = ?` plus a transaction.
- **Redis INCR.** `INCR mykey` is atomic in Redis, returns the new value. Excellent for distributed rate limiters.
- **A dedicated counter service.** Architecture pattern: one machine owns the counter, all others RPC to it. Simple but introduces a single point of failure.
- **CRDT counter.** PN-Counter (positive-negative counter) is a CRDT that allows independent increments across nodes with eventual consistency. Used in distributed databases like Riak.

These are all heavier than `atomic.Int64.Add(1)`. Use them when you genuinely need cross-process atomicity; do not use them when a single-process counter would suffice.

A common in-between: each instance maintains its own `atomic.Int64`, periodically flushes to a central store (database, Prometheus). The flush itself can lose ~1 interval of data on crash; the trade-off is huge throughput improvement vs centralised counting.

---

## Deep Dive: Counter in a Service That Restarts

What happens to a counter when your process restarts? It resets to zero.

For *monitoring*, that is usually fine — Prometheus and other systems handle counter resets by treating the counter as "starting fresh from zero", and `rate()` queries compute the right thing across the reset.

For *business state* (number of orders ever placed, total credits used by a user), an in-memory counter is the wrong tool. Use a database. The in-memory atomic counter is a cache of "increments since last persist"; periodically flush to the database. On restart, reload from the database.

The "increments since last persist + database baseline" pattern is the standard. The atomic counter handles the hot path; the database handles durability.

---

## Deep Dive: Counter Tests with Synthetic Load

A great test for a counter is to ramp up concurrency and measure the result.

```go
func TestCounterUnderRamp(t *testing.T) {
    var c atomic.Int64
    for _, concurrency := range []int{1, 10, 100, 1000, 10000} {
        c.Store(0)
        var wg sync.WaitGroup
        for i := 0; i < concurrency; i++ {
            wg.Add(1)
            go func() {
                defer wg.Done()
                for j := 0; j < 1000; j++ {
                    c.Add(1)
                }
            }()
        }
        wg.Wait()
        want := int64(concurrency * 1000)
        if got := c.Load(); got != want {
            t.Errorf("concurrency=%d: want %d, got %d", concurrency, want, got)
        }
    }
}
```

Run under `-race`. If anyone breaks the atomic, this catches it.

For benchmarks, use `b.RunParallel` and `-cpu`:

```go
func BenchmarkCounter(b *testing.B) {
    var c atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Add(1)
        }
    })
}
```

```
go test -bench=BenchmarkCounter -benchtime=1s -cpu=1,2,4,8,16
```

The ops/sec per CPU should fall as CPU increases — that is the contention cost. The senior file's sharded counter benchmarks should show ops/sec per CPU staying roughly constant.

---

## Deep Dive: Counter in a Pipeline

A multi-stage pipeline (input → stage1 → stage2 → output) has many opportunities for counters:

- Items ingested
- Items dropped per stage
- Items in transit per stage (gauges)
- Errors per stage

The natural shape is one struct of counters per stage, fields all `atomic.Int64`, summed at scrape time. For example:

```go
type StageStats struct {
    In       atomic.Int64
    Out      atomic.Int64
    Dropped  atomic.Int64
    Errors   atomic.Int64
    InFlight atomic.Int64
}

type Pipeline struct {
    Ingest StageStats
    S1     StageStats
    S2     StageStats
    Sink   StageStats
}
```

At scrape time you serialise all of them to JSON (or Prometheus). Each stage's worker code does straightforward `stats.In.Add(1)`, `stats.Out.Add(1)`. Easy to read, easy to grep, easy to add new fields.

---

## Closing the Middle

You can now:

- Write a CAS loop without consulting a manual
- Use `atomic.Pointer[T]` for snapshotting multiple values
- Build a small `expvar`-based metrics endpoint
- Implement a basic sharded counter
- Know when to reach for histograms instead of counters
- Bridge to Prometheus or OpenTelemetry without changing the increment site

The senior file picks up at sharded-counter optimisation: cache lines, false sharing, per-CPU sharding, sloppy counters, and the `LongAdder`-style auto-growing design. You will need it the day your counter shows up in a flamegraph.

---

## Extended Walkthrough: A Service-Wide Metrics System

Let us design a complete in-process metrics subsystem using only the middle-level toolkit. We will support:

- Counters, Gauges, Maps (for per-label counts)
- A registry with name-based registration
- Multiple sink formats: JSON (`expvar`-style), Prometheus text, and a callback hook for shipping
- Periodic snapshots for high-frequency observers

This is the kind of code you might find in any well-engineered Go service.

```go
package metrics

import (
    "context"
    "encoding/json"
    "fmt"
    "io"
    "sort"
    "sync"
    "sync/atomic"
    "time"
)

// Metric is the interface every metric type satisfies.
type Metric interface {
    // EncodeJSON writes the metric as a JSON value (no trailing newline).
    EncodeJSON(w io.Writer) error
    // EncodeProm writes one or more lines in Prometheus text format,
    // including # HELP and # TYPE lines.
    EncodeProm(w io.Writer, name, help string) error
    // Snapshot returns a self-contained view safe to retain.
    Snapshot() any
}

// Counter is a monotonic counter.
type Counter struct {
    v atomic.Int64
}

func (c *Counter) Inc()             { c.v.Add(1) }
func (c *Counter) Add(n int64)      { c.v.Add(n) }
func (c *Counter) Value() int64     { return c.v.Load() }
func (c *Counter) EncodeJSON(w io.Writer) error {
    _, err := fmt.Fprintf(w, "%d", c.v.Load())
    return err
}
func (c *Counter) EncodeProm(w io.Writer, name, help string) error {
    _, err := fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s counter\n%s %d\n",
        name, help, name, name, c.v.Load())
    return err
}
func (c *Counter) Snapshot() any { return c.v.Load() }

// Gauge can move both up and down.
type Gauge struct {
    v atomic.Int64
}

func (g *Gauge) Inc()        { g.v.Add(1) }
func (g *Gauge) Dec()        { g.v.Add(-1) }
func (g *Gauge) Add(n int64) { g.v.Add(n) }
func (g *Gauge) Set(n int64) { g.v.Store(n) }
func (g *Gauge) Value() int64 { return g.v.Load() }
func (g *Gauge) EncodeJSON(w io.Writer) error {
    _, err := fmt.Fprintf(w, "%d", g.v.Load())
    return err
}
func (g *Gauge) EncodeProm(w io.Writer, name, help string) error {
    _, err := fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s gauge\n%s %d\n",
        name, help, name, name, g.v.Load())
    return err
}
func (g *Gauge) Snapshot() any { return g.v.Load() }

// LabeledCounter is a counter keyed by a label value (e.g. status code).
type LabeledCounter struct {
    label string
    m     sync.Map // map[string]*Counter
}

func NewLabeledCounter(labelName string) *LabeledCounter {
    return &LabeledCounter{label: labelName}
}

func (l *LabeledCounter) Inc(labelValue string) {
    l.Add(labelValue, 1)
}

func (l *LabeledCounter) Add(labelValue string, n int64) {
    v, ok := l.m.Load(labelValue)
    if !ok {
        v, _ = l.m.LoadOrStore(labelValue, &Counter{})
    }
    v.(*Counter).Add(n)
}

func (l *LabeledCounter) Value(labelValue string) int64 {
    if v, ok := l.m.Load(labelValue); ok {
        return v.(*Counter).Value()
    }
    return 0
}

func (l *LabeledCounter) EncodeJSON(w io.Writer) error {
    keys := l.sortedKeys()
    io.WriteString(w, "{")
    for i, k := range keys {
        if i > 0 {
            io.WriteString(w, ",")
        }
        v, _ := l.m.Load(k)
        kb, _ := json.Marshal(k)
        w.Write(kb)
        fmt.Fprintf(w, ":%d", v.(*Counter).Value())
    }
    io.WriteString(w, "}")
    return nil
}

func (l *LabeledCounter) EncodeProm(w io.Writer, name, help string) error {
    fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s counter\n", name, help, name)
    for _, k := range l.sortedKeys() {
        v, _ := l.m.Load(k)
        kb, _ := json.Marshal(k)
        fmt.Fprintf(w, "%s{%s=%s} %d\n", name, l.label, kb, v.(*Counter).Value())
    }
    return nil
}

func (l *LabeledCounter) Snapshot() any {
    out := make(map[string]int64)
    l.m.Range(func(k, v any) bool {
        out[k.(string)] = v.(*Counter).Value()
        return true
    })
    return out
}

func (l *LabeledCounter) sortedKeys() []string {
    var keys []string
    l.m.Range(func(k, v any) bool {
        keys = append(keys, k.(string))
        return true
    })
    sort.Strings(keys)
    return keys
}
```

```go
// Registry is the central catalogue of named metrics.
type Registry struct {
    mu sync.RWMutex
    m  map[string]Metric
    h  map[string]string // help text
}

func New() *Registry {
    return &Registry{m: map[string]Metric{}, h: map[string]string{}}
}

func (r *Registry) Register(name, help string, m Metric) {
    r.mu.Lock()
    defer r.mu.Unlock()
    if _, ok := r.m[name]; ok {
        panic("metrics: duplicate name: " + name)
    }
    r.m[name] = m
    r.h[name] = help
}

func (r *Registry) Counter(name, help string) *Counter {
    c := &Counter{}
    r.Register(name, help, c)
    return c
}

func (r *Registry) Gauge(name, help string) *Gauge {
    g := &Gauge{}
    r.Register(name, help, g)
    return g
}

func (r *Registry) LabeledCounter(name, help, labelName string) *LabeledCounter {
    l := NewLabeledCounter(labelName)
    r.Register(name, help, l)
    return l
}

func (r *Registry) WriteJSON(w io.Writer) error {
    r.mu.RLock()
    defer r.mu.RUnlock()
    io.WriteString(w, "{\n")
    first := true
    for _, name := range r.sortedNames() {
        if !first {
            io.WriteString(w, ",\n")
        }
        first = false
        kb, _ := json.Marshal(name)
        w.Write(kb)
        io.WriteString(w, ": ")
        if err := r.m[name].EncodeJSON(w); err != nil {
            return err
        }
    }
    io.WriteString(w, "\n}\n")
    return nil
}

func (r *Registry) WriteProm(w io.Writer) error {
    r.mu.RLock()
    defer r.mu.RUnlock()
    for _, name := range r.sortedNames() {
        if err := r.m[name].EncodeProm(w, name, r.h[name]); err != nil {
            return err
        }
    }
    return nil
}

func (r *Registry) sortedNames() []string {
    names := make([]string, 0, len(r.m))
    for n := range r.m {
        names = append(names, n)
    }
    sort.Strings(names)
    return names
}
```

Wiring it into an HTTP server:

```go
package main

import (
    "context"
    "net/http"
    "time"

    "yourpkg/metrics"
)

func main() {
    reg := metrics.New()
    requests := reg.Counter("http_requests_total", "All requests served.")
    inflight := reg.Gauge("http_inflight", "Currently-handling requests.")
    status := reg.LabeledCounter("http_status_total", "Responses by status code.", "code")

    mux := http.NewServeMux()
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        requests.Inc()
        inflight.Inc()
        defer inflight.Dec()
        w.WriteHeader(http.StatusOK)
        status.Inc("200")
        w.Write([]byte("hello"))
    })

    // Public traffic on :8080
    go http.ListenAndServe(":8080", mux)

    // Private metrics on :9090
    admin := http.NewServeMux()
    admin.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "text/plain; version=0.0.4")
        reg.WriteProm(w)
    })
    admin.HandleFunc("/debug/vars", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        reg.WriteJSON(w)
    })
    http.ListenAndServe("127.0.0.1:9090", admin)
}
```

A few things to notice:

- **Two HTTP servers.** Public traffic on `:8080`, admin/metrics on `127.0.0.1:9090`. Never expose admin to the public.
- **Two formats.** Prometheus for scrape; JSON for human eyes. Both backed by the same registry.
- **No global state in the registry.** Each test can construct its own; no `init()` pollution.
- **All metrics are `atomic.Int64` internally.** No mutexes in the hot path.
- **`sync.Map` for the labeled counter.** Unbounded label values would blow up memory, but for status codes (a small set) it is fine.

This is roughly what a production-grade metrics library looks like minus histograms, summary types, and multi-process gathering.

---

## Extended Walkthrough: Snapshot Publisher

A long-running service that wants to emit a multi-field snapshot to a logger every minute. We use `atomic.Pointer[T]` to ensure readers always see a consistent snapshot.

```go
package status

import (
    "context"
    "log"
    "runtime"
    "sync/atomic"
    "time"
)

type Snapshot struct {
    At         time.Time
    Goroutines int
    HeapAlloc  uint64
    Requests   int64
    Errors     int64
    Uptime     time.Duration
}

type Status struct {
    requests atomic.Int64
    errors   atomic.Int64
    started  time.Time
    snap     atomic.Pointer[Snapshot]
}

func New() *Status {
    s := &Status{started: time.Now()}
    s.refresh()
    return s
}

func (s *Status) RecordRequest()  { s.requests.Add(1) }
func (s *Status) RecordError()    { s.errors.Add(1) }
func (s *Status) Current() *Snapshot { return s.snap.Load() }

func (s *Status) refresh() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    s.snap.Store(&Snapshot{
        At:         time.Now(),
        Goroutines: runtime.NumGoroutine(),
        HeapAlloc:  m.HeapAlloc,
        Requests:   s.requests.Load(),
        Errors:     s.errors.Load(),
        Uptime:     time.Since(s.started),
    })
}

func (s *Status) Run(ctx context.Context, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            s.refresh()
            sn := s.Current()
            log.Printf("status: uptime=%s req=%d err=%d goroutines=%d heap=%d",
                sn.Uptime.Round(time.Second), sn.Requests, sn.Errors,
                sn.Goroutines, sn.HeapAlloc)
        }
    }
}
```

Properties:

- Readers (e.g., `/status` HTTP handler) get a single consistent snapshot in one atomic load.
- Writers (request handlers) just bump `atomic.Int64`s with no coordination.
- The refresh function is called from a single goroutine, so there is no race in the snapshot construction itself.
- Allocates one new `Snapshot` per refresh — typically one per second or per minute. Negligible GC impact.

---

## Extended Walkthrough: A Reset-Free Sliding-Window Counter

A common metric: "requests in the last 60 seconds". The naive way is to reset every 60 seconds. The better way is a ring buffer of one-second buckets, with a tick that moves the "current" pointer forward.

```go
package counters

import (
    "sync/atomic"
    "time"
)

const window = 60 // seconds

type SlidingWindow struct {
    buckets [window]atomic.Int64
    head    atomic.Int64 // index of "current second"
}

func (s *SlidingWindow) Inc() {
    s.buckets[s.head.Load()%window].Add(1)
}

func (s *SlidingWindow) Tick() {
    next := (s.head.Load() + 1) % window
    s.buckets[next].Store(0)
    s.head.Store(next)
}

func (s *SlidingWindow) Total() int64 {
    var total int64
    for i := range s.buckets {
        total += s.buckets[i].Load()
    }
    return total
}

func (s *SlidingWindow) Run(stop <-chan struct{}) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-stop:
            return
        case <-t.C:
            s.Tick()
        }
    }
}
```

Properties:

- The "current second" bucket is incremented by all callers.
- Once a second, the head moves and the *new* head bucket is reset (preserving 59 seconds of history).
- `Total()` is O(window) — for window=60, ~200 ns. Fine for periodic scrape.

Caveats:

- Increments racing with `Tick()` can land in either the old or new bucket. For a 1-second window granularity, this is acceptable noise.
- True minute-rate computation may want a weighted final bucket — left as an exercise.

This pattern is the foundation of most production rate-limiting and sliding-window metrics.

---

## Extended Walkthrough: A "Rate" Metric Done Right

Operations teams want rates, not totals. The right way to compute a per-second rate is:

```go
type Rate struct {
    cum  atomic.Int64   // cumulative total
    last int64          // last sampled value
    at   time.Time       // when we sampled
    mu   sync.Mutex      // protects last/at
}

func (r *Rate) Inc()   { r.cum.Add(1) }
func (r *Rate) Add(n int64) { r.cum.Add(n) }

func (r *Rate) PerSecond() float64 {
    r.mu.Lock()
    defer r.mu.Unlock()
    now := time.Now()
    cur := r.cum.Load()
    if r.at.IsZero() {
        r.last = cur
        r.at = now
        return 0
    }
    delta := cur - r.last
    elapsed := now.Sub(r.at).Seconds()
    r.last = cur
    r.at = now
    if elapsed == 0 {
        return 0
    }
    return float64(delta) / elapsed
}
```

Or, simpler and Prometheus-style: just expose the cumulative counter and let the scrape system compute the rate with `rate(counter[1m])`. The Prometheus convention is "counters expose totals; the query engine computes rates". This avoids per-process state and gives the same answer.

---

## Extended Walkthrough: Race-Detector Friendly Test Patterns

Writing tests that are *both* fast and exercise the race detector well is an art. A few patterns:

### Pattern 1: bounded parallel with `RunParallel`

```go
func TestCounter_ParallelInc(t *testing.T) {
    if testing.Short() {
        t.Skip()
    }
    var c atomic.Int64
    const N = 10000
    var wg sync.WaitGroup
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); c.Add(1) }()
    }
    wg.Wait()
    if got := c.Load(); got != N {
        t.Errorf("expected %d, got %d", N, got)
    }
}
```

### Pattern 2: producer/consumer with semaphore

```go
func TestCounter_BoundedConcurrency(t *testing.T) {
    var c atomic.Int64
    sem := make(chan struct{}, 100) // max 100 in flight
    var wg sync.WaitGroup
    for i := 0; i < 100_000; i++ {
        sem <- struct{}{}
        wg.Add(1)
        go func() {
            defer wg.Done()
            defer func() { <-sem }()
            c.Add(1)
        }()
    }
    wg.Wait()
    if got := c.Load(); got != 100_000 {
        t.Errorf("expected 100000, got %d", got)
    }
}
```

### Pattern 3: stress with `runtime.Gosched()` to widen race windows

```go
func TestNonAtomic_RaceyByDesign(t *testing.T) {
    var x int64
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            cur := x
            runtime.Gosched()
            x = cur + 1
        }()
    }
    wg.Wait()
    if x == 1000 {
        t.Errorf("expected races to drop some, got exactly 1000 — too lucky")
    }
}
```

This test *expects* races. Useful for teaching, not for production assertions.

### Pattern 4: bench-as-test using `testing.Benchmark`

```go
func TestCounter_NoRegressions(t *testing.T) {
    res := testing.Benchmark(BenchmarkCounter)
    if res.NsPerOp() > 50 {
        t.Errorf("regression: %d ns/op > 50 ns/op", res.NsPerOp())
    }
}
```

Embeds a performance budget in the test suite.

---

## Extended Walkthrough: From `atomic.Int64` to `expvar.Int` and Back

A common scenario: you used `atomic.Int64` initially, then decided to expose to `/debug/vars`. Migration:

```go
// Before:
var requests atomic.Int64

// After:
var requests = expvar.NewInt("requests")
```

Both APIs are functionally identical for increments and reads:

| atomic.Int64 | expvar.Int |
|--------------|-----------|
| `r.Add(1)` | `r.Add(1)` |
| `r.Load()` | `r.Value()` |
| `r.Store(0)` | `r.Set(0)` |

There is no `Swap` on `expvar.Int`. If you need reset-and-report, you must work around:

```go
v := expvar.NewInt("foo")
// To "reset": grab the underlying atomic via unsafe? No — wrap your own.
```

Or, more simply: maintain the `atomic.Int64` yourself and *also* expose it as a `expvar.Func`:

```go
var requests atomic.Int64

func init() {
    expvar.Publish("requests", expvar.Func(func() any { return requests.Load() }))
}

func reset() int64 { return requests.Swap(0) }
```

The `expvar.Func` pattern keeps you in control of the underlying storage while still giving operators the JSON endpoint.

---

## Extended Walkthrough: Counter Hierarchies

Real services have hierarchies of counters:

- Per service
- Per subsystem within a service
- Per route within a subsystem
- Per status code within a route

How to model this? Three options:

### Option A: flat name with separators

```go
expvar.NewInt("server.api.users.get.200")
```

Naming gets long and registration explodes (one per leaf).

### Option B: nested `expvar.Map`

```go
api := expvar.NewMap("server.api")
users := new(expvar.Map).Init()
api.Set("users", users)
get := new(expvar.Map).Init()
users.Set("get", get)
get.Add("200", 1)
```

Verbose but structured.

### Option C: a custom labeled counter

```go
type LabeledCounter struct {
    m sync.Map // map[Labels]*atomic.Int64
}

type Labels struct {
    Route   string
    Method  string
    Status  int
}
```

The `LabeledCounter` style maps cleanly to Prometheus's label model. For greenfield code, use this approach (or use a Prometheus client library, which is designed around it).

---

## Extended Walkthrough: Counter Hygiene Checklist

Before shipping a new counter, verify:

- [ ] Pointer receiver on all methods?
- [ ] `defer Dec()` for every `Inc()` on a gauge?
- [ ] Naming follows project convention?
- [ ] Counter is registered in the right registry (project, not global)?
- [ ] Counter is documented in the help string?
- [ ] Counter is tested with `-race`?
- [ ] Counter is benchmarked under realistic concurrency?
- [ ] No mutex around an atomic?
- [ ] No `Load()` + `Store(0)` (use `Swap(0)`)?
- [ ] Reset semantics are documented (does it reset on process restart? on snapshot read?)?
- [ ] Cardinality of labels is bounded?
- [ ] Reads are infrequent enough that O(shards) is acceptable?

If you can tick all twelve, ship it.

---

## Closing the Middle, Truly

You are now equipped to write production-grade Go counter code. CAS loops, atomic pointer snapshots, expvar registration, and basic sharding cover 95% of in-process counter needs.

The remaining 5% — the bits that show up in profilers at extreme scale — are the senior file's territory. There you will learn:

- Cache lines and false sharing (the reason your sharded counter scales 4×, not 16×)
- Cache-line padding via `_ [56]byte` and Go 1.20+'s `structlayout`
- Per-CPU shards via `runtime_procPin` (and why the runtime team is cool with it)
- Sloppy counters (per-goroutine local + periodic flush)
- `LongAdder`-style auto-growing dynamic sharding
- The trade-offs between exact and approximate counts

And then the professional file builds on top of all of it with HDR histograms, NUMA awareness, and the design of a full observability subsystem.

Until then: practise the patterns in this file, write tests with `-race`, benchmark with `-cpu`, and ship counters that operators love.

---

## Final Appendix: A Middle-Level Quiz

1. Write a CAS loop that tracks the running maximum of observed values.
2. When would you use `atomic.Pointer[T]` instead of `atomic.Int64`?
3. What does `expvar.Func` do that `expvar.Int` doesn't?
4. Why is a basic sharded counter (without padding) often only slightly faster than a single atomic?
5. What is the trade-off between exact and approximate counters?
6. How do you safely have a counter per key when the key set is dynamic?
7. What is the read cost of a 64-shard counter's `Get()`?
8. Why must `Reset()` on a sharded counter use `Swap(0)` per shard, not `Load()+Store(0)`?
9. How does Prometheus aggregate histograms across instances?
10. What is the difference between a counter and a histogram?

Answer all ten and you have absorbed the middle level.

---

## Final Appendix: Five Common Middle-Level Mistakes

1. **CAS-looping on a hot counter**: storms of failures; use Add or shard.
2. **Snapshotting multi-counter state via multiple Loads**: inconsistent.
3. **Unbounded label cardinality**: blows up the metric backend.
4. **`Set` instead of `Add` for monotonic counters**: lost updates.
5. **Per-route counters via string keys without sync.Map**: map races.

Avoid these and you are ahead of most engineers building metrics subsystems.

---

End of Middle File. Truly.



