# Goroutines vs OS Threads — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is the difference between a goroutine and an OS thread?

**Model answer.** An OS thread is a kernel-managed unit of execution. The OS allocates it, schedules it on CPU cores, and tracks it in kernel data structures. A goroutine is a user-space unit of execution managed by the Go runtime. Goroutines are multiplexed onto OS threads by the runtime's scheduler. A goroutine starts with a ~2 KB stack; an OS thread starts with ~1–8 MB. Goroutine creation is ~100× cheaper than thread creation.

**Common wrong answers.**
- "A goroutine is a kind of thread." (No — it is one layer above.)
- "Goroutines are faster threads." (Loose; the right framing is "goroutines are user-space and cheaper to create.")
- "One goroutine per thread." (Wrong by design; Go is M:N.)

**Follow-up.** *Why is the Go runtime able to create goroutines so much faster?* — Because the runtime does not need to ask the kernel for anything. Creating a goroutine is a function call and a push to a runqueue — all user-space.

---

### Q2. What does `GOMAXPROCS` control?

**Model answer.** It is the maximum number of OS threads that may simultaneously execute Go code. By default it equals `runtime.NumCPU()` (and since Go 1.16 on Linux, it respects cgroup CPU quota). Setting `GOMAXPROCS=1` allows only one thread to run Go code at any instant — concurrency without parallelism.

**Common wrong answer.** "It limits how many goroutines I can have." (No — that is unbounded.)

**Follow-up.** *Why might a Go program show more threads in `top` than `GOMAXPROCS`?* — Some Ms are parked in syscalls; sysmon and netpoller have their own Ms; GC workers spawn extras.

---

### Q3. What happens when a goroutine calls a blocking syscall like `read`?

**Model answer.** The runtime detaches the P (scheduler context) from the M (thread) calling the syscall. The M is now stuck in the kernel; the runtime grabs another M (or creates one) and attaches the orphaned P, so other goroutines continue to be scheduled. When the syscall returns, the M tries to re-attach to a P; if none is available, the M parks itself and the goroutine is queued for resumption.

**Common wrong answer.** "The thread is blocked, so other goroutines are blocked too." (No — that is the whole point of the handoff.)

**Follow-up.** *Does this apply to network reads?* — Network I/O is even cheaper: it goes through the netpoller, which uses non-blocking `epoll` / `kqueue` / IOCP. No M is held at all while a goroutine is parked on network I/O.

---

### Q4. Why do you sometimes need `runtime.LockOSThread`?

**Model answer.** Some OS APIs or C libraries hold *thread-local state*: OpenGL contexts, certain crypto sessions, Linux's `setns` or `unshare`, signal masks. If a goroutine drifts between threads, those calls land on the wrong thread and break. `runtime.LockOSThread` pins the calling goroutine to its current OS thread, so all subsequent calls happen on the same thread.

**Follow-up.** *What is the cost?* — That thread cannot run any other goroutine. The Go scheduler loses flexibility. Use sparingly.

---

### Q5. Can I have a million goroutines?

**Model answer.** Yes — practically and routinely. Each goroutine costs ~2 KB initially. A million goroutines is ~2 GB of memory, fits on a normal server. A million OS threads is impossible — each thread would need ~1 MB of stack, totalling ~1 TB of virtual address space.

**Follow-up.** *What is the actual limit?* — Memory, primarily. Plus the runtime's bookkeeping overhead. The practical maximum is in the tens of millions on a large server, but most production code stays well under 100 K.

---

### Q6. What is the M:N scheduling model?

**Model answer.** M user-space tasks (goroutines, the "M" count) are mapped onto N kernel threads (the "N" count). Go uses M:N. Java pre-21 used 1:1 (one thread per `Thread`). Java 21+ added virtual threads (Project Loom), also M:N. Python with the GIL is essentially 1:N where N=1 because of the global lock. The benefit of M:N is many cheap user-space tasks; the runtime handles multiplexing.

---

## Middle

### Q7. Why does my Go program in Kubernetes have `GOMAXPROCS=64` when my pod limit is 0.5 CPU?

**Model answer.** Pre-1.16 Go did not read cgroup CPU quotas; it used the node's CPU count. A pod limited to 0.5 cpus on a 64-core node sets `GOMAXPROCS=64`. The kernel CFS throttles the pod, so throughput is unchanged, but the runtime creates 64 Ps competing for 0.5 cpus — massive scheduler thrash. Fix: upgrade to Go 1.16+ on Linux (cgroup-aware) or use `go.uber.org/automaxprocs`.

