# Prüfer Code — Junior Level

> **One-line summary:** A Prüfer code (or Prüfer sequence) is a unique sequence of `n − 2` numbers that encodes any labeled tree on `n` vertices, and from that sequence you can rebuild the exact same tree — a perfect, reversible "fingerprint" of the tree.

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

Imagine you have a **tree** — not a binary tree, just a connected graph with no cycles — drawn on a whiteboard, with each of its `n` vertices wearing a distinct number badge from `1` to `n`. These are called **labeled trees**, because the vertices have identities (labels), not just shapes.

Now ask a strange-sounding question: *can I write down a short list of numbers that completely captures this tree, so that a friend who never saw my drawing can reproduce it exactly?*

The answer, discovered by **Heinz Prüfer in 1918**, is a resounding yes. Every labeled tree on `n` vertices corresponds to **exactly one** sequence of `n − 2` numbers, each between `1` and `n`. And every such sequence corresponds to **exactly one** tree. This perfect one-to-one pairing is called a **bijection**.

The encoding rule is almost suspiciously simple:

> Repeatedly find the **leaf with the smallest label**, write down the label of its **only neighbor**, and delete that leaf. Stop when only two vertices remain.

That's it. After `n − 2` deletions you have written down `n − 2` numbers — the Prüfer code.

Why should anyone care? Three big reasons:

1. **Counting.** Because the bijection is exact, the number of labeled trees on `n` vertices equals the number of sequences of length `n − 2` over `{1, …, n}`, which is `n^(n−2)`. This is the famous **Cayley's formula** — and the Prüfer code is its most beautiful proof.
2. **Random generation.** Want a *uniformly random* labeled tree? Just pick `n − 2` random numbers and decode. Done. No rejection sampling, no bias.
3. **Compression.** A tree on `n` vertices normally needs `n − 1` edges (pairs of numbers). The Prüfer code stores it in `n − 2` single numbers — a compact, canonical form.

A sibling topic, **24-kirchhoff-theorem**, proves Cayley's formula a completely different way (via a determinant). The Prüfer code gives you the *constructive*, hands-on proof.

---

## Prerequisites

Before reading this file you should be comfortable with:

- **What a graph is** — vertices and edges.
- **What a tree is** — a connected graph with no cycles. A tree on `n` vertices always has exactly `n − 1` edges.
- **Leaf** — a vertex with exactly one edge (degree 1).
- **Degree** — the number of edges touching a vertex.
- **Arrays / lists** and basic loops.
- **Adjacency lists** — storing a graph as "for each vertex, the list of its neighbors."

Optional but helpful:

- A min-heap / priority queue (used to make encoding fast) — see sibling section **10-heaps**.
- Light exposure to combinatorics (`n^(n−2)`, multinomial coefficients) for the counting applications.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Labeled tree** | A tree whose `n` vertices carry distinct labels `1..n`. Two labeled trees differ if any edge differs, even if the drawings look the same. |
| **Prüfer code / Prüfer sequence** | The length `n − 2` sequence produced by repeatedly removing the smallest-labeled leaf and recording its neighbor. |
| **Leaf** | A vertex of degree 1 (exactly one neighbor). |
| **Degree** | Number of neighbors of a vertex. |
| **Encode** | Tree → sequence direction. Peel leaves. |
| **Decode** | Sequence → tree direction. Rebuild edges. |
| **Bijection** | A perfect one-to-one pairing: every tree ↔ exactly one sequence, no tree or sequence left out, none shared. |
| **Cayley's formula** | The count `n^(n−2)` of labeled trees on `n` vertices. |
| **1-indexed** | Labels run `1..n` (the classic convention). Watch out: arrays in Go/Java/Python are 0-indexed. |

---

## Core Concepts

### 1. A tree is more than its shape — the labels matter

Consider these two trees on 3 vertices:

```
   1 — 2 — 3            2 — 1 — 3
```

As *shapes* they are identical (a path of 3 nodes). But as **labeled** trees they are different, because the middle vertex is `2` in the first and `1` in the second. Prüfer codes distinguish labeled trees, so these two get different codes.

