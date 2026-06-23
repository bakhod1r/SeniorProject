# Generics vs Interfaces — Junior Level

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
> Focus: "I have two ways to write reusable code in Go. Which do I pick?"

Go now offers **two** language tools for writing code that works with many types:

1. **Interfaces** — defined since 2009. Describe **behaviour**: "any type with these methods".
2. **Generics** — added in Go 1.18 (March 2022). Describe **shape**: "any type that fits this constraint".

A junior often confuses the two because both let you write "one function for many types". But they answer different questions, run at different times, and produce different code.

Memorize this one rule before anything else:

> **Same code, different types? Use generics.**
> **Different behaviour, same shape? Use interfaces.**

```go
// Same code, different types — generics
func Max[T cmp.Ordered](a, b T) T {
    if a > b { return a }
    return b
}

// Different behaviour, same shape — interfaces
type Notifier interface {
    Notify(msg string) error
}
type Email struct{}
func (Email) Notify(msg string) error { /* SMTP */ return nil }
type Slack struct{}
func (Slack) Notify(msg string) error { /* HTTP */ return nil }
```

Both look "reusable", but they reuse different things. Generics reuse **the body**. Interfaces reuse **the call site**.

After this file you will:
- Know the one-line decision rule
- Recognize when a problem fits generics or interfaces
- Read each style and predict its runtime behaviour
- Avoid the most common beginner trap: using one when the other is the right tool

---

## Prerequisites
- Basic Go: functions, methods, structs
- Comfortable with the syntax `type Foo interface { ... }`
- Basic generic syntax (`func F[T any](x T) T`) — see `01-why-generics`

---

## Glossary

| Term | Definition |
|------|------------|
| **Interface** | A named set of methods; any type with those methods satisfies it |
| **Generic** | A function or type parameterized by another type |
| **Static dispatch** | The function called is decided at compile time |
| **Dynamic dispatch** | The function called is decided at runtime via a v-table |
| **Type parameter** | A placeholder for a type, declared in `[T ...]` |
| **Constraint** | An interface used to limit what types fit a type parameter |
| **Polymorphism** | Different concrete types behaving differently behind one name |
| **Parametric polymorphism** | The "generic" kind — same code, many types |
| **Subtype polymorphism** | The "interface" kind — many types, many behaviours |
| **Boxing** | Wrapping a value in an interface header (heap allocation) |
| **V-table** | Hidden table of method pointers used by interface calls |
| **Heterogeneous slice** | A slice that holds values of different concrete types |

---

## Core Concepts

### 1. The two questions

Look at your function and ask:

1. **Does the code body do the same thing for every type?** → generics.
2. **Does the code call methods that mean different things per type?** → interfaces.

If the body is "iterate, compare, copy, return" — same logic for `int`, `string`, `*User` — that is generics. If the body is "tell this thing to send a notification, and let the thing decide how" — that is interfaces.

### 2. Compile-time vs runtime

```go
// Generic: type chosen at compile time
func Max[T cmp.Ordered](a, b T) T { ... }
Max(1, 2)        // compiler stamps out a Max-for-int
Max("a", "b")    // compiler stamps out a Max-for-string

// Interface: type chosen at runtime
var n Notifier = Email{}
n.Notify("hi")   // method picked from the value at runtime
n = Slack{}
n.Notify("hi")   // a different method runs now
```

The generic call has no runtime "T" — it is gone after compilation. The interface call has a real value at runtime that says "I am an Email" or "I am a Slack".

### 3. The shape of each tool

| | Generics | Interfaces |
|--|----------|------------|
| Reuses | one body | many bodies behind one name |
| Decided | at compile time | at runtime |
| Heterogeneous slice? | no | yes |
| Same body, many types? | yes | no |
| Same name, different bodies? | no | yes |

### 4. Polymorphism in two flavours

Computer science has two big polymorphism families:

- **Parametric** — "this code does not care what the type is". That is generics.
- **Subtype** — "this name groups many types that act differently". That is interfaces.

Go gives you both. Knowing the names helps you Google the right answer.

### 5. They are not enemies

Generics and interfaces **cooperate**:

```go
// Constraint is an interface; the function is generic
type Stringer interface { String() string }

func Join[T Stringer](items []T, sep string) string {
    parts := make([]string, len(items))
    for i, v := range items { parts[i] = v.String() }
    return strings.Join(parts, sep)
}
```

