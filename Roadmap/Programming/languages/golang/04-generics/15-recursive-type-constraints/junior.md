# Recursive Type Constraints — Junior Level

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
> Focus: "What is a self-referential constraint?" and "Why does it solve a real problem?"

Most generic functions you have seen so far take a constraint that does **not** mention the type parameter again: `[T any]`, `[T comparable]`, `[T cmp.Ordered]`. The constraint is a finished thing that tells the compiler "T must be a number" or "T must be comparable".

A **recursive type constraint** is different. The constraint **mentions T itself**. The classic example is a "clone" interface:

```go
type Cloner[T any] interface {
    Clone() T
}
```

Now look at this signature:

```go
func DupAll[T Cloner[T]](xs []T) []T {
    out := make([]T, len(xs))
    for i, v := range xs {
        out[i] = v.Clone()
    }
    return out
}
```

Read the constraint slowly: `T` must satisfy `Cloner[T]`. That means `T` must have a method `Clone() T` — a method that **returns its own type**. The constraint **refers back to T** to express "T returns myself". This is the heart of F-bounded polymorphism, and it is the simplest tool you have for "I want a method that returns my exact concrete type".

After reading this file you will:
- Recognize a self-referential constraint when you see one
- Understand why `Cloner[T]` is more useful than `Cloner` returning `interface{}`
- Write a `DupAll` function that preserves the concrete type
- Avoid the most common type-inference traps

---

## Prerequisites
- Comfortable with `[T any]` and `[T comparable]`
- You can read `func F[T any](x T) T`
- You understand interfaces with method sets
- You have used `cmp.Ordered` at least once

---

## Glossary

| Term | Definition |
|------|------------|
| **Recursive constraint** | A constraint whose body mentions the type parameter being constrained |
| **Self-referential interface** | A generic interface `I[T]` where the methods involve `T` |
| **F-bounded polymorphism** | Academic name for "T is bounded by an interface that mentions T" |
| **Cloner[T]** | The canonical example: `interface{ Clone() T }` |
| **Type identity** | The exact concrete type, not its interface view |
| **Static this-type** | A type that means "the type of the receiver" at compile time |
| **`func DupAll[T Cloner[T]]`** | A function whose constraint loops back to T |
| **Inference loop** | The compiler repeatedly substituting T into the constraint until it stabilises |
| **Self-bound** | A short way of saying "constraint mentions its own parameter" |
| **F-bound** | Same as self-bound, in the academic sense |

---

## Core Concepts

### 1. The basic shape

```go
type Cloner[T any] interface {
    Clone() T
}
```

This is just a generic interface. By itself it is not recursive. It becomes recursive **at the use site**:

```go
func DupAll[T Cloner[T]](xs []T) []T { ... }
```

The constraint `Cloner[T]` reuses the same `T` as the parameter being constrained. The compiler reads it as: "T must implement an interface that promises a `Clone()` method returning T".

### 2. Why "T returning myself" matters

Consider a non-generic alternative:

```go
type Cloner interface {
    Clone() Cloner
}
```

A `Clone()` here returns `Cloner` — an interface. The caller has lost the concrete type. They must type-assert to get it back. With `Cloner[T]`, the concrete type **survives the round trip**:

```go
type User struct{ Name string }
func (u User) Clone() User { return u }

xs := []User{{"Ada"}, {"Linus"}}
ys := DupAll(xs) // ys is []User, not []Cloner
```

That preservation is the whole point.

### 3. Why the constraint must mention T

If you wrote:

```go
func DupAll[T Cloner[any]](xs []T) []T { ... }
```

…the constraint would say "T's `Clone` returns any". A call to `v.Clone()` would give you `any`, not `T`. To assign back into `out[i] = v.Clone()` you would need an assertion, defeating the purpose. The recursion is **what makes `Clone()` strictly typed**.

### 4. A second canonical example — `Comparable[T]`

```go
type Comparable[T any] interface {
    CompareTo(other T) int
}

func Sort[T Comparable[T]](xs []T) {
    // T values can compare to each other and the result is well typed
    ...
}
```

Same idea: `T` knows how to compare to **other Ts**, not to "any value".

### 5. Self-bounds in builder APIs

Fluent builders need each step to return the **concrete builder**:

```go
type Builder[B any] interface {
    Step() B
}

func RunAll[B Builder[B]](b B) B {
    return b.Step().Step()
}
```

`Step` must return the same concrete builder `B` so the next `.Step()` call still has access to the builder's specific methods. Without the recursion, `Step()` would return an interface and you would have lost the chain.

---

## Real-World Analogies

**Analogy 1 — Photocopier**

A photocopier takes a piece of paper and produces another **piece of paper**, not "a generic document". The output type matches the input type. `Cloner[T]` is the same: the output of `Clone()` is the input's exact type.

**Analogy 2 — Inheritance with a twist**

In OOP languages, "this-type polymorphism" means a method declared in a parent class returns the subclass's type. Go does not have inheritance, but recursive constraints simulate the same idea: every concrete type that implements `Cloner[T]` says "my Clone returns me".

**Analogy 3 — A mirror**

A mirror reflects exactly what is in front of it. It does not reflect "a person in general"; it reflects this specific person. Recursive constraints make a generic interface act like a mirror — reflecting the exact concrete type back.

**Analogy 4 — A handshake protocol**

Two parties shaking hands must each be of the same type to fit each other's grip. `Comparable[T]` says: "to compare to me, you must be the same kind of thing I am". The constraint enforces matching shape on both sides.

---

## Mental Models

### Model 1 — "Read the constraint as a contract"

`T Cloner[T]` reads as: "I am asking for a T such that `T` itself promises to produce another T via `Clone()`". The promise points back at the asker.

### Model 2 — "Substitute and check"

When you see `func F[T Cloner[T]]`, mentally substitute the concrete type. If you call `F[User]`, the constraint becomes `User Cloner[User]`, i.e., `User` must implement `interface{ Clone() User }`. Verify that. If yes, the call compiles.

### Model 3 — "Self-bound = static this-type"

Languages like Scala have `this.type`. Go does not. Recursive constraints **simulate** that feature: `Cloner[T]` is what other languages spell as `interface{ Clone() this.type }`.

### Model 4 — "Two questions to ask"

Before reaching for a recursive constraint:
1. Do I need the concrete type to **survive** the call?
2. Is "interface returns interface" not enough?

If both are yes, you need a recursive bound.

---

## Pros & Cons

### Pros

| Benefit | Why it matters |
|---------|----------------|
| **Type identity preserved** | No assertions after `Clone()` or `Step()` |
| **Fluent builders work** | Each `.Method()` keeps access to the concrete type |
| **Compile-time enforcement** | Wrong types caught at instantiation |
| **No `interface{}` glue** | Cleaner signatures than the `Cloner` returning `Cloner` style |

### Cons

| Drawback | Why it matters |
|----------|----------------|
| **Inference can fail** | The compiler sometimes cannot pick T |
| **Verbose call sites** | `func F[T C[T]]` doubles the type parameter list visually |
| **New users confused** | F-bounded polymorphism is a hard concept |
| **Some patterns hit walls** | Nested recursion is rejected |

---

## Use Cases

Recursive constraints shine in:

1. **Cloning** — `Cloner[T]` where the clone must keep the concrete type
2. **Comparable values** — `Comparable[T]` for domain-specific orderings
3. **Fluent builders** — `Builder[B]` chaining methods that return `B`
4. **Self-merging types** — `Merger[T]` where `Merge(other T) T`
5. **State-machine steps** — `Stepper[S]` returning the next concrete state
6. **Equality with method bodies** — `Eq[T] interface{ Eq(other T) bool }`

Recursive constraints are **not** ideal for:

1. Heterogeneous collections (use `interface{}` instead)
2. One-off APIs where the concrete type does not need to survive
3. Beginners' code — the concept is hard to teach

---

## Code Examples

### Example 1 — Cloner and DupAll

```go
package main

import "fmt"

type Cloner[T any] interface {
    Clone() T
}

func DupAll[T Cloner[T]](xs []T) []T {
    out := make([]T, len(xs))
    for i, v := range xs {
        out[i] = v.Clone()
    }
    return out
}

type User struct{ Name string }

func (u User) Clone() User { return User{Name: u.Name} }

func main() {
    xs := []User{{"Ada"}, {"Linus"}}
    ys := DupAll(xs)
    fmt.Println(ys) // [{Ada} {Linus}]
}
```

