# `LockOSThread` Performance — Interview Questions

> Questions a performance-focused interviewer asks about `runtime.LockOSThread`. They split into three tiers; pick the level that matches the role. Each question has an expected answer plus the follow-up questions a strong interviewer would ask.

## Table of Contents

1. [Tier 1: Foundational](#tier-1-foundational)
2. [Tier 2: Applied](#tier-2-applied)
3. [Tier 3: Senior / Staff](#tier-3-senior--staff)
4. [Red Flags in Candidate Answers](#red-flags-in-candidate-answers)
5. [Whiteboard Exercises](#whiteboard-exercises)

---

## Tier 1: Foundational

### Q1. What does `runtime.LockOSThread` do?

**Expected.** It binds the calling goroutine to the OS thread (M) it is currently running on. From that point until `UnlockOSThread` is called the matching number of times, the goroutine only runs on that thread, and the thread runs only that goroutine.

**Follow-up.** "What happens if the goroutine exits without calling `UnlockOSThread`?" → The M is destroyed (via `pthread_exit` on Linux). It is not returned to the runtime's M pool.

**Follow-up.** "Is the call reference-counted?" → Yes. N matching `Lock` calls need N matching `Unlock` calls.

---

### Q2. Why might you call `LockOSThread`?

**Expected.** Two main reasons: (1) interacting with thread-affine APIs that are tied to a specific OS thread (OpenGL, CUDA, certain crypto SDKs, Linux namespaces); (2) optimisation of cgo-heavy hot paths where TLS amortisation matters. There is also a niche case for cache locality, but it is rarely worth the cost.

**Follow-up.** "How big is the cache-locality win typically?" → 5–15% for tight loops; usually not worth the M cost.

---

### Q3. What is the performance cost of pinning one goroutine?

**Expected.** One OS thread is retired from the runtime's general scheduling pool. The runtime will create a new M to compensate if needed. The `LockOSThread` call itself is fast (<100 ns). The ongoing cost is loss of scheduler flexibility — the pinned goroutine cannot be moved between Ms, so work-stealing is reduced.

**Follow-up.** "How would you measure that cost?" → `runtime/metrics /sched/threads:threads` (Go 1.21+) for M count; `/sched/latencies:seconds` for scheduling latency p99.

---

### Q4. Does `LockOSThread` prevent preemption?

**Expected.** No. Pinning only prevents *migration* (the G being moved to another M). The runtime can still preempt the G — on Linux this happens via `tgkill` with `SIGURG`. After preemption, the G stays on the same M.

**Follow-up.** "What is the cost of that preemption?" → ~1–3 µs of kernel time per fire, sub-percent for typical workloads.

---

### Q5. Does `LockOSThread` give you CPU affinity?

**Expected.** No. The OS kernel can still move the underlying thread across cores. To pin the thread to specific CPUs, layer `unix.SchedSetaffinity` on top of `runtime.LockOSThread`.

**Follow-up.** "When would you do that?" → NUMA-aware deployments, real-time-like workloads, GPU drivers with PCIe lane affinity.

---

## Tier 2: Applied

### Q6. You inherit a service where every HTTP handler calls `runtime.LockOSThread`. What is wrong, and how do you fix it?

**Expected.** Per-request pinning means each request retires an M for its duration. At high RPS this destroys M-pool efficiency: lots of `clone(2)` and `pthread_exit` syscalls per second, thread count spikes, scheduler latency rises. Fix: refactor to a single-owner pinned worker pool. Identify what state required the pin (likely cgo into a thread-affine library), encapsulate it in a long-lived worker that consumes a channel of jobs, and have handlers submit to that channel.

**Follow-up.** "How would you size the pool?" → One worker per resource if the resource is replicable (e.g., 4 GPUs → 4 workers). Otherwise one worker total, with a channel buffer sized to absorb bursts.

**Follow-up.** "What metric would catch this regression in the first place?" → `process_threads_total` rising during traffic spikes, far past `GOMAXPROCS + small constant`.

---

### Q7. Your pinned cgo worker shows queue depth growing under load, but CPU on its thread is at 40%. What's the bottleneck?

**Expected.** The worker is waiting on the C call (synchronous) or on the channel (idle). 40% CPU means it's idle 60% of the time. The bottleneck is upstream of the worker — perhaps the C call is fast and the dispatcher / submitter can't keep up. Or downstream — the worker is waiting for its reply channel to be drained.

**Follow-up.** "How would you diagnose?" → `pprof block` to find where the worker is blocked. `runtime/trace` to see whether the M is in syscall or parked.

**Follow-up.** "If submitters are slow, what do you do?" → Add more dispatcher goroutines (cheap, unpinned). If submitters wait on the same upstream service, that's the real bottleneck; pinning is healthy.

---

### Q8. Compare `runtime.LockOSThread` to a `sync.Mutex` that "owns" a piece of state. Which would you choose, and why?

**Expected.** They solve different problems. A mutex serialises access to data structures; `LockOSThread` binds a goroutine to a thread. Use a mutex when state lives in Go memory and is shared between goroutines that all need access. Use `LockOSThread` when state lives in *thread-local* storage (TLS), or when an API requires the same thread for all calls. Don't mix them up: `LockOSThread` does not give exclusive access to data; multiple goroutines can still touch the same memory.

**Follow-up.** "Can a pinned worker also use a mutex?" → Yes. The two are orthogonal. A pinned worker typically does *not* need a mutex internally because it has its own goroutine; the channel-of-work pattern serialises access naturally.

---

### Q9. How does `LockOSThread` interact with `GOMAXPROCS`?

**Expected.** `GOMAXPROCS` caps the number of Ps (scheduling slots). Each pinned goroutine consumes an M but the M's P participates in the cap. Effectively, every pin reduces the number of Ps available for non-pinned work by one. If you pin `k` goroutines on `GOMAXPROCS=N`, you have `N − k` slots for the rest of the program. The runtime may spawn extra Ms beyond `GOMAXPROCS` to keep scheduling moving, but the kernel still has only `N` cores (typically) to multiplex everything.

**Follow-up.** "When does this cause a problem?" → When `k` approaches or exceeds `GOMAXPROCS`. The non-pinned work compresses onto few Ms; tail latency rises.

**Follow-up.** "How would you fix?" → Raise `GOMAXPROCS`, reduce pin count, or split the service into pinned and unpinned containers.

---

### Q10. A pinned goroutine panics. What happens, and how do you defend against it?

**Expected.** Without recovery: the runtime crashes the entire process. With recovery (e.g., `defer recover()` inside the worker's loop): the worker continues running, still pinned. But if the panic left thread-local state in a corrupted state (broken GL context, dangling C resources), continuing is unsafe; you may want to let the worker die and spawn a replacement. The right pattern depends on what the worker owns.

**Follow-up.** "What's the M's fate if you let the worker die?" → The M is destroyed (exit-while-locked rule). A replacement worker spawned later creates a fresh M.

---

### Q11. You see `process_threads_total` slowly rising in production over hours. Walk me through the diagnosis.

**Expected.**

1. Confirm steady-state RPS isn't also rising (would explain natural growth).
2. Check goroutine count — usually flat if it's an M leak.
3. Check `pprof goroutine?debug=2` for stacks parked in cgo or in `LockOSThread`-style patterns.
4. Look for code that calls `LockOSThread` without `UnlockOSThread` in a non-terminating path.
5. Look for cgo storms — unbounded concurrency calling C functions.
6. Look for `os.File.Read` on large files (blocking M).
7. If the cause is an unbounded concurrent cgo call, bound it with a semaphore.
8. If the cause is per-request pinning, refactor to a pool.

**Follow-up.** "What would the alert have been?" → `process_threads_total > baseline + buffer for 5 minutes`. The buffer is tuned per service.

---

### Q12. Describe the single-owner-goroutine pattern.

**Expected.** One goroutine, pinned at start, owns a thread-affine resource. It exposes a channel-based API (Submit / queue). Callers send jobs through the channel; the worker processes them sequentially on its pinned thread. Per-job reply channels (buffered 1) carry results back. Initialisation and cleanup of the resource run inside the pinned goroutine — same thread that owns the resource. Lifecycle: constructor signals readiness; shutdown via channel close or context cancellation.

**Follow-up.** "Show me the skeleton in code." → (Candidate writes a `Worker` struct, `loop` method with `runtime.LockOSThread`+`defer Unlock`, `Submit` method.)

**Follow-up.** "How do you scale to N resources?" → Pool of N workers, dispatcher with round-robin or least-loaded selection. The dispatcher is unpinned.

---

## Tier 3: Senior / Staff

### Q13. Walk me through what happens inside the Go runtime when a pinned goroutine makes a cgo call.

**Expected.**

1. `cgocall` is invoked. It calls `entersyscall`, which detaches the P from the M and marks the M as in-syscall.
2. The C function runs. The M is held (still locked to the G), the P is free to be picked up by another M for other Gs.
3. C returns. `exitsyscall` runs.
4. Because the G has `lockedm` set, the runtime cannot place the G on a different M; it must put it back on its original M.
5. The M tries to re-acquire a P. If one is free, it attaches and runs the G. If not, the M parks until a P frees.

**Follow-up.** "Does this differ from an unpinned cgo call?" → Yes. Unpinned, after `exitsyscall` the G can be put on any M with a free P, so the original M may not be the one running the G next. Pinned, the same M always.

**Follow-up.** "Does this make pinned cgo faster?" → For short C functions, yes — TLS is stable and there's no cross-M migration. For long C functions, the gain is washed out by the C call's own cost.

---

### Q14. What is the M-creation cost on Linux, and when does pinning trigger it?

**Expected.** M creation on Linux uses `clone(2)`, typically 10–50 µs. Pinning triggers it indirectly: when pinned Gs occupy enough Ms that no free M is available for runnable Gs, the runtime calls `newm` to spawn a fresh one. The burst behaviour is bounded by sysmon's polling rate (~10 ms) but can still create dozens of Ms in a second under heavy pinning patterns.

**Follow-up.** "How do you prevent that?" → Pre-warm the pool at startup. Or use `debug.SetMaxThreads` to cap and let pinning saturate fail-fast.

**Follow-up.** "What's the typical M count for a healthy Go service?" → `GOMAXPROCS + 3–5` for pure Go. With pins, add the pin count. With cgo concurrency, add the in-flight cgo count. Anything beyond is worth investigating.

---

### Q15. A team wants to use `LockOSThread` to "speed up" a pure-Go hot loop. Coach them.

**Expected.** Pinning a pure-Go loop does not speed it up. The Go scheduler is good at keeping a hot G on the same M when there's no contention; pinning removes the scheduler's option to move it when there *is* contention. The cost of one retired M outweighs any cache-locality gain in typical benchmarks. Suggest profiling first: if cache misses are confirmed by `perf stat`, the right fix is usually reducing the working set or using `runtime.LockOSThread` together with `unix.SchedSetaffinity` on a specific CPU — but only after measuring.

**Follow-up.** "What if the benchmark shows pinning is faster?" → Re-examine: maybe the benchmark is too tiny to reflect production cost (the bench loses no work-stealing because there's nothing to steal). Test under realistic concurrency.

---

### Q16. Design a service that ships GPU inference with 4 GPUs. Explain pinning, dispatcher, capacity.

**Expected.**

- Four pinned workers, one per GPU, each owning a CUDA context.
- A dispatcher goroutine (unpinned) that receives requests, picks a worker by round-robin or least-loaded, submits via channel.
- Submit returns the reply via a per-job buffered channel.
- Lifecycle: each worker has its own constructor with a readiness signal.
- Capacity: `GOMAXPROCS = 8` (4 for workers, 4 for everything else). Plus baseline ~6 Ms. Total ~16 threads. Container with 12–16 CPUs.
- Observability: pprof labels `role=gpu-worker,device=N`; `process_threads_total` metric; `worker_queue_depth` metric per worker.
- Failure handling: worker restart on panic; circuit breaker on repeated failures.
- Backpressure: `SubmitCtx` with context cancellation so client deadlines flow through.

**Follow-up.** "How do you handle a slow request that blocks one GPU?" → Time-out via `context.Context`; the dispatcher can route subsequent requests to the other GPUs. The slow request runs to completion on its worker because cgo is uninterruptible.

**Follow-up.** "What if all 4 GPUs are in 30-second jobs and the queue grows?" → Backpressure on `Submit` returns `ErrBusy`; client sees HTTP 429 or similar. Don't let queue grow unbounded.

---

### Q17. Explain why pinning the `main` goroutine is sometimes required on macOS.

**Expected.** AppKit (the macOS GUI framework) requires its API calls to run on the *main* thread of the process — specifically the thread that started the program. If main work runs on a goroutine that the runtime later migrates to another M, AppKit breaks. `runtime.LockOSThread` in `init` (which runs on the main goroutine) keeps `main` pinned to the main thread. Same applies to OpenGL on macOS, since the GL context binds to a thread.

**Follow-up.** "Is this needed on Linux/Windows?" → On Linux for Xlib/GTK, similar issue with the GUI thread but different APIs. On Windows the message-pump thread plays the same role.

**Follow-up.** "What's the cost?" → One M permanently pinned. Trivial for a GUI app whose main thread is the dominant workload.

---

### Q18. The runtime maintains an internal lock count. Explain.

**Expected.** Beyond the user-facing `LockOSThread`/`UnlockOSThread` (external) count, the runtime has an internal lock count used for cases where the runtime itself needs to pin a G to an M temporarily — e.g., during certain cgo call boundaries, finalisers, or specific stack operations. The internal count is invisible to user code but matters for the runtime's correctness: a G can be "internally locked" while still being externally unlocked. Both counts must be zero for the G to truly be unpinned.

**Follow-up.** "What's a practical implication?" → Don't expect `UnlockOSThread` followed by an immediate scheduling decision to *always* let the G move to another M. Internal locks can keep it tied for a brief window.

---

### Q19. You're profiling and see `runtime.tgkill` in the flame graph. What does it mean?

**Expected.** `tgkill` is the syscall the runtime uses to send `SIGURG` to a specific M for async preemption. Its appearance in a flame graph means the runtime is preempting goroutines frequently. For most workloads this is normal background activity. If `tgkill` is dominant, you likely have many CPU-bound goroutines being preempted often, or many pinned goroutines being preempted (where preemption costs the same but yields no scheduling benefit).

**Follow-up.** "How would you reduce it?" → Insert `runtime.Gosched()` in tight loops so cooperative preemption catches first. Reduce CPU concurrency or use `GODEBUG=asyncpreemptoff=1` (risky).

---

### Q20. Walk me through a production incident where `LockOSThread` was the root cause.

**Expected.** (Story will vary by candidate; strong answer demonstrates measurement, hypothesis, fix.)

A typical story:

> "Service had a slow climb in `process_threads_total` over hours. Initially blamed cgo libcurl. `pprof goroutine?debug=2` showed many goroutines parked in `runtime.gopark` after `runtime.LockOSThread`. The cause was a recent feature that called `LockOSThread` in an HTTP handler 'for safety' before a cgo call to a third-party library. Per-request pinning was retiring Ms during traffic peaks. Fix: removed the `LockOSThread` call (the library was actually thread-safe — the comment claiming otherwise was outdated). Thread count dropped to baseline. Added a lint rule to forbid `LockOSThread` in `*Handler` functions."

**Follow-up.** "What metric / alert would you add after that incident?" → Process-thread-count baseline + alert; lint rule for pinning audits; integration test that asserts thread count under load.

---

## Red Flags in Candidate Answers

- "`LockOSThread` prevents the goroutine from being preempted." → Wrong. Pinning prevents migration, not preemption.
- "Pinning makes Go code faster." → Wrong for pure Go. Only meaningful for cgo TLS or thread-affine APIs.
- "Use `LockOSThread` to avoid race conditions." → Wrong. Pinning does not give exclusive memory access.
- "Pinning gives CPU affinity." → Wrong. The kernel can move the thread between cores.
- "Per-request pinning is fine." → Wrong. M churn destroys performance.
- "There's no cost to pinning if `GOMAXPROCS` is high." → Wrong. Each pin is a permanent M cost; pinning many goroutines on a high-`GOMAXPROCS` machine still wastes resources.

A candidate who hits two or more red flags should be probed; if they don't self-correct, they likely have a shallow understanding.

---

## Whiteboard Exercises

**Exercise A.** Implement a single-owner pinned worker for a hypothetical `C.foo(int) int` cgo call. Include init, submit, shutdown. (15 minutes.)

**Exercise B.** Given a service that pins 4 goroutines and has `GOMAXPROCS=4`, compute the expected steady-state thread count and predict the scheduler latency impact. (5 minutes.)

**Exercise C.** Given pseudocode of a worker that calls `LockOSThread` but not `UnlockOSThread` on exit, explain what happens to the M and write a one-line metric query that would alert on the issue. (5 minutes.)

**Exercise D.** Sketch the dispatcher for a 4-GPU inference pool, including backpressure, context cancellation, and failure recovery. (20 minutes.)

These exercises in combination cover the full middle/senior surface of the topic.

---

## Wrap-up

The interview surface for `LockOSThread` is small but deep. Strong candidates:

- Distinguish migration from preemption.
- Know the one-pin-one-M cost and its implication for `GOMAXPROCS`.
- Reach for the single-owner pattern automatically.
- Cite specific metrics (`/sched/threads:threads`, `/sched/latencies:seconds`).
- Read a production stack trace and identify accidental pinning.

Weak candidates conflate pinning with locking, claim performance benefits without measurement, or propose per-request pinning. Both extremes occur in real interviews.
