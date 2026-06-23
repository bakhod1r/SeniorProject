# Generic Pitfalls — Junior Level

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
> Focus: the **top 5 generic pitfalls** every junior should know.

Generics in Go are a powerful tool, but they introduce a fresh set of mistakes that the compiler does not catch. The five we will cover in this file are the ones every junior trips on within their first week of writing generic code:

1. The **zero value of `T`** — you cannot write `T{}` for an arbitrary type parameter.
2. **`nil` checks on a generic pointer `T`** — confusing because the rules depend on what `T` is.
3. **`any` vs `interface{}`** — they are aliases, but mixing them looks like it should fail and looks like it should succeed in turns.
4. **Type-switching on `T`** — does not work directly; you must convert to `any` first.
5. **Type-inference failures with multiple constraints** — the compiler gives up sooner than you expect.

Each of these pitfalls **compiles** at first glance, or fails with an error message that is much less helpful than the situation deserves. After reading this file you will:

- Know how to produce a zero `T` correctly
- Understand how `nil` interacts with generic pointer types
- Stop wondering whether `any` and `interface{}` differ
- Know when to add `any(v)` to make a type switch compile
- Recognize when type inference is failing because of constraint shape, not your fault

```go
// Surprise #1: this does NOT compile
func zeroOf[T any]() T {
    return T{} // ❌ — only valid for some T's
}

// Fix
func zeroOf[T any]() T {
    var zero T
    return zero
}
```

The body looks innocuous. The error message is short. The fix is one line. But if you do not know the rule, you will spend ten minutes searching.

---

## Prerequisites
- Basic generic syntax (`[T any]`, `[K comparable, V any]`)
- Familiarity with `nil`, `interface{}`, and zero values
- Have written at least one generic function before

---

## Glossary

| Term | Definition |
|------|------------|
| **Pitfall** | Code that compiles but behaves surprisingly |
| **Zero value** | The default value of a type (`0`, `""`, `nil`, etc.) |
| **Type parameter** | A name for a type, declared inside `[ ]` |
| **`any`** | Predeclared alias for `interface{}` |
| **Type switch** | `switch v := x.(type) { case T: ... }` |
| **Type inference** | Compiler picking the type argument automatically |
| **Constraint** | The interface that limits which types satisfy a parameter |
| **Boxing** | Wrapping a concrete value in an `interface{}` |

---

## Core Concepts

### Pitfall 1 — Zero value of `T`

Inside a generic function you cannot write `T{}` for arbitrary `T`. The composite literal syntax is only valid for struct, array, slice, and map types — and at the moment the compiler types the body, `T` is still a placeholder.

```go
// ❌
func New[T any]() T { return T{} }
```

The fix is `var zero T` or `*new(T)`:

```go
// ✓
func New[T any]() T {
    var zero T
    return zero
}

// equivalent
func New[T any]() T { return *new(T) }
```

`var zero T` zero-initializes any type. `new(T)` returns `*T` pointing to a zero `T`; dereferencing it gives the zero. Both produce the same value. Use the first; it is the idiomatic Go pattern.

### Pitfall 2 — `nil` on a generic pointer `T`

```go
func IsNil[T any](v T) bool {
    return v == nil // ❌ does not compile in general
}
```

`==` against `nil` is only valid when `T`'s constraint guarantees the operation. You either need `comparable` plus a type that compares to `nil`, or you must restrict the constraint to pointer-shaped types. A typical workaround uses `any`:

```go
func IsNil[T any](v T) bool {
    return any(v) == nil // ✓ — but careful, see notes
}
```

Even this has subtle traps: a typed nil pointer wrapped in `any` is **not** equal to a bare `nil`. `any((*int)(nil)) == nil` returns `false` because the interface has a non-nil type tag.

The correct pattern when you really need "is this T's zero value":

```go
func IsZero[T comparable](v T) bool {
    var zero T
    return v == zero
}
```

Use this. It expresses intent, compiles cleanly, and works for all comparable types.

### Pitfall 3 — `any` vs `interface{}`

```go
var a any = 1
var b interface{} = 1
fmt.Println(a == b) // true — they are the same type
```

Since Go 1.18, `any` is a predeclared alias for `interface{}`. They are **the same type**. Yet new juniors get confused because:

- Some codebases mix both styles
- Method sets look different in IDE hovers
- Older tutorials use `interface{}` and newer ones use `any`

The rule: in **new code**, prefer `any`. In **old code**, leave `interface{}` alone unless you are doing a coordinated cleanup. Mixing them in one file is fine semantically but ugly.

