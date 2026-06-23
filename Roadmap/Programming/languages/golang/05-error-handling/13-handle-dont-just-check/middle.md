# Handle, Don't Just Check — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Six Decisions, Revisited](#the-six-decisions-revisited)
3. [The "Decide or Surface" Question, At Every Layer](#the-decide-or-surface-question-at-every-layer)
4. [Retry Mechanics: Backoff, Jitter, Idempotency](#retry-mechanics-backoff-jitter-idempotency)
5. [Transforming at API Boundaries](#transforming-at-api-boundaries)
6. [The Log-or-Return Rule, In Detail](#the-log-or-return-rule-in-detail)
7. [Recovery Strategies: Fallback, Cache, Degraded Mode](#recovery-strategies-fallback-cache-degraded-mode)
8. [The errWriter Pattern and Errors as State](#the-errwriter-pattern-and-errors-as-state)
9. [Errors Across Goroutines](#errors-across-goroutines)
10. [Errors and Context Cancellation](#errors-and-context-cancellation)
11. [Sentinel + Custom Error Type Patterns](#sentinel-custom-error-type-patterns)
12. [Anti-Patterns That Look Like Handling](#anti-patterns-that-look-like-handling)
13. [Code Review Heuristics](#code-review-heuristics)
14. [Worked Example: Order Processor](#worked-example-order-processor)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "Why?" and "When?"

At junior level you learned the decision menu and the "happy path stays straight" idiom. Middle level is where those rules meet a real codebase: a service with five layers, three external dependencies, two goroutine pools, and a public HTTP API. The question shifts from *"what do I do at one error site?"* to *"who in this five-layer chain is responsible for which decision, and where do the rules change?"*

This file is the answer set: **how to assign responsibility for errors layer by layer, when to retry vs. when to give up, how to translate at boundaries, and how to write recovery patterns that do not silently leak failures.**

---

## The Six Decisions, Revisited

A reminder of the menu, with middle-level commentary:

| Decision | Details |
|----------|---------|
| **Recover** | Returns a fallback. Good for cache misses, missing config files with defaults, optional features. Be explicit: a comment `// missing file is OK; use defaults` makes intent visible. |
| **Retry** | Only for *idempotent* ops on *transient* errors. Both conditions matter; a retry on a non-idempotent op is a bug, not a fix. |
| **Transform** | Re-express the error in the *next* layer's language. Storage error → domain error. Domain error → HTTP status. Each translation simplifies for the next reader. |
| **Surface** | `return err` — the laziest correct answer. Always pair with a wrap that adds *new* context, not just the same word. |
| **Log** | Owns the error: nothing else needs to know. Used at boundaries (handler), or in fire-and-forget code paths. |
| **Abort** | `panic` — for invariants that must hold or programmer errors. Never for ordinary failure. |

A *handler* is any function that picks one of these explicitly. A *checker* is one that always picks "Surface" without thinking.

---

## The "Decide or Surface" Question, At Every Layer

A typical Go service has roughly four layers:

```
  ┌──────────────────┐
  │  Transport       │  HTTP/gRPC handlers
  ├──────────────────┤
  │  Application     │  Use cases, command handlers
  ├──────────────────┤
  │  Domain          │  Business rules
  ├──────────────────┤
  │  Infrastructure  │  DB, queue, external API
  └──────────────────┘
```

Each layer has different *information* and different *responsibility*. The handling decision changes with the layer:

| Layer | Knows | Best decision for most errors |
|-------|-------|-------------------------------|
| Infrastructure | The driver/protocol error | Retry transient (idempotent ops); transform driver error to a sentinel; surface the rest |
| Domain | Business invariants, sentinels | Surface to caller; do not log; do not retry (no protocol info) |
| Application | Use case context, transactional intent | Map sentinels to domain results; choose retry policy at the use-case level |
| Transport | Request, user identity, response format | Translate sentinels → status codes; log once; never panic |

A common smell: **the wrong layer making the decision.** A storage adapter that retries non-idempotent calls. A domain service that logs. An HTTP handler that swallows. Watch for these in code review.

---

## Retry Mechanics: Backoff, Jitter, Idempotency

A retry is the most "interesting" handling decision because it is the most often misused. Three rules:

1. **Idempotency is mandatory.** GET, PUT, DELETE on a known ID — fine. POST that creates a new resource — usually not. Wrap non-idempotent ops in an idempotency key, or do not retry.

2. **Backoff is mandatory.** A tight retry loop on a downed downstream service is a *self-inflicted DDoS*. Standard pattern is exponential backoff with jitter: each retry waits longer, plus a random component to break thundering herds.

3. **A budget is mandatory.** Retry forever and the caller's request times out anyway, but with a longer trace. Cap attempts; cap total time; honour the parent context's deadline.

A correct retry helper:

```go
func Retry(ctx context.Context, attempts int, base time.Duration,
    op func(context.Context) error, retryable func(error) bool) error {

    var err error
    for i := 0; i < attempts; i++ {
        if err = op(ctx); err == nil {
            return nil
        }
        if !retryable(err) {
            return err
        }
        // Exponential backoff with full jitter
        d := time.Duration(rand.Int63n(int64(base * (1 << i))))
        select {
        case <-time.After(d):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return fmt.Errorf("after %d attempts: %w", attempts, err)
}
```

Three things this helper gets right:

- It checks `retryable(err)` so you only retry the kinds you should.
- It uses `select { case ... <-ctx.Done() }` so a cancelled context aborts the wait.
- It wraps the final error with the attempt count so logs explain *why* the request took so long.

**Common mistakes** in custom retry helpers:

- `time.Sleep` instead of `select`-on-context. The wait blocks past the deadline.
- No `retryable` predicate — retries `ErrInvalidArgument` forever.
- Linear (not exponential) backoff — does not relieve a struggling service.
- No jitter — synchronised retries from many clients hammer the upstream simultaneously.

---

## Transforming at API Boundaries

Every API layer has its own vocabulary for failure:

| Boundary | Vocabulary |
|----------|-----------|
| HTTP | 4xx/5xx status codes, problem-details JSON |
| gRPC | `codes.NotFound`, `codes.PermissionDenied`, etc. |
| Domain (between packages) | Sentinel errors and typed errors |
| User CLI | A short message, an exit code |

The *transform* decision happens at each boundary. Internal vocabulary leaks are a smell:

```go
// Bad: transport leaks SQL error to client
http.Error(w, "sql: no rows in result set", 500)

// Good: transport translates
if errors.Is(err, sql.ErrNoRows) {
    http.NotFound(w, r)
    return
}
```

A typical translation table for a CRUD service:

| Domain sentinel | HTTP | gRPC |
|-----------------|------|------|
| `ErrNotFound` | 404 | NotFound |
| `ErrAlreadyExists` | 409 | AlreadyExists |
| `ErrInvalidArgument` | 400 | InvalidArgument |
| `ErrPermissionDenied` | 403 | PermissionDenied |
| `ErrUnauthenticated` | 401 | Unauthenticated |
| anything else | 500 | Internal |

Implementation:

```go
func httpStatus(err error) int {
    switch {
    case errors.Is(err, ErrNotFound):
        return http.StatusNotFound
    case errors.Is(err, ErrAlreadyExists):
        return http.StatusConflict
    case errors.Is(err, ErrInvalidArgument):
        return http.StatusBadRequest
    case errors.Is(err, ErrPermissionDenied):
        return http.StatusForbidden
    case errors.Is(err, ErrUnauthenticated):
        return http.StatusUnauthorized
    default:
        return http.StatusInternalServerError
    }
}
```

The boundary owns this map. Adding a new domain sentinel means updating the map exactly once.

---

## The Log-or-Return Rule, In Detail

The rule again: **log OR return, not both.** Why is breaking it bad?

Each `log.Printf("op failed: %v", err)` is structured noise. Five layers logging the same error means five entries with similar but not identical wording. Operators learn to scroll past the noise. The actual moment of decision — *where* it failed and *why* — is buried.

Two rules-of-thumb to keep the rule honest:

1. **Logs are owned by the boundary.** HTTP middleware logs. Worker recovery logs. Background timers log. Internal layers do not log; they wrap and return.

2. **If you have to log inside a layer, you have a reason.** "Best-effort cache flush failed" is a reason. "Made a debugging note" is not. Document the reason in the log line itself: `log.Printf("best-effort cache flush failed (continuing): %v", err)`.

Counter-example: a *worker pool* without a top-level handler logs because it has nowhere to surface to. The worker is the boundary.

---

## Recovery Strategies: Fallback, Cache, Degraded Mode

When you decide to *recover* instead of surfacing, the recovery strategy itself has a small taxonomy:

| Strategy | Example |
|----------|---------|
| **Static default** | Missing config → use baked-in defaults. |
| **Cached value** | Downstream API down → serve last successful response. |
| **Stale read** | DB primary unreachable → read from a (possibly stale) replica. |
| **Reduced feature** | Recommendation service down → return a generic feed, not personalised. |
| **Skip the step** | Optional analytics fire-and-forget — log and continue. |

Recovery is rarely "do nothing"; it is *choose a degraded behaviour*. The user gets *something*, even if not the best something. This is what "graceful degradation" means in production.

A pattern: **recover, but mark the response.**

```go
type RecResp struct {
    Items   []Item
    Stale   bool
    Reason  string // optional, for debug/observability
}

func recommend(ctx context.Context, userID int) (RecResp, error) {
    items, err := personaliser.Recommend(ctx, userID)
    if err != nil {
        items, err2 := generic.Recommend(ctx)
        if err2 != nil {
            return RecResp{}, fmt.Errorf("recommend %d: personalised %v; generic %w", userID, err, err2)
        }
        return RecResp{Items: items, Stale: true, Reason: "personaliser unavailable"}, nil
    }
    return RecResp{Items: items}, nil
}
```

The caller learns the response is degraded; observability picks up `Stale=true` rates. *Recovery without observability is silent breakage.*

---

## The errWriter Pattern and Errors as State

Long sequences of operations that all return the same error type get tedious:

```go
if _, err := w.Write(a); err != nil { return err }
if _, err := w.Write(b); err != nil { return err }
if _, err := w.Write(c); err != nil { return err }
if _, err := w.Write(d); err != nil { return err }
```

Rob Pike's *errors are values* essay introduces the **errWriter** pattern: capture the error in a struct field, no-op subsequent calls, check at the end:

```go
type errWriter struct {
    w   io.Writer
    err error
}

func (e *errWriter) write(p []byte) {
    if e.err != nil {
        return
    }
    _, e.err = e.w.Write(p)
}

func writeAll(w io.Writer, blocks ...[]byte) error {
    ew := &errWriter{w: w}
    for _, b := range blocks {
        ew.write(b)
    }
    return ew.err
}
```

Every `ew.write` *checks* the prior state and either continues or no-ops. The final `return ew.err` is the one *handle*. This collapses N checks into one decision point.

The same idea generalises: any state machine that should stop on first error can hold an `err` field and short-circuit.

```go
type Parser struct {
    in  *bufio.Scanner
    err error
}

func (p *Parser) Token() string {
    if p.err != nil {
        return ""
    }
    if !p.in.Scan() {
        p.err = p.in.Err()
        return ""
    }
    return p.in.Text()
}

func (p *Parser) Err() error { return p.err }
```

Pattern: **errors are state, not control flow.** No `panic`/`recover`, no exception simulation; just a sticky field.

---

## Errors Across Goroutines

A `go f()` is fire-and-forget. The launching goroutine cannot `recover` a panic that happens inside `f`. The launching goroutine cannot read an `error` returned by `f`. You must build the channel back yourself.

Two standard tools:

### `errgroup.Group` (golang.org/x/sync/errgroup)

```go
import "golang.org/x/sync/errgroup"

func fanOut(ctx context.Context, ids []int) error {
    g, ctx := errgroup.WithContext(ctx)
    results := make([]Result, len(ids))
    for i, id := range ids {
        i, id := i, id
        g.Go(func() error {
            r, err := fetch(ctx, id)
            if err != nil {
                return fmt.Errorf("fetch %d: %w", id, err)
            }
            results[i] = r
            return nil
        })
    }
    return g.Wait()
}
```

`errgroup` collects the *first* error and cancels the group's context. Other goroutines see `ctx.Done()` and stop. The `g.Wait()` returns that first error.

### Channels for explicit collection

```go
type result struct {
    id  int
    err error
}

ch := make(chan result, len(ids))
for _, id := range ids {
    go func(id int) {
        ch <- result{id, work(id)}
    }(id)
}
var firstErr error
for i := 0; i < len(ids); i++ {
    r := <-ch
    if r.err != nil && firstErr == nil {
        firstErr = r.err
    }
}
```

Use channels when you need *all* errors, not just the first; pair with `errors.Join` (Go 1.20+) to combine.

### Always recover panics in goroutines you spawn

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v\n%s", r, debug.Stack())
        }
    }()
    work()
}()
```

A panic in an unrecovered goroutine crashes the entire process. This is the most common Go production crash. Every `go` you write should have a recovery, *unless* you explicitly want crash-on-panic semantics for that worker.

---

## Errors and Context Cancellation

`context.Context` introduces two special errors: `context.Canceled` and `context.DeadlineExceeded`. Both are *expected*, not failures. Treat them as a successful "stop" signal:

```go
if err := op(ctx); err != nil {
    if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
        return nil // not an error: caller asked us to stop
    }
    return fmt.Errorf("op: %w", err)
}
```

Or, more often, surface them but not as alarms:

```go
if err := op(ctx); err != nil {
    if ctx.Err() != nil {
        return ctx.Err() // surface canceled/deadline as-is
    }
    return fmt.Errorf("op: %w", err) // wrap real failures
}
```

**Why does this matter?** A monitoring dashboard that counts "errors" should not flag context cancellations as alarming. Filter by `errors.Is(err, context.Canceled)` and exclude.

`select` patterns make cancellation explicit:

```go
select {
case res := <-resultCh:
    return res, nil
case <-ctx.Done():
    return zero, ctx.Err()
}
```

Worker goroutines that receive a cancelled context should clean up and return — not panic, not log "weird state".

---

## Sentinel + Custom Error Type Patterns

Two complementary patterns for layering decisions:

### Sentinels for *kind*

```go
var (
    ErrNotFound       = errors.New("not found")
    ErrAlreadyExists  = errors.New("already exists")
    ErrInvalidInput   = errors.New("invalid input")
)
```

Used with `errors.Is`. The boundary translates each into a status code.

### Custom types for *data*

```go
type ValidationError struct {
    Field string
    Reason string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s: %s", e.Field, e.Reason)
}
```

Used with `errors.As`. The boundary inspects fields:

```go
var ve *ValidationError
if errors.As(err, &ve) {
    http.Error(w, fmt.Sprintf("invalid %s: %s", ve.Field, ve.Reason), 400)
    return
}
```

A typical service uses sentinels for kinds (small finite set) and custom types when you need to carry data (multi-field, structured).

### Anti-pattern: a single megastruct

```go
type AppError struct {
    Code    int
    Message string
    Cause   error
    Stack   []byte
    Trace   string
    UserID  int
    // ... 20 more fields
}
```

Dumping every possible piece of metadata into one struct couples every layer to the same shape. Prefer many small types or sentinels + wrapping.

---

## Anti-Patterns That Look Like Handling

### Anti-pattern 1: Log and rethrow chains

```go
if err != nil {
    log.Printf("foo failed: %v", err)
    return err
}
```

Five layers of this and your log is full of "foo failed: bar failed: baz failed: i/o timeout". Pick a layer.

### Anti-pattern 2: Swallow with `_`

```go
data, _ := io.ReadAll(resp.Body)
```

If `ReadAll` fails, `data` is whatever was read so far — possibly empty. The error is gone. The bug is invisible until users complain about empty responses.

### Anti-pattern 3: Always wrap, never inspect

```go
return fmt.Errorf("op: %w", err)  // every layer
```

Mechanical wrapping without thinking is the same as mechanical checking. Wrap when the next layer cannot reconstruct the context. Skip the wrap when it adds nothing.

### Anti-pattern 4: Generic catch-all

```go
defer func() {
    if r := recover(); r != nil {
        log.Println("something went wrong")
    }
}()
```

A panic with no detail in the log is worse than a crash. Always include the panic value and stack: `log.Printf("panic %v\n%s", r, debug.Stack())`.

### Anti-pattern 5: Ignoring `Close()` errors

```go
defer file.Close()
```

For files you wrote, `Close` may report buffer-flush errors. Silently dropping them means "your data is on disk" can be a lie. Pattern:

```go
err := write(file)
if cerr := file.Close(); err == nil {
    err = cerr
}
return err
```

### Anti-pattern 6: Re-panic with stripped info

```go
if err := work(); err != nil {
    panic(err.Error())
}
```

Converts a typed error into a string. The recovery side cannot `errors.Is` or `errors.As` anymore. If you must escalate to panic, panic with the original error.

### Anti-pattern 7: Returning errors from `Close`-only methods

If your "Close-like" method's only failure mode is "could not flush", consider whether the caller can do anything with that information. Often the caller cannot. Either way, *document* what the error means.

---

## Code Review Heuristics

A short list of questions to ask in PR review:

1. **Does this `if err != nil` block make a decision, or is it a reflex?** If reflex, ask the author what they expect to happen.
2. **Is the wrap message informative?** "load user 42" yes; "error" no.
3. **Is this layer logging *and* returning?** Pick one.
4. **Is this retry actually safe?** Idempotent + transient + bounded?
5. **Does this `recover` have a `debug.Stack()`?** Otherwise where-info is lost.
6. **Are domain sentinels translated at the boundary?** Or do storage errors leak to clients?
7. **Are context cancellations distinguished from real failures?** Otherwise alarms fire on every shutdown.
8. **Are spawned goroutines protected by a `recover`?** A panic kills the process.
9. **Is the happy path at the left margin?** If indentation grows past 2 levels, look hard.
10. **Are `Close()` errors captured for files you wrote?** If yes, where?

A reviewer checklist saves more bugs than any tool.

---

## Worked Example: Order Processor

Putting it all together — an order processor with all six decisions visible:

```go
package orders

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "log"
    "time"
)

var (
    ErrOrderNotFound = errors.New("order not found")
    ErrAlreadyPaid   = errors.New("already paid")
)

type Service struct {
    db      *sql.DB
    payment Payment
}

type Payment interface {
    Charge(ctx context.Context, orderID string, amount int) error
}

func (s *Service) ProcessOrder(ctx context.Context, orderID string) error {
    // 1. Fetch — surface or transform DB error
    order, err := s.fetchOrder(ctx, orderID)
    if err != nil {
        return err // already wrapped/transformed inside fetchOrder
    }

    // 2. Idempotency — recover (do nothing, return success)
    if order.Paid {
        return nil // already paid; this is success, not error
    }

    // 3. Charge — retry transient, surface permanent
    if err := s.chargeWithRetry(ctx, order); err != nil {
        return fmt.Errorf("process order %s: %w", orderID, err)
    }

    // 4. Mark paid — log on failure, do not surface
    if err := s.markPaid(ctx, orderID); err != nil {
        // We took the money. The reconciler will fix this row.
        // Surfacing now would tell the caller "failed" after success.
        log.Printf("WARN: could not mark order %s paid: %v", orderID, err)
    }
    return nil
}

func (s *Service) fetchOrder(ctx context.Context, id string) (Order, error) {
    row := s.db.QueryRowContext(ctx, "SELECT id, amount, paid FROM orders WHERE id=?", id)
    var o Order
    if err := row.Scan(&o.ID, &o.Amount, &o.Paid); err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return Order{}, ErrOrderNotFound // transform: sql -> domain
        }
        return Order{}, fmt.Errorf("fetch order %s: %w", id, err) // surface
    }
    return o, nil
}

func (s *Service) chargeWithRetry(ctx context.Context, o Order) error {
    return Retry(ctx, 3, 100*time.Millisecond,
        func(ctx context.Context) error {
            return s.payment.Charge(ctx, o.ID, o.Amount)
        },
        IsTransient,
    )
}

func (s *Service) markPaid(ctx context.Context, id string) error {
    _, err := s.db.ExecContext(ctx, "UPDATE orders SET paid=1 WHERE id=?", id)
    return err
}

type Order struct {
    ID     string
    Amount int
    Paid   bool
}

func IsTransient(err error) bool {
    // Real code: check for connection reset, 503, deadline.
    return false
}
```

Walk through the decisions:

- `fetchOrder` — *transform* `sql.ErrNoRows` to `ErrOrderNotFound`; *surface* others with context.
- `ProcessOrder` early return on `Paid` — *recover* (idempotent skip).
- `chargeWithRetry` — *retry* transient; *surface* permanent (the helper handles both).
- `markPaid` — *log* if it fails; do not surface, because the money is already taken.

The HTTP handler that calls `ProcessOrder` then translates:

```go
func chargeHandler(s *Service) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        id := r.PathValue("id")
        err := s.ProcessOrder(r.Context(), id)
        switch {
        case err == nil:
            w.WriteHeader(http.StatusOK)
        case errors.Is(err, ErrOrderNotFound):
            http.Error(w, "order not found", http.StatusNotFound)
        case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
            // client gave up; do not flag as our error
            return
        default:
            log.Printf("ProcessOrder %s: %v", id, err)
            http.Error(w, "internal error", http.StatusInternalServerError)
        }
    }
}
```

Each layer makes its decision in its own language. No layer logs *and* returns. Cancellations are handled separately. Internal details never reach the client.

---

## Summary

Middle-level Go error handling is layer-aware. Each layer has different information and different responsibility, and the right *decision* depends on which layer you are in. Retries belong where idempotency is known. Translations belong at boundaries. Logging belongs at the layer that owns the error — exactly one. Recovery is a *strategy*, not a no-op: cache, fallback, degraded mode, with observability so silent failures cannot hide. The `errWriter` pattern collapses long sequences of checks into one decision point. Goroutines need their own `recover` and their own error-collection plumbing. Context cancellation is an expected stop signal, not an alarm.

Most of what makes a Go service feel solid is the discipline of these middle-level patterns — applied consistently, every PR.

---

## Further Reading

- [Don't just check errors, handle them gracefully — Dave Cheney](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- [Errors are values — Rob Pike](https://go.dev/blog/errors-are-values)
- [Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Package errgroup](https://pkg.go.dev/golang.org/x/sync/errgroup)
- [Context Package](https://pkg.go.dev/context) — cancellation semantics
- [Idempotency keys for safe retries](https://stripe.com/blog/idempotency)
- [Failure Modes: Fail-Fast, Fail-Safe, Fail-Soft](https://en.wikipedia.org/wiki/Fail-safe)
- [Site Reliability Engineering — chapter on handling overload](https://sre.google/sre-book/handling-overload/)
