# Binary Heap — Middle Level

> **Focus:** Why the operations are correct, when the heap is the right choice, and how it composes with graphs and DP.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Graph and Tree Applications](#graph-and-tree-applications)
6. [Dynamic Programming Integration](#dynamic-programming-integration)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the binary heap is "push, pop, peek." At middle level you start asking the *engineering* questions:

- Why is `build_heap` truly `O(n)` and not `O(n log n)`?
- When does a `d-ary` heap beat a binary heap?
- How do you support `decrease-key` if a heap "doesn't know" where elements live?
- Why does `pop` cost twice the swaps of `push` in practice?
- When does a balanced BST or an indexed skip-list dominate?

These are not academic — they decide whether your Dijkstra runs in 50 ms or 5 seconds.

---

## Deeper Concepts

### Invariant: the heap order

Formally, for a min-heap stored in array `A[0..n-1]`:

```
∀ i ∈ [0, n-1] :   if 2i+1 < n then A[i] ≤ A[2i+1]
                    if 2i+2 < n then A[i] ≤ A[2i+2]
```

The shape invariant ("complete tree") is implicit in the fact we use a contiguous array: any prefix `A[0..n-1]` of an arbitrary array describes the unique completed tree of size `n`.

`sift_up(i)` and `sift_down(i)` are the two **local repair** operations. Both have the property that *if the invariant holds everywhere except at index `i`, calling sift on `i` restores it globally*. This locality is what makes them composable.

### Recurrence Relations

`sift_down` on a heap of height `h`:

```
T(h) = T(h-1) + O(1)            T(0) = O(1)   ⇒   T(h) = O(h) = O(log n)
```

`build_heap` summed over all internal nodes:

```
T_build(n) = Σ_{h=0..log n}  ⌈n / 2^(h+1)⌉ · O(h)
           = O( n · Σ_{h≥0} h / 2^h )
           = O( n · 2 ) = O(n)
```

The inner sum `Σ h/2^h` is a classic convergent series equal to 2 — proved in [`professional.md`](./professional.md).

### Why pop "costs more" than push in practice

- `push` sifts from a *leaf*; most pushes terminate within one or two comparisons because a leaf is rarely smaller than its parent.
- `pop` sifts from the *root* (after swapping in the last element, usually a near-leaf value), which almost always descends to the leaves.

Empirically, sift-down does `2 log₂ n` comparisons on average, sift-up only about `1` comparison. That asymmetry is the basis of Knuth's "bottom-up heap construction" and of optimised library implementations that defer one comparison per level.

### Why `decrease-key` needs an index map

When an element's key drops, only sift-up is needed — but you have to find the element first. A bare array gives `O(n)`. The standard trick:

```
position[item] = index in heap
```

Update `position` inside `swap`. Now `decrease-key` is `O(log n)`. This is exactly what Dijkstra with a binary heap does when you replace the "lazy" approach with a real `decrease-key`.

---

## Comparison with Alternatives

| Attribute | Binary heap | d-ary heap (`d=4`) | Leftist heap | Fibonacci heap | Sorted array | Self-balancing BST |
|-----------|-------------|--------------------|--------------|----------------|--------------|--------------------|
| `peek` | O(1) | O(1) | O(1) | O(1) | O(1) | O(log n) |
| `push` | O(log n) | O(log_d n) | O(log n) | **O(1) amortised** | O(n) | O(log n) |
| `pop-min` | O(log n) | O(d · log_d n) | O(log n) | O(log n) | O(1) | O(log n) |
| `decrease-key` | O(log n) | O(log_d n) | O(log n) | **O(1) amortised** | O(n) | O(log n) |
| `meld` | O(n) | O(n) | **O(log n)** | **O(1)** | O(n) | O(n log n) |
| Memory per node | 1 slot | 1 slot | 2 pointers | many pointers + flags | 1 slot | 2-3 pointers + colour |
| Cache behaviour | great (flat array) | even better (more siblings per cache line) | poor (pointer chasing) | terrible | great | OK |

**Choose a binary heap when:** you need a basic priority queue, the operation mix is `push`/`pop`/`peek`, items are not melded, and you value cache locality and simplicity.

**Choose a d-ary heap when:** you do *many* `decrease-key`s for every `pop-min`, e.g. Dijkstra on dense graphs — fewer levels, cheaper sift-up.

**Choose a Fibonacci heap when:** the asymptotics matter on paper (theoretical Dijkstra), but in practice the constants ruin you for `n < 10⁶`.

**Choose a leftist or pairing heap when:** `meld` is on the hot path (event simulators, k-way merges with cancellation).

---

## Advanced Patterns

### Pattern: Lazy decrease-key in Dijkstra

Instead of maintaining an `index_of` map, push duplicates and skip stale entries.

#### Go

```go
type Edge struct {
    to     int
    weight int
}

type Item struct {
    dist int
    node int
}

// Min-heap on Item.dist (use container/heap in real code).
func Dijkstra(graph [][]Edge, src int) []int {
    n := len(graph)
    dist := make([]int, n)
    for i := range dist {
        dist[i] = -1
    }
    dist[src] = 0

    pq := NewMinHeap()
    pq.Push(Item{0, src})

    for pq.Len() > 0 {
        cur := pq.Pop().(Item)
        if cur.dist > dist[cur.node] {
            continue // stale entry — already settled
        }
        for _, e := range graph[cur.node] {
            nd := cur.dist + e.weight
            if dist[e.to] == -1 || nd < dist[e.to] {
                dist[e.to] = nd
                pq.Push(Item{nd, e.to})
            }
        }
    }
    return dist
}
```

#### Java

```java
public int[] dijkstra(List<int[]>[] graph, int src) {
    int n = graph.length;
    int[] dist = new int[n];
    Arrays.fill(dist, Integer.MAX_VALUE);
    dist[src] = 0;
    PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);
    pq.add(new int[]{0, src});
    while (!pq.isEmpty()) {
        int[] cur = pq.poll();
        int d = cur[0], u = cur[1];
        if (d > dist[u]) continue;
        for (int[] e : graph[u]) {
            int v = e[0], w = e[1], nd = d + w;
            if (nd < dist[v]) {
                dist[v] = nd;
                pq.add(new int[]{nd, v});
            }
        }
    }
    return dist;
}
```

#### Python

```python
import heapq

def dijkstra(graph, src):
    dist = {src: 0}
    pq = [(0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, w in graph[u]:
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist
```

Lazy duplicates inflate the heap from `O(V)` to `O(E)`. The asymptotic Dijkstra cost becomes `O(E log E) = O(E log V)` — the same as the textbook `O(E log V)` for sparse graphs and easier to write.

### Pattern: Indexed binary heap (real decrease-key)

Wrap the heap in `Map<item, index>`. Every `swap` updates the map:

```python
def _swap(self, i, j):
    self._data[i], self._data[j] = self._data[j], self._data[i]
    self._index[self._data[i].item] = i
    self._index[self._data[j].item] = j
```

`decrease_key(item, new_key)` becomes:

```python
def decrease_key(self, item, new_key):
    i = self._index[item]
    self._data[i].key = new_key
    self._sift_up(i)
```

### Pattern: Two-heap streaming median

A min-heap `H_high` holds the upper half, a max-heap `H_low` holds the lower half. Invariants:

- `|H_low| ≥ |H_high|`
- `|H_low| − |H_high| ∈ {0, 1}`
- every element of `H_low` ≤ every element of `H_high`

`add(x)`: push to the heap whose top compares correctly; rebalance if sizes drift.
`median()`: top of `H_low` if odd total, else mean of the two tops.

### Pattern: K-way merge

Push one element from each sorted stream into a min-heap, then repeatedly pop the smallest and replace it with the next item from that stream. `O(N log k)` for `N` total items across `k` streams.

---

## Graph and Tree Applications

```mermaid
graph TD
    A[Binary heap] --> B[Dijkstra: O((V+E) log V)]
    A --> C[Prim's MST: O(E log V)]
    A --> D[A* search]
    A --> E[Huffman codes: combine two smallest]
    A --> F[Event-driven simulation]
    A --> G[Top-k pattern]
```

### Prim's MST with a heap

```python
import heapq

def prim(graph, n):
    in_tree = [False] * n
    pq = [(0, 0)]               # (weight, node) — start from node 0
    total = 0
    while pq:
        w, u = heapq.heappop(pq)
        if in_tree[u]:
            continue
        in_tree[u] = True
        total += w
        for v, ww in graph[u]:
            if not in_tree[v]:
                heapq.heappush(pq, (ww, v))
    return total
```

The same "lazy stale entry" pattern from Dijkstra applies.

---

## Dynamic Programming Integration

Heaps appear inside DP when each state has many outgoing transitions and you process them in priority order.

#### Go

```go
// Solve: minimum cost to climb a staircase with weighted jumps of length 1..k.
// dp[i] = min(dp[i-j] + cost(i,j))   for j in 1..k
// Use a heap to fetch the lowest dp[i-j] candidate cheaply if costs are dynamic.

type State struct {
    cost int
    pos  int
}
```

#### Java

```java
public int minCost(int[] cost, int k) {
    int n = cost.length;
    int[] dp = new int[n];
    PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);
    dp[0] = cost[0];
    pq.add(new int[]{dp[0], 0});
    for (int i = 1; i < n; i++) {
        while (!pq.isEmpty() && pq.peek()[1] < i - k) pq.poll();
        dp[i] = pq.peek()[0] + cost[i];
        pq.add(new int[]{dp[i], i});
    }
    return dp[n - 1];
}
```

#### Python

```python
import heapq

def min_cost(cost, k):
    n = len(cost)
    dp = [0] * n
    dp[0] = cost[0]
    pq = [(dp[0], 0)]
    for i in range(1, n):
        while pq and pq[0][1] < i - k:
            heapq.heappop(pq)
        dp[i] = pq[0][0] + cost[i]
        heapq.heappush(pq, (dp[i], i))
    return dp[-1]
```

The heap keeps an `O(log n)` minimum over the sliding window of valid predecessors.

---

## Code Examples

### Full implementation with `decrease_key`

#### Go

```go
package main

import "fmt"

type IndexedHeap struct {
    keys []int
    ids  []int             // ids[i] = which entity sits at slot i
    pos  map[int]int       // pos[id] = slot index of id
}

func New() *IndexedHeap {
    return &IndexedHeap{pos: map[int]int{}}
}

func (h *IndexedHeap) Push(id, key int) {
    h.keys = append(h.keys, key)
    h.ids = append(h.ids, id)
    i := len(h.keys) - 1
    h.pos[id] = i
    h.siftUp(i)
}

func (h *IndexedHeap) Pop() (int, int) {
    id, key := h.ids[0], h.keys[0]
    last := len(h.keys) - 1
    h.swap(0, last)
    h.keys = h.keys[:last]
    h.ids = h.ids[:last]
    delete(h.pos, id)
    if last > 0 {
        h.siftDown(0)
    }
    return id, key
}

func (h *IndexedHeap) DecreaseKey(id, newKey int) {
    i := h.pos[id]
    h.keys[i] = newKey
    h.siftUp(i)
}

func (h *IndexedHeap) siftUp(i int) {
    for i > 0 {
        p := (i - 1) / 2
        if h.keys[p] <= h.keys[i] {
            return
        }
        h.swap(p, i)
        i = p
    }
}

func (h *IndexedHeap) siftDown(i int) {
    n := len(h.keys)
    for {
        l, r, m := 2*i+1, 2*i+2, i
        if l < n && h.keys[l] < h.keys[m] {
            m = l
        }
        if r < n && h.keys[r] < h.keys[m] {
            m = r
        }
        if m == i {
            return
        }
        h.swap(i, m)
        i = m
    }
}

func (h *IndexedHeap) swap(a, b int) {
    h.keys[a], h.keys[b] = h.keys[b], h.keys[a]
    h.ids[a], h.ids[b] = h.ids[b], h.ids[a]
    h.pos[h.ids[a]] = a
    h.pos[h.ids[b]] = b
}

func main() {
    h := New()
    h.Push(1, 10)
    h.Push(2, 5)
    h.Push(3, 20)
    h.DecreaseKey(3, 2) // node 3 now has the smallest key
    id, k := h.Pop()
    fmt.Println(id, k) // 3, 2
}
```

#### Java

```java
import java.util.*;

public class IndexedHeap {
    private final List<Integer> keys = new ArrayList<>();
    private final List<Integer> ids = new ArrayList<>();
    private final Map<Integer, Integer> pos = new HashMap<>();

    public void push(int id, int key) {
        keys.add(key);
        ids.add(id);
        int i = keys.size() - 1;
        pos.put(id, i);
        siftUp(i);
    }

    public int[] pop() {
        int id = ids.get(0), key = keys.get(0);
        int last = keys.size() - 1;
        swap(0, last);
        keys.remove(last);
        ids.remove(last);
        pos.remove(id);
        if (!keys.isEmpty()) siftDown(0);
        return new int[]{id, key};
    }

    public void decreaseKey(int id, int newKey) {
        int i = pos.get(id);
        keys.set(i, newKey);
        siftUp(i);
    }

    private void siftUp(int i) {
        while (i > 0) {
            int p = (i - 1) / 2;
            if (keys.get(p) <= keys.get(i)) return;
            swap(p, i);
            i = p;
        }
    }

    private void siftDown(int i) {
        int n = keys.size();
        while (true) {
            int l = 2 * i + 1, r = 2 * i + 2, m = i;
            if (l < n && keys.get(l) < keys.get(m)) m = l;
            if (r < n && keys.get(r) < keys.get(m)) m = r;
            if (m == i) return;
            swap(i, m);
            i = m;
        }
    }

    private void swap(int a, int b) {
        Collections.swap(keys, a, b);
        Collections.swap(ids, a, b);
        pos.put(ids.get(a), a);
        pos.put(ids.get(b), b);
    }
}
```

#### Python

```python
class IndexedHeap:
    def __init__(self):
        self.keys = []
        self.ids = []
        self.pos = {}

    def push(self, id_, key):
        self.keys.append(key)
        self.ids.append(id_)
        i = len(self.keys) - 1
        self.pos[id_] = i
        self._sift_up(i)

    def pop(self):
        id_, key = self.ids[0], self.keys[0]
        last = len(self.keys) - 1
        self._swap(0, last)
        self.keys.pop()
        self.ids.pop()
        del self.pos[id_]
        if self.keys:
            self._sift_down(0)
        return id_, key

    def decrease_key(self, id_, new_key):
        i = self.pos[id_]
        self.keys[i] = new_key
        self._sift_up(i)

    def _sift_up(self, i):
        while i > 0:
            p = (i - 1) // 2
            if self.keys[p] <= self.keys[i]:
                return
            self._swap(p, i)
            i = p

    def _sift_down(self, i):
        n = len(self.keys)
        while True:
            l, r, m = 2 * i + 1, 2 * i + 2, i
            if l < n and self.keys[l] < self.keys[m]: m = l
            if r < n and self.keys[r] < self.keys[m]: m = r
            if m == i: return
            self._swap(i, m)
            i = m

    def _swap(self, a, b):
        self.keys[a], self.keys[b] = self.keys[b], self.keys[a]
        self.ids[a], self.ids[b] = self.ids[b], self.ids[a]
        self.pos[self.ids[a]] = a
        self.pos[self.ids[b]] = b
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|----------------|------------------|
| Mutating an item already in the heap | Invariant silently breaks; later `pop` returns a non-minimum. | Make keys immutable; if a key must change, route through `decrease_key`/`remove`. |
| Stale entries in lazy Dijkstra | Heap grows to `O(E)`; pop may yield outdated dist. | Compare `cur.dist > dist[node]` and skip. |
| Removing while iterating | `data.pop()` then accessing `data[i]` underflows. | Always finish the swap and re-evaluate `len`. |
| Concurrent push/pop without lock | Race causes invariant break; not detected until much later. | Wrap mutations in a single mutex, or switch to a concurrent priority queue. |

---

## Performance Analysis

| Input size | `push` × n | `build_heap + pop × n` (heap sort) | `sorted()` library |
|------------|-----------|------------------------------------|---------------------|
| 10⁴ | ~0.5 ms | ~0.6 ms | ~0.4 ms |
| 10⁵ | ~6 ms | ~7 ms | ~5 ms |
| 10⁶ | ~80 ms | ~95 ms | ~70 ms |

`heapsort` is ~1.3× slower than introsort because of cache misses in `sift_down`. For pure priority-queue workloads (no full sort), the library heap is competitive within ~10%.

#### Python

```python
import heapq, random, timeit

data = [random.random() for _ in range(1_000_000)]

def bulk():
    h = list(data)
    heapq.heapify(h)
    while h:
        heapq.heappop(h)

def one_by_one():
    h = []
    for x in data:
        heapq.heappush(h, x)
    while h:
        heapq.heappop(h)

print("bulk     :", timeit.timeit(bulk, number=1))
print("one_by_one:", timeit.timeit(one_by_one, number=1))
```

Typical result: `bulk` is `1.4–1.8×` faster because of `O(n)` `heapify` and better cache locality on the first half of work.

---

## Best Practices

- **Heapify once, push many** — if the data is available up front.
- **Push tuples `(key, tiebreaker, payload)`** — never mutate the payload after insertion.
- **Use `heapreplace`/`replace`** — saves one pass when you "swap top for a new value."
- **Bound the heap size** for top-`k` problems — evict when over capacity.
- **Profile decrease-key vs lazy** for your graph — the lazy version often wins on sparse graphs.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation includes:
> - Side-by-side comparison: binary vs `d=4` heap on the same operation sequence.
> - Highlighting of stale entries in lazy Dijkstra mode.
> - Invariant violation indicator if you mutate a key mid-flight.

---

## Summary

The binary heap is the right answer to "I need a priority queue and I want predictable performance with no surprises." Its correctness rests on a single local invariant; its speed rests on the flat-array layout; and its limits — `O(n)` meld and `O(n)` search — point toward the more specialised heaps you will meet in the next files (binomial, leftist, pairing, Fibonacci).
