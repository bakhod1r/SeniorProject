# Generic Constraints Deep Dive — Professional Level

## Table of Contents
1. [The `golang.org/x/exp/constraints` story](#the-golangorgxexpconstraints-story)
2. [Migration to `cmp.Ordered`](#migration-to-cmpordered)
3. [Constraint API design for libraries](#constraint-api-design-for-libraries)
4. [Evolving constraints without breaking callers](#evolving-constraints-without-breaking-callers)
5. [Versioning constraints](#versioning-constraints)
6. [Documentation patterns](#documentation-patterns)
7. [Case study: `slices.SortFunc` and the cmp.Compare migration](#case-study-slicessortfunc-and-the-cmpcompare-migration)
8. [Case study: `golang-lru/v2`](#case-study-golang-lruv2)
9. [Case study: domain-specific constraint hierarchies](#case-study-domain-specific-constraint-hierarchies)
10. [Migration checklist](#migration-checklist)
11. [Summary](#summary)

---

## The `golang.org/x/exp/constraints` story

When Go 1.18 shipped in March 2022, the standard library did not yet contain a numeric or ordered constraint. The community needed one immediately — `Min`, `Max`, `Sort`, and the like all wanted `cmp.Ordered`-shaped constraints. So the Go team published an **experimental** package:

```
golang.org/x/exp/constraints
```

This package contained:

```go
type Signed interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64
}

type Unsigned interface {
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr
}

type Integer interface {
    Signed | Unsigned
}

type Float interface {
    ~float32 | ~float64
}

type Complex interface {
    ~complex64 | ~complex128
}

type Ordered interface {
    Integer | Float | ~string
}
```

Every Go library that needed numeric constraints between **March 2022** and **August 2023** imported this package. It became the de facto standard.

### Why was it `x/exp`?

The Go team uses `x/exp/` for experimental packages — APIs that may change before being promoted to stdlib. The reasoning:

1. **Real-world feedback** before locking the API.
2. **Easier deprecation** of mistakes.
3. **Iteration** on naming and structure.

Two iterations happened in `constraints` before the team settled on the final shape.

### The promotion to `cmp.Ordered` (Go 1.21)

In **August 2023**, Go 1.21 promoted the most important constraint — `Ordered` — to the standard library, but **renamed and relocated**:

| `x/exp/constraints` | Stdlib equivalent |
|---------------------|-------------------|
| `constraints.Ordered` | `cmp.Ordered` |
| `constraints.Integer` | (still in x/exp) |
| `constraints.Float` | (still in x/exp) |
| `constraints.Signed` | (still in x/exp) |
| `constraints.Unsigned` | (still in x/exp) |
| `constraints.Complex` | (still in x/exp) |

So `Ordered` got the formal stdlib treatment; the others remained in `x/exp/`. The `cmp` package additionally provides `cmp.Compare` and `cmp.Less`.

### Deprecation status

As of Go 1.22+, `golang.org/x/exp/constraints.Ordered` has a documented note pointing users at `cmp.Ordered`. The `x/exp` package itself is **not** deprecated — `Integer`, `Float`, etc. still live there. But for "any orderable type", the canonical answer is now `cmp.Ordered`.

If a library upgrades to Go 1.21+ as its minimum, switching to `cmp.Ordered` is straightforward and recommended.

---

## Migration to `cmp.Ordered`

A real-world migration looks like this:

### Before (Go 1.18 - 1.20)

```go
import "golang.org/x/exp/constraints"

func Min[T constraints.Ordered](a, b T) T {
    if a < b { return a }
    return b
}
```

### After (Go 1.21+)

```go
import "cmp"

func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}
```

The change is purely a **rename**. The type set is identical — `cmp.Ordered` was designed as a drop-in replacement.

### Migration steps

1. Bump `go.mod` to `go 1.21` (or later).
2. Replace `golang.org/x/exp/constraints` import with `cmp` (where applicable).
3. Replace `constraints.Ordered` with `cmp.Ordered`.
4. Run tests — there should be no behavioural change.
5. Optionally, remove the `golang.org/x/exp/constraints` dependency from `go.mod` if it is no longer used.

### When to NOT migrate

- The library still supports Go 1.18 - 1.20. Then keep `x/exp/constraints` until you can drop those.
- The library uses `Integer`, `Float`, etc. exclusively. Those still live in `x/exp/`.

---

## Constraint API design for libraries

A library author exposes constraints to consumers. Every exported constraint is a contract that future versions must respect (or break carefully).

### Principles

1. **Reuse stdlib where possible.** Use `comparable`, `cmp.Ordered` first. Library-defined constraints should be the exception.
2. **Name by purpose.** `RowKey` is better than `IntsOrStrings`.
3. **Hide what is unstable.** Internal-helper constraints should be unexported.
4. **Document the type set explicitly.** Users cannot read the constraint definition without effort.
5. **Version with care.** A constraint change is a public-API change.

### Example: a sort library

```go
package mysort

import "cmp"

// Less is the constraint for types that define their own ordering.
// Implementers must provide LessThan such that LessThan is a strict
// total order (irreflexive, asymmetric, transitive).
type Less[T any] interface {
    LessThan(other T) bool
}

// Sort sorts s using cmp.Ordered semantics.
// For types not in cmp.Ordered, see SortFunc or the Less constraint.
func Sort[T cmp.Ordered](s []T) { ... }

// SortLess sorts s using the LessThan method on each element.
func SortLess[T Less[T]](s []T) { ... }

// SortFunc sorts s using the comparator cmp.
func SortFunc[T any](s []T, cmp func(a, b T) int) { ... }
```

Three exposed entry points, each with a different constraint flavour. Users pick based on what their type provides.

### When to define a custom constraint

- The contract is **specific to your library** (`RowKey`, `Hashable`, `Mergeable`).
- Reusing a stdlib constraint would express the wrong intent.
- The constraint composes more than three sub-constraints — naming improves readability.

### When to NOT define a custom constraint

- The constraint is a single union of built-in types.
- The constraint is used in only one function.
- The constraint duplicates `cmp.Ordered` or `comparable`.

---

## Evolving constraints without breaking callers

Constraints are part of your function's signature. Changing them affects callers. The **safe direction** is **loosening**.

### Safe changes

| Change | Impact |
|--------|--------|
| Add a new term to a union (`int → int \| float64`) | Loosen — safe |
| Remove a method requirement | Loosen — safe |
| Embed a wider constraint | Loosen — safe |
| Rename a constraint via type alias | Source-compatible |

### Unsafe changes

| Change | Impact |
|--------|--------|
| Remove a term from a union | Tightens — breaks callers |
| Add a method requirement | Tightens — breaks callers |
| Remove a wider embedded constraint | Tightens — breaks callers |
| Change `~int` to `int` | Tightens — breaks defined types |

### Worked example

You ship v1:

```go
func Sum[T ~int | ~float64](s []T) T { ... }
```

Two years later you want to add `~string`:

```go
// v2
func Sum[T ~int | ~float64 | ~string](s []T) T { ... }
```

Adding `~string` is **safe** — every caller of v1 still compiles. The new term is purely additive.

But removing `~float64`:

```go
// v3 — BREAKING
func Sum[T ~int](s []T) T { ... }
```

…breaks every caller using `float64`. This is a major-version bump.

### Strategy: version the constraint, not just the function

When you must tighten, prefer a **new** constraint name:

```go
// v1
type Numeric interface { ~int | ~float64 }
func Sum[T Numeric](s []T) T { ... }

// v2 — keep Numeric stable, add a stricter sibling
type Numeric interface { ~int | ~float64 }  // unchanged
type Integer interface { ~int }
func SumInt[T Integer](s []T) T { ... }
```

Now `Sum` continues to accept floats, while `SumInt` is the new strict variant.

---

## Versioning constraints

If you maintain a library, treat each exported constraint like an exported type. Conventions:

### Rule 1 — Major version bumps for tightening

Tightening a constraint is a breaking change. Bump the major version (`v2`, `v3`).

### Rule 2 — Minor versions for additions

Adding terms to a union, or adding a new constraint alongside existing ones, is additive. Minor bump.

### Rule 3 — Document the transition

In the package's CHANGELOG and godoc:

```go
// Sum returns the sum of all elements in s.
//
// Versions: 
//   v1.0.0  initial release with Numeric = {~int, ~float64}
//   v1.1.0  Numeric extended to include ~int64, ~float32
//   v2.0.0  BREAKING: Numeric tightened to {~int, ~int64} only
//
func Sum[T Numeric](s []T) T { ... }
```

### Rule 4 — Use the `Deprecated:` tag

```go
// MyOrdered is the legacy ordered constraint.
//
// Deprecated: use cmp.Ordered (Go 1.21+).
type MyOrdered interface {
    ~int | ~float64 | ~string
}
```

Tools (`gopls`, `staticcheck`) surface the deprecation warning at the call site.

---

## Documentation patterns

A constraint's godoc should answer four questions:

1. **What types are in the type set?**
2. **What operations does the constraint authorise?**
3. **Are there any runtime caveats** (e.g., `comparable` panics)?
4. **Is the constraint stable** or experimental?

### Template

```go
// Numeric is the constraint for all built-in numeric types and
// any user-defined types whose underlying type is one of them.
//
// Type set:
//   - signed integers: int, int8, int16, int32, int64
//   - unsigned integers: uint, uint8, uint16, uint32, uint64, uintptr
//   - floats: float32, float64
//
// Operations authorised: + - * / and <, <=, >, >=
//
// This constraint is stable. Adding more terms in a future minor
// version is considered backward-compatible.
type Numeric interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64
}
```

### Avoid

```go
// Numeric: numeric types.
type Numeric interface { ... }
```

The constraint definition is large and cryptic. Users skimming godoc need words.

---

## Case study: `slices.SortFunc` and the cmp.Compare migration

The `slices` package shipped in Go 1.21 with two sort functions:

```go
func Sort[S ~[]E, E cmp.Ordered](s S)
func SortFunc[S ~[]E, E any](s S, cmp func(a, b E) int)
```

`Sort` requires `cmp.Ordered`. `SortFunc` accepts any element with a comparator that returns `-1, 0, 1`.

A subtle change happened between Go 1.20 (in `x/exp`) and Go 1.21 (stdlib): the comparator signature evolved.

```go
// x/exp/slices (1.20)
func SortFunc[E any](s []E, less func(a, b E) bool)

// stdlib slices (1.21)
func SortFunc[S ~[]E, E any](s S, cmp func(a, b E) int)
```

Two changes:

1. **`less func(a, b E) bool`** became **`cmp func(a, b E) int`** — the int-returning comparator is more general (it can return 0 for equality, useful for stable sorts and ties).
2. **`[E any]`** became **`[S ~[]E, E any]`** — the slice type is now also a parameter, so sorting a `MySlice` returns a `MySlice`, not a `[]int`.

Both changes were considered worth the breakage. The team gambled that 1.18-1.20 users had not deeply locked themselves into `x/exp/slices`. In retrospect, the migration was painful but doable.

### Lessons

- **Even small constraint changes have ripple effects.** A signature evolves; every caller updates.
- **Stdlib status carries weight.** The team chose the right shape, even at the cost of a transition.
- **The `~[]E` pattern is now canonical** for slice-preserving generic helpers.

---

## Case study: `golang-lru/v2`

Hashicorp's `golang-lru` is a popular LRU cache library. Pre-generics, its API was:

```go
import "github.com/hashicorp/golang-lru"

cache, _ := lru.New(128)
cache.Add("key", "value") // value is interface{}
v, ok := cache.Get("key")
s := v.(string) // assertion required
```

After generics, they shipped `v2`:

```go
import "github.com/hashicorp/golang-lru/v2"

cache, _ := lru.New[string, string](128)
cache.Add("key", "value")
s, ok := cache.Get("key") // s is string
```

### Constraint choice

Their constraint:

```go
type Key any  // documented as: K must be hashable to use as a map key
```

Wait — `any`? Doesn't `K` need to be `comparable` for the underlying map?

Their actual signature:

```go
func New[K comparable, V any](size int) (*Cache[K, V], error)
```

`K comparable` is the right constraint. Earlier in their development they used `any` and got compile errors when implementing the `map[K]*entry`. The lesson: **constraints come from what the body needs**, not from what feels natural.

### Migration approach

- New module path (`/v2`) for the breaking change.
- `v1` stays alive for callers who cannot upgrade.
- README documents the migration with side-by-side examples.
- CI tests run against both v1 and v2 to catch regressions.

This is the canonical "library generics migration" pattern. Hashicorp did it right.

---

## Case study: domain-specific constraint hierarchies

A real fintech library might define:

```go
package money

import "cmp"

// Currency is a currency code (USD, EUR, JPY, ...).
type Currency interface {
    ~string
    Code() string
}

// Amount is a numeric amount in a specific currency.
type Amount[C Currency] interface {
    ~int64
    Currency() C
}

// Transferable describes amounts that can move between accounts.
type Transferable[C Currency] interface {
    Amount[C]
    cmp.Ordered
    Add(Amount[C]) Amount[C]
    Sub(Amount[C]) Amount[C]
}
```

Each constraint builds on the previous, and the type parameters propagate through. A function `func Move[A Transferable[USD]]` accepts only USD-denominated transferable amounts.

This is generics doing serious work. Three observations:

1. **Type parameters in constraints** (`Amount[C]`) make the hierarchy precise — you cannot accidentally mix USD and EUR.
2. **Verbosity increases.** Readers see `Amount[C Currency]` and need orientation.
3. **Compile errors are precise.** Passing an EUR amount to a USD function fails at the call site, not at runtime.

### When this is worth it

- Money. Different currencies must not be mixed.
- Units (meters vs feet). Same problem.
- Tenancy (tenant A's resources must not leak into tenant B).
- Type-tagged IDs (UserID vs OrderID — both int64, but distinct).

### When it is not

- One-off helpers.
- Internal pipelines where readers must move fast.
- Code that consumes plain integers.

A library that adopts this pattern owes its users **excellent documentation** and **good error messages**.

---

## Migration checklist

For a team adopting deeper generic constraints:

- [ ] `go.mod` requires Go 1.21+ (for `cmp.Ordered`).
- [ ] All `golang.org/x/exp/constraints.Ordered` replaced with `cmp.Ordered`.
- [ ] Custom constraints documented with type set, operations, stability.
- [ ] Constraint hierarchy follows layered embedding (no giant unions).
- [ ] No `comparable`-induced runtime panics on untrusted input (or a `recover` is in place).
- [ ] Public constraints reviewed for tighten/loosen safety.
- [ ] Deprecation notices in place for legacy constraints (`Deprecated:` tag).
- [ ] Lint rules updated (`staticcheck`, `golangci-lint` for `SA9009` empty type set).
- [ ] CI tests cover at least two type arguments per generic function.
- [ ] Benchmarks for constraint-heavy hot paths.
- [ ] Major-version bump scheduled if any constraint tightening is planned.
- [ ] CHANGELOG documents constraint evolution.

---

## Summary

The professional view of constraints is **API stewardship**. A constraint is a public contract:

1. **`golang.org/x/exp/constraints`** was the bridge from 1.18 to 1.21.
2. **`cmp.Ordered`** is now the canonical ordered constraint.
3. **Library constraints must be designed**, not invented ad hoc.
4. **Tightening breaks callers**; loosening does not.
5. **Major-version bumps** are the right tool for tightening.
6. **Documentation** is non-optional — type set, operations, stability.
7. **Real-world cases** (Hashicorp's `/v2`, fintech hierarchies) show the patterns at scale.

A senior library author treats every constraint like a public type — reviewed, documented, versioned, and evolved with discipline.

The next file (`specification.md`) walks through the formal spec text that backs all of this.
