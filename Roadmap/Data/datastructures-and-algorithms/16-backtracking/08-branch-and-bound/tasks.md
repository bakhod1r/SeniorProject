# Branch and Bound (B&B) for Optimization — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the branch / bound / prune logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle on small inputs before trusting the B&B result, and verify the returned solution is feasible and its value matches the reported optimum.**

---

## Beginner Tasks (5)

### Task 1 — Fractional knapsack bound

**Problem.** Implement `bound(items, idx, value, weight, W)` that returns the **fractional-knapsack upper bound** for the subtree at item `idx`: take whole remaining items in the given order while they fit, then add a fraction of the first item that overflows.

**Input / Output spec.**
- `items` is a list of `(value, weight)` already sorted by value/weight descending.
- Return a float — the optimistic upper bound on the best 0/1 value reachable.

**Constraints.**
- `1 ≤ n ≤ 1000`, `1 ≤ value, weight ≤ 10^6`, `0 ≤ W ≤ 10^9`.

**Hint.** Stop and take a fraction the moment an item does not fit; the fraction is `(W − tot_weight) / item.weight`.

**Starter — Go.**
```go
package main

import "fmt"

type Item struct{ value, weight int }

func bound(items []Item, idx, value, weight, W int) float64 {
	// TODO: greedily fill whole items, then add the fractional last item
	return 0
}

func main() {
	items := []Item{{60, 10}, {100, 20}, {120, 30}}
	fmt.Println(bound(items, 0, 0, 0, 50)) // 240.0
}
```

**Starter — Java.**
```java
public class Task1 {
    record Item(int value, int weight) {}
    static double bound(Item[] items, int idx, int value, int weight, int W) {
        // TODO
        return 0;
    }
    public static void main(String[] args) {
        Item[] items = { new Item(60,10), new Item(100,20), new Item(120,30) };
        System.out.println(bound(items, 0, 0, 0, 50)); // 240.0
    }
}
```

**Starter — Python.**
```python
def bound(items, idx, value, weight, W):
    # TODO: greedily fill whole items, then the fractional last item
    return 0.0


if __name__ == "__main__":
    print(bound([(60, 10), (100, 20), (120, 30)], 0, 0, 0, 50))  # 240.0
```

**Evaluation.** Returns `240.0` for the example; equals the true 0/1 optimum when all items fit; never below the 0/1 optimum.

---

### Task 2 — 0/1 knapsack DFS branch and bound

**Problem.** Using your `bound`, implement DFS B&B that returns the maximum value subset with weight `≤ W`. Sort items by ratio first; prune when `bound ≤ best`.

**Input / Output spec.**
- Read `n`, `W`, then `n` lines of `value weight`. Print the optimal value.

**Constraints.** `1 ≤ n ≤ 40`, `0 ≤ W ≤ 10^9`, values/weights up to `10^6`.

**Hint.** Branch take (guard `weight + w ≤ W`) then skip; update `best` at every node.

**Starter — Python.**
```python
def knapsack(items, W):
    items.sort(key=lambda it: it[0] / it[1], reverse=True)
    best = 0
    # TODO: bound() + dfs()
    return best


if __name__ == "__main__":
    print(knapsack([(60, 10), (100, 20), (120, 30)], 50))  # 220
```

**Starter — Go.**
```go
package main

import (
	"fmt"
	"sort"
)

type Item struct{ value, weight int }

func knapsack(items []Item, W int) int {
	sort.Slice(items, func(a, b int) bool {
		return items[a].value*items[b].weight > items[b].value*items[a].weight
	})
	best := 0
	// TODO: bound + dfs
	return best
}

func main() {
	fmt.Println(knapsack([]Item{{60, 10}, {100, 20}, {120, 30}}, 50)) // 220
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task2 {
    record Item(int value, int weight) {}
    static int knapsack(Item[] items, int W) {
        Arrays.sort(items, (a,b) -> Double.compare(
            (double)b.value()/b.weight(), (double)a.value()/a.weight()));
        // TODO
        return 0;
    }
    public static void main(String[] args) {
        System.out.println(knapsack(new Item[]{
            new Item(60,10), new Item(100,20), new Item(120,30)}, 50)); // 220
    }
}
```

**Evaluation.** Matches a brute-force `2^n` oracle on all random instances with `n ≤ 20`.

---

### Task 3 — Brute-force oracle

**Problem.** Implement `knapsack_bruteforce(items, W)` that tries all `2^n` subsets and returns the best feasible value. This is your correctness oracle for Task 2.

**Constraints.** `1 ≤ n ≤ 22`.

**Hint.** Iterate `mask` from `0` to `2^n − 1`; accumulate value/weight by set bits.

**Starter — Python.**
```python
def knapsack_bruteforce(items, W):
    # TODO: enumerate all subsets
    return 0
```

