# Common Usecases — Find the Bug

[← Back to index](junior.md)

Each section presents broken production code, asks you to find the bug, then offers a fix. Read carefully before peeking at the answer; these are the bugs you will see in real code review.

## Bug 1 — `WithValue` Detaches the Request

```go
func authMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        user, err := verify(r.Header.Get("Authorization"))
        if err != nil {
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }
        ctx := context.WithValue(context.Background(), userKey{}, user)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

### What's wrong?

The middleware constructs a *new* context from `context.Background()` instead of `r.Context()`. The downstream handler:

- Loses the request's deadline.
- Loses any values added by previous middleware.
- No longer aborts when the client disconnects.

### Fix

```go
ctx := context.WithValue(r.Context(), userKey{}, user)
```

Always derive from `r.Context()`. This is the single most common ctx bug in middleware.

---

## Bug 2 — Missing Context On DB Query

```go
func loadProfile(ctx context.Context, db *sql.DB, id int64) (*Profile, error) {
    row := db.QueryRow(`SELECT id, name FROM profiles WHERE id = $1`, id)
    var p Profile
    return &p, row.Scan(&p.ID, &p.Name)
}
```

### What's wrong?

`db.QueryRow` does not accept a context. The query has no deadline, ignores cancellation, and holds a connection until the underlying database's own timeout fires.

### Fix

```go
row := db.QueryRowContext(ctx, `SELECT id, name FROM profiles WHERE id = $1`, id)
```

Always use the `Context` variant of every `database/sql` method.

---

## Bug 3 — Lost Cancel On WithTimeout

```go
func enrich(ctx context.Context, o *Order) error {
    ctx, _ = context.WithTimeout(ctx, 800*time.Millisecond)
    return externalAPI.Call(ctx, o)
}
```

### What's wrong?

The `cancel` function is discarded. Even after the timeout fires, the underlying `time.Timer` and the entry in the parent's `children` map persist until garbage collection — they cannot be cleaned up because nothing calls cancel.

`go vet -lostcancel` (enabled by default) flags this.

### Fix

```go
ctx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
defer cancel()
return externalAPI.Call(ctx, o)
```

---

## Bug 4 — Type Assertion Panic In Getter

```go
type userIDKey struct{}

func UserIDFrom(ctx context.Context) string {
    return ctx.Value(userIDKey{}).(string)
}
```

### What's wrong?

If no middleware ever stored a `userIDKey` value, `ctx.Value(...)` returns `nil`. The type assertion `nil.(string)` panics.

### Fix

```go
func UserIDFrom(ctx context.Context) (string, bool) {
    id, ok := ctx.Value(userIDKey{}).(string)
    return id, ok
}
```

Use the comma-ok form. Handle the `ok == false` case at the call site.

---

## Bug 5 — String Key Collision

```go
// package auth
ctx = context.WithValue(ctx, "user_id", userID)

// package billing (different file, same project)
ctx = context.WithValue(ctx, "user_id", customerID)  // overrides!
```

### What's wrong?

String keys collide. The auth package's `user_id` and the billing package's `user_id` are the same key — equal as `==`. Whichever ran second silently overwrites the other.

### Fix

Use unexported empty struct types per package:

```go
// package auth
type userIDKey struct{}
ctx = context.WithValue(ctx, userIDKey{}, userID)

// package billing
type customerIDKey struct{}
ctx = context.WithValue(ctx, customerIDKey{}, customerID)
```

Different types are different keys, even if identically named.

---

## Bug 6 — Stored Context

```go
type Service struct {
    ctx context.Context
    db  *sql.DB
}

func New(ctx context.Context, db *sql.DB) *Service {
    return &Service{ctx: ctx, db: db}
}

func (s *Service) Get(id int64) (*Row, error) {
    return s.db.QueryRowContext(s.ctx, "SELECT * FROM t WHERE id=$1", id), nil
}
```

### What's wrong?

The Service stores ctx, typically `Background()` from program start. Every method uses that one ctx no matter what request invoked it. Per-request deadlines, trace IDs, authentication — all gone.

The Go documentation explicitly forbids storing Context in a struct.

### Fix

```go
func (s *Service) Get(ctx context.Context, id int64) (*Row, error) {
    return s.db.QueryRowContext(ctx, "SELECT * FROM t WHERE id=$1", id), nil
}
```

Each method takes its own ctx as the first parameter.

---

## Bug 7 — Goroutine Outlives Handler

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    go audit.Log(ctx, "request", r.URL.Path)
    w.Write([]byte("ok"))
}
```

