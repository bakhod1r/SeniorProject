# Stdlib Generic Packages — Junior Level

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
> Focus: "What does the stdlib give us, and how do we use it?"

When generics shipped in **Go 1.18**, the standard library deliberately stayed almost empty of them. The team wanted to watch how the community used type parameters before promoting helpers to stdlib. **One year later**, in **Go 1.21 (August 2023)**, three packages landed and immediately replaced **dozens** of hand-written helpers in real codebases:

1. **`slices`** — algorithms that operate on slices: search, sort, equal, min/max, insert, delete.
2. **`maps`** — utilities for maps: keys, values, clone, equal, copy, deletion by predicate.
3. **`cmp`** — comparison helpers and the `cmp.Ordered` constraint shared by every "this T can be compared with `<`" function in the language.

These three packages are the **first place** a Go programmer should look before writing `func ContainsX(...)`, `func MapKeys(...)`, or `func MinFloat64(...)`. The chance is high that the function already exists, is faster than what you would write, and is supported on every platform Go runs on.

```go
import (
    "cmp"
    "fmt"
    "slices"
)

func main() {
    nums := []int{3, 1, 4, 1, 5, 9, 2, 6}
    slices.Sort(nums)
    fmt.Println(nums)                       // [1 1 2 3 4 5 6 9]
    fmt.Println(slices.Contains(nums, 5))   // true
    fmt.Println(slices.Index(nums, 9))      // 7
    fmt.Println(slices.Max(nums))           // 9
    fmt.Println(cmp.Compare(3, 5))          // -1
}
```

After reading this file you will:
- Know **which package to reach for** when you need a slice, map, or comparison helper
- Recognize the **most common functions** by signature
- Tell the difference between `slices.Index` and `slices.IndexFunc` at a glance
- Understand the role of `cmp.Ordered` as the universal "ordered" constraint

---

## Prerequisites
- Go 1.21 or newer in `go.mod`
- Basic familiarity with type parameters (`[T any]`, `[T comparable]`)
- Knowledge of slices, maps, and `for range`
- Familiarity with `func(a, b T) int` comparator style

---

## Glossary

| Term | Definition |
|------|------------|
| `slices` | Stdlib package of generic slice algorithms (Go 1.21+) |
| `maps` | Stdlib package of generic map utilities (Go 1.21+) |
| `cmp` | Stdlib package of comparison helpers (Go 1.21+) |
| `cmp.Ordered` | Constraint for types usable with `<`, `<=`, `>`, `>=` |
| `cmp.Compare` | Returns -1, 0, +1 for `a<b`, `a==b`, `a>b` |
| `cmp.Less` | Boolean version of `Compare` |
| `cmp.Or` | Returns first non-zero argument (Go 1.22+) |
| Comparator | A `func(a, b T) int` returning -1, 0, +1 |
| In-place API | Mutates the input slice (e.g., `slices.Sort`) |
| Copying API | Returns a new slice (e.g., `slices.Clone`) |

---

## Core Concepts

### 1. The `slices` package — algorithms over a slice

`slices` collects the algorithms every Go team used to write by hand. Highlights:

```go
slices.Contains(s, target)              // bool
slices.Index(s, target)                 // int — -1 if absent
slices.Equal(a, b)                      // bool
slices.Sort(s)                          // in-place
slices.IsSorted(s)                      // bool
slices.Reverse(s)                       // in-place
slices.Concat(a, b, c)                  // []T (1.22+)
slices.Min(s)                           // T (panics if empty)
slices.Max(s)                           // T (panics if empty)
slices.BinarySearch(s, target)          // (idx int, found bool)
slices.Insert(s, i, v...)               // []T
slices.Delete(s, i, j)                  // []T
slices.Clone(s)                         // []T
slices.Compact(s)                       // []T (deduplicate adjacent)
```

The constraint depends on the function. `Contains` and `Index` need `comparable`. `Sort` and `Min`/`Max` need `cmp.Ordered`. `Equal` needs `comparable`. `Reverse` and `Clone` need only `any`.

