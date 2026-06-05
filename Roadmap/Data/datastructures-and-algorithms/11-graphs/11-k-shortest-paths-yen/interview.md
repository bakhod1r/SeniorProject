# Yen's Algorithm (K Shortest Loopless Paths) — Interview Preparation

Yen's algorithm is a strong interview topic: it builds on Dijkstra (so it tests whether you truly understand shortest paths), it has a clean but subtle correctness story (spur/root branching, removals, nondecreasing order), and it forces a real algorithm-selection conversation (loopless vs loops-allowed, Yen vs Eppstein). This file is a tiered question bank (junior → professional), behavioral prompts, common pitfalls, and an end-to-end coding challenge with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Aspect | Value |
|--------|-------|
| Problem | K shortest **loopless** (simple) paths, `s → t`, ranked cheapest-first |
| Time | `O(K · V · (E + V log V))` |
| Space | `O(K · V + E)` |
| Subroutine | Dijkstra (non-negative weights) |
| Containers | `A` accepted list, `B` candidate min-heap |
| Spur node | every vertex of `A[-1]` except `t` |
| Root path | prefix `s … spur` (kept fixed) |
| Remove (edges) | spur-leaving edge of **every** path sharing the root |
| Remove (nodes) | all root interior nodes (keeps result loopless) |
| Output order | nondecreasing cost |
| If loops allowed | use **Eppstein** — `O(E + V log V + K)` |

Core loop:

```text
A = [ dijkstra(s, t) ]
while |A| < K:
    for each spur node v on A[-1]:
        root = prefix s..v
        remove repeating edges + root interior nodes
        spur = dijkstra(v -> t) on modified graph
        push (root + spur) into B if new
    move cheapest of B into A
```

---

## Junior Questions (12 Q&A)

### J1. What problem does Yen's algorithm solve?
It finds the `K` **shortest loopless (simple) paths** from a source `s` to a target `t` in a weighted graph, ranked from cheapest to most expensive. "Loopless" means no path repeats a vertex. It is the standard answer when you need *alternative routes*, not just the single best one.

### J2. What is a "loopless" or "simple" path?
A path that visits no vertex more than once. Yen guarantees all its results are simple; this is the feature that distinguishes it from loops-allowed algorithms like Eppstein's.

### J3. What are `A` and `B`?
`A` is the **accepted list** — the answers found so far, in nondecreasing cost order; it ends with `K` paths. `B` is a **min-heap of candidate paths** not yet accepted, keyed by total cost. Each iteration pushes new candidates into `B` and pops the cheapest into `A`.

### J4. What is a spur node?
A vertex on a previously accepted path where the next candidate **branches off**. Yen tries every vertex of the latest accepted path (except `t`) as a spur node.

### J5. What is the root path?
The prefix of the accepted path from `s` up to and including the spur node. It is kept **fixed**; the new candidate shares this beginning and detours afterward.

### J6. What is the spur path?
A freshly computed shortest path from the spur node to `t`, on a graph where certain edges and nodes have been temporarily removed. The candidate is `root path + spur path`.

### J7. What is the time complexity, and where does it come from?
`O(K · V · (E + V log V))`. It decomposes as: `K` accepted paths × up to `V` spur nodes per path × one Dijkstra (`O(E + V log V)`) per spur node.

### J8. What subroutine does Yen rely on?
Dijkstra's algorithm (or any single-source shortest-path routine for non-negative weights). Yen calls it once to seed `A`, then once per spur node.

### J9. Why does Yen need non-negative weights?
Because its inner routine is Dijkstra, which is only correct for non-negative weights. With negative edges you would need Bellman-Ford, which is much slower.

### J10. What happens if there are fewer than K paths?
Yen returns all the loopless paths that exist and stops (the candidate heap `B` empties). Do not loop forever expecting `K`.

### J11. How do you avoid returning the same path twice?
Deduplicate: keep a set of path keys (e.g. the joined vertex sequence) and only push a candidate into `B` if it is not already in `A` or `B`.

### J12. Give one real use case.
Showing 2–3 alternative driving routes in a navigation app, or precomputing backup network paths for failover. Both want *loopless* alternatives.

