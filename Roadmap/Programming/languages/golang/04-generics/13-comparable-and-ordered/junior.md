# `comparable` and `cmp.Ordered` — Junior Level

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
> Focus: "What does `comparable` mean?" and "Where does `==` come from?"

Go's generics let you write one function for many types. But not every type supports every operation. The very first restriction every Go programmer hits is this one:

```go
func Eq[T any](a, b T) bool {
    return a == b // compile error
}
```

Why does it fail? Because the compiler does not know whether `T` supports `==`. The constraint `any` allows every type — including types like `[]int` and `map[string]int` for which `==` is not defined. To unlock `==` and `!=` inside a generic body you need a stronger constraint: **`comparable`**.

```go
func Eq[T comparable](a, b T) bool {
    return a == b // OK
}
```

`comparable` is **predeclared** — it is a part of the language itself, not something you import. It is also where every map key constraint comes from: `map[K]V` requires `K` to be comparable, and so does `Set[T comparable]`.

After reading this file you will:
- Know what `comparable` is and why it is **predeclared** rather than a user interface
- Understand why `==`/`!=` are the only operators it unlocks
- Recognize which built-in types are comparable (and which are not)
- Use `comparable` to write your first generic `Set`, `Cache`, and `Contains`

---

## Prerequisites
- Comfortable with `[T any]` and `[T comparable]` syntax (covered in earlier sections)
- Familiar with Go's basic types: `int`, `string`, slices, maps, structs
- Understanding of map keys
- Go 1.18 or newer (1.20+ recommended; 1.21+ for `cmp.Ordered`)

---

## Glossary

| Term | Definition |
|------|------------|
| **`comparable`** | A predeclared constraint allowing `==` and `!=` |
| **Predeclared identifier** | A name built into the language, not imported (`int`, `any`, `error`, `comparable`) |
| **`==` / `!=`** | The equality operators — defined for "comparable" types |
| **`<`, `<=`, `>`, `>=`** | The ordering operators — require **`cmp.Ordered`**, not `comparable` |
| **`cmp.Ordered`** | A standard library constraint (Go 1.21+) for ordered types |
| **Strictly comparable** | A type where `==` is well-defined for **every** value (no runtime panic) |
| **Map key** | A value used as a key — Go requires it to be comparable |
| **Zero value** | The default value of `T` (empty for strings, 0 for ints, nil for pointers) |

---

## Core Concepts

### 1. `comparable` is predeclared

You do not need an import to use it:

```go
func Contains[T comparable](s []T, target T) bool {
    for _, v := range s {
        if v == target { return true }
    }
    return false
}
```

The name `comparable` is **part of the language**, like `int`, `error`, or `any`. You cannot redefine it. You cannot embed it in another interface for runtime use (with restrictions — more in `middle.md`).

### 2. What it allows: only `==` and `!=`

`comparable` is the **smallest** constraint that lets you compare two values. It does **not** allow `<`, `>`, or arithmetic. To get ordering, you need `cmp.Ordered` (covered in `senior.md`).

```go
func LessOrEqual[T comparable](a, b T) bool {
    return a <= b // compile error: comparable does not allow <=
}
```

### 3. Which Go types are comparable?

| Type | Comparable? |
|------|-------------|
| `bool` | ✓ |
| All numeric types (`int`, `float64`, `complex128`, …) | ✓ |
| `string` | ✓ |
| Pointers `*T` | ✓ (compares addresses) |
| Channels | ✓ |
| Interface types | ✓ (but may panic at runtime — see `middle.md`) |
| Arrays of comparable elements | ✓ |
| Structs whose fields are all comparable | ✓ |
| **Slices** `[]T` | ✗ |
| **Maps** `map[K]V` | ✗ |
| **Functions** | ✗ |

A struct that contains a slice is **not** comparable, because one of its fields is not.

### 4. Map keys must be comparable

This is the single most important reason `comparable` exists:

```go
m := map[string]int{}     // OK
n := map[[]byte]int{}     // compile error — slices are not comparable
```

Go's map implementation needs `==` to detect collisions. So map keys must be comparable. This was true long before generics.

### 5. `comparable` is **not** the same as "supports `<`"

A common beginner trap:

```go
func Min[T comparable](a, b T) T {
    if a < b { return a } // compile error
    return b
}
```

For `Min`, `Max`, and sorting, use `cmp.Ordered` instead:

```go
import "cmp"

func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}
```

---

## Real-World Analogies

**Analogy 1 — Library book lookup**

