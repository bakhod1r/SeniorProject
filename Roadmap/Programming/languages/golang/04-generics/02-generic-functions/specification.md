# Generic Functions — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Function Declaration EBNF](#function-declaration-ebnf)
3. [Type Parameter Declarations](#type-parameter-declarations)
4. [Type Constraints](#type-constraints)
5. [Type Sets](#type-sets)
6. [Instantiation Rules](#instantiation-rules)
7. [Type Inference Rules](#type-inference-rules)
8. [Scope of Type Parameters](#scope-of-type-parameters)
9. [Operations Permitted on Type Parameters](#operations-permitted-on-type-parameters)
10. [Identity and Assignability](#identity-and-assignability)
11. [Method Restrictions](#method-restrictions)
12. [Examples Annotated with Spec References](#examples-annotated-with-spec-references)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

This file quotes the Go specification (sections relevant to generic functions) and explains each rule with examples. References are to the canonical [Go Programming Language Specification](https://go.dev/ref/spec) as of Go 1.21.

Where the spec is terse, we add a "What this means" paragraph and a code snippet.

---

## Function Declaration EBNF

The Go spec defines:

```
FunctionDecl = "func" FunctionName [ TypeParameters ] Signature [ FunctionBody ] .
FunctionName = identifier .
TypeParameters = "[" TypeParamList [ "," ] "]" .
TypeParamList  = TypeParamDecl { "," TypeParamDecl } .
TypeParamDecl  = IdentifierList TypeConstraint .
TypeConstraint = TypeElem .
Signature      = Parameters [ Result ] .
```

**What this means**

- A function declaration may include an optional **type parameter list** between the name and the signature.
- The type parameter list is `[ ... ]` (square brackets) — this is what distinguishes it visually from regular parameters `( ... )`.
- Each type parameter declaration consists of one or more identifiers and a single type constraint (which is a type element — see below).

Example:

```go
func Map[T any, U any](xs []T, f func(T) U) []U
//        ^^^^^^^^^^  type parameter list
//        ^^^         identifier
//        ^^^^^       constraint (TypeElem)
```

Multiple type parameters with the same constraint may share the constraint:

```go
func Pair[T, U any](x T, y U) [2]any { return [2]any{x, y} }
```

This is equivalent to `[T any, U any]`.

---

## Type Parameter Declarations

The relevant spec text:

> Within a type parameter list, all non-blank names must be unique. The blank name `_` may be used to indicate that a type parameter is unused.

**What this means**

- You cannot declare two type parameters with the same name in the same list.
- You may use `_` as a placeholder, although this is rare.

```go
// Legal
func Foo[T any, U any](x T, y U) {}

// ILLEGAL — duplicate name
// func Bad[T any, T any](x T, y T) {}

// Legal but unusual
func Strange[_ any, T any](x T) T { return x }
```

The spec also says:

> Within a type parameter list of a function declaration, every type parameter is declared in the function's body and signature.

**What this means**

- Type parameters are in scope throughout the function's signature **and** body.
- They are not in scope outside the function.

---

## Type Constraints

From the spec:

> A type constraint is an interface that defines the set of permissible type arguments for the respective type parameter and controls the operations supported by values of that type parameter.

The constraint is itself an interface. The Go spec defines an extended interface syntax:

```
InterfaceType = "interface" "{" { InterfaceElem ";" } "}" .
InterfaceElem = MethodElem | TypeElem .
MethodElem    = MethodName Signature .
TypeElem      = TypeTerm { "|" TypeTerm } .
TypeTerm      = Type | UnderlyingType .
UnderlyingType = "~" Type .
```

**What this means**

An interface used as a constraint may contain:
- **Method elements**, like `String() string` (classic interface method)
- **Type elements**, separated by `|`: a union of types
- **Approximation tokens** `~T`: any type whose underlying type is `T`

Examples:

```go
// Method-only — usable as both a regular interface and a constraint
type Stringer interface {
    String() string
}

// Type-union only
type Numeric interface {
    int | int64 | float64
}

// Mixed
type IntStringer interface {
    ~int | ~int64
    String() string
}

// Approximation
type IntLike interface {
    ~int
}
```

When an interface contains type-element-only restrictions (i.e., type unions or `~T`), it can only be used as a **type constraint** — not as a runtime interface value.

```go
type Numeric interface { int | float64 }

var _ Numeric = 42 // ERROR — Numeric is type-element only; not a regular interface type
```

---

## Type Sets

From the spec:

> The interface type defines a **type set**. The type set of an interface is the intersection of the type sets of its interface elements.

**What this means**

- Each method element contributes a type set (all types that satisfy the method).
- Each type element contributes a type set (the union types listed).
- The constraint's type set is the **intersection** of these.

Example:

```go
type A interface { ~int | ~int64 }
type B interface { ~int | ~string }

type C interface { A; B }
// type set of C = (int|int64) ∩ (int|string) = {int}
```

So `C` permits only types whose underlying type is `int`.

The empty type set is **legal** but **useless** — no type can satisfy it, so no function with that constraint can be instantiated.

```go
type Empty interface { int; string }
// type set is empty — Empty constrained generics cannot be called
```

---

## Instantiation Rules

The spec defines instantiation:

> A generic function is instantiated by substituting type arguments for the type parameters. Instantiation produces a non-generic function.

**Form:**
```
FunctionName "[" TypeArgList "]"
```

Where `TypeArgList` lists one or more types separated by commas.

**What this means**

```go
func Map[T, U any](xs []T, f func(T) U) []U { /* ... */ }

// Explicit instantiation:
Map[int, string]

// Used as a function value:
m := Map[int, string]

// Called:
out := Map[int, string]([]int{1,2,3}, strconv.Itoa)
```

After instantiation, the function is **no longer generic** — it has a specific type. You may pass `Map[int, string]` to anywhere a `func([]int, func(int) string) []string` is required.

### Partial instantiation

> A generic function may be partially instantiated by providing only the leading type arguments.

```go
m := Map[int]                  // U is still a type parameter — Map[int] is still generic
out := Map[int]([]int{1}, strconv.Itoa) // U inferred as string
```

This is most useful for hooking into existing typed contexts.

### Full instantiation required for storage

```go
var f func([]int, func(int) string) []string = Map[int, string] // OK — fully instantiated
// var g = Map  // ERROR — Map is uninstantiated, cannot be used as a value
```

---

## Type Inference Rules

The spec describes inference algorithmically. We summarize the practical rules:

### 1. Function argument inference

> Type inference uses the types of typed function arguments to infer the corresponding type parameters.

```go
Map([]int{1, 2}, strconv.Itoa) // T=int from []int; U=string from strconv.Itoa
```

### 2. Constraint inference

> If a type parameter is not inferred from arguments, it may be inferred from constraints that relate it to already-inferred parameters.

This is rare; an example would be a phantom-type constraint pinning down `U` based on `T`.

### 3. Untyped constants

> Untyped constants are subject to default-typing rules during inference.

```go
func F[T any](x T) T { return x }

F(42) // T = int (42 defaults to int)
F(42.0) // T = float64 (42.0 defaults to float64)
```

### 4. Inference fails

If after applying the rules any type parameter is unresolved, the call is illegal:

```go
func New[T any]() T { var z T; return z }
New() // ERROR: cannot infer T
```

### 5. Inference order in Go 1.21+

Go 1.21 made inference more capable: partial type arguments combined with argument inference now succeed in cases that previously failed.

---

## Scope of Type Parameters

From the spec:

> The scope of an identifier denoting a type parameter is the function or generic type body and signature.

**What this means**

```go
func Foo[T any](x T) {
    // T is in scope here
    var y T = x
    _ = y
    // T is also in scope in nested function literals
    g := func() T { return x }
    _ = g
}

// T is NOT in scope here
// var v T // ERROR
```

A nested function literal captures `T` (and the value it represents at this instantiation).

### Type parameters in struct literals inside the body

```go
func MakeBox[T any](v T) Box[T] {
    return Box[T]{V: v} // T is the same T as in the signature
}
```

---

## Operations Permitted on Type Parameters

From the spec:

> A value `x` of type parameter `P` may be used in any of the following ways: ...

The permitted operations include:
- Assignment to `P` from another `P` value
- Comparison with `nil` if `P`'s type set permits it (interface, pointer, channel, map, slice, function)
- Use in expressions whose operators are valid for **all** types in `P`'s type set
- Calling a method declared in `P`'s constraint

Examples:

```go
func F[T any](x T) {
    var y T = x       // OK — assignment
    _ = y
    // _ = x + y       // ERROR — `+` is not defined for all T
}

func Sum[T int | float64](a, b T) T {
    return a + b      // OK — `+` is defined for all types in {int, float64}
}

func Print[T fmt.Stringer](x T) {
    println(x.String()) // OK — method present on all types in T's set
}
```

### Conversion

> A value of type parameter `P` may be converted to a type `T` if all types in `P`'s type set are convertible to `T`.

```go
func ToFloat[T int | int64](x T) float64 {
    return float64(x) // OK
}
```

---

## Identity and Assignability

From the spec:

> Two function types are identical if they have the same number of parameters and result types ... and the same type parameter lists (with renaming permitted).

**What this means**

```go
type F1[T any] func(T) T
type F2[T any] func(T) T

// F1 and F2 are identical types modulo their declared name.
```

After instantiation, regular Go assignability rules apply:

```go
var f1 F1[int] = func(x int) int { return x + 1 }
var f2 func(int) int = f1 // OK — assignment of a typed function value
```

---

## Method Restrictions

From the spec:

> A method declaration may not introduce its own type parameters; method type parameters are bound to the receiver's type parameters.

**What this means**

```go
type Box[T any] struct{ V T }

// Legal — T comes from Box's type parameter list
func (b Box[T]) Get() T { return b.V }

// ILLEGAL — methods cannot declare their own type parameters
// func (b Box[T]) MapTo[U any](f func(T) U) Box[U] { ... }
```

To work around this, define a free function:

```go
func MapBox[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{V: f(b.V)}
}
```

This restriction is intentional — it keeps the method dispatch model simple and avoids combinatorial explosion in vtables.

### Why this restriction?

If methods could introduce type parameters, two questions arise:
1. How are they instantiated when the method is selected on an interface value?
2. How does the runtime store the dictionary for the method's type parameters?

Both have non-obvious answers and the language designers chose to forbid the construct rather than answer them poorly.

---

## Examples Annotated with Spec References

### Example 1 — `Sum`

```go
func Sum[T int | float64](xs []T) T { // FunctionDecl with TypeParameters
    var s T                           // T in scope (Scope of Type Parameters)
    for _, x := range xs {
        s += x                        // `+` permitted because all members of T's type set support it
    }
    return s
}
```

### Example 2 — `Map`

```go
func Map[T, U any](xs []T, f func(T) U) []U {
    out := make([]U, len(xs))
    for i, x := range xs {
        out[i] = f(x)
    }
    return out
}

Map([]int{1,2}, strconv.Itoa) // Argument inference → T=int, U=string
Map[int, string]([]int{1}, strconv.Itoa) // Explicit Instantiation
```

### Example 3 — Method restriction

```go
type Stack[T any] struct{ items []T }

func (s *Stack[T]) Push(x T) {            // Method binds T from receiver
    s.items = append(s.items, x)
}

// func (s *Stack[T]) MapTo[U any](f func(T) U) *Stack[U] { ... } // FORBIDDEN
```

### Example 4 — Approximation token

```go
type Cents int
type Number interface { ~int | ~float64 }

func Double[T Number](x T) T { return x * 2 }

var c Cents = 50
Double(c) // OK — Cents has underlying int, matches ~int in the type set
```

### Example 5 — Comparable constraint

```go
func Contains[T comparable](xs []T, target T) bool {
    for _, x := range xs {
        if x == target { // `==` permitted because comparable's type set supports it
            return true
        }
    }
    return false
}
```

---

## Cheat Sheet

```
FunctionDecl    = "func" Name [TypeParams] Signature [Body]
TypeParams      = "[" TypeParamDecl { "," TypeParamDecl } [","] "]"
TypeParamDecl   = IdentList TypeConstraint
TypeConstraint  = TypeElem
TypeElem        = TypeTerm { "|" TypeTerm }
TypeTerm        = Type | "~" Type

Instantiation:  Name [TypeArg, ...]
Inference:      from typed args, then constraints
Scope:          signature + body
Methods:        cannot add their own type parameters
Operations:     intersection over type set
Empty type set: legal but uncallable
```

---

## Summary

The Go specification defines generic functions in a few small but precise rules: a type parameter list goes between the function name and signature; each parameter has a constraint that is an interface defining a type set; instantiation may be explicit or inferred; methods may not add their own type parameters. Once you internalize these rules — and the corresponding restrictions — most surprises vanish.

[← professional.md](./professional.md) · [interview.md →](./interview.md)
