# errors.Join — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is `errors.Join`?" and "When do I reach for it?"

Sometimes one operation can fail in more than one way at the same time. A form validator finds three problems with the same input. A `Close` method releases two resources and both fail. A worker pool runs ten jobs and four return errors. In each case the calling code wants *all* of the failures, not just the first one. Returning only the first throws away information; concatenating them into a string throws away the *structure* — you can no longer ask "did any of these wrap `os.ErrNotExist`?"

Go 1.20 added one tiny function for exactly this:

```go
err := errors.Join(err1, err2, err3)
```

The result is a single `error` value that **contains** the three errors. You can print it (newline-separated by default), test it with `errors.Is` and `errors.As` (which check every joined error), and unwrap it (it implements `Unwrap() []error`). It is the standard library's answer to a problem that the community had previously solved with at least four different third-party packages.

```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    a := errors.New("file missing")
    b := errors.New("permission denied")
    err := errors.Join(a, b)
    fmt.Println(err)
}
```

Output:

```
file missing
permission denied
```

Two errors, one value, printed on two lines. That is `errors.Join` in 30 seconds.

After reading this file you will:
- Know the signature and behavior of `errors.Join`.
- Know how `nil` arguments are handled (filtered).
- Be able to use `errors.Is` and `errors.As` against a joined error.
- Know the difference between `Join` (multi-error) and `fmt.Errorf("%w", ...)` (chain).
- Know when to use `Join` and when **not** to.

---

## Prerequisites

- **Required:** Basic error handling in Go — you know `if err != nil`.
- **Required:** `errors.New` and `fmt.Errorf` — you have created errors before.
- **Required:** `errors.Is` and `errors.As` (covered in 5.5) — `Join` interacts with them.
- **Helpful but not required:** `Unwrap() error` (single-error unwrap, also 5.5).
- **Helpful but not required:** Familiarity with one of the older multi-error libs (`hashicorp/multierror`, `uber-go/multierr`) — `Join` replaces them.

You should be on Go 1.20 or newer. The function does not exist in earlier versions.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`errors.Join`** | Standard-library function (Go 1.20+) that combines several errors into one. |
| **multi-error** | An `error` value that holds multiple distinct errors as siblings, not as a chain. |
| **error chain** | A linked list of errors created by repeated `fmt.Errorf("...: %w", err)`. Walked by `errors.Unwrap` returning a single error. |
| **error tree** | The graph you get when you mix chains and joins. `errors.Is`/`errors.As` walk it depth-first. |
| **`Unwrap() error`** | Single-error unwrap — turns one error into its predecessor. |
| **`Unwrap() []error`** | Multi-error unwrap (Go 1.20+) — turns one error into a slice of joined errors. |
| **joinError** | The internal type returned by `errors.Join` (unexported). |
| **filter nil** | `Join` drops `nil` arguments before storing; if all are `nil` it returns `nil`. |
| **leaf error** | An error in the tree that has no further `Unwrap` to follow. |

---

## Core Concepts

### Concept 1: `errors.Join` makes one error from several

The signature:

```go
func Join(errs ...error) error
```

You pass any number of errors (including zero); you get back either `nil` (if every argument was nil or there were no arguments) or one error value that contains the non-nil ones.

```go
err := errors.Join(errA, errB, errC)
```

Conceptually `err` is now a *bag* of three errors. Printing it concatenates their messages with newlines. Testing it with `errors.Is(err, target)` checks each one.

### Concept 2: nil arguments are filtered

The function ignores `nil` automatically:

```go
errors.Join(nil, nil)               // returns nil
errors.Join(err1, nil, err2)        // returns a join of {err1, err2}
errors.Join()                       // returns nil
errors.Join(nil)                    // returns nil
```

This is the biggest convenience of the function. You do not need to write `if err != nil { errs = append(errs, err) }` everywhere — pass them all in, the nils disappear.

But note this subtlety:

```go
err := errors.Join(err1)
// err is NOT == err1
// err is a 1-element joinError that wraps err1
```

Even with one non-nil argument, you still get a `*joinError`, *not* the original error. The wrapper is preserved so you can rely on `Unwrap() []error` and on the newline-separated `Error()` format.

