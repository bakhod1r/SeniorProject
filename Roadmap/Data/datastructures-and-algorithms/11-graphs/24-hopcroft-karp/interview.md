# Hopcroft-Karp Algorithm — Interview Preparation

Hopcroft-Karp is a strong interview topic: it tests whether a candidate truly understands *augmenting paths* (not just memorized Kuhn), whether they can articulate *why* the `O(√V)` bound holds, and whether they can connect matching to max-flow. The questions below are tiered junior → professional, followed by behavioral prompts and a full coding challenge with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Aspect | Value |
|--------|-------|
| Problem | Maximum-cardinality bipartite matching |
| Time | `O(E·√V)` |
| Space | `O(V + E)` |
| Phases | `O(√V)` |
| Per phase | `O(E)` (BFS + layered DFS) |
| Correctness | Berge's theorem |
| Weighted? | No (use Hungarian) |
| Equivalent to | Dinic on unit-capacity bipartite flow |

Core loop:

```text
while bfs():                 # build layers; false => maximum reached
    for each free left u:
        if dfs(u): matching += 1   # augment along shortest disjoint paths
```

---

## Junior Questions (What & How)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What problem does Hopcroft-Karp solve? | Maximum-cardinality matching in a bipartite graph. |
| 2 | What is its time complexity? | `O(E·√V)`. |
| 3 | How does that compare to Kuhn's? | Kuhn is `O(V·E)`; Hopcroft-Karp is faster by ~`√V` on dense graphs. |
| 4 | What is a matching? | A set of edges with no shared endpoint. |
| 5 | What is a *free* (unmatched) vertex? | A vertex not covered by any edge of the matching. |
| 6 | What is an augmenting path? | An alternating path whose both endpoints are free; flipping it grows `M` by one. |
| 7 | What does "alternating" mean? | Edges alternate between not-in-`M` and in-`M`. |
| 8 | What is the result of augmenting along a path? | The matching size increases by exactly one. |
| 9 | What two searches make up a phase? | A BFS (build layers) and a DFS (augment). |
| 10 | What is the BFS's job? | Compute distance layers / shortest augmenting-path length; **not** to augment. |
| 11 | What is the DFS's job? | Augment along a maximal set of vertex-disjoint shortest augmenting paths. |
| 12 | When does the algorithm stop? | When a BFS finds no augmenting path (NIL unreachable). |
| 13 | Does it work on non-bipartite graphs? | No — bipartite only; use Blossom for general graphs. |
| 14 | Does it handle edge weights? | No — cardinality only; use Hungarian for weights. |
| 15 | What is the NIL vertex convention? | A virtual vertex `0` meaning "free / no match." |

---

## Middle Questions (Why & When)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 16 | Why only shortest augmenting paths per phase? | Guarantees the shortest-path length strictly increases, bounding phases. |
| 17 | Why must the path set be *maximal*? | Otherwise a length-`ℓ` path survives and the length wouldn't increase. |
| 18 | Why "maximal" not "maximum" set? | Maximal is `O(E)` to find; maximum is as hard as the whole problem and unnecessary. |
| 19 | Why are only `O(√V)` phases needed? | Strict increase + symmetric-difference counting: after `√V` phases ≤ `√V` paths remain. |
| 20 | What does the BFS produce, concretely? | A layered DAG; each left vertex gets a `dist` layer. |
| 21 | What's the DFS layer rule? | Only step `u → w` when `dist[w] == dist[u] + 1`. |
| 22 | Why set `dist[u] = INF` on DFS failure? | Prune dead ends so each phase stays `O(E)` and avoids re-exploration. |
| 23 | When choose Hopcroft-Karp over Kuhn? | Large/dense bipartite graphs where `O(V·E)` is too slow. |
| 24 | When is Kuhn good enough? | Small graphs; up to ~`10⁴` edges Kuhn is simpler and fine. |
| 25 | How is it related to max-flow? | It is Dinic on a unit-capacity bipartite flow network. |
| 26 | BFS phase = which Dinic concept? | The level graph. |
| 27 | DFS phase = which Dinic concept? | The blocking flow. |
| 28 | What is König's theorem and why care? | Min vertex cover = max matching in bipartite graphs; free extra results. |
| 29 | How do you reduce min DAG path cover to matching? | Split vertices into out/in copies; answer = `V − |M|`. |
| 30 | How does a greedy warm start help? | Fewer phases; correctness preserved since augmenting paths repair greedy. |
| 31 | Which side should be "left"? | The smaller side — fewer DFS launches, smaller `√V` factor. |
| 32 | What's the max possible matching size? | `min(|L|, |R|)`. |

