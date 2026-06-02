# A* Search — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definition
2. Optimality Proofs (admissible ⇒ optimal; consistent ⇒ no reopening; f-monotonicity lemma)
3. Optimal Efficiency of A* (Dechter–Pearl)
4. Complexity, Heuristic Accuracy, and Effective Branching Factor
5. Space-Bounded Variants — IDA* and SMA*
6. Worked Expansion Trace (f = g + h)
7. Reference Implementations (IDA*, Weighted A*, Consistency Checker)
8. Cache Behavior
9. Average-Case and Phase Transitions
10. Space–Time Trade-offs
11. Comparison with Alternatives
12. Open Problems and Research Directions
13. Summary

---

## 1. Formal Definition

Let `G = (V, E)` be a directed graph with a non-negative cost function `c : E → ℝ₊`. Fix a start node `s ∈ V` and a non-empty goal set `Γ ⊆ V`. For a node `n`, let

- `g*(n)` = cost of a cheapest path from `s` to `n`;
- `h*(n)` = cost of a cheapest path from `n` to any goal in `Γ` (`+∞` if none exists);
- `k(n, m)` = cost of a cheapest path from `n` to `m`.

**Definition 1.1 (Evaluation function).** A* maintains, for each generated node `n`, a value `g(n)` (cost of the best path to `n` found so far) and computes

```
f(n) = g(n) + h(n),
```

where `h : V → ℝ₊` is the **heuristic** with `h(γ) = 0` for `γ ∈ Γ`. Define `f*(n) = g*(n) + h*(n)`; note `f*(s) = h*(s) = C*`, the optimal solution cost.

**Definition 1.2 (Admissibility).** `h` is **admissible** iff `h(n) ≤ h*(n)` for all `n ∈ V`.

**Definition 1.3 (Consistency / monotonicity).** `h` is **consistent** iff for every edge `(n, m) ∈ E`,

```
h(n) ≤ c(n, m) + h(m),    and    h(γ) = 0 for γ ∈ Γ.
```

**Definition 1.4 (A\* procedure).** A* maintains a priority queue OPEN (the frontier) ordered by `f`, and a set CLOSED. It repeatedly removes a node of minimum `f`, returns the path if it is a goal, otherwise moves it to CLOSED and *relaxes* each successor `m`: if a cheaper `g(m)` is found, update `g(m)`, set its parent, and place/replace `m` in OPEN (reopening it from CLOSED if necessary).

**Proposition 1.5.** With `h ≡ 0`, A* reduces to **Dijkstra's algorithm**; with `g ≡ 0` (priority `= h`), it reduces to **greedy best-first search**. A* is the one-parameter family interpolating between them.

---

## 2. Optimality Proofs

Throughout, assume edge costs are non-negative and, where needed, that every infinite path has unbounded cost (so the search is well-founded).

### 2.1 The f-monotonicity lemma (consistency)

**Lemma 2.1.** If `h` is consistent, then along any path `n₀, n₁, …, n_k` that A* follows (i.e., `g(n_{i+1}) = g(n_i) + c(n_i, n_{i+1})`), the value `f` is non-decreasing:

```
f(n_{i+1}) = g(n_{i+1}) + h(n_{i+1})
           = g(n_i) + c(n_i, n_{i+1}) + h(n_{i+1})
           ≥ g(n_i) + h(n_i)                     (consistency)
           = f(n_i).
```

**Corollary 2.2.** With a consistent `h`, the sequence of `f`-values of nodes expanded by A* is non-decreasing. Hence when A* removes a node `n` from OPEN, `g(n) = g*(n)` already — its `g` is optimal at first expansion.

*Proof of Corollary.* Suppose, for contradiction, that `n` is expanded with `g(n) > g*(n)`. Consider an optimal path `s ⇝ n`. Some node `p` on it is still in OPEN at the moment `n` is expanded (the start is expanded first; take the deepest expanded prefix and let `p` be its OPEN successor). For that `p`, `g(p) = g*(p)` and `f(p) = g*(p) + h(p) ≤ g*(p) + k(p, n) + h(n) = g*(n) + h(n) ≤ g(n) + h(n) = f(n)`, using consistency telescoped along the optimal sub-path `p ⇝ n`. So `f(p) ≤ f(n)`, and A* would have expanded `p` (or a tie) no later than `n` — contradicting that `p` is still in OPEN. Hence `g(n) = g*(n)`. ∎

Corollary 2.2 is exactly the statement that **a consistent heuristic never forces reopening**: once closed, a node's `g` is final.

### 2.2 Admissibility ⇒ optimality

**Theorem 2.3 (Hart–Nilsson–Raphael 1968).** If `h` is admissible and a solution exists, A* terminates by returning an optimal-cost path.

