# Common Usecases — Junior

[← Back to index](junior.md)

## What This Page Is About

The previous section taught you the *mechanics* of `context.Context`: how to create one with `WithCancel` or `WithTimeout`, how `Done` and `Err` work, why every `cancel` must be deferred. This section is about the *applications* — the concrete places in real Go programs where contexts show up. Almost every meaningful Go service threads a context through every layer:

```
HTTP request comes in
        │
        ▼
  r.Context()        ◄── handler receives ctx with request lifetime
        │
        ▼
  service.Charge(ctx, ...)
        │
        ▼
  db.QueryContext(ctx, ...)   ◄── DB driver respects deadline
  http.NewRequestWithContext(ctx, ...) ◄── outbound HTTP cancels too
```

After reading this page you should be able to:

- Pull a context out of an HTTP request and pass it down.
- Send a context with an outbound HTTP call.
- Use `db.QueryContext`, `db.ExecContext`, and `db.PingContext`.
- Read your first `context.WithValue` and understand when it is appropriate.
- Recognize `context.TODO()` as a "wire this up later" marker.

We will build small but realistic snippets — nothing toy. By the end you will have walked through every line of a tiny HTTP server that does a DB lookup, both with and without context, so you can see what changes.

## The First Place Junior Devs Meet Context: HTTP Handlers

Every `*http.Request` in Go carries a `context.Context`. You retrieve it with `r.Context()`. Its lifetime is exactly the lifetime of the request: when the client disconnects, when the server times out, or when the handler returns, the context is canceled.

```go
func handleUser(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    user, err := loadUser(ctx, r.PathValue("id"))
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    json.NewEncoder(w).Encode(user)
}
```

Two things to notice:

1. We never construct a new context. The HTTP server already gave us one.
2. We pass that context down to `loadUser`, which will pass it further to the DB layer.

If you forget step 2 — if `loadUser` does its own thing and ignores the context — the request becomes uncancellable. The client can hang up, the deadline can pass, but `loadUser` keeps running because nobody told it to stop.

```go
// BAD: ignores the request's lifetime.
func loadUser(_ context.Context, id string) (*User, error) {
    return db.QueryRowContext(context.Background(), "...", id).Err()  // detached!
}

// GOOD: propagates the request's ctx.
func loadUser(ctx context.Context, id string) (*User, error) {
    return db.QueryRowContext(ctx, "...", id).Err()
}
```

The rule is simple and worth memorizing: **whatever context you receive, that is the context you pass down**. Never substitute `Background()` or `TODO()` mid-stream.

### What does the request context's cancellation actually mean?

Three things can close `r.Context().Done()`:

| Trigger | Description |
|---------|-------------|
| Client disconnects | The TCP connection closes (browser tab closed, network broke). |
| Server is shutting down | `srv.Shutdown(ctx)` was called and the server is draining. |
| Handler returns | Once the handler exits, its context is canceled to release any goroutines it spawned that captured `r.Context()`. |

The third is subtle: any goroutine you spawn from a handler that *captures* `r.Context()` must finish before the handler returns, otherwise it sees a closed `Done()` channel as soon as the handler exits.

```go
// SUBTLE: this goroutine sees ctx.Done() immediately when the handler returns.
func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        sendMetric(r.Context(), "page_view")  // ctx canceled the moment handler exits
    }()
    w.Write([]byte("ok"))
}
```

If you need a goroutine to outlive the handler (background work that should keep going after the response), use `context.WithoutCancel(r.Context())` (Go 1.21+) or pass `context.Background()` explicitly. We cover that in the senior section.

## Outbound HTTP Calls: `req.WithContext`

When your service calls another service, you want *that* call to honour the same deadline and cancellation. `http.NewRequestWithContext` is the modern way:

```go
func fetchProfile(ctx context.Context, id string) (*Profile, error) {
    url := fmt.Sprintf("https://api.example.com/profiles/%s", id)
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    if err != nil {
        return nil, err
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    var p Profile
    return &p, json.NewDecoder(resp.Body).Decode(&p)
}
```

