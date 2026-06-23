# Common Usecases — Tasks

[← Back to index](junior.md)

Hands-on exercises that build muscle memory for using `context.Context` in real applications. Each task lists a goal, a starter signature, expected behavior, and hints. Solutions are sketched at the end. Solve in order — later tasks reuse skills from earlier.

## Task 1 — Echo Server With Per-Request Timeout

**Goal.** Build an HTTP server with a `/echo` endpoint that:

- Reads the request body.
- Calls a slow function `processBody(ctx, body)` (sleeps 800 ms).
- Writes the result.
- Aborts with 504 if the request takes longer than 500 ms.

```go
func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/echo", echoHandler)
    http.ListenAndServe(":8080", withTimeout(500*time.Millisecond, mux))
}
```

**Hint.** Use `http.TimeoutHandler` or write your own middleware that derives `WithTimeout(r.Context(), d)` and passes the new request via `r.WithContext(ctx)`.

---

## Task 2 — Outbound HTTP With Deadline

**Goal.** Implement `func FetchJSON(ctx context.Context, url string, out any) error` that:

- Builds a request with `http.NewRequestWithContext`.
- Decodes JSON into `out`.
- Returns any context error promptly.

```go
func FetchJSON(ctx context.Context, url string, out any) error
```

**Hint.** Use `http.DefaultClient.Do`. Defer `resp.Body.Close()`. JSON decode with `json.NewDecoder(resp.Body).Decode(out)`.

---

## Task 3 — DB Query With Cancellation

**Goal.** Write `func ListOrders(ctx context.Context, db *sql.DB, customerID int64) ([]Order, error)` that:

- Uses `db.QueryContext`.
- Iterates rows, calling `rows.Scan`.
- Returns immediately on `ctx.Err()`.

```go
type Order struct{ ID, CustomerID int64; Total float64 }
func ListOrders(ctx context.Context, db *sql.DB, customerID int64) ([]Order, error)
```

**Hint.** Inside the row iteration loop, periodically check `ctx.Err()` and return early. Always `defer rows.Close()`.

---

## Task 4 — Type-Safe Request ID Helper

**Goal.** Build a package `reqid` that exposes:

- `WithRequestID(ctx, id) context.Context`
- `RequestIDFrom(ctx) (string, bool)`
- An `http.Handler` middleware `Middleware(next) http.Handler` that reads/generates an ID and stores it in ctx.

**Hint.** Unexported empty-struct key. Generate IDs with `uuid.NewString()` if missing. Echo back via `X-Request-ID` response header.

---

## Task 5 — Logger In Context

**Goal.** Extend `reqid` with a logger:

- `WithLogger(ctx, *slog.Logger) context.Context`
- `LoggerFrom(ctx) *slog.Logger` — returns `slog.Default()` if absent.
- A middleware that, after RequestID, attaches a `slog.Logger` pre-tagged with `request_id`.

**Hint.** `base.With("request_id", id)` produces a derived logger. Wire `LoggerMiddleware` *after* `RequestIDMiddleware` so the ID is already present.

---

## Task 6 — Graceful Shutdown

**Goal.** Build a server that:

- Starts listening on `:8080`.
- On SIGINT/SIGTERM, calls `srv.Shutdown(ctx)` with a 20 s budget.
- Logs "drained N connections" before exiting.

```go
func main() { /* exits cleanly on Ctrl-C */ }
```

**Hint.** `signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)`. Run `srv.ListenAndServe` in a goroutine; main waits on the signal ctx.

---

## Task 7 — Idempotency Middleware

**Goal.** A middleware that:

- Requires `Idempotency-Key` header (returns 400 if missing).
- Stores the key in ctx via a typed setter.
- Calls the next handler.

```go
func IdempotencyMiddleware(next http.Handler) http.Handler
```

**Hint.** Empty-struct key, `WithIdempotencyKey`, getter `IdempotencyKeyFrom`. Validate length between 1 and 256 chars.

---

## Task 8 — Worker Pool With Context

**Goal.** Implement `RunPool(ctx, n, jobs, process)` that runs `n` workers consuming from `jobs` and writes results to `out`. Stops on ctx cancel.

```go
type Result struct{ Value any; Err error }
func RunPool[J any](ctx context.Context, n int, jobs <-chan J, process func(context.Context, J) (any, error)) <-chan Result
```

**Hint.** `errgroup` with `SetLimit(n)`. Each worker selects on `ctx.Done()` and `<-jobs`. Close `out` when all workers finish.

---

## Task 9 — Fan-Out Aggregator

