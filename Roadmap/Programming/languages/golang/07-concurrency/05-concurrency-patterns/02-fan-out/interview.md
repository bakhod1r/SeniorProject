# Fan-Out — Interview Questions

> Practice questions ranging from junior to staff level. Each has a model answer, common wrong answers, and follow-up probes. The goal is to surface the *why* behind each pattern, not just the syntax.

---

## Junior

### Q1. What is the fan-out pattern in Go?

**Model answer.** Fan-out distributes values from a single input channel across N concurrent worker goroutines. Each worker runs `for v := range in { ... }` on the same channel, so each value goes to exactly one worker — whichever one happens to be ready first. The runtime handles distribution; the developer just spawns the workers.

```go
for i := 0; i < n; i++ {
    go func() {
        defer wg.Done()
        for v := range in {
            process(v)
        }
    }()
}
```

It is the dual of fan-in. Fan-in merges N inputs into one channel; fan-out splits one channel across N readers.

**Common wrong answers.**
- "Each worker gets a copy of every value." (No — channels are not broadcast; each value is consumed by exactly one receiver.)
- "Fan-out preserves input order." (No — faster workers finish earlier; output is reordered.)

**Follow-up.** *Why does the runtime, not your code, decide which worker receives the value?* — Because Go's channel is a single FIFO queue with one delivery per send; whichever goroutine is parked in receive when the value arrives is the one that gets it.

---

### Q2. How does fan-out differ from fan-in?

**Model answer.** They are inverse operations on channels:

| Fan-out | Fan-in |
|---------|--------|
| 1 input channel, N consumers | N input channels, 1 output channel |
| Distributes work | Merges results |
| Parallelism source | Aggregation point |

In a typical pipeline you use both: a producer feeds one channel, fan-out splits work across workers, and fan-in (often implicit — workers all writing into one shared `out`) merges the results.

**Follow-up.** *Where is the fan-in inside a fan-out helper?* — Inside `func process(in, n)`, every worker writes to the shared `out`. That shared write *is* the fan-in. The shape `1 → N → 1` is sometimes called "fan-out, fan-in" and is the foundation of every parallel batch pipeline in Go.

---

### Q3. Who closes the input channel and who closes the output channel?

**Model answer.** Two distinct responsibilities, by convention:

- **Producer** closes the input. After the last `in <- v`, the producer calls `close(in)`. This signals "no more work."
- **Closer goroutine** (inside the fan-out helper) closes the output. It waits on the `WaitGroup` until every worker has exited, then calls `close(out)`. This signals "no more results."

```go
go func() {
    wg.Wait()
    close(out)
}()
```

Never close the output from inside a worker — a second worker writing to a closed channel panics.

**Common wrong answer.** "Each worker closes the output when it's done." (Causes panics.)

**Follow-up.** *What if the producer forgets to close `in`?* — Workers' `range` never exits; they block forever on receive; the closer never fires; consumer's `range out` hangs. Goroutine leak.

---

### Q4. Why use `sync.WaitGroup` in fan-out?

**Model answer.** To know *when every worker has finished* so the output channel can be closed exactly once. The pattern:

```go
wg.Add(n)             // before spawning
for i := 0; i < n; i++ {
    go func() {
        defer wg.Done()
        for v := range in { /* ... */ }
    }()
}
go func() { wg.Wait(); close(out) }()
```

Without `WaitGroup`, you have no signal that "the last worker just exited." Without that signal, you cannot close `out` safely (close-too-early panics; close-never leaks the consumer).

**Follow-up.** *Why is `wg.Add(n)` outside the goroutine?* — `wg.Add` after `wg.Wait` is a race; the wait may complete before Add registers. Always Add before launching.

---

### Q5. What happens if N (worker count) is zero?

**Model answer.** No workers spawn. The producer's first `in <- v` blocks forever because nobody is receiving. The program deadlocks or, if no other goroutines are runnable, panics with `fatal error: all goroutines are asleep`.

Defensive code rejects `n <= 0`:

```go
if n <= 0 {
    panic("fan-out: n must be > 0")
}
```

**Follow-up.** *What if N is larger than the number of jobs?* — Harmless. Some workers receive zero values and exit immediately when `in` closes.

---

## Middle