Here the **constraint** is an interface and the **function** is generic. We get type safety on the slice (no `[]Stringer` boxing) and method dispatch on each element (no copy-paste per concrete type).

---

## Real-World Analogies

**Analogy 1 — Cookie cutter vs job interview**

A cookie cutter (generics) is one shape that stamps many doughs. A job interview (interfaces) asks "do you have these skills?" — many candidates pass, but each performs differently on the job.

**Analogy 2 — IKEA boxes vs the front desk**

An IKEA shipping box (generics) is the same box no matter what is inside; the box does not care. The front desk at a hotel (interfaces) asks every guest "what do you need?" and acts differently depending on the answer.

**Analogy 3 — Pipe vs phone**

A water pipe (generics) carries any liquid the same way — water, milk, oil. A phone call (interfaces) means different things on each end — different voice, different language, different message.

**Analogy 4 — Power adapter**

A USB-C cable (generics) is the same cable regardless of what device sits at the other end. A wall socket (interfaces) accepts any plug that fits the socket shape — different devices behind the same socket.

---

## Mental Models

### Model 1 — "Body or behaviour?"

Stare at your function body. Is it the **same code** for every type, just with the type swapped? → generics. Is it **different code** behind the same name? → interfaces.

### Model 2 — "Compile-time stamp vs runtime slot"

Generics are a stamp. The compiler stamps out one copy per type. Interfaces are a slot. At runtime, a value sits in the slot and says "call this method on me".

### Model 3 — "Type erasure vs type preservation"

Interface values **erase** the static type at the call site — you only know it satisfies the interface. Generics **preserve** the static type — inside the function `T` is the exact type the caller provided.

### Model 4 — "Could you put both in a slice together?"

If yes, you want an interface (heterogeneous). If no — every element must be the same type — generics fit better.

```go
var notifiers []Notifier = []Notifier{Email{}, Slack{}} // OK
// var stack Stack[int|string] — illegal; Stack[int] and Stack[string] are different types
```

---

## Pros & Cons

### Generics — Pros

| Benefit | Why it matters |
|---------|----------------|
| Same body once | Less code |
| Compile-time type safety | Bugs caught early |
| No boxing | Often no heap |
| Type-inferring call sites | `Max(1, 2)` — short |

### Generics — Cons

| Drawback | Why it matters |
|----------|----------------|
| Cannot vary behaviour | One body for every type |
| Cannot mix types at runtime | No heterogeneous slices |
| Heavier signatures | Hurts readability of public APIs |

### Interfaces — Pros

| Benefit | Why it matters |
|---------|----------------|
| Per-type behaviour | Polymorphism |
| Heterogeneous collections | `[]Notifier` mixes types |
| Plugin / DI ergonomic | Runtime swap of implementations |
| Stable public API | Add new implementing types without touching consumers |

### Interfaces — Cons

| Drawback | Why it matters |
|----------|----------------|
| Boxing on basic values | `interface{ Foo() }` for `int` allocates |
| Dynamic dispatch | Hidden v-table indirection |
| Type assertions feel runtime-y | Can panic |

---

## Use Cases

**Reach for generics when:**
- Same algorithm for many types (`Map`, `Filter`, `Sum`, `Sort`)
- Type-safe containers (`Stack[T]`, `Set[T]`, `Cache[K, V]`)
- Numeric utilities (`Abs`, `Clamp`, `Min`, `Max`)
- Wrapping helpers (`Atomic[T]`, `Result[T]`, `Page[T]`)

**Reach for interfaces when:**
- Many implementations of the same operation (`Notifier`, `Reader`, `Writer`)
- Heterogeneous collections (`[]error`, `[]Shape`)
- Plugin systems (`http.Handler`, `flag.Value`)
- Dependency injection (`UserRepo` injected into a service)

**Reach for both when:**
- A generic function needs methods on `T` → use an interface as the constraint

---

## Code Examples

### Example 1 — Same code, different types → generics

```go
import "cmp"

func Max[T cmp.Ordered](a, b T) T {
    if a > b { return a }
    return b
}

func main() {
    fmt.Println(Max(3, 5))           // 5
    fmt.Println(Max(2.1, 2.0))       // 2.1
    fmt.Println(Max("apple", "pear")) // pear
}
```

The body is the same for every type. Generics fit perfectly.

### Example 2 — Different behaviour, same shape → interfaces