For `n = 3` the code length is `n − 2 = 1`. The code is simply the label of the center vertex, because that center is the neighbor of the smallest leaf. There are exactly `3^(3−2) = 3^1 = 3` labeled trees on 3 vertices, and indeed there are 3 possible single-number codes: `[1]`, `[2]`, `[3]`.

### 2. Encoding: peel the smallest leaf

The encode algorithm is a loop that runs `n − 2` times:

```
while more than 2 vertices remain:
    leaf = the leaf with the smallest label
    code.append(the single neighbor of leaf)
    remove leaf (and its edge)
```

Every step removes one vertex, so after `n − 2` steps exactly 2 vertices are left — and we stop. We never record anything about those final two; the last edge is implied.

### 3. Decoding: degree counting

To rebuild the tree we use a key fact:

> In the final tree, **vertex `v` appears in the Prüfer code exactly `degree(v) − 1` times.**

So if we count appearances, we recover every degree: `degree(v) = (appearances of v in code) + 1`. A vertex that never appears in the code has degree 1 — it is a **leaf** of the original tree.

Decoding then mirrors encoding:

```
compute degree[v] = count(v in code) + 1   for all v
for each value x in the code (left to right):
    leaf = smallest vertex with degree == 1
    add edge (leaf, x)
    degree[leaf] -= 1     # now 0, removed
    degree[x]    -= 1     # x may become a leaf
finally, connect the two remaining vertices with degree 1
```

### 4. The bijection

Encoding and decoding are exact inverses: `decode(encode(tree)) == tree` and `encode(decode(seq)) == seq`. Because each direction is deterministic and total, the trees and the sequences line up one-for-one. That is the whole magic.

---

## Big-O Summary

| Operation | Naive | Optimized | Space |
|-----------|-------|-----------|-------|
| **Encode** (find smallest leaf each step) | `O(n²)` linear scan | `O(n log n)` with a min-heap, or `O(n)` with a pointer trick | `O(n)` |
| **Decode** | `O(n²)` naive scan | `O(n log n)` heap / `O(n)` pointer | `O(n)` |
| **Count trees** (Cayley) | — | `O(1)` formula `n^(n−2)` | `O(1)` |
| **Random tree** | — | encode-free: `O(n)` random ints + decode | `O(n)` |

The `O(n)` linear variants exist because the smallest leaf only ever moves forward when you process the code left to right — that's the **pointer trick** explained in `middle.md`.

---

## Real-World Analogies

- **A recipe vs. the finished dish.** The Prüfer code is the recipe (a short ordered list of instructions); the tree is the dish. Same recipe → same dish, every time.
- **A ZIP file for trees.** Encoding compresses; decoding decompresses. It is *lossless* — you get the exact same tree back.
- **A lottery for trees.** Pick `n − 2` random numbers, decode, and you have drawn a tree perfectly uniformly at random from all `n^(n−2)` of them — like a fair lottery where every ticket (tree) is equally likely.
- **Library call numbers.** Two physically identical-looking books are still distinct items with distinct call numbers. Labels make trees distinct even when their shapes match.

---

## Pros & Cons

**Pros**

- **Compact:** stores a tree in `n − 2` integers instead of `n − 1` edges.
- **Canonical:** each tree has exactly one code — great for hashing, deduplication, equality checks.
- **Reversible:** lossless round-trip.
- **Enables uniform random tree sampling** in `O(n)` with zero rejection.
- **Proves Cayley's formula** constructively.

**Cons**

- **Only works for labeled trees** — not unlabeled (shape-only) trees, not general graphs, not forests directly (though forests have a variant).
- **Loses local structure** in a non-intuitive way — neighboring code entries don't correspond to neighboring vertices.
- **Edge cases at `n = 1` and `n = 2`** need special handling (the code is empty).
- **Off-by-one bugs** are easy: 1-indexed labels vs 0-indexed arrays.

---

## Step-by-Step Walkthrough

Let's encode this tree on **`n = 6`** vertices (labels `1..6`):

```
        1
        |
        4
       / \
      2   6
          |
          3
          |
          5
```

Adjacency (neighbors):

```
1: [4]
2: [4]
3: [6, 5]
4: [1, 2, 6]
5: [3]
6: [4, 3]
```

Leaves (degree 1) are: `1, 2, 5`. We always peel the **smallest** leaf.