### What's wrong?

When the handler returns, `r.Context()` is canceled. The audit goroutine sees `ctx.Done()` close and aborts before the audit is recorded.

### Fix

Use a detached context for background work:

```go
bg := context.WithoutCancel(ctx)  // Go 1.21+
go audit.Log(bg, "request", r.URL.Path)
```

Or a fresh `Background()` if you do not need request-scoped values:

```go
go audit.Log(context.Background(), "request", r.URL.Path)
```

---

## Bug 8 — `context.TODO()` In Production

```go
func (s *Service) BackgroundJob() error {
    rows, err := s.db.QueryContext(context.TODO(), `SELECT ...`)
    // ...
}
```

### What's wrong?

`context.TODO()` is a placeholder marker meaning "this code path needs a real context but I haven't wired one through yet." It works the same as `Background()` but signals incomplete plumbing.

In production, this query is uncancellable; if `BackgroundJob` is invoked from a context-bearing caller, the deadline is silently dropped.

### Fix

Either accept a ctx parameter:

```go
func (s *Service) BackgroundJob(ctx context.Context) error { ... }
```

Or, if it really is the program's root, use `Background()` with a comment explaining why.

---

## Bug 9 — `time.Sleep` Inside Goroutine

```go
func poller(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
        }
        fetch()
        time.Sleep(5 * time.Second)
    }
}
```

### What's wrong?

`time.Sleep` ignores cancellation. When ctx is canceled mid-sleep, the goroutine still sleeps the full 5 seconds. Worse, the `select` is non-blocking — it never blocks waiting for cancel; it polls.

### Fix

```go
func poller(ctx context.Context) {
    t := time.NewTicker(5 * time.Second)
    defer t.Stop()
    for {
        fetch()
        select {
        case <-ctx.Done():
            return
        case <-t.C:
        }
    }
}
```

The ticker replaces sleep; the select blocks on either tick or cancel.

---

## Bug 10 — Cleanup Uses Canceled Context

```go
func upload(ctx context.Context, r io.Reader) error {
    id := uuid.NewString()
    if err := stream(ctx, id, r); err != nil {
        deletePartial(ctx, id)  // <- ctx is canceled or expired
        return err
    }
    return nil
}
```

### What's wrong?

When `stream` fails because of ctx cancellation, `deletePartial(ctx, ...)` immediately fails too — ctx is already done. The partial upload leaks.

### Fix

Use a fresh context for cleanup with its own deadline:

```go
if err := stream(ctx, id, r); err != nil {
    cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    _ = deletePartial(cleanCtx, id)
    return err
}
```

Cleanup must be robust against the parent's failure mode.

---

## Bug 11 — `WithValue` For Non-Request-Scoped Data

```go
func main() {
    ctx := context.Background()
    ctx = context.WithValue(ctx, dbKey{}, db)         // database handle
    ctx = context.WithValue(ctx, configKey{}, config) // config struct
    ctx = context.WithValue(ctx, clientKey{}, client) // HTTP client
    serve(ctx)
}
```

### What's wrong?

These are not request-scoped. They are *dependencies*. The `WithValue` mechanism becomes a poor man's DI container with no compile-time guarantees, no clear ownership, and a slow O(depth) lookup on every access.

### Fix

Pass dependencies explicitly:

```go
type Server struct {
    db     *sql.DB
    config Config
    client *http.Client
}

func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    s.db.QueryRowContext(r.Context(), ...)
}
```

Use `WithValue` only for true request-scoped metadata: trace ID, auth principal, request-scoped logger, span.

---

## Bug 12 — Middleware Order Wrong

```go
func main() {
    h := http.HandlerFunc(handle)
    h = LoggerMiddleware(h)
    h = RequestIDMiddleware(h)
    http.ListenAndServe(":8080", h)
}
```

Logs are missing the `request_id` field even though `RequestIDMiddleware` sets it.

### What's wrong?

Middleware applied last is *outermost*. Here:

```
RequestIDMiddleware (outermost — runs first)
  -> LoggerMiddleware (sees ctx with request ID)
    -> handle
```

Wait — that's actually correct? Look more carefully at the assignment order:

```go
h = LoggerMiddleware(h)         // h is now Logger(handle)
h = RequestIDMiddleware(h)      // h is now RequestID(Logger(handle))
```

Outermost is the last assignment. So `RequestID` runs first, sets the ID, then `Logger` runs and reads it. That should work.

Let's revisit — the bug must be that `LoggerMiddleware` constructs its base logger *before* the request runs. If it reads `RequestIDFrom` at middleware *construction time*, it gets nothing:

```go
// BUG
func LoggerMiddleware(next http.Handler) http.Handler {
    log := slog.With("request_id", "???")  // captured at startup, not per-request
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        next.ServeHTTP(w, r.WithContext(WithLogger(r.Context(), log)))
    })
}
```

### Fix

Read the request ID *inside* the handler closure, not outside:

```go
func LoggerMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log := slog.Default().With("request_id", RequestIDFrom(r.Context()))
        next.ServeHTTP(w, r.WithContext(WithLogger(r.Context(), log)))
    })
}
```

Per-request work belongs inside the handler, not in the middleware constructor.

---

## Bug 13 — Channel Send Without Cancel Select

```go
func produce(ctx context.Context, out chan<- int, items []int) {
    defer close(out)
    for _, i := range items {
        out <- i
    }
}
```

### What's wrong?

If the consumer stops reading (because ctx is canceled), `out <- i` blocks forever. The producer goroutine leaks.

### Fix

```go
func produce(ctx context.Context, out chan<- int, items []int) {
    defer close(out)
    for _, i := range items {
        select {
        case <-ctx.Done():
            return
        case out <- i:
        }
    }
}
```

Every channel send in a context-aware goroutine must select on `ctx.Done()`.

---

## Bug 14 — Errgroup Without WithContext

```go
var g errgroup.Group
for _, url := range urls {
    url := url
    g.Go(func() error {
        return fetch(ctx, url)
    })
}
g.Wait()
```

### What's wrong?

When one fetch fails, the others continue running until they finish on their own. No cancellation flows; the failure is delayed.

### Fix

Use `errgroup.WithContext`:

```go
g, ctx := errgroup.WithContext(parentCtx)
for _, url := range urls {
    url := url
    g.Go(func() error {
        return fetch(ctx, url)
    })
}
g.Wait()
```

Now first error cancels the new ctx; the other fetches see `ctx.Done()` and abort.

---

## Bug 15 — Calling `cancel` After Returning Through `defer`

```go
func work(parent context.Context) error {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    go func() {
        time.Sleep(2 * time.Second)
        cancel()
    }()
    return doWork(ctx)
}
```

### What's wrong?

The goroutine fires `cancel` after the function has returned. By that time, `cancel` is still valid (it's idempotent), but the goroutine has leaked — there is nothing to wait on. If `work` is called many times, you get a tower of zombie goroutines.

### Fix

If you really want a delayed cancel, use `context.AfterFunc` (Go 1.20+):

```go
func work(parent context.Context) error {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    defer cancel()
    return doWork(ctx)
}
```

The `WithTimeout` already gives you the timeout-fires-cancel behavior. The hand-rolled goroutine was redundant.

---

## Bug 16 — Logging Ctx Without Sanitizing

```go
func logRequest(ctx context.Context) {
    log.Printf("ctx=%v", ctx)
}
```

### What's wrong?

`%v` on a context prints the entire chain including all values. If your chain contains an auth token or user PII, it lands in your logs in plaintext.

### Fix

Log only specific extracted fields:

```go
log.Printf("request_id=%s user_id=%s", RequestIDFrom(ctx), UserIDFrom(ctx))
```

Never log raw context.

---

## Bug 17 — Misusing context.Cause vs ctx.Err

```go
ctx, cancel := context.WithCancelCause(parent)
cancel(fmt.Errorf("bad input"))
err := ctx.Err()
fmt.Println(err)  // prints "context canceled" — but I expected my cause!
```

### What's wrong?

`ctx.Err()` returns the standard sentinel (`context.Canceled` or `context.DeadlineExceeded`). To get the cause, use `context.Cause(ctx)`.

### Fix

```go
fmt.Println(context.Cause(ctx))  // prints "bad input"
```

When you cancel with a cause, retrieve via `Cause`, not `Err`.

---

## Bug 18 — Context In Long-Lived Channel

```go
type Job struct {
    ctx  context.Context
    data Data
}

func enqueue(ctx context.Context, jobs chan<- Job, d Data) {
    jobs <- Job{ctx: ctx, data: d}
}
```

### What's wrong?

A goroutine pulls jobs from `jobs` and uses each job's ctx. Sometimes the ctx is already canceled when the job is dequeued (the producer's request ended hours ago). The job is silently dropped.

