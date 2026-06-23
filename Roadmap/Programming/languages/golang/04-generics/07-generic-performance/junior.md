# Generic Performance — Junior Level

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
> Focus: "Are generics free?" The honest answer is **no — but they are usually cheap and almost always cheaper than `interface{}`**.

A common belief among new Go programmers is that generics are a zero-cost abstraction in the C++ sense — that the compiler will produce one specialised copy per type and the resulting code will be exactly as fast as hand-written. This is **not how Go works**. Since Go 1.18 the compiler uses **GC shape stenciling with dictionary passing**, which is a deliberate compromise between binary size and runtime speed.

The practical consequences for a junior Go developer are simple:

1. Generics over numeric types (`int`, `float64`) are essentially **free**.
2. Generics over many different pointer-shaped types may have a **measurable** dictionary cost.
3. Generics are **almost always faster** than the `interface{}`-based code they replace.

This file builds the mental model. We benchmark a generic `Min`, an interface-based `Min`, and a hand-written `Min` so the gap between them stops being theoretical.

```go
// Generic
func MinG[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}

// Interface
func MinI(a, b any) any {
    if a.(int) < b.(int) { return a }
    return b
}

// Concrete
func MinC(a, b int) int {
    if a < b { return a }
    return b
}
```

Three implementations of the same function. By the end of this file you will know **which one to reach for in production code** and **why**.

After reading this file you will:
- Understand that Go generics are **not** monomorphized like C++ templates
- Read a basic `testing.B` benchmark and interpret `ns/op` and `allocs/op`
- Predict whether a particular generic call will be cheap or costly
- Know when to use `slices.Sort` instead of `sort.Slice`

---

## Prerequisites
- Basic Go syntax: functions, slices, interfaces
- You have read `04-generics/01-why-generics/junior.md`
- You can run `go test -bench=.`
- Ability to compile with Go **1.21 or newer** (for `cmp` and `slices`)

---

## Glossary

| Term | Definition |
|------|------------|
| **Monomorphization** | Generating one specialised copy per type argument (C++/Rust style) |
| **GC shape stenciling** | Go's strategy — one copy per memory layout, plus runtime dictionary |
| **Dictionary** | A hidden parameter passed to a generic function with type-specific operations |
| **Boxing** | Wrapping a value in `interface{}`, often allocating on the heap |
| **Escape analysis** | The compiler's decision whether a value lives on stack or heap |
| **Inlining** | Replacing a function call with the body — eliminates call overhead |
| **Devirtualization** | Replacing an indirect call with a direct one when the type is known |
| **Stencil** | The shared body the compiler emits for one GC shape |
| **`go.shape.int`** | The mangled symbol you see in `pprof` for an int-shape stencil |
| **`ns/op`** | Nanoseconds per benchmark operation — the standard Go benchmark metric |

---

## Core Concepts

### 1. Generics are not "free at runtime"

In C++, `std::max<int>` and `std::max<float>` produce two completely separate machine-code copies. Each copy is fully optimized for its type. The cost is binary size; the benefit is zero runtime overhead.

Go does **not** do this. Instead, Go compiles **one body per GC shape** and passes a runtime **dictionary** with the type-specific bits. This keeps binaries small but adds an indirection on operations that depend on the concrete type.

```
C++: max<int>     ──► fully specialised body, no dispatch
     max<float>   ──► fully specialised body, no dispatch

Go:  Max[int]     ──► shared body for 8-byte scalars + dict_int
     Max[int64]   ──► same shared body + dict_int64
     Max[*Foo]    ──► shared body for pointer-shape + dict_*Foo
```

### 2. The three things that affect generic performance

For a junior, these three knobs explain 90% of what you will see:

1. **The GC shape of `T`.** Numeric types are usually fast. Pointer-shaped types (struct with pointers, `*T`, `string`, slice header) share one body, with dictionary indirection.
2. **What you do inside the body.** Pure arithmetic on `T` inlines well. Calls to constraint operations (`==`, `<`) sometimes go through the dictionary.
3. **Escape analysis.** Generic code occasionally forces a value to escape to the heap when the same body would not.

