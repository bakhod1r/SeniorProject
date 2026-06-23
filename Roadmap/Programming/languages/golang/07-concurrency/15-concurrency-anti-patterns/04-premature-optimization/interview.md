---
layout: default
title: Interview
parent: Premature Optimization
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 6
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/04-premature-optimization/interview/
---

# Premature Concurrency Optimization — Interview Questions

A graded collection of 35 questions, ranging from junior to staff level. Each question has a short answer (1-3 sentences), an extended answer (paragraph), and a "what a good answer hits" rubric.

---

## Difficulty key

- **J** = Junior (entry-level Go)
- **M** = Middle (1-3 years)
- **S** = Senior (3-7 years)
- **P** = Professional / Staff (7+ years)

---

## Q1 (J): What is "premature optimization"?

**Short**: Optimizing without measurement to justify it; making code more complex without evidence it pays off.

**Extended**: The phrase is Donald Knuth's: "premature optimization is the root of all evil." It does not mean "never optimize"; it means "don't optimize before you have a profile, a benchmark, or a measurable problem." Premature concurrency optimization is the specific case of reaching for goroutines, channels, or atomics without first verifying that the simpler version is too slow.

**Rubric**: Good answers cite Knuth, mention measurement-first, and clarify that "premature" is about evidence, not about timing.

---

## Q2 (J): Is `go func() { ... }` always faster than the sequential equivalent?

**Short**: No. Goroutine spawn costs ~1 µs; if the work is less than that, sequential is faster.

**Extended**: Spawning a goroutine has overhead (memory allocation, scheduler enqueue). For tasks that do less than a few microseconds of work, the overhead dominates and parallel is slower. For longer tasks, parallel can win — but only if items are independent and total work is significant.

**Rubric**: Good answers mention goroutine spawn cost, work-vs-overhead ratio, and the dependency on workload shape.

---

## Q3 (J): What is `benchstat`?

**Short**: A tool that compares Go benchmark results with statistical significance testing.

