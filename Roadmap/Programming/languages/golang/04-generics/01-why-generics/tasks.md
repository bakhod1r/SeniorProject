# Why Generics? — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. Each task highlights **why generics help** — usually by asking you to compare a pre-1.18 solution with a generic one.

---

## Easy 🟢

### Task 1 — Convert duplicated functions to a generic
You are given:
```go
func MaxInt(a, b int) int { if a > b { return a }; return b }
func MaxFloat(a, b float64) float64 { if a > b { return a }; return b }
func MaxString(a, b string) string { if a > b { return a }; return b }
```
Replace them with a single generic function. Use `cmp.Ordered`.

### Task 2 — `Contains` for any comparable
Write `Contains[T comparable](s []T, target T) bool`. Compare to `slices.Contains`.

### Task 3 — `Reverse` a slice
Write `Reverse[T any](s []T) []T` that returns a new reversed slice.

### Task 4 — Stack
Write a `Stack[T any]` with `Push`, `Pop`, and `Len`. Why is generic Stack better than `Stack` based on `[]interface{}`?

### Task 5 — Generic `Sum`
Write `Sum[T Number](s []T) T` for any numeric `T`. Define your own `Number` constraint.

---

## Medium 🟡

### Task 6 — `Map` and `Filter`
Implement `Map[T, U any](s []T, f func(T) U) []U` and `Filter[T any](s []T, keep func(T) bool) []T`. Compare with their `interface{}` versions.

### Task 7 — Generic `Set`
Build `Set[T comparable]` with `Add`, `Has`, `Remove`, `Len`, `ToSlice`. Why is this impossible with a clean API in pre-1.18 Go?

### Task 8 — Type-safe atomic value
Write a tiny `Atomic[T any]` wrapper around `sync/atomic.Value` so callers do not need a type assertion on `Load()`.

### Task 9 — Pair / tuple
Define `Pair[A, B any]` with fields `First A; Second B` and a method `Swap() Pair[B, A]`. Why is the `Swap` signature interesting?

### Task 10 — Refactor an `interface{}` cache
Given:
```go
type Cache struct { m map[string]interface{} }
func (c *Cache) Set(k string, v interface{}) { c.m[k] = v }
func (c *Cache) Get(k string) (interface{}, bool) { v, ok := c.m[k]; return v, ok }
```
Convert to `Cache[K comparable, V any]`.

### Task 11 — Generic `Min` over a slice
Write `MinSlice[T cmp.Ordered](s []T) (T, bool)` that returns `(zero, false)` when empty.

### Task 12 — `Reduce`
Write `Reduce[T, R any](s []T, init R, f func(R, T) R) R`. Use it to compute the sum of squares of a `[]int`.

### Task 13 — `Keys` and `Values` of a map
Write generic `Keys[K comparable, V any](m map[K]V) []K` and `Values`. How are the two type parameters used?

### Task 14 — Generic linked list
Implement `List[T any]` with `PushFront`, `PushBack`, `Len`, and an iterator method.

---

## Hard 🔴

### Task 15 — Generic `Result[T any]`
Implement `Result[T any]{ Value T; Err error }` with helpers `Ok[T](v T)`, `Err[T](err error)`, and `(r Result[T]) Unwrap() (T, error)`. Discuss whether this is idiomatic in Go.

### Task 16 — Generic LRU cache
Implement `LRU[K comparable, V any]` with `Get`, `Put`, and configurable capacity. Use a map plus a doubly-linked list. Compare with the pre-generic version that returned `interface{}`.

### Task 17 — Type-safe event bus
Implement `Bus[T any]` with `Subscribe(func(T)) Cancel` and `Publish(T)`. Why is this strictly better than an `interface{}`-based bus?

### Task 18 — `Coalesce` (first non-zero)
Write `Coalesce[T comparable](vals ...T) T` returning the first non-zero value. Compare with `cmp.Or` in Go 1.22+.

### Task 19 — Type-safe pagination
Define `Page[T any]{ Items []T; Total int; Cursor string }` and a function `FetchAll[T any](fetch func(cursor string) (Page[T], error)) ([]T, error)`. Highlight the type-safety gain.

---

## Expert 🟣

### Task 20 — Generic `Tree[T cmp.Ordered]` BST
Implement insert, search, and in-order traversal. Walk the user through the cost of GC shape stenciling for many distinct `T` types in the same binary.

