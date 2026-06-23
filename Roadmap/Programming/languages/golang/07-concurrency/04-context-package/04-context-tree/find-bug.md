# Context Tree — Find the Bug

[← Back to index](junior.md)

A grab-bag of broken context-tree code. For each snippet, find the bug, explain why it breaks, and write a corrected version. Solutions follow each problem.

---

## Bug 1: The Forgotten Cancel

```go
func handle(req *http.Request) error {
    ctx, _ := context.WithTimeout(req.Context(), 5*time.Second)
    return doWork(ctx)
}
```

**Bug.** The `cancel` function is discarded. The `timerCtx` and its `time.Timer` linger until the 5-second deadline expires, even if `doWork` returns in 50ms. On a busy server this accumulates millions of pending timers.

`go vet` catches this: `the cancel function returned by context.WithTimeout should be called, not discarded`.

**Fix.**

```go
ctx, cancel := context.WithTimeout(req.Context(), 5*time.Second)
defer cancel()
return doWork(ctx)
```

---

## Bug 2: Wrong Parent

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    do(ctx, r)
}
```

**Bug.** The handler has `r.Context()` — the per-request context that cancels on client disconnect. By deriving from `context.Background()` instead, the handler severs that link. If the client closes the connection, `do` will not see cancellation.

**Fix.**

```go
ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
defer cancel()
do(ctx, r)
```

---

## Bug 3: Defer Inside a Loop

```go
for _, item := range items {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    defer cancel()
    process(ctx, item)
}
```

**Bug.** `defer cancel()` does not run until the enclosing function returns. After 1000 iterations, 1000 cancels are stacked. Each `timerCtx` is alive until the function exits.

**Fix.** Move `cancel()` inside the loop body, not in a defer:

```go
for _, item := range items {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    process(ctx, item)
    cancel()
}
```

Or wrap each iteration in a closure:

```go
for _, item := range items {
    func() {
        ctx, cancel := context.WithTimeout(parent, time.Second)
        defer cancel()
        process(ctx, item)
    }()
}
```

---

## Bug 4: Cancel Captured in Closure

```go
var cancel context.CancelFunc

func startBackground() {
    var ctx context.Context
    ctx, cancel = context.WithCancel(context.Background())
    go worker(ctx)
}

func stopBackground() {
    cancel()
}
```

**Bug.** Two issues. First, `cancel` is package-scoped — concurrent calls to `startBackground` overwrite it, leaking the previous worker's cancel. Second, `cancel` may be nil if `stopBackground` is called before `startBackground`.

**Fix.** Wrap in a struct with ownership:

```go
type Bg struct {
    cancel context.CancelFunc
    mu     sync.Mutex
}

func (b *Bg) Start() {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.cancel != nil {
        return // already running
    }
    ctx, cancel := context.WithCancel(context.Background())
    b.cancel = cancel
    go worker(ctx)
}

func (b *Bg) Stop() {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.cancel != nil {
        b.cancel()
        b.cancel = nil
    }
}
```

---

## Bug 5: Expecting Cancel to Propagate Up

```go
parent, _ := context.WithCancel(context.Background())
child, cancelChild := context.WithCancel(parent)
cancelChild()
<-parent.Done() // hangs forever
```

**Bug.** Cancellation flows only downward. Cancelling `child` does nothing to `parent`. The `<-parent.Done()` blocks forever.

**Fix.** Cancel the parent if you want the parent to be cancelled. Children cannot kill their parents.

---

## Bug 6: WithValue Used for Cancellation

```go
done := make(chan struct{})
ctx := context.WithValue(parent, "done", done)
go worker(ctx)
close(done) // worker keeps running, never sees cancellation
```

**Bug.** `WithValue` does not introduce cancellation. The worker reading `ctx.Value("done")` would need to manually select on the channel, defeating the purpose of using `context` at all.

**Fix.** Use `WithCancel`.

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
go worker(ctx)
```

---

## Bug 7: Extending the Parent's Deadline

```go
short, _ := context.WithTimeout(context.Background(), 100*time.Millisecond)
long, _ := context.WithTimeout(short, 10*time.Second)

slowOp(long) // expected to run for 10 seconds
```

**Bug.** First-deadline-wins. The outer parent's 100ms deadline wins. `long` cancels at 100ms, not 10 seconds. The runtime does not even start a 10s timer for `long`.

**Fix.** If `slowOp` must run for 10 seconds, decouple from the parent:

```go
detached := context.WithoutCancel(short)
long, cancel := context.WithTimeout(detached, 10*time.Second)
defer cancel()
slowOp(long)
```

---

## Bug 8: AfterFunc Without Stop

```go
context.AfterFunc(ctx, func() { conn.Close() })
// ... operation completes successfully ...
conn.Close()
```

