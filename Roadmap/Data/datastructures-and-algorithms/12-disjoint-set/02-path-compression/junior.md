# Path Compression — Junior Level

> **One-line summary:** Path compression is the Find-side optimization of a Disjoint Set (Union-Find): while walking from a node up to its root, you re-point the nodes you touch directly (or closer) to the root, so the tree gets flatter and every future `find` on those nodes is much faster.

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

A **Disjoint Set** (Union-Find) keeps a collection of elements partitioned into groups. Each group is a tree, and each tree is identified by its **root** — the *representative* of the group. Two operations matter:

- **`find(x)`** — follow `parent[x]` pointers upward until you reach the root, and return that root.
- **`union(a, b)`** — link the root of `a`'s tree to the root of `b`'s tree, merging the two groups.

The basic structure (covered in the sibling topic `01-union-find`) already works. But there is a problem hiding in `find`. If your unions build a long, skinny chain — `0 → 1 → 2 → 3 → ... → n` — then a single `find(0)` has to walk the *entire* chain to reach the root. That is `O(n)` per call. Do it a million times and you have an `O(n²)` disaster.

**Path compression** fixes this with one simple idea: *every time you walk a path to the root, flatten it.* Re-point the nodes you visited so they hang directly off the root (or at least closer to it). The first `find` still pays the full walk, but every later `find` on those nodes is nearly instant — they now point straight at the root.

This single optimization turns Union-Find from a slow structure into one of the fastest data structures in all of computer science. Combined with **union by rank/size** (the sibling topic `03-union-by-rank`), the amortized cost per operation becomes `O(α(n))` — the inverse Ackermann function — which is less than 5 for any input that fits in the observable universe. Effectively constant.

In this file we focus on the **Find side**: the three classic ways to compress, with full code in Go, Java, and Python.

---

## Prerequisites

Before you read this file you should be comfortable with:

- **Arrays and zero-based indexing** — the DSU is stored as a `parent[]` array.
- **The basic Disjoint Set** — `find` and `union` without optimizations (`01-union-find`).
- **Recursion basics** — full path compression is naturally recursive.
- **Loops and `while` conditions** — path halving and splitting are iterative.
- **Big-O notation** — `O(n)`, `O(log n)`, and the idea of *amortized* cost.

Optional but helpful:

- The idea of a **tree drawn with the root at the top** (here we draw roots on top, children below).
- The notion of a **self-loop**: a root is its own parent, `parent[root] == root`.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Disjoint Set / Union-Find / DSU** | A structure that maintains a partition of elements into groups, each group a tree. |
| **`parent[]`** | The array where `parent[x]` is the node directly above `x`. For a root, `parent[root] == root`. |
| **Root / representative** | The top of a tree; the unique node `r` with `parent[r] == r`. Identifies the whole group. |
| **`find(x)`** | Returns the root of `x`'s tree by following parents upward. |
| **`union(a, b)`** | Links the root of one tree under the root of the other. |
| **Path** | The sequence of nodes from `x` up to its root: `x, parent[x], parent[parent[x]], …, root`. |
| **Path compression** | Re-pointing nodes on the find-path closer to (or directly to) the root, flattening the tree. |
| **Full path compression** | Re-point *every* node on the path directly to the root (two-pass, or the recursive one-liner). |
| **Path halving** | During the walk, point each node to its **grandparent**, halving the path length. Single pass. |
| **Path splitting** | Like halving but also advance one node each step; points each node to its grandparent. Single pass. |
| **Rank / size** | A per-root tag used by union-by-rank/size to decide which tree hangs under which. |
| **α(n)** | The inverse Ackermann function — grows so slowly it is ≤ 5 for all practical `n`. |
| **Amortized cost** | Average cost per operation over a long sequence, even if a single op is occasionally expensive. |

---

## Core Concepts

### 1. The problem: naive `find` walks the whole path

A Disjoint Set is an array `parent[]`. A root points to itself. `find` walks up:

```
find(x):
    while parent[x] != x:
        x = parent[x]
    return x
```

If a tree is a long chain, this walk is `O(height)`. With arbitrary union and no compression, the height can grow to `O(n)`:

```
Chain after a bad sequence of unions:

    4          (root, parent[4]=4)
    |
    3          (parent[3]=4)
    |
    2          (parent[2]=3)
    |
    1          (parent[1]=2)
    |
    0          (parent[0]=1)

find(0) visits 0 → 1 → 2 → 3 → 4 : five hops.
```

