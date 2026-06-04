# Branch and Bound (B&B) for Optimization — Interview Preparation

Branch and bound is a favourite interview topic because it tests whether you truly understand the difference between *feasibility* (backtracking) and *optimization* (B&B), whether you can design an **admissible bound** from a relaxation, whether you can reason about *pruning* and the *incumbent*, and whether you know when to reach for B&B versus DP, greedy, or an off-the-shelf solver. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges — 0/1 knapsack B&B, TSP B&B, the assignment problem, and a job-scheduling B&B — each with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Concept | Rule |
|---------|------|
| What B&B is for | Optimization (max/min) with provably optimal answers |
| Branch | Partition into subproblems (take/skip item; include/exclude edge) |
| Bound (max) | Admissible **upper** bound from a relaxation |
| Bound (min) | Admissible **lower** bound from a relaxation |
| Prune (max) | `bound ≤ incumbent` → discard subtree |
| Prune (min) | `bound ≥ incumbent` → discard subtree |
| Incumbent | Best complete feasible solution so far |
| Knapsack bound | Fractional knapsack (sort by value/weight, fill, fraction of last) |
| TSP bound | Reduced-cost matrix / 1-tree / nearest-neighbor incumbent |
| Assignment bound | Row-min (or Hungarian) reduction |
| Search strategy | DFS (O(n) memory) vs best-first (fewest nodes, big memory) |
| Worst case | Exponential — same class as brute force if bound never prunes |
| Equals A* | Best-first B&B = A* on the solution tree; admissible bound = admissible heuristic |

Core algorithm (minimization, best-first):

```text
bnb(root):
    frontier = priority queue ordered by bound, push root
    best = +inf
    while frontier not empty:
        s = pop smallest-bound node
        if s.bound >= best: continue          # fathom by bound
        if s.complete: best = min(best, s.obj); continue
        for child in s.children():
            if child.bound < best: push child
    return best
```

---

## Junior Questions (12 Q&A)

### J1. What is the difference between backtracking and branch and bound?
Backtracking explores a decision tree and abandons a branch only when a **constraint is violated** (infeasible) — it answers feasibility/enumeration ("is there a valid solution?"). Branch and bound is for **optimization** ("what is the best solution?") and adds a second pruning reason: a feasible branch is abandoned when its **optimistic bound cannot beat the best solution found so far**.

### J2. What are the four ingredients of B&B?
**Branch** (partition into subproblems), **Bound** (optimistic estimate of the subtree's best objective), **Incumbent** (best complete solution so far), and **Prune** (discard a subtree whose bound cannot beat the incumbent).

### J3. What is the incumbent?
The best complete, feasible solution discovered so far. Its objective value is the threshold every prune test compares against; it only improves over time.

### J4. For a maximization problem, is the bound an upper or lower bound?
An **upper** bound — an optimistic over-estimate of the best value achievable in the subtree. For minimization it is a **lower** bound.

### J5. When does B&B prune for a maximization problem?
When `bound(node) ≤ incumbent`: even the most optimistic outcome of this subtree cannot beat what we already have, so we discard it.

### J6. What bound do we use for the 0/1 knapsack?
The **fractional (greedy) bound**: sort remaining items by value/weight ratio, greedily pack whole items, then add a fraction of the next item that overflows. The fractional optimum is always ≥ the 0/1 optimum, so it is a valid upper bound.

### J7. Why must we sort items by value/weight ratio?
So the fractional bound is **tight**. The fractional relaxation is optimal when items are taken in decreasing ratio order; without sorting the bound is loose and prunes almost nothing.

### J8. What is a "relaxation"?
An easier version of the problem made by dropping or loosening a constraint (e.g., allowing fractional items). Its optimum is the bound, and because the easy problem can only do better, the bound is admissible.

### J9. Does B&B always find the optimum?
Yes — provided the bound is **admissible** (never worse than the true subtree optimum). It explores or safely prunes every part of the tree, so the returned answer is provably optimal.

### J10. Is B&B faster than brute force in the worst case?
No. The worst-case complexity is the same (exponential) if the bound prunes nothing. B&B wins on typical inputs, not adversarial ones.

### J11. What's the memory cost of depth-first B&B?
`O(n)` — just the recursion stack (the current path of decisions).

### J12. What happens if you forget the bound test entirely?
B&B degenerates into plain backtracking / brute-force enumeration — correct, but with no speedup.

---

## Middle Questions (10 Q&A)

### M1. Compare depth-first, best-first, and least-cost search.
**Depth-first** recurses fully down one branch; `O(n)` memory; finds a leaf (and thus an incumbent) quickly. **Best-first** keeps a priority queue ordered by bound and expands the most promising node; fewest node expansions to reach the optimum but `O(live nodes)` memory (can explode). **Least-cost** is the minimization name for best-first (expand smallest lower bound).

### M2. Name three TSP lower bounds, weakest to strongest.
(1) Sum of each city's cheapest outgoing edge; (2) the reduced-cost matrix bound (row then column reduction — Little's algorithm); (3) the 1-tree / Held–Karp Lagrangian bound. Nearest-neighbor gives an *upper* bound (incumbent), not a lower bound.

