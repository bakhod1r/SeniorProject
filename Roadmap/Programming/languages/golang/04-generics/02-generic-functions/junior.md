# Generic Functions — Junior Level

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
> Focus: "What is it?" and "How to use it?"

Before Go 1.18, if you wanted a function that summed a slice of integers, you wrote `SumInts`. If you also needed to sum floats, you wrote `SumFloats`. The same logic, copied twice. With Go 1.18 the language gained **generic functions**: a single function definition that works for many types.

```go
// Pre-1.18 — duplicated
func SumInts(xs []int) int       { /* ... */ }
func SumFloats(xs []float64) float64 { /* ... */ }

// Go 1.18+ — one definition
func Sum[T int | float64](xs []T) T {
    var s T
    for _, x := range xs {
        s += x
    }
    return s
}
```

The bracketed `[T int | float64]` part is a **type parameter list**. `T` is the **type parameter**, and the constraint `int | float64` says: "T may be either `int` or `float64`." When you call `Sum([]int{1, 2, 3})` Go infers `T = int` and the function behaves as if it were written specifically for `int`.

After reading this file you will:
- Understand what a type parameter is and how to declare one
- Be able to write your own generic function
- Know when to use `any` vs `comparable` vs a custom constraint
- Recognize when **not** to reach for generics

---

## Prerequisites
- Go 1.18 or newer (`go version` should print `1.18` or higher)
- Comfort with regular functions (parameters, return values)
- Basic familiarity with slices and maps
- Optional: read **4.1 Why Generics** for the motivation

---

## Glossary

| Term | Definition |
|--------|--------|
| **Generic function** | A function declared with one or more type parameters |
| **Type parameter** | A placeholder type written inside `[...]`, e.g. `T` in `[T any]` |
| **Type parameter list** | The bracketed list right after the function name: `[T any, U comparable]` |
| **Type argument** | The actual concrete type used to instantiate a generic function: `Foo[int](42)` — here `int` is the type argument |
| **Constraint** | An interface-like restriction on what types are allowed for a type parameter |
| **Instantiation** | The process of substituting type arguments into a generic function to get a "real" function |
| **Type inference** | The compiler's ability to deduce type arguments from regular argument types so you can write `Foo(42)` instead of `Foo[int](42)` |
| **`any`** | A built-in alias for `interface{}` — accepts any type |
| **`comparable`** | A built-in constraint allowing types you can use with `==` and `!=` |
| **Type set** | The set of types satisfying a constraint |
| **Type union** | A constraint of the form `int | float64 | string` listing allowed types |
| **Approximation `~T`** | `~int` matches `int` and any defined type whose underlying type is `int` |

---

## Core Concepts

### 1. The simplest generic function

```go
package main

import "fmt"

func Identity[T any](x T) T {
    return x
}

func main() {
    fmt.Println(Identity(42))      // 42
    fmt.Println(Identity("hi"))    // hi
    fmt.Println(Identity[bool](true)) // true (explicit type argument)
}
```

Reading the signature aloud: *"Identity is a function that, for any type T, takes a value of type T and returns a value of type T."*

### 2. Anatomy of a generic function

```
func Map[T any, U any](xs []T, f func(T) U) []U
     ^^^  ^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^^^^  ^^^
     name type-param    regular params       return
          list
```

| Part | Meaning |
|------|---------|
| `Map` | Function name |
| `[T any, U any]` | Type parameter list — declares two type parameters with constraint `any` |
| `(xs []T, f func(T) U)` | Regular parameters, may use the type parameters |
| `[]U` | Return type, may use the type parameters |

### 3. Calling a generic function

```go
// Explicit instantiation — write the type arguments
ys := Map[int, string]([]int{1, 2, 3}, func(x int) string {
    return fmt.Sprintf("%d", x)
})

// Type inference — let the compiler figure it out
ys = Map([]int{1, 2, 3}, func(x int) string {
    return fmt.Sprintf("%d", x)
})
```

