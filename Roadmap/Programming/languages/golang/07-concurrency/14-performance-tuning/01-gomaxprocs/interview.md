# `GOMAXPROCS` — Interview Questions (Performance Focus)

> A collection of interview questions grouped by level. Each carries a model answer in the depth a strong candidate would give. Mechanics questions will appear in the planned `10-scheduler-deep-dive/03-gomaxprocs-tuning` chapter (coming soon); here we focus on tuning, measurement, and production.

---

## Junior-Level Questions

### Q1. Your Go service runs in a Kubernetes pod with `cpu: 4`. The node has 64 CPUs. What is `GOMAXPROCS` set to by default, and why does it matter?

**Model answer.** On Go 1.18+ on Linux, the runtime reads the cgroup CPU quota and computes `GOMAXPROCS = ceil(quota/period) = 4`. On Go < 1.16 (and 1.16–1.17 on cgroup v2 systems), `GOMAXPROCS` defaults to `runtime.NumCPU()`, which returns the host CPU count, 64. This matters because 64 `P`s on a 4-CPU quota means the runtime tries to run 64 parallel Go threads; the kernel throttles them via CFS; p99 latency spikes; throughput collapses. Fix on old Go: import `go.uber.org/automaxprocs`.

### Q2. Should I set `GOMAXPROCS` higher than `NumCPU` for an I/O-bound service?

**Model answer.** No. Go's netpoller frees the `P` while a goroutine waits on I/O — the parked goroutine does not consume a `P`. So extra `P`s do not help with I/O concurrency. The right value is still `GOMAXPROCS = NumCPU` (the cgroup-aware count). Adding more `P`s only adds scheduling overhead, cross-P stealing, and spinning.

### Q3. How do you check the current `GOMAXPROCS` value?

**Model answer.** `runtime.GOMAXPROCS(0)` reads the current value. The runtime treats `n = 0` as a no-op set and returns the previous value. Log this at startup for production visibility.

### Q4. You are seeing high p99 on a service. The CPU graph shows 40% utilisation. Is `GOMAXPROCS` likely the cause?

**Model answer.** Possibly. Low utilisation with high p99 is consistent with CFS throttling: the process is paused at the cgroup boundary, so utilisation looks low while latency spikes. Check `container_cpu_cfs_throttled_periods_total` or `/sys/fs/cgroup/cpu.stat`. If throttling is occurring, the cause is `GOMAXPROCS > cgroup quota` or genuine quota under-sizing.

### Q5. What does `automaxprocs` do that the Go runtime does not?

**Model answer.** On modern Go (1.18+ Linux) the runtime *does* read cgroup quotas. `automaxprocs` adds: (a) a startup log line documenting the resolved value, (b) handling of edge cases in custom container runtimes, (c) consistent behaviour across the Go versions in a mixed fleet. Many teams keep it just for the log line.

### Q6. Why is `GOMAXPROCS = 1` a useful debugging value?

**Model answer.** With `GOMAXPROCS = 1`, only one goroutine runs Go code at a time. This makes data races deterministic (or at least reproducible) and removes parallelism as a variable. It does not remove concurrency — goroutines still interleave. Useful for isolating a bug, never for production.

---

## Middle-Level Questions

### Q7. Describe a `GOMAXPROCS` sweep methodology.

**Model answer.** Pick a set of values, typically `{1, 2, 4, 8, NumCPU, 2×NumCPU}`. For each value: start the service with that `GOMAXPROCS`, drive sustained load with a tool like `wrk` for 20+ seconds after a warmup, capture throughput and p50/p95/p99 latency. Repeat each setting 3+ times; report median. Plot throughput and p99 vs `GOMAXPROCS`. Choose the value that maximises throughput subject to the latency SLO. Run on hardware representative of production, ideally with the load generator on a separate machine.

### Q8. What is the shape of the throughput curve for a CPU-bound Go workload as `GOMAXPROCS` varies from 1 to 2×NumCPU?

**Model answer.** Monotonic increase to a peak at or near `NumCPU`, then a plateau or slight regression beyond. The increase is sub-linear due to Amdahl effects (allocator, GC, runtime overhead). The regression past `NumCPU` is small (a few percent) and is caused by additional scheduling overhead from `P`s that have no core to run on.

### Q9. What is the shape of the latency curve?

**Model answer.** At `GOMAXPROCS = 1`, latency is high due to queueing. As `GOMAXPROCS` rises, latency drops sharply because requests are served in parallel rather than queued. The drop continues until `GOMAXPROCS ≈ NumCPU`. Beyond that, latency *rises* again — modestly — because more `P`s mean more cross-P stealing, more spinning, and more contention on shared runtime state. p99 is more sensitive to this than p50.