### Pitfall 4 — Type switching on `T`

```go
func Describe[T any](v T) string {
    switch v.(type) { // ❌
    case int: return "int"
    case string: return "string"
    }
    return "?"
}
```

Type assertions and type switches are only valid on **interface** values. `T` is a type parameter, not necessarily an interface. The fix is to first convert through `any`:

```go
func Describe[T any](v T) string {
    switch any(v).(type) { // ✓
    case int: return "int"
    case string: return "string"
    }
    return "?"
}
```

But pause before doing this. If you find yourself type-switching on `T`, **you wrote an interface in disguise**. Use a real interface with methods instead. See the senior file for a deeper discussion.

### Pitfall 5 — Inference failures with multiple constraints

```go
func Combine[T any, U any](a T, b U) (T, U) { return a, b }

x, y := Combine[int](1, "hi") // T=int given; U inferred as string
```

That works. But this fails:

```go
func Make[T, U any](f func(T) U) U {
    var t T
    return f(t)
}

r := Make(func(int) string { return "" }) // T=int? U=string? ❌
```

Inference works **forward** from arguments to type parameters, but cannot always work **backward** through function types. You may have to write:

```go
r := Make[int, string](func(int) string { return "" })
```

Inference improvements ship every Go release, so what failed in 1.18 may compile in 1.21+. When in doubt, instantiate explicitly.

---

## Real-World Analogies

**Analogy 1 — A hotel suite key**

Your generic `T` is like a master key that opens "any room". You cannot use it to start a specific car — even though "key" is in its name. `var zero T` is asking for "an empty room of whatever type the suite is".

**Analogy 2 — Form letter with placeholders**

`T{}` is like writing "Dear [NAME]," and signing the letter without filling in the name. Until you instantiate the function, `T` has no shape — it cannot be constructed with `{}`.

**Analogy 3 — `any` and `interface{}` are like USA and U.S.A.**

They mean the same thing. Some style guides prefer one. Mixing them is a style problem, not a correctness problem.

**Analogy 4 — Type switch on `T` is asking a sealed envelope what is inside**

The envelope is `T` — its shape is fixed, but its content (the dynamic type) is unknown. To peek inside you have to open the envelope first by converting to `any`.

---

## Mental Models

### Model 1 — "T is a placeholder until instantiated"

While reading a generic function, mentally rewrite every `T` as `<placeholder>`. Operations that need to know the concrete shape — `T{}`, `==`, `<`, `len(v)` — are illegal until the placeholder is filled.

### Model 2 — "Constraints are contracts"

Every operation in the body must be permitted by the constraint. `+` requires a numeric constraint, `==` requires `comparable`, `<` requires `cmp.Ordered`. If the body uses an operation the constraint does not allow, the body does not compile.

### Model 3 — "any(v) is an explicit unbox/box hatch"

Whenever you write `any(v)` inside a generic body, you are escaping the type system to do something the compiler refused. This is legal, but it should make you pause: maybe an interface fits better.

### Model 4 — "Pitfalls compile, limitations do not"

A **limitation** is a feature Go does not have (e.g., method type parameters). A **pitfall** is a feature Go does have but you used incorrectly. This file is about pitfalls.

---

## Pros & Cons

### Pros of knowing these pitfalls

| Benefit | Why it matters |
|---------|----------------|
| Faster debugging | You spot the cause in seconds, not minutes |
| Cleaner code | You avoid the workaround dance |
| Better reviews | You catch teammates' bugs |
| Confidence | You stop second-guessing the compiler |

### Cons of ignoring them

| Drawback | Why it matters |
|----------|----------------|
| Lost time | Hours per pitfall while learning |
| Silent bugs | Some pitfalls compile and misbehave |
| Wrong abstractions | Type-switching on `T` is a code smell that hides a missing interface |

---

## Use Cases

These pitfalls show up most in:

1. **Generic helpers in utility packages** — `Map`, `Filter`, `Find`, `Zero`
2. **Generic data structures** — stacks, queues, trees
3. **Generic optional/result wrappers** — `Option[T]`, `Result[T]`
4. **Generic event buses** — where type switches creep in
5. **Generic configuration loaders** — where `nil` checks on the result tempt you

A junior writes ten generic functions. Five of them hit at least one of these pitfalls.

---

## Code Examples

### Example 1 — Producing a zero value safely