**Step 1.** Leaves = `{1, 2, 5}`. Smallest = **1**. Its neighbor is **4**. Record `4`. Delete vertex 1.
Code so far: `[4]`. Remaining degrees drop: `4` now has neighbors `[2, 6]`.

```
        4
       / \
      2   6
          |
          3
          |
          5
```

**Step 2.** Leaves now = `{2, 5}`. Smallest = **2**. Neighbor = **4**. Record `4`. Delete vertex 2.
Code: `[4, 4]`. Now `4` has only neighbor `[6]` → `4` becomes a leaf.

```
      4 — 6
          |
          3
          |
          5
```

**Step 3.** Leaves = `{4, 5}`. Smallest = **4**. Neighbor = **6**. Record `6`. Delete vertex 4.
Code: `[4, 4, 6]`.

```
      6
      |
      3
      |
      5
```

**Step 4.** Leaves = `{5}` (and 6 is now also a leaf). Vertices remaining: `6, 3, 5`. Leaves = `{5, 6}`. Smallest = **5**. Neighbor = **3**. Record `3`. Delete 5.
Code: `[4, 4, 6, 3]`.

```
      6 — 3
```

**Stop.** Only 2 vertices remain (`6` and `3`). We have written `n − 2 = 4` numbers.

**Final Prüfer code: `[4, 4, 6, 3]`.**

Sanity check via degrees: count appearances → `3` appears 1×, `4` appears 2×, `6` appears 1×, others 0×.
So `degree(3) = 2, degree(4) = 3, degree(6) = 2`, and `degree(1) = degree(2) = degree(5) = 1`. Compare with the original picture — exactly right.

### Decoding it back

Start from code `[4, 4, 6, 3]`, `n = 6`.

Degrees: `deg = [_, 1, 1, 2, 3, 1, 2]` (index by label; `deg[v] = appearances + 1`).

| Step | Code value `x` | Smallest leaf (deg=1) | Edge added | deg updates |
|------|----------------|------------------------|------------|-------------|
| 1 | 4 | **1** | (1,4) | deg[1]→0, deg[4]→2 |
| 2 | 4 | **2** | (2,4) | deg[2]→0, deg[4]→1 |
| 3 | 6 | **4** | (4,6) | deg[4]→0, deg[6]→1 |
| 4 | 3 | **5** | (5,3) | deg[5]→0, deg[3]→1 |

Two vertices still have degree 1: **3** and **6**. Add the final edge **(3, 6)**.

Edges produced: `(1,4), (2,4), (4,6), (5,3), (3,6)` — identical to the original tree. The round-trip works.

---

## Code Examples

### Encode: smallest-leaf peeling (heap-based, clear version)

```go
package main

import (
	"container/heap"
	"fmt"
)

// IntHeap is a min-heap of ints.
type IntHeap []int

func (h IntHeap) Len() int            { return len(h) }
func (h IntHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *IntHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *IntHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

// PruferEncode takes adjacency for vertices 1..n and returns the code (length n-2).
func PruferEncode(n int, adj map[int][]int) []int {
	degree := make([]int, n+1)
	nb := make(map[int]map[int]bool) // neighbor sets, mutable
	for v := 1; v <= n; v++ {
		nb[v] = map[int]bool{}
	}
	for v, list := range adj {
		for _, u := range list {
			nb[v][u] = true
			degree[v]++
		}
	}

	h := &IntHeap{}
	heap.Init(h)
	for v := 1; v <= n; v++ {
		if degree[v] == 1 {
			heap.Push(h, v)
		}
	}

	code := make([]int, 0, n-2)
	for len(code) < n-2 {
		leaf := heap.Pop(h).(int)
		// leaf has exactly one remaining neighbor
		var neighbor int
		for u := range nb[leaf] {
			neighbor = u
		}
		code = append(code, neighbor)
		// remove the edge
		delete(nb[neighbor], leaf)
		delete(nb[leaf], neighbor)
		degree[neighbor]--
		if degree[neighbor] == 1 {
			heap.Push(h, neighbor)
		}
	}
	return code
}

func main() {
	adj := map[int][]int{
		1: {4}, 2: {4}, 3: {6, 5},
		4: {1, 2, 6}, 5: {3}, 6: {4, 3},
	}
	fmt.Println(PruferEncode(6, adj)) // [4 4 6 3]
}
```

