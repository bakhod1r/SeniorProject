# errors.New — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [What `errors.New` Actually Does](#what-errorsnew-actually-does)
3. [Allocation Per Call vs Package-Level](#allocation-per-call-vs-package-level)
4. [Identity, Equality, and `errors.Is`](#identity-equality-and-errorsis)
5. [Sentinels Done Right](#sentinels-done-right)
6. [`errors.New` vs `fmt.Errorf`](#errorsnew-vs-fmterrorf)
7. [Wrapping Sentinels with `%w`](#wrapping-sentinels-with-w)
8. [When NOT to Use `errors.New`](#when-not-to-use-errorsnew)
9. [Patterns That Survive Refactoring](#patterns-that-survive-refactoring)
10. [Sentinel Naming Conventions](#sentinel-naming-conventions)
11. [Testing With `errors.New`](#testing-with-errorsnew)
12. [Common Anti-Patterns](#common-anti-patterns)
13. [Migration Path: From Strings to Types](#migration-path-from-strings-to-types)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction
> Focus: "Why?" and "When?"

At junior level you learned that `errors.New` returns a fresh `error` whose `Error()` method yields the string you passed in. That mechanic is correct but not yet *useful*. At middle level the questions become: when do I declare a sentinel, when do I create one inline, how do I compose `errors.New` with wrapping, and what does the choice cost in allocations and clarity?

This file is about reading and writing real Go code that uses `errors.New` well. By the end, you should be able to look at a package and say "this set of sentinels is well-designed" or "this is sloppy" with reasons.

---

## What `errors.New` Actually Does

The full implementation, again, fits in a paragraph:

```go
type errorString struct{ s string }

func (e *errorString) Error() string { return e.s }

func New(text string) error { return &errorString{s: text} }
```

Three observations a middle developer should make:

1. **Pointer receiver on `Error`**. The error's identity is the pointer. Two pointer values are equal if and only if they refer to the same allocation.
2. **Heap allocation**. `&errorString{...}` always escapes — the pointer crosses the function boundary as a return value. Modern compilers cannot stack-allocate it.
3. **Immutability by inaccessibility**. `s` is unexported; nothing outside the `errors` package can mutate it. The error's message is therefore stable for the lifetime of the value.

This minimalism is intentional. The Go authors chose to keep `errors.New` strictly as "string-to-error" and let other constructors (`fmt.Errorf`, custom types, `errors.Join`) cover everything else.

---

## Allocation Per Call vs Package-Level

This is the single most consequential decision you make with `errors.New`.

### Per call — fresh allocation each time

```go
func Find(id int) error {
    return errors.New("not found")
}
```

Each call to `Find` that fails:
- Allocates a new `*errorString` (one heap object, ~16 bytes plus the string header).
- Returns a pointer with a brand-new identity.
- Forces the caller to compare by *string content*, which is fragile and slow.

In a hot loop where 1% of inputs fail, that is millions of throwaway allocations.

### Package-level — allocate once, reuse forever

```go
var ErrNotFound = errors.New("not found")

func Find(id int) error {
    return ErrNotFound
}
```

`ErrNotFound` is allocated **once**, during package initialization. Every call to `Find` that fails returns the *same* pointer. Callers can compare with `errors.Is(err, ErrNotFound)` (or even `==` if no wrapping) and get a stable, fast match.

### The benchmark anyone can write

```go
var ErrSentinel = errors.New("not found")

func BenchmarkPerCall(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = errors.New("not found")
    }
}

func BenchmarkSentinel(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = ErrSentinel
    }
}
```

On a modern x86, `BenchmarkPerCall` runs at ~30 ns/op with 1 alloc/op. `BenchmarkSentinel` is ~0.5 ns/op with 0 allocs/op. The difference becomes important only when you are returning errors at high frequency.

### Rule of thumb

If a particular error is something callers want to *match against*, declare it at package level. If it is a one-off "this specific input was bad" message no one will ever match, an inline `errors.New` (or better, `fmt.Errorf`) is fine.

---

## Identity, Equality, and `errors.Is`

The defining quirk of `errors.New` values is that they have **pointer identity**. Comparison rules:

```go
var ErrA = errors.New("a")

func main() {
    x := ErrA
    y := ErrA
    fmt.Println(x == y)  // true: same pointer

    a := errors.New("a")
    b := errors.New("a")
    fmt.Println(a == b)  // false: different pointers
}
```

### `==` versus `errors.Is`

For unwrapped errors, `err == ErrA` and `errors.Is(err, ErrA)` are equivalent — both are pointer comparisons.

For wrapped errors, only `errors.Is` works:

```go
err := fmt.Errorf("op: %w", ErrA)
err == ErrA              // false (err is a *fmt.wrapError)
errors.Is(err, ErrA)     // true (Is walks the Unwrap chain)
```

### Always use `errors.Is`

The future-proof rule: write `errors.Is(err, ErrFoo)` everywhere, even if you "know" no one wraps it. Six months from now, a colleague will add a `fmt.Errorf("ctx: %w", err)` somewhere and break every `==` comparison silently.

---

## Sentinels Done Right

A sentinel error is a package-level `error` variable used as a marker. Best practices:

```go
package store

import "errors"

// ErrNotFound is returned when a key is not present.
var ErrNotFound = errors.New("store: not found")

// ErrConflict is returned on a primary-key conflict.
var ErrConflict = errors.New("store: conflict")
```

- **Doc comment**: every exported sentinel has one explaining when it is returned.
- **Package prefix in message**: `"store: not found"` rather than just `"not found"`. When the error is logged out of context, the prefix tells the reader where it came from.
- **Stable string**: do not change the message between releases — users may match it in their tests or logs.
- **Group at top of file**: in a `var (...)` block near the public API definition.

A pattern to avoid:

```go
// BAD: redeclared in two files
// file a.go
var ErrNotFound = errors.New("not found")
// file b.go in same package — compile error: redeclared
```

The compiler protects you within a package, but if you accidentally declare *similar* sentinels with the same message in two *different* packages, callers cannot tell them apart, and `errors.Is` matches will not cross package boundaries.

---

## `errors.New` vs `fmt.Errorf`

Both produce values of type `error`. The split:

| Use case | `errors.New` | `fmt.Errorf` |
|---|---|---|
| Static message | yes | overkill but legal |
| Format a runtime value | no | yes |
| Wrap another error with `%w` | no | yes |
| Cheapest possible allocation | yes | no (extra parsing of the format string) |
| Returns a `*errorString` | yes | a different unexported type (`*fmt.wrapError` if `%w`, otherwise `*errors.errorString`-equivalent) |

Rule: choose the *simplest* tool that works. If your message has no `%` verbs, no cause, and is constant, prefer `errors.New`. The moment you reach for string interpolation, switch to `fmt.Errorf`.

```go
// good
errors.New("invalid input")

// good
fmt.Errorf("invalid input: %q", s)

// bad: do not build the string yourself
errors.New("invalid input: " + s)
```

The last form is functionally similar but loses type information for tools and lints, and concatenation is slower than `fmt.Sprintf` or a `bytes.Buffer` in most cases.

---

## Wrapping Sentinels with `%w`

The `%w` verb (Go 1.13+) is the bridge between `errors.New`-style sentinels and richer contextual messages.

```go
var ErrTimeout = errors.New("timeout")

func call() error {
    if rand.Float64() < 0.5 {
        return ErrTimeout
    }
    return nil
}

func RetryCall() error {
    if err := call(); err != nil {
        return fmt.Errorf("RetryCall after 3 attempts: %w", err)
    }
    return nil
}
```

The returned error:
- Prints as `"RetryCall after 3 attempts: timeout"`.
- Has `Unwrap()` returning `ErrTimeout`.
- Matches `errors.Is(err, ErrTimeout)` from any caller.

This is how `errors.New` sentinels become useful across deep call stacks: the leaves declare them, the middle wraps with `%w`, the top inspects with `errors.Is`.

### Multiple wraps

```go
// inner
return fmt.Errorf("db query: %w", ErrTimeout)

// middle
return fmt.Errorf("Get(%d): %w", id, err)

// outer
return fmt.Errorf("handler: %w", err)
```

The chain is `ErrTimeout` → `db query: timeout` → `Get(7): db query: timeout` → `handler: Get(7): db query: timeout`. `errors.Is(err, ErrTimeout)` walks the entire chain and finds the leaf.

---

## When NOT to Use `errors.New`

`errors.New` is the wrong tool when:

1. **You need fields on the error** (HTTP code, retryability, structured details). Define a struct that implements `error`.

   ```go
   type APIError struct {
       Code    int
       Message string
   }
   func (e *APIError) Error() string { return e.Message }
   ```

2. **You want a stack trace.** Use a third-party library (`github.com/pkg/errors`, `cockroachdb/errors`) or capture manually.

3. **The error needs runtime data.** Use `fmt.Errorf("...: %w", err)` so the message includes context.

4. **You want errors that compose**. Use `errors.Join` (Go 1.20+) to combine multiple errors into one.

5. **You need Unwrap behavior beyond a single chain.** Custom types with custom `Unwrap()` methods give you full control.

If you find yourself reaching for `errors.New` and immediately wishing it had more, that is the signal to introduce a typed error.

---

## Patterns That Survive Refactoring

The patterns below work whether your codebase is 100 lines or 100,000.

### Pattern 1: Sentinel block at top of package

```go
package payments

import "errors"

var (
    ErrInvalidCard      = errors.New("payments: invalid card")
    ErrInsufficientFunds = errors.New("payments: insufficient funds")
    ErrCardExpired      = errors.New("payments: card expired")
)
```

A reader scanning the package immediately sees its failure vocabulary.

### Pattern 2: Always wrap when crossing a boundary

```go
func (s *Service) Charge(ctx context.Context, id int, cents int) error {
    if err := s.gateway.Charge(ctx, id, cents); err != nil {
        return fmt.Errorf("payments.Service.Charge(%d, %d): %w", id, cents, err)
    }
    return nil
}
```

The wrap adds context. The sentinel underneath stays matchable.

### Pattern 3: Map sentinels at the HTTP layer

```go
switch {
case errors.Is(err, payments.ErrInsufficientFunds):
    http.Error(w, "insufficient funds", http.StatusPaymentRequired)
case errors.Is(err, payments.ErrInvalidCard):
    http.Error(w, "invalid card", http.StatusBadRequest)
default:
    http.Error(w, "internal error", http.StatusInternalServerError)
}
```

The HTTP layer is the only place mapping happens. Inner code does not know about HTTP.

### Pattern 4: Test fixtures with throwaway errors

```go
func TestRetry(t *testing.T) {
    boom := errors.New("boom")
    fail := func() error { return boom }
    if err := withRetry(fail, 3); !errors.Is(err, boom) {
        t.Fatalf("expected boom, got %v", err)
    }
}
```

A local `boom` error is fine — it lives only for the test.

---

## Sentinel Naming Conventions

| Pattern | Example | Notes |
|---|---|---|
| Exported sentinel | `var ErrNotFound = errors.New("...")` | Prefixed with `Err`, capital initial. |
| Unexported sentinel | `var errBadInput = errors.New("...")` | Lowercase if internal-only. |
| Package prefix in message | `errors.New("store: not found")` | Helps log readers locate the source. |
| No trailing punctuation | `errors.New("not found")` not `"not found."` | Standard convention. |
| Lowercase first character | `errors.New("not found")` not `"Not found"` | So errors compose into longer sentences cleanly. |

These are not laws — they are conventions. Following them lets your code blend in with the standard library and the wider ecosystem.

---

## Testing With `errors.New`

In tests, `errors.New` is your friend for two reasons:

1. **Injecting controlled failures.** Mock a dependency to return a known error.
2. **Asserting matches.** Compare with `errors.Is` to confirm the system propagates the error you expect.

```go
func TestService_PropagatesGatewayError(t *testing.T) {
    sentinel := errors.New("gateway down")
    fakeGateway := &Fake{err: sentinel}
    svc := NewService(fakeGateway)

    err := svc.Charge(ctx, 1, 100)
    if !errors.Is(err, sentinel) {
        t.Fatalf("expected wrapped sentinel, got %v", err)
    }
}
```

When testing your *own* sentinels:

```go
err := store.Get(missingID)
if !errors.Is(err, store.ErrNotFound) {
    t.Fatalf("got %v, want ErrNotFound", err)
}
```

Avoid string-matching error messages in tests:

```go
// BAD
if err.Error() != "not found" { ... }

// GOOD
if !errors.Is(err, store.ErrNotFound) { ... }
```

String matching breaks the moment someone wraps the error with `fmt.Errorf("...: %w", err)`.

---

## Common Anti-Patterns

### Anti-pattern 1: Comparing two ad-hoc errors

```go
// BAD
if err == errors.New("not found") { ... } // always false
```

`errors.New` on the right-hand side is a fresh allocation. Use a sentinel.

### Anti-pattern 2: Building messages with `+`

```go
// BAD
return errors.New("user " + name + " not found")

// GOOD
return fmt.Errorf("user %q not found", name)
```

`fmt.Errorf` is the right tool for variable content.

### Anti-pattern 3: Using `errors.New` to "wrap"

```go
// BAD — flattens the chain
return errors.New("loading: " + err.Error())

// GOOD
return fmt.Errorf("loading: %w", err)
```

`%w` preserves identity; concatenation destroys it.

### Anti-pattern 4: Creating a sentinel inside a function

```go
// BAD
func f() error {
    var ErrFoo = errors.New("foo") // re-allocated every call
    return ErrFoo
}
```

Move the declaration to package scope.

### Anti-pattern 5: Logging plus returning

```go
// BAD
if err != nil {
    log.Println(err)
    return err
}
```

Pick one. The caller will log if they need to.

### Anti-pattern 6: Empty messages

```go
// BAD
return errors.New("")
```

Useless to the caller and to logs. Always provide a meaningful description.

---

## Migration Path: From Strings to Types

Many Go libraries start with `errors.New` sentinels and grow into typed errors. The migration is gradual:

### Stage 1: only sentinels

```go
var ErrInvalidInput = errors.New("invalid input")
```

Works fine until callers want to know *what specifically* was invalid.

### Stage 2: sentinels plus `fmt.Errorf` wrapping

```go
return fmt.Errorf("invalid input %q: %w", input, ErrInvalidInput)
```

The string carries detail; `errors.Is` still finds the sentinel.

### Stage 3: introduce a typed error

```go
type ValidationError struct {
    Field   string
    Reason  string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: field %s: %s", e.Field, e.Reason)
}
```

The sentinel can become a category — match either a sentinel **or** a `*ValidationError` with `errors.As`.

### Stage 4: keep the sentinel as the matchable category

```go
var ErrValidation = errors.New("validation failed")

func (e *ValidationError) Is(target error) bool {
    return target == ErrValidation
}
```

Now `errors.Is(err, ErrValidation)` matches any `*ValidationError`. You have a type for structure, a sentinel for identity. This is the hybrid every mature Go library converges on.

`errors.New` stays in your toolbox the entire way — even at stage 4 it is the simplest way to declare the matchable category.

---

## Summary

`errors.New` is a one-line function that hides three lessons: errors are pointers, identity is by allocation, and reuse beats per-call construction. Treat sentinels as a public part of your package's API; declare them once, document them, and prefer `errors.Is` over `==`. Reach for `fmt.Errorf` the moment you need formatting or wrapping. As your library grows, `errors.New` does not go away — it becomes the underlying constructor for the categories your richer types signal.

---

## Further Reading

- [pkg.go.dev: errors package](https://pkg.go.dev/errors)
- [The Go Blog: Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Effective Go: Errors](https://go.dev/doc/effective_go#errors)
- [Dave Cheney: Don't just check errors, handle them gracefully](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- Source: `$GOROOT/src/errors/errors.go`