### Task 21 — Constraint-driven design
Write `Distinct[T comparable](s []T) []T` that preserves order. Then write a benchmark comparing it to an `interface{}`-based version. Show the allocation difference.

### Task 22 — Convert a code-generated package
Take this `genny`-generated snippet:
```go
//go:generate genny -in=set.go -out=int_set.go gen "T=int"
type IntSet struct { m map[int]struct{} }
func (s *IntSet) Add(v int) { s.m[v] = struct{}{} }
```
Replace the entire codegen pipeline with one generic type. Discuss the workflow improvement.

---

## Solutions

### Solution 1
```go
import "cmp"

func Max[T cmp.Ordered](a, b T) T {
    if a > b { return a }
    return b
}
```

### Solution 2
```go
func Contains[T comparable](s []T, target T) bool {
    for _, v := range s {
        if v == target { return true }
    }
    return false
}
```
The stdlib `slices.Contains` is identical.

### Solution 3
```go
func Reverse[T any](s []T) []T {
    n := len(s)
    out := make([]T, n)
    for i, v := range s { out[n-1-i] = v }
    return out
}
```

### Solution 4
```go
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Push(v T)         { s.data = append(s.data, v) }
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.data) == 0 { return zero, false }
    n := len(s.data) - 1
    v := s.data[n]
    s.data = s.data[:n]
    return v, true
}
func (s *Stack[T]) Len() int { return len(s.data) }
```
Better than `[]interface{}` because: no boxing, no `.(T)` assertions, no runtime panics.

### Solution 5
```go
type Number interface { ~int | ~int64 | ~float64 }

func Sum[T Number](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}
```

### Solution 6
```go
func Map[T, U any](s []T, f func(T) U) []U {
    out := make([]U, len(s))
    for i, v := range s { out[i] = f(v) }
    return out
}

func Filter[T any](s []T, keep func(T) bool) []T {
    out := make([]T, 0, len(s))
    for _, v := range s {
        if keep(v) { out = append(out, v) }
    }
    return out
}
```
The `interface{}` versions force boxing and assertions on each callback.

### Solution 7
```go
type Set[T comparable] struct{ m map[T]struct{} }
func NewSet[T comparable]() *Set[T] { return &Set[T]{m: map[T]struct{}{}} }
func (s *Set[T]) Add(v T)           { s.m[v] = struct{}{} }
func (s *Set[T]) Has(v T) bool      { _, ok := s.m[v]; return ok }
func (s *Set[T]) Remove(v T)        { delete(s.m, v) }
func (s *Set[T]) Len() int          { return len(s.m) }
func (s *Set[T]) ToSlice() []T {
    out := make([]T, 0, len(s.m))
    for k := range s.m { out = append(out, k) }
    return out
}
```
Pre-1.18, the only options were `map[interface{}]struct{}` (loses type safety) or codegen.

### Solution 8
```go
import "sync/atomic"

type Atomic[T any] struct{ v atomic.Value }

func (a *Atomic[T]) Store(v T) { a.v.Store(v) }
func (a *Atomic[T]) Load() (T, bool) {
    v := a.v.Load()
    if v == nil { var zero T; return zero, false }
    return v.(T), true
}
```

### Solution 9
```go
type Pair[A, B any] struct {
    First  A
    Second B
}
func (p Pair[A, B]) Swap() Pair[B, A] {
    return Pair[B, A]{First: p.Second, Second: p.First}
}
```
Note: the return type **rebinds** the parameters in reverse. `B` and `A` swap roles.

### Solution 10
```go
type Cache[K comparable, V any] struct{ m map[K]V }
func NewCache[K comparable, V any]() *Cache[K, V] { return &Cache[K, V]{m: map[K]V{}} }
func (c *Cache[K, V]) Set(k K, v V) { c.m[k] = v }
func (c *Cache[K, V]) Get(k K) (V, bool) { v, ok := c.m[k]; return v, ok }
```

### Solution 11
```go
func MinSlice[T cmp.Ordered](s []T) (T, bool) {
    var zero T
    if len(s) == 0 { return zero, false }
    m := s[0]
    for _, v := range s[1:] {
        if v < m { m = v }
    }
    return m, true
}
```

### Solution 12
```go
func Reduce[T, R any](s []T, init R, f func(R, T) R) R {
    acc := init
    for _, v := range s { acc = f(acc, v) }
    return acc
}

sumSquares := Reduce([]int{1,2,3}, 0, func(acc, v int) int { return acc + v*v })
// sumSquares == 14
```