```java
import java.util.*;

public class PruferEncode {
    // adj: 1-indexed adjacency lists for vertices 1..n
    public static int[] encode(int n, List<List<Integer>> adj) {
        int[] degree = new int[n + 1];
        // mutable neighbor sets
        List<Set<Integer>> nb = new ArrayList<>();
        for (int i = 0; i <= n; i++) nb.add(new HashSet<>());
        for (int v = 1; v <= n; v++) {
            for (int u : adj.get(v)) {
                nb.get(v).add(u);
                degree[v]++;
            }
        }

        PriorityQueue<Integer> pq = new PriorityQueue<>();
        for (int v = 1; v <= n; v++) {
            if (degree[v] == 1) pq.add(v);
        }

        int[] code = new int[Math.max(0, n - 2)];
        int idx = 0;
        while (idx < n - 2) {
            int leaf = pq.poll();
            int neighbor = nb.get(leaf).iterator().next();
            code[idx++] = neighbor;
            nb.get(neighbor).remove(leaf);
            nb.get(leaf).remove(neighbor);
            if (--degree[neighbor] == 1) pq.add(neighbor);
        }
        return code;
    }

    public static void main(String[] args) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i <= 6; i++) adj.add(new ArrayList<>());
        adj.get(1).add(4); adj.get(2).add(4);
        adj.get(3).addAll(List.of(6, 5));
        adj.get(4).addAll(List.of(1, 2, 6));
        adj.get(5).add(3);
        adj.get(6).addAll(List.of(4, 3));
        System.out.println(Arrays.toString(encode(6, adj))); // [4, 4, 6, 3]
    }
}
```

```python
import heapq


def prufer_encode(n, adj):
    """adj: dict {vertex(1..n): [neighbors]}. Returns code of length n-2."""
    nb = {v: set(adj.get(v, [])) for v in range(1, n + 1)}
    degree = {v: len(nb[v]) for v in range(1, n + 1)}

    leaves = [v for v in range(1, n + 1) if degree[v] == 1]
    heapq.heapify(leaves)

    code = []
    while len(code) < n - 2:
        leaf = heapq.heappop(leaves)
        neighbor = next(iter(nb[leaf]))      # the only remaining neighbor
        code.append(neighbor)
        nb[neighbor].discard(leaf)
        nb[leaf].discard(neighbor)
        degree[neighbor] -= 1
        if degree[neighbor] == 1:
            heapq.heappush(leaves, neighbor)
    return code


if __name__ == "__main__":
    adj = {1: [4], 2: [4], 3: [6, 5], 4: [1, 2, 6], 5: [3], 6: [4, 3]}
    print(prufer_encode(6, adj))  # [4, 4, 6, 3]
```

### Decode: degree-counting reconstruction

```go
package main

import (
	"container/heap"
	"fmt"
)

type IntHeap []int

func (h IntHeap) Len() int            { return len(h) }
func (h IntHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *IntHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *IntHeap) Pop() interface{} {
	old := *h
	x := old[len(old)-1]
	*h = old[:len(old)-1]
	return x
}

type Edge struct{ U, V int }

// PruferDecode rebuilds the tree (n = len(code)+2) as a list of edges.
func PruferDecode(code []int) []Edge {
	n := len(code) + 2
	degree := make([]int, n+1)
	for v := 1; v <= n; v++ {
		degree[v] = 1
	}
	for _, x := range code {
		degree[x]++
	}

	h := &IntHeap{}
	for v := 1; v <= n; v++ {
		if degree[v] == 1 {
			heap.Push(h, v)
		}
	}

	edges := make([]Edge, 0, n-1)
	for _, x := range code {
		leaf := heap.Pop(h).(int)
		edges = append(edges, Edge{leaf, x})
		degree[leaf]--
		degree[x]--
		if degree[x] == 1 {
			heap.Push(h, x)
		}
	}
	// final edge between the two remaining degree-1 vertices
	u := heap.Pop(h).(int)
	v := heap.Pop(h).(int)
	edges = append(edges, Edge{u, v})
	return edges
}

func main() {
	fmt.Println(PruferDecode([]int{4, 4, 6, 3}))
	// [{1 4} {2 4} {4 6} {5 3} {3 6}]
}
```

