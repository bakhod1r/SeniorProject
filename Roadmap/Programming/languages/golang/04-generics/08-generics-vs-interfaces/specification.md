# Generics vs Interfaces — Specification

## Table of Contents
1. [Source of truth](#source-of-truth)
2. [Type sets — the unifying idea](#type-sets-the-unifying-idea)
3. [Interfaces as type sets](#interfaces-as-type-sets)
4. [Type parameters as named members of a type set](#type-parameters-as-named-members-of-a-type-set)
5. [Constraints are interfaces](#constraints-are-interfaces)
6. [Interface satisfaction vs constraint satisfaction](#interface-satisfaction-vs-constraint-satisfaction)
7. [Method sets, type elements, and dispatch](#method-sets-type-elements-and-dispatch)
8. [What the spec forbids in each direction](#what-the-spec-forbids-in-each-direction)
9. [Summary](#summary)

---

## Source of truth

The Go spec covers both tools in adjacent sections:

- <https://go.dev/ref/spec#Interface_types> — interfaces
- <https://go.dev/ref/spec#Type_parameters> — type parameters
- <https://go.dev/ref/spec#Type_constraints> — constraints
- <https://go.dev/ref/spec#General_interfaces> — interfaces with type elements

Two Go blog posts ground the discussion:

- <https://go.dev/blog/intro-generics>
- <https://go.dev/blog/when-generics>

This file uses paraphrased excerpts; consult the live spec for the canonical wording.

---

## Type sets — the unifying idea

The Go spec introduces a single concept that unifies both tools: a **type set**.

> The type set of an interface type is the set of types that satisfy the interface.

Every interface defines a type set. Every constraint (which is itself an interface) defines a type set. Both interfaces in the classical "behaviour" sense and constraints in the "shape" sense are described by the same machinery.

The difference is **where** the type set is consulted:

- **Interface as a type at runtime** — the type set restricts what dynamic types may be assigned to the interface variable.
- **Interface as a constraint** — the type set restricts what type arguments may be supplied to a type parameter.

```go
// Same syntax — different consumption
type Stringer interface { String() string }

var s Stringer = Email{}              // runtime: Email is in Stringer's type set
func F[T Stringer](v T) { v.String() } // compile time: T must be in Stringer's type set
```

This is the single most important spec insight: **both tools are powered by type sets**. The choice of "interface" vs "generic" is really the choice of "consume the type set at runtime or at compile time".

---

## Interfaces as type sets

A classical interface defines its type set by listing methods:

```go
type Reader interface { Read([]byte) (int, error) }
```

Spec wording (paraphrased):

> A type T satisfies an interface if its method set is a superset of the interface's method set.

So `Reader`'s type set is "every type with a `Read` method of the right signature". Any value of such a type can be assigned to a `Reader` variable.

### Adding type elements (Go 1.18+)

Generics extended interfaces to support **type elements**:

```go
type IntFamily interface { int | int32 | int64 }
type AnyTemperature interface { ~float64 }
type SortableNumber interface {
    ~int | ~float64
    Less(other any) bool
}
```

The type set is now described by the **intersection** of:
- The union of type elements (`~int | ~float64`)
- The method set requirements (`Less` method)

Quoting the spec:

> The type set of an interface type T containing type elements is the intersection of the type sets of those elements with the set of all types whose method set includes the methods of T.

---

## Type parameters as named members of a type set

A type parameter is **a name bound to one type from the constraint's type set** at instantiation:

```go
func F[T cmp.Ordered](a, b T) T { ... }

F(1, 2)        // T is bound to int
F(1.0, 2.0)    // T is bound to float64
F("a", "b")    // T is bound to string
```

Each call picks one element of `cmp.Ordered`'s type set. The body of `F` must be valid for **every** element of the set — so the body can use only operations the constraint guarantees (`<`, `<=`, `>`, `>=` for `cmp.Ordered`).

This is fundamentally different from interface variables, which can hold any value from the type set **at runtime**:

```go
var x cmp.Ordered // illegal — cmp.Ordered cannot be used as a runtime type
                  // because of the type-element restriction
```

The spec specifically forbids using interfaces with type elements as runtime types in most contexts. `cmp.Ordered` exists only as a constraint.

---

## Constraints are interfaces

The spec is unambiguous:

> A type constraint is an interface that defines the set of permissible type arguments for the respective type parameter.

There is no separate "constraint" syntactic category. Anything that fits in `[T Constraint]` is an interface. This was a deliberate design choice — the original "contracts" proposal (rejected) introduced a new construct; the accepted proposal **reused interfaces**.

### Three forms of constraint

```go
// Method-only — classical interface
type Stringer interface { String() string }

// Type-only — new in 1.18
type Number interface { ~int | ~float64 }

// Mixed
type Sortable interface {
    ~int | ~float64 | ~string
    Less(other any) bool
}
```

Each form describes a type set. Each form may be used as a constraint **or** (for the method-only form) as a runtime interface type.

### Constraints that cannot be runtime types

Interfaces with **type elements** cannot be used as runtime types:

```go
type IntFamily interface { int | int32 | int64 }

var x IntFamily = 1 // compile error in most contexts
func F[T IntFamily](v T) { ... } // OK as a constraint
```

The spec restricts these "general" interfaces to the constraint position. The reason is operational: at runtime, `==` and other operations need to work on the dynamic type, and the broad type-element form would require runtime checks not present in the language.

---

## Interface satisfaction vs constraint satisfaction

Two distinct relations exist in the spec:

### Implements relation (runtime interfaces)

A type `T` **implements** an interface `I` if `T`'s method set is a superset of `I`'s methods. This is what makes a value of type `T` assignable to a variable of type `I`.

### Satisfies relation (constraints)

A type `T` **satisfies** a constraint `C` if `T` is in `C`'s type set. This is what allows `T` to be a type argument for a parameter constrained by `C`.

For method-only constraints these relations coincide. For constraints with type elements, the two diverge:

```go
type Number interface { ~int | ~float64 }

// "implements" question: is there a runtime use? No — Number cannot be a runtime type.
// "satisfies" question: does int satisfy Number? Yes — int is in the type set.
```

The Go spec distinguishes the two relations precisely. Most Go programmers do not need to think about the distinction unless they hit a compile error like "interface contains type constraints" — that error means "you tried to use a constraint as a runtime type".

---

## Method sets, type elements, and dispatch

### Method set

Each type has a method set computed by the spec rules:

- Concrete type `T`: methods declared on `T`.
- Pointer `*T`: methods declared on `T` and on `*T`.
- Interface type: the methods listed in the interface declaration.

A type satisfies a method-only interface iff its method set covers the interface's methods.

### Type element

Type elements (`int | string`, `~float64`) restrict the **type itself**, independent of methods. They are checked structurally:

- `int | string` matches exactly `int` or `string`.
- `~int` matches every defined type whose underlying type is `int`.
- `int | ~int` is allowed but `int` is redundant — `~int` already covers it.

### Dispatch

Inside a generic function, a method call on `T` is dispatched **statically** if the constraint's method set guarantees the method:

```go
type Stringer interface { String() string }

func F[T Stringer](v T) string { return v.String() }
```

The compiler stencils a body where `String()` is called via a dictionary lookup (because `T` could be any of many types) but the call site itself is direct. With profile-guided optimization, the lookup can be devirtualized for hot paths.

Inside an interface variable, the dispatch is always **dynamic**. The spec does not promise inlinability.

---

## What the spec forbids in each direction

### Forbidden in interfaces (used as runtime types)

1. **Type elements** — `interface { int | string }` cannot be a runtime type.
2. **`comparable` as a runtime variable type** — relaxed in 1.20 with caveats; before 1.20 it was strictly forbidden.
3. **Empty interfaces with type elements** — same as above.

### Forbidden in generics

1. **Method type parameters** — `func (b Box[T]) Map[U any](...)` is illegal.
2. **Operations not implied by the constraint** — `+` requires a numeric constraint, `<` requires `cmp.Ordered`, etc.
3. **Type assertions on a non-interface `T`** — `v.(int)` is illegal if `T any`; use `any(v).(int)`.
4. **Calling `len` on `T any`** — the constraint must include indexable shapes.
5. **Generic type aliases pre-1.24** — `type Vec[T any] = []T` was illegal; now allowed.

### Spec-level guarantees the choices reflect

The spec explicitly aims for:

- **Backward compatibility** — interface code from 2009 must still compile.
- **Predictable type checking** — generics do not require a fancy inference algorithm.
- **Implementability** — the team had to be able to ship it.

These goals are why constraints are interfaces (reuse), why method type parameters are forbidden (implementability), and why type elements are constrained to constraint position (predictability).

---

## Summary

The Go specification frames interfaces and generics as **two consumers of one mechanism**: type sets.

1. Both interfaces and constraints are interfaces; both define type sets.
2. **Runtime interfaces** consume the type set at runtime through dynamic dispatch.
3. **Generic constraints** consume the type set at compile time through type substitution.
4. **Method-only interfaces** can serve in both roles — runtime variable type and constraint.
5. **Interfaces with type elements** are restricted to the constraint role.
6. **The "implements" and "satisfies" relations** are formally distinct; for method-only interfaces they coincide.

The choice between generics and interfaces is not a syntactic choice — both forms are interface declarations. The choice is **where the type set is consumed**: at compile time for static safety, at runtime for late binding.

A reader of the spec who sees a constraint and an interface declaration with identical syntax has the right to ask: "are these the same thing?" The answer is "yes — but they describe a type set; how that type set is used is the design choice." This perspective makes the rest of the topic — performance, evolution, library design — fall into place.

Move on to `interview.md` to drill the most-asked questions about choosing between the two.
