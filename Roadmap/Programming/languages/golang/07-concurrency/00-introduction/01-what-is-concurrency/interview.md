# What is Concurrency — Interview Questions

> Questions from junior to staff. Each has a model answer, common wrong answers, and follow-up probes. Use as study material and as a reviewer's pocket guide.

---

## Junior

### Q1. Define concurrency.

**Model answer.** Concurrency is the property of a program where multiple logical tasks can be in progress over the same time interval. It is a structuring property — the program is composed of independent tasks. Whether those tasks actually execute simultaneously on different CPUs is a separate property called parallelism.

**Common wrong answers.**
- "Concurrency is when many things happen at the same time." (That is parallelism.)
- "Concurrency is multithreading." (Multithreading is one *implementation* of concurrency.)
- "Concurrency makes programs faster." (Only when there is parallel work to be done or wait to hide.)

**Follow-up.** *Give a concrete example of concurrency without parallelism.* — A single-core machine running 10 goroutines that wait on network I/O. They are concurrent (all in progress) but never run at the same instant.

---

### Q2. What is the difference between concurrency and parallelism?

**Model answer.** Concurrency is about *structure* — composing the program as multiple independent tasks. Parallelism is about *execution* — those tasks running simultaneously on multiple cores. Concurrency does not imply parallelism; you can have concurrency on a single core. Parallelism without concurrency is rare in application code (it shows up in SIMD and GPU kernels).

**Follow-up.** *Why does Rob Pike say "concurrency enables parallelism but is not the same"?* — Because once you have structured your program concurrently, the runtime can choose to execute parts in parallel where hardware allows. Without concurrent structure, the runtime cannot parallelise.

---

### Q3. Why do we need concurrency at all if our laptop has only one core?

**Model answer.** Most programs spend most of their time *waiting* — for network responses, disk reads, user input. While one task waits, the CPU can run another. Concurrency lets you overlap waits without blocking the CPU. Even on a single-core machine, concurrency improves throughput for I/O-bound workloads.

**Follow-up.** *Name one scenario where concurrency does not help on a single core.* — A purely CPU-bound algorithm like multiplying two large matrices. There is no wait to hide; one core is one core.

---

### Q4. What does `GOMAXPROCS` do?

**Model answer.** It sets the maximum number of OS threads the Go runtime can use to execute goroutines simultaneously. By default it equals `runtime.NumCPU()`. Setting it to 1 forces all goroutines to share one thread, eliminating parallelism while preserving concurrency.

**Follow-up.** *Should you ever set it manually?* — Rarely. In containerised environments where the container's CPU quota differs from the host's core count, you may want to match it. The `github.com/uber-go/automaxprocs` package does this automatically.

---

### Q5. What is an I/O-bound workload?

**Model answer.** A workload whose runtime is dominated by waiting for an external resource — network, disk, subprocess — rather than by CPU work. Web servers, crawlers, and most database-backed services are I/O-bound. They benefit hugely from concurrency.

**Follow-up.** *And a CPU-bound workload?* — A workload whose runtime is dominated by computation. Image encoding, cryptography, simulation. Benefits from parallelism (one goroutine per core), not from many goroutines per core.

---

### Q6. What's wrong with this code?

```go
func main() {
    go fmt.Println("hello")
}
```

**Model answer.** The program likely prints nothing. The `main` goroutine returns immediately after spawning the goroutine; when `main` returns, the program exits. The spawned goroutine may not have had time to run.

**Fix.** Use `sync.WaitGroup` or a channel to wait for the goroutine to finish.

---

## Middle

### Q7. State Amdahl's law in plain English.

**Model answer.** The maximum speedup from parallelism is bounded by the fraction of work that cannot be parallelised. If 30% of a program is inherently sequential, then even infinite cores can only give about 3.3x speedup. Formally, `S(n) = 1 / ((1-p) + p/n)`, where `p` is the parallel fraction and `n` is the number of cores.

**Common wrong answers.**
- "More cores means more speed." (Only up to the limit set by the serial fraction.)
- "Amdahl says concurrency is useless." (Wrong; it caps speedup but does not eliminate it.)

**Follow-up.** *How does Gustafson's law modify this?* — Gustafson observes that in practice, problem sizes grow with hardware. If the parallel portion grows while the serial portion stays constant, speedup grows roughly linearly with `n`. The two laws disagree because they answer different questions: Amdahl asks "how fast can a fixed problem be," Gustafson asks "how much problem can a fixed time handle."