---

## Senior Questions (Scale & Systems)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 33 | How do you recompute matching every few seconds cheaply? | Warm-start from the previous matching; repair only the delta. |
| 34 | How do you shard matching across machines? | Geographic / block-diagonal sharding + residual border-matching pass. |
| 35 | What if a tick can't finish within the SLA? | Cap phases → near-maximum partial matching; log the gap. |
| 36 | What is often the real bottleneck? | Edge construction, not the matching itself; bound degree via top-`k`. |
| 37 | How do you add weights/preferences later? | Two-stage: cardinality (HK) then min-cost flow / local swaps for value. |
| 38 | What metric is the health canary? | `phases_per_run` — if it far exceeds `√V`, graph is pathological. |
| 39 | How do you avoid edge explosion? | Bound degree; spatial index (H3/S2); eligibility filters. |
| 40 | How do you handle fairness/starvation? | Aging as weights → min-cost flow, or pin starved vertices. |

---

## Professional Questions (Proofs & Theory)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 41 | State and prove Berge's theorem. | Symmetric difference decomposes into paths/cycles; surplus ⇒ augmenting path. |
| 42 | Prove the shortest augmenting-path length strictly increases each phase. | Maximality kills length-`ℓ` paths; shortest augmentation never shortens `ℓ`. |
| 43 | Prove only `O(√V)` phases are needed. | After `√V` phases paths exceed `√V`; ≤ `√V` vertex-disjoint paths remain. |
| 44 | Why is each phase `O(E)`? | BFS `O(E)`; layered DFS with `dist=INF` pruning charges each edge `O(1)`. |
| 45 | Where does the `5/2` exponent come from? | Two regimes balance at `√V`: `√V` phases × `O(E)` ≈ `O(n^{5/2})` on dense graphs. |
| 46 | Prove HK = Dinic on unit-cap networks. | Source→L→R→sink with cap 1; level graph = layers, blocking flow = maximal disjoint paths. |
| 47 | What's the general-graph analogue at the same bound? | Micali–Vazirani, `O(E√V)`, via blossom contraction in layered search. |
| 48 | Why doesn't HK extend to weighted matching directly? | It optimizes count via path *length*, not edge *weight*; need cost-scaling/Hungarian. |
| 49 | Give the potential function for the phase analysis. | `Φ(M) = ℓ(M)`; strictly increases, bounded by `V`. |
| 50 | State the space complexity and justify. | `O(V+E)`: adjacency lists + `O(V)` arrays (`pairU`, `pairV`, `dist`). |

---

## Detailed Answers to the Hardest Questions

These are the questions interviewers drill into. Have crisp, complete answers ready.

### Q16/Q19 — "Why only `O(√V)` phases?"

> Two facts combine. **First**, each phase flips a *maximal set of vertex-disjoint shortest augmenting paths*, which forces the shortest augmenting-path length to **strictly increase** (a surviving length-`ℓ` path would contradict maximality). **Second**, run `√V` phases — now the shortest augmenting path exceeds `√V` edges. The symmetric difference `M ⊕ M*` splits into `|M*| − |M|` vertex-disjoint augmenting paths, each using `> √V` vertices; since they are disjoint and there are only `V` vertices, at most `√V` remain. Each subsequent phase adds at least one to the matching, so `≤ √V` more phases finish. Total: `O(√V)` phases, `O(E)` each → `O(E√V)`.

### Q17/Q18 — "Why maximal, not maximum?"

> A *maximal* set is one you cannot extend by adding another disjoint shortest path; it is found greedily by the layered DFS in `O(E)`. A *maximum* set (the largest possible) would be as hard as the matching problem itself. The proof only needs maximality: it guarantees no length-`ℓ` augmenting path survives, which is exactly what makes the shortest length strictly increase. This mirrors Dinic, where a *blocking* flow (maximal) suffices, not a maximum flow per phase.

### Q22 — "Why `dist[u] = INF` on DFS failure?"

> When a DFS rooted at left vertex `u` cannot complete any augmenting path in this phase, marking `dist[u] = INF` removes `u` from the layered graph so no later DFS in the same phase re-enters it. Without this prune, the same dead-end subtree is re-explored repeatedly, breaking the `O(E)` per-phase bound (and in some formulations causing non-termination). It is the device that lets us *charge each edge `O(1)` work per phase*.

### Q25–Q27 — "How is it max-flow?"

