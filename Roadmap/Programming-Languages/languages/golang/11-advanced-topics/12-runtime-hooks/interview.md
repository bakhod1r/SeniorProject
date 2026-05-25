# Runtime Hooks — Interview

A targeted Q&A for the runtime-hook landscape. Each question has a short answer for the interview and a "what they want to hear" follow-up that signals real production experience.

---

## Q1. What is a runtime hook?

**Short.** Any API in the standard library that observes or influences the Go runtime — scheduler, GC, finalizer queue, profiler, tracer, or crash machinery — at runtime. They live mostly in `runtime`, `runtime/debug`, `runtime/metrics`, `runtime/pprof`, and `runtime/trace`.

**Follow-up.** A senior answer distinguishes runtime hooks from compile-time knobs (`-gcflags`, `-ldflags`) and external tooling (`go tool pprof`, `dlv`). They also know that `GODEBUG` is the environment-side counterpart, configurable per-module via `//go:debug` directives in `go.mod`.

---

## Q2. What does `runtime.GOMAXPROCS` do, and when should you set it?

**Short.** Sets the maximum number of OS threads executing Go code concurrently. Default is `NumCPU()`. From Go 1.25, it honors cgroup CPU quotas automatically.

**Follow-up.** Pre-1.25 you need `automaxprocs` in container environments because `NumCPU()` returns the host count, not the cgroup quota. Setting it lower than CPU count to "leave room" almost never helps; setting it higher than CPU count is essentially never correct.

---

## Q3. What's the difference between `runtime.ReadMemStats` and `runtime/metrics.Read`?

**Short.** `ReadMemStats` is the legacy API and **stops the world** to snapshot. `metrics.Read` is lock-free, returns versioned named metrics, and supports histograms (e.g., GC pause distribution).

**Follow-up.** In production code that scrapes every few seconds, switch to `runtime/metrics`. The Prometheus client_golang `GoRuntimeMetricsCollection` does this for you.

---

## Q4. When is `debug.SetGCPercent` appropriate?

**Short.** When a CPU profile shows GC dominating (>10% sustained) and you have memory headroom. Raising it (e.g., `200`) cuts GC frequency at the cost of larger RSS.

**Follow-up.** Don't raise GOGC if the platform's memory limit is binding; use `SetMemoryLimit` instead. Don't lower it as a default; the right move is fewer allocations. `GOGC=off` makes sense only with `GOMEMLIMIT` set.

---

## Q5. What is `GOMEMLIMIT` and how does it behave near the cap?

**Short.** A soft cap (Go 1.19+) on total runtime memory. The pacer GCs more aggressively as memory approaches the limit. It is **soft**: the runtime will exceed it rather than OOM.

**Follow-up.** A workload that pushes the heap continuously toward the cap can enter a "GC death spiral" — high mark-assist CPU with no real progress. The cure is fewer allocations or more memory, not a higher limit. Set it to ~90% of the container's memory limit to leave room for cgo and kernel accounting.

---

## Q6. What does `debug.FreeOSMemory` do and when should you call it?

**Short.** Forces a GC and asks the OS to reclaim idle pages now (`MADV_DONTNEED` or `MADV_FREE`).

**Follow-up.** Useful at the end of a batch stage or before a known idle period. Never call it in a hot loop or per request — it's a hammer, and the pacer is usually doing the right thing already.

---

## Q7. `runtime.SetFinalizer` vs `runtime.AddCleanup`?

**Short.** `SetFinalizer` (all versions) registers a function that runs after the object becomes unreachable; it resurrects the object for one cycle, allows only one per object, and prevents collection of cycles. `AddCleanup` (Go 1.24+) is multiple-per-object, no resurrection, cycle-tolerant, and the recommended replacement.

**Follow-up.** Neither is a substitute for `Close()` and `defer`. Finalizers/cleanups are not guaranteed to run before program exit. The classic finalizer-cycle bug (`a.b = b; b.a = a` with both finalized) is impossible with `AddCleanup` because the cleanup function gets a copy of the value, not the object pointer.

