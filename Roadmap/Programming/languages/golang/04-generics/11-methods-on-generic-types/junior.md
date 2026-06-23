# Methods on Generic Types — Junior Level

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
> Focus: "How do I attach a method to a generic type, and what is the receiver syntax?"

When a type carries a type parameter, every method declared on that type must **repeat** that type parameter on the receiver. There is no shortcut. This is the single most important syntactic rule for generic methods in Go.

```go
type Stack[T any] struct {
    data []T
}

// The receiver must say (s *Stack[T]), not (s *Stack)
func (s *Stack[T]) Push(v T) {
    s.data = append(s.data, v)
}

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

The `[T]` after `Stack` in the receiver is **not** a re-declaration of `T` — it is a binding. Inside the method, `T` refers to the same placeholder the type used. At instantiation, `Stack[int]` makes every `T` in every method become `int`.

After reading this file you will:
- Write a method on a generic type with the correct receiver syntax
- Decide between **pointer** and **value** receivers for generic types
- Understand why the receiver list must always be present
- Read `func (b *Box[T, U]) Set(v T, w U)` confidently

---

## Prerequisites
- Generic type declarations (`type Stack[T any] struct { ... }`)
- Method receivers in non-generic Go (`func (s *Slice) Push(v int)`)
- Pointer vs value receivers — basic intuition
- Go 1.18 or newer

---

## Glossary

| Term | Definition |
|------|------------|
| **Receiver** | The `(s *Stack[T])` part — the value the method operates on |
| **Receiver type parameter** | The `[T]` in `(s *Stack[T])` — same `T` as the type's |
| **Pointer receiver** | `*Stack[T]` — method can mutate the value |
| **Value receiver** | `Stack[T]` — method works on a copy |
| **Method set** | All methods reachable on a type (or its pointer) |
| **Instantiation** | Filling type parameters with concrete types: `Stack[int]` |
| **Zero value of T** | `var zero T` — the default for the generic element type |
| **Generic method** | A method on a generic type (Go does **not** allow extra type params here) |

---

## Core Concepts

### 1. The receiver must repeat the type parameters

For a generic type `Foo[T any, U any]`, every method declared on `Foo` must use `Foo[T, U]` as the receiver type:

```go
type Pair[K, V any] struct {
    Key   K
    Value V
}

func (p Pair[K, V]) Swap() Pair[V, K] {
    return Pair[V, K]{Key: p.Value, Value: p.Key}
}
```

If you write `func (p Pair) Swap() ...` (without `[K, V]`), the compiler refuses to compile.

### 2. The names can be different — but don't do that

Technically the receiver can rename the parameters:

```go
func (p Pair[A, B]) Swap() Pair[B, A] { ... }
```

This compiles, but it is confusing. **Use the same names** as the type declaration.

### 3. Pointer vs value receiver — the same rules as before

The choice is the same as in non-generic Go:

- **Pointer receiver** — when the method **mutates** the value or the value is large
- **Value receiver** — when the method is read-only and the value is small

```go
type Counter[T ~int | ~int64] struct {
    n T
}

// Mutates → pointer receiver
func (c *Counter[T]) Inc() { c.n++ }

// Read-only → value receiver
func (c Counter[T]) Get() T { return c.n }
```

### 4. You cannot add NEW type parameters on the method

Go 1.18+ rejects this:

```go
type Box[T any] struct{ v T }

