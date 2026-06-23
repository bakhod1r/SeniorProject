# Why Generics? — Junior Level

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
> Focus: "What is the problem?" and "Why do we need generics?"

For more than a decade Go was a language **without generics**. Teams wrote real, large, production-grade software in Go without them, and many even argued Go did not need them at all. Yet in **March 2022**, with the release of **Go 1.18**, generics finally arrived. Why? Because Go programmers kept hitting the same three walls over and over:

1. **Code duplication** — writing nearly identical functions for `[]int`, `[]string`, `[]float64`, and so on.
2. **Loss of type safety** — using `interface{}` (now `any`) and paying for it with runtime type assertions and bugs.
3. **External tooling** — relying on `go generate` and template-based code generators just to get type-safe collections.

Generics are not a new feature for the sake of fashion. They are a **direct answer** to a problem every Go programmer faces sooner or later: how to write reusable code that is both **type safe** and **performant** at the same time.

```go
// Before generics — three nearly identical functions
func MaxInt(a, b int) int {
    if a > b { return a }
    return b
}

func MaxFloat(a, b float64) float64 {
    if a > b { return a }
    return b
}

func MaxString(a, b string) string {
    if a > b { return a }
    return b
}

// After generics — one function for all ordered types
func Max[T cmp.Ordered](a, b T) T {
    if a > b { return a }
    return b
}
```

The body is the same. Only the type changes. That repetition is what generics eliminate.

After reading this file you will:
- Understand the **three core problems** generics solve
- Recognize when a Go programmer **needs** generics (and when they do not)
- Read a generic function signature and know what `[T any]` means
- Explain to a friend **why** generics took ten years to land in Go

---

## Prerequisites
- Basic Go syntax: variables, functions, slices, maps
- Familiarity with `interface{}` / `any`
- Understanding of `type` declarations and basic structs
- Ability to run `go run main.go` (Go **1.18 or newer**)

---

## Glossary

| Term | Definition |
|------|------------|
| **Generic** | A function or type parameterized by another type |
| **Type parameter** | A placeholder for a real type, declared in `[T ...]` |
| **Type argument** | The actual type that fills a type parameter at the call site |
| **Type constraint** | The interface-like thing that limits what types a parameter can accept |
| **`any`** | The constraint that permits every type (alias for `interface{}`) |
| **`comparable`** | A built-in constraint for types usable with `==` and `!=` |
| **Type inference** | The compiler deducing the type argument from the call site |
| **Instantiation** | Creating a concrete version of a generic by supplying type arguments |
| **Monomorphization** | Compiling one specialized copy per type argument |
| **GC shape stenciling** | Go's actual implementation strategy — one copy per memory layout |
| **Boxing** | Wrapping a concrete value in an interface (heap allocation) |
| **`interface{}`** | The empty interface — the pre-1.18 way to "fake" generics |

---

## Core Concepts

### 1. Problem #1 — Code duplication

Before generics, every "container-like" function had to be written once per type. The Go standard library shipped `sort.Ints`, `sort.Strings`, `sort.Float64s` — three nearly identical pieces of code.

```go
func ContainsInt(s []int, target int) bool {
    for _, v := range s {
        if v == target { return true }
    }
    return false
}

func ContainsString(s []string, target string) bool {
    for _, v := range s {
        if v == target { return true }
    }
    return false
}
```

Two functions, one idea. Now triple that for `float64`, `byte`, custom types — and it explodes.

With generics:

```go
func Contains[T comparable](s []T, target T) bool {
    for _, v := range s {
        if v == target { return true }
    }
    return false
}
```

One function. Same logic. Type safe. No duplication.

### 2. Problem #2 — `interface{}` loses type safety

Before generics, the "DRY" trick was to use `interface{}`:

```go
func Contains(s []interface{}, target interface{}) bool {
    for _, v := range s {
        if v == target { return true }
    }
    return false
}
```

This compiles, but four bad things happen:

1. **The caller must wrap every value into `interface{}`** — boxing, heap allocations.
2. **The compiler no longer knows the type** — you can pass `[]any{1, "hello", true}` and it is accepted.
3. **Runtime cost** — `==` on `interface{}` does dynamic dispatch.
4. **Bugs slip through** — `Contains([]any{1,2,3}, "1")` happily returns `false` instead of refusing to compile.

