# Topological Sort — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definition — Linear Extension of a Partial Order
2. Correctness Proof — Kahn's Algorithm
3. Correctness Proof — DFS Reverse-Postorder
4. Existence Theorem — DAG ⟺ Has a Topological Order
5. Complexity O(V + E)
6. Counting Linear Extensions is #P-Complete
7. Worked Example — ASCII DAG and Kahn Trace
8. Reference Implementations (Go / Java / Python)
9. Lattice and Partial-Order Framing
10. Online / Dynamic Topological Order (Pearce–Kelly)
11. Cache Behavior and Memory Layout
12. Average-Case Analysis on Random DAGs
13. Space-Time Trade-offs
14. Comparison with Alternatives
15. Open Problems — Online / Dynamic Topological Order
16. Summary

---

## 1. Formal Definition — Linear Extension of a Partial Order

A directed graph `G = (V, E)` induces a **reachability relation** `≺` where `u ≺ v` iff there is a directed path from `u` to `v`. When `G` is acyclic, `≺` is irreflexive and transitive — a **strict partial order**.

**Definition 1.1 (Topological order).** A topological order of `G = (V, E)` is a bijection `σ : V → {1, …, |V|}` (equivalently, a total order `<_σ`) such that

```text
∀ (u, v) ∈ E :  σ(u) < σ(v).
```

**Definition 1.2 (Linear extension).** Given a strict partial order `(V, ≺)`, a **linear extension** is a total order `<_σ` on `V` such that `u ≺ v ⟹ u <_σ v`. A topological order of a DAG is exactly a linear extension of its reachability partial order.

**Proposition 1.3 (Equivalence).** A bijection `σ` satisfies Definition 1.1 (orders every *edge* correctly) **iff** it is a linear extension of `≺` (orders every *reachable pair* correctly).

*Proof.* (⇐) Every edge `(u,v) ∈ E` implies `u ≺ v`, so a linear extension orders it. (⇒) Suppose `σ` orders every edge. Take any `u ≺ v`; there is a path `u = x₀ → x₁ → ⋯ → x_k = v`. By hypothesis `σ(x_i) < σ(x_{i+1})` for each consecutive pair, and `<` is transitive, so `σ(u) < σ(v)`. Hence `σ` extends `≺`. ∎