// ❌ NOT allowed — Map cannot introduce its own U
func (b Box[T]) Map[U any](f func(T) U) Box[U] {
    ...
}
```

The workaround is to make `Map` a free function that takes the box as an argument:

```go
func Map[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{v: f(b.v)}
}
```

This is one of the most surprising rules for newcomers. The reasoning: the implementation cost of method type parameters was deemed too high for Go 1.18.

### 5. Methods on instantiated types

Once you write `var s Stack[int]`, the variable `s` has methods specialised to `int`:

```go
var s Stack[int]
s.Push(1)        // T is int here
s.Push("two")    // ❌ compile error — string is not int
```

The compile-time check is exactly what generics are for.

---

## Real-World Analogies

**Analogy 1 — A passport stamp**

When the type says `Stack[T]`, every method signature must carry the same stamp `[T]`. Without the stamp, the method does not "belong" to the type's family.

**Analogy 2 — Form field labels**

A form template has labels (`T`, `U`). Every line you fill in must use the same labels. If you switch to `X` or `Y` halfway through, the form makes no sense.

**Analogy 3 — A guild membership card**

The receiver `(s *Stack[T])` is the membership card. Without `[T]`, the method is not a member of the `Stack` guild — it is just a stray function the compiler refuses to recognise.

**Analogy 4 — Recipe placeholders**

If a recipe calls itself `Bread[Flour]`, every step must say `Flour`. Switching to `Grain` mid-recipe breaks the connection.

---

## Mental Models

### Model 1 — "The receiver borrows, it does not declare"

Inside the receiver `(s *Stack[T])`, `T` is **already in scope** because the type `Stack` declared it. The brackets bind the existing parameter, not introduce a new one.

### Model 2 — "Methods are slots in the type's method table"

Each generic instantiation has its own method table. `Stack[int]` and `Stack[string]` have **different** method tables, even though they share source code.

### Model 3 — "Methods cannot expand the parameter list"

A method may use the type parameters of its receiver but cannot add new ones. The rule is "no method-level T". This is enforced by the compiler.

### Model 4 — "Pointer or value? Same rules as 2009 Go"

Generics did not change the pointer-vs-value choice. Mutation → pointer. Small read-only → value.

---

## Pros & Cons

### Pros

| Benefit | Why it matters |
|---------|----------------|
| **One implementation, many types** | Same code works for `Stack[int]`, `Stack[string]` |
| **Type-safe at compile time** | Wrong type fails to compile |
| **No boxing on method calls** | Calls dispatch directly to the stenciled body |
| **Reads like normal Go** | Once you accept `[T]` on the receiver |

### Cons

| Drawback | Why it matters |
|----------|----------------|
| **Receiver clutter** | Every method repeats `[T, U, ...]` |
| **No method-level type parameters** | Some chained APIs are harder to express |
| **godoc is noisier** | Each method signature shows the parameter list |
| **Refactoring renames many lines** | Adding a parameter touches every method |

---

## Use Cases

Methods on generic types shine for:

1. **Containers** — `Stack[T]`, `Queue[T]`, `Set[T]`, `LRU[K, V]`
2. **Wrappers** — `Optional[T]`, `Result[T]`, `AtomicValue[T]`
3. **Builders** — `Builder[T]` with `WithName`, `WithSize`, fluent chaining
4. **Pairs / tuples** — `Pair[K, V]` with `Swap`, `Apply`
5. **Numeric types** — `Vec3[T ~float64]` with `Dot`, `Cross`, `Length`

They are awkward when the operation needs **a new** type parameter (e.g., `Map(f func(T) U)`) — that has to be a free function.

---

## Code Examples

### Example 1 — Stack with pointer receivers

```go
type Stack[T any] struct {
    data []T
}

func (s *Stack[T]) Push(v T)       { s.data = append(s.data, v) }
func (s *Stack[T]) Len() int       { return len(s.data) }
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

`Push`, `Pop`, and `Len` all bind to the same `T` declared on the type.

### Example 2 — Pair with value receivers

```go
type Pair[K, V any] struct {
    Key   K
    Value V
}

func (p Pair[K, V]) Swap() Pair[V, K] {
    return Pair[V, K]{Key: p.Value, Value: p.Key}
}

func (p Pair[K, V]) String() string {
    return fmt.Sprintf("(%v, %v)", p.Key, p.Value)
}
```

`Swap`'s return type `Pair[V, K]` deliberately reorders the parameters — but inside the receiver they are still `[K, V]`.

### Example 3 — Optional with mixed receivers

```go
type Optional[T any] struct {
    value T
    set   bool
}

func Some[T any](v T) Optional[T] { return Optional[T]{value: v, set: true} }
func None[T any]() Optional[T]    { return Optional[T]{} }

func (o Optional[T]) Get() (T, bool)       { return o.value, o.set }
func (o *Optional[T]) Set(v T)             { o.value = v; o.set = true }
func (o *Optional[T]) Clear()              { var zero T; o.value = zero; o.set = false }
```

Read methods use a value receiver; mutators use a pointer.

### Example 4 — Counter with one numeric constraint

```go
type Counter[T ~int | ~int64] struct {
    n T
}

func (c *Counter[T]) Add(d T) { c.n += d }
func (c Counter[T]) Value() T { return c.n }
```

`T`'s constraint comes from the type, not from each method.

### Example 5 — Fluent builder

