# Deadlines and Cancellations — Find the Bug

[← Back to index](junior.md)

Each section presents broken code, asks you to find the bug, and offers a fix. Treat them like code review: read carefully before peeking at the answer.

## Bug 1 — The Lost Cancel

```go
func loadProfile(parent context.Context, id int) (*Profile, error) {
    ctx, _ := context.WithTimeout(parent, 500*time.Millisecond)
    p, err := db.QueryProfile(ctx, id)
    if err != nil {
        return nil, err
    }
    return p, nil
}
```

### What's wrong?

The cancel function is discarded. Even though the timeout will eventually fire, the underlying `time.Timer` lives in the runtime until the deadline passes. Under load, you accumulate millions of pending timers. Also, `parent.children` keeps a reference to the derived ctx, blocking GC.

### Fix

```go
ctx, cancel := context.WithTimeout(parent, 500*time.Millisecond)
defer cancel()
```

Run `go vet ./...` — `lostcancel` would have caught this before merge.

---

## Bug 2 — Sleep Is Not Cancellable

```go
func poller(ctx context.Context, ch chan<- Event) {
    for {
        evs := fetch()
        for _, e := range evs {
            ch <- e
        }
        time.Sleep(2 * time.Second)
    }
}
```

### What's wrong?

If `ctx` is canceled mid-sleep, the goroutine still snoozes the full 2 seconds. Worse, the loop has no `<-ctx.Done()` selection at all — the only way it exits is if `fetch` panics or the channel send blocks forever.

### Fix

```go
func poller(ctx context.Context, ch chan<- Event) {
    t := time.NewTicker(2 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
        }
        evs := fetch()
        for _, e := range evs {
            select {
            case <-ctx.Done():
                return
            case ch <- e:
            }
        }
    }
}
```

Two changes: the ticker replaces `time.Sleep`, and the channel send selects on `Done` so we don't block forever if no consumer is reading.

---

## Bug 3 — Stored Context

```go
type Service struct {
    ctx context.Context
    db  *sql.DB
}

func New(ctx context.Context, db *sql.DB) *Service {
    return &Service{ctx: ctx, db: db}
}

func (s *Service) Get(id int) (*Row, error) {
    return s.db.QueryRowContext(s.ctx, "select ...", id).Err()
}
```

### What's wrong?

The Service stores a context — usually whatever `Background()` was passed in at startup. Every method uses that single context regardless of which request it was called from. Per-request deadlines, trace IDs, cancellation — all gone. The Go documentation explicitly forbids storing `Context` in struct fields.

### Fix

```go
type Service struct { db *sql.DB }

func New(db *sql.DB) *Service { return &Service{db: db} }

func (s *Service) Get(ctx context.Context, id int) (*Row, error) {
    return s.db.QueryRowContext(ctx, "select ...", id).Err()
}
```

Pass `ctx` explicitly to every method that needs it.

---

## Bug 4 — Equality Instead of errors.Is

```go
if err := slowCall(ctx); err == context.Canceled {
    return ErrUserCanceled
}
return err
```

### What's wrong?

The standard library wraps context errors as they cross boundaries. `slowCall` may return `fmt.Errorf("rpc: %w", context.Canceled)`, which is not `==` to `context.Canceled`. Result: the branch never fires, the wrapped error leaks to the caller.

### Fix

```go
if errors.Is(err, context.Canceled) {
    return ErrUserCanceled
}
```

Same applies to `DeadlineExceeded`. Always `errors.Is`.

---

## Bug 5 — Cancel Inside Goroutine

```go
ctx, cancel := context.WithCancel(context.Background())
go func() {
    defer cancel() // intends to cancel on goroutine exit
    runForever(ctx)
}()

doOtherWork(ctx)
```

### What's wrong?

`runForever(ctx)` is named accurately — it never returns. The `defer cancel()` never runs. Meanwhile `doOtherWork(ctx)` proceeds expecting `ctx` to track its lifecycle, but in fact the cancel is locked inside the runaway goroutine. If we want `doOtherWork` to control the cancel, we must keep it in the calling goroutine.

### Fix