### 3. Generics vs `interface{}` — generics almost always win

```go
// interface{} version — every value is BOXED
func ContainsAny(s []any, target any) bool {
    for _, v := range s { if v == target { return true } }
    return false
}

// generic version — no boxing
func Contains[T comparable](s []T, target T) bool {
    for _, v := range s { if v == target { return true } }
    return false
}
```

For a slice of one million `int` values:

| Version | ns/op | allocs/op |
|---------|-------|-----------|
| `Contains[int]` | ~1,200,000 | 0 |
| `ContainsAny` (input pre-boxed) | ~5,500,000 | 0 |
| `ContainsAny` (must box on call) | ~25,000,000 | 1,000,001 |

Three numbers, one lesson: **boxing into `interface{}` is far more expensive than the dictionary cost generics introduce.**

### 4. Generics vs hand-written — usually a tie, sometimes a tax

For a single concrete type used everywhere:

| Version | ns/op |
|---------|-------|
| Hand-written `func Sum(s []int) int` | 280 |
| Generic `Sum[int]` | 285 |

For diverse pointer-shaped instantiations of the same generic in one binary:

| Version | ns/op |
|---------|-------|
| Hand-written `func Find(s []MyStruct, t MyStruct) int` | 12 |
| Generic `Find[MyStruct]` | 18 |

The 50% slowdown looks scary in relative terms but is a few nanoseconds in absolute. Only matters in extremely hot loops.

### 5. Why this is a deliberate design choice

The Go team valued **small binaries**, **fast compile times**, and **language simplicity** over absolute peak performance. C++ templates were rejected partly because of binary bloat. Java erasure was rejected because of boxing. GC shape stenciling is the middle ground.

---

## Real-World Analogies

**Analogy 1 — One kitchen, many recipes**

Imagine a restaurant where the chef writes one general recipe ("cook protein for X minutes"). For chicken, beef, or fish, the chef looks up "X" in a small notecard (the dictionary). The recipe is shared; the notecard differs per protein. That is GC shape stenciling.

By contrast, C++ monomorphization is like having a fully separate kitchen for chicken, another for beef, and a third for fish.

**Analogy 2 — A multi-tool**

`interface{}` is a Swiss-army knife — flexible but every operation requires unfolding and locking the right blade. Generics are a fixed-blade chef's knife sharpened for a specific use. You sacrifice flexibility for speed.

**Analogy 3 — Postal forms**

Posting a letter without a postcode is `interface{}` — the post office reads the address at runtime and decides where to send it. With a postcode, the route is decided at compile time. Generics are the postcode.

**Analogy 4 — Train timetable**

A generic body is a single train timetable that lists abstract platforms. Each station hands the train a small card (the dictionary) telling it which physical platform to use. The schedule is shared; the card differs per station.

---

## Mental Models

### Model 1 — "One body per shape, one dictionary per type"

Whenever you write a generic, picture the compiler asking two questions:
1. What is the GC shape? → that picks the body.
2. Which concrete type? → that picks the dictionary.

If your call site uses one concrete type, expect performance close to hand-written. If it uses many distinct types of the same shape, expect dictionary indirection.

### Model 2 — "Boxing is the real enemy"

The dictionary call is a few nanoseconds. Boxing into `interface{}` is a heap allocation — hundreds of nanoseconds plus GC pressure. Whenever a generic replaces an `interface{}` API, you are deleting allocations. That is almost always a win.

### Model 3 — "Inlining is the friend"

When a generic body inlines into the call site, the dictionary disappears. Numeric types and small functions inline aggressively. Large bodies and pointer-shape generics often do not.

### Model 4 — "Benchmark before believing"

Performance intuition is wrong about half the time. Always write a `Benchmark*` function before claiming a generic version is faster or slower.

