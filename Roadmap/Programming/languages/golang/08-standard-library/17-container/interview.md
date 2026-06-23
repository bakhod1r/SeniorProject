# 8.17 `container/*` — Interview

> Twenty-five questions hiring loops actually ask about Go's
> container packages, with model answers. The depth varies — some
> are warm-ups, some are senior-level traps.

## 1. What is `heap.Interface` and how does it relate to `sort.Interface`?

`heap.Interface` embeds `sort.Interface` (`Len`, `Less`, `Swap`) and
adds two methods: `Push(x any)` and `Pop() any`. Any heap is also a
valid `sort.Interface`, so you can pass it to `sort.Sort` (though
that destroys the heap invariant). The reason for the embedding is
that the heap algorithm needs the same three primitives plus a way to
grow and shrink the underlying slice.

## 2. Why doesn't `heap.Pop` return the smallest element through your `Pop`?

Because the algorithm has already swapped the root (smallest) with
the last slice element before calling your `Pop`. Your `Pop` is just
the slice-shrink step: drop and return the tail. This API choice lets
the same `Push`/`Pop` pair serve `Init`, `Push`, `Pop`, `Remove`, and
`Fix` without each function needing its own slice manipulation.

## 3. Min-heap or max-heap by default?

Min-heap. The root is the smallest per `Less`. To get a max-heap,
invert `Less`:

```go
func (h IntHeap) Less(i, j int) bool { return h[i] > h[j] } // max
```

## 4. What's the time complexity of `heap.Init`?

O(n). The naive bound looks like O(n log n) — sift down on n/2 nodes,
each at depth up to log n — but the work is bounded by 2n because
the bottom levels (with most of the elements) only walk a few
levels each.

## 5. What's `heap.Fix` for?

After you mutate an element's priority *in place*, the heap invariant
may break at that index. `heap.Fix(h, i)` re-balances at index `i`
in O(log n). It's how priority-queue `Update` is implemented:

```go
item.Priority = newP
heap.Fix(pq, item.index)
```

## 6. How does the priority queue track an item's index?

The item carries an `index int` field. The PQ's `Swap` method
updates `index` on both swapped items. `Push` sets `index = len`
before appending. `Pop` sets `index = -1` as a sentinel for "no
longer queued."

## 7. Why store `*Item` in the heap rather than `Item`?

Three reasons:

- `Swap` moves 16 bytes (two pointers) instead of `sizeof(Item)`.
- External code can hold `*Item` and pass it back for `Update` /
  `Cancel` — you can't keep a pointer to a slice element across
  `Swap`.
- `any` holding a pointer doesn't allocate; `any` holding a value
  type usually does. So `Push(*Item)` is allocation-free; `Push(Item)`
  isn't.

## 8. What happens if you forget to call `heap.Fix` after changing a priority?

The heap silently has the wrong order. `Pop` will return whatever it
returns. There's no panic, no error. This is the most insidious bug
with `container/heap`: tests look fine until a specific sequence of
priorities trips it.

## 9. Is the heap stable?

No. Items with equal `Less` values come out in undefined order.
For FIFO ordering within a priority, encode an insertion sequence in
the comparator:

```go
func (h ByPrio) Less(i, j int) bool {
    if h[i].Prio != h[j].Prio {
        return h[i].Prio > h[j].Prio
    }
    return h[i].Seq < h[j].Seq
}
```

## 10. When would you use `container/list` over a slice?

When you need O(1) insertion or removal in the middle of the
sequence, and you can hold an `*Element` reference to the position.
Canonical examples: LRU cache (move-to-front on access), bounded
undo/redo stack, free list of buffers.

For everything else — append, traverse, sort, search — use a slice.
Cache locality almost always wins.

## 11. Why is `container/list` faster than a slice for an LRU cache?

Hits in an LRU need to move the recently-used entry to the front.
With a slice, that's O(n). With a list (and an `*Element` reference
from a sibling map), it's O(1). At LRU sizes >100, that constant
factor dominates.

## 12. What does `MoveToFront` do that's special?

It rewires four pointers (the moved element's two and the two
neighbors that now bridge the gap) without allocating. Compare with
`Remove` followed by `PushFront`, which would free the old `*Element`
and allocate a new one. `MoveToFront` is the right call when an item
already exists.

## 13. Walk me through implementing an LRU cache with `container/list`.

```go
type LRU struct {
    cap int
    ll  *list.List
    m   map[string]*list.Element
}

type entry struct{ key, val string }

func (c *LRU) Get(k string) (string, bool) {
    if e, ok := c.m[k]; ok {
        c.ll.MoveToFront(e)
        return e.Value.(*entry).val, true
    }
    return "", false
}

func (c *LRU) Put(k, v string) {
    if e, ok := c.m[k]; ok {
        c.ll.MoveToFront(e)
        e.Value.(*entry).val = v
        return
    }
    if c.ll.Len() == c.cap {
        old := c.ll.Back()
        c.ll.Remove(old)
        delete(c.m, old.Value.(*entry).key)
    }
    c.m[k] = c.ll.PushFront(&entry{k, v})
}
```

Key design point: store the *key* inside the entry so eviction can
remove it from the map without scanning.

## 14. Is `container/list` thread-safe?

No. None of the `container/*` packages is. Wrap with `sync.Mutex`.
Note that even `Get` mutates the list (via `MoveToFront`), so an
`RWMutex.RLock` is *not* sufficient — use the write lock.