This identification — *topological order = linear extension of a poset* — is what connects topological sorting to order theory (and to the #P-completeness of §6).

---

## 2. Correctness Proof — Kahn's Algorithm

```text
KAHN(G):
  compute indeg[v] for all v
  Q := { v : indeg[v] = 0 }
  L := empty list
  while Q ≠ ∅:
    remove some u from Q; append u to L
    for each edge (u, w):
      indeg[w] := indeg[w] - 1
      if indeg[w] = 0: add w to Q
  return L
```

**Loop invariant (I).** At the top of each iteration:
1. Every vertex in `L` has had all of its predecessors already placed in `L` (earlier).
2. For every vertex `w ∉ L`, `indeg[w]` equals the number of `w`'s predecessors not yet in `L`.
3. `Q` is exactly the set of vertices `∉ L` whose all predecessors are in `L`.

**Initialization.** `L = ∅`; `indeg[w]` is the full in-degree (no predecessors removed); `Q` is the set of original sources (all predecessors — namely none — are in `L`). All three clauses hold.

**Maintenance.** We append some `u ∈ Q` to `L`. By (I.3) all of `u`'s predecessors are already in `L`, so appending `u` after them preserves (I.1). For each edge `(u,w)` we decrement `indeg[w]`, restoring (I.2) since `u` (a predecessor of `w`) just entered `L`. If `indeg[w]` reaches 0, all of `w`'s predecessors are now in `L`, so we add `w` to `Q`, restoring (I.3).

**Termination & validity.** The loop ends when `Q = ∅`. By (I.1), the output `L` orders every edge `(u,w)` with `u` before `w` (because `w` is appended only after `indeg[w]` hit 0, i.e. after `u ∈ L`). Thus `L` is a valid topological order of the subgraph it contains.

**Theorem 2.1 (Completeness ⟺ acyclicity).** `KAHN` outputs all `|V|` vertices **iff** `G` is acyclic.

*Proof.* (⇐) If `G` is a DAG, suppose for contradiction the loop halts with some vertices unplaced. Each unplaced vertex has `indeg > 0` (else it would be in `Q`), so each has an unplaced predecessor. Following predecessors among the finite unplaced set must repeat a vertex — a cycle — contradiction. So all vertices are placed. (⇒) If `G` has a cycle `c₁ → c₂ → ⋯ → c₁`, no `c_i` ever reaches `indeg = 0` (each always has an unplaced predecessor on the cycle), so they are never emitted; `|L| < |V|`. ∎

Hence `|L| < |V|` is a sound and complete cycle test.

---

## 3. Correctness Proof — DFS Reverse-Postorder

```text
DFS-TOPO(G):
  color[v] := white for all v
  L := empty list
  for each v: if color[v] = white: VISIT(v)
  return reverse(L)

VISIT(u):
  color[u] := gray
  for each edge (u, w):
    if color[w] = gray: report cycle (back edge)
    else if color[w] = white: VISIT(w)
  color[u] := black
  append u to L         # u's "finish"
```

**Lemma 3.1 (Edge finish-time inequality).** If `G` is a DAG, then for every edge `(u, w) ∈ E`, `w` is appended to `L` before `u` (i.e. `finish(w) < finish(u)`).

*Proof.* Consider the moment `VISIT(u)` examines edge `(u, w)`. Since `G` is acyclic, `w` cannot be gray (a gray `w` would be an ancestor of `u` on the recursion stack, and the tree path from `w` to `u` plus edge `(u,w)` would be a cycle). So `w` is white or black.
- **White:** `VISIT(w)` is invoked now and returns (appending `w`) before `VISIT(u)` returns (appending `u`). So `finish(w) < finish(u)`.
- **Black:** `w` already finished, so `finish(w) < finish(u)`.
Either way `finish(w) < finish(u)`. ∎

**Theorem 3.2.** For a DAG, `reverse(L)` is a valid topological order.

*Proof.* `L` lists vertices in increasing finish time. By Lemma 3.1, every edge `(u,w)` has `finish(w) < finish(u)`, so `w` precedes `u` in `L`; reversing puts `u` before `w`. This holds for all edges, so `reverse(L)` satisfies Definition 1.1. ∎

**Theorem 3.3 (Cycle detection soundness & completeness).** `DFS-TOPO` reports a back edge **iff** `G` has a cycle.

*Proof.* (⇐) The **white-path theorem** (CLRS): if `G` has a cycle, the first cycle vertex discovered, `c`, is gray while the rest of the cycle is reachable by a white path; DFS descends that path and eventually examines an edge into the still-gray `c` — a back edge. (⇒) A back edge `(u,w)` with `w` gray means `w` is an ancestor of `u`, so the tree path `w ⤳ u` plus `(u,w)` is a cycle. ∎

---

## 4. Existence Theorem — DAG ⟺ Has a Topological Order

**Theorem 4.1.** A finite directed graph `G` has a topological order **iff** `G` is acyclic.

*Proof.*
(⇒) Suppose `G` has a topological order `σ` and, for contradiction, a cycle `c₁ → c₂ → ⋯ → c_k → c₁`. Then `σ(c₁) < σ(c₂) < ⋯ < σ(c_k) < σ(c₁)`, giving `σ(c₁) < σ(c₁)` — impossible.

(⇐) Suppose `G` is acyclic. Either Theorem 2.1 (Kahn outputs all `|V|`) or Theorem 3.2 (DFS reverse-postorder) constructively produces one. A non-constructive induction also works: every finite DAG has at least one **source** (a vertex of in-degree 0) — otherwise following predecessors forever revisits a vertex, a cycle. Remove a source `s`, recursively order `G − s` (still a DAG), and prepend `s`. ∎

**Corollary 4.2 (Existence of a source/sink).** Every nonempty finite DAG has at least one source and at least one sink.

---

## 5. Complexity O(V + E)

**Theorem 5.1.** Both Kahn's algorithm and DFS reverse-postorder run in `Θ(V + E)` time and `Θ(V)` auxiliary space (plus `Θ(E)` to store the adjacency list).

*Proof (Kahn).* Computing in-degrees scans every adjacency list once: `Θ(V + E)`. Initializing `Q` is `Θ(V)`. In the main loop, each vertex is added to and removed from `Q` exactly once (`Θ(V)` total), and each edge `(u,w)` is processed exactly once when `u` is dequeued (`Θ(E)` total). Total `Θ(V + E)`.

*Proof (DFS).* `VISIT` is called once per vertex (guarded by `color`), and inside it each edge is examined once. Summed: `Θ(V + E)`. The recursion stack and color array are `Θ(V)`. ∎

**Remark (lower bound).** Any algorithm that produces a topological order must read every edge at least once to be certain it does not violate the order — so `Ω(V + E)` is a matching lower bound in the adjacency-list model. The linear algorithms are optimal.

---

## 6. Counting Linear Extensions is #P-Complete

Producing *one* topological order is linear-time; counting *all* of them is, in stark contrast, computationally intractable.

**Definition 6.1.** `#LinearExtensions`: given a poset `P` (equivalently a DAG), output `e(P)`, the number of distinct linear extensions (distinct topological orders).

**Theorem 6.2 (Brightwell & Winkler, 1991).** `#LinearExtensions` is **#P-complete**.

*Reference.* G. Brightwell, P. Winkler, "Counting linear extensions", *Order* 8(3):225–242, 1991. The class **#P** (Valiant, 1979) consists of counting problems associated with NP relations; #P-completeness means a polynomial-time algorithm would imply `P = NP` (and collapse the counting hierarchy), so none is expected.

**Consequences.**
- **No known polynomial algorithm** computes `e(P)` exactly in general.
- The standard **exact** method is subset DP: `dp[S]` = number of orders emitting exactly the down-closed set `S`, with `dp[S] = Σ_{v: v is maximal-addable to S} dp[S \ {v}]`, evaluated over `2^V` subsets — `Θ(2^V · V)` time, `Θ(2^V)` space. Feasible only for `|V| ≲ 22`.
- **Approximation** is tractable: Dyer, Frieze & Kannan (1991) gave an FPRAS (fully polynomial randomized approximation scheme) for `e(P)` via approximating the volume of the **order polytope** with a random walk; Bubley & Dyer (1999) gave a near-linear-mixing Markov chain ("adjacent transpositions") improving the bound.

**Special cases that *are* easy.**
- A **total order** (a single chain): `e(P) = 1`.
- An **antichain** of `n` elements (no edges): `e(P) = n!`.
- A **forest poset**: `e(P) = n! / ∏_v (size of subtree rooted at v)` (the hook-length-style formula).
- **Series-parallel** posets: `e(P)` computable in polynomial time by structural recursion.

The gap — trivial to find one extension, #P-hard to count them — is the headline complexity fact of this topic.

---

## 7. Worked Example — ASCII DAG and Kahn Trace

Take a concrete DAG of 6 vertices labeled `0..5` (a classic "course prerequisite" shape). An edge `u → v` means *u must come before v*.

```text
            (0)
           /   \
          v     v
        (1)     (2)
          \     / \
           v   v   v
            (3)    (4)
              \   /
               v v
               (5)

Edges:  0→1   0→2   1→3   2→3   2→4   3→5   4→5
```

**In-degrees** (count of incoming arrows):

```text
vertex :  0   1   2   3   4   5
indeg  :  0   1   1   2   1   2
```

### 7.1 Kahn FIFO trace

We run `KAHN` with a FIFO queue. `Q` holds the current in-degree-0 frontier; `L` is the output.

```text
init:   indeg = [0,1,1,2,1,2]    Q = [0]            L = []
step 1: pop 0 -> L=[0]
        relax 0→1: indeg[1]=0 -> push 1
        relax 0→2: indeg[2]=0 -> push 2
        Q = [1,2]                indeg=[_,0,0,2,1,2]
step 2: pop 1 -> L=[0,1]
        relax 1→3: indeg[3]=1   (still blocked by 2)
        Q = [2]
step 3: pop 2 -> L=[0,1,2]
        relax 2→3: indeg[3]=0 -> push 3
        relax 2→4: indeg[4]=0 -> push 4
        Q = [3,4]
step 4: pop 3 -> L=[0,1,2,3]
        relax 3→5: indeg[5]=1   (still blocked by 4)
        Q = [4]
step 5: pop 4 -> L=[0,1,2,3,4]
        relax 4→5: indeg[5]=0 -> push 5
        Q = [5]
step 6: pop 5 -> L=[0,1,2,3,4,5]
        Q = []  ->  done

Output (FIFO):  0 1 2 3 4 5     (|L| = 6 = |V|  ⇒  DAG, valid)
```

### 7.2 Lexicographically-smallest trace (min-heap frontier)

Same graph, but the frontier is a **min-heap** so we always emit the smallest ready vertex. On this graph the heap and FIFO agree, but consider step 3: when both `3` and `4` become ready the heap pops `3` first because `3 < 4`. The output `0 1 2 3 4 5` is the lexicographically smallest of the several valid orders (e.g. `0 2 1 4 3 5` and `0 1 2 4 3 5` are also valid but larger).

### 7.3 DFS reverse-postorder trace

Running recursive DFS from vertex `0` (children visited in ascending order), appending each vertex at *finish*:

```text
visit 0
  visit 1
    visit 3
      visit 5  -> finish 5      L=[5]
    finish 3                    L=[5,3]
  finish 1                      L=[5,3,1]
  visit 2
    (3 already black)
    visit 4
      (5 already black)
    finish 4                    L=[5,3,1,4]
  finish 2                      L=[5,3,1,4,2]
finish 0                        L=[5,3,1,4,2,0]

reverse(L) = 0 2 4 1 3 5        (a different — but equally valid — order)
```

Both Kahn and DFS produce *legal* orders; they differ because the in-degree-0 frontier admits a choice (§6: many linear extensions exist).

### 7.4 Counting the linear extensions of this DAG

Using the subset DP of §6, this particular poset has **exactly 5** linear extensions. The constraints are: `0` first, `5` last, `3` after both `1` and `2`, `4` after `2`. Enumerating the legal interleavings of the middle `{1,2,3,4}`:

```text
0 1 2 3 4 5
0 1 2 4 3 5
0 2 1 3 4 5
0 2 1 4 3 5
0 2 4 1 3 5
e(P) = 5
```

---

## 8. Reference Implementations (Go / Java / Python)

Three production-shaped routines, in the required order, each with cycle handling:
**(a)** DFS-based topological sort with explicit cycle detection,
**(b)** lexicographically-smallest order via a heap-backed Kahn,
**(c)** exact count of linear extensions via subset (bitmask) DP.

### 8.1 Go

```go
package toposort

import (
	"container/heap"
	"errors"
)

var ErrCycle = errors.New("graph has a cycle: no topological order exists")

// (a) DFS-based topological sort with cycle detection via 3-coloring.
// Returns the order, or ErrCycle if a back edge (gray target) is found.
func DFSTopo(n int, adj [][]int) ([]int, error) {
	const (
		white = 0
		gray  = 1
		black = 2
	)
	color := make([]int, n)
	order := make([]int, 0, n)

	var visit func(u int) error
	visit = func(u int) error {
		color[u] = gray
		for _, w := range adj[u] {
			switch color[w] {
			case gray:
				return ErrCycle // back edge
			case white:
				if err := visit(w); err != nil {
					return err
				}
			}
		}
		color[u] = black
		order = append(order, u) // finish
		return nil
	}

	for v := 0; v < n; v++ {
		if color[v] == white {
			if err := visit(v); err != nil {
				return nil, err
			}
		}
	}
	// order holds finish times ascending; reverse for topo order.
	for i, j := 0, len(order)-1; i < j; i, j = i+1, j-1 {
		order[i], order[j] = order[j], order[i]
	}
	return order, nil
}

// (b) Lexicographically smallest topological order via Kahn + min-heap.
type minHeap []int

func (h minHeap) Len() int            { return len(h) }
func (h minHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h minHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minHeap) Push(x any)         { *h = append(*h, x.(int)) }
func (h *minHeap) Pop() any           { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func LexTopo(n int, adj [][]int) ([]int, error) {
	indeg := make([]int, n)
	for u := 0; u < n; u++ {
		for _, w := range adj[u] {
			indeg[w]++
		}
	}
	h := &minHeap{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			heap.Push(h, v)
		}
	}
	order := make([]int, 0, n)
	for h.Len() > 0 {
		u := heap.Pop(h).(int)
		order = append(order, u)
		for _, w := range adj[u] {
			indeg[w]--
			if indeg[w] == 0 {
				heap.Push(h, w)
			}
		}
	}
	if len(order) != n {
		return nil, ErrCycle
	}
	return order, nil
}

// (c) Exact number of linear extensions via subset DP. n <= ~22.
func CountLinearExtensions(n int, adj [][]int) uint64 {
	// pred[v] = bitmask of v's predecessors.
	pred := make([]int, n)
	for u := 0; u < n; u++ {
		for _, w := range adj[u] {
			pred[w] |= 1 << uint(u)
		}
	}
	full := (1 << uint(n)) - 1
	dp := make([]uint64, 1<<uint(n))
	dp[0] = 1
	for mask := 0; mask <= full; mask++ {
		if dp[mask] == 0 {
			continue
		}
		for v := 0; v < n; v++ {
			if mask&(1<<uint(v)) != 0 {
				continue // v already emitted
			}
			if pred[v]&mask == pred[v] { // all preds present
				dp[mask|(1<<uint(v))] += dp[mask]
			}
		}
	}
	return dp[full]
}
```

### 8.2 Java

```java
import java.util.*;

public final class TopoProfessional {

    public static final class CycleException extends RuntimeException {
        public CycleException() { super("graph has a cycle"); }
    }

    // (a) DFS-based topological sort with cycle detection (3-color).
    public static int[] dfsTopo(int n, List<List<Integer>> adj) {
        int[] color = new int[n];      // 0=white 1=gray 2=black
        int[] order = new int[n];
        int[] idx = {n - 1};           // fill from the back = reverse postorder
        for (int v = 0; v < n; v++)
            if (color[v] == 0) visit(v, adj, color, order, idx);
        return order;
    }

    private static void visit(int u, List<List<Integer>> adj,
                              int[] color, int[] order, int[] idx) {
        color[u] = 1;
        for (int w : adj.get(u)) {
            if (color[w] == 1) throw new CycleException(); // back edge
            if (color[w] == 0) visit(w, adj, color, order, idx);
        }
        color[u] = 2;
        order[idx[0]--] = u;          // place at finish, growing backwards
    }

    // (b) Lexicographically smallest topological order via Kahn + min-heap.
    public static int[] lexTopo(int n, List<List<Integer>> adj) {
        int[] indeg = new int[n];
        for (int u = 0; u < n; u++)
            for (int w : adj.get(u)) indeg[w]++;
        PriorityQueue<Integer> pq = new PriorityQueue<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) pq.add(v);
        int[] order = new int[n];
        int k = 0;
        while (!pq.isEmpty()) {
            int u = pq.poll();
            order[k++] = u;
            for (int w : adj.get(u))
                if (--indeg[w] == 0) pq.add(w);
        }
        if (k != n) throw new CycleException();
        return order;
    }

    // (c) Exact count of linear extensions via subset DP. n <= ~22.
    public static long countLinearExtensions(int n, List<List<Integer>> adj) {
        int[] pred = new int[n];
        for (int u = 0; u < n; u++)
            for (int w : adj.get(u)) pred[w] |= 1 << u;
        int full = (1 << n) - 1;
        long[] dp = new long[1 << n];
        dp[0] = 1;
        for (int mask = 0; mask <= full; mask++) {
            if (dp[mask] == 0) continue;
            for (int v = 0; v < n; v++) {
                if ((mask & (1 << v)) != 0) continue;
                if ((pred[v] & mask) == pred[v])
                    dp[mask | (1 << v)] += dp[mask];
            }
        }
        return dp[full];
    }
}
```

### 8.3 Python

```python
import heapq


class CycleError(Exception):
    """Raised when the graph is not a DAG."""


def dfs_topo(n, adj):
    """(a) DFS-based topological sort with 3-color cycle detection."""
    WHITE, GRAY, BLACK = 0, 1, 2
    color = [WHITE] * n
    order = []

    def visit(u):
        color[u] = GRAY
        for w in adj[u]:
            if color[w] == GRAY:
                raise CycleError(f"back edge {u}->{w}")
            if color[w] == WHITE:
                visit(w)
        color[u] = BLACK
        order.append(u)          # finish

    for v in range(n):
        if color[v] == WHITE:
            visit(v)
    order.reverse()              # reverse postorder = topo order
    return order


def lex_topo(n, adj):
    """(b) Lexicographically smallest topological order (Kahn + heap)."""
    indeg = [0] * n
    for u in range(n):
        for w in adj[u]:
            indeg[w] += 1
    heap = [v for v in range(n) if indeg[v] == 0]
    heapq.heapify(heap)
    order = []
    while heap:
        u = heapq.heappop(heap)
        order.append(u)
        for w in adj[u]:
            indeg[w] -= 1
            if indeg[w] == 0:
                heapq.heappush(heap, w)
    if len(order) != n:
        raise CycleError("graph has a cycle")
    return order


def count_linear_extensions(n, adj):
    """(c) Exact count of linear extensions via subset DP. n <= ~22."""
    pred = [0] * n
    for u in range(n):
        for w in adj[u]:
            pred[w] |= 1 << u
    full = (1 << n) - 1
    dp = [0] * (1 << n)
    dp[0] = 1
    for mask in range(full + 1):
        if dp[mask] == 0:
            continue
        for v in range(n):
            if mask & (1 << v):
                continue
            if pred[v] & mask == pred[v]:   # all predecessors present
                dp[mask | (1 << v)] += dp[mask]
    return dp[full]


if __name__ == "__main__":
    n = 6
    adj = [[] for _ in range(n)]
    for u, v in [(0, 1), (0, 2), (1, 3), (2, 3), (2, 4), (3, 5), (4, 5)]:
        adj[u].append(v)
    print("dfs  :", dfs_topo(n, adj))           # e.g. 0 2 4 1 3 5
    print("lex  :", lex_topo(n, adj))           # 0 1 2 3 4 5
    print("count:", count_linear_extensions(n, adj))  # 5
```

All three count routines implement the same recurrence and agree on `e(P) = 5` for the §7 graph; the DFS and lexicographic routines return different but equally valid orders.

---

## 9. Lattice and Partial-Order Framing

The topological-sort problem lives inside order theory, and several deep facts follow from that framing.

- **The poset of down-sets is a distributive lattice.** Let `D(P)` be the set of all *down-closed* subsets (order ideals) of the poset `P` induced by the DAG — exactly the sets `mask` that appear with `dp[mask] > 0` in §8's DP. Ordered by inclusion, `D(P)` is a **distributive lattice** (Birkhoff's representation theorem: every finite distributive lattice arises this way). The DP of §6/§8 is a walk over this lattice from `∅` (bottom) to `V` (top); `e(P)` counts the **maximal chains** from bottom to top in `D(P)`.
- **Linear extensions = maximal chains in the ideal lattice.** Each topological order corresponds bijectively to one maximal chain `∅ ⊂ S₁ ⊂ S₂ ⊂ ⋯ ⊂ V` where each step adds one element. This is why counting them is the same as counting maximal chains, and why it is hard.
- **Dilworth / Mirsky decompositions.** Mirsky's theorem says the minimum number of antichains covering `P` equals the longest chain — that is exactly the **level count / critical-path length** used by the layered scheduler in [`senior.md`](./senior.md). Dilworth's theorem dually relates the minimum chain cover to the largest antichain — the maximum parallelism available at one moment.
- **Order polytope.** Stanley's order polytope `O(P) ⊂ [0,1]^V` (points `x` with `x_u ≤ x_v` whenever `u ≺ v`) has volume `e(P)/n!`. This geometric identity is what makes the FPRAS of §6 possible: approximate the volume by a random walk, multiply by `n!`.

