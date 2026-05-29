# Binomial Heap — Junior Level

> **One-line summary:** A binomial heap is a *forest* of binomial trees that supports `meld` (merge two heaps) in `O(log n)`. It is the first heap most students meet that breaks the "merge is `O(n)`" curse of binary heaps, and the structural ancestor of the Fibonacci heap.

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

The **binomial heap** was introduced by **Jean Vuillemin in 1978** as the first heap with `O(log n)` `meld`. It is one of the cleanest data structures in the priority-queue family: every operation reduces to a single principled idea — combining trees of equal degree — and the structure can be reasoned about with elementary binary arithmetic.

A binomial heap is **not a tree** — it is a **list of trees**, like the Fibonacci heap. Each tree obeys two rules:

1. **Heap-ordered** — every parent is at most as large as its children (min-heap).
2. **Binomial tree shape** — a binomial tree of rank `k`, called `B_k`, has exactly `2^k` nodes and is built by linking two `B_{k-1}` trees.

A binomial heap with `n` nodes contains a binomial tree `B_k` for each `1`-bit in the binary representation of `n`. For example, `n = 13 = 1101₂` means the heap holds trees `B_3`, `B_2`, `B_0` (sizes 8, 4, 1). The number of trees is therefore at most `⌈log₂(n+1)⌉` — proven below.

This bit-vector view is the conceptual key to the entire data structure:

```
insert(x):     create a new B_0; do a "binary increment" of the heap.
meld(h1, h2):  do a "binary addition" of the two heaps' bit-vectors.
extract-min:   the tree at the minimum root explodes into its children
               (which form a new heap); merge into the rest.
```

If you have ever implemented binary addition with carries, you have already implemented the core of a binomial heap.

---

## Prerequisites

- **Binary heap** — see [`../01-binary-heap/junior.md`](../01-binary-heap/junior.md).
- **Linked list** — singly-linked is enough.
- **Binary representation of integers** — the heap's structure mirrors the binary expansion of `n`.
- **Recursion / induction** — binomial trees are recursively defined.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Binomial tree `B_k`** | A heap-ordered tree of `2^k` nodes; height `k`; root has `k` children, themselves the roots of `B_{k-1}, B_{k-2}, …, B_0`. |
| **Rank / order** | The integer `k` for tree `B_k`. |
| **Binomial heap** | A list of binomial trees of distinct ranks, in increasing rank order. |
| **Root list** | The (singly-linked) list of tree roots. |
| **Link** | Combine two `B_k` trees into a `B_{k+1}` by making the larger-keyed root a child of the smaller. |
| **Meld / merge** | Combine two heaps; identical to binary addition over their rank bit-vectors. |
| **Coalesce / consolidate** | After meld, link adjacent trees of equal rank until each rank appears at most once. |
| **Sibling pointer** | Each node points to its right sibling in its parent's child list. |

---

## Core Concepts

### 1. The recursive binomial tree

```
B_0 = single node
B_k = link two B_{k-1} trees:
      root of one becomes a child of the other (smaller key wins the root).
```

Properties of `B_k`:

- Has exactly `2^k` nodes.
- Has height `k`.
- The root has `k` children, of ranks `k-1, k-2, …, 0` (in that order).
- The number of nodes at depth `i` is the binomial coefficient `C(k, i)` — hence the name.

### 2. The forest is a bit-vector

A binomial heap with `n` nodes has a `B_k` for each `1`-bit in `n`. Each rank appears at most once. So:

- `n = 1` → `{B_0}`.
- `n = 2` → `{B_1}`.
- `n = 3` → `{B_0, B_1}`.
- `n = 4` → `{B_2}`.
- `n = 5` → `{B_0, B_2}`.
- `n = 13` → `{B_0, B_2, B_3}`.

Therefore the number of trees is at most `⌊log₂ n⌋ + 1`.

### 3. Insert = binary increment

Create a one-node heap `{B_0}`. Meld it with the existing heap. If the existing heap already has a `B_0`, the two `B_0`s link to form `B_1` — a "carry." That carry can propagate further if the heap also has a `B_1`, and so on.