---

### Q8. Why does this concurrent code run *slower* than the sequential version?

```go
var sum int
var mu sync.Mutex
var wg sync.WaitGroup
for i := 0; i < 1_000_000; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        mu.Lock()
        sum += i
        mu.Unlock()
    }(i)
}
wg.Wait()
```

**Model answer.** Two compounding problems. First, every iteration spawns a goroutine, which has scheduling cost on the order of a microsecond — a million microseconds is a second of pure overhead. Second, every iteration acquires the same mutex, serialising the actual work. The "concurrent" code is really sequential plus enormous overhead.

**Fix.** Use atomics or per-goroutine local sums combined at the end.

---

### Q9. What is "false sharing" and how do you detect it?

**Model answer.** False sharing occurs when two variables on the same cache line are written by different cores. The cache coherence protocol treats the line as one unit, so each write invalidates the line in other cores' caches, even though logically the variables are independent. The cache line ping-pongs, killing throughput.

**Detection:** sublinear scaling in benchmarks, high last-level cache miss rate in `perf stat`, suspicion of "concurrent writes to nearby struct fields."

**Fix:** pad each frequently-written variable to a 64-byte cache line.

---

### Q10. When would you choose a worker pool over "one goroutine per request"?

**Model answer.** When the input is unbounded but a downstream resource is bounded. Example: serving HTTP requests that each issue a DB query against a pool of 50 connections. Spawning one goroutine per request is fine for the HTTP server, but inside the handler, you want a bounded concurrency primitive (semaphore or worker pool) so 10 000 concurrent requests do not crush the database.

**Follow-up.** *How do you size the pool?* — Match it to the downstream concurrency limit (e.g., max DB connections). Profile under load; adjust.

---

### Q11. How does `errgroup` differ from `sync.WaitGroup`?

**Model answer.** `WaitGroup` is a counter — it tells you when N tasks finished but conveys no error information. `errgroup.Group` adds: (a) error return from each task, (b) the first non-nil error cancels a shared context to abort the others, (c) `g.Wait()` returns the first error. `errgroup` is the structured-concurrency primitive of choice when goroutines can fail.

---

### Q12. What is back-pressure and how do you implement it in Go?

**Model answer.** Back-pressure is the mechanism by which a slow consumer slows down a fast producer, preventing unbounded buffering. In Go, the simplest implementation is an unbuffered channel: a send blocks until a receive is ready. Buffered channels add a fixed-size buffer; once full, sends block.

**Follow-up.** *What's the alternative?* — Load shedding (drop work when overloaded) or dynamic buffering (unsafe — leads to OOM).

---

## Senior

### Q13. Describe structured concurrency and why it matters.

**Model answer.** Structured concurrency is the discipline that goroutine lifetimes must nest within their spawning function's lifetime. A function does not return until every goroutine it spawned has finished. The benefit is local reasoning: you can see goroutine starts and ends in the same scope. Errors and cancellation propagate predictably. Resources clean up. In Go, `errgroup` and `sync.WaitGroup` enable structured concurrency by convention; the language does not enforce it.

**Follow-up.** *Are there cases where unstructured is necessary?* — Yes, long-lived background tasks (queue consumers, daemons, supervisors). For those, expose an explicit handle with a `Close()` method that joins the goroutine.

---

### Q14. How do you prevent goroutine leaks?

**Model answer.** A goroutine leaks when it has no exit condition. Three defences:

1. **Always pass a `context.Context`.** Check `ctx.Done()` in loops; respect cancellation.
2. **Bound all blocking operations.** Use `select` with timeouts, set deadlines on network calls, use buffered channels of size 1 for "send result and exit" patterns.
3. **Document ownership.** Every goroutine should have a documented owner who is responsible for stopping it.

**Detection.** Track `runtime.NumGoroutine()` in production. Use `pprof` goroutine profile to inspect live stacks. Use `go.uber.org/goleak` in tests.

---

### Q15. When does adding concurrency *hurt* a service?

**Model answer.** Several cases:

- **Sequential bottleneck.** Many goroutines queueing on one mutex, one connection, one rate-limited API.
- **Memory bandwidth.** Cores share memory bus; adding more does not help bandwidth-bound work.
- **Tail latency amplification.** Fan-out to N services means waiting for the slowest. 99th-percentile latency rises.
- **Coordination cost.** Synchronisation overhead exceeds the work being parallelised.
- **Resource exhaustion.** Unbounded goroutines exhaust memory or file descriptors.