### Q6. How is fan-out different from a worker pool?

**Model answer.** They overlap heavily. The labels emphasize different things:

| Aspect | Fan-out | Worker pool |
|--------|---------|-------------|
| Lifecycle | Created and torn down per call | Long-lived; started at init |
| Focus | Distribution semantics | Resource management |
| Shutdown | Close the input | Pool.Close() / Pool.Stop() |
| API surface | `func(in chan, n) chan` | `pool.Submit(job)` |
| Identity | Workers are anonymous | Workers may be addressable |

Fan-out is a snapshot of a pool's distribution behavior. Most worker pools are implemented internally with the fan-out pattern.

**Follow-up.** *When do I prefer a worker pool over ad-hoc fan-out?* — When the same workers process many batches over the program's lifetime: keeping warm goroutines avoids spawn cost, and pool-wide limits constrain process-wide concurrency. Ad-hoc fan-out is right for one-shot, request-scoped parallelism.

---

### Q7. How do you choose N for IO-bound vs CPU-bound work?

**Model answer.** They follow different scaling laws:

- **CPU-bound** (hashing, encoding, parsing): `N ≈ runtime.NumCPU()`. Each worker keeps a core busy; more workers just thrash the scheduler. Adding workers above `GOMAXPROCS` is counter-productive.
- **IO-bound** (HTTP, DB, file): `N ≈ K × NumCPU`, where K is between 8 and 100. Most workers are blocked on the network most of the time, so many can multiplex onto few cores.
- **Mixed**: Profile. Start at `2 × NumCPU` and watch throughput.

The right answer is always *measure*. The figures above are starting points, not endpoints.

**Follow-up.** *Why does CPU-bound fan-out plateau at NumCPU but IO-bound keeps scaling?* — Because IO-bound workers spend most of their wall-clock parked in `gopark`, not consuming a P. The runtime can have tens of thousands of parked goroutines on eight cores.

---

### Q8. How do you cancel a fan-out cleanly?

**Model answer.** Use `context.Context` and the *two-select sandwich* inside each worker:

```go
for {
    select {
    case <-ctx.Done():
        return
    case v, ok := <-in:
        if !ok { return }
        r := work(ctx, v)
        select {
        case <-ctx.Done():
            return
        case out <- r:
        }
    }
}
```

Two `select`s per iteration:
- One around the **receive** so workers exit immediately on cancel without waiting for the next job.
- One around the **send** so workers exit when the consumer is gone (otherwise they block on `out <- r` forever).

Always pair `cancel()` with a drain on the result channel; otherwise workers blocked in send are leaked.

**Follow-up.** *Why isn't closing `in` enough?* — Closing input drains gracefully; cancel aborts mid-flight. For "first error wins, abort the rest", closing is too slow.

---

### Q9. How does `errgroup` help with fan-out errors?

**Model answer.** `golang.org/x/sync/errgroup` packages three things:
1. A `WaitGroup` substitute that tracks goroutines.
2. A derived `context.Context` cancelled on the first non-nil error.
3. `Wait()` returns that first error.

```go
g, ctx := errgroup.WithContext(parent)
for i := 0; i < n; i++ {
    g.Go(func() error {
        for v := range in {
            if err := work(ctx, v); err != nil {
                return err   // cancels ctx; other workers see <-ctx.Done()
            }
        }
        return nil
    })
}
err := g.Wait()
```

Without `errgroup`, you have to wire your own error channel, your own ctx propagation, and your own "first wins" deduping. With it, the pattern is one block of code.

