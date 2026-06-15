# `min`, `max` & `clear` Built-ins — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where These Are Specified](#where-these-are-specified)
3. [`min` and `max`: Synopsis](#min-and-max-synopsis)
4. [`min` and `max`: Type Rules](#min-and-max-type-rules)
5. [`min` and `max`: Constant Behaviour](#min-and-max-constant-behaviour)
6. [`min` and `max`: Floating-Point Rules](#min-and-max-floating-point-rules)
7. [`clear`: Synopsis and Semantics](#clear-synopsis-and-semantics)
8. [`clear` on Maps (Including NaN Keys)](#clear-on-maps-including-nan-keys)
9. [`clear` on Slices](#clear-on-slices)
10. [Contrast with `math.Min` / `math.Max`](#contrast-with-mathmin--mathmax)
11. [Differences Across Go Versions](#differences-across-go-versions)
12. [References](#references)

---

## Introduction

`min`, `max`, and `clear` are **predeclared built-in functions** of the Go language, added in Go 1.21. Unlike `go mod vendor` or other tooling, these *are* specified by the Go language specification itself, in the "Built-in functions" chapter. The authoritative sources, in decreasing formality:

1. **The Go Language Specification** — `go.dev/ref/spec`, sections *"Min and max"* and *"Clear"*.
2. **The Go 1.21 release notes** — `go.dev/doc/go1.21`, which announced the additions.
3. **The toolchain source** — `go/types/builtins.go` and the compiler's lowering passes, as the de-facto reference where the prose is terse.

This file separates what the spec states normatively from convention and implementation detail.

---

## Where These Are Specified

The built-ins appear in the specification under **"Built-in functions"**, alongside `len`, `cap`, `make`, `append`, `delete`, and the others. The two relevant subsections are:

- **"Min and max"** — defines `min` and `max`.
- **"Clear"** — defines `clear`.

They are also listed in the **"Predeclared identifiers"** section, which enumerates every name the language predeclares in the universe block. Being predeclared means they are available in every file with no import, and may be shadowed by a local or package-level declaration of the same name (the compatibility mechanism that allowed their addition).

---

## `min` and `max`: Synopsis

```
min(x, y ...T) T   // smallest argument
max(x, y ...T) T   // largest argument
```

(Informal signature — the built-ins are not expressible as ordinary Go functions because they are generic over all ordered types and variadic over any fixed count.)

- They take **one or more arguments** of the same ordered type.
- `min` returns the smallest argument; `max` returns the largest.
- The result has the same type as the arguments.
- A call with a single argument returns that argument unchanged.
- Zero arguments is a compile error.

---

## `min` and `max`: Type Rules

Per the specification:

- The arguments must be of an **ordered type** — an integer, floating-point, or string type, or a type whose underlying type is one of those. (These are exactly the types for which the `<` operators are defined.)
- The arguments are subject to the **same operand-combination rules as binary operators**: untyped constants are converted to fit a typed operand; all arguments must end up at a single type.
- The **result type is that common type**, preserving named (defined) types.

If the arguments cannot be combined to a single ordered type — for example two distinct typed operands, or a non-ordered type — the call is rejected at compile time.

```go
min(1, 2)               // int (untyped constants default to int)
max(1.0, 2)             // float64 (2 converts to float)
min(intVar, 3)          // int (3 representable as int)
max(intVar, floatVar)   // ERROR: arguments have different types
min(structVal, other)   // ERROR: struct is not ordered
```

---

## `min` and `max`: Constant Behaviour

The specification states that **if all arguments are constant, the result is constant**. The result is computed at compile time, and the call may appear in any constant context — array lengths, `const` declarations, and other constant expressions.

```go
const C = max(10, 20)        // C is the constant 20
var a [min(4, 8)]int         // an array of length 4
```

If **any** argument is a non-constant (a variable or other runtime value), the entire `min`/`max` expression is a non-constant runtime expression and cannot appear where a constant is required.

Constant evaluation uses arbitrary precision (as for all untyped-constant arithmetic); the result's representability is checked when it is converted to a concrete type.

---

## `min` and `max`: Floating-Point Rules

The specification gives explicit rules for floating-point arguments. Reproduced in substance (consult the spec for the exact current wording):

- **If any argument is a NaN, the result is a NaN** — regardless of the other arguments. NaN propagates.
- **Negative zero is smaller than (non-negative) zero.** Thus `min(-0.0, 0.0)` is `-0.0` and `max(-0.0, 0.0)` is `0.0`, even though `-0.0 == 0.0` is `true`.
- **Negative infinity is smaller than any other number**, and **positive infinity is larger than any other number** (with NaN excepted by the rule above).

These rules define a total decision for every pair of float arguments. They are the language's own rules and, as the standard library documents, differ from `math.Min`/`math.Max` for the NaN-and-infinity combinations (see [Contrast](#contrast-with-mathmin--mathmax)).

```go
max(1.0, math.NaN())              // NaN
min(1.0, math.NaN())              // NaN
max(0.0, math.Copysign(0, -1))    // 0.0
min(0.0, math.Copysign(0, -1))    // -0.0
max(math.Inf(1), 1e308)           // +Inf
```

The same rules apply componentwise where relevant for the constant case, but a constant NaN is not expressible, so NaN is purely a runtime concern.

---

## `clear`: Synopsis and Semantics

```
clear(t)
```

where `t` is a **map**, a **slice**, or a **type parameter** whose type set contains only maps and/or slices.

The specification defines `clear` by the argument's kind:

- If `t` is a **map**, `clear` **deletes all entries**, resulting in an empty map.
- If `t` is a **slice**, `clear` **sets all elements up to the length of the slice to the zero value** of the element type. (Elements beyond the length, in the capacity region, are not affected.)
- If `t` is a **type parameter**, the argument's actual type at instantiation must be a map or slice, and the corresponding behaviour applies.

`clear` returns nothing. It operates in place.

---

## `clear` on Maps (Including NaN Keys)

For a map, `clear(m)`:

- Removes **every** key/value entry. `len(m)` becomes `0` afterward.
- Operates **in place** — the same map value is emptied; aliases to it observe the empty map.
- Removes entries whose keys are **not equal to themselves**, notably floating-point NaN keys (and keys containing NaN, such as arrays/structs of floats, or interfaces wrapping such values). These keys **cannot be removed by `delete`**, because `delete(m, k)` performs a lookup that NaN keys never satisfy. This correctness property is a primary motivation for `clear`.
- On a **nil** map, `clear` does nothing (no panic).

```go
m := map[float64]int{math.NaN(): 1}
delete(m, math.NaN())   // no-op: NaN never matches
len(m)                  // 1
clear(m)                // removes the NaN entry
len(m)                  // 0
```

---

## `clear` on Slices

For a slice, `clear(s)`:

- Sets each element in `s[0:len(s)]` to the **zero value** of the element type.
- Does **not** change the slice's length or capacity.
- Does **not** touch elements in the capacity region beyond `len(s)`; to zero the entire backing array, call `clear(s[:cap(s)])`.
- For element types containing pointers, zeroing drops those references (relevant for garbage collection and reference hygiene).
- On a **nil** or zero-length slice, `clear` does nothing.

```go
s := []int{1, 2, 3}
clear(s)
// s == []int{0, 0, 0}; len(s) == 3; cap unchanged
```

`clear(s)` is distinct from `s = s[:0]` (which sets length to 0 but leaves the backing array's data intact) and from `s = nil` (which discards the slice entirely).

---

## Contrast with `math.Min` / `math.Max`

`math.Min` and `math.Max` are **standard-library functions**, not built-ins, defined only for `float64`. Their documented special cases:

```
math.Max(x, +Inf) = +Inf      math.Min(x, -Inf) = -Inf
math.Max(x, NaN)  = NaN        math.Min(x, NaN)  = NaN
math.Max(+0, ±0)  = +0         math.Min(-0, ±0)  = -0
```

The `math` package documentation explicitly notes that these **differ from the built-in `max`/`min` when called with NaN and +Inf** (for `Max`) and **NaN and -Inf** (for `Min`): the `math` functions were specified to a strict IEEE-754 `maxNum`/`minNum` intent, whereas the built-ins follow the language spec's rules above. Both produce NaN for a NaN argument and order signed zeros in the same direction, but they are *not* interchangeable in general, and they accept different types (the built-ins accept any ordered type; `math.Min`/`math.Max` accept only `float64`).

The guidance: use the built-ins in new code; use `math.Min`/`math.Max` only when the documented IEEE behaviour is specifically required.

---

## Differences Across Go Versions

- **Go 1.20 and earlier** — `min`, `max`, and `clear` are **not** predeclared. They may be used as ordinary identifiers. The built-in behaviour does not exist.
- **Go 1.21** — `min`, `max`, and `clear` are added as predeclared built-in functions. Available only when the module's `go` directive is `1.21` or higher (the compiler gates the feature on the language version). The `cmp`, `slices`, and `maps` standard packages ship in the same release.
- **Go 1.22+** — No semantic changes to the three built-ins; the spec text is stable. Surrounding library functions (`slices.Min`/`slices.Max`, `maps.Clone`) continue to evolve independently.

A module with `go 1.20` in `go.mod` building under a 1.21+ toolchain will **not** see the built-ins; the language-version gate applies. Bumping the `go` directive to `1.21`+ is the supported way to opt in.

---

## References

- [Go Language Specification — "Min and max"](https://go.dev/ref/spec#Min_and_max) — authoritative.
- [Go Language Specification — "Clear"](https://go.dev/ref/spec#Clear) — authoritative.
- [Go Language Specification — "Predeclared identifiers"](https://go.dev/ref/spec#Predeclared_identifiers)
- [Go 1.21 Release Notes — language changes](https://go.dev/doc/go1.21#language)
- [`math.Max` / `math.Min` documentation](https://pkg.go.dev/math#Max) — the contrasting IEEE special cases.
- [`cmp.Ordered`](https://pkg.go.dev/cmp#Ordered) — the constraint matching the built-ins' accepted types.
- [`slices.Min` / `slices.Max`](https://pkg.go.dev/slices#Max) — collection counterparts.
- [Source: `go/types/builtins.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/go/types/builtins.go)