```java
import java.util.*;

public class PruferDecode {
    public static int[][] decode(int[] code) {
        int n = code.length + 2;
        int[] degree = new int[n + 1];
        Arrays.fill(degree, 1, n + 1, 1);
        for (int x : code) degree[x]++;

        PriorityQueue<Integer> pq = new PriorityQueue<>();
        for (int v = 1; v <= n; v++) {
            if (degree[v] == 1) pq.add(v);
        }

        int[][] edges = new int[n - 1][2];
        int e = 0;
        for (int x : code) {
            int leaf = pq.poll();
            edges[e][0] = leaf;
            edges[e][1] = x;
            e++;
            degree[leaf]--;
            if (--degree[x] == 1) pq.add(x);
        }
        edges[e][0] = pq.poll();
        edges[e][1] = pq.poll();
        return edges;
    }

    public static void main(String[] args) {
        int[][] edges = decode(new int[]{4, 4, 6, 3});
        for (int[] ed : edges) System.out.println(Arrays.toString(ed));
        // [1,4] [2,4] [4,6] [5,3] [3,6]
    }
}
```

```python
import heapq


def prufer_decode(code):
    """Returns list of edges for the tree on n = len(code)+2 vertices."""
    n = len(code) + 2
    degree = [0] + [1] * n          # degree[1..n] = 1 initially
    for x in code:
        degree[x] += 1

    leaves = [v for v in range(1, n + 1) if degree[v] == 1]
    heapq.heapify(leaves)

    edges = []
    for x in code:
        leaf = heapq.heappop(leaves)
        edges.append((leaf, x))
        degree[leaf] -= 1
        degree[x] -= 1
        if degree[x] == 1:
            heapq.heappush(leaves, x)

    u = heapq.heappop(leaves)
    v = heapq.heappop(leaves)
    edges.append((u, v))
    return edges


if __name__ == "__main__":
    print(prufer_decode([4, 4, 6, 3]))
    # [(1, 4), (2, 4), (4, 6), (5, 3), (3, 6)]
```

---

## Coding Patterns

1. **Degree array, not a full graph copy.** For decoding you never need adjacency — just `degree[v] = count(v) + 1` and a min-heap of current leaves.
2. **Min-heap for "smallest leaf."** Both directions repeatedly ask for the smallest degree-1 vertex; a priority queue answers that in `O(log n)`.
3. **Push a vertex into the heap the moment its degree drops to 1**, never before. Pushing too early breaks the smallest-leaf rule.
4. **Last two vertices are implicit on encode, explicit on decode.** Encode stops with 2 vertices unrecorded; decode finishes by connecting the final two degree-1 vertices.
5. **Keep labels 1-indexed inside the algorithm**, convert at the boundary if your input is 0-indexed.

---

## Error Handling

- **`n < 2`:** A tree on 1 vertex has an empty code, and there is no edge. A tree on 2 vertices also has an empty code (`n − 2 = 0`) and one implicit edge `(1, 2)`. Guard these before the main loop.
- **Code values out of range:** every entry must be in `1..n` where `n = len(code) + 2`. Reject anything else — it cannot be a valid Prüfer code.
- **Disconnected input to encode:** the algorithm assumes a *tree* (connected, `n − 1` edges). If you feed a forest or a graph with a cycle, results are meaningless. Validate edge count `= n − 1` and connectivity first if input is untrusted.
- **Multiple neighbors when popping a leaf:** if a popped "leaf" has more than one neighbor, your degree bookkeeping is wrong — likely you pushed it too early.

```python
def prufer_decode_safe(code):
    n = len(code) + 2
    if n < 2:
        raise ValueError("n must be >= 2")
    for x in code:
        if not (1 <= x <= n):
            raise ValueError(f"code value {x} out of range 1..{n}")
    return prufer_decode(code)
```

---

## Performance Tips

- Use the **heap version** for clarity (`O(n log n)`); switch to the **pointer trick** (`O(n)`, in `middle.md`) only when `n` is large and profiling shows the heap matters.
- For **random tree generation**, skip encoding entirely: generate `n − 2` random ints in `1..n` and decode. That alone is uniform.
- Avoid rebuilding sets repeatedly during encode; mutate one neighbor structure in place.
- For decode, an `int` degree array beats a hash map for dense label ranges.