*Proof.* Suppose A* selects a goal `γ` for expansion with `g(γ) > C*` (a suboptimal goal; note `f(γ) = g(γ)` since `h(γ) = 0`). Consider an optimal solution path and let `n` be the shallowest node on it currently in OPEN (such `n` exists: `s` is on the path and was in OPEN; the goal on it has not yet been expanded). By admissibility,

```
f(n) = g(n) + h(n) ≤ g*(n) + h*(n) = C*,
```

because A* keeps `g(n) = g*(n)` for nodes on an optimal path whose ancestors are expanded (the prefix up to `n` is optimal). Then `f(n) ≤ C* < g(γ) = f(γ)`, so A* would expand `n` before `γ` — contradiction. Therefore A* cannot select a suboptimal goal; the first goal expanded has cost `C*`. ∎

The proof requires reopening when `h` is admissible but inconsistent: the "`g(n) = g*(n)` for an OPEN ancestor" step needs that improved paths to closed nodes are propagated, which is precisely reopening.

### 2.3 Completeness

**Theorem 2.4.** On a graph with finitely many nodes of `f`-value below any bound and with `c(e) ≥ δ > 0` for some `δ` (or finite branching with costs bounded below), A* is complete: it finds a solution if one exists and reports failure (OPEN empties) otherwise. The lower bound on costs prevents an infinite sequence of zero-progress expansions.

### 2.4 Necessity of expanding `f < C*` nodes

**Lemma 2.5.** Every node `n` with `f*(n) = g*(n) + h*(n) < C*` is *surely expanded* by A* (under admissible `h`, with tie-breaking aside). Conversely, no node with `f(n) > C*` is ever expanded. Thus A* expands exactly the nodes with `f* < C*`, plus some subset of the `f* = C*` "tie band." This characterization underpins the optimal-efficiency result in §3.

---

## 3. Optimal Efficiency of A* (Dechter–Pearl)

**Theorem 3.1 (Dechter & Pearl 1985).** Among all admissible best-first search algorithms that are guaranteed to find an optimal solution using the same heuristic `h`, A* is **optimally efficient**: any such algorithm `B` must expand every node that A* surely expands (every node with `f*(n) < C*`). Therefore no admissible algorithm using `h` can expand asymptotically fewer nodes than A* on every problem instance.

*Sketch.* If `B` fails to expand some node `n` with `f*(n) < C*`, an adversary can attach below `n` a path to a new goal with total cost `f*(n) < C*` consistent with all comparisons `B` has made. Then `B` returns a path of cost `≥ C*` while a cheaper one exists, contradicting `B`'s optimality. Hence `B` must expand `n`. ∎

**Caveats and refinements.**

- The theorem concerns *node expansions*, counting a node once. It assumes the heuristic is the only domain information and ties may be broken adversarially.
- With **inconsistent** admissible heuristics, A* may **re-expand** nodes; the number of re-expansions can be exponential in pathological cases (Martelli 1977). Algorithms like **B**, **B'**, and **BPMX** bound or reduce reopening; in the consistent case (Corollary 2.2) reopening is zero.
- "Optimally efficient" does **not** mean "few nodes": with a weak heuristic A* still expands exponentially many. It means *no admissible competitor does better with the same `h`*.

---

## 4. Complexity, Heuristic Accuracy, and Effective Branching Factor

### 4.1 Worst case

In the worst case (e.g., `h ≡ 0`), A* expands `Θ(|{n : f*(n) ≤ C*}|)` nodes, which for an exponential search tree of branching factor `b` and solution depth `d` is `O(b^d)`. Each expansion costs `O(log |OPEN|)` for the priority-queue operations plus `O(b)` for successor relaxation. With a graph representation, the bound is the Dijkstra bound `O(|E| + |V| log |V|)` using a Fibonacci-heap OPEN, or `O(|E| log |V|)` with a binary heap.

### 4.2 Effective branching factor

If A* expands `N` nodes to find a solution at depth `d`, the **effective branching factor** `b*` is the (unique positive) solution of

```
N + 1 = 1 + b* + (b*)² + … + (b*)^d = ((b*)^{d+1} − 1) / (b* − 1).
```

`b*` is the standard quality measure for a heuristic: `b* → 1` means a near-straight search; `b* = b` means no pruning (Dijkstra). Empirically, for the 8-puzzle the misplaced-tiles heuristic gives `b* ≈ 1.42`, while Manhattan distance gives `b* ≈ 1.24` — a large reduction in nodes from a strictly dominating heuristic.

### 4.3 Heuristic error and node growth

**Theorem 4.1 (Pohl 1977; Gaschnig 1979, informal).** If the heuristic error `h*(n) − h(n)` grows at most logarithmically in `h*(n)` — i.e., `|h*(n) − h(n)| = O(log h*(n))` — then A* expands only `O(d)` nodes (polynomial, often linear in depth). If the error is bounded by a **constant**, growth is polynomial. If the **relative** error `(h* − h)/h*` is bounded below by a positive constant, A* generally still expands exponentially many nodes. Thus sub-exponential behavior demands heuristics whose *absolute* error grows very slowly — a stringent requirement met only by strong heuristics (pattern databases, landmarks).

