# Generic Testing Helpers — Middle Level

## Table of Contents
1. [Beyond `comparable` — slices, maps, errors](#beyond-comparable-slices-maps-errors)
2. [`AssertSliceEqual[T comparable]`](#assertsliceequalt-comparable)
3. [`AssertMapEqual[K, V comparable]`](#assertmapequalk-v-comparable)
4. [`AssertNoError` and `AssertErrorIs`](#assertnoerror-and-asserterroris)
5. [Composition — building bigger helpers from small ones](#composition-building-bigger-helpers-from-small-ones)
6. [Separating fixtures from logic](#separating-fixtures-from-logic)
7. [Subtests with typed table data](#subtests-with-typed-table-data)
8. [Order-insensitive equality](#order-insensitive-equality)
9. [Summary](#summary)

---

## Beyond `comparable` — slices, maps, errors

Junior helpers stop at `Equal[T comparable]`. Real Go projects need three more shapes that `comparable` cannot express:

- **Slices** — comparing element-by-element
- **Maps** — comparing key/value pairs
- **Errors** — checking error wrapping with `errors.Is` and `errors.As`

Stdlib gives us `slices.Equal`, `maps.Equal`, and `errors.Is`. The job of a generic testlib is to wrap those with `t.Helper()` and a clear failure message.

---

## `AssertSliceEqual[T comparable]`

```go
package testutil

import (
    "slices"
    "testing"
)

func AssertSliceEqual[T comparable](t *testing.T, got, want []T) {
    t.Helper()
    if !slices.Equal(got, want) {
        t.Errorf("slice mismatch:\n  got:  %v\n  want: %v", got, want)
    }
}
```

Key points:

- `[T comparable]` because `slices.Equal` uses `==` element-wise.
- The error message uses **two lines** so a long slice does not wrap badly.
- The function is one line of logic — that is correct, not lazy.

Use:

```go
func TestSplit(t *testing.T) {
    AssertSliceEqual(t, strings.Split("a,b,c", ","), []string{"a", "b", "c"})
}
```

### When `T` is itself non-comparable

For `[]MyStructWithMap`, fall back to `AssertSliceEqualFunc`:

```go
func AssertSliceEqualFunc[T any](t *testing.T, got, want []T, eq func(T, T) bool) {
    t.Helper()
    if !slices.EqualFunc(got, want, eq) {
        t.Errorf("slice mismatch:\n  got:  %v\n  want: %v", got, want)
    }
}
```

Now slices of any element type can be asserted, given a comparator.

---

## `AssertMapEqual[K, V comparable]`

```go
import (
    "maps"
    "testing"
)

func AssertMapEqual[K, V comparable](t *testing.T, got, want map[K]V) {
    t.Helper()
    if !maps.Equal(got, want) {
        t.Errorf("map mismatch:\n  got:  %v\n  want: %v", got, want)
    }
}
```

Subtleties:

- **Keys** must be `comparable` (always required by `map`).
- **Values** must be `comparable` for `==`. For non-comparable values, use `maps.EqualFunc`:

```go
func AssertMapEqualFunc[K comparable, V any](t *testing.T, got, want map[K]V, eq func(V, V) bool) {
    t.Helper()
    if !maps.EqualFunc(got, want, eq) {
        t.Errorf("map mismatch:\n  got:  %v\n  want: %v", got, want)
    }
}
```

### Why not `reflect.DeepEqual(got, want)`?

`reflect.DeepEqual` works but:

- Walks unexported fields (sometimes panics)
- Reports only `false` — no element-level diff
- 5-50× slower

`maps.Equal` is the better building block. The helper exists to centralize `t.Helper()` and the error message.

---

## `AssertNoError` and `AssertErrorIs`

Errors deserve their own helpers because their failure modes differ.

```go
import (
    "errors"
    "testing"
)

func AssertNoError(t *testing.T, err error) {
    t.Helper()
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}

func AssertError(t *testing.T, err error) {
    t.Helper()
    if err == nil {
        t.Fatalf("expected error, got nil")
    }
}

func AssertErrorIs(t *testing.T, err, target error) {
    t.Helper()
    if !errors.Is(err, target) {
        t.Fatalf("error chain does not contain %v: got %v", target, err)
    }
}
```

Notes:

- Use `t.Fatalf` because tests after a missed error often produce cascading nonsense.
- `errors.Is` walks the wrapping chain; do not write `if err == target` instead.
- For `errors.As`, generics shine even more:

```go
func AssertErrorAs[T error](t *testing.T, err error) T {
    t.Helper()
    var target T
    if !errors.As(err, &target) {
        t.Fatalf("expected error of type %T, got %T (%v)", target, err, err)
    }
    return target
}
```

The helper **returns** the typed error so the test can assert on its fields:

```go
func TestParse(t *testing.T) {
    _, err := strconv.Atoi("nope")
    nerr := AssertErrorAs[*strconv.NumError](t, err)
    AssertEqual(t, nerr.Func, "Atoi")
}
```

That two-line idiom replaces 10 lines of `errors.As` plus type assertions and is fully type safe.

---

## Composition — building bigger helpers from small ones

A middle-level testlib treats helpers like any other code: small functions composed.

```go
func AssertUserEqual(t *testing.T, got, want User) {
    t.Helper()
    Equal(t, got.ID, want.ID)
    Equal(t, got.Name, want.Name)
    AssertSliceEqual(t, got.Roles, want.Roles)
}
```

Each call propagates `t.Helper()` correctly. Failure messages still point at the test that called `AssertUserEqual`, not at any of these lines.

### When to flatten

If `AssertUserEqual` grows to 50 lines, you are recreating `cmp.Diff` (next file). Switch to a diff-based helper rather than expanding a flat one.

---

## Separating fixtures from logic

A common middle-level mistake: fixtures and assertions tangled in the same function.

### Bad

```go
func TestOrder(t *testing.T) {
    db := openTestDB(t)
    user := &User{Name: "alice"}
    if err := db.Save(user); err != nil { t.Fatal(err) }
    o := &Order{UserID: user.ID, Total: 100}
    got, err := db.PlaceOrder(o)
    if err != nil { t.Fatal(err) }
    if got.Total != 100 { t.Errorf(...) }
    if got.UserID != user.ID { t.Errorf(...) }
    // 30 more lines
}
```

### Good — split fixture from assertion

```go
type orderFixture struct {
    db   *DB
    user *User
}

func newOrderFixture(t *testing.T) orderFixture {
    t.Helper()
    db := openTestDB(t)
    u := &User{Name: "alice"}
    AssertNoError(t, db.Save(u))
    return orderFixture{db: db, user: u}
}

func TestOrder(t *testing.T) {
    f := newOrderFixture(t)
    o, err := f.db.PlaceOrder(&Order{UserID: f.user.ID, Total: 100})
    AssertNoError(t, err)
    Equal(t, o.Total, 100)
    Equal(t, o.UserID, f.user.ID)
}
```

The fixture **constructor takes `t`** so it can fail early. Assertions are concise and uniform.

### A reusable fixture factory

```go
type Fixture[T any] struct {
    Value T
    Clean func()
}

func WithFixture[T any](t *testing.T, build func(t *testing.T) (T, func())) Fixture[T] {
    t.Helper()
    v, clean := build(t)
    t.Cleanup(clean)
    return Fixture[T]{Value: v, Clean: clean}
}
```

Each test gets a typed value and registered cleanup. `t.Cleanup` runs after the test ends regardless of pass or fail.

---

## Subtests with typed table data

Junior code shows a generic runner. At middle level we extend it with **per-case setup**:

```go
type TableCase[I, O any] struct {
    Name  string
    Setup func(*testing.T) I
    Want  O
}

func RunTable[I, O any](
    t *testing.T,
    cases []TableCase[I, O],
    fn func(I) O,
    eq func(O, O) bool,
) {
    t.Helper()
    for _, tc := range cases {
        t.Run(tc.Name, func(t *testing.T) {
            in := tc.Setup(t)
            got := fn(in)
            if !eq(got, tc.Want) {
                t.Errorf("%s: got %v, want %v", tc.Name, got, tc.Want)
            }
        })
    }
}
```

Now each case can construct its own input — useful for tests that need a fresh resource per row.

### Pairing with `t.Parallel`

For independent rows, `t.Parallel()` inside the closure speeds up large tables. Capture `tc` correctly: pre-Go 1.22 the loop variable was shared; in 1.22+ each iteration has its own.

```go
for _, tc := range cases {
    t.Run(tc.Name, func(t *testing.T) {
        t.Parallel()
        // safe in Go 1.22+
    })
}
```

---

## Order-insensitive equality

Some assertions don't care about order. A function returning all map keys, for instance.

```go
import "slices"

func AssertSetEqual[T cmp.Ordered](t *testing.T, got, want []T) {
    t.Helper()
    g := slices.Clone(got)
    w := slices.Clone(want)
    slices.Sort(g)
    slices.Sort(w)
    if !slices.Equal(g, w) {
        t.Errorf("set mismatch:\n  got:  %v\n  want: %v", got, want)
    }
}
```

Two design choices:

1. **Clone before sorting** — never mutate the caller's data inside a helper.
2. **`cmp.Ordered`** because the helper sorts. For non-ordered types, use a `map[T]int` count comparison.

```go
func AssertMultisetEqual[T comparable](t *testing.T, got, want []T) {
    t.Helper()
    countOf := func(s []T) map[T]int {
        m := map[T]int{}
        for _, v := range s { m[v]++ }
        return m
    }
    if !maps.Equal(countOf(got), countOf(want)) {
        t.Errorf("multiset mismatch:\n  got:  %v\n  want: %v", got, want)
    }
}
```

The multiset helper handles duplicates — useful when ordering is irrelevant **and** the type is not orderable (custom structs).

---

## Summary

A middle-level testlib graduates from one-line `Equal` to a small, well-composed family:

- `Equal` / `NotEqual` for `comparable`
- `AssertSliceEqual` and `AssertMapEqual` for collections
- `AssertNoError` / `AssertErrorIs` / `AssertErrorAs` for errors
- `AssertSetEqual` / `AssertMultisetEqual` for unordered comparisons
- A typed table runner that respects subtests and parallelism

Each helper is **a wrapper over a stdlib function** plus `t.Helper()` and a uniform message format. That is the whole pattern. Resist the urge to invent a fluent DSL — the stdlib-shape API ages better and reviews more easily.

The next file (`senior.md`) introduces custom equality, generic diff, and how to structure a real in-house testlib that scales to thousands of tests.
