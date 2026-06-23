# 8.16 `sort`, `slices`, `maps` — Find the Bug

> **Audience.** You've read [middle.md](middle.md) and
> [senior.md](senior.md), and you want to train your eye for the bugs
> that ship to production. Each snippet below is short, looks roughly
> right, and has at least one real bug from the contracts in earlier
> files. Find the bug, then read the analysis. The bugs are not
> visual — they're contractual.

## 1. The `<=` Less function

```go
type byScore []Item
func (s byScore) Len() int           { return len(s) }
func (s byScore) Less(i, j int) bool { return s[i].Score <= s[j].Score }
func (s byScore) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }

sort.Sort(byScore(items))
```

### Analysis

`Less` returns `<=` instead of `<`. The contract requires irreflexivity:
`Less(i, i)` must be false. With `<=`, `Less(i, i)` returns true (a
score is "less than or equal to" itself), and the algorithm misbehaves
— elements compare as both less than and equal to themselves
simultaneously.

The fix is the strict comparison:

```go
func (s byScore) Less(i, j int) bool { return s[i].Score < s[j].Score }
```

Or use `slices.SortFunc` with `cmp.Compare`, which is hard to get
wrong:

```go
slices.SortFunc(items, func(a, b Item) int {
    return cmp.Compare(a.Score, b.Score)
})
```

## 2. Floats with `NaN`

```go
scores := []float64{1.5, math.NaN(), 0.7, 2.3, math.NaN()}
slices.SortFunc(scores, func(a, b float64) int {
    if a < b { return -1 }
    if a > b { return 1 }
    return 0
})
fmt.Println(scores)
```

### Analysis

The custom comparator uses native `<` and `>`, which both return false
when either operand is `NaN`. Every comparison involving `NaN` returns
0 (the "equal" case), but `NaN` is not actually equal to anything,
including itself. The result violates equivalence transitivity, and
the sort produces a slice that is "sorted" by an inconsistent order —
output varies between runs.

The fix is `cmp.Compare`, which handles `NaN` by treating it as
smaller than every non-`NaN` value:

```go
slices.SortFunc(scores, cmp.Compare[float64])
// or simply:
slices.Sort(scores)
```

## 3. Binary search on unsorted slice

```go
func contains(s []int, x int) bool {
    _, found := slices.BinarySearch(s, x)
    return found
}
```

### Analysis

`BinarySearch` requires a sorted slice. The function here doesn't
sort, doesn't check, and trusts the caller. If `s` is unsorted, the
result is meaningless and silent.

The fix is either: sort before search (if you can mutate the slice),
or use `slices.Contains` for unsorted data:

```go
func contains(s []int, x int) bool {
    return slices.Contains(s, x)
}
```

`Contains` is `O(n)` but always correct.

## 4. `Delete` in a loop

```go
func removeEven(nums []int) []int {
    for i := 0; i < len(nums); i++ {
        if nums[i]%2 == 0 {
            nums = slices.Delete(nums, i, i+1)
        }
    }
    return nums
}
```

### Analysis

Two bugs. First, after `Delete`, the next element shifts into index
`i`, but the loop increments `i` and skips it. So `[2, 4, 5]` becomes
`[4, 5]` after one iteration, then `i=1` checks `5` (skipping `4`),
and we end with `[4, 5]` instead of `[5]`.

Second, `Delete` is `O(n)`, so this loop is `O(n²)`.

The fix is `slices.DeleteFunc`:

```go
func removeEven(nums []int) []int {
    return slices.DeleteFunc(nums, func(n int) bool {
        return n%2 == 0
    })
}
```

One pass, `O(n)`, no index gymnastics.

## 5. `slices.Equal` of two maps

```go
a := map[string]int{"x": 1, "y": 2}
b := map[string]int{"x": 1, "y": 2}
if slices.Equal(a, b) {
    fmt.Println("equal")
}
```

### Analysis

`slices.Equal` works on slices, not maps. This code does not compile —
which is the saving grace. But the same author often writes:

```go
if reflect.DeepEqual(a, b) { ... }
```

…which compiles, works, but allocates and is reflection-based. The
right tool for maps is `maps.Equal`:

```go
if maps.Equal(a, b) {
    fmt.Println("equal")
}
```

