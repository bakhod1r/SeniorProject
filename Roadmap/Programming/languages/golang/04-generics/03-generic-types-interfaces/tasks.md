# Generic Types & Interfaces — Tasks

This file contains 20+ exercises, ordered easy → hard. Each task has a goal, a starter signature where helpful, and acceptance criteria. Solutions are not included — try them first, then check against the standard library or your peers.

---

## Easy

### Task 1 — `Pair[K, V]`

Define a generic struct with `Key` and `Value` fields. Add constructors `NewPair[K, V]` and a method `String() string` that requires `K` to be a `fmt.Stringer`.

Hint: you may need *two* types: one for general `K, V`, one for stringable `K, V`. Or take a `keyToString` function in the constructor.

Acceptance: compiles for `Pair[string, int]`.

---

### Task 2 — `Set[T]`

Implement a generic set. Methods:

- `Add(v T)`
- `Has(v T) bool`
- `Remove(v T)`
- `Len() int`
- `ForEach(fn func(T))`

Use `T comparable`.

Acceptance: tests with `Set[int]` and `Set[string]` pass.

---

### Task 3 — `Stack[T]` revisited

Re-implement the canonical `Stack[T]` from junior.md. Add `Peek() (T, bool)` and `Clear()`. Cover with table-driven tests.

---

### Task 4 — `Queue[T]`

A FIFO queue with `Enqueue`, `Dequeue`, `Len`. Use a slice underneath; periodically reslice to avoid unbounded growth.

---

### Task 5 — `Optional[T]`

```go
type Optional[T any] struct { /* ... */ }
func Some[T any](v T) Optional[T] { ... }
func None[T any]() Optional[T] { ... }
func (o Optional[T]) Get() (T, bool) { ... }
func (o Optional[T]) OrElse(def T) T { ... }
```

Add a function `Map[T, U any](o Optional[T], fn func(T) U) Optional[U]`. (Top-level — not a method, because `U` is new.)

---

## Medium

### Task 6 — `Result[T]`

A value-or-error envelope with `Ok`, `Err`, `IsOk`, `Unwrap`. Add `Then[T, U any](r Result[T], fn func(T) Result[U]) Result[U]` as a top-level function (monadic chain).

---

### Task 7 — `OrderedMap[K, V]`

Like a regular map but preserves insertion order. Methods:

- `Set(k K, v V)`
- `Get(k K) (V, bool)`
- `Delete(k K)`
- `Keys() []K`
- `Values() []V`
- `ForEach(fn func(K, V))`

Hint: keep a slice of keys alongside a `map[K]V`.

---

### Task 8 — `RingBuffer[T]`

Fixed-capacity ring buffer:

```go
func NewRingBuffer[T any](cap int) *RingBuffer[T]
func (r *RingBuffer[T]) Push(v T) (overwritten bool, oldValue T)
func (r *RingBuffer[T]) Pop() (T, bool)
func (r *RingBuffer[T]) Len() int
func (r *RingBuffer[T]) Cap() int
```

Push on a full buffer overwrites the oldest element. Return whether overwriting happened and the displaced value.

---

### Task 9 — `Iterator[T]` interface + helpers

Define:

```go
type Iterator[T any] interface { Next() (T, bool) }
```

Implement:

- `SliceIter[T any]([]T) Iterator[T]`
- `MapIter[T, U any](Iterator[T], func(T) U) Iterator[U]`
- `FilterIter[T any](Iterator[T], func(T) bool) Iterator[T]`
- `Take[T any](Iterator[T], n int) Iterator[T]`
- `Collect[T any](Iterator[T]) []T`

These are top-level functions (not methods on `Iterator[T]`).

---

### Task 10 — `LinkedList[T]`

Singly-linked list with `Prepend`, `Append`, `ForEach`, `Reverse`, `Len`. Internal `node[T]` should be unexported.

---

### Task 11 — `BinaryTree[T]`

