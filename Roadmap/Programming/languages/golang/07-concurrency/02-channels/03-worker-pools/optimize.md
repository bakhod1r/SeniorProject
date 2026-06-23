# Worker Pools — Optimization

> Honest framing first: a "worker pool" is already an optimization. Replacing `go fn(x)` for a million `x` with N long-lived workers reading from a channel is the single biggest win you will ever get from worker-pool code. Everything below is second-order: tuning N, reducing allocations, reshaping the queue, replacing the channel with a semaphore, choosing fail-fast over fail-soft, and shaving microseconds off dispatch.
>
> A pool that *correctly* bounds concurrency to NumCPU and shuts down on `close(jobs)` is good enough for 90% of programs. Reach for the optimizations below only when measurement says the pool itself — not the work the pool dispatches — is the bottleneck. Most "slow pool" reports turn out to be slow `process(job)`.
>
> Each entry below states the problem, shows a "before" setup, an "after" setup, the realistic gain, and a caveat that explains when the optimization backfires.

---

## Optimization 1 — Size the pool to the bottleneck, not to the input

**Problem:** A pool of 8 workers for 100,000 HTTP fetches saturates the network at 5% of available concurrency. A pool of 1,024 workers for SHA-256 hashing on a 4-core box thrashes the scheduler. The wrong N is the most common mistake at every level. The right N is decided by the bottleneck, not by the input size.

**Before:**
```go
const numWorkers = 8 // copied from a tutorial
jobs := make(chan Job, 100)
for i := 0; i < numWorkers; i++ {
    go worker(jobs)
}
```

**After:**
```go
import "runtime"

func sizePool(kind string, downstreamCap int) int {
    switch kind {
    case "cpu":
        // Computation-heavy. Past GOMAXPROCS, more workers only add scheduler churn.
        return runtime.GOMAXPROCS(0)
    case "io":
        // Latency-bound. Use Little's Law: N = throughput * latency.
        // If downstream allows 50 concurrent requests, cap there.
        return downstreamCap
    case "mixed":
        // Each job is half compute, half wait. Start at 2x cores and benchmark.
        return 2 * runtime.GOMAXPROCS(0)
    default:
        return runtime.GOMAXPROCS(0)
    }
}
```

For an I/O-bound job with 200 ms average latency targeting 500 req/s, Little's Law says `N = 500 * 0.2 = 100` workers. For a CPU-bound hasher on an 8-core box, `N = 8`. There is no universal default.

**Gain:** CPU-bound work with right-sized N reaches saturation without the 30–50% overhead of a thrashing scheduler. I/O-bound work with right-sized N reaches its downstream cap instead of stopping at 5–10% of it.

**Caveat:** Container CPU quotas can lie. A container with `--cpus=2` running on a 32-core host will see `runtime.NumCPU()` return 32 and oversubscribe by 16x. Use `go.uber.org/automaxprocs` or set `GOMAXPROCS` from the cgroup quota explicitly.

---

## Optimization 2 — Replace the channel queue with work stealing for skewed workloads

**Problem:** A channel-based pool dispatches jobs one at a time to whichever worker happens to read next. If one job takes 100x longer than the others, that worker is stuck for the duration while the rest finish early and idle. With a single shared queue and a long tail of slow jobs, throughput collapses to "as fast as the slowest worker."

**Before (single shared queue):**
```go
jobs := make(chan Job, 1024)
for i := 0; i < N; i++ {
    go func() {
        for j := range jobs {
            process(j) // some jobs take 10 ms, some take 1 s
        }
    }()
}
```