**Common wrong answer.** "Use errgroup for the producer too." (You can, but the producer's exit signals the workers via channel close, not via ctx; mixing the two is fine but watch the close ordering.)

**Follow-up.** *Why does `g.Wait()` block until all goroutines have exited?* — Because the contract is "tell me when everyone is done, then give me the first error." A premature return would leak.

---

### Q10. Does fan-out preserve input order?

**Model answer.** No. Workers complete at different rates; the result channel sees whichever finishes first. If you need order:

1. **Index your jobs.** Put a sequence ID in the job struct: `Job{ID: i, Payload: ...}`. Result struct mirrors it: `Result{ID, V, Err}`. Reassemble after collecting.
2. **One channel per worker.** Each worker takes its own slice slice; you collect into a pre-sized output slice. Avoids any sorting.
3. **Sequential pipeline.** If order matters and parallelism does not, do not fan-out.

**Follow-up.** *Could I just use a buffered output channel and assume it preserves order?* — No. The order of writes onto a shared channel reflects which worker happened to finish first, which is non-deterministic.

---

### Q11. What is backpressure in fan-out and why do you want it?

**Model answer.** Backpressure is the natural slowdown that occurs when producers cannot send because consumers cannot keep up. In fan-out:

- If `in` is unbuffered (or the buffer is full) and no worker is ready, the producer blocks on `in <- v`.
- If `out` is unbuffered and the consumer is slow, all workers block on `out <- r`. The producer, finding no worker free, also blocks.

This blocking is *correct*. It bounds memory use to whatever fits in the channel buffers, instead of letting the producer accumulate in-flight work indefinitely.

The wrong response to "the producer is slow" is to add a giant buffer; the right response is to make the bottleneck visible (queue depth, slow worker count) and either accept the throughput or scale the bottleneck.

**Follow-up.** *When is no backpressure (drop-on-full) preferable?* — Sampled telemetry, video frames, anything where stale data is worthless. Use a `select` with `default` to drop on full.

---

### Q12. What is the "single slow worker" problem?

**Model answer.** In a fan-out, every worker reads from the same channel. If one worker has a job that takes much longer than the others (a giant file, a slow remote service), it does not block the channel — other workers continue grabbing jobs.

The problem appears in *result ordering* and *latency tail*: the slow worker eventually emits one result, far behind the others, dragging the p99 latency up. If results must be processed in input order, the slow worker stalls the consumer.

Mitigations:
- **Per-job timeout.** Cancel the slow worker via ctx after T seconds, retry elsewhere.
- **Hedged requests.** After T seconds, dispatch the same job to a second worker and take whichever finishes first.
- **Work stealing.** Keep one queue per worker; idle workers steal from busy ones.

**Follow-up.** *Why doesn't a slow worker block the whole channel?* — Because the other workers are still parked in receive; the next value goes to one of them, not to the slow one. The channel is not FIFO-blocked by an in-progress receiver.

---

## Senior

### Q13. When should you NOT use fan-out?

**Model answer.** Fan-out costs goroutine and channel overhead. It is the wrong tool when:

1. **Work is too small.** If `work(v)` runs in nanoseconds, channel send + receive + scheduling dominate. Sequential or batched code is faster.
2. **Work is sequential by nature.** Stateful pipelines (LZ4 stream decode, parser with carry-over) cannot parallelize per-item.
3. **Order is essential and reordering is unacceptable.** Sorting at the end may erase the parallelism gains.
4. **Downstream is single-threaded.** If the consumer is bottlenecked at one core, six workers help nothing.
5. **Side-effects forbid concurrency.** Writing to one shared file, one connection, one global counter — without sync, fan-out introduces races; with sync, it serialises.

**Follow-up.** *How do I decide quickly?* — Run sequentially first, profile, see if CPU is the bottleneck (then consider CPU-bound fan-out), or if you have many waits (then consider IO-bound fan-out). No bottleneck, no fan-out.

---

### Q14. Static vs dynamic worker count — when does each apply?

**Model answer.**

**Static** (fixed N at startup):
- Predictable resource use.
- Simple to reason about and test.
- Right for batch jobs, request-scoped fan-out, and most production systems.

**Dynamic** (workers spawned/retired based on load):
- Adapts to bursty workloads.
- Saves resources during quiet periods.
- Right for long-running daemons with very uneven load.
- Comes with thrashing risk: spawn cost, scheduler churn, GC pressure from goroutine creation.

A common middle ground is **static N + buffered queue**. Cap workers, queue extra work, treat queue depth as the back-signal. This gives the predictability of static with some elasticity.

True dynamic resizing — semaphores adjusting `MaxWorkers`, idle workers exiting after T seconds — is rare in well-tuned Go services. The default is static.

**Follow-up.** *What signals do you use to drive dynamic sizing?* — Queue depth (latency proxy), CPU utilization, p99 service time. Avoid arrival rate alone; it lags reality.

---

### Q15. How do you benchmark different N values?

**Model answer.** Parameterize `N` over the benchmark and measure throughput (or tail latency, depending on goal):

```go
func BenchmarkProcess(b *testing.B) {
    for _, n := range []int{1, 2, 4, 8, 16, 32, 64} {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            in := make(chan int, n)
            go func() {
                defer close(in)
                for i := 0; i < b.N; i++ { in <- i }
            }()
            out := Process(context.Background(), in, n, work)
            for range out {}
        })
    }
}
```

Plot N vs ns/op. The optimal N is the *smallest* one that plateaus the curve. Going past that adds cost without benefit.

For IO-bound work, also vary the load generator concurrency — the producer side may be the bottleneck.

**Pitfalls:**
- One-shot timing is noisy. Use `benchstat` over many runs.
- Allocation rate matters; check `b.ReportAllocs()`.
- Benchmark on hardware close to production, not on a laptop.

**Follow-up.** *Why "smallest plateau" rather than "absolute fastest"?* — Because higher N consumes more memory, more GC pressure, and more scheduler overhead. Picking the knee of the curve gives the best efficiency, not just the best raw speed.

---

### Q16. What is work stealing and when is it better than plain fan-out?

**Model answer.** In plain fan-out, all workers share one input channel; the runtime distributes by "whoever is ready next." This is *push* distribution: the channel pushes values to whichever receiver wakes up.

**Work stealing** is *pull* distribution: each worker has its own local queue. When a worker's queue empties, it steals jobs from a busy peer's queue. This is the model used by `runtime` itself for scheduling P→M.

Work stealing is better than channel fan-out when:
- **Job sizes are skewed.** With per-worker queues, idle workers actively pull; with shared channel, fast workers naturally take more, but if a worker is mid-job on a giant task, its assigned-but-unstarted local jobs sit idle.
- **Locality matters.** Per-worker queues let each worker batch nearby jobs (cache locality).
- **You profile and see channel contention.** A shared channel with many contenders has scheduler hot spots.

For the common case (similar-sized jobs, dozens of workers), plain fan-out is good enough and dramatically simpler.

**Follow-up.** *Does Go's stdlib offer work-stealing channels?* — Not directly. The runtime scheduler does work stealing internally, but for application-level you build it yourself or use libraries (e.g. `pgxpool`-style). Most teams stay with plain fan-out.

---

### Q17. Channels vs semaphores for limiting concurrency — what is the difference?

**Model answer.** Two ways to bound concurrency:

**Channel-based fan-out.** `n` workers + one input channel. Workers idle on receive when no work is queued. Memory per worker: ~2-8 KB stack + channel slot.

**Semaphore-based bounding.**
```go
sem := make(chan struct{}, n)
for _, job := range jobs {
    sem <- struct{}{}
    go func(j Job) {
        defer func() { <-sem }()
        process(j)
    }(job)
}
```
Spawns one goroutine per job, but `sem` only allows `n` to run at once. Memory: O(jobs), since every pending job is a parked goroutine.

| Aspect | Channel fan-out | Semaphore |
|--------|-----------------|-----------|
| Goroutines | N | One per job |
| Memory | O(N) | O(jobs) |
| Spawn cost | Once at start | Per job |
| Cancellation | Via ctx in worker | Tricky — extra goroutines may run before sem |
| Use case | Steady streams | Bursty with low job count |

For steady, high-volume streams, channel fan-out wins because goroutine count is bounded by N, not by job count.

**Follow-up.** *Are there cases where the semaphore is better?* — Yes: when each "job" is a single function call from a CLI command, or when jobs need their own ctx/cancellation that does not match the worker's lifecycle.

---

### Q18. How do you detect goroutine leaks in fan-out tests?

**Model answer.** Use `go.uber.org/goleak`:

```go
import "go.uber.org/goleak"

func TestProcessNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    in := make(chan int)
    go func() {
        defer close(in)
        for i := 0; i < 100; i++ {
            select {
            case <-ctx.Done(): return
            case in <- i:
            }
        }
    }()

    out := Process(ctx, in, 8, work)
    var got int
    for range out {
        got++
        if got == 5 { cancel() }
    }
}
```

`goleak.VerifyNone` walks the goroutine stack at test end and fails if any non-test goroutine survives. The classic leak: cancel without drain — workers blocked on `out <- r` linger forever.

For deeper diagnostics, dump `runtime.Stack` and grep for the worker function name:

```go
buf := make([]byte, 1<<20)
n := runtime.Stack(buf, true)
fmt.Println(string(buf[:n]))
```

**Follow-up.** *Why does cancel-without-drain leak?* — Because a worker may already have computed a result and be blocked on `case out <- r`. Cancelling ctx doesn't unblock the send; only a receiver does. Either drain the output, or wrap the send in a `select` with `<-ctx.Done()`.

---

### Q19. How does fan-out interact with rate limiters?

**Model answer.** A fan-out caps concurrency (N in-flight). A rate limiter caps throughput (R per second). They solve different problems and often are used together.

```go
limiter := rate.NewLimiter(rate.Limit(50), 10) // 50 req/s, burst 10

for i := 0; i < n; i++ {
    g.Go(func() error {
        for v := range in {
            if err := limiter.Wait(ctx); err != nil { return err }
            if err := work(ctx, v); err != nil { return err }
        }
        return nil
    })
}
```

Without the rate limiter, a 100-worker fan-out hammers the downstream service with 100 simultaneous requests on every burst. The rate limiter smooths that to 50 req/s no matter how many workers exist.

**Pitfall:** placing the limiter *outside* the worker (e.g. on the producer) limits arrivals, not in-flights. The downstream still sees bursts when workers fall behind.

**Follow-up.** *How do you choose between concurrency cap and rate cap?* — Concurrency cap protects connections, sockets, file descriptors. Rate cap respects external SLAs (third-party API rate limits). Most production fan-outs need both.

---

### Q20. How do you handle errors with partial success — some jobs succeed, some fail?

**Model answer.** Three policies:

1. **All-or-nothing (errgroup).** First error cancels everyone; nothing surfaces partial results. Right when the result of one job is meaningless without all the others.

2. **Best-effort (Result struct).** Each result carries an `Err` field. Caller iterates, separating successes from failures. Right when each job is independent (e.g. health-check 100 hosts, report which failed).

```go
type Result struct {
    Job Job
    V   any
    Err error
}
```

3. **Partial commit / eventual consistency.** Successes are persisted, failures are queued for retry. Right for ingestion pipelines.

The choice is product-driven, not technical. Discuss it explicitly in design reviews; do not let it default to "errgroup because that's what came up first."

**Follow-up.** *How do I report progress while errors accumulate?* — A side metric channel or counter; for visibility use atomic counters and emit them periodically.

---

## Staff

### Q21. Walk through how you would size a fan-out for a per-request scatter-gather.

**Model answer.** Per-request fan-out has different constraints from background batch fan-out:

1. **Bound by request budget, not throughput.** If the request has a 200ms SLA and each backend call takes 50ms, you have time for 4 sequential calls or 4-8 parallel calls. Fan-out is for the parallel form.
2. **N is small.** Usually 4-16. The bottleneck is the slowest backend, not how many workers you spawn.
3. **Cancel on first error vs on first timeout.** `errgroup.WithContext` paired with `context.WithTimeout` covers both.
4. **Pre-allocate the result slice.** You know N at the start; index by position so no merging is needed.

```go
g, ctx := errgroup.WithContext(reqCtx)
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
if err := g.Wait(); err != nil { return nil, err }
```

No channel needed — just goroutines and a pre-sized slice. This is fan-out without the channel machinery, which is fine when the job set is bounded and known.

**Follow-up.** *What if one backend is non-essential and its failure shouldn't fail the request?* — Drop it from `errgroup` and run as a separate goroutine with its own error swallowing. Or use a `Result{Err}` struct and merge after.

---

### Q22. How do you instrument a fan-out for observability?

**Model answer.** Three layers:

1. **Pool-level metrics (gauges):** worker count, queue depth (input channel buffer used), in-flight job count.
2. **Per-job metrics (histograms/counters):** job duration, success count, error count by class, retry count.
3. **Tracing (spans):** one span per job, parented to the producer's span. Each worker also emits a span for the dispatch itself.

```go
in := make(chan Job, capacity)
inFlight := atomic.Int64{}

for i := 0; i < n; i++ {
    g.Go(func() error {
        for j := range in {
            inFlight.Add(1)
            t := time.Now()
            err := work(ctx, j)
            jobDuration.Observe(time.Since(t).Seconds())
            inFlight.Add(-1)
            if err != nil {
                jobErrors.WithLabelValues(classify(err)).Inc()
                return err
            }
            jobSuccess.Inc()
        }
        return nil
    })
}

go func() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for range t.C {
        queueDepthGauge.Set(float64(len(in)))
    }
}()
```

Critically: never log inside hot loops. Logs become the bottleneck and skew the very benchmarks you are running. Aggregate via metrics; emit logs only on errors.

**Follow-up.** *What hidden cost do tracing spans add?* — A span per job is fine until N × jobs/sec exceeds a few thousand spans/sec, where the exporter becomes the bottleneck. Sample at 1-10% above that threshold.

---

### Q23. Design a fan-out that survives a poisonous job.

**Model answer.** A poisonous job is one that crashes (panics) or hangs forever. Both can take down a worker and cripple throughput.

**Defenses:**

1. **Recover per worker.**
```go
g.Go(func() error {
    defer func() {
        if r := recover(); r != nil {
            metric.PanicCount.Inc()
            // optionally: re-spawn this worker
        }
    }()
    for j := range in { work(ctx, j) }
    return nil
})
```

2. **Per-job timeout.**
```go
jobCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
err := work(jobCtx, j)
cancel()
```

3. **Quarantine.** On the third repeated failure of the same job, mark it as poisonous and skip with an alert.

4. **Worker self-restart.** If a worker panics, the closing goroutine notices `wg` is short, spawns a replacement, and continues. This is the "supervisor" pattern.

5. **Bound retries.** Never retry forever; cap at K attempts with backoff.

**Follow-up.** *Why does a single panicking worker not just crash the program?* — Because `recover()` inside the worker stops the unwind. Without recover, a panic in any goroutine takes the whole program down. For libraries, recover only for known-safe boundaries; for batch jobs, recover liberally and surface via metrics.

---

### Q24. How do you migrate a sequential pipeline to fan-out incrementally?

**Model answer.** Six steps, each independently shippable:

1. **Measure baseline.** End-to-end throughput, p99 latency, CPU utilization. You need this number to know if fan-out helped.
2. **Identify the parallelizable stage.** Profile to find where wall-clock is spent. If 90% is in stage X and X is independent per-item, fan-out X. Don't fan-out the cheap stages.
3. **Wrap the stage in a fan-out helper with N=1.** No parallelism yet, but the channel plumbing is in place. Verify behavior identical.
4. **Bump N to 2, then 4, 8.** At each step, re-measure. Plateau is your answer.
5. **Add ctx and errgroup.** Without them, your migration is fragile. Wire them in once you have throughput.
6. **Add observability.** Queue depth, in-flight counter, job duration histogram. You will need them under load.

The mistake is jumping straight to step 4. Without baseline (1) you cannot prove the change worked. Without staged rollout (2-5) you cannot diagnose regressions.

**Follow-up.** *What if the parallelisation is across items but each item touches shared state?* — Refactor the shared state out: per-worker buffers + final merge, or per-key sharding. Don't fan-out over a global mutex; you'll just serialise.

---

### Q25. Critique this fan-out implementation. (Reading code in interview.)

```go
func Process(in chan int, n int) chan int {
    out := make(chan int)
    for i := 0; i < n; i++ {
        go func() {
            for v := range in {
                out <- v * v
            }
            close(out)
        }()
    }
    return out
}
```

**Model answer.** Three serious bugs and one lesser issue:

1. **Multiple `close(out)`** — every worker closes the output. The first one closing succeeds; the rest panic. Should be a single closer goroutine using `WaitGroup`.
2. **No cancellation.** Workers ignore ctx; they only stop when `in` closes. A real system needs `case <-ctx.Done(): return`.
3. **No error path.** What if the work fails? Need a Result struct with `Err` or wire `errgroup`.
4. **No `n <= 0` guard.** Producer deadlocks silently.

Refactored:

```go
func Process(ctx context.Context, in <-chan int, n int) <-chan int {
    if n <= 0 { panic("n must be > 0") }
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done(): return
                case v, ok := <-in:
                    if !ok { return }
                    select {
                    case <-ctx.Done(): return
                    case out <- v * v:
                    }
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Follow-up.** *What test would catch the multiple-close bug?* — A `goleak`-style test or any unit test that runs with N≥2 and waits for completion. The test harness panic message points at the `close` line.

---

### Q26. Compare fan-out, fan-in, and pipeline.

**Model answer.** Three patterns of the same family — channels-as-queues — with different shapes:

| Pattern | Shape | Purpose | Direction |
|---------|-------|---------|-----------|
| Fan-out | 1 → N | Distribute work | Splits |
| Fan-in | N → 1 | Merge results | Joins |
| Pipeline | A → B → C | Staged processing | Chains |

A pipeline is built by composing fan-outs and fan-ins between stages. Stage 1 produces; stage 2 fans-out N workers reading stage 1's channel; stage 3 fans-in stage 2's results into one stream; stage 4 consumes. Each stage runs concurrently; the whole pipeline behaves like a Unix pipe.

The mental shift: each pattern is a *function from channels to channels*. They compose like LEGO. A real pipeline often has 4-6 such transformations stacked on each other.

**Follow-up.** *When do these patterns become the wrong abstraction?* — When the data flow is no longer a tree (cycles, fan-in-then-fan-out-then-fan-in). At that point, prefer a worker-pool/dispatcher with explicit job IDs, or move to an actor framework.

---

### Q27. What is the cost of a goroutine, and how does it shape fan-out sizing?

**Model answer.** A Go goroutine costs:

- **Stack:** 2 KB initial (since 1.4), growing geometrically up to a soft cap (1 GB in modern Go). Most fan-out workers stay under 8 KB.
- **Scheduler entry:** one slot in the runtime's structures, cheap.
- **Channel slot:** one parked g linked into the channel's wait list when blocked.

For 1,000 fan-out workers at 8 KB each: ~8 MB. Negligible at process scale, dominant at thousands-of-pools-per-process scale.

The non-obvious cost is **scheduler contention**. Many goroutines all parked on the same channel mean one wake-up per send; the runtime has to pick which one to wake. At very high N (>10,000), this scheduling overhead exceeds the work itself for tiny jobs.

For sizing: don't fear thousands of goroutines, but *don't pick a number larger than you can justify*. Larger N consumes more memory and adds scheduler pressure with diminishing returns.

**Follow-up.** *How do I see scheduler pressure?* — `GODEBUG=schedtrace=1000` prints scheduler stats every 1s. Watch `idleprocs`, `runqueue`, and `gomaxprocs`. High runqueues with idle Ps usually means oversubscribed workers.

---

## Curveball / Gotcha

### Q28. Why does this fan-out hang sometimes but work other times?

```go
out := make(chan int)
var wg sync.WaitGroup
for i := 0; i < 4; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range in {
            out <- v * v
        }
    }()
}
wg.Wait()
close(out)
for v := range out {
    fmt.Println(v)
}
```

**Model answer.** It hangs **always**, not sometimes. The author put `wg.Wait()` before reading from `out`. Workers write into `out`; if `out` is unbuffered, every write blocks until something reads; the consumer can't read until `wg.Wait()` returns; `wg.Wait()` won't return until every worker exits; workers can't exit until they've written everything; deadlock.

The fix is the closer goroutine pattern:

```go
go func() { wg.Wait(); close(out) }()
for v := range out { /* consume */ }
```

The closer waits in the background; the consumer drains while workers produce; eventually all workers exit, closer fires, range exits.

The reason this looks intermittent in practice: with a buffered channel of size N or more, the first batch of writes goes into the buffer non-blocking, then the workers exit, then `wg.Wait` returns, then the consumer reads from the buffer, then `close(out)` runs after the loop. Larger inputs surface the deadlock; smaller ones hide it.

**Follow-up.** *What is the simplest mental rule that prevents this?* — Always start the closer goroutine before the consumer's range. Make it a one-liner muscle memory.

---

End of interview prompts. The goal across these questions is the same: can you reason about goroutine lifetime, channel ownership, cancellation, and load characteristics — and produce code that doesn't leak, doesn't deadlock, and shuts down cleanly.
