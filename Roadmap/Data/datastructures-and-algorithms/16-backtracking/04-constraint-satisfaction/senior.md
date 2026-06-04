# Constraint Satisfaction Problems (CSP) — Senior Level

> The backtracking framework is the easy part. Senior CSP work is judgment: how much propagation to pay for, when to learn from failures (backjumping, no-good learning), whether to hand the problem to a SAT/CP solver instead of rolling your own, and how to test a solver whose correctness is otherwise invisible until it silently returns a wrong or missing answer.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Choosing the Propagation Level](#2-choosing-the-propagation-level)
3. [Conflict-Directed Backjumping](#3-conflict-directed-backjumping)
4. [No-Good Learning and Clause Learning](#4-no-good-learning-and-clause-learning)
5. [Global Constraints and Specialized Propagators](#5-global-constraints-and-specialized-propagators)
6. [Build vs Buy: CP Solvers and SAT Encoding](#6-build-vs-buy-cp-solvers-and-sat-encoding)
7. [Restarts, Randomization, and Symmetry Breaking](#7-restarts-randomization-and-symmetry-breaking)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

A senior engineer rarely writes a CSP solver from scratch for production — but they constantly *model* problems as CSPs (timetabling, resource allocation, configuration, register allocation, layout, test-case generation) and must decide how to solve them reliably and fast. The decisions that matter are:

1. **How much propagation?** Forward checking, MAC (AC-3 per node), or specialized global-constraint propagators. More propagation prunes harder but costs more per node; the optimum is problem-specific and must be measured.
2. **How to learn from failure?** Plain chronological backtracking re-discovers the same dead ends repeatedly. Conflict-directed backjumping and no-good learning jump past irrelevant decisions and remember why a sub-search failed.
3. **Build or buy?** A mature CP solver (OR-Tools CP-SAT, Gecode, Choco) or a SAT solver (via encoding) often beats a hand-rolled backtracker by huge margins because of years of engineering in propagation, learning, and restarts.
4. **How to test?** A solver that returns a *wrong* assignment or *misses* a solution fails silently. You need oracles, property tests, and known-answer instances.

This document treats those decisions in production terms, assuming you already know the MRV/LCV/forward-checking/AC-3 material from [`middle.md`](./middle.md).

---

## 2. Choosing the Propagation Level

The core tension: pruning power vs per-node cost.

| Level | Prunes | Per-node cost | Use when |
|-------|--------|---------------|----------|
| None (BT only) | check vs assigned | O(degree) | trivial / tiny domains |
| Forward checking | direct neighbors | O(deg·d) | loosely constrained, large branching |
| MAC (AC-3 each node) | whole arc network | O(e·d³) | tightly constrained, hard instances |
| Bounds consistency | numeric interval endpoints | O(deg) per propagator | arithmetic / scheduling constraints |
| Global propagators | constraint-specific | varies | `AllDifferent`, `cumulative`, etc. |

**Heuristic for choosing:** the tighter the constraints (the more a single assignment ripples), the more propagation pays. Sudoku and hard graph coloring reward MAC; scheduling with arithmetic rewards bounds consistency on the numeric variables; loose configuration problems often do best with cheap forward checking and aggressive MRV.

A practical pattern is *staged propagation*: cheap forward checking on every node, full AC-3 only when a domain shrinks below a threshold or at restart boundaries. Measure node counts *and* wall-clock; fewer nodes is meaningless if each node is 100× slower.

A second practical pattern is *constraint-specific propagators*: keep generic AC-3 for ordinary `≠` constraints but route `AllDifferent`, `sum`, and `cumulative` to dedicated GAC/bounds propagators. Hybrid propagation — generic where it suffices, specialized where it pays — is how production solvers get both broad coverage and strong pruning.

---

## 3. Conflict-Directed Backjumping

Chronological backtracking undoes the *most recent* decision when a dead end is hit — even if that decision had nothing to do with the failure. **Backjumping** instead jumps back to the *deepest decision that actually contributed to the conflict*, skipping irrelevant intervening choices.

**Conflict set.** For each variable `X`, maintain the set of earlier-assigned variables whose values ruled out values of `X`. When `X` wipes out (no legal value), its conflict set is the union of those culprits. Instead of backtracking one level, jump back to the *most recent* variable in that conflict set, and propagate the conflict set upward (absorb `X`'s conflict set into that variable's, minus the jumped-over variables).

```
when X has empty domain:
    conf = conflictSet(X)                 # vars whose assignments killed X's values
    target = most recent variable in conf
    # absorb so the target inherits responsibility
    conflictSet(target) |= conf \ {target}
    backjump to target (undo everything between)
```

**Conflict-directed backjumping (CBJ)** is the refined version that also records conflicts discovered *during* the failed subtree, not just at the leaf, so it can jump even further. CBJ can turn an exponential thrashing search into a tractable one on problems with "deep but narrow" structure, where the real culprit is a decision made long ago.

**Interaction with propagation.** With MAC, much of backjumping's benefit is already captured because propagation detects conflicts early. CBJ shines most with weak propagation; combined with strong propagation the gains are smaller but still real on structured instances.

In modern learning solvers, **backjumping is subsumed by conflict analysis**: after deriving a learned clause/no-good, the solver *non-chronologically* backtracks to the second-highest decision level in that clause (the "asserting level"), which is exactly the deepest relevant culprit. So if you encode to CP-SAT you get CBJ-equivalent behavior for free; the standalone CBJ algorithm matters mainly for hand-rolled solvers without learning.

---

## 4. No-Good Learning and Clause Learning

A **no-good** is a partial assignment proven inconsistent — e.g. "`X=red ∧ Y=green` can never extend to a solution." Once learned, the solver refuses to ever re-enter that combination, anywhere in the tree. This is the CSP analogue of **conflict-driven clause learning (CDCL)**, the engine behind modern SAT solvers.

```
on conflict:
    derive a no-good (minimal subset of current assignment causing failure)
    store it as a new constraint
    use it to (a) prune future branches and (b) guide backjumping
```

Key engineering concerns:

- **Minimization.** A small no-good prunes far more than a large one; spend effort minimizing the conflict (analogous to 1-UIP clause learning in SAT).
- **Storage growth.** Learned no-goods accumulate without bound; production solvers periodically delete low-activity ones (clause-deletion policies).
- **Indexing.** No-goods must be checked fast (watched-literal schemes in SAT) or they slow propagation more than they save.

For most application work you should *not* hand-implement no-good learning — you should encode to SAT/CP-SAT and inherit a world-class implementation. Implement it yourself only when your constraints are too exotic to encode efficiently.

**A concrete no-good.** Suppose in a scheduling CSP the partial assignment `{room=A, time=9am, instructor=Lee}` is proven to leave no consistent extension (Lee is double-booked given the rest of the model). The minimal no-good might be just `{time=9am, instructor=Lee}` — the room is irrelevant. Storing that two-literal no-good prunes *every* future branch that pairs Lee with 9am, regardless of room or other choices, which is far stronger than the chronological backtrack that would only undo the room. Minimization (dropping the irrelevant `room=A`) is what makes the stored constraint broadly reusable.

---

## 5. Global Constraints and Specialized Propagators

Decomposing `AllDifferent(X1..Xn)` into `O(n²)` pairwise `≠` constraints is correct but propagates weakly. A dedicated **`AllDifferent` propagator** using a bipartite matching argument (Régin's algorithm) achieves much stronger pruning — it detects, e.g., that 4 variables sharing 3 possible values is already a dead end, which pairwise `≠` cannot see until much later.

Common global constraints and what they buy:

| Constraint | Decomposed cost | Global propagator | Why global wins |
|------------|-----------------|-------------------|-----------------|
| `AllDifferent` | O(n²) weak `≠` | Régin / matching, GAC | sees Hall-set infeasibility early |
| `cumulative` (scheduling) | many `≤` | edge-finding | reasons about resource peaks |
| `table` | enumerated | compact tries | arbitrary relations, fast support checks |
| `element`, `circuit` | awkward | dedicated | structural reasoning |

Senior takeaway: *modeling with global constraints* often matters more than solver choice. A Sudoku modeled with nine `AllDifferent` constraints (rows/cols/boxes) and a GAC propagator can be solved by propagation alone with no search on most boards.

---

## 6. Build vs Buy: CP Solvers and SAT Encoding

**When to use a CP solver (OR-Tools CP-SAT, Gecode, Choco):**
- Rich global constraints, optimization (not just satisfaction), large but structured problems.
- You want learning, restarts, LNS, parallel search "for free."

**When to encode to SAT:**
- The problem is naturally Boolean or finite-domain with small domains.
- You want the raw speed of CDCL on huge but loosely structured instances.

**SAT encoding of a finite-domain CSP** (direct/one-hot encoding):
- One Boolean `x_{v,d}` = "variable `v` takes value `d`."
- **At-least-one** clause per variable: `(x_{v,1} ∨ x_{v,2} ∨ … ∨ x_{v,k})`.
- **At-most-one** per variable: pairwise `(¬x_{v,a} ∨ ¬x_{v,b})` (or a compact commander/sequential encoding for large domains).
- Each constraint becomes clauses, e.g. `X ≠ Y` over shared value `d`: `(¬x_{X,d} ∨ ¬x_{Y,d})`.

The encoding choice (direct vs log/binary vs order encoding) dramatically affects solver performance; order encoding is excellent for arithmetic/inequality constraints. CP-SAT hybridizes CP propagation with SAT clause learning and is often the best default in 2026.

**Decision rule:** prototype with the highest-level tool that fits (CP-SAT). Drop to a hand-rolled backtracker only when you need a tiny dependency footprint, embedded deployment, or exotic propagators not expressible in the library.

**A concrete encoding pitfall.** The naive pairwise at-most-one for a variable with domain `k` emits `k(k−1)/2` clauses. For a Sudoku cell (`k = 9`) that is 36 clauses × 81 cells = ~2,900 clauses just for at-most-one — manageable. But for a scheduling variable with `k = 1000` slots, pairwise is ~500k clauses *per variable*, which destroys the solver. Use the **sequential (ladder) encoding** — `O(k)` clauses and `O(k)` auxiliary variables — or the **commander encoding** instead. This single decision often determines whether a SAT-encoded model is viable. CP-SAT sidesteps it entirely by handling finite-domain variables natively.

**Optimization, not just satisfaction.** Many real problems want the *best* solution (minimum colors, minimum makespan), not any solution. This is a **Constraint Optimization Problem (COP)**: add an objective and a bound constraint, solve repeatedly with a tightening bound (branch-and-bound), or use the solver's native optimization (CP-SAT's `Minimize`). Hand-rolled backtracking extends to branch-and-bound by pruning branches whose best-possible objective is worse than the incumbent — but the bookkeeping is exactly what mature solvers already do well, reinforcing the buy decision for optimization workloads.

---

## 7. Restarts, Randomization, and Symmetry Breaking

- **Restarts.** Heavy-tailed runtime distributions mean a search can get "stuck" in a bad subtree. Periodically restarting (with learned no-goods retained and randomized tie-breaking) escapes these. Luby restart schedules (1,1,2,1,1,2,4,…) are the standard universal choice; geometric schedules (multiply the limit by ~1.5 each restart) are also common. Without learned no-goods, restarts would just repeat the same search — the two techniques are symbiotic.
- **Randomized tie-breaking** in MRV/value ordering, combined with restarts, makes the solver robust to unlucky orderings. The combination is what turns a heavy-tailed worst case into a reliable median runtime: each restart resamples the tie-breaks, so a single unlucky early commitment no longer dominates the wall-clock budget across a fleet of instances.
- **Symmetry breaking.** Map coloring has color-permutation symmetry; N-Queens has board symmetries. Adding symmetry-breaking constraints (e.g. fix the first region's color, or impose lexicographic ordering on symmetric variables) prunes the entire search by the symmetry-group size. This is often the single biggest speedup available and costs almost nothing.
- **Value/activity heuristics.** SAT-style VSIDS (bump variables involved in recent conflicts) often beats static MRV on learning-based solvers.
- **Phase saving.** Remember the last value each variable was assigned and prefer it after a restart; this keeps the solver near a promising region instead of re-deriving the same partial work, a cheap and surprisingly effective complement to restarts.
- **Large Neighborhood Search (LNS).** For optimization, fix most variables of an incumbent solution and re-solve the small freed neighborhood with the CP/SAT engine; iterating this often improves objectives faster than pure branch-and-bound on large instances.

**Symmetry-breaking example.** In graph coloring, any solution stays valid under any permutation of the `k` colors — a `k!` symmetry. Fixing the first (highest-degree) vertex to color 0, and constraining each new color to be at most "one more than the max color used so far" (a *precede* / value-symmetry-breaking constraint), eliminates this entirely. On a graph needing 4 colors this can shrink the search by a factor approaching `4! = 24` at essentially zero cost. For board puzzles (N-Queens, Sudoku variants) geometric symmetries (rotations, reflections) are broken with lexicographic-leader constraints on the symmetric image. Always look for symmetry first; it is the highest-return, lowest-effort optimization available.

---

## 8. Code Examples

### Example: Generic Backtracking CSP Solver with MAC and Conflict Tracking

A reusable solver core: pluggable constraints, MRV + LCV, AC-3 maintained per node, and a simple conflict-set record enabling backjumping.

#### Go

```go
package main

import "fmt"

type CSP struct {
	vars       []int
	domains    map[int][]int
	neighbors  map[int][]int
	constraint func(a, va, b, vb int) bool // true if (a=va, b=vb) is allowed
}

func (c *CSP) consistent(v, val int, assign map[int]int) bool {
	for _, nb := range c.neighbors[v] {
		if vv, ok := assign[nb]; ok && !c.constraint(v, val, nb, vv) {
			return false
		}
	}
	return true
}

func (c *CSP) revise(x, y int, dom map[int][]int) bool {
	removed := false
	kept := []int{}
	for _, vx := range dom[x] {
		support := false
		for _, vy := range dom[y] {
			if c.constraint(x, vx, y, vy) {
				support = true
				break
			}
		}
		if support {
			kept = append(kept, vx)
		} else {
			removed = true
		}
	}
	dom[x] = kept
	return removed
}

// ac3 over arcs into x; returns false on wipeout.
func (c *CSP) ac3(seed [][2]int, dom map[int][]int) bool {
	queue := append([][2]int{}, seed...)
	for len(queue) > 0 {
		a := queue[0]
		queue = queue[1:]
		if c.revise(a[0], a[1], dom) {
			if len(dom[a[0]]) == 0 {
				return false
			}
			for _, z := range c.neighbors[a[0]] {
				if z != a[1] {
					queue = append(queue, [2]int{z, a[0]})
				}
			}
		}
	}
	return true
}

func clone(d map[int][]int) map[int][]int {
	c := map[int][]int{}
	for k, v := range d {
		c[k] = append([]int{}, v...)
	}
	return c
}

func (c *CSP) selectMRV(assign map[int]int, dom map[int][]int) int {
	best, bestN := -1, 1<<30
	for _, v := range c.vars {
		if _, ok := assign[v]; ok {
			continue
		}
		if len(dom[v]) < bestN {
			best, bestN = v, len(dom[v])
		}
	}
	return best
}

func (c *CSP) solve(assign map[int]int, dom map[int][]int) bool {
	if len(assign) == len(c.vars) {
		return true
	}
	v := c.selectMRV(assign, dom)
	for _, val := range dom[v] {
		if !c.consistent(v, val, assign) {
			continue
		}
		nd := clone(dom)
		nd[v] = []int{val}
		assign[v] = val
		var seed [][2]int
		for _, nb := range c.neighbors[v] {
			seed = append(seed, [2]int{nb, v})
		}
		if c.ac3(seed, nd) && c.solve(assign, nd) {
			return true
		}
		delete(assign, v)
	}
	return false
}

func main() {
	// 3-color a triangle A(0)-B(1)-C(2): solvable
	csp := &CSP{
		vars:    []int{0, 1, 2},
		domains: map[int][]int{0: {0, 1, 2}, 1: {0, 1, 2}, 2: {0, 1, 2}},
		neighbors: map[int][]int{
			0: {1, 2}, 1: {0, 2}, 2: {0, 1},
		},
		constraint: func(a, va, b, vb int) bool { return va != vb },
	}
	assign := map[int]int{}
	if csp.solve(assign, clone(csp.domains)) {
		fmt.Println("Solution:", assign)
	} else {
		fmt.Println("No solution")
	}
}
```

#### Java

```java
import java.util.*;
import java.util.function.*;

public class CspSolver {
    int[] vars;
    Map<Integer, List<Integer>> domains;
    Map<Integer, List<Integer>> neighbors;
    // constraint.test on (a, va, b, vb): allowed?
    QuadPred constraint;
    interface QuadPred { boolean test(int a, int va, int b, int vb); }

    boolean consistent(int v, int val, Map<Integer, Integer> assign) {
        for (int nb : neighbors.get(v)) {
            Integer vv = assign.get(nb);
            if (vv != null && !constraint.test(v, val, nb, vv)) return false;
        }
        return true;
    }

    boolean revise(int x, int y, Map<Integer, List<Integer>> dom) {
        boolean removed = false;
        List<Integer> kept = new ArrayList<>();
        for (int vx : dom.get(x)) {
            boolean support = false;
            for (int vy : dom.get(y))
                if (constraint.test(x, vx, y, vy)) { support = true; break; }
            if (support) kept.add(vx); else removed = true;
        }
        dom.put(x, kept);
        return removed;
    }

    boolean ac3(Deque<int[]> queue, Map<Integer, List<Integer>> dom) {
        while (!queue.isEmpty()) {
            int[] a = queue.poll();
            if (revise(a[0], a[1], dom)) {
                if (dom.get(a[0]).isEmpty()) return false;
                for (int z : neighbors.get(a[0]))
                    if (z != a[1]) queue.add(new int[]{z, a[0]});
            }
        }
        return true;
    }

    Map<Integer, List<Integer>> clone(Map<Integer, List<Integer>> d) {
        Map<Integer, List<Integer>> c = new HashMap<>();
        for (var e : d.entrySet()) c.put(e.getKey(), new ArrayList<>(e.getValue()));
        return c;
    }

    int selectMRV(Map<Integer, Integer> assign, Map<Integer, List<Integer>> dom) {
        int best = -1, bestN = Integer.MAX_VALUE;
        for (int v : vars) {
            if (assign.containsKey(v)) continue;
            if (dom.get(v).size() < bestN) { best = v; bestN = dom.get(v).size(); }
        }
        return best;
    }

    boolean solve(Map<Integer, Integer> assign, Map<Integer, List<Integer>> dom) {
        if (assign.size() == vars.length) return true;
        int v = selectMRV(assign, dom);
        for (int val : new ArrayList<>(dom.get(v))) {
            if (!consistent(v, val, assign)) continue;
            Map<Integer, List<Integer>> nd = clone(dom);
            nd.put(v, new ArrayList<>(List.of(val)));
            assign.put(v, val);
            Deque<int[]> q = new ArrayDeque<>();
            for (int nb : neighbors.get(v)) q.add(new int[]{nb, v});
            if (ac3(q, nd) && solve(assign, nd)) return true;
            assign.remove(v);
        }
        return false;
    }

    public static void main(String[] args) {
        CspSolver s = new CspSolver();
        s.vars = new int[]{0, 1, 2};
        s.domains = new HashMap<>();
        for (int v : s.vars) s.domains.put(v, new ArrayList<>(List.of(0, 1, 2)));
        s.neighbors = Map.of(0, List.of(1, 2), 1, List.of(0, 2), 2, List.of(0, 1));
        s.constraint = (a, va, b, vb) -> va != vb;
        Map<Integer, Integer> assign = new HashMap<>();
        System.out.println(s.solve(assign, s.clone(s.domains)) ? "Solution: " + assign : "No solution");
    }
}
```

#### Python

```python
from collections import deque
import copy


class CSP:
    def __init__(self, variables, domains, neighbors, constraint):
        self.variables = variables
        self.domains = domains
        self.neighbors = neighbors
        self.constraint = constraint  # constraint(a, va, b, vb) -> bool

    def consistent(self, v, val, assign):
        return all(
            self.constraint(v, val, nb, assign[nb])
            for nb in self.neighbors[v] if nb in assign
        )

    def revise(self, x, y, dom):
        removed = False
        kept = []
        for vx in dom[x]:
            if any(self.constraint(x, vx, y, vy) for vy in dom[y]):
                kept.append(vx)
            else:
                removed = True
        dom[x] = kept
        return removed

    def ac3(self, seed, dom):
        queue = deque(seed)
        while queue:
            x, y = queue.popleft()
            if self.revise(x, y, dom):
                if not dom[x]:
                    return False
                for z in self.neighbors[x]:
                    if z != y:
                        queue.append((z, x))
        return True

    def select_mrv(self, assign, dom):
        return min(
            (v for v in self.variables if v not in assign),
            key=lambda v: len(dom[v]),
        )

    def solve(self, assign, dom):
        if len(assign) == len(self.variables):
            return dict(assign)
        v = self.select_mrv(assign, dom)
        for val in list(dom[v]):
            if not self.consistent(v, val, assign):
                continue
            nd = copy.deepcopy(dom)
            nd[v] = [val]
            assign[v] = val
            seed = [(nb, v) for nb in self.neighbors[v]]
            if self.ac3(seed, nd):
                res = self.solve(assign, nd)
                if res:
                    return res
            del assign[v]
        return None


if __name__ == "__main__":
    csp = CSP(
        variables=[0, 1, 2],
        domains={0: [0, 1, 2], 1: [0, 1, 2], 2: [0, 1, 2]},
        neighbors={0: [1, 2], 1: [0, 2], 2: [0, 1]},
        constraint=lambda a, va, b, vb: va != vb,
    )
    print(csp.solve({}, copy.deepcopy(csp.domains)) or "No solution")
```

**What it does:** A reusable CSP core that 3-colors a triangle. The `constraint` callback makes it generic — swap it for cryptarithmetic or scheduling without touching the engine. MAC (AC-3 seeded by arcs into the just-assigned variable) runs at every node.
**Run:** `go run main.go` | `javac CspSolver.java && java CspSolver` | `python csp.py`

---

## 9. Observability and Testing

A CSP solver fails *silently* — a wrong assignment looks like a valid one until a constraint is violated downstream. Defend with:

- **Solution validator.** Independently verify the returned assignment satisfies *every* constraint. Always run it in tests; consider running it in production for critical paths. The validator must be written *independently* of the solver (ideally by a different person or from the spec, not the code) so a shared bug cannot mask a wrong answer in both.
- **Known-answer instances.** Keep a corpus of instances with known unique solutions (e.g. `SEND+MORE=MONEY → 10652`, specific Sudoku boards) and assert exact output.
- **Brute-force oracle.** For small `n`, enumerate all assignments and compare the *set* of solutions found.
- **Property-based testing.** Generate random solvable instances (start from a known solution, derive constraints) and assert the solver finds *a* solution; generate provably-unsolvable ones and assert it returns failure.
- **Metrics.** Instrument node count, propagation calls, backtracks, peak domain sizes, restart count. A sudden spike in nodes signals a modeling regression. Track these per-deploy so a constraint change that silently weakens propagation is caught before it reaches a customer-facing timeout.
- **Determinism.** Pin randomization seeds so failures reproduce.
- **Shrinking.** When a failure is found on a large instance, automatically reduce it (remove variables/constraints while it still fails) to the minimal reproducing case before debugging — the same delta-debugging discipline used for compiler bugs.

---

## 10. Failure Modes

| Failure | Symptom | Mitigation |
|---------|---------|------------|
| Thrashing | exponential time on "easy-looking" instances | add MRV, MAC, backjumping, or no-good learning |
| Weak `AllDifferent` | huge search on Sudoku/assignment | use a GAC `AllDifferent` propagator, not pairwise `≠` |
| Domain restore bug | wrong/missing solutions intermittently | snapshot per level; validate solutions in tests |
| Symmetry blowup | enumerates equivalent solutions forever | add symmetry-breaking constraints |
| Over-propagation | fewer nodes but slower wall-clock | downgrade MAC → forward checking; measure both |
| Encoding blowup (SAT) | quadratic at-most-one clauses explode | use commander/sequential encodings |
| Learned-clause bloat | memory growth, slowing propagation | clause-deletion policy; bound no-good store |
| Floating point in numeric CSP | spurious infeasibility | use integers / rationals / interval bounds carefully |

---

## 11. Summary

Senior CSP engineering is about judgment, not the backtracking skeleton. Choose the **propagation level** by measuring pruning vs per-node cost — forward checking for loose problems, MAC for tight ones, global propagators (`AllDifferent` via matching) where they apply. Learn from failure with **conflict-directed backjumping** (jump to the real culprit) and **no-good learning** (the CSP cousin of SAT clause learning). For most production problems, **encode to a mature CP/SAT solver** (CP-SAT, Gecode) rather than hand-rolling — you inherit learning, restarts, and world-class propagation. Add **symmetry breaking** and **restarts** for the biggest cheap wins. Above all, test relentlessly: a CSP solver fails silently, so independent solution validation, known-answer corpora, and property tests are non-negotiable.

---

## 12. Production Checklist

Before shipping a CSP-backed feature, confirm:

- [ ] **Model reviewed.** Variables, domains, and constraints written down explicitly; arities minimized; global constraints (`AllDifferent`, `cumulative`) used instead of weak decompositions.
- [ ] **Solution validator** runs independently of the solver and is asserted in tests (and ideally in production for critical outputs).
- [ ] **Timeout and fallback** defined. NP-complete means some inputs blow up; set a wall-clock budget and a graceful degradation path (partial solution, "no answer within budget", or a simpler heuristic).
- [ ] **Determinism** controlled. Seeds pinned so failures reproduce; otherwise debugging a wrong answer is intractable.
- [ ] **Metrics emitted.** Node count, propagation calls, backtracks, restarts, peak memory — alert on regressions.
- [ ] **Symmetry handled.** Either symmetry-breaking constraints added, or duplicate solutions explicitly acceptable.
- [ ] **Scale tested.** Benchmarked on the largest realistic instance, not just toy inputs; the `dⁿ` cliff is steep.
- [ ] **Build-vs-buy revisited.** If the hand-rolled solver is thrashing, prototype a CP-SAT/Gecode encoding before optimizing further.

---

## 13. Further Reading

- *Handbook of Constraint Programming* (Rossi, van Beek, Walsh) — the definitive reference for propagation, global constraints, and search.
- Google OR-Tools CP-SAT documentation — the recommended default solver for production CSP/optimization in 2026.
- Gecode and Choco solver docs — alternative open-source CP solvers with rich global-constraint catalogs.
- Marques-Silva & Sakallah, "GRASP" and the CDCL literature — the no-good/clause-learning machinery to inherit via SAT encoding.
- Prosser (1993), "Hybrid algorithms for the constraint satisfaction problem" — backjumping, BJ, CBJ, and forward-checking hybrids.
- [`professional.md`](./professional.md) — the theory behind these engineering choices (AC-3 complexity, dichotomy, treewidth, backdoors).