---

## Q8. What is `runtime.KeepAlive` for?

**Short.** Tells the runtime to consider `x` reachable up to the program point at which `KeepAlive(x)` is called. Required when passing Go-managed memory to a C function that uses it asynchronously.

**Follow-up.** Without `KeepAlive`, the compiler may decide a value is dead after its last visible Go-side use, allowing the GC to collect its backing storage while the C side is still reading. The cost of `KeepAlive` is effectively zero — a barrier the optimizer can't move across, no machine code.

---

## Q9. `runtime.LockOSThread`: legitimate uses?

**Short.** Pin a goroutine to its current OS thread. Required for: GUI toolkits with thread-local state (GTK, OpenGL), C libraries that demand a stable thread, per-thread Linux syscalls (`setuid`, `unshare`).

**Follow-up.** It is **not** a synchronization primitive. The thread cannot run other goroutines while locked; if a goroutine with an active lock count exits, the thread is destroyed. Always pair with a deferred `UnlockOSThread`; the calls nest.

---

## Q10. What does `runtime.Goexit` do, and how is it different from `panic`?

**Short.** Terminates the calling goroutine after running its deferreds. Not recoverable — there's no value to catch. `panic`, by contrast, unwinds carrying a value and can be intercepted by `recover()`.

**Follow-up.** Calling `Goexit` from the main goroutine while other goroutines are still alive can trigger the runtime's "all goroutines asleep" deadlock detection. Mostly useful in test frameworks (`testing.T.FailNow` is built on it). Don't use in production code.

---

## Q11. `os.Exit` vs returning from `main` vs `runtime.Goexit`?

**Short.** `os.Exit(code)` ends the process immediately, no deferreds. Returning from `main` runs main's deferreds and then exits. `Goexit` from main runs deferreds and ends only the main goroutine.

**Follow-up.** A common production bug: a signal handler calls `os.Exit(0)`, bypassing the metric flusher's deferred call elsewhere. Fix: structured shutdown with `signal.NotifyContext`, return errors instead of calling `os.Exit`.

---

## Q12. What does `runtime/pprof.StartCPUProfile` actually do?

**Short.** Starts the CPU profiler. The runtime installs a SIGPROF handler that, at each tick (default 100 Hz), walks the stacks of currently running goroutines and records the samples to the provided writer.

**Follow-up.** Samples are statistical: 30 seconds of profiling catches any function running > 1% of the time. The overhead is ~1–2% CPU. For continuous profiling, use Parca, Pyroscope, or a hosted profiler — same Go pprof format, attached every few minutes.

---

## Q13. What are `pprof` labels and when do you use them?

**Short.** Tags attached to CPU samples for the duration of a `pprof.Do(ctx, labels, fn)` call. They let you slice a profile by handler, request type, customer, etc.

**Follow-up.** Wrap your HTTP mux with a middleware that labels each request by route. Then `go tool pprof -tagfocus 'route=/checkout' cpu.pprof` shows only the checkout flow. Overhead is one map lookup per request.

---

## Q14. What does `runtime/trace` capture, and how is it different from pprof?

**Short.** The execution tracer records every scheduling event, GC phase, syscall, and channel operation. pprof samples; trace is exhaustive over its capture window. Read with `go tool trace`.

**Follow-up.** Trace files grow at 5–20 MB/s of real time, so capture small windows (seconds). Use it when you need to understand *why* something was slow at a specific moment — scheduler starvation, GC pause overlap, channel contention.

---

## Q15. What does `GODEBUG=gctrace=1` print, and how do you read it?

**Short.** One line per GC cycle:

```
gc N @T.s P%: a+b+c ms clock, ... live→peak→target MB, goal MB, K P
```

Cycle number, time since process start, cumulative GC CPU fraction, three phase durations (sweep, mark, mark termination), heap-size triple, pacer goal, GOMAXPROCS.

**Follow-up.** Don't leave it on in production — under high GC frequency it floods stderr. Use it for a focused window. Prefer `/gc/pauses:seconds` from `runtime/metrics` for ongoing observation.

