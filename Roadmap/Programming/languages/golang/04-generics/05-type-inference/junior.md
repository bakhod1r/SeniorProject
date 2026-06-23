# Type Inference — Junior Level

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
> Focus: "What is type inference?" and "When does it work?"

In Go 1.18 generics arrived, and along with them came a feature that makes generic code much less verbose: **type inference**. When you call a generic function such as `Max[int](3, 5)`, you must normally provide the type argument `int` inside the square brackets. Type inference lets you drop the brackets entirely and write `Max(3, 5)` — the compiler figures out from the arguments that `T = int`.

```go
func Max[T int | float64](a, b T) T {
    if a > b { return a }
    return b
}

// Without inference (always works):
m1 := Max[int](3, 5)

// With inference (compiler infers T = int from arguments):
m2 := Max(3, 5)
```

Both forms are valid. The second is preferred because it is shorter and reads exactly like a non-generic call. The mechanism that lets the compiler decide `T = int` here is **function argument type inference (FTAI)**.

There are several different kinds of inference inside Go:
- **Function argument type inference** — derives type parameters from function arguments.
- **Constraint type inference** — derives type parameters from constraints (e.g. `~[]E` reveals `E`).
- **Untyped constant handling** — special rules when the argument is `1`, `"hello"`, `nil`, etc.

This file teaches you what works, what does not, and how to reason about it like a compiler.

After reading this file you will:
- Know what type inference is and why it exists.
- Recognize when Go can and cannot infer a type argument.
- Understand the difference between calling `Map(s, f)` and `Map[int, string](s, f)`.
- Avoid the most common inference failures.
- Read compile errors involving inference confidently.

---

## Prerequisites
- Basic Go syntax: variables, functions, slices.
- A working knowledge of generic functions: `func F[T any](x T) T`.
- Familiarity with `any`, `comparable`, and a custom constraint such as `Number`.
- Ability to run `go run main.go` and read compile errors.
- Go 1.21 or later is recommended (inference improved significantly in 1.21).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Type parameter** | A placeholder type written in `[T any]` brackets in a function signature. |
| **Type argument** | The actual type substituted for a type parameter at the call site, e.g. `int` in `Max[int](3, 5)`. |
| **Type inference** | The compiler's process of choosing type arguments without you writing them. |
| **Function argument type inference (FTAI)** | Inferring type arguments from the types of ordinary function arguments. |
| **Constraint type inference** | Inferring type arguments from the constraint structure (e.g. `~[]E` → `E`). |
| **Type unification** | The algorithm that compares two type expressions and finds substitutions that make them equal. |
| **Untyped constant** | A literal such as `1`, `"hi"`, `nil` that has no fixed type until context fixes one. |
| **Default type** | The type an untyped constant takes when no other context applies (e.g. `int` for integer literals). |
| **Named type / defined type** | A type declared with `type Name = ...` or `type Name ...`. |
| **Type set** | The set of types allowed by a constraint. |
| **Core type** | The single underlying type of a type set, when one exists. |
| **Instantiation** | Producing a concrete function from a generic by substituting types. |

---

## Core Concepts

### 1. What problem does inference solve?

Without inference, every generic call would need explicit brackets:

```go
nums := []int{1, 2, 3}
doubled := Map[int, int](nums, func(x int) int { return x * 2 })
```

This is noisy. The compiler can clearly see `nums` is `[]int` and the function takes `int` and returns `int`. Inference removes the brackets:

```go
doubled := Map(nums, func(x int) int { return x * 2 })
```

The signatures are still strongly typed; only the syntax is lighter.

### 2. Function argument type inference (FTAI)

FTAI matches each parameter type in the signature against the type of the corresponding argument and collects type-parameter substitutions.

```go
func Identity[T any](x T) T { return x }

Identity(42)        // arg has type int → T = int
Identity("hello")   // arg has type string → T = string
Identity(3.14)      // arg has type float64 → T = float64
```

For multi-parameter functions, all matches must agree.