**After (per-worker queue + steal on empty):**
```go
type WSPool struct {
    queues [][]Job
    locks  []sync.Mutex
    n      int
}

func (p *WSPool) Submit(workerHint int, j Job) {
    i := workerHint % p.n
    p.locks[i].Lock()
    p.queues[i] = append(p.queues[i], j)
    p.locks[i].Unlock()
}

func (p *WSPool) take(self int) (Job, bool) {
    // Try own queue first.
    p.locks[self].Lock()
    if len(p.queues[self]) > 0 {
        j := p.queues[self][0]
        p.queues[self] = p.queues[self][1:]
        p.locks[self].Unlock()
        return j, true
    }
    p.locks[self].Unlock()

    // Steal from a random victim.
    victim := (self + 1) % p.n
    for v := 0; v < p.n-1; v++ {
        i := (victim + v) % p.n
        p.locks[i].Lock()
        if n := len(p.queues[i]); n > 0 {
            j := p.queues[i][n-1] // steal from tail
            p.queues[i] = p.queues[i][:n-1]
            p.locks[i].Unlock()
            return j, true
        }
        p.locks[i].Unlock()
    }
    return Job{}, false
}
```

Each worker drains its own queue first, then steals from peers. Skewed workloads rebalance dynamically; idle workers help busy ones instead of idling.

**Gain:** On workloads with a 10:1 latency spread, work-stealing pools finish 30–50% faster than a single-queue pool of the same size. On uniform workloads, the steal path is rarely taken and overhead is near zero.

**Caveat:** Lock contention dominates if jobs are short (sub-microsecond). For tiny jobs, channel-based pools with batching (Optimization 3) win. Work stealing is the right model when individual jobs are heterogeneous and average a millisecond or more.

---

## Optimization 3 — Dispatch in batches, not one job at a time

**Problem:** Each `jobs <- j` send is a synchronisation point: a goroutine wakeup, a scheduler hop, possibly a chan lock. If `process(j)` takes 5 microseconds and the dispatch overhead is 1 microsecond, you spend 20% of CPU on plumbing. For sub-microsecond jobs (parsing one log line, hashing a small key) the channel itself becomes the bottleneck.

**Before:**
```go
for _, line := range millionLines {
    jobs <- Job{Line: line} // one send per line
}
close(jobs)
```

**After:**
```go
type Batch struct{ Lines []string }

const batchSize = 256

batch := make([]string, 0, batchSize)
flush := func() {
    if len(batch) == 0 { return }
    jobs <- Batch{Lines: batch}
    batch = make([]string, 0, batchSize)
}
for _, line := range millionLines {
    batch = append(batch, line)
    if len(batch) == batchSize {
        flush()
    }
}
flush()
close(jobs)

// worker
for b := range jobs {
    for _, line := range b.Lines {
        processLine(line)
    }
}
```

One channel send per 256 lines instead of per 1 line. The worker amortises the dispatch over a batch.

**Gain:** Throughput improvements of 5–20x are routine for jobs in the sub-10-microsecond range. For 1 ms+ jobs the win is negligible — the channel was never the bottleneck.

**Caveat:** Larger batches increase per-job latency (a job at the end of a batch waits for the rest). For interactive workloads with a tail-latency SLO, keep batches small (16–64). For throughput-only batch jobs, 256–4096 is typical. Never batch so large that one batch represents more than ~10 ms of total work.

---

## Optimization 4 — Tune channel buffers for throughput vs memory

**Problem:** A buffer of 0 (unbuffered) means every send is a synchronisation point — workers and producers interlock perfectly but throughput suffers when either side is bursty. A buffer of 1,000,000 absorbs any burst but pins megabytes of memory and delays backpressure until it is too late. The default of "buffer = N (number of workers)" is a fine starting point but rarely the optimum.

**Before:**
```go
jobs := make(chan Job)        // unbuffered; producer blocks on every send
results := make(chan Result)  // unbuffered; workers block on every result
```

**After:**
```go
const N = 16
// Jobs buffer = 2N: smooths bursts without large memory footprint.
// Results buffer = 2N: lets workers stay productive when consumer briefly stalls.
jobs := make(chan Job, 2*N)
results := make(chan Result, 2*N)
```