A binary search tree. Insertion takes a `less func(a, b T) bool` (passed in; do not constrain `T`).

- `Insert(v T)`
- `Contains(v T) bool`
- `InOrder() []T`
- `PreOrder() []T`

---

### Task 12 — `Comparator[T]` + sorting

```go
type Comparator[T any] interface { Compare(a, b T) int }
func SortWith[T any](xs []T, c Comparator[T])
```

Implement a basic insertion sort using `Comparator[T]`. Then write a `LessFuncComparator[T]` that wraps a `func(a, b T) bool` into a `Comparator[T]`.

---

### Task 13 — Generic graph

```go
type Graph[T comparable] struct { /* ... */ }
func (g *Graph[T]) AddNode(v T)
func (g *Graph[T]) AddEdge(from, to T)
func (g *Graph[T]) Neighbors(v T) []T
func (g *Graph[T]) BFS(start T, visit func(T))
func (g *Graph[T]) DFS(start T, visit func(T))
```

Acceptance: tested with `Graph[int]` and `Graph[string]`.

---

### Task 14 — Generic cache with TTL

Implement `Cache[K comparable, V any]` with TTL eviction. Provide:

- `Set(k K, v V)`
- `Get(k K) (V, bool)`
- `Delete(k K)`
- `StartCleaner(interval time.Duration, stop <-chan struct{})`

Make it concurrency-safe via `sync.RWMutex`.

---

## Hard

### Task 15 — Generic LRU cache

Implement `LRU[K comparable, V any]` with bounded capacity. Eviction by least-recently-used. Internally combine a `map[K]*entry[K, V]` and a doubly-linked list of `entry[K, V]`.

- `Set(k K, v V)` — evict LRU if over capacity
- `Get(k K) (V, bool)` — bumps the entry to MRU
- `Len() int`
- `Peek(k K) (V, bool)` — does *not* bump

---

### Task 16 — Generic event bus with cancel tokens

```go
type EventBus[E any] struct { /* ... */ }
func (b *EventBus[E]) Subscribe(h func(E)) (unsub func())
func (b *EventBus[E]) Publish(e E)
```

Multiple subscribers; `Publish` calls them all; `unsub` removes the handler. Make it safe under concurrent `Subscribe`/`Publish`.

---

### Task 17 — Generic worker pool

```go
type Pool[In, Out any] struct { /* ... */ }
func NewPool[In, Out any](workers int, fn func(context.Context, In) (Out, error)) *Pool[In, Out]
func (p *Pool[In, Out]) Submit(in In) <-chan Result[Out]
func (p *Pool[In, Out]) Close()
```

Result on a channel; cancel via context.

---

### Task 18 — Generic pipeline composer

Write three top-level helpers:

- `Stage[In, Out any](ctx, in <-chan In, fn func(In) (Out, error)) (<-chan Out, <-chan error)`
- `Source[T any](items []T) <-chan T`
- `Sink[T any](in <-chan T, fn func(T))`

Compose three stages on `int → string → []byte` and verify end-to-end behavior.

---

### Task 19 — `KeyValueStore[K, V]` interface + 3 implementations

Define the interface:

```go
type KeyValueStore[K comparable, V any] interface {
    Get(k K) (V, bool)
    Set(k K, v V)
    Delete(k K)
}
```

Implement three storage backends:

1. In-memory `map[K]V` with a mutex.
2. File-backed JSON store (one file per key).
3. Wrapper that adds metrics (count of Gets/Sets) without changing semantics.

Switch implementations via a constructor option.

---

### Task 20 — Generic state machine

```go
type StateMachine[S comparable, E comparable] struct { /* ... */ }
func NewStateMachine[S comparable, E comparable](initial S) *StateMachine[S, E]
func (m *StateMachine[S, E]) AddTransition(from S, on E, to S)
func (m *StateMachine[S, E]) Fire(e E) (S, bool)
func (m *StateMachine[S, E]) State() S
```

