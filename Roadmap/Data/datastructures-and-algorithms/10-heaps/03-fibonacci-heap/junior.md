# Fibonacci Heap — Junior Level

> **One-line summary:** A Fibonacci heap is a meldable priority queue that achieves `O(1)` *amortised* time for `insert`, `meld`, `find-min`, and `decrease-key`, paying for it with a single `O(log n)` `extract-min`. It is the asymptotically optimal heap for graph algorithms like Dijkstra and Prim — but its constant factors are so large that pairing heaps and indexed binary heaps usually beat it in practice.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Why It Beats Binary Heap on Paper](#why-it-beats-binary-heap-on-paper)
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

The **Fibonacci heap** was introduced by Michael L. Fredman and Robert E. Tarjan in their 1984 paper *"Fibonacci Heaps and Their Uses in Improved Network Optimization Algorithms"* (Tarjan won a Turing Award in part for this work). It is one of the most famous data structures in computer science precisely because it answers a single very specific question:

> Can we make `decrease-key` faster than `O(log n)` for a meldable priority queue?

A binary heap can't — it has to bubble the changed element up to its place, paying `O(log n)`. The Fibonacci heap *defers* almost all rebalancing work and pays for it only when you `extract-min`. The result: `insert`, `meld`, `find-min`, and `decrease-key` all run in `O(1)` *amortised* time, while `extract-min` and arbitrary `delete` run in `O(log n)` *amortised*.

This unlocked tighter bounds for many graph algorithms:

| Algorithm | Binary heap | Fibonacci heap |
|-----------|-------------|----------------|
| Dijkstra | `O((V + E) log V)` | `O(E + V log V)` |
| Prim's MST | `O(E log V)` | `O(E + V log V)` |

On sparse graphs (`E ≈ V`) both are roughly the same. On dense graphs (`E ≈ V²`) the Fibonacci version is asymptotically better. But asymptotic and practical are not the same thing — and that gap is exactly why this data structure is famous to read about but rare to deploy.

At junior level you should be able to:

1. Explain *what* it is — a forest of heap-ordered trees.
2. Recognise *why* it matters — the `O(1)` decrease-key.
3. Identify *when* it is the right tool — almost never in production, often in coursework and contests.

---

## Prerequisites

- **Binary heap** — see [`../01-binary-heap/junior.md`](../01-binary-heap/junior.md).
- **Linked list** — circular doubly-linked lists are everywhere in this structure.
- **Amortised analysis** — the basic idea of "average cost over a sequence of operations." A formal treatment lives in [`professional.md`](./professional.md).
- **Graph algorithms** that use a PQ — Dijkstra and Prim — to appreciate the motivation.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Fibonacci heap** | A meldable PQ that maintains a forest of trees with a lazy structure. |
| **Root list** | The circular doubly-linked list of all tree roots. |
| **min pointer** | A direct pointer to the smallest-key root, giving `O(1)` `find-min`. |
| **Tree degree** | The number of children of a node. |
| **Marked node** | A node whose first child has been cut. A second cut triggers a "cascading cut." |
| **Cascading cut** | When a marked node loses another child, it too is cut from its parent and becomes a root. |
| **Lazy meld** | Concatenate two root lists in `O(1)`; no consolidation. |
| **Consolidation** | The cleanup step inside `extract-min` that links roots of equal degree until at most one root per degree remains. |
| **Potential function** | Φ = (#roots) + 2 × (#marked nodes). Used in amortised analysis. |
| **Tarjan's link constraint** | A node of degree `k` must have at least `F_{k+2}` descendants — hence the name "Fibonacci." |

---

## Core Concepts

### 1. A forest, not a single tree

A Fibonacci heap is not one tree — it is a **list of trees**, each obeying the heap property internally. The `min` pointer keeps the global minimum reachable in `O(1)`.

```
       min
        ↓
  3 — 8 — 5 — 11 — 2          (root list, circular doubly-linked)
  |       |        \
  7       9         4 — 6
  |
  12
```

Every node has pointers to: parent, left sibling, right sibling, first child, plus a degree counter and a "marked" boolean.

### 2. Lazy insert and meld

Both `insert(x)` and `meld(h1, h2)` just splice into the root list. No restructuring, no rebalancing. That's where the `O(1)` comes from — you defer work.

```
insert(x):  add x to root list; update min if needed
meld(h1,h2): concatenate root lists; min = min(h1.min, h2.min)
```

### 3. decrease-key by cutting

When a node `x`'s key drops below its parent's, you **cut** `x` from its parent and move it to the root list — no sift-up. If `x`'s parent was already *marked*, you cut the parent too (cascading cut). Marking captures the idea "this node has already lost one child; if it loses another, the structure is degrading and we should rebalance now."

The cascading-cut bound is what guarantees a node of degree `k` retains `F_{k+2}` descendants — the **Fibonacci** numbers, hence the name.

### 4. extract-min: the only expensive operation

Three steps:

1. Remove the min root; promote its children to roots.
2. **Consolidate** — repeatedly link roots of equal degree until at most one per degree remains.
3. Walk the root list to find the new min.

Consolidation uses an auxiliary array indexed by degree. After consolidation the root list has at most `log_φ(n) ≈ 1.44 log₂ n` trees.

### 5. Why it works (intuitive)

You spend `O(1)` on every cheap op but accumulate "debt" in the root list and the marked set. The potential function Φ = (#roots) + 2 × (#marked) tracks that debt. When `extract-min` finally consolidates, the work done is paid for by the drop in Φ. The amortised cost balances out.

---

## Big-O Summary

| Operation | Amortised | Worst case |
|-----------|----------:|-----------:|
| `insert` | **O(1)** | O(1) |
| `meld` | **O(1)** | O(1) |
| `find-min` | **O(1)** | O(1) |
| `decrease-key` | **O(1)** | O(log n) |
| `extract-min` | O(log n) | O(n) |
| `delete` | O(log n) | O(n) |

The worst-case `O(n)` for a single `extract-min` happens when the root list is already huge from many lazy inserts; consolidation has to merge them all. Over a sequence it averages back down to `O(log n)`.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Root list | A messy desk: papers piled in arbitrary order. The most urgent one is on top (the min pointer). |
| Lazy insert | Tossing a new paper onto the desk without sorting. |
| Cascading cut | When two stacks have collapsed onto a folder, you take the whole folder out and start over with a clean group. |
| Consolidation | When you finally need to file everything, you group same-sized stacks and combine them once. |
| Decrease-key by cut | Promoting an item directly to "needs attention now" instead of walking it up through a hierarchy. |

The analogy breaks down on amortisation: real desks don't have a potential function that tracks how much filing you owe.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| `O(1)` amortised decrease-key and insert — best known for many graph algorithms. | Constants are so large that pairing heaps usually beat it in practice. |
| `O(1)` meld — competitive with leftist/pairing heaps. | Each node carries 6+ pointers and flags; high memory overhead. |
| Asymptotically optimal: Dijkstra in `O(E + V log V)`. | Implementation is notoriously bug-prone (cascading cuts, marked flags, consolidation array). |
| Beautiful, instructive amortised analysis. | Cache performance is poor — many small allocations, random pointer chasing. |
| Reference data structure in many algorithm courses. | Almost no production system ships it (Boost Graph Library does, optionally; most do not). |

**When to use:** algorithm theory, contests that allow it, situations where decrease-key dominates and you've measured Fibonacci heap winning. **When NOT to use:** anywhere a binary or pairing heap is fast enough — which is almost always.

---

## Why It Beats Binary Heap on Paper

In Dijkstra you do `O(V)` `extract-min`s and up to `O(E)` `decrease-key`s.

```
Binary heap:  V·O(log V) + E·O(log V)  =  O((V + E) log V)
Fibonacci:    V·O(log V) + E·O(1)      =  O(E + V log V)
```

When `E = Ω(V log V)` the Fibonacci version saves a logarithmic factor. For dense graphs that is real. For sparse graphs (`E ≈ V`) it is essentially the same.

---

## Code Examples

A textbook Fibonacci heap implementation is several hundred lines. Below is a minimal *teaching* version that supports `insert`, `min`, `extract_min`, and `decrease_key`. Read it once, understand the lazy-insert idea, then in production always reach for a library or a binary heap.

### Example: Minimal Fibonacci heap

#### Python

```python
import math

class FibNode:
    __slots__ = ("key", "value", "parent", "child", "left", "right", "degree", "mark")

    def __init__(self, key, value=None):
        self.key, self.value = key, value
        self.parent = self.child = None
        self.left = self.right = self        # circular self-loop
        self.degree = 0
        self.mark = False


class FibHeap:
    def __init__(self):
        self.min = None
        self.n = 0

    def insert(self, key, value=None):
        node = FibNode(key, value)
        self._add_to_root(node)
        if self.min is None or key < self.min.key:
            self.min = node
        self.n += 1
        return node

    def find_min(self):
        return None if self.min is None else (self.min.key, self.min.value)

    def extract_min(self):
        z = self.min
        if z is None:
            return None
        # Promote z's children to root list.
        if z.child:
            children = list(self._siblings(z.child))
            for c in children:
                c.parent = None
                self._add_to_root(c)
        # Remove z from root list.
        z.left.right, z.right.left = z.right, z.left
        if z is z.right:
            self.min = None
        else:
            self.min = z.right
            self._consolidate()
        self.n -= 1
        return z.key, z.value

    def decrease_key(self, node, new_key):
        if new_key > node.key:
            raise ValueError("new key is larger")
        node.key = new_key
        parent = node.parent
        if parent and node.key < parent.key:
            self._cut(node, parent)
            self._cascading_cut(parent)
        if node.key < self.min.key:
            self.min = node

    # ----- helpers -----
    def _siblings(self, start):
        node = start
        while True:
            yield node
            node = node.right
            if node is start:
                return

    def _add_to_root(self, node):
        node.parent = None
        if self.min is None:
            node.left = node.right = node
        else:
            node.left = self.min
            node.right = self.min.right
            self.min.right.left = node
            self.min.right = node

    def _link(self, y, x):
        # remove y from root list
        y.left.right, y.right.left = y.right, y.left
        # make y a child of x
        y.parent = x
        y.left = y.right = y
        if x.child is None:
            x.child = y
        else:
            y.left = x.child
            y.right = x.child.right
            x.child.right.left = y
            x.child.right = y
        x.degree += 1
        y.mark = False

    def _consolidate(self):
        max_deg = int(math.log2(self.n) * 2) + 2
        a = [None] * max_deg
        roots = list(self._siblings(self.min))
        for w in roots:
            x, d = w, w.degree
            while a[d]:
                y = a[d]
                if y.key < x.key:
                    x, y = y, x
                self._link(y, x)
                a[d] = None
                d += 1
            a[d] = x
        self.min = None
        for node in a:
            if node:
                if self.min is None:
                    node.left = node.right = node
                    self.min = node
                else:
                    self._add_to_root(node)
                    if node.key < self.min.key:
                        self.min = node

    def _cut(self, node, parent):
        # remove node from parent's child list
        if node.right is node:
            parent.child = None
        else:
            node.left.right, node.right.left = node.right, node.left
            if parent.child is node:
                parent.child = node.right
        parent.degree -= 1
        self._add_to_root(node)
        node.mark = False

    def _cascading_cut(self, y):
        z = y.parent
        if z:
            if not y.mark:
                y.mark = True
            else:
                self._cut(y, z)
                self._cascading_cut(z)


if __name__ == "__main__":
    h = FibHeap()
    a = h.insert(5, "a")
    b = h.insert(3, "b")
    c = h.insert(8, "c")
    h.decrease_key(c, 1)
    print(h.extract_min())  # (1, 'c')
    print(h.extract_min())  # (3, 'b')
    print(h.extract_min())  # (5, 'a')
```

#### Go

```go
// A teaching-grade Fibonacci heap. See the Python source for the same algorithm
// commented in full; the Go translation reproduces the structure faithfully.
package main

import (
    "fmt"
    "math"
)

type FibNode struct {
    Key    int
    Value  interface{}
    Parent *FibNode
    Child  *FibNode
    Left   *FibNode
    Right  *FibNode
    Degree int
    Mark   bool
}

type FibHeap struct {
    Min *FibNode
    N   int
}

func New() *FibHeap { return &FibHeap{} }

func (h *FibHeap) Insert(key int, val interface{}) *FibNode {
    n := &FibNode{Key: key, Value: val}
    n.Left, n.Right = n, n
    h.addToRoot(n)
    if h.Min == nil || key < h.Min.Key {
        h.Min = n
    }
    h.N++
    return n
}

func (h *FibHeap) FindMin() *FibNode { return h.Min }

func (h *FibHeap) ExtractMin() *FibNode {
    z := h.Min
    if z == nil {
        return nil
    }
    if z.Child != nil {
        c := z.Child
        for {
            next := c.Right
            c.Parent = nil
            h.addToRoot(c)
            if next == z.Child {
                break
            }
            c = next
        }
    }
    z.Left.Right = z.Right
    z.Right.Left = z.Left
    if z == z.Right {
        h.Min = nil
    } else {
        h.Min = z.Right
        h.consolidate()
    }
    h.N--
    return z
}

func (h *FibHeap) addToRoot(n *FibNode) {
    n.Parent = nil
    if h.Min == nil {
        n.Left, n.Right = n, n
        return
    }
    n.Left = h.Min
    n.Right = h.Min.Right
    h.Min.Right.Left = n
    h.Min.Right = n
}

func (h *FibHeap) link(y, x *FibNode) {
    y.Left.Right = y.Right
    y.Right.Left = y.Left
    y.Parent = x
    y.Left, y.Right = y, y
    if x.Child == nil {
        x.Child = y
    } else {
        y.Left = x.Child
        y.Right = x.Child.Right
        x.Child.Right.Left = y
        x.Child.Right = y
    }
    x.Degree++
    y.Mark = false
}

func (h *FibHeap) consolidate() {
    maxDeg := int(math.Log2(float64(h.N))*2) + 2
    a := make([]*FibNode, maxDeg)
    roots := []*FibNode{}
    cur := h.Min
    if cur != nil {
        for {
            roots = append(roots, cur)
            cur = cur.Right
            if cur == h.Min {
                break
            }
        }
    }
    for _, w := range roots {
        x, d := w, w.Degree
        for a[d] != nil {
            y := a[d]
            if y.Key < x.Key {
                x, y = y, x
            }
            h.link(y, x)
            a[d] = nil
            d++
        }
        a[d] = x
    }
    h.Min = nil
    for _, n := range a {
        if n == nil {
            continue
        }
        if h.Min == nil {
            n.Left, n.Right = n, n
            h.Min = n
        } else {
            h.addToRoot(n)
            if n.Key < h.Min.Key {
                h.Min = n
            }
        }
    }
}

func main() {
    h := New()
    h.Insert(5, "a")
    h.Insert(3, "b")
    h.Insert(8, "c")
    fmt.Println(h.ExtractMin().Key, h.ExtractMin().Key, h.ExtractMin().Key)
    // 3 5 8
}
```

#### Java

```java
// Teaching-grade Fibonacci heap. See Python for full comments.
public class FibHeap {
    static class Node {
        int key;
        Object value;
        Node parent, child, left, right;
        int degree;
        boolean mark;
        Node(int k, Object v) { key = k; value = v; left = right = this; }
    }

    Node min;
    int n;

    public Node insert(int key, Object value) {
        Node node = new Node(key, value);
        addToRoot(node);
        if (min == null || key < min.key) min = node;
        n++;
        return node;
    }

    public Node findMin() { return min; }

    public Node extractMin() {
        Node z = min;
        if (z == null) return null;
        if (z.child != null) {
            Node c = z.child;
            while (true) {
                Node next = c.right;
                c.parent = null;
                addToRoot(c);
                if (next == z.child) break;
                c = next;
            }
        }
        z.left.right = z.right;
        z.right.left = z.left;
        if (z == z.right) {
            min = null;
        } else {
            min = z.right;
            consolidate();
        }
        n--;
        return z;
    }

    private void addToRoot(Node x) {
        x.parent = null;
        if (min == null) {
            x.left = x.right = x;
            return;
        }
        x.left = min;
        x.right = min.right;
        min.right.left = x;
        min.right = x;
    }

    private void link(Node y, Node x) {
        y.left.right = y.right;
        y.right.left = y.left;
        y.parent = x;
        y.left = y.right = y;
        if (x.child == null) x.child = y;
        else {
            y.left = x.child;
            y.right = x.child.right;
            x.child.right.left = y;
            x.child.right = y;
        }
        x.degree++;
        y.mark = false;
    }

    private void consolidate() {
        int maxDeg = (int)(Math.log(n) / Math.log(2) * 2) + 2;
        Node[] a = new Node[maxDeg];
        java.util.List<Node> roots = new java.util.ArrayList<>();
        Node cur = min;
        do { roots.add(cur); cur = cur.right; } while (cur != min);
        for (Node w : roots) {
            Node x = w; int d = x.degree;
            while (a[d] != null) {
                Node y = a[d];
                if (y.key < x.key) { Node t = x; x = y; y = t; }
                link(y, x);
                a[d] = null;
                d++;
            }
            a[d] = x;
        }
        min = null;
        for (Node m : a) {
            if (m == null) continue;
            if (min == null) { m.left = m.right = m; min = m; }
            else { addToRoot(m); if (m.key < min.key) min = m; }
        }
    }
}
```

---

## Coding Patterns

### Pattern 1: Dijkstra with `O(1)` decrease-key

```
For each unsettled vertex, keep a handle returned from `insert`.
On relaxation, call `decrease_key(handle, new_dist)`.
```

In Python the `FibHeap.insert` above returns a `FibNode` — that's the handle.

### Pattern 2: Online tournament

A streaming "best of so far" reporter that wants `O(1)` insert and `O(1)` find-min. Fibonacci is competitive with binary heap here, with the advantage of `O(1)` meld for combining streams.

### Pattern 3: Avoid in practice

Honestly the most common pattern when you reach for a Fibonacci heap is to *not* — fall back to a binary heap or pairing heap and verify your benchmark first. Fibonacci heaps are taught primarily as an analysis tool, not a tool you reach for.

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| `decrease_key` raises "new key is larger" | Programmer error. | Never call `decrease_key` with an equal or larger value. |
| `extract_min` returns `None` repeatedly | Heap is empty. | Check `find_min()` first. |
| Cascading cut corrupts the root list | Forgot to clear `mark` after promotion. | Always set `node.mark = false` when adding to root. |
| Infinite loop in `consolidate` | Sibling pointers broken. | Always restore `node.left = node.right = node` when isolating. |

---

## Performance Tips

- **Don't.** Use a binary heap or a pairing heap unless your profile says otherwise.
- If you must, allocate nodes from a pool; the per-node `malloc` is the dominant cost.
- Pre-size the consolidation array based on `log_φ(n)` rather than recomputing on every `extract_min`.

---

## Best Practices

- Document `decrease_key` semantics next to the `insert` signature — the handle return is non-obvious.
- Wrap the structure behind an interface so you can swap in a binary heap to compare.
- Validate the invariant in tests: after each op, every parent dominates its children and every marked node has had exactly one child cut.

---

## Edge Cases & Pitfalls

- **Empty heap** — `extract_min` and `decrease_key` must guard against `min == None`.
- **Single element** — `extract_min` simply nulls out `min`.
- **Equal keys** — perfectly fine; order between equals is unspecified.
- **Inserting `n` elements without an extract** — `extract_min` pays for the consolidation; first one is `O(n)` worst case.
- **Marked node becomes root** — always clear `mark` when promoting.

---

## Common Mistakes

1. Implementing `decrease_key` by sifting up — that defeats the entire purpose; you've reinvented a binary heap.
2. Forgetting cascading cut — accuracy holds but amortised bound silently regresses to `O(log n)`.
3. Maintaining a hash map from key to node — keys can repeat, mapping should be from *handle* to node.
4. Not zeroing the `mark` field when promoting a node — corrupts later cascades.
5. Sharing nodes across threads without locking — invariants break in races.

---

## Cheat Sheet

| Operation | Amortised | Notes |
|-----------|----------:|-------|
| `insert` | O(1) | Splice into root list. |
| `meld` | O(1) | Concatenate two root lists. |
| `find-min` | O(1) | Single pointer. |
| `decrease-key` | O(1) | Cut + cascading cut. |
| `extract-min` | O(log n) | Consolidate by degree. |
| `delete` | O(log n) | `decrease-key` to −∞, then `extract-min`. |

Potential function: `Φ = #roots + 2 × #marked`.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view of:
> - lazy `insert` and the growing root list,
> - `decrease-key` with cascading cuts,
> - `extract-min` consolidation by degree.

---

## Summary

The Fibonacci heap is the asymptotically-best meldable priority queue for graph algorithms — `O(1)` amortised for everything except `extract-min`. It earns its name from the Fibonacci-like growth bound on node descendants under cascading cuts, and it earns its reputation as the textbook answer to "can decrease-key be faster than `log n`?" Just don't expect it to beat a humble binary heap in your benchmark unless your decrease-key load is enormous.

---

## Further Reading

- Fredman & Tarjan, *Fibonacci Heaps and Their Uses in Improved Network Optimization Algorithms*, JACM 34(3), 1987.
- *Introduction to Algorithms* (CLRS), Chapter 19 — Fibonacci heaps.
- Knuth, *TAOCP Vol. 3*, §5.2.3 — heap origins, plus exercises that motivate Fibonacci.
- Boost Graph Library — `fibonacci_heap` source code.
- Tarjan's amortised analysis lecture notes (Princeton).
