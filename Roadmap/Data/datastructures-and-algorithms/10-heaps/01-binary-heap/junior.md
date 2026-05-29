# Binary Heap — Junior Level

> **One-line summary:** A binary heap is a complete binary tree stored as a flat array where every parent satisfies a heap property (max-heap: parent ≥ children; min-heap: parent ≤ children). It supports `push` and `pop-min/max` in `O(log n)` and `peek` in `O(1)`, and it is the canonical implementation of a priority queue.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

A **binary heap** is the most useful, most widespread, and most under-appreciated tree-like data structure in everyday programming. Every time you see a *priority queue* — in Dijkstra's algorithm, in an OS scheduler, in a Kafka consumer's retry queue, in `heapq.nsmallest` — a binary heap is almost certainly doing the work underneath.

The heap was introduced by **J. W. J. Williams in 1964** as the engine behind Heap Sort, and its two defining ideas remain just as elegant today:

1. **Shape rule** — the tree is *complete*: every level is full except possibly the last, which fills left-to-right.
2. **Order rule (heap property)** — every parent dominates its children under a chosen comparison.

Because the shape is complete, the tree can be stored in a flat array with **no pointers**, **no node allocations**, and **no rebalancing rotations**. Two arithmetic formulas — `parent(i) = (i-1)/2`, `child(i) = 2i+1, 2i+2` — replace every linked-tree pointer chase you would normally write.

The result is a structure that is **fast** (logarithmic on every mutation, constant on `peek`), **compact** (one array, no per-node overhead), and **cache-friendly** at small sizes (parent and child indices are close in memory).

The single thing it does **not** give you is total sortedness. A heap only guarantees the root — the minimum (or maximum) — is correct. Everything below the root is in *some* heap-valid arrangement, not a sorted one. That partial order is exactly what makes the operations fast: you never pay to keep the whole structure sorted.

---

## Prerequisites

Before you read this file you should be comfortable with:

- **Arrays and zero-based indexing** — heaps are stored in arrays.
- **Integer arithmetic** — `(i-1)/2` and `2*i+1` show up on every line.
- **Loops and `while` conditions** — sift-up and sift-down are loops.
- **Recursion basics** — useful for `siftDown`, though we usually iterate.
- **Big-O notation** — `O(log n)`, `O(n)`, `O(n log n)`.
- **Comparison operators** — `<`, `>` (and the idea of inverting them for max vs min).

Optional but helpful:

- Brief exposure to **binary trees on paper** — even without coding them.
- Familiarity with at least one **priority queue library** (`heapq`, `PriorityQueue`, `container/heap`).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Binary heap** | A complete binary tree where every parent satisfies a heap property relative to its children. |
| **Min-heap** | Heap where parent ≤ children. Root holds the minimum. |
| **Max-heap** | Heap where parent ≥ children. Root holds the maximum. |
| **Complete binary tree** | All levels full except possibly the last, which fills left to right. |
| **Heap property / heap invariant** | The order rule that defines the heap (`≤` or `≥`). |
| **Sift up (percolate-up, bubble-up)** | Restore the invariant by swapping a node with its parent, repeatedly, until it lands. |
| **Sift down (heapify-down, percolate-down)** | Restore the invariant by swapping a node with its smaller (or larger) child, repeatedly. |
| **Build-heap** | Turn an arbitrary array into a heap in `O(n)` via Floyd's bottom-up algorithm. |
| **Peek / find-min** | Read the root without removing it. `O(1)`. |
| **Push / insert** | Add a new element while preserving the invariant. `O(log n)`. |
| **Pop / extract-min** | Remove and return the root while preserving the invariant. `O(log n)`. |
| **Decrease-key** | Lower an existing element's key. Requires sift-up. `O(log n)` (if you know the index). |
| **Heapify** | Confusingly used to mean either "sift down a single node" or "build the entire heap." |

---

## Core Concepts

### 1. The Array-as-Tree Mapping

A binary heap is a *complete* binary tree, so we can store it in a contiguous array with no pointers. For an element at index `i` (zero-based):

```
parent(i) = (i - 1) / 2     // integer division
left(i)   = 2 * i + 1
right(i)  = 2 * i + 2
```

Example — the array `[1, 3, 5, 4, 7, 8, 9]` represents this **min-heap**:

