# Constraint Satisfaction Problems (CSP) — Middle Level

> **Focus:** The heuristics and propagation that turn exponential backtracking into a practical solver — **MRV**, the **degree** heuristic, **LCV**, **forward checking**, **AC-3 arc consistency**, and **MAC** (maintaining arc consistency) — illustrated with map coloring and the `SEND + MORE = MONEY` cryptarithmetic puzzle.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Variable Ordering: MRV and Degree](#variable-ordering-mrv-and-degree)
4. [Value Ordering: LCV](#value-ordering-lcv)
5. [Constraint Propagation: Forward Checking](#constraint-propagation-forward-checking)
6. [AC-3 Arc Consistency](#ac-3-arc-consistency)
7. [Maintaining Arc Consistency (MAC)](#maintaining-arc-consistency-mac)
8. [Cryptarithmetic: SEND + MORE = MONEY](#cryptarithmetic-send--more--money)
9. [Comparison of Techniques](#comparison-of-techniques)
10. [Code Examples](#code-examples)
11. [Error Handling](#error-handling)
12. [Performance Analysis](#performance-analysis)
13. [Best Practices](#best-practices)
14. [Visual Animation](#visual-animation)
15. [Summary](#summary)

---

## Introduction

At junior level the message was: a CSP is variables/domains/constraints, and backtracking try/recurse/undo solves it. That works, but on anything non-trivial it is exponential and slow. The middle-level skill is knowing the small set of *general* techniques that make backtracking actually fast:

- **Which variable do I branch on next?** → MRV (minimum remaining values), tie-broken by the degree heuristic.
- **Which value do I try first?** → LCV (least constraining value).
- **How much do I look ahead before committing?** → forward checking (cheap) or full arc consistency via AC-3 (more thorough).
- **How do I combine search with propagation?** → MAC (maintaining arc consistency): run AC-3 at every node.

The crucial insight is that these are *problem-independent*. The same MRV/LCV/AC-3 code that colors a map also solves Sudoku, schedules exams, and cracks cryptarithmetic puzzles. You write the model once and let the general machinery do the heavy lifting. This file explains each technique, shows how they interact, and works the famous `SEND + MORE = MONEY` puzzle end to end.

---

## Deeper Concepts

### Consistency is local; solutions are global

A consistency check asks "does this value break any constraint with what's already assigned?" — a *local* test. A solution requires *global* consistency: every constraint satisfied simultaneously. The art of CSP solving is using cheap local reasoning (propagation) to avoid expensive global search.

### Two axes of choice

Backtracking has exactly two decisions at each node:

1. **Variable ordering** — which unassigned variable to branch on. This is a *commitment* choice: you must eventually assign all of them, so the only question is *order*, and a good order prunes the tree dramatically.
2. **Value ordering** — which value to try first. This only matters when a solution exists on this branch; trying a "good" value first means you find the solution sooner. (If the branch has no solution, value order is irrelevant — you'll try them all.)

### Propagation levels

Think of a spectrum of how much you reason before committing:

```
none            → blind backtracking (check only against assigned vars)
forward check   → prune direct neighbors of the just-assigned variable
AC-3 / MAC      → prune until the whole network is arc-consistent
path / k-consistency → stronger, more expensive (see professional.md)
```

More propagation = fewer nodes explored, but each node costs more. The sweet spot is problem-dependent; MAC (AC-3 at every node) is the common default for hard CSPs.

---

## Variable Ordering: MRV and Degree

### MRV (Minimum Remaining Values)

Choose the unassigned variable with the **fewest legal values remaining** in its current domain. Also called "most constrained variable" or "fail-first."

Why fail-first? If a variable has only one legal value left, assigning anything else is pointless; assigning that value may trigger a cascade of further reductions. If a variable is *already* doomed (its domain will soon be empty), MRV finds that failure *high* in the tree where the subtree you prune is small, instead of *deep* where you've wasted enormous effort.

```
selectMRV(unassigned, domains):
    return argmin over v in unassigned of |domains[v]|
```

MRV is the single most effective ordering heuristic. On the N-Queens CSP it can reduce nodes explored by orders of magnitude.

### Degree heuristic (tie-breaker)

MRV ties are common at the start (all domains equal size). Break ties with the **degree heuristic**: pick the variable involved in the most constraints with *still-unassigned* variables. This variable, once assigned, prunes the most other domains, again front-loading the constraint pressure.

```
degree(v) = number of constraints between v and unassigned variables
```

Use degree as the primary heuristic *only* before any assignment (when MRV can't discriminate); afterward MRV usually dominates with degree as the tiebreaker.

---

## Value Ordering: LCV

### LCV (Least Constraining Value)

For the chosen variable, order its values so you try the one that **rules out the fewest choices for neighboring variables** first. This is "fail-last" on values: leave maximum flexibility so a solution, if one exists on this branch, is reached without backtracking.

```
for each value v in domain(X):
    count = number of values eliminated from neighbors' domains if X = v
order values by ascending count   # least constraining first
```

LCV pays off when you only need *one* solution. If you need *all* solutions (or are proving unsatisfiability), value order doesn't matter — you visit every value anyway — so skip LCV's overhead in those cases.

The MRV/degree (variable) and LCV (value) heuristics pull in opposite directions on purpose: choose the *most* constrained variable but the *least* constraining value.

---

## Constraint Propagation: Forward Checking

Forward checking is the lightest form of look-ahead. When you assign `X = v`, for every unassigned variable `Y` connected to `X` by a constraint, delete from `Y`'s domain every value inconsistent with `X = v`. If any `Y`'s domain becomes empty (**wipeout**), backtrack immediately — no point descending.

```
forwardCheck(X, v, domains):
    for Y in neighbors(X) where Y unassigned:
        remove from domains[Y] every value w with not consistent(X=v, Y=w)
        if domains[Y] empty: return FAILURE
    return OK   (remember what was removed, to restore on backtrack)
```

Forward checking + MRV is a powerful pairing: MRV naturally selects the variable whose domain forward checking has shrunk the most.

**Limitation:** forward checking only looks one constraint deep — it prunes `X`'s direct neighbors but doesn't notice when *two* unassigned neighbors have become jointly impossible. AC-3 fixes that.

---

## AC-3 Arc Consistency

### What "arc consistent" means

An **arc** `(X, Y)` is a directed pair sharing a constraint. The arc is **consistent** if for *every* value `x` in `X`'s domain there exists *some* value `y` in `Y`'s domain such that `(x, y)` satisfies the constraint. If some `x` has no supporting `y`, that `x` can never be part of a solution, so we delete it.

A CSP is **arc consistent** when *all* arcs are consistent.

### The AC-3 algorithm

AC-3 enforces arc consistency by repeatedly revising arcs whose tail domain may have shrunk:

```
AC3(domains, arcs):
    queue = all arcs (X, Y)
    while queue not empty:
        (X, Y) = queue.pop()
        if revise(X, Y):                 # removed some value from X
            if domains[X] empty: return FAILURE
            for each Z in neighbors(X) except Y:
                queue.add((Z, X))        # X shrank → recheck arcs into X
    return OK

revise(X, Y):
    removed = false
    for x in domains[X]:
        if no y in domains[Y] satisfies constraint(X=x, Y=y):
            delete x from domains[X]
            removed = true
    return removed
```

When `revise` removes a value from `X`, every arc `(Z, X)` could now have lost support, so we re-enqueue them. The queue drains when nothing more can be pruned.

### Complexity

AC-3 runs in **O(e · d³)** where `e` is the number of arcs and `d` the maximum domain size. Each arc can be inserted into the queue at most `d` times (once per value removed from its endpoint), each `revise` costs `O(d²)`, giving `e · d · d² = e · d³`. The proof is in [`professional.md`](./professional.md).

### What AC-3 does and doesn't give you

AC-3 is a *preprocessing and propagation* step, not a solver. Making a CSP arc consistent can:

- **Solve it outright** (every domain reduced to one value),
- **Prove it unsolvable** (some domain emptied), or
- **Reduce domains** so the subsequent backtracking search is far smaller.

But arc consistency alone does **not** guarantee a solution exists — a triangle of variables each with domain `{R, G}` and `≠` constraints is arc consistent yet unsolvable (3-coloring needs 3 colors). You still need search; AC-3 just makes it cheap.

---

## Maintaining Arc Consistency (MAC)

**MAC** = run AC-3 *inside* the search, not just once. After each assignment `X = v` (which sets `domains[X] = {v}`), run AC-3 seeded with the arcs `(Y, X)` for neighbors `Y`. This propagates the consequences of the assignment throughout the network, far beyond forward checking's one-step look-ahead.

```
backtrackMAC(assignment, domains):
    if complete: return assignment
    X = selectMRV(...)
    for v in orderLCV(X, domains):
        save = snapshot(domains)
        domains[X] = {v}
        if AC3(domains, arcsInto(X)) != FAILURE:
            result = backtrackMAC(assignment + {X=v}, domains)
            if result: return result
        restore(domains, save)
    return failure
```

MAC explores dramatically fewer nodes than forward checking on hard problems, at the cost of more work per node. For tightly constrained problems (Sudoku, hard graph coloring) MAC is usually the winner; for loosely constrained ones, forward checking's lower overhead can win. Measure.

---

## Cryptarithmetic: SEND + MORE = MONEY

A classic CSP: assign each distinct letter a distinct digit so the arithmetic holds.

```
  S E N D
+ M O R E
---------
M O N E Y
```

**Model as a CSP:**

- **Variables:** `S, E, N, D, M, O, R, Y` (8 letters), plus carry variables `c1, c2, c3, c4` if you model column-by-column.
- **Domains:** each letter ∈ `{0..9}`; leading letters `S, M ∈ {1..9}` (no leading zero); carries ∈ `{0, 1}`.
- **Constraints:**
  - `AllDifferent(S, E, N, D, M, O, R, Y)` — all letters map to distinct digits.
  - The column-addition constraints: `D + E = Y + 10·c1`, `N + R + c1 = E + 10·c2`, `E + O + c2 = N + 10·c3`, `S + M + c3 = O + 10·c4`, `M = c4`.

**Why heuristics matter here:** the naive search over `10·9·8·...` assignments is large; MRV plus the carry/column constraints with propagation prunes it to a handful of nodes. The unique solution is:

```
S=9 E=5 N=6 D=7 M=1 O=0 R=8 Y=2
  9 5 6 7
+ 1 0 8 5
---------
1 0 6 5 2     (10652)
```

From `M = c4` and `M ≠ 0`, we get `M = 1` immediately — a one-step deduction propagation finds instantly. That cascade (`M=1` ⇒ `S+M+c3 ≥ 10` ⇒ `S=9` or near it ⇒ `O=0`...) is exactly what propagation automates.

---

## Comparison of Techniques

| Technique | What it prunes | Cost per node | Nodes explored | Best for |
|-----------|----------------|---------------|----------------|----------|
| Blind backtracking | nothing extra | cheapest | most | tiny problems |
| + MRV/degree | smart branch order | cheap | far fewer | almost always on |
| + LCV | finds solution sooner | small | fewer (1-sol case) | when one solution needed |
| Forward checking | direct neighbors | low | fewer | loosely constrained |
| AC-3 (preprocess) | whole network once | one-time `O(e·d³)` | fewer | always worth trying once |
| MAC (AC-3 per node) | whole network each step | high | fewest | tightly constrained |

| Heuristic | Direction | Mnemonic |
|-----------|-----------|----------|
| MRV | most constrained **variable** | fail-first |
| Degree | most constraining variable (tiebreak) | front-load pressure |
| LCV | least constraining **value** | fail-last / keep options open |

---

## Code Examples

### Example: AC-3 Arc Consistency for Graph Coloring

We enforce arc consistency on a coloring CSP with the `≠` constraint, then report reduced domains.

#### Go

```go
package main

import "fmt"

type CSP struct {
	vars    []string
	domains map[string][]string
	adj     map[string][]string // neighbors (binary != constraints)
}

func contains(s []string, x string) bool {
	for _, v := range s {
		if v == x {
			return true
		}
	}
	return false
}

// revise removes values from X with no support in Y under X != Y.
func (c *CSP) revise(x, y string) bool {
	removed := false
	kept := []string{}
	for _, vx := range c.domains[x] {
		hasSupport := false
		for _, vy := range c.domains[y] {
			if vx != vy { // constraint X != Y satisfiable
				hasSupport = true
				break
			}
		}
		if hasSupport {
			kept = append(kept, vx)
		} else {
			removed = true
		}
	}
	c.domains[x] = kept
	return removed
}

func (c *CSP) ac3() bool {
	type arc struct{ x, y string }
	var queue []arc
	for x, nbs := range c.adj {
		for _, y := range nbs {
			queue = append(queue, arc{x, y})
		}
	}
	for len(queue) > 0 {
		a := queue[0]
		queue = queue[1:]
		if c.revise(a.x, a.y) {
			if len(c.domains[a.x]) == 0 {
				return false // wipeout: unsolvable
			}
			for _, z := range c.adj[a.x] {
				if z != a.y {
					queue = append(queue, arc{z, a.x})
				}
			}
		}
	}
	return true
}

func main() {
	csp := &CSP{
		vars: []string{"A", "B", "C"},
		domains: map[string][]string{
			"A": {"R"},        // A pre-fixed to R
			"B": {"R", "G"},
			"C": {"R", "G"},
		},
		adj: map[string][]string{
			"A": {"B", "C"},
			"B": {"A", "C"},
			"C": {"A", "B"},
		},
	}
	if csp.ac3() {
		fmt.Println("Arc consistent. Domains:", csp.domains)
	} else {
		fmt.Println("Unsolvable (domain wipeout during AC-3)")
	}
}
```

#### Java

```java
import java.util.*;

public class AC3 {
    Map<String, List<String>> domains = new HashMap<>();
    Map<String, List<String>> adj = new HashMap<>();

    boolean revise(String x, String y) {
        boolean removed = false;
        List<String> kept = new ArrayList<>();
        for (String vx : domains.get(x)) {
            boolean support = false;
            for (String vy : domains.get(y)) {
                if (!vx.equals(vy)) { support = true; break; }
            }
            if (support) kept.add(vx); else removed = true;
        }
        domains.put(x, kept);
        return removed;
    }

    boolean ac3() {
        Deque<String[]> queue = new ArrayDeque<>();
        for (String x : adj.keySet())
            for (String y : adj.get(x)) queue.add(new String[]{x, y});
        while (!queue.isEmpty()) {
            String[] a = queue.poll();
            if (revise(a[0], a[1])) {
                if (domains.get(a[0]).isEmpty()) return false;
                for (String z : adj.get(a[0]))
                    if (!z.equals(a[1])) queue.add(new String[]{z, a[0]});
            }
        }
        return true;
    }

    public static void main(String[] args) {
        AC3 csp = new AC3();
        csp.domains.put("A", new ArrayList<>(List.of("R")));
        csp.domains.put("B", new ArrayList<>(List.of("R", "G")));
        csp.domains.put("C", new ArrayList<>(List.of("R", "G")));
        csp.adj.put("A", List.of("B", "C"));
        csp.adj.put("B", List.of("A", "C"));
        csp.adj.put("C", List.of("A", "B"));
        if (csp.ac3()) System.out.println("Arc consistent. " + csp.domains);
        else System.out.println("Unsolvable (wipeout)");
    }
}
```

#### Python

```python
from collections import deque


def revise(domains, x, y):
    removed = False
    kept = []
    for vx in domains[x]:
        if any(vx != vy for vy in domains[y]):   # has support under X != Y
            kept.append(vx)
        else:
            removed = True
    domains[x] = kept
    return removed


def ac3(domains, adj):
    queue = deque((x, y) for x in adj for y in adj[x])
    while queue:
        x, y = queue.popleft()
        if revise(domains, x, y):
            if not domains[x]:
                return False                      # wipeout
            for z in adj[x]:
                if z != y:
                    queue.append((z, x))
    return True


if __name__ == "__main__":
    domains = {"A": ["R"], "B": ["R", "G"], "C": ["R", "G"]}
    adj = {"A": ["B", "C"], "B": ["A", "C"], "C": ["A", "B"]}
    if ac3(domains, adj):
        print("Arc consistent. Domains:", domains)
    else:
        print("Unsolvable (domain wipeout during AC-3)")
```

**What it does:** A triangle A-B-C with `A` fixed to `R`. AC-3 removes `R` from B and C (no support against A=R), then detects that B and C both reduce to `{G}` — which is arc consistent but, since B-C also conflict, search will fail. With only 2 colors and a triangle, the instance is unsatisfiable; AC-3 here reduces domains and a subsequent revise of arc (B,C)/(C,B) wipes a domain. (Try fixing A to R and giving B,C three colors to see a satisfiable reduction.)
**Run:** `go run main.go` | `javac AC3.java && java AC3` | `python ac3.py`

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| AC-3 loops forever | Re-enqueuing arcs even when nothing changed. | Only enqueue `(Z, X)` when `revise` actually removed a value. |
| Misses pruning | Forgot to re-add arcs into `X` after `X` shrank. | After a successful `revise(X,Y)`, enqueue all `(Z, X)`, `Z ≠ Y`. |
| MAC corrupts domains across branches | Didn't snapshot/restore domains around each assignment. | Save domains before AC-3, restore on backtrack. |
| LCV gives no speedup but costs time | Counting eliminations is as expensive as the savings. | Drop LCV when finding all solutions or when domains are tiny. |
| Wrong cryptarithmetic answer | Allowed leading zero or repeated digits. | Enforce leading-letter `≥ 1` and `AllDifferent`. |
| Arc consistency declared "solved" wrongly | Treating arc consistency as a solution. | Arc consistency ≠ solvability; still run search. |

---

## Performance Analysis

- **MRV** typically reduces nodes by 1–3 orders of magnitude on structured CSPs; it is essentially free to compute.
- **Forward checking** is `O(degree · d)` per assignment; cheap and almost always net-positive.
- **AC-3** preprocessing is `O(e · d³)` once; on many instances it solves or near-solves the problem before search begins.
- **MAC** multiplies per-node cost by the AC-3 cost but slashes node count; net win on tightly constrained problems, net loss on loosely constrained ones.
- **Special-case AC** algorithms (AC-4, AC-2001) lower the constant and reach `O(e·d²)`, but AC-3 is the standard teaching/implementation choice.
- **LCV** helps only in the single-solution case; its eliminate-counting cost can dominate on large domains.

Rule of thumb: always use MRV + forward checking as a baseline; add AC-3 preprocessing; switch to MAC if the problem is hard and tightly constrained.

---

## Best Practices

- Run AC-3 **once as preprocessing** before search — it's cheap insurance that often pays off hugely.
- Use **MRV with degree tie-break** as your default variable ordering; it's the highest-leverage heuristic.
- Apply **LCV only when you need a single solution**; skip it when enumerating all or proving unsatisfiability.
- Implement domains as **bitsets** for small integer domains (Sudoku, cryptarithmetic) so revise/forward-check are bit operations.
- Snapshot domains efficiently — store *removed values per variable* per level rather than deep-copying whole domain maps.
- Benchmark forward checking vs MAC on representative instances; the right choice is problem-specific.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation shows MRV selection, trying a color, forward-checking neighbor domains, detecting wipeouts, and backtracking — the same propagation ideas this file formalizes, applied to map coloring.

---

## Summary

The leap from "backtracking works" to "backtracking is fast" is made by general heuristics and propagation. **MRV** (fewest remaining values, fail-first) with the **degree** tie-breaker chooses the variable that prunes most; **LCV** orders values to keep options open when seeking one solution. **Forward checking** prunes the direct neighbors of each assignment and catches wipeouts; **AC-3** enforces full arc consistency in `O(e·d³)`, propagating consequences network-wide; **MAC** runs AC-3 at every search node for maximum pruning. None of these change *what* a CSP is — they change how little of the exponential tree you actually visit. The `SEND + MORE = MONEY` puzzle and map coloring both fall out of the same machinery: model once, let MRV/LCV/AC-3 do the work.

---

## Worked LCV Example

Suppose we are coloring region `SA` (domain `{R, G, B}`) with unassigned neighbors whose current domains are:

```
WA = {R, G}    NT = {R, G, B}    Q = {G, B}    NSW = {R, B}    V = {R, G}
```

For each candidate value of `SA`, count how many neighbor values it would eliminate:

```
SA = R  → removes R from WA, NT, NSW    = 3 eliminations
SA = G  → removes G from WA, NT, Q, V   = 4 eliminations
SA = B  → removes B from NT, Q, NSW     = 3 eliminations
```

LCV tries the *least* constraining value first: `R` or `B` (3 eliminations each) before `G` (4). Leaving more values in neighbors' domains raises the chance the branch still contains a solution, so a solution is reached with fewer backtracks. Note this work is wasted if we need *all* solutions — we would try `G` eventually anyway — which is exactly why LCV is a single-solution optimization.

---

## Further Reading

- Russell & Norvig, *AIMA* — the CSP chapter covers MRV, degree, LCV, forward checking, AC-3, and MAC together.
- Mackworth (1977) — original arc-consistency paper introducing AC-3.
- Régin (1994) — GAC propagator for `AllDifferent`, the right way to model Sudoku/cryptarithmetic letter-distinctness.
- [`junior.md`](./junior.md) — the framework and the try/recurse/undo skeleton.
- [`senior.md`](./senior.md) — backjumping, no-good learning, CP/SAT solvers, propagation-level choice.
- [`professional.md`](./professional.md) — AC-3 correctness/complexity proofs, the consistency hierarchy, NP-completeness.
