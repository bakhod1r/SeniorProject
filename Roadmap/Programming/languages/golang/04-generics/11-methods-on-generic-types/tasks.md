# Methods on Generic Types — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. Each task practises the **mechanics of generic-type methods** — receiver syntax, pointer vs value receivers, embedding, fluent chaining, and the free-function workaround.

---

## Easy 🟢

### Task 1 — Pair with Swap
Implement `Pair[K, V any]` with fields `Key K`, `Value V` and a method `Swap() Pair[V, K]`.

### Task 2 — Optional[T] basics
Implement `Optional[T any]` with constructors `Some[T any](v T) Optional[T]` and `None[T any]() Optional[T]`, plus methods `Get() (T, bool)`, `IsSet() bool`.

### Task 3 — Counter for numeric T
Implement `Counter[T ~int | ~int64]` with `Add(d T)`, `Sub(d T)`, `Value() T`, `Reset()`. Use pointer receivers where appropriate.

### Task 4 — Stack[T] complete
Write `Stack[T any]` with `Push(v T)`, `Pop() (T, bool)`, `Peek() (T, bool)`, `Len() int`. Choose receivers carefully.

### Task 5 — Box[T] with String
Add `String() string` to `Box[T any]` so `fmt.Println` calls it. Verify `Box[int]{v: 7}` satisfies `fmt.Stringer`.

---

## Medium 🟡

### Task 6 — Fluent Builder
Implement `Builder[T any]` with chained methods `Add(v T) *Builder[T]`, `Label(s string) *Builder[T]`, `Build() ([]T, string)`. Each call returns `*Builder[T]`.

### Task 7 — Optional with chained methods
Add chained methods to `Optional[T]`: `Or(other Optional[T]) Optional[T]`, `Default(v T) T`. Why is `Map` not possible as a method?

### Task 8 — Cache[K, V] with TTL
Implement `Cache[K comparable, V any]` with `Set(k K, v V)`, `Get(k K) (V, bool)`, `Delete(k K)`. Add `Len() int`.

### Task 9 — Embed a generic type
Make `LabeledList[T any]` embed `*List[T]` (use the linked list from a previous topic). Add `Label string` and `String() string`. Verify methods are promoted.

### Task 10 — Method shadowing
Embed `*Box[T]` in `LoudBox[T any]` and override `String()` to add an exclamation mark. Show how to call the inner method explicitly.

### Task 11 — Interface satisfaction per instantiation
Define `type IntPusher interface { Push(int) }`. Verify that `*Stack[int]` satisfies it but `*Stack[string]` does not.

### Task 12 — Free function for Map
Add a free function `Map[T, U any](s *Stack[T], f func(T) U) *Stack[U]`. Why can this not be a method?

### Task 13 — Constraint-tight wrapper
Define `Bag[T any]` with `Add(v T)`. Define `ComparableBag[T comparable]` that embeds `*Bag[T]` and adds `Distinct() []T`. Use both in `main`.

### Task 14 — Method values
Given `s := &Stack[int]{}`, store `s.Push` in a variable `push` and call it three times. What is the type of `push`?

---

## Hard 🔴

### Task 15 — Generic LRU cache with methods
Implement `LRU[K comparable, V any]` with `Get`, `Put`, `Len`, `Cap`. Use a doubly-linked list internally. Add an iterator method `ForEach(func(K, V))`.

### Task 16 — Atomic[T any]
Wrap `sync/atomic.Value` in `Atomic[T any]` with methods `Load() (T, bool)`, `Store(v T)`. Why does `Load` need `(T, bool)` rather than just `T`?

### Task 17 — Pub/sub Bus[T any]
Implement `Bus[T any]` with `Subscribe(func(T)) Cancel`, `Publish(v T)`. The `Cancel` is a `func()` returned to the subscriber. Use a mutex for thread safety.

### Task 18 — Multi-embedding ambiguity
Create types `A[T any]` and `B[T any]` each with method `Name() string`. Embed both in `C[T any]`. Demonstrate the ambiguity error and resolve it by adding a method on `C`.

### Task 19 — Method expression
Write a function `ApplyTo[T any](f func(*Stack[T], T), s *Stack[T], v T)` that calls `f(s, v)`. Pass `(*Stack[int]).Push` as `f`.

---

## Expert 🟣

### Task 20 — Nested generic types
Implement `Tree[T cmp.Ordered]` with nodes `node[T cmp.Ordered]`. Methods on `Tree[T]`: `Insert(v T)`, `Contains(v T) bool`, `InOrder() []T`. Note how nested generic types must repeat the constraint.

### Task 21 — Free-function Map vs method
Implement `Map[T, U any](b Box[T], f func(T) U) Box[U]` as a free function. Then attempt to write the same as a method to demonstrate the compile error.

