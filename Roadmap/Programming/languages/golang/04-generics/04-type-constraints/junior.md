# Type Constraints — Junior Level

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
> Focus: "What is a constraint?" and "How do I read one?"

When you write a generic function in Go, you cannot just say "this works on any type" without telling the compiler **what operations the type supports**. The compiler is strict: if your function does `a + b` inside, then the type `T` must support `+`. If your function compares `a == b`, then `T` must be comparable. The mechanism that lets you state these requirements is called a **type constraint**.

A type constraint is, at its surface, just an interface. But in Go 1.18 and later, interfaces gained a new superpower when used in the constraint position of a type parameter: they can describe **type sets**. A type set is the collection of concrete types that satisfy the constraint. The constraint `int | string` describes a type set with exactly two elements: `int` and `string`. The constraint `~int` describes the type set of `int` and **every type whose underlying type is `int`** (such as `type ID int`).

```go
// A function that works on any type — no operations assumed
func Identity[T any](x T) T {
    return x
}

// A function that needs equality — requires comparable
func Equal[T comparable](a, b T) bool {
    return a == b
}

// A function that needs ordering — requires a custom constraint
type Ordered interface {
    ~int | ~int64 | ~float64 | ~string
}

func Max[T Ordered](a, b T) T {
    if a > b {
        return a
    }
    return b
}
```

In this file we focus on the **junior-level mental model**: how to read a constraint, how to use the two built-in ones (`any` and `comparable`), and how to write your first custom constraint with a simple union of types.

After reading this file you will:
- Understand what a constraint is and why generics need them
- Know the difference between `any` and `comparable`
- Be able to write a simple custom constraint using `|`
- Begin to recognize the `~` operator in real code
- Understand the relationship between an interface and a constraint

---

## Prerequisites
- Basics of Go syntax and packages
- A working understanding of `interface` (method-only interfaces are enough)
- Familiarity with generic function syntax: `func Foo[T any](x T)`
- Ability to run `go run main.go` with Go 1.18 or later (Go 1.21+ recommended)
- Basic comfort with `struct` and `map`

If you are not yet familiar with generic functions in general, please read **04-generics/02-generic-functions** first. This page assumes you can already read `func Foo[T any](x T) T`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Type parameter** | The placeholder type in a generic declaration, e.g. `T` in `func Foo[T any]()` |
| **Type argument** | The concrete type supplied at the call site, e.g. `int` in `Foo[int]()` |
| **Type constraint** | An interface that describes which type arguments are allowed for a type parameter |
| **Type set** | The set of concrete types that satisfy an interface used as a constraint |
| **Type element** | An interface element that names a type or a union of types — `int`, `~string`, `int \| string` |
| **Method element** | An interface element that names a method (the classic kind) — `String() string` |
| **Union** | The `\|` operator combining type elements: `int \| string` |
| **Approximation (`~`)** | The tilde operator: `~int` includes `int` and any type whose underlying type is `int` |
| **Underlying type** | The type that a defined type is built on. For `type Celsius float64`, the underlying type is `float64` |
| **Basic interface** | An interface containing only methods — usable as a value type |
| **General interface** | An interface containing type elements (union, `~`) — usable only as a constraint |
| **`any`** | An alias for `interface{}` — accepts every type, no operations assumed |
| **`comparable`** | A built-in constraint matching every type that supports `==` and `!=` |
| **`constraints` package** | The `golang.org/x/exp/constraints` package that ships ready-made constraints like `Ordered`, `Integer`, `Float` |
| **Monomorphization** | Compiler strategy that generates a separate code copy per type argument |
| **Dictionary (GC shape)** | Compiler strategy where one shared copy uses a runtime dictionary; Go uses GC-shape stenciling |
| **Satisfaction** | A type `T` *satisfies* a constraint `C` if `T` is in the type set of `C` |
| **Constraint composition** | Building a complex constraint by embedding simpler ones |

---

## Core Concepts

### 1. A constraint is an interface

In Go 1.18 the meaning of "interface" was extended. Before 1.18, an interface could only list method requirements:

```go
type Stringer interface {
    String() string
}
```