```go
type Builder[T any] struct {
    items []T
    label string
}

func NewBuilder[T any](label string) *Builder[T] {
    return &Builder[T]{label: label}
}

func (b *Builder[T]) Add(v T) *Builder[T]   { b.items = append(b.items, v); return b }
func (b *Builder[T]) Label(l string) *Builder[T] { b.label = l; return b }
func (b *Builder[T]) Build() ([]T, string)  { return b.items, b.label }
```

Chained calls work because each method returns `*Builder[T]` — same instantiation.

### Example 6 — A wrong example that does not compile

```go
type Box[T any] struct{ v T }

func (b Box) Get() T { return b.v }   // ❌ missing [T] on receiver
```

Compiler error: "Box requires type arguments". The fix is `(b Box[T]) Get() T`.

---

## Coding Patterns

### Pattern 1 — Constructor outside, methods inside

Use a free function for the constructor, methods on the type for everything else:

```go
func NewStack[T any]() *Stack[T] { return &Stack[T]{} }
func (s *Stack[T]) Push(v T)     { ... }
```

### Pattern 2 — Same parameter names as the type

Always reuse the type's parameter names in the receiver. Never invent new ones.

### Pattern 3 — Use pointer receiver for any container

Containers grow and shrink — they need pointer receivers so `Push` can update the slice header.

### Pattern 4 — Free function for "shape changes"

If a method would need a new type parameter, write it as a free function:

```go
func Map[T, U any](s *Stack[T], f func(T) U) *Stack[U] {
    out := &Stack[U]{}
    for _, v := range s.data { out.Push(f(v)) }
    return out
}
```

---

## Clean Code

- **Use single-letter parameter names** (`T`, `K`, `V`) — match the type declaration.
- **Group methods** logically (constructors, getters, mutators).
- **Avoid mixing receivers** — choose pointer or value consistently within one type.
- **Document the constraint** at the type, not on every method.

```go
// Stack is a LIFO container.
// T is the element type; any value is allowed.
type Stack[T any] struct { ... }

func (s *Stack[T]) Push(v T) { ... } // no need to repeat the doc on every method
```

---

## Product Use / Feature

Real-world product scenarios where methods on generic types matter:

1. **Configuration objects** — `Config[T any]` with `Set`, `Get`, `Watch`
2. **Repository patterns** — `Repo[T Entity]` with `Find`, `Save`, `Delete`
3. **Cache wrappers** — `Cache[K comparable, V any]` with `Get`, `Set`, `Delete`
4. **Pub/sub channels** — `Bus[T any]` with `Subscribe`, `Publish`
5. **Pagination** — `Page[T any]` with `Next`, `HasMore`

Each of these used to require either `interface{}` plus assertions or one type per element.

---

## Error Handling

Generic methods return errors the same way regular methods do:

```go
type Loader[T any] struct {
    fn func() (T, error)
}

func (l Loader[T]) Load() (T, error) {
    return l.fn()
}
```

Inside the body, `T` is just a type — no special error handling rules apply.

---

## Security Considerations

- A method on a generic type is **as exposed** as a method on a non-generic type — `Get` returning `T` does not expose internals unless the type itself is exposed.
- Be careful exporting **mutator** methods on generic containers in libraries — callers can pollute internal state.
- `any` constraints accept everything, including types you might not want — tighten when you can.

---

## Performance Tips

- **Pointer receiver** avoids copying the struct on every call. For containers with slices/maps, this is essential.
- **Value receiver** is fine for tiny structs (one or two scalar fields).
- Method dispatch on instantiated generic types is **direct** — no interface table lookup.
- Be aware that escape analysis sometimes pushes generic receivers to the heap; `optimize.md` covers details.

---

## Best Practices

1. **Always use the same parameter names** in the receiver as in the type declaration.
2. **Choose pointer or value receivers consistently** within one type.
3. **Constructor as a free function** — `func NewX[T any]() *X[T]`.
4. **Do not try to add type parameters to methods** — Go forbids it.
5. **Group methods** by purpose (read-only, mutating, transformer).
6. **Document the constraint** at the type level, not per method.
7. **Use free functions** for operations that change the element type.
8. **Test with at least two type arguments** to ensure the methods really are generic.

---

## Edge Cases & Pitfalls

### 1. Forgetting the bracket list on the receiver

```go
func (s *Stack) Push(v T) { ... }  // ❌
```

