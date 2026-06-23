---
layout: default
title: sync.Pool Internals — Professional
parent: sync.Pool Internals
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/03-sync-pool-internals/professional/
---

# sync.Pool Internals — Professional Level

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Profiling Pool Churn](#profiling-pool-churn)
3. [Identifying Anti-Pattern Usage in Production](#identifying-anti-pattern-usage-in-production)
4. [Quantifying Pool Impact](#quantifying-pool-impact)
5. [Custom Pool Variants](#custom-pool-variants)
6. [Comparing to fastcache and bytebufferpool](#comparing-to-fastcache-and-bytebufferpool)
7. [NUMA and Per-Socket Considerations](#numa-and-per-socket-considerations)
8. [Interaction with the Runtime Scheduler](#interaction-with-the-runtime-scheduler)
9. [Pool Sizing at Scale](#pool-sizing-at-scale)
10. [Observability: Metrics You Can Export](#observability-metrics-you-can-export)
11. [Capacity Caps and the Long-Tail Problem](#capacity-caps-and-the-long-tail-problem)
12. [Operational Playbook](#operational-playbook)
13. [Cheat Sheet](#cheat-sheet)
14. [Further Reading](#further-reading)

---

## Introduction

This file is for the engineer responsible for keeping a Go service alive in production. By now you understand what `sync.Pool` does and how it works internally. The question here is *operational*: how do you spot a pool that is misbehaving, how do you measure the impact of changing one, and what alternatives exist when `sync.Pool` is not enough?

We focus on three skills:

1. Reading pprof output and `runtime/metrics` data to diagnose pool behavior.
2. Making informed tradeoffs between `sync.Pool`, third-party pools (`bytebufferpool`, `fastcache`), and hand-rolled solutions.
3. Designing systems where pools are first-class observability subjects, not invisible internals.

---

## Profiling Pool Churn

### Heap profile signature

The fingerprint of a misbehaving pool in `go tool pprof -alloc_space` is a single allocation site near `sync.(*Pool).New` taking a substantial share. Example:

```
Showing top 10 nodes out of 53
      flat  flat%   sum%        cum   cum%
   2.8GB    35%    35%       2.8GB    35%  main.newBuffer
   1.4GB    18%    53%       1.4GB    18%  bytes.makeSlice
   ...
```

`main.newBuffer` is the `New` function. If it accounts for > 5% of allocation pressure, the pool is missing badly. Either the workload is `Get`-heavy without matching `Put`, or the GC is draining the pool faster than it fills.

### CPU profile signature

In `go tool pprof http://localhost:6060/debug/pprof/profile` or a recorded `pprof.CPUProfile`, look for:

| Function | What it tells you |
|----------|-------------------|
| `sync.(*Pool).Get` (high self) | Frequent calls; might be fine if hit rate is high. |
| `sync.(*Pool).getSlow` (high self) | Fast path missing; pool is empty most of the time. |
| `sync.(*Pool).pinSlow` (high self) | Pool repeatedly hitting cold path — usually means `GOMAXPROCS` changes (unusual) or first-call latency on many pools. |
| `runtime.gcStart` linked to your `New` | GC is draining the pool; consider higher GOGC. |
| `runtime.(*mheap).alloc` calls dominating | The allocator is overloaded; pool may help if objects are big enough. |

A healthy pool has `Get` self-time *but no* `getSlow` time. The opposite is the warning sign.

### Trace view

`go tool trace` shows GC events on the timeline. Overlay them on your latency histogram: if every GC line corresponds to a latency spike, the pool drain (or just the GC pause) is contributing. To distinguish:

- With `GOGC=200`, the GC frequency halves. If the latency spikes halve in frequency but not size, the cause is the GC pause itself.
- If the latency spikes disappear, the cause is pool drain.

This separation guides the fix: GC pause spikes call for tuning GC (and the pool is fine); drain spikes call for either keeping the pool warmer or moving off `sync.Pool` entirely.

---

## Identifying Anti-Pattern Usage in Production

### The "always misses" pool

```go
var pool = sync.Pool{New: func() any { return new(big) }}

func handler(w http.ResponseWriter, r *http.Request) {
    b := pool.Get().(*big)
    // ... use b in async goroutine, never Put ...
    go process(b)
}
```

**Signature.** `New` count grows linearly with request count; `Put` is never called. The "pool" is just a constructor with extra steps.

**Fix.** Either ensure `Put` runs in `process` (with the lifetime tradeoff that implies), or remove the pool.

### The "tiny object" pool

```go
type Pair struct{ K, V int }
var pool = sync.Pool{New: func() any { return new(Pair) }}
```

**Signature.** Benchmarks with and without the pool show no difference, or the pool is *slower*.

**Fix.** Remove. Pass by value.

### The "wrong granularity" pool

```go
var bufferPool sync.Pool

func processRow(row []byte) {
    b := bufferPool.Get().(*bytes.Buffer)
    defer bufferPool.Put(b)
    // ... 5 µs of work ...
}
```

**Signature.** Hot path; each call is short; the pool overhead dominates.

**Fix.** Acquire the buffer once at the outer batch level, reuse across rows:

```go
func processBatch(rows [][]byte) {
    b := bufferPool.Get().(*bytes.Buffer)
    defer bufferPool.Put(b)
    for _, row := range rows {
        b.Reset()
        // ... process row using b ...
    }
}
```

### The "wrong size class" pool

```go
var pool = sync.Pool{New: func() any { return make([]byte, 0, 1024) }}
```

But the real workload needs 64 KB buffers. Every `Get` returns a 1 KB buffer that gets `append`-grown to 64 KB and then `Put` back. Now the pool is full of mixed-size buffers.

**Signature.** Memory grows quickly even with the pool; `bytes.makeSlice` shows up large in heap profile.

**Fix.** Match the `New` capacity to typical usage. Or cap the retained size in `Put` (see Scenario 3 in `optimize.md`).

---

## Quantifying Pool Impact

To measure the impact of removing or modifying a pool:

1. **Baseline:** record `runtime/metrics`:
   - `/gc/heap/allocs:bytes` (cumulative)
   - `/gc/heap/objects:objects` (current)
   - `/gc/cycles/total:gc-cycles`
   - `/sched/pauses/total/gc:seconds`
   over a fixed window (60-300 s of load).

2. **Treatment:** apply the change (add pool, remove pool, change cap, change `GOGC`).

3. **Compare:** the deltas of `allocs:bytes` and `cycles:gc-cycles` over the same window.

A pool removal that increases `allocs:bytes` by 30% but reduces request p99 latency by 5% is a *win* (the pool was costing more in overhead than it saved). The opposite is a loss.

### Synthetic benchmark scaffolding

```go
func BenchmarkPooled(b *testing.B) {
    b.ReportAllocs()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            buf := pool.Get().(*bytes.Buffer)
            buf.Reset()
            buf.WriteString("payload")
            pool.Put(buf)
        }
    })
}

func BenchmarkUnpooled(b *testing.B) {
    b.ReportAllocs()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            buf := &bytes.Buffer{}
            buf.WriteString("payload")
            _ = buf
        }
    })
}
```

Run with `go test -bench=. -benchmem -cpu=1,4,8,16`. Vary `-cpu` because pool behavior changes with `GOMAXPROCS` — at `GOMAXPROCS=1` there is no stealing.

---

## Custom Pool Variants

### Bounded LIFO pool

When you need a hard upper bound on retained memory and `sync.Pool`'s "may be removed at any time" semantics are unacceptable:

```go
type Bounded struct {
    mu   sync.Mutex
    pool []*bytes.Buffer
    cap  int
}

func (p *Bounded) Get() *bytes.Buffer {
    p.mu.Lock()
    if n := len(p.pool); n > 0 {
        b := p.pool[n-1]
        p.pool = p.pool[:n-1]
        p.mu.Unlock()
        return b
    }
    p.mu.Unlock()
    return &bytes.Buffer{}
}

func (p *Bounded) Put(b *bytes.Buffer) {
    b.Reset()
    p.mu.Lock()
    if len(p.pool) < p.cap {
        p.pool = append(p.pool, b)
    }
    p.mu.Unlock()
}
```

**Tradeoffs vs `sync.Pool`:**

| Aspect | Bounded | `sync.Pool` |
|--------|---------|-------------|
| Throughput (no contention) | ~150 ns/op | ~7 ns/op |
| Throughput (16-way contention) | ~1.2 µs/op | ~25 ns/op |
| Max retained | `cap` * sizeof(*Buffer) | unbounded |
| GC interaction | None | Drains on every GC |
| Pre-warming behavior | Trivial | Hidden behind per-P state |

Use the bounded variant when **predictability** is more important than throughput — e.g., memory-constrained embedded targets, or systems with strict SLOs on RSS.

### Sharded mutex pool

Closer to `sync.Pool`'s throughput but still GC-immune:

```go
type Sharded struct {
    shards [256]struct {
        mu   sync.Mutex
        list []*bytes.Buffer
        _    [56]byte // pad against false sharing
    }
}

func (p *Sharded) Get() *bytes.Buffer {
    i := fastrand() & 0xff
    s := &p.shards[i]
    s.mu.Lock()
    n := len(s.list)
    if n > 0 {
        b := s.list[n-1]
        s.list = s.list[:n-1]
        s.mu.Unlock()
        return b
    }
    s.mu.Unlock()
    return &bytes.Buffer{}
}
```

This is the basic shape of `bytebufferpool` (without size-class tracking).

### Per-P pool with explicit cleanup

If you want `sync.Pool`'s per-P speed but not its GC drain, you can roll your own with `runtime_procPin` exported via `//go:linkname`. This is what some HFT libraries do. It is **not portable across Go versions** because the runtime hook is unstable; expect breakage on every release.

```go
import _ "unsafe" // for go:linkname

//go:linkname runtime_procPin sync.runtime_procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin sync.runtime_procUnpin
func runtime_procUnpin()
```

Use with extreme caution. The maintenance burden is high.

---

## Comparing to fastcache and bytebufferpool

### `valyala/bytebufferpool`

A drop-in `sync.Pool` for `*bytes.Buffer`, with size-class tracking. The library remembers, per-pool, the typical size of buffers `Put` back, and uses that to inform when to `Put` (large buffers are dropped instead of pooled, preventing the long-tail problem from `optimize.md` scenario 3).

**Code shape:**
```go
import "github.com/valyala/bytebufferpool"

func handler() {
    b := bytebufferpool.Get()
    defer bytebufferpool.Put(b)
    // ...
}
```

**Strengths:**
- Same fast-path performance as `sync.Pool` (it *is* a `sync.Pool` underneath).
- Built-in size-class adaptation.
- Drop-in.

**Weakness:** Specific to `*ByteBuffer` (their own type, byte-slice-backed). Not generic.

### `VictoriaMetrics/fastcache`

A fixed-size sharded LRU cache, not a pool. It is the right tool when you have key-based lookup; the wrong tool when you have anonymous scratch objects. Often used **alongside** `sync.Pool`: `fastcache` for cache hits, `sync.Pool` for scratch buffers used in cache misses.

### Hand-rolled freelist (linked list)

```go
type freelist struct {
    head atomic.Pointer[node]
}

type node struct {
    next *node
    buf  *bytes.Buffer
}
```

CAS-based push and pop. Pre-Go-1.13, this was sometimes competitive with `sync.Pool`. Today it is uniformly slower because of the per-CAS contention vs `sync.Pool`'s per-P locality. Useful only as an exercise.

### Comparison table

| Aspect | `sync.Pool` | `bytebufferpool` | `fastcache` | Hand-rolled CAS list |
|--------|-------------|------------------|-------------|----------------------|
| Per-P fast path | yes | yes (same impl) | no | no |
| GC drain | yes | yes | no | no |
| Key-based lookup | no | no | yes | no |
| Size adaptation | no | yes | no | no |
| Bounded | no | semi-bounded | yes | no |
| Throughput rank | 1 | 1 | 4 | 3 |

---

## NUMA and Per-Socket Considerations

`sync.Pool` is per-P, not per-socket. On a 2-socket server with 32 cores per socket (64 Ps total), there is no awareness of which Ps share an LLC. Stealing across sockets is therefore possible and *expensive*: cross-socket cache line traffic is 100+ ns vs ~20 ns intra-socket.

In practice this is rarely a problem because:

1. The Go scheduler tries to keep goroutines on a stable P.
2. Stealing happens only when the local P's pool is empty.
3. The cost is amortized — one cross-socket steal supplies an object that may be reused many times locally.

If you can prove cross-socket stealing is hurting you (e.g., `perf stat -e cache-misses` shows huge LLC miss rate concentrated in pool code), you have two options:

1. **Pin worker goroutines to a single socket** with `runtime.LockOSThread` plus `taskset`/`cpuset` cgroup constraints.
2. **Use one pool per socket**, with workers selecting based on `runtime/internal/cpu` (or via `linkname`-imported `runtime.getg()`).

Option 1 is portable; option 2 requires runtime hackery and is fragile.

---

## Interaction with the Runtime Scheduler

### Preemption during `pin`

`runtime_procPin` increments `m.locks`. While `m.locks > 0`, the scheduler will not preempt this goroutine and will not run scavenging on this M. This means:

- `pin` cannot be called with the world stopped.
- `pin` cannot recurse safely if the inner code can yield.
- The pool's fast path is *bounded constant time* — no scheduler delays.

If a goroutine is pinned for too long, it can starve other goroutines on the same M. `sync.Pool` pins only for the duration of `Get`/`Put`, which is nanoseconds — well below any reasonable starvation threshold. User code that pins should follow the same rule.

### `pinSlow` race with GC

`pinSlow` (the cold path of `pin`) calls `poolRaceAddr` and `runtime_LoadAcquintptr` to atomically resize the `local` array. It races with `poolCleanup`, but `poolCleanup` runs with the world stopped, so the race is resolved by mutual exclusion at the runtime level. `pinSlow` always observes a fully-formed `local`/`victim` pair.

### GOMAXPROCS changes

`runtime.GOMAXPROCS(n)` triggers re-creation of the runtime's P list. The next pool `pin` after the change calls `pinSlow` and re-allocates a `local` array of size n. Any objects that were in the old `local[i]` for `i >= n` are lost — they go to GC on the next cycle.

Practical implication: do not call `runtime.GOMAXPROCS` after startup if you care about pool warmth.

---

## Pool Sizing at Scale

How many objects does a pool steady-state hold?

Empirically, after warm-up, a `sync.Pool` holds approximately:

```
N_objects ≈ (peak_in_flight_objects / GOMAXPROCS) * GOMAXPROCS
        =  peak_in_flight_objects
```

In other words: across all Ps, the pool's total inventory is roughly the high-water mark of concurrent uses since the last two GCs.

If your service processes 1000 concurrent requests, each holding one pooled buffer, the pool holds ~1000 buffers. If each buffer is 64 KB, that is 64 MB of pool memory — substantial.

To estimate before deploying:

```
pool_memory ≈ peak_concurrency * sizeof(pooled_object) * 2 (for victim cache)
```

The 2× is conservative: at any moment, the victim cache may hold the previous generation while the local cache holds the current generation.

---

## Observability: Metrics You Can Export

`sync.Pool` exposes no metrics. To get visibility, wrap it:

```go
type InstrumentedPool struct {
    inner    sync.Pool
    gets     atomic.Uint64
    puts     atomic.Uint64
    news     atomic.Uint64
}

func (p *InstrumentedPool) New() any {
    p.news.Add(1)
    return /* construct */
}

func (p *InstrumentedPool) Get() any {
    p.gets.Add(1)
    return p.inner.Get()
}

func (p *InstrumentedPool) Put(x any) {
    p.puts.Add(1)
    p.inner.Put(x)
}
```

Export via Prometheus:

```
my_pool_gets_total
my_pool_puts_total
my_pool_news_total
```

Useful derived metrics:

- **Miss rate**: `news / gets`. Should be < 5% in steady state.
- **Imbalance**: `(gets - puts) / gets`. Should be near zero; a positive value indicates leaked references.
- **Churn rate per GC**: `delta(news) / delta(gc_cycles)`. High value means GC is draining the pool faster than it fills.

These three numbers alone are enough to diagnose 90% of pool issues in production.

---

## Capacity Caps and the Long-Tail Problem

Without a cap, a single oversized request can wedge a giant buffer into the pool. The buffer survives 1-2 GC cycles before being released; meanwhile, every subsequent `Get` returns the giant buffer, even for tiny payloads.

The cap pattern from `optimize.md`:

```go
const maxRetain = 64 * 1024

func putBuf(b *bytes.Buffer) {
    if b.Cap() > maxRetain {
        return // let GC reclaim
    }
    b.Reset()
    pool.Put(b)
}
```

For finer control, multiple pools of different size classes:

```go
var (
    poolSmall  = sync.Pool{New: func() any { return bytes.NewBuffer(make([]byte, 0, 1024)) }}
    poolMedium = sync.Pool{New: func() any { return bytes.NewBuffer(make([]byte, 0, 16*1024)) }}
    poolLarge  = sync.Pool{New: func() any { return bytes.NewBuffer(make([]byte, 0, 256*1024)) }}
)

func getBuf(estimatedSize int) *bytes.Buffer {
    switch {
    case estimatedSize < 1024:
        return poolSmall.Get().(*bytes.Buffer)
    case estimatedSize < 16*1024:
        return poolMedium.Get().(*bytes.Buffer)
    default:
        return poolLarge.Get().(*bytes.Buffer)
    }
}
```

Add a corresponding `putBuf` that consults `b.Cap()` to choose which pool to return to. This is what HTTP/2 framers and many high-end servers do.

---

## Operational Playbook

### Symptom: latency p99 spikes correlated with GC

1. Compare GC frequency before and after raising `GOGC` (200 or 300).
2. If spikes shrink but persist: the GC pause itself is the cause. Tune heap target or use `runtime/debug.SetMemoryLimit`.
3. If spikes go away: pool drain was the cause. Either keep raising `GOGC` or pre-warm the pool harder.

### Symptom: rising memory under steady-state load

1. Check pool miss rate via your wrapper metrics.
2. If miss rate is healthy but memory still rises: a pool object is holding onto unbounded state (e.g., a buffer that grew but never shrinks). Add a `Cap()` check in `Put`.
3. If miss rate is high *and* memory rises: somewhere code is `Get`ing without `Put`ing — leaked references. Audit `defer` statements.

### Symptom: CPU dominated by `getSlow`

1. Verify `GOMAXPROCS` matches the actual core count.
2. Check the Put/Get ratio. If `Put` < `Get`, the workload is consuming faster than producing — pool cannot help.
3. Consider whether pooling is actually the right answer; for very short-lived objects, removing the pool may be faster.

### Symptom: pool works in dev but not in prod

1. Compare `GOMAXPROCS` between environments. A 4-core dev box behaves very differently from a 64-core prod box for steal-heavy workloads.
2. Check GC frequency — prod may GC much more often due to higher allocation pressure elsewhere.
3. Check whether prod has `GOGC` overridden in deployment config.

---

## Cheat Sheet

| Situation | Action |
|-----------|--------|
| Adding a pool | First benchmark without it; only add if benchmarks improve >10%. |
| Pool overhead too high | Object is too small; remove pool. |
| Pool misses too high | Either pre-warm or check for missing `Put`. |
| Pool memory unbounded | Add `Cap()` check or size-class shards. |
| Pool drains too often | Raise `GOGC` or use a non-GC alternative. |
| Cross-socket stealing | Pin workers; or one pool per socket. |
| Need bounded retention | Use `Bounded` mutex pool or `bytebufferpool`. |
| Need key lookup | Wrong tool; use `fastcache` or a real cache. |

---

## Further Reading

- Russ Cox — *Go Programming Language: Sync Package Tour* (talks about Pool tradeoffs)
- Dmitry Vyukov — *Lock-Free Algorithms* (the source for `poolDequeue`'s design)
- `valyala/bytebufferpool` source — production-tested adaptive pool
- `VictoriaMetrics/fastcache` source — sharded LRU
- Go issue 22950 discussion — the design debate for the victim cache
- Felix Geisendörfer — *The Busy Developer's Guide to Go Memory Leaks* — covers Pool's interaction with goroutine leaks
- Bryan C. Mills — *Don't Build Your Own (Connection) Pool* — general advice about when pooling is overkill
