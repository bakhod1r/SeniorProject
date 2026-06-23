# `comparable` and `cmp.Ordered` — Middle Level

## Table of Contents
1. [The 1.20 change in one paragraph](#the-120-change-in-one-paragraph)
2. [Pre-1.20 `comparable` — strict interfaces only](#pre-120-comparable-strict-interfaces-only)
3. [Post-1.20 `comparable` — interfaces qualify](#post-120-comparable-interfaces-qualify)
4. ["Strictly comparable" — the formal idea](#strictly-comparable-the-formal-idea)
5. [Type-by-type analysis](#type-by-type-analysis)
6. [Why slices, maps, and functions are excluded](#why-slices-maps-and-functions-are-excluded)
7. [How `comparable` interacts with embedded interfaces](#how-comparable-interacts-with-embedded-interfaces)
8. [The runtime panic possibility](#the-runtime-panic-possibility)
9. [Migrating code across the 1.20 boundary](#migrating-code-across-the-120-boundary)
10. [Summary](#summary)

---

## The 1.20 change in one paragraph

In **Go 1.20** the language relaxed which interface types satisfy the `comparable` constraint. Before 1.20, a generic parameter `[T comparable]` rejected interface arguments because the dynamic type of an interface might be uncomparable (a slice, map, or function), which would panic at runtime. Go 1.20 changed the rule: now interfaces **do** satisfy `comparable`, and if the dynamic type is uncomparable, `==` panics at runtime instead of failing at compile time. The release notes call this making `comparable` "less strict" so that more code compiles.

> Quote from the [Go 1.20 release notes](https://go.dev/doc/go1.20#language):
>
> "Comparable types (such as ordinary interfaces) may now satisfy comparable constraints, even if the type arguments are not strictly comparable (comparison may panic at runtime)."

This single sentence is the entire change. The rest of this file unpacks **why** it matters.

---

## Pre-1.20 `comparable` — strict interfaces only

Before Go 1.20:

```go
func Eq[T comparable](a, b T) bool { return a == b }

var x, y any = 1, 1
Eq(x, y) // ❌ compile error: any does not satisfy comparable
```

The compiler refused because `any` could hold a `[]int`, and `[]int` is not comparable. The language preferred a compile error to a possible runtime panic. The trade-off: large amounts of pre-existing code did not compile under generics. Anyone trying to write `Set[any]` or `Cache[any, X]` was blocked.

### The "strict comparability" rule

Pre-1.20, `comparable` was the set of types where `==` is **always** well-defined. Interface types failed because `==` on them is well-defined **only if** the dynamic types match and are themselves comparable. The compiler did not have that guarantee at the call site, so it rejected interfaces.

---

## Post-1.20 `comparable` — interfaces qualify

After 1.20:

```go
func Eq[T comparable](a, b T) bool { return a == b }

var x, y any = 1, 1
Eq(x, y) // ✓ compiles, returns true at runtime

var s, t any = []int{1}, []int{1}
Eq(s, t) // ✓ compiles, ❌ panics at runtime
```

The compiler now treats interfaces as satisfying `comparable` because `==` is **defined** on them, even if it can panic. The runtime panic message is:

```
panic: runtime error: comparing uncomparable type []int
```

This is the same panic you would get from `var a, b interface{} = []int{1}, []int{1}; _ = a == b` even **without** generics. The 1.20 change just made the rule consistent across generic and non-generic code.

---

## "Strictly comparable" — the formal idea

The Go specification distinguishes two levels:

| Level | Definition | Includes |
|-------|------------|----------|
| **Comparable** | `==` is defined and may compile | All non-slice/non-map/non-func types, plus interfaces |
| **Strictly comparable** | `==` never panics | Strictly comparable types only — excludes interfaces with uncomparable dynamics |

The spec says:

> The predeclared interface type `comparable` denotes the set of all non-interface types that are strictly comparable.

In Go 1.20+, interfaces also satisfy `comparable` even though they are not strictly comparable. The relaxation lets the compiler accept them, with the runtime taking on the panic risk.

A concrete way to remember:

```
strictly comparable  ⊂  comparable (since 1.20)  ⊂  any
```

---

## Type-by-type analysis

| Type | Comparable? | Strictly comparable? | Notes |
|------|-------------|----------------------|-------|
| `bool`, `int`, `float64`, `string` | yes | yes | trivial |
| `complex64`, `complex128` | yes | yes | `==` works |
| pointer `*T` | yes | yes | address compare |
| channel | yes | yes | reference compare |
| array `[N]T` | yes if `T` is | yes if `T` is | element-wise |
| struct | yes if all fields are | yes if all fields strictly are | recursive |
| **interface type** | yes (since 1.20) | **no** | runtime risk |
| `any` | yes (since 1.20) | **no** | very common case |
| slice `[]T` | **no** | no | use `slices.Equal` |
| map `map[K]V` | **no** | no | use `maps.Equal` |
| function | **no** | no | except for nil check |

The "interface" row is the entire 1.20 story.

---

## Why slices, maps, and functions are excluded

Three reasons, one per category:

### Slices

A slice is `(ptr, len, cap)`. Two slices may share underlying storage or not. There is no canonical interpretation of "are these the same slice" — by reference? by content? for what length? Go chose: not at all. To compare slices you must call `slices.Equal`.

### Maps

Maps have non-deterministic iteration order and incidental fields (load factor, bucket layout). Equality could only be defined as "same key set with same values", which is expensive to check by `==`. Go chose: not at all. Use `maps.Equal`.

### Functions

Two function values may be the same closure with different captured environments, or two distinct closures with identical bytecode. There is no useful definition of `==`. The only allowed comparison is `f == nil`.

---

## How `comparable` interacts with embedded interfaces

When you embed `comparable` in another interface, the rules differ from embedding a regular interface:

```go
type Eqable interface {
    comparable
    String() string
}

func F[T Eqable](x T) bool { return x == x }
```

This compiles in 1.20+. Pre-1.20, embedding `comparable` was allowed only as a constraint, and even then with restrictions. The 1.20 relaxation made `comparable` interchangeable with other interfaces in **constraint position**. It still cannot be used as a runtime interface value (`var x comparable = 1`).

### Recursive constraint with `comparable`

```go
type Key interface {
    comparable
    Hash() uint64
}
```

This is a real-world pattern: a constraint that says "is comparable AND has a Hash method". Used by some hash table libraries.

---

## The runtime panic possibility

In Go 1.20+, the price of making `comparable` more permissive is **runtime panics**. Here is the exact failure mode:

```go
type Box struct {
    ID   string
    Tags any // could be a slice
}

func Eq[T comparable](a, b T) bool { return a == b }

a := Box{ID: "x", Tags: []string{"a"}}
b := Box{ID: "x", Tags: []string{"a"}}
Eq(a, b) // panic at runtime: comparing uncomparable type []string
```

Why? `Box` is comparable (all field types are nominally comparable, including `any`). But the runtime `==` on `Box` recurses into the field-by-field comparison and the `any` field has a slice as its dynamic value. That triggers the panic.

### Defending against it

Three defenses:

1. **Avoid `any` fields** if the struct is used as a map key or set element.
2. **Document the contract** — "Tags must not contain a slice or map".
3. **Pre-validate** — when filling such a struct, reject uncomparable values explicitly.

For libraries that need to be safe, use `reflect.TypeOf(v).Comparable()` to check at runtime before storing the value.

---

## Migrating code across the 1.20 boundary

Two scenarios:

### Scenario 1 — A library bumps `go.mod` from 1.18 to 1.20+

**Win**: `Set[any]`, `Cache[any, V]`, `Map[any]K, V]` now compile.
**Risk**: callers may pass slices and trigger runtime panics.

Best practice: keep the constraint at `[K comparable, V any]` but add a runtime check on `Add`/`Set` for safety in libraries that store user-controlled data.

### Scenario 2 — Code that worked under 1.20 fails on 1.18

Common when older CI has not been bumped. The compile error is:

```
type any does not satisfy comparable
```

Fix: either bump the Go version (preferred) or constrain the parameter to a non-interface type.

### Linter behaviour

`staticcheck`'s `SA1029` warns on `==` over interfaces with potentially uncomparable dynamic types. After 1.20 it became more frequent — partly because more code now compiles only to panic later.

---

## Summary

The Go 1.20 change to `comparable` is the most subtle "small" language change since generics shipped. The summary in two lines:

1. **Before 1.20**: `comparable` = strictly comparable. Interfaces excluded.
2. **From 1.20**: `comparable` = comparable. Interfaces included. Runtime panic if the dynamic type is uncomparable.

What this means in practice:

- More code compiles under generics — `Set[any]` is finally legal.
- The risk of panic is real but bounded: it only happens when comparing values whose dynamic types are slices, maps, or functions.
- Libraries that store user data should validate or document the contract.
- The spec uses the phrase **"strictly comparable"** for the older, narrower definition. Reading the spec without that distinction is confusing.

The bigger story is that `comparable` shifted from a **compile-time discipline** to a **runtime contract**. It is now closer to `interface{}.==` in spirit — fast in the common case, but with the same panic possibility. A careful Go programmer treats `[T comparable]` not as "this will always succeed" but as "this is allowed to be compared".

The next file (`senior.md`) covers `cmp.Ordered` — its exact definition, NaN handling, and the patterns for using it cleanly.
