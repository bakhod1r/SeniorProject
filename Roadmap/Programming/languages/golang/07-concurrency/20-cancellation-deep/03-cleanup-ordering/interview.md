---
layout: default
title: Cleanup Ordering — Interview
parent: Cleanup Ordering
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/03-cleanup-ordering/interview/
---

# Cleanup Ordering — Interview Questions

A graded collection of interview questions on cleanup ordering in Go. Questions are grouped by level: Junior, Middle, Senior, Staff/Principal. Each question has an answer and a follow-up suggestion.

---

## Junior Level

### Q1. What does `defer` do?

**Answer.** `defer` schedules a function call to run when the surrounding function returns. The deferred call runs in LIFO order with respect to other deferred calls in the same function. It runs whether the function returns normally, via an early `return`, or because of a panic.

**Follow-up.** "Does it run on `os.Exit`?" No — `os.Exit` terminates the program immediately without running defers.

### Q2. In what order do these print?

```go
func main() {
    defer fmt.Println("1")
    defer fmt.Println("2")
    defer fmt.Println("3")
}
```

**Answer.** `3`, `2`, `1`. LIFO order — the last registered defer runs first.

### Q3. What does this print?

```go
func main() {
    x := 10
    defer fmt.Println(x)
    x = 99
}
```

**Answer.** `10`. The argument `x` is evaluated at the defer line, when its value was 10. The change to 99 happens after, but the defer already captured 10.

**Follow-up.** "How would you make it print 99?" Use a closure: `defer func() { fmt.Println(x) }()`. The closure captures `x` by reference.

### Q4. Why is `defer f.Close()` a common idiom?

**Answer.** It ensures the file is closed on every function exit path — return, error, panic. Without it, you would need to `f.Close()` in every branch, easy to forget.

### Q5. Is this a bug?

```go
for _, path := range paths {
    f, _ := os.Open(path)
    defer f.Close()
}
```

**Answer.** Yes — defers stack up across iterations and all run at function exit, not at iteration end. For 1000 paths, you hold 1000 open files. Fix: extract a helper function with its own defer scope.

### Q6. What is `sync.WaitGroup` and how does it interact with defer?

**Answer.** `sync.WaitGroup` counts goroutines. `Add(n)` increments, `Done()` decrements, `Wait()` blocks until count reaches zero. The idiom `defer wg.Done()` at the top of a goroutine ensures the count decrements even if the goroutine panics.

### Q7. What is `context.Context`?

**Answer.** It is Go's standard mechanism for propagating cancellation, deadlines, and request-scoped values across API boundaries. Functions that may block accept a `Context` and check `ctx.Done()` or `ctx.Err()`.

### Q8. Why do you call `defer cancel()`?

**Answer.** Because `context.WithCancel`, `WithTimeout`, and `WithDeadline` return a `cancel` function that must be called to release the context's internal resources (timer, goroutine watching the parent). `defer cancel()` ensures it runs even if the function returns early or panics.

### Q9. What is the `io.Closer` interface?

**Answer.** It is the standard interface for resources that need explicit closing: `interface { Close() error }`. Files, network connections, HTTP response bodies, and database transactions all implement it (or a superset).

### Q10. What happens to a goroutine that panics?

**Answer.** The panic propagates up the goroutine's call stack, running deferred functions. If a deferred function calls `recover()`, the panic is caught. Otherwise, the panic reaches the top of the goroutine and terminates the program (printing the panic value and stack trace).

---

## Middle Level

### Q11. How would you propagate an error from `Close` in a function that writes to a file?

**Answer.** Use a named return and check `Close`'s error in a deferred closure:

```go
func write(path string) (err error) {
    f, err := os.Create(path)
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    // ... write ...
    return nil
}
```

The "only overwrite if nil" pattern ensures a real write error is not masked by a close error.

### Q12. What is `errors.Join` and when do you use it?

**Answer.** `errors.Join(errs...)` returns a single error wrapping all non-nil inputs. Useful when multiple cleanup steps can each fail and you want the caller to see all failures. `errors.Is` and `errors.As` work transparently across joined errors.

### Q13. Explain `context.AfterFunc`.

**Answer.** `context.AfterFunc(ctx, fn)` registers `fn` to run in a new goroutine when `ctx` is cancelled. It returns a `stop` function: calling `stop` deregisters the callback. The callback runs at most once. The stop function does not wait for the callback.

### Q14. What is the cancel-drain-close pattern?

