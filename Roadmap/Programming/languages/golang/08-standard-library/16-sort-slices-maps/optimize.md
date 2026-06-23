# 8.16 `sort`, `slices`, `maps` — Optimize

> **Audience.** You've measured a sort or a map operation hot in
> production and you want to know what actually moves numbers.
> Concrete techniques, with the cost model that justifies each.

## 1. Pick the right API: the 30% number

Microbenchmark on `[]int` of 100k random elements:

| API | ns/op | allocs/op | rel |
|-----|-------|-----------|-----|
| `slices.Sort([]int)` | 5.1M | 0 | 1.00x |
| `sort.IntSlice.Sort()` | 5.5M | 0 | 1.08x |
| `slices.SortFunc([]int, cmp.Compare)` | 7.8M | 0 | 1.53x |
| `sort.Slice([]int, less)` | 9.2M | 1 | 1.80x |

For sorts in a hot path, `slices.Sort` on `cmp.Ordered` types beats
the comparator-taking forms by 30–50%. The savings come from inlining:
`slices.Sort` instantiates per type, and the partition loop calls `<`
directly instead of through a function value.

## 2. Avoid sorting altogether

1. **Heap for top-K.** `O(n log k)` instead of `O(n log n)`. For
   k = 100, n = 1M, the heap is ~25x faster.
2. **Map for membership.** Sort + `BinarySearch` pays back only if
   you query >> log n times after building it.
3. **Bucketing.** When values fall in a known range with non-uniform
   density, sorting each bucket gives effectively `O(n)`.

## 3. Pre-allocate result slices

```go
// Bad: log2(n) reallocs
keys := []string{}
for k := range m { keys = append(keys, k) }

// Good: 1 alloc
keys := make([]string, 0, len(m))
for k := range m { keys = append(keys, k) }
```

The `append`-grows-by-doubling strategy reallocates `log2(n)` times.
For 1024 items, that's 10 reallocs and 10 copies. The `len(m)` hint
collapses this to one allocation.

## 4. Schwartzian transform for expensive keys

Sorting calls `Less` `O(n log n)` times. If the key is expensive,
pre-compute it:

```go
type kv struct {
    key  float64
    item *Item
}

paired := make([]kv, len(items))
for i, it := range items {
    paired[i] = kv{key: expensiveKey(it), item: it}
}
slices.SortFunc(paired, func(a, b kv) int {
    return cmp.Compare(a.key, b.key)
})
for i, p := range paired { items[i] = p.item }
```

Cost goes from `O(n log n × cost_of_key)` to
`O(n × cost_of_key + n log n)`. For 100 µs per key on 100k items, the
saving is from ~170 s to ~10 s.

## 5. Pointer slices for big structs

```go
// Bad: each Swap copies 200 bytes
slices.SortFunc(items, byScore)

// Good: each Swap is one pointer
ptrs := make([]*BigStruct, len(items))
for i := range items { ptrs[i] = &items[i] }
slices.SortFunc(ptrs, byScorePtr)
```

For random sort of 1M items at 200 bytes each, that's ~200 MB of swap
memory traffic vs ~8 MB. Comparators follow a pointer per call (cache
miss); break-even is around 32–64 bytes of struct data.

## 6. Comparator inlining

A comparator that captures variables becomes a heap-allocated closure.
A static comparator (no captures) is a top-level function, no
allocation:

```go
// Closure: 1 alloc per outer call
func sortBy(items []Item, key string) {
    slices.SortFunc(items, func(a, b Item) int {
        return cmp.Compare(a.Get(key), b.Get(key))
    })
}

// Static: 0 alloc
func sortByID(items []Item) { slices.SortFunc(items, byID) }
func byID(a, b Item) int { return cmp.Compare(a.ID, b.ID) }
```

When the key varies at runtime, dispatch to static comparators:

```go
func sortByKey(items []Item, key string) {
    var cmpFn func(a, b Item) int
    switch key {
    case "id": cmpFn = byID
    case "score": cmpFn = byScore
    default:
        cmpFn = func(a, b Item) int { return cmp.Compare(a.Get(key), b.Get(key)) }
    }
    slices.SortFunc(items, cmpFn)
}
```

## 7. `slices.Grow` before bulk insert

```go
total := 0
for _, batch := range batches { total += len(batch) }
result := make([]int, 0, total)
```

Or, when the bound is approximate:

```go
result = slices.Grow(result, expectedDelta)
```

`Grow` is a no-op if there's already room; otherwise it allocates
exactly enough.

## 8. `slices.Clip` to release memory

```go
buf := make([]byte, 0, 1<<20) // 1 MiB
buf = readUpTo(buf)
buf = buf[:n]
buf = slices.Clip(buf) // cap == len, tail is collectable
return buf
```

`Clip` returns `s[:len(s):len(s)]`. Without it, the 1 MiB stays alive
as long as the caller holds the slice.

## 9. Map sizing hints

```go
m := make(map[string]Record, len(records))
for _, r := range records { m[r.Key] = r }
```

For 100k entries, the unhinted version rehashes ~6 times. Hinted:
zero rehashes, 30–50% faster inserts. No effect on lookup time after
the map is built.

## 10. `sync.Pool` for sort buffers