Worse, each Job pinning a ctx prevents that ctx and its values from being GC'd.

### Fix

Decouple: enqueue only data; the consumer derives its own ctx:

```go
type Job struct {
    Data Data
    Meta Meta // tenantID, traceID — small, copyable
}

func enqueue(jobs chan<- Job, d Data, m Meta) {
    jobs <- Job{Data: d, Meta: m}
}

func consume(ctx context.Context, jobs <-chan Job) {
    for j := range jobs {
        process(ctx, j)
    }
}
```

The consumer's ctx is tied to its own lifetime, not the producer's request.

---

## Bug 19 — Forgetting To Honor Context In Custom Reader

```go
type slowReader struct {
    src io.Reader
}

func (r *slowReader) Read(p []byte) (int, error) {
    time.Sleep(100 * time.Millisecond)
    return r.src.Read(p)
}
```

If wrapped around a request body and the request's ctx is canceled, reads keep going for 100 ms each.

### What's wrong?

The reader has no way to honor cancellation. Sleeping in `Read` is uncancellable.

### Fix

Take ctx in the constructor and select on it:

```go
type slowReader struct {
    ctx context.Context
    src io.Reader
}

func (r *slowReader) Read(p []byte) (int, error) {
    select {
    case <-r.ctx.Done():
        return 0, r.ctx.Err()
    case <-time.After(100 * time.Millisecond):
    }
    return r.src.Read(p)
}
```

Storing ctx here is OK because the reader's lifetime is tied to a single read operation. If the reader outlives the operation, this becomes the same anti-pattern as Bug 6.

---

## Bug 20 — Using `select` With `default` Instead Of `Done`

```go
for {
    select {
    case j := <-jobs:
        process(j)
    default:
        // do something else
    }
}
```

### What's wrong?

This is a busy loop. With no `<-ctx.Done()` case, cancellation is invisible; the loop spins at 100% CPU and never exits.

### Fix

```go
for {
    select {
    case <-ctx.Done():
        return
    case j := <-jobs:
        process(j)
    }
}
```

If you genuinely need a non-blocking poll, use a ticker, not a `default` case in a for-select.

---

## Bug 21 — Re-using Outer cancel After Function Returns

```go
func makeCtx() (context.Context, context.CancelFunc) {
    return context.WithTimeout(context.Background(), time.Second)
}

func use() {
    ctx, cancel := makeCtx()
    go work(ctx, cancel)  // pass cancel into goroutine
}
```

### What's wrong?

`use` returns immediately. The `cancel` deferred ownership transfers to the goroutine — but `use`'s caller has no way to know whether the goroutine has stopped, leaked, or finished. If many `use` calls happen, the timers stack up.

### Fix

Either own cancel in `use` (defer it), wait synchronously for `work` to finish, or change the design so the caller passes ctx in:

```go
func use(ctx context.Context) {
    sub, cancel := context.WithTimeout(ctx, time.Second)
    defer cancel()
    work(sub)
}
```

Lifetime should be obvious to the reader.

---

## Final Notes

If you saw all 21 bugs without help, you have an excellent eye for ctx code review. If you missed half, return to the senior and middle files; the patterns above are the everyday slip-ups in production Go.

Recurring themes:

- **Always derive from `r.Context()`**, never `Background()` mid-handler.
- **Always use `Context` variants** of stdlib functions.
- **Never store ctx** in a struct field.
- **Always defer cancel.**
- **Type-assert with comma-ok.**
- **Cleanup uses fresh context.**
- **Background goroutines need detached context.**
- **String keys collide; use struct keys.**

[← Back to index](junior.md)
