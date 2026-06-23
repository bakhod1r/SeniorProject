# Go Runtime GMP — Interview Questions

> Questions from junior to staff. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What do G, M, P stand for in the Go scheduler?

**Model answer.** G is a *goroutine* — the smallest unit of independently scheduled work. M is a *machine* — an OS thread. P is a *processor* — a logical execution context that holds a run queue and is required to execute Go code. The Go scheduler multiplexes many G's onto a few M's, with P's acting as the gating resource.

**Common wrong answers.**
- "M is the main thread." (No, M is any OS thread the runtime creates.)
- "P stands for process." (No, it stands for processor, which is a logical concept, not an OS process.)

**Follow-up.** *How many P's exist?* — As many as `GOMAXPROCS`, which defaults to `runtime.NumCPU()`.

---

### Q2. What does `GOMAXPROCS` control?

**Model answer.** It controls the maximum number of OS threads that can execute user-level Go code simultaneously. Equivalently, it is the number of P's. Default since Go 1.5 is `runtime.NumCPU()`. Setting it lower reduces parallelism but does not affect concurrency.

**Follow-up.** *When should you set it manually?* — When the Go runtime cannot detect the actual CPU quota (older Go in containers without cgroup detection), or for testing single-core behaviour.

---

### Q3. Why can a Go program have 100 000 goroutines but only a handful of OS threads?

**Model answer.** Goroutines are scheduled by the Go runtime, not by the OS. Many goroutines share each OS thread. When a goroutine blocks on I/O or a channel, the runtime parks it and switches the thread to another goroutine. This is the M:N model — many G's on N M's, gated by `GOMAXPROCS` P's.

**Follow-up.** *What about syscalls?* — Syscalls do block the OS thread (M). The runtime detaches the P and gives it to another M so other goroutines keep running.

---

### Q4. What is "work stealing"?

**Model answer.** When a P's local run queue is empty, the M running on it tries to steal half of another P's run queue. Stealing is randomised across P's; if all are empty, the M checks the global queue, then netpoll, then parks. Work stealing keeps cores busy under uneven load.

**Follow-up.** *Why half, not one?* — Stealing one would force frequent return trips. Stealing half gives the stealer significant work and balances load efficiently.

---

### Q5. What is `sysmon`?

**Model answer.** `sysmon` is a special M (system monitor) that runs without a P. It wakes every 20 µs (initially) or 10 ms (when idle) to perform background tasks: detecting long-running goroutines (and triggering preemption), retaking P's from M's stuck in syscalls, triggering GC, doing background netpoll. Crucial for keeping the scheduler responsive.

---

## Middle

### Q6. What happens when a goroutine calls a blocking syscall?

**Model answer.** The M making the syscall is blocked in the kernel. For short syscalls, the P stays attached to the M (cheap to wait). If the syscall exceeds ~20 µs, sysmon detaches the P and gives it to another (parked or new) M so other goroutines can run. When the syscall returns, the original M tries to reacquire any free P; if none, the G goes to the global queue and the M parks.

**Follow-up.** *Does this apply to network reads?* — No. Network I/O goes through the netpoll, which avoids blocking the M.

---

### Q7. Explain the netpoll.

**Model answer.** The netpoll is the integrated network event poller (epoll on Linux, kqueue on BSD, IOCP on Windows). When a goroutine does `conn.Read`, the runtime sets the FD non-blocking, registers it with the poller, and parks the goroutine. The M moves on. When the FD becomes ready, the poller wakes the goroutine. This lets thousands of concurrent connections share a few OS threads.

**Follow-up.** *Why does file I/O not use netpoll?* — Most operating systems do not support truly async file I/O efficiently. Linux io_uring helps but Go does not (as of 1.22) integrate it.

---

### Q8. How does async preemption work in Go 1.14+?

**Model answer.** Sysmon notices a goroutine has been running on its M for more than 10 ms. It sends `SIGURG` to the M. The signal handler runs `runtime.asyncPreempt`, which examines the G's PC, finds a safe point (using compiler-emitted metadata), saves register state, and yields to the scheduler. The G's state is restored when it is rescheduled.

This means tight CPU loops without function calls are now preemptible.

**Follow-up.** *Before 1.14, what would happen?* — A tight loop without function calls could starve other goroutines. The scheduler only preempted at function-entry safe points, so a loop body with no calls had no preemption window.

