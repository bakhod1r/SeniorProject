# sync.Pool — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Per-P Local Pools and the Steal Path](#per-p-local-pools-and-the-steal-path)
3. [The Victim Cache (Go 1.13+)](#the-victim-cache-go-113)
4. [GC Interaction in Depth](#gc-interaction-in-depth)
5. [Architectural Decisions Around Pooling](#architectural-decisions-around-pooling)
6. [When Not to Use `sync.Pool`](#when-not-to-use-syncpool)
7. [Building Bounded Pools When `sync.Pool` Will Not Do](#building-bounded-pools-when-syncpool-will-not-do)
8. [Pool Telemetry and Observability](#pool-telemetry-and-observability)
9. [Pool API Design for Libraries](#pool-api-design-for-libraries)
10. [Refactoring Production Pools](#refactoring-production-pools)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

At senior level you stop using `sync.Pool` and start *designing* with it — and around it. The questions change:

- Which workloads warrant a `sync.Pool`, which warrant a hand-rolled bounded pool, and which warrant no pool at all?
- How does the per-P sharding interact with `GOMAXPROCS`, container CPU limits, and burst traffic?
- What does the victim cache actually do, and how should I think about it when sizing memory?
- How do I write a library that exposes a pool without leaking implementation details?
- When is the right time to remove a pool that no longer earns its keep?

After this file you will:

- Reason about pool internals at the level of "per-P local pool + steal path + victim cache" without needing to read `src/sync/pool.go`.
- Choose between `sync.Pool`, channel-backed bounded pool, and no pool, based on workload characteristics.
- Know the eight or nine real situations where `sync.Pool` is the wrong answer.
- Design library APIs that hide pooling behind clean type contracts.
- Refactor and remove pools without breaking callers.

---

## Per-P Local Pools and the Steal Path

`sync.Pool`'s performance comes from a deliberate design: each P (processor in the Go runtime's GMP model) has its own private pool. When a goroutine running on P3 calls `Get`, the runtime tries P3's local pool first. No locks, no atomics on the fast path.

### The fast path

```
goroutine on P3 calls Get()
    -> P3 local private slot — pop, return
    -> P3 local shared queue — pop, return
    (both lock-free, single-P)
```

The local private slot is a single pointer, accessed only by goroutines currently running on P3. The local shared queue is a lock-free ring (`poolDequeue`) that allows other Ps to steal but does not require a mutex.

This means: under low contention, `Get` and `Put` are ~5-10 ns each. The cost is comparable to a function call. That is why `sync.Pool` works at hundreds of millions of ops per second across cores.

### The slow path: stealing

```
goroutine on P3 calls Get(), P3's pool is empty
    -> walk P0, P1, P2, P4, ..., trying to steal one item from each shared queue
    -> if all empty, call New
```

Stealing is more expensive (atomics on another P's queue) but still avoids global locking. It also means that an object you `Put` on P3 may be served to a goroutine that runs on P7 — pool items effectively migrate with the work.

### Implication 1: pool size scales with `GOMAXPROCS`

If you have 64 cores and `GOMAXPROCS=64`, the pool has 64 per-P shards. Each may hold a small set of items. Total pool capacity is roughly `64 × (private slot + shared queue)`. On a 4-core machine the same pool is much smaller.

Implication: a pool that "works fine" in dev (`GOMAXPROCS=8`) may behave differently in prod (`GOMAXPROCS=64`) — bigger working set, more potential bloat.

### Implication 2: `Put` and `Get` may serve different goroutines

You cannot use `sync.Pool` as a hand-off mechanism between specific goroutines. The pool is anonymous; objects flow according to where they happen to be relative to which P picks them up.

### Implication 3: lock-free does not mean free

The fast path uses atomic operations on the shared queue. Atomics are cheap, but not zero — they introduce memory-ordering fences that may limit ILP. At very high contention, even `sync.Pool` can become a bottleneck. We come back to this in the professional file.

---

## The Victim Cache (Go 1.13+)

Before Go 1.13, every GC dropped the entire pool to zero. Workloads that allocated heavily right before GC found themselves paying the `New` cost on every request immediately afterward — a sawtooth latency pattern.

Go 1.13 introduced a **victim cache**: a second-tier holding area that softens the GC eviction.

### How it works

```
At GC:
    victim  := main pool
    main pool := empty
At Get:
    try main pool first
    if empty, try victim cache
    if empty, call New
```

The next GC drops the victim cache and the current main becomes the victim. So an item lives across at most one GC cycle.

### What changed for users

Before 1.13: pool latency had visible spikes synced with GC.
After 1.13: spikes are softened — the victim cache catches the post-GC `Get` traffic. The pool is essentially "warm" through one GC, "cold" by the second.

You rarely interact with the victim cache directly. It is an implementation detail. But knowing it exists explains:

- Why pool effectiveness depends on GC frequency, not just on your `Put`/`Get` pattern.
- Why a workload that uses pooled objects every GC interval (e.g. every 10 ms) sees great pool hit rates, while a workload that uses them sparsely (e.g. once per minute) sees poor hit rates.
- Why benchmarks must include `runtime.GC()` calls to test pool warm-up realistically.

### Sizing implications

With the victim cache, the pool's "true" memory footprint is roughly *twice* the main pool size at peak: main + victim. Account for this when reasoning about RAM under load.

---

## GC Interaction in Depth

`sync.Pool` registers a cleanup function (`poolCleanup`) via `runtime.SetFinalizer`-style hooks. It runs once per GC, before the sweep phase begins.

### Order of operations during GC

1. STW pause (very short in modern Go).
2. Mark phase begins.
3. Pool cleanup: shift main → victim, drop old victim.
4. Sweep.
5. Workers resume.

Items dropped by step 3 become unreachable; they are reclaimed by the sweeper.

### Implication for "warm" pools

A pool is "warm" if it has objects in its main tier. After GC, the main tier is empty (but victim has the previous main). The pool is "lukewarm." After two GCs, the pool is "cold" unless `Put` calls have repopulated the main.

For services with high allocation pressure:

- GC runs frequently (every few hundred ms).
- Pool spends most of its life lukewarm or cold.
- Hit rate is dominated by `Put` rate, not by pool size.

For services with low allocation pressure:

- GC runs rarely (every few seconds or minutes).
- Pool stays warm.
- Hit rate is dominated by burst characteristics.

### Implication for `GOGC`

`GOGC` controls how aggressive the collector is. Lower values → more frequent GC → more pool evictions. Higher values → less frequent GC → pool stays warmer longer but consumes more memory.

Pooling and `GOGC` interact: lowering `GOGC` to reduce p99 may evict the pool more often, raising the `New` cost. Test both metrics in tandem.

---

## Architectural Decisions Around Pooling

At senior level the decision is rarely "should I pool this object?" It is "how does pooling fit into our service architecture?"

### Decision 1: which abstraction owns the pool?

Three options:

1. **Package-level pool.** Simple, opaque to callers. Best for self-contained utilities (`fmt`, `encoding/json` use this internally).
2. **Struct-field pool.** The service struct holds the pool. Good when the service is the only consumer.
3. **Constructor-injected pool.** Callers create the pool and pass it in. Good for testing and for sharing across services.

Pick the most local option that works. A package-level pool is a global; treat it as you would any global state.

### Decision 2: is the pool part of the public API?

If callers can `Get` from your pool directly, the pool *is* the API. Consider:

```go
// Bad: leaks implementation
package svc

var BufPool sync.Pool

// Good: hide behind methods
package svc

var bufPool sync.Pool

func GetBuf() *bytes.Buffer { ... }
func PutBuf(b *bytes.Buffer) { ... }
```

Or even better, a closure that ensures `Reset` and `Put`:

```go
func WithBuf(f func(*bytes.Buffer)) {
    b := bufPool.Get().(*bytes.Buffer)
    b.Reset()
    defer bufPool.Put(b)
    f(b)
}
```

Callers cannot forget `Reset`. Callers cannot capture `b` past the call. The pool is implementation.

### Decision 3: is pooling necessary, or just present?

A pool that was added in 2018 may have served a workload that no longer exists. Profile and remove if it does not earn its keep. Stale pools accumulate (each is some bytes of code + bookkeeping) and confuse readers.

A useful question: "if I remove this pool, what production metric gets worse?" If you cannot name a metric, the pool is dead code.

### Decision 4: should the pool be per-tenant?

Multi-tenant services sometimes ask whether to give each tenant its own pool. Answer: almost always no.

- Per-tenant pools fragment memory.
- Per-tenant pools have low hit rates if traffic is uneven.
- The aliasing concern ("tenant A's data leaks to tenant B") is solved by complete `Reset`, not by separate pools.

A shared pool with rigorous `Reset` is simpler and faster than per-tenant pools.

---

## When Not to Use `sync.Pool`

A definitive list. Memorise this — it is the difference between a senior engineer and a junior with a clever toolbox.

### 1. Connection pooling (database, HTTP, gRPC)

Connections have:

- Authentication state (session tokens, TLS context).
- Transaction context (the DB may be mid-transaction).
- Server-side per-connection state (prepared statements, query cache).
- Finite OS-level quotas (file descriptors, socket buffers).

If `sync.Pool` evicts a connection on GC, you lose all of the above. The connection's TCP socket stays open until the kernel times it out, and the next `New` opens a fresh one — quickly exhausting the OS limit.

Use `database/sql.DB`, `net/http.Transport`, `grpc.ClientConn` (which has its own connection management), or a dedicated pool library like `hashicorp/go-pool`.

### 2. File handles, pipes, sockets, channels, mutexes

All have OS or runtime-level identity that cannot be reconstructed by `New`. The runtime cannot tell the kernel "please give me back fd 7." It can only `New` a fresh handle. The old one leaks.

### 3. Long-lived caches

If you need an object to outlive the next GC, `sync.Pool` is the wrong abstraction. Examples:

- A precomputed lookup table.
- Per-user session state.
- An LRU cache of expensive results.

Use `sync.Map`, a hand-rolled `map[K]V` + mutex, or a real cache library (`hashicorp/golang-lru`).

### 4. Singletons

`sync.Pool` returns *any* item, possibly more than one. A singleton must be exactly one. Use `sync.Once`.

### 5. Per-request unique state

If each request needs its own state and that state is not interchangeable (e.g. a `*http.Request` itself, a session ID, a user object), do not pool. Pool the *containers* that hold per-request data, not the data.

### 6. Objects whose construction has side effects

`New` may be called many times. If construction:

- Allocates a goroutine that runs forever.
- Opens a file or socket.
- Increments a global counter.
- Registers a finalizer.

… then `sync.Pool` will repeat those side effects on every cache miss. Disaster.

### 7. Tiny objects

A pooled item lives in the pool's interface storage. The interface header alone is 16 bytes. Plus the pool's bookkeeping. Plus the per-P shard cost. Pooling an `int`, a `[3]byte`, or any object smaller than ~64 bytes is a net loss.

### 8. Wildly variable-size objects

If your pool holds buffers ranging from 100 B to 100 MB, every `Get` may give you a 100 MB buffer when you wanted 100 B. Memory bloats. Solution: split into per-size pools, or drop oversized items before `Put`.

### 9. Objects you need to count

`sync.Pool` provides no `Len()`, no `Size()`, no metrics. If you need to know "how many are in the pool right now," it is the wrong tool. Use a bounded channel or a custom pool.

### 10. Anything you would mock in a test

Pools, especially package-level ones, are global. Tests share them. A test that fills the pool with bad data can break another test. If you need to mock the pool behavior, abstract it (interface) and inject — at which point you might as well not use `sync.Pool` directly.

---

## Building Bounded Pools When `sync.Pool` Will Not Do

When `sync.Pool` is the wrong fit but you still want object reuse, hand-roll a bounded pool. Three common shapes.

### Shape 1: channel-backed bounded pool

```go
type BoundedPool[T any] struct {
    ch  chan T
    new func() T
}

func NewBounded[T any](size int, newFn func() T) *BoundedPool[T] {
    return &BoundedPool[T]{
        ch:  make(chan T, size),
        new: newFn,
    }
}

func (p *BoundedPool[T]) Get() T {
    select {
    case v := <-p.ch:
        return v
    default:
        return p.new()
    }
}

func (p *BoundedPool[T]) Put(v T) {
    select {
    case p.ch <- v:
    default:
        // pool full; drop
    }
}
```

Strict bound: at most `size` objects in the pool at any time. GC does not evict (the channel holds strong references). Use when you need predictable memory and the pool is not on a critical fast path.

Trade-off: a channel `recv`/`send` is more expensive than `sync.Pool`'s per-P fast path (~50-100 ns vs ~5-10 ns). For very hot paths, prefer `sync.Pool`.

### Shape 2: ring-buffer with semaphore

For more control, a fixed-size ring with a semaphore for capacity:

```go
type RingPool[T any] struct {
    mu   sync.Mutex
    ring []T
    head int
    tail int
    n    int
    new  func() T
}

// implementation elided — push to tail, pop from head, lock for both
```

More memory-efficient than channels for large pools, but introduces explicit locking. Useful for very large pool sizes (thousands of items).

### Shape 3: per-CPU bounded pool

Combine `sync.Pool`'s per-P sharding with bounded semantics. Each shard is a small ring:

```go
type ShardedPool[T any] struct {
    shards []shard[T]
    new    func() T
}

type shard[T any] struct {
    _   [64]byte // false-sharing padding
    mu  sync.Mutex
    buf []T
}
```

Each `Get` hashes the calling goroutine (or uses `runtime_procPin`) to a shard, locks that shard briefly, pops. Bounded per shard, lock contention only with other goroutines on the same shard. The complexity is real; only build this if you have measured `sync.Pool` and a channel pool and neither fits.

### When to pick which

| Need | Choice |
|---|---|
| Maximum throughput, GC eviction OK | `sync.Pool` |
| Hard memory bound, OK to drop on full | channel-backed |
| Hard memory bound, must wait when full | channel-backed (blocking send) |
| Per-resource quota (e.g. DB connections) | dedicated library, not custom |
| Mostly read, rarely contended | channel-backed |
| Very high contention, many cores | sharded or `sync.Pool` |

---

## Pool Telemetry and Observability

`sync.Pool` is the most opaque primitive in the standard library. There is no `Len()`, no hit rate, no eviction count. For production observability you must wrap.

### Wrapper with counters

```go
type ObservablePool[T any] struct {
    inner sync.Pool
    hits  atomic.Int64
    misses atomic.Int64
}

func (p *ObservablePool[T]) Get() T {
    v := p.inner.Get()
    if _, ok := v.(*sentinelNew); ok {
        p.misses.Add(1)
    } else {
        p.hits.Add(1)
    }
    return v.(T)
}
```

To detect a miss vs a hit, you need `New` to return a sentinel-tagged value. One pattern: a thin wrapper struct that includes a `fromNew bool` field, cleared after the first use.

The honest answer: `sync.Pool` does not expose hit/miss directly. You can approximate by counting `New` calls vs `Get` calls in a wrapper. The instrumentation adds a few ns per call.

### Exposing via `expvar` or Prometheus

```go
var (
    poolGets  = expvar.NewInt("pool.gets")
    poolPuts  = expvar.NewInt("pool.puts")
    poolMisses = expvar.NewInt("pool.misses")
)
```

In production, plot the ratio `(gets - misses) / gets` over time. A drop from 99% to 50% is a signal — perhaps your traffic dropped (less `Put` activity), or GC fired more often (more eviction), or your code path changed.

### Sampling for cheap observability

Instrumenting every `Get` and `Put` adds cost. Sample 1 in 1000:

```go
if rand.Intn(1000) == 0 {
    poolGets.Add(1000) // count as 1000 to keep the rate meaningful
}
```

The pool's correctness does not depend on metrics; sampling is fine.

---

## Pool API Design for Libraries

If you write a library that uses `sync.Pool` internally, how do you surface that to callers? Several options.

### Option 1: hidden completely

```go
package mylib

var bufPool = sync.Pool{...}

func Format(v any) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    // ...
}
```

Callers know nothing. Pure implementation detail. Best for utility libraries.

### Option 2: exposed via a `Pool` type

```go
package mylib

type Pool struct { inner sync.Pool }

func NewPool() *Pool { ... }
func (p *Pool) Format(v any) string { ... }
```

Callers can have multiple pools (e.g. one per logical context). More flexible, more surface area.

### Option 3: customizable via options

```go
package mylib

type Options struct {
    MaxBufCap int  // drop buffers above this cap
    PoolSize  int  // for bounded pools
}
```

Configuration knobs let callers tune. Use sparingly — every option is a maintenance burden.

### Option 4: pluggable factory

```go
package mylib

type BufFactory interface {
    Get() *bytes.Buffer
    Put(*bytes.Buffer)
}

func NewWithBufs(f BufFactory) *Service { ... }
```

Callers can plug in `sync.Pool`-backed, channel-backed, or no-op (always-new) implementations. Maximum flexibility, maximum complexity. Reserve for high-performance libraries where users have strong opinions.

### Rule of thumb

Start with Option 1. Promote to 2 if multiple pools per process are useful. Promote to 3 if knobs are essential. Reach for 4 only if benchmarks demand it.

---

## Refactoring Production Pools

Pools accumulate. Five years into a codebase, you have dozens. Some help, some do not, some are dangerous. How to clean up?

### Step 1: inventory

```bash
grep -rn "sync.Pool" --include="*.go" .
```

For each:

- What type does `New` return?
- Who calls `Get`?
- Who calls `Put`?
- Are the calls paired (e.g. always-deferred)?

### Step 2: classify

Mark each pool as:

- **Hot:** > 10 K `Get`/sec in production.
- **Warm:** 100 - 10 K /sec.
- **Cold:** < 100 /sec.

The classification needs production telemetry. If you do not have it, instrument first.

### Step 3: act

- **Hot pools:** leave alone unless there is a known bug. Hot pools are load-bearing.
- **Warm pools:** review for correctness. Check `Reset`, check capacity bound, check escape analysis.
- **Cold pools:** strong candidate for removal. Replace with direct allocation; measure; if metrics do not change, delete.

### Step 4: migrate

When changing a pool's behaviour:

- Add the new pool alongside the old.
- Migrate one caller at a time.
- Remove the old after a release cycle.

Pools are easy to add and hard to remove because the consumers grow. Plan deletion.

### Step 5: document

For every pool that remains, write a comment:

```go
// bufPool: pool for response buffer formatting. ~50K Gets/sec in prod.
// Drops items > 64 KB to bound memory. Pair with sync.Pool benchmark in
// buf_bench_test.go.
var bufPool = sync.Pool{...}
```

Future readers will know why, how much, and where to verify.

---

## Self-Assessment

- [ ] I can explain the per-P shard fast path of `sync.Pool` without reading source.
- [ ] I can describe what the victim cache does and why it was added.
- [ ] I know that pool items live across at most one GC cycle (one in main, one in victim).
- [ ] I can list eight or more situations where `sync.Pool` is the wrong tool.
- [ ] I have implemented or read a channel-backed bounded pool.
- [ ] I have wrapped a `sync.Pool` with counters to expose hit-rate metrics.
- [ ] I have removed a pool from production code and verified that metrics did not regress.
- [ ] I can choose between Options 1-4 for exposing a pool in a library API.

---

## Summary

`sync.Pool`'s speed comes from a per-P sharded design: each runtime processor has its own private + shared queue, accessed lock-free in the common case. Stealing from other Ps handles the empty case. The victim cache (Go 1.13+) softens GC eviction by keeping a second tier; items live at most one GC cycle.

That design dictates use: anonymous, interchangeable, temporary objects only. Connection pools, file handles, long-lived caches, singletons, tiny objects, and side-effect-laden constructors all belong elsewhere. When `sync.Pool` is the wrong shape, hand-roll a channel-backed bounded pool — slower but predictable.

In production, pools need telemetry (hit rate, drop rate) and curation. Pools accumulate; classify them as hot, warm, cold and prune the cold. Library APIs should hide pools behind clean types unless callers explicitly need to tune them. Pools earn their place when measured by `-benchmem`, `pprof -alloc_objects`, and GC traces — not by intuition.

The professional file dives into the actual runtime data structures: `poolLocal`, `poolDequeue`, the lock-free ring, and the runtime hooks that integrate the pool with the garbage collector.