Starting at Go 1.18, an interface can also list **type elements**:

```go
type Number interface {
    int | float64
}
```

`Number` is still an interface — but it is a **general interface** (because it contains type elements). General interfaces can only be used in the constraint position of a type parameter; they cannot be used as a value type.

```go
var x Number    // ❌ compile error — general interface cannot be a value
func Sum[T Number](xs []T) T { ... }  // ✅ used as a constraint — fine
```

A regular method-only interface (a **basic interface**) can be used both as a value type **and** as a constraint:

```go
type Stringer interface {
    String() string
}

var s Stringer            // ✅ value usage — fine
func Print[T Stringer](x T) { ... }  // ✅ constraint usage — fine
```

### 2. The two built-in constraints: `any` and `comparable`

Go ships with exactly two predeclared constraints out of the box:

#### `any`

`any` is an alias for `interface{}`. It is the **most permissive** constraint — every type satisfies it. Using `any` means your generic function can do **nothing** with the value except pass it around, store it, or print it via reflection-driven helpers like `fmt.Println`.

```go
func First[T any](xs []T) T {
    if len(xs) == 0 {
        var zero T
        return zero
    }
    return xs[0]
}
```

#### `comparable`

`comparable` is a built-in constraint that matches every type whose values can be compared with `==` and `!=`. This is exactly the set of types that Go allows as **map keys**: booleans, numerics, strings, pointers, channels, interfaces, and structs/arrays whose fields/elements are themselves comparable. Slices, maps, and functions are **not** comparable.

```go
func Contains[T comparable](xs []T, target T) bool {
    for _, x := range xs {
        if x == target {
            return true
        }
    }
    return false
}

Contains([]int{1, 2, 3}, 2)             // ✅ ok
Contains([]string{"a", "b"}, "a")        // ✅ ok
Contains([][]int{{1}}, []int{1})         // ❌ slice is not comparable
```

> **Note (Go 1.20+):** The semantics of `comparable` were broadened in Go 1.20 to also cover interface types whose dynamic types may not be comparable. We discuss this in **senior.md**.

### 3. Writing your first custom constraint

When `any` is too loose and `comparable` is the wrong shape, you write your own constraint. The simplest custom constraint lists allowed types with `|`:

```go
type Number interface {
    int | int32 | int64 | float32 | float64
}

func Sum[T Number](xs []T) T {
    var total T
    for _, x := range xs {
        total += x
    }
    return total
}

Sum([]int{1, 2, 3})           // 6
Sum([]float64{1.5, 2.5})      // 4.0
```

The compiler now knows: `T` is one of those five types, so `+=` is allowed.

### 4. The `~` operator (approximation / tilde)

What if a user has `type UserID int` and wants to call `Sum`? Without `~`, that fails:

```go
type UserID int
ids := []UserID{1, 2, 3}
Sum(ids)   // ❌ UserID is NOT in the type set {int, int32, int64, float32, float64}
```

`UserID` is a different defined type from `int`, even though its **underlying type** is `int`. To accept any type whose underlying type matches, prefix with `~`:

```go
type Number interface {
    ~int | ~int32 | ~int64 | ~float32 | ~float64
}

Sum(ids)   // ✅ works — UserID's underlying type is int, and ~int matches it
```

`~int` reads as "int, or anything whose underlying type is int". Use `~` whenever you write a numeric/string-shaped constraint that user-defined wrapper types should also satisfy.

### 5. The `constraints` package

You don't always need to handcraft a numeric constraint. The `golang.org/x/exp/constraints` package provides ready-made ones:

```go
import "golang.org/x/exp/constraints"

func Max[T constraints.Ordered](a, b T) T {
    if a > b {
        return a
    }
    return b
}
```

`constraints.Ordered` covers everything that supports `<`, `<=`, `>`, `>=` — that is, `~int`, `~int8` through `~int64`, `~uint`, `~uint8` through `~uint64`, `~uintptr`, `~float32`, `~float64`, and `~string`.

> **Important history:** This package was originally proposed for the standard library as `constraints` but moved to `golang.org/x/exp/constraints` before Go 1.18 shipped. As of Go 1.21+, it still lives there. You add it to your project with:
>
> ```bash
> go get golang.org/x/exp/constraints
> ```

