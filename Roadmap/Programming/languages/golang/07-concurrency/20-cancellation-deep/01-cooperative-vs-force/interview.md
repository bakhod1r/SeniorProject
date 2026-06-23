---
layout: default
title: Interview
parent: Cooperative vs Forced
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/01-cooperative-vs-force/interview/
---

# Cooperative vs Forced Cancellation — Interview Questions

> Questions ranging from junior to staff. Each has a model answer, common wrong answers, and a follow-up probe.

---

## Junior

### Q1. What does "cooperative cancellation" mean in Go?

**Model answer.** The cancellation model where a goroutine voluntarily checks a signal (typically `<-ctx.Done()`) and returns when the signal fires. The runtime does not stop the goroutine; the goroutine stops itself.

**Common wrong answers.**
- "The runtime kills the goroutine." (No — there is no such API.)
- "The OS sends a signal to the goroutine." (Signals go to threads, not goroutines.)
- "Cooperative means many goroutines cooperate." (Misreads the term.)

**Follow-up.** *Why did Go choose cooperative over forced cancellation?* — Forced cancellation makes critical sections unsafe; cleanup may not run; locks may be permanently held. The Go team observed the long history of bugs in `pthread_cancel` and `Thread.stop`, and explicitly chose cooperation.

---

### Q2. Why doesn't `time.Sleep` respect context?

**Model answer.** `time.Sleep` is a runtime function that parks the goroutine on a timer; it has no notion of context. To get a cancellable sleep, use `time.NewTimer` plus a `select` on `<-timer.C` and `<-ctx.Done()`.