```go
type Notifier interface {
    Notify(msg string) error
}

type Email struct{ Addr string }
func (e Email) Notify(msg string) error {
    fmt.Println("smtp →", e.Addr, msg)
    return nil
}

type Slack struct{ Channel string }
func (s Slack) Notify(msg string) error {
    fmt.Println("slack →", s.Channel, msg)
    return nil
}

func Alert(n Notifier, msg string) error {
    return n.Notify(msg)
}

func main() {
    Alert(Email{"a@b.c"}, "hello")
    Alert(Slack{"#ops"}, "hello")
}
```

The body of `Notify` differs per type. Interfaces fit.

### Example 3 — Mistake: generics where interfaces belong

```go
// BAD — generic but immediately type-switching
func Notify[T any](v T, msg string) error {
    switch x := any(v).(type) {
    case Email: return x.Notify(msg)
    case Slack: return x.Notify(msg)
    }
    return errors.New("unknown")
}
```

The type switch tells you the real abstraction is "thing with `Notify`". That is exactly an interface. Replace with `func Alert(n Notifier, msg string) error`.

### Example 4 — Mistake: interfaces where generics belong

```go
// BAD — interface{} drops type safety
func Contains(s []interface{}, target interface{}) bool {
    for _, v := range s { if v == target { return true } }
    return false
}
Contains([]interface{}{1,2,3}, "1") // returns false silently
```

The body does not need polymorphism — only `==`. Generics are correct here:

```go
func Contains[T comparable](s []T, target T) bool {
    for _, v := range s { if v == target { return true } }
    return false
}
Contains([]int{1,2,3}, "1") // compile error — good
```

### Example 5 — They cooperate

```go
type Stringer interface { String() string }

func Join[T Stringer](items []T, sep string) string {
    parts := make([]string, len(items))
    for i, v := range items { parts[i] = v.String() }
    return strings.Join(parts, sep)
}
```

`Stringer` is an interface. The function is generic. We get a typed slice **and** behaviour from each element.

### Example 6 — Heterogeneous slice → must be interfaces

```go
type Shape interface { Area() float64 }
type Circle struct{ R float64 }
func (c Circle) Area() float64 { return math.Pi * c.R * c.R }
type Square struct{ S float64 }
func (q Square) Area() float64 { return q.S * q.S }

shapes := []Shape{Circle{1}, Square{2}} // mixed types — only an interface allows this
```

A `[]T` cannot hold both `Circle` and `Square` because they are different types. Only an interface flattens them under one shared identity.

---

## Coding Patterns

### Pattern 1 — "Constraint = interface"

When your generic body needs methods on `T`, use an interface as the constraint. Best of both worlds.

### Pattern 2 — "Container generic, behaviour interface"

Containers like `Set[T]`, `Stack[T]` should be generic. Operations that vary by type (`Notify`, `Read`) should be interfaces.

### Pattern 3 — "Public interface, private generic"

Expose an interface to library users for stability. Implement the body with generics internally. Adding implementations later does not break callers.

### Pattern 4 — "Generic does not mean everywhere generic"

Most code in a real project is not generic and not interface-based. It is plain functions on plain types. Reach for these tools deliberately.

---

## Clean Code

- Pick **one** abstraction per function. Mixing both at the same level confuses readers.
- Name interfaces by the behaviour they describe (`Reader`, `Writer`, `Notifier`).
- Name generic type parameters short (`T`, `K`, `V`).
- Do not export a generic type unless callers actually need to instantiate it themselves.
- Do not export an interface that has only one implementation — concrete is clearer.

```go
// Clean: interface for behaviour
type Logger interface { Log(string) }

// Clean: generic for storage
type Cache[K comparable, V any] struct{ m map[K]V }

// Murky: a generic Logger? rarely a good fit
type Logger[T any] interface { Log(T) } // think twice
```

---

## Product Use / Feature

Real product scenarios where the choice matters:

1. **Notification system** — interface (each channel sends differently).
2. **Typed cache** — generic (every entry follows the same get/set logic).
3. **Logging library** — interface for sinks (file, stdout, syslog), generic for typed loggers.
4. **Repository layer** — interface per aggregate (custom queries), generic for shared `FindByID`.
5. **Event bus** — generic per event type (no `evt.(MyEvent)` cast at the subscriber).
6. **HTTP middleware** — interface (`http.Handler`), composes runtime chains.

---

## Error Handling

`error` is itself an interface in Go: `interface { Error() string }`. That is intentional — many error types behave differently. Trying to make `error` generic over the message type would lose this flexibility.