So "find one order" is "find one maximal chain", "count orders" is "count all maximal chains / compute a polytope volume", and "layer for parallelism" is "Mirsky antichain decomposition". The partial-order language unifies the whole topic.

---

## 10. Online / Dynamic Topological Order (Pearce–Kelly)

In incremental settings (build systems that add edges as files reference each other, IDE dependency graphs, streaming pipelines) we want to maintain a valid topological order *as edges arrive*, without re-sorting from scratch.

**Setup.** Each vertex `v` carries an integer **ordinal** `ord[v]` such that `u → v ⟹ ord[u] < ord[v]` (a valid topological numbering). On inserting an edge `u → v`:

- If `ord[u] < ord[v]` already, the order is still valid — do nothing.
- If `ord[u] > ord[v]`, the new edge is a back edge in the current numbering; we must **reorder** the affected region.

**Pearce–Kelly (2007) idea.** Only the vertices whose ordinals lie *between* `ord[v]` and `ord[u]` can be affected. The algorithm:

```text
INSERT(u → v):
  if ord[u] < ord[v]: return            # already consistent
  DFS forward from v, visiting only vertices with ord < ord[u]  -> set F (reachable forward)
  DFS backward from u, visiting only vertices with ord > ord[v] -> set B (reaches u)
  if F and B intersect (we reached u from v): report CYCLE
  else: reassign ordinals so all of B come before all of F,
        keeping each side's relative order
```

