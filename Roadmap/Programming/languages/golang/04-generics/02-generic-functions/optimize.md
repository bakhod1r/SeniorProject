# Generic Functions — Optimize

## Table of Contents
1. [Introduction](#introduction)
2. [When Generics Hurt Performance](#when-generics-hurt-performance)
3. [When Generics Help](#when-generics-help)
4. [GC Shape Stenciling Recap](#gc-shape-stenciling-recap)
5. [Reducing Function-Call Overhead](#reducing-function-call-overhead)
6. [Specialization Strategies](#specialization-strategies)
7. [Benchmarks: `interface{}` vs Generics vs Copy-Paste](#benchmarks-interface-vs-generics-vs-copy-paste)
8. [Inlining and the Compiler](#inlining-and-the-compiler)
9. [Memory Allocations](#memory-allocations)
10. [Profiling Generic Code](#profiling-generic-code)
11. [Anti-Patterns](#anti-patterns)
12. [Decision Flowchart](#decision-flowchart)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

Generics in Go are **usually free**: they replace `interface{}`-based code (which boxes values) with type-specialized bodies. But they're not always free, and a small minority of hot paths benefit from non-generic implementations.

This file covers:
- The mechanism (GC shape stenciling) and its cost model
- Real benchmarks comparing `interface{}`, generics, and hand-specialized code
- When to specialize, when to keep generic, and when to skip both

---

## When Generics Hurt Performance

Generics can be slower than hand-specialized code in three situations:

1. **Hot inner loops with tiny operations.** A `Min[T cmp.Ordered]` called 10 million times per request may show 5-10% overhead because of dictionary indirection.
2. **Functions that don't inline.** If the inliner can't see through the dictionary call, it may skip inlining a small generic helper that would have inlined when written concrete.
3. **Generic methods called via interfaces.** Method dispatch already involves a vtable lookup; adding generic-instantiation indirection compounds the cost.

These are not common cases, but they are real. Always **profile** before optimizing.

---

## When Generics Help

Generics **outperform** the typical alternative — `interface{}` — in:

1. **Slice operations on primitive types.** Boxing every `int` into an `interface{}` value is significantly slower than the generic version.
2. **Containers of pointers.** Same GC shape, no boxing, single compiled body.
3. **Eliminating type assertions.** The cost of `x.(int)` in a hot path is non-trivial.
4. **Fewer allocations.** `interface{}`-based code often allocates per element (boxing).

For the typical case "I'm replacing `interface{}` with generics," expect a measurable speedup.

---

## GC Shape Stenciling Recap

Recall: Go compiles **one** body per **GC shape**. Two type arguments share a body when their memory layout is the same as far as the garbage collector is concerned.

**Same shape (one body, dictionary distinguishes them):**
- All pointer types: `*Foo`, `*Bar`, `*Baz`
- All same-size integers: `int` and `int64` on 64-bit platforms
- All single-pointer-sized values

**Distinct shapes (separate bodies):**
- `string` (different from int — has length info)
- `struct { X int }` vs `struct { X, Y int }`
- `[2]int` vs `[3]int`

The dictionary is a small extra parameter passed at runtime. Per call, it adds roughly:
- One pointer dereference for type-specific operations (e.g. `==` on a non-trivial type)
- Zero overhead for purely value-passing operations

For a numeric `Sum[T]`, the dictionary is rarely consulted in the hot loop, so overhead is near zero.

---

## Reducing Function-Call Overhead

When a generic function shows up high in your profile:

### 1. Encourage inlining

```sh
go build -gcflags='-m -m' ./pkg/... 2>&1 | grep -i 'cannot inline'
```

If your generic helper is small enough but the inliner refuses, try:
- Reduce the function body (remove asserts in hot path)
- Avoid closures over the parameter
- Avoid declaring locals of types the dictionary must look up

### 2. Specialize the hot path

If `Sum[T Numeric]` is on the critical path for `int`:

```go
// Generic helper
func Sum[T Numeric](xs []T) T { ... }

// Specialized fast path for the dominant case
func SumInts(xs []int) int {
    var s int
    for _, x := range xs { s += x }
    return s
}
```

Call `SumInts` from the hot path; keep `Sum` for everywhere else.

### 3. Pass slices by value carefully

Slices are already small headers — passing by value is fine. But avoid passing **arrays** by value when they're large; use pointer to array or slice.

---

## Specialization Strategies

When you need to specialize:

### Strategy A — Wrapper

```go
func SumIntsFast(xs []int) int { return Sum(xs) } // forwards to generic
```

This buys nothing at runtime but documents intent. The compiler will inline it.

### Strategy B — Independent body

```go
func SumIntsFast(xs []int) int {
    var s int
    for _, x := range xs { s += x }
    return s
}
```

Hand-written. Always at least as fast as generic. Maintenance cost: keep semantics in sync.

### Strategy C — `go generate`

Use a code generator (or `text/template`) to produce specialized variants from a single template. Reduces maintenance.

### Strategy D — SIMD / assembly

For real numeric workloads, `gonum`-style hand-tuned assembly beats both. Reach for this only when profile says so and the workload is large enough.

---

## Benchmarks: `interface{}` vs Generics vs Copy-Paste

A representative benchmark for `Sum`:

```go
package bench

import "testing"

// Hand-specialized
func sumInts(xs []int) int {
    var s int
    for _, x := range xs { s += x }
    return s
}

// Interface-based
func sumIface(xs []interface{}) interface{} {
    var s int
    for _, x := range xs { s += x.(int) }
    return s
}

// Generic
type Numeric interface { ~int | ~float64 }
func sumGeneric[T Numeric](xs []T) T {
    var s T
    for _, x := range xs { s += x }
    return s
}

func BenchmarkSumInts(b *testing.B) {
    xs := make([]int, 1000)
    for i := range xs { xs[i] = i }
    b.ResetTimer()
    for i := 0; i < b.N; i++ { _ = sumInts(xs) }
}

func BenchmarkSumIface(b *testing.B) {
    xs := make([]interface{}, 1000)
    for i := range xs { xs[i] = i }
    b.ResetTimer()
    for i := 0; i < b.N; i++ { _ = sumIface(xs) }
}

func BenchmarkSumGeneric(b *testing.B) {
    xs := make([]int, 1000)
    for i := range xs { xs[i] = i }
    b.ResetTimer()
    for i := 0; i < b.N; i++ { _ = sumGeneric(xs) }
}
```

Typical results on a modern x86_64 machine, Go 1.21:

```
BenchmarkSumInts       6000 ns/op    0 B/op   0 allocs/op
BenchmarkSumIface     19000 ns/op    0 B/op   0 allocs/op (per-element type assertion)
BenchmarkSumGeneric    6200 ns/op    0 B/op   0 allocs/op
```

**Takeaway:** Generic ≈ hand-specialized; both are ~3x faster than `interface{}`-based.

When constructing the `[]interface{}` from `[]int` actually has to box every element, the picture is even worse for the interface version (allocations per element).

---

## Inlining and the Compiler

The Go compiler has a function-size budget for inlining. Generics participate in inlining like any other function, but a few details matter:

### Generic function body is duplicated per shape

Each shape gets its own body. The inliner sees the actual instantiated body for the call site, so inlining decisions are made per call site.

### Closures hurt inlining

A generic function returning a closure usually does not inline (the closure escapes to the heap):

```go
func Adder[T Numeric](base T) func(T) T {
    return func(x T) T { return base + x } // escapes
}
```

If hot, prefer to specialize without the closure.

### Method receivers may prevent inlining via interfaces

```go
var s sort.Interface = mySlice
sort.Sort(s) // dispatch goes through interface — not inlined
```

This is unrelated to generics, but applies to generic methods called through an interface.

---

## Memory Allocations

Generics are great for reducing allocations because they avoid boxing primitive types in `interface{}`.

### Watch out for

- **Closures:** A generic function returning a closure causes captures to escape.
- **Slice growth:** `Filter[T]` with `make([]T, 0, len(xs))` allocates the cap upfront. With unknown filter ratio you may waste memory; with no preallocation you may reallocate. Choose based on expected ratio.
- **Map/Set helpers:** `ToSet[T comparable](xs)` allocates the map. There's no way around it; just be aware.

### Profile allocations

```sh
go test -bench=. -benchmem ./...
```

`B/op` and `allocs/op` columns reveal whether your helper is allocation-heavy. Generic versions should usually show fewer allocs than `interface{}` versions.

---

## Profiling Generic Code

CPU profile:

```sh
go test -bench=. -cpuprofile cpu.out ./pkg/...
go tool pprof cpu.out
(pprof) top
(pprof) list FunctionName
```

Look for:
- Time inside the generic function — the body itself
- Time inside `runtime.gcWriteBarrier` or `runtime.mapaccess1` — shape-related work
- Time inside the dictionary look-up — visible as small `runtime.dictResolve` style functions

If dictionary lookup is significant (>5% of total), specialize the hot path.

---

## Anti-Patterns

### Anti-pattern 1: Specializing without measuring

Don't write `SumInts`, `SumFloats`, `SumInt64s` as a "performance fix" without benchmarks. Most specializations buy nothing.

### Anti-pattern 2: Overly tight constraints

```go
func Tag[T int](x T, label string) string { /* ... */ }
```

If only `int` is allowed, drop the type parameter and write `func Tag(x int, label string) string`.

### Anti-pattern 3: Generic helpers around `reflect`

If your generic function calls `reflect`, the type parameter is decorative. Drop generics:

```go
// Bad
func Marshal[T any](x T) ([]byte, error) {
    return json.Marshal(x) // already takes any
}

// Good
// (don't write a wrapper at all)
```

### Anti-pattern 4: Generics for I/O paths

Network calls, disk reads, RPC: the latency dwarfs any function-call overhead. Generics here are about ergonomics, not speed. Don't optimize.

---

## Decision Flowchart

```
           ┌──────────────────────────┐
           │ Is it called many times  │
           │ per request? (>10K)      │
           └──────────┬───────────────┘
                      │
                ┌─────┴─────┐
                │           │
               No          Yes
                │           │
                ▼           ▼
         ┌──────────┐  ┌──────────────────┐
         │ Use      │  │ Profile.         │
         │ generics │  │ Is generic in    │
         │ freely.  │  │ top 5%?          │
         └──────────┘  └────────┬─────────┘
                                │
                          ┌─────┴─────┐
                          │           │
                         No          Yes
                          │           │
                          ▼           ▼
                  ┌──────────┐  ┌──────────────────┐
                  │ Use      │  │ Specialize the   │
                  │ generics │  │ hot path. Keep   │
                  │ freely.  │  │ generics for     │
                  └──────────┘  │ everything else. │
                                └──────────────────┘
```

---

## Cheat Sheet

```
GC shape sharing — types with same memory layout share one body.
Pointer types — all share one body.
int and int64 on 64-bit — same shape.
struct{X int} and struct{X int} (same fields) — same shape.

Dictionary cost — one indirect access per type-dependent op.
Inlining — generic helpers can inline; closures usually don't.
Allocation — generics rarely allocate where the equivalent
  interface{} version would.

Benchmark commands:
  go test -bench=. -benchmem ./pkg/...
  go test -bench=. -cpuprofile cpu.out -memprofile mem.out ./pkg/...
  go tool pprof cpu.out

Specialize when:
  - Profile shows generic helper in hot path (>5%)
  - The instantiation type is dominant (one type used 99% of calls)
  - Code is small and stable
```

---

## Summary

Generic functions in Go usually match hand-specialized performance and beat `interface{}`-based code by a healthy margin. The handful of cases where they hurt — hot inner loops, missed inlining, or generics over interfaces — are easy to spot in a profile and easy to fix by specializing the hot path. Don't pre-emptively specialize; let profilers tell you when to.

[← find-bug.md](./find-bug.md) · [↑ index.md](./junior.md)