**Evaluation.** Returns the same value as Task 2 on 1000 random small instances.

---

### Task 4 — Min vs max pruning direction

**Problem.** Write a single function `should_prune(bound, incumbent, maximize)` returning `True` when the node can be fathomed: for maximization prune when `bound ≤ incumbent`; for minimization prune when `bound ≥ incumbent`.

**Constraints.** Pure function, no I/O.

**Hint.** One `if maximize` branch; use `<=` / `>=` (equal bounds cannot improve a single optimum).

**Starter — Go.**
```go
package main

import "fmt"

func shouldPrune(bound, incumbent float64, maximize bool) bool {
	// TODO
	return false
}

func main() {
	fmt.Println(shouldPrune(22, 22, true))  // true
	fmt.Println(shouldPrune(18, 22, false)) // false
}
```

**Evaluation.** `(22,22,true)→true`, `(23,22,true)→false`, `(22,22,false)→true`, `(18,22,false)→false`.

---

### Task 5 — Seed the incumbent with greedy

**Problem.** Before the search, compute a greedy feasible value (take whole items by ratio until one does not fit) and use it as the initial `best`. Show that node count drops versus starting from `best = 0`.

**Constraints.** `1 ≤ n ≤ 40`.

**Hint.** Greedy gives a real lower bound on the optimum, so pruning bites immediately.

**Starter — Python.**
```python
def greedy_seed(items, W):
    # items sorted by ratio desc; return greedy whole-item value
    # TODO
    return 0
```

**Evaluation.** Seeded B&B returns the same optimum as unseeded but visits no more nodes (usually fewer); print a node counter to confirm.

---

## Intermediate Tasks (5)

### Task 6 — Best-first knapsack B&B

**Problem.** Reimplement knapsack B&B using a **priority queue** of live nodes ordered by bound (highest first). Re-check the prune test after popping (lazy deletion).

**Input / Output spec.** Same as Task 2.

**Constraints.** `1 ≤ n ≤ 40`. Track and print the number of nodes expanded.

**Hint.** Push children only if `child.bound > best`; on pop, skip if `bound ≤ best`.

**Starter — Python.**
```python
import heapq


def knapsack_best_first(items, W):
    items.sort(key=lambda it: it[0] / it[1], reverse=True)
    # TODO: heap of (-bound, level, value, weight)
    return 0
```

**Evaluation.** Same optimum as Task 2; report node counts for both to compare strategies.

---

### Task 7 — TSP lower bound (cheapest out-edges)

**Problem.** Implement `tsp_bound(cost, visited, current, soFar)` returning a lower bound = `soFar + Σ cheapest out-edge of each unvisited city + cheapest edge back into the tour`. Simpler accepted version: `soFar + Σ_{unvisited} min outgoing edge`.

**Constraints.** `2 ≤ n ≤ 12`, symmetric or asymmetric costs, `0 ≤ cost ≤ 10^6`.

**Hint.** Precompute each city's minimum outgoing edge once.

**Starter — Go.**
```go
package main

import "fmt"

func tspBound(cost [][]int, visited []bool, soFar int) int {
	// TODO: soFar + sum of cheapest out-edges of unvisited cities
	return 0
}

func main() {
	cost := [][]int{{0,10,15},{10,0,20},{15,20,0}}
	visited := []bool{true, false, false}
	fmt.Println(tspBound(cost, visited, 0))
}
```

**Evaluation.** The bound is always `≤` the true optimal tour cost (admissible) on random instances `n ≤ 8`.

---

### Task 8 — TSP branch and bound

**Problem.** Find the minimum Hamiltonian cycle from city 0 using DFS B&B with your Task 7 bound. Print the optimal cost.

**Input / Output spec.** Read `n`, then the `n × n` cost matrix. Print the optimal tour cost.

**Constraints.** `2 ≤ n ≤ 12`.

**Hint.** Prune when `soFar + lowerBound ≥ best`; close the tour back to 0 at depth `n`.

**Starter — Python.**
```python
def tsp(cost):
    n = len(cost)
    # TODO: DFS B&B with admissible lower bound
    return 0


if __name__ == "__main__":
    cost = [[0,10,15,20],[10,0,35,25],[15,35,0,30],[20,25,30,0]]
    print(tsp(cost))  # 80
```

**Evaluation.** Matches a brute-force `(n−1)!` permutation oracle for `n ≤ 9`.

---

### Task 9 — Assignment problem B&B

**Problem.** Minimize the total cost of assigning `n` workers to `n` distinct jobs. Lower bound = cost so far + sum of row minima of unassigned workers over free jobs.

**Input / Output spec.** Read `n`, then the `n × n` cost matrix. Print the minimum total cost.

**Constraints.** `1 ≤ n ≤ 12`, `0 ≤ cost ≤ 10^6`.