**Follow-up.** *How would you detect this issue from inside the running pod?* — Log `runtime.GOMAXPROCS(0)` and `runtime.NumCPU()` at startup. If they are wildly different from the pod's allocation, you have the bug.

---

### Q8. Walk through how `entersyscall` and `exitsyscall` work.

**Model answer.**

1. The compiler / runtime instruments syscall wrappers (e.g., `syscall.Read`) to call `runtime.entersyscall` before, `runtime.exitsyscall` after.
2. `entersyscall` changes the G's state to `_Gsyscall` and the P's state to `_Psyscall`. The M detaches from the P (the P's `m` field is cleared) but stays attached to the M's `oldp`.
3. The M makes the syscall. It is now blocked in the kernel.
4. `sysmon`, running every ~20 µs, scans Ps. If a P has been in `_Psyscall` for > 10 µs, sysmon calls `handoffp` to give the P to a fresh M.
5. When the syscall returns, `exitsyscall` runs. It tries to re-attach the M to `oldp` (fast path). If that fails, the slow path parks the M and queues the G.

The handoff is what keeps a Go program scheduling under heavy syscall load.

---

### Q9. What is a cgo M-creation storm?

**Model answer.** Each cgo call (`C.foo()`) holds an M for its entire duration — the Go runtime cannot safely interrupt or migrate it. If many goroutines simultaneously make blocking cgo calls, each holds an M. The runtime spawns more Ms (via `clone(2)`) to keep `GOMAXPROCS` runnable Gs scheduled. Thread count can grow from ~10 to several hundred in seconds. Recovery: after the calls return, parked Ms are reused or destroyed.

**Mitigation.** Bound cgo concurrency with a semaphore. Or use a single owner goroutine pinned via `LockOSThread` that processes all cgo work from a channel.

---

### Q10. Why does `time.Sleep(1 * time.Hour)` not consume an OS thread?

**Model answer.** The runtime's timer subsystem parks the goroutine and registers a timer. The goroutine state becomes `_Gwaiting`. No M is held. When the timer expires (driven by the runtime's timer-thread / netpoller), the goroutine is re-queued. Compare to Java's `Thread.sleep`, which holds the OS thread.

**Follow-up.** *What about `runtime.Gosched`?* — That yields, allowing other goroutines to run, but the calling goroutine resumes immediately when other work is done. Different mechanism; same M is reused.

---

### Q11. What is the netpoller and why does it matter?

**Model answer.** The netpoller is a Go runtime component that uses non-blocking I/O plus `epoll` (Linux), `kqueue` (BSD/macOS), or `IOCP` (Windows). When a goroutine calls `conn.Read` and data is not ready, the runtime registers the fd with the netpoller and parks the goroutine. No M is held. When the kernel signals the fd is ready, the netpoller wakes the goroutine.

Effect: 50 000 idle network connections cost ~50 000 goroutines (~100 MB memory) and ~one M. Without the netpoller, you would need 50 000 threads — impossible.

**Follow-up.** *Does the netpoller work for disk reads?* — No. Linux `epoll` on regular files is broken (always reports "ready"). Disk reads go through the blocking syscall path, holding an M.

---

### Q12. Why do Go programs not expose goroutine IDs?

**Model answer.** Two reasons:

1. **Anti-pattern prevention.** External APIs that take a goroutine ID would invite "cancel this goroutine," "get this goroutine's stack," etc. — patterns that lead to races and corruption. Go's design is cooperative cancellation (`context.Context`) only.
2. **Reuse.** The runtime recycles `g` structs from a free list. A `goid` is not a stable identifier across runs.

If you need a per-request identifier, propagate it via `context.Context`. Some debug tools parse `runtime.Stack` to extract `goid`, but this is fragile and slow.

---

### Q13. How do you find the OS thread count of a Go program?

**Model answer.** On Linux: `cat /proc/<pid>/status | grep Threads`. Or `ls /proc/<pid>/task | wc -l`. Or `top -H -p <pid>`.

From inside the program: read `/proc/self/status` (Linux), or use OS-specific syscalls on other systems. Go 1.21+ exposes `/sched/gomaxprocs:threads` via `runtime/metrics` but no direct "total threads" metric. Some teams write a sidecar that reads `/proc` periodically.