### 6. Constraint vs interface — when do you need each?

| Question | Use a method-only interface | Use a general interface (constraint) |
|---|---|---|
| Do you need values stored at runtime in a heterogeneous container? | Yes — interfaces are a value type | No — constraints are not values |
| Do you need to call operators (`+`, `<`, `==`) on the value? | No — interfaces only know methods | Yes — only constraints can describe operator support |
| Do you need to discriminate on concrete numeric/string types? | No | Yes |
| Do you call only methods like `String()` or `Read([]byte)`? | Either works; method-only interface is simpler | Avoid; you don't need a constraint here |

---

## Real-World Analogies

**Analogy 1 — Job Description**
A constraint is a job description. `any` says "we'll hire anyone who can breathe". `comparable` says "must be able to compare items by equality". `Number` says "must support addition and subtraction". When a candidate (a concrete type) applies, the compiler checks whether the candidate has all the required skills.

**Analogy 2 — Vending Machine Slot**
A vending machine slot has a constraint: "accepts cans 33mm in diameter". Coke cans, beer cans, sparkling-water cans all satisfy that constraint. A bottle does not. Generic Go works the same: the slot is your type parameter, and the diameter rule is the constraint.

**Analogy 3 — University Prerequisites**
"Calculus II requires Calculus I." That is a constraint. The course is the generic function; the prerequisite is the type set; the student is the type argument. If the student doesn't satisfy the prerequisite, registration (compilation) fails.

**Analogy 4 — Passport at the Border**
`any` is "any passport". `comparable` is "any passport that is biometric". `Ordered` is "any passport from a country in the Schengen ranking". The border officer (the compiler) checks the passport against the rule; if it matches, the traveler enters the function.

---

## Mental Models

### Model 1: A constraint is a **set of types**

The constraint `int | string` is literally the set `{int, string}`. The constraint `~int | ~string` is the (infinite) set of all types whose underlying type is `int` plus all types whose underlying type is `string`. Reading constraints as sets makes union (`|`) and intersection (embedding) feel natural.

### Model 2: The compiler reads two halves of a constraint

A constraint can have two pieces:
1. **Type element** — restricts which concrete types are allowed.
2. **Method element** — restricts which methods must be present.

```go
type Stringer interface {
    String() string
}
type StringableNumber interface {
    Stringer            // method element — must have String() string
    ~int | ~float64     // type element — underlying type must be int or float64
}
```

Both halves must be satisfied by the type argument.

### Model 3: Constraint is a **gate**, not a value

You never store a value at type `Number`. The constraint is a compile-time gate; once compilation passes, the constraint disappears. At runtime there is no "Number" — there is `int`, `float64`, etc. Treat constraints as compile-time grammar, not runtime types.

### Model 4: `~` removes the "newtype wall"

Without `~`, every `type Foo Bar` is a brand-new type that does not match the constraint of `Bar`. With `~`, the wall is permeable: any type built on `Bar` is welcome.

---

## Pros & Cons

### Pros
1. **Type safety** — operations on `T` are checked at compile time.
2. **Code reuse** — one `Sum` works for every numeric type.
3. **No reflection** — no runtime type assertions; the compiler proves correctness.
4. **Performance** — Go's GC-shape stenciling produces fast code, often equivalent to hand-written specializations.
5. **Self-documenting APIs** — a constraint like `Ordered` tells the reader exactly what the function expects.

### Cons
1. **Learning curve** — `~`, type sets, method/type elements need study.
2. **Error messages** — constraint mismatch errors can be verbose.
3. **No specialization** — you cannot say "if T is int, do X; if T is string, do Y" inside one generic function (use type switches on a separate `any`-typed variable).
4. **Constraint inflation** — easy to over-narrow your constraint and exclude valid use cases.
5. **External dependency** — `constraints.Ordered` lives in `golang.org/x/exp`, not the standard library.

---

## Use Cases

