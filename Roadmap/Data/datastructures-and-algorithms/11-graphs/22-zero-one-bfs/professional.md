# 0-1 BFS — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definition
2. Correctness Proof — The Two-Level Deque Invariant
3. Equivalence to Dijkstra with a 2-Bucket Priority Queue
4. O(V + E) Complexity Proof
5. Generalization to Dial's Algorithm — O(V + E + maxDist)
6. Cache and Memory-Hierarchy Analysis
7. Average-Case and Frontier-Size Analysis
8. Space-Time Trade-offs
9. Comparison with Alternatives (asymptotics + constants)
10. Open Problems and Research Directions
11. Summary

---

## 1. Formal Definition

Let `G = (V, E)` be a directed graph with a weight function `w : E → {0, 1}`. (Undirected graphs are handled by adding both orientations of each edge.) Fix a source `s ∈ V`. The **single-source shortest path (SSSP)** problem asks for

```text
δ(v) = min { Σ_{e ∈ P} w(e) : P is an s⇝v path }      for all v ∈ V,
```

with `δ(v) = +∞` if no path exists.

**Definition 1.1 (0-1 BFS).** Maintain an array `dist[v]`, initialised `dist[s] = 0` and `dist[v] = +∞` otherwise, and a double-ended queue `Q` initialised to `⟨s⟩`. Repeat until `Q` is empty:

```text
u ← Q.pop_front()
if u is already settled: continue          (* stale skip *)
mark u settled
for each (u, v) ∈ E with weight w:
    if dist[u] + w < dist[v]:
        dist[v] ← dist[u] + w
        if w = 0: Q.push_front(v)
        else:     Q.push_back(v)
```

**Definition 1.2 (Deque operations).** `push_front`, `push_back`, `pop_front` each run in `O(1)` (e.g. on a doubly linked list or a power-of-two ring buffer). This `O(1)` deque is the only structural assumption distinguishing 0-1 BFS from Dijkstra.

**Definition 1.3 (Settled).** A vertex `u` is *settled* at the first instant it is removed from the front of `Q` and not skipped. We will prove `dist[u] = δ(u)` at that instant.

We use the convention that the deque stores vertices and the algorithm reads `dist[u]` on pop; the "store the distance in the deque and compare" variant is equivalent (§2.6).

---

## 2. Correctness Proof — The Two-Level Deque Invariant

We prove 0-1 BFS computes `δ` correctly. The proof rests on a structural invariant about the contents of `Q`.

### 2.1 The Key Invariant

**Lemma 2.1 (Two-level monotonicity).** Let `d` be the distance of the vertex at the front of `Q` (the value `dist[front]` at the time it will be popped). At every point during execution, reading `Q` from front to back, the associated `dist` values are non-decreasing and lie in `{d, d+1}`. Formally, there is a (possibly empty) front segment all of value `d` followed by a (possibly empty) rear segment all of value `d+1`.

**Proof.** By induction on the number of operations.

*Base.* `Q = ⟨s⟩` with `dist[s] = 0`. One element, value `d = 0`. Holds.

*Step.* Assume the invariant before an operation. Two cases.

- **A pop.** Removing the front element cannot increase the spread of remaining values; the remaining elements are a suffix of a non-decreasing sequence in `{d, d+1}`. If the entire `d`-segment is now gone, the new front has value `d+1`, and relative to the new front value `d' = d+1` the contents lie in `{d+1} ⊆ {d', d'+1}`. Holds.

- **A push during expansion of a popped vertex `u` with `dist[u] = d`.** When `u` is expanded it is (or was) the front, so by the invariant the live values are in `{d, d+1}`.
  - A **0-edge** sets `dist[v] = d` and does `push_front(v)`. The front segment has value `d`, so prepending another `d` keeps the front segment uniform at `d`; the rest is unchanged. Values still `{d, d+1}`. Holds.
  - A **1-edge** sets `dist[v] = d+1` and does `push_back(v)`. The rear segment has value `d+1`, so appending another `d+1` keeps it uniform. Values still `{d, d+1}`. Holds.

