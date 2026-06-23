# Generic Functions — Tasks

## Table of Contents
1. [Introduction](#introduction)
2. [Easy Tasks](#easy-tasks)
3. [Medium Tasks](#medium-tasks)
4. [Hard Tasks](#hard-tasks)
5. [Bonus Tasks](#bonus-tasks)
6. [Test Templates](#test-templates)
7. [Summary](#summary)

---

## Introduction

20+ exercises arranged from easy to hard. Each task gives:
- A clear signature
- A short description
- A reference solution (collapsed)
- Where useful, a sketch of tests

Use these as practice: try the signature first, write tests, then peek at the solution.

---

## Easy Tasks

### Task 1 — `Identity`

Write a generic function `Identity[T any](x T) T` that returns its input unchanged.

<details>
<summary>Solution</summary>

```go
func Identity[T any](x T) T { return x }
```

</details>

### Task 2 — `Pair`

Write `Pair[T any](a, b T) [2]T` that returns the two arguments as an array.

<details>
<summary>Solution</summary>

```go
func Pair[T any](a, b T) [2]T { return [2]T{a, b} }
```

</details>

### Task 3 — `First` and `Last`

Write `First[T any](xs []T) (T, bool)` and `Last[T any](xs []T) (T, bool)`.

<details>
<summary>Solution</summary>

```go
func First[T any](xs []T) (T, bool) {
    if len(xs) == 0 { var z T; return z, false }
    return xs[0], true
}

func Last[T any](xs []T) (T, bool) {
    if len(xs) == 0 { var z T; return z, false }
    return xs[len(xs)-1], true
}
```

</details>

### Task 4 — `Repeat`

Write `Repeat[T any](x T, n int) []T` that returns a slice with `x` repeated `n` times.

<details>
<summary>Solution</summary>

```go
func Repeat[T any](x T, n int) []T {
    if n <= 0 { return nil }
    out := make([]T, n)
    for i := range out { out[i] = x }
    return out
}
```

</details>

### Task 5 — `Contains`

Write `Contains[T comparable](xs []T, target T) bool`.

<details>
<summary>Solution</summary>

```go
func Contains[T comparable](xs []T, target T) bool {
    for _, x := range xs {
        if x == target { return true }
    }
    return false
}
```

</details>

### Task 6 — `IndexOf`

Write `IndexOf[T comparable](xs []T, target T) int`. Return `-1` if not found.

<details>
<summary>Solution</summary>

```go
func IndexOf[T comparable](xs []T, target T) int {
    for i, x := range xs {
        if x == target { return i }
    }
    return -1
}
```

</details>

### Task 7 — `Reverse`

Write `Reverse[T any](xs []T)` that reverses `xs` in place.

<details>
<summary>Solution</summary>

```go
func Reverse[T any](xs []T) {
    for i, j := 0, len(xs)-1; i < j; i, j = i+1, j-1 {
        xs[i], xs[j] = xs[j], xs[i]
    }
}
```

</details>

---

## Medium Tasks

### Task 8 — `Map`

Write `Map[T, U any](xs []T, f func(T) U) []U`.

<details>
<summary>Solution</summary>

```go
func Map[T, U any](xs []T, f func(T) U) []U {
    out := make([]U, len(xs))
    for i, x := range xs {
        out[i] = f(x)
    }
    return out
}
```

</details>

### Task 9 — `Filter`

Write `Filter[T any](xs []T, pred func(T) bool) []T`.

<details>
<summary>Solution</summary>

```go
func Filter[T any](xs []T, pred func(T) bool) []T {
    out := make([]T, 0, len(xs))
    for _, x := range xs {
        if pred(x) { out = append(out, x) }
    }
    return out
}
```

</details>

### Task 10 — `Reduce`

Write `Reduce[T, U any](xs []T, init U, f func(U, T) U) U`.

<details>
<summary>Solution</summary>

```go
func Reduce[T, U any](xs []T, init U, f func(U, T) U) U {
    acc := init
    for _, x := range xs {
        acc = f(acc, x)
    }
    return acc
}
```

</details>

### Task 11 — `Zip`

Write `Zip[T, U any](as []T, bs []U) []struct{ A T; B U }`. Stop at the shorter slice.

<details>
<summary>Solution</summary>

```go
func Zip[T, U any](as []T, bs []U) []struct{ A T; B U } {
    n := len(as)
    if len(bs) < n { n = len(bs) }
    out := make([]struct{ A T; B U }, n)
    for i := 0; i < n; i++ {
        out[i] = struct{ A T; B U }{as[i], bs[i]}
    }
    return out
}
```

</details>

### Task 12 — `Flatten`

Write `Flatten[T any](xs [][]T) []T`.

<details>
<summary>Solution</summary>

```go
func Flatten[T any](xs [][]T) []T {
    total := 0
    for _, s := range xs { total += len(s) }
    out := make([]T, 0, total)
    for _, s := range xs {
        out = append(out, s...)
    }
    return out
}
```

</details>

### Task 13 — `GroupBy`

Write `GroupBy[T any, K comparable](xs []T, key func(T) K) map[K][]T`.

<details>
<summary>Solution</summary>

```go
func GroupBy[T any, K comparable](xs []T, key func(T) K) map[K][]T {
    out := make(map[K][]T)
    for _, x := range xs {
        k := key(x)
        out[k] = append(out[k], x)
    }
    return out
}
```

</details>

### Task 14 — `Uniq`

Write `Uniq[T comparable](xs []T) []T` preserving original order.

<details>
<summary>Solution</summary>

```go
func Uniq[T comparable](xs []T) []T {
    seen := make(map[T]struct{}, len(xs))
    out := make([]T, 0, len(xs))
    for _, x := range xs {
        if _, ok := seen[x]; ok { continue }
        seen[x] = struct{}{}
        out = append(out, x)
    }
    return out
}
```

</details>

### Task 15 — `Chunk`

Write `Chunk[T any](xs []T, size int) [][]T`. If `size <= 0`, return `nil`.

<details>
<summary>Solution</summary>

```go
func Chunk[T any](xs []T, size int) [][]T {
    if size <= 0 { return nil }
    out := make([][]T, 0, (len(xs)+size-1)/size)
    for i := 0; i < len(xs); i += size {
        end := i + size
        if end > len(xs) { end = len(xs) }
        out = append(out, xs[i:end])
    }
    return out
}
```

</details>

### Task 16 — `Partition`

Write `Partition[T any](xs []T, pred func(T) bool) (yes, no []T)`.

<details>
<summary>Solution</summary>

```go
func Partition[T any](xs []T, pred func(T) bool) (yes, no []T) {
    for _, x := range xs {
        if pred(x) { yes = append(yes, x) } else { no = append(no, x) }
    }
    return
}
```

</details>

---

## Hard Tasks

### Task 17 — `Memoize`

Write a thread-safe `Memoize[K comparable, V any](f func(K) V) func(K) V`.

<details>
<summary>Solution</summary>

```go
func Memoize[K comparable, V any](f func(K) V) func(K) V {
    var mu sync.Mutex
    cache := make(map[K]V)
    return func(k K) V {
        mu.Lock()
        if v, ok := cache[k]; ok {
            mu.Unlock()
            return v
        }
        mu.Unlock()
        v := f(k) // compute outside the lock
        mu.Lock()
        cache[k] = v
        mu.Unlock()
        return v
    }
}
```

Note: this allows concurrent computation of the same key. To prevent it, use `singleflight` or hold the lock through computation.

</details>

### Task 18 — `LRU` helper using `container/list`

Sketch a generic `LRUCache[K comparable, V any]` with `Get` / `Put` / `Len`.

<details>
<summary>Solution sketch</summary>

```go
type entry[K comparable, V any] struct {
    key   K
    value V
}

type LRUCache[K comparable, V any] struct {
    capacity int
    items    map[K]*list.Element
    order    *list.List
    mu       sync.Mutex
}

func NewLRU[K comparable, V any](capacity int) *LRUCache[K, V] {
    return &LRUCache[K, V]{
        capacity: capacity,
        items:    make(map[K]*list.Element, capacity),
        order:    list.New(),
    }
}

func (c *LRUCache[K, V]) Get(k K) (V, bool) {
    c.mu.Lock(); defer c.mu.Unlock()
    if el, ok := c.items[k]; ok {
        c.order.MoveToFront(el)
        return el.Value.(*entry[K, V]).value, true
    }
    var zero V
    return zero, false
}

func (c *LRUCache[K, V]) Put(k K, v V) {
    c.mu.Lock(); defer c.mu.Unlock()
    if el, ok := c.items[k]; ok {
        c.order.MoveToFront(el)
        el.Value.(*entry[K, V]).value = v
        return
    }
    el := c.order.PushFront(&entry[K, V]{k, v})
    c.items[k] = el
    if c.order.Len() > c.capacity {
        oldest := c.order.Back()
        c.order.Remove(oldest)
        delete(c.items, oldest.Value.(*entry[K, V]).key)
    }
}

func (c *LRUCache[K, V]) Len() int {
    c.mu.Lock(); defer c.mu.Unlock()
    return c.order.Len()
}
```

</details>

### Task 19 — `MapErr`

Write `MapErr[T, U any](xs []T, f func(T) (U, error)) ([]U, error)`. Return on first error.

<details>
<summary>Solution</summary>

```go
func MapErr[T, U any](xs []T, f func(T) (U, error)) ([]U, error) {
    out := make([]U, len(xs))
    for i, x := range xs {
        y, err := f(x)
        if err != nil {
            return nil, fmt.Errorf("MapErr at %d: %w", i, err)
        }
        out[i] = y
    }
    return out, nil
}
```

</details>

### Task 20 — `ParallelMap` with bounded concurrency

Write `ParallelMap[T, U any](ctx context.Context, xs []T, n int, f func(context.Context, T) (U, error)) ([]U, error)`.

<details>
<summary>Solution</summary>

```go
func ParallelMap[T, U any](
    ctx context.Context, xs []T, n int,
    f func(context.Context, T) (U, error),
) ([]U, error) {
    out := make([]U, len(xs))
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(n)
    for i, x := range xs {
        i, x := i, x
        g.Go(func() error {
            v, err := f(ctx, x)
            if err != nil { return err }
            out[i] = v
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return out, nil
}
```

</details>

### Task 21 — `Compose`

Write `Compose[A, B, C any](f func(A) B, g func(B) C) func(A) C`. Then write `Compose3[A, B, C, D any](...)`.

<details>
<summary>Solution</summary>

```go
func Compose[A, B, C any](f func(A) B, g func(B) C) func(A) C {
    return func(a A) C { return g(f(a)) }
}

func Compose3[A, B, C, D any](
    f func(A) B, g func(B) C, h func(C) D,
) func(A) D {
    return func(a A) D { return h(g(f(a))) }
}
```

</details>

### Task 22 — Generic event bus

Write a simple `EventBus[T any]` with `Subscribe(h func(T)) (cancel func())` and `Publish(e T)`. Make it concurrency-safe.

<details>
<summary>Solution sketch</summary>

```go
type EventBus[T any] struct {
    mu          sync.RWMutex
    subscribers map[uint64]func(T)
    next        uint64
}

func NewEventBus[T any]() *EventBus[T] {
    return &EventBus[T]{subscribers: make(map[uint64]func(T))}
}

func (b *EventBus[T]) Subscribe(h func(T)) func() {
    b.mu.Lock()
    id := b.next
    b.next++
    b.subscribers[id] = h
    b.mu.Unlock()
    return func() {
        b.mu.Lock()
        delete(b.subscribers, id)
        b.mu.Unlock()
    }
}

func (b *EventBus[T]) Publish(e T) {
    b.mu.RLock()
    handlers := make([]func(T), 0, len(b.subscribers))
    for _, h := range b.subscribers { handlers = append(handlers, h) }
    b.mu.RUnlock()
    for _, h := range handlers { h(e) }
}
```

</details>

---

## Bonus Tasks

### Task 23 — `Window`

Write `Window[T any](xs []T, size int) [][]T` that returns all sliding windows of length `size`.

<details>
<summary>Solution</summary>

```go
func Window[T any](xs []T, size int) [][]T {
    if size <= 0 || size > len(xs) { return nil }
    out := make([][]T, 0, len(xs)-size+1)
    for i := 0; i+size <= len(xs); i++ {
        out = append(out, xs[i:i+size])
    }
    return out
}
```

</details>

### Task 24 — `Distinct` by key

Write `DistinctBy[T any, K comparable](xs []T, key func(T) K) []T`.

<details>
<summary>Solution</summary>

```go
func DistinctBy[T any, K comparable](xs []T, key func(T) K) []T {
    seen := make(map[K]struct{}, len(xs))
    out := make([]T, 0, len(xs))
    for _, x := range xs {
        k := key(x)
        if _, ok := seen[k]; ok { continue }
        seen[k] = struct{}{}
        out = append(out, x)
    }
    return out
}
```

</details>

### Task 25 — `Coalesce`

Write `Coalesce[T comparable](xs ...T) T` that returns the first non-zero argument.

<details>
<summary>Solution</summary>

```go
func Coalesce[T comparable](xs ...T) T {
    var zero T
    for _, x := range xs {
        if x != zero { return x }
    }
    return zero
}
```

</details>

### Task 26 — Async pipeline

Write a generic `Stage[T, U any]` chain: each stage reads from a channel of `T` and produces a channel of `U`.

<details>
<summary>Solution sketch</summary>

```go
func Stage[T, U any](in <-chan T, f func(T) U) <-chan U {
    out := make(chan U)
    go func() {
        defer close(out)
        for x := range in {
            out <- f(x)
        }
    }()
    return out
}

// Usage:
src := make(chan int)
go func() {
    defer close(src)
    for i := 0; i < 5; i++ { src <- i }
}()
strs := Stage(src, strconv.Itoa)
upper := Stage(strs, strings.ToUpper)
for s := range upper { fmt.Println(s) }
```

</details>

---

## Test Templates

A small example for your tests:

```go
func TestMap(t *testing.T) {
    cases := []struct {
        name string
        in   []int
        want []string
    }{
        {"empty", nil, []string{}},
        {"one", []int{1}, []string{"1"}},
        {"many", []int{1, 2, 3}, []string{"1", "2", "3"}},
    }
    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            got := Map(c.in, strconv.Itoa)
            if !reflect.DeepEqual(got, c.want) {
                t.Errorf("Map(%v) = %v; want %v", c.in, got, c.want)
            }
        })
    }
}

func TestUniq(t *testing.T) {
    in := []int{1, 2, 2, 3, 1, 4}
    want := []int{1, 2, 3, 4}
    if got := Uniq(in); !reflect.DeepEqual(got, want) {
        t.Errorf("Uniq = %v; want %v", got, want)
    }
}
```

For benchmarking:

```go
func BenchmarkMap(b *testing.B) {
    xs := make([]int, 1000)
    for i := range xs { xs[i] = i }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = Map(xs, func(n int) int { return n * 2 })
    }
}
```

---

## Summary

These exercises build muscle memory for the patterns you'll write daily: slice utilities, key-based grouping, parallel transforms, simple caches. Solving them top-to-bottom gives you working drafts of a generic helper library; solving the bonus tasks pushes you closer to mid-level fluency.

[← interview.md](./interview.md) · [find-bug.md →](./find-bug.md)
