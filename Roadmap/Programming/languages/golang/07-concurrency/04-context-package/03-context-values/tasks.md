# Context Values — Tasks

[← Back to index](junior.md)

Exercises to internalize the unexported-key idiom, the accessor pattern, middleware composition, and the discipline of choosing between context values and explicit parameters. Each task gives you a starting point, a clearly stated goal, and acceptance criteria. Solutions are sketched at the end of the file.

## Task 1 — First contact: request ID accessor

**Goal:** Create a `reqid` package with `With` and `From` functions, then use them in `main`.

**Starting point:**

```go
package main

import (
    "context"
    "fmt"
)

func main() {
    ctx := context.Background()
    // TODO: attach the request ID "req-1" using your reqid package.

    handle(ctx)
}

func handle(ctx context.Context) {
    // TODO: read the request ID and print it.
}
```

**Acceptance criteria:**

- A new package `reqid` with an unexported key type.
- A `reqid.With(ctx, id)` constructor.
- A `reqid.From(ctx) (string, bool)` accessor.
- `main` prints `request id: req-1`.

**Hint:** Use `type ctxKey struct{}` as the key type.

---

## Task 2 — Avoid the string-key trap

**Goal:** Take this broken code and refactor it to use a private key type. The bug is that two unrelated packages both use `"user"` as the key.

**Starting point:**

```go
package main

import (
    "context"
    "fmt"
)

func main() {
    ctx := context.Background()
    ctx = context.WithValue(ctx, "user", "alice")

    // Imagine this is a third-party library:
    ctx = libCall(ctx)

    v := ctx.Value("user")
    fmt.Println("got user:", v) // prints "alice"? or something else?
}

func libCall(ctx context.Context) context.Context {
    return context.WithValue(ctx, "user", 42) // library stamps its own "user"
}
```

**Acceptance criteria:**

- Replace the string keys with private types in two packages.
- Verify that the user is still "alice" after `libCall` returns.
- Run `staticcheck` and confirm SA1029 does not fire.

---

## Task 3 — User accessor with two read styles

**Goal:** Build an `authctx` package that exposes `WithUser`, `UserFromContext` (returns `User, bool`), and `MustUserFromContext` (panics on absence).

**Acceptance criteria:**

- All three functions defined.
- A unit test that exercises both `UserFromContext` and `MustUserFromContext`.
- `MustUserFromContext(context.Background())` panics with a clear message.
- `UserFromContext(context.Background())` returns `(User{}, false)` without panicking.

---

## Task 4 — Request ID middleware

**Goal:** Wrap an HTTP handler with middleware that attaches a request ID to the context. Honour `X-Request-ID` from the inbound header; generate a fresh hex ID if not present. Echo the ID back in the response headers.

**Starting point:**

```go
package main

import (
    "log"
    "net/http"
)

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", handler)
    // TODO: wrap mux with your reqid middleware
    log.Fatal(http.ListenAndServe(":8080", mux))
}

func handler(w http.ResponseWriter, r *http.Request) {
    // TODO: read the request ID from r.Context() and write it to the response body
}
```

**Acceptance criteria:**

- Requests without `X-Request-ID` receive a generated one.
- Requests with `X-Request-ID` keep that ID.
- The handler reads the ID from `r.Context()` and writes it.
- The response includes `X-Request-ID`.

---

## Task 5 — Context-aware logger

**Goal:** Build a `logctx` package wrapping `*slog.Logger`. Middleware should pre-fill the logger with request_id, method, and path. Handlers should use `logctx.From(ctx)` instead of `slog.Default()`.

**Acceptance criteria:**

- `logctx.With(ctx, l)` and `logctx.From(ctx)` defined.
- `From` always returns a non-nil logger; fallback is `slog.Default()`.
- A middleware function that uses `reqid.From` and pre-fills fields.
- A handler that calls `logctx.From(r.Context()).Info("hello")` and sees `request_id`, `method`, `path` in the structured output.

---

## Task 6 — When NOT to use context

**Goal:** Refactor the following code so the values that should be parameters are parameters, and only the values that should be context values stay there.

**Starting point:**

```go
// Bad: db, retryCount, isAdmin all in context.
ctx = context.WithValue(ctx, dbKey, db)
ctx = context.WithValue(ctx, retryKey, 0)
ctx = context.WithValue(ctx, adminKey, false)
ctx = context.WithValue(ctx, reqIDKey, "req-1")

result, err := doWork(ctx, item)
```

**Acceptance criteria:**

- `db` becomes a constructor argument on whatever object calls `doWork`.
- `retryCount` becomes a parameter to `doWork` (or a struct field on a retry-aware wrapper).
- `isAdmin` becomes a field on the `User` type, derived from authentication.
- `requestID` stays in context.

Document your reasoning.

---

## Task 7 — Composing middleware

**Goal:** Compose four middlewares in the correct order:

1. `withRecover` — catches panics.
2. `withRequestID` — attaches a request ID.
3. `withAuth` — verifies the bearer token and attaches a `User`.
4. `withLogger` — pre-fills a `*slog.Logger` with request_id, user_id, method, path.

