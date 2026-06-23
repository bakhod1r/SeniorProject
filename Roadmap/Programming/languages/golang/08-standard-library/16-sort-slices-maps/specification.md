# 8.16 `sort`, `slices`, `maps` — Specification

Reference material. Function signatures, preconditions, postconditions,
and complexity. Tables only; prose lives in
[senior.md](senior.md).

This is a distillation of the `sort`, `slices`, `maps`, and `cmp`
package documentation as of Go 1.23, with notes called out for
features added in 1.21 / 1.22 / 1.23.

## 1. The `cmp.Ordered` constraint

```go
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64 | ~string
}
```

The `~` allows defined types whose underlying type is one of the
listed primitives. `time.Duration` (underlying `int64`) is therefore
`Ordered`. `time.Time` is not — it's a struct, with its own `Compare`.

## 2. `cmp` package

| Function | Signature | Notes |
|----------|-----------|-------|
| `Compare` | `Compare[T Ordered](x, y T) int` | -1 / 0 / +1; `NaN` < everything |
| `Less` | `Less[T Ordered](x, y T) bool` | `Compare(x, y) < 0` |
| `Or` | `Or[T comparable](vals ...T) T` | First non-zero value, or zero of `T` |

## 3. `slices.Sort` family

| Function | Signature (Go 1.21+) |
|----------|----------------------|
| `Sort` | `Sort[S ~[]E, E cmp.Ordered](x S)` |
| `SortFunc` | `SortFunc[S ~[]E, E any](x S, cmp func(a, b E) int)` |
| `SortStableFunc` | `SortStableFunc[S ~[]E, E any](x S, cmp func(a, b E) int)` |
| `IsSorted` | `IsSorted[S ~[]E, E cmp.Ordered](x S) bool` |
| `IsSortedFunc` | `IsSortedFunc[S ~[]E, E any](x S, cmp func(a, b E) int) bool` |

| Aspect | Specification |
|--------|---------------|
| In-place | Yes; modifies `x` |
| Stability of `Sort`/`SortFunc` | Not stable |
| Stability of `SortStableFunc` | Stable: equal elements keep relative order |
| Time | O(n log n) worst, O(n) best |
| Space | O(log n) stack for unstable; O(n) for stable |
| Comparator return | -1 / 0 / +1, or any negative / zero / positive |
| `cmp` requirements | Strict weak ordering (irreflexive, asymmetric, transitive) |

## 4. `slices.BinarySearch`

| Function | Signature |
|----------|-----------|
| `BinarySearch` | `BinarySearch[S ~[]E, E cmp.Ordered](x S, target E) (int, bool)` |
| `BinarySearchFunc` | `BinarySearchFunc[S ~[]E, E, T any](x S, target T, cmp func(E, T) int) (int, bool)` |

| Aspect | Specification |
|--------|---------------|
| Precondition | `x` MUST be sorted by the same ordering used in the search |
| Return on hit | Smallest index `i` with `x[i] == target`; `bool` is `true` |
| Return on miss | Smallest index `i` with `x[i] > target`; `bool` is `false` |
| Comparator (`Func`) | Compares element to target: returns `-` if elem < target, `0` if equal, `+` if elem > target |
| Time | O(log n) |
| Behavior on unsorted | Result is unspecified; no error or panic |

## 5. `slices.Search/Index/Contains`

| Function | Signature |
|----------|-----------|
| `Index` | `Index[S ~[]E, E comparable](s S, v E) int` |
| `IndexFunc` | `IndexFunc[S ~[]E, E any](s S, f func(E) bool) int` |
| `Contains` | `Contains[S ~[]E, E comparable](s S, v E) bool` |
| `ContainsFunc` | `ContainsFunc[S ~[]E, E any](s S, f func(E) bool) bool` |

| Aspect | Specification |
|--------|---------------|
| `Index` not found | Returns -1 |
| Linear scan | O(n) |
| `Contains` | Equivalent to `Index(s, v) >= 0` |

## 6. `slices.Equal/Compare`

| Function | Signature |
|----------|-----------|
| `Equal` | `Equal[S ~[]E, E comparable](s1, s2 S) bool` |
| `EqualFunc` | `EqualFunc[S1 ~[]E1, S2 ~[]E2, E1, E2 any](s1 S1, s2 S2, eq func(E1, E2) bool) bool` |
| `Compare` | `Compare[S ~[]E, E cmp.Ordered](s1, s2 S) int` |
| `CompareFunc` | `CompareFunc[S1 ~[]E1, S2 ~[]E2, E1, E2 any](s1 S1, s2 S2, cmp func(E1, E2) int) int` |

