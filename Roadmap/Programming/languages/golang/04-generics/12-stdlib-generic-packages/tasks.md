# Stdlib Generic Packages — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. Every task uses **only** `slices`, `maps`, `cmp`, and the rest of the stdlib — no third-party packages.

---

## Easy 🟢

### Task 1 — Sort and search with `slices`
Given `s := []int{3, 1, 4, 1, 5, 9, 2, 6}`, sort it and use `slices.BinarySearch` to find `5`.

### Task 2 — `Contains` with `slices.Contains`
Write a one-liner that returns `true` if `[]string{"a","b","c"}` contains `"b"`.

### Task 3 — Reverse a slice
Use `slices.Reverse` to reverse `[]int{1, 2, 3}` in place.

### Task 4 — Min and Max
Use `slices.Min` and `slices.Max` on `[]float64{2.5, 7.1, 1.0, 4.4}`.

### Task 5 — Compact a sorted slice
Sort `[]int{1, 2, 1, 3, 2, 4}` then `Compact` it. Print the result.

### Task 6 — Build a list of map keys
Given `m := map[string]int{"a":1, "b":2}`, build `[]string` of its keys (sorted).

---

## Medium 🟡

### Task 7 — Sort by a struct field
Sort `[]Person{ {"Bob", 30}, {"Ann", 25} }` by `Age` ascending using `slices.SortFunc` and `cmp.Compare`.

### Task 8 — Multi-key sort with `cmp.Or`
Sort `[]Person` by `LastName` then `FirstName`.

### Task 9 — Find first user older than 30
Use `slices.IndexFunc` to find the first `Person` with `Age > 30`.

### Task 10 — Case-insensitive dedup
Given `[]string{"Apple", "apple", "Banana", "BANANA"}`, dedup case-insensitively while preserving the first occurrence (sort + `CompactFunc`).

### Task 11 — Map clone and mutate
Clone `map[string]int{"a":1}` with `maps.Clone`, mutate the clone, prove the original is unchanged.

### Task 12 — Delete map entries by predicate
Given `map[string]int`, delete all entries with even values using `maps.DeleteFunc`.

### Task 13 — `cmp.Or` for default config
Compute `name := cmp.Or(envName, configName, "default")`.

### Task 14 — `slices.Concat` over three lists
Concatenate `[]int{1,2}`, `[]int{3,4}`, `[]int{5}` into one slice with `slices.Concat`.

### Task 15 — `BinarySearchFunc` with mixed types
Given `[]Person` sorted by `Name`, search for the index of someone named `"alice"`.

---

## Hard 🔴

### Task 16 — Stable sort by priority
Sort `[]Task` by `Priority` descending, but keep original order for equal priorities. Use `SortStableFunc`.

### Task 17 — Insert into a sorted slice
Maintain a sorted `[]int` and insert `7` while preserving order. Use `BinarySearch` + `Insert`.

### Task 18 — Diff two maps
Write `Diff[K comparable, V comparable](a, b map[K]V) (added, removed, changed []K)` using `maps.Equal` reasoning.

### Task 19 — Group by category
Given `[]Item{ID, Category, ...}`, group into `map[string][]Item` keyed by `Category`. Then sort each group by `ID`.

### Task 20 — Top N by score
Given `[]Result`, return the top N by `Score` using `slices.SortFunc` + slicing.

---

## Expert 🟣

### Task 21 — Iterator-driven pipeline (Go 1.23+)
Compute the sum of squared keys of a `map[string]int` using `maps.Keys`, `slices.Collect`, and a manual loop.

### Task 22 — Custom equality on slice fields
Given `[]User{Name string; Roles []string}`, deduplicate by `Name` ignoring `Roles`. Use `slices.SortFunc` + `slices.CompactFunc`.

---

## Solutions

### Solution 1
```go
import "slices"

s := []int{3, 1, 4, 1, 5, 9, 2, 6}
slices.Sort(s)
idx, ok := slices.BinarySearch(s, 5)
fmt.Println(idx, ok) // index of 5 in sorted slice, true
```

### Solution 2
```go
slices.Contains([]string{"a", "b", "c"}, "b") // true
```

### Solution 3
```go
s := []int{1, 2, 3}
slices.Reverse(s)
fmt.Println(s) // [3 2 1]
```

### Solution 4
```go
slices.Min([]float64{2.5, 7.1, 1.0, 4.4}) // 1.0
slices.Max([]float64{2.5, 7.1, 1.0, 4.4}) // 7.1
```

### Solution 5
```go
s := []int{1, 2, 1, 3, 2, 4}
slices.Sort(s)
s = slices.Compact(s)
fmt.Println(s) // [1 2 3 4]
```

### Solution 6
```go
import "maps"

m := map[string]int{"a": 1, "b": 2}
keys := slices.Collect(maps.Keys(m)) // 1.23+
slices.Sort(keys)
fmt.Println(keys) // [a b]
```

### Solution 7
```go
import (
    "cmp"
    "slices"
)

type Person struct{ Name string; Age int }

people := []Person{{"Bob", 30}, {"Ann", 25}}
slices.SortFunc(people, func(a, b Person) int {
    return cmp.Compare(a.Age, b.Age)
})
```

### Solution 8
```go
slices.SortStableFunc(people, func(a, b Person) int {
    return cmp.Or(
        cmp.Compare(a.LastName,  b.LastName),
        cmp.Compare(a.FirstName, b.FirstName),
    )
})
```

### Solution 9
```go
i := slices.IndexFunc(people, func(p Person) bool { return p.Age > 30 })
if i >= 0 {
    fmt.Println(people[i])
}
```

