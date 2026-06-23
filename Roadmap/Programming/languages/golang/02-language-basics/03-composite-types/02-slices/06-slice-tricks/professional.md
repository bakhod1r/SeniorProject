# Slice Tricks — Professional

## 1. The production framing

In production code, slice tricks are a small but load-bearing piece. They show up in three places:

1. **Hot paths.** Loops that run millions of times per second — request decoding, event-bus dispatch, packet processing. Allocations per call directly translate to GC pressure and tail latency.
2. **Long-lived data structures.** Queues, caches, event buffers — anything that pushes and pops over hours. The wrong delete trick leaks references; the wrong pop-front grows backing storage unboundedly.
3. **Public APIs.** Functions returning slices to untrusted callers. The wrong slice trick exposes shared backing storage and creates spooky-action-at-a-distance bugs.

This file covers the patterns that experienced Go teams adopt: when to abandon wiki tricks for `slices.*`, when to abandon slices entirely for `container/list` or a ring buffer, the allocation-profiling workflow for slice-heavy code, and the small set of conventions that scale across a large codebase.

The recurring meta-rule: **in 2025+ Go, the answer to "which slice trick should I use?" is usually "use `slices.X` and stop thinking about it"** — unless your benchmark says otherwise, in which case the section on swap-and-pop, ring buffers, and pooling is where you live.

---

## 2. When to abandon tricks for `slices.*`

A simple decision table for new code:

| Operation | Use `slices.*` if Go ≥ | Notes |
|-----------|------------------------|-------|
| Insert | 1.21 | `slices.Insert` |
| Delete (range) | 1.22 | `slices.Delete`; 1.21 doesn't `clear` the tail |
| Replace range with new range | 1.21 | `slices.Replace` |
| Clone | 1.21 | `slices.Clone` |
| Concat | 1.22 | `slices.Concat` |
| Compact adjacent equal | 1.21 | `slices.Compact` |
| Reverse | 1.21 | `slices.Reverse` |
| Chunk into sub-slices | 1.23 | `slices.Chunk` (iterator) |
| Grow to cap n | 1.21 | `slices.Grow` |
| Sort | 1.21 | `slices.Sort`, `slices.SortFunc` |
| Equal | 1.21 | `slices.Equal` |
| Index, Contains | 1.21 | `slices.Index`, `slices.Contains` |

For these, **delete the corresponding wiki trick from your codebase**. The helper:

- handles pointer-tail zeroing,
- handles the cap-growth branch correctly,
- has been benchmarked and PGO'd by the Go team,
- is what reviewers expect.

Operations the stdlib still doesn't have (as of Go 1.23): swap-and-pop, rotate, filter, shuffle on a slice directly (use `rand/v2.Shuffle`). For those, the patterns in [middle.md](middle.md) §8–9 remain.

Code-review rule for a Go 1.21+ project: any `append(s[:i], ...)` or `append(s[:i+1], s[i:]...)` in a PR should be flagged and replaced with the `slices.*` call. The reviewer can't always tell at a glance whether the trick was written with the pointer-leak fix or not; the helper makes the question moot.

---

## 3. The slice-queue problem and the ring buffer fix

A slice used as a FIFO queue is a textbook trap.

```go
type Queue[T any] struct {
    data []T
}

func (q *Queue[T]) Push(x T)  { q.data = append(q.data, x) }
func (q *Queue[T]) Pop() T    {
    x := q.data[0]
    q.data = q.data[1:]
    return x
}
```

Two problems on a long run:

1. **Backing-array growth.** `q.data` after many push/pop cycles is rooted at some `Data + n*size`. `append` looks at `cap(q.data) = original_cap - n` and grows when `n` approaches that. After enough growth cycles, the queue holds way more bytes than it logically has elements.
2. **Pointer leak.** For `Queue[*Job]`, every popped slot in `[0..n)` is still GC-reachable through the backing array's `Data` pointer. The leak grows linearly with operations.