Both forms produce the same result. Inference is preferred when it's unambiguous and readable.

### 4. Constraints — telling the compiler what `T` can do

A type parameter on its own is a **black box** — the compiler does not know what operations are allowed on `T`. Constraints unlock operations.

```go
// `any` is the loosest constraint — only operations valid for ALL types
func Print[T any](x T) {
    fmt.Println(x) // OK — Println accepts any
    // x + x       // ERROR — `+` is not defined for all T
}

// `comparable` allows == and !=
func Equal[T comparable](a, b T) bool {
    return a == b
}

// Custom constraint as an interface
type Number interface {
    int | int64 | float64
}

func Add[T Number](a, b T) T {
    return a + b
}
```

### 5. The `any` constraint

`any` is just an alias for `interface{}`. It says: "no constraint." A function with `[T any]` cannot perform any type-specific operation on `T`; it can only pass it around, store it, print it via `fmt`, or compare it via reflection.

### 6. The `comparable` constraint

`comparable` is a built-in constraint covering all types where `==` and `!=` are defined: integers, floats, strings, pointers, channels, interfaces, plus structs/arrays of comparable parts. **Slices, maps, and functions are NOT comparable.**

```go
func Contains[T comparable](xs []T, target T) bool {
    for _, x := range xs {
        if x == target {
            return true
        }
    }
    return false
}
```

### 7. Type union constraints

A union lists the allowed concrete types separated by `|`:

```go
type Numeric interface {
    int | int8 | int16 | int32 | int64 |
    uint | uint8 | uint16 | uint32 | uint64 |
    float32 | float64
}

func Sum[T Numeric](xs []T) T {
    var s T
    for _, x := range xs { s += x }
    return s
}
```

Inside `Sum` you may use `+`, `-`, `*`, `/`, `<`, `>`, `==`, `!=` — any operator defined on **all** members of the union.

### 8. The `~` (approximation) token

`~int` means "any type whose underlying type is `int`":

```go
type Celsius int
type Fahrenheit int

type IntLike interface {
    ~int
}

func Double[T IntLike](x T) T { return x * 2 }

var c Celsius = 25
fmt.Println(Double(c)) // 50 (works because Celsius's underlying type is int)
```

Without `~`, `Double(c)` would fail because `Celsius` is not literally `int`.

### 9. Instantiation — what happens at compile time

When you call `Sum([]int{1, 2, 3})`, the Go compiler **instantiates** `Sum` with `T = int`. Conceptually it produces a specialized version:

```go
// What the compiler effectively builds
func Sum_int(xs []int) int {
    var s int
    for _, x := range xs { s += x }
    return s
}
```

In practice the Go compiler uses a technique called **GC shape stenciling** — types with the same memory layout share one compiled body. We dive into this in `senior.md`.

---

## Real-World Analogies

**Analogy 1 — A blueprint for a house**

A regular function is a finished house. A generic function is a **blueprint**: the same plan can be used to build a brick house, a wooden house, or a concrete house. The blueprint says: *"window goes here, door goes there"* without committing to a material. When you actually build (instantiate) you pick the material (the type argument).

**Analogy 2 — A waffle iron**

A waffle iron makes waffles. The same iron works whether you pour in plain batter, chocolate batter, or buttermilk batter. The iron doesn't care what's inside the batter as long as the batter has the right consistency (the constraint).

**Analogy 3 — A mailbox**

A mailbox accepts envelopes. It does not care if the envelope contains a letter, a card, or a check — as long as it fits through the slot. The slot dimensions are the constraint.

**Analogy 4 — Math notation**

In math you write `f(x) = x²` without committing to whether `x` is a real, complex, or integer. The formula is generic. When you evaluate `f(3)` you have instantiated it with `x = 3`.

---

## Mental Models

### Model 1: Generic function = template + type arguments

