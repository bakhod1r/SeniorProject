# 8.16 `sort`, `slices`, `maps` — Senior

> **Audience.** You've shipped code that uses these packages and you
> want the precise contracts: what `pdqsort` actually guarantees, how
> `BinarySearch` behaves on duplicates, what `slices.Delete` does to
> the tail, and where the cost lives. Source-level detail follows.

## 1. The internal algorithm: `pdqsort`

Since Go 1.19, `sort.Sort` and `slices.Sort` use *pattern-defeating
quicksort* (`pdqsort`), originally by Orson Peters. The defining
properties:

- Worst case `O(n log n)` (unlike vanilla quicksort).
- Best case `O(n)` for already-sorted or reverse-sorted input.
- Branchless partitioning on common types — fewer mispredictions.
- Heuristic detection of bad pivots; falls through to heapsort if a
  pathological pattern repeats.

The practical consequence: you cannot construct an input that drives
Go's sort into `O(n²)`. Pre-1.19 quicksort *could* be quadratic on
adversarial input; pdqsort fixes that with the heapsort fallback.

For small subarrays (length ≤ 12 by default), pdqsort switches to
insertion sort. For very large subarrays it uses block-quicksort
partitioning. Both details are implementation choices subject to
revision; do not rely on them.

## 2. `slices.SortFunc` vs `slices.Sort`

```go
slices.Sort(nums)                                    // []T where T is cmp.Ordered
slices.SortFunc(items, func(a, b T) int { ... })     // any slice
```

The `Sort` form is monomorphized by the compiler for each `Ordered`
type instantiation: `[]int`, `[]string`, `[]float64`, etc. The
comparator is inlined; the partition step uses a direct `<` operator.

`SortFunc` calls through a function value on every comparison. The
function is not inlined into the loop. The cost difference on a
benchmark of 100k random ints:

| API | ns/op | allocs/op |
|-----|-------|-----------|
| `slices.Sort([]int)` | 5.1M | 0 |
| `slices.SortFunc([]int, cmp.Compare[int])` | 7.8M | 0 |
| `sort.Slice([]int, less)` | 9.2M | 1 (interface boxing) |
| `sort.Sort(sort.IntSlice(...))` | 5.5M | 0 |

The numbers move with element type and CPU but the ranking is stable:
`slices.Sort` ≤ `sort.IntSlice` < `slices.SortFunc` < `sort.Slice`.
`SortFunc` is generic, so each instantiation gets a tailored loop
(better than reflection in `sort.Slice`), but the function-value
indirection still costs ~50% over the inlined direct comparison.

For most code this gap is invisible. For sorting in a hot path
(database query results, autocomplete suggestions on every keystroke),
prefer the `Ordered` form.

## 3. The `Less` contract — formal version

For `sort.Interface.Less(i, j int) bool`:

| Property | Formal statement |
|----------|------------------|
| Irreflexive | `Less(i, i)` is `false` for all valid `i` |
| Asymmetric | `Less(i, j)` and `Less(j, i)` cannot both be true |
| Transitive | `Less(i, j) && Less(j, k)` implies `Less(i, k)` |
| Equivalence transitive | If `i ≡ j` and `j ≡ k` then `i ≡ k`, where `i ≡ j` is `!Less(i, j) && !Less(j, i)` |

Together, these define a *strict weak ordering*. The same rules
apply to a `cmp` function returning negative / zero / positive.

The four most common violations:

1. **Using `<=` instead of `<`** — breaks irreflexivity.
2. **Floating-point `NaN`** — breaks equivalence transitivity (every
   `NaN` is incomparable with everything).
3. **Mutating the data during sort** — implicitly breaks every
   property; the algorithm reads each element multiple times.
4. **Random or time-dependent comparison** — `time.Now()` inside
   `Less` makes the result of `Less(i, j)` change between calls.

Go does *not* validate the `Less` function. Violations produce a
slice that is "sorted" by some intermediate state and then the loop
terminates. There is no panic, no error.

## 4. Stability — what stable sort guarantees

A stable sort preserves the relative order of elements that compare
equal:

```go
type Row struct {
    Group string
    ID    int
}
rows := []Row{
    {"A", 1}, {"B", 2}, {"A", 3}, {"B", 4}, {"A", 5},
}
slices.SortStableFunc(rows, func(a, b Row) int {
    return cmp.Compare(a.Group, b.Group)
})
// result: [{A 1} {A 3} {A 5} {B 2} {B 4}]
//   IDs within each group in original order
```

The unstable counterpart could legally produce `[{A 5} {A 1} {A 3} {B
4} {B 2}]` — same group ordering, but IDs scrambled within the group.

