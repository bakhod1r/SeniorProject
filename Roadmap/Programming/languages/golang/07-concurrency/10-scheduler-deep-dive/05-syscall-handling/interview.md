# Syscall Handling — Interview Questions

## Table of Contents
1. [How to Use This Page](#how-to-use-this-page)
2. [Intern / Junior Questions](#intern--junior-questions)
3. [Middle Questions](#middle-questions)
4. [Senior Questions](#senior-questions)
5. [Staff Questions](#staff-questions)
6. [Coding Exercises](#coding-exercises)
7. [Whiteboard Questions](#whiteboard-questions)
8. [Tips for Candidates](#tips-for-candidates)

---

## How to Use This Page

This page collects interview questions about Go's syscall handling, ranged by level. Use it to:

- **Prepare for an interview**: read the questions, draft your answers, compare with the suggested points.
- **Conduct an interview**: pick 3–5 questions per level; do not ask all of them.
- **Self-assess**: if you struggle on the middle questions, revisit [middle.md](middle.md).

Each question lists key points an answer should hit. There is no single right answer; depth matters more than exact wording.

---

## Intern / Junior Questions

### Q1: What is a system call?

**Key points**:
- A request from user-space code to the kernel.
- Switches the CPU to kernel mode (via the `syscall` instruction on x86-64).
- The calling thread is paused until the kernel returns.
- Examples: `read`, `write`, `open`, `close`.

### Q2: What happens to a goroutine when it makes a blocking syscall?

**Key points**:
- The goroutine itself is paused; the M is in the kernel.
- The runtime detaches the P from the M so other goroutines can run on a different M.
- This is called the "P handoff".
- When the syscall returns, the M tries to re-attach to a P; if none is free, the M parks.

### Q3: Why does a Go program with `GOMAXPROCS=4` sometimes have more than 4 threads?

**Key points**:
- `GOMAXPROCS` controls the number of Ps (concurrent execution units), not Ms.
- Each blocking syscall holds an M but releases the P.
- So you may have `GOMAXPROCS` Ms running Go code plus extra Ms in syscalls or cgo.
- Plus sysmon (one M), plus parked Ms in the pool.

### Q4: What is the difference between network I/O and file I/O from the runtime's view?

**Key points**:
- Network I/O uses the netpoller (epoll/kqueue/IOCP). Non-blocking; parks the goroutine without holding an M.
- File I/O uses the blocking-syscall path. Holds an M for the duration.
- This is why 50 000 TCP connections cost almost nothing, but 50 simultaneous large file reads cost 50 threads.

### Q5: What is sysmon?

**Key points**:
- A background goroutine that runs on its own M without a P.
- Runs periodically (every 20 µs to 10 ms).
- Tasks: trigger goroutine preemption, hand off Ps from syscalling Ms, force GC.

---

## Middle Questions

### Q6: Walk me through `entersyscall` step by step.

**Key points**:
- Mark G as `_Gsyscall`.
- Save the G's PC and SP for later inspection.
- Detach the P from the M (clear `m.p`, set `m.oldp`).
- Mark the P as `_Psyscall`.
- Notify sysmon if it was sleeping.
- Disable preemption via `m.locks++` during the transition.

### Q7: When does sysmon hand off a P that is in a syscall?

**Key points**:
- After the P has been in `_Psyscall` for > 10 µs.
- AND the P has runnable Gs, OR no spinning Ms exist (so handoff is needed for parallelism).
- Sysmon CAS-flips `pp.status` from `_Psyscall` to `_Pidle` and calls `handoffp`.

### Q8: What is the fast path vs the slow path in `exitsyscall`?

**Key points**:
- Fast: CAS `oldp.status` from `_Psyscall` to `_Pidle`, re-attach. Runs entirely in user space.
- Slow: if `oldp` was handed off (CAS fails), try to grab any idle P. If no P available, the M parks and the G goes on a runqueue.
- Fast path is ~50 ns; slow path is ~1 µs.

### Q9: Why does cgo behave like a blocking syscall?

**Key points**:
- The C function runs on the M for an unknown duration.
- The M cannot be reused for other goroutines while in cgo.
- The runtime calls `entersyscall` before the C function, detaching the P.
- C may have thread-local state, install signal handlers, etc., so the M cannot be migrated.

### Q10: What is `_Psyscall`?

**Key points**:
- A P state where the M is in a syscall.
- The M is still nominally attached to the P (via `m.oldp`), but the P is available for handoff.
- Sysmon checks for `_Psyscall` Ps and hands them off after 10 µs.

### Q11: What is the netpoller doing on Linux?

**Key points**:
- Maintains an epoll file descriptor.
- Each network fd is registered with `EPOLLIN | EPOLLOUT | EPOLLET`.
- When a goroutine does a non-blocking read that returns `EAGAIN`, it parks via the netpoller.
- The scheduler periodically calls `epoll_wait` to find ready fds and unpark waiting goroutines.

### Q12: Why is `epoll` not enough for file I/O?

**Key points**:
- On Linux, `epoll` on regular files always reports them as "ready".
- Real disk reads still block in the kernel.
- So Go cannot use `epoll` for files; it falls back to the blocking-syscall path.
- `io_uring` (kernel 5.1+) could solve this, but Go does not use it as of Go 1.22.

### Q13: What is a VDSO syscall?

**Key points**:
- A "syscall" implemented in user space, in code mapped by the kernel into every process.
- Examples: `clock_gettime`, `gettimeofday`, `getcpu`.
- The Go runtime uses VDSO for `time.Now()`, etc. — no `entersyscall` overhead.

---

## Senior Questions

### Q14: A Go service in a Kubernetes pod with `cpu: 500m` is using 10× more CPU than expected. What might be wrong?

**Key points**:
- `GOMAXPROCS` may be set to the node's CPU count instead of the container's quota.
- On Go 1.16+ Linux, the runtime reads cgroup v2 quota correctly. Earlier versions need `automaxprocs`.
- Symptoms: scheduler thrash, GC variability, high context switches.
- Fix: log `runtime.GOMAXPROCS(0)` at startup; verify it matches CPU quota.

### Q15: Your cgo-heavy service is exceeding `pids.max` in a container and panicking. How do you fix it?

**Key points**:
- Cgo calls hold Ms; unbounded concurrency causes M explosion.
- Bound cgo concurrency with a semaphore (channel) before each cgo call.
- Alternative: a worker pool with a fixed number of pinned goroutines.
- Long-term: batch cgo calls, reduce the number of underlying calls.

### Q16: A file-I/O heavy workload shows climbing thread count and degraded latency. Diagnose.

**Key points**:
- File reads do not use the netpoller; each holds an M.
- If concurrency is unbounded, you spawn one M per in-flight read.
- Tail latency rises because the kernel queues I/O at the device.
- Fix: bound concurrency with a semaphore (sized to disk parallelism, ~4–16).

### Q17: When should you use `LockOSThread`?

**Key points**:
- For OS APIs that are thread-scoped: `setns`, `prctl`, `sched_setaffinity`.
- For thread-affine C libraries: OpenGL, CUDA, GnuTLS.
- For long-lived workers in a cgo pool (ensures the M is stable for the C library).
- NOT for goroutine identity (use `context.Context` instead).
- NOT for general concurrency control (use channels/mutexes).

### Q18: What happens if a `LockOSThread`'d goroutine exits without unlocking?

**Key points**:
- The runtime treats the M as compromised (because the locked goroutine may have modified OS state).
- The M is destroyed, not pooled for reuse.
- Repeated lock-without-unlock leaks Ms steadily.
- Mitigation: `defer runtime.UnlockOSThread()` immediately after `LockOSThread`.

### Q19: Why might `time.Now()` be slow on some systems but fast on others?

**Key points**:
- On Linux/x86-64, `time.Now()` is a VDSO call (~20 ns).
- Some containers hide the VDSO; falls back to real syscall (~300 ns).
- On older kernels or unusual platforms (no VDSO), it is a real syscall.
- Older virtualization (without kvm-clock) used to be slower; rare today.

### Q20: A service does `os.ReadFile` in 1000 goroutines and you see ~500 threads. Is this normal?

**Key points**:
- File reads hold an M each. 1000 reads → up to 1000 Ms briefly.
- Reaching 500 suggests reads complete fast enough that the M pool churns.
- Below `GOMAXPROCS` plus some headroom is the "active" set; the rest is in syscalls.
- Not necessarily broken; just bounded by the M pool dynamics.
- If sustained, fix with a semaphore.

---

## Staff Questions

### Q21: Design a service that does heavy disk I/O, heavy cgo, and serves 10 000 concurrent HTTP requests. Discuss thread/goroutine layout.

**Key points**:
- Three lanes: HTTP (netpoller, unbounded goroutines), file I/O (semaphore-bounded), cgo (pinned worker pool).
- File I/O semaphore: ~`disk parallelism` (4–16).
- Cgo workers: `GOMAXPROCS` to ~2× depending on whether cgo is CPU-bound.
- HTTP handlers dispatch to lanes via channels.
- Backpressure: shed load at HTTP level when lanes are full.
- Monitor `/sched/threads:threads`, `/sched/goroutines`, p99 latency per lane.

### Q22: Explain the lock-free CAS between sysmon's handoff and `exitsyscallfast`.

**Key points**:
- Both sides try to CAS `pp.status` from `_Psyscall` to `_Pidle`.
- Only one wins.
- If sysmon wins: hands off via `handoffp`; the syscalling M takes the slow path on return.
- If exitsyscall wins: re-attaches `oldp`; fast path completes.
- No `sched.lock` taken in the fast case.
- This is what makes high-volume short syscalls cheap.

### Q23: A service has thread count climbing slowly over days, eventually OOM. What categories of bug should you investigate?

**Key points**:
- `LockOSThread` without `UnlockOSThread` — M leak.
- Cgo callbacks from C threads that never return — Go runtime spawns Ms to attach to them.
- A library spawning its own pthreads (not via Go).
- M pool growth from sustained high concurrency.
- Tools: `pprof.threadcreate`, `/proc/self/status`, GODEBUG=schedtrace.

### Q24: How would you implement a "cooperative" yield in user space without kernel involvement, like `runtime.Gosched`?

**Key points**:
- The runtime maintains a runqueue per P.
- `Gosched` requeues the current G at the end of the runqueue and calls `schedule()`.
- `schedule()` pops the next runnable G and executes it.
- This is all user-space scheduling; no syscall involved.
- Useful for fairness in tight loops (pre-1.14 era).
- Less useful since async preemption (Go 1.14+).

### Q25: A goroutine on a network connection appears to "hang" — no data flowing, but the connection is open. What runtime mechanics might be involved?

**Key points**:
- The goroutine is parked in the netpoller waiting for fd readiness.
- The kernel has not reported the fd as ready.
- Possible causes: peer not sending, network drop, TCP keepalive interval long, dead peer with no FIN.
- Diagnose with `ss -i`, tcpdump, application-layer keepalives.
- Implement read timeouts via `SetReadDeadline` to escape the parked state.

---

## Coding Exercises

### Exercise 1: Bounded file reader

Write a `BoundedReadFile(paths []string, n int) [][]byte` function that reads N files concurrently. Bound the in-flight file syscalls to `n`. Return results in input order.

**Solution sketch**:
```go
func BoundedReadFile(paths []string, n int) [][]byte {
    results := make([][]byte, len(paths))
    sem := make(chan struct{}, n)
    var wg sync.WaitGroup
    for i, path := range paths {
        wg.Add(1)
        sem <- struct{}{}
        go func(idx int, p string) {
            defer wg.Done()
            defer func() { <-sem }()
            data, _ := os.ReadFile(p)
            results[idx] = data
        }(i, path)
    }
    wg.Wait()
    return results
}
```

Discussion: why bound? Because file reads hold Ms. Why preserve order? So the API is intuitive.

### Exercise 2: Cgo worker pool

Implement a `Pool` that runs C-style work (just simulated via `time.Sleep`) on N pinned workers. Each call blocks until a worker is free. Provide a `Context`-aware API.

**Solution sketch**: see the worker-pool example in [senior.md](senior.md).

### Exercise 3: Thread count tracker

Write a goroutine that, every second, logs the current thread count (from `/proc/self/status` on Linux). Use it to instrument a program that does both file I/O and network I/O. Show the difference in thread growth.

### Exercise 4: Detect a leaked M

Write a program that intentionally leaks Ms via unbalanced `LockOSThread` and demonstrate that thread count grows over time. Then add a fix using `defer runtime.UnlockOSThread()`.

---

## Whiteboard Questions

### W1: Draw the state transitions for a goroutine that does a syscall and gets handed off.

Expected diagram: `_Grunning` → `_Gsyscall` (entersyscall) → slow path: `_Grunnable` (on runqueue) → `_Grunning` (resumed on different M).

### W2: Draw the M, P, G layout for a service with 10 000 TCP connections idle, 50 file reads in flight, and 20 cgo calls in flight. GOMAXPROCS=8.

Expected: 4 Ps with running Ms (active work), some Ms in syscalls (file reads + cgo), ~10 000 Gs parked in netpoller, ~50 Gs in syscall (file), ~20 Gs in cgo state. Approximate thread count: 8 + 50 + 20 + sysmon + pool = ~80.

### W3: Show what happens during `entersyscall` if `GOMAXPROCS=1` and only one G exists.

Expected: G goes `_Gsyscall`. P detaches. P sits idle with empty runqueue. M goes into kernel. sysmon notices but does nothing (no work to do, no need to start another M). When syscall returns, exitsyscall fast path re-attaches. Service runs as if syscall was synchronous from the goroutine's perspective.

---

## Tips for Candidates

- **Know the two paths**: network (netpoller) vs blocking (entersyscall). Many candidates conflate them.
- **Use the right vocabulary**: G, M, P, handoff, `_Psyscall`, sysmon. Sloppy terms confuse interviewers.
- **Quantify**: "10 µs sysmon threshold", "epoll edge-triggered", "10000-thread default cap". Numbers make answers credible.
- **Draw**: when in doubt, draw the state machine or the M/P/G diagram.
- **Connect to systems**: tie answers to `top` output, pprof, `GODEBUG=schedtrace`. Shows you have actually used this in practice.
- **Be honest about limits**: "I'm not sure of the exact line in runtime, but it's in `proc.go` near `retake`" is better than fabricating.
- **For staff-level**: emphasize design trade-offs. Why bound to 8 file I/O workers? Because disk parallelism is ~8. Why pin cgo workers? Because the C library has thread-local state. Always have a "why".