**Cost.** The work is proportional to the size of the affected region `K = |F| + |B|` (vertices and their incident edges), not the whole graph. Pearce–Kelly bound the *total* work over a sequence of `m` insertions empirically near-linear and prove good amortized behavior; the worst case for `n` insertions is `O(n^{2.5})` (Bender–Fineman–Gilbert–Tarjan, 2016), still far better than re-running an `O(V+E)` sort after every edge.

**Cycle detection comes for free.** If the backward search from `u` reaches `v` (equivalently `F ∩ B ≠ ∅`), the inserted edge closes a cycle — the executor rejects it and reports the loop, exactly the pre-flight check of [`senior.md`](./senior.md) but done incrementally.

This is the algorithm behind incremental build invalidation: changing one file touches only the dependency-region it actually perturbs.

---

## 11. Cache Behavior and Memory Layout

Topological sort is **memory-bound**, not compute-bound: it does `Θ(1)` arithmetic per edge but one (often cache-missing) pointer-chase per adjacency traversal.

- **Adjacency list as CSR (compressed sparse row).** Store all neighbour lists in one flat array with an offset index per vertex. This makes the per-vertex edge scan a contiguous sweep — near-optimal spatial locality — versus a list-of-lists / pointer-based representation that scatters across the heap.
- **In-degree array** is `Θ(V)` contiguous `int`s; the decrements are random-access writes indexed by neighbour id, so they miss cache in proportion to graph irregularity. Renumbering vertices by a space-filling or BFS order improves locality.
- **DFS recursion** has poor locality (stack frames + scattered color writes) and risks stack overflow at depth `Θ(V)`; an explicit-stack iterative DFS or Kahn's algorithm is preferred for huge graphs.
- **Frontier structure.** A FIFO queue is contiguous and cache-friendly; a binary-heap frontier (lexicographic variant) adds `log V` random-access sift operations per push/pop.

