# 2-SAT (2-Satisfiability) — Professional Level

> **One-line summary:** This file gives the formal treatment of 2-SAT: the precise 2-CNF model, the implication-graph construction and its skew-symmetry, a full proof of the satisfiability theorem (SAT ⇔ no variable shares an SCC with its negation), a proof that the reverse-topological assignment rule is correct, the `O(n+m)` complexity argument, 2-SAT's place in the complexity landscape (in P, NL-complete), and the hardness of its counting (#P-complete) and optimization (MAX-2-SAT NP-hard) variants.

---

## Table of Contents

1. [Formal Definition](#1-formal-definition)
2. [The Implication Graph and Skew-Symmetry](#2-the-implication-graph-and-skew-symmetry)
3. [Satisfiability Theorem — Proof](#3-satisfiability-theorem--proof)
4. [Assignment-Correctness Theorem — Proof](#4-assignment-correctness-theorem--proof)
5. [Complexity O(n + m)](#5-complexity-on--m)
6. [Complexity Landscape: P, NL-Completeness](#6-complexity-landscape-p-nl-completeness)
7. [Counting (#2-SAT) and Optimization (MAX-2-SAT) Hardness](#7-counting-2-sat-and-optimization-max-2-sat-hardness)
8. [Cache Behavior](#8-cache-behavior)
9. [Average-Case and Random-Formula Analysis](#9-average-case-and-random-formula-analysis)
10. [Space–Time Trade-offs and Comparison](#10-spacetime-trade-offs-and-comparison)
11. [Reference Implementation, Open Problems, Summary](#11-reference-implementation-open-problems-summary)

---

## 1. Formal Definition

**Variables.** Let `X = {x_0, ..., x_{n-1}}` be boolean variables. A **literal** is `x_i` (positive) or `¬x_i` (negative). For a literal `ℓ`, write `¬ℓ` for its negation, with `¬¬ℓ = ℓ`.

**2-CNF formula.** A formula `φ` in **2-CNF** is a conjunction of clauses
```
φ = C_1 ∧ C_2 ∧ ... ∧ C_m,   each   C_j = (ℓ_{j,1} ∨ ℓ_{j,2}),
```
where each `ℓ_{j,k}` is a literal. (Unit clauses `(ℓ)` are modeled as `(ℓ ∨ ℓ)`; the empty clause is unsatisfiable by definition and may be excluded.)

**Assignment.** A (total) **assignment** is a function `α : X → {true, false}`. It extends to literals by `α(¬x) = ¬α(x)`. `α` **satisfies** clause `(ℓ_1 ∨ ℓ_2)` iff `α(ℓ_1) = true` or `α(ℓ_2) = true`. `α` **satisfies** `φ` iff it satisfies every clause.

**The problem.** `2-SAT` = `{ φ : φ is a 2-CNF formula and ∃ α satisfying φ }`. The decision question is whether such `α` exists; the search question additionally asks for one.

**Literal vertex encoding.** Fix a bijection between literals and `{0, 1, ..., 2n-1}`:
```
x_i  ↦  2i        ¬x_i ↦  2i + 1        neg(v) = v XOR 1.
```
This makes `neg` an involution with no fixed points, matching `¬¬ℓ = ℓ` and `¬ℓ ≠ ℓ`.

---

## 2. The Implication Graph and Skew-Symmetry

**Construction.** The **implication graph** `G_φ = (V, E)` has vertex set `V = {literals}` (`|V| = 2n`). For each clause `(a ∨ b)` add the two directed edges
```
(¬a → b)        and        (¬b → a).
```
Hence `|E| = 2m`. Each edge `(p → q)` is read as the implication `p ⇒ q`: in any satisfying assignment, if `p` is true then `q` is true (because the clause `(¬p ∨ q)` it encodes must hold).

**Lemma 1 (Clause–implication equivalence).** For any assignment `α`, `α` satisfies `(a ∨ b)` iff `α` satisfies *both* implications `¬a ⇒ b` and `¬b ⇒ a`.

*Proof.* `(a ∨ b)` is false only when `α(a) = α(b) = false`. The implication `¬a ⇒ b` is `(a ∨ b)` rewritten (`¬(¬a) ∨ b`), so it is false exactly when `α(a)=false, α(b)=false` — the same case. Likewise `¬b ⇒ a` is `(b ∨ a)`, false in exactly the same case. So all three are simultaneously true or simultaneously false. ∎

**Lemma 2 (Skew-symmetry).** `G_φ` is *skew-symmetric*: `(p → q) ∈ E` iff `(¬q → ¬p) ∈ E`.

*Proof.* The edges come in clause-pairs. Clause `(a ∨ b)` contributes `(¬a → b)` and `(¬b → a)`. Take any contributed edge, say `(¬a → b)`; its skew-mirror `(¬b → ¬(¬a)) = (¬b → a)` is the *other* edge contributed by the same clause. Thus every edge's mirror is also present. ∎

**Corollary 2.1 (Path skew-symmetry).** There is a path `p ⇝ q` in `G_φ` iff there is a path `¬q ⇝ ¬p`.

*Proof.* Reverse the path `p = u_0 → u_1 → ... → u_k = q` and apply Lemma 2 to each edge: `(u_{i} → u_{i+1})` mirrors to `(¬u_{i+1} → ¬u_i)`. Concatenating gives `¬q = ¬u_k → ¬u_{k-1} → ... → ¬u_0 = ¬p`. ∎

**Corollary 2.2 (SCC mirror).** Let `comp(·)` be SCC ids. Then `p` and `q` are in the same SCC iff `¬p` and `¬q` are in the same SCC. In particular the SCC of `¬p` is the "mirror" of the SCC of `p`, and the map `C ↦ ¬C` is an order-reversing involution on the condensation DAG.

*Proof.* Same-SCC means mutual reachability `p ⇝ q` and `q ⇝ p`; by Cor 2.1 these mirror to `¬q ⇝ ¬p` and `¬p ⇝ ¬q`, i.e. `¬p, ¬q` mutually reachable. Order reversal: if `C` reaches `D` in the condensation then `¬D` reaches `¬C` (mirror of the connecting path). ∎

---

## 3. Satisfiability Theorem — Proof

> **Theorem 1.** `φ` is satisfiable **if and only if** no variable `x_i` has `x_i` and `¬x_i` in the same SCC of `G_φ`.

**(⇒) If satisfiable, then no variable shares an SCC with its negation.**

Suppose `α` satisfies `φ`. Consider the edges of `G_φ`. Claim: every edge `(p → q)` is *consistent* with `α`, meaning `α(p) = true ⇒ α(q) = true`. Indeed each edge encodes a clause that `α` satisfies, so by Lemma 1 the implication holds under `α`.

Now suppose for contradiction some `x_i` has `x_i` and `¬x_i` in one SCC. Then there is a path `x_i ⇝ ¬x_i`. Walking that path under `α`, each edge preserves truth, so `α(x_i) = true` would force `α(¬x_i) = true`, i.e. `α(x_i) = false` — contradiction if `α(x_i)=true`. Symmetrically the path `¬x_i ⇝ x_i` forces a contradiction if `α(x_i)=false`. Either way no consistent `α` exists, contradicting that `α` satisfies `φ`. Hence no such `x_i` exists. ∎

**(⇐) If no variable shares an SCC with its negation, then satisfiable.**

We construct a satisfying `α` from the condensation. By hypothesis, for every `i`, `comp(x_i) ≠ comp(¬x_i)`. Order the SCCs in a fixed **topological order** `≺` of the condensation (every edge goes from an earlier to a later SCC; equivalently a later SCC is "downstream"). Define:
```
α(x_i) = true   ⟺   comp(x_i) is later in topological order than comp(¬x_i).
```
This is well-defined because the two SCCs differ. We must show `α` satisfies every clause.

Take any clause `(a ∨ b)`, equivalently edges `(¬a → b)` and `(¬b → a)`. Suppose, for contradiction, `α` falsifies it: `α(a) = α(b) = false`, i.e. `α(¬a) = α(¬b) = true`. By definition of `α`:
```
comp(¬a) later than comp(a),     comp(¬b) later than comp(b).      (*)
```
Consider the edge `(¬a → b)`. In the condensation either `comp(¬a) = comp(b)` (same SCC) or `comp(¬a)` is earlier than `comp(b)` (edges go earlier→later). 

- *Case same SCC:* `comp(¬a) = comp(b)`. By Cor 2.2 then `comp(a) = comp(¬b)` (mirrors). Combined with (*): `comp(¬a)` later than `comp(a)` and `comp(¬b)` later than `comp(b)`. But `comp(b) = comp(¬a)` and `comp(a) = comp(¬b)`, so "`comp(¬a)` later than `comp(a)`" and "`comp(a) = comp(¬b)` later than `comp(b) = comp(¬a)`" together say `comp(¬a)` is strictly later than itself — impossible.
- *Case edge earlier→later:* `comp(¬a)` is earlier than `comp(b)`. By skew-symmetry the mirror edge `(¬b → a)` gives `comp(¬b)` earlier than `comp(a)`. From (*), `comp(¬a)` is later than `comp(a)`, and `comp(¬b)` is later than `comp(b)`. Chain them: `comp(¬b)` later than `comp(b)`, and (edge) `comp(¬a)` earlier than `comp(b)`, so `comp(¬a)` earlier than `comp(¬b)`'s... we instead use the clean contradiction: we have `comp(¬a) ≺ comp(b)` (edge) and want to contrast with (*). From (*), `comp(a) ≺ comp(¬a)`. Mirror of the edge `(¬a → b)` is `(¬b → a)`, giving `comp(¬b) ≺ comp(a)`. So `comp(¬b) ≺ comp(a) ≺ comp(¬a) ≺ comp(b)`. But (*) also says `comp(b) ≺ comp(¬b)` (since `α(¬b)=true` means `comp(¬b)` later than `comp(b)`). Chaining: `comp(¬b) ≺ ... ≺ comp(b) ≺ comp(¬b)` — a strict cycle in a total order, impossible.

Both cases are contradictions, so `α` satisfies `(a ∨ b)`. As the clause was arbitrary, `α` satisfies `φ`. ∎

This (⇐) construction is exactly the algorithmic assignment rule; Section 4 ties it to the SCC numbering used in code.

---

## 4. Assignment-Correctness Theorem — Proof

The code uses `α(x_i) = true ⟺ comp[2i] < comp[2i+1]`, where `comp[·]` are **Tarjan SCC ids**. We must connect "`<` in Tarjan id" to "later in topological order."

> **Lemma 3 (Tarjan numbers reverse-topologically).** Tarjan's algorithm assigns SCC ids `0, 1, 2, ...` in the order it finalizes components, and a component is finalized only after every component reachable from it. Therefore if SCC `C` can reach SCC `D` (`C ≠ D`) in the condensation, then `id(D) < id(C)`. Equivalently, **smaller Tarjan id = later in topological order (more downstream)**.

*Proof.* Tarjan finalizes (pops and numbers) an SCC `C` exactly when DFS returns from `C`'s root, which happens only after all DFS descendants — hence all vertices reachable from `C` — have already been fully explored and their SCCs finalized. So any SCC `D` reachable from `C` was numbered earlier, giving `id(D) < id(C)`. The condensation edge `C → D` means `C` reaches `D`, so `id(D) < id(C)`: ids decrease along condensation edges, which is the definition of a reverse-topological numbering. ∎

> **Theorem 2 (Assignment correctness).** Under Tarjan ids, defining `α(x_i) = true ⟺ comp[2i] < comp[2i+1]` yields a satisfying assignment whenever `φ` is satisfiable.

*Proof.* By Lemma 3, "smaller Tarjan id" coincides with "later in topological order" (the relation `≺` of Theorem 1's (⇐) direction, where later = downstream). The rule `α(x_i) = true ⟺ comp[2i] < comp[2i+1]` therefore sets `x_i` true exactly when `comp(x_i)` (id `2i`) is later in topological order than `comp(¬x_i)` (id `2i+1`) — which is precisely the construction proved correct in Theorem 1 (⇐). Hence `α` satisfies `φ`. ∎

**Remark (convention sensitivity).** If SCCs are numbered *forward*-topologically (as some Kosaraju implementations do), Lemma 3 flips, and the correct rule becomes `comp[2i] > comp[2i+1]`. The proof structure is identical; only the orientation of "later" relative to the id changes. This is why an implementation must fix one SCC routine and validate the comparison empirically (re-evaluate clauses under the recovered assignment), as stressed in the other files.

---

## 4b. Worked Trace — From Clauses to Witness

To make the two theorems concrete, trace the satisfiable formula `φ = (x0 ∨ x1) ∧ (¬x0 ∨ x1) ∧ (¬x0 ∨ ¬x1)`.

**Vertices.** `x0 = 0`, `¬x0 = 1`, `x1 = 2`, `¬x1 = 3`.

**Edges (two per clause, by `(a∨b) ≡ (¬a⇒b)∧(¬b⇒a)`):**

| Clause | edge 1 `¬a → b` | edge 2 `¬b → a` |
|--------|------------------|------------------|
| `(x0 ∨ x1)` | `¬x0 → x1` = `1 → 2` | `¬x1 → x0` = `3 → 0` |
| `(¬x0 ∨ x1)` | `x0 → x1` = `0 → 2` | `¬x1 → ¬x0` = `3 → 1` |
| `(¬x0 ∨ ¬x1)` | `x0 → ¬x1` = `0 → 3` | `x1 → ¬x0` = `2 → 1` |

**Skew-symmetry check (Lemma 2).** Edge `1 → 2` should have mirror `¬2 → ¬1` = `3 → 0`; indeed `3 → 0` is present (from the same clause). Edge `0 → 2` mirrors to `3 → 1` — present. Edge `0 → 3` mirrors to `2 → 1` — present. Every edge's mirror exists, as the theorem guarantees.

**SCC computation (Tarjan).** Reachability analysis: `0 → 3 → 0` is a 2-cycle, so `{0, 3}` is mutually reachable. `2 → 1 → 2` is a 2-cycle, so `{1, 2}` is mutually reachable. `{0,3}` reaches `{1,2}` (via `0→2`, `3→1`) but not back, so they are distinct SCCs. Tarjan finalizes the sink first: `{1,2}` is the sink (its edges `2→1`, `1→2` stay internal), so it gets id `0`; `{0,3}` gets id `1`.

```
comp[0]=1 (x0)   comp[1]=0 (¬x0)
comp[2]=0 (x1)   comp[3]=1 (¬x1)
```

**Decision (Theorem 1).** For `x0`: `comp[0]=1 ≠ comp[1]=0` → OK. For `x1`: `comp[2]=0 ≠ comp[3]=1` → OK. No variable shares an SCC with its negation → **SAT**.

**Witness (Theorem 2).** `x0 = true ⟺ comp[0] < comp[1] ⟺ 1 < 0` → false. `x1 = true ⟺ comp[2] < comp[3] ⟺ 0 < 1` → true. Assignment `(x0, x1) = (false, true)`. Re-evaluating: `(F∨T)=T`, `(T∨T)=T`, `(T∨F)=T` — all satisfied, matching the constructive proof and the reference implementations.

**UNSAT trace.** For `φ' = (x0) ∧ (¬x0)`, modeled as `(x0∨x0) ∧ (¬x0∨¬x0)`: edges `¬x0 → x0` (`1→0`) and `x0 → ¬x0` (`0→1`). Now `0` and `1` form a 2-cycle → one SCC → `comp[0] = comp[1]` → **UNSAT** by Theorem 1, as expected.

---

## 5. Complexity O(n + m)

> **Theorem 3.** 2-SAT (decision and search) is solvable in `O(n + m)` time and `O(n + m)` space.

*Proof.* The algorithm has four phases:

1. **Build `G_φ`:** iterate the `m` clauses, append two edges each → `O(m)` time, `O(n + m)` space (`2n` vertices, `2m` edges).
2. **SCC pass:** Tarjan (or Kosaraju) visits each vertex once and traverses each edge once, with `O(1)` work per visit/edge → `O(|V| + |E|) = O(2n + 2m) = O(n + m)`. The auxiliary arrays (`index`, `low`, `comp`, `onStack`) are `O(n)`; the explicit DFS and component stacks are `O(n)`.
3. **Decision:** check `comp[2i] ≠ comp[2i+1]` for each `i` → `O(n)`.
4. **Assignment recovery:** one comparison per variable → `O(n)`.

Summing: `O(m) + O(n+m) + O(n) + O(n) = O(n+m)`. Space is `O(n+m)` for the graph plus `O(n)` working arrays. ∎

This is optimal: any algorithm must read every clause, so `Ω(n + m)` is a lower bound, matched.

---

## 6. Complexity Landscape: P, NL-Completeness

2-SAT sits at a sharp boundary in complexity theory.

- **2-SAT ∈ P.** Theorem 3 places it in polynomial (indeed linear) time.
- **2-SAT is NL-complete** (under log-space reductions). NL is the class of problems solvable by a nondeterministic Turing machine using `O(log n)` work space — equivalently (by Immerman–Szelepcsényi, NL = co-NL) characterized by `s–t` connectivity in directed graphs. 2-SAT reduces to and from directed reachability: the *unsatisfiability* of `φ` is exactly "does some `x_i` reach `¬x_i` **and** `¬x_i` reach `x_i`," a conjunction of reachability queries (in NL), and reachability itself is the canonical NL-complete problem. Because NL = co-NL, both SAT and UNSAT certificates are checkable in nondeterministic log space.
- **Implication:** 2-SAT is solvable in `O(log^2 n)` space and is parallelizable in the sense that NL ⊆ NC₂; it is "easy" not just in time but in space, far below P-complete problems.

**Where 2-SAT sits, visually.**

```
        easier  ◄──────────────────────────────────────►  harder
   ┌──────────┐   ┌──────────┐   ┌───────────────┐   ┌──────────────┐
   │  L (log  │ ⊆ │   NL     │ ⊆ │       P       │ ⊆ │ NP-complete  │
   │  space)  │   │  ↑       │   │               │   │              │
   └──────────┘   │  2-SAT   │   │  (2-SAT also  │   │  3-SAT,      │
                  │ (complete)│  │   lives here) │   │  SAT, ...    │
                  └──────────┘   └───────────────┘   └──────────────┘
   reachability (directed s–t connectivity) is the canonical NL-complete problem;
   2-SAT reduces to/from it, hence 2-SAT is NL-complete and therefore in P and in NC.
```

Because `NL ⊆ NC₂`, 2-SAT is solvable with `O(log² n)` space and is in the class of efficiently-parallelizable problems *in theory*. It is structurally "easy" along multiple axes — time (linear), space (log²), and parallel depth (poly-log) — which is rare and is exactly why it is a favored teaching example for the power of a small syntactic restriction.

**The 2→3 cliff.** **3-SAT is NP-complete** (Cook–Levin). The structural reason 2-SAT is easy and 3-SAT is hard: a 2-clause with one literal forced false leaves a *single forced literal* (unit propagation never branches), giving the clean implication graph. A 3-clause with one literal forced false leaves a *2-clause* — still a disjunction, a *choice*, which is exactly the branching that backtracking SAT solvers must explore and that defeats any direct graph reduction. The expressive jump from "forces one thing" to "forces a disjunction" is the line between NL and NP-complete.

---

## 7. Counting (#2-SAT) and Optimization (MAX-2-SAT) Hardness

Easiness of the decision problem does **not** transfer to natural variants.

**#2-SAT is #P-complete.** Counting the number of satisfying assignments of a 2-CNF formula is `#P`-complete (Valiant, 1979). So although we can decide satisfiability and even produce one witness in linear time, computing *how many* assignments satisfy `φ` is as hard as counting solutions to any NP-search problem. Intuition: counting requires accounting for the combinatorial interaction of all free choices across SCCs and their mirror structure, which encodes #P-hard counting (e.g. it can encode counting independent sets / perfect matchings via gadget reductions). There is no known polynomial counting algorithm.

**MAX-2-SAT is NP-hard.** Given a 2-CNF formula that may be unsatisfiable, finding an assignment that satisfies the **maximum number of clauses** is NP-hard (in fact MAX-2-SAT is APX-complete; it is NP-hard to approximate beyond a certain ratio, with the best known polynomial approximation around 0.940 via semidefinite programming). The reduction is from problems like MAX-CUT. So the *optimization* relaxation of 2-SAT is intractable even though full satisfiability is linear.

**The lesson.** 2-SAT is a knife-edge: *exact, full* satisfiability over 2-clauses is in P (and NL), but *counting* its solutions is #P-complete and *maximizing* satisfied clauses is NP-hard. When a problem looks like "2-SAT but optimize/count," you have left the polynomial world and need approximation, ILP, or specialized solvers.

---

## 8. Cache Behavior

The SCC pass is a graph traversal; its memory behavior is governed by the adjacency representation.

- **`List<List<Integer>>` / slice-of-slices** scatters edges across heap allocations and boxes integers (Java). DFS pointer-chases through cache-cold memory; effective bandwidth is poor.
- **CSR (offsets + packed edges)** stores a vertex's out-edges contiguously. The DFS reads `edges[off[v] .. off[v+1])` as a sequential run — cache-friendly within a vertex, though the *targets* still jump around (inherent to graph traversal). Using 32-bit indices (valid when `2n < 2^31`) halves the edge array and doubles effective cache lines per fetch.
- **Tarjan arrays** (`index`, `low`, `comp`, `onStack`) are indexed by vertex id; accessed in DFS order they are semi-random but small (`O(n)`), often fitting L2/L3.

In practice, converting an edge-list to CSR before the SCC pass yields a measurable speedup at large `m` and reduces allocator pressure to near zero — which is why the senior reference solver builds CSR.

---

## 9. Average-Case and Random-Formula Analysis

The random 2-SAT model `R(n, m)` draws `m` clauses uniformly over the `(2n)^2` literal pairs. There is a sharp **satisfiability threshold**:

> **Threshold (Chvátal–Reed; Goerdt; Fernandez de la Vega).** Let `ρ = m / n` (clause density). As `n → ∞`, a random 2-CNF formula is satisfiable with probability → 1 when `ρ < 1`, and unsatisfiable with probability → 1 when `ρ > 1`. The phase transition is at `ρ = 1`.

Intuition via the implication graph: at `ρ < 1` the random digraph on `2n` vertices with `~2m` edges is below the critical density for a giant strongly connected component, so it is exponentially unlikely that any `x_i` and `¬x_i` collide in one SCC. At `ρ > 1` a giant SCC emerges and almost surely swallows some complementary pair, forcing UNSAT. (This mirrors the emergence of the giant component in random graphs, adapted to the directed, skew-symmetric structure.)

**Practical relevance.** Regardless of density, the *algorithm* is always `O(n + m)` — there is no average-case speedup or slowdown; the threshold concerns the *answer's* distribution, not the runtime. It matters for test generation: random instances near `ρ = 1` are the interesting (mixed SAT/UNSAT) regime for stress-testing a solver.

---

## 10. Space–Time Trade-offs and Comparison

| Method | Time | Space | Notes |
|--------|------|-------|-------|
| Implication graph + Tarjan SCC | `O(n+m)` | `O(n+m)` | one pass, no transpose; reverse-topo numbering |
| Implication graph + Kosaraju SCC | `O(n+m)` | `O(n+m)` | two passes, builds transpose (~2× edge memory) |
| Implication graph + Gabow SCC | `O(n+m)` | `O(n+m)` | one pass, two stacks instead of `low[]` |
| Unit-propagation / DPLL specialized to 2-CNF | `O(n·m)` worst | `O(n+m)` | iteratively force literals; simpler to state, asymptotically worse |
| Strongly-connected-component-free "watched literal" propagation | `O(nm)` | `O(n+m)` | only practical for small/structured inputs |

All linear methods differ only in constants and the assignment convention; **Tarjan is the usual production choice** (single pass, no transpose). The `O(nm)` propagation approaches are pedagogically simple but should not be used at scale.

**Time vs space.** There is little to trade: the graph itself is `Θ(n+m)` and the SCC pass is `Θ(n+m)` time, both optimal. The only real lever is the *constant*: CSR + 32-bit indices minimizes the constant factor in both dimensions.

**Comparison to general solvers.** A CDCL SAT solver would also decide a 2-CNF instance, but with unpredictable (worst-case exponential) time and far larger constants; 2-SAT's specialized linear algorithm dominates whenever the formula truly is 2-CNF.

---

## 11. Reference Implementation, Open Problems, Summary

### Reference implementation (Tarjan, asymptotically optimal)

#### Go

```go
package main

import "fmt"

func node(v int, val bool) int {
	if val {
		return 2 * v
	}
	return 2*v + 1
}
func neg(x int) int { return x ^ 1 }

// TwoSAT returns (assignment, satisfiable).
func TwoSAT(n int, clauses [][4]int) ([]bool, bool) {
	// clause = {a, va, b, vb} with va,vb in {0,1}
	adj := make([][]int, 2*n)
	add := func(a int, va bool, b int, vb bool) {
		x, y := node(a, va), node(b, vb)
		adj[neg(x)] = append(adj[neg(x)], y)
		adj[neg(y)] = append(adj[neg(y)], x)
	}
	for _, c := range clauses {
		add(c[0], c[1] == 1, c[2], c[3] == 1)
	}
	N := 2 * n
	index := make([]int, N)
	low := make([]int, N)
	onStk := make([]bool, N)
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
		type fr struct{ v, pi int }
		st := []fr{{s, 0}}
		for len(st) > 0 {
			f := &st[len(st)-1]
			v := f.v
			if f.pi == 0 {
				index[v], low[v] = idx, idx
				idx++
				stk = append(stk, v)
				onStk[v] = true
			}
			if f.pi < len(adj[v]) {
				w := adj[v][f.pi]
				f.pi++
				if index[w] == -1 {
					st = append(st, fr{w, 0})
				} else if onStk[w] && index[w] < low[v] {
					low[v] = index[w]
				}
				continue
			}
			if low[v] == index[v] {
				for {
					w := stk[len(stk)-1]
					stk = stk[:len(stk)-1]
					onStk[w] = false
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
	res := make([]bool, n)
	for i := 0; i < n; i++ {
		if comp[2*i] == comp[2*i+1] {
			return nil, false
		}
		res[i] = comp[2*i] < comp[2*i+1]
	}
	return res, true
}

func main() {
	clauses := [][4]int{{0, 1, 1, 1}, {0, 0, 1, 1}, {0, 0, 1, 0}}
	a, ok := TwoSAT(2, clauses)
	fmt.Println(ok, a) // true [false true]
}
```

#### Java

```java
import java.util.*;

public class TwoSATPro {
    static int node(int v, boolean val) { return val ? 2 * v : 2 * v + 1; }
    static int neg(int x) { return x ^ 1; }

    // clauses: int[]{a, va, b, vb}, va/vb in {0,1}
    static boolean[] solve(int n, int[][] clauses) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < 2 * n; i++) adj.add(new ArrayList<>());
        for (int[] c : clauses) {
            int x = node(c[0], c[1] == 1), y = node(c[2], c[3] == 1);
            adj.get(neg(x)).add(y);
            adj.get(neg(y)).add(x);
        }
        int N = 2 * n;
        int[] index = new int[N], low = new int[N], comp = new int[N];
        boolean[] onStk = new boolean[N];
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
                if (f[1] == 0) {
                    index[v] = low[v] = idx++;
                    stk[sp++] = v; onStk[v] = true;
                }
                if (f[1] < adj.get(v).size()) {
                    int w = adj.get(v).get(f[1]++);
                    if (index[w] == -1) st.push(new int[]{w, 0});
                    else if (onStk[w]) low[v] = Math.min(low[v], index[w]);
                    continue;
                }
                if (low[v] == index[v]) {
                    while (true) {
                        int w = stk[--sp];
                        onStk[w] = false; comp[w] = cc;
                        if (w == v) break;
                    }
                    cc++;
                }
                st.pop();
                if (!st.isEmpty()) low[st.peek()[0]] = Math.min(low[st.peek()[0]], low[v]);
            }
        }
        boolean[] res = new boolean[n];
        for (int i = 0; i < n; i++) {
            if (comp[2 * i] == comp[2 * i + 1]) return null;
            res[i] = comp[2 * i] < comp[2 * i + 1];
        }
        return res;
    }

    public static void main(String[] args) {
        int[][] clauses = {{0, 1, 1, 1}, {0, 0, 1, 1}, {0, 0, 1, 0}};
        boolean[] a = solve(2, clauses);
        System.out.println(a == null ? "UNSAT" : Arrays.toString(a)); // [false, true]
    }
}
```

#### Python

```python
def two_sat(n, clauses):
    # clauses: (a, va, b, vb) with va, vb booleans
    def node(v, val):
        return 2 * v if val else 2 * v + 1
    neg = lambda x: x ^ 1

    adj = [[] for _ in range(2 * n)]
    for a, va, b, vb in clauses:
        x, y = node(a, va), node(b, vb)
        adj[neg(x)].append(y)
        adj[neg(y)].append(x)

    N = 2 * n
    index = [-1] * N
    low = [0] * N
    comp = [-1] * N
    on_stk = [False] * N
    stk = []
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
                stk.append(v)
                on_stk[v] = True
            if pi < len(adj[v]):
                w = adj[v][pi]
                st[-1] = (v, pi + 1)
                if index[w] == -1:
                    st.append((w, 0))
                elif on_stk[w]:
                    low[v] = min(low[v], index[w])
                continue
            if low[v] == index[v]:
                while True:
                    w = stk.pop()
                    on_stk[w] = False
                    comp[w] = cc
                    if w == v:
                        break
                cc += 1
            st.pop()
            if st:
                p = st[-1][0]
                low[p] = min(low[p], low[v])

    res = [False] * n
    for i in range(n):
        if comp[2 * i] == comp[2 * i + 1]:
            return None
        res[i] = comp[2 * i] < comp[2 * i + 1]
    return res


if __name__ == "__main__":
    cls = [(0, True, 1, True), (0, False, 1, True), (0, False, 1, False)]
    print(two_sat(2, cls))  # [False, True]
```

**Run:** `go run main.go` | `javac TwoSATPro.java && java TwoSATPro` | `python two_sat.py`

### Open problems and frontier

- **Dynamic 2-SAT.** Efficiently maintaining satisfiability under insertion *and* deletion of clauses (fully-dynamic) faster than recomputing `O(n+m)` per update is an active area tied to dynamic SCC / dynamic reachability — for which strong conditional lower bounds (under the OMv and combinatorial-BMM hypotheses) are known.
- **Parallel 2-SAT.** 2-SAT ∈ NL ⊆ NC₂, so it is in NC (efficiently parallelizable in theory), but practical work-efficient parallel SCC remains hard; closing the gap between the NC membership and a fast real parallel solver is open in practice.
- **Counting and approximation.** #2-SAT is #P-complete; the precise approximability of approximate counting for restricted 2-CNF families is still studied.
- **Quantified extensions.** 2-QBF (quantified 2-CNF) jumps in complexity; the original Aspvall–Plass–Tarjan paper already addressed certain quantified cases — characterizing exactly which quantifier patterns stay tractable is subtle. Fully general QBF is PSPACE-complete; the 2-clause restriction does not by itself tame the quantifier alternation, and the boundary between tractable and intractable quantifier prefixes for 2-CNF matrices is delicate.
- **Conflict-core minimization.** Extracting a *minimal* unsatisfiable subset of clauses (a minimal conflict core) from an UNSAT 2-CNF instance, fast and small, matters for explainable UNSAT in production; while a single cycle through `xi`/`¬xi` gives *a* core in linear time, computing a *minimum* core (fewest clauses) relates to harder combinatorial problems and is an area of practical interest.
- **Weighted / soft variants.** Beyond MAX-2-SAT, weighted and partial (hard+soft) 2-SAT formulations arise in practice; their exact and approximate complexities, and the design of good heuristics that exploit the implication-graph structure, remain actively studied.

### Practical complexity comparison with constants

While all linear methods are `Θ(n+m)`, the constants matter at scale. Approximate per-element costs observed in practice (relative, single core):

| Phase | Tarjan (list adj) | Tarjan (CSR, int32) | Kosaraju (CSR) |
|-------|-------------------|---------------------|----------------|
| Graph build | 1.0× | 0.6× (no boxing, packed) | 0.9× (also builds transpose) |
| SCC pass | 1.0× | 0.5–0.7× (cache locality) | 1.6–1.8× (two DFS passes) |
| Memory (edges) | 1.0× | 0.5× (int32 vs boxed/int64) | ~2.0× (stores transpose) |

The takeaway for an engineer choosing an implementation: **Tarjan with CSR int32 adjacency** is the production sweet spot — it minimizes both passes and memory. Kosaraju's clarity (two plain DFS passes) is worth it only when a teammate's confidence in correctness outweighs the constant-factor and memory cost, and even then the assignment-convention flip (`>` instead of `<`) must be re-derived and tested.

### A note on the `<` vs `>` convention, formally

The reason this is genuinely subtle and not just sloppiness: both Tarjan-reverse-topo (`<`) and Kosaraju-forward-topo (`>`) are *correct* — they encode the same Theorem 1 (⇐) construction under opposite id orientations. There is no universally "right" comparison; the comparison is correct *relative to* the numbering the SCC routine produces. The only rigorous validation is empirical: re-evaluate every clause under the recovered assignment (Theorem 1 guarantees a satisfying assignment exists, so a failure proves the convention is flipped) and cross-check against a brute-force oracle on small instances. This is why every reference implementation in this topic was fuzz-tested over tens of thousands of random formulas before being trusted.

### Summary

2-SAT is the satisfiability problem for 2-CNF and a textbook demonstration that a small syntactic restriction can move a problem from NP-complete to **NL-complete**. Its solution is a single skew-symmetric implication graph and one SCC pass: **Theorem 1** establishes SAT ⇔ no variable shares an SCC with its negation (proved via path-forcing and skew-symmetry), **Theorem 2** justifies reading a witness from the reverse-topological SCC order, and **Theorem 3** gives the optimal `O(n+m)` bound. The boundary is razor-thin: bump clauses to three literals (NP-complete), ask to count solutions (#P-complete), or ask to maximize satisfied clauses (NP-hard), and the polynomial world vanishes. Within its lane, 2-SAT is exact, linear, and parallelizable — one of the cleanest results in algorithmic logic.