**Goal.** Given a list of URLs, fetch all concurrently, return when *all* complete or the parent ctx fires. Each fetch capped at 1 s.

```go
func FanOutFetch(ctx context.Context, urls []string) []FetchResult
```

**Hint.** `errgroup.Group`; each goroutine derives `WithTimeout(ctx, 1*time.Second)`. Collect results in a slice protected by index, no mutex needed.

---

## Task 10 — Pipeline Three Stages

**Goal.** Three stages: `produce -> transform -> sink`. Each is a goroutine. Cancel propagates top-down. No goroutine leaks on cancel.

```go
func Run(ctx context.Context, in []int) <-chan string
```

**Hint.** Each stage closes its output channel on exit. Use `select` with `ctx.Done()` for both reads and writes.

---

## Task 11 — Hedged HTTP Requests

**Goal.** `Hedged(ctx, urls)` fires all requests in parallel, returns the first successful response, cancels the rest.

```go
func Hedged(ctx context.Context, urls []string) (string, error)
```

**Hint.** Inner `WithCancel(ctx)`; on first success, call cancel. Buffered result channel of size `len(urls)` so losers can write without blocking.

---

## Task 12 — Detached Background Job

**Goal.** Inside a handler, spawn an audit log write that survives the request:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    // ...
    spawnAudit(r.Context(), event)
    w.WriteHeader(200)
}
```

`spawnAudit` should preserve request-scoped values (request ID, user) but not be canceled when the handler returns.

**Hint.** `context.WithoutCancel(r.Context())` (Go 1.21+). Add a 10 s deadline for the background work itself.

---

## Task 13 — Cancel Either of Two Parents

**Goal.** Implement `WithEither(a, b)` that returns a ctx canceling on either parent's `Done`.

```go
func WithEither(a, b context.Context) (context.Context, context.CancelFunc)
```

**Hint.** Inner `WithCancel(a)`. Goroutine that selects on `a.Done()`, `b.Done()`, and a stop channel. The returned cancel both stops the goroutine and cancels the inner ctx.

---

## Task 14 — Per-Request Span With OpenTelemetry

**Goal.** A handler that:

- Starts a span named `handler.GetUser`.
- Calls a sub-function whose own span is automatically a child.
- Records errors to the span on failure.

**Hint.** `tracer.Start(ctx, "handler.GetUser")` returns a new ctx and a span. Pass the new ctx down. Defer `span.End()`. On error, `span.RecordError(err)`.

---

## Task 15 — Test With t.Context() (Go 1.24+)

**Goal.** Convert the following test to use `t.Context()`:

```go
func TestX(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    if err := DoWork(ctx); err != nil { t.Fatal(err) }
}
```

**Hint.** Replace with `ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)` and keep `defer cancel()`.

---

## Task 16 — Database Transaction With Context

**Goal.** Implement `RunTx(ctx, db, fn)` that runs `fn` inside a transaction. On error, rolls back. On `ctx` cancel mid-tx, rolls back and returns ctx error.

```go
func RunTx(ctx context.Context, db *sql.DB, fn func(*sql.Tx) error) error
```

**Hint.** `db.BeginTx(ctx, nil)`; defer rollback (rollback after commit is a no-op); on success, commit.

---

## Task 17 — Rate Limiter Honoring Context

**Goal.** Wrap a `*rate.Limiter` so `Wait(ctx)` returns immediately when ctx is canceled.

```go
func WaitN(ctx context.Context, lim *rate.Limiter, n int) error
```

**Hint.** `rate.Limiter.WaitN(ctx, n)` already supports ctx — but verify error propagation and write a test.

---

## Task 18 — gRPC Client With Deadline

**Goal.** A gRPC client call with a 1 s deadline:

```go
func (c *Client) GetUser(ctx context.Context, id int64) (*User, error)
```

Internally uses `WithTimeout` and a generated stub.

**Hint.** Wrap the stub in a method that derives the timeout, and make sure to defer `cancel()`.

---

## Task 19 — Middleware Chain Order

**Goal.** Build a chain `RequestID -> Logger -> Auth -> Handler` and verify (with a unit test) that the handler sees all three values in ctx.

**Hint.** Apply middlewares in *reverse* order so the outermost is applied last. Use `httptest.NewRequest` and assert via the typed getters.

---

## Task 20 — Stress: Verify No Leaks

**Goal.** Write a test that spawns 1000 cancellable workers, cancels the ctx, and uses `runtime.NumGoroutine()` to assert all exited.

**Hint.** `runtime.GC()` after cancel, then a brief sleep before sampling. Or use `goleak` package from Uber.

---

## Solutions (Sketches)

### Task 1
```go
func withTimeout(d time.Duration, h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx, cancel := context.WithTimeout(r.Context(), d)
        defer cancel()
        h.ServeHTTP(w, r.WithContext(ctx))
    })
}