| Aspect | Specification |
|--------|---------------|
| `Equal` length mismatch | Returns false |
| `Equal` nil vs empty | Returns true (both length 0) |
| `Compare` order | Lexicographic; shorter prefix is smaller after a tie |
| Time | O(n); `Equal` short-circuits on first mismatch |

## 7. `slices.Min/Max`

| Function | Signature |
|----------|-----------|
| `Min` | `Min[S ~[]E, E cmp.Ordered](x S) E` |
| `MinFunc` | `MinFunc[S ~[]E, E any](x S, cmp func(a, b E) int) E` |
| `Max` | `Max[S ~[]E, E cmp.Ordered](x S) E` |
| `MaxFunc` | `MaxFunc[S ~[]E, E any](x S, cmp func(a, b E) int) E` |

| Aspect | Specification |
|--------|---------------|
| Empty input | Panics |
| Time | O(n) |
| Tie | Returns first occurrence (`Min`) or first occurrence (`Max`) |

## 8. `slices.Insert/Delete/Replace/Compact`

| Function | Signature |
|----------|-----------|
| `Insert` | `Insert[S ~[]E, E any](s S, i int, v ...E) S` |
| `Delete` | `Delete[S ~[]E, E any](s S, i, j int) S` |
| `DeleteFunc` | `DeleteFunc[S ~[]E, E any](s S, del func(E) bool) S` |
| `Replace` | `Replace[S ~[]E, E any](s S, i, j int, v ...E) S` |
| `Compact` | `Compact[S ~[]E, E comparable](s S) S` |
| `CompactFunc` | `CompactFunc[S ~[]E, E any](s S, eq func(E, E) bool) S` |

| Aspect | Specification |
|--------|---------------|
| `Insert` precondition | `0 <= i <= len(s)` |
| `Delete` precondition | `0 <= i <= j <= len(s)` |
| `Replace` precondition | `0 <= i <= j <= len(s)` |
| In-place | Yes when capacity suffices; allocates fresh otherwise |
| Tail zeroing | Slots between new length and old length are zeroed (Go 1.22+) |
| `Compact` | Adjacent equal elements collapsed; not full dedupe |
| Time | O(n) shift; O(n + len(v)) for `Insert`/`Replace` |

## 9. `slices.Clone/Reverse/Concat/Grow/Clip`

| Function | Signature |
|----------|-----------|
| `Clone` | `Clone[S ~[]E, E any](s S) S` |
| `Reverse` | `Reverse[S ~[]E, E any](s S)` |
| `Concat` | `Concat[S ~[]E, E any](slices ...S) S` (Go 1.22+) |
| `Grow` | `Grow[S ~[]E, E any](s S, n int) S` |
| `Clip` | `Clip[S ~[]E, E any](s S) S` |
| `Chunk` | `Chunk[S ~[]E, E any](s S, n int) iter.Seq[S]` (Go 1.23+) |

| Aspect | Specification |
|--------|---------------|
| `Clone` depth | Shallow; pointer values are shared |
| `Clone` of nil | Returns nil |
| `Reverse` | In-place; O(n) |
| `Concat` | One allocation, exact size; O(total) time |
| `Grow` | Returns slice with `cap >= len(s)+n`; same `len` |
| `Grow` panic | If `n < 0` or required capacity exceeds slice limit |
| `Clip` | Returns `s[:len(s):len(s)]` |
| `Chunk` panic | If `n <= 0`; chunks share backing array |

## 10. `slices` iterators (Go 1.23+)

| Function | Signature | Yields |
|----------|-----------|--------|
| `All` | `All[S ~[]E, E any](s S) iter.Seq2[int, E]` | (index, value) pairs |
| `Values` | `Values[S ~[]E, E any](s S) iter.Seq[E]` | Values only |
| `Backward` | `Backward[S ~[]E, E any](s S) iter.Seq2[int, E]` | (index, value) reverse |
| `Sorted` | `Sorted[E cmp.Ordered](seq iter.Seq[E]) []E` | Materialized + sorted |
| `SortedFunc` | `SortedFunc[E any](seq iter.Seq[E], cmp func(a, b E) int) []E` | Materialized + sorted by `cmp` |
| `SortedStableFunc` | `SortedStableFunc[E any](seq iter.Seq[E], cmp func(a, b E) int) []E` | Stable variant |
| `Collect` | `Collect[E any](seq iter.Seq[E]) []E` | Materialized, no sort |

