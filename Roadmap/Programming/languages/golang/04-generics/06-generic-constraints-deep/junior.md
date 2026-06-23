# Generic Constraints Deep Dive — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is a constraint, really, and why is it an interface?"

When you write `func F[T any](x T)` the bracketed thing — `T any` — is a **type parameter declaration**. The word `any` is the **constraint**. Many beginners think a constraint is some new kind of language feature: a "constraint thing" that limits what `T` can be. The truth is simpler and more surprising:

> **A constraint is just an interface.**

Go did not invent a new "constraint" concept for generics. Instead, the language **extended interfaces** so that they can carry **type sets** in addition to method sets. Once you internalise this idea, every other constraint pattern in Go falls into place.

```go
// "any" is literally an interface
type any = interface{}

// "comparable" is a special predeclared interface
type comparable interface { /* opaque */ }

// Your own constraints — also interfaces
type Number interface {
    ~int | ~float64
}
```

After reading this file you will:
- Know that **a constraint is an interface** (no exceptions).
- Understand the **type set** that a constraint defines.
- Be able to read `[T comparable]`, `[T any]`, `[T int | string]`.
- Know the difference between a method-bearing constraint and a type-bearing one.
- Recognize the two **predeclared** constraints: `any` and `comparable`.

This file stays at the surface. The next files (`middle.md`, `senior.md`) drill into the deeper machinery.

---

## Prerequisites
- Comfortable Go syntax: variables, slices, maps, basic structs.
- Familiarity with **interfaces** as method sets.
- Read `../04-type-constraints/junior.md` (the introductory constraint tour) or be at ease with `[T any]`, `[T comparable]`.
- Go **1.18+** for the basic feature; **1.21+** for stdlib `cmp.Ordered`.

---

## Glossary

| Term | Definition |
|------|------------|
| **Constraint** | The interface that limits which types a type parameter accepts |
| **Type parameter** | A placeholder name (`T`, `K`) introduced inside `[ ]` |
| **Type set** | The set of types that satisfy a given constraint |
| **Type element** | A type term `int`, `string`, `~float64` inside an interface |
| **Method element** | A method signature `Read(p []byte) (int, error)` inside an interface |
| **Union** | `A \| B` — a type element listing several alternatives |
| **Underlying type** | The "raw" type behind a defined name; `type Age int` has underlying `int` |
| **`~T`** | A term for any type whose underlying type is `T` |
| **`any`** | Predeclared alias for `interface{}` — type set is "all types" |
| **`comparable`** | Predeclared interface — type set is "all strictly comparable types" |
| **Strictly comparable** | A type for which `==` is well-defined for every value |
| **Implementation** | A type satisfies an interface if it is in the interface's type set |

---

## Core Concepts

### 1. A constraint is an interface

Go's spec says it plainly:

> A type constraint is an interface that defines the set of permissible type arguments.

So whenever you see a constraint, ask "where is the interface?" — there is always one, even if it is anonymous:

```go
// Named constraint (interface declared at package scope)
type Number interface {
    ~int | ~float64
}
func Sum[T Number](s []T) T { ... }

// Inline constraint (anonymous interface inside the brackets)
func Sum2[T interface{ ~int | ~float64 }](s []T) T { ... }

// Shorthand when the constraint is a single type element — Go 1.18+
func Sum3[T ~int | ~float64](s []T) T { ... }
```

All three are equivalent. The third form is just sugar for the second.

### 2. What an interface carries

A constraint-interface can contain:

| Element | Example | Meaning |
|---------|---------|---------|
| Method element | `String() string` | Type must have this method |
| Type element (single) | `int` | Type must be exactly `int` |
| Type element (`~`) | `~int` | Underlying type must be `int` |
| Union | `int \| string` | Either of the listed terms |
| Embedded interface | `error` | All requirements of `error` apply |

A constraint can mix methods and types:

```go
type StringerInt interface {
    ~int
    String() string
}
```

This means: the type's underlying type is `int` **and** the type has a `String() string` method.

### 3. Type sets — the unifying idea

Every interface has a **type set**: the set of types that satisfy it.

```go
type any = interface{}
// Type set: every type in the language

type comparable interface { /* opaque */ }
// Type set: every strictly comparable type

type Number interface { ~int | ~float64 }
// Type set: int, float64, and all defined types whose underlying is int or float64
```

A type `X` satisfies the constraint when `X` is in the type set. That is the **only** rule. There is nothing else.

### 4. The two predeclared constraints

Go ships with **two** built-in constraints:

```go
// any — every type passes
func Identity[T any](v T) T { return v }

// comparable — types usable with == and !=
func Eq[T comparable](a, b T) bool { return a == b }
```