```go
package main

import "fmt"

func First[T any](s []T) T {
    var zero T
    if len(s) == 0 {
        return zero
    }
    return s[0]
}

func main() {
    fmt.Println(First([]int{}))        // 0
    fmt.Println(First([]string{}))     // ""
    fmt.Println(First([]float64{1.5})) // 1.5
}
```

### Example 2 — `IsZero` for any comparable

```go
func IsZero[T comparable](v T) bool {
    var zero T
    return v == zero
}

func main() {
    fmt.Println(IsZero(0))      // true
    fmt.Println(IsZero(""))     // true
    fmt.Println(IsZero(1))      // false
    fmt.Println(IsZero("hi"))   // false
}
```

### Example 3 — Type switch via `any`

```go
func Describe[T any](v T) string {
    switch x := any(v).(type) {
    case int:
        return fmt.Sprintf("int %d", x)
    case string:
        return fmt.Sprintf("string %q", x)
    default:
        return "unknown"
    }
}
```

### Example 4 — Inference failure, manual fix

```go
func MapKey[K comparable, V any](m map[K]V, key K) V {
    return m[key]
}

func main() {
    m := map[string]int{"a": 1}
    v := MapKey(m, "a") // OK, both K and V inferred from m
    fmt.Println(v)

    // Inference fails when K and V are not in the same map
    // Then you must specify
    var ms map[string]int
    _ = MapKey[string, int](ms, "x")
}
```

### Example 5 — `any` vs `interface{}` — same type

```go
func main() {
    var a any = 42
    var b interface{} = 42
    fmt.Println(a == b) // true
    fmt.Println(reflect.TypeOf(a) == reflect.TypeOf(b)) // true
}
```

### Example 6 — Why `nil` check fails for typed-nil pointer

```go
func notNil[T any](v T) bool {
    return any(v) != nil
}

var p *int = nil
fmt.Println(notNil(p)) // true — because any(p) has a non-nil type tag
```

The wrapper `any(p)` carries the type `*int`, so the interface is not nil even though the pointer inside is. This is the same gotcha that exists with `error` and typed-nil interfaces in non-generic code. Generics simply expose it more often.

---

## Coding Patterns

### Pattern 1 — `var zero T` early in the body

If your function might return a "no value" case, declare `var zero T` at the top. Do it once and reuse:

```go
func Find[T comparable](s []T, p T) (T, bool) {
    var zero T
    for _, v := range s {
        if v == p { return v, true }
    }
    return zero, false
}
```

### Pattern 2 — Convert through `any` only at the boundary

If you must type-switch, do it once at the API boundary:

```go
func Encode[T any](v T) ([]byte, error) {
    return json.Marshal(any(v))
}
```

Inside the rest of the body, keep `v` as `T`.

### Pattern 3 — Tighten constraints later

Start with `any`. Add `comparable` only when you need `==`. Add `cmp.Ordered` only when you need `<`. Tightening late is a non-breaking change for callers who already supplied a satisfying type.

### Pattern 4 — Prefer `IsZero[T comparable]` over `nil` checks

Most "is this empty" checks in generic code map cleanly to "equal to zero value". Use `IsZero`, document it, move on.

---

## Clean Code

- **Always declare `var zero T` once** if you will return zero in multiple branches.
- **Avoid `T{}` everywhere** — it works only for some `T`.
- **Use `any` in new code**, not `interface{}`.
- **Reach for `any(v)` deliberately** — it is a hatch, not a habit.
- **Document type-switch decisions** — a comment "we type-switch here because the API allows arbitrary numeric types" is worth more than the switch itself.

---

## Product Use / Feature

These pitfalls show up most in **library code**, where generic helpers are reused by many callers. Common product surfaces affected:

1. **HTTP middleware** — generic decoders that return zero on failure
2. **Caches** — typed `Cache[K, V]` with "not found" branches
3. **Validators** — generic rules with optional fields
4. **Background workers** — generic job runners that must report "no work"

Each scenario has a "no value" case where the zero pitfall arises.

---

## Error Handling

Combining errors with generics introduces its own surprises:

```go
func MustGet[T any](v T, err error) T {
    if err != nil { panic(err) }
    return v
}
```

This is fine. But:

```go
func MaybeGet[T any](v T, err error) (T, bool) {
    if err != nil {
        var zero T
        return zero, false
    }
    return v, true
}
```

is what you usually want. Many juniors write the first form and then complain that the program panics in production. The lesson: **prefer `(T, bool)` returns** in generic helpers; let callers decide what "no value" means.