The reasoning is asymmetric. Jobs buffer absorbs *producer* bursts; results buffer absorbs *consumer* stalls. If the producer is steady but the consumer stalls in 100 ms windows, increase the results buffer. If the producer is bursty but the consumer is steady, increase the jobs buffer.

**Gain:** A buffer of `2 * N` typically gives 95%+ of the throughput of a much larger buffer with 1/10th the memory. For workloads where the producer arrives in 1000-job bursts every 5 seconds, sizing the buffer to absorb one burst (e.g., 1024) eliminates 80% of head-of-line blocking.

**Caveat:** A large buffer hides backpressure. If the producer outruns workers indefinitely, a 1 M buffer will fill, pin 1 M jobs in memory, and *then* finally apply backpressure — at which point you OOM. The buffer is a shock absorber, not a reservoir. Pair with monitoring (`len(jobs)`) and an explicit reject-on-full path for production.

---

## Optimization 5 — Replace the fixed pool with `golang.org/x/sync/semaphore` for elastic concurrency

**Problem:** A fixed pool of N workers is the wrong shape when load is variable. Idle, you pay N goroutine stacks (~2 KiB each minimum, often more) for nothing. Under burst, you cannot exceed N even if briefly going to 2N would be safe. Re-sizing a channel-based pool at runtime is intricate — closing and reopening channels, restarting workers, redistributing in-flight work.

**Before (fixed pool, always 32 workers alive):**
```go
const N = 32
jobs := make(chan Job, N)
for i := 0; i < N; i++ {
    go worker(jobs)
}
```

**After (semaphore — goroutines created only when work arrives):**
```go
import (
    "context"
    "golang.org/x/sync/semaphore"
)

sem := semaphore.NewWeighted(32) // peak parallelism cap

func Submit(ctx context.Context, j Job) error {
    if err := sem.Acquire(ctx, 1); err != nil {
        return err // ctx cancelled while waiting for a slot
    }
    go func() {
        defer sem.Release(1)
        process(ctx, j)
    }()
    return nil
}
```

No long-lived workers. A goroutine exists only while a job is running. When idle, zero goroutines. Under burst, exactly the cap. The semaphore can be resized by swapping it for a `NewWeighted(newCap)` (with a brief overlap during transition).

The weighted form also handles non-uniform jobs:
```go
sem := semaphore.NewWeighted(100)
// big job costs 10 units, small job costs 1 unit
sem.Acquire(ctx, j.Cost)
```

**Gain:** For workloads that idle 80% of the time, baseline memory drops by `N * goroutine_stack` (often 5–50 MiB). Acquire/release via `x/sync/semaphore` is comparable in overhead to a buffered channel send/receive (typically 50–100 ns).

**Caveat:** A goroutine per job means the cost of `go func()` (a few hundred nanoseconds) is paid on every job. For sub-microsecond jobs at high QPS, the long-lived pool is faster. For jobs with millisecond-or-more latency, the semaphore form has no measurable overhead and is more flexible.

---

## Optimization 6 — Reuse buffers per worker with `sync.Pool`

**Problem:** Workers that allocate per-job (a JSON decode buffer, a scratch `[]byte`, a hashing state) generate garbage proportional to throughput. At 100k jobs/sec with a 4 KiB per-job allocation, you produce 400 MiB/sec of garbage and force the GC into permanent overdrive. The CPU spent in `runtime.mallocgc` and the GC sweep dwarfs the actual work.

**Before:**
```go
func worker(jobs <-chan Job, results chan<- Result) {
    for j := range jobs {
        buf := make([]byte, 4096)              // fresh allocation per job
        h := sha256.New()                       // fresh hasher per job
        n, _ := io.ReadFull(j.Source, buf)
        h.Write(buf[:n])
        results <- Result{Hash: h.Sum(nil)}
    }
}
```