### M3. How is the assignment problem related to TSP B&B?
The assignment problem (minimize cost of a perfect worker→job matching) is solvable in polynomial time (Hungarian, `O(n³)`). TSP is "assignment + must form a single cycle," so the assignment optimum is a strong **lower bound** for TSP; B&B branches to forbid the subtours the assignment relaxation produces.

### M4. How do you count walks... wait — how do you seed a good incumbent?
Run a fast heuristic first: greedy fractional-rounded for knapsack, nearest-neighbor for TSP. Starting the incumbent from a real solution (instead of `±∞`) makes pruning bite from the very first node.

### M5. Why update the incumbent at every node, not just at leaves?
Every node is a complete-so-far feasible partial solution; updating the incumbent eagerly keeps it as tight as possible, which strengthens the prune test and removes more of the tree.

### M6. When should you use DP instead of B&B for knapsack?
When capacity `W` is small: DP is `O(nW)`, exact, and simpler. Use B&B when `W` is huge (DP table too big) but `n` is modest and the fractional bound prunes well.

### M7. What is the bound-tightness vs bound-cost trade-off?
Total work ≈ `nodes × cost_per_node`. A tighter bound reduces nodes but costs more per node. The best bound minimizes the product, not either factor — sometimes a cheaper, looser bound wins overall.

### M8. Why is best-first prone to memory blow-up?
It stores every live (unexpanded) node in the priority queue; the frontier can be exponentially large, so memory — not time — becomes the limit.

### M9. How do you handle a "stale" node popped from a best-first queue?
Re-check the prune test after popping: the incumbent may have improved since the node was pushed, so skip it if `bound ≤ best` (max) — this is lazy deletion.

### M10. Maximization vs minimization — what flips?
The bound direction (upper vs lower), the prune comparison (`≤` vs `≥`), the heap order, and the incumbent initialization (`−∞` vs `+∞`). The skeleton is identical.

---

## Senior Questions (8 Q&A)

### S1. Prove that B&B never discards the optimum.
If a node is pruned by bound, then `bound(node) ≤ incumbent` (max). By admissibility, every solution `x` in that subtree has `value(x) ≤ bound(node) ≤ incumbent`. Since the incumbent only improves, no `x` in the pruned subtree beats the final answer. The optimum therefore lies in an explored region. (Full proof in `professional.md`.)

### S2. In what sense is B&B equal to A*?
Best-first B&B on a solution tree *is* A*: the path cost so far plays the role of `g(n)`, the relaxation bound on remaining decisions plays `h(n)`, and the node priority `g+h` is the bound on a complete solution. An admissible bound is exactly an admissible heuristic; a tighter admissible bound expands no more nodes (the A* dominance theorem).

### S3. What is the LP relaxation and the integrality gap?
The LP relaxation drops integrality (`x ∈ {0,1}` → `x ∈ [0,1]`); its optimum bounds the integer optimum. The integrality gap (`z_LP / z_IP`) measures the slack. Gap = 1 (e.g., totally-unimodular matrices like assignment) means no branching needed; a large gap predicts heavy branching, mitigated by cutting planes (branch-and-cut).

