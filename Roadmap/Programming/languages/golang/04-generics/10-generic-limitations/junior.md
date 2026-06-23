# Generic Limitations — Junior Level

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
> Focus: "What can generics NOT do?" — the compile-time walls every Go programmer eventually hits.

After learning generics, every Go programmer goes through the same arc: **excitement**, then **confusion**, then **acceptance**. The excitement comes from finally writing `Min`, `Max`, and `Set[T]` without copy-paste. The confusion arrives the first time the compiler refuses code that "should obviously work":

```go
type Box[T any] struct{ v T }

func (b Box[T]) Map[U any](f func(T) U) Box[U] { // refused
    return Box[U]{v: f(b.v)}
}
```

Why does this fail? Because **methods cannot declare their own type parameters**. That is one of three big limitations a junior reader meets:

1. **No method type parameters** — only the receiver type's parameters are visible.
2. **No type-switch on `T` directly** — you must convert through `any` first.
3. **No covariance / contravariance** — `Box[Cat]` is not assignable to `Box[Animal]`.

These are not bugs. They are **deliberate** trade-offs Go's designers chose to keep the language small. Understanding them turns frustration into productive workarounds.

After reading this file you will:
- Recognize the three big compile-time walls of Go generics
- Read a "method type parameter" error and know why it fires
- Understand why a generic container cannot be implicitly converted across element types
- Know the "convert through `any`" trick for type-switching on `T`

---

## Prerequisites
- Basic generics: type parameters, constraints, instantiation
- Familiar with `interface{}` / `any` and type switches
- Comfortable reading compile errors from `go build`
- Go **1.18 or newer**

---

## Glossary

| Term | Definition |
|------|------------|
| **Limitation** | Something the language deliberately refuses to compile |
| **Method type parameter** | A type parameter declared on a method, separate from the receiver's |
| **Receiver type parameters** | The type parameters of the type the method is attached to |
| **Covariance** | "If `Cat` is a `Animal`, then `List[Cat]` is a `List[Animal]`" |
| **Contravariance** | The reverse direction of covariance |
| **Invariance** | What Go has — `List[Cat]` and `List[Animal]` are unrelated types |
| **Type switch** | The `switch x := v.(type)` syntax |
| **Specialization** | Writing a different body for a specific type argument |
| **Higher-kinded type (HKT)** | A type parameter that itself takes a type parameter, like `F[_]` |
| **SFINAE** | C++ "Substitution Failure Is Not An Error" — overload trick Go has no analog for |
| **Structural typing** | Satisfying an interface by shape, not by name |

---

## Core Concepts

### 1. Methods cannot have their own type parameters

The receiver's type parameters are the **only** type parameters a method may use:

```go
type Box[T any] struct{ v T }

// OK — uses only T from the receiver
func (b Box[T]) Get() T { return b.v }

// REFUSED — declares a new type parameter U
func (b Box[T]) Map[U any](f func(T) U) Box[U] { // compile error
    return Box[U]{v: f(b.v)}
}
```

The error you see is roughly:
```
syntax error: method must have no type parameters
```

This is **proposal 47781**, "type parameters in methods". The Go team rejected it for now — adding it would significantly complicate the type system and the runtime. The standard workaround is a free function:

```go
func MapBox[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{v: f(b.v)}
}
```

### 2. You cannot type-switch directly on `T`

This looks reasonable but does not compile:

```go
func Describe[T any](v T) string {
    switch v.(type) { // compile error: T is not an interface
    case int:    return "int"
    case string: return "string"
    }
    return "other"
}
```

`v.(type)` requires `v` to be an interface value. Inside a generic body, `v` has type `T`, which is not an interface. The fix is to **convert through `any`**:

```go
func Describe[T any](v T) string {
    switch any(v).(type) {
    case int:    return "int"
    case string: return "string"
    }
    return "other"
}
```

But notice what just happened: you boxed `v` into an `interface{}`, then dispatched at **runtime**. That is exactly the cost generics were supposed to remove. If you find yourself doing this, the right answer is usually **an interface, not generics**.