---

## Q16. What is `debug.SetCrashOutput`?

**Short.** Go 1.23+ API to mirror the runtime's unrecovered-panic and fatal-error output to a second file before the process dies. Useful for forensic logging when the host itself is going down.

**Follow-up.** Write to a local file (cheap, lock-free); use a separate process or log shipper to forward to S3/central logging. Don't try to write to a network socket from the crash path — networking can deadlock with whatever caused the crash.

---

## Q17. How does `runtime.SetFinalizer` interact with cgo memory?

**Short.** Finalizers run after the object becomes unreachable from Go. They are useful for releasing C resources tied to a Go object's lifetime — but `Close()` + `defer` is almost always preferable because finalizers may never run before exit.

**Follow-up.** `runtime.AddCleanup` (Go 1.24+) is better because it doesn't resurrect and doesn't have the cycle restriction. Either way, pair with `KeepAlive` if any C call is asynchronous — the GC's view of "unreachable" doesn't know about C-side pointers.

---

## Q18. What's the difference between `MADV_FREE` and `MADV_DONTNEED`?

**Short.** Both advise the kernel that pages can be reclaimed. `MADV_FREE` is lazy — pages are eligible for reclaim under pressure but remain counted as RSS until then. `MADV_DONTNEED` unmaps immediately, requiring page faults on next access.

**Follow-up.** Go's default on Linux ≥ 4.5 is `MADV_FREE`. The visible effect: after `FreeOSMemory`, RSS often stays flat with `MADV_FREE` even though the runtime has released. Force `MADV_DONTNEED` with `GODEBUG=madvdontneed=1` when your dashboards or platform need RSS to drop promptly.

---

## Q19. Why is `runtime.GC()` rarely correct in production?

**Short.** It blocks the caller during the STW phases, defeats the pacer's feedback model, and doesn't help with real leaks. Legitimate uses: tests, benchmarks, just before `WriteHeapProfile`, and one-shot batch programs.

**Follow-up.** Recurring symptom: "runtime.GC every N seconds for predictable latency". The actual effect is *worse* p99 because every N seconds you guarantee a pause. The pacer would have done it later, smaller, and possibly not at all.

---

## Q20. How do you wire `GOMEMLIMIT` from a cgroup at startup?

**Short.** Read the cgroup memory limit (`/sys/fs/cgroup/memory.max` on cgroup v2) and call `debug.SetMemoryLimit(int64(0.9 * limit))`. The `automemlimit` library does exactly this.

**Follow-up.** The 90% factor accounts for non-Go memory (cgo allocations, mmap'd files, page tables). Without it, the runtime's accounting doesn't match the kernel's, and you OOM at unexpected times. Verify by logging the active limit at startup.

---

## Q21. Bonus — what does `debug.ReadBuildInfo` give you?

**Short.** Module path, version, build settings (`GOOS`, `GOARCH`), `vcs.revision`, `vcs.time`, and the dependency list. Available from Go 1.18+ when built with module mode.

**Follow-up.** Surface it on `/version` for incident correlation. The VCS fields require building from a clean checkout — `vcs.modified=true` means the binary doesn't correspond to a committed revision. Combine with `-trimpath` to keep build paths reproducible.

---

## Q22. Summary

The runtime hook landscape is small enough to know in detail. Be able to answer: what each major hook does, when it is appropriate, what its observable cost is, and what its common misuses are. The interview signal isn't memorization — it's distinguishing the hooks that production code should touch (`SetMemoryLimit`, `signal.NotifyContext`, `pprof.Do`, `runtime/metrics`) from those that should stay in tests (`runtime.GC`, `MemProfileRate=1`, `SetGCPercent` for one-shot experiments).

---

## Further reading
- Diagnostics guide: https://go.dev/doc/diagnostics
- GC guide: https://go.dev/doc/gc-guide
- `runtime/metrics`: https://pkg.go.dev/runtime/metrics
- Crash output proposal: https://github.com/golang/proposal/blob/master/design/57175-crash-output.md
