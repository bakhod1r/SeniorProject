# Bipartite Matching — Junior Level

> **One-line summary:** A bipartite matching pairs vertices from two disjoint sets so that no vertex is used twice; the maximum-cardinality version finds the largest such set of pairs, and Kuhn's algorithm computes it by repeatedly searching for *augmenting paths* with DFS in `O(V·E)` time.

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

Imagine you run a small workshop. You have a set of **workers** on the left and a set of **jobs** on the right. Each worker can do some of the jobs but not others, and a job needs exactly one worker. You want to start as many jobs as possible *today*. Each worker can take at most one job; each job can be taken by at most one worker.

That problem — "pair up the two sides so the number of valid pairs is as large as possible" — is exactly **maximum-cardinality bipartite matching**. It is one of the most useful classical algorithms in computer science, and it shows up everywhere: assigning drivers to ride requests, students to dorm rooms, advertisements to slots, tasks to machines, and pixels to labels in computer vision.

The word **bipartite** means the graph splits cleanly into two groups (call them the *left* set `L` and the *right* set `R`) such that **every edge goes from one side to the other** — never within a side. The word **matching** means a set of edges that share no endpoints: each chosen edge "uses up" one left vertex and one right vertex, and no vertex is used twice.

The central idea — discovered by **Claude Berge in 1957** and turned into a practical algorithm by the Soviet mathematician **Andrew Kuhn / the Hungarian school** — is the *augmenting path*. If you already have some matching and you can find a special zig-zag path that alternates between unmatched and matched edges and starts and ends at *free* (unmatched) vertices, then flipping every edge along that path increases the matching size by exactly one. Keep finding augmenting paths until none remains, and you provably have the maximum matching. That is the entire engine of Kuhn's algorithm.

This file teaches you the cardinality version with Kuhn's algorithm — the one every junior engineer and competitive programmer should know cold. Heavier machinery (Hopcroft-Karp's `O(E√V)` speedup, the weighted **Hungarian algorithm** for the assignment problem, and the reduction to max-flow) is introduced in the `middle.md`, `senior.md`, and `professional.md` files of this topic.

---

## Prerequisites

Before reading this file you should be comfortable with:

- **Graphs and adjacency lists** — vertices, edges, and how to store neighbors (`adj[u] = [v1, v2, ...]`).
- **Depth-first search (DFS)** — the recursive search pattern (see sibling topic `03-dfs`).
- **Arrays and indexing** — we keep a `matchR[]` array mapping right vertices to their matched left vertex.
- **Boolean "visited" arrays** — used to avoid revisiting a vertex within one search.
- **Big-O notation** — `O(V·E)`, `O(E√V)`.

Optional but helpful:

- A first look at **BFS** (sibling `02-bfs`) — Hopcroft-Karp uses it (covered in `middle.md`).
- A first look at **max-flow** (sibling `16-max-flow-edmonds-karp-dinic`) — matching reduces to flow.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Bipartite graph** | A graph whose vertices split into two sets `L`, `R` with every edge between the sets, none inside a set. Equivalent to "2-colorable" / "no odd cycle." |
| **Matching `M`** | A set of edges, no two of which share a vertex. |
| **Maximum matching** | A matching with the largest possible number of edges. |
| **Maximal matching** | A matching you cannot extend by greedily adding one edge. *Not* the same as maximum! |
| **Matched / saturated vertex** | A vertex that is an endpoint of some edge in `M`. |
| **Free / exposed / unmatched vertex** | A vertex not covered by any edge in `M`. |
| **Alternating path** | A path whose edges alternate between "not in `M`" and "in `M`." |
| **Augmenting path** | An alternating path whose two endpoints are both free vertices. Flipping it grows `M` by one. |
| **Perfect matching** | A matching that saturates every vertex (`|M| = |L| = |R|`). |
| **Vertex cover** | A set of vertices touching every edge. Min vertex cover = max matching in bipartite graphs (König). |
| **Independent set** | A set of vertices with no edge between them. |

---

## Core Concepts

### 1. What a matching looks like

Take a tiny bipartite graph. Left set `L = {0,1,2}`, right set `R = {a,b,c}`. Edges:

```
0 — a
0 — b
1 — a
2 — b
2 — c
```

