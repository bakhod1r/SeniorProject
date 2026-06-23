# Generic Types & Interfaces — Optimization

This file is about the *cost* of generic types and methods in Go, and how to measure and reduce it. We cover monomorphization vs dictionary passing (GC stenciling), memory layout, allocation behavior, and when a non-generic interface is the better choice.

## Table of Contents
1. [How the Go compiler implements generics](#how-the-go-compiler-implements-generics)
2. [Monomorphization vs GC stenciling](#monomorphization-vs-gc-stenciling)
3. [Dictionary passing](#dictionary-passing)
4. [Cost categories](#cost-categories)
5. [Memory layout of instantiated types](#memory-layout-of-instantiated-types)
6. [Allocations and escape analysis](#allocations-and-escape-analysis)
7. [Inlining of generic methods](#inlining-of-generic-methods)
8. [When to use a non-generic interface instead](#when-to-use-a-non-generic-interface-instead)
9. [Benchmarking generic code](#benchmarking-generic-code)
10. [Common micro-optimizations](#common-micro-optimizations)
11. [Compile time and binary size](#compile-time-and-binary-size)
12. [Decision rules](#decision-rules)
13. [Summary](#summary)

---

## How the Go compiler implements generics

Three high-level options exist for implementing generics:

1. **Full monomorphization** — emit a separate compiled body per concrete type. Maximum performance, but blows up binary size.
2. **Pure dictionary passing** — emit one compiled body for all types; pass a "dictionary" of operations. Smallest binary, slower at runtime.
3. **Hybrid (GC stenciling + dictionaries)** — group types by their *gcshape*, emit one body per shape, pass dictionaries for per-instantiation differences.

Go (since 1.18) uses option 3. This means:

- For each shape (e.g., "pointer-shaped types", "int-shaped types", "[]byte-shaped types") the compiler emits **one** function body.
- A *dictionary* — a small struct of type metadata — is passed implicitly to each generic function call. It holds runtime info needed for operations like `==`, allocation, type conversion, and reflection.

The result: most of the speed of monomorphization, most of the compactness of pure dictionary passing.

---

## Monomorphization vs GC stenciling

### What "shape" means

A *gcshape* groups types by:

- Memory size (e.g., 8 bytes, 16 bytes).
- GC properties (does the value contain pointers? where?).
- Alignment.

Two types with the same shape can use the same compiled body — the compiler does not need to look at the type, only at the layout.

### Concrete examples

| Type set | Same shape? |
|----------|-------------|
| `int32`, `uint32` | Yes — 4-byte non-pointer scalars |
| `int64`, `uint64`, `float64` | Yes — 8-byte non-pointer scalars |
| `*User`, `*Order`, `*Item` | Yes — all pointers (8 bytes, GC pointer) |
| `[]byte`, `[]int`, `[]string` | Slightly different — slice header is identical, but element shape may differ |
| `User`, `Order` (different structs) | Almost certainly different shapes |

### Practical consequence

- A `Stack[*User]` and `Stack[*Order]` share one compiled body.
- A `Stack[int]` and `Stack[*User]` use different bodies.

This is mostly invisible. You see it only when you read the disassembly or look at binary growth metrics.

---

## Dictionary passing

The dictionary contains:

- A `*runtime._type` for the type parameter (so equality, allocation, and type assertions work).
- Pointers to specialized helper functions (e.g., a `==` implementation for the parameter type).
- Sub-dictionaries for type parameters that themselves have type parameters.

The dictionary is passed as an extra argument by the caller. Its lookup adds a small but real cost — typically a few nanoseconds per generic call.

### Example — what gets specialized

```go
type Set[T comparable] struct { m map[T]struct{} }

func (s *Set[T]) Add(v T) { s.m[v] = struct{}{} }
```

For `Set[int]`:
- The compiled body uses int hashing (specialized).
For `Set[*User]`:
- The body uses pointer hashing (specialized via dictionary).

The hash operation is one of the things the dictionary parameterizes.

---

## Cost categories

Where do generic methods/types pay their costs?

| Cost | Magnitude | When |
|------|-----------|------|
| Dictionary load | ~1 ns | every generic call |
| Hash/equal via dictionary | ~few ns | map ops, set ops |
| Boxing avoidance | NEGATIVE cost (savings) | replacing `interface{}` |
| Larger binary | hundreds of KB | many distinct shapes |
| Slower compile | tens of % | heavy use of generics |
| Less aggressive inlining | varies | generic call across pkg |
| Cache-friendliness | varies | complex generics over big structs |

The savings are often larger than the costs — especially compared to `interface{}` baselines.

---

## Memory layout of instantiated types

`Stack[int]` and `Stack[string]` have **different** memory layouts because their element types differ.

```go
type Stack[T any] struct {
    items []T
}
```

- `Stack[int]`: items is `[]int` — slice header (24 bytes) pointing to `int` elements (8 bytes each on 64-bit).
- `Stack[string]`: items is `[]string` — slice header (24 bytes) pointing to `string` headers (16 bytes each: ptr + len).
- `Stack[*User]`: items is `[]*User` — slice header pointing to pointers (8 bytes each).

The compiler lays out fields exactly as if you had hand-written the struct.

### Cache behavior

For value types of small size, generic code is at least as cache-friendly as hand-written, often more so (no boxing, contiguous storage). For pointer types, it depends on what the pointers chase to.

For very large `T` (huge structs), prefer `*T`:

```go
type Cache[K comparable, V any] struct { m map[K]V }
// avoid: Cache[string, BigStruct]
// prefer: Cache[string, *BigStruct]
```

Otherwise, every `Get` and `Set` copies a big value.

---

## Allocations and escape analysis

Generics do not change the rules of escape analysis, but they do interact with it.

### Pattern 1 — local generic value, no escape

```go
func Sum[T Numeric](xs []T) T {
    var s T
    for _, x := range xs { s += x }
    return s
}
```

`s` lives on the stack. No allocation.

### Pattern 2 — generic struct returned by pointer

```go
func NewStack[T any]() *Stack[T] { return &Stack[T]{items: nil} }
```

`Stack[T]{}` escapes through the return — heap allocation. Same as the non-generic case.

### Pattern 3 — boxing into a generic interface

```go
type Pusher[T any] interface { Push(T) }

func Use(p Pusher[int]) { p.Push(42) }
```

Calling `Use(stack)` boxes `stack` into the interface header — the same cost as a non-generic interface call.

### Detecting escapes

```
go build -gcflags='-m' ./...
```

Read the output. Generic code shows up the same way as non-generic code in escape analysis output.

---

## Inlining of generic methods

The Go compiler can inline generic methods, but with some caveats:

- If the call site has all type parameters fixed (statically known), inlining is comparable to non-generic.
- Cross-package calls with unknown gcshape may not inline.
- Larger generic bodies are less likely to inline.

To check inlining decisions:

```
go build -gcflags='-m=2' ./...
```

For hot paths, structure the function to fit within the inliner's budget (default 80 nodes-ish).

---

## When to use a non-generic interface instead

Generics are not always the right answer. Choose a non-generic interface when:

1. **Heterogeneity matters.** A `[]Shape` mixing circles and squares cannot be `[]Circle` or `[]Square`. Generics enforce homogeneity.

2. **Open extension.** External users will plug in new implementations you do not know. Generic types lock you into a specific `T`; an interface lets anyone implement.

3. **Plugin-style architecture.** Decoupling at runtime via dynamic dispatch.

4. **Reflection-heavy code.** When the code already uses `reflect`, generics add ceremony without benefits.

5. **Simple cases where the boxing cost is irrelevant.** A handful of calls per request, with values already on the heap, gain nothing from generics.

6. **You want a stable, narrow API surface.** A non-generic interface is easier to evolve.

In short: **generics for "container of T" or "operation on T"; interfaces for "any of these things"**.

---

## Benchmarking generic code

Set up a fair benchmark:

```go
func BenchmarkSetGeneric(b *testing.B) {
    s := NewSet[int]()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        s.Add(i)
        _ = s.Has(i)
    }
}

func BenchmarkSetInterface(b *testing.B) {
    s := make(map[interface{}]struct{})
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        s[i] = struct{}{}
        _, _ = s[i]
    }
}
```

Run with allocations:

```
go test -run x -bench . -benchmem -cpu 1
```

Typical observations on a generic set vs interface set:

- 1.5×–3× faster for value-type elements.
- 30–60% less memory.

For a generic concurrent map vs `sync.Map` with type assertions:

- Roughly equal speed.
- Similar memory.
- Cleaner code — that is the win.

Always run benchmarks on real data shapes, not toy examples.

---

## Common micro-optimizations

### 1. Pre-allocate slices

```go
func NewStack[T any]() *Stack[T] {
    return &Stack[T]{items: make([]T, 0, 16)}
}
```

Saves a few growth-and-copy steps for the first 16 pushes.

### 2. Pointer to large `T`

```go
type Cache[K comparable, V any] struct{ m map[K]V }
// for big V, prefer Cache[K, *V]
```

Saves on per-`Set`/`Get` copies.

### 3. Avoid unnecessary interface wraps

If you have a `*Stack[int]`, do not wrap it in `Pusher[int]` if you do not need polymorphism.

### 4. Reuse dictionaries

Calling many small generic functions in a loop with the same parameter type means the dictionary load happens repeatedly. Where it matters, consider hoisting the call into a non-generic helper.

### 5. Consider `cmp.Ordered` vs hand-rolled `Numeric`

`cmp.Ordered` is well-optimized in the standard library and recognized by tooling. Custom `Numeric` interfaces are fine but lose some standard-library affordances.

### 6. Use `slices` and `maps` packages

`slices.Index`, `slices.Sort`, `maps.Clone` are tuned by the standard library and avoid reinventing the wheel.

---

## Compile time and binary size

Heavy generic use can:

- Increase compile time by 20–50%.
- Increase binary size by hundreds of KB.

Each *unique gcshape* requires its own compiled body. A package using `Stack[int]`, `Stack[string]`, `Stack[*User]`, `Stack[*Order]` adds two or three bodies (pointers share a shape).

Mitigations:

- Avoid creating tiny generic types that exist only to be instantiated once.
- Prefer one big generic type with several methods over many small generic types.
- For internal-only helpers, sometimes a non-generic specialized version is fine.

If binary size is a concern (embedded targets, lambdas), measure with:

```
go build -ldflags="-s -w" -o bin ./cmd/...
ls -la bin
```

And compare with and without your generic refactor.

---

## Decision rules

A pragmatic flowchart:

```
Is the relationship "container of T" or "operation on T"?
├── No  → use a regular interface
└── Yes → continue

Are all elements the same concrete T at compile time?
├── No  → use a regular interface
└── Yes → continue

Will the value type be small (≤ 32 bytes) and copied a lot?
├── Yes → generic by value gives the biggest speed win
└── No  → generic by pointer; check if generics still help over interface

Do you need == on T?
├── Yes → constrain to comparable
└── No  → any

Are you on a hot path where every nanosecond counts?
├── Yes → benchmark generic vs hand-specialized
└── No  → ship the generic version
```

In 90% of cases, generic types and interfaces are simply *the right choice* — clearer, safer, and faster than the `interface{}` alternative. Only the remaining 10% need careful tuning.

---

## Summary

- Go uses GC stenciling with dictionaries — a hybrid of monomorphization and dictionary passing.
- Pointer-shaped types share one compiled body; many value types share another.
- The dictionary cost is small but real (~ns per call).
- Generic code typically beats `interface{}` for value types (no boxing) and matches it for pointer types.
- Choose non-generic interfaces for heterogeneity, open extension, and plugin-style architectures.
- Always benchmark on real workloads. Measure compile time and binary size on heavy generic refactors.

End of optimize.md.
