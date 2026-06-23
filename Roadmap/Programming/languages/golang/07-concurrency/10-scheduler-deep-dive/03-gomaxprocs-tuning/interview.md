# `GOMAXPROCS` — Interview Questions

A staged set of questions from junior to staff level. Each comes with an expected answer and a follow-up to probe depth. Use these for self-review or as a foundation for technical interviews.

---

## Junior Level

### Q1. What does `GOMAXPROCS` control?

**Expected answer.** It sets the maximum number of OS threads that may execute user-level Go code simultaneously. Equivalently, it is the number of `P` structs the runtime allocates.

**Follow-up.** "What is the relationship between `GOMAXPROCS` and the total thread count?" — answer: total threads can exceed `GOMAXPROCS` because threads parked in syscalls or cgo do not count against the parallelism cap. `GOMAXPROCS` only bounds the number running Go code at any instant.

---

### Q2. What is the default value of `GOMAXPROCS` since Go 1.5?

**Expected answer.** `runtime.NumCPU()`. Before 1.5 the default was 1.

**Follow-up.** "Why did the Go team change the default?" — because eight years of experience showed almost everyone wanted parallelism by default and the cost of opting back into sequential execution is trivial.

---

### Q3. How do you read the current `GOMAXPROCS` from Go code?

**Expected answer.** `runtime.GOMAXPROCS(0)`. Passing `0` returns the current value without changing it.

**Follow-up.** "What does `runtime.GOMAXPROCS(8)` return?" — the **previous** value, not 8.

---

### Q4. How can you set `GOMAXPROCS` without recompiling the program?

**Expected answer.** Set the `GOMAXPROCS` environment variable. Read by the runtime at startup.

**Follow-up.** "What happens if `GOMAXPROCS=0` is set in the environment?" — it is treated as unset; the runtime uses the default.

---

### Q5. What is the difference between `GOMAXPROCS` and the number of goroutines?

**Expected answer.** `GOMAXPROCS` is the parallelism cap — at most that many cores running Go code. Goroutines are the units of work; there can be millions. They are multiplexed onto the `GOMAXPROCS` Ps.

**Follow-up.** "Should I limit goroutine spawn to `GOMAXPROCS`?" — no. Spawn as many goroutines as your problem has. Limit them by other means (worker pools, semaphores) if memory or queue depth matters.

---

## Middle Level

### Q6. Why is hard-coding `runtime.GOMAXPROCS(64)` in source typically a bug?

**Expected answer.** The fixed value travels between environments. In a container with `cpu: 1` limit, `GOMAXPROCS=64` causes CFS throttling — the kernel pauses the process whenever it exceeds the quota. Throughput drops, p99 latency spikes.

**Follow-up.** "How do you fix this without recompiling?" — set `GOMAXPROCS` env var to override, or import `go.uber.org/automaxprocs` which reads the cgroup at init time.

---

### Q7. When did Go's runtime start respecting cgroup CPU quotas?

**Expected answer.** Go 1.16 added cgroup v1 quota detection on Linux. Go 1.18 added cgroup v2. On older Go versions, the runtime ignores the quota and uses the node CPU count.

**Follow-up.** "How would you detect at runtime whether your Go version is cgroup-aware?" — compare `runtime.NumCPU()` with the cgroup file content. If they match the quota, you are running on a cgroup-aware Go.

---

### Q8. Describe a scenario where `GOMAXPROCS < NumCPU` is the right choice.

**Expected answer.** Several:

- Co-tenancy: multiple Go services share a machine. Each capped at a fraction of the cores.
- Latency-critical work: leaving headroom for GC mark workers and OS interrupts can reduce tail latency.
- NUMA boxes: one process per socket, each with `GOMAXPROCS = cores per socket`.
- Power-constrained environments where saturating all cores is undesirable.

**Follow-up.** "How much lower? `NumCPU - 1` or smaller?" — depends on workload. For tail-latency tuning, `NumCPU - 1` is typical. For NUMA, the socket count.

---

### Q9. What does `GODEBUG=schedtrace=1000` print?

**Expected answer.** Once per 1 000 ms, a line summarising scheduler state: `gomaxprocs`, `idleprocs` (Ps with no work), `threads` (total OS threads), `spinningthreads` (Ms scanning for work), `idlethreads` (Ms in the parked pool), `runqueue` (global runqueue depth), and per-P local runqueue depths.

**Follow-up.** "If `idleprocs=0` and `runqueue > 0` repeatedly, what does that mean?" — the scheduler is saturated. Either too few Ps for the load, or too much CPU work overall.

---

### Q10. What is `automaxprocs` and when do you need it?

**Expected answer.** A library (`go.uber.org/automaxprocs`) that reads the cgroup CPU quota at init time and sets `runtime.GOMAXPROCS` accordingly. Needed when running on older Go (< 1.18 for cgroup v2) or in environments where the built-in detection is incomplete. Even on recent Go, some teams keep it for the explicit startup log line.

