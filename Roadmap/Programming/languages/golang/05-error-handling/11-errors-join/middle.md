# errors.Join — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `Unwrap() []error` Interface](#the-unwrap-error-interface)
3. [Tree Walks: How `errors.Is` and `errors.As` See a Join](#tree-walks-how-errorsis-and-errorsas-see-a-join)
4. [Custom Multi-Error Types](#custom-multi-error-types)
5. [Validation: The Canonical Pattern](#validation-the-canonical-pattern)
6. [Cleanup and Defer-Based Collection](#cleanup-and-defer-based-collection)
7. [`fmt.Errorf` with Multiple `%w`](#fmterrorf-with-multiple-w)
8. [Pre-1.20 Patterns and Migration](#pre-120-patterns-and-migration)
9. [`hashicorp/multierror` and `uber-go/multierr`](#hashicorpmultierror-and-uber-gomultierr)
10. [Choosing Between Join and Chain](#choosing-between-join-and-chain)
11. [Pitfalls You Will Hit](#pitfalls-you-will-hit)
12. [Iterating the Tree](#iterating-the-tree)
13. [Practical Patterns](#practical-patterns)
14. [Anti-Patterns](#anti-patterns)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "Why?" and "When?"

At junior level you used `errors.Join` to gather a few validation errors. At middle level you start to *design* with it: deciding whether a function should collect or short-circuit, whether to wrap-then-join or join-then-wrap, when to write a custom multi-error type instead of using `Join` directly, and how the Go 1.20 changes to `fmt.Errorf` line up with the same machinery. You also start to deal with old code: services that have used `hashicorp/multierror` for years and need to migrate without breaking callers.

This file is the design playbook. The mechanics are simple; the choices are not.

---

## The `Unwrap() []error` Interface

The convention introduced in Go 1.20 is that any error type can implement:

```go
Unwrap() []error
```

If a type has this method, `errors.Is` and `errors.As` will visit each returned error in addition to (or instead of) the older `Unwrap() error`.

```go
type myMulti struct {
    children []error
}

func (m *myMulti) Error() string {
    var parts []string
    for _, c := range m.children {
        parts = append(parts, c.Error())
    }
    return strings.Join(parts, "; ")
}

func (m *myMulti) Unwrap() []error { return m.children }
```

That is it — three methods (`Error`, `Unwrap`, optionally a constructor). The standard library now treats your type as a first-class multi-error.

Notes:
- An error may implement *either* `Unwrap() error` *or* `Unwrap() []error`. If it implements both, the slice version wins — but writing both is asking for trouble.
- The slice should not be modified by callers. Some implementations copy on access; many do not. Treat it as read-only.
- A `nil` slice or empty slice means "no children" — perfectly legal but a sign you should have returned nil from your constructor.

---

## Tree Walks: How `errors.Is` and `errors.As` See a Join

`errors.Is(err, target)`:

1. Compares `err == target` (also handles `target` being a sentinel).
2. If `err` has an `Is(error) bool` method, calls it.
3. Otherwise unwraps `err` (single or slice) and recurses on each child.
4. Returns true on the first match.

`errors.As(err, &target)`:

1. Checks if `err` is assignable to `*target` and assigns + returns true.
2. If `err` has an `As(any) bool` method, calls it.
3. Otherwise unwraps `err` (single or slice) and recurses on each child.

Both are **DFS pre-order**. They visit the parent first, then the children left-to-right, descending into each before moving on. For a join of three nodes where each has its own `%w` wrap chain, the order is:

```
Join
  ├─ A      (visit, then descend)
  │   └─ A.cause
  │        └─ A.cause.cause
  ├─ B
  │   └─ B.cause
  └─ C
```

Visit order: Join, A, A.cause, A.cause.cause, B, B.cause, C.

This is important when a target appears multiple times in the tree — `Is` short-circuits at the *first* match. Keep that in mind if you have duplicates and care which one wins.

---

## Custom Multi-Error Types

`errors.Join` is the right answer 90% of the time. The remaining 10% is when you want:

- A **custom format** (JSON, table, indented).
- A **typed accessor** so callers can ask "give me only the validation errors".
- An **incremental builder** (`Append`) that mutates state instead of allocating new joinErrors.

A good template:

```go
type ValidationErrors struct {
    Errs []error
}

func (v *ValidationErrors) Error() string {
    if v == nil || len(v.Errs) == 0 {
        return "no errors"
    }
    var b strings.Builder
    b.WriteString(fmt.Sprintf("%d validation error(s):\n", len(v.Errs)))
    for i, e := range v.Errs {
        fmt.Fprintf(&b, "  %d) %s\n", i+1, e.Error())
    }
    return b.String()
}

func (v *ValidationErrors) Unwrap() []error { return v.Errs }

func (v *ValidationErrors) Add(err error) {
    if err == nil {
        return
    }
    v.Errs = append(v.Errs, err)
}

// AsError returns nil if there are no errors, otherwise the value as an error.
func (v *ValidationErrors) AsError() error {
    if v == nil || len(v.Errs) == 0 {
        return nil
    }
    return v
}
```

Use:

```go
func validate(u User) error {
    var v ValidationErrors
    if u.Name == "" {
        v.Add(errors.New("name required"))
    }
    if u.Age < 0 {
        v.Add(errors.New("age must be non-negative"))
    }
    return v.AsError()
}
```

You get all the benefits of `errors.Join` (`Is`, `As`, multi-error walk) plus pretty formatting and a typed accessor. The `AsError()` method is the trick — it converts the empty case to `nil` so the caller's `if err != nil` works.

---

## Validation: The Canonical Pattern

Validation is where `Join` shines. The pattern:

```go
type User struct {
    Email string
    Age   int
    Phone string
}

var (
    ErrEmailRequired = errors.New("email is required")
    ErrEmailFormat   = errors.New("email format invalid")
    ErrAgeRange      = errors.New("age must be 0..150")
    ErrPhoneFormat   = errors.New("phone format invalid")
)

func (u User) Validate() error {
    var errs []error
    if u.Email == "" {
        errs = append(errs, ErrEmailRequired)
    } else if !strings.Contains(u.Email, "@") {
        errs = append(errs, ErrEmailFormat)
    }
    if u.Age < 0 || u.Age > 150 {
        errs = append(errs, ErrAgeRange)
    }
    if u.Phone != "" && !validPhone(u.Phone) {
        errs = append(errs, ErrPhoneFormat)
    }
    return errors.Join(errs...)
}
```

Caller:

```go
if err := u.Validate(); err != nil {
    if errors.Is(err, ErrEmailRequired) {
        // route to email-specific page
    }
    return err
}
```

Three benefits:
1. The user sees every problem at once.
2. The caller can branch on individual sentinel errors via `errors.Is`.
3. The empty case naturally returns `nil`.

For richer field-aware errors, wrap each one:

```go
errs = append(errs, fmt.Errorf("Email: %w", ErrEmailFormat))
```

`errors.Is(err, ErrEmailFormat)` still works — the walker descends through the wrap.

---

## Cleanup and Defer-Based Collection

When you have to release several resources, you do not want one failure to abort the rest. `Join` is built for this:

```go
type Service struct {
    db   *sql.DB
    file *os.File
    sub  *pubsub.Subscription
}

func (s *Service) Close() error {
    var errs []error
    if err := s.db.Close(); err != nil {
        errs = append(errs, fmt.Errorf("db: %w", err))
    }
    if err := s.file.Close(); err != nil {
        errs = append(errs, fmt.Errorf("file: %w", err))
    }
    if err := s.sub.Close(); err != nil {
        errs = append(errs, fmt.Errorf("sub: %w", err))
    }
    return errors.Join(errs...)
}
```

Notice we wrap each child with a label *before* joining. Otherwise the user reads:

```
sql: connection refused
read /tmp/x: bad file descriptor
context canceled
```

…and has to guess which line goes with which resource. Wrapping with a label gives:

```
db: sql: connection refused
file: read /tmp/x: bad file descriptor
sub: context canceled
```

— same shape, much more useful.

The same applies to deferred cleanup:

```go
func process(path string) (err error) {
    f, openErr := os.Open(path)
    if openErr != nil {
        return openErr
    }
    defer func() {
        if cerr := f.Close(); cerr != nil {
            err = errors.Join(err, fmt.Errorf("close: %w", cerr))
        }
    }()
    return doWork(f)
}
```

The named return `err` is updated by the defer; if `doWork` returned a real error and `Close` also failed, the caller gets both. This pattern is the reason `errors.Join` exists in the first place — pre-1.20, you had to choose which one to return.

---

## `fmt.Errorf` with Multiple `%w`

Go 1.20 also extended `fmt.Errorf` to accept multiple `%w` verbs. Each one's argument is unwrapped, and the result implements `Unwrap() []error` exactly like `errors.Join`.

```go
err := fmt.Errorf("step1: %w, step2: %w", err1, err2)
errors.Is(err, sentinel) // walks both err1 and err2
```

Choose this over `Join` when:
- You want a custom **format** (delimiters, prefixes).
- You want **one** message line, not N newline-separated.
- You are passing the result through a system that prefers single-line errors (some loggers, some metric labels).

Choose `Join` when:
- The natural format is *list*-shaped.
- You have a slice of errors that did not start out individually named.

A quirk: `fmt.Errorf("%w", err)` (single `%w`) still produces a *single*-error wrap (`Unwrap() error`). The shape changes only when you have two or more `%w`. This is intentional — backward compatibility with all the code that relies on the single-error chain.

---

## Pre-1.20 Patterns and Migration

Code older than Go 1.20 used one of three approaches:

### Approach 1: Concatenate strings

```go
var msgs []string
for _, e := range errs {
    msgs = append(msgs, e.Error())
}
return errors.New(strings.Join(msgs, "; "))
```

**Loses** all structure — `errors.Is` no longer works against any sentinel inside.

**Migration:** swap `errors.New(strings.Join(...))` for `errors.Join(errs...)`. Mostly a one-line change.

### Approach 2: First-error-wins

```go
var first error
for _, e := range errs {
    if first == nil && e != nil {
        first = e
    }
}
return first
```

**Loses** every error after the first.

**Migration:** identify whether the caller relied on "the first error" being meaningful. If so, prepend it explicitly. If not, just `errors.Join(errs...)`.

### Approach 3: Custom multi-error type (most common)

The team rolled its own `MultiError` with `Append`, `Error`, sometimes `Unwrap`. Code looks like:

```go
var m *MultiError
for _, e := range errs {
    m = m.Append(e)
}
return m.ErrorOrNil()
```

**Migration:** can be incremental. Re-implement the type's methods to delegate to `errors.Join`:

```go
func (m *MultiError) Build() error {
    return errors.Join(m.errs...)
}
```

…or replace it outright with `errors.Join` plus a wrapper that gives you the formatting you want. Many teams find that once they switch, they no longer need the type.

---

## `hashicorp/multierror` and `uber-go/multierr`

Two packages dominated this space pre-1.20.

### `github.com/hashicorp/go-multierror`

```go
import "github.com/hashicorp/go-multierror"

var result *multierror.Error
for _, e := range errs {
    result = multierror.Append(result, e)
}
return result.ErrorOrNil()
```

Provides:
- `multierror.Append` — accumulator that returns nil if no errors.
- Custom formatter via `result.ErrorFormat`.
- `errors.Is`/`errors.As` integration (via its own `Unwrap()` predating Go 1.20).

**Migration to standard library:**

| Before | After |
|--------|-------|
| `multierror.Append(result, e)` | `errs = append(errs, e)` |
| `result.ErrorOrNil()` | `errors.Join(errs...)` |
| `result.WrappedErrors()` | iterate the result of `Unwrap() []error` |

You lose the custom formatter; if you need it, write your own type.

### `go.uber.org/multierr`

```go
import "go.uber.org/multierr"

err := multierr.Combine(err1, err2, err3)
```

Provides:
- `multierr.Combine` — variadic, semantics match `errors.Join`.
- `multierr.Append` — mutating add.
- `multierr.Errors(err)` — extract the slice (same as `Unwrap() []error`).

**Migration:** very direct. `multierr.Combine` → `errors.Join`. `multierr.Errors(err)` → call the `Unwrap() []error` method or use `errors.As` to find a `interface{ Unwrap() []error }` node.

For new code on Go 1.20+, prefer the standard library. The third-party packages are still maintained but offer little advantage.

---

## Choosing Between Join and Chain

| Question | Use |
|----------|-----|
| "Two unrelated failures from one operation." | `errors.Join` |
| "B happened *because* A happened." | `fmt.Errorf("...: %w", a)` (chain) |
| "I have a slice of equally-weighted failures." | `errors.Join(errs...)` |
| "I want one custom message and access to the underlying causes." | `fmt.Errorf("foo %w; %w", a, b)` |
| "I want a typed accessor or pretty formatting." | Custom type with `Unwrap() []error` |

The shape decision is *what kind of value should the consumer see*. If a developer reading the error log expects a list (validation, cleanup), join. If they expect a story ("could not load config: could not open file: permission denied"), chain.

---

## Pitfalls You Will Hit

### Pitfall 1: `Join(err)` is not `err`

```go
err := errors.Join(originalErr)
// err == originalErr  -> false
```

If you then write `if err == sentinel {`, it fails. Always use `errors.Is`.

### Pitfall 2: `errors.Unwrap` (the function) returns nil for joined errors

```go
err := errors.Join(a, b)
errors.Unwrap(err) // returns nil!
```

The package-level `Unwrap` only follows `Unwrap() error` (single). Use the method directly, or use `errors.As`:

```go
type unwrapper interface { Unwrap() []error }
if u, ok := err.(unwrapper); ok {
    children := u.Unwrap()
}
```

### Pitfall 3: `Join` does not flatten nested joins

```go
err := errors.Join(errors.Join(a, b), c)
// shape: Join(Join(a, b), c)  -- two levels of nesting
```

This is fine for `errors.Is` (the walker descends) but the printed text shows the structure literally. Flatten yourself if you want a single layer.

### Pitfall 4: `nil` survives if you build a slice manually

```go
errs := []error{nil, e1, nil}
errors.Join(errs...) // nils filtered, returns Join(e1)
```

That works because `Join` filters. But if you build *your own* multi-error type without filtering, `nil` children leak in. Your `Error()` calls `nil.Error()` and panics.

### Pitfall 5: Mutating the slice from `Unwrap() []error`

```go
children := joinedErr.(interface{ Unwrap() []error }).Unwrap()
children[0] = nil // BAD
```

The slice is internal state. Modify it and `errors.Is` later sees an inconsistent tree. The fix is "do not do that" — there is no compile-time barrier.

### Pitfall 6: A wrap of nothing

```go
return fmt.Errorf("config: %w", nil)
```

This produces an error whose `Error()` is "config: %!w(<nil>)". `errors.Is` does not work on it usefully. Always check the inner error first.

---

## Iterating the Tree

To walk every leaf of an error tree (joins inside chains inside joins…):

```go
func walk(err error, visit func(error)) {
    if err == nil {
        return
    }
    visit(err)
    switch x := err.(type) {
    case interface{ Unwrap() error }:
        walk(x.Unwrap(), visit)
    case interface{ Unwrap() []error }:
        for _, child := range x.Unwrap() {
            walk(child, visit)
        }
    }
}
```

DFS pre-order, matches `errors.Is`. Use it when:
- You want to log every distinct error in the tree.
- You want to count error kinds.
- You are implementing your own `Is`-like logic.

The standard library does not export a public walker — it walks internally inside `Is` and `As`. If you need iteration, write the function above.

---

## Practical Patterns

### Pattern A: Validator with `errors.Is` accessors

```go
func (u User) Validate() error {
    var errs []error
    if u.Email == "" {
        errs = append(errs, ErrEmailRequired)
    }
    if u.Age < 18 {
        errs = append(errs, ErrTooYoung)
    }
    return errors.Join(errs...)
}

// Caller:
err := u.Validate()
if errors.Is(err, ErrTooYoung) {
    return Forbidden(w, "must be 18+")
}
```

The validator returns one `error`; the caller probes it with `errors.Is`. No `switch` on a multi-error type needed.

### Pattern B: Per-resource cleanup

```go
func (s *Service) Close() error {
    return errors.Join(
        wrapClose("db", s.db),
        wrapClose("file", s.file),
        wrapClose("sub", s.sub),
    )
}

func wrapClose(name string, c io.Closer) error {
    if err := c.Close(); err != nil {
        return fmt.Errorf("%s: %w", name, err)
    }
    return nil
}
```

Each closer becomes a wrapped child or a `nil`. `Join` filters nils. You get one labeled error or `nil`.

### Pattern C: Defer-collect via named return

```go
func process(path string) (err error) {
    f, openErr := os.Open(path)
    if openErr != nil {
        return openErr
    }
    defer func() {
        if cerr := f.Close(); cerr != nil {
            err = errors.Join(err, fmt.Errorf("close: %w", cerr))
        }
    }()
    return doWork(f)
}
```

Already shown above. The most idiomatic Go 1.20+ pattern for "do something that returns an error, and also a cleanup that can fail".

### Pattern D: Migration shim

For a codebase still using `multierror`, a tiny adapter can let you flip the import without changing call sites:

```go
package multierror

import "errors"

type Error struct {
    errs []error
}

func (m *Error) ErrorOrNil() error {
    return errors.Join(m.errs...)
}

func Append(m *Error, e error) *Error {
    if m == nil {
        m = &Error{}
    }
    m.errs = append(m.errs, e)
    return m
}
```

Drop-in replacement that uses `errors.Join` underneath. Useful for incremental migrations.

### Pattern E: Bounded multi-error

For cases where collecting *every* error explodes memory:

```go
const maxErrs = 100

func collect(stream <-chan error) error {
    var errs []error
    for e := range stream {
        if e == nil {
            continue
        }
        if len(errs) < maxErrs {
            errs = append(errs, e)
        } else {
            errs[len(errs)-1] = fmt.Errorf("...and more (truncated): %w", e)
        }
    }
    return errors.Join(errs...)
}
```

Not always needed, but in batch jobs of millions of items it can save the log pipeline.

---

## Anti-Patterns

1. **`errors.Join(errs...)` followed by `err.Error()` parsed back into a slice.** You had the slice. Do not stringify and reparse — use `Unwrap() []error`.
2. **Joining inside a tight loop (`m = errors.Join(m, e)` per iteration).** Each call copies the underlying slice. Append into `[]error`, join once at the end.
3. **Returning `errors.Join()` (no args) "for symmetry".** It returns nil. Just return nil.
4. **Type-asserting to `*errors.joinError`.** It is unexported. Use the `Unwrap() []error` interface or `errors.As`.
5. **Using `errors.Join` for causal chains.** "Failed to load config" is *caused by* "file not found" — that is a chain (`%w`), not a join.
6. **Collecting `nil`s manually.** `errors.Join` already filters. `if err == nil { continue }` is safe but redundant when you append-then-Join.
7. **Implementing both `Unwrap() error` and `Unwrap() []error` on the same type.** Pick one; the slice version wins for `Is`/`As` and the single-error version is just confusing baggage.
8. **Modifying the slice returned by `Unwrap() []error`.** Read-only.
9. **Logging `len(joinedErr.(interface{ Unwrap() []error }).Unwrap())` as a metric.** Possible, but high cardinality if your validator can fail in many combinations.

---

## Summary

`errors.Join` is the small, sharp tool that turned multi-error handling from a third-party concern into a standard-library feature. The convention `Unwrap() []error` makes it an open extension point — your own types can be multi-errors with no library imports. Combined with the new multi-`%w` `fmt.Errorf`, the language now has a clean answer for both *cause-chains* and *sibling-collections*. Validation, cleanup, batched work — the same shape works everywhere. Migrate from `multierror` and `multierr` when you can; for the few cases where you need custom formatting, write a 30-line type. Watch for the small surprises (single-arg `Join` is still a wrap, `errors.Unwrap` does not see joins) and the rest is mechanical.

---

## Further Reading

- [Package errors — Join](https://pkg.go.dev/errors#Join)
- [Go 1.20 release notes — Wrapping multiple errors](https://go.dev/doc/go1.20#errors)
- [The Go Blog — Errors and Go 1.20](https://go.dev/blog/) (search "errors")
- [github.com/hashicorp/go-multierror](https://github.com/hashicorp/go-multierror)
- [go.uber.org/multierr](https://pkg.go.dev/go.uber.org/multierr)
- [Russ Cox — Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- `$GOROOT/src/errors/join.go` — short and readable.
- `$GOROOT/src/errors/wrap.go` — how `Is` and `As` walk the tree.