**Common wrong answer.** "It does respect context if you pass it in." (You can't — `time.Sleep` takes only a duration.)

**Follow-up.** *Write a `sleepCtx` helper.* —
```go
func sleepCtx(ctx context.Context, d time.Duration) error {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-t.C:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

---

### Q3. What is wrong with this code?

```go
ctx, _ := context.WithTimeout(parent, 5*time.Second)
return doWork(ctx)
```

**Model answer.** The `cancel` function is discarded. The timer keeps a reference until the deadline fires, leaking a small amount of memory and goroutine work for up to 5 seconds. `go vet` flags this with `lostcancel`. Always `defer cancel()`.

**Common wrong answer.** "Nothing — the timeout will fire anyway." (True but ignores the leak.)

---

### Q4. How do you cancel a goroutine from outside?

**Model answer.** You don't, directly. You signal it via a context or a channel, and the goroutine must observe the signal and return on its own. There is no `goroutine.Cancel`.

**Follow-up.** *What if the goroutine is in a blocking syscall?* — Cancellation cannot reach it. The escape is to close the underlying resource (e.g., `conn.Close()`) so the syscall returns with an error.

---

### Q5. What does `ctx.Err()` return?

**Model answer.**
- `nil` if the context is not cancelled.
- `context.Canceled` if `cancel()` was called.
- `context.DeadlineExceeded` if the deadline expired.

Use `errors.Is` to compare.

---

## Middle

### Q6. Describe a graceful shutdown pattern using `signal.NotifyContext`.

**Model answer.**
```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
defer stop()

go srv.ListenAndServe()
<-ctx.Done()

shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(shutdownCtx)
```

Signal cancels the root context. The server uses its own grace context (30s) for `Shutdown`. If `Shutdown` exceeds 30s, escalate to `os.Exit` or `srv.Close`.

**Follow-up.** *What if a handler ignores `r.Context()`?* — `Shutdown` waits for that handler indefinitely, until the grace context expires. Then it returns with `context.DeadlineExceeded`; the handler is still running. You must escalate.

---

### Q7. What is `errgroup.WithContext` and what does it give you?

**Model answer.** `errgroup.WithContext(parent)` returns `(g, ctx)`. `ctx` is a child of `parent`; calling `g.Go(f)` runs `f` in a goroutine. If any `f` returns an error, `ctx` is cancelled, causing siblings observing `ctx` to exit. `g.Wait()` blocks until all goroutines return.

It gives you: error propagation upward, cancellation propagation downward, structured concurrency lifetime.

**Follow-up.** *What is `errgroup.SetLimit`?* — Bounds the number of concurrent `Go` calls. `g.Go(f)` blocks if the limit is reached. Added in Go 1.20.

---

### Q8. How do you cancel a `*sql.DB.Query`?

**Model answer.** Use `db.QueryContext(ctx, ...)`. The driver receives the context; on cancellation, it sends a "cancel query" command to the server (e.g., PostgreSQL `CancelRequest`, MySQL `KILL QUERY`). The connection may be discarded rather than reused.

**Follow-up.** *What if the driver doesn't support context?* — `database/sql` spawns a watcher goroutine that closes the connection on cancel. The query fails; the connection is discarded.

---

### Q9. Why store `ctx` in a struct is a bad idea?

**Model answer.** `context.Context` is request-scoped. A struct typically represents a long-lived value (a server, a client). Storing `ctx` ties the struct's lifetime to a single request's context, which is wrong. Pass `ctx` as a parameter to methods that need it.

**Follow-up.** *Exceptions?* — Sometimes you store a *cancel function* on a long-lived struct, so external callers can stop the struct. That is fine. The context itself stays in the call.

---

### Q10. What happens when `cancel()` is called twice?

**Model answer.** Nothing additional. `cancel` is idempotent: the first call closes the done channel and propagates to children; subsequent calls are no-ops. The implementation guards against double-close with internal synchronisation.

---

## Senior

### Q11. Compare `context.Canceled` and `context.DeadlineExceeded`. When does each fire?

**Model answer.**
- `context.Canceled`: someone called `cancel()` explicitly. Often "user closed the tab" or "the calling code decided to stop."
- `context.DeadlineExceeded`: a `WithDeadline` or `WithTimeout` reached its deadline. Often a sign of slow downstream or undersized budget.

In logging and metrics, treat them differently: timeouts often indicate problems; explicit cancels usually do not.

---

### Q12. What is `context.WithCancelCause` and when would you use it?

**Model answer.** Returns a context with a `cancel(err)` function. Calling `cancel(err)` sets a cause; `context.Cause(ctx)` retrieves it. `ctx.Err()` still returns `Canceled`. Use it when downstream code benefits from knowing *why* cancellation happened — for example, distinguishing "user closed tab" from "service hit OOM."

```go
ctx, cancel := context.WithCancelCause(parent)
cancel(errors.New("rate limit exceeded"))
```

---

### Q13. Design a worker pool whose `Shutdown` accepts a grace context.

**Model answer.**
```go
type Pool struct {
    jobs   chan Job
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func NewPool(parent context.Context, n int) *Pool {
    ctx, cancel := context.WithCancel(parent)
    p := &Pool{
        jobs:   make(chan Job),
        cancel: cancel,
    }
    for i := 0; i < n; i++ {
        p.wg.Add(1)
        go p.worker(ctx)
    }
    return p
}

func (p *Pool) worker(ctx context.Context) {
    defer p.wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case j, ok := <-p.jobs:
            if !ok {
                return
            }
            j.Run(ctx)
        }
    }
}

func (p *Pool) Submit(j Job) { p.jobs <- j }