### 3. No covariance or contravariance

```go
type Animal interface{ Name() string }
type Cat struct{}
func (Cat) Name() string { return "cat" }

func PrintAll[T Animal](xs []T) { /* ... */ }

cats := []Cat{{}, {}}
PrintAll(cats) // OK — T inferred as Cat

var animals []Animal = cats // compile error
```

`[]Cat` cannot be assigned to `[]Animal`. Each instantiation of a generic type is a **distinct, unrelated** type. A `Box[Cat]` is not a `Box[Animal]` even though `Cat` satisfies `Animal`.

This is **invariance** — the simplest and safest variance discipline. Languages with covariance/contravariance pay for it with extra complexity. Go chose simplicity.

### 4. The three walls in one table

| Limit | Symptom | Workaround |
|-------|---------|------------|
| No method type parameters | "method must have no type parameters" | Free function |
| No type-switch on `T` | "T is not an interface" | Switch on `any(v)` |
| No covariance | Cannot assign `[]Cat` to `[]Animal` | Convert element by element |

### 5. What this section is NOT about

The bugs covered here are **compile-time refusals** — code the compiler rejects. Other surprising behaviour (runtime panics, performance traps, ergonomic snags) lives in `16-generic-pitfalls`. Keep the two mental boxes separate.

---

## Real-World Analogies

**Analogy 1 — A passport stamp**

A passport stamp says "this passport holder may travel". It does not say "this passport holder's children may travel". Methods on a generic type are stamped with the **receiver's** parameters; they cannot mint **new** parameters of their own. A child passport (a method-level type parameter) would need a separate stamp Go does not issue.

**Analogy 2 — A locked toolbox**

A `[]Cat` and a `[]Animal` are two different toolboxes. Even though `Cat` is an `Animal`, the toolbox itself has a unique key. Go refuses to swap one toolbox for the other — too risky. You must take each tool out and put it into the new toolbox by hand.

**Analogy 3 — A vending machine slot**

A type-switch is a vending machine that tests every coin. Inside a generic function, `T` is "the coin type we agreed on at install time" — you do not need the test. To use the test anyway, you must drop the coin back into the **anything-accepting** slot (`any`) first. That defeats the purpose of paying for a typed slot.

**Analogy 4 — Recipe with pre-fixed ingredients**

A generic recipe says "use ingredient T". Once the cook picks T, the steps are fixed. You cannot mid-recipe say "and ingredient U for step 3" — that is method type parameters, which Go refuses to bake.

---

## Mental Models

### Model 1 — "The receiver owns the type parameters"

When you see `func (b Box[T]) F(...)`, only `T` is in scope. Anything else must come from the parameter list of the package or from `any` boxing.

### Model 2 — "Generics are compile-time, type-switch is runtime"

A type-switch needs runtime type info. `T` does not exist at runtime — it has already been replaced. To recover runtime type info you must funnel through `any`, which puts the data back into the runtime world.

### Model 3 — "Each instantiation is a fresh type"

`Box[Cat]` is not "a Box of an Animal". It is its **own** type, born at compile time when `Cat` was supplied. There is no inheritance ladder between instantiations.

### Model 4 — "When the limit hits, ask: is this really polymorphism?"

If you are reaching for method type parameters or type-switching on `T`, you might be trying to do **polymorphism**. The right tool for polymorphism is **interfaces**, not generics. Generics give you parameterism; interfaces give you polymorphism.

---

## Pros & Cons

### Pros (of having limits)

| Benefit | Why it matters |
|---------|----------------|
| **Simpler language** | Less to learn, less to read |
| **Faster compiles** | No HKT inference, no overload resolution |
| **Predictable errors** | The same code never compiles, never silently changes |
| **Clearer diagnostics** | Errors point at one rule, not a chain of inferences |

### Cons