A library catalogue lets you ask "is this exact book in the system?" That is `==`. You can also ask "is this book before that one alphabetically?" — but only because the catalogue uses **author names**, which support order. `comparable` is the lookup-only catalogue. `cmp.Ordered` adds the alphabetical sort.

**Analogy 2 — Identical shirts**

Two shirts are "the same" if every property matches: brand, size, colour, pattern. That is struct equality. But if one of the properties is a *list* of stains, you cannot compare the lists with `==` — that is why a struct containing a slice is not comparable.

**Analogy 3 — Filing cabinet**

A filing cabinet uses a label as a key. You can write any text on the label (string is comparable). You cannot use a *folder* as the label of another folder (slices/maps/functions are not comparable).

**Analogy 4 — Locks and keys**

`comparable` is the lock that fits keys for `==`/`!=`. `cmp.Ordered` is a stronger lock that fits the same keys plus the ordering keys `<`, `>`, `<=`, `>=`.

---

## Mental Models

### Model 1 — "Equality is the floor"

`comparable` is the **minimum** you need to ask "are these two values the same?". Every other operation (ordering, hashing, indexing) depends on equality. Without `==`, your data structure cannot deduplicate.

### Model 2 — "Map keys = comparable types"

If a Go type can be a map key, it satisfies `comparable`. If it cannot, it does not. That is the simplest test you can run mentally.

### Model 3 — "Constraints unlock operators"

```
[T any]         → only assignment, copy, function call
[T comparable]  → +  ==, !=
[T cmp.Ordered] → +  <, <=, >, >=
[T MyNumber]    → +  arithmetic for the types in MyNumber
```

Each constraint adds operators. Pick the smallest one that compiles.

### Model 4 — "Predeclared, not imported"

`comparable` does not live in any package. It lives in the language. Same as `int`, `nil`, `error`, `any`. You can use it without `import`.

---

## Pros & Cons

### Pros

| Benefit | Why it matters |
|---------|----------------|
| **No import** | Predeclared — always available |
| **Compile-time safety** | Wrong-type comparisons rejected at build |
| **Universal map key constraint** | One concept covers maps, sets, dedup |
| **Tiny surface** | Easy to teach, easy to remember |

### Cons

| Drawback | Why it matters |
|----------|----------------|
| **No ordering** | Need `cmp.Ordered` for `<`, `>`, sort |
| **Excludes slices/maps/funcs** | You cannot use them as keys directly |
| **Interface satisfaction is subtle** | May panic at runtime in 1.20+ (covered later) |
| **Easy to confuse with `Ordered`** | Beginners reach for `comparable` when they need `Ordered` |

---

## Use Cases

`comparable` is the right tool when you need:

1. **Map keys** — `Cache[K comparable, V any]`
2. **Sets** — `Set[T comparable]`
3. **Equality checks** — `Contains`, `Index`, `Count`
4. **Deduplication** — `Distinct[T comparable]`
5. **Memoization keys** — `Memo[K comparable, V any]`

`cmp.Ordered` is the right tool when you need:

1. **Sorting** — `Sort[T cmp.Ordered]`
2. **Min / Max** — `Min[T cmp.Ordered]`
3. **Range queries** — `Between[T cmp.Ordered](v, lo, hi T) bool`
4. **Binary search** — `slices.BinarySearch`

`any` is the right tool when:

1. **No equality or ordering** is needed inside the body
2. **Pure pass-through** — `First[T any](s []T) T`

---

## Code Examples

### Example 1 — `Contains` over comparable

```go
package main

import "fmt"

func Contains[T comparable](s []T, target T) bool {
    for _, v := range s {
        if v == target {
            return true
        }
    }
    return false
}

func main() {
    fmt.Println(Contains([]int{1, 2, 3}, 2))           // true
    fmt.Println(Contains([]string{"a", "b"}, "c"))     // false
}
```

### Example 2 — A typed `Set`

```go
type Set[T comparable] struct {
    m map[T]struct{}
}

func NewSet[T comparable]() *Set[T] {
    return &Set[T]{m: map[T]struct{}{}}
}

func (s *Set[T]) Add(v T)        { s.m[v] = struct{}{} }
func (s *Set[T]) Has(v T) bool   { _, ok := s.m[v]; return ok }
func (s *Set[T]) Len() int       { return len(s.m) }
```

`T comparable` is required because the field `m` is a map keyed by `T`.

### Example 3 — `comparable` does NOT unlock `<`

```go
func Min[T comparable](a, b T) T {
    if a < b { return a } // compile error
    return b
}
```

Fix:

```go
import "cmp"

func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}
```

### Example 4 — Using `cmp.Ordered`

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

