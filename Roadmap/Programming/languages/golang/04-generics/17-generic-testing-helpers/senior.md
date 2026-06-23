# Generic Testing Helpers — Senior Level

## Table of Contents
1. [Custom equality with `EqualFunc[T any]`](#custom-equality-with-equalfunct-any)
2. [Generic Diff helpers](#generic-diff-helpers)
3. [Comparing to `cmp.Diff` from go-cmp](#comparing-to-cmpdiff-from-go-cmp)
4. [Structuring an in-house testlib](#structuring-an-in-house-testlib)
5. [Designing the public API of helpers](#designing-the-public-api-of-helpers)
6. [Helpers for `*testing.B` and fuzz tests](#helpers-for-testingb-and-fuzz-tests)
7. [Trade-offs: helpers vs explicit checks](#trade-offs-helpers-vs-explicit-checks)
8. [Anti-patterns at scale](#anti-patterns-at-scale)
9. [Summary](#summary)

---

## Custom equality with `EqualFunc[T any]`

`comparable` covers basic types but fails for:

- Slices, maps, functions
- Floats with NaN or epsilon comparisons
- Domain types where business equality differs from value equality

For all of these, the senior pattern is `EqualFunc`:

```go
import "testing"

func EqualFunc[T any](t *testing.T, got, want T, eq func(T, T) bool) {
    t.Helper()
    if !eq(got, want) {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

Use:

```go
func TestPoint(t *testing.T) {
    EqualFunc(t,
        Point{X: 1.0, Y: 2.0},
        Point{X: 1.0, Y: 2.0},
        func(a, b Point) bool {
            return math.Abs(a.X-b.X) < 1e-9 && math.Abs(a.Y-b.Y) < 1e-9
        })
}
```

### Reusable comparator vocabulary

A senior testlib provides a small **vocabulary** of comparators rather than ad-hoc lambdas:

```go
package testutil

import "math"

func FloatNear(eps float64) func(a, b float64) bool {
    return func(a, b float64) bool {
        return math.Abs(a-b) <= eps
    }
}

func PointerEqual[T comparable]() func(a, b *T) bool {
    return func(a, b *T) bool {
        switch {
        case a == nil && b == nil: return true
        case a == nil || b == nil: return false
        default: return *a == *b
        }
    }
}
```

These compose cleanly with `EqualFunc` and `slices.EqualFunc`.

### NaN-aware float comparison

```go
func FloatEqual(a, b float64) bool {
    if math.IsNaN(a) && math.IsNaN(b) { return true }
    return a == b
}
```

Use it for tests that **expect** NaN — typical for stats or probability code.

---

## Generic Diff helpers

A failed `Equal` on a struct prints `got {Name:alice ...}, want {Name:alice ...}`. Reading that for a struct with 20 fields is painful. A **diff helper** computes the differences and reports only those.

Hand-rolled minimal diff:

```go
import "reflect"

type Mismatch struct {
    Path string
    Got  any
    Want any
}

func Diff[T any](got, want T) []Mismatch {
    var out []Mismatch
    diffValue(reflect.ValueOf(got), reflect.ValueOf(want), "", &out)
    return out
}

func diffValue(g, w reflect.Value, path string, out *[]Mismatch) {
    if g.Kind() != w.Kind() {
        *out = append(*out, Mismatch{Path: path, Got: g.Interface(), Want: w.Interface()})
        return
    }
    switch g.Kind() {
    case reflect.Struct:
        for i := 0; i < g.NumField(); i++ {
            f := g.Type().Field(i).Name
            diffValue(g.Field(i), w.Field(i), path+"."+f, out)
        }
    default:
        if !reflect.DeepEqual(g.Interface(), w.Interface()) {
            *out = append(*out, Mismatch{Path: path, Got: g.Interface(), Want: w.Interface()})
        }
    }
}
```

Wrap with an assertion:

```go
func AssertDiff[T any](t *testing.T, got, want T) {
    t.Helper()
    if d := Diff(got, want); len(d) > 0 {
        for _, m := range d {
            t.Errorf("%s: got %v, want %v", m.Path, m.Got, m.Want)
        }
    }
}
```

Now a 20-field struct shows only the **differing** fields. That alone is worth the helper.

### Trade-off

This minimal diff still uses `reflect`. For most projects, that is acceptable — it runs only on failure and only in tests. But it is **slower** than `==` and introduces failure modes (panics on funcs, walks unexported fields). The next section discusses when to graduate to `go-cmp`.

---

## Comparing to `cmp.Diff` from go-cmp

The community standard for diffing in tests is **`google/go-cmp`** (`github.com/google/go-cmp/cmp`):

```go
import "github.com/google/go-cmp/cmp"

if d := cmp.Diff(want, got); d != "" {
    t.Errorf("mismatch (-want +got):\n%s", d)
}
```

### Strengths of `go-cmp`

- **Pretty diffs** with line-by-line markers
- **Rich options**: `cmpopts.EquateApprox`, `cmpopts.SortSlices`, custom transformers
- **Battle-tested** in Google production
- **Integrates cleanly** with generics (it does not need them)

### When to wrap `go-cmp` in a generic helper

```go
import (
    "testing"
    "github.com/google/go-cmp/cmp"
)

func AssertCmpEqual[T any](t *testing.T, got, want T, opts ...cmp.Option) {
    t.Helper()
    if d := cmp.Diff(want, got, opts...); d != "" {
        t.Errorf("mismatch (-want +got):\n%s", d)
    }
}
```

The generic wrapper:

- Preserves type safety at the call site (`got` and `want` must be the same `T`)
- Centralizes `t.Helper()`
- Keeps the standard "want, got" diff convention

### When NOT to use `go-cmp`

- The struct is small (3-4 fields) — `==` plus `Equal` is faster and clearer
- The struct contains funcs or channels — `cmp` panics by default
- You want zero external dependencies

A senior team picks **one** diff strategy (stdlib, hand-rolled, or `go-cmp`) and uses it consistently.

---

## Structuring an in-house testlib

A 10-helper testlib should fit in one file. A 50-helper testlib needs structure:

```
internal/
  testutil/
    assert.go         // Equal, NotEqual, True, False, Nil, NotNil
    assert_slice.go   // SliceEqual, SetEqual, MultisetEqual
    assert_map.go     // MapEqual, MapHasKey
    assert_error.go   // NoError, ErrorIs, ErrorAs
    diff.go           // Diff, AssertDiff (or wrapper around go-cmp)
    fixture.go        // WithFixture, generic builders
    table.go          // Run, RunTable, parallel runner
    doc.go            // package documentation
```

### Naming rules

- **`Assert*` prefix** for fatal-on-fail helpers (or `Must*` if you prefer)
- **`Equal`, `NotEqual`** for non-fatal helpers
- **No double prefixes** — `AssertNoError`, not `AssertAssertNoError`

### Visibility

- **`internal/testutil`** in each major package keeps helpers close to the code they serve
- **Public testlib** only if the module is genuinely used by external teams
- **Avoid `pkg/`** — it implies "library", which raises the maintenance bar

### Versioning

Once a public testlib is exported, every signature is a public contract. A change to `Equal[T comparable]` propagates to thousands of tests. Treat it like any public API:

- Add helpers liberally
- Modify only with deprecation cycles
- Never remove

---

## Designing the public API of helpers

Three design questions every senior testlib answers:

### 1. `(t, got, want)` or `(t, want, got)`?

The Go community is **split**. `slices.Equal(a, b)` does not impose order; `cmp.Diff(want, got)` does. Pick **one** for your codebase and write it in `CONTRIBUTING.md`. The most common choice in Go is `(t, got, want)`.

### 2. Variadic message arguments?

```go
func Equal[T comparable](t *testing.T, got, want T, msg ...any) { ... }
```

Pro: callers can add context.
Con: most callers don't, and the signature gets noisy.

A compromise: ship two helpers:

```go
func Equal[T comparable](t *testing.T, got, want T)
func Equalf[T comparable](t *testing.T, got, want T, format string, args ...any)
```

### 3. Should helpers return values?

Most do not. But helpers that **extract** typed values (like `AssertErrorAs`) should:

```go
func AssertErrorAs[T error](t *testing.T, err error) T {
    t.Helper()
    var target T
    if !errors.As(err, &target) {
        t.Fatalf("expected %T, got %v", target, err)
    }
    return target
}
```

This pattern collapses three lines into one in tests.

---

## Helpers for `*testing.B` and fuzz tests

`testing.TB` is the interface satisfied by `*testing.T`, `*testing.B`, and `*testing.F`:

```go
type TB interface {
    Helper()
    Errorf(format string, args ...any)
    Fatalf(format string, args ...any)
    // ... many more
}
```

Generic helpers should accept `testing.TB` rather than `*testing.T`:

```go
func Equal[T comparable](tb testing.TB, got, want T) {
    tb.Helper()
    if got != want {
        tb.Errorf("got %v, want %v", got, want)
    }
}
```

Now the same helper works in benchmarks (`*testing.B`) and fuzz tests (`*testing.F`). At the cost of giving up `t.Run` (which is `*T`-only), but that is fine — most assertions don't need subtests.

---

## Trade-offs: helpers vs explicit checks

Senior teams resist the urge to wrap **every** check in a helper. Some checks are clearer inline:

```go
// Inline — fine
if !user.Active {
    t.Fatalf("user should be active")
}

// Helper — overkill
AssertTrue(t, user.Active, "user should be active")
```

The deciding factors:

| Use a helper when | Inline when |
|-------------------|-------------|
| The check repeats 3+ times | One-off check |
| Failure message benefits from typed `%v` | Boolean-only check |
| The helper hides setup boilerplate | The check is the boilerplate |
| You want a uniform error format | The error is unique |

A senior testlib has **about 15 helpers**, not 50.

---

## Anti-patterns at scale

### Anti-pattern 1 — Fluent everything

```go
Expect(t, got).To.Equal(want).And.NotBeNil()
```

A DSL works in Java/Ruby. In Go, it fights idioms — `t.Errorf` and stdlib helpers do the job.

### Anti-pattern 2 — Helpers with hidden side effects

```go
func AssertEqual(t *testing.T, got, want any) {
    if got != want { t.Errorf(...) }
    log.Printf("compared %v and %v", got, want)  // 🚨
}
```

A test helper should be pure with respect to the test. Logging muddies CI output.

### Anti-pattern 3 — `any` instead of generics

```go
func Equal(t *testing.T, got, want any) { ... } // 🚨
```

Loses type safety. `Equal(t, 1, "1")` compiles and fails at runtime. Use the generic version.

### Anti-pattern 4 — Helpers that catch panics

```go
func Safe(t *testing.T, fn func()) {
    defer func() { recover() }()
    fn()
}
```

Hides bugs. Tests should panic loudly. The only exception is a deliberate `AssertPanics[T any]` (next file).

### Anti-pattern 5 — `Stretchr/testify`-shaped wrapper around stdlib

If you ship `assert.Equal`, `require.Equal`, `assert.NoError`, you reinvented `testify`. Use the real `testify` if you want that style. Do not pretend to write a "lightweight" copy.

### Anti-pattern 6 — Test helpers that import from production packages

A helper that calls `myapp.NewService()` couples the testlib to production internals. Keep helpers domain-agnostic; build domain fixtures separately.

---

## Summary

A senior testlib design is **disciplined** — small, composable, free of magic.

Three principles:

1. **Generics where types matter** (`Equal[T]`, `EqualFunc[T]`, `AssertErrorAs[T]`).
2. **`t.Helper()` everywhere** — never let a failure point at the helper.
3. **Stdlib over DSL** — wrap `slices.Equal`, `maps.Equal`, `errors.Is`, optionally `go-cmp`.

The structure of a mature testlib mirrors the stdlib it wraps:

- One file per concern (`assert.go`, `assert_slice.go`, ...)
- Generic where it pays for itself
- `testing.TB` instead of `*testing.T` where benchmarks may want the helper
- **Public** only if external teams use the module

Senior engineers know **when to stop**. Adding the 50th helper rarely improves tests; it just spreads the surface area. A small testlib paired with disciplined inline assertions is what scales.

Move on to `professional.md` to see how mature Go projects integrate (or replace) these helpers with `testify`, `gotest.tools`, and migration strategies.
