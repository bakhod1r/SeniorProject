# Type Constraints — Specification

## Table of Contents
1. [Scope](#scope)
2. [Spec Sources](#spec-sources)
3. [Type Parameter Lists](#type-parameter-lists)
4. [Type Constraints — Formal Definition](#type-constraints-formal-definition)
5. [Interface Types — Updated](#interface-types-updated)
6. [Type Set](#type-set)
7. [Type Element](#type-element)
8. [Method Element](#method-element)
9. [The Union (`|`) Operator](#the-union-operator)
10. [The Approximation (`~`) Operator](#the-approximation-operator)
11. [Basic vs General Interface](#basic-vs-general-interface)
12. [Satisfaction](#satisfaction)
13. [Implementation](#implementation)
14. [`comparable` Built-in](#comparable-built-in)
15. [Core Type Rule](#core-type-rule)
16. [Operator Restrictions](#operator-restrictions)
17. [Grammar (EBNF)](#grammar-ebnf)
18. [Examples From the Spec](#examples-from-the-spec)
19. [Differences Across Go Versions](#differences-across-go-versions)
20. [Summary](#summary)

---

## Scope

This page is a faithful summary of the parts of the Go language specification that govern type constraints. Where useful, we quote the spec verbatim and add commentary. The page is targeted at engineers who want a single document to reference rather than navigating the spec multiple times.

> Note. The Go specification is the ultimate source of truth. When this document and the spec disagree, the spec wins. The spec is at https://go.dev/ref/spec.

---

## Spec Sources

- §Type parameters
- §Interface types (the "general interfaces" subsection)
- §Type identity and assignability
- §Predeclared identifiers (`any`, `comparable`)
- §Operators (operand types and core type rules)

---

## Type Parameter Lists

A generic declaration introduces a **type parameter list** in square brackets. Each element of the list is a type parameter together with its constraint.

```ebnf
TypeParameters  = "[" TypeParamList [ "," ] "]"
TypeParamList   = TypeParamDecl { "," TypeParamDecl }
TypeParamDecl   = IdentifierList TypeConstraint
TypeConstraint  = TypeElem
```

`TypeElem` is the recursive structure that allows unions, type literals, and the `~` prefix. We define it below.

A simple example:

```go
func F[T any](x T) T { return x }
```

Here `T any` means: identifier `T`, constraint `any`. `any` is itself a `TypeElem`.

A two-parameter example:

```go
func G[K comparable, V any](m map[K]V) []K { ... }
```

`K comparable` and `V any` are two `TypeParamDecl` items.

---

## Type Constraints — Formal Definition

The spec defines:

> A **type constraint** is an interface that defines the set of permissible type arguments for the respective type parameter and controls the operations supported by values of that type parameter.

Two halves to that definition:
1. The **type set** of the interface defines which type arguments are allowed.
2. The operations of the type parameter are limited to those supported by **all** types in the type set (subject to the core-type rule).

Every interface has a type set; therefore every interface can serve as a constraint. The reverse — using a constraint as a value type — is restricted: a **general** interface is not allowed in value positions.

---

## Interface Types — Updated

Pre-1.18, an interface type was:

```ebnf
InterfaceType = "interface" "{" { MethodSpec ";" } "}"
MethodSpec    = MethodName Signature | InterfaceTypeName
```

Go 1.18 generalises:

```ebnf
InterfaceType = "interface" "{" { InterfaceElem ";" } "}"
InterfaceElem = MethodElem | TypeElem
MethodElem    = MethodName Signature
TypeElem      = TypeTerm { "|" TypeTerm }
TypeTerm      = Type | UnderlyingType
UnderlyingType = "~" Type
```

So an interface is now a list of `InterfaceElem`s, each of which is either a method spec (the classic kind) or a type element (the new kind).

A type element is a `|`-separated list of `TypeTerm`s. Each term is either a plain type or a `~`-prefixed type.

---

## Type Set

> The **type set** of an interface T is the set of types whose method set is a superset of T's method set and that satisfy all of T's type elements.

Computing the type set:
1. Start with the universe of all types.
2. Intersect with every method element: keep only types whose method set covers the requirement.
3. Intersect with every type element: keep only types in that union.

The result is the type set of `T`.

Examples:
- `interface{}` → universe.
- `interface{ M() }` → all types with method `M()`.
- `interface{ int | string }` → the set `{int, string}`.
- `interface{ ~int }` → `{int} ∪ {every type whose underlying type is int}`.
- `interface{ ~int; M() }` → underlying-int types that also have method `M()`.

---

## Type Element

A type element narrows the type set to types named in the union.

```ebnf
TypeElem = TypeTerm { "|" TypeTerm }
TypeTerm = Type | "~" Type
```

Constraints:
- A type term cannot be an interface type.
- A type term cannot be a type parameter.
- The type after `~` must be a non-interface type whose underlying type is itself.

The last point excludes nonsense like `~Stringer` or `~MyDefinedType`.

---

## Method Element

A method element looks like a method declaration without `func`:

```ebnf
MethodElem = MethodName Signature
```

Example:
```go
type Reader interface {
    Read([]byte) (int, error)
}
```

Method elements work the same way they always have. Their addition to a constraint narrows the type set to types whose method set covers the requirement.

---

## The Union (`|`) Operator

The `|` operator joins type terms in a single type element.

> The type set of a union of terms `t1|t2|…|tn` is the union of the type sets of the terms.

So `int | string` has type set `{int, string}`.

Restrictions:
- Operands must be `TypeTerm`s, not interfaces.
- The empty union is not allowed; you must have at least one operand. Use `interface{}` or `any` for the universal type set.

---

## The Approximation (`~`) Operator

> The form `~T` is an approximation type term. The type set of `~T` is the set of all types whose underlying type is `T`.

Spec rules:
- `T` must be the **underlying type** of a non-interface type. In practice this means a predeclared type (`int`, `string`, `[]byte`, etc.) or an unnamed type literal.
- `~T` is itself a type term and may appear in a union.

Some non-obvious points:
- `~Foo` where `Foo` is a defined type whose underlying type is itself `int` — the spec disallows this, even though the underlying types match. You must write `~int`.
- `~interface{...}` is illegal.
- `~T` with `T` being a generic type parameter: also illegal.

---

## Basic vs General Interface

> An interface is **basic** if it contains only method elements (no type elements with type sets restricted to non-interface types). Otherwise, it is **general**.

- **Basic interfaces** can be used both as value types and as type constraints.
- **General interfaces** can be used only as type constraints. Attempting to use one as a value type is a compile-time error.

```go
type Stringer interface { String() string }    // basic
type Numeric  interface { ~int | ~float64 }    // general
type Both     interface { Numeric; String() string }  // general (because of Numeric)

var s Stringer    // ok
var n Numeric     // ❌ error: cannot use general interface as value
var b Both        // ❌ error
```

The reason: a general interface with a type-element constraint cannot be implemented at runtime by an arbitrary value. Type elements restrict the **identity** of the value, which is a compile-time property.

---

## Satisfaction

> A type argument `T` **satisfies** a constraint `C` if `T` is in the type set of `C`.

Equivalent formulation:
- For a basic interface, `T` satisfies `C` iff the method set of `T` (or `*T`, whichever is appropriate) is a superset of `C`'s method set.
- For a general interface, additionally `T` must lie in the type set defined by the type elements.

The spec also notes: satisfaction is checked at instantiation time. Errors caught at instantiation are reported pointing to the call site.

---

## Implementation

Don't confuse "satisfies" (relevant for type parameters) with "implements" (relevant for value-typed interfaces). These overlap for basic interfaces but diverge for general ones.

Pre-1.18 the spec had a single concept "implements". Post-1.18 the spec splits:

> A non-interface type `T` **implements** a basic interface `I` if its method set is a superset of `I`'s method set.

> A type argument `T` **satisfies** a constraint `C` if … (as above).

In casual writing the words are used interchangeably; in the spec they are distinct.

---

## `comparable` Built-in

> The predeclared type `comparable` denotes the set of all non-interface types that are strictly comparable.

Strictly comparable means: `==` and `!=` cannot panic at runtime when applied. Pre-Go 1.20 this excluded interface types; Go 1.20+ relaxed this so that **type arguments of interface type also satisfy `comparable`**, but the runtime panic risk transfers to the caller.

> [Go 1.20] Comparable types — including interface types — now satisfy the `comparable` constraint.

Implications:
- `Set[any]` is legal in Go 1.20+.
- It compiles. It can panic at runtime. The user is responsible.

The spec is precise: `comparable` is **strictly** comparable in the static type sense, but Go 1.20 broadened that to admit any interface type for convenience.

---

## Core Type Rule

> A type parameter has a **core type** if there is a single underlying type `U` such that the type set consists of all types whose underlying type is `U`, plus possibly some channel types with the same element direction.

If a core type exists, operators and operations of `U` are available on values of the type parameter.

Examples:
- Constraint `~int` → core type is `int`.
- Constraint `~int | int` → core type is `int` (the union deduplicates).
- Constraint `int | float64` → no core type; the underlying types differ.
- Constraint `~int | ~int32` → no core type; even though both are integer-shaped, their underlying types differ.

When there is no core type, only operations supported by **every** type in the type set are allowed. This is why `int | string` allows `+` (concatenation for strings, addition for ints) but not, say, multiplication.

---

## Operator Restrictions

The spec enumerates which operators work on which types. For a type parameter `T`:

| Operator | Required type-set property |
|----------|----------------------------|
| `+` | Every type in the set supports `+` |
| `-` `*` `/` `%` | Every type is numeric |
| `<` `<=` `>` `>=` | Every type is ordered (no complex numbers) |
| `==` `!=` | Every type is comparable |
| `&` `\|` `^` `<<` `>>` | Every type is integer |
| `&&` `\|\|` `!` | Every type is bool |
| Index, slicing | Every type is array, slice, or string (with consistent element type) |

If even one type in the set does not support the operator, the operator is illegal in the generic body.

---

## Grammar (EBNF)

Combining the relevant rules:

```ebnf
TypeParameters  = "[" TypeParamList [ "," ] "]"
TypeParamList   = TypeParamDecl { "," TypeParamDecl }
TypeParamDecl   = IdentifierList TypeConstraint
TypeConstraint  = TypeElem

InterfaceType   = "interface" "{" { InterfaceElem ";" } "}"
InterfaceElem   = MethodElem | TypeElem
MethodElem      = MethodName Signature
TypeElem        = TypeTerm { "|" TypeTerm }
TypeTerm        = Type | UnderlyingType
UnderlyingType  = "~" Type
```

This is sufficient grammar for every constraint you'll ever write.

---

## Examples From the Spec

### Spec Example 1 — `comparable`
```go
// Tree is a binary tree.
type Tree[T any] struct {
    left, right *Tree[T]
    payload     T
}

// Insert inserts the value v into the tree if not present.
func (t *Tree[T]) Insert(v T, less func(x, y T) bool) bool { ... }
```

### Spec Example 2 — Constraint inferred
```go
type SignedInteger interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64
}

func Sum[T SignedInteger](s []T) T {
    var sum T
    for _, v := range s {
        sum += v
    }
    return sum
}
```

### Spec Example 3 — Method element + type element
```go
type Hashable interface {
    comparable
    Hash() uint64
}
```

The intersection: types that are comparable **and** have a `Hash() uint64` method.

### Spec Example 4 — General interface cannot be value
```go
type SignedInteger interface { ~int | ~int8 | ~int16 | ~int32 | ~int64 }

var x SignedInteger    // error: cannot use type SignedInteger outside a type constraint
```

### Spec Example 5 — Satisfaction across the type set
```go
type Number interface { ~int | ~float64 }

func Mul[T Number](a, b T) T { return a * b }

Mul[int](3, 4)            // ok
Mul[float64](1.5, 2.0)    // ok
Mul[string]("a", "b")     // error: string does not satisfy Number
```

---

## Differences Across Go Versions

### Go 1.18
- Generics introduced.
- Interfaces extended with type elements and `~`.
- `any` predeclared as alias for `interface{}`.
- `comparable` predeclared, narrow definition.
- `golang.org/x/exp/constraints` published.

### Go 1.19
- No spec-level changes to constraints.
- Documentation improvements.

### Go 1.20
- `comparable` relaxed to admit interface types.
- Improved type inference for partially specified type arguments.

### Go 1.21
- Built-ins `min`, `max`, `clear` added (interact with constraints).
- Type inference for function arguments improved.

### Go 1.22 and later
- Continued type inference improvements.
- `golang.org/x/exp/constraints` remains the home for `Ordered`, `Integer`, etc.; no move into stdlib as of writing.

---

## Summary

The Go specification defines type constraints as interfaces. An interface contains method elements and/or type elements; type elements are unions of type terms; a type term is a plain type or a `~`-prefixed type. The type set of an interface determines satisfaction. Basic interfaces work as values; general interfaces (with type elements) are constraint-only. `comparable` is built in and was relaxed in Go 1.20. The core-type rule governs which operators are available inside generic functions. Memorise the grammar and you can read every constraint you'll ever encounter.
