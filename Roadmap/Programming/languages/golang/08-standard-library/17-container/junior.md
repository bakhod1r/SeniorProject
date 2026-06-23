# 8.17 `container/*` — Junior

> **Audience.** You've heard of priority queues and linked lists, you
> know slices and maps cover most of what you need, and you want to
> understand the three odd packages under `container/`. By the end of
> this file you will know what each package gives you, when to reach
> for it, and the half-dozen calls that cover most real use.

The three packages are `container/heap`, `container/list`, and
`container/ring`. They predate generics. None is parameterized; all
work either by you implementing an interface or by storing
`interface{}` (`any`) values. They feel awkward today and there are
modern alternatives. Cover the basics here; middle.md and senior.md go
deeper into the priority-queue idiom and the generic wrappers.

## 1. The big picture

| Package | Data structure | Status today |
|---------|----------------|--------------|
| `container/heap` | Binary min-heap (priority queue) | Still useful, especially with a generic wrapper |
| `container/list` | Doubly linked list with sentinel | Still useful for LRU caches and undo stacks |
| `container/ring` | Circular doubly linked list | Mostly historical |

A binary heap is for priority queues: pull the highest-priority item in
O(log n). A doubly linked list is for O(1) insertion and removal at any
known position. A ring is a circular buffer with no front and no back.

Slices beat lists for almost everything because of cache locality.
Channels beat rings for almost any concurrent producer-consumer use.
The remaining use cases are narrow but real, and the standard library
is the canonical choice when they apply.

## 2. `container/heap` — what a heap is

A heap is a tree-shaped data structure where the smallest (or largest)
element is always at the root. The standard library gives you a
*min-heap*: the root is the smallest. Two operations are O(log n):
inserting a new element, and removing the smallest. Inspecting the
smallest is O(1). That's the whole API.

The package itself does not contain a heap. It contains *algorithms*
that operate on anything implementing `heap.Interface`:

```go
type Interface interface {
    sort.Interface
    Push(x any) // add x as element Len()
    Pop() any   // remove and return element Len() - 1
}
```

`sort.Interface` gives you `Len`, `Less`, and `Swap`. The two extra
methods plug into the algorithm. You implement `Interface` on a slice;
`heap.Push`, `heap.Pop`, `heap.Init`, `heap.Remove`, `heap.Fix` do the
work.

## 3. The smallest possible heap

A min-heap of `int`:

```go
package main

import (
    "container/heap"
    "fmt"
)

type IntHeap []int

func (h IntHeap) Len() int           { return len(h) }
func (h IntHeap) Less(i, j int) bool { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }

func (h *IntHeap) Push(x any) {
    *h = append(*h, x.(int))
}

func (h *IntHeap) Pop() any {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[:n-1]
    return x
}

func main() {
    h := &IntHeap{5, 2, 9, 1}
    heap.Init(h) // O(n) — turns any slice into a valid heap

    heap.Push(h, 3)
    fmt.Println((*h)[0]) // 1, the minimum

    for h.Len() > 0 {
        fmt.Println(heap.Pop(h)) // 1, 2, 3, 5, 9
    }
}
```

Three things to internalize from this snippet:

1. **`Push` and `Pop` on the interface are not called by you.** The
   package-level `heap.Push(h, x)` and `heap.Pop(h)` call your methods
   and *also* re-balance the heap. If you call `h.Push` directly, you
   get a slice with a new tail and a broken heap.

2. **`Pop` returns the last slice element, not the smallest.** The
   algorithm swaps the smallest to the end before calling your `Pop`.
   Your `Pop` only does the slice-trimming. This is why you write the
   awkward `old[n-1]; *h = old[:n-1]` pattern.

3. **`Less` decides min vs max.** Flip the comparator and you have a
   max-heap. There is no separate `MaxHeap` type.

```go
func (h IntHeap) Less(i, j int) bool { return h[i] > h[j] } // max-heap
```

## 4. The five package-level functions

| Function | Does what | Cost |
|----------|-----------|------|
| `heap.Init(h)` | Make `h` (any slice satisfying `Interface`) a valid heap | O(n) |
| `heap.Push(h, x)` | Insert `x`, restore heap | O(log n) |
| `heap.Pop(h)` | Remove and return the minimum | O(log n) |
| `heap.Remove(h, i)` | Remove the element at index `i` | O(log n) |
| `heap.Fix(h, i)` | Re-balance after you mutated `h[i]` in place | O(log n) |

`Init` is what you call to turn an existing unsorted slice into a heap
in linear time — handy when you build the data first and want to start
draining it in priority order.