When you write a generic function that returns an error, the error stays a normal interface:

```go
func Try[T any](f func() (T, error)) (T, error) {
    return f()
}
```

The value channel is generic; the error channel stays interface-shaped.

---

## Security Considerations

- Heterogeneous slices (`[]any`) require validation on read. Generics force a single type and reduce that risk.
- Interface values carry a type tag at runtime; type assertions can panic and leak information through error messages — guard with the `, ok` form.
- Generic public APIs do not introduce new attack surface, but reducing `interface{}` parameters reduces accidental privilege widening.

---

## Performance Tips

- Generic call over `int`, `float64`, `string`: essentially free.
- Interface call: 2 to 5 ns of dispatch overhead per call, plus possible boxing.
- For hot loops, prefer generics. For one-shot calls, the difference is invisible.
- A `[]interface{}` of a million values can allocate a million heap boxes; a `[]int` does not.

A short rule: in tight inner loops, generics; at architectural seams, interfaces.

---

## Best Practices

1. Start with **concrete types**. Reach for either tool only when reuse is real.
2. Choose generics when **the body is identical** for every type.
3. Choose interfaces when **the body differs** per type.
4. Use an **interface as a generic constraint** when the body needs methods on `T`.
5. Do not express dynamic polymorphism with a `switch any(v).(type)` inside a generic.
6. Do not export interfaces with one implementation — concrete is clearer.
7. Keep type parameter lists short; if you have five, you are over-abstracting.

---

## Edge Cases & Pitfalls

### 1. The "fake generic" type switch

```go
func Process[T any](v T) {
    switch any(v).(type) {
    case int: ...
    case string: ...
    }
}
```

This is not generic — it is a hidden interface with extra ceremony. Use a proper interface.

### 2. The "fake interface" copy-paste

```go
type IntCache struct{ m map[string]int }
type StringCache struct{ m map[string]string }
// ... five more identical types ...
```

Each "implementation" is the same logic with the type swapped. Replace with `Cache[K comparable, V any]`.

### 3. Heterogeneous slice via generics

You cannot do `Stack[int|string]`. Each instantiation is a distinct type. For heterogeneous storage, use an interface.

### 4. Interface used purely as `any`

`interface{}` (or `any`) means "every type". If the body needs `==`, use `comparable`. If it needs `<`, use `cmp.Ordered`. If it needs `Foo()`, use an interface with `Foo()`.

---

## Common Mistakes

1. **Reaching for generics first.** Most Go code does not need them.
2. **Reaching for interfaces with one implementation.** That is a smell.
3. **Mixing both inside a generic body via type switch.** That is interfaces in disguise.
4. **Forgetting that interfaces box values.** A million-element `[]Stringer` is a million heap allocations.
5. **Forgetting that generics cannot do heterogeneous collections.**
6. **Putting generics in public API "just in case".** Future flexibility you do not need today.

---

## Common Misconceptions

- **"Generics replace interfaces."** They do not. They solve different problems.
- **"Interfaces are always slower."** Only when boxing or dispatch are on the hot path. Most calls do not care.
- **"Generics are the modern way; interfaces are old."** Both are first-class in modern Go.
- **"`any` and `interface{}` are different."** They are aliases.
- **"You should choose one tool and stick to it."** A real codebase uses both, often together.

---

## Tricky Points

1. **`error` is an interface and stays one** — even in generic Go.
2. **`io.Reader` is an interface and stays one** — different sources read differently.
3. **`slices.Sort` is generic** — every `T` sorts identically given a comparator.
4. **An interface with one method and one implementation is rarely useful.**
5. **A generic with five type parameters is rarely useful.** Both extremes are smells.

---

## Test

Test yourself before continuing.

1. Same code, different types — which tool?
2. Different behaviour, same shape — which tool?
3. Can a `[]T` hold values of different types?
4. Can a `[]Notifier` hold values of different types?
5. When does an interface call allocate?
6. When does a generic call allocate?
7. Can a generic function call a method on `T`?
8. Why is `error` still an interface?
9. Why is `slices.Sort` generic, not interface-based?
10. Can a generic constraint be an interface?

(Answers: 1) generics; 2) interfaces; 3) no; 4) yes; 5) when boxing a non-pointer value; 6) only when the user code does; 7) yes if the constraint declares the method; 8) errors carry per-type behaviour; 9) the body is identical for all comparable types; 10) yes — that is the normal case.)