---

## Best Practices

- **Always test the round-trip** `decode(encode(T)) == T` on small trees first — it catches almost every bug.
- **Document your indexing** convention (1-indexed labels) at the top of the function.
- **Sort edges** before comparing two trees for equality (treat each edge as an unordered pair).
- **Special-case `n = 1` and `n = 2`** explicitly and return early.

---

## Edge Cases & Pitfalls

| Case | What happens | Fix |
|------|--------------|-----|
| `n = 1` | Code length `−1`? No — define it as empty `[]`. No edges. | Return `[]`, no loop. |
| `n = 2` | Code is empty `[]`; one implicit edge `(1, 2)`. | Skip loop, emit final edge. |
| 0-indexed labels | Off-by-one: vertex `n` ignored or array overrun. | Convert to 1-indexed inside, back out. |
| Picked a non-smallest leaf | Produces a *different* (wrong) code; no longer a bijection. | Always use the min-heap / smallest rule. |
| Pushed vertex to heap with degree > 1 | Pops a "leaf" with several neighbors. | Push only when degree hits exactly 1. |

---

## Common Mistakes

1. **Recording the leaf instead of its neighbor.** The code stores *neighbors*, never the leaves themselves.
2. **Forgetting the final implicit edge** on decode — you'll be one edge short (`n − 2` instead of `n − 1`).
3. **Using "any leaf" instead of the smallest leaf.** Any-leaf still gives *a* valid tree on decode, but it is not the canonical Prüfer code and breaks the bijection/round-trip.
4. **Counting degree as appearances instead of appearances + 1.** Leaves appear 0 times but have degree 1.
5. **Mixing label bases** — passing 0-indexed edges to a 1-indexed decoder.

---

## Cheat Sheet

```text
ENCODE (tree -> code, length n-2):
  degree[v] = number of neighbors
  push all degree-1 vertices into min-heap
  repeat n-2 times:
     leaf = pop smallest leaf
     code.append(its one neighbor u)
     degree[u]--; if degree[u]==1 push u

DECODE (code -> tree, n = len(code)+2):
  degree[v] = count(v in code) + 1
  push all degree-1 vertices into min-heap
  for x in code:
     leaf = pop smallest leaf
     edge(leaf, x); degree[leaf]--; degree[x]--
     if degree[x]==1 push x
  connect final two degree-1 vertices

KEY FACTS:
  code length        = n - 2
  appearances of v   = degree(v) - 1
  # labeled trees    = n^(n-2)   (Cayley)
```

---

## Visual Animation

Open `animation.html` in this folder. It lets you:

- **Encode** a small tree step by step — watch the smallest leaf get peeled and its neighbor recorded.
- **Decode** a code back into the tree — watch edges appear as the heap pops leaves.
- Use **Step / Run / Reset** to control the pace, with a running log and the partial code/degree table shown live.

---

## Summary

A **Prüfer code** is a length `n − 2` integer sequence that uniquely encodes any labeled tree on `n` vertices. **Encode** by repeatedly peeling the smallest-labeled leaf and recording its neighbor; **decode** by counting appearances to recover degrees, then connecting the smallest remaining degree-1 vertex to each code entry, finishing with the last two leftover vertices. The encode/decode pair is a **bijection**, which directly proves **Cayley's formula** (`n^(n−2)` labeled trees) and gives a clean way to generate uniformly random trees, count trees with prescribed degrees, and store trees compactly. Mind the edge cases (`n = 1, 2`), the **smallest-leaf** rule, and **1- vs 0-indexing**.

---

## Further Reading

- Sibling topic **24-kirchhoff-theorem** — Cayley's formula via the Matrix-Tree theorem (a determinant), a complementary proof.
- Sibling topic **10-mst-kruskal-prim** — spanning trees of weighted graphs, a different lens on trees.
- Sibling section **10-heaps** — the min-heap that powers fast encoding/decoding.
- The `middle.md` file here — the `O(n)` pointer trick and degree-multinomial generalizations.
- The `professional.md` file here — a full proof of the bijection and the Cayley corollary.