Cost: `O(log n)` worst case, `O(1)` amortised (just like binary increment).

### 4. Meld = binary addition

Walk the two heaps' root lists in rank order. At each rank:

- If only one heap has a tree of that rank, take it.
- If both have one, link them; carry to the next rank.
- If three are present (two originals + a carry), keep one and link the others.

Cost: `O(log n)`.

### 5. Extract-min = decompose + meld

Find the smallest root (linear scan over `O(log n)` roots), remove it, reverse its children to form a new heap, and meld that new heap into the rest.

Cost: `O(log n)`.

---

## Big-O Summary

| Operation | Time | Space |
|-----------|-----:|------:|
| `find-min` | O(log n) | O(1) |
| `insert` | O(log n) worst, **O(1) amortised** | O(1) |
| `meld` | **O(log n)** | O(1) |
| `extract-min` | O(log n) | O(1) |
| `decrease-key` (with handle) | O(log n) | O(1) |
| `delete` (with handle) | O(log n) | O(1) |

A few notes:

- `find-min` is `O(log n)`, not `O(1)`, because the min could be in any of the `O(log n)` tree roots. Most implementations cache a `min` pointer to make this `O(1)`.
- `insert`'s `O(1)` amortised comes from the same telescoping argument that proves `n` binary increments are `O(n)`.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Binomial tree `B_k` | A tournament bracket with `2^k` teams. The champion (root) won `k` rounds. |
| Linking two `B_k`s | Two champions face off; the loser becomes the new champion's first-round opponent in the larger bracket. |
| Insert as binary increment | Adding "1" to a binary number — carries cascade just like tree-links cascade. |
| Meld as binary addition | Adding two binary numbers — exactly the same carry behaviour. |
| Extract-min | The overall champion (smallest root) leaves; their `k` defeated opponents form `k` smaller brackets. |
| Root-list count = popcount(n) | Number of `1`-bits in `n` equals number of trees. |

---

## Pros & Cons

| Pros | Cons |
|------|------|
| `O(log n)` meld — first heap to break the `O(n)` barrier. | More complex than binary heap (linked trees, sibling pointers). |
| Insert is `O(1)` amortised — bulk inserts are linear total. | `find-min` requires scanning roots; cache a `min` pointer. |
| Beautiful binary-arithmetic structure — easy to reason about. | Cache-unfriendly: many small allocations, linked-list root list. |
| Foundation for Fibonacci heap and pairing heap. | Rarely implemented in production libraries; Boost has it under `binomial_heap`. |
| Easy to bound `extract-min` (at most `O(log n)` link operations). | Same `O(log n)` decrease-key as binary; no asymptotic advantage there. |

**When to use:**
- You need `meld` and `O(1)` amortised insert.
- You are studying heap data structures formally.
- You are implementing the Fibonacci heap and want a sanity check; the Fib heap is structurally similar but lazier.

**When NOT to use:**
- You only need a vanilla PQ — use a binary heap.
- Cache-bound performance matters more than meld — use binary or `d`-ary heap.

---

## Step-by-Step Walkthrough

Insert `1, 2, 3, 4, 5` one by one into an empty binomial heap.

```
insert 1: heap = {B_0(1)}                          n=1 = 001
insert 2: meld {B_0(1)} with {B_0(2)} → carry → {B_1(1,2)}    n=2 = 010
insert 3: meld {B_1(1,2)} with {B_0(3)}            n=3 = 011
        → no collision → heap = {B_0(3), B_1(1,2)}
insert 4: meld {B_0(3), B_1(1,2)} with {B_0(4)}    n=4 = 100
        → B_0+B_0 → B_1(3,4); B_1+B_1 → B_2(1,2,3,4)
        → heap = {B_2(1,...)}
insert 5: heap = {B_0(5), B_2(...)}                n=5 = 101
```

After 5 inserts, root list size = popcount(5) = 2 trees, total size 5. The binary expansion of `n` always equals the rank distribution.

---

## Code Examples

### Minimal Python binomial heap