## 11. `maps` package

| Function | Signature (Go 1.21+) |
|----------|----------------------|
| `Equal` | `Equal[M1, M2 ~map[K]V, K, V comparable](m1 M1, m2 M2) bool` |
| `EqualFunc` | `EqualFunc[M1 ~map[K]V1, M2 ~map[K]V2, K comparable, V1, V2 any](m1 M1, m2 M2, eq func(V1, V2) bool) bool` |
| `Clone` | `Clone[M ~map[K]V, K comparable, V any](m M) M` |
| `Copy` | `Copy[M1 ~map[K]V, M2 ~map[K]V, K comparable, V any](dst M1, src M2)` |
| `DeleteFunc` | `DeleteFunc[M ~map[K]V, K comparable, V any](m M, del func(K, V) bool)` |

| Aspect | Specification |
|--------|---------------|
| `Clone` depth | Shallow |
| `Clone` of nil | Returns nil |
| `Copy` precondition | `dst` must be non-nil |
| `Copy` collision | Source value overwrites destination |
| `DeleteFunc` order | Unspecified; may visit entries in any order |

## 12. `maps` iterators

| Function | Signature | Notes |
|----------|-----------|-------|
| Go 1.21–1.22 `Keys` | `Keys[M ~map[K]V, K comparable, V any](m M) []K` | Slice form |
| Go 1.21–1.22 `Values` | `Values[M ~map[K]V, K comparable, V any](m M) []V` | Slice form |
| Go 1.23+ `All` | `All[M ~map[K]V, K comparable, V any](m M) iter.Seq2[K, V]` | (key, value) pairs |
| Go 1.23+ `Keys` | `Keys[M ~map[K]V, K comparable, V any](m M) iter.Seq[K]` | Iterator |
| Go 1.23+ `Values` | `Values[M ~map[K]V, K comparable, V any](m M) iter.Seq[V]` | Iterator |
| Go 1.23+ `Insert` | `Insert[M ~map[K]V, K comparable, V any](m M, seq iter.Seq2[K, V])` | Bulk insert |
| Go 1.23+ `Collect` | `Collect[K comparable, V any](seq iter.Seq2[K, V]) map[K]V` | Materialize iterator |

The Go 1.23 release retyped `Keys` and `Values` from `[]K` / `[]V` to
iterators. Code that did `keys := maps.Keys(m); slices.Sort(keys)`
must change to `keys := slices.Sorted(maps.Keys(m))`.

## 13. `sort` package interface

```go
type Interface interface {
    Len() int
    Less(i, j int) bool
    Swap(i, j int)
}
```

| Aspect | Specification |
|--------|---------------|
| `Less(i, i)` | MUST return false (irreflexivity) |
| `Less(i, j)` and `Less(j, i)` | MUST NOT both be true (asymmetry) |
| Transitive | `Less(i, j) && Less(j, k)` ⇒ `Less(i, k)` |
| `Swap(i, i)` | MUST be a no-op |
| Mutation during sort | Forbidden; results are undefined |

## 14. `sort` package functions

| Function | Signature | Notes |
|----------|-----------|-------|
| `Sort` | `Sort(data Interface)` | Unstable; pdqsort |
| `Stable` | `Stable(data Interface)` | Stable; merge-based |
| `IsSorted` | `IsSorted(data Interface) bool` | Linear scan |
| `Slice` | `Slice(x any, less func(i, j int) bool)` | Reflection; unstable |
| `SliceStable` | `SliceStable(x any, less func(i, j int) bool)` | Reflection; stable |
| `SliceIsSorted` | `SliceIsSorted(x any, less func(i, j int) bool) bool` | Reflection |
| `Search` | `Search(n int, f func(int) bool) int` | Boundary binary search |
| `SearchInts` | `SearchInts(a []int, x int) int` | Specialized |
| `SearchStrings` | `SearchStrings(a []string, x string) int` | Specialized |
| `SearchFloat64s` | `SearchFloat64s(a []float64, x float64) int` | Specialized |
| `Reverse` | `Reverse(data Interface) Interface` | Wrapper that flips `Less` |

