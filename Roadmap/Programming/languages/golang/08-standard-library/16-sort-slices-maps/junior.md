# 8.16 `sort`, `slices`, `maps` — Junior

> **Audience.** You can write a `for` loop and you've sorted something
> with `sort.Slice` once. By the end of this file you will know which
> package to reach for in 2026, the dozen functions that cover almost
> every real-world need, and the patterns that turn into the bulk of
> production Go.

## 1. Three packages, one mental model

Until Go 1.21, the only sort API in the standard library was `sort`. It
predates generics, so it works through an interface. In Go 1.21 the
`slices` and `maps` packages landed, both fully generic, and they
swallowed most of the everyday work.

| Package | Since | Use it for |
|---------|-------|------------|
| `sort` | Go 1 | Custom data structures, legacy code, stable sorts where you already implement `Less` |
| `slices` | Go 1.21 | Sorting, searching, mutating any `[]T` |
| `maps` | Go 1.21 | Cloning, comparing, iterating any `map[K]V` |
| `cmp` | Go 1.21 | The `Ordered` constraint and `Compare`/`Less` helpers used by `slices` |

In new code, **start with `slices` and `maps`**. Drop down to `sort`
only when the data is not a slice (a custom container, a database
cursor, anything where you can't expose `[]T`).

## 2. Sorting a slice in place

```go
package main

import (
    "fmt"
    "slices"
)

func main() {
    nums := []int{5, 2, 4, 1, 3}
    slices.Sort(nums)
    fmt.Println(nums) // [1 2 3 4 5]

    names := []string{"charlie", "alice", "bob"}
    slices.Sort(names)
    fmt.Println(names) // [alice bob charlie]
}
```

`slices.Sort` works on any slice whose element type satisfies
`cmp.Ordered`: integers, floats, strings. It sorts in place and returns
nothing. The algorithm is pattern-defeating quicksort: `O(n log n)` on
random data and `O(n)` on already-sorted input.

For floats, beware: `cmp.Ordered` allows `NaN`, but `slices.Sort` does
not give a meaningful result when `NaN` is present. We come back to
this in [middle.md](middle.md).

## 3. Sorting by a derived key: `slices.SortFunc`

Most real data is a slice of structs, sorted by a field:

```go
type User struct {
    Name string
    Age  int
}

users := []User{
    {"Alice", 30},
    {"Bob", 25},
    {"Carol", 27},
}

slices.SortFunc(users, func(a, b User) int {
    return cmp.Compare(a.Age, b.Age)
})
// users[0].Age == 25, users[1].Age == 27, users[2].Age == 30
```

The comparator returns:

- a negative number if `a` should come before `b`
- zero if they are equal
- a positive number if `a` should come after `b`

`cmp.Compare(x, y)` does this for any `Ordered` value. You almost never
write `<`/`>` by hand inside a comparator — `cmp.Compare` is faster to
type, handles edge cases, and reads better.

Sort by name then by age (multi-key):

```go
slices.SortFunc(users, func(a, b User) int {
    if c := cmp.Compare(a.Name, b.Name); c != 0 {
        return c
    }
    return cmp.Compare(a.Age, b.Age)
})
```

Reverse order: swap the arguments to `cmp.Compare`.

```go
slices.SortFunc(users, func(a, b User) int {
    return cmp.Compare(b.Age, a.Age) // descending
})
```

Or sort ascending and call `slices.Reverse` afterwards. Both work; the
swap is faster.

## 4. Stable sort: `slices.SortStableFunc`

A *stable* sort preserves the relative order of elements that compare
equal. `slices.Sort` and `slices.SortFunc` are NOT stable. If you sort
by age and two users have the same age, the order between them is
unpredictable.

```go
slices.SortStableFunc(users, func(a, b User) int {
    return cmp.Compare(a.Age, b.Age)
})
```

Use stable sort when:

- The input was already sorted by a secondary key and you want to
  preserve that order as a tie-breaker.
- The user can see the order and "random rearrangement of equals"
  would be visible weirdness (e.g., a paginated list).

Stable sort is slightly slower and uses extra memory. For unique keys
or when ties don't matter, the unstable version is preferred.

## 5. Searching a sorted slice: `slices.BinarySearch`

```go
nums := []int{1, 3, 5, 7, 9}
i, found := slices.BinarySearch(nums, 5)
fmt.Println(i, found) // 2 true

i, found = slices.BinarySearch(nums, 4)
fmt.Println(i, found) // 2 false  (would be inserted at index 2)
```

`BinarySearch` returns:

1. The index where the value is, or where it would be inserted.
2. A bool indicating whether the exact value was found.

The slice **must already be sorted**. Calling `BinarySearch` on an
unsorted slice gives meaningless results — and there's no runtime check.

For custom types, use `slices.BinarySearchFunc`:

```go
i, found := slices.BinarySearchFunc(users, 27, func(u User, age int) int {
    return cmp.Compare(u.Age, age)
})
```

The comparator returns negative/zero/positive comparing the *element*
to the *target*. The slice must be sorted by the same comparator.

Use `BinarySearch` when you read the same sorted slice many times. For
one-off searches on small slices, `slices.Index` (linear scan) is
simpler and often faster up to a few hundred elements.

## 6. Linear search: `slices.Contains` and `slices.Index`

```go
slices.Contains(nums, 5)            // true
slices.Index(nums, 5)               // 2 (or -1 if absent)
slices.IndexFunc(users, func(u User) bool {
    return u.Name == "Bob"
})
slices.ContainsFunc(users, func(u User) bool {
    return u.Age > 30
})
```

`Contains` is O(n). For small slices, this is faster than building a
map. For repeated lookups on a stable set, build a `map[K]struct{}`
once and check membership in O(1).

```go
allowed := map[string]struct{}{"a": {}, "b": {}, "c": {}}
if _, ok := allowed[name]; ok {
    // ...
}
```

The `struct{}{}` sentinel value occupies zero bytes — the map is just
a set. Use this pattern any time you mean "is this in the collection?"
and you'd otherwise call `Contains` in a loop.

## 7. Equality: `slices.Equal`

```go
a := []int{1, 2, 3}
b := []int{1, 2, 3}
slices.Equal(a, b) // true
```

`slices.Equal` checks length and element-wise equality with `==`. For
custom types that don't support `==` (slices, maps, functions), use
`slices.EqualFunc`:

```go
slices.EqualFunc(users, others, func(a, b User) bool {
    return a.Name == b.Name && a.Age == b.Age
})
```

Note: `slices.Equal` works on slices, not arrays. For arrays, `==`
already does the same thing. For maps, use `maps.Equal`.

## 8. Min and max

```go
nums := []int{3, 1, 4, 1, 5, 9, 2, 6}
slices.Min(nums) // 1
slices.Max(nums) // 9
```

Both panic if the slice is empty — this is a deliberate API choice,
because there is no sensible "minimum of nothing." Check `len(nums) > 0`
first if the input might be empty.

For custom types:

```go
youngest := slices.MinFunc(users, func(a, b User) int {
    return cmp.Compare(a.Age, b.Age)
})
oldest := slices.MaxFunc(users, func(a, b User) int {
    return cmp.Compare(a.Age, b.Age)
})
```

`MinFunc`/`MaxFunc` return the actual element, not the index — handy
for "find the user with the largest score."

## 9. Inserting and deleting: `slices.Insert` and `slices.Delete`

```go
nums := []int{1, 2, 4, 5}
nums = slices.Insert(nums, 2, 3) // insert 3 at index 2
// [1 2 3 4 5]
```

`slices.Insert(s, i, vs...)` returns a new slice with `vs` inserted
starting at position `i`. The underlying array may be reused if there
is capacity, or a new one allocated.

```go
nums := []int{1, 2, 3, 4, 5}
nums = slices.Delete(nums, 1, 3) // delete indices 1..3 (exclusive end)
// [1 4 5]
```

`slices.Delete(s, i, j)` returns a new slice with elements `s[i:j]`
removed. Like `Insert`, it shifts the tail down and may reuse the
backing array.

**Two warnings.**

1. Both `Insert` and `Delete` are **O(n)** because they shift bytes.
   Calling them in a loop on a long slice is `O(n²)`. If you need to
   delete many items, use `slices.DeleteFunc` (covered next), or
   filter into a new slice in one pass.
2. After `Delete`, the trailing slots that got "cleared" hold the
   *old* values for a beat — Go 1.22+ explicitly zeroes them, so
   pointers are not retained, but earlier versions did not. If you
   target Go 1.21, zero them yourself if the elements are pointers.

## 10. Filtering: `slices.DeleteFunc`

The right way to remove all elements matching a predicate:

```go
nums := []int{1, 2, 3, 4, 5, 6}
nums = slices.DeleteFunc(nums, func(n int) bool {
    return n%2 == 0 // delete even numbers
})
// [1 3 5]
```

`DeleteFunc` walks the slice once, copying surviving elements into the
front, and returns the truncated slice. It is **O(n)** for any number
of deletions — never call `Delete` in a loop when `DeleteFunc` will do.

```go
// WRONG: O(n²) and shifts the slice you're iterating over
for i := len(nums) - 1; i >= 0; i-- {
    if nums[i]%2 == 0 {
        nums = slices.Delete(nums, i, i+1)
    }
}

// RIGHT: O(n)
nums = slices.DeleteFunc(nums, func(n int) bool { return n%2 == 0 })
```

## 11. Reversing and concatenating

```go
nums := []int{1, 2, 3}
slices.Reverse(nums)
// [3 2 1]
```

`Reverse` operates in place. It works on any slice.

```go
combined := slices.Concat([]int{1, 2}, []int{3, 4}, []int{5}) // Go 1.22+
// [1 2 3 4 5]
```

`slices.Concat` allocates a new slice big enough for all inputs and
copies them in. It pre-computes the total length, so it allocates
exactly once — better than repeated `append`. Available from Go 1.22.

## 12. Removing duplicates: `slices.Compact`

`Compact` removes *consecutive* equal elements, in place:

```go
nums := []int{1, 1, 2, 2, 2, 3, 1, 1}
nums = slices.Compact(nums)
// [1 2 3 1]
```

Note the trailing `1` — `Compact` only collapses runs. To dedupe a
slice fully, sort first:

```go
slices.Sort(nums)
nums = slices.Compact(nums)
// [1 2 3]
```

For non-`Ordered` types, `slices.CompactFunc` takes an equality
function:

```go
users = slices.CompactFunc(users, func(a, b User) bool {
    return a.Name == b.Name
})
```

## 13. Cloning: `slices.Clone`

A slice is a header (`ptr`, `len`, `cap`); copying the header does
*not* copy the data. Two "different" slices can alias the same backing
array, and a write through one affects the other:

```go
a := []int{1, 2, 3}
b := a            // same backing array
b[0] = 99
fmt.Println(a)    // [99 2 3]
```

`slices.Clone(a)` returns a *new* slice with its own backing array:

```go
b := slices.Clone(a)
b[0] = 99
fmt.Println(a)    // [1 2 3] — unchanged
```

Use `Clone` whenever you return a slice from a function and the caller
might mutate it, or when you receive a slice and want to keep a
snapshot independent of the caller's later changes. It is `len(a)`
deep — for slices of pointers or slices, the elements are still shared.

## 14. Maps: the basics

`map[K]V` ranges in **random order**. The Go spec guarantees this on
purpose — code that depends on iteration order is fragile, so the
runtime randomizes the start position.

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
for k, v := range m {
    fmt.Println(k, v) // any order
}
```

If you need deterministic order — for tests, JSON output, log lines —
sort the keys:

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

This is the canonical "iterate in sorted order" idiom. The `maps`
package has helpers that get part of the way there:

```go
import "maps"

// Go 1.21–1.22:
keys := maps.Keys(m)        // []string, in random order
slices.Sort(keys)

// Go 1.23+:
// maps.Keys returns iter.Seq[K]; collect with slices.Sorted.
keys := slices.Sorted(maps.Keys(m))
```

The Go 1.23 iterator transition turns `maps.Keys` and `maps.Values`
into iterator functions. We cover the migration in
[middle.md](middle.md); for now, write the explicit `keys := []K{}`
loop and sort it. That works on every Go version.

## 15. Comparing maps: `maps.Equal`

```go
a := map[string]int{"a": 1, "b": 2}
b := map[string]int{"a": 1, "b": 2}
maps.Equal(a, b) // true
```

`maps.Equal` checks that both maps have the same keys and the same
values (compared with `==`). It is `O(len(a))`, with one map lookup
per key.

For custom value types, `maps.EqualFunc(a, b, eqFn)` takes an equality
function — same idea as `slices.EqualFunc`.

## 16. Cloning a map: `maps.Clone`

```go
src := map[string]int{"a": 1, "b": 2}
dst := maps.Clone(src)
dst["a"] = 99
fmt.Println(src["a"]) // 1
```

`maps.Clone` returns a shallow copy — the new map has its own buckets,
but `V` values that contain pointers (slices, maps, channels, pointer
fields) are shared between source and clone. For deep copies you need
to walk the values yourself.

## 17. Merging maps: `maps.Copy`

```go
dst := map[string]int{"a": 1}
src := map[string]int{"b": 2, "a": 99}
maps.Copy(dst, src)
// dst == {"a": 99, "b": 2}
```

`maps.Copy(dst, src)` copies every entry from `src` into `dst`,
overwriting on key collision. The destination must be initialized
(non-nil) — `maps.Copy(nil, src)` panics.

## 18. Filtering a map: `maps.DeleteFunc`

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
maps.DeleteFunc(m, func(k string, v int) bool {
    return v%2 == 0
})
// m == {"a": 1, "c": 3}
```

The predicate receives both key and value. Same shape as
`slices.DeleteFunc`, but maps are unordered, so the order in which the
predicate is called is unspecified.

## 19. The legacy `sort` API in 60 seconds

You'll still see this in older code, vendored libraries, and
interfaces that pre-date generics:

```go
import "sort"

nums := []int{5, 2, 4, 1, 3}
sort.Ints(nums)                                 // sort []int
sort.Strings([]string{"c", "a", "b"})           // sort []string
sort.Float64s([]float64{1.1, 0.5, 3.3})         // sort []float64

// By a comparator:
sort.Slice(users, func(i, j int) bool {
    return users[i].Age < users[j].Age
})
sort.SliceStable(users, /* ... */)              // stable variant
```

`sort.Slice` takes indexes (`i`, `j`), not the elements. This is the
old style — read elements via the closure. `slices.SortFunc` is its
generic replacement and is faster on most workloads (no reflection).

When you still need the legacy API:

- A library function returns `sort.Interface` and you must implement
  `Len`, `Less`, `Swap` on a custom type.
- You're sorting something that is not a slice (a tree iterator, a
  database cursor) and you want to write `sort.Sort(myCollection)`.