In the external-memory model, topological sort of a DAG costs `Θ(sort(E))` I/Os = `Θ((E/B) log_{M/B}(E/B))` using the time-forward processing technique (Chiang et al., 1995), since the naive internal algorithm's random adjacency access is I/O-inefficient.

---

## 12. Average-Case Analysis on Random DAGs

Consider a random DAG model where vertices are labeled `1..n` and each forward edge `(i, j)` with `i < j` is included independently with probability `p` (this guarantees acyclicity).

- **Number of sources.** A vertex `j` is a source iff none of `(i, j)` for `i < j` is present: `P[j source] = (1-p)^{j-1}`. Expected source count `= Σ_{j=1}^{n} (1-p)^{j-1} = (1 - (1-p)^n)/p → 1/p` for large `n`. So sparser graphs (small `p`) have wider initial frontiers.
- **Longest path (critical path).** For constant `p`, the longest path length concentrates around `Θ(n)` with high probability (a dense random DAG is "tall"); for `p = c/n` (sparse, bounded average degree) the longest path is `Θ(log n / log log n)`-ish in related models. The longest path governs the parallel makespan floor (see [`senior.md`](./senior.md)).
- **Expected number of linear extensions.** Highly variable: ranges from `1` (when the random graph happens to be a chain-like dense poset) up to `n!` (empty graph). The expectation is dominated by sparse instances and is super-polynomial, consistent with the #P-hardness of the exact count.
- **Frontier size over time.** Empirically the Kahn frontier in a random DAG rises then falls (a "wave"), peaking near the middle layers; its maximum determines the peak parallelism available to a scheduler.