**Answer.** Three-step shutdown:
1. Cancel: signal that no new work should be accepted.
2. Drain: wait for in-flight work to finish.
3. Close: release resources.

Order matters: closing before drain truncates in-flight work; cancelling without drain leaves workers running on stale context.

### Q15. Why is this code wrong?

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
go work(ctx)
return nil
```

**Answer.** `cancel` is never called. The context's internal goroutine and timer leak until the parent is cancelled or until the timeout fires. Fix: `defer cancel()`.

### Q16. What is `errgroup.Group`?

**Answer.** A package in `golang.org/x/sync/errgroup`. Like `sync.WaitGroup` but propagates the first non-nil error from any goroutine and (when created with `WithContext`) cancels a shared context on first error.

### Q17. Predict the output:

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
stop := context.AfterFunc(ctx, func() { fmt.Println("a") })
defer stop()
cancel()
time.Sleep(10*time.Millisecond)
```

**Answer.** Prints `a`. Cancel fires; AfterFunc callback runs in a new goroutine, prints `a`; main sleeps 10ms (giving the goroutine time to run), then returns. The deferred `stop()` is a no-op (callback already started). The deferred `cancel()` is a no-op (already cancelled).

### Q18. Should `Close` methods be idempotent?

**Answer.** Yes, generally. Multiple shutdown paths may call Close. Using `sync.Once` makes the close idempotent. Most stdlib closers are also idempotent (return an error on second call but don't crash).

### Q19. What is `signal.NotifyContext`?

**Answer.** Go 1.16+. `signal.NotifyContext(parent, signals...)` returns a context that is cancelled when any of the named signals (SIGINT, SIGTERM, etc.) is received. Replaces manual signal handling in main.

### Q20. Explain `context.WithCancelCause` and `context.Cause`.

**Answer.** Go 1.20+. `WithCancelCause` returns a `CancelCauseFunc` that accepts an error. The error is stored as the context's "cause." `context.Cause(ctx)` retrieves it. Useful for distinguishing why a context was cancelled (e.g., user abort vs server error).

---

## Senior Level

### Q21. Design a `LifecycleManager` for a service with 20 components.

**Answer.** A type that:
- Holds a list of components implementing `Start(ctx) error` and `Stop(ctx) error`.
- Has `Add(component)` to register.
- Has `Start(ctx)` that starts each in order; on failure, unwinds.
- Has `Stop(ctx)` that stops each in reverse order; joins errors via `errors.Join`.
- Is safe for concurrent use of Stop (via `sync.Once`).
- Has hooks for logging/metrics.

**Follow-up.** "How would you handle parallel start where possible?" Detect components that have no inter-dependencies; start them with `errgroup.Group.Go`; wait.

### Q22. Why pass a fresh context (not the signal context) to shutdown?

**Answer.** Because the signal context is already cancelled by the time you're shutting down. Passing it to shutdown methods like `http.Server.Shutdown` means "abort immediately, drop in-flight work." Instead, derive a fresh context with a deadline from `context.Background()`.

### Q23. Explain the order of these defers and what runs first:

```go
defer logger.Close()
defer metrics.Close()
defer db.Close()
defer cache.Close()
defer workers.Stop(ctx)
defer httpServer.Shutdown(ctx)
defer cancel()
```

**Answer.** LIFO. Order at function exit:
1. `cancel()` (signals workers to stop)
2. `httpServer.Shutdown(ctx)` (drains HTTP connections)
3. `workers.Stop(ctx)` (waits for workers)
4. `cache.Close()`
5. `db.Close()`
6. `metrics.Close()` (after DB writes might emit metrics)
7. `logger.Close()` (last, so it logs everything)

### Q24. How do you test that a component does not leak goroutines?

**Answer.** Use `goleak.VerifyNone(t)` (from go.uber.org/goleak) at the end of tests. Alternatively, capture `runtime.NumGoroutine()` before and after the test, asserting no growth (with a small tolerance for runtime goroutines).

### Q25. What is the trade-off between hierarchical vs flat component lifecycles?

**Answer.** Hierarchical (each parent owns children's Start/Stop) gives strong dependency ordering and type safety, but adds boilerplate. Flat (a central registry) is simpler but less type-safe; ordering depends on registration order. For 5-10 components, hierarchical works well. For 50+, flat-with-priorities scales better.

### Q26. How would you implement a panic-safe goroutine launcher?

**Answer.** Wrap the goroutine body with `defer recover()`:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("panic: %v", r)
        }
    }()
    work()
}()
```

For production, add metrics and structured logging.

### Q27. What happens if a deferred function panics during another panic?

**Answer.** The new panic replaces the old one. The old panic value is lost (its `aborted` flag is set in the runtime). The new panic continues unwinding through remaining defers.

To preserve the original, recover inside the cleanup:

```go
defer func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("cleanup panic: %v", r)
        }
    }()
    cleanup()
}()
```

### Q28. Explain Kubernetes' `terminationGracePeriodSeconds` and how it relates to Go cleanup.

**Answer.** Kubernetes sends SIGTERM, then waits `terminationGracePeriodSeconds` (default 30s), then sends SIGKILL. Your Go shutdown must complete within that window. Typical pattern: `signal.NotifyContext` catches SIGTERM; shutdown context has a deadline slightly less than the grace period.

### Q29. Why might `db.Close()` be called *before* `logger.Close()` in some services?

**Answer.** If you want the database close to be logged. The logger must still be alive when DB closes. So order: workers stop, DB closes (logger captures the events), metrics flush, logger flushes. Logger closes last.

### Q30. Design a graceful HTTP server shutdown with a worker pool that drains.

**Answer.**

```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
defer stop()