**Hint.** Branch by assigning worker `k` to each free job; mark jobs used/free.

**Starter — Java.**
```java
public class Task9 {
    static int n, best; static int[][] cost; static boolean[] used;
    static void dfs(int worker, int soFar) {
        // TODO: lower-bound prune + branch over free jobs
    }
    public static void main(String[] args) {
        cost = new int[][]{ {9,2,7}, {6,4,3}, {5,8,1} };
        n = cost.length; best = Integer.MAX_VALUE; used = new boolean[n];
        dfs(0, 0);
        System.out.println(best); // 10
    }
}
```

**Evaluation.** Matches the Hungarian-algorithm optimum (or `n!` brute force) for `n ≤ 8`.

---

### Task 10 — Job scheduling makespan B&B

**Problem.** Assign `n` jobs (processing times) to `m` identical machines to minimize the makespan. Use a lower bound of `max(current max load, ceil(total / m))` and symmetry-break by skipping machines with a load already tried at this depth.

**Input / Output spec.** Read `n`, `m`, then `n` processing times. Print the minimum makespan.

**Constraints.** `1 ≤ n ≤ 16`, `1 ≤ m ≤ 4`.

**Hint.** Sorting jobs descending and assigning the biggest first improves pruning a lot.

**Starter — Python.**
```python
def makespan(jobs, m):
    jobs.sort(reverse=True)         # biggest first -> stronger bound
    load = [0] * m
    best = [float("inf")]
    # TODO: dfs with lower-bound prune + symmetry break
    return best[0]


if __name__ == "__main__":
    print(makespan([4, 3, 2, 2, 1], 2))  # 6
```

**Evaluation.** Matches a brute-force `m^n` oracle for `n ≤ 10`.

---

## Advanced Tasks (5)

### Task 11 — Anytime knapsack with time limit and gap

**Problem.** Add a wall-clock deadline (checked every 1024 nodes) to your knapsack B&B. On timeout, return the incumbent and a provable optimality gap `(root_bound − best) / best`.

**Constraints.** `n` up to 60; time budget in milliseconds.

**Hint.** Compute the root bound once before searching; it is a valid upper bound on the optimum throughout.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"time"
)

type Item struct{ value, weight int }

func solve(items []Item, W int, budget time.Duration) (int, float64) {
	// TODO: DFS B&B, bail at deadline, return (best, gap)
	return 0, 0
}

func main() {
	items := []Item{{60, 10}, {100, 20}, {120, 30}}
	best, gap := solve(items, 50, 10*time.Millisecond)
	fmt.Printf("best=%d gap<=%.2f%%\n", best, gap*100)
}
```

**Evaluation.** Given enough time, gap reaches 0 and the answer equals the exact optimum; on a tight budget the gap is a true upper bound on the relative error.

---

### Task 12 — Reduced-cost matrix bound for TSP

**Problem.** Implement the Little et al. reduced-cost lower bound: subtract each row's minimum, then each column's minimum; the sum subtracted is a lower bound on any tour. Plug it into your TSP B&B and compare node counts against the cheapest-out-edge bound.

**Constraints.** `2 ≤ n ≤ 12`.

**Hint.** Use `+inf` on the diagonal and on forbidden edges before reducing.

**Starter — Python.**
```python
def reduced_cost_bound(cost):
    n = len(cost)
    m = [row[:] for row in cost]
    total = 0
    # TODO: row reduction then column reduction; return total subtracted
    return total
```

**Evaluation.** The reduced-cost bound is admissible (≤ optimal tour) and expands no more nodes than the cheapest-out-edge bound; usually far fewer.

---

### Task 13 — Parallel knapsack B&B

**Problem.** Parallelize knapsack B&B: split at a shallow depth into independent subtrees handled by worker goroutines/threads, sharing an atomic incumbent. Show speedup and that the result is unchanged.

**Constraints.** `n` up to 45; use the platform's concurrency primitives.

**Hint.** Use an atomic max for the shared incumbent; broadcast improvements so workers prune more.

**Starter — Go.**
```go
package main

import (
	"sync"
	"sync/atomic"
)

func parallelKnapsack(items []Item, W int, splitDepth int) int {
	var best int64
	var wg sync.WaitGroup
	_ = atomic.LoadInt64(&best)
	// TODO: enumerate prefixes to splitDepth, launch a worker per prefix,
	//       each DFS uses atomic best for pruning
	wg.Wait()
	return int(atomic.LoadInt64(&best))
}