Generics give you the same single function **and** the compiler still checks types.

### 3. Problem #3 — External code generation

Before generics, performance-critical generic-like code was generated with `go generate` plus tools like [genny](https://github.com/cheekybits/genny) or homemade templates. Build pipelines became fragile, IDEs got confused, and the code generator was Yet Another Thing to maintain.

Generics make that whole tooling layer **unnecessary** for the most common cases.

### 4. The three pillars in one table

| Without generics | With generics |
|------------------|---------------|
| Copy-paste per type | One definition |
| `interface{}` + assertions | Compile-time type check |
| `go generate` templates | Built into the language |
| Heap allocations from boxing | Often stack-allocated |
| Runtime errors | Compile-time errors |

### 5. What generics are NOT

Generics in Go are **not**:
- C++ templates (Go does not have full template metaprogramming)
- Java generics with type erasure (Go preserves type info at compile time, mostly)
- A magic performance booster — sometimes generics are slower than `interface{}` (see `optimize.md`)
- A replacement for interfaces — they coexist

---

## Real-World Analogies

**Analogy 1 — Cookie cutter**

A cookie cutter is shaped like a star. You do not bake one cutter per dough flavour — chocolate, vanilla, ginger all use the same cutter. The cutter is **generic over the dough type**. That is exactly what `func Contains[T comparable]` is: one shape, many dough types.

**Analogy 2 — A slot in a vending machine**

`interface{}` is like a slot that accepts **any** coin: dollar, ruble, yen. The machine has to weigh and inspect each coin at runtime. With generics, you tell the machine **at install time** "this slot takes only euros". No runtime inspection — the slot itself is shaped for euros.

**Analogy 3 — Recipe with placeholders**

Imagine a recipe that says "mix 2 cups of [INGREDIENT]". You can write it once and use it for flour, sugar, rice. `[INGREDIENT]` is a type parameter. Without it, you would copy the recipe a hundred times.

**Analogy 4 — IKEA furniture instructions**

Without generics: a separate booklet for every screw size. With generics: one booklet that says "use screw size T" — then a sticker on the box tells you what T is.

---

## Mental Models

### Model 1 — "Replace the type, keep the code"

Look at any function you wrote that takes `int`. Mentally rename `int` to `T`. If the body still makes sense, it is a generic candidate.

### Model 2 — "Compile-time placeholder"

A type parameter is a **placeholder** the compiler fills in **before** running the program. By the time your code executes, all `T`s have already become real types. There is no runtime "T".

### Model 3 — "Generics are interfaces' static cousin"

Interfaces dispatch at runtime; generics dispatch at compile time. Same goal — one function, many types — different timing.

### Model 4 — "Two questions to ask"

Before reaching for generics, ask:
1. Am I writing **the same logic** for multiple types?
2. Does that logic care **only** about a small set of operations (`==`, `<`, etc.)?

If both answers are yes, generics are likely the right tool. If you need polymorphic behaviour (different methods for different types), interfaces are still the right answer.

---

## Pros & Cons

### Pros

| Benefit | Why it matters |
|---------|----------------|
| **Type safety** | Bugs caught at compile time |
| **Less code** | DRY — one definition per algorithm |
| **No boxing** | Often avoids heap allocation |
| **Better IDE support** | Autocomplete knows the concrete type |
| **No code generators** | Simpler build pipeline |

### Cons

| Drawback | Why it matters |
|----------|----------------|
| **Slower compile** | Each instantiation is extra work |
| **Larger binaries** | Some generics produce duplicate code |
| **Harder to read** | `func F[T any, U comparable]` adds noise |
| **Easy to over-use** | Not every function needs to be generic |
| **GC shape stenciling surprises** | Generic code with pointers can be slower than expected |

---

## Use Cases

Generics shine in:

1. **Container types** — stacks, queues, sets, trees, linked lists
2. **Algorithms over collections** — `Map`, `Filter`, `Reduce`, `Sort`, `Find`
3. **Numeric utilities** — `Min`, `Max`, `Sum`, `Abs`, `Clamp`
4. **Type-safe caches** — `Cache[K comparable, V any]`
5. **Result wrappers** — `Result[T any]`, `Option[T any]`
6. **Database query helpers** — `QueryOne[T]`, `QueryAll[T]`

Generics are **not** ideal for:

1. Single-type functions
2. Code with truly different per-type behaviour (use interfaces)
3. Public APIs where the abstraction adds confusion
4. Hot paths where benchmark shows interface dispatch is faster

---

## Code Examples

### Example 1 — The classic `Min` and `Max`

```go
package main

import (
    "cmp"
    "fmt"
)

func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}

func Max[T cmp.Ordered](a, b T) T {
    if a > b { return a }
    return b
}

func main() {
    fmt.Println(Min(3, 5))           // 3
    fmt.Println(Max(2.5, 1.1))       // 2.5
    fmt.Println(Min("apple", "pear")) // apple
}
```

### Example 2 — Generic `Filter`

```go
func Filter[T any](s []T, keep func(T) bool) []T {
    out := make([]T, 0, len(s))
    for _, v := range s {
        if keep(v) {
            out = append(out, v)
        }
    }
    return out
}

func main() {
    nums := []int{1, 2, 3, 4, 5}
    even := Filter(nums, func(x int) bool { return x%2 == 0 })
    fmt.Println(even) // [2 4]
}
```

### Example 3 — Generic `Map` (transform)

```go
func Map[T, U any](s []T, f func(T) U) []U {
    out := make([]U, len(s))
    for i, v := range s {
        out[i] = f(v)
    }
    return out
}

func main() {
    words := []string{"go", "rust", "zig"}
    lengths := Map(words, func(s string) int { return len(s) })
    fmt.Println(lengths) // [2 4 3]
}
```

### Example 4 — Generic `Stack`

```go
type Stack[T any] struct {
    data []T
}

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

func main() {
    s := &Stack[int]{}
    s.Push(1); s.Push(2); s.Push(3)
    v, _ := s.Pop()
    fmt.Println(v) // 3
}
```

### Example 5 — Type-safe `Contains`

```go
func Contains[T comparable](s []T, target T) bool {
    for _, v := range s {
        if v == target { return true }
    }
    return false
}

// Compile error — string is not int:
// Contains([]int{1,2,3}, "two")
```

The compiler refuses to compile a wrong call. Compare that to the `interface{}` version, where the wrong call would silently return `false`.

### Example 6 — Comparing pre- and post-1.18 styles

```go
// Pre-1.18 style (still works, but heavier)
func SumAny(s []interface{}) float64 {
    var total float64
    for _, v := range s {
        switch x := v.(type) {
        case int:
            total += float64(x)
        case float64:
            total += x
        }
    }
    return total
}

// Post-1.18 style — clean and type safe
type Number interface {
    ~int | ~float64
}

func Sum[T Number](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}
```

---

## Coding Patterns

### Pattern 1 — Constraint-first design

Decide **what operations** the type needs (`==`, `<`, `+`) before writing the function. The constraint shapes the API.

### Pattern 2 — `any` until proven otherwise

Start with `[T any]`. Tighten the constraint only when the body actually needs `==` or `<`.

### Pattern 3 — Helper, not architecture

Generics are excellent **at the leaves** of a program (utilities, collections). They are usually a poor fit at the architectural top (use interfaces there).

### Pattern 4 — Pair with `cmp` / `slices` / `maps`

The standard library already provides generic helpers. Use them before writing your own.

```go
import "slices"

idx := slices.Index([]int{10, 20, 30}, 20) // 1
slices.Sort([]string{"b", "a"})            // ["a","b"]
```

---

## Clean Code

- **Name your type parameters meaningfully**: `K` for keys, `V` for values, `T` for "the" type, `E` for element. Single uppercase letters are the convention.
- **One letter is fine**, but `[Element any]` is also OK if it improves clarity.
- **Document the constraint**: a comment such as `// T must be comparable` is redundant when the constraint is `T comparable`, but useful for custom interfaces.
- **Prefer `any` over `interface{}`** in new code (Go 1.18+).

```go
// Clean
func Keys[K comparable, V any](m map[K]V) []K { ... }

// Less clean — what is X?
func Keys[X comparable, Y any](m map[X]Y) []X { ... }
```

---

## Product Use / Feature

Real product scenarios where generics shine:

1. **HTTP handlers with typed payloads** — `Decode[T any](r *http.Request) (T, error)`
2. **Pagination wrappers** — `Page[T any]{Items []T; Total int}`
3. **Configuration loaders** — `LoadConfig[T any](path string) (*T, error)`
4. **Validation pipelines** — `Validate[T any](v T, rules ...Rule[T]) error`
5. **Caches and pools** — `sync.Pool` with type-safe `Get[T]`/`Put[T]`

Each of these used to require either `interface{}` or one copy per type. Generics removed both options.

---

## Error Handling

Generics do not change Go's error model. You still return `error`. But you can build **type-safe `Result`** types:

```go
type Result[T any] struct {
    Value T
    Err   error
}

func Try[T any](f func() (T, error)) Result[T] {
    v, err := f()
    return Result[T]{v, err}
}
```

Beware: it is easy to invent fancy `Option`/`Either` types that **fight** Go's idiomatic `value, err` pattern. Use generic results sparingly.

---

## Security Considerations

Generics themselves do not introduce new security holes, but two things are worth knowing:

1. **`any` is still `interface{}`** — passing untrusted data through an `any` parameter still requires careful validation.
2. **Reflection on generic types** is harder to reason about; if you must reflect, do it on the **instantiated** type.
3. **Avoid leaking internal types** through generic public APIs. A signature like `func Get[T MyInternal]` exposes `MyInternal` to every caller.

---

## Performance Tips

- A generic function over a single concrete type is **as fast** as the hand-written version.
- A generic function over **interface-shaped** types may be slower because of GC shape stenciling — Go shares one compiled body for all pointer-shaped instantiations and uses a hidden dictionary.
- For hot paths, **benchmark** before assuming generics make code faster. Sometimes copy-paste wins on the inner loop.
- Generic types in `slices` and `maps` are heavily optimized — prefer them over hand rolling.

A simple rule: **start with generics, profile if it matters, fall back to specialization only if benchmarks demand it.**

---

## Best Practices

1. **Reach for `any` first**, narrow the constraint only when needed.
2. **Use the stdlib** — `slices`, `maps`, `cmp`, `sync.OnceValue` cover most cases.
3. **One letter per parameter** is idiomatic.
4. **Do not export generic helpers** unless they are genuinely reusable.
5. **Avoid generic "god types"** — `Container[T any]` that does everything is a smell.
6. **Document the constraint** when it is a custom interface.
7. **Test with at least two type arguments** to ensure the function really is generic.
8. **Prefer composition** — many small generic helpers beat one giant one.

---

## Edge Cases & Pitfalls

### 1. The zero value of `T`

Inside a generic function, you cannot write `T{}` for arbitrary `T`. Use `var zero T`:

```go
func First[T any](s []T) T {
    var zero T
    if len(s) == 0 { return zero }
    return s[0]
}
```

### 2. You cannot compare `T any`

`==` is only allowed when `T` is `comparable`:

```go
func Eq[T any](a, b T) bool {
    return a == b // compile error
}

func Eq[T comparable](a, b T) bool {
    return a == b // OK
}
```

### 3. You cannot use `+` without a numeric constraint

```go
func Add[T any](a, b T) T {
    return a + b // compile error
}
```

You need a constraint such as `Number` (custom) or `cmp.Ordered`-shaped.

### 4. `comparable` is not the same as `cmp.Ordered`

`comparable` allows `==`/`!=` only. For `<` you need `cmp.Ordered`. Many beginners mix them up.

### 5. Methods cannot have their own type parameters

Only the receiver type's type parameters are visible. You **cannot** write:

```go
type Box[T any] struct{ v T }
func (b Box[T]) Map[U any](f func(T) U) Box[U] { // ❌ not allowed
    ...
}
```

This is a deliberate design choice in Go 1.18+.

---

## Common Mistakes

1. **Making everything generic.** Most functions take one concrete type and should stay that way.
2. **Using `any` when you really need `comparable`.** Then `==` does not compile.
3. **Forgetting constraints exist** and writing `T any` then trying `a < b`.
4. **Using generics where an interface is cleaner.** If callers want polymorphic behaviour, an interface is better.
5. **Copying old `interface{}` APIs verbatim**. The new generic API may need a different shape.
6. **Naming type parameters poorly** — `[A, B, C, D, E any]` is unreadable.
7. **Re-implementing `slices.Map`** because you did not know it exists in `golang.org/x/exp/slices` (and now in stdlib via `slices.Collect` / `slices.SortedFunc`).

---

## Common Misconceptions

- **"Generics will make my code faster."** Not always. Sometimes slower. Always benchmark.
- **"Generics are templates."** No. Go uses GC shape stenciling, not full monomorphization like C++.
- **"`any` and `interface{}` are different."** They are aliases. `any` is the post-1.18 name.
- **"Generics replace interfaces."** They complement them.
- **"Type parameters work everywhere a normal type works."** Type aliases with type parameters were not allowed until Go 1.24+; method type parameters are still not allowed.
- **"Go's generics are like Java's."** Java erases types; Go does not (it stencils).

---

## Tricky Points

1. **`comparable` includes interface types**, but only if the dynamic type is itself comparable — runtime panic possible.
2. **`~int` vs `int`** — the tilde means "any defined type whose underlying type is `int`". `~int` lets you accept `type Celsius int`.
3. **Type inference is partial** — sometimes you must spell out the type argument: `Foo[int](x)`.
4. **Empty type parameter list `[]` is illegal** — you must declare at least one parameter.
5. **`any` is just an alias** — it does not unlock new behaviour, only reads better.

---

## Test

Test yourself before continuing.

1. Name the three problems generics solve in Go.
2. Which Go version introduced generics?
3. What is a type parameter?
4. What is a type constraint?
5. What does `[T any]` mean?
6. What does `[T comparable]` allow that `[T any]` does not?
7. Why are generics not always faster than `interface{}`?
8. Can a method declare its own type parameters?
9. What is the difference between `any` and `interface{}`?
10. Name three stdlib packages that became generic in Go 1.21.

(Answers: 1) duplication, lost type safety, codegen; 2) 1.18; 3) a placeholder type filled at instantiation; 4) the set of allowed types; 5) "T can be any type"; 6) `==`/`!=`; 7) GC shape stenciling adds dictionary lookups; 8) no; 9) `any` is an alias for `interface{}`; 10) `slices`, `maps`, `cmp`.)