Every `find(0)` pays the full walk. That is the cost we want to kill.

### 2. Full path compression (the recursive one-liner)

The cleanest version. As recursion unwinds, set each visited node's parent to the returned root:

```
find(x):
    if parent[x] != x:
        parent[x] = find(parent[x])   # re-point x straight to the root
    return parent[x]
```

After `find(0)` on the chain above, **every** node on the path now points directly at `4`:

```
        4               (root)
      / | | \
     0  1 2  3          all hang directly off the root now
```

One `find` flattened the whole path. This is **two-pass** in spirit: the recursion goes up to find the root (pass 1), then unwinds re-pointing every node (pass 2).

### 3. Path halving (single pass, iterative)

Recursion can be elegant but on a chain of a million nodes it can **overflow the call stack**. Path halving avoids recursion entirely. As you walk up, point each node to its **grandparent**, then jump to that grandparent:

```
find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]   # skip a generation
        x = parent[x]
    return x
```

Each step the path length is roughly **halved**. No stack, no recursion, one pass. The tree is not perfectly flat after one call, but it gets flat fast over repeated calls — and the asymptotics are identical to full compression.

### 4. Path splitting (single pass, iterative)

Almost the same as halving, but you re-point a node and then advance to the node's **old** parent, not the new one:

```
find(x):
    while parent[x] != x:
        next = parent[x]
        parent[x] = parent[parent[x]]   # x now points to its grandparent
        x = next                        # advance to the OLD parent
    return x
```

The difference is subtle: halving re-points every *other* node on the path; splitting re-points *every* node to its grandparent. Both are single-pass, both flatten the tree, both give the same `O(α(n))` when combined with union by rank.

### 5. They are all the same asymptotically

| Variant | Passes | Recursion? | What each node ends up pointing to |
|---------|--------|------------|------------------------------------|
| Full compression | two (recursion up, re-point down) | yes (or explicit two loops) | the root, exactly |
| Path halving | one | no | its former grandparent (every other node) |
| Path splitting | one | no | its former grandparent (every node) |

All three give amortized `O(α(n))` per operation **when paired with union by rank/size**. Path compression *alone* (with arbitrary union) gives amortized `O(log n)` — still a massive win over `O(n)`. Use halving or splitting in production to dodge stack overflow.

---

## Big-O Summary

| Scenario | `find` cost | Notes |
|----------|-------------|-------|
| Naive `find`, no compression, arbitrary union | **O(n)** worst case | A chain forces a full walk. |
| Path compression **alone**, arbitrary union | **O(log n)** amortized | Flattening pays off over many finds. |
| Compression + union by rank/size | **O(α(n))** amortized | Tarjan 1975; effectively constant (α ≤ 5). |
| First `find` after building a deep tree | up to **O(height)** | You still pay once to walk, then flatten. |
| `find` on an already-flat node | **O(1)** | Node points straight at the root. |
| Space | **O(n)** | One `parent[]` array (plus optional `rank[]`). |

> The amortized proofs live in [`professional.md`](./professional.md). The `O(α(n))` bound for the *combination* with union by rank is detailed in the sibling `03-union-by-rank`.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Naive find on a chain | Asking "who is the CEO?" by asking your boss, who asks *their* boss, all the way up a 10-level org chart. Every single employee re-walks the whole ladder. |
| Full path compression | After you finally learn the CEO's name, you tell *everyone you passed* on the way up: "the CEO is Dana." Next time any of them is asked, they answer instantly. |
| Path halving | You don't tell everyone — you just tell every other person to "skip to your grandboss." The ladder shrinks each time someone asks. |
| Path splitting | Everyone you pass gets bumped up to report to their grandboss, and you keep climbing the old ladder. The org chart flattens steadily. |
| Why halving/splitting beats recursion | The recursive "tell everyone" version stacks up one held thought per level; on a 1,000,000-level ladder your brain (the call stack) overflows. The iterative versions hold nothing. |