---

## Middle Questions (14 Q&A)

### M1. Why must you remove the root-path nodes before the spur search?
So the spur path cannot revisit a vertex already in the root prefix. If it did, the concatenated total path would repeat that vertex — a loop — violating the loopless requirement. Remove all root interior vertices (keep the spur node itself, since the search starts there).

### M2. Why remove the spur-leaving edge of *every* path sharing the root, not just the last accepted one?
Multiple already-found paths may share the same root prefix. If you only blocked the last one's edge, the spur Dijkstra could re-discover an earlier accepted path that also branched here — a duplicate. Removing all such edges forces a genuinely new first step.

### M3. Why is the output in nondecreasing cost order?
Each accepted path is the **minimum-cost candidate** popped from `B`, and the invariant is that every unfound loopless path is represented in `B` at cost ≤ its own. So the heap minimum is always the true next-cheapest. New candidates added after accepting a path cost at least as much (a detour off an ≥-cost path with a non-negative spur), so costs never decrease.

### M4. How does Yen differ from "run Dijkstra, remove an edge, repeat"?
That naive idea is too blunt: removing a single edge neither enumerates in order, nor guarantees simplicity, nor avoids missing paths. Yen's per-spur-node removal is the precise, correct version of that instinct.

### M5. When would you use Eppstein's algorithm instead of Yen?
When **loops are allowed** (or impossible, as in a DAG) and `K` is large. Eppstein runs in `O(E + V log V + K)` — near-linear in `K` — versus Yen's `O(K·V·(E + V log V))`. The tradeoff: Eppstein's paths may repeat vertices.

### M6. What is Lawler's improvement?
Store a **deviation index** with each accepted path and only generate spur nodes from that index onward. Spur nodes before it were already explored via the parent path, so re-scanning them only regenerates known candidates. It cuts redundant spur Dijkstra calls without changing the output.

### M7. How large can the candidate heap `B` get?
Up to `O(K · V)` candidates (each accepted path spawns up to `V` candidates). Dedup keeps it from growing larger; storing full paths makes the transient memory `O(K · V²)` in the worst case.

### M8. How do you compute a candidate's cost?
`cost = cost(root) + cost(spur)`. When concatenating, write `root[:-1] + spur` so the shared spur node isn't duplicated — but the cost is still the sum because `cost(root)` ends at the spur node and `cost(spur)` begins there.

### M9. Why is the last vertex (`t`) never a spur node?
Because there is no edge to leave `t` on the way to `t`; the spur path from `t` to `t` is trivial/empty. Spur nodes range over indices `0 .. len-2` of the accepted path.

### M10. Can Yen handle undirected graphs?
Yes — represent each undirected edge as two directed edges. The looplessness machinery (node removal) works the same.

### M11. What if a spur node yields no valid path after removal?
That's normal — the removal disconnected the spur node from `t`. Skip that spur node; it simply contributes no candidate. It is not an error.

### M12. How do you make each spur path faster on a road network?
Replace Dijkstra with **A\*** (admissible heuristic like straight-line distance) or **contraction hierarchies** for the inner shortest-path computation. Yen's outer structure is unchanged; only the oracle changes.

### M13. Are ties in cost a problem?
No — multiple candidates with equal cost are all valid. Pick a consistent tie-break (insertion order, or lexicographic vertex sequence) for determinism. The output is still a correct nondecreasing prefix.

### M14. What's the danger of mutating the global graph during a spur search?
If you remove edges/nodes by mutating the shared graph and forget to restore, later spur computations see a corrupted graph. The clean fix: pass removals as *parameters* to Dijkstra and never touch the shared graph.

---

## Senior Questions (12 Q&A)

### S1. Design a service that serves "K alternative routes" at scale.
Three stages: a **topology store** (source of truth, emits change events), a stateless **path-engine pool** running Yen (with a fast inner oracle + diversity filter), and a **versioned result cache** keyed by `(s, t, K, snapshotVersion)`. Hot `(s,t)` pairs are precomputed; cold queries run per-request under a deadline. Cache invalidates on topology change.

