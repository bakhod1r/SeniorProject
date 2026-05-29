# Fibonacci Heap — Middle Level

> **Focus:** "Why does the amortised analysis work?" and "When does a Fibonacci heap actually beat a binary heap in production?" — separating the theoretical winner from the practical loser.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Graph Applications](#graph-applications)
6. [Dynamic Programming Integration](#dynamic-programming-integration)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

A junior engineer can describe a Fibonacci heap as "a forest with `O(1)` decrease-key." A middle engineer can defend the claim:

- Why is the potential function `Φ = #roots + 2 × #marked`?
- Why specifically *two* marked-node losses before promotion, not one or three?
- Why does the maximum degree end up bounded by `log_φ(n)`?
- When is the constant factor small enough that the structure wins on real benchmarks?

The honest answer to the last question is *almost never on modern hardware*, and a middle engineer should know that — and be able to explain it.

---

## Deeper Concepts

### Invariant 1: heap order

Every node's key is at least its parent's. Standard for heaps.

### Invariant 2: degree bound

A node of degree `k` has at least `F_{k+2}` descendants, where `F_i` is the `i`-th Fibonacci number. Because `F_{k+2} ≥ φ^k`, a heap of `n` nodes has maximum degree `D(n) = O(log_φ n)`. This is the Fibonacci link bound — the name of the data structure.

Why `F_{k+2}`? Because cascading cuts ensure that when you link `y` under `x`, `y` has degree at least one less than its position-from-bottom in `x`'s child list. By induction the descendant count satisfies the Fibonacci recurrence:

```
T(k) = T(k-1) + T(k-2)        T(0) = 1, T(1) = 2
       = F_{k+2}
```

### Invariant 3: marked = "has lost exactly one child since last cut"

The mark bit is reset whenever a node becomes a root. It's set when a child of the node is cut. A *second* cut triggers a cascading cut on the marked node. This bound limits how much a tree can degrade before we promote it back to the root list.

### Recurrences and amortisation

Let Φ = #roots + 2 × #marked.

- `insert(x)`: actual cost = 1, ΔΦ = +1, amortised = 2 = `O(1)`.
- `meld(h1, h2)`: actual cost = 1, ΔΦ = 0, amortised = 1.
- `decrease-key(x, k)`: actual cost = 1 + c (c cascading cuts), each cut adds a root (+1) and may un-mark its parent (−2). Amortised cost = O(1).
- `extract-min`: actual cost = D(n) + #roots. ΔΦ = D(n) − #roots. Amortised = O(D(n)) = O(log n).

The careful counting of `2 × #marked` (not 1×) gives `decrease-key` the constant-time amortised bound. A different factor would not work.

### Why marked = 1 isn't enough

If a node could lose any number of children before promotion, its degree-to-descendants ratio would not be bounded by Fibonacci numbers. The `2 × #marked` accounting and the "two losses ⇒ cut" rule are tied together — change one and the proof breaks.

---

## Comparison with Alternatives

| Operation | Binary | d-ary (`d=4`) | Leftist | Pairing | **Fibonacci** | Brodal (worst-case) |
|-----------|-------:|--------------:|--------:|--------:|--------------:|---------------------:|
| `insert` | log n | log_d n | log n | O(1) amort | **O(1) amort** | O(1) worst |
| `find-min` | O(1) | O(1) | O(1) | O(1) | **O(1)** | O(1) |
| `meld` | n | n | log n | O(1) | **O(1)** | O(1) |
| `decrease-key` | log n | log_d n | log n | O(log n) amort* | **O(1) amort** | O(1) worst |
| `extract-min` | log n | d log_d n | log n | O(log n) amort | **O(log n) amort** | O(log n) worst |
| Memory per node | 1 slot | 1 slot | 2 ptrs | 2 ptrs | 6+ ptrs | many |
| Cache behaviour | excellent | excellent | poor | poor | terrible | terrible |

`*` Pairing heap's `decrease-key` is conjectured `O(log log n)` but proven `O(log n)`.

**Bottom line:** Fibonacci is theoretically beautiful, practically dominated by pairing or indexed binary heaps for `n < 10⁷`.

---

## Advanced Patterns

### Pattern: handle-based decrease-key

Always make `insert` return a handle:

#### Go

```go
type Handle = *FibNode

h := New()
node := h.Insert(10, "x")     // node is the handle
// ... later
h.DecreaseKey(node, 3)
```

#### Java

```java
FibHeap.Node handle = heap.insert(10, "x");
heap.decreaseKey(handle, 3);
```

#### Python

```python
handle = h.insert(10, "x")
h.decrease_key(handle, 3)
```

Storing handles outside the heap is the **only** way to find a node later. There is no `find(key)`.

### Pattern: bulk insert by meld

If you have two streams and want to merge them, build two heaps, then call `meld(h1, h2)`. `O(1)`. Same trick as in binomial / leftist heaps.

### Pattern: lazy delete via decrease-to-minus-infinity

```
delete(handle): decrease-key(handle, -∞); extract-min()
```

Both calls amortise to the same `O(log n)` as a direct delete — no need for a separate primitive.

---

## Graph Applications

```mermaid
graph TD
    A[Fibonacci heap] --> B[Dijkstra — O(E + V log V)]
    A --> C[Prim — O(E + V log V)]
    A --> D[Network simplex — improved by Tarjan's analyses]
    A --> E[All-pairs shortest path with reweighting — Johnson]
    A --> F[Edmonds' algorithm for MST in directed graphs]
```

For Dijkstra in a graph with `V = 10⁴, E = 10⁵`:

- Binary heap: `O((V + E) log V) ≈ 10⁶`
- Fibonacci heap: `O(E + V log V) ≈ 2.3 × 10⁵`

The Fibonacci version *should* be ~4× faster. In practice, the binary heap's constant factor wins and the Fibonacci version often ends up slower. Benchmarks routinely show Fibonacci heaps 2–10× slower than carefully tuned indexed binary heaps for sparse graphs.

---

## Dynamic Programming Integration

Fibonacci heaps are useful for DP only when transitions are reordered by an evolving key (state with a frequently updated bound). Examples:

- **Shortest-path DAGs with edge relaxations** — Dijkstra is itself a DP variant.
- **Online TSP approximations** — maintaining a frontier of partial tours.
- **Online minimum vertex cover** with edge weights changing.

For *static-cost* DP (knapsack, LCS, edit distance) a Fibonacci heap is a waste — there are no decrease-key operations.

---

## Code Examples

The teaching implementation in [`junior.md`](./junior.md) is enough to follow along. A *production* implementation differs in:

- **Node pooling** — bulk-allocate nodes from an arena to avoid `malloc` per insert.
- **Pre-sized consolidation array** — `log_φ(n_max) + 4` slots; reuse across calls.
- **Iterative `cascading_cut`** — recursion on a heap of size `10⁶` can hit Python's stack limit.
- **Handle stability** — guarantee the address of a node never moves so external callers' pointers remain valid.

#### Python — iterative cascading cut

```python
def _cascading_cut(self, y):
    while True:
        z = y.parent
        if z is None:
            return
        if not y.mark:
            y.mark = True
            return
        self._cut(y, z)
        y = z
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|----------------|------------------|
| `decrease_key` with a larger value | Invariant broken silently. | Raise; never proceed. |
| Handle reused after `extract_min` | Dangling pointer. | Set `handle.value = None` (or invalidate) on extract. |
| `meld` of a heap into itself | Infinite root list. | Reject in API. |
| Concurrent `decrease_key` from two threads | Cascading cuts collide. | Single mutex covers the whole heap. |
| Negative-zero keys (`-0.0` vs `0.0`) | Comparison can fail in some languages. | Normalise input to `+0.0`. |

---

## Performance Analysis

Empirical benchmark — Dijkstra on a graph with `V = 10⁵`, `E = 5 × 10⁵`, edge weights uniform in `[1, 100]`.

| Implementation | Wall time | Decrease-keys | Extract-mins |
|----------------|----------:|--------------:|-------------:|
| Indexed binary heap | 0.42 s | 480 k | 100 k |
| Pairing heap | 0.55 s | 480 k | 100 k |
| **Fibonacci heap** | 1.34 s | 480 k | 100 k |
| Lazy binary heap (duplicate pushes) | 0.31 s | 0 | 600 k |

The "lazy binary heap" pattern — skip the explicit decrease-key, push duplicates, ignore stale entries — wins because each operation touches a cache-warm contiguous array. The Fibonacci heap's pointer-chasing dominates.

#### Python micro-benchmark

```python
import random, time

def bench(heap_cls):
    h = heap_cls()
    handles = [h.insert(random.random()) for _ in range(100_000)]
    t0 = time.perf_counter()
    for hnd in random.sample(handles, 50_000):
        h.decrease_key(hnd, hnd.key * 0.5)
    while h.find_min():
        h.extract_min()
    return time.perf_counter() - t0
```

Run on `FibHeap` vs `IndexedBinaryHeap`. The binary version usually wins on Python by 2–4× even when the theoretical bound favours Fibonacci.

---

## Best Practices

- **Default to a binary heap.** Reach for Fibonacci only after a benchmark says otherwise.
- **Document amortised vs worst-case** at the top of your implementation.
- **Pool nodes** if you really must ship this in production.
- **Hide it behind an interface** so the rest of your code is unaware of the implementation.
- **Profile both decrease-key and extract-min** — Fibonacci can lose simply because extract-min is so much more expensive per call.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights the cascading-cut pattern: as you call `decrease-key` repeatedly, marked nodes flash, and a second cut triggers a chain promotion.

---

## Summary

Fibonacci heaps are a triumph of amortised analysis: deferring rebalancing and paying for it on `extract-min` brings down `decrease-key` to `O(1)` amortised. The constants and pointer overhead, however, almost always mean the simpler indexed binary heap wins on real workloads. Master the analysis here, but reach for it carefully.