`ys` has type `[]User`, not `[]Cloner`.

### Example 2 — Comparable and Sort

```go
type Comparable[T any] interface {
    CompareTo(other T) int
}

type Money struct{ Cents int }

func (m Money) CompareTo(other Money) int {
    return m.Cents - other.Cents
}

func Max[T Comparable[T]](a, b T) T {
    if a.CompareTo(b) > 0 {
        return a
    }
    return b
}
```

`Max[Money]` works without ever exposing `Comparable` to the caller.

### Example 3 — A self-merging counter

```go
type Merger[T any] interface {
    Merge(other T) T
}

type Counter struct{ N int }

func (c Counter) Merge(other Counter) Counter {
    return Counter{N: c.N + other.N}
}

func Reduce[T Merger[T]](xs []T, zero T) T {
    acc := zero
    for _, v := range xs {
        acc = acc.Merge(v)
    }
    return acc
}
```

### Example 4 — A tiny fluent builder

```go
type StepBuilder[B any] interface {
    Next() B
}

type IntBuilder struct{ V int }

func (b IntBuilder) Next() IntBuilder { return IntBuilder{V: b.V + 1} }

func RunTwice[B StepBuilder[B]](b B) B {
    return b.Next().Next()
}

func main() {
    out := RunTwice(IntBuilder{V: 0})
    fmt.Println(out.V) // 2
}
```

The chained `.Next().Next()` works because each call returns the concrete `IntBuilder`.

### Example 5 — A function that needs both Cloner and comparable

```go
type CloneEq[T any] interface {
    comparable
    Clone() T
}

func DedupAndClone[T CloneEq[T]](xs []T) []T {
    seen := map[T]struct{}{}
    out := make([]T, 0, len(xs))
    for _, v := range xs {
        if _, ok := seen[v]; ok {
            continue
        }
        seen[v] = struct{}{}
        out = append(out, v.Clone())
    }
    return out
}
```

The constraint mixes a recursive interface with the predeclared `comparable`.

---

## Coding Patterns

### Pattern 1 — Constraint mirrors method shape

If your constraint is `Cloner[T]`, the **only** method named is `Clone() T`. One method per recursive constraint is the cleanest design.

### Pattern 2 — Always pair the constraint with a function that uses T meaningfully

A recursive constraint with no return-of-T body is a smell. The whole point is to chain `T` through the result type.

### Pattern 3 — Free function, not method

Methods cannot have their own type parameters in Go. Put `DupAll`, `Sort`, `RunTwice` at the package level, not on a generic type.

### Pattern 4 — Name the constraint after the method

`Cloner` for `Clone`. `Comparable` for `CompareTo`. `Merger` for `Merge`. Predictable names help readers.

---

## Clean Code

- Name the parameter `T` (or `B` for builders, `S` for states). One letter is fine.
- Keep the recursion shallow. If you find yourself writing `Cloner[Cloner[Cloner[T]]]`, stop.
- Prefer one method per recursive interface.
- Document **why** the constraint is recursive — readers will not figure it out automatically.

```go
// Cloner is satisfied by any type that can clone itself with the
// concrete return type preserved. Use this when the caller needs to
// keep working with the original type after Clone, with no assertions.
type Cloner[T any] interface {
    Clone() T
}
```

---

## Product Use / Feature

Real product scenarios:

1. **Domain object cloning** — DDD aggregates that produce themselves on `Clone()`
2. **Builder DSLs** — query builders, request builders, config builders
3. **Test mocks** — mocks that build themselves on `.With(...)` calls
4. **State machines** — state types that move to "the next state of the same kind"
5. **Custom comparable types** — sort orderings that go beyond `cmp.Ordered`

Each of these used to require either an interface returning `interface{}` (caller assertion) or hand-written per-type code. Recursive constraints unify them.

---

## Error Handling

Recursive constraints do not change Go's error model. But they make method chains safer because the **wrong concrete type cannot sneak in**:

```go
type StepBuilder[B any] interface {
    Next() (B, error)
}

func Run[B StepBuilder[B]](b B) (B, error) {
    next, err := b.Next()
    if err != nil {
        var zero B
        return zero, err
    }
    return next.Next() // still B, not interface{}
}
```