Think of a generic function as a **template**. Each call site is a different filling-in of the template:

```
Template: func Sum[T Numeric](xs []T) T
                              │
                              ▼
Call site 1: Sum([]int{...})       → instantiated as Sum_int
Call site 2: Sum([]float64{...})   → instantiated as Sum_float64
```

### Model 2: Type parameter = compile-time variable

Regular parameters carry **values** at runtime. Type parameters carry **types** at compile time. The compiler "runs" once per instantiation and bakes the type into the resulting code.

### Model 3: Constraint = interface for types

A constraint is just a special interface. An interface lists method requirements — a constraint may also list allowed concrete types via union.

### Model 4: `any` = no information

If you only have `[T any]` and a value of type `T`, you can't multiply, add, or compare. You can only pass it through. The fewer constraints you put on `T`, the fewer operations you can perform.

---

## Pros & Cons

### Pros

| Benefit | Detail |
|---------|--------|
| **Type safety** | The compiler enforces types — no `interface{}` boxing |
| **Less duplication** | One `Map` instead of `MapInt`, `MapString`, `MapFoo` |
| **Reusable libraries** | Authors of `slices` and `maps` packages can target many types at once |
| **Better than `interface{}`** | No type assertions, no boxing/unboxing for common cases |

### Cons

| Drawback | Detail |
|----------|--------|
| **Cognitive load** | Type parameter syntax is new and dense |
| **Slightly slower compile** | The compiler has to instantiate per shape |
| **Possible runtime overhead** | GC shape stenciling can require an extra dictionary load |
| **Bad fit for I/O-bound code** | If your function does network calls, generics buy you nothing |
| **Easy to over-abstract** | Two specialized functions are often clearer than one over-parameterized one |

---

## Use Cases

| Use case | Example |
|---------|--------|
| Slice utilities | `Map`, `Filter`, `Reduce`, `Reverse`, `Contains` |
| Numeric utilities | `Sum`, `Min`, `Max`, `Clamp` |
| Container helpers | Generic `Stack`, `Queue`, `Set` (the function APIs) |
| Functional helpers | `Memoize`, `Compose`, `Curry` |
| Default-value helpers | `Coalesce[T any](xs ...T) T` |
| Test helpers | `assert.Equal[T comparable](t, expected, actual T)` |

When **not** to use generics:
- A single concrete type fits all callers — just write `func SumInts([]int) int`
- The function does I/O — generics don't help here
- The logic differs per type — write distinct functions

---

## Code Examples

### Example 1 — `Map`

```go
package main

import "fmt"

func Map[T any, U any](xs []T, f func(T) U) []U {
    out := make([]U, len(xs))
    for i, x := range xs {
        out[i] = f(x)
    }
    return out
}

func main() {
    nums := []int{1, 2, 3, 4}
    squares := Map(nums, func(n int) int { return n * n })
    fmt.Println(squares) // [1 4 9 16]

    words := []string{"go", "rocks"}
    upper := Map(words, func(s string) string { return strings.ToUpper(s) })
    fmt.Println(upper) // [GO ROCKS]
}
```

### Example 2 — `Filter`

```go
func Filter[T any](xs []T, pred func(T) bool) []T {
    out := make([]T, 0, len(xs))
    for _, x := range xs {
        if pred(x) {
            out = append(out, x)
        }
    }
    return out
}

evens := Filter([]int{1, 2, 3, 4, 5}, func(n int) bool { return n%2 == 0 })
// [2 4]
```

### Example 3 — `Reduce`

```go
func Reduce[T any, U any](xs []T, init U, f func(U, T) U) U {
    acc := init
    for _, x := range xs {
        acc = f(acc, x)
    }
    return acc
}

sum := Reduce([]int{1, 2, 3, 4}, 0, func(acc, x int) int { return acc + x })
// 10

words := []string{"go", "is", "fun"}
sentence := Reduce(words, "", func(acc, w string) string {
    if acc == "" { return w }
    return acc + " " + w
})
// "go is fun"
```

