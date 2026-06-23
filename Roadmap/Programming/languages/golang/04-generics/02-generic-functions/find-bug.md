# Generic Functions — Find the Bug

## Table of Contents
1. [Introduction](#introduction)
2. [How to Use This Page](#how-to-use-this-page)
3. [Bugs](#bugs)
4. [Cheat Sheet of Failure Modes](#cheat-sheet-of-failure-modes)
5. [Summary](#summary)

---

## Introduction

15+ buggy generic functions. For each:
1. Read the code
2. Predict what goes wrong
3. Read the **Hint**
4. Then the **Fix** with explanation

Bugs cover: missing constraints, wrong type-parameter usage, incorrect instantiation, type-inference failures, surprising runtime behavior.

---

## How to Use This Page

- Try compiling each snippet in your head before reading the hint.
- Try the fix yourself before checking the solution.
- Many bugs reproduce in real life: the same patterns appear on Stack Overflow weekly.

---

## Bugs

### Bug 1 — Missing constraint for `+`

```go
func Sum[T any](xs []T) T {
    var s T
    for _, x := range xs {
        s += x
    }
    return s
}
```

<details>
<summary>Hint</summary>

What does `any` allow you to do with `T`?

</details>

<details>
<summary>Fix</summary>

`any` does not permit the `+` operator. Add a numeric constraint:

```go
type Numeric interface {
    ~int | ~int64 | ~float32 | ~float64
}

func Sum[T Numeric](xs []T) T {
    var s T
    for _, x := range xs {
        s += x
    }
    return s
}
```

**Explanation:** Operations on a type parameter are allowed only when **every** type in the constraint's type set permits them. With `any`, the type set is "all types," and `+` is not defined for all types (e.g. `bool`).

</details>

---

### Bug 2 — Inference fails for return-only `T`

```go
func Make[T any]() T {
    var z T
    return z
}

x := Make()
fmt.Println(x)
```

<details>
<summary>Hint</summary>

What types does the call site provide to the compiler?

</details>

<details>
<summary>Fix</summary>

```go
x := Make[int]()
```

**Explanation:** When `T` appears only in the return type and not in any argument, type inference cannot deduce it. You must instantiate explicitly.

</details>

---

### Bug 3 — Method with its own type parameter

```go
type Box[T any] struct{ V T }

func (b Box[T]) MapTo[U any](f func(T) U) Box[U] {
    return Box[U]{V: f(b.V)}
}
```

<details>
<summary>Hint</summary>

What restriction does Go impose on methods?

</details>

<details>
<summary>Fix</summary>

Move the second type parameter to a free function:

```go
func MapBox[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{V: f(b.V)}
}
```

**Explanation:** Methods cannot introduce type parameters of their own; they inherit only the receiver type's parameters. The compiler error is: *"method must have no type parameters"*.

</details>

---

### Bug 4 — `~` token forgotten for defined types

```go
type Number interface { int | float64 }

func Double[T Number](x T) T { return x * 2 }

type Cents int
var c Cents = 50
Double(c) // compile error
```

<details>
<summary>Hint</summary>

What is the underlying type of `Cents`?

</details>

<details>
<summary>Fix</summary>

```go
type Number interface { ~int | ~float64 }
```

**Explanation:** Without the `~` token, only the literal types `int` and `float64` are allowed. `Cents` has underlying type `int` but is not literally `int`. The `~` admits any defined type with the matching underlying.

</details>

---

### Bug 5 — Mixed untyped constant inference

```go
func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}

m := Min(1, 2.0) // compile error
```

<details>
<summary>Hint</summary>

What types do `1` and `2.0` default to?

</details>

<details>
<summary>Fix</summary>

Either convert one operand or be explicit:

```go
m := Min[float64](1, 2.0) // explicit T
m := Min(1.0, 2.0)        // both float64
```

**Explanation:** `1` defaults to `int`, `2.0` defaults to `float64`. The compiler can't unify them into a single `T`.

</details>

---

### Bug 6 — Comparing slice values

```go
func Equal[T any](a, b T) bool {
    return a == b
}

Equal([]int{1}, []int{1}) // compile error
```

<details>
<summary>Hint</summary>

Is `==` defined for slices?

</details>

<details>
<summary>Fix</summary>

Use the `comparable` constraint:

```go
func Equal[T comparable](a, b T) bool {
    return a == b
}
```

For slices specifically you can't compare with `==` — use `slices.Equal[T comparable](a, b []T) bool` from the `slices` package, or write a deep-compare yourself.

**Explanation:** `any` permits any type, but `==` requires `comparable`. Slices are not comparable.

</details>

---

### Bug 7 — Unused type parameter

```go
func Process[T any, U any](x T) T {
    return x
}
```

<details>
<summary>Hint</summary>

Why is `U` declared?

</details>

<details>
<summary>Fix</summary>

Remove `U`:

```go
func Process[T any](x T) T { return x }
```

**Explanation:** Unused type parameters add cognitive load and force callers to specify or infer them unnecessarily. Drop them.

</details>

---

### Bug 8 — Forgetting that `T(int)` requires constraint

```go
func Half[T any](x T) T {
    return T(int(x) / 2) // compile error
}
```

<details>
<summary>Hint</summary>

What does `int(x)` require?

</details>

<details>
<summary>Fix</summary>

Constrain `T` so the conversion is valid:

```go
func Half[T ~int | ~int64](x T) T {
    return T(int64(x) / 2)
}
```

**Explanation:** `int(x)` is only valid when `T`'s type set contains types convertible to `int`. With `any`, this includes types like `string` for which the conversion fails.

</details>

---

### Bug 9 — `fmt.Stringer` constraint and value vs pointer receiver

```go
type Greeter interface {
    Hello() string
}

type EnglishGreeter struct{ Name string }

func (g *EnglishGreeter) Hello() string { return "Hello, " + g.Name }

func Greet[T Greeter](g T) string { return g.Hello() }

g := EnglishGreeter{Name: "Ada"}
Greet(g) // compile error
```

<details>
<summary>Hint</summary>

What is the method set of `EnglishGreeter`?

</details>

<details>
<summary>Fix</summary>

Pass a pointer:

```go
Greet(&g) // T = *EnglishGreeter
```

**Explanation:** `Hello()` is declared with a pointer receiver, so the method set of `EnglishGreeter` (value type) does NOT include it. `*EnglishGreeter` does. Generics use the same method set rules as interfaces.

</details>

---

### Bug 10 — Using `interface{}` instead of `any`

```go
func Print[T interface{}](x T) {
    fmt.Println(x)
}
```

<details>
<summary>Hint</summary>

It compiles — but does it follow modern style?

</details>

<details>
<summary>Fix</summary>

```go
func Print[T any](x T) { fmt.Println(x) }
```

**Explanation:** `any` and `interface{}` are aliases — but `any` is the modern, idiomatic form. Keep style consistent.

</details>

---

### Bug 11 — Range over a generic-typed map

```go
func KeysSorted[K, V any](m map[K]V) []K {
    keys := make([]K, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }
    sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
    return keys
}
```

<details>
<summary>Hint</summary>

What constraints does `map[K]V` require? What does `<` need?

</details>

<details>
<summary>Fix</summary>

```go
func KeysSorted[K cmp.Ordered, V any](m map[K]V) []K { ... }
```

**Explanation:** Map keys must be `comparable`, but the function uses `<`. `cmp.Ordered` is the right constraint — it implies `comparable` and adds ordering.

</details>

---

### Bug 12 — Closure capture of loop variable

```go
func MakeAdders[T int | float64](xs []T) []func(T) T {
    var fs []func(T) T
    for _, x := range xs {
        fs = append(fs, func(y T) T { return x + y })
    }
    return fs
}

// Pre-Go 1.22: all closures return the last x + y
```

<details>
<summary>Hint</summary>

In pre-1.22 Go, what is the lifetime of `x` in a `for ... range`?

</details>

<details>
<summary>Fix</summary>

For Go versions < 1.22, shadow `x` inside the loop:

```go
for _, x := range xs {
    x := x
    fs = append(fs, func(y T) T { return x + y })
}
```

In Go 1.22+, the loop variable is per-iteration and the original code works correctly.

**Explanation:** This is not generics-specific — but it bites generics users because `MakeAdders` looks like a useful helper and the bug is invisible until called.

</details>

---

### Bug 13 — Empty type set

```go
type Weird interface { int; string }

func F[T Weird](x T) T { return x } // legal but uncallable
```

<details>
<summary>Hint</summary>

Can a single type be both `int` and `string`?

</details>

<details>
<summary>Fix</summary>

Use `|` instead of `;`:

```go
type Number interface { int | string }
```

**Explanation:** Inside an interface, `;` separates **independent** elements that all must hold. The intersection of `int` and `string` is empty, so no type can satisfy `Weird`. The compiler permits the declaration but every call site fails.

</details>

---

### Bug 14 — Pointer-of-zero gotcha

```go
func Default[T any](p *T) T {
    if p == nil {
        var z T
        return z
    }
    return *p
}
```

<details>
<summary>Hint</summary>

This compiles — but what's the bug if `T` is itself a pointer?

</details>

<details>
<summary>Fix</summary>

If `T = *Foo`, the zero value is `(*Foo)(nil)`, which the function returns. That's fine, but the caller may be confused. Document the behavior or refactor:

```go
// Default returns *p if p is non-nil; otherwise the zero value of T.
// If T is itself a pointer type, the returned zero value is nil.
```

**Explanation:** Not strictly a bug — but a subtlety to remember. `var z T` always returns the zero value of T, even when T is a pointer.

</details>

---

### Bug 15 — Unintended copy of large struct

```go
func MaxBy[T any, K cmp.Ordered](xs []T, key func(T) K) (T, bool) {
    if len(xs) == 0 { var z T; return z, false }
    best := xs[0]
    for _, x := range xs[1:] {
        if key(x) > key(best) {
            best = x
        }
    }
    return best, true
}
```

<details>
<summary>Hint</summary>

If `T` is a struct of 1KB, what is the cost of `best := xs[0]` and `best = x`?

</details>

<details>
<summary>Fix</summary>

For very large `T`, work with indices:

```go
func MaxByIdx[T any, K cmp.Ordered](xs []T, key func(T) K) (T, bool) {
    if len(xs) == 0 { var z T; return z, false }
    bestIdx := 0
    bestKey := key(xs[0])
    for i := 1; i < len(xs); i++ {
        k := key(xs[i])
        if k > bestKey { bestIdx, bestKey = i, k }
    }
    return xs[bestIdx], true
}
```

**Explanation:** Generic functions copy values just like ordinary functions. Large struct types incur copy costs at every assignment. For tiny types, the original code is fine.

</details>

---

### Bug 16 — Missing `comparable` for set semantics

```go
func ToSet[T any](xs []T) map[T]struct{} {
    out := make(map[T]struct{}, len(xs))
    for _, x := range xs {
        out[x] = struct{}{}
    }
    return out
}
```

<details>
<summary>Hint</summary>

What does `map[T]struct{}` require of `T`?

</details>

<details>
<summary>Fix</summary>

```go
func ToSet[T comparable](xs []T) map[T]struct{} { ... }
```

**Explanation:** Map keys must satisfy the `comparable` constraint. `any` is too loose.

</details>

---

### Bug 17 — Calling a method that doesn't exist on T

```go
func Stringify[T any](xs []T) []string {
    out := make([]string, len(xs))
    for i, x := range xs {
        out[i] = x.String() // compile error
    }
    return out
}
```

<details>
<summary>Hint</summary>

Does `any` guarantee a `String()` method?

</details>

<details>
<summary>Fix</summary>

```go
func Stringify[T fmt.Stringer](xs []T) []string {
    out := make([]string, len(xs))
    for i, x := range xs {
        out[i] = x.String()
    }
    return out
}
```

**Explanation:** A method may be called on a type parameter only when the constraint guarantees the method. `any` does not.

</details>

---

### Bug 18 — `~T` confusion with named pointer types

```go
type MyInt int
type MyIntPtr *MyInt

type IntLike interface { ~int }

var p MyIntPtr
F(p) // compile error if F expects IntLike
```

<details>
<summary>Hint</summary>

What is the underlying type of `MyIntPtr`?

</details>

<details>
<summary>Fix</summary>

The underlying type of `MyIntPtr` is `*MyInt`, not `int`. `~int` doesn't accept it. Pass `*p`:

```go
F(*p) // T = MyInt — underlying int — accepted
```

**Explanation:** Approximation matches **underlying** types. Pointer types have pointer underlyings, not the type pointed to.

</details>

---

### Bug 19 — Forgetting context cancellation in `ParallelMap`

```go
func ParallelMap[T, U any](xs []T, f func(T) U) []U {
    out := make([]U, len(xs))
    var wg sync.WaitGroup
    for i, x := range xs {
        wg.Add(1)
        go func(i int, x T) {
            defer wg.Done()
            out[i] = f(x)
        }(i, x)
    }
    wg.Wait()
    return out
}
```

<details>
<summary>Hint</summary>

What if you have a million elements?

</details>

<details>
<summary>Fix</summary>

Add `context.Context` and bounded concurrency:

```go
func ParallelMap[T, U any](
    ctx context.Context, xs []T, n int,
    f func(context.Context, T) (U, error),
) ([]U, error) {
    // bounded errgroup — see professional.md
}
```

**Explanation:** Unbounded goroutines is a denial-of-service waiting to happen. Even small generic helpers must respect resource limits.

</details>

---

### Bug 20 — Using `==` to compare typed function values

```go
func IsSame[T any](a, b T) bool {
    return a == b // compile error if T is a func type
}
```

<details>
<summary>Hint</summary>

Are functions comparable in Go?

</details>

<details>
<summary>Fix</summary>

Restrict to `comparable`:

```go
func IsSame[T comparable](a, b T) bool { return a == b }
```

Or use `reflect.DeepEqual` for the rare cases where you actually need it.

**Explanation:** Functions are not comparable. `comparable` excludes them; `any` permits the type but disallows the operator at compile time.

</details>

---

## Cheat Sheet of Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `cannot use ... as T (T does not satisfy ...)` | Constraint missing or too tight | Loosen with `~T` or extend the union |
| `invalid operation: x op y (operator not defined for T)` | Operation not in type set | Tighten constraint |
| `cannot infer T` | T appears only in return | Instantiate explicitly |
| `cannot infer T (mismatched types int and float64)` | Untyped constants disagree | Convert one operand |
| `methods must have no type parameters` | Method declares its own | Use a free function |
| `interface contains type constraints` | Constraint used as runtime interface | Don't use as variable type |
| `... is not in interface` | Method receiver pointer/value mismatch | Pass `&v` or change receiver |

---

## Summary

The most common generic-function bugs cluster around three themes: **constraints too loose** (operators not defined), **inference failure** (return-only type parameter), and **method-set surprises** (pointer vs value receiver). Memorize these patterns and most everyday issues become quick to diagnose.

[← tasks.md](./tasks.md) · [optimize.md →](./optimize.md)
