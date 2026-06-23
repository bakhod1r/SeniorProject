# Stdlib Generic Packages — Find the Bug

## How to use

Each problem shows a snippet that compiles or appears to compile. Read it carefully and answer:
1. What is the bug?
2. How would you fix it?
3. Could a stdlib helper have prevented it?

Solutions are at the end.

---

## Bug 1 — assuming `maps.Keys` returns sorted

```go
m := map[string]int{"b": 2, "a": 1, "c": 3}
keys := slices.Collect(maps.Keys(m))
fmt.Println(keys) // expected [a b c]
```

**Hint:** Map iteration order.

---

## Bug 2 — `slices.Compact` without sorting

```go
s := []int{1, 2, 1, 2, 1}
s = slices.Compact(s)
fmt.Println(s) // expected [1 2]
```

**Hint:** What does `Compact` actually remove?

---

## Bug 3 — `slices.Min` on possibly empty slice

```go
func median(s []int) int {
    return slices.Min(s) + slices.Max(s) // crashes on empty
}
```

**Hint:** Check the panics list.

---

## Bug 4 — `slices.Insert` return ignored

```go
s := []int{1, 2, 4}
slices.Insert(s, 2, 3)
fmt.Println(s) // expected [1 2 3 4]
```

**Hint:** What does `Insert` return?

---

## Bug 5 — `slices.Delete` return ignored

```go
s := []int{1, 2, 3, 4}
slices.Delete(s, 1, 3)
fmt.Println(s) // expected [1 4]
```

**Hint:** Same family as Bug 4.

---

## Bug 6 — `BinarySearch` on unsorted slice

```go
s := []int{5, 1, 3, 2}
idx, ok := slices.BinarySearch(s, 3)
fmt.Println(idx, ok) // expected 2, true
```

**Hint:** Precondition.

---

## Bug 7 — wrong comparator return type

```go
slices.SortFunc(people, func(a, b Person) bool { // ❌
    return a.Age < b.Age
})
```

**Hint:** What type does the comparator return?

---

## Bug 8 — `cmp.Or` evaluates all arguments

```go
val := cmp.Or(loadFromCache(), loadFromDisk(), loadFromNetwork())
```

The user expected: "stop calling functions when one returns non-zero". What actually happens?

**Hint:** Argument evaluation order in Go.

---

## Bug 9 — `slices.Equal` and `NaN`

```go
a := []float64{1, math.NaN()}
b := []float64{1, math.NaN()}
fmt.Println(slices.Equal(a, b)) // expected true
```

**Hint:** `NaN == NaN` semantics.

---

## Bug 10 — missing `cmp.Compare` result handling

```go
slices.SortFunc(people, func(a, b Person) int {
    if a.Age < b.Age { return -1 }
    return 1
})
```

**Hint:** What about equal ages? What does pdqsort do then?

---

## Bug 11 — assuming `slices.Sort` is stable

```go
type Event struct{ Time int; Order int }

slices.SortFunc(events, func(a, b Event) int {
    return cmp.Compare(a.Time, b.Time)
})
// expected: events with the same Time keep their original Order
```

**Hint:** Read the godoc.

---

## Bug 12 — `maps.Clone` for deep copy

```go
type Box struct{ items []int }
m := map[string]Box{"a": {items: []int{1, 2}}}
cp := maps.Clone(m)
cp["a"].items[0] = 99
fmt.Println(m["a"].items[0]) // expected 1, got 99
```

**Hint:** Shallow copy.

---

## Bug 13 — `slices.Compact` aliasing

```go
s := []int{1, 1, 2, 3, 3}
out := slices.Compact(s)
out[0] = 99
fmt.Println(s[0]) // expected 1
```

**Hint:** Same backing array.

---

## Bug 14 — using `cmp.Compare` on non-Ordered

```go
type ID struct{ N int }

idx, _ := slices.BinarySearchFunc(ids, ID{N: 5}, cmp.Compare) // ❌
```

**Hint:** What does `cmp.Compare` accept?

---

## Bug 15 — wrong index argument to `slices.Insert`

```go
s := []int{1, 2, 3, 4}
s = slices.Insert(s, 5, 99) // ❌ — out of range
```

**Hint:** Valid index range.

---

## Bug 16 — `cmp.Or` with default zero string

```go
name := cmp.Or("", "", "default")
fmt.Println(name) // expected "default"
```

The user wrote:
```go
name := cmp.Or("", "supplied")
```

…and the result was `"supplied"`. Then they extended:
```go
name := cmp.Or("supplied", "")
```

…and got `"supplied"` as expected. But:
```go
name := cmp.Or(emptyButNotZero, "fallback") // emptyButNotZero is " " (space)
```

…returned `" "` instead of `"fallback"`. Why?

**Hint:** What counts as "zero"?

---

## Solutions