1. **Numeric utilities** — `Sum`, `Average`, `Min`, `Max`, `Clamp`, `Abs`.
2. **Container types** — `Set[T comparable]`, `OrderedMap[K Ordered, V any]`.
3. **Algorithms** — `Sort[T Ordered]`, `BinarySearch[T Ordered]`.
4. **Parsing/serializing** — `Parse[T Number](s string) (T, error)`.
5. **Functional helpers** — `Map[T, U any](xs []T, f func(T) U) []U`, `Filter[T any]`, `Reduce[T, U any]`.
6. **Domain-specific types** — `Sum[T ~Money](amounts []T) T` lets `Money` and `USD` both work.
7. **Cache keys** — `Cache[K comparable, V any]`.
8. **Iterators** — `Range[T Integer](start, stop T) []T`.

---

## Code Examples

### Example 1: `any` — collect any type
```go
package main

import "fmt"

func ToSlice[T any](xs ...T) []T {
    return xs
}

func main() {
    fmt.Println(ToSlice(1, 2, 3))           // [1 2 3]
    fmt.Println(ToSlice("a", "b", "c"))     // [a b c]
    fmt.Println(ToSlice(true, false))       // [true false]
}
```

### Example 2: `comparable` — set membership
```go
package main

import "fmt"

func Index[T comparable](xs []T, target T) int {
    for i, x := range xs {
        if x == target {
            return i
        }
    }
    return -1
}

func main() {
    fmt.Println(Index([]int{10, 20, 30}, 20))           // 1
    fmt.Println(Index([]string{"go", "rust"}, "rust"))   // 1
}
```

### Example 3: Custom union — addable numbers
```go
package main

import "fmt"

type Addable interface {
    int | int64 | float64 | string
}

func Concat[T Addable](xs []T) T {
    var acc T
    for _, x := range xs {
        acc += x
    }
    return acc
}

func main() {
    fmt.Println(Concat([]int{1, 2, 3}))                // 6
    fmt.Println(Concat([]string{"go", "-", "lang"}))   // go-lang
}
```

Note: `+=` is the same operator that means "add" for numbers and "concatenate" for strings — the constraint `Addable` describes exactly the types that support that operator.

### Example 4: `~` so user types are welcome
```go
package main

import "fmt"

type Number interface {
    ~int | ~float64
}

type Celsius float64
type UserID int

func Sum[T Number](xs []T) T {
    var total T
    for _, x := range xs {
        total += x
    }
    return total
}

func main() {
    temps := []Celsius{20.5, 21.0, 19.5}
    ids := []UserID{1, 2, 3}
    fmt.Println(Sum(temps))   // 61
    fmt.Println(Sum(ids))     // 6
}
```

### Example 5: Use `constraints.Ordered`
```go
package main

import (
    "fmt"

    "golang.org/x/exp/constraints"
)

func Max[T constraints.Ordered](a, b T) T {
    if a > b {
        return a
    }
    return b
}

func main() {
    fmt.Println(Max(3, 7))           // 7
    fmt.Println(Max(3.14, 2.71))     // 3.14
    fmt.Println(Max("alpha", "beta")) // beta
}
```

### Example 6: Method element + type element
```go
package main

import "fmt"

type Stringable interface {
    ~int | ~float64
    String() string
}

type Money int
func (m Money) String() string { return fmt.Sprintf("$%d", m) }

func PrintAll[T Stringable](xs []T) {
    for _, x := range xs {
        fmt.Println(x.String())
    }
}

func main() {
    PrintAll([]Money{10, 20, 30})
}
```

The constraint `Stringable` insists on **both** an underlying type of `int` or `float64` **and** a `String() string` method.

### Example 7: Generic `Set[T comparable]`
```go
package main

import "fmt"

type Set[T comparable] map[T]struct{}

func (s Set[T]) Add(v T)       { s[v] = struct{}{} }
func (s Set[T]) Has(v T) bool  { _, ok := s[v]; return ok }

func main() {
    s := Set[string]{}
    s.Add("go")
    s.Add("rust")
    fmt.Println(s.Has("go"))   // true
    fmt.Println(s.Has("c++"))  // false
}
```

