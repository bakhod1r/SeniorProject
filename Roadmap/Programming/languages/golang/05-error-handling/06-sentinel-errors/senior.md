# Sentinel Errors — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Sentinels as API Surface](#sentinels-as-api-surface)
3. [The Coupling Problem](#the-coupling-problem)
4. [Evolution: How Sentinels Age](#evolution-how-sentinels-age)
5. [Sentinels vs Typed Errors vs Kinds](#sentinels-vs-typed-errors-vs-kinds)
6. [Behavioral Interfaces: The Modern Alternative](#behavioral-interfaces-the-modern-alternative)
7. [Designing a Sentinel Vocabulary](#designing-a-sentinel-vocabulary)
8. [Sentinels Across Service Boundaries](#sentinels-across-service-boundaries)
9. [Sentinels and Wrapping Strategies](#sentinels-and-wrapping-strategies)
10. [Sentinels in Concurrent Code](#sentinels-in-concurrent-code)
11. [Sentinel Anti-Patterns at Scale](#sentinel-anti-patterns-at-scale)
12. [Sentinels and Telemetry](#sentinels-and-telemetry)
13. [When the Standard Library Gets It Wrong](#when-the-standard-library-gets-it-wrong)
14. [The Future: io/fs and Beyond](#the-future-iofs-and-beyond)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "How to optimize?" and "How to architect?"

At senior level, sentinels stop being a coding device and start being an *interface design problem*. Every exported sentinel is a contract that propagates outward forever. Choosing right matters; choosing wrong is permanent.

This file is about the architecture of sentinel-based error vocabularies: how to design them, how they evolve, why the famous Dave Cheney critique of sentinels is half right and half wrong, and what modern alternatives exist.

---

## Sentinels as API Surface

When `package users` exports `ErrNotFound`, it commits to:

1. **Existence.** The variable will continue to exist across all future versions of the package.
2. **Identity.** The pointer (the actual `error` value) will be stable across calls within a process.
3. **Behavior.** Specific functions in the package will continue to return it (or wrap it) under documented conditions.

These three commitments make `ErrNotFound` part of the **public type vocabulary** of the package, not just an internal detail. A breaking change to any of them ripples through every importer:

| Change | Breaks? |
|--------|---------|
| Renaming `ErrNotFound` to `ErrUserNotFound` | Yes — compile error in importers. |
| Removing `ErrNotFound` | Yes — compile error. |
| No longer returning `ErrNotFound` from `Get()` | Yes — `errors.Is(err, ErrNotFound)` stops matching. |
| Wrapping `ErrNotFound` where you used to return it bare | No — `errors.Is` still matches. |
| Returning a typed error whose `Is` method matches `ErrNotFound` | No — additive. |
| Changing `ErrNotFound`'s message | Maybe — breaks `.Error()` matchers (which are wrong anyway). |

The senior question: *do I really want to commit to this?* Once you do, it is forever.

---

## The Coupling Problem

This is Dave Cheney's argument, distilled. When a caller does:

```go
import "github.com/foo/users"

if errors.Is(err, users.ErrNotFound) { ... }
```

…the caller now has a *compile-time dependency* on `github.com/foo/users` *just to detect a kind of failure*. If the caller is itself a library, every transitive importer pays.

Worse: if `users` ever wants to split into `users-storage` and `users-service`, the sentinel cannot move without breaking everyone.

There are three common counter-arguments and one counter-counter-argument:

**Counter-argument A:** "Coupling on a *known* error variable is healthier than string-matching."
True. But the comparison should be against an alternative, not against the worst alternative.

**Counter-argument B:** "The standard library does it (e.g. `io.EOF`) and we copy from the standard library."
True. But the standard library is *one* package, designed to last 50 years. Your application code is not that.

**Counter-argument C:** "A sentinel is the simplest tool — anything more is over-engineering."
Often true for small packages. The trade-off changes as the system grows.

**Counter-counter-argument:** Behavioral interfaces (next section) provide a less-coupled alternative without losing detection capability.

---

## Evolution: How Sentinels Age

A package's sentinels evolve in predictable ways. Understanding the lifecycle helps you anticipate trouble.

### Phase 1: Born

Someone writes:
```go
var ErrNotFound = errors.New("not found")
```

Two callers use it. No problem.

### Phase 2: Multiplies

Six months later, the package has six sentinels. The same six failure modes now show up in six functions. Pattern emerges.

### Phase 3: Categorizes

Twelve months later, callers say "we want all 'client errors' to map to 4xx." But the sentinels have no grouping — `ErrNotFound`, `ErrInvalidInput`, `ErrPermission` are all flat. Callers write a `switch errors.Is(...)` chain or a slice and iterate.

### Phase 4: Outgrows

Eighteen months later, fields matter: "which user?" "which path?" Sentinels cannot carry data. Callers parse `.Error()`. Now you have brittleness.

### Phase 5: Migrates

You introduce typed errors with custom `Is` so they keep matching the sentinels. Old code keeps working. New code uses `errors.As`.

The earlier you anticipate Phase 4, the cleaner the migration. A package that starts with a typed error from day one ages better than a package that bolts one on retroactively.

---

## Sentinels vs Typed Errors vs Kinds

Three idiomatic patterns for "errors that callers can react to":

### Pattern 1: Sentinel

```go
var ErrNotFound = errors.New("not found")
return ErrNotFound
errors.Is(err, ErrNotFound)
```

- Pros: simple, zero allocation, copy-paste from stdlib.
- Cons: no fields, tightly couples caller to package, no grouping.

### Pattern 2: Typed error

```go
type NotFoundError struct {
    Kind string
    ID   int
}
func (e *NotFoundError) Error() string { return fmt.Sprintf("%s %d not found", e.Kind, e.ID) }

return &NotFoundError{Kind: "user", ID: id}

var nfErr *NotFoundError
if errors.As(err, &nfErr) { ... }
```

- Pros: structured fields, `errors.As` extracts data.
- Cons: more code per error type, importers depend on the type just like a sentinel.

### Pattern 3: Single error type with a `Kind` enum

```go
type Kind int
const (
    KindOther Kind = iota
    KindNotFound
    KindInvalid
    KindConflict
    KindUnauthorized
)

type Error struct {
    Op    string
    Kind  Kind
    Cause error
}

func (e *Error) Error() string  { ... }
func (e *Error) Unwrap() error  { return e.Cause }
func (e *Error) Is(target error) bool {
    t, ok := target.(*Error)
    return ok && t.Kind == e.Kind
}
```

- Pros: one type, many variants, structured fields, easy switch on `Kind`.
- Cons: callers must learn the enum; harder to extend in tiny modules.

This is the Upspin / cockroachdb pattern. For domain-rich systems it is the strongest design.

**Senior heuristic:**
- 1–5 distinct outcomes, no fields → sentinels.
- 1 outcome with rich data → typed error.
- 5+ outcomes with shared shape → kind enum.

Pick before you ship. Migrating in production is harder than it looks.

---

## Behavioral Interfaces: The Modern Alternative

Instead of `errors.Is(err, ErrNotFound)`, the caller can ask *what the error can do*:

```go
type notFound interface {
    NotFound() bool
}

func IsNotFound(err error) bool {
    var nf notFound
    return errors.As(err, &nf) && nf.NotFound()
}
```

Now any error type — *anywhere*, in any package — that implements `NotFound() bool` matches. The caller depends only on a small interface, not on a specific package's sentinel.

This is how the standard library does some checks already:

```go
type Timeout interface {
    Timeout() bool
}
type Temporary interface {
    Temporary() bool
}
```

Both are *behavioral* — the caller queries the error's properties rather than its identity.

When to use behavioral interfaces:

- The "kind" of failure is broader than one package.
- Multiple packages may produce the same kind from different concrete types.
- You want to extend without modifying existing types (open/closed).

When *not* to use:

- A small package with one obvious sentinel — overkill.
- The kind is genuinely package-specific (`sql.ErrNoRows` makes no sense outside `database/sql`).

---

## Designing a Sentinel Vocabulary

If you decide on sentinels, design the set with intent.

### Rule 1: Map to action

Each sentinel should map to a *different* caller action: a different HTTP status, a different retry policy, a different log level. If two sentinels result in the same handler behavior, you have one sentinel too many.

### Rule 2: Keep it small

3–7 sentinels per package is a sweet spot. More than that, and callers stop remembering them; they reach for `default:` and you lose the benefit.

### Rule 3: Cover the binary outcomes

The classic four: not-found, conflict (already exists), invalid input, unauthorized. Most domain packages need exactly these.

### Rule 4: Document each one

```go
// ErrNotFound is returned by Get and Lookup when no record matches.
// It is wrapped with the lookup key for context.
var ErrNotFound = errors.New("not found")
```

A reader should know *when* the sentinel fires, not just that it exists.

### Rule 5: Group in one place

```go
// errors.go
package users

import "errors"

var (
    ErrNotFound      = errors.New("user not found")
    ErrAlreadyExists = errors.New("user already exists")
    ErrInvalidEmail  = errors.New("invalid email")
)
```

A caller scrolling for the right sentinel should find them all in one file.

---

## Sentinels Across Service Boundaries

Once an error crosses a process boundary — over HTTP, gRPC, or a message queue — *the sentinel is gone*. The receiving process gets a string, a status code, or a structured payload. There is no pointer to compare.

The senior strategy: **encode the kind, decode at the boundary.**

```go
// sender side
type errorResponse struct {
    Code    string `json:"code"`     // "not_found", "conflict", ...
    Message string `json:"message"`
}

// receiver side
func decodeError(resp errorResponse) error {
    switch resp.Code {
    case "not_found":
        return ErrNotFound
    case "conflict":
        return ErrConflict
    default:
        return errors.New(resp.Message)
    }
}
```

The sentinel pointer is local to each process. The *kind* travels as a string code. Both sides agree on the codes. This is the same dance gRPC does with `codes.NotFound`, `codes.AlreadyExists`, etc.

If you skip this step and rely on `.Error()` text, you are string-matching across services — fragile across versions, impossible to internationalize.

---

## Sentinels and Wrapping Strategies

Three layered strategies in a real service:

### Strategy 1: Wrap at every layer

```go
// repo
return fmt.Errorf("repo.Get(%d): %w", id, ErrNotFound)
// service
return fmt.Errorf("service.Lookup(%d): %w", id, err)
// handler
return fmt.Errorf("handler.User(%d): %w", id, err)
```

Final message: `handler.User(7): service.Lookup(7): repo.Get(7): not found`. Verbose but rich. Good for log output, bad for user output.

### Strategy 2: Wrap once at the boundary

```go
// repo, service: pass-through
return ErrNotFound
// handler: wrap once
return fmt.Errorf("get user %d: %w", id, err)
```

Less duplication. Loses some "where did this happen?" detail but adds it back via tracing.

### Strategy 3: Wrap with structured fields

```go
type Error struct {
    Op    string
    Kind  Kind
    Cause error
}
```

Each layer creates a new `*Error` whose `Op` says what it was doing. `Unwrap` chains preserve the cause. Best for rich diagnostics, most code overhead.

A senior service often uses Strategy 3 internally and Strategy 1 for translation to log output. The choice depends on how you read errors in production.

---

## Sentinels in Concurrent Code

Sentinels are pointers. Concurrent reads from multiple goroutines are safe — pointers do not change.

But two specific concurrency hazards:

### Hazard 1: Returning a sentinel from a context that may also have its own error

```go
select {
case <-ctx.Done():
    return ctx.Err()  // context.Canceled or context.DeadlineExceeded
case res := <-resultCh:
    return process(res)
}
```

The caller may want to distinguish "user cancelled" (`context.Canceled`) from "your code failed" (`ErrNotFound`). Make sure both flow through cleanly.

### Hazard 2: Sentinel collected by `errors.Join`

```go
return errors.Join(ErrA, ErrB, ErrC)
```

`errors.Is` on the joined error matches if *any* of them is the target. Good. But the *outer* error is a new value each call — comparing two joined errors with `==` fails. Always use `errors.Is`.

### Hazard 3: First-error semantics

```go
g, ctx := errgroup.WithContext(ctx)
for _, j := range jobs {
    g.Go(func() error { return work(j, ctx) })
}
if err := g.Wait(); err != nil {
    if errors.Is(err, context.Canceled) {
        // first failure caused cancellation; the rest got context.Canceled
    }
}
```

When `errgroup` reports an error, the *first* failure wins, but other goroutines might have returned `context.Canceled`. The dominant error is what `Wait` returns; the sentinels for other goroutines are gone.

---

## Sentinel Anti-Patterns at Scale

1. **Sentinel sprawl.** A package with 40 sentinels has none — callers stop sorting them.
2. **Cross-package sentinel re-export.**
   ```go
   var ErrNotFound = users.ErrNotFound  // reassignment to a different package var
   ```
   Looks innocent, but now `errors.Is(err, ErrNotFound)` returns true even when you meant the original. Aliasing across package boundaries is rarely worth the confusion.
3. **Mixing sentinels and typed errors for the same condition.**
   ```go
   var ErrNotFound = errors.New("not found")
   type NotFoundError struct{ ... }
   ```
   Callers do not know which to check. Pick one and stick with it (or wire `Is` to bridge).
4. **Sentinel for an *unexpected* condition.**
   ```go
   var ErrShouldNeverHappen = errors.New("should never happen")
   ```
   If it should never happen, panic. If it can happen, name it for what it actually is.
5. **String-formatted "sentinels."**
   ```go
   var ErrFoo = errors.New(fmt.Sprintf("foo at %s", time.Now()))
   ```
   Sentinels must be stable. A timestamped one is unique per init, defeating the purpose.
6. **Sentinels for transport codes.**
   ```go
   var Err500 = errors.New("internal server error")
   ```
   That is what HTTP status codes are for. Use a sentinel for the *cause*; map to status at the edge.

---

## Sentinels and Telemetry

In production, every error that crosses a boundary becomes telemetry: a metric, a log, a trace. Sentinels make telemetry *composable*.

```go
func recordError(err error) {
    switch {
    case errors.Is(err, context.Canceled):
        metrics.Incr("err.canceled")
    case errors.Is(err, ErrNotFound):
        metrics.Incr("err.not_found")
    case errors.Is(err, ErrUnauthorized):
        metrics.Incr("err.unauthorized")
    default:
        metrics.Incr("err.internal")
    }
}
```

Three benefits:

1. **Stable cardinality.** Each sentinel is *one* metric label. Without sentinels, you label by `.Error()` and your time-series database explodes.
2. **Alertable categories.** "Alert when 5xx rate > 1%" is meaningful only if you can classify each error into 4xx vs 5xx — sentinels make the classification trivial.
3. **Per-kind dashboards.** "Show me the rate of `ErrNotFound` over time" — straightforward when the sentinel is the metric label.

Senior systems wire this once at the edge and let every layer below return raw, wrapped sentinels.

---

## When the Standard Library Gets It Wrong

Even the stdlib has questionable sentinel decisions. A few:

- **`io.EOF` is not `Err…`-prefixed.** Historical accident. Today this would be `io.ErrEOF`. Compatibility prevents the rename.
- **Returning `io.EOF` with `n > 0`.** A famous gotcha — code that `if err != nil { return }` before processing the bytes loses data. The signature could have been `(int, error)` always with `n==0` for the actual EOF, but the stdlib chose to coalesce for performance.
- **`os.ErrNotExist` and the typed `*PathError`.** The dual interface is powerful but confusing — newcomers expect either one or the other.
- **`bufio.ErrBufferFull` is exposed though it almost never matters.** Internal detail leaked into public API.
- **`net.ErrClosed` is relatively new (Go 1.16).** Before it existed, callers compared `.Error()` strings to detect closed connections. The retroactive sentinel is harder to use universally.

The lesson for senior designers: *every sentinel is forever; pick carefully*.

---

## The Future: io/fs and Beyond

Go 1.16 introduced `io/fs`, a filesystem abstraction. It re-uses `os.ErrNotExist` and `os.ErrPermission` *as values*, not as new sentinels — these become aliases:

```go
package fs
var (
    ErrNotExist  = errInvalid()  // wraps to match os.ErrNotExist
    ErrPermission = errPermission()
)
```

The clever wiring lets:
- Old code: `errors.Is(err, os.ErrNotExist)` works.
- New code: `errors.Is(err, fs.ErrNotExist)` works.
- Both succeed against the same underlying error.

This is the gold-standard sentinel migration: introduce a new package, alias the values, callers do not have to change anything. The pattern shows what *sentinel maintenance* looks like at scale.

Going forward, expect more of this — sentinels rarely die; they just get re-exported under new names and aliased.

---

## Summary

At senior level, sentinels are interface design. Each one is a permanent commitment, a coupling point, and a vocabulary entry. Curate the set, prefer typed errors with custom `Is` for richer scenarios, consider behavioral interfaces when the kind is broader than one package, encode at boundaries with kind codes rather than pointers, and wire every sentinel into telemetry. The standard library's patterns — `io.EOF`, `os.ErrNotExist`, `context.Canceled` — are not just code; they are case studies in what it means to make an error part of an API forever.

---

## Further Reading

- [Don't just check errors, handle them gracefully (Dave Cheney)](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully) — the influential anti-sentinel argument.
- [Working with Errors in Go 1.13 (Damien Neil & Jonathan Amsterdam)](https://go.dev/blog/go1.13-errors)
- [Stamping Out Errors in Go (Cockroach Labs)](https://www.cockroachlabs.com/blog/error-handling-and-go/)
- [Designing Errors as Values (Upspin)](https://commandcenter.blogspot.com/2017/12/error-handling-in-upspin.html)
- [io/fs design proposal](https://go.googlesource.com/proposal/+/master/design/draft-iofs.md)
- `$GOROOT/src/io/io.go`, `$GOROOT/src/os/error.go`, `$GOROOT/src/database/sql/sql.go` — read the source.
- [The gRPC error model](https://grpc.io/docs/guides/error/) — how error codes travel between processes.
