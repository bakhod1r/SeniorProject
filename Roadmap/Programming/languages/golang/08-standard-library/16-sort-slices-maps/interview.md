# 8.16 `sort`, `slices`, `maps` — Interview

Twenty-four questions on the `sort`, `slices`, and `maps` packages, with
answers at the depth a senior backend engineer should reach in a
discussion. The questions skew toward "why does this API look this way"
and "what fails in production."

## Q1. When would you choose `slices.Sort` over `sort.Sort`?

Always, unless you're sorting something that is not a slice. `slices.Sort`
is generic, monomorphized at compile time, runs the comparator inline,
and requires zero boilerplate. `sort.Sort` requires a wrapper type
implementing `Len`/`Less`/`Swap` — fine in 2018, three lines of
ceremony in 2026. The legitimate uses for `sort.Sort` are: sorting a
custom non-slice container, or plugging into a library API that takes
`sort.Interface`.

## Q2. What's the difference between `slices.SortFunc` and `slices.Sort`?

`slices.Sort[T cmp.Ordered]` works only on element types that satisfy
`cmp.Ordered` (numbers, strings) and uses the native `<` operator
directly — the comparison is inlined. `slices.SortFunc` takes a
three-way comparator function that returns negative / zero / positive,
and works on any element type. The trade-off is performance:
`slices.Sort` is consistently faster (around 30–50% on micro-bench)
because the comparator does not go through a function-value indirect
call.

## Q3. What does `slices.SortStableFunc` guarantee that `slices.SortFunc` does not?

That elements which compare equal retain their relative order from the
input. Unstable sort is free to permute equal elements. Stable sort
costs about 2x in time and uses O(n) extra memory; you pay for it
only when the input order has external meaning that can't be expressed
as a tie-breaker key.

## Q4. Why does the Go runtime randomize map iteration order?

To make code that *depends* on a particular order break loudly during
development rather than silently in production. The hash-table layout
is implementation-defined; if a future Go version changes the bucket
algorithm, code that worked accidentally would break unpredictably.
Forcing randomization makes the dependency on order visible. For
deterministic output, sort the keys explicitly.

## Q5. Walk through the contract of a `Less` function.

It must define a strict weak ordering: irreflexive (`Less(x, x)` is
false), asymmetric (`Less(x, y)` implies `!Less(y, x)`), transitive
(`Less(x, y) && Less(y, z)` implies `Less(x, z)`), and the equivalence
relation `!Less(x, y) && !Less(y, x)` must be transitive too. Common
violations: using `<=` instead of `<`, comparing floats containing
`NaN` directly, mutating data during the sort. Violations don't panic
— they produce garbage output with no error.

## Q6. How does `cmp.Compare` handle `NaN`?

It treats `NaN` as smaller than every non-`NaN` value, and equal to
itself. This makes `cmp.Compare` a valid total order on `float64`
(strict weak), which the native `<` operator is not (it returns false
in both directions for `NaN`, breaking equivalence transitivity).
`slices.Sort` uses `cmp.Compare` internally, so `NaN` values sort to
the front of the slice; the rest is ascending.

## Q7. What's the time complexity of Go's sort?

`O(n log n)` worst case, `O(n)` best case (for already-sorted or
nearly-sorted input). The algorithm has been pattern-defeating
quicksort since Go 1.19, which guarantees `O(n log n)` even on
adversarial inputs that would push naive quicksort to `O(n²)`. It
falls back to heapsort on bad pivots.

## Q8. Explain `slices.BinarySearch`'s return value when the element is not found.

It returns `(insertionPoint, false)`. The insertion point is the index
where the element would be inserted to keep the slice sorted — i.e.,
the smallest index `i` with `s[i] > target`, or `len(s)` if no such
index exists. The bool tells you whether you actually got a hit. When
duplicates are present, it returns the smallest index of the matching
element.

## Q9. How do you find all elements with a given key in a sorted slice?

Two binary searches:

```go
lo, _ := slices.BinarySearch(keys, target)
hi, _ := slices.BinarySearch(keys, target+1) // first > target
matches := keys[lo:hi]
```