```go
func Equal[T comparable](a, b T) bool { return a == b }

Equal(1, 2)        // both int → T = int
Equal("a", "b")    // both string → T = string
Equal(1, "a")      // ERROR: T cannot be both int and string
```

### 3. Constraint type inference

If a type parameter appears inside a constraint like `~[]E`, knowing the slice type tells you `E`.

```go
func First[S ~[]E, E any](s S) E {
    return s[0]
}

nums := []int{1, 2, 3}
v := First(nums) // S = []int → constraint matches ~[]E → E = int
_ = v             // v is int
```

You only had to provide `S` (via the argument). The compiler then derived `E` from the constraint shape — that is constraint type inference.

### 4. Untyped constants

Untyped constants are slippery:

```go
func Sum[T int | float64](a, b T) T { return a + b }

Sum(1, 2)        // both untyped int → default to int → T = int
Sum(1.0, 2.0)    // both untyped float → default to float64 → T = float64
Sum(1, 2.0)      // mixed: 1 can become float64, so T = float64
```

When a typed value is mixed with an untyped constant, the typed value usually wins:

```go
var x int = 5
Sum(x, 3) // x is int → T = int; 3 is untyped, becomes int
```

### 5. When inference fails

Inference can fail when:
- A type parameter does not appear in any function parameter (only in the return type).
- The argument is `nil` and there is no other clue.
- An untyped constant has no anchor.
- A typed function value has the wrong shape.

Examples:

```go
func Make[T any]() T { var z T; return z }

x := Make() // ERROR: cannot infer T
x := Make[int]() // OK
```

```go
func Map[T, U any](s []T, f func(T) U) []U { /* ... */ }

Map([]int{1,2,3}, strconv.Itoa) // works in 1.21+: strconv.Itoa is func(int) string
Map([]int{1,2,3}, fmt.Sprint)   // FAILS: fmt.Sprint is func(...any) string, not func(int) string
```

---

## Real-World Analogies

### 1. The chef and the order
A chef (compiler) reads "make a salad" (a generic call). Instead of asking the customer what cucumbers, tomatoes, and lettuce to use (explicit type arguments), the chef looks at what is on the tray (function arguments) and figures it out. If the tray is empty (no parameters use `T`), the chef has to ask.

### 2. The keyhole and the key
A constraint is the keyhole shape; an argument is a key. Inference is putting the key in the hole and reading the shape that fits. If two different keys (arguments) want to fit the same hole (parameter `T`), they had better have the same teeth.

### 3. Filling out a form
Some fields on a form auto-fill from your previous answers (constraint inference). Some have to be answered directly (function arguments). And some fields the form simply cannot guess — the website will mark them as required (you must write `[T]` explicitly).

### 4. Translation
You speak English to a translator who is fluent in many languages. From the words you said, the translator infers which language you meant. But if you say only "Hi", "Hi" exists in many forms — the translator may need you to specify.

---

## Mental Models

### Model 1: Two-step process
1. **FTAI**: walk parameters, collect substitutions from arguments.
2. **Constraint inference**: walk constraints, fill in remaining parameters.

If after both steps any parameter is still unknown, inference fails.

### Model 2: Unification
Think of every type-parameter equation as `T = something`. The compiler keeps a substitution map and adds entries as it inspects the signature against the call. Conflicts (two different `something`s for the same `T`) cause failure.

### Model 3: Compiler-eye view
Pretend you are the compiler. Look at the call. Cover the function with your hand and read only the argument types. Could you fill in the type parameters from what you see? If yes, inference will succeed. If no, you must be explicit.

### Model 4: Inference is a pretty-printer, not magic
Inference is purely a notational convenience. It never adds power — every program with inference can be rewritten with explicit `[T]` brackets. Use this to debug: when in doubt, write the brackets and see if the program compiles.

---

## Pros & Cons

### Pros
- Cleaner call sites — looks like a normal function call.
- Faster to write; less repetition.
- Easier to read in pipelines like `Filter(Map(...), p)`.
- Encourages library authors to design APIs whose argument shapes carry the type information.