### S4. How do you make B&B an anytime algorithm?
At any moment the incumbent is a valid solution and the best frontier bound limits the optimum, giving a provable gap `|bound − incumbent|`. Stop on a time limit, a gap tolerance (`MIPGap`), or a node limit, and report the gap so the caller knows the quality.

### S5. What are the pitfalls of parallel B&B?
Need an atomic, globally-shared incumbent broadcast on improvement; uneven subtree sizes demand work stealing; and speedup anomalies occur (super-linear when a worker finds a great incumbent early, sub-linear when workers do speculative work a serial incumbent would have pruned). Determinism requires tie-breaking.

### S6. When would you NOT hand-roll B&B?
For any mixed-integer-linear model, use a mature MILP solver (CBC, HiGHS, Gurobi) doing branch-and-cut on the LP relaxation. Hand-roll only for specialized structure with a much tighter custom bound (e.g., 1-tree for TSP) or tiny embedded contexts.

### S7. What is the single most dangerous B&B bug?
A **non-admissible bound** — one that sometimes under-estimates (max) the true subtree optimum. It silently prunes the optimum and returns a *plausible wrong* answer. Always test admissibility against a brute-force oracle.

### S8. How do you contain best-first memory without losing optimality?
Default to DFS (`O(depth)`); for best-first use depth-first-branch-and-bound with a cost threshold (IDA*-style), store compact node descriptors and recompute state, and lazily drop frontier nodes dominated by the incumbent. Hard caps (beam search) lose optimality and must be documented.

---

## Behavioral Prompts

- *"Describe a time you optimized a brute-force search."* Frame it as identifying a bound: what was the optimistic estimate, how did you prove it admissible, and how much did pruning cut the search?
- *"How do you decide between an exact and an approximate algorithm?"* Discuss the exactness-vs-latency trade-off, anytime B&B with a gap guarantee, and when a greedy heuristic suffices.
- *"Tell me about a performance bug under load."* A best-first frontier OOM is a great story: symptom, root cause (exponential live set), fix (DFS fallback + memory cap).
- *"How do you test a tricky algorithm?"* Brute-force oracle, admissibility assertions, property-based testing, adversarial regression corpus.
- *"When did you choose a library over building it yourself?"* Modeling a problem as MILP and calling a solver instead of hand-rolling branch-and-cut.

---

## Coding Challenge 1 — 0/1 Knapsack via Branch and Bound

**Problem.** Given `n` items with value and weight and capacity `W`, return the maximum total value of a subset with total weight `≤ W`. Use B&B with the fractional bound.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type Item struct{ value, weight int }

func bound(items []Item, idx, val, wt, W int) float64 {
	if wt >= W {
		return float64(val)
	}
	b, tot := float64(val), wt
	for i := idx; i < len(items); i++ {
		if tot+items[i].weight <= W {
			tot += items[i].weight
			b += float64(items[i].value)
		} else {
			b += float64(W-tot) * float64(items[i].value) / float64(items[i].weight)
			break
		}
	}
	return b
}

func knapsack(items []Item, W int) int {
	sort.Slice(items, func(a, b int) bool {
		return items[a].value*items[b].weight > items[b].value*items[a].weight
	})
	best := 0
	var dfs func(idx, val, wt int)
	dfs = func(idx, val, wt int) {
		if val > best {
			best = val
		}
		if idx == len(items) || bound(items, idx, val, wt, W) <= float64(best) {
			return
		}
		if wt+items[idx].weight <= W {
			dfs(idx+1, val+items[idx].value, wt+items[idx].weight)
		}
		dfs(idx+1, val, wt)
	}
	dfs(0, 0, 0)
	return best
}

func main() {
	items := []Item{{60, 10}, {100, 20}, {120, 30}}
	fmt.Println(knapsack(items, 50)) // 220
}
```

#### Java

```java
import java.util.*;

public class KnapsackBnB {
    record Item(int value, int weight) {}
    static int best;