**After:**
```go
var (
    bufPool = sync.Pool{
        New: func() any { b := make([]byte, 4096); return &b },
    }
    hashPool = sync.Pool{
        New: func() any { return sha256.New() },
    }
)

func worker(jobs <-chan Job, results chan<- Result) {
    for j := range jobs {
        bufPtr := bufPool.Get().(*[]byte)
        h := hashPool.Get().(hash.Hash)
        h.Reset()

        buf := *bufPtr
        n, _ := io.ReadFull(j.Source, buf)
        h.Write(buf[:n])
        results <- Result{Hash: h.Sum(nil)}

        bufPool.Put(bufPtr)
        hashPool.Put(h)
    }
}
```

`sync.Pool` is per-P (per logical processor), so contention is minimal. Each worker effectively reuses a thread-local buffer, with the GC reclaiming pool entries between cycles when memory is under pressure.

**Gain:** GC pause time drops dramatically — often 10x — when allocation pressure is the bottleneck. Steady-state CPU spent in GC drops from 20–40% to under 5% on allocation-heavy pipelines.

**Caveat:** `sync.Pool` is a *cache*, not an *arena*. Entries can be reclaimed at any time during GC. Never store data in the pool that you cannot regenerate. Always `Reset()` reused stateful objects (hashers, decoders, buffers) — a stale hasher carrying state from the previous job is the classic bug.

---

## Optimization 7 — Drop the results channel for fire-and-forget side-effect work

**Problem:** Half of all worker pools have a `results` channel that nobody actually reads — workers write a log line, increment a counter, or POST a webhook, and the result is `error` or `struct{}`. The closer goroutine, the result struct, the consumer's `for r := range results` loop are dead weight. Worse, a slow or absent consumer creates head-of-line blocking on the workers.

**Before:**
```go
type Result struct{ Err error }

results := make(chan Result, N)
for i := 0; i < N; i++ {
    go func() {
        defer wg.Done()
        for j := range jobs {
            results <- Result{Err: send(j)} // who reads this?
        }
    }()
}

go func() { wg.Wait(); close(results) }()
for r := range results {
    if r.Err != nil { log.Println(r.Err) }
}
```

**After:**
```go
for i := 0; i < N; i++ {
    go func() {
        defer wg.Done()
        for j := range jobs {
            if err := send(j); err != nil {
                log.Printf("send failed: %v", err) // handle in place
                metrics.Errors.Inc()
            }
        }
    }()
}
// no results channel, no closer goroutine, no consumer loop
close(jobs)
wg.Wait()
```

Errors and metrics are handled where they happen. The pool's only job is concurrency; observability lives outside the dispatch path.

**Gain:** Removes one channel allocation, one closer goroutine, and one consumer goroutine. More importantly, eliminates a class of deadlocks: workers can no longer stall because nobody is draining `results`. Throughput is unchanged or slightly higher; complexity drops noticeably.

**Caveat:** This applies only when results are truly side-effects. If the caller needs to *collect* outputs (the body of an HTTP response, a slice of parsed records), keep the results channel. The optimization is "stop emitting what nobody reads," not "stop emitting."

---

## Optimization 8 — Fail fast with `errgroup` instead of polling errors

**Problem:** A pool processing 10,000 jobs encounters a fatal error on job #50 — say, the database is down. Naive code keeps processing the remaining 9,950 jobs, each one failing the same way, before reporting "10,000 errors" to the caller. CPU, network, and downstream load are all wasted.

**Before:**
```go
type Result struct{ Err error }
errs := []error{}
var mu sync.Mutex
for r := range results {
    if r.Err != nil {
        mu.Lock(); errs = append(errs, r.Err); mu.Unlock()
        // workers keep going; no signal to stop
    }
}
return errors.Join(errs...)
```

**After:**
```go
import "golang.org/x/sync/errgroup"

func RunFailFast(ctx context.Context, jobs []Job) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(16) // bound concurrency without a manual semaphore
    for _, j := range jobs {
        j := j
        g.Go(func() error {
            return process(ctx, j) // first non-nil err cancels ctx
        })
    }
    return g.Wait()
}
```

