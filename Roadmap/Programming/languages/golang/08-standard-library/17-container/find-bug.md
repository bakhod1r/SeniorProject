# 8.17 `container/*` — Find the Bug

> Eight broken snippets across the three packages. For each, identify
> the bug, explain why it produces wrong behavior, and write the fix.
> Difficulty rises from "obvious if you've read junior.md" to "subtle
> even after senior.md."

## Bug 1 — The wrong Push

```go
type IntHeap []int

func (h IntHeap) Len() int            { return len(h) }
func (h IntHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *IntHeap) Push(x any)         { *h = append(*h, x.(int)) }
func (h *IntHeap) Pop() any           {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[:n-1]
    return x
}

func main() {
    h := &IntHeap{5, 2, 9, 1}
    heap.Init(h)
    h.Push(3) // BUG
    fmt.Println(heap.Pop(h))
}
```

What's wrong, and what does it print?

**Diagnosis.** `h.Push(3)` calls the `Interface.Push` method directly,
which only appends. The heap invariant is broken at the new tail:
`h[4]` is `3`, but its parent `h[1]` is `2`. `heap.Pop` swaps `h[0]`
(min, which is `1`) with `h[4]` (`3`) and sifts down — getting the
right answer for *this* pop by accident, but leaving a corrupt heap.
Subsequent pops can return values out of order.

**Fix.** Use the package-level `heap.Push(h, 3)`. Treat
`Interface.Push` and `Interface.Pop` as private — they're called by
the algorithm, not by you.

## Bug 2 — Forgotten Fix

```go
type Item struct {
    Value    string
    Priority int
    index    int
}

type PQ []*Item

// ... heap.Interface methods that maintain index ...

func main() {
    pq := PQ{}
    heap.Push(&pq, &Item{Value: "a", Priority: 1})
    heap.Push(&pq, &Item{Value: "b", Priority: 5})
    heap.Push(&pq, &Item{Value: "c", Priority: 3})

    pq[0].Priority = 100 // BUG: bumped without Fix
    fmt.Println(heap.Pop(&pq).(*Item).Value) // "a"?
}
```

What's wrong, and what does it print?

**Diagnosis.** `pq[0]` was the highest-priority item under the
original ordering. After mutating its `Priority` to 100, the heap
invariant is silently broken — the package has no way to know.
`heap.Pop` swaps `pq[0]` (now Priority 100, value "a") with the tail,
sifts down, and returns the old tail. The result depends on the
original layout; in many cases, you get `"a"` (because it was already
at the root and the swap-then-sift returns it via `Pop`), but the
priority used for ordering inside `Less` was 100, which the algorithm
treats as "greater than its children" and gets confused.

The deeper bug: from this point on, the heap is in an inconsistent
state. Future `Push`/`Pop` operations return arbitrary results.

**Fix.** After mutating priority, call `heap.Fix(&pq, item.index)`.
Better: expose a `pq.Update(item, p)` method that does both atomically.

## Bug 3 — Stale index after Pop

```go
type Item struct{ Priority int; index int }

func (pq *PQ) Pop() any {
    old := *pq
    n := len(old)
    item := old[n-1]
    *pq = old[:n-1]
    // BUG: item.index not reset
    return item
}

// later:
popped := heap.Pop(&pq).(*Item)
pq.Cancel(popped) // calls heap.Remove(&pq, popped.index)
```

**Diagnosis.** After `Pop`, `popped.index` still holds its last
heap-position value, which is now meaningless. `Cancel` calls
`heap.Remove(&pq, popped.index)`, which either:

- Panics (if `index >= len`), or
- Silently corrupts the heap by removing the wrong element (if a new
  item was pushed into that slot).

**Fix.** Set `item.index = -1` in `Pop` and check for `-1` in
`Cancel`/`Update`:

```go
func (pq *PQ) Pop() any {
    old := *pq
    n := len(old)
    item := old[n-1]
    old[n-1] = nil   // GC hygiene
    item.index = -1
    *pq = old[:n-1]
    return item
}

func (pq *PQ) Cancel(item *Item) {
    if item.index < 0 {
        return
    }
    heap.Remove(pq, item.index)
}
```

## Bug 4 — Less without strict weak order

```go
func (h MyHeap) Less(i, j int) bool {
    // BUG: returns true for equal priorities too
    return h[i].Priority >= h[j].Priority
}
```

**Diagnosis.** `Less` must be a strict order: `Less(a, b)` and
`Less(b, a)` cannot both be true. Using `>=` makes `Less(a, a) ==
true` (irreflexive violation), and for two equal-priority items A
and B both `Less(A, B)` and `Less(B, A)` are true — the algorithm
swaps them indefinitely under some operations.

`heap.Init` and `heap.Pop` may not visibly fail on small inputs, but
on large heaps the result is heap corruption, infinite loops, or
out-of-bounds indices in `Swap`.