```go
var sortBufPool = sync.Pool{
    New: func() any { return make([]Item, 0, 4096) },
}

func process(input []Item) []Item {
    buf := sortBufPool.Get().([]Item)
    defer func() {
        if cap(buf) <= 64*1024 {
            buf = buf[:0]
            sortBufPool.Put(buf)
        }
    }()
    buf = append(buf, input...)
    slices.SortFunc(buf, byScore)
    return slices.Clone(buf) // caller gets independent slice
}
```

Three rules: reset before reuse, cap the pooled size, clone before
returning (caller must not see the pooled slice).

## 11. `cmp.Or` vs cascaded `if`

```go
// Cascaded — short-circuits
slices.SortFunc(rows, func(a, b Row) int {
    if c := cmp.Compare(a.K1, b.K1); c != 0 { return c }
    if c := cmp.Compare(a.K2, b.K2); c != 0 { return c }
    return cmp.Compare(a.K3, b.K3)
})

// cmp.Or — evaluates all three every time
slices.SortFunc(rows, func(a, b Row) int {
    return cmp.Or(
        cmp.Compare(a.K1, b.K1),
        cmp.Compare(a.K2, b.K2),
        cmp.Compare(a.K3, b.K3),
    )
})
```

For cheap compares, the difference is negligible. For expensive ones
(string compare, function call), the cascade wins.

## 12. Avoid `reflect`-based sort

`sort.Slice` uses `reflect.Value` for `Swap` and allocates per call.
At 10k RPS, that's 10k allocs/sec of `reflect.Value`. `slices.SortFunc`
is generic — the compiler emits a typed loop with no allocation.
Migrate.

## 13. Stable vs unstable: pay only when needed

`slices.SortStableFunc` is consistently 2x slower than
`slices.SortFunc` and uses `O(n)` extra memory. Pay only when:

- Equal-key relative order has external meaning.
- The tie-breaker can't be encoded as a comparison key.

If you can express the tie-breaker, do so:

```go
slices.SortFunc(rows, func(a, b Row) int {
    if c := cmp.Compare(a.Score, b.Score); c != 0 { return c }
    return cmp.Compare(a.ID, b.ID)
})
```

## 14. Sort by index for huge structs

```go
indices := make([]int, len(items))
for i := range indices { indices[i] = i }
slices.SortFunc(indices, func(a, b int) int {
    return cmp.Compare(items[a].Score, items[b].Score)
})

sorted := make([]Item, len(items))
for i, idx := range indices { sorted[i] = items[idx] }
```

`Swap` on `[]int` is a single MOV. The comparator dereferences twice
per call but the index slice stays cache-friendly. Beats sorting the
original above ~128 bytes per element.

## 15. Map vs sorted-slice break-even

| n | `map[string]V` ns/op | sorted-slice + BinarySearch ns/op |
|---|----------------------|------------------------------------|
| 10 | 25 | 8 (linear `slices.Index`) |
| 100 | 30 | 25 |
| 1,000 | 35 | 60 |
| 10,000 | 45 | 90 |
| 100,000 | 65 | 130 |

Sorted slice wins for `n ≤ ~100`. Above that, the map's `O(1)` lookup
dominates. The slice also wins on memory and gives ordered iteration
free.

## 16. The `map[K]struct{}` set pattern

```go
allowed := map[string]struct{}{
    "alpha": {}, "beta": {}, "gamma": {},
}
if _, ok := allowed[name]; ok { /* ... */ }
```

`struct{}{}` is zero bytes. For 1M entries, `map[string]bool` stores
1 MB of value memory plus alignment; `map[string]struct{}` stores 0.

## 17. `slices.Reverse` vs reverse comparator

```go
// Two passes
slices.SortFunc(items, byScoreAsc)
slices.Reverse(items)

// One pass
slices.SortFunc(items, func(a, b Item) int {
    return cmp.Compare(b.Score, a.Score)
})
```

`Reverse` is `O(n)`; the sort is `O(n log n)`, so the marginal cost of
`Reverse` is ~5% for large `n`. Approach B is slightly faster and a
single statement.

## 18. The `clear` builtin (Go 1.21+)

```go
clear(buf) // zero all bytes; faster than the for-loop equivalent
clear(m)   // delete all entries from m
```

For a map, `clear(m)` is faster than `for k := range m { delete(m, k) }`.
For a reused slice in a hot loop:

```go
for ... {
    clear(buf)
    // fill buf, use it
}
```

Cheap reset, no realloc.

## 19. Branch-free comparison for known bounds

```go
// Branchy — what cmp.Compare does
func cmpInt(a, b int) int {
    if a < b { return -1 }
    if a > b { return 1 }
    return 0
}

// Branchless — risk of overflow for unbounded inputs
func cmpInt(a, b int) int { return a - b }
```

The subtraction form is one CPU instruction. Safe for bounded values
(small integers, fixed-point money in cents); dangerous near
`MaxInt`/`MinInt`. A few percent faster on hot paths.

## 20. What to read next

- [professional.md](professional.md) — the architectural decisions
  these optimizations support.
- [find-bug.md](find-bug.md) — the bugs that come from applying
  these wrong (especially `Clip`, capacity retention, pooling).
- [specification.md](specification.md) — the formal complexity
  table that justifies the numbers.
