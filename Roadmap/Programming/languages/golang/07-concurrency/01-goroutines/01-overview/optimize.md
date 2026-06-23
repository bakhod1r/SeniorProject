# Goroutines — Optimization

> A goroutine itself is one of the cheapest concurrency primitives in any mainstream language. There is little to "optimize" in the literal `go f()` call — the cost is already a few hundred nanoseconds. What is worth optimizing is the *system* of goroutines: how many you spawn, how they coordinate, how they wait, what they share, and how the runtime schedules them.
>
> Each entry below states the problem, shows a "before" snippet, an "after" snippet, and the realistic gain. Numbers are illustrative — measure in your own code.

---

## Optimization 1 — Replace per-item goroutine spawning with a worker pool

**Problem.** Spawning one goroutine per item in a tight loop is faster than serial execution, but at high item counts the scheduler cost and per-goroutine memory dominate.

**Before:**
```go
for _, item := range millions {
    go process(item) // 1M goroutines simultaneously
}
```
Memory: ~2 GB stacks + closure heap. Scheduler is overwhelmed; latency variance high.

**After:**
```go
const workers = runtime.NumCPU()
jobs := make(chan Item, workers*4)
var wg sync.WaitGroup
for i := 0; i < workers; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for it := range jobs { process(it) }
    }()
}
for _, it := range millions { jobs <- it }
close(jobs)
wg.Wait()
```

**Gain.** Constant memory (~workers × 2KB), predictable latency, throughput typically 2–10× higher because cache locality is better and the scheduler is not thrashing.

---

## Optimization 2 — Match pool size to the bottleneck, not to CPU count

**Problem.** A pool of `runtime.NumCPU()` workers is the default heuristic. It is right for CPU-bound work and wrong for I/O-bound work or downstream-bound work.

**Before:**
```go
pool := newPool(runtime.NumCPU()) // 8 workers on an 8-core machine
// Each worker calls a downstream API with p99 latency 200ms
// Throughput: 8 / 0.2 = 40 req/s, regardless of CPU power
```

**After (I/O-bound):**
```go
pool := newPool(200) // bound by acceptable in-flight, not CPU
// Each worker is parked most of the time, waiting on the network.
// Throughput: 200 / 0.2 = 1000 req/s
```

**Gain.** 25× throughput on I/O-bound workloads. The cost is 200 × 2KB = 400 KB stacks — negligible.

The reverse fix applies to CPU-bound work that uses too many goroutines:

**Before:**
```go
pool := newPool(1000) // each worker hashes 1MB of data
// 1000 goroutines fighting for 8 cores → context-switch storm
```

**After:**
```go
pool := newPool(runtime.GOMAXPROCS(0))
```

**Gain.** Same throughput, dramatically lower scheduler overhead and cache thrashing.

---

## Optimization 3 — Eliminate busy-wait loops

**Problem.** A `for { select { default: } }` or `for { time.Sleep(time.Microsecond) }` pegs a CPU core for nothing.

**Before:**
```go
for {
    select {
    case v := <-ch:
        handle(v)
    default:
        // spin, hoping for a value
    }
}
```
This pegs one core at 100% even when `ch` is empty.

**After:**
```go
for v := range ch {
    handle(v)
}
```

**Gain.** From 100% CPU to ~0% CPU when idle. Latency on `ch` send-to-receive is unchanged (the runtime parks the goroutine and wakes it on send).

If you genuinely need polling (e.g., to check multiple non-channel sources), use a `time.Ticker`, not a tight `default` branch:

```go
ticker := time.NewTicker(10 * time.Millisecond)
defer ticker.Stop()
for {
    select {
    case <-ticker.C:
        if poll() { return }
    case <-ctx.Done():
        return
    }
}
```

---

## Optimization 4 — Set `GOMAXPROCS` correctly in containers

**Problem.** Pre-Go-1.16 (or non-Linux containers), `runtime.NumCPU()` returns the host's core count, not the container's CPU quota. A pod with `cpu: "500m"` on a 64-core node spawns 64 Ps but only gets 0.5 CPU. The result is severe scheduler latency, GC mark assist failures, and CPU throttling by the kernel.

**Before:**
```go
// no explicit GOMAXPROCS; runtime sees 64
```

**After (option A — modern Go on Linux):**
Upgrade to Go 1.16+. The runtime reads cgroup quota automatically.

