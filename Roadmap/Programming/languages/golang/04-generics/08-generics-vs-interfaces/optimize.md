# Generics vs Interfaces — Optimize

## Table of Contents
1. [Performance is one axis, not the only one](#performance-is-one-axis-not-the-only-one)
2. [Hot path vs cold path](#hot-path-vs-cold-path)
3. [Decision tree](#decision-tree)
4. [Real benchmark numbers](#real-benchmark-numbers)
5. [Memory layout matters more than dispatch](#memory-layout-matters-more-than-dispatch)
6. [PGO and devirtualization](#pgo-and-devirtualization)
7. [When to mix the two](#when-to-mix-the-two)
8. [Summary](#summary)

---

## Performance is one axis, not the only one

A junior engineer asks "are generics faster than interfaces?" A senior engineer asks "which costs am I optimising — runtime, build time, binary size, or developer time?"

Costs of generics:
- Slightly larger binaries
- Slightly slower compilation
- Heavier API surface for callers

Costs of interfaces:
- Indirect dispatch (a few ns per call)
- Boxing for non-pointer values (heap allocations)
- Loss of compile-time type safety in heterogeneous slices

In most code these costs are **invisible**. The choice is driven by clarity, evolution, and team taste — not by raw nanoseconds. The performance question matters only when the code is on a measurable hot path.

---

## Hot path vs cold path

### Hot path (millions of calls per second)

| Tool | When to pick |
|------|--------------|
| Generics | Default — keeps memory flat, calls direct |
| Interface (concrete-known) | Devirtualizable — performance matches generics |
| Interface (heterogeneous) | Only if the heterogeneity is essential |
| `[]any` | Avoid — boxing destroys cache behaviour |

### Cold path (called once per request, once per minute)

| Tool | When to pick |
|------|--------------|
| Whatever expresses intent best | Performance does not matter here |
| Interface | Usually wins on flexibility and evolution |
| Generic | When the body is uniform and types vary |

### The 1% rule

Real codebases spend 95% of CPU time in 5% of the code. Optimise that 5% with generics or specialised functions; let the remaining 95% pick the most readable tool.

---

## Decision tree

```
Is this code on a measurable hot path?
├── Yes
│   │
│   ├── Same body, different types?
│   │   └── Generics (often free, sometimes faster than interface)
│   │
│   ├── Different bodies behind one name?
│   │   ├── Single concrete type at runtime → Interface (PGO devirtualizes)
│   │   └── Many concrete types at runtime  → Profile both; specialise if needed
│   │
│   └── Heterogeneous storage?
│       └── Interface (no choice; minimise boxing by using pointers)
│
└── No (cold path)
    │
    └── Pick whichever expresses intent best
```

A useful refinement: in the hot-path branch, also ask:

- **Is `[]T` available?** If yes, generics keep memory flat. Big win.
- **Is the call inside a tight loop?** If yes, prefer static dispatch.
- **Does the type vary at runtime?** If yes, interface; consider PGO.
- **Is `[]any` involved?** Almost always a refactor opportunity.

---

## Real benchmark numbers

The numbers below are typical for x86-64 / Go 1.21+. They are **examples**, not guarantees — always benchmark your own code.

### Sum a million ints

| Implementation | ns/op | allocs/op |
|----------------|-------|-----------|
| `func Sum(s []int) int` (concrete) | 280 | 0 |
| `func Sum[T ~int \| ~float64](s []T) T` (generic, instantiated for `int`) | 285 | 0 |
| `func Sum(s []any) int64` (interface, no boxing required) | 4,200 | 0 |
| `func Sum(s []any) any` (interface, with boxing required to populate) | 9,800 | 1,000,001 |

Generic vs concrete: tied. Generic vs interface: 15-30x faster on the same job.

### Sort 10,000 strings

| Implementation | ns/op |
|----------------|-------|
| `sort.Strings` | 380,000 |
| `slices.Sort` (generic) | 230,000 |

Generic is 40% faster because the comparator inlines `<` directly on `string`.

### Find in a slice of 1,000 structs

| Implementation | ns/op |
|----------------|-------|
| Hand-rolled `func FindMyStruct(s []MyStruct, t MyStruct) int` | 12 |
| `slices.Index[S ~[]E, E comparable](s S, e E)` (generic) | 18 |
| Interface-based loop with `Equal` method | 28 |

Generic is 50% slower than hand-rolled (dictionary cost on `comparable`) but still faster than interface dispatch.

### Boxing cost

| Operation | ns/op | allocs/op |
|-----------|-------|-----------|
| `x := 42; var i int = x` | <1 | 0 |
| `x := 42; var a any = x` | 5 | 1 |
| `x := 42; var s Stringer = MyInt(x)` | 5 | 1 (on small types) |

Each interface assignment is a small heap allocation for non-pointer values. Across millions of operations this dominates the cost.

---

## Memory layout matters more than dispatch

The biggest performance gap between generics and interfaces is not dispatch overhead — it is **memory layout**.

### Flat vs fragmented

A `[]int` of one million entries:
- 8 MB contiguous
- Prefetcher loves it
- Cache lines stay warm

A `[]any` of one million ints:
- 16 MB of headers
- One million heap allocations for the boxed ints (or pointer chasing if the int does not fit a word)
- Cache misses everywhere

For memory-bound algorithms (search, hash, scan, sum), the layout difference can be 5-50x in real workloads. Dispatch overhead is a few ns per call; cache-miss penalty is hundreds of ns per access.

### Practical rule

If your code touches a slice or map with many elements, **strongly prefer a typed (generic) slice over a `[]any` or interface slice**. The win is usually in cache behaviour, not in dispatch.

### Pointer-shaped exception

A `[]*Shape` (interface holding pointers) is closer in performance to `[]Shape[T]` because the interface header itself is just two pointers. The boxing cost is gone (the pointer is already a pointer). Heterogeneous slices of pointers are a reasonable compromise.

```go
// OK
shapes := []Shape{circle1, square1, triangle1} // pointer-shaped values stay efficient

// Slower
nums := []any{1, 2, 3, /* ... */} // each int boxes
```

---

## PGO and devirtualization

Profile-guided optimization, available since Go 1.21, can transform interface dispatch into direct calls when profiling shows a single concrete type dominates a call site.

### How it works

1. Build with `-pgo=auto` and a representative profile.
2. The compiler sees that `n.Notify(msg)` at call site X is `Email.Notify` 99% of the time.
3. It emits a fast path: `if dynType == Email { Email.Notify(msg) } else { fallback }`.

The fast path inlines. The slow path keeps the original interface dispatch.

### Effect on the choice

PGO narrows the historical performance gap between interfaces and generics. For monomorphic-at-runtime interfaces, the gap may be near zero. The remaining gap is:

- **Memory layout** (still in favour of generics for typed slices)
- **Compile-time guarantees** (generics catch wrong-type calls; interfaces only catch them when the type is statically known)

If your hot path is interface-shaped today and you do not want to refactor, enabling PGO often gives most of the generic win. If you are designing fresh code, generics still tend to win on memory.

---

## When to mix the two

The fastest **and** most flexible designs combine both tools.

### Pattern: typed slice with interface elements

```go
type Drawable interface { Draw() }

func DrawAll[T Drawable](items []T) {
    for _, v := range items { v.Draw() }
}
```

The slice is typed (no boxing). The constraint requires the method (per-type behaviour). For homogeneous slices this is faster than `func DrawAll(items []Drawable)`.

### Pattern: interface API, generic implementation

```go
// Public API — interface, stable
type Cache interface {
    Get(key string) (any, bool)
}

// Internal — generic, fast
type typedCache[V any] struct{ m map[string]V }
func (c *typedCache[V]) get(k string) (V, bool) { v, ok := c.m[k]; return v, ok }
```

Library users see the stable interface; internal code uses generics for performance. New implementations can swap in without breaking callers.

### Pattern: small interfaces inside generic helpers

```go
type Encoder interface { Encode([]byte) []byte }

func Pipeline[T Encoder](stages []T, input []byte) []byte {
    out := input
    for _, s := range stages { out = s.Encode(out) }
    return out
}
```

The interface is tiny and well-defined. The generic wrapper provides the typed slice. The inner method dispatch is interface-shaped because each encoder behaves differently.

---

## Summary

Performance is one input to the generics-vs-interfaces choice, not the only one. The decision tree:

1. **Cold paths** — pick the tool that expresses intent best.
2. **Hot paths** — generics often win because of flat memory, not dispatch speed.
3. **Heterogeneous data** — interface, no choice.
4. **Single-implementation interface** — drop the interface; use the concrete type.
5. **PGO available** — interface dispatch overhead nearly vanishes; memory layout still matters.

Two specific rules survive every benchmark:

1. **Generics over `[]any`** is almost always a big win — boxing and cache misses dominate.
2. **Generics over `interface{}`** in containers (cache, set, queue) eliminates per-element boxing entirely.

Two cases where the interface stays:

1. **Heterogeneous storage** — generics cannot represent it.
2. **Plugin / DI seams** — runtime swap is fundamentally an interface job.

A short summary rule: **generics keep memory flat; interfaces keep behaviour swappable**. Your hot path wants the first; your architectural seams want the second. Real systems use both deliberately.

The biggest "optimize generics vs interfaces" answer at the end of the day is not raw nanoseconds — it is **the right abstraction in the right place**. Wrong abstractions are slow because they fight the language; right abstractions are fast because the compiler agrees with them.