**Bug.** If the context never cancels, the `AfterFunc` registration sits in `ctx.children` forever (until the ctx itself dies). If the context does cancel after the manual `conn.Close()`, the conn is closed twice — potentially a panic or error.

**Fix.** Capture the stop function and call it.

```go
stop := context.AfterFunc(ctx, conn.Close)
defer func() {
    if !stop() {
        // AfterFunc already fired; conn is closed by it.
        return
    }
    // We stopped AfterFunc; we must close ourselves.
    conn.Close()
}()
```

Or simpler: only register `AfterFunc` for cleanup that *must* run if cancelled, and handle normal close explicitly.

---

## Bug 9: Custom Context With Broken Value

```go
type myCtx struct {
    context.Context
    logger *log.Logger
}

func (m myCtx) Value(k any) any {
    if k == loggerKey {
        return m.logger
    }
    return nil // BUG: should fall through to embedded Context
}
```

**Bug.** Returning `nil` for unknown keys breaks the value chain. `context.Cause`, `parentCancelCtx`, and any user code that calls `ctx.Value(otherKey)` get `nil` instead of the upstream value. `propagateCancel` cannot find the parent's `*cancelCtx`, so every derived child spawns a watcher goroutine.

**Fix.**

```go
func (m myCtx) Value(k any) any {
    if k == loggerKey {
        return m.logger
    }
    return m.Context.Value(k)
}
```

Or, better, do not implement a custom context. Use `context.WithValue`.

---

## Bug 10: WithoutCancel With Values Used for Cancellation Hints

```go
detached := context.WithoutCancel(req.Context())
go audit(detached)

// Later, somewhere:
<-detached.Done() // never fires
```

**Bug.** `WithoutCancel`'s `Done()` returns `nil`. Receiving from a nil channel blocks forever. The audit goroutine never exits.

**Fix.** Re-establish cancellation on the detached side.

```go
detached := context.WithoutCancel(req.Context())
auditCtx, cancel := context.WithTimeout(detached, 30*time.Second)
defer cancel()
go audit(auditCtx)
```

Now `auditCtx.Done()` fires at 30 seconds.

---

## Bug 11: Cancel Called on Behalf of Caller

```go
func process(ctx context.Context) error {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    cancel() // cancels caller's ctx? no — only this derived ctx
    return work(ctx)
}
```

This is not actually a bug — the immediate `cancel()` only cancels the local derivation. But it's confusing and pointless. The author probably misunderstood the semantics.

**Discussion.** Calling `cancel()` immediately after `WithCancel` cancels the new node and any descendants but leaves the parent alone. If the intent was to cancel the caller's ctx, the function would need to receive a cancel function as an argument — but that is usually a code smell.

---

## Bug 12: Sharing Cancel Across Goroutines

```go
ctx, cancel := context.WithCancel(parent)
go workerA(ctx, cancel)
go workerB(ctx, cancel)
go workerC(ctx, cancel)
```

**Bug.** Three goroutines each hold the cancel function. Any one can shut down all three. If `workerA` returns an error and calls `cancel()`, that is fine. But often `workerA` returns an error *and* calls `cancel`, then the deferred `cancel()` in the caller runs again — harmless (idempotent), but the design diffuses ownership.

**Fix.** Use `errgroup`-style coordination. The cancel belongs to the supervisor; workers report errors back, and the supervisor cancels.

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return workerA(ctx) })
g.Go(func() error { return workerB(ctx) })
g.Go(func() error { return workerC(ctx) })
if err := g.Wait(); err != nil { /* ... */ }
```

---

## Bug 13: Multiple Defers Race

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
go func() {
    defer cancel()
    <-someChan
}()
work(ctx)
```

This is not a bug; cancel is idempotent. But the double defer is confusing. Pick one.

---

## Bug 14: Cancel Stored in Struct

```go
type Service struct {
    ctx    context.Context
    cancel context.CancelFunc
}

func NewService() *Service {
    ctx, cancel := context.WithCancel(context.Background())
    return &Service{ctx: ctx, cancel: cancel}
}
```

**Bug.** Storing `cancel` in a struct decouples its lifetime from any function scope. If `Service` is forgotten without calling `Stop`/`Close`, the context leaks. `go vet` *will not* catch this — the cancel is "used" because it's assigned to a field.

**Fix.** If you genuinely need long-lived contexts, document the close contract:

```go
type Service struct {
    ctx    context.Context
    cancel context.CancelFunc
}

func NewService() *Service { /* ... */ }

// Close stops background work. Must be called.
func (s *Service) Close() { s.cancel() }
```

Test with `runtime.SetFinalizer` that all instances are closed.

---

## Bug 15: Derivation From Already-Cancelled Context

```go
ctx, cancel := context.WithCancel(context.Background())
cancel()

sub, _ := context.WithTimeout(ctx, time.Second)
result := slowOp(sub) // returns immediately with error
```