```
              1              (index 0)
            /   \
           3     5           (1, 2)
          / \   / \
         4   7 8   9         (3, 4, 5, 6)
```

Check the invariant: `1 ≤ 3, 1 ≤ 5, 3 ≤ 4, 3 ≤ 7, 5 ≤ 8, 5 ≤ 9` — all good.

### 2. Sift Up (used by `push`)

You insert at the bottom (end of the array), then walk upward swapping with the parent as long as the parent is bigger (for a min-heap):

```
insert(x):
    arr.append(x)
    i = len(arr) - 1
    while i > 0 and arr[(i-1)/2] > arr[i]:
        swap arr[i], arr[(i-1)/2]
        i = (i-1)/2
```

Worst case `O(log n)` — you climb at most `⌊log₂ n⌋` levels.

### 3. Sift Down (used by `pop`)

You swap the root with the last element, shrink the heap by one, then walk the *new root* downward swapping with the smaller of its two children:

```
pop():
    top = arr[0]
    arr[0] = arr.pop()             // move last to front, shrink
    i = 0
    while left(i) < len(arr):
        smaller = left(i)
        if right(i) < len(arr) and arr[right(i)] < arr[smaller]:
            smaller = right(i)
        if arr[i] <= arr[smaller]:
            break
        swap arr[i], arr[smaller]
        i = smaller
    return top
```

Again `O(log n)`.

### 4. Build-Heap in O(n) — Floyd's Algorithm

Given an unsorted array, you might think "insert `n` items at `O(log n)` each = `O(n log n)`." That's true, but you can do better. Sift-down each node from `n/2 − 1` back to `0`:

```
build_heap(arr):
    for i from (n/2 - 1) down to 0:
        sift_down(i)
```

The trick: nodes near the bottom do almost no work (most are leaves and skip the loop). The total cost telescopes to `O(n)`, not `O(n log n)`. A formal proof appears in [`professional.md`](./professional.md).

### 5. Min-Heap vs Max-Heap

The only difference is the comparison. If you have a min-heap implementation and need a max-heap, **invert the comparison** or **negate the keys**. Python's `heapq` is min-only by convention — many programmers push `(-priority, item)` tuples to fake a max-heap.

---

