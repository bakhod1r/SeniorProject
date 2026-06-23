# Runtime Goroutine Management — Interview Questions

A curated set, ordered from "first 30 minutes of a junior screen" up to "staff-level system design with the runtime in mind." Each question has a short ideal answer and an optional follow-up. Read both columns.

---

## Junior

**Q1. What does `runtime.NumGoroutine()` return?**

The count of live goroutines, including the main goroutine, all user-spawned goroutines that have not yet exited, and runtime-internal goroutines (GC workers, finalizer goroutine). Follow-up: "Will this count be zero at any time?" No — at least one goroutine is always running while Go code executes.

**Q2. What is the difference between `runtime.NumCPU` and `runtime.GOMAXPROCS(0)`?**

`NumCPU` is the number of logical cores visible to the process. `GOMAXPROCS(0)` is how many of those Go is willing to use simultaneously for Go code. By default, they are equal at startup. In containers or after manual tuning, `GOMAXPROCS` can be lower.

**Q3. What does `runtime.GOMAXPROCS(0)` do?**

Reads the current value without changing it (since Go 1.5). Passing `-1` is equivalent. Any positive integer sets a new value and returns the previous one.

**Q4. What does `runtime.Goexit()` do?**

Terminates the current goroutine after running its deferred functions. Other goroutines are unaffected. Called from `main`, it lets other goroutines finish before the program exits naturally.

**Q5. When should you use `runtime.Gosched()`?**

Almost never in modern Go. Since 1.14, async preemption ensures fairness automatically. Legitimate uses include certain benchmark setups; it should not appear in production application code.

**Q6. What does `runtime.Stack(buf, true)` do? What is its cost?**

Writes stack traces of *every* live goroutine into `buf`. It stops the world for the duration. Cost grows linearly with goroutine count. Reserve for diagnostics.

**Q7. Why is `runtime.GC()` rarely used in production?**

The runtime's GC scheduling is near-optimal. Forcing a GC adds a 5–50 ms pause for no long-term benefit and disturbs latency.

**Q8. What is a finalizer?**

A function registered with `runtime.SetFinalizer(obj, fn)` that runs in a dedicated goroutine after `obj` becomes unreachable. Finalizers are non-deterministic, may not run at all, and serialize through one goroutine. Use `defer` and explicit `Close` for resource cleanup instead.

**Q9. What does `runtime.LockOSThread()` do?**

Pins the calling goroutine to its current OS thread. The goroutine will only ever execute on that thread until `UnlockOSThread`. Used for thread-local state (OpenGL, signal masks).

**Q10. What happens if a goroutine exits while locked to an OS thread?**

The OS thread is destroyed. This is intentional: thread-local state set by the locked goroutine does not leak to a future goroutine that might land on that thread.

---

## Middle

**Q11. Why is the default `GOMAXPROCS` sometimes wrong in containers?**

Before Go 1.25, `runtime.NumCPU` returned the host's core count, ignoring cgroup CPU quotas. A pod limited to 2 CPUs on a 64-core host would get `GOMAXPROCS=64`, causing scheduler contention and throttling. Fix: set `GOMAXPROCS` explicitly, use `uber-go/automaxprocs`, or upgrade to Go 1.25+.

**Q12. What is `GOMEMLIMIT` and when should you set it?**

A soft memory cap (Go 1.19+). As live memory approaches the limit, the runtime runs GC more aggressively to stay under. Set it in any containerised service to prevent OOM kills. Typical value: 90% of the container's memory limit.

**Q13. What happens if `GOMEMLIMIT` is set tighter than your working set?**

The runtime enters a near-continuous GC state. Throughput collapses. Latency spikes. The runtime caps GC CPU at ~50% to prevent total starvation, so the heap may exceed the limit anyway. Symptom: high `gc/cpu` ratio, rising latency, eventual OOM.

**Q14. Why does setting `GOMAXPROCS` at runtime stop the world?**

The runtime must rebuild the P array. Changing `GOMAXPROCS` from 4 to 8 creates four new Ps; from 8 to 4 destroys four. Either way, the runtime cannot let goroutines run during the transition without race-free P state. So it pauses everything briefly.

