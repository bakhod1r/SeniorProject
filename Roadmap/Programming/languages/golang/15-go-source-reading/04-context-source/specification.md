# `context` Package — Specification

## 1. Introduction

The `context` package defines the `Context` type, which carries deadlines, cancellation signals, and other request-scoped values across API boundaries and between processes. It is part of the Go standard library and, as such, is governed by the **Go 1 compatibility promise** ([https://go.dev/doc/go1compat](https://go.dev/doc/go1compat)): the exported `Context` interface, the four constructors that existed in Go 1.7, the sentinel errors, and the documented semantics of `Done`, `Err`, `Deadline`, and `Value` will not change in any Go 1.x release.

There is no separate "context specification" document. The behavior of the package is defined by:

| Source | Role |
|---|---|
| [`src/context/context.go`](https://github.com/golang/go/blob/master/src/context/context.go) | The implementation; package doc comment is the normative reference. |
| [`pkg.go.dev/context`](https://pkg.go.dev/context) | Rendered documentation, same text as the source. |
| [Go 1 compatibility promise](https://go.dev/doc/go1compat) | Stability guarantee for the exported surface. |
| [Go memory model](https://go.dev/ref/mem) | Defines what synchronization the package establishes. |

The package is intentionally minimal: one interface, two root constructors, four derivation constructors (plus `WithCancelCause`, `WithoutCancel`, `AfterFunc` added in Go 1.21), and two sentinel errors. Everything else is convention, enforced only by `go vet` checks and code review.

This document describes the package as it exists in Go 1.22, with notes on when each piece was added.

---

## 2. History

The `Context` type predates the Go standard library. It was introduced as `golang.org/x/net/context` by Sameer Ajmani in 2014, accompanying the blog post ["Go Concurrency Patterns: Context"](https://go.dev/blog/context). Inside Google, an equivalent type had been used for years to plumb cancellation and deadlines through RPC stacks; the open-source version was a generalization of that pattern.

| Version | Date | Change |
|---|---|---|
| `x/net/context` | 2014-07 | First public release outside `golang.org/x` is not — package introduced under `golang.org/x/net`. |
| Go 1.7 | 2016-08-15 | `context` promoted into the standard library; `net/http` gained `Request.Context()` and `Request.WithContext`. |
| Go 1.7 | 2016-08-15 | `net.Dialer.DialContext`, `os/exec.CommandContext` added in the same release. |
| Go 1.8 | 2017-02-16 | `database/sql` gained `*Context` variants (`QueryContext`, `ExecContext`, `BeginTx`, etc.). |
| Go 1.13 | 2019-09-03 | Error wrapping (`errors.Is`, `errors.As`) lands; `context.Canceled` and `context.DeadlineExceeded` become comparable via `errors.Is`. |
| Go 1.20 | 2023-02-01 | `Cause(ctx)` introduced. |
| Go 1.21 | 2023-08-08 | `WithCancelCause`, `WithDeadlineCause`, `WithTimeoutCause`, `WithoutCancel`, `AfterFunc` added. |
| Go 1.22 | 2024-02-06 | Documentation cleanups; no API additions. |

The `x/net/context` package still exists as a thin alias forwarding to `context`, kept for the benefit of code that must compile against pre-1.7 Go (a rapidly shrinking set).

The original blog post and the Go 1.7 release notes ([https://go.dev/doc/go1.7#context](https://go.dev/doc/go1.7#context)) remain the canonical historical references.

---

## 3. The `Context` Interface Contract

The exported interface is four methods:

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

Each method has documented semantics that any custom implementation must obey.

### 3.1 `Deadline() (time.Time, bool)`

Returns the time at which work done on behalf of this context should be canceled. If `ok == false`, no deadline is set. Successive calls return the same values.

### 3.2 `Done() <-chan struct{}`

Returns a channel that is **closed** when work done on behalf of this context should be canceled. May return `nil` if the context can never be canceled (e.g., `context.Background()`). Successive calls return the same channel.

The channel is closed — not sent to. Multiple receivers will all unblock. This is the standard Go idiom for broadcasting cancellation.

### 3.3 `Err() error`

| Return value | Meaning |
|---|---|
| `nil` | `Done()` is not yet closed. |
| `context.Canceled` | Context was canceled via the `CancelFunc` returned by `WithCancel` (or transitively via a parent). |
| `context.DeadlineExceeded` | Context's deadline elapsed. |
| Other error | Custom contexts may return other errors after `Done` is closed, but standard library contexts return only the two above. |

After `Done()` is closed, `Err()` must return a non-nil error. Successive calls return the same error.

### 3.4 `Value(key any) any`

Returns the value associated with `key` in this context, or `nil` if none. Walks the parent chain. Keys should be of an unexported type to avoid collisions; the package doc explicitly recommends `type myKey struct{}`.

`Value` is for **request-scoped data that transits process or API boundaries**, not for passing optional parameters to functions. The doc is unambiguous on this point.

---

## 4. The Go Memory Model and Context

Context cancellation is a **synchronization event** under the [Go memory model](https://go.dev/ref/mem).

The closing of a channel is documented in the memory model:

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

Concretely: if goroutine A calls `cancel()`, and goroutine B has been blocked on `<-ctx.Done()`, then every write performed by A before calling `cancel()` is observed by B after `<-ctx.Done()` returns. This means cancellation can be used not only as a signal but as a release fence for cleanup data, though in practice `context` is rarely used this way.

For `WithValue`, no synchronization is established — values are set once at construction time and read-only thereafter. The values themselves must be safe for concurrent use; the context does not synchronize access to them.

---

## 5. Public API

### 5.1 Root Contexts

| Function | Returns | Use |
|---|---|---|
| `context.Background()` | Non-nil empty context. Never canceled, no deadline, no values. | Top of `main`, init, tests; the root of every context tree. |
| `context.TODO()` | Same as `Background`, distinguished only by name. | Placeholder when a function should accept a context but the caller has not yet been refactored to pass one. `go vet` and static analyzers flag `TODO` to make tracking easier. |

Both return the same internal type (`emptyCtx`); the distinction is purely documentary.

### 5.2 Derivation Constructors

| Function | Signature | Added | Behavior |
|---|---|---|---|
| `WithCancel` | `func(parent Context) (Context, CancelFunc)` | 1.7 | New context, canceled when `CancelFunc` is called or parent is canceled. |
| `WithCancelCause` | `func(parent Context) (Context, CancelCauseFunc)` | 1.21 | Like `WithCancel` but `CancelCauseFunc(err error)` records `err` as the cause, retrievable via `Cause(ctx)`. |
| `WithDeadline` | `func(parent Context, d time.Time) (Context, CancelFunc)` | 1.7 | Canceled at `d` or when `CancelFunc` is called or parent is canceled. |
| `WithDeadlineCause` | `func(parent Context, d time.Time, cause error) (Context, CancelFunc)` | 1.21 | Variant that records a cause on deadline expiry. |
| `WithTimeout` | `func(parent Context, timeout time.Duration) (Context, CancelFunc)` | 1.7 | Convenience for `WithDeadline(parent, time.Now().Add(timeout))`. |
| `WithTimeoutCause` | `func(parent Context, timeout time.Duration, cause error) (Context, CancelFunc)` | 1.21 | Cause-aware variant. |
| `WithValue` | `func(parent Context, key, val any) Context` | 1.7 | Returns a context whose `Value(key)` returns `val`. Keys should be unexported types. |
| `WithoutCancel` | `func(parent Context) Context` | 1.21 | Returns a context that is **never canceled** but carries the values of `parent`. Useful for spawning background work whose lifetime must outlive the request. |

### 5.3 `AfterFunc` (Go 1.21+)

```go
func AfterFunc(ctx Context, f func()) (stop func() bool)
```

Registers `f` to run in its own goroutine after `ctx` is canceled (whether by deadline, explicit cancel, or parent cancellation). The returned `stop` deregisters the call; it returns true if `f` had not yet been started. Multiple `AfterFunc` calls on the same context are independent.

This is a structured replacement for the common pattern:

```go
go func() { <-ctx.Done(); cleanup() }()
```

— but with the ability to cancel registration cleanly and without leaking the goroutine if `f` runs synchronously after registration.

### 5.4 `Cause` (Go 1.20+)

```go
func Cause(c Context) error
```

Returns the underlying cause of cancellation:

| State | `Cause(ctx)` returns |
|---|---|
| Not canceled | `nil` |
| Canceled via `WithCancel` (no cause) | `context.Canceled` |
| Canceled via `WithCancelCause(parent)` then `cancel(myErr)` | `myErr` |
| Deadline exceeded, no cause set | `context.DeadlineExceeded` |
| `WithDeadlineCause` deadline exceeded with cause `myErr` | `myErr` |

`Err()` still returns the canonical `Canceled` or `DeadlineExceeded` regardless of cause, preserving backward compatibility with code that switches on `ctx.Err()`.

### 5.5 `CancelFunc` and `CancelCauseFunc`

```go
type CancelFunc func()
type CancelCauseFunc func(cause error)
```

Calling a `CancelFunc` multiple times is a no-op after the first call. `go vet`'s `lostcancel` analyzer flags any code path where a `CancelFunc` returned from `WithCancel`/`WithDeadline`/`WithTimeout` is not called on all paths — failing to call it leaks the parent's child slice entry and any deadline timer.

---

## 6. Sentinel Errors

Only two errors are exported:

| Error | Defined as | Returned by `Err()` when |
|---|---|---|
| `context.Canceled` | `errors.New("context canceled")` | Context was canceled (explicitly or transitively). |
| `context.DeadlineExceeded` | A package-private type implementing `error`, `Timeout() bool`, and `Temporary() bool`. | Context's deadline passed. |

`DeadlineExceeded` satisfies the `net.Error` interface (with `Timeout() == true`), which is why `net/http` and `database/sql` callers can use `errors.Is(err, context.DeadlineExceeded)` to distinguish a context timeout from a transport-level error.

The package documentation calls these "the four canonical errors" historically because earlier drafts considered separate cancellation-source errors; the final design collapsed them to two.

---

## 7. Recommended Patterns (from the Package Documentation)

The package documentation enumerates conventions that are not enforced by the compiler but are enforced by community practice, `go vet`, and `staticcheck`.

### 7.1 Context Is the First Parameter

```go
func DoRequest(ctx context.Context, req *Request) (*Response, error)
```

Always first, always named `ctx`. The `contextcheck` linter and `staticcheck`'s `SA1029` flag deviations.

### 7.2 Do Not Store Context in a Struct

```go
// BAD
type Server struct { ctx context.Context }
```

Contexts are per-call; storing one in a struct means every method implicitly uses the lifetime of whichever caller happened to construct the struct. The exception is types that genuinely model a single long-lived operation (e.g., a streaming RPC handle), and even then the field should be documented.

### 7.3 Pass Context to All Blocking I/O

Any function that may block on I/O, time, or another goroutine should accept a context as its first argument. This includes:

- Network reads and writes
- Database queries
- File reads on slow media
- Channel sends/receives that may block
- Any `time.Sleep`-equivalent loop

### 7.4 Key Types Must Be Unexported

```go
type userIDKey struct{}

func WithUserID(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, userIDKey{}, id)
}

func UserID(ctx context.Context) (string, bool) {
    id, ok := ctx.Value(userIDKey{}).(string)
    return id, ok
}
```

Using an unexported zero-size struct type as the key guarantees no other package can collide. `staticcheck`'s `SA1029` flags `WithValue` calls using built-in types as keys.

---

## 8. Stdlib Integration

Context is plumbed through the I/O-facing parts of the standard library.

| Package | Entry point | Behavior on cancel |
|---|---|---|
| `net/http` | `(*Request).Context()`, `(*Request).WithContext`, `(*http.Client).Do` | Closes the body, aborts the round trip, returns the context error wrapped in `*url.Error`. |
| `net/http` server-side | Handler's request context is canceled when the client closes the connection or the server shuts down. | `http.ErrAbortHandler`-style cleanup. |
| `net` | `(*net.Dialer).DialContext`, `(*net.Resolver).LookupHost` | Aborts the dial / lookup. |
| `database/sql` | `QueryContext`, `ExecContext`, `BeginTx`, `PingContext`, `Conn.Raw` | Cancellation sent to the driver via `driver.QueryerContext` / `driver.ExecerContext`. Underlying connection may be marked bad and recycled. |
| `os/exec` | `CommandContext` | Sends `SIGKILL` to the process when the context is canceled (configurable via `Cancel` field, Go 1.20+). |
| `crypto/tls` | `(*Dialer).DialContext` | Aborts handshake. |

The pattern is consistent: methods that take a context have a `Context` suffix when a non-context variant also exists for backward compatibility (`Query` / `QueryContext`), and the context check is the **first** thing the implementation does in the I/O loop.

---

## 9. Source File Map

The package is one of the smallest in the standard library.

| File | Lines (approx, Go 1.22) | Contents |
|---|---|---|
| [`src/context/context.go`](https://github.com/golang/go/blob/master/src/context/context.go) | ~870 | Entire implementation: `Context` interface, `emptyCtx`, `cancelCtx`, `timerCtx`, `valueCtx`, `withoutCancelCtx`, `afterFuncCtx`, all public functions, `Canceled`, `DeadlineExceeded`. |
| [`src/context/context_test.go`](https://github.com/golang/go/blob/master/src/context/context_test.go) | ~1100 | Black-box tests covering every constructor, parent/child propagation, deadline accuracy, value lookup, `WithCancelCause`, `AfterFunc`, race-free behavior. |
| [`src/context/x_test.go`](https://github.com/golang/go/blob/master/src/context/x_test.go) | ~200 | External tests that import other stdlib packages (e.g., `net/http`) without import cycles. |
| [`src/context/benchmark_test.go`](https://github.com/golang/go/blob/master/src/context/benchmark_test.go) | ~150 | Benchmarks for `Background`, `WithCancel`, `WithValue`, and the cancel propagation path. |
| [`src/context/example_test.go`](https://github.com/golang/go/blob/master/src/context/example_test.go) | ~250 | Runnable examples that appear in the godoc output. |

There is no internal subpackage. The deepest types (`cancelCtx`, `timerCtx`) are unexported but documented inline; their fields are stable in practice but not part of the API.

---

## 10. Notable Proposals

The package has accreted features through the [Go proposal process](https://github.com/golang/proposal).

| Proposal | Title | Outcome |
|---|---|---|
| [#51365](https://github.com/golang/go/issues/51365) | `context: add WithCancelCause` | Accepted, shipped in Go 1.20 (`Cause`) and Go 1.21 (`WithCancelCause`, `WithDeadlineCause`, `WithTimeoutCause`). |
| [#57928](https://github.com/golang/go/issues/57928) | `context: add WithoutCancel, AfterFunc, and other additions` | Accepted, shipped in Go 1.21. Bundled five additions in one proposal. |
| [#36503](https://github.com/golang/go/issues/36503) | `context: add Merge(Context, Context) Context` | Declined. Merging the cancellation signals of two contexts can be done in user code; the proposal could not settle on value-lookup semantics. |
| [#28728](https://github.com/golang/go/issues/28728) | `context: add Detach` | Superseded by `WithoutCancel` in #57928. |
| [#67434](https://github.com/golang/go/issues/67434) | `proposal: log/slog, context: add support for scoped values` | Open as of Go 1.22. Would introduce a typed alternative to `WithValue`/`Value` to avoid `any`-typed keys and casts. Under active discussion; no implementation target. |
| [#40221](https://github.com/golang/go/issues/40221) | `context: add WithValues for multiple values` | Declined. The proposal noted that chained `WithValue` calls are cheap and the explicit chain is more readable. |

The pattern across accepted proposals is conservative: each addition is small, orthogonal, and addresses a documented pain point. The package has resisted larger reworks (no generics-based key API, no merge, no typed contexts) even when alternatives exist in the community.

---

## 11. Compatibility

| Surface | Stability |
|---|---|
| The `Context` interface (method set, names, signatures) | Locked by Go 1 compatibility. Adding a method would break every implementation in the wild. |
| `Background`, `TODO`, `WithCancel`, `WithDeadline`, `WithTimeout`, `WithValue` | Locked since Go 1.7. |
| `Canceled`, `DeadlineExceeded` | Locked since Go 1.7. The concrete type of `DeadlineExceeded` is documented as implementing `Timeout() bool` and `Temporary() bool`. |
| `WithCancelCause`, `WithoutCancel`, `AfterFunc`, `Cause`, `WithDeadlineCause`, `WithTimeoutCause` | Locked from Go 1.21 onward. |
| Unexported types (`cancelCtx`, `timerCtx`, `valueCtx`, `emptyCtx`, `propagateCancel`, etc.) | Not part of the API. May be refactored at any time. Code using `reflect` or `unsafe` to inspect them is non-conforming and may break on any minor release. |
| `String()` output of internal contexts (e.g., `context.Background.WithDeadline(...)`) | Not part of the API. Documented for debugging only. |

Behavioral compatibility is also part of the promise. The same context tree, on the same Go version, will always produce the same `Done` ordering and the same `Err()` results, with the documented exception that goroutine scheduling may reorder observable cancellation in concurrent observers — `Done` is broadcast, not totally ordered.

---

## 12. Bug Reporting

Bugs, performance regressions, and proposals for the package are filed in the main Go issue tracker:

- Issue tracker: [https://github.com/golang/go/issues](https://github.com/golang/go/issues)
- Filter by package: label `pkgsite/context` is not used; the convention is title prefix `context:`.
- Existing context issues: [https://github.com/golang/go/issues?q=is%3Aissue+context%3A](https://github.com/golang/go/issues?q=is%3Aissue+context%3A)
- Proposals: [https://github.com/golang/proposal](https://github.com/golang/proposal), title prefix `proposal: context:`.
- Security issues: do not file publicly; follow [https://go.dev/security/policy](https://go.dev/security/policy) and email `security@golang.org`.

For questions about correct usage (rather than bugs), the appropriate channels are the [Go forum](https://forum.golangbridge.org/), the `#context` and `#performance` channels on [Gophers Slack](https://invite.slack.golangbridge.org/), and the [golang-nuts mailing list](https://groups.google.com/g/golang-nuts).

Pull requests follow the standard Go contribution flow via [Gerrit](https://go-review.googlesource.com/), not GitHub. The CONTRIBUTING document at [https://go.dev/doc/contribute](https://go.dev/doc/contribute) is the authoritative guide; CL reviewers for `context` historically include Sameer Ajmani, Bryan C. Mills, and Russ Cox.
