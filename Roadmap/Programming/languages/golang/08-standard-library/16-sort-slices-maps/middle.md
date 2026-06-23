# 8.16 `sort`, `slices`, `maps` — Middle

> **Audience.** You've internalized [junior.md](junior.md) and you write
> production code that sorts, dedupes, and walks slices and maps daily.
> This file covers the legacy `sort.Interface`, multi-key comparators,
> the `cmp` package, the rules for a valid `Less`, and the Go 1.23
> iterator transition for `maps` and `slices`.

## 1. The legacy `sort.Interface`

Before generics, sorting required implementing three methods:

```go
type Interface interface {
    Len() int
    Less(i, j int) bool
    Swap(i, j int)
}
```

You implement these on a wrapper type, then call `sort.Sort` on a value
of that type. The classic example:

```go
type byAge []User

func (s byAge) Len() int           { return len(s) }
func (s byAge) Less(i, j int) bool { return s[i].Age < s[j].Age }
func (s byAge) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }

sort.Sort(byAge(users))
```

This still works. It is verbose. In 2026, write it only when:

1. You're sorting something that is *not* a slice (a custom container,
   a memory-mapped file, an external cursor). `sort.Sort` works on
   anything that satisfies `Interface`.
2. You're working in a codebase that already does it this way and
   migration is out of scope.
3. You need to plug into an API that takes `sort.Interface` (some
   library functions still do).

For sorting actual slices, `slices.SortFunc` does the same job in one
line and avoids the type wrapper.

## 2. `sort.Slice` and `sort.SliceStable`

The bridge between the old and new worlds:

```go
sort.Slice(users, func(i, j int) bool {
    return users[i].Age < users[j].Age
})
```

`sort.Slice` takes a slice (typed as `any`) and a less function on
indexes. Internally, it uses reflection to swap elements, which makes
it slower than `slices.SortFunc` by 20–40% on small structs.

| Function | Generic? | Compares | Stable? |
|----------|----------|----------|---------|
| `sort.Sort` | No | `Interface.Less` | No |
| `sort.Stable` | No | `Interface.Less` | Yes |
| `sort.Slice` | No (reflection) | index-based less | No |
| `sort.SliceStable` | No (reflection) | index-based less | Yes |
| `slices.Sort` | Yes | `cmp.Ordered` | No |
| `slices.SortFunc` | Yes | `func(a, b T) int` | No |
| `slices.SortStableFunc` | Yes | `func(a, b T) int` | Yes |

In new code, `slices.SortFunc` replaces both `sort.Slice` and the
manual `sort.Interface` for the slice case.

## 3. Less function vs three-way compare

The two APIs differ in a small but real way:

```go
// sort.Slice / sort.Interface: a "less than" predicate
less := func(i, j int) bool { return s[i].Age < s[j].Age }

// slices.SortFunc: a three-way comparator (returns negative/zero/positive)
cmp := func(a, b User) int { return cmp.Compare(a.Age, b.Age) }
```

The three-way form gives the algorithm more information: knowing two
elements are *equal* lets it skip work, and `pdqsort` exploits that
during partitioning. In practice the difference is small, but
`SortFunc` is never slower than `Slice` and is often a few percent
faster.

A `Less` can always be derived from a `Compare`:

```go
less := func(i, j int) bool { return cmp(s[i], s[j]) < 0 }
```

The reverse is messier — you'd evaluate `Less` twice to determine
equality — which is why `Compare` is the better primitive when you
have the choice.

## 4. The `cmp` package

`cmp` is a tiny package that ships the helpers `slices.SortFunc` was
designed around:

```go
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64 | ~string
}

func Compare[T Ordered](x, y T) int
func Less[T Ordered](x, y T) bool
func Or[T comparable](vals ...T) T
```

`cmp.Compare(x, y)` returns -1 / 0 / +1 with one important detail: for
floats, `NaN` is treated as **less than every other value**, including
itself. `cmp.Compare(math.NaN(), 1.0)` returns -1, and
`cmp.Compare(1.0, math.NaN())` returns +1. The native `<` operator
gives `false` in both directions for `NaN` — a contradiction that
breaks any sort. `cmp.Compare` resolves the contradiction by sorting
`NaN` to the front.