### S2. How do you bound Yen's latency tail?
Its cost scales with `K·V`, so impose a **time budget** (return best-found at deadline) or a **cost ceiling** (stop when heap-min exceeds `cost(A[0])·(1+ε)`) — valid because output is nondecreasing. Cap `K`, cache hot pairs, and use A\*/CH inner oracle.

### S3. The spur Dijkstras — can you parallelize them?
Within one iteration, the spur computations are **independent** (read-only graph, local removal sets) — embarrassingly parallel. But **across** iterations there's a serial dependency: you must pop the next `A[k]` before knowing which path to spur from. So: map-reduce *per iteration*, merge candidates into a guarded heap.

### S4. Raw KSP returns near-identical routes. How do you get diverse alternatives?
Over-fetch (e.g. `3K` exact paths) then **greedily select** `K` maximizing pairwise dissimilarity (edge Jaccard distance below a threshold). Or use a penalty/plateau method (inflate used edges, rerun). For failover, compute **node/edge-disjoint** paths (Suurballe for a pair).

### S5. How do you keep results fresh when the graph changes?
Version every snapshot; tag results with the version; invalidate cache entries on change events (not a fixed timer) for hot pairs. In-flight engine work against an old version is discarded or recomputed.

### S6. What metrics would you alert on?
`ksp_latency_p99`, `spur_dijkstra_count` (work proxy), `candidate_heap_size_max`, `paths_returned/paths_requested` (< 1 means fewer than K exist), `diversity_jaccard_avg` (> 0.9 means too similar), `cache_hit_ratio`, and `stale_result_served`.

### S7. A request asks for K=1000 on a dense graph and times out. What do you do?
Recognize the `K·V` blow-up. Mitigations: cap `K`; if loops are acceptable switch to Eppstein; impose a deadline and return partial results; precompute/cache if the pair is hot. Architecturally, admit on estimated spur count, not raw QPS, and rate-limit heavy tenants.

### S8. How does the replacement-paths idea speed up Yen?
Each spur is a replacement-path query ("shortest path avoiding a prefix + edge"). Replacement-paths algorithms (Malik-Mittal-Gupta, Hershberger-Suri) compute the detour around *every* edge of a path in `O(E + V log V)` total, instead of one Dijkstra per edge — collapsing a spur round's cost and reusing the shortest-path tree.

### S9. Where does the failover use case run Yen — data plane or control plane?
**Control plane**, on topology change (seconds). The K paths are *installed* into forwarding hardware (primary + backups); a fast local-repair trigger promotes a backup in microseconds on link failure. Never run Yen at packet-forwarding speed.

### S10. What's "spur efficiency" and why monitor it?
`paths_returned / spur_dijkstra_count`. Healthy Yen returns one path per `O(V)` spurs; a drop means dedup is failing (duplicate spurs) or the region is path-poor (dead-end spurs). It distinguishes a code bug from a "lower K / widen ceiling" signal.

### S11. How do you size the engine fleet?
Per request ≈ `K·V` Dijkstras worst case. Multiply by miss-rate QPS and per-request p99 latency, apply Little's law plus headroom. The dominant levers are cache hit ratio (lifting 0.85→0.95 thirds the fleet) and the inner oracle (A\*/CH vs plain Dijkstra).

### S12. Concurrency hazards in a parallel Yen?
The graph is safe (read-only). The shared mutable state is the candidate heap `B`, the `seen` dedup set, and the accepted list `A`. Guard `B` and `seen` (or merge at a per-iteration barrier); pin a snapshot version at request start so a mid-flight topology change doesn't corrupt the run.

---

## Professional Questions (10 Q&A)

### P1. Prove Yen produces paths in nondecreasing order.
Maintain invariant `I`: after `k` accepted paths, every unfound loopless path is represented in `B` at cost ≤ its own. Base: after Dijkstra, every path deviates from `A0` somewhere and is represented. Step: pop the heap minimum `A_k`; by `I` no unfound path is cheaper (else its cheaper representative would have been the minimum) and new candidates cost ≥ `c(A_k)` (detour off an ≥-cost path with non-negative spur). Re-running the spur round restores `I`. Hence costs never decrease and `A` is a correct prefix. (Full proof in `professional.md`.)

