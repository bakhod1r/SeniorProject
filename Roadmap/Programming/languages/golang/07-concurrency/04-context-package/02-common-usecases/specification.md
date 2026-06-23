# Common Usecases — Specification

[← Back to index](junior.md)

This document specifies the formal rules around the *application* of `context.Context`: value lookup semantics, request-scoped data conventions, and the cross-process propagation contract.

## 1. Request-Scoped Value Contract

### 1.1 Definition of "Request-Scoped"

A value is **request-scoped** if all of:

- It is associated with the lifetime of a single logical request, RPC, message, or job.
- It is read-only after the request enters the application.
- Its absence does not prevent the function from running (it may degrade observability, not correctness).

Examples that qualify: trace ID, request ID, authenticated principal, tenant identifier, span handle, request-scoped logger.

Examples that do not qualify: `*sql.DB`, `*http.Client`, configuration values, feature flags, mutable state.

### 1.2 Value Lookup Semantics

```go
func (c Context) Value(key any) any
```

Behavior:

1. Lookup walks the context chain from leaf to root.
2. The first match (deepest in the chain) is returned.
3. If no ancestor stored the key, returns `nil`.
4. Equality is determined by `==` on `key`. For non-comparable keys, behavior is undefined; the standard `WithValue` panics if the key is not comparable.

### 1.3 Key Type Requirements

- Keys must be comparable (`==`-compatible).
- Keys should not be a basic type (`string`, `int`); doing so risks collision across packages.
- The recommended pattern is an unexported empty struct type per logical key:

  ```go
  type traceIDKey struct{}
  ```

- Implementations must give different identity to keys whose types differ, even if their string representations match.

### 1.4 Setter and Getter Convention

Each package owning a key MUST expose:

```go
func WithFoo(ctx context.Context, v Foo) context.Context
func FooFrom(ctx context.Context) (Foo, bool)
```

The getter:

- Performs a single `ctx.Value(fooKey{})` call.
- Type-asserts with the `, ok` form.
- Returns `(zero, false)` on absence.
- Does not panic.

The setter:

- Accepts a context, returns a new context.
- Does not mutate or store its arguments after return.

### 1.5 Type Assertion Discipline

A getter MUST type-assert with comma-ok:

```go
v, ok := ctx.Value(key).(Foo)
```

A type assertion that panics (`ctx.Value(key).(Foo)` without `ok`) is non-conforming and a defect.

## 2. Propagation Rules

### 2.1 Inbound HTTP

A handler receives `r.Context()` whose lifetime is bound to the request:

- `Done()` closes when the client disconnects, the handler returns, or `srv.Shutdown` proceeds past its grace period.
- `Deadline()` returns the deadline imposed by `http.TimeoutHandler` or any middleware that derived `WithTimeout`. The base `r.Context()` from the HTTP server itself has no deadline unless one is configured.
- `Value(key)` returns values added by middleware in the request handling chain.

### 2.2 Outbound HTTP

A request constructed via `http.NewRequestWithContext(ctx, ...)`:

- MUST honor `ctx`'s deadline by terminating dial/read/write operations when `ctx.Done()` closes.
- MUST return an error wrapping `ctx.Err()` if `ctx` is canceled before the response body has been read.
- MAY include implementation-dependent details in the error chain (e.g. `*url.Error`).

### 2.3 gRPC Deadline Propagation

A gRPC call from client `ctx` with deadline `d`:

- MUST encode `d - now` in the `grpc-timeout` header on the outgoing HTTP/2 frames.
- The receiving server MUST construct a server-side `ctx` with deadline `now + grpc-timeout`.
- If `grpc-timeout` is absent, the server-side ctx has no deadline (server may impose one of its own).
- If the server-side ctx expires, the server MUST return `codes.DeadlineExceeded` to the client.

### 2.4 Database Driver Cancellation

A `database/sql` driver receiving a context-aware call:

- MUST observe `ctx.Done()` and abort the operation when it closes.
- MUST return an error wrapping `ctx.Err()` for canceled or timed-out operations.
- SHOULD send the underlying database a cancellation signal (e.g. Postgres `pg_cancel_backend`, MySQL `KILL QUERY`).
- MAY return its own error type wrapping `ctx.Err()`; callers should use `errors.Is(err, context.Canceled)` for detection.

### 2.5 Worker Goroutines

A goroutine that receives a context as a parameter:

- MUST not call `context.Background()` to substitute when ctx is non-nil.
- SHOULD select on `ctx.Done()` at every blocking point.
- MUST terminate within a "reasonable" time after `ctx.Done()` closes (usually one iteration of its main loop).
- SHOULD propagate ctx unchanged to any sub-call that accepts a context.

## 3. Anti-Patterns (Documented)

The following are explicitly disallowed by the standard library documentation or Go community consensus:

| Anti-pattern | Reason | Documented in |
|--------------|--------|---------------|
| Storing `context.Context` in a struct field | Lifetime confusion, defeats per-request scoping | `context` package docs |
| Passing `nil` as a `Context` argument | Panic-prone, ambiguous; pass `context.TODO` instead | `context` package docs |
| Using `WithValue` for optional function arguments | Breaks visibility, hides API surface | `context` package docs |
| Using basic types as `WithValue` keys | Cross-package key collision | `context` package docs |
| Using `context.Background` inside an HTTP handler | Detaches from request lifetime | community consensus |
| Discarding the cancel function from `WithCancel`/`WithTimeout`/`WithDeadline` | Resource and goroutine leaks; caught by `go vet -lostcancel` | `context` package docs |
| Reading a `Done` channel value (assuming a payload) | `Done` closes; reading returns zero value `struct{}{}` | `context` package docs |

