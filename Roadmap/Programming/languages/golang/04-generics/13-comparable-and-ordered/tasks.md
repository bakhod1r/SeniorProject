# `comparable` and `cmp.Ordered` — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. The tasks emphasize **picking the right constraint** — many ask you to compare a `comparable` solution with a `cmp.Ordered` one.

---

## Easy 🟢

### Task 1 — Build `Set[T comparable]`
Write a generic set with `Add(v T)`, `Has(v T) bool`, `Remove(v T)`, and `Len() int`. Why must `T` be `comparable`?

### Task 2 — `Contains` for `comparable`
Write `Contains[T comparable](s []T, v T) bool`. Compare with `slices.Contains`.

### Task 3 — `Min` and `Max` over Ordered
Write `Min[T cmp.Ordered](a, b T) T` and `Max[T cmp.Ordered](a, b T) T`. Show that they fail with `comparable`.

### Task 4 — `Distinct` preserving order
Write `Distinct[T comparable](s []T) []T` that removes duplicates while preserving the first occurrence.

### Task 5 — `Coalesce`
Write `Coalesce[T comparable](vals ...T) T` returning the first non-zero. Compare with `cmp.Or`.

---

## Medium 🟡

### Task 6 — `SortedSlice[T cmp.Ordered]`
Build a wrapper around `[]T` that maintains sorted order on `Insert`. Provide `Has` (binary search), `Insert`, and `Range(lo, hi T) []T`.

### Task 7 — Top-N
Write `TopN[T cmp.Ordered](s []T, n int) []T` returning the N largest. Discuss using a min-heap of size N.

### Task 8 — Generic frequency count
Write `Counts[T comparable](s []T) map[T]int`. What constraint does `T` need?

### Task 9 — NaN-safe sort
Sort `[]float64` containing NaN values using `slices.Sort`. Verify NaN is at the front.

### Task 10 — Sort users by Age then Name
Given `type User struct { Age int; Name string }`, sort using `slices.SortFunc` and `cmp.Or` for tie-breaking.

### Task 11 — `Set` from any iterable
Write `SetOf[T comparable](items ...T) *Set[T]`. Use it to build a set from a slice in one line.

### Task 12 — `Equal` for slices of comparable
Write `SlicesEqual[T comparable](a, b []T) bool`. Compare with `slices.Equal`.

### Task 13 — `Range` over `cmp.Ordered`
Write `Between[T cmp.Ordered](v, lo, hi T) bool` checking `lo <= v <= hi`.

### Task 14 — Sort `[]time.Time`
Sort a slice of `time.Time` values. Why does `slices.Sort` not work directly? Use `slices.SortFunc`.

---

## Hard 🔴

### Task 15 — `MinHeap[T cmp.Ordered]`
Implement a min-heap with `Push(v T)` and `Pop() T`. Use `cmp.Compare` internally so NaN works for floats.

### Task 16 — Generic `BST[T cmp.Ordered]`
Build a binary search tree with `Insert`, `Has`, and `InOrder() []T`. Discuss what happens for `T = float64` with NaN.

### Task 17 — `MultiSet[T comparable]`
A bag that counts occurrences. `Add`, `Remove` (decrement), `Count(v T) int`, and `Total() int`. Why does this not need `cmp.Ordered`?

### Task 18 — `OrderedCache[K cmp.Ordered, V any]`
A cache that supports range scans `Scan(lo, hi K) []V`. What stays in `comparable`, what bumps up to `Ordered`?

### Task 19 — Strictly comparable filter
Given `s []any`, return only elements whose dynamic type is **strictly comparable**. Use `reflect.TypeOf(v).Comparable()`.

---

## Expert 🟣

### Task 20 — `cmp.Compare`-based total order on `complex128`
Implement `CompareComplex(a, b complex128) int` using **magnitude** as the order. Sort `[]complex128` with it.

### Task 21 — Custom NaN handling
Write `SortNaNLast[T cmp.Ordered](s []T)` that places NaN at the **end** instead of the front. Use a comparator with explicit NaN detection.

### Task 22 — Hash-based set for non-comparable
Build `HashSet[T any]` that takes a `hash func(T) uint64` and `equal func(T, T) bool`. Use it to deduplicate `[]byte` values, which are not comparable.

---

## Solutions

### Solution 1
```go
type Set[T comparable] struct {
    m map[T]struct{}
}
func NewSet[T comparable]() *Set[T] { return &Set[T]{m: map[T]struct{}{}} }
func (s *Set[T]) Add(v T)           { s.m[v] = struct{}{} }
func (s *Set[T]) Has(v T) bool      { _, ok := s.m[v]; return ok }
func (s *Set[T]) Remove(v T)        { delete(s.m, v) }
func (s *Set[T]) Len() int          { return len(s.m) }
```
`T comparable` is required because the underlying `map[T]struct{}` requires comparable keys.

### Solution 2
```go
func Contains[T comparable](s []T, v T) bool {
    for _, x := range s {
        if x == v { return true }
    }
    return false
}
```
The stdlib `slices.Contains` is identical, with constraint `[S ~[]E, E comparable]`.