Decide who owns the cancel. If the parent owns:

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
go runForever(ctx)
doOtherWork(ctx)
```

If the goroutine owns, build a separate context for it:

```go
go func() {
    workerCtx, workerCancel := context.WithCancel(context.Background())
    defer workerCancel()
    runForever(workerCtx)
}()
```

The bug is conceptual: confusion about whose lifetime drives whose cancel.

---

## Bug 6 — WithTimeout Inside a Long Loop

```go
func processAll(parent context.Context, items []Item) error {
    for _, it := range items {
        ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
        if err := handle(ctx, it); err != nil {
            return err
        }
        // forgot defer or explicit cancel
    }
    return nil
}
```

### What's wrong?

Each iteration creates a new `timerCtx` with a `time.Timer`. The cancel is never called. The `parent.children` map grows unboundedly while the loop runs; for `len(items) = 100k`, that is 100k entries blocking the parent until parent itself cancels.

`go vet -lostcancel` catches it.

### Fix

```go
for _, it := range items {
    ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
    err := handle(ctx, it)
    cancel() // explicit, not defer (defer would only run when the function returns)
    if err != nil {
        return err
    }
}
```

Important: do **not** use `defer cancel()` inside a loop unless you intend the cancels to all run at function exit (rarely correct). Call cancel explicitly each iteration.

---

## Bug 7 — Timeout Smaller Than Work

```go
ctx, cancel := context.WithTimeout(parent, 50*time.Millisecond)
defer cancel()
out, err := slowAPI(ctx) // typical latency: 200ms
```

### What's wrong?

50 ms is shorter than typical latency. Every request times out. The handler returns `DeadlineExceeded`, retries kick in, and you've turned a normal-latency dependency into a saturated outage.

### Fix

Measure before you set timeouts. p99 latency should fit comfortably inside the timeout:

```go
ctx, cancel := context.WithTimeout(parent, 500*time.Millisecond) // p99 of slowAPI
defer cancel()
```

Even better, derive the timeout from the *parent's* remaining budget rather than picking a constant.

---

## Bug 8 — Nil Context

```go
type Job struct{ Run func(ctx context.Context) error }

func runAll(jobs []Job) error {
    for _, j := range jobs {
        if err := j.Run(nil); err != nil {
            return err
        }
    }
    return nil
}
```

### What's wrong?

`j.Run(nil)`. If any job tries to do `ctx.Done()`, it dereferences nil and panics. Same for `ctx.Err()`. Even if jobs happen to not use ctx, this is forbidden by package documentation.

### Fix

```go
ctx := context.TODO() // or Background()
if err := j.Run(ctx); err != nil { return err }
```

`TODO()` is the right choice if you haven't decided what context to thread through yet.

---

## Bug 9 — Missing ctx.Err() Check

```go
func generate(ctx context.Context, n int, out chan<- int) {
    for i := 0; i < n; i++ {
        out <- expensiveCompute(i) // no ctx check
    }
    close(out)
}
```

### What's wrong?

`expensiveCompute` is CPU-bound. The loop never checks `ctx.Err()`. If the consumer cancels — say, by closing the response — this goroutine keeps computing all `n` values and writing to `out`. The send may block if no one reads, so the goroutine leaks indefinitely.

### Fix

```go
for i := 0; i < n; i++ {
    if err := ctx.Err(); err != nil {
        return
    }
    select {
    case <-ctx.Done():
        return
    case out <- expensiveCompute(i):
    }
}
close(out)
```

Two checks: `ctx.Err()` cheaply skips compute; the select on send unblocks if no reader.

---

## Bug 10 — Defer Cancel Inside an If

```go
func handle(ctx context.Context, fast bool) error {
    if !fast {
        ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
        defer cancel()
        return doSlow(ctx)
    }
    return doFast(ctx)
}
```

### What's wrong?

Subtle: the `ctx, cancel := ...` shadows the outer `ctx` inside the `if` block. The `defer cancel()` belongs to the function (so it runs at function exit). That's fine. But the `defer` is registered *only if* we entered the if. If `fast` is true, no derived context, no defer — also fine.

So... no bug? Actually correct! This one is a trap to test attention. `:=` creates a new variable in the if block; `defer` captures the right cancel. The pattern works.

A real bug variant:

```go
func handle(ctx context.Context, fast bool) error {
    ctx, cancel := context.WithCancel(ctx)
    if !fast {
        ctx, cancel = context.WithTimeout(ctx, 5*time.Second) // shadows!
    }
    defer cancel()
    return do(ctx)
}
```

Here `cancel` is reassigned in the if block. The outer `defer cancel()` is captured **at defer time**, not at execution. In Go, `defer cancel()` captures the value of `cancel` at the time the `defer` line runs — which is *before* the if. So defer cancels the outer cancel, not the timeout cancel. The timeout's timer leaks.

### Fix

```go
ctx, cancel := context.WithCancel(ctx)
defer cancel()
if !fast {
    var c2 context.CancelFunc
    ctx, c2 = context.WithTimeout(ctx, 5*time.Second)
    defer c2()
}
return do(ctx)
```

Two cancels, two defers, no shadowing.

---

## Bug 11 — context.Background Inside a Handler

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    if err := process(ctx); err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    w.Write([]byte("ok"))
}
```