---

## Tricky Questions

**Q1.** Why does this not compile?
```go
func Sum[T any](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}
```
**A.** `+` is not defined for arbitrary `T`. Use a numeric constraint.

**Q2.** Why is this allowed?
```go
func Print[T any](v T) { fmt.Println(v) }
```
**A.** `fmt.Println` takes `any`, so `T` is implicitly converted.

**Q3.** Will `Contains([]any{1, 2, 3}, "1")` compile?
**A.** Yes — both arguments are `any`, so `T = any` is inferred. It returns `false` at runtime. Generics did not help here because the user used `any`.

**Q4.** What is the difference between `[T int]` and `[T ~int]`?
**A.** `int` matches only the exact type `int`. `~int` matches `int` and any defined type whose underlying type is `int` (e.g., `type Age int`).

**Q5.** Can two generic types be assigned to each other if their type arguments differ?
```go
var a Stack[int]
var b Stack[int64] = a // ?
```
**A.** No. Each instantiation is a distinct type.

---

## Cheat Sheet

```go
// Function with one type parameter
func Foo[T any](x T) T { return x }

// Multiple type parameters
func Pair[K comparable, V any](k K, v V) {}

// Constraints
type Number interface { ~int | ~float64 }
func Sum[T Number](s []T) T { ... }

// Generic type
type Box[T any] struct { v T }

// Method on generic type (no own type parameters!)
func (b Box[T]) Get() T { return b.v }

// Instantiation
var s Stack[int]
foo := Foo[string]("hi")

// Inference (preferred when possible)
foo := Foo("hi") // T inferred as string
```