    static double bound(Item[] it, int idx, int val, int wt, int W) {
        if (wt >= W) return val;
        double b = val; int tot = wt;
        for (int i = idx; i < it.length; i++) {
            if (tot + it[i].weight() <= W) { tot += it[i].weight(); b += it[i].value(); }
            else { b += (double)(W - tot) * it[i].value() / it[i].weight(); break; }
        }
        return b;
    }

    static void dfs(Item[] it, int idx, int val, int wt, int W) {
        if (val > best) best = val;
        if (idx == it.length || bound(it, idx, val, wt, W) <= best) return;
        if (wt + it[idx].weight() <= W)
            dfs(it, idx + 1, val + it[idx].value(), wt + it[idx].weight(), W);
        dfs(it, idx + 1, val, wt, W);
    }

    public static void main(String[] args) {
        Item[] it = { new Item(60,10), new Item(100,20), new Item(120,30) };
        Arrays.sort(it, (a,b) -> Double.compare(
            (double)b.value()/b.weight(), (double)a.value()/a.weight()));
        best = 0; dfs(it, 0, 0, 0, 50);
        System.out.println(best); // 220
    }
}
```

#### Python

```python
def knapsack(items, W):
    items.sort(key=lambda it: it[0] / it[1], reverse=True)
    best = 0

    def bound(idx, val, wt):
        if wt >= W:
            return float(val)
        b, tot = float(val), wt
        for i in range(idx, len(items)):
            v, w = items[i]
            if tot + w <= W:
                tot += w; b += v
            else:
                b += (W - tot) * v / w; break
        return b

    def dfs(idx, val, wt):
        nonlocal best
        if val > best:
            best = val
        if idx == len(items) or bound(idx, val, wt) <= best:
            return
        v, w = items[idx]
        if wt + w <= W:
            dfs(idx + 1, val + v, wt + w)
        dfs(idx + 1, val, wt)

    dfs(0, 0, 0)
    return best


if __name__ == "__main__":
    print(knapsack([(60, 10), (100, 20), (120, 30)], 50))  # 220
```

---

## Coding Challenge 2 — TSP via Branch and Bound

**Problem.** Given an `n × n` cost matrix, find the minimum-cost Hamiltonian cycle starting and ending at city 0. Use a simple lower bound = current cost + sum of cheapest remaining out-edges.

#### Go

```go
package main

import "fmt"

func tsp(cost [][]int) int {
	n := len(cost)
	visited := make([]bool, n)
	visited[0] = true
	best := 1 << 30
	// cheapest out-edge of each city, for the lower bound
	minOut := make([]int, n)
	for i := 0; i < n; i++ {
		m := 1 << 30
		for j := 0; j < n; j++ {
			if i != j && cost[i][j] < m {
				m = cost[i][j]
			}
		}
		minOut[i] = m
	}
	var dfs func(city, count, soFar, bound int)
	dfs = func(city, count, soFar, bound int) {
		if soFar+bound >= best { // prune by lower bound
			return
		}
		if count == n {
			if soFar+cost[city][0] < best {
				best = soFar + cost[city][0]
			}
			return
		}
		for next := 0; next < n; next++ {
			if !visited[next] {
				visited[next] = true
				dfs(next, count+1, soFar+cost[city][next], bound-minOut[city])
				visited[next] = false
			}
		}
	}
	total := 0
	for i := 0; i < n; i++ {
		total += minOut[i]
	}
	dfs(0, 1, 0, total)
	return best
}

func main() {
	cost := [][]int{
		{0, 10, 15, 20}, {10, 0, 35, 25}, {15, 35, 0, 30}, {20, 25, 30, 0},
	}
	fmt.Println(tsp(cost)) // 80
}
```

#### Java

```java
public class TspBnB {
    static int n, best;
    static int[][] cost; static int[] minOut; static boolean[] visited;

    static void dfs(int city, int count, int soFar, int bound) {
        if (soFar + bound >= best) return;          // prune
        if (count == n) { best = Math.min(best, soFar + cost[city][0]); return; }
        for (int nx = 0; nx < n; nx++) {
            if (!visited[nx]) {
                visited[nx] = true;
                dfs(nx, count + 1, soFar + cost[city][nx], bound - minOut[city]);
                visited[nx] = false;
            }
        }
    }