The error path is normal Go. The "happy" path now returns the concrete `B`.

---

## Security Considerations

There is nothing security-specific about recursive constraints. They are a typing tool. But two notes:

1. **Cloning sensitive data** — a `Clone()` that returns `T` does not magically deep-copy secret data. Audit the implementation.
2. **Method visibility** — if `Clone` is exported, callers from other packages can clone. Keep it lowercase if cloning should be internal.

---

## Performance Tips

- A recursive constraint adds **zero** runtime cost beyond what the underlying interface methods cost.
- The compiler still uses GC shape stenciling. The constraint shape does not change runtime performance.
- Method calls on `T Cloner[T]` are direct calls to the concrete `Clone`, not interface dispatch — because by instantiation `T` is concrete.

We dive deeper in `optimize.md`.

---

## Best Practices

1. **Use a recursive bound only when the concrete type must survive.**
2. **Prefer one method per recursive interface.**
3. **Document the recursion** — it confuses readers who have never seen F-bounded polymorphism.
4. **Pair the constraint with a free function** that consumes `T`.
5. **Test instantiation with two concrete types** — recursive constraints sometimes accept fewer types than expected.
6. **Avoid stacking recursive constraints** unless absolutely needed.

---

## Edge Cases & Pitfalls

### 1. The constraint accepts pointer or value receivers, not both

```go
type Cloner[T any] interface{ Clone() T }

type S struct{}

func (s S) Clone() S    { return s } // OK for T = S
func (s *S) Clone() *S  { return s } // OK for T = *S, NOT for T = S
```

Pick one and stick with it.

### 2. Inference may fail

```go
xs := []User{{"Ada"}}
ys := DupAll(xs) // OK — inference works because User implements Cloner[User]
```

But if you have:

```go
ys := DupAll([]User(nil)) // sometimes inference still works
```

…you may need `DupAll[User](nil)` explicitly.

### 3. The interface variant is not the same as the recursive bound

```go
type CloneIface interface { Clone() CloneIface } // not recursive on T
```

`CloneIface` works at runtime but loses the concrete type — exactly what recursive constraints fix.

---

## Common Mistakes

1. **Writing `[T Cloner[any]]` instead of `[T Cloner[T]]`.** The first is broken.
2. **Forgetting the second `T`** — `[T Cloner]` does not compile if `Cloner` is generic.
3. **Putting the recursive method on the wrong receiver type** — value vs pointer.
4. **Trying to nest recursion deeply** — Go usually rejects it.
5. **Using a recursive constraint when an interface return type would do** — over-engineering.

---

## Common Misconceptions

- **"Recursive constraints are a new feature."** They are not — they are a natural consequence of generic interfaces being usable as constraints.
- **"They mean infinite recursion at runtime."** They do not. The recursion is purely in the type system.
- **"They cost performance."** They do not — see `optimize.md`.
- **"Inference is broken for them."** Inference works for the common shapes; it just has limits.

---

## Tricky Points

1. **`T Cloner[T]` versus `T Cloner[*T]`** — wildly different type sets.
2. **Methods on value vs pointer receivers** decide which side of `T` satisfies the constraint.
3. **A non-generic interface with `T`-shaped methods cannot be used recursively** — only generic interfaces can.
4. **Recursive constraints do not chain through composition** — combining two of them is awkward.

---

## Test

1. What is `Cloner[T]` and why is it recursive?
2. What does `func F[T Cloner[T]]` mean?
3. Which method does `Cloner[T]` require?
4. Why is `[T Cloner[T]]` better than `[T Cloner[any]]`?
5. Can a method have its own type parameters in Go?
6. What is F-bounded polymorphism?
7. Give an example of a recursive constraint other than `Cloner`.
8. What happens if `T` does not implement `Cloner[T]` at the call site?

(Answers: 1) interface promising `Clone() T`; recursive because the constraint mentions T; 2) T satisfies an interface that returns T; 3) `Clone() T`; 4) preserves concrete type; 5) no; 6) constraint where T is bounded by an interface mentioning T; 7) `Comparable[T]`, `Merger[T]`, `Builder[B]`; 8) compile error.)

---

## Tricky Questions

