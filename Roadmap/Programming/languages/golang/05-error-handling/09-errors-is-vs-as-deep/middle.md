# errors.Is vs errors.As — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Algorithm: How `Is` and `As` Walk the Chain](#the-algorithm-how-is-and-as-walk-the-chain)
3. [Custom `Is` Methods](#custom-is-methods)
4. [Custom `As` Methods](#custom-as-methods)
5. [The Comparable Trap](#the-comparable-trap)
6. [Multi-Error Trees Post Go 1.20](#multi-error-trees-post-go-120)
7. [`errors.Join` and Its Quirks](#errorsjoin-and-its-quirks)
8. [`fmt.Errorf` with Multiple `%w`](#fmterrorf-with-multiple-w)
9. [Designing Error Families](#designing-error-families)
10. [Sentinel vs Typed: When to Pick Each](#sentinel-vs-typed-when-to-pick-each)
11. [Pre-1.13 Code and Migration](#pre-113-code-and-migration)
12. [Common Anti-Patterns](#common-anti-patterns)
13. [Testing `Is`/`As` Behavior](#testing-isas-behavior)
14. [Cost Awareness](#cost-awareness)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "Why?" and "When?"

At junior level you learned the *what*: `Is` for sentinels, `As` for typed errors. At middle level you write the error types other people consume. Suddenly you face a series of harder questions: *Should this error be a sentinel or a typed value? Should it implement a custom `Is` method? Where in my package should I put the export? When does it make sense to join errors instead of wrapping?*

This file is the answer set: **what the algorithm actually does, what the standard library guarantees, what costs each call, and how to design errors so callers can use `Is`/`As` cleanly.**

---

## The Algorithm: How `Is` and `As` Walk the Chain

Both functions implement a **chain walk** with the same control flow but different match rules. Pseudocode for `errors.Is`:

```go
func Is(err, target error) bool {
    if target == nil {
        return err == target
    }
    isComparable := reflectlite.TypeOf(target).Comparable()
    for {
        if isComparable && err == target {
            return true
        }
        if x, ok := err.(interface{ Is(error) bool }); ok && x.Is(target) {
            return true
        }
        // Walk to the next link.
        switch x := err.(type) {
        case interface{ Unwrap() error }:
            err = x.Unwrap()
            if err == nil {
                return false
            }
        case interface{ Unwrap() []error }:
            for _, sub := range x.Unwrap() {
                if Is(sub, target) {
                    return true
                }
            }
            return false
        default:
            return false
        }
    }
}
```

For `errors.As`:

```go
func As(err error, target any) bool {
    // 1. Validate target: non-nil pointer to type that implements error,
    //    or pointer to interface type. Else: panic.
    val := reflect.ValueOf(target)
    typ := val.Type()
    targetType := typ.Elem()
    // 2. Walk:
    for err != nil {
        if reflect.TypeOf(err).AssignableTo(targetType) {
            val.Elem().Set(reflect.ValueOf(err))
            return true
        }
        if x, ok := err.(interface{ As(any) bool }); ok && x.As(target) {
            return true
        }
        switch x := err.(type) {
        case interface{ Unwrap() error }:
            err = x.Unwrap()
        case interface{ Unwrap() []error }:
            for _, sub := range x.Unwrap() {
                if As(sub, target) {
                    return true
                }
            }
            return false
        default:
            return false
        }
    }
    return false
}
```

Three things matter:

1. **The chain is single-linked through `Unwrap() error` and tree-linked through `Unwrap() []error`.** Both interfaces are checked at every node.
2. **Custom methods are tried after the default rule.** The default rule for `Is` is `err == target`; for `As` it is assignability. The custom method is a fallback that lets you broaden the match.
3. **Multi-error walk is depth-first, pre-order, short-circuit on first match.** A joined error of `[a, b, c]` is walked: full subtree of `a`, then full subtree of `b`, then full subtree of `c`. The first match wins.

The actual standard library code lives in `$GOROOT/src/errors/wrap.go`. Read it once; it is short and clarifying.

---

## Custom `Is` Methods

A type can override the default equality rule with:

```go
func (e *MyErr) Is(target error) bool { /* ... */ }
```

The method takes the *target* of the comparison (the second arg of `errors.Is`) and returns whether `e` should be considered "the same as" `target`. Note: the receiver and target are not symmetric. `errors.Is(err, target)` calls `err.Is(target)`, not `target.Is(err)`.

### Use case 1: Map an enum-like type to multiple sentinels

```go
type FSError int

const (
    FSNotFound FSError = iota + 1
    FSPermission
    FSExists
)

func (e FSError) Error() string { return "fs error" }

func (e FSError) Is(target error) bool {
    switch e {
    case FSNotFound:
        return target == os.ErrNotExist
    case FSPermission:
        return target == os.ErrPermission
    case FSExists:
        return target == os.ErrExist
    }
    return false
}

// Caller:
errors.Is(myFSErr, os.ErrNotExist) // works for FSNotFound
```

### Use case 2: Equate values that are conceptually the same

```go
type httpStatusErr struct{ Code int }

func (e *httpStatusErr) Error() string { return http.StatusText(e.Code) }

// Treat any 4xx as a generic ErrClient
func (e *httpStatusErr) Is(target error) bool {
    if target == ErrClient && e.Code >= 400 && e.Code < 500 {
        return true
    }
    return false
}
```

Now `errors.Is(someHTTPErr, ErrClient)` is true for any 4xx, even though the receiver is a single typed error.

### Caveats with custom `Is`

- The method runs at every walk step; an expensive `Is` slows down deep chains.
- A method that returns `true` unconditionally hides everything past it.
- Symmetry is up to you. `errors.Is(a, b)` may be true while `errors.Is(b, a)` is false.
- The method must handle nil-receiver-style scenarios safely if your type can be a nil pointer.

---

## Custom `As` Methods

A type can override assignment with:

```go
func (e *MyErr) As(target any) bool { /* ... */ }
```

The method receives the same `target` passed to `errors.As`. Inside, the type does its own type switch on `target` and writes to it.

### Use case 1: Expose a derived value, not the receiver itself

```go
type databaseErr struct {
    code int
    inner error
}

func (e *databaseErr) Error() string { return e.inner.Error() }

func (e *databaseErr) As(target any) bool {
    if t, ok := target.(*int); ok {
        *t = e.code
        return true
    }
    return false
}

var code int
errors.As(err, &code) // sets code = e.code
```

### Use case 2: Provide a typed view of a wrapped object

```go
type serviceErr struct {
    err  error
    span *tracing.Span
}

func (e *serviceErr) Error() string { return e.err.Error() }
func (e *serviceErr) Unwrap() error { return e.err }

func (e *serviceErr) As(target any) bool {
    if t, ok := target.(**tracing.Span); ok {
        *t = e.span
        return true
    }
    return false
}
```

This lets `errors.As(err, &span)` extract the trace span without exposing the wrapper struct.

### Caveats with custom `As`

- It must check the target type before writing — writing to the wrong type panics.
- It can be used to "fake" type matches in surprising ways. Reviewers should look hard at any `As` method.
- It is checked **after** the default assignability rule. If the receiver itself is assignable to `*target`, you never hit the custom method.

---

## The Comparable Trap

Sentinel matching uses Go's `==` operator, which **panics** at runtime when both operands are non-comparable types. The `errors.Is` implementation guards against this with a `Comparable()` check, but there is still a subtle trap:

```go
type bagErr struct {
    fields []string  // makes the struct non-comparable
}

func (e bagErr) Error() string { return "bag" }

var ErrEmpty = bagErr{} // sentinel of non-comparable type

// Now a caller does:
errors.Is(someError, ErrEmpty)
```

`errors.Is` will check `target.Comparable()` first; for our `bagErr` it is false, so the equality fallback never runs. The function returns `false` *unless* `someError` happens to implement `Is(target) bool`. So a non-comparable sentinel silently *never matches by default*. You will not get a panic; you will get false negatives. That is worse.

Rule: **sentinels must be comparable.** Use `errors.New("...")` (returns a pointer to a struct with one string — comparable) or pointers to your own types. Avoid struct sentinels with slice/map/func fields.

---

## Multi-Error Trees Post Go 1.20

Go 1.20 added the optional method:

```go
type unwrapMulti interface { Unwrap() []error }
```

A type implementing this declares it has multiple wrapped causes. `errors.Is` and `errors.As` will:

1. Try the node itself (default match + custom method).
2. If no match, recursively walk **each** error in the returned slice, in order, **depth first**, returning on first match.

```go
type joined struct{ errs []error }

func (j *joined) Error() string  { /* concatenate */ return "..." }
func (j *joined) Unwrap() []error { return j.errs }
```

Built-in producers:

- `errors.Join(errs...)` — the canonical constructor.
- `fmt.Errorf` with multiple `%w` verbs (Go 1.20+).

A node may implement *both* `Unwrap() error` and `Unwrap() []error`. The standard library checks the multi-error variant first. Most types implement only one; mixing both is rare and confusing.

### Pre-order DFS visualized

```
              root
             /  |  \
            a   b   c
           / \      |
          a1 a2     c1
```

Walk order for `errors.Is(root, target)`:
`root` → `a` → `a1` → `a2` → `b` → `c` → `c1`. First match returns immediately.

This means: if `target` is at `c1`, you walk through *every* node in `a`'s subtree first. With a deeply joined tree, that can be expensive.

---

## `errors.Join` and Its Quirks

```go
func Join(errs ...error) error
```

Reference behavior:
- `Join()` (no args) returns nil.
- `Join(nil, nil, nil)` returns nil.
- `Join(err)` returns a wrapper, **not** `err` itself. Even with one argument, you get a multi-error node. (Subtle, but documented.)
- `Join(a, nil, b)` skips the nil and wraps `[a, b]`.
- `Join(a, b).Error()` returns `a.Error() + "\n" + b.Error()`.

Pitfalls:

```go
var first, second error
err := errors.Join(first, second)
// err is nil if both are nil. Easy bug:
fmt.Println(err == nil) // true if both inputs are nil
```

That is intentional and matches the convention "an error is non-nil only when something went wrong." Code that always uses `Join` to accumulate errors should check the result against nil at the end, not at every step.

```go
var errs []error
for _, x := range items {
    if err := process(x); err != nil {
        errs = append(errs, err)
    }
}
return errors.Join(errs...) // nil if errs is empty
```

`Join` is **not** symmetric with `Unwrap`: a single-arg `Join(err)` produces a wrapper whose `Unwrap()` returns `[]error{err}`, not `err`. So `errors.Unwrap(errors.Join(err))` returns `nil` (because `Unwrap()` here is the single-error variant which `joined` does not implement). This catches people out.

---

## `fmt.Errorf` with Multiple `%w`

Since Go 1.20, you can wrap multiple errors in one `fmt.Errorf`:

```go
err := fmt.Errorf("op failed: %w; also: %w", a, b)
```

Internally this produces a wrapper with `Unwrap() []error` returning `[a, b]`. `errors.Is(err, b)` is true; `errors.Is(err, a)` is true.

A few rules:
- Each `%w` must correspond to a non-nil error argument; otherwise `fmt.Errorf` panics.
- Up to N `%w` verbs are allowed (no hard cap, but using more than two is rare).
- `errors.Unwrap(err)` (the single-error variant) returns nil for multi-`%w` wrappers.

```go
e1 := errors.New("network down")
e2 := errors.New("disk full")
combined := fmt.Errorf("startup failed: %w and %w", e1, e2)

errors.Is(combined, e1)        // true
errors.Is(combined, e2)        // true
errors.Unwrap(combined)        // nil (it's a multi-wrap)
```

---

## Designing Error Families

A "family" of related errors lets callers say `errors.Is(err, ErrFamily)` once instead of matching each variant. Two designs:

### Design A: A single sentinel, multiple fields

```go
var ErrIO = errors.New("io error")

type ioError struct {
    op  string
    err error
}
func (e *ioError) Error() string { return e.op + ": " + e.err.Error() }
func (e *ioError) Unwrap() error { return e.err }
func (e *ioError) Is(target error) bool { return target == ErrIO }
```

Now any `*ioError` matches `ErrIO`, regardless of what `op` is. Callers get one match line; subsequent `As` extracts details.

### Design B: Multiple sentinels, one umbrella with custom `Is`

```go
var (
    ErrIO        = errors.New("io error")
    ErrIOTimeout = errors.New("io timeout")
    ErrIOClosed  = errors.New("io closed")
)

type ioError struct{ kind error; err error }

func (e *ioError) Error() string { return e.kind.Error() + ": " + e.err.Error() }
func (e *ioError) Unwrap() error { return e.err }
func (e *ioError) Is(target error) bool {
    return target == ErrIO || target == e.kind
}
```

Callers can match on `ErrIO` (broad) or on `ErrIOTimeout` (narrow). The custom `Is` makes both work without the caller having to do anything special.

### Design C: An interface that callers check via `As`

```go
type Temporary interface {
    Temporary() bool
}

type tempErr struct{ err error }
func (e *tempErr) Error() string { return e.err.Error() }
func (e *tempErr) Unwrap() error { return e.err }
func (e *tempErr) Temporary() bool { return true }

// Caller:
var t Temporary
if errors.As(err, &t) && t.Temporary() {
    retry()
}
```

This pattern matches `net.Error` and similar. The interface lives in your public API; concrete types implement it; callers extract by interface, not by concrete type. Very flexible.

---

## Sentinel vs Typed: When to Pick Each

| Question | Choose |
|----------|--------|
| Caller only needs to *detect* the error, no fields. | Sentinel. |
| Caller needs the file path, status code, retry-after, etc. | Typed. |
| There are many specific cases sharing a common kind. | Both — typed errors with a custom `Is` returning a kind sentinel. |
| You want callers to retry on a property (idempotent, temporary). | Interface, accessed via `errors.As`. |
| You return errors from a third-party library you do not control. | Wrap with `%w` and re-export a sentinel that your package owns. |

A simple rule: **start with a sentinel. Promote to a typed error only when callers ask for fields.** It is easy to add a typed error later (your sentinel becomes its `Is` target). It is hard to remove fields once they are exposed.

---

## Pre-1.13 Code and Migration

Before Go 1.13:
- No `%w`, no `errors.Is`, no `errors.As`.
- `pkg/errors` (Dave Cheney) introduced `errors.Wrap`, `errors.Cause`, with stack support.
- Many codebases used a `Causer` interface: `interface{ Cause() error }`.

Migrating an old codebase:

1. Replace `errors.Wrap(err, msg)` with `fmt.Errorf("%s: %w", msg, err)`.
2. Replace `errors.Cause(err)` with a `for { errors.Unwrap(...) }` loop or with `errors.Is`/`errors.As`.
3. Add `Unwrap()` methods to any custom error wrapper that holds an `inner error`.
4. Update sentinel match sites: `if err == ErrFoo` → `if errors.Is(err, ErrFoo)`.

A `tools/analysis` lint check (`errorlint`, `wrapcheck`) helps. Most importantly, leave `pkg/errors`'s `WithStack` semantics behind unless you really need stacks; the stdlib does *not* add stacks.

---

## Common Anti-Patterns

### Anti-pattern 1: `errors.Is(err, errors.New("not found"))`

```go
if errors.Is(err, errors.New("not found")) { ... }
```

Each call to `errors.New` returns a *new* pointer. `==` against it is always false. This is a classic. Use a package-level sentinel instead.

### Anti-pattern 2: Returning the same sentinel value with different meanings

```go
return ErrFoo // for case A
return ErrFoo // for case B with different recovery
```

Once a sentinel is returned for two cases, callers cannot distinguish them. Either split into two sentinels or attach a typed wrapper with a kind field.

### Anti-pattern 3: A custom `Is` that compares messages

```go
func (e *myErr) Is(target error) bool {
    return e.Error() == target.Error()
}
```

Strings are not error identity. This breaks the moment a wrapper changes the message. Use type, kind, or pointer comparison.

### Anti-pattern 4: `As` with a non-pointer interface variable

```go
var pe os.PathError // value, not pointer
errors.As(err, &pe) // false — *os.PathError is not assignable to *os.PathError-by-value
```

`os.Open` returns `*os.PathError` (pointer). Your target must be `var pe *os.PathError`.

### Anti-pattern 5: Swallowing the error after `As`

```go
var pe *os.PathError
if errors.As(err, &pe) {
    log.Print(pe.Path)
    // no return, no rewrap — the original err keeps flowing as if nothing happened
}
return err
```

`As` is a *read*. It does not consume the error. If you want to react to the typed case, do so explicitly (return early, transform, etc.).

### Anti-pattern 6: Wrapping a sentinel inside the same package

```go
var ErrNotFound = errors.New("not found")

func find(...) error {
    return fmt.Errorf("find: %w", ErrNotFound)
}
```

Functionally fine. But callers calling `errors.Is(err, ErrNotFound)` get true regardless of whether the error is the sentinel itself or a wrapped version. Make sure the contract you document matches what your package returns; otherwise users will write `if err == ErrNotFound` and be surprised.

---

## Testing `Is`/`As` Behavior

Treat error matching as part of your public API. Test it.

```go
func TestNotFoundIsMatchable(t *testing.T) {
    err := repo.Find(ctx, 0) // returns wrapped ErrNotFound
    if !errors.Is(err, repo.ErrNotFound) {
        t.Fatalf("expected ErrNotFound; got %v", err)
    }
}

func TestValidationErrorIsExtractable(t *testing.T) {
    err := svc.Create(ctx, "")
    var ve *svc.ValidationError
    if !errors.As(err, &ve) {
        t.Fatalf("expected *ValidationError; got %v", err)
    }
    if ve.Field == "" {
        t.Fatalf("expected Field to be set; got %#v", ve)
    }
}
```

Add tests for *negative* cases too:

```go
func TestNotFoundDoesNotMatchOtherErrors(t *testing.T) {
    err := repo.Find(ctx, validID) // returns nil
    if errors.Is(err, repo.ErrNotFound) {
        t.Fatalf("nil should not match ErrNotFound")
    }
}
```

A nice trick: when you change a sentinel from `errors.New` to a custom type with an `Is` method, the existing tests must keep passing. That is your safety net.

---

## Cost Awareness

The standard-library implementation is cheap, but not free.

| Operation | Approximate cost on amd64 |
|-----------|---------------------------|
| `errors.Is` against an unwrapped sentinel match | ~3-10 ns |
| `errors.Is` walking 5 wraps | ~20-40 ns |
| `errors.As` with successful match at depth 0 | ~30-60 ns (one reflect call) |
| `errors.As` walking 5 wraps with a miss | ~150-300 ns |
| `errors.Is` on a 100-element multi-error (no match) | ~500-1000 ns |

Rules of thumb:
- A handful of `Is`/`As` per request is invisible.
- Hundreds of thousands of `As` per second start to show up in profiles.
- Joined errors with hundreds of children are slow to walk.
- Allocation: `Is` is allocation-free; `As` *can* allocate inside `reflect.ValueOf(target).Elem()` but in practice does not for typical pointer-to-pointer patterns.

If you have an inner loop matching errors, prefer `Is` over `As` and prefer direct type assertion over both when no wrapping is involved.

---

## Summary

`errors.Is` walks the chain doing equality checks (with custom `Is(target) bool` overrides). `errors.As` walks the chain doing assignability checks (with custom `As(any) bool` overrides). Both understand `Unwrap() error` (single chain) and `Unwrap() []error` (tree). Wrap with `%w`. Make sentinels comparable. Reach for typed errors when callers need fields. Reach for interfaces when many concrete types share a property. Test the matching as part of your public API.

---

## Further Reading

- [Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [errors.Join and multi-error in Go 1.20](https://go.dev/doc/go1.20#errors)
- [pkg.go.dev/errors](https://pkg.go.dev/errors)
- [pkg.go.dev/fmt#Errorf](https://pkg.go.dev/fmt#Errorf)
- [Error Handling and Go (Andrew Gerrand)](https://go.dev/blog/error-handling-and-go)
- [`errorlint` linter](https://github.com/polyfloyd/go-errorlint)
- [`go-cmp` for cmpopts.EquateErrors](https://pkg.go.dev/github.com/google/go-cmp/cmp/cmpopts#EquateErrors)