| Symbol | Meaning |
|--------|---------|
| `[T any]` | T can be any type |
| `[T comparable]` | T supports `==` and `!=` |
| `[T cmp.Ordered]` | T supports `<`, `<=`, `>`, `>=` |
| `~int` | Any type whose underlying type is `int` |
| `int \| string` | Either `int` or `string` |

---

## Self-Assessment Checklist

- [ ] I can explain the three problems generics solve.
- [ ] I know which Go version added generics.
- [ ] I can read `func F[T comparable](s []T) bool`.
- [ ] I can convert a copy-pasted "per type" function into a generic one.
- [ ] I know when to **not** use generics.
- [ ] I have used `slices` and `maps` from the stdlib.
- [ ] I understand the difference between `any` and `comparable`.
- [ ] I know that methods cannot have their own type parameters.

If you ticked at least 6 boxes, move on to `middle.md`.

---

## Summary

Generics in Go solve **three** real problems: code duplication, loss of type safety with `interface{}`, and the burden of external code generators. They were added in **Go 1.18 (March 2022)** after years of community demand and several rejected proposals. Generics are not a silver bullet — they sometimes make code slower and harder to read — but for collections, algorithms, and numeric utilities they are now the **idiomatic** choice.

Use them when the same logic is duplicated across types, when type safety matters, and when the alternative would be `interface{}` plus assertions. Avoid them when one concrete type is enough, when an interface is cleaner, or when the resulting signature is harder to read than the original.

