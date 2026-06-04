# Branch and Bound (B&B) for Optimization — Professional / Theoretical Level

> **Focus:** The formal branch-and-bound framework, a rigorous correctness/optimality proof (a node is pruned only when its bound *proves* it cannot contain a better solution), the role of admissible (optimistic) bounds, the precise relationship **B&B = A\* on the solution tree**, the LP-relaxation bound and the integrality gap, convergence, and why the worst case stays exponential.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Formal Framework](#formal-framework)
3. [The Bounding Function and Admissibility](#the-bounding-function-and-admissibility)
4. [Correctness and Optimality Proof](#correctness-and-optimality-proof)
5. [Branch and Bound as A* on the Solution Tree](#branch-and-bound-as-a-on-the-solution-tree)
6. [The LP Relaxation and the Integrality Gap](#the-lp-relaxation-and-the-integrality-gap)
7. [Convergence and Finite Termination](#convergence-and-finite-termination)
8. [Worst-Case Complexity](#worst-case-complexity)
9. [Code: A Generic B&B Framework](#code-a-generic-bb-framework)
10. [Theoretical Pitfalls](#theoretical-pitfalls)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)
13. [Further Reading](#further-reading)

---

## Introduction

Branch and bound is often taught as a bag of tricks. It is in fact a precise mathematical procedure with a clean correctness theorem and deep ties to informed search (A*) and integer programming. This file makes the framework formal, proves that pruning never loses the optimum, and situates B&B inside the broader theory of relaxations and admissible heuristics.

We treat **minimization** as the canonical form (maximization is the mirror image with signs flipped). Let the problem be

```
minimize   f(x)
subject to x ∈ S        (S = feasible region, finite or compact)
```

We seek `x* = argmin_{x ∈ S} f(x)` and the optimum `f* = f(x*)`.

---

## Formal Framework

A branch-and-bound algorithm is defined by four ingredients:

1. **Branching rule.** A way to partition a subproblem's feasible set `S_p` into finitely many subsets `S_{p,1}, …, S_{p,m}` with `S_p = ⋃_i S_{p,i}` and (ideally) `S_{p,i} ∩ S_{p,j} = ∅`. This induces a **search tree** whose root is `S` and whose nodes are subproblems `S_p`. Leaves are subproblems small enough to solve directly (e.g., all decisions fixed).

2. **Bounding function.** A function `g(S_p)` returning a **lower bound** on the best objective over `S_p`:
   ```
   g(S_p) ≤ min_{x ∈ S_p} f(x)        (for every subproblem S_p)        (★)
   ```
   This is the **admissibility** condition. `g` is typically obtained by solving a **relaxation** of the subproblem.

3. **Incumbent.** The best feasible solution found so far, with value `U` (an **upper bound** on `f*`). Initialize `U = +∞` or with a heuristic solution.

4. **Selection rule.** Which live (unexpanded) subproblem to process next: depth-first, best-first (smallest `g`), or other.

**The pruning (fathoming) rule.** A subproblem `S_p` is **fathomed** (discarded) if any of:

- **(by bound)** `g(S_p) ≥ U` — the subtree cannot beat the incumbent;
- **(by infeasibility)** `S_p = ∅` — no feasible solution exists below it;
- **(by optimality)** the relaxation's optimum is feasible for the original problem and updates `U`; the node is then fully resolved.

The algorithm processes live nodes, branching unfathomed ones and updating `U` whenever a better feasible solution appears, until no live nodes remain. It then returns the incumbent.

---

## The Bounding Function and Admissibility

The lower bound `g` usually comes from a **relaxation** `R(S_p)` of the subproblem: a problem with a *larger* feasible set or *smaller* objective, so that

```
min_{x ∈ R(S_p)} f(x)  ≤  min_{x ∈ S_p} f(x).
```

Any of the following is a relaxation that yields an admissible bound:

- **Constraint relaxation** — drop one or more constraints (fractional knapsack drops integrality; assignment-relaxation of TSP drops the "single cycle" constraint).
- **LP relaxation** — replace `x ∈ {0,1}` by `x ∈ [0,1]` (integer program → linear program).
- **Lagrangian relaxation** — move hard constraints into the objective with multipliers; the Lagrangian dual gives a lower bound (the 1-tree bound for TSP is Lagrangian).
- **Combinatorial bound** — a problem-specific argument (sum of cheapest out-edges for TSP).

**Admissibility (★) is the *only* property pruning correctness depends on.** Tightness affects *speed*, not *correctness*. A trivially admissible bound is `g(S_p) = −∞`, which prunes nothing and reduces B&B to exhaustive search; the *useful* bounds are those that are both admissible and close to the true subproblem optimum.

For **maximization** the mirror condition is `g(S_p) ≥ max_{x ∈ S_p} f(x)` (an admissible **upper** bound), and pruning fires when `g(S_p) ≤ U`, where `U` is the best (largest) value found so far.

---

## Correctness and Optimality Proof

**Theorem.** If the bounding function is admissible (satisfies (★)) and the branching rule partitions every subproblem into a finite cover, then branch and bound terminates and returns a global optimum `x*` with `f(x*) = f*`.

**Proof.**

*Termination.* The branching tree is finite: each branch fixes additional structure (e.g., one more variable), and after finitely many branches a subproblem is a leaf solved directly. Every node is either branched (finitely many children) or fathomed, so the number of processed nodes is finite. ∎ (termination)

*Optimality — the key lemma.* We show **no fathomed subproblem contains a solution strictly better than the incumbent the algorithm finally returns.** Let `U*` be the incumbent value at termination (the value returned). Consider any subproblem `S_p` fathomed during the run, fathomed when the incumbent value was `U_p ≥ U*` is *not* assumed; instead reason at the moment of fathoming with incumbent value `U_p`.

Three fathoming cases:

1. **Fathomed by infeasibility:** `S_p = ∅`, so it contains no feasible solution at all — certainly none better than `U*`.

2. **Fathomed by optimality:** the subproblem was solved exactly and its optimum was used to (possibly) update the incumbent. Its best solution was accounted for; nothing better remains unexamined in `S_p`.

3. **Fathomed by bound:** at fathoming time `g(S_p) ≥ U_p`. By admissibility (★), for every `x ∈ S_p`,
   ```
   f(x) ≥ min_{y ∈ S_p} f(y) ≥ g(S_p) ≥ U_p ≥ U*,
   ```
   where the last inequality holds because the incumbent value is **monotonically non-increasing** over time (it only updates to *better*, i.e. smaller, values), so the value `U_p` at the earlier fathoming time is `≥` the final value `U*`. Hence **every** `x ∈ S_p` has `f(x) ≥ U*`: the subtree contains nothing strictly better than what we return.

*Conclusion.* The root's feasible set `S` is the disjoint union of (a) the regions of fathomed subproblems and (b) the solutions explicitly evaluated as incumbents. By the lemma, no fathomed region holds a solution beating `U*`, and every explicitly evaluated solution is `≥ U*` by definition of the incumbent. Therefore no feasible solution beats `U*`, so `U* = f*` and the returned `x*` is a global optimum. ∎

The proof pinpoints the **load-bearing fact**: a node is pruned by bound only when its **admissible** bound is no better than the incumbent, and the incumbent only improves over time. Drop admissibility and case 3 collapses — B&B can fathom the region containing `x*`.

---

## Branch and Bound as A* on the Solution Tree

Best-first branch and bound is **exactly A\* search on the solution tree**, with the bound playing the role of A*'s evaluation function `f(n) = g(n) + h(n)`.

| A* search | Branch and bound (best-first) |
|-----------|-------------------------------|
| Node `n` in the search graph | Subproblem `S_p` in the branching tree |
| `g(n)` = cost from start to `n` | cost of decisions fixed so far on the path to `S_p` |
| `h(n)` = heuristic estimate of cost-to-go | relaxation bound on the *remaining* (free) decisions |
| `f(n) = g(n) + h(n)` = estimated total | the lower bound `g(S_p)` on a complete solution through `S_p` |
| **Admissible heuristic:** `h(n) ≤ h*(n)` (never overestimates) | **Admissible bound:** `g(S_p) ≤ min f` over the subtree (never overestimates) |
| Priority queue ordered by `f(n)`, expand smallest | live set ordered by bound, expand smallest (best-first) |
| Goal node popped ⇒ optimal path found | first complete feasible solution popped ⇒ optimal (best-first with admissible bound) |

The correspondence is tight enough to be an identity: **A\* is best-first branch and bound on a shortest-path solution tree, and the admissibility of A*'s heuristic is precisely the admissibility of B&B's bound.** Consequences carried over from A* theory:

- With an **admissible** (optimistic) bound, best-first B&B is *optimal*: the first leaf it removes from the frontier is a global optimum.
- A **consistent / monotone** bound (`g` non-decreasing along any root-to-leaf path, the analogue of A*'s consistency) means a node never needs re-expansion — bounds tighten monotonically downward.
- A *tighter* admissible bound (closer to `h*`) expands no more nodes than a looser one — the A* dominance theorem. This is the theoretical justification for investing in tight bounds.

Depth-first B&B corresponds to **IDA\*-style / depth-first branch-and-bound (DFBnB)**: bounded depth-first search that uses the incumbent as the cost threshold, trading A*'s memory for re-exploration.

---

## The LP Relaxation and the Integrality Gap

For a 0/1 (or general integer) linear program

```
max  cᵀx   s.t.  Ax ≤ b,  x ∈ {0,1}ⁿ        (IP)
```

the **LP relaxation** drops integrality:

```
max  cᵀx   s.t.  Ax ≤ b,  x ∈ [0,1]ⁿ         (LP)
```

Because the LP's feasible region *contains* the IP's, `z_LP ≥ z_IP` (for maximization): **the LP optimum is an admissible upper bound** on the integer optimum. This is the bound used by branch-and-cut MILP solvers. Branching picks a variable `x_j` that is fractional in the LP solution and creates two children: `x_j = 0` and `x_j = 1` (or `x_j ≤ ⌊v⌋` and `x_j ≥ ⌈v⌉` for general integers). Each child re-solves its LP for a tighter bound.

The **integrality gap** measures how loose this bound is:

```
integrality gap = z_LP / z_IP   (max)      or   z_IP / z_LP   (min, ≥ 1)
```

- A gap of **1** means the LP relaxation is *integral* — the LP optimum is already integer (e.g., problems with **totally unimodular** constraint matrices: assignment, min-cost flow, bipartite matching). For these, no branching is needed; the LP solves the IP directly. This is why the assignment problem is polynomial.
- A gap **> 1** quantifies the slack B&B must close by branching. The larger the gap, the more the LP bound overestimates and the more nodes B&B explores. The famous example: the LP relaxation of vertex cover has integrality gap approaching 2.
- **Cutting planes** (branch-and-cut) add valid inequalities that *shrink* the gap by tightening the LP feasible region toward the integer hull, strengthening the bound without removing integer points.

For the fractional-knapsack bound used throughout these files: it is precisely the LP relaxation of the 0/1 knapsack, whose optimum has at most **one** fractional variable (a basic feasible solution of a single-constraint LP), giving the "take whole items by ratio, then a fraction of the next" formula.

---

## The Optimality Gap as a Certificate

The pair `(L, U)` maintained by B&B is not just a stopping criterion — it is a *verifiable certificate* of solution quality, which distinguishes B&B from local-search heuristics.

At any point in the run, with `L ≤ f* ≤ U`, the algorithm can output: "the returned solution has value `U`, and no feasible solution has value below `L`." A skeptical third party can verify both halves independently — `U` by checking the returned solution is feasible with that objective, and `L` by checking the relaxation bounds are admissible. This is a *primal–dual certificate*: `U` is a primal witness (an actual solution), `L` is a dual witness (a bound from the relaxation/dual). When `L = U`, the certificate proves global optimality with no appeal to "we tried hard and found nothing better."

Contrast with heuristics (simulated annealing, genetic algorithms, local search): they return a solution but *no lower bound*, so they cannot certify how far from optimal they are. B&B's signature theoretical contribution is precisely this two-sided guarantee. In practice this is why MILP solvers report both numbers throughout: the gap is a contract the solver offers the caller, checkable and honest, available at every instant — not only at termination.

---

## Convergence and Finite Termination

For **finite** feasible sets (combinatorial problems like knapsack, TSP, assignment), B&B terminates in finitely many steps as proven above, regardless of selection rule.

For **continuous / spatial** B&B (global optimization over a box in `ℝⁿ`), the tree can be infinite, and convergence requires:

- **Consistency of the branching:** subproblems shrink to points (e.g., box subdivision with diameter → 0).
- **Bound convergence:** the bounding gap `(upper − lower)` on a region → 0 as the region shrinks, i.e., `g(S_p) → min f` as `diam(S_p) → 0`.

Under these conditions spatial B&B converges to a global `ε`-optimum: terminate a region when `(U − g(S_p)) ≤ ε`. The **optimality gap** `(U − L)`, where `L = min over live nodes of g`, is a *certificate*: at any time `L ≤ f* ≤ U`, so the incumbent is provably within `(U − L)` of optimal — the basis of anytime termination (see [`senior.md`](./senior.md)).

---

## Strengthening Bounds: Lagrangian Duality and Cutting Planes

Two systematic techniques produce bounds far tighter than a naive relaxation, and both have clean theoretical justifications.

**Lagrangian relaxation.** Partition the constraints into "easy" and "hard". Move the hard constraints `Cx ≤ d` into the objective with a vector of multipliers `λ ≥ 0`:

```
L(λ) = min_{x ∈ easy} [ f(x) + λᵀ(Cx − d) ].
```

For any `λ ≥ 0`, `L(λ)` is a valid **lower bound** on the original optimum (relaxing constraints into a penalized objective can only decrease the minimum). The **Lagrangian dual** maximizes the bound over multipliers, `max_{λ ≥ 0} L(λ)`, which is solved by subgradient ascent. The TSP **1-tree bound** is exactly this construction: the "easy" problem is a minimum 1-tree, the "hard" constraint is "every vertex has degree 2", and the multipliers are per-vertex node weights adjusted so the 1-tree's degree sequence approaches a tour's. Weak duality guarantees admissibility; the duality gap quantifies how much the bound can be sharpened.

**Cutting planes.** A valid inequality is one satisfied by every *integer* feasible point but violated by the current fractional LP optimum. Adding it removes the fractional point without removing any integer solution, so the LP optimum (the bound) strictly tightens. Gomory fractional cuts (derived algebraically from the LP simplex tableau) are always available; problem-specific families — cover inequalities for knapsack, subtour-elimination and comb inequalities for TSP — are stronger. **Branch-and-cut** interleaves branching with cut generation: at each node, generate cuts to tighten the LP bound before deciding whether to branch. This is the engine inside every modern MILP solver and the practical reason large integer programs are solvable at all.

The theoretical hierarchy is: combinatorial bound ≤ LP-relaxation bound ≤ LP-with-cuts bound ≤ Lagrangian-dual bound ≤ true optimum (orderings depend on the problem, but each step trades compute for tightness, and tighter admissible bounds never expand more nodes — the A* dominance theorem from the previous section).

---

## The Dual Role of Lower and Upper Bounds

A complete B&B run maintains *two* bounds on the optimum simultaneously, and their convergence is the whole story:

- The **incumbent** `U` is an achievable feasible value, hence an **upper bound** on the minimum: `f* ≤ U`. It is produced by *primal* activity — actually finding solutions (leaves, heuristics, rounding).
- The **global lower bound** `L = min over live nodes of g(S_p)` is the best optimistic estimate still in play: `L ≤ f*`. It is produced by *dual* activity — relaxations and bounds.

At every instant `L ≤ f* ≤ U`, so the algorithm *brackets* the optimum. The run is complete precisely when `L = U`. Good B&B engineering pushes both ends toward each other: heuristics drive `U` down (better incumbents earlier), tighter relaxations and cuts drive `L` up. This primal–dual view explains why MILP solvers report two numbers throughout a run and why the gap `(U − L)` is a *certificate* a caller can trust even before termination.

---

## Worst-Case Complexity

B&B does **not** improve the worst-case complexity class. For NP-hard problems (knapsack, TSP, general IP) the worst case remains exponential:

- An adversary can choose an instance where the bound prunes *nothing* — e.g., all knapsack items with identical value/weight ratio make the fractional bound equal at every node, fathoming none. Then B&B explores all `2^n` nodes.
- For TSP, instances exist where the reduced-cost / 1-tree bound is loose throughout, forcing near-`O(n!)` exploration.

Formally: unless **P = NP**, no bounding function computable in polynomial time can guarantee polynomially many fathomed-by-bound nodes across all instances (otherwise B&B would be a polynomial exact algorithm for an NP-hard problem). B&B is an *exact* method with **average-case** and **structure-dependent** speedups, not a complexity-class breakthrough. Its value is empirical: on realistic, non-adversarial instances, good bounds prune the vast majority of the tree.

---

## Probabilistic and Average-Case Analysis

Worst-case analysis (next section) is pessimistic; B&B's reputation rests on its *average-case* behavior, which has a real theoretical literature:

- **Expected node count under random inputs.** For some problem families with random costs, the expected number of nodes B&B explores is *polynomial* or even constant-factor, even though the worst case is exponential. Intuitively, with random costs the bound separates good and bad subtrees cleanly, so most subtrees are fathomed near the root. The distribution of inputs matters enormously: uniform random costs are "easy", while structured/adversarial costs (equal ratios, metric clustering) are hard.
- **Phase transitions.** Like SAT and other NP-hard problems, B&B difficulty exhibits *phase transitions*: instances are easy when under- or over-constrained and hardest at a critical constraint density where the LP bound is least informative. Production instances clustering near the critical region explains sudden difficulty spikes.
- **The bound as a random variable.** Treat `g(S_p)` as an estimator of the subtree optimum; the *variance* of the bound across nodes predicts pruning quality. A bound with low bias and low variance fathoms reliably; a high-variance bound occasionally fails to prune subtrees that contain nothing good, inflating the tree.
- **No distribution-free polynomial guarantee.** Average-case polynomiality is always *relative to an input distribution*. There is no distribution-free polynomial bound (that would imply P = NP), which is why empirical benchmarking on representative instances — not asymptotic analysis — governs engineering decisions.

The practical takeaway from the theory: characterize *your* input distribution, benchmark on it, and keep adversarial samples for regression. Asymptotics describe the worst case; your workload lives in the average case.

---

## Code: A Generic B&B Framework

A reusable skeleton parameterized by branch / bound / is-leaf / objective. Specialized here to minimization.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
)

// A generic best-first B&B framework (minimization).
type State interface {
	Bound() float64        // admissible LOWER bound on this subtree's optimum
	IsComplete() bool      // is this a full feasible solution?
	Objective() float64    // objective value (valid when IsComplete)
	Children() []State     // branching
}

type pq struct{ items []State }

func (p pq) Len() int           { return len(p.items) }
func (p pq) Less(i, j int) bool { return p.items[i].Bound() < p.items[j].Bound() } // min-bound first
func (p pq) Swap(i, j int)      { p.items[i], p.items[j] = p.items[j], p.items[i] }
func (p *pq) Push(x any)        { p.items = append(p.items, x.(State)) }
func (p *pq) Pop() any {
	n := len(p.items)
	it := p.items[n-1]
	p.items = p.items[:n-1]
	return it
}

func BranchAndBound(root State) (float64, bool) {
	frontier := &pq{}
	heap.Init(frontier)
	heap.Push(frontier, root)
	best := 1e18
	found := false
	for frontier.Len() > 0 {
		s := heap.Pop(frontier).(State)
		if s.Bound() >= best { // fathom by bound (admissible ⇒ safe)
			continue
		}
		if s.IsComplete() {
			if s.Objective() < best {
				best = s.Objective()
				found = true
			}
			continue
		}
		for _, c := range s.Children() {
			if c.Bound() < best {
				heap.Push(frontier, c)
			}
		}
	}
	return best, found
}

func main() {
	// Plug in a concrete State (knapsack/TSP/assignment) to use this driver.
	fmt.Println("generic B&B framework ready")
}
```

#### Java

```java
import java.util.*;

public class GenericBnB {
    interface State {
        double bound();        // admissible LOWER bound (minimization)
        boolean isComplete();
        double objective();
        List<State> children();
    }

    static double branchAndBound(State root) {
        PriorityQueue<State> frontier =
            new PriorityQueue<>(Comparator.comparingDouble(State::bound));
        frontier.add(root);
        double best = Double.POSITIVE_INFINITY;
        while (!frontier.isEmpty()) {
            State s = frontier.poll();
            if (s.bound() >= best) continue;          // fathom by bound
            if (s.isComplete()) {
                best = Math.min(best, s.objective());
                continue;
            }
            for (State c : s.children())
                if (c.bound() < best) frontier.add(c); // prune on push
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println("generic B&B framework ready");
    }
}
```

#### Python

```python
import heapq
import itertools


def branch_and_bound(root):
    """Generic best-first B&B (minimization).

    A State must expose: bound(), is_complete(), objective(), children().
    """
    counter = itertools.count()                  # tie-break, keep heap stable
    frontier = [(root.bound(), next(counter), root)]
    best = float("inf")
    best_state = None
    while frontier:
        b, _, s = heapq.heappop(frontier)
        if b >= best:                            # fathom by bound (admissible)
            continue
        if s.is_complete():
            if s.objective() < best:
                best, best_state = s.objective(), s
            continue
        for c in s.children():
            if c.bound() < best:                 # prune on push
                heapq.heappush(frontier, (c.bound(), next(counter), c))
    return best, best_state


if __name__ == "__main__":
    print("generic B&B framework ready")
```

**What it does:** a selection-rule-driven best-first B&B engine; supply a `State` with an *admissible* `bound()` and the driver guarantees a global optimum. Swapping `<`/`>` and the heap order converts it to maximization.
**Run:** `go run main.go` | `javac GenericBnB.java && java GenericBnB` | `python bnb.py`

---

## Selection Rules and Their Theoretical Guarantees

The order in which live nodes are expanded does not affect *correctness* (the optimality theorem holds for any selection rule that eventually processes every unfathomed node), but it affects which nodes get fathomed and therefore the total work. Three canonical rules, with their guarantees:

- **Best-first (least lower bound).** Expand the live node with the smallest `g(S_p)`. This is provably *node-optimal* among algorithms using the same bound: no other strategy can fathom-by-bound a node that best-first expands, because best-first only expands a node when its bound is below the eventual optimum. Equivalently (the A* result): best-first with an admissible bound expands no node whose bound exceeds `f*`, and a *consistent* bound guarantees each node is expanded at most once. Cost: the live set can be exponential.
- **Depth-first.** Expand the most recently created child. Memory is `O(depth)`. It may expand nodes with `g(S_p) > f*` that best-first would have fathomed (because the incumbent has not yet tightened), so its node count can exceed best-first's — but never by more than a factor tied to how late the optimal incumbent is discovered. Depth-first reaches *some* leaf quickly, producing an incumbent that retroactively justifies fathoming.
- **Cyclic / hybrid (DFBnB).** Depth-first branch-and-bound uses the incumbent as a running threshold; iterative-deepening variants (IDA*) re-run with increasing thresholds to mimic best-first order at `O(depth)` memory, paying with re-exploration. The total re-exploration overhead is bounded when the number of distinct bound values is small.

A theorem worth stating precisely (Ibaraki, and the A* dominance theorem): *given the same admissible bounding function, a best-first strategy expands a subset of the nodes any other strategy expands (up to tie-breaking on nodes with `g(S_p) = f*`).* This is the formal reason best-first is "node-optimal" and why its only drawback is memory.

---

## Relation to Dynamic Programming and State-Space Search

B&B and dynamic programming are two attacks on the same combinatorial optima, and the theory clarifies when each dominates:

- **DP exploits overlapping subproblems** via a *state* that summarizes a partial solution, memoizing each state once. Its complexity is `O(#states × transitions)` — polynomial when the state space is polynomial (knapsack with state `(index, remaining_capacity)` → `O(nW)`), exponential otherwise (Held–Karp TSP state `(subset_visited, last_city)` → `O(2ⁿ n²)`).
- **B&B exploits bounds** to avoid *generating* large parts of the tree, but does not memoize — it may revisit equivalent partial solutions on different paths unless augmented with dominance rules.
- **The unifying view:** both search the same implicit graph of subproblems. DP collapses it by *state equivalence*; B&B prunes it by *optimistic bounds*. They compose: **memoized B&B** (a.k.a. branch-and-bound with dominance / DP-bounded B&B) caches states *and* prunes by bound, dominating either alone when both structures are present. The knapsack LP-bound B&B with a `(index, capacity)` dominance check is exactly such a hybrid.

The choice is structural: if the state space is small, DP's guaranteed polynomial bound beats B&B's data-dependent pruning; if the state space is astronomically large but a tight bound exists, B&B wins. When both hold, combine them.

---

## Inadmissible Bounds and Bounded Suboptimality

Admissibility is required for *exact* optimality, but the theory also characterizes what happens when you deliberately weaken it for speed — the analogue of weighted A*.

Suppose the bound is *not* a true relaxation but an estimate `ĝ(S_p)` that may *overestimate* the subtree minimum by a factor up to `(1 + ε)`:

```
g(S_p) ≤ min_{x ∈ S_p} f(x) ≤ (1 + ε) · g(S_p)   — admissible only up to (1+ε).
```

Pruning with such an inflated bound (prune when `ĝ ≥ U`) can discard subtrees whose true optimum is below `U` but whose inflated estimate is not. The consequence is *bounded suboptimality*: **the returned solution is provably within a factor `(1 + ε)` of the true optimum**, traded for a smaller tree. This is exactly weighted A* / `ε`-admissible search: inflating the heuristic by `(1 + ε)` yields solutions within `(1 + ε)` of optimal while expanding far fewer nodes.

Two practical instances:

- **MIP gap tolerance** (`MIPGap = ε`): stop when `(U − L)/|U| ≤ ε`, returning a solution proven within `ε` of optimal. This is *admissible-bound pruning with an early-stop tolerance*, not an inflated bound — it preserves the bracket `L ≤ f* ≤ U` and reports the true gap.
- **Inflated/heuristic bounds**: deliberately using a tighter-but-possibly-inadmissible estimate to prune harder, accepting an `(1+ε)`-approximation. Useful when even exact B&B is too slow and a guaranteed-near-optimal answer suffices.

The theory cleanly separates the two regimes: an *admissible* bound with an *early-stop tolerance* still certifies a true gap; an *inflated* bound certifies only an approximation ratio. Knowing which you have is essential to stating the guarantee honestly to a caller.

---

## Theoretical Pitfalls

- **Non-admissible bound** breaks the optimality theorem (case 3 of the proof) — the optimum can be fathomed. The single non-negotiable requirement.
- **Non-monotone incumbent** — if the incumbent could ever get *worse*, the inequality `U_p ≥ U*` in the proof fails. Always update to strictly-better values only.
- **Equality in the prune test.** Fathoming when `g(S_p) = U` discards solutions that *tie* the incumbent. Correct if you only need *one* optimal solution; if you must enumerate *all* optima, prune only when `g(S_p) > U`.
- **Confusing relaxation direction.** The relaxation must *enlarge* the feasible set / *weaken* the objective; an accidental *restriction* gives an inadmissible bound.
- **Assuming polynomial behavior.** No admissible polynomial bound makes an NP-hard problem polynomial; worst case stays exponential unless P = NP.
- **Integrality gap blindness.** A large LP integrality gap predicts heavy branching; cutting planes, not just branching, are needed to make hard IPs tractable.
- **Confusing a tolerance stop with an inflated bound.** An admissible bound with an early-stop tolerance certifies a *true* gap `(U − L)`; an inflated/inadmissible bound certifies only an *approximation ratio*. Reporting the wrong one misleads the caller about solution quality.
- **Ignoring tie-handling.** Pruning on `g(S_p) = U` is correct for finding one optimum but silently drops alternative optima; if enumeration of all optima is required, prune only on strict inequality.

---

## Formal Statement of the Knapsack LP Bound

To ground the abstract theory, here is the precise derivation of the fractional bound used throughout these files, as the LP relaxation of the 0/1 knapsack.

The 0/1 knapsack integer program is:

```
max  Σ_j v_j x_j   s.t.  Σ_j w_j x_j ≤ W,   x_j ∈ {0,1}.
```

Its LP relaxation replaces `x_j ∈ {0,1}` with `0 ≤ x_j ≤ 1`. **Theorem (Dantzig).** An optimal solution of the knapsack LP is obtained by sorting items so that `v_1/w_1 ≥ v_2/w_2 ≥ …`, setting `x_j = 1` for a prefix `j = 1..k`, `x_j = 0` for `j > k+1`, and `x_{k+1} = (W − Σ_{j≤k} w_j) / w_{k+1}` for the single "break" item that straddles the capacity.

*Proof sketch.* The LP has one nontrivial constraint, so a basic optimal solution has at most one fractional variable. An exchange argument shows that swapping any value from a lower-ratio item into a higher-ratio one never decreases the objective while respecting capacity; hence the optimum fills greedily in ratio order. ∎

Consequences relevant to B&B:

- The LP optimum is an **upper bound** on the 0/1 optimum (the LP feasible region contains the integer one) — admissibility, for free.
- There is **at most one fractional variable**, the break item; this is exactly the "fraction of the next item" term in the bound formula. Branching on this fractional variable (`x_{k+1} = 0` vs `x_{k+1} = 1`) is the LP-relaxation branching of Task 15 in [`tasks.md`](./tasks.md).
- The **integrality gap** of knapsack is the difference between this LP value and the integer optimum, lost precisely because forcing the break item to 0 or 1 sacrifices the fractional value. A small gap means B&B converges in few nodes; a large gap (e.g., one huge item that nearly fills `W`) forces more branching.

This is the cleanest concrete instance of the general LP-relaxation theory above: a one-constraint LP whose structure makes both the bound and the branching variable explicit.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The solution tree with each node's admissible bound and the incumbent
> - Fathoming-by-bound (`bound ≥ incumbent` for min, `≤` for max) crossing out subtrees
> - The best-first frontier ordered by bound — the A* correspondence in action
> - The optimality gap `(U − L)` shrinking toward 0, the convergence certificate

---

## Why Maximization and Minimization Are the Same Theorem

It is worth stating formally that the maximization and minimization forms are not two algorithms but one, related by a sign flip — a fact the proofs above use implicitly.

Given a maximization problem `max f(x)` over `S`, define `f'(x) = −f(x)`. Then `max_{x∈S} f(x) = −min_{x∈S} f'(x)`. An admissible **upper** bound `h` for `f` (i.e., `h(S_p) ≥ max_{x∈S_p} f(x)`) becomes an admissible **lower** bound `−h` for `f'` (i.e., `−h(S_p) ≤ min_{x∈S_p} f'(x)`). The pruning rule "prune when `h(S_p) ≤ U`" (max, incumbent `U` a lower bound on the max) maps exactly to "prune when `−h(S_p) ≥ −U`" (min, incumbent `−U` an upper bound on the min). The optimality theorem, the A* correspondence, and the convergence analysis all transfer verbatim under this transformation.

This is why the canonical presentation (minimization, lower bounds, prune when `bound ≥ incumbent`) loses no generality, and why implementation bugs so often come from mixing the two conventions in one codebase. The disciplined approach: pick *one* convention internally (minimization is standard in the optimization literature), and adapt at the boundary by negating the objective for maximization inputs. The single inequality that must stay correct is admissibility in the chosen direction; everything else is bookkeeping around that one fact.

---

## Summary

Formally, branch and bound is defined by a branching rule (partition the feasible set into a finite cover), an **admissible bounding function** `g` (a relaxation giving `g(S_p) ≤ min_{x∈S_p} f(x)`), a monotonically improving **incumbent** `U`, and a selection rule. Its correctness theorem rests on one inequality: a node fathomed by bound satisfies `f(x) ≥ g(S_p) ≥ U ≥ U*` for all `x` in it, so the optimum is never discarded — admissibility is the sole load-bearing assumption, and tightness only affects speed. Best-first B&B is **literally A\*** on the solution tree, with the bound as the admissible heuristic, inheriting A*'s optimality and tight-heuristic dominance results. The **LP relaxation** is the canonical bound for integer programs; the **integrality gap** measures its slack and predicts branching effort, which cutting planes reduce. Convergence is guaranteed for finite (combinatorial) problems and, under shrinking-bound conditions, for continuous ones — yet the worst case remains exponential, because no polynomial admissible bound can defeat NP-hardness unless P = NP.

---

## Spatial Branch and Bound for Continuous Global Optimization

The framework extends beyond combinatorial problems to **continuous, non-convex** global optimization — minimizing a non-convex `f` over a box `[l, u] ⊂ ℝⁿ`. Here the feasible set is uncountable, so branching subdivides *space* rather than fixing discrete decisions:

- **Branching = box subdivision.** Split the current box along some coordinate at a chosen point (often the midpoint, or the point of maximum bound violation), producing two sub-boxes whose union is the parent. The tree can be infinite, so termination requires an `ε`-tolerance.
- **Bounding = convex relaxation.** Replace the non-convex `f` and constraints by a *convex underestimator* over the box (e.g., the αBB convex relaxation, McCormick envelopes for bilinear terms, or interval arithmetic). The convex relaxation is solved to global optimality (convex problems are tractable), giving a valid lower bound `g(box)`.
- **Convergence condition.** The relaxation must be *exact in the limit*: as `diam(box) → 0`, the underestimator gap `(f − underestimator) → 0`. Under this consistency, the bound converges to the true value on shrinking boxes, and spatial B&B converges to a global `ε`-optimum in finitely many subdivisions.
- **Certificate.** As in the discrete case, `L ≤ f* ≤ U` holds throughout (`L` = min relaxation bound over live boxes, `U` = best feasible point), so the run can stop when `U − L ≤ ε` with a *proven* global-optimality guarantee — a property local optimizers (gradient descent, Newton) cannot offer.

This is the engine of global MINLP solvers (BARON, Couenne, SCIP). It demonstrates that B&B is not a knapsack/TSP trick but a *general meta-algorithm*: supply a branching rule, an admissible bound from a relaxation, and an incumbent, and the optimality theorem and convergence analysis above apply verbatim — whether the decisions are binary, integer, or real.

---

## Further Reading

- Land & Doig (1960) — the original branch-and-bound paper for integer programming.
- Little, Murty, Sweeney & Karel (1963) — branch and bound for the TSP (reduced-cost matrix).
- Held & Karp — the 1-tree / Lagrangian bound for TSP.
- Hart, Nilsson & Raphael (1968) — A* and admissible heuristics (the search-theory mirror of B&B).
- Nemhauser & Wolsey, *Integer and Combinatorial Optimization* — LP relaxation, cutting planes, integrality gap.
- Papadimitriou & Steiglitz, *Combinatorial Optimization* — relaxations and B&B theory.
- Sibling section `15-np-hard` — NP-hardness of knapsack and TSP; sibling `12-dynamic-programming` — Held–Karp DP.
- Ibaraki, T. — *Enumerative Approaches to Combinatorial Optimization* — formal selection-rule dominance results.
- Geoffrion & Marsten (1972) — a unifying framework for branch-and-bound integer programming.
- Wolsey, *Integer Programming* — branch-and-cut, cover inequalities, and the integrality gap in depth.
- Horst & Tuy, *Global Optimization* — spatial branch-and-bound and convex underestimators for non-convex problems.
- Pearl, *Heuristics* — A*, admissibility, consistency, and the heuristic dominance theorem that mirrors B&B bound tightness.
