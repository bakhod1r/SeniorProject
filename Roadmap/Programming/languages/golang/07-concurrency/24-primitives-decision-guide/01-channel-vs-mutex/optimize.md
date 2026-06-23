---
layout: default
title: Channels vs Mutexes — Optimize
parent: Channels vs Mutexes
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/01-channel-vs-mutex/optimize/
---

# Channels vs Mutexes — Optimize

[← Back](../)

Eight performance scenarios, each one a real refactor we have seen pay off. For each: the code "before", the diagnosis, the code "after", and the expected speedup. Numbers are from `go1.22 darwin/arm64 M1 Pro` unless noted; your hardware will differ but the *ratios* are stable.

---

## Scenario 1 — atomic beats mutex beats channel for a counter

**Before.**
```go
type Counter struct {
    mu sync.Mutex
    n  int64
}
func (c *Counter) Inc() {
    c.mu.Lock(); c.n++; c.mu.Unlock()
}
```

**Diagnosis.** A counter has no invariant beyond "the integer is monotonic". A mutex is overkill; `atomic.Int64.Add` is one instruction. Under contention from 32 goroutines, the mutex is 4–5x slower than the atomic, and a channel-based counter is 50x slower than the mutex.

**After.**
```go
type Counter struct{ n atomic.Int64 }
func (c *Counter) Inc() { c.n.Add(1) }
```

**Measured.**

| Variant | 1 goroutine | 32 goroutines |
|---|---|---|
| `atomic.Int64.Add` | 4.8 ns/op | 6.2 ns/op |
| `sync.Mutex` | 13 ns/op | 105 ns/op |
| `chan int` (size 1) | 95 ns/op | 480 ns/op |

**Rule.** If the operation is a single read-modify-write on an integer or pointer, reach for `sync/atomic` first.

---

## Scenario 2 — RWMutex only helps if reads are slow enough

**Before.**
```go
type Config struct {
    mu sync.RWMutex
    v  int
}
func (c *Config) Get() int {
    c.mu.RLock(); defer c.mu.RUnlock()
    return c.v
}
```

**Diagnosis.** The critical section is "load an integer". `RWMutex.RLock` does more bookkeeping than `Mutex.Lock` — under high concurrency, the read-side cache line that tracks reader count becomes contended. Benchmarks at 32 goroutines:

| Variant | ns/op |
|---|---|
| `sync.Mutex` | 28 |
| `sync.RWMutex` | 41 |
| `atomic.Int64.Load` | 0.3 |

**After.**
```go
type Config struct{ v atomic.Int64 }
func (c *Config) Get() int { return int(c.v.Load()) }
```

**Rule.** `RWMutex` pays off when the read-side critical section does *something*: a map lookup that copies a string, a slice scan, a JSON marshal. Under that threshold, plain `Mutex` is faster, and `atomic` is faster still if applicable.

---

## Scenario 3 — `atomic.Pointer[T]` for read-mostly config

**Before.**
```go
type Server struct {
    mu  sync.RWMutex
    cfg *Config
}
func (s *Server) Handle(r *Request) {
    s.mu.RLock()
    c := s.cfg
    s.mu.RUnlock()
    use(c)
}
func (s *Server) Reload(c *Config) {
    s.mu.Lock()
    s.cfg = c
    s.mu.Unlock()
}
```

**Diagnosis.** Reads happen 100k+ times per second; reloads happen every few minutes. Readers should pay nothing for the rare writer.

**After.**
```go
type Server struct{ cfg atomic.Pointer[Config] }
func (s *Server) Handle(r *Request) { use(s.cfg.Load()) }
func (s *Server) Reload(c *Config) { s.cfg.Store(c) }
```

**Why.** `atomic.Pointer.Load` is a single MOV with an acquire fence — effectively free in the read path. The writer's `Store` does a release-fenced store. Readers and writers never serialise.

**Measured.** Read latency drops from 18 ns to 0.4 ns. Tail latency improves visibly under load because there is no longer an `RWMutex` waiter queue at all.

---

## Scenario 4 — `sync.Map` vs `map + RWMutex` vs sharded