**Q15. Explain the difference between `pprof.SetGoroutineLabels` and `pprof.Do`.**

`SetGoroutineLabels` replaces the goroutine's labels with those from a context. `pprof.Do` is a scoped helper: it merges new labels with existing ones, runs a function, and restores the previous labels on return. `Do` is safer because it does not leave labels lingering past their logical scope.

**Q16. How do labels propagate to child goroutines?**

A child goroutine started with `go child()` inherits the parent's current labels at the moment of `go`. Subsequent label changes on the parent do not affect the child. Labels do not cross process or channel boundaries; consumers of work queues must set their own labels.

**Q17. What does `SetMutexProfileFraction(5)` do?**

Sets the mutex profile sampling rate to one event per five contention events (20% sampling). `0` disables the profile entirely. Tradeoff: lower numbers mean higher overhead per event but more accurate profiles.

**Q18. How does the netpoller interact with `GOMAXPROCS`?**

The netpoller is a runtime component called by Ms (any M, not a dedicated one). When a goroutine blocks on network I/O, the goroutine is parked; no M is held. The netpoller is invoked opportunistically from the scheduler. `GOMAXPROCS` does not directly control netpoller activity, but a higher `GOMAXPROCS` means more Ms taking turns calling `epoll_wait` (or equivalent).

**Q19. Why is `runtime/metrics` preferable to `runtime.ReadMemStats`?**

`ReadMemStats` returns a fixed struct, stops the world briefly, and only exposes memory data. `runtime/metrics` is structured, versioned, mostly non-stopping, and includes scheduler latencies, GC pause histograms, and per-class CPU breakdowns.

**Q20. How would you set up a `/debug/stacks` endpoint in production?**

```go
mux.HandleFunc("/debug/stacks", func(w http.ResponseWriter, r *http.Request) {
    pprof.Lookup("goroutine").WriteTo(w, 2)
})
```

Behind authentication, on a management port. Disable on public-facing servers.

---

## Senior

**Q21. Walk me through what happens when `runtime.GC()` is called.**

1. The calling goroutine is parked until the GC cycle completes.
2. The runtime triggers a full mark-sweep cycle: stop-the-world (briefly), set up roots, concurrent mark phase, mark termination (brief STW), sweep.
3. Stacks are scanned; pointers are followed; reachable objects are marked.
4. Unreachable objects are added to the free list.
5. The caller resumes once the cycle ends.

Side effects: scheduler latency spike during STW, possible mark-assist load on other goroutines.

**Q22. Design a continuous profiling system using `pprof` and labels. What labels would you propagate?**

A request-scoped middleware wraps each handler with `pprof.Do`, attaching labels: `endpoint` (route name), `method`, `tenant` (low-cardinality ID), `priority` (interactive/batch). A background agent captures 10-second CPU profiles every minute, uploads them to a profile backend (Pyroscope/Parca), tagged with build SHA and instance ID. The backend indexes by label so we can ask "show me CPU usage for tenant=acme on /api/v2/orders over the last 24 hours."

**Q23. A service shows `gc/cycles/total` rising fast but heap is small. What's happening?**

Forced GCs. Most likely: someone is calling `runtime.GC()` on a hot path. Other possibilities: tight `GOMEMLIMIT` causing pressure-driven GC; very low `GOGC` value; massive transient allocations causing rapid heap growth followed by GC. Investigate via `runtime/trace` to see the GC trigger points.

**Q24. Explain how `runtime/trace` differs from `pprof` profiling.**

Profiles are statistical samples: "during this window, 12% of CPU went to function X." A trace is a deterministic event stream: every goroutine state transition, every GC event, every syscall, with timestamps. Trace is heavier (~5–20% CPU overhead), produces large files, and is the right tool for "why is this specific request slow" or "why did the scheduler latency spike." Profile is for steady-state CPU/memory hotspots.

**Q25. When would you call `debug.SetMaxThreads` in production?**

When the service makes cgo calls that can hold Ms, and a peer can trigger many concurrent cgo calls (intentionally or via bug). Without a cap, a thread storm can hit the kernel's per-process or system-wide thread limit, leading to fork failures across the host. `SetMaxThreads(2000)` turns that into a controlled `exit(2)` rather than host-wide damage.

