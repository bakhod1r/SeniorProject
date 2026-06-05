# Maximum Flow (Push-Relabel) — Interview Preparation

Push-relabel is a strong topic to discuss in an interview because it shows you understand max-flow beyond "BFS for an augmenting path." It demonstrates command of an invariant (valid labeling), a correctness argument (no residual `s→t` path), and two practical heuristics (gap, global relabel). This file is a graded question bank, behavioral/system-design prompts, and three end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Concept | Rule / value |
|---------|--------------|
| Preflow | conservation relaxed: internal `e(u) ≥ 0` (excess allowed). |
| Excess `e(u)` | inflow − outflow. *Active* if `> 0` and `u ≠ s,t`. |
| Heights init | `h[s] = n`, all others `0`; `h[t] = 0` always. |
| Valid labeling | `h(u) ≤ h(v) + 1` for every residual edge `u→v`. |
| Admissible edge | residual `u→v` with `h(u) = h(v) + 1`. |
| PUSH | move `min(e(u), c_f(u,v))` along an admissible edge. |
| RELABEL | `h(u) = 1 + min{ h(v) : c_f(u,v) > 0 }`. |
| Height cap | `h(u) ≤ 2n − 1`. |
| Relabels total | `O(V²)`. Saturating pushes `O(VE)`. |
| Generic time | `O(V²E)`. |
| FIFO time | `O(V³)`. |
| Highest-label time | `O(V²√E)`. |
| Min-cut | residual-reachable-from-`s` set `S`; cut edges `S→T`. |
| Max-flow = min-cut | the foundational duality. |

Initialization and operation pseudocode:

```text
INIT:   h[s]=n; saturate every edge out of s; everything else h=0
LOOP:   while an active u exists:
            if admissible (u,v): PUSH(u,v)
            else:                RELABEL(u)
RESULT: preflow becomes a maximum flow; BFS residual from s gives the min-cut
```

Heuristics:

- **Gap:** if no vertex has height `g` (`0 < g < n`), lift every vertex with `g < h < n` to `n+1`.
- **Global relabel:** periodically set `h(u) = ` exact residual BFS distance to `t`.

---

## 60-Second Whiteboard Trace

A favorite warm-up: trace push-relabel on `s=0, a=1, b=2, t=3` with edges
`0→1 (3), 0→2 (2), 1→2 (1), 1→3 (2), 2→3 (3)`.

```text
INIT:  h[0]=4 (n=4); saturate source edges
       e[1]=3, e[2]=2   heights [4,0,0,0]
RELABEL a: residual neighbors b(0),t(0),back-s(4) → h[a]=1
PUSH a→t: min(3, cap 2)=2     e[a]=1, e[t]=2
PUSH a→b: min(1, cap 1)=1     e[a]=0, e[b]=3
RELABEL b: → h[b]=1
PUSH b→t: min(3, cap 3)=3     e[b]=0, e[t]=5
DONE: no active vertex. max flow = 5.
MIN-CUT: residual-reachable-from-s = {s}; cut edges {0→1, 0→2} cap 3+2 = 5. ✓
```

The point to say out loud: *we never searched for an augmenting path* — only compared each vertex to its immediate neighbors.

---

## Variant Comparison (be ready to recite)

| Algorithm | Worst case | Dense `E≈V²` | Unit-cap bipartite | Parallel | Keeps valid flow |
|-----------|-----------|--------------|--------------------|----------|------------------|
| Edmonds-Karp | `O(VE²)` | `O(V⁵)` | poor | no | yes |
| Dinic | `O(V²E)` | `O(V⁴)` | `O(E√V)` ← best | poorly | yes |
| Generic push-relabel | `O(V²E)` | `O(V⁴)` | ok | yes | **no** |
| FIFO push-relabel | `O(V³)` | `O(V³)` ← best | ok | yes | **no** |
| Highest-label push-relabel | `O(V²√E)` | `O(V³)` | ok | moderate | **no** |

One-liner to memorize: *"Push-relabel beats Dinic on dense graphs (`O(V³)` vs `O(V⁴)`) and parallelizes; Dinic beats push-relabel on unit-capacity bipartite (`O(E√V)`)."*

---

## Junior Questions (12 Q&A)

