# `comparable` and `cmp.Ordered` — Senior Level

## Table of Contents
1. [Why `cmp.Ordered` exists](#why-cmpordered-exists)
2. [The exact definition](#the-exact-definition)
3. [Why `~int` and friends — domain types matter](#why-int-and-friends-domain-types-matter)
4. [Floating-point semantics — NaN and the strict-weak-order trap](#floating-point-semantics-nan-and-the-strict-weak-order-trap)
5. [`cmp.Compare` vs `cmp.Less` vs the operators](#cmpcompare-vs-cmpless-vs-the-operators)
6. [User-defined types satisfying `Ordered`](#user-defined-types-satisfying-ordered)
7. [Building generic ordered data structures](#building-generic-ordered-data-structures)
8. [Stable ordering and ties](#stable-ordering-and-ties)
9. [Sorting time-of-day, durations, and currency](#sorting-time-of-day-durations-and-currency)
10. [Summary](#summary)

---

## Why `cmp.Ordered` exists

For three years (Go 1.18-1.20), every team that wanted generic ordering had to write their own constraint. The community converged on something close to `golang.org/x/exp/constraints.Ordered`:

```go
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64 |
    ~string
}
```

When `cmp` was promoted to the standard library in **Go 1.21 (August 2023)**, the team made `cmp.Ordered` the canonical version. Hand-rolled `Ordered` constraints became an anti-pattern overnight.

The package also added:

```go
func Compare[T Ordered](x, y T) int
func Less[T Ordered](x, y T) bool
```

These are the **NaN-aware** sort helpers. They give a deterministic ordering even when floats include `NaN`. Operators (`<`, `<=`) do not — they simply return false for NaN comparisons.

---

## The exact definition

From `cmp/cmp.go` in the standard library:

```go
// Ordered is a constraint that permits any ordered type:
// any type that supports the operators < <= >= >.
// If future releases of Go add new ordered types,
// this constraint will be modified to include them.
//
// Note that floating-point types may contain NaN values,
// for which the operator <, <=, >, >= return false even
// when compared with themselves. See [Compare] for a
// consistent way to compare NaN values.
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
        ~float32 | ~float64 |
        ~string
}
```

Three observations a senior must internalize:

1. **`~` everywhere** — every term uses tilde, so user-defined types whose underlying type is one of these qualify.
2. **No complex numbers** — `complex64` and `complex128` are absent. Complex numbers do not have a meaningful total order (Re vs Im — which dimension wins?). The Go team excluded them deliberately.
3. **The constraint is open-ended in spec text** — "if future releases add new ordered types, this will be modified." So depending on `cmp.Ordered` is a forward-compatible decision.

---

## Why `~int` and friends — domain types matter

Consider this code:

```go
type Celsius float64
type Fahrenheit float64

func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}

var t1, t2 Celsius = 36.6, 38.2
Min(t1, t2) // 36.6 — works because cmp.Ordered uses ~float64
```

Without the tilde, `Celsius` would be rejected — its underlying type is `float64` but the named type itself is `Celsius`. The tilde is what makes generic numeric code usable in domain code (temperature, currency, distance, age, score).

This is also why a hand-rolled `Ordered` interface that uses bare `int | float64 | string` is broken — domain types like `type UserID int` will not satisfy it. Always include `~`.

### When the tilde rule bites

```go
type Score int

scores := []Score{3, 1, 2}
slices.Sort(scores)         // ✓ — slices.Sort takes [S ~[]E, E cmp.Ordered]
fmt.Println(scores)         // [1 2 3]
```

Most stdlib generics use `~T`-shaped constraints internally so domain types just work.

---

## Floating-point semantics — NaN and the strict-weak-order trap

IEEE-754 says: `NaN != NaN`, and `NaN < x`, `NaN > x`, `NaN <= x`, `NaN >= x` all return **false**. This breaks two assumptions sorting algorithms make:

1. **Trichotomy** — for any `a`, `b`, exactly one of `a < b`, `a == b`, `a > b` holds. NaN breaks this — none holds for NaN.
2. **Total order** — for any `a`, `b`, `c`: if `a < b` and `b < c`, then `a < c`. NaN breaks transitivity.

A `slices.Sort` over `[]float64{1, math.NaN(), 2}` historically produced indeterminate results — sometimes correct, sometimes a partial sort, occasionally infinite loop in older sorts. The Go 1.21 fix:

```go
slices.Sort([]float64{1, math.NaN(), 2})
// NaNs are sorted to the front (treated as less than all numbers)
```

`slices.Sort` and `slices.SortFunc` use `cmp.Compare` internally, which **does** define a total order:

> `cmp.Compare(x, y)` returns -1 if `x < y`, 0 if `x == y`, +1 if `x > y`. For floats, NaN is **less than** any non-NaN value, and any two NaNs are **equal**.

So `cmp.Compare` extends the operator-level `<` with deterministic NaN handling. Operators do not. **Senior rule**: never use `<` on floats inside a sort comparator. Always go through `cmp.Compare` or `cmp.Less`.

### The pattern

```go
import (
    "cmp"
    "slices"
)

type Reading struct {
    Sensor string
    Value  float64
}

slices.SortFunc(readings, func(a, b Reading) int {
    return cmp.Compare(a.Value, b.Value)
})
```

This sorts NaN readings to the front predictably.

### `cmp.Less`

```go
func Less[T cmp.Ordered](x, y T) bool
```

`cmp.Less(NaN, 1.0) == true`, `cmp.Less(1.0, NaN) == false`, `cmp.Less(NaN, NaN) == false`. This is the predicate version of the same logic.

---

## `cmp.Compare` vs `cmp.Less` vs the operators

Three ways to ask "is `a` less than `b`?":

| Tool | Returns | NaN-safe? | When to use |
|------|---------|-----------|-------------|
| `a < b` (operator) | bool | no — false for any NaN | when no NaN can occur |
| `cmp.Less(a, b)` | bool | yes — NaN is "less" | predicates, conditions |
| `cmp.Compare(a, b)` | int (-1, 0, 1) | yes | sort comparators |

Use the operator only when you have proven the values cannot be NaN. Use `cmp.Less` for predicates and `cmp.Compare` for sort.

A common mistake is to write a sort comparator with `<`:

```go
slices.SortFunc(s, func(a, b T) int {
    if a < b { return -1 } // ❌ broken for NaN
    if a > b { return 1 }
    return 0
})
```

If `T` is `float64` and any element is NaN, this comparator violates total order. Replace with `return cmp.Compare(a, b)`.

---

## User-defined types satisfying `Ordered`

Any defined type whose underlying type is in `cmp.Ordered`'s union qualifies, thanks to `~`:

```go
type UserID int64
type Currency float64
type Email string
type Priority uint8

// All four satisfy cmp.Ordered without further work:
slices.Sort([]UserID{...})
slices.Sort([]Currency{...})
slices.Sort([]Email{...})
slices.Sort([]Priority{...})
```

Types that do **not** satisfy:

```go
type ID struct { Hi, Lo uint64 } // struct — not in Ordered
type Bag []string                 // slice — not in Ordered
type Time time.Time               // struct — not in Ordered (time.Time is comparable but not Ordered)
```

For these, you write a custom comparator and use `slices.SortFunc`.

### Wrapping a non-Ordered type to make it Ordered

```go
type Ordered ID = func(a, b ID) int { ... }   // not allowed

// Instead: provide a Compare method and use SortFunc.
func (a ID) Compare(b ID) int {
    if c := cmp.Compare(a.Hi, b.Hi); c != 0 { return c }
    return cmp.Compare(a.Lo, b.Lo)
}

slices.SortFunc(ids, func(a, b ID) int { return a.Compare(b) })
```

You cannot bolt `cmp.Ordered` onto a struct, even with methods. The constraint is **closed** to the listed underlying types. This is by design — the spec does not allow user interfaces to extend `cmp.Ordered`.

---

## Building generic ordered data structures

A senior writes data structures parameterised by `cmp.Ordered`:

### Sorted slice

```go
type SortedSlice[T cmp.Ordered] struct {
    data []T
}

func (s *SortedSlice[T]) Insert(v T) {
    i, _ := slices.BinarySearch(s.data, v)
    s.data = slices.Insert(s.data, i, v)
}

func (s *SortedSlice[T]) Has(v T) bool {
    _, ok := slices.BinarySearch(s.data, v)
    return ok
}
```

### Min-heap

```go
type Heap[T cmp.Ordered] struct {
    data []T
}

func (h *Heap[T]) Push(v T) { /* heapify-up using cmp.Compare */ }
func (h *Heap[T]) Pop() T   { /* swap, heapify-down */ }
```

### BST

```go
type BST[T cmp.Ordered] struct { root *node[T] }
type node[T cmp.Ordered] struct {
    v     T
    left  *node[T]
    right *node[T]
}
```

For all three, the constraint `cmp.Ordered` says "this T is totally orderable" — exactly the requirement of binary search, heap, and tree.

### When to use `comparable` instead

If a structure only needs **equality** (set, map-like cache, dedup), `comparable` is enough:

```go
type Set[T comparable] struct { m map[T]struct{} }
type Cache[K comparable, V any] struct { m map[K]V }
```

Choosing `comparable` over `cmp.Ordered` when ordering is not needed keeps the API loose — callers do not need to provide an Ordered type.

---

## Stable ordering and ties

`slices.Sort` is **not stable**. When two elements compare equal, their relative order is unspecified. `slices.SortStableFunc` is stable.

For `cmp.Ordered`-based sorting:

```go
// Unstable
slices.Sort(s)

// Stable, with explicit comparator
slices.SortStableFunc(s, cmp.Compare)
```

If your data has natural ties (e.g., users with the same age), use stable sort or include a tie-breaker:

```go
slices.SortFunc(users, func(a, b User) int {
    if c := cmp.Compare(a.Age, b.Age); c != 0 { return c }
    return cmp.Compare(a.ID, b.ID) // tie-breaker
})
```

`cmp.Or` (Go 1.22+) makes this concise:

```go
slices.SortFunc(users, func(a, b User) int {
    return cmp.Or(
        cmp.Compare(a.Age, b.Age),
        cmp.Compare(a.ID, b.ID),
    )
})
```

`cmp.Or` returns the first non-zero result — exactly what a chained comparator needs.

---

## Sorting time-of-day, durations, and currency

`time.Time` is **comparable** (a struct of integers and a pointer to location), but **not Ordered** in the `cmp` sense — its underlying type is a struct. So:

```go
slices.Sort([]time.Time{...}) // ❌ compile error
```

Workaround:

```go
slices.SortFunc(times, func(a, b time.Time) int {
    return a.Compare(b) // time.Time has its own Compare method since 1.20
})
```

Same story for `time.Duration` — but **wait**, `time.Duration` is `int64` underneath:

```go
type Duration int64

slices.Sort([]time.Duration{...}) // ✓ — Duration's underlying type is int64
```

So duration sorts work directly. Currency types defined as `type USD int64` or `type Cents int64` also satisfy `cmp.Ordered` automatically.

### A pattern for "almost-ordered" types

When a type is conceptually ordered but its concrete shape is a struct (`time.Time`, `big.Int`, `decimal.Decimal`), provide a `Compare` method and use `SortFunc`. Do not try to redefine `cmp.Ordered`.

---

## Summary

`cmp.Ordered` is the canonical constraint for "supports `<`, `<=`, `>`, `>=`". Three rules a senior remembers:

1. **Use it as-is, do not redefine.** It is closed to its listed underlying types and uses tilde everywhere.
2. **Operators are NaN-blind; `cmp.Compare` and `cmp.Less` are NaN-aware.** Use `cmp.Compare` in every sort comparator that touches floats.
3. **Complex numbers are excluded.** Real, integer, and string ordering — yes. Complex — no. Take the constraint as a positive design choice, not an oversight.

Patterns that age well:

- Generic data structures (`SortedSlice`, `Heap`, `BST`) parameterised by `[T cmp.Ordered]`
- Sort comparators that route through `cmp.Compare` and chain via `cmp.Or`
- Domain types `type X int`, `type Y float64`, `type Z string` that ride free on `~T`
- Equality-only structures (`Set`, `Cache`) staying on `[T comparable]` to keep the constraint loose

The pair `comparable` + `cmp.Ordered` covers almost every algorithmic generic in Go. The rest of the constraint system (custom unions, `~`, methods) builds on top, but `comparable` and `Ordered` are the workhorses.

Move on to `professional.md` to see how teams design libraries around these two constraints.