The remedy in each case is to *measure* before adding concurrency and to design with the bottleneck in mind.

---

### Q16. How would you handle partial failure in a scatter-gather?

**Model answer.** Three policies, chosen explicitly:

- **All-or-nothing.** Any failure fails the entire request. Simplest; useful when partial answers are wrong.
- **Best-effort.** Use successes, log failures. Useful for non-critical aggregation (e.g., enriching with multiple sources).
- **Quorum.** Succeed if at least K of N succeed. Useful for redundancy across data centres.

The choice depends on the product requirement. Code should make the choice visible (e.g., `aggregator.QuorumPolicy(2)`).

---

### Q17. What's the difference between throughput and latency, and how does concurrency affect each?

**Model answer.** Throughput is work completed per unit time. Latency is time from request to response for one unit of work. Concurrency typically improves throughput (more work in parallel) without improving latency for a single task — latency may even get slightly worse due to scheduling overhead. Concurrency can improve single-task latency only when a task is split across cores (CPU parallelism) or issues parallel I/Os (scatter-gather).

**Follow-up.** *Give a service example where you optimise for throughput vs latency.* — Batch processing: throughput. Interactive UI: latency. The trade-off shapes architecture.

---

### Q18. How would you reason about contention in a Go program?

**Model answer.** Several diagnostics:

- **CPU profile.** Time spent in `runtime.lock`, `runtime.chansend`, or atomic operations indicates contention.
- **Mutex profile.** `runtime.SetMutexProfileFraction(1)` then `go tool pprof http://.../debug/pprof/mutex` shows where mutex contention is.
- **Block profile.** `runtime.SetBlockProfileRate(...)` shows where goroutines are blocked.
- **Trace.** `go tool trace` shows goroutine scheduling per logical processor; gaps and clusters reveal contention.

Once located, remedies include: finer-grained locks, lock-free atomics, sharded data structures, channel-based ownership.

---

## Staff

### Q19. Design a concurrent caching layer for a high-traffic service. What concerns dominate?

**Model answer.** Layered concerns:

1. **Concurrent reads should not block each other.** Use `sync.Map` or sharded `map[K]V` with per-shard `RWMutex`.
2. **Cache stampede prevention.** When a hot key expires, 1000 concurrent requests each compute the value. Use `singleflight.Group` to dedupe.
3. **Background refresh.** Decouple staleness from invalidation; serve stale-while-revalidate to hide refresh latency.
4. **Eviction.** Bounded by memory; use LRU or random sampling. Lock contention in LRU is well-known; consider `groupcache` or `ristretto`.
5. **Cardinality.** Per-shard or per-CPU caches avoid contention; the trade-off is cache fragmentation.
6. **Cache coherence across instances.** Use TTLs, version stamps, or pub/sub invalidation.
7. **Hot keys.** Some keys are 10000x more popular than others; uniform sharding does not balance load. Special-case hot keys with separate caches.

The crucial insight: contention almost always dominates correctness in production cache design.

---

### Q20. Walk through what happens at the hardware level when two goroutines on different cores atomically increment the same `int64`.

**Model answer.** Each `atomic.AddInt64` on x86 compiles to a `LOCK XADD` instruction, which:

1. Acquires exclusive ownership of the cache line containing the variable in MESI's Modified state.
2. Reads the current value, increments, writes back atomically.
3. The cache coherence protocol invalidates the line in all other cores' caches.

If two cores do this concurrently, they take turns. Each acquisition involves a cross-core cache transfer (~60 ns on modern Intel). The throughput is bounded by 1/(2 × cross-core latency) ≈ 8M ops/sec, regardless of how many cores you have.

Mitigation: per-CPU counters combined occasionally, padded to avoid false sharing.

**Follow-up.** *How does the Go runtime address this internally?* — The scheduler uses per-P run queues; `sync.Pool` has per-P local pools; `runtime.MemStats` uses per-CPU counters. The pattern is consistent: avoid sharing where possible.

---

### Q21. Critique this architectural decision: "We made every service method internally concurrent for performance."

**Model answer.** Several concerns:

1. **Hidden cost.** Callers don't know their function call spawns goroutines, may overlap I/O, may consume more memory. The API contract is misleading.
2. **Lifetime confusion.** When the caller's context is cancelled, are the internal goroutines cancelled? If not, leaks.
3. **Resource limits.** Each method silently consumes some concurrency budget. The system has no global view of how much is in flight.
4. **Testing.** Concurrent internals make tests flaky if not carefully designed.
5. **Diminishing returns.** Many methods do not benefit from concurrency. Adding it everywhere bloats the binary and complicates code.

**Better approach.** Make concurrency explicit at the API level. Methods that benefit are named accordingly (`FetchParallel`, `BatchProcess`). Methods that do not are simple synchronous calls. Profile to identify the actual hotspots and parallelise only those.

---

### Q22. How would you design a chaos test for concurrent code?

**Model answer.** Layered approach:

1. **Race detector in CI.** Every test, every commit, `-race` flag.
2. **Stress runs.** `go test -count=100 -race` to surface timing-dependent bugs.
3. **Adversarial scheduling.** Insert random `runtime.Gosched()` calls or `time.Sleep(0)` in test code to perturb ordering.
4. **Goroutine fault injection.** Hook key call sites to randomly inject errors, timeouts, panics. Verify the system recovers.
5. **Resource exhaustion.** Force `runtime.NumGoroutine()` higher than expected; verify back-pressure or rejection.
6. **Property-based tests.** Use `gopter` or `rapid` to generate random concurrent operation orderings and check invariants.

The point is to find rare orderings that production will eventually exercise.

---

### Q23. What is the relationship between concurrency and observability?

**Model answer.** Concurrent systems hide what they are doing. Without observability, a concurrency bug looks like "the service is slow today" with no obvious cause. Required signals:

- **Goroutine count.** Should be roughly stable. Growth = leak.
- **Goroutine profile.** Where are they all? Use `pprof`.
- **Block profile.** Where are they blocked? Identifies contention.
- **Mutex profile.** Which mutexes contend?
- **Per-request tracing.** A trace shows fan-out, parallel calls, time on each.
- **Per-stage queue depth.** In a pipeline, where is work piling up?

Observability is the *senior tax* of concurrency. Without it, you are operating blind.

---

### Q24. When would you NOT use channels in Go?

**Model answer.** Channels are powerful but not always the answer:

- **Protecting a single shared variable.** Use `sync.Mutex` or atomics. A channel here is overkill and slower.
- **Counting completion.** Use `sync.WaitGroup`. Channels can do it but require more code.
- **Sub-microsecond critical sections.** A channel send is several hundred nanoseconds. Atomic is tens.
- **Caching state with rare writes.** Use `atomic.Value` or `sync.RWMutex`. Channels do not fit the read pattern.
- **Long-lived shared data structures (queues, maps).** Special-purpose data structures outperform channel-based ones.

Channels excel at: communicating ownership, signalling events, building pipelines, fan-out and fan-in.

---

### Q25. Describe how to migrate a sequential service to concurrent without breaking semantics.

**Model answer.** Stepwise:

1. **Profile.** Identify the actual bottleneck. Often it is one specific function or downstream call.
2. **Isolate.** Extract the hot path into a function with explicit inputs and outputs.
3. **Determine independence.** Can the work be split into independent units? If not, parallelism is impossible.
4. **Choose a pattern.** Fan-out, pipeline, worker pool — pick one.
5. **Implement with a feature flag.** Roll out behind a flag that toggles old vs new code path.
6. **Compare behaviour.** Shadow mode: run both, compare outputs, alert on diff.
7. **Compare performance.** Throughput, latency, resource use.
8. **Roll out gradually.** Per-region, per-tenant.
9. **Monitor.** Goroutine count, error rate, latency tails. Watch for surprises.
10. **Tear down old code.** Only after the new path is stable for weeks.

The migration is conservative because concurrent code introduces failure modes that sequential code does not have. Roll back is essential.

---

## Closing

The questions above are tools for a working engineer. Most senior interviews are not lookup quizzes; they are conversations where the interviewer probes your understanding, your war stories, your judgement. The best preparation is to have built and operated concurrent systems, debugged them under load, and reflected on what worked.

The skills compound. Concurrency interviews from Go specifically often pivot to channels, the GMP scheduler, or the memory model. Those topics live in their own roadmap files. Start here, then go deeper.
