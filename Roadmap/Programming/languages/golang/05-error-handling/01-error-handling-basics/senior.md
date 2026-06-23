# Error Handling Basics — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Error Architecture as a Design Decision](#error-architecture-as-a-design-decision)
3. [The Error Domain](#the-error-domain)
4. [Layered Error Strategies](#layered-error-strategies)
5. [Error Modes vs Failure Modes](#error-modes-vs-failure-modes)
6. [Designing Error APIs for Libraries](#designing-error-apis-for-libraries)
7. [The Cost of Wrapping](#the-cost-of-wrapping)
8. [Errors and Concurrency](#errors-and-concurrency)
9. [Errors and Context Cancellation](#errors-and-context-cancellation)
10. [Errors and Distributed Systems](#errors-and-distributed-systems)
11. [Telemetry: Errors as Signals](#telemetry-errors-as-signals)
12. [Error Wrapping and Information Hiding](#error-wrapping-and-information-hiding)
13. [Debugging Production Errors](#debugging-production-errors)
14. [Architecture Patterns](#architecture-patterns)
15. [Anti-Patterns at Scale](#anti-patterns-at-scale)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction
> Focus: "How to optimize?" and "How to architect?"

At senior level, error handling is no longer a per-function concern. It is a **system property**. You design how errors flow across packages, services, layers, retries, and humans. The decisions you make at this level affect availability, debuggability, and the on-call rotation's quality of life.

This file is about the *architecture* of error handling. Not the keystrokes — those are second nature now — but the strategy.

---

## Error Architecture as a Design Decision

A senior engineer answers four questions for every system they build:

1. **What can fail?** — Enumerate failure modes. Disk full, network partition, malformed input, dependency timeout, race condition, OOM.
2. **Who handles each failure?** — A cache miss is recovered locally; a database outage propagates to the caller; OOM crashes the process.
3. **What does the user see?** — 4xx vs 5xx vs retry vs degraded UI vs nothing.
4. **What does the operator see?** — A log line with full detail, a metric that fires, a trace span tagged as error.

Most systems have an *implicit* answer to these questions, and that implicit answer is usually wrong: "we wrap with `%w` and return up." That works until the system hits 99.9% availability and you start hunting milliseconds.

A senior engineer makes the answer **explicit**.

---

## The Error Domain

Define a small, intentional set of *kinds* of errors that your system recognizes. Examples:

```go
var (
    ErrNotFound        = errors.New("not found")
    ErrConflict        = errors.New("conflict")
    ErrInvalidInput    = errors.New("invalid input")
    ErrUnauthorized    = errors.New("unauthorized")
    ErrRateLimited     = errors.New("rate limited")
    ErrUpstreamFailure = errors.New("upstream failure")
    ErrInternal        = errors.New("internal")
)
```

Each *kind* maps to:
- An HTTP status code (404, 409, 400, 401, 429, 502, 500).
- A retry policy (no, no, no, no, yes-with-backoff, yes, no).
- A user-facing message ("not found", "already exists", input details, "log in", "slow down", "try again", "we are looking into it").
- A monitoring rule (which of these warrant alerting?).

Without this domain you have a thousand unique strings each meaning roughly the same thing, and your handlers turn into walls of `strings.Contains`.

**With** it, you write:

```go
switch {
case errors.Is(err, ErrNotFound):
    return 404
case errors.Is(err, ErrInvalidInput):
    return 400
default:
    return 500
}
```

And every layer of the system speaks the same vocabulary.

---

## Layered Error Strategies

A typical Go service has four layers and four error strategies:

| Layer | Strategy |
|-------|----------|
| **Storage** (DB, cache, fs) | Translate driver-specific errors into the domain (`sql.ErrNoRows` → `ErrNotFound`). |
| **Domain** (business logic) | Use only domain errors. Never expose `sql.*` upward. |
| **Transport** (HTTP/gRPC handlers) | Translate domain errors into protocol responses. |
| **Edge** (CDN, gateway, client) | Surface a *small* set of statuses and messages. Hide internals. |

This is **error translation as a layer responsibility**. Each layer takes errors from the layer below and re-expresses them in its own dialect.

Why? Because tomorrow you might swap PostgreSQL for MongoDB. The domain code should not change. The translation layer changes — and that's it.

---

## Error Modes vs Failure Modes

Subtle but important distinction:

- An **error mode** is something the function explicitly returns: parse failed, not found.
- A **failure mode** is what *happens to the system* when that error occurs at runtime: latency spike, retry storm, alert fires, on-call paged.

You design error modes; failure modes happen to you. Bad error handling is the bridge:

| Error mode | Bad failure mode |
|------------|------------------|
| Database timeout | Caller retries, retries pile up, DB gets DDoS'd by its own clients. |
| Validation error | Caller logs at ERROR level, log volume explodes, log infra falls over. |
| Conflict (409) | Caller treats as transient, retries forever, livelock. |
| Not found | Caller proceeds with nil, panics later in a deeply nested call. |

A senior engineer designs error handling to *prevent* the failure modes, not just to communicate the error mode. Circuit breakers, exponential backoff, log sampling, retry budgets — these are the tools.

---

## Designing Error APIs for Libraries

If you publish a library, your error values are part of your **API contract**. Renaming or repurposing them is a breaking change. Three solid patterns:

### Pattern 1: Sentinel + Is

```go
package fs

var ErrNotExist = errors.New("file does not exist")

func Open(path string) (*File, error) {
    // ...
    if !exists(path) {
        return nil, fmt.Errorf("open %q: %w", path, ErrNotExist)
    }
    // ...
}
```

Callers use `errors.Is(err, fs.ErrNotExist)`. Wrapping with `%w` lets you add context without breaking the sentinel check.

### Pattern 2: Typed errors + As

```go
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s: %s", e.Field, e.Message)
}
```

Callers use `errors.As(err, &ve)` to extract structured data. Use this when callers need *fields*, not just identity.

### Pattern 3: Errors as enum (kind)

```go
type Kind int

const (
    KindNotFound Kind = iota + 1
    KindConflict
    KindInvalid
)

type Error struct {
    Kind    Kind
    Op      string  // operation
    Path    string
    Err     error
}
```

Used by the standard library (`fs.PathError`, `net.OpError`, `*os.LinkError`). One struct, many kinds.

**Rule**: pick *one* of these and stick with it inside a package. Mixing them confuses callers.

---

## The Cost of Wrapping

Each `fmt.Errorf("%w: %v", ...)` call:
- Allocates a `*fmt.wrapError` struct (24 bytes).
- Walks the format string once.
- Stores the wrapped error pointer.
- Costs roughly 100-200 ns on modern hardware.

In a steady-state web service this is invisible. In a hot loop processing a million events per second, it can be the difference between meeting and missing latency targets. Two mitigations:

- **Pre-allocate sentinels** at package level — they cost nothing per call.
- **Wrap at boundaries**, not inside loops — wrap once at the top of the operation, not on every iteration.

Profile before optimizing. Wrapping is rarely the dominant cost.

---

## Errors and Concurrency

Errors and goroutines have a natural friction: a goroutine that returns nothing has nowhere to put its error. Three patterns:

### Pattern 1: Channel of errors

```go
errCh := make(chan error, len(jobs))
for _, j := range jobs {
    go func(j Job) { errCh <- process(j) }(j)
}
var firstErr error
for range jobs {
    if err := <-errCh; err != nil && firstErr == nil {
        firstErr = err
    }
}
```

### Pattern 2: `errgroup`

```go
g, ctx := errgroup.WithContext(ctx)
for _, j := range jobs {
    j := j
    g.Go(func() error { return process(ctx, j) })
}
if err := g.Wait(); err != nil {
    return err
}
```

`golang.org/x/sync/errgroup` cancels the shared context on the first error. Standard practice for fan-out work.

### Pattern 3: Aggregate with `errors.Join`

```go
var errs []error
var mu sync.Mutex
var wg sync.WaitGroup
for _, j := range jobs {
    wg.Add(1)
    go func(j Job) {
        defer wg.Done()
        if err := process(j); err != nil {
            mu.Lock()
            errs = append(errs, err)
            mu.Unlock()
        }
    }(j)
}
wg.Wait()
if err := errors.Join(errs...); err != nil {
    return err
}
```

Use when you want *all* failures, not just the first.

---

## Errors and Context Cancellation

Two specific errors deserve named handling:

```go
context.Canceled        // cancel was called
context.DeadlineExceeded // timeout fired
```

Whenever a long operation runs under a `context.Context`, it must:
1. Stop early when the context is done.
2. Return `ctx.Err()` (or wrap it).
3. *Not* be confused with a "real" failure — context cancellation is an *expected* outcome, not an alert-worthy one.

```go
select {
case <-ctx.Done():
    return ctx.Err()
case result := <-resultCh:
    return process(result)
}
```

Best practice: at the top of any handler, check `errors.Is(err, context.Canceled)` and treat it as success-equivalent for monitoring. Otherwise every user closing their browser tab pages your on-call.

---

## Errors and Distributed Systems

Network calls return many errors that look the same but mean very different things:

| Error | Retry? | User impact |
|-------|--------|-------------|
| Connection refused (cold start) | Yes | None |
| 503 Service Unavailable | Yes (with backoff) | Maybe |
| 429 Too Many Requests | Yes (longer backoff) | Throttle |
| 504 Gateway Timeout | Yes (idempotent only) | Elevated latency |
| 500 Internal Server Error | No (often non-idempotent) | Reflect to user |
| Connection reset mid-request | Yes (idempotent only) | Possible duplicate |
| TLS handshake failure | No (config issue) | Outage |

A retry helper that does not distinguish these will either retry forever (livelock) or never retry (poor availability). Senior engineers encode the distinction:

```go
type retryable interface {
    Retryable() bool
}

func shouldRetry(err error) bool {
    var r retryable
    if errors.As(err, &r) {
        return r.Retryable()
    }
    return errors.Is(err, ErrUpstreamFailure) || isTimeout(err)
}
```

---

## Telemetry: Errors as Signals

An error's lifecycle in production is more than its return:

1. **Error happens** — function returns it.
2. **Error is observed** — some code calls `.Error()` for the first time, often the logger.
3. **Error is recorded** — log line written, metric incremented, trace span tagged.
4. **Error is alerted on** — SLO burn rate, error budget, threshold rules.

Senior systems wire these explicitly:
- Each domain error has a metric label.
- Each unhandled error is logged once at the boundary.
- Traces tag the error span with `otel.RecordError(err)`.
- Alert thresholds are tied to *kinds* (e.g., 5xx rate > X), not raw counts.

---

## Error Wrapping and Information Hiding

Wrapping leaks. `fmt.Errorf("query users: %w", err)` exposes `err.Error()` if anyone calls `.Error()` on the result. If `err` is `pq: relation "users" does not exist`, that string now reaches whoever calls `.Error()`. If that "whoever" is the HTTP response, you just leaked your schema.

Two strategies:

### Strategy A: Always log, never expose

```go
func handler(w http.ResponseWriter, r *http.Request) {
    if err := s.do(r); err != nil {
        log.Printf("internal: %v", err)
        http.Error(w, "internal error", 500)
    }
}
```

The log gets full detail; the user gets a bland message.

### Strategy B: Tagged errors

```go
type publicError struct{ msg string; cause error }
func (e *publicError) Error() string { return e.msg }
func (e *publicError) Unwrap() error { return e.cause }
```

`Error()` returns only the safe part. Internal `Unwrap()` exposes the rest for logging.

---

## Debugging Production Errors

A production error log line should answer five questions:

1. **What** — the error message.
2. **Where** — the operation, often via wrapping context.
3. **When** — timestamp.
4. **Who** — the request ID, user ID, trace ID.
5. **Why** — the chain of causes (unwrapped).

Tools:
- **`fmt.Errorf("op: %w", err)`** — chain of causes.
- **Structured logging** (`slog`, `zap`, `logrus`) — stable fields.
- **Trace IDs** in every log line — to correlate.
- **`runtime/debug.Stack()`** — for diagnostic situations only, not normal errors.

---

## Architecture Patterns

### Pattern: Error boundary

A single layer translates *all* errors into the protocol response. Inside the boundary, errors flow naturally; outside, only sanitized data.

### Pattern: Result envelope

Wrap every domain operation in a result type that carries *(value, error, metadata)*. Useful for APIs that need correlation IDs, retry hints, etc.

### Pattern: Saga / compensation

In a multi-step transaction, an error at step N triggers compensating actions for steps 1..N-1. Errors are inputs to the rollback engine, not just diagnostics.

### Pattern: Dead-letter queue

Errors during async processing get the message moved to a DLQ for later inspection, instead of retrying forever.

---

## Anti-Patterns at Scale

- **Generic `errors.New("error")`** — useless when 200 of these come from 200 callers.
- **`if err != nil { return err }` *only*** — no context, no kind, no telemetry. Errors arrive at the top with one-word messages.
- **Sentinel addiction** — defining 200 sentinels with no semantic grouping. Use kinds (a small enum) instead.
- **String matching on error messages** — fragile, breaks on locale/version.
- **Logging on every layer** — log amplification. Log once at the boundary.
- **Conflating timeout with failure** — context cancellation is not an outage; do not page on it.

---

## Summary

At senior level, error handling becomes a system design discipline. You define an error domain, layer translation strategies, separate error modes from failure modes, integrate with telemetry, and design for distributed-system realities. The senior question is not "did I check the error?" but "does my service degrade gracefully when this entire class of errors becomes common?"

---

## Further Reading

- [Working with Errors in Go 1.13 (golang.org/blog)](https://go.dev/blog/go1.13-errors)
- [Stamping Out Errors in Go (Cockroach Labs)](https://www.cockroachlabs.com/blog/error-handling-and-go/)
- [Don't just check errors, handle them gracefully (Dave Cheney)](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- [Designing Errors as Values (Upspin design)](https://commandcenter.blogspot.com/2017/12/error-handling-in-upspin.html)
- [Google SRE Book — Handling Overload](https://sre.google/sre-book/handling-overload/)