**Extended**: `benchstat` takes two sets of `go test -bench` outputs and reports per-benchmark differences as percentages, along with a p-value (typically Welch's t-test) for statistical significance. The standard threshold is p < 0.05.

**Rubric**: Good answers mention statistical significance, p-values, and that benchstat is part of `golang.org/x/perf`.

---

## Q4 (M): What is Amdahl's law and why does it matter for concurrency?

**Short**: A formula giving the maximum speedup from parallelism: `1 / ((1-p) + p/N)`, where `p` is the parallel fraction and `N` the core count. It matters because serial fractions cap your speedup.

**Extended**: Amdahl says that if 10% of your code is serial, no number of cores gets you past 10× speedup. In Go specifically, serial fractions include input parsing, fan-out producers, fan-in aggregators, and channel hops. Before parallelizing, estimate the parallel fraction to see if the speedup is worth the engineering cost.

**Rubric**: Good answers state the formula, explain serial fraction, and give a concrete example.

---

## Q5 (M): What is false sharing?

**Short**: Two CPU cores writing to different fields in the same cache line, causing cache invalidation traffic between cores.

**Extended**: Cache lines are 64 bytes on x86_64. If goroutine A on core 0 writes to a struct field, and goroutine B on core 1 writes to an adjacent field in the same struct, both cores must coordinate to invalidate each other's cache copies. The actual data is independent, but the cache hardware treats them as conflicting. Result: every write is 10-30× slower than it would be alone.

**Rubric**: Good answers mention cache lines, mention 64-byte size, and propose padding as the fix.

---

## Q6 (J): When does using a channel make code slower?

**Short**: When the per-item work is small (under ~1 µs) and the channel send/recv overhead (~50-250 ns) dominates.

**Extended**: A channel send/receive takes 50 ns hot, 250 ns if it has to park. If your channel hands off 10-ns work items, you're spending most of the time on the handoff, not the work. Solutions: batch the work (send slices instead of items), use atomic operations, or skip the channel entirely.

**Rubric**: Good answers mention channel cost, work-vs-overhead ratio, and suggest batching.

---

## Q7 (S): When does `sync.RWMutex` lose to `sync.Mutex`?

**Short**: When the critical section is short (under ~100 ns) — RWMutex has higher per-op overhead than Mutex, and reader-parallelism doesn't recover the cost.

**Extended**: `sync.RWMutex` is sometimes promoted as "faster for read-heavy workloads," but its per-op cost is higher than `sync.Mutex` because it tracks reader counts atomically. If your critical section is short — say, a map lookup — the per-op overhead exceeds the gain from reader parallelism. Mutex wins for short reads; RWMutex wins for long reads with many concurrent readers.

**Rubric**: Good answers mention per-op overhead, reader-parallelism trade-off, and the "short reads" pitfall.

---

## Q8 (M): What is `sync.Pool` and when is it the wrong choice?

**Short**: A pool of reusable objects. Wrong when objects are tiny (allocation is cheaper than pool overhead) or when GC pressure isn't the bottleneck.

**Extended**: `sync.Pool` is designed to reduce GC pressure by reusing heavy objects (e.g. 4 KB buffers, complex structs). Each Get/Put has overhead (~30 ns). If the object you're pooling is smaller than ~256 bytes, the allocator is faster than the pool. Also, `sync.Pool` is not a cache: items can be evicted by the runtime at any time, so don't rely on them persisting.

**Rubric**: Good answers mention pool overhead, GC pressure motivation, and the eviction semantics.

---

## Q9 (S): A profile shows 8% of CPU in `sync.(*Mutex).Lock`. What do you do?

**Short**: Investigate the contended mutex; consider shrinking the critical section, sharding, or replacing with atomic operations.

**Extended**: 8% is significant. First, identify the mutex (via the profile call stack). Then consider:
1. Can the critical section be shrunk? (Move read-only work outside.)
2. Can the mutex be sharded? (One per N partitions.)
3. Can it be replaced with `atomic` for simple state?
4. Can the data be made read-mostly with copy-on-write?

Try the smallest change first and re-profile.

**Rubric**: Good answers list 3-4 options, mention iterative approach, and emphasize re-profiling.

---

## Q10 (M): How do you decide between scaling horizontally vs adding goroutines?

**Short**: Add goroutines for parallelizable work within a request; scale horizontally for more total throughput across requests.

**Extended**: Goroutines help when there's CPU on the current instance and a single request has parallelizable work (e.g. fan-out to multiple services). Horizontal scaling helps when each request is small and the issue is total request rate. Goroutines add code complexity; horizontal scaling adds operational complexity. Choose based on whether the bottleneck is single-request latency or aggregate throughput.

**Rubric**: Good answers distinguish per-request vs aggregate, mention complexity trade-offs, and give an example.

---

## Q11 (S): What does it mean when a benchmark shows 2× speedup on a laptop but 0.7× regression in production?

**Short**: The benchmark didn't match production conditions — likely different CPU counts, cache sizes, or load patterns.

**Extended**: Laptops have many cores, fast disk, plentiful memory. Production pods often have 2-4 CPUs, slow networked disk, tight memory. A parallel design that wins on 8 cores may lose on 2 cores because the scheduler overhead becomes proportionally larger. Always benchmark in an environment that matches production, or at least at production's `-cpu=N`.

**Rubric**: Good answers identify environment mismatch, mention `-cpu` flag, and suggest matching the benchmark environment.

---

## Q12 (J): Why is `time.After` sometimes problematic in long-running select loops?

**Short**: Each call allocates a new timer; if the other case fires often, the timers accumulate before they fire.

**Extended**: `time.After(d)` returns a channel; the underlying timer is held in memory until it fires. In a loop like `for { select { case <-ch: ...; case <-time.After(d): ... } }`, if `ch` fires many times, you create many timers, each held for `d` until firing. Memory grows. Fix: use `time.NewTimer` with `Reset`.

**Rubric**: Good answers identify the timer leak and suggest NewTimer/Reset.

---

## Q13 (S): How would you investigate "service is slow"?

**Short**: Grab a CPU profile, identify top consumers; grab a goroutine dump, look for stuck goroutines; check recent deploys.

**Extended**: A structured approach:
1. Confirm the SLO violation in metrics.
2. Check for recent deploys (potential regression).
3. Grab live profiles: CPU, goroutine, heap.
4. Inspect top consumers.
5. If goroutine count is growing, look for a leak.
6. If mutex profile shows contention, identify the hot lock.
7. If GC time is high, look at allocation profile.
8. Propose targeted fix; deploy; re-measure.

**Rubric**: Good answers describe a structured approach, mention multiple profile types, and emphasize re-measuring.

---

## Q14 (M): A team proposes a custom lock-free queue. What questions do you ask?

**Short**: What's the throughput requirement? What does the standard library's contention look like? Who maintains it?

**Extended**: Lock-free is rarely faster than `chan` or mutex-protected slices in Go for typical workloads. Questions:
1. What is the measured throughput today?
2. What's the requirement?
3. Has stdlib been benchmarked against your workload?
4. What's the contention profile of the current solution?
5. Who can maintain the lock-free code?
6. What if we sharded instead?

Lock-free is usually a premature optimization unless there's specific evidence it's needed.

**Rubric**: Good answers list specific questions, express skepticism, and propose simpler alternatives.

---

## Q15 (S): What is the goroutine context switch cost?

**Short**: About 200 ns on the same P; longer if work is stolen across Ps.

**Extended**: A goroutine context switch is much cheaper than an OS thread switch because there's no kernel involvement. The Go scheduler saves and restores a small set of registers. On x86_64 with Go 1.22, a same-P switch is ~150-250 ns. A cross-P switch is more expensive due to cache misses on the new core. For short-running goroutines, context switching can dominate the actual work.

**Rubric**: Good answers cite the rough number, explain the no-kernel aspect, and note cache effects.

---

## Q16 (M): When is parallelizing a `for` loop a bad idea?

**Short**: When per-iteration work is small (<1 µs), when iterations depend on each other, or when iteration count is small.

**Extended**: Three bad cases:
1. **Small per-iteration work**: goroutine overhead dominates.
2. **Dependencies between iterations**: parallelism would require coordination that exceeds the savings.
3. **Small total iterations**: not enough work to amortize the setup.

Rule of thumb: if total work is under 10 ms, sequential is almost always better.

**Rubric**: Good answers list multiple cases and give rough thresholds.

---

## Q17 (S): Explain Karp-Flatt metric.

**Short**: A metric for diagnosing real parallel systems: experimentally measured serial fraction from observed speedup.

**Extended**: Karp-Flatt: `e = (1/speedup - 1/N) / (1 - 1/N)`. Compute it from measured `speedup` and `N` cores. If `e` is roughly constant as N grows, you have a fixed serial fraction. If `e` grows with N, you have a synchronization bottleneck (e.g. contention) that worsens with concurrency. Useful for distinguishing between "we need to remove a serial step" and "we need to fix contention."

**Rubric**: Good answers give the formula, explain what growth in `e` means, and use it diagnostically.

---

## Q18 (J): What's a goroutine leak?

**Short**: A goroutine that should have exited but didn't, holding memory indefinitely.

**Extended**: Common causes:
1. Blocked on a channel that's never closed.
2. Stuck in an infinite loop without exit condition.
3. Waiting for a result that's never sent.

Symptoms: growing goroutine count, growing memory. Diagnose with `/debug/pprof/goroutine?debug=2`. Each leaked goroutine holds at least 2 KB of stack plus any captured state.

**Rubric**: Good answers identify the symptom, list causes, and mention pprof goroutine endpoint.

---

## Q19 (S): How does GC interact with goroutine count?

**Short**: More goroutines often mean more allocations and larger heaps, leading to more frequent and longer GC pauses.

**Extended**: GC's work scales with heap size and allocation rate. More goroutines doing parallel work multiplies allocation rate. Per-goroutine state grows the heap. Both trigger GC more often. Also, GC scans goroutine stacks during marking — more goroutines mean more stack scanning. A service that scales from 100 to 1M goroutines often sees GC become a dominant cost.

**Rubric**: Good answers mention allocation rate, heap size, stack scanning, and offer tuning options.

---

## Q20 (M): What does `GOMAXPROCS` control?

**Short**: The number of Ps (logical schedulers), bounding how many goroutines can execute in parallel.

**Extended**: `GOMAXPROCS` is the parallelism bound — the maximum number of goroutines executing simultaneously. It does *not* limit total goroutine count. Default is `NumCPU()` (or cgroup-aware in Go 1.22+). Setting it higher than core count adds overhead without parallelism. Setting it lower limits parallelism (sometimes useful for debugging or for shared environments).

**Rubric**: Good answers distinguish parallelism from concurrency, mention the default, and discuss container environments.

---

## Q21 (P): A change cuts $/req by 5%. The service runs at 10B req/mo. The change adds 500 lines of concurrent code. Worth merging?

**Short**: Calculate: 5% × cost = savings; compare to engineering and maintenance cost. Often not worth it for small percent savings if complexity is high.

**Extended**: Assume baseline cost is $10K/mo: 5% = $500/mo savings. Engineering cost: 500 lines of concurrent code is ~2 engineer-weeks plus ongoing maintenance burden (bugs, code review, onboarding). Pay-back in dollars might be a year; pay-back in engineer time savings is harder to measure. The decision depends on whether complexity is well-justified by the workload, or whether a simpler change would have achieved most of the savings.

**Rubric**: Good answers do the math, factor in maintenance cost, and propose alternatives.

---

## Q22 (S): How would you read a CPU profile to identify scheduler overhead?

**Short**: Look for `runtime.findrunnable`, `runtime.schedule`, `runtime.gopark` totaling >5% of CPU.

**Extended**: Healthy programs show 1-3% in scheduler internals. Above 5% suggests too much scheduler work: too many short-lived goroutines, too many channel hops, too small batches, or excessive contention. The fix is usually to reduce goroutine churn — batching, using a worker pool, or skipping concurrency for small workloads.

**Rubric**: Good answers cite specific runtime functions and propose fixes.

---

## Q23 (M): When is `atomic.Int64` faster than a `sync.Mutex` + plain `int64`?

**Short**: For single-counter increments under low to moderate contention.

**Extended**: `atomic.Int64.Add` is ~5 ns uncontended; under high contention with many cores, it's 30-100 ns due to cache-line bouncing. A `sync.Mutex.Lock` is ~10 ns uncontended; contended it can park (~1 µs). For simple counters, atomic wins. For multiple coordinated updates (increment count + update timestamp), mutex wins because the operations are batched under one lock.

**Rubric**: Good answers give numbers, mention the trade-off at high contention, and note when mutex's batched protection wins.

---

## Q24 (S): What is hedged execution and when does it help?

**Short**: Firing a duplicate request after a short delay; using whichever completes first to reduce tail latency.

**Extended**: Hedging is used when a downstream has acceptable median latency but unreliable tail. Send a request, wait 20-50 ms; if no response, send a second request to a different replica. Take the first to return. This trades 1.x backend load for dramatically improved p99 latency. Useful for read paths where idempotency is easy.

**Rubric**: Good answers explain the technique, mention the trade-off (extra load), and identify when it's applicable.

---

## Q25 (P): When is removing concurrency the right optimization?

**Short**: When the concurrency isn't paying for itself in throughput or latency but is paying in complexity.

**Extended**: Common scenarios:
1. The concurrency was added speculatively without measurement.
2. Production load patterns differ from benchmarks; concurrency loses in production.
3. The work has become smaller (faster CPU, better algorithm); the parallel cost now exceeds the gain.
4. Simpler sequential code with better locality outperforms the concurrent version.

Reverting concurrency saves complexity, often improves performance, reduces bugs, and speeds onboarding.

**Rubric**: Good answers identify scenarios, mention complexity cost, and have examples.

---

## Q26 (J): What does `b.ResetTimer()` do in a benchmark?

**Short**: Resets the timer to exclude setup work from the measurement.

**Extended**: `go test -bench` runs the body of the benchmark `b.N` times, measuring total time. Any setup (e.g. allocating test data) before the loop counts toward the time unless `b.ResetTimer()` is called. After reset, only the post-reset code is timed. Always reset after expensive setup; otherwise the benchmark conflates setup with the work being measured.

**Rubric**: Good answers identify the purpose and give an example use case.

---

## Q27 (S): What is `b.RunParallel`?

**Short**: A way to run a benchmark body from multiple goroutines simultaneously.

**Extended**: `b.RunParallel(func(pb *testing.PB) { for pb.Next() { ... } })` distributes iterations across `GOMAXPROCS` goroutines (or `SetParallelism` × GOMAXPROCS). Useful for measuring contention or per-op cost under realistic concurrent load. The body should not store state outside the loop unless protected, since multiple goroutines run it.

**Rubric**: Good answers describe the mechanic, mention `SetParallelism`, and note thread-safety requirements.

---

## Q28 (M): What is backpressure?

**Short**: A signaling mechanism for downstream to tell upstream to slow down.

**Extended**: When downstream can't keep up, blind upstream production leads to queue growth, memory exhaustion, and eventual collapse. Backpressure signals "slow down" — typically by blocking sends on a bounded channel, returning 503 errors at HTTP ingress, or applying explicit rate limits. Healthy systems propagate backpressure end-to-end; unhealthy ones hide it in big buffers.

**Rubric**: Good answers explain the concept, give a Go-specific example, and identify failure modes when missing.

---

## Q29 (S): A team's parallel implementation is slower than sequential. List 5 possible causes.

**Short**: (1) Per-item work too small, (2) false sharing, (3) coordination cost dominates, (4) memory-bound bottleneck, (5) GC pressure from per-goroutine state.

**Extended**:
1. Per-item work < goroutine overhead.
2. False sharing on shared structs.
3. Channel/mutex coordination on every item.
4. Memory bandwidth saturated; more cores don't help.
5. Per-goroutine allocations multiply GC work.
6. Bonus: scheduler overhead at high goroutine count.
7. Bonus: contention on a downstream bottleneck (DB, file).

**Rubric**: Good answers list multiple causes and can explain each.

---

## Q30 (P): How do you decide on a worker pool size?

**Short**: Bench across sizes (1, 2, 4, 8, ...) until throughput stops increasing; use that or one below.

**Extended**: Approach:
1. For CPU-bound, start with `runtime.GOMAXPROCS(0)`.
2. For I/O-bound, try larger (10×, 100× cores) since goroutines are cheap when blocked.
3. Benchmark across sizes; plot throughput vs pool size.
4. Pick the smallest size where throughput is acceptable (smaller pools have lower latency variance).

In production, expose the pool size as configuration; default reasonable, allow ops to tune.

**Rubric**: Good answers distinguish CPU/IO, suggest benching, and mention configurability.

---

## Q31 (M): What is `errgroup.SetLimit` and when do you use it?

**Short**: A setting that bounds the number of concurrently-running goroutines in an errgroup.

**Extended**: `errgroup.SetLimit(N)` blocks subsequent `Go` calls until existing goroutines complete. This is the canonical way to bound fan-out concurrency in Go. Use it for I/O fan-out (e.g. fetch from many backends) to prevent overload. For CPU work, set to `runtime.GOMAXPROCS(0)`; for I/O work, often higher.

**Rubric**: Good answers identify the use case, give defaults, and mention the alternative (manual semaphores).

---

## Q32 (S): When should you use `runtime.LockOSThread`?

**Short**: Rarely; for thread-local state in C libraries, signal handlers, or platform-specific APIs.

**Extended**: `runtime.LockOSThread()` pins a goroutine to a specific OS thread, preventing it from being migrated. It's required when calling C libraries that use thread-local storage (e.g. OpenGL contexts, some database drivers). It's almost never useful for performance in pure Go because the Go scheduler is more flexible than thread pinning. Misuse can cause goroutine leaks if not paired with `UnlockOSThread`.

**Rubric**: Good answers identify legitimate use cases and warn against perf-driven use.

---

## Q33 (P): A service is using 4× more CPU than expected. Walk through your debugging.

**Short**: Grab CPU profile; identify hot functions; check allocation profile; check goroutine count.

**Extended**:
1. Confirm current CPU usage via metrics.
2. Grab CPU profile (`/debug/pprof/profile?seconds=30`).
3. Look at top consumers. Are they expected?
4. If `runtime.gcDrain*` is high, GC is consuming; grab heap profile.
5. If `runtime.findrunnable` is high, scheduler is busy; check goroutine count.
6. If a specific function is hot, drill into it (`list` in pprof).
7. Hypothesize, change one thing, re-profile.

The discipline is methodical; CPU usage has many possible causes.

**Rubric**: Good answers describe a methodical process and identify multiple potential causes.

---

## Q34 (S): A junior engineer wants to add `sync.Pool` for `[]byte` allocations. What do you ask?

**Short**: How big are the buffers? What's the allocation rate? What's the GC cost today?

**Extended**: `sync.Pool` helps for objects above ~256 bytes when allocation rate is high and GC pressure is measurable. Questions:
1. Size of typical buffer? (Small = not worth it.)
2. Current allocation rate?
3. Current GC CPU share? (Below 5% = not worth optimizing.)
4. Have you benchmarked a representative workload?
5. Are there race-free returns to the pool?
6. What's the worst-case pool size memory cost?

Often the simpler answer is `bytes.Buffer` pooling or just letting the GC do its job.

**Rubric**: Good answers ask diagnostic questions before approving.

---

## Q35 (P): You inherit a service with extensive premature optimization. How do you prioritize what to remove?

**Short**: Audit each; pick low-risk wins first; build benchmark/profile evidence; remove with clear revert paths.

**Extended**: Strategy:
1. Inventory: list every "optimization" (sharded maps, sync.Pool, custom queues, lock-free attempts).
2. Audit: for each, find the original justification (commit message, RFC). If none, mark suspect.
3. Benchmark: write a simpler alternative; compare.
4. Prioritize: start with the simplest reverts that show clear simplification.
5. Communicate: PR description includes data and "we're removing X because evidence shows simpler is faster."
6. Deploy: canary first; observe SLOs.
7. Iterate: build confidence; tackle harder cases.
8. Document: leave notes for future engineers about why X is gone.

Over a year, this transforms the codebase.

**Rubric**: Good answers describe a multi-step plan, emphasize evidence, and mention socializing the change.

---

## Bonus questions

### Q36 (M): What's the cost of `defer` in a hot path?

About 20-50 ns per call (Go 1.14+). Usually irrelevant; in extreme hot paths it matters. Only remove `defer` if profiling shows it; keeping it is usually the right call for safety.

### Q37 (S): When does `singleflight` help?

For dedup'ing concurrent identical requests to expensive computations (cache fills, expensive API calls). Prevents thundering herd on cache expiry.

### Q38 (P): What is per-CPU sharding?

A pattern using `runtime.GOMAXPROCS(0)` shards, indexed by goroutine ID, to eliminate cross-core contention. Useful for high-throughput counters or accumulators. Less common in Go than in C/C++ due to scheduler indirection.

### Q39 (M): What's the difference between p50 and p99 latency?

p50 (median) is the typical request's latency. p99 is the 99th percentile — 1% of requests take longer than this. SLOs are usually on p99 or p99.9 because users notice slow requests, not average ones. Concurrency typically improves p50 (more requests in flight) but can worsen p99 (stragglers, GC, contention spikes).

### Q40 (P): Walk through how you'd build a perf review process.

Format: a doc with goal, baseline, evidence, alternatives, decision. A small committee reviews. Decisions tracked. Quarterly retros on what shipped/failed. The aim is making good decisions, not gatekeeping; the process is lightweight, focused on evidence.

---

## End

These 40 questions cover the spectrum of premature concurrency optimization topics. Use them for:

- Self-assessment before interviewing.
- Question banks for interviews you conduct.
- Discussion topics in study groups.
- Onboarding new engineers.

Answers should match the rubric, not just the short version. A candidate who recites the short answer without the reasoning may have memorized; one who explains the rubric understands.

Good luck.
