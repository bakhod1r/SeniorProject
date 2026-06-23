# Goroutine Preemption — Interview Questions

A focused set of interview questions on preemption, grouped by depth. For each question: the question, the short answer, the long answer.

---

## Junior-level questions

### Q1. What is goroutine preemption?

**Short.** The runtime taking the CPU away from a running goroutine so another goroutine can run.

**Long.** When you spawn many goroutines, the runtime multiplexes them over a small pool of OS threads. Preemption is the mechanism that decides "stop running goroutine A, start running goroutine B" without A's explicit cooperation. Without preemption, a CPU-bound goroutine would run forever once started.

---

### Q2. What did Go 1.14 change about preemption?

**Short.** It added asynchronous, signal-based preemption.

**Long.** Before Go 1.14, preemption was cooperative: the compiler inserted a check at every function prologue, and the runtime piggy-backed on that check. Tight loops with no function calls could not be preempted. Go 1.14 added a signal-based mechanism: a background goroutine called sysmon detects goroutines that have run too long, and the runtime sends `SIGURG` to the OS thread; the signal handler arranges for the goroutine to land in a small assembly stub called `asyncPreempt` that yields to the scheduler. Both mechanisms now coexist.

---

### Q3. What does `runtime.Gosched()` do?

**Short.** It voluntarily yields the current goroutine to the scheduler.

**Long.** The calling goroutine is removed from its P and placed on the run queue. Another goroutine may run next. Eventually the scheduler picks the yielder back up and execution continues after the `Gosched` call. It is purely a scheduler-level operation: no syscall, no thread context switch. In modern Go (1.14+), it is rarely needed because async preemption handles unfair goroutines automatically.

---

### Q4. What does `runtime.Goexit()` do?

**Short.** It terminates the calling goroutine after running its deferred functions.

**Long.** Unlike `return`, which only exits the current function, `Goexit` exits the whole goroutine. Deferred functions registered anywhere up the stack run in reverse order. The program does not exit. If you call `Goexit` from the main goroutine after every other goroutine has finished, the program will eventually panic with "no goroutines" — `Goexit` from `main` is almost always wrong.

---

### Q5. Why did `for {}` hang programs before Go 1.14?

**Short.** Cooperative preemption needed a function call, and the empty loop had none.

**Long.** The compiler-inserted preemption check fires at function prologues. An infinite empty loop has no function calls and no prologues, so the runtime's request to preempt — setting `g.preempt = true` — is never observed by the goroutine. With `GOMAXPROCS=1`, the goroutine pins the only P and nothing else runs. The main goroutine cannot make progress; the GC cannot start STW; the program freezes.

---

## Middle-level questions

### Q6. What signal does Go use for async preemption, and why?

**Short.** `SIGURG`. It is unused in modern Unix programming.

**Long.** The runtime needed a signal that almost no application or library uses. `SIGUSR1` and `SIGUSR2` are widely claimed. Real-time signals are not portable. `SIGURG` is the historical "urgent socket data" signal — essentially a dead feature thanks to `SO_OOBINLINE`. The runtime can claim it without conflicting with anyone. The runtime still cooperates with `os/signal.Notify(SIGURG)`, forwarding the signal after its own work.

---

### Q7. Walk me through the async preemption pipeline.

**Short.** sysmon -> preemptM -> tgkill -> signal handler -> asyncPreempt -> schedule.

**Long.**
1. The sysmon background goroutine wakes every few milliseconds.
2. `retake()` scans all Ps. For each P whose `schedtick` has not advanced for 10 ms, it calls `preemptone(p)`.
3. `preemptone` sets `g.preempt = true`, sets `g.stackguard0 = stackPreempt` (cooperative), and calls `preemptM(mp)` (async).
4. `preemptM` calls `signalM` which calls `tgkill(tid, SIGURG)`.
5. The kernel delivers `SIGURG` to the OS thread.
6. Go's signal handler runs. It checks the saved RIP against pcdata tables. If the PC is async-safe, it rewrites the saved RIP to `asyncPreempt` and pushes the original RIP onto the user stack.
7. The kernel `sigreturn`s. The thread resumes "at" `asyncPreempt`.
8. `asyncPreempt` saves all registers, calls `asyncPreempt2` -> `gopreempt_m` -> `goschedImpl` -> `schedule()`.
9. The scheduler picks the next goroutine.

---

### Q8. Why does the signal handler sometimes decline to preempt?

**Short.** The interrupted PC is in an unsafe region.

**Long.** Several conditions cause decline: the M holds a lock (`mp.locks > 0`), the M is allocating (`mp.mallocing > 0`), the M has an explicit "preempt off" reason set (`mp.preemptoff != ""`), the PC is inside a write barrier or atomic intrinsic, the PC has no register map (e.g., hand-written assembly without PCDATA), or the goroutine is currently on the system stack (`g0`). In all such cases the handler simply returns. Sysmon will retry on the next tick.