## Big-O Summary

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| `peek` / `findMin` / `findMax` | **O(1)** | O(1) | Read `arr[0]`. |
| `push` / `insert` | **O(log n)** | O(1) | Sift up. |
| `pop` / `extractMin` / `extractMax` | **O(log n)** | O(1) | Sift down. |
| `replace` (pop + push together) | **O(log n)** | O(1) | One sift-down instead of two passes. |
| `decreaseKey` (known index) | **O(log n)** | O(1) | Sift up after lowering. |
| `delete` (known index) | **O(log n)** | O(1) | Replace with last, then sift up *or* down. |
| `build_heap` (Floyd's) | **O(n)** | O(1) | The famous tight bound. |
| `search` for an arbitrary key | **O(n)** | O(1) | Heaps are not searchable; only the root is found fast. |
| Total space | **O(n)** | — | One contiguous array, no per-node overhead. |

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Min-heap | A hospital triage room where the most-critical patient is always at the front of the queue. New arrivals are placed at the back and bubble up if they are more critical than someone ahead. |
| Sift up after insert | A new emergency walks in and elbows past anyone less critical until they reach the right position. |
| Sift down after pop | The triage nurse takes the most-critical patient, then a non-critical person from the back temporarily takes the front spot and is moved backward until the order is right again. |
| Build-heap | A new triage nurse walks the room from back to front, rearranging small groups at a time — they never have to redo the whole room. |
| The array layout | The patients are numbered 0, 1, 2, … as they appear in a flat list, and the "tree" is virtual — you can compute who is the parent or child of patient `i` with arithmetic alone. |

Where the analogy breaks: in a real triage room you compare patients pairwise across the whole room. In a heap you only ever compare a parent with its two children — never siblings, never cousins.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Tightest `O(log n)` push/pop you can get without amortization tricks. | Not searchable: finding an arbitrary element is `O(n)`. |
| `O(1)` peek of the min/max. | Not stable: two equal keys can come out in any order. |
| `O(n)` bulk build is faster than `n` individual inserts. | Decrease-key requires you to *know the index*, which means an auxiliary `index map` if items can move. |
| One contiguous array — cache-friendly, no per-node pointers. | Merging two heaps is `O(n)` — use a leftist, pairing, or Fibonacci heap if you need fast merge. |
| Tiny code: ~30 lines for a working priority queue. | Branch-heavy sift-down is hard for branch predictors on modern CPUs. |
| In-place for `heapsort`. | Hard to make lock-free for concurrent use — usually wrapped in a mutex. |

**When to use:** priority queues, Dijkstra / Prim / A* search, heap sort, top-`k` selection, scheduling, event simulation, stream median (two heaps).

**When NOT to use:** random search by value (use a hash set / BST), frequent meld of two heaps (use leftist / Fibonacci), strict FIFO order (use a queue).

---

## Step-by-Step Walkthrough

Insert `2, 8, 4, 1, 9, 3` into an empty **min-heap**, one at a time.

```
push 2  → [2]
push 8  → [2, 8]                                                # 8 >= 2, no sift
push 4  → [2, 8, 4]                                             # 4 >= 2, no sift
push 1  → [1, 2, 4, 8]                                          # 1 sifts up past 8 then past 2
push 9  → [1, 2, 4, 8, 9]                                       # 9 >= 2, no sift
push 3  → [1, 2, 3, 8, 9, 4]                                    # 3 sifts up past 4
```

Now `pop` three times in a row:

```
pop → 1, heap = [2, 8, 3, 4, 9]                                 # last (4) → root, then sift down past 3
pop → 2, heap = [3, 4, 9, 8]                                    # last (8) → root, sifts down past 3 then 4
pop → 3, heap = [4, 8, 9]                                       # last (9) → root, sifts down past 4
```

After each operation the **root is the minimum** of what remains. That is the only ordering guarantee.

---

## Code Examples

### Example: Minimal Min-Heap (push, peek, pop)

#### Go

```go
package main

import "fmt"

type MinHeap struct {
    data []int
}

func (h *MinHeap) Push(x int) {
    h.data = append(h.data, x)
    i := len(h.data) - 1
    for i > 0 {
        parent := (i - 1) / 2
        if h.data[parent] <= h.data[i] {
            break
        }
        h.data[parent], h.data[i] = h.data[i], h.data[parent]
        i = parent
    }
}

func (h *MinHeap) Peek() int { return h.data[0] }

func (h *MinHeap) Pop() int {
    top := h.data[0]
    n := len(h.data) - 1
    h.data[0] = h.data[n]
    h.data = h.data[:n]
    i := 0
    for {
        l, r := 2*i+1, 2*i+2
        smallest := i
        if l < n && h.data[l] < h.data[smallest] {
            smallest = l
        }
        if r < n && h.data[r] < h.data[smallest] {
            smallest = r
        }
        if smallest == i {
            break
        }
        h.data[i], h.data[smallest] = h.data[smallest], h.data[i]
        i = smallest
    }
    return top
}

func main() {
    h := &MinHeap{}
    for _, x := range []int{2, 8, 4, 1, 9, 3} {
        h.Push(x)
    }
    for len(h.data) > 0 {
        fmt.Println(h.Pop())
    }
    // 1 2 3 4 8 9
}
```

#### Java

```java
import java.util.ArrayList;
import java.util.List;

public class MinHeap {
    private final List<Integer> data = new ArrayList<>();

    public void push(int x) {
        data.add(x);
        int i = data.size() - 1;
        while (i > 0) {
            int parent = (i - 1) / 2;
            if (data.get(parent) <= data.get(i)) break;
            swap(parent, i);
            i = parent;
        }
    }

    public int peek() { return data.get(0); }

    public int pop() {
        int top = data.get(0);
        int last = data.remove(data.size() - 1);
        if (!data.isEmpty()) {
            data.set(0, last);
            int i = 0, n = data.size();
            while (true) {
                int l = 2 * i + 1, r = 2 * i + 2, smallest = i;
                if (l < n && data.get(l) < data.get(smallest)) smallest = l;
                if (r < n && data.get(r) < data.get(smallest)) smallest = r;
                if (smallest == i) break;
                swap(i, smallest);
                i = smallest;
            }
        }
        return top;
    }

    private void swap(int a, int b) {
        int t = data.get(a);
        data.set(a, data.get(b));
        data.set(b, t);
    }

    public static void main(String[] args) {
        MinHeap h = new MinHeap();
        for (int x : new int[]{2, 8, 4, 1, 9, 3}) h.push(x);
        while (!h.data.isEmpty()) System.out.println(h.pop());
    }
}
```

#### Python

```python
class MinHeap:
    def __init__(self):
        self._data = []

    def push(self, x):
        self._data.append(x)
        i = len(self._data) - 1
        while i > 0:
            parent = (i - 1) // 2
            if self._data[parent] <= self._data[i]:
                break
            self._data[parent], self._data[i] = self._data[i], self._data[parent]
            i = parent

    def peek(self):
        return self._data[0]

    def pop(self):
        top = self._data[0]
        last = self._data.pop()
        if self._data:
            self._data[0] = last
            i, n = 0, len(self._data)
            while True:
                l, r, smallest = 2 * i + 1, 2 * i + 2, i
                if l < n and self._data[l] < self._data[smallest]:
                    smallest = l
                if r < n and self._data[r] < self._data[smallest]:
                    smallest = r
                if smallest == i:
                    break
                self._data[i], self._data[smallest] = self._data[smallest], self._data[i]
                i = smallest
        return top


if __name__ == "__main__":
    h = MinHeap()
    for x in [2, 8, 4, 1, 9, 3]:
        h.push(x)
    while h._data:
        print(h.pop())
```

**What it does:** builds a min-heap, then drains it in non-decreasing order.
**Run:** `go run main.go` | `javac MinHeap.java && java MinHeap` | `python min_heap.py`

---

## Coding Patterns

### Pattern 1: Top-K Smallest with a Max-Heap of Size K

**Intent:** Keep only the `k` smallest items from a stream. Use a *max-heap* of fixed size `k`; if a new item beats the current max, evict the max.

```python
import heapq

def top_k_smallest(stream, k):
    h = []                       # this is a min-heap; negate values to fake max-heap
    for x in stream:
        if len(h) < k:
            heapq.heappush(h, -x)
        elif -x > h[0]:          # x < (-h[0]) means x is smaller than current max
            heapq.heapreplace(h, -x)
    return sorted(-v for v in h)
```

Same idea applies in Go (`container/heap`) and Java (`PriorityQueue`).

### Pattern 2: Two Heaps for Streaming Median

**Intent:** Maintain a running median in `O(log n)` per insert. Keep a *max-heap* of the lower half and a *min-heap* of the upper half; balance their sizes by at most one.

### Pattern 3: Dijkstra's "Lazy" Priority Queue

**Intent:** Avoid `decreaseKey` by pushing duplicates and ignoring stale entries on pop.

```python
import heapq

def dijkstra(graph, src):
    dist = {src: 0}
    pq = [(0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:                    # stale — already settled
            continue
        for v, w in graph[u]:
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist
```

```mermaid
graph TD
    A[Stream of items] --> B[push: append + sift up]
    A --> C[pop: swap last to root + sift down]
    B --> D[peek: arr[0] in O(1)]
    C --> D
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| `IndexOutOfBounds` on empty `pop`/`peek` | Heap is empty. | Guard with `len(data) == 0` and return an empty/`Optional.empty()` value. |
| Sift-down loops forever | Off-by-one in `l < n` or `r < n` check. | Use the exact bound `< n` (size of *remaining* heap, not original). |
| Wrong root after `pop` | Forgot to overwrite `data[0]` with the last element before sifting down. | Always: `data[0] = data[n-1]; data.pop(); sift_down(0);` in that order. |
| `NoneType is not iterable` in Python tuples | Pushed bare ints into a heap that later receives tuples. | Pick one tuple shape (e.g. `(priority, id, item)`) and stick with it. |
| Integer overflow in `parent = (i-1)/2` for large `i` | Using 32-bit signed int with size near `2³¹`. | Use 64-bit indices. Heaps that large rarely fit anyway. |

---

## Performance Tips

- **Bulk-load with `O(n)` build-heap** instead of `n` push calls when you have all items up front. Three-to-five times faster in practice.
- **Cache the size** in a local variable inside sift loops — repeated `len(arr)` calls hurt in interpreted languages.
- **Use the language library** (`heapq`, `container/heap`, `PriorityQueue`) — it is already in C / native and avoids interpreter overhead.
- **Use `heapreplace` / `replace`** instead of `pop` followed by `push` — one sift-down instead of two passes.
- **Inline the comparator** for primitive arrays. Generic `Comparable<T>` boxing in Java is expensive in hot loops.

---

## Best Practices

- Write a brute-force `sort + take first` baseline first, then test your heap version against it on random inputs.
- Always assert the heap invariant in tests: after every operation, every parent dominates its children.
- Document whether your heap is min- or max-oriented at the top of the file — readers will not guess.
- Prefer the standard library in production; implement from scratch only for learning, contests, or unusual comparators.
- When you need decrease-key, keep an external `index_of[item]` map updated by your `swap` function.

---

## Edge Cases & Pitfalls

- **Empty heap** — `peek` and `pop` must fail loudly (exception) or sentinel cleanly. Do not return garbage.
- **Single element** — `pop` shrinks to empty without sifting; make sure your code does not access `data[0]` after the shrink.
- **All-equal keys** — the heap still works but order between equals is unspecified. If you need a tiebreaker, push `(key, counter, item)` tuples.
- **Duplicate insertions** — perfectly fine; duplicates do not break the invariant.
- **Negative keys** — fine for `int` heaps; for `float` heaps watch out for `NaN`, which breaks every comparison.
- **Maximum-size constraint** — there is no built-in cap. If you want a bounded heap (top-`k`), evict on the boundary as in Pattern 1.

---

## Common Mistakes

1. **Forgetting to shrink before sifting down** — leaves the original last element doubled.
2. **Sifting up after `pop`** instead of sifting down — the invariant might still hold by accident on small inputs and silently break on larger ones.
3. **Comparing siblings** during sift-down — you only compare a parent with its two children, never the children with each other directly (except to pick the smaller).
4. **Using `(i-1)/2` for `i = 0`** — `(-1)/2` is `-1` in some languages, `0` in others. Always guard `i > 0` before going to a parent.
5. **Mutating tuples / objects** inside the heap — once an element is in, its comparison key must not change, or the invariant silently rots.
6. **Calling `heapify(arr)` and assuming it sorts** — it only enforces the heap property; the array is *not* sorted.

---

## Cheat Sheet

| Operation | Time | Space | Direction |
|-----------|------|-------|-----------|
| `peek` | O(1) | O(1) | — |
| `push` | O(log n) | O(1) | sift up |
| `pop` | O(log n) | O(1) | sift down |
| `replace` | O(log n) | O(1) | sift down |
| `decreaseKey` | O(log n) | O(1) | sift up |
| `build_heap` | **O(n)** | O(1) | sift down from `n/2−1` to `0` |
| `search` | O(n) | O(1) | linear scan |
| `meld` (two heaps) | O(n) | O(1) | concatenate + build_heap |

Index formulas (zero-based):

```
parent(i) = (i - 1) / 2
left(i)   = 2 * i + 1
right(i)  = 2 * i + 2
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visual animation of binary heap operations.
>
> The animation demonstrates:
> - The complete tree shape and its flat-array storage side by side
> - Step-by-step `push` with sift-up highlighting
> - Step-by-step `pop` with sift-down highlighting
> - Floyd's `O(n)` `build_heap`
> - Min-heap vs max-heap toggle

---

## Summary

A binary heap is the simplest data structure that gives you `O(log n)` push, `O(log n)` pop, and `O(1)` peek on a priority queue. Its complete-tree shape lets you store it in a flat array with no pointers, and Floyd's `O(n)` build-heap is one of the prettiest results in basic algorithm analysis. Master the two primitives — `sift_up` and `sift_down` — and you have effectively mastered the data structure.

---

## Further Reading

- *Introduction to Algorithms* (CLRS), Chapter 6 — "Heapsort" — the canonical treatment.
- *The Art of Computer Programming, Vol. 3* (Knuth), §5.2.3 — heap origins.
- Go — `container/heap` package docs.
- Java — `java.util.PriorityQueue` source.
- Python — `heapq` documentation and `_siftdown_max` source.
- visualgo.net — "Binary Heap (Priority Queue)" — interactive visualisation.