A common partial fix is to re-`copy` the slice down periodically:

```go
func (q *Queue[T]) Pop() T {
    x := q.data[0]
    q.data = q.data[1:]
    if len(q.data) > 0 && cap(q.data) > 4*len(q.data) {
        nd := make([]T, len(q.data))
        copy(nd, q.data)
        q.data = nd
    }
    return x
}
```

That stops unbounded growth but introduces periodic O(n) copies. For a real high-throughput queue, the right answer is a **ring buffer** (circular buffer):

```go
type Ring[T any] struct {
    buf      []T
    head, tail int   // tail is next write; head is next read
    n        int    // current length
}

func NewRing[T any](cap int) *Ring[T] {
    if cap < 1 {
        cap = 1
    }
    return &Ring[T]{buf: make([]T, cap)}
}

func (r *Ring[T]) Len() int { return r.n }
func (r *Ring[T]) Cap() int { return len(r.buf) }

func (r *Ring[T]) Push(x T) {
    if r.n == len(r.buf) {
        r.grow()
    }
    r.buf[r.tail] = x
    r.tail = (r.tail + 1) % len(r.buf)
    r.n++
}

func (r *Ring[T]) Pop() (T, bool) {
    var zero T
    if r.n == 0 {
        return zero, false
    }
    x := r.buf[r.head]
    r.buf[r.head] = zero  // release GC root
    r.head = (r.head + 1) % len(r.buf)
    r.n--
    return x, true
}

func (r *Ring[T]) grow() {
    nb := make([]T, len(r.buf)*2)
    if r.head < r.tail {
        copy(nb, r.buf[r.head:r.tail])
    } else {
        n := copy(nb, r.buf[r.head:])
        copy(nb[n:], r.buf[:r.tail])
    }
    r.buf = nb
    r.head = 0
    r.tail = r.n
}
```

Properties:

- Push and pop are O(1) amortized.
- Backing storage is O(max queue depth), not O(operations).
- Every popped slot is zeroed; no pointer leak.
- Grows by doubling; never shrinks (a useful default; shrinking heuristics rarely pay off).

This is the standard structure for in-memory queues, event buffers, and producer-consumer channels with bounded backpressure. The standard library does not include one (the `container/list` doubly-linked list is the official "queue" but has terrible cache behavior and per-node allocation).

For lock-free, multi-producer/single-consumer rings, see https://github.com/smallnest/ringbuffer or https://github.com/Workiva/go-datastructures.

---

## 4. `container/list` vs slice queue vs ring buffer

| | `container/list` | slice as queue | Ring buffer |
|-|------------------|----------------|-------------|
| Push | O(1) | amortized O(1) | amortized O(1) |
| Pop | O(1) | O(1) (with leak) | O(1) |
| Memory per element | header (~40B) + element | element | element |
| Cache locality | terrible (random pointers) | good | excellent |
| GC roots | one per node | one per backing array | one per backing array |
| Concurrent-safe | no | no | no (need wrapper) |
| When to use | rarely; only when arbitrary mid-list ops matter | small, short-lived | high-throughput long-lived |

**`container/list` is essentially never the right answer** for a FIFO. Each node is a separate heap allocation with a 40-byte header. For `Queue[int]` of 1M elements, `container/list` uses 48 MiB of pointers and headers; a ring buffer uses 8 MiB. The wiki recommends `container/list` only for educational and historical reasons; production Go uses ring buffers.

---

## 5. Hot-path allocation profiling

A slice trick that costs an extra allocation in a 1M-QPS handler costs you GC time. Workflow:

```bash
go test -run=^$ -bench=BenchmarkHandle -benchmem -memprofile=mem.out -count=10
go tool pprof -alloc_space mem.out
(pprof) top10
(pprof) list HandleRequest
```

The `-benchmem` flag forces `B/op` and `allocs/op` to be reported. A typical "every slice trick is wrong" report:

```
BenchmarkHandle-8     200000      8230 ns/op    7184 B/op     47 allocs/op
```