> Add a source `s → each left (cap 1)`, `each right → sink t (cap 1)`, and direct original edges left→right with cap 1. Max `s–t` flow = max matching. Then Hopcroft-Karp *is* Dinic on this unit-capacity network: the **BFS = level graph**, the **DFS blocking step = blocking flow**, **one phase = one Dinic phase**. The `O(E√V)` bound is the standard unit-capacity Dinic analysis. Saying this out loud signals you see the unifying structure.

### Q41 — "Prove Berge's theorem."

> *(⇒)* An augmenting path `P` gives `M ⊕ P` of size `|M|+1`, so `M` isn't maximum. *(⇐)* If `M` isn't maximum, take a larger `M*`; `M ⊕ M*` has max degree 2, so it is disjoint paths and even cycles with alternating edges. Since `|M*| > |M|`, some component has more `M*`-edges — an odd path whose endpoints are free in `M`: an augmenting path. Contrapositive: no augmenting path ⇒ maximum.

---

## Behavioral / Discussion Prompts

- "You shipped a matching service and `phases_per_run` spiked. Walk me through diagnosis." — Expect: check for non-bipartite contamination, degenerate long alternating chains, edge explosion; compare against `√V`.
- "Product wants the *best* driver per rider, not just the most rides. What changes?" — Expect: move from cardinality (HK) to weighted (min-cost flow / Hungarian) or a two-stage approach.
- "Defend choosing Kuhn over Hopcroft-Karp in a code review." — Expect: small graph, simplicity, maintainability, fewer subtle bugs (NIL indexing, pruning).
- "Explain Hopcroft-Karp to a teammate who only knows BFS/DFS." — Expect: clear augmenting-path story, "batch shortest paths," `√V` phases intuition.

---

## Common Traps & Gotchas

| Trap | Reality |
|------|---------|
| "It handles weights." | No — cardinality only. |
| "Run BFS+DFS once." | Must loop `while bfs()` — many phases. |
| "Any augmenting paths per phase." | Must be **shortest** and a **maximal disjoint set**. |
| "Maximum disjoint set per phase." | Only **maximal** is needed (and cheap). |
| "Works on general graphs." | Bipartite only; Blossom for general. |
| "Forget `dist[u]=INF` pruning." | Phase no longer `O(E)`; may not terminate. |
| "NIL can be vertex 0 and real vertices too." | Reserve `0` for NIL; number real vertices from `1`. |

---

## Coding Challenge (3 Languages)

### Challenge: Maximum Bipartite Matching with Hopcroft-Karp

> **Problem.** You are given `nL` left vertices (`1..nL`), `nR` right vertices (`1..nR`), and a list of edges `(u, v)`. Return the size of the maximum-cardinality matching. Use the Hopcroft-Karp algorithm (`O(E·√V)`).
>
> **Example.** `nL = 4`, `nR = 4`, edges `[(1,1),(1,2),(2,1),(3,2),(3,3),(4,3),(4,4)]` → maximum matching size **4**.
>
> Your solution must run multiple BFS/DFS phases until no augmenting path remains.

#### Go

```go
package main

import "fmt"

const INF = 1 << 30

type HK struct {
	nL, nR             int
	adj                [][]int
	pairU, pairV, dist []int
}

func NewHK(nL, nR int) *HK {
	return &HK{nL: nL, nR: nR,
		adj:   make([][]int, nL+1),
		pairU: make([]int, nL+1),
		pairV: make([]int, nR+1),
		dist:  make([]int, nL+1)}
}

func (h *HK) AddEdge(u, v int) { h.adj[u] = append(h.adj[u], v) }

func (h *HK) bfs() bool {
	q := []int{}
	for u := 1; u <= h.nL; u++ {
		if h.pairU[u] == 0 {
			h.dist[u] = 0
			q = append(q, u)
		} else {
			h.dist[u] = INF
		}
	}
	h.dist[0] = INF
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		if h.dist[u] < h.dist[0] {
			for _, v := range h.adj[u] {
				if h.dist[h.pairV[v]] == INF {
					h.dist[h.pairV[v]] = h.dist[u] + 1
					q = append(q, h.pairV[v])
				}
			}
		}
	}
	return h.dist[0] != INF
}

func (h *HK) dfs(u int) bool {
	if u == 0 {
		return true
	}
	for _, v := range h.adj[u] {
		if h.dist[h.pairV[v]] == h.dist[u]+1 && h.dfs(h.pairV[v]) {
			h.pairV[v] = u
			h.pairU[u] = v
			return true
		}
	}
	h.dist[u] = INF
	return false
}

func (h *HK) MaxMatching() int {
	m := 0
	for h.bfs() {
		for u := 1; u <= h.nL; u++ {
			if h.pairU[u] == 0 && h.dfs(u) {
				m++
			}
		}
	}
	return m
}

func main() {
	h := NewHK(4, 4)
	edges := [][2]int{{1, 1}, {1, 2}, {2, 1}, {3, 2}, {3, 3}, {4, 3}, {4, 4}}
	for _, e := range edges {
		h.AddEdge(e[0], e[1])
	}
	fmt.Println(h.MaxMatching()) // 4
}
```