These averages explain why real build graphs (sparse, shallow critical paths, wide middle layers) parallelize well.

---

## 13. Space-Time Trade-offs

| Variant | Time | Aux space | Note |
|---|---|---|---|
| Kahn (FIFO queue) | Θ(V+E) | Θ(V) | Smallest constants; recursion-free. |
| Kahn (min-heap, lexicographic) | Θ(V log V + E) | Θ(V) | `log V` only on the `V` heap ops. |
| DFS recursive | Θ(V+E) | Θ(V) stack | Stack-overflow risk at depth Θ(V). |
| DFS explicit-stack | Θ(V+E) | Θ(V) | Same time, heap-allocated stack, deep-safe. |
| Online (Pearce–Kelly) | amortized sub-`O(V+E)` per edge insert | Θ(V) | Maintains order under incremental edges (§11). |
| Count extensions (exact) | Θ(2^V · V) | Θ(2^V) | #P-hard; small graphs only. |
| Count extensions (FPRAS) | poly(V, 1/ε) | poly(V) | Randomized `(1±ε)` approximation. |

The dominant trade-off is **lexicographic ordering costs a `log V` factor**, and **any exact count costs exponential time**. Everything else is linear.

---

## 14. Comparison with Alternatives

| Task | Tool | Complexity | Note |
|---|---|---|---|
| One topological order | Kahn / DFS | Θ(V+E) | Optimal. |
| Lexicographically smallest order | Kahn + min-heap | Θ(V log V + E) | Greedy on the frontier. |
| Order a graph that may have cycles | SCC condensation + topo sort | Θ(V+E) | Tarjan/Kosaraju collapse cycles, then sort the DAG of SCCs. |
| Shortest path in a DAG | topo order + relax | Θ(V+E) | Beats Dijkstra; allows negative weights. |
| Longest path / critical path in a DAG | topo order + relax (max) | Θ(V+E) | NP-hard on general graphs; linear on DAGs. |
| Count `s→t` paths | topo order + DP | Θ(V+E) | Accumulate from predecessors. |
| Count all topological orders | subset DP / FPRAS | Θ(2^V·V) / poly | #P-complete exactly. |