### Concept 3: `Error()` is newline-separated

The default `Error()` method joins the messages with `\n`:

```go
err := errors.Join(
    errors.New("first"),
    errors.New("second"),
    errors.New("third"),
)
fmt.Println(err)
// first
// second
// third
```

Three lines, in input order. No prefix, no count, no separator other than newline. This is fine for human-readable logs and ugly for compact diagnostics. If you want a different format, build your own multi-error type (see middle.md) or join the strings yourself.

### Concept 4: `errors.Is` and `errors.As` walk into joined errors

```go
target := errors.New("not found")
err := errors.Join(otherErr, fmt.Errorf("wrap: %w", target))

if errors.Is(err, target) {
    fmt.Println("found target inside the join")
}
```

`errors.Is` walks the tree: it checks the join itself, then each child, recursively. `errors.As` does the same, finding the first error in the tree that matches the target type. You do not have to know how many errors are inside, or how deep — the walker handles it.

### Concept 5: It is *not* a chain

A common confusion: `Join` does **not** produce the same shape as `fmt.Errorf("%w: %w: %w", a, b, c)`. The two return distinct kinds of error trees:

- `fmt.Errorf("%w", x)` — wrapping. One error wraps another, single-line by default.
- `errors.Join(x, y)` — collection. One value holds many siblings, multi-line by default.

You can mix them — wrap a join, join some wraps — and the standard library walks both kinds correctly. But know which one you are reaching for.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| **`errors.Join`** | A school nurse stapling three "things wrong with this student today" forms together — sore throat, fever, missing assignment. |
| **`Unwrap() []error`** | The forms come unstapled when asked: each is its own complaint. |
| **nil filtering** | The nurse discards blank forms before stapling. |
| **`errors.Is` over a join** | "Does any of these forms mention strep?" — check each, return yes if any does. |
| **A wrap** | One form "Re: previous note" referring to an earlier diagnosis — a chain, not a sibling. |
| **A join inside a wrap** | A cover letter that says "see attachments below" plus the multi-form bundle. |

---

## Mental Models

**The bag model.** A joined error is a bag with non-nil errors inside. The bag itself is one `error` value; reaching in requires `Unwrap() []error`. Printing the bag prints each contents on its own line.

**The set-of-records model.** Think of the join as a row in a "validation results" table. Each child error is a separate record explaining one failure. The record set is what callers want to show the user, all at once.

**The tree model.** Once `Join` exists alongside the older `Unwrap() error`, every Go error is potentially a *tree*: nodes that wrap a single child, nodes that wrap many. `errors.Is` and `errors.As` are the visitors — DFS pre-order, accepting at the first match. You do not have to think about the shape; you just have to remember that the walkers handle both shapes.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Standard-library, no third-party dependency. | Requires Go 1.20+. |
| Tiny API: one function, one interface (`Unwrap() []error`). | The default `Error()` is plain newlines — no formatting hooks. |
| `errors.Is`/`As` work without effort across joins. | Naive use can hide context (which child of which parent failed?). |
| nil-filtering removes a class of boilerplate. | A 1-error join is *not* the same value as the bare error — surprises some tests. |
| Fits naturally with `fmt.Errorf` multi-`%w`. | No built-in way to collect errors *during* iteration — you still write the loop. |

### When to use:
- Aggregating validation errors so the user sees all problems at once.
- Closing several resources and reporting every failure.
- Returning the result of N parallel jobs where each can fail independently.

### When NOT to use:
- When the first error means "stop and back out" — return early, do not collect.
- When errors form a *causal* chain ("A failed because B failed because C") — that is `%w` wrapping, not joining.
- When you want a typed multi-error with custom formatting — write your own type implementing `Unwrap() []error`.

---

## Use Cases

- **Form / payload validation** — collect every field's error, present them as a list.
- **Resource cleanup** — call N closers, join the failures.
- **Batched goroutine work** — each goroutine reports an error; the dispatcher returns `Join` of them.
- **Configuration loading** — multiple sources fail in different ways; show them all.
- **Migration / replacement** — `errors.Join` replaces `multierror.Append` in most existing code.

---

## Code Examples

### Example 1: The minimal `Join`