```python
class BNode:
    __slots__ = ("key", "value", "degree", "parent", "child", "sibling")

    def __init__(self, key, value=None):
        self.key, self.value = key, value
        self.degree = 0
        self.parent = self.child = self.sibling = None


class BinomialHeap:
    def __init__(self):
        self.head = None

    def insert(self, key, value=None):
        node = BNode(key, value)
        tmp = BinomialHeap()
        tmp.head = node
        self.head = BinomialHeap._union(self, tmp).head

    def find_min(self):
        node, mn = self.head, None
        while node:
            if mn is None or node.key < mn.key:
                mn = node
            node = node.sibling
        return mn

    def extract_min(self):
        mn = self.find_min()
        if mn is None:
            return None
        # detach mn from the root list
        prev, cur = None, self.head
        while cur is not mn:
            prev, cur = cur, cur.sibling
        if prev:
            prev.sibling = cur.sibling
        else:
            self.head = cur.sibling
        # reverse children to form a new heap, then meld
        child, prev_c = mn.child, None
        while child:
            nxt = child.sibling
            child.sibling = prev_c
            child.parent = None
            prev_c = child
            child = nxt
        new_h = BinomialHeap(); new_h.head = prev_c
        self.head = BinomialHeap._union(self, new_h).head
        return mn

    def meld(self, other):
        self.head = BinomialHeap._union(self, other).head

    # ---------- helpers ----------
    @staticmethod
    def _link(y, z):
        """Make tree y a child of tree z. Both have the same degree."""
        y.parent = z
        y.sibling = z.child
        z.child = y
        z.degree += 1

    @staticmethod
    def _merge(h1, h2):
        """Merge two root lists by ascending degree."""
        dummy = BNode(0); tail = dummy
        a, b = h1.head, h2.head
        while a and b:
            if a.degree <= b.degree:
                tail.sibling = a; a = a.sibling
            else:
                tail.sibling = b; b = b.sibling
            tail = tail.sibling
        tail.sibling = a or b
        out = BinomialHeap(); out.head = dummy.sibling
        return out

    @staticmethod
    def _union(h1, h2):
        out = BinomialHeap._merge(h1, h2)
        if out.head is None:
            return out
        prev, cur, nxt = None, out.head, out.head.sibling
        while nxt:
            if cur.degree != nxt.degree or (nxt.sibling and nxt.sibling.degree == cur.degree):
                prev, cur = cur, nxt
            elif cur.key <= nxt.key:
                cur.sibling = nxt.sibling
                BinomialHeap._link(nxt, cur)
            else:
                if prev is None:
                    out.head = nxt
                else:
                    prev.sibling = nxt
                BinomialHeap._link(cur, nxt)
                cur = nxt
            nxt = cur.sibling
        return out


if __name__ == "__main__":
    h = BinomialHeap()
    for x in [5, 3, 8, 1, 9, 2, 7]:
        h.insert(x)
    while h.head:
        print(h.extract_min().key)
    # 1 2 3 5 7 8 9
```

The Go and Java versions translate this almost line-for-line. Below is a Go skeleton showing the structural fields; fill in the helpers identically:

```go
type bNode struct {
    Key     int
    Value   interface{}
    Degree  int
    Parent  *bNode
    Child   *bNode
    Sibling *bNode
}

type BinomialHeap struct {
    Head *bNode
}

func (h *BinomialHeap) Insert(key int, val interface{}) { /* ... */ }
func (h *BinomialHeap) FindMin() *bNode                 { /* ... */ }
func (h *BinomialHeap) ExtractMin() *bNode              { /* ... */ }
func (h *BinomialHeap) Meld(o *BinomialHeap)            { /* ... */ }
```

```java
class BNode {
    int key; Object value; int degree;
    BNode parent, child, sibling;
    BNode(int k, Object v) { key = k; value = v; }
}

public class BinomialHeap {
    BNode head;
    public void insert(int key, Object value) { /* ... */ }
    public BNode findMin() { /* ... */ }
    public BNode extractMin() { /* ... */ }
    public void meld(BinomialHeap other) { /* ... */ }
}
```

**Run:** `python binomial_heap.py` for the working version. The Go/Java skeletons mirror the Python logic; the full source lives in [`tasks.md`](./tasks.md).

---