### Cons
- Failures can be confusing for beginners.
- Some inference rules differ between Go versions (1.18 vs 1.21+).
- A single small change in a function signature can break inference in callers.
- Inference can silently pick a default type you did not intend (e.g. `int` for `1`).

---

## Use Cases

| Scenario | Inference behaviour |
|----------|--------------------|
| `Max(3, 5)` | Infers `T = int` from arguments. |
| `Max[float64](3, 5)` | Forces `T = float64`. |
| `Map(slice, func)` | Infers `T` from slice, `U` from function return (1.21+). |
| `Filter(slice, pred)` | Infers `T` from slice. |
| `Reduce(slice, init, f)` | Infers `T` from slice, `U` from `init`. |
| `Make[T]()` | Cannot infer (no argument carries `T`). |
| `Cast[U](x)` | Cannot infer `U` (return type only). |
| `Equal(a, b)` | Both args must agree on `T`. |

---

## Code Examples

### Example 1: Simple inference
```go
package main

import "fmt"

func Max[T int | float64 | string](a, b T) T {
    if a > b { return a }
    return b
}

func main() {
    fmt.Println(Max(3, 5))           // T = int → 5
    fmt.Println(Max(3.0, 2.5))       // T = float64 → 3
    fmt.Println(Max("apple", "pie")) // T = string → "pie"
}
```

### Example 2: Multi-parameter agreement
```go
func Pair[T any](a, b T) [2]T { return [2]T{a, b} }

p1 := Pair(1, 2)               // T = int
p2 := Pair("x", "y")           // T = string
// p3 := Pair(1, "x")          // ERROR: type argument inference failed
```

### Example 3: Map (Go 1.21+)
```go
func Map[T, U any](s []T, f func(T) U) []U {
    out := make([]U, len(s))
    for i, v := range s {
        out[i] = f(v)
    }
    return out
}

nums := []int{1, 2, 3}
strs := Map(nums, func(x int) string { return fmt.Sprintf("%d", x) })
// T = int, U = string — both inferred.
```

### Example 4: Constraint type inference
```go
type Number interface {
    ~int | ~int64 | ~float64
}

func Sum[S ~[]E, E Number](s S) E {
    var total E
    for _, v := range s { total += v }
    return total
}

xs := []int{1, 2, 3, 4}
fmt.Println(Sum(xs)) // S = []int (FTAI), E = int (constraint inference)
```

### Example 5: When you must be explicit
```go
func Zero[T any]() T {
    var z T
    return z
}

// x := Zero()        // ERROR: cannot infer T
x := Zero[string]()   // OK
fmt.Printf("%q\n", x) // ""
```

### Example 6: Untyped constants
```go
func Add[T int | float64](a, b T) T { return a + b }

fmt.Println(Add(1, 2))     // T = int (default for untyped int)
fmt.Println(Add(1.0, 2.0)) // T = float64
fmt.Println(Add(1, 2.0))   // T = float64 (1 promoted)
```

### Example 7: Named function passed as argument
```go
import "strconv"

func Map[T, U any](s []T, f func(T) U) []U {
    out := make([]U, len(s))
    for i, v := range s { out[i] = f(v) }
    return out
}

nums := []int{1, 2, 3}

// Works in 1.21+: strconv.Itoa has signature func(int) string
strs := Map(nums, strconv.Itoa)

// Does NOT work: fmt.Sprint is func(...any) string — does not match func(int) U
// strs := Map(nums, fmt.Sprint)
```

### Example 8: Identity vs IdentityCast
```go
func Identity[T any](x T) T { return x }
func Cast[U, T any](x T) U { return any(x).(U) }

a := Identity(42)            // OK: T = int
b := Cast[float64](42)       // U must be explicit
// c := Cast(42)             // ERROR: U is not in any argument
_ = b
_ = a
```

---

## Coding Patterns

### Pattern A: Inference-first API design
Put type parameters where they will be carried by an argument.

```go
// GOOD — T appears in argument
func Min[T cmp.Ordered](xs []T) T { /* ... */ }

// LESS GOOD — T only in return type
func Empty[T any]() []T { return nil }
```