---

## Security Considerations

- **Untrusted input to a generic decoder** still needs validation. Generics give you the **type**, not the **invariant**.
- **Reflection on generic types** is harder to reason about — do not trust `reflect.TypeOf(v)` to be `T` if `v` is `any` somewhere in the chain.
- **Be careful with `any(v) == nil`** — the typed-nil trap can mask security checks ("the pointer was nil, but my generic IsNil said no").

---

## Performance Tips

- `var zero T` is **free** at runtime — compiled to zero-initialization.
- `any(v)` may **box** the value if `T` is non-pointer-shaped. Avoid in tight loops.
- Type switches on `any(v)` involve a runtime type lookup. The cost is small but non-zero.
- For hot paths, see `optimize.md` in this topic.

---

## Best Practices

1. **Start with the loosest constraint** that makes the body compile.
2. **Add `var zero T`** once, near the top of the function.
3. **Never write `T{}`** — it is a beginner trap.
4. **Use `any` consistently** in new code.
5. **Type-switch on `T` is a smell**. Stop and ask "should this be an interface?"
6. **Run `go vet`** — it catches some inference and constraint mistakes.
7. **Test with at least two `T`s** — pitfalls hide when you only test one.

---

## Edge Cases & Pitfalls

The five pitfalls again, in pitfall language:

| Pitfall | Compiles? | Behaves? | Fix |
|---------|-----------|----------|-----|
| `T{}` | ❌ | n/a | `var zero T` |
| `v == nil` for `T any` | ❌ | n/a | `IsZero` or restrict constraint |
| Mixing `any`/`interface{}` | ✓ | ✓ | Pick one; preference is `any` |
| Type switch on `T` | ❌ | n/a | `any(v).(type)` |
| Inference with hidden T | ❌ | n/a | Specify explicitly |

Plus a sixth that bites later: `any(typedNil) == nil` returns `false`. Memorize this.

---

## Common Mistakes

1. **Reaching for reflection** before trying `var zero T`.
2. **Writing `if v == nil`** in generic code without realising the constraint forbids it.
3. **Confusing `any` with `comparable`** — one accepts everything, one accepts only types you can `==`.
4. **Sprinkling `any(...)` everywhere** as a workaround instead of picking the right constraint.
5. **Forgetting `*new(T)`** is also valid (it is — but `var zero T` is preferred).
6. **Thinking type switch on `T` "just works"** — it does not.

---

## Common Misconceptions

- **"`T{}` works for struct types"** — only when `T` is **constrained** to a specific struct type. For arbitrary `T any`, it does not compile.
- **"`any` is more permissive than `interface{}`"** — they are identical.
- **"`nil` check on `T any` always works"** — only after `any(v) == nil`, and even then you have the typed-nil pitfall.
- **"Inference is magic"** — it follows specific rules; if it fails, you can usually predict why.

---

## Tricky Points

1. **Typed-nil unwrapping**: `any((*int)(nil))` is not `nil`.
2. **Slice-typed `T`**: `var zero T` for `T = []int` is `nil`, not `[]int{}`.
3. **Map-typed `T`**: same — zero value is `nil`, not `map[K]V{}`. Calling methods on it panics or no-ops depending on operation.
4. **`T` may be an interface itself**: `T any` does not mean "T is concrete". A caller can pass an interface as `T`.
5. **Pre-1.21 inference is weaker**: code that fails inference today may compile on 1.21+.

---

## Test

1. Write the correct way to produce a zero value of `T`.
2. Why does `T{}` not compile in `func F[T any]() T`?
3. Are `any` and `interface{}` the same type?
4. How do you type-switch on a value of type `T`?
5. Why does `any((*int)(nil)) == nil` return `false`?
6. When does `IsZero[T comparable](v T) bool` not work?
7. What is the recommended way to express "is this T empty"?
8. When does Go's type inference fail?

(Answers: 1) `var zero T`. 2) `T` may not be a struct. 3) Yes, `any` is an alias. 4) `switch any(v).(type)`. 5) The interface holds `(type=*int, data=nil)`. 6) When `T` is a non-comparable type. 7) `IsZero` with `comparable` constraint. 8) When the type parameter only appears in the return type or behind a function type.)

---

## Tricky Questions

**Q1.** What does this print?
```go
func IsNil[T any](v T) bool { return any(v) == nil }
var p *int
fmt.Println(IsNil(p))
```
**A.** `false`. The interface holds the type `*int` with a nil data pointer; comparing to bare `nil` is false.

