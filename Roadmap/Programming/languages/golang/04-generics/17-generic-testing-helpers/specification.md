# Generic Testing Helpers — Specification

## Table of Contents
1. [Source of truth](#source-of-truth)
2. [The `testing` package surface](#the-testing-package-surface)
3. [How generics interact with `testing`](#how-generics-interact-with-testing)
4. [`testing.TB` interface](#testingtb-interface)
5. [`t.Helper()` semantics](#thelper-semantics)
6. [`t.Run` and subtests](#trun-and-subtests)
7. [`testing.F` and fuzz tests](#testingf-and-fuzz-tests)
8. [Generics in test files: the same rules](#generics-in-test-files-the-same-rules)
9. [Release notes that affect testing helpers](#release-notes-that-affect-testing-helpers)
10. [What the spec does NOT say about test helpers](#what-the-spec-does-not-say-about-test-helpers)
11. [Summary](#summary)

---

## Source of truth

Two authoritative documents:

- **Go spec** — <https://go.dev/ref/spec> (generics rules apply unchanged in tests)
- **`testing` package documentation** — <https://pkg.go.dev/testing>

There is **no special section** in the Go spec for test helpers. They are normal generic functions. The `testing` package documentation describes what `*testing.T` and friends do; the rest is just Go.

Release notes that matter:

- [Go 1.18 — generics introduced](https://go.dev/doc/go1.18#generics)
- [Go 1.21 — `slices`, `maps`, `cmp` promoted](https://go.dev/doc/go1.21)
- [Go 1.22 — loop-var semantics improved](https://go.dev/doc/go1.22) — affects table-driven tests
- [Go 1.23 — range-over-func](https://go.dev/doc/go1.23) — useful for iterator tests

---

## The `testing` package surface

The relevant types for test helpers:

```go
package testing

type T struct { ... }
type B struct { ... }
type F struct { ... }
type TB interface {
    Cleanup(func())
    Error(args ...any)
    Errorf(format string, args ...any)
    Fail()
    FailNow()
    Failed() bool
    Fatal(args ...any)
    Fatalf(format string, args ...any)
    Helper()
    Log(args ...any)
    Logf(format string, args ...any)
    Name() string
    Setenv(key, value string)
    Skip(args ...any)
    SkipNow()
    Skipf(format string, args ...any)
    Skipped() bool
    TempDir() string
    private() // unexported — only stdlib types satisfy
}
```

Key observation: **`TB` is unexported-method-sealed**. You cannot implement it yourself. Helpers must accept the real types.

---

## How generics interact with `testing`

Generics in Go are a **language feature** — they do not change how `testing` works. A generic test helper is just a generic function. The compiler stencils it like any other.

### Things that work the same way

- `t.Helper()` works in generic helpers (it cares only about the call frame, not the function's type parameters)
- `t.Run(name, fn)` accepts a closure regardless of generics
- `t.Cleanup(fn)` registers a cleanup the same way
- `t.Parallel()` is fine in subtests inside generic runners

### Things that differ subtly

- **Stencil names appear in `pprof`** — generic helpers show as `pkg.Equal[go.shape.int_0]`
- **Failure stack traces** include the stenciled name. Readers must learn to parse this.
- **`go test -run`** works by subtest name. A generic runner that names subtests well makes filtering trivial: `go test -run TestX/case_three`.

---

## `testing.TB` interface

Quoting the spec by paraphrase:

> `TB` is the interface common to `T`, `B`, and `F`. It contains all methods on those types except those that are specific to one of them (like `Run` on `T`).

For generic helpers, accepting `testing.TB` is the **professional** default:

```go
func Equal[T comparable](tb testing.TB, got, want T) {
    tb.Helper()
    if got != want {
        tb.Errorf("got %v, want %v", got, want)
    }
}
```

This works in:

- `func TestX(t *testing.T)` — passes `t`
- `func BenchmarkX(b *testing.B)` — passes `b`
- `func FuzzX(f *testing.F)` — passes `f`
- `t.Run("...", func(t *testing.T) { Equal(t, ...) })` — passes the subtest's `*T`

The trade-off: you cannot call `tb.Run(...)` because `Run` is on `*T`, not `TB`. For a runner that needs subtests, accept `*testing.T` directly.

### Why the unexported `private()` method matters

The spec uses `private()` to make `TB` **sealed** — only stdlib types implement it. This protects the testing API: third-party "fake" `TB` implementations are not allowed. Generic helpers can rely on `tb` truly being a stdlib testing type.

---

## `t.Helper()` semantics

From the `testing` documentation:

> `Helper` marks the calling function as a test helper function. When printing file and line information, that function will be skipped. Helper may be called simultaneously from multiple goroutines.

Key points:

1. **Per-frame** — each function in the call chain that is a helper must call `Helper()`.
2. **Idempotent** — calling it twice in the same function is fine.
3. **Does not propagate** — a function that does NOT call `Helper()` is treated as the "real" caller.
4. **Goroutine-safe** — internal map of helper frames is concurrency-safe.

### The "first non-helper frame wins" rule

When `t.Errorf` runs, it walks up the call stack. The first frame that did NOT call `Helper()` is the line printed in failure messages. Generic helpers and their wrappers must all call `Helper()` for the line to point at the test.

### Generic helpers and `Helper()`

The fact that a function is generic does **not** affect `Helper()`. The call frame is still a real frame in the stack. `t.Helper()` works identically in `func Equal[T comparable](t *testing.T, ...)` and in `func equalInt(t *testing.T, ...)`.

---

## `t.Run` and subtests

`t.Run(name, fn)` creates a subtest. Subtests:

- Get their own `*testing.T`
- Can be filtered with `-run "TestX/sub"`
- Run sequentially by default; with `t.Parallel()` they run concurrently
- Have their own `Cleanup`s

Generic table-driven runners use `t.Run` to give each row its own subtest:

```go
for _, tc := range cases {
    t.Run(tc.Name, func(t *testing.T) {
        // tc is captured; in Go 1.22+ each iteration has its own copy
    })
}
```

### Loop-variable capture (Go 1.22+)

Before Go 1.22, `tc` in the loop above was **shared across iterations**. With `t.Parallel()`, all iterations would see the last `tc`. The fix was a per-iteration copy:

```go
for _, tc := range cases {
    tc := tc // local copy
    t.Run(tc.Name, func(t *testing.T) {
        t.Parallel()
        ...
    })
}
```

Go 1.22 changed the spec so `tc` is per-iteration by default. New code in 1.22+ does not need the local copy.

---

## `testing.F` and fuzz tests

Added in Go 1.18 alongside generics. Fuzz tests have a different shape:

```go
func FuzzReverse(f *testing.F) {
    f.Add("hello")
    f.Fuzz(func(t *testing.T, s string) {
        // generated input
        if reverse(reverse(s)) != s {
            t.Errorf("round trip failed: %q", s)
        }
    })
}
```

Generic helpers used inside `f.Fuzz` callbacks work exactly like in regular tests — the inner `t` is a normal `*testing.T`. The outer `f *testing.F` accepts seeds via `f.Add` and is not the target of assertions.

If you write helpers that need to run at the seed-collection level, accept `testing.TB` so they can be used in both spots.

---

## Generics in test files: the same rules

Test files (`*_test.go`) follow the same generics rules as production code. There are **no special exceptions**:

- Methods on a generic type cannot have their own type parameters
- `comparable` allows `==` and `!=` only
- `~T` widens to underlying types
- Type inference works the same way
- Constraints are interfaces with type elements

The only file-level distinction is the `_test.go` suffix, which:

- Enables access to unexported identifiers in the same package
- Allows the file to import test-only dependencies
- Is excluded from the normal build

None of these change generics behaviour.

---

## Release notes that affect testing helpers

| Release | Change | Effect on generic test helpers |
|---------|--------|-------------------------------|
| 1.18 | Generics; fuzzing | First version where generic helpers exist |
| 1.19 | Doc improvements | None |
| 1.20 | `errors.Join`; `comparable` looser | `errors.Is` still primary; `comparable` accepts more types |
| 1.21 | `slices`, `maps`, `cmp` in stdlib | Wrap them: most helpers shrink to one-liners |
| 1.22 | Per-iteration loop variables | Drop the `tc := tc` workaround |
| 1.23 | Range-over-func; `iter.Seq[T]` | Helpers for asserting on iterators become natural |
| 1.24 | Generic type aliases | Alias-based fixture types |

A modern testlib targets Go **1.21+** as the minimum because it lets the helpers wrap `slices.Equal`, `maps.Equal`, and `cmp.Or`.

---

## What the spec does NOT say about test helpers

The Go spec is explicitly silent on:

- **Naming conventions** — `Equal` vs `AssertEqual` vs `Eq`
- **Argument order** — `(t, got, want)` vs `(t, want, got)`
- **Use of `Errorf` vs `Fatalf`** — both are documented but the choice is the helper author's
- **Whether to wrap stdlib** — `slices.Equal` could be inlined; the wrapper is convention
- **DSLs** — fluent APIs are allowed but not endorsed by stdlib

These are **community conventions**, codified in projects' style guides rather than the language spec.

A senior testlib documents its conventions in `CONTRIBUTING.md` so reviewers can flag deviations.

---

## Summary

The Go specification handles test helpers through **two unrelated mechanisms** that interact cleanly:

1. **Generics** (Go 1.18) — type parameters with interface-based constraints
2. **`testing` package** — runtime support for `Helper()`, `Run()`, etc.

There is no "generic testing" specification. A generic test helper is just a generic function whose first parameter is `*testing.T` (or `testing.TB`). The compiler stencils it like any other generic; the runtime treats the call frame like any other frame; `t.Helper()` skips the frame in failure messages.

Key takeaways:

1. **Test helpers follow normal generic rules** — no special exceptions.
2. **`testing.TB`** is the right parameter for helpers used in tests, benchmarks, and fuzz seeds.
3. **`t.Helper()` is per-frame** — call it in every helper.
4. **Subtests** work seamlessly with generic runners; in Go 1.22+ loop-variable capture is automatic.
5. **Stdlib (1.21+) provides the building blocks** — `slices.Equal`, `maps.Equal`, `errors.Is`, `cmp.Diff`.

Knowing the spec is what lets you confidently write `func Equal[T comparable](tb testing.TB, got, want T)` — every word of that signature matches a documented rule.

Next: `interview.md` to drill the design rationale and common pitfalls.