---

### Q9. What is the difference between `runtime.LockOSThread` and OS-level CPU pinning?

**Model answer.** `LockOSThread` pins a goroutine to its OS thread but the OS can still move that thread between CPU cores. To pin to a specific core, you also need OS-level affinity (e.g., `sched_setaffinity` on Linux, often called from Cgo). `LockOSThread` is about thread identity (for thread-local C state); CPU pinning is about cache locality and predictable timing.

---

### Q10. When does Go create a new OS thread?

**Model answer.** When:

1. The runtime starts (one initial M for `main`).
2. A goroutine enters a syscall and another G is runnable on the freed P — the runtime needs an M to run that G.
3. The number of M's spinning (searching for work) is zero and there is work waiting.
4. Sysmon decides to start one (rare).

M's are pooled. Once created, parked M's are reused before new ones are created.

---

### Q11. How do you diagnose a goroutine leak?

**Model answer.** Several techniques:

1. Track `runtime.NumGoroutine()` over time. Sustained growth = leak.
2. Use `pprof goroutine` profile: `go tool pprof http://localhost:6060/debug/pprof/goroutine`. Shows call stacks of every live goroutine.
3. Use `goleak` in tests: `go.uber.org/goleak` snapshots goroutines before and after; failures indicate leaks.
4. Look for goroutines stuck on a `chan` send/receive that should have completed.

Common leak sources: never-closed channels, missing context cancellation, blocking on a slow downstream with no timeout.

---

### Q12. What does `GODEBUG=schedtrace=1000` do?

**Model answer.** Every 1000 ms, the Go runtime prints a one-line scheduler summary: `GOMAXPROCS`, idle / spinning thread counts, global queue length, per-P queue lengths. Useful for understanding scheduler behaviour without intrusive profiling.

With `scheddetail=1`, you also get per-G, per-M, per-P verbose state.

---

## Senior

### Q13. A Go service in a Kubernetes pod is slow but Go-side metrics look fine. What do you check?

**Model answer.** Likely a `GOMAXPROCS` mismatch with the cgroup CPU quota. The Go runtime (pre-1.21) defaults to host CPU count, ignoring the cgroup limit. The kernel throttles the container; Go is unaware.

Checks:
- `runtime.GOMAXPROCS(0)` value.
- Container CPU quota: `cat /sys/fs/cgroup/cpu.max`.
- Kubernetes pod CPU limits.
- Throttling metrics: `container_cpu_cfs_throttled_periods_total`.

Fix: use `github.com/uber-go/automaxprocs` or upgrade to Go 1.21+.

---

### Q14. How does GC affect the scheduler?

**Model answer.** Go's GC is mostly concurrent — most marking and sweeping happens while goroutines run. There is a brief stop-the-world (STW) phase, typically <100 µs for typical heaps, to mark the start of GC. During STW, all goroutines pause and all P's are in `_Pgcstop`.

After STW, GC runs concurrently with user code. Worker goroutines (`gcBgMarkWorkers`) run on each P, sharing time with user goroutines.

Latency-sensitive services notice STW pauses. Tune with `GOGC` (trigger frequency), `GOMEMLIMIT` (memory cap), or reduce allocation rate.

---

### Q15. Walk through what happens when 1000 goroutines all simultaneously do `conn.Read` on different sockets.

**Model answer.**

1. Each goroutine calls `conn.Read`. The underlying FD is set non-blocking.
2. Each `read()` syscall returns `EAGAIN` (no data yet).
3. Each FD is registered with epoll for read events.
4. Each goroutine is parked.
5. The M's continue running other goroutines (or park if none).
6. As packets arrive, epoll fires. The runtime's poller goroutine wakes the corresponding parked goroutines.
7. Woken goroutines go to the local P's run queue (or global if none has space).
8. The M's pick them up and resume `Read`, which now returns data.

The result: 1000 concurrent sockets handled by a few OS threads. The cost is the netpoll registration (~1 µs per FD) and the wake (~500 ns each).

---

### Q16. A profile shows high time in `runtime.findrunnable`. What does this indicate?

**Model answer.** `findrunnable` is the scheduler's "find more work" function. Time there means M's are repeatedly searching for goroutines to run — typically because:

