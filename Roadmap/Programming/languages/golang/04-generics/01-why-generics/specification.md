# Why Generics? — Specification

## Table of Contents
1. [Source of truth](#source-of-truth)
2. [The Type Parameters Proposal](#the-type-parameters-proposal)
3. [Type parameters — formal definition](#type-parameters-formal-definition)
4. [The type parameter list grammar](#the-type-parameter-list-grammar)
5. [Type constraints — formal definition](#type-constraints-formal-definition)
6. [Parameterised function declarations](#parameterised-function-declarations)
7. [Parameterised type declarations](#parameterised-type-declarations)
8. [Instantiation](#instantiation)
9. [Type inference (in brief)](#type-inference-in-brief)
10. [Predeclared constraints](#predeclared-constraints)
11. [The `~` operator (underlying-type element)](#the-operator-underlying-type-element)
12. [Type sets](#type-sets)
13. [Method sets and constraints](#method-sets-and-constraints)
14. [What the spec forbids](#what-the-spec-forbids)
15. [Summary](#summary)

---

## Source of truth

The authoritative source is the **Go Programming Language Specification**:
- <https://go.dev/ref/spec> — the live spec
- <https://go.dev/ref/spec#Type_parameters> — type parameters section
- <https://go.dev/ref/spec#Type_constraints> — constraints section
- The proposal: <https://go.googlesource.com/proposal/+/HEAD/design/43651-type-parameters.md>

This document quotes and explains the relevant excerpts. Quotations are paraphrased for clarity; consult the official spec for the canonical wording.

---

## The Type Parameters Proposal

The accepted proposal is **"Type Parameters Proposal"** (a.k.a. proposal 43651), authored by Ian Lance Taylor and Robert Griesemer, accepted in February 2021. Its design goals were:

1. **Backward compatibility** — existing Go code must still compile.
2. **No runtime cost** when generics are not used.
3. **Type safety** — bugs caught at compile time, not runtime.
4. **Implementable** — the team had to be able to ship it.

A key deliberate choice: **constraints are interfaces**. The spec did not invent a new "contracts" concept (an earlier rejected proposal); it reused interfaces with one extension — they may now contain **type elements**.

---

## Type parameters — formal definition

From the spec:

> A type parameter is an unqualified identifier introduced by a type parameter list. It acts as a placeholder for an (as of yet) unknown type in the declaration; the type parameter is replaced with a type argument upon instantiation of the parameterized declaration.

In other words:

- A **type parameter** is a name (like `T`).
- It lives only inside the declaration that introduces it.
- At a call site, it is replaced by a real type — the **type argument**.

```go
func F[T any](x T) T { return x }
//   ↑     ↑
//   |     type parameter list
//   declaration name
```

`T` is a type parameter. After `F[int](3)` is compiled, `T` becomes `int`.

---

## The type parameter list grammar

The EBNF (Extended Backus-Naur Form) grammar for type parameter lists:

```ebnf
TypeParameters  = "[" TypeParamList [ "," ] "]" .
TypeParamList   = TypeParamDecl { "," TypeParamDecl } .
TypeParamDecl   = IdentifierList TypeConstraint .
TypeConstraint  = TypeElem .
TypeElem        = TypeTerm { "|" TypeTerm } .
TypeTerm        = Type | UnderlyingType .
UnderlyingType  = "~" Type .
```

In plain English:

- A type parameter list is square brackets around one or more **declarations**.
- Each declaration is a **list of identifiers** followed by a **constraint**.
- A constraint is one or more **type terms** separated by `|`.
- A type term is either a type or `~` followed by a type.

Examples:

```go
[T any]                     // single param
[T, U any]                  // two params, same constraint
[T any, U comparable]       // two params, different constraints
[T int | string]            // constraint is a union of types
[T ~int | ~float64]         // underlying-type elements
[K comparable, V any]       // typical map-like declaration
```

The trailing comma is optional but allowed:

```go
[
    T any,
    U any,   // trailing comma OK
]
```

---

## Type constraints — formal definition

From the spec:

> A type constraint is an interface that defines the set of permissible type arguments for the respective type parameter and controls the operations supported by values of that type parameter.

Key insight: a constraint is **always an interface**. The "extension" Go made for generics is that interfaces can now contain **type elements** in addition to method elements.

### Basic forms

```go
// Method-only constraint (classic interface)
type Stringer interface { String() string }

// Type-only constraint (new in 1.18)
type Number interface { ~int | ~float64 }

// Mixed
type OrderedStringer interface {
    ~int | ~float64 | ~string
    String() string
}
```

### `any` and `comparable`

The spec defines two **predeclared** constraints:

| Constraint | Meaning |
|------------|---------|
| `any` | Alias for `interface{}` — every type satisfies |
| `comparable` | Every type that supports `==` and `!=` |

Quoting the spec:

> The predeclared interface type `comparable` denotes the set of all non-interface types that are strictly comparable.

Note "strictly comparable" — interface types that contain non-comparable dynamic types would panic at runtime, so they are excluded.

---

## Parameterised function declarations

The grammar for a function declaration with type parameters:

```ebnf
FunctionDecl = "func" FunctionName [ TypeParameters ] Signature [ FunctionBody ] .
```

So a generic function is:

```go
func Name[TypeParameters](Signature) [ Result ] [ FunctionBody ]
```

Concrete:

```go
func Map[T, U any](s []T, f func(T) U) []U {
    out := make([]U, len(s))
    for i, v := range s { out[i] = f(v) }
    return out
}
```

Inside the body, `T` and `U` are types — they can appear in:
- parameter types
- return types
- variable declarations
- composite literal types
- conversion expressions

But they **cannot** be used in some contexts (see "What the spec forbids").

---

## Parameterised type declarations

```ebnf
TypeDecl  = "type" TypeSpec .
TypeSpec  = AliasDecl | TypeDef .
TypeDef   = identifier [ TypeParameters ] Type .
```

Examples:

```go
type Stack[T any] struct {
    data []T
}

type Set[K comparable] map[K]struct{}

type Pair[A, B any] struct {
    First  A
    Second B
}
```

### Methods on parameterised types

The receiver of a method must list **the same** type parameters as the type:

```go
func (s *Stack[T]) Push(v T) { s.data = append(s.data, v) }
```

Note `Stack[T]`, not `Stack`. The parameter list is required even if it is "obvious".

### Type alias with parameters (Go 1.24+)

Until Go 1.24, type aliases (`type A = B`) could not have type parameters. From 1.24 onward:

```go
type Vector[T any] = []T   // 1.24+
```

Earlier versions reject this.

---

## Instantiation

> The act of providing concrete type arguments for a type parameter list, replacing each type parameter with the corresponding type argument throughout the declaration.

Two forms:

### Explicit

```go
out := Map[int, string](nums, strconv.Itoa)
//        ^^^^^^^^^^^ explicit type arguments
```

### Implicit (inferred)

```go
out := Map(nums, strconv.Itoa)
// compiler infers T = int, U = string
```

The spec defines **type inference** as the rules by which the compiler picks the type arguments from the call site.

### Partial instantiation

You may supply only the leading type arguments:

```go
out := Map[int](nums, strconv.Itoa)
// T is given as int; U is inferred as string
```

You cannot skip a leading argument:

```go
// Map[, string](...) — not allowed
```

---

## Type inference (in brief)

Type inference happens in two passes:

1. **Function argument type inference** — match each argument expression's type against the corresponding parameter's type.
2. **Constraint type inference** — propagate constraints forward.

The full algorithm is described in <https://go.dev/ref/spec#Type_inference>. Key practical rules:

- Inference works when **at least one** argument has a known concrete type that pins a type parameter.
- Inference does **not** look at the return type — it works only from arguments.
- If inference fails, the compiler asks for explicit type arguments.

Inference improvements have shipped in nearly every Go release since 1.18; 1.21 made significant refinements.

---

## Predeclared constraints

The spec mandates two predeclared types that are constraint-shaped:

```go
type any = interface{}

type comparable interface { /* opaque */ }
```

`any` is a real alias. `comparable` is a special interface — you cannot define your own version of it, you cannot embed it in a normal interface for runtime use, only as a constraint.

### `comparable` subtleties

```go
// OK: comparable as a constraint
func Eq[T comparable](a, b T) bool { return a == b }

// NOT OK: comparable as a regular interface in 1.18-1.19
var x comparable = 1 // compile error

// In 1.20+: comparable can be used more freely
```

Go 1.20 relaxed `comparable` so that interface types satisfy it (with a runtime panic possibility if compared values aren't really comparable).

---

## The `~` operator (underlying-type element)

The `~` (tilde) operator means "any type whose **underlying type** is X":

```go
type Celsius float64

func F[T float64](v T) {} // accepts only float64
func G[T ~float64](v T) {} // accepts float64 AND Celsius

var c Celsius = 36.6
F(c) // compile error
G(c) // OK
```

Without `~`, named types created via `type Foo Bar` are **excluded** even though their underlying type matches. The tilde is essential for writing generic numeric code that works with domain types.

The spec:

> A term `~T` denotes the set of all types whose underlying type is T. The operand T of a term `~T` must be a type, and that type must not be an interface.

---

## Type sets

A constraint defines a **type set** — the set of all types that satisfy it. The spec discusses type sets explicitly:

> The type set of an interface type is the intersection of the type sets of its terms.

Examples:

```go
// Type set: { int, int32, int64 }
type IntFamily interface { int | int32 | int64 }

// Type set: { Celsius, Fahrenheit, Kelvin, ... } if their underlying type is float64
type AnyTemperature interface { ~float64 }

// Empty type set — no type can satisfy
type Impossible interface { int; string } // intersection is empty
```

An empty type set is **not** a compile error — the spec allows it — but no value can ever satisfy it, so the function is unusable. Some linters flag this.

### Intersection vs union

- `|` inside a type element is **union**.
- Multiple lines (or multiple embedded interfaces) are **intersection**.

```go
type A interface { int | string }       // int OR string
type B interface { int | float64 }      // int OR float64
type C interface { A; B }               // intersection: just int
```

---

## Method sets and constraints

A constraint can require both type elements and methods:

```go
type Sortable interface {
    ~int | ~float64 | ~string
    Less(other Sortable) bool
}
```

For a type to satisfy `Sortable`, it must:
1. Have `~int`, `~float64`, or `~string` as its underlying type
2. Have a `Less` method with the right signature

The spec calls this the **structural constraint** plus **method set requirement**.

---

## What the spec forbids

The spec explicitly forbids several constructs:

### 1. Method type parameters

```go
type Box[T any] struct{ v T }

// Forbidden — methods cannot declare their own type parameters
func (b Box[T]) Map[U any](f func(T) U) Box[U] { ... } // ❌
```

This was a deliberate decision to limit complexity. Workaround: make `Map` a free function `func Map[T, U any](b Box[T], f func(T) U) Box[U]`.

### 2. Predeclared functions on type parameters

You cannot call `len`, `cap`, `new`, `make`, etc., on a type parameter unless the constraint guarantees the operation:

```go
func F[T any](s T) { len(s) } // ❌ — T might not have a length
```

You'd need a constraint like `~[]X | ~string` for `len` to work.

### 3. Type assertions on a type parameter that is not an interface

```go
func F[T any](v T) {
    _ = v.(int) // ❌
}
```

Use `any(v).(int)` instead, which adds a deliberate boxing step.

### 4. Instantiation cycles

```go
type T[U any] struct { x T[T[U]] } // ❌ — infinite expansion
```

The spec rejects this at compile time.

### 5. Constraint loops

```go
type C interface { ~int; C } // ❌
```

Self-referential constraints are not allowed.

### 6. Generic type aliases (pre-1.24)

```go
type Vec[T any] = []T // ❌ before 1.24, ✓ in 1.24+
```

---

## Summary

The Go specification handles generics with surprising **economy**: the entire type-parameter feature is a small grammatical extension to **interface declarations**, type-decl, and func-decl. There is no separate "generic" syntactic category; constraints are interfaces with extra elements.

Key takeaways:

1. **Type parameters are placeholders**, replaced at instantiation.
2. **Constraints are interfaces**, optionally containing type elements.
3. **`~T` widens** a type term to include any type with that underlying type.
4. **Type sets** are intersections of unions; empty sets are allowed but useless.
5. **Inference** looks only at arguments, not return types.
6. **`comparable` and `any`** are special predeclared constraints.
7. **Method type parameters are forbidden**; only the receiver type's parameters are visible.
8. **Some forbidden constructs** keep the language tractable.

For day-to-day work you rarely consult the spec — but when you do, you now know which sections to read. Next: `interview.md` to drill the design rationale.
