# 8.17 `container/*` — Specification

> Reference card for the three packages. Method signatures, contracts,
> and complexity. Authoritative source: the package source under
> `$GOROOT/src/container/`.

## 1. `container/heap`

### Interface

```go
type Interface interface {
    sort.Interface
    Push(x any) // add x as element Len()
    Pop() any   // remove and return element Len() - 1
}
```

`sort.Interface` requires `Len() int`, `Less(i, j int) bool`, and
`Swap(i, j int)`.

Contracts:

- `Less` must define a strict weak order, consistent across the
  lifetime of every element in the heap.
- `Push(x)` must append `x` at index `Len()`. Do not call algorithms
  inside it.
- `Pop()` must remove and return the element at index `Len() - 1`.
  The algorithm has already moved the smallest element there.
- `Swap(i, j)` must update any external bookkeeping (e.g., `index`
  fields on items).

Violating any of these gives undefined behavior. There is no runtime
check.

### Functions

| Function | Signature | Time | Notes |
|----------|-----------|------|-------|
| `Init` | `Init(h Interface)` | O(n) | Establishes the heap invariant on an arbitrary slice |
| `Push` | `Push(h Interface, x any)` | O(log n) | Calls `h.Push(x)` then sifts up |
| `Pop` | `Pop(h Interface) any` | O(log n) | Swaps root with tail, sifts down, calls `h.Pop()` |
| `Remove` | `Remove(h Interface, i int) any` | O(log n) | Removes element at index `i`; restores invariant |
| `Fix` | `Fix(h Interface, i int)` | O(log n) | Restores invariant after `h[i]` is mutated externally |

Required precondition for all functions except `Init`: the heap
invariant holds on entry. `Push` and `Pop` panic on `nil`
`Interface`.

### Heap invariant

For an n-element heap stored in a 0-indexed slice:

```
For all i in [1, n):
  !Less(i, parent(i))
where parent(i) = (i - 1) / 2
```

Equivalently: every parent is no greater (per `Less`) than each of
its children.

### Stability

Not stable. Items with equal priority can be popped in any order.

## 2. `container/list`

### Types

```go
type List struct {
    // private fields: root sentinel, len
}

type Element struct {
    Value any
    // private fields: next, prev, list
}
```

`*List` is the container. `*Element` is a node and is returned by
every method that inserts. `Element.Value` is the user payload, typed
`any`.

### `*List` methods

| Method | Signature | Time | Notes |
|--------|-----------|------|-------|
| `New` | `func New() *List` | O(1) | Constructor; returns an empty initialized list |
| `Init` | `(*List) Init() *List` | O(1) | Resets to empty; returns the receiver |
| `Len` | `(*List) Len() int` | O(1) | Number of elements |
| `Front` | `(*List) Front() *Element` | O(1) | First element or nil |
| `Back` | `(*List) Back() *Element` | O(1) | Last element or nil |
| `PushFront` | `(*List) PushFront(v any) *Element` | O(1) | Insert at head |
| `PushBack` | `(*List) PushBack(v any) *Element` | O(1) | Insert at tail |
| `InsertBefore` | `(*List) InsertBefore(v any, mark *Element) *Element` | O(1) | Insert before `mark`; nil if `mark` not in list |
| `InsertAfter` | `(*List) InsertAfter(v any, mark *Element) *Element` | O(1) | Insert after `mark`; nil if `mark` not in list |
| `Remove` | `(*List) Remove(e *Element) any` | O(1) | Remove `e`; returns `e.Value`; no-op if `e` not in list |
| `MoveToFront` | `(*List) MoveToFront(e *Element)` | O(1) | No-op if `e` not in list |
| `MoveToBack` | `(*List) MoveToBack(e *Element)` | O(1) | No-op if `e` not in list |
| `MoveBefore` | `(*List) MoveBefore(e, mark *Element)` | O(1) | No-op if either not in list, or e == mark |
| `MoveAfter` | `(*List) MoveAfter(e, mark *Element)` | O(1) | Same |
| `PushBackList` | `(*List) PushBackList(other *List)` | O(n) | Inserts a copy of `other` at the back |
| `PushFrontList` | `(*List) PushFrontList(other *List)` | O(n) | Inserts a copy of `other` at the front |

### `*Element` methods

| Method | Signature | Time |
|--------|-----------|------|
| `Next` | `(*Element) Next() *Element` | O(1) |
| `Prev` | `(*Element) Prev() *Element` | O(1) |

`Next()` returns nil at the tail. `Prev()` returns nil at the head.

### Cross-list operations

Methods that take an `*Element` (or two) silently no-op if the
element doesn't belong to the receiver list. There is no error and no
panic. This is by design but is a footgun; keep ownership clear.

### Zero-value list

`var l list.List` is usable; the first operation lazy-initializes
the sentinel. To use across goroutines, prefer `list.New()` or call
`l.Init()` first to avoid a lazy-init data race.