| Drawback | Why it matters |
|----------|----------------|
| **Some patterns require workarounds** | Free functions instead of methods |
| **Type-switch through `any` is wordy** | And reintroduces boxing |
| **No `Functor`/`Monad` abstractions** | HKT-based libraries cannot be ported directly |
| **Verbose conversions across containers** | Element-by-element loops everywhere |

---

## Use Cases

When you should accept a Go limit instead of fighting it:

1. **Mapping a `Box[T]` to `Box[U]`** — write `MapBox[T, U](b, f)` instead of a method.
2. **Branching on type at runtime** — pick **interfaces** with virtual methods.
3. **Sub-typing of containers** — copy or wrap; do not assume covariance.
4. **Plugin / driver patterns** — interfaces, not generics.

When the limit does not actually block you:

1. **Pure data containers** (Stack, Queue, Set) — limits rarely felt.
2. **Algorithmic helpers** (Map, Filter, Reduce) — free functions are idiomatic anyway.
3. **Numeric utilities** — `cmp.Ordered` covers most needs.

---

## Code Examples

### Example 1 — The forbidden method type parameter

```go
package main

type Box[T any] struct{ v T }

// REFUSED:
// func (b Box[T]) Map[U any](f func(T) U) Box[U]

// Workaround — free function:
func MapBox[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{v: f(b.v)}
}

func main() {
    b := Box[int]{v: 3}
    s := MapBox(b, func(n int) string { return "n" })
    _ = s
}
```

### Example 2 — Type-switch via `any`

```go
package main

import "fmt"

func Describe[T any](v T) string {
    switch x := any(v).(type) {
    case int:    return fmt.Sprintf("int %d", x)
    case string: return "string " + x
    default:     return "other"
    }
}

func main() {
    fmt.Println(Describe(7))
    fmt.Println(Describe("hi"))
}
```

### Example 3 — Container invariance

```go
package main

type Animal interface{ Name() string }
type Cat struct{}
func (Cat) Name() string { return "cat" }

func main() {
    cats := []Cat{{}, {}}
    // var animals []Animal = cats // does not compile
    animals := make([]Animal, len(cats))
    for i, c := range cats { animals[i] = c }
    _ = animals
}
```

### Example 4 — Methods that *could* be generic, kept on the type

```go
package main

type Pair[A, B any] struct{ First A; Second B }

// OK — uses only the receiver's type params
func (p Pair[A, B]) Swap() Pair[B, A] {
    return Pair[B, A]{First: p.Second, Second: p.First}
}

func main() {
    p := Pair[int, string]{1, "x"}
    _ = p.Swap()
}
```

### Example 5 — Why type-switch on `T` is a red flag

```go
func Process[T any](v T) {
    switch any(v).(type) {
    case int:    /* ... */
    case string: /* ... */
    }
}
```

If your function only works for a known small set of types, the right design is **an interface** with the right methods, not a generic with a runtime switch.

### Example 6 — Pre-1.24 type alias limitation (cross-link)

```go
// Pre-Go-1.24:
// type Vec[T any] = []T // refused

// Use a type definition instead:
type Vec[T any] []T
```

This is covered in detail in [`14-generic-type-aliases`](../14-generic-type-aliases/junior.md).

---

## Coding Patterns

### Pattern 1 — Free function for "method-with-new-type"

When a method "needs" a new type parameter, lift it to a free function. The call site is only slightly longer.

### Pattern 2 — Convert-through-`any` only at the boundary

If you must type-switch, do it at the **edge** of your generic code. Once inside, stick to `T`'s constraint operations.

### Pattern 3 — Element-by-element when sub-typing is needed

To "convert" `[]Cat` to `[]Animal`, write a small loop. It is cheap and explicit.

### Pattern 4 — Reach for interfaces when limits hurt

If three limits bite in one function, you are probably building polymorphism. Use an interface and let dynamic dispatch do the work.

---

## Clean Code

- **Name the workaround function clearly** — `MapBox`, `MapStack`, `MapList`. Do not hide the type in the body.
- **Avoid `any(v).(type)` when an interface would be cleaner.**
- **One workaround per file** is a smell — consider redesigning.

