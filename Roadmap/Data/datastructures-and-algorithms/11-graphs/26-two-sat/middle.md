# 2-SAT (2-Satisfiability) — Middle Level

> **One-line summary:** 2-SAT reduces a 2-CNF satisfiability problem to strongly connected components on a `2n`-vertex implication graph. Two literals in the same SCC are *logically equivalent*; if a variable and its negation are forced equivalent, no assignment can hold and the formula is UNSAT. Otherwise a satisfying assignment falls out of the reverse-topological order of the SCC condensation, all in `O(n + m)`. This file goes deeper into *why* the criterion is correct, how to model real constraints (at-most-one, implications, conditional forcing), and how 2-SAT compares to general SAT and to CSP solvers.

---

## Table of Contents

1. [Recap & Mental Model](#recap--mental-model)
2. [Why "Same SCC" Means Contradiction](#why-same-scc-means-contradiction)
3. [Why Reverse-Topological Order Recovers an Assignment](#why-reverse-topological-order-recovers-an-assignment)
4. [Comparison: 2-SAT vs General SAT vs CSP](#comparison-2-sat-vs-general-sat-vs-csp)
5. [Advanced Modeling Patterns](#advanced-modeling-patterns)
6. [Tarjan vs Kosaraju for 2-SAT](#tarjan-vs-kosaraju-for-2-sat)
7. [Full Solver with Assignment Recovery](#full-solver-with-assignment-recovery)
8. [Performance Analysis](#performance-analysis)
9. [Testing Strategy](#testing-strategy)
10. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
11. [Summary](#summary)

---

## Recap & Mental Model

A 2-CNF formula is an AND of clauses, each an OR of at most two literals. The junior file established the core pipeline:

1. **Encode** literals as vertices: `xi = true → 2i`, `xi = false → 2i+1`, and `neg(v) = v ^ 1`.
2. **Build** the implication graph: each clause `(a ∨ b)` adds `neg(a) → b` and `neg(b) → a`.
3. **Compute SCCs** with a linear algorithm (Tarjan or Kosaraju).
4. **Decide**: SAT iff no variable `x` has both literals in one SCC.
5. **Recover** an assignment: `xi = true` iff `comp[2i] < comp[2i+1]` (with Tarjan's reverse-topo numbering).

At middle level the interesting questions are: *why is each of those steps correct?* and *how do I express a real-world constraint as 2-CNF clauses?* Both come down to thinking of edges as **forced consequences**.

The implication graph has a crucial **symmetry**: it is *skew-symmetric*. Whenever there is an edge `u → w`, there is also the edge `neg(w) → neg(u)` (the contrapositive — added automatically because every clause contributes both implications). This means: if `p` can reach `q`, then `neg(q)` can reach `neg(p)`. We will lean on this property repeatedly.

---

## Why "Same SCC" Means Contradiction

**Claim.** The formula is unsatisfiable if and only if some variable `x` has `x` and `¬x` in the same SCC.

**Edges are forcing.** An edge `p → q` means "if `p` is true, `q` must be true." A path `p → ... → q` chains those forces: `p` true forces `q` true. Within an SCC, *every* vertex reaches every other, so all literals in one SCC are forced to share a single truth value — they are **logically equivalent**.

**The contradiction direction.** Suppose `x` and `¬x` are in the same SCC. Then `x` forces `¬x` (a path exists), and `¬x` forces `x`. Now try to satisfy the formula:

- If you set `x = true`, the path `x → ... → ¬x` forces `¬x` to be true as well — meaning `x` is false. Contradiction.
- If you set `x = false` (i.e. `¬x = true`), the path `¬x → ... → x` forces `x = true`. Contradiction.

No value of `x` is consistent, so the formula is UNSAT.

**The satisfiable direction (intuition).** Suppose *no* variable has both literals in one SCC. Then in the condensation (the DAG of SCCs), the literal `x` and its negation `¬x` always live in **distinct** super-nodes. The skew-symmetry guarantees these two super-nodes are "mirror images": if SCC `C` contains a set of literals, the SCC `neg(C)` containing all their negations is a *different* component, and it sits at the *mirrored* position in the topological order. We can consistently pick, for each mirror pair, the one that is **later** in topological order, and this choice never forces a contradiction because implications only point forward in topological order. That is precisely what the assignment-recovery rule does. The fully rigorous proof is in `professional.md`.

---

## Why Reverse-Topological Order Recovers an Assignment

The assignment rule "`xi = true` iff `comp[2i] < comp[2i+1]`" can look like magic. Here is the reasoning.

**Topological order of the condensation.** Collapse each SCC into a super-node; the result is a DAG. A topological order lists super-nodes so that every edge points from an earlier node to a later node. Equivalently, if SCC `A` can reach SCC `B`, then `A` comes before `B`.

**Tarjan's numbering is reverse-topological.** Tarjan finalizes (pops) an SCC only after exploring everything reachable from it. So the *first* SCC it numbers (id `0`) is a **sink** (reaches nothing new), and the *last* it numbers (highest id) is a **source**. Thus: **smaller `comp` id = later in topological order = more downstream.**

**The rule.** For a variable `xi`, its two literal-vertices `2i` (true) and `2i+1` (false) lie in two different SCCs (we already checked SAT). We want to choose the literal whose SCC is **downstream** — later in topological order — because picking a downstream literal cannot force any upstream literal (edges go forward). Downstream = smaller `comp` id. So:

```
pick xi = true   when comp[2i]   < comp[2i+1]   (true literal is downstream)
pick xi = false  when comp[2i+1] < comp[2i]     (false literal is downstream)
```

**Why "downstream" is safe.** If you set a literal `L` to true, the only literals it *forces* true are those reachable from `L` — i.e. downstream of `L`. If `L` itself is the most-downstream of its mirror pair, then everything it forces is even further downstream, and (by skew-symmetry) you never force the negation of an already-chosen literal. The choice is internally consistent across all variables simultaneously. Again, the formal invariant proof lives in `professional.md`.

> **Convention warning.** If you compute SCCs with **Kosaraju** and number components in the order the *second* DFS discovers them, the order may be *forward*-topological, flipping the comparison to `comp[2i] > comp[2i+1]`. The safe move: pick one SCC routine, derive its ordering once, and **fuzz-test** the comparison against a brute-force checker.

---

## Comparison: 2-SAT vs General SAT vs CSP

| Dimension | 2-SAT | General SAT (k-SAT, k≥3) | CSP (constraint satisfaction) |
|-----------|-------|--------------------------|-------------------------------|
| Clause size | ≤ 2 literals | any | arbitrary constraints over finite domains |
| Domains | boolean | boolean | any finite domain (colors, ints, ...) |
| Complexity | **P** (linear `O(n+m)`); NL-complete | **NP-complete** | NP-complete in general |
| Algorithm | implication graph + SCC | DPLL/CDCL backtracking SAT solvers | backtracking + constraint propagation (AC-3, forward checking) |
| Witness | always recoverable in linear time | recoverable but exponential worst case | recoverable but exponential worst case |
| Counting solutions | **#P-complete** (hard even though decision is easy) | #P-complete | #P-complete |
| Optimization variant | **MAX-2-SAT is NP-hard** | MAX-SAT NP-hard | weighted CSP NP-hard |

**Takeaways.**

- 2-SAT is the *largest* clause-size for which satisfiability is in P. Bump to 3 and you cross into NP-complete.
- Even though *deciding* 2-SAT is easy, *counting* its solutions or *maximizing* satisfied clauses is hard. Easiness of the decision problem does not carry over to the optimization and counting variants.
- If your problem has only binary variables and only "at least one of two" constraints, model it as 2-SAT and solve in linear time. If constraints are larger or domains non-boolean, reach for a CSP/SAT solver.

---

## Advanced Modeling Patterns

The art of 2-SAT is **modeling**: translating real constraints into clauses. Here are the workhorse patterns. Throughout, `add_clause(a, va, b, vb)` means "`(xa == va) OR (xb == vb)`."

### Pattern A — Force a literal

```
force xi = true   :  add_clause(i, true,  i, true)    # (xi ∨ xi)
force xi = false  :  add_clause(i, false, i, false)   # (¬xi ∨ ¬xi)
```

### Pattern B — Implication `xa ⇒ xb`

"If `a` is chosen, then `b` must be chosen" is the clause `(¬xa ∨ xb)`:

```
add_clause(a, false, b, true)
```

This generalizes: `xa ⇒ ¬xb` is `(¬xa ∨ ¬xb)` = `add_clause(a, false, b, false)`.

### Pattern C — At most one of a pair (mutual exclusion)

"`xa` and `xb` not both true" = `(¬xa ∨ ¬xb)`:

```
add_clause(a, false, b, false)
```

### Pattern D — Exactly one of a pair (XOR over two)

Combine "at least one" and "at most one":

```
add_clause(a, true,  b, true)    # at least one true
add_clause(a, false, b, false)   # at most one true
```

This is the "must differ" constraint used in **2-coloring**: edge endpoints take opposite colors.

### Pattern E — At most one over many (the linear "implication chain")

"At most one of `x0, x1, ..., xk` is true" naively needs `O(k^2)` pairwise clauses. The standard trick uses **auxiliary prefix variables** `p0..pk` where `pi` means "some `xj` with `j ≤ i` is true":

```
xi ⇒ pi          (¬xi ∨ pi)
p(i-1) ⇒ pi      (¬p(i-1) ∨ pi)        # prefix is monotone
xi ⇒ ¬p(i-1)     (¬xi ∨ ¬p(i-1))       # if xi true, nothing before it was true
```

This encodes at-most-one with `O(k)` clauses and `O(k)` extra variables — important when `k` is large.

### Pattern F — Binary scheduling / placement

Each task has two possible slots, modeled as one boolean (`true` = slot A, `false` = slot B). Conflict rules become clauses:

- "tasks `i` and `j` cannot both be in slot A" → `(¬xi ∨ ¬xj)`.
- "if task `i` is in slot A, task `j` must be in slot B" → `(¬xi ∨ ¬xj)`.

This is how 2-SAT models "choose one of two" puzzles: interval scheduling onto two machines, placing labels above/below points on a map, seating into one of two rooms.

### Pattern G — Conditional forcing under reachability

Because of skew-symmetry, once you add `xa ⇒ xb`, the contrapositive `¬xb ⇒ ¬xa` is *automatically* present. You never add contrapositives by hand — the two-edges-per-clause construction does it for you. This is why each clause is exactly two edges, never four.

---

## Tarjan vs Kosaraju for 2-SAT

Both compute SCCs in `O(n + m)`; the choice affects only constants and the assignment-reading convention.

| Aspect | Tarjan | Kosaraju |
|--------|--------|----------|
| DFS passes | **one** | two (graph + transpose) |
| Extra storage | `index[]`, `low[]`, on-stack flag, explicit stack | finish-order stack + transpose adjacency |
| SCC numbering | reverse-topological (sink first) | order of second DFS (forward-topological if you process by decreasing finish time) |
| Assignment rule | `comp[2i] < comp[2i+1]` | typically `comp[2i] > comp[2i+1]` (verify!) |
| Builds transpose? | no | yes (extra `O(n+m)` memory) |
| Typical constant factor | faster (single pass, no transpose) | slightly slower (two passes) |

For 2-SAT in contests and production, **iterative Tarjan** is the common choice: one pass, no transpose graph, and its reverse-topological numbering pairs naturally with the `comp[2i] < comp[2i+1]` rule. Kosaraju is sometimes preferred for clarity since each DFS is plain. Whichever you choose, *lock in the numbering convention and fuzz-test the comparison*.

---

## Full Solver with Assignment Recovery

This is a complete, reusable 2-SAT solver in each language, including a small demo that builds a formula, solves it, and **verifies** the recovered assignment by re-evaluating every clause.

#### Go

```go
package main

import "fmt"

type clause struct {
	a  int
	va bool
	b  int
	vb bool
}

type TwoSAT struct {
	n      int
	adj    [][]int
	stored []clause // kept only for verification in the demo
}

func NewTwoSAT(n int) *TwoSAT { return &TwoSAT{n: n, adj: make([][]int, 2*n)} }

func node(v int, val bool) int {
	if val {
		return 2 * v
	}
	return 2*v + 1
}
func neg(x int) int { return x ^ 1 }

func (t *TwoSAT) AddClause(a int, va bool, b int, vb bool) {
	t.stored = append(t.stored, clause{a, va, b, vb})
	x, y := node(a, va), node(b, vb)
	t.adj[neg(x)] = append(t.adj[neg(x)], y)
	t.adj[neg(y)] = append(t.adj[neg(y)], x)
}

func (t *TwoSAT) Solve() ([]bool, bool) {
	N := 2 * t.n
	index := make([]int, N)
	low := make([]int, N)
	onStack := make([]bool, N)
	comp := make([]int, N)
	for i := range index {
		index[i], comp[i] = -1, -1
	}
	var stack []int
	idx, cc := 0, 0

	for s := 0; s < N; s++ {
		if index[s] != -1 {
			continue
		}
		type fr struct{ v, pi int }
		st := []fr{{s, 0}}
		for len(st) > 0 {
			f := &st[len(st)-1]
			v := f.v
			if f.pi == 0 {
				index[v], low[v] = idx, idx
				idx++
				stack = append(stack, v)
				onStack[v] = true
			}
			if f.pi < len(t.adj[v]) {
				w := t.adj[v][f.pi]
				f.pi++
				if index[w] == -1 {
					st = append(st, fr{w, 0})
				} else if onStack[w] && index[w] < low[v] {
					low[v] = index[w]
				}
				continue
			}
			if low[v] == index[v] {
				for {
					w := stack[len(stack)-1]
					stack = stack[:len(stack)-1]
					onStack[w] = false
					comp[w] = cc
					if w == v {
						break
					}
				}
				cc++
			}
			st = st[:len(st)-1]
			if len(st) > 0 {
				p := st[len(st)-1].v
				if low[v] < low[p] {
					low[p] = low[v]
				}
			}
		}
	}

	assign := make([]bool, t.n)
	for i := 0; i < t.n; i++ {
		if comp[2*i] == comp[2*i+1] {
			return nil, false
		}
		assign[i] = comp[2*i] < comp[2*i+1]
	}
	return assign, true
}

func (t *TwoSAT) verify(a []bool) bool {
	for _, c := range t.stored {
		if a[c.a] == c.va || a[c.b] == c.vb {
			continue
		}
		return false
	}
	return true
}

func main() {
	ts := NewTwoSAT(3)
	ts.AddClause(0, true, 1, false) // (x0 ∨ ¬x1)
	ts.AddClause(1, true, 2, false) // (x1 ∨ ¬x2)
	ts.AddClause(0, false, 2, true) // (¬x0 ∨ x2)
	a, ok := ts.Solve()
	if !ok {
		fmt.Println("UNSAT")
		return
	}
	fmt.Println("SAT:", a, "verified:", ts.verify(a))
}
```

#### Java

```java
import java.util.*;

public class TwoSAT {
    private final int n;
    private final List<List<Integer>> adj;
    private final List<int[]> stored = new ArrayList<>(); // {a, va, b, vb}

    public TwoSAT(int n) {
        this.n = n;
        adj = new ArrayList<>();
        for (int i = 0; i < 2 * n; i++) adj.add(new ArrayList<>());
    }

    private static int node(int v, boolean val) { return val ? 2 * v : 2 * v + 1; }
    private static int neg(int x) { return x ^ 1; }

    public void addClause(int a, boolean va, int b, boolean vb) {
        stored.add(new int[]{a, va ? 1 : 0, b, vb ? 1 : 0});
        int x = node(a, va), y = node(b, vb);
        adj.get(neg(x)).add(y);
        adj.get(neg(y)).add(x);
    }

    public boolean[] solve() {
        int N = 2 * n;
        int[] index = new int[N], low = new int[N], comp = new int[N];
        boolean[] onStack = new boolean[N];
        Arrays.fill(index, -1);
        Arrays.fill(comp, -1);
        Deque<Integer> stack = new ArrayDeque<>();
        int[] idx = {0}, cc = {0};

        for (int s = 0; s < N; s++) {
            if (index[s] != -1) continue;
            Deque<int[]> st = new ArrayDeque<>();
            st.push(new int[]{s, 0});
            while (!st.isEmpty()) {
                int[] f = st.peek();
                int v = f[0];
                if (f[1] == 0) {
                    index[v] = low[v] = idx[0]++;
                    stack.push(v);
                    onStack[v] = true;
                }
                if (f[1] < adj.get(v).size()) {
                    int w = adj.get(v).get(f[1]++);
                    if (index[w] == -1) st.push(new int[]{w, 0});
                    else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
                    continue;
                }
                if (low[v] == index[v]) {
                    while (true) {
                        int w = stack.pop();
                        onStack[w] = false;
                        comp[w] = cc[0];
                        if (w == v) break;
                    }
                    cc[0]++;
                }
                st.pop();
                if (!st.isEmpty()) low[st.peek()[0]] = Math.min(low[st.peek()[0]], low[v]);
            }
        }

        boolean[] assign = new boolean[n];
        for (int i = 0; i < n; i++) {
            if (comp[2 * i] == comp[2 * i + 1]) return null;
            assign[i] = comp[2 * i] < comp[2 * i + 1];
        }
        return assign;
    }

    public boolean verify(boolean[] a) {
        for (int[] c : stored)
            if (!(a[c[0]] == (c[1] == 1) || a[c[2]] == (c[3] == 1))) return false;
        return true;
    }

    public static void main(String[] args) {
        TwoSAT ts = new TwoSAT(3);
        ts.addClause(0, true, 1, false);
        ts.addClause(1, true, 2, false);
        ts.addClause(0, false, 2, true);
        boolean[] a = ts.solve();
        if (a == null) System.out.println("UNSAT");
        else System.out.println("SAT: " + Arrays.toString(a) + " verified: " + ts.verify(a));
    }
}
```

#### Python

```python
class TwoSAT:
    def __init__(self, n):
        self.n = n
        self.adj = [[] for _ in range(2 * n)]
        self.stored = []  # (a, va, b, vb) kept for verification

    @staticmethod
    def _node(v, val):
        return 2 * v if val else 2 * v + 1

    @staticmethod
    def _neg(x):
        return x ^ 1

    def add_clause(self, a, va, b, vb):
        self.stored.append((a, va, b, vb))
        x, y = self._node(a, va), self._node(b, vb)
        self.adj[self._neg(x)].append(y)
        self.adj[self._neg(y)].append(x)

    def solve(self):
        N = 2 * self.n
        index = [-1] * N
        low = [0] * N
        comp = [-1] * N
        on_stack = [False] * N
        stack = []
        idx = cc = 0

        for s in range(N):
            if index[s] != -1:
                continue
            st = [(s, 0)]
            while st:
                v, pi = st[-1]
                if pi == 0:
                    index[v] = low[v] = idx
                    idx += 1
                    stack.append(v)
                    on_stack[v] = True
                if pi < len(self.adj[v]):
                    w = self.adj[v][pi]
                    st[-1] = (v, pi + 1)
                    if index[w] == -1:
                        st.append((w, 0))
                    elif on_stack[w]:
                        low[v] = min(low[v], index[w])
                    continue
                if low[v] == index[v]:
                    while True:
                        w = stack.pop()
                        on_stack[w] = False
                        comp[w] = cc
                        if w == v:
                            break
                    cc += 1
                st.pop()
                if st:
                    low[st[-1][0]] = min(low[st[-1][0]], low[v])

        assign = [False] * self.n
        for i in range(self.n):
            if comp[2 * i] == comp[2 * i + 1]:
                return None
            assign[i] = comp[2 * i] < comp[2 * i + 1]
        return assign

    def verify(self, a):
        return all(a[c[0]] == c[1] or a[c[2]] == c[3] for c in self.stored)


if __name__ == "__main__":
    ts = TwoSAT(3)
    ts.add_clause(0, True, 1, False)   # (x0 ∨ ¬x1)
    ts.add_clause(1, True, 2, False)   # (x1 ∨ ¬x2)
    ts.add_clause(0, False, 2, True)   # (¬x0 ∨ x2)
    a = ts.solve()
    if a is None:
        print("UNSAT")
    else:
        print("SAT:", a, "verified:", ts.verify(a))
```

**Run:** `go run main.go` | `javac TwoSAT.java && java TwoSAT` | `python twosat.py`

---

## Performance Analysis

**Time.** Building the graph is `O(n + m)` — `2m` edge appends. The SCC pass visits each of `2n` vertices and each of `2m` edges once, also `O(n + m)`. The criterion check and assignment recovery are `O(n)`. Total: **`O(n + m)`**, linear in formula size — optimal, since you must read every clause.

**Space.** The adjacency lists hold `2m` edges; Tarjan's arrays (`index`, `low`, `comp`, `onStack`) and the explicit DFS/SCC stacks are `O(n)`. Total **`O(n + m)`**.

**Constant factors.** Iterative Tarjan does a single pass with no transpose graph; Kosaraju does two passes and builds the transpose (roughly 2× memory for edges). In practice both are fast; the iterative-Tarjan version handles `n, m` up to several million comfortably within a second.

**Cache behavior.** The graph is the dominant memory cost. Using flat arrays for adjacency (CSR-style: an `offsets[]` array plus a packed `edges[]` array) gives far better locality than `List<List<Integer>>` boxing — worth doing when `m` is large. See `professional.md` for the cache discussion.

**Scaling failure point.** Recursive Tarjan overflows the call stack around `2n ≈ 10^5–10^6` depending on the runtime; the iterative version shown here avoids that entirely.

---

## Testing Strategy

The two bugs that actually bite are **edge direction** and **assignment-reading direction**. Both are invisible on tiny examples and catastrophic at scale. The defense:

1. **Brute-force oracle.** For `n ≤ ~20`, enumerate all `2^n` assignments and check satisfiability directly.
2. **Fuzz.** Generate thousands of random small formulas, compare your solver's SAT/UNSAT verdict to the oracle, and when SAT, **re-evaluate every clause** under the recovered assignment.
3. **Targeted cases.** Empty formula (SAT), forced-variable unit clauses, self-contradiction `(a) ∧ (¬a)` (UNSAT), isolated variables.

This exact harness is how the direction bug in this topic's reference solver was caught and fixed — the verdict matched on tiny inputs but the assignment failed verification, pinpointing the `<` vs `>` comparison.

---

## Edge Cases & Pitfalls

- **Direction of implication.** `(a ∨ b)` is `¬a ⇒ b` and `¬b ⇒ a`. Reversing it silently produces a wrong (often always-SAT or always-UNSAT) solver.
- **Assignment comparison vs SCC numbering.** `comp[2i] < comp[2i+1]` is correct for Tarjan's reverse-topo numbering; flip it for Kosaraju forward order. Verify, never assume.
- **Unit clauses.** Model `(a)` as `(a ∨ a)`. Forgetting leaves the variable unconstrained.
- **At-most-one over many.** Pairwise clauses are `O(k^2)`; use the prefix-variable encoding (Pattern E) for large groups.
- **3-literal clauses.** Not 2-SAT. No amount of cleverness with the implication graph makes 3-SAT linear — it is NP-complete.
- **Counting / optimization.** Deciding 2-SAT is easy; counting solutions (#2-SAT) and MAX-2-SAT are hard. Do not assume the easy decision extends.

---

## Summary

The middle-level mastery of 2-SAT is two-fold. **First, the *why*:** edges are forced consequences, an SCC is a set of mutually-forced (logically equivalent) literals, a variable trapped in one SCC with its negation is a contradiction (UNSAT), and the reverse-topological SCC order lets you pick, for each variable, the downstream literal — a globally consistent assignment. **Second, the modeling:** real binary-choice constraints (force, implication, mutual exclusion, exactly-one, at-most-one over many, two-slot scheduling) all translate into a handful of clause patterns, and the skew-symmetric implication graph adds every contrapositive for free. With those two pieces, 2-SAT becomes a sharp, linear-time tool for a surprisingly wide class of "choose one of two under constraints" problems. The hard part is always the modeling; the solver itself is a single SCC pass.