### Example 8: Filter with `any`
```go
package main

import "fmt"

func Filter[T any](xs []T, keep func(T) bool) []T {
    out := make([]T, 0, len(xs))
    for _, x := range xs {
        if keep(x) {
            out = append(out, x)
        }
    }
    return out
}

func main() {
    evens := Filter([]int{1, 2, 3, 4, 5}, func(n int) bool { return n%2 == 0 })
    fmt.Println(evens)   // [2 4]
}
```

### Example 9: Min with custom Ordered
```go
package main

import "fmt"

type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
        ~float32 | ~float64 | ~string
}

func Min[T Ordered](xs []T) T {
    m := xs[0]
    for _, x := range xs[1:] {
        if x < m {
            m = x
        }
    }
    return m
}

func main() {
    fmt.Println(Min([]int{3, 1, 4, 1, 5}))   // 1
    fmt.Println(Min([]string{"go", "c", "rust"})) // c
}
```

### Example 10: Embedding constraints
```go
package main

import "golang.org/x/exp/constraints"

type Signed interface {
    constraints.Signed
}

type SignedOrFloat interface {
    constraints.Signed | constraints.Float
}

func Abs[T SignedOrFloat](x T) T {
    if x < 0 {
        return -x
    }
    return x
}
```

---

## Coding Patterns

### Pattern 1: Start with `any`, narrow as needed
Begin with the most permissive constraint. The moment you reach for an operator the compiler rejects, narrow to a more specific constraint. This is the **principle of least constraint**.

### Pattern 2: Use `~` everywhere unless you have a reason not to
For numeric/string-shaped constraints, almost always prefer `~int` over `int`. The cost is zero, and it makes your library friendly to user-defined wrapper types.

### Pattern 3: Prefer `constraints.Ordered` over a hand-rolled list
If `golang.org/x/exp/constraints` is acceptable in your project, use it. Hand-rolled lists are easy to get wrong (forgetting `~uintptr` or `~int8`).

### Pattern 4: Compose, don't copy
If two constraints share types, embed the shared one rather than retyping the union.
```go
type Numeric interface { constraints.Integer | constraints.Float }
type Numerish interface { Numeric | constraints.Complex }
```

### Pattern 5: Constraint per file is fine
A small package can keep all its constraints in a single `constraints.go` file. No need to invent a sub-package unless you publish a library.

---

## Clean Code

1. **Name constraints like the property they enforce** — `Ordered`, `Numeric`, `Hashable`, `Stringable` — not `T` or `Constraint1`.
2. **Document the type set in a comment** — list which types satisfy the constraint and why.
3. **Group related constraints** — keep `Integer`, `Float`, `Numeric` next to each other so readers see the hierarchy.
4. **One constraint, one purpose** — don't smush "ordered" and "stringable" into one constraint unless every caller needs both.
5. **Avoid overly specific constraints** — `Int32Or64Only` is rarely the right abstraction; prefer `~int32 | ~int64` only when the bit-width truly matters.

---

## Product Use / Feature

- **Currency math** — `type USD int; type EUR int` plus a `~int` numeric constraint lets you keep type safety **and** reuse arithmetic helpers.
- **Geographic coordinates** — `type Latitude float64; type Longitude float64` with a `~float64` constraint for distance helpers.
- **Strongly typed IDs** — `type UserID int64; type OrderID int64` plus a `comparable` constraint for cache keys.
- **Configuration parsers** — `Parse[T Number](raw string)` returns a typed value while validating range.
- **Telemetry SDKs** — `Counter[T Numeric]` lets users instrument with whatever numeric type they have on hand.

---

## Error Handling

Constraints don't directly throw runtime errors — they prevent compilation. But your generic function still has to handle runtime issues:

```go
func Parse[T Number](s string) (T, error) {
    // ... parsing logic per type
    var zero T
    return zero, fmt.Errorf("not implemented for %T", zero)
}
```

Pattern: when a generic function might fail at runtime (parsing, division, IO), return `(T, error)` — never panic, even with constraints. The constraint guarantees the type shape; only your business logic guarantees runtime success.