    public static void main(String[] args) {
        cost = new int[][]{ {0,10,15,20}, {10,0,35,25}, {15,35,0,30}, {20,25,30,0} };
        n = cost.length; best = Integer.MAX_VALUE;
        minOut = new int[n]; visited = new boolean[n]; visited[0] = true;
        int total = 0;
        for (int i = 0; i < n; i++) {
            int m = Integer.MAX_VALUE;
            for (int j = 0; j < n; j++) if (i != j) m = Math.min(m, cost[i][j]);
            minOut[i] = m; total += m;
        }
        dfs(0, 1, 0, total);
        System.out.println(best); // 80
    }
}
```

#### Python

```python
def tsp(cost):
    n = len(cost)
    visited = [False] * n
    visited[0] = True
    best = [float("inf")]
    min_out = [min(cost[i][j] for j in range(n) if i != j) for i in range(n)]

    def dfs(city, count, so_far, bound):
        if so_far + bound >= best[0]:           # prune by lower bound
            return
        if count == n:
            best[0] = min(best[0], so_far + cost[city][0])
            return
        for nx in range(n):
            if not visited[nx]:
                visited[nx] = True
                dfs(nx, count + 1, so_far + cost[city][nx], bound - min_out[city])
                visited[nx] = False

    dfs(0, 1, 0, sum(min_out))
    return best[0]


if __name__ == "__main__":
    cost = [[0, 10, 15, 20], [10, 0, 35, 25], [15, 35, 0, 30], [20, 25, 30, 0]]
    print(tsp(cost))  # 80
```

---

## Coding Challenge 3 — Assignment Problem via Branch and Bound

**Problem.** Given an `n × n` cost matrix, assign each worker to exactly one distinct job minimizing total cost. Lower bound = cost so far + sum of row minima of unassigned workers.

#### Go

```go
package main

import "fmt"

func assign(cost [][]int) int {
	n := len(cost)
	used := make([]bool, n)
	best := 1 << 30
	var dfs func(worker, soFar int)
	dfs = func(worker, soFar int) {
		if soFar >= best {
			return
		}
		if worker == n {
			best = soFar
			return
		}
		// lower bound: add row minima of remaining workers over free jobs
		lb := soFar
		for w := worker; w < n; w++ {
			m := 1 << 30
			for j := 0; j < n; j++ {
				if !used[j] && cost[w][j] < m {
					m = cost[w][j]
				}
			}
			lb += m
		}
		if lb >= best {
			return // prune
		}
		for j := 0; j < n; j++ {
			if !used[j] {
				used[j] = true
				dfs(worker+1, soFar+cost[worker][j])
				used[j] = false
			}
		}
	}
	dfs(0, 0)
	return best
}

func main() {
	cost := [][]int{{9, 2, 7}, {6, 4, 3}, {5, 8, 1}}
	fmt.Println(assign(cost)) // 10  (2 + 3 + 5)
}
```

#### Java

```java
public class AssignmentBnB {
    static int n, best; static int[][] cost; static boolean[] used;

    static void dfs(int worker, int soFar) {
        if (soFar >= best) return;
        if (worker == n) { best = soFar; return; }
        int lb = soFar;
        for (int w = worker; w < n; w++) {
            int m = Integer.MAX_VALUE;
            for (int j = 0; j < n; j++) if (!used[j]) m = Math.min(m, cost[w][j]);
            lb += m;
        }
        if (lb >= best) return;                     // prune
        for (int j = 0; j < n; j++) {
            if (!used[j]) {
                used[j] = true;
                dfs(worker + 1, soFar + cost[worker][j]);
                used[j] = false;
            }
        }
    }