## Coding Patterns

### Pattern 1: Bulk insert

`O(n)` total for `n` inserts because each insert is `O(1)` amortised. Useful when you have all items up front and need a heap.

### Pattern 2: Fast meld for k-way merge

Build `k` small binomial heaps from `k` streams and meld them in pairs, doubling-tournament style. Total work: `O(N log k)` for `N` items — the same as a binary-heap k-way merge but with simpler bookkeeping.

### Pattern 3: Linking forest of heaps

A "forest of binomial heaps" data structure represents a *dynamic* multiset under repeated merge operations. Used in some union-find variants and offline LCA.

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Two trees of same degree linked in wrong order | Forgot the smaller-key wins rule. | Always `if y.key < z.key: link(z, y) else: link(y, z)`. |
| Sibling pointer cycle after meld | Forgot to terminate one of the input lists. | `tail.sibling = a or b` at end of `_merge`. |
| `extract_min` returns same node twice | Forgot to detach from root list. | Set `head = ...` or `prev.sibling = cur.sibling`. |
| Child list not reversed | `extract_min` produces a non-sorted root order. | Reverse before meld; ranks must be ascending in the root list. |

---

## Performance Tips

- Cache a `min` pointer so `find_min` is `O(1)`.
- Allocate nodes from a pool; per-node `malloc` dominates cost in microbenchmarks.
- Don't use it as a generic PQ — a binary heap is faster.

---

## Best Practices

- Implement `union` once and reuse it from `insert`, `meld`, and `extract_min`.
- Add an invariant check in tests: degrees in the root list are strictly increasing.
- Add a popcount check: `len(root_list) == bin(n).count("1")`.
- Wrap behind a PQ interface so you can swap implementations for benchmarks.

---

## Edge Cases & Pitfalls

- **Empty heap** — `find_min` returns null; `extract_min` returns null; `meld` with empty is a no-op.
- **Single node** — `extract_min` empties the heap; reversal of an empty child list returns null.
- **Both heaps share a degree-0 tree** — they link; this triggers the carry behaviour.
- **`n` is a power of 2** — exactly one tree in the heap; root list size = 1.

---

## Common Mistakes

1. Linking by *insertion order* instead of *key comparison* — breaks heap order.
2. Forgetting to clear `parent` on extracted children — confuses `decrease_key` later.
3. Not reversing the extracted children's sibling list — breaks the ascending-degree invariant.
4. Comparing degrees with `<` instead of `==` in `_union` — fails to link some pairs.
5. Hand-iterating the root list with stale `nxt` after a link — the helper handles this; don't bypass it.

---

## Cheat Sheet

| Operation | Cost | Idea |
|-----------|-----:|------|
| `find_min` | O(log n) (O(1) with min cache) | Scan roots. |
| `insert` | O(log n) worst / **O(1) amortised** | Binary-increment. |
| `meld` | **O(log n)** | Binary addition. |
| `extract_min` | O(log n) | Detach + reverse children + meld. |
| `decrease_key` | O(log n) | Sift up using parent pointers. |
| `delete` | O(log n) | `decrease_key` to −∞ + `extract_min`. |

```
B_k has 2^k nodes, height k, root degree k.
#trees in heap of size n = popcount(n) ≤ ⌊log₂ n⌋ + 1.
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view of inserts cascading like binary increments, melds working like binary addition, and `extract-min` decomposing a tree into a fresh heap.

---

## Summary

A binomial heap is a forest of binomial trees indexed by the binary representation of its size. Every operation reduces to merging two forests by binary arithmetic. The structure unlocks `O(log n)` meld and `O(1)` amortised insert — both impossible with a plain binary heap — and it is the conceptual ancestor of Fibonacci, pairing, and rank-pairing heaps.

---

## Further Reading

- Vuillemin, *A Data Structure for Manipulating Priority Queues*, CACM 1978.
- *Introduction to Algorithms* (CLRS), Chapter 19 (older editions; moved to online supplements in newer editions).
- Boost C++ Libraries — `boost::heap::binomial_heap`.
- Sedgewick & Wayne, *Algorithms*, §2.4 — concise treatment.