---

### Q9. What is a safe-point?

**Short.** A PC where the runtime knows the type of every live value.

**Long.** A safe-point is a program location where the GC can scan the stack and registers, where no half-finished write barrier exists, and where the goroutine can be parked and later resumed without losing consistency. The compiler emits stack maps and register maps describing the type of each value at each safe-point. Before Go 1.14, safe-points lived only at function prologues. Today, almost every PC in user code is an async-safe-point.

---

### Q10. Does preemption work in cgo?

**Short.** No. A goroutine inside C code cannot be preempted.

**Long.** The runtime cannot rewrite the PC of a thread executing in C. The signal handler, on detecting the goroutine is in cgo, declines. The M is pinned to the goroutine until the cgo call returns. The consequence: long cgo calls can cause starvation and increased GC latency. Best practice: keep cgo calls short, or break them into multiple smaller calls.

---

### Q11. What is `GODEBUG=asyncpreemptoff=1` for?

**Short.** Debugging the runtime; disables async preemption.

**Long.** With this flag, the runtime falls back to cooperative-only preemption — the pre-1.14 behaviour. Useful when investigating signal-related bugs, race conditions in third-party signal handlers, or simply to confirm that async preemption is the cause of a behaviour change. Never use in production: pathological tight loops will hang STW and the GC.

---

## Senior-level questions

### Q12. What is the difference between `g.preempt` and `g.stackguard0`?

**Short.** `g.preempt` is a yield request; `g.stackguard0` is the poison value that makes the prologue check fail.

**Long.** They are set together but serve distinct roles. `g.preempt` is consulted inside `newstack`: after the prologue's check fails and morestack is entered, the runtime looks at `g.preempt` to decide whether to grow the stack (real overflow) or to yield (fake overflow caused by preemption). `g.stackguard0`, set to the magic value `stackPreempt`, is what *triggers* the prologue check to fall through to `morestack` in the first place. Without the poison value, the prologue never branches. Without `g.preempt`, `newstack` would try to grow a perfectly fine stack.

---

### Q13. What is `g.preemptStop`?

**Short.** Park instead of re-queue after preemption.

**Long.** When the GC needs STW, it does not want preempted goroutines to be runnable again immediately — that would defeat the pause. It sets `g.preemptStop = true` on every goroutine before preempting. The yield path checks the flag: if set, the goroutine is parked (made unrunnable) instead of being re-queued. When STW ends, the GC unparks them.

---

### Q14. How does sysmon decide which P to preempt?

**Short.** `schedtick` unchanged for >= 10 ms means the same goroutine has been running.

**Long.** `p.schedtick` increments every time the scheduler picks a new G on that P. Sysmon snapshots `schedtick` per P in a `sysmontick` struct. If the snapshot equals the current value 10 ms later, the same G is still running; preempt it. If the snapshot has advanced, recent context switches have happened; leave it alone. This is a single atomic load per P per tick — extremely cheap.

---

### Q15. What is `mp.preemptoff`?

**Short.** A reason string that disables preemption for the holding M.

**Long.** Some runtime functions need short windows of guaranteed atomicity that the pcdata tables cannot express. They set `mp.preemptoff = "reason"` before entering the critical section and clear it on exit. The signal handler checks the field; if non-empty, decline. The string is for debugging only — it shows up in stack traces and helps identify why preemption is blocked.

---

### Q16. How does preemption interact with `runtime.LockOSThread`?

**Short.** Locked goroutines are still preemptible; they just resume on the same M.

**Long.** `LockOSThread` ties the goroutine to a specific M, useful for thread-local C state or for syscalls that require a specific TID. Preemption affects only the *scheduling* — the runtime can still take the G off the P and let other goroutines on that P run. When the locked goroutine becomes runnable again, the scheduler routes it back to its M.

---

### Q17. Why does Go's GC have such short STW pauses?

**Short.** Bounded preemption latency lets STW start in microseconds.

**Long.** STW must wait for all goroutines to reach a safe-point. Before 1.14, the worst-case wait was the longest function-call-free loop in the program — potentially seconds. With async preemption, the worst case is the longest legitimately unsafe region (write barriers, runtime critical sections), which is tens of microseconds. The GC's overall STW pause is now dominated by mark-termination work, not by goroutine wrangling.

---

## Professional-level questions

### Q18. Describe the `asyncPreempt` trampoline on amd64.

**Short.** A NOSPLIT/NOFRAME stub that saves all registers, calls `asyncPreempt2`, and restores.

