# Heap Sort — Specification

> **Purpose:** a precise, language-agnostic reference for the Heap Sort algorithm and the binary heap data structure. Use this as the contract when reviewing implementations, writing test suites, or porting between languages.

---

## Table of Contents

1. [Algorithm Reference](#algorithm-reference)
2. [API Contract](#api-contract)
3. [Core Rules](#core-rules)
4. [Language-Specific Functions](#language-specific-functions)
5. [Edge Cases](#edge-cases)
6. [Compliance Checklist](#compliance-checklist)

---

## Algorithm Reference

### Algorithm 1 — `HeapSort(A, n)`

**Input:** array `A[0..n-1]` of `n` totally-ordered elements.
**Output:** `A` permuted so that `A[0] ≤ A[1] ≤ ... ≤ A[n-1]`.
**Side effects:** modifies `A` in place; multiset of values is preserved.
**Complexity:** time `Θ(n log n)`; auxiliary space `Θ(1)`.
**Stability:** NOT stable.

```text
HeapSort(A, n):
    BuildMaxHeap(A, n)
    for end := n - 1 down to 1:
        Swap(A, 0, end)
        SiftDown(A, 0, end)
```

### Algorithm 2 — `BuildMaxHeap(A, n)` (Floyd's bottom-up)

**Input:** array `A[0..n-1]`.
**Output:** `A` is a max-heap (Definition 2 in `professional.md`).
**Complexity:** time `Θ(n)`; space `Θ(1)`.

```text
BuildMaxHeap(A, n):
    for i := n/2 - 1 down to 0:
        SiftDown(A, i, n)
```

### Algorithm 3 — `SiftDown(A, i, n)`

**Input:** array `A`, root index `i`, effective heap size `n`. Precondition: subtrees of `i` are max-heaps.
**Output:** subtree of `i` (within `A[0..n-1]`) is a max-heap.
**Complexity:** time `O(log(n/i))` — at most the height from `i` to the deepest leaf; space `Θ(1)`.

```text
SiftDown(A, i, n):
    while 2i + 1 < n:
        L := 2i + 1
        R := 2i + 2
        largest := i
        if L < n and A[L] > A[largest]: largest := L
        if R < n and A[R] > A[largest]: largest := R
        if largest = i: return
        Swap(A, i, largest)
        i := largest
```

### Algorithm 4 — `SiftUp(A, i)` (for inserts)

**Input:** array `A`, child index `i`. Precondition: `A[0..i-1]` is a max-heap and only `A[i]` may violate the heap property.
**Output:** `A[0..i]` is a max-heap.
**Complexity:** `O(log i)` time, `Θ(1)` space.

```text
SiftUp(A, i):
    while i > 0:
        p := (i - 1) / 2
        if A[p] >= A[i]: return
        Swap(A, p, i)
        i := p
```

---

## API Contract

### Sort interface

```text
sort(A: array of T, less: (T, T) -> bool) -> void
```

Sorts `A` in place using the comparator `less`. Default `less` is `<` for built-in numeric types.

**Preconditions:**
- `A` is a writable array (or list / slice).
- `less` defines a **strict weak order**: irreflexive, asymmetric, transitive, and `not less(a,b) and not less(b,a)` is transitive (equivalence).
- All elements are mutually comparable via `less`.

**Postconditions:**
- For all `i ∈ {0, ..., n-2}`: `not less(A[i+1], A[i])`.
- The multiset of values in `A` is unchanged.

**Does NOT guarantee:**
- Stability — equal-by-`less` keys may be reordered.
- Idempotence on partially sorted input — same time complexity regardless.

### Priority queue interface

```text
pq.push(x: T) -> void           // O(log n)
pq.pop() -> T                   // O(log n), returns min (or max)
pq.peek() -> T                  // O(1), returns min (or max) without removing
pq.size() -> int                // O(1)
pq.empty() -> bool              // O(1)
pq.heapify(A: array of T) -> pq // O(n) bulk init
```

**Preconditions for push/pop/peek:**
- `pop()` and `peek()` require `size() > 0`; behavior on empty is implementation-defined (exception, undefined, or sentinel).

**Postconditions:**
- After `pop()`, `size()` decreases by 1; the returned value is the minimum of the previous heap.
- After `push(x)`, `size()` increases by 1; the new minimum is `min(old_min, x)`.

---

## Core Rules

### Rule 1 — Binary Heap Shape

The heap is a **complete binary tree**: all levels except possibly the last are filled; the last level is filled left-to-right. Equivalently: stored in `A[0..n-1]` with no gaps.

### Rule 2 — Parent-Child Relationship (zero-indexed)

```
parent(i) = (i - 1) / 2          (integer division)
left(i)   = 2i + 1
right(i)  = 2i + 2
```

For one-indexed arrays (e.g., textbook CLRS):

```
parent(i) = i / 2
left(i)   = 2i
right(i)  = 2i + 1
```

**Consistency rule:** within one codebase, pick zero-indexed or one-indexed and use it everywhere. Mixing causes off-by-one bugs.

### Rule 3 — Max-Heap Invariant

For all `i ∈ {1, ..., n-1}`: `A[parent(i)] >= A[i]`.

### Rule 4 — Min-Heap Invariant

For all `i ∈ {1, ..., n-1}`: `A[parent(i)] <= A[i]`.

### Rule 5 — `siftDown` vs `siftUp`

| When | Use | Reason |
|------|-----|--------|
| Element at `i` may be **smaller** than its children (max-heap) | `siftDown` | Push down toward leaves |
| Element at `i` may be **larger** than its parent (max-heap) | `siftUp` | Push up toward root |
| Build-heap (bulk) | `siftDown` from `n/2 - 1` to `0` | `O(n)` total |
| Insert (one item) | append to end + `siftUp` | `O(log n)` |
| Extract-root | swap root with last + shrink + `siftDown` from `0` | `O(log n)` |
| Replace-root (`heapreplace`) | overwrite root + `siftDown` from `0` | `O(log n)`, one pass |

### Rule 6 — Sift Down Picks the Larger Child

For max-heap:

```
largest := i
if L exists and A[L] > A[largest]: largest := L
if R exists and A[R] > A[largest]: largest := R
```

The order of the two `if`s matters when `A[L] = A[R]` and you care about determinism: swapping with `R` over `L` (or vice versa) gives different output for non-stable sorts. Document the chosen order.

### Rule 7 — Heap Sort Direction

| Goal | Heap to use |
|------|-------------|
| Sort ascending in place | **Max-heap** |
| Sort descending in place | **Min-heap** |
| Sort ascending out-of-place | Min-heap, repeatedly pop into output array |

Counterintuitive: ascending uses a **max-heap** because each extracted max goes to the rightmost free slot.

### Rule 8 — Stability

Heap Sort is **not stable**. Equal keys may be reordered during sift-down. To make it stable, augment the comparator with original index:

```
less_stable(A, i, j): return (A[i].key, i) < (A[j].key, j)
```

This adds `O(n)` extra space (for the indices) — defeating Heap Sort's main advantage.

---

## Language-Specific Functions

### Python — `heapq` (min-heap)

| Function | Complexity | Notes |
|----------|-----------|-------|
| `heapq.heapify(list)` | `O(n)` | In place, Floyd's algorithm. |
| `heapq.heappush(h, x)` | `O(log n)` | Sift up. |
| `heapq.heappop(h)` | `O(log n)` | Sift down. |
| `heapq.heappushpop(h, x)` | `O(log n)` | Push then pop, single sift; if `x ≤ h[0]` returns `x` unchanged. |
| `heapq.heapreplace(h, x)` | `O(log n)` | Pop then push, single sift. Always mutates. |
| `heapq.nlargest(k, it, key=)` | `O(n log k)` | Min-heap of size k internally. |
| `heapq.nsmallest(k, it, key=)` | `O(n log k)` | Max-heap of size k internally. |
| `heapq.merge(*iters)` | `O(N log k)` | Lazy merge of `k` sorted iterables, returns iterator. |

**Max-heap idiom:** push `(-priority, value)` or wrap with reverse comparator class.

**No built-in heapsort:** `heapq.heappop` extraction yields sorted; for sort use `sorted()` (Tim Sort). Hand `heap_sort(arr)` if you really want it.

### Java — `java.util.PriorityQueue` (min-heap)

| Method | Complexity | Notes |
|--------|-----------|-------|
| `new PriorityQueue<>()` | O(1) | Empty min-heap by natural ordering. |
| `new PriorityQueue<>(Comparator)` | O(1) | Custom comparator. |
| `new PriorityQueue<>(Collection)` | `O(n)` | Bulk init (uses Floyd internally). |
| `add(E e)` / `offer(E e)` | `O(log n)` | Sift up. |
| `poll()` | `O(log n)` | Returns and removes min, or `null` if empty. |
| `peek()` | `O(1)` | Returns min or `null`. |
| `remove(Object o)` | `O(n)` | Linear search + sift. |
| `iterator()` | unsorted order | Iteration order is array (heap) order, NOT sorted. |

**Max-heap:** `new PriorityQueue<>(Comparator.reverseOrder())`.

**Sort:** `Arrays.sort` and `Collections.sort` use Tim Sort, NOT Heap Sort. There is no `java.util.HeapSort`.

### Go — `container/heap` (interface-driven)

The package provides operations on any type implementing `heap.Interface`:

```go
type Interface interface {
    sort.Interface           // Len, Less, Swap
    Push(x any)              // append to end
    Pop() any                // remove last
}
```

| Function | Complexity | Notes |
|----------|-----------|-------|
| `heap.Init(h)` | `O(n)` | Floyd's bulk build. |
| `heap.Push(h, x)` | `O(log n)` | Calls user `Push` then sift up. |
| `heap.Pop(h)` | `O(log n)` | Swaps root to end, calls user `Pop`. |
| `heap.Remove(h, i)` | `O(log n)` | Remove element at index `i`. |
| `heap.Fix(h, i)` | `O(log n)` | Re-heapify after a priority change. |

**Min-heap or max-heap:** decided by the user's `Less` method.

**Sort:** `sort.Slice`, `slices.Sort` use pdqsort (since Go 1.19), NOT Heap Sort.

### C++ — `<algorithm>` and `<queue>`

| Function | Complexity | Notes |
|----------|-----------|-------|
| `std::make_heap(first, last)` | `O(n)` | In-place Floyd's. Default = max-heap. |
| `std::push_heap(first, last)` | `O(log n)` | Sift up the last element. |
| `std::pop_heap(first, last)` | `O(log n)` | Move max to `last - 1`, restore heap on `[first, last - 1)`. |
| `std::sort_heap(first, last)` | `O(n log n)` | Heap Sort proper — repeat `pop_heap`. |
| `std::is_heap(first, last)` | `O(n)` | Check invariant. |
| `std::priority_queue<T>` | wraps above | Default = max-heap. |

**Min-heap:** `std::priority_queue<T, std::vector<T>, std::greater<T>>` or `std::make_heap` with `std::greater<>{}`.

**`std::sort` is Introsort** (Quick + Heap fallback + insertion). `std::stable_sort` is merge sort.

### Rust — `std::collections::BinaryHeap` (max-heap)

| Method | Complexity |
|--------|-----------|
| `BinaryHeap::new()` | O(1) |
| `BinaryHeap::from(vec)` | `O(n)` |
| `push(item)` | amortized `O(log n)` |
| `pop()` | `O(log n)` returning `Option<T>` |
| `peek()` | `O(1)` returning `Option<&T>` |

**Min-heap:** wrap items in `std::cmp::Reverse(item)`.

**`sort_unstable`** uses pdqsort with Heap Sort fallback.

### JavaScript / TypeScript — no built-in heap

The standard library has no priority queue. Common third-party: `mnemonist/heap`, `js-priority-queue`, `@datastructures-js/priority-queue`.

`Array.prototype.sort` is implementation-defined; modern V8 (Node 11+) uses Tim Sort (stable).

---

## Edge Cases

### Empty input

`HeapSort([])` returns immediately. `n/2 - 1 = -1`, loops do not execute. **No exception.**

### Single element

`HeapSort([42])` returns immediately; `end = 0`, extract loop does not execute.

### Two elements

`HeapSort([2, 1])`: build-heap leaves `[2, 1]` (already a max-heap). Extract: swap → `[1, 2]`. ✓

### All equal

`HeapSort([5, 5, 5, 5])`: builds OK; extracts shuffle equal elements. Final array `[5, 5, 5, 5]` correct, but **original order may be lost** (not stable).

### Already sorted ascending

Still `Θ(n log n)`. Build-heap is `O(n)` (no benefit from sortedness because `[1,2,3,4]` is NOT a max-heap). Extract is `Θ(n log n)`.

### Already sorted descending

Build-heap is `O(n)` and finds the array is already a max-heap (no swaps needed). Extract is `Θ(n log n)`.

### Duplicates

Handled correctly. Use `>=` (not `>`) in the early-exit check to avoid one wasted swap when parent equals larger child.

### NaN (floating point)

NaN breaks total order: `NaN < x`, `NaN > x`, `NaN == x` are all false. Heap invariant cannot hold. **Result is non-deterministic.** Filter NaN before sorting, or use a comparator that puts NaN at one end (Java's `Double.compare` does this: NaN is "greater than" any other value).

### `null` / `nil` / `None`

Most heap implementations don't allow `null` because the comparator throws `NullPointerException`. Java's `PriorityQueue` rejects `null` in `add()`. Document and enforce the rule.

### `Integer.MIN_VALUE` and overflow

For min-heap with sentinel value tricks (e.g., Dijkstra placing `INF`), use `Long.MAX_VALUE` or `Double.POSITIVE_INFINITY` to avoid overflow on arithmetic.

### Heap larger than memory

If `n > available RAM`, do not use in-memory heap. Use external-memory priority queue (k-way merge over sorted runs).

### Mutating items inside the heap

If you change the priority of an item already in the heap (without using `decrease-key` on an indexed heap), the invariant breaks silently. Workarounds:
1. Push a fresh entry; lazy-skip stale ones on pop.
2. Use an indexed heap with `decrease-key` / `Fix(i)`.

### Concurrent modification

Heaps are NOT thread-safe by default. Wrap with mutex (Java's `PriorityBlockingQueue`) or use lock-free / skip-list-based structures for high concurrency.

---

## Compliance Checklist

Use this when reviewing or porting an implementation.

### Correctness

- [ ] `siftDown` chooses the **larger** child (max-heap) before deciding to swap.
- [ ] `siftDown` checks `right < n` separately from `left < n` (single-child case).
- [ ] Build-heap loop starts at `n / 2 - 1` (zero-indexed), not `n / 2`.
- [ ] Build-heap loop runs **down to and including** index `0`.
- [ ] Extract loop swaps root with the **last** unsorted index, then shrinks the heap.
- [ ] Extract loop's `siftDown` uses the new (decremented) heap size, not original `n`.
- [ ] Empty array handled (no exception, no infinite loop).
- [ ] Single-element array handled.

### Index arithmetic

- [ ] `parent(i) = (i - 1) / 2` (zero-indexed). NEVER `i / 2`.
- [ ] `left(i) = 2 * i + 1`. NEVER `2 * i`.
- [ ] `right(i) = 2 * i + 2`. NEVER `2 * i + 1`.
- [ ] Index arithmetic uses **integer division**, not float division.

### Performance

- [ ] Build-heap is `O(n)`, not implemented as `n` repeated inserts.
- [ ] `siftDown` is iterative, not deeply recursive (avoids stack overflow for large `n`).
- [ ] Inner loop avoids redundant array reads (cache the value being sifted).
- [ ] `>=` (not `>`) in the early-exit check.

### API

- [ ] Min-heap vs max-heap clearly documented.
- [ ] Comparator interface specified (custom comparator support).
- [ ] Exception behavior on empty `pop` / `peek` documented.
- [ ] Bulk-init from existing collection is `O(n)`, not `O(n log n)`.

### Tests

- [ ] Empty array.
- [ ] Single element.
- [ ] Two elements (sorted, reverse).
- [ ] Already sorted ascending.
- [ ] Already sorted descending.
- [ ] All equal.
- [ ] Random small (n=10..100).
- [ ] Random large (n=10⁶+).
- [ ] Duplicates with custom comparator.
- [ ] Negative numbers.
- [ ] NaN handling (or documented refusal).
- [ ] Heap invariant after every operation (`is_heap` check in tests).
- [ ] Sorted output (no duplicates lost, no extras added).
- [ ] Heap Sort matches `Arrays.sort` output for the same input (parity test).

### Documentation

- [ ] Time complexity (best, avg, worst).
- [ ] Space complexity.
- [ ] Stability called out as `false`.
- [ ] Mutation behavior (in-place vs returning new array).
- [ ] Tie-breaking convention for equal keys.
- [ ] Whether `null` / `NaN` is supported.

---

> **Done.** A passing implementation should satisfy every box. Use the next file (`interview.md`) for graded questions and coding challenges.