`errgroup.WithContext` returns a context that is cancelled the moment any goroutine returns a non-nil error. Every other in-flight `process(ctx, j)` sees `ctx.Done()` and aborts. `g.SetLimit(16)` bounds peak concurrency without a separate semaphore — `g.Go` blocks until a slot is free.

**Gain:** A fatal error stops new dispatch within microseconds and aborts in-flight work as fast as `process` can respect cancellation. On a "database down" scenario across 10k jobs, total wasted work drops from "all 10k" to "the ~16 currently running."

**Caveat:** `errgroup` is fail-fast by design. If you *want* to keep going after errors (logging each, retrying others), do not use it — collect errors manually or use a third-party library like `multierr`. Also: `errgroup` returns only the *first* error; later errors are dropped. Wrap or log them inside the goroutine if you need them.

---

## Optimization 9 — Pin cgo-heavy workers to OS threads

**Problem:** A worker that calls into cgo (a native crypto library, an OpenCV binding, a database driver with a non-Go core) leaves the Go scheduler unable to preempt it. Worse, cgo calls expect a stable OS thread — TLS-based libraries (some HSM clients, OpenGL contexts) break catastrophically when goroutines migrate between threads. The default Go runtime moves goroutines around freely.

**Before:**
```go
for i := 0; i < N; i++ {
    go func() {
        for j := range jobs {
            cgoExpensiveCall(j) // may run on different OS threads each iteration
        }
    }()
}
```

**After:**
```go
import "runtime"

for i := 0; i < N; i++ {
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread() // optional; see caveat
        for j := range jobs {
            cgoExpensiveCall(j) // always on the same OS thread for this worker
        }
    }()
}
```

Each worker is now bound to a dedicated OS thread for its lifetime. Thread-local state in the cgo library is stable. The Go scheduler stops migrating these goroutines.

**Gain:** Correctness for libraries that require thread affinity (this is not a "speedup" but a "doesn't crash"). For purely performance-sensitive cgo work, eliminates ~50–500 ns per call from cross-thread scheduler overhead and improves cache locality.

**Caveat:** A locked OS thread is *removed* from the Go scheduler's pool. If you lock all 8 of your OS threads, the rest of the program shares whatever's left. Lock conservatively — only the workers that genuinely need it. Also: `defer runtime.UnlockOSThread()` is sometimes harmful — if the goroutine exits with a thread in a dirty state, you want the thread to die with it; pure Go workers should not touch this API at all.

---

## Optimization 10 — Avoid `time.After` inside a worker for-select loop

**Problem:** `time.After(d)` looks innocent inside a worker's select, but it allocates a timer that lives until `d` elapses *even if the select takes a different branch*. In a hot loop, you create a timer on every iteration, and the runtime accumulates them. Memory grows linearly with iterations, and the timer heap becomes a hot lock.

**Before:**
```go
for {
    select {
    case j := <-jobs:
        process(j)
    case <-ctx.Done():
        return
    case <-time.After(5 * time.Second): // leaks until 5s elapses, every iteration
        log.Println("idle")
    }
}
```

If jobs arrive every millisecond, you create 1,000 timers per second, each pinned for 5 seconds. After 5 seconds, ~5,000 dead timers wait to be garbage collected (and to fire their — now ignored — channel sends).

**After:**
```go
idle := time.NewTimer(5 * time.Second)
defer idle.Stop()

for {
    if !idle.Stop() {
        select { case <-idle.C: default: }
    }
    idle.Reset(5 * time.Second)

    select {
    case j := <-jobs:
        process(j)
    case <-ctx.Done():
        return
    case <-idle.C:
        log.Println("idle")
    }
}
```

A single timer, reset on each iteration. Drain the channel before reset to avoid a stale fire. Memory is constant.