srv := startServer()
pool := startWorkers()

<-ctx.Done()

shutdownCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
defer cancel()

srv.Shutdown(shutdownCtx)   // drain in-flight requests
pool.Stop(shutdownCtx)       // drain queued jobs
db.Close()                   // close DB last
```

The order: HTTP drains (so no new work to workers), workers drain (so DB isn't queried), DB closes.

---

## Staff/Principal Level

### Q31. Walk me through how Go's compiler decides between open-coded and heap defers.

**Answer.** During SSA construction, the compiler's defer pass analyses each function. It counts defers, checks for loops, and evaluates control flow. If the function has ≤ 8 defers, none inside a loop, and statically countable, the compiler open-codes them: a bit vector in the stack frame and inline cleanup at the function's exit. Otherwise, it falls back to `runtime.deferproc` / `runtime.deferreturn` calls.

The criteria are conservative. Use `-gcflags='-d=defer=2'` to see decisions.

### Q32. What is the cost of `runtime.gopanic`?

**Answer.** A panic walks the goroutine's defer chain, calling each deferred function. The fixed cost is small (~100 ns for the panic record setup); the per-defer cost is the cost of the deferred function plus chain traversal. For a function with 5 defers and a panic+recover, total cost is roughly 500-1000 ns. For panics that crash the program, additional time is spent generating the stack trace.

### Q33. How does `context.AfterFunc` interact with the `cancelCtx` callback list?

**Answer.** AfterFunc registers an `afterFuncCtx` as a child of the target context. When the parent is cancelled, it iterates its children (including all afterFuncCtxs) and calls their cancel methods. Each afterFuncCtx's cancel uses `sync.Once` to ensure the user's callback runs at most once, and launches a new goroutine to run it.

The cost: O(1) registration, O(1) firing per callback (plus goroutine creation).

### Q34. What is the memory model contract for defers?

**Answer.** Deferred function calls happen-before the function's return to its caller. Writes performed by the deferred function are visible to the caller (and to any goroutine receiving from a channel closed by the defer). For named returns, the defer can modify them, and the modified value is what the caller observes.

For multiple defers in the same function, the LIFO order is a happens-before chain: each defer happens-before the next-popped one.

### Q35. Compare Go's defer with C++'s RAII destructors and Rust's Drop.

**Answer.**
- **C++ RAII:** Destructors run when objects go out of scope. Order: reverse of construction (LIFO). Compile-time. No runtime cost beyond the destructor itself. Cannot return errors from destructors (must use exceptions, which are problematic).
- **Rust Drop:** Similar to C++ RAII. Compile-time. Cannot return errors. Move semantics ensure each value is dropped exactly once.
- **Go defer:** Runtime registration. Can return errors via named return. More flexible but with runtime overhead. Open-coded defer reduces this to near-zero.

Go's defer is more dynamic; C++ and Rust are more static. Each has trade-offs.

### Q36. How would you debug a production service that hangs on SIGTERM?

**Answer.**
1. Capture a stack dump (SIGQUIT or `runtime.Stack`).
2. Identify goroutines stuck in `chan receive`, `Wait`, or `Lock`.
3. Find the cleanup path: which Stop method is blocked, and on what.
4. Check for missing context propagation: a cleanup operation that doesn't respect its deadline.
5. Check for circular dependencies: A waits for B, B waits for A.

Once identified, fix by:
- Plumbing context through every blocking operation.
- Breaking dependency cycles.
- Adding deadlines to network calls.
- Wrapping with `safeStop` to convert panics into errors.

### Q37. Design a cleanup system for a service that spans 100 components.

**Answer.** Component-based with explicit ordering:
1. Each component implements `Component` interface with Start/Stop methods.
2. Components are grouped into layers (infrastructure, data, business logic, presentation).
3. Each layer has its own LifecycleManager.
4. The service has a top-level LifecycleManager that owns the layers in order.
5. Layers can shut down in parallel within themselves, but layers are sequential.
6. Hooks provide logging, metrics, and panic recovery for every Start/Stop.
7. Tests verify no goroutine leak and proper ordering.

### Q38. What is the difference between `Goexit` and `panic`?

**Answer.**
- **Goexit:** Ends only the current goroutine. Runs defers. Cannot be recovered (recover returns nil). Used by `testing.T.FailNow`.
- **Panic:** Ends the current goroutine and, if not recovered, the whole program. Runs defers. Recoverable via `recover()` in a deferred function.

Both unwind the stack identically. The difference is in recovery semantics and program-termination behaviour.

### Q39. Critique this code:

```go
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
```

**Answer.** Several issues:
1. No defer recover; a panic in doWork kills the program.
2. The default case is a busy-loop: it polls without yielding. CPU at 100%.
3. No coordination with a parent — the parent has no way to wait for this goroutine.

Fix:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v", r)
        }
    }()
    for {
        select {
        case <-ctx.Done():
            return
        case <-tick():
            doWork()
        }
    }
}()
```