**Q26. Explain how `LockOSThread` interacts with the GC.**

The GC scans goroutine stacks. A locked goroutine is still scanned like any other. The lock affects only scheduling (the goroutine stays on its M), not GC. The GC may briefly STW the locked goroutine just like any other. The only special case: when the locked goroutine exits, the M is destroyed and any TLS allocations the C side held are freed by the OS.

**Q27. How does `SetMemoryLimit` interact with `SetGCPercent`?**

The GC pacer computes a heap goal each cycle: `goal = max(heap_marked + heap_marked * GOGC/100, memory_limit - non_heap_memory)`. The actual trigger is whichever bound is hit first. With `GOGC=100` and `GOMEMLIMIT=1GB`, the limit dominates when working set is near the cap; `GOGC` dominates when memory is abundant.

**Q28. What metric would you alert on for "scheduler is overloaded"?**

`/sched/latencies:seconds` p99 over time. A goroutine being runnable but not running for > 1 ms (at p99) indicates the runqueue is consistently deeper than the scheduler can drain. Alert when p99 stays above your latency budget for several minutes.

**Q29. Why does the finalizer queue need to be drained on program exit?**

It doesn't. The runtime does not flush pending finalizers at exit. This is why finalizers cannot be relied upon for cleanup that must run — like releasing a kernel resource. The OS will reclaim memory and FDs anyway; the finalizer was a backup.

**Q30. You see `runtime.Gosched` calls sprinkled in a codebase. How do you decide whether to remove them?**

Check the Go version each was added under. Pre-1.14 code may have relied on `Gosched` for fairness; 1.14+ async preemption usually makes them redundant. Run benchmarks before and after removal. In modern Go, removing them should not regress (and may slightly improve) performance. Exception: a tight loop that is itself nearly preemption-safe but lives inside a system goroutine — rare.

---

## Staff / Architect

**Q31. Design a runtime-tuning module for a multi-tenant SaaS Go service running in Kubernetes. What knobs do you set and at what time?**

At init:

- `automaxprocs` (or manual cgroup read) to set `GOMAXPROCS`.
- `debug.SetMemoryLimit` to 90% of container memory.
- `debug.SetMaxStack` to 64 MB (catch runaway recursion).
- `debug.SetMaxThreads` to 2000 (cgo safety net).
- `runtime.SetMutexProfileFraction(5)` and `SetBlockProfileFraction(10000)` for production profile capture.
- Start a continuous profiler agent if not external.

At runtime:

- `pprof.Do` middleware around request handlers, tagging tenant + endpoint.
- Periodic `runtime/metrics` scrape to Prometheus.
- Authenticated `/debug` endpoints for stacks, pprof, trace.
- Optional adaptive `SetMemoryLimit` controller responding to PSI.

Document everything. Future engineers will not know why these are set.

**Q32. How would you measure the *cost* of GC tuning changes in production?**

Before change: capture `/cpu/classes/gc/total:cpu-seconds` over a stable hour. Note `/gc/pauses:seconds` p99 and `/memory/classes/heap/objects:bytes` peak. Capture a CPU profile and heap profile for baseline.

Deploy change to one shard. Re-capture after a stable warm-up. Compare:

- GC CPU ratio (gc / total).
- p99 STW pause duration.
- Heap peak.
- Request latency p50/p99 (the user-facing metric).

Only roll out if user-facing latency improved or held while GC CPU dropped meaningfully.

**Q33. Explain how Go's runtime API choices reflect its concurrency philosophy.**

Go gives you `go f()` and channels as the primary abstractions; the runtime APIs are secondary safety valves. Notice what is *not* exposed: no goroutine IDs, no thread affinity API, no priority, no interruptible sleep, no goroutine cancellation primitive (`context` is library-level). The design says: structure your concurrency, don't reach into the runtime. The visible APIs (`GOMAXPROCS`, `GOMEMLIMIT`, `LockOSThread`) are there for the few cases where the abstraction is insufficient.

**Q34. A coworker proposes adding `runtime.GC()` after every batch import to "clear out garbage." Argue for or against.**