## 3. `container/ring`

### Type

```go
type Ring struct {
    Value any
    // private: next, prev
}
```

There is no separate "Ring" container. A "ring" is the cycle of
nodes reachable through `r.Next()`. A nil `*Ring` is the empty ring.

### Methods

| Method | Signature | Time | Notes |
|--------|-----------|------|-------|
| `New` | `func New(n int) *Ring` | O(n) | Creates a ring of `n` nodes; all `Value`s are nil |
| `Len` | `(*Ring) Len() int` | O(n) | Walks the ring; not O(1) |
| `Next` | `(*Ring) Next() *Ring` | O(1) | The node after `r` |
| `Prev` | `(*Ring) Prev() *Ring` | O(1) | The node before `r` |
| `Move` | `(*Ring) Move(n int) *Ring` | O(\|n\|) | Walks `n` steps (negative for backward) |
| `Link` | `(*Ring) Link(s *Ring) *Ring` | O(1) | Splices `s` after `r`; returns the original `r.Next()` |
| `Unlink` | `(*Ring) Unlink(n int) *Ring` | O(1) | Removes `n` nodes after `r`; returns them as a new ring |
| `Do` | `(*Ring) Do(f func(any))` | O(n) | Calls `f` on every node's `Value` |

### Splice semantics

`r.Link(s)` makes `s` follow `r` and returns the node that was
originally `r.Next()`. After `Link`, the original `r`'s ring and
`s`'s ring are joined into one bigger ring; the returned node heads a
new ring containing the elements that were previously after `r`.

`r.Unlink(n)` is the inverse: it removes the `n` nodes after `r` and
returns them as their own ring. The original ring loses `n` nodes;
the returned ring has exactly `n`.

### Concurrency

None of `container/heap`, `container/list`, or `container/ring` is
safe for concurrent use. Wrap with `sync.Mutex` if needed.

## 4. Cross-package interactions

### `heap.Interface` extends `sort.Interface`

The `sort.Interface` methods (`Len`, `Less`, `Swap`) are reused by
the heap algorithm. Any implementation of `heap.Interface` is also a
valid `sort.Interface`, so `sort.Sort(h)` works on a heap. The
result is a sorted slice (in `Less` order), and the heap invariant
no longer holds — you'd need to call `heap.Init(h)` to re-establish
it.

### Why `*Element` exists

Returning a handle from every insertion method is the only way
`container/list` can offer O(1) `Remove`/`Move` on user-chosen
positions. The `*Element` is the user-side cursor.

`*Element.Value` is `any`. In Go 1.18+, you can avoid the boxing
cost by storing pointers (`*MyType`) instead of values, or by
writing a generic wrapper around the package.

### Why `container/ring` has no separate container type

A ring with no distinguished "head" doesn't need one. Any node
identifies the cycle. This matches the implementation in textbooks
(e.g., the Linux kernel's `list_head`) and saves a pointer
dereference per access.

## 5. Quick reference

### Standard heap idiom

```go
type myHeap []T
func (h myHeap) Len() int            { return len(h) }
func (h myHeap) Less(i, j int) bool  { /* ordering */ }
func (h myHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *myHeap) Push(x any)         { *h = append(*h, x.(T)) }
func (h *myHeap) Pop() any {
    n := len(*h)
    x := (*h)[n-1]
    *h = (*h)[:n-1]
    return x
}

// usage
h := &myHeap{}
heap.Init(h)
heap.Push(h, v)
v := heap.Pop(h).(T)
```

### Standard list iteration

```go
for e := l.Front(); e != nil; e = e.Next() {
    v := e.Value.(T)
    _ = v
}
```

### Standard ring iteration

```go
r.Do(func(v any) {
    _ = v.(T)
})

// or manually
n := r
for {
    _ = n.Value.(T)
    n = n.Next()
    if n == r {
        break
    }
}
```

## 6. Known limitations

- **No generics.** Every API takes `any`. Callers boxer/unbox
  manually or write a wrapper.
- **No concurrency.** Wrap with a mutex.
- **No iteration safety.** Modifying a list during iteration is
  allowed for the current element (`Remove(e)` then `e = e.Next()`),
  but inserting into the middle of an active iteration can lead to
  surprises. Iterate to a slice first if mutations and iteration mix.
- **`container/ring.Len` is O(n).** Not a bug; document it or cache
  the count yourself.
- **No serialization.** None of these types implement
  `encoding.BinaryMarshaler` or `json.Marshaler`. Serialize the
  underlying slice or list-of-values yourself.

## 7. References

- [`container/heap`](https://pkg.go.dev/container/heap)
- [`container/list`](https://pkg.go.dev/container/list)
- [`container/ring`](https://pkg.go.dev/container/ring)
- Source: `$GOROOT/src/container/{heap,list,ring}/`
- Cross-link: [`../16-sort-slices-maps/`](../16-sort-slices-maps/junior.md)
