# 8.17 `container/*` — Optimize

> When you've shipped code on top of `container/heap` and
> `container/list` and benchmarks tell you the constant factor is
> the problem. This file covers replacing the standard implementations
> with typed alternatives, the allocation profile under load, and the
> data-layout choices that move performance.

## 1. Where the time goes

Profile a heap-backed priority queue under load. Typical breakdown
for `container/heap` with `*Item` payloads:

| Cost | Share |
|------|-------|
| `Less` (the user-supplied comparator) | 30–50% |
| `Swap` (with index maintenance) | 25–35% |
| Indirect calls through `heap.Interface` | 10–15% |
| `append` slice growth | 5–10% |
| `any` boxing (for pointer payloads) | 0% (free for pointers) |

For `int` (or other value) payloads:

| Cost | Share |
|------|-------|
| `any` boxing on Push/Pop | 30–40% |
| `Less` | 20–30% |
| `Swap` | 15–25% |
| Indirect calls | 10–15% |

**Lever 1:** Use pointer payloads to eliminate boxing.
**Lever 2:** Inline the algorithm on a typed slice to eliminate
the interface dispatch and let the compiler inline `Less` and `Swap`.

## 2. The typed-heap rewrite

A hand-rolled int min-heap, no `container/heap`:

```go
type IntPQ struct{ d []int }

func (p *IntPQ) Len() int { return len(p.d) }
func (p *IntPQ) Peek() int { return p.d[0] }

func (p *IntPQ) Push(v int) {
    p.d = append(p.d, v)
    i := len(p.d) - 1
    for i > 0 {
        parent := (i - 1) / 2
        if p.d[parent] <= p.d[i] {
            break
        }
        p.d[parent], p.d[i] = p.d[i], p.d[parent]
        i = parent
    }
}

func (p *IntPQ) Pop() int {
    n := len(p.d) - 1
    p.d[0], p.d[n] = p.d[n], p.d[0]
    v := p.d[n]
    p.d = p.d[:n]

    i := 0
    for {
        l, r := 2*i+1, 2*i+2
        smallest := i
        if l < n && p.d[l] < p.d[smallest] {
            smallest = l
        }
        if r < n && p.d[r] < p.d[smallest] {
            smallest = r
        }
        if smallest == i {
            break
        }
        p.d[i], p.d[smallest] = p.d[smallest], p.d[i]
        i = smallest
    }
    return v
}
```

Benchmark on a Push/Pop mix at steady state of 10k items: typically
3–5× faster than `container/heap`-with-`int`, and 1.5–2× faster than
`container/heap`-with-`*Item`. The compiler inlines the comparison
and the swap, and there's no `interface{}` dispatch.

Make it generic with `cmp.Ordered` (Go 1.21+):

```go
import "cmp"

type PQ[T cmp.Ordered] struct{ d []T }

func (p *PQ[T]) Push(v T) {
    p.d = append(p.d, v)
    i := len(p.d) - 1
    for i > 0 {
        parent := (i - 1) / 2
        if !cmp.Less(p.d[i], p.d[parent]) {
            break
        }
        p.d[parent], p.d[i] = p.d[i], p.d[parent]
        i = parent
    }
}
// ... Pop similar
```

For ordered scalar types, the generic version inlines as efficiently
as the int-specific one. For struct payloads with custom comparators,
pass `less func(a, b T) bool` as a constructor parameter; the
compiler's escape analysis usually devirtualizes it if you store it
in a struct field consistently.

## 3. The `Less` indirection cost

`heap.Interface.Less` is an indirect call. The Go compiler can't
devirtualize it because the heap functions take `Interface` as a
parameter. Even if your `IntHeap.Less` is one line, every call goes
through the itab dispatch.

For high-throughput cases, this matters more than it should. The
typed rewrite (§2) eliminates it entirely. If you're staying with
`container/heap`, the trick is to keep `Less` simple (one comparison,
no allocations) so the dispatch overhead dominates the comparison
cost predictably.

## 4. Memory layout: AoS vs SoA

Most PQs use Array-of-Structs:

```go
type Item struct {
    Priority int
    ID       string
    Deadline time.Time
    // ... more fields ...
}

type PQ []*Item
```

Every `Less(i, j)` dereferences two pointers and reads
`Priority` from each. The CPU loads the entire `Item` cache line
even though only 8 bytes were needed.

A Struct-of-Arrays layout:

```go
type PQ struct {
    priorities []int
    ids        []string
    deadlines  []time.Time
}
```

Now `Less` reads two ints from a contiguous slice — better cache
behavior, but `Swap` has to swap three slices in lockstep. For
read-heavy workloads (many `Less`, few `Swap`), SoA wins; for
heavy mutation, AoS wins.

The breakeven is workload-dependent. Profile both. SoA is rarely
worth the code complexity unless the heap is in a hot path.

## 5. Pool the `*Item`s

For a PQ with high churn — items pushed and popped at >100k/s — the
`*Item` allocations dominate. Reuse them:

```go
var itemPool = sync.Pool{
    New: func() any { return &Item{} },
}

func newItem(prio int, val string) *Item {
    item := itemPool.Get().(*Item)
    item.Priority = prio
    item.Value = val
    return item
}

func releaseItem(item *Item) {
    *item = Item{} // zero out
    itemPool.Put(item)
}

// usage
heap.Push(pq, newItem(5, "task"))
top := heap.Pop(pq).(*Item)
process(top)
releaseItem(top)
```

`sync.Pool` is per-P (per-CPU), so contention is low. The catch:
items in the pool are released during GC, so heavy GC pressure can
defeat it. For long-lived items (in the heap for >GC interval), the
pool yields no benefit because items are in use during GC.

## 6. The d-ary heap

A 2-ary (binary) heap has tree depth ≈ log₂ n. A 4-ary heap has depth
log₂ n / 2 — half the depth, four children inspected at each level.
For heaps that exceed L2, a 4-ary heap shaves 20–40% off `Pop`
latency because four child reads happen on the same cache line. The
math: parent of `i` is `(i-1)/4`; first child of `i` is `4*i+1`;
inspect children `[first, first+4)` to find the smallest, swap if
smaller than parent. `container/heap` doesn't ship one; you write it
in 30 lines following the same shape as the binary heap in §2. For
8-byte payloads (int64, pointer), 4 children fit in a 32-byte cache
line on most architectures; for int32, 8-ary or even 16-ary can pay
off.

## 7. Reduce allocation in the LRU

A `container/list`-backed LRU allocates a `*list.Element` and a
`*entry` on every miss. Two ways to reduce:

**Pool the entries.** `sync.Pool` for `*entry` cuts the allocation
by half. Doesn't help with `*list.Element` because it's allocated
inside `container/list`.

**Intrusive list.** Embed `next, prev *node` directly in the entry
struct, write the four list methods yourself. Eliminates the
`*list.Element` allocation entirely. ~50 lines of code; halves the
allocations per insert.

**Fixed-size, slice-backed LRU.** For caches with a known small max
size, allocate a `[N]node` array up front and use array indices as
"pointers." Zero allocations after construction. Code is slightly
more complex (you write your own `prev`/`next` index manipulation)
but the result is the fastest LRU you can write in Go.

```go
type Node[K comparable, V any] struct {
    key      K
    val      V
    next, prev int // -1 for none
}

type FastLRU[K comparable, V any] struct {
    nodes []Node[K, V]
    free  int
    head  int // most recent
    tail  int // least recent
    m     map[K]int
    cap   int
}
```

`Get` on a hit moves the node to the head: rewire four indices, no
allocation, no GC. For caches with sub-microsecond per-op
requirements, this is the design.

## 8. Replace list-backed undo with a slice ring

A bounded undo stack on `container/list` allocates a `*list.Element`
and boxes the `Action` per push. A slice-ring version (preallocated
buffer of size `max`, `head` index that advances modulo `max`,
`cnt` of valid entries) has zero allocations after construction.
For undo histories of any practical size (≤10k), this is the right
design — the linked list adds nothing beyond cleaner-looking code.

## 9. Heap with index map for O(log n) `Update` by key

The PQ idiom in middle.md keeps an `index` field on each item. This
means every `*Item` insert/move updates `Swap`. An alternative that
stores fewer pointers per item:

```go
type IndexedPQ struct {
    keys []Key
    vals []int        // priorities
    idx  map[Key]int  // key -> position in keys/vals
}

func (p *IndexedPQ) Less(i, j int) bool { return p.vals[i] < p.vals[j] }
func (p *IndexedPQ) Swap(i, j int) {
    p.keys[i], p.keys[j] = p.keys[j], p.keys[i]
    p.vals[i], p.vals[j] = p.vals[j], p.vals[i]
    p.idx[p.keys[i]] = i
    p.idx[p.keys[j]] = j
}

func (p *IndexedPQ) Update(k Key, prio int) {
    if i, ok := p.idx[k]; ok {
        p.vals[i] = prio
        heap.Fix(p, i)
    }
}
```