Topological order is unusual: it is the cheap (`Θ(V+E)`) enabler that makes several otherwise-hard graph problems (longest path, negative-weight shortest path) linear *on DAGs*.

---

## 15. Open Problems — Online / Dynamic Topological Order

The static problem is solved (linear, optimal); §10 covered the practical Pearce–Kelly maintenance algorithm. The research frontier is the *worst-case* complexity of **maintenance under change**.

1. **Online topological ordering.** Maintain a topological order while edges are inserted one at a time (as in incremental build systems). The Pearce–Kelly algorithm (2007) achieves good practical amortized bounds; Bender, Fineman, Gilbert & Tarjan (2016) gave `O(n^{2.5})` total for `n` edge insertions in the worst case. The tight worst-case bound for incremental topological order remains an active question.

2. **Fully dynamic (insertions *and* deletions).** Maintaining a topological order (or even just acyclicity) under both edge insertions and deletions with polylogarithmic update time is harder; strong conditional lower bounds (from the Online Matrix-Vector / OMv conjecture) suggest large polynomial update time may be unavoidable for related dynamic reachability problems.

3. **Dynamic cycle detection.** Closely tied to online ordering: detecting the first edge insertion that creates a cycle efficiently. Incremental cycle detection in `Õ(E^{...})` total time has seen recent improvements (Bernstein–Chechik and others) but optimal bounds are open.