In Go 1.23+ `time.NewTimer` no longer requires the drain dance — `Reset` is safe to call without checking the channel. Older Go versions do require the drain.

**Gain:** Eliminates a slow memory leak that grows with iteration rate. For a worker servicing 10k jobs/sec with a 5-second timeout, the pre-fix leak is roughly 50,000 live timers; the post-fix is 1.

**Caveat:** Only matters when the idle/timeout branch is in the *hot path* — that is, the select runs frequently. A timeout select that runs once per minute is fine with `time.After`. Profile (`go tool pprof -alloc_objects`) before refactoring.

---

## Optimization 11 — Spawn workers lazily for variable load

**Problem:** A pool of 32 workers started at boot pays for 32 idle goroutines whenever load is below 32 jobs/sec. For services with heavily bursty load (e.g., webhooks, batch triggers, nightly jobs), this is N goroutine stacks doing nothing for hours.

**Before (eager):**
```go
const N = 32
for i := 0; i < N; i++ {
    go worker(jobs) // alive forever, mostly idle
}
```

**After (lazy spawn up to a cap):**
```go
type LazyPool struct {
    jobs    chan Job
    sem     chan struct{}
}

func NewLazy(cap int, queue int) *LazyPool {
    return &LazyPool{
        jobs: make(chan Job, queue),
        sem:  make(chan struct{}, cap),
    }
}

func (p *LazyPool) Submit(j Job) {
    select {
    case p.jobs <- j:
        // queue had space; an existing worker may pick it up
    default:
        // queue full; try to spawn a fresh worker if under cap
        select {
        case p.sem <- struct{}{}:
            go p.work()
            p.jobs <- j
        case p.jobs <- j: // wait for queue to drain
        }
    }
}

func (p *LazyPool) work() {
    defer func() { <-p.sem }()
    idle := time.NewTimer(30 * time.Second)
    defer idle.Stop()
    for {
        idle.Reset(30 * time.Second)
        select {
        case j := <-p.jobs:
            process(j)
        case <-idle.C:
            return // worker self-terminates after idle timeout
        }
    }
}
```

Workers are spawned on demand and self-terminate after 30 seconds of idleness. Peak parallelism is still capped at `cap`.

**Gain:** Idle services drop from `cap * stack` of pinned memory to roughly zero. Burst-handling capacity is unchanged. Startup is also faster — no need to spin up workers before the first request.

**Caveat:** Cold-start latency for the first job in a burst includes one `go func()` plus channel setup (a few microseconds). For latency-critical paths, eager spawn (with warmup, see below) is better. Lazy spawn fits batch and webhook workloads, not low-latency request paths.

---

## Optimization 12 — Warm up workers before live traffic

**Problem:** A freshly spawned goroutine has no allocated stack beyond the minimum, no thread cache for `sync.Pool`, no connection in any pool, and no JIT-warm code paths in cgo. The first request handled by a newly minted worker is measurably slower than the 1000th. For latency-critical services this shows up as a long p99 tail right after deployment or scale-up.

**Before:**
```go
for i := 0; i < N; i++ {
    go worker(jobs)
}
listener.Start() // first requests hit cold workers
```

**After:**
```go
for i := 0; i < N; i++ {
    go worker(jobs)
}

// Warmup: dispatch synthetic jobs that exercise the same code paths.
warmupJobs := generateWarmupJobs(N * 4)
for _, j := range warmupJobs {
    jobs <- j
}
// Drain warmup results so workers are returned to the pool
for range warmupJobs {
    <-warmupSink
}

listener.Start() // workers have warm stacks, warm sync.Pools, warm DB conns
```

Synthetic jobs should exercise the same allocations, the same connections, and the same code paths as production traffic.

**Gain:** P99 latency for the first 5–30 seconds after startup typically drops 2–5x. For services with strict SLOs and frequent deployments, this turns "slow rollout" into "fast rollout."

