# 2-SAT (2-Satisfiability) — Interview Preparation

> **One-line summary:** Everything you need to discuss 2-SAT in an interview — the implication-graph + SCC reduction, the SAT criterion, assignment recovery, modeling tricks, and complexity boundaries — plus 42 graded Q&A, 5 behavioral prompts, and 4 full coding challenges in Go, Java, and Python.

---

## Table of Contents

1. [Quick-Reference Cheat Sheet](#quick-reference-cheat-sheet)
2. [Junior Questions (12 Q&A)](#junior-questions-12-qa)
3. [Middle Questions (12 Q&A)](#middle-questions-12-qa)
4. [Senior Questions (10 Q&A)](#senior-questions-10-qa)
5. [Professional Questions (8 Q&A)](#professional-questions-8-qa)
6. [Behavioral / System-Design Questions (5)](#behavioral--system-design-questions-5)
7. [Coding Challenges](#coding-challenges)

---

## Quick-Reference Cheat Sheet

| Item | Fact |
|------|------|
| Problem | Is a 2-CNF formula (AND of clauses, each an OR of ≤ 2 literals) satisfiable? |
| Key rewrite | `(a ∨ b) ≡ (¬a ⇒ b) ∧ (¬b ⇒ a)` |
| Graph | Implication graph: `2n` vertices (one per literal), `2m` directed edges |
| Literal encoding | `xi=true → 2i`, `xi=false → 2i+1`, `neg(v) = v ^ 1` |
| Edges per clause | exactly two: `neg(a) → b` and `neg(b) → a` |
| Unit clause `(a)` | model as `(a ∨ a)` → edge `neg(a) → a` |
| SAT criterion | satisfiable ⇔ no variable `x` has `x` and `¬x` in the same SCC |
| Assignment | `xi = true` iff `comp[2i] < comp[2i+1]` (Tarjan reverse-topo numbering) |
| Complexity | `O(n + m)` time and space (optimal) |
| SCC engine | Tarjan (1 pass) or Kosaraju (2 passes); sibling topic 08-tarjan-scc |
| Why 2 is special | 3-SAT is NP-complete; 2-SAT is in P (NL-complete) |
| Counting | #2-SAT is #P-complete (hard) |
| Optimization | MAX-2-SAT is NP-hard |
| Random threshold | SAT whp if `m/n < 1`, UNSAT whp if `m/n > 1` |
| Property | skew-symmetric: edge `p→q` implies edge `¬q→¬p` |

**30-second pitch:** "2-SAT decides if a boolean formula with two-literal clauses is satisfiable. Rewrite each clause as two implications, build a directed implication graph over `2n` literal-vertices, run SCC. It's satisfiable iff no variable and its negation share a component. Read the assignment from the reverse-topological SCC order. All linear time. Three literals and it becomes NP-complete."

---

## Junior Questions (12 Q&A)

### J1. What is 2-SAT?
The problem of deciding whether a boolean formula in 2-CNF — an AND of clauses where each clause is an OR of at most two literals — has a satisfying true/false assignment.

### J2. What is a literal, a clause, and 2-CNF?
A **literal** is a variable `xi` or its negation `¬xi`. A **clause** is an OR of literals. **2-CNF** is an AND of clauses, each clause an OR of at most two literals.

### J3. What is the single key idea that makes 2-SAT solvable quickly?
A clause `(a ∨ b)` is logically equivalent to two implications: `(¬a ⇒ b) ∧ (¬b ⇒ a)`. This lets you model the whole formula as a directed graph and reduce satisfiability to a graph property.

### J4. What is the implication graph?
A directed graph with `2n` vertices — one for each literal (`xi` and `¬xi`). Each clause `(a ∨ b)` adds two edges: `¬a → b` and `¬b → a`. An edge `p → q` means "if `p` is true, `q` must be true."

### J5. How do you encode literals as vertices in code?
`xi = true` is vertex `2i`; `xi = false` (i.e. `¬xi`) is vertex `2i + 1`. The negation of a literal-vertex `v` is `v ^ 1` (XOR by 1 flips the low bit).

### J6. What is the satisfiability criterion?
The formula is satisfiable if and only if **no variable `x` has both `x` and `¬x` in the same strongly connected component** of the implication graph.

### J7. Why does `x` and `¬x` in the same SCC mean unsatisfiable?
Same SCC means `x` reaches `¬x` and `¬x` reaches `x`. So `x = true` forces `x = false` and vice versa — a contradiction no matter what value you pick.

### J8. What's the time complexity and why?
`O(n + m)`: building the graph is `O(m)`, the SCC pass is `O(2n + 2m) = O(n+m)`, and the criterion check plus assignment recovery is `O(n)`. It's optimal since you must read every clause.

### J9. How do you handle a unit clause `(a)`?
Model it as `(a ∨ a)`, which becomes the single edge `¬a ⇒ a`. Reaching `¬a` forces `a`, so the only consistent value is `a = true`.

### J10. What algorithm computes the SCCs?
Tarjan's algorithm (one DFS pass) or Kosaraju's (two passes). See the sibling topic 08-tarjan-scc.

### J11. How many edges does each clause contribute?
Exactly two — the implication and its contrapositive. You never add four; the two-edge construction already includes both contrapositives.

### J12 (analysis). Why is 3-SAT hard but 2-SAT easy?
In a 2-clause, forcing one literal false forces the *other single literal* true — a clean implication (one edge). In a 3-clause, forcing one literal false leaves a 2-clause — still a *choice*, not a forced literal — so you can't capture it with simple edges. That branching is the line between P (2-SAT) and NP-complete (3-SAT).

---

## Middle Questions (12 Q&A)

### M1. Walk through building the implication graph for `(x0 ∨ ¬x1)`.
`(x0 ∨ ¬x1)` gives `¬x0 ⇒ ¬x1` and `¬(¬x1) ⇒ x0` = `x1 ⇒ x0`. As vertices: `¬x0 = 1`, `¬x1 = 3`, `x1 = 2`, `x0 = 0`. Edges: `1 → 3` and `2 → 0`.

### M2. How do you recover a satisfying assignment?
Compute SCCs with Tarjan (reverse-topo numbering). For each variable `i`, set `xi = true` iff `comp[2i] < comp[2i+1]` — pick the literal whose SCC is later in topological order (downstream), since downstream literals don't force upstream contradictions.

### M3. Why does the assignment rule use `<` and not `>`?
Tarjan numbers SCCs in reverse topological order (sink first, id 0). Smaller id = later in topological order = downstream. We want the downstream literal, so smaller `comp` for the chosen literal → `comp[2i] < comp[2i+1]` for `xi = true`. With Kosaraju forward order it would flip to `>`. Always verify empirically.

### M4. What does skew-symmetry of the implication graph mean and why does it matter?
For every edge `p → q` there is a mirror edge `¬q → ¬p` (the contrapositive). It guarantees the SCC of `¬p` is the mirror of the SCC of `p` and the two are distinct when SAT — which is exactly why the downstream-pick assignment is globally consistent.

### M5. How do you model "exactly one of `a`, `b` is true"?
Two clauses: `(a ∨ b)` for "at least one" and `(¬a ∨ ¬b)` for "at most one." This is also the "must differ" constraint used in 2-coloring.

### M6. How do you force `xi = true`?
Add the unit clause `(xi ∨ xi)` → edge `¬xi ⇒ xi`. To force false, add `(¬xi ∨ ¬xi)`.

### M7. How do you encode "if A then B"?
`A ⇒ B` is the clause `(¬A ∨ B)`. One clause, two edges (`A → B` and `¬B → ¬A`).

### M8. How do you encode "at most one of `k` variables is true" without `O(k^2)` clauses?
Use auxiliary prefix variables `pi` ("some `xj`, `j ≤ i`, is true") with clauses `xi ⇒ pi`, `p(i-1) ⇒ pi`, and `xi ⇒ ¬p(i-1)`. This is `O(k)` clauses and `O(k)` extra variables.

### M9. Compare Tarjan vs Kosaraju for 2-SAT.
Both `O(n+m)`. Tarjan is one DFS pass with no transpose graph and reverse-topo numbering. Kosaraju is two passes and builds the transpose (more memory). Tarjan is the usual choice; just lock in the assignment-comparison convention for whichever you pick.

### M10. Why must you use iterative SCC for large inputs?
Recursive DFS overflows the call stack once `2n` exceeds ~10^5–10^6. The explicit-stack iterative Tarjan avoids that.

### M11. How would you test a 2-SAT solver?
Brute-force oracle over `2^n` for small `n`, fuzz thousands of random formulas comparing verdicts, and when SAT, re-evaluate every clause under the recovered assignment to catch direction/convention bugs.

### M12 (analysis). Even though deciding 2-SAT is easy, what related questions are hard?
**Counting** satisfying assignments (#2-SAT) is #P-complete, and **maximizing** the number of satisfied clauses (MAX-2-SAT) is NP-hard. The easy decision problem does not make the counting or optimization variants easy.

---

## Senior Questions (10 Q&A)

### S1. How would you design 2-SAT as a service for config validation?
Separate the **modeling layer** (domain rules → clauses) from a **stateless solver** (`solve(n, clauses) → SAT/assignment`). The solver is a pure function: cacheable, parallelizable, trivially testable. All correctness risk lives in modeling, so concentrate testing there.

### S2. A config is rejected as UNSAT. How do you tell the user *why*?
Bare 2-SAT returns only "no." When you detect `comp[2i] == comp[2i+1]`, extract a cycle through both `xi` and `¬xi`; the clauses on that cycle form a conflict core. Surface those specific rules as the explanation.

### S3. How do you handle a formula with millions of variables and clauses?
Use CSR adjacency (offsets + packed edges) instead of list-of-lists for cache locality and low allocation, 32-bit indices when `2n < 2^31`, iterative Tarjan (no recursion), and build edges via a streaming two-pass count-then-fill. Graph construction often dominates the SCC pass.

### S4. Can you parallelize a single 2-SAT solve?
The SCC DFS is inherently sequential. Parallelize *around* it: independent instances on separate workers, or disconnected components of one formula in parallel. Don't lock a single Tarjan DFS — contention kills the linear advantage.

### S5. Why choose 2-SAT over a general SAT/CSP solver when it fits?
**Bounded latency.** 2-SAT is always `O(n+m)`, never times out, never needs heuristics — safe in a hard-latency request path. A CDCL solver can hit pathological exponential inputs. Give up generality for predictability when the constraints are genuinely 2-CNF.

### S6. How do you answer "must `xi` be true in every satisfying assignment?"
Force `xi = false` (add `(¬xi ∨ ¬xi)`) on a copy and re-solve; if it's now UNSAT, then `xi` is true in every solution. Linear-time per query.

### S7. What metrics would you emit from a production 2-SAT subsystem?
Input size (`vars`, `clauses`), `solve_ms` histogram, `scc_count`, `unsat_rate`, and `conflict_core_size`. A spike in `clauses` signals a modeling explosion; a jump in `unsat_rate` usually signals a bad modeling deploy.

### S8. What's the dominant failure mode in practice?
Silent **direction** or **numbering-convention** bugs (pass small tests, fail at scale) and **modeling explosions** (algorithm fine, but the modeling layer emitted a huge formula). Mitigate with fuzz+verify and a per-request clause budget.

### S9. How do incremental constraint changes affect the design?
Each change can re-solve from scratch in `O(n+m)` — usually fine. Sub-`O(n+m)` incremental updates require dynamic-SCC machinery and are typically over-engineering; only pursue them under a strict interactive-latency requirement.

### S10 (analysis). Where does 2-SAT sit in the complexity hierarchy and why does it matter operationally?
2-SAT is **NL-complete** (and thus in P, in NC). Operationally that means it's not just polynomial but also low-space and parallelizable in principle — reinforcing its role as a cheap, predictable feasibility primitive rather than a heavyweight solver.

---

## Professional Questions (8 Q&A)

### P1. State and prove the satisfiability theorem.
**Theorem:** `φ` is SAT iff no `xi` has `xi`, `¬xi` in one SCC. **(⇒)** A satisfying `α` makes every edge truth-preserving; a path `xi ⇝ ¬xi` would force `xi`'s value to its negation — contradiction, so no such pair. **(⇐)** With no such pair, assign each variable to the literal whose SCC is later in topological order; using skew-symmetry, a falsified clause would create a strict cycle in the topological total order — impossible. So `α` satisfies `φ`.

### P2. Prove the assignment-recovery rule is correct under Tarjan numbering.
Tarjan finalizes an SCC only after all SCCs reachable from it, so ids decrease along condensation edges: **smaller id = later in topological order**. The rule `xi = true ⟺ comp[2i] < comp[2i+1]` therefore picks the literal whose SCC is later in topological order — exactly the construction proved satisfying in the theorem's (⇐) direction.

### P3. Why is 2-SAT in P but 3-SAT NP-complete — structurally?
A false literal in a 2-clause forces a *single* literal (unit propagation, one edge, no branching). A false literal in a 3-clause leaves a 2-clause — a *disjunction*, a branch. That branching is what backtracking SAT solvers must explore; it cannot be captured by simple graph edges, which is the P / NP-complete boundary.

### P4. What is the complexity of counting 2-SAT solutions?
**#P-complete** (Valiant). Even though we decide SAT and produce one witness in linear time, counting all satisfying assignments is as hard as counting solutions to any NP-search problem. No polynomial counting algorithm is known.

### P5. What about maximizing satisfied clauses (MAX-2-SAT)?
**NP-hard** (APX-complete). Reduces from MAX-CUT; hard to approximate beyond a fixed ratio (best known polynomial approximation ~0.940 via semidefinite programming). Full satisfiability is linear, but the optimization relaxation is intractable.

### P6. Describe the random 2-SAT satisfiability threshold.
For random `R(n, m)` with density `ρ = m/n`: as `n → ∞`, SAT whp when `ρ < 1`, UNSAT whp when `ρ > 1`; sharp transition at `ρ = 1`. It mirrors the emergence of a giant SCC in the random implication digraph. The algorithm stays `O(n+m)` regardless — the threshold concerns the answer's distribution, not runtime.

### P7. Why is the assignment-reading convention a recurring bug source, and how do you prove your implementation correct?
The correct comparison (`<` vs `>`) depends on whether the SCC routine numbers reverse- or forward-topologically. The fix is empirical proof: after solving, re-evaluate every clause under the recovered assignment and assert satisfaction; pair this with a brute-force fuzz oracle for small `n`. The proof that *some* consistent rule exists is the assignment theorem; *which* comparison realizes it is implementation-specific.

### P8 (analysis). 2-SAT is in NC — why don't we usually run it in parallel?
2-SAT ∈ NL ⊆ NC₂, so it's theoretically efficiently parallelizable. In practice, work-efficient parallel SCC is hard to implement and the sequential `O(n+m)` solve is already milliseconds-fast; the parallel constant factors and synchronization overhead rarely pay off. The NC membership is a structural statement, not a practical mandate.

---

## Behavioral / System-Design Questions (5)

### B1. Tell me about a time you modeled a messy real-world problem as a clean algorithm.
*Structure:* Situation (binary-choice constraints buried in business rules), Task (decide feasibility fast), Action (recognized it as 2-CNF, built a modeling layer mapping rules → clauses, used a generic SCC solver), Result (linear-time exact feasibility with a witness, replacing a slow heuristic). Emphasize separating modeling from solving.

### B2. Design a "seat assignment / two-room" feasibility checker.
Each guest is a boolean (room A / room B). Constraints ("X and Y can't share a room," "if X in A then Y in B") become 2-CNF clauses. Run 2-SAT for feasibility plus a concrete assignment; on infeasible, extract the conflict core to tell organizers which rules clash. Discuss latency budget and why 2-SAT's bounded runtime fits a request path.

### B3. A teammate's 2-SAT solver passes unit tests but gives wrong answers in production. How do you debug?
Reproduce with the production input; add a fuzz harness against a brute-force `2^n` oracle for small `n`; assert the recovered assignment re-satisfies every clause. Most likely culprits: edge direction (`a→b` vs `¬a→b`) or the `<`/`>` assignment convention after a SCC-library swap. Show systematic narrowing, not guessing.

### B4. How would you decide between 2-SAT and a general SAT solver for a new feature?
Check expressiveness: are all constraints binary-variable with ≤2-literal clauses? If yes, 2-SAT gives linear, predictable, never-times-out behavior — ideal for a latency-bound path. If any constraint needs 3+ literals or non-boolean domains, use a real SAT/CSP solver and accept unpredictable tail latency, or move it off the hot path.

### B5. Describe a trade-off you made between generality and predictability.
Talk through choosing the specialized 2-SAT solver over a general one: you lose the ability to express richer constraints but gain a hard latency bound and a correctness proof. Frame it as fitting the tool to the actual constraint shape and guarding the boundary (reject inputs that don't fit rather than bending the tool).

---

## Coding Challenges

### Challenge 1 — Basic satisfiability (decision only)

**Problem.** Given `n` variables and a list of 2-literal clauses, return whether the formula is satisfiable.

**Approach.** Build implication graph, run Tarjan SCC, return false iff some `comp[2i] == comp[2i+1]`.

#### Go
```go
package main

import "fmt"

func feasible(n int, clauses [][4]int) bool {
	adj := make([][]int, 2*n)
	node := func(v int, val int) int {
		if val == 1 {
			return 2 * v
		}
		return 2*v + 1
	}
	neg := func(x int) int { return x ^ 1 }
	for _, c := range clauses {
		x, y := node(c[0], c[1]), node(c[2], c[3])
		adj[neg(x)] = append(adj[neg(x)], y)
		adj[neg(y)] = append(adj[neg(y)], x)
	}
	N := 2 * n
	index := make([]int, N)
	low := make([]int, N)
	on := make([]bool, N)
	comp := make([]int, N)
	for i := range index {
		index[i], comp[i] = -1, -1
	}
	var stk []int
	idx, cc := 0, 0
	for s := 0; s < N; s++ {
		if index[s] != -1 {
			continue
		}
		type fr struct{ v, p int }
		st := []fr{{s, 0}}
		for len(st) > 0 {
			f := &st[len(st)-1]
			v := f.v
			if f.p == 0 {
				index[v], low[v] = idx, idx
				idx++
				stk = append(stk, v)
				on[v] = true
			}
			if f.p < len(adj[v]) {
				w := adj[v][f.p]
				f.p++
				if index[w] == -1 {
					st = append(st, fr{w, 0})
				} else if on[w] && index[w] < low[v] {
					low[v] = index[w]
				}
				continue
			}
			if low[v] == index[v] {
				for {
					w := stk[len(stk)-1]
					stk = stk[:len(stk)-1]
					on[w] = false
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
	for i := 0; i < n; i++ {
		if comp[2*i] == comp[2*i+1] {
			return false
		}
	}
	return true
}

func main() {
	fmt.Println(feasible(2, [][4]int{{0, 1, 1, 1}, {0, 0, 1, 1}, {0, 0, 1, 0}})) // true
	fmt.Println(feasible(1, [][4]int{{0, 1, 0, 1}, {0, 0, 0, 0}}))               // false
}
```

#### Java
```java
import java.util.*;

public class Feasible {
    static boolean feasible(int n, int[][] clauses) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < 2 * n; i++) adj.add(new ArrayList<>());
        for (int[] c : clauses) {
            int x = c[1] == 1 ? 2 * c[0] : 2 * c[0] + 1;
            int y = c[3] == 1 ? 2 * c[2] : 2 * c[2] + 1;
            adj.get(x ^ 1).add(y);
            adj.get(y ^ 1).add(x);
        }
        int N = 2 * n;
        int[] index = new int[N], low = new int[N], comp = new int[N];
        boolean[] on = new boolean[N];
        Arrays.fill(index, -1);
        Arrays.fill(comp, -1);
        int[] stk = new int[N];
        int sp = 0, idx = 0, cc = 0;
        for (int s = 0; s < N; s++) {
            if (index[s] != -1) continue;
            Deque<int[]> st = new ArrayDeque<>();
            st.push(new int[]{s, 0});
            while (!st.isEmpty()) {
                int[] f = st.peek();
                int v = f[0];
                if (f[1] == 0) { index[v] = low[v] = idx++; stk[sp++] = v; on[v] = true; }
                if (f[1] < adj.get(v).size()) {
                    int w = adj.get(v).get(f[1]++);
                    if (index[w] == -1) st.push(new int[]{w, 0});
                    else if (on[w]) low[v] = Math.min(low[v], index[w]);
                    continue;
                }
                if (low[v] == index[v]) {
                    while (true) { int w = stk[--sp]; on[w] = false; comp[w] = cc; if (w == v) break; }
                    cc++;
                }
                st.pop();
                if (!st.isEmpty()) low[st.peek()[0]] = Math.min(low[st.peek()[0]], low[v]);
            }
        }
        for (int i = 0; i < n; i++) if (comp[2 * i] == comp[2 * i + 1]) return false;
        return true;
    }

    public static void main(String[] args) {
        System.out.println(feasible(2, new int[][]{{0,1,1,1},{0,0,1,1},{0,0,1,0}})); // true
        System.out.println(feasible(1, new int[][]{{0,1,0,1},{0,0,0,0}}));           // false
    }
}
```

#### Python
```python
def feasible(n, clauses):
    adj = [[] for _ in range(2 * n)]
    node = lambda v, val: 2 * v if val else 2 * v + 1
    for a, va, b, vb in clauses:
        x, y = node(a, va), node(b, vb)
        adj[x ^ 1].append(y)
        adj[y ^ 1].append(x)
    N = 2 * n
    index = [-1] * N; low = [0] * N; comp = [-1] * N; on = [False] * N
    stk = []; idx = cc = 0
    for s in range(N):
        if index[s] != -1:
            continue
        st = [(s, 0)]
        while st:
            v, p = st[-1]
            if p == 0:
                index[v] = low[v] = idx; idx += 1; stk.append(v); on[v] = True
            if p < len(adj[v]):
                w = adj[v][p]; st[-1] = (v, p + 1)
                if index[w] == -1: st.append((w, 0))
                elif on[w]: low[v] = min(low[v], index[w])
                continue
            if low[v] == index[v]:
                while True:
                    w = stk.pop(); on[w] = False; comp[w] = cc
                    if w == v: break
                cc += 1
            st.pop()
            if st:
                pp = st[-1][0]; low[pp] = min(low[pp], low[v])
    return all(comp[2 * i] != comp[2 * i + 1] for i in range(n))


print(feasible(2, [(0, True, 1, True), (0, False, 1, True), (0, False, 1, False)]))  # True
print(feasible(1, [(0, True, 0, True), (0, False, 0, False)]))                        # False
```

---

### Challenge 2 — Recover a satisfying assignment (the boolean puzzle)

**Problem.** Return an actual satisfying assignment, or report UNSAT. (This is the full solver — reuse the junior/middle `Solve`.) Use the assignment rule `xi = true ⟺ comp[2i] < comp[2i+1]`.

**Key point to state in interview:** after the SCC pass and SAT check, recovery is a single `O(n)` loop comparing the two component ids per variable. Always re-verify by re-evaluating clauses.

```python
# Reuse feasible()'s SCC computation but return comp, then:
def solve(n, clauses):
    # ... identical SCC pass producing comp[] ...
    # for brevity, call the middle.md TwoSAT.solve(); assignment line:
    #   assign[i] = comp[2*i] < comp[2*i+1]
    ...
```

The complete, verified `solve` appears in `middle.md` (with a clause-re-evaluation `verify`). State the rule and the verification step; that is what interviewers want to hear.

---

### Challenge 3 — Two-room assignment ("choose one of two" puzzle)

**Problem.** `n` people, each must go to room A (`true`) or room B (`false`). Given a list of "pair `(u, v)` cannot share room A" and "pair `(u, v)` must be in different rooms" constraints, decide if a valid placement exists and produce one.

**Modeling.**
- "u, v cannot both be in A" → `(¬xu ∨ ¬xv)` → `add_clause(u, false, v, false)`.
- "u, v must differ" → `(xu ∨ xv) ∧ (¬xu ∨ ¬xv)` → two clauses.

#### Go
```go
package main

import "fmt"

// uses TwoSAT from junior.md (NewTwoSAT, AddClause, Solve)

func main() {
	ts := NewTwoSAT(3) // 0,1,2 ; true = room A
	ts.AddClause(0, false, 1, false) // 0 and 1 not both in A
	// 1 and 2 must differ:
	ts.AddClause(1, true, 2, true)
	ts.AddClause(1, false, 2, false)
	if a, ok := ts.Solve(); ok {
		fmt.Println("placement (true=A):", a)
	} else {
		fmt.Println("infeasible")
	}
}
```

#### Java
```java
// uses TwoSAT from junior.md (addClause, solve)
public class Rooms {
    public static void main(String[] args) {
        TwoSAT ts = new TwoSAT(3);
        ts.addClause(0, false, 1, false);  // not both in A
        ts.addClause(1, true, 2, true);    // 1,2 differ (at least one A)
        ts.addClause(1, false, 2, false);  // 1,2 differ (at most one A)
        boolean[] a = ts.solve();
        System.out.println(a == null ? "infeasible" : "placement: " + java.util.Arrays.toString(a));
    }
}
```

#### Python
```python
# uses TwoSAT from junior.md (add_clause, solve)
def two_room(n, not_both_A, must_differ):
    ts = TwoSAT(n)
    for u, v in not_both_A:
        ts.add_clause(u, False, v, False)
    for u, v in must_differ:
        ts.add_clause(u, True, v, True)
        ts.add_clause(u, False, v, False)
    a = ts.solve()
    return a  # None if infeasible


print(two_room(3, [(0, 1)], [(1, 2)]))
```

**Talking point:** this *is* graph 2-coloring with extra constraints. 2-SAT subsumes 2-colorability checks when constraints mix "same" and "different."

---

### Challenge 4 — Are all variable-pairs jointly forceable? (forced-literal query)

**Problem.** Given a satisfiable formula, for a query "can `xi = true` in some satisfying assignment?", answer each query in linear time.

**Approach.** `xi` can be true in some assignment iff forcing `xi = true` (add `(xi ∨ xi)`) keeps the formula satisfiable. Equivalently, using the SCC structure: `xi` can be true iff `comp[2i] != comp[2i+1]` AND it's consistent — but the clean, always-correct method is to re-solve with the forcing clause added to a copy.

#### Go
```go
package main

import "fmt"

func canBeTrue(n int, clauses [][4]int, i int) bool {
	c := append([][4]int(nil), clauses...)
	c = append(c, [4]int{i, 1, i, 1}) // force xi = true
	return feasible(n, c)             // feasible() from Challenge 1
}

func main() {
	cls := [][4]int{{0, 1, 1, 1}, {0, 0, 1, 1}} // (x0∨x1)∧(¬x0∨x1)
	fmt.Println(canBeTrue(2, cls, 0)) // can x0 be true? yes
	fmt.Println(canBeTrue(2, cls, 1)) // can x1 be true? yes
}
```

#### Java
```java
import java.util.*;
public class ForcedQuery {
    static boolean canBeTrue(int n, int[][] clauses, int i) {
        int[][] c = Arrays.copyOf(clauses, clauses.length + 1);
        c[clauses.length] = new int[]{i, 1, i, 1}; // force xi true
        return Feasible.feasible(n, c);             // from Challenge 1
    }
    public static void main(String[] args) {
        int[][] cls = {{0,1,1,1},{0,0,1,1}};
        System.out.println(canBeTrue(2, cls, 0)); // true
        System.out.println(canBeTrue(2, cls, 1)); // true
    }
}
```

#### Python
```python
def can_be_true(n, clauses, i):
    c = clauses + [(i, True, i, True)]  # force xi true
    return feasible(n, c)               # from Challenge 1


cls = [(0, True, 1, True), (0, False, 1, True)]
print(can_be_true(2, cls, 0))  # True
print(can_be_true(2, cls, 1))  # True
```

**Talking point:** each query is an independent linear-time solve. For many queries you can precompute the SCC structure once and answer "is `xi` forced?" by comparing `comp[2i]` and `comp[2i+1]` plus a downstream-reachability check — but the copy-and-resolve approach is the safe, clearly-correct baseline to state first.

---

**Final interview tip:** The two things that separate a confident 2-SAT answer from a shaky one are (1) crisply stating the clause→two-edges rewrite and the same-SCC criterion, and (2) acknowledging the assignment-convention subtlety and that you'd verify it by re-evaluating clauses. Mention the 2-vs-3 cliff (P vs NP-complete) to show you understand *why* the restriction matters.