4. **Parallel / distributed topological order with provable speedup.** Work-efficient parallel algorithms exist (parallel Kahn peels in-degree-0 layers; depth = longest path, work = `O(V+E)`), but matching the sequential work while minimizing depth on irregular sparse DAGs, and doing so I/O- and communication-efficiently, is still being refined.

5. **Approximate counting in practice.** Although an FPRAS exists, designing rapidly-mixing, practically-fast samplers of linear extensions for large real-world posets (with good empirical constants) is an ongoing research and engineering goal.

---

## 16. Summary

- **Order theory.** A topological order is precisely a **linear extension** of the reachability partial order; ordering every edge correctly is equivalent to ordering every reachable pair correctly.
- **Existence.** A finite digraph has a topological order **iff** it is acyclic; both Kahn's algorithm (emitted `< V` ⟺ cycle) and DFS reverse-postorder (back edge ⟺ cycle) prove this constructively.
- **Correctness.** Kahn's via a frontier loop invariant; DFS via the finish-time inequality `finish(w) < finish(u)` for every edge `(u,w)`, justified by the white-path theorem.
- **Complexity.** `Θ(V + E)` time, `Θ(V)` space — and `Ω(V + E)` is a matching lower bound, so the algorithms are optimal.
- **Counting.** Counting linear extensions is **#P-complete** (Brightwell–Winkler 1991): exact counting is `Θ(2^V·V)` subset DP, while a randomized FPRAS approximates it in polynomial time.
- **Cache & external memory.** Memory-bound; CSR layout and contiguous frontiers matter; external-memory cost is `Θ(sort(E))` via time-forward processing.
- **Open problems.** Online and fully-dynamic topological order, dynamic cycle detection, and practical fast approximate counting remain active research.

Kahn (1962) and the DFS reverse-postorder method (Tarjan / Knuth, formalized in CLRS Ch. 22) gave the linear algorithms; Brightwell–Winkler (1991) settled the counting complexity; Pearce–Kelly (2007) and Bender et al. (2016) drive the dynamic-maintenance frontier. The problem is 60 years old, optimal to solve once, and provably hard to count — a clean illustration of the gap between search and counting.