Two slices instead of one slice of pointers; cache-friendlier `Less`.
The map is unavoidable, but it's only consulted on `Update`/`Cancel`
(rare), not on every `Less`/`Swap` (frequent).

For a PQ where `Less` is the hot operation, this layout is faster
than the slice-of-pointers idiom.

## 10. Eliminate `Interface.Pop` allocation

`heap.Pop`'s return type is `any`. For pointer payloads (`*Item`),
the return through `any` is free. For value payloads (`int`,
`time.Time`), there's a box at the return. A typed wrapper hides the
type assertion at one boundary so subsequent code uses the typed
value without further boxing — but the box itself remains. For
zero-allocation pops of value types, you must reimplement the
algorithm (as in §2). There's no other way.

## 11. Concurrent PQ: shard or queue-based

A mutex-wrapped PQ caps throughput at ~10M ops/s on modern CPUs
(single core, no contention) and falls off a cliff under contention.
Two scaling approaches:

**Sharding.** Multiple independent PQs; the producer chooses one
(round-robin or by hash). Loses global priority ordering. Useful
when "near-priority" is good enough (e.g., per-tenant queues).

**Lock-free MPMC queue + per-thread local PQs.** Each thread keeps a
small local PQ; periodically drains the global queue and merges. Hard
to implement correctly. For most production use, the sharded
approach is good enough and far simpler.

The third option — a lock-free heap — has been published as research
but is rarely worth the complexity in application code. Consider it
only if profiling shows the queue mutex is the dominant bottleneck
*and* you've ruled out sharding.

## 12. The 80/20 of optimizing container code

In rough order of impact:

1. **Use pointer payloads in `container/heap`** to skip `any`
   boxing. (Free; immediate.)
2. **Switch the LRU's read lock to a write lock or shard.** Fixes
   correctness or removes a contention bottleneck.
3. **Replace `container/list` with a slice ring buffer** when you
   don't need O(1) middle insertion.
4. **Replace `container/heap` with a typed inline implementation**
   when the heap is in a hot path and pointer payloads don't apply.
5. **Pool the `*Item`s** if churn is high and items are short-lived.
6. **Switch to a 4-ary heap** for very large heaps that exceed L2.
7. **Switch to an intrusive or array-backed LRU** for sub-microsecond
   per-op requirements.

Steps 1–3 are easy and apply broadly. Steps 4–7 are real engineering
work. Profile before each.

## 13. What not to optimize

- **`container/ring` performance.** If you're using `container/ring`,
  the right optimization is "stop using `container/ring`." Replace
  it with a slice ring buffer or a channel.
- **The LRU's map.** Go's built-in map is highly optimized; replacing
  it with a swiss table or open-addressing variant rarely yields
  more than 10–15% in practice and complicates correctness.
- **`Less` on pointer comparison.** Comparing `time.Time` for
  ordering with `Before` is one indirect call — micro-optimizing it
  to compare `UnixNano` shaves nanoseconds. Worth it only at
  pathological scale.

## 14. Benchmarks to write

Always benchmark before and after. The shape:

```go
func BenchmarkHeapPushPop(b *testing.B) {
    h := NewIntPQ()
    rng := rand.New(rand.NewSource(1))
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        h.Push(rng.Intn(1 << 20))
        if h.Len() > 1000 {
            h.Pop()
        }
    }
}
```

Measure ns/op and allocs/op. The latter is often more revealing —
allocations imply GC pressure, which cascades into latency variance.

For LRU benchmarks, simulate a realistic workload (Zipfian
distribution of keys) rather than uniform random; uniform random
makes everything look like a miss-heavy stress test, which doesn't
match real cache behavior.

## 15. What to read next

- [find-bug.md](find-bug.md) — for the antipatterns these
  optimizations avoid.
- [professional.md](professional.md) — production patterns at scale.
- [`../16-sort-slices-maps/`](../16-sort-slices-maps/junior.md) — `slices`
  and `maps` for the cases where `container/*` doesn't apply.
- The Go runtime source: `runtime/map.go` for how the built-in map
  works, and `runtime/iface.go` for how interface dispatch works
  (the indirection you're avoiding when you go typed).