In all cases the invariant is preserved. ∎

### 2.2 Front = Minimum

**Corollary 2.2.** At every pop, the front vertex has the minimum `dist` value among all vertices currently in `Q`.

**Proof.** Immediate from Lemma 2.1: the front segment carries the smaller of the two live values. ∎

### 2.3 Distances Are Settled in Non-Decreasing Order

**Lemma 2.3.** The sequence of `dist` values at which vertices are settled is non-decreasing over time.

**Proof.** A vertex is settled when popped from the front. By Corollary 2.2 the front is the current minimum. New pushes only ever create values in `{d, d+1}` where `d` is the current front value, so no value smaller than the current front is ever introduced. Hence successive settled values never decrease. ∎

### 2.4 Optimality at Settling Time

**Theorem 2.4 (Correctness).** When a vertex `u` is settled, `dist[u] = δ(u)`.

**Proof.** Suppose, for contradiction, that some vertex is settled with `dist[u] > δ(u)`, and let `u` be the **first** such vertex (in settling order). Let `P` be a shortest `s⇝u` path, `δ(u) = w(P)`. Let `y` be the last vertex on `P` that is settled with the correct distance `dist[y] = δ(y)` before `u` is settled (such a `y` exists: `s` is settled first with `dist[s] = 0 = δ(s)`). Let `(y, z)` be the edge of `P` leaving `y` toward `u`, with weight `w(y,z) ∈ {0,1}`.

When `y` was settled (correctly), the algorithm relaxed `(y, z)`:

```text
dist[z] ≤ dist[y] + w(y,z) = δ(y) + w(y,z) = δ(z)
```

(the last equality because `(y,z)` lies on a shortest path, so prefixes of shortest paths are shortest). Since distances never undershoot `δ` (they correspond to real path costs), `dist[z] = δ(z)` from that point on, and `z` was pushed into `Q`.

If `z = u`, then `dist[u] = δ(u)`, contradicting the assumption. Otherwise `z` lies strictly between `y` and `u` on `P`, and by choice of `y` (the *last* correctly-settled vertex before `u`) `z` is **not** settled before `u`. But `z` is in `Q` with `dist[z] = δ(z) ≤ δ(u)`. By Lemma 2.3 the algorithm settles vertices in non-decreasing distance order, so `z` (distance `≤ δ(u) < dist[u]`) would be settled **before** `u` — contradiction with "`z` not settled before `u`".

Hence no such `u` exists: every vertex is settled with `dist[u] = δ(u)`. ∎

### 2.5 Termination

Each vertex is settled at most once (the `settled` flag / stale skip). Each settling triggers `O(deg(u))` relaxations, each of which pushes at most once. Thus the number of pushes is at most `Σ_u deg(u) + 1 = O(V + E)`, finite; the loop terminates. ∎

### 2.6 Equivalence of the Two Stale-Handling Styles

The "store `(d, u)` and skip if `d > dist[u]`" style and the "store `u`, settle-flag" style accept exactly the same final `dist` array: both expand each vertex exactly once, at its minimum distance, and both ignore later (larger) re-pushes. The proofs above apply verbatim to either, since neither changes the order of front-pops of the minimum live value. ∎

---

## 3. Equivalence to Dijkstra with a 2-Bucket Priority Queue

Dijkstra's algorithm requires a priority queue supporting `extract-min` and `decrease-key`. Its only correctness requirement is that `extract-min` returns a vertex of minimum tentative distance (this is exactly the property used in the classical Dijkstra proof, structurally identical to Theorem 2.4).

**Proposition 3.1.** With `w : E → {0,1}`, the set of finite tentative distances present in Dijkstra's priority queue at any time spans at most two consecutive integers.