### 4.4 Dominance and additivity

For admissible `h₁, h₂`: `max(h₁, h₂)` is admissible and dominates both. For consistency, `max` of consistent heuristics is consistent. **Disjoint pattern databases** give *additive* admissible heuristics (sum of independent sub-costs), which can vastly exceed any single Manhattan-style estimate while remaining admissible (Korf & Felner 2002).

---

## 5. Space-Bounded Variants — IDA* and SMA*

A*'s fatal weakness is `Θ(b^d)` memory (it stores the whole frontier and closed set). Two classical fixes trade time or precision for space.

### 5.1 IDA* (Korf 1985)

**Iterative-Deepening A\*** performs a series of cost-bounded depth-first searches. Threshold `τ₀ = h(s)`; each iteration DFS-prunes any node with `f(n) > τ`, and the next threshold is the minimum `f` that exceeded the current one.

```
IDA*(s):
  τ := h(s)
  loop:
    (found, next_τ) := DFS(s, 0, τ)
    if found: return path
    if next_τ = ∞: return failure
    τ := next_τ
```

- **Space:** `O(d)` (the recursion stack) — the headline advantage.
- **Optimality:** preserved for admissible `h` (each iteration is an admissible bounded search; thresholds increase to `C*`).
- **Time:** the same `O(b^d)` asymptotically, but with a constant-factor overhead from re-expanding shallow nodes each iteration. With **distinct** edge costs (real-valued), thresholds increase by tiny increments and IDA* can degrade badly; remedies include threshold inflation and **IDA\*_CR** / **RBFS** (Korf 1993).

### 5.2 SMA* (Russell 1992)

**Simplified Memory-Bounded A\*** uses all available memory: it runs like A* until memory fills, then **drops the highest-`f` leaf** from OPEN, backing up its `f`-value into its parent so the information is not entirely lost. SMA* is complete and optimal if the memory bound is at least the depth of the shallowest solution, and it degrades gracefully — it solves whatever the memory allows, optimally within that bound. Its analysis shows the inherent **time–space trade-off**: less memory ⇒ more re-generation of forgotten subtrees.

### 5.3 Weighted A* and WIDA*

With `f = g + w·h`, `w ≥ 1`, the returned solution cost is at most `w · C*` (bounded suboptimality). The proof mirrors Theorem 2.3 with the inflated bound: any expanded suboptimal goal would have `g > w·C* ≥ w·f*(n) ≥ f_w(n)` for an OPEN optimal-path node `n`, a contradiction. Anytime variants (ARA*, Likhachev et al. 2003) decrease `w` over time, reusing search effort to converge toward optimality.

---

## 6. Worked Expansion Trace (f = g + h)

Theory becomes concrete when you watch `f = g + h` drive the frontier. Consider the 4-connected grid below. `S` is the start at `(0,0)`, `T` the goal at `(3,4)`, and `#` are walls. Movement cost is `1` per step; the heuristic is Manhattan distance, which is **consistent** on a 4-connected unit grid.

```
        col 0  1  2  3  4
 row 0   S  .  .  .  .
 row 1   .  #  #  #  .
 row 2   .  .  .  #  .
 row 3   .  .  .  .  T
```

`h(n) = |n.row − 3| + |n.col − 4|`. We track the OPEN priority queue keyed by `f`, breaking ties toward **larger g** (closer to goal). Each row shows the node popped, its `g/h/f`, and the successors pushed.

```
 Pop  node    g  h  f   action / successors pushed (f)
 ───  ─────  ── ── ──  ─────────────────────────────────────────────
  1   (0,0)   0  7  7   push (0,1)f7  (1,0)f7
  2   (1,0)   1  6  7   push (2,0)f7                 [(0,1) is a tie]
  3   (2,0)   2  5  7   push (2,1)f7  (3,0)f7
  4   (3,0)   3  4  7   push (3,1)f7
  5   (3,1)   4  3  7   push (2,1) already g=3? no → push (3,2)f7
  6   (3,2)   5  2  7   push (3,3)f7
  7   (3,3)   6  1  7   push (3,4)=T f7
  8   (3,4)=T 7  0  7   GOAL — return cost 7
```

Two facts the trace makes visible:

1. **`f` is constant at 7 along the optimal corridor.** Because the heuristic is consistent and tight on this open corridor, every node on a shortest path has `f = C* = 7`. The f-monotonicity lemma (Lemma 2.1) says `f` never *decreases*; here it never even increases, so A* walks straight to the goal expanding 8 nodes and zero detours.

