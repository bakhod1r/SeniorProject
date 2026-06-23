# `comparable` and `cmp.Ordered` — Professional Level

## Table of Contents
1. [API design with `comparable` vs `cmp.Ordered`](#api-design-with-comparable-vs-cmpordered)
2. [Why `cmp.Ordered` excludes complex numbers](#why-cmpordered-excludes-complex-numbers)
3. [The Go 1.21 sortable shift](#the-go-121-sortable-shift)
4. [Library patterns: keys, weights, totals](#library-patterns-keys-weights-totals)
5. [Compatibility windows for downstream users](#compatibility-windows-for-downstream-users)
6. [Method-based ordering vs operator ordering](#method-based-ordering-vs-operator-ordering)
7. [Generic vs interface dispatch — when each wins](#generic-vs-interface-dispatch-when-each-wins)
8. [Case study: `slices` and `maps`](#case-study-slices-and-maps)
9. [Case study: hashicorp/golang-lru/v2](#case-study-hashicorpgolang-lruv2)
10. [Case study: a metrics library](#case-study-a-metrics-library)
11. [Team guidelines and review checklist](#team-guidelines-and-review-checklist)
12. [Migration checklist](#migration-checklist)
13. [Summary](#summary)

---

## API design with `comparable` vs `cmp.Ordered`

A library author chooses between three constraint families:

| Constraint | Says to caller | Use when |
|------------|----------------|----------|
| `[T any]` | "Bring any type" | The body never compares values |
| `[T comparable]` | "Bring an equality-friendly type" | Map keys, deduplication, `Has`/`Index` |
| `[T cmp.Ordered]` | "Bring an orderable type" | Sort, heap, range queries, BST |

Loosening the constraint **expands the user base**. Tightening it **expands the operations** the body can perform. A senior library author picks the **smallest** constraint that lets the implementation work — never tighter than needed, never looser than safe.

### A worked design

Suppose you are building a `Top[T]` helper that returns the N largest elements:

- If you write `func Top[T any](s []T, n int, less func(T, T) bool) []T`, callers must always supply `less`.
- If you write `func Top[T cmp.Ordered](s []T, n int) []T`, callers do not — but they cannot pass structs.
- The right choice is **two functions**: `Top` (cmp.Ordered) and `TopFunc` (any with comparator). This mirrors the stdlib `slices.Sort` / `slices.SortFunc` split.

Rule of thumb: **provide the convenient form, then the general form**. Do not force every caller to write a comparator if the type already supports `<`.

---

## Why `cmp.Ordered` excludes complex numbers

`complex64` and `complex128` are conspicuously absent from `cmp.Ordered`. The reason is not laziness — it is a design choice.

A complex number `a + bi` has two real components. There is **no canonical total order**. Three options exist:

1. **Lexicographic** — compare real parts, then imaginary
2. **Magnitude** — compare `|a + bi|`
3. **Argument** — compare `arg(a + bi)`

Each is **mathematically valid** but **none is universal**. In financial code you might want magnitude. In numerical code you might want lexicographic. In control theory you might want argument.

If `cmp.Ordered` included complex numbers, the spec would have to pick one — and any choice would silently break code that expected another. So complex was excluded. Programmers who need complex ordering must:

```go
slices.SortFunc(cs, func(a, b complex128) int {
    return cmp.Compare(cmplx.Abs(a), cmplx.Abs(b)) // magnitude order
})
```

The exclusion forces the choice to be **explicit at every call site**. That is the right outcome for a feature whose meaning depends on context.

### What about user-defined types?

```go
type Phasor complex128
slices.Sort([]Phasor{...}) // ❌ — Phasor's underlying type is complex128
```

Even with the tilde, a complex underlying does not satisfy `cmp.Ordered`. There is no escape hatch.

---

## The Go 1.21 sortable shift

Before Go 1.21, sorting was an `interface{}`-based mess:

```go
sort.Slice(users, func(i, j int) bool {
    return users[i].Age < users[j].Age
})
```

`sort.Slice` uses reflection internally. Slow, allocs, no type safety. Or you wrote a `sort.Interface` with `Len/Less/Swap` — three methods of boilerplate per type.

Go 1.21 promoted `slices.Sort` and friends:

```go
import (
    "cmp"
    "slices"
)

slices.Sort(ages)                                    // for []int directly
slices.SortFunc(users, func(a, b User) int {         // for structs
    return cmp.Compare(a.Age, b.Age)
})
```

Three changes to your mental model after 1.21:

1. **Inlinable comparator** — `slices.Sort` knows the type, can inline `<`. Often **40% faster** than `sort.Slice`.
2. **No reflection** — bug class eliminated.
3. **NaN handling** — `slices.Sort` (which uses `cmp.Compare`) gives a deterministic NaN order. `sort.Slice` did not.

The Go team expects new code to use `slices.Sort` / `slices.SortFunc` and treats `sort.Slice` as legacy. Linters in 2024+ flag `sort.Slice` as a hint to migrate.

### Why this matters for `cmp.Ordered`

`slices.Sort` is parameterised as:

```go
func Sort[S ~[]E, E cmp.Ordered](x S)
```

So calling `slices.Sort(myDuration)` works because `time.Duration`'s underlying type is `int64`. Calling `slices.Sort(myStruct)` does not. The constraint is the gate.

---

## Library patterns: keys, weights, totals

A useful taxonomy of generic uses:

| Role | Constraint | Typical signature |
|------|-----------|-------------------|
| **Key** | `comparable` | `Cache[K comparable, V any]` |
| **Weight / score** | `cmp.Ordered` | `Top[T cmp.Ordered](s []T, n int) []T` |
| **Total / accumulator** | custom `Number` | `Sum[T Number](s []T) T` |
| **Tag** | `comparable` (often `string`) | `Set[T comparable]` |
| **Index / page** | `Ordered` integers | `Range[T cmp.Ordered](lo, hi T) Iter[T]` |

When you reach for a constraint, ask: "Is this thing a **key** (equality), a **weight** (ordering), or a **value** (arithmetic)?". The answer picks the constraint.

---

## Compatibility windows for downstream users

A library that uses `cmp.Ordered` requires **Go 1.21+**. A library that uses `comparable` works on **Go 1.18+** (with relaxed semantics in 1.20+).

Implications for `go.mod`:

| Constraint used | Min `go` directive |
|-----------------|--------------------|
| `any`, `comparable` (strict) | `go 1.18` |
| `comparable` (with interface arguments) | `go 1.20` |
| `cmp.Ordered`, `cmp.Compare` | `go 1.21` |
| `cmp.Or` | `go 1.22` |
| Generic type aliases | `go 1.24` |

A library targeting older toolchains imports `golang.org/x/exp/constraints.Ordered` instead of `cmp.Ordered`. The two are equivalent in practice; the type is `constraints.Ordered` and is API-stable.

A senior library author **declares the minimum Go** in `go.mod` deliberately, knowing each line above costs you some users.

---

## Method-based ordering vs operator ordering

Two patterns coexist:

### Operator ordering — `cmp.Ordered`

```go
func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}
```

Works for primitive-shaped types. Not extensible to user struct types.

### Method ordering — interface

```go
type Comparable[T any] interface {
    Compare(other T) int
}

func MinM[T Comparable[T]](a, b T) T {
    if a.Compare(b) < 0 { return a }
    return b
}
```

Works for any struct that implements `Compare`. Extensible. Slightly more boilerplate at call site.

### Hybrid — comparator function

```go
func MinFunc[T any](a, b T, cmp func(T, T) int) T {
    if cmp(a, b) < 0 { return a }
    return b
}
```

Most flexible. Caller supplies the rule. Used by `slices.SortFunc`, `slices.MinFunc`, etc.

### When to expose which

- **Convenience overload** — `Min[T cmp.Ordered]` for the common case
- **Extensible overload** — `MinFunc[T any]` for user-defined order
- **Method-based** — only if the domain already has a `Compare` method (rare)

Stdlib `slices` follows this exact pattern: `Sort` / `SortFunc`, `Min` / `MinFunc`, `BinarySearch` / `BinarySearchFunc`.

---

## Generic vs interface dispatch — when each wins

The classic question: when should a library use `[T cmp.Ordered]` vs an interface like `sort.Interface`?

| Aspect | Generics | Interfaces |
|--------|----------|------------|
| Performance | inlinable, no v-table | dynamic dispatch, slower |
| Composition | hard — types are different | easy — interface satisfaction |
| Reflection | not needed | sometimes needed |
| API stability | tighter constraint = breakage risk | loose interface, easier to extend |
| User experience | infer or specify `T` at call site | implement methods on the type |

For algorithms over **value-typed** data (numbers, strings, simple structs), generics win. For algorithms over **polymorphic** data (mixed renderers, mixed loggers), interfaces win.

Sort is a corner case: it is value-shaped (the elements are homogeneous) but historically used `sort.Interface`. Go 1.21 picked generics — and benchmarks justified it.

---

## Case study: `slices` and `maps`

The standard library's adoption pattern is worth studying.

### `slices.Contains`

```go
func Contains[S ~[]E, E comparable](s S, v E) bool
```

Two type parameters: `S` for the slice type (so user-defined slice types like `type Names []string` work), `E` for the element. The constraint on `E` is **`comparable`** — equality only. No ordering required for `Contains`.

### `slices.Index`

Same constraint, same shape — equality is enough.

### `slices.Sort`

```go
func Sort[S ~[]E, E cmp.Ordered](x S)
```

Constraint on `E` is `cmp.Ordered` — sort needs `<`.

### `slices.BinarySearch`

```go
func BinarySearch[S ~[]E, E cmp.Ordered](x S, target E) (int, bool)
```

Binary search needs ordering, so `cmp.Ordered`.

### `slices.Compact`

```go
func Compact[S ~[]E, E comparable](s S) S
```

Compact removes adjacent duplicates — equality only.

The pattern: **Go uses `comparable` whenever it can, and bumps to `cmp.Ordered` only when ordering is required**. Senior library design follows the same rule.

### `maps`

```go
func Equal[M1, M2 ~map[K]V, K, V comparable](m1 M1, m2 M2) bool
```

Map equality needs both **K comparable** (already required by maps) and **V comparable** (so values can be compared with `==`). For non-comparable values, callers use `maps.EqualFunc`.

---

## Case study: hashicorp/golang-lru/v2

When Hashicorp shipped their generic LRU cache in `/v2`, they had to pick constraints:

```go
type Cache[K comparable, V any] interface {
    Get(K) (V, bool)
    Add(K, V)
    Remove(K)
}
```

`K comparable` because LRU uses an internal `map[K]*entry`. `V any` because values are stored without comparison. They did **not** add `cmp.Ordered` because the LRU policy uses recency, not value ordering.

Compare with a hypothetical `SortedCache[K cmp.Ordered, V any]` that maintains keys in sorted order — that one would need `cmp.Ordered` for the BST-like backbone.

The lesson: **constraints follow what the implementation does, not what the user thinks the type "is"**.

---

## Case study: a metrics library

Suppose you build a percentile calculator:

```go
type Quantile[T cmp.Ordered] struct {
    samples []T
}

func (q *Quantile[T]) Add(v T) { q.samples = append(q.samples, v) }
func (q *Quantile[T]) P(p float64) T {
    sorted := slices.Clone(q.samples)
    slices.Sort(sorted)
    idx := int(float64(len(sorted)) * p)
    return sorted[idx]
}
```

Why `cmp.Ordered`? The implementation sorts. Why not `[T any]` with a comparator? You could — but the convenience form is much nicer when the user is measuring `time.Duration` or `int`.

A library that wraps this would expose **both**:

```go
type Quantile[T cmp.Ordered] struct { ... }
type QuantileFunc[T any] struct {
    samples []T
    cmp     func(T, T) int
}
```

---

## Team guidelines and review checklist

Adopt these in your style guide:

> 1. Default to `[T comparable]` for keys; use `[T cmp.Ordered]` only when the body sorts or orders.
> 2. Never re-define `Ordered`; import `cmp.Ordered` (Go 1.21+) or `constraints.Ordered` (older).
> 3. Sort comparators on float types must use `cmp.Compare`, never `<`.
> 4. Public APIs must declare the minimum Go version in `go.mod` consistent with their constraints.
> 5. For non-Ordered struct types, expose a `Compare` method and a `SortFunc`-style helper.
> 6. Document NaN behavior on any API that takes floats.
> 7. Watch for `[T comparable]` over `interface{}`/`any` — the runtime panic risk should be either documented or guarded.

### Review checklist

| Check | Why |
|-------|-----|
| Is `comparable` enough, or is `Ordered` really needed? | Looser constraint = more callers |
| Does the comparator handle NaN? | Float bugs are hard to detect |
| Are user-defined types handled (`~T`)? | Domain types often have wrappers |
| Is there a `Func` variant? | Users with non-Ordered types need it |
| Is the minimum Go version declared? | `cmp.Ordered` requires 1.21+ |

---

## Migration checklist

For a team migrating to `cmp.Ordered`:

- [ ] Bump `go.mod` to `go 1.21` or newer
- [ ] Replace `golang.org/x/exp/constraints.Ordered` imports with `cmp.Ordered`
- [ ] Replace hand-rolled `Ordered` interfaces in internal packages
- [ ] Replace `sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })` with `slices.Sort(s)`
- [ ] Replace `<` with `cmp.Compare` in float sort comparators
- [ ] Use `cmp.Or` for tie-breaking chains (Go 1.22+)
- [ ] Audit `Set[any]` and `Cache[any, V]` for runtime panic risk
- [ ] Add NaN tests for any float-touching code
- [ ] Document constraint choice in package godoc

---

## Summary

`comparable` and `cmp.Ordered` are the two constraints that drive the majority of generic Go code. The professional view of them:

1. **Constraint follows implementation, not type identity.** A cache uses `comparable` even if the keys "feel" ordered.
2. **`comparable` is the minimum-equality contract** — relaxed in 1.20 to include interfaces, with runtime panic risk.
3. **`cmp.Ordered` is the canonical ordering constraint** — predeclared-in-spirit, closed to specific underlying types, NaN-aware via `cmp.Compare`.
4. **Operators are NaN-blind; `cmp.Compare` is NaN-aware.** Senior code routes through `cmp.Compare` for floats.
5. **Two-form APIs win.** Provide the Ordered convenience form and the comparator form side by side, like `slices.Sort` / `slices.SortFunc`.
6. **Migration to 1.21 is worthwhile** — `slices.Sort` is faster, NaN-safe, and inlines.
7. **Complex numbers are excluded by design.** Their ordering is context-dependent, so the spec refuses to pick.

A team that internalizes these rules writes generic Go that is small, fast, and predictable across version boundaries. The next file (`specification.md`) digs into the formal grammar and the spec sections that govern these constraints.