### Example 4 — `Min` / `Max`

```go
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 |
    ~float32 | ~float64 | ~string
}

func Min[T Ordered](a, b T) T {
    if a < b { return a }
    return b
}

func Max[T Ordered](a, b T) T {
    if a > b { return a }
    return b
}

fmt.Println(Min(3, 7))           // 3
fmt.Println(Max("apple", "pear")) // pear
```

(In Go 1.21+ this constraint is provided as `cmp.Ordered`.)

### Example 5 — `Contains`

```go
func Contains[T comparable](xs []T, target T) bool {
    for _, x := range xs {
        if x == target {
            return true
        }
    }
    return false
}

fmt.Println(Contains([]int{1, 2, 3}, 2))         // true
fmt.Println(Contains([]string{"go", "rust"}, "c")) // false
```

### Example 6 — `IndexOf`

```go
func IndexOf[T comparable](xs []T, target T) int {
    for i, x := range xs {
        if x == target {
            return i
        }
    }
    return -1
}
```

### Example 7 — Generic `Stack` operations

We will declare the type itself in 4.3, but its **methods can be expressed via generic functions** as well:

```go
type Stack[T any] struct {
    items []T
}

func Push[T any](s *Stack[T], x T) {
    s.items = append(s.items, x)
}

func Pop[T any](s *Stack[T]) (T, bool) {
    var zero T
    if len(s.items) == 0 {
        return zero, false
    }
    n := len(s.items) - 1
    x := s.items[n]
    s.items = s.items[:n]
    return x, true
}

func main() {
    s := &Stack[int]{}
    Push(s, 1)
    Push(s, 2)
    x, _ := Pop(s)
    fmt.Println(x) // 2
}
```

(The more idiomatic form puts these as methods on `Stack[T]`. We cover that in 4.3.)

### Example 8 — `Coalesce`

Returns the first non-zero argument:

```go
func Coalesce[T comparable](vs ...T) T {
    var zero T
    for _, v := range vs {
        if v != zero {
            return v
        }
    }
    return zero
}

fmt.Println(Coalesce("", "", "found", "rest")) // "found"
fmt.Println(Coalesce(0, 0, 7, 0))              // 7
```

### Example 9 — `Keys` and `Values` of a map

```go
func Keys[K comparable, V any](m map[K]V) []K {
    out := make([]K, 0, len(m))
    for k := range m {
        out = append(out, k)
    }
    return out
}

func Values[K comparable, V any](m map[K]V) []V {
    out := make([]V, 0, len(m))
    for _, v := range m {
        out = append(out, v)
    }
    return out
}
```

### Example 10 — `Reverse`

```go
func Reverse[T any](xs []T) {
    for i, j := 0, len(xs)-1; i < j; i, j = i+1, j-1 {
        xs[i], xs[j] = xs[j], xs[i]
    }
}
```

---

## Coding Patterns

### Pattern 1: Identity helper

`func Identity[T any](x T) T { return x }` — useful as a default in pipelines.

### Pattern 2: Zero-value helper

```go
func Zero[T any]() T {
    var z T
    return z
}
```

### Pattern 3: Pointer helper

```go
func Ptr[T any](x T) *T {
    return &x
}

p := Ptr(42) // *int pointing at 42 — handy when you need a pointer to a literal
```

### Pattern 4: Map keys to slice

```go
type Pair[K comparable, V any] struct{ K K; V V }

func Pairs[K comparable, V any](m map[K]V) []Pair[K, V] {
    out := make([]Pair[K, V], 0, len(m))
    for k, v := range m {
        out = append(out, Pair[K, V]{k, v})
    }
    return out
}
```

### Pattern 5: Apply transformation chain

```go
func Apply[T any](x T, fs ...func(T) T) T {
    for _, f := range fs {
        x = f(x)
    }
    return x
}
```