### Pattern B: Use `cmp.Ordered` (Go 1.21)
```go
import "cmp"

func Sort[T cmp.Ordered](s []T) { /* sort.Slice with < */ }
```

### Pattern C: Slice + element pattern
```go
func Contains[S ~[]E, E comparable](s S, target E) bool {
    for _, v := range s {
        if v == target { return true }
    }
    return false
}
```

### Pattern D: Helper with inferred + explicit forms
```go
// Shorter inferred form
func New[T any](xs ...T) []T { return xs }

// Useful: New(1, 2, 3) → []int
// But if you want []float64: New[float64](1, 2, 3)
```

---

## Clean Code

- Prefer inference at the call site; explicit only when you must.
- If a function frequently fails to infer, redesign its signature.
- Avoid putting a type parameter only in the return position when callers will not provide it.
- Document any non-obvious explicit instantiation in a comment.

```go
// We must specify [int] because the result type cannot be inferred.
zero := Zero[int]()
```

---

## Product Use / Feature

- **Slice helpers**: `Map`, `Filter`, `Reduce` in internal utility packages.
- **Numeric utilities**: `Min`, `Max`, `Sum`, `Average` for telemetry pipelines.
- **Cache wrappers**: `Cache[K comparable, V any]` — `K` and `V` infer from `Get`/`Set` calls in 1.21+.
- **Result types**: `Result[T any]` — `T` is usually inferred from the return-builder helper.

---

## Error Handling

Inference produces compile errors, not runtime errors. The most common message is:

```
cannot infer T (declared at <file>:<line>:<col>)
```

When you see this, look at:
1. Whether the argument types match the parameter types.
2. Whether one type parameter only appears in the return type.
3. Whether you passed `nil` without context.
4. Whether the function value you passed has the right shape.

A practical recipe:
- Add explicit `[T]` brackets and recompile.
- If it now compiles, you confirmed inference was the issue.
- If it still fails, the problem is real — the types do not match.

---

## Security Considerations

Type inference does not change Go's type safety. Inference is purely syntactic; it cannot weaken constraints or bypass `comparable`. Two notes:

- Do not rely on a particular inferred *default* type for security-sensitive widths. Write `int64` or `uint32` explicitly when the width matters.
- When `T = any`, your code accepts everything. Inference does not warn you that you instantiated with `any`.

---

## Performance Tips

- Inference happens at compile time and has no runtime cost.
- Heavy use of generics may slow compilation, but inference itself is cheap.
- Inferring `T = any` may force boxing of value types — prefer concrete types when performance matters.

---

## Best Practices

1. Design generic APIs with at least one parameter that exposes every type parameter.
2. Place the slice as the first argument; it carries `S` and (with constraint inference) `E`.
3. Prefer named function values whose signatures match the parameter shape exactly.
4. Use `cmp.Ordered` from Go 1.21 instead of hand-rolling `Ordered` constraints.
5. Add a one-line comment whenever you must write explicit `[T]` brackets.
6. Use the latest Go version you can — 1.21 expanded inference significantly.

---

## Edge Cases & Pitfalls

### Edge 1: Returning only
```go
func Build[T any]() T { var z T; return z }
// Build()   // FAILS
Build[int]() // OK
```

### Edge 2: Mixing typed and untyped
```go
var x int32 = 5
// Add(x, 1) — does 1 become int32? In Go 1.21+ yes; in 1.18 it could fail.
```

### Edge 3: Nil
```go
func F[T any](x *T) {}
// F(nil)   // FAILS — nil has no type information
F[int](nil) // OK
```

### Edge 4: Variadic
```go
func Sum[T int | float64](xs ...T) T { /* ... */ }
Sum(1, 2, 3)        // T = int
Sum(1, 2.0, 3)      // T = float64
Sum()               // FAILS: nothing to infer from
```

### Edge 5: Method values
Type inference does not (currently) infer through method values from interface types. Pass a closure if you hit this.

---

## Common Mistakes