### What's wrong?

The handler ignores `r.Context()`. If the client disconnects, the request's context cancels, but `process(ctx)` keeps running because it's tied to a fresh `Background`. You burn server resources on an abandoned request.

### Fix

```go
ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
defer cancel()
```

The only places `context.Background()` belongs in a handler:

- `srv.Shutdown(context.Background())` — but more likely a 30-second timeout context.
- Spawning a fire-and-forget background task (and even then, prefer `context.WithoutCancel(r.Context())`).

---

## Bug 12 — Custom Cancelation Channel

```go
type Worker struct {
    stop chan struct{}
}

func (w *Worker) Run(ctx context.Context) {
    for {
        select {
        case <-w.stop:
            return
        case ev := <-w.events:
            handle(ev)
        }
    }
}

func (w *Worker) Stop() { close(w.stop) }
```

### What's wrong?

Two cancelation systems running in parallel: `ctx` is accepted but never selected on, and a custom `stop` channel is the actual control. If `ctx` cancels, the worker keeps running. If you call `Stop()` more than once, `close(w.stop)` panics.

### Fix

Use `ctx` directly:

```go
func (w *Worker) Run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case ev := <-w.events:
            handle(ev)
        }
    }
}

func (w *Worker) Stop() { /* call the cancel func returned by WithCancel */ }
```

Or store a `context.CancelFunc` in the struct (allowed!) and have `Stop` call it.

---

## Bug 13 — WithDeadline With a Zero Time

```go
ctx, cancel := context.WithDeadline(parent, time.Time{})
defer cancel()
```

### What's wrong?

The zero `time.Time` is `Jan 1, year 1`. `time.Until(time.Time{})` is enormously negative. `WithDeadline` notices the deadline has already passed and returns a context that is *already canceled*. The very first `<-ctx.Done()` fires. Anyone passing `time.Time{}` thinking it means "no deadline" gets bizarre behavior.

### Fix

If you mean "no deadline," do not call `WithDeadline` at all — return `parent` unchanged. Or compute the deadline from the right source:

```go
if d, ok := config.Deadline(); ok {
    ctx, cancel = context.WithDeadline(parent, d)
} else {
    ctx, cancel = context.WithCancel(parent)
}
defer cancel()
```

---

## Bug 14 — Cancel on Wrong Branch

```go
ctx, cancel := context.WithCancel(parent)
go background(ctx)
if synchronous {
    cancel()
}
return doSync(ctx)
```

### What's wrong?

If `synchronous` is true, cancel fires immediately. But `background(ctx)` and `doSync(ctx)` both share the same ctx — they're now both canceled before doing real work. The intent was probably "cancel `background` if we're done synchronously," but cancelling the parent cancels children too.

### Fix

Give them separate contexts:

```go
bgCtx, bgCancel := context.WithCancel(parent)
go background(bgCtx)
defer bgCancel()

return doSync(parent)
```

Or use `WithoutCancel` for the synchronous branch.

---

## Bug 15 — Defer in a Closure

```go
ctx, cancel := context.WithTimeout(parent, time.Second)
go func() {
    defer cancel()
    doWork(ctx)
}()
```

### What's wrong?

The `cancel` runs only when `doWork` returns. If `doWork` blocks indefinitely, the cancel never runs. The parent has no way to interrupt the goroutine.

If you want the parent to be able to abort, the cancel must live on the parent side.

### Fix

```go
ctx, cancel := context.WithTimeout(parent, time.Second)
defer cancel()
done := make(chan struct{})
go func() { doWork(ctx); close(done) }()
select {
case <-done:
case <-ctx.Done():
}
```

Now the parent's defer runs no matter how doWork behaves. The goroutine is still potentially leaked if doWork ignores ctx, but at least the parent makes progress.

---

## Bug 16 — Forgotten Cancel on Error Path

```go
func multiCall(ctx context.Context) error {
    a, cancelA := context.WithTimeout(ctx, time.Second)
    if err := callA(a); err != nil {
        return err // cancelA leaked
    }
    defer cancelA()
    return callB(ctx)
}
```

### What's wrong?

The `defer cancelA()` is registered after the early return path. If `callA` errors, we exit without cancelling — leaking the timer.

### Fix

Defer immediately after creating the cancel:

```go
a, cancelA := context.WithTimeout(ctx, time.Second)
defer cancelA()
if err := callA(a); err != nil {
    return err
}
return callB(ctx)
```

The single most important rule: `cancel := WithX(...); defer cancel()` is one inseparable pair. No code between them.

---