---

## Clean Code

- Use single-letter type names (`T`, `U`, `K`, `V`) when meaning is obvious from context — that is the Go convention.
- For more domain-specific generics, use longer descriptive names (`Element`, `Key`, `Value`).
- Keep type parameter lists short — three is already a lot.
- Prefer `any` over `interface{}` in type-parameter contexts.
- Keep generic helpers in a dedicated file (e.g., `slicesx.go`).
- Don't make a function generic just because you can. If only one concrete type uses it, leave it concrete.

---

## Product Use / Feature

You are building a SaaS app. A few real generic-function use cases:

1. **Pagination helper.** `func Page[T any](items []T, offset, limit int) []T` — works for any kind of result.
2. **Webhook batch.** `func Batch[T any](xs []T, size int) [][]T` — chunk events into HTTP-sized batches.
3. **Cache wrapper.** `func Cached[K comparable, V any](key K, fetch func(K) V) V` — memoization helper.
4. **Bulk DB upsert.** `func Upsert[T Identifiable](db *DB, items []T) error` — works for any row type that exposes an `ID()` method.

---

## Error Handling

Generic functions handle errors like any other function — there is no special syntax.

```go
func MapErr[T any, U any](xs []T, f func(T) (U, error)) ([]U, error) {
    out := make([]U, len(xs))
    for i, x := range xs {
        y, err := f(x)
        if err != nil {
            return nil, fmt.Errorf("MapErr at index %d: %w", i, err)
        }
        out[i] = y
    }
    return out, nil
}
```

Tip: when wrapping errors, include the index or key so the caller can localize the failure.

---

## Security Considerations

- Generics are a compile-time feature; they introduce no new runtime attack surface vs ordinary code.
- However, generic helpers are tempting to use in places where you should validate input. A `Map` function will dutifully apply your closure to every element — including elements that came from untrusted sources. Validate **before** mapping, not inside the mapper.
- Beware of accidentally widening exposure: `func Public[T any](x T) T` is more permissive than a typed function. If the function operates on credentials, prefer a specific type.

---

## Performance Tips

- Generics are usually the same speed as hand-written code, but a dispatching layer ("dictionary") may add a small overhead — typically 1-5%. We cover this in `optimize.md`.
- Avoid `[T any]` if you only need numeric or string types — pick a tighter constraint so the compiler can specialize harder.
- For hot paths over slices of `int` or `float64`, a hand-written loop can still beat the generic version by a few percent. Measure before reaching for generics in tight inner loops.
- Reuse the output slice (`make([]U, len(xs))`) — you already know the final length for `Map`.

---

## Best Practices

| Best practice | Reason |
|---------------|--------|
| Start non-generic, generalize later | Premature generalization is a real cost |
| Pick the tightest possible constraint | Helps the reader and the compiler |
| Use `any` for true container helpers | `Filter`, `Reverse`, `First`, ... |
| Use `comparable` for equality-based helpers | `Contains`, `IndexOf`, `Distinct` |
| Use `cmp.Ordered` (Go 1.21+) for ordering | `Min`, `Max`, sorting |
| Provide examples in doc comments | Generics' signatures are dense; examples help |
| Avoid adding type parameters that aren't used | Each unused type parameter is dead weight |

---

## Edge Cases & Pitfalls

### Cannot infer `T` when it appears only in the return type

```go
func Make[T any]() T {
    var z T
    return z
}

x := Make() // ERROR — compiler cannot infer T
y := Make[int]() // OK
```

### Methods cannot have **their own** type parameters

```go
type Box[T any] struct{ V T }

// LEGAL — uses Box's type parameter
func (b Box[T]) Get() T { return b.V }

// ILLEGAL — methods may not declare new type parameters
// func (b Box[T]) Map[U any](f func(T) U) Box[U] { ... }  // compile error
```