### 2. The `maps` package — map utilities

`maps` is smaller than `slices` because maps are simpler:

```go
maps.Keys(m)            // iter.Seq[K] in 1.23+, was []K in early drafts
maps.Values(m)          // iter.Seq[V] in 1.23+
maps.Equal(a, b)        // bool
maps.Clone(m)           // map[K]V
maps.Copy(dst, src)     // copies src into dst
maps.DeleteFunc(m, fn)  // removes entries where fn(k, v) is true
```

In Go 1.23+, `maps.Keys` and `maps.Values` return an iterator (`iter.Seq[K]`). To build a slice you wrap with `slices.Collect`:

```go
keys := slices.Collect(maps.Keys(m))   // []K
```

### 3. The `cmp` package — comparison helpers

`cmp` is tiny but central:

```go
type Ordered interface { /* int, float, string family */ }

func Compare[T Ordered](a, b T) int   // -1, 0, +1
func Less[T Ordered](a, b T) bool     // a < b
func Or[T comparable](vals ...T) T    // first non-zero (1.22+)
```

`cmp.Compare` is the **standard comparator** every `*Func` API expects. `cmp.Or` replaces ten years of "first non-empty string" helper functions.

### 4. Naming convention: plain vs `Func` variant

Most `slices` algorithms come in **two flavours**:

| Plain (uses `==` or `<`) | `Func` (uses callback) |
|--------------------------|------------------------|
| `slices.Contains` | `slices.ContainsFunc` |
| `slices.Index` | `slices.IndexFunc` |
| `slices.Sort` | `slices.SortFunc` |
| `slices.Compact` | `slices.CompactFunc` |
| `slices.BinarySearch` | `slices.BinarySearchFunc` |

The plain version requires `comparable` or `cmp.Ordered`. The `Func` version takes a callback so any `T` works — even slices, maps, structs with non-comparable fields.

### 5. The constraint shape table

| Function family | Constraint | Why |
|-----------------|-----------|-----|
| `Contains`, `Index`, `Equal` | `comparable` | uses `==` |
| `Sort`, `Min`, `Max`, `BinarySearch` | `cmp.Ordered` | uses `<` |
| `SortFunc`, `IndexFunc` | `any` | callback handles compare |
| `Reverse`, `Clone`, `Concat` | `any` | no comparison |

---

## Real-World Analogies

**Analogy 1 — A toolbox**

`slices` is your hammer-and-screwdriver toolbox. Every operation you need on a slice is already in there. Reaching for hand-rolled code is like forging your own hammer.

**Analogy 2 — A measuring stick (`cmp`)**

`cmp.Compare` is the universal measuring stick: every sort, search, and "smaller of two" call agrees on the same -1/0/+1 convention.

**Analogy 3 — Maps as bags of stuff**

`maps.Keys`, `maps.Values`, `maps.Equal`, `maps.Clone` are like a checklist of "things you can do to a bag without caring what is inside it".

---

## Mental Models

### Model 1 — "Look in `slices` first"

Before writing any helper that operates on a `[]T`, search godoc for `slices.X`. Most likely it exists.

### Model 2 — "Plain or Func?"

Ask: "Do my elements support `==` or `<`?" Yes → plain. No or "I need custom comparison" → `Func` variant.

### Model 3 — "`cmp.Compare` is the glue"

`slices.SortFunc(people, func(a, b Person) int { return cmp.Compare(a.Age, b.Age) })` — this idiom is everywhere in modern Go.

---

## Pros & Cons

### Pros

| Benefit | Why it matters |
|---------|----------------|
| Battle-tested algorithms | Heavily benchmarked by the Go team |
| Removes `sort.Slice` boilerplate | Less code per call site |
| Type-safe at compile time | No more `interface{}` plus assertions |
| Single import for most needs | `slices`, `maps`, `cmp` cover 90% |
| Stable API | Promised compatibility from 1.21 onward |

### Cons