For maps with non-`comparable` value types, `maps.EqualFunc` takes an
equality function.

## 6. Capacity retention after slicing

```go
func loadFirst10(items []Item) []Item {
    sorted := slices.Clone(items)
    slices.SortFunc(sorted, func(a, b Item) int {
        return cmp.Compare(a.Score, b.Score)
    })
    return sorted[:10]
}
```

### Analysis

`sorted[:10]` has `len 10` but `cap == len(items)`. The backing array
keeps all items reachable, even the 990 we don't return. For `Item`
holding a pointer to a 1 MiB blob, this is a 990 MiB leak.

The fix is `slices.Clip` to release the unused tail:

```go
return slices.Clip(sorted[:10])
```

Or allocate fresh:

```go
out := make([]Item, 10)
copy(out, sorted[:10])
return out
```

Either way, the unused trailing capacity becomes collectable.

## 7. Map iteration order assumption

```go
func paramString(params map[string]string) string {
    var parts []string
    for k, v := range params {
        parts = append(parts, k+"="+v)
    }
    return strings.Join(parts, "&")
}
```

### Analysis

The output order varies between runs because map iteration is
randomized. If this string is used in a URL signature, a cache key,
or a deduplication hash, the same input produces different outputs
non-deterministically.

The fix is to sort the keys:

```go
func paramString(params map[string]string) string {
    keys := slices.Sorted(maps.Keys(params)) // Go 1.23+
    parts := make([]string, len(keys))
    for i, k := range keys {
        parts[i] = k + "=" + params[k]
    }
    return strings.Join(parts, "&")
}
```

For Go 1.21–1.22, replace with the explicit `for k := range params`
+ `slices.Sort(keys)` pattern.

## 8. Stable sort that didn't help

```go
slices.SortStableFunc(rows, func(a, b Row) int {
    if a.Score != b.Score {
        if a.Score < b.Score { return -1 }
        return 1
    }
    return 0
})
```

### Analysis

This works correctly, but the use of `SortStableFunc` here is wasted.
Stable sort is 2x slower than unstable; you pay for it only when the
input order has external meaning that you want preserved among equal
elements. If the caller's intent was just "sort by score, doesn't
matter what happens to ties," `slices.SortFunc` is fine.

If the caller's intent was "preserve previous ordering for equal
scores," the code as written does that — but only if `rows` was
sorted by the secondary key first. In isolation, `SortStableFunc`
preserves *insertion order* for equal keys.

The fix depends on intent. If you want a deterministic ordering for
ties, encode it as a tie-breaker key:

```go
slices.SortFunc(rows, func(a, b Row) int {
    if c := cmp.Compare(a.Score, b.Score); c != 0 {
        return c
    }
    return cmp.Compare(a.ID, b.ID)
})
```

## 9. Comparator that mutates state

```go
seen := map[int]int{}
slices.SortFunc(items, func(a, b Item) int {
    seen[a.ID]++
    seen[b.ID]++
    return cmp.Compare(a.Score, b.Score)
})
```

### Analysis

The comparator has side effects on a shared map. Two problems:

1. **Race condition** if `slices.SortFunc` ever runs the comparator
   on multiple goroutines (it doesn't today, but the contract doesn't
   forbid it).
2. **Reasoning failure**: the `seen` counts depend on the algorithm's
   internal traversal, which is not part of the public contract.
   Different sort algorithms call `Less` different numbers of times.
   For pdqsort on already-sorted input, the count is `O(n)`; on
   random input, it's `O(n log n)`. Code that depends on these counts
   breaks across Go versions.

The fix is to keep the comparator pure. If you need to instrument
sort calls, do it before or after, not inside.

## 10. `BinarySearch` with a different comparator than the sort used

```go
slices.SortFunc(rows, func(a, b Row) int {
    return cmp.Compare(a.Name, b.Name) // sorted by name
})

i, found := slices.BinarySearchFunc(rows, "alice", func(r Row, name string) int {
    return cmp.Compare(r.ID, name) // searches by ID!
})
```

### Analysis

The slice is sorted by `Name`, but the binary search compares by `ID`.
The result is undefined — `BinarySearch` assumes the slice is ordered
by the same predicate it's using. The output is meaningless and
silent.

The fix is to use the same comparator for both:

```go
slices.SortFunc(rows, func(a, b Row) int {
    return cmp.Compare(a.Name, b.Name)
})
i, found := slices.BinarySearchFunc(rows, "alice", func(r Row, target string) int {
    return cmp.Compare(r.Name, target)
})
```

## 11. `maps.Copy` to a nil map

```go
var defaults map[string]int
overrides := map[string]int{"x": 99}
maps.Copy(defaults, overrides) // panics
```

### Analysis

`defaults` is a nil map. `maps.Copy` writes into the destination via
`dst[k] = v`, which panics on a nil map. The error message is
`assignment to entry in nil map`.

The fix is to initialize the destination first:

```go
defaults := make(map[string]int)
maps.Copy(defaults, overrides)
```

Or, if the intent was "merge two maps into a new map":

```go
merged := maps.Clone(defaults)
maps.Copy(merged, overrides)
```

## 12. Modifying a slice during sort

```go
items := []*Item{ /* ... */ }
slices.SortFunc(items, func(a, b *Item) int {
    if a.IsExpired() {
        a.Score = 0
    }
    if b.IsExpired() {
        b.Score = 0
    }
    return cmp.Compare(a.Score, b.Score)
})
```

### Analysis

The comparator mutates the elements during sort. The algorithm calls
`Less(a, b)` on the same element multiple times, and the second call
sees a different score than the first. This violates the consistency
the algorithm relies on, and the output is undefined.

The fix is to normalize before sorting:

```go
for _, it := range items {
    if it.IsExpired() {
        it.Score = 0
    }
}
slices.SortFunc(items, func(a, b *Item) int {
    return cmp.Compare(a.Score, b.Score)
})
```

## 13. `slices.Clone` for "deep" copy

```go
type User struct {
    Name string
    Tags []string
}

users := []User{{Name: "Alice", Tags: []string{"admin"}}}
clone := slices.Clone(users)
clone[0].Tags[0] = "user"
fmt.Println(users[0].Tags[0]) // "user"!
```

### Analysis

`slices.Clone` is shallow. The `Tags` slice inside each `User` is
*shared* between original and clone — both `Tags` slices reference the
same backing array. Mutating one mutates the other.

The fix is to clone the inner slices:

```go
clone := slices.Clone(users)
for i := range clone {
    clone[i].Tags = slices.Clone(users[i].Tags)
}
```

Or write a deep-clone helper if the struct has many slice fields.

## 14. Empty input to `slices.Min`

```go
func minScore(scores []float64) float64 {
    return slices.Min(scores)
}

minScore(nil) // panics
```

### Analysis

`slices.Min` panics on an empty slice — the package documents this
behavior. Calling it without checking length is a bug whenever the
input might be empty (data from a database, user input, network).

The fix:

```go
func minScore(scores []float64) (float64, bool) {
    if len(scores) == 0 {
        return 0, false
    }
    return slices.Min(scores), true
}
```

Or accept a default:

```go
func minScoreOr(scores []float64, def float64) float64 {
    if len(scores) == 0 {
        return def
    }
    return slices.Min(scores)
}
```

## 15. Comparator with the wrong sign

```go
// Intended: descending by score
slices.SortFunc(rows, func(a, b Row) int {
    return cmp.Compare(a.Score, b.Score)
})
```

### Analysis

This sorts ascending. To sort descending, swap the arguments:

```go
slices.SortFunc(rows, func(a, b Row) int {
    return cmp.Compare(b.Score, a.Score) // swap a and b
})
```

Or sort ascending and call `slices.Reverse`. Both work; the swap is
faster (one pass instead of two).

The bug here is conceptual: the author intended descending but wrote
ascending. The fix is two characters.

## 16. `range` over `for k := range maps.Keys(m)` in older Go

```go
for k := range maps.Keys(m) {
    fmt.Println(k)
}
```

### Analysis

In Go 1.21–1.22, `maps.Keys(m)` returned `[]string`. The code above
ranges over a slice, which gives `(index, value)`. Using `for k :=
range` binds `k` to the *index* (an `int`), not the key. So `k` is
0, 1, 2, … and the output is integers, not the map's keys.

In Go 1.23+, `maps.Keys` returns an `iter.Seq[K]`, and `for k := range
maps.Keys(m)` correctly binds `k` to each key.