```go
func SafeDivide[T constraints.Float](a, b T) (T, error) {
    if b == 0 {
        var zero T
        return zero, errors.New("division by zero")
    }
    return a / b, nil
}
```

---

## Security Considerations

- **Avoid `any` in security-sensitive code paths.** `any` accepts everything, including nil interfaces and types from untrusted modules. Use the narrowest possible constraint.
- **Treat type sets as a whitelist.** A constraint like `~string | ~[]byte` literally encodes "I accept these and only these" — that's a security feature, not a limitation.
- **Don't constrain on `comparable` if you store secrets.** `==` on a struct containing a key compares fields, but timing-leaks the comparison. Use `subtle.ConstantTimeCompare` for actual secrets.
- **Be careful with constraint-driven dispatch.** A function that does `if any(x).(SomeSecretAPI) != nil` defeats the safety the constraint is supposed to provide. Stick to operations the constraint allows.

---

## Performance Tips

- **Constraint shape determines codegen.** Go uses GC-shape stenciling: types with the same memory layout (same "GC shape") share one compiled body via a runtime dictionary. Different shapes get separate copies.
- **`any` does not necessarily mean boxing.** It depends on whether the function actually escapes to interface storage. Profile before assuming.
- **Avoid converting back and forth.** Inside the function, work in `T` — converting to `int` and back negates the win.
- **Constraints with method elements** can prevent inlining; the compiler must dispatch through a method.
- **Pure type-element constraints** (`~int | ~float64`) tend to inline well because no method dispatch is required.

---

## Best Practices

1. Use `any` for "I don't care about the value" generics.
2. Use `comparable` for keys and equality checks.
3. Use `constraints.Ordered` for ordering.
4. Use `~` in user-facing libraries.
5. Define constraints once per package — don't duplicate.
6. Document the type set with a comment listing examples.
7. Avoid constraints with both a method element and a type element unless you really need both.
8. Don't use constraints as parameter types of regular (non-generic) functions — they aren't values.
9. Prefer composition (embedding) over copy-paste of unions.
10. Read the spec for the constraint package: it's short and saves bugs.

---

## Edge Cases & Pitfalls

1. **Empty union** — `interface { }` is `any`; you cannot say `interface { /* nothing */ }` and have it mean "no type matches". The empty interface is the universe.
2. **Cannot use a general interface as a value** — `var x Number` fails to compile.
3. **Cannot embed a general interface in a value-position interface** — `type Foo interface { Number; String() string }` is a general interface; `var x Foo` won't compile either.
4. **`~T` only works on a type whose **underlying** type is exactly `T`** — `~int8` does not match `int16`.
5. **Pointer types in constraints** — `*int` is allowed in a union, but rare; the type set then matches only `*int`, not `*type MyInt int`.
6. **Comparable struct with non-comparable field** — `type S struct { xs []int }` is not comparable, so `S` does not satisfy `comparable`.
7. **Method sets on pointer vs value receivers** — if a constraint requires `String() string` and the method has a pointer receiver, only `*T` satisfies it, not `T`.
8. **Constraint inference fails silently** — sometimes the compiler cannot infer `T` and you must pass it explicitly: `Sum[int](xs)`.
9. **Untyped constants** — `Sum([]int{1,2,3})` works; `var x int8 = 1; Sum([]int8{x, 2, 3})` also works, but mixing types within the slice does not.
10. **Default zero value** — `var zero T` gives the zero of whatever `T` ends up as; useful for "not found" returns.

---

## Common Mistakes

1. **Using `any` and then panicking inside on `int`-only logic.** If you need `int`, constrain to `int`.
2. **Forgetting `~`** — your library refuses `type ID int` and you don't notice until a user complains.
3. **Hand-rolling a constraint that already exists** — `constraints.Ordered` is right there.
4. **Trying to compare with `==` under `any`.** `any` does not imply `comparable`.
5. **Using `comparable` where you actually need `Ordered`.** `comparable` only gives you `==`/`!=`, not `<`/`>`.
6. **Putting a method element where you want a type element.** A method element constrains methods, not operators.
7. **Re-declaring `any` as `interface{}` in your code.** Use `any`; it's the modern spelling.
8. **Treating a constraint as a runtime type.** Constraints disappear at runtime.
9. **Over-constraining for readability.** Don't add `comparable` "just to be safe" if equality isn't used.
10. **Putting unrelated types in the same union.** `int | http.Client` is legal but meaningless.