**After (option B — older Go or non-Linux):**
```go
import _ "go.uber.org/automaxprocs"
```
Imported for side effects; sets `GOMAXPROCS` from cgroup limits at startup.

**Gain.** Eliminates throttle-induced latency spikes. p99 latency drops by 5–10× on misconfigured deployments.

---

## Optimization 5 — Reduce goroutine churn with `sync.Pool`-backed buffers

**Problem.** A goroutine that allocates large buffers per iteration creates GC pressure that degrades the entire program.

**Before:**
```go
go func() {
    for j := range jobs {
        buf := make([]byte, 64*1024) // 64KB allocated per job
        process(j, buf)
    }
}()
```
At 10 000 jobs/sec, that is 640 MB/s allocated. GC runs constantly.

**After:**
```go
var bufPool = sync.Pool{
    New: func() any { b := make([]byte, 64*1024); return &b },
}

go func() {
    for j := range jobs {
        bp := bufPool.Get().(*[]byte)
        process(j, *bp)
        bufPool.Put(bp)
    }
}()
```

**Gain.** Allocation rate drops 100×. GC frequency drops; tail latency improves dramatically. Caveats: do not pool buffers that escape the goroutine, and be aware that `sync.Pool` may discard items at any GC.

---

## Optimization 6 — Use `errgroup.SetLimit` instead of a manual semaphore

**Problem.** A manual semaphore + `WaitGroup` + `chan error` is verbose, error-prone, and slow.

**Before:**
```go
sem := make(chan struct{}, 8)
errCh := make(chan error, len(items))
var wg sync.WaitGroup
for _, it := range items {
    it := it
    wg.Add(1)
    sem <- struct{}{}
    go func() {
        defer wg.Done()
        defer func() { <-sem }()
        if err := process(it); err != nil {
            select { case errCh <- err: default: }
        }
    }()
}
wg.Wait()
close(errCh)
err := <-errCh
```

**After (Go 1.20+):**
```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(8)
for _, it := range items {
    it := it
    g.Go(func() error { return process(ctx, it) })
}
err := g.Wait()
```

**Gain.** Half the lines, fewer bugs, identical throughput, and the first error cancels the rest automatically.

---

## Optimization 7 — Avoid `sync.Map` when `map + Mutex` is faster

**Problem.** `sync.Map` is optimized for "write-once, read-many" or "disjoint key sets per goroutine." For ordinary read/write workloads, it is slower than `sync.RWMutex` + `map`.

**Before (read-heavy mixed key set):**
```go
var m sync.Map
m.Store(k, v)
val, _ := m.Load(k)
```

**After:**
```go
type Map struct {
    mu sync.RWMutex
    m  map[string]Value
}
func (m *Map) Set(k string, v Value) {
    m.mu.Lock(); defer m.mu.Unlock()
    m.m[k] = v
}
func (m *Map) Get(k string) (Value, bool) {
    m.mu.RLock(); defer m.mu.RUnlock()
    v, ok := m.m[k]
    return v, ok
}
```

**Gain.** Often 1.5–3× faster on uniform read/write workloads. `sync.Map` is faster only when usage matches its narrow design — read the package doc carefully before reaching for it.

---

## Optimization 8 — Replace `Mutex` with `atomic.Pointer[T]` for read-mostly data

**Problem.** Configuration loaded once at startup and refreshed occasionally is a perfect copy-on-write candidate. A `Mutex` serialises readers needlessly.

**Before:**
```go
var (
    cfgMu sync.RWMutex
    cfg   Config
)
func GetConfig() Config {
    cfgMu.RLock()
    defer cfgMu.RUnlock()
    return cfg
}
```
Every reader takes and releases an RLock — fast in absolute terms but contended at high QPS.

**After:**
```go
var cfg atomic.Pointer[Config]
func GetConfig() *Config { return cfg.Load() }
func SetConfig(c *Config) { cfg.Store(c) }
```

**Gain.** Reads are ~5–10 ns and lock-free. Used by Cloudflare, Uber, Google for hot-reloadable config.

Caveat: callers must treat the returned `*Config` as immutable. If any reader mutates the pointed-to struct, the pattern collapses.

---

## Optimization 9 — Replace channel-as-mutex with an actual mutex

**Problem.** Some Go code uses a buffered channel of capacity 1 as a primitive lock. This works but is much slower than `sync.Mutex`.