#### Java

```java
import java.util.*;

public class Solution {
    static final int INF = Integer.MAX_VALUE;
    int nL, nR;
    List<List<Integer>> adj;
    int[] pairU, pairV, dist;

    Solution(int nL, int nR) {
        this.nL = nL; this.nR = nR;
        adj = new ArrayList<>();
        for (int i = 0; i <= nL; i++) adj.add(new ArrayList<>());
        pairU = new int[nL + 1];
        pairV = new int[nR + 1];
        dist = new int[nL + 1];
    }

    void addEdge(int u, int v) { adj.get(u).add(v); }

    boolean bfs() {
        Deque<Integer> q = new ArrayDeque<>();
        for (int u = 1; u <= nL; u++) {
            if (pairU[u] == 0) { dist[u] = 0; q.add(u); }
            else dist[u] = INF;
        }
        dist[0] = INF;
        while (!q.isEmpty()) {
            int u = q.poll();
            if (dist[u] < dist[0])
                for (int v : adj.get(u))
                    if (dist[pairV[v]] == INF) {
                        dist[pairV[v]] = dist[u] + 1;
                        q.add(pairV[v]);
                    }
        }
        return dist[0] != INF;
    }

    boolean dfs(int u) {
        if (u == 0) return true;
        for (int v : adj.get(u))
            if (dist[pairV[v]] == dist[u] + 1 && dfs(pairV[v])) {
                pairV[v] = u; pairU[u] = v;
                return true;
            }
        dist[u] = INF;
        return false;
    }

    int maxMatching() {
        int m = 0;
        while (bfs())
            for (int u = 1; u <= nL; u++)
                if (pairU[u] == 0 && dfs(u)) m++;
        return m;
    }

    public static void main(String[] args) {
        Solution s = new Solution(4, 4);
        int[][] edges = {{1,1},{1,2},{2,1},{3,2},{3,3},{4,3},{4,4}};
        for (int[] e : edges) s.addEdge(e[0], e[1]);
        System.out.println(s.maxMatching()); // 4
    }
}
```

#### Python

```python
import sys
from collections import deque

INF = float("inf")


class Solution:
    def __init__(self, n_left, n_right):
        self.nL, self.nR = n_left, n_right
        self.adj = [[] for _ in range(n_left + 1)]
        self.pair_u = [0] * (n_left + 1)
        self.pair_v = [0] * (n_right + 1)
        self.dist = [0] * (n_left + 1)

    def add_edge(self, u, v):
        self.adj[u].append(v)

    def _bfs(self):
        q = deque()
        for u in range(1, self.nL + 1):
            if self.pair_u[u] == 0:
                self.dist[u] = 0
                q.append(u)
            else:
                self.dist[u] = INF
        self.dist[0] = INF
        while q:
            u = q.popleft()
            if self.dist[u] < self.dist[0]:
                for v in self.adj[u]:
                    if self.dist[self.pair_v[v]] == INF:
                        self.dist[self.pair_v[v]] = self.dist[u] + 1
                        q.append(self.pair_v[v])
        return self.dist[0] != INF

    def _dfs(self, u):
        if u == 0:
            return True
        for v in self.adj[u]:
            if self.dist[self.pair_v[v]] == self.dist[u] + 1 and self._dfs(self.pair_v[v]):
                self.pair_v[v] = u
                self.pair_u[u] = v
                return True
        self.dist[u] = INF
        return False

    def max_matching(self):
        m = 0
        while self._bfs():
            for u in range(1, self.nL + 1):
                if self.pair_u[u] == 0 and self._dfs(u):
                    m += 1
        return m


if __name__ == "__main__":
    sys.setrecursionlimit(10**6)
    s = Solution(4, 4)
    for u, v in [(1,1),(1,2),(2,1),(3,2),(3,3),(4,3),(4,4)]:
        s.add_edge(u, v)
    print(s.max_matching())  # 4
```

### Follow-up extensions (often asked live)

1. **Return the actual pairs**, not just the size — read `pairU[1..nL]`.
2. **Min vertex cover** — apply König: alternating-BFS from unmatched left vertices over the final matching.
3. **Compare phase count to `√V`** empirically on a large random graph (prints single-digit phases).
4. **Detect non-bipartite input** and reject before matching.