### Q10. Your sweep shows no effect — every `GOMAXPROCS` value produces the same throughput. What do you conclude?

**Model answer.** The service is not CPU-bound, or the load is insufficient to saturate it. Likely bottlenecks: a downstream service, a database, a mutex, or memory bandwidth. The right action is to profile (CPU, mutex, allocator) and find the actual bottleneck — tuning `GOMAXPROCS` further is futile.

### Q11. A colleague suggests using `runtime.GOMAXPROCS(2 * runtime.NumCPU())` for an HTTP service. What do you say?

**Model answer.** Push back. There is no measurement supporting it. The netpoller handles I/O without consuming `P`s, so extra `P`s do not help concurrency. Extra `P`s add overhead (stealing, spinning, GC mark workers). Suggest a sweep before any constant value. If they insist, ask for the benchmark numbers.

### Q12. How do you detect CFS throttling from inside a Go process?

**Model answer.** Read `/sys/fs/cgroup/cpu.stat` (v2) or `cpu.stat` in v1's cpu controller path. The fields `nr_throttled` and `throttled_usec` show throttle count and wall-clock seconds lost. Poll periodically; emit as a metric. Alert when the throttled ratio exceeds ~1% over a 5-minute window. cAdvisor exposes the same data as `container_cpu_cfs_throttled_*` metrics.

### Q13. Explain the trade-off when pinning a Go service to one NUMA socket.

**Model answer.** You get better memory locality (faster L3/RAM access) and lower jitter, improving p99. You sacrifice the other socket's CPU, halving raw throughput per replica. Acceptable for latency-critical services where the SLO matters more than per-replica throughput; you compensate by running more replicas. To pin: `taskset --cpu-list <socket0 cpus> ./binary` and set `GOMAXPROCS = cores per socket`.

---

## Senior-Level Questions

### Q14. Design a fleet-wide policy for `GOMAXPROCS` across 50 services.

**Model answer.** Five rules: (1) every service emits `process_gomaxprocs` as a Prometheus gauge; (2) every pod manifest declares a `cpu` limit (enforce via admission policy); (3) all services on Go ≥ 1.22, or with `automaxprocs` imported; (4) `runtime.GOMAXPROCS(n)` in source requires a benchmark-justifying comment (lint); (5) CFS throttling alerts at 1% threshold. Periodic CI sweeps on hardware changes. The platform team owns enforcement; service teams own service-specific tuning.

### Q15. How would you alert on `GOMAXPROCS` misconfiguration?

**Model answer.** Three alerts: (A) `process_gomaxprocs > cpu.limit × 1.5` for any pod, catches over-provisioned runtimes; (B) CFS throttling ratio > 1% over 5 minutes, catches active throttling regardless of cause; (C) `process_gomaxprocs == 1` for services not expected to be single-threaded, catches forgotten debug values. Each alert has a runbook pointing to `kubectl describe pod` and the override path (`GOMAXPROCS` env var).

### Q16. Should you dynamically adjust `GOMAXPROCS` based on observed load?

**Model answer.** Generally no. The STW cost of `procresize` is small per call but cumulative; a naive feedback loop oscillates and pauses the process repeatedly. The right level of dynamism is the orchestrator (Kubernetes resizes the pod, the runtime reads the new quota). If in-process adjustment is required, rate-limit to one change per minute, bound to ±1 from baseline, and emit a metric for every change so operators can disable it.

### Q17. A latency-critical service has p99 = 8 ms target, current = 12 ms. Sweep shows: `GOMAXPROCS=NumCPU` peaks throughput; `GOMAXPROCS=NumCPU-2` cuts p99 to 7 ms with 15% throughput loss. What do you choose?

**Model answer.** Choose `GOMAXPROCS=NumCPU-2` and scale horizontally to recover throughput. The SLO violation costs more than 15% more replicas. Validate by computing replica count change: if current is 10 replicas, the new count is ~12. Confirm capacity (node count, budget). Roll out gradually, watching p99 and per-replica utilisation.

### Q18. How does `GOMAXPROCS` interact with the GC pacer?

**Model answer.** The runtime spawns up to `0.25 × GOMAXPROCS` dedicated mark workers during a GC mark phase. More `P`s = more parallel marking = faster GC, but mark workers reduce mutator throughput proportionally. Allocation rate scales with `GOMAXPROCS`, so higher `GOMAXPROCS` can also mean more frequent GCs. For allocation-heavy services, the right knob is often `GOGC` or `GOMEMLIMIT`, not `GOMAXPROCS`.

### Q19. Compare Go's `GOMAXPROCS` model with Java's thread pool sizing.