1. Writing `Cast(x)` and expecting the result type to be guessed.
2. Passing `nil` as a generic argument.
3. Passing `fmt.Sprint` (a variadic-`any` function) where a specific signature is required.
4. Assuming an integer literal becomes `int64`; it defaults to `int`.
5. Forgetting that inference of `E` from `~[]E` requires the constraint shape, not just `any`.
6. Using `Map(slice, func(x interface{}) interface{} {...})` and being surprised that `T` and `U` become `interface{}`.

---

## Common Misconceptions

- "Inference can always figure it out" — false; some signatures are inherently ambiguous.
- "Inference and instantiation are the same thing" — instantiation is the substitution; inference is what *picks* the substitution.
- "If it inferred in 1.21 it must work in 1.18" — false; rules expanded.
- "Inference makes generic code dynamic" — no, the result is fully static.
- "I can drop brackets if the function only has `[T any]`" — only if `T` appears in an argument.

---

## Tricky Points

### Tricky 1: Type identity vs assignability
Inference uses unification, which is roughly type identity, not Go's looser assignability. A `MyInt` defined as `type MyInt int` is *not* the same as `int` for inference purposes unless the constraint uses `~int`.

### Tricky 2: `any` swallows everything
```go
func Take[T any](x T) { _ = x }
Take([]int{1,2,3}) // T = []int, not int
```

### Tricky 3: Default types differ across versions
In 1.18, untyped constants in some positions did not get default types eagerly. In 1.21+ defaulting is more aggressive and inference more often succeeds.

### Tricky 4: The order of parameters matters
```go
func Pair[A, B any](a A, b B) (A, B) { return a, b }
Pair(1, "x") // A = int, B = string

func Pair2[B, A any](a A, b B) (A, B) { return a, b }
Pair2(1, "x") // Same result; declaration order does not change semantics, but listing order at explicit call sites does.
Pair2[string, int](1, "x") // Different mapping
```

---

## Test

Run the snippet below as `main.go`:

```go
package main

import (
    "fmt"
    "strconv"
)

func Max[T int | float64](a, b T) T {
    if a > b { return a }
    return b
}

func Map[T, U any](s []T, f func(T) U) []U {
    out := make([]U, len(s))
    for i, v := range s { out[i] = f(v) }
    return out
}

func Sum[S ~[]E, E int | float64](s S) E {
    var total E
    for _, v := range s { total += v }
    return total
}

func main() {
    fmt.Println(Max(2, 9))                          // 9
    fmt.Println(Max(2.5, 1.1))                      // 2.5
    fmt.Println(Map([]int{1,2,3}, strconv.Itoa))    // [1 2 3]
    fmt.Println(Sum([]int{1,2,3,4}))                // 10
}
```

Expected output:
```
9
2.5
[1 2 3]
10
```

---

## Tricky Questions

**Q1.** Why does `Max(3, 5)` work but `Build[int]()` is required for `func Build[T any]() T`?
> `Max` has `T` in its parameters; `Build` has `T` only in the return type, so there is nothing for FTAI to look at.

**Q2.** Why does `Map(s, fmt.Sprint)` fail?
> `fmt.Sprint` is `func(a ...any) string`. The compiler cannot unify it with `func(T) U`.

**Q3.** What is the inferred type of `Identity(1)`?
> `int` — the default type of an untyped int constant.

**Q4.** What about `Identity(1.0)`?
> `float64` — the default type of an untyped float constant.

**Q5.** Why does `Sum([]int{1,2,3})` know `E = int` even though `E` is not in any parameter directly?
> Because `S = []int` is FTAI'd, and constraint type inference uses `~[]E` to derive `E = int`.

**Q6.** Does inference work across packages?
> Yes — it is a property of the call site, not of where the function is declared.

**Q7.** Can inference change between Go versions?
> Yes; some calls that fail in 1.18 succeed in 1.21+. Always note your minimum Go version.

**Q8.** If I write `Max[int](3.5, 4.5)` what happens?
> Compile error: `3.5` is not representable as `int`.

**Q9.** Why does `var f = Map[int, string]; f(s, strconv.Itoa)` work but `var f = Map; f(...)` fail?
> Inference requires a call expression; you cannot partially instantiate a generic function value without supplying type arguments.