1. **Low concurrency relative to GOMAXPROCS.** Fewer runnable goroutines than P's; M's spin looking for work.
2. **High goroutine churn.** Many short-lived goroutines; M's exit `schedule()` to find a new G frequently.
3. **Work stealing failing.** All queues are empty; M's repeatedly try the global queue and netpoll.

If your service is not CPU-bound but `findrunnable` is high, you may be over-provisioned. Try lowering `GOMAXPROCS` to match active concurrency.

---

### Q17. When would you use `runtime.LockOSThread`?

**Model answer.** Several legitimate cases:

1. **Cgo with thread-local state.** OpenGL contexts, certain JNI bridges, libraries that use `pthread_key_t`.
2. **System calls requiring thread identity.** `signalfd`, `personality`, some `prctl` operations.
3. **Foreign main-thread requirements.** GTK, Cocoa, Win32 UI frameworks require certain operations on the main thread.
4. **Latency-critical code.** Combined with OS-level CPU affinity, you can keep a goroutine on a specific core for predictable timing.

Costs: the goroutine occupies an M exclusively, the runtime cannot move it, and many locked goroutines can exhaust OS thread limits.

---

### Q18. How would you investigate why `GOMAXPROCS=16` does not give 16x speedup on a CPU-bound benchmark?

**Model answer.** Several suspects:

1. **Amdahl.** Identify serial fractions: locks, single-DB connection, single goroutine doing final aggregation.
2. **Memory bandwidth.** Use `perf stat -e cache-misses,instructions` to see if cores are starved for memory.
3. **False sharing.** Padding shared structs to cache lines.
4. **Lock contention.** `runtime.SetMutexProfileFraction(1)` then `pprof -mutex`.
5. **GC.** Frequent GC steals CPU. Look at `go_gc_duration_seconds`.
6. **Cache invalidation between cores.** Reduce cross-core writes.
7. **Container throttling.** Check cgroup CPU limits.

Profile, hypothesise, measure.

---

## Staff

### Q19. Design a Go service that handles millions of concurrent WebSocket connections. What scheduler-related decisions matter?

**Model answer.** Key concerns:

1. **One goroutine per connection.** Standard pattern; netpoll handles the I/O.
2. **Goroutine memory.** With 1M goroutines × 2 KB stack = 2 GB just for stacks. Plus closures, plus channels. Plan memory accordingly.
3. **Goroutine count limits.** The scheduler handles ~1M runnable goroutines reasonably; parked goroutines are cheaper. Most connections are idle, so this works.
4. **`GOMAXPROCS`.** Match to actual CPU. Likely 4–16 cores; do not crank up.
5. **Network poller scale.** epoll handles millions of FDs efficiently on Linux; verify `ulimit -n` allows.
6. **Per-connection state.** Keep small; large state per goroutine multiplied by 1M is huge.
7. **Heartbeat / liveness.** Avoid timer-per-connection (each timer is a runtime cost). Use bucketed timers or `time.AfterFunc` carefully.
8. **Backpressure.** A flood of messages can overwhelm downstream; cap with bounded channels.
9. **GC pressure.** Reduce allocations on the hot path; reuse buffers via `sync.Pool`.
10. **Operational visibility.** Goroutine count metric, FD count, memory stats, GC pause times.

---

### Q20. Critique this assertion: "Go's scheduler is preemptive and fair like the OS scheduler."

**Model answer.** Partially right, mostly subtle:

- **Preemptive.** Yes since 1.14, via async preemption. A goroutine running > 10 ms gets a `SIGURG`.
- **Fair.** Roughly fair over the long run, but no strict priority system. No SLAs on individual goroutine scheduling latency. A goroutine on the global queue can wait microseconds longer than one on a P's local queue.
- **Like the OS scheduler.** Less rich than Linux's CFS. No nice values, no real-time priority classes, no CPU bandwidth controls. The Go scheduler trades richness for simplicity and speed.

For most application code, "preemptive and fair" is accurate enough. For latency-critical work, you need to understand the nuances.

---

### Q21. Walk through how the Go runtime makes channels work with the scheduler.

**Model answer.** A channel is an `hchan` struct with a lock, a ring buffer (if buffered), and wait queues for senders and receivers.