| `sort.Search` aspect | Specification |
|----------------------|---------------|
| Precondition | `f` is monotonic: false then true as `i` increases |
| Return | Smallest `i` in `[0, n]` with `f(i) == true`; `n` if all false |
| Time | O(log n) |

## 15. Pre-Go-1.21 typed slice helpers

| Type | Methods |
|------|---------|
| `sort.IntSlice` | `Len`, `Less`, `Swap`, `Sort()`, `Search(x int) int` |
| `sort.Float64Slice` | `Len`, `Less`, `Swap`, `Sort()`, `Search(x float64) int` |
| `sort.StringSlice` | `Len`, `Less`, `Swap`, `Sort()`, `Search(x string) int` |

| Aspect | Specification |
|--------|---------------|
| Element ordering | Native `<` |
| `Float64Slice.Less` | Treats `NaN` as smaller than any non-`NaN` (matches `cmp.Compare`) |

## 16. Algorithmic complexity reference

| Operation | Time | Aux memory | Stable? |
|-----------|------|------------|---------|
| `slices.Sort` / `SortFunc` | O(n log n) worst, O(n) best | O(log n) stack | No |
| `slices.SortStableFunc` | O(n log n) | O(n) | Yes |
| `sort.Sort` | O(n log n) worst | O(log n) stack | No |
| `sort.Stable` | O(n log² n) worst | O(1) extra | Yes |
| `sort.Slice` | O(n log n) | reflection overhead | No |
| `slices.BinarySearch` / `sort.Search` | O(log n) | O(1) | n/a |
| `slices.Insert` | O(n + len(v)) | possibly one alloc | n/a |
| `slices.Delete` / `DeleteFunc` / `Compact` / `Reverse` / `Equal` | O(n) | 0 | n/a |
| `slices.Clone` | O(n) | one alloc of size n | n/a |
| `maps.Equal` / `Copy` / `DeleteFunc` | O(n) | 0 | n/a |
| `maps.Clone` | O(n) | one alloc, ~25–50% map overhead | n/a |

## 17. Float comparison semantics

| Operation | `<` operator | `cmp.Compare` |
|-----------|--------------|---------------|
| `NaN < 1.0` | false | true |
| `1.0 < NaN` | false | false |
| `NaN < NaN` | false | false |
| `NaN == NaN` | false | n/a (returns 0) |
| `-0.0 < 0.0` | false | false |
| `-0.0 == 0.0` | true | n/a (returns 0) |
| `-Inf < 1.0` | true | true |
| `1.0 < +Inf` | true | true |

`cmp.Compare` defines a strict weak order on all `float64` values,
including `NaN`. The native `<` does not.

## 18. Concurrency safety

| Operation | Concurrent reads | Concurrent writes | Mixed |
|-----------|------------------|-------------------|-------|
| `slices.Sort` etc. | n/a (in-place) | Not safe (writes the slice) | Not safe |
| `slices.BinarySearch` | Yes (read-only) | n/a | Not safe with concurrent writes |
| `slices.Equal` / `Index` | Yes (read-only) | n/a | Not safe with concurrent writes |
| `maps.Equal` | Yes (read-only) | n/a | Not safe with concurrent writes |
| `maps.Clone` | Yes (read-only on src) | Writes dst (its own) | n/a |
| `maps.Copy` | n/a | Writes dst | Reading dst races with `Copy` |
| `maps.DeleteFunc` | n/a | Writes m | Reading m races with `DeleteFunc` |

The package functions themselves are not synchronized — they require
external mutual exclusion (`sync.Mutex` or `sync.RWMutex`) for
concurrent access from multiple goroutines.

## 19. Error and panic conditions

| Condition | Result |
|-----------|--------|
| `slices.Min`/`Max`(`Func`) on empty | Panic |
| `slices.Insert` with `i > len(s)` | Panic |
| `slices.Delete`/`Replace` with bad indexes | Panic |
| `slices.Chunk` with `n <= 0` | Panic |
| `slices.Grow` with `n < 0` | Panic |
| `maps.Copy(nil, src)` | Panic (assignment to nil map) |
| Modifying slice during `slices.Sort*` | Undefined; no panic |
| Comparator violates strict weak order | Undefined output; no panic |
| Comparator panics during sort | Panic propagates; slice in partial state |

## 20. What to read next

- [senior.md](senior.md) — prose explanation of the contracts above.
- [find-bug.md](find-bug.md) — bugs that violate the entries here.
- [optimize.md](optimize.md) — performance trade-offs implied by the
  complexity table.