`any` is literally `interface{}`. `comparable` is special: you cannot redefine it, and it has been "loosened" since Go 1.20 (more on that in `senior.md`).

### 5. Why use a constraint at all?

If you write `[T any]`, the body cannot use `==`, `<`, or any method. The constraint is what **unlocks** operations:

```go
// Allowed because comparable unlocks ==
func In[T comparable](xs []T, t T) bool {
    for _, x := range xs { if x == t { return true } }
    return false
}

// Not allowed — any does not unlock ==
func In2[T any](xs []T, t T) bool {
    for _, x := range xs { if x == t { return true } } // compile error
    return false
}
```

The constraint is a **contract** between you and the compiler: "I promise the caller's type supports these operations; in exchange, let me write the body using them."

---

## Real-World Analogies

**Analogy 1 — Job posting**

A job posting says "must have a driver's licence". That is a **constraint**. It does not say *which* car you will drive — only that you can drive any car that needs a driver. `comparable` is the same: "must support `==`". It does not say which type — only that the type supports the operation.

**Analogy 2 — Power outlet**

A "Type C" outlet (the round European plug) accepts only Type-C plugs. The outlet is a constraint; the plug is the concrete type. `[T ~int]` is a "Type-int" outlet — any plug whose underlying shape is `int` fits.

**Analogy 3 — Library card**

A library card is a constraint: "anyone with this card can borrow books". The library does not care who you are — only that you have the card. Likewise, the body of a generic function does not care what `T` is, only that `T` satisfies the constraint.

**Analogy 4 — Recipe ingredients**

A recipe says "use any flour". That `any flour` is a union — wheat, rice, almond — but **flour**, not sugar. `int | float64 | string` is the same: a union of allowed alternatives.

---

## Mental Models

### Model 1 — "Constraint = filter on the universe of types"

The universe contains every Go type. A constraint is a **filter**. The filter passes some types and rejects others. The filtered set is the type set.

```
Universe   →   Filter (constraint)   →   Type set
{int, string, []byte, ...}   ~int|~float64   {int, float64, Celsius, MyFloat, ...}
```

### Model 2 — "Constraint = interface with extra power"

A regular interface filters on **methods**. A constraint-interface also filters on **types**. Same mechanism, more keys to filter on.

### Model 3 — "Body is a contract"

Read the body before reading the constraint. What operations does the body need? `+`, `==`, `<`, `len(s)`? Each operation requires the constraint to authorise it. A loose constraint plus a strict body is a compile error.

### Model 4 — "Two ways to satisfy"

A type `X` satisfies an interface in two ways:

1. **By type** — `X` is mentioned in a type element (or its underlying type matches a `~` term).
2. **By methods** — `X` has all the methods listed.

A constraint can require both. Some constraints require only types, some only methods, some both.

---

## Pros & Cons

### Pros

| Benefit | Why it matters |
|---------|----------------|
| **One language feature**, not two | Constraints are interfaces; nothing new to learn structurally |
| **Composable** | Embed an interface inside another to combine constraints |
| **Documented at the type level** | A reader sees the constraint right next to the function name |
| **Compile-time check** | A wrong type argument fails at compile time, not runtime |
| **Predeclared options** | `any` and `comparable` cover most basic needs |

### Cons

| Drawback | Why it matters |
|----------|----------------|
| **Two roles for interfaces** | The same syntax means "method set at runtime" and "constraint at compile time" |
| **Type sets are abstract** | New users find type-set arithmetic non-obvious |
| **`comparable` is special** | It does not behave exactly like a normal interface |
| **No "negative" constraints** | You cannot say "any type that is *not* a slice" |
| **Constraints proliferate** | Easy to invent a one-off constraint for every helper |

---

## Use Cases

Constraints shine when you need to:

1. **Permit only numeric types** — `~int | ~int64 | ~float64`.
2. **Allow only ordered types** — `cmp.Ordered`.
3. **Allow only comparable types** — `comparable`.
4. **Require a method** — `interface { String() string }`.
5. **Require both a type shape and a method** — `~int; String() string`.
6. **Express domain types** — `~UUID`, `~OrderID`.

You do **not** need a constraint when:

1. The body works for any type (`any` is fine).
2. The constraint becomes harder to read than three duplicate functions.

---

## Code Examples

### Example 1 — `any` and `comparable`