2. **Ties decided the shape.** Nodes `(0,1)`, `(2,1)`, `(3,1)` all sat at `f = 7` alongside the corridor nodes. The "larger g" tie-break popped corridor nodes first, so the off-path ties were never expanded. With a "smaller g" rule A* would have fanned sideways into the `f = 7` band before committing — the same optimal cost, more expansions. This is the §4 tie-band in action: A* must expand all `f* < C*` nodes (none here) but only *some* of the `f* = C*` band, and tie-breaking chooses which.

Now contrast with `h ≡ 0` (Dijkstra) on the same grid: every reachable cell with `g ≤ 7` enters the band `f = g ≤ 7`, so Dijkstra expands the entire connected region within radius 7 — roughly every open cell — before reaching `T`. The heuristic's only job is to *bias* the otherwise-uniform `g`-expansion toward the goal, and the trace shows it doing exactly that.

### 6.1 An inconsistent-heuristic trace (forced reopening)

To see reopening, take a tiny graph with an admissible-but-inconsistent `h`:

```
        c=1        c=1
   S ───────► A ───────► T
   │                     ▲
   │ c=1                 │ c=1
   └──────► B ───────────┘
        h: h(S)=4 h(A)=1 h(B)=4 h(T)=0
        (admissible: h*(S)=2,h*(A)=1,h*(B)=1,h*(T)=0 → h(B)=4 > h*(B)=1? )
```

`h(B) = 4 > h*(B) = 1` would be *inadmissible*; instead set `h(B)=0`, `h(A)=1`, `h(S)=2`, but lower `h(A)` to `0` to break consistency: edge `(S,A)` needs `h(S) ≤ c(S,A)+h(A) = 1+0 = 1`, yet `h(S)=2 > 1` — inconsistent, still admissible since `h(S)=2 ≤ h*(S)=2`. A* pops `S(f=2)`, relaxes `A(g=1,f=1)` and `B(g=1,f=1)`. It pops `A(f=1)`, closes it, relaxes `T(g=2,f=2)`. It pops `B(f=1)`, finds `A` reachable at `g=1` (no improvement) — but on graphs where the second path to a *closed* node is cheaper, A* must pull that node back out of CLOSED and re-push it. Corollary 2.2 guarantees this never happens under consistency; here it can, which is exactly why the inconsistent case voids the "closed is final" invariant.

---

## 7. Reference Implementations (IDA*, Weighted A*, Consistency Checker)

The three algorithms a professional reaches for beyond textbook A*: **IDA\*** for `O(d)` space, **weighted A\*** for bounded-suboptimal speed, and a **consistency checker** to validate that a heuristic earns the "no reopening" guarantee before you rely on it.

### 7.1 IDA* — iterative-deepening A*

#### Go

```go
package main

import (
	"fmt"
	"math"
)

// Graph as adjacency with unit-or-weighted edges.
type Edge struct {
	to   int
	cost float64
}

// IDAStar finds an optimal path cost from start to goal using O(depth) memory.
// h must be admissible. Returns (cost, found).
func IDAStar(adj [][]Edge, start, goal int, h func(int) float64) (float64, bool) {
	threshold := h(start)
	path := []int{start}
	for {
		// dfs returns the smallest f that EXCEEDED the threshold, or -1 on success.
		next := math.Inf(1)
		var dfs func(node int, g float64) float64
		dfs = func(node int, g float64) float64 {
			f := g + h(node)
			if f > threshold {
				return f // prune; report this f as a candidate next threshold
			}
			if node == goal {
				return -1 // sentinel: found
			}
			localMin := math.Inf(1)
			for _, e := range adj[node] {
				if contains(path, e.to) {
					continue // avoid cycles on the current DFS stack
				}
				path = append(path, e.to)
				t := dfs(e.to, g+e.cost)
				if t == -1 {
					return -1
				}
				if t < localMin {
					localMin = t
				}
				path = path[:len(path)-1]
			}
			return localMin
		}
		next = dfs(start, 0)
		if next == -1 {
			return threshold, true // threshold equals C* at success
		}
		if math.IsInf(next, 1) {
			return math.Inf(1), false // exhausted
		}
		threshold = next
	}
}

func contains(s []int, v int) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func main() {
	// 0 ->1 ->3 (goal); 0 ->2 ->3
	adj := [][]Edge{
		{{1, 1}, {2, 4}}, {{3, 5}}, {{3, 1}}, {},
	}
	h := func(n int) float64 { // admissible lower bounds to node 3
		return []float64{2, 5, 1, 0}[n]
	}
	cost, ok := IDAStar(adj, 0, 3, h)
	fmt.Println(cost, ok) // 5 true  (0->2->3 = 4+1=5)
}
```

#### Java

