# Goroutine Lifecycle — Interview Questions

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Staff / Principal Questions](#staff--principal-questions)
5. [Code-Reading Questions](#code-reading-questions)
6. [Debugging Scenarios](#debugging-scenarios)

---

## Junior Questions

### Q1. What states can a goroutine be in?

**A.** In plain English: *runnable* (ready to run, waiting for CPU), *running* (executing on a thread), *waiting* (blocked on something — channel, mutex, syscall, sleep), and *dead* (its function has returned). In the runtime, those map to `_Grunnable`, `_Grunning`, `_Gwaiting`/`_Gsyscall`, and `_Gdead`.

### Q2. What does `go f()` do, step by step?

**A.**

1. Evaluates the arguments to `f` in the calling goroutine.
2. Calls `runtime.newproc`, which obtains a `g` struct (from a free list or by allocating one), sets up its stack and saved registers so it will start executing `f`, transitions it to `_Grunnable`, and pushes it onto a run queue.
3. Returns immediately. The new goroutine may start running on any OS thread at any later time.

### Q3. How does a goroutine end?

**A.** Three ways:

1. The function returns normally.
2. `runtime.Goexit()` is called — runs all deferred functions, then terminates.
3. An unrecovered panic propagates out of the function — but this also terminates the *entire program*.

### Q4. What happens if `main` returns while other goroutines are still running?

**A.** The program exits immediately. The other goroutines are killed without running `defer`s.

### Q5. What is a "goroutine leak"?

**A.** A goroutine that is alive (usually waiting on a channel, mutex, or other event) but will never end. It consumes memory and pins references; many leaks crash a program over time.

### Q6. How do you detect a leak?

**A.**

- `runtime.NumGoroutine()` rising over time.
- `pprof goroutine` showing many goroutines stuck on the same line.
- `go.uber.org/goleak` in tests asserting no leaks.

### Q7. What is the difference between `runtime.Goexit` and `return`?

**A.** `return` exits the *current function*. If that function is not the top of the goroutine's call stack, the goroutine continues. `runtime.Goexit` terminates the goroutine immediately, running all `defer`s on the way out, regardless of how deep the call stack is.

### Q8. If a goroutine panics, does the program crash?

**A.** If the panic is *unrecovered*, yes — the whole program terminates. If a `defer recover()` inside the panicking goroutine catches it, only that goroutine ends; the rest survive.

### Q9. What is `runtime.NumGoroutine`?

**A.** Returns the count of currently-live goroutines (not in `_Gdead`). Includes runtime workers (GC, sysmon, finalizer, network poller).

### Q10. How do you wait for a goroutine to finish?

**A.** Use `sync.WaitGroup`, an `errgroup.Group`, a `done` channel that the goroutine closes, or any other synchronization primitive. There is no built-in "wait" for a goroutine by reference.

---

## Middle Questions

### Q11. How does `context.Context` help with lifecycle?

**A.** A context's `Done()` channel is closed when cancellation occurs (explicit `cancel()` or a deadline). A goroutine that `select`s on `ctx.Done()` can react to cancellation and end voluntarily. Context propagates: child contexts inherit cancellation from parents. This gives you a structured, hierarchical lifecycle.

### Q12. Why is `wg.Add` *before* `go` and not inside the goroutine?

**A.** `wg.Wait()` may run before the goroutine schedules. If `Add` is inside the goroutine, `Wait` might see counter 0 and return prematurely. Always call `Add` in the parent before `go`.

### Q13. What is the canonical "graceful shutdown" pattern?

**A.**

```go
ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer cancel()

// start subsystems with ctx
srv := &http.Server{...}
go func() { srv.ListenAndServe() }()

<-ctx.Done()
shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
defer shutdownCancel()
srv.Shutdown(shutdownCtx)
```

The signal handler triggers context cancellation. Subsystems read it and stop. A shutdown context bounds the wait.

### Q14. What is `errgroup.Group` and how does it manage lifecycle?

**A.** `errgroup.WithContext(parent)` creates a group with a child context. `g.Go(f)` spawns a goroutine running `f`; if it returns an error, the group's context is canceled, signaling siblings to stop. `g.Wait()` returns the first error, after every child has finished. Lifecycle of the group is bounded by `Wait`.

### Q15. Why does `runtime.NumGoroutine` not drop to your baseline immediately after `wg.Wait()`?

**A.** Two reasons:

1. The scheduler may not yet have transitioned all dying goroutines through `_Gdead` and removed them from `allgs` accounting at the instant `Wait` returns.
2. Runtime workers (GC, sysmon, finalizer) appear in the count and fluctuate independently.

Tests should give a small grace period or use `goleak` which handles this.

### Q16. What is `runtime.LockOSThread`, and what is its lifecycle implication?

**A.** Pins the calling goroutine to its current OS thread. If the goroutine dies *without* calling `runtime.UnlockOSThread`, the OS thread is destroyed (a new one is spawned for the next pinned goroutine). So a locked goroutine must `defer runtime.UnlockOSThread()` or live forever.

### Q17. What is a finalizer's goroutine lifecycle?

**A.** When the GC determines an object with `SetFinalizer` is unreachable, the runtime spawns a fresh goroutine that runs the finalizer, then ends. Finalizers run one-at-a-time on this dedicated lifecycle. If a finalizer blocks, the queue backs up.

### Q18. How do you test for leaks?

**A.**

- Use `go.uber.org/goleak` (`goleak.VerifyTestMain` or `goleak.VerifyNone`).
- Manually: capture `runtime.NumGoroutine()` before and after, with a grace period, and assert equality.
- Inspect `pprof goroutine` profiles after long workloads.

### Q19. What is the difference between cooperative and async preemption?

**A.** Cooperative preemption (pre-Go-1.14) only suspends a goroutine at function-call boundaries or specific safe points; a tight loop without function calls runs forever. Async preemption (Go 1.14+) uses a signal to preempt a goroutine at almost any PC, then resumes it later. Lifecycle-wise both transition to/from `_Grunning` and `_Grunnable`; async adds `_Gpreempted` as an intermediate state.

### Q20. A goroutine sends on a channel with no receiver. What happens?

**A.** If the channel is unbuffered, the send blocks: the goroutine enters `_Gwaiting` with reason "chan send". If nothing ever receives, the goroutine is leaked. If the channel has a buffer, the send proceeds until the buffer is full, then blocks similarly.

---

## Senior Questions

### Q21. Design a supervisor for restartable goroutines.

**A.** A supervisor is a goroutine that:

1. Holds a `context.Context` and `WaitGroup`.
2. Has a `Go(name, work)` method that spawns a goroutine running `work(ctx)` in a loop with `recover` and backoff.
3. Has a `Stop()` method that cancels the context and waits for all children.

Decisions to consider: one-for-one vs one-for-all restart, crash budget, escalation policy on persistent failure.

### Q22. How do goroutines interact with the GC?

**A.** Every live goroutine's stack is a GC root. All variables on the stack and all referenced heap data are live. A leaked goroutine retains everything its stack points at — including request bodies, connections, large structs. This is why leaks are also memory leaks. The GC itself runs in dedicated goroutines.

### Q23. When `main` returns, what happens to in-flight `defer`s in other goroutines?

**A.** They do *not* run. The process exits, killing every goroutine without unwinding. This is why graceful shutdown is the responsibility of the program — you must wait for goroutines explicitly before letting `main` return.

### Q24. Explain the `_Gsyscall` state and its interaction with the scheduler.

**A.** When a goroutine enters a syscall via `runtime.entersyscall`, its state changes to `_Gsyscall` and the M is detached from its P. Another M may pick up the P and continue running other goroutines. When the syscall returns (`runtime.exitsyscall`), the goroutine tries to reacquire any P. If successful, it runs immediately; otherwise it becomes `_Grunnable` and waits.

### Q25. What is the `g` free list, and why does it exist?

**A.** A list of dead `g` structs maintained per-P and globally. When a goroutine ends, its `g` struct is added to the list rather than freed. The next `go f()` call obtains a `g` from the list, skipping allocation and (often) skipping fresh stack allocation. This optimizes "spawn many short-lived goroutines" workloads.

### Q26. Why is `parentGoid` and the "created by" info in the goroutine profile so useful?

**A.** When you see a profile with 10,000 goroutines all stuck on a channel receive, the "created by" line tells you *which line of your code* spawned them. The body of the goroutine may be a generic worker function; the creator tells you the actual use site. This is the difference between "we have a leak somewhere" and "we have a leak in pkg/jobs/runner.go line 47."

### Q27. What is the lifecycle hazard of capturing a context in a closure?

**A.** The closure holds a reference to the context. The context retains its parent. If you store the closure in a long-lived structure (a slice, a registry), the entire context tree stays alive — preventing GC of context values and timers. Always check that closures do not pin contexts beyond their needed lifecycle.

### Q28. How would you build a "goroutine-per-connection" server with bounded resource use?

**A.**

- Limit accept rate.
- Each connection goroutine has a `context.Context` with a deadline.
- Worker pool for CPU-bound work, fed by per-connection goroutines via a bounded channel.
- Total memory accounted for by tracking connections (each goroutine pinning ~2 KB + the connection state).
- Graceful shutdown via the connection list: on SIGTERM, refuse new connections, send "shutdown" on each connection's done channel, wait for them with a deadline.

### Q29. What does it mean that `_Gwaiting` goroutines do not consume CPU?

**A.** They are not on any run queue. The scheduler never picks them. They consume only memory (stack, closure, channel reference). When `goready` is called on them (e.g., a channel send arrives), they transition back to `_Grunnable` and re-enter the queue.

### Q30. Explain why `defer cancel()` is important after `context.WithCancel`.

**A.** The cancel function releases the resources associated with the context — including a goroutine that the context uses for deadline handling (in `WithTimeout`/`WithDeadline`), and the parent's reference to this child context. Without `cancel()`, the parent's children list retains this entry until the parent is canceled. `go vet` flags missing cancel calls.

---

## Staff / Principal Questions

### Q31. Walk me through what happens at the runtime level from `go f(x)` to the function `f` starting to execute.

**A.**

1. Compiler emits a call to `runtime.newproc(fn, x)`.
2. `newproc` switches to the M's system stack via `systemstack`.
3. `newproc1` is called: tries `gfget(p)` to get a `g` from the per-P free list; falls back to `malg` for fresh allocation.
4. Stack growth: ensures the new `g` has a minimum stack (~2 KB after Go's tweaks).
5. Arguments are copied into the new `g`'s stack frame.
6. `gostartcallfn` sets up `g.sched.PC` to `fn` and pushes `goexit` as the return address.
7. `casgstatus(_Gdead -> _Grunnable)` for reused gs, or `_Gidle -> _Grunnable` via `_Gdead` for fresh ones.
8. `runqput(p, g, true)` places the `g` at the head of the local run queue (next-to-run slot).
9. If there is no spinning M, `wakep` wakes one (possibly starting a new M via `newosproc`).
10. Eventually `schedule()` on some M picks up `g`, calls `execute(g)`, which sets `_Grunning` and `gogo(g.sched)` — jumps to `fn`.

### Q32. What design decisions in Go's runtime make goroutine lifecycle cheap?

**A.**

- Small initial stack (2 KB), growing on demand.
- Per-P free list of dead `g`s avoids allocator pressure.
- Stack growth via copy, not segmented stacks (after Go 1.4) — predictable performance.
- Scheduler is M-N: many goroutines on few OS threads, so spawning a goroutine is far cheaper than spawning a thread.
- No identity-related setup (no PID, no security context, no signal mask) per goroutine.

### Q33. Compare goroutine lifecycle to a thread pool model in Java or Python.

**A.** Java's `ExecutorService` has a fixed pool of OS threads. Submitting a `Runnable` queues it; threads pick it up. The thread's lifecycle is independent of the task. In Go, every concurrent task gets its own *goroutine* whose lifecycle matches the task. Cost is comparable (Go's goroutine ~ Java's task), but Go's model is more direct and the runtime handles scheduling on threads transparently.

Erlang's process model is closer to Go's: each process is light, has its own lifecycle, and communicates via messages. Erlang adds preemptive scheduling (true since v0) and explicit supervisor trees as language features.

### Q34. How would you write a leak-free job system that handles 100k jobs/second?

**A.**

- One persistent worker pool (e.g., 8-32 goroutines), not per-job spawning.
- Jobs enter via a bounded channel. Senders that find it full back-pressure their callers.
- Each worker is in a loop: `for { select { ctx.Done; jobCh } }`. Exits on context.
- Result fan-in: workers publish results to a result channel; a single consumer collects.
- Metrics: track goroutine count (should be constant), queue depth, completed-jobs counter.
- Shutdown: cancel context; workers drain in-flight jobs; close result channel; consumer exits.

### Q35. Describe a real production lifecycle bug you've debugged.

**A.** (Open-ended; here is a model story.)

In a payment service, the team observed slow memory growth over weeks. `runtime.NumGoroutine` grew by ~100/hour. `pprof goroutine?debug=2` showed 30,000 goroutines in `chan receive` state, all created by `worker.startConsumer`. Reading the code, each `startConsumer` was spawning a goroutine reading from a Kafka consumer, but the consumer reconnect logic spawned a *new* goroutine on each reconnect, leaking the old one (which was blocked on a channel never closed).

Fix: tie the consumer goroutine's lifecycle to a `context.Context`. On reconnect, cancel the old context and create a new one. Verified with a `goleak`-based test that simulated rapid reconnects.

---

## Code-Reading Questions

### Q36. Identify the leak.

```go
func process(items []Item) {
    results := make(chan Result)
    for _, item := range items {
        go func(item Item) {
            results <- doWork(item) // unbuffered
        }(item)
    }
    // forgot: no reader, no close
}
```

**A.** Every spawned goroutine sends on an unbuffered channel, but nothing reads. They all block in `_Gwaiting` with reason "chan send" forever. Fix: buffer the channel (`make(chan Result, len(items))`) or read every result.

### Q37. Will this exit cleanly?

```go
ctx, cancel := context.WithCancel(context.Background())
go func() {
    for {
        select {
        case <-ctx.Done():
            return
        default:
            doWork()
        }
    }
}()
cancel()
```

**A.** Yes, but with a subtlety: the goroutine may complete several iterations of `doWork()` after `cancel()` before noticing the ctx is done, because `default` is selected when no other case is ready. Fine for short `doWork`, problematic for long ones. Often you want a true `select` without `default`.

### Q38. What's wrong?

```go
go func() {
    wg.Add(1)
    defer wg.Done()
    work()
}()
wg.Wait()
```

**A.** Race: `wg.Wait()` may run before `wg.Add(1)`, see counter 0, and return. Move `wg.Add(1)` outside the goroutine, before `go`.

### Q39. Trace the lifecycle.

```go
func main() {
    runtime.LockOSThread()
    go func() {
        runtime.LockOSThread()
        panic("boom")
    }()
    time.Sleep(time.Second)
}
```

**A.** The spawned goroutine locks its OS thread, then panics. The panic is unrecovered — the entire process exits. The OS thread the spawned goroutine pinned would normally be destroyed (per `LockOSThread` semantics) on goroutine death, but here the whole process dies first.

---

## Debugging Scenarios

### Q40. You see `runtime.NumGoroutine() = 47,000` in production. Walk through your debugging.

**A.**

1. Pull `pprof goroutine?debug=1` — see grouped stacks. If one bucket has 40,000 goroutines, that is the leak.
2. Pull `pprof goroutine?debug=2` — see individual stacks with `[chan receive, 4 hours]` etc.
3. Identify the creator stack — the `go ...` line.
4. Read the code around that `go`. What is the exit condition? Is the context being checked? Is the channel being closed?
5. Reproduce with a focused test. Use `goleak` to prove the fix.
6. Add monitoring: alert on `NumGoroutine` exceeding a threshold.

### Q41. After deploying a fix, `NumGoroutine` keeps rising. What now?

**A.**

- The fix may not address the *only* leak; check whether the dominant stack changed.
- The fix may have introduced a new leak — read the diff.
- A retained reference somewhere may still be keeping goroutines alive: long-lived caches, registries, observers.
- Use `runtime/trace` to see lifecycle in detail — when goroutines are born and when (if ever) they die.

### Q42. A test fails with "goroutine leaked" but the production code has no obvious leak. Why?

**A.** Test infrastructure can confound:

- Background workers from previously-imported packages (database driver, logger).
- HTTP test servers (`httptest.Server`) leave a goroutine until `Close()`.
- A previous test in the same `TestMain` leaked.

Fix: scope `goleak.VerifyNone(t)` per test or `goleak.VerifyTestMain` with `IgnoreCurrent()` to baseline against framework goroutines.

---

## Summary

Interview questions on goroutine lifecycle test three things:

1. **Vocabulary** — knowing the states, the runtime functions, the patterns.
2. **Reasoning** — predicting behavior of small code samples.
3. **System thinking** — designing for explicit lifecycle, building supervisors, graceful shutdown.

The deepest version of this material is in [professional.md](professional.md). The most actionable patterns are in [middle.md](middle.md). For practical exercises, see [tasks.md](tasks.md), [find-bug.md](find-bug.md), and [optimize.md](optimize.md).
