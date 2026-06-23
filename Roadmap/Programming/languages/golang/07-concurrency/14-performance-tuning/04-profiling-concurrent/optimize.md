# Profiling Concurrent Go Code — Optimization Recipes

## Table of Contents
1. [Method](#method)
2. [Recipe 1 — Removing Hot Synchronisation](#recipe-1--removing-hot-synchronisation)
3. [Recipe 2 — Sharding a Single Lock](#recipe-2--sharding-a-single-lock)
4. [Recipe 3 — Copy-on-Write Replacement](#recipe-3--copy-on-write-replacement)
5. [Recipe 4 — Reducing Channel Cost](#recipe-4--reducing-channel-cost)
6. [Recipe 5 — Per-CPU Counters](#recipe-5--per-cpu-counters)
7. [Recipe 6 — Batching Across the Lock](#recipe-6--batching-across-the-lock)
8. [Recipe 7 — Trimming Critical Sections](#recipe-7--trimming-critical-sections)
9. [Recipe 8 — Replacing RWMutex with atomic.Pointer](#recipe-8--replacing-rwmutex-with-atomicpointer)
10. [Recipe 9 — Bounded Concurrency](#recipe-9--bounded-concurrency)
11. [Recipe 10 — Fine-Grained Scheduler Wakeups](#recipe-10--fine-grained-scheduler-wakeups)
12. [Recipe 11 — Profile-Guided Inlining for Hot Critical Sections](#recipe-11--profile-guided-inlining-for-hot-critical-sections)
13. [Self-Assessment](#self-assessment)

---

## Method

Every recipe follows the same loop:

1. **Capture.** Take a mutex or block profile before any change.
2. **Identify.** Use `top -cum` with `granularity=lines` to find the hot site.
3. **Apply.** Pick the recipe that matches the shape of the contention.
4. **Verify.** Capture again. Diff with `-base`. Confirm the contention shrank.

The diff is the only honest measurement. "I think this is faster" without a diff is folklore.

---

## Recipe 1 — Removing Hot Synchronisation

**When to use.** Mutex profile shows a function with most of the contention. The work inside the lock is not actually shared state mutation.

**Diagnosis pattern.**

```
(pprof) top
8.2s  main.(*Cache).Get  cache.go:42
```

`list cache.go:42`: the function does a map lookup, a struct copy, and a return. The struct copy is the only thing inside the lock.

**Optimisation.**

```go
// before
func (c *Cache) Get(k string) Item {
    c.mu.Lock()
    defer c.mu.Unlock()
    v := c.data[k]
    return v.Copy() // expensive
}

// after
func (c *Cache) Get(k string) Item {
    c.mu.Lock()
    v := c.data[k]
    c.mu.Unlock()
    return v.Copy() // outside the lock
}
```

The lock only needs to protect the map access. Move everything else out.

**Verify.** Mutex profile diff. The function should drop by an order of magnitude.

---

## Recipe 2 — Sharding a Single Lock

**When to use.** A `sync.Map` is too coarse, but a single mutex is the bottleneck. The keys are distributable.

**Pattern.**

```go
const shardCount = 32

type ShardedMap[K comparable, V any] struct {
    shards [shardCount]struct {
        mu sync.Mutex
        m  map[K]V
    }
}

func (s *ShardedMap[K, V]) shard(k K) *struct {
    mu sync.Mutex
    m  map[K]V
} {
    h := hash(k) & (shardCount - 1)
    return &s.shards[h]
}

func (s *ShardedMap[K, V]) Get(k K) (V, bool) {
    sh := s.shard(k)
    sh.mu.Lock()
    defer sh.mu.Unlock()
    v, ok := sh.m[k]
    return v, ok
}
```

Pick the shard count as the next power of 2 above `GOMAXPROCS * 4`. Hash function depends on key type — for strings, `xxhash` or `maphash` is fine.

**When sharding fails.** If access is highly skewed (one key is 90% of traffic), sharding doesn't help that key. You need either CoW for that hot key or a different data structure.

---

## Recipe 3 — Copy-on-Write Replacement

**When to use.** Reads vastly outnumber writes (1000:1+). An `RWMutex` is being used, but readers still contend with writers.

**Pattern.**

```go
type CowMap[K comparable, V any] struct {
    p atomic.Pointer[map[K]V]
    mu sync.Mutex // serialises writers
}

func (c *CowMap[K, V]) Get(k K) (V, bool) {
    m := *c.p.Load()
    v, ok := m[k]
    return v, ok
}

func (c *CowMap[K, V]) Set(k K, v V) {
    c.mu.Lock()
    defer c.mu.Unlock()
    old := *c.p.Load()
    next := make(map[K]V, len(old)+1)
    for kk, vv := range old {
        next[kk] = vv
    }
    next[k] = v
    c.p.Store(&next)
}
```

Readers do **zero** synchronisation. Writers copy the whole map. Cost is asymmetric — fine when reads dominate.

**When CoW fails.** Many small writes (~each write copies the entire map). The breakpoint is roughly read:write = 100:1; below that, sharded RWMutex wins.

---

## Recipe 4 — Reducing Channel Cost

**When to use.** Block profile shows `runtime.chansend` or `runtime.chanrecv` as the top entry.

**Diagnosis.** Is the channel a bottleneck because:

- **The other side is slow?** Parallelise the slow side.
- **The channel is unbuffered?** Add a buffer.
- **The channel is buffered but full?** Increase the buffer or speed up the consumer.

**Pattern: replace channel with a queue + condition variable for very hot paths.**

```go
// before: pipeline through unbuffered chan
ch := make(chan Item)

// after: ring buffer + cond
type Q struct {
    mu sync.Mutex
    cv *sync.Cond
    buf [1024]Item
    head, tail int
}
```

Channels are designed for correctness and composability, not raw throughput. At very high rates (>1M sends/s), a custom queue can be 2-5x faster.

**When to leave the channel alone.** Anything less than 100k sends/s — the channel is fine; the cost is dominated by other work.

---

## Recipe 5 — Per-CPU Counters

**When to use.** A shared `int64` is being atomically incremented from many goroutines. The atomic itself becomes the bottleneck due to cache line ping-pong.

**Pattern.** One counter per P:

```go
type Counter struct {
    counts []paddedInt64
}

type paddedInt64 struct {
    n int64
    _ [56]byte // pad to 64-byte cache line
}

func NewCounter() *Counter {
    return &Counter{counts: make([]paddedInt64, runtime.GOMAXPROCS(0))}
}

func (c *Counter) Inc() {
    p := procPin()
    atomic.AddInt64(&c.counts[p].n, 1)
    procUnpin()
}

func (c *Counter) Read() int64 {
    var sum int64
    for i := range c.counts {
        sum += atomic.LoadInt64(&c.counts[i].n)
    }
    return sum
}
```

`procPin` / `procUnpin` are runtime-internal but exposed via `//go:linkname` in libraries like `github.com/lukechampine/freeze` or via your own assembly. For most needs, hashing the goroutine ID to a shard is sufficient.

**When this matters.** Counters that fire on every request (request count, error count, byte count). The atomic itself in steady-state on 16 cores can hit 50 ns/op — fine for one counter, painful when you have 50.

---

## Recipe 6 — Batching Across the Lock

**When to use.** Many small operations each acquire the lock once. The fast path is so fast that lock acquisition cost dominates.

**Pattern.** Batch operations on the caller side, take the lock once.

```go
// before
for _, x := range items {
    m.mu.Lock()
    m.data[x.k] = x.v
    m.mu.Unlock()
}

// after
m.mu.Lock()
for _, x := range items {
    m.data[x.k] = x.v
}
m.mu.Unlock()
```

This is the **opposite** of Recipe 7 (trimming). The right answer depends on:

- How many items in the batch.
- How fast the per-item work is.
- Whether holding the lock longer starves other goroutines.

Measure. If batches are small (<10) and operations are tiny (<100 ns), batching wins. Otherwise trim.

---

## Recipe 7 — Trimming Critical Sections

**When to use.** The critical section does work that doesn't need to be inside the lock.

Already covered conceptually in Recipe 1. Here as a recipe with examples of what to trim:

- **String formatting**: `fmt.Sprintf` outside the lock.
- **JSON marshal**: outside the lock; copy the data under lock, marshal after.
- **Network calls**: never inside a lock (almost always a bug).
- **Channel sends to other goroutines**: outside the lock; risks deadlock otherwise.
- **Logging**: outside the lock; use deferred logging.

**Recipe.** Look at every line in a critical section. Ask "does this line need to see consistent shared state?" If no, move it out.

---

## Recipe 8 — Replacing RWMutex with atomic.Pointer

**When to use.** Read-mostly state, infrequent atomic swaps.

```go
type Config struct {
    p atomic.Pointer[ConfigData]
}

func (c *Config) Get() *ConfigData {
    return c.p.Load()
}

func (c *Config) Update(d *ConfigData) {
    c.p.Store(d)
}
```

Readers do an atomic load — single instruction on most architectures. Writers do an atomic store. No contention, ever. Trade-off: there can be brief windows where some goroutines see the old config and others see the new one. For most configuration data this is fine.

**When this fails.** When the update needs to be atomic with respect to other state (e.g., update both a counter and a config together). Use a mutex.

---

## Recipe 9 — Bounded Concurrency

**When to use.** Scheduler latency profile shows runnable-but-not-running time. You have too many goroutines for the available Ps.

**Pattern.** Inbound semaphore.

```go
sem := make(chan struct{}, maxConcurrent)

func handle(r *http.Request) {
    sem <- struct{}{}
    defer func() { <-sem }()

    process(r)
}
```

`maxConcurrent` should be calibrated: usually `GOMAXPROCS * 2` to `GOMAXPROCS * 4`. Above that, goroutines wait but waste no scheduler time on them — they're blocked on `sem`, which is cheap.

**Verify.** Capture trace after the change. Scheduler latency should drop sharply.

---

## Recipe 10 — Fine-Grained Scheduler Wakeups

**When to use.** A coordinator goroutine wakes up every tick, scans, dispatches. The scan is wasted work most of the time.

**Pattern.** Replace tick-poll with a notification channel.

```go
// before
tick := time.NewTicker(10 * time.Millisecond)
for range tick.C {
    if work.Pending() {
        work.Do()
    }
}

// after
for {
    select {
    case <-work.NotifyCh():
        work.Do()
    case <-ctx.Done():
        return
    }
}
```

The producer of work calls `Notify()` instead of just enqueueing. The dispatch latency goes from "up to 10 ms" to "single-digit microseconds" and CPU usage drops on idle.

---

## Recipe 11 — Profile-Guided Inlining for Hot Critical Sections

**When to use.** A small function is called millions of times inside a lock. You can't easily refactor; you can give the compiler better hints.

**Pattern.** Capture a CPU profile during representative load. Commit it as `default.pgo`. Rebuild.

```bash
curl -o default.pgo 'http://prod:6060/debug/pprof/profile?seconds=60'
git add default.pgo
go build ./...
```

PGO will be more aggressive about inlining hot calls, often shaving a few percent off CPU. By cutting CPU inside the critical section, you indirectly reduce contention.

**Caveats.** Don't rely on PGO to fix contention; it's a side effect. The mutex profile is still the right starting point.

---

## Self-Assessment

- [ ] I have applied at least three of these recipes to real code and measured the result.
- [ ] I diff every optimisation with `-base`.
- [ ] I can pick between sharding and CoW based on read:write ratio.
- [ ] I know when a tighter critical section is faster and when a longer one is.
- [ ] I can replace an RWMutex with `atomic.Pointer` when appropriate.
- [ ] I have used scheduler latency in `go tool trace` to drive a fix.
- [ ] I have committed at least one PGO profile.

---

## Summary

Optimisation recipes for concurrent Go fall into a small set of patterns: remove work from inside the lock (Recipes 1, 7), distribute the lock (2, 5), turn shared state into atomic snapshots (3, 8), batch or rearrange to amortise the cost (6, 10), and reduce concurrency where there's too much (9). The mutex and block profiles tell you which pattern applies. Always verify with a diff. Folklore optimisation produces folklore performance.