**Caveat:** Warmup cost is real — startup is delayed by however long warmup takes. For services that restart often (every minute due to a flaky orchestrator), warmup may actually *worsen* aggregate latency. For services that run for hours between restarts, it almost always pays back.

---

## Optimization 13 — Per-worker queues vs shared queue (M:N tradeoff)

**Problem:** A single shared `jobs` channel forces every dispatch through one channel's mutex. At very high job rates (millions/sec), this lock becomes the bottleneck — workers spend more time waiting for the channel than doing work. The fix is to give each worker its own queue, but now the dispatcher must choose where to enqueue, and load-balancing fairness becomes a problem.

**Before (one shared channel; dispatcher writes, workers compete to read):**
```go
jobs := make(chan Job, 1024)
for i := 0; i < N; i++ {
    go func() {
        for j := range jobs { process(j) }
    }()
}
```

**After (per-worker channels, hashed dispatch):**
```go
type Pool struct {
    queues []chan Job
    n      int
}

func (p *Pool) Submit(j Job) {
    // Hash to a worker so related jobs go to the same one (cache-friendly).
    h := j.Hash() % uint32(p.n)
    p.queues[h] <- j
}

func NewPool(n, qsize int) *Pool {
    p := &Pool{n: n, queues: make([]chan Job, n)}
    for i := 0; i < n; i++ {
        p.queues[i] = make(chan Job, qsize)
        go func(q <-chan Job) {
            for j := range q { process(j) }
        }(p.queues[i])
    }
    return p
}
```

Each worker has its own channel; dispatch maps each job to a specific worker. No shared lock. A consistent hash on `j.Hash()` keeps related jobs (same user, same key) on the same worker, improving cache and per-worker state reuse.

**Gain:** At >1 M jobs/sec the shared channel's mutex is the bottleneck; per-worker queues remove it and scale linearly with N. Cache locality improves for state-bearing jobs (e.g., per-key aggregation).

**Caveat:** Per-worker queues lose work-stealing's automatic load balancing. If the hash is skewed (10% of users generate 90% of traffic), one queue overflows while others idle. Mitigations: combine with work stealing (Optimization 2), use a more uniform hash, or fall back to a shared channel for unhashed jobs. Below ~100k jobs/sec the shared channel is faster (one cache line, simpler) and you should not bother.

---

## Optimization 14 — Choose the right shutdown mechanism

**Problem:** `close(jobs); wg.Wait()` and `cancel(ctx); wg.Wait()` look interchangeable but have different semantics. Closing `jobs` lets workers drain in-flight work before exiting. Cancelling the context aborts in-flight work as fast as possible. Mixing them, or picking the wrong one, leads to either dropped work or hung shutdowns.

**Before (always close, even on error):**
```go
defer close(jobs) // workers drain even when we want to abort immediately
defer wg.Wait()
```

**After (pick by intent):**
```go
// A. Drain shutdown — finish queued work, then exit.
//    Use for batch jobs and clean process exit.
close(jobs)
wg.Wait()

// B. Abort shutdown — discard queued work, abort in-flight ASAP.
//    Use for user-cancelled requests and fatal errors.
cancel()
wg.Wait()

// C. Drain with deadline — drain if it's quick, otherwise abort.
//    Use for HTTP server shutdown.
close(jobs)
done := make(chan struct{})
go func() { wg.Wait(); close(done) }()
select {
case <-done:
    // drained cleanly
case <-time.After(30 * time.Second):
    cancel()  // workers see ctx.Done() and exit
    wg.Wait() // now they will
}
```

Three flavours, three implementations. Document which one your pool uses; do not let callers guess.

**Gain:** Drain shutdown preserves work that's already queued (no lost jobs after `Submit` returned). Abort shutdown returns control to the caller within milliseconds instead of "until the queue empties." Drain-with-deadline is the only sane HTTP server shutdown.

