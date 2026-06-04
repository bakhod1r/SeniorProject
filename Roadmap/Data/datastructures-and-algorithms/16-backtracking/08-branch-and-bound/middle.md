# Branch and Bound (B&B) for Optimization — Middle Level

> **Focus:** Designing *bounding functions* (the fractional-knapsack bound, TSP reduced-cost / nearest-neighbor / 1-tree bounds), choosing a *search strategy* (best-first priority queue vs depth-first vs least-cost), managing the *incumbent*, and knowing exactly when B&B beats pure backtracking and dynamic programming.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Bounding Functions in Depth](#bounding-functions-in-depth)
4. [Search Strategies](#search-strategies)
5. [Incumbent Management](#incumbent-management)
6. [Comparison with Alternatives](#comparison-with-alternatives)
7. [Classic Applications](#classic-applications)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was the four moving parts: **branch**, **bound**, **incumbent**, **prune**. At middle level the engineering questions begin:

- The bound *is* the algorithm. How do you design one that is **tight** (prunes a lot) yet **cheap** (does not dominate runtime)? Where do bounds come from — and why is a *relaxation* always the right mental model?
- The fractional-knapsack bound is the textbook example. What are the standard bounds for **TSP** (reduced-cost matrix, nearest-neighbor, 1-tree) and the **assignment problem**?
- Which **search strategy** — depth-first, best-first, or least-cost — should you pick, and what does each cost in memory?
- How do you manage the **incumbent** so pruning starts early and stays strong?
- When is plain backtracking enough, when does B&B win, and when should you abandon both for **dynamic programming**?

These decisions separate "I can code knapsack B&B" from "I can attack an unfamiliar optimization problem with B&B and reason about its cost."

---

## Deeper Concepts

### Bounds come from relaxations

Every useful bound is the optimum of an **easier problem** — a *relaxation* — obtained by dropping or loosening a constraint:

| Original (hard) | Relaxation (easy) | Bound it yields |
|-----------------|-------------------|-----------------|
| 0/1 knapsack (whole items) | Fractional knapsack (allow fractions) | Greedy fractional value (upper bound) |
| TSP (one tour through all cities) | Allow any edges out of each city | Sum of cheapest edges / reduced-cost matrix (lower bound) |
| TSP | Minimum 1-tree (spanning tree + 1 edge) | Held–Karp 1-tree bound (lower bound) |
| Integer program (ILP) | Linear program (drop integrality) | LP-relaxation optimum (see professional.md) |

The relaxation's optimum is **always at least as good** as the true optimum (better in the easy world), so it is an **admissible** optimistic bound. For **maximization** the relaxation gives an **upper** bound; for **minimization** (TSP, assignment) it gives a **lower** bound.

### Admissibility (the safety rule, restated)

A bound is **admissible** if it never *cuts off* the true optimum:

```
maximization:  bound(node) >= (true best objective in the subtree)
minimization:  bound(node) <= (true best objective in the subtree)
```

Prune only when the bound proves the subtree is hopeless: for max, `bound ≤ incumbent`; for min, `bound ≥ incumbent`. If the bound is **not** admissible, B&B may return a wrong answer — this is the cardinal sin. (The correctness proof is in [`professional.md`](./professional.md).)

---

## Bounding Functions in Depth

### Fractional knapsack bound (maximization)

Sort remaining items by value/weight ratio descending; greedily pack whole items until one overflows, then add a **fraction** of that item. The result `≥` the 0/1 optimum because allowing fractions can only help.

```
bound = value_taken
      + sum of whole remaining items that fit (in ratio order)
      + (leftover_capacity / next_item.weight) * next_item.value
```

A cheaper-but-looser alternative: `value_taken + leftover_capacity * best_remaining_ratio`. Tighter still: combine with a DP-based bound when `W` is small.

### TSP lower bounds (minimization)

TSP asks for the cheapest tour visiting every city once. Several admissible **lower** bounds exist, in increasing order of tightness and cost:

1. **Cheapest-out-edge bound.** Every city must have one outgoing edge in the tour, so a lower bound is `Σ_city (cheapest edge leaving that city)`. Trivial to compute, fairly loose.

2. **Reduced-cost matrix (row/column reduction).** Subtract each row's minimum from that row, then each column's minimum from that column. The total subtracted is a **lower bound** on any tour (every tour must pick one entry per row and per column, each `≥ 0` after reduction). This is the classic **Little et al.** B&B bound; branching fixes "include edge (i,j)" or "exclude edge (i,j)" and re-reduces.

3. **Nearest-neighbor / greedy tour.** Not a lower bound — it gives a fast **incumbent** (an *upper* bound on the optimum) to seed pruning.

4. **1-tree bound (Held–Karp).** A *1-tree* is a spanning tree on vertices `{1..n-1}` plus two edges touching vertex 0. Its weight is a lower bound on the optimal tour (a tour *is* a special 1-tree). Strengthened with Lagrangian node-weight adjustments, the 1-tree bound is one of the tightest practical TSP bounds.

### Assignment problem bound

Assign `n` workers to `n` jobs minimizing total cost. The assignment problem itself is polynomial (Hungarian algorithm, `O(n³)`), so its optimum is a strong **lower bound** for problems that *add* extra constraints on top (e.g., TSP = assignment + "must form a single cycle"). B&B for TSP often uses the assignment relaxation as its bound and branches to forbid subtours.

---

## Search Strategies

The set of unexpanded nodes is the **live set** (or *frontier*). The strategy is *which live node to expand next*.

| Strategy | Data structure | Memory | Strength |
|----------|----------------|--------|----------|
| **Depth-First B&B** | recursion stack | **O(depth) = O(n)** | Tiny memory; finds *a* leaf fast → early incumbent. |
| **Best-First B&B** | priority queue keyed by bound | **O(live nodes)** (can explode) | Expands the most promising node → fewest expansions to reach optimum. |
| **Least-Cost** | priority queue (min bound) | same as best-first | The minimization name for best-first. |
| **Breadth-First** | FIFO queue | huge | Rarely used; no pruning advantage. |

**Depth-first** is the memory-safe default and what you implement first. **Best-first** expands the live node with the best bound, so in theory it reaches the optimum with the *minimum* number of node expansions for a given bound — but the priority queue can hold an exponential number of live nodes, causing memory blow-up (see [`senior.md`](./senior.md)). A common hybrid is **depth-first with a best-first flavor**: at each node, recurse into the child with the better bound first.

---

## Incumbent Management

The **incumbent** is the best complete feasible solution found so far; its value drives every prune. To make pruning bite early:

- **Seed it with a heuristic.** For TSP, run nearest-neighbor first; for knapsack, run the greedy. Starting from a real solution instead of `−∞`/`+∞` prunes from the very first node.
- **Update it eagerly.** Whenever a node represents a complete feasible solution better than the incumbent, replace it immediately.
- **Order branches to find good solutions first.** Explore the most promising child first (knapsack: "take" the high-ratio item; TSP: extend to the nearest city). A strong early incumbent shrinks the rest of the tree.
- **Track the optimality gap.** `gap = (incumbent − best_bound_in_frontier)`. When the gap is 0, the incumbent is provably optimal and you can stop. A small nonzero gap supports *early termination* (senior level).

---

## Comparison with Alternatives

### B&B vs pure backtracking

```
backtracking: prune only when a constraint is violated (infeasible)
B&B:          prune on infeasibility AND on bound (cannot beat incumbent)
```

For **enumeration / feasibility** (N-Queens, Sudoku, "does any valid solution exist?") plain backtracking is the right tool — there is no objective to bound. For **optimization** ("best valid solution"), B&B's bound test is what makes it tractable. B&B is *strictly* a superset: remove the bound test and you are left with backtracking.

### B&B vs dynamic programming

| | Branch and Bound | Dynamic Programming |
|--|------------------|---------------------|
| Knapsack when `W` is small | Works, but DP is simpler | `O(nW)` exact — **prefer DP** |
| Knapsack when `W` is huge but `n` small | **B&B wins** (DP table too big) | `O(nW)` infeasible |
| TSP | B&B (exact, small n) | Held–Karp DP `O(2^n · n²)` (n ≲ 20) |
| Guarantees | Exact optimum, exponential worst case | Exact optimum, pseudo-polynomial / exponential |
| Memory | `O(n)` (DFS) | `O(nW)` or `O(2^n · n)` table |

Rule of thumb: if a *polynomial or pseudo-polynomial* DP fits in memory, use it. Use B&B when the DP state space is too large but a good bound lets you prune the exponential tree.

### B&B vs greedy / approximation

Greedy gives a fast, *possibly suboptimal* answer; B&B gives the *provable* optimum at higher cost. They combine beautifully: run greedy first to seed the incumbent, then let B&B prove optimality (or improve it).

---

## Classic Applications

| Problem | Branch on | Bound (relaxation) | Objective |
|---------|-----------|--------------------|-----------|
| **0/1 knapsack** | take / skip next item | fractional knapsack (upper) | maximize value |
| **TSP** | include / exclude an edge, or extend to next city | reduced-cost matrix / 1-tree (lower) | minimize tour cost |
| **Assignment** | fix worker→job, or forbid a cell | Hungarian / row-min reduction (lower) | minimize cost |
| **Job scheduling** | assign next job to a machine / position | sum of remaining min processing + idle (lower) | minimize makespan / lateness |
| **Integer programming** | branch on a fractional variable | LP relaxation (bound) | min/max linear objective |

---

## Code Examples

### Example 1: Best-First Knapsack B&B with a Priority Queue

Best-first expands the live node with the **highest bound** first. Each node stores its level, value, weight, and bound.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
	"sort"
)

type Item struct{ value, weight int }

type Node struct {
	level, value, weight int
	bound                float64
}

type PQ []*Node

func (p PQ) Len() int            { return len(p) }
func (p PQ) Less(i, j int) bool  { return p[i].bound > p[j].bound } // max-bound first
func (p PQ) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *PQ) Push(x any)         { *p = append(*p, x.(*Node)) }
func (p *PQ) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func bound(items []Item, n Node, W int) float64 {
	if n.weight >= W {
		return 0
	}
	b := float64(n.value)
	totW := n.weight
	for i := n.level; i < len(items); i++ {
		if totW+items[i].weight <= W {
			totW += items[i].weight
			b += float64(items[i].value)
		} else {
			b += float64(W-totW) * float64(items[i].value) / float64(items[i].weight)
			break
		}
	}
	return b
}

func knapsack(items []Item, W int) int {
	sort.Slice(items, func(a, b int) bool {
		return items[a].value*items[b].weight > items[b].value*items[a].weight
	})
	pq := &PQ{}
	heap.Init(pq)
	root := &Node{level: 0, value: 0, weight: 0}
	root.bound = bound(items, *root, W)
	heap.Push(pq, root)
	best := 0
	for pq.Len() > 0 {
		u := heap.Pop(pq).(*Node)
		if u.bound <= float64(best) {
			continue // stale node, cannot beat incumbent
		}
		if u.level == len(items) {
			continue
		}
		// child: take
		take := &Node{level: u.level + 1, value: u.value + items[u.level].value,
			weight: u.weight + items[u.level].weight}
		if take.weight <= W {
			if take.value > best {
				best = take.value
			}
			take.bound = bound(items, *take, W)
			if take.bound > float64(best) {
				heap.Push(pq, take)
			}
		}
		// child: skip
		skip := &Node{level: u.level + 1, value: u.value, weight: u.weight}
		skip.bound = bound(items, *skip, W)
		if skip.bound > float64(best) {
			heap.Push(pq, skip)
		}
	}
	return best
}

func main() {
	items := []Item{{10, 2}, {10, 4}, {12, 6}, {18, 9}}
	fmt.Println("optimal value =", knapsack(items, 10)) // 22
}
```

#### Java

```java
import java.util.*;

public class KnapsackBestFirst {
    record Item(int value, int weight) {}
    static class Node {
        int level, value, weight; double bound;
        Node(int l, int v, int w) { level = l; value = v; weight = w; }
    }

    static double bound(Item[] items, Node n, int W) {
        if (n.weight >= W) return 0;
        double b = n.value; int totW = n.weight;
        for (int i = n.level; i < items.length; i++) {
            if (totW + items[i].weight() <= W) {
                totW += items[i].weight(); b += items[i].value();
            } else {
                b += (double)(W - totW) * items[i].value() / items[i].weight();
                break;
            }
        }
        return b;
    }

    static int knapsack(Item[] items, int W) {
        Arrays.sort(items, (a, b) -> Double.compare(
            (double) b.value() / b.weight(), (double) a.value() / a.weight()));
        PriorityQueue<Node> pq = new PriorityQueue<>((a, b) -> Double.compare(b.bound, a.bound));
        Node root = new Node(0, 0, 0);
        root.bound = bound(items, root, W);
        pq.add(root);
        int best = 0;
        while (!pq.isEmpty()) {
            Node u = pq.poll();
            if (u.bound <= best || u.level == items.length) continue;
            Node take = new Node(u.level + 1, u.value + items[u.level].value(),
                                 u.weight + items[u.level].weight());
            if (take.weight <= W) {
                best = Math.max(best, take.value);
                take.bound = bound(items, take, W);
                if (take.bound > best) pq.add(take);
            }
            Node skip = new Node(u.level + 1, u.value, u.weight);
            skip.bound = bound(items, skip, W);
            if (skip.bound > best) pq.add(skip);
        }
        return best;
    }

    public static void main(String[] args) {
        Item[] items = { new Item(10, 2), new Item(10, 4),
                         new Item(12, 6), new Item(18, 9) };
        System.out.println("optimal value = " + knapsack(items, 10)); // 22
    }
}
```

#### Python

```python
import heapq


def bound(items, level, value, weight, W):
    if weight >= W:
        return 0.0
    b = float(value)
    tot_w = weight
    for i in range(level, len(items)):
        v, w = items[i]
        if tot_w + w <= W:
            tot_w += w
            b += v
        else:
            b += (W - tot_w) * v / w
            break
    return b


def knapsack(items, W):
    items.sort(key=lambda it: it[0] / it[1], reverse=True)
    # heap of (-bound, level, value, weight); negate for max-heap
    root_b = bound(items, 0, 0, 0, W)
    pq = [(-root_b, 0, 0, 0)]
    best = 0
    while pq:
        nb, level, value, weight = heapq.heappop(pq)
        if -nb <= best or level == len(items):
            continue
        v, w = items[level]
        # take
        if weight + w <= W:
            best = max(best, value + v)
            tb = bound(items, level + 1, value + v, weight + w, W)
            if tb > best:
                heapq.heappush(pq, (-tb, level + 1, value + v, weight + w))
        # skip
        sb = bound(items, level + 1, value, weight, W)
        if sb > best:
            heapq.heappush(pq, (-sb, level + 1, value, weight))
    return best


if __name__ == "__main__":
    items = [(10, 2), (10, 4), (12, 6), (18, 9)]
    print("optimal value =", knapsack(items, 10))  # 22
```

**What it does:** maintains a priority queue of live nodes ordered by bound, always expanding the most promising node, and pushes children only if their bound can still beat the incumbent.
**Run:** `go run main.go` | `javac KnapsackBestFirst.java && java KnapsackBestFirst` | `python knapsack_bf.py`

### Example 2: Reduced-Cost Lower Bound for TSP (sketch)

The reduced-cost lower bound: reduce each row by its min, each column by its min; the sum of reductions is a lower bound on any tour.

#### Python

```python
def reduced_cost_bound(cost):
    n = len(cost)
    m = [row[:] for row in cost]
    total = 0
    for i in range(n):                      # row reduction
        r = min(x for x in m[i] if x != float("inf"))
        if r != float("inf") and r > 0:
            total += r
            m[i] = [x - r if x != float("inf") else x for x in m[i]]
    for j in range(n):                      # column reduction
        c = min(m[i][j] for i in range(n) if m[i][j] != float("inf"))
        if c != float("inf") and c > 0:
            total += c
            for i in range(n):
                if m[i][j] != float("inf"):
                    m[i][j] -= c
    return total                            # lower bound on the optimal tour
```

The Go and Java versions follow the same two-pass row/column reduction; see [`interview.md`](./interview.md) for a full TSP B&B with branching that includes/excludes edges and re-reduces.

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Wrong optimum returned | Non-admissible bound (under-estimates max / over-estimates min). | Derive the bound from a genuine relaxation. |
| Best-first runs out of memory | Priority queue holds exponentially many live nodes. | Cap the queue, switch to DFS, or strengthen the bound. |
| TSP returns a non-tour | Reduced-cost branching allowed subtours. | Forbid subtours when branching (Little's algorithm). |
| No pruning in TSP | Loose cheapest-edge bound; weak incumbent. | Seed with nearest-neighbor; use reduced-cost or 1-tree bound. |
| Stale heap nodes wrongly expanded | Node's bound now `≤` improved incumbent. | Re-check `bound ≤ best` after popping (lazy deletion). |
| Min/max sign confusion | Pruning test inverted for a min problem. | Min: prune when `bound ≥ best`; Max: when `bound ≤ best`. |

---

## Worked Example: Pruning in Action

To make the bound/incumbent interaction concrete, trace this instance with capacity `W = 8`:

```
item:    A     B     C     D
value:   8     7     6     5
weight:  2     2     3     3
ratio:  4.0   3.5   2.0  1.67     (already sorted descending)
```

- **Root bound.** Fill greedily: A (w2,v8,cap6), B (w2,v7,cap4), C (w3,v6,cap1), then a fraction of D = `1/3 · 5 ≈ 1.67`. Root bound ≈ `8+7+6+1.67 = 22.67`. Incumbent `best = 0`.
- **Take A, take B, take C** (value 21, weight 7, cap 1). D needs 3, does not fit → skip D. Leaf value **21** → incumbent `best = 21`.
- **Take A, take B, skip C.** Remaining cap 4, free items {C, D}. Bound = `15 + 6 (C fits) + fraction of D (1/3·5≈1.67) = 22.67`? Recompute with cap after C: C (w3) fits (cap 4→1), then D fraction `1/3·5≈1.67`. Bound ≈ `15+6+1.67 = 22.67 > 21` → explore. But taking C here returns to the value-21 leaf already seen; the genuinely new leaf (skip C, skip D or take D) yields at most `15 + 5 = 20 < 21` → no improvement.
- **Take A, skip B.** Bound: value 8, cap 6, free {C, D}: C (w3,v6,cap3), D (w3,v5,cap0) = `8+6+5 = 19`. `19 ≤ best(21)` → **prune the entire skip-B subtree.**
- **Skip A.** Bound: free {B,C,D} into cap 8: B (w2,v7,cap6), C (w3,v6,cap3), D (w3,v5,cap0) = `18`. `18 ≤ best(21)` → **prune the whole skip-A half of the tree.**

Two large subtrees vanish the instant their optimistic bound failed to beat the incumbent 21 — which is the optimum (items A+B+C). This is exactly what the [`animation.html`](./animation.html) visualizes.

---

## Choosing and Combining Bounds

Real solvers rarely use a single bound. The middle-level skill is knowing how to combine and when to switch:

- **Cheap-then-expensive.** Apply an `O(1)` bound at every node (`value + remaining_cap · best_ratio`); only when it *fails* to prune, fall back to the `O(n)` fractional bound. The cheap bound prunes the easy cases for free.
- **Multiple admissible bounds, take the best.** If you have two admissible bounds `g₁` and `g₂`, then `max(g₁, g₂)` (for minimization lower bounds) is also admissible and at least as tight. TSP B&B often combines the reduced-cost bound with a 1-tree bound and uses the larger.
- **Bound + feasibility heuristic.** At each node, alongside the bound, run a quick rounding heuristic to *construct* a feasible solution; it may improve the incumbent and accelerate pruning everywhere.
- **Problem-specific dominance.** Beyond bounds, *dominance rules* discard a node if another node provably dominates it (same or better state with no worse future). In knapsack, a node with `≥` value and `≤` weight than another at the same level dominates it.

---

## Performance Analysis

- **Bound tightness vs cost.** Effective pruning ≈ how close the bound is to the true optimum. A tighter bound prunes more but costs more per node. The sweet spot minimizes `(nodes expanded) × (cost per bound)`, not either factor alone.
- **Search order.** Best-first minimizes node *expansions* but maximizes memory; DFS minimizes memory but may expand more nodes before finding a strong incumbent. Real solvers blend the two.
- **Incumbent quality.** A heuristic-seeded incumbent can cut total nodes by an order of magnitude versus starting from `±∞`.
- **Worst case is unavoidable.** Knapsack and TSP are NP-hard; for adversarial inputs (e.g., all ratios equal) the bound prunes nothing and B&B is `O(2^n)` / `O(n!)`. B&B is an *engineering* win on typical inputs, not a complexity-class breakthrough.

---

## State Representation and Memory

How you represent a node decides both correctness and memory cost:

- **DFS B&B carries state on the call stack** — current index, accumulated value, accumulated weight, and (for TSP/assignment) the visited/used set. Nothing else needs storing; memory is `O(depth)`. Prefer passing primitives and mutating-then-restoring shared arrays (the `used[j] = true; recurse; used[j] = false` idiom) over allocating a fresh state per node.
- **Best-first B&B must store each live node explicitly** in the priority queue. Keep node objects *small*: store the minimal descriptor (level, value, weight, bound) and recompute anything derivable. Storing the full item list or path in every node is the fast route to memory blow-up.
- **Reconstructing the solution.** If you need not just the optimal *value* but the optimal *choices*, store a parent pointer (best-first) or record the decision path (DFS) only for the incumbent — never for every node. A common pattern: keep a single `best_path` array, overwritten each time the incumbent improves.
- **Avoid recomputation.** Precompute prefix sums of value and weight so the fractional bound is `O(log n)`; cache per-city cheapest edges for TSP. These caches are computed once, not per node.

The guiding principle: DFS trades time for memory (recompute, tiny footprint); best-first trades memory for fewer expansions. Pick deliberately.

---

## Best Practices

- Always derive the bound from an explicit **relaxation** so admissibility is obvious and provable.
- **Seed the incumbent** with a fast heuristic before the search starts.
- Use **DFS B&B by default**; switch to best-first only when you can bound the memory.
- **Re-check the prune test after popping** from a best-first queue (the incumbent may have improved since the node was pushed — lazy deletion).
- Validate against a brute-force oracle on small random instances; verify the returned solution is *feasible* and its value matches the reported optimum.
- Keep branching, bounding, and incumbent logic in separate, individually testable functions.

---

## Branching Choices Beyond Take/Skip

For knapsack the binary take/skip branching is natural, but for other problems the *branching object* is a real design decision that changes the tree shape and pruning power:

- **TSP — branch on a city or on an edge.** *City branching* extends the current path to each unvisited city (one child per city; tree of width up to `n`). *Edge branching* (Little's algorithm) picks one edge `(i,j)` and creates exactly two children — "tour includes `(i,j)`" and "tour excludes `(i,j)`" — re-reducing the cost matrix in each. Edge branching keeps the tree binary and pairs naturally with the reduced-cost bound.
- **Assignment — branch on a cell.** Fix worker `i` to job `j` (one child per free job) or split into "include cell `(i,j)`" vs "forbid cell `(i,j)`". The Hungarian relaxation gives the bound for either.
- **Scheduling — branch on a job's placement.** Assign the next job to each machine (one child per machine), with symmetry breaking to avoid permuted-equivalent assignments of identical machines.
- **Integer programs — branch on a fractional variable.** Take the variable `x_j` fractional in the LP solution and branch `x_j ≤ ⌊v⌋` vs `x_j ≥ ⌈v⌉`. This is the universal MILP branching rule.

The rule of thumb: prefer **binary** branching (two children) when you have a bound that re-tightens cheaply in each child, because it keeps the tree balanced and the bound informative; use **wide** branching (one child per choice) when the bound is computed fresh per node and width is small.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The knapsack search tree expanding with each node's **bound** and the live **incumbent**
> - Best-first vs depth-first ordering of which node is expanded next
> - Subtrees **pruned** (crossed out) when `bound ≤ best`, and infeasible takes blocked
> - How a stronger incumbent tightens the prune test and accelerates the search

---

## Common Mistakes at This Level

1. **Loose bound from skipping the sort.** The fractional bound is only tight when remaining items are in value/weight order; forgetting the one-time sort silently disables most pruning.
2. **Forgetting the back-edge in TSP bounds.** A lower bound that adds only outgoing edges can ignore the cost of returning to the start; make sure the relaxation covers a complete tour's structure.
3. **Allowing subtours.** Reduced-cost or assignment relaxations naturally produce disjoint cycles; if you do not forbid them when branching, B&B "optimizes" to a non-tour.
4. **Re-sorting inside nodes.** Sorting at every node turns an `O(n log n)` setup into `O(n log n)` per node; sort once before the search.
5. **Pushing dominated nodes into a best-first queue.** Only push a child if `child.bound` can still beat the incumbent; pushing everything bloats the frontier.
6. **Inverting the prune test for minimization.** Min prunes when `bound ≥ best` with a *lower* bound; copy-pasting the max logic (`bound ≤ best` with an upper bound) breaks it.
7. **Not seeding the incumbent.** Starting from `±∞` means the first leaves do all the incumbent-building work with zero early pruning; a heuristic seed prunes from node one.

---

## Summary

The bounding function is the soul of branch and bound: it is the optimum of a **relaxation** (fractional knapsack, reduced-cost matrix, 1-tree, LP) and must be **admissible** so pruning never discards the true optimum. The fractional-knapsack bound gives an upper bound for the maximization knapsack; reduced-cost and 1-tree bounds give lower bounds for TSP minimization; the Hungarian/assignment optimum bounds the assignment-with-extra-constraints family. Choose **depth-first** for tiny memory, **best-first** for fewest expansions (watch the queue), and seed the **incumbent** with a heuristic so pruning bites immediately. B&B is a strict superset of backtracking (it adds the bound test) and the exact alternative to DP when the DP state space is too large — but it remains exponential in the worst case because the underlying problems are NP-hard.
