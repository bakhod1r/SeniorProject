# Stdlib Generic Packages — Optimize

## Table of Contents
1. [Pre-allocation](#pre-allocation)
2. [Choose `Compact` over `CompactFunc` when possible](#choose-compact-over-compactfunc-when-possible)
3. [`BinarySearch` over `Index` for sorted data](#binarysearch-over-index-for-sorted-data)
4. [`maps.Clone` over manual copy loops](#mapsclone-over-manual-copy-loops)
5. [`slices.Concat` over chained `append`](#slicesconcat-over-chained-append)
6. [Avoiding closure overhead](#avoiding-closure-overhead)
7. [Iterator vs slice tradeoffs](#iterator-vs-slice-tradeoffs)
8. [Summary](#summary)

---

## Pre-allocation

Most performance wins with `slices` come from telling Go the final size upfront.

### Slice from map keys

```go
// Slow: starts at zero capacity, grows multiple times
keys := []string{}
for k := range m { keys = append(keys, k) }

// Fast: pre-sized
keys := make([]string, 0, len(m))
for k := range m { keys = append(keys, k) }

// Fastest (1.23+): runtime knows the count
keys := slices.Collect(maps.Keys(m))
```

`slices.Collect` allocates the slice with the right size hint when the iterator implements `Len`. For `iter.Seq[K]` from `maps.Keys`, the runtime passes the map's length, so the result is allocated once.

### Concatenating slices

```go
// Slow: may reallocate at each append
all := []int{}
all = append(all, a...)
all = append(all, b...)
all = append(all, c...)

// Fast: one allocation
all := slices.Concat(a, b, c) // 1.22+
```

`slices.Concat` walks all input slices to compute total length, allocates the destination once, and copies. Saves up to 30% on hot paths that build large slices from multiple sources.

---

## Choose `Compact` over `CompactFunc` when possible

For `comparable` types, `slices.Compact` uses `==` directly:

```go
slices.Compact(s) // uses ==
```

For non-`comparable` types or custom equality, use `CompactFunc`:

```go
slices.CompactFunc(s, eq)
```

Performance difference: `Compact` inlines the comparison for primitive types. `CompactFunc` calls a function value, which is **almost always slower** unless the closure inlines.

### Benchmark sketch

| Operation | ns/op |
|-----------|-------|
| `slices.Compact([]int{...})` | ~1.0n |
| `slices.CompactFunc([]int{...}, func(a, b int) bool { return a == b })` | ~1.4n |

Roughly 30-40% slower. Negligible for small slices, noticeable for large ones.

### Rule

If `==` works for your type, use `Compact`. Reach for `CompactFunc` only when:
- The type is non-`comparable` (slice, map, function as element)
- You want a domain-specific equality (`strings.EqualFold`, ID-only matching, etc.)

---

## `BinarySearch` over `Index` for sorted data

`slices.Index` is `O(n)`. `slices.BinarySearch` is `O(log n)`. The crossover is around `n = 20`.

### Decision table

| Slice state | Use |
|-------------|-----|
| Sorted | `BinarySearch` |
| Unsorted, will be searched once | `Index` |
| Unsorted, will be searched many times | Sort first, then `BinarySearch` |
| Predicate-based (not exact) | `IndexFunc` |
| Sorted by a derived key | `BinarySearchFunc` |

### Benchmark sketch (n = 1,000)

| Operation | ns/op |
|-----------|-------|
| `slices.Index(s, target)` | ~250 |
| `slices.BinarySearch(s, target)` | ~10 |

A 25× speedup once you pay the one-time sort cost.

### Don't sort just to search once

If you only need to search once, plain `Index` is correct. Sorting is `O(n log n)` — more expensive than the linear scan it replaces. The win only materializes for repeated searches.

---

## `maps.Clone` over manual copy loops

The runtime fast path in `maps.Clone` knows the internal hash table layout:

```go
// Slow
dst := make(map[K]V, len(src))
for k, v := range src { dst[k] = v }

// Fast (2-3× faster on large maps)
dst := maps.Clone(src)
```

The runtime helper copies bucket layouts directly, skipping the hash recomputation that the for-loop version triggers.

### When manual is needed

Manual copy is required when:
- You want a deep copy (the runtime helper is shallow)
- You want to filter or transform during copy
- You have a partial map view

For all other cases, `maps.Clone` is faster and shorter.

---

## `slices.Concat` over chained `append`

Chained `append` reallocates whenever capacity is exceeded:

```go
// Each append may reallocate
result := append(append(append(a, b...), c...), d...)
```

`slices.Concat` walks all inputs once to sum lengths, allocates exactly once:

```go
result := slices.Concat(a, b, c, d) // 1.22+
```

### Benchmark sketch

| Operation | allocations |
|-----------|-------------|
| Chained `append` (4 slices, total len 1000) | 2-3 |
| `slices.Concat` | 1 |

The improvement scales with the number of input slices.

---

## Avoiding closure overhead

`SortFunc`, `IndexFunc`, `CompactFunc`, `EqualFunc`, etc., take `func` values. The Go compiler tries to inline them, but does not always succeed.

### Patterns that inline well

```go
slices.SortFunc(s, cmp.Compare) // direct reference, no closure
```

### Patterns that inline less reliably

```go
slices.SortFunc(s, func(a, b Person) int {
    return cmp.Compare(a.Age, b.Age) // simple closure — usually inlines
})

slices.SortFunc(s, func(a, b Person) int {
    if a.Age == b.Age && a.Name == b.Name { return 0 }
    // ... complex body
}) // less likely to inline
```

### Tip

Pass `cmp.Compare` directly when the slice element type is `cmp.Ordered`:

```go
slices.SortFunc(ints, cmp.Compare)
slices.BinarySearchFunc(ids, target, cmp.Compare)
```

The compiler treats this as a direct reference and inlines aggressively.

### Verify with `-gcflags`

```bash
go build -gcflags="-m=2" ./...
```

Look for "inlining call to ..." messages. Generic functions show up with shape suffixes.

---

## Iterator vs slice tradeoffs

In Go 1.23+, `maps.Keys` returns `iter.Seq[K]`. You have two paths:

### Use the iterator directly

```go
for k := range maps.Keys(m) {
    process(k)
}
```

No allocation. The iterator yields keys lazily.

### Materialize into a slice

```go
keys := slices.Collect(maps.Keys(m))
slices.Sort(keys)
for _, k := range keys {
    process(k)
}
```

One allocation, but you can sort, search, or pass the slice to other functions.

### Decision

| Need | Choice |
|------|--------|
| One-shot loop | iterator |
| Sort or search | materialize |
| Pass to other functions | materialize |
| Very large map, memory-sensitive | iterator |

For most application code the difference is invisible. For library hot paths, the iterator can save the slice allocation entirely.

---

## Summary

The biggest performance levers when using `slices`, `maps`, and `cmp`:

1. **Pre-allocate** with `make([]T, 0, n)` or use `slices.Concat`/`slices.Collect`.
2. **Prefer `Compact` over `CompactFunc`** when `==` works.
3. **Switch from `Index` to `BinarySearch`** for sorted data and `n > 20`.
4. **Use `maps.Clone`** instead of manual copy loops.
5. **Pass `cmp.Compare` directly** to `*Func` APIs when possible — better inlining.
6. **Range over iterators** to skip slice allocation when you only need a one-shot loop.

Most teams gain a measurable percentage off their CPU profile by applying just rules 1, 3, and 4. The remaining rules matter for hot paths in libraries and middleware.

A practical workflow:

1. Write the obvious code with `slices`/`maps`/`cmp`.
2. Profile with `pprof`.
3. If a stdlib helper shows up hot, check the variant table — there is often a faster choice.
4. Pre-allocate where the size is known.
5. Re-profile.

The stdlib generic packages are well-optimized. Most performance work is choosing **which** function to call, not optimizing the function itself.