```go
package main

import "fmt"

func Last[T any](s []T) T {
    var zero T
    if len(s) == 0 { return zero }
    return s[len(s)-1]
}

func IndexOf[T comparable](s []T, target T) int {
    for i, v := range s {
        if v == target { return i }
    }
    return -1
}

func main() {
    fmt.Println(Last([]int{1, 2, 3}))         // 3
    fmt.Println(IndexOf([]string{"a","b"}, "b")) // 1
}
```

### Example 2 — A union constraint

```go
type IntegerLike interface {
    int | int32 | int64
}

func Triple[T IntegerLike](v T) T { return v * 3 }
```

This rejects `float64`, `string`, and `Celsius` (because `~int` would be needed to admit `Celsius`).

### Example 3 — A method-only constraint

```go
type Stringer interface {
    String() string
}

func Describe[T Stringer](xs []T) []string {
    out := make([]string, len(xs))
    for i, x := range xs { out[i] = x.String() }
    return out
}
```

This is just a regular interface used as a constraint. Nothing new.

### Example 4 — Mixed constraint

```go
type IntStringer interface {
    ~int
    String() string
}

type UserID int
func (u UserID) String() string { return fmt.Sprintf("user/%d", int(u)) }

func Tag[T IntStringer](v T) string { return v.String() }
```

The constraint requires both an integer underlying type **and** a `String` method.

### Example 5 — Predeclared `comparable` in a map helper

```go
func GroupBy[T any, K comparable](items []T, key func(T) K) map[K][]T {
    out := make(map[K][]T)
    for _, item := range items {
        k := key(item)
        out[k] = append(out[k], item)
    }
    return out
}
```

`K` must be `comparable` because Go map keys must be. `T` does not need any constraint — it is just data.

### Example 6 — Constraint inline vs named

```go
// Inline (one-shot)
func Add1[T interface{ ~int | ~float64 }](a, b T) T { return a + b }

// Named (reusable)
type Numeric interface { ~int | ~float64 }
func Add2[T Numeric](a, b T) T { return a + b }
```

Both compile to the same thing. Prefer named constraints when the same shape is reused.

---

## Coding Patterns

### Pattern 1 — Pick the loosest constraint

Start with `any`. Tighten only when the body needs more. `Last[T any]` is fine. `IndexOf[T comparable]` is needed because the body uses `==`.

### Pattern 2 — Name shared constraints at package scope

```go
type Numeric interface { ~int | ~int64 | ~float64 }
```

Reuse `Numeric` across many helpers in the same package.

### Pattern 3 — Inline tiny one-off constraints

If a constraint is used only once and is short, inline it:

```go
func F[T interface{ ~string }](s T) int { return len(s) }
```

### Pattern 4 — Embed for composition

```go
type Hashable interface {
    comparable
    Hash() uint64
}
```

`Hashable` requires both built-in equality and a custom hash method. Embedding `comparable` reuses its type set.

---

## Clean Code

- **Name constraints with intent**: `Number`, `Stringer`, `OrderID` — not `T1`, `Cons1`.
- **Use single uppercase letters** for type parameters (`T`, `K`, `V`, `E`).
- **Keep constraint names short** when they are widely used (`Numeric` over `NumericalSummableType`).
- **Group constraints** in one file (`constraints.go`) when the package has several.
- **Document non-obvious constraints** with a one-line comment.

```go
// Numeric covers all built-in numeric types and any user-defined
// numeric types whose underlying type is one of them.
type Numeric interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64
}
```

---

## Product Use / Feature

Real product scenarios:

1. **Money math** — `[T Currency]` constraint for typed amounts.
2. **Identifiers** — `[T ~int64 | ~string]` for ID fields.
3. **Aggregations** — `[T Numeric]` for `Sum`, `Avg`, `Min`, `Max` helpers.
4. **Caching** — `[K comparable, V any]` for typed caches.
5. **Validation** — `[T Validatable]` where the constraint demands a `Validate() error` method.

Each constraint is a **contract** that the product feature can rely on at compile time.

---

## Error Handling

Constraints do not change Go's error model. They only change which **types** are allowed at compile time. There is no "constraint error" at runtime — a wrong type is rejected during compilation:

```go
func Sum[T Numeric](s []T) T { ... }

Sum([]string{"a", "b"}) // compile error: string does not implement Numeric
```

The runtime behaviour of the body is unchanged. Errors inside the body still flow through `error` returns as usual.

---

## Security Considerations

- **`any` does not validate input**. Receiving `any` parameters from untrusted sources still requires runtime checks.
- **`comparable` interfaces can panic** at runtime in 1.20+ if the dynamic type is not really comparable (more in `senior.md`).
- **A leaky constraint exposes internal types**. `[T MyInternal]` makes `MyInternal` part of the public API.

---

## Performance Tips