## 4. Server Shutdown Contract

`http.Server.Shutdown(ctx)`:

- Returns `nil` if all active connections drained before `ctx` expired.
- Returns `ctx.Err()` if `ctx` was canceled before drain completed; in this case, in-flight connections are force-closed.
- After Shutdown returns, `ListenAndServe`/`Serve` MUST return `http.ErrServerClosed`.
- Shutdown MUST NOT be called concurrently with itself; behavior is undefined.

## 5. Combining Contexts

Go does not provide a `Merge` or `Either` function for combining contexts. Implementations of "cancel on either parent" MUST:

- Construct a new cancelable context from one parent.
- Spawn at most one auxiliary goroutine that observes both parents and triggers cancel.
- Return a `CancelFunc` that, when called, both cancels the new context and stops the auxiliary goroutine.

A correct implementation MUST NOT leak the auxiliary goroutine when the cancel function is called.

## 6. Test Context Contract (Go 1.24+)

`testing.T.Context()` returns a context with these properties:

- Has no deadline (callers may layer `WithTimeout` on top).
- Has no values (callers may layer `WithValue` on top).
- Is canceled at test cleanup time, after all `t.Cleanup` functions registered before the cancellation point have run.
- Returns the same instance on repeated calls within a single test.
- Each `t.Run(...)` subtest receives a fresh `Context`.

## 7. OpenTelemetry Propagation Contract

OpenTelemetry's `propagation.TextMapPropagator`:

- `Inject(ctx, carrier)` MUST be idempotent for a given `ctx` and produce identical headers on repeated invocation.
- `Extract(ctx, carrier)` MUST return a context whose span context, if extracted, equals the `traceparent` header (per W3C Trace Context spec).
- Non-OTel-aware downstream MUST forward `traceparent` and `tracestate` headers verbatim to preserve traces.

## 8. Cancel Function Discipline

For every `WithCancel`, `WithTimeout`, `WithDeadline`, or `WithCancelCause`:

- The returned `cancel` MUST be called in every code path, ideally via `defer`.
- Calling `cancel` multiple times MUST be safe and idempotent.
- Calling `cancel` after the parent has already been canceled MUST be safe.
- The first call to `cancel` MUST set the context's `Err` if not already set.

## 9. Context Across Goroutines

When passing a context across a goroutine boundary:

- The goroutine MUST treat the context as live for the duration it operates.
- The caller MAY assume the goroutine respects cancellation.
- The goroutine SHOULD NOT outlive the context unless it derives a new context (e.g. `context.WithoutCancel`).
- Any stored reference to the parent context inside the goroutine MUST NOT escape via published struct fields, channels carrying long-lived data, or globals.

## 10. Idempotency Key Contract (Common Pattern)

When using a context value to carry an idempotency key:

- The key MUST be set by an HTTP middleware or RPC interceptor, not by application code.
- The setter MUST validate the key (length, charset) before storing.
- Downstream code MUST treat the key as immutable.
- The key MUST be propagated to any retried call so deduplication is correct.

## 11. Logger-In-Context Contract

A request-scoped logger placed in context:

- MUST be safe for concurrent use.
- MUST NOT include unbounded mutable state (e.g. growing list of attributes per-request).
- MAY be derived from a base logger with request-scoped attributes attached at request entry.
- Getter SHOULD return a sane default (e.g. `slog.Default()`) when no logger is in context, to avoid nil checks at every call site.

## 12. Audit and Background Work

A goroutine that performs work after a request returns:

- MUST be started with a context that is NOT the request's context.
- The recommended source is `context.WithoutCancel(r.Context())` (Go 1.21+) or `context.Background()` with re-attached values.
- MUST have its own deadline appropriate for the background task.
- SHOULD record errors to a durable store (logs, metrics, queue), not return them to a caller.

## 13. Conformance Checklist

A library or service that handles `context.Context` correctly satisfies all of:

- [ ] Every public function that performs I/O takes `ctx context.Context` as first parameter.
- [ ] Internal helpers preserve ctx propagation; no `context.Background()` substitution mid-stream.
- [ ] Every `Value` key is an unexported type, not a string or int.
- [ ] Every getter type-asserts with comma-ok.
- [ ] Every cancel function is called via defer or explicit call on every code path.
- [ ] Background goroutines spawned from request handlers detach the context.
- [ ] Server shutdown drains in-flight requests before exiting.
- [ ] gRPC and HTTP middleware extract incoming metadata into typed ctx values.
- [ ] Tests use `t.Context()` (Go 1.24+) or `context.WithTimeout(context.Background(), ...)`.

## 14. Versioning Note

The behaviors above reflect Go 1.24+. Notable evolution:

| Version | Addition |
|---------|----------|
| Go 1.7 | `context` package promoted to stdlib |
| Go 1.8 | `database/sql` context-aware methods |
| Go 1.13 | `http.NewRequestWithContext` |
| Go 1.16 | `signal.NotifyContext` |
| Go 1.20 | `context.WithCancelCause`, `context.AfterFunc`, `context.Cause` |
| Go 1.21 | `context.WithoutCancel`, `context.WithDeadlineCause`, `context.WithTimeoutCause` |
| Go 1.24 | `testing.T.Context`, `testing.B.Context` |

Code targeting older Go versions must polyfill or omit the corresponding patterns.

[← Back to index](junior.md)