The compiler error is "Stack requires type arguments". Add `[T]`.

### 2. Renaming the parameter

```go
type Box[T any] struct{ v T }
func (b Box[X]) Get() X { return b.v }  // legal but confusing
```

Compiles, but readers expect `T`. Don't do this.

### 3. Mixing pointer and value receivers

```go
func (s *Stack[T]) Push(v T) {}
func (s Stack[T]) Pop() T {}  // works, but inconsistent — and Pop on a copy can't update
```

Pick one style per type.

### 4. Calling methods on the un-instantiated type

```go
var s Stack  // ❌
```

You must specify `Stack[int]` or `Stack[string]`.

### 5. Adding a method type parameter

```go
func (b Box[T]) Map[U any](f func(T) U) Box[U] {}  // ❌
```

Make `Map` a free function instead.

---

## Common Mistakes

1. **Writing `Stack` instead of `Stack[T]` in the receiver.**
2. **Renaming the type parameter in the receiver** — confusing.
3. **Trying to declare a method-level type parameter** — not allowed.
4. **Mixing pointer and value receivers** on the same type.
5. **Forgetting to instantiate** the type before using it.
6. **Returning the wrong instantiation** by accident: returning `Box[T]` when you meant `Box[U]`.

---

## Common Misconceptions

- **"The receiver `[T]` is a new declaration."** No, it is a binding to the type's existing `T`.
- **"Generic methods can have their own type parameters."** Not in Go.
- **"Pointer receivers are always faster for generic types."** Only for big or mutating types — same rule as before.
- **"Each generic instantiation gets a different copy of every method."** Conceptually yes, but the compiler stencils per GC shape, sharing bodies across compatible instantiations.

---

## Tricky Points

1. **Receiver parameter names are scoped to the method**. They shadow the type's names if you rename them.
2. **Method values capture the receiver**. `f := s.Push` creates a function value bound to `s` — see `senior.md`.
3. **Pointer methods are not in the value's method set** — same rule as non-generic Go.
4. **A generic interface satisfaction** requires all methods on `*T` if the interface is satisfied by `*T`.
5. **Embedding a generic type** brings its methods, but embedded methods see the receiver as the embedded type, not the outer (covered in `senior.md`).

---

## Test

Try these before continuing.

1. Why must the receiver of a generic-type method include `[T]`?
2. Can a method on `Stack[T]` declare its own `[U any]`?
3. What is the error if you write `(s *Stack) Push(v T)`?
4. When should you use a pointer receiver on a generic type?
5. What does `Stack[int].Push("hi")` produce?
6. How do you write a constructor for a generic type?
7. Can the receiver rename `T` to `X`?
8. Does each instantiation have its own method table?
9. How do you do a `Map(f func(T) U)` on a generic type?
10. Is `var s Stack` legal?

(Answers: 1) so the method binds to the same parameters; 2) no; 3) "Stack requires type arguments"; 4) for mutation or large structs; 5) compile error — string is not int; 6) free function `func NewStack[T any]() *Stack[T]`; 7) yes but please don't; 8) yes conceptually; 9) free function `Map[T, U any](s *Stack[T], f func(T) U) *Stack[U]`; 10) no, you must instantiate.)

---

## Tricky Questions

**Q1.** Will this compile?
```go
type Box[T any] struct{ v T }
func (b Box[A]) Get() A { return b.v }
```
**A.** Yes. The receiver renames `T` to `A` — legal but confusing.

**Q2.** Will this compile?
```go
type Box[T any] struct{ v T }
func (b *Box[T, U]) Get() T { return b.v }
```
**A.** No. `Box` has one type parameter, so the receiver must list exactly one.

**Q3.** Why does `(s *Stack[T]) Pop()` need a pointer receiver?
**A.** It mutates `s.data` (slice header). A value receiver would update a copy.

**Q4.** Can you write `func Methods[T any]() { ... }` on a generic type?
**A.** Methods cannot have their own type parameters. Free functions can.

**Q5.** What is the type of `s.Push` after `s := &Stack[int]{}`?
**A.** `func(int)` — a method value with the receiver bound and `T` resolved to `int`.

---

## Cheat Sheet