**Q2.** Why does this not compile?
```go
func New[T any]() T { return T{} }
```
**A.** `T{}` is a composite literal — only valid for struct/array/slice/map types. `T` could be `int`, where `int{}` is invalid.

**Q3.** What is the difference between `var zero T` and `*new(T)`?
**A.** Functionally none — both produce the zero value of `T`. Stylistically, `var zero T` is preferred.

**Q4.** Will this compile?
```go
func Eq[T any](a, b T) bool { return a == b }
```
**A.** No. `==` requires `comparable`. Change `any` to `comparable`.

**Q5.** Does this compile?
```go
func Map[T, U any](f func(T) U) U {
    var t T
    return f(t)
}
m := Map(func(int) string { return "" })
```
**A.** Inference may fail because `T` and `U` are inside a function type. Specify explicitly: `Map[int, string](...)`.

---

## Cheat Sheet

```go
// Zero value
var zero T

// IsZero check
var zero T; if v == zero { ... } // T comparable

// Type switch
switch any(v).(type) { ... }

// any vs interface{}
type any = interface{} // they are the same

// Inference failure
F[ConcreteT, ConcreteU](args) // explicit instantiation
```

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Zero | "T is not a struct" | `var zero T` |
| Nil | "cannot use nil" | `IsZero` |
| any/iface{} | mixing styles | pick `any` |
| Switch on T | "non-interface type" | wrap with `any()` |
| Inference | "cannot infer T" | give it explicitly |

---

## Self-Assessment Checklist

- [ ] I can write `var zero T` reflexively.
- [ ] I know why `T{}` fails.
- [ ] I have stopped using `interface{}` in new code.
- [ ] I know `any(v).(type)` is the type-switch idiom.
- [ ] I can identify a typed-nil pitfall.
- [ ] I know when to switch from `any` to `comparable`.
- [ ] I have hit at least one inference failure and resolved it.
- [ ] I read constraint shape before reading function body.

If 6 boxes are ticked, advance to `middle.md`.

---

## Summary

The five junior pitfalls are: zero value of `T`, `nil` checks on a generic, `any`/`interface{}` confusion, type-switching on `T`, and inference failures. They all share a common thread: the compiler is **strict about what `T` allows** until you instantiate it, and many natural-looking expressions (`T{}`, `v == nil`, `v.(type)`) silently sit on the wrong side of that line.

Memorize three idioms: `var zero T`, `IsZero[T comparable]`, and `switch any(v).(type)`. With those three plus a habit of explicit instantiation when inference flakes, the first week of generic code becomes much smoother.

---

## What You Can Build

Now that you can avoid junior pitfalls, you can confidently build:

1. A safe generic `First[T any](s []T) (T, bool)` helper
2. A generic `IsZero[T comparable]` and a paired `Coalesce[T comparable]`
3. A typed `Optional[T any]` wrapper with `Get` and `OrElse`
4. A small `Map[K, V]` cache with proper "not found" semantics
5. A generic `Result[T any]` that does **not** abuse `nil`

---

## Further Reading

- [The Go Blog — Type Parameters Proposal Q&A](https://go.dev/blog/intro-generics)
- [Effective Go — zero values](https://go.dev/doc/effective_go#composite_literals)
- [The Go FAQ on `nil` interfaces](https://go.dev/doc/faq#nil_error)
- [`cmp.Or` documentation](https://pkg.go.dev/cmp#Or)

---

## Related Topics

- **4.10 Generic Limitations** — what generics cannot express
- **4.7 Generic Performance** — when pitfalls become slow paths
- **3.2 Interfaces** — the right tool when you would type-switch on `T`
- **2.x Variables and Constants** — zero values in non-generic code

---

## Diagrams & Visual Aids

### The five junior traps

```
+-------------------------------------------+
| 1. T{}              -> var zero T         |
| 2. v == nil         -> IsZero[T comparable]
| 3. any vs iface{}   -> pick `any`         |
| 4. v.(type)         -> any(v).(type)      |
| 5. lost inference   -> instantiate manually
+-------------------------------------------+
```

### Typed-nil escape route

```
*int(nil)       --any(...)-->     interface{(*int), nil}
                                          |
                              compares to bare nil?
                                          |
                                         NO
```

### Constraint contract

```
T any         -> only assignment, return, method-less ops
T comparable  -> +  ==, !=
T cmp.Ordered -> +  <, <=, >, >=
T Number      -> +  +, -, *, /
```