Against. The pacer will trigger GC at exactly the right moment based on allocation pressure. A manual GC after import:

- Adds a guaranteed pause (5–50 ms typically).
- Does not actually reduce total GC work — the same objects must be marked and swept eventually.
- May trigger before the runtime would have, creating a *second* GC shortly after if more allocations occur.
- Adds maintenance burden — future engineers will wonder why.

The only argument *for*: in a benchmark, to control where GC happens. Not for production.

**Q35. Describe a goroutine leak hunt using the APIs we have discussed.**

1. Observe `runtime.NumGoroutine()` (or `/sched/goroutines:goroutines`) rising over time. Plot it.
2. Capture `pprof.Lookup("goroutine").WriteTo(w, 1)` — gives counts by creation stack. The growing stack is the leak source.
3. Cross-reference with code: that goroutine should exit on some signal — channel close, context cancel, network read EOF. Find the missing exit path.
4. Capture two `runtime/trace` snapshots 60 seconds apart. Look at the goroutine lifecycle: when were these goroutines born? Are they blocked on the same channel?
5. Once identified, add the missing exit (close the channel, cancel the context, set a deadline).
6. Verify with a goroutine count plot post-fix; should plateau.

**Q36. How would you architect a service that can dynamically respond to memory pressure events from the host?**

Subscribe to PSI (pressure stall information) on `/proc/pressure/memory`. When `some` avg10 exceeds a threshold:

- Lower `GOMEMLIMIT` by some percentage (with a floor).
- Reject lowest-priority requests at the load balancer (use labels to identify priority).
- Drain caches (application-managed).
- Optionally invoke `debug.FreeOSMemory()`.

When pressure recedes, restore the limit. This pattern works because `debug.SetMemoryLimit` accepts changes at any time and the runtime responds within one GC cycle.

**Q37. What would you change in Go's runtime API if you could? Why?**

Reasonable answers vary; some possibilities:

- A read-only API to enumerate goroutines by label without stopping the world.
- A typed `SetMemoryLimit` API with units (`SetMemoryLimit(900, units.MiB)`).
- A "goroutine kill" API for force-stopping specific goroutines (the runtime team has consistently rejected this — cancellation should be cooperative).
- Better introspection of waiters on channels and mutexes without traversing all goroutines.

The point of this question: do you have opinions about API design grounded in concrete pain you have hit?

---

## Quick-fire trivia

- What is the default `GOGC`? **100.**
- What command prints all goroutines' stacks from a running process? **`kill -SIGQUIT <pid>`** (or `kill -3`).
- What is the default max stack size on 64-bit? **~1 GB.**
- What does `SetGCPercent(-1)` do? **Disables GC.**
- Which Go version added `GOMEMLIMIT`? **1.19.**
- Which Go version made `LockOSThread` ref-counted? **1.10.**
- Which Go version added container-aware `GOMAXPROCS`? **1.25.**
- Does `runtime.NumGoroutine` count system goroutines? **Yes.**
- Does `pprof.Do` save and restore labels? **Yes.**
- How does `Goexit` differ from `os.Exit`? **`Goexit` ends one goroutine and runs defers; `os.Exit` ends the whole program and skips defers.**
- What is the cost of `runtime.NumGoroutine()`? **O(1), ~10 ns (one atomic load).**
- What is the cost of `runtime.Stack(buf, true)`? **O(N goroutines), plus stop-the-world.**
- Is `pprof.SetGoroutineLabels` safe in a worker pool? **Only if labels are reset between jobs. Prefer `pprof.Do`.**
- Default value for `SetMaxThreads`? **10 000.**
- What signal triggers a built-in all-goroutine stack dump? **SIGQUIT (kill -3).**
- Does the netpoller occupy a dedicated thread? **No. It runs opportunistically from any M.**
- What kind is `/gc/pauses:seconds` in `runtime/metrics`? **`KindFloat64Histogram`.**
- Are finalizers guaranteed to run before program exit? **No.**

---

## Scenario-based

**S1. A pod with 4 GB memory limit OOM-kills daily around 03:00 UTC. CPU usage at the time is moderate. The Go service is on Go 1.22 with default runtime settings. What's your first hypothesis?**

