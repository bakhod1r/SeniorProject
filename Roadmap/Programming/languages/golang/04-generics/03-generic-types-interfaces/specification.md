# Generic Types & Interfaces — Specification

## Table of Contents
1. [Scope](#scope)
2. [Type parameters in the Go specification](#type-parameters-in-the-go-specification)
3. [Grammar — type declarations with parameters](#grammar-type-declarations-with-parameters)
4. [Grammar — type parameter list](#grammar-type-parameter-list)
5. [Grammar — type constraints and type sets](#grammar-type-constraints-and-type-sets)
6. [Instantiation](#instantiation)
7. [Method declarations on generic types](#method-declarations-on-generic-types)
8. [Type identity rules](#type-identity-rules)
9. [Assignability rules](#assignability-rules)
10. [Method sets and interface satisfaction](#method-sets-and-interface-satisfaction)
11. [Embedding rules for interfaces](#embedding-rules-for-interfaces)
12. [Predeclared `any` and `comparable`](#predeclared-any-and-comparable)
13. [Type inference summary (forward link)](#type-inference-summary-forward-link)
14. [Reflection of instantiated types](#reflection-of-instantiated-types)
15. [Summary](#summary)

---

## Scope

This document quotes and explains the parts of the Go specification (`https://go.dev/ref/spec`) that govern *generic types* (parameterized type declarations) and *generic interfaces* (interfaces used as constraints or as parameterized value types). It is precise — but explanatory rather than verbatim.

Where exact wording matters, we cite the section name; you should read the full spec for full rigor.

---

## Type parameters in the Go specification

The spec, in *Type declarations* and *Type parameters*, says:

> "A type declaration binds an identifier, the type name, to a type."
> "A type definition that contains type parameters is a generic type. Generic types must be instantiated when they are used."

Two declaration forms exist:

- **Alias**: `type IntStack = Stack[int]` — adds a new name for an existing type, no new type.
- **Definition**: `type IntStack Stack[int]` — creates a brand-new defined type whose underlying type is `Stack[int]`.

A *generic type* is a type definition whose name is followed by a non-empty type parameter list:

```
type Stack[T any] struct { items []T }
```

`Stack` alone is the generic type; `Stack[int]` is one of its instantiations. Wherever the spec talks about "a type", it generally refers to a *non-generic* or *instantiated* type — generic types must be instantiated before they can be used as the type of a variable, field, or argument.

---

## Grammar — type declarations with parameters

From the spec's EBNF:

```
TypeDecl       = "type" ( TypeSpec | "(" { TypeSpec ";" } ")" ) .
TypeSpec       = AliasDecl | TypeDef .
TypeDef        = identifier [ TypeParameters ] Type .
AliasDecl      = identifier "=" Type .
```

A `TypeDef` may carry a `TypeParameters`. An `AliasDecl` may not — aliases of generic types are still generic-shaped, but the alias declaration itself does not introduce parameters.

### Examples and explanation

```go
type Stack[T any] struct { ... }       // TypeDef with TypeParameters
type StringStack = Stack[string]        // AliasDecl
type CustomStack Stack[int]             // TypeDef without TypeParameters (uses already-instantiated underlying)
type Cache[K comparable, V any] struct { ... } // TypeDef with multi-parameter list
```

---

## Grammar — type parameter list

```
TypeParameters = "[" TypeParamList [ "," ] "]" .
TypeParamList  = TypeParamDecl { "," TypeParamDecl } .
TypeParamDecl  = IdentifierList TypeConstraint .
TypeConstraint = TypeElem .
```

A `TypeParameters` is a bracketed comma-separated list of `TypeParamDecl`s. Each declaration consists of one or more identifiers followed by their *constraint* (an interface or a type element).

Examples:

```go
[T any]                         // single param, constraint any
[T, U any]                      // two params sharing the constraint any
[K comparable, V any]           // mixed constraints
[T constraints.Integer]         // imported constraint
[T ~int | ~int64]               // inline type set constraint (in some positions)
```

The trailing comma is permitted (`[T any,]`) — useful when generating code, rarely written by hand.

---

## Grammar — type constraints and type sets

```
InterfaceType  = "interface" "{" { InterfaceElem ";" } "}" .
InterfaceElem  = MethodElem | TypeElem .
MethodElem     = MethodName Signature .
TypeElem       = TypeTerm { "|" TypeTerm } .
TypeTerm       = Type | UnderlyingType .
UnderlyingType = "~" Type .
```

An interface element is either a *method* or a *type element*. A type element is a `|`-separated set of *terms*; a term is a type, optionally prefixed with `~`.

Spec quote (*Interface types*):

> "An interface element is either a method or a type element, where a type element is a union of one or more type terms. A type term is either a single type or a single underlying type."

The presence of any type element makes the interface a **constraint-only** interface — usable in a type parameter list, **not** as the type of a variable.

### Type set semantics

The spec defines the *type set* of an interface as the set of types that satisfy it:

- A pure-method interface's type set is "all types whose method set includes these methods".
- A type-element interface's type set is "the union of the term sets".
- A `~T` term's type set is "all types whose underlying type is T".
- Mixing methods and type sets is allowed; the type set is the intersection (must be in the union AND have the methods).

### Examples

```go
interface { int }                    // type set = { int }
interface { ~int }                   // type set = { int, MyInt, AnyAlias int, ... }
interface { int | int64 }            // type set = { int, int64 }
interface { ~int | ~int64 }          // type set = { int, int64, MyInt, MyInt64, ... }
interface { int | ~string }          // type set = { int, string, MyString, ... }
interface { Stringer }               // type set = "all types with String() string"
interface { ~int; Stringer }         // intersection: int-underlying types that also have String()
```

---

## Instantiation

Spec quote (*Instantiations*):

> "A generic type is instantiated by substituting type arguments for the type parameters."
> "Instantiating a type is essentially a syntactic substitution operation; the result is a non-generic type, with the type arguments substituted for the type parameters in the body of the generic type."

Syntax:

```
Type           = TypeName [ TypeArgs ] | TypeLit | "(" Type ")" .
TypeArgs       = "[" TypeList [ "," ] "]" .
TypeList       = Type { "," Type } .
```

So `Stack[int]` is `Stack` followed by `TypeArgs` `[int]`.

### When inference applies

In assignments and function calls, the compiler may infer the type arguments from context. For type names used as types of variables, inference is more limited; you usually write all arguments explicitly:

```go
var s Stack[int]       // explicit
var p Pair[string, int] // explicit
```

For generic function calls:

```go
nums := []int{1, 2, 3}
sum := Sum(nums)       // Sum[int] inferred from argument
```

(Section 4.5 covers inference in depth.)

### Instantiated types are first-class

A `Stack[int]` is a normal type. You can:

- Declare variables of it.
- Use it in struct fields.
- Pass it to functions.
- Take its address (`*Stack[int]`).
- Define methods on a *defined* type built from it (`type IntStack Stack[int]; func (s *IntStack) Foo() {}`).

---

## Method declarations on generic types

Spec quote (*Method declarations*):

> "If the receiver base type is a generic type, the receiver specification must declare corresponding type parameters for the method to use. This makes the receiver type parameters available to the method."
> "A method declaration may not have type parameters."

The grammar:

```
MethodDecl = "func" Receiver MethodName Signature [ FunctionBody ] .
Receiver   = Parameters .
```

The `Receiver` may carry a type parameter list as part of the receiver type. Critically, the `MethodName Signature` does **not** allow a `TypeParameters` between the name and `(`. That is what disallows method-level type parameters.

### Receiver examples

```go
// Legal:
func (s *Stack[T]) Push(v T) { ... }
func (m Map[K, V]) Get(k K) (V, bool) { ... }
func (b Box[T]) Wrap() Wrapper[T] { ... }

// Illegal (compile error):
func (s *Stack[T]) MapTo[U any](fn func(T) U) *Stack[U] { ... } // method has type parameters
func (s *Stack) Push(v T) { ... }                                // missing receiver parameters
```

### Why this restriction exists

The Go team's reasoning, recorded in design documents and FAQ entries:

1. Method-level type parameters complicate interface satisfaction (already mentioned in middle.md).
2. They interact awkwardly with method values and method expressions.
3. They were not necessary for the goals of the initial generics proposal.

The result is a clean rule: **a method's type parameters are exactly the receiver type's type parameters**.

---

## Type identity rules

Spec quote (*Type identity*):

> "Two named types are identical if their type names originate in the same TypeSpec. ... A defined (named) type is always different from any other type."

Generic types add:

> "Two instantiated types are identical if their generic types are identical and all type arguments are identical."

So:

- `Stack[int]` and `Stack[int]` (same package) are identical.
- `Stack[int]` and `Stack[string]` are different types.
- `pkgA.Stack[int]` and `pkgB.Stack[int]` are different types if `pkgA.Stack` and `pkgB.Stack` are different `TypeSpec`s.
- `IntStack` declared via `type IntStack = Stack[int]` is identical to `Stack[int]`.
- `IntStack` declared via `type IntStack Stack[int]` is a *different* defined type.

Type identity matters for assignability, conversions, channel direction, and interface satisfaction.

---

## Assignability rules

Quoting (paraphrased) from *Assignability*:

> "A value x of type V is assignable to a variable of type T if V and T are identical, or have identical underlying types and at least one is not a defined type, or T is an interface type and V implements T, ..."

For generic types, this means:

```go
var a Stack[int]
var b Stack[int]
a = b // OK — identical types

var c Stack[string]
a = c // ✘ not identical, no implicit conversion

type IntStack Stack[int] // defined type with same underlying

var x Stack[int]
var y IntStack
x = y // ✘ both defined; need conversion
y = IntStack(x) // OK
```

---

## Method sets and interface satisfaction

Spec quote (*Method sets*):

> "The method set of a type determines the interfaces that the type implements ..."

For generic types, the method set is computed *after* instantiation:

- Method set of `Stack[int]` = methods of `Stack[T]` with `T` substituted by `int`.
- Method set of `*Stack[int]` includes methods with both pointer and value receivers.

Interface satisfaction:

```go
type Pusher[T any] interface {
    Push(T)
}

var p Pusher[int] = &Stack[int]{} // OK
var q Pusher[string] = &Stack[int]{} // ✘ Push(int) ≠ Push(string)
```

The check is purely structural: methods names + signatures must match exactly after parameter substitution.

---

## Embedding rules for interfaces

Spec quote (*Interface types*):

> "An interface T may use a (possibly qualified) interface type name E as an interface element. This is called embedding interface E in T. The type set of T is the intersection of the type sets defined by T's explicitly declared methods and the type sets of T's embedded types."

Practical implications:

- Embedding a *value* interface `Stringer` adds its methods.
- Embedding a *constraint* interface `Numeric` adds its type set; if combined with methods, the result is constraint-only.
- Embedding a generic interface `Iterator[T]` requires that `T` is in scope.

### Examples

```go
type Reader[T any] interface { Read() T }
type Closer interface { Close() error }

type ReadCloser[T any] interface {
    Reader[T]
    Closer
}

// As constraint:
type StringableNumber interface {
    Numeric
    fmt.Stringer
}
```

The intersection rule means `T` in `StringableNumber` must be both numeric AND have `String() string`.

---

## Predeclared `any` and `comparable`

Spec quote (*Predeclared identifiers*):

> "any is an alias for `interface{}`."
> "comparable is an interface that is implemented by all comparable types (see *Type identity*). It can only be used as (or embedded in) a type constraint."

So:

- `any` is usable wherever `interface{}` is — both as constraint and as value type.
- `comparable` is constraint-only; you cannot declare `var x comparable = 1`.

### `comparable` semantics

A type is `comparable` if `==` and `!=` are defined for it:
- Boolean, numeric, string, pointer, channel, interface, struct (when fields are comparable), array (when element is comparable).
- **Not** comparable: slice, map, function, struct/array containing any of those.

Note: The Go 1.20+ spec relaxed `comparable` slightly to allow type parameters constrained by `comparable` to be used as map keys even when at runtime the value contains an interface — this is the so-called "strict comparability" rule. See go.dev/issue/56548 for the timeline.

---

## Type inference summary (forward link)

Spec section *Type inference* defines how the compiler determines type arguments. For type instantiations it is mostly limited; for function instantiations it is rich.

This section is covered in section 4.5 of this roadmap. Key spec rule:

> "Type inference is based on (a) a substitution map ... and (b) constraint type inference."

Two passes (function argument inference, constraint inference) iterate to a fixed point.

---

## Reflection of instantiated types

`reflect.TypeOf(Stack[int]{})` returns a `reflect.Type` with:

- `Name()` reporting the full instantiated name (e.g., `Stack[int]`).
- `PkgPath()` reporting the source package path.
- `Kind()` reporting the underlying kind (e.g., `reflect.Struct`).

Two different instantiations have two different `reflect.Type` values (different `Name()`s).

There is currently **no** way to construct a generic type at runtime via reflection — instantiation is a compile-time operation.

---

## Summary

The Go specification adds three things for parameterized types:

1. **Type parameter lists** — bracketed lists after type or function names, each parameter associated with a constraint (which is an interface, possibly with a type set).
2. **Instantiation** — substitution of type arguments to produce a concrete, identical-as-syntactic-substitute type.
3. **Method declaration on generic receivers** — receivers carry their type parameters; methods may not add new ones.

The grammar additions are minimal but precise: `TypeParameters`, `TypeParamList`, `TypeArgs`, `TypeElem`, `TypeTerm`. Type identity, assignability, method sets, and interface satisfaction all extend their existing rules naturally to instantiated types.

End of specification.md.