Tested with a traffic-light FSM (`type Light int; type Tick struct{}`).

---

### Task 21 — Concurrent-safe sharded map

```go
type ShardedMap[K comparable, V any] struct { /* ... */ }
func NewShardedMap[K comparable, V any](shards int, hash func(K) uint64) *ShardedMap[K, V]
func (m *ShardedMap[K, V]) Get(k K) (V, bool)
func (m *ShardedMap[K, V]) Set(k K, v V)
```

Each shard has its own mutex; routing via `hash(k) % shards`.

Bonus: add `RangeShard(idx int, fn func(K, V) bool)` that holds only one shard's lock at a time.

---

### Task 22 — Generic Bloom filter

```go
type BloomFilter[T any] struct { /* ... */ }
func NewBloomFilter[T any](size int, k int, hash func(T, int) uint64) *BloomFilter[T]
func (b *BloomFilter[T]) Add(v T)
func (b *BloomFilter[T]) MaybeContains(v T) bool
```

The hash function takes the value and an index `0..k-1`. Test with strings and ints.

---

### Task 23 — Generic merge sort

```go
func MergeSort[T any](xs []T, less func(a, b T) bool) []T
```

Pure functional style — return a new slice. Make sure it's stable.

---

### Task 24 — Generic priority queue

```go
type PriorityQueue[T any] struct { /* ... */ }
func NewPriorityQueue[T any](less func(a, b T) bool) *PriorityQueue[T]
func (pq *PriorityQueue[T]) Push(v T)
func (pq *PriorityQueue[T]) Pop() (T, bool)
func (pq *PriorityQueue[T]) Peek() (T, bool)
func (pq *PriorityQueue[T]) Len() int
```

Use a binary heap. Bonus: build it on top of `container/heap` by providing the right adapter (this requires a non-generic struct that wraps a `[]T`).

---

### Task 25 — Generic transactional store

```go
type TxStore[K comparable, V any] struct { /* ... */ }
func (s *TxStore[K, V]) Begin() *Tx[K, V]
type Tx[K comparable, V any] struct { /* ... */ }
func (t *Tx[K, V]) Get(k K) (V, bool)
func (t *Tx[K, V]) Set(k K, v V)
func (t *Tx[K, V]) Commit() error
func (t *Tx[K, V]) Rollback()
```

A simple in-memory MVCC: reads see a snapshot; writes happen in the transaction; commit applies them atomically; rollback discards.

---

## Extra credit

- **E1**: Try to write `func (s *Stack[T]) MapTo[U any](fn func(T) U) *Stack[U]` and observe the compiler error. Translate the message in your own words.
- **E2**: Write a `Cache[K, V]` whose values must satisfy `fmt.Stringer`. Compose a constraint that requires both `K comparable` and `V fmt.Stringer`.
- **E3**: Use the `cmp.Ordered` constraint (Go 1.21+) to write a generic `MinMax[T cmp.Ordered](xs []T) (min, max T)`.
- **E4**: Compare a generic `Sum[T Numeric](xs []T) T` against a `func Sum(xs []int64) int64` using benchmarks.
- **E5**: Convert a real package in your work codebase that uses `interface{}` containers to generic equivalents. Measure the impact (binary size, benchmark, compile time).

---

## Acceptance test idea — generic test helper

Use a helper to test multiple `T`s with one body:

```go
func testStack[T comparable](t *testing.T, items []T) {
    s := NewStack[T]()
    for _, v := range items { s.Push(v) }
    for i := len(items) - 1; i >= 0; i-- {
        v, ok := s.Pop()
        if !ok || v != items[i] { t.Fatalf("pop wrong") }
    }
}

func TestStackInt(t *testing.T)    { testStack(t, []int{1, 2, 3}) }
func TestStackString(t *testing.T) { testStack(t, []string{"a", "b"}) }
```

This pattern is itself a great practice exercise — the helper is generic, the test functions are not.

End of tasks.md.