**Proof.** Dijkstra settles in non-decreasing distance order; let `d` be the distance of the most recently settled vertex. Any unsettled vertex `v` in the queue has `dist[v] = dist[x] + w(x,v)` for some settled `x` with `dist[x] ≤ d`, so `dist[v] ≤ d + 1`. Also `dist[v] ≥ d` (a smaller value would have been settled already). Hence every live tentative distance is `d` or `d+1`. ∎

**Theorem 3.2.** 0-1 BFS is Dijkstra's algorithm with the priority queue realised as a **two-bucket structure** — bucket `d` (the deque front segment) and bucket `d+1` (the deque rear segment).

**Proof.** By Proposition 3.1 a two-bucket queue suffices for Dijkstra under 0/1 weights. The deque realises exactly this: `push_front` inserts into bucket `d` (a 0-edge keeps distance `d`), `push_back` inserts into bucket `d+1` (a 1-edge advances distance to `d+1`), and `pop_front` performs `extract-min` by draining bucket `d` before bucket `d+1`. The `decrease-key` of Dijkstra is realised lazily: an improved distance pushes a fresh copy, and the stale copy is discarded on pop (Theorem 2.4 / §2.6). Hence the two algorithms expand vertices in the identical order and produce identical results. ∎

This is the deep reason 0-1 BFS drops Dijkstra's `log V` factor: the `log V` exists only to support an *arbitrary-key* priority queue; two buckets are an exact `O(1)` priority queue for the 0/1 case.

---

## 4. O(V + E) Complexity Proof

**Theorem 4.1.** 0-1 BFS runs in `O(V + E)` time and `O(V)` space.

**Proof.**

*Time.* Initialising `dist` is `O(V)`. Each vertex is settled (expanded) at most once by the `settled` flag (§2.5). When `u` is expanded, the algorithm scans its `deg(u)` outgoing edges, performing `O(1)` work per edge (a comparison, possibly a `dist` write and one `O(1)` deque push). Summed over all settled vertices:

```text
Σ_{u ∈ V} O(1 + deg(u)) = O(V) + O(Σ_u deg(u)) = O(V + E).
```

The number of pops is at most the number of pushes; each push corresponds to a successful relaxation, of which there are at most `E` (one per edge per settling of its tail), plus the initial source push. Stale pops are bounded by total pushes, so the pop work is also `O(V + E)`. Each deque operation is `O(1)` (Definition 1.2). Total: `O(V + E)`.

*Space.* `dist` and `settled` are `O(V)`. The deque holds at most the number of unsettled pushed vertices. In the settled-flag style each vertex is pushed `O(deg(u))` times in the worst case, so the deque can in principle hold `O(E)` entries; in practice the live (unsettled) count is `O(V)`. Either way the asymptotic space is `O(V + E)` worst case, `O(V)` typical. ∎

**Remark 4.2 (Tightness).** The bound is tight: a graph that is a single path of `V` vertices with `V−1` edges forces `Θ(V)` settles and `Θ(V)` edge scans; a complete digraph forces `Θ(V + E) = Θ(V²)` edge scans. No comparison-free improvement is possible because every edge must be examined to certify a shortest path in the worst case.

---

## 5. Generalization to Dial's Algorithm — O(V + E + maxDist)

When `w : E → {0, 1, …, k}` for a small integer `k`, the two-bucket deque generalises to a **bucket array** indexed by distance — **Dial's algorithm** (Dial 1969).

### 5.1 Definition

Maintain buckets `B[0 .. maxDist]`, where `maxDist` is an upper bound on `δ(v)` over reachable `v` (at most `(V−1)·k`). Process buckets in increasing index; relaxing `(u, v, w)` from a vertex at distance `d = dist[u]` inserts `v` into `B[d + w]`.

```text
B[0].add(s); dist[s] = 0
for d = 0 to maxDist:
    while B[d] nonempty:
        u = B[d].pop()
        if d > dist[u]: continue           (* stale *)
        for (u, v, w) ∈ E:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                B[dist[v]].add(v)
```