func echoHandler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    out, err := processBody(r.Context(), body)
    if errors.Is(err, context.DeadlineExceeded) {
        http.Error(w, "timeout", http.StatusGatewayTimeout)
        return
    }
    if err != nil {
        http.Error(w, "error", http.StatusInternalServerError)
        return
    }
    w.Write(out)
}
```

### Task 2
```go
func FetchJSON(ctx context.Context, url string, out any) error {
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    if err != nil { return err }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return err }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK {
        return fmt.Errorf("status %d", resp.StatusCode)
    }
    return json.NewDecoder(resp.Body).Decode(out)
}
```

### Task 3
```go
func ListOrders(ctx context.Context, db *sql.DB, customerID int64) ([]Order, error) {
    rows, err := db.QueryContext(ctx, `SELECT id, customer_id, total FROM orders WHERE customer_id=$1`, customerID)
    if err != nil { return nil, err }
    defer rows.Close()
    var out []Order
    for rows.Next() {
        if err := ctx.Err(); err != nil { return nil, err }
        var o Order
        if err := rows.Scan(&o.ID, &o.CustomerID, &o.Total); err != nil {
            return nil, err
        }
        out = append(out, o)
    }
    return out, rows.Err()
}
```

### Task 4
```go
package reqid

type key struct{}

func With(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, key{}, id)
}
func From(ctx context.Context) (string, bool) {
    id, ok := ctx.Value(key{}).(string)
    return id, ok
}
func Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Request-ID")
        if id == "" { id = uuid.NewString() }
        w.Header().Set("X-Request-ID", id)
        next.ServeHTTP(w, r.WithContext(With(r.Context(), id)))
    })
}
```

### Task 6
```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()
    srv := &http.Server{Addr: ":8080", Handler: mux}
    go func() {
        if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            log.Fatal(err)
        }
    }()
    <-ctx.Done()
    sctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
    defer cancel()
    srv.Shutdown(sctx)
}
```

### Task 8
```go
func RunPool[J any](ctx context.Context, n int, jobs <-chan J, process func(context.Context, J) (any, error)) <-chan Result {
    out := make(chan Result)
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(n)
    for i := 0; i < n; i++ {
        g.Go(func() error {
            for {
                select {
                case <-gctx.Done():
                    return gctx.Err()
                case j, ok := <-jobs:
                    if !ok { return nil }
                    v, err := process(gctx, j)
                    select {
                    case <-gctx.Done():
                        return gctx.Err()
                    case out <- Result{Value: v, Err: err}:
                    }
                }
            }
        })
    }
    go func() { _ = g.Wait(); close(out) }()
    return out
}
```

### Task 11
```go
func Hedged(ctx context.Context, urls []string) (string, error) {
    inner, cancel := context.WithCancel(ctx)
    defer cancel()
    type res struct{ body string; err error }
    results := make(chan res, len(urls))
    for _, u := range urls {
        u := u
        go func() {
            req, _ := http.NewRequestWithContext(inner, http.MethodGet, u, nil)
            resp, err := http.DefaultClient.Do(req)
            if err != nil { results <- res{err: err}; return }
            defer resp.Body.Close()
            b, _ := io.ReadAll(resp.Body)
            results <- res{body: string(b)}
        }()
    }
    var lastErr error
    for i := 0; i < len(urls); i++ {
        r := <-results
        if r.err == nil { return r.body, nil }
        lastErr = r.err
    }
    return "", lastErr
}
```

### Task 13
```go
func WithEither(a, b context.Context) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancel(a)
    stop := make(chan struct{})
    go func() {
        select {
        case <-a.Done():
        case <-b.Done():
        case <-stop:
        }
        cancel()
    }()
    return ctx, func() { close(stop); cancel() }
}
```

### Task 16
```go
func RunTx(ctx context.Context, db *sql.DB, fn func(*sql.Tx) error) (err error) {
    tx, err := db.BeginTx(ctx, nil)
    if err != nil { return err }
    defer func() {
        if err != nil { _ = tx.Rollback() }
    }()
    if err = fn(tx); err != nil { return err }
    return tx.Commit()
}
```

---

Solve at least Tasks 1–10 to internalize the basic ctx flow. Tasks 11–20 deepen the toolbox: hedging, detached work, pipelines, and leak detection. Once you can produce these from a blank file, you have the practical command of context that production work demands.

[← Back to index](junior.md)