func (p *Pool) Shutdown(graceCtx context.Context) error {
    close(p.jobs)
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-graceCtx.Done():
        p.cancel() // force workers via context
        return graceCtx.Err()
    }
}
```

`Shutdown` first tries cooperative drain (close jobs, wait). If grace expires, it cancels the workers' context to force them to bail out of in-flight work.

---

### Q14. Why is `runtime.LockOSThread` relevant to cancellation?

**Model answer.** It pins a goroutine to an OS thread. The OS thread can then be the target of `pthread_kill` or similar. This allows "forced cancellation" via signals, but only if you control the C code (or pure-Go code) running on that thread to handle the signal correctly.

Use cases: cgo with cooperative-via-signal C code, OpenGL contexts, signal-based stop in carefully designed runtime helpers. Avoid otherwise.

---

### Q15. How does cancellation reach a goroutine blocked in `net.Conn.Read`?

**Model answer.** It does not reach directly. `net.Conn` does not take a context. To unblock the `Read`:

1. **Set a read deadline**: `conn.SetReadDeadline(time.Now())`. The Read returns with a timeout error.
2. **Close the connection from another goroutine**: `conn.Close()`. The Read returns with `use of closed network connection`.

Pattern:
```go
go func() {
    <-ctx.Done()
    conn.Close()
}()
n, err := conn.Read(buf)
```

The watcher goroutine closes the conn on cancel; the blocked Read returns.

---

### Q16. Two contexts merged: write `mergeCtx` that cancels when either parent cancels.

**Model answer.**
```go
func mergeCtx(a, b context.Context) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancel(a)
    stop := make(chan struct{})
    go func() {
        select {
        case <-a.Done():
        case <-b.Done():
            cancel()
        case <-stop:
        }
    }()
    return ctx, func() {
        close(stop)
        cancel()
    }
}
```

The watcher goroutine cancels the merged context when `b` cancels. If `a` cancels first, the `ctx` cancels via its parent chain. The returned cancel function tears down the watcher.

---

### Q17. What is async preemption (Go 1.14+) and how does it relate to cancellation?

**Model answer.** Async preemption lets the runtime preempt a goroutine *anywhere* (not just at function-call points) by sending it a signal (SIGURG on POSIX). This ensures fair scheduling even in tight CPU loops.

It does *not* deliver cancellation. A preempted goroutine resumes later, unchanged. Cancellation is separate: the goroutine must read `<-ctx.Done()` to observe a cancel.

People sometimes conflate them. Preemption = "yield"; cancellation = "exit."

---

## Staff

### Q18. Walk through what happens inside `context.cancelCtx.cancel`.

**Model answer.**
1. Acquire the context's mutex.
2. If `err` is already set, return (already cancelled, idempotent).
3. Set `err` and `cause`.
4. Load the `done` channel; if it's the lazy nil, store the `closedchan` sentinel; otherwise `close` it.
5. Iterate `children` and call `cancel(false, err, cause)` on each (skip parent-removal because they're going away).
6. Clear `children`.
7. Release mutex.
8. If `removeFromParent`, remove this context from the parent's children map.

All atomic from the observer's perspective: any goroutine that sees the closed channel sees `err` set.

---

### Q19. Compare Go's cancellation model with Java's `Thread.interrupt`.

**Model answer.**
- Java: thread has an interrupt flag; `interrupt()` sets it. Some methods (sleep, wait, join, I/O on `InterruptibleChannel`) throw `InterruptedException` when the flag is set. Other methods only check via `Thread.interrupted()`. Cooperative.
- Go: goroutine has no flag; cancellation is a separate `context.Context`. The goroutine must `<-ctx.Done()` to observe. No exception is thrown.

Similarities: both cooperative, both rely on the worker checking. Differences: Go is more uniform (one mechanism, propagated explicitly); Java has historical baggage (`Thread.stop`, deprecated `destroy`) and quirks (interrupted status auto-clears in some methods).

---

### Q20. CGO + cancellation: how would you design a wrapper that lets Go cancel a long C call?

**Model answer.** Three options, ranked by reliability:

1. **Modify the C code** to poll a shared atomic flag. Go side sets the flag on cancel. C returns on the next poll. Cooperative across the cgo boundary. Best when you own the C code.

2. **Run the C call in a subprocess.** `exec.CommandContext` kills the subprocess on cancel. The Go side waits via OS pipe. Process isolation makes this robust but adds per-call cost.

3. **Signal targeting via `runtime.LockOSThread`.** Pin the goroutine to an OS thread, get the tid, signal it from another goroutine on cancel. The C code must install a handler. Most fragile.

For most real systems, option 2. The 5–50 ms subprocess overhead is acceptable; the safety is worth it.

---

### Q21. Design metrics for cancellation health in a service.

**Model answer.** Track:

- **Cancellation rate** (counter, per endpoint): how often work is cancelled. Sustained high values may indicate clients with broken connections or impatient users.
- **Timeout rate** (counter): how often deadlines are exceeded. High values may indicate slow downstream or undersized budgets.
- **Cancellation latency** (histogram): time from `cancel()` to "all workers exited" during shutdown. High values indicate cooperative paths that take too long.
- **Goroutine count** (gauge): trend should be stable. Spikes indicate leaks.
- **Active shutdowns** (gauge): if non-zero for long, shutdown is stalling.

Add alerts: cancellation rate > 10% of requests; goroutine count growing linearly with requests; shutdown latency > grace budget.

---

### Q22. What is the right behaviour when a query is cancelled mid-flight in a database driver?

**Model answer.** The driver should:

1. Send a server-side cancel (e.g., `CancelRequest` in PostgreSQL, `KILL QUERY` in MySQL).
2. Wait briefly for the server to acknowledge.
3. Discard the connection (do not return to pool — connection state may be inconsistent).
4. Return `ctx.Err()` to the caller.

The cost: a discarded connection per cancellation. Acceptable in normal operation; if cancellation rates are very high, the pool churns and performance suffers.

Best practice: design queries to not need cancellation (use server-side timeouts as the primary mechanism; use Go-side cancellation only as backup).

---

### Q23. Why doesn't Go have a "cancel all child goroutines" API?

**Model answer.** Goroutines have no parent-child relationship in the runtime. The "parent goroutine" concept is purely in user code (the one that called `go`). The runtime tracks goroutines as a flat set; there is no tree.

If you want hierarchical cancellation, you build it: pass a context, derive children, store cancel functions. `errgroup` does this for groups. There is no need for a runtime-level "cancel children" because the context tree is already hierarchical.

A design constraint: making goroutines hierarchical would add runtime state, complicate the scheduler, and not solve any problem the existing pattern doesn't already solve.

---

### Q24. Design a "structured concurrency" wrapper for Go.

**Model answer.** Using `errgroup` plus a few conventions:

```go
type Scope struct {
    g     *errgroup.Group
    ctx   context.Context
}