You must drop the parameter to a free function:

```go
func MapBox[T any, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{V: f(b.V)}
}
```

### Empty slice with `[T any]`

```go
func First[T any](xs []T) T {
    return xs[0] // panics on empty input — prefer returning (T, bool)
}
```

### Closures capture the type parameter

```go
func MakeAdder[T Numeric](base T) func(T) T {
    return func(x T) T { return base + x }
}
```

That works fine, but every call to `MakeAdder[int]` produces a *separate* closure with its own captured `base` — no surprises here, but worth noting for memory.

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `[T any]` then trying `t1 + t2` | Add a numeric constraint |
| Forgetting `~` on union constraints | Use `~int` if you want defined types like `Celsius` to fit |
| Using `interface{}` instead of `any` | Use `any` — it's the modern alias |
| Putting type parameters on methods | Move them to the receiver type or to a free function |
| Over-parameterizing | If only one type ever uses it, drop generics |
| Writing `Foo[int, string](...)` when inference works | Trust inference for readability |

---

## Common Misconceptions

**"Generics are like Java/C# generics."**

Surface syntax is similar but Go uses **type parameter constraints** rather than wildcards (`<? extends T>`). There is no covariance/contravariance and no method-level type parameters.

**"Generics are slower than `interface{}`."**

Usually faster, because there is no boxing for primitive types. We benchmark this in `optimize.md`.

**"`any` and `interface{}` differ at runtime."**

They do not — `any` is a literal alias.

**"Generics replace interfaces."**

They don't. Generics are best for **operating on** types, interfaces are best for **describing behavior**.

---

## Tricky Points

1. **Type inference with literals.** `Min(1, 2.0)` is ambiguous — the compiler can't decide between `int` and `float64`. Convert one operand or specify `Min[float64](1, 2.0)`.

2. **`[T comparable]` vs interfaces.** A type is comparable if `==` works on it. A struct of all-comparable fields is comparable; a struct with a slice field is not.

3. **Empty type set is illegal.** `[T int & string]` is empty (no type is both `int` and `string`). The compiler rejects it.

4. **Type parameters can constrain each other.**

```go
func Convert[U, T any, _ interface{ ~[]T }](xs U) []T {
    // contrived but legal
}
```

We touch on this in `senior.md`.

5. **Reflect on a type parameter.** `reflect.TypeOf(x)` works on a `T` value at runtime — the type is concrete by then.

---

## Test

Quick check (answers below).

1. What does `[T any]` mean?
2. True or false: `func (b Box[T]) Map[U any]() Box[U]` is legal Go.
3. Which constraint allows `==`? `any` or `comparable`?
4. Does `~int` accept `int`? Does it accept a `type Age int`?
5. Why can't `Min(1, 2.0)` infer a single `T`?
6. What is **instantiation**?

<details>
<summary>Answers</summary>

1. T is a type parameter unconstrained — any type is allowed.
2. False — methods cannot have their own type parameters.
3. `comparable`.
4. Yes to both.
5. Because `1` is `int` and `2.0` is `float64`; there is no single `T` matching both.
6. The compiler substituting type arguments to produce a concrete function.

</details>

---

## Tricky Questions

**Q1.** Why can't `Sum[T any](xs []T) T` compile?
**A.** Because `+` is not defined for *all* types. The constraint is too weak; use a numeric constraint.

**Q2.** Why is `any` preferred over `interface{}` in modern Go?
**A.** Readability. They are identical otherwise.

**Q3.** When should you pick `[T comparable]` over `[T any]`?
**A.** Whenever the function uses `==` or `!=` (lookup, deduplication, equality).

**Q4.** Why are some types not comparable?
**A.** Slices, maps, and functions have no defined `==` (they would compare references but the language disallows it for slices/maps to avoid surprising semantics).

**Q5.** Can the same type parameter name appear twice in `[T any, T any]`?
**A.** No — that's a duplicate name and is rejected.

