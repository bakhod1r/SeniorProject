# Error Design — Best Practices — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Errors as a System Property](#errors-as-a-system-property)
3. [The Error Vocabulary of a Service](#the-error-vocabulary-of-a-service)
4. [Library Errors vs Application Errors at Scale](#library-errors-vs-application-errors-at-scale)
5. [Cross-Boundary Errors: HTTP, gRPC, Queues](#cross-boundary-errors-http-grpc-queues)
6. [Errors and Telemetry: Logs, Metrics, Traces](#errors-and-telemetry-logs-metrics-traces)
7. [User-Facing Errors and Localization](#user-facing-errors-and-localization)
8. [Evolving Error Contracts Without Breaking Callers](#evolving-error-contracts-without-breaking-callers)
9. [Handling Class: Retryable, Permanent, Programmer](#handling-class-retryable-permanent-programmer)
10. [Errors and Distributed Systems](#errors-and-distributed-systems)
11. [Architectural Patterns](#architectural-patterns)
12. [Reviewing Error Design in Pull Requests](#reviewing-error-design-in-pull-requests)
13. [Anti-Patterns at Scale](#anti-patterns-at-scale)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction
> Focus: "How to architect?" and "How to scale?"

At senior level, error design becomes an architectural concern. The questions are no longer "how do I wrap with `%w`?" but "how does my error vocabulary compose across twelve services?", "can the on-call engineer at 3 AM tell *which* failure mode just lit up the alert?", and "what does it cost me when a transient downstream error gets logged once per layer at every microservice?"

This file is about error design at the system level: vocabulary, contracts, telemetry, and architecture.

---

## Errors as a System Property

A system's debuggability is determined as much by how errors flow as by how requests do. Three system-level properties:

1. **Identity propagation.** Every request carries a `trace_id`/`request_id`. Every error captured against that request includes those identifiers. You can pivot from "this user reported a problem" to "here are the 42 log lines for that request."

2. **Vocabulary consistency.** The same kind of failure has the same name, kind, and shape in every service. When `ErrNotFound` appears in payments, accounts, and search, it means the same thing — translated to the same HTTP/gRPC code at the boundary.

3. **Single owner per failure.** Each error is logged exactly once, by the layer that decides what to do about it. Below that layer, errors are wrapped; above it, they are translated; at it, they are observed.

Without these properties, an outage looks like noise. With them, the engineer can move from alert to root cause in minutes.

---

## The Error Vocabulary of a Service

A senior engineer designs a vocabulary *before* writing the first error path. The vocabulary is small (rarely more than a dozen kinds) and lives in one package.

```go
// package errs
package errs

import "errors"

type Kind int

const (
    KindUnknown      Kind = iota
    KindNotFound
    KindInvalid
    KindUnauthorized
    KindForbidden
    KindConflict
    KindTransient
    KindInternal
    KindUnavailable
    KindDeadline
)

func (k Kind) String() string { ... }

// Sentinel that maps to each kind, for callers who only need identity.
var (
    ErrNotFound     = errors.New("not found")
    ErrInvalid      = errors.New("invalid")
    ErrUnauthorized = errors.New("unauthorized")
    // ...
)

type Error struct {
    Op    string
    Kind  Kind
    Path  string
    Err   error
}

func (e *Error) Error() string { /* compose */ }
func (e *Error) Unwrap() error { return e.Err }

// Match against the family sentinel.
func (e *Error) Is(target error) bool {
    switch target {
    case ErrNotFound: return e.Kind == KindNotFound
    case ErrInvalid: return e.Kind == KindInvalid
    // ...
    }
    return false
}
```

Now every layer of the service has the same vocabulary. The HTTP boundary maps each kind to an HTTP status; the gRPC boundary maps to a gRPC code; the worker maps to retry-or-not.

Tradeoffs:
- **Pro**: consistency, structured fields, single translation table per protocol.
- **Pro**: easy to instrument metrics by `Kind`.
- **Con**: more typing at every error site (`&errs.Error{Op: "users.Get", Kind: KindNotFound, ...}`).
- **Con**: harder to integrate with libraries that produce their own errors (you must translate at the seam).

Most teams settle somewhere between this fully-structured approach and pure stdlib. A pragmatic middle: use `errs.Wrap`, `errs.NotFoundf`, `errs.Invalidf` helpers that produce structured `Error` values internally:

```go
return errs.NotFoundf("user %d", id)
```

Less verbose than the struct literal, all the structured benefits.

---

## Library Errors vs Application Errors at Scale

Libraries and applications have different error responsibilities:

### Libraries should:
- Define a small, stable surface of error kinds.
- Document each public error.
- Avoid leaking internal types or third-party errors.
- Provide an `Is` method for easy matching.
- Use lowercase, no-punctuation messages.

### Applications should:
- *Translate* library errors at the seam — never propagate `mongo.ErrNoDocuments` to the HTTP handler.
- Define their own internal vocabulary (`errs.Kind`).
- Log once, at the boundary.
- Map kinds to status codes, retry decisions, and metric labels.

The translation happens at the *adapter* layer: the place where the application talks to the library. A repository, a gateway, a client wrapper. The translation is one switch statement and 20 lines of code; missing it is one of the most common architecture mistakes in growing services.

```go
// adapters/userrepo.go
func (r *UserRepo) Get(ctx context.Context, id int64) (*User, error) {
    var u User
    err := r.coll.FindOne(ctx, bson.M{"_id": id}).Decode(&u)
    switch {
    case errors.Is(err, mongo.ErrNoDocuments):
        return nil, errs.NotFoundf("user %d", id)
    case mongo.IsTimeout(err):
        return nil, errs.Transient(err)
    case err != nil:
        return nil, errs.Internal(err)
    }
    return &u, nil
}
```

The rest of the application sees only `errs.*`. The mongo dependency is contained.

---

## Cross-Boundary Errors: HTTP, gRPC, Queues

Each protocol has its own error vocabulary. Senior engineers learn the mapping once and apply it consistently.

### HTTP

```go
func httpStatus(err error) int {
    switch {
    case err == nil:                       return 200
    case errors.Is(err, errs.ErrNotFound):    return 404
    case errors.Is(err, errs.ErrInvalid):     return 400
    case errors.Is(err, errs.ErrUnauthorized):return 401
    case errors.Is(err, errs.ErrForbidden):   return 403
    case errors.Is(err, errs.ErrConflict):    return 409
    case errors.Is(err, errs.ErrTransient):   return 503
    case errors.Is(err, errs.ErrDeadline):    return 504
    default:                                return 500
    }
}
```

The response body should be a structured error object, *not* the raw `err.Error()`:

```json
{
  "code": "user.not_found",
  "message": "User not found",
  "request_id": "req-1234"
}
```

The `code` is the API's stable error identifier; the `message` is user-facing; the `request_id` lets the user reference the failure in support.

### gRPC

gRPC has its own status codes via `google.golang.org/grpc/status` and `codes`. The mapping mirrors HTTP but with gRPC names:

```go
func grpcStatus(err error) error {
    switch {
    case err == nil:                          return nil
    case errors.Is(err, errs.ErrNotFound):       return status.Error(codes.NotFound, err.Error())
    case errors.Is(err, errs.ErrInvalid):        return status.Error(codes.InvalidArgument, err.Error())
    case errors.Is(err, errs.ErrUnauthorized):   return status.Error(codes.Unauthenticated, err.Error())
    case errors.Is(err, errs.ErrTransient):      return status.Error(codes.Unavailable, err.Error())
    default:                                   return status.Error(codes.Internal, "internal error")
    }
}
```

Note the deliberate sanitization for `Internal`: the client sees `"internal error"`, not the raw cause.

### Message queues

Queue consumers have a third axis: should I ack, nack, or send to dead-letter?

```go
err := process(msg)
switch {
case err == nil:
    msg.Ack()
case errors.Is(err, errs.ErrTransient):
    msg.Nack()  // retry
case errors.Is(err, errs.ErrInvalid):
    msg.DeadLetter()  // poison message; do not retry
default:
    msg.Nack()  // unknown errors get retried with bounded attempts
}
```

The classification (transient vs permanent) is what the kind enum is *for*.

---

## Errors and Telemetry: Logs, Metrics, Traces

Senior engineers wire errors into all three observability channels.

### Logs

One log line per error, at the boundary, with structured fields:

```go
slog.Error("request failed",
    "op",         e.Op,
    "kind",       e.Kind,
    "path",       e.Path,
    "request_id", reqID,
    "trace_id",   traceID,
    "user_id",    userID,
    "err",        e.Error(),  // full chain
)
```

The downstream log indexer can now answer: "show me all `KindTransient` errors in the last hour for user 4711." That is impossible with `log.Printf("error: %v", err)`.

### Metrics

Errors become a counter labeled by kind (and op):

```go
errCounter.With(prometheus.Labels{
    "op":   string(e.Op),
    "kind": e.Kind.String(),
}).Inc()
```

Critical: do **not** label by error message or path. Each unique label combination is a Prometheus time series; a label of free-form strings explodes cardinality.

The dashboard then plots error rate by kind, and the alert fires when `kind=transient` exceeds a budget.

### Traces

When a span fails, record the error on the span:

```go
span.RecordError(err, trace.WithStackTrace(true))
span.SetStatus(codes.Error, e.Kind.String())
```

In the trace UI, the failed span surfaces the error and links you to the structured log line via `trace_id`. One click from "request failed" to "exact code path."

---

## User-Facing Errors and Localization

Internal errors are English, structured, and developer-readable. User-facing errors are something else entirely.

### The translation pattern

```go
type APIError struct {
    Code    string `json:"code"`              // stable identifier: "user.not_found"
    Message string `json:"message"`           // localized message
    Details any    `json:"details,omitempty"` // optional structured details
    TraceID string `json:"trace_id,omitempty"`
}

func toAPIError(ctx context.Context, err error) APIError {
    var e *errs.Error
    code := "internal"
    if errors.As(err, &e) {
        code = e.Kind.APICode()
    }
    return APIError{
        Code:    code,
        Message: i18n.Translate(ctx, code),
        TraceID: trace.SpanFromContext(ctx).SpanContext().TraceID().String(),
    }
}
```

Now your translators add new locales without touching Go code; your developers add new error kinds without touching translation files until release; your users see localized messages with stable, googleable codes.

### Stable error codes are public API

Once `user.not_found` is in your API, you cannot rename it without breaking clients. Document it. Version your API with awareness of the error code surface.

---

## Evolving Error Contracts Without Breaking Callers

Error contracts evolve like any other API contract:

### Adding a new error kind

Generally safe. New kinds become observable to callers; existing handlers get a fall-through (often "internal").

But: if you have callers that match against a *closed enum* (`switch on Kind`), adding a new kind silently breaks the default case. Document the open-closed nature of your enum, or use unexported variant types so adding new kinds requires a release.

### Removing a sentinel

Always breaking. Deprecate first, remove in next major.

### Changing the message

Generally safe — messages are not contracts. *But*: if anyone tested with `strings.Contains(err.Error(), "...")`, you broke them. Mitigation: lint for that anti-pattern.

### Reordering wrap layers

Risky. `errors.Is` still finds the sentinel, but error message ordering changes; tests that check ordering break.

### Changing typed-error fields

Adding a field is safe (existing callers ignore it). Removing is breaking. Renaming is breaking.

### Strategy: deprecate before remove

```go
// Deprecated: use ErrNotFound instead.
var ErrMissing = ErrNotFound
```

Keep both for one or two release cycles, then remove. Document in release notes.

---

## Handling Class: Retryable, Permanent, Programmer

A useful classification for *every* error in your service:

| Class | Meaning | Right action |
|-------|---------|--------------|
| **Retryable (transient)** | Caller should try again with backoff. | Retry + jitter, bounded attempts. |
| **Permanent (operational)** | Caller should not retry; this will fail again. | Fail fast, surface to user. |
| **Programmer** | Bug in our code. | Panic, alert, debug. |

The kind enum should encode the class — or have a method:

```go
func (k Kind) Retryable() bool {
    switch k {
    case KindTransient, KindUnavailable, KindDeadline:
        return true
    default:
        return false
    }
}
```

Now every consumer can ask `if errs.Retryable(err) { retry() }` instead of duplicating the switch.

This decision belongs *with the error*, not at every retry call site. Centralize it; review changes carefully.

### Anti-pattern

```go
if strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), "connection") {
    retry()
}
```

Brittle, slow, and missing every error kind that does not match the substrings. Use the kind enum.

---

## Errors and Distributed Systems

In a distributed system, errors cross process boundaries. Two new concerns:

### 1. Error transmission

When you serialize an error over RPC, you cannot send a Go pointer chain. You send:
- A code (kind).
- A message.
- Optional structured details.

The receiver reconstructs an error from those fields:

```go
func fromGRPC(err error) error {
    s, ok := status.FromError(err)
    if !ok { return err }
    switch s.Code() {
    case codes.NotFound: return errs.NotFoundf("%s", s.Message())
    case codes.Unavailable: return errs.Transient(errors.New(s.Message()))
    // ...
    }
}
```

The kind survives; the chain does not. That is OK — the chain was internal anyway.

### 2. Idempotency and retries

A retried call must produce the same result as not retrying. A *non-idempotent* operation (transfer money, charge card) cannot be retried blindly. Distinguish at design time:

- **Read** operations: usually retryable.
- **Idempotent writes** (PUT with deterministic ID): retryable.
- **Non-idempotent writes** (POST creating a new ID, side-effecting external systems): *not* retryable without an idempotency key.

Encode the retryability into the *operation*, not the error. The error tells you "the call did not finish"; the operation tells you "this is safe to retry."

### 3. Circuit breakers and error propagation

When a downstream service is failing, your service should fail fast with `ErrUnavailable` rather than hammer the downstream. Circuit breakers (e.g., `sony/gobreaker`) wrap calls and produce a sentinel error when open. Translate that sentinel to your own `ErrUnavailable` at the seam — do not let `gobreaker.ErrOpenState` leak.

---

## Architectural Patterns

### Pattern: Error vocabulary package

Every service has an `internal/errs` package with kinds, sentinels, and helpers. Every other package depends on it. Single source of truth.

### Pattern: Adapter-as-translator

Every adapter (HTTP client, DB driver, queue consumer) translates external errors to `errs.*` at the boundary. The rest of the codebase sees only the internal vocabulary.

### Pattern: Boundary-only logging

A middleware logs request errors. Workers have a similar boundary recovery. Internal layers never log; they wrap.

### Pattern: Telemetry-aware errors

Errors carry enough structured data (op, kind, path) to populate a metric label and a log field without further work at the boundary. The boundary code is mechanical.

### Pattern: Code-driven user errors

User-facing messages are addressed by stable code; the message is generated from a translation table at response time. Internal errors keep English messages for logs.

### Pattern: Retry policy attached to kind

`kind.Retryable()`, `kind.MaxAttempts()`, `kind.BackoffStrategy()` — the operational class is part of the type, not duplicated at every call site.

### Pattern: Error budget integration

The kind enum maps directly to SLO categories. `KindTransient` is part of your error budget; `KindInvalid` (4xx) is *not*. Clear separation makes alerts meaningful.

---

## Reviewing Error Design in Pull Requests

A senior reviewer looks for:

1. **Shape choice.** New error path: is it sentinel, typed, or opaque? Why?
2. **Wrap content.** Does the wrap add information, or is it `"error: %w"` boilerplate?
3. **Logging.** Is this layer the boundary? If not, why is it logging?
4. **Panic vs return.** Does the panic indicate a programmer error or an operational one mistakenly escalated?
5. **Translation.** When crossing a boundary (DB → service, service → HTTP), is the error translated?
6. **Tests.** Are tests using `errors.Is`/`As`, or string matching?
7. **Comments.** Does the function document its error contract?
8. **Stability.** Does this change break any callers' `errors.Is` matches?
9. **Telemetry.** Will this error be visible in logs/metrics/traces with enough context?
10. **Consistency.** Does this match the rest of the service's error patterns?

A useful PR-template question: *"How will an operator at 3 AM identify and debug this failure mode?"* If there is no good answer, the error design is incomplete.

---

## Anti-Patterns at Scale

- **Every team invents its own vocabulary** — the org accumulates 12 incompatible `errs` packages.
- **Library errors propagated to handlers** — `mongo.ErrNoDocuments` reaches HTTP middleware and confuses everyone.
- **Stack-on-every-error** — log volume explodes; index pressure rises; nobody reads the stacks anyway.
- **Stringly-typed retries** — `if strings.Contains(err.Error(), "timeout")` everywhere; subtle bugs.
- **No structured logging** — `log.Printf("err: %v", err)` for years; impossible to query.
- **Metrics labeled by message** — Prometheus cardinality blows up; alerts fire on metric cardinality, not on errors.
- **No error budget** — every error is treated as alert-worthy; on-call burns out.
- **Two services use `ErrNotFound` to mean different things** — translation across services becomes guesswork.
- **Adding a kind silently changes retry behavior** — a downstream service starts retrying because the new kind defaulted to retryable.
- **No documented error contract** — the only way to know what `Get` returns is to read the source.

---

## Summary

At senior level, error design is no longer about whether to use `%w`. It is about how the entire system thinks about failure: a small consistent vocabulary, translated at every boundary, instrumented in logs/metrics/traces, and evolved with the same care as any other public API. Errors carry enough structured data (op, kind, path) for telemetry to consume them without further parsing. Boundaries handle them, internal layers wrap them, and a single translation table maps each kind to HTTP/gRPC/queue semantics. The discipline of doing this well separates a service that is operable from one that is not — and the operability question is what defines a senior engineer's contribution.

---

## Further Reading

- [Failure is your domain](https://middlemost.com/posts/failure-is-your-domain/) — Ben Johnson on error design at scale
- [Rob Pike — Error handling in Upspin](https://commandcenter.blogspot.com/2017/12/error-handling-in-upspin.html)
- [Google AIP-193: Errors](https://google.aip.dev/193) — Google's API error design guide
- [gRPC Error Handling](https://grpc.io/docs/guides/error/) — gRPC's official guidance
- [Rich Hickey — Simple Made Easy](https://www.infoq.com/presentations/Simple-Made-Easy/) — relevant to error vocabulary design
- [SRE Workbook — Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)
- [github.com/cockroachdb/errors](https://github.com/cockroachdb/errors) — production-grade error library
- [OpenTelemetry — Recording Errors](https://opentelemetry.io/docs/instrumentation/go/manual/#record-errors)
