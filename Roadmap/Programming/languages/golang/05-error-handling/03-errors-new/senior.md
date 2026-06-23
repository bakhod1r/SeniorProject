# errors.New — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [`errors.New` as Public API](#errorsnew-as-public-api)
3. [Sentinels as a Contract](#sentinels-as-a-contract)
4. [The Evolution of an Error API](#the-evolution-of-an-error-api)
5. [`errors.New` vs Typed Errors: a Decision Framework](#errorsnew-vs-typed-errors-a-decision-framework)
6. [Stability Guarantees of Sentinel Strings](#stability-guarantees-of-sentinel-strings)
7. [Sentinels Across Package Boundaries](#sentinels-across-package-boundaries)
8. [Versioning Errors](#versioning-errors)
9. [Hybrid Strategies: Sentinel + Type](#hybrid-strategies-sentinel-type)
10. [`errors.New` in Library Design](#errorsnew-in-library-design)
11. [Concurrency and Sentinels](#concurrency-and-sentinels)
12. [Distributed Systems: Sentinels Don't Cross the Wire](#distributed-systems-sentinels-dont-cross-the-wire)
13. [Telemetry and Observability](#telemetry-and-observability)
14. [Anti-Patterns at Scale](#anti-patterns-at-scale)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "How to architect?" and "How does this scale?"

At senior level, `errors.New` is no longer a per-function concern. It is a **decision about your package's public surface**. Each `var ErrFoo = errors.New(...)` you export is a contract you owe your callers for the lifetime of the package. Each one you do *not* export is a hidden control-flow detail.

This file is about the *strategy* of using `errors.New`: when to declare a sentinel, when to grow into a type, what stability guarantees you implicitly make, and how the choice ripples through the rest of the system.

---

## `errors.New` as Public API

The moment you write `var ErrFoo = errors.New("...")` and export it, you have published an API element. Callers will:

- Compare against it with `errors.Is`.
- Match it in tests.
- Translate it into HTTP status codes, gRPC codes, or domain-specific responses.
- Build retry, fallback, and circuit-breaker logic around it.

Removing or renaming the sentinel later is a **breaking change**. Even changing the message is a breaking change for any caller that grep'd the string in a log dashboard.

A senior engineer treats sentinels with the same gravity as exported types and functions. Specifically:

1. **Document each one.** Every exported sentinel has a doc comment naming the exact conditions under which it is returned.
2. **Group them.** Put the sentinels at the top of the package's main file or in `errors.go`. Callers can find them at a glance.
3. **Stabilize the message.** The string is part of the API for grep-based tooling. Treat it like a function name.
4. **Avoid changing identity.** Once allocated at init, the pointer is the contract. Recreating the variable elsewhere is a bug.

---

## Sentinels as a Contract

A sentinel sits at the intersection of three contracts:

| Contract | Held with | Broken by |
|---|---|---|
| Identity | callers using `errors.Is` | re-declaring or shadowing the sentinel |
| Message text | log scrapers, dashboards | editing the string |
| Semantic meaning | callers building business logic | returning the sentinel for *new* reasons in a new release |

The third is the subtlest. If `ErrNotFound` originally meant "row absent in DB" and you start returning it for "user lacks permission to see the row," every caller silently mistreats permission errors as not-found. **Each sentinel should map to exactly one semantic case.**

If your package grows two reasons that look similar, declare two sentinels:

```go
var (
    ErrNotFound  = errors.New("store: not found")
    ErrForbidden = errors.New("store: forbidden")
)
```

Even if both currently produce the same downstream behavior, they will diverge eventually.

---

## The Evolution of an Error API

A real package's error API tends to follow a predictable lifecycle:

### Phase 1: ad-hoc errors

```go
return errors.New("user not found")
```

No sentinel. Each error site invents its own message. Callers cannot match.

### Phase 2: sentinels appear

```go
var ErrNotFound = errors.New("user: not found")

return ErrNotFound
```

Callers can `errors.Is`. Migration cost is low.

### Phase 3: wrapping with context

```go
return fmt.Errorf("Get(%d): %w", id, ErrNotFound)
```

Logs gain breadcrumbs. `errors.Is` still works through the chain.

### Phase 4: typed errors for structured data

```go
type NotFoundError struct {
    Resource string
    ID       int
}
func (e *NotFoundError) Error() string { ... }
func (e *NotFoundError) Is(t error) bool { return t == ErrNotFound }
```

Callers can `errors.As(err, &nfe)` to grab the resource name and ID. The sentinel is preserved as a *category match*.

### Phase 5: error joining (Go 1.20+)

```go
return errors.Join(ErrNotFound, ErrForbidden)
```

Multi-error returns when more than one thing went wrong. The sentinels remain matchable individually.

A senior engineer can place a package on this curve and predict its next refactoring step.

---

## `errors.New` vs Typed Errors: a Decision Framework

When designing a new error, ask:

| Question | If yes → use `errors.New` | If yes → use a typed error |
|---|---|---|
| Does the error carry runtime fields callers need? | | yes |
| Is the failure a single, named category? | yes | |
| Will callers need to `switch` on a code or kind? | | yes |
| Does the message change based on input? | | yes (or `fmt.Errorf` with `%w` of a sentinel) |
| Should the error round-trip across services? | | yes (typed with explicit fields) |
| Is this the only failure path of the function? | yes | |
| Is the package small (≤ a few error cases)? | yes | |
| Are you OK with callers depending on the message string? | yes (it is part of the contract) | |

A common hybrid: `errors.New` for the **category** (`ErrNotFound`), a typed struct for the **detail** (`*NotFoundError{Resource, ID}`), wired together by an `Is` method.

---

## Stability Guarantees of Sentinel Strings

The Go standard library treats sentinel error messages as **near-frozen**. `io.EOF` has read `"EOF"` since Go 1.0. `sql.ErrNoRows` has read `"sql: no rows in result set"` essentially forever. Why? Because:

1. **Tests grep for the string.** Many existing tests compare `err.Error() == "EOF"`.
2. **Logs are parsed.** Operations dashboards may filter on the exact text.
3. **Documentation cites it.** Stack Overflow, blog posts, and books quote the message.

When you publish a sentinel, you are signing up for the same regime. Pick the message carefully, then leave it alone.

If you must change a message:

- Bump a major version.
- Document the change in release notes.
- If possible, keep the old sentinel as a deprecated alias (still returned alongside the new one for one or two releases).

---

## Sentinels Across Package Boundaries

A sentinel matches across packages if and only if its **identity** is preserved. That means:

- Callers must reach into your package by name to compare: `errors.Is(err, store.ErrNotFound)`.
- Re-exporting your sentinel from another package using a fresh `errors.New` breaks the match.
- Wrapping with `%w` preserves the chain, so `errors.Is` still works.

A common mistake at scale:

```go
// pkg-a
var ErrNotFound = errors.New("not found")

// pkg-b — WRONG
var ErrNotFound = errors.New("not found")

// caller — silently fails
errors.Is(pkgB.NotFoundError, pkgA.ErrNotFound) // false
```

The two packages declare *different* sentinels with the same message. Identity does not match across packages by accident.

The fix: have the second package re-export the first, or define a common `errs` package that both depend on:

```go
// pkg-shared/errs
var ErrNotFound = errors.New("shared: not found")

// pkg-a
return errs.ErrNotFound

// pkg-b
return errs.ErrNotFound
```

---

## Versioning Errors

Treat each exported sentinel as a versioned API surface:

| Change | Compatibility |
|---|---|
| Add a new sentinel | Backwards compatible. Existing callers keep working. |
| Remove a sentinel | Breaking. Bump major version. |
| Rename a sentinel | Breaking. Provide an alias if possible. |
| Change the message string | Soft-breaking. May break log scrapers and brittle tests. |
| Return an existing sentinel from a new code path | Soft-breaking. Callers may not expect it. |
| Wrap with `%w` where you previously did not | Soft-breaking for `==` comparisons; safe for `errors.Is`. |

A senior engineer reviews a pull request that adds or changes a sentinel with the same care as one that adds or changes a public function signature.

---

## Hybrid Strategies: Sentinel + Type

The most resilient pattern in mature Go libraries is **sentinel for identity, struct for fields**:

```go
package store

import (
    "errors"
    "fmt"
)

// ErrNotFound is the matchable category. Callers should use errors.Is.
var ErrNotFound = errors.New("store: not found")

// NotFoundError carries detail. Callers may use errors.As to extract fields.
type NotFoundError struct {
    Resource string
    Key      string
}

func (e *NotFoundError) Error() string {
    return fmt.Sprintf("store: %s %q not found", e.Resource, e.Key)
}

// Is satisfies errors.Is, making *NotFoundError indistinguishable
// from ErrNotFound for matching purposes.
func (e *NotFoundError) Is(target error) bool {
    return target == ErrNotFound
}
```

Now both work:

```go
var nfe *store.NotFoundError
if errors.As(err, &nfe) {
    log.Printf("missing %s %s", nfe.Resource, nfe.Key)
}
if errors.Is(err, store.ErrNotFound) {
    return http.StatusNotFound
}
```

The sentinel is the **category** for matching; the struct is the **payload** for detail. `errors.New` does the lightweight half; the typed struct does the rich half.

---

## `errors.New` in Library Design

When you build a library others depend on:

### Rule 1: every distinct failure mode gets a sentinel or a typed error

If your package can fail for more than one reason, callers need a way to tell them apart. Returning the same string for everything ("operation failed") is hostile.

### Rule 2: prefer `errors.Is` semantics in your docs

Document: "Callers should use `errors.Is(err, ErrFoo)` to detect Foo failures." Not "compare with `==`." This frees you to wrap internally without breaking callers.

### Rule 3: keep the sentinel set small

A package with 30 exported sentinels is a code smell. It usually means you are trying to use sentinels for what should be a typed error with an enum field. Aim for fewer than ten exported sentinels per package.

### Rule 4: namespace the messages

`errors.New("not found")` is fine inside one package. Across an ecosystem, prefer `errors.New("yourpkg: not found")` so logs are self-describing.

### Rule 5: do not export internal sentinels

If a sentinel is purely a control-flow signal between two functions in your package, keep it lowercase. Callers cannot rely on what they cannot see.

---

## Concurrency and Sentinels

Sentinels created with `errors.New` are **safe to share between goroutines**. The `*errorString` value's only field is set at construction and never mutated. There is no synchronization concern.

A pattern in concurrent code:

```go
var ErrCancelled = errors.New("cancelled")

func worker(ctx context.Context) error {
    select {
    case <-ctx.Done():
        return ErrCancelled
    case <-doWork():
        return nil
    }
}
```

Many goroutines may return the same `ErrCancelled` simultaneously. They all share the single allocated pointer. No locking, no copy. This is one of the strengths of the sentinel pattern.

A note on `context.Canceled` and `context.DeadlineExceeded`: those are `errors.New`-style sentinels declared by the standard library. Match them with `errors.Is`.

---

## Distributed Systems: Sentinels Don't Cross the Wire

A sentinel is a **process-local pointer**. When an error crosses a network boundary (gRPC, HTTP, message queue), the pointer identity is lost. Only the message survives, and even that is up to your serialization.

Implications:

1. **Server and client cannot share the same `errors.New` pointer.** Even if both import the same package, each process has its own runtime allocation.
2. **`errors.Is` does not work across the wire** unless you reconstruct the sentinel on the client side based on a wire-level signal (an enum, a code, a header).
3. **Map sentinels to wire codes.** gRPC uses status codes; HTTP uses status codes plus error codes in JSON bodies. Translate at the boundary.

Pattern at the server boundary:

```go
switch {
case errors.Is(err, ErrNotFound):
    return status.Error(codes.NotFound, err.Error())
case errors.Is(err, ErrForbidden):
    return status.Error(codes.PermissionDenied, err.Error())
default:
    return status.Error(codes.Internal, "internal error")
}
```

Pattern at the client boundary:

```go
st, _ := status.FromError(err)
switch st.Code() {
case codes.NotFound:
    return ErrNotFound
case codes.PermissionDenied:
    return ErrForbidden
default:
    return fmt.Errorf("rpc: %w", err)
}
```

Each side has its own copy of `ErrNotFound`. The wire code is the bridge.

---

## Telemetry and Observability

Sentinels are excellent telemetry primitives because they are stable and small:

```go
metric := errorMetric.WithLabelValues(errorClass(err))
metric.Inc()

func errorClass(err error) string {
    switch {
    case errors.Is(err, ErrNotFound):
        return "not_found"
    case errors.Is(err, ErrTimeout):
        return "timeout"
    case errors.Is(err, ErrInvalidInput):
        return "invalid_input"
    default:
        return "other"
    }
}
```

A handful of sentinels become a small set of metric labels. Cardinality stays low. Dashboards stay readable.

Contrast with using the raw error message: every distinct `fmt.Errorf("user %d not found", id)` produces a unique label, blowing up cardinality and making aggregation useless.

The sentinel pattern naturally gives you a *finite* error vocabulary suitable for dashboards.

---

## Anti-Patterns at Scale

### Anti-pattern 1: Sentinel inflation

A package with 50 exported `Err...` values is unwieldy. Callers cannot remember them; switches grow huge. Cluster them into a typed error with a `Kind` field.

### Anti-pattern 2: Cross-package shadow sentinels

Two packages each declare `ErrNotFound`. Callers do not know which to match. Centralize in a shared errors package.

### Anti-pattern 3: Returning sentinels for unrelated reasons

Reusing `ErrInvalidInput` for "input was nil" *and* "auth header missing" *and* "JSON malformed" hides distinctions callers need.

### Anti-pattern 4: Logging sentinels at every layer

Each layer logs the sentinel with its own context. The same failure appears six times in the log. Log once, at the boundary.

### Anti-pattern 5: Comparing sentinels across the wire

Calling `errors.Is(rpcErr, localSentinel)` expecting a match. The wire stripped the identity. Use status codes.

### Anti-pattern 6: Mutating a sentinel

You cannot, because the field is unexported, but you can mistakenly *replace* the variable: `ErrNotFound = errors.New("renamed")`. Other goroutines holding the old pointer will no longer match. Treat sentinels as `const` even though Go cannot enforce it.

### Anti-pattern 7: Sentinels as data

A sentinel is for matching, not for carrying detail. If you find yourself wishing the sentinel had fields, you have outgrown it. Move to a typed error.

---

## Summary

`errors.New` looks trivial — three lines of source. At senior level, treating each `var ErrFoo = errors.New(...)` as a published, versioned API contract is how you keep large systems debuggable. The sentinel pattern scales because it is small and stable; it breaks down only when you cram structured data into it. Pair sentinels with typed errors as your library matures, namespace the messages, and remember that pointer identity does not survive a network hop.

---

## Further Reading

- [The Go Blog: Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Rob Pike: Errors are values](https://go.dev/blog/errors-are-values)
- [Dave Cheney: Stack traces and the errors package](https://dave.cheney.net/2016/06/12/stack-traces-and-the-errors-package)
- [Cockroach Labs: Error handling at scale](https://github.com/cockroachdb/errors)
- Source: `$GOROOT/src/errors/errors.go`, `$GOROOT/src/io/io.go` (look at `EOF`)