### Solution 13
```go
func Keys[K comparable, V any](m map[K]V) []K {
    out := make([]K, 0, len(m))
    for k := range m { out = append(out, k) }
    return out
}
func Values[K comparable, V any](m map[K]V) []V {
    out := make([]V, 0, len(m))
    for _, v := range m { out = append(out, v) }
    return out
}
```
`K comparable` is required because all map keys are. `V any` because values have no constraint.

### Solution 14
```go
type listNode[T any] struct {
    v        T
    next, prev *listNode[T]
}

type List[T any] struct {
    head, tail *listNode[T]
    n          int
}

func (l *List[T]) PushBack(v T) {
    n := &listNode[T]{v: v, prev: l.tail}
    if l.tail != nil { l.tail.next = n } else { l.head = n }
    l.tail = n
    l.n++
}
func (l *List[T]) Len() int { return l.n }
```
`*listNode[T]` references must include the type parameter.

### Solution 15
```go
type Result[T any] struct {
    Value T
    Err   error
}
func Ok[T any](v T) Result[T]   { return Result[T]{Value: v} }
func Err[T any](e error) Result[T] {
    var zero T
    return Result[T]{Value: zero, Err: e}
}
func (r Result[T]) Unwrap() (T, error) { return r.Value, r.Err }
```
Idiomatic Go prefers `(value, err)` returns directly. `Result[T]` is sometimes useful in pipelines but should not replace plain returns everywhere.

### Solution 16
```go
type entry[K comparable, V any] struct {
    k K; v V
    prev, next *entry[K, V]
}
type LRU[K comparable, V any] struct {
    cap  int
    m    map[K]*entry[K, V]
    head, tail *entry[K, V]
}
// Get/Put implementations follow the standard LRU algorithm — see
// hashicorp/golang-lru/v2 for a real-world reference.
```

### Solution 17
```go
type Bus[T any] struct {
    mu   sync.Mutex
    subs []func(T)
}
type Cancel func()

func (b *Bus[T]) Subscribe(f func(T)) Cancel {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.subs = append(b.subs, f)
    idx := len(b.subs) - 1
    return func() {
        b.mu.Lock(); defer b.mu.Unlock()
        b.subs[idx] = nil
    }
}
func (b *Bus[T]) Publish(v T) {
    b.mu.Lock(); subs := append([]func(T){}, b.subs...); b.mu.Unlock()
    for _, f := range subs { if f != nil { f(v) } }
}
```
Generic bus avoids the assertion `evt.(MyEvent)` on every subscriber.

### Solution 18
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

### Solution 19
```go
type Page[T any] struct {
    Items  []T
    Total  int
    Cursor string
}

func FetchAll[T any](fetch func(cursor string) (Page[T], error)) ([]T, error) {
    var all []T
    cur := ""
    for {
        p, err := fetch(cur)
        if err != nil { return nil, err }
        all = append(all, p.Items...)
        if p.Cursor == "" { return all, nil }
        cur = p.Cursor
    }
}
```
Without generics, `Page` would have to hold `[]interface{}` and every caller would assert.

### Solution 20
```go
type BST[T cmp.Ordered] struct{ root *bnode[T] }
type bnode[T cmp.Ordered] struct{ v T; left, right *bnode[T] }

func (t *BST[T]) Insert(v T) {
    t.root = insert(t.root, v)
}
func insert[T cmp.Ordered](n *bnode[T], v T) *bnode[T] {
    if n == nil { return &bnode[T]{v: v} }
    switch {
    case v < n.v: n.left = insert(n.left, v)
    case v > n.v: n.right = insert(n.right, v)
    }
    return n
}
```
GC shape note: every distinct `T` produces its own dictionary. Programs that instantiate `BST` for many domain types pay a small extra binary-size cost.

### Solution 21
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

// Benchmark vs interface{} version: the generic version avoids the
// (T, data) box for each element and saves O(n) heap allocations.
```

### Solution 22
```go
type Set[T comparable] struct{ m map[T]struct{} }
func NewSet[T comparable]() *Set[T] { return &Set[T]{m: map[T]struct{}{}} }
func (s *Set[T]) Add(v T) { s.m[v] = struct{}{} }
```
Workflow improvement: no `go generate` step, no per-type files, no IDE confusion. One type, every concrete instance is just a different instantiation.

---

## Final notes

These tasks are deliberately small. The real lesson is **comparison**: every solution should be paired in your mind with the pre-1.18 alternative. The point is not the new syntax; it is what generics let you stop doing.