- **Method-bearing constraints** dispatch through the runtime dictionary (mostly invisible cost).
- **Type-bearing constraints** (no methods) compile to a stenciled body and are usually as fast as hand-written code.
- A union of many disparate types may produce more dictionary entries; benchmark hot paths.

For the deep performance discussion see `optimize.md`.

---

## Best Practices

1. **Always remember: a constraint is an interface.**
2. **Use `any` first**; tighten only when needed.
3. **Reuse stdlib constraints** — `comparable`, `cmp.Ordered`.
4. **Name and place reusable constraints** at package scope.
5. **Keep constraints small** — under 10 type elements is a good upper bound.
6. **Document `~T` vs `T` choices** — they look similar, behave differently.
7. **Do not repurpose** runtime interfaces as constraints if they have many methods you do not need.
8. **Test with at least two type arguments** to confirm the constraint is correct.

---

## Edge Cases & Pitfalls

### 1. Methods can appear in a constraint, but the constraint body must still be an interface

```go
// OK: interface
type C interface { ~int; String() string }

// Not OK: not an interface
// type C ~int; String() string  ← not legal
```

Constraints **must** be interface types.

### 2. `comparable` is not the same as `cmp.Ordered`

`comparable` allows `==` and `!=` only. `cmp.Ordered` adds `<`, `<=`, `>`, `>=`. Mixing them up is a classic beginner bug.

### 3. `~T` requires a non-interface `T`

```go
type Num interface { ~int }     // OK
type Bad interface { ~error }   // ❌ — error is an interface
```

You cannot put `~SomeInterface` in a constraint.

### 4. Constraints have no value-level meaning

```go
var c Numeric = 1   // 1.18-1.19: error; 1.20+ may compile but is rarely meaningful
```

A constraint is for **type-checking**, not for storing values. Use a normal interface for runtime polymorphism.

### 5. Empty type set is allowed but useless

```go
type Impossible interface { int; string } // intersection of {int} and {string} is empty
func F[T Impossible]() {} // compiles, but F can never be called
```

The compiler does not flag this. It is a logic bug.

---

## Common Mistakes

1. **Forgetting `~`** when you want to accept defined types.
2. **Using `comparable`** when you really need `cmp.Ordered`.
3. **Mixing methods and unions** without realising the methods apply to **every** type in the union.
4. **Giant unions** — `~int | ~int8 | ~int16 | ...` instead of importing a stdlib constraint.
5. **Treating a constraint as a runtime interface** — storing values in it, calling its methods directly.

---

## Common Misconceptions

- **"Constraints are a new feature."** No — they are interfaces with extra elements.
- **"`any` is different from `interface{}`."** It is an alias.
- **"A constraint can rule out specific types."** No — Go has no negative constraints.
- **"`comparable` includes slices."** No — slices are not strictly comparable.
- **"Constraints are checked at runtime."** No — purely compile-time.

---

## Tricky Points

1. **The `~` operator only works on non-interface types** — you cannot write `~io.Reader`.
2. **A union with methods means each term must have those methods** — see `middle.md`.
3. **`any` and `interface{}` print the same** in `fmt`; the alias is purely cosmetic.
4. **`comparable` was loosened in 1.20** — interface types now satisfy it (with possible runtime panic).
5. **Anonymous constraints** are legal but rarely a good idea past trivial cases.

---

## Test

1. What is a constraint, structurally?
2. Name the two predeclared constraints.
3. What is a type set?
4. What does `~int` mean in a constraint?
5. What does `int | string` mean?
6. What operations does `[T any]` allow inside the body?
7. What operations does `[T comparable]` allow?
8. Can a constraint contain methods?
9. Can a constraint contain both methods and types?
10. Why is a constraint always an interface?

(Answers: 1) an interface; 2) `any`, `comparable`; 3) the set of types satisfying the constraint; 4) any type whose underlying type is `int`; 5) `int` or `string`; 6) only operations not requiring type knowledge — assignment, return, range; 7) `==`, `!=`; 8) yes; 9) yes; 10) the spec defines constraints as interfaces.)

---

## Tricky Questions

**Q1.** Why does this compile?
```go
type C interface { ~int }
func F[T C](v T) { _ = v + 1 }
```
**A.** `~int` puts `T` in a type set where `+` is defined. The compiler permits `+` because every member of the set supports it.

**Q2.** Why does this not compile?
```go
type C interface { int | string }
func F[T C](v T) T { return v + v }
```
**A.** Because `+` is defined for both `int` and `string`, but the compiler also requires the operations to behave **uniformly**. In Go 1.18+ this **does** compile if both types support the same operator with the same semantics — and `+` does for `int` (addition) and `string` (concatenation). The result is a perfectly valid generic function. (This is a famous tricky case — read carefully.)

