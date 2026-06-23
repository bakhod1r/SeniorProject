# 8.17 `container/*` — Senior

> **Audience.** You've shipped code on top of `container/heap` and
> `container/list` and you've thought about cache locality and
> allocation cost at least once. This file is the precise contract:
> what the heap algorithm guarantees, the exact complexity of every
> operation, the allocation profile, and the systems-level details
> that decide whether these packages belong in a hot path.

## 1. The exact heap invariant

A binary heap stored in a 0-indexed array satisfies, for every index
`i` with `0 < i < n`:

```
!Less(parent(i), i)  is allowed only when Less(i, parent(i)) is also false
parent(i) = (i - 1) / 2
left(i)   = 2*i + 1
right(i)  = 2*i + 2
```

Restated: for a min-heap, `h[parent(i)] <= h[i]` for all valid `i`.
The package generalizes this to any total order via `Less`. The
invariant says only that the parent is no greater than its children —
siblings are unordered with respect to each other, and elements at the
same depth in different subtrees are unordered. This is why a heap is
not a sorted array.

The algorithm's correctness depends on:

1. `Less` defines a strict weak order: irreflexive, transitive, and
   `!Less(a, b) && !Less(b, a)` gives a valid equivalence class.
2. `Less` is consistent across the lifetime of an item in the heap.
   Mutating an item's priority *without* `heap.Fix` violates this.
3. `Swap(i, j)` swaps the elements at those indices and maintains any
   external bookkeeping (e.g., the `index` field).

If any of those breaks, the heap is silently wrong. There is no
runtime check; `heap.Pop` will return whatever it returns.

## 2. Complexity, exactly

| Operation | Time | Comparisons | Swaps |
|-----------|------|-------------|-------|
| `Init(h)` | O(n) | up to 2n | up to n |
| `Push(h, x)` | O(log n) | up to ⌈log₂ n⌉ | up to ⌈log₂ n⌉ |
| `Pop(h)` | O(log n) | up to 2⌈log₂ n⌉ | up to ⌈log₂ n⌉ |
| `Remove(h, i)` | O(log n) | up to 2⌈log₂ n⌉ | up to ⌈log₂ n⌉ |
| `Fix(h, i)` | O(log n) | up to 2⌈log₂ n⌉ | up to ⌈log₂ n⌉ |
| `Peek` (read `h[0]`) | O(1) | 0 | 0 |

`Init` looks linear at first glance — you call `down` on n/2 elements,
each potentially walking O(log n) levels — but the total work is
bounded by 2n because the bottom levels (which contain most of the
elements) only walk a constant number of levels each. This is a
classic amortized-analysis result.

`Push` calls `siftUp`. `Pop` swaps `h[0]` with `h[n-1]`, decreases
length by one, and calls `siftDown` on the new root. `Remove(i)` does
both — sifts down then up — because the moved element might be larger
or smaller than its new neighbors.

`Fix` is unique: it doesn't know which way to sift. The implementation
calls `down` first; if `down` did nothing, it calls `up`. Cheap to
call when in doubt.

## 3. Read the source

The heap algorithm in `container/heap` is 50 lines. Worth reading once.

```go
// from $GOROOT/src/container/heap/heap.go (paraphrased)

func Init(h Interface) {
    n := h.Len()
    for i := n/2 - 1; i >= 0; i-- {
        down(h, i, n)
    }
}

func Push(h Interface, x any) {
    h.Push(x)
    up(h, h.Len()-1)
}

func Pop(h Interface) any {
    n := h.Len() - 1
    h.Swap(0, n)
    down(h, 0, n)
    return h.Pop()
}

func down(h Interface, i0, n int) bool {
    i := i0
    for {
        j1 := 2*i + 1
        if j1 >= n || j1 < 0 { // overflow check
            break
        }
        j := j1
        if j2 := j1 + 1; j2 < n && h.Less(j2, j1) {
            j = j2
        }
        if !h.Less(j, i) {
            break
        }
        h.Swap(i, j)
        i = j
    }
    return i > i0
}
```

Two things to notice:

1. **`Pop` calls `Swap(0, n-1)`, then `down`, then your `Pop`.** Your
   `Pop` is responsible only for shrinking the slice and returning the
   last element. The algorithm does the bookkeeping. Misunderstanding
   this is the most common source of broken heaps.

2. **`down` returns whether anything moved.** `Fix` uses that to
   decide whether to `up` afterwards.

## 4. Why `Pop` returns the *last* element