Or use a ticker. And use `sync.WaitGroup` so the parent can wait.

### Q40. How would you instrument cleanup for production observability?

**Answer.**
- Emit a metric per Stop call: `shutdown_duration_seconds{component="..."}`.
- Emit a counter for shutdown errors: `shutdown_errors_total{component="..."}`.
- Log every Start and Stop with structured fields: name, elapsed, error.
- Have a dashboard with p50, p99 shutdown duration per component.
- Alert if p99 approaches the graceful period.
- Run soak tests in CI that assert no goroutine leak.

Observability turns cleanup from a hidden behaviour into a measurable property.

---

## Bonus Questions

### Q41. What is the role of `t.Cleanup` in Go testing?

**Answer.** `t.Cleanup(fn)` registers `fn` to run at the end of the test (or subtest), in LIFO order. Unlike `defer`, it works across helper functions: a helper can register cleanup that runs at the test's end, not at the helper's return. Essential for test isolation.

### Q42. How does `runtime.SetFinalizer` work and when should you use it?

**Answer.** `SetFinalizer(obj, fn)` schedules `fn(obj)` to run when the GC determines `obj` is unreachable. It's a safety net, not a primary cleanup mechanism. The GC's timing is not predictable. Use cases:
- Debugging: panic if the object was not closed.
- Last-resort safety: close an FD if the user forgot.

Do not use finalizers for cleanup with timing or ordering requirements.

### Q43. What is `errcheck` and what cleanup-related bugs does it catch?

**Answer.** `errcheck` is a linter that warns when functions returning errors are called without checking the error. For cleanup, it catches:
- `defer f.Close()` ignoring the close error.
- `tx.Commit()` whose error is unhandled.
- Any cleanup function returning an error that the caller drops.

Run in CI. A good complement to `go vet`'s `lostcancel` check.

### Q44. Why is `defer mu.Unlock()` so common?

**Answer.** Locking and unlocking must be balanced. With `defer`, the unlock runs on every exit path (return, panic). Without it, you would need to unlock in every branch — easy to forget, especially after refactoring.

The cost: defer adds a few ns. For mutex-bound code, irrelevant.

### Q45. How would you implement a custom `Closer` that is safe to close multiple times?

**Answer.**

```go
type Once struct {
    once    sync.Once
    closeFn func() error
    err     error
}

func NewOnce(closeFn func() error) *Once {
    return &Once{closeFn: closeFn}
}

func (o *Once) Close() error {
    o.once.Do(func() {
        o.err = o.closeFn()
    })
    return o.err
}
```

Repeated calls return the cached error. Standard idempotent-close pattern.