Drawn as two columns:

```
   L            R
  [0] --------- (a)
       \
        \------ (b)
  [1] --------- (a)
  [2] --------- (b)
       \------- (c)
```

A *matching* picks edges with no shared endpoint. For example `{0—a, 2—b}` is a matching of size 2. Can we do better? `{0—a, 2—b}` leaves vertex `1` and right vertex `c` free, but `1` only connects to `a` (already used). However `{1—a, 0—b, 2—c}` is a matching of size **3** — every left vertex is paired. That is a *perfect matching* here, and clearly maximum.

### 2. The augmenting-path idea

Suppose we *greedily* matched `0—a`, then tried `1`: `1`'s only neighbor `a` is taken, so a naive greedy stops with size 1 or 2. The genius of matching theory is that we are not stuck. We look for an **augmenting path**:

```
free-left  ─(unmatched)─  right  ─(matched)─  left  ─(unmatched)─  free-right
```

It alternates unmatched/matched/unmatched edges and both ends are free. If we **flip** the membership of every edge along it (matched ↔ unmatched), the path had one more unmatched edge than matched edge, so the matching grows by exactly one — and it is still a valid matching because we only touched vertices already on the path.

**Berge's theorem (1957):** a matching `M` is maximum **if and only if** there is no augmenting path with respect to `M`. This is what makes the algorithm both correct and simple: just keep finding augmenting paths until you can't.

### 3. Kuhn's algorithm

Kuhn's algorithm finds augmenting paths one left vertex at a time using DFS:

```
for each left vertex u:
    reset visited[] for the right side
    try_kuhn(u)        # DFS that returns true if u got matched

try_kuhn(u):
    for each right neighbor v of u:
        if not visited[v]:
            visited[v] = true
            if matchR[v] == -1 or try_kuhn(matchR[v]):
                matchR[v] = u      # claim v for u
                return true
    return false
```

The recursion `try_kuhn(matchR[v])` is the augmenting step: "v is taken by some left vertex `w = matchR[v]`; can `w` move somewhere else so v becomes free for `u`?" Following that chain *is* walking the augmenting path.

### 4. The two-coloring sanity check