### Solution 3
```go
import "cmp"

func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}
func Max[T cmp.Ordered](a, b T) T {
    if a > b { return a }
    return b
}
```
With `comparable`, the `<` operator is rejected at compile time.

### Solution 4
```go
func Distinct[T comparable](s []T) []T {
    seen := map[T]struct{}{}
    out := make([]T, 0, len(s))
    for _, v := range s {
        if _, ok := seen[v]; !ok {
            seen[v] = struct{}{}
            out = append(out, v)
        }
    }
    return out
}
```

### Solution 5
```go
func Coalesce[T comparable](vals ...T) T {
    var zero T
    for _, v := range vals {
        if v != zero { return v }
    }
    return zero
}
```
In Go 1.22+, prefer `cmp.Or(vals...)`.

### Solution 6
```go
import (
    "cmp"
    "slices"
)

type SortedSlice[T cmp.Ordered] struct {
    data []T
}
func (s *SortedSlice[T]) Insert(v T) {
    i, _ := slices.BinarySearch(s.data, v)
    s.data = slices.Insert(s.data, i, v)
}
func (s *SortedSlice[T]) Has(v T) bool {
    _, ok := slices.BinarySearch(s.data, v)
    return ok
}
func (s *SortedSlice[T]) Range(lo, hi T) []T {
    i, _ := slices.BinarySearch(s.data, lo)
    j, _ := slices.BinarySearch(s.data, hi)
    if j < len(s.data) && s.data[j] == hi { j++ }
    return slices.Clone(s.data[i:j])
}
```

### Solution 7
```go
import (
    "cmp"
    "slices"
)

func TopN[T cmp.Ordered](s []T, n int) []T {
    sorted := slices.Clone(s)
    slices.SortFunc(sorted, func(a, b T) int { return cmp.Compare(b, a) })
    if n > len(sorted) { n = len(sorted) }
    return sorted[:n]
}
```
A heap-based version is faster for `n << len(s)`.

### Solution 8
```go
func Counts[T comparable](s []T) map[T]int {
    m := map[T]int{}
    for _, v := range s {
        m[v]++
    }
    return m
}
```
`comparable` is required because `T` is a map key.

### Solution 9
```go
import (
    "math"
    "slices"
)

xs := []float64{3, math.NaN(), 1, math.NaN(), 2}
slices.Sort(xs)
// Output: [NaN NaN 1 2 3]
```
`slices.Sort` uses `cmp.Compare` internally, which puts NaN at the front.

### Solution 10
```go
import (
    "cmp"
    "slices"
)

slices.SortFunc(users, func(a, b User) int {
    return cmp.Or(
        cmp.Compare(a.Age, b.Age),
        cmp.Compare(a.Name, b.Name),
    )
})
```

### Solution 11
```go
func SetOf[T comparable](items ...T) *Set[T] {
    s := NewSet[T]()
    for _, v := range items { s.Add(v) }
    return s
}

s := SetOf(1, 2, 3, 2, 1) // {1, 2, 3}
```

### Solution 12
```go
func SlicesEqual[T comparable](a, b []T) bool {
    if len(a) != len(b) { return false }
    for i := range a {
        if a[i] != b[i] { return false }
    }
    return true
}
```
Identical to `slices.Equal`.

### Solution 13
```go
func Between[T cmp.Ordered](v, lo, hi T) bool {
    return lo <= v && v <= hi
}
```

### Solution 14
```go
import (
    "slices"
    "time"
)

slices.SortFunc(times, func(a, b time.Time) int {
    return a.Compare(b) // time.Time has Compare method since Go 1.20
})
```
`slices.Sort` does not work because `time.Time` is a struct, not in `cmp.Ordered`.

### Solution 15
```go
import "cmp"

type MinHeap[T cmp.Ordered] struct{ data []T }

func (h *MinHeap[T]) Push(v T) {
    h.data = append(h.data, v)
    i := len(h.data) - 1
    for i > 0 {
        parent := (i - 1) / 2
        if cmp.Compare(h.data[i], h.data[parent]) >= 0 { break }
        h.data[i], h.data[parent] = h.data[parent], h.data[i]
        i = parent
    }
}

func (h *MinHeap[T]) Pop() (T, bool) {
    var zero T
    if len(h.data) == 0 { return zero, false }
    top := h.data[0]
    last := len(h.data) - 1
    h.data[0] = h.data[last]
    h.data = h.data[:last]
    h.heapifyDown(0)
    return top, true
}

func (h *MinHeap[T]) heapifyDown(i int) {
    n := len(h.data)
    for {
        l, r := 2*i+1, 2*i+2
        smallest := i
        if l < n && cmp.Compare(h.data[l], h.data[smallest]) < 0 { smallest = l }
        if r < n && cmp.Compare(h.data[r], h.data[smallest]) < 0 { smallest = r }
        if smallest == i { return }
        h.data[i], h.data[smallest] = h.data[smallest], h.data[i]
        i = smallest
    }
}
```
Using `cmp.Compare` ensures NaN does not break heap invariants for `T = float64`.