func main() {
    fmt.Println(Min(3, 5))         // 3
    fmt.Println(Min("zoo", "ant")) // ant
    fmt.Println(Min(2.5, 1.1))     // 1.1
}
```

### Example 5 — A struct with comparable fields

```go
type Point struct{ X, Y int }

p1 := Point{1, 2}
p2 := Point{1, 2}
fmt.Println(p1 == p2) // true

// As a set element
s := NewSet[Point]()
s.Add(p1)
fmt.Println(s.Has(p2)) // true
```

### Example 6 — A struct that is NOT comparable

```go
type Bag struct {
    Items []string // slice — not comparable
}

// var s = NewSet[Bag]() // compile error: Bag does not satisfy comparable
```

---

## Coding Patterns

### Pattern 1 — Constraint by need

Pick the constraint that matches the operations the body uses. If the body only does `==`, use `comparable`. If it does `<`, use `cmp.Ordered`.

### Pattern 2 — Map-keyed state

Whenever you store something keyed by `K`, write `[K comparable, V any]`. This is the canonical signature for caches, sets, indexes.

### Pattern 3 — Reuse stdlib constraints

```go
import "cmp"

// Good
func Sort[T cmp.Ordered](s []T) { ... }

// Avoid — re-inventing
type MyOrdered interface { ~int | ~float64 | ~string }
func Sort[T MyOrdered](s []T) { ... }
```

The standard library's `cmp.Ordered` is canonical.

### Pattern 4 — Pair `comparable` with `any`

```go
func Index[T comparable](s []T, target T) int { ... }
type Page[T any] struct{ Items []T; Total int }
```

`comparable` for the lookup type; `any` for the payload.

---

## Clean Code

- Use `[T comparable]` only when the body actually uses `==` or `!=`.
- Use `[T cmp.Ordered]` only when the body actually uses `<` or family.
- Never write `[T comparable]` and then never compare — promote to `[T any]`.
- Name the parameter `K` for keys, `T` for elements, `E` for entries.

```go
// Clean
func Index[T comparable](s []T, target T) int { ... }

// Less clean — the constraint is unused
func First[T comparable](s []T) T { ... } // any would do
```

---

## Product Use / Feature

Real product scenarios that lean on `comparable` or `Ordered`:

1. **User caches** — `Cache[UserID comparable, *User]`
2. **Tag sets** — `Set[Tag string]` with comparable strings
3. **Sorted leaderboards** — `Top[T cmp.Ordered](s []T, n int) []T`
4. **Range filters** — `Between[T cmp.Ordered](lo, hi T) func(T) bool`
5. **Deduplication of audit logs** — `Distinct[Event comparable]`
6. **Routing tables** — `map[Path]Handler` for comparable `Path`

---

## Error Handling

Comparison itself does not return errors, but **runtime panics** are possible in two scenarios:

1. **Comparing interface values whose dynamic types are not comparable** (Go 1.20+):
   ```go
   var a, b any
   a, b = []int{1}, []int{2}
   _ = a == b // runtime panic: comparing uncomparable type []int
   ```
2. **Map operations on a non-comparable key** — this is rejected at compile time, not runtime, but worth knowing.

For floats, `NaN != NaN`. So `Contains([]float64{math.NaN()}, math.NaN())` returns `false`. If you want NaN-aware logic, write it explicitly.

---

## Security Considerations

- **Constant-time equality**: `==` on strings is **not** constant-time. For password or token comparison, use `crypto/subtle.ConstantTimeCompare`. Generics do not help here.
- **Untrusted map keys**: a remote-supplied key could collide deliberately to slow your map. This is a hash-flood concern, not a `comparable` concern, but the consequence shows up in code that uses `comparable` keys.
- **NaN smuggling**: float NaNs make `==` return false. If an attacker can plant a NaN in a set, they can bypass duplicate detection.

---

## Performance Tips

- Comparing simple scalars (`int`, `string`) is essentially free.
- Comparing large structs is **O(field count)** — every field is compared. A struct with 50 string fields is 50 string compares.
- Comparing arrays of size N is O(N).
- Generics over `comparable` may go through a runtime dictionary for the equality call when the type is pointer-shaped — usually still fast, but worth profiling on hot paths.
- For frequent equality on big structs, consider hashing once and comparing hashes.

---

## Best Practices

1. **Use the smallest constraint that compiles.** `any` → `comparable` → `cmp.Ordered`.
2. **Prefer `cmp.Ordered` over hand-rolled** ordered constraints.
3. **Document non-obvious comparability requirements** — e.g., "key must not be a struct containing slices".
4. **Be explicit about NaN** when working with floats.
5. **Use `slices.Equal` / `maps.Equal`** for slices and maps — they bypass `==` because slices are not comparable.
6. **Never rely on pointer equality for value semantics** — `*T == *T` compares addresses.
7. **Avoid `interface{}` keys** in caches; pick a concrete comparable key type.
8. **Test with at least one user-defined struct** to confirm comparability.

---

## Edge Cases & Pitfalls

### 1. Floating-point NaN

```go
import "math"