**Before:**
```go
lock := make(chan struct{}, 1)
lock <- struct{}{}                 // acquire
defer func() { <-lock }()          // release
```
Each acquire/release is ~50–200 ns and involves the scheduler.

**After:**
```go
var mu sync.Mutex
mu.Lock()
defer mu.Unlock()
```
~10–30 ns per acquire/release.

**Gain.** 5–10× faster for plain mutual exclusion. Use channels for *messaging* and *flow control*, not as a clever mutex replacement.

---

## Optimization 10 — Reduce contention with sharded locks

**Problem.** A single mutex protecting a hot map serialises every operation. At high QPS, the mutex becomes the bottleneck regardless of CPU count.

**Before:**
```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]Value
}
```
With 1M ops/sec, the mutex is the bottleneck.

**After (sharded):**
```go
const shards = 64

type Cache struct {
    shards [shards]struct {
        mu sync.RWMutex
        m  map[string]Value
    }
}

func (c *Cache) shardFor(k string) *struct{...} {
    h := fnv32(k)
    return &c.shards[h % shards]
}

func (c *Cache) Get(k string) (Value, bool) {
    s := c.shardFor(k)
    s.mu.RLock(); defer s.mu.RUnlock()
    v, ok := s.m[k]
    return v, ok
}
```

**Gain.** Contention drops by ~`shards` for uniformly distributed keys. Throughput on read-heavy workloads scales with cores again.

This is exactly what `sync.Map` does internally — but explicitly, so you control the shard count and key distribution.

---

## Optimization 11 — Avoid spawning a goroutine for trivial work

**Problem.** Spawning a goroutine to do a microsecond of work is much slower than doing it inline. The break-even point is roughly "~10× the goroutine creation cost," i.e., a few microseconds of work.

**Before:**
```go
for _, x := range items { go func(x int) { sum += x*x }(x) }
```
Goroutine creation cost dominates the actual work; result is also racy.

**After:**
```go
for _, x := range items { sum += x*x }
```

**Gain.** Faster (no scheduler overhead) and correct (no race). Reach for goroutines when work per iteration is at least a few microseconds and there is something to overlap with.

---

## Optimization 12 — Use `runtime/trace` to find the actual bottleneck

**Problem.** Engineers often "optimize" goroutine code by guessing — "let's add more workers, let's set GOMAXPROCS=200." Without measurement, you usually move the bottleneck rather than fix it.

**Before.** Iterating on production performance tuning by intuition.

**After.**
```go
f, _ := os.Create("trace.out")
defer f.Close()
trace.Start(f)
defer trace.Stop()
runWorkload()
```
Then `go tool trace trace.out` opens a browser visualisation showing every goroutine, every blocking event, every preemption.

**Gain.** You move from guessing to measuring. Common findings:

- "More workers" did nothing because the bottleneck is downstream, not local CPU.
- A mutex held during I/O is serialising the whole pool.
- GC pauses dominate; reduce allocations.
- Network poller is fine; sysmon is not the issue; the database is.

The trace tool is the highest-leverage diagnostic the Go runtime ships.

---

## Optimization 13 — Pre-allocate slices to avoid concurrent append

**Problem.** Multiple goroutines appending to a shared slice race on length and capacity. The fix is often a mutex; the *better* fix is to give each goroutine its own slot.

**Before:**
```go
var results []int
var mu sync.Mutex
for i := 0; i < n; i++ {
    i := i
    go func() {
        v := compute(i)
        mu.Lock()
        results = append(results, v)
        mu.Unlock()
    }()
}
```

**After:**
```go
results := make([]int, n)
var wg sync.WaitGroup
for i := 0; i < n; i++ {
    i := i
    wg.Add(1)
    go func() {
        defer wg.Done()
        results[i] = compute(i)
    }()
}
wg.Wait()
```

**Gain.** No mutex, no contention, and the slice's length is fixed up front. Throughput scales linearly with goroutines (until CPU is saturated).

---

## Optimization 14 — Free idle goroutines in a long-lived pool

**Problem.** A pool of 1000 workers sized for peak load is overkill at 3 AM, when load is 1% of peak. Those workers sit parked but still consume stack memory.

**Before:** Static-size pool of 1000.

**After:** Adaptive pool — scale up on load, scale down on idle.