`cmp.Less(x, y)` is the predicate form: `Compare(x, y) < 0`.

`cmp.Or(vals...)` returns the first non-zero value of its arguments —
useful for default-fallback patterns:

```go
limit := cmp.Or(userLimit, configLimit, 100)
```

It is unrelated to sorting but lives in the same package because
`comparable` and `Ordered` constraints are spiritually adjacent.

## 5. Multi-key comparators

A correct multi-key comparator falls through to the next key when the
previous key is equal:

```go
slices.SortFunc(users, func(a, b User) int {
    if c := cmp.Compare(a.LastName, b.LastName); c != 0 {
        return c
    }
    if c := cmp.Compare(a.FirstName, b.FirstName); c != 0 {
        return c
    }
    return cmp.Compare(a.Age, b.Age)
})
```

The pattern: walk the keys in priority order, return the first
nonzero result. The final key returns its comparison directly.

Mix ascending and descending across keys by swapping argument order in
the descending step:

```go
// Last name ascending, age descending
slices.SortFunc(users, func(a, b User) int {
    if c := cmp.Compare(a.LastName, b.LastName); c != 0 {
        return c
    }
    return cmp.Compare(b.Age, a.Age) // swap → descending
})
```

For five or more keys, building a slice of comparators and combining
them programmatically is sometimes cleaner. There is no stdlib helper
for that; it's a five-line loop.

## 6. The rules for a valid `Less`

`sort.Sort`, `slices.SortFunc`, and friends require a *strict weak
ordering*. In plain English:

1. **Irreflexive.** `Less(x, x)` must be false (or `Compare(x, x)` must
   be zero).
2. **Asymmetric.** If `Less(x, y)`, then `Less(y, x)` must be false.
3. **Transitive.** If `Less(x, y)` and `Less(y, z)`, then `Less(x, z)`.
4. **Transitive equivalence.** If `!Less(x, y) && !Less(y, x)` and
   `!Less(y, z) && !Less(z, y)`, then `!Less(x, z) && !Less(z, x)`.

Break any of these and the algorithm produces undefined output — not
a panic, not a sentinel error, just a wrongly-ordered slice. The
classic offender is `Less` returning `<=` instead of `<`:

```go
// WRONG
func less(a, b User) bool { return a.Age <= b.Age }
```

This violates irreflexivity (`less(x, x)` is true) and the algorithm
will misbehave. The fix is the strict comparison:

```go
func less(a, b User) bool { return a.Age < b.Age }
```

For floats, `NaN` violates rule 4: `NaN < x` and `x < NaN` are both
false, so `NaN` and `x` are "equivalent" — but `NaN` is also
"equivalent" to *every* `x`, which makes everything mutually
equivalent, which is wrong. `cmp.Compare` resolves this by treating
`NaN` as smallest; `<` does not.

## 7. The "less than" trap with structs

```go
type Item struct {
    Score float64
    Name  string
}

slices.SortFunc(items, func(a, b Item) int {
    return cmp.Compare(a.Score, b.Score)
})
```

Two items with the same score have an undefined relative order under
unstable sort. If you want a tie-breaker, add it explicitly:

```go
slices.SortFunc(items, func(a, b Item) int {
    if c := cmp.Compare(a.Score, b.Score); c != 0 {
        return c
    }
    return cmp.Compare(a.Name, b.Name)
})
```

When the natural tie-breaker is "input order", `slices.SortStableFunc`
gives that for free. When you need a *specific* tie-breaker (alphabetic
name, last-modified time), an explicit second key is faster than the
stable variant.

## 8. Stability cost

Stability is not free. `slices.Sort` and `slices.SortFunc` use
`pdqsort` and operate in `O(n log n)` time with `O(log n)` stack
space. `slices.SortStableFunc` uses an internal stable sort that needs
`O(n)` extra memory and is consistently 2x slower on randomized data.

The decision tree:

- All keys unique → unstable. Stability has nothing to preserve.
- You can express the tie-breaker as a comparator → unstable, with the
  tie-breaker baked in.