```java
import java.util.*;

public class IDAStar {
    record Edge(int to, double cost) {}

    static double threshold;
    static List<Edge>[] adj;
    static int goal;
    static double[] h;
    static Deque<Integer> path = new ArrayDeque<>();

    // Returns optimal cost, or Double.POSITIVE_INFINITY if unreachable.
    public static double search(List<Edge>[] graph, int start, int g, double[] heur) {
        adj = graph; goal = g; h = heur;
        threshold = h[start];
        path.push(start);
        while (true) {
            double next = dfs(start, 0.0);
            if (next == -1) return threshold;          // found; threshold == C*
            if (next == Double.POSITIVE_INFINITY) return next; // exhausted
            threshold = next;
        }
    }

    // -1 sentinel = goal found; otherwise smallest f exceeding the threshold.
    static double dfs(int node, double g) {
        double f = g + h[node];
        if (f > threshold) return f;
        if (node == goal) return -1;
        double localMin = Double.POSITIVE_INFINITY;
        for (Edge e : adj[node]) {
            if (path.contains(e.to())) continue;       // no repeats on stack
            path.push(e.to());
            double t = dfs(e.to(), g + e.cost());
            if (t == -1) return -1;
            localMin = Math.min(localMin, t);
            path.pop();
        }
        return localMin;
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        List<Edge>[] adj = new List[]{
            List.of(new Edge(1, 1), new Edge(2, 4)),
            List.of(new Edge(3, 5)),
            List.of(new Edge(3, 1)),
            List.of()
        };
        double[] h = {2, 5, 1, 0};
        System.out.println(search(adj, 0, 3, h)); // 5.0
    }
}
```

#### Python

```python
import math


def ida_star(adj, start, goal, h):
    """Iterative-deepening A*. adj[u] = list of (v, cost). h must be admissible.
    Returns the optimal cost or math.inf. Uses O(depth) memory."""
    threshold = h[start]
    path = [start]

    def dfs(node, g):
        f = g + h[node]
        if f > threshold:
            return f                       # prune; candidate next threshold
        if node == goal:
            return -1                      # sentinel: found
        local_min = math.inf
        for nxt, cost in adj[node]:
            if nxt in path:
                continue                   # avoid cycles on the DFS stack
            path.append(nxt)
            t = dfs(nxt, g + cost)
            if t == -1:
                return -1
            local_min = min(local_min, t)
            path.pop()
        return local_min

    while True:
        nxt = dfs(start, 0)
        if nxt == -1:
            return threshold               # threshold == C* at success
        if nxt is math.inf:
            return math.inf                # exhausted
        threshold = nxt


if __name__ == "__main__":
    adj = {0: [(1, 1), (2, 4)], 1: [(3, 5)], 2: [(3, 1)], 3: []}
    h = {0: 2, 1: 5, 2: 1, 3: 0}
    print(ida_star(adj, 0, 3, h))          # 5  (0->2->3)
```

### 7.2 Weighted A* with explicit suboptimality bound

The key property to enforce in code: with `f = g + w·h`, the returned cost is `≤ w·C*`. The implementation below also *reports* the bound so a caller can decide whether the path is acceptable.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
	"math"
)

type wItem struct {
	node int
	f    float64
}
type wpq []wItem