```go
type AdaptivePool struct {
    min, max int
    workers  atomic.Int64
    jobs     chan Job
    idle     atomic.Int64
}

func (p *AdaptivePool) Submit(j Job) {
    select {
    case p.jobs <- j:
    default:
        if int(p.workers.Load()) < p.max {
            p.spawnWorker()
            p.jobs <- j
        }
    }
}

func (p *AdaptivePool) worker() {
    for {
        select {
        case j := <-p.jobs:
            p.idle.Add(-1)
            j.Run()
            p.idle.Add(1)
        case <-time.After(30 * time.Second):
            if int(p.workers.Load()) > p.min {
                p.workers.Add(-1)
                return
            }
        }
    }
}
```

**Gain.** Memory tracks load. At peak, workers spawn on demand. At idle, surplus workers retire after 30 seconds.

Caveat: spawning a worker on a hot path adds latency; tune `min` to cover the steady-state.

---

## Optimization 15 — Avoid GOMAXPROCS thrash from misconfigured cgo

**Problem.** Each cgo call blocks an M for its duration. If the workload makes many concurrent cgo calls, the runtime creates more Ms to keep `GOMAXPROCS` Ps running. Each new M costs an OS thread (~1 MB stack); excess Ms degrade kernel scheduling.

**Before.** A program calling a cgo-heavy library (e.g., `sqlite3`) from 1000 concurrent goroutines spawns ~1000 OS threads.

**After.** Bound concurrent cgo calls with a semaphore matching the kernel's effective parallelism:

```go
var cgoSem = semaphore.NewWeighted(int64(runtime.GOMAXPROCS(0) * 2))

func cgoCall(ctx context.Context, ...) error {
    if err := cgoSem.Acquire(ctx, 1); err != nil { return err }
    defer cgoSem.Release(1)
    return doCgo(...)
}
```

**Gain.** OS thread count stays bounded. Memory drops by orders of magnitude. Latency variance decreases because the kernel scheduler is no longer overwhelmed.

---

## Optimization 16 — Use unbuffered channels for synchronisation, buffered for throughput

**Problem.** Channel buffer choice is often arbitrary. The wrong choice causes either lost throughput or unintended synchronisation.

**Rules:**
- **Capacity 0 (unbuffered):** synchronisation. Sender and receiver must rendezvous. Use for "I want this transfer to be the synchronisation point."
- **Capacity 1:** "send result and exit" guarantee. The send always completes; the goroutine always exits.
- **Capacity > 1 (buffered):** throughput. Decouples sender pace from receiver pace. The size should match the burstiness you expect.

**Before:**
```go
results := make(chan int) // unbuffered; senders block when receiver is slow
```
Workers stall on results channel; effective concurrency drops.

**After:**
```go
results := make(chan int, runtime.NumCPU()*4) // buffer matches expected burst
```

**Gain.** Workers do not stall on results. Receiver drains in batches. Throughput often 2–5× higher under uneven loads.

Beware: too-large buffers hide downstream slowness and let memory grow. Size for *expected burst*, not for *worst case*.

---

## Optimization 17 — Use `time.AfterFunc` over a goroutine for one-shot timers

**Problem.** A common idiom is `go func() { time.Sleep(...); doThing() }()`. This costs 2 KB of stack and a goroutine struct for a one-time event.

**Before:**
```go
go func() {
    time.Sleep(5 * time.Second)
    doThing()
}()
```

**After:**
```go
time.AfterFunc(5*time.Second, doThing)
```

`AfterFunc` schedules `doThing` on the runtime's timer wheel; no goroutine is created until the timer fires (and even then it is short-lived).

**Gain.** Memory savings scale with the number of pending timers. A program with 100 000 pending timers saves ~200 MB of stack.

Caveat: `doThing` runs in a goroutine spawned by the runtime, so it must be safe for concurrent execution. Same considerations as any goroutine.

---

## Final note

Most goroutine "optimization" is really *coordination optimization*: matching pool sizes to bottlenecks, reducing contention with sharding, picking the right primitive (`atomic`, mutex, channel), and observing real workloads with `runtime/trace` and `pprof`. The literal cost of `go f()` is not the limit — your design is.

Profile before you optimize. Measure before and after. Many of these changes can hurt as easily as they help on the wrong workload — `sync.Map` is the classic example of a "fast" primitive that is often slow for the case in front of you. The runtime is good; your job is to give it the right shape of work.