---

### Q14. Why might a service show high CPU but low throughput on a NUMA machine?

**Model answer.** Goroutines move between threads, threads move between cores. On a multi-socket machine, a goroutine that ran on socket 0 and is now scheduled on socket 1 has lost its L1, L2, and LLC cache locality. Synchronisation that bounces between sockets pays ~10× the latency. Mitigation: pin the process to one NUMA node (`numactl`), reduce `GOMAXPROCS` to per-socket core count, shard work by NUMA node.

---

### Q15. What is the difference between `runtime.Gosched` and `runtime.Goexit`?

**Model answer.**

- `runtime.Gosched()` — yields the M, allowing other runnable goroutines to run. The calling goroutine resumes shortly. State stays `_Grunning`.
- `runtime.Goexit()` — terminates the calling goroutine. Runs all deferred functions. State becomes `_Gdead`. No other goroutine is affected. If called on the main goroutine, the program continues running with other goroutines.

`Gosched` is for cooperation, `Goexit` is for terminating early.

---

### Q16. Why does the Go runtime use `SIGURG` for async preemption?

**Model answer.** Go 1.14+ uses `SIGURG` to interrupt long-running goroutines. The signal handler modifies the G's saved PC to point at the `asyncPreempt` stub, which deschedules the G. `SIGURG` was chosen because:

1. It is rarely used by other software.
2. Its default action is "ignore" — sending it to a program that does not handle it has no effect.
3. It is reliably deliverable on all Unix platforms.

If a C library you cgo into uses `SIGURG`, you may need `GODEBUG=asyncpreemptoff=1` (regression to cooperative preemption).

---

## Senior

### Q17. How do you architect a Go service to avoid M-creation storms?

**Model answer.** Sources of unbounded M creation:

- Many simultaneous blocking syscalls (file I/O, `connect`, cgo).
- Heavy cgo workloads with no concurrency bound.
- File I/O at very high parallelism (disk reads).

Mitigations:

1. Bound the parallelism of each syscall-heavy code path with a semaphore (`golang.org/x/sync/semaphore`).
2. Use a single owner goroutine pinned via `LockOSThread` for thread-affine C calls.
3. For high-throughput cgo, batch operations into one call.
4. Monitor `/proc/self/status:Threads` and alarm above a sane threshold.

Goal: thread count is bounded and predictable under any load.

---

### Q18. When would you prefer a thread-pool language (Java, C#) over Go?

**Model answer.** Workload shapes where Java's runtime is competitive or better:

- **CPU-bound long-running**: JIT optimisation often beats Go's static compiler.
- **Existing JVM ecosystem**: Apache Kafka, Spark, Cassandra, etc., are native to JVM.
- **Hard real-time-ish**: JVM's GC is tunable (G1, ZGC) for sub-millisecond pauses; Go's GC is simpler but less knobby.
- **Long-running async data pipelines**: Reactive streams, Akka, Project Reactor.
- **Strong type system requirements**: Java's generics, sealed types, and advanced static analysis ecosystem.

For high-concurrency I/O, Go and Java 21 (Loom) are roughly equivalent now. The choice often comes down to team expertise.

---

### Q19. Explain the design of `runtime.LockOSThread` and why a goroutine exit destroys the thread.

**Model answer.** When a goroutine calls `LockOSThread`, the runtime stores a cross-pointer between the G and the M (`g.lockedm` and `m.lockedg`). The scheduler honours this: the locked G runs only on its M, and no other G runs on that M.

If the locked goroutine exits without `UnlockOSThread`, the runtime *destroys* the M (the OS thread) rather than reusing it. Reason: the goroutine may have left the thread in an OS-state different from the default (e.g., changed signal masks, switched namespaces with `setns`, set thread-local state in a C library). Reusing it for another goroutine would expose that state. Destruction is the conservative safe choice.

Cost: each `LockOSThread`-then-exit pair leaks an OS thread. Don't do this in a hot loop.

---

### Q20. How would you debug a goroutine that "won't cancel"?

**Model answer.** Hypotheses, in order:

1. **The goroutine doesn't check `ctx.Done()`.** Tight loop with no `select { case <-ctx.Done(): }`. Read the source.
2. **The goroutine is in a cgo call.** Cgo cannot observe `ctx.Done` until it returns to Go. Either timeout the cgo at the C level or live with the cgo blocking.
3. **The goroutine is in a non-net blocking syscall (`read` on a slow device, `flock`).** Same issue: cannot observe ctx until the syscall returns. Use `SetReadDeadline` on net.Conn; for files, you may need to interrupt at the OS level.
4. **The goroutine has a `time.Sleep` not paired with `ctx.Done`.** Replace with `time.NewTimer` + `select`.
5. **The context isn't actually cancelled.** Check upstream: someone called `cancel()`? `WithTimeout` deadline elapsed?

Inspect with `/debug/pprof/goroutine?debug=2`. The blocked goroutines' stacks tell you exactly where they are stuck.

---

### Q21. Walk through what happens when you set `GOMAXPROCS` from 4 to 8 at runtime.

**Model answer.** `runtime.GOMAXPROCS(8)` calls `procresize` in the runtime:

1. Lock the scheduler.
2. Allocate 4 new P structs (or pull from an idle pool).
3. Mark them as `_Pidle`.
4. Distribute any runnable Gs across the new total of 8 Ps.
5. Wake up idle Ms (or spawn new ones) to attach to the new Ps.
6. Unlock.

After this, scheduling has 8 Ps. If load is sufficient, 8 Ms will run concurrently. The same procedure works in reverse for shrinking.

Cost: the resize is a stop-the-world operation. Don't do it in a hot loop. Set early and leave alone.

---

### Q22. Why is `runtime.LockOSThread` rarely used in modern Go code?

**Model answer.** Three reasons:

1. **Most C libraries Go interfaces with are now thread-safe.** OpenSSL, libcurl, modern database drivers — all designed for multi-thread use.
2. **Go's standard library and `golang.org/x/...` cover common needs.** Files, sockets, signals, processes — pure-Go, no pinning needed.
3. **Modern Linux kernel features.** `setns` and similar were once thread-affine; some have process-wide alternatives.

Real-world pinning still happens for OpenGL/Vulkan, audio APIs (e.g., PortAudio), and certain Windows COM APIs. But for a typical web service, you may never call `LockOSThread`.

---

### Q23. How would you design observability for goroutine vs thread metrics?

**Model answer.** Four layers:

1. **Metrics**: Prometheus counters for `runtime.NumGoroutine()`, scraped `/proc/self/status:Threads`, `runtime/metrics` values (`/sched/latencies:seconds`, GC pause). Dashboards with sparklines.
2. **Profiles**: `net/http/pprof` exposed on a non-public port. `runtime/trace` triggered on demand for short windows.
3. **Logs**: `context.Context`-propagated request ID in every log line. So we can follow a request across goroutines.
4. **Tracing**: OpenTelemetry spans for each request, child spans for each spawned goroutine's work.

Alert on:

- Goroutine count > N × baseline.
- Thread count > T (org-specific threshold).
- Scheduler latency p99 > 10 ms.
- GC pause p99 > 100 ms.

The combination distinguishes goroutine-level issues (leak, runaway spawn) from thread-level (cgo storm, syscall pressure).

---

### Q24. What is the cost of `entersyscall` for a fast syscall?

**Model answer.** For a syscall that completes in < 20 µs, sysmon never gets to hand off the P. The cost is:

- `entersyscall`: ~50 ns for state changes.
- Syscall: variable, but at minimum ~100 ns for the user/kernel transition.
- `exitsyscall`: ~50 ns to re-attach.

For tight, fast syscalls, this is acceptable. For slow ones (> 10 µs), the handoff adds ~200 ns of scheduler work, but you would not have wanted the alternative (blocking the entire P).

Optimisations: some syscalls have non-blocking variants (`syscall.Read` on a non-blocking fd) that avoid `entersyscall` entirely. The netpoller exploits this.

---

### Q25. Why was async preemption (Go 1.14) a big deal?

**Model answer.** Before Go 1.14, preemption only happened at function-call points. A tight loop with no function calls — `for { i++ }` — was uninterruptible. With `GOMAXPROCS=1`, such a loop would freeze the program: GC stalled (could not reach the goroutine), other goroutines starved.

Go 1.14 added signal-based preemption: sysmon sends `SIGURG` to a thread running a too-long goroutine; the handler modifies the saved PC to redirect to a "preempt" stub. The goroutine descheduled at the next safe point.

