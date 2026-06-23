# `comparable` and `cmp.Ordered` — Specification

## Table of Contents
1. [Source of truth](#source-of-truth)
2. [Predeclared identifiers — `comparable`](#predeclared-identifiers-comparable)
3. [Type sets — the `comparable` redefinition](#type-sets-the-comparable-redefinition)
4. [Comparison operators](#comparison-operators)
5. [The Go 1.20 release-notes change](#the-go-120-release-notes-change)
6. [`cmp.Ordered` — package documentation](#cmpordered-package-documentation)
7. [`cmp.Compare`, `cmp.Less`, `cmp.Or`](#cmpcompare-cmpless-cmpor)
8. [Strictly comparable — the formal definition](#strictly-comparable-the-formal-definition)
9. [Embedding rules](#embedding-rules)
10. [What the spec forbids](#what-the-spec-forbids)
11. [Summary](#summary)

---

## Source of truth

The authoritative sources:

- The Go Programming Language Specification: <https://go.dev/ref/spec>
- Predeclared identifiers: <https://go.dev/ref/spec#Predeclared_identifiers>
- General interfaces (type sets): <https://go.dev/ref/spec#General_interfaces>
- Comparison operators: <https://go.dev/ref/spec#Comparison_operators>
- Go 1.20 release notes: <https://go.dev/doc/go1.20#language>
- Go 1.21 release notes (cmp): <https://go.dev/doc/go1.21#cmp>
- `cmp` package: <https://pkg.go.dev/cmp>

This document quotes and explains the relevant excerpts. Quotations are paraphrased for clarity; consult the official spec for canonical wording.

---

## Predeclared identifiers — `comparable`

The Go spec lists predeclared identifiers in one place:

> Types: `any bool byte comparable complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr`

`comparable` sits among the basic types — but it is **special**. Unlike `int` or `string`, it is an interface, not a concrete type. The spec treats it as a predeclared **interface type** (since 1.18) with a special rule about which types satisfy it.

There is no `package builtin` `var comparable = ...`. It is a name fixed by the language. You can shadow it (`var comparable int`) but doing so makes that name unavailable as a constraint in the enclosing scope.

---

## Type sets — the `comparable` redefinition

From the spec, in the **General interfaces** section:

> The predeclared interface type `comparable` denotes the set of all non-interface types that are strictly comparable.

Pre-1.20 this was the **entire** rule. Post-1.20, the spec was amended to add a clarification: interface types now also satisfy `comparable` for the purposes of type parameter satisfaction. The exact 1.20 wording (paraphrased):

> All ordinary interface types implement the `comparable` constraint when used as a type argument, even though they are not strictly comparable.

This is the reason `Eq[any](x, y)` compiles in Go 1.20+ but not in 1.18-1.19.

### Type set notation

A constraint is an interface; an interface defines a **type set**. The type set of `comparable` is — informally — "all types where `==` is well-defined".

```
type set of comparable =
    { all booleans, numerics, strings, pointers, channels,
      arrays of comparable elements,
      structs of comparable fields,
      [since 1.20] interfaces (with runtime panic possibility) }
```

Excluded:
- slices
- maps
- functions
- structs containing any of those
- arrays of any of those

---

## Comparison operators

The spec defines exactly which operators are allowed on which types:

> The equality operators `==` and `!=` apply to operands of comparable types.

> The ordering operators `<`, `<=`, `>`, and `>=` apply to operands that are ordered.

The spec defines "ordered" as:

> The values of type `int`, `float`, `string`, and their underlying-type derivatives are **ordered**.

Note this is **not** the same as `cmp.Ordered` — the spec's "ordered" predates 1.21 and refers to operator availability. `cmp.Ordered` is a constraint that **enumerates** the same set with `~`-style underlying-type matches.

### The full text on comparison

The spec lists:

1. **Boolean values** — comparable
2. **Integer values** — comparable and ordered
3. **Floating-point values** — comparable and ordered (special: `NaN < x` is false)
4. **Complex values** — comparable but **not ordered**
5. **String values** — comparable and ordered (lexical byte order)
6. **Pointer values** — comparable (address)
7. **Channel values** — comparable (reference)
8. **Interface values** — comparable; both must be the same dynamic type, which itself must be comparable, else **panic at runtime**
9. **Struct values** — comparable if all fields are
10. **Array values** — comparable if elements are

Key takeaway: **complex is comparable but not ordered**. That is why `cmp.Ordered` excludes it — the spec already excluded `<` for complex.

---

## The Go 1.20 release-notes change

Quoting the [Go 1.20 release notes](https://go.dev/doc/go1.20#language):

> Comparable types (such as ordinary interfaces) may now satisfy `comparable` constraints, even if the type arguments are not strictly comparable (comparison may panic at runtime). This makes it possible to instantiate a type parameter constrained by `comparable` (e.g., `type Set[T comparable] ...`) with a non-strictly comparable type argument such as an interface type, or a composite type containing an interface type.

Three things to note:

1. The change is **constraint-satisfaction only** — it does not change `==` semantics on values. It only changes **which types are accepted** at instantiation.
2. Runtime panic is the **same** panic that always existed for `==` on uncomparable interface dynamics. Generics did not introduce it; they just stopped blocking it.
3. The phrase **"strictly comparable"** entered the spec at this point. Older spec versions did not need the distinction.

### Before/after example

```go
func Eq[T comparable](a, b T) bool { return a == b }

// Pre-1.20:
Eq[any](1, 1) // ❌ compile error: any does not satisfy comparable

// Post-1.20:
Eq[any](1, 1)              // ✓ returns true
Eq[any]([]int{1}, []int{1}) // ✓ compiles, panics at runtime
```

### Impact on libraries

Pre-1.20 libraries declared their generic API with workarounds:

```go
// Pre-1.20 hack
type Set[T any] struct { ... }
```

Post-1.20 they can simply write:

```go
type Set[T comparable] struct { ... }
```

…and accept `any` as a type argument. The hack disappeared.

---

## `cmp.Ordered` — package documentation

From `cmp/cmp.go`:

```go
// Package cmp provides types and functions related to comparing
// ordered values.
package cmp

// Ordered is a constraint that permits any ordered type:
// any type that supports the operators < <= >= >.
// If future releases of Go add new ordered types,
// this constraint will be modified to include them.
//
// Note that floating-point types may contain NaN values,
// for which the operator <, <=, >, >= return false even
// when compared with themselves. See [Compare] for a consistent
// way to compare NaN values.
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
        ~float32 | ~float64 |
        ~string
}
```

### Reading the constraint

- **Tilde everywhere**: every term is `~T`, so domain types `type Score int` qualify.
- **Numeric span**: all signed and unsigned integers, both float widths.
- **String included** — strings are ordered by byte (lexical, not Unicode-aware).
- **Excludes**: complex, time.Time, structs, slices, maps.

### "Future releases may modify"

The spec leaves room for adding ordered types later. So a library that depends on `cmp.Ordered` is **forward-compatible**. Re-defining `Ordered` locally would lock you in to the 1.21 type set.

---

## `cmp.Compare`, `cmp.Less`, `cmp.Or`

The package defines three companion functions:

```go
// Compare returns -1 if x < y, 0 if x == y, +1 if x > y.
// For floating-point types, NaN is less than any non-NaN, and NaN equals NaN.
func Compare[T Ordered](x, y T) int

// Less reports whether x is less than y.
// For floating-point types, NaN is treated as less than any non-NaN.
func Less[T Ordered](x, y T) bool

// Or returns the first of its arguments that is not equal to the zero value.
// If no argument is non-zero, it returns the zero value.
func Or[T comparable](vals ...T) T  // 1.22+
```

The first two **redefine** float comparison so NaN has a deterministic position. They guarantee a **total order** for any `cmp.Ordered` type, which the operators do not.

The third, `cmp.Or`, was added in 1.22. It chains comparators or any zero-checking expression. It is the official replacement for hand-rolled `Coalesce[T comparable]`.

---

## Strictly comparable — the formal definition

The spec introduced the term **strictly comparable** in 1.20 to describe the older, narrower meaning:

> A type is **strictly comparable** if it is comparable and not an interface type, nor composed of interface types.

In other words, a type is strictly comparable when `==` is **guaranteed** to terminate without panic. Strictly comparable types form a subset of comparable types:

```
strictly comparable ⊂ comparable ⊂ all types
```

| Type | comparable | strictly comparable |
|------|------------|---------------------|
| `int` | yes | yes |
| `string` | yes | yes |
| `[3]int` | yes | yes |
| `struct{ X int }` | yes | yes |
| `any` (interface) | yes (1.20+) | **no** |
| `struct{ A any }` | yes (1.20+) | **no** |
| `[]int` | no | no |

The notion appears in the spec mainly to explain why `comparable` accepts some types whose `==` may panic.

---

## Embedding rules

You can embed `comparable` in another interface intended as a constraint:

```go
type Hashable interface {
    comparable
    Hash() uint64
}

func F[T Hashable](x T) uint64 { ... }
```

The spec explicitly allows this since 1.18. It is the canonical way to require both equality and a method.

You **cannot** use such an interface as a runtime value:

```go
var x Hashable = 1 // compile error: interface contains type constraints
```

Interfaces with type constraints (including `comparable` embedded, or a type element list) can only be **constraints**, not runtime types. The spec calls them **basic** vs **general** interfaces; only basic interfaces can be runtime values.

### A subtle 1.20 relaxation

Pre-1.20, embedding `comparable` was restricted in some positions. From 1.20, embedding is allowed in any constraint position. The change:

> The `comparable` predeclared interface may now be embedded into other interfaces, and (in particular) may be used as a constraint together with method elements.

This let people write `Hashable interface { comparable; Hash() }` cleanly.

---

## What the spec forbids

### 1. Using `comparable` as a runtime type

```go
var x comparable = 1 // ❌
```

Constraints cannot be runtime values.

### 2. Using `cmp.Ordered` as a runtime type

```go
var x cmp.Ordered = 1 // ❌
```

Same reason — `cmp.Ordered` contains a type element (`~int | ...`).

### 3. Defining a custom `comparable`

The name is reserved. You can shadow it locally but the predeclared one is unique.

### 4. Calling `<` on `comparable`

```go
func F[T comparable](a, b T) bool { return a < b } // ❌
```

`comparable` does not include ordering. Use `cmp.Ordered`.

### 5. Adding complex to `cmp.Ordered`

You cannot extend `cmp.Ordered` with `complex64` because the spec defines complex as not ordered.

### 6. Asserting comparability at runtime via the constraint

```go
func F[T any](v T) {
    if T is comparable { ... } // ❌ — no such syntax
}
```

The constraint is a static thing. To check at runtime, use `reflect.TypeOf(v).Comparable()`.

---

## Summary

The Go specification handles `comparable` and `cmp.Ordered` cleanly once you separate the two ideas:

1. **`comparable` is in the language**. It sits in the predeclared identifiers list. Its type set was clarified in 1.20 (the "comparable / strictly comparable" split).
2. **`cmp.Ordered` is in the standard library**. Added in 1.21 (`package cmp`). It uses tilde-prefixed unions to enumerate ordered underlying types.
3. **Comparison operators are defined per type kind**. Booleans/numbers/strings/pointers/channels are comparable; integers/floats/strings are also ordered; complex is comparable but not ordered.
4. **The 1.20 release notes added one sentence** that changed how `comparable` interacts with interfaces — making more code compile at the cost of possible runtime panics.
5. **`cmp.Compare`, `cmp.Less`, `cmp.Or`** complete the package. They give NaN-deterministic ordering and zero-coalescing.
6. **Constraints cannot be runtime types** — they are static.
7. **Embedding `comparable`** in user constraints is fully supported since 1.20.

For day-to-day generic Go, you only need the operator semantics and the constraint shapes. For library design, the 1.20 relaxation and the 1.21 promotion of `cmp` are the load-bearing facts. The spec is short on this topic precisely because the design is conservative — one predeclared identifier, one stdlib package, no new syntax. Next: `interview.md` to drill the questions.