**Acceptance criteria:**

- A function `Stack(handler http.Handler) http.Handler` that returns the wrapped handler.
- An integration test (using `httptest.Server`) that issues a request with a token and confirms the handler sees all four values.
- The test re-issues a request *without* a token and confirms it gets `401`.

---

## Task 8 — Tracing-style chain

**Goal:** Build a `tracectx` package modelled on OpenTelemetry. Define a `Span` interface with `End()` and `TraceID()`. Implement a simple `Tracer` whose `Start(ctx, name)` returns a child context and a new `Span`. The current span lives in the context.

**Acceptance criteria:**

- `tracectx.SpanFromContext(ctx)` returns the current span (or a no-op).
- `tracectx.Start(ctx, name)` returns `(context.Context, Span)`.
- A nested `Start` correctly returns a child span whose parent is the current one.
- A test that starts a span, then starts a nested span inside it, and verifies the parent-child relationship.

---

## Task 9 — Replace a service-in-context

**Goal:** This handler stores all dependencies in context. Refactor it to a struct with constructor injection.

**Starting point:**

```go
type Services struct {
    DB    *sql.DB
    Cache *redis.Client
    Log   *slog.Logger
}

func handler(w http.ResponseWriter, r *http.Request) {
    svc := r.Context().Value(servicesKey).(Services)
    rows, err := svc.DB.QueryContext(r.Context(), "SELECT ...")
    // ...
}
```

**Acceptance criteria:**

- A new `OrderHandler` struct with `db`, `cache`, `log` fields.
- A `NewOrderHandler(db, cache, log) *OrderHandler` constructor.
- A method `(*OrderHandler) ServeHTTP(w, r)`.
- The `Services` context value is removed entirely.
- All tests pass.

---

## Task 10 — Avoid mutation through context

**Goal:** Find the race in the following code and fix it without using context as a mutable store.

**Starting point:**

```go
type Counter struct {
    n int
}

func handler(w http.ResponseWriter, r *http.Request) {
    c := &Counter{}
    ctx := context.WithValue(r.Context(), counterKey, c)

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            cc := ctx.Value(counterKey).(*Counter)
            cc.n++
        }()
    }
    wg.Wait()
    fmt.Println("count:", c.n)
}
```

**Acceptance criteria:**

- The race detector (`go test -race`) is clean.
- The final count is exactly 100.
- The fix does not store a counter in context.

---

## Task 11 — Inspect context lifetime

**Goal:** Write a small program that attaches a `*BigBuffer` (10 MB) to a context, then launches a goroutine that holds onto the context for 5 seconds. Use `runtime.ReadMemStats` to observe how the buffer stays alive. Then refactor so the goroutine no longer holds the chain.

**Acceptance criteria:**

- Original version: 10 MB visible in `HeapAlloc` for 5 seconds.
- Fixed version: 10 MB is reclaimable as soon as `main` returns from the request scope.
- Use `context.WithoutCancel` and *also* drop the large value (or do not put it in context at all).

---

## Task 12 — Test with `t.Context()`

**Goal:** Using Go 1.24+, write a test that uses `t.Context()` to construct a chain with a user and a request ID, then exercises a handler.

**Acceptance criteria:**

- Test uses `t.Context()`, not `context.Background()`.
- Test attaches both values via accessors, not direct `context.WithValue`.
- Test verifies that the handler reads both correctly.
- Test passes with `go test -run TestHandler`.

---

## Task 13 — Detect collision before it bites you

**Goal:** Set up a small project with two packages, each defining `type ctxKey string` (note: a *named string type*, not unexported). Demonstrate that values still cross because the underlying type is comparable. Then change both packages to use `type ctxKey struct{}` and demonstrate isolation.

**Acceptance criteria:**

- Two test cases: one showing collision (with named string types if values happen to match) and one showing isolation (with empty struct types).
- A note explaining why empty struct types are safer than named string types.

---

## Task 14 — Hide the assertion

**Goal:** Refactor a codebase where every handler does `r.Context().Value(key).(*User)` into one that uses a single accessor. Count the number of removed lines.

**Acceptance criteria:**

- One central `From` function.
- Every call site now calls `From(ctx)`.
- No remaining `.(*User)` or `.(string)` type assertions on context values outside the accessor package.

---

## Task 15 — Worker pool with per-job context value

**Goal:** Build a worker pool where each job has a unique `job_id`. Each worker pulls the `job_id` from its own context. Many workers run in parallel, each with its own derived context, sharing a parent context.

**Acceptance criteria:**

- A single parent context with a shared request ID.
- For each job, derive a child context with `jobctx.With(parent, jobID)`.
- Worker logs include both `request_id` and `job_id`.
- A test verifies that workers do not see each other's job IDs.

---

## Task 16 — Benchmark lookup cost

**Goal:** Write a benchmark that measures `ctx.Value(key)` at chain depths of 1, 5, 10, 25, and 50.

**Acceptance criteria:**

- `go test -bench=BenchmarkValueDepth` reports five numbers.
- A short README explaining the result and at what depth performance noticeably degrades.
- Bonus: also benchmark a "miss" — a key that is not in the chain at all.

