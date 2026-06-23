# Generic Constraints Deep Dive — Specification

## Table of Contents
1. [Source of truth](#source-of-truth)
2. [Spec section: "Type constraints"](#spec-section-type-constraints)
3. [Spec section: "Type sets"](#spec-section-type-sets)
4. [Spec section: "Implementing an interface"](#spec-section-implementing-an-interface)
5. [Spec section: "Core types"](#spec-section-core-types)
6. [The `comparable` predeclared type](#the-comparable-predeclared-type)
7. [The Go 1.20 `comparable` change](#the-go-120-comparable-change)
8. [Grammar of constraints](#grammar-of-constraints)
9. [Forbidden constructs](#forbidden-constructs)
10. [Summary](#summary)

---

## Source of truth

The authoritative source is the **Go Programming Language Specification**:

- <https://go.dev/ref/spec> — full spec
- <https://go.dev/ref/spec#Type_sets> — type sets
- <https://go.dev/ref/spec#Type_constraints> — type constraints
- <https://go.dev/ref/spec#Implementing_an_interface> — implementation rule
- <https://go.dev/ref/spec#Core_types> — core types
- <https://go.dev/doc/go1.20#language> — Go 1.20 release notes (comparable change)

This file paraphrases relevant excerpts. Always consult the live spec for canonical wording.

---

## Spec section: "Type constraints"

The spec opens the type-constraint section with a one-sentence definition:

> A type constraint is an interface that defines the set of permissible type arguments for the respective type parameter and controls the operations supported by values of that type parameter.

Three things to take from this:

1. **A constraint is an interface.** Not a new kind of declaration. Every constraint can be referred to as if it were a regular interface.
2. **A constraint defines a type set.** The "set of permissible type arguments" is the type set.
3. **A constraint controls operations.** The body of a generic function may use only the operations the constraint authorises.

### The constraint syntax

The spec describes constraints as interface types whose interface elements may include **type elements** in addition to method elements:

```ebnf
InterfaceType  = "interface" "{" { InterfaceElem ";" } "}" .
InterfaceElem  = MethodElem | TypeElem .
MethodElem     = MethodName Signature .
TypeElem       = TypeTerm { "|" TypeTerm } .
TypeTerm       = Type | UnderlyingType .
UnderlyingType = "~" Type .
```

So an interface body now has two kinds of element. A method element is a method signature; a type element is one or more type terms separated by `|`.

### Convenience: omit `interface{ ... }`

The spec allows a shorthand when the constraint is a single type element:

```go
func F[T int | string](v T) {}
// equivalent to
func F[T interface{ int | string }](v T) {}
```

This is purely sugar.

---

## Spec section: "Type sets"

> The interface type defines a type set, which is the set of types that implement the interface.

The spec describes the type set by recursion:

- The type set of an **empty interface** is the set of all (non-interface) types.
- The type set of a **method element** `m` is the set of types whose method set includes `m`.
- The type set of a **type term** `T` (without `~`) is the singleton `{T}`.
- The type set of a **type term** `~T` is the set of all types whose underlying type is `T`.
- The type set of a **union** `A | B` is the union of the type sets of `A` and `B`.
- The type set of an **interface with multiple elements** is the **intersection** of the type sets of the individual elements.

So to compute a constraint's type set, you do this:

1. For each type element, compute its set (union of terms).
2. For each method element, compute its set (types with the method).
3. Intersect all of them.

### A worked example

```go
type C interface {
    ~int | ~float64
    Stringer
    comparable
}
```

Step 1: `~int | ~float64` → all defined types whose underlying is `int` or `float64`.
Step 2: `Stringer` → all types with `String() string`.
Step 3: `comparable` → all strictly comparable types.

Intersection of all three: defined types with `int`/`float64` underlying that have `String() string` and are comparable. The set is non-empty (every `int`-underlying type with a `String` method qualifies; ints are comparable).

### Empty type sets

```go
type C interface { int; string }
```

Singleton `{int}` intersect `{string}` = empty. The constraint compiles, but no type satisfies it.

The spec explicitly allows empty type sets:

> A type element with an empty type set is permitted.

But functions/types using such constraints cannot be instantiated.

---

## Spec section: "Implementing an interface"

This section is critical. The spec says:

> A type T implements an interface if
> - T is not an interface and is an element of the type set of the interface, or
> - T is an interface and the type set of T is a subset of the type set of the interface.

Two cases to read carefully:

### Case 1 — `T` is a concrete (non-interface) type

```go
type Numeric interface { ~int | ~float64 }
type Celsius int
```

Is `Celsius` in the type set of `Numeric`?

`Numeric`'s type set is "all types whose underlying is `int` or `float64`". `Celsius`'s underlying type is `int`. So yes — `Celsius` is in the set, hence `Celsius` implements `Numeric`.

### Case 2 — `T` is itself an interface

```go
type StringerOrComparable interface { Stringer; comparable }
type SomeInterface interface { String() string }

func F[T StringerOrComparable](v T) {}
```

Is `SomeInterface` in the type set of `StringerOrComparable`? **Only if** `SomeInterface`'s type set is a **subset** of `StringerOrComparable`'s type set.

`SomeInterface`'s type set: all types with `String()`.
`StringerOrComparable`'s type set: all types with `String()` AND comparable.

`SomeInterface` includes types that are **not** comparable (slices, maps with String methods). So `SomeInterface` is **not** a subset. Therefore `SomeInterface` does **not** implement `StringerOrComparable`.

This subset rule is subtle and trips up readers. The takeaway: when both sides are interfaces, satisfaction is by **set inclusion**, not by method coincidence.

---

## Spec section: "Core types"

The "core type" concept matters when the body of a generic function uses operations like `len`, `cap`, `range`, indexing, channel ops. The spec defines core type as follows:

> Each non-interface type T has a core type, which is the same as the underlying type of T.
>
> An interface T has a core type if one of the following conditions is satisfied:
> - The type set of T contains only channel types with identical element type E, and all directional channels have the same direction.
> - The type set of T contains only types with the same underlying type, or the type set is empty.
>
> Otherwise, T has no core type.

The point of "core type" is this: the body of a generic function can use an operation only if the constraint has a **core type** that supports it.

### Example with `range`

```go
type Slice interface { ~[]int | ~[]string }

func F[T Slice](s T) {
    for _, _ = range s { // legal?
    }
}
```

Does `Slice` have a core type? Its type set contains types with underlying `[]int` and `[]string` — **different** underlying types. So `Slice` has **no core type**.

Result: `range s` does **not** compile, because `range` requires a core type.

### Fix

```go
type Slice[E any] interface { ~[]E }

func F[T Slice[E], E any](s T) {
    for _, _ = range s { // OK
    }
}
```

Now the type set is `{~[]E}` for a fixed `E`. All members have the same underlying — `[]E`. Core type exists. `range` is allowed.

### Operations requiring a core type

| Operation | Required core type |
|-----------|--------------------|
| `len(v)`, `cap(v)` | string, array, slice, map, channel |
| `range v` | string, array, slice, map, channel |
| `v[i]` (indexing) | string, array, slice, map |
| `v[i:j]` (slicing) | string, array, slice |
| `<-c`, `c <- v` | channel with matching direction |
| `close(c)` | channel |
| `make(T, n)` | slice, map, channel |

Without a core type, none of these compile. The "core type" concept thus shapes what generic constraints must look like for a given body.

---

## The `comparable` predeclared type

The spec defines `comparable`:

> The predeclared type comparable denotes the set of all non-interface types that are strictly comparable.

The exact definition of "strictly comparable" is:

> Type parameters are comparable if their type set is comparable.
>
> A type is strictly comparable if it is comparable and not an interface type, and not composed of interface types.

**Strictly comparable types**:

- Booleans
- Numeric types
- Strings
- Pointers
- Channels
- Arrays of strictly comparable elements
- Structs of strictly comparable fields

**Not strictly comparable** (but still comparable in the regular sense):

- Interface types
- Types containing interface fields
- Slices, maps, functions (not comparable at all)

The spec explicitly forbids declaring your own version of `comparable`. It is a single, special, predeclared identifier.

---

## The Go 1.20 `comparable` change

The Go 1.20 release notes (`https://go.dev/doc/go1.20#language`) document the change:

> Comparable types (such as ordinary interfaces) may now satisfy `comparable` constraints, even if the type arguments are not strictly comparable (because interfaces that are not type parameters are comparable but are not strictly comparable). This makes it possible to instantiate a type parameter constrained by `comparable` (e.g., `T comparable`) with a non-strictly comparable type argument such as an interface type or a composite type containing an interface type.

In effect, the spec changed:

- **Pre-1.20:** `comparable`'s type set excludes interface types and composites containing interfaces.
- **From 1.20:** `comparable`'s type set includes them, but `==` may panic at runtime if the dynamic types are themselves non-comparable.

### Why the change

A common pre-1.20 frustration:

```go
type Cache[K comparable, V any] struct{ ... }

c := Cache[any, int]{} // ❌ in 1.18-1.19 — `any` is not strictly comparable
```

`map[any]int` works at the language level (Go's regular map is fine with interface keys). But generics rejected `any` as a `comparable` argument because `any` is not strictly comparable. The asymmetry was confusing.

Go 1.20 closed the gap. Now `Cache[any, int]` compiles, with the trade-off that an `==` comparison may panic if the actual dynamic value is a slice or map.

### Practical implications

```go
// 1.20+
type Bag[T comparable] struct { items []T }

func (b *Bag[T]) Has(v T) bool {
    for _, x := range b.items { if x == v { return true } }
    return false
}

b := Bag[any]{}
b.items = append(b.items, []int{1})
b.Has([]int{1}) // panic: runtime error: comparing uncomparable type []int
```

The compile-time check is loose; the runtime is risky. Library authors must document this.

### Forward compatibility

If you target Go 1.18 or 1.19 in `go.mod`, you cannot rely on the loosening. Code that uses `comparable` with interface types should declare `go 1.20` (or later) at minimum.

---

## Grammar of constraints

The full EBNF for type-parameter declarations and constraints:

```ebnf
TypeParameters  = "[" TypeParamList [ "," ] "]" .
TypeParamList   = TypeParamDecl { "," TypeParamDecl } .
TypeParamDecl   = IdentifierList TypeConstraint .
TypeConstraint  = TypeElem .
TypeElem        = TypeTerm { "|" TypeTerm } .
TypeTerm        = Type | UnderlyingType .
UnderlyingType  = "~" Type .

InterfaceType   = "interface" "{" { InterfaceElem ";" } "}" .
InterfaceElem   = MethodElem | TypeElem .
MethodElem      = MethodName Signature .
```

A type parameter declaration is `IdentifierList TypeConstraint`. The `TypeConstraint` is itself a `TypeElem` — meaning it can be a single type term, a union, or (because `Type` can be an interface) an interface type with a body.

### Reading exotic constraints

```go
[T comparable]                                  // single type term: comparable
[T int | string]                                // union of two type terms
[T ~int | ~float64]                             // union with tildes
[T interface{ ~int; String() string }]          // anonymous interface
[T MyConstraint]                                // named constraint
[K comparable, V any, F func(K) V]              // three params, mixed
```

The grammar tolerates a trailing comma in the type parameter list — `[T any,]` is legal — but most code does not use it.

---

## Forbidden constructs

The spec forbids several constraint shapes:

### 1. `~T` where `T` is an interface

```go
type Bad interface { ~error } // ❌
```

The spec: "The operand T of a term `~T` must be a type, and that type must not be an interface."

### 2. Constraint cycles

```go
type C interface { ~int; C } // ❌ self-reference
```

A constraint cannot embed itself. The spec rejects this at compile time.

### 3. Type elements with non-type expressions

```go
type C interface { 1 | 2 } // ❌ — 1 and 2 are values, not types
```

Type terms must be types.

### 4. Method elements duplicating an inherited one with a different signature

```go
type A interface { Read(p []byte) (int, error) }
type B interface {
    A
    Read(p string) (int, error) // ❌ conflicting Read
}
```

Same name, different signatures — illegal.

### 5. `comparable` redefined

```go
type comparable interface { ... } // ❌ — predeclared, cannot be redefined
```

You can shadow it locally with a `var comparable ...`, but you cannot declare a new type named `comparable` at package scope.

### 6. Type elements in non-constraint interfaces (pre-1.18 grammar)

The grammar change in 1.18 allowed type elements in interface bodies. Pre-1.18 Go does not understand them. If you import a 1.18-compiled package into a 1.17 codebase, the interface declarations break compilation. (This is why old codebases must bump `go.mod` to enable generics.)

---

## Summary

The Go specification handles constraints with surprising **economy** — they are interfaces with extended elements, governed by **set algebra**:

1. **A constraint is an interface** (spec: "Type constraints").
2. **A constraint defines a type set** (spec: "Type sets").
3. **`T` implements `I`** by either set membership (concrete `T`) or set inclusion (interface `T`).
4. **The "core type"** governs which operations are allowed inside a generic body.
5. **`comparable`** is a special predeclared interface, loosened in Go 1.20.
6. **The grammar** distinguishes method elements from type elements; multiple elements intersect.
7. **Forbidden constructs** keep the system tractable.

For day-to-day work, you rarely consult the spec. But when you debug a baffling "T does not satisfy C" error, knowing that satisfaction is a **set membership / set inclusion** rule is the unlock. Read the constraint as a set, the candidate as a set, and check the rule.

Move on to `interview.md` to drill the questions a senior Go engineer is asked about constraints.
