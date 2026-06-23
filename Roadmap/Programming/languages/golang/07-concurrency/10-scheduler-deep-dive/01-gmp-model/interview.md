# The G-M-P Model — Interview Questions

[← Back to index](index.md)

## How to Use This Page

Questions are grouped by difficulty: junior, middle, senior, staff. Each has a "what the interviewer is checking" note plus a model answer outline. Use it to self-assess or as a practice set before a Go-runtime-heavy interview.

---

## Junior Level

### Q1. What do the letters G, M, and P stand for in the Go scheduler?

*What is being tested*: do you know the basics?

**Outline**: G = goroutine, M = machine (an OS thread the runtime borrowed), P = processor (a scheduling context that gives an M permission to run user Go code). All three are runtime structs in `runtime/runtime2.go`.

### Q2. How many Ps does a Go program have?

**Outline**: Exactly `GOMAXPROCS`. Defaults to `runtime.NumCPU()` (and, since Go 1.25, respects cgroup CPU quota in containers).

### Q3. What is `GOMAXPROCS`?

**Outline**: The maximum number of OS threads that may execute user Go code simultaneously — equivalently, the number of Ps. Setting it to N caps user-code parallelism at N.

### Q4. Where does a newly spawned goroutine end up?

**Outline**: In the current P's `runnext` slot (or, if `runnext` is occupied, in the current P's local runqueue). If the local runqueue is full, half of it plus the new G overflow to the global runqueue.

### Q5. What is the difference between concurrency and parallelism in Go?

**Outline**: Concurrency = multiple goroutines making progress over the same time interval; achievable with any `GOMAXPROCS`. Parallelism = multiple goroutines making progress at the same instant; requires `GOMAXPROCS > 1` and multiple CPU cores.

### Q6. Can a program have more goroutines than OS threads?

**Outline**: Yes, by a huge margin. A Go program might have a million goroutines and 4–8 OS threads. The scheduler multiplexes them via the M:N model.

### Q7. What happens when `main()` returns?

**Outline**: The program terminates immediately, regardless of how many goroutines are still running. Other goroutines do not get to finish.

---

## Middle Level

### Q8. Why does Go have a P layer between G and M?

*What is being tested*: do you understand the scaling problem P solves?

**Outline**: Without P, all goroutine scheduling decisions go through a single global runqueue protected by one lock. Above ~4 cores, that lock becomes the throughput bottleneck. P introduces per-P local runqueues plus per-P caches (mcache, sudog pool, defer pool), so almost every operation a running goroutine does touches only P-local state. This was the Vyukov 2012 redesign that took Go from "doesn't scale past 4 cores" to "scales to dozens".

### Q9. What is `runnext` and what scenario is it optimised for?

**Outline**: A single-slot "skip-the-queue" cache on each P. When a goroutine wakes another (typical channel send → receiver), the woken G lands in the waker's P's `runnext` so it runs next, bypassing both the local runqueue and any work-stealing victim search. Optimises the channel ping-pong pattern (A→B→A→B) for latency and cache locality.

### Q10. What is the size of a P's local runqueue?

**Outline**: 256 slots, plus the `runnext` slot. When full, `runqputslow` overflows half plus the new G to the global queue under `sched.lock`.

### Q11. Walk me through `findrunnable`'s search order.

**Outline**:
1. Local runqueue (in case a late arrival).
2. Global runqueue (batch).
3. Network poller (non-blocking).
4. Spinning steal — up to 4 passes through other Ps in random order.
5. GC mark workers if applicable.
6. Global runqueue once more.
7. Park M on `m.park` after returning P to `sched.pidle`.

### Q12. What is the "61-tick" fairness rule?

**Outline**: Every 61st iteration of `schedule()`, the scheduler dips into the global runqueue *first* (before checking `runnext` or local runq) to prevent global-queue Gs from being starved by busy local queues.

### Q13. What is `g0`?

**Outline**: A special goroutine per M whose stack *is* the OS thread's large stack (~8 KiB+). It runs scheduler code, GC, signal handling. When you see `runtime.systemstack(...)` in a trace, the runtime is switching from a user G to `g0` to do something requiring a known-large stack.

### Q14. What happens when a goroutine makes a blocking syscall?

**Outline**: The M calls `entersyscall`. The P is detached and marked `_Psyscall`. If sysmon notices the syscall has lasted too long, the P is moved to `_Pidle` and handed to a fresh M. When the syscall returns, `exitsyscall` tries to re-grab the P via CAS; if it has been taken, the G is queued on the GRQ and the M parks.

---

## Senior Level

### Q15. Why is the local runqueue lock-free?

*What is being tested*: do you understand the atomic protocol?

**Outline**: It's a ring buffer with single-producer (the owning P) and multi-consumer (the owning P plus stealing Ms). `runqtail` is single-producer, so writes are plain (with release semantics). `runqhead` is multi-consumer, so reads and CAS advance it. The producer uses `StoreRel` to publish the new tail; consumers `LoadAcq` to see it. No mutex is needed.