---

## What You Can Build

After this section you can build:

1. A generic **`Set[T comparable]`** with `Add`, `Has`, `Remove`, `Union`, `Intersection`.
2. A generic **`LRUCache[K comparable, V any]`**.
3. A generic **`EventBus[T any]`** for typed pub/sub.
4. A generic **`Result[T any]`** wrapper for error-bearing return values.
5. A generic **`Pipeline[T any]`** that chains transformations.
6. A generic **`Tree[T cmp.Ordered]`** binary search tree.

---

## Further Reading

- [The Go 1.18 release notes](https://go.dev/doc/go1.18)
- [An Introduction To Generics — Go blog (2022)](https://go.dev/blog/intro-generics)
- [Why Generics? — Ian Lance Taylor (2019)](https://go.dev/blog/why-generics)
- [Type Parameters Proposal](https://go.googlesource.com/proposal/+/HEAD/design/43651-type-parameters.md)
- [`slices` package documentation](https://pkg.go.dev/slices)
- [`maps` package documentation](https://pkg.go.dev/maps)
- [`cmp` package documentation](https://pkg.go.dev/cmp)

---

## Related Topics

- **3.2 Interfaces** — when to use interfaces instead of generics
- **4.2 Generic Functions** — the syntax in detail
- **4.3 Generic Types & Interfaces** — generic data structures
- **4.4 Type Constraints** — the constraint system in depth
- **4.5 Type Inference** — how the compiler picks the type argument
- **5.x Performance** — measuring generic vs interface dispatch

---

## Diagrams & Visual Aids

### The three walls before generics

```
┌─────────────────────────────────────────────┐
│ Same logic, different type → COPY PASTE     │
├─────────────────────────────────────────────┤
│ One function for all types → interface{}    │
│   → boxing, type assertions, runtime bugs   │
├─────────────────────────────────────────────┤
│ Performance + DRY → go generate templates   │
│   → fragile build, IDE confusion            │
└─────────────────────────────────────────────┘
                     │
                     ▼
              GENERICS (Go 1.18)
```

### Compile time vs runtime polymorphism

```
Generics            : type chosen at COMPILE time
Interfaces          : type chosen at RUN time

  ┌────────────┐         ┌────────────┐
  │ Foo[int]   │         │ var x any  │
  │ Foo[str]   │         │ x = 1      │
  │ Foo[float] │         │ x = "hi"   │
  └────────────┘         └────────────┘
   one func per           one slot,
   type at compile        many runtime
                          shapes
```

### How a generic call is resolved

```
Source:    Max(3, 5)
              │
              ▼
Inference: T = int
              │
              ▼
Stencil:   Max[int](3, 5)
              │
              ▼
Codegen:   one body shared by all int-shaped types
              │
              ▼
Runtime:   regular function call, no boxing
```