Go's stable sort (`slices.SortStableFunc`, `sort.Stable`) is
implemented as merge sort with insertion sort on small runs. It
allocates `O(n)` auxiliary memory and runs about 2x slower than
unstable on uniform-random input.

## 5. Stability vs explicit tie-breakers

Stable sort and explicit tie-breakers are both ways to disambiguate
equal keys:

```go
// Approach A: stable sort, rely on input order as tie-breaker
slices.SortStableFunc(rows, func(a, b Row) int {
    return cmp.Compare(a.Group, b.Group)
})

// Approach B: unstable sort with explicit tie-breaker
slices.SortFunc(rows, func(a, b Row) int {
    if c := cmp.Compare(a.Group, b.Group); c != 0 {
        return c
    }
    return cmp.Compare(a.ID, b.ID)
})
```

Approach B is faster on most data because it uses unstable sort, but
the tie-breaker key can change the result. If your data is *already*
in the order you want for ties (e.g., loaded from a database with
`ORDER BY created_at`), stable sort gives you the cheap behavior of
"preserve what came in." When the tie-breaker is encodable as a
comparison, prefer the explicit form.

## 6. `slices.BinarySearch` on duplicates

```go
nums := []int{1, 2, 2, 2, 3}
i, found := slices.BinarySearch(nums, 2)
fmt.Println(i, found) // 1 true, but which 2?
```

`BinarySearch` returns the *smallest* index `i` such that `nums[i] >=
target`. With three matching elements, it returns the index of the
first one. The contract:

| Result | Meaning |
|--------|---------|
| `(i, true)` | `s[i] == target` and `s[i-1] < target` (or `i == 0`) |
| `(i, false)` | `s[i] > target` and `s[i-1] < target` (or `i == 0` or `i == len(s)`) |

To find a *range* of equal elements, search twice:

```go
lo, _ := slices.BinarySearch(nums, target)
hi, _ := slices.BinarySearch(nums, target+1) // first element > target
matches := nums[lo:hi]
```

This is the idiomatic "all entries with key X" pattern on a sorted
slice. For non-`Ordered` types, use `BinarySearchFunc`:

```go
hi, _ := slices.BinarySearchFunc(rows, target, func(r Row, t string) int {
    if r.Key > t {
        return 1
    }
    return -1 // treat equality as "less", so we step past every match
})
```

The trick on the second search: returning `-1` for equality forces the
binary search to land *just past* the matching block.

## 7. `slices.Delete` and aliased tails

```go
s := []int{1, 2, 3, 4, 5}
s = slices.Delete(s, 1, 3) // removes indices 1..3
// s == [1 4 5], len 3
```

The implementation copies `s[3:]` over `s[1:]` and returns
`s[:newLen]`. The original backing array is unchanged from index 3
onwards — there's still a "5" at index 4, but it's outside the new
slice.

Since Go 1.22, `slices.Delete` zeros the slots after the new length
to release pointer references:

```go
// Go 1.22+ behavior: backing array now [1 4 5 _ _] where _ is zero
```

In Go 1.21, the backing array kept the old values, which could
prevent garbage collection of large pointed-to objects. If you target
1.21, zero them yourself when `T` is a pointer type:

```go
clear(s[newLen:oldLen]) // built-in clear, Go 1.21+
```

`slices.DeleteFunc` has the same zeroing behavior in 1.22+.

## 8. `slices.Insert` and capacity reuse

```go
s := make([]int, 3, 10)
copy(s, []int{1, 2, 3})
s = slices.Insert(s, 1, 99)
// s == [1 99 2 3], no allocation (used spare capacity)
```

`Insert` checks the destination capacity. If `len(s) + len(vs) <=
cap(s)`, it shifts in place. Otherwise it allocates a new backing
array (typically `max(len(s)+len(vs), 2*cap(s))`).

The implementation order of operations matters: it grows first, then
shifts the tail right, then writes the new elements. If the inserted
values are read from the same slice, the result is well-defined (the
implementation copies them aside before overwriting), but for clarity
do not pass aliased slices to `Insert`.

## 9. `slices.Compact` element invariants

```go
s := []int{1, 1, 1, 2, 3, 3, 4}
s = slices.Compact(s) // [1 2 3 4]
```

`Compact` only collapses *adjacent* duplicates, in linear time. For
full deduplication, sort first. The algorithm is one pass with two
indexes:

```go
// Reference implementation:
i := 1
for j := 1; j < len(s); j++ {
    if s[j] != s[j-1] {
        if i != j {
            s[i] = s[j]
        }
        i++
    }
}
return s[:i]
```

Like `Delete`, the tail elements after `i` are zeroed in 1.22+.

`CompactFunc` takes an equality function and otherwise behaves
identically.

## 10. `cmp.Compare` floating-point semantics