### P2. Why exactly do the two removal rules guarantee no duplication and looplessness?
**Edge removal** of *all* spur-leaving edges of paths sharing the root forces the spur path's first edge to differ from every known path with that root — no duplicate (necessary: blocking only one lets earlier paths reappear; sufficient: blocks them all). **Vertex removal** of root interior vertices forbids the spur from revisiting them — keeps the concatenation simple (necessary for looplessness; sufficient since the spur then shares no interior vertex with the root).

### P3. Derive the complexity, including auxiliary costs.
`K` accepted × ≤ `V` spur nodes × Dijkstra `O(E + V log V)` = `O(K·V·(E + V log V))`. Heap ops: `O(K·V log(KV))` ⊆ dominant. Removal-set construction is `O(K·V)` per spur naively but `O(V)` with a prefix trie ⊆ dominant. So the Dijkstras are the sole asymptotic bottleneck.

### P4. Why can't Eppstein's near-linear-in-K speedup apply to loopless paths?
Eppstein models paths as sequences of *context-free* sidetracks (each adds a fixed non-negative δ), heap-enumerable in `O(K)`. Looplessness is a *context-sensitive* predicate (legality depends on the whole prefix) that no fixed δ encodes — the loopless language isn't regular. Yen's per-spur vertex removal is the operational cost of re-imposing that context, the factor-`V` penalty.

### P5. On a DAG, which algorithm wins?
Eppstein. On a DAG every walk is automatically loopless (a repeat would imply a cycle), so Eppstein's `O(E + V log V + K)` solves the loopless problem too, dominating Yen. Recognizing acyclicity moves the problem to the easy column — an exponential-in-K win exploited by lattice decoding.

### P6. Prove Lawler's deviation-index restriction loses no paths.
Any new loopless path deviating from `A_k` at index `i < dev(A_k)` shares the prefix `A_k[0..i]`, which is also a prefix of `A_k`'s parent (they agree up to `dev(A_k) > i`). So it deviates from the parent at the same `i` and was already enumerated when the parent was processed. Skipping `i < dev(A_k)` only avoids regenerating known candidates.

### P7. Where does the non-negativity assumption become load-bearing in the proof?
Two places: (1) Lemma 2's per-class optimum needs Dijkstra's greedy correctness; (2) the ordering step needs "a detour off an ≥-cost path costs ≥ that path," which uses `cost(spur) ≥ 0`. With negative spur costs a later-deviating path could undercut an accepted one, breaking nondecreasing order.

### P8. What corner case does the zero-weight cycle expose?
The looplessness sufficiency argument assumed strictly positive weights so a shortest spur never returns to the spur node `v`. A zero-weight cycle through `v` could revisit it at no cost, producing a non-simple path. Fix: settle `v` at distance 0 and forbid re-entry (remove incoming edges to `v` during the spur search).

### P9. Is loopless KSP NP-hard? What turns it NP-hard?
No — it's polynomial (`O(K·V·(E + V log V))`). Adding a **second budgeted metric** (constrained shortest path: cost ≤ C and weight ≤ D) makes it NP-hard via reduction from PARTITION (diamond gadgets, cost vs weight). Yen's tractability relies on a single additive metric plus the local simplicity constraint.

### P10. Sketch the general k-best correctness template.
(1) Partition unfound solutions into classes; (2) show each class's best is one constrained subroutine call; (3) maintain "`B` holds each class's best at cost ≤ its optimum"; (4) conclude pop-min is globally next-best. Yen, Eppstein, and Lawler all instantiate this; adapting to new constraints re-derives only (1)–(2).

---

## Behavioral / Discussion Prompts

- *"Walk me through a time you chose between exactness and speed."* — Yen (exact loopless) vs penalty methods (fast, diverse, approximate) is a perfect example.
- *"How would you debug a routing service returning duplicate alternatives?"* — Trace to the dedup/edge-removal logic; the proof's failure-mode table tells you which rule is broken.
- *"How do you decide when an algorithm is 'good enough' for production?"* — Discuss the latency tail, caching strategy, and bounding K.

---

## Coding Challenge (3 Languages)