Effect: GC no longer stalls behind tight loops. Co-located workloads are more predictable. Most "Go is slow at preemption" complaints disappeared.

This was a 4-year project ([proposal 24543](https://github.com/golang/proposal/blob/master/design/24543-non-cooperative-preemption.md)) with careful safe-point analysis. Required modifications to GC, scheduler, and per-architecture code generation.

---

## Staff

### Q26. Design a Go service that handles 1 million concurrent WebSocket connections.

**Model answer.** High-level architecture:

1. **One goroutine per connection.** Each does `for { read message; handle; write response }`.
2. **Bounded outgoing fan-out.** When broadcasting to many clients, use a worker pool — not 1 M writes in parallel.
3. **Idle connection memory budget.** 2 KB stack × 1 M = 2 GB. Plus closures, plus framing buffers. Plan 8–16 GB of RAM minimum.
4. **`GOMAXPROCS` matches vCPUs.** Likely 8–16 on a typical server.
5. **Netpoller is the secret weapon.** The runtime handles `epoll_wait` cycles; ~one M.
6. **OS limits.** `ulimit -n` to 2 M. Plus `net.ipv4.tcp_max_tw_buckets`, `tcp_fin_timeout`, ephemeral port range.
7. **No cgo on the hot path.** Cgo holds Ms; cgo per connection would catastrophise.
8. **Graceful shutdown.** Context propagation; close listener; wait for in-flight handlers via `errgroup`.
9. **Observability.** Goroutine count, thread count, p99 message latency, connection count, GC pause.

Key trade-off: 1 M connections per process is feasible. Distributing across processes / hosts adds resilience but complicates state.

---

### Q27. You discover thread count climbing to 500 in production. Walk through diagnosis.

**Model answer.** Sequence:

1. **Quick check**: `runtime.NumGoroutine()` and `runtime.GOMAXPROCS(0)`. If goroutines are stable and `GOMAXPROCS` is sane, the issue is M-creation.
2. **Inspect `/proc/<pid>/status`**: confirm `Threads:` is 500+. Note process is healthy.
3. **`pprof goroutine`**: any goroutine stacks in cgo? `_Cfunc_...` or `runtime.cgocall` in many stacks?
4. **`pprof goroutine?debug=2`**: full stacks. Group by stack frame.
5. **If cgo**: which library, which call? Is it network DNS via cgo resolver? Database client?
6. **Bound the call** with a semaphore. Deploy. Watch thread count drop.
7. **If not cgo**: check disk I/O. `iotop`, `iostat`, or `pprof block` profile.
8. **If GC**: check GC pauses; raise `GOGC` if too aggressive.

Document the runbook so the next on-call has a path to follow.

---

### Q28. Compare Go's M:N scheduling to Java 21 virtual threads.

**Model answer.** Both are M:N: many user-tasks on few OS threads. Differences:

| Aspect | Go goroutines | Java virtual threads |
|---|---|---|
| Year shipped | 2009 | 2023 (Loom) |
| Memory per task | ~2 KB initial | ~few hundred bytes initial |
| Stack growth | Copy-and-grow | Heap-allocated, sliced |
| Preemption | Async since 1.14 (`SIGURG`) | Cooperative at "yield" points (mounted/unmounted) |
| `synchronized` / blocking syscalls | Runtime intercepts via netpoller and syscall handoff | Loom intercepts via "carrier thread" unmounting |
| Affinity | Float between Ms unless `LockOSThread` | "Carrier-pinned" affinity model |
| Cancellation | Cooperative via `context.Context` | Cooperative via `Thread.interrupt()` |
| Cgo cost | Holds an M per call | JNI similar concern, pre-existing |

Operationally, they look similar to users: "block-style code, no thread cost." Internally, Loom is a more recent design influenced partly by Go's success.

Edge: Loom integrates with JVM's GC, debugger, profiler — mature tooling. Go's tooling is more focused but less broad.

---

### Q29. Explain how the runtime's `procresize` interacts with running goroutines.

**Model answer.** `procresize(n)` (in `runtime/proc.go`) is the function called when `GOMAXPROCS` changes:

1. Stop-the-world: all Ps are stopped, all Gs descheduled.
2. Compute new `P` count `n`. Allocate or release Ps to reach `n`.
3. For each existing P:
   - If still active (`i < n`): keep it. Drain any local runqueue items if it has too many.
   - If shrinking (`i >= n`): mark `_Pdead`, move its runqueue items to the global runqueue.
4. Distribute goroutines from the global runqueue across the new P set.
5. Wake Ms to attach to free Ps.
6. Resume the world.

Running goroutines see no change — they were stopped during step 1. New Ps just gain runnable work.

Constraints: `procresize` is rare. Doing it from a hot path is wasted work.

---

### Q30. How would you implement a "thread-affinity-aware" worker pool in Go?

**Model answer.** Architecture:

```go
type Worker struct {
    in   chan Work
    done chan struct{}
}

type AffinePool struct {
    workers []*Worker
}

func NewAffinePool(n int) *AffinePool {
    p := &AffinePool{workers: make([]*Worker, n)}
    for i := 0; i < n; i++ {
        w := &Worker{in: make(chan Work, 16), done: make(chan struct{})}
        p.workers[i] = w
        go func(id int, w *Worker) {
            runtime.LockOSThread()
            defer runtime.UnlockOSThread()
            // Pin to a specific CPU (Linux)
            cpuset := syscall.CPUSet{}
            cpuset.Set(id % runtime.NumCPU())
            syscall.SchedSetaffinity(0, &cpuset)
            // Initialise thread-local resources (C lib, GPU context, etc.)
            initCResources()
            defer destroyCResources()
            for work := range w.in {
                process(work)
            }
            close(w.done)
        }(i, w)
    }
    return p
}

func (p *AffinePool) Submit(workerID int, work Work) {
    p.workers[workerID].in <- work
}
```

Trade-offs:

- Each worker is on a fixed thread, fixed CPU → cache-friendly.
- The Go scheduler cannot rebalance work; the submitter must.
- Failures in one worker do not crash others (with `recover()`), but the thread is wedged.

Useful for: GPU per-device worker, NUMA per-socket worker, high-throughput single-thread C library.

---

### Q31. What does a typical Go service's thread count look like, and what would make you worry?

**Model answer.** Typical service, `GOMAXPROCS=4`:

- 4 Ms running Go code most of the time.
- 1 sysmon M.
- 1–2 GC mark worker Ms (transient during GC).
- 1 netpoller-effective M (varies, sometimes the same as one of the Go-code Ms).
- A few parked Ms in the M-pool (1–3 typical).

Total: 8–12 threads in `top`. Healthy.

Worry levels:

- 20–50 threads: occasional syscall pressure or GC bursts. Investigate if sustained.
- 50–200 threads: heavy cgo or file I/O. Bound the parallelism.
- 200+: serious M-creation storm. Find the source.
- Climbing unboundedly: cgo leak or M cannot be reaped (rare).

Always log `GOMAXPROCS` and instrument thread count. The metric is one line of code; the diagnostic value is enormous.

---

### Q32. Why doesn't Go have `Thread.interrupt()` or `pthread_cancel()`?

**Model answer.** Forced thread cancellation is unsafe:

- A thread interrupted mid-operation may leave invariants broken (half-updated state, partial writes).
- Cleanup handlers cannot reliably restore consistency for arbitrary code.
- The C `pthread_cancel` standard requires cancellation points and clean-up handlers — error-prone.

Go's design: cancellation is **cooperative**. The cancelled goroutine receives a signal via `context.Context` and chooses when to exit. This forces the programmer to handle cleanup at known points.

Trade-off: a non-cooperative goroutine (tight loop, blocking cgo) cannot be forcibly stopped. You must design for cooperation from the start.

The benefit: every goroutine that handles `ctx.Done()` correctly is provably safe to cancel. There is no "kill -9 on a goroutine" footgun.

---

## Summary of follow-ups by level

| Level | Themes |
|---|---|
| Junior | "What is the difference?", "Why are goroutines cheap?", "What does `GOMAXPROCS` control?" |
| Middle | "Walk through syscall handoff", "Cgo storm", "Netpoller", "Container `GOMAXPROCS` correctness" |
| Senior | "Architect for bounded threads", "Choose Go vs Java/Rust", "Observability across goroutine vs thread", "When to LockOSThread" |
| Staff | "1 M-connection service design", "Diagnose thread spike under load", "Compare Go scheduler to Loom", "Internals of procresize / preemption" |