```go
cmp.Compare(math.NaN(), 1.0)        // -1
cmp.Compare(1.0, math.NaN())        // +1
cmp.Compare(math.NaN(), math.NaN()) //  0
cmp.Compare(-0.0, 0.0)              //  0
cmp.Compare(math.Inf(-1), 1.0)      // -1
```

The package documentation specifies:

- `NaN` is treated as smaller than every non-`NaN` value.
- All `NaN` values compare equal to each other.
- `-0.0` and `+0.0` compare equal.
- Infinities behave naturally (`-Inf < x < +Inf`).

This makes `cmp.Compare` a valid ordering on `float64` (a strict weak
order), unlike the native `<` operator. Sorting `[]float64` containing
`NaN` with `slices.Sort` (which uses `cmp.Compare` internally) puts
all `NaN` values at the front; the rest is ascending.

## 11. The `cmp.Or` helper

```go
limit := cmp.Or(0, 0, 100)              // 100 (first non-zero)
name := cmp.Or("", os.Getenv("USER"), "anonymous") // skips empty string

// In a comparator:
slices.SortFunc(rows, func(a, b Row) int {
    return cmp.Or(
        cmp.Compare(a.Group, b.Group),
        cmp.Compare(a.ID, b.ID),
    )
})
```

`cmp.Or` returns the first argument that is not the zero value of its
type. For multi-key comparators, it reads cleaner than the cascade
of `if c := ...; c != 0` checks. The trade-off: every argument is
*evaluated*, so cheap to write but not lazy. If a key is expensive to
compute, fall back to the `if` cascade.

## 12. Map iteration: hash randomization detail

The Go runtime stores a per-map random `hash0` set when the map is
initialized. `range m` walks buckets in order, but the starting bucket
is randomized per `range` (using a fresh random offset). On each
range, you get:

1. A random starting bucket `b0` in `[0, 2^B)` where `B` is the
   bucket-count log.
2. Iteration walks the buckets `b0, b0+1, ..., 2^B-1, 0, 1, ..., b0-1`.
3. Within each bucket, entries are walked in a fixed (but
   implementation-defined) order.

The randomness is per-`range` operation, not per-map. Two consecutive
ranges over the same map see different orders.

This is why a map *cannot* be the source of truth for a `MarshalJSON`
implementation that needs deterministic output. Sort the keys, or use
a `[]struct{ K, V T }` instead of a map.

## 13. Map growth and the iteration mid-flight contract

Adding to a map during iteration is allowed by the spec but the new
entries may or may not appear in that iteration:

```go
for k, v := range m {
    if v == 0 {
        m["zero-"+k] = v // may or may not be visited later
    }
}
```

Deleting entries is also allowed; the spec says deleted entries
"will not be produced." Mutating `v` of an existing entry is allowed
and is observed.

The undefined-behavior trap: rehashing during iteration. When the
map grows, the runtime relocates buckets, and an iteration in flight
may visit some entries twice or skip them entirely. The spec
explicitly leaves this unspecified. Practical rule: do not modify the
keys you're ranging over. Collect them into a slice first, then
mutate the map by that slice.

## 14. `maps.Clone` and pointer aliasing

```go
src := map[string]*User{"a": {Name: "Alice"}}
dst := maps.Clone(src)
dst["a"].Name = "Bob"
fmt.Println(src["a"].Name) // "Bob"
```

`maps.Clone` is shallow. Pointer values are copied as pointers; the
pointed-to structs are shared. For deep cloning, walk the map:

```go
dst := make(map[string]*User, len(src))
for k, v := range src {
    u := *v // copy the struct
    dst[k] = &u
}
```

Or, when the value type is a slice or another map, recurse with
`slices.Clone` / `maps.Clone`:

```go
dst := make(map[string][]int, len(src))
for k, v := range src {
    dst[k] = slices.Clone(v)
}
```

There is no `maps.DeepClone`; you write the recursion you need.

## 15. `maps.DeleteFunc` and concurrent safety

```go
maps.DeleteFunc(m, func(k string, v int) bool {
    return v < 10
})
```

`DeleteFunc` calls the predicate for each entry and deletes those
where it returns true. The implementation iterates with `range` and
calls `delete(m, k)` — which the spec allows during iteration.

It is *not* safe to mutate `m` from another goroutine while
`DeleteFunc` runs; that's a generic map race condition, not specific
to this function. Like all map operations, it requires external
synchronization (`sync.Mutex` or `sync.RWMutex`) for concurrent
access.

## 16. `slices.Equal` and slice headers

```go
a := []int{1, 2, 3}
b := []int{1, 2, 3}
slices.Equal(a, b)             // true
slices.Equal(a, a)             // true (always, by short-circuit)
slices.Equal([]int(nil), []int{}) // true (both length 0)
```

