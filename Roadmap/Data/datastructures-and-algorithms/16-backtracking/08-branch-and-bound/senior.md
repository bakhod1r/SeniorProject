# Branch and Bound (B&B) for Optimization — Senior Level

> **Focus:** Production concerns — the bound-quality vs bound-cost trade-off, best-first memory blow-up and how to contain it, anytime/early-termination with optimality gaps, parallel B&B, integration with LP/MILP solvers, testing strategies, and the failure modes that bite real systems.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Bound Quality vs Bound Cost](#bound-quality-vs-bound-cost)
3. [Memory: Best-First Blow-Up and Containment](#memory-best-first-blow-up-and-containment)
4. [Anytime B&B and Early Termination](#anytime-bb-and-early-termination)
5. [Parallel Branch and Bound](#parallel-branch-and-bound)
6. [Integration with LP / MILP Solvers](#integration-with-lp--milp-solvers)
7. [Testing and Validation](#testing-and-validation)
8. [Failure Modes](#failure-modes)
9. [Code Examples](#code-examples)
10. [Operational Checklist](#operational-checklist)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

A correct B&B on a whiteboard and a B&B that runs in production are different animals. In production you face questions the textbook never asks:

- The bound is admissible — fine. But is it *worth* its cost? A bound that halves the node count but triples the per-node cost is a net loss.
- Best-first found the optimum in fewest expansions during testing, then **OOM-killed** the service on a real instance because the priority queue grew to gigabytes. How do you cap it without losing optimality?
- The user can wait 200 ms, not 200 seconds. Can you return the **best-so-far with a quality guarantee** and stop?
- You have 32 cores. Does B&B parallelize, and what goes wrong when it does?
- Should you even write your own B&B, or hand the model to a battle-tested **MILP solver** (CBC, Gurobi, HiGHS) that does branch-and-cut internally?

This file is about making B&B survive contact with real workloads.

---

## From Prototype to Production: What Changes

A whiteboard B&B and a deployed one differ along predictable axes. Before any tuning, audit these:

| Dimension | Prototype | Production |
|-----------|-----------|-----------|
| Result contract | "the optimum" | optimum **or** incumbent + provable gap on timeout |
| Memory | unbounded recursion / queue | bounded; DFS default; capped frontier |
| Latency | "until it finishes" | hard wall-clock budget with anytime return |
| Inputs | hand-picked small instances | adversarial real data, occasional pathological cases |
| Failure | exception / hang | graceful degradation to best-so-far or heuristic |
| Observability | a print at the end | incumbent/bound/gap/frontier metrics streamed |
| Re-solving | one shot | repeated solves, warm-started |
| Verification | "looks right" | independent feasibility + value check on every result |

The throughline: a prototype optimizes for *finding the optimum on easy inputs*; production optimizes for *bounded, observable, graceful behavior on all inputs, including the worst ones you have not seen yet*. The remaining sections detail each axis.

---

## Bound Quality vs Bound Cost

The single most important production trade-off. Total work is roughly:

```
total_work ≈ (nodes_explored) × (cost_per_node)
nodes_explored shrinks as the bound gets tighter
cost_per_node  grows   as the bound gets more elaborate
```

A *tighter* bound prunes more (fewer nodes) but costs more to compute per node. The optimum is not the tightest possible bound — it is the one that minimizes the **product**.

Concrete knapsack example:

| Bound | Tightness | Cost/node | Typical outcome |
|-------|-----------|-----------|-----------------|
| `value + leftover_cap × best_ratio` | loose | O(1) | many nodes, cheap each |
| Fractional (sorted, scan) | tight | O(n) | far fewer nodes |
| Fractional + small-`W` DP correction | tightest | O(W) or O(n log n) | fewest nodes, costliest |

**Practical guidance:**

- Start with the standard relaxation bound (fractional for knapsack, reduced-cost/1-tree for TSP). Profile.
- Only invest in a tighter bound if profiling shows node count, not per-node cost, dominates.
- Cache reusable bound computations. For knapsack, precompute prefix sums of value and weight so the fractional bound is `O(log n)` (binary-search the cutoff) instead of `O(n)`.
- A **cheap bound applied at every node** plus an **expensive bound applied only near the root** (where it prunes whole megasubtrees) is a common hybrid.

---

## Memory: Best-First Blow-Up and Containment

Best-first B&B keeps **all live nodes** in a priority queue. In the worst case the frontier is exponential, and the queue can consume more memory than the entire input — the classic best-first failure. Containment strategies:

1. **Depth-first by default.** DFS uses `O(depth)` memory. Prefer it unless best-first's expansion savings are proven necessary.

2. **Beam / bounded best-first.** Cap the queue at `K` nodes; when full, drop the worst-bound nodes. This **sacrifices optimality** (you may discard the subtree containing the optimum) — only acceptable when an approximate answer is fine. Document it loudly.

3. **Iterative deepening / cost-bounded DFS (DFBnB with re-bounds).** Run DFS but use a bound threshold; deepen the threshold each pass. Keeps `O(depth)` memory while approximating best-first's order. The classic example is depth-first branch-and-bound that always recurses into the better-bounded child first.

4. **Best-first with disk spill or node recomputation.** Store only compact node descriptors (path prefix), recompute derived state on pop. Trades CPU for memory.

5. **Frontier pruning on incumbent updates.** Whenever the incumbent improves, lazily discard queued nodes whose `bound ≤ best`. With a lazy scheme you skip them on pop; with eager filtering you reclaim memory immediately.

> **Rule:** never deploy best-first B&B without a memory cap and a documented behavior for hitting it.

---

### A Concrete Sizing Heuristic

When deciding how much to invest in the bound, a back-of-envelope model helps. Suppose a looser bound `B1` costs `c1` per node and explores `N1` nodes, and a tighter bound `B2` costs `c2 > c1` per node and explores `N2 < N1` nodes. `B2` wins iff:

```
N2 · c2  <  N1 · c1     ⟺     N2 / N1  <  c1 / c2.
```

So the tighter bound pays off only when it cuts the node count by *more* than the factor by which it raises per-node cost. If `B2` is `3×` more expensive per node, it must prune away more than two-thirds of the nodes to be worthwhile. Measure `N1`, `N2`, `c1`, `c2` on a representative instance before committing — intuition about "tighter is better" is frequently wrong because the per-node cost is easy to underestimate. This ratio test also explains the hybrid pattern: apply the expensive bound only at shallow nodes (small `N`, huge pruning leverage) and the cheap bound deep in the tree (large `N`, where per-node cost dominates).

---

## Anytime B&B and Early Termination

Production callers often have a **time budget**, not a "run to optimality" budget. B&B is naturally an **anytime algorithm**: at any moment the incumbent is a valid feasible solution, and the **best bound in the frontier** is an optimistic limit on the true optimum. Together they give a **provable quality guarantee**:

```
optimality_gap = | best_frontier_bound − incumbent | / |incumbent|
```

- When `gap == 0`, the incumbent is provably optimal → stop.
- When `gap ≤ ε` (e.g., 1%), stop early and report "within 1% of optimal." This is what MILP solvers call the **MIP gap tolerance** (`MIPGap`).
- On a **time limit**, return the incumbent plus its current gap, so the caller knows how good it is.

Early-termination knobs you should expose:

| Knob | Meaning |
|------|---------|
| `time_limit` | Wall-clock cap; return best-so-far on expiry. |
| `gap_tolerance` | Stop when proven within `ε` of optimal. |
| `node_limit` | Cap nodes explored. |
| `solution_limit` | Stop after finding `k` improving incumbents. |

This turns "exact but unbounded" B&B into a controllable, latency-bounded service.

---

### Containment Decision Table

A quick reference for choosing a strategy under memory pressure:

| Situation | Recommended strategy |
|-----------|----------------------|
| Memory is tight, exactness required | Depth-first B&B (`O(depth)`) |
| Want best-first order, memory tight | DFBnB / IDA*-style threshold search |
| Best-first needed, memory available | Best-first + frontier cap + lazy dominance pruning |
| Approximate answer acceptable | Beam search (capped frontier, documented suboptimality) |
| Huge instances, linear model | Hand off to a MILP solver |

Pick deliberately and document the memory contract; never let a best-first frontier grow unbounded in a shared service.

---

## Parallel Branch and Bound

B&B parallelizes well because subtrees are largely independent — but with subtleties:

- **Tree (subtree) parallelism.** Hand different live nodes to different workers; each explores its subtree. Natural fan-out.
- **Shared incumbent.** The incumbent must be **global and atomic**. A worker that improves it broadcasts the new `best` so all workers prune more aggressively. Use an atomic/compare-and-set update guarded against regressions.
- **Work stealing.** Subtree sizes are wildly uneven (pruning is data-dependent), so static partitioning load-imbalances badly. Idle workers steal live nodes from busy ones' queues.
- **Anomalies.** Parallel B&B exhibits **speedup anomalies**: with `p` workers you can see *super-linear* speedup (a worker finds a great incumbent early, pruning others' work) or *sub-linear* / even *slowdown* (workers explore nodes a good serial incumbent would have pruned — wasted "speculative" work). Speedup is not guaranteed proportional to cores.
- **Determinism.** Parallel exploration order is nondeterministic; with ties in the objective, the *returned optimal solution* may differ run to run (its value will not). If callers depend on a specific optimum, add a deterministic tie-break.

Practical pattern: a global priority queue of "seed" nodes, a pool of workers each running DFS B&B on a stolen seed, and an atomic shared incumbent with broadcast on improvement.

---

## Integration with LP / MILP Solvers

For serious integer optimization, **do not hand-roll B&B** — model the problem and call a solver. Modern MILP solvers implement **branch-and-cut** (B&B + cutting planes) and **branch-and-price** with decades of engineering.

- **The LP relaxation is the bound.** Drop integrality, solve the LP (polynomial), and its optimum bounds the integer optimum. Branching fixes a fractional variable up/down. (Full treatment in [`professional.md`](./professional.md).)
- **Cutting planes (branch-and-cut).** Add valid inequalities (Gomory cuts, cover cuts) that tighten the LP relaxation without removing integer solutions — strengthening the bound globally.
- **When to model-and-call:** any problem expressible as (mixed) integer linear constraints — scheduling, routing, assignment, facility location. Use CBC/HiGHS (open source), Gurobi/CPLEX (commercial), or modeling layers (PuLP, OR-Tools, JuMP).
- **When to hand-roll:** specialized combinatorial structure with a custom bound far tighter than a generic LP (e.g., 1-tree for TSP), tiny embedded environments, or teaching.

Knowing the boundary — "this is a MILP, call a solver" vs "this needs a bespoke bound" — is a senior-level judgment that saves weeks.

---

## Warm Starts and Incremental Re-Solving

Production optimization is rarely a one-shot solve; the same problem is re-solved repeatedly as data drifts (new orders, updated costs, a removed machine). Re-running B&B from scratch each time wastes the previous run's work.

- **Warm-starting the incumbent.** The previous run's optimal solution is usually still feasible (or trivially repairable) after a small data change. Seed the new run's incumbent with it; pruning starts strong immediately. This alone often turns a multi-second re-solve into milliseconds.
- **Warm-starting the bound (MILP).** Solvers can reuse the previous LP basis and the cutting planes generated last time, so the root relaxation re-solves in a few simplex pivots rather than from cold. Expose this when your solver supports it (`Model.update` / basis reuse).
- **Reoptimization after adding a constraint.** Adding a constraint only *shrinks* the feasible set, so the previous bound remains a valid bound and the previous incumbent — if still feasible — remains a valid incumbent. After *removing* a constraint, the previous incumbent stays feasible (still a valid `U`) but the bound must be recomputed.
- **Solution stability.** Callers often prefer a new solution *close* to the old one (minimal churn — e.g., not rerouting every driver). Add a penalty term or a proximity constraint so the re-solve favors the previous solution; this also tends to keep the warm-started incumbent strong.

The pattern: persist the last incumbent (and, for MILP, the basis/cuts) keyed by problem identity, and feed them into the next solve. Treat B&B as a *stateful, incrementally re-solved* component, not a pure function, when latency on repeated solves matters.

---

## Testing and Validation

- **Brute-force oracle.** For small `n`, compare B&B's optimum against exhaustive enumeration. The optimal *value* must match exactly.
- **Solution feasibility check.** Independently verify the returned solution satisfies all constraints and that its objective equals the reported optimum. A bug that prunes too aggressively often returns an infeasible or sub-optimal solution that *looks* fine.
- **Admissibility tests.** Assert at every node that `bound ≥ true_subtree_optimum` (max) by comparing against a brute-force subtree solve on small instances. A non-admissible bound is the worst bug because it produces *plausible wrong* answers.
- **Property-based testing.** Random instances; invariant: B&B value == DP value (small `W`) == brute-force value. Also: tighter bound ⇒ ≤ nodes explored.
- **Determinism & limits.** Test that `time_limit`/`gap_tolerance`/`node_limit` are honored and that the reported gap is a true bound.
- **Regression on hard instances.** Keep a corpus of adversarial inputs (equal ratios, clustered TSP points) and track node counts over time.

---

## Security and Resource-Exhaustion Considerations

When B&B is exposed to untrusted or unbounded input (a public optimization endpoint, a user-uploaded instance), its exponential worst case becomes an attack surface — a denial-of-service vector by construction.

- **Adversarial instances as DoS.** An attacker who understands your bound can craft inputs (equal ratios, near-symmetric TSP) that defeat pruning and force full exponential exploration, pinning CPU and memory. Treat instance size and structure as untrusted.
- **Hard caps, always.** Enforce a node limit, a wall-clock limit, *and* a memory/frontier cap on every externally triggered solve. Return the incumbent (or a typed "could not prove optimal in budget" result) rather than running unbounded.
- **Input validation.** Bound `n`, the magnitude of weights/costs, and the capacity before solving; reject instances above a documented size threshold or route them to an approximate path.
- **Isolation.** Run user-triggered solves in a resource-limited sandbox (cgroup CPU/memory limits, separate worker pool) so one pathological request cannot starve the rest of the service.
- **Fair scheduling.** Per-tenant quotas on solver time prevent a single caller from monopolizing the optimization workers.

The mindset shift: a B&B that is "correct and usually fast" is *not* safe to expose directly. Wrap it in budgets, validation, and isolation so that worst-case difficulty degrades gracefully into a bounded-cost approximate answer instead of an outage.

---

## Failure Modes

| Failure | Symptom | Mitigation |
|---------|---------|------------|
| Non-admissible bound | Wrong (suboptimal) answer that looks valid | Derive bound from a relaxation; test against oracle. |
| Best-first OOM | Process killed under load | Memory cap, DFS fallback, lazy frontier pruning. |
| Loose bound | No pruning; runs effectively as brute force | Tighten bound, seed incumbent, reorder branches. |
| Expensive bound | Few nodes but still slow | Profile; use cheaper bound or cache/prefix-sum it. |
| Subtour bug (TSP) | "Optimal" answer is not a tour | Forbid subtours in branching. |
| Float bound rounding | Spurious prune/no-prune near ties | Use a tolerance; prefer integer/exact bounds when possible. |
| Parallel slowdown anomaly | More cores, not faster | Work stealing, shared incumbent broadcast, better seed order. |
| Stale frontier node | Expanding a node the incumbent already dominates | Re-check `bound ≤ best` on pop (lazy deletion). |
| No progress under time limit | Returns trivial incumbent | Seed with a strong heuristic; report the gap. |

---

## Code Examples

### Anytime DFS B&B with time limit, gap, and incumbent callback (knapsack)

#### Go

```go
package main

import (
	"fmt"
	"sort"
	"time"
)

type Item struct{ value, weight int }

type Solver struct {
	items    []Item
	W        int
	best     int
	bestBnd  float64 // tightest optimistic bound seen at the root
	deadline time.Time
	nodes    int
	stopped  bool
}

func (s *Solver) bound(idx, value, weight int) float64 {
	if weight >= s.W {
		return float64(value)
	}
	b := float64(value)
	totW := weight
	for i := idx; i < len(s.items); i++ {
		if totW+s.items[i].weight <= s.W {
			totW += s.items[i].weight
			b += float64(s.items[i].value)
		} else {
			b += float64(s.W-totW) * float64(s.items[i].value) / float64(s.items[i].weight)
			break
		}
	}
	return b
}

func (s *Solver) dfs(idx, value, weight int) {
	if s.stopped {
		return
	}
	s.nodes++
	if s.nodes&1023 == 0 && time.Now().After(s.deadline) {
		s.stopped = true // anytime: bail out, keep incumbent
		return
	}
	if value > s.best {
		s.best = value
	}
	if idx == len(s.items) {
		return
	}
	if s.bound(idx, value, weight) <= float64(s.best) {
		return // prune
	}
	if weight+s.items[idx].weight <= s.W {
		s.dfs(idx+1, value+s.items[idx].value, weight+s.items[idx].weight)
	}
	s.dfs(idx+1, value, weight)
}

func main() {
	items := []Item{{10, 2}, {10, 4}, {12, 6}, {18, 9}}
	sort.Slice(items, func(a, b int) bool {
		return items[a].value*items[b].weight > items[b].value*items[a].weight
	})
	s := &Solver{items: items, W: 10, deadline: time.Now().Add(50 * time.Millisecond)}
	s.bestBnd = s.bound(0, 0, 0)
	s.dfs(0, 0, 0)
	gap := (s.bestBnd - float64(s.best)) / float64(s.best)
	fmt.Printf("best=%d  nodes=%d  stopped=%v  gap<=%.2f%%\n",
		s.best, s.nodes, s.stopped, gap*100)
}
```

#### Java

```java
import java.util.*;

public class AnytimeKnapsack {
    record Item(int value, int weight) {}
    Item[] items; int W, best; double bestBnd; long deadlineNs; long nodes; boolean stopped;

    double bound(int idx, int value, int weight) {
        if (weight >= W) return value;
        double b = value; int totW = weight;
        for (int i = idx; i < items.length; i++) {
            if (totW + items[i].weight() <= W) { totW += items[i].weight(); b += items[i].value(); }
            else { b += (double)(W - totW) * items[i].value() / items[i].weight(); break; }
        }
        return b;
    }

    void dfs(int idx, int value, int weight) {
        if (stopped) return;
        if ((++nodes & 1023) == 0 && System.nanoTime() > deadlineNs) { stopped = true; return; }
        if (value > best) best = value;
        if (idx == items.length) return;
        if (bound(idx, value, weight) <= best) return;           // prune
        if (weight + items[idx].weight() <= W)
            dfs(idx + 1, value + items[idx].value(), weight + items[idx].weight());
        dfs(idx + 1, value, weight);
    }

    public static void main(String[] args) {
        AnytimeKnapsack s = new AnytimeKnapsack();
        s.items = new Item[]{ new Item(10,2), new Item(10,4), new Item(12,6), new Item(18,9) };
        Arrays.sort(s.items, (a,b) -> Double.compare(
            (double)b.value()/b.weight(), (double)a.value()/a.weight()));
        s.W = 10;
        s.deadlineNs = System.nanoTime() + 50_000_000L;
        s.bestBnd = s.bound(0, 0, 0);
        s.dfs(0, 0, 0);
        double gap = (s.bestBnd - s.best) / (double) s.best;
        System.out.printf("best=%d nodes=%d stopped=%b gap<=%.2f%%%n",
            s.best, s.nodes, s.stopped, gap * 100);
    }
}
```

#### Python

```python
import time


class Solver:
    def __init__(self, items, W, time_budget=0.05):
        self.items = sorted(items, key=lambda it: it[0] / it[1], reverse=True)
        self.W = W
        self.best = 0
        self.deadline = time.perf_counter() + time_budget
        self.nodes = 0
        self.stopped = False
        self.best_bnd = self.bound(0, 0, 0)

    def bound(self, idx, value, weight):
        if weight >= self.W:
            return float(value)
        b, tot_w = float(value), weight
        for i in range(idx, len(self.items)):
            v, w = self.items[i]
            if tot_w + w <= self.W:
                tot_w += w
                b += v
            else:
                b += (self.W - tot_w) * v / w
                break
        return b

    def dfs(self, idx, value, weight):
        if self.stopped:
            return
        self.nodes += 1
        if self.nodes % 1024 == 0 and time.perf_counter() > self.deadline:
            self.stopped = True            # anytime: keep incumbent
            return
        if value > self.best:
            self.best = value
        if idx == len(self.items):
            return
        if self.bound(idx, value, weight) <= self.best:
            return                          # prune
        v, w = self.items[idx]
        if weight + w <= self.W:
            self.dfs(idx + 1, value + v, weight + w)
        self.dfs(idx + 1, value, weight)


if __name__ == "__main__":
    s = Solver([(10, 2), (10, 4), (12, 6), (18, 9)], 10)
    s.dfs(0, 0, 0)
    gap = (s.best_bnd - s.best) / s.best
    print(f"best={s.best} nodes={s.nodes} stopped={s.stopped} gap<={gap*100:.2f}%")
```

**What it does:** runs DFS B&B with a wall-clock deadline (checked every 1024 nodes), returns the incumbent whenever it stops, and reports a provable optimality gap from the root bound.
**Run:** `go run main.go` | `javac AnytimeKnapsack.java && java AnytimeKnapsack` | `python anytime.py`

---

## Branching Rules and Variable Selection

In production the branching *rule* matters as much as the bound. Two children created at a node partition its feasible set; *which* variable to branch on and *which* child to explore first dramatically change node counts.

- **Variable selection (which to branch on).** For integer programs, branching on the variable that is *most fractional* in the LP solution (closest to 0.5) is a classic rule, but **pseudocost branching** — estimating each variable's historical impact on the bound and branching on the highest-impact one — is what real MILP solvers use. **Strong branching** tentatively solves the LP for each candidate to measure the actual bound improvement; it is expensive per node but can slash the tree. Reliability branching blends pseudocosts with occasional strong-branching calibration.
- **Child ordering (which to explore first).** Explore the child more likely to yield a strong incumbent first (down-branch / take-branch for ratio-sorted knapsack). A strong incumbent found early tightens the prune test for the sibling subtree.
- **Branching object.** You need not branch on a single variable. Branching on a *constraint* (e.g., "include edge (i,j)" vs "exclude edge (i,j)" for TSP, or SOS/GUB branching) often partitions the space more evenly and prunes better than variable dichotomy.
- **Symmetry breaking.** Identical machines in scheduling, interchangeable items, or symmetric graph structure create vast redundant subtrees. Detect symmetry and forbid exploring permuted-equivalent nodes (orbital branching, lexicographic constraints). The scheduling example in [`interview.md`](./interview.md) skips machines whose load was already tried at a depth — a cheap, effective symmetry break.

A poorly chosen branching rule can make a tight bound useless: if every branch leaves the bound nearly unchanged, no pruning happens. Profiling should report not just node count but *bound improvement per branch*.

---

## Numerical Robustness

Floating-point bounds introduce subtle correctness hazards that integer textbooks ignore:

- **Tolerance in the prune test.** Comparing a float `bound` against an integer or float `incumbent` with exact `≤` can both over-prune (drop the optimum due to rounding the bound *down*) and under-prune (waste work). Use a small tolerance: prune only when `bound ≤ incumbent − ε` if you must be conservative, or `bound ≤ incumbent + ε` if a tiny suboptimality is acceptable — and document which.
- **Prefer exact arithmetic where possible.** Integer or rational bounds (the fractional-knapsack bound can be kept as an exact rational `value + remain·v / w`) sidestep rounding entirely. Many combinatorial bounds are integer-valued and should be computed as integers.
- **LP solver tolerances.** MILP solvers carry feasibility and integrality tolerances (e.g., `1e-6`); a variable "integer to within tolerance" is treated as integer. Misconfigured tolerances cause solvers to report wrong optima or cycle. When hand-rolling against an LP library, inherit and respect its tolerances.
- **Accumulated error in deep trees.** Recomputing bounds incrementally down a deep path can accumulate float drift; periodically recompute from scratch, or keep bounds exact.

The safest production posture: keep the *pruning decision* exact (integer/rational) even if intermediate heuristics use floats.

---

## Operational Checklist

- [ ] Bound derived from an explicit relaxation; **admissibility tested** against a brute-force oracle.
- [ ] Incumbent **seeded with a heuristic** before search starts.
- [ ] **DFS by default**; best-first only with a memory cap and documented overflow behavior.
- [ ] **Time limit, gap tolerance, node limit** exposed; gap reported on early exit.
- [ ] Returned solution **independently verified feasible** and value-consistent.
- [ ] Parallel version uses an **atomic shared incumbent** and **work stealing**; tie-break for determinism if callers need it.
- [ ] Considered modeling as MILP and calling a solver instead of hand-rolling.
- [ ] Corpus of **adversarial instances** in regression tests; node counts tracked.

---

## Observability and Tuning in Production

A long-running B&B (or MILP solve) is opaque unless you instrument it. The metrics that matter operationally:

- **Incumbent over time.** Log every incumbent improvement with a timestamp. A flat line early means your heuristic seed is weak; a flat line late means the solver is grinding to *prove* optimality, not to *find* better solutions — often the cue to accept the current incumbent with its gap.
- **Best bound over time.** The global lower bound (min over the frontier). The gap `(incumbent − best_bound)` is your single most important number; export it as a gauge so dashboards and alerts can watch it.
- **Nodes/sec and pruned/sec.** A falling prune rate signals the bound has stopped biting (the frontier is full of nodes the incumbent can no longer dominate). Pair with average bound-improvement-per-branch.
- **Frontier size.** For best-first, alert *before* OOM, not after. A monotonically growing frontier with a stalled gap is the classic best-first death spiral.
- **Time-to-first-feasible.** If a caller only needs *a* feasible answer fast, this is the latency that matters; tune the heuristic seed against it.

Tuning levers, roughly in order of impact: seed a stronger incumbent → tighten the bound (or add cuts) → improve branching/variable selection → switch search strategy → parallelize. Always change one lever at a time and re-measure node count and wall time on a fixed instance corpus; B&B performance is notoriously non-monotone in its knobs (a "better" bound that costs more can slow the whole solve).

---

## Choosing a B&B Library or Solver

A pragmatic decision tree for senior engineers:

- **Linear objective + linear constraints + integer variables →** model as MILP and use a solver. Open source: HiGHS (fast, actively developed), CBC (mature, via PuLP/OR-Tools). Commercial: Gurobi, CPLEX, FICO Xpress (often 10–100× faster on hard instances, worth it at scale). All do branch-and-cut with presolve, cuts, and tuned branching you will not match by hand.
- **Constraint-heavy / logical / scheduling with no clean linear form →** a CP-SAT solver (OR-Tools CP-SAT) often beats MILP; it combines constraint propagation with B&B-style search and clause learning.
- **Specialized structure with a custom bound far tighter than generic LP →** hand-roll (TSP with 1-tree + Lin–Kernighan incumbent; specialized packing). This is rare and should be justified by benchmarking against a solver first.
- **Tiny embedded / no-dependency environment, or teaching →** hand-roll the DFS B&B from these files.

The senior failure mode is hand-rolling a generic MILP when a solver would have been faster to write *and* run. Reach for a solver first; hand-roll only when you can show it wins.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The knapsack search tree with each node's bound vs the incumbent
> - Pruned subtrees crossed out — the visual proof of how a tight bound shrinks the tree
> - How a stronger early incumbent (seeded heuristic) prunes more
> - The optimality gap closing as the search proceeds (anytime behavior)

---

## Case Study: A B&B Service That Fell Over

A concrete composite of common production incidents, walked through with the fixes:

A routing service used best-first B&B to solve small vehicle-routing instances (TSP-like) under a 2-second latency SLA. It worked in staging and for weeks in production, then began OOM-killing pods during a traffic spike.

- **Symptom.** Pods restarted; p99 latency exploded; some requests returned no answer.
- **Root cause.** A handful of *adversarial* real instances (clustered, near-symmetric customer locations) made the reduced-cost bound loose. With weak pruning, the best-first frontier grew to hundreds of thousands of live nodes, each holding a full path copy — gigabytes of RSS.
- **Immediate mitigation.** Switched the default strategy to **depth-first B&B** (`O(depth)` memory) with a node budget; memory became bounded instantly, at the cost of slightly more nodes on easy instances.
- **Latency fix.** Made it **anytime**: seed the incumbent with nearest-neighbor, run DFS B&B to the 1.8s mark, return the incumbent with its optimality gap. Most requests still proved optimality (gap 0) well within budget; the hard ones returned a provably-near-optimal tour instead of nothing.
- **Tightening the bound.** Added the **1-tree bound** as a second admissible bound and used `max(reduced_cost, one_tree)`; pruning on the adversarial instances improved by an order of magnitude, shrinking the frontier even before the strategy change mattered.
- **Guardrails added.** A frontier-size gauge with an alert below the OOM threshold; a regression corpus seeded with the adversarial instances and node-count assertions; and a feature flag to fall back to an OR-Tools solver for instances exceeding a size threshold.

The lessons map directly to this file: **never deploy best-first without a memory bound**, **make B&B anytime so latency is controllable**, **invest in the bound only where profiling shows node count dominates**, and **keep adversarial instances in regression tests** because B&B's worst case is data-dependent and will find you in production.

---

## Summary

Productionizing branch and bound is about three trade-offs and one judgment call. The trade-offs: **bound tightness vs cost** (minimize nodes × cost-per-node, not either alone), **best-first node savings vs memory blow-up** (default to DFS; cap any best-first frontier), and **exactness vs latency** (expose time limits, gap tolerance, and an anytime incumbent with a provable optimality gap). Parallel B&B scales on independent subtrees but needs an atomic shared incumbent, work stealing, and tolerance for speedup anomalies. The judgment call: for any mixed-integer-linear model, prefer a mature **MILP solver** (branch-and-cut on the LP relaxation) over a hand-rolled B&B — reserve custom B&B for specialized structure with a bound far tighter than generic LP, like the 1-tree for TSP. Always test admissibility against an oracle: a non-admissible bound silently returns plausible wrong answers, the most dangerous failure of all.
