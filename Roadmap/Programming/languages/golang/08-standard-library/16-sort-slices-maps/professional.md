# 8.16 `sort`, `slices`, `maps` — Professional

> **Audience.** You ship code where sort time and allocator pressure
> show up on flamegraphs. This file covers measured performance, the
> patterns that actually move numbers, and the operational concerns
> that arise once a sort runs millions of times per day.

## 1. Pick the right API for the workload

The choice between `sort.Sort`, `sort.Slice`, `slices.Sort`, and
`slices.SortFunc` is a real performance lever, not a stylistic choice.

| API | Comparator type | Compiler can inline? |
|-----|-----------------|----------------------|
| `slices.Sort[T cmp.Ordered]` | Builtin `<` | Yes |
| `sort.IntSlice.Sort()` | Builtin `<` (typed wrapper) | Yes |
| `slices.SortFunc[T]` | `func(a, b T) int` | Function value, indirect call |
| `sort.Slice` | `func(i, j int) bool` | Reflection on the slice header |

For a hot path sorting `[]int`, `[]string`, or `[]float64`, prefer
`slices.Sort`. For a hot path sorting `[]Struct` by one or two fields,
use `slices.SortFunc` and accept the function-value cost. For a cold
path or a one-off, the API choice is irrelevant.

## 2. Avoid sorting altogether when possible

The cheapest sort is the one you don't run. Three strategies:

1. **Maintain order on insert.** A `container/heap` keeps the
   smallest (or largest) element accessible in O(log n) per insert.
2. **Sort once, search many times.** If the data is read-mostly,
   sort once during construction and use `slices.BinarySearch`.
3. **Sort only the prefix.** Top-K with a heap is far cheaper than
   sorting the entire slice and slicing. Stdlib has no partial sort;
   `container/heap` is the workaround.

Cross-link: [`../17-container/`](../17-container/junior.md) covers `heap`,
`list`, and `ring`.

## 3. Heap-based top-K

```go
import "container/heap"

type minHeap []float64
func (h minHeap) Len() int           { return len(h) }
func (h minHeap) Less(i, j int) bool { return h[i] < h[j] }
func (h minHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *minHeap) Push(x any)        { *h = append(*h, x.(float64)) }
func (h *minHeap) Pop() any {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[:n-1]
    return x
}

func topK(scores []float64, k int) []float64 {
    h := make(minHeap, 0, k)
    for _, s := range scores {
        if h.Len() < k {
            heap.Push(&h, s)
        } else if s > h[0] {
            heap.Pop(&h)
            heap.Push(&h, s)
        }
    }
    out := make([]float64, k)
    for i := k - 1; i >= 0; i-- {
        out[i] = heap.Pop(&h).(float64)
    }
    return out
}
```

`O(n log k)` time and `O(k)` memory. For `n = 1M, k = 100`, this beats
`slices.Sort` (`O(n log n) = 20M`) by roughly 25x. Generics for
`container/heap` have not landed in stdlib, so you still write the
legacy `Len`/`Less`/`Swap`/`Push`/`Pop` methods.

## 4. Sort-then-binary-search as a static index

```go
type Index struct {
    keys []string
    vals []Record
}

func (ix *Index) Lookup(key string) (Record, bool) {
    i, ok := slices.BinarySearch(ix.keys, key)
    if !ok {
        return Record{}, false
    }
    return ix.vals[i], true
}
```

Two parallel slices, sorted once. Lookups are `O(log n)` with no map
overhead, no hashing, and excellent cache behavior. For static or
rarely-changing data, this beats `map[string]Record` on memory and
ties on lookup speed. Break-even is around 50–200 entries; below that,
linear scan wins.

## 5. The map-vs-sorted-slice decision

| Concern | `map[K]V` | Sorted slice + `BinarySearch` |
|---------|-----------|-------------------------------|
| Lookup time | O(1) average | O(log n) |
| Insert/delete | O(1) average | O(n) shift |
| Memory overhead | ~25–50% over the data | ~0 |
| Iteration order | Random | Natural |
| Cache locality | Poor (hashed buckets) | Excellent (linear) |
| Range queries (k1 ≤ x ≤ k2) | No | Yes |

Lookup-heavy, mostly-static data with predictable iteration: sorted
slice. Frequently mutating, no range queries: map. Need both fast
lookup and ordered iteration: keep both, in sync.

## 6. Pre-allocate result slices

```go
// Bad: append grows several times
result := []User{}
for _, u := range src {
    if u.Active { result = append(result, u) }
}

// Good: one allocation
result := make([]User, 0, len(src))
for _, u := range src {
    if u.Active { result = append(result, u) }
}
```

For `len(m)` capacity on map-key collection, the saving is 10–30%
plus constant allocation count regardless of size.

## 7. Avoid `slices.Clone` when reading

`slices.Clone` allocates and copies. When you only *read* a slice,
don't clone — just receive it. Clone only when:

- The function mutates the slice and the caller doesn't expect it.
- The function stores the slice past the call (struct field,
  goroutine) and the caller might mutate after returning.

## 8. Slice header retention

```go
func loadAll(r io.Reader) ([]Page, error) {
    pages := make([]Page, 0, 1024)
    for { /* fill */ }
    return pages[:10], nil // caller holds 1024-slot backing array
}
```

The caller sees `len == 10, cap == 1024`. The remaining 1014 `Page`
values stay reachable. For `Page` holding a megabyte each, that's a
~1 GB leak. Fix with `slices.Clip`:

```go
return slices.Clip(pages[:10]), nil
```

`Clip` returns `s[:len(s):len(s)]`. Future `append` allocates fresh;
the old large array becomes collectable.

## 9. Sort then `Compact` — the dedupe pipeline

```go
func dedupe(items []string) []string {
    sorted := slices.Clone(items)
    slices.Sort(sorted)
    return slices.Compact(sorted)
}
```

`O(n log n)` time, `O(n)` aux memory. Fastest dedupe when you don't
need to preserve insertion order. When order matters, build a map:

```go
seen := make(map[string]struct{}, len(items))
out := make([]string, 0, len(items))
for _, it := range items {
    if _, ok := seen[it]; ok { continue }
    seen[it] = struct{}{}
    out = append(out, it)
}
return out
```

## 10. Sort by precomputed key (Schwartzian transform)

When the sort key is expensive, the comparator runs `O(n log n)`
times — and so does the key computation. Compute once, sort by the
result:

```go
type keyed struct {
    key  string
    item *Item
}

paired := make([]keyed, len(items))
for i, it := range items {
    paired[i] = keyed{key: expensiveKey(it), item: it}
}
slices.SortFunc(paired, func(a, b keyed) int {
    return cmp.Compare(a.key, b.key)
})
for i, k := range paired {
    items[i] = k.item
}
```

Cost goes from `O(n log n × cost_of_key)` to
`O(n × cost_of_key + n log n)`. For keys taking microseconds on
millions of items, the saving is measured in seconds.

## 11. Map sizing for known input

```go
m := make(map[string]Record, len(records))
for _, r := range records {
    m[r.Key] = r
}
```

`make(map, hint)` pre-sizes the bucket array. Without the hint, Go
grows the map several times — each growth re-hashes every entry. The
hint cuts insert time by 30–50% on large maps.

## 12. The `sync.Pool` pattern for sort buffers

```go
var bufPool = sync.Pool{
    New: func() any { return make([]int, 0, 1024) },
}

func process(input []int) []int {
    buf := bufPool.Get().([]int)
    buf = append(buf[:0], input...)
    slices.Sort(buf)
    out := slices.Clone(buf)
    if cap(buf) <= 64*1024 {
        bufPool.Put(buf)
    }
    return out
}
```

Three caveats: clone before `Put` (returned slice and pool buffer
must not share memory); cap the size you put back (huge buffers
become a leak); pools provide no ordering guarantees.

## 13. Sorting `[]*T` vs `[]T`

For large structs, sort a slice of pointers. `Swap` moves 8-byte
pointers regardless of struct size; comparators dereference the
pointer (one cache miss per compare). Break-even is around 32–64
bytes of struct data — above that, pointer sort wins; below, value
sort wins because everything stays in cache and `Swap` is one or two
MOV instructions.

## 14. Stable JSON output

Common requirement: deterministic JSON for diff-friendly logs, golden
files, signature generation:

```go
func deterministicJSON(v map[string]any) ([]byte, error) {
    keys := slices.Sorted(maps.Keys(v))
    var buf bytes.Buffer
    buf.WriteByte('{')
    for i, k := range keys {
        if i > 0 {
            buf.WriteByte(',')
        }
        kb, err := json.Marshal(k)
        if err != nil { return nil, err }
        buf.Write(kb)
        buf.WriteByte(':')
        vb, err := json.Marshal(v[k])
        if err != nil { return nil, err }
        buf.Write(vb)
    }
    buf.WriteByte('}')
    return buf.Bytes(), nil
}
```

For nested maps, recurse. Struct fields are already deterministic
under `encoding/json`. Cross-link:
[`../04-encoding-json/`](../04-encoding-json/junior.md).

## 15. Operational: panicking comparators

A comparator that panics aborts the sort with the slice in a partial
state — scrambled, not necessarily invalid, but no longer in any
defined order:

```go
slices.SortFunc(rows, func(a, b Row) int {
    return cmp.Compare(a.Detail.Score, b.Detail.Score) // a.Detail might be nil
})
```

Defensive comparator:

```go
slices.SortFunc(rows, func(a, b Row) int {
    if a.Detail == nil && b.Detail == nil { return 0 }
    if a.Detail == nil { return -1 }
    if b.Detail == nil { return 1 }
    return cmp.Compare(a.Detail.Score, b.Detail.Score)
})
```

Decide what happens to nils explicitly: front, back, or treated as
zero.

## 16. Measuring with `testing.B`

```go
func BenchmarkSort(b *testing.B) {
    rng := rand.New(rand.NewSource(42))
    base := make([]int, 100_000)
    for i := range base { base[i] = rng.Intn(1_000_000) }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        s := slices.Clone(base)
        slices.Sort(s)
    }
}
```

Two pitfalls: `b.ResetTimer()` after setup (not before); clone fresh
data inside the loop because pdqsort is `O(n)` on already-sorted
input. For comparator comparisons:

```bash
go test -bench=. -benchmem -count=10 | tee bench.txt
benchstat bench.txt
```

## 17. What to read next

- [optimize.md](optimize.md) — the last 10%: cache effects, branch
  prediction, function-value indirection.
- [find-bug.md](find-bug.md) — the bugs that arise applying these
  patterns wrong.
- [interview.md](interview.md) — questions on the trade-offs above.
