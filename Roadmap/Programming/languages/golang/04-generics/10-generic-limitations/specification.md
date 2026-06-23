# Generic Limitations — Specification

## Table of Contents
1. [Source of truth](#source-of-truth)
2. [The original Type Parameters proposal](#the-original-type-parameters-proposal)
3. [Proposal 47781 — type parameters in methods](#proposal-47781-type-parameters-in-methods)
4. [Proposal 46477 — generic type aliases](#proposal-46477-generic-type-aliases)
5. [What the spec forbids: explicit list](#what-the-spec-forbids-explicit-list)
6. [Method receiver type parameter rules](#method-receiver-type-parameter-rules)
7. [The "type parameter is not an interface" rule](#the-type-parameter-is-not-an-interface-rule)
8. [Variance rules — invariance](#variance-rules-invariance)
9. [Predeclared functions on type parameters](#predeclared-functions-on-type-parameters)
10. [Constraint elements: what can and cannot appear](#constraint-elements-what-can-and-cannot-appear)
11. [Summary](#summary)

---

## Source of truth

For every claim in this file, the authoritative reference is:

- The Go Programming Language Specification: <https://go.dev/ref/spec>
- The Type Parameters Proposal: proposal **43651** — <https://go.googlesource.com/proposal/+/HEAD/design/43651-type-parameters.md>
- The proposal tracker: <https://github.com/golang/go/issues?q=label%3Agenerics>

This document quotes the spec in paraphrase for clarity. Always confirm with the live spec for the canonical wording.

---

## The original Type Parameters proposal

Proposal **43651** (accepted Feb 2021, shipped in 1.18) explicitly lists features it deliberately **excluded**:

1. **Method type parameters** — methods may use only the receiver's parameters.
2. **Type-parameterized type aliases** — listed as future work.
3. **Higher-kinded types** — out of scope.
4. **Variance** — generic types are invariant, full stop.
5. **Specialization** — one body per shape, no per-type override.
6. **Operator overloading** — `+`, `<`, `==` come from constraints, not from custom operators.

The proposal authors (Ian Lance Taylor and Robert Griesemer) wrote:

> Our goal is to be small and simple. We are deliberately leaving out features that other languages with generics have, because we are not sure they are worth the cost in language complexity.

Each subsequent generic-related proposal has been weighed against this ground rule.

---

## Proposal 47781 — type parameters in methods

Proposal **47781** ("type parameters on methods") was filed in August 2021 by community members asking for the ability to write:

```go
type Slice[T any] struct{ data []T }
func (s Slice[T]) Map[U any](f func(T) U) Slice[U] // proposed
```

### Status

The proposal is **closed without action**. The Go team summarized their reasoning:

1. **Implementation cost** — method type parameters interact with the runtime dictionary mechanism in ways that significantly complicate the compiler.
2. **Interface complications** — interfaces with parameterized methods would require an extension of the interface model that has its own design questions.
3. **Workaround availability** — every concrete use case has a free-function workaround that compiles to equivalent code.

Quoting from the proposal discussion:

> Adding parameterized methods to the language is a major change. We do not see compelling examples that justify the additional complexity at this time.

The community periodically reopens the conversation but no acceptance has emerged.

### Practical takeaway

Code referencing this limit can cite proposal 47781 directly. When asked "could this ever change?", the honest answer is "not in any planned release; the proposal is closed".

---

## Proposal 46477 — generic type aliases

Proposal **46477** ("type aliases with type parameters") was filed in 2021 and ultimately accepted, shipping in **Go 1.24** (February 2025):

```go
type Vec[T any] = []T // 1.24+
```

### History

- 1.18: rejected at the language level — aliases could not have parameters.
- 1.19–1.23: marked as future work; experimental implementations gathered feedback.
- 1.24: accepted, shipped as `GOEXPERIMENT=aliastypeparams` in 1.23, default-on in 1.24.

### Why so long?

The challenge was **identity**: aliases are supposed to be the same as their target type. With type parameters, "the same" becomes ambiguous. The 1.24 design pinned down the rules:

1. A parameterized alias is interchangeable with its target after instantiation.
2. The alias does not introduce a new defined type — no new method set.
3. Recursive aliases are forbidden.

For the full treatment see [`14-generic-type-aliases`](../14-generic-type-aliases/junior.md). This file mentions it only as a former limit now lifted.

---

## What the spec forbids: explicit list

The spec forbids each of the following (paraphrased from the relevant sections):

### 1. Method type parameters

> A method declaration binds an identifier, the method name, to a method, and associates the method with the receiver's base type. Method declarations may not declare type parameters of their own.

In code:

```go
type T[A any] struct{}
func (t T[A]) M[B any]() {} // ❌
```

### 2. Type switch on a non-interface type parameter

> A type switch compares types rather than values. A type switch is otherwise similar to an expression switch. It is specified by a special switch expression that has the form of a type assertion using the keyword type rather than an actual type.

The "type assertion" form requires the operand to be an interface. A bare type parameter is not.

```go
func F[T any](v T) {
    switch v.(type) {} // ❌
}
```

### 3. Conversion between distinct instantiations

```go
type Box[T any] struct{}
var a Box[int]
var b Box[int64]
b = a // ❌ — different types
```

The spec treats `Box[int]` and `Box[int64]` as distinct named types.

### 4. Embedding a type parameter directly

```go
type Wrapper[T any] struct {
    T // ❌ — cannot embed a type parameter
}
```

A struct can embed a defined type, not a type parameter.

### 5. Constraint elements that are interface types in a union

```go
type C interface { fmt.Stringer | error } // ❌
```

Type elements in a union must be types, not interfaces.

### 6. Recursive constraints with self-reference

```go
type C interface { ~int; C } // ❌
```

The compiler rejects circular constraint definitions.

### 7. `~T` where T is an interface

```go
type C interface { ~fmt.Stringer } // ❌
```

The `~` operator requires a non-interface type.

### 8. Predeclared functions on type parameters without a guarantee

```go
func F[T any](v T) int {
    return len(v) // ❌
}
```

`len` is allowed only when the constraint guarantees the operation.

### 9. Method type parameters on interface methods

```go
type I interface { M[T any]() } // ❌
```

Same rule from the interface side.

### 10. Generic constants

```go
const X T = 1 // ❌ — constants cannot have type parameter types
```

Type parameters are runtime constructs; constants are evaluated at compile time before instantiation.

---

## Method receiver type parameter rules

The spec is precise about what the receiver may declare:

> A receiver type may be a parameterized type, in which case the receiver specifies corresponding type parameters for the method to use.

So:

```go
type S[A, B any] struct{}
func (s S[A, B]) M(x A, y B) {} // OK — uses both
func (s S[A, B]) N(x A) {}      // OK — uses only A; B is in scope but unused
func (s S[X, Y]) P() {}         // OK — receiver may rename, though discouraged
```

The names in the receiver's parameter list are **fresh bindings** — they shadow any package-level identifiers. The convention is to reuse the type's parameter names verbatim (`A`, `B`) for clarity.

### Rename rules

```go
type S[T any] struct{}
func (s S[T]) M() {} // canonical
func (s S[U]) M() {} // legal — U is a fresh name for T
```

Renaming compiles but is non-idiomatic. Code review should flag it.

---

## The "type parameter is not an interface" rule

The spec says (paraphrased):

> Type assertions and type switches require an expression of interface type. A type parameter is not an interface type.

This is the formal reason `v.(T)` and `switch v.(type)` fail when `v` has a type parameter type.

The workaround `any(v).(type)` is allowed because `any(v)` performs an explicit conversion to `interface{}`, after which the type assertion is well-typed.

### Conversion rules between type parameters and interfaces

```go
func F[T any](v T) {
    var i interface{} = v // OK — every T is assignable to interface{}
    var j any = v         // OK — same as above
    _ = i; _ = j
}
```

Type parameters are **assignable** to `interface{}`/`any` automatically, but a type-assertion-style operation requires the expression to already be an interface.

---

## Variance rules — invariance

The spec does not have an explicit "variance" section because Go's rule is uniformly:

> Two named types are different if they have different names or different parameterizations. Generic instantiations with different type arguments are different types.

So `Box[Cat]` and `Box[Animal]` are different types. There is no implicit conversion between them, regardless of whether `Cat` satisfies `Animal`.

### Why this matters

Languages with covariance often suffer from the **PutItemBack** problem (a `List<Cat>` covariantly assigned to `List<Animal>` could have an `Animal` that is not a `Cat` added — runtime error). Go avoids the entire class of problems by refusing the assignment.

The cost: explicit copy loops:

```go
cats := []Cat{...}
animals := make([]Animal, len(cats))
for i, c := range cats { animals[i] = c }
```

The Go FAQ states this explicitly:

> Go does not have covariant slice types. The conversion from `[]Cat` to `[]Animal` is rejected because such conversions can lead to type errors at run time.

---

## Predeclared functions on type parameters

The spec governs which built-ins work on a value of type parameter type. Summary:

| Builtin | Works on bare `T any`? | Notes |
|---------|-------------------------|-------|
| `new(T)` | yes | Allocates sizeof(T) bytes |
| `make(T, ...)` | no | Requires constraint of slice/map/chan |
| `len(v)` | no | Requires constraint of `~string \| ~[]E \| ...` |
| `cap(v)` | no | Same as `len` |
| `append(s, v...)` | no | Requires `~[]E` |
| `copy(dst, src)` | no | Requires both to be slices |
| `delete(m, k)` | no | Requires map constraint |
| `close(c)` | no | Requires chan constraint |

So a generic function that wants to call `len` must declare a constraint that guarantees the operation:

```go
func Len[E any, S ~[]E | ~string](s S) int { return len(s) }
```

This is verbose but precise — the spec's rule that "operations must be supported by every type in the type set" is what makes this guarantee.

---

## Constraint elements: what can and cannot appear

A constraint is an interface. The spec extends interfaces to allow **type elements** in addition to method elements. The grammar is:

```ebnf
InterfaceType  = "interface" "{" { InterfaceElem ";" } "}" .
InterfaceElem  = MethodElem | TypeElem .
TypeElem       = TypeTerm { "|" TypeTerm } .
TypeTerm       = Type | UnderlyingType .
UnderlyingType = "~" Type .
```

### Allowed

- `~int`, `int | string`, `~int | ~float64` — unions of types and underlying types.
- Method elements: `Foo() error`.
- Embedded interfaces: `comparable; ~int`.

### Forbidden

- Interfaces in unions: `Stringer | error` — refused.
- `~Interface`: `~fmt.Stringer` — refused.
- Type parameter terms in unions: `T1 | T2` where `T1`/`T2` are type parameters — refused.
- Empty intersections: `int; string` — accepted by the spec but is unusable (empty type set).

### Why type elements are restricted

The spec authors wanted constraint satisfiability to be **decidable** and the constraint type set to be **explicit**. Allowing interfaces in unions or `~` on interfaces would make the type set computation depend on subtype relationships across the entire program, which Go's type system does not track.

---

## Summary

The Go specification handles generic limitations with surprising **clarity**:

1. **Method type parameters** are explicitly forbidden by the receiver-method rule.
2. **Type switches** require interface operands; bare `T` does not satisfy that.
3. **Variance** is invariance, codified by the "named types are different if parameterizations differ" rule.
4. **Predeclared functions** on `T` are gated by constraint guarantees.
5. **Type aliases with parameters** were forbidden until proposal 46477 shipped in 1.24.
6. **Constraint elements** are limited to types and underlying-type terms; interfaces and tilde-on-interfaces are out.

Each limit traces to one of two principles:

- **Implementation tractability** — keep the compiler and runtime simple.
- **User predictability** — keep error messages clear and constraints explicit.

A senior engineer can cite the relevant section of the spec or the proposal number for any limit they encounter. This is what turns "I cannot do X" into a productive design discussion: you know **why** the language refuses, and you can pick the right workaround on grounds the language designers themselves agree with.

The next file (`interview.md`) drills these rules in Q&A form for fluency in interviews and design reviews.