type Item struct{ value, weight int }
```

**Evaluation.** Same optimum as the serial version; measurable speedup on multi-core; no data races (run with the race detector).

---

### Task 14 — Branch-ordering heuristic

**Problem.** For knapsack B&B, experiment with branch order: (a) take-first, (b) skip-first, (c) take-first only when the item's ratio exceeds the average remaining ratio. Report node counts for each on random instances.

**Constraints.** `n` up to 40; average over 100 random instances.

**Hint.** Branch order changes *when* a strong incumbent is found, which changes how much later branches are pruned.

**Starter — Python.**
```python
def knapsack_ordered(items, W, order="take_first"):
    items.sort(key=lambda it: it[0] / it[1], reverse=True)
    best = 0
    nodes = 0
    # TODO: dfs that branches according to `order`, counting nodes
    return best, nodes
```

**Evaluation.** All orders return the same optimum; report which order minimizes node count on average (take-first is usually best for ratio-sorted items).

---

### Task 15 — Integer programming via LP-relaxation B&B (binary knapsack)

**Problem.** Treat 0/1 knapsack as a binary integer program. At each node solve the LP relaxation (here: the fractional bound, whose solution has at most one fractional variable), and **branch on that fractional variable** (`x_j = 0` vs `x_j = 1`) instead of by item index. Prune by the LP bound.

**Input / Output spec.** Read `n`, `W`, then `value weight` lines. Print the optimum.

**Constraints.** `1 ≤ n ≤ 40`.

**Hint.** The fractional knapsack LP optimum is integral except for the single "break" item; branch on that item.

**Starter — Python.**
```python
def lp_relaxation(items, fixed, W):
    """Return (bound, fractional_item_index or None) given fixed = {idx: 0/1}."""
    # TODO: greedy over free items; identify the fractional break item
    return 0.0, None


def knapsack_ip(items, W):
    items.sort(key=lambda it: it[0] / it[1], reverse=True)
    best = [0]
    # TODO: branch on the fractional variable from lp_relaxation
    return best[0]
```

**Evaluation.** Matches the optimum from Tasks 2 and 3; on instances where item-index branching is slow, variable branching should expand comparable or fewer nodes. Explain the integrality-gap intuition in a comment.

---

## Debugging Guide

When a task fails, work through these in order — most B&B bugs fall into one of them:

| Symptom | Likely cause | Check |
|---------|-------------|-------|
| Optimum too small (max) | Bound under-estimates → real optimum pruned | Assert `bound(node) ≥ true_subtree_optimum` against brute force on tiny inputs. |
| Runs as slow as brute force | Bound never prunes | Did you sort by ratio? Is the incumbent seeded? Print pruned-count. |
| Returns an infeasible solution | "take" branch not guarded | Guard with `weight + w ≤ W`; verify the returned set independently. |
| Wrong answer on min problems | Copied max logic | Min uses a *lower* bound and prunes when `bound ≥ best`. |
| TSP result is not a tour | Subtours allowed | Forbid revisiting; close back to start only at depth `n`. |
| Stack overflow | Missing base case / no pruning on deep input | Confirm `idx == n` return; confirm pruning fires. |
| Off-by-one in value | Counted an item twice or skipped branch | Branch *both* take and skip exactly once per level. |

A reliable workflow: (1) write the brute-force oracle first, (2) write B&B, (3) fuzz with 1000 random small instances comparing the two, (4) only then scale up.

---

## Stretch Goals

If you finish the 15 tasks, try these open-ended extensions to deepen mastery:

- **Bounded knapsack / multiple-choice knapsack.** Items come in groups; pick exactly one per group. Adapt the fractional bound to respect group structure.
- **Bi-criteria knapsack.** Maximize value while minimizing weight; maintain a Pareto frontier of incumbents and prune by dominance.
- **TSP with the 1-tree bound.** Replace the cheapest-out-edge bound with a minimum-1-tree bound and measure the node-count reduction on `n = 12` instances.
- **Best-first vs DFS memory study.** Instrument both strategies; plot peak frontier size vs `n` and confirm best-first's exponential memory growth.
- **Parallel TSP B&B.** Extend Task 13's pattern to TSP with an atomic shared incumbent and work stealing; measure speedup and watch for anomalies.
- **MILP modeling.** Express Task 9 (assignment) and Task 10 (scheduling) as integer programs and solve with an off-the-shelf solver (PuLP / OR-Tools); compare runtime against your hand-rolled B&B.

Each stretch goal maps to a concept from `senior.md` (memory, parallelism, solver integration) or `professional.md` (LP relaxation, integrality gap, Lagrangian 1-tree bound).

---

## Submission Checklist

- [ ] Each task solved in **Go, Java, and Python**.
- [ ] B&B result validated against a **brute-force oracle** on small inputs.
- [ ] Returned solution verified **feasible**; its value equals the reported optimum.
- [ ] Bound proven **admissible** (max: upper bound; min: lower bound).
- [ ] Node counts reported where the task asks (strategy/ordering comparisons).
- [ ] Min vs max pruning direction correct (`≤` for max, `≥` for min).
- [ ] Anytime/limit tasks honor the budget and report a true optimality gap.