---

## Pros & Cons

### Pros (performance-related)

| Benefit | Why it matters |
|---------|----------------|
| **No boxing** | Big savings vs `interface{}` |
| **Inlines on hot paths** | Numeric loops match hand-written |
| **No type assertions** | Removes a branch per element |
| **Stdlib uses generics** | `slices.Sort` outperforms `sort.Slice` |

### Cons (performance-related)

| Drawback | Why it matters |
|----------|----------------|
| **Dictionary indirection** | Pointer-shape generics pay a small tax |
| **Escape analysis surprises** | Some generic code allocates more than a non-generic equivalent |
| **Larger binary per shape** | Each new shape adds a stencil |
| **Slower compile times** | Each instantiation is extra work |

---

## Use Cases

Generics are a clear performance win in:

1. **Replacing `interface{}` containers** — caches, queues, sets
2. **Stdlib-style helpers** — `slices.Sort`, `slices.Index`, `maps.Keys`
3. **Numeric kernels** — `Sum`, `Min`, `Max`, dot products
4. **Type-safe atomic / pool wrappers** — `atomic.Pointer[T]`

Generics give a small, sometimes negative, performance impact in:

1. **Tight hot loops with many distinct pointer-shaped types**
2. **Code that escapes to heap because the generic body cannot prove safety**
3. **Highly templated code that bloats the binary**

---

## Code Examples

### Example 1 — Three implementations side by side

```go
package mymath

import "cmp"

// Generic
func MinG[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}

// Interface — the pre-1.18 way
func MinI(a, b any) any {
    if a.(int) < b.(int) { return a }
    return b
}

// Concrete
func MinC(a, b int) int {
    if a < b { return a }
    return b
}
```

### Example 2 — A simple benchmark

```go
package mymath

import "testing"

func BenchmarkMinGen(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = MinG(3, 5)
    }
}
func BenchmarkMinIface(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = MinI(3, 5)
    }
}
func BenchmarkMinConc(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = MinC(3, 5)
    }
}
```

Run with:

```
go test -bench=. -benchmem
```

Typical numbers on a modern laptop:

```
BenchmarkMinGen-8     1,000,000,000   0.30 ns/op   0 B/op   0 allocs/op
BenchmarkMinIface-8     200,000,000   8.20 ns/op  16 B/op   1 allocs/op
BenchmarkMinConc-8    1,000,000,000   0.30 ns/op   0 B/op   0 allocs/op
```

The generic version matches the concrete version. The interface version is **27× slower** and allocates.

### Example 3 — Sum over one million ints

```go
func SumGen[T int | float64](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}

func SumIface(s []any) int {
    total := 0
    for _, v := range s { total += v.(int) }
    return total
}

func SumConc(s []int) int {
    total := 0
    for _, v := range s { total += v }
    return total
}
```

Benchmarks (slice of one million ints):

| Version | ns/op |
|---------|-------|
| `SumConc` | 280,000 |
| `SumGen[int]` | 285,000 |
| `SumIface` | 4,200,000 |

### Example 4 — `slices.Sort` vs `sort.Slice`

```go
// pre-1.18 style
sort.Slice(data, func(i, j int) bool { return data[i] < data[j] })

// post-1.21 style
slices.Sort(data)
```

For 10,000 ints:

| Version | ns/op |
|---------|-------|
| `sort.Slice` | 380,000 |
| `slices.Sort` | 230,000 |

The generic `slices.Sort` is **~40% faster** because the comparator is inlined into the sort body — no interface dispatch per comparison.

### Example 5 — A simple escape-analysis check

```go
func IdGen[T any](v T) T { return v }
func IdConc(v int) int   { return v }
```

Compile with `-gcflags="-m"`:

```
$ go build -gcflags="-m" .
./id.go:3:18: leaking param: v to result ~r0 level=0
./id.go:4:18: leaking param: v to result ~r0 level=0
```