Not a bug per se — this is correct behaviour. `sub` is cancelled at construction because its parent already is. But the author may have expected `sub` to "reset" the cancellation. It does not.

**Discussion.** Always check `ctx.Err()` before doing serious work. A cancelled context cannot be revived.

---

## Bug 16: Deep WithValue Lookups

```go
ctx := context.Background()
for i := 0; i < 10000; i++ {
    ctx = context.WithValue(ctx, i, i)
}
// Later, in a hot loop:
for j := 0; j < 1000; j++ {
    v := ctx.Value(0) // walks 10000 levels every call
}
```

**Bug.** `Value` is O(depth). 10000-deep chain with 1000 lookups is 10M interface calls.

**Fix.** Use one node carrying a struct:

```go
type appCtx struct{ a, b, c, d int }
ctx := context.WithValue(context.Background(), appCtxKey{}, appCtx{...})
v := ctx.Value(appCtxKey{}).(appCtx) // one walk
```

---

## Bug 17: Goroutine That Never Exits

```go
func worker(ctx context.Context) {
    for {
        select {
        case <-time.After(time.Second):
            doWork()
        // missing: case <-ctx.Done()
        }
    }
}
```

**Bug.** The worker never observes cancellation. Even with a cancel cascade, the worker spins forever.

**Fix.**

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(time.Second):
        doWork()
    }
}
```

---

## Bug 18: time.After in a Loop

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(time.Hour):
        doHourlyWork()
    }
}
```

**Bug.** `time.After` allocates a fresh timer per iteration. The previous timer is not garbage collected until it fires (an hour later). Memory grows.

**Fix.** Use a `time.Timer`:

```go
t := time.NewTimer(time.Hour)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        doHourlyWork()
        t.Reset(time.Hour)
    }
}
```

Not strictly a context tree bug, but worth flagging.

---

## Bug 19: Cause Set Too Late

```go
ctx, cancel := context.WithCancelCause(parent)
defer cancel(nil)

err := doWork(ctx)
if err != nil {
    cancel(err) // BUG: ctx may already be cancelled by parent
    return err
}
```

**Bug.** If `parent` was cancelled mid-`doWork`, `cancel(err)` is a no-op (first-write-wins). The cause from parent (which may be `context.Canceled` or `context.DeadlineExceeded`) is the one preserved.

**Fix.** Order matters. If `doWork` returned an error you produced, set the cause *before* anything else can cancel:

```go
done := make(chan struct{})
var workErr error
go func() {
    workErr = doWork(ctx)
    close(done)
}()
select {
case <-done:
    if workErr != nil {
        cancel(workErr)
    }
case <-ctx.Done():
    return context.Cause(ctx)
}
```

---

## Bug 20: Stop Function Called Repeatedly

```go
stop := context.AfterFunc(ctx, cleanup)
stop()
stop() // safe?
```

**Behaviour.** Calling `stop()` twice is safe in current implementations; the second call returns `false`. But relying on this is non-portable.

**Recommendation.** Call `stop()` exactly once. Capture the boolean.

---

## Bug 21: Custom Context With Wrong Deadline

```go
type fakeDeadlineCtx struct {
    context.Context
    deadline time.Time
}
func (f fakeDeadlineCtx) Deadline() (time.Time, bool) { return f.deadline, true }
```

**Bug.** Reporting a deadline that the context never enforces. Code that calls `ctx.Deadline()` to budget downstream calls trusts the lie and blocks past the deadline.

**Fix.** Do not invent deadlines. If you have a deadline, use `WithDeadline`.

---

## Bug 22: Goroutine Leak via Watcher

```go
type myCtx struct{ context.Context }

for i := 0; i < 1_000_000; i++ {
    derived := myCtx{Context: parent}
    sub, _ := context.WithCancel(derived) // spawns a watcher goroutine each iteration
    go work(sub)
}
```

**Bug.** Custom `myCtx` does not expose its `cancelCtxKey` through `Value`. `propagateCancel` falls back to spawning a watcher goroutine. 1M iterations = 1M goroutines, possibly exhausting memory.

**Fix.** Drop `myCtx`. Use `context.WithValue` or a plain `*cancelCtx` chain.

---

## Bug 23: WithDeadline With Past Time

```go
ctx, cancel := context.WithDeadline(parent, time.Now().Add(-time.Hour))
defer cancel()
// expect work to run for a bit before cancellation
work(ctx)
```

**Behaviour, not a bug.** `WithDeadline` notices the deadline is already in the past and cancels `ctx` immediately. `work` sees `<-ctx.Done()` fire on first check. If `work` does not check, it may run to completion.

**Discussion.** This is the correct semantic. Always sanitise inputs from external sources before passing them as deadlines.

---

## Bug 24: AfterFunc Registered After Cancellation