`Fix` is the one most people forget. If you change the priority of an
element already in the heap, the heap invariant may be broken at that
index. You call `heap.Fix(h, i)` to repair it. Without `Fix`, the heap
quietly returns wrong answers.

## 5. Min-heap by default; max-heap by inverting

There is no max-heap type in the package. To get a max-heap, return
`>` instead of `<` in `Less`. Same for any other ordering — by
deadline, by user-supplied priority, by tuple of fields. `Less` is the
only knob.

```go
type ByDeadline []Job

func (a ByDeadline) Less(i, j int) bool {
    return a[i].Deadline.Before(a[j].Deadline)
}
```

The earliest deadline pops first. Same code, different `Less`.

## 6. Priority queue: the canonical example

The package documentation includes an example of a priority queue with
items that carry a payload and a priority. The shape is worth memorizing
because every PQ in real code follows it.

```go
type Item struct {
    value    string
    priority int
    index    int // position in the heap; maintained by Push/Pop/Swap
}

type PriorityQueue []*Item

func (pq PriorityQueue) Len() int { return len(pq) }

func (pq PriorityQueue) Less(i, j int) bool {
    // higher priority first → max-heap on priority
    return pq[i].priority > pq[j].priority
}

func (pq PriorityQueue) Swap(i, j int) {
    pq[i], pq[j] = pq[j], pq[i]
    pq[i].index = i
    pq[j].index = j
}

func (pq *PriorityQueue) Push(x any) {
    n := len(*pq)
    item := x.(*Item)
    item.index = n
    *pq = append(*pq, item)
}

func (pq *PriorityQueue) Pop() any {
    old := *pq
    n := len(old)
    item := old[n-1]
    old[n-1] = nil  // avoid memory leak
    item.index = -1 // mark as removed
    *pq = old[:n-1]
    return item
}
```

Two design choices to copy:

1. **Items carry their own index.** `Swap` updates `index` on both
   sides. This means you can later say "boost the priority of *this*
   item" and call `heap.Fix(pq, item.index)` without searching the
   slice.

2. **Slice of pointers.** Storing `*Item` keeps `Swap` cheap (it moves
   8 bytes, not the whole struct) and lets external code keep a
   reference to a queued item.

Use it like:

```go
pq := &PriorityQueue{}
heap.Init(pq)
heap.Push(pq, &Item{value: "task A", priority: 3})
heap.Push(pq, &Item{value: "task B", priority: 5})
top := heap.Pop(pq).(*Item) // task B
```

To update an item's priority in place:

```go
item.priority = 10
heap.Fix(pq, item.index) // O(log n) re-balance
```

## 7. When to reach for `container/heap`

- Top-K problems (smallest K elements of a stream): keep a max-heap of
  size K, push every element, pop when size exceeds K.
- Event scheduler / timer wheel: priority by deadline, pop the
  earliest, sleep until then, fire, repeat.
- Dijkstra's shortest-path: priority by tentative distance.
- Median maintenance: two heaps (max-heap of lower half, min-heap of
  upper half).
- Any problem phrased as "always process the most-X next."

When *not* to: if you need only `min` and never `pop`, just track the
minimum in a variable. If your data is small (say, <100 items), a
sorted slice with `slices.Sort` is faster in wall time despite worse
asymptotics.

## 8. `container/list` — what a doubly linked list gives you

A doubly linked list has a node for every element with `next` and
`prev` pointers. Inserting or removing a node, given a handle to it,
is O(1). Iterating end-to-end is O(n). Random access is O(n) — there
is no `list[3]`.

```go
import "container/list"

l := list.New()
e1 := l.PushBack("a")
e2 := l.PushBack("b")
e3 := l.PushFront("z")
l.InsertAfter("c", e2)
l.Remove(e1)

for e := l.Front(); e != nil; e = e.Next() {
    fmt.Println(e.Value)
}
```

`*List` is the container; `*Element` is a node. Every method that
inserts returns the `*Element` it created so you can hand it back
later for an O(1) delete or move.

## 9. The `*List` API at a glance

| Method | What it does |
|--------|--------------|
| `list.New()` | Create an empty list |
| `l.Len()` | Number of elements (O(1)) |
| `l.Front()`, `l.Back()` | First, last `*Element` (or nil) |
| `l.PushFront(v)`, `l.PushBack(v)` | Insert at the ends; return `*Element` |
| `l.InsertBefore(v, e)`, `l.InsertAfter(v, e)` | Insert relative to a node |
| `l.Remove(e)` | Remove a node; returns the value |
| `l.MoveToFront(e)`, `l.MoveToBack(e)` | Move within the list |
| `l.MoveBefore(e, mark)`, `l.MoveAfter(e, mark)` | Move to a position |
| `l.PushBackList(other)`, `l.PushFrontList(other)` | Splice another list in |
| `l.Init()` | Reset to empty |