---

## Common Misconceptions

- **"`any` is faster than `interface{}`."** They are identical; `any` is an alias.
- **"`comparable` includes slices."** It does not — slices are not comparable.
- **"`~int` is slower than `int`."** No — `~` is a compile-time concept; runtime is identical.
- **"A constraint is just an interface."** A *basic* constraint is. A *general* constraint (with type elements) is more — it cannot be used as a value type.
- **"You can do type assertions on `T`."** No — you can do them on `any(t).(SomeType)`, but inside a generic function, `T` is opaque.
- **"`comparable` and `==` are the same as `==` on `any`."** Comparing `any` values can panic if the dynamic type is non-comparable; `comparable` prevents that at compile time.

---

## Tricky Points

1. **Method receiver in a constraint.** If your constraint requires `Read([]byte) (int, error)` and the method is defined on `*File`, then your type argument must be `*File`, not `File`.
2. **`comparable` was strictly stricter than `any` before Go 1.20.** Go 1.20 expanded `comparable` to also include `any`/interface types. We discuss this in **senior.md**.
3. **Type unions and the "core type" rule.** A constraint's union determines what operations are allowed. If every type in the union supports `+`, then `+` is allowed inside the function — but only if a "core type" exists. Mixed `int | string` works for `+=` because both support `+`, but `<` fails because they have different ordering shapes.
4. **`~` only one level deep.** `type A int` then `type B A` — the underlying type of `B` is `int`. `~int` matches both `A` and `B`.
5. **Constraint embedding deduplicates implicitly.** Embedding two constraints that overlap doesn't double-count; the compiler intersects the type sets.

---

## Test

```go
package main

import "fmt"

type Number interface {
    ~int | ~int64 | ~float64
}

func Sum[T Number](xs []T) T {
    var total T
    for _, x := range xs {
        total += x
    }
    return total
}

func main() {
    type Money int
    cash := []Money{10, 20, 30}
    fmt.Println(Sum(cash))                  // 60
    fmt.Println(Sum([]float64{1.5, 2.5}))   // 4
}
```

Run: `go run main.go`. Expected output:
```
60
4
```

Now try removing the `~` from `~int` — recompile. The compiler refuses the `Money` slice. That hands-on moment is the fastest way to internalize what `~` does.

---

## Tricky Questions

**Q1.** Does `interface{}` satisfy `comparable`?
> Before Go 1.20, no. From Go 1.20 onward, yes — but the runtime comparison can still panic if the dynamic type is non-comparable. The compiler stops checking; the safety burden moves to you.

**Q2.** What is the type set of `interface{ ~int; ~string }`?
> The intersection. Empty. No type has both `int` and `string` as its underlying type, so the constraint is unsatisfiable. The compiler will not flag the declaration but will reject every type argument.

**Q3.** Can a constraint contain methods AND type elements?
> Yes. The type argument must satisfy both halves: be in the listed type set **and** have all listed methods.

**Q4.** What is `interface{ int | int }`?
> Just `int`. The union deduplicates.

**Q5.** Why isn't `comparable` an alias for `any`?
> Because not every type supports `==`. Slices, maps, and functions do not.

---

## Cheat Sheet

```text
any                        // every type
comparable                 // types that support == and !=
int | string               // exactly int or exactly string
~int | ~string             // any type whose underlying type is int or string
constraints.Ordered        // any ordered (supports < <= > >=)
constraints.Integer        // ~int, ~int8 ... ~uint64, ~uintptr
constraints.Signed         // ~int, ~int8 ... ~int64
constraints.Unsigned       // ~uint, ~uint8 ... ~uintptr
constraints.Float          // ~float32, ~float64
constraints.Complex        // ~complex64, ~complex128

interface{ ~int; M() }     // ~int AND has method M()
interface{ A | B; C() }    // (A or B) AND has method C()
```

---

## Self-Assessment Checklist