### J1. What problem does push-relabel solve?
The maximum-flow problem: given a directed graph with edge capacities, a source `s`, and a sink `t`, find the largest amount of flow that can be routed from `s` to `t` without exceeding any capacity. It is an alternative to the augmenting-path family (Edmonds-Karp, Dinic).

### J2. How is push-relabel different from Edmonds-Karp / Dinic?
Augmenting-path algorithms maintain a *valid flow* at every step and push flow along whole `s→t` paths found by BFS/DFS. Push-relabel instead works *locally*: it allows excess to accumulate at vertices (a *preflow*), assigns each vertex a *height*, and repeatedly pushes excess one step downhill or raises a stuck vertex. It never searches for a full path.

### J3. What is a preflow?
A preflow is like a flow but with flow conservation relaxed: an internal vertex may receive more flow than it sends out. The surplus is called *excess*. The algorithm's job is to drive all excess to zero, at which point the preflow becomes a valid (and maximum) flow.

### J4. What is the height (label) of a vertex and how is it initialized?
Each vertex has an integer height that controls where pushes are allowed. The source starts at height `n` (number of vertices), the sink at `0`, and everything else at `0`. The source's edges are then saturated to create the initial excess.

### J5. What is an admissible edge?
A residual edge `u→v` (one with remaining capacity) where `h(u) = h(v) + 1` — exactly one step downhill. Pushes happen only on admissible edges.

### J6. What does PUSH do?
On an admissible edge `u→v`, it moves `min(excess(u), residual(u,v))` units of flow from `u` to `v`, decreasing `excess(u)`, increasing `excess(v)`, and updating both the forward and reverse residual capacities.

### J7. What does RELABEL do?
When an active vertex `u` has no admissible outgoing edge, RELABEL raises its height to `1 + min{ h(v) : residual(u,v) > 0 }` — the smallest increase that creates a new admissible edge while keeping the labeling valid.

### J8. When does the algorithm stop?
When no internal vertex has any excess. At that point the preflow satisfies conservation everywhere, so it is a valid flow, and it is provably maximum.

### J9. What is the time complexity of the common variants?
Generic `O(V²E)`, FIFO `O(V³)`, highest-label `O(V²√E)`. With the gap and global-relabel heuristics it is much faster in practice.

### J10. How do you recover the min-cut after running push-relabel?
Run a BFS/DFS from `s` over residual edges (those with positive residual capacity). The vertices you can reach form the source side `S`; the rest form `T`. The edges from `S` to `T` are a minimum cut, and their total capacity equals the max flow.

### J11. Why does the source start at height `n`?
Because no residual `s→t` path can have length `≥ n` (there are only `n` vertices). Pinning `h(s) = n` and keeping the labeling valid guarantees there is never a residual augmenting path while the algorithm runs — which is exactly the optimality condition.

### J12. Is the intermediate state of push-relabel a valid flow?
No. During the run it is only a *preflow* — conservation is violated at vertices with excess. It becomes a valid flow only at termination. This is a common point of confusion when debugging.

---

## Middle Questions (12 Q&A)

### M1. Walk through the FIFO variant.
Keep active vertices in a queue. Dequeue the front vertex and *discharge* it: repeatedly push along admissible edges; when none remain and it still has excess, relabel and continue. Append any vertex that newly becomes active. Repeat until the queue is empty. This gives `O(V³)`.

### M2. Why is the height of any vertex bounded by `2n − 1`?
If a vertex `u` has excess, there is always a residual path from `u` back to `s` (excess can always return to the source). That path has at most `n − 1` edges, and along residual edges heights drop by at most 1, so `h(u) ≤ h(s) + (n−1) = 2n − 1`.

### M3. Why does the bound on heights bound the number of relabels?
Each relabel strictly increases a vertex's height, and the height never exceeds `2n − 1`, so each vertex is relabeled fewer than `2n` times. Total relabels are therefore `O(V²)`.

### M4. Explain the gap heuristic.
Track how many vertices sit at each height. If some level `g` (with `0 < g < n`) suddenly has zero vertices — a *gap* — then any vertex with height in `(g, n)` can no longer reach the sink (every residual path to `t` would have to cross the empty level). So immediately lift all those vertices to `n+1`, sending their excess back toward the source. It skips huge numbers of one-step relabels.