| Drawback | Why it matters |
|----------|----------------|
| Requires Go 1.21+ | Older codebases must upgrade |
| Some functions panic on empty input | `slices.Min` panics; you must guard |
| `maps.Keys` switched to iterators | Behaviour change between 1.21 and 1.23 |
| Not every helper is here | `Reduce`, `GroupBy`, `Chunk` are absent |

---

## Use Cases

1. **Sorting people by age** with `slices.SortFunc` and `cmp.Compare`
2. **Finding the maximum** of a config slice with `slices.Max`
3. **Deduplicating** a sorted slice with `slices.Compact`
4. **Cloning** a slice or map before mutating
5. **Computing the union of keys** across two maps

---

## Code Examples

### Example 1 — Sort and search

```go
package main

import (
    "fmt"
    "slices"
)

func main() {
    s := []string{"banana", "apple", "cherry"}
    slices.Sort(s)
    fmt.Println(s)                            // [apple banana cherry]
    idx, ok := slices.BinarySearch(s, "banana")
    fmt.Println(idx, ok)                      // 1 true
}
```

### Example 2 — Sort structs with `cmp.Compare`

```go
import (
    "cmp"
    "slices"
)

type Person struct {
    Name string
    Age  int
}

func main() {
    p := []Person{{"Bob", 30}, {"Ann", 25}, {"Cy", 27}}
    slices.SortFunc(p, func(a, b Person) int {
        return cmp.Compare(a.Age, b.Age)
    })
    // p is now sorted by Age ascending
}
```

### Example 3 — Deduplicate a sorted slice

```go
nums := []int{1, 1, 2, 3, 3, 3, 4}
nums = slices.Compact(nums)
fmt.Println(nums) // [1 2 3 4]
```

`Compact` removes **adjacent** duplicates, so the input must be sorted first.

### Example 4 — Map clone

```go
import "maps"

orig := map[string]int{"a": 1, "b": 2}
copy := maps.Clone(orig)
copy["c"] = 3
fmt.Println(orig) // {"a":1, "b":2}
fmt.Println(copy) // {"a":1, "b":2, "c":3}
```

### Example 5 — Delete entries by predicate

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
maps.DeleteFunc(m, func(k string, v int) bool {
    return v%2 == 0
})
fmt.Println(m) // {"a":1, "c":3}
```

### Example 6 — `cmp.Or` for first non-empty

```go
import "cmp"