**Send (`c <- v`):**
1. Acquire `c.lock`.
2. If a receiver is waiting in `recvq`, copy `v` directly to the receiver's stack, unlock, wake the receiver.
3. Else if the buffer has space, copy `v` into the buffer, unlock.
4. Else, park the current goroutine: append to `sendq`, unlock, call `gopark` (the scheduler picks another G).

**Receive (`v := <-c`):**
Symmetric.

**Wake (`goready`):**
The runtime's `goready` puts the woken G on the waker's P's run queue. The G becomes runnable; the scheduler picks it up.

**Why this matters:** channel operations integrate with the scheduler at every park/wake. Heavy channel traffic puts pressure on these primitives. Optimisations like the buffered-direct-send fast path matter for performance.

---

### Q22. How do you measure scheduler latency in a production service?

**Model answer.** Several approaches:

1. **`runtime/metrics`.** The `/sched/latencies:seconds` metric is a histogram of "time from runnable to running." Export to Prometheus and alert on p99 spikes.
2. **`go tool trace`.** Captures every scheduler event. Take a 5-second trace during peak load; analyse gaps.
3. **Synthetic ping goroutines.** A goroutine that sleeps 10 ms, then measures actual elapsed wall time. Excess over 10 ms indicates scheduling delay.
4. **GC pause monitoring.** STW pauses correlate with scheduling latency. `go_gc_duration_seconds` histogram.
5. **Heartbeat goroutines.** Long-running goroutines that emit "I am alive" every 100 ms. Gaps indicate starvation.

For latency-critical services, all of these are valuable.

---

### Q23. A team proposes using `runtime.LockOSThread` for every request handler to "improve cache locality." Critique.

**Model answer.** Bad idea:

1. **Memory blow-up.** Each request goroutine occupies an M (OS thread). 10 000 concurrent requests = 10 000 threads, possibly exceeding `ulimit`.
2. **Reduced scheduler flexibility.** The scheduler cannot move locked goroutines, so it cannot balance load across P's.
3. **No locality benefit.** Modern CPUs share L3 cache; goroutines moving between cores in the same socket lose at most L1/L2 locality, which is small.
4. **Increased context switch cost.** OS-level switches between many threads are more expensive than goroutine switches within a thread.
5. **Misunderstanding.** Cache locality is improved by reducing memory access patterns and false sharing, not by pinning goroutines.

The team should profile to find the actual bottleneck. If cache locality matters, look at data layout, not thread pinning.

---

### Q24. Describe an interaction between the GC and the scheduler that surprised you.

**Model answer.** Multiple possible. One example: under heavy allocation rates, the GC's "mark assist" mechanism pulls user goroutines into helping with marking. A goroutine that allocates a lot does proportional GC work itself, taking CPU away from its actual task. This appears as latency spikes correlated with GC activity.

Fix: reduce allocation in the hot path (use `sync.Pool`, byte buffers, pre-sized slices). Or raise `GOGC` to reduce GC frequency at the cost of memory.

Another example: GC's stop-the-world phase is supposedly <100 µs but can be longer if there are many goroutines (each must be paused). Heavy goroutine counts amplify STW latency.

---

### Q25. How would you implement priority-aware scheduling on top of Go's scheduler?

**Model answer.** Go's scheduler does not support priorities natively. Some patterns:

1. **Separate worker pools.** High-priority workers separate from low-priority workers. The scheduler distributes them across P's; if high-priority pool is small, it gets prompt service.
2. **Channel-based prioritisation.** A worker reads from a high-priority channel before a low-priority one:
   ```go
   select {
   case hp := <-highPrio:
       process(hp)
   default:
       select {
       case hp := <-highPrio:
           process(hp)
       case lp := <-lowPrio:
           process(lp)
       }
   }
   ```
3. **Throttle low-priority via `time.Sleep` or rate limiter.** Make low-priority goroutines yield often.
4. **OS-level priority via Cgo.** `setpriority` or `sched_setscheduler` for the underlying thread. Loses scheduler flexibility.

None are as good as kernel-level priority scheduling, but the patterns work for typical use cases.

---

## Closing

Scheduler interview questions tend to be conceptual at junior level ("what is G/M/P?") and become operational at senior ("how did you diagnose this latency issue?"). Staff questions probe design judgement and the candidate's experience running Go in production.

The best preparation is to run Go in production, see what breaks, read the runtime source out of curiosity, and develop intuition for what the scheduler is doing on your behalf.