### Bug 1 — fix
Map iteration order is randomized. Sort explicitly:
```go
keys := slices.Collect(maps.Keys(m))
slices.Sort(keys)
```

### Bug 2 — fix
`Compact` removes only **adjacent** duplicates. Sort first:
```go
slices.Sort(s)
s = slices.Compact(s)
```

### Bug 3 — fix
Guard the empty case:
```go
if len(s) == 0 { return 0 }
return slices.Min(s) + slices.Max(s)
```

### Bug 4 — fix
`Insert` returns a (possibly reallocated) slice. Reassign:
```go
s = slices.Insert(s, 2, 3)
```

### Bug 5 — fix
Same as Bug 4:
```go
s = slices.Delete(s, 1, 3)
```

### Bug 6 — fix
Sort first:
```go
slices.Sort(s)
idx, ok := slices.BinarySearch(s, 3)
```

### Bug 7 — fix
The comparator must return `int`, not `bool`:
```go
slices.SortFunc(people, func(a, b Person) int {
    return cmp.Compare(a.Age, b.Age)
})
```

### Bug 8 — fix
Function arguments are evaluated **before** `cmp.Or` runs. All three calls fire. To short-circuit, write the chain explicitly:
```go
val := loadFromCache()
if val == "" { val = loadFromDisk() }
if val == "" { val = loadFromNetwork() }
```

### Bug 9 — explanation
`slices.Equal` uses `==`, and `NaN == NaN` is **false** by IEEE-754. So `slices.Equal(a, b)` is `false` even though the slices look equal. Use `slices.EqualFunc` with custom NaN-aware equality if needed.

### Bug 10 — fix
The comparator returns `1` for equal ages, telling pdqsort that `a > b`. Sorting becomes incorrect. Always handle equality:
```go
slices.SortFunc(people, func(a, b Person) int {
    return cmp.Compare(a.Age, b.Age)
})
```

### Bug 11 — fix
`slices.SortFunc` is **unstable**. Use `slices.SortStableFunc`:
```go
slices.SortStableFunc(events, func(a, b Event) int {
    return cmp.Compare(a.Time, b.Time)
})
```

### Bug 12 — explanation
`maps.Clone` is shallow. The `Box.items` slice is shared between `m` and `cp`. Mutating `cp["a"].items[0]` mutates the shared backing array. Write a deep clone manually:
```go
for k, v := range m {
    cp[k] = Box{items: slices.Clone(v.items)}
}
```

### Bug 13 — explanation
`Compact` returns a slice that aliases the input. `out[0] = 99` mutates `s[0]`. To avoid: `out := slices.Clone(slices.Compact(slices.Clone(s)))`.

### Bug 14 — fix
`cmp.Compare` requires `cmp.Ordered`. For struct types, write the comparator yourself:
```go
slices.BinarySearchFunc(ids, ID{N: 5}, func(a, b ID) int {
    return cmp.Compare(a.N, b.N)
})
```

### Bug 15 — fix
The valid range is `0 <= i <= len(s)`. For `len 4` the max valid index is `4` (append at end), not `5`:
```go
s = slices.Insert(s, len(s), 99)
```

### Bug 16 — explanation
`cmp.Or` returns the first non-**zero**. For strings, the zero is `""`. `" "` (space) is not zero, so it is returned. If you want "first non-empty after trimming", write your own:
```go
for _, s := range candidates {
    if strings.TrimSpace(s) != "" { return s }
}
```

---

## Lessons

Patterns from these bugs:

1. **`Compact` only removes adjacent duplicates** (Bug 2) — sort first.
2. **Map iteration is randomized** (Bug 1) — sort if you need order.
3. **`Min`/`Max`/`Insert`/`Delete` panic on bad input** (Bugs 3, 15) — guard.
4. **Mutation APIs return a new slice header** (Bugs 4, 5) — reassign.
5. **`BinarySearch` requires sorted input** (Bug 6) — precondition.
6. **Comparator must return `int`, not `bool`** (Bug 7) — use `cmp.Compare`.
7. **All arguments to `cmp.Or` are evaluated** (Bug 8) — no short-circuit.
8. **`NaN != NaN`** (Bug 9) — `slices.Equal` does not handle this.
9. **Comparators must handle equality** (Bug 10) — return `0`, not `1`.
10. **`SortFunc` is unstable** (Bug 11) — use `SortStableFunc` when stability matters.
11. **Clone is shallow** (Bug 12) — write deep clone manually.
12. **`Compact` aliases the input** (Bug 13) — `Clone` first if needed.
13. **`cmp.Compare` requires `cmp.Ordered`** (Bug 14) — custom comparator for structs.
14. **`cmp.Or` "zero" is the type's zero value** (Bug 16) — `" "` is not zero.

A senior engineer reads stdlib godoc carefully — every panic, every "must be sorted", every "shallow copy" is documented and easy to miss until it bites in production.