Where the analogy breaks: in a real org chart you cannot instantly re-point reporting lines; in `parent[]` it is a single array write.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Turns `O(n)` finds into amortized `O(log n)` (alone) or `O(α(n))` (with rank). | The **first** `find` on a deep node still pays the full walk. |
| Trivial to add: one line for full compression. | Full (recursive) compression can **overflow the stack** on huge near-linear trees. |
| Halving/splitting are iterative — no stack risk. | Mutates `parent[]` during a read-like `find`, which surprises beginners and breaks persistence. |
| Excellent cache behavior after flattening (short paths). | Cannot easily "undo" a compressed find — bad for rollback/persistent DSU (see `senior.md`). |
| Pairs perfectly with union by rank/size. | Concurrent compression needs care (races on `parent[]` writes — see `senior.md`). |

**When to use:** essentially *always* in a DSU. It is the default. Use halving or splitting for production safety.

**When NOT to use:** when you need a **persistent** or **rollback-able** DSU (compression destroys old structure), or in some lock-free concurrent settings where you must reason about writes carefully.

---

## Step-by-Step Walkthrough

Start with a chain of 5 nodes. `parent = [1, 2, 3, 4, 4]` — that is `0→1→2→3→4`, and `4` is the root.

```
Initial tree (root 4 on top):

   4
   |
   3
   |
   2
   |
   1
   |
   0
```

### Full compression: `find(0)`

Recursion climbs `0 → 1 → 2 → 3 → 4`, finds root `4`, then unwinds re-pointing each node:

```
parent before: [1, 2, 3, 4, 4]
parent after  : [4, 4, 4, 4, 4]

   4
 / | | \
0  1 2  3        every node now points directly at the root
```

A later `find(0)` is now a single hop. Done.

### Path halving: `find(0)` on the same fresh chain

```
parent before: [1, 2, 3, 4, 4]

step: x=0, parent[0] = parent[parent[0]] = parent[1] = 2 ; x = 2
step: x=2, parent[2] = parent[parent[2]] = parent[3] = 4 ; x = 4
x == parent[x]=4 → stop, return 4

parent after : [2, 2, 4, 4, 4]
```

Node `0` now skips to `2`, node `2` skips to `4`. The path got shorter (length 4 → effectively length 2 from node 0). A second `find(0)` finishes the flattening.

### Path splitting: `find(0)` on the same fresh chain

```
parent before: [1, 2, 3, 4, 4]

x=0: next=1; parent[0]=parent[1]=2; x=1
x=1: next=2; parent[1]=parent[2]=3; x=2
x=2: next=3; parent[2]=parent[3]=4; x=3
x=3: next=4; parent[3]=parent[4]=4; x=4
stop, return 4

parent after : [2, 3, 4, 4, 4]
```

Every node on the path now points to its old grandparent. One pass, no recursion, tree noticeably flatter.

---

## Code Examples

All three variants below assume a DSU initialized with `parent[i] = i`.

### Variant A — Full path compression (recursive)

#### Go

```go
package main

import "fmt"

type DSU struct {
	parent []int
}

func NewDSU(n int) *DSU {
	p := make([]int, n)
	for i := range p {
		p[i] = i
	}
	return &DSU{parent: p}
}

// Find with full path compression (recursive one-liner).
func (d *DSU) Find(x int) int {
	if d.parent[x] != x {
		d.parent[x] = d.Find(d.parent[x]) // re-point x straight to root
	}
	return d.parent[x]
}

func (d *DSU) Union(a, b int) {
	ra, rb := d.Find(a), d.Find(b)
	if ra != rb {
		d.parent[ra] = rb // arbitrary union (no rank here)
	}
}

func main() {
	d := NewDSU(5)
	d.parent = []int{1, 2, 3, 4, 4} // build chain 0->1->2->3->4
	fmt.Println(d.Find(0))          // 4
	fmt.Println(d.parent)           // [4 4 4 4 4] — fully flattened
}
```

#### Java

```java
public class DSUFull {
    private final int[] parent;

    public DSUFull(int n) {
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
    }

    // Full path compression (recursive).
    public int find(int x) {
        if (parent[x] != x) {
            parent[x] = find(parent[x]); // re-point straight to root
        }
        return parent[x];
    }

    public void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra != rb) parent[ra] = rb;
    }

    public static void main(String[] args) {
        DSUFull d = new DSUFull(5);
        int[] chain = {1, 2, 3, 4, 4};
        System.arraycopy(chain, 0, d.parent, 0, 5);
        System.out.println(d.find(0));            // 4
        System.out.println(java.util.Arrays.toString(d.parent)); // [4, 4, 4, 4, 4]
    }
}
```

#### Python