    public static void main(String[] args) {
        cost = new int[][]{ {9,2,7}, {6,4,3}, {5,8,1} };
        n = cost.length; best = Integer.MAX_VALUE; used = new boolean[n];
        dfs(0, 0);
        System.out.println(best); // 10
    }
}
```

#### Python

```python
def assign(cost):
    n = len(cost)
    used = [False] * n
    best = [float("inf")]

    def dfs(worker, so_far):
        if so_far >= best[0]:
            return
        if worker == n:
            best[0] = so_far
            return
        lb = so_far
        for w in range(worker, n):
            lb += min(cost[w][j] for j in range(n) if not used[j])
        if lb >= best[0]:                          # prune
            return
        for j in range(n):
            if not used[j]:
                used[j] = True
                dfs(worker + 1, so_far + cost[worker][j])
                used[j] = False

    dfs(0, 0)
    return best[0]


if __name__ == "__main__":
    print(assign([[9, 2, 7], [6, 4, 3], [5, 8, 1]]))  # 10
```

---

## Coding Challenge 4 — Job Scheduling (Minimize Makespan) via Branch and Bound

**Problem.** Assign `n` jobs (each with a processing time) to `m` identical machines to minimize the **makespan** (the finish time of the busiest machine). Lower bound = `max(current max load, ceil(total_remaining / m + ...))`; here we use a simple bound = current maximum machine load.

#### Go

```go
package main

import "fmt"

func makespan(jobs []int, m int) int {
	load := make([]int, m)
	best := 1 << 30
	maxOf := func(a []int) int {
		mx := 0
		for _, v := range a {
			if v > mx {
				mx = v
			}
		}
		return mx
	}
	var dfs func(j int)
	dfs = func(j int) {
		if maxOf(load) >= best { // lower bound prune: current max can only grow
			return
		}
		if j == len(jobs) {
			if mk := maxOf(load); mk < best {
				best = mk
			}
			return
		}
		seen := map[int]bool{}
		for i := 0; i < m; i++ {
			if seen[load[i]] { // symmetry break: identical loads are equivalent
				continue
			}
			seen[load[i]] = true
			load[i] += jobs[j]
			dfs(j + 1)
			load[i] -= jobs[j]
		}
	}
	dfs(0)
	return best
}

func main() {
	fmt.Println(makespan([]int{4, 3, 2, 2, 1}, 2)) // 6
}
```

#### Java

```java
import java.util.*;

public class ScheduleBnB {
    static int[] jobs, load; static int m, best;

    static int maxOf() { int mx = 0; for (int v : load) mx = Math.max(mx, v); return mx; }

    static void dfs(int j) {
        if (maxOf() >= best) return;                // lower bound prune
        if (j == jobs.length) { best = Math.min(best, maxOf()); return; }
        Set<Integer> seen = new HashSet<>();
        for (int i = 0; i < m; i++) {
            if (!seen.add(load[i])) continue;       // symmetry break
            load[i] += jobs[j];
            dfs(j + 1);
            load[i] -= jobs[j];
        }
    }

    public static void main(String[] args) {
        jobs = new int[]{4, 3, 2, 2, 1}; m = 2;
        load = new int[m]; best = Integer.MAX_VALUE;
        dfs(0);
        System.out.println(best); // 6
    }
}
```

#### Python

```python
def makespan(jobs, m):
    load = [0] * m
    best = [float("inf")]

    def dfs(j):
        if max(load) >= best[0]:                   # lower bound prune
            return
        if j == len(jobs):
            best[0] = min(best[0], max(load))
            return
        seen = set()
        for i in range(m):
            if load[i] in seen:                    # symmetry break
                continue
            seen.add(load[i])
            load[i] += jobs[j]
            dfs(j + 1)
            load[i] -= jobs[j]

    dfs(0)
    return best[0]


if __name__ == "__main__":
    print(makespan([4, 3, 2, 2, 1], 2))  # 6
```

---

## Final Tips

- Always state your **bound** and argue it is **admissible** before coding — interviewers care more about the bound than the recursion.
- Mention **seeding the incumbent** with a greedy/heuristic solution; it shows production awareness.
- Know the **DFS vs best-first** trade-off and the best-first **memory** caveat.
- Be ready to say "this is a MILP — I'd model it and call a solver" when the problem is large.
- Drop the line "best-first B&B is A* on the solution tree" — it signals depth.
- Verify on a brute-force oracle; never claim optimality without checking admissibility.