47 allocations per request is your enemy. Read `pprof`'s `list` output to find which lines allocate:

```
ROUTINE ======================== handler.HandleRequest in handler.go
         .          .   42:   ids := []int{}
         .       1.2MB   43:   for _, e := range events {
         .       1.2MB   44:       ids = append(ids, e.ID)
         .          .   45:   }
```

The `append`-in-a-loop is the offender. Fix:

```go
ids := make([]int, 0, len(events))
for _, e := range events {
    ids = append(ids, e.ID)
}
```

After: 1 allocation instead of `log_2(len(events))` allocations. Real production code rarely has 47 allocations from slice tricks alone; the more typical profile is 3–5 needless slice allocs that disappear with preallocation.

For more depth see the [`../01-capacity-and-growth/optimize.md`](../01-capacity-and-growth/) section on `runtime.MemStats` and the `runtime/metrics` package.

---

## 6. The "return a copy or share" decision

A function returns a slice. Does it return a view into internal storage or a fresh allocation?

```go
// Option A: share
func (s *Store) Items() []Item { return s.items }

// Option B: scoped clone — share the storage but cap limits caller's append
func (s *Store) Items() []Item { return s.items[:len(s.items):len(s.items)] }

// Option C: clone — full isolation, allocation
func (s *Store) Items() []Item { return slices.Clone(s.items) }
```

Trade-offs:

| | A (share) | B (scoped) | C (clone) |
|-|-----------|-----------|-----------|
| Allocation | 0 | 0 | 1 |
| Caller can mutate elements | yes | yes | no |
| Caller's `append` mutates store | yes | no | no |
| Race safety | depends on locks | depends on locks | safe to release lock immediately |
| Use case | internal helper | public read API | public API + thread-safety |

In a library exposed to external code, **always clone** unless documented otherwise. In an internal hot path between known cooperating modules, share or scope-clone.

A common middle path: return a `func(yield func(Item) bool)` iterator. The caller can't ever see the underlying slice, and you've decoupled storage from the API entirely. This is Go 1.23+ idiom for read-only collection access:

```go
func (s *Store) All() iter.Seq[Item] {
    return func(yield func(Item) bool) {
        for _, it := range s.items {
            if !yield(it) {
                return
            }
        }
    }
}
```

The iterator allocates one closure (could be the zero-alloc inlined form depending on compiler). Caller iterates with `for it := range s.All()`. Zero exposure to backing storage.

---

## 7. `sync.Pool` for transient slices

When you allocate a temporary slice per request and discard it, `sync.Pool` is a 30-50% allocation savings in the hot path:

```go
var bufPool = sync.Pool{
    New: func() any {
        b := make([]byte, 0, 4096)
        return &b
    },
}

func handle(req *Request) Response {
    bp := bufPool.Get().(*[]byte)
    defer func() {
        *bp = (*bp)[:0]   // reset len, keep cap
        bufPool.Put(bp)
    }()
    *bp = append(*bp, encode(req.Data)...)
    return decode(*bp)
}
```

Three subtleties:

1. **Pool stores pointers to slices**, not slices. Why: `sync.Pool` is generic across types and slices are values; storing `*[]byte` ensures `Put` and `Get` see the same underlying header (and the same updated cap after a grow).
2. **Reset `len` to 0 before returning**. The cap is what you're reusing.
3. **Don't pool slices that grow unboundedly.** A "request body buffer" that occasionally sees 10 MiB payloads keeps those 10 MiB allocations alive forever. Cap the pool by checking length before `Put`:

```go
if cap(*bp) > 64*1024 {
    return   // drop oversized; let GC reclaim
}
bufPool.Put(bp)
```

`sync.Pool` is also probabilistic: the runtime drops items at every GC cycle. Don't rely on it for correctness, only for reduced allocation pressure.

Where pooling pays off: per-request scratch buffers, JSON encode buffers, hash state, large temp slices. Where it doesn't: small one-shot allocations, slices kept past one operation, anything escape-analysis already keeps on the stack.