```python
import sys


class DSUFull:
    def __init__(self, n: int):
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        # Full path compression (recursive). Watch the stack on deep chains.
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


if __name__ == "__main__":
    sys.setrecursionlimit(1_000_000)  # needed for deep chains!
    d = DSUFull(5)
    d.parent = [1, 2, 3, 4, 4]   # chain 0->1->2->3->4
    print(d.find(0))             # 4
    print(d.parent)              # [4, 4, 4, 4, 4]
```

### Variant B — Path halving (iterative)

#### Go

```go
func (d *DSU) FindHalving(x int) int {
	for d.parent[x] != x {
		d.parent[x] = d.parent[d.parent[x]] // point x to its grandparent
		x = d.parent[x]                      // jump up to the new parent
	}
	return x
}
```

#### Java

```java
public int findHalving(int x) {
    while (parent[x] != x) {
        parent[x] = parent[parent[x]]; // point to grandparent
        x = parent[x];                 // advance to new parent
    }
    return x;
}
```

#### Python

```python
def find_halving(self, x: int) -> int:
    while self.parent[x] != x:
        self.parent[x] = self.parent[self.parent[x]]  # grandparent
        x = self.parent[x]
    return x
```

### Variant C — Path splitting (iterative)

#### Go

```go
func (d *DSU) FindSplitting(x int) int {
	for d.parent[x] != x {
		next := d.parent[x]
		d.parent[x] = d.parent[d.parent[x]] // x -> its grandparent
		x = next                            // advance to the OLD parent
	}
	return x
}
```

#### Java

```java
public int findSplitting(int x) {
    while (parent[x] != x) {
        int next = parent[x];
        parent[x] = parent[parent[x]]; // x -> grandparent
        x = next;                      // advance to old parent
    }
    return x;
}
```

#### Python

```python
def find_splitting(self, x: int) -> int:
    while self.parent[x] != x:
        nxt = self.parent[x]
        self.parent[x] = self.parent[self.parent[x]]  # grandparent
        x = nxt                                        # old parent
    return x
```

**What they do:** all three return the root of `x`'s tree and flatten the path on the way. Full compression flattens it completely in one call; halving and splitting flatten it progressively without recursion.
**Run:** `go run main.go` | `javac DSUFull.java && java DSUFull` | `python dsu.py`

---

## Coding Patterns

### Pattern 1: Default DSU = iterative compression + union by rank

In real code, never ship naive `find`. Pair iterative halving with union by rank/size:

```python
class DSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x):                 # path halving
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1
```

### Pattern 2: Connectivity query

```python
def connected(self, a, b):
    return self.find(a) == self.find(b)   # both finds compress as a side effect
```

### Pattern 3: Counting components

```python
def num_components(self):
    return sum(1 for i in range(len(self.parent)) if self.find(i) == i)
```