For non-integer keys without an obvious "+1", use `BinarySearchFunc`
where the comparator returns `-1` for equality on the high search.
That tricks the binary search into treating equal elements as smaller
and lands on the index past the last match.

## Q10. What happens if I modify a slice during `slices.Sort`?

The output is undefined. The algorithm reads each element multiple
times and assumes consistency. Modifying mid-sort can produce a slice
that is "sorted" by an inconsistent view of the data — possibly with
duplicate elements that weren't there originally, or missing some.
There's no panic, no error.

## Q11. `slices.Delete` is O(n). When does that bite?

When you call it inside a loop that deletes multiple items. Each call
shifts the tail, so removing k items is `O(k * n)` = `O(n²)` if k
scales with n. The right tool for "delete everything matching a
predicate" is `slices.DeleteFunc`, which does it in one pass, `O(n)`
total. The wrong tool is iterating with index decrement and `Delete`.

## Q12. What does `slices.Clone` do that `b := a` does not?

`b := a` copies the slice header (pointer, length, capacity) but both
slices share the backing array — a write through one is visible through
the other. `slices.Clone(a)` allocates a new backing array of length
`len(a)` and copies the elements. The clone is shallow: pointers,
slices-of-slices, and maps inside elements are still shared.

## Q13. Why would I use `slices.Clip`?

To release backing-array memory after trimming a slice. If a slice has
`cap` much larger than `len` (because it was sized generously, then
truncated), the backing array stays alive — even the unused tail.
`slices.Clip(s)` returns `s[:len(s):len(s)]`, which restricts the
visible capacity and lets the GC collect the tail when no other
slice references it. Common use: a function reads up to N bytes into
a buffer, then returns the actually-used prefix.

## Q14. Walk me through the Go 1.23 iterator transition.

Before Go 1.23, `maps.Keys` returned `[]K` and `maps.Values` returned
`[]V`. In 1.23, both were retyped to return `iter.Seq[K]` and
`iter.Seq[V]` — function-value iterators consumable by range-over-func.
This was a breaking change, but rare in practice because the new
helpers `slices.Sorted` and `slices.Collect` give you the slice back:

```go
keys := slices.Sorted(maps.Keys(m)) // sorted []K
keys := slices.Collect(maps.Keys(m)) // unsorted []K
```

Code targeting both 1.21–1.22 and 1.23+ should write the explicit
`for k := range m { keys = append(keys, k) }` pattern, which works
on every version.

## Q15. When is `sort.Search` better than `slices.BinarySearch`?

When the predicate is more general than "is this element equal to
target" — for example, "first index where a build started failing,"
"first timestamp after deadline," "first version that has feature X."
`sort.Search` accepts an arbitrary monotonic predicate: false for the
first k indexes, then true. `slices.BinarySearch` is specialized to
"find this value." For value lookup, `slices.BinarySearch` is
friendlier (returns the `(index, found)` pair). For boundary searches,
`sort.Search` is more direct.

## Q16. How do you sort a slice of `time.Time`?

Use `time.Time.Compare` (added in Go 1.20) inside `slices.SortFunc`:

```go
slices.SortFunc(events, func(a, b Event) int {
    return a.At.Compare(b.At)
})
```

`Compare` returns -1 / 0 / +1 based on the wall-clock instants —
monotonic readings are ignored, so a `Time` from `time.Now()` and one
parsed from JSON of the same instant compare as equal. Pre-1.20
codebases write the comparator manually using `Before` and `After`.

## Q17. Why does `maps.Clone` produce a shallow copy, not a deep one?

Because deep cloning would have to recurse into arbitrary value types,
and Go has no general "clone this value" primitive. The runtime knows
how to allocate a new map and copy keys and values, but for value
types like `[]int`, `*Node`, or `map[string]Foo`, "copy" means
something different to different callers. The package leaves it to
the user: clone the inner values yourself when you need depth.

## Q18. What's the cost of sorting `[]*BigStruct` vs `[]BigStruct`?