**Follow-up.** "What does its `init()` print on success?" — something like `maxprocs: Updating GOMAXPROCS=1: determined from CPU quota`. The log line is invaluable for ops.

---

## Senior Level

### Q11. Explain the relationship between `GOMAXPROCS` and CFS throttling.

**Expected answer.** Linux CFS uses a quota-period model: every `period` (default 100 ms), the process is allowed at most `quota` µs of CPU. If `GOMAXPROCS > ceil(quota/period)`, the runtime schedules goroutines onto more Ps than the kernel will allow concurrent CPU on. The kernel throttles the process — pauses it until the next period. From inside Go, this looks like random multi-ms stalls. The fix is to align `GOMAXPROCS` with the quota.

**Follow-up.** "Why does the Go scheduler not know about throttling?" — the kernel does not notify userspace; it just stops scheduling threads. Go has no way to observe it directly.

---

### Q12. Why is the netpoller relevant when sizing `GOMAXPROCS` for an HTTP service?

**Expected answer.** Goroutines waiting on network I/O do not hold a P — the netpoller parks them. So an HTTP service with 10 000 concurrent idle connections costs 10 000 goroutines and zero Ps. The Ps are free to run the CPU portion of active requests. As a result, I/O-bound services can run with very small `GOMAXPROCS` and still serve large concurrency. Only the per-request CPU work counts against `GOMAXPROCS`.

**Follow-up.** "Is this also true for blocking file I/O on regular files?" — no. Linux `epoll` does not work on regular files; the netpoller falls back to a blocking syscall path that does hold an M (though not a P, after the handoff). Thread count grows under heavy file I/O.

---

### Q13. What is `procresize` and what is its cost?

**Expected answer.** `procresize(nprocs)` is the internal runtime function that changes the number of Ps. Called from `runtime.GOMAXPROCS` (and a few other places, like resuming from a STW GC cycle). It runs **under stop-the-world**: it allocates new Ps if growing, drains and destroys Ps if shrinking (migrating runqueues, timers, caches), and updates the `gomaxprocs` global.

Cost: typically tens to hundreds of microseconds. Frequent calls (e.g., from an autoscaler loop) produce continuous latency penalty.

**Follow-up.** "Why must it be STW?" — `allp` is read lock-free by hot scheduler paths. Mutation requires no concurrent readers, which STW guarantees.

---

### Q14. How would you design a fleet-level policy to prevent `GOMAXPROCS` misconfiguration?

**Expected answer.** Several rules together:

1. Mandate Go ≥ 1.18 on Linux containers, or `automaxprocs`.
2. Export `process_gomaxprocs` as a Prometheus metric.
3. Alert on `container_cpu_cfs_throttled_seconds_total` non-zero.
4. Require per-container CPU limits in admission policy.
5. Lint for `runtime.GOMAXPROCS(N)` calls in source; require a comment with benchmark justification.
6. Log `GOMAXPROCS` at startup in every service.
7. Sweep benchmarks in CI for any service whose CPU profile changes meaningfully.

**Follow-up.** "What is the failure mode if rule 4 is violated?" — pods can absorb CPU from neighbours; one bad pod degrades the whole node.

---

### Q15. What is the trade-off between `GOMAXPROCS` and `GOGC`?

**Expected answer.** Both influence tail latency but through different mechanisms.

- Higher `GOMAXPROCS` (up to `NumCPU`) provides more parallelism for application work and for GC mark workers. Reduces queue depth on burst; improves p99.
- Higher `GOGC` (e.g., 200 instead of 100) makes GC less frequent, larger heap, less mark work overall. Reduces GC pause frequency; can improve p99 at memory cost.
- Both at maximum is not optimal: GC overhead grows with parallelism; eventually the gain from more Ps is eaten by GC mark work.

The right approach: tune `GOGC` first (allocation pressure is usually the root cause of tail latency), then `GOMAXPROCS`, then measure.

**Follow-up.** "What about `GOMEMLIMIT`?" — a Go 1.19+ knob that imposes a soft memory cap. The GC works backwards from the cap, running more or less aggressively to stay within it. Use it to bound memory while gaining the latency benefits of high `GOGC`.

---

## Staff Level

### Q16. Compare Go's `GOMAXPROCS` to Java's `availableProcessors()` and Tokio's `worker_threads`.

**Expected answer.**

- **Go.** Single global parallelism cap. Cgroup-aware default since 1.16/1.18. Resize is STW.
- **Java.** `Runtime.availableProcessors()` is one input; many pools (`ForkJoinPool.commonPool`, executors) size from it. Cgroup-aware since JDK 8u191 / JDK 10. Pool resizing typically does not STW.
- **Tokio.** `worker_threads(n)` on the runtime builder. Default = `num_cpus::get()`, which is **not** cgroup-aware by default; container deployments must opt in. No runtime resize; create a new runtime.