### Task 22 — Generic method captured in closure
Write a function that takes `*Counter[int]` and returns a closure that increments it. Show how the receiver is captured.

---

## Solutions

### Solution 1
```go
type Pair[K, V any] struct {
    Key   K
    Value V
}

func (p Pair[K, V]) Swap() Pair[V, K] {
    return Pair[V, K]{Key: p.Value, Value: p.Key}
}
```

### Solution 2
```go
type Optional[T any] struct {
    value T
    set   bool
}

func Some[T any](v T) Optional[T] { return Optional[T]{value: v, set: true} }
func None[T any]() Optional[T]    { return Optional[T]{} }

func (o Optional[T]) Get() (T, bool) { return o.value, o.set }
func (o Optional[T]) IsSet() bool    { return o.set }
```

### Solution 3
```go
type Counter[T ~int | ~int64] struct {
    n T
}

func (c *Counter[T]) Add(d T) { c.n += d }
func (c *Counter[T]) Sub(d T) { c.n -= d }
func (c *Counter[T]) Reset()  { var zero T; c.n = zero }
func (c Counter[T]) Value() T { return c.n }
```

### Solution 4
```go
type Stack[T any] struct{ data []T }

func (s *Stack[T]) Push(v T)         { s.data = append(s.data, v) }
func (s *Stack[T]) Pop() (T, bool)   {
    var zero T
    if len(s.data) == 0 { return zero, false }
    n := len(s.data) - 1
    v := s.data[n]
    s.data = s.data[:n]
    return v, true
}
func (s Stack[T]) Peek() (T, bool) {
    var zero T
    if len(s.data) == 0 { return zero, false }
    return s.data[len(s.data)-1], true
}
func (s Stack[T]) Len() int { return len(s.data) }
```

### Solution 5
```go
type Box[T any] struct{ v T }
func (b Box[T]) String() string { return fmt.Sprintf("Box(%v)", b.v) }

var s fmt.Stringer = Box[int]{v: 7}
fmt.Println(s)  // Box(7)
```

### Solution 6
```go
type Builder[T any] struct {
    items []T
    label string
}

func (b *Builder[T]) Add(v T) *Builder[T]        { b.items = append(b.items, v); return b }
func (b *Builder[T]) Label(s string) *Builder[T] { b.label = s; return b }
func (b *Builder[T]) Build() ([]T, string)       { return b.items, b.label }

// Usage:
items, label := (&Builder[int]{}).Add(1).Add(2).Label("nums").Build()
```

### Solution 7
```go
func (o Optional[T]) Or(other Optional[T]) Optional[T] {
    if o.set { return o }
    return other
}

func (o Optional[T]) Default(v T) T {
    if o.set { return o.value }
    return v
}
```
`Map` would need a new type parameter `U` (the result type), which methods cannot introduce. Workaround: free function.

### Solution 8
```go
type Cache[K comparable, V any] struct {
    m map[K]V
}

func NewCache[K comparable, V any]() *Cache[K, V] {
    return &Cache[K, V]{m: map[K]V{}}
}

func (c *Cache[K, V]) Set(k K, v V)        { c.m[k] = v }
func (c *Cache[K, V]) Get(k K) (V, bool)   { v, ok := c.m[k]; return v, ok }
func (c *Cache[K, V]) Delete(k K)          { delete(c.m, k) }
func (c *Cache[K, V]) Len() int            { return len(c.m) }
```

### Solution 9
```go
type LabeledList[T any] struct {
    *List[T]
    Label string
}

func (l LabeledList[T]) String() string {
    return fmt.Sprintf("%s(len=%d)", l.Label, l.Len())
}
```
Methods of `*List[T]` like `PushFront`, `PushBack`, `Len` are promoted.

### Solution 10
```go
type LoudBox[T any] struct{ *Box[T] }

func (l LoudBox[T]) String() string {
    return l.Box.String() + "!"
}

// inner: l.Box.String()
// outer: l.String()
```

### Solution 11
```go
type IntPusher interface { Push(int) }

var p1 IntPusher = &Stack[int]{}
// var p2 IntPusher = &Stack[string]{} // ❌ — Push(string) does not match Push(int)
```

### Solution 12
```go
func Map[T, U any](s *Stack[T], f func(T) U) *Stack[U] {
    out := &Stack[U]{}
    for _, v := range s.data { out.Push(f(v)) }
    return out
}
```
A method cannot introduce `U`; only the receiver type's parameters are visible.

### Solution 13
```go
type Bag[T any] struct{ items []T }
func (b *Bag[T]) Add(v T) { b.items = append(b.items, v) }

type ComparableBag[T comparable] struct{ *Bag[T] }
func (b ComparableBag[T]) Distinct() []T {
    seen := map[T]struct{}{}
    out := make([]T, 0, len(b.items))
    for _, v := range b.items {
        if _, ok := seen[v]; !ok {
            seen[v] = struct{}{}
            out = append(out, v)
        }
    }
    return out
}
```