Most heap textbooks say "Pop returns the root." `container/heap` says
"Pop returns the last element after the algorithm has moved the root
there." This was a deliberate API choice that lets `Interface.Pop`
also serve as a slice-shrink primitive without any allocation.

It also lets `heap.Remove(h, i)`:

```go
func Remove(h Interface, i int) any {
    n := h.Len() - 1
    if n != i {
        h.Swap(i, n)
        if !down(h, i, n) {
            up(h, i)
        }
    }
    return h.Pop()
}
```

Same `Pop`-as-tail-removal semantics. If your `Push`/`Pop` doesn't
follow that contract, `Remove` is also broken.

## 5. The `index` field, justified

The PQ idiom in middle.md gives every item an `index int` field that
`Swap` keeps current. Why do that?

Without it, `Update(item, priority)` requires *finding* the item in
the slice — O(n). With it, you call `heap.Fix(pq, item.index)` in
O(log n). The price: every `Swap` does two assignments instead of
one. For a workload with frequent updates, the trade is overwhelming.

A subtle point: when you `Pop` an item, set `item.index = -1` so
later `Cancel`/`Update` calls can detect the misuse. Without that
sentinel, calling `Cancel` on a popped item invokes
`heap.Remove(pq, item.index)` with a stale (now possibly invalid)
index — undefined behavior.

## 6. Stability

A heap is **not** stable. Two items with equal priorities can come
out in any order, and reversing a `Less` doesn't preserve order
either. If you need ties broken by insertion order, encode it in the
priority:

```go
type Item struct {
    Priority int
    Seq      uint64 // increasing, set on Push
}

func (a ByPrio) Less(i, j int) bool {
    if a[i].Priority != a[j].Priority {
        return a[i].Priority > a[j].Priority // max
    }
    return a[i].Seq < a[j].Seq // FIFO within priority
}
```

The same trick handles "newest first within a priority" or any other
secondary key. Don't rely on heap behavior for ordering you need to
guarantee — encode it explicitly.

## 7. Allocation profile of `container/heap`

Per `Push(h, x)`:

- One call to your `Push`, which `appends` to the underlying slice.
  The amortized allocation is what `append` does; for steady-state
  workloads where the slice has reached its final size, **zero**
  per call.
- One `interface{}` box of `x` if `T` is not already an interface or
  pointer. For `int` values, that's a 16-byte heap allocation
  (pointer to the value plus the type word) on every `Push`.

Per `Pop(h)`:

- Your `Pop` returns the last slice element as `any`. If `T` is a
  value type, the *return* boxes it again. (`x := old[n-1]` doesn't
  allocate; `return x` does, because the return type is `any`.)
- Your slice shrinks; the backing array is not reallocated.

Total: two small allocations per `Push`+`Pop` cycle for value types.
For `*Item` payloads (the canonical idiom), the boxing is zero-cost
because pointers don't need a separate box — `any` holding a pointer
fits in two machine words without indirection. **This is the main
reason real PQ code uses `*Item` rather than `Item`.**

If you want zero allocation per push/pop, you must either:

- Use pointer payloads (the standard idiom), or
- Bypass `container/heap` entirely and inline the algorithm against
  a typed slice (covered in optimize.md).

## 8. Cache locality

A heap in a slice is contiguous in memory, so `down` and `up` walk a
chain of indices that have predictable spatial relationships:
`parent(i) = (i-1)/2`. The first few levels (the root, its children,
its grandchildren) fit in L1; deeper levels miss caches more often.

Compare with a tree-based heap (allocated nodes with explicit
left/right pointers): every step is a pointer chase, almost always a
cache miss. The slice-backed heap wins by 5–10× on most CPUs even
when the asymptotic complexity is the same.

For a heap that grows beyond L2 cache — say, hundreds of thousands of
items — `down` becomes memory-bound. At that scale, an n-ary heap
(d-ary heap) with d=4 or d=8 packs more children into a cache line
and reduces tree depth by a constant factor. `container/heap` doesn't
provide one; you'd write it yourself if you needed it.

## 9. The `container/list` invariants

```
list.List has a sentinel root.
root.next = first element
root.prev = last element
For an empty list, root.next == root.prev == &root.

For every element e:
  e.list == &containingList
  e.next.prev == e
  e.prev.next == e
```

The `list` field on `Element` is a private pointer back to the owning
`List`. It exists for one reason: methods like `Remove`, `MoveToFront`,
and `InsertBefore` validate that the `Element` belongs to *this* list.
Cross-list operations are silently no-ops:

```go
l1 := list.New(); e := l1.PushBack(1)
l2 := list.New()
l2.Remove(e)             // no-op; e belongs to l1
l2.MoveToFront(e)        // no-op
```

This is a quiet footgun. There's no error. If you mix lists, you get
no exception, no panic — just a missing operation. The defensive
practice: keep `*Element`s and their owning `*List` together, never
pass them across boundaries where the owner is ambiguous.

## 10. `*Element` allocations

Every `PushBack` / `PushFront` / `InsertBefore` / `InsertAfter`
allocates a fresh `*Element`. There is no pooling. For an LRU cache
with high churn, this allocation is the dominant cost.

Mitigations:

1. **Reuse `Element`s manually.** When you `Remove` and re-`Insert`
   the same value, the original `Element` is freed and a new one is
   allocated. If you want to reuse, call `MoveToFront`/`MoveToBack`
   instead — those don't allocate.

2. **Intrusive list (middle.md, §8).** Embed the next/prev pointers
   in your value type and write the four list methods yourself. No
   per-item allocation, no `any` boxing.

3. **Arena allocator for `Element`.** Hand-roll a pool of
   pre-allocated `Element` structs and reuse them. This is what
   high-performance LRU caches do; it requires copying the
   `container/list` source and replacing the `list` package.

The default `container/list` is fine for caches in the thousands. For
caches in the millions, profile and consider one of the alternatives.

## 11. `*list.List` zero-value caveat

`var l list.List` does *not* initialize the sentinel. The first
operation lazy-initializes via `lazyInit`, but only on operations
that call it. The result: code that reads from a zero-value list
(`l.Front()`, `l.Len()`) returns sensible defaults; code that writes
(`l.PushBack(v)`) initializes. Mixing reads and writes on a
zero-value list across goroutines is a race for the same reason any
lazy initialization is a race.

The defensive practice: always create lists with `list.New()` or
explicitly call `l.Init()` before exposing the list to other
goroutines.

## 12. `container/ring` invariants

```
For every node r: r.next.prev == r and r.prev.next == r.
A ring of one node has r.next == r and r.prev == r.
A "nil" ring has r == nil.
```

There is no separate `Ring` type. The "container" is the cycle
reachable from any node. This means:

- `r.Len()` walks the ring, so it's O(n).
- There's no way to ask "is this ring valid?" without walking.
- Splitting a ring (using `Unlink`) gives you two valid rings, both
  reachable through their respective starting nodes.

`r.Link(s)` inserts `s` after `r` in O(1). It returns the original
`r.Next()`, which is now disconnected from the original ring and is
the head of a new sub-ring. This is the splice operation that
`container/ring` exists for.

`r.Unlink(n)` removes the `n` nodes after `r` and returns them as a
new ring. O(1) regardless of `n`.

## 13. Why `container/ring` is mostly historical

Three reasons to skip it in new code:

1. **The "ring" you usually want is a fixed-size circular buffer.**
   `container/ring` is a linked structure, so it has the same cache
   penalty as `container/list`. A slice-backed circular buffer is
   simpler, faster, and idiomatic in Go (see middle.md §13).

2. **Concurrent producer-consumer is what channels are for.** If
   you're tempted to build a "ring buffer for messages between
   goroutines," `make(chan T, cap)` is the answer. It handles
   blocking, signaling, and cancellation in one primitive.

3. **`r.Len()` is O(n).** This is a sharp edge. Code that calls
   `Len` every iteration for bookkeeping is silently quadratic.

The remaining valid use case — splicing arbitrary chunks at O(1) — is
real but rare. When you need it, `container/ring` is correct and
well-tested.

## 14. Memory layout: the slice-of-pointers PQ

The canonical PQ in middle.md stores `[]*Item`. A `*Item` is 8 bytes
on a 64-bit system, so the heap's backing array is 8 bytes per slot.
The `Item` structs themselves are scattered across the heap (in the
GC sense) at whatever addresses the allocator picked.

Pros:

- `Swap(i, j)` moves 16 bytes (two 8-byte pointers).
- `index` field maintenance: one `*Item` deref, one int store, twice.
- Items can be referenced from outside the heap (a `map[Key]*Item`
  for `Update` by key).

Cons:

- Cache locality is worse than a slice of values.
- Every `Item` is a separate allocation on creation.
- GC walks every pointer in the backing array on every cycle.

For workloads with millions of items, switching to a slice of values
plus an external map for indexing can halve memory and reduce GC
pressure significantly. Cost: `Swap` is now O(sizeof(Item)) — 64
bytes for a typical struct vs 16 for two pointers — so the heap's
constant factor goes up. Profile both.

