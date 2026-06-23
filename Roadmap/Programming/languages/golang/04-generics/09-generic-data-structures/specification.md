# Generic Data Structures — Specification

## Table of Contents
1. [Source of truth](#source-of-truth)
2. [Generic type declarations](#generic-type-declarations)
3. [The receiver of a method on a generic type](#the-receiver-of-a-method-on-a-generic-type)
4. [Method sets of generic types](#method-sets-of-generic-types)
5. [Embedded generic types](#embedded-generic-types)
6. [Method declarations on generic types](#method-declarations-on-generic-types)
7. [Recursive generic types](#recursive-generic-types)
8. [Type identity for instantiated types](#type-identity-for-instantiated-types)
9. [What the spec forbids on generic types](#what-the-spec-forbids-on-generic-types)
10. [Summary](#summary)

---

## Source of truth

The authoritative source is the **Go Programming Language Specification**:
- <https://go.dev/ref/spec> — the live spec
- <https://go.dev/ref/spec#Type_declarations> — type declarations
- <https://go.dev/ref/spec#Method_declarations> — method declarations
- <https://go.dev/ref/spec#Type_identity> — type identity
- The proposal: <https://go.googlesource.com/proposal/+/HEAD/design/43651-type-parameters.md>

This document quotes and paraphrases the relevant excerpts; consult the official spec for the canonical wording.

---

## Generic type declarations

From the spec:

> A type definition creates a new, distinct type with the same underlying type and operations as the given type and binds an identifier, the type name, to it. The new type is called a defined type. It is different from any other type, including the type it is created from. A defined type may have type parameters, in which case the type name denotes a generic type.

The grammar:

```ebnf
TypeDecl    = "type" TypeSpec .
TypeSpec    = AliasDecl | TypeDef .
TypeDef     = identifier [ TypeParameters ] Type .
TypeParameters = "[" TypeParamList [ "," ] "]" .
```

A generic type is declared by adding a type parameter list after the name:

```go
type Stack[T any] struct {
    data []T
}

type Set[T comparable] map[T]struct{}

type Pair[A, B any] struct {
    First  A
    Second B
}

type Tree[T any] struct {
    Value    T
    Children []*Tree[T]
}
```

Each is a generic **defined type**. Until a type argument is supplied, you cannot use it as a value type:

```go
var s Stack       // ❌ — Stack is not a complete type
var s Stack[int]  // ✓ — Stack[int] is a complete type
```

### Underlying type

The underlying type of a generic type is computed **after** type arguments are substituted. For:

```go
type Stack[T any] struct{ data []T }
```

…the underlying type of `Stack[int]` is `struct{ data []int }`.

This matters for **conversion rules**: `Stack[int]` and another type with the same underlying-type-after-substitution can be inter-converted.

---

## The receiver of a method on a generic type

From the spec:

> The receiver type must be a defined type, optionally a pointer to a defined type, or a parameterized version of one of those forms. The type parameters are listed (without constraints) in brackets after the receiver type's name.

So for a generic type `Container[T any]`, the legal receiver forms are:

```go
func (c Container[T]) M(...)   // value receiver
func (c *Container[T]) M(...)  // pointer receiver
```

The **`[T]`** is mandatory. The receiver type's parameter list **does not declare new constraints** — it is a pure repetition.

```go
type Stack[T any] struct{ data []T }

// Correct — repeats [T]
func (s *Stack[T]) Push(v T) { s.data = append(s.data, v) }

// Wrong — missing [T]
func (s *Stack) Push(v T) { ... }   // ❌ compile error

// Wrong — adding a constraint
func (s *Stack[T comparable]) Push(v T) { ... } // ❌ — constraint already on the type
```

### Why the parameter list must be repeated

The spec is explicit: methods use the type parameters of the receiver type, but they must be **named** so the body can reference them. Repeating `[T]` keeps the syntax regular.

---

## Method sets of generic types

The method set of a generic type changes as the type parameter changes — a method that requires `T` to be `comparable` is only available when `T` actually is `comparable`. But Go's spec handles this differently than you might expect.

> The method set of a type determines the interfaces that the type implements and the methods that can be called using a receiver of that type.

For a generic type, the method set is determined **after instantiation**. A method declared on `Stack[T any]` is part of the method set of every instantiation, regardless of what `T` becomes.

### What you cannot do

You cannot declare a method that exists only for some `T`:

```go
type Stack[T any] struct{ data []T }

// Hypothetical: only available when T is comparable
func (s *Stack[T comparable]) Contains(v T) bool { ... } // ❌ not allowed
```

The constraint must live on the **type declaration**, not the method. If `Contains` needs `comparable`, the entire type must be `Stack[T comparable]` — which restricts every other use of the type.

The workaround is the **free-function pattern**:

```go
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Push(v T) { ... }

// Free function adds the comparable constraint without restricting the type
func StackContains[T comparable](s *Stack[T], target T) bool {
    for _, v := range s.data {
        if v == target { return true }
    }
    return false
}
```

---

## Embedded generic types

Generic types may be embedded in other types. The spec allows this with one nuance: the embedded generic type must be **fully instantiated** at the point of embedding, or the outer type must propagate its type parameters.

### Fully instantiated

```go
type StringStack struct {
    Stack[string] // embedded with explicit type argument
}

// StringStack inherits Push, Pop, etc., specialised to string
```

### Type-parameter propagated

```go
type LoggedStack[T any] struct {
    Stack[T]    // embedded using outer T
    log func(string)
}

ls := &LoggedStack[int]{Stack: Stack[int]{}, log: func(s string){...}}
ls.Push(1) // promoted from Stack[T]
```

### Method promotion

Methods of the embedded generic type are **promoted** to the outer type. So `LoggedStack[T]` automatically has `Push`, `Pop`, etc., from `Stack[T]`. The promoted method's receiver type, in this case, is `*Stack[T]`, so it operates on the embedded field directly.

---

## Method declarations on generic types

From the spec:

> A method declaration binds an identifier, the method name, to a method, and associates the method with the receiver's base type.

For a generic method declaration:

```go
func (c *Container[T]) M(args) (results) { body }
```

The spec requires:

1. The receiver's **base type** must be a defined type (`Container`).
2. The receiver may optionally be a pointer (`*Container[T]`).
3. The receiver type's **type parameter list** must match the type's, name-for-name **arity-wise** but the names can differ.

This last point is subtle. The names in the receiver's bracket list do **not** have to match the names in the type declaration — only the count and constraints. So:

```go
type Stack[T any] struct{ data []T }

func (s *Stack[U]) Push(v U) { ... } // legal — U is just T renamed
```

Most code keeps the names identical (always `T`) for readability.

### Method bodies

Inside the method body, the type parameter is in scope and may be used like any other type:

```go
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.data) == 0 {
        return zero, false
    }
    n := len(s.data) - 1
    v := s.data[n]
    s.data = s.data[:n]
    return v, true
}
```

`var zero T`, `s.data[n]` (which is `T`), and the return type `(T, bool)` all use the type parameter directly.

---

## Recursive generic types

A generic type may reference itself. The spec permits this with one limit: the recursion must not cause infinite expansion.

```go
type Tree[T any] struct {
    Value    T
    Children []*Tree[T]      // ✓ — pointer to same instantiation
}

type Pair[T any] struct {
    Left  *Pair[T]            // ✓
    Right *Pair[T]
    Val   T
}
```

### What the spec forbids

```go
type Bad[T any] struct {
    next Bad[Bad[T]]          // ❌ infinite expansion
}
```

The compiler rejects this at type-check time. The rule from the spec:

> A type definition involving a parameterized type instantiation must not produce an infinite type.

Most natural recursive containers (lists, trees, graphs) use **pointers** and are fine.

---

## Type identity for instantiated types

From the spec:

> Two named types are identical if their type names originate in the same TypeSpec and they have identical type arguments.

In other words:

- `Stack[int]` and `Stack[int]` are the **same** type.
- `Stack[int]` and `Stack[int64]` are **distinct** types.
- `Stack[int]` and a separately defined `IntStack []int` are **distinct** types even if their underlying structure matches.

This means you cannot do:

```go
var a Stack[int]
var b Stack[int64] = a // ❌ different types
```

Even though `int` and `int64` have the same memory layout, the two `Stack` instantiations are distinct.

### Conversion

Explicit conversions follow the same rules as for any defined type:

```go
type IntStack Stack[int]
var s Stack[int] = ...
var i IntStack = IntStack(s) // ✓ if underlying types match
```

In practice, use type aliases or wrapper types only when you need to attach extra methods.

---

## What the spec forbids on generic types

A few constructs are explicitly disallowed for generic types and methods.

### 1. Method-level type parameters

```go
type Box[T any] struct{ v T }

// Forbidden
func (b Box[T]) Map[U any](f func(T) U) Box[U] { ... } // ❌
```

The receiver may name type parameters (from the type), but the method itself may not introduce new ones.

### 2. Generic type aliases (pre-1.24)

```go
type Vector[T any] = []T // ❌ before Go 1.24, ✓ in 1.24+
```

Until Go 1.24, type aliases could not have type parameters. From 1.24 the limitation is lifted.

### 3. Constraint cycles

```go
type SelfRef[T SelfRef[int]] struct{} // ❌ — recursive constraint
```

Type parameters cannot constrain themselves through their own name.

### 4. Type parameter as the constraint

```go
func F[T comparable, U T](v U) {} // ❌ — T cannot be a constraint
```

A constraint must be an interface — possibly `any`, `comparable`, a custom interface — but not another type parameter.

### 5. Predeclared functions on type parameters

```go
func F[T any](v T) {
    fmt.Println(len(v)) // ❌ — len not defined for arbitrary T
}
```

Without a constraint that guarantees the operation, predeclared functions like `len`, `cap`, `new`, `make` fail.

### 6. Constants of type parameter type

```go
func F[T int | float64]() {
    const x T = 1 // ❌ — type parameters are not constant types
}
```

Use `var x T = 1` if the constraint allows the conversion.

---

## Summary

The Go specification handles generic data structures with **economy**:

1. **A generic type** is a regular type definition with a type parameter list after the name.
2. **Methods** must repeat the type parameter list on the receiver (`*Container[T]`).
3. **The type parameter is in scope** throughout the body; `var zero T` is the canonical zero-value idiom.
4. **Constraints live on the type**, not on individual methods. Use free functions for operations that need a tighter constraint.
5. **Embedded generic types** propagate or fully instantiate; method promotion works as for non-generic types.
6. **Two instantiations are identical** only when their type arguments are identical.
7. **Forbidden constructs** — method-level type parameters, generic aliases (pre-1.24), constraint cycles — keep the language tractable.

These rules are enough to design any container in this section. The spec is a reference, not a tutorial — you reach for it when a specific corner case arises, not when writing day-to-day generic code.

Move on to `interview.md` to drill the design rationale.