### Q46. Explain `database/sql.Tx.Rollback` and its idempotency.

**Answer.** `Tx.Rollback` is safe to call after `Commit` — it returns `sql.ErrTxDone`. This enables the deferred-rollback-then-commit pattern:

```go
tx, _ := db.BeginTx(ctx, nil)
defer tx.Rollback()  // safe even after successful Commit
// ... work ...
return tx.Commit()
```

If Commit succeeds, the deferred Rollback returns an error which we typically ignore (since the commit succeeded). If anything before Commit fails, Rollback actually rolls back.

### Q47. What is the purpose of `signal.Reset`?

**Answer.** It restores the default behaviour for a signal. Useful when you registered a handler with `signal.Notify` and now want to go back to the default. For SIGTERM, the default is process exit.

`signal.NotifyContext`'s `stop` function effectively calls Reset for the registered signals (more precisely, `signal.Stop` for the internal channel).

### Q48. How do you write a soak test for a service's shutdown?

**Answer.**

```go
func TestShutdownSoak(t *testing.T) {
    baseline := runtime.NumGoroutine()
    for i := 0; i < 1000; i++ {
        svc := New()
        svc.Start(ctx)
        svc.Stop(ctx)
    }
    runtime.GC()
    after := runtime.NumGoroutine()
    if after > baseline+5 { // small tolerance
        t.Errorf("goroutine leak: baseline=%d after=%d", baseline, after)
    }
}
```

Run 1000 start/stop cycles. After GC, goroutine count should return to baseline. Use `go.uber.org/goleak` for more rigorous checking.

### Q49. What are the trade-offs of using `runtime.SetFinalizer` for cleanup?

**Answer.**

Pros:
- Catches missing-close bugs in development.
- Provides eventual cleanup even if the user forgets.

Cons:
- Runs at unpredictable times during GC.
- Has GC cost.
- Can resurrect objects (run-then-make-reachable patterns).
- Cannot run cleanup with timing constraints.
- Hides bugs in production (people stop calling Close because "the finalizer handles it").

Verdict: use sparingly, only as a debugging aid.

### Q50. Final question: what's the most important principle of cleanup ordering in Go?

**Answer.** **Release in reverse of acquisition.** LIFO order, encoded naturally by `defer`, ensures that dependents are released before their dependencies. If you acquire A, then B (which depends on A), then C (which depends on B), you release C, then B, then A. This is the foundational rule. Everything else — error propagation, context cancellation, AfterFunc semantics, lifecycle management — is in service of this principle.

---

## How to Use These Questions

For interviewers: pick 3-5 questions across levels to assess depth. Junior questions probe baseline competence; middle questions assess practical use; senior+ questions explore design judgment.

For candidates: practice all 50. Cleanup ordering is a frequent interview topic for Go positions, especially at senior+ levels.

For self-study: cover one question per day. Implement the code where applicable. Verify your understanding by running it.

---

End of interview questions.

---

## Additional Practice Questions

### Q51. Predict the output:

```go
func main() {
    defer fmt.Println("a")
    func() {
        defer fmt.Println("b")
    }()
    defer fmt.Println("c")
    fmt.Println("d")
}
```

**Answer.** `d`, then `b` (inside the inner function), then `c`, then `a`. The inner anonymous function has its own defer scope; `b` runs when it returns. Then main continues, prints `d` (already printed), and returns; LIFO: `c`, `a`.

Wait, let me re-trace. The inner function is called *between* the two outer defers. So:
1. `defer "a"` registered.
2. Inner func runs: `defer "b"` registered inside; inner body has nothing else; inner returns; `b` prints.
3. `defer "c"` registered.
4. `fmt.Println("d")` prints `d`.
5. main returns; LIFO: `c` then `a`.

Output: `b`, `d`, `c`, `a`.

### Q52. What does this print?

```go
func wrap() error {
    return fmt.Errorf("wrapped: %w", errors.New("base"))
}

func main() {
    err := wrap()
    fmt.Println(errors.Is(err, errors.New("base")))
}
```

**Answer.** `false`. `errors.Is` uses identity for sentinel errors — `errors.New("base")` returns a *new* error each call, so the comparison fails.

The fix: define the sentinel once:

```go
var baseErr = errors.New("base")
```

Then `errors.Is(err, baseErr)` returns true if `err` wraps `baseErr`.

This is not directly about cleanup, but it's a common interview point related to error handling around defers.