## 15. The index-update race

In a concurrent PQ wrapped by a mutex, an `Update` looks safe:

```go
func (s *SafePQ) Update(item *Item, p int) {
    s.mu.Lock()
    item.Priority = p
    heap.Fix(s.pq, item.index)
    s.mu.Unlock()
}
```

But if a *caller* does `pq.Update(item, p)` after `pq.Pop()` already
removed the item — even from a different goroutine — `item.index` is
`-1` (assuming you set the sentinel) and `heap.Fix(s.pq, -1)` panics.

Two defenses:

1. Inside `Update`, check `item.index >= 0` before calling `Fix`.
2. Document that the caller must coordinate `Update` against
   `Pop`/`Cancel`. The PQ alone can't enforce ordering across
   independent calls.

The same applies to `Cancel`. Treat `index == -1` as the contract for
"no longer queued" and short-circuit at every entry point.

## 16. Heap-on-disk and external sorting

A binary heap of *N* elements on disk gives you the standard
external-sort priority queue: load the heap top into memory, pop and
output, push the next element from the source run. With *k* sorted
runs and a heap of size *k*, you merge in O(N log k) time and O(k)
memory.

`container/heap` doesn't help you with disk layout, but the algorithm
is the same. For really large external sorts, a tournament tree or a
loser-tree gives slightly fewer comparisons than a heap; for most
purposes, a `container/heap` against a slice of "stream cursors" is
plenty.

## 17. Fairness and starvation

A pure priority queue offers no fairness guarantee: a steady stream of
high-priority items can starve lower-priority items indefinitely. For
a scheduler that needs liveness:

- **Aging.** Periodically increment the priority of waiting items.
- **Multi-level queue.** One PQ per priority class, scheduled
  round-robin or with weighted shares.
- **Deadline-only.** Replace "priority" with "deadline": every item
  eventually becomes the most urgent and gets serviced.

`container/heap` is the building block; the policy is yours.

## 18. The `sort.Interface` connection

`heap.Interface` extends `sort.Interface`. The connection is exact:
once `Init` is called, the slice is *not* sorted, but it satisfies the
heap invariant. If you then repeatedly `heap.Pop`, the slice is
gradually emptied in sorted order. The byproduct of doing this on a
slice in place is heap sort — O(n log n) worst case, in-place,
unstable.

```go
// Heapsort using container/heap.
func Heapsort(h heap.Interface) {
    heap.Init(h)
    for h.Len() > 0 {
        heap.Pop(h)
    }
    // After this loop, the underlying slice is in *reverse* order
    // because each Pop swapped the min to the end before slicing.
}
```

`sort.Slice` and `slices.Sort` (introduced in Go 1.21) are
introsort-based and faster on small inputs because they have lower
constant factors. Don't use `container/heap` to sort unless you also
need streaming pop semantics.

See [`../16-sort-slices-maps/`](../16-sort-slices-maps/junior.md) for the
modern sort packages.

## 19. Generics and the future

Go's generics (1.18+) make `container/heap` feel dated. The package
still ships unchanged because Go's compatibility promise is strict.
Every proposal to add a generic priority queue or list to the
standard library has stalled on bikeshedding (which interfaces, which
method names, blocking vs non-blocking, sharded vs single-mutex).

The current state of play:

- `container/heap`, `container/list`, `container/ring`: kept for
  compatibility. New code can use them with a generic wrapper.
- `slices` (1.21+): replaces a lot of list-of-values use cases.
- `maps` (1.21+): same.
- Third-party generic PQs: `github.com/emirpasic/gods/v2`,
  `github.com/google/btree` (not a PQ but a generic ordered tree).

A generic PQ in the standard library is on the roadmap but not
imminent. Build your own thin wrapper or import a third-party.

## 20. What to read next

- [professional.md](professional.md) — production patterns: timer
  wheels at scale, replacement decisions, observability.
- [specification.md](specification.md) — the formal contract reference.
- [optimize.md](optimize.md) — when the constant factors dominate.
- [find-bug.md](find-bug.md) — drills targeting the items in this file.

External references:

- The Go source: `$GOROOT/src/container/heap/heap.go` is the
  authoritative algorithm. Read it once.
- *Introduction to Algorithms* (CLRS), Chapter 6 — the heap
  algorithms in pseudocode and the linear-time `Init` proof.
- Donald Knuth, *TAOCP Vol. 3*, §5.2.3 — the classic treatment of
  heaps and heapsort.
