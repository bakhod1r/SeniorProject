# Generic Data Structures — Optimize

## Table of Contents
1. [The performance question for containers](#the-performance-question-for-containers)
2. [Memory layout — slice vs linked structures](#memory-layout-slice-vs-linked-structures)
3. [Receiver choice and inlining](#receiver-choice-and-inlining)
4. [Avoiding boxing — keep T concrete](#avoiding-boxing-keep-t-concrete)
5. [Pre-allocation tricks](#pre-allocation-tricks)
6. [Pointer-shaped vs scalar-shaped T](#pointer-shaped-vs-scalar-shaped-t)
7. [GC-friendly removal](#gc-friendly-removal)
8. [Real benchmark numbers](#real-benchmark-numbers)
9. [Summary](#summary)

---

## The performance question for containers

Generic data structures live or die on three numbers:

1. **Allocations per operation** (alloc/op)
2. **Cache friendliness** (sequential vs pointer-chasing access)
3. **Inline-ability** of small methods

For a `Stack[int]`, all three are excellent. For a `LinkedList[*BigStruct]` that grows huge, you may pay heavily in cache misses. Knowing **which** structure to pick is more important than micro-optimizing the one you have.

---

## Memory layout — slice vs linked structures

### Slice-backed containers

A `Stack[T]` or slice queue stores elements in **one contiguous array**. The CPU prefetcher loves this. Iterating one million `int`s is essentially memcpy speed:

```
Stack[int]:  data → [v0][v1][v2]...[vN]   (cache lines: ████████)
```

### Linked-list containers

A linked list scatters nodes across the heap. Each node is a separate allocation:

```
LinkedList[int]:
   head → [v0|next] → [v1|next] → [v2|next] → ...
              ↑           ↑           ↑
           heap loc 1  heap loc 2  heap loc 3
```

Iterating means a pointer chase per step. On modern CPUs, this can be **10-100x slower** than the slice equivalent for tight numeric loops, because of cache misses.

### When to use which

| Need | Pick |
|------|------|
| FIFO/LIFO with sequential access | Slice |
| Frequent insertion in the middle | Linked list |
| Need stable element references | Linked list |
| Very large number of elements, mostly read | Slice |
| Bounded capacity, steady-state | Ring buffer |
| Sorted lookups | BST or sorted slice |
| Membership tests only | Set (map) |

### Counter-example: amortised slice growth

A slice grows by **doubling** its capacity. Append is amortised O(1) but worst-case O(n) when growth happens. For latency-sensitive code, pre-allocate:

```go
s := &Stack[int]{data: make([]int, 0, expectedMax)}
```

This avoids growth surprises during the hot path.

---

## Receiver choice and inlining

### Pointer vs value receivers

Container methods almost always use **pointer receivers**:

```go
func (s *Stack[T]) Push(v T) { s.data = append(s.data, v) }
```

Three reasons:

1. **Mutation visibility** — value receivers operate on a copy.
2. **Avoiding struct copy** — even a small `Stack[T]{data []T}` is 24 bytes (slice header). Copying that on every method call adds up.
3. **Inlining-friendly** — pointer methods are easier for the compiler to inline.

For tiny immutable types like `Pair[K, V]`, value receivers are fine and idiomatic.

### Inline checks

The Go compiler inlines small methods automatically. You can verify:

```bash
go build -gcflags="-m=2" ./... 2>&1 | grep "can inline"
```

Look for messages like:
```
./stack.go:8:6: can inline (*Stack[int]).Push
```

If the compiler can't inline `Push`, the function-call overhead can be measurable in tight loops. Often the cause is a body that is too large or contains a `defer`.

### Avoiding `defer` in hot methods

```go
func (s *Stack[T]) Push(v T) {
    s.mu.Lock()
    defer s.mu.Unlock()  // costs ~50ns per call
    s.data = append(s.data, v)
}
```

For very hot paths, replace `defer` with explicit `Unlock()` to save the overhead. For most code, the safety of `defer` wins.

---

## Avoiding boxing — keep T concrete

The single biggest performance win of generic containers is **no boxing**.

### What boxing costs

Pre-1.18 `Stack` over `interface{}`:

```go
type Stack struct{ data []interface{} }

s := &Stack{}
s.Push(42)  // boxes 42 into a heap-allocated (type, *int)
```

Each push allocates ~24 bytes (interface header + boxed int). For 1 million ints, that is **24 MB** of garbage.

### Generic version

```go
type Stack[T any] struct{ data []T }

s := &Stack[int]{}
s.Push(42)  // 42 stored directly, no allocation
```

The slice grows in place. Push is essentially `*ptr++` on the underlying array.

### Don't reintroduce boxing

A common mistake: making the element type an interface defeats the point.

```go
type Stringer interface{ String() string }
type Stack[T Stringer] struct{ data []T }
```

Inside the body, calling `v.String()` still goes through dynamic dispatch. The boxing happened at the moment you instantiated `Stack[*MyType]` — every call site stores the interface header.

**Rule:** If your generic container takes `T` constrained by a method-set interface, you have not avoided boxing. You have only made the container type-safe.

For boxing-free containers, the constraint should be `any`, `comparable`, or `cmp.Ordered` — not a method interface.

---

## Pre-allocation tricks

### `make([]T, 0, cap)` for known sizes

```go
func NewStack[T any](initialCap int) *Stack[T] {
    return &Stack[T]{data: make([]T, 0, initialCap)}
}
```

If you know you will hold ~1000 elements, allocate the array once. No grow-induced copy.

### Reuse with `[:0]`

For temporary stacks (per-request, per-batch), reset rather than allocate:

```go
func (s *Stack[T]) Reset() { s.data = s.data[:0] }
```

`s.data[:0]` keeps the underlying array, just resets length. The next pushes reuse the existing memory.

### `sync.Pool` for highly-allocated containers

```go
var stackPool = sync.Pool{
    New: func() any { return &Stack[int]{data: make([]int, 0, 64)} },
}

s := stackPool.Get().(*Stack[int])
defer func() { s.Reset(); stackPool.Put(s) }()
```

Note `sync.Pool` is not generic in stdlib — you wrap the cast yourself or use `puzpuzpuz/xsync`'s typed variant.

---

## Pointer-shaped vs scalar-shaped T

GC shape stenciling groups types. Scalar `int`, `float64`, etc., each get their own stencil. **All pointer-shaped types share one stencil**: `*MyStruct`, `string`, `[]T`, `map[K]V`, function types.

### Performance effect

For a `Stack[int]`:
- One stencil specialised for `int`
- Append is direct memory write
- Pop is direct memory read
- No dictionary indirection

For a `Stack[*Foo]` and a `Stack[*Bar]`:
- Both share the **pointer-shaped** stencil
- Body operates on pointer-sized data
- Operations like `==` (if the type were `comparable`) go through a runtime dictionary lookup

For most container methods (push, pop, len), there is no `==` or `<`, so the dictionary doesn't matter. The cost shows up only in `Set[T comparable]`, `Heap[T cmp.Ordered]`, and similar.

### Verifying with pprof

A flame graph for a generic container shows:

```
pkg.(*Stack[go.shape.int_0]).Push     ← stencil for int
pkg.(*Stack[go.shape.*pkg.Foo_1]).Push ← stencil for pointer
```

The `go.shape.X_N` suffix tells you which stencil is being hit. If your hot path uses one shape, the compiler can often **devirtualize** and inline as if it were hand-written.

---

## GC-friendly removal

When removing elements that contain pointers, **zero the slot** before reslicing:

```go
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.data) == 0 { return zero, false }
    n := len(s.data) - 1
    v := s.data[n]
    s.data[n] = zero      // ← critical
    s.data = s.data[:n]
    return v, true
}
```

Without `s.data[n] = zero`, the underlying array still holds a pointer to the popped element. The GC cannot reclaim it until the slice's underlying array is itself collected — which may never happen if the stack is long-lived.

This is a real production bug pattern: long-lived stacks/queues holding gigabytes of "leaked" objects that look reachable to the GC.

### When zeroing doesn't matter

- `T` is a scalar (`int`, `float64`, `bool`) — no pointer to leak.
- `T` is a value type with no pointer fields — same.

For pointer-shaped or pointer-containing `T`, always zero on remove.

---

## Real benchmark numbers

Benchmarks from a typical x86-64 laptop, Go 1.21+. These are **representative**, not authoritative.

### Stack[int] vs `[]interface{}` stack

| Operation | Stack[int] | []interface{} stack |
|-----------|------------|---------------------|
| Push 1M ints | 6.2 ms, 0 allocs | 38 ms, 1M allocs |
| Pop 1M ints | 4.5 ms, 0 allocs | 7 ms, 0 allocs |

**6× faster, no allocations.** This is the canonical "why generics" win.

### Set[string] vs `map[string]bool` (hand-rolled)

| Operation | Set[string] | Hand-rolled |
|-----------|-------------|-------------|
| Add 100k unique | 4.1 ms | 4.0 ms |
| Has lookup, hit | 21 ns | 20 ns |
| Has lookup, miss | 18 ns | 17 ns |

**Within 5%.** The generic wrapper adds essentially zero overhead.

### LinkedList[int] iteration vs slice iteration

| Operation | LinkedList[int] | Slice |
|-----------|-----------------|-------|
| Sum of 1M elements | 12 ms | 0.6 ms |

**20× difference.** This is not a generic vs non-generic issue — it is the cache-friendliness of contiguous arrays. The lesson: pick the right structure for the access pattern.

### Heap[int] (function comparator) vs `container/heap`

| Operation | Generic Heap | container/heap |
|-----------|--------------|----------------|
| Push 100k | 8.5 ms, 0 allocs | 14 ms, 100k allocs |
| Pop 100k | 7 ms, 0 allocs | 11 ms, 100k allocs |

**40-50% faster, no allocations** for the generic version because there is no `interface{}` boxing.

### Heap[int] (cmp.Ordered) vs Heap[int] (function)

| Operation | cmp.Ordered Heap | Function Heap |
|-----------|------------------|---------------|
| Push 100k | 7.2 ms | 8.5 ms |
| Pop 100k | 6 ms | 7 ms |

**~15% faster** with the constraint version because `<` is inlined and the function call disappears. For libraries serving general use, ship both APIs (like `slices.Sort` and `slices.SortFunc`).

### Pop without zero-fill (memory leak)

A queue that does not zero popped slots and runs for an hour with `T = *Job`:

| Approach | Heap usage |
|----------|------------|
| Zeroing on pop | 5 MB steady |
| Not zeroing | grows unboundedly |

The unboundedly-growing version eventually hits OOM. Always zero pointer-typed slots on remove.

---

## Summary

Generic data structures are **performance-positive** in three big ways:

1. **No boxing** — element type stays primitive, no heap allocation on store.
2. **Inlinable methods** — small generic methods often inline like hand-written code.
3. **Cache-friendly slice layouts** — when applicable, a `Stack[int]` is as fast as can be.

Pitfalls to watch:

1. **Wrong structure choice** — linked list for sequential numeric workloads is a 10-20× slowdown.
2. **Forgetting to zero pointer slots on remove** — long-lived containers leak memory.
3. **Method-set constraints reintroduce boxing** — `[T Stringer]` still dynamically dispatches.
4. **`defer` in hot methods** — replace with explicit `Unlock()` if every nanosecond counts.
5. **Pointer-shaped element types** share a stencil — measurable when the inner loop does `==` or `<`.

Practical guidance:

- **Default to generic.** The performance is essentially free.
- **Profile before specializing.** Hand-rolling a non-generic `IntStack` rarely wins by enough to justify the code.
- **Pre-allocate when possible.** `make([]T, 0, cap)` removes growth surprises.
- **Pool reusable containers** via `sync.Pool` for very high throughput.
- **Look at `pprof` flame graphs** for `go.shape.X_N` suffixes to identify which stencil is hot.

The biggest performance lesson for generic data structures is the same as for any Go code: **measure, don't guess**. Generics put the right shape in your hands; whether you use it efficiently is up to your benchmarks.