For everything else in 2026, prefer `slices.Sort` / `slices.SortFunc`.

## 20. Putting it together: top-N by score

```go
type Score struct {
    Name  string
    Value int
}

func topN(scores []Score, n int) []Score {
    out := slices.Clone(scores) // don't mutate caller's slice
    slices.SortFunc(out, func(a, b Score) int {
        return cmp.Compare(b.Value, a.Value) // descending
    })
    if n > len(out) {
        n = len(out)
    }
    return out[:n]
}
```

Three real lessons in twelve lines: clone before mutate, swap argument
order for descending, clamp `n` to slice length so a caller asking for
"top 100" of three rows gets three rows instead of a panic.

## 21. Putting it together: sorted JSON output

JSON object key order is technically irrelevant to consumers, but
diff-friendly logs and golden-file tests want stable output:

```go
func sortedJSON(m map[string]any) ([]byte, error) {
    keys := make([]string, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }
    slices.Sort(keys)

    var buf bytes.Buffer
    buf.WriteByte('{')
    for i, k := range keys {
        if i > 0 {
            buf.WriteByte(',')
        }
        kb, _ := json.Marshal(k)
        buf.Write(kb)
        buf.WriteByte(':')
        vb, err := json.Marshal(m[k])
        if err != nil {
            return nil, err
        }
        buf.Write(vb)
    }
    buf.WriteByte('}')
    return buf.Bytes(), nil
}
```