`sync.Map` is documented for two specific cases (Go's `sync/map.go` doc comment):
> "(1) when the entry for a given key is only ever written once but read many times, as in caches that only grow, or (2) when multiple goroutines read, write, and overwrite entries for disjoint sets of keys."

Outside those, it can lose to a plain map under a single `RWMutex`:

| Workload | `map+RWMutex` | `sync.Map` | sharded (8 mutexes) |
|---|---|---|---|
| 95% read, shared keys | 38 ns | 31 ns | 22 ns |
| 50% read, 50% write, shared keys | 410 ns | 720 ns | 95 ns |
| 95% write, disjoint keys | 380 ns | 95 ns | 65 ns |

**Rule.** Default to `map + sync.Mutex`. Reach for `sync.Map` only after profiling shows it dominates and your access pattern matches one of the two documented cases. For write-heavy *shared-key* workloads, **shard**: a `[N]struct{ mu sync.Mutex; m map[K]V }` indexed by hash.

```go
type ShardedMap[V any] struct {
    shards [16]struct {
        mu sync.Mutex
        m  map[string]V
    }
}
func (s *ShardedMap[V]) Get(k string) (V, bool) {
    sh := &s.shards[xxhash.Sum64String(k)&15]
    sh.mu.Lock(); defer sh.mu.Unlock()
    v, ok := sh.m[k]
    return v, ok
}
```

---

## Scenario 5 — Buffered channel collapses contention

**Before.** An unbuffered channel between a tight producer loop and a single consumer.

```go
ch := make(chan int)
go func() { for i := 0; i < 1e6; i++ { ch <- i } close(ch) }()
for v := range ch { _ = v }
```

**Diagnosis.** Every send pairs with a receive through the scheduler, ~50 ns per pair on M1. Total: ~50 ms.

**After.** Buffer = 64.
```go
ch := make(chan int, 64)
```

**Measured.** Total drops to ~18 ms. Why: the producer can run a burst of 64 sends before parking, and the consumer can drain a burst of 64 receives — fewer scheduler hops.

**Caveat.** A larger buffer (say 1024) doesn't keep improving. The throughput plateau is roughly at the L1 cache line of the buffer ring. Past that, you are just trading throughput for latency (sends are far ahead of receives).

---

## Scenario 6 — Lock granularity: split one lock into N

**Before.**
```go
type ConnTable struct {
    mu    sync.Mutex
    conns map[string]*Conn
}
```

If `conns` has 100k entries and 1000 goroutines do mixed operations on it, the single mutex serialises every access.

**After.** Shard by hash, as in Scenario 4.

**Measured.** With 8 shards, contention-bound throughput grows ~7x (not 8x — the residual is the shard selection itself).

**Rule.** A mutex protects whatever sits in its critical section. If 95% of the time two goroutines are working on different keys, splitting the lock by key lets them proceed in parallel.

---

## Scenario 7 — Replace a select with a direct receive

**Before.**
```go
select {
case v := <-ch:
    handle(v)
}
```

**Diagnosis.** A `select` with one case is the same as a plain receive but pays for the `selectgo` machinery — ~30 ns on top of the receive's ~20 ns.

**After.**
```go
v := <-ch
handle(v)
```

**Rule.** Use `select` only when you have at least two real cases (multiple channels, or a channel and a `default`, or a channel and `ctx.Done()`). The compiler does *not* rewrite single-case `select` into a plain receive.

---

## Scenario 8 — Eliminate a needless reply channel

**Before.**
```go
type req struct {
    key   string
    reply chan int
}
ch := make(chan req)
// many callers do:
r := req{key: "x", reply: make(chan int, 1)}
ch <- r
v := <-r.reply
```

**Diagnosis.** Allocates a channel per call. Garbage collector sees millions of `hchan` allocations.

**After.** If the work being requested is a read-only lookup on shared state, drop the actor altogether and use `sync.Map.Load` or `atomic.Pointer[Snapshot].Load()`. The reply channel was paying for the privilege of running on a different goroutine — if no mutation is needed, none of that is necessary.

**When the actor is justified.** The actor pattern is worth its cost only when the state has multi-field invariants that a single mutex would also need to wrap, *and* when serialising the access is intentional. For everything else, prefer reading directly from a snapshot under an atomic pointer.

---

## Quick reference table

| Workload | First choice | When to escalate |
|---|---|---|
| Counter | `atomic` | Never |
| Boolean flag | `atomic.Bool` | Never |
| Read-mostly pointer | `atomic.Pointer[T]` | If reads need a critical section, `RWMutex` |
| Map, mixed reads/writes, shared keys | `map + sync.Mutex` | Shard if contention dominates |
| Map, disjoint keys per goroutine | `sync.Map` | Shard if profiling shows it loses |
| Producer/consumer pipeline | buffered `chan` | Tune buffer size by measured burst |
| Worker pool | unbuffered `chan` + N workers | Use a library if features grow |
| Cancellation fan-out | `context.Context` | Never |
| Long-running state with invariants | actor (goroutine + chan) | Mutex if scheduling cost dominates |

---

[← Back](../)