---

## 8. Tracking down "where is this allocation coming from?"

Sometimes `pprof` says you allocate 1 GB/s but `list` doesn't point to anything obvious. Two more tools:

**`-gcflags="-m=2"`** shows escape analysis decisions:

```bash
go build -gcflags="-m=2" ./cmd/svc 2>&1 | grep escape | head -20
```

Output like:

```
handler.go:42:13: ids escapes to heap:
handler.go:42:13:   flow: ids = make([]int, 0, len(events))
handler.go:42:13:     from append(ids, e.ID) at handler.go:44:18
handler.go:42:13:     from return ids at handler.go:47:9
```

`ids` escapes because it's returned. If you can refactor to "write into a caller-provided slice" you can keep it on the stack:

```go
// Caller passes the slice
func fillIDs(events []Event, out []int) []int {
    for _, e := range events {
        out = append(out, e.ID)
    }
    return out
}
```

If the caller's `out` is stack-allocated (large enough, doesn't escape), `out` stays on the stack and `append` doesn't allocate up to that cap.

**`runtime.MemStats.Mallocs`** before and after a block:

```go
var ms runtime.MemStats
runtime.GC()
runtime.ReadMemStats(&ms)
mallocsBefore := ms.Mallocs

doWork()

runtime.GC()
runtime.ReadMemStats(&ms)
fmt.Println("mallocs:", ms.Mallocs - mallocsBefore)
```

Coarse but exact. Useful when `pprof` sampling misses small allocations.

---

## 9. Batching deletes

Deleting one element at a time from a large slice is O(n) per delete. Deleting `m` elements one-by-one is O(n·m). Always batch:

```go
// SLOW: O(n*m)
for _, id := range toDelete {
    idx := slices.IndexFunc(s, func(x T) bool { return x.ID == id })
    if idx >= 0 {
        s = slices.Delete(s, idx, idx+1)
    }
}

// FAST: one pass, O(n + m)
toDel := make(map[int]struct{}, len(toDelete))
for _, id := range toDelete {
    toDel[id] = struct{}{}
}
n := 0
for _, x := range s {
    if _, drop := toDel[x.ID]; drop {
        continue
    }
    s[n] = x
    n++
}
clear(s[n:])
s = s[:n]
```

For `[]*T` with frequent batch-delete patterns, the canonical Go idiom is "rewrite the slice in place with a single pass and a set". `slices.DeleteFunc` (Go 1.21+) does exactly this:

```go
s = slices.DeleteFunc(s, func(x T) bool {
    _, drop := toDel[x.ID]
    return drop
})
```

`slices.DeleteFunc` zeroes the tail for pointer-element types in Go 1.22+.

The cost difference for `n = 10000`, `m = 100`:

| Strategy | Operations |
|----------|------------|
| One-by-one `slices.Delete` | ~1 000 000 shifts |
| `slices.DeleteFunc` with set | ~10 000 reads + ~9900 writes |

Two orders of magnitude. Always batch.

---

## 10. Prealloc patterns

The most universal performance trick across all of Go is preallocating slices when the size is known or estimable.

```go
// Worst: cap=0, ~log2(n) reallocs
ids := []int{}
for _, e := range events { ids = append(ids, e.ID) }

// Better: cap=len(events), 0 reallocs after `make`
ids := make([]int, 0, len(events))
for _, e := range events { ids = append(ids, e.ID) }

// Best (when applicable): direct index, 0 reallocs and no `len` updates
ids := make([]int, len(events))
for i, e := range events { ids[i] = e.ID }
```

For dynamic size, estimate the upper bound or use `slices.Grow`:

```go
ids := []int{}
ids = slices.Grow(ids, estimatedMax)   // bumps cap; len unchanged
for _, e := range events {
    ids = append(ids, e.ID)
}
```