```go
ctx, cancel := context.WithCancel(context.Background())
cancel()
context.AfterFunc(ctx, cleanup) // does cleanup run?
```

**Behaviour.** Yes. If the context is already cancelled at registration time, `AfterFunc` schedules `cleanup` to run immediately (in a new goroutine). This is the documented behaviour.

**Discussion.** Useful for "guarantee cleanup runs regardless of order."

---

## Bug 25: The Background Goroutine That Outlives the Server

```go
func main() {
    srv := startServer()
    bg := context.Background()
    go pollMetrics(bg)
    srv.Wait()
}
```

**Bug.** When `main` returns, `pollMetrics` is killed by process exit — but it has no chance to flush. If `pollMetrics` was supposed to be cancellable on shutdown, you needed `WithCancel(bg)` somewhere wired to the shutdown signal.

**Fix.**

```go
ctx, cancel := context.WithCancel(context.Background())
go func() {
    <-signalChan
    cancel()
}()
go pollMetrics(ctx)
srv.Wait()
cancel()
```

---

## Bug 26: Cause Not Used After Cancellation

```go
ctx, cancel := context.WithCancelCause(parent)
defer cancel(nil)

if err := check(); err != nil {
    cancel(err)
    return
}
// Later, somewhere downstream:
if ctx.Err() != nil {
    return ctx.Err() // BUG: drops the cause
}
```

**Bug.** `ctx.Err()` only says "Canceled" or "DeadlineExceeded." The original error is lost.

**Fix.**

```go
if ctx.Err() != nil {
    return context.Cause(ctx)
}
```

---

## Bug 27: Mixing WithoutCancel With Deadline-Bearing Parent

```go
parent, cancel := context.WithTimeout(context.Background(), time.Second)
defer cancel()

detached := context.WithoutCancel(parent)
// expect detached to inherit the 1s timeout
work(detached)
```

**Behaviour.** `detached.Deadline()` returns `(time.Time{}, false)` — no deadline. The author may have expected the timeout to carry through.

**Discussion.** `WithoutCancel` is "no cancellation at all" — including no deadline. If you want a different deadline, derive a fresh `WithTimeout`.

---

## Bug 28: Re-deriving In a Hot Loop

```go
for msg := range messages {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    handle(ctx, msg)
    cancel()
}
```

Not a bug, but worth examining. Each iteration allocates one `timerCtx`. At 100k msgs/sec that's 100k allocs/sec.

**Optimisation.** If every message has the same deadline relative to a known start, hoist the context outside the loop. Or use channels with a single timer.

---

## Bug 29: Premature Cancel

```go
ctx, cancel := context.WithCancel(context.Background())
go func() {
    cancel() // immediately!
    work(ctx)
}()
```

**Bug.** `cancel` runs *before* `work` starts. `work` sees an already-cancelled context.

**Fix.** Call `cancel` after work completes, not before:

```go
go func() {
    defer cancel()
    work(ctx)
}()
```

---

## Bug 30: Forgotten WithoutCancel

```go
func backgroundWrite(req *http.Request, data []byte) {
    go func() {
        if err := write(req.Context(), data); err != nil {
            log.Printf("write failed: %v", err)
        }
    }()
}
```

**Bug.** `req.Context()` cancels on response completion. The goroutine spawned to write may not have a chance to finish. The author wanted the write to be detached.

**Fix.**

```go
func backgroundWrite(req *http.Request, data []byte) {
    detached := context.WithoutCancel(req.Context())
    ctx, cancel := context.WithTimeout(detached, 10*time.Second)
    go func() {
        defer cancel()
        if err := write(ctx, data); err != nil {
            log.Printf("write failed: %v", err)
        }
    }()
}
```

---

## Bug 31: Cancel Not Idempotent in User Code

```go
type Job struct {
    ctx    context.Context
    cancel context.CancelFunc
    done   atomic.Bool
}

func (j *Job) Stop() {
    if j.done.Load() {
        return
    }
    j.cancel()
    j.done.Store(true)
}
```

Not strictly a bug — context's cancel is idempotent, so the `done` flag is redundant. But two `Stop` calls racing here cause two `cancel` calls, which is fine. Simplify by removing the flag, or add a `sync.Once` if you have other state to reset.

---

## Summary

The recurring bugs:

- Forgetting `defer cancel()`.
- Deriving from the wrong parent (especially `Background()` instead of the request's context).
- Believing cancellation flows upward or sideways.
- Treating `WithValue` as a cancellation mechanism.
- Putting cancels in struct fields without a clear close contract.
- Implementing custom `Context` types that break `Value`-based shortcuts.
- Forgetting that `WithoutCancel` removes deadlines too.
- Not setting `Cause` before alternative cancellations can race.

Run `go vet`, `staticcheck`, and `goleak` over your codebase regularly. Most of these bugs are caught at the linter level.