Kuhn (and every matching algorithm here) **requires a bipartite graph**. Before running it on a general graph, verify the graph is bipartite by 2-coloring it with BFS/DFS: color each vertex, and if you ever try to give an edge two endpoints the same color, the graph has an odd cycle and is **not** bipartite. On a non-bipartite graph these algorithms silently produce wrong answers. (General-graph matching needs Edmonds' Blossom algorithm — out of scope here.)

---

## Big-O Summary

| Algorithm | Problem | Time | Space | When to use |
|-----------|---------|------|-------|-------------|
| **Kuhn (DFS augmenting)** | Max cardinality | `O(V·E)` | `O(V+E)` | Default; simplest; fine up to ~10⁴–10⁵ edges. |
| **Hopcroft-Karp** | Max cardinality | `O(E·√V)` | `O(V+E)` | Large/dense bipartite graphs; the fast choice. |
| **Reduction to max-flow** | Max cardinality | depends on flow algo (Dinic ≈ `O(E√V)` on unit-cap) | `O(V+E)` | When you already have a flow library (see sibling `16-max-flow-edmonds-karp-dinic`). |
| **Hungarian (Kuhn-Munkres)** | Min-cost / max-weight assignment | `O(V³)` | `O(V²)` | Weighted assignment problem (covered in `professional.md`). |
| **Min-cost max-flow** | Weighted matching | depends | `O(V+E)` | Weighted matching via flow (sibling `18-min-cost-max-flow`). |

Note: `V·E` for Kuhn comes from "run one DFS per left vertex (`V` of them), each DFS is `O(E)`." Hopcroft-Karp's `√V` factor comes from a clever proof that only `O(√V)` *phases* are needed.

---

## Real-World Analogies

- **Job assignment.** Workers ↔ tasks. Each worker is qualified for some tasks; assign as many tasks as possible. This is the canonical use and the reason matching is sometimes called the *assignment problem* (the *weighted* version with costs is the true assignment problem, solved by Hungarian).
- **Dating / room-share app (the cardinality flavor).** Pair people who are mutually compatible, maximizing total pairs. (Note: *stable* matching — where pairs prefer not to swap — is a **different** problem solved by Gale-Shapley; cardinality matching does not care about preferences.)
- **Course scheduling.** Match professors to time slots they are available for, maximizing scheduled courses.
- **Hospital bed allocation.** Patients ↔ compatible beds/equipment, maximizing served patients.
- **Ad slots.** Advertisers ↔ impression slots they bid on, maximizing filled slots.

---

## Pros & Cons

**Pros**

- **Provably optimal** — Berge's theorem guarantees the result is a true maximum, not a greedy approximation.
- **Simple to code** — Kuhn is ~25 lines and uses only DFS plus two arrays.
- **General** — works on any bipartite graph, no special structure needed.
- **Rich theory for free** — once you have the matching you also get min vertex cover and max independent set (König's theorem).

**Cons**

- **Bipartite only** — fails silently on general graphs (needs Blossom).
- **Cardinality ≠ weighted** — Kuhn maximizes *count*, not *total weight/cost*. For costs you need Hungarian or min-cost flow.
- **`O(V·E)` can be slow** on huge dense graphs — switch to Hopcroft-Karp.
- **Easy to break with a stale `visited` array** — must reset it per augmentation (see Common Mistakes).

---

## Step-by-Step Walkthrough

Let's trace **Kuhn's algorithm** on the example graph. Left `L = {0,1,2}`, right `R = {a=0, b=1, c=2}`. Adjacency (left → right indices):

```
adj[0] = [a, b]      // 0 → a, 0 → b
adj[1] = [a]         // 1 → a
adj[2] = [b, c]      // 2 → a? no: b, c
```

`matchR[a]=matchR[b]=matchR[c] = -1` (all right vertices free).

**Process left vertex 0.** Reset `visited`. DFS from 0:
- Try `a`: `visited[a]=true`. `matchR[a] == -1` → claim it. `matchR[a] = 0`. Return true.
- Matching now `{0—a}`, size 1.

```
0 —— a   (matched, solid)
1     b
2     c
```

**Process left vertex 1.** Reset `visited`. DFS from 1:
- Try `a`: `visited[a]=true`. `matchR[a] == 0` (taken by 0). Recurse `try_kuhn(0)`:
  - 0's neighbors: `a` already visited → skip. Try `b`: `visited[b]=true`, `matchR[b] == -1` → claim. `matchR[b] = 0`. Return true.
  - So 0 vacated `a` and moved to `b`. Back in 1's call: `matchR[a] = 1`. Return true.
- This was an **augmenting path** `1 —a— 0 —b—` (free 1, then matched a-to-0, then free b). Matching now `{1—a, 0—b}`, size 2.

```
0 ——── b   (0 moved to b)
1 ——── a   (1 took a)
2       c
```

**Process left vertex 2.** Reset `visited`. DFS from 2:
- Try `b`: `visited[b]=true`. `matchR[b] == 0`. Recurse `try_kuhn(0)`:
  - 0's neighbors: `a` → `visited[a]=true`, `matchR[a] == 1`. Recurse `try_kuhn(1)`:
    - 1's neighbors: `a` visited → skip. No other neighbor. Return false.
  - `b` visited → skip. Return false.
- Back in 2's call: `b` failed. Try `c`: `visited[c]=true`, `matchR[c] == -1` → claim. `matchR[c] = 2`. Return true.
- Matching now `{1—a, 0—b, 2—c}`, size 3. **Perfect matching!**

```
0 ——── b
1 ——── a
2 ——── c
```

No more left vertices. **Maximum matching size = 3.** Final result `matchR = {a:1, b:0, c:2}`.

The key lesson from the trace: when vertex 2 tried `b`, the DFS explored *whether the whole chain could shuffle* (`2→b→0→a→1`). It couldn't, so it backtracked and used the free `c` instead. That backtracking search *is* the augmenting-path hunt.

---

## Code Examples

Below is **Kuhn's algorithm** for maximum bipartite matching in all three languages. Convention: left vertices `0..nL-1`, right vertices `0..nR-1`, `adj[u]` lists the right neighbors of left vertex `u`. Result: number of matched pairs and `matchR[v]` = left vertex matched to right `v` (or `-1`).

```go
package main

import "fmt"

type Bipartite struct {
	nL, nR int
	adj    [][]int // adj[u] = right neighbors of left vertex u
	matchR []int   // matchR[v] = left vertex matched to right v, or -1
	used   []bool  // visited array for the right side, reset per augmentation
}

func NewBipartite(nL, nR int) *Bipartite {
	b := &Bipartite{nL: nL, nR: nR, adj: make([][]int, nL)}
	b.matchR = make([]int, nR)
	for i := range b.matchR {
		b.matchR[i] = -1
	}
	return b
}

func (b *Bipartite) AddEdge(u, v int) { b.adj[u] = append(b.adj[u], v) }

// tryKuhn returns true if left vertex u can be matched via an augmenting path.
func (b *Bipartite) tryKuhn(u int) bool {
	for _, v := range b.adj[u] {
		if !b.used[v] {
			b.used[v] = true
			if b.matchR[v] == -1 || b.tryKuhn(b.matchR[v]) {
				b.matchR[v] = u
				return true
			}
		}
	}
	return false
}

func (b *Bipartite) MaxMatching() int {
	count := 0
	for u := 0; u < b.nL; u++ {
		b.used = make([]bool, b.nR) // CRITICAL: reset per left vertex
		if b.tryKuhn(u) {
			count++
		}
	}
	return count
}

func main() {
	b := NewBipartite(3, 3) // L={0,1,2}, R={a=0,b=1,c=2}
	b.AddEdge(0, 0)         // 0—a
	b.AddEdge(0, 1)         // 0—b
	b.AddEdge(1, 0)         // 1—a
	b.AddEdge(2, 1)         // 2—b
	b.AddEdge(2, 2)         // 2—c
	fmt.Println("Max matching:", b.MaxMatching()) // 3
	fmt.Println("matchR:", b.matchR)              // [1 0 2]
}
```

```java
import java.util.*;

public class KuhnMatching {
    private final int nL, nR;
    private final List<List<Integer>> adj;
    private final int[] matchR;   // matchR[v] = left matched to right v, or -1
    private boolean[] used;       // right-side visited, reset per augmentation

    public KuhnMatching(int nL, int nR) {
        this.nL = nL;
        this.nR = nR;
        adj = new ArrayList<>();
        for (int i = 0; i < nL; i++) adj.add(new ArrayList<>());
        matchR = new int[nR];
        Arrays.fill(matchR, -1);
    }

    public void addEdge(int u, int v) { adj.get(u).add(v); }

    private boolean tryKuhn(int u) {
        for (int v : adj.get(u)) {
            if (!used[v]) {
                used[v] = true;
                if (matchR[v] == -1 || tryKuhn(matchR[v])) {
                    matchR[v] = u;
                    return true;
                }
            }
        }
        return false;
    }

    public int maxMatching() {
        int count = 0;
        for (int u = 0; u < nL; u++) {
            used = new boolean[nR];   // CRITICAL: reset per left vertex
            if (tryKuhn(u)) count++;
        }
        return count;
    }

    public static void main(String[] args) {
        KuhnMatching b = new KuhnMatching(3, 3);
        b.addEdge(0, 0); b.addEdge(0, 1);
        b.addEdge(1, 0);
        b.addEdge(2, 1); b.addEdge(2, 2);
        System.out.println("Max matching: " + b.maxMatching()); // 3
        System.out.println("matchR: " + Arrays.toString(b.matchR)); // [1, 0, 2]
    }
}
```

```python
import sys

class Bipartite:
    def __init__(self, n_left, n_right):
        self.n_left = n_left
        self.n_right = n_right
        self.adj = [[] for _ in range(n_left)]
        self.match_r = [-1] * n_right   # right v -> left vertex, or -1
        self.used = []                  # reset per augmentation

    def add_edge(self, u, v):
        self.adj[u].append(v)

    def _try_kuhn(self, u):
        for v in self.adj[u]:
            if not self.used[v]:
                self.used[v] = True
                if self.match_r[v] == -1 or self._try_kuhn(self.match_r[v]):
                    self.match_r[v] = u
                    return True
        return False

    def max_matching(self):
        count = 0
        for u in range(self.n_left):
            self.used = [False] * self.n_right  # CRITICAL: reset per left vertex
            if self._try_kuhn(u):
                count += 1
        return count

if __name__ == "__main__":
    sys.setrecursionlimit(10**6)
    b = Bipartite(3, 3)
    b.add_edge(0, 0); b.add_edge(0, 1)
    b.add_edge(1, 0)
    b.add_edge(2, 1); b.add_edge(2, 2)
    print("Max matching:", b.max_matching())  # 3
    print("match_r:", b.match_r)               # [1, 0, 2]
```

All three print a matching of size **3**.

---

## Coding Patterns

1. **Right-side `matchR[]` only.** You rarely need `matchL[]`; the algorithm threads through `matchR[]`. If you need the left-to-right map at the end, build it from `matchR`.
2. **Reset `visited` per left vertex.** Each call to `tryKuhn(startLeft)` is a fresh augmenting-path search and needs a clean `visited` array on the right side.
3. **Index both sides from 0.** Keep left and right as separate `0..n-1` ranges so you can size arrays correctly. Mixing them into one numbering is a classic bug source.
4. **Greedy pre-matching (optimization).** Before the main loop, do a quick pass: for each left vertex, if it has any free neighbor, grab it. This cuts the number of expensive DFS calls. Correctness is unaffected because augmenting paths fix everything later.
5. **Order independence.** The *size* of the maximum matching is unique no matter what order you process left vertices in (though the specific pairs may differ).

---

## Error Handling

- **Non-bipartite input.** Detect with a 2-coloring BFS/DFS before matching. If not bipartite, raise an error rather than returning a meaningless number.
- **Out-of-range vertex indices.** Validate that every edge endpoint is within `[0, nL)` / `[0, nR)`.
- **Self-loops / intra-side edges.** In a true bipartite graph these cannot exist; reject them as malformed input.
- **Recursion depth.** In Python, deep augmenting chains can hit the recursion limit; call `sys.setrecursionlimit(...)` or convert the DFS to an explicit stack.
- **Empty sides.** If `nL == 0` or `nR == 0`, the answer is trivially `0`; handle without entering the loop.

---

## Performance Tips

- For graphs with thousands of vertices and dense edges, switch from Kuhn to **Hopcroft-Karp** (`middle.md`) — the `√V` factor is a large constant-and-asymptotic win.
- Use **adjacency lists**, not adjacency matrices, unless the graph is genuinely dense and small.
- Apply the **greedy pre-matching** pattern above; on random graphs it can match 60–70% of vertices instantly.
- Process the side with **fewer vertices as the "left"** in the outer loop — you run one DFS per left vertex, so fewer left vertices means fewer DFS launches.
- Reuse a single `used` array and a `timestamp` trick (store an iteration number instead of resetting the whole array) to avoid `O(nR)` reset cost per vertex.

---

## Best Practices

- Always verify bipartiteness explicitly; never assume the caller gave you a clean graph.
- Keep cardinality and weighted matching mentally separate. If the problem mentions **costs, profits, or weights**, you need Hungarian or min-cost flow — *not* Kuhn.
- Return both the matching *size* and the matching *pairs*; callers usually need the actual assignment.
- Document which set is "left" and which is "right" — a surprising amount of debugging time is lost to this confusion.
- Add a unit test asserting `|M| ≤ min(|L|, |R|)` as a cheap sanity invariant.

---

## Edge Cases & Pitfalls

| Case | What to watch for |
|------|-------------------|
| Empty graph | Matching size `0`. |
| No edges | Size `0` even with many vertices. |
| Complete bipartite `K_{n,n}` | Perfect matching of size `n`. |
| Duplicate edges | Harmless but wasteful; dedupe adjacency lists. |
| Unbalanced sides (`|L| ≠ |R|`) | Max matching ≤ smaller side; no perfect matching possible. |
| Disconnected components | Each handled independently; total is the sum. |
| Non-bipartite (odd cycle) | Algorithm gives a WRONG answer silently — must pre-check. |
| Isolated vertices | Never matched; reduce achievable size. |

---

## Common Mistakes

1. **Not resetting `visited`/`used` per left vertex.** Reusing it across augmentations blocks legitimate paths and undercounts the matching. This is the #1 bug.
2. **Resetting `matchR` instead of `visited`.** `matchR` must persist across the whole run; only the per-search `visited` resets.
3. **Running Kuhn on a non-bipartite graph.** It returns numbers that look plausible but are wrong.
4. **Confusing maximal with maximum.** A greedy maximal matching can be much smaller than the maximum.
5. **Treating weights as if Kuhn handled them.** Kuhn ignores weights entirely; it maximizes *count*.
6. **Indexing both sides in one shared array** and then sizing `matchR` to the wrong length.
7. **Python recursion limit** blowing up on long augmenting chains.

---

## Cheat Sheet

```text
PROBLEM:   max number of disjoint left-right pairs in a bipartite graph
THEOREM:   M is maximum  <=>  no augmenting path exists (Berge)
KUHN:      for each left u: reset used[]; tryKuhn(u)
           tryKuhn(u): for v in adj[u]:
                          if !used[v]: used[v]=true
                             if matchR[v]==-1 or tryKuhn(matchR[v]):
                                matchR[v]=u; return true
                       return false
TIME:      Kuhn O(V*E) | Hopcroft-Karp O(E*sqrt(V)) | Hungarian O(V^3, weighted)
INVARIANT: |M| <= min(|L|,|R|);  König: |M| = min vertex cover
GOTCHAS:   reset visited per vertex; bipartite-only; cardinality != weighted
```

---

## Why Greedy Fails (and Augmenting Paths Save It)

A common first instinct is: "just walk the left vertices and grab any free right neighbor." This *greedy maximal* matching is fast but can be far from optimal. Consider:

```
L:  0    1
     \  / \
      \/   \
      /\    \
     /  \    \
R:  a    b    (1 also connects to b)
adj[0] = [a, b]
adj[1] = [a]
```

Greedy in order `0, 1`:
- `0` grabs `a` (its first neighbor). `matchR[a] = 0`.
- `1`'s only neighbor `a` is taken → `1` stays unmatched. Greedy size = **1**.

But the maximum matching is size **2**: `{0—b, 1—a}`. Kuhn fixes this because when `1` finds `a` taken, it recurses into `try_kuhn(0)`, discovers `0` can move to `b`, and *shifts the whole chain* — exactly the augmenting path `1 —a— 0 —b—`. The lesson: **greedy commits too early; augmenting paths un-commit and re-route.** This is why Berge's theorem matters — it guarantees the augmenting-path process reaches the true maximum, never a greedy dead end.

| Approach | Result on the example | Optimal? |
|----------|----------------------|----------|
| Greedy maximal | 1 | No |
| Kuhn (augmenting) | 2 | Yes |

Greedy is still useful as a *warm start* (the "greedy pre-matching" optimization in Coding Patterns) — but it must always be followed by augmenting-path repair to guarantee optimality.

---

## Visual Animation

Open `animation.html` in this folder. It draws two columns of vertices, shows matched edges as solid lines and unmatched as dashed, highlights the current augmenting path as the DFS explores, and increments a live matching-size counter. Use **Step** to advance one DFS decision at a time, **Run** to animate, and **Reset** to restart.

---

## Summary

- **Bipartite matching** pairs left and right vertices with no vertex reused; the **maximum** version maximizes the pair count.
- **Berge's theorem:** a matching is maximum exactly when no augmenting path remains.
- **Kuhn's algorithm** finds augmenting paths with DFS, one left vertex at a time, in `O(V·E)`.
- **Reset the `visited` array per augmentation** — the most common bug.
- Always **check bipartiteness** first; cardinality matching is **not** weighted matching.
- Faster (`Hopcroft-Karp`), weighted (`Hungarian`), and flow-based variants are covered in the other files of this topic.

---

## Further Reading

- Berge, C. (1957). *Two theorems in graph theory.* The augmenting-path theorem.
- Kuhn, H. W. (1955). *The Hungarian method for the assignment problem.*
- Cormen, Leiserson, Rivest, Stein — *Introduction to Algorithms*, the flow & matching chapters.
- This topic's `middle.md` (Hopcroft-Karp, König duality), `professional.md` (proofs, Hungarian), `interview.md`, and `tasks.md`.
- Sibling topics: `02-bfs`, `03-dfs`, `16-max-flow-edmonds-karp-dinic`, `18-min-cost-max-flow`.