---

## Second Coding Challenge — Minimum Vertex Cover via König

> **Problem.** Given a bipartite graph, output a **minimum vertex cover** (smallest set of vertices touching every edge). By König's theorem, its size equals the maximum matching size. Construct it: run Hopcroft-Karp, then from every *unmatched left* vertex do an alternating BFS/DFS (unmatched edge to right, matched edge back to left). Let `Z` be the visited set. The cover is `(L \ Z) ∪ (R ∩ Z)`.

#### Go

```go
package main

import "fmt"

// Assume the HK type from the first challenge (pairU, pairV, adj, MaxMatching).
func minVertexCover(h *HK) ([]int, []int) {
	h.MaxMatching()
	visL := make([]bool, h.nL+1)
	visR := make([]bool, h.nR+1)
	var alt func(u int)
	alt = func(u int) {
		visL[u] = true
		for _, v := range h.adj[u] {
			if h.pairU[u] != v && !visR[v] { // unmatched edge u->v
				visR[v] = true
				if h.pairV[v] != 0 && !visL[h.pairV[v]] {
					alt(h.pairV[v]) // matched edge back
				}
			}
		}
	}
	for u := 1; u <= h.nL; u++ {
		if h.pairU[u] == 0 {
			alt(u)
		}
	}
	var coverL, coverR []int
	for u := 1; u <= h.nL; u++ {
		if !visL[u] {
			coverL = append(coverL, u) // L \ Z
		}
	}
	for v := 1; v <= h.nR; v++ {
		if visR[v] {
			coverR = append(coverR, v) // R ∩ Z
		}
	}
	return coverL, coverR
}

func main() {
	h := NewHK(3, 3)
	for _, e := range [][2]int{{1, 1}, {1, 2}, {2, 1}, {3, 2}, {3, 3}} {
		h.AddEdge(e[0], e[1])
	}
	cl, cr := minVertexCover(h)
	fmt.Println("cover left:", cl, "cover right:", cr)
}
```

#### Java

```java
import java.util.*;

public class KonigCover {
    // Assume the Solution HK class with adj, pairU, pairV, maxMatching().
    static List<Integer>[] adj;
    static int[] pairU, pairV;
    static boolean[] visL, visR;

    static void alt(int u) {
        visL[u] = true;
        for (int v : adj[u]) {
            if (pairU[u] != v && !visR[v]) {       // unmatched edge
                visR[v] = true;
                if (pairV[v] != 0 && !visL[pairV[v]]) alt(pairV[v]);
            }
        }
    }

    // call after maxMatching(); returns cover = (L \ Z) ∪ (R ∩ Z)
    static void cover(int nL, int nR) {
        visL = new boolean[nL + 1];
        visR = new boolean[nR + 1];
        for (int u = 1; u <= nL; u++) if (pairU[u] == 0) alt(u);
        List<Integer> cl = new ArrayList<>(), cr = new ArrayList<>();
        for (int u = 1; u <= nL; u++) if (!visL[u]) cl.add(u);
        for (int v = 1; v <= nR; v++) if (visR[v]) cr.add(v);
        System.out.println("cover left: " + cl + " right: " + cr);
    }
}
```

#### Python

```python
def min_vertex_cover(h):
    h.max_matching()  # fills pair_u / pair_v
    visL = [False] * (h.nL + 1)
    visR = [False] * (h.nR + 1)

    def alt(u):
        visL[u] = True
        for v in h.adj[u]:
            if h.pair_u[u] != v and not visR[v]:  # unmatched edge
                visR[v] = True
                w = h.pair_v[v]
                if w != 0 and not visL[w]:
                    alt(w)                         # matched edge back

    for u in range(1, h.nL + 1):
        if h.pair_u[u] == 0:
            alt(u)
    cover_l = [u for u in range(1, h.nL + 1) if not visL[u]]   # L \ Z
    cover_r = [v for v in range(1, h.nR + 1) if visR[v]]       # R ∩ Z
    return cover_l, cover_r
```

> The returned cover has size exactly equal to the maximum matching — a live demonstration of König's theorem and a frequent senior follow-up.

---

## Final Tips

- Lead with the **augmenting-path** story; it shows understanding, not memorization.
- Stress the two distinct jobs: **BFS measures, DFS augments**.
- Be ready to say *why* `O(√V)` phases — the strict-increase + counting argument is the killer answer.
- Always mention the **bipartite-only** and **cardinality-only** limitations unprompted; it signals maturity.

---

**Next step:** Practice the implementation and its variants in [`tasks.md`](./tasks.md) across Go, Java, and Python.