```go
// Clean
func MapStack[T, U any](s *Stack[T], f func(T) U) *Stack[U] { ... }

// Less clean — hides the limit behind a misleading name
func StackTransform[T, U any](s *Stack[T], f func(T) U) *Stack[U] { ... }
```

---

## Product Use / Feature

Real product situations where the limits matter:

1. **HTTP middleware with typed handlers** — you want a method `Use[U]`. Refused. Use a free function `Wrap[T, U]`.
2. **DB query builders** — chain methods like `.Map[U]()` is impossible. Move chain operations to free functions or a fluent builder over `interface{}`.
3. **Reactive streams** — operators like `Map`, `FlatMap` cannot be methods. RxGo and similar libraries provide free-function operators.
4. **Generic options pattern** — `Option[T]` cannot have a method `.Map[U]`. Provide `MapOption(o, f)`.

---

## Error Handling

The limits show up as **compile errors**, not runtime errors. Memorize the wording:

- `method must have no type parameters` — you tried `func (b Box[T]) M[U any](...)`.
- `T is not an interface` — you tried `v.(type)` on a non-interface generic param.
- `cannot use cats (variable of type []Cat) as []Animal value in assignment` — invariance.

When you see one, **stop trying to make the original code compile**. Step back and pick a workaround.

---

## Security Considerations

Two security-relevant points:

1. **`any(v).(type)` reintroduces unchecked input** — if your generic was meant to validate types statically, switching on `any` reopens the door.
2. **Element-by-element copies** of large slices are O(n). Make sure attacker-controlled input cannot cause excessive copies via container conversions.

---

## Performance Tips

- A free-function workaround compiles to **the same code** as a method would have. No perf penalty.
- `any(v).(type)` adds a runtime type check. Avoid it in hot loops.
- Element-by-element container conversion is O(n). For repeated conversions, cache.

A simple rule: **when the limit forces you toward `any`, you have left the fast path**.

---

## Best Practices

1. **Read the error and accept the limit** — do not try to outsmart the compiler.
2. **Lift methods to free functions** when a new type parameter is required.
3. **Use interfaces** for runtime polymorphism, generics for compile-time parameterism.
4. **Treat `any(v).(type)` as a smell** — usually a sign of bad design.
5. **Document workaround helpers** with a comment explaining the underlying limit.
6. **Cross-link** to the relevant chapter (e.g., `14-generic-type-aliases`) in long-form docs.
7. **Do not depend on covariance** — write copy loops up front.
8. **Keep `internal/` workarounds separate** from public API.

---

## Edge Cases & Pitfalls

### 1. The "obvious" Map method

```go
func (b Box[T]) Map[U any](f func(T) U) Box[U] // refused
```

Always lift to a free function.

### 2. Type-switch in a constraint that "should" be enough

```go
func Describe[T int | string](v T) string {
    switch any(v).(type) { // still must funnel through any
    case int:    return "int"
    case string: return "string"
    }
    return ""
}
```

Even with a union constraint, you cannot switch directly on `T`.

### 3. Returning containers across types

```go
func Wrap[T any](v T) Box[T] { return Box[T]{v: v} }

cats := []Cat{{}, {}}
// var boxes []Box[Animal] = ... // not possible from []Cat
```

### 4. Comparing two distinct instantiations

```go
var a Box[int]
var b Box[int64]
// a == b // compile error — different types
```

### 5. Interface methods with type parameters

```go
type Mapper interface {
    Map[U any](...) // ❌ — interfaces cannot have method type parameters either
}
```

This is the same rule from the other side.

---

## Common Mistakes

1. **Trying to add a type parameter to a method** — it never works. Lift it.
2. **Writing `switch v.(type)` on a non-interface generic** — convert via `any` first.
3. **Assuming `[]Cat` is a `[]Animal`** — copy element by element.
4. **Re-implementing a container conversion as if it were free** — it is O(n).
5. **Forgetting that the limit is the same for type aliases pre-1.24** — cross-check the Go version.
6. **Writing a fake "polymorphic" generic** that ends with a type switch — refactor to an interface.
7. **Embedding `comparable` to "fix" a constraint** — comparable is special; you cannot just inherit it.