```mermaid
graph TD
    A[find call] --> B{recursive or iterative?}
    B -->|recursive| C[full compression: every node to root]
    B -->|iterative| D[halving or splitting: node to grandparent]
    C --> E[flat tree]
    D --> E
    E --> F[future finds are near O(1)]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| `RecursionError` / stack overflow | Recursive full compression on a very deep chain. | Use iterative halving/splitting, or raise the recursion limit (Python) only as a stopgap. |
| `IndexOutOfRange` in `find` | `x` is not a valid element index. | Validate `0 <= x < n` before calling, or size the array correctly. |
| Wrong root returned | You forgot to update `x` after re-pointing in the iterative loop. | After `parent[x] = parent[parent[x]]`, set `x = parent[x]` (halving) or `x = next` (splitting). |
| Infinite loop in `find` | `parent[]` has a cycle that does not include a self-loop (a corrupt DSU). | Only `union` should write parents; a root must satisfy `parent[r] == r`. |
| Compression "lost" between calls | You copied the DSU by value and compressed the copy. | Pass the DSU by reference/pointer so `parent[]` mutations persist. |

---

## Performance Tips

- **Prefer iterative halving or splitting** in production. They are one pass, no recursion, no stack risk, and just as fast asymptotically.
- **Always combine with union by rank/size.** Compression alone is `O(log n)` amortized; with rank it is `O(α(n))`.
- **Don't pre-flatten.** You cannot flatten a node before you walk it; the first walk is unavoidable. Compression makes the *next* walks cheap.
- **Batch queries when possible.** If you will query the same nodes repeatedly, the first compressed `find` makes all later ones near-`O(1)`.
- **Use a flat `int[]`/slice/list**, not objects with pointers, for cache locality.

---

## Best Practices

- Initialize `parent[i] = i` for all `i`; a root is its own parent.
- Make `find` the *only* place compression happens; keep `union` calling `find` first.
- Document which variant you use at the top of the file — halving and splitting look almost identical and reviewers will ask.
- In Python, if you must use recursive full compression, call `sys.setrecursionlimit` and know the depth; otherwise switch to iterative.
- Test the invariant: after any sequence of operations, `find(x)` for two elements in the same group must return the same root.

---

## Edge Cases & Pitfalls

- **Single element** — `find(x)` on a root returns `x` immediately; no compression needed.
- **Already flat** — compression on a node that already points at the root is a no-op extra read.
- **Self-find** — `find(root)` must return `root`; ensure `parent[root] == root`.
- **Deep chain in Python** — recursive compression on `n = 10^6` *will* crash without a raised limit. Use iterative.
- **Compression during iteration** — if you loop `for i in range(n): find(i)` you are mutating `parent[]` as you go; that is fine and intended, but be aware roots may shift representative only via `union`, not `find`.
- **No union by rank** — compression alone still leaves you at `O(log n)`; that is acceptable but not optimal.

---

## Common Mistakes

1. **Forgetting `x = parent[x]` after re-pointing** in halving — the loop then re-reads the same node and may loop forever or return the wrong node.
2. **Mixing up halving and splitting** — in splitting you advance to the *old* parent (`next`), not the new one. Getting this wrong still works but changes the flattening pattern.
3. **Returning `x` from the recursive version** instead of `parent[x]` — after compression `parent[x]` is the root; returning the pre-compression `x` is just wrong.
4. **Using recursive compression on huge inputs** and getting a stack overflow in production.
5. **Compressing in a persistent/rollback DSU** — compression overwrites old parents and you can no longer undo (see `senior.md`).
6. **Calling `union` without `find` first** — you must link *roots*, not arbitrary nodes, or you corrupt the forest.

---

## Cheat Sheet

| Variant | One-liner idea | Passes | Recursion | Amortized (with rank) |
|---------|----------------|--------|-----------|------------------------|
| Full compression | `parent[x] = find(parent[x])` | 2 | yes | O(α(n)) |
| Path halving | `parent[x] = parent[parent[x]]; x = parent[x]` | 1 | no | O(α(n)) |
| Path splitting | `next = parent[x]; parent[x] = parent[parent[x]]; x = next` | 1 | no | O(α(n)) |

```
Naive find (no compression)            : O(n) worst case
Compression alone (arbitrary union)    : O(log n) amortized
Compression + union by rank/size       : O(α(n)) amortized  (≈ constant)
```

Root test: `parent[r] == r`. Initialize: `parent[i] = i`.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visual animation of path compression.
>
> The animation demonstrates:
> - A tall DSU chain flattened by a single `find`
> - Toggle between **full compression / halving / splitting** modes
> - The traversed path highlighted node by node
> - The `parent[]` array view updating live as nodes are re-pointed
> - A Reset button and step-by-step narration

---

## Summary

Path compression is the Find-side optimization that makes Union-Find fast. The naive `find` walks `O(height)` and degrades to `O(n)` on a chain. By re-pointing visited nodes closer to the root, you flatten the tree so future finds are near-instant. There are three classic variants — **full compression** (recursive, flattens completely), **path halving**, and **path splitting** (both iterative, point each node to its grandparent). All three are asymptotically equal; halving and splitting avoid recursion and the stack-overflow risk. Compression alone gives amortized `O(log n)`; combined with union by rank/size it gives `O(α(n))` — effectively constant. In production, default to iterative halving plus union by rank.

---

## Further Reading

- *Introduction to Algorithms* (CLRS), Chapter 21 — "Data Structures for Disjoint Sets."
- R. E. Tarjan, "Efficiency of a Good But Not Linear Set Union Algorithm," *JACM* 22(2), 1975 — the `O(α(n))` result.
- Sibling topic `01-union-find` — the basic DSU this builds on.
- Sibling topic `03-union-by-rank` — the union-side optimization and the combined amortized proof.
- cp-algorithms.com — "Disjoint Set Union" — practical implementations and variants.
