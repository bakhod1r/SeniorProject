# Recursive Type Constraints — Specification

## Table of Contents
1. [Source of truth](#source-of-truth)
2. [Why "F-bounded" is not in the spec](#why-f-bounded-is-not-in-the-spec)
3. [Type sets and self-reference](#type-sets-and-self-reference)
4. [Type parameters as instantiation arguments](#type-parameters-as-instantiation-arguments)
5. [Implementing an interface — the recursive case](#implementing-an-interface-the-recursive-case)
6. [Substitution rules](#substitution-rules)
7. [What the spec forbids about recursion](#what-the-spec-forbids-about-recursion)
8. [Constraint type inference and recursion](#constraint-type-inference-and-recursion)
9. [Predeclared interactions](#predeclared-interactions)
10. [Spec reading exercise](#spec-reading-exercise)
11. [Summary](#summary)

---

## Source of truth

The authoritative source is the Go Programming Language Specification:

- <https://go.dev/ref/spec> — the live spec
- <https://go.dev/ref/spec#Type_parameters> — type parameters
- <https://go.dev/ref/spec#Type_constraints> — constraints
- <https://go.dev/ref/spec#General_interfaces> — interface type sets
- <https://go.dev/ref/spec#Implementing_an_interface> — what it means for a type to satisfy an interface
- <https://go.dev/ref/spec#Type_inference> — inference rules

Recursive type constraints are not a separate spec section. They emerge from the **interaction** of three rules: constraints are interfaces, generic interfaces are instantiable, and type parameters are types.

---

## Why "F-bounded" is not in the spec

The phrase "F-bounded polymorphism" never appears in Go's spec. The reason: Go did not add a special feature for this pattern. It falls out of the existing machinery:

1. **A constraint is an interface.** (Constraints section.)
2. **Interfaces can be generic** (i.e., have type parameters of their own). (Type parameters section.)
3. **Generic interfaces can be instantiated** with any type, including a type parameter from the surrounding scope. (Instantiation section.)

So writing `[T Cloner[T]]` is just rule 3 applied: instantiate `Cloner` with the same `T` you are constraining. The recursion is implicit.

Compare: Java spells out `<T extends Comparable<T>>` and the JLS describes F-bounded quantification explicitly. Go's spec is leaner — it does not need a separate concept.

---

## Type sets and self-reference

The spec says:

> The type set of an interface type is the intersection of the type sets of its terms.

A generic interface `Cloner[T any] interface{ Clone() T }` has, **once instantiated** with a concrete `T`, a type set: every type that has a method `Clone() T` with the substituted `T`.

When the constraint is `Cloner[T]` and we are checking some candidate `U`, the spec proceeds:

1. Substitute `T = U` into the constraint.
2. The constraint becomes `Cloner[U]` whose type set is "every type with `Clone() U`".
3. Check whether `U` is in that type set.

If yes, `U` satisfies the constraint. If not, the call fails to compile.

### A worked example

```go
type Foo struct{}
func (f Foo) Clone() Foo { return f }
```

For `DupAll[T Cloner[T]](xs []T)` called with `xs []Foo`:

1. `T = Foo` is inferred.
2. Constraint becomes `Foo Cloner[Foo]`.
3. The type set of `Cloner[Foo]` is "every type with `Clone() Foo`".
4. `Foo` has `Clone() Foo` — match.

The recursion is "compiled out" by substitution.

---

## Type parameters as instantiation arguments

The spec explicitly allows a type parameter to be used as a type argument:

> A type parameter is a type. It may be used wherever a type is permitted.

Therefore:

```go
[T Cloner[T]]
//      ^   T (the parameter being constrained) is used as the
//          type argument to Cloner.
```

This is not a special construct — it is just a normal instantiation. The spec does not need to mention "recursive constraints" as a category because the same rule covers all instantiations.

### Mutual recursion

Two interfaces can refer to each other through their parameters:

```go
type A[T any] interface { ToB() B[T] }
type B[T any] interface { ToA() A[T] }
```

The spec accepts this. Mutual recursion is just two instantiations sharing a parameter. But the **constraints** on call sites get more complicated:

```go
func F[X A[X], Y B[Y]](a X, b Y) { ... }
```

This compiles. Inference, however, may struggle in nontrivial cases.

---

## Implementing an interface — the recursive case

The "Implementing an interface" section says a type `T` implements an interface `I` if every method in `I`'s method set is in `T`'s method set with matching signatures. For **non-generic** interfaces this is straightforward.

For **generic interfaces used as constraints**, the spec applies substitution first:

> When a type parameter is used in an interface type's type elements, the type set is computed by substituting the type argument.

So checking "does `Foo` satisfy `Cloner[Foo]`?" is the same as checking "does `Foo` satisfy `interface{ Clone() Foo }`?".

### Method set rules

The receiver type matters. If `Cloner[T]` is `interface{ Clone() T }`:

```go
func (f Foo) Clone() Foo { return f } // method set of Foo includes Clone()
// → Foo satisfies Cloner[Foo]

func (f *Foo) Clone() *Foo { return f } // method set of *Foo includes Clone()
// → *Foo satisfies Cloner[*Foo], not Cloner[Foo]
```

Pointer vs value receiver matters as much as in normal interface satisfaction.

---

## Substitution rules

The spec describes substitution carefully:

> When a parameterized type is instantiated, each occurrence of a type parameter in the type definition is replaced by the corresponding type argument.

So if `Cloner[T any] interface{ Clone() T }`, instantiating `Cloner[Foo]` gives:

```go
interface { Clone() Foo }
```

The substitution is **textual** at the type level. There is no further unwinding.

### Instantiation chains

What about `Cloner[Cloner[Foo]]`? The substitution gives:

```go
interface { Clone() Cloner[Foo] }
// which expands to:
interface { Clone() interface{ Clone() Foo } }
```

The compiler accepts this, but humans rarely should. **Two layers of recursion is already a smell**.

### Avoiding infinite expansion

The spec forbids true cycles:

```go
type T[U any] struct { x T[T[U]] } // ❌
```

The compiler detects the cycle and rejects it. For interface constraints, true cycles cannot form in practice because substitution is one-shot.

---

## What the spec forbids about recursion

### 1. Self-referential constraints without a parameter

```go
type C interface { ~int; C } // ❌
```

A constraint embedding itself with no parameter creates a true cycle. The spec rejects.

### 2. Type parameter constraint loops

```go
type A[T B[T]] struct{}
type B[T A[T]] struct{}
```

Mutual instantiation between **type definitions** can fail because the compiler cannot determine a stable expansion. The spec rejects truly circular definitions.

### 3. Method type parameters

```go
func (b Box[T]) Clone[U any]() Box[U] { ... } // ❌
```

The spec forbids method-level type parameters entirely. This applies to recursive contexts too: you cannot define a method with its own recursive parameter.

### 4. Comparable in a recursive bound

```go
type Eq[T comparable] interface { Equal(other T) bool }
```

This is fine. But:

```go
type Eq[T Eq[T]] interface { Equal(other T) bool }
```

Embedding the recursive bound directly in the interface is valid syntax but produces a constraint that is hard to satisfy and harder to reason about. The spec accepts; lints often warn.

---

## Constraint type inference and recursion

The spec section on **Type inference** describes a multi-step algorithm. Step 2 — **constraint type inference** — propagates information from the constraint:

> If type parameter T's constraint mentions another type parameter U, and there is enough information to determine U from T (or vice versa), the compiler attempts to infer U.

For recursive constraints, this step often does little extra work: if `T Cloner[T]`, the constraint's `T` is already the parameter being inferred. There is no second variable to derive.

### When constraint inference helps

For two-parameter recursive constraints:

```go
func F[A Pairable[A, B], B any](a A) B { ... }
```

If the call provides only `A = Foo`, constraint inference looks at `Foo`'s `Pair` method to derive `B`. This is the case where constraint type inference has measurable impact.

### When inference fails

If `B` appears only inside the constraint and is not pinned by any argument or by any method on `A`, inference reports failure:

```
cannot infer B
```

The user must instantiate explicitly. No spec rule forbids this — the spec just says "inference may fail".

---

## Predeclared interactions

### `comparable`

A recursive constraint can embed `comparable`:

```go
type EqualCloner[T any] interface {
    comparable
    Clone() T
}

func F[T EqualCloner[T]](a, b T) bool {
    return a == b
}
```

The spec allows this. `EqualCloner[T]` is the **intersection** of `comparable` and `interface{ Clone() T }`.

### `any`

`any` adds nothing to a recursive interface (since `any` is the empty interface). But:

```go
type Cloner[T any] interface { Clone() T }
```

The `any` here is the **outer** parameter's constraint, not the recursion's. It says "T can be any type"; the recursion is established by `Cloner[T]` referring to itself.

### `cmp.Ordered`

A recursive interface cannot directly embed `cmp.Ordered` and expect both type-element and method-element semantics together cleanly:

```go
type Sortable[T any] interface {
    cmp.Ordered
    Less(other T) bool
}
```

This compiles. The constraint demands a type whose underlying type is integer/float/string AND has a `Less(T)` method. Such types are rare.

---

## Spec reading exercise

Read this signature:

```go
func DupAll[T Cloner[T]](xs []T) []T
```

Translate it spec-by-spec:

1. **Type parameter list** `[T Cloner[T]]` — one parameter named `T` with constraint `Cloner[T]`.
2. **Constraint** `Cloner[T]` — instantiate the generic interface `Cloner` with `T` as the type argument. Result: an interface `interface { Clone() T }`.
3. **Function parameter** `xs []T` — slice of `T`.
4. **Return** `[]T` — slice of `T`.

At a call site `DupAll(myFoos)`:

1. Argument has type `[]Foo`. By function argument type inference, `T = Foo`.
2. Substitute `T = Foo` into the constraint: `interface { Clone() Foo }`.
3. Check that `Foo` satisfies this. (Method set check.)
4. If yes, instantiate `DupAll` with `T = Foo` and compile.

The recursion is invisible at the spec level; it is a consequence of the substitution.

---

## Summary

The Go specification does **not** mention F-bounded polymorphism by name. The recursive-constraint pattern is a natural consequence of three orthogonal spec rules:

1. **Constraints are interfaces.**
2. **Generic interfaces can be instantiated with any type, including a type parameter.**
3. **Substitution replaces type parameters textually with type arguments.**

Combine them and `[T Cloner[T]]` is just an instantiation that happens to use the parameter being constrained as its argument. The spec accepts this with no special rules.

Limits do exist:

- True cycles in type definitions are rejected.
- Method-level type parameters are forbidden.
- Inference may fail when type parameters appear only in recursive constraints.

For day-to-day Go work you will not consult the spec for recursive constraints — but when you do, the relevant sections are **Type parameters**, **Type constraints**, **General interfaces** (type sets), and **Implementing an interface**. The `interview.md` file drills the questions a senior interviewer might ask about these spec interactions.
