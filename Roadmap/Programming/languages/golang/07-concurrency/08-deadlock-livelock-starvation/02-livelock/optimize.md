# Livelock — Optimization

Strategies and concrete techniques for eliminating livelock and improving the performance of livelock-prone code. The emphasis is on *measurable* improvement, not theory.

## Table of Contents
1. [Measure First](#measure-first)
2. [Reduce Contention](#reduce-contention)
3. [Replace CAS Loops with Direct Atomics](#replace-cas-loops-with-direct-atomics)
4. [Use sync.Mutex Under High Contention](#use-syncmutex-under-high-contention)
5. [Sharding](#sharding)
6. [Cache-Line Padding](#cache-line-padding)
7. [Single-Flight for Duplicate Work](#single-flight-for-duplicate-work)
8. [Per-Goroutine State](#per-goroutine-state)
9. [Bounded Retries](#bounded-retries)
10. [Jitter Tuning](#jitter-tuning)
11. [Yielding vs Parking](#yielding-vs-parking)
12. [Load Shedding](#load-shedding)
13. [Profiling Recipes](#profiling-recipes)
14. [Optimization Anti-Patterns](#optimization-anti-patterns)

---

## Measure First

Optimization without measurement is hope. Before changing code:

1. **Identify the bottleneck.** Is it CPU, memory, lock contention, allocation? Use `pprof` to confirm.
2. **Establish a baseline.** Record throughput, p50/p99 latency, CPU usage. Without baseline, you cannot tell whether your change helped.
3. **Reproduce the symptom.** A benchmark that exhibits the problem in a tight, repeatable test is worth its weight in deploys.
4. **Form a hypothesis.** "I believe X is the cause; if I change Y, throughput will improve by Z%."

Skip these and you will optimize the wrong thing — guaranteed.

---

## Reduce Contention

The fastest livelock cure is to *eliminate the resource* that goroutines fight over. Some patterns:

### Pattern: replace shared with per-goroutine

If every goroutine writes to a shared counter, give each goroutine its own counter and aggregate on read.

```go
// before:
var total atomic.Int64
go func() { total.Add(1) }()

// after:
type Local struct { n atomic.Int64 }
locals := make([]Local, runtime.GOMAXPROCS(0))
go func(id int) { locals[id].n.Add(1) }(id)

// read:
var sum int64
for _, l := range locals {
    sum += l.n.Load()
}
```

Throughput is bounded only by the cache-line transfer cost between cores, which is far cheaper than CAS retries.

### Pattern: batch updates

Update a local accumulator and flush periodically:

```go
var local int64
for _, item := range items {
    local += process(item)
    if local > batchSize {
        global.Add(local)
        local = 0
    }
}
if local > 0 {
    global.Add(local)
}
```

Trades a small staleness for a dramatic reduction in atomic operations.

### Pattern: replace tight inter-goroutine coordination with channels

A `chan int` of capacity `N` is a parking-aware semaphore. Goroutines block instead of spinning. No livelock.

---

## Replace CAS Loops with Direct Atomics

The CAS-loop livelock pattern:

```go
for {
    old := counter.Load()
    if counter.CompareAndSwap(old, old+1) { break }
}
```

This is `O(N)` work per increment under `N`-goroutine contention. The direct version:

```go
counter.Add(1)
```

This is `O(1)`. Throughput improvement is dramatic — orders of magnitude at high contention.

The catch: this only works for the specific operations that map to a single atomic instruction. The full list in Go's `sync/atomic`:

- `Add` — integer addition.
- `Or`, `And` — bitwise (Go 1.19+).
- `Swap` — exchange.
- `Load`, `Store` — read, write.

If you cannot phrase your update as one of these, you are stuck with CAS or a mutex. Profile to decide which.

---

## Use sync.Mutex Under High Contention

Counterintuitively: under heavy contention, a `sync.Mutex` can outperform a CAS loop. Two reasons:

1. **Mutex parks losers.** Goroutines that fail to acquire the mutex are parked. They consume no CPU. Only the holder runs the critical section.
2. **Mutex has bounded delay.** Starvation mode ensures the head of the queue eventually wins. CAS loops have no such bound — a single goroutine can fail unboundedly.

Heuristic: if your CAS-loop benchmark shows throughput *decreasing* as you add goroutines, switch to `sync.Mutex` and re-benchmark. Often you will see throughput recover.

The break-even depends on the critical section size:

- < 100 ns critical section: CAS wins.
- 100 ns – 1 µs: it depends; profile.
- > 1 µs critical section: mutex wins almost always.

---

## Sharding

For data structures where contention is over *which key is being accessed*, sharding splits the data into `N` independent locks/atomics. Goroutines hashing to different shards do not contend.

### Sharded mutex

```go
type ShardedMap[V any] struct {
    shards [64]struct {
        mu sync.Mutex
        m  map[string]V
        _  [40]byte // pad to cache line (40 = 64 - sizeof(mu) - sizeof(map header))
    }
}

func (s *ShardedMap[V]) shard(key string) *shardOf[V] {
    h := xxhash.Sum64String(key)
    return &s.shards[h%64]
}
```

Choose shard count as a power of 2, at least `4 * GOMAXPROCS`. More shards reduce contention but increase memory.

### Sharded counter

```go
type Counter struct {
    n [64]struct {
        v atomic.Int64
        _ [56]byte
    }
}

func (c *Counter) Inc() {
    c.n[fastRand()%64].v.Add(1)
}
```

`fastRand` is the runtime's fast-path random; under `runtime` package access (not exported) you can use `time.Now().UnixNano()` or any cheap hash.

### Limits of sharding

- Skewed access patterns defeat sharding. If 90% of traffic hits one key, 64 shards do not help.
- Cross-shard operations (e.g., `Range`) become more expensive.
- Memory overhead is `N * sizeof(shard)`.

---

## Cache-Line Padding

Two atomics on the same cache line cause *false sharing*: every write to one invalidates the other's cached line. Under contention this re-creates the bouncing pattern you tried to avoid.

```go
type paddedCounter struct {
    v atomic.Int64
    _ [56]byte // 56 = 64 (cache line) - 8 (int64)
}
```

x86 cache lines are 64 bytes; ARM may be 64 or 128 (use 128 for portability if you target ARM). Padding has cost — 8x memory per counter — but eliminates a major contention source.

Detect false sharing with `perf c2c` on Linux:

```bash
perf c2c record ./your-binary
perf c2c report
```

A high "HITM" (hit modified) count between cores on the same cache line is the signal.

---

## Single-Flight for Duplicate Work

`golang.org/x/sync/singleflight` is the canonical Go optimization for the case where many goroutines do the same expensive thing.

```go
var sf singleflight.Group

func Fetch(key string) (Value, error) {
    v, err, _ := sf.Do(key, func() (any, error) {
        return expensiveBackend(key)
    })
    return v.(Value), err
}
```

If 100 goroutines call `Fetch("same-key")` simultaneously, only one runs `expensiveBackend`. The other 99 wait for its result.

This is also a livelock cure: when the symptom is "all my goroutines retry the same cache fill," singleflight eliminates the duplicated work.

Caveats:

- The shared result must be the right answer for all callers. If goroutines need slightly different results, singleflight is wrong.
- Errors are also shared. One failure fails all 100 callers. Decide whether that is what you want.
- The cache effect is per-key; high cardinality reduces the benefit.

---

## Per-Goroutine State

Some "shared" state is read often, written rarely — or only by one goroutine. In those cases, copy to each goroutine and synchronise occasionally.

### Pattern: per-goroutine rand

The global `math/rand` is goroutine-safe but uses a mutex. Under millions of calls per second, that mutex matters:

```go
// before:
sleep := time.Duration(rand.Int63n(int64(time.Millisecond)))

// after (Go 1.22+):
import "math/rand/v2"
sleep := time.Duration(rand.Int64N(int64(time.Millisecond)))
```

`math/rand/v2` uses per-goroutine state (via thread-local-like mechanism) and avoids the mutex.

For very high frequency: each worker keeps its own `rand.Source`:

```go
type Worker struct {
    src *rand.Rand
}

func NewWorker() *Worker {
    return &Worker{src: rand.New(rand.NewSource(time.Now().UnixNano()))}
}
```

### Pattern: read-mostly config

If goroutines read configuration that rarely changes, store it in an `atomic.Value`:

```go
var config atomic.Value

func GetConfig() *Config { return config.Load().(*Config) }

func SetConfig(c *Config) { config.Store(c) }
```

Reads are lock-free. Writes are infrequent.

---

## Bounded Retries

Every retry path should be bounded. This is not just a livelock cure but a *latency contract*:

```go
const maxAttempts = 5

for attempt := 0; attempt < maxAttempts; attempt++ {
    err := try()
    if err == nil { return nil }
    if !shouldRetry(err) { return err }
    sleep(attempt)
}
return errExhausted
```

Bounded retries mean:

- Worst-case latency is computable: `sum(sleep(0..N-1)) + N * try_cost`.
- Failure modes are visible: `errExhausted` reaches the caller.
- Livelock cannot exceed the bound.

Pick `maxAttempts` based on context. A user-facing request might tolerate 3 attempts (low latency budget). A background job might allow 100 (latency budget irrelevant; eventual completion matters).

---

## Jitter Tuning

Jitter is essential, but the *amount* of jitter affects performance:

- **Too little jitter** preserves the collision pattern.
- **Too much jitter** wastes time waiting.
- **Just right** randomises retries with minimal added latency.

Rule of thumb: jitter should be at least 50% of the base back-off. The standard "full jitter" formula (`sleep = rand(0, base)`) gives 100% jitter and is the most defensible default.

For latency-sensitive paths, prefer "equal jitter" (`sleep = base/2 + rand(0, base/2)`). It guarantees a minimum wait, reducing thrashing.

For distributed services, prefer "decorrelated jitter" (`sleep = rand(base, prev*3)`). It converges fastest under retry-storm workloads.

Measure the impact: instrument retry timestamps and compute the pairwise distance distribution.

---

## Yielding vs Parking

Two ways to "wait" in a goroutine:

- **Yielding** (`runtime.Gosched()` or busy-wait): the goroutine remains runnable, may run again at any moment.
- **Parking** (channel receive, `mu.Lock()`, `time.Sleep`): the goroutine is removed from the run queue until something wakes it.

For livelock prevention, **parking always beats yielding**:

- Parked goroutines consume zero CPU.
- Parked goroutines do not contribute to scheduler pressure.
- Parked goroutines wake in response to specific events, not randomly.

`runtime.Gosched()` exists for very specific use cases (cooperating with non-preemptive scheduler paths). In modern Go (1.14+), the scheduler is asynchronously preemptive; you almost never need to call `Gosched`.

If your "optimization" inserts `Gosched()`, reconsider. The right primitive is usually a channel or a mutex.

---

## Load Shedding

When a service is overloaded, *refuse* work rather than queue it. Queueing in an overloaded service:

- Grows memory.
- Grows latency (work waits behind older work).
- Worsens livelock (more goroutines, more contention).

Load shedding rejects new work fast, giving the service time to recover.

### Simple shedder

```go
type Shedder struct {
    inflight atomic.Int64
    limit    int64
}

func (s *Shedder) Try() bool {
    if s.inflight.Add(1) > s.limit {
        s.inflight.Add(-1)
        return false
    }
    return true
}

func (s *Shedder) Release() {
    s.inflight.Add(-1)
}
```

Use:

```go
if !shedder.Try() {
    http.Error(w, "overloaded", http.StatusTooManyRequests)
    return
}
defer shedder.Release()
handle(w, r)
```

The limit is workload-dependent. Tune from `runtime.NumCPU() * K` where K is between 4 and 50 depending on request type.

### Adaptive shedding

Better: use AIMD or a library like `github.com/platinummonkey/go-concurrency-limits` that adjusts the limit based on observed latency.

---

## Profiling Recipes

### Recipe 1: Find the livelock loop

```
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
(pprof) top10
(pprof) web
```

The top function is the livelock loop. Drill into its callers with `(pprof) list <function>`.

### Recipe 2: Count goroutines in each function

```bash
curl 'http://localhost:6060/debug/pprof/goroutine?debug=1' | \
  grep '^goroutine' | \
  head -1000 | \
  awk '{print $NF}' | sort | uniq -c | sort -rn
```

Goroutines clustered in one function are suspicious. Hundreds in the same retry loop is a livelock signature.

### Recipe 3: Compare with and without contention

Run your benchmark with `b.RunParallel` and `runtime.GOMAXPROCS` set to `1`, `2`, `4`, `8`. If per-goroutine throughput drops sharply as you add cores, you have a contention or livelock problem.

### Recipe 4: Block profile

```go
runtime.SetBlockProfileRate(1)
```

Then capture `/debug/pprof/block`. Shows where goroutines block. Mutexes appearing at the top is a contention sign — not livelock per se, but adjacent.

### Recipe 5: Mutex profile

```go
runtime.SetMutexProfileFraction(1)
```

`/debug/pprof/mutex` shows the most contended mutexes. Useful for tracking down hot spots.

---

## Optimization Anti-Patterns

### Anti-pattern: "Add more retries"

When a retry fails, the urge is to retry more. Wrong direction — this *amplifies* the livelock. The cure is jitter, bounding, or removing the contention.

### Anti-pattern: "Add runtime.Gosched()"

Not an optimization. Not a livelock cure. Just yields the CPU without curing anything.

### Anti-pattern: "Add a sleep without jitter"

A constant sleep does not break collision. It only adds latency.

### Anti-pattern: "Switch to sync.RWMutex"

`RWMutex` allows concurrent reads but has its own livelock and starvation modes. Switching from `Mutex` to `RWMutex` does not cure CAS-loop livelock; it adds complexity.

### Anti-pattern: "Increase channel buffer size"

A larger buffer postpones blocking, not eliminates it. If you have livelock between producers and consumers, a bigger buffer just makes the spike longer. Identify the imbalance and fix it.

### Anti-pattern: "Premature lock-free"

"Lock-free is faster" is a myth. Lock-free is *robust against thread suspension*, which matters in kernel code and real-time systems. In application code, a well-implemented mutex usually wins on throughput and is simpler to reason about. Start with `sync.Mutex`; switch to atomics only after profiling shows mutex contention is the bottleneck.

### Anti-pattern: "Optimize the wrong loop"

A CPU profile shows the hot path. If the hot path is *not* the livelock loop, your "optimization" of the livelock loop does nothing for overall performance. Always profile to confirm before changing.

### Anti-pattern: Disabling preemption

Some teams set `GOMAXPROCS=1` to "avoid contention." This can mask livelock symptoms (no parallel collision possible) at the cost of using only one CPU. It is not an optimization; it is a regression dressed up as a fix.

---

## Summary

Optimization for livelock is a stack of techniques:

1. Measure: pprof, benchmarks, success-rate metrics.
2. Reduce contention: per-goroutine state, sharding, batching.
3. Use the right primitive: `atomic.Add` over CAS loops; `sync.Mutex` over CAS loops at high contention; channels over busy-waits.
4. Bound everything: retry counts, back-off durations, queue sizes.
5. Jitter generously: full jitter is the default; decorrelated jitter for distributed systems.
6. Shed load: refuse work the system cannot handle.
7. Profile after each change: ensure the change moved the needle.

The single most common improvement: replace a CAS loop with `atomic.Add` or `sync.Mutex`. The single most common mistake: adding retries to "fix" a retry-storm livelock.

When in doubt: measure, then optimise.