**Hint:** Use `b.ResetTimer()` after building the chain.

---

## Task 17 — `WithoutCancel` for background work

**Goal:** Build a handler that returns an immediate `202 Accepted` and continues some work in a background goroutine. The background work should keep the request ID and user but not be canceled when the request ends.

**Acceptance criteria:**

- The handler returns within 1 ms.
- The background goroutine logs with the original request ID for 5 seconds afterward.
- Killing the connection mid-response does not stop the background work.
- Use `context.WithoutCancel`.

---

## Task 18 — Audit a code base for anti-patterns

**Goal:** Take an existing open-source Go service (your choice — `kubernetes`, `prometheus`, `cockroachdb`, or any other large codebase) and grep for `context.WithValue`. Categorize each call by whether it stores request-scoped metadata or something else. Write a short report.

**Acceptance criteria:**

- A grep command that found all `WithValue` calls.
- A spreadsheet or markdown table with: file, line, key name, what is stored, your verdict (request-scoped / parameter / DI / mutable).
- A summary paragraph identifying patterns.

---

## Task 19 — Custom slog.Handler that pulls from context

**Goal:** Build a `*slog.Handler` wrapper that automatically adds `request_id`, `user_id`, and `trace_id` from the context to every log record.

**Acceptance criteria:**

- A handler type that implements `slog.Handler`.
- `Handle(ctx, r)` reads from your accessors and appends attrs.
- A test that uses `slog.New(ctxHandler{base})` and confirms the attrs appear in output.
- Falls back gracefully when values are absent.

---

## Task 20 — Migration: from globals to context

**Goal:** Refactor a small CLI app that uses `var globalRequestID string` (and a `sync.Mutex`) to use context values throughout.

**Acceptance criteria:**

- Remove the global and the mutex.
- Replace with a `reqid` package.
- All goroutines that previously read `globalRequestID` now take a context.
- Tests confirm two concurrent runs do not interfere.

---

## Solution Sketches

### Task 1

```go
package reqid

import "context"

type ctxKey struct{}
var key = ctxKey{}

func With(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, key, id)
}

func From(ctx context.Context) (string, bool) {
    id, ok := ctx.Value(key).(string)
    return id, ok
}
```

```go
ctx = reqid.With(ctx, "req-1")
id, _ := reqid.From(ctx)
fmt.Println("request id:", id)
```

### Task 2

Replace `"user"` in `main` with a `mainpkg.userKey` private struct type. Replace `"user"` in the library with a `libpkg.userKey` private struct type. Now the two writes go to different slots. `main` reads its own slot and sees `"alice"` unchanged.

### Task 3

```go
func MustUserFromContext(ctx context.Context) User {
    u, ok := UserFromContext(ctx)
    if !ok {
        panic("authctx: no user in context")
    }
    return u
}
```

### Task 4

```go
func Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Request-ID")
        if id == "" {
            id = newID()
        }
        w.Header().Set("X-Request-ID", id)
        ctx := reqid.With(r.Context(), id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

### Task 6

```go
type WorkerService struct {
    db  *sql.DB
    log *slog.Logger
}

func (s *WorkerService) DoWork(ctx context.Context, item Item, retryCount int) (Result, error) {
    user, _ := authctx.From(ctx)
    if !user.IsAdmin {
        return Result{}, ErrForbidden
    }
    // ...
}
```

`db` moved to a constructor. `retryCount` moved to a parameter. `isAdmin` derived from the `User`. Only `requestID` remains in context.

### Task 7

```go
func Stack(h http.Handler) http.Handler {
    return withRecover(
        reqid.Middleware(
            authctx.Middleware(verify)(
                logctx.Middleware(slog.Default())(
                    h))))
}
```

### Task 10

```go
func handler(w http.ResponseWriter, r *http.Request) {
    var counter atomic.Int64
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter.Add(1)
        }()
    }
    wg.Wait()
    fmt.Println("count:", counter.Load())
}
```

No context value. Local variable captured by the closure. Synchronized via `atomic.Int64`. Race-clean and clearer.

### Task 16

```go
func BenchmarkValueDepth(b *testing.B) {
    type k int
    var key k = 0

    for _, depth := range []int{1, 5, 10, 25, 50} {
        b.Run(fmt.Sprintf("depth=%d", depth), func(b *testing.B) {
            ctx := context.Background()
            ctx = context.WithValue(ctx, key, "v")
            for i := 1; i < depth; i++ {
                ctx = context.WithValue(ctx, k(i), "v")
            }
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                _ = ctx.Value(key)
            }
        })
    }
}
```

### Task 17

```go
func handler(w http.ResponseWriter, r *http.Request) {
    bg := context.WithoutCancel(r.Context())
    go func() {
        log := logctx.From(bg)
        for i := 0; i < 5; i++ {
            log.Info("background tick", "i", i)
            time.Sleep(time.Second)
        }
    }()
    w.WriteHeader(http.StatusAccepted)
}
```

The background goroutine retains the request's log fields but is not canceled when the connection closes.