## 15. What's the difference between `container/list` and `container/ring`?

`list.List` has a sentinel head and a length count. Iteration ends
at nil. `ring.Ring` has no head; every node points to a next and a
previous, and the last node loops back to the first. There's no
"List" container — the node *is* the API. `Len()` on a ring is
O(n), not O(1).

## 16. When would you actually use `container/ring`?

Rarely. Almost every "ring buffer" use case is better served by a
slice with head/tail indices, or a buffered channel for concurrent
producer-consumer. The narrow case where `container/ring` reads
cleanest: O(1) splicing of arbitrary-sized chunks via `Link` and
`Unlink`. Most projects don't need that.

## 17. How would you write a generic priority queue in Go 1.21+?

A thin wrapper around `container/heap`:

```go
type Heap[T any] struct {
    data []T
    less func(a, b T) bool
}

func (h *Heap[T]) Push(v T) { heap.Push(adapter{h}, v) }
func (h *Heap[T]) Pop() T   { return heap.Pop(adapter{h}).(T) }
```

with an unexported adapter type that implements `heap.Interface`
against `h.data` and `h.less`. The wrapper keeps call sites typed,
but the underlying algorithm still pays for one `any`-box per
push/pop. To eliminate that, you'd reimplement the heap algorithm in
generic Go.

## 18. What's the cost of pushing a value type onto a heap?

One `interface{}` box on `Push`, one more on `Pop` (since the return
type is `any`). For an `int`, that's two ~16-byte allocations per
push/pop cycle. Pushing `*Item` instead of `Item` avoids both
because `any` holding a pointer doesn't allocate.

## 19. How do you compute a running median?

Two heaps: a max-heap for the lower half, a min-heap for the upper
half. Insert: route the new value to the appropriate heap based on
comparison with the max-heap's root, then re-balance so the heaps
differ by at most one element. Median: if sizes equal, average the
two roots; otherwise the root of the larger.

`Add` is O(log n), `Median` is O(1). For very large streams, prefer
an approximate quantile sketch (HDR histogram, t-digest).

## 20. What's a "lazy cancel" in a timer wheel?

Instead of removing a cancelled job from the heap (which requires the
lock and the index), set a flag on the job and let the runner skip
it at pop time. Trade-off: the heap accumulates ghost entries until
they bubble up. Worth it when cancellations are common (e.g.,
per-request timeouts where most never fire).

## 21. Why isn't there a generic `container.Heap[T]` in the stdlib?

Standardization is hard. Every proposal — which interfaces, which
method names, blocking vs non-blocking, sharded vs single-mutex —
has stalled on bikeshedding. The packages stay unchanged for
compatibility. New code should write a thin generic wrapper or
import one of the third-party libraries.

## 22. What's the difference between `*list.List` initialized with `New()` vs the zero value?

`list.New()` returns a `*List` with the sentinel initialized.
`var l list.List` gives a zero-value `List` whose sentinel is set
up lazily on the first operation. The zero-value form is fine in
single-goroutine code; for shared lists, use `list.New()` (or call
`l.Init()`) to avoid a lazy-init data race.

## 23. Is there a pool for `*list.Element` to avoid allocations?

Not in the stdlib. Each `PushFront`/`PushBack`/`InsertX` allocates a
new `*Element`. For very high-churn caches, the allocation cost can
dominate; the workaround is to roll your own intrusive list (next
and prev pointers embedded in your value type) or use a third-party
generic LRU like `hashicorp/golang-lru/v2`.

## 24. How do you safely close a blocking priority queue?

Use a `sync.Cond` plus a `done` flag:

```go
func (b *BlockingPQ) Close() {
    b.mu.Lock()
    b.done = true
    b.cond.Broadcast()
    b.mu.Unlock()
}

func (b *BlockingPQ) Pop() (T, bool) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for b.pq.Len() == 0 && !b.done {
        b.cond.Wait()
    }
    if b.pq.Len() == 0 {
        return zeroT, false
    }
    return b.pq.Pop(), true
}
```

The `Broadcast` wakes every waiter. They all re-check the predicate
and either consume or exit.

## 25. When should you reach for `slices` and `maps` instead of `container/*`?

When you don't need the specific guarantees of these structures.
`slices` (Go 1.21+) gives you `Insert`, `Delete`, `Reverse`, `Sort`,
`BinarySearch` — generic, fast, idiomatic. If your "list" is really
just an append-only or end-modified sequence, it's a slice.

You still want `container/heap` for priority queues and
`container/list` for handle-based O(1) middle insertion/removal.
Everything else has a slice/map equivalent that's better.

See [`../16-sort-slices-maps/`](../16-sort-slices-maps/junior.md) for the
modern packages.

## Bonus questions

### Why does the heap algorithm call `Swap` instead of moving the value directly?

The package-level functions can't see your concrete type, so they
operate through the interface. `Swap(i, j)` is the only primitive
they have. This also lets you implement bookkeeping (the `index`
field) by hooking into `Swap` — there's no other place to do it.

### What's `heap.Remove(h, 0)` equivalent to?

`heap.Pop(h)` — both remove the root and return its value. `Remove`
is the general form; `Pop` is the special case for the root.

### Can you use `container/heap` to find the median of a fixed slice in O(n)?

No. Quickselect (in the `slices` package's internals or your own
implementation) is the right algorithm for that. A heap gives O(n
log n). The two-heap streaming median is for online streams, not
batch data.