### Challenge: K Shortest Loopless Paths

> Given a directed weighted graph (non-negative weights), a source, a target, and `K`, return the costs of the `K` shortest loopless paths in nondecreasing order. If fewer than `K` exist, return all of them.
>
> **Example:** Graph `C→D 3, C→E 2, D→F 4, E→D 1, E→F 2, E→G 3, F→G 2, F→H 1, G→H 2`, `s=C`, `t=H`, `K=3` ⇒ `[5, 7, 8]`.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
	"strings"
)

type Graph map[string]map[string]int

type item struct {
	d int
	n string
}
type IH []item

func (h IH) Len() int            { return len(h) }
func (h IH) Less(i, j int) bool  { return h[i].d < h[j].d }
func (h IH) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *IH) Push(x interface{}) { *h = append(*h, x.(item)) }
func (h *IH) Pop() interface{}   { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func dijkstra(g Graph, s, t string, remE map[[2]string]bool, remN map[string]bool) ([]string, int, bool) {
	dist := map[string]int{s: 0}
	prev := map[string]string{}
	pq := &IH{{0, s}}
	done := map[string]bool{}
	for pq.Len() > 0 {
		it := heap.Pop(pq).(item)
		u := it.n
		if done[u] {
			continue
		}
		done[u] = true
		if u == t {
			break
		}
		for v, w := range g[u] {
			if remN[v] || remE[[2]string{u, v}] {
				continue
			}
			nd := it.d + w
			if old, ok := dist[v]; !ok || nd < old {
				dist[v] = nd
				prev[v] = u
				heap.Push(pq, item{nd, v})
			}
		}
	}
	if _, ok := dist[t]; !ok {
		return nil, 0, false
	}
	p := []string{}
	for at := t; ; at = prev[at] {
		p = append([]string{at}, p...)
		if at == s {
			break
		}
	}
	return p, dist[t], true
}

type cand struct {
	cost  int
	nodes []string
}
type CH []cand

func (h CH) Len() int            { return len(h) }
func (h CH) Less(i, j int) bool  { return h[i].cost < h[j].cost }
func (h CH) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *CH) Push(x interface{}) { *h = append(*h, x.(cand)) }
func (h *CH) Pop() interface{}   { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func key(p []string) string { return strings.Join(p, ",") }
func cost(g Graph, p []string) int {
	c := 0
	for i := 0; i+1 < len(p); i++ {
		c += g[p[i]][p[i+1]]
	}
	return c
}

func yen(g Graph, s, t string, k int) []int {
	p0, c0, ok := dijkstra(g, s, t, nil, nil)
	if !ok {
		return nil
	}
	type acc struct {
		cost  int
		nodes []string
	}
	A := []acc{{c0, p0}}
	B := &CH{}
	heap.Init(B)
	seen := map[string]bool{key(p0): true}
	for len(A) < k {
		last := A[len(A)-1].nodes
		for i := 0; i < len(last)-1; i++ {
			spur := last[i]
			root := last[:i+1]
			remE := map[[2]string]bool{}
			for _, p := range A {
				if len(p.nodes) > i && key(p.nodes[:i+1]) == key(root) {
					remE[[2]string{p.nodes[i], p.nodes[i+1]}] = true
				}
			}
			remN := map[string]bool{}
			for _, n := range root[:len(root)-1] {
				remN[n] = true
			}
			sp, sc, ok := dijkstra(g, spur, t, remE, remN)
			if !ok {
				continue
			}
			total := append(append([]string{}, root[:len(root)-1]...), sp...)
			if !seen[key(total)] {
				seen[key(total)] = true
				heap.Push(B, cand{cost(g, root) + sc, total})
			}
		}
		if B.Len() == 0 {
			break
		}
		c := heap.Pop(B).(cand)
		A = append(A, acc{c.cost, c.nodes})
	}
	out := []int{}
	for _, a := range A {
		out = append(out, a.cost)
	}
	return out
}

func main() {
	g := Graph{
		"C": {"D": 3, "E": 2}, "D": {"F": 4},
		"E": {"D": 1, "F": 2, "G": 3}, "F": {"G": 2, "H": 1}, "G": {"H": 2},
	}
	fmt.Println(yen(g, "C", "H", 3)) // [5 7 8]
}
```

#### Java

```java
import java.util.*;

public class Solution {
    static int[] dijkstra(Map<String, Map<String, Integer>> g, String s, String t,
                          Set<String> remE, Set<String> remN, List<String> outPath) {
        final int INF = Integer.MAX_VALUE / 4;
        Map<String, Integer> dist = new HashMap<>();
        Map<String, String> prev = new HashMap<>();
        PriorityQueue<String> pq = new PriorityQueue<>(
                Comparator.comparingInt(n -> dist.getOrDefault(n, INF)));
        dist.put(s, 0); pq.add(s);
        Set<String> done = new HashSet<>();
        while (!pq.isEmpty()) {
            String u = pq.poll();
            if (!done.add(u)) continue;
            if (u.equals(t)) break;
            for (var e : g.getOrDefault(u, Map.of()).entrySet()) {
                String v = e.getKey();
                if (remN.contains(v) || remE.contains(u + ">" + v)) continue;
                int nd = dist.get(u) + e.getValue();
                if (nd < dist.getOrDefault(v, INF)) { dist.put(v, nd); prev.put(v, u); pq.add(v); }
            }
        }
        if (!dist.containsKey(t)) return null;
        LinkedList<String> path = new LinkedList<>();
        for (String at = t; at != null; at = at.equals(s) ? null : prev.get(at)) path.addFirst(at);
        outPath.clear(); outPath.addAll(path);
        return new int[]{dist.get(t)};
    }

    static int cost(Map<String, Map<String, Integer>> g, List<String> p) {
        int c = 0;
        for (int i = 0; i + 1 < p.size(); i++) c += g.get(p.get(i)).get(p.get(i + 1));
        return c;
    }

    static List<Integer> yen(Map<String, Map<String, Integer>> g, String s, String t, int k) {
        List<String> p0 = new ArrayList<>();
        int[] c0 = dijkstra(g, s, t, Set.of(), Set.of(), p0);
        if (c0 == null) return List.of();
        record Acc(int cost, List<String> nodes) {}
        List<Acc> A = new ArrayList<>(List.of(new Acc(c0[0], new ArrayList<>(p0))));
        PriorityQueue<Acc> B = new PriorityQueue<>(Comparator.comparingInt(Acc::cost));
        Set<String> seen = new HashSet<>(Set.of(String.join(",", p0)));
        while (A.size() < k) {
            List<String> last = A.get(A.size() - 1).nodes();
            for (int i = 0; i < last.size() - 1; i++) {
                List<String> root = new ArrayList<>(last.subList(0, i + 1));
                Set<String> remE = new HashSet<>();
                for (Acc p : A)
                    if (p.nodes().size() > i && p.nodes().subList(0, i + 1).equals(root))
                        remE.add(p.nodes().get(i) + ">" + p.nodes().get(i + 1));
                Set<String> remN = new HashSet<>(root.subList(0, root.size() - 1));
                List<String> sp = new ArrayList<>();
                int[] sc = dijkstra(g, last.get(i), t, remE, remN, sp);
                if (sc == null) continue;
                List<String> total = new ArrayList<>(root.subList(0, root.size() - 1));
                total.addAll(sp);
                String key = String.join(",", total);
                if (seen.add(key)) B.add(new Acc(cost(g, root) + sc[0], total));
            }
            if (B.isEmpty()) break;
            A.add(B.poll());
        }
        List<Integer> out = new ArrayList<>();
        for (Acc a : A) out.add(a.cost());
        return out;
    }

    public static void main(String[] args) {
        Map<String, Map<String, Integer>> g = new HashMap<>();
        g.put("C", Map.of("D", 3, "E", 2)); g.put("D", Map.of("F", 4));
        g.put("E", Map.of("D", 1, "F", 2, "G", 3));
        g.put("F", Map.of("G", 2, "H", 1)); g.put("G", Map.of("H", 2));
        System.out.println(yen(g, "C", "H", 3)); // [5, 7, 8]
    }
}
```

#### Python

```python
import heapq


def dijkstra(g, s, t, rem_e=frozenset(), rem_n=frozenset()):
    INF = float("inf")
    dist, prev = {s: 0}, {}
    pq, done = [(0, s)], set()
    while pq:
        d, u = heapq.heappop(pq)
        if u in done:
            continue
        done.add(u)
        if u == t:
            break
        for v, w in g.get(u, {}).items():
            if v in rem_n or (u, v) in rem_e:
                continue
            nd = d + w
            if nd < dist.get(v, INF):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    if t not in dist:
        return None
    path = [t]
    while path[-1] != s:
        path.append(prev[path[-1]])
    path.reverse()
    return path, dist[t]


def cost(g, p):
    return sum(g[p[i]][p[i + 1]] for i in range(len(p) - 1))


def yen(g, s, t, k):
    first = dijkstra(g, s, t)
    if first is None:
        return []
    # A stores (cost, nodes) uniformly so popped candidates fit the same shape.
    A = [(first[1], first[0])]
    B, seen = [], {tuple(first[0])}
    while len(A) < k:
        last = A[-1][1]
        for i in range(len(last) - 1):
            root = last[: i + 1]
            rem_e = {(p[1][i], p[1][i + 1]) for p in A
                     if len(p[1]) > i and p[1][: i + 1] == root}
            rem_n = frozenset(root[:-1])
            sp = dijkstra(g, last[i], t, frozenset(rem_e), rem_n)
            if sp is None:
                continue
            total = tuple(root[:-1] + sp[0])
            if total not in seen:
                seen.add(total)
                heapq.heappush(B, (cost(g, root) + sp[1], list(total)))
        if not B:
            break
        A.append(heapq.heappop(B))
    return [c for c, _ in A]


if __name__ == "__main__":
    g = {
        "C": {"D": 3, "E": 2}, "D": {"F": 4},
        "E": {"D": 1, "F": 2, "G": 3}, "F": {"G": 2, "H": 1}, "G": {"H": 2},
    }
    print(yen(g, "C", "H", 3))  # [5, 7, 8]
```

**Test cases to discuss:** `K` larger than the path count (returns fewer); disconnected `s`/`t` (empty); ties in cost (any valid order); a spur node that dead-ends after removal (skipped); a zero-weight cycle (needs the spur-node re-entry guard).

---

## Common Pitfalls in Interviews

- **Forgetting node removal** — produces looped paths; defeats the purpose of *loopless* KSP.
- **Only blocking `A[-1]`'s edge** — re-discovers earlier accepted paths; you must block every path sharing the root.
- **No dedup** — `B` bloats, duplicates get accepted.
- **Mutating and not restoring the graph** — corrupts later spur searches; pass removals as parameters instead.
- **Using Yen when loops are allowed** — Eppstein is `O(E + V log V + K)`, far faster; Yen is overkill.
- **Treating "no spur path" as an error** — it's a normal dead end; skip it.
- **Off-by-one in the spur range** — `t` is never a spur node; iterate indices `0 .. len-2`.
- **Assuming K paths always exist** — stop when `B` empties.

---

## What Interviewers Are Really Testing

A Yen question rarely checks whether you can recite the loop. It probes three deeper things. First, **shortest-path mastery**: Yen is Dijkstra-in-a-loop, so a shaky Dijkstra collapses immediately — can you implement and reason about it, including path reconstruction and the non-negativity requirement? Second, **correctness reasoning**: can you justify *why* the two removal rules guarantee no duplicates and looplessness, and *why* popping the heap minimum yields nondecreasing order? That argument, not the code, separates understanding from memorization. Third, **algorithm selection and systems sense**: do you recognize when Eppstein dominates (loops allowed / DAG / large K), how the `K·V` factor threatens production latency, and how caching, diversity filtering, and a faster inner oracle turn an exact textbook algorithm into a serviceable feature? The strongest candidates connect Yen to its theoretical neighborhood — the loopless-vs-walks complexity gap, the replacement-paths speedup, the bicriteria NP-hardness boundary — and to its real deployments in routing and network resilience. A compact algorithm built on a familiar subroutine is the ideal canvas to show all of that in one conversation.