Iteration uses `Front()`/`Back()` and `Next()`/`Prev()` on `*Element`.
The `Element.Value` field is the payload (typed `any`).

```go
for e := l.Front(); e != nil; e = e.Next() {
    s := e.Value.(string) // type-assert the payload
    _ = s
}
```

## 10. The killer feature: O(1) remove and move with a handle

The reason to use `container/list` over a slice is this: if you keep a
`*Element` reference to a node, you can remove or move it without
searching, in constant time. Slices can't do that — removing element
i is O(n) because you have to shift the tail.

```go
type cache struct {
    l *list.List
    m map[string]*list.Element
}

func (c *cache) get(k string) {
    e, ok := c.m[k]
    if !ok { return }
    c.l.MoveToFront(e) // O(1) — slice would be O(n)
}
```

A map lookup gives you the `*Element`; the list keeps recency order.
This is the classic LRU cache. middle.md walks through the full
implementation.

## 11. Why slices usually beat lists

Linked lists were the workhorse of textbooks. In practice, slices win
on most workloads. Reasons:

1. **Cache locality.** A slice is one contiguous block; iteration
   prefetches well. A linked list scatters nodes across memory; every
   `Next()` is a potential cache miss.

2. **Allocations.** Each `Push` allocates an `*Element`. A slice
   amortizes allocation across `append`s.

3. **GC pressure.** More nodes means more pointers for the garbage
   collector to scan.

4. **Random access.** Slices are O(1); lists are O(n).

A linked list is faster only when you have:

- Frequent insertions or removals in the *middle* of a sequence,
- A handle to the position (not just an index),
- And the sequence is long enough that the constant factor doesn't
  drown the asymptotic difference.

LRU cache, undo/redo stack, free list of reusable buffers, and a
handful of similar shapes meet that bar. Most things you reach for a
"list" for don't.

## 12. `container/ring` — a circular linked list

A ring is a doubly linked list with no `nil` ends. Every node points
to a next and a previous; `r.Next()` from the last node goes to the
first.

```go
import "container/ring"

r := ring.New(5) // a ring of 5 nodes, all .Value == nil
for i := 0; i < r.Len(); i++ {
    r.Value = i
    r = r.Next()
}

r.Do(func(v any) {
    fmt.Println(v)
})
```

`ring.New(n)` returns a ring of `n` nodes. The variable `r` is *one*
node; the "ring" is the cycle reachable through `r.Next()`. There is
no separate "Ring" container type — the node is the API.

| Method | What it does |
|--------|--------------|
| `r.Len()` | Number of nodes in the ring (O(n) — it walks) |
| `r.Next()`, `r.Prev()` | Walk forward / backward |
| `r.Move(n)` | Walk `n` steps (negative goes backward) |
| `r.Link(s)` | Insert another ring after `r` |
| `r.Unlink(n)` | Remove `n` nodes after `r` and return them |
| `r.Do(f)` | Call `f(node.Value)` for every node |

`Len` is **O(n)**, not O(1) — every call walks the whole ring. Cache
the size yourself if you need it often.

## 13. When (rarely) to reach for `container/ring`

Round-robin: a list of workers where you pick the next one and
advance. Fixed-size circular buffer where you overwrite the oldest
entry. Sliding window over a fixed number of recent samples.

Almost every modern Go codebase implements these with:

- a slice of size N and a head index (`head = (head + 1) % N`), or
- a buffered channel for concurrent producer-consumer queues.

`container/ring` is correct but allocates a node per element, has
poor cache locality, and gives you nothing the simpler approaches
don't. Reach for it only if you specifically want O(1) splice
(`Link`/`Unlink`) of arbitrary chunks.

## 14. Genericity: none of these are generic

Every method on these packages takes `any` (formerly `interface{}`).
That has three costs:

1. Boxing: a primitive value goes into an `interface{}` wrapper, with
   an allocation for non-pointer types.
2. Type assertions: every read needs `e.Value.(string)` or similar.
3. No compile-time type safety: nothing stops you from pushing a
   `string` and an `int` into the same heap.

Modern Go (1.18+) has generics. There are widely used third-party
generic priority queues, and writing your own thin generic wrapper is
a few lines:

```go
// package pq

import "container/heap"

type Heap[T any] struct {
    data []T
    less func(a, b T) bool
}

func New[T any](less func(a, b T) bool) *Heap[T] {
    return &Heap[T]{less: less}
}

// internal heap.Interface adapter; intentionally unexported
type adapter[T any] struct{ h *Heap[T] }

func (a adapter[T]) Len() int            { return len(a.h.data) }
func (a adapter[T]) Less(i, j int) bool  { return a.h.less(a.h.data[i], a.h.data[j]) }
func (a adapter[T]) Swap(i, j int)       { a.h.data[i], a.h.data[j] = a.h.data[j], a.h.data[i] }
func (a *adapter[T]) Push(x any)         { a.h.data = append(a.h.data, x.(T)) }
func (a *adapter[T]) Pop() any           {
    n := len(a.h.data)
    x := a.h.data[n-1]
    a.h.data = a.h.data[:n-1]
    return x
}

func (h *Heap[T]) Push(v T)   { heap.Push(&adapter[T]{h}, v) }
func (h *Heap[T]) Pop() T     { return heap.Pop(&adapter[T]{h}).(T) }
func (h *Heap[T]) Len() int   { return len(h.data) }
func (h *Heap[T]) Peek() T    { return h.data[0] }
```

Now `pq.New[int](func(a, b int) bool { return a < b })` is a typed
min-heap of `int` with no `any` in the call sites. middle.md polishes
this pattern.

## 15. Common mistakes at this level

| Symptom | Likely cause |
|---------|--------------|
| `heap.Pop` returns wrong element | Called `h.Push`/`h.Pop` directly instead of `heap.Push`/`heap.Pop` |
| Heap silently wrong after an item changes priority | Forgot `heap.Fix(h, i)` |
| `Pop` panics with "interface conversion" | Stored mixed types in the same heap |
| LRU cache always misses | Forgot to `MoveToFront` on hits |
| `*list.Element.Value` panics | Used `Remove` then accessed `.Value` |
| Ring iteration loops forever | Misread `Do` and rolled your own with `for r != start` but never advanced past the wrong node |

The "called the method directly" mistake is the most common. Treat
`heap.Interface.Push` and `heap.Interface.Pop` as private — they exist
for the package, not for you.

## 16. A worked example: scheduling jobs by deadline

Putting `container/heap` to work in a tiny scheduler:

```go
package main

import (
    "container/heap"
    "fmt"
    "time"
)

type Job struct {
    Name     string
    Deadline time.Time
    index    int
}

type Schedule []*Job

func (s Schedule) Len() int            { return len(s) }
func (s Schedule) Less(i, j int) bool  { return s[i].Deadline.Before(s[j].Deadline) }
func (s Schedule) Swap(i, j int) {
    s[i], s[j] = s[j], s[i]
    s[i].index = i
    s[j].index = j
}
func (s *Schedule) Push(x any) {
    j := x.(*Job)
    j.index = len(*s)
    *s = append(*s, j)
}
func (s *Schedule) Pop() any {
    old := *s
    n := len(old)
    j := old[n-1]
    old[n-1] = nil
    j.index = -1
    *s = old[:n-1]
    return j
}

func main() {
    now := time.Now()
    s := &Schedule{}
    heap.Push(s, &Job{Name: "B", Deadline: now.Add(5 * time.Second)})
    heap.Push(s, &Job{Name: "A", Deadline: now.Add(1 * time.Second)})
    heap.Push(s, &Job{Name: "C", Deadline: now.Add(3 * time.Second)})

    for s.Len() > 0 {
        next := heap.Pop(s).(*Job)
        fmt.Println(next.Name) // A, C, B
    }
}
```

Three patterns from this snippet that show up everywhere:

1. The `index` field maintained by `Swap`. You don't need it for
   `Push`/`Pop`, but you'll want it the moment you add `Update` or
   `Cancel`. Add it once and it's there.
2. Comparing `time.Time` with `Before`, not subtracting. Subtraction
   gives a `time.Duration` and works, but `Before` is the idiomatic
   choice and easier to read.
3. Pop returns `any`; the caller asserts to `*Job`. This `.(*Job)`
   is one of the costs of the pre-generics API.

## 17. What to read next

- [middle.md](middle.md) — full priority queue with `Update`, the LRU
  cache, the generic wrapper polished, modern alternatives.
- [senior.md](senior.md) — invariants, complexity proofs, allocation
  profile, the GC story.
- [tasks.md](tasks.md) — exercises across all three packages.
- [find-bug.md](find-bug.md) — drills targeting the mistakes above.
- The official package docs:
  [`container/heap`](https://pkg.go.dev/container/heap),
  [`container/list`](https://pkg.go.dev/container/list),
  [`container/ring`](https://pkg.go.dev/container/ring).
- Cross-link: [`../16-sort-slices-maps/`](../16-sort-slices-maps/junior.md) for
  `sort.Interface`, which `heap.Interface` extends.
