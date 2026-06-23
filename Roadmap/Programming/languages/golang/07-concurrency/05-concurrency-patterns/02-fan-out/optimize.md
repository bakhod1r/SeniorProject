# Fan-Out — Optimization

> Honest framing first: fan-out is already an optimization. It exists because sequential code wastes parallelism. The optimizations on this page are *second-order* — given that you have a fan-out, how do you make the fan-out itself cheaper, more responsive, less wasteful, and friendlier to the rest of the system.
>
> Each entry follows the same structure: **Problem / Before / After / Gain / Caveat**. Code is runnable. The "Gain" column is realistic; sometimes it's "small but consistent," and that is the truth of optimization at this layer — every percent counts when it ships in a hot loop.

---

## Optimization 1 — Tune worker count via measurement, not guesswork

**Problem.** A team picks `n = 100` because "it sounds parallel." On their 8-core box it's 12× oversubscribed; the scheduler context-switches incessantly; throughput is *worse* than `n = 16`.

**Before:**
```go
const N = 100 // some hand-picked number
out := Process(ctx, in, N, work)
```

**After:** Parameterize `N`, run a bench harness, pick the knee:
```go
func BenchmarkFanOut(b *testing.B) {
    for _, n := range []int{1, 2, 4, 8, 16, 32, 64} {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            in := make(chan int)
            go func() { defer close(in); for i := 0; i < b.N; i++ { in <- i } }()
            out := Process(context.Background(), in, n, work)
            for range out {}
        })
    }
}
```
Use `benchstat` over 10 runs. Pick the smallest `N` that plateaus the throughput curve — going higher only adds memory and scheduler cost.

**Gain.** For CPU-bound work, often 1.5×–3× over a hand-picked oversubscribed value. For IO-bound work, the gain is in *not under-provisioning* — usually 5×–20× over `n = NumCPU`.

**Caveat.** The optimal `N` is workload-specific. Re-measure when the workload shape changes (job size, downstream latency, hardware).

---

## Optimization 2 — Batch dispatch to reduce per-job overhead

**Problem.** When jobs are tiny (e.g. integers, 64-byte payloads), per-job channel send/receive dominates the actual work. Each `in <- v` and `r := <-in` is a scheduler hop.

**Before:**
```go
type Job int
in := make(chan Job)
go func() { defer close(in); for i := 0; i < N; i++ { in <- Job(i) } }()
```

**After:** Dispatch *batches* of jobs:
```go
type Batch []int
in := make(chan Batch)
go func() {
    defer close(in)
    const B = 256
    buf := make(Batch, 0, B)
    for i := 0; i < N; i++ {
        buf = append(buf, i)
        if len(buf) == B {
            in <- buf
            buf = make(Batch, 0, B)
        }
    }
    if len(buf) > 0 { in <- buf }
}()

// worker:
for batch := range in {
    for _, v := range batch { process(v) }
}
```

**Gain.** For very small jobs, 5×–20× throughput. The amortization: one channel hop per 256 jobs instead of 256 hops.

**Caveat.** Batching adds latency — a job sits in the buffer until the batch fills. If you also have a flush ticker (`time.Ticker` to flush partial batches every K ms), you cap latency at the cost of a bit more code. Don't batch if jobs are individually expensive (>100 µs each); the channel hop is already noise.

---

## Optimization 3 — `sync.Pool` for per-job scratch buffers

**Problem.** Each worker allocates a fresh buffer per job. With 16 workers × 10,000 jobs/s, that's 160K allocs/s — GC starts to bite. Profiling shows `runtime.mallocgc` in the top frames.

**Before:**
```go
for j := range in {
    buf := make([]byte, 4096) // fresh allocation per job
    process(j, buf)
}
```

**After:** Reuse buffers via `sync.Pool`:
```go
var bufPool = sync.Pool{
    New: func() any { return make([]byte, 4096) },
}

for j := range in {
    buf := bufPool.Get().([]byte)
    process(j, buf)
    bufPool.Put(buf[:0]) // reset length, keep capacity
}
```

**Gain.** GC cycles drop sharply (often 5×–10× fewer). Allocation rate drops; p99 latency tightens because GC pauses no longer interrupt mid-job.

