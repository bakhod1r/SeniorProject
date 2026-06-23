# Generic Functions — Interview

## Table of Contents
1. [Introduction](#introduction)
2. [Syntax Questions](#syntax-questions)
3. [Conceptual Questions](#conceptual-questions)
4. [Inference Questions](#inference-questions)
5. [Constraint Questions](#constraint-questions)
6. [Method-Related Questions](#method-related-questions)
7. [Performance Questions](#performance-questions)
8. [Design Questions](#design-questions)
9. [Trap Questions](#trap-questions)
10. [Coding Questions](#coding-questions)
11. [Summary](#summary)

---

## Introduction

A collection of 30+ questions and answers tailored to generic functions in Go. Group A (junior) is foundational. Group B (mid/senior) tests judgment.

---

## Syntax Questions

### Q1. What does `[T any]` mean?

`T` is a type parameter; `any` is its constraint. The function works for **any** Go type as `T`. Inside the function body, you can pass `T` values around but not perform type-specific operations like `+` or `<` because no constraint guarantees those.

### Q2. Where does the type parameter list go in a function declaration?

Between the function **name** and the **opening parenthesis** of the regular parameter list:

```go
func Foo[T any](x T) T { return x }
//      ^^^^^^^
```

### Q3. What's the difference between `func Foo[T any](x T) T` and `func Foo(x interface{}) interface{}`?

The first is type-safe and (usually) avoids boxing primitive types. The second forces every caller to do a type assertion on the return value. The first is also enforced at compile time; the second is checked only at runtime.

### Q4. How do you call a generic function with explicit type arguments?

`Foo[int](42)`. The bracketed list goes immediately after the function name.

### Q5. Can you omit the type arguments?

Yes, when the compiler can infer them from the regular arguments — e.g. `Foo(42)` will set `T = int`. If the compiler can't infer, you must be explicit.

### Q6. What is the equivalent of `interface{}` in modern Go?

`any`. It's a built-in alias.

### Q7. How do you constrain `T` to numeric types?

Define a union constraint:

```go
type Numeric interface {
    ~int | ~int64 | ~float32 | ~float64
}
func Add[T Numeric](a, b T) T { return a + b }
```

In Go 1.21+, prefer `cmp.Ordered` for comparable+numeric types.

---

## Conceptual Questions

### Q8. What is a "type parameter"?

A placeholder type, declared in `[...]`, whose actual type is determined at the call site.

### Q9. What is a "type argument"?

The concrete type substituted for a type parameter at the call site, e.g. `int` in `Foo[int](42)`.

### Q10. What is "instantiation"?

The compiler's process of substituting type arguments into a generic function to produce a concrete (non-generic) function.

### Q11. What's the difference between `T any` and `T comparable`?

`any` allows any type but supports no operators on `T`. `comparable` requires the type to support `==` and `!=` (so you can compare values of `T`).

### Q12. Why is `comparable` not the same as "all types"?

Slices, maps, and functions are not comparable in Go (no defined equality). They are not in `comparable`'s type set.

### Q13. What does `~int` mean?

"Any type whose underlying type is `int`". This includes `int` itself plus defined types like `type Age int`.

### Q14. Is `any` an interface?

Yes — it's an alias for `interface{}`. They are the same type.

---

## Inference Questions

### Q15. When does type inference fail?

When a type parameter only appears in the return type, or when arguments contain mixed types that can't be unified, or when no typed argument informs the inference.

```go
func New[T any]() T { var z T; return z } // call New() without [T] → inference fails
```

### Q16. Can untyped constants drive inference?

Yes, but they fall back to default types: `1` → `int`, `1.0` → `float64`, `"x"` → `string`.

### Q17. Can a function literal help inference?

Yes — if you pass a typed function literal, the compiler reads its signature to deduce `T` and `U`.

### Q18. Why does `Min(1, 2.0)` fail to compile?

The compiler tries to find a single `T` matching both `int` (from `1`) and `float64` (from `2.0`) — there isn't one.

### Q19. Did Go 1.21 change inference rules?

Yes. It introduced partial type-argument inference, allowing `Foo[int](xs)` even when other type parameters need inference, plus better support for inference over interface arguments.

---

## Constraint Questions

### Q20. Can a constraint be defined inline?

Yes. `func F[T interface{ ~int | ~string }](x T)` is legal. Most code prefers a named interface for readability.

### Q21. What types are in `comparable`'s type set?

All types where `==` and `!=` are defined: integers, floats, complex, strings, pointers, channels, interfaces, plus arrays/structs whose elements are all comparable.

### Q22. Can a constraint require both methods and a type union?

Yes:

```go
type StringableInt interface {
    ~int | ~int64
    String() string
}
```

### Q23. What's the difference between `int` and `~int` in a constraint?

`int` admits only the literal `int` type. `~int` admits any type whose underlying is `int` (including `time.Duration`'s bug-prone status: actually `time.Duration`'s underlying is `int64`, not `int`).

### Q24. What is an "empty type set"?

A constraint whose intersection of type elements admits no actual type. Legal but no caller can instantiate.

---

## Method-Related Questions

### Q25. Can a method add its own type parameter?

**No.** Methods inherit the receiver type's type parameters. To get behavior parameterized by additional types, write a free function.

### Q26. Why was this restriction added?

To keep method dispatch and runtime dictionaries tractable, and to keep interface methods sensible.

### Q27. How do you write the equivalent of `Box[T].MapTo[U]()`?

As a free function:

```go
func MapBox[T, U any](b Box[T], f func(T) U) Box[U] { ... }
```

### Q28. Can a generic function be a method receiver value?

You can pass an instantiated method value: `(&box).Get` — but this is a regular method value of the instantiated type, not a generic value.

---

## Performance Questions

### Q29. Are generics slower than `interface{}`?

Usually faster, because they avoid boxing primitive types. But in extreme cases the dictionary lookup in GC shape stenciling can add a small overhead vs hand-specialized code.

### Q30. What is GC shape stenciling?

Go's strategy of compiling **one** body of a generic function for each distinct GC shape (memory layout for the garbage collector), shared by multiple type arguments via a runtime dictionary.

### Q31. When should you prefer hand-written specialization?

In hot inner loops where the dictionary lookup is measurable (rare), or when a profile shows the generic version not being inlined.

---

## Design Questions

### Q32. When should you NOT make a function generic?

- Only one concrete type uses it.
- The function does I/O — generics buy nothing.
- The logic differs per type.
- A simple interface satisfies the use case.

### Q33. When SHOULD you make a function generic?

- Three or more specialized copies exist.
- The same operation applies across types with no domain-specific tweaks.
- The constraint can be expressed cleanly.

### Q34. How would you decide between `Option[T]` and `(T, bool)`?

`(T, bool)` is more idiomatic Go. Reach for `Option[T]` only when method-style chaining or explicit "no value" semantics in a public API is justified.

### Q35. When would you choose `Result[T]` over `(T, error)`?

Almost never — `(T, error)` is the Go convention. `Result[T]` makes sense for pipeline-heavy internal code where chained transformations dominate.

---

## Trap Questions

### Q36. Why won't this compile?

```go
func Average[T any](xs []T) T {
    var sum T
    for _, x := range xs { sum += x }
    return sum / T(len(xs))
}
```

`+`, `/`, and the conversion `T(len(xs))` aren't defined for **all** types. `T` needs a numeric constraint:

```go
func Average[T ~int | ~float64](xs []T) T { /* ... */ }
```

### Q37. Why does this print "int" instead of "any"?

```go
func TypeOf[T any](x T) string {
    return reflect.TypeOf(x).String()
}
fmt.Println(TypeOf[any](42)) // "int"
```

`reflect.TypeOf` reports the **dynamic** type. The argument `42` has runtime type `int` regardless of `T`'s declared constraint.

### Q38. Why does `Min[float64](1, 2.0)` work but `Min(1, 2.0)` fail?

Explicit type argument tells the compiler `T=float64`; both `1` and `2.0` are then converted to `float64` (1 is untyped). Without the explicit, the compiler can't unify `int` and `float64`.

### Q39. What's wrong with `func F[T any](xs ...T)` called as `F()`?

It's legal — `xs` is empty. Whether the function works correctly depends on its body. If the body assumes at least one element, change to `func F[T any](first T, rest ...T)` to enforce it at compile time.

### Q40. Why doesn't `interface { ~int; ~string }` work?

The intersection of `~int` and `~string` is empty — no type can be both. Legal syntax, useless constraint.

---

## Coding Questions

### Q41. Implement `Reverse[T any](xs []T)` in place.

```go
func Reverse[T any](xs []T) {
    for i, j := 0, len(xs)-1; i < j; i, j = i+1, j-1 {
        xs[i], xs[j] = xs[j], xs[i]
    }
}
```

### Q42. Implement `Uniq[T comparable](xs []T) []T`.

```go
func Uniq[T comparable](xs []T) []T {
    seen := make(map[T]struct{}, len(xs))
    out := make([]T, 0, len(xs))
    for _, x := range xs {
        if _, ok := seen[x]; ok { continue }
        seen[x] = struct{}{}
        out = append(out, x)
    }
    return out
}
```

### Q43. Implement `Zip[T, U any](as []T, bs []U) []struct{A T; B U}`.

```go
func Zip[T, U any](as []T, bs []U) []struct{ A T; B U } {
    n := len(as)
    if len(bs) < n { n = len(bs) }
    out := make([]struct{ A T; B U }, n)
    for i := 0; i < n; i++ {
        out[i] = struct{ A T; B U }{as[i], bs[i]}
    }
    return out
}
```

### Q44. Implement `Memoize[K comparable, V any](f func(K) V) func(K) V` (single-threaded).

```go
func Memoize[K comparable, V any](f func(K) V) func(K) V {
    cache := make(map[K]V)
    return func(k K) V {
        if v, ok := cache[k]; ok {
            return v
        }
        v := f(k)
        cache[k] = v
        return v
    }
}
```

### Q45. Implement `MaxBy[T any, U cmp.Ordered](xs []T, key func(T) U) (T, bool)`.

```go
func MaxBy[T any, U cmp.Ordered](xs []T, key func(T) U) (T, bool) {
    if len(xs) == 0 {
        var zero T
        return zero, false
    }
    best := xs[0]
    bestKey := key(best)
    for _, x := range xs[1:] {
        k := key(x)
        if k > bestKey {
            best = x
            bestKey = k
        }
    }
    return best, true
}
```

### Q46. Implement `Chunk[T any](xs []T, size int) [][]T`.

```go
func Chunk[T any](xs []T, size int) [][]T {
    if size <= 0 {
        return nil
    }
    out := make([][]T, 0, (len(xs)+size-1)/size)
    for i := 0; i < len(xs); i += size {
        end := i + size
        if end > len(xs) { end = len(xs) }
        out = append(out, xs[i:end])
    }
    return out
}
```

### Q47. Implement `Compose[A, B, C any](f func(A) B, g func(B) C) func(A) C`.

```go
func Compose[A, B, C any](f func(A) B, g func(B) C) func(A) C {
    return func(a A) C { return g(f(a)) }
}
```

### Q48. Implement `Partition[T any](xs []T, pred func(T) bool) (yes, no []T)`.

```go
func Partition[T any](xs []T, pred func(T) bool) (yes, no []T) {
    for _, x := range xs {
        if pred(x) { yes = append(yes, x) } else { no = append(no, x) }
    }
    return
}
```

### Q49. Implement `Flatten[T any](xs [][]T) []T`.

```go
func Flatten[T any](xs [][]T) []T {
    total := 0
    for _, s := range xs { total += len(s) }
    out := make([]T, 0, total)
    for _, s := range xs {
        out = append(out, s...)
    }
    return out
}
```

### Q50. Implement a generic LRU helper signature (not the data structure).

```go
type LRU[K comparable, V any] interface {
    Get(k K) (V, bool)
    Put(k K, v V)
    Len() int
}
```

(Implementation typically uses a doubly-linked list + map of pointers; left for the dedicated data structure section.)

---

## Summary

Generic-function interview questions cluster around **syntax**, **inference**, **constraints**, and **judgment** (when not to use generics). Memorizing the syntax is easy; the value comes from understanding *when* generic functions earn their cost and *when* they don't. The coding questions in this file are deliberately small — most real-world generic functions are short, and being able to write them quickly is the practical bar.

[← specification.md](./specification.md) · [tasks.md →](./tasks.md)