## Bug 17 — Context.Value With a Built-In Key

```go
ctx = context.WithValue(ctx, "userID", 42)

uid := ctx.Value("userID").(int)
```

### What's wrong?

The string key collides with any other package using the same string. If a third-party library also stores a "userID" key, you overwrite each other silently. The package doc says: use a private, unexported key type.

`staticcheck` has check `SA1029` for this.

### Fix

```go
type userIDKey struct{}

ctx = context.WithValue(ctx, userIDKey{}, 42)
uid, _ := ctx.Value(userIDKey{}).(int)
```

The empty struct type is unique to your package. No collision possible.

---

## Bug 18 — AfterFunc Stop Not Called

```go
done := context.AfterFunc(ctx, func() { releaseResource() })
// ... do work ...
releaseResource()
return
```

### What's wrong?

Two things. First, `done` is the `stop` function — it's not called, so if `ctx` cancels later, `releaseResource` runs *again* on its own goroutine. Second, even on the success path, the function name is misleading — `done` is `func() bool`, not a "done" signal.

### Fix

```go
stop := context.AfterFunc(ctx, func() { releaseResource() })
// ... do work ...
if stop() {
    releaseResource() // run only if AfterFunc didn't run yet
}
```

The `stop()` returns true if the registered function had not yet started. We then run cleanup ourselves.

---

## Bug 19 — Cancel Cause Lost in Translation

```go
ctx, cancel := context.WithCancelCause(parent)

go func() {
    if err := upstream(ctx); err != nil {
        cancel(err)
    }
}()

if err := work(ctx); err != nil {
    return err // returns "context canceled", not the cause
}
```

### What's wrong?

The intent of `WithCancelCause` is to surface the original error. But `work(ctx)` likely returns `ctx.Err()`, which is `context.Canceled` — the cause is hidden.

### Fix

```go
if err := work(ctx); err != nil {
    if cause := context.Cause(ctx); cause != nil {
        return cause
    }
    return err
}
```

Or wrap: `return fmt.Errorf("work failed: %w (cause: %v)", err, context.Cause(ctx))`.

---

## Bug 20 — Goroutine Doesn't See Parent Cancel

```go
ctx, _ := context.WithCancel(context.Background())
go work(ctx)
// later: ctx not exposed; cancel goes out of scope
```

### What's wrong?

The cancel is discarded. The goroutine never receives a cancel signal. The only way `ctx` cancels is if the parent (`Background()`) cancels — which never happens. Goroutine leaks for the program lifetime.

### Fix

Make `cancel` available to whoever needs to call it. Often this means storing it in a struct or returning it from a constructor:

```go
type Worker struct{ cancel context.CancelFunc }

func New() *Worker {
    ctx, cancel := context.WithCancel(context.Background())
    w := &Worker{cancel: cancel}
    go w.run(ctx)
    return w
}

func (w *Worker) Stop() { w.cancel() }
```

---

## Bug 21 — Race on Cancel + Read

```go
ctx, cancel := context.WithCancel(parent)
go func() {
    cancel()
}()
fmt.Println(ctx.Err()) // might print nil or might print "context canceled"
```

### What's wrong?

This is **not actually a bug** — `ctx.Err()` is safe to call concurrently with `cancel()`. The result is just nondeterministic: you might see the value before or after cancel completes. The race detector does not flag this; the operation is internally synchronized.

But if your code *depends* on the timing, you have a logic bug. Always pair `<-ctx.Done()` with reading `ctx.Err()`:

```go
<-ctx.Done()
fmt.Println(ctx.Err()) // always non-nil
```

---

## Bug 22 — TimerCtx Holding Connection

```go
func dial(parent context.Context, addr string) (net.Conn, error) {
    ctx, _ := context.WithTimeout(parent, 100*time.Millisecond)
    return (&net.Dialer{}).DialContext(ctx, "tcp", addr)
}
```

### What's wrong?

Cancel discarded. Plus, after a successful dial, the context is no longer needed but the timer is still running until the deadline. For 100 ms timeouts that's negligible; for 30-second dial timeouts on a busy proxy, those timers stack up.

### Fix

```go
ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
defer cancel()
return (&net.Dialer{}).DialContext(ctx, "tcp", addr)
```

`defer cancel()` runs as soon as the function returns, stopping the timer immediately whether dial succeeded or failed.

---

## Closing Thoughts

Re-read these bugs whenever you review context-using code. The patterns repeat: discarded cancels, sleep-instead-of-select, equality-instead-of-Is, stored-context-in-struct, missing `r.Context()` propagation, `context.Background()` deep in handlers. Once you have built a mental scanner for these, your reviews catch them in seconds.