### Q16. What is the spinning M cap and why?

**Outline**: At most `GOMAXPROCS / 2` Ms may be in the spinning state simultaneously. Spinning means "actively scanning other Ps for work" — it burns CPU. Too many spinners waste cycles; too few make wakes slow. Half-of-active-Ps was an empirical sweet spot. Enforced by checking `2 * nmspinning < gomaxprocs - npidle` in `findRunnable`'s entry and via CAS in `wakep`.

### Q17. What is `wakep`?

**Outline**: A function called when new work appears (in `newproc`, `ready`) to start additional parallelism. It checks `nmspinning == 0` via CAS; if so, pops an idle P and an idle M, sets `m.nextp = p`, futex-wakes `m.park`. The new spinning M starts in `mstart` → `schedule()` → `findRunnable`.

### Q18. How does work-stealing decide which P to steal from?

**Outline**: A randomised order generated by `stealOrder` to avoid bias. Each pass tries every other P once. Up to 4 passes total. On the third or fourth pass, the thief also considers stealing `runnext` (earlier passes don't, because `runnext` is a "this G will run very soon" hint). Steal grabs *half* of the victim's `runq` plus optionally `runnext`.

### Q19. Why is `sched.lock` a coarse lock instead of multiple fine locks?

**Outline**: Because the whole local-first design exists to *avoid* `sched.lock`. Hot paths don't take it. The lock protects the global runqueue, the idle lists, the spinning count — state that is updated rarely (overflow, M parking, GC stop). When you do need it, you need consistency across those structures, so a single lock is simpler than several. Lock contention on `sched.lock` is a signal that the runtime is in a slow path; the cure is fixing the workload, not splitting the lock.

### Q20. Explain the M lifecycle.

**Outline**:
1. Created on demand by `newm` → `newosproc` → `clone(2)` when an idle P exists but no idle M.
2. Starts in assembly (`mstart`), calls `mstart1`, enters `schedule()`.
3. Loops: pick G, execute, return to schedule. Possibly spins.
4. When `findrunnable` finds nothing, returns P to `pidle` and parks on `m.park`.
5. Woken by `notewakeup(&m.park)`. Resumes with `m.nextp` set.
6. Rarely dies (cgo cleanup, profile signal). Most Ms live for the program's lifetime.

### Q21. What does `runtime.LockOSThread` do?

**Outline**: Pins the calling G to its current M. The M can never run a different G; the G can never run on a different M. Used for OS APIs with thread-local state (X11, OpenGL contexts) and for setting per-thread credentials/sigmask. Side effect: the runtime must allocate a new M to replace this one for general use, so heavy use balloons M count.

### Q22. How does sysmon work without a P?

**Outline**: Sysmon is a dedicated goroutine started in `main()` at runtime initialisation. It runs on its own M with `m.p == nil`. It cannot run user code (no P). Its loop wakes every ~20 µs to: retake Ps from blocked syscalls, force preempt long-running Gs, trigger background GC, drive the network poller wake. Uses atomics and short `sched.lock` acquisitions only.

### Q23. What is `_Psyscall` and how does it interact with sysmon?

**Outline**: When an M enters a syscall, its P is marked `_Psyscall` (not `_Pidle`). The M still "owns" the P in a soft sense: if the syscall returns quickly, `exitsyscall` CAS's the status back to `_Prunning` and continues. If sysmon observes a P stuck in `_Psyscall` for too long (~20 µs), it CAS's the P to `_Pidle`, links it onto `pidle`, and a fresh M can pick it up. The handoff means a slow syscall does not block other Gs that would have run on that P.

---

## Staff Level

### Q24. Explain the "delicate dance" at the end of `findrunnable`.

*What is being tested*: do you understand the subtle race conditions in the scheduler?

**Outline**: Between "found no work, about to park" and actually parking, work may become runnable elsewhere. To avoid sleeping with work available, `findrunnable`:
1. Tentatively releases its P to `pidle` and decrements `nmspinning`.
2. Re-checks every other P's runqueue (`runqempty(p2)` for each), the global queue, and netpoll.
3. If any are non-empty, re-acquires a P and retries.
4. If everything is empty, parks on `m.park`.

The race: another M could push work to a runqueue *between* steps 2 and 4. The `wakep` they call sees `nmspinning == 0` (we already decremented) and `npidle > 0`, so it will wake an M. Either we get a fresh wake, or we observe the work in step 2. The dance closes the gap.

### Q25. Why does `pp.runnext` use CAS instead of a plain store?

**Outline**: Other Ps can steal `runnext` via CAS during later passes of `findrunnable`. The owning P also writes via CAS to set or clear it. Both must agree atomically on its value. A plain store would race: the owner writing nil after a successful steal would clobber the stealer's CAS.

### Q26. How does `_Gpreempted` differ from `_Gwaiting`?

**Outline**: `_Gpreempted` is for goroutines suspended *involuntarily* by the async preemption mechanism (SIGURG). The G is not in any wait queue; it has no `unlockf`. To resume it, `goready` transitions it to `_Grunnable` and queues normally. `_Gwaiting` is for *voluntary* parks (channel/mutex/sleep/IO); the G is in some wait queue. Resumption is via `goready` after the wait condition is met, with `unlockf` having previously released any held lock.

### Q27. Walk me through what `runtime.GOMAXPROCS(n)` does.

**Outline**:
1. Validates `n >= 1`.
2. If unchanged, returns immediately.
3. Calls `stopTheWorld("GOMAXPROCS")` — every P stops at a safe point in `_Pgcstop`.
4. Calls `procresize(n)`:
   - Grows `allp[]` if needed.
   - Initializes new P structs (caches, runqueues).
   - For shrinks: drains caches of removed Ps back to centrals; moves their runqueue contents to the GRQ; marks `_Pdead`.
5. Updates `gomaxprocs`.
6. Calls `startTheWorld()` — Ps resume.

The function is expensive (STW); calling it on the hot path is harmful.

### Q28. Describe the lock rank order around the scheduler.

**Outline**: In `runtime/lockrank.go`:
- Lowest: `sysmon`, `defer`, `sudog`.
- Middle: `sched.lock`, `allp`, `allg`.
- Higher: `hchan.lock`, `mheap.lock`, `notifyList`.

Rule: do not acquire higher ranks while holding lower. Channel code releases `hchan.lock` before calling `goready`, because `goready` may need `sched.lock` (lower rank). Violation would deadlock with another path that locks them in the opposite order.

### Q29. What problems did the pre-G-M-P scheduler have?

**Outline**:
- Single global runqueue; `sched.lock` was hot.
- Memory allocator's central free list also lock-contended.
- No work-stealing; load imbalance across Ms.
- Throughput plateaued around `GOMAXPROCS=4`.
- Benchmarks in Vyukov's 2012 proposal showed 2-3x slowdown vs the proposed design at `GOMAXPROCS=16`.

The fix factored the global state into per-P slices (runqueue, allocator cache, sudog pool, defer pool), introducing the P struct as the owning context. Hot paths became lock-free.

### Q30. How would you debug "my Go program uses 200 OS threads"?

**Outline**:
1. Likely cause: many goroutines making slow syscalls or cgo calls. Each blocked M needs a replacement to keep Ps busy.
2. Tools:
   - `GODEBUG=schedtrace=1000,scheddetail=1` to see per-M state.
   - `runtime/pprof` block profile for sync.WaitGroup-like blocks (not the cause).
   - `pprof` mutex profile for runtime mutex contention.
   - Strace the process to find which syscalls are slow.
3. Common fixes: replace blocking calls with non-blocking + netpoll, reduce concurrent cgo invocations, use `sync.Pool` to batch work, throttle the number of in-flight slow operations.
4. As a last resort, `debug.SetMaxThreads(n)` caps the M count — but the program will `fatal` if it tries to exceed; the cap is not a fix, it's a tripwire.

### Q31. What is the cost of creating a new M?

**Outline**: One `clone(2)` syscall on Linux (CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND | CLONE_SYSVSEM | CLONE_THREAD), kernel allocates a new task struct and stack, runtime initializes g0 and the `m` struct (~few KiB). Total: 10s of microseconds. Once created, Ms are kept in `sched.midle` for reuse; they almost never die. So the cost is amortised. But the *first* time you create a million-goroutine program with cgo, the M creation burst is visible in startup time.

### Q32. How does the scheduler interact with the GC?

**Outline**:
- GC stop-the-world: every P transitions to `_Pgcstop` at a safe point. The runtime waits for all Ps to acknowledge.
- GC mark workers: dedicated Gs run as `gcMarkWorker` on Ps that don't have higher-priority user work. They count against `GOMAXPROCS`.
- Mark assist: user Gs that allocate fast contribute mark work proportional to allocation rate; this credit is tracked per-G in `gcAssistBytes`.
- Write barriers: GC write barrier flushes to per-P `wbBuf`; the buffer is drained by `gcw`.
- Stack scanning: each G's stack is scanned (often by the G itself when it transitions to `_Gscan|_Grunning`).

The scheduler and GC share `sched.lock` for the stop coordination; otherwise they run mostly independently via per-P state.

---

## Closing Notes

If you can answer Q1-Q14 confidently, you have a middle-level grip on the scheduler.

If you can answer Q15-Q23 confidently, you can debug a production Go server's scheduler issues.

If you can answer Q24-Q32 confidently, you can contribute fixes upstream to `runtime/proc.go`.

The questions are deliberately phrased the way real Go-runtime interviewers phrase them. The "outline" answers are what you should be able to produce; the interviewer will probe for the details behind each bullet.