n := math.NaN()
fmt.Println(n == n) // false
```

So a `Set[float64]` may end up with two "NaN" entries that are never equal.

### 2. Pointer equality

```go
a := &User{Name: "A"}
b := &User{Name: "A"}
fmt.Println(a == b) // false — different addresses
```

`==` on pointers compares **addresses**, not contents.

### 3. Interface types with non-comparable dynamic types

```go
var a, b any = []int{1}, []int{1}
_ = a == b // runtime panic
```

In Go 1.20+, `comparable` covers interfaces, but the **runtime** can still panic.

### 4. `comparable` does NOT include `<`

Easy to forget. The compile error is friendly, but only the first time.

### 5. Empty struct `struct{}` is comparable

It is the canonical "marker" type. `Set[T]` uses `map[T]struct{}` for that reason.

---

## Common Mistakes

1. **Using `[T comparable]` and never comparing.** Use `[T any]`.
2. **Using `[T comparable]` and trying `<`.** Switch to `cmp.Ordered`.
3. **Trying to use a slice as a map key.** Compile error — slices are not comparable.
4. **Comparing `*T` and expecting value equality.** It compares pointers.
5. **Not checking for NaN** in float aggregations.
6. **Re-defining `Ordered`** instead of importing `cmp.Ordered`.

---

## Common Misconceptions

- **"`comparable` includes `<`."** No — only `==` and `!=`.
- **"`any` is the same as `comparable`."** No — `any` is broader; `comparable` is a strict subset.
- **"Slices are comparable."** No. Use `slices.Equal` for content equality.
- **"`cmp.Ordered` includes complex numbers."** No — see `senior.md`.
- **"Two NaNs are equal."** No. By IEEE-754, `NaN != NaN`.
- **"Predeclared and stdlib are the same."** Predeclared identifiers (`comparable`, `any`, `error`) live in the language; `cmp.Ordered` lives in the `cmp` package and must be imported.

---

## Tricky Points

1. **`comparable` was relaxed in Go 1.20.** Before 1.20, interfaces did **not** satisfy `comparable`. Since 1.20 they do — but `==` may panic at runtime if the dynamic types are uncomparable. (Detailed in `middle.md`.)
2. **Arrays vs slices.** `[3]int` is comparable; `[]int` is not. Same elements, different shapes.
3. **`cmp.Ordered` requires Go 1.21+.** On older versions, use `golang.org/x/exp/constraints.Ordered`.
4. **You cannot embed `comparable` in a regular interface for runtime polymorphism**, only as a constraint.
5. **Channels are comparable** — they compare by reference identity, like pointers.

---

## Test

Test yourself before continuing.

1. Is `comparable` predeclared or imported?
2. Which two operators does `comparable` unlock?
3. Which package contains `cmp.Ordered`?
4. Why is `[]int` not comparable?
5. Is a `struct{ Tags []string }` comparable?
6. What does `==` mean for two `*User` pointers?
7. What is `math.NaN() == math.NaN()`?
8. Why must map keys be comparable?
9. Which Go version added `cmp.Ordered`?
10. What is the smallest constraint that allows `<`?

(Answers: 1) predeclared; 2) `==` and `!=`; 3) `cmp`; 4) slice equality is not defined by `==`; 5) no — has a slice field; 6) address equality; 7) false; 8) the map needs to detect collisions; 9) 1.21; 10) `cmp.Ordered`.)

---

## Tricky Questions

**Q1.** Why does this fail to compile?
```go
func Eq[T any](a, b T) bool { return a == b }
```
**A.** `any` does not allow `==`. Use `[T comparable]`.

**Q2.** Why does this compile but panic at runtime?
```go
func Eq[T comparable](a, b T) bool { return a == b }
Eq[any]([]int{1}, []int{1})
```
**A.** Since Go 1.20, `any` satisfies `comparable` at compile time. At runtime, `==` on slices is not defined and panics.

**Q3.** Will this compile?
```go
type Key struct { Tags []string }
m := map[Key]int{}
```
**A.** No. `Key` contains a slice and is therefore not comparable, so it cannot be a map key.

**Q4.** Will `Set[float64]{NaN, NaN}` deduplicate?
**A.** No — `NaN != NaN`, so each NaN is treated as a new key.

**Q5.** Difference between `[T comparable]` and `[T cmp.Ordered]`?
**A.** `comparable` allows `==`/`!=`. `cmp.Ordered` allows that **plus** `<`, `<=`, `>`, `>=`.

---

## Cheat Sheet

```go
// comparable — predeclared, no import
func Has[T comparable](s []T, v T) bool { ... }

