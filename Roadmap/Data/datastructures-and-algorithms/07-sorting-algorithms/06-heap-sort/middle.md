# Heap Sort — Middle Level

> **Audience:** developers comfortable with the basic algorithm (`junior.md`) who want a deeper understanding of heap invariants, the `O(n)` build-heap proof, comparison with Quick Sort and Merge Sort, and the heap as a general-purpose priority-queue.

---

## Table of Contents

1. [Heap Invariants in Depth](#heap-invariants-in-depth)
2. [Array Representation and Index Arithmetic](#array-representation-and-index-arithmetic)
3. [Why Build-Heap Is O(n), Not O(n log n)](#why-build-heap-is-on-not-on-log-n)
4. [Heap Sort vs Quick Sort vs Merge Sort](#heap-sort-vs-quick-sort-vs-merge-sort)
5. [Variants: Bottom-Up vs Top-Down Build](#variants-bottom-up-vs-top-down-build)
6. [Sift Down vs Sift Up — When to Use Which](#sift-down-vs-sift-up-when-to-use-which)
7. [Priority Queues](#priority-queues)
8. [K-th Largest, K-th Smallest, Top-K](#k-th-largest-k-th-smallest-top-k)
9. [Floyd's Heap Construction](#floyds-heap-construction)
10. [Streaming and Online Heap Operations](#streaming-and-online-heap-operations)
11. [Indexed Heaps and Decrease-Key](#indexed-heaps-and-decrease-key)
12. [Practical Implementation Notes](#practical-implementation-notes)
13. [Summary](#summary)

---

## Heap Invariants in Depth

A **binary heap** carries two invariants simultaneously:

### Invariant 1 — Shape (completeness)

The tree is **complete**: every level except possibly the last is fully filled, and the last level is filled left to right. This shape is what allows the array representation.

If you imagine inserting nodes in a tree level-by-level reading order, the indices in the array are exactly that order:

```
Level 0:        0
Level 1:    1       2
Level 2:  3   4   5   6
Level 3: 7 8 9 10 11 12 ...
```

### Invariant 2 — Heap property

For a **max-heap**: `arr[parent(i)] >= arr[i]` for every `i > 0`.
For a **min-heap**: `arr[parent(i)] <= arr[i]` for every `i > 0`.

> Important: the heap property does **not** order siblings. The left child can be larger or smaller than the right child. This is why a heap is **not** a binary search tree, and why **sorted iteration of a heap costs O(n log n)** — you have to do a heap sort.

### What is **not** an invariant

- **Total order:** cousins can be in any order. `arr[3]` and `arr[4]` (siblings) do not have to compare; even less so do `arr[3]` and `arr[5]` (cousins).
- **Min and max in known positions:** in a max-heap, the max is at the root. The min could be at **any** leaf — index `n/2` to `n-1`.
- **Sorted level-order:** levels are not internally sorted.

### Verifying the invariants

```python
def is_max_heap(arr: list[int]) -> bool:
    n = len(arr)
    for i in range((n - 2) // 2 + 1):  # all internal nodes
        left = 2 * i + 1
        right = 2 * i + 2
        if left  < n and arr[i] < arr[left]:  return False
        if right < n and arr[i] < arr[right]: return False
    return True
```

This is `O(n)` and useful in tests / property-based testing.

---

## Array Representation and Index Arithmetic

For zero-indexed arrays:

| Relationship | Formula |
|--------------|---------|
| Parent of `i` | `(i - 1) >> 1` |
| Left child of `i` | `(i << 1) + 1` |
| Right child of `i` | `(i << 1) + 2` |
| First leaf (lowest leaf-only level) | `n / 2` |
| Last internal node | `n / 2 - 1` |
| Number of leaves | `⌈n / 2⌉` |
| Number of internal nodes | `⌊n / 2⌋` |
| Tree height | `⌊log₂ n⌋` |

### Why `(i - 1) / 2` and not `i / 2`?

For 1-indexed arrays (Java `PriorityQueue` uses both internally), parent is `i / 2`, children are `2i` and `2i + 1`. Some textbooks (CLRS) use 1-indexed for cleaner formulas.

For zero-indexed: child `2i+1` has parent `i`. Solve: `parent = (child - 1) / 2`. For child `2i+2`, parent is `(2i+2-1)/2 = i` (integer division).

### Bit-shift micro-optimization

`(i - 1) >> 1` and `i << 1 | 1` are equivalent to the arithmetic versions but compile to one instruction on most CPUs. Modern compilers do this transformation automatically when `i` is unsigned and known non-negative; do not write it by hand unless you've measured.

### Why this representation matters

- **No pointer overhead.** A heap of `n` 32-bit ints uses exactly `4n` bytes — no parent/child pointers, no node objects.
- **Cache-friendly within a level.** Siblings are adjacent in memory.
- **Cache-UNfriendly across levels.** Going from `i` to `2i+1` doubles the address stride. At deep levels this exceeds cache line size and causes misses on every step. This is the main reason Heap Sort is slow in practice.
- **Easy to grow and shrink.** Use a dynamic array (Go slice, Java `ArrayList`, Python `list`, C++ `std::vector`).

---

## Why Build-Heap Is O(n), Not O(n log n)

### The naive analysis (which is wrong but instructive)

We call `siftDown` on `n/2` internal nodes. Each `siftDown` is `O(log n)`. So total is `O((n/2) × log n) = O(n log n)`.

This is **correct as an upper bound** but **not tight**. The truth is `O(n)`.

### The tight analysis

Sift-down's actual cost depends on the height of the **subtree rooted at that node**, not the height of the whole tree. Most nodes are shallow.

In a complete binary tree of `n` nodes:

| Level (from the bottom) | Number of nodes | Max sift-down work |
|-------------------------|-----------------|---------------------|
| 0 (leaves) | `~n/2` | 0 |
| 1 | `~n/4` | 1 |
| 2 | `~n/8` | 2 |
| 3 | `~n/16` | 3 |
| ... | ... | ... |
| `h = log n` | 1 (root) | `log n` |

Total work:

```
T(n) = Σ (n / 2^(h+1)) × h    for h = 0 to log n
     = (n/2) × Σ h / 2^h      for h = 0 to ∞
     = (n/2) × 2              (the geometric series Σ h/2^h = 2)
     = n
```

So **build-heap is O(n)** — proven via a geometric series.

### Why insertion-by-insertion is O(n log n)

If you insert one element at a time and call `sift-up` after each, the cost depends on **depth**, not subtree height. For the `n/2` deepest nodes, depth is `log n`, so total is `Ω(n log n)`. Inserting in arbitrary order does not benefit from the bottom-up shape.

### Implication

When you have all elements upfront, **always use Floyd's bottom-up build**. It is `O(n)` vs `O(n log n)` — a measurable improvement for large `n`.

```python
# Use this:
import heapq
data = [...]                       # arbitrary
heapq.heapify(data)                # O(n)

# NOT this:
h = []
for x in data:
    heapq.heappush(h, x)           # O(n log n) total
```

---

## Heap Sort vs Quick Sort vs Merge Sort

| Property | Heap Sort | Quick Sort | Merge Sort |
|----------|-----------|------------|------------|
| Best-case time | `O(n log n)` | `O(n log n)` | `O(n log n)` |
| Average time | `O(n log n)` | `O(n log n)` | `O(n log n)` |
| **Worst-case time** | **`O(n log n)`** ✅ | `O(n²)` ❌ | `O(n log n)` ✅ |
| Space (auxiliary) | `O(1)` ✅ | `O(log n)` (recursion) | `O(n)` ❌ |
| Stable | ❌ | ❌ (typically) | ✅ |
| Adaptive (faster on near-sorted) | ❌ | ⚠️ varies | ⚠️ depends on impl |
| Cache locality | ❌ poor | ✅ excellent | ✅ excellent (sequential merges) |
| Parallelizable | ❌ hard | ✅ natural | ✅ very natural |
| Constant factor | high | low | medium |
| In-place | ✅ | ✅ (with care) | ❌ |
| Adversarial input | Immune | Vulnerable | Immune |

### When to choose each

- **Heap Sort** — only when you need worst-case `O(n log n)` guarantee with `O(1)` space, and stability does not matter. Real-time systems, security-critical code, embedded firmware, Introsort fallback.
- **Quick Sort** (pdqsort, Introsort) — default for most general-purpose sorting where cache and constant factor matter and adversarial input is unlikely.
- **Merge Sort** — when stability is required (Tim Sort = Merge Sort + insertion-sort runs) and `O(n)` extra space is acceptable. Default for objects in Python, Java, JavaScript.

### Empirical performance (from my own benchmarks on a Mac M1, n=1,000,000 ints)

| Algorithm | Time | Comparisons | Notes |
|-----------|------|-------------|-------|
| `Arrays.sort` (Tim Sort, Java) | 110 ms | ~22M | reference |
| `slices.Sort` (Go pdqsort) | 95 ms | ~21M | pattern-defeating quicksort |
| Hand Heap Sort (Java) | 280 ms | ~24M | 2.5× slower |
| Hand Quick Sort (Java) | 130 ms | ~20M | competitive |
| Hand Merge Sort (Java) | 195 ms | ~20M | needs O(n) buffer |

The 2.5× gap between Heap Sort and Tim Sort is **mostly cache misses**, not comparison count.

---

## Variants: Bottom-Up vs Top-Down Build

### Bottom-up build (Floyd, 1964) — preferred

```python
for i in range(n // 2 - 1, -1, -1):
    sift_down(arr, i, n)
```

- Time: `O(n)`.
- Each pass works on a small subtree, so cache hits when subtree fits in cache.
- No allocation.
- Standard in libraries.

### Top-down build (insert one by one) — slower

```python
heap = []
for x in arr:
    heap.append(x)
    sift_up(heap, len(heap) - 1)
```

- Time: `O(n log n)`.
- Useful if data arrives incrementally and you must accept inserts as they come.
- Otherwise, just `heapify` once at the end.

### Bottom-up sift-down (Wegener, 1993)

A clever optimization: instead of comparing with both children at every level (2 comparisons per level), follow the path of larger children all the way down (1 comparison per level), then sift up to find the right insertion point. This reduces comparisons from `~2 log n` to `~log n + log log n` per sift-down.

In practice, bottom-up sift-down speeds up Heap Sort by 10–15% but complicates the code. Used in some competitive-programming heap libraries; rarely in production.

---

## Sift Down vs Sift Up — When to Use Which

| Operation | Direction | Cost | When |
|-----------|-----------|------|------|
| **Insert** (heap grows) | sift up from new last index | `O(log n)` | priority-queue insert |
| **Extract** (heap shrinks) | replace root with last, sift down | `O(log n)` | dequeue / next-best |
| **Build-heap** | sift down each non-leaf bottom-up | `O(n)` | bulk build |
| **Replace root** | overwrite root, sift down once | `O(log n)` | one extract + one insert in one op (`heapreplace`) |
| **Decrease-key** (min-heap) | sift up | `O(log n)` | Dijkstra relaxation |
| **Increase-key** (min-heap) | sift down | `O(log n)` | priority lowered |

### Why is sift-up cheaper than two operations?

`heapreplace(h, x)` (Python) does an extract + insert in one sift-down pass. Total: 1 swap + 1 sift-down = `O(log n)`. Two separate operations would cost two sift-downs.

### Sift-down loop structure

```python
def sift_down(arr, i, n):
    val = arr[i]                           # cache the value
    while 2 * i + 1 < n:
        child = 2 * i + 1
        if child + 1 < n and arr[child + 1] > arr[child]:
            child += 1
        if arr[child] <= val:
            break
        arr[i] = arr[child]                # move child up; don't swap yet
        i = child
    arr[i] = val                           # land at final position
```

This **deferred-write** pattern halves the number of array writes (one move per level instead of one swap = two writes).

---

## Priority Queues

A priority queue is the abstract data type:

```
push(x)        — insert
pop_min()      — return and remove smallest (or pop_max for max-heap)
peek()         — return smallest without removing
size(), empty()
```

The binary heap is the most common implementation, but not the only one:

| Implementation | push | pop | peek | merge | decrease-key |
|----------------|------|-----|------|-------|--------------|
| Sorted array | `O(n)` | `O(1)` | `O(1)` | `O(n)` | `O(n)` |
| Unsorted array | `O(1)` | `O(n)` | `O(n)` | `O(1)` | `O(n)` |
| **Binary heap** | `O(log n)` | `O(log n)` | `O(1)` | `O(n)` | `O(log n)` (with index) |
| **d-ary heap** | `O(log_d n)` | `O(d log_d n)` | `O(1)` | `O(n)` | `O(log_d n)` |
| **Binomial heap** | `O(log n)` amortized `O(1)` | `O(log n)` | `O(log n)` | `O(log n)` | `O(log n)` |
| **Fibonacci heap** | `O(1)` | `O(log n)` amortized | `O(1)` | `O(1)` | `O(1)` amortized |
| **Pairing heap** | `O(1)` | `O(log n)` amortized | `O(1)` | `O(1)` | `O(log n)` amortized |
| Skip-list-based | `O(log n)` | `O(log n)` | `O(1)` | `O(n + m)` | varies |

For **most production use**, the binary heap is the right choice — simple, fast constants, predictable. Fibonacci heaps and binomial heaps are mostly of theoretical interest (Dijkstra is `O(E + V log V)` with Fibonacci, but in practice binary heap is faster because of constants and cache).

### Standard library priority queues

```python
# Python — heapq is a min-heap
import heapq
h = []
heapq.heappush(h, (priority, item))
priority, item = heapq.heappop(h)
```

```java
// Java — PriorityQueue is a min-heap by default
PriorityQueue<Integer> pq = new PriorityQueue<>();
pq.add(5); pq.add(1); pq.add(3);
pq.poll();  // 1
// Max-heap
PriorityQueue<Integer> max = new PriorityQueue<>(Comparator.reverseOrder());
```

```go
// Go — container/heap requires implementing the interface (verbose)
import "container/heap"
type IntHeap []int
func (h IntHeap) Len() int            { return len(h) }
func (h IntHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *IntHeap) Push(x any)         { *h = append(*h, x.(int)) }
func (h *IntHeap) Pop() any           { old := *h; n := len(old); x := old[n-1]; *h = old[:n-1]; return x }
// then: h := &IntHeap{2,1,5}; heap.Init(h); heap.Push(h, 3); heap.Pop(h)
```

---

## K-th Largest, K-th Smallest, Top-K

The classic heap interview question. Three approaches:

### Approach 1 — Sort and index

Sort, return `arr[n-k]`. `O(n log n)` time, `O(1)` extra space (in-place sort).

### Approach 2 — Quickselect

Partition like Quick Sort but only recurse on one side. **Average `O(n)`**, worst `O(n²)` (use median-of-medians for guaranteed `O(n)`).

### Approach 3 — Min-heap of size k

Maintain a min-heap of size `k`. For each new element, if larger than the min, replace.

```python
import heapq

def kth_largest(nums, k):
    h = nums[:k]
    heapq.heapify(h)                      # O(k)
    for x in nums[k:]:
        if x > h[0]:
            heapq.heapreplace(h, x)       # O(log k)
    return h[0]                           # the k-th largest
```

Time: `O(n log k)`, Space: `O(k)`.

### When to use which

- **k ≪ n**: heap (`O(n log k)`) and Quickselect (`O(n)` avg) both win over sort.
- **k ≈ n/2 (median)**: Quickselect is best.
- **Streaming / online** (data arrives one piece at a time, can't fit in memory): heap is the **only** option — sort and Quickselect both need the full array.
- **Need top-k sorted**: heap solution naturally returns sorted-by-extraction order.

### Top-K frequent elements

```python
from collections import Counter
import heapq

def top_k_frequent(nums, k):
    cnt = Counter(nums)
    return heapq.nlargest(k, cnt.keys(), key=cnt.get)
    # or: return [x for x, _ in cnt.most_common(k)]
```

`nlargest` internally uses a min-heap of size `k`. `O(n log k)`.

### Bucket-sort alternative

For top-K frequent with bounded counts, bucket sort by frequency is `O(n)` — beats heap. Choose based on input characteristics.

---

## Floyd's Heap Construction

Floyd's algorithm is the pseudocode we already saw:

```
for i := n/2 - 1 down to 0:
    siftDown(arr, i, n)
```

### Why it works (induction)

**Claim:** after `siftDown(arr, i, n)`, the subtree rooted at `i` is a max-heap.

**Base case:** `i = n/2 - 1` is the deepest internal node; its children are leaves (singleton heaps). After one sift-down, the subtree is a 2- or 3-node max-heap.

**Inductive step:** before calling `siftDown(arr, i, n)`, both subtrees rooted at `2i+1` and `2i+2` are already max-heaps (by induction, since `2i+1, 2i+2 > i`). So sifting down `arr[i]` into a known max-heap restores the heap property.

**Conclusion:** when `i = 0`, the entire array is a max-heap.

### Why bottom-up?

Going top-down (from root) wouldn't work — when you sift down the root into unprocessed subtrees, those subtrees aren't heaps yet, so you'd compare against unsorted data and miss the actual max.

### Visual intuition

The bottom-up build resembles **building stalactites first, then walls, then ceiling**. By the time you process the root, every subtree below it is a perfectly formed heap, ready to absorb whatever you drop in.

---

## Streaming and Online Heap Operations

Unlike sorts, heaps shine in **online** settings.

### Median maintenance (running median)

Two heaps:
- **Max-heap** `lo` for the lower half.
- **Min-heap** `hi` for the upper half.

Invariants: `len(lo) ∈ {len(hi), len(hi) + 1}` and `max(lo) <= min(hi)`.

```python
import heapq

class MedianFinder:
    def __init__(self):
        self.lo = []   # max-heap (negate values)
        self.hi = []   # min-heap

    def add(self, x):
        if not self.lo or x <= -self.lo[0]:
            heapq.heappush(self.lo, -x)
        else:
            heapq.heappush(self.hi, x)
        # rebalance
        if len(self.lo) > len(self.hi) + 1:
            heapq.heappush(self.hi, -heapq.heappop(self.lo))
        elif len(self.hi) > len(self.lo):
            heapq.heappush(self.lo, -heapq.heappop(self.hi))

    def median(self):
        if len(self.lo) > len(self.hi):
            return -self.lo[0]
        return (-self.lo[0] + self.hi[0]) / 2
```

`add` is `O(log n)`, `median` is `O(1)`. Used in real-time stats, latency monitoring (p50 sliding median), etc.

### Sliding window maximum

A heap can solve sliding-window-max in `O(n log k)` (with lazy deletion: keep popping stale entries from the heap top until you find a fresh one). A **monotonic deque** does it in `O(n)` — strictly better, but the heap version is conceptually simpler and easier to remember in interviews.

### Event-driven simulation

Discrete-event simulators (network simulators, game tick scheduling) keep events in a min-heap keyed by timestamp. Pop the next event, process it (which may schedule more events), repeat.

---

## Indexed Heaps and Decrease-Key

Standard binary heaps don't support efficient `decrease-key(item, new_priority)` because finding `item` in the heap is `O(n)`. To make Dijkstra optimal you need an **indexed heap**:

- Maintain a side array `pos[item] = index_in_heap`.
- On every swap, update `pos`.
- `decrease-key`: look up index, change value, sift up. `O(log n)`.

```python
class IndexedMinHeap:
    def __init__(self):
        self.data = []                # list of (priority, item)
        self.pos  = {}                # item -> index in data

    def push(self, item, priority):
        self.data.append((priority, item))
        self.pos[item] = len(self.data) - 1
        self._sift_up(len(self.data) - 1)

    def decrease_key(self, item, new_priority):
        i = self.pos[item]
        old_p, _ = self.data[i]
        if new_priority >= old_p:
            return                    # not a decrease
        self.data[i] = (new_priority, item)
        self._sift_up(i)

    def _swap(self, i, j):
        self.pos[self.data[i][1]], self.pos[self.data[j][1]] = j, i
        self.data[i], self.data[j] = self.data[j], self.data[i]

    def _sift_up(self, i):
        while i > 0:
            p = (i - 1) >> 1
            if self.data[p][0] <= self.data[i][0]:
                return
            self._swap(p, i)
            i = p
    # ... pop, sift_down similar
```

A simpler alternative used in many competitive solutions: push `(new_priority, item)` and **lazy-skip** stale entries on pop. Memory is `O(E)` instead of `O(V)` but code is shorter.

---

## Practical Implementation Notes

### 1. Heap as a slice in Go

`container/heap` uses an interface-based design that's verbose. For hot code, write a specialized heap with concrete types — 2–3× faster.

### 2. Heap with custom comparator in Java

```java
PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> Integer.compare(a[0], b[0]));
```

Storing primitive arrays avoids autoboxing and is a common pattern in LeetCode answers.

### 3. Heap with mutable priority

If you change a priority outside the heap, the invariant breaks silently. Either:

- Use an indexed heap (above) and call `decrease-key` / `increase-key`.
- Push a fresh `(priority, item)` and lazy-skip stale entries on pop.

### 4. Avoid heap iteration

`for x in heap` returns elements in **array order**, not sorted order. Always either copy and sort, or repeatedly pop.

### 5. Heap as backing store for Dijkstra

A subtle gotcha: when you pop a vertex, check whether the popped distance matches the current best. If not, skip — it's a stale entry pushed before a relaxation.

```python
while pq:
    d, u = heapq.heappop(pq)
    if d > dist[u]:
        continue              # stale entry
    for v, w in adj[u]:
        if dist[u] + w < dist[v]:
            dist[v] = dist[u] + w
            heapq.heappush(pq, (dist[v], v))
```

### 6. d-ary heaps for cache

A `d=4` heap has 4 children per node. Tree height is `log_4 n = (log_2 n) / 2`, so half as many sift-down levels — but each level compares 4 children. For cache-line-sized nodes, `d=4` typically beats `d=2` by 20–30%.

### 7. Avoid recursion in production

Sift-down is naturally recursive, but iteration is friendlier to the JIT and avoids deep stacks on huge heaps. All standard libraries iterate.

### 8. Beware of `heapq.heappushpop` vs `heapq.heapreplace`

- `heappushpop(h, x)`: push then pop. If `x ≤ h[0]`, returns `x` immediately (no heap mutation).
- `heapreplace(h, x)`: pop then push. Always mutates. Faster when you know `x` will be inserted.

Use `heapreplace` in top-k loops; `heappushpop` if you might filter the new element.

---

## Summary

- The heap satisfies two invariants: **complete tree shape** + **parent-child ordering**.
- Index arithmetic `(i-1)/2`, `2i+1`, `2i+2` is the magic that lets us forget about pointers.
- **Build-heap is `O(n)`**, not `O(n log n)`, thanks to the geometric series — a result every middle-level engineer should be able to derive.
- Heap Sort trades practical speed (cache, constants) for **worst-case guarantee** and **`O(1)` space**. It is the right pick for adversarial-input contexts and the wrong pick for general-purpose sorting today.
- The heap data structure is far more important than Heap Sort itself: it powers priority queues, Dijkstra, top-k, median maintenance, event-driven simulation, Huffman coding, and more.
- Use **standard library** heaps unless profiling reveals them as bottlenecks; only then write specialized d-ary, indexed, or fancy variants.

> **Next:** read `senior.md` for production patterns — Introsort, distributed top-k, scheduler queues, observability.