name := cmp.Or(userInput, configValue, "default")
```

`cmp.Or` returns the first non-zero argument. With Go 1.22+, this idiom replaces every "if a != \"\" return a; if b != \"\" return b" chain.

---

## Coding Patterns

### Pattern 1 — Sort by multiple keys with `cmp.Or`

```go
slices.SortFunc(people, func(a, b Person) int {
    return cmp.Or(
        cmp.Compare(a.Last, b.Last),
        cmp.Compare(a.First, b.First),
        cmp.Compare(a.Age, b.Age),
    )
})
```

### Pattern 2 — Pre-sort, then `BinarySearch`

```go
slices.Sort(s)
idx, ok := slices.BinarySearch(s, target)
```

`O(log n)` lookup once you have paid for sorting.

### Pattern 3 — Build a slice from map keys

```go
keys := slices.Collect(maps.Keys(m)) // 1.23+
slices.Sort(keys)
```

In 1.21/1.22 the API returned `[]K` directly; from 1.23 onward it returns an iterator and you must collect.

### Pattern 4 — Equal check with custom comparator

```go
slices.EqualFunc(a, b, func(x, y Person) bool { return x.ID == y.ID })
```

---

## Clean Code

- Prefer `slices.X` and `maps.X` to hand-rolled equivalents.
- Prefer `cmp.Compare` over `if a < b ... else ...` inside `SortFunc`.
- Sort before deduplicating with `slices.Compact`.
- Do not write `MyKeys[K, V]` if `maps.Keys` already exists.

---

## Product Use / Feature

Real product scenarios:

1. **Leaderboard sorting** — `slices.SortFunc` with `cmp.Compare` on score
2. **Search-by-prefix** in a sorted dictionary using `slices.BinarySearchFunc`
3. **Diffing config maps** with `maps.Equal`
4. **Cloning request headers** with `maps.Clone`
5. **Returning the highest version** with `slices.Max`

---

## Error Handling

The stdlib generic packages do not return errors — they panic on truly invalid input:

- `slices.Min([]T{})` and `slices.Max([]T{})` **panic** on empty slices
- `slices.Insert` panics on out-of-range index
- `slices.Delete` panics on `i > j` or out-of-range

Always guard the empty case for `Min`/`Max`:

```go
if len(s) == 0 { return zero, false }
return slices.Min(s), true
```

---

## Security Considerations

- `slices.Clone` produces a shallow copy. Pointer-typed elements still share the underlying data.
- `maps.Clone` is also shallow.
- Comparing untrusted strings with `cmp.Compare` is fine for ordering but **not** constant-time — use `crypto/subtle.ConstantTimeCompare` for secret comparison.

---

## Performance Tips

- `slices.Contains` is `O(n)`. For sorted data, `slices.BinarySearch` is `O(log n)`.
- `slices.Sort` uses an in-place sort. For copy-and-sort, use `slices.Sorted` (1.23+) or `slices.Clone` first.
- `slices.Compact` returns a slice that **aliases** the input — the trailing region is unspecified.
- `maps.Clone` is faster than a for-range copy because it knows the map's internal layout.

---

## Best Practices

1. **Default to `slices`/`maps`/`cmp`** before writing your own.
2. **Pin Go 1.21+** in `go.mod` so the imports are available.
3. **Sort with `slices.SortFunc(s, cmp.Compare)`** for the ordered-but-Func case.
4. **Use `cmp.Or`** to replace nested "first-non-empty" chains.
5. **Read the godoc page** at <https://pkg.go.dev/slices> before writing helpers.
6. **Guard `slices.Min`/`Max`** against empty input.

---

## Edge Cases & Pitfalls

### 1. `slices.Min`/`Max` panic on empty input

```go
slices.Min([]int{}) // panic: slices.Min: empty list
```

### 2. `slices.Compact` requires sorted input

```go
slices.Compact([]int{1, 2, 1, 2}) // [1 2 1 2] — only adjacent duplicates removed
```

Sort first.

### 3. `maps.Keys` is unordered

Map iteration order is randomized. Sort the keys if you need determinism:

```go
keys := slices.Collect(maps.Keys(m))
slices.Sort(keys)
```

### 4. `slices.Delete` zeroes the trailing elements

To allow garbage collection, `slices.Delete` writes the zero value into the freed slots. The returned slice has the right length, but the underlying array's tail is no longer your data.

### 5. `slices.Insert` may reallocate

If the input has insufficient capacity, `Insert` returns a new slice. Always reassign: `s = slices.Insert(s, i, v...)`.

---

## Common Mistakes

1. **Writing your own `Contains` for `[]int`.** Use `slices.Contains`.
2. **Sorting with `sort.Slice` in new code.** Use `slices.SortFunc`.
3. **Calling `slices.Min` on empty input** without a guard.
4. **Forgetting to sort before `slices.Compact`.**
5. **Assuming `maps.Keys` returns a sorted slice.** It does not.
6. **Not reassigning the result of `slices.Insert`/`Delete`.**

---

## Common Misconceptions

- "**`slices.Sort` is a stable sort.**" No — it is `pdqsort`, **not stable**. Use `slices.SortStableFunc` for stable.
- "**`maps.Equal` checks deep equality.**" No — it uses `==` on values. For deep equality use `maps.EqualFunc` with `reflect.DeepEqual`.
- "**`cmp.Compare` works on any type.**" No — only on `cmp.Ordered`.
- "**`maps.Keys` returns a slice.**" From 1.23 it returns an iterator (`iter.Seq[K]`).

---

## Tricky Points

1. `slices.Sort` on `[]float64` orders `NaN` first (per `cmp.Compare` rule).
2. `slices.Equal` and `maps.Equal` treat `NaN != NaN` — two slices of `NaN` are not equal.
3. `slices.Compact` may return a slice with reduced length but the same capacity.
4. `cmp.Or` returns the first **non-zero** argument; the meaning of "zero" is the type's zero value.

---

## Test

1. Which Go version added `slices`, `maps`, `cmp` to the stdlib?
2. Name three functions in `slices` that require `cmp.Ordered`.
3. What is the return type of `cmp.Compare`?
4. Does `slices.Sort` produce a stable sort?
5. What does `cmp.Or("","",  "x", "y")` return?
6. What constraint does `slices.Contains` require?
7. What is the difference between `slices.Index` and `slices.IndexFunc`?
8. What does `maps.Keys` return in Go 1.23?

(Answers: 1) 1.21; 2) `Sort`, `Min`, `Max`, `BinarySearch`, `IsSorted`; 3) `int`; 4) no; 5) `"x"`; 6) `comparable`; 7) `Index` uses `==`, `IndexFunc` takes a predicate; 8) `iter.Seq[K]`.)

---

## Tricky Questions

**Q1.** What is the result of `slices.Compact([]int{1, 2, 1, 2})`?
**A.** `[1 2 1 2]` — `Compact` only removes **adjacent** duplicates.

**Q2.** Does `slices.Sort` allocate?
**A.** No — it is fully in-place.

**Q3.** What does `cmp.Or()` (no arguments) return?
**A.** The zero value of `T` — but you cannot infer `T` with no arguments, so this fails to compile.

---

## Cheat Sheet

```go
// slices
slices.Contains(s, x)            // ==
slices.ContainsFunc(s, pred)
slices.Index(s, x)
slices.Equal(a, b)               // ==
slices.EqualFunc(a, b, eq)
slices.Sort(s)                   // < (cmp.Ordered)
slices.SortFunc(s, cmp)          // -1/0/+1
slices.SortStableFunc(s, cmp)
slices.IsSorted(s)
slices.Reverse(s)
slices.Concat(a, b, c)
slices.Min(s); slices.Max(s)
slices.BinarySearch(s, x)
slices.BinarySearchFunc(s, x, cmp)
slices.Insert(s, i, v...)
slices.Delete(s, i, j)
slices.Clone(s)
slices.Compact(s); slices.CompactFunc(s, eq)