Both look identical. But for some generic bodies the compiler refuses to inline and the escape decision differs — covered in `middle.md`.

---

## Coding Patterns

### Pattern 1 — Prefer `slices`, `maps`, `cmp` first

If a stdlib helper exists, use it. The Go team has aggressively optimised these.

### Pattern 2 — Benchmark before specializing

Write the generic version. Benchmark. Specialise only if numbers demand it.

### Pattern 3 — Concrete type wrapper for hot paths

```go
// Generic helper everywhere
func Sum[T int | float64](s []T) T { ... }

// Hot path, fixed type
func sumIntsHot(s []int) int { return Sum(s) }
```

The compiler often inlines `Sum` into `sumIntsHot`, giving you both ergonomics and speed.

### Pattern 4 — Avoid generic-shaped fields in performance-critical structs

```go
type Hot[T any] struct { v T } // every method goes through dict
type HotInt struct  { v int }  // every method is direct
```

If `T` never varies in practice, drop the type parameter.

---

## Clean Code

- Name your benchmarks `BenchmarkX` so `go test -bench=.` finds them.
- Use `b.ReportAllocs()` so allocations are visible.
- Keep benchmarks small and reproducible. Pin the input size.
- Compare three versions: generic, interface, concrete.

```go
func BenchmarkContainsGen(b *testing.B) {
    s := makeInts(1000)
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = Contains(s, 999)
    }
}
```

---

## Product Use / Feature

Real product wins from understanding generic performance:

1. **In-memory cache** — `Cache[K comparable, V any]` removes assertions and shrinks p99 latency.
2. **JSON pipeline** — a generic `Decode[T]` allocates once vs N times for the `interface{}` version.
3. **Metric counters** — `Counter[L Labels]` keeps the hot path lock-free.
4. **Event buses** — generic publish/subscribe avoids per-event boxing.

A modest generic refactor of a high-traffic service often reclaims 5-15% of CPU previously burned on boxing and assertions.

---

## Error Handling

Performance work and error handling intersect in two places:

1. **Benchmarks must surface errors.** Always check returned errors inside `Benchmark*`. A silently failing benchmark is worse than no benchmark.
2. **A generic `Result[T]` is not free.** It still allocates the wrapper. For hot paths, plain `(T, error)` is usually cheaper.

```go
func Try[T any](f func() (T, error)) (T, error) { return f() }
```

The above adds zero overhead — the compiler inlines it. A `Result[T]` struct return may also inline but doubles the size of the return value.

---

## Security Considerations

Performance optimization can erode security guarantees if pursued blindly:

1. **Do not skip bounds checks** to make generics faster — the compiler already eliminates them when it can prove safety.
2. **Beware `unsafe.Pointer` tricks** to bypass the dictionary. They are rarely correct.
3. **A generic API that boxes `T` into `any` internally** can leak data across types if you forget to validate.

---

## Performance Tips

- Pick numeric types when possible — they are the fastest GC shape.
- Replace `interface{}`-based code with generics; it is almost always faster.
- Use `go test -bench=. -benchmem` to spot allocations.
- Look for `[go.shape.X]` suffixes in `pprof` to identify hot stencils.
- For tight loops, use a non-generic wrapper around a generic core.

---

## Best Practices

1. **Generic by default, specialise on evidence.**
2. **Use `slices`, `maps`, `cmp` before writing your own.**
3. **Always benchmark with `-benchmem`.**
4. **Pin your Go version** — generic perf improves every release.
5. **Read `pprof` flame graphs** for stencil names.
6. **Keep type-parameter sets small** — fewer shapes, smaller binaries.
7. **Run `-gcflags="-m"`** to confirm inlining decisions.
8. **Compare apples to apples** — never benchmark a generic with extra logging vs a concrete one without.

---

## Edge Cases & Pitfalls

### 1. The `any` constraint disables many optimizations

Bodies with `[T any]` cannot use `==`, `<`, or built-ins. The compiler also treats `T` as an opaque shape. Performance can suffer.

