---
layout: default
title: Professional
parent: Mutex Copying
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 4
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/02-mutex-copying/professional/
---

# Mutex Copying — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Lock-free alternatives — when and why](#lock-free-alternatives--when-and-why)
3. [Atomic operations as a mutex replacement](#atomic-operations-as-a-mutex-replacement)
4. [sync.Map — what it is and what it is not](#syncmap--what-it-is-and-what-it-is-not)
5. [Sharded maps — design and trade-offs](#sharded-maps--design-and-trade-offs)
6. [RWMutex in depth](#rwmutex-in-depth)
7. [Copy-on-write with atomic.Value](#copy-on-write-with-atomicvalue)
8. [Mutex contention monitoring in production](#mutex-contention-monitoring-in-production)
9. [Continuous profiling pipelines](#continuous-profiling-pipelines)
10. [Distributed locking pitfalls](#distributed-locking-pitfalls)
11. [Production case studies](#production-case-studies)
12. [Operational playbooks](#operational-playbooks)
13. [Architectural patterns at scale](#architectural-patterns-at-scale)
14. [Mutex-free data structures](#mutex-free-data-structures)
15. [Latency budgets and lock holding](#latency-budgets-and-lock-holding)
16. [Anti-patterns at the architecture level](#anti-patterns-at-the-architecture-level)
17. [Capacity planning around locks](#capacity-planning-around-locks)
18. [Migrating large codebases off shared mutex hot paths](#migrating-large-codebases-off-shared-mutex-hot-paths)
19. [Summary](#summary)

---

## Introduction

At the professional level, the question is no longer "is my code free of mutex copy bugs?" — that should be settled by tooling and discipline at the senior level. The question is: "is my use of mutexes the right design for this service at this scale, in production, under real load, observed by real operators?"

Professional engineers think about:

- **Throughput**: how many operations per second can my service sustain? Where does the lock-induced ceiling sit?
- **Latency**: what is the tail latency distribution? Are mutex acquisitions appearing in p99?
- **Cost**: how much does my mutex strategy cost in machine time, in operational toil, in code maintenance?
- **Observability**: can my SREs see mutex contention as it happens? Do dashboards exist?
- **Evolution**: as load grows, what is the next mutex strategy? At what scale does each strategy break down?

The mutex copy hazard is real at this scale too, but it manifests differently. A hot path with a copy bug looks like "this service is CPU-bound but I can't make it faster" rather than "this code is broken in tests." Profiling sees through the bug; intuition does not.

This document covers the patterns that mature Go services use to manage mutex contention, the production observability story, and the special challenges of distributed locking — which is locking across processes, with all the failure modes that brings.

---

## Lock-free alternatives — when and why

A mutex is the simplest correct synchronisation primitive. It is also slow when contended. Production-grade services often replace mutexes with lock-free alternatives in hot paths.

### When lock-free wins

Lock-free is appropriate when:

1. **The critical section is short** — a few instructions, perhaps reading and writing a counter.
2. **Contention is high** — many goroutines are competing.
3. **The data structure is amenable** — counters, set-of-pointers, ring buffers, single-producer-single-consumer queues are all good candidates.
4. **Stack depth is a concern** — lock-free code does not park goroutines, so stack memory is not held during contention.

### When lock-free loses

Lock-free is *not* appropriate when:

1. **The critical section is large** — a CAS loop retrying many times is slower than a single mutex acquisition.
2. **Correctness is subtle** — lock-free algorithms are infamous for ABA problems, ordering bugs, and edge cases.
3. **The data structure is complex** — a balanced tree, a hash table, a multi-step transaction — these benefit from coarse locking.
4. **Readability matters more than throughput** — a clear mutex-based design is easier to maintain than a clever lock-free one.

### The cost spectrum

Approximate costs on modern hardware (single-core, 2024 Go on amd64):

| Operation | Latency |
|-----------|---------|
| Plain memory write | <1 ns |
| `atomic.LoadInt64` | 1-2 ns |
| `atomic.StoreInt64` | 1-2 ns |
| `atomic.AddInt64` | 5-10 ns |
| `atomic.CompareAndSwapInt64` | 5-10 ns |
| Uncontended `sync.Mutex.Lock` | 10-20 ns |
| Contended `sync.Mutex.Lock` (spinning) | 100-500 ns |
| Contended `sync.Mutex.Lock` (parking) | 2-10 μs |

A loop of 5 CAS attempts costs ~25-50 ns. A single contended mutex acquisition that parks costs 2-10 μs. The lock-free version is 100-1000x faster in the contended case.

But: if your CAS loop spins 100 times, it costs ~1 μs and may be no better than the mutex.

### Memory model implications

Lock-free code makes happens-before relations *explicit* through atomic ordering. Go's `sync/atomic` defaults to sequentially-consistent ordering — the strongest. This makes reasoning simpler than C++ atomics (which expose weaker orderings) but also makes Go atomics slower than they could be on weak-memory architectures.

For most uses, sequential consistency is the right default. Senior-level performance work occasionally benefits from looser ordering, but Go does not expose this.

---

## Atomic operations as a mutex replacement

The `sync/atomic` package provides operations on int32, int64, uint32, uint64, uintptr, and unsafe.Pointer. Go 1.19 added typed wrappers: `atomic.Int32`, `atomic.Int64`, `atomic.Uint32`, `atomic.Uint64`, `atomic.Uintptr`, `atomic.Bool`, `atomic.Pointer[T]`, and `atomic.Value`.

### Replacing a counter

```go
// Before: mutex-protected counter
type Counter struct {
    mu sync.Mutex
    n  int64
}

func (c *Counter) Inc()        { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c *Counter) Get() int64 { c.mu.Lock(); defer c.mu.Unlock(); return c.n }

// After: atomic counter
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc()        { c.n.Add(1) }
func (c *Counter) Get() int64 { return c.n.Load() }
```

The atomic version is faster, simpler, and impossible to misuse with copy bugs *of the mutex* — though `atomic.Int64` itself must not be copied (it has a `noCopy` marker).

### Replacing a boolean flag

```go
// Before
type Flag struct {
    mu  sync.Mutex
    set bool
}

func (f *Flag) Set()      { f.mu.Lock(); f.set = true; f.mu.Unlock() }
func (f *Flag) IsSet() bool { f.mu.Lock(); defer f.mu.Unlock(); return f.set }

// After
type Flag struct {
    set atomic.Bool
}

func (f *Flag) Set()      { f.set.Store(true) }
func (f *Flag) IsSet() bool { return f.set.Load() }
```

Same gain.

### Replacing a pointer swap

```go
// Before
type Config struct {
    mu  sync.RWMutex
    cur *Settings
}

func (c *Config) Get() *Settings {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.cur
}

func (c *Config) Set(s *Settings) {
    c.mu.Lock()
    c.cur = s
    c.mu.Unlock()
}

// After
type Config struct {
    cur atomic.Pointer[Settings]
}

func (c *Config) Get() *Settings { return c.cur.Load() }
func (c *Config) Set(s *Settings) { c.cur.Store(s) }
```

A clear win.

### Compare-and-swap loops

When the update depends on the current value:

```go
type Stats struct {
    max atomic.Int64
}

func (s *Stats) RecordIfMax(v int64) {
    for {
        cur := s.max.Load()
        if v <= cur {
            return
        }
        if s.max.CompareAndSwap(cur, v) {
            return
        }
    }
}
```

The CAS loop reads, computes, and atomically writes if no one else changed the value in between. If someone did, retry.

### Composite state

Atomic operations work for single words. For multi-field state, you either:

- Pack the state into a single word (e.g., two 32-bit values into a 64-bit slot).
- Use a pointer to an immutable struct, swapped atomically.
- Fall back to a mutex.

Packing example: a state with "count" and "version":

```go
type Combined struct {
    cv atomic.Uint64 // count in low 32 bits, version in high 32 bits
}

func (c *Combined) Snapshot() (count uint32, version uint32) {
    v := c.cv.Load()
    return uint32(v), uint32(v >> 32)
}

func (c *Combined) Update(count uint32, version uint32) {
    v := uint64(count) | (uint64(version) << 32)
    c.cv.Store(v)
}
```

Packing is fragile (changes to data layout require careful migration), but it scales perfectly under contention.

### Pointer-swap pattern (RCU-lite)

For complex read-mostly state, the "swap-the-whole-thing" pattern works well:

```go
type Snapshot struct {
    counts map[string]int64
    asOf   time.Time
}

type Service struct {
    snap atomic.Pointer[Snapshot]
}

func (s *Service) GetCounts() map[string]int64 {
    return s.snap.Load().counts // map header is shared but immutable
}

func (s *Service) refresh() {
    newSnap := computeFresh() // expensive
    s.snap.Store(newSnap)
}
```

Readers see a consistent snapshot. Writers replace the pointer atomically. No locks. Old snapshots are GC'd when no goroutine holds them.

The catch: if you mutate the map inside `Snapshot.counts` after storing, you race. The pattern requires immutability after store. Build a new map for each update.

### Limits of atomics

Atomics do not solve every problem:

- They do not provide *fairness* — a hot CAS loop can starve under heavy contention.
- They do not provide *transactional semantics* — multi-step updates that require all-or-nothing cannot be atomicised easily.
- They do not provide *blocking semantics* — there is no "wait until this becomes 5."

For these, use a mutex (or a channel).

---

## sync.Map — what it is and what it is not

`sync.Map` is a concurrent map provided by the standard library. It is specialised for two access patterns:

1. **One-write, many-read** — a key is written once and then read repeatedly.
2. **Disjoint writers** — many goroutines write but to different keys.

For these patterns, `sync.Map` outperforms `map[K]V + sync.RWMutex` because reads can proceed without taking any lock (the implementation uses two internal maps and atomic load/store on the "read" map).

### Internal design

`sync.Map` is roughly:

```go
type Map struct {
    mu     sync.Mutex
    read   atomic.Pointer[readOnly]
    dirty  map[any]*entry
    misses int
}
```

- `read` is the lock-free hot map. Loads check it first.
- `dirty` is the lock-protected mutable map. Stores and Loads-with-miss go through it.
- After enough misses, `dirty` is promoted to `read`.

The two-map design provides:

- O(1) lock-free read for keys present in `read`.
- O(1) locked read for keys present only in `dirty`.
- O(1) locked write.

### When sync.Map wins

- Caches: keys written once, read many times.
- Per-key state that is rarely contended (different keys handled by different goroutines).
- Storing connection state in a server, keyed by connection ID.

### When sync.Map loses

- General-purpose maps: writes and reads roughly equal.
- Workloads where keys are read once after write (no benefit from the lock-free fast path).
- Workloads requiring ranged iteration with consistency (Range provides only a best-effort snapshot).

A common mistake: replace `map[K]V + sync.RWMutex` with `sync.Map` and assume a win. Benchmark first. For mixed read/write workloads, the RWMutex version often outperforms sync.Map.

### sync.Map and copy semantics

`sync.Map` contains a mutex. It must not be copied. Vet flags copies. The `noCopy` marker is included.

```go
type registry struct {
    m sync.Map
}

func (r registry) Lookup(k string) (any, bool) { return r.m.Load(k) } // BUG: value receiver
```

Vet catches this. Use pointer receivers.

### Generics version

`sync.Map` is type-`any`, requiring assertions. For typed maps, third-party libraries (e.g., `github.com/puzpuzpuz/xsync`) provide generic alternatives. Or wrap:

```go
type TypedMap[K comparable, V any] struct {
    m sync.Map
}

func (t *TypedMap[K, V]) Load(k K) (V, bool) {
    v, ok := t.m.Load(k)
    if !ok {
        var zero V
        return zero, false
    }
    return v.(V), true
}

func (t *TypedMap[K, V]) Store(k K, v V) {
    t.m.Store(k, v)
}
```

The wrapper adds an assertion per Load but no allocation (the value is stored as an interface internally either way).

---

## Sharded maps — design and trade-offs

When a single mutex protects a large amount of data and contention is high, sharding splits the data across multiple mutexes. Each shard has its own lock; operations on different shards proceed in parallel.

### Basic shard structure

```go
type ShardedMap[K comparable, V any] struct {
    shards [numShards]shard[K, V]
}

type shard[K comparable, V any] struct {
    mu sync.RWMutex
    m  map[K]V
}

const numShards = 64

func hash[K comparable](k K) uint64 {
    // pick a hash function for K
    return ... // hash bytes of k
}

func (s *ShardedMap[K, V]) shardOf(k K) *shard[K, V] {
    return &s.shards[hash(k)%numShards]
}

func (s *ShardedMap[K, V]) Get(k K) (V, bool) {
    sh := s.shardOf(k)
    sh.mu.RLock()
    defer sh.mu.RUnlock()
    v, ok := sh.m[k]
    return v, ok
}

func (s *ShardedMap[K, V]) Set(k K, v V) {
    sh := s.shardOf(k)
    sh.mu.Lock()
    sh.m[k] = v
    sh.mu.Unlock()
}
```

### Choosing the shard count

- Too few shards: each shard still has high contention.
- Too many shards: memory overhead, cache miss overhead, and the hash distribution suffers.
- Rule of thumb: 2-4x the expected concurrent goroutine count, rounded to a power of 2 for `&` masking.

A common choice for high-traffic services is 256 or 512 shards. For modest traffic, 16-64 is plenty.

### Sharding does not eliminate copy hazards

If the shard struct contains a `sync.Mutex` and you accidentally copy a shard (e.g., by returning a shard by value from a helper function), you have the same bug at the shard level. The same vet checks apply.

The typical mistake:

```go
func (s *ShardedMap) hottestShard() shard { // COPY
    // ...
}
```

Use `*shard`.

### Hash function choice

For string keys, `runtime.memhash` (the same hash used by Go's built-in map) is fastest but unexported. Reasonable alternatives:

- `hash/fnv` — fast, decent distribution.
- `hash/maphash` — Go 1.14+, designed for hash-table use, seeded for DoS resistance.
- For integer keys, multiplication-based hashing (Fibonacci hashing) is sufficient.

Avoid weak hashes (e.g., simple XOR) that cluster keys.

### Range and consistent snapshots

Iterating across all shards is *not* atomic. Different shards may be modified during the iteration. If you need a consistent snapshot, you have three options:

1. Lock all shards (RLock for read-only iteration). Expensive.
2. Take a copy of each shard's map under its lock, release, then iterate the copies. Expensive in memory but allows parallel collection.
3. Accept eventually-consistent semantics — most callers can.

### Real-world sharded map libraries

- `github.com/puzpuzpuz/xsync/v3` — well-tuned sharded map with typed APIs.
- `github.com/orcaman/concurrent-map` — older, popular.
- `github.com/dgraph-io/ristretto` — a high-performance cache that internally uses sharding.

Production code often uses these instead of rolling its own.

---

## RWMutex in depth

`sync.RWMutex` allows multiple readers or one writer, but never both simultaneously. The internal state is more complex than `sync.Mutex`:

```go
type RWMutex struct {
    w           Mutex
    writerSem   uint32
    readerSem   uint32
    readerCount atomic.Int32
    readerWait  atomic.Int32
}
```

- `w` is a regular mutex used by writers to serialise among themselves.
- `readerCount` is the active reader count.
- `readerWait` is the number of readers a pending writer is waiting for.
- `writerSem` and `readerSem` are parking semaphores.

### Reader fast path

`RLock`:

```go
func (rw *RWMutex) RLock() {
    if rw.readerCount.Add(1) < 0 {
        // A writer is pending; park on readerSem.
        runtime_SemacquireMutex(&rw.readerSem, false, 0)
    }
}
```

If no writer is active or pending, the increment lands non-negative and we return. Cost: one atomic add.

### Writer fast path

`Lock`:

```go
func (rw *RWMutex) Lock() {
    rw.w.Lock() // exclude other writers
    // Announce pending write to readers.
    r := rw.readerCount.Add(-rwmutexMaxReaders) + rwmutexMaxReaders
    if r != 0 && rw.readerWait.Add(r) != 0 {
        runtime_SemacquireMutex(&rw.writerSem, false, 0)
    }
}
```

The writer atomically subtracts `rwmutexMaxReaders` (1<<30) from `readerCount`, making it negative. New readers see the negative count and park. Existing readers' `RUnlock` decrements `readerWait`; when it reaches zero, the writer is signalled.

### Reader-bias vs writer-bias

`RWMutex` is *neither* strictly reader-biased nor writer-biased. A pending writer blocks new readers from acquiring, preventing writer starvation. Active readers complete before the writer proceeds, preventing reader starvation in the simple case. The implementation is fair-ish.

### When RWMutex wins

- Read-dominated workloads (>10:1 read:write ratio).
- Read operations that are slow (e.g., complex traversal under the lock).
- Workloads where reader fairness is acceptable.

### When RWMutex loses

- Read-write balanced workloads — the overhead of RWMutex's bookkeeping is greater than `sync.Mutex`'s.
- Very short critical sections — the atomic operations in `RLock`/`RUnlock` cost more than the work being done.
- Workloads where writers must not be starved.

The conventional wisdom: try `sync.Mutex` first, profile, switch to `RWMutex` only if reads dominate and the contention is real.

### RWMutex copy hazards

Same as `sync.Mutex`. The struct has multiple atomic fields; copying breaks every one. Vet flags. The `noCopy` rule applies.

### Sharded RWMutex

Combining sharding and read/write distinction:

```go
type ShardedCache[K comparable, V any] struct {
    shards [256]struct {
        mu sync.RWMutex
        m  map[K]V
    }
}
```

For a read-heavy cache, this scales beautifully. Each shard has its own RWMutex, and read-heavy access patterns distribute well across shards.

### Recursive read-locking (forbidden)

A subtle pitfall:

```go
func (s *Store) Read() {
    s.mu.RLock()
    defer s.mu.RUnlock()
    s.helper() // calls RLock again
}

func (s *Store) helper() {
    s.mu.RLock()
    defer s.mu.RUnlock()
    // ...
}
```

The Go runtime documentation says: "If a goroutine holds a RWMutex for reading and another goroutine might call Lock, no goroutine should expect to be able to acquire a read lock until the initial read lock is released." In practice, this means recursive RLock can deadlock if a writer arrives between the two RLocks. The first RLock holds the count. The writer enters, sets the writer-pending state, parks waiting for readers to drain. The second RLock arrives and parks (sees negative count). The goroutine is now holding one read lock and waiting for another. Deadlock.

Solution: never recursively RLock. Either separate the public API from the locked implementation, or hold the lock outside and pass the data in.

---

## Copy-on-write with atomic.Value

For data that is read frequently and updated rarely, copy-on-write with `atomic.Value` (or `atomic.Pointer[T]`) is faster and simpler than RWMutex.

### Pattern

```go
type Snapshot struct {
    data map[string]int
}

type Store struct {
    snap atomic.Pointer[Snapshot]
}

func NewStore() *Store {
    s := &Store{}
    s.snap.Store(&Snapshot{data: map[string]int{}})
    return s
}

func (s *Store) Get(k string) (int, bool) {
    snap := s.snap.Load()
    v, ok := snap.data[k]
    return v, ok
}

func (s *Store) Set(k string, v int) {
    for {
        old := s.snap.Load()
        next := &Snapshot{data: make(map[string]int, len(old.data)+1)}
        for kk, vv := range old.data {
            next.data[kk] = vv
        }
        next.data[k] = v
        if s.snap.CompareAndSwap(old, next) {
            return
        }
        // Another writer interleaved; retry.
    }
}
```

Reads are a single atomic load. Writers do an O(n) copy under a CAS loop. For maps with thousands of entries and rare writes, this works well. For million-entry maps, the copy cost is prohibitive.

### Comparison with RWMutex

| Aspect | RWMutex | atomic.Pointer COW |
|--------|---------|--------------------|
| Read cost | Two atomic ops | One atomic op |
| Write cost | One lock + map mutation | O(n) full copy + CAS |
| Memory | Map size | Up to 2x map size during update |
| Reader-writer fairness | Built-in | Readers never block |
| Bulk update | One Lock | One copy + CAS |

For read-heavy workloads with small maps and rare writes, COW wins. For write-heavy or large maps, RWMutex wins.

### Hybrid: COW with structural sharing

Persistent data structures (HAMT, RRB trees) provide COW with O(log n) update cost. Libraries: `github.com/benbjohnson/immutable`. For very large read-heavy data, these can beat both RWMutex and naive COW.

---

## Mutex contention monitoring in production

A production Go service running at scale must monitor mutex contention. The mutex profile, enabled via `runtime.SetMutexProfileFraction(N)`, is the foundation.

### Enabling the profile in production

```go
func init() {
    // Sample 1 in 1000 blocking events.
    runtime.SetMutexProfileFraction(1000)
    // Enable block profile for events lasting >= 1ms.
    runtime.SetBlockProfileRate(int(time.Millisecond))
}
```

Overhead at these rates: typically <0.5% CPU. Worth it for the observability.

### Exposing the profile

Use `net/http/pprof` (the side-effect import):

```go
import _ "net/http/pprof"

func main() {
    go func() {
        log.Println(http.ListenAndServe("localhost:6060", nil))
    }()
    // ... main service ...
}
```

Then `go tool pprof http://service-host:6060/debug/pprof/mutex` from your laptop pulls a profile.

In production, the pprof endpoint should be on an admin port, not the main service port. Restrict access via firewall or auth.

### Continuous capture

Better than ad-hoc: capture profiles continuously and ship them to a central pprof server (e.g., Pyroscope, Parca, Google Cloud Profiler).

```go
import "github.com/pyroscope-io/client/pyroscope"

func main() {
    pyroscope.Start(pyroscope.Config{
        ApplicationName: "myservice",
        ServerAddress:   "http://pyroscope:4040",
        ProfileTypes: []pyroscope.ProfileType{
            pyroscope.ProfileCPU,
            pyroscope.ProfileAllocObjects,
            pyroscope.ProfileMutexCount,
            pyroscope.ProfileMutexDuration,
            pyroscope.ProfileBlockCount,
            pyroscope.ProfileBlockDuration,
        },
    })
    // ...
}
```

The profile is captured every few seconds, aggregated, and explorable through the central UI. Differential views (compare last hour to yesterday) make regressions obvious.

### Metrics complementary to profiles

Profiles tell you *which* mutex is hot. Metrics tell you *that* mutex contention is happening.

Useful Prometheus metrics:

- `go_goroutines` — count of goroutines. Sudden spikes correlate with mutex contention.
- `go_sched_latencies_seconds` — scheduler latency histogram. High p99 indicates contention.
- Custom: histogram of mutex acquisition times in your hot paths.

Custom timing example:

```go
import "github.com/prometheus/client_golang/prometheus"

var lockAcquireDuration = prometheus.NewHistogramVec(
    prometheus.HistogramOpts{
        Name:    "service_lock_acquire_duration_seconds",
        Help:    "Time to acquire the named lock.",
        Buckets: prometheus.ExponentialBuckets(0.000001, 2, 24),
    },
    []string{"lock"},
)

func (s *Service) lockedOperation() {
    start := time.Now()
    s.mu.Lock()
    lockAcquireDuration.WithLabelValues("service-main").Observe(time.Since(start).Seconds())
    defer s.mu.Unlock()
    // ...
}
```

This adds about 100 ns of overhead per call (mostly the `time.Now()`). For hot paths, sample (e.g., 1 in 100 calls) instead of always recording.

### Alerting

Set alerts on:

- Mutex profile time exceeding X% of CPU.
- p99 lock acquire duration exceeding Y ms.
- Goroutine count > N (where N is your steady state plus margin).

Tune thresholds to your service.

---

## Continuous profiling pipelines

Capturing one profile and looking at it is occasionally useful. Capturing profiles continuously and indexing them is transformative.

### What to capture

Standard set:

- CPU profile every 60 seconds, 10-second sample.
- Heap profile every 60 seconds.
- Goroutine profile every 60 seconds (cheap).
- Mutex profile every 60 seconds.
- Block profile every 60 seconds.

CPU is the most expensive; the rest are nearly free.

### Indexing

Tools:

- **Pyroscope** (acquired by Grafana Labs) — flamegraph viewer, time-series, multi-host.
- **Parca** — similar, open-source, K8s-friendly.
- **Polar Signals** — commercial.
- **Google Cloud Profiler** — managed, for GCP users.

All consume pprof format, all integrate with Grafana for cross-correlation with metrics.

### Use cases

1. **Regression detection**: a deployment changes mutex behaviour; the next day's profile differs from yesterday's. Investigate.
2. **Incident response**: an alert fires for high p99 latency. Pull the mutex profile from the incident window. Find the hot lock.
3. **Capacity planning**: project profile data forward; estimate when contention becomes prohibitive.
4. **Code review**: during PR review, sample the profile of a load test of the change. Verify no new contention.

### Flame graphs

Mutex profiles render as flame graphs: each function call is a layer, with width proportional to time. The top of the flame is the leaf function whose Lock or Unlock created the contention.

A wide bar at `MyCache.Set` means most contention happens here. Drill in: is it the Set function being called too often, or is it slow inside?

### Sampling fidelity

Higher sampling rate = better fidelity, more overhead. Recommendations:

- Development: `SetMutexProfileFraction(1)` (every event). High overhead but exhaustive.
- Staging: `SetMutexProfileFraction(100)` (1%). Reasonable balance.
- Production: `SetMutexProfileFraction(1000)` (0.1%). Low overhead.

A noisy hot lock shows up at any rate. A subtle one needs higher fidelity.

---

## Distributed locking pitfalls

Distributed locking — coordinating exclusive access across processes — has the same flavour as in-process locking but vastly more failure modes. The core challenge: there is no shared memory; coordination must go through a remote service (Redis, ZooKeeper, etcd, a database).

### The naive approach

```go
func (l *DistLock) Lock(key string) (bool, error) {
    // SET key value NX EX 30
    return l.redis.SetNX(ctx, key, "owned-by-me", 30*time.Second).Result()
}

func (l *DistLock) Unlock(key string) error {
    return l.redis.Del(ctx, key).Err()
}
```

Looks simple. Has many bugs.

### Bug 1: Lock without ownership

```go
ok, _ := l.Lock("resource")
// ... long work ...
l.Unlock("resource") // releases whoever holds the lock now
```

If the work takes longer than 30 seconds, the lock expires. Another process acquires it. When we call Unlock, we delete *their* lock. They proceed without a lock; we proceeded for some time without a lock too. Multiple processes have been in the "critical section" simultaneously.

Fix: use a unique token per lock and check it during Unlock.

```go
token := uuid.New().String()
ok, _ := l.redis.SetNX(ctx, "resource", token, 30*time.Second).Result()
// ... work ...
script := redis.NewScript(`
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`)
script.Run(ctx, l.redis, []string{"resource"}, token)
```

The Lua script ensures atomic check-and-delete. We only unlock if we still own.

### Bug 2: Clock skew between lock holder and lock service

If the lock has a 30-second TTL but my process's clock thinks 35 seconds have passed when only 25 have elapsed on the lock service, I might extend or refresh the lock incorrectly. Or vice versa: the lock service expires a lock that I think I still hold.

Mitigation: monotonic clocks for in-process timing, and treat the lock service's TTL as the authoritative deadline. Never assume your clock matches.

### Bug 3: Network partitions

A network partition isolates the lock holder from the lock service. The service times the lock out (TTL expires). Another process acquires. The original holder is still working, assuming it has the lock. Two processes in the critical section.

This is fundamental: distributed locks cannot prevent "concurrent" critical sections under partition. They can prevent unsynchronised concurrent acquisition in the *no-partition* case. Under partition, you must either:

- Accept the risk (most uses).
- Fence: include a monotonically increasing token with every write, and have the storage reject writes with stale tokens. This is the Fencing Tokens pattern (Martin Kleppmann, "How to do distributed locking").

### Bug 4: Redlock and its critics

The Redlock algorithm (proposed by Redis's author) attempts to provide stronger guarantees by acquiring the lock on a majority of N Redis instances. Critics (Kleppmann, others) argue it does not provide the safety it claims because of clock skew issues.

For most uses, a single Redis instance with TTL and fencing tokens is adequate. For uses where correctness is critical (financial transactions, etc.), use a consensus system (etcd, ZooKeeper) and design with fencing tokens.

### Bug 5: Lock contention without observability

Distributed lock contention is hard to observe from the application. Symptoms (timeouts, retries) look like generic distributed system failure. Tools:

- Log every Lock and Unlock with timestamps and identifiers.
- Emit metrics: lock acquire latency, lock hold duration, lock acquire failure rate.
- Use distributed tracing (OpenTelemetry) to follow lock acquisition across services.

### Bug 6: Locks as queues

A common anti-pattern: use a distributed lock to serialise access to a queue. Each worker grabs the lock, peeks at the queue, takes a task, releases the lock. Result: the lock becomes the bottleneck. The queue throughput equals 1 / (lock-hold-time).

Better: use a queue with native concurrency support (a message broker, or `BLPOP` in Redis). Workers race to consume; the broker handles fairness.

### Bug 7: Locks confused with mutual-exclusion-of-data-mutation

The original mutex protects access to data; the distributed lock often "protects" data that is not actually shared. Re-architect to remove the shared mutation, and the lock becomes unnecessary.

Example: a "scheduled job" runs every minute and writes to a database. To prevent two replicas from running it simultaneously, use a distributed lock. Better: store "last-run-at" in the database with an atomic-conditional-update; only the first replica to update succeeds; others abort. No lock needed.

---

## Production case studies

### Case study 1: The 100x scaling cliff

A service handled 1k req/s comfortably. Pushed to 10k, latency exploded. CPU was 50%. Mutex profile showed >80% of time waiting on one mutex protecting a request-counting map.

The map was `map[string]int64` storing per-endpoint counters. Every request did `m["endpoint"]++` under the lock. At 10k req/s, that's 10k Lock-Unlock cycles per second on one mutex, plus the actual work.

Fix: replace with `atomic.Int64` per endpoint, stored in a `sync.Map` (read-mostly: endpoints rarely change). Latency dropped to baseline. Service scaled to 100k req/s without re-tuning.

Lesson: counters under a mutex are almost always wrong.

### Case study 2: The reader-writer inversion

A cache used `sync.RWMutex`. Reads were 10:1 dominant. Writes were rare but slow (rebuild from a database).

Symptom: every minute, all reads spiked to 100ms+ latency for 5 seconds. Then normal again.

Root cause: when the write started, all current readers had to finish, the writer ran (5 seconds), then new readers proceeded. During the writer's 5 seconds, all incoming reads were queued behind the writer. The "tail" of the spike was readers draining after the writer released.

Fix: replace RWMutex+map with atomic.Pointer[map]. Writer builds the new map off-lock, then swaps the pointer. Readers never block. Latency spike: gone.

Lesson: RWMutex still serialises writes against readers. If writes are slow, the spike is unavoidable. Pointer-swap is better when writes can be done off-lock.

### Case study 3: The contended sync.Map

A team replaced `map+RWMutex` with `sync.Map` based on the standard "concurrent map" reputation. Throughput dropped 30%.

Diagnosis: their workload had roughly equal reads and writes, with high cardinality (many distinct keys, each updated occasionally). `sync.Map`'s read fast path requires keys to be in the "read" map; their workload kept invalidating the read map, forcing all access through the locked `dirty` map.

Fix: revert to `map+RWMutex`. Add sharding (32 shards). Throughput recovered and doubled.

Lesson: `sync.Map` is specialised. Benchmark.

### Case study 4: The mutex copy in the worker pool

A worker pool implementation copied `Worker` structs through a channel. Each worker had a `sync.Mutex` for serialising tasks. The copy created two mutexes per logical worker.

Symptom: under load, "completed task count" was higher than "submitted task count" — some tasks were being counted twice. The mutex copy meant the "completing" goroutine and the "monitoring" goroutine saw different copies; the monitor's view of the worker count never updated.

Fix: switch to `chan *Worker`. Bug resolved.

Lesson: any data structure carrying state across goroutines should be a pointer.

### Case study 5: The slow Redis lock

A service used Redis-based distributed locks to serialise access to a shared resource. Lock acquisition was a SETNX with TTL.

Symptom: random latency spikes for one request type. P99 latency 5 seconds; p50 50ms.

Diagnosis: when Redis was overloaded (a separate issue), SETNX latency could spike. The application waited for the lock acquisition.

Fix: in-process locking was sufficient because all writers ran in the same process. The team had used Redis "in case we ever need multi-process," prematurely. Removed Redis; used `sync.Mutex`. Latency improved.

Lesson: do not pay distributed-locking costs unless you actually need distributed locking.

### Case study 6: The deadlock cascade

A service had two mutexes, A and B. Some code paths locked A then B; others B then A. Under load, deadlocks occurred occasionally.

Diagnosis: goroutine dump (via SIGQUIT or `/debug/pprof/goroutine?debug=2`) showed many goroutines blocked on Lock at one of the two mutexes. Cross-referencing showed the lock order inversion.

Fix: enforce lock order (always A before B). Add a code-review checklist item. Add a custom linter rule.

Lesson: lock order is the universal solution to nested-lock deadlocks. Make it explicit.

### Case study 7: The mutex profile that lied

A service showed near-zero mutex contention in the profile despite obvious performance issues. CPU was 80% on Lock/Unlock-related symbols. Mutex profile was empty.

Diagnosis: a recent refactor had changed receivers from `*T` to `T`. The "mutex" was being copied per call. No goroutine ever blocked because each had its own private mutex. Lock/Unlock fast-path CAS still happened (on different cache lines each time) but never reached the slow path.

Fix: revert to pointer receivers. Mutex profile now showed real contention; the team addressed it via sharding.

Lesson: empty mutex profile + Lock/Unlock dominating CPU = likely copy bug.

### Case study 8: The deferred panic

A service handled requests via a worker pool. Workers had a `sync.Mutex` protecting per-worker state. A code path locked the mutex, did work, then ran arbitrary user code under the lock. The user code occasionally panicked.

The panic was recovered in a deferred function:

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("recovered: %v", r)
    }
}()
w.mu.Lock()
defer w.mu.Unlock()
userCode()
```

Symptom: occasional deadlocks. Why?

Diagnosis: `defer w.mu.Unlock()` did run on panic. The recover ran *outside* the locked block (the recover deferral is registered first; LIFO execution means Unlock runs before recover). All good. So why deadlock?

Closer look: another code path had `defer w.mu.Unlock()` registered *before* `w.mu.Lock()` was called (in a complex branching function). On panic before the Lock ran, the Unlock would run on an unlocked mutex — fatal panic. The "recovered" log line never appeared because the runtime kills the process on mutex misuse.

Fix: ensure `defer Unlock` is always paired immediately after a successful `Lock`. Never separate them.

Lesson: panics interact with mutex bookkeeping. Be precise about Lock/defer-Unlock pairing.

---

## Operational playbooks

When mutex contention strikes in production, follow these steps.

### Step 1: Confirm contention

- Check the mutex profile for the relevant time window.
- Confirm CPU is high but throughput is low.
- Check `go_goroutines` metric — sudden spike is suspicious.

### Step 2: Identify the hot lock

- Top of mutex profile: function name. The "unlock" caller.
- Trace back to the type owning the mutex.

### Step 3: Decide on immediate mitigation

Options, in order of escalating effort:

- **Scale out**: add more replicas. Works if the lock is per-process (in-process mutex) and load can be balanced. Does not work for distributed locks.
- **Shed load**: rate-limit or drop traffic to the contended path. Buys time.
- **Roll back**: revert to a known-good version if recent deploy caused regression.
- **Hot fix**: patch the locking code, deploy.

### Step 4: Long-term remediation

- Re-architect the data structure (sharding, atomics, COW).
- Re-architect the access pattern (read-only after init, eventually-consistent reads, batch updates).
- Re-architect the API (avoid the shared mutation entirely).

### Step 5: Post-incident review

- Why was the contention not caught earlier?
- What metrics would have alerted us sooner?
- What pattern should other teams avoid?
- Document in a post-mortem.

### Step 6: Test in staging

- Reproduce the load conditions.
- Verify the fix.
- Profile in staging before deploying to production.

### Step 7: Deploy gradually

- Canary the fix on a small fraction of traffic.
- Verify metrics stay healthy.
- Roll out.

---

## Architectural patterns at scale

At service scale, mutex contention is a symptom of a bigger architectural question: where does state live, and who can mutate it?

### Single-writer architectures

If only one goroutine writes to a piece of state, readers can access without locks (provided the writer's writes are properly synchronised). Patterns:

- **Actor model**: one goroutine owns the state; others send it messages via a channel.
- **Single-writer command queue**: a worker pulls commands from a channel, executes them, updates state.

The actor pattern eliminates locks entirely. Reads either go through the same channel or through atomic snapshots.

### Sharded ownership

Partition the state by key; each partition has a single owner. Goroutines route operations to the right owner. The owner serialises access to its partition.

This is the architectural equivalent of sharded maps: each "shard" is a goroutine.

### Append-only stores

If you can structure your state as an append-only log, locking becomes trivial (writers append; readers scan). No mutual exclusion of mutation.

This pattern shows up in event-sourcing systems, audit logs, and streaming pipelines.

### Eventually-consistent reads

If readers can tolerate seeing stale data, you can avoid synchronisation with writers. Patterns:

- Read from a stale snapshot (atomic.Pointer swapped occasionally).
- Read from a replica (in a distributed setting).
- Read from a write-through cache that updates eventually.

Trade correctness (freshness) for performance (no locking on reads).

### Functional / immutable architectures

Store state as immutable values. Updates produce new values. Readers see whatever they last loaded. No mutex coordination on the data — only on the pointer that names "current state."

This is the deepest pattern: it eliminates not just locks but the *concept* of "mutation." Languages like Erlang and Haskell are built around it; in Go, you can adopt it selectively.

---

## Mutex-free data structures

A tour of data structures that can be implemented without mutexes.

### Atomic counter (already covered)

`atomic.Int64.Add` is the simplest mutex-free data structure.

### Atomic flag

`atomic.Bool.Store` and `Load`.

### Stack (Treiber stack)

```go
type Node struct {
    val  int
    next *Node
}

type Stack struct {
    head atomic.Pointer[Node]
}

func (s *Stack) Push(v int) {
    n := &Node{val: v}
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}

func (s *Stack) Pop() (int, bool) {
    for {
        old := s.head.Load()
        if old == nil {
            return 0, false
        }
        if s.head.CompareAndSwap(old, old.next) {
            return old.val, true
        }
    }
}
```

Each operation is a CAS loop on the head pointer. Multiple goroutines may push/pop concurrently. The ABA problem (pop sees an old pointer, push reuses memory, pop CAS succeeds incorrectly) is mitigated in Go by the garbage collector — popped nodes are not reused until they are unreachable.

### Queue (Michael-Scott queue)

A lock-free FIFO queue. More complex than a stack because it has two endpoints (head and tail) that may be modified concurrently. The classic algorithm uses a dummy node and careful CAS sequences. Production libraries: `github.com/cocoonspace/lock-free-queue`.

### Hash table

Lock-free hash tables exist (Cliff Click's nbhm, others). They are complex; using a well-tested library is wise.

### Ring buffer

Single-producer-single-consumer ring buffers can be lock-free with just two atomic indices (head, tail). Multi-producer or multi-consumer variants exist but are more complex.

### Channels

Go's `chan` is internally implemented with a mutex (for buffered channels) or a sema-based handshake (unbuffered). For most uses, channels are the right abstraction; their internal implementation is hidden.

### When to roll your own

Almost never. Use:

- `sync/atomic` for simple counters and flags.
- `sync.Map` for one-write-many-read maps.
- `golang.org/x/sync/syncmap` (deprecated) or `xsync.Map` for general concurrent maps.
- Channels for queue semantics with backpressure.
- `sync.Pool` for object pooling.

Custom lock-free data structures are research-grade. Bugs in them are exceptionally hard to diagnose.

---

## Latency budgets and lock holding

For latency-sensitive services, every microsecond counts. Mutex hold time directly affects tail latency.

### The math

Suppose:

- Mutex hold time: 100 μs per operation.
- Operations per second: 100k.
- Number of CPUs: 16.

Time spent under the mutex: 100k * 100 μs = 10 seconds per second. The mutex is the bottleneck. The effective parallelism is 1, regardless of how many CPUs you have.

To use all 16 CPUs, mutex hold time must be ≤ 1/16 of an operation interval = 1/(100k * 16) = 0.625 μs.

### Reducing hold time

Techniques, in order of typical impact:

1. **Move work outside the critical section.** Compute everything possible before locking. Lock, do the minimum (assign a value, append to a slice), unlock. Continue computing.

2. **Avoid I/O under the lock.** Network calls, disk reads, large allocations — all of these can take milliseconds. Holding a mutex during them is a contention disaster.

3. **Batch updates.** Instead of locking 1000 times to make 1000 updates, lock once for all 1000.

4. **Split the lock.** If the lock protects multiple unrelated pieces of data, separate them.

5. **Switch to RWMutex.** If reads dominate, allow concurrent reads.

6. **Switch to atomic.** Counters, flags, pointer swaps need no mutex.

7. **Switch to a lock-free structure.** Last resort.

### Measuring hold time

```go
import "sync"

type TimedMutex struct {
    mu        sync.Mutex
    histogram prometheus.Histogram
    holdStart time.Time
}

func (t *TimedMutex) Lock() {
    t.mu.Lock()
    t.holdStart = time.Now()
}

func (t *TimedMutex) Unlock() {
    t.histogram.Observe(time.Since(t.holdStart).Seconds())
    t.mu.Unlock()
}
```

Sample 1 in 100 calls (record `time.Now()` only sometimes) to keep overhead low.

### Convoy effects

When mutex hold time exceeds the inter-arrival time of contenders, a *convoy* forms: goroutines queue up, each waiting for the previous. The lock holder's hold time bounds the queue's drain rate.

Symptom: latency distribution becomes bimodal — some operations are fast (uncontended), others are slow (queued behind a long hold). Mean latency hides the bimodality; p99 reveals it.

Mitigation: reduce hold time, period.

---

## Anti-patterns at the architecture level

Beyond simple coding mistakes, certain architectural patterns invite mutex problems.

### The global lock

One mutex protects "everything." Every operation in the service goes through it. Scaling stops at one CPU.

Refactor: shard. Or partition by feature.

### The lock-by-default mindset

Every struct has a mutex; every method locks. Even read-only data is locked. Performance dies.

Refactor: identify which data truly needs synchronisation. The rest can be immutable or single-writer.

### The "fixing race by adding mutex"

Race detector flags a write to a field. Developer adds a mutex around that field. Six months later, the mutex is contended.

Refactor: ask why the field is being written by multiple goroutines. Often the answer is "it shouldn't be" and the fix is architectural, not synchronisation.

### The recursive lock

A function locks. It calls another function. That function locks the same mutex. Deadlock.

Refactor: separate the public API (locks, calls private helpers) from the private API (assumes lock held).

### The lock that nobody documented

A mutex protects some data, but it is unclear *which* data. New code modifies fields without locking; old code holds the lock unnecessarily.

Refactor: document, per field, which lock protects it. Use comments.

### The pre-emptive distributed lock

A distributed lock "in case the service ever scales out." The current service is single-instance. The lock adds latency, complexity, and a dependency on Redis.

Refactor: use an in-process mutex now. Add the distributed lock if and when scaling out.

### The lock-as-rate-limiter

A mutex used to serialise calls to an external API (the API has a low rate limit). Becomes the bottleneck.

Refactor: use a proper rate limiter (`golang.org/x/time/rate`). Or batch.

---

## Capacity planning around locks

For services growing in traffic, mutex contention is a *future* problem. Plan ahead.

### Establish baselines

Measure now:

- Throughput per replica.
- p50, p95, p99 latency per endpoint.
- Mutex contention rate (% CPU in lock-related symbols).

### Project growth

If traffic doubles, what happens?

- Linear-scaling code: per-replica throughput stays constant. Add replicas.
- Lock-limited code: per-replica throughput stays constant *only* if the lock is sharded across replicas. If a single lock is the bottleneck, doubling traffic doesn't double throughput — it doubles latency.

### Identify scaling cliffs

Run load tests at 2x, 5x, 10x current traffic. Find where latency curves go superlinear. That's your cliff.

### Plan mitigations

For each cliff, document:

- What the contention is on.
- What the next architectural step is (sharding, atomics, COW).
- The estimated effort and timeline.

### Communicate

Capacity plans involve product, infrastructure, and engineering. The mutex contention story should be visible to all stakeholders.

---

## Migrating large codebases off shared mutex hot paths

Refactoring a hot path that has accumulated mutex-based logic over years is a major project. Approach.

### Phase 1: Measure

- Identify the hot mutex via profile.
- Quantify the contention (CPU%, latency cost).
- Build a benchmark that reproduces the workload.

### Phase 2: Wrap

- Encapsulate access to the contended data behind an interface.
- Existing callers use the interface; existing implementation behind the interface remains unchanged.

### Phase 3: Build alternative implementation

- Sharded, atomic-based, COW, or actor-based — pick the right tool.
- Implement it; test in isolation.
- Use the benchmark to confirm performance gains.

### Phase 4: Switch behind a feature flag

- Default to the old implementation.
- Switch a small fraction of traffic to the new implementation.
- Monitor metrics for regressions.

### Phase 5: Gradual rollout

- Increase the new implementation's share over weeks.
- Roll back at any sign of trouble.
- Eventually, switch fully.

### Phase 6: Remove old code

- Once the new implementation has been at 100% for a few months, remove the old.
- Update documentation.
- Train the team.

### Phase 7: Prevent regression

- Add automated benchmarks that catch contention regressions.
- Add code-review checklist items.

This is a multi-month effort for a significant service. The mutex copy hazards we've discussed in earlier files are *embedded* in such legacy code; refactoring is an opportunity to clean them up too.

---

## Summary

At the professional level, mutex copying is one symptom of a broader concern: synchronisation primitives are tools, not solutions, and they have specific performance characteristics in production.

Key takeaways:

- **Default to no mutex.** Use atomics, channels, immutable data, or single-writer architectures whenever possible.
- **When you need a mutex, default to fine-grained.** Sharding is your friend.
- **Monitor contention.** Mutex profile, block profile, custom timing, continuous profiling.
- **Plan for scale.** Identify cliffs before you hit them.
- **Avoid distributed locks when in-process suffices.** Distributed locks are an order of magnitude more failure-prone.
- **Document locking discipline.** Per-field, per-type, per-package. Future maintainers need it.
- **Treat mutex copy bugs as severity-1.** Even in a profiled, performance-tuned production service, a copy bug can hide. Run vet. Religiously.

The next document (`specification.md`) formalises the rules we've been discussing — the exact semantics of `sync.Mutex`, the `noCopy` idiom, the `copylocks` rule, and the Go memory model guarantees.

---

## Appendix A: A mature service's mutex inventory

Take a hypothetical mature service with the following mutex inventory.

```
Module                       Mutex                         Strategy
---------------------------  ----------------------------  -----------------------------
auth.SessionStore            sync.Map                      one-write-many-read
auth.RateLimiter             []sharded.Mutex (64)         sharded counters
cache.Memory                 atomic.Pointer[Snapshot]      copy-on-write
queue.WorkQueue              chan-based                    no mutex
metrics.Counters             atomic.Int64                  per-counter atomic
config.Settings              atomic.Pointer[Config]        atomic swap
db.ConnectionPool            sync.Mutex (rare contention)  simple, traffic too low to shard
ws.ClientRegistry            sharded sync.Map (32)         per-shard sync.Map
http.AdminAPI                sync.RWMutex                  read-heavy admin endpoints
fs.LocalCache                sync.Mutex + LRU              hot path; planned to shard
```

Each entry has a rationale. Each can be revisited if metrics change.

The team has:

- A mutex profile dashboard.
- An alert on p99 lock acquire >5ms.
- Quarterly review of contention profiles vs. capacity plan.
- A pre-commit hook running `go vet`.
- A CI step running `golangci-lint`.
- Documentation in the package godoc for each shared-state type.

This is what "professional" looks like: explicit, monitored, planned, documented.

---

## Appendix B: Distributed locking — fencing tokens explained

Recall the Redis-based distributed lock had a flaw: under network partition, the lock could expire and be reacquired by another process while the original holder was still working.

The fencing token pattern adds a monotonically increasing token to each lock acquisition. The lock service issues a fresh token each time. The token is passed to all downstream services (storage, etc.). Storage rejects writes with older tokens than the last one it saw.

```go
type Lock struct {
    holder  string
    token   int64  // monotonic; increments on each acquisition
    expires time.Time
}

func acquire(key string) (token int64, err error) {
    // Issue: atomically set new lock with new token if old expired or absent.
    return service.AcquireWithFencing(key, expiry)
}

func write(token int64, data []byte) error {
    return storage.WriteIfTokenIsLatest(token, data)
}
```

If a partition causes the holder to lose the lock, its writes will be rejected by storage when the new holder writes. The first-to-write-after-acquisition wins; later-to-write-with-older-token loses.

This pattern requires storage cooperation. Not all storage systems support it. For systems that do (Cassandra LWT, PostgreSQL with version columns, DynamoDB conditional writes), fencing tokens provide real safety.

Without storage cooperation, distributed locks are best-effort. Design for best-effort failure modes.

---

## Appendix C: When the lock IS the architecture

Sometimes the lock is fundamental. A bank account balance must be updated atomically; readers must see consistent balances. Trying to make this lock-free with naive atomics fails (the "transfer" operation involves two accounts).

For genuine all-or-nothing transactions:

- Use a database with ACID semantics (PostgreSQL with row locks, e.g.).
- Use distributed transactions (two-phase commit, sagas, or careful per-store transactions).
- Accept eventual consistency (CRDTs, vector clocks, conflict resolution).

These are large topics. The takeaway: when your mutex is genuinely modeling "transaction," your design choices are about transactional architectures, not about atomic operations.

---

## Appendix D: Cross-language considerations

If your Go service interoperates with services in other languages (Java, Python, Rust, etc.), each has its own concurrency model. Mutex copying as a hazard is Go-specific (Java's `synchronized` cannot be copied; Python's `threading.Lock` is a reference). But the broader patterns transfer:

- Atomic operations are universal.
- Lock-free data structures exist in all languages.
- Distributed locking patterns are language-agnostic.
- Mutex contention is universal.

The senior-level intuition you've built around mutexes applies to other languages, with the syntax and primitives changed.

---

## Appendix E: A production-ready Counter

Putting it together, a Counter type designed for production:

```go
package metrics

import (
    "sync/atomic"
)

// Counter is a thread-safe counter.
//
// Counter must not be copied after first use. The constructor returns
// a pointer; callers should use it directly.
type Counter struct {
    n atomic.Int64
}

// NewCounter returns a zero-valued Counter.
func NewCounter() *Counter {
    return &Counter{}
}

// Inc increments the counter by 1.
func (c *Counter) Inc() {
    c.n.Add(1)
}

// Add adds delta to the counter.
func (c *Counter) Add(delta int64) {
    c.n.Add(delta)
}

// Load returns the current counter value.
func (c *Counter) Load() int64 {
    return c.n.Load()
}

// Reset sets the counter to zero and returns the previous value.
func (c *Counter) Reset() int64 {
    return c.n.Swap(0)
}
```

No mutex. `atomic.Int64` handles all synchronisation. Vet would flag any copy of `Counter` because `atomic.Int64` itself has a `noCopy` marker.

This is the kind of code that goes into production at scale. Fast, simple, correct, copy-safe.

---

## Appendix F: A production-ready Cache

A read-mostly cache:

```go
package cache

import (
    "sync"
    "sync/atomic"
)

// Cache is a thread-safe key-value cache optimised for read-heavy workloads.
// Writes are O(n) due to copy-on-write semantics. For write-heavy use cases,
// use a sharded cache.
//
// Cache must not be copied. Use NewCache to construct.
type Cache[K comparable, V any] struct {
    _    noCopy
    data atomic.Pointer[map[K]V]
    wmu  sync.Mutex // protects writers from racing
}

type noCopy struct{}

func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}

func NewCache[K comparable, V any]() *Cache[K, V] {
    c := &Cache[K, V]{}
    empty := make(map[K]V)
    c.data.Store(&empty)
    return c
}

func (c *Cache[K, V]) Get(k K) (V, bool) {
    m := *c.data.Load()
    v, ok := m[k]
    return v, ok
}

func (c *Cache[K, V]) Set(k K, v V) {
    c.wmu.Lock()
    defer c.wmu.Unlock()
    old := *c.data.Load()
    n := make(map[K]V, len(old)+1)
    for kk, vv := range old {
        n[kk] = vv
    }
    n[k] = v
    c.data.Store(&n)
}

func (c *Cache[K, V]) Delete(k K) {
    c.wmu.Lock()
    defer c.wmu.Unlock()
    old := *c.data.Load()
    if _, ok := old[k]; !ok {
        return
    }
    n := make(map[K]V, len(old))
    for kk, vv := range old {
        if kk != k {
            n[kk] = vv
        }
    }
    c.data.Store(&n)
}
```

Reads are lock-free (one atomic load + map read). Writes serialise on `wmu` and rebuild the map. For caches with thousands of entries and infrequent writes, this is excellent.

Note the embedded `noCopy` field (despite the existing `sync.Mutex` providing equivalent protection — the explicit marker makes the no-copy intent unmistakable).

---

## Appendix G: A production-ready sharded counter

For high-throughput counters:

```go
package metrics

import (
    "runtime"
    "sync/atomic"
)

// ShardedCounter is a counter optimised for very high concurrent increments
// by maintaining one counter per shard. Reads sum across all shards.
//
// Use ShardedCounter when a single atomic.Int64 becomes contended
// (typically >1M increments/sec/core).
//
// ShardedCounter must not be copied.
type ShardedCounter struct {
    _      noCopy
    shards []paddedCounter
}

type paddedCounter struct {
    n   atomic.Int64
    pad [56]byte // pad to 64-byte cache line
}

func NewShardedCounter() *ShardedCounter {
    return &ShardedCounter{
        shards: make([]paddedCounter, runtime.NumCPU()),
    }
}

func (s *ShardedCounter) Inc() {
    // Use the goroutine's pseudo-id (we approximate via a fast counter).
    // For production, use procPin and per-P data.
    idx := fastrand() % uint32(len(s.shards))
    s.shards[idx].n.Add(1)
}

func (s *ShardedCounter) Load() int64 {
    var total int64
    for i := range s.shards {
        total += s.shards[i].n.Load()
    }
    return total
}

func fastrand() uint32 {
    // ... pseudo-random; ideally use runtime.fastrand1 via go:linkname
    return uint32(time.Now().UnixNano())
}
```

Each shard is on its own cache line (no false sharing). Increments hit one shard's counter; reads sum all. For million-increment-per-second counters with many cores, this scales linearly.

---

## Appendix H: The architectural trade-off chart

| Pattern | Read cost | Write cost | Memory | Best for |
|---------|-----------|------------|--------|----------|
| `sync.Mutex` + struct | 1 lock | 1 lock | small | balanced workloads, simple state |
| `sync.RWMutex` + struct | 1 RLock | 1 Lock | small | read-dominant workloads |
| `sync.Map` | 1 atomic | 1 lock (sometimes) | small | one-write-many-read |
| Sharded map | 1 RLock on shard | 1 Lock on shard | small | high concurrency, balanced |
| `atomic.Pointer[T]` COW | 1 atomic load | O(n) copy + CAS | up to 2x during update | read-dominant, small data |
| Channel-based actor | 1 send | 1 send | small | serialised access, async OK |
| `atomic.Int64`/`Bool` | 1 atomic | 1 atomic | tiny | counters, flags |

Choose by workload, not by reputation.

---

## Appendix I: Deep dive into mutex profiling output

A mutex profile captured with `go tool pprof -mutex http://service:6060/debug/pprof/mutex` opens an interactive view. The `top` command shows:

```
Showing nodes accounting for 12.45s, 100% of 12.45s total
      flat  flat%   sum%        cum   cum%
     8.32s 66.83% 66.83%      8.32s 66.83%  service/cache.(*Cache).Set
     2.10s 16.87% 83.70%      2.10s 16.87%  service/queue.(*Queue).Push
     1.20s  9.64% 93.34%      1.20s  9.64%  service/registry.(*Registry).Register
     0.83s  6.66%   100%      0.83s  6.66%  service/limiter.(*Limiter).Take
```

Reading this:

- `flat`: time experienced by goroutines waiting for the mutex that *this function* unlocked. Accounting on the unlocker, not the waiter.
- `flat%`: percentage of total mutex wait time.
- `cum`: cumulative time including waits attributed to callees (in mutex profiling this is usually the same as flat).

The 66.83% for `cache.(*Cache).Set` means two-thirds of all goroutine wait time happens when *some* other goroutine tries to Lock the cache mutex while Set holds it.

### Web view

`pprof -web` (requires graphviz) renders a graph. Each node is a function; edges show "this function called Lock on a mutex that this other function later unlocked." For complex services, the graph quickly identifies hot lock paths.

### Flame graph

`go tool pprof -http=:8080 mutex.out` provides an interactive web UI with flame graphs. The horizontal axis is wait time; each block is a function in the call stack.

### Diff profiles

`go tool pprof -base baseline.out new.out` shows the difference between two profiles. Useful for verifying that a refactor reduced contention.

```bash
# Before refactor
curl http://service:6060/debug/pprof/mutex > baseline.out

# Deploy refactor
# ... wait for service to stabilise ...

# After
curl http://service:6060/debug/pprof/mutex > new.out

# Compare
go tool pprof -base baseline.out -http=:8080 new.out
```

The diff shows positive (worse) and negative (better) changes per function.

### Annotated source

`pprof -list <function>` shows the source code with per-line wait-time annotations. For Set:

```
ROUTINE ======================== service/cache.(*Cache).Set in /go/src/.../cache.go
         0     8.32s (flat, cum) 66.83% of Total
         .          .     50:func (c *Cache) Set(k string, v Item) {
         .          .     51:    c.mu.Lock()
         .          .     52:    defer c.mu.Unlock()
         .       8.2s     53:    c.expensiveUpdate(k, v) // most of the contention happens here
         .          .     54:}
```

Line 53 takes 8.2 seconds of wait time. Goroutines pile up while line 53 executes. The fix: move `expensiveUpdate` outside the locked region.

---

## Appendix J: A continuous profiling deployment

Setting up Pyroscope (or any continuous profiler) in production:

### Server setup

Self-host:

```yaml
version: '3'
services:
  pyroscope:
    image: pyroscope/pyroscope:latest
    ports:
      - "4040:4040"
    command: server
    volumes:
      - pyroscope-data:/var/lib/pyroscope
```

Or use Grafana Cloud / Pyroscope Cloud (managed).

### Client integration

In your service:

```go
import "github.com/grafana/pyroscope-go"

func main() {
    pyroscope.Start(pyroscope.Config{
        ApplicationName: "myservice",
        ServerAddress:   "http://pyroscope:4040",
        Tags: map[string]string{
            "env":    "production",
            "region": "us-east-1",
        },
        ProfileTypes: []pyroscope.ProfileType{
            pyroscope.ProfileCPU,
            pyroscope.ProfileAllocObjects,
            pyroscope.ProfileMutexCount,
            pyroscope.ProfileMutexDuration,
            pyroscope.ProfileBlockCount,
            pyroscope.ProfileBlockDuration,
            pyroscope.ProfileGoroutines,
        },
    })

    runtime.SetMutexProfileFraction(100)
    runtime.SetBlockProfileRate(int(time.Millisecond))

    // ... rest of main ...
}
```

Profiles are uploaded every 10 seconds. UI shows flame graphs over time. You can:

- Tag profiles by version, region, host.
- Compare time windows ("last hour vs yesterday").
- Drill into specific endpoints (with HTTP-handler tagging).
- Alert on anomalies.

### Alerting on mutex regressions

Pyroscope (and Parca) expose APIs for queries. A monitoring system can periodically query "mutex profile delta over the last hour" and alert if a specific function's wait time crosses a threshold.

Sample query (Pyroscope):

```
mutex_count.go.lock.duration{app="myservice"}[1h]
```

Threshold: 10% increase from baseline triggers a P3 ticket. 50% increase triggers a page.

---

## Appendix K: A worked profiling exercise

### Setup

A simple cache benchmark with intentional contention:

```go
package main

import (
    "net/http"
    _ "net/http/pprof"
    "runtime"
    "sync"
    "time"
)

type Cache struct {
    mu   sync.Mutex
    data map[string]string
}

var cache = &Cache{data: map[string]string{}}

func (c *Cache) Get(k string) string {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.data[k]
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data[k] = v
    time.Sleep(10 * time.Millisecond) // simulate slow update
}

func main() {
    runtime.SetMutexProfileFraction(1)
    go func() { http.ListenAndServe("localhost:6060", nil) }()

    for i := 0; i < 100; i++ {
        go func(i int) {
            for {
                cache.Get(fmt.Sprintf("key-%d", i%10))
            }
        }(i)
    }
    for i := 0; i < 10; i++ {
        go func(i int) {
            for {
                cache.Set(fmt.Sprintf("key-%d", i), "value")
            }
        }(i)
    }

    select {}
}
```

### Capture

```bash
$ curl -s "http://localhost:6060/debug/pprof/mutex?seconds=30" > mutex.out
```

### Analyze

```bash
$ go tool pprof mutex.out
(pprof) top
Showing nodes accounting for 28.5s, 100% of 28.5s total
      flat  flat%   sum%        cum   cum%
    28.5s   100%   100%     28.5s   100%  main.(*Cache).Set
```

The Set function dominates because it holds the lock for 10ms each call. Readers (Get) pile up behind every Set.

### Diagnose

The 10ms sleep inside the locked region is the bottleneck.

### Fix

Move the slow work outside the lock:

```go
func (c *Cache) Set(k, v string) {
    processed := slowProcess(v) // OUTSIDE lock
    c.mu.Lock()
    c.data[k] = processed
    c.mu.Unlock()
}
```

Re-capture, re-analyse. Wait times drop dramatically. The cache is no longer the bottleneck.

This is the senior-to-professional jump: not just knowing the rules, but using profilers to discover where they're being violated.

---

## Appendix L: Mutex contention in microservices

In a microservices architecture with many services, mutex contention can be hidden behind RPC boundaries. A slow downstream service may look like "network latency" but actually be "mutex contention inside the downstream service."

### Cross-service tracing

OpenTelemetry traces span service boundaries. If an upstream service shows "called serviceB, took 500ms," look at serviceB's traces. If serviceB shows "internal work, took 480ms," and serviceB's mutex profile shows that period as Lock-Unlock contention, you've found the culprit.

### Span attributes for mutex info

In your services, attach mutex-related attributes to spans:

```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
)

func (c *Cache) GetTraced(ctx context.Context, k string) (string, bool) {
    _, span := otel.Tracer("cache").Start(ctx, "Cache.Get")
    defer span.End()

    start := time.Now()
    c.mu.Lock()
    span.SetAttributes(attribute.Int64("lock_acquire_ns", time.Since(start).Nanoseconds()))
    defer c.mu.Unlock()

    v, ok := c.data[k]
    return v, ok
}
```

The trace now includes the lock-acquire time. Slow operations correlate with high lock-wait, making distributed diagnosis tractable.

### Service mesh and locking

If your service mesh (Istio, Linkerd) adds latency, do not confuse mesh overhead with internal locking. Mesh overhead is typically 1-5ms; mutex contention can be many seconds. Profile carefully.

---

## Appendix M: Locking strategies for different topologies

Different system topologies suggest different locking strategies.

### Single-tenant, single-instance

Plain `sync.Mutex` per type. Simple, fast. Most code lives here. Vet enforces no-copy.

### Multi-tenant, single-instance

Per-tenant locks. Tenants don't share state, so each gets its own mutex. Either:

- A map of tenant ID -> *Mutex (or *State).
- A struct per tenant, held in a `map[string]*Tenant`.

### Single-tenant, multi-instance (load-balanced)

Each instance has its own in-process locks. Coordination between instances happens through shared storage (database) with database-level transactions.

Distributed locking only enters if you have a "leader election" requirement (one instance does scheduled work; others don't) or a strict ordering requirement.

### Multi-tenant, multi-instance

Per-tenant work is partitioned across instances (e.g., by tenant ID hash). Each instance owns a set of tenants. Within an instance, per-tenant locks. Cross-tenant coordination is rare.

### Globally consistent state

Some applications truly need globally consistent state across instances (financial trading, certain real-time systems). Use:

- A consensus system (etcd, Spanner) for coordination.
- A relational database with strong ACID for state.
- Avoid distributed locks where possible; use fencing tokens if you must.

The lesson: pick the topology first, then choose the locking strategy. Many "I need a distributed lock" problems are actually "my architecture is wrong."

---

## Appendix N: Avoiding common production pitfalls

### Pitfall 1: Holding a lock across a context boundary

```go
func (s *Service) Handler(ctx context.Context) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.callDownstream(ctx) // BUG: holds lock during RPC
}
```

The RPC might take seconds. Other goroutines block. Move the RPC outside the lock.

### Pitfall 2: Reentrant locking

```go
func (s *Service) DoX() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.DoY()
}

func (s *Service) DoY() {
    s.mu.Lock()
    defer s.mu.Unlock()
    // ...
}
```

`DoX` calls `DoY` which tries to acquire an already-held mutex. Deadlock. Either separate internal and external APIs, or design to avoid the call.

### Pitfall 3: Lock dependent on context that may be cancelled

```go
func (s *Service) Handler(ctx context.Context) error {
    select {
    case s.tokens <- struct{}{}: // semaphore-style
    case <-ctx.Done():
        return ctx.Err()
    }
    defer func() { <-s.tokens }()
    s.mu.Lock()
    defer s.mu.Unlock()
    // ...
}
```

If the semaphore is full and ctx is cancelled, the function returns. The deferred semaphore release does NOT run (the semaphore was never acquired). But the inner mu was never reached. This is fine. But variations of this pattern have subtle bugs.

Always pair acquisitions and releases tightly.

### Pitfall 4: Forgetting that maps are reference types

```go
type Cache struct {
    mu   sync.Mutex
    data map[string]int
}

func (c *Cache) Snapshot() map[string]int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.data // BUG: caller now has the map; no lock
}
```

The caller can modify the returned map without locking. Race detector fires.

Fix: copy the map under the lock.

```go
func (c *Cache) Snapshot() map[string]int {
    c.mu.Lock()
    defer c.mu.Unlock()
    out := make(map[string]int, len(c.data))
    for k, v := range c.data {
        out[k] = v
    }
    return out
}
```

### Pitfall 5: Mutex over external service call

```go
func (s *Service) Process(item Item) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.externalAPI.Call(item)
}
```

External API call is slow. Mutex held for the duration. Pile-up.

Fix: split lock-protected state from API call. Acquire lock briefly to update state, call API outside lock, acquire again to record result.

### Pitfall 6: Reading the lock count to "avoid" locking

```go
// Bad: race condition
if c.lockCount > 0 {
    // try later
} else {
    c.mu.Lock()
    // ...
}
```

Reading without locking does not give you a consistent view. Either use TryLock, or just lock unconditionally.

### Pitfall 7: Atomic operations interleaved with locked ones

```go
func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

func (c *Counter) Get() int64 {
    return atomic.LoadInt64(&c.n) // BUG: race with locked Inc
}
```

The `c.n++` under the lock is not an atomic operation; it's a load-modify-store sequence. An interleaved atomic load may see torn writes or read a value mid-increment.

Either both methods use the lock, or both use atomics. Never mix.

---

## Appendix O: Designing for production observability

The mutex profile is one signal. Combine it with other production telemetry.

### Metrics to expose

- **Lock acquire time histogram**: p50, p95, p99, p99.9 for each named lock.
- **Lock hold time histogram**: per-lock; useful for spotting "lock-then-IO" patterns.
- **Lock count per goroutine**: rare, but for shared-lock paths, can reveal which goroutine is holding things up.
- **Mutex profile data**: shipped to a central pprof viewer.
- **Block profile data**: complementary, for non-mutex blocks.

### Dashboards

A "concurrency" dashboard should include:

- Goroutine count over time. Steady-state baseline; alerts on spikes.
- Mutex profile flame graph (live).
- Block profile flame graph (live).
- Top 10 mutex wait times (per-mutex).
- p99 lock acquire histogram per major lock.

### Alerts

- Goroutine count > N (configurable).
- p99 lock acquire > Xms.
- Top mutex wait time > Y%.

Tune thresholds. False alerts cause alert fatigue and dismissal of real issues.

### Logging mutex anomalies

For critical locks, log when wait time exceeds a threshold:

```go
import "log/slog"

func (c *Cache) Set(k string, v Item) {
    start := time.Now()
    c.mu.Lock()
    if waited := time.Since(start); waited > 100*time.Millisecond {
        slog.Warn("slow mutex acquire", "lock", "cache.main", "waited", waited)
    }
    defer c.mu.Unlock()
    c.data[k] = v
}
```

Sample (e.g., 1 in 100 calls) for hot paths to avoid log spam.

---

## Appendix P: Mutex strategy decision tree

```
Is the data accessed concurrently?
├── No: don't need a mutex.
└── Yes: is the access predominantly reads?
    ├── No: balanced or write-heavy
    │   └── Is contention high?
    │       ├── No: sync.Mutex
    │       └── Yes: sharded sync.Mutex
    ├── Yes: read-heavy
    │   ├── Single value updated rarely
    │   │   └── atomic.Pointer + COW
    │   ├── Map updated rarely
    │   │   └── atomic.Pointer[map] + COW
    │   ├── Map updated occasionally, balanced reads
    │   │   └── sync.RWMutex
    │   └── Map with disjoint writers
    │       └── sync.Map or sharded map
    └── ... (other patterns)
```

Always measure. Run benchmarks for your specific workload. The decision tree is a starting point, not a substitute for profiling.

---

## Appendix Q: The cost of getting it wrong

In production, mutex copy bugs and contention issues can cost:

- **Latency**: p99 spikes during contention. Lost SLA.
- **Throughput**: capacity ceiling lower than expected. Need more servers.
- **Reliability**: deadlocks, panics, fatal errors. Outages.
- **Cost**: paying for CPUs whose work is locked-out.

Mature engineering organisations track these costs. A well-tuned mutex strategy is a competitive advantage.

Estimated cost of a single mutex contention incident: hours of engineering time to diagnose, plus the operational cost during the incident, plus potential revenue loss if customer-facing. A copy bug that goes undetected can produce silent data corruption, with longer-tail costs.

Investing in tooling (vet in CI, continuous profiling, regular reviews) pays for itself many times over.

---

## Final summary

The professional level is where mutex-related concerns become observable, monitored, and refactor-driven. Key practices:

- Run vet on every commit.
- Enable mutex profiling in production.
- Capture continuous profiles.
- Alert on mutex anomalies.
- Refactor based on profile evidence.
- Document locking strategy per type and per package.
- Avoid distributed locking unless required.
- Plan for scale; identify contention cliffs in advance.

The patterns in this document — sharded maps, atomic.Pointer COW, RWMutex, batched updates, off-lock work — are the standard toolkit of high-throughput Go services. Mastery means choosing the right tool for each problem and verifying the choice with measurements.

Proceed to `specification.md` for the normative rules, `interview.md` for review questions, `tasks.md` for hands-on practice, `find-bug.md` for pattern recognition, and `optimize.md` for refactor recipes.