The pattern: Go and recent Java have safe defaults; Tokio leaves it to the user.

**Follow-up.** "Which model is more flexible?" — Java's (multiple independent pools). Which is simpler to operate? Go's (single knob). Both have valid use cases.

---

### Q17. A service runs on a 64-core box; one process, `GOMAXPROCS=64`. Throughput plateaus at ~50% of expected scaling. What do you investigate?

**Expected answer.** Possible causes, in order of likelihood:

1. **NUMA traffic.** Multi-socket box; goroutines and their data are split across sockets, causing cross-socket cache misses. Diagnose with `numastat -p <pid>`; fix with multiple processes pinned to sockets.
2. **Memory bandwidth saturation.** Both sockets fight for shared memory bandwidth. Profile with `perf`; reduce allocation rate.
3. **Lock contention.** A central data structure in your code. Profile with `pprof block` or `pprof mutex`.
4. **GC overhead.** With 64 Ps doing concurrent mark, GC overhead may be significant. Tune `GOGC`.
5. **Scheduler overhead.** Spinning threads, work-stealing scans, idle-P management. Reduce `GOMAXPROCS` if it is above `NumCPU` (unlikely with 64 = `NumCPU`).

**Follow-up.** "What is the typical NUMA penalty?" — 1.5× to 2× slower for remote-socket memory access. For memory-heavy workloads, overall throughput degrades 20–40%.

---

### Q18. Describe an end-to-end production incident caused by mis-tuned `GOMAXPROCS`. What did you learn?

**Expected answer.** A common scenario:

- Service deployed on Go 1.15 into Kubernetes with `cpu: 1` limit. Node has 64 cores. `GOMAXPROCS = 64` (no cgroup detection on 1.15).
- Service runs fine in low load — only a few Ps actually used.
- Burst arrives. Service spawns goroutines across all 64 Ps. CFS throttles aggressively.
- p99 latency spikes from 5 ms to 500 ms.
- Logs show no error, just slow request handling. Engineers chase phantom DB issues for hours.

Resolution: upgrade Go to 1.18, or add `automaxprocs`. Add `process_gomaxprocs` metric and CFS throttle alert.

**Lessons:**

- Mandate cgroup-aware runtime versions.
- Always log `GOMAXPROCS` at startup.
- Alert on throttle metrics.
- Run sweep benchmarks before each release.

**Follow-up.** "If you only had time to do one thing, what would it be?" — log `GOMAXPROCS` at startup. That single line catches 80% of these incidents.

---

### Q19. How would you implement a workload-aware `GOMAXPROCS` controller? What are the risks?

**Expected answer.** Sketch:

- A controller goroutine wakes every 30 seconds.
- Reads scheduler latency p99 from `runtime/metrics` `/sched/latencies:seconds`.
- Reads CFS throttle rate from `/sys/fs/cgroup/cpu.stat`.
- If throttling > threshold, decrement `GOMAXPROCS`.
- If scheduler p99 > threshold and not throttled, increment up to `NumCPU`.
- Hysteresis: at least 2 minutes between adjustments.

**Risks:**

- Each `runtime.GOMAXPROCS(n)` call is STW. Frequent adjustments add latency.
- Wrong signals: bursty workload can cause flapping.
- Cannot scale past cgroup quota.
- Adds operational complexity for marginal gain.

**Recommendation.** Set `GOMAXPROCS` statically based on the cgroup quota. Manage capacity at the Kubernetes / HPA layer, not in the Go runtime.

**Follow-up.** "When is the controller worthwhile?" — extreme dynamic workloads where static sizing leaves significant performance on the table. Very rare.

---

### Q20. The Go runtime's cgroup detection runs once at startup. If a Kubernetes admin resizes a pod's CPU limit at runtime, the `GOMAXPROCS` is stale. How would you handle this?

**Expected answer.** Three options:

1. **Restart the pod** on quota change. Cleanest; orchestrator restart is cheap.
2. **Implement a re-read loop** in user code. Periodically read `cpu.max`, recompute the right value, call `runtime.GOMAXPROCS`. Costs STW per change.
3. **Sidecar pattern.** A small process watches the cgroup file and triggers a graceful restart of the main process on change.

In practice, option 1 is universal. Option 2 is only needed for very long-running processes where restart is expensive.

**Follow-up.** "Can you watch the cgroup file with `inotify`?" — yes, the file is in a regular filesystem and inotify works. But the simple polling approach is usually enough.

---

## Wrap-Up

The depth of these questions roughly maps to:

- **Junior:** What it is, default value, how to read/set.
- **Middle:** Containers, cgroups, automaxprocs, schedtrace.
- **Senior:** CFS throttling, NUMA, GOGC trade-offs, fleet policy.
- **Staff:** Cross-runtime comparison, incident analysis, autoscaler design, edge cases.

A candidate who fluently answers up to Q15 is comfortable operating Go services in containers. Q16 onward separates engineers who have read the runtime source from those who have not.
