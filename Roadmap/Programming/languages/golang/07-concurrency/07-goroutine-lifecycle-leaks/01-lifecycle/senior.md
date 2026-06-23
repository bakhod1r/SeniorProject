# Goroutine Lifecycle — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Supervisor Patterns](#supervisor-patterns)
3. [Hierarchical Cancellation](#hierarchical-cancellation)
4. [Lifecycle and Garbage Collection](#lifecycle-and-garbage-collection)
5. [Goroutines as GC Roots](#goroutines-as-gc-roots)
6. [Lifecycle and Finalizers](#lifecycle-and-finalizers)
7. [Lifecycle and `LockOSThread`](#lifecycle-and-lockosthread)
8. [Lifecycle and Cgo](#lifecycle-and-cgo)
9. [Long-Running Daemons](#long-running-daemons)
10. [Designing Restartable Goroutines](#designing-restartable-goroutines)
11. [Lifecycle in Distributed Workers](#lifecycle-in-distributed-workers)
12. [Cross-Cutting Concerns](#cross-cutting-concerns)
13. [War Stories](#war-stories)
14. [Summary](#summary)

---

## Introduction
> Focus: "How do I design a *system* — not just a function — whose goroutine lifecycles are correct, observable, and recoverable?"

At the senior level, lifecycle thinking is no longer per-`go`-statement. It is per-subsystem and per-process. You design supervisor trees, decide how panics escalate, choose between restart-on-failure and fail-fast, and understand how the GC, OS threads, and finalizers interact with goroutine lifetimes.

This file assumes you have internalized [junior.md](junior.md) and [middle.md](middle.md). It draws heavily on patterns from Erlang/OTP, BEAM-style supervisors, and modern Go production codebases.

---

## Supervisor Patterns

A *supervisor* is a goroutine whose only job is to start, monitor, and restart other goroutines. Go has no built-in supervisor library; you build one in 100 lines. The shape:

```go
type Supervisor struct {
    ctx    context.Context
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func NewSupervisor(parent context.Context) *Supervisor {
    ctx, cancel := context.WithCancel(parent)
    return &Supervisor{ctx: ctx, cancel: cancel}
}

func (s *Supervisor) Go(name string, work func(context.Context) error) {
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        for {
            err := s.runOne(name, work)
            if s.ctx.Err() != nil {
                return // parent canceled
            }
            log.Printf("%s exited with %v; restarting in 1s", name, err)
            select {
            case <-time.After(time.Second):
            case <-s.ctx.Done():
                return
            }
        }
    }()
}

func (s *Supervisor) runOne(name string, work func(context.Context) error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic in %s: %v\n%s", name, r, debug.Stack())
        }
    }()
    return work(s.ctx)
}

func (s *Supervisor) Stop() {
    s.cancel()
    s.wg.Wait()
}
```

Properties:

- **Bounded lifecycle.** Every child goroutine ends when the supervisor's context is canceled.
- **Crash containment.** A child panic is logged and the child is restarted; the supervisor itself survives.
- **Backoff.** Restarts are spaced; you can layer exponential backoff or jitter on top.
- **Explicit shutdown.** `Stop` cancels the context and joins every child.

Variations:

- *One-for-one* — restart only the crashed child.
- *One-for-all* — restart every child when one crashes (use for tightly coupled groups).
- *Rest-for-one* — restart the crashed child and every younger child.

The Erlang/OTP literature is the standard reference here.

---

## Hierarchical Cancellation

`context.Context` makes lifecycle hierarchies natural:

```
rootCtx (cancel on SIGTERM)
  └── httpServerCtx (cancel on server shutdown)
        ├── requestCtx (cancel on response complete)
        │     ├── dbQueryCtx (timeout 1s)
        │     └── cacheReadCtx (timeout 100ms)
        ├── requestCtx
        └── requestCtx
  └── backgroundJobsCtx (cancel on job system shutdown)
        ├── cacheRefreshCtx (timeout per refresh)
        └── metricsFlushCtx (timeout per flush)
```

A `cancel()` at any level propagates downward. Children inherit deadlines (with `WithDeadline` and `WithTimeout` tightening, never relaxing).

### Design choices

- **One context per logical task.** A request gets its own context; a background job gets its own.
- **Pass context as the first argument.** Standard Go style.
- **Never store a context in a struct as `ctx`.** Pass it to methods. Storing creates aliasing problems where the context's lifecycle does not match the struct's.
- **Cancel the parent context first, then wait for children.** Not the other way around.

### Worst case: a leaked context

```go
ctx, _ := context.WithCancel(parent) // ignored cancel func
```

If you ignore the `cancel` function, the parent context retains a reference to the child until *the parent* is canceled. In long-running services this is a slow leak. Vet rules (`go vet`) flag this.

---

## Lifecycle and Garbage Collection

The GC and the goroutine scheduler are independent subsystems, but lifecycle ties them together in three ways:

### 1. A live goroutine is a GC root

Every running goroutine's stack is scanned by the GC. Every variable on the stack — every pointer in a closure, every argument, every local — is considered live. The GC cannot reclaim anything reachable from any live goroutine.

This means: a leaked goroutine is also a memory leak. It pins its closure, its arguments, every channel it holds, every map it references. A leak of N goroutines, each holding a 10 MB request body, is a 10*N MB leak.

### 2. A dead goroutine's stack is reclaimed (eventually)

When a goroutine reaches `_Gdead`, its stack is no longer scanned. The memory is recycled when the next goroutine reuses the `g` struct. But the *closure* the goroutine ran is GC-eligible only if no one else holds a reference. Sometimes a goroutine sends a result via channel to a struct that retains the closure — and the closure stays alive after the goroutine is dead.

### 3. The GC itself runs in dedicated goroutines

The Go runtime maintains several long-lived goroutines for GC, scavenging, and netpoll. They appear in `runtime.NumGoroutine` and in `pprof goroutine` profiles. Do not panic at "I see 8 goroutines in a 'hello world'" — those are runtime workers.

### Practical implication

When you write a struct holding a `[]byte` and pass it via channel to a long-living goroutine, you have *extended* the lifetime of that `[]byte` to the lifetime of the long-living goroutine. Reason about ownership.

```go
// BAD: workerLoop keeps a reference to every job forever.
var jobsSeen []Job
go func() {
    for j := range jobs {
        jobsSeen = append(jobsSeen, j) // unintentional retention
        process(j)
    }
}()
```

---

## Goroutines as GC Roots

The GC scans roots at the start of each cycle. Goroutine stacks (and globals) are the roots. Implication: a stuck goroutine retains everything on its stack, including:

- The closure captured by `go func() {...}()`.
- Function arguments to `go f(x, y, z)`.
- All in-flight local variables in any function on the call stack.
- Any channel value the goroutine is blocked on (the channel itself, and indirectly its buffer).

This is why a leaked goroutine that captured a 10 MB request body retains *the body* until the program exits. The closure points at the body; the goroutine's stack points at the closure; the GC sees the body as live.

### Reducing GC pressure from long-lived goroutines

- Don't capture unnecessarily. Pass small values rather than closures over large structs.
- Nil out references when no longer needed:
  ```go
  go func() {
      defer func() {
          bigData = nil // help GC reclaim early
      }()
      use(bigData)
      // ... long wait or loop ...
  }()
  ```
- Use channel patterns where the data flows *through* the goroutine and is not retained.

---

## Lifecycle and Finalizers

`runtime.SetFinalizer(obj, finalizer)` arranges for `finalizer(obj)` to be called *before* `obj` is reclaimed. The finalizer runs in *its own* goroutine, freshly spawned by the runtime for each finalization.

### Key lifecycle properties of finalizers

- The finalizer goroutine is born, runs the finalizer, and ends. It is short-lived and one-shot.
- If `finalizer` blocks or runs forever, the *finalization queue* backs up. Other finalizers wait. This is a subtle leak.
- If the finalizer panics, it terminates the process — same rules as any goroutine.
- Finalizers are not guaranteed to run before program exit. If `main` returns, queued finalizers are abandoned.

### Use cases

- Closing file descriptors held by a struct that the user forgot to `Close()`.
- Cleaning up `cgo` resources tied to Go objects.

### Anti-patterns

- Using finalizers for time-critical cleanup. They are best-effort.
- Resurrecting objects in finalizers (assigning the receiver to a long-lived variable). The runtime then re-queues the finalizer; the object can ping-pong forever.
- Long-running finalizers. They block other finalizations.

In modern Go (1.24+), `runtime.AddCleanup` is the preferred replacement for finalizers — it has stricter semantics and avoids the resurrection trap.

---

## Lifecycle and `LockOSThread`

`runtime.LockOSThread()` pins the current goroutine to the current OS thread. The pin is released by `runtime.UnlockOSThread()` or by the goroutine's death — and here's the twist: **if the goroutine dies while locked, the OS thread is destroyed**, not returned to the pool.

### When this matters

- **OpenGL, Windows COM, GUI frameworks.** Any library that uses thread-local state must run on a locked goroutine.
- **`signal.Notify` for thread-specific signals.**
- **`syscall.AllThreadsSyscall`** internals.

### Lifecycle implication

A goroutine that locks an OS thread should have a clear, finite lifecycle. If it loops forever, the OS thread is pinned forever. If it dies, the thread is destroyed (causing the runtime to spawn a fresh one for the next pinned goroutine).

```go
func runOpenGL() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread() // release before dying
    initGL()
    for {
        select {
        case <-ctx.Done():
            return
        case f := <-frames:
            render(f)
        }
    }
}

go runOpenGL()
```

If you drop the `defer UnlockOSThread()`, the death of `runOpenGL` kills the thread. Sometimes that is desired (e.g., for sandbox isolation); usually it is a bug.

---

## Lifecycle and Cgo

A goroutine that calls into C code is in `_Gsyscall` state until the C call returns. Important properties:

- **Cancellation does not interrupt cgo.** If C code is blocked waiting for `read`, no Go-side signal can wake it. The goroutine sits in `_Gsyscall` until C returns.
- **The OS thread cannot be reused.** Unlike pure Go syscalls (where the netpoller can swap goroutines), a cgo call holds the OS thread for the duration. This is why `runtime.NumCgoCall()` matters: too many in-flight cgo calls exhaust the thread pool.
- **`GOMAXPROCS` is independent of cgo concurrency.** You can have many more cgo calls in flight than `GOMAXPROCS`, each on its own OS thread.

### Lifecycle implication

A goroutine that calls cgo and never returns is more expensive than a goroutine that waits on a Go channel forever — because the cgo goroutine also pins an OS thread (with its kernel stack of 1-8 MB).

If a long-running cgo call must be canceled, the C library itself must offer a way (a thread-local "abort" flag, a `pthread_cancel`, etc.). Go cannot do it.

---

## Long-Running Daemons

Daemons are processes whose lifecycle is "until SIGTERM." They have specific lifecycle patterns:

### Pattern 1: Graceful shutdown via `signal.NotifyContext`

```go
ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer cancel()

sup := NewSupervisor(ctx)
sup.Go("http-server", runHTTPServer)
sup.Go("background-jobs", runJobs)
sup.Go("metrics-flusher", runMetrics)

<-ctx.Done()
log.Println("shutdown initiated")

shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
defer shutdownCancel()
sup.StopWithContext(shutdownCtx)
log.Println("shutdown complete")
```

### Pattern 2: Hard deadline on shutdown

`shutdownCtx` bounds how long we'll wait. Beyond the deadline, the process exits with whatever goroutines remain in-flight. This trades data integrity for SLA on shutdown time.

### Pattern 3: Drain semantics

For workers consuming from a queue:

```go
func (w *Worker) Stop(ctx context.Context) error {
    close(w.jobs)        // signal "no more jobs"
    select {
    case <-w.done:       // workers finished draining
        return nil
    case <-ctx.Done():   // deadline exceeded
        return ctx.Err()
    }
}
```

The worker drains the queue, then exits. The shutdown context is the deadline.

### Production checklist

- [ ] Every long-running goroutine has a context.
- [ ] `signal.NotifyContext` (or equivalent) wires SIGTERM/SIGINT to the root context.
- [ ] Shutdown has a hard deadline.
- [ ] On hard deadline, process exits anyway.
- [ ] `pprof` is exposed for diagnostics.
- [ ] Metrics report current goroutine count.
- [ ] Logs mark "shutdown initiated" and "shutdown complete."

---

## Designing Restartable Goroutines

A *restartable* goroutine is one that, on crash, can be re-spawned without losing data or external state. Design considerations:

### Idempotent setup

Every restart should re-acquire resources cleanly. Avoid one-time setup that breaks on restart:

```go
// BAD: panics on second start if conn is closed.
func (w *Worker) Run(ctx context.Context) {
    w.conn = dial()
    for {
        msg := w.conn.Read()
        process(msg)
    }
}

// GOOD: fresh connection on every Run.
func (w *Worker) Run(ctx context.Context) error {
    conn, err := dial()
    if err != nil {
        return err
    }
    defer conn.Close()
    for ctx.Err() == nil {
        msg, err := conn.Read()
        if err != nil {
            return err
        }
        process(msg)
    }
    return nil
}
```

### Checkpointing

If the goroutine processes a stream and may crash mid-batch, persist progress (offset, last-seen ID) outside the goroutine, so restart resumes from there.

### Backoff on restart

Crashing tight: 1000 restarts/second is a CPU melter. Always have an exponential backoff with jitter.

### Crash budget

Stop restarting after N crashes in M seconds — the failure is systemic, escalate to a higher-level supervisor or the process operator.

---

## Lifecycle in Distributed Workers

When goroutines coordinate across a cluster (via Kafka, NATS, Redis), the lifecycle has *external* dependencies. Considerations:

- **Heartbeat lifecycle.** A worker should send "alive" pings; a peer detects when the ping stops and marks the worker dead.
- **Lease lifecycle.** Distributed locks have TTLs. A goroutine that holds a lease must refresh it before death, and a worker that crashes must lose the lease (so another worker can take over).
- **Local goroutine lifecycle aligned with cluster role.** Master / replica goroutines should appear/disappear with cluster-role transitions.

### Practical pattern: leader election with a context

```go
go func() {
    for {
        elected, err := election.Campaign(ctx, identity)
        if err != nil { ... }
        if elected {
            leaderCtx, cancel := context.WithCancel(ctx)
            go runLeaderTasks(leaderCtx)
            // when we lose leadership, cancel leaderCtx.
            <-election.Lost()
            cancel()
        }
    }
}()
```

The leader-only goroutines have lifecycle bounded by `leaderCtx`. Losing the election cancels them.

---

## Cross-Cutting Concerns

### Logging the lifecycle

Decorate every long-running goroutine with start/end logs:

```go
go func() {
    log.Println("worker started")
    defer log.Println("worker stopped")
    // ...
}()
```

The pair is the smoke test. If you see "started" without a matching "stopped," there is a leak. If you see "stopped" without "started," there is a goroutine that started before logging was initialized.

### Metrics

Export:

- `goroutines_total` — `runtime.NumGoroutine()`.
- `goroutines_by_kind` — per-subsystem count (from your supervisor accounting).
- `goroutine_panics_total` — counter of recovered panics.
- `goroutine_restart_total` — counter of supervisor restarts.

Alert on `goroutines_total` rising forever. It is the cheapest leak detector.

### Tracing

Tag each goroutine's spans (OpenTelemetry, Datadog, etc.) so that traces show "request started here, spawned worker, worker ended at time T." Lifecycle becomes visible across services.

---

## War Stories

### The Slack outage of the imaginary goroutines

A request handler spawns a goroutine to update analytics. The goroutine writes to a remote service with a 30s timeout. Under load, every request spawns one goroutine; analytics service is slow, so each goroutine waits 30s. Request rate: 10k/s. After 30s of slowness, 300k goroutines are alive. Each holds the request body (~10 KB). Memory: 3 GB. OOM kill.

Fix: a bounded worker pool consuming an in-memory queue. Lifecycle of the analytics path decoupled from request lifecycle. Each request only enqueues, never spawns.

### The connection leak via finalizer

Code relied on `runtime.SetFinalizer` to close TCP connections. Under load, the finalizer queue backed up because the connection-close logic itself made a remote call that occasionally hung. The finalizer goroutine got stuck, and *every other finalizer* was blocked behind it. Memory and file descriptors leaked.

Fix: explicit `Close()` calls. Finalizers as a safety net only, with a strict per-call deadline.

### The `LockOSThread` thread fire

A library used `LockOSThread` to call into a thread-local C library. The goroutine returned without `UnlockOSThread`, so each call burned an OS thread. After 10k calls, the process had 10k threads — kernel scheduler thrashing, latency through the roof.

Fix: `defer runtime.UnlockOSThread()` at the top of every locked goroutine. Or, run a single dedicated locked goroutine that handles all calls via a channel.

### The orphaned `errgroup`

A team built a job system on `errgroup.Group`. Jobs returned errors. Some jobs spawned sub-goroutines that ignored the errgroup's context. When a job failed, the errgroup canceled, but the sub-goroutines kept running, holding DB connections. Connection pool exhausted under any failure.

Fix: pass the errgroup's context through every layer. Audit every `go ...` for context propagation.

---

## Summary

Senior-level lifecycle thinking is about *system design*, not function-local code. You build supervisor trees, design hierarchical contexts, plan for graceful shutdown, and integrate with the GC, OS threads, finalizers, and distributed coordination. The patterns:

- A supervisor is a goroutine that starts, monitors, and restarts other goroutines. Build one per subsystem.
- Hierarchical contexts let cancellation flow naturally from root to leaves.
- Goroutines are GC roots; leaked goroutines retain everything reachable from their stacks.
- `LockOSThread` ties a goroutine's lifecycle to an OS thread; mismatched lifecycle means a wasted thread.
- Cgo calls hold a thread for their entire duration and cannot be canceled from Go.
- Long-running daemons need explicit shutdown paths with hard deadlines.
- Restartable goroutines need idempotent setup, checkpointing, and backoff.
- Distributed workers must align local goroutine lifecycle with cluster state.

The professional level dives into the runtime states (`_Grunnable`, `_Grunning`, `_Gwaiting`, `_Gsyscall`, `_Gdead`) and how the runtime implements every transition in `runtime/proc.go`.

See also:

- [02-detecting-leaks](../02-detecting-leaks/) — turning lifecycle observations into actionable diagnostics.
- [03-preventing-leaks](../03-preventing-leaks/) — patterns that make leaks structurally impossible.
- [../../10-scheduler-deep-dive](../../10-scheduler-deep-dive/) — the scheduler's view of lifecycle.