---

## Common Misconceptions

- **"Methods can have type parameters in Go 1.21+."** No. Still refused as of 1.25.
- **"`any` lets me do anything inside a generic."** It lets you box; it does not unlock new operations on `T`.
- **"Generic containers will eventually be covariant."** No — invariance is the design.
- **"The compiler will optimize my type-switch back to compile-time."** It does not.
- **"I can add HKT with `~` somehow."** No. `~` widens a type element; it does not introduce kinds.

---

## Tricky Points

1. **You can call generic free functions from methods.** That is the canonical workaround.
2. **`any(v)` is cheap** but not free — it boxes if `T` is not pointer-sized.
3. **Constraints don't unlock type switches** — even `[T int | string]` requires `any(v)`.
4. **Some IDEs auto-suggest method type parameters** — they fail at compile time.
5. **`comparable` cannot be embedded in arbitrary interfaces** without restrictions.

---

## Test

1. Why can methods not declare their own type parameters?
2. What error does the compiler give for `func (b Box[T]) Map[U any]`?
3. Why does `switch v.(type)` fail when `v` has type parameter `T`?
4. How do you convert `[]Cat` to `[]Animal`?
5. Is there a workaround for method type parameters?
6. Are different instantiations of the same generic type related?
7. What is "invariance"?
8. Does Go support covariance for generic containers?
9. Where do generic type aliases first work?
10. What is the standard-library proposal number for type parameters in methods?

(Answers: 1) deliberate language design, complexity reasons; 2) "method must have no type parameters"; 3) `T` is not an interface, switch needs runtime type info; 4) element-by-element copy; 5) free function; 6) no, each is a distinct unrelated type; 7) `Container[Sub]` is not assignable to `Container[Super]`; 8) no; 9) Go 1.24; 10) proposal 47781.)

---

## Tricky Questions

**Q1.** Will the following compile?
```go
type Box[T any] struct{ v T }
func (b Box[T]) Get[U any]() U { var u U; return u }
```
**A.** No. Methods cannot declare new type parameters.

**Q2.** Why does this fail?
```go
func F[T any](v T) {
    switch v.(type) { case int: }
}
```
**A.** `T` is not an interface. Use `any(v).(type)`.

**Q3.** Why does this assignment fail?
```go
var s []Animal = []Cat{}
```
**A.** Slices are invariant. Even though `Cat` satisfies `Animal`, `[]Cat` and `[]Animal` are unrelated types.

**Q4.** What if you box first?
```go
var s []any = []Cat{}
```
**A.** Same answer — different element types, no implicit conversion.

**Q5.** Could method type parameters be added later?
**A.** Possibly, but proposal 47781 is currently rejected. The Go team has not committed to a future revival.

---

## Cheat Sheet

```go
// REFUSED — method type parameter
func (b Box[T]) Map[U any](f func(T) U) Box[U] {} // ❌

// OK — free function
func MapBox[T, U any](b Box[T], f func(T) U) Box[U] {} // ✓

// REFUSED — switch on T directly
switch v.(type) {} // ❌ if v has type T

// OK — funnel through any
switch any(v).(type) {} // ✓

// REFUSED — covariance
var xs []Animal = []Cat{} // ❌

// OK — explicit copy
xs := make([]Animal, len(cats))
for i, c := range cats { xs[i] = c }
```

| Limit | Workaround |
|-------|-----------|
| Method type params | Free function |
| Type-switch on T | `any(v).(type)` |
| Covariance | Element-by-element copy |
| Generic type alias (<1.24) | Type definition |

---

## Self-Assessment Checklist