// maps
maps.Keys(m); maps.Values(m)
maps.Equal(a, b); maps.EqualFunc(a, b, eq)
maps.Clone(m); maps.Copy(dst, src)
maps.DeleteFunc(m, pred)

// cmp
cmp.Ordered                  // constraint
cmp.Compare(a, b)            // -1/0/+1
cmp.Less(a, b)               // bool
cmp.Or(v1, v2, v3)           // first non-zero
```

---

## Self-Assessment Checklist

- [ ] I know which Go release added these packages.
- [ ] I can find any common slice algorithm in the godoc for `slices`.
- [ ] I can sort a struct slice with `slices.SortFunc` plus `cmp.Compare`.
- [ ] I know the difference between `Sort` and `SortStableFunc`.
- [ ] I know that `maps.Keys` is unordered.
- [ ] I have replaced at least one hand-written helper with a stdlib call.

---

## Summary

The `slices`, `maps`, and `cmp` packages are the **foundation** of generic-flavoured Go since 1.21. They cover the majority of "I just need a helper for slices/maps" cases. Each package has a tiny surface, but together they removed thousands of duplicated helpers from real codebases.

The two big idioms to internalize:

1. **`slices.SortFunc(s, cmp.Compare)`** for ordered-but-callback-style sorting
2. **`cmp.Or(a, b, c)`** for "first non-zero" chains

Once `slices`, `maps`, and `cmp` are part of your muscle memory, you stop writing `func contains(...)` forever.

Move on to `middle.md` to learn the `*Func` variants and multi-key sort patterns.

---

## What You Can Build

After this section you can build:

1. A leaderboard with `slices.SortFunc` plus `cmp.Compare`
2. A deduplication pipeline with `slices.Sort` plus `slices.Compact`
3. A diff utility with `maps.Equal`
4. A "first non-empty" config resolver with `cmp.Or`
5. A set wrapper backed by a map with `maps.Keys` for iteration

---

## Further Reading

- [`slices` package](https://pkg.go.dev/slices)
- [`maps` package](https://pkg.go.dev/maps)
- [`cmp` package](https://pkg.go.dev/cmp)
- [Go 1.21 release notes](https://go.dev/doc/go1.21)
- [Go 1.22 release notes](https://go.dev/doc/go1.22)
- [Go 1.23 release notes — iterators](https://go.dev/doc/go1.23)

---

## Related Topics

- **4.13 `comparable` and `cmp.Ordered`** — the constraint behind these APIs
- **4.7 Generic Performance** — when stdlib generics inline cleanly
- **3.x Sort package** — the pre-1.21 way that still works
- **iter.Seq** — the new iterator type used by `maps.Keys` since 1.23

---

## Diagrams & Visual Aids

### The three packages at a glance

```
   ┌─────────┐    ┌──────┐    ┌───────┐
   │ slices  │    │ maps │    │  cmp  │
   ├─────────┤    ├──────┤    ├───────┤
   │ Sort    │    │ Keys │    │ Ord.  │
   │ Search  │    │ Vals │    │ Comp. │
   │ Equal   │    │ Equal│    │ Less  │
   │ Compact │    │ Clone│    │ Or    │
   │ Insert  │    │ Copy │    │       │
   │ Delete  │    │ DelF │    │       │
   └─────────┘    └──────┘    └───────┘
        \\           |           /
         \\          |          /
          \\         |         /
        Common idiom: SortFunc(s, cmp.Compare)
