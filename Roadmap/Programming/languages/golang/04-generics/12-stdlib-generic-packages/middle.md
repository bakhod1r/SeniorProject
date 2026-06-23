# Stdlib Generic Packages — Middle Level

## Table of Contents
1. [The `*Func` family — why it exists](#the-func-family-why-it-exists)
2. [`SortFunc`, `SortStableFunc`, `IsSortedFunc`](#sortfunc-sortstablefunc-issortedfunc)
3. [`BinarySearchFunc`](#binarysearchfunc)
4. [`ContainsFunc` and `IndexFunc`](#containsfunc-and-indexfunc)
5. [`CompactFunc`](#compactfunc)
6. [`Collect` and friends — building from iterators](#collect-and-friends-building-from-iterators)
7. [Integrating `slices.SortStableFunc(s, cmp.Compare)`](#integrating-slicessortstablefuncs-cmpcompare)
8. [Multi-key sorting with `cmp.Or`](#multi-key-sorting-with-cmpor)
9. [Summary](#summary)

---

## The `*Func` family — why it exists

The plain APIs in `slices` rely on `==` (constraint `comparable`) or `<` (constraint `cmp.Ordered`). That covers basic types but leaves anything more interesting out:

- A `Person` struct with a non-comparable `[]Tag` field
- A slice of slices where you compare by length
- Strings compared **case-insensitively**
- A struct sorted by a derived key (`Age()` method)

For these cases, every `slices` function has a `*Func` twin that takes a callback. The plain version is a **convenience wrapper** around the `*Func` version.

```go
// roughly
func Contains[S ~[]E, E comparable](s S, v E) bool {
    return ContainsFunc(s, func(e E) bool { return e == v })
}
```

In modern Go you should always check whether the `*Func` variant exists when the plain one does not fit your needs.

---

## `SortFunc`, `SortStableFunc`, `IsSortedFunc`

```go
slices.SortFunc(s, cmp)         // unstable in-place sort
slices.SortStableFunc(s, cmp)   // stable in-place sort
slices.IsSortedFunc(s, cmp)     // bool
```

The comparator is a `func(a, b E) int` that returns:
- `< 0` when `a < b`
- `0` when `a == b`
- `> 0` when `a > b`

Use **`cmp.Compare`** as the comparator whenever the keys are themselves `cmp.Ordered`:

```go
slices.SortFunc(people, func(a, b Person) int {
    return cmp.Compare(a.Age, b.Age)
})
```

### Stable vs unstable

`slices.Sort` and `slices.SortFunc` use **pdqsort** — pattern-defeating quicksort — which is unstable. If two elements compare equal, their relative order is undefined.

`slices.SortStableFunc` guarantees that equal elements keep their input order. Use it when:

- The slice is already partially sorted by another key
- You implement multi-pass sorting ("sort by Age, then by Name" without `cmp.Or`)
- The user expects deterministic ordering for equal keys

Stable sort is **slightly slower** than unstable. There is no `slices.SortStable` (without `Func`) because the only stable use case requires a callback.

### `IsSortedFunc` for invariants

```go
if !slices.IsSortedFunc(s, cmp.Compare) {
    return errors.New("input must be sorted")
}
```

A cheap precondition check before `BinarySearch`.

---

## `BinarySearchFunc`

```go
idx, found := slices.BinarySearchFunc(s, target, func(elem, t E) int {
    return cmp.Compare(elem.Key, t.Key)
})
```

Two important rules:

1. **The slice must already be sorted** by the same comparator. The function does not check.
2. The callback compares an **element** against the **target**, not two elements.

When `found` is `false`, `idx` is the insertion point. This makes `BinarySearchFunc` useful for **lower-bound** lookups:

```go
idx, _ := slices.BinarySearchFunc(s, target, cmp.Compare)
// idx is now the first position where elem >= target
```

### Combining with `Insert`

```go
idx, found := slices.BinarySearch(s, v)
if !found {
    s = slices.Insert(s, idx, v)
}
```

`O(log n)` lookup + `O(n)` shift = ordered set without a map.

---

## `ContainsFunc` and `IndexFunc`

```go
slices.ContainsFunc(s, func(e E) bool { return ... })
slices.IndexFunc(s, pred)
```

These work on **any** slice — no `comparable` required. Use them when:

- You want substring/prefix check on `[]string`
- You filter by a boolean property of a struct
- The element type is a slice or map (not comparable)

```go
hasAdmin := slices.ContainsFunc(users, func(u User) bool {
    return u.Role == "admin"
})

i := slices.IndexFunc(events, func(e Event) bool {
    return e.Time.After(deadline)
})
```

There is also `slices.IndexFunc` returning `-1` for not-found, mirroring `slices.Index`.

---

## `CompactFunc`

```go
slices.Compact(s)              // adjacent dedup with ==
slices.CompactFunc(s, equal)   // adjacent dedup with callback
```

`CompactFunc` lets you deduplicate by a custom equality:

```go
slices.CompactFunc(words, func(a, b string) bool {
    return strings.EqualFold(a, b) // case-insensitive
})
```

Both `Compact` and `CompactFunc` only remove **adjacent** duplicates. Always sort first if you want full deduplication:

```go
slices.SortFunc(s, cmp)
s = slices.CompactFunc(s, equal)
```

### Dedup by key

```go
slices.SortFunc(users, func(a, b User) int { return cmp.Compare(a.ID, b.ID) })
users = slices.CompactFunc(users, func(a, b User) bool { return a.ID == b.ID })
```

---

## `Collect` and friends — building from iterators

Go 1.23 introduced range-over-func and the `iter.Seq[T]` / `iter.Seq2[K, V]` types. Several `slices` and `maps` functions changed accordingly.

### `slices.Collect`

```go
seq := iter.Seq[int](func(yield func(int) bool) {
    for i := 0; i < 5; i++ { if !yield(i) { return } }
})
nums := slices.Collect(seq) // [0 1 2 3 4]
```

`slices.Collect` consumes an `iter.Seq[T]` and returns a `[]T`. It is the **canonical bridge** between iterator-style code and slice-style code.

### `slices.Sorted` and `slices.SortedFunc`

```go
sorted := slices.Sorted(maps.Keys(m))            // sorted []K
sorted := slices.SortedFunc(maps.Keys(m), cmp.Compare)
```

These take an iterator and return a **new sorted slice**, leaving the source untouched. They internalize the `Collect` + `Sort` pair.

### `maps.Keys` and `maps.Values` returning iterators

In Go 1.23+:

```go
for k := range maps.Keys(m) { ... }   // direct range
for k, v := range m { ... }           // also still works

keys := slices.Collect(maps.Keys(m))  // explicit slice
```

The iterator API integrates cleanly with `slices.Collect`. The plain "give me a slice" idiom is still one line.

---

## Integrating `slices.SortStableFunc(s, cmp.Compare)`

The most common pattern in modern Go:

```go
slices.SortStableFunc(items, cmp.Compare)
```

Wait — `SortStableFunc` takes `func(a, b T) int`, and `cmp.Compare` has that exact signature. So the compiler accepts `cmp.Compare` as the function value:

```go
// when items is []int, []float64, []string, etc.
slices.SortStableFunc(items, cmp.Compare[int])
```

In practice you usually pass a closure that calls `cmp.Compare` on a derived key:

```go
slices.SortStableFunc(people, func(a, b Person) int {
    return cmp.Compare(a.LastName, b.LastName)
})
```

Note: `slices.SortStable` (without Func) does not exist — you would only need stable sorting when there is a key to sort by, hence the callback is mandatory.

---

## Multi-key sorting with `cmp.Or`

`cmp.Or` (Go 1.22+) returns the first non-zero argument. Combined with `cmp.Compare` it produces beautiful multi-key sorts:

```go
slices.SortStableFunc(people, func(a, b Person) int {
    return cmp.Or(
        cmp.Compare(a.Department, b.Department),
        cmp.Compare(a.LastName,   b.LastName),
        cmp.Compare(a.FirstName,  b.FirstName),
        cmp.Compare(a.Age,        b.Age),
    )
})
```

How it reads in English: "Sort by Department; if equal, by LastName; if equal, by FirstName; if equal, by Age". Each `cmp.Compare` returns -1/0/+1 and `cmp.Or` keeps walking until it finds a non-zero result.

### Descending sort

To reverse the order on one key, negate the comparator:

```go
slices.SortFunc(rows, func(a, b Row) int {
    return cmp.Or(
        cmp.Compare(a.Group, b.Group),
        -cmp.Compare(a.Score, b.Score), // descending
    )
})
```

A negative integer is also a valid "less than" outcome, and `cmp.Or` stops on any non-zero value.

### Pattern in real code

```go
// Sort tasks by priority (high to low), then by due date (early first),
// then by ID (stable)
slices.SortStableFunc(tasks, func(a, b Task) int {
    return cmp.Or(
        cmp.Compare(b.Priority, a.Priority),    // a/b swap = descending
        cmp.Compare(a.Due.Unix(), b.Due.Unix()),
        cmp.Compare(a.ID, b.ID),
    )
})
```

This idiom replaces ten lines of hand-rolled `Less` methods.

---

## Worked example: paginated table sort

A common UI feature: a table with multi-column sort. The user clicks a header, the table sorts; clicks another column, sort changes; holds Shift, secondary sort is added. Server-side, you receive a list of "sort keys" and must sort the data accordingly.

```go
type SortKey struct {
    Field string
    Desc  bool
}

func sortRows(rows []Row, keys []SortKey) {
    slices.SortStableFunc(rows, func(a, b Row) int {
        for _, k := range keys {
            c := compareField(a, b, k.Field)
            if k.Desc { c = -c }
            if c != 0 { return c }
        }
        return 0
    })
}

func compareField(a, b Row, field string) int {
    switch field {
    case "name":  return cmp.Compare(a.Name, b.Name)
    case "age":   return cmp.Compare(a.Age, b.Age)
    case "score": return cmp.Compare(a.Score, b.Score)
    }
    return 0
}
```

The pattern combines:
- `SortStableFunc` for stability across multiple sort cycles
- `cmp.Compare` for typed field comparison
- A switch dispatching on the field name
- Inversion (`-c`) for descending order

This is the bread-and-butter middle-level use of the package.

## Working with derived keys

A common need: sort by a value derived from each element, not by an element field directly. `slices.SortFunc` plus a small `KeyFunc` helper handles this:

```go
func SortByKey[T any, K cmp.Ordered](s []T, key func(T) K) {
    slices.SortFunc(s, func(a, b T) int {
        return cmp.Compare(key(a), key(b))
    })
}

SortByKey(users, func(u User) string { return strings.ToLower(u.Email) })
```

The wrapper saves the comparator boilerplate. For one-off sorts the inline closure is fine; for repeated patterns the wrapper pays for itself.

## Summary

The middle-level skill set is **knowing the `*Func` variants** and **chaining them with `cmp.Compare` and `cmp.Or`**:

1. **`SortFunc` / `SortStableFunc`** for any comparator
2. **`IsSortedFunc`** as a precondition guard
3. **`BinarySearchFunc`** for `O(log n)` lookups in pre-sorted custom data
4. **`ContainsFunc` / `IndexFunc`** for predicate-driven search
5. **`CompactFunc`** for dedup with custom equality
6. **`slices.Collect` / `slices.Sorted`** as bridges from iterator to slice
7. **`cmp.Compare` + `cmp.Or`** for multi-key sorts in one declarative expression

Once these patterns are second nature, the day-to-day Go codebase shrinks dramatically: `sort.Slice` calls disappear, custom `Less` methods disappear, hand-rolled dedup loops disappear.

Move on to `senior.md` for the algorithmic guarantees, aliasing rules, and when stdlib stops being the right answer.