**Caveat:** Abort shutdown only works if `process(ctx, j)` actually respects `ctx.Done()`. A CPU-bound function that ignores the context will run to completion regardless of `cancel()`. Add explicit `if ctx.Err() != nil { return }` checks inside long loops.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For worker-pool work, the signals that matter:

```go
// Benchmark a pool end-to-end
func BenchmarkPool(b *testing.B) {
    pool := NewPool(runtime.GOMAXPROCS(0), 1024)
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            pool.Submit(Job{N: 42})
        }
    })
    pool.Drain()
}

// Measure goroutine count before/after to catch leaks
func TestNoLeaks(t *testing.T) {
    before := runtime.NumGoroutine()
    pool := RunPool(makeInputs(1000))
    pool.Wait()
    runtime.GC()
    time.Sleep(100 * time.Millisecond)
    after := runtime.NumGoroutine()
    if after > before+1 {
        t.Fatalf("leaked %d goroutines", after-before)
    }
}
```

Useful command-line tools:

```bash
# CPU profile to see whether you're CPU-bound (and where).
go test -bench=. -cpuprofile=cpu.prof
go tool pprof -top cpu.prof

# Allocation profile to find hot per-job allocations.
go test -bench=. -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof

# Race detector should be green for any pool you run in production.
go test -race ./...

# Goroutine count over time (pprof live)
import _ "net/http/pprof"
# then: go tool pprof http://localhost:6060/debug/pprof/goroutine

# Measure channel queue depth in production
expvar.Publish("pool.queue", expvar.Func(func() any { return len(jobs) }))
```

If a "fix" does not move these numbers measurably, it was not a fix.

---

## When NOT to Optimize

- **The pool runs once per request and finishes in 50 ms.** The default channel-based pool with N = `GOMAXPROCS` is already fine. None of the above optimizations will be measurable. Spend the engineering time elsewhere.
- **You have not run `go test -race` and `pprof`.** Optimizing a pool that has a race or a goroutine leak is putting a spoiler on a car with no brakes. Fix correctness first.
- **The bottleneck is `process(j)`, not the pool.** If 99% of CPU is inside the user's per-job logic, no amount of dispatch tuning matters. Profile, find the hot function, optimize that.
- **Throughput is below 10k jobs/sec.** Channel overhead is irrelevant at these rates. Batching, per-worker queues, and lock-free dispatch are solutions to problems you do not have.
- **You are tempted to write your own work-stealing scheduler.** The Go runtime already implements one (the goroutine scheduler). For most workloads, `errgroup.WithContext` + `SetLimit` is faster than anything you will write by hand and has been battle-tested in every Go program in production.
- **Your pool exists in a script that runs nightly.** Correctness, observability, and a clean shutdown matter. The 5% throughput improvement from per-worker queues does not.

---

## Summary

A correct worker pool is already 80% of the optimization. The remaining 20% comes from making the pool fit its workload: size N to the bottleneck, batch sub-microsecond jobs, replace fixed pools with semaphores when load is variable, recycle per-job buffers with `sync.Pool`, drop unused result channels, fail fast with `errgroup`, pin OS threads only when cgo demands it, avoid `time.After` in hot select loops, warm up before live traffic, choose drain vs cancel shutdown deliberately, and reach for per-worker queues only at million-jobs-per-second scale.

You learned: how to pick N for CPU-bound and I/O-bound work; when to prefer work stealing over channel dispatch; how to amortise channel cost via batching; how to tune buffers for throughput vs memory; how to swap fixed pools for elastic semaphores; how to cut allocation pressure with `sync.Pool`; how to remove dead-weight result channels; how to fail fast with `errgroup`; when to lock OS threads; why `time.After` leaks in hot loops; how to spawn lazily and warm up eagerly; the M:N tradeoffs of per-worker queues; and how to pick the right shutdown semantics.

Optimize the pool when measurement says the pool is the bottleneck. Otherwise, optimize the work the pool dispatches — or do not optimize at all.
