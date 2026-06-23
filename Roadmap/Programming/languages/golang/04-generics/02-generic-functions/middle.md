# Generic Functions — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Type Inference at the Call Site](#type-inference-at-the-call-site)
3. [Explicit Type Arguments](#explicit-type-arguments)
4. [Multiple Type Parameters](#multiple-type-parameters)
5. [Mixing Type Parameters with Regular Parameters](#mixing-type-parameters-with-regular-parameters)
6. [Generic Functions Returning Closures](#generic-functions-returning-closures)
7. [Recursion in Generic Functions](#recursion-in-generic-functions)
8. [Generic Helpers in Your Codebase](#generic-helpers-in-your-codebase)
9. [Variadic Generic Functions](#variadic-generic-functions)
10. [Constraint Composition](#constraint-composition)
11. [Patterns and Anti-Patterns](#patterns-and-anti-patterns)
12. [Code Review Checklist](#code-review-checklist)
13. [Test](#test)
14. [Tricky Questions](#tricky-questions)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)

---

## Introduction

At the junior level you learned how to declare a generic function and call it with a single type parameter. At the middle level we cover the **mechanics that matter in real codebases**:

- How **type inference** decides what `T` should be at the call site
- When you must give the type argument **explicitly**
- Real patterns: helpers that return closures, recursion, variadic generics
- How a team integrates generic helpers into an existing codebase

By the end of this file you should feel comfortable writing and reviewing day-to-day generic helpers, and you should know precisely when inference will fail.

---

## Type Inference at the Call Site

Go's compiler can almost always figure out the type arguments from the regular arguments you pass. The rules are simple but important.

### Rule 1: Function arguments drive inference

```go
func First[T any](xs []T) T { return xs[0] }

First([]int{1, 2, 3})       // T inferred as int
First([]string{"a", "b"})   // T inferred as string
```

### Rule 2: Untyped constants

Untyped constants (`1`, `"hello"`) participate in inference but the compiler must pick a default type:

```go
func Show[T any](x T) { fmt.Println(x) }

Show(1)        // T = int (default for untyped int constants)
Show(1.0)      // T = float64
Show("hi")     // T = string
```

### Rule 3: Inference fails when the type only appears in the return position

```go
func Make[T any]() T {
    var z T
    return z
}

x := Make()        // ERROR — cannot infer T
y := Make[int]()   // OK
```

### Rule 4: Mixed arguments — must agree

```go
func Pair[T any](a, b T) [2]T { return [2]T{a, b} }

Pair(1, 2)           // T = int — OK
Pair(1, "two")       // ERROR — mismatched types int and string
Pair(1.0, 2)         // T = float64 — OK (2 is untyped, fits float64)
Pair[int](1.5, 2)    // ERROR — 1.5 is not int
```

### Rule 5: Closures help inference

```go
func Map[T any, U any](xs []T, f func(T) U) []U { /* ... */ }

ints := []int{1, 2, 3}
strs := Map(ints, strconv.Itoa)  // T=int, U=string — both inferred
```

When you pass a typed function value, the compiler walks its signature to discover both `T` and `U`.

### Rule 6: Constraint-driven inference

```go
type SignedInt interface { ~int | ~int64 }

func Abs[T SignedInt](x T) T {
    if x < 0 { return -x }
    return x
}

Abs(-5)         // T = int
Abs(int64(-5))  // T = int64

type Age int
var a Age = -3
Abs(a)          // T = Age (because Age's underlying is int and constraint uses ~int)
```

### Inference order in Go 1.21+

Go 1.21 improved inference so that **partial type arguments** work:

```go
func Convert[T, U any](xs []T) []U { /* ... */ }

Convert[int](xs)        // T = int explicit, U inferred from context — Go 1.21+
```

---

## Explicit Type Arguments

When inference fails, or when explicit arguments make the code clearer, you write `Foo[Type1, Type2](args)`:

```go
type Result[T any] struct {
    Value T
    Err   error
}

func ParseInt[T int | int64](s string) Result[T] {
    var z T
    n, err := strconv.ParseInt(s, 10, 64)
    if err != nil {
        return Result[T]{Value: z, Err: err}
    }
    return Result[T]{Value: T(n)}
}

r := ParseInt[int]("42")  // explicit — T cannot be inferred from "42"
```

### When to be explicit

| Situation | Explicit? |
|-----------|-----------|
| Inference works and is unambiguous | No |
| Inference fails | Yes |
| The type argument is far from the call site (readability) | Maybe — explicit can help |
| Reviewer asks "what type is `T` here?" | Yes — make it obvious |
| Generic factory: `New[*MyService]()` | Yes |

### Partial explicit args

You can give some type arguments and leave the rest to inference (Go 1.21+):

```go
func Zip[T, U any](xs []T, ys []U) []struct{ A T; B U } { /* ... */ }

Zip[int]([]int{1, 2}, []string{"a", "b"})  // U inferred as string
```

---

## Multiple Type Parameters

A function may declare any number of type parameters. They share one bracketed list.

```go
func Map[T any, U any](xs []T, f func(T) U) []U { /* ... */ }

func Reduce[T any, U any](xs []T, init U, f func(U, T) U) U { /* ... */ }

func Zip[T any, U any](as []T, bs []U) []struct{ A T; B U } {
    n := len(as)
    if len(bs) < n { n = len(bs) }
    out := make([]struct{ A T; B U }, n)
    for i := 0; i < n; i++ {
        out[i] = struct{ A T; B U }{as[i], bs[i]}
    }
    return out
}
```

If two type parameters share a constraint you can group them:

```go
func Min2[T, U cmp.Ordered](x T, y U) {} // INVALID — T and U are different params, cmp.Ordered each
// vs
func MinSame[T cmp.Ordered](x, y T) T {
    if x < y { return x }
    return y
}
```

The first signature is legal but `T` and `U` are independent parameters — `x` and `y` may have different types.

### Naming conventions

| Convention | Use |
|------------|-----|
| `T`, `U`, `V` | Generic, position-driven |
| `K`, `V` | Map keys and values |
| `T1`, `T2`, ..., `Tn` | When you have many of the same role |
| `Element`, `Key` | Explicit domain naming |

---

## Mixing Type Parameters with Regular Parameters

The type parameter list comes **first**, then regular parameters. The two interact freely:

```go
func Repeat[T any](x T, n int) []T {
    out := make([]T, n)
    for i := range out {
        out[i] = x
    }
    return out
}

Repeat("go", 3) // ["go", "go", "go"]
Repeat(7, 4)    // [7, 7, 7, 7]
```

### A type parameter cannot depend on a regular parameter

```go
// Conceptually — illegal
// func Take(n int)[T any](xs []T) []T { ... }
```

Type parameters are bound at compile time; runtime values cannot influence them.

### A regular parameter type may use the type parameter

```go
func Tag[T any](label string, x T) struct{ L string; V T } {
    return struct{ L string; V T }{label, x}
}
```

`label` is a regular `string` — `x` uses `T`. The compiler infers `T` from `x`.

### Returning multiple values

```go
func Split[T any](xs []T, pred func(T) bool) (yes, no []T) {
    for _, x := range xs {
        if pred(x) {
            yes = append(yes, x)
        } else {
            no = append(no, x)
        }
    }
    return
}

evens, odds := Split([]int{1,2,3,4}, func(x int) bool { return x%2 == 0 })
```

---

## Generic Functions Returning Closures

A common pattern: a generic function that produces a specialized closure.

### Adder factory

```go
type Numeric interface {
    ~int | ~int64 | ~float32 | ~float64
}

func Adder[T Numeric](base T) func(T) T {
    return func(x T) T { return base + x }
}

addFive := Adder(5)
fmt.Println(addFive(10)) // 15

addPi := Adder(3.14)
fmt.Println(addPi(0.86)) // 4.0
```

The closure captures `base` by value. Each call to `Adder` produces an independent closure.

### Memoization helper

```go
func Memoize[K comparable, V any](f func(K) V) func(K) V {
    cache := make(map[K]V)
    var mu sync.Mutex
    return func(k K) V {
        mu.Lock()
        if v, ok := cache[k]; ok {
            mu.Unlock()
            return v
        }
        mu.Unlock()
        v := f(k)
        mu.Lock()
        cache[k] = v
        mu.Unlock()
        return v
    }
}

slowSquare := func(n int) int {
    time.Sleep(100 * time.Millisecond)
    return n * n
}
fastSquare := Memoize(slowSquare)
_ = fastSquare(7) // slow first time
_ = fastSquare(7) // fast second time
```

### Once-style initializer

```go
func Once[T any](init func() T) func() T {
    var (
        value T
        done  bool
        mu    sync.Mutex
    )
    return func() T {
        mu.Lock()
        defer mu.Unlock()
        if !done {
            value = init()
            done = true
        }
        return value
    }
}
```

### Throttler

```go
func Throttle[T any](d time.Duration, f func(T)) func(T) {
    var last time.Time
    var mu sync.Mutex
    return func(x T) {
        mu.Lock()
        defer mu.Unlock()
        if time.Since(last) < d {
            return
        }
        last = time.Now()
        f(x)
    }
}
```

---

## Recursion in Generic Functions

A generic function can call itself with the same type parameter:

```go
type Tree[T any] struct {
    Value    T
    Children []*Tree[T]
}

func Walk[T any](t *Tree[T], visit func(T)) {
    if t == nil { return }
    visit(t.Value)
    for _, c := range t.Children {
        Walk(c, visit) // recursion — T passed implicitly
    }
}
```

### Recursion with two distinct types

```go
func MapTree[T any, U any](t *Tree[T], f func(T) U) *Tree[U] {
    if t == nil { return nil }
    out := &Tree[U]{Value: f(t.Value)}
    for _, c := range t.Children {
        out.Children = append(out.Children, MapTree(c, f))
    }
    return out
}
```

### Functional flatten

```go
func Flatten[T any](xs [][]T) []T {
    var out []T
    for _, sub := range xs {
        out = append(out, sub...)
    }
    return out
}

// Recursive variant for nested-slice trees:
func FlattenAny[T any](v any) []T {
    var out []T
    switch x := v.(type) {
    case []T:
        return x
    case []any:
        for _, item := range x {
            out = append(out, FlattenAny[T](item)...)
        }
    case T:
        out = append(out, x)
    }
    return out
}
```

(The `any` switch shows that recursion plays nicely with type assertions when needed.)

---

## Generic Helpers in Your Codebase

A real Go service typically grows a small `internal/slicesx` or `pkg/util/funcs` package. Here is a representative file:

```go
// Package slicesx contains small generic helpers used across the service.
package slicesx

func Map[T, U any](xs []T, f func(T) U) []U {
    out := make([]U, len(xs))
    for i, x := range xs {
        out[i] = f(x)
    }
    return out
}

func Filter[T any](xs []T, pred func(T) bool) []T {
    out := xs[:0:0] // share backing array safely or use make([]T, 0, len(xs))
    for _, x := range xs {
        if pred(x) {
            out = append(out, x)
        }
    }
    return out
}

func GroupBy[T any, K comparable](xs []T, key func(T) K) map[K][]T {
    out := make(map[K][]T)
    for _, x := range xs {
        k := key(x)
        out[k] = append(out[k], x)
    }
    return out
}

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

func Find[T any](xs []T, pred func(T) bool) (T, bool) {
    for _, x := range xs {
        if pred(x) {
            return x, true
        }
    }
    var zero T
    return zero, false
}
```

Used by other packages like:

```go
import "myapp/internal/slicesx"

names := slicesx.Map(users, func(u User) string { return u.Name })
adults := slicesx.Filter(users, func(u User) bool { return u.Age >= 18 })
byCity := slicesx.GroupBy(users, func(u User) string { return u.City })
```

### When to add to a shared helper package

| Add it | Don't add it |
|--------|--------------|
| Used by 3+ call sites | Used in one place — keep it local |
| Generic logic over slices/maps | Domain-specific transformation |
| Stable across the codebase | Likely to evolve with the feature |
| Has a test | No test yet — write one first |

---

## Variadic Generic Functions

Variadic syntax (`...T`) works the same way:

```go
func Concat[T any](slices ...[]T) []T {
    total := 0
    for _, s := range slices { total += len(s) }
    out := make([]T, 0, total)
    for _, s := range slices {
        out = append(out, s...)
    }
    return out
}

a := []int{1, 2}
b := []int{3, 4}
c := []int{5}
fmt.Println(Concat(a, b, c)) // [1 2 3 4 5]
```

```go
func MaxN[T cmp.Ordered](first T, rest ...T) T {
    m := first
    for _, x := range rest {
        if x > m { m = x }
    }
    return m
}

MaxN(3, 1, 4, 1, 5, 9, 2, 6) // 9
```

The `first T` trick guarantees at least one argument so we don't need a sentinel zero value.

---

## Constraint Composition

Constraints are interfaces — you can compose them like any other interface.

```go
type Signed interface { ~int | ~int64 | ~int32 | ~int16 | ~int8 }
type Unsigned interface { ~uint | ~uint64 | ~uint32 | ~uint16 | ~uint8 }
type Integer interface { Signed | Unsigned }
type Float interface { ~float32 | ~float64 }
type Numeric interface { Integer | Float }
```

You can also embed methods alongside type unions:

```go
type Stringable interface {
    fmt.Stringer
    ~int | ~int64
}

func Describe[T Stringable](x T) string {
    return x.String() // because Stringable embeds fmt.Stringer
}
```

(Note: this requires types like `MyInt int` to define `String() string` themselves.)

---

## Patterns and Anti-Patterns

### Pattern: One-shot generic function for a specific helper

```go
// Good — local helper, clear single purpose
func mostRecent[T any](xs []T, ts func(T) time.Time) (T, bool) {
    var best T
    var found bool
    for _, x := range xs {
        if !found || ts(x).After(ts(best)) {
            best = x
            found = true
        }
    }
    return best, found
}
```

### Anti-pattern: `Foo[T any](x T)` that internally uses `reflect`

If you need reflection inside a generic function, the generic part may be redundant:

```go
// Bad — generics buy nothing here
func ToJSON[T any](x T) ([]byte, error) {
    return json.Marshal(x) // json.Marshal already takes any
}
```

A non-generic `func ToJSON(x any) ([]byte, error)` is clearer.

### Anti-pattern: Over-parameterizing

```go
// Bad
func Identity2[T any, U any](x T, y U) (T, U) { return x, y }

// Good — never used? Don't write it.
```

### Pattern: Encapsulate a constraint that's used a lot

```go
type Number interface { Integer | Float }
func Sum[T Number](xs []T) T { /* ... */ }
func Avg[T Number](xs []T) T { /* ... */ }
```

Defining `Number` once keeps the API consistent.

---

## Code Review Checklist

- [ ] Does this function actually need to be generic?
- [ ] Is the constraint as tight as possible?
- [ ] Are type parameter names short but meaningful?
- [ ] Are call sites cleaner with or without explicit type arguments?
- [ ] Does the doc comment include at least one usage example?
- [ ] Are tests covering at least two different type instantiations?
- [ ] Is there an empty-input or zero-value path covered?
- [ ] Does the function avoid `reflect` and unnecessary allocations?

---

## Test

1. What goes wrong with `func Make[T any]() T { var z T; return z }` when called as `Make()`?
2. What is the result of `Repeat("go", 3)` if `Repeat[T any](x T, n int) []T`?
3. Why is `func Foo[T int|float64](x, y T) T` better than `func Foo(x, y any) any`?
4. Can a method declare its own type parameter?
5. What's wrong with `func MaxN[T cmp.Ordered](xs ...T) T` when called with zero args?

<details>
<summary>Answers</summary>

1. The compiler cannot infer `T` because `T` only appears in the return type.
2. `["go", "go", "go"]`.
3. Type-safe at compile time, no boxing, can use `+`, `<`.
4. No.
5. It must produce some value but there is no element to return — typically you'd panic or change the signature to `(first T, rest ...T)`.

</details>

---

## Tricky Questions

**Q1.** Will inference succeed for `func Foo[T any](f func() T) T { return f() }` if I call `Foo(func() int { return 1 })`?
**A.** Yes — the closure's return type pins down `T`.

**Q2.** Will it succeed for `Foo(nil)`? **A.** No — `nil` has no type information.

**Q3.** What if I write `var f func() int = nil; Foo(f)`? **A.** Yes, because `f` has a typed type even though its value is nil.

**Q4.** Does `func Filter[T any](xs []T, p func(T) bool) []T` allocate when nothing matches?
**A.** With `make([]T, 0, len(xs))` it allocates the capacity. With `xs[:0:0]` it shares the backing array but returns length 0. Choose based on whether you want to mutate `xs` afterwards.

**Q5.** Why prefer `cmp.Ordered` over a hand-rolled `Ordered`?
**A.** It's standard, well tested, and the compiler may optimize against it.

---

## Cheat Sheet

```go
// Inference works
Map([]int{1,2}, strconv.Itoa)

// Inference fails — only return uses T
v := Make()           // ERROR
v := Make[int]()      // OK

// Multiple type params
func Map[T, U any](xs []T, f func(T) U) []U

// Closure factory
func Adder[T Numeric](base T) func(T) T

// Variadic
func Concat[T any](xs ...[]T) []T

// Constraint composition
type Numeric interface { Integer | Float }

// Recursion
func Walk[T any](t *Tree[T], visit func(T))
```

---

## Summary

At the middle level the focus shifts from "how do I write a generic function?" to "how do I write a **good** generic function?" That means knowing precisely when type inference will work, what the cost of multiple type parameters looks like, and how to package small generic helpers in a way that benefits the whole team. The patterns shown here — closure factories, recursion, variadic helpers, composed constraints — appear in real production Go code every day.

[← junior.md](./junior.md) · [senior.md →](./senior.md)
