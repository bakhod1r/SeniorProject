# D-Ary Heap — Junior Level

> **One-line summary:** A `d`-ary heap is a binary heap with `d` children per node instead of 2. The taller / narrower shape (when `d` is small) versus the shorter / fatter shape (when `d` is large) changes the cost of `push` and `pop` in opposite directions — useful when you do many more decrease-key operations than extract-mins.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Choosing the Right d](#choosing-the-right-d)
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

The binary heap from [`../01-binary-heap/junior.md`](../01-binary-heap/junior.md) is the special case `d = 2` of a more general family called the **`d`-ary heap**. Every node has up to `d` children instead of two, the tree is shallower by a factor of `log d`, and the index arithmetic generalises:

```
parent(i) = (i - 1) / d
child_k(i) = d * i + k    for k in 1..d
```

The key insight is that `d` is a *tuning knob*. You trade off:

- **Sift-up cost** — `O(log_d n)` — *decreases* with larger `d` (the tree is shallower).
- **Sift-down cost** — `O(d · log_d n)` — has a `d` factor because at each level you must find the minimum of `d` children.

The result: **if your workload is decrease-key-heavy (many sift-ups per extract-min), a larger `d` pays off.** The canonical example is Dijkstra on a dense graph, where `d = 4` to `d = 8` is the sweet spot. The Go standard library's `container/heap` is `d = 2`, but Boost's `d_ary_heap` defaults to `d = 4` precisely for this reason.

D-ary heaps also have a quieter advantage: **cache friendliness**. With `d = 4`, four consecutive cells (16 bytes for `int32`s) often fit in one cache line, so the children scan during sift-down is essentially free. Binary heaps with `d = 2` waste the rest of the line.

---

## Prerequisites

- **Binary heap** (`d = 2`) — see [`../01-binary-heap/junior.md`](../01-binary-heap/junior.md).
- **Array-as-tree storage** and index arithmetic.
- **Big-O notation** including base-`d` logarithms.
- **Comparison operators** and the idea of a min/max heap.
- Optional: Dijkstra and Prim — the algorithms that originally motivated `d`-ary heaps.

---

## Glossary

| Term | Meaning |
|------|---------|
| **`d`-ary heap** | A complete `d`-ary tree stored in an array with the heap property. |
| **`d`** | The branching factor; `d ≥ 2`. `d = 2` is a binary heap. |
| **Height** | `⌈log_d n⌉`. |
| **Sift-up** | Walk a node *up* the tree, swapping with parent if needed. Cost: `O(log_d n)`. |
| **Sift-down** | Walk a node *down*, swapping with the smallest (or largest) of its `d` children. Cost: `O(d · log_d n)`. |
| **Build-heap** | Heapify an arbitrary array in `O(n)` via Floyd's bottom-up algorithm. |
| **Branching factor sweet spot** | The value of `d` that minimises total work for a given operation mix. |

---

## Core Concepts

### 1. Generalised index arithmetic

For an element at index `i` (zero-based) in a `d`-ary heap:

```
parent(i)    = (i - 1) / d                # integer division
child_k(i)   = d * i + k                  # k in 1..d
first_child  = d * i + 1
last_child   = d * i + d
```

For `d = 2`: `parent = (i-1)/2`, `children = 2i+1, 2i+2` — back to the binary case.
For `d = 4`: `parent = (i-1)/4`, `children = 4i+1, 4i+2, 4i+3, 4i+4`.

### 2. Sift-up: a single chain

`sift_up(i)` keeps swapping `i` with its parent while the parent is bigger (for a min-heap). The walk is `O(log_d n)` steps — shallower than a binary heap.

### 3. Sift-down: scan `d` children per level

`sift_down(i)` is where the cost of large `d` shows up:

```
while first_child(i) < n:
    smallest = first_child(i)
    for k = 2..d:
        c = d*i + k
        if c < n and arr[c] < arr[smallest]:
            smallest = c
    if arr[i] <= arr[smallest]:
        break
    swap arr[i], arr[smallest]
    i = smallest
```

Each level costs `d − 1` comparisons (find min of `d` children) plus one comparison against the parent. With `log_d n` levels the total is `(d − 1) · log_d n` comparisons.

### 4. Why `d = 4` is often a sweet spot

For comparison-heavy workloads on graph algorithms with both `push` and `pop`:

```
total ≈ n · log_d n  (push) + n · d · log_d n  (pop)
      = n · log_d n · (1 + d)
```

Minimising over `d` (treating it continuously) gives `d ≈ e ≈ 2.7`. In practice integer values `d = 3` or `d = 4` win, with `d = 4` slightly ahead because of cache line alignment. For decrease-key-heavy workloads (Dijkstra on dense graphs), `d = 8` or `d = 16` can dominate.

### 5. Build-heap stays `O(n)`

Floyd's bottom-up build-heap still costs `O(n)` for any constant `d`. The proof is essentially the same as for binary heaps — the sum of work telescopes thanks to the geometric distribution of node depths.

---

## Big-O Summary

| Operation | `d = 2` (binary) | `d = 4` | `d = 8` | General `d` |
|-----------|------------------|---------|---------|-------------|
| `peek` | O(1) | O(1) | O(1) | O(1) |
| `push` | O(log₂ n) | O(log₄ n) ≈ 0.5 log₂ n | O(log₈ n) ≈ 0.33 log₂ n | **O(log_d n)** |
| `pop` | O(2 log₂ n) | O(4 log₄ n) ≈ 2 log₂ n | O(8 log₈ n) ≈ 2.66 log₂ n | **O(d log_d n)** |
| `decrease-key` (indexed) | O(log₂ n) | O(log₄ n) | O(log₈ n) | **O(log_d n)** |
| `build-heap` | O(n) | O(n) | O(n) | **O(n)** |
| Space | O(n) | O(n) | O(n) | O(n) |

Notice: `push` cost drops with larger `d`, `pop` cost grows. Pick `d` based on your operation mix.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| `d`-ary heap | A management hierarchy where every manager has `d` reports instead of 2. |
| Larger `d` | Flatter org — fewer reporting levels, but each manager has more direct reports to compare during a layoff (sift-down). |
| Smaller `d` | Deeper hierarchy — more reporting levels, but only two reports per manager (simpler sift-down). |
| Sift-up | A new hire gets promoted upward through the chain until they sit at the right level. |
| Sift-down | After a manager leaves, their highest-performing direct report is moved up — recursively. |
| Cache friendliness | All `d` direct reports happen to sit on the same floor — comparing them is "free" because you don't walk. |

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Tuneable knob — pick `d` for your workload. | Larger `d` makes `pop` more expensive. |
| `push` and `decrease-key` faster than binary for `d > 2`. | More children per level means worse branch prediction if `d` is large. |
| Cache-line aligned (`d = 4`) for `int32` keys. | Extra complexity in index arithmetic. |
| Same `O(n)` build-heap as binary. | Marginal wins over `d = 2` — often only 1.2–1.5×. |
| Drop-in replacement — same interface as binary. | Few standard libraries expose it — Boost does (`d_ary_heap`), most others don't. |

**When to use:**
- Dijkstra / Prim on dense graphs where `decrease-key`s dominate.
- Workloads with many more inserts than extracts.
- Cache-tuned systems where `d` aligns with cache line size.

**When NOT to use:**
- Generic priority queue with a balanced op mix — binary heap is simpler and fast enough.
- Tiny `n` — the constant-factor difference disappears.

---

## Choosing the Right d

| Workload | Recommended `d` | Reason |
|----------|-----------------|--------|
| Generic priority queue, mixed ops | 2 (binary) | Simplest, libraries support it. |
| Push-heavy | 4–8 | Sift-up shallower; pop cost still acceptable. |
| Pop-heavy | 2 | Sift-down stays narrow. |
| Dijkstra on dense graph | 4 | Theoretical sweet spot near `e`. |
| Cache-critical inner loop | 4 | One cache line per child group. |
| Decrease-key-heavy (no Fibonacci heap) | 8–16 | Sift-up dominates total work. |

A tiny empirical study almost always tells you the right value — pick three candidates (`d ∈ {2, 4, 8}`), benchmark, choose.

---

## Code Examples

### Example: Generic `d`-ary min-heap

#### Go

```go
package main

import "fmt"

type DAryHeap struct {
    d    int
    data []int
}

func New(d int) *DAryHeap {
    if d < 2 {
        panic("d >= 2 required")
    }
    return &DAryHeap{d: d}
}

func (h *DAryHeap) parent(i int) int       { return (i - 1) / h.d }
func (h *DAryHeap) firstChild(i int) int   { return h.d*i + 1 }

func (h *DAryHeap) Push(x int) {
    h.data = append(h.data, x)
    h.siftUp(len(h.data) - 1)
}

func (h *DAryHeap) Pop() int {
    top := h.data[0]
    n := len(h.data) - 1
    h.data[0] = h.data[n]
    h.data = h.data[:n]
    if n > 0 {
        h.siftDown(0)
    }
    return top
}

func (h *DAryHeap) Peek() int { return h.data[0] }

func (h *DAryHeap) siftUp(i int) {
    for i > 0 {
        p := h.parent(i)
        if h.data[p] <= h.data[i] {
            return
        }
        h.data[p], h.data[i] = h.data[i], h.data[p]
        i = p
    }
}

func (h *DAryHeap) siftDown(i int) {
    n := len(h.data)
    for {
        first := h.firstChild(i)
        if first >= n {
            return
        }
        m := first
        for k := 1; k < h.d; k++ {
            c := first + k
            if c >= n {
                break
            }
            if h.data[c] < h.data[m] {
                m = c
            }
        }
        if h.data[i] <= h.data[m] {
            return
        }
        h.data[i], h.data[m] = h.data[m], h.data[i]
        i = m
    }
}

func main() {
    h := New(4)
    for _, x := range []int{5, 3, 8, 1, 9, 2, 7, 4, 6} {
        h.Push(x)
    }
    for len(h.data) > 0 {
        fmt.Print(h.Pop(), " ")
    }
    // 1 2 3 4 5 6 7 8 9
}
```

#### Java

```java
import java.util.ArrayList;
import java.util.List;

public class DAryHeap {
    private final int d;
    private final List<Integer> data = new ArrayList<>();

    public DAryHeap(int d) {
        if (d < 2) throw new IllegalArgumentException("d >= 2");
        this.d = d;
    }

    public void push(int x) {
        data.add(x);
        siftUp(data.size() - 1);
    }

    public int pop() {
        int top = data.get(0);
        int last = data.remove(data.size() - 1);
        if (!data.isEmpty()) {
            data.set(0, last);
            siftDown(0);
        }
        return top;
    }

    public int peek() { return data.get(0); }

    private void siftUp(int i) {
        while (i > 0) {
            int p = (i - 1) / d;
            if (data.get(p) <= data.get(i)) return;
            swap(p, i);
            i = p;
        }
    }

    private void siftDown(int i) {
        int n = data.size();
        while (true) {
            int first = d * i + 1;
            if (first >= n) return;
            int m = first;
            for (int k = 1; k < d; k++) {
                int c = first + k;
                if (c >= n) break;
                if (data.get(c) < data.get(m)) m = c;
            }
            if (data.get(i) <= data.get(m)) return;
            swap(i, m);
            i = m;
        }
    }

    private void swap(int a, int b) {
        int t = data.get(a);
        data.set(a, data.get(b));
        data.set(b, t);
    }
}
```

#### Python

```python
class DAryHeap:
    def __init__(self, d=4):
        if d < 2:
            raise ValueError("d must be >= 2")
        self.d = d
        self._data = []

    def push(self, x):
        self._data.append(x)
        self._sift_up(len(self._data) - 1)

    def pop(self):
        top = self._data[0]
        last = self._data.pop()
        if self._data:
            self._data[0] = last
            self._sift_down(0)
        return top

    def peek(self):
        return self._data[0]

    def _sift_up(self, i):
        d = self.d
        while i > 0:
            p = (i - 1) // d
            if self._data[p] <= self._data[i]:
                return
            self._data[p], self._data[i] = self._data[i], self._data[p]
            i = p

    def _sift_down(self, i):
        d, n = self.d, len(self._data)
        while True:
            first = d * i + 1
            if first >= n:
                return
            m = first
            for k in range(1, d):
                c = first + k
                if c >= n:
                    break
                if self._data[c] < self._data[m]:
                    m = c
            if self._data[i] <= self._data[m]:
                return
            self._data[i], self._data[m] = self._data[m], self._data[i]
            i = m


if __name__ == "__main__":
    h = DAryHeap(d=4)
    for x in [5, 3, 8, 1, 9, 2, 7, 4, 6]:
        h.push(x)
    out = []
    while h._data:
        out.append(h.pop())
    print(out)  # [1, 2, 3, 4, 5, 6, 7, 8, 9]
```

**What it does:** Pushes 9 values into a `d=4` heap, then pops them in sorted order.
**Run:** `go run main.go` | `javac DAryHeap.java && java DAryHeap` | `python d_ary.py`

---

## Coding Patterns

### Pattern 1: Dijkstra with `d`-ary heap

Tighter complexity for dense graphs:

```
O(E · log_d V + V · d · log_d V)  ≈ O((E + V·d) · log_d V)
```

Minimising over `d` gives `d ≈ E/V` — match the branching factor to the graph's average degree.

### Pattern 2: Heap sort with `d`-ary heap

Slightly fewer cache misses for `d = 4` and `d = 8` thanks to cache-line aligned child scans. The asymptotic complexity stays `O(n log n)`, but the constant is ~10–20% better than `d = 2` on x86_64 for `n > 10⁵`.

### Pattern 3: Bulk operations

`build_heap(arr, d)` runs Floyd's bottom-up algorithm with the generalised `sift_down`. Same `O(n)` bound, just slightly better cache behaviour.

```mermaid
graph TD
    A[push n items] --> B{operation mix?}
    B -- more push than pop --> C[d = 4 to 8]
    B -- balanced --> D[d = 2 (binary)]
    B -- more pop than push --> D
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| `IndexOutOfBounds` in sift-down loop | Forgot `c < n` guard inside the children scan. | Always test bounds before reading. |
| Wrong `d` (e.g., 1) | Causes infinite loop (height = n). | Reject `d < 2` in the constructor. |
| Off-by-one in `firstChild` | Using `d*i` instead of `d*i + 1`. | Memorise the formula `d*i + 1`. |
| `parent(0)` returns garbage | `(0 - 1) / d` is implementation-defined in some languages. | Guard `i > 0` before going to parent. |
| Inconsistent comparator between sift-up and sift-down | Different `<` vs `<=` behaviour. | Define the comparator once and reuse. |

---

## Performance Tips

- **Pick `d = 4` as a default** for unknown workloads — cache-aligned, near-optimal for many graph algorithms.
- **Use a flat array of primitives** (not boxed objects) — the children scan is `d` consecutive reads.
- **Unroll the children loop** for fixed `d` — the JIT will appreciate the help.
- **Benchmark before tuning** — `d` differences are usually within ±20%; sometimes binary wins on small `n`.

---

## Best Practices

- Document `d` next to the type definition: `DAryHeap<int>(d=4)` not just `DAryHeap`.
- Default to `d = 2` unless profiling shows a win; readers expect binary.
- Implement `build_heap` separately from `push` for bulk loads.
- Test against a binary heap implementation on the same input to verify correctness.

---

## Edge Cases & Pitfalls

- **`d = 2` exactly** — degenerates to a binary heap; make sure your formulas still work.
- **Empty heap** — `pop`/`peek` must guard.
- **`n < d`** — sift-down may not have a full child group; the `c < n` guard prevents reads past the end.
- **Very large `d`** (e.g., `d = 100`) — sift-down dominates and may be slower than binary; only useful if you really do `decrease-key` *most* of the time.
- **All-equal keys** — perfectly valid; order between equals is unspecified.

---

## Common Mistakes

1. Forgetting that the binary heap is `d = 2` of the same family.
2. Using `parent(i) = (i - 1) / 2` in a `d`-ary heap. Must be `(i - 1) / d`.
3. Picking `d` based on theory alone — always benchmark.
4. Picking `d = 1` (a singly-linked list, not a heap) — `d ≥ 2` required.
5. Scanning the wrong number of children — `for k in 1..d`, not `1..d−1`.

---

## Cheat Sheet

| Operation | Cost | Sift direction |
|-----------|------|----------------|
| `peek` | O(1) | — |
| `push` | O(log_d n) | up |
| `pop` | O(d · log_d n) | down |
| `decrease-key` | O(log_d n) | up |
| `build-heap` | O(n) | down |

Index formulas:

```
parent(i)        = (i - 1) / d
first_child(i)   = d * i + 1
k-th child(i)    = d * i + k         (k in 1..d)
```

Recommended defaults:

- `d = 2`: simplest, default.
- `d = 4`: cache-aligned for 32-bit keys, sweet spot for many graph workloads.
- `d = 8` or higher: only for very decrease-key-heavy workloads, verified by benchmark.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The animation shows three heaps (`d = 2`, `d = 4`, `d = 8`) responding to the same sequence of operations, with per-heap comparison counters so you can see the trade-off in action.

---

## Summary

A `d`-ary heap is a generalised binary heap with `d` children per node. The shape change moves cost between `push` and `pop` in opposite directions, giving you a tuning knob. Default to `d = 4` for cache-aligned graph algorithms, fall back to `d = 2` for generic priority queues. The rest is straight from the binary-heap playbook.

---

## Further Reading

- *Introduction to Algorithms* (CLRS), Exercise 6.5-9 — `d`-ary heaps.
- Boost C++ Libraries — `boost::heap::d_ary_heap` documentation.
- Tarjan, *Data Structures and Network Algorithms*, §3.1 — generalised heaps.
- "Why d = 4?" — articles on cache-line alignment in heap implementations.