**Fix.** Use `>` (or `<` for min-heap):

```go
func (h MyHeap) Less(i, j int) bool {
    return h[i].Priority > h[j].Priority
}
```

If you need ties broken by a secondary key, encode it explicitly:

```go
func (h MyHeap) Less(i, j int) bool {
    if h[i].Priority != h[j].Priority {
        return h[i].Priority > h[j].Priority
    }
    return h[i].Seq < h[j].Seq
}
```

## Bug 5 — LRU map without removing on eviction

```go
type LRU struct {
    cap int
    ll  *list.List
    m   map[string]*list.Element
}

func (c *LRU) Put(k, v string) {
    if e, ok := c.m[k]; ok {
        c.ll.MoveToFront(e)
        e.Value = v // BUG #1
        return
    }
    if c.ll.Len() == c.cap {
        c.ll.Remove(c.ll.Back()) // BUG #2: map not updated
    }
    c.m[k] = c.ll.PushFront(v)
}
```

**Diagnosis.**

- **Bug #1:** `e.Value = v` overwrites the entry value, but the
  entry should have been a key-value pair (`*entry{key, val}`). The
  fact that `Value` was previously a string means the original code
  stored only values in the list, with no way to recover the key
  during eviction.

- **Bug #2:** When evicting from the back, the code removes from the
  list but doesn't `delete(c.m, key)` because it doesn't know the
  key. The map grows forever; the cache leaks memory.

**Fix.** Store `*entry{key, val}` in the list:

```go
type entry struct{ key, val string }

func (c *LRU) Put(k, v string) {
    if e, ok := c.m[k]; ok {
        c.ll.MoveToFront(e)
        e.Value.(*entry).val = v
        return
    }
    if c.ll.Len() == c.cap {
        old := c.ll.Back()
        ent := c.ll.Remove(old).(*entry)
        delete(c.m, ent.key)
    }
    c.m[k] = c.ll.PushFront(&entry{k, v})
}
```

## Bug 6 — `RWMutex` for an LRU

```go
type SafeLRU struct {
    mu sync.RWMutex
    c  *LRU
}

func (s *SafeLRU) Get(k string) (string, bool) {
    s.mu.RLock() // BUG
    defer s.mu.RUnlock()
    return s.c.Get(k)
}
```

**Diagnosis.** `LRU.Get` calls `MoveToFront`, which mutates the
list. Holding only the read lock means two concurrent `Get`s race on
the list pointers. With `-race`, you'll see warnings; without it,
the list eventually corrupts and panics on a nil dereference.

**Fix.** Use the write lock for `Get` too:

```go
func (s *SafeLRU) Get(k string) (string, bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.c.Get(k)
}
```

If you need read concurrency at scale, shard the cache (see
professional.md §4) instead of using `RWMutex`.

## Bug 7 — `container/ring.Len` in a hot loop

```go
func process(r *ring.Ring) {
    for i := 0; i < r.Len(); i++ { // BUG
        r.Value = transform(r.Value)
        r = r.Next()
    }
}
```

**Diagnosis.** `r.Len()` is O(n) — it walks the ring counting
nodes. Calling it in a loop condition makes the loop O(n²). On a
ring of 10k nodes, that's 100M operations instead of 10k.

**Fix.** Cache the length:

```go
func process(r *ring.Ring) {
    n := r.Len()
    for i := 0; i < n; i++ {
        r.Value = transform(r.Value)
        r = r.Next()
    }
}
```

Or use `r.Do(func(v any) { ... })`, which iterates in O(n) without
exposing the length.

## Bug 8 — Cross-list `*Element`

```go
l1 := list.New()
e := l1.PushBack("hello")

l2 := list.New()
l2.MoveToFront(e) // BUG: e belongs to l1
fmt.Println(l1.Len(), l2.Len())
```

**Diagnosis.** `MoveToFront` silently no-ops when the `*Element`
doesn't belong to the receiver list. The output is `1 0`. No error,
no panic. This is the documented behavior — and a quiet footgun.

The same applies to `Remove`, `MoveBefore`, `MoveAfter`, and
`InsertBefore`/`InsertAfter`. If you mix lists, none of these
methods will tell you.

**Fix.** Treat `*Element` and the owning `*List` as a tightly
coupled pair. Don't pass `*Element`s across boundaries where the
owner is ambiguous. If you need to move between lists, do it
explicitly:

```go
v := l1.Remove(e).(string)
l2.PushFront(v)
```

## Bug 9 — Goroutine leak in a blocking PQ

```go
type BlockingPQ struct {
    mu   sync.Mutex
    cond *sync.Cond
    pq   *Heap[int]
}

func (b *BlockingPQ) Pop(ctx context.Context) (int, error) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for b.pq.Len() == 0 {
        b.cond.Wait() // BUG: doesn't honor ctx
    }
    return b.pq.Pop(), nil
}
```