### M5. Explain the global-relabeling heuristic.
Local relabels make heights drift from their true distance to the sink. Periodically run a reverse BFS from `t` over residual edges and set each vertex's height to its exact BFS distance to `t`. This realigns heights with reality and dramatically reduces future relabels. Cost is `O(E)` per invocation, amortized to a small constant overhead.

### M6. When does push-relabel beat Dinic?
On *dense* graphs (`E ≈ V²`): highest-label/FIFO push-relabel is `O(V³)` while Dinic is `O(V²E) = O(V⁴)`. Push-relabel also parallelizes far better because its operations are local.

### M7. When does Dinic beat push-relabel?
On *unit-capacity* graphs and bipartite matching, where Dinic achieves `O(E√V)`. Dinic is also often simpler to implement correctly and is competitive on sparse graphs.

### M8. How do you reduce bipartite matching to max-flow for push-relabel?
Add a super-source `s` with unit-capacity edges to every left vertex, unit-capacity edges for each allowed left-right pair, and unit-capacity edges from every right vertex to a super-sink `t`. The max flow equals the maximum matching size.

### M9. Why does the algorithm parallelize well?
Push and relabel touch only a vertex and its incident edges — no global path or layer must be consistent mid-computation. Non-adjacent active vertices can be discharged simultaneously with atomic updates to `excess` and heights. Augmenting-path algorithms have an inherently sequential path-finding core.

### M10. What can overflow, and how do you prevent it?
The excess at a vertex can transiently equal the sum of all source out-capacities. With large capacities this overflows 32-bit integers silently. Use 64-bit accumulators for `excess` and `flow`.

### M11. What is a saturating vs non-saturating push?
A *saturating* push fills the edge (residual becomes 0). A *non-saturating* push empties the vertex's excess but leaves room on the edge. Saturating pushes are bounded by `O(VE)`; non-saturating pushes are the dominant cost and what the variant bounds differ on.

### M12. How do you verify a push-relabel implementation?
Cross-check the flow value against a simple Edmonds-Karp oracle on random small graphs; assert max-flow equals min-cut capacity; and after termination assert every internal vertex has zero excess. These three checks catch almost all bugs.

---

## Senior Questions (10 Q&A)

### S1. How would you build a max-flow service around push-relabel?
Stateless workers pull jobs (graph spec, `s`, `t`) from a queue, run single-thread push-relabel with gap + global relabel, and write back the flow value, min-cut, and flow edges. Bound input size to fit worker memory; cache results keyed by a hash of `(graph, s, t)`; expose metrics on active-set size and relabel counts.

### S2. How do you make push-relabel deterministic across runs?
The flow *value* is unique, but the flow *assignment* and the discovered min-cut depend on push order. To make the witness reproducible, fix a deterministic edge ordering, always prefer the lowest-index admissible edge, and/or canonicalize the cut (e.g., the lexicographically smallest residual-reachable set). For parallel runs, pin to single-thread when reproducibility is required.

### S3. Describe a parallel push-relabel design.
Run in synchronous sweeps: in each sweep, discharge all currently-active vertices in parallel using a *snapshot* of heights, applying pushes via atomic excess updates and relabels using the snapshot. Apply a single-thread global relabel periodically. Use work stealing across per-thread active queues. On GPU, each thread handles a vertex per sweep.

### S4. What synchronization is needed and what races are tolerable?
`excess` updates must be atomic (fetch-and-add). Pushes should CAS-validate `h[u] = h[v] + 1` with the residual update. A relabel reading a stale (snapshot) height may overshoot, but that only wastes a sweep — it never breaks validity, because every push re-checks admissibility atomically. The key invariant to assert in tests is global excess conservation.

### S5. How do you handle a graph too large for one machine?
Partition vertices (METIS to minimize the edge cut), run local discharges per partition, and exchange boundary excess and heights as messages each round. Communication is proportional to the edge cut, so partition quality dominates performance. Global relabel becomes a distributed reverse-BFS.

### S6. How do you support interactive / incremental recomputation?
Do not recompute from scratch when a few capacities change. Keep the previous flow and heights, adjust the changed edges' residuals, mark affected vertices active, and re-discharge. This is the standard pattern for interactive image segmentation (a user nudging seeds), giving tens-of-milliseconds updates instead of seconds.