`slices.Grow(s, n)` ensures `cap(s) >= len(s) + n`, allocating once if needed. Idempotent if cap is already sufficient.

Heuristics for picking the prealloc size:

- **Filter a slice**: cap = `len(input)`. The filter shrinks; never grows.
- **Map a slice 1:1**: cap = `len(input)`. Direct-index form often clearer.
- **Aggregate from N→M (M < N)**: cap = `len(input) / averageFactor`. Round up; overestimating wastes some memory, underestimating costs reallocs.
- **Streaming with no length signal**: leave default cap; let `append` grow.

---

## 11. The "single append in a loop" anti-pattern

```go
// SUS
result := []Foo{}
for {
    f, ok := source.Next()
    if !ok { break }
    result = append(result, f)
}
```

Three problems if `source.Next` runs millions of times:

1. Backing array grows via doubling; log₂N reallocations.
2. Each `append` checks cap, may call `growslice`, may copy.
3. If `result` escapes, every reallocation produces another heap garbage object.

Fixes ranked by leverage:

1. **Know the size.** If `source` has `Len()`, `make([]Foo, 0, source.Len())`.
2. **Slab append.** Append to a fixed-size buffer; flush downstream when full:

   ```go
   buf := make([]Foo, 0, 4096)
   for {
       f, ok := source.Next()
       if !ok { break }
       buf = append(buf, f)
       if len(buf) == cap(buf) {
           sink(buf)
           buf = buf[:0]   // reuse cap
       }
   }
   if len(buf) > 0 {
       sink(buf)
   }
   ```

3. **Iterator instead of slice.** Don't produce a slice at all; stream to the consumer.

---

## 12. Slice mutation under iteration

Iterating with `for i, x := range s` and mutating `s` during the iteration is a footgun:

```go
for i, x := range s {
    if shouldDelete(x) {
        s = slices.Delete(s, i, i+1)   // BUG
    }
}
```

`range s` captured `len(s)` at the start. After Delete, `i` overshoots and `x` is stale. The loop iterates past the new end and panics, or silently skips elements.

Patterns that work:

```go
// 1. iterate backwards
for i := len(s) - 1; i >= 0; i-- {
    if shouldDelete(s[i]) {
        s = slices.Delete(s, i, i+1)
    }
}

// 2. filter in place
s = slices.DeleteFunc(s, shouldDelete)

// 3. collect indices first, delete batched
var del []int
for i, x := range s {
    if shouldDelete(x) {
        del = append(del, i)
    }
}
// process del in reverse to avoid shifting
for k := len(del) - 1; k >= 0; k-- {
    s = slices.Delete(s, del[k], del[k]+1)
}
```

Pattern (2) is shortest, allocates nothing extra, and is what `slices.DeleteFunc` was designed for. Prefer it.

---

## 13. The conventions for a large codebase

Apply uniformly across the project:

1. **Default to `slices.*` over wiki tricks.** No exceptions in new code.
2. **Always preallocate when len is known.** `make([]T, 0, n)` is mandatory in loops where `n` is computable.
3. **Use `clear(s[n:])` before shrinking pointer-element slices.** Even if `slices.*` does it, hand-rolled loops must.
4. **Return cloned or scoped-clone slices from public APIs.** Document if a returned slice shares storage.
5. **Use ring buffers for FIFO at scale.** Never use a `[]T` as a long-running queue.
6. **Pool with `sync.Pool` only after profiling shows the allocation is hot.** Premature pooling adds complexity without measurable benefit.
7. **Never mutate `s` while iterating with `range s`.** Use `slices.DeleteFunc`, backwards iteration, or a deferred-deletion pass.
8. **Code-review for `append(s, x)` in a loop without preallocation.** It's not always wrong, but it's worth questioning every time.

These are project-level lint rules; some can be encoded in `golangci-lint` plugins (`prealloc`, `wastedassign`, etc.) but most are review-driven.

---

## 14. Composition: a production-grade "active set"

A worked example combining many tricks: an "active set" of pointer-typed items with frequent add, remove, and snapshot-for-iteration.