### Solution 16
```go
import "cmp"

type bnode[T cmp.Ordered] struct {
    v           T
    left, right *bnode[T]
}

type BST[T cmp.Ordered] struct{ root *bnode[T] }

func (t *BST[T]) Insert(v T) { t.root = insert(t.root, v) }
func insert[T cmp.Ordered](n *bnode[T], v T) *bnode[T] {
    if n == nil { return &bnode[T]{v: v} }
    switch cmp.Compare(v, n.v) {
    case -1: n.left = insert(n.left, v)
    case 1:  n.right = insert(n.right, v)
    }
    return n
}
```
For `float64`, NaN is treated by `cmp.Compare` as less than every non-NaN, so the tree stays well-formed.

### Solution 17
```go
type MultiSet[T comparable] struct {
    m map[T]int
}

func NewMultiSet[T comparable]() *MultiSet[T] { return &MultiSet[T]{m: map[T]int{}} }
func (s *MultiSet[T]) Add(v T)                { s.m[v]++ }
func (s *MultiSet[T]) Remove(v T) {
    if s.m[v] > 1 { s.m[v]--; return }
    delete(s.m, v)
}
func (s *MultiSet[T]) Count(v T) int { return s.m[v] }
func (s *MultiSet[T]) Total() int {
    n := 0
    for _, c := range s.m { n += c }
    return n
}
```
No ordering needed — only equality for the map key.

### Solution 18
```go
type OrderedCache[K cmp.Ordered, V any] struct {
    keys []K
    m    map[K]V
}

func (c *OrderedCache[K, V]) Set(k K, v V) {
    if _, ok := c.m[k]; !ok {
        i, _ := slices.BinarySearch(c.keys, k)
        c.keys = slices.Insert(c.keys, i, k)
    }
    if c.m == nil { c.m = map[K]V{} }
    c.m[k] = v
}

func (c *OrderedCache[K, V]) Scan(lo, hi K) []V {
    i, _ := slices.BinarySearch(c.keys, lo)
    out := []V{}
    for ; i < len(c.keys) && c.keys[i] <= hi; i++ {
        out = append(out, c.m[c.keys[i]])
    }
    return out
}
```
`K` is `cmp.Ordered` because of the range scan; equality alone would not allow `<=`.

### Solution 19
```go
import "reflect"

func StrictlyComparable(s []any) []any {
    out := []any{}
    for _, v := range s {
        if v == nil { continue }
        if reflect.TypeOf(v).Comparable() {
            out = append(out, v)
        }
    }
    return out
}
```
`reflect.TypeOf(...).Comparable()` is the runtime check for "is this strictly comparable".

### Solution 20
```go
import (
    "cmp"
    "math/cmplx"
    "slices"
)

func CompareComplex(a, b complex128) int {
    return cmp.Compare(cmplx.Abs(a), cmplx.Abs(b))
}

slices.SortFunc(cs, CompareComplex)
```
This implements **magnitude** ordering. Other policies (lexicographic, argument) are equally valid and equally explicit.

### Solution 21
```go
import (
    "cmp"
    "math"
    "slices"
)

func SortNaNLast(s []float64) {
    slices.SortFunc(s, func(a, b float64) int {
        aNaN := math.IsNaN(a)
        bNaN := math.IsNaN(b)
        switch {
        case aNaN && bNaN: return 0
        case aNaN:         return 1   // NaN goes after
        case bNaN:         return -1
        default:           return cmp.Compare(a, b)
        }
    })
}
```

### Solution 22
```go
type HashSet[T any] struct {
    buckets map[uint64][]T
    hash    func(T) uint64
    equal   func(T, T) bool
}

func NewHashSet[T any](hash func(T) uint64, equal func(T, T) bool) *HashSet[T] {
    return &HashSet[T]{
        buckets: map[uint64][]T{},
        hash:    hash,
        equal:   equal,
    }
}

func (s *HashSet[T]) Add(v T) {
    h := s.hash(v)
    for _, x := range s.buckets[h] {
        if s.equal(x, v) { return }
    }
    s.buckets[h] = append(s.buckets[h], v)
}

// Usage for []byte:
import "hash/fnv"
import "bytes"

byteHash := func(b []byte) uint64 {
    h := fnv.New64()
    h.Write(b)
    return h.Sum64()
}
byteEq := func(a, b []byte) bool { return bytes.Equal(a, b) }

set := NewHashSet[[]byte](byteHash, byteEq)
```

---

## Final notes

The recurring lesson: **constraint follows operation**.

- `Add`/`Has` on a map → `comparable`
- `Sort`/`Min`/`Max` → `cmp.Ordered`
- `time.Time`, `complex`, structs → `slices.SortFunc` with `cmp.Compare`
- `[]byte`, `[]int`, slice keys → `HashSet` with explicit hash and equal

Treat `comparable` and `cmp.Ordered` as the two heaviest gears in your generic toolbox. Reach for them by default; reach past them when the type does not fit.
