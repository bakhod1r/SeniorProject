# 8.17 `container/*` — Middle

> **Audience.** You've done the basics in [junior.md](junior.md) and
> you can write a working priority queue and a list-based LRU. This
> file is the production-leaning material: priority-queue updates,
> the full LRU cache, generic wrappers polished, and how the modern
> ecosystem replaces (or doesn't) these packages.

## 1. The priority queue, completed

The PQ in junior.md supports `Push` and `Pop`. Real schedulers also
need `Update` (change an item's priority while it sits in the queue)
and `Remove` (cancel a queued item). Both are O(log n) and both rely
on the `index` field that `Swap` maintains.

```go
package main

import "container/heap"

type Item struct {
    Value    string
    Priority int
    index    int
}

type PriorityQueue []*Item

func (pq PriorityQueue) Len() int            { return len(pq) }
func (pq PriorityQueue) Less(i, j int) bool  { return pq[i].Priority > pq[j].Priority }
func (pq PriorityQueue) Swap(i, j int)       {
    pq[i], pq[j] = pq[j], pq[i]
    pq[i].index = i
    pq[j].index = j
}

func (pq *PriorityQueue) Push(x any) {
    item := x.(*Item)
    item.index = len(*pq)
    *pq = append(*pq, item)
}

func (pq *PriorityQueue) Pop() any {
    old := *pq
    n := len(old)
    item := old[n-1]
    old[n-1] = nil
    item.index = -1
    *pq = old[:n-1]
    return item
}

// Update changes the priority of an item already in the queue.
func (pq *PriorityQueue) Update(item *Item, priority int) {
    item.Priority = priority
    heap.Fix(pq, item.index)
}

// Cancel removes a queued item.
func (pq *PriorityQueue) Cancel(item *Item) {
    if item.index < 0 {
        return // already removed
    }
    heap.Remove(pq, item.index)
}
```

Three notes:

1. **`item.index = -1` after `Pop`.** A defensive flag so `Cancel`
   doesn't double-remove. Without it, calling `Cancel` on an
   already-popped item misuses `heap.Remove` and corrupts the heap.

2. **The pointer matters.** `Update` takes `*Item`, not an index. The
   caller doesn't know or care about the heap position — they just
   keep a reference to the item they enqueued.

3. **`heap.Remove` returns the removed value.** You don't need it for
   `Cancel`, but other use cases do (e.g., a job scheduler that wants
   to log the cancelled job's metadata).

## 2. A timer wheel built on `heap`

A scheduler wakes up at the deadline of the earliest pending event,
fires it, schedules anything new, and sleeps again. The earliest event
is `pq[0]`; pushing a new event is O(log n).

```go
type Timer struct {
    Deadline time.Time
    Fire     func()
    index    int
}

type Timers []*Timer

func (t Timers) Len() int           { return len(t) }
func (t Timers) Less(i, j int) bool { return t[i].Deadline.Before(t[j].Deadline) }
func (t Timers) Swap(i, j int)      {
    t[i], t[j] = t[j], t[i]
    t[i].index = i
    t[j].index = j
}
func (t *Timers) Push(x any) {
    item := x.(*Timer)
    item.index = len(*t)
    *t = append(*t, item)
}
func (t *Timers) Pop() any {
    old := *t
    n := len(old)
    item := old[n-1]
    old[n-1] = nil
    item.index = -1
    *t = old[:n-1]
    return item
}

func run(ctx context.Context, timers *Timers, add <-chan *Timer) {
    for {
        var wait time.Duration
        if timers.Len() > 0 {
            wait = time.Until((*timers)[0].Deadline)
        } else {
            wait = time.Hour // arbitrary large
        }
        timer := time.NewTimer(wait)
        select {
        case <-ctx.Done():
            timer.Stop()
            return
        case t := <-add:
            timer.Stop()
            heap.Push(timers, t)
        case <-timer.C:
            for timers.Len() > 0 && !time.Now().Before((*timers)[0].Deadline) {
                t := heap.Pop(timers).(*Timer)
                go t.Fire()
            }
        }
    }
}
```

This is the shape used by every Go-side timer wheel. The standard
library's `time` package implements a similar structure internally,
but for application-level scheduling (e.g., scheduled tasks, replay
buffers, retry queues), rolling your own is one screen of code and
testable in isolation.

## 3. Top-K with a bounded max-heap

Given a stream, find the K smallest elements. A max-heap of size K is
the right tool: keep the largest at the root, evict it whenever a
smaller element arrives.

```go
type IntMaxHeap []int

func (h IntMaxHeap) Len() int            { return len(h) }
func (h IntMaxHeap) Less(i, j int) bool  { return h[i] > h[j] } // max
func (h IntMaxHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *IntMaxHeap) Push(x any)         { *h = append(*h, x.(int)) }
func (h *IntMaxHeap) Pop() any {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[:n-1]
    return x
}

func TopK(stream <-chan int, k int) []int {
    h := &IntMaxHeap{}
    for v := range stream {
        if h.Len() < k {
            heap.Push(h, v)
        } else if v < (*h)[0] {
            (*h)[0] = v
            heap.Fix(h, 0)
        }
    }
    return *h
}
```

Memory is O(k) regardless of stream length. Time is O(n log k) over
n elements. The trick at the bottom — overwrite `h[0]` and call
`Fix(h, 0)` — is faster than `Pop`/`Push` and avoids two re-balances.

For a top-K with a final sorted output, sort the heap at the end
(`slices.Sort`); that adds O(k log k) which is dominated by the
streaming cost.

## 4. Dijkstra's shortest-path: heap as the priority frontier

```go
type Edge struct {
    To     int
    Weight int
}

type entry struct {
    node, dist int
}

type pq []entry

func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].dist < p[j].dist }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)         { *p = append(*p, x.(entry)) }
func (p *pq) Pop() any {
    old := *p
    n := len(old)
    x := old[n-1]
    *p = old[:n-1]
    return x
}

func Dijkstra(graph [][]Edge, start int) []int {
    const infty = math.MaxInt
    dist := make([]int, len(graph))
    for i := range dist {
        dist[i] = infty
    }
    dist[start] = 0

    h := &pq{{start, 0}}
    for h.Len() > 0 {
        cur := heap.Pop(h).(entry)
        if cur.dist > dist[cur.node] {
            continue // stale entry
        }
        for _, e := range graph[cur.node] {
            nd := cur.dist + e.Weight
            if nd < dist[e.To] {
                dist[e.To] = nd
                heap.Push(h, entry{e.To, nd})
            }
        }
    }
    return dist
}
```

Note the "stale entry" guard. Updating an existing entry's priority
costs `heap.Fix`, but Fix needs the index, and we'd need a `map[node]
*entry` to look it up. The cheaper trick — used in real-world graph
code — is to push a fresh entry and skip stale ones at pop time. Total
work stays O((V+E) log V) and the code is simpler.

## 5. The `container/list`-based LRU cache

The textbook LRU: a hash map for O(1) lookup, a doubly linked list
for O(1) recency tracking. On hit, move the entry to the front. On
miss with a full cache, evict the back.

```go
type LRU[K comparable, V any] struct {
    cap  int
    ll   *list.List
    m    map[K]*list.Element
}

type entry[K comparable, V any] struct {
    key K
    val V
}

func NewLRU[K comparable, V any](cap int) *LRU[K, V] {
    return &LRU[K, V]{
        cap: cap,
        ll:  list.New(),
        m:   make(map[K]*list.Element, cap),
    }
}

func (c *LRU[K, V]) Get(k K) (V, bool) {
    if e, ok := c.m[k]; ok {
        c.ll.MoveToFront(e)
        return e.Value.(*entry[K, V]).val, true
    }
    var zero V
    return zero, false
}

func (c *LRU[K, V]) Put(k K, v V) {
    if e, ok := c.m[k]; ok {
        c.ll.MoveToFront(e)
        e.Value.(*entry[K, V]).val = v
        return
    }
    if c.ll.Len() == c.cap {
        oldest := c.ll.Back()
        if oldest != nil {
            ent := c.ll.Remove(oldest).(*entry[K, V])
            delete(c.m, ent.key)
        }
    }
    e := c.ll.PushFront(&entry[K, V]{key: k, val: v})
    c.m[k] = e
}

func (c *LRU[K, V]) Len() int { return c.ll.Len() }
```

Two design points the textbook usually misses:

1. **Store the key inside the entry.** When you evict from the back,
   you need the key to delete from the map. Without it, you'd scan
   the map (O(n)).

2. **Update in place on a `Put` of an existing key.** Don't `Remove`
   then `PushFront`; that's two list mutations instead of one
   `MoveToFront`.

This implementation is single-threaded. For concurrent use, wrap every
public method in a `sync.Mutex.Lock`/`Unlock` pair. `RWMutex` is a
trap here — even `Get` mutates the list (via `MoveToFront`), so reads
need the write lock.

## 6. Modern alternatives to a list-based LRU

`hashicorp/golang-lru` (`github.com/hashicorp/golang-lru/v2`) is the
de-facto third-party LRU. It uses the same `map + list` idea internally
but ships the concurrency, generics, and metrics for you. For new
code, importing it is the right call.

Other options:

| Library | What it gives you |
|---------|-------------------|
| `hashicorp/golang-lru/v2` | Generic LRU, ARC, 2Q, expirable LRU, bounded sharded LRU |
| `dgraph-io/ristretto` | Concurrent cache with admission policy (TinyLFU); high-throughput |
| `karlseguin/ccache/v3` | Lightweight TTL cache with sharding |
| Roll your own | Justified when you need a non-standard policy or to avoid the dep |

For caches >10k entries with concurrent access, ristretto outperforms
a mutex-protected list-LRU by orders of magnitude because it shards
and uses lock-free admission. For small caches (<1k) or cold paths, a
mutex-wrapped LRU on `container/list` is simpler and fine.

## 7. The list as an undo stack

Each user action pushes a snapshot to the front; undo pops from the
front. The reason to use a list rather than a slice: capping the
history at N becomes O(1) (`Remove` from the back) instead of O(n)
(`copy` over the front).

```go
type UndoStack struct {
    l   *list.List
    max int
}

func (s *UndoStack) Push(action any) {
    s.l.PushFront(action)
    for s.l.Len() > s.max {
        s.l.Remove(s.l.Back())
    }
}

func (s *UndoStack) Pop() (any, bool) {
    e := s.l.Front()
    if e == nil {
        return nil, false
    }
    return s.l.Remove(e), true
}
```

For undo, history sizes are tiny (a few hundred at most), so the
constant-factor advantage of a slice plus rotation is moot. Use what
reads cleanest.

## 8. The "intrusive" list pattern

`container/list` stores `Value` as `any` and allocates a fresh
`*Element` per insert. For internal data structures you control, an
*intrusive* list — where the `next, prev *Node` pointers live as
fields of the element type itself — is faster and more type-safe. No
`*Element` allocation, no `any` boxing, no type assertion on read.
Cost: less reusable; you write the four list methods once per element
type. See [optimize.md](optimize.md) §7 for the full code; for the
standard `container/list`, the `*Element` allocation is fine on
modern hardware unless you're in a hot path.

## 9. Generic wrapper for `container/heap`, refined

Junior.md showed a minimal wrapper. The production version pre-allocates
capacity, avoids the per-call adapter allocation, and stays concise:

```go
package pq

import "container/heap"

type Heap[T any] struct {
    data []T
    less func(a, b T) bool
}

func New[T any](less func(a, b T) bool) *Heap[T] {
    return &Heap[T]{less: less}
}

func From[T any](data []T, less func(a, b T) bool) *Heap[T] {
    h := &Heap[T]{data: data, less: less}
    heap.Init((*heapAdapter[T])(h))
    return h
}

func (h *Heap[T]) Len() int       { return len(h.data) }
func (h *Heap[T]) Push(v T)       { heap.Push((*heapAdapter[T])(h), v) }
func (h *Heap[T]) Pop() T         { return heap.Pop((*heapAdapter[T])(h)).(T) }
func (h *Heap[T]) Peek() T        { return h.data[0] }
func (h *Heap[T]) Fix(i int)      { heap.Fix((*heapAdapter[T])(h), i) }
func (h *Heap[T]) Remove(i int) T { return heap.Remove((*heapAdapter[T])(h), i).(T) }

// heapAdapter is the same underlying memory as *Heap[T], cast-only.
type heapAdapter[T any] Heap[T]

func (a *heapAdapter[T]) Len() int            { return len(a.data) }
func (a *heapAdapter[T]) Less(i, j int) bool  { return a.less(a.data[i], a.data[j]) }
func (a *heapAdapter[T]) Swap(i, j int)       { a.data[i], a.data[j] = a.data[j], a.data[i] }
func (a *heapAdapter[T]) Push(x any)          { a.data = append(a.data, x.(T)) }
func (a *heapAdapter[T]) Pop() any {
    n := len(a.data)
    x := a.data[n-1]
    a.data = a.data[:n-1]
    return x
}
```

The trick: `heapAdapter[T]` is a type alias for `Heap[T]`'s memory
layout, so `(*heapAdapter[T])(h)` is a free cast. No allocation per
call. Calls like `h.Push(v)` cost the same as a direct
`container/heap` call against your hand-written adapter, but with
type-safe call sites and no boxing of the comparator.

There is still one box per element on `heap.Push`/`heap.Pop` because
the underlying package types those methods as `any`. Eliminating that
cost requires reimplementing the heap algorithm in generic Go. For
scalar types in hot paths, that's worth doing — see optimize.md.

## 10. Update by key — keep a map of key → index

A common need: "increase the priority of the item with key K." The
naive approach scans the heap (O(n)); the right approach keeps a
`map[K]int` of slice indices alongside the heap and updates it in
`Swap`. `Update(key, val)` becomes `idx := m[key]; pq.data[idx] = v;
heap.Fix(pq, idx)` — O(log n). This is the pattern Dijkstra *should*
use; the "push-stale-then-skip" trick is asymptotically worse but
often wins in wall time because of the constant factors.

## 11. The "two heaps" median pattern

Maintaining the running median of a stream needs a max-heap of the
lower half and a min-heap of the upper half, kept balanced.

```go
type RunningMedian struct {
    lo *Heap[int] // max-heap
    hi *Heap[int] // min-heap
}

func NewRunningMedian() *RunningMedian {
    return &RunningMedian{
        lo: pq.New(func(a, b int) bool { return a > b }), // max
        hi: pq.New(func(a, b int) bool { return a < b }), // min
    }
}

func (m *RunningMedian) Add(v int) {
    if m.lo.Len() == 0 || v <= m.lo.Peek() {
        m.lo.Push(v)
    } else {
        m.hi.Push(v)
    }
    // re-balance
    if m.lo.Len() > m.hi.Len()+1 {
        m.hi.Push(m.lo.Pop())
    } else if m.hi.Len() > m.lo.Len() {
        m.lo.Push(m.hi.Pop())
    }
}

func (m *RunningMedian) Median() float64 {
    if m.lo.Len() > m.hi.Len() {
        return float64(m.lo.Peek())
    }
    return (float64(m.lo.Peek()) + float64(m.hi.Peek())) / 2
}
```

`Add` is O(log n), `Median` is O(1). For analytics streams (latency
percentiles, rolling stats), this is the textbook structure. Real
percentile estimators (HDR histograms, t-digest) are even better at
the cost of accuracy guarantees, but for exact medians of bounded
streams, the two-heap pattern is correct and concise.

## 12. `container/ring` use cases that aren't a slice

Most things people build with `container/ring` are simpler with a
slice. Two cases where `ring` reads cleaner:

**Splicing arbitrary chunks.** `r.Link(s)` inserts ring `s` after
ring `r` in O(1). With a slice you'd do an `append` plus a `copy`,
both O(n). For circular schedules (e.g., a calendar where you splice
in a multi-day event), the linked structure is genuinely simpler.

**Round-robin with dynamic add/remove.** A pool of workers where
workers come and go: `Unlink(1)` removes the current node, `Link`
adds a new one. With a slice you have to compact after every
removal, or accept O(n) `delete`.

For both, you'd reach for an intrusive doubly-linked list in C; in
Go, `container/ring` is the closest stdlib analog. Channels still
beat it for any concurrent producer-consumer pattern.

## 13. Replacing `container/ring` with a slice-backed ring buffer

The "ring buffer" people usually mean — fixed-size FIFO with overwrite
on full — is not what `container/ring` is. The right implementation is
a slice plus `head`/`tail` indices wrapped with `% len(buf)`. Cache-
friendly, no allocations after construction, generic. For a concurrent
version, use a buffered channel — `make(chan T, cap)` is the canonical
bounded queue in Go and gets you backpressure for free. See
[optimize.md](optimize.md) for the full implementation.

## 14. When to use what — a decision table

| Need | Reach for |
|------|-----------|
| Min/max repeatedly from a changing set | `container/heap` (or a generic wrapper) |
| Schedule events by deadline | `container/heap` |
| LRU cache, small | `container/list` + map, or `hashicorp/golang-lru/v2` |
| LRU cache, high-throughput | `dgraph-io/ristretto` |
| Undo stack, bounded history | Slice with rotation, or `container/list` |
| Free list of reusable objects | `sync.Pool` (almost always) |
| Bounded FIFO queue | Buffered channel, or slice ring buffer |
| Round-robin worker pool | Slice + index, or buffered channel |
| Splice arbitrary chunks of a sequence | `container/ring` (rarely) |

The rule of thumb: prefer slices, channels, and `sync.Pool` first.
Reach for the `container/*` packages when the access pattern matches
their strengths and the constant factor doesn't dominate.

## 15. Concurrency notes

None of the three packages is safe for concurrent use. Every method
mutates state. The standard wrapping is:

```go
type SafePQ[T any] struct {
    mu sync.Mutex
    pq *Heap[T]
}

func (s *SafePQ[T]) Push(v T) {
    s.mu.Lock()
    s.pq.Push(v)
    s.mu.Unlock()
}

func (s *SafePQ[T]) Pop() (T, bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.pq.Len() == 0 {
        var zero T
        return zero, false
    }
    return s.pq.Pop(), true
}
```

For a *blocking* pop ("wait until something is available"), use a
condition variable, or design the queue around a channel for arrivals
and use the heap only on the consumer side.

## 16. What to read next

- [senior.md](senior.md) — invariants, complexity proofs, the
  allocation profile, the GC story.
- [professional.md](professional.md) — production patterns: timer
  wheels at scale, replacement decisions, observability.
- [optimize.md](optimize.md) — when the constant factors dominate.
- Cross-link: [`../16-sort-slices-maps/`](../16-sort-slices-maps/junior.md) for
  the `slices` package, which often replaces a list of values
  outright.