### 5.2 Correctness

**Proposition 5.1.** Dial's algorithm settles vertices in non-decreasing distance order, hence (by the same exchange argument as Theorem 2.4) computes `δ` correctly.

**Proof.** Buckets are scanned by increasing index `d`. A vertex is settled when first popped from its bucket `B[dist[v]]`. Because we never revisit a smaller index after advancing, and a relaxation from distance `d` with weight `w ≥ 0` always targets bucket `d + w ≥ d`, no vertex is settled at a smaller distance after a larger one. The non-decreasing-order property then drives the standard Dijkstra optimality argument. ∎

### 5.3 Complexity

**Theorem 5.2.** Dial's algorithm runs in `O(V + E + maxDist)` time and `O(V + maxDist)` space.

**Proof.** Allocating and scanning the bucket array costs `O(maxDist)` (we touch each index once, even empty ones). Each vertex is settled once: `O(V)` settles, `O(E)` edge relaxations, each `O(1)`. Summing: `O(V + E + maxDist)`. Space: `dist` is `O(V)`, the buckets together hold `O(V + E)` entries over time but `O(V)` live, plus `O(maxDist)` bucket headers. ∎

**Corollary 5.3.** 0-1 BFS is Dial's algorithm with `k = 1`, where at most two consecutive buckets are ever simultaneously nonempty (Lemma 2.1), so the bucket array degenerates to a sliding window of width 2 — implementable as a single deque, eliminating the `O(maxDist)` term and giving `O(V + E)`.