func WithScope(ctx context.Context, f func(*Scope) error) error {
    g, ctx := errgroup.WithContext(ctx)
    s := &Scope{g: g, ctx: ctx}
    if err := f(s); err != nil {
        return err
    }
    return g.Wait()
}

func (s *Scope) Go(f func(context.Context) error) {
    s.g.Go(func() error { return f(s.ctx) })
}
```

Use:
```go
WithScope(parentCtx, func(s *Scope) error {
    s.Go(workerA)
    s.Go(workerB)
    return nil
})
```

Properties: spawned goroutines do not outlive `WithScope`; cancellation propagates; errors propagate. This is the de facto structured concurrency idiom in Go.

---

### Q25. The big-picture: why is cooperative cancellation the right default for Go?

**Model answer.** Three reasons:

1. **Safety.** Forced cancellation breaks invariants: locks held, deferred functions skipped, half-written state. Cooperation lets the worker reach a safe point before exiting. Decades of `pthread_cancel` bugs justify this.

2. **Simplicity.** One mechanism (`context.Context`), one API (`<-ctx.Done()`), composable through the tree. No special syntax, no signal-handler subtleties, no thread-local state.

3. **Composability.** Contexts propagate through any layer that accepts them. The HTTP server, the DB driver, the gRPC stack all use the same type. A handler can derive sub-contexts for sub-operations; the tree wires everything together.

The trade-off is discipline: every function in the call chain must respect the context. Get that right (with linters, tests, and `goleak`) and you have a system whose cancellation behaviour is predictable, debuggable, and bounded.