### 2. Pointer-shape generics share one body

If your program instantiates `Find` over five distinct struct types containing pointers, all five share **one** stencil. Inside, comparisons go through dictionaries. Hand-rolling each one can be measurably faster.

### 3. The first call may be slower

The first call to a generic function might involve loading the dictionary. After that, the cost is amortized.

### 4. Escape to heap

Generic code occasionally promotes a value to the heap that an equivalent non-generic body keeps on the stack.

### 5. Inlining is brittle

Adding a `defer` or `recover` to a generic body usually disables inlining. The dictionary cost then becomes visible.

---

## Common Mistakes

1. **Assuming generics always make code faster.** Sometimes they do not. Benchmark.
2. **Replacing `sort.Slice` blindly.** It is usually faster, but for tiny slices the overhead may dominate.
3. **Forgetting `-benchmem`** and missing allocations.
4. **Comparing benchmarks across machines** without consistent CPU governor / thermal state.
5. **Optimising before measuring.** Profiling should always precede tuning.
6. **Believing online posts that quote Go 1.18 numbers.** Performance has improved substantially since.

---

## Common Misconceptions

- **"Go monomorphizes generics."** No — it stencils per shape and uses a runtime dictionary.
- **"Generics are always free."** False. They are usually cheap, sometimes not.
- **"`any` and `interface{}` differ in performance."** They are aliases — identical at runtime.
- **"Generics avoid all allocations."** They avoid boxing; they do not avoid `make` or `append` allocations.
- **"`slices.Sort` is slower than `sort.Slice`."** Wrong; it is faster on most workloads.

---

## Tricky Points

1. **`comparable` constraint cost.** Equality on `T comparable` may use the dictionary; equality on a fixed `int` is a CPU instruction.
2. **`pprof` shows stencil names.** `pkg.Find[go.shape.*pkg.Foo]` is normal — not a bug.
3. **`go.shape.int_0`** — the trailing index is the parameter position; rarely matters.
4. **Generic methods on a hot struct** can disable inlining of the surrounding code.
5. **Build cache invalidation** — touching one generic helper rebuilds every package that instantiates it.

---

## Test

1. Does Go monomorphize generics like C++? (yes/no)
2. What is GC shape stenciling?
3. Is a generic function usually faster than the same `interface{}` version? (yes/no)
4. What does `-benchmem` show?
5. What stencil suffix appears in `pprof`?
6. Is `slices.Sort` faster than `sort.Slice` for typical inputs? (yes/no)
7. Where can a generic value escape that a concrete one would not?
8. Which constraint is "free" for arithmetic loops?
9. What flag shows compiler inlining decisions?
10. Why do pointer-shaped generics share a single stencil?

(Answers: 1) no; 2) one body per memory layout plus a per-type dictionary; 3) yes; 4) bytes and allocations per op; 5) `[go.shape.X]`; 6) yes; 7) heap, when the body cannot prove stack safety; 8) numeric like `int | float64`; 9) `-gcflags="-m"`; 10) Go groups types by GC layout to keep binary small.)

---

## Tricky Questions

**Q1.** Why is `Sum[int]` essentially as fast as `Sum(s []int) int`?
**A.** Because `int` has a unique GC shape and the body inlines, leaving no dictionary call.

**Q2.** Why is `Find[Point]` slower than a hand-written `findPoint`?
**A.** When `Point` is pointer-shaped and shares the stencil with other types, equality goes through the dictionary.

**Q3.** Why do allocations matter so much in benchmarks?
**A.** Each allocation pressures the GC; the cost compounds across millions of calls.

**Q4.** Why is `interface{}` so slow?
**A.** Boxing forces a heap allocation; type assertions and v-table calls add per-iteration cost.

**Q5.** Will the compiler ever inline a generic body?
**A.** Yes — for small bodies and well-known types. Hot paths often inline.

---

## Cheat Sheet