- [ ] I can read `~int | ~float64` and explain it
- [ ] I know the difference between `any` and `comparable`
- [ ] I have written at least one custom constraint with `|`
- [ ] I have used `~` to allow user-defined wrapper types
- [ ] I have imported and used `golang.org/x/exp/constraints`
- [ ] I understand why a general interface cannot be used as a value
- [ ] I can choose between `any`, `comparable`, and a custom constraint based on the operations my function needs
- [ ] I know that `comparable` does not imply `Ordered`
- [ ] I know how to compose constraints by embedding
- [ ] I have read the constraint section of the Go spec at least once

---

## Summary

A type constraint is the rule book that tells the Go compiler which concrete types are allowed for a given type parameter. Built-in constraints `any` and `comparable` cover the two simplest needs ("I don't care" and "must support equality"). Custom constraints use unions (`int | string`), the underlying-type tilde (`~int`), and the `golang.org/x/exp/constraints` package to express richer rules. Constraints are interfaces, but interfaces with type elements are **general interfaces** that exist only at compile time — they are not value types. Master constraints and you master most of Go generics.

---

## What You Can Build

- A generic `Set[T comparable]`
- A generic `OrderedMap[K Ordered, V any]`
- Numeric helpers: `Sum`, `Max`, `Min`, `Average`, `Clamp`
- A typed cache `Cache[K comparable, V any]`
- A type-safe configuration loader: `LoadEnv[T Number](key string) (T, error)`
- A generic ring buffer `Ring[T any]`
- A SQL row scanner: `ScanRow[T any](row *sql.Row) (T, error)`

---

## Further Reading

- Go specification: [Type constraints](https://go.dev/ref/spec#Type_constraints)
- Go specification: [Interface types](https://go.dev/ref/spec#Interface_types) — the "general interface" section
- The Go Blog — [An Introduction To Generics](https://go.dev/blog/intro-generics)
- The Go Blog — [Why Generics?](https://go.dev/blog/why-generics)
- Source of `golang.org/x/exp/constraints`
- Proposal: [Type Parameters Proposal](https://go.googlesource.com/proposal/+/refs/heads/master/design/43651-type-parameters.md)

---

## Related Topics

- 04-generics/01-why-generics
- 04-generics/02-generic-functions
- 04-generics/03-generic-types-interfaces
- 04-generics/05-type-inference
- 03-methods-and-interfaces/05-empty-interface (any)

---

## Diagrams & Visual Aids

```
┌──────────────────────────────────────────────────────────┐
│                      All Go types                        │
│  ┌─────────────────── any ────────────────────────────┐  │
│  │                                                    │  │
│  │  ┌───── comparable ──────┐    ┌── non-comparable │  │
│  │  │                       │    │   (slices, maps,  │  │
│  │  │  ┌── Ordered ─────┐  │    │    funcs)         │  │
│  │  │  │ ~int ~float ~  │  │    │                   │  │
│  │  │  │ ~string        │  │    │                   │  │
│  │  │  └────────────────┘  │    └────────────────────┘ │
│  │  │  pointers, channels  │                           │
│  │  │  comparable structs  │                           │
│  │  └──────────────────────┘                           │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

```
constraint               type set
─────────────────────────────────────────────────────
int                  →   { int }
~int                 →   { int, type X int, type Y int, ... }
int | string         →   { int, string }
~int | ~string       →   { all underlying-int, all underlying-string }
constraints.Ordered  →   { ~int, ~floats, ~uints, ~string }
comparable           →   { every type whose values support == }
any                  →   the universe
```

```
   Generic function call
   ─────────────────────────
   Sum[Money]([10, 20, 30])
                │
                ▼
   ┌──────────────────────────┐
   │  Compiler reads the      │
   │  constraint Number       │
   │  (~int | ~float64)       │
   └────────────┬─────────────┘
                ▼
   ┌──────────────────────────┐
   │ Is Money's underlying    │
   │ type int?  YES           │
   └────────────┬─────────────┘
                ▼
   ┌──────────────────────────┐
   │ Generate / reuse code    │
   │ for the int GC shape.    │
   └──────────────────────────┘
```