**Caveat.** `sync.Pool` is *not* a guarantee — items can be evicted at any GC. Don't use it for stateful data that must persist; it's a *scratch-buffer* pool. Always reset (e.g. `buf[:0]`) before `Put` so callers don't see stale bytes from the previous job.

---

## Optimization 4 — Work stealing for skewed workloads

**Problem.** Plain fan-out with one shared input channel is fine when jobs are similar in size. When 10% of jobs take 100× longer than the rest, throughput drops because the shared channel doesn't proactively rebalance — workers stuck on slow jobs hold up *their share* of in-flight work.

**Before:**
```go
in := make(chan Job) // shared
for i := 0; i < n; i++ {
    go func() { for j := range in { work(j) } }()
}
```

**After:** Per-worker queues + steal:
```go
locals := make([]chan Job, n)
for i := range locals { locals[i] = make(chan Job, 64) }

dispatcher := func(jobs []Job) {
    for i, j := range jobs { locals[i%n] <- j }
    for i := range locals { close(locals[i]) }
}

worker := func(self int) {
    for {
        select {
        case j, ok := <-locals[self]:
            if !ok { goto steal }
            work(j)
        default:
            goto steal
        }
        continue
    steal:
        for off := 1; off < n; off++ {
            peer := (self + off) % n
            select {
            case j, ok := <-locals[peer]:
                if ok { work(j); break }
            default:
            }
        }
        // exit if no peer had work
        return
    }
}
```

**Gain.** On skewed workloads (10% slow jobs), 1.5×–4× throughput vs plain shared-channel fan-out. The slow worker no longer holds its assigned-but-unstarted queue hostage.

**Caveat.** Implementation is significantly more complex. Termination conditions are subtle — when *all* queues are empty, workers must agree to exit. For uniform workloads, plain fan-out is plenty and far easier to maintain.

---

## Optimization 5 — Queue per worker to reduce shared-channel contention

**Problem.** At very high N (>32) and very high job rate (>1 M/s), the single shared input channel becomes a contention point. Every worker is repeatedly trying to receive; the runtime scheduler takes the channel's mutex. Profile shows non-trivial time in `runtime.chanrecv` and `runtime.lock2`.

**Before:**
```go
in := make(chan Job, 1024) // shared by all workers
```

**After:** Sharded inputs — dispatcher picks the worker:
```go
ins := make([]chan Job, n)
for i := range ins { ins[i] = make(chan Job, 64) }

go func() { // dispatcher
    defer func() { for i := range ins { close(ins[i]) } }()
    next := 0
    for j := range source {
        ins[next] <- j
        next = (next + 1) % n
    }
}()

for i := range ins {
    i := i
    go func() {
        for j := range ins[i] { work(j) }
    }()
}
```

**Gain.** At extreme job rates, 20%–50% throughput improvement. The contention point moves from one shared channel to the dispatcher, which is single-threaded and cache-friendly.

**Caveat.** You lose dynamic load balancing — a slow worker's queue grows while others are idle. Combine with work stealing (Optimization 4) for the best of both. For typical fan-outs (N≤16, job rate ≤100K/s), the shared channel is not the bottleneck and this complication is unjustified.

---

## Optimization 6 — Eliminate the result channel with an atomic counter

**Problem.** Sometimes you fan-out only to compute a sum, count, or other reduction. Routing every result through a channel is wasteful — the channel is just a serializer.

**Before:**
```go
out := make(chan int)
for i := 0; i < n; i++ {
    go func() {
        defer wg.Done()
        for v := range in { out <- f(v) }
    }()
}
go func() { wg.Wait(); close(out) }()

total := 0
for v := range out { total += v }
```

**After:** Use `atomic.Int64`:
```go
var total atomic.Int64
for i := 0; i < n; i++ {
    go func() {
        defer wg.Done()
        for v := range in { total.Add(int64(f(v))) }
    }()
}
wg.Wait()
fmt.Println(total.Load())
```

**Gain.** No result channel at all — workers don't block on output. For small reductions (sum, count, min/max), 2×–5× speedup at high job rates.

**Caveat.** Only works when the reduction is *associative and commutative*, since results arrive out of order. Sum, count, max, bitwise OR — yes. List append, ordered concat — no.

For more complex reductions, give each worker a private accumulator and merge after `wg.Wait`:

```go
partials := make([]int, n)
for i := 0; i < n; i++ {
    i := i
    go func() {
        defer wg.Done()
        for v := range in { partials[i] += f(v) }
    }()
}
wg.Wait()
total := 0
for _, p := range partials { total += p }
```

No atomics, no contention, and the merge is cheap. This is the gold-standard form for batch reductions.

---

## Optimization 7 — Coalesce small jobs into larger units

**Problem.** Workers do tiny per-job work (e.g. update one row in a DB). Each job is one network round-trip. Connection RTT dominates wall-clock.

**Before:**
```go
for j := range in {
    db.Exec("UPDATE t SET x = ? WHERE id = ?", j.X, j.ID)
}
```

**After:** Coalesce N jobs into one statement:
```go
for j := range in {
    batch = append(batch, j)
    if len(batch) >= 100 {
        flush(db, batch)
        batch = batch[:0]
    }
}
if len(batch) > 0 { flush(db, batch) }

func flush(db *sql.DB, b []Job) {
    // build one multi-row UPDATE / INSERT, single round-trip
}
```

Or use prepared statements + transactions to amortize overhead.

**Gain.** For DB / API jobs, often 10×–100× throughput. Network RTT is replaced by serialization cost, which is much smaller.

**Caveat.** Latency per individual job rises (it has to wait for the batch to fill). If freshness matters, add a flush ticker (`time.Ticker`) to bound staleness. Also: a failed batch may require retry of all 100 jobs, not one.

---

## Optimization 8 — Prefetch the input to overlap producer and worker time

**Problem.** Producer and workers run *sequentially* through one queue: producer fills, workers drain. If the producer reads from disk and workers compute, the disk reader and the CPUs alternate idleness — never both busy.

**Before:**
```go
in := make(chan Job) // unbuffered
go producer(in) // reads disk, sends one job
// workers process one job
```

**After:** Buffer the input enough that the producer can run ahead:
```go
in := make(chan Job, 1024) // generous buffer
```

Or even: spawn multiple producer goroutines reading different files / partitions in parallel, all writing to the same `in`.

**Gain.** With overlap, wall-clock approaches `max(producer time, worker time)` instead of `producer time + worker time`. Often a 1.5×–2× improvement on disk-bound pipelines.

**Caveat.** Buffer size is a memory/latency trade-off. Buffering 1 M jobs in RAM may be unacceptable; 1 K is usually fine. Don't conflate "fast producer" with "good system": a producer that consistently fills a 1 K buffer means workers are the bottleneck — don't keep growing the buffer; add workers or fix the bottleneck.

---

## Optimization 9 — Pin hot worker pools to specific CPUs (NUMA / affinity)

**Problem.** On NUMA systems (most modern servers), a goroutine running on socket 0 reading memory allocated on socket 1 incurs cross-socket latency for every cache line. For data-intensive fan-out (large arrays, multi-GB working set), this can cost 30%+ throughput.

**Before:**
```go
runtime.GOMAXPROCS(0) // default — all CPUs, all sockets
```

The Go runtime is NUMA-unaware; it cheerfully migrates goroutines across sockets.

**After (Linux):** Pin the *process* to one socket via `taskset` or `numactl`:
```bash
numactl --cpunodebind=0 --membind=0 ./mybinary
```

Or split the workload: one fan-out per socket, each pool pinned via separate processes:
```bash
numactl --cpunodebind=0 --membind=0 ./mybinary --shard=0 &
numactl --cpunodebind=1 --membind=1 ./mybinary --shard=1 &
```

For finer control, use `cgroups` v2 to constrain CPUs per fan-out pool.

**Gain.** On NUMA-sensitive workloads, 20%–50% throughput. On non-NUMA (single-socket laptops, small VMs) the gain is zero — don't bother.

**Caveat.** Go does not expose CPU pinning natively; you have to manage it via the OS. Pinning loses elasticity — you can't temporarily borrow idle cores from the other socket. Best for steady, high-throughput batch jobs; counter-productive for bursty or interactive workloads. Always profile first; many pipelines are not NUMA-bound.

---

## Optimization 10 — Replace channel with semaphore for known-bounded workloads