### S7. What are the main failure modes in production?
Integer overflow on excess; height drift / stalling without global relabel; non-deterministic min-cut under parallelism; lost pushes under bad synchronization; `O(V²)` memory blowup if you use an adjacency matrix on a large graph; and adversarial inputs forcing near-worst-case behavior. Cap runtime and fall back to Dinic on timeout.

### S8. What observability would you add?
Gauges for active-vertex count and max height; counters for relabels, saturating and non-saturating pushes, and global relabels; a histogram for per-job runtime. The most useful signal is active-vertex count over time — a plateau means height drift; fire a global relabel.

### S9. Why is push-relabel the algorithm of choice for image segmentation at scale?
Graph-cut segmentation needs a min-cut on a grid graph with millions of pixel-vertices. Push-relabel's locality maps cleanly to GPU sweeps and to incremental updates as the user edits seeds, and it handles dense terminal-edge structure well. Boykov-Kolmogorov is the specialized augmenting-path competitor for smaller vision graphs.

### S10. Where does push-relabel sit in the modern max-flow landscape?
For practical work it remains a benchmark leader (Goldberg's `hi_pr`) alongside Dinic and Boykov-Kolmogorov. Orlin's `O(VE)` (2013) closed the strongly-polynomial gap, and Chen et al. (2022) gave an almost-linear `m^{1+o(1)}` algorithm — but those are theoretical; push-relabel with heuristics is what you deploy.

---

## Professional Questions (8 Q&A)

### P1. Prove that termination yields a maximum flow.
At termination no internal vertex has excess, so conservation holds and the preflow is a flow. The valid-labeling invariant holds throughout, and a valid labeling forbids any residual `s→t` path (a path of length `k ≤ n−1` would force `h(s) ≤ k < n`, contradicting `h(s)=n`). A flow with no residual augmenting path is maximum by max-flow min-cut. ∎

### P2. Prove the `O(VE)` bound on saturating pushes.
After a saturating `PUSH(u,v)`, the edge leaves the residual graph; to re-saturate it, a `PUSH(v,u)` must occur first, which requires `h(v) = h(u)+1`, whereas the previous push needed `h(u) = h(v)+1`. So between consecutive saturating pushes on the same edge, `h(u)` rises by at least 2. Since `h(u) ≤ 2n−1`, each edge is saturated `O(V)` times, giving `O(VE)` total. ∎

### P3. Prove FIFO push-relabel is `O(V³)`.
Use phases: phase 1 is the vertices active after init; phase `i+1` is the vertices activated while draining phase `i`. With the potential `Ψ = max height among active vertices`, the number of phases is `O(V²)` (it decreases except when a relabel raises it, and total relabel increase is `O(V²)`). Each phase contributes at most one non-saturating push per vertex, so `O(V)` per phase and `O(V³)` total non-saturating pushes; this dominates. ∎

### P4. Why is highest-label `O(V²√E)` rather than `O(V³)`?
Always discharging the maximum-height active vertex prevents excess from oscillating between levels. A potential argument combined with `Σ √(deg) ≤ √(EV)` bounds the non-saturating pushes by `O(V²√E)`. On dense graphs (`E=Θ(V²)`) this is `O(V³)`, matching FIFO, but on sparser dense-ish graphs it can be asymptotically better.

### P5. Prove the gap heuristic is sound.
If level `g` (`0<g<n`) is empty, any vertex `w` with `g < h(w) < n` cannot reach `t`: a residual `w→t` path has heights dropping by ≤1 per step from `h(w) > g` to `h(t)=0`, so it must hit a vertex of height exactly `g` — impossible. So `w`'s excess can only return to `s`; lifting `w` to `n+1` keeps the labeling valid and only speeds that return. ∎

### P6. What exactly does global relabeling compute and why is it valid?
It sets `h(u)` to the exact residual BFS distance `d_f(u,t)` (and `n + d_f(u,s)` for vertices that cannot reach `t`). BFS distances satisfy `d_f(u,t) ≤ d_f(v,t)+1` for residual `(u,v)`, which is precisely the validity inequality; and exactness means heights are the largest valid values, minimizing future relabels.

### P7. Compare the asymptotics of push-relabel variants with Dinic and Orlin's algorithm.
Generic PR `O(V²E)`; FIFO `O(V³)`; highest-label `O(V²√E)`; Dinic `O(V²E)` (but `O(E√V)` on unit capacities); Edmonds-Karp `O(VE²)`; Orlin (2013) `O(VE)` strongly polynomial. On dense graphs the highest-label/FIFO `O(V³)` beats Dinic's `O(V⁴)`.

### P8. What memory representation do you choose and why?
For large/sparse graphs, paired residual edge arrays in CSR layout — `O(V+E)` memory, cache-friendly sequential edge scans, and the `e ^ 1` trick to find an edge's reverse in `O(1)`. The `O(V²)` adjacency matrix is acceptable only for dense graphs with `V ≲ 2000`; beyond that it is infeasible.

---

## Behavioral / System-Design Prompts (5)

### B1. Tell me about a time you chose a more complex algorithm for a real speedup.
Frame: a max-flow job was timing out with Edmonds-Karp on a dense graph. You profiled, identified the `O(VE²)` blowup, switched to FIFO push-relabel with gap + global relabel, validated against the old result on a sample, and cut runtime from minutes to under a second. Emphasize validation before rollout.

### B2. Design a service that runs max-flow / min-cut on user-submitted graphs.
Cover: stateless workers, a job queue, input-size limits and validation, single-thread push-relabel with heuristics, result caching keyed by graph hash, metrics (active set, relabels, runtime), timeouts with a Dinic fallback, and a clear API returning flow value + min-cut.

### B3. A teammate's push-relabel returns wrong answers intermittently. How do you debug?
Add an Edmonds-Karp oracle and a random-graph fuzz harness; assert max-flow == min-cut and zero residual excess at termination. Intermittent wrongness on large capacities strongly suggests 32-bit overflow on excess — check accumulator types first.

### B4. Design an interactive image-segmentation feature using graph cuts.
Model pixels as vertices, foreground/background as `s`/`t`, neighbor and terminal edges with energy-based capacities. Use push-relabel (GPU for live edits), and incremental recomputation when the user nudges seeds. Discuss latency budget, GPU/CPU split (global relabel on CPU), and caching.

### B5. How would you decide between push-relabel and Dinic for a new project?
Ask about graph density and capacity structure. Dense → push-relabel. Unit-capacity / bipartite matching → Dinic (`O(E√V)`). Need parallelism/GPU → push-relabel. Tiny graphs or readability-first → Edmonds-Karp/Dinic. Prototype both, benchmark on representative data, and keep the simpler one unless the numbers demand otherwise.

---

## Coding Challenges

### Challenge 1 — Maximum flow via FIFO push-relabel

**Statement.** Given `n` vertices, edges `(u, v, c)`, a source `s`, and a sink `t`, return the maximum flow value.

#### Go

```go
package main

import "fmt"

type PR struct {
	n              int
	to, capE, flowE []int
	g              [][]int
}

func NewPR(n int) *PR { return &PR{n: n, g: make([][]int, n)} }
func (p *PR) Add(u, v, c int) {
	p.g[u] = append(p.g[u], len(p.to)); p.to = append(p.to, v); p.capE = append(p.capE, c); p.flowE = append(p.flowE, 0)
	p.g[v] = append(p.g[v], len(p.to)); p.to = append(p.to, u); p.capE = append(p.capE, 0); p.flowE = append(p.flowE, 0)
}
func (p *PR) MaxFlow(s, t int) int {
	n := p.n
	h := make([]int, n); ex := make([]int, n); h[s] = n
	for _, e := range p.g[s] {
		a := p.capE[e]; p.flowE[e] += a; p.flowE[e^1] -= a; ex[s] -= a; ex[p.to[e]] += a
	}
	q := []int{}; inq := make([]bool, n)
	for v := 0; v < n; v++ {
		if v != s && v != t && ex[v] > 0 { q = append(q, v); inq[v] = true }
	}
	for len(q) > 0 {
		u := q[0]; q = q[1:]; inq[u] = false
		for ex[u] > 0 {
			pushed := false
			for _, e := range p.g[u] {
				if p.capE[e]-p.flowE[e] > 0 && h[u] == h[p.to[e]]+1 {
					d := ex[u]; if r := p.capE[e] - p.flowE[e]; r < d { d = r }
					p.flowE[e] += d; p.flowE[e^1] -= d; ex[u] -= d; ex[p.to[e]] += d
					if v := p.to[e]; v != s && v != t && !inq[v] { q = append(q, v); inq[v] = true }
					pushed = true
					if ex[u] == 0 { break }
				}
			}
			if ex[u] == 0 { break }
			if !pushed {
				mn := 1 << 30
				for _, e := range p.g[u] {
					if p.capE[e]-p.flowE[e] > 0 && h[p.to[e]]+1 < mn { mn = h[p.to[e]] + 1 }
				}
				if mn < (1 << 30) { h[u] = mn } else { break }
			}
		}
	}
	total := 0
	for _, e := range p.g[s] { total += p.flowE[e] }
	return total
}

func main() {
	p := NewPR(6)
	for _, e := range [][3]int{{0,1,16},{0,2,13},{1,2,10},{2,1,4},{1,3,12},{3,2,9},{2,4,14},{4,3,7},{3,5,20},{4,5,4}} {
		p.Add(e[0], e[1], e[2])
	}
	fmt.Println(p.MaxFlow(0, 5)) // 23
}
```

#### Java

```java
import java.util.*;

public class MaxFlowPR {
    int n; int[] to, cap, flow; int m = 0; List<List<Integer>> g;
    MaxFlowPR(int n, int e) { this.n = n; to = new int[2*e]; cap = new int[2*e]; flow = new int[2*e];
        g = new ArrayList<>(); for (int i=0;i<n;i++) g.add(new ArrayList<>()); }
    void add(int u,int v,int c){ g.get(u).add(m); to[m]=v; cap[m]=c; m++; g.get(v).add(m); to[m]=u; cap[m]=0; m++; }
    int maxFlow(int s,int t){
        int[] h=new int[n], ex=new int[n]; h[s]=n;
        for(int e: g.get(s)){ int a=cap[e]; flow[e]+=a; flow[e^1]-=a; ex[s]-=a; ex[to[e]]+=a; }
        Deque<Integer> q=new ArrayDeque<>(); boolean[] inq=new boolean[n];
        for(int v=0;v<n;v++) if(v!=s&&v!=t&&ex[v]>0){ q.add(v); inq[v]=true; }
        while(!q.isEmpty()){
            int u=q.poll(); inq[u]=false;
            while(ex[u]>0){
                boolean pushed=false;
                for(int e: g.get(u)) if(cap[e]-flow[e]>0 && h[u]==h[to[e]]+1){
                    int d=Math.min(ex[u],cap[e]-flow[e]); flow[e]+=d; flow[e^1]-=d; ex[u]-=d; ex[to[e]]+=d;
                    int v=to[e]; if(v!=s&&v!=t&&!inq[v]){ q.add(v); inq[v]=true; }
                    pushed=true; if(ex[u]==0) break;
                }
                if(ex[u]==0) break;
                if(!pushed){ int mn=Integer.MAX_VALUE;
                    for(int e: g.get(u)) if(cap[e]-flow[e]>0) mn=Math.min(mn,h[to[e]]+1);
                    if(mn!=Integer.MAX_VALUE) h[u]=mn; else break; }
            }
        }
        int tot=0; for(int e: g.get(s)) tot+=flow[e]; return tot;
    }
    public static void main(String[] a){
        int[][] E={{0,1,16},{0,2,13},{1,2,10},{2,1,4},{1,3,12},{3,2,9},{2,4,14},{4,3,7},{3,5,20},{4,5,4}};
        MaxFlowPR p=new MaxFlowPR(6,E.length); for(int[] e:E) p.add(e[0],e[1],e[2]);
        System.out.println(p.maxFlow(0,5)); // 23
    }
}
```

#### Python

```python
from collections import deque

class PR:
    def __init__(self, n):
        self.n=n; self.to=[]; self.cap=[]; self.flow=[]; self.g=[[] for _ in range(n)]
    def add(self,u,v,c):
        self.g[u].append(len(self.to)); self.to.append(v); self.cap.append(c); self.flow.append(0)
        self.g[v].append(len(self.to)); self.to.append(u); self.cap.append(0); self.flow.append(0)
    def max_flow(self,s,t):
        n=self.n; h=[0]*n; ex=[0]*n; h[s]=n
        for e in self.g[s]:
            a=self.cap[e]; self.flow[e]+=a; self.flow[e^1]-=a; ex[s]-=a; ex[self.to[e]]+=a
        q=deque(v for v in range(n) if v!=s and v!=t and ex[v]>0); inq=[False]*n
        for v in q: inq[v]=True
        while q:
            u=q.popleft(); inq[u]=False
            while ex[u]>0:
                pushed=False
                for e in self.g[u]:
                    if self.cap[e]-self.flow[e]>0 and h[u]==h[self.to[e]]+1:
                        d=min(ex[u],self.cap[e]-self.flow[e]); self.flow[e]+=d; self.flow[e^1]-=d
                        ex[u]-=d; v=self.to[e]; ex[v]+=d
                        if v!=s and v!=t and not inq[v]: q.append(v); inq[v]=True
                        pushed=True
                        if ex[u]==0: break
                if ex[u]==0: break
                if not pushed:
                    mn=min((h[self.to[e]]+1 for e in self.g[u] if self.cap[e]-self.flow[e]>0),default=None)
                    if mn is None: break
                    h[u]=mn
        return sum(self.flow[e] for e in self.g[s])

if __name__=="__main__":
    p=PR(6)
    for u,v,c in [(0,1,16),(0,2,13),(1,2,10),(2,1,4),(1,3,12),(3,2,9),(2,4,14),(4,3,7),(3,5,20),(4,5,4)]:
        p.add(u,v,c)
    print(p.max_flow(0,5))  # 23
```

### Challenge 2 — Recover the minimum cut

**Statement.** After computing max flow, return the set of vertices on the source side of a minimum cut and the cut's capacity.

#### Go

```go
// Assumes Challenge-1 PR with MaxFlow already run.
func (p *PR) MinCut(s int) ([]bool, int) {
	vis := make([]bool, p.n)
	q := []int{s}; vis[s] = true
	for len(q) > 0 {
		u := q[0]; q = q[1:]
		for _, e := range p.g[u] {
			if !vis[p.to[e]] && p.capE[e]-p.flowE[e] > 0 { vis[p.to[e]] = true; q = append(q, p.to[e]) }
		}
	}
	cut := 0
	for u := 0; u < p.n; u++ {
		if vis[u] {
			for _, e := range p.g[u] {
				if !vis[p.to[e]] && p.capE[e] > 0 { cut += p.capE[e] } // original capacity crossing S->T
			}
		}
	}
	return vis, cut
}
```

#### Java

```java
int[] minCut(int s) { // returns {sourceSideMask packed? } — here: print cut capacity
    boolean[] vis = new boolean[n];
    Deque<Integer> q = new ArrayDeque<>(); q.add(s); vis[s] = true;
    while (!q.isEmpty()) {
        int u = q.poll();
        for (int e : g.get(u)) if (!vis[to[e]] && cap[e]-flow[e] > 0) { vis[to[e]] = true; q.add(to[e]); }
    }
    int cut = 0;
    for (int u = 0; u < n; u++) if (vis[u])
        for (int e : g.get(u)) if (!vis[to[e]] && cap[e] > 0) cut += cap[e];
    return new int[]{cut};
}
```

#### Python

```python
def min_cut(self, s):
    vis = [False]*self.n; q = deque([s]); vis[s] = True
    while q:
        u = q.popleft()
        for e in self.g[u]:
            if not vis[self.to[e]] and self.cap[e]-self.flow[e] > 0:
                vis[self.to[e]] = True; q.append(self.to[e])
    cut = sum(self.cap[e] for u in range(self.n) if vis[u]
              for e in self.g[u] if not vis[self.to[e]] and self.cap[e] > 0)
    return vis, cut
```

### Challenge 3 — Maximum bipartite matching via push-relabel

**Statement.** Given a bipartite graph with `L` left and `R` right vertices and allowed pairs, return the maximum matching size.

#### Go

```go
func MaxBipartiteMatching(L, R int, pairs [][2]int) int {
	n := L + R + 2
	s, t := L+R, L+R+1
	p := NewPR(n)
	for i := 0; i < L; i++ { p.Add(s, i, 1) }
	for j := 0; j < R; j++ { p.Add(L+j, t, 1) }
	for _, e := range pairs { p.Add(e[0], L+e[1], 1) }
	return p.MaxFlow(s, t)
}
```

#### Java

```java
static int maxBipartiteMatching(int L, int R, int[][] pairs) {
    int n = L + R + 2, s = L + R, t = L + R + 1;
    MaxFlowPR p = new MaxFlowPR(n, L + R + pairs.length);
    for (int i = 0; i < L; i++) p.add(s, i, 1);
    for (int j = 0; j < R; j++) p.add(L + j, t, 1);
    for (int[] e : pairs) p.add(e[0], L + e[1], 1);
    return p.maxFlow(s, t);
}
```

#### Python

```python
def max_bipartite_matching(L, R, pairs):
    n = L + R + 2; s, t = L + R, L + R + 1
    p = PR(n)
    for i in range(L): p.add(s, i, 1)
    for j in range(R): p.add(L + j, t, 1)
    for a, b in pairs: p.add(a, L + b, 1)
    return p.max_flow(s, t)

if __name__ == "__main__":
    # 3 left, 3 right; perfect matching possible -> 3
    print(max_bipartite_matching(3, 3, [(0,0),(0,1),(1,1),(1,2),(2,0),(2,2)]))  # 3
```

### Challenge 4 — Edge-disjoint paths (unit-capacity max flow)

**Statement.** Return the maximum number of edge-disjoint `s→t` paths. By Menger's theorem this equals the max flow when every edge has capacity 1.

#### Go

```go
func EdgeDisjointPaths(n int, edges [][2]int, s, t int) int {
	p := NewPR(n) // reuse Challenge-1 PR
	for _, e := range edges {
		p.Add(e[0], e[1], 1)
	}
	return p.MaxFlow(s, t)
}
// EdgeDisjointPaths(4, [][2]int{{0,1},{0,2},{1,3},{2,3},{1,2}}, 0, 3) == 2
```

#### Java

```java
static int edgeDisjointPaths(int n, int[][] edges, int s, int t) {
    MaxFlowPR p = new MaxFlowPR(n, edges.length); // reuse Challenge-1 class
    for (int[] e : edges) p.add(e[0], e[1], 1);
    return p.maxFlow(s, t);
}
```

#### Python

```python
def edge_disjoint_paths(n, edges, s, t):
    p = PR(n)  # reuse Challenge-1 PR
    for u, v in edges:
        p.add(u, v, 1)
    return p.max_flow(s, t)

if __name__ == "__main__":
    print(edge_disjoint_paths(4, [(0,1),(0,2),(1,3),(2,3),(1,2)], 0, 3))  # 2
```

**Why it works.** Capacity-1 edges can each carry at most one unit, so any integral flow decomposes into that many edge-disjoint paths; max flow gives the maximum count. The same code with node-splitting (capacity-1 vertices) yields *vertex*-disjoint paths.

---

## Common Interview Traps

- **"It maintains a valid flow."** It does not — it maintains a *preflow*. Conservation is restored only at termination.
- **Forgetting the `+1` in relabel** — `h(u) = 1 + min h(v)`. Without it, the vertex never escapes and the loop hangs.
- **Pushing on a non-admissible edge** — pushes require `h(u) = h(v) + 1` exactly, not just downhill.
- **Counting `s`/`t` as active** — only internal vertices with positive excess are active.
- **Min-cut from original capacities** — use *residual* reachability from `s`, then sum *original* capacities of crossing edges.
- **32-bit excess overflow** — excess can reach the sum of source out-capacities; use 64-bit.

---

## Final Tips

- State the **invariant** (`h(u) ≤ h(v)+1` on residual edges) early — it signals deep understanding.
- Mention the **two heuristics** (gap, global relabel) even on a whiteboard; interviewers love that you know push-relabel needs them in practice.
- Contrast with Dinic: push-relabel for **dense/parallel**, Dinic for **unit-capacity bipartite**.
- Always note the **overflow** risk on excess and the **min-cut via residual reachability**.
- If asked to code it, write the FIFO variant — it is the simplest correct one to get right under pressure.