**Q1.** Why does this not compile?
```go
type Cloner interface { Clone() Cloner }

func DupAll[T Cloner](xs []T) []T {
    out := make([]T, len(xs))
    for i, v := range xs { out[i] = v.Clone() }
    return out
}
```
**A.** `v.Clone()` returns `Cloner`, not `T`. The assignment to `out[i]` fails. Fix: make the interface generic and use the recursive bound.

**Q2.** Will this work?
```go
type Cloner[T any] interface{ Clone() T }
type Foo struct{}
func (f Foo) Clone() Foo { return f }

ys := DupAll([]Foo{{}}) // ?
```
**A.** Yes. Inference picks `T = Foo`.

**Q3.** What if you write `DupAll[Foo]` explicitly?
**A.** Same result. Explicit instantiation is fine.

---

## Cheat Sheet

```go
// Self-cloning
type Cloner[T any] interface { Clone() T }
func DupAll[T Cloner[T]](xs []T) []T { ... }

// Self-comparing
type Comparable[T any] interface { CompareTo(T) int }
func Max[T Comparable[T]](a, b T) T { ... }

// Self-merging
type Merger[T any] interface { Merge(T) T }
func Reduce[T Merger[T]](xs []T, zero T) T { ... }

// Builder
type Builder[B any] interface { Step() B }
func Run[B Builder[B]](b B) B { ... }
```

---

## Self-Assessment Checklist

- [ ] I can explain F-bounded polymorphism in one sentence.
- [ ] I can write `Cloner[T]` and `DupAll` from scratch.
- [ ] I know why the recursion preserves the concrete type.
- [ ] I can convert an `interface{}`-returning Clone into a recursive bound.
- [ ] I know that methods cannot declare their own type parameters.

If you ticked at least 4 boxes, move on to `middle.md`.

---

## Summary

A **recursive type constraint** is a constraint that mentions its own type parameter. The most common shape is `[T Cloner[T]]`, where `Cloner[T]` is a generic interface defined as `interface{ Clone() T }`. The recursion lets the method **return the concrete type**, not an interface. Without recursion, `Clone()` would return `Cloner`, and the caller would lose the type. Recursive constraints are the Go way of expressing what other languages call **F-bounded polymorphism** or **this-type polymorphism**.

Use recursive constraints when the concrete type must survive across method calls — fluent builders, self-cloning containers, custom comparables. Avoid them when an ordinary `interface{}` return would do, or when the audience is unfamiliar with the pattern.

---

## What You Can Build

After this section you can build:

1. A generic **`Cloner[T]`**-based deep-copy helper.
2. A **`Comparable[T]`** sort that works for domain types.
3. A **`Builder[B]`** fluent builder with type-preserving steps.
4. A **`Merger[T]`** reducer for any monoid-like type.
5. A self-typed **state machine** with `Step() S`.

---

## Further Reading

- [Type Parameters Proposal — Recursive constraints discussion](https://go.googlesource.com/proposal/+/HEAD/design/43651-type-parameters.md)
- [F-bounded polymorphism (Wikipedia)](https://en.wikipedia.org/wiki/Bounded_quantification#F-bounded_quantification)
- [Go specification on Type sets](https://go.dev/ref/spec#General_interfaces)
- [Generics in Go — community articles on recursive bounds](https://go.dev/blog/intro-generics)

---

## Related Topics

- **4.4 Type Constraints** — the constraint system in general
- **4.6 Generic Constraints Deep** — advanced constraint shapes
- **4.11 Methods on Generic Types** — why methods cannot have their own type parameters
- **4.13 Comparable and Ordered** — the predeclared constraints

---

## Diagrams & Visual Aids

### The recursion in one picture

```
T  Cloner[T]
│      │
└──────┘
T must satisfy an interface that itself
mentions T as the return type of Clone.
```

### Interface return vs recursive bound

```
Non-recursive            Recursive bound
-------------            ----------------
type C interface {       type C[T any] interface {
    Clone() C                Clone() T
}                        }

v.Clone() : C            v.Clone() : T
caller assertion         caller keeps concrete
required                 type
```

### Substitution example

```
DupAll[User](xs)  →  T = User
Constraint becomes: User Cloner[User]
i.e. User must have method Clone() User
User has it → call compiles.
```
