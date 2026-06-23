# Wrapping & Unwrapping Errors — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Wrapping as a System Property](#wrapping-as-a-system-property)
3. [Designing the Chain](#designing-the-chain)
4. [Layered Translation Strategy](#layered-translation-strategy)
5. [Public vs Internal Wrap](#public-vs-internal-wrap)
6. [Trees, Not Just Lists](#trees-not-just-lists)
7. [Walk Cost and Worst Cases](#walk-cost-and-worst-cases)
8. [Custom Wrap Types for Production](#custom-wrap-types-for-production)
9. [Wrapping and Telemetry](#wrapping-and-telemetry)
10. [Wrap and Backward Compatibility](#wrap-and-backward-compatibility)
11. [Wrap Chains Across the Network](#wrap-chains-across-the-network)
12. [Anti-Patterns at Scale](#anti-patterns-at-scale)
13. [Wrap and Cancellation](#wrap-and-cancellation)
14. [Architecting Wrap-Aware Libraries](#architecting-wrap-aware-libraries)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "How do wrap chains shape system behavior and design at scale?"

At senior level, wrapping stops being about a verb and a method and becomes about **how errors flow through a multi-package, multi-process, multi-team system**. Each `%w` is a contract: someone, somewhere, may walk the chain and act on what they find. The architecture decisions you make determine whether that walk is meaningful or a distraction.

This file is about the architecture of wrap chains, the cost of long ones, the cost of *too short* ones, and the techniques senior engineers use to keep error propagation a tool rather than a tax.

---

## Wrapping as a System Property

A senior Go engineer answers four questions before introducing a wrap convention:

1. **What does each layer add?** If a layer has no new context, do not wrap — just propagate.
2. **Who downstream walks the chain?** Handlers, retry helpers, telemetry, tests. Each is a stakeholder.
3. **What sentinels and types are public?** They are part of the API. Renames break callers.
4. **How long is a typical chain in production?** Two? Five? Twenty? Each `errors.Is` walks them all.

A team without explicit answers tends to wrap inconsistently — three layers of `%w` here, plain `%v` there, raw passthrough somewhere else — and the on-call engineer pays the price at 3 AM.

---

## Designing the Chain

Treat the wrap chain as a designed structure, not an accidental side effect.

### The shape of a good chain

```
[edge: HTTP handler]
   wraps: request id, route, method
[application: service]
   wraps: operation name, key inputs
[domain: business logic]
   wraps: entity, action
[infrastructure: repo / client]
   wraps: target system, query/operation
[underlying: driver / syscall]
   provides: the original cause
```

Each wrap should add **one** new piece of useful context. A chain of 4–5 layers is normal; longer than 6 usually means redundancy.

### The shape of a bad chain

```
"do: do_internal: do_helper: do_helper2: file does not exist"
```

Five layers, four of which add nothing. Removing the redundant ones takes the message from 60 characters to 30 with no information loss.

### Heuristic: the breadcrumb test

Read the final error message aloud as a sentence:

> "send notification id=42: render template welcome.html: open templates/welcome.html: no such file or directory"

If each colon-separated phrase tells a fresh fact, the chain is good. If two adjacent phrases say the same thing in different words, drop one wrap.

---

## Layered Translation Strategy

In a typical Go service, errors flow upward through layers and *should be translated* at certain boundaries.

| Layer | Wrap or translate? | Rationale |
|-------|--------------------|-----------|
| **Driver / syscall** | Original error | Source of truth. |
| **Repository** | Wrap with operation, *translate* if the driver error maps to a known domain sentinel. | Driver-specific errors stay local. |
| **Domain / service** | Wrap with operation. | Caller stays in domain vocabulary. |
| **HTTP / gRPC handler** | Translate domain → protocol. | Protocol responses are public. |
| **Edge** | Translate to user-safe text. | Hide internals. |

Translation example at the repo:

```go
func (r *Repo) FindByID(id int) (*User, error) {
    var u User
    err := r.db.QueryRow("SELECT ...").Scan(&u)
    switch {
    case err == sql.ErrNoRows:
        return nil, ErrNotFound
    case err != nil:
        return nil, fmt.Errorf("find user id=%d: %w", id, err)
    }
    return &u, nil
}
```

The driver-specific `sql.ErrNoRows` becomes the domain `ErrNotFound`. Upstream code uses only `errors.Is(err, ErrNotFound)` — ignorant of which database is in play.

The translation rule: each layer should expose errors *its callers care about*. Internal driver errors are noise to the service layer; domain errors are noise to the user. Pick the right vocabulary at each boundary.

---

## Public vs Internal Wrap

A subtle but important separation: the wrap chain you keep for *yourself* (logs, debug) and the chain you expose to callers.

### Public chain

Exposed via the returned `error`. Callers call `errors.Is`/`errors.As`. Promised stability — sentinels and types are part of API.

### Internal chain

Logged at the boundary, never returned upstream. Free to contain anything: SQL text, internal IDs, file paths, debug flags.

Pattern:

```go
type publicError struct {
    pub  error  // safe, part of API
    full error  // verbose, internal
}

func (e *publicError) Error() string { return e.pub.Error() }
func (e *publicError) Unwrap() error { return e.pub }

func (e *publicError) Internal() error { return e.full }

// At the boundary
log.Printf("internal: %v", pe.Internal())
return pe  // caller sees only safe text
```

Or simpler:

```go
log.Printf("query users id=%d: %v", id, err)  // full chain to log
return ErrInternal                             // bland error to caller
```

The decision is *whether the caller needs to react differently*. If the only choice is "pass to user as 500," translate. If the caller chooses retry vs not, expose enough to decide.

---

## Trees, Not Just Lists

`Unwrap() []error` (Go 1.20) makes wrap chains into trees. Two implications.

### Implication 1: `errors.Is` traverses every branch

A `errors.Join(errA, errB)` value matches both `errors.Is(err, errA)` and `errors.Is(err, errB)`. Useful — but if you have many branches, the walk is no longer linear; it is roughly linear in the number of nodes.

### Implication 2: Order matters less, but is observable

`errors.Is` returns true on the *first* match it finds. A depth-first walk (the default) visits the first branch's full subtree before the second. So if you implement custom `Is` methods that have side effects (avoid this!) the order is observable.

### Implication 3: The string is a multi-line concatenation

`errors.Join(a, b, c).Error()` returns:

```
a's error string
b's error string
c's error string
```

Newline-separated. For UI rendering or single-line logs you may want to format differently. Keep this in mind when designing user-facing displays.

---

## Walk Cost and Worst Cases

`errors.Is` and `errors.As` are O(N) where N is the number of nodes in the chain (counting all branches in trees).

For typical chains (3–5 nodes), the walk is sub-microsecond. For pathological cases:

- A wrap chain of depth 100 (e.g., a recursive function that wraps on every level) costs 100 × method-call overhead per `errors.Is` call. Still fast, but multiply by million-per-second hot path and it shows.
- An `errors.Join` of 1000 sibling errors costs 1000 nodes per walk.
- Custom types with non-trivial `Is`/`As` methods amplify the per-node cost.

Senior practices:
- **Bound chain depth**, both via convention (5 layers max) and via lint rules.
- **Don't `errors.Is` in a tight loop** — call once, cache the result.
- **For high-rate paths**, consider sentinels-only (no wrap) and let the wrap happen at the slower outer boundary.

---

## Custom Wrap Types for Production

Real-world projects often define a single canonical error type that carries:

- An *operation* name.
- An optional *kind* (enum) for HTTP/gRPC mapping.
- An optional *target* (entity, path, ID).
- The wrapped *cause*.
- Optionally, a *stack snapshot* captured at construction.

```go
type Error struct {
    Op      string
    Kind    Kind
    Target  string
    Cause   error
    Stack   []uintptr // optional
}

func (e *Error) Error() string {
    if e.Cause != nil {
        return fmt.Sprintf("%s %q: %v", e.Op, e.Target, e.Cause)
    }
    return fmt.Sprintf("%s %q", e.Op, e.Target)
}

func (e *Error) Unwrap() error { return e.Cause }

func (e *Error) Is(target error) bool {
    t, ok := target.(*Error)
    if !ok {
        return false
    }
    return e.Kind == t.Kind
}
```

A constructor:

```go
func E(op string, args ...any) error {
    e := &Error{Op: op}
    for _, a := range args {
        switch v := a.(type) {
        case Kind:
            e.Kind = v
        case string:
            e.Target = v
        case error:
            e.Cause = v
        }
    }
    return e
}
```

Used like:

```go
return E("user.create", KindConflict, email, originalErr)
```

This pattern is popularized by Upspin and adopted by many companies. The advantages:

- **One construction site**, easier to grep, easier to add stack capture.
- **Consistent presentation** — all errors render the same way.
- **Kind-based dispatch** — handlers map kinds to HTTP statuses without each layer knowing all sentinels.

The disadvantage: the type becomes a public API and a single point of friction. A breaking change to it ripples everywhere.

---

## Wrapping and Telemetry

In production, errors are *signals* — they need to be observable. Wrap chains intersect telemetry in three places.

### Logging

Wrap once at the boundary, log once with the full chain:

```go
slog.Error("request failed",
    "request_id", reqID,
    "err", err,           // chain dumped by handler
)
```

Avoid logging *and* returning at every layer. Logging is the boundary's job; wrapping is the inner code's job.

### Metrics

Map errors to counter labels via kind:

```go
var kind string
switch {
case errors.Is(err, ErrNotFound):
    kind = "not_found"
case errors.Is(err, ErrConflict):
    kind = "conflict"
default:
    kind = "internal"
}
metrics.Counter("requests_failed", "kind", kind).Inc()
```

Don't use the wrap's *message string* as a label — high cardinality breaks Prometheus.

### Tracing

OpenTelemetry spans take an error:

```go
span.RecordError(err)
span.SetStatus(codes.Error, err.Error())
```

The recorded error's chain is preserved by most exporters. Some exporters walk the chain and attach each cause as a separate event.

---

## Wrap and Backward Compatibility

Once your package's wrap behavior is in production, callers depend on it.

Things that are breaking changes:

- Renaming a sentinel (`ErrNotFound` → `ErrMissing`).
- Removing or changing the type of a custom error type's exported fields.
- Removing `Unwrap` from a custom type (callers' `errors.Is` stops working).
- Changing what is wrapped — e.g., previously you wrapped `sql.ErrNoRows`, now you translate to `ErrNotFound`. Callers' `errors.Is(err, sql.ErrNoRows)` silently breaks.
- Changing the wrap's `%w` to `%v`.

Things that are *not* breaking:

- Improving the wrap *message* (the human-readable string).
- Adding new sentinels or kinds.
- Adding `Unwrap`/`Is`/`As` methods to a type that didn't have them.
- Adding new layers to the chain (as long as identity walks still find the same target).

For libraries with public users, document the wrap behavior. Tests should pin it: `errors.Is(err, ErrNotFound)` is a *contract*.

---

## Wrap Chains Across the Network

Errors crossing process boundaries lose Go-specific structure. gRPC and HTTP do not transmit `Unwrap` chains; they transmit a string and a status code.

For a server-side chain to mean something on the client:

1. **The server picks a status code** based on the chain's kind.
2. **The server includes a structured detail** (gRPC's `*status.Status` Details, an error envelope in JSON).
3. **The client reconstructs a Go error from those fields**, possibly with `errors.Is` against client-side sentinels.

```go
// Server
st := status.New(codes.NotFound, "user not found")
st, _ = st.WithDetails(&pb.ErrorDetail{Code: "USER_NOT_FOUND"})
return st.Err()

// Client
if st, ok := status.FromError(err); ok {
    if st.Code() == codes.NotFound {
        return fmt.Errorf("get user: %w", ErrNotFound)
    }
}
```

The *go process* that reconstructed the error has its own chain; the network was a translation layer.

---

## Anti-Patterns at Scale

Patterns that look fine in a small program but fall apart at production scale.

### 1. Wrapping every layer with `%w`

Five layers of `fmt.Errorf("%w", err)` add no information but cost five allocations. The error message is identical to having one wrap.

### 2. Sentinel addiction

Defining 200 sentinels for 200 specific error conditions. Callers cannot keep up; some will use `strings.Contains` because they cannot find the right sentinel.

**Better:** kinds (an enum), maybe 8 of them, each mapping to an HTTP status. Sentinels for the few cross-package shared cases.

### 3. Custom error type with no `Unwrap`

```go
type ServiceError struct{ Cause error }
func (e *ServiceError) Error() string { return ... }
// no Unwrap method
```

`errors.Is(err, sentinel)` always returns false. The `Cause` field is dead — stored but never readable through the chain helpers.

### 4. Non-comparable error types panicking `errors.Is`

```go
type ListError struct{ Items []string }
func (e ListError) Error() string { return ... }

errors.Is(someErr, ListError{Items: []string{"a"}})  // panic
```

Slices are not comparable. `errors.Is` compares with `==`, which panics on non-comparable values. Implement a custom `Is` method to avoid this.

### 5. Mixing wrap and translate randomly

A chain that wraps three layers, then suddenly translates to a fresh error, then wraps two more. Callers cannot tell whether `errors.Is(err, originalSentinel)` will work — sometimes yes, sometimes no.

**Better:** translate at *boundaries* (well-defined seams), wrap *between* boundaries.

### 6. `errors.Join` with a single error

`errors.Join(err1)` returns a `*joinError` wrapping one error. It still works (`errors.Is` finds branches), but it adds a node to the chain for no reason. Just return the error.

### 7. Custom `As` method that ignores its target type

```go
func (e *MyErr) As(target any) bool {
    *target.(*MyErr) = *e   // panics if target is not *MyErr
    return true
}
```

`As` *must* check the target type before assigning, and *must* return false on mismatch.

---

## Wrap and Cancellation

`context.Canceled` and `context.DeadlineExceeded` are sentinels. They get wrapped naturally:

```go
if err := someStep(ctx); err != nil {
    return fmt.Errorf("step X: %w", err)
}
```

If the step returned `context.DeadlineExceeded`, the chain still surfaces it via `errors.Is(err, context.DeadlineExceeded)`. Use that to:

- **Skip retries** — don't retry an operation whose deadline already fired.
- **Avoid alerting** — context cancel is an expected outcome, not a failure to page on.
- **Adjust logging level** — DEBUG, not ERROR.

```go
if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
    log.Debug("request cancelled", "err", err)
    return  // don't increment error counter, don't page
}
log.Error("internal failure", "err", err)
```

The chain makes this cheap: one `errors.Is` call, no string parsing.

---

## Architecting Wrap-Aware Libraries

If you publish a Go package, the wrap behavior is part of your API. Design choices:

### Choice 1: Sentinels via `errors.Is`

```go
package db

var (
    ErrNotFound = errors.New("not found")
    ErrConflict = errors.New("conflict")
)
```

Document: "callers should use `errors.Is` to detect these conditions; wrapping is preserved through `%w`."

### Choice 2: Typed errors via `errors.As`

```go
type QueryError struct {
    Query string
    Cause error
}
func (e *QueryError) Error() string { ... }
func (e *QueryError) Unwrap() error { return e.Cause }
```

Document: "callers use `errors.As(err, &qe)` to extract query info."

### Choice 3: Both

```go
package db

var ErrNotFound = errors.New("not found")

type QueryError struct {
    Query string
    Cause error
}
func (e *QueryError) Error() string { ... }
func (e *QueryError) Unwrap() error { return e.Cause }
func (e *QueryError) Is(target error) bool {
    return target == ErrNotFound && errors.Is(e.Cause, ErrNotFound)
}
```

Both work. Pick one paradigm and stick with it for the package.

### Documentation expectations

- List which sentinels are exported.
- List which custom types are exported.
- Describe what `errors.Is` and `errors.As` will and will not find.
- Specify behavior for context cancellation.

A well-documented error API is a hallmark of senior-grade libraries.

---

## Summary

At senior level, wrap chains are a designed feature of the system, not a side effect. You decide where to wrap (every layer adds one fact), where to translate (at well-defined boundaries), what to expose (sentinels and types as public API), and how the chain interacts with telemetry, retries, and cancellation. You bound chain depth, you avoid sentinel sprawl, you treat the chain as documentation. The chain becomes a story the on-call reader follows from boundary to root cause in one line.

---

## Further Reading

- [Working with Errors in Go 1.13 (the Go Blog)](https://go.dev/blog/go1.13-errors)
- [Go 1.20 Release Notes — `errors.Join`](https://go.dev/doc/go1.20#errors)
- [Designing Errors as Values in Upspin](https://commandcenter.blogspot.com/2017/12/error-handling-in-upspin.html)
- [Cockroach Labs — Stamping Out Errors](https://www.cockroachlabs.com/blog/error-handling-and-go/)
- [`pkg/errors`](https://pkg.go.dev/github.com/pkg/errors) — historical alternative with stack traces.
- [`cockroachdb/errors`](https://pkg.go.dev/github.com/cockroachdb/errors) — modern feature-rich wrap library.
- [OpenTelemetry — RecordError](https://opentelemetry.io/docs/instrumentation/go/manual/#errors)