// cmp.Ordered — Go 1.21+
import "cmp"
func Min[T cmp.Ordered](a, b T) T { ... }

// Map keys → must be comparable
type Cache[K comparable, V any] struct { m map[K]V }

// Set with comparable key
type Set[T comparable] struct { m map[T]struct{} }

// Things that are NOT comparable: slice, map, function
// Things that ARE: bool, numbers, string, pointer, channel, array, struct of comparable fields
```

| Constraint | Allows | Predeclared? | Import |
|------------|--------|--------------|--------|
| `any` | nothing extra | yes | none |
| `comparable` | `==`, `!=` | yes | none |
| `cmp.Ordered` | `==`, `!=`, `<`, `<=`, `>`, `>=` | no | `cmp` |

---

## Self-Assessment Checklist

- [ ] I know `comparable` is predeclared.
- [ ] I can list types that are and are not comparable.
- [ ] I know `==` is not defined for slices, maps, functions.
- [ ] I can write `Set[T comparable]` and `Cache[K comparable, V any]`.
- [ ] I import `cmp` for `cmp.Ordered`.
- [ ] I know `NaN != NaN`.
- [ ] I know `==` on pointers compares addresses, not contents.
- [ ] I can pick between `comparable` and `cmp.Ordered`.

If you ticked at least 6, move on to `middle.md`.

---

## Summary

`comparable` is the **predeclared** constraint that unlocks `==` and `!=` inside generic code. It is required for map keys, sets, caches, and any algorithm that does equality. `cmp.Ordered`, added in Go 1.21, extends that to ordering operators (`<`, `<=`, `>`, `>=`). They are **the** two constraints you will reach for most often.

Pick the smallest constraint that lets your function compile. Avoid re-defining `Ordered`; import it from `cmp`. Beware of float NaN and of structs that contain non-comparable fields (slices, maps, functions). Once these rules click, half of all generic Go you will write becomes routine.

---

## What You Can Build

After this section you can build:

1. A typed `Set[T comparable]` with `Add`, `Has`, `Remove`, `Union`.
2. A `Cache[K comparable, V any]` with TTL.
3. A `SortedSlice[T cmp.Ordered]` that maintains order on insert.
4. A `Top[T cmp.Ordered]` "top-N" helper.
5. A `Distinct[T comparable]` deduplicator.
6. A `Range[T cmp.Ordered]` filter.

---

## Further Reading

- [Go spec: Comparison operators](https://go.dev/ref/spec#Comparison_operators)
- [Go spec: Type sets](https://go.dev/ref/spec#General_interfaces)
- [`cmp` package documentation](https://pkg.go.dev/cmp)
- [Go 1.20 release notes — `comparable` change](https://go.dev/doc/go1.20#language)
- [Go 1.21 release notes — `cmp` package](https://go.dev/doc/go1.21#cmp)
- [`slices.Equal` documentation](https://pkg.go.dev/slices#Equal)

---

## Related Topics

- **4.6 Generic Constraints Deep** — the full constraint system
- **4.12 Stdlib Generic Packages** — `slices`, `maps`, `cmp` in practice
- **3.x Maps** — why map keys must be comparable
- **5.x Performance** — equality cost on large structs

---

## Diagrams & Visual Aids

### The constraint hierarchy

```
[T any]
   │
   ▼
[T comparable]   ← unlocks == and !=
   │
   ▼
[T cmp.Ordered]  ← unlocks <, <=, >, >=
```

### What is comparable?

```
COMPARABLE                        NOT COMPARABLE
┌───────────────────┐            ┌───────────────────┐
│ bool              │            │ []T  (slice)      │
│ int, float, ...   │            │ map[K]V           │
│ string            │            │ func(...)         │
│ pointer           │            │ struct with above │
│ channel           │            │                   │
│ interface (1.20+) │            │                   │
│ array of above    │            │                   │
│ struct of above   │            │                   │
└───────────────────┘            └───────────────────┘
```

### Map key must be comparable

```
map[K]V
     │
     └──► K satisfies comparable  ← required by Go's map implementation
```