If `ctx` is canceled while the HTTP client is dialing, sending headers, or reading the body, the call returns immediately with an error wrapping `context.Canceled` or `context.DeadlineExceeded`.

You may still see older code using `req.WithContext(ctx)`:

```go
req, _ := http.NewRequest(http.MethodGet, url, nil)
req = req.WithContext(ctx)  // older idiom, still valid
```

`http.NewRequestWithContext` was added in Go 1.13 and is the form to prefer in new code.

### What if I forget to pass the context?

You will not get a compile error. The request will simply ignore your deadline and run as long as the underlying TCP connection allows. Your service's deadlines silently leak, and you only discover it during an outage when calls pile up because the upstream is slow.

```go
// BAD
req, _ := http.NewRequest(http.MethodGet, url, nil)  // no context!
resp, _ := http.DefaultClient.Do(req)

// GOOD
req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
resp, _ := http.DefaultClient.Do(req)
```

A useful linter rule: search your codebase for `http.NewRequest(` (the non-context form) and replace each one. If you really mean "no context," pass `context.Background()` explicitly so the choice is visible.

## Database Calls: The Context-Aware Methods

Go's `database/sql` package added context-aware methods in Go 1.8. Every operation has a `Context` variant:

| Without context | With context |
|-----------------|--------------|
| `db.Query(...)` | `db.QueryContext(ctx, ...)` |
| `db.QueryRow(...)` | `db.QueryRowContext(ctx, ...)` |
| `db.Exec(...)` | `db.ExecContext(ctx, ...)` |
| `db.Ping()` | `db.PingContext(ctx)` |
| `db.Begin()` | `db.BeginTx(ctx, opts)` |
| `tx.Commit()` | (no context variant — commits inherit the tx's ctx) |
| `tx.Query(...)` | `tx.QueryContext(ctx, ...)` |

**Always use the `Context` variants in production code.** The non-context forms call the context forms internally with `context.Background()`, which means your queries cannot be canceled. A misbehaving query can keep a connection busy for the full driver-level statement timeout — typically 30 seconds or more.

A typical handler:

```go
func loadOrder(ctx context.Context, db *sql.DB, id int64) (*Order, error) {
    const q = `SELECT id, customer_id, total FROM orders WHERE id = $1`
    var o Order
    err := db.QueryRowContext(ctx, q, id).Scan(&o.ID, &o.CustomerID, &o.Total)
    if err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, ErrOrderNotFound
        }
        return nil, fmt.Errorf("load order: %w", err)
    }
    return &o, nil
}
```

If the request's context expires while the query is running, the driver sends a cancel signal to the database (e.g. `pg_cancel_backend` for Postgres), the query is killed, and `Scan` returns an error wrapping `context.DeadlineExceeded`. Both your goroutine and the database row are released.

### A complete tiny example: HTTP + DB

```go
package main

import (
    "context"
    "database/sql"
    "encoding/json"
    "errors"
    "fmt"
    "log"
    "net/http"

    _ "github.com/lib/pq"
)

type Order struct {
    ID         int64   `json:"id"`
    CustomerID int64   `json:"customer_id"`
    Total      float64 `json:"total"`
}

var (
    db                *sql.DB
    ErrOrderNotFound  = errors.New("order not found")
)

func loadOrder(ctx context.Context, id int64) (*Order, error) {
    const q = `SELECT id, customer_id, total FROM orders WHERE id = $1`
    var o Order
    err := db.QueryRowContext(ctx, q, id).Scan(&o.ID, &o.CustomerID, &o.Total)
    if err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, ErrOrderNotFound
        }
        return nil, fmt.Errorf("load order: %w", err)
    }
    return &o, nil
}

func handleOrder(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    var id int64
    if _, err := fmt.Sscanf(r.PathValue("id"), "%d", &id); err != nil {
        http.Error(w, "bad id", http.StatusBadRequest)
        return
    }
    order, err := loadOrder(ctx, id)
    switch {
    case errors.Is(err, ErrOrderNotFound):
        http.Error(w, "not found", http.StatusNotFound)
        return
    case err != nil:
        http.Error(w, "server error", http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(order)
}

func main() {
    var err error
    db, err = sql.Open("postgres", "postgres://localhost/shop?sslmode=disable")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    mux := http.NewServeMux()
    mux.HandleFunc("GET /orders/{id}", handleOrder)
    log.Println("listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```

Read it carefully. Notice that `ctx` originates at `r.Context()`, flows into `loadOrder`, and arrives at `db.QueryRowContext`. There is no `Background()` anywhere except potentially in `main`. That is the shape of a healthy Go program.

## Setting a Per-Call Timeout

Sometimes the request's overall deadline is too generous for a particular sub-operation. A 5-second user request might want to cap an external API call at 800 ms so it can fall back to a cache. You derive a *child* context with `WithTimeout`:

```go
func enrichOrder(ctx context.Context, o *Order) {
    childCtx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
    defer cancel()

    rec, err := recommender.Suggest(childCtx, o.CustomerID)
    if err != nil {
        log.Printf("recommender failed, falling back: %v", err)
        rec = fallbackSuggestion(o)
    }
    o.Recommendation = rec
}
```

Important: the child's deadline is the **earlier** of `ctx`'s deadline and `now+800ms`. You cannot extend a parent's deadline downward — only tighten it.

## Reading Values From Context: `ctx.Value`

Some pieces of data are *request-scoped*: a trace ID, an authenticated user, a logger pre-tagged with the request ID. They are inherently tied to the request, not to any one function. Passing them as parameters to every function would be tedious and would couple every layer to every value.

`context.WithValue` lets a parent stash a value, and any descendant can retrieve it.

```go
type traceIDKey struct{}

func WithTraceID(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, traceIDKey{}, id)
}

func TraceIDFrom(ctx context.Context) (string, bool) {
    id, ok := ctx.Value(traceIDKey{}).(string)
    return id, ok
}
```

Three points worth memorizing now:

1. **Use an unexported struct key**, never a string. `string` keys collide silently with values from other packages; an unexported struct type cannot collide with anything.
2. **Provide getter and setter helpers** in the same package as the key. Callers should never need to know about `traceIDKey{}` directly.
3. **Type-assert in the getter** and return `(value, ok)` so callers can handle the absent case without a panic.

Usage in middleware (covered properly in the middle file):

```go
func TraceIDMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Trace-ID")
        if id == "" {
            id = newRandomID()
        }
        ctx := WithTraceID(r.Context(), id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

Now any handler downstream can call `TraceIDFrom(r.Context())` and get the ID without it being an explicit parameter.

### When NOT to use `WithValue`

Junior devs often discover `WithValue` and start putting *everything* into context — config flags, database handles, feature toggles. Resist. The Go standard library is explicit: `WithValue` is for values that "transit processes and APIs," not for ordinary function arguments. Some heuristics:

| Belongs in context | Does NOT belong in context |
|--------------------|----------------------------|
| Trace / request / correlation IDs | Database handles |
| Authenticated principal (user, tenant) | HTTP clients |
| Per-request logger | Configuration values |
| Span / observability handles | Feature flags |
| Deadline-derived cancellation token | Anything required to function (must be a parameter) |

If the function fundamentally cannot run without value `X`, `X` should be a parameter (or struct field), not hidden in `ctx.Value`. Context values are *request-scoped metadata*, not dependency injection.

## `context.TODO()`: The Honest Placeholder

When you are mid-refactor and a function does not yet receive a context, you have three choices:

1. Drop in `context.Background()` — but this lies; it implies "no context applies," which is rarely true.
2. Drop in `context.TODO()` — explicitly marks "this needs a real context later."
3. Refactor first, threading a parameter through.

Option 2 is the polite choice. Linters and reviewers can grep for `context.TODO(` and find every spot you intended to revisit.

```go
// During migration: caller doesn't have a context yet.
result, err := svc.LoadProfile(context.TODO(), userID)
```

Once the caller is plumbed, replace `TODO()` with the real ctx. Production code should not contain `TODO()` long-term.

## A Quick Mental Model

Picture a request as a tree of function calls. The root holds the `Context`. Every branch — every function call that takes `ctx` — *must* receive that ctx and pass it on. If any branch detaches (uses `Background()`, stores ctx in a field, swallows it with `_ = ctx`), that subtree becomes uncancellable.

```
            r.Context()
                │
       ┌────────┴────────┐
       ▼                 ▼
   loadOrder(ctx)     logAccess(ctx)
       │                 │
       ▼                 ▼
   db.QueryContext     metrics.Inc(ctx)
```

A healthy ctx tree has no broken branches. Most Go bugs in production related to "the service hangs under load" are broken branches.

## A Few Standard-Library Functions That Take Context

To build intuition, here are common stdlib calls that accept a context. You will use most of these in the first six months:

| Function | What it does |
|----------|--------------|
| `http.NewRequestWithContext(ctx, ...)` | Outbound HTTP call cancels on `ctx.Done()`. |
| `db.QueryContext(ctx, ...)` | DB query cancellable. |
| `db.QueryRowContext(ctx, ...)` | Single-row variant. |
| `db.ExecContext(ctx, ...)` | INSERT/UPDATE/DELETE. |
| `db.BeginTx(ctx, opts)` | Open a transaction; the tx is canceled when ctx is. |
| `db.PingContext(ctx)` | Health check with a deadline. |
| `net.Dialer{}.DialContext(ctx, ...)` | TCP/UDP dial respecting deadline. |
| `os/exec.CommandContext(ctx, ...)` | Spawned process is killed on ctx cancel. |
| `signal.NotifyContext(parent, ...)` | Cancels parent on SIGINT/SIGTERM (Go 1.16+). |

Each of these takes ctx as the **first parameter** — that is the convention.

## Tests Should Have Deadlines Too

Even a unit test should not hang forever if the system under test has a bug. Use `context.WithTimeout` to bound the operation:

```go
func TestLoadOrder(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    o, err := loadOrder(ctx, 42)
    if err != nil {
        t.Fatal(err)
    }
    if o.ID != 42 {
        t.Fatalf("got %d, want 42", o.ID)
    }
}
```

If `loadOrder` deadlocks, the test fails after 2 seconds instead of timing out the whole test binary at the default 10-minute mark. Go 1.24 introduced `t.Context()`, which gives you a context that is automatically canceled when the test finishes. We discuss it in the middle file.

## Checklist: Are You Doing It Right?

Before you ship a handler, walk through this checklist:

- [ ] Every function that does I/O takes `ctx context.Context` as its first parameter.
- [ ] Every outbound HTTP call uses `http.NewRequestWithContext`.
- [ ] Every DB call uses the `Context` variant (`QueryContext`, `ExecContext`, etc).
- [ ] No `context.Background()` or `context.TODO()` appears inside a handler.
- [ ] No `context.Context` is stored in a struct field (other than rare exceptions like long-running services).
- [ ] No goroutine spawned from a handler captures `r.Context()` without selecting on `ctx.Done()`.
- [ ] Tests bound their setup with `context.WithTimeout`.
- [ ] `WithValue` is used sparingly and with unexported struct keys.

Internalize these and you have already cleared the bar for senior-readable Go.

## Common Mistakes Seen in Code Review

These come up over and over in PRs:

1. **`db.Query("...")` without context.** Code compiles, runs, and silently ignores deadlines.
2. **`http.Get(url)`** anywhere other than test fixtures. `http.Get` uses `http.DefaultClient` with no context — write `http.NewRequestWithContext` instead.
3. **String key for `WithValue`.** `ctx.Value("user_id")` works locally but collides with another package's `"user_id"` key on a long enough timeline.
4. **`context.Background()` inside a handler.** A red flag: ask why the request's context isn't being used.
5. **Forgetting `defer cancel()`.** Caught by `go vet`, but only if you run it. Many CI pipelines do.
6. **Storing ctx in a struct.** Tempting (saves a parameter!), but every method now uses the same ctx no matter who called it.
7. **Goroutines that capture `r.Context()` and outlive the handler.** They die instantly when the handler returns.

## What's Next

You can now write a handler that respects deadlines. The middle file levels up: graceful shutdown via `srv.Shutdown`, middleware that decorates context with values, type-safe key patterns at production scale, and integration with `t.Context()` from Go 1.24.

```go
// You'll write code like this next:
srv := &http.Server{Addr: ":8080", Handler: mux}
go srv.ListenAndServe()

shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(shutdownCtx)  // graceful drain
```

Move on when you can write the order example above from memory, including the type-safe `WithTraceID` helper.

## Cheat Sheet

```go
// 1. Get the request's context.
ctx := r.Context()

// 2. Outbound HTTP call.
req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
resp, err := http.DefaultClient.Do(req)

// 3. Database query.
err := db.QueryRowContext(ctx, q, id).Scan(&out)

// 4. Sub-deadline.
sub, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
defer cancel()

// 5. Stash and read a value.
type userIDKey struct{}
func WithUserID(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, userIDKey{}, id)
}
func UserIDFrom(ctx context.Context) (string, bool) {
    id, ok := ctx.Value(userIDKey{}).(string)
    return id, ok
}

// 6. Test with deadline.
ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()
```

Memorize the shape. Everything else builds on it.

## A Walkthrough: Tracing a Single Request End-To-End

Let's trace the journey of a single HTTP request through a complete service to make every concept above tangible. The request is `GET /orders/42` to a service that reads an order from Postgres and enriches it with a profile from an upstream service.

### Step 1 — The HTTP server creates a context

When the server accepts the TCP connection and parses the request, `net/http` calls `http.Request.WithContext` internally with a fresh `cancelCtx`. That ctx's `Done()` will close when the connection closes or the handler returns. As far as the handler can tell, this is the root.

### Step 2 — Middleware adds request ID and logger

```go
handler = LoggerMiddleware(slog.Default())(handler)
handler = RequestIDMiddleware(handler)
```

When the request enters `RequestIDMiddleware`, ctx is decorated:

```
r.Context() (server)
   └── value: requestID = "abc-123"
```

`LoggerMiddleware` then derives further:

```
r.Context() (server)
   └── value: requestID = "abc-123"
       └── value: logger = (logger pre-tagged with request_id="abc-123")
```

By the time the handler runs, two values live in ctx.

### Step 3 — Handler reads ctx and starts work

```go
func handleOrder(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    log := LoggerFrom(ctx)
    log.Info("handling order")
    // ...
}
```

`LoggerFrom(ctx)` walks the chain, finds the logger added by middleware, and returns it. The log line carries `request_id="abc-123"` automatically.

### Step 4 — Sub-deadline for the DB call

Suppose the request has a 5 s overall deadline (from a load balancer timeout). The handler caps the DB call at 1 s:

```go
dbCtx, cancel := context.WithTimeout(ctx, 1*time.Second)
defer cancel()
order, err := loadOrder(dbCtx, id)
```

The chain inside `dbCtx` is now:

```
server ctx   (deadline: now + 5s, value: requestID, logger)
   └── timer ctx   (deadline: now + 1s, inherits values)
```

`loadOrder` calls `db.QueryRowContext(dbCtx, ...)`. The DB driver's read loop selects on `dbCtx.Done()`. If the query takes more than 1 s, the driver sends a cancellation to Postgres and returns an error wrapping `context.DeadlineExceeded`.

### Step 5 — Outbound HTTP for enrichment

After the DB returns, the handler calls an upstream profile service:

```go
profCtx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
defer cancel()
req, _ := http.NewRequestWithContext(profCtx, http.MethodGet, profURL, nil)
resp, err := http.DefaultClient.Do(req)
```

`profCtx` is a sibling of `dbCtx`, both children of `ctx`. The outbound request honors `profCtx.Done()` — if the deadline fires while the HTTP client is reading the response body, the client returns an error. `defer cancel()` releases the timer when the call returns.

### Step 6 — Response written

```go
json.NewEncoder(w).Encode(order)
```

The response is written. The handler returns. The HTTP server cancels `r.Context()`. Any goroutine that captured `r.Context()` and was still reading from `Done()` now exits.

### What you've just seen

That single request involved:

- One ctx from the HTTP server.
- Two middleware-added values.
- Two derived sub-contexts for sub-deadlines.
- Three context-aware stdlib calls (`db.QueryRowContext`, `http.NewRequestWithContext`, `http.DefaultClient.Do`).
- Implicit cancellation of all sub-contexts when the handler returned.

That is the entire story of context for 90 % of the code you will write at junior level. The patterns repeat — you decorate, you derive, you propagate, you defer cancel.

## A Glossary For Quick Reference

| Term | Meaning |
|------|---------|
| Root context | `context.Background()` or `context.TODO()`; only used at program entry, in tests, or as a placeholder. |
| Derived context | The result of `WithCancel`, `WithTimeout`, `WithDeadline`, `WithValue`, `WithCancelCause`, `WithoutCancel`. |
| Context tree | The conceptual structure formed by parent-child relationships among derived contexts. |
| Cancellation | The closing of `ctx.Done()` and the setting of `ctx.Err()`. |
| Deadline | An absolute time after which the context is cancelled. Always retrievable via `ctx.Deadline()`. |
| Timeout | A relative duration, equivalent to `time.Now().Add(d)` as a deadline. |
| Cancel function | The function returned by cancellation-introducing constructors. Idempotent and safe to call from any goroutine. |
| Request-scoped value | Data stored via `WithValue` that flows with the request: trace ID, user, logger. |
| Context-aware API | Any function whose first parameter is `ctx context.Context` and which honors cancellation. |
| Context propagation | Forwarding a context across function calls, goroutines, and (with serialization) across processes. |

## Common Patterns You'll See This Week

These six snippets cover most of the ctx code a junior writes in their first sprints:

```go
// 1. Get and propagate.
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    if err := doWork(ctx); err != nil { /* ... */ }
}

// 2. DB query.
func loadX(ctx context.Context, id int64) (*X, error) {
    return scanX(db.QueryRowContext(ctx, "SELECT ... WHERE id=$1", id))
}

// 3. Outbound HTTP.
func fetchY(ctx context.Context, url string) (*Y, error) {
    req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    return decode(http.DefaultClient.Do(req))
}

// 4. Sub-deadline.
sub, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
defer cancel()
return external.Call(sub, ...)

// 5. Read a value (with safe getter).
log := LoggerFrom(ctx)
log.Info("hi")

// 6. Test with bound.
func TestZ(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    // ...
}
```

If these six become reflexive, you have absorbed the basics. Move on to the middle file.

## A Final Word On Discipline

`context.Context` is not magical. It is an interface. The reason it works is that *everyone* in the Go ecosystem agrees to follow the same conventions: ctx as first parameter, `Context` variants of stdlib calls, defer cancel, no string keys, no struct fields.

The day you decide "this one time it's fine to skip ctx" is the day a future on-call engineer spends three hours diagnosing a hung request. The discipline is small; the payoff is enormous.

Welcome to context-aware Go. The middle file is where the patterns become production-grade.

[← Back to index](junior.md)
