# errors.Is vs errors.As — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Errors as Public API](#errors-as-public-api)
3. [Choosing Between Sentinels, Types, and Interfaces](#choosing-between-sentinels-types-and-interfaces)
4. [Cross-Package Error Contracts](#cross-package-error-contracts)
5. [Error Categories at Architectural Scale](#error-categories-at-architectural-scale)
6. [Wrapping Discipline](#wrapping-discipline)
7. [Multi-Error Strategies for Aggregating Operations](#multi-error-strategies-for-aggregating-operations)
8. [HTTP/gRPC Boundaries](#httpgrpc-boundaries)
9. [Logging, Telemetry, and `Is`/`As`](#logging-telemetry-and-isas)
10. [API Versioning and Error Stability](#api-versioning-and-error-stability)
11. [Anti-Patterns at Scale](#anti-patterns-at-scale)
12. [Production War Stories](#production-war-stories)
13. [Architectural Patterns](#architectural-patterns)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction
> Focus: "How to optimize?" and "How to architect?"

At middle level you wrote individual error types and learned the algorithm. At senior level you do not write a single error type — you decide what every error in your service looks like to a caller, what gets re-exposed across an API boundary, what gets translated into a status code, what gets logged, what gets exported as a counter, and what gets dropped.

The interesting questions stop being mechanical. They are: *Should this be an exported sentinel or stay internal? If callers need to retry, should they detect by `Is`, `As`, or by an interface? What does our API contract say about what `Is` will match? When will we add a new error kind without breaking clients?*

This file is the architectural view: **error matching as a system property, not a function call.**

---

## Errors as Public API

Once a sentinel or typed error is exported, it is a part of your package's public contract just like a function signature.

```go
package repo

var ErrNotFound = errors.New("not found")
```

The day you export `ErrNotFound`, callers write `if errors.Is(err, repo.ErrNotFound)`. From that day on:
- You cannot remove `ErrNotFound` — that breaks every caller.
- You cannot change its message arbitrarily — some users grep logs.
- You cannot stop returning it for "row not found" — callers depend on the match.
- If you add a *related* error (`ErrConflict`), you must decide whether `errors.Is(conflictErr, ErrNotFound)` should be true (it should not), and document it.

Treating errors as API means:
- They go in the package's `doc.go` or in the function comment.
- They appear in your changelog when added or modified.
- They are versioned with your module.

A typed error is a more elaborate contract:

```go
type APIError struct {
    Status  int
    Code    string
    Message string
    // Fields below are exported. Adding new ones is fine; removing isn't.
}

func (e *APIError) Error() string { ... }
```

Every public field of `APIError` is also part of the API. Adding a field is backward-compatible; removing one is not. Renaming one is not. Changing the type of one is not.

A useful rule: **if a field is for users, export it. If a field is for diagnostics only, hide it behind a method or skip it.**

---

## Choosing Between Sentinels, Types, and Interfaces

Three shapes for "this error is X" matching:

### A. Sentinels — `errors.Is`

Use when callers only want to *recognize* the error. No fields. Cheap, easy, well-understood.

```go
var (
    ErrTokenExpired   = errors.New("token expired")
    ErrTokenSignature = errors.New("bad signature")
)

if errors.Is(err, jwt.ErrTokenExpired) { askToReauth() }
```

### B. Typed errors — `errors.As`

Use when callers need fields. Path, code, retry-after, parsed JSON, etc.

```go
type RateLimitError struct {
    RetryAfter time.Duration
    Endpoint   string
}

var rl *RateLimitError
if errors.As(err, &rl) {
    time.Sleep(rl.RetryAfter)
}
```

### C. Interfaces — `errors.As` against an interface type

Use when many concrete types share a property and you do not want to enumerate them.

```go
type Temporary interface {
    error
    Temporary() bool
}

var t Temporary
if errors.As(err, &t) && t.Temporary() {
    retry()
}
```

This pattern is what `net.Error` and friends use. The advantage: a third-party concrete type can implement your interface and become "temporary" without touching your code.

### Choosing in practice

| Situation | Choose |
|-----------|--------|
| Single, well-known case (EOF, NotFound). | Sentinel. |
| Caller branches on fields. | Typed. |
| Many third-party types should opt in to a behavior. | Interface. |
| You need both: detect the kind *and* read fields. | Typed + custom `Is` mapping to a sentinel. |
| You evolve frequently and want forward compatibility. | Interface (open) or typed-with-kind-sentinel. |

A single package can use all three. `database/sql` does: `ErrNoRows` (sentinel), `*ErrConnDone`-style (typed), and the `Result` interface (interface — though not error-related).

---

## Cross-Package Error Contracts

When package `B` calls package `A`, errors flow back. Three options for what `B` exposes to its callers:

### Option 1: Pass through unchanged

```go
func B_op() error {
    return A.SomeOp() // unchanged
}
```

Caller of `B` writes `errors.Is(err, A.ErrFoo)`. Now `B` has an indirect dependency on `A`'s public errors. If `A` ever renames `ErrFoo`, `B`'s callers break too. **Avoid.**

### Option 2: Translate at the boundary

```go
func B_op() error {
    err := A.SomeOp()
    if errors.Is(err, A.ErrFoo) {
        return ErrBOp // B's own sentinel
    }
    return err
}
```

Callers of `B` only see `B`'s errors. `A` is hidden. Costs more code; gives `B` independence. **Recommended for true module boundaries.**

### Option 3: Wrap and re-export the cause via custom `Is`

```go
type bErr struct{ inner error }

func (e *bErr) Error() string { return e.inner.Error() }
func (e *bErr) Unwrap() error { return e.inner }

func B_op() error {
    err := A.SomeOp()
    if err != nil {
        return &bErr{inner: err}
    }
    return nil
}
```

Now callers of `B` can do `errors.Is(berr, A.ErrFoo)` and it works through `Unwrap`. Callers can also do `errors.Is(berr, B.ErrSomething)` if `B` defines its own. The chain stays intact. **Recommended for thin shim packages.**

In practice, large services do all three at different layers:
- *Storage → Domain*: translate (Option 2).
- *Domain → Transport*: translate again, often into HTTP error types.
- *Internal helper packages*: wrap (Option 3).

---

## Error Categories at Architectural Scale

For a service with dozens of error sites, a flat list of sentinels does not scale. Common patterns:

### Categorization via a "kind" sentinel

Every typed error carries a kind, and `Is` resolves to that kind:

```go
var (
    KindNotFound      = errors.New("not_found")
    KindInvalidInput  = errors.New("invalid_input")
    KindPermission    = errors.New("permission_denied")
    KindConflict      = errors.New("conflict")
    KindUnavailable   = errors.New("unavailable")
    KindInternal      = errors.New("internal")
)

type AppError struct {
    Kind error
    Op   string
    Err  error
}

func (e *AppError) Error() string { return e.Op + ": " + e.Err.Error() }
func (e *AppError) Unwrap() error { return e.Err }
func (e *AppError) Is(target error) bool { return target == e.Kind }
```

Now any module can return `&AppError{Kind: KindNotFound, ...}` and any caller can write `errors.Is(err, KindNotFound)`. The kind is a small, stable list; the typed wrapper carries op+inner.

### Category-to-status mapping

```go
func httpStatusFor(err error) int {
    switch {
    case errors.Is(err, KindNotFound):
        return 404
    case errors.Is(err, KindInvalidInput):
        return 400
    case errors.Is(err, KindPermission):
        return 403
    case errors.Is(err, KindConflict):
        return 409
    case errors.Is(err, KindUnavailable):
        return 503
    default:
        return 500
    }
}
```

This is the only place that needs to know HTTP status codes. The rest of the codebase deals in domain kinds.

### gRPC mapping

```go
func grpcCodeFor(err error) codes.Code {
    switch {
    case errors.Is(err, KindNotFound):
        return codes.NotFound
    case errors.Is(err, KindInvalidInput):
        return codes.InvalidArgument
    // ...
    }
}
```

Same idea, different protocol.

### Adding a new kind

Adding `KindRateLimited` is a one-line change:
```go
var KindRateLimited = errors.New("rate_limited")
```

Plus one line in each mapping switch. No existing code breaks.

This pattern scales to large services with many domains. It is essentially how Cockroach's error package, Google's `xerrors`, and gRPC's status codes are organized.

---

## Wrapping Discipline

A senior code review checks for **consistency** in wrapping:

| Rule | Why |
|------|-----|
| Always wrap with `%w`, never `%v`, when crossing a package boundary. | `%v` breaks the chain. |
| Wrap once per layer. | Wrapping ten times for the same crash makes logs noisy. |
| Add value with each wrap (op name, key argument). | A wrap that just says "error: %w" adds nothing. |
| Don't wrap context.Canceled or context.DeadlineExceeded with new sentinels. | Callers usually want to see the cancellation cause. |
| Don't wrap an error you intend to compare with `==` upstream. | Forces upstream to use `Is`. |

Concrete templates:

```go
// Storage layer
func (r *Repo) Get(id ID) (*User, error) {
    u, err := r.db.QueryRow(...)
    if err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, &AppError{Kind: KindNotFound, Op: "Repo.Get", Err: err}
        }
        return nil, fmt.Errorf("Repo.Get %d: %w", id, err)
    }
    return u, nil
}
```

```go
// Domain layer
func (s *Svc) GetUser(ctx context.Context, id ID) (*User, error) {
    u, err := s.repo.Get(id)
    if err != nil {
        return nil, fmt.Errorf("Svc.GetUser: %w", err)
    }
    if !s.canRead(ctx, u) {
        return nil, &AppError{Kind: KindPermission, Op: "Svc.GetUser", Err: errors.New("not allowed")}
    }
    return u, nil
}
```

```go
// Transport layer
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
    u, err := h.svc.GetUser(r.Context(), id)
    if err != nil {
        http.Error(w, err.Error(), httpStatusFor(err))
        return
    }
    json.NewEncoder(w).Encode(u)
}
```

The shape stays the same in every layer: catch known causes, wrap unknown ones, let `Is` find the kind at the top.

---

## Multi-Error Strategies for Aggregating Operations

When an operation tries N things and any subset can fail, you have choices:

### Strategy 1: Return the first error, log the rest

Simple, lossy. Fine for non-critical batch jobs.

### Strategy 2: Return `errors.Join(errs...)`

Standard since Go 1.20.

```go
func processAll(items []Item) error {
    var errs []error
    for _, it := range items {
        if err := process(it); err != nil {
            errs = append(errs, fmt.Errorf("item %s: %w", it.ID, err))
        }
    }
    return errors.Join(errs...) // nil if no errors
}
```

Callers can:
- Check `if err != nil` for "anything failed".
- Use `errors.Is(err, SomeKind)` to detect a specific kind anywhere in the joined set.
- Walk via `errors.As(err, &joined)` if they implement a custom `joined` type with extra metadata.

### Strategy 3: Aggregate with a custom joined type

```go
type batchErr struct {
    failed []ItemError
}

type ItemError struct {
    ID  string
    Err error
}

func (e *batchErr) Error() string { /* count */ }
func (e *batchErr) Unwrap() []error {
    out := make([]error, len(e.failed))
    for i, f := range e.failed {
        out[i] = f.Err
    }
    return out
}
```

Now `errors.Is(batchErr, KindInvalidInput)` is true if any item had invalid input. And callers can range over `e.failed` to know *which* items failed. Best of both worlds for batch APIs.

### Trade-offs

| Strategy | Pro | Con |
|----------|-----|-----|
| First error | Simple, fast | Loses information |
| `errors.Join` | Standard library, walks correctly | No per-item metadata unless you wrap each one |
| Custom batchErr | Rich, queryable | More code, custom type to maintain |

For internal batch jobs, `errors.Join` is usually right. For public APIs that batch, a custom type with structured fields is better — you control the wire format.

---

## HTTP/gRPC Boundaries

`errors.Is` and `errors.As` should rarely cross a network boundary. They work on Go values; the wire format is bytes. Two patterns:

### Pattern A: Translate to a wire status, lose the chain

```go
// Server
err := svc.DoX(ctx)
if errors.Is(err, KindNotFound) {
    return status.Error(codes.NotFound, "not found")
}
```

The client receives `codes.NotFound` and re-creates a sentinel:

```go
// Client
_, err := client.DoX(ctx, req)
if status.Code(err) == codes.NotFound {
    // ...
}
```

Or wrap to preserve `Is`:

```go
// Client wrapper
err := callServer()
if status.Code(err) == codes.NotFound {
    return fmt.Errorf("%w: %s", svc.ErrNotFound, status.Convert(err).Message())
}
```

Now upstream callers can write `errors.Is(err, svc.ErrNotFound)` even though the error originated on the server.

### Pattern B: Carry a serialized error contract

For richer information, use protobuf `Status` details (gRPC) or a JSON error envelope (HTTP):

```json
{
  "error": {
    "kind": "rate_limited",
    "retry_after_ms": 5000,
    "trace_id": "..."
  }
}
```

The client parses this back into a typed `*RateLimitError` that local code can `errors.As` into. The kind string acts as a stable identifier.

### Anti-pattern: Pass `errors.Is` results across boundaries naively

A boolean `IsNotFound` field in your protobuf is not extensible; later you want `IsConflict` and a hundred more. Use codes/strings as the wire vocabulary, then convert to typed errors locally.

---

## Logging, Telemetry, and `Is`/`As`

Two common patterns:

### Pattern: Log with the matched kind

```go
func handle(err error) {
    var kind string
    switch {
    case errors.Is(err, KindNotFound):
        kind = "not_found"
    case errors.Is(err, KindPermission):
        kind = "permission"
    default:
        kind = "internal"
    }
    log.Error("handler failed", "kind", kind, "err", err)
}
```

The structured log gets a stable `kind` field that you can group by in your log aggregator.

### Pattern: Counter per kind

```go
var errCounter = metrics.NewCounter("errors_total", []string{"kind"})

func record(err error) {
    var kind string
    // (same switch as above)
    errCounter.WithLabelValues(kind).Inc()
}
```

Cardinality matters: keep the kind set small. A graph of `errors_total{kind=...}` over time is one of the most actionable signals in a service.

### Pattern: Trace span status from `Is`

```go
span.RecordError(err)
if errors.Is(err, KindInternal) {
    span.SetStatus(codes.Error, "internal failure")
}
```

The trace shows the error and a stable status. The same `Is` rule that drives the HTTP status drives the span status — DRY.

---

## API Versioning and Error Stability

Errors are part of API. Some rules of thumb:

- **Adding a new sentinel is non-breaking** as long as nothing returns it. (Existing code does not match it; nothing changes.)
- **Returning a new sentinel from an existing function is non-breaking** if existing matches still hold. If a function that previously returned `ErrFoo` now sometimes returns `ErrBar`, callers that match only `ErrFoo` no longer match. Treat it as a minor version bump and document it.
- **Renaming a sentinel is breaking.** Use deprecation: keep both, document the old as deprecated.
- **Changing the type returned by `errors.As`** is breaking. Adding new typed errors is fine; changing existing ones is not.
- **Changing what `Is` returns true for** is breaking. Adding new `Is` rules in custom methods is risky — callers may match more than they did before.

A common policy in `v1`-stable modules: **error sentinels and typed error types are part of the API; their exported symbols, fields, and `Is`/`As` semantics follow semver.**

---

## Anti-Patterns at Scale

### Anti-pattern: A sentinel per code site

```go
var (
    ErrFooLine12 = errors.New("...")
    ErrFooLine42 = errors.New("...")
    ErrFooLine97 = errors.New("...")
)
```

Sentinels become file:line indices. Useless to callers, painful to maintain. Group by *kind*, not by *site*.

### Anti-pattern: A typed error per case

If `*UserNotFoundErr`, `*PostNotFoundErr`, `*OrderNotFoundErr` all carry the same fields (just different kinds), use **one** typed error with a `Resource` field.

```go
type NotFoundError struct{ Resource string; ID string }
func (e *NotFoundError) Error() string { return ... }
```

### Anti-pattern: Cross-cutting `Is` rules in every type

```go
// Every wrapper type:
func (e *fooErr) Is(target error) bool { return target == ErrFoo }
func (e *fooErr) Is(target error) bool { return target == ErrTimeout }
func (e *fooErr) Is(target error) bool { return target == ErrTransient }
```

Soon nobody knows what an `errors.Is(x, ErrTransient)` actually matches. Centralize the kind logic — one type with a `Kind` field, one `Is` method.

### Anti-pattern: `As` to interface, then nil-check

```go
var t Temporary
errors.As(err, &t)
if t == nil { return false } // this is the wrong check
```

`As` returns a bool. Use that. The variable is `nil` only when the assignment did not happen — but the bool tells you that already.

### Anti-pattern: `errors.Is(err, fmt.Errorf(...))`

You will create a new error on the right side; `==` will be false. Always compare against a stable sentinel.

---

## Production War Stories

### Story 1: The silent context cancel

A service that wrapped `context.Canceled` as `errors.New("operation cancelled")` lost its 5xx-vs-499 distinction in metrics. A request the client cancelled was logged as a server error. `errors.Is(err, context.Canceled)` was always false because the wrap had thrown away the chain. Fix: never lose `context.Canceled`; wrap with `%w`.

### Story 2: The custom Is that swallowed everything

```go
func (e *commonErr) Is(target error) bool { return true }
```

A typo. `errors.Is(anyerr, anyTarget)` returned true. Half the service's retry logic broke (every error retried; even validation errors). Fix: linter that flags `Is(target error) bool { return true }` as suspicious.

### Story 3: The slice sentinel

```go
var ErrConfigInvalid = []string{"missing", "fields"}
```

Someone tried to use a typed sentinel with a slice. It "worked" for a while because nobody compared against it. The day someone wrote `errors.Is(err, ErrConfigInvalid)` the server panicked at run time inside the comparable check. Fix: use `errors.New` for sentinels.

### Story 4: The infinite As

A typed error overrode `As` to wrap itself recursively: when asked to fill a `**myErr`, it created a new wrapper and stored that, then on the next call wrapped again. With certain error chains this caused stack growth until OOM. Fix: keep `As` methods strictly setting the target, no recursion.

---

## Architectural Patterns

### Pattern: One error package per service

A small package, often called `apperrors` or `errs`, that owns:

- The kind sentinels.
- The `AppError` typed wrapper.
- Mapping helpers (`HTTPStatus`, `GRPCCode`).
- Test helpers (`ExpectKind`, `MustExtract`).

Every other package imports this one. Errors are cohesive across the service.

### Pattern: Error builders

```go
func NotFound(op string, inner error) error {
    return &AppError{Kind: KindNotFound, Op: op, Err: inner}
}

func InvalidInput(op string, msg string) error {
    return &AppError{Kind: KindInvalidInput, Op: op, Err: errors.New(msg)}
}
```

Callers write `return errs.NotFound("Svc.GetUser", err)` instead of constructing the struct manually. Reduces boilerplate and enforces the contract.

### Pattern: Decorators for telemetry

```go
type Handler interface { Do(ctx context.Context) error }

type loggingHandler struct { inner Handler; log Logger }

func (h *loggingHandler) Do(ctx context.Context) error {
    err := h.inner.Do(ctx)
    if err != nil {
        h.log.Error("op failed", "kind", kindOf(err), "err", err)
    }
    return err
}
```

Telemetry lives in a decorator; it uses `errors.Is`/`errors.As` to extract structured info. The decorator is reusable across handlers.

### Pattern: Test utilities

```go
package errs_test

func RequireKind(t *testing.T, err error, kind error) {
    t.Helper()
    if !errors.Is(err, kind) {
        t.Fatalf("expected kind %v; got %v", kind, err)
    }
}

func RequireAs(t *testing.T, err error, target any) {
    t.Helper()
    if !errors.As(err, target) {
        t.Fatalf("expected error of given type; got %v", err)
    }
}
```

Now tests across the codebase share consistent assertions.

---

## Summary

At senior level, `errors.Is` and `errors.As` are tools for shaping a service's error contract — not just for matching individual errors. The architecture decisions are: which kinds exist, how they map to wire codes, where the kind switch lives, and what callers can rely on. Write the kinds in one package, use typed errors with a `Kind` field plus a custom `Is`, translate at boundaries, log/meter the kind, and treat each exported sentinel as part of the API surface that follows the same versioning rules as everything else.

---

## Further Reading

- [Cockroach Labs error library](https://github.com/cockroachdb/errors) — production-grade error package
- [Upspin: Errors are values](https://commandcenter.blogspot.com/2017/12/error-handling-in-upspin.html) — Rob Pike's design notes
- [Effective Go: Errors](https://go.dev/doc/effective_go#errors)
- [Don't just check errors, handle them gracefully](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- [gRPC status codes](https://grpc.github.io/grpc/core/md_doc_statuscodes.html) — vocabulary you map your kinds to
- [Google AIP-193: Errors](https://google.aip.dev/193) — Google's API error guidance