### Q53. Walk me through what happens during `defer cancel()` for a context with AfterFunc registered.

**Answer.**
1. `defer cancel()` registers the cancel function.
2. At function exit, the deferred call fires `cancel()`.
3. `cancel()` marks the context done by closing `Done`.
4. The context iterates its children and cancels each.
5. For each `afterFuncCtx` child, the cancel triggers its `once.Do`, launching a goroutine to run the user's callback.
6. Cancel returns. The deferred call returns. Function continues exit.

Note: the AfterFunc callback runs concurrently. The function returns before the callback necessarily completes.

### Q54. How would you wait for an AfterFunc callback to finish before returning?

**Answer.** Coordinate explicitly:

```go
done := make(chan struct{})
stop := context.AfterFunc(ctx, func() {
    defer close(done)
    cleanup()
})
defer func() {
    if stop() {
        close(done) // never ran
    }
    <-done
}()
```

The pattern: try `stop()`; if it returns true, the callback was never started, so close `done` ourselves. Otherwise wait on `done` which the callback closes.

### Q55. What is `runtime.LockOSThread` and how does it interact with defer?

**Answer.** `LockOSThread` binds the current goroutine to an OS thread. It is paired with `UnlockOSThread`. A common pattern is `runtime.LockOSThread(); defer runtime.UnlockOSThread()`.

Defers fire on the goroutine that registered them, on whatever thread it's currently running on. So the deferred `UnlockOSThread` runs on the bound thread, releasing it correctly.

For functions that need OS-level state (e.g., setting thread-local OS resources), locking is essential.

### Q56. Why must `runtime.UnlockOSThread` match `runtime.LockOSThread` in defer?

**Answer.** If the function exits without unlocking, the thread remains bound. The next time the goroutine runs, it returns to that thread. If the bound thread is held by a panicking goroutine, the thread is wasted. The pairing ensures release.

### Q57. Compare `errgroup.Group` with `sync.WaitGroup` for goroutine coordination.

**Answer.**

| Feature | `sync.WaitGroup` | `errgroup.Group` |
|---------|-----------------|------------------|
| Wait for completion | Yes | Yes |
| Propagate first error | No (you DIY) | Yes |
| Cancel on first error | No | Yes (with WithContext) |
| Limit concurrency | No (you DIY) | Yes (with SetLimit, Go 1.20+) |

For more than two goroutines coordinated around a context, `errgroup` is almost always the right choice.

### Q58. What is `errgroup.Group.SetLimit` (Go 1.20+)?

**Answer.** Sets the maximum number of concurrent goroutines. `Go` blocks until a slot is available. Useful for bounded concurrency (e.g., "process 100 items but at most 10 in parallel").

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(10)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
return g.Wait()
```

### Q59. What is the difference between `Tx.Commit() error` and `Tx.Commit(ctx) error`?

**Answer.** Go's `database/sql.Tx.Commit` takes no context. The transaction inherits the context from `BeginTx`. To time out a commit, set a deadline on the BeginTx context.

Some drivers have non-standard variants. Check the driver docs.

### Q60. How do you cleanly stop a goroutine that is blocked on `io.Reader.Read`?

**Answer.** Use `SetDeadline` on the underlying connection (for network reads) or wrap with `context.AfterFunc` to call `Close` on cancel:

```go
stop := context.AfterFunc(ctx, func() {
    conn.Close()
})
defer stop()
// ... read ...
```

`conn.Close` will unblock the pending `Read` with an error. The deferred `stop` deregisters the callback if we complete normally.

For files, the same approach with `f.Close` works.

---

## Interview Tips for Cleanup-Ordering Questions

1. **Always think about LIFO first.** Most questions test your understanding of defer order.
2. **Distinguish argument capture from closure capture.** Critical for predicting output.
3. **Remember named returns.** They are the bridge between defers and the function's outcome.
4. **For shutdown questions, think dependency graph.** Order is reverse of dependency.
5. **Mention `errgroup` and `signal.NotifyContext` when relevant.** Shows production awareness.
6. **For runtime questions, acknowledge open-coded vs heap.** Even if you don't go deep, the distinction matters.
7. **Be precise about `recover`.** It only works inside deferred functions.
8. **Always check error from Close for writers.** Mentioning it scores points.

Cleanup ordering is a topic where senior+ candidates differentiate themselves. The depth of nuance — from defer order to architecture-level lifecycle — is a clear signal of experience.

Good luck.