**Q3.** Is `any` a constraint or an alias?
**A.** Both. `type any = interface{}`. The alias is the empty interface; the empty interface as a constraint allows every type.

**Q4.** Can `comparable` be used as a normal runtime interface?
**A.** No. The compiler treats it specially. You cannot write `var x comparable = 1` and pass it around as you would `var x any`.

**Q5.** What is the type set of `interface{ int; string }`?
**A.** Empty. The intersection of `{int}` and `{string}` is empty. A function with this constraint cannot be instantiated.

---

## Cheat Sheet

```go
// 1. The two predeclared constraints
[T any]            // every type
[T comparable]     // types usable with == / !=

// 2. Type elements
[T int]            // exactly int
[T ~int]           // any type with underlying int

// 3. Unions
[T int | string]
[T ~int | ~float64]

// 4. Method elements
[T interface{ String() string }]

// 5. Mixed
[T interface{ ~int; String() string }]

// 6. Named constraint
type Numeric interface { ~int | ~float64 }
[T Numeric]
```

| Looks like | Actually is |
|------------|-------------|
| `any` | `interface{}` |
| `comparable` | special predeclared interface |
| `~int` | type element with tilde |
| `int \| string` | union of two type elements |
| `T C` | T must be in C's type set |

---

## Self-Assessment Checklist

- [ ] I can state that a constraint is an interface.
- [ ] I can name the two predeclared constraints.
- [ ] I can explain what a type set is.
- [ ] I can read `[T ~int | ~float64]`.
- [ ] I know the difference between `int` and `~int` in a constraint.
- [ ] I have written at least one named constraint at package scope.
- [ ] I know `comparable` is not the same as `cmp.Ordered`.
- [ ] I understand that constraints are checked at compile time, not runtime.

If you ticked at least 6 boxes, move on to `middle.md`.

---

## Summary

A **constraint** in Go is a regular interface, extended with the ability to list **type elements** alongside method elements. Each interface defines a **type set** — the set of types that satisfy it. The two predeclared constraints, `any` and `comparable`, cover the most common needs. Custom constraints are declared exactly like interfaces.

The mental shortcut is: "constraint = interface that may contain types." Once you accept this, everything else — `~T`, unions, mixed constraints, the type-set algebra — is just notation on top of the interface mechanism you already understand.

The next file (`middle.md`) drills into the meat of the system: `~`, unions, methods plus types, and the practical patterns these enable.

---

## What You Can Build

After this section you can build:

1. A **`Numeric` constraint** plus `Sum`, `Avg`, `Min`, `Max` over it.
2. A **`Stringer`-constrained pretty-printer**.
3. A **typed identifier helper** (`UserID`, `OrderID`) constrained by `~int64`.
4. A **constraint-driven validator** demanding a `Validate() error` method.
5. A **typed-key cache** with `[K comparable, V any]`.

---

## Further Reading

- [The Go Spec — Type constraints](https://go.dev/ref/spec#Type_constraints)
- [Type Parameters Proposal](https://go.googlesource.com/proposal/+/HEAD/design/43651-type-parameters.md)
- [`cmp` package](https://pkg.go.dev/cmp)
- [`golang.org/x/exp/constraints`](https://pkg.go.dev/golang.org/x/exp/constraints)
- [An Introduction To Generics — Go blog](https://go.dev/blog/intro-generics)

---

## Related Topics

- **4.4 Type Constraints** — the introductory tour
- **4.6 Generic Constraints Deep Dive** — this file
- **4.13 Comparable and Ordered** — the two flagship constraints in detail
- **3.2 Interfaces** — runtime interface mechanics
- **4.2 Generic Functions** — the syntax around the brackets

---

## Diagrams & Visual Aids

### A constraint, schematically

```
+---------------------------------+
|        Interface (constraint)   |
|                                 |
|   methods:    String() string   |
|   types:      ~int | ~int64     |
|                                 |
|   Type set: { all defined types |
|     whose underlying is int or  |
|     int64 AND that have String  |
|     method }                    |
+---------------------------------+
```

### How a constraint authorises operations

```
Constraint says:   "T is comparable"
Body uses:         a == b
Compiler:          OK — comparable authorises ==
                       
Constraint says:   "T any"
Body uses:         a == b
Compiler:          ERROR — any does not authorise ==
```

### Universe → filter → type set

```
All Go types ─── filter (constraint) ──→ Type set
                                         │
                                         ▼
                                T must be one of these
```