func (h wpq) Len() int            { return len(h) }
func (h wpq) Less(i, j int) bool  { return h[i].f < h[j].f }
func (h wpq) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *wpq) Push(x any)         { *h = append(*h, x.(wItem)) }
func (h *wpq) Pop() any           { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

type WEdge struct {
	to   int
	cost float64
}

// WeightedAStar with w >= 1. Returned cost <= w * optimal.
func WeightedAStar(adj [][]WEdge, start, goal int, w float64, h func(int) float64) float64 {
	g := map[int]float64{start: 0}
	open := &wpq{{start, w * h(start)}}
	for open.Len() > 0 {
		cur := heap.Pop(open).(wItem)
		if cur.node == goal {
			return g[goal]
		}
		if cur.f > g[cur.node]+w*h(cur.node) {
			continue // stale
		}
		for _, e := range adj[cur.node] {
			t := g[cur.node] + e.cost
			best, ok := g[e.to]
			if !ok {
				best = math.Inf(1)
			}
			if t < best {
				g[e.to] = t
				heap.Push(open, wItem{e.to, t + w*h(e.to)})
			}
		}
	}
	return math.Inf(1)
}

func main() {
	adj := [][]WEdge{{{1, 1}, {2, 4}}, {{3, 5}}, {{3, 1}}, {}}
	h := func(n int) float64 { return []float64{2, 5, 1, 0}[n] }
	fmt.Println(WeightedAStar(adj, 0, 3, 1.0, h)) // 5 optimal
	fmt.Println(WeightedAStar(adj, 0, 3, 2.0, h)) // <= 10, often the same path
}
```

#### Java

```java
import java.util.*;

public class WeightedAStarBounded {
    record Edge(int to, double cost) {}

    public static double search(List<Edge>[] adj, int start, int goal,
                                double w, double[] h) {
        Map<Integer, Double> g = new HashMap<>();
        g.put(start, 0.0);
        PriorityQueue<double[]> open =
            new PriorityQueue<>(Comparator.comparingDouble(a -> a[0]));
        open.add(new double[]{w * h[start], start});
        while (!open.isEmpty()) {
            double[] cur = open.poll();
            int u = (int) cur[1];
            if (u == goal) return g.get(u);             // cost <= w * C*
            if (cur[0] > g.get(u) + w * h[u]) continue; // stale
            for (Edge e : adj[u]) {
                double t = g.get(u) + e.cost();
                if (t < g.getOrDefault(e.to(), Double.POSITIVE_INFINITY)) {
                    g.put(e.to(), t);
                    open.add(new double[]{t + w * h[e.to()], e.to()});
                }
            }
        }
        return Double.POSITIVE_INFINITY;
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        List<Edge>[] adj = new List[]{
            List.of(new Edge(1, 1), new Edge(2, 4)),
            List.of(new Edge(3, 5)), List.of(new Edge(3, 1)), List.of()
        };
        double[] h = {2, 5, 1, 0};
        System.out.println(search(adj, 0, 3, 1.0, h)); // 5.0
        System.out.println(search(adj, 0, 3, 2.0, h)); // <= 10.0
    }
}
```

#### Python

```python
import heapq
import math
import itertools


def weighted_a_star(adj, start, goal, w=1.0, h=None):
    """f = g + w*h. With w >= 1 the returned cost is <= w * optimal."""
    g = {start: 0.0}
    counter = itertools.count()
    open_set = [(w * h[start], next(counter), start)]
    while open_set:
        f, _, u = heapq.heappop(open_set)
        if u == goal:
            return g[u]                 # bounded: cost <= w * C*
        if f > g[u] + w * h[u]:
            continue                    # stale entry
        for v, cost in adj[u]:
            t = g[u] + cost
            if t < g.get(v, math.inf):
                g[v] = t
                heapq.heappush(open_set, (t + w * h[v], next(counter), v))
    return math.inf


if __name__ == "__main__":
    adj = {0: [(1, 1), (2, 4)], 1: [(3, 5)], 2: [(3, 1)], 3: []}
    h = {0: 2, 1: 5, 2: 1, 3: 0}
    print(weighted_a_star(adj, 0, 3, 1.0, h))  # 5 optimal
    print(weighted_a_star(adj, 0, 3, 2.0, h))  # <= 10
```

### 7.3 Consistency checker

Before trusting the "closed is final, never reopen" optimization (Corollary 2.2), verify the heuristic is consistent: `h(u) ≤ c(u,v) + h(v)` for every edge, and `h(goal) = 0`. This is an `O(E)` scan and belongs in your test suite.

#### Go

```go
package main

import "fmt"

type CEdge struct {
	to   int
	cost float64
}

// CheckConsistency returns the first violating edge, or ok=true if consistent.
func CheckConsistency(adj [][]CEdge, goals map[int]bool, h func(int) float64) (u, v int, ok bool) {
	for g := range goals {
		if h(g) != 0 {
			return g, g, false // h(goal) must be 0
		}
	}
	for u := range adj {
		for _, e := range adj[u] {
			if h(u) > e.cost+h(e.to)+1e-9 { // tolerance for float noise
				return u, e.to, false
			}
		}
	}
	return 0, 0, true
}

func main() {
	adj := [][]CEdge{{{1, 1}}, {{2, 1}}, {}}
	goals := map[int]bool{2: true}
	consistent := func(n int) float64 { return []float64{2, 1, 0}[n] }
	inconsistent := func(n int) float64 { return []float64{2, 0, 0}[n] } // h(0)>c+h(1)
	fmt.Println(CheckConsistency(adj, goals, consistent))   // 0 0 true
	fmt.Println(CheckConsistency(adj, goals, inconsistent)) // 0 1 false
}
```

#### Java

```java
import java.util.*;

public class ConsistencyChecker {
    record Edge(int to, double cost) {}

    // Returns null if consistent; otherwise the offending [u, v].
    public static int[] check(List<Edge>[] adj, Set<Integer> goals, double[] h) {
        for (int g : goals)
            if (h[g] != 0) return new int[]{g, g};       // h(goal) must be 0
        for (int u = 0; u < adj.length; u++)
            for (Edge e : adj[u])
                if (h[u] > e.cost() + h[e.to()] + 1e-9)  // triangle inequality
                    return new int[]{u, e.to()};
        return null;
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        List<Edge>[] adj = new List[]{
            List.of(new Edge(1, 1)), List.of(new Edge(2, 1)), List.of()
        };
        Set<Integer> goals = Set.of(2);
        System.out.println(Arrays.toString(check(adj, goals, new double[]{2, 1, 0}))); // null
        System.out.println(Arrays.toString(check(adj, goals, new double[]{2, 0, 0}))); // [0, 1]
    }
}
```

#### Python

```python
def check_consistency(adj, goals, h, tol=1e-9):
    """Return None if h is consistent, else the first offending (u, v) edge.
    Consistency: h(u) <= c(u,v) + h(v) for every edge, and h(goal) == 0."""
    for g in goals:
        if h[g] != 0:
            return (g, g)                      # h(goal) must be 0
    for u in adj:
        for v, cost in adj[u]:
            if h[u] > cost + h[v] + tol:       # triangle-inequality violation
                return (u, v)
    return None


if __name__ == "__main__":
    adj = {0: [(1, 1)], 1: [(2, 1)], 2: []}
    goals = {2}
    print(check_consistency(adj, goals, {0: 2, 1: 1, 2: 0}))  # None (consistent)
    print(check_consistency(adj, goals, {0: 2, 1: 0, 2: 0}))  # (0, 1) violation
```

**Why this matters in practice:** if the checker passes, you may keep a CLOSED set and skip closed nodes unconditionally — the most impactful constant-factor optimization in A*. If it fails, you must either (a) reopen improved closed nodes, (b) switch to the lazy push-and-skip variant, or (c) apply a consistency-restoring transform such as **pathmax** / BPMX (`h(child) := max(h(child), h(parent) − c)`), which raises child estimates to recover monotonicity without breaking admissibility.

---

## 8. Cache Behavior

A*'s memory access pattern is dominated by two structures: the priority queue (OPEN) and the hash maps (`g`, parent, CLOSED).

- **OPEN as a binary heap** suffers the same `Θ(log(n/B))` cache misses per operation as any array heap (block size `B`); see `professional.md` of `01-binary-heap` in `10-heaps`. Bucket-based OPEN (when `f`-values are small integers) gives `O(1)` operations and far better locality, which is why integer-cost grid A* often uses **bucket queues** or **radix heaps** instead of binary heaps.
- **The hash maps** are the real cache villains: random-access lookups of `g`/CLOSED scatter across memory. Replacing per-node hash maps with **dense 2-D arrays** on grids (one slot per cell) removes hashing and gives sequential, cache-friendly access — a 2–5× constant-factor win that swamps any asymptotic concern at practical sizes.
- **Node objects vs. structs of arrays:** pointer-rich node objects pollute cache and stress the GC. Struct-of-arrays layouts (parallel arrays for `g`, `f`, parent indexed by cell id) keep hot fields contiguous.

---

## 9. Average-Case and Phase Transitions

### 7.1 Random graphs and grids

On random grids with obstacle density `p`, A* exhibits a **phase transition**: below a percolation threshold the goal is almost always reachable and a good heuristic keeps expansions near-linear in path length; near the threshold, long detours around large obstacle clusters force expansions toward `O(map)`. The hardest instances cluster at the connectivity threshold — the classic constraint-satisfaction "easy–hard–easy" pattern.

### 7.2 Expected expansions under heuristic noise

Modeling the heuristic as `h(n) = h*(n) − X(n)` with `X(n)` a non-negative error, the expected number of expanded nodes grows with the variance and magnitude of `X`. If `X` is bounded by a constant, expected work is polynomial; if `X` scales with `h*`, work is exponential in expectation (consistent with §4.3). This formalizes the intuition that *systematically* optimistic heuristics (large constant gap to `h*`) are far worse than *tight* ones.

### 7.3 Pearl's analysis

Pearl (*Heuristics*, 1984) gives the canonical average-case treatment: under a uniform tree model with independent heuristic errors, the expected A* run time is exponential unless the typical error is `O(log h*)`. This is the theoretical justification for investing in strong, low-error heuristics (pattern databases, ALT) rather than merely admissible ones.

---

## 10. Space–Time Trade-offs

| Variant | Time | Space | Optimality | Lever traded |
|---|---|---|---|---|
| A* | `O(b^d)` | `O(b^d)` | Optimal (admissible) | — |
| IDA* | `O(b^d)` (× re-expansion overhead) | `O(d)` | Optimal (admissible) | space → recomputation |
| RBFS | `O(b^d)` (subtree regeneration) | `O(d)` | Optimal | space → regeneration |
| SMA* | `O(b^d)` up to memory bound | bounded by available memory | Optimal within bound | graceful memory degradation |
| Weighted A* (`w`) | `≤ A*` expansions | `≤ A*` | `w·C*` | optimality → speed/memory |
| Bidirectional A* | `~2·b^{d/2}` | two frontiers | Optimal (careful meet) | code complexity → exploration |
| HPA*/CH | preprocessing + tiny query | precomputed index | near-/optimal | offline space/time → query speed |

The fundamental tension: A* must remember the frontier to guarantee optimal efficiency; space-bounded variants forget parts of it and pay by regenerating them. There is no free lunch — `Ω(b^d)` total work is unavoidable in the worst case for any admissible algorithm with this heuristic (Theorem 3.1).

---

## 11. Comparison with Alternatives

| Algorithm | Frontier key | Optimal | Memory | Notes |
|---|---|---|---|---|
| BFS | insertion order | unit costs only | `O(b^d)` | `h` ignored. |
| Uniform-cost / Dijkstra | `g` | yes | `O(V)` | A* with `h ≡ 0`. |
| Greedy best-first | `h` | no | `O(V)` | A* with `g ≡ 0`. |
| A* | `g + h` | yes (admissible) | `O(b^d)` | optimally efficient (§3). |
| Weighted A* | `g + w·h` | `w·C*` | `≤ A*` | bounded suboptimal. |
| IDA* | DFS, `f`-threshold | yes | `O(d)` | space-optimal. |
| RBFS | recursive best-first | yes | `O(d)` | fewer re-expansions than IDA* on real costs. |
| Bidirectional A* | two `g+h` frontiers | yes (with care) | `O(b^{d/2})` two sides | `~`√ speedup. |
| Fringe search | sorted by `f` band | yes | `O(b^d)` | cache-friendlier A* variant. |

The defining facts: A* is the *unique* point in this table that is both **optimal** and **optimally efficient with respect to its heuristic**. Every other entry sacrifices one of: heuristic use (BFS/Dijkstra), optimality (greedy/weighted), or frontier memory (IDA*/RBFS/SMA*).

---

## 12. Open Problems and Research Directions

1. **Tight reopening bounds for inconsistent admissible heuristics.** Martelli's exponential re-expansion example is worst-case; characterizing realistic heuristics where reopening is benign (and designing cheap consistency-restoring transforms like BPMX) remains active.

2. **Provably good parallel A*.** HDA* scales empirically, but worst-case work-efficiency vs. communication trade-offs and tight speedup bounds in realistic memory models are not fully settled.

3. **Optimal abstraction selection.** For HPA*/pattern databases, automatically choosing abstractions that maximize heuristic accuracy per unit of preprocessing memory is an optimization problem with no general solution.

4. **Heuristics with provably sub-exponential expansions on structured domains.** Beyond ALT and disjoint pattern DBs, characterizing graph classes admitting polynomial A* with constructible heuristics is open.

5. **Learning admissible heuristics.** Neural-network heuristics are typically *not* admissible; combining learned guidance with admissibility guarantees (e.g., via lower-bounding corrections or focal search with a separate admissible bound) is a fast-moving area.

6. **Cache-oblivious priority queues for search.** Whether a single OPEN structure can simultaneously match radix-heap constants on integer costs and cache-oblivious bounds on real costs, with decrease-key, is open (mirrors the heap open problems in `10-heaps`).

7. **Anytime and real-time bounds.** Tight trade-off curves between deliberation time and solution quality for ARA*/RTA*-style algorithms under hard real-time constraints remain partly characterized.

---

## 13. Summary

- **Definition.** A* expands nodes by `f = g + h`; with `h ≡ 0` it is Dijkstra, with `g ≡ 0` it is greedy best-first.
- **Optimality.** An **admissible** heuristic (`h ≤ h*`) makes A* return an optimal path (HNR 1968); a **consistent** heuristic additionally makes `f` non-decreasing along expanded paths, so each node is optimal at first expansion and **never reopened** (Corollary 2.2).
- **Optimal efficiency.** Dechter–Pearl (1985): no admissible algorithm using the same `h` expands fewer nodes than A* — it must expand every node with `f* < C*`.
- **Complexity.** Worst case `O(b^d)` time and space; the **effective branching factor** `b*` measures heuristic quality, and only heuristics with `O(log h*)` absolute error yield sub-exponential search.
- **Space-bounded.** IDA* (`O(d)` space), RBFS, and SMA* trade memory for re-expansion; weighted A* trades optimality (`w·C*`) for speed.
- **Cache.** Bucket/radix OPEN and dense array node stores beat binary heaps + hash maps by large constant factors on integer-cost grids.
- **Average case.** Expected work is exponential unless heuristic error stays `O(log h*)` (Pearl 1984); random grids show an easy–hard–easy phase transition near the connectivity threshold.

Hart, Nilsson & Raphael (1968) introduced A* and proved admissibility ⇒ optimality; Dechter & Pearl (1985) proved optimal efficiency; Korf (1985) gave IDA*; Russell (1992) gave SMA*; Korf & Felner (2002) built additive pattern databases; Pearl's *Heuristics* (1984) remains the canonical analytical reference. A* is over fifty years old, fits in forty lines, and remains the optimal informed-search algorithm in its model class.