```go
type ActiveSet[T any] struct {
    mu    sync.RWMutex
    items []T
    index map[string]int   // ID -> index in items
    keyOf func(T) string
}

func New[T any](keyOf func(T) string) *ActiveSet[T] {
    return &ActiveSet[T]{
        items: make([]T, 0, 64),
        index: make(map[string]int, 64),
        keyOf: keyOf,
    }
}

func (s *ActiveSet[T]) Add(x T) {
    s.mu.Lock()
    defer s.mu.Unlock()
    key := s.keyOf(x)
    if i, ok := s.index[key]; ok {
        s.items[i] = x   // replace
        return
    }
    s.index[key] = len(s.items)
    s.items = append(s.items, x)
}

func (s *ActiveSet[T]) Remove(key string) bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    i, ok := s.index[key]
    if !ok {
        return false
    }
    last := len(s.items) - 1
    if i != last {
        // swap-and-pop, update the moved item's index
        s.items[i] = s.items[last]
        s.index[s.keyOf(s.items[i])] = i
    }
    var zero T
    s.items[last] = zero
    s.items = s.items[:last]
    delete(s.index, key)
    return true
}

func (s *ActiveSet[T]) Snapshot() []T {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return slices.Clone(s.items)
}
```

Design choices and the tricks used:

- **Swap-and-pop delete** in `Remove` — O(1), no shift.
- **Manual zero of the popped slot** for GC safety on pointer-element types.
- **Index map** to find the slot — O(1) lookup; without it, Remove would be O(n).
- **`slices.Clone`** for snapshot — caller gets isolated storage.
- **`append` for Add** — amortized O(1); preallocated to 64 to avoid early reallocs.

This is the kind of mini data structure a real codebase has dozens of. Each one is mostly slice tricks held together by a lock and an index.

---

## 15. When slices stop being the right answer

A few signals that you've outgrown `[]T`:

| Symptom | Probably want |
|---------|---------------|
| FIFO with millions of ops/day | Ring buffer |
| Frequent random insert/delete in middle | `container/list` or skip list or B-tree |
| Many concurrent writers | `sync.Map` or a sharded slice with per-shard locks |
| Need to find by key, not index | `map[K]V`, possibly with an ordered index |
| Sorted with frequent inserts | B-tree (`github.com/google/btree`) |
| Append-only event log with reads by ID | sharded slice + per-shard index, or a real log structure |

The slice is the best general-purpose collection, but it's not infinite. Knowing when to reach for a tree or a hash is a senior-level call.

---

## 16. Summary

Production slice work in Go is mostly: prefer `slices.*` over wiki tricks, preallocate when size is knowable, zero pointer-element tails (or trust the Go 1.22+ stdlib to), and pick a ring buffer over a slice-queue for long-running FIFOs. The hot-path workflow is benchmark-with-`-benchmem`, profile-with-`pprof`, identify the unintended allocation, fix with preallocation or `sync.Pool`. Public APIs should return cloned or scoped-clone slices to prevent caller `append` from stomping internal storage. The wiki tricks remain in our muscle memory because old code uses them and because swap-and-pop / rotate still lack stdlib helpers; everything else should be the helper. Beyond a few thousand operations per second on slice-based data structures, design discipline (preallocation, batching, pooling, ring buffers) matters more than micro-optimizing any individual trick.

---

## Further reading
- `slices` package: https://pkg.go.dev/slices
- `runtime/metrics`: https://pkg.go.dev/runtime/metrics
- `sync.Pool` docs: https://pkg.go.dev/sync#Pool
- `pprof` user guide: https://github.com/google/pprof/blob/main/doc/README.md
- ring buffers (community): https://github.com/smallnest/ringbuffer
- Sibling — capacity and growth: [../01-capacity-and-growth/](../01-capacity-and-growth/)
- Sibling — slice header internals: [../05-slice-header-internals/](../05-slice-header-internals/)