A: Default settings include no `GOMEMLIMIT`. The runtime GCs based on `GOGC=100` only — heap doubles before each collection. If a daily backup job or report generation runs at 03:00 and allocates aggressively, the heap can grow beyond the container cap before the next GC. Fix: set `GOMEMLIMIT` to ~3.6 GB (90% of 4 GB). Validate by tracking heap size during the next 03:00 run.

**S2. A multi-tenant SaaS reports that tenant `acme` "must be hammering us" but the team has no way to confirm it from profiles.**

A: Profiles are unlabeled. Add `pprof.Do` middleware that tags `tenant=<id>`. Within 24 hours of deploy, capture a CPU profile and slice by `tenant`. You will see whose work consumes which fraction of CPU.

**S3. A goroutine count metric climbed from 200 to 50,000 over 6 hours. Restart resets it. What do you investigate?**

A: A leak. Capture `pprof.Lookup("goroutine").WriteTo(w, 1)` — gives goroutine count by *creation* stack. The creation site with thousands of goroutines is the leak source. Common patterns: missing channel close (`for v := range ch`), missing `context.CancelFunc` call (`go vet`'s `lostcancel` check), goroutine waiting on a network read with no deadline.

**S4. A latency-sensitive endpoint shows occasional 50 ms p99 spikes uncorrelated with request size or backend latency.**

A: Likely GC stop-the-world. Confirm via `/gc/pauses:seconds` p99. If pauses are 50 ms, you have a large pointer-heavy heap. Mitigations: reduce pointer density (use slices of values, not slices of pointers), raise `GOGC` to reduce frequency, set `GOMEMLIMIT` and reduce live heap, profile heap for allocation hotspots and pool the worst offenders.

**S5. A service runs `runtime.GC()` at the start of every cron job. The cron runs every 5 minutes. The team says "it keeps memory clean."**

A: The cron job's GC accomplishes nothing the pacer wouldn't have done. It adds a few ms pause per run, costing CPU and possibly disrupting concurrent requests. Remove. If memory truly grows after the cron, the issue is a leak, not lack of GC.

**S6. A team adds `runtime.LockOSThread()` to all worker goroutines "for cache locality."**

A: Cache locality from thread pinning is negligible for typical Go code; the cost is much higher: locked goroutines cannot migrate, the runtime may need extra Ms, and exit-while-locked destroys threads. Remove unless there is a thread-affine API (TLS, signals, OpenGL) that actually requires it.

**S7. You inherit a codebase with `init() { runtime.GOMAXPROCS(8) }` in a library package. The application runs in a container with 2 CPUs.**

A: The library is hijacking a process-global setting. On the 2-CPU pod, this oversubscribes. Submit a fix to the library to remove the `init`. In the meantime, the app can re-set `GOMAXPROCS(2)` in its own `init` (load order matters — application `init` runs after imported packages').

**S8. You set `debug.SetMemoryLimit` but Prometheus shows the heap exceeds it for several seconds during bursts.**

A: Expected. The limit is soft; the runtime cannot stop user code mid-allocation. It can only adjust GC frequency. If your bursts routinely overshoot, lower the target further or reduce burst allocation rate (per-request memory budgets, streaming instead of buffering).

---

## Open-ended

**O1. Walk me through your dashboard for a production Go service.**

The interviewer is looking for: goroutine count, heap size, GC CPU ratio, GC pause p99, scheduler latency p99, thread count, plus per-tenant or per-endpoint slicing if labeled. Bonus: PSI metrics, build SHA tag, comparison against deploy markers.

**O2. Design a profile-collection sidecar for a fleet of Go services.**

Expected components: in-process agent, periodic capture, label propagation, network upload with retries, server-side storage (Pyroscope/Parca-style), query layer (label-aware). Discuss CPU/memory overhead, network bandwidth, sample retention, privacy of labels.

**O3. If you were designing Go from scratch today, what would you change in the runtime API?**

Personal opinion question. Look for: thoughtful, not arbitrary. Examples — typed memory units, official goroutine cancellation API, structured profile-query language, scheduler hooks for application-aware scheduling. Strong candidates ground their answers in concrete pain they have hit.