**Q10.** What happens with `Pair(nil, nil)`?
> Compile error — `nil` has no inferable type.

---

## Cheat Sheet

```text
INFERS                              REQUIRES EXPLICIT
Max(3, 5)                           Build[int]()
Map(slice, fn)                      Cast[U](x) where U is return-only
Sum(slice) // [S ~[]E, E ...]       Take(nil)
Identity(42)                        F(genericFnValue) // partial instantiation
Equal("a", "b")
```

```text
DEFAULT TYPES (when no other info)
1, 2, 100        → int
1.0, 3.14        → float64
"foo"            → string
'a'              → rune (int32)
true / false     → bool
0i, 1i           → complex128
```

```text
TYPICAL ERROR                                      LIKELY CAUSE
"cannot infer T"                                   T not in any argument
"type X does not match Y"                          arg type mismatch
"X cannot be inferred from arguments"              return-only or nil
"cannot use ... as func(T) U"                      function shape mismatch
```

---

## Self-Assessment Checklist

- [ ] I can read a generic call and explain how `T` is inferred.
- [ ] I know why some calls require explicit `[T]` brackets.
- [ ] I can describe FTAI vs constraint type inference.
- [ ] I know why `Map(s, strconv.Itoa)` works in 1.21+ but `Map(s, fmt.Sprint)` does not.
- [ ] I can predict default types for untyped constants.
- [ ] I have written at least one generic function whose call site is fully inferred.

---

## Summary

Type inference is the convenience layer that lets generic Go code read like ordinary Go code. Function argument type inference matches arguments against parameters. Constraint type inference uses constraint shapes like `~[]E`. Untyped constants follow defaulting rules and can interact subtly with explicit types. When inference fails the cure is to add explicit `[T]` brackets — never a behavioural change. Knowing what the compiler can and cannot deduce is the difference between a generic API your team enjoys using and one they avoid.

---

## What You Can Build

- A `slices` helper package with `Map`, `Filter`, `Reduce`, `Any`, `All` — every call site fully inferred.
- A typed event bus where `Subscribe[T]` and `Publish(t)` cooperate so that publishers infer `T` automatically.
- A small SQL row scanner: `Scan[T any](rows, builder)` where `T` is inferred from the builder's return type.

---

## Further Reading

- Go blog: "An Introduction To Generics" (2022).
- Go blog: "More Powerful Go Execution Traces" — release notes for 1.21 inference improvements.
- Go specification: "Type inference" section.
- Robert Griesemer's Gophercon talks on generics.
- Russ Cox's "Generics in Go" design doc.

---

## Related Topics

- 04.1 Why Generics
- 04.2 Generic Functions
- 04.3 Generic Types and Interfaces
- 04.4 Type Constraints
- 04.6 Generic Patterns (next)

---

## Diagrams & Visual Aids

```
Call site:    Map ( []int{1,2,3} , strconv.Itoa )
                    |               |
                    v               v
               []T  →  T=int    func(int) string  →  U=string
                                       (both T and U match)

After unification:  T=int, U=string
Instantiated:       Map[int, string]([]int{1,2,3}, strconv.Itoa)
```

```
INFERENCE PIPELINE
+------------------+      +-----------------------+      +------------------+
| function args    | ───▶ | FTAI: unify args vs   | ───▶ | constraint type  |
| & their types    |      | parameter types       |      | inference        |
+------------------+      +-----------------------+      +------------------+
                                                                  │
                                                                  ▼
                                                       +----------------------+
                                                       | all type params set? |
                                                       +----------+-----------+
                                                                  │
                                                       yes        │       no
                                                                  ▼
                                                       +----------------------+
                                                       | compile error:       |
                                                       | "cannot infer T"     |
                                                       +----------------------+
```

```
DEFAULT TYPES TREE
untyped int       ─▶ int
untyped float     ─▶ float64
untyped rune      ─▶ rune (int32)
untyped string    ─▶ string
untyped complex   ─▶ complex128
untyped bool      ─▶ bool
nil               ─▶ (no default — context required)
```