**Remark 5.4 (When Dial's loses).** If `maxDist` is large (large `k` or long paths), the `O(maxDist)` term and the empty-bucket scans dominate. With weights bounded by `C`, a *radix heap* (Ahuja–Mehlhorn–Orlin–Tarjan 1990) achieves `O(E + V log C)`; for arbitrary non-negative weights, a binary-heap Dijkstra at `O(E log V)` is the fallback.

---

## 6. Cache and Memory-Hierarchy Analysis

We use the external-memory model: block size `B`, cache size `M`, counting I/Os.

### 6.1 Why 0-1 BFS is cache-friendly

The hot data structures are flat arrays: `dist[V]`, `settled[V]`, and a ring-buffer deque. Compared to Dijkstra's binary heap — whose `sift_down` jumps between parent index `i` and child `2i+1`, crossing a cache block once `2i+1 > B` — the deque touches contiguous memory at both ends.

**Proposition 6.1.** The deque incurs `O(1/B)` amortised cache misses per push/pop on a ring buffer (sequential access at head and tail), versus `Θ(log(n/B))` misses per heap operation in Dijkstra.

**Proof sketch.** A ring buffer's head and tail advance by one slot per operation; consecutive operations touch the same cache block until it is exhausted, amortising to `1/B` misses per op. A binary heap operation traverses a root-to-leaf path of length `Θ(log n)`, and each level beyond depth `log B` lands in a distinct block, giving `Θ(log(n/B))` misses. ∎

### 6.2 Adjacency layout

Storing the graph in CSR with the weight packed into one bit of each target id (§ senior.md) means a vertex's entire neighbour list is one contiguous run of `deg(u)` words — `⌈deg(u)/B⌉` block reads, optimal for a scan. This is why 0-1 BFS at scale is memory-bandwidth-bound on the CSR `targets` array rather than compute-bound.

---

## 7. Average-Case and Frontier-Size Analysis

### 7.1 Frontier size

The "frontier" is the set of live (pushed, unsettled) vertices. In a graph with bounded degree `Δ`, each settling pushes at most `Δ` neighbours, so the deque grows by at most `Δ − 1` per pop. On grids (`Δ = 4`) the live frontier typically scales with the *perimeter* of the explored region, `Θ(√V)` for a 2D ball, not `Θ(V)`. This keeps the deque small in practice and the ring buffer cache-resident.

Concretely, on a `1000 × 1000` grid (`V = 10^6`), a roughly circular settled region of radius `r` has perimeter `≈ 2πr`. At the half-explored point (`r ≈ 564`, half the cells settled) the live frontier is on the order of `3.5·10^3` entries — about `0.35%` of `V`. So a ring buffer sized to a few thousand `int32` (tens of KB) is L1/L2-resident throughout, whereas a binary heap for the same problem would hold up to `Θ(V)` entries and spill to L3/RAM. This perimeter-vs-area gap is a second, often-overlooked reason 0-1 BFS outruns heap-Dijkstra in practice, independent of the asymptotic `log V`.

### 7.2 Expected stale pops

With the distance-check style, a vertex is re-pushed each time a strictly shorter path is found before it settles. On random 0/1-weighted graphs the expected number of improving relaxations per vertex is `O(1)` (few predecessors improve it after the first reaching path), so the expected total work stays `Θ(V + E)` with a small constant. The settled-flag style bounds re-expansion to zero regardless.

### 7.3 Number of distinct distance levels

The diameter in the 0/1 metric is at most the number of 1-edges on the longest shortest path, `≤ V − 1`. The deque only ever holds two adjacent levels (Lemma 2.1), so the *number of levels* affects total iterations but never the deque's instantaneous size — this is precisely why 0-1 BFS avoids Dial's `O(maxDist)` term.

---

## 7B. A Fully Worked Numeric Trace

To make Lemma 2.1 and Theorem 2.4 concrete, we trace the algorithm on a small instance and watch the two-level invariant hold at every step.

Directed graph (vertices `A=0 … E=4`), edge weights in braces:

```text
A --0--> B        A --1--> C
B --1--> D        B --0--> E
C --1--> E        E --0--> D
```

State columns: the popped vertex, the action taken, the deque rendered as
`front … back` with each entry `vertex(dist)`, and the live distance values present.

```text
init                          deque = [A(0)]                    levels = {0}
pop A(0)  settle A=0
  A->B w0  dist[B]=0 pf B     deque = [B(0)]                    levels = {0}
  A->C w1  dist[C]=1 pb C     deque = [B(0), C(1)]              levels = {0,1}
pop B(0)  settle B=0
  B->D w1  dist[D]=1 pb D     deque = [C(1), D(1)]              levels = {1}
  B->E w0  dist[E]=0 pf E     deque = [E(0), C(1), D(1)]        levels = {0,1}
pop E(0)  settle E=0
  E->D w0  dist[D]=0 pf D     deque = [D(0), C(1), D(1)]        levels = {0,1}*
pop D(0)  settle D=0          deque = [C(1), D(1)]              levels = {1}
pop C(1)  settle C=1
  C->E w1  1+1=2 ≥ dist[E]=0  no push
                              deque = [D(1)]                    levels = {1}
pop D(1)  STALE (1 > dist[D]=0)  skip; metrics.stale++
                              deque = []                        done
```

(*) At the starred step there are two `D` entries: the fresh `D(0)` at the front and
a stale `D(1)` still lurking near the back. The invariant "values are `{d, d+1}`"
counts *live* (not-yet-settled, distance-current) entries; the stale `D(1)` is
discarded harmlessly when popped. Final `δ = (A:0, B:0, C:1, D:0, E:0)`.

Two observations the trace makes vivid:

1. **The level set is always a subset of `{d, d+1}`** for the current front value `d`
   — the algebraic content of Lemma 2.1.
2. **A vertex can be enqueued twice** (here `D`), once via a 1-edge then improved via
   a 0-edge; the later, smaller value is what survives, and the earlier copy becomes a
   stale skip — the mechanism that makes the lazy `decrease-key` of Theorem 3.2 correct.

---

## 7C. Reference Implementations

Three idiomatic, self-contained implementations producing the trace above. Each uses
the settled-flag stale-handling style and a deque with `O(1)` ends.

### Go

```go
package main

import "fmt"

type Edge struct{ to, w int } // w in {0,1}

// ZeroOneBFS: settled-flag style; deque via two slices for O(1) both ends.
func ZeroOneBFS(adj [][]Edge, n, src int) []int {
	const INF = 1 << 30
	dist := make([]int, n)
	settled := make([]bool, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0

	front := []int{src} // logical front: top of this stack
	var back []int      // logical back: in order
	pop := func() int {
		if len(front) > 0 {
			x := front[len(front)-1]
			front = front[:len(front)-1]
			return x
		}
		for i := len(back) - 1; i >= 0; i-- {
			front = append(front, back[i])
		}
		back = back[:0]
		x := front[len(front)-1]
		front = front[:len(front)-1]
		return x
	}
	empty := func() bool { return len(front) == 0 && len(back) == 0 }

	for !empty() {
		u := pop()
		if settled[u] {
			continue // stale
		}
		settled[u] = true
		for _, e := range adj[u] {
			nd := dist[u] + e.w
			if nd < dist[e.to] {
				dist[e.to] = nd
				if e.w == 0 {
					front = append(front, e.to)
				} else {
					back = append(back, e.to)
				}
			}
		}
	}
	return dist
}

func main() {
	adj := make([][]Edge, 5)
	adj[0] = []Edge{{1, 0}, {2, 1}}
	adj[1] = []Edge{{3, 1}, {4, 0}}
	adj[2] = []Edge{{4, 1}}
	adj[4] = []Edge{{3, 0}}
	fmt.Println(ZeroOneBFS(adj, 5, 0)) // [0 0 1 0 0]
}
```

### Java

```java
import java.util.*;

public final class ZeroOneBFS {
    record Edge(int to, int w) {}

    static int[] run(List<Edge>[] adj, int n, int src) {
        final int INF = Integer.MAX_VALUE / 2;
        int[] dist = new int[n];
        boolean[] settled = new boolean[n];
        Arrays.fill(dist, INF);
        dist[src] = 0;
        Deque<Integer> dq = new ArrayDeque<>();
        dq.addFirst(src);
        while (!dq.isEmpty()) {
            int u = dq.pollFirst();
            if (settled[u]) continue;      // stale
            settled[u] = true;
            for (Edge e : adj[u]) {
                int nd = dist[u] + e.w();
                if (nd < dist[e.to()]) {
                    dist[e.to()] = nd;
                    if (e.w() == 0) dq.addFirst(e.to());
                    else            dq.addLast(e.to());
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        int n = 5;
        List<Edge>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new Edge(1, 0)); adj[0].add(new Edge(2, 1));
        adj[1].add(new Edge(3, 1)); adj[1].add(new Edge(4, 0));
        adj[2].add(new Edge(4, 1));
        adj[4].add(new Edge(3, 0));
        System.out.println(Arrays.toString(run(adj, n, 0))); // [0, 0, 1, 0, 0]
    }
}
```

### Python

```python
from collections import deque

def zero_one_bfs(adj, n, src):
    INF = float("inf")
    dist = [INF] * n
    settled = [False] * n
    dist[src] = 0
    dq = deque([src])
    while dq:
        u = dq.popleft()
        if settled[u]:          # stale
            continue
        settled[u] = True
        for v, w in adj[u]:
            nd = dist[u] + w
            if nd < dist[v]:
                dist[v] = nd
                dq.appendleft(v) if w == 0 else dq.append(v)
    return dist


if __name__ == "__main__":
    adj = {
        0: [(1, 0), (2, 1)],
        1: [(3, 1), (4, 0)],
        2: [(4, 1)],
        3: [],
        4: [(3, 0)],
    }
    print(zero_one_bfs(adj, 5, 0))  # [0, 0, 1, 0, 0]
```

All three settle each vertex once, skip stale re-pops, and reproduce
`δ = (0, 0, 1, 0, 0)` from the trace in §7B.

---

## 8. Space-Time Trade-offs

| Variant | Time | Space | Note |
|---|---|---|---|
| Deque, settled-flag | `O(V+E)` | `O(V)` live + `O(E)` worst deque | One expansion per vertex; minimal re-work. |
| Deque, distance-check | `O(V+E)` | `O(E)` worst deque | No flag array; relies on lazy skip. |
| Dial's bucket array | `O(V+E+maxDist)` | `O(V+maxDist)` | Generalises to `0..k`. |
| Dijkstra binary heap | `O(E log V)` | `O(V)` | Arbitrary non-negative weights. |
| Radix heap | `O(E + V log C)` | `O(V + log C)` | Integer weights bounded by `C`. |

The deque variants are Pareto-optimal for `{0,1}` weights: nothing achieves `o(V + E)` (every edge must be inspected), and the constants are the smallest among the options because no heap or bucket-scan overhead is paid.

**Path reconstruction** adds an `O(V)` `parent[]` array and `O(path length)` reconstruction time, no change to asymptotics.

---

## 9. Comparison with Alternatives (asymptotics + constants)

### 9.1 Asymptotics

| Algorithm | Weight model | Time | Space |
|---|---|---|---|
| Plain BFS | unweighted | `O(V+E)` | `O(V)` |
| **0-1 BFS** | `{0,1}` | **`O(V+E)`** | `O(V)` |
| Dial's | `{0..k}` int | `O(V+E+maxDist)` | `O(V+maxDist)` |
| Dijkstra (binary heap) | non-negative | `O(E log V)` | `O(V)` |
| Dijkstra (Fibonacci heap) | non-negative | `O(E + V log V)` | `O(V)` |
| Radix heap | non-negative ints ≤ C | `O(E + V log C)` | `O(V + log C)` |
| Bellman–Ford | arbitrary (neg ok) | `O(V·E)` | `O(V)` |

### 9.2 Constant Factors

For a 4-regular grid of `N` cells, full SSSP, indicative ns-per-edge on commodity hardware:

```text
plain BFS              : ~3 ns / edge
0-1 BFS (ring deque)   : ~4 ns / edge
Dial's (small k)       : ~5 ns / edge   + maxDist bucket sweep
Dijkstra (binary heap) : ~12 ns / edge  (heap sift + cache misses)
Dijkstra (4-ary heap)  : ~9 ns / edge
```

0-1 BFS sits essentially at BFS speed: the only overhead over plain BFS is the per-edge weight read and the front/back branch, both predictable. The 2–3× gap to Dijkstra is the eliminated `log V` heap work plus the deque's superior cache profile (§6).

### 9.3 The boundary cases

- **All weights 0:** every vertex settles at distance 0; the deque behaves as a stack/queue hybrid but the result (all reachable = 0) is trivially correct.
- **All weights 1:** every push is `push_back`; the deque is a FIFO queue and 0-1 BFS is *identical* to plain BFS. This confirms 0-1 BFS strictly generalises BFS.

---

## 10. Open Problems and Research Directions

1. **Parallel work-optimal 0-1 BFS.** Δ-stepping gives work-efficient parallel SSSP for general weights; whether a strictly work-optimal, low-depth parallel algorithm specialised to `{0,1}` weights with provably better span than general Δ-stepping is fully characterised remains an engineering-research gap.

2. **Dynamic 0-1 SSSP.** Maintaining `δ` under edge flips (0↔1) faster than recompute. Decremental and fully-dynamic SSSP have known bounds for general weights (e.g. Bernstein–Chechik); tight bounds for the restricted 0/1 case, exploiting the two-level structure, are less explored.

3. **Cache-oblivious 0-1 BFS.** BFS has cache-oblivious variants (Munagala–Ranade, buffered repository trees). Adapting these to the deque/two-bucket structure of 0-1 BFS with optimal `O((V+E)/B)`-style I/O bounds is a refinement question.

4. **Streaming / semi-streaming.** In the semi-streaming model (`O(V polylog V)` memory, few passes), approximate and exact shortest paths are studied; the 0/1 special case may admit fewer passes or smaller memory.

5. **Negative-edge analogues.** 0/1 weights are non-negative; a clean deque-based analogue for `{-1, 0, +1}` weights (which can encode certain DP/difference-constraint systems) without falling back to full Bellman–Ford is of interest where no negative cycle exists.

---

## 10B. Relationship to Difference Constraints and 0-1 Structures

0-1 BFS is the shortest-path engine behind several theoretical reductions, which is worth seeing because it explains *why* the 0/1 restriction shows up so often.

### 10B.1 Boolean reachability with cost

Consider a system of constraints `x_v − x_u ≤ c(u,v)` with `c ∈ {0,1}` (a restricted *difference-constraint system*). Its feasibility/optimal-potential problem maps to single-source shortest paths in the constraint graph; when all constraint constants are 0 or 1 and non-negative, 0-1 BFS solves it in `O(V + E)` instead of the general `O(V·E)` Bellman–Ford used for arbitrary difference constraints. This is the formal backbone of "minimum number of unit adjustments" problems.

### 10B.2 Layered / product graphs

State-augmented 0-1 BFS (vertex `= (position, state)`) is shortest paths on a *product graph* `G × S`. The two-level invariant (Lemma 2.1) is preserved under the product because edge weights remain in `{0,1}`; only `|V|` scales to `|V|·|S|`. Thus the complexity becomes `O((V + E)·|S|)` — exact, with no heap, as long as the state-transition weights stay binary. This is the rigorous justification for the "just make the vertex a tuple" modelling advice.

### 10B.3 Why the boundary is exactly 1

The deque works because the reachable-distance window has width 1 (values `{d, d+1}`). With a weight `k ≥ 2`, the window widens to `{d, …, d+k}` and a single front/back distinction can no longer separate the current minimum from the rest — you need `k+1` buckets (Dial's). So the "0/1" restriction is not arbitrary: it is precisely the largest weight set for which a *two-ended* structure is an exact priority queue.

---

## 11. Summary

- **Model.** 0-1 BFS solves SSSP for `w : E → {0,1}` by maintaining a deque, pushing 0-edges to the front and 1-edges to the back, and settling each vertex on its first front-pop.
- **Invariant.** The deque always holds at most two consecutive distance values `{d, d+1}`, with the smaller in front (Lemma 2.1). Hence `pop_front` is an exact `extract-min`.
- **Correctness.** Vertices settle in non-decreasing distance order, and the standard shortest-path exchange argument shows each is settled with `dist[u] = δ(u)` (Theorem 2.4).
- **Equivalence.** 0-1 BFS is exactly Dijkstra with a 2-bucket priority queue; the `log V` factor vanishes because two buckets are an `O(1)` priority queue for 0/1 weights (Theorem 3.2).
- **Complexity.** `O(V + E)` time, `O(V)` space — tight, since every edge must be inspected (Theorem 4.1).
- **Generalization.** For `{0..k}` weights, the deque becomes Dial's bucket array at `O(V + E + maxDist)` (Theorem 5.2); 0-1 BFS is the `k = 1` case where the bucket array collapses to a width-2 window (Corollary 5.3). Beyond small `k`, use radix-heap or binary-heap Dijkstra.
- **Constants.** Near-BFS speed; 2–3× faster than binary-heap Dijkstra from dropped heap work and superior cache locality (§§6, 9).

Foundational references: Dial (1969) for the bucket queue; cp-algorithms for the canonical deque exposition; Ahuja–Mehlhorn–Orlin–Tarjan (1990) for radix heaps; Meyer–Sanders for Δ-stepping; CLRS Ch. 24 for the Dijkstra optimality argument reused in §2.