---

## Tricky Questions

**Q1.** Can `[]Stack[int]` and `[]Stack[string]` be merged?
**A.** No. They are distinct types. To mix, you need an interface that both satisfy.

**Q2.** Can you write `func F[T Notifier](v T)`?
**A.** Yes. The constraint is an interface; the function is generic. You combine both tools.

**Q3.** Why is `func Foo(v any)` not the same as `func Foo[T any](v T)`?
**A.** The first boxes `v` at the call site. The second does not — `T` becomes the caller's actual type.

**Q4.** Will this compile?
```go
type Box[T any] struct{ v T }
var b Box = Box{v: 1}
```
**A.** No. `Box` without `[T]` is incomplete. Write `Box[int]{v: 1}` or rely on inference: `b := Box[int]{v: 1}`.

**Q5.** When would you use both at the same time?
**A.** When a generic function needs to call methods on `T`. Use an interface as the constraint.

---

## Cheat Sheet

```go
// Generic — same body
func Max[T cmp.Ordered](a, b T) T {
    if a > b { return a }
    return b
}

// Interface — different body
type Notifier interface {
    Notify(msg string) error
}

// Both — interface as constraint
func Join[T Stringer](items []T, sep string) string { ... }
```

| Question | Tool |
|----------|------|
| Same body, different types | Generics |
| Different body, same shape | Interfaces |
| Heterogeneous slice | Interfaces |
| Plugin / DI | Interfaces |
| Type-safe container | Generics |
| Method needed on `T` | Generic + interface constraint |

---

## Self-Assessment Checklist

- [ ] I know the one-line decision rule.
- [ ] I can convert a `switch any(v).(type)` into an interface.
- [ ] I can convert a copy-paste-per-type set of types into a generic type.
- [ ] I know why `error` and `io.Reader` stay as interfaces.
- [ ] I can use an interface as a generic constraint.
- [ ] I can give one example of each tool from real code.

If you ticked at least 4 boxes, move on to `middle.md`.

---

## Summary

Generics and interfaces both express reuse, but they answer different questions. Generics are about **shape** — same body, many types. Interfaces are about **behaviour** — many bodies behind one name. Generics decide at compile time; interfaces decide at runtime. Generics cannot hold mixed types in one slice; interfaces can. The two tools cooperate when an interface is used as a generic constraint.

A useful rule for juniors: write the function body first. If you find yourself copying it across types with only the type swapped, generics. If you find yourself writing different bodies that all do "send a notification" or "read bytes", interfaces. If you find a `switch any(v).(type)` inside a generic, you wrote an interface in disguise — back out.

---

## What You Can Build

After this section you can build:

1. A generic `Cache[K, V]` and a `Logger` interface, used together.
2. An event bus that is generic per event type.
3. A repository layer with a generic `FindByID[T]` plus per-aggregate interfaces.
4. A notification system that swaps implementations at runtime.
5. A pipeline of generic transformers backed by an interface chain.

---

## Further Reading

- [The Go blog — When to use generics](https://go.dev/blog/when-generics)
- [Effective Go — Interfaces](https://go.dev/doc/effective_go#interfaces)
- [`io.Reader` documentation](https://pkg.go.dev/io#Reader)
- [`slices` package](https://pkg.go.dev/slices)
- [Russ Cox — Go talks on type parameters](https://research.swtch.com/)

---

## Related Topics

- **3.x Methods and Interfaces** — interface mechanics in detail
- **4.1 Why Generics?** — motivation
- **4.4 Type Constraints** — how to declare constraints
- **4.7 Generic Performance** — raw numbers behind dispatch
- **4.11 Methods on Generic Types** — combining the tools

---

## Diagrams & Visual Aids

### The decision tree

```
       Reusable code needed
                │
   Same body for every type?
        ┌──────┴──────┐
       yes            no
        │              │
   Generics      Different bodies, same shape?
                       │
                  Interfaces
```

### Compile-time vs runtime

```
Generic:
   Source: Max(3, 5)
   Compiler:  → Max[int](3, 5)
   Runtime:   plain function call (no boxing)

Interface:
   Source: n.Notify("hi") with n = Email{}
   Runtime:   v-table lookup → Email.Notify
              boxed value, dynamic dispatch
```

### Heterogeneous vs homogeneous

```
Generic slice []Stack[int]   homogeneous (all int)
Interface  []Notifier        heterogeneous (Email, Slack, ...)
```