**Problem.** A handler needs to fan out M parallel calls (e.g. M backend services per request, M ≤ 16). Spinning up a channel + N workers + closer goroutine for a 16-element static set is overkill.

**Before:**
```go
func ScatterGather(ctx context.Context, backends []Backend) ([]Resp, error) {
    in := make(chan Backend)
    out := make(chan Resp)
    var wg sync.WaitGroup
    go func() { defer close(in); for _, b := range backends { in <- b } }()

    wg.Add(8)
    for i := 0; i < 8; i++ {
        go func() {
            defer wg.Done()
            for b := range in {
                out <- b.Call(ctx)
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()

    var results []Resp
    for r := range out { results = append(results, r) }
    return results, nil
}
```

**After:** Goroutine per call + semaphore + indexed result slice (or `errgroup`):
```go
func ScatterGather(ctx context.Context, backends []Backend) ([]Resp, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(8) // semaphore
    results := make([]Resp, len(backends))
    for i, b := range backends {
        i, b := i, b
        g.Go(func() error {
            r, err := b.Call(ctx)
            if err != nil { return err }
            results[i] = r
            return nil
        })
    }
    return results, g.Wait()
}
```

**Gain.** No channels, no closer goroutine, no merge. Code is half the size and faster — `errgroup.SetLimit` is a tiny semaphore around `g.Go`. For small, known-bounded job sets, this is the cleanest form.

**Caveat.** Spawns one goroutine per job, so it's a poor fit for *streams* with millions of items — there you want bounded N workers. The rule of thumb: if the job set fits in a slice you'd happily allocate, the semaphore form wins; if jobs flow through a channel from upstream, stick with the worker form.

---

## Optimization 11 — Right-size the input channel buffer

**Problem.** Default `make(chan Job)` is unbuffered. Producer blocks on every send until a worker is ready. At low scale this is fine; at high scale, the constant rendezvous adds scheduler hops.

**Before:**
```go
in := make(chan Job) // unbuffered
```

**After:** Buffer to the worker count — enough to absorb small jitter without letting the producer run far ahead:
```go
in := make(chan Job, n) // or 2*n
```

**Gain.** 5%–15% throughput improvement at high job rates; smoother latency under bursty input.

**Caveat.** A *huge* buffer (e.g. `make(chan Job, 1<<20)`) is an anti-pattern — it hides backpressure and can OOM under sustained overload. Buffer for jitter, not for hoarding. The measurable rule: pick the smallest buffer at which `len(in) > 0` is the steady-state observation; if `len(in)` rapidly hits the cap, your workers are the bottleneck, not the channel.

---

## Optimization 12 — Avoid `select` in the worker hot loop when ctx is cheap

**Problem.** Every iteration of the canonical worker has two `select`s — one on receive, one on send. At very high job rates, the `select` cost is non-trivial; profile shows `runtime.selectgo` near the top.

**Before:**
```go
for {
    select {
    case <-ctx.Done(): return
    case v, ok := <-in:
        if !ok { return }
        select {
        case <-ctx.Done(): return
        case out <- f(v):
        }
    }
}
```

**After:** Check ctx once per *batch* of K iterations, not every single one:
```go
const batchCheck = 64
for {
    for k := 0; k < batchCheck; k++ {
        v, ok := <-in
        if !ok { return }
        out <- f(v)
    }
    if ctx.Err() != nil { return } // cheap atomic load
}
```

**Gain.** 5%–10% throughput at very high job rates; eliminates `selectgo` from the hot path.

**Caveat.** Cancellation latency rises — workers respond after up to `batchCheck × per-job time`. For 64 × 10 µs = 640 µs, this is fine. For seconds-long jobs, this is too long; keep the per-iteration `select`. *Never* drop the `select` on the `out <- f(v)` send — without it, workers leak when the consumer disappears.

This optimization is only worth it after profiling proves the `select` is hot. For 99% of fan-outs, the canonical two-select form is correct and fast enough; do not micro-optimize prematurely.

---

End of optimizations. The order roughly reflects how often you'll actually need them: tuning N, batching, and `sync.Pool` are everyday wins; NUMA pinning and select-skipping are exotic. Profile first; *then* pick the optimization that targets the bottleneck you actually have. Every change should come with a benchmark before-and-after — without that, you are guessing.