```

### Plain vs Func variant

```
slices.Contains    ←→ slices.ContainsFunc
slices.Index       ←→ slices.IndexFunc
slices.Sort        ←→ slices.SortFunc
slices.Compact     ←→ slices.CompactFunc
slices.BinarySearch←→ slices.BinarySearchFunc

  Plain: needs comparable / cmp.Ordered
  Func : works for any T, callback decides
```

### Decision tree — which function do I want?

```
Need to find a value in a slice?
   ├── elements are comparable → slices.Contains / Index
   ├── need a predicate         → slices.ContainsFunc / IndexFunc
   └── slice is sorted          → slices.BinarySearch / BinarySearchFunc

Need to sort?
   ├── elements are cmp.Ordered → slices.Sort
   ├── need custom comparator   → slices.SortFunc
   └── need stability           → slices.SortStableFunc

Need to deduplicate?
   ├── adjacent only            → slices.Compact / CompactFunc
   └── full dedup               → Sort first, then Compact

Need to operate on a map?
   ├── enumerate keys           → maps.Keys (+ slices.Collect)
   ├── enumerate values         → maps.Values (+ slices.Collect)
   ├── shallow copy             → maps.Clone
   ├── compare two              → maps.Equal / EqualFunc
   └── filter entries           → maps.DeleteFunc

Need to compare two values?
   ├── total ordering -1/0/+1   → cmp.Compare
   ├── boolean less             → cmp.Less
   └── first non-zero           → cmp.Or
```

### Constraint table

```
+--------------------+--------------------------+-------------------+
| Constraint         | Allowed operations       | Typical use       |
+--------------------+--------------------------+-------------------+
| any                | none specific            | *Func variants    |
| comparable         | == != map keys           | Contains, Index   |
| cmp.Ordered        | < <= > >= ==             | Sort, Min, Max    |
+--------------------+--------------------------+-------------------+
```

### Tip: prefer named imports

```go
import (
    "cmp"
    "slices"
    "maps"
)
```

These three import paths are **short on purpose**. A typical file that uses generics imports all three at the top and treats them as part of the toolbox. There is no `slicesutil` or `mapsutil` to keep around.