Sorting `[]BigStruct` does `Swap` operations that copy the entire
struct. For a struct with dozens of fields, that's expensive — each
swap is O(struct size). Sorting `[]*BigStruct` swaps 8-byte pointers
regardless of struct size. The trade-off: comparators on `[]*BigStruct`
follow a pointer per comparison (cache miss), while comparators on
`[]BigStruct` access fields directly. Break-even is around 32–64 bytes
of struct data. For very small structs, sort by value; for large ones,
sort by pointer.

## Q19. How would you implement a top-K with stdlib?

Use `container/heap`. Maintain a min-heap of size K: when a new element
beats the smallest in the heap, pop the smallest and push the new one.
The result is `O(n log k)` time and `O(k)` memory — far better than
`O(n log n)` from sorting the whole slice and slicing the top K. There
is no generic `heap` in stdlib, so you implement the legacy
`heap.Interface` (Len/Less/Swap/Push/Pop). Cross-link:
[`../17-container/`](../17-container/junior.md) covers this in depth.

## Q20. What changes in `slices.Delete` between Go 1.21 and 1.22?

Go 1.22 added explicit zeroing of the slots between the new length
and the old length. This means after `slices.Delete(s, i, j)`, the
elements at `s[i:j]` (now beyond the slice's `len`) are set to the
zero value of their type. This releases pointer references that would
otherwise prevent garbage collection. In 1.21, those slots kept the
old values, and you had to `clear(s[newLen:oldLen])` yourself for
pointer-typed elements.

## Q21. What's the relationship between `cmp.Ordered` and `comparable`?

`comparable` is a built-in constraint that allows `==` and `!=`. It
includes everything `Ordered` does, plus pointers, interfaces, channels,
arrays of comparable types, and structs of comparable types. `Ordered`
is strictly stronger: it also requires `<`, `<=`, `>`, `>=`, which
`comparable` does not. `slices.Sort` requires `Ordered` because it
sorts; `slices.Equal` requires `comparable` because it only checks
equality.

## Q22. Why does `maps.Copy(nil, src)` panic, but `maps.Copy(dst, nil)` does not?

Because writing to a nil map is illegal (`assignment to entry in nil
map`). The first `dst[k] = v` operation panics. Reading a nil map is
fine — it just returns zero values — so `maps.Copy(dst, nil)` walks an
empty source and does nothing. The asymmetry mirrors the underlying
map semantics: read from nil is OK, write to nil panics.

## Q23. How do you get deterministic JSON output from a `map`?

Two approaches. Manual encoding: pull the keys, sort them, write the
JSON object key by key. Or define a `MarshalJSON` method on a wrapper
type that does the same. The standard `json.Marshal` of a map
internally sorts string keys for `map[string]V` (which gives stable
output), but for non-string keys (`map[int]V`), it sorts numerically
in Go 1.12+, but not all key types have a defined order. For
`map[int64]struct` or anything custom, the sort-keys-explicitly pattern
is reliable.

## Q24. When would you prefer a sorted slice over a map?

When the data is mostly read, rarely written, and small enough that
linear or binary access beats hash lookup with overhead. Numbers from
production: under ~50 entries, linear scan of a slice beats a map
lookup. Under ~10k entries, a sorted slice with `BinarySearch` beats a
map on lookup time *and* memory (no hash buckets, no tombstones), and
gives ordered iteration for free. Above 10k, the map's `O(1)` average
case wins for lookups, and you fall back to the slice only when you
need range queries (`k1 <= x <= k2`) or sorted iteration.

## Q25. What's the difference between `slices.Compact` and dedupe?

`slices.Compact` only collapses *adjacent* equal elements. `[1, 1, 2,
1]` becomes `[1, 2, 1]` — the trailing 1 is preserved because it's
not adjacent to the previous run. For full dedupe, sort first, then
`Compact`. The resulting `[1, 1, 2, 1]` becomes `[1, 1, 1, 2]` after
sort, then `[1, 2]` after `Compact`. Three lines of code; no need for
a hash set unless you need to preserve insertion order.

## Q26. Walk me through `slices.SortFunc` performance vs `sort.Slice`.

`sort.Slice` uses reflection on the slice's type at sort time —
each `Swap` invocation goes through `reflect.Value`. `slices.SortFunc`
is generic and compiled to a per-type implementation by the compiler,
so `Swap` is a typed slot swap. The comparator in both cases is a
function value, but `slices.SortFunc` invokes it on typed elements
without the boxing tax that `sort.Slice` incurs.

Net result: on `[]Item` sorting by one field, `slices.SortFunc` is
20–40% faster than `sort.Slice` and uses no allocations (`sort.Slice`
allocates one `reflect.Value` per call). On `[]int` with `slices.Sort`
(specialized, no comparator function), the gap widens to ~50% over
`sort.Slice`.

## Q27. What's wrong with using `time.Now()` inside a comparator?

It changes the value of `Less(x, y)` between invocations. The sort
algorithm assumes the relation is consistent for the duration of the
sort; if it shifts, the algorithm produces a slice that's "sorted"
according to no single ordering. The same problem applies to any
non-deterministic comparator: random tie-breaks, network-dependent
results, locale-changing comparisons.

## Q28. How would you sort a stream of values you can't fit in memory?

External merge sort. Read N bytes into memory, sort with `slices.Sort`,
write to a temp file. Repeat until the input is exhausted, producing
K sorted runs. Then merge the K runs by reading from each in parallel
and emitting the smallest current head — `container/heap` over the
run heads gives `O(N log K)` merge time. Stdlib has no built-in
external sort; you compose `slices.Sort`, file I/O, and `heap`. For
large-scale work, reach for a database or a dataflow framework.

## Q29. Why does `slices.Sort` panic on empty input for `Min`/`Max` but not for `Sort`?

Because there's a meaningful answer for sorting nothing — the empty
slice is trivially sorted — but no meaningful "minimum of nothing"
exists. The package designers picked panic over a sentinel value
(like `math.MinInt`) because any sentinel collides with a legitimate
input value somewhere. A panic forces the caller to confront the
empty case, rather than accept a subtly wrong default. The same
philosophy applies elsewhere in the stdlib: `bytes.Buffer.Bytes()`
returns a length-zero slice when empty (zero is a valid byte
sequence), but `(*list.List).Front()` returns nil (no valid element).
The choice depends on whether the empty case has a natural answer.

## Q30. What's the relationship between `slices.SortStable` and `sort.Stable`?

Both implement stable sort, but they target different APIs.
`slices.SortStableFunc` is generic, takes a slice directly with a
three-way comparator, and uses an internal merge-sort variant
allocating `O(n)` extra memory. `sort.Stable` takes a `sort.Interface`
implementation and uses a different algorithm — it's the "in-place
stable" sort that runs in `O(n log² n)` worst case but with
`O(1)` extra memory. The trade-off: `slices.SortStableFunc` is faster
in time but uses more memory; `sort.Stable` is slower but constant
memory. For typical slices, the slices version is the right choice;
for memory-constrained environments or huge slices, `sort.Stable`
on a custom interface implementation can win.

## Q31. When should `slices.Compact` panic?

It does not panic on its own — it has no panic conditions in its
contract. The trickier question is: what happens when you pass a
nil slice? The answer is the same as `slices.Sort(nil)`: a no-op
returning an empty slice. The tail-zeroing behavior added in Go 1.22
also doesn't introduce panics; it operates only on the slice's own
backing array within bounds. The only way to make `Compact` misbehave
is to pass a slice whose elements panic on `==` — but that requires
an exotic type, since `==` on `comparable` types is always defined.
For `CompactFunc`, the equality function can panic, and that
propagates.

## Q32. How do you find the median of a slice without fully sorting?

Quickselect — the partition step of quicksort, applied recursively
only to the half containing the target index. Stdlib does not provide
quickselect; you write it or pull from a third-party package.
Algorithm: pick a pivot, partition, recurse only into the side
containing index `n/2`. Average `O(n)` time, worst case `O(n²)` with
naive pivot choice. For median specifically, this is roughly 5x
faster than `slices.Sort` followed by indexing the middle.

For "I just need the median once," sorting is simpler and the
constant factor difference rarely matters below 100k elements.
For interactive querying of order statistics on dynamic data,
maintain a min-heap and a max-heap with the median at one of their
tops — `container/heap` over a balanced two-heap structure.