- [ ] I can name the three big limits a junior reader meets.
- [ ] I can read the "method must have no type parameters" error.
- [ ] I know to convert through `any` for type switches inside generics.
- [ ] I know `[]Cat` is not assignable to `[]Animal`.
- [ ] I know each generic instantiation is its own distinct type.
- [ ] I can point a peer to `16-generic-pitfalls` for runtime traps and `14-generic-type-aliases` for alias history.
- [ ] I avoid type-switching on `T` and reach for an interface instead.
- [ ] I understand these limits are deliberate, not bugs.

If you ticked at least 6, move on to `middle.md`.

---

## Summary

Go's generics are a **constrained** feature. The compiler refuses three big things every junior reader eventually tries: method-level type parameters, direct type switches on `T`, and covariant container assignment. Each refusal is intentional — Go's designers prioritise simplicity and predictable error messages over the maximum-power feature set you would find in C++ or Scala.

The good news is that every limit has a **clean workaround**: free functions instead of methods, `any(v).(type)` at the boundary, and explicit copy loops for container conversions. When you hit a limit, recognise it for what it is — a signpost to a small redesign — and the code becomes friendlier than the version you originally tried to write.

Pitfalls that trip you up at runtime live in `16-generic-pitfalls`. The history of generic type aliases (the alias-before-1.24 limit) is detailed in `14-generic-type-aliases`. This file deals only with the **compile-time walls**.

---

## What You Can Build

After this section you can:

1. **Translate any rejected method into a free function** without changing call-site ergonomics.
2. **Build a small `Result[T]` library** that includes a `Map` helper as a free function.
3. **Refactor an `interface{}`-based polymorphic API into either generics or interfaces** depending on whether the per-type behaviour differs.
4. **Diagnose three of the most common generic compile errors** by name.
5. **Explain to a teammate why `[]Cat` is not a `[]Animal`** without hand-waving.

---

## Further Reading

- [Type Parameters Proposal](https://go.googlesource.com/proposal/+/HEAD/design/43651-type-parameters.md)
- [Proposal 47781 — Type parameters in methods](https://github.com/golang/go/issues/47781)
- [Proposal 49085 — Generic type aliases](https://github.com/golang/go/issues/46477)
- [Go FAQ on covariance and generics](https://go.dev/doc/faq#covariant_types)
- [The Go Blog — When to use generics](https://go.dev/blog/when-generics)

---

## Related Topics

- **4.1 Why Generics?** — motivation and history
- **4.11 Methods on Generic Types** — what methods CAN do
- **4.14 Generic Type Aliases** — pre-1.24 alias limit explained
- **4.16 Generic Pitfalls** — runtime/UX traps (separate from this file)
- **3.2 Interfaces** — the right tool when limits push you toward polymorphism

---

## Diagrams & Visual Aids

### The three walls

```
┌───────────────────────────────────────────────┐
│ 1. Methods cannot declare new type params     │
│    func (b Box[T]) M[U any]()  → REFUSED      │
├───────────────────────────────────────────────┤
│ 2. Type-switch on T fails                     │
│    switch v.(type) {}          → REFUSED      │
│    switch any(v).(type) {}     → ALLOWED      │
├───────────────────────────────────────────────┤
│ 3. No covariance                              │
│    []Cat → []Animal            → REFUSED      │
└───────────────────────────────────────────────┘
                    │
                    ▼
              WORKAROUNDS
        (free funcs, any-cast, copy)
```

### Compile-time vs runtime walls

```
COMPILE-TIME WALLS (this file, 10):
  - method type params
  - type-switch on T
  - covariance
  - HKT
  - specialization

RUNTIME TRAPS (file 16):
  - comparable panics
  - shape stenciling perf surprises
  - reflection on T quirks
```

### Where the workarounds live

```
                Original wish              →   Workaround
   ┌─────────────────────────────────────┐      ┌──────────────────────┐
   │ (b Box[T]) Map[U any](f) Box[U]     │ ───→ │ MapBox[T, U](b, f)   │
   │ switch v.(type) (v has type T)      │ ───→ │ switch any(v).(type) │
   │ var xs []Animal = []Cat{...}        │ ───→ │ copy loop            │
   └─────────────────────────────────────┘      └──────────────────────┘
```