**Model answer.** Java has no `GOMAXPROCS` — application threads map 1:1 to OS threads, and the JVM does not cap parallel execution at the runtime level. Sizing happens at the thread-pool level (`ForkJoinPool` parallelism, `ThreadPoolExecutor` core size). Java added container-aware `Runtime.availableProcessors()` in Java 10. The fundamental difference: Go's runtime multiplexes goroutines onto a small number of `P`s; Java relies on the kernel scheduler. Go's design makes the parallelism knob visible and simple; Java's makes it implicit and per-pool.

---

## Professional-Level Questions

### Q20. Walk through what `procresize` does when you call `runtime.GOMAXPROCS(8)` from `GOMAXPROCS=4` mid-program.

**Model answer.** [Cross-reference: scheduler-internals professional.md for the source-level walk.] Briefly: the runtime acquires the scheduler lock, stops the world (every goroutine is preempted to a safe point), allocates 4 new `P` structs, initialises their runqueues and mcaches, redistributes runnable goroutines from existing `P`s onto the new ones, releases the scheduler lock, and restarts the world. Pause duration is typically sub-millisecond but can spike higher with very large goroutine counts.

### Q21. Design an internal autosetting library that goes beyond `automaxprocs`.

**Model answer.** Three additions: (a) workload-tier awareness — latency-critical services reserve a core for runtime work; (b) custom logging through the org's structured-logging library; (c) Prometheus metric emission for the resolved value, the source quota, and the derivation reason. API: `Apply(Config{Tier, Logger, EmitMetric, AllowEnvOverride}) int`. Order constraint: must run *before* any other `init()` that depends on `GOMAXPROCS`. Test matrix: cgroup v1, v2, no cgroup, env var set, env var ignored.

### Q22. A service has high allocation rate (200 MB/s) and shows 30% time in `runtime.gcBgMarkWorker`. Reducing `GOMAXPROCS` from 32 to 28 cuts mark-worker time to 15%. Why?

**Model answer.** With `GOMAXPROCS = 32`, the runtime spawns up to 8 dedicated mark workers and additional fractional workers. The mark workers compete with mutator goroutines for cores; the mutators allocate faster, triggering more GCs; the cycle amplifies. Reducing `GOMAXPROCS` to 28 reduces both mark-worker count and effective mutator allocation rate, allowing GC to settle into a less aggressive cadence. The deeper fix is GC tuning (`GOGC`, `GOMEMLIMIT`) or reducing allocation in hot paths.

### Q23. Why is per-tenant `GOMAXPROCS` not feasible in a multi-tenant SaaS?

**Model answer.** `GOMAXPROCS` is process-wide. The runtime allocates a fixed number of `P` structs at startup (or on the rare `procresize`); these `P`s run goroutines from any package, any tenant, indiscriminately. There is no API for per-goroutine, per-package, or per-tenant `P` allocation. The clean alternative is per-tenant processes (one Go process per tenant or tenant pool), each with its own cgroup-bounded `GOMAXPROCS`. Within a single process, tenant isolation must come from application-layer rate limiting or sharding, not runtime knobs.

### Q24. Your service exhibits a 50 ms latency spike every 7 days at the same time on the same node. CPU graph shows a step up coincident with the spike. What is your investigation order?

**Model answer.** (1) Check for co-tenant batch jobs starting at that time — cron, kubernetes CronJobs, sibling pods. (2) Check node-level CFS throttling at that time — the step-up suggests another consumer arrived. (3) Verify `GOMAXPROCS` is correct: log shows it; metric confirms; matches cgroup quota. (4) If misconfigured, fix; if correct, investigate the noisy neighbour at the orchestrator level (move to a dedicated node, use Guaranteed QoS, or apply anti-affinity). (5) Add throttling alert so the next occurrence pages immediately.

### Q25. When would you set `GOMAXPROCS` via the environment variable rather than letting the runtime detect it?

**Model answer.** Three cases: (a) deployment platforms where Go's cgroup detection is incomplete or buggy (some custom container runtimes); (b) overrides for specific incidents — temporarily raise or lower without redeploying code; (c) special tiers where the formula (`quota - 1`, or `cores per socket`) cannot be expressed in the runtime's defaults. In all cases, log the env-var value at startup and emit a metric so operators see the override; the env-var has the right precedence (overrides runtime detection, can be overridden by `runtime.GOMAXPROCS(n)` calls).

---

## Self-Assessment

If you can answer Q1–Q12 cleanly: junior–middle level on tuning.
If you can answer Q13–Q19 cleanly: senior level.
If you can answer Q20–Q25 cleanly: professional level, ready to design fleet policy.

Cross-reference: the planned `10-scheduler-deep-dive/03-gomaxprocs-tuning/interview.md` chapter (coming soon).