The fix on pre-1.23 Go is to use the slice form correctly:

```go
for _, k := range maps.Keys(m) {
    fmt.Println(k)
}
```

Or, version-portable:

```go
for k := range m {
    fmt.Println(k)
}
```

## 17. `slices.Insert` in a loop

```go
sorted := []int{}
for _, v := range input {
    i, _ := slices.BinarySearch(sorted, v)
    sorted = slices.Insert(sorted, i, v)
}
```

### Analysis

This builds a sorted slice incrementally. Each `Insert` is `O(n)`, and
we do it `n` times — total `O(n²)`. For 100k elements, that's 10
billion operations.

The fix is to sort once at the end:

```go
sorted := slices.Clone(input)
slices.Sort(sorted)
```

`O(n log n)` instead of `O(n²)`. For 100k elements, the speedup is
~6000x.

## 18. Trusting `slices.Compact` for full dedupe

```go
items := []int{3, 1, 2, 1, 3, 2}
items = slices.Compact(items)
// expected: [1, 2, 3]; got: [3, 1, 2, 1, 3, 2]
```

### Analysis

`Compact` only collapses *adjacent* duplicates. For full
deduplication, sort first:

```go
slices.Sort(items)
items = slices.Compact(items)
// [1, 2, 3]
```

Or, if you need to preserve insertion order:

```go
seen := make(map[int]struct{}, len(items))
out := make([]int, 0, len(items))
for _, v := range items {
    if _, dup := seen[v]; dup {
        continue
    }
    seen[v] = struct{}{}
    out = append(out, v)
}
items = out
```

## 19. `cmp.Compare` on times

```go
type Event struct {
    At time.Time
}

events := []Event{ /* ... */ }
slices.SortFunc(events, func(a, b Event) int {
    return cmp.Compare(a.At, b.At) // does not compile
})
```

### Analysis

`cmp.Compare` requires `cmp.Ordered`, which excludes structs.
`time.Time` is a struct. The code does not compile.

The fix is to use `time.Time.Compare` (Go 1.20+):

```go
slices.SortFunc(events, func(a, b Event) int {
    return a.At.Compare(b.At)
})
```

Or call `.Unix()` (loses sub-second precision) and compare those:

```go
slices.SortFunc(events, func(a, b Event) int {
    return cmp.Compare(a.At.UnixNano(), b.At.UnixNano())
})
```

`UnixNano` overflows for dates outside ~1678..2262, so prefer
`time.Time.Compare`. Cross-link:
[`../03-time/middle.md`](../03-time/middle.md).

## 20. Forgetting that `maps.DeleteFunc` is in-place

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
filtered := maps.DeleteFunc(m, func(k string, v int) bool { // does not compile
    return v < 2
})
```

### Analysis

`maps.DeleteFunc` returns nothing — it modifies the map in place.
Trying to use its return value is a compile error.

The fix is to call it for its side effect:

```go
maps.DeleteFunc(m, func(k string, v int) bool {
    return v < 2
})
// m is now {"b": 2, "c": 3}
```

If you need to keep the original intact, clone first:

```go
filtered := maps.Clone(m)
maps.DeleteFunc(filtered, func(k string, v int) bool {
    return v < 2
})
```

## 21. Sorting then storing the slice in a goroutine

```go
go func() {
    slices.Sort(shared)
    log.Println(shared)
}()
slices.Reverse(shared) // race
```

### Analysis

Two goroutines mutate the same slice with no synchronization. Even
though both operations are "safe" individually, running them
concurrently is a data race. `go test -race` catches it.

The fix is one of:

1. Don't share — give each goroutine its own copy.
2. Synchronize with `sync.Mutex` around the slice.
3. Pass the result through a channel.

## 22. `slices.BinarySearch` on a slice sorted descending

```go
items := []int{9, 7, 5, 3, 1}
i, found := slices.BinarySearch(items, 5) // wrong: assumes ascending
```

### Analysis

`slices.BinarySearch` assumes ascending order. The fix is
`BinarySearchFunc` with a reversed comparator, or simpler: sort
ascending in the first place.

```go
i, found := slices.BinarySearchFunc(items, 5, func(item, target int) int {
    return cmp.Compare(target, item) // reversed
})
```