Length is checked first. Then the elements are compared with `==`. For
structs, this means field-wise equality (every field must be
`comparable`). For element types containing pointers, equality is
pointer identity, not deep equality.

A nil slice and an empty non-nil slice are equal. This matches the
broader stdlib convention — nil and empty are interchangeable for
read operations.

For non-`comparable` element types (slices, maps, funcs), use
`slices.EqualFunc`:

```go
slices.EqualFunc(a, b, func(x, y []int) bool {
    return slices.Equal(x, y)
})
```

## 17. `maps.Equal` semantics

```go
maps.Equal(a, b) // true if same keys, equal values (==)
```

Walks `a`, looks up each key in `b`, compares values. `O(len(a))`
average case. Returns false if `len(a) != len(b)`, true if both are
nil/empty.

Important: `maps.Equal` requires `V comparable`. For value types like
`[]int`, you need `maps.EqualFunc`:

```go
maps.EqualFunc(a, b, slices.Equal)
```

## 18. Iterators and the function-value cost

Range-over-func (`for x := range seq`) calls the iterator function,
passing a `yield` function generated by the compiler. Each iteration
crosses a function-value indirection. The compiler can sometimes
inline simple iterators, but in general the body of `range
maps.Keys(m)` runs through one extra function-value call per
iteration compared to `range m`.

Benchmarked: iterating a 1M-entry map with `range m` vs `range
maps.All(m)` is about 5% slower for the iterator form. For a
performance-critical inner loop, prefer the native `range`. For
composability (`slices.Sorted(maps.Keys(m))`), the iterator form is
worth it.

## 19. The `slices.Sorted` and `slices.SortedFunc` allocations

```go
keys := slices.Sorted(maps.Keys(m))
```

`Sorted` reads the iterator into a slice (one allocation), sorts it
in place, returns it. The allocation is `len(m)` of `K`. There is no
way to make this allocation-free — the iterator can't be sorted
without materialization.

For repeated sorted iteration over a stable map, cache the slice:

```go
type orderedMap struct {
    m       map[string]int
    keys    []string
    dirty   bool
}

func (o *orderedMap) sortedKeys() []string {
    if o.dirty {
        o.keys = slices.Sorted(maps.Keys(o.m))
        o.dirty = false
    }
    return o.keys
}
```

This costs one alloc per sort but reuses the result across reads.
Good fit for read-heavy maps with rare writes.

## 20. The pre-1.21 `sort` package: when it still wins

Even with `slices` in 2026, `sort` retains a niche:

1. **Generic `sort.Interface`.** Library APIs that take
   `sort.Interface` (so they can sort *anything*, not just slices)
   still need a wrapper type. `slices.SortFunc` does not satisfy
   `sort.Interface`.
2. **Sorting non-slice collections.** A custom container (linked
   list with random access, memory-mapped struct array) implements
   `Len`/`Less`/`Swap` once and gets sorting for free.
3. **`sort.Search` boundary searches.** When the predicate is "first
   index where some condition flips," `sort.Search` is more direct
   than synthesizing a `BinarySearchFunc`.

For a pure slice with an `Ordered` element type and you control the
slice — always `slices.Sort`.

## 21. Algorithmic complexity summary

| Operation | Time | Auxiliary memory |
|-----------|------|------------------|
| `slices.Sort` | O(n log n) worst, O(n) best | O(log n) stack |
| `slices.SortStableFunc` | O(n log n) | O(n) |
| `slices.BinarySearch` | O(log n) | O(1) |
| `slices.Index` / `Contains` | O(n) | O(1) |
| `slices.Insert` (k items) | O(n + k) | 0 if cap suffices |
| `slices.Delete` (j-i items) | O(n - i) | 0 |
| `slices.DeleteFunc` | O(n) | 0 |
| `slices.Compact` | O(n) | 0 |
| `slices.Clone` | O(n) | O(n) (one alloc) |
| `slices.Reverse` | O(n) | 0 |
| `slices.Equal` | O(n) | 0 |
| `maps.Clone` | O(n) | O(n) |
| `maps.Equal` | O(n) | 0 |
| `maps.Copy` | O(len(src)) | 0 |
| `maps.DeleteFunc` | O(n) | 0 |

For "n", read "length of the slice" or "number of entries in the
map". The auxiliary memory column counts user-visible allocations,
not stack space inside the algorithm.

## 22. What to read next

- [professional.md](professional.md) — production patterns:
  parallel sort, batched comparators, profiling sort hot paths.
- [specification.md](specification.md) — the formal reference
  table with every function and its preconditions.
- [find-bug.md](find-bug.md) — bugs that come from violating the
  contracts in this file.
- [optimize.md](optimize.md) — extracting the last 10% by avoiding
  function-value indirection and pre-sizing slices.