```go
// Generic type
type Stack[T any] struct { data []T }

// Pointer receiver — mutating
func (s *Stack[T]) Push(v T) { s.data = append(s.data, v) }

// Value receiver — read-only
func (s Stack[T]) Len() int { return len(s.data) }

// Two type parameters
type Pair[K, V any] struct { K; V }
func (p Pair[K, V]) Swap() Pair[V, K] { ... }

// Constraint on the type
type Counter[T ~int | ~int64] struct { n T }
func (c *Counter[T]) Add(d T) { c.n += d }

// ❌ Method-level type parameters — not allowed
func (b Box[T]) Map[U any](...) ... // compile error

// ✓ Free function instead
func Map[T, U any](b Box[T], f func(T) U) Box[U] { ... }
```

| Form | Notes |
|------|-------|
| `(s *Stack[T])` | Pointer receiver, repeat `[T]` |
| `(s Stack[T])` | Value receiver, repeat `[T]` |
| `(s *Stack)` | Compile error — missing `[T]` |
| `(s Stack[X])` | Legal but renames; avoid |
| `func (...) Map[U any]` | Forbidden in Go |

---

## Self-Assessment Checklist

- [ ] I can write a method on `Stack[T]` with the right receiver syntax.
- [ ] I know why method-level type parameters are not allowed.
- [ ] I can choose between pointer and value receivers for a generic type.
- [ ] I understand that the receiver `[T]` binds to the type's `T`.
- [ ] I can write a constructor for a generic type as a free function.
- [ ] I can implement a fluent builder with chained methods.
- [ ] I know the workaround for "method that changes element type".

If you ticked at least 5 boxes, move on to `middle.md`.

---

## Summary

Methods on generic types in Go follow one core rule: **the receiver must list every type parameter the type declared, in the same order**. Method-level type parameters are explicitly forbidden in Go 1.18+. Pointer vs value receiver follows the same rules as in non-generic Go — pointer for mutation or large structs, value for small read-only operations.

The most common mistakes are forgetting the `[T]` on the receiver and trying to add a new type parameter on a method. Both produce clear compile errors. Once these become muscle memory, generic methods read just like regular Go methods — except they work for an entire family of types.

---

## What You Can Build

After this section you can build:

1. A typed **`Stack[T]`** with `Push`, `Pop`, `Len`, `Peek`.
2. A **`Pair[K, V]`** with `Swap` and string formatting.
3. An **`Optional[T]`** wrapper with `Get`, `Set`, `Clear`.
4. A **fluent `Builder[T]`** with chained methods.
5. A **`Cache[K, V]`** with `Get`, `Set`, `Delete`.
6. A **`Counter[T]`** for numeric domain types.

---

## Further Reading

- [Type Parameters Proposal](https://go.googlesource.com/proposal/+/HEAD/design/43651-type-parameters.md) — section on method declarations
- [Go spec — Method declarations](https://go.dev/ref/spec#Method_declarations)
- [An Introduction To Generics — Go blog](https://go.dev/blog/intro-generics)
- [`slices` and `maps` — generic stdlib types and methods](https://pkg.go.dev/slices)

---

## Related Topics

- **3.2 Methods and Interfaces** — non-generic method receivers
- **4.3 Generic Types & Interfaces** — type declaration syntax
- **4.9 Generic Data Structures** — `Stack`, `Queue`, `Set` in depth
- **4.10 Generic Limitations** — why method-level parameters are forbidden
- **4.12 Stdlib Generic Packages** — `atomic.Pointer[T]`, `sync.OnceValue[T]`

---

## Diagrams & Visual Aids

### Receiver structure

```
type Stack[T any] struct { data []T }
                ↓
func (s *Stack[T]) Push(v T)
         ↑↑↑↑↑↑↑↑
         must repeat the type parameter list
```

### Pointer vs value receiver

```
┌────────────────────┬────────────────────┐
│ pointer receiver   │ value receiver     │
├────────────────────┼────────────────────┤
│ (s *Stack[T])      │ (s Stack[T])       │
│ can mutate         │ works on a copy    │
│ no copy on call    │ copies on each call│
│ preferred for      │ tiny read-only     │
│ containers/builders│ structs            │
└────────────────────┴────────────────────┘
```

### What happens at instantiation

```
source:  type Stack[T any] struct { data []T }
         func (s *Stack[T]) Push(v T) ...
                          ↓
caller:  var s *Stack[int]
                          ↓
compiler stencils:  Push(v int) { ... }
                          ↓
caller:  s.Push(42)  // direct call, no boxing
```