```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    a := errors.New("a failed")
    b := errors.New("b failed")
    err := errors.Join(a, b)
    fmt.Println(err)
}
```

**What it does:** Combines two errors. `fmt.Println` prints them on two lines.

### Example 2: nil filtering

```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    err := errors.Join(nil, errors.New("only one"), nil)
    fmt.Println(err)
}
```

**What it does:** The nils are discarded; only `"only one"` ends up in the join.

### Example 3: All-nil returns nil

```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    err := errors.Join(nil, nil, nil)
    fmt.Println(err == nil)
}
```

**What it does:** Prints `true`. Useful: if every individual operation succeeded, the joined value is `nil` and your `if err != nil` check works as expected.

### Example 4: `errors.Is` against a join

```go
package main

import (
    "errors"
    "fmt"
    "io/fs"
)

func main() {
    err := errors.Join(
        errors.New("network glitch"),
        fmt.Errorf("config: %w", fs.ErrNotExist),
    )
    if errors.Is(err, fs.ErrNotExist) {
        fmt.Println("found ErrNotExist somewhere in the join")
    }
}
```

**What it does:** Even though `fs.ErrNotExist` is buried inside one of the joined errors, `errors.Is` finds it by walking the tree.

### Example 5: Validation collector

```go
package main

import (
    "errors"
    "fmt"
)

type User struct {
    Name  string
    Email string
    Age   int
}

func validate(u User) error {
    var errs []error
    if u.Name == "" {
        errs = append(errs, errors.New("name is required"))
    }
    if u.Email == "" {
        errs = append(errs, errors.New("email is required"))
    }
    if u.Age < 0 {
        errs = append(errs, errors.New("age must be non-negative"))
    }
    return errors.Join(errs...) // returns nil if errs is empty
}

func main() {
    err := validate(User{})
    if err != nil {
        fmt.Println("validation failed:")
        fmt.Println(err)
    }
}
```

**What it does:** The standard validation pattern. Collect into a slice, `Join` at the end, the empty case naturally yields `nil`.

> Every example must be runnable. Include `package main` and `func main()`.

---

## Coding Patterns

### Pattern 1: Append-and-Join

```go
var errs []error
for _, x := range xs {
    if err := process(x); err != nil {
        errs = append(errs, err)
    }
}
return errors.Join(errs...)
```

The most common shape. Append into a slice; one call at the end. nil-filtering means a clean run yields `nil`.

### Pattern 2: Defer-collect on close

```go
func close(a, b io.Closer) (err error) {
    if e := a.Close(); e != nil {
        err = errors.Join(err, e)
    }
    if e := b.Close(); e != nil {
        err = errors.Join(err, e)
    }
    return err
}
```

Close every resource; collect every failure. `errors.Join(nil, e)` becomes a 1-error join; passing in `nil` arguments is harmless.

### Pattern 3: Don't-stop-on-first

```go
var multi error
for _, step := range steps {
    if err := step(); err != nil {
        multi = errors.Join(multi, err)
    }
}
return multi
```

When the next step is independent of the previous, collect rather than stop. (Compare with the *opposite* pattern: short-circuit on first error.)

### Pattern 4: Combine-then-wrap

```go
errs := errors.Join(parseErrs...)
if errs != nil {
    return fmt.Errorf("parse failed: %w", errs)
}
```

Wrap the joined error to add context. The wrap chains over the join; `errors.Is`/`As` still walks both layers.

### Pattern 5: Multi-`%w` (Go 1.20+)

```go
return fmt.Errorf("save: %w; commit: %w", saveErr, commitErr)
```

Since Go 1.20, `fmt.Errorf` accepts more than one `%w`. The result implements `Unwrap() []error` just like `errors.Join`. Useful when you also want a custom formatted message.

---

## Clean Code

- **Use `Join` for siblings, `%w` for causes.** Two errors caused by the same operation = join. Error A caused by error B = wrap.
- **Pass slices with `...`**; do not `Join` in a loop unless you have a reason. `Join` allocates a new joinError each call.
- **Let the all-nil case work for you.** `Join` returns `nil` cleanly; do not pre-check for empties.
- **Wrap once, at a boundary.** Do not nest joins in joins arbitrarily — flatten.
- **Print or log the joined error in full.** Truncating it to one line discards the data the join exists to preserve.