**Diagnosis.** `cond.Wait` blocks until `Signal`/`Broadcast`. If the
context is cancelled, `Pop` doesn't notice — the goroutine leaks
until somebody pushes (which may be never).

**Fix.** Spawn a watcher that broadcasts on cancellation:

```go
func (b *BlockingPQ) Pop(ctx context.Context) (int, error) {
    done := make(chan struct{})
    defer close(done)
    go func() {
        select {
        case <-ctx.Done():
            b.mu.Lock()
            b.cond.Broadcast()
            b.mu.Unlock()
        case <-done:
        }
    }()

    b.mu.Lock()
    defer b.mu.Unlock()
    for b.pq.Len() == 0 {
        if ctx.Err() != nil {
            return 0, ctx.Err()
        }
        b.cond.Wait()
    }
    return b.pq.Pop(), nil
}
```

This is correct but allocates a goroutine and a channel per call.
For high-throughput code, design the queue around a channel from the
start (e.g., a "ready" channel that's signalled when items become
available); `cond.Wait` doesn't compose cleanly with `context`.

## Bug 10 — `Pop` from an empty heap

```go
func main() {
    h := &IntHeap{}
    heap.Pop(h) // BUG
}
```

**Diagnosis.** `heap.Pop` on an empty heap calls `h.Swap(0, -1)`
internally, which on the slice-based `IntHeap` panics with index out
of range. The package documentation requires the caller to check
`Len() > 0` first.

**Fix.** Check `Len()` before popping:

```go
if h.Len() > 0 {
    v := heap.Pop(h).(int)
    _ = v
}
```

Or wrap the heap with a typed `Pop` that returns `(T, bool)`:

```go
func (h *Heap[T]) TryPop() (T, bool) {
    if h.Len() == 0 {
        var zero T
        return zero, false
    }
    return h.Pop(), true
}
```

## Bug 11 — Iteration that frees the current node

```go
for e := l.Front(); e != nil; e = e.Next() {
    if shouldRemove(e.Value) {
        l.Remove(e) // BUG
    }
}
```

**Diagnosis.** After `Remove(e)`, `e.next` is set to `nil` (this is
a defensive step in `container/list` to make `Element` reuse safer).
The loop's `e = e.Next()` then evaluates to `nil`, ending the
iteration even if there are more elements after the removed one.

**Fix.** Capture `Next()` before removing:

```go
for e := l.Front(); e != nil; {
    next := e.Next()
    if shouldRemove(e.Value) {
        l.Remove(e)
    }
    e = next
}
```

Same trick for any "iterate and conditionally remove" loop on a
linked list.

## Bug 12 — Hidden allocation in Push of a value type

```go
type IntHeap []int
// ... heap.Interface methods ...

func main() {
    h := &IntHeap{}
    for i := 0; i < 1_000_000; i++ {
        heap.Push(h, i) // BUG: hot-path allocation
        if h.Len() > 100 {
            heap.Pop(h)
        }
    }
}
```

**Diagnosis.** `heap.Push(h, i)` takes `i` as `any`. For an `int`
value, the compiler boxes it on the heap (~16 bytes per call). At
1M iterations, that's ~16 MB of garbage that the GC has to clean
up. The pop's return value boxing adds another 16 bytes per pop.

**Fix.** For a typed heap with no boxing, write a generic wrapper
and reimplement the heap algorithm on a typed slice:

```go
type IntPQ struct{ data []int }

func (h *IntPQ) Push(v int) {
    h.data = append(h.data, v)
    h.up(len(h.data) - 1)
}

func (h *IntPQ) Pop() int {
    n := len(h.data) - 1
    h.data[0], h.data[n] = h.data[n], h.data[0]
    v := h.data[n]
    h.data = h.data[:n]
    h.down(0)
    return v
}

func (h *IntPQ) up(i int) {
    for i > 0 {
        p := (i - 1) / 2
        if h.data[p] <= h.data[i] {
            break
        }
        h.data[p], h.data[i] = h.data[i], h.data[p]
        i = p
    }
}

func (h *IntPQ) down(i int) {
    n := len(h.data)
    for {
        l, r := 2*i+1, 2*i+2
        small := i
        if l < n && h.data[l] < h.data[small] {
            small = l
        }
        if r < n && h.data[r] < h.data[small] {
            small = r
        }
        if small == i {
            break
        }
        h.data[i], h.data[small] = h.data[small], h.data[i]
        i = small
    }
}
```

Zero allocations per push/pop. Benchmark vs `container/heap` to
confirm — typically 3–5× faster for value-type payloads.

## What to read next

- [optimize.md](optimize.md) — when the constant factors dominate
  and you write your own.
- [tasks.md](tasks.md) — practice exercises that exercise these
  patterns end-to-end.
- [senior.md](senior.md) — the formal contract these bugs violate.