- Order of equal elements has external meaning ("preserve insertion
  order", "preserve previous sort") and you cannot express it as a key
  → stable.

## 9. `sort.Search` — binary search the legacy way

```go
nums := []int{1, 3, 5, 7, 9}
i := sort.Search(len(nums), func(i int) bool {
    return nums[i] >= 5
})
fmt.Println(i, nums[i]) // 2, 5
```

`sort.Search` does not directly search for a value — it finds the
smallest index for which a predicate is true. The predicate must be
monotonic: false for the first `k` indexes, then true for the rest.

This is more general than `slices.BinarySearch`. You can search for
"first index with timestamp > T" or "first failing test in a CI
sequence":

```go
firstFailing := sort.Search(len(builds), func(i int) bool {
    return !builds[i].Passed
})
```

When the predicate is "is this element >= target", `sort.Search` and
`slices.BinarySearch` solve the same problem. `slices.BinarySearch`
returns a `(index, found)` pair, which is friendlier; `sort.Search`
just returns the index, and you check `i < len && s[i] == target`
manually.

For sorted slices in new code, prefer `slices.BinarySearch` /
`slices.BinarySearchFunc`. `sort.Search` shines for "find the
boundary in a monotonic predicate" use cases.

## 10. `sort.IntSlice`, `sort.StringSlice`, `sort.Float64Slice`

These are pre-Go 1.21 wrappers that implement `sort.Interface` for
`[]int`, `[]string`, `[]float64`:

```go
nums := []int{5, 2, 4, 1, 3}
sort.IntSlice(nums).Sort()
sort.IntSlice(nums).Search(3) // binary search

// Equivalent old-style:
sort.Sort(sort.IntSlice(nums))
sort.Sort(sort.Reverse(sort.IntSlice(nums))) // descending
```

`sort.Reverse` is a wrapper that flips `Less(i, j)` to `Less(j, i)`.
It works on any `sort.Interface`. With `slices`, you achieve the same
by swapping the comparator arguments — same effect, simpler syntax.

In new code, you almost never write `sort.IntSlice` by name. The
exception is when a function takes `sort.Interface` and you need a
ready-made one for `[]int`.

## 11. The Go 1.23 iterator transition

In Go 1.21–1.22, `maps.Keys` and `maps.Values` returned slices:

```go
// Go 1.21–1.22 signature:
func Keys[K comparable, V any](m map[K]V) []K
```

In Go 1.23 they were re-typed to return `iter.Seq[K]` / `iter.Seq[V]`:

```go
// Go 1.23+:
func Keys[K comparable, V any](m map[K]V) iter.Seq[K]
```

The change broke code that did `keys := maps.Keys(m); slices.Sort(keys)`,
because `iter.Seq` is not a slice. The fix is `slices.Sorted` (also
new in 1.23):

```go
keys := slices.Sorted(maps.Keys(m)) // []K, sorted
```

Or, if you need the slice without sorting:

```go
keys := slices.Collect(maps.Keys(m))
```

`slices.Collect[T](iter.Seq[T])` materializes the iterator into a
fresh slice. `slices.Sorted` does the same plus sorts it.

For the `slices` side:

| Function | Returns | Since |
|----------|---------|-------|
| `slices.All(s)` | `iter.Seq2[int, T]` (index, value) | 1.23 |
| `slices.Values(s)` | `iter.Seq[T]` | 1.23 |
| `slices.Backward(s)` | `iter.Seq2[int, T]` (reverse) | 1.23 |
| `slices.Sorted(it)` | `[]T` (sorted) | 1.23 |
| `slices.SortedFunc(it, cmp)` | `[]T` (sorted by `cmp`) | 1.23 |
| `slices.Collect(it)` | `[]T` | 1.23 |

```go
// Go 1.23: range over an iterator
for i, v := range slices.All(nums) {
    fmt.Println(i, v)
}

// Iterate in reverse without mutating:
for i, v := range slices.Backward(nums) {
    fmt.Println(i, v)
}
```

The `iter.Seq[T]` type is `func(yield func(T) bool)`. Range-over-func
is the syntax that consumes it. Code targeting Go 1.21 or 1.22 cannot
use these — pin those file's examples on the slice-returning forms.

## 12. `slices.Insert` and the cost of shifting

```go
nums := []int{1, 2, 4, 5}
nums = slices.Insert(nums, 2, 3) // [1 2 3 4 5]
```

`Insert` shifts `len(s) - i` elements right. Calling it `n` times in a
loop is `O(n²)`. The right way to build a sorted slice from a stream
is one of:

1. Append everything, sort once. `O(n log n)` total. Use this when the
   stream is bounded.
2. Use a `container/heap` for a streaming top-K. The heap maintains
   order incrementally in `O(log n)` per insertion.
3. Use a sorted data structure from a third-party package (red-black
   tree, B-tree). Stdlib has none.

`slices.Insert` is for the *occasional* insert into a known-sorted
slice. If your code does this in a loop, rewrite.

## 13. `slices.Replace`

```go
nums := []int{1, 2, 3, 4, 5}
nums = slices.Replace(nums, 1, 4, 10, 20, 30, 40) // replace [2,3,4] with [10,20,30,40]
// [1 10 20 30 40 5]
```

`slices.Replace(s, i, j, vs...)` replaces `s[i:j]` with the new values.
The result length changes if `j-i` differs from `len(vs)`. Equivalent
to `Delete` then `Insert`, but does both in one allocation when the
backing array has capacity.

Use it for splice operations: replacing a substring of a slice with a
different-length one.

## 14. `slices.Compare` and `slices.CompareFunc`

Lexicographic comparison of two slices:

```go
slices.Compare([]int{1, 2, 3}, []int{1, 2, 4})  // -1
slices.Compare([]int{1, 2}, []int{1, 2})         //  0
slices.Compare([]int{1, 2, 3}, []int{1, 2})      //  1 (longer wins after a tie)
```

It compares element by element under `cmp.Compare`. When one slice is
a prefix of the other, the shorter one is smaller. Use it for sorting
slices of slices, or for stable cursor comparison.

`slices.CompareFunc(a, b, cmpFn)` lets you supply the comparator —
needed for non-`Ordered` element types.

## 15. `slices.Grow` and `slices.Clip`

Capacity management:

```go
s := make([]int, 0, 4)
s = slices.Grow(s, 100)  // ensure room for 100 more elements
fmt.Println(cap(s))      // >= 104
```

`slices.Grow(s, n)` returns a slice with the same length but capacity
big enough for `n` more appends. It allocates only if necessary —
no-op if `cap(s) - len(s) >= n`.

```go
s = slices.Clip(s) // shrink cap to len, freeing the tail
```

`slices.Clip` is the opposite: it returns `s[:len(s):len(s)]`, which
forces any future `append` to allocate fresh and prevents the slice
from holding on to a large backing array. Useful when a slice was
sized generously, then trimmed:

```go
buf := make([]byte, 0, 1<<20) // 1 MiB
n := readInto(buf)
buf = buf[:n]
buf = slices.Clip(buf) // release the rest
```

Without `Clip`, the backing 1 MiB array stays referenced by `buf`
even though we only use the first `n` bytes.

## 16. `slices.Chunk` (Go 1.23+)

Iterate a slice in fixed-size chunks:

```go
for chunk := range slices.Chunk(items, 100) {
    process(chunk)
}
```

`slices.Chunk(s, n)` returns an `iter.Seq[[]T]` that yields successive
sub-slices of length `n` (the last chunk may be shorter). Each yielded
chunk shares the original backing array — do not retain or mutate it
across iterations.

For Go 1.22 and earlier, write the loop manually:

```go
for i := 0; i < len(items); i += chunkSize {
    end := i + chunkSize
    if end > len(items) {
        end = len(items)
    }
    process(items[i:end])
}
```

## 17. The map iteration randomization

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
for k := range m {
    fmt.Println(k)
}
```

The Go runtime randomizes the starting hash bucket for each `range`,
so the iteration order is unstable across runs *and* across iterations
within the same run. Two `for range m` loops in a row may produce
different orders.

This is intentional. Code that relies on iteration order tends to
break when the map grows or shrinks (rehash) or when the map type is
swapped. The randomization makes the bug visible early.

For deterministic output, sort the keys:

```go
keys := slices.Sorted(maps.Keys(m)) // Go 1.23+
for _, k := range keys {
    fmt.Println(k, m[k])
}
```

Pre-1.23:

```go
keys := make([]string, 0, len(m))
for k := range m {
    keys = append(keys, k)
}
slices.Sort(keys)
for _, k := range keys {
    fmt.Println(k, m[k])
}
```

## 18. `maps.All`, `maps.Keys`, `maps.Values` in 1.23

```go
// Go 1.23+:
for k, v := range maps.All(m) {
    fmt.Println(k, v)
}
for k := range maps.Keys(m) {
    fmt.Println(k)
}
for v := range maps.Values(m) {
    fmt.Println(v)
}
```

`maps.All(m)` is an `iter.Seq2[K, V]`. `range` over it gives the same
pairs as `range m`, in the same random order. The win is composability:
you can pass `maps.Keys(m)` to `slices.Sorted` and get a sorted slice
in one expression.

## 19. Sorting times

`time.Time.Compare` (Go 1.20+) returns -1 / 0 / 1 — the same shape
as `cmp.Compare`:

```go
slices.SortFunc(events, func(a, b Event) int {
    return a.At.Compare(b.At)
})
```

It compares wall instants; monotonic clock readings are ignored.
Cross-link: [`../03-time/middle.md`](../03-time/middle.md).

## 20. Migration: old `sort` code → `slices`

Common rewrites:

```go
// Old
sort.Ints(nums)
sort.Strings(names)
sort.Float64s(scores)

// New
slices.Sort(nums)
slices.Sort(names)
slices.Sort(scores)
```

```go
// Old
sort.Slice(users, func(i, j int) bool {
    return users[i].Age < users[j].Age
})

// New
slices.SortFunc(users, func(a, b User) int {
    return cmp.Compare(a.Age, b.Age)
})
```

```go
// Old
sort.Sort(sort.Reverse(sort.IntSlice(nums)))

// New
slices.Sort(nums)
slices.Reverse(nums)
// or: slices.SortFunc(nums, func(a, b int) int { return cmp.Compare(b, a) })
```

```go
// Old
i := sort.SearchInts(sortedNums, target)
if i < len(sortedNums) && sortedNums[i] == target {
    // found
}

// New
i, found := slices.BinarySearch(sortedNums, target)
```

The migration is typically mechanical — gopls offers a quick-fix
rewrite. The exception is `sort.Interface` implementations on custom
types. Those stay until the entire surrounding API is rewritten.

## 21. Putting it together: indexing a slice with a map

A common pattern: turn a slice into a map keyed by some field, for
O(1) lookup:

```go
byID := make(map[string]User, len(users))
for _, u := range users {
    byID[u.ID] = u
}
```

If two users have the same ID, the last one wins — the map silently
overwrites. To detect collisions:

```go
byID := make(map[string]User, len(users))
for _, u := range users {
    if _, dup := byID[u.ID]; dup {
        return fmt.Errorf("duplicate id %q", u.ID)
    }
    byID[u.ID] = u
}
```

Or, with `maps.Copy` for "merge slices into a map":

```go
prefs := maps.Clone(defaults) // start with defaults
maps.Copy(prefs, override)    // override wins on key collision
```

## 22. Putting it together: stable group-by

Group items by a key, preserving input order within each group:

```go
func groupBy[T any, K comparable](items []T, key func(T) K) map[K][]T {
    out := make(map[K][]T)
    for _, it := range items {
        k := key(it)
        out[k] = append(out[k], it)
    }
    return out
}

groups := groupBy(users, func(u User) string { return u.Department })
```

Each group is a slice in `append` order, which is the input order
(stable within group). The map iteration order across groups is
random, of course.

## 23. What to read next

- [senior.md](senior.md) — exact contracts for `pdqsort`, the
  worst-case behaviors of `BinarySearch`, allocator details for
  `Compact`/`Insert`/`Delete`.
- [professional.md](professional.md) — measured performance of
  `SortFunc` vs `Sort` vs `sort.Slice`, batching strategies, parallel
  sort patterns.
- [find-bug.md](find-bug.md) — broken comparators, aliasing bugs after
  `Delete`, off-by-one in `BinarySearch`.