---

## Product Use / Feature

A typical HTTP handler that validates and reports all failures at once:

```go
func createUserHandler(w http.ResponseWriter, r *http.Request) {
    var u User
    if err := json.NewDecoder(r.Body).Decode(&u); err != nil {
        http.Error(w, "bad request", http.StatusBadRequest)
        return
    }
    if err := validate(u); err != nil {
        // Send the user *all* the problems, not just the first.
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    // ... save user ...
}
```

The user submitting `{}` will see:

```
name is required
email is required
age must be non-negative
```

Three problems in one round-trip — the user fixes all three at once, instead of bouncing through three "Submit → fail → fix → repeat" cycles. That is the small UX win the multi-error pattern enables.

---

## Error Handling

- A joined error implements `Unwrap() []error` — *not* `Unwrap() error`. Code that calls `errors.Unwrap(err)` (the function) on a joined error gets `nil`.
- `errors.Is(err, target)` walks both `Unwrap() error` and `Unwrap() []error` interfaces. Use it; do not test the slice manually.
- `errors.As(err, &target)` does the same — it finds the first match in the tree.
- A joined error can itself be wrapped or joined. Trees can be deep; the walkers cope.
- Returning a joined error from a function works exactly like returning a plain error. The caller treats it as one `error` value.

---

## Security Considerations

- A joined error's default `Error()` puts every child's message on a separate line. If any child message contains user input or sensitive context, *all* of it ends up in your log. Sanitize at the source (the same way you would sanitize any error message).
- Multi-error messages can be much longer than single-error ones. Make sure your log infrastructure tolerates large records.
- Returning a joined validation error in an HTTP response leaks every validation rule the user violated. Usually fine for forms; sometimes a flag for an attacker to enumerate fields. Prefer a structured response (JSON list) over the raw `Error()` string for public APIs.

---

## Performance Tips

- `errors.Join` allocates a `*joinError` and copies its argument slice. The cost is a few hundred nanoseconds for typical inputs and one or two allocations.
- Calling `Join` once at the end of a loop is cheaper than calling it inside the loop and re-wrapping the previous join. Append into a slice; `Join(errs...)` at the bottom.
- Do not `Join` two `nil`s in a hot loop hoping it is free — it does walk the slice to filter, even if it returns `nil`.
- The `Error()` method calls `Error()` on each child and joins with newlines — proportional to total message length.
- See `optimize.md` for benchmark numbers and how to capture errors without per-iteration allocation.

---

## Best Practices

- **Use `errors.Join` instead of `multierror.Append`** in any new code on Go 1.20+.
- **Collect into a slice; `Join(errs...)` at the bottom** — one allocation, one place that can fail.
- **Keep child errors small.** A joined error of 50 errors with 10 KB messages each is 500 KB of log per failure.
- **Wrap before joining if context matters.** "Step 1 failed: …" is more useful than the bare child error inside a multi-error.
- **Implement `Unwrap() []error` on your own multi-error types** so they integrate with `errors.Is` and `errors.As` for free.
- **Test with `errors.Is`** to confirm sentinels survive a round-trip through `Join`.

---

## Edge Cases & Pitfalls

- **`errors.Join(err)` is not `err`.** A single-element join still wraps the error. `==` comparison fails; `errors.Is` still works.
- **`errors.Join()`** (zero args) returns `nil`.
- **`errors.Join(nil, nil)`** returns `nil`.
- **`errors.Unwrap(joined)`** (the *function*, not the method) returns `nil`. `Unwrap` only knows the single-error interface.
- **Type assertion to a custom multi-error type fails.** `errors.Join` returns `*errors.joinError` (unexported); you cannot type-assert to it. Use `errors.As(err, &slice)` if you need the children.
- **The slice returned from `Unwrap() []error` should not be mutated.** It is a view into internal state; modify it and the next `errors.Is` call sees garbage.
- **`Join` of `Join` is not flattened.** A nested join is itself a child error. The walkers see through it; printing shows the nesting only via newlines.

---

## Common Mistakes