### Solution 10
```go
import (
    "slices"
    "strings"
)

s := []string{"Apple", "apple", "Banana", "BANANA"}
slices.SortFunc(s, func(a, b string) int { return cmp.Compare(strings.ToLower(a), strings.ToLower(b)) })
s = slices.CompactFunc(s, func(a, b string) bool {
    return strings.EqualFold(a, b)
})
fmt.Println(s) // [Apple Banana] or [apple BANANA] depending on sort tie
```

### Solution 11
```go
import "maps"

orig := map[string]int{"a": 1}
cp := maps.Clone(orig)
cp["b"] = 2
fmt.Println(orig) // {"a":1}
fmt.Println(cp)   // {"a":1, "b":2}
```

### Solution 12
```go
maps.DeleteFunc(m, func(k string, v int) bool { return v%2 == 0 })
```

### Solution 13
```go
name := cmp.Or(envName, configName, "default")
```

### Solution 14
```go
all := slices.Concat([]int{1, 2}, []int{3, 4}, []int{5})
fmt.Println(all) // [1 2 3 4 5]
```

### Solution 15
```go
slices.SortFunc(people, func(a, b Person) int { return cmp.Compare(a.Name, b.Name) })
idx, ok := slices.BinarySearchFunc(people, "alice", func(p Person, name string) int {
    return cmp.Compare(p.Name, name)
})
fmt.Println(idx, ok)
```

### Solution 16
```go
slices.SortStableFunc(tasks, func(a, b Task) int {
    return cmp.Compare(b.Priority, a.Priority) // descending
})
```

### Solution 17
```go
s := []int{1, 3, 5, 9}
v := 7
idx, _ := slices.BinarySearch(s, v)
s = slices.Insert(s, idx, v)
fmt.Println(s) // [1 3 5 7 9]
```

### Solution 18
```go
func Diff[K comparable, V comparable](a, b map[K]V) (added, removed, changed []K) {
    for k := range a {
        if _, ok := b[k]; !ok {
            removed = append(removed, k)
        } else if a[k] != b[k] {
            changed = append(changed, k)
        }
    }
    for k := range b {
        if _, ok := a[k]; !ok {
            added = append(added, k)
        }
    }
    return
}
```

### Solution 19
```go
groups := map[string][]Item{}
for _, it := range items {
    groups[it.Category] = append(groups[it.Category], it)
}
for cat, list := range groups {
    slices.SortFunc(list, func(a, b Item) int { return cmp.Compare(a.ID, b.ID) })
    groups[cat] = list
}
```

### Solution 20
```go
slices.SortFunc(results, func(a, b Result) int {
    return cmp.Compare(b.Score, a.Score) // descending
})
top := results[:min(N, len(results))]
```

### Solution 21
```go
import (
    "maps"
    "slices"
)

m := map[string]int{"a": 2, "b": 3}
total := 0
for k := range maps.Keys(m) {
    total += len(k) * len(k)
}
// or as slice
keys := slices.Collect(maps.Keys(m))
slices.Sort(keys)
```

### Solution 22
```go
slices.SortFunc(users, func(a, b User) int { return cmp.Compare(a.Name, b.Name) })
users = slices.CompactFunc(users, func(a, b User) bool { return a.Name == b.Name })
```

---

## Bonus exercises

### Bonus 1 — Validate that a slice is sorted before search
```go
import "errors"

func SafeBinarySearch[T cmp.Ordered](s []T, target T) (int, bool, error) {
    if !slices.IsSorted(s) {
        return 0, false, errors.New("slice not sorted")
    }
    idx, ok := slices.BinarySearch(s, target)
    return idx, ok, nil
}
```

### Bonus 2 — Stable sort by computed key
```go
slices.SortStableFunc(items, func(a, b Item) int {
    return cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
})
```

### Bonus 3 — Build inverted index of map values
```go
func InvertedIndex[K comparable, V comparable](m map[K]V) map[V][]K {
    out := map[V][]K{}
    for k, v := range m {
        out[v] = append(out[v], k)
    }
    for v := range out {
        slices.Sort(out[v])
    }
    return out
}
```

### Bonus 4 — Detect duplicates without modifying input
```go
func HasDuplicates[T comparable](s []T) bool {
    seen := make(map[T]struct{}, len(s))
    for _, v := range s {
        if _, ok := seen[v]; ok { return true }
        seen[v] = struct{}{}
    }
    return false
}
```

### Bonus 5 — Merge two sorted slices in O(n+m)
```go
func Merge[T cmp.Ordered](a, b []T) []T {
    out := make([]T, 0, len(a)+len(b))
    i, j := 0, 0
    for i < len(a) && j < len(b) {
        if cmp.Less(a[i], b[j]) {
            out = append(out, a[i]); i++
        } else {
            out = append(out, b[j]); j++
        }
    }
    out = append(out, a[i:]...)
    out = append(out, b[j:]...)
    return out
}
```

## Final notes

The key habit these tasks build: **reach for `slices`, `maps`, and `cmp` first**. Almost every "I need to find/sort/dedupe/copy" operation already has a stdlib helper. The exercises above mostly look like one or two lines once you internalize the API surface — that is exactly the point.

Two patterns to internalize:

1. **`slices.SortFunc(s, cmp.Compare)`** when keys are ordered but the type is not.
2. **`cmp.Or(cmp.Compare(a.X, b.X), cmp.Compare(a.Y, b.Y))`** for multi-key sort.

Once these two flow naturally, the rest of the API is self-explanatory.