### Solution 14
```go
s := &Stack[int]{}
push := s.Push   // type: func(int)
push(1); push(2); push(3)
```
The method value captures `s` and resolves `T` to `int`.

### Solution 15
```go
type lruEntry[K comparable, V any] struct {
    k K; v V
    prev, next *lruEntry[K, V]
}

type LRU[K comparable, V any] struct {
    cap        int
    m          map[K]*lruEntry[K, V]
    head, tail *lruEntry[K, V]
}

func NewLRU[K comparable, V any](cap int) *LRU[K, V] {
    return &LRU[K, V]{cap: cap, m: map[K]*lruEntry[K, V]{}}
}

func (l *LRU[K, V]) Cap() int { return l.cap }
func (l *LRU[K, V]) Len() int { return len(l.m) }
// Get/Put/ForEach: standard LRU implementation
```

### Solution 16
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
`Load` needs the bool because `atomic.Value` returns nil for unset values; we cannot represent "no value" inside `T` alone.

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
    idx := len(b.subs)
    b.subs = append(b.subs, f)
    return func() {
        b.mu.Lock()
        defer b.mu.Unlock()
        b.subs[idx] = nil
    }
}

func (b *Bus[T]) Publish(v T) {
    b.mu.Lock()
    subs := append([]func(T){}, b.subs...)
    b.mu.Unlock()
    for _, f := range subs {
        if f != nil { f(v) }
    }
}
```

### Solution 18
```go
type A[T any] struct{}
func (A[T]) Name() string { return "A" }

type B[T any] struct{}
func (B[T]) Name() string { return "B" }

type C[T any] struct {
    A[T]
    B[T]
}

func (c C[T]) Name() string { return "C(" + c.A.Name() + "+" + c.B.Name() + ")" }

// Without C.Name: c.Name() is ambiguous → compile error.
```

### Solution 19
```go
func ApplyTo[T any](f func(*Stack[T], T), s *Stack[T], v T) { f(s, v) }

s := &Stack[int]{}
ApplyTo((*Stack[int]).Push, s, 42)
```
The method expression `(*Stack[int]).Push` has type `func(*Stack[int], int)`, matching `f`.

### Solution 20
```go
type node[T cmp.Ordered] struct {
    v          T
    left, right *node[T]
}

type Tree[T cmp.Ordered] struct{ root *node[T] }

func (t *Tree[T]) Insert(v T) { t.root = insert(t.root, v) }
func insert[T cmp.Ordered](n *node[T], v T) *node[T] {
    if n == nil { return &node[T]{v: v} }
    switch {
    case v < n.v: n.left = insert(n.left, v)
    case v > n.v: n.right = insert(n.right, v)
    }
    return n
}

func (t *Tree[T]) Contains(v T) bool { return contains(t.root, v) }
func contains[T cmp.Ordered](n *node[T], v T) bool {
    for n != nil {
        switch {
        case v < n.v: n = n.left
        case v > n.v: n = n.right
        default: return true
        }
    }
    return false
}

func (t *Tree[T]) InOrder() []T {
    out := []T{}
    var walk func(*node[T])
    walk = func(n *node[T]) {
        if n == nil { return }
        walk(n.left); out = append(out, n.v); walk(n.right)
    }
    walk(t.root)
    return out
}
```
Note: the inner type `node[T]` repeats the constraint `cmp.Ordered`.

### Solution 21
```go
// Free function — works
func Map[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{v: f(b.v)}
}

// Method version — does NOT compile:
// func (b Box[T]) Map[U any](f func(T) U) Box[U] { ❌ }
```

### Solution 22
```go
func makeIncrementer(c *Counter[int]) func() {
    return func() { c.Add(1) }
}

c := &Counter[int]{}
inc := makeIncrementer(c)
inc(); inc(); inc()
fmt.Println(c.Value())   // 3
```
The closure captures `c` (the receiver pointer), not the method itself. Equivalent to `inc := func() { c.Add(1) }`.

---

## Final notes

Patterns reinforced by these tasks:

1. **Receiver always repeats `[T]`** (Tasks 1-5).
2. **Pointer receiver for mutation** (Tasks 3, 4, 8).
3. **Fluent chaining returns the receiver type** (Task 6).
4. **No method-level type parameters — use a free function** (Tasks 12, 21).
5. **Embedding promotes methods after substitution** (Tasks 9, 10).
6. **Multi-embedding causes ambiguity unless resolved** (Task 18).
7. **Method values resolve the type parameter at binding time** (Task 14).
8. **Method expressions need explicit instantiation** (Task 19).

Senior advice: when designing a generic type, **list its methods on paper first**. If any method "wants" to introduce a new type parameter, plan a free function instead. The constraint-once rule shapes the entire API.