```go
// Numeric: free
func Sum[T int | float64](s []T) T { ... }

// Pointer-shape: dictionary cost
func Find[T comparable](s []T, t T) int { ... }

// Hot wrapper for a hot type
func sumIntsHot(s []int) int { return Sum(s) }
```

| Tool | What you learn |
|------|----------------|
| `go test -bench=.` | ns/op, allocs/op |
| `-benchmem` | bytes per op |
| `go build -gcflags=-m` | escape and inlining decisions |
| `go tool pprof` | which stencils dominate |

---

## Self-Assessment Checklist

- [ ] I can explain why Go does not monomorphize generics.
- [ ] I can read `BenchmarkX` output and spot allocations.
- [ ] I know `slices.Sort` is usually faster than `sort.Slice`.
- [ ] I understand "GC shape" at a high level.
- [ ] I can predict whether a generic call will allocate.
- [ ] I have benchmarked a generic vs interface version myself.
- [ ] I know how to drop generics on hot paths if needed.

---

## Summary

Generics in Go are **not free** at runtime, but they are **almost always faster** than the `interface{}` code they replace. The implementation strategy — GC shape stenciling with dictionary passing — keeps binaries small and compile times reasonable. The cost is a small dictionary indirection on operations that depend on the concrete type.

For numeric loops, generics match hand-written speed. For pointer-shaped containers used with many distinct types, expect a few-nanosecond dictionary tax. For everything else, measure before optimising.

The big mental shift is: **stop comparing generics to C++ templates**. The right comparison is `interface{}` — and that comparison is a landslide in favour of generics.

---

## What You Can Build

After this section you can build:

1. A reproducible **benchmark suite** that shows generic vs interface vs concrete cost.
2. A **micro-benchmark harness** for your own data structures.
3. A small **wrapper layer** that exposes generics on top of an `interface{}` API.
4. **CI checks** that fail if a generic helper regresses by more than X%.

---

## Further Reading

- [The Go 1.18 implementation notes](https://go.dev/doc/go1.18)
- [Generics implementation — GC Shape Stenciling design doc](https://go.googlesource.com/proposal/+/refs/heads/master/design/generics-implementation-gcshape.md)
- [Generics implementation — Dictionaries design doc](https://go.googlesource.com/proposal/+/refs/heads/master/design/generics-implementation-dictionaries.md)
- [The cost of Go generics — community benchmarks](https://planetscale.com/blog/generics-can-make-your-go-code-slower)
- [`pprof` documentation](https://pkg.go.dev/net/http/pprof)
- [`testing` package — benchmarks](https://pkg.go.dev/testing#hdr-Benchmarks)

---

## Related Topics

- **4.1 Why Generics?** — motivation and design history
- **4.2 Generic Functions** — the syntax basics
- **4.6 Generic Constraints Deep** — what constraints unlock
- **4.8 Generics vs Interfaces** — when to choose which
- **12.2 Escape Analysis** — general escape, not specific to generics
- **13 Performance Engineering** — general profiling toolkit

---

## Diagrams & Visual Aids

### The three-way comparison

```
Performance: concrete  ≈  generic   ≪   interface{}

  concrete:   |█|
  generic:    |█|
  interface:  |████████████████████|
```

### Stencil + dictionary

```
            +-----------------+
Source:     | F[T comparable] |
            +-----------------+
                   │
                   ▼
        ┌──────────────────┐
Compile │ stencil per      │
        │ GC shape         │
        └──────────────────┘
                   │
                   ▼
        ┌──────────────────┐  per concrete T
Runtime │ shared body  ─┐  │
        │               ▼  │
        │           dict_T │
        └──────────────────┘
```

### What pprof shows

```
mypkg.Find[go.shape.*mypkg.Point]    ← stencil for pointer shape
mypkg.Find[go.shape.int_0]           ← stencil for int
mypkg.Find[go.shape.string]          ← stencil for string-shape
```