1. **Reaching for `multierror` packages on a Go 1.20+ project.** Use the standard library.
2. **Manually formatting a multi-error string** with `strings.Join` instead of `errors.Join`. You lose `errors.Is`/`As`.
3. **Calling `errors.Unwrap(joined)`** and being surprised it returns `nil`. The function only follows `Unwrap() error`.
4. **Forgetting that a 1-element `Join` still wraps.** Tests that compare `==` to the input error fail.
5. **Joining inside a loop**: `multi = errors.Join(multi, err)` is fine but does N allocations; `append` then one `Join(...)` is cheaper.
6. **Mutating the slice from `Unwrap() []error`.** Treat it as read-only.
7. **Joining with `nil` "to keep things simple"** and then expecting `errors.Is(err, x)` to behave differently. nil children are dropped — they do not influence `Is`.

---

## Common Misconceptions

- **"`errors.Join(a)` is `a`."** It is not — the function always returns a `*joinError` for any non-nil input list.
- **"`Join` flattens nested joins."** It does not. `Join(Join(a, b), c)` is a 2-element joinError whose first child is itself a 2-element joinError.
- **"`errors.Unwrap` returns the slice."** No — the function `errors.Unwrap` returns a single error or nil. To get the slice you call the *method* `Unwrap() []error` (rare) or use `errors.As` to find a known node.
- **"`Join` is the same as `multierror.Append`."** Close, but `Append` mutates a result; `Join` is pure. The migration is mechanical, not identical.
- **"`Join` is for chaining causes."** No. Use `%w` for causes and `Join` for siblings.

---

## Tricky Points

- **Single-`%w` vs multi-`%w` in `fmt.Errorf`.** `fmt.Errorf("%w", err)` produces a single-error wrap (`Unwrap() error`). `fmt.Errorf("%w; %w", a, b)` produces a multi-error wrap (`Unwrap() []error`). Same `Errorf` call, two different result shapes depending on how many `%w`s you use.
- **`Join`'s argument order is preserved** — children appear in the order you passed them. The error message reflects that.
- **An error type can implement both `Unwrap() error` and `Unwrap() []error`.** The latter wins for `errors.Is`/`As`. Avoid having both unless you know exactly what you are doing.
- **`Join` does not deduplicate.** Pass the same error twice, you get it twice.

---

## Test

```go
package multi

import (
    "errors"
    "io/fs"
    "testing"
)

func TestJoinFiltersNil(t *testing.T) {
    err := errors.Join(nil, nil)
    if err != nil {
        t.Fatalf("expected nil, got %v", err)
    }
}

func TestIsWalksJoin(t *testing.T) {
    sentinel := fs.ErrNotExist
    err := errors.Join(errors.New("other"), sentinel)
    if !errors.Is(err, sentinel) {
        t.Fatalf("Is should find sentinel inside join")
    }
}

func TestJoinSingleStillWraps(t *testing.T) {
    inner := errors.New("inner")
    err := errors.Join(inner)
    if err == inner {
        t.Fatalf("single-arg Join should not return the original error")
    }
    if !errors.Is(err, inner) {
        t.Fatalf("Is should still match")
    }
}
```

Run with: `go test ./...`

---

## Tricky Questions

1. *What does `errors.Join()` (zero args) return?*
   `nil`.

2. *What does `errors.Join(nil, nil)` return?*
   `nil`. All-nil is the same as zero args after filtering.

3. *Is `errors.Join(err)` the same value as `err`?*
   No. It is a `*joinError` of one element. `errors.Is(err, original)` is true; `==` is false.

4. *How does `errors.Is` walk a joined error?*
   It checks the join itself, then visits each child in order, recursively (DFS pre-order).

5. *Why does `Join` use newlines in `Error()`?*
   Because that is the standard library's choice for human readability. Custom multi-errors can override.

6. *Does `fmt.Errorf("%w; %w", a, b)` produce the same shape as `errors.Join(a, b)`?*
   Almost. Both implement `Unwrap() []error`. The difference is that `Errorf` uses your format string for `Error()`; `Join` uses newline separation.

---

## Cheat Sheet

