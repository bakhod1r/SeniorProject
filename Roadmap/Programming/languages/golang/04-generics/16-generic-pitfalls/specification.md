# Generic Pitfalls — Specification

## Table of Contents
1. [Source of truth](#source-of-truth)
2. [The zero value rule](#the-zero-value-rule)
3. [Type identity for parameterized types](#type-identity-for-parameterized-types)
4. [Operator restrictions on type parameters](#operator-restrictions-on-type-parameters)
5. [Type assertion and switch rules](#type-assertion-and-switch-rules)
6. [`comparable` and strict comparability](#comparable-and-strict-comparability)
7. [Method sets of type parameters](#method-sets-of-type-parameters)
8. [Type inference rules](#type-inference-rules)
9. [Composite literal restrictions](#composite-literal-restrictions)
10. [Why each pitfall happens — quick map](#why-each-pitfall-happens-quick-map)
11. [Summary](#summary)

---

## Source of truth

- <https://go.dev/ref/spec> — the live spec
- <https://go.dev/ref/spec#The_zero_value> — zero values
- <https://go.dev/ref/spec#Type_identity> — type identity
- <https://go.dev/ref/spec#Operators> — operators and types
- <https://go.dev/ref/spec#Type_assertions> — assertions
- <https://go.dev/ref/spec#Type_switches> — type switches
- <https://go.dev/ref/spec#Type_inference> — inference
- <https://go.dev/ref/spec#Type_constraints> — constraints
- <https://go.dev/ref/spec#Composite_literals> — composite literals

This document quotes spec language to explain **why** each pitfall is forbidden or surprising.

---

## The zero value rule

The spec defines:

> When storage is allocated for a variable, either through a declaration or a call of `new`, or when a new value is created, either through a composite literal or a call of `make`, and no explicit initialization is provided, the variable or value is given a default value. Each element of such a variable or value is set to the zero value for its type.

Key consequences for generics:

1. `var zero T` is **always** valid — the compiler zero-initializes whatever `T` becomes at instantiation.
2. `*new(T)` returns the dereferenced zero value of `T`. Equivalent.
3. **`T{}` is a composite literal**, which is restricted to specific types.

The spec on composite literals:

> The values of a composite literal must be of the type defined for the type T.

A composite literal `T{}` is only valid when `T` is "an array, slice, map, or struct type". `T any` does not guarantee this. Hence `T{}` is rejected at compile time.

### Why this matters

The pitfall "I cannot write `T{}`" follows directly from the composite-literal rule, which exists for **non-generic** code already. Generics inherited it. The spec is consistent — what changed is that with `T any` the user can no longer rely on knowing the kind of `T`.

---

## Type identity for parameterized types

> Two named types are identical if their type names originate in the same TypeSpec.
> A defined type is always different from any other type.

For generics, the spec adds:

> A parameterized type is identical to another parameterized type if both originate from the same type definition and the type arguments are pairwise identical.

Practical consequence:

```go
type List[T any] struct{ ... }

var a List[int]
var b List[int64]
b = a // compile error: cannot assign List[int] to List[int64]
```

`List[int]` and `List[int64]` are **distinct types** even though their structure is identical. They must be converted explicitly (which is itself often forbidden).

This rule explains the pitfall: "I have two `List` instances; I should be able to assign them to each other." You cannot. Each instantiation is a fresh type.

---

## Operator restrictions on type parameters

The spec on operators:

> A type parameter type's set of types must contain only types that support the operator.

Translated:

- `+` requires the type set to contain only types supporting `+` (numeric, string).
- `-`, `*`, `/`, `%` similarly.
- `==`, `!=` require the type to be comparable.
- `<`, `<=`, `>`, `>=` require the type to be ordered.
- `&`, `|`, `^`, `<<`, `>>` require integer types.

The compiler enforces this **per type parameter, against its constraint**. For `T any`, the type set is "all types" — so no operator works. For `T comparable`, only `==` and `!=`.

### Why this is a pitfall

A user writes:

```go
func Sum[T any](s []T) T {
    var total T
    for _, v := range s { total += v } // ❌
    return total
}
```

The error message is "operator + not defined on T (type parameter)". The fix is to choose a constraint whose type set guarantees `+`.

The spec is unambiguous: the body's operations must be **provably** valid for every type in the constraint's type set. There is no "I promise the caller will use a numeric T" hatch.

---

## Type assertion and switch rules

The spec on type assertions:

> For an expression x of interface type, but not a type parameter, and a type T...

The phrase "but not a type parameter" is explicit. A type assertion `x.(T)` is invalid if `x` is of type parameter type. Likewise:

> A type switch ... compares types rather than values. ... The switch expression x must be of interface type.

`T` is not interface type (unless its constraint is just `any`/`interface{}`). The compiler rejects direct type switches on `T`.

### The `any(v)` workaround

`any(v)` is a **conversion** to an interface type. Once `v` is `any`, the spec's rules for type assertions on interfaces apply normally.

The spec **does not** forbid `any(v).(T2)`. It is a normal interface-typed expression.

### Why this is a pitfall

The rule is consistent with the rest of the spec — it does not single out generics. But users who learned interfaces before generics expect `T` to "just work" with assertions. The spec disagrees; the cost is a one-line workaround.

---

## `comparable` and strict comparability

The spec defines:

> The predeclared interface type `comparable` denotes the set of all non-interface types that are strictly comparable.

"Strictly comparable" means `==` is **always** safe. The spec excludes:

- Slices (`==` is a compile error)
- Maps (`==` is a compile error)
- Functions (`==` only against nil)
- Structs containing any of the above
- Arrays of any of the above

In Go 1.20, the spec was relaxed: interface types **also** satisfy `comparable`, with the runtime caveat that comparing dynamic types that are not strictly comparable will panic.

```go
func Eq[T comparable](a, b T) bool { return a == b }

var x, y any = []int{1}, []int{1}
Eq(x, y) // 1.20+: compiles, panics at runtime
// pre-1.20: compile error
```

### Why this is a pitfall

Users in the wild do not always know the comparable rules:

- "Slices are comparable, right?" — no
- "Function values are comparable?" — only against nil
- "comparable means I can use `<`?" — no, that's `cmp.Ordered`

Every misunderstanding produces a class of pitfalls.

---

## Method sets of type parameters

The spec:

> The method set of a type parameter is the intersection of the method sets of each type in the type parameter's type set.

If your constraint is `~int | ~float64`, the type set is integers and floats. The intersection of their method sets is **empty**. Hence:

```go
func F[T ~int | ~float64](v T) string {
    return v.String() // ❌ no String method
}
```

Even if every `int` named type **has** `String()`, the intersection is computed structurally. To call a method, the constraint must explicitly require it:

```go
type Stringer interface { ~int | ~float64; String() string }
```

Now the intersection has `String()`. But now no predeclared type satisfies the constraint — only named types with the method.

### Why this is a pitfall

Users assume "I can call any method that the underlying type has". The spec disagrees: the constraint is the contract, and the method must appear in the constraint to be callable.

---

## Type inference rules

The spec, summarized:

1. **Function argument inference** — match each argument's type against parameter types.
2. **Constraint type inference** — propagate constraints to deduce parameters.
3. **Untyped argument inference** — assign default types to untyped constants.

Inference is bounded by:
- Looking only at **arguments**, not return types
- Failing when there are no arguments (zero-arg generic function calls cannot infer)
- Sometimes failing when type parameters appear inside function-typed arguments

### Why this is a pitfall

Inference looks magical when it works, frustrating when it fails. The spec defines exactly when it works; users learn the rules empirically (= "I tried, it failed, I added explicit args").

Recent Go versions improved inference (1.21 was a big jump). What fails in 1.18 may compile in 1.21. This **breaks** the predictability — code that "did not compile" mysteriously starts compiling on a version upgrade.

---

## Composite literal restrictions

The spec on composite literals:

> The LiteralType's underlying type must be a struct, array, slice, or map type.

For a type parameter `T`, the underlying type is unknown until instantiation. The compiler cannot decide whether `T{}` is valid without knowing the type argument.

### What about constrained `T`?

If the constraint guarantees a structural shape, can `T{}` work?

```go
type SliceLike[T any] interface { ~[]T }

func F[E any, S SliceLike[E]]() S {
    return S{} // is this OK?
}
```

In current Go (as of 1.24), the answer is generally **no** for arbitrary constraints. Composite literals on type parameters were debated and partially relaxed in some versions, but the conservative approach is `*new(S)` or `var zero S`.

### Why this is a pitfall

The spec rules are intentionally conservative. Allowing `T{}` would require the compiler to track structural information through type parameters in ways that complicate the implementation. The cost is the user's confusion when `var zero T` works but `T{}` does not.

---

## Why each pitfall happens — quick map

| Pitfall | Spec section | Reason |
|---------|--------------|--------|
| `T{}` rejected | Composite literals | Underlying type unknown |
| `v == nil` for `T any` | Operators on T | `==` requires comparable; `nil` requires nilable |
| `any` vs `interface{}` confusion | Predeclared identifiers | `any = interface{}` alias since 1.18 |
| Type switch on `T` | Type assertions | T is not interface type |
| Inference fails on hidden T | Type inference | Inference reads forward, not backward |
| Different `List[T1]` and `List[T2]` | Type identity | Each instantiation is a distinct type |
| `comparable` excludes slices | Strict comparability | Slices have no defined `==` |
| Method on `T` requires it in constraint | Method sets | Intersection rule |
| Method-set-not-satisfied errors | Method sets | Pointer vs value receiver |
| Empty type set accepted | Constraints | Spec allows; usability suffers |

A senior engineer reading the Go spec sees each pitfall as a **principled** consequence of the spec's design, not an accident.

---

## Summary

The Go specification handles type parameters with a small number of rules that interact tightly:

1. **Composite literals** are restricted to specific kinds — hence no `T{}`.
2. **Type identity** treats each instantiation as a distinct type — hence no cross-assignment.
3. **Operator validity** is decided per constraint — hence `+` requires a numeric constraint.
4. **Type assertions** require interface-typed expressions — hence `any(v).(...)`.
5. **`comparable`** denotes strictly comparable types — slices and maps are out.
6. **Method sets** of type parameters are intersections — narrower than users expect.
7. **Type inference** reads forward from arguments — fails on backwards-only patterns.

Every junior, middle, and senior pitfall in this topic traces back to one of these rules. Understanding the spec is the **shortcut** to predicting which patterns will compile and which will fail.

The next file converts these rules into 30+ Q&A drills for interview practice.