We use `slices.Sort` because the keys are strings (`Ordered`). If your
keys were a non-`Ordered` type, you'd need `SortFunc`. Production code
will reach for `json.Marshal` plus a custom encoder, but the pattern —
*pull keys, sort, iterate in order* — is identical.

## 22. Common mistakes at this level

| Symptom | Likely cause |
|---------|--------------|
| `BinarySearch` returns wrong indexes | Slice is not sorted by the same comparator |
| `slices.Equal` of two maps | Wrong function — use `maps.Equal` for maps |
| Stable sort gives the same result as unstable | Comparator never returns 0; stability has no effect |
| `slices.Delete` in a loop is slow | Use `slices.DeleteFunc` once instead |
| Map iteration order changes between runs | That's the spec; sort keys for determinism |
| `maps.Copy(nil, src)` panics | Destination map must be initialized |
| Two slices share backing array after Clone of a struct field | `Clone` is shallow — re-clone inner slices yourself |
| Sorting `[]float64` with `NaN` produces garbage | `Sort` requires a total order; `NaN` breaks it |

## 23. What to read next

- [middle.md](middle.md) — implementing `sort.Interface`, multi-key
  comparators, the `cmp` package, the iterator transition, and the
  rules for a valid `Less`.
- [senior.md](senior.md) — exact contracts, total-order requirements,
  `pdqsort`, and the cost model for `SortFunc` vs `Sort`.
- [tasks.md](tasks.md) — exercises that turn this junior material
  into muscle memory.
- The official package docs:
  [`sort`](https://pkg.go.dev/sort),
  [`slices`](https://pkg.go.dev/slices),
  [`maps`](https://pkg.go.dev/maps),
  [`cmp`](https://pkg.go.dev/cmp).