**Long.** It saves 14 general-purpose registers, 16 XMM registers, and the flags register — 368 bytes of stack frame. It then calls `runtime.asyncPreempt2`, which is a normal Go function that calls into the scheduler. On return, it restores all saved state and executes a final `RET`. The trick: the signal handler pushed the *original interrupted RIP* onto the user stack before redirecting to `asyncPreempt`, so the `RET` returns to user code at exactly the interrupted instruction. `NOSPLIT` prevents the function's own preemption check from firing (which would recurse forever); `NOFRAME` skips the standard prologue.

---

### Q19. How does the signal handler "fake a call" to `asyncPreempt`?

**Short.** It writes the resume PC onto the user stack and sets the saved RIP to `asyncPreempt`.

**Long.** The amd64 implementation is in `signal_amd64.go`:
```go
func (c *sigctxt) pushCall(targetPC, resumePC uint64) {
    sp := c.rsp() - 8
    *(*uint64)(unsafe.Pointer(uintptr(sp))) = resumePC
    c.set_rsp(sp)
    c.set_rip(targetPC)
}
```
The handler decrements the saved SP, writes the resume PC at that slot, and sets the saved RIP to `asyncPreempt`. After `sigreturn`, the thread is "at" the function as if it had just been called. The final `RET` pops the resume PC.

---

### Q20. What pcdata tables drive `isAsyncSafePoint`?

**Short.** `PCDATA_StackMapIndex` and `PCDATA_UnsafePoint`.

**Long.** Each function emits PC-indexed metadata. `PCDATA_StackMapIndex` says which stack map applies at each PC; a value of -2 means "no stack map -> not safe." `PCDATA_UnsafePoint` flags individual PCs as `UnsafePointSafe`, `UnsafePointUnsafe`, or restart markers. The signal handler binary-searches both tables. If either rejects the PC, preemption declines.

---

### Q21. How does Windows implement async preemption?

**Short.** `SuspendThread`, `GetThreadContext`, modify, `SetThreadContext`, `ResumeThread`.

**Long.** Windows has no signals. The runtime instead suspends the M's thread, reads its context (register state), checks `isAsyncSafePoint` on the saved RIP, and — if safe — modifies the context to fake the call into `asyncPreempt` (decrement RSP, write resume PC there, set RIP). It then resumes the thread. The mechanism is *synchronous*: `SuspendThread` blocks until the thread is paused, so preemption latency on Windows is slightly more predictable than on Unix.

---

### Q22. Roughly how expensive is one async preemption?

**Short.** Two to four microseconds.

**Long.** Major components: tgkill syscall (~200–500 ns), kernel signal frame build (~500–1500 ns), Go signal handler dispatch (~100 ns), `isAsyncSafePoint` lookup (~50–200 ns), `pushCall` (~30 ns), `sigreturn` (~300–800 ns), `asyncPreempt` register save (~80 ns), `asyncPreempt2` + scheduler (~350 ns), register restore (~80 ns). Total around 2–4 μs on modern amd64. For a 10 ms run, the overhead is well below 1 %.

---

### Q23. Where in the runtime source does preemption "live"?

**Short.** `preempt.go`, `proc.go`, `signal_unix.go`, `preempt_*.s`.

**Long.** Core logic in `runtime/preempt.go`: `isAsyncSafePoint`, `asyncPreempt2`. Scheduler glue in `runtime/proc.go`: `preemptone`, `preemptall`, `sysmon`, `retake`, `goschedImpl`, `gopreempt_m`. Signal dispatch in `runtime/signal_unix.go`: `doSigPreempt`, `sigPreempt`. Per-arch trampolines in `runtime/preempt_amd64.s`, `preempt_arm64.s`, etc. Per-arch `pushCall` in `runtime/signal_amd64.go` and friends. Windows-specific path in `runtime/preempt_windows.go`. Total: about 2000 lines across all platforms.

---

### Q24. If you had to write a new architecture port, what does preemption require?

**Short.** A trampoline, a `pushCall`, and signal/wakeup wiring.

**Long.** Three pieces. (1) An assembly file `preempt_<arch>.s` implementing `asyncPreempt` — saves all caller-clobberable registers, calls `asyncPreempt2`, restores, returns via the link register or RET. (2) A Go file `signal_<arch>.go` defining `sigctxt` and `pushCall` for the platform's signal context structure. (3) OS-specific code in `os_<os>_<arch>.go` to deliver the signal (Unix) or suspend/resume (Windows). The total is a few hundred lines per port.

---

## Wrap-up

A candidate who can answer Q1–Q5 cleanly is at junior. Q6–Q11 separates middle. Q12–Q17 senior. Q18–Q24 professional. The litmus test for "do they really know it": ask them to draw the data flow from sysmon to `asyncPreempt` on a whiteboard. If they can, they have read the runtime; if not, they have only read a blog post about it.