```go
import "errors"

// Combine
err := errors.Join(a, b, c)

// nil filtering
errors.Join(nil, nil)        // nil
errors.Join(err, nil)        // 1-element join
errors.Join()                // nil

// From a slice
err := errors.Join(errs...)

// Walk
errors.Is(err, target)        // visits every child
errors.As(err, &target)       // finds first match

// Multi-%w (1.20+)
fmt.Errorf("a: %w; b: %w", a, b)

// Inspecting children (rare)
type unwrapper interface{ Unwrap() []error }
if u, ok := err.(unwrapper); ok {
    children := u.Unwrap()
}
```

---

## Self-Assessment Checklist

- [ ] I know `errors.Join` was added in Go 1.20.
- [ ] I know that `errors.Join(nil, nil)` returns `nil`.
- [ ] I know that `errors.Join(err)` is *not* the same value as `err`.
- [ ] I can use `errors.Is` and `errors.As` against a joined error.
- [ ] I can write a validator that returns all errors at once via `Join`.
- [ ] I know the difference between `%w` (chain) and `Join` (siblings).
- [ ] I know that `Unwrap() []error` is the multi-error interface.
- [ ] I do not mutate the slice returned by `Unwrap() []error`.

---

## Summary

`errors.Join` is the standard-library answer to "I have several errors and want to return them as one." It filters nils, returns nil if everything was nil, and produces a value whose `Error()` is newline-separated and whose `Unwrap() []error` exposes the children to `errors.Is` and `errors.As`. It complements — it does not replace — `fmt.Errorf("%w", ...)`: chains are for causes, joins are for siblings. Reach for `Join` when validation errors should accumulate, when cleanup paths should not lose information, and whenever you used to import `hashicorp/multierror` or `uber-go/multierr`. Keep the children small, prefer one big `Join(...)` at the bottom of a loop over per-iteration nesting, and treat the slice returned by `Unwrap()` as read-only.

---

## What You Can Build

- A validator function that collects every field error and returns them as a single value the HTTP layer can pretty-print.
- A `MultiCloser` type that closes a list of `io.Closer`s, collecting every failure.
- A simple parallel runner that runs N jobs and returns `errors.Join` of every job's error.
- A migration shim that re-implements `multierror.Append` in terms of `errors.Join` so old call sites continue to work without third-party imports.

---

## Further Reading

- [Package errors — Join](https://pkg.go.dev/errors#Join)
- [Go 1.20 release notes — errors](https://go.dev/doc/go1.20#errors)
- [Russ Cox — Working with Errors](https://go.dev/blog/go1.13-errors) — background on `Is`/`As` (the same walker now handles joins)
- [github.com/hashicorp/go-multierror](https://github.com/hashicorp/go-multierror) — the older library `Join` displaces
- [go.uber.org/multierr](https://pkg.go.dev/go.uber.org/multierr) — Uber's variant
- `$GOROOT/src/errors/join.go` — read it; ~50 lines.

---

## Related Topics

- [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md) — `%w` and `Unwrap() error`; `Join` is the multi-error sibling.
- [06-sentinel-errors](../06-sentinel-errors/junior.md) — `errors.Is` against a join still finds sentinel children.
- [10-custom-error-types](../10-custom-error-types/junior.md) — implementing `Unwrap() []error` on your own multi-error type.
- [12-error-design-best-practices](../12-error-design-best-practices/junior.md) — when to collect vs short-circuit.

---

## Diagrams & Visual Aids

```
errors.Join(a, b, c):

   +-------------+
   | *joinError  |
   |  errs:      |
   |   [a, b, c] |
   +-------------+
        |
   ----------------------
   |        |           |
   v        v           v
   a        b           c
```

```
fmt.Errorf("%w", err)    vs    errors.Join(a, b)

   chain (single-error wrap)        tree (multi-error)

   wrap      a                       *joinError
    |                                 / \
    v                                a   b
    err
```

```
errors.Is(joined, target):

   visit joined           -- match? no, descend
     -> visit a           -- match? no
     -> visit b           -- match? no, has Unwrap() error?
        -> visit b.inner  -- match? yes -> return true
```

```
nil filtering:

  Join(nil, x, nil, y)   -->   *joinError{errs: [x, y]}
  Join(nil, nil)         -->   nil
  Join()                 -->   nil
```