---

## Cheat Sheet

```go
// Declaration
func Foo[T any](x T) T { return x }
func Pair[K comparable, V any](k K, v V) struct{K K; V V} { ... }

// Constraints
[T any]                          // any type
[T comparable]                   // == and != allowed
[T int | float64]                // type union
[T ~int]                         // Approximation: int and types with underlying int
[T cmp.Ordered]                  // Go 1.21+ ordered types
[T fmt.Stringer]                 // Method-set constraint

// Calling
Foo(42)        // inference — common case
Foo[int](42)   // explicit type argument

// Multiple type params
func Map[T, U any](xs []T, f func(T) U) []U
Map([]int{1,2,3}, strconv.Itoa)
```

---

## Self-Assessment Checklist

- [ ] I can declare a generic function with one type parameter
- [ ] I can declare a generic function with multiple type parameters
- [ ] I can pick `any` vs `comparable` correctly
- [ ] I can use `~T` and explain when it matters
- [ ] I can write `Map`, `Filter`, `Reduce` from memory
- [ ] I know when type inference will fail
- [ ] I understand why methods can't add their own type parameters
- [ ] I can call a generic function with explicit type arguments
- [ ] I avoid using `interface{}` when `any` will do
- [ ] I can explain instantiation in two sentences

---

## Summary

Generic functions in Go let you write **one function** that works on **many types** without sacrificing type safety or performance. The key parts are the **type parameter list** (`[T any]`), **constraints** (`any`, `comparable`, custom unions), and **instantiation** (the compiler producing the specialized version). Use generics when the *logic* is identical across types, and avoid them when the logic differs or only one type ever uses the function.

---

## What You Can Build

After mastering generic functions you can build:
- A `slicesx` utility package with `Map`, `Filter`, `Reduce`, `Uniq`, `GroupBy`
- A typed memoization helper for any function `K -> V`
- A simple type-safe set: `Set[T]{ Add, Remove, Contains }`
- A pipeline framework for stream-processing
- A test-assertion library with `assert.Equal[T comparable](t, expected, got T)`

---

## Further Reading

- [Go blog: An Introduction to Generics](https://go.dev/blog/intro-generics)
- [Go spec: Function declarations](https://go.dev/ref/spec#Function_declarations)
- [Go spec: Type parameter declarations](https://go.dev/ref/spec#Type_parameter_declarations)
- [Tutorial: Getting started with generics](https://go.dev/doc/tutorial/generics)
- [Proposal: type parameters](https://go.googlesource.com/proposal/+/refs/heads/master/design/43651-type-parameters.md)

---

## Related Topics

- **4.1 Why Generics** — motivation and history
- **4.3 Generic Types & Interfaces** — generic struct and interface declarations
- **4.4 Type Constraints** — designing your own constraints
- **4.5 Type Inference** — deeper dive on inference rules
- **3.1 Methods vs Functions** — why methods cannot have their own type parameters

---

## Diagrams & Visual Aids

### Anatomy

```
   ┌─ name
   │
   │     ┌─ type parameter list
   │     │
   │     │           ┌─ constraint
   │     │           │
   ▼     ▼           ▼
func Map[T any, U any](xs []T, f func(T) U) []U
                       └────────┬─────────┘ └┬┘
                       regular params     return
```

### Instantiation

```
                       ┌────────────────┐
   Sum[int] ─────────► │  body with     │
                       │  T → int       │
                       └────────────────┘
                       ┌────────────────┐
   Sum[float64] ─────► │  body with     │
                       │  T → float64   │
                       └────────────────┘
```

### Constraint hierarchy

```
                   any
                    │
      ┌─────────────┼──────────────┐
      ▼             ▼              ▼
 comparable    Numeric       custom union
      │             │
      ▼             ▼
   int, ...     int|float64|...
```

[← Back](./junior.md) · [middle.md →](./middle.md)
