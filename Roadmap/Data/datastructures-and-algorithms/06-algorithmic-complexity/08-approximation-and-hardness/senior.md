# Approximation and Hardness — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — approximation ratios, the `(1+ε)` family, PTAS vs FPTAS, the greedy/LP-rounding/local-search toolkit, and APX as a class
- [Reductions and NP-Completeness — Senior](../07-reductions-and-np-completeness/senior.md) — many-one reductions, L-reductions, gap-preserving reductions, the PCP pointer
- [Complexity Classes: P and NP — Senior](../06-complexity-classes-p-np/senior.md) — what NP-hardness licenses, the polynomial hierarchy, randomized verifiers

## Table of Contents

1. [What Senior-Level Hardness of Approximation Is About](#what-senior-level-hardness-of-approximation-is-about)
2. [Gap Problems: Hardness Becomes a Ratio](#gap-problems-hardness-becomes-a-ratio)
3. [Gap-Introducing and Gap-Preserving Reductions](#gap-introducing-and-gap-preserving-reductions)
4. [L-Reductions and AP-Reductions](#l-reductions-and-ap-reductions)
5. [The PCP Theorem](#the-pcp-theorem)
6. [PCP ⇔ Hardness of Approximation: The Equivalence](#pcp--hardness-of-approximation-the-equivalence)
7. [Håstad's Optimal Inapproximability](#hastads-optimal-inapproximability)
8. [The Landmark Bounds: Set Cover, Clique, Vertex Cover](#the-landmark-bounds-set-cover-clique-vertex-cover)
9. [The Unique Games Conjecture](#the-unique-games-conjecture)
10. [MAX-CUT, Goemans–Williamson, and Raghavendra's Dichotomy](#max-cut-goemans-williamson-and-raghavendras-dichotomy)
11. [The Positive Side the Theory Explains: When a PTAS Exists](#the-positive-side-the-theory-explains-when-a-ptas-exists)
12. [Decision Framework](#decision-framework)
13. [Research Pointers](#research-pointers)
14. [Key Takeaways](#key-takeaways)

---

## What Senior-Level Hardness of Approximation Is About

The middle level taught the *positive* craft: a `ρ`-approximation algorithm with a proof that `ALG ≤ ρ · OPT` (minimization) or `ALG ≥ OPT / ρ` (maximization); the PTAS/FPTAS hierarchy; the standard four rounding techniques. That tells you what you *can* achieve.

Senior-level approximation is about the **converse**: for which `ρ` is *no* polynomial-time `ρ`-approximation possible unless `P = NP`? This is **inapproximability** (hardness of approximation), and it is one of the deepest achievements of complexity theory. The shape of the subject is:

1. **Hardness of approximation is hardness of a *gap*.** "It is NP-hard to `ρ`-approximate `Π`" is *exactly* the statement "it is NP-hard to decide a promise problem where YES instances have `OPT ≥ c` and NO instances have `OPT ≤ s`, with `c/s = ρ`." Approximating better than `ρ` would solve the gap problem. So every inapproximability result is, underneath, an NP-hardness result for a **gap version**.
2. **The PCP theorem manufactures the gap.** Classical Cook–Levin reductions (see [`../07-reductions-and-np-completeness/senior.md`](../07-reductions-and-np-completeness/senior.md)) preserve *exact* satisfiability but say nothing about *near*-satisfiability — a formula one clause short of satisfiable maps to a graph one edge short of a clique, giving no gap. The **PCP theorem** is the result that re-encodes NP so that the gap is *constant*: it becomes NP-hard to distinguish "fully satisfiable" from "at most `(1−ε)`-satisfiable." That constant gap is the seed; every other bound is grown from it by gap-preserving reductions.
3. **Some bounds are *tight*.** For a few central problems the inapproximability threshold *exactly matches* the best algorithm: MAX-3SAT (Håstad's `7/8`), set cover (`ln n`), max-clique (`n^{1−ε}`). For these we *know* the approximability of the problem completely (modulo `P ≠ NP`).
4. **The Unique Games Conjecture closes most of the remaining gaps.** For a wide swath of problems — vertex cover, MAX-CUT, every constraint satisfaction problem — the *exact* threshold is known only *conditional on UGC*. Raghavendra's theorem says that, under UGC, a single semidefinite-programming algorithm is optimal for *every* CSP. This is the unifying conjecture of the field, still open.

The senior mindset: when you see a problem with a stubborn approximation ratio that no one improves, ask *whether the ratio is provably optimal* — and which assumption (`P ≠ NP`, or UGC) the optimality rests on.

---

## Gap Problems: Hardness Becomes a Ratio

Fix a maximization problem `Π` (the minimization story is symmetric). For `0 < s < c`, the **gap problem** `Gap-Π[c, s]` is a *promise problem*:

- **YES instances:** `OPT(x) ≥ c`.
- **NO instances:** `OPT(x) < s` (often written `OPT(x) ≤ s`).
- **Promise:** the input is guaranteed to be one or the other; `s ≤ OPT < c` instances are excluded — the algorithm may answer anything on them.

> **Theorem (gap ⇒ inapproximability).** If `Gap-Π[c, s]` is NP-hard, then there is no polynomial-time `(c/s − δ)`-approximation algorithm for `Π` for any `δ > 0`, unless `P = NP`.

*Proof.* Suppose `A` is a `ρ`-approximation with `ρ < c/s`. Run `A` on a gap instance. On a YES instance `OPT ≥ c`, so `A` returns a value `≥ OPT/ρ ≥ c/ρ > s` (since `ρ < c/s`). On a NO instance every solution has value `< s`, so `A` returns `< s`. Thresholding `A`'s output at `s` therefore decides the gap problem in polynomial time. Since the gap problem is NP-hard, `P = NP`. ∎

The reasoning runs both ways, and that is the crux of the whole subject:

> **An approximation algorithm with ratio `ρ` is a polynomial-time decider for every `Gap-Π[c, s]` with `c/s > ρ`. Therefore proving a `Gap-Π[c, s]` NP-hard rules out all `ρ < c/s` approximations.**

So the entire problem of inapproximability reduces to: *for how large a ratio `c/s` can we prove the gap problem NP-hard?* The ratio `c/s` is sometimes called the **hardness factor**.

For *minimization* the inequality flips: `Gap-Π[c, s]` with `c > s` has YES instances `OPT ≤ s` and NO instances `OPT > c`, and NP-hardness rules out `(c/s − δ)`-approximation.

---

## Gap-Introducing and Gap-Preserving Reductions

Two distinct moves build the theory.

**Gap-introducing reduction.** Starts from an *exact* NP-hard problem (e.g. plain 3-SAT, no gap) and produces a gap instance. The reduction maps satisfiable formulas to `OPT ≥ c` instances and unsatisfiable formulas to `OPT < s` instances. This is the *hard* part — it must create the gap out of nothing — and it is precisely what the **PCP theorem** accomplishes. A naive Karp reduction is *not* gap-introducing: 3-SAT `≤ₚ` MAX-3SAT maps "satisfiable" to "all clauses satisfiable" but "unsatisfiable" only to "at least one clause unsatisfiable," i.e. `OPT ≥ m−1` out of `m` — a vanishing gap `1 − 1/m → 1`, useless.

**Gap-preserving reduction.** Takes one gap problem `Gap-Π[c₁, s₁]` and produces another `Gap-Σ[c₂, s₂]`, mapping YES to YES and NO to NO. Once the PCP theorem hands you *one* constant-gap problem, gap-preserving reductions propagate the gap across the whole optimization zoo — often *amplifying* or *shrinking* the ratio in the process. The clique and vertex-cover bounds below are all gap-preserving consequences of the PCP gap.

The discipline: an ordinary many-one reduction proves NP-hardness of the *decision* problem but **destroys approximation ratios** (it has no reason to map near-optimal solutions of the source to near-optimal solutions of the target). To transport inapproximability you need a reduction that controls the *objective values* on both sides. Two formalizations make "controls the objective" precise: L-reductions and AP-reductions.

---

## L-Reductions and AP-Reductions

These are the approximation-preserving reductions referenced in [`../07-reductions-and-np-completeness/senior.md`](../07-reductions-and-np-completeness/senior.md). They are what make **APX-hardness** and **MAX-SNP-hardness** well-defined.

### L-reduction (linear reduction; Papadimitriou–Yannakakis 1991)

An **L-reduction** from optimization problem `A` to `B` is a pair of polynomial-time maps `(f, g)` — `f` maps instances of `A` to instances of `B`, `g` maps solutions of `B` back to solutions of `A` — together with constants `α, β > 0` such that:

1. `OPT_B(f(x)) ≤ α · OPT_A(x)`, and
2. for every solution `y` of `f(x)`, `|OPT_A(x) − val_A(g(y))| ≤ β · |OPT_B(f(x)) − val_B(y)|`.

Condition (1) says the optimum does not blow up; condition (2) says the *absolute error* transfers linearly. The consequence: if `B` has a PTAS, so does `A`. Contrapositively, **if `A` is APX-hard, so is `B`** (L-reductions compose). The completeness theory of APX is built on L-reductions; MAX-3SAT is the canonical APX-complete (under L-reductions, the class is MAX-SNP) anchor — the natural target to reduce *from*.

### AP-reduction (approximation-preserving; Crescenzi et al.)

The L-reduction's *additive* error guarantee is slightly too rigid for some problems. The more flexible **AP-reduction** demands only that for every `r > 1`, an `r`-approximate solution to `f(x)` maps under `g` to an `(1 + (r−1)·α + o(1))`-approximate solution to `x`. AP-reductions are the "right" notion for the class **APX**: `A` AP-reduces to `B` and `B ∈ APX` ⇒ `A ∈ APX`; and AP-completeness of APX is a clean theorem (MAX-3SAT is APX-complete under AP-reductions).

**Why two notions?** L-reductions are easier to *verify* (just check the two inequalities and exhibit `α, β`) and suffice for most APX-hardness proofs in practice; AP-reductions are the theoretically robust closure. For everyday senior work — proving "my problem has no PTAS unless `P = NP`" — you L-reduce from MAX-3SAT (or another known APX-hard problem) and you are done, because MAX-3SAT's APX-hardness is itself a PCP consequence.

---

## The PCP Theorem

The keystone. A **probabilistically checkable proof** system for a language `L` is a *verifier* `V` — a polynomial-time randomized algorithm — that, given input `x` and *oracle access* to a proof string `π`, uses `r(n)` random bits, reads `q(n)` bits of `π` (chosen based on the randomness), and decides accept/reject so that:

- **Completeness:** if `x ∈ L`, there exists `π` with `Pr[V^π(x) = accept] = 1`.
- **Soundness:** if `x ∉ L`, then for *every* `π`, `Pr[V^π(x) = accept] ≤ 1/2`.

`PCP(r(n), q(n))` is the class of languages with such a verifier using `O(r(n))` random bits and reading `O(q(n))` proof bits. The astonishing theorem:

> **PCP Theorem (Arora–Safra 1998; Arora–Lund–Motwani–Sudan–Szegedy 1998).** `NP = PCP(O(log n), O(1))`.

Read it carefully. Every NP statement has a proof that a verifier can check by flipping only `O(log n)` coins and reading a **constant** number of bits — independent of `n` — while still catching every false proof at least half the time. `O(log n)` random bits means there are only `2^{O(\log n)} = \text{poly}(n)` possible runs of the verifier, so the whole proof is polynomially long; constant query count means the verifier ignores essentially all of it on any single run.

The direction `PCP(O(log n), O(1)) ⊆ NP` is easy: enumerate all `poly(n)` random strings, the verifier's behavior is a poly-size check. The deep direction, `NP ⊆ PCP(O(log n), O(1))`, is the theorem — it requires encoding NP-witnesses in an extraordinarily error-robust form (low-degree polynomials, the Hadamard/long code, the sum-check protocol) so that *any* deviation from a valid proof is detectable by a constant-size local test. Dinur (2007) later gave a combinatorial **gap-amplification** proof that is dramatically simpler than the original algebraic machinery, building the verifier incrementally by squaring a constraint graph.

The query count can be pushed to **3 bits** with completeness `1` and soundness `1/2 + ε` (Håstad), which is what yields the tightest hardness results.

---

## PCP ⇔ Hardness of Approximation: The Equivalence

The reason the PCP theorem belongs in an *approximation* chapter is that it is *equivalent* to a hardness-of-approximation statement. This equivalence (the "gap form" of PCP) is the engine.

> **PCP Theorem, gap form.** There is a constant `ε > 0` such that it is NP-hard to distinguish satisfiable 3-CNF formulas from those in which at most a `(1 − ε)` fraction of clauses can be simultaneously satisfied. Equivalently, `Gap-MAX-3SAT[1, 1−ε]` is NP-hard.

The two forms are the *same theorem*. Here is the translation from a PCP verifier to a MAX-3SAT gap:

- Take any `L ∈ NP` and its `PCP(O(log n), O(1))` verifier `V`. For each of the `2^{O(\log n)} = \text{poly}(n)` random strings `R`, the verifier reads `q = O(1)` proof bits and applies a Boolean predicate `φ_R` to them. The proof string's bits are the **variables**; the predicates `φ_R` are the **constraints**.
- If `x ∈ L`, some proof satisfies *all* `φ_R` (completeness `1`). If `x ∉ L`, every assignment to the variables satisfies *at most half* the `φ_R` (soundness `1/2`).
- Each constant-arity predicate `φ_R` expands into `O(1)` 3-CNF clauses. So a satisfiable input gives a fully satisfiable formula; an unsatisfiable input gives one where a constant fraction of clauses *must* fail. That is precisely the MAX-3SAT gap.

Going the other way — a gap-MAX-3SAT hardness gives a PCP verifier — is equally direct: the proof is a purported satisfying assignment, the verifier picks a random clause and reads its 3 literals. So:

> **`NP ⊆ PCP(O(log n), O(1))`  ⟺  `Gap-MAX-3SAT[1, 1−ε]` is NP-hard for some constant `ε`.**

This is *the* reason "hardness of approximation" exists as a theory: the PCP theorem is a gap-introducing reduction from all of NP to a constant-gap CSP. Everything downstream is gap-*preserving* propagation.

---

## Håstad's Optimal Inapproximability

The PCP gap `ε` from the original proof is a tiny, unspecified constant. Håstad's celebrated work pins down the *exact* threshold for the central problems, using a refined PCP with only 3 queries and carefully designed predicates (the "long code" test analyzed by Fourier methods).

> **Theorem (Håstad 2001).** For every `δ > 0`, it is NP-hard to approximate MAX-3SAT within a factor better than `7/8 + δ`. That is, `Gap-MAX-3SAT[1, 7/8 + δ]` is NP-hard.

This is **tight**, and the matching algorithm is laughably simple:

> **The trivial 7/8 algorithm.** Assign each variable `true`/`false` independently with probability `1/2`. Each 3-clause (3 distinct literals) is violated only by the one assignment that falsifies all three literals — probability `1/8` — so it is satisfied with probability `7/8`. By linearity of expectation, the expected fraction of satisfied clauses is `7/8`, and this is derandomizable (method of conditional expectations) to a deterministic `7/8`-approximation.

So a random coin flip already achieves `7/8`, and Håstad proves you cannot beat it. **The approximability of MAX-3SAT is therefore completely settled at exactly `7/8`** (assuming `P ≠ NP`) — one of the most satisfying results in the field: the dumbest possible algorithm is optimal.

> **Theorem (Håstad 2001, MAX-E3-LIN-2).** Given a system of linear equations over `GF(2)`, each with exactly 3 variables, it is NP-hard to distinguish the case where a `(1 − δ)` fraction are simultaneously satisfiable from the case where at most a `(1/2 + δ)` fraction are — for every `δ > 0`.

Again tight: a *random* assignment satisfies each `GF(2)`-equation with probability exactly `1/2`, so `1/2` is trivially achievable and `1/2 + ε` is NP-hard. MAX-E3-LIN is the gold-plated source for "soundness near `1/2`" reductions — its near-perfect-completeness, near-`1/2`-soundness hardness is what feeds many subsequent results.

---

## The Landmark Bounds: Set Cover, Clique, Vertex Cover

The PCP gap, pushed through gap-preserving reductions and stronger PCP constructions, yields the canonical inapproximability thresholds. Each is worth knowing precisely.

### SET COVER — `(1 − o(1)) · ln n`

> **Theorem (Dinur–Steurer 2014; building on Feige 1998, Lund–Yannakakis 1994).** For every `α < 1`, it is NP-hard to approximate SET COVER within `α · ln n`, where `n` is the number of elements.

The greedy algorithm achieves `H_n ≈ ln n` (each step covers a `(1 − 1/e)` fraction of the remaining uncovered elements). Feige (1998) first proved the `(1 − o(1)) ln n` lower bound *under the slightly stronger assumption* `NP ⊄ DTIME(n^{O(\log\log n)})`; **Dinur–Steurer (2014)** removed that, obtaining the tight `(1 − o(1)) ln n` hardness under the clean assumption `P ≠ NP`. So set cover, like MAX-3SAT, is **completely understood**: greedy's `ln n` is optimal.

### MAX-CLIQUE — `n^{1−ε}`

> **Theorem (Håstad 1999; Zuckerman 2007).** For every `ε > 0`, it is NP-hard to approximate the maximum clique in an `n`-vertex graph within a factor of `n^{1−ε}`.

This is essentially *total* inapproximability: the trivial algorithm (output a single vertex) is an `n`-approximation, and you cannot beat `n^{1−ε}` — there is no constant-factor, no polylog, not even `n^{0.999}`-approximation. The bound comes from the **FGLSS reduction** (Feige–Goldwasser–Lovász–Safra–Szegedy 1991), which turns a PCP verifier into a graph whose maximum clique encodes the maximum acceptance probability; amplifying the PCP soundness amplifies the gap to `n^{1−ε}`. Zuckerman (2007) derandomized the construction to obtain the bound under `P ≠ NP`.

### VERTEX COVER — `1.36` unconditionally, `2 − ε` under UGC

> **Theorem (Dinur–Safra 2005).** It is NP-hard to approximate minimum VERTEX COVER within any factor below `√2 ≈ 1.36`. (Improved to `√2 − ε` by Khot–Minzer–Safra 2018.)

The trivial maximal-matching / LP-rounding algorithm gives a `2`-approximation, and *no one has improved the constant `2`* in decades. Dinur–Safra closes part of the gap unconditionally (`1.36`); the *full* gap closes only under the Unique Games Conjecture:

> **Theorem (Khot–Regev 2008).** Assuming UGC, it is NP-hard to approximate VERTEX COVER within `2 − ε` for every `ε > 0`.

So vertex cover is the poster child for a *conditional* tight bound: `2` is the algorithm, `2 − ε` is the hardness — but only if you believe UGC.

---

## The Unique Games Conjecture

The remaining gaps — vertex cover's `1.36`-vs-`2`, MAX-CUT, and a whole landscape of CSPs — close under one bold conjecture.

A **Unique Games** instance is a constraint satisfaction problem on variables taking values in a label set `[k]`, where every constraint is an *edge* `(u, v)` carrying a *permutation* `π_{uv}: [k] → [k]`, satisfied iff the labels obey `x_v = π_{uv}(x_u)`. The defining "uniqueness": *fixing the label of `u` forces a unique label of `v`* (and vice versa) to satisfy that edge.

> **Unique Games Conjecture (Khot 2002).** For every `ε > 0`, there is a label size `k = k(ε)` such that it is NP-hard to distinguish Unique Games instances in which at least a `(1 − ε)` fraction of constraints are simultaneously satisfiable from those in which at most an `ε` fraction are.

The intuitive force: the *uniqueness* makes the problem trivially easy at perfect completeness (if *all* constraints are satisfiable, label propagation along a spanning tree solves it in polynomial time). UGC asserts that the *near*-perfect-completeness, *near*-zero-soundness regime is nonetheless NP-hard. It cannot be proved by the standard 3-query PCP machinery, because the unique structure forbids the "two answers determine a contradiction" trick — which is exactly why it is a *conjecture* and not a theorem.

Its consequences are sweeping: UGC is the *single* hypothesis from which an entire wave of tight inapproximability results follows.

- **Vertex Cover `2 − ε`** (Khot–Regev), matching the trivial `2`.
- **MAX-CUT `0.878…`** (next section), matching Goemans–Williamson exactly.
- **Every CSP**: Raghavendra's dichotomy (next section).

**Status.** UGC remains *open* — neither proved nor refuted. It is the central open problem of hardness of approximation. There is partial progress: Subhash Khot, Dor Minzer, and Muli Safra's proof of the **2-to-2 Games Conjecture** (2018) — a weaker cousin — established that UGC's *soundness can be made `1/2`*, a major step often described as proving "half of UGC." Whether the full conjecture holds is one of the great unsettled questions in theoretical computer science.

---

## MAX-CUT, Goemans–Williamson, and Raghavendra's Dichotomy

MAX-CUT is the cleanest illustration of the algorithm-meets-hardness story and the canonical place where a **semidefinite program** is the optimal algorithm.

### The Goemans–Williamson SDP rounding

Given a graph `G = (V, E)`, MAX-CUT seeks a bipartition maximizing the number of crossing edges. The Goemans–Williamson (1995) algorithm relaxes each vertex `i` to a *unit vector* `vᵢ ∈ ℝⁿ` and maximizes `Σ_{(i,j)∈E} (1 − vᵢ·vⱼ)/2` — a semidefinite program, solvable to arbitrary precision in polynomial time. It then **rounds** by choosing a random hyperplane through the origin and cutting the vertices by which side of the hyperplane their vectors land on.

The analysis: an edge with vectors at angle `θ` is cut with probability `θ/π` (the hyperplane separates them iff it falls in the angle), while it contributes `(1 − cos θ)/2` to the SDP objective. The worst-case ratio of `(θ/π)` to `(1 − cosθ)/2` over all `θ ∈ [0, π]` is the **Goemans–Williamson constant**:

```text
α_GW = min_{0 < θ ≤ π}  (θ/π) / ((1 − cos θ)/2)  ≈  0.87856…
```

So the algorithm cuts at least `α_GW · OPT ≈ 0.878 · OPT` edges in expectation. For 25 years no one improved the constant.

### UGC says 0.878 is optimal

> **Theorem (Khot–Kindler–Mossel–O'Donnell 2007).** Assuming the Unique Games Conjecture, it is NP-hard to approximate MAX-CUT within any factor better than `α_GW ≈ 0.87856…`.

The proof reduces Unique Games to MAX-CUT and uses the **Majority-Is-Stablest** theorem (Mossel–O'Donnell–Oleszkiewicz) — a deep statement in the analysis of Boolean functions — to show the SDP integrality gap *is* the hardness threshold. The match is exact and uncanny: the very same `arccos`-geometry that governs the algorithm's loss governs the hardness lower bound.

### Raghavendra's universal dichotomy

The MAX-CUT story is not a coincidence; it is an instance of a vast theorem.

> **Theorem (Raghavendra 2008).** Assuming the Unique Games Conjecture, for *every* constraint satisfaction problem, the *basic semidefinite programming relaxation* achieves the optimal approximation ratio — and that ratio equals the SDP's integrality gap. No polynomial-time algorithm does better.

This is a stunning unification: under UGC, you do not need a clever bespoke algorithm for each CSP — *one* generic SDP, the natural relaxation, is *simultaneously* optimal for all of them, and the threshold is computable (in principle) as the worst integrality gap. The "dichotomy flavor": for every CSP there is a precise constant `α_Π`; the basic SDP achieves `α_Π`, and beating `α_Π` is UGC-hard. This is why UGC is so central — it converts the entire approximability landscape of CSPs into a *single* algorithmic principle.

---

## The Positive Side the Theory Explains: When a PTAS Exists

Inapproximability theory also clarifies the *positive* boundary: it tells you exactly which problems can have a PTAS and which provably cannot.

**APX-hard ⇒ no PTAS (unless `P = NP`).** If a problem is APX-hard — i.e. MAX-3SAT L-reduces to it — then a PTAS would give MAX-3SAT a PTAS, contradicting Håstad's `7/8` gap. So **MAX-CUT, vertex cover, metric TSP, and general MAX-3SAT have no PTAS** unless `P = NP`. The constant gap from PCP is the obstruction. This is the precise sense in which "APX-hard" means "has a best-possible constant but no `(1+ε)` family."

**Yet some NP-hard problems *do* have a PTAS** — because their structure forbids a hard constant gap from being embedded. Two landmark techniques:

- **Euclidean TSP (Arora 1998; independently Mitchell 1999).** TSP on points in the plane (or fixed-dimensional Euclidean space) admits a PTAS, even though *general* metric TSP is APX-hard. Arora's randomized **dissection / dynamic-programming-over-a-quadtree** technique exploits the geometry: a near-optimal tour can be "snapped" to cross a recursive grid only `O(1)` times per cell, making DP feasible. The geometry is exactly what blocks a gap-introducing reduction. (Arora and Mitchell shared the 2010 Gödel Prize for this.)
- **Planar graph problems — Baker's technique (Baker 1994).** For planar graphs, problems like maximum independent set, vertex cover, and dominating set admit a PTAS. **Baker's layering** decomposes a planar graph by BFS levels modulo `k`; deleting one residue class leaves components of bounded *treewidth*, on which the problem is solvable exactly by DP; varying the deleted class and taking the best loses only a `(1 + 1/k)` factor. Bounded local treewidth is the structural property that admits the `(1+ε)` family — and that planarity provides but general graphs do not. (Vertex cover is APX-hard in general but has a PTAS on planar graphs — the *same* problem, different inputs, opposite approximability, and the theory says exactly why.)

The lesson: **a PTAS exists precisely when the instance structure prevents the PCP gap from being embedded.** Geometry (Euclidean TSP) and topology (planarity → bounded local treewidth) are the two great gap-blocking structures. Where no such structure exists, the APX-hardness machinery proves a PTAS *impossible*.

The SDP / Goemans–Williamson rounding is the canonical "matching the hardness" algorithm on the *other* side — the constant-factor regime where no PTAS can exist but the SDP hits the UGC-optimal constant. (Its full engineering — the relaxation, the rounding, the integrality-gap calculation — is developed in `professional.md`.)

---

## Decision Framework

| Situation | What the theory says |
|---|---|
| Want to prove **"no `ρ`-approximation"** | Prove `Gap-Π[c, s]` NP-hard with `c/s ≥ ρ`; equivalently, gap-preserving-reduce from a known gap problem |
| Want to prove **"no PTAS"** | L-reduce (or AP-reduce) **from MAX-3SAT** (APX-hard) to your problem — establishes APX-hardness |
| Need the **original constant gap** | Invoke the PCP theorem (`Gap-MAX-3SAT[1, 1−ε]` NP-hard) — the unique gap-*introducing* result |
| Want the **tightest 3SAT/linear bound** | Håstad: `7/8 + δ` for MAX-3SAT, `1/2 + δ` for MAX-E3-LIN — both tight against random assignment |
| Problem is **set cover-like** (covering) | Threshold is `(1 − o(1)) ln n` (Dinur–Steurer); greedy is optimal |
| Problem is **clique / dense-subgraph-like** | Expect `n^{1−ε}` total inapproximability (Håstad/FGLSS) |
| Stuck at a **factor-2 (or `0.878`) barrier** | Suspect a **UGC-tight** bound — vertex cover `2−ε`, MAX-CUT `α_GW`; the barrier is likely fundamental |
| It's **any CSP** and you want the optimal algorithm | Under UGC, the **basic SDP** is optimal (Raghavendra) — don't hand-craft; solve the SDP |
| Your instances are **Euclidean or planar** | A **PTAS may exist** (Arora/Mitchell; Baker) — APX-hardness of the general problem does not transfer |

---

## Research Pointers

- **Arora, S., & Safra, S. (1998). "Probabilistic Checking of Proofs: A New Characterization of NP."** *JACM.* The PCP verifier and `NP = PCP(O(log n), O(1))` (with ALMSS).
- **Arora, S., Lund, C., Motwani, R., Sudan, M., & Szegedy, M. (1998). "Proof Verification and the Hardness of Approximation Problems."** *JACM.* The other half of the PCP theorem; the FGLSS-style approximation connection. (Both papers won the 2001 Gödel Prize.)
- **Feige, U., Goldwasser, S., Lovász, L., Safra, S., & Szegedy, M. (1996). "Interactive Proofs and the Hardness of Approximating Cliques."** *JACM.* The FGLSS reduction; clique inapproximability from PCP.
- **Dinur, I. (2007). "The PCP Theorem by Gap Amplification."** *JACM.* The combinatorial gap-amplification proof of PCP.
- **Håstad, J. (2001). "Some Optimal Inapproximability Results."** *JACM.* MAX-3SAT `7/8`, MAX-E3-LIN `1/2`, optimal 3-query PCP. (2011 Gödel Prize.)
- **Håstad, J. (1999). "Clique Is Hard to Approximate Within `n^{1−ε}`."** *Acta Math.*; **Zuckerman, D. (2007).** Derandomization under `P ≠ NP`.
- **Feige, U. (1998). "A Threshold of `ln n` for Approximating Set Cover."** *JACM.*; **Dinur, I., & Steurer, D. (2014). "Analytical Approach to Parallel Repetition."** *STOC.* — tight `(1−o(1)) ln n` set-cover hardness under `P ≠ NP`.
- **Dinur, I., & Safra, S. (2005). "On the Hardness of Approximating Minimum Vertex Cover."** *Annals of Math.* The `1.36` unconditional bound.
- **Khot, S. (2002). "On the Power of Unique 2-Prover 1-Round Games."** *STOC.* The Unique Games Conjecture.
- **Khot, S., & Regev, O. (2008). "Vertex Cover Might Be Hard to Approximate to Within `2 − ε`."** *JCSS.*
- **Khot, S., Kindler, G., Mossel, E., & O'Donnell, R. (2007). "Optimal Inapproximability Results for MAX-CUT and Other 2-Variable CSPs?"** *SICOMP.* `α_GW` is UGC-optimal.
- **Goemans, M., & Williamson, D. (1995). "Improved Approximation Algorithms for Maximum Cut and Satisfiability Problems Using Semidefinite Programming."** *JACM.* The `0.878` SDP.
- **Raghavendra, P. (2008). "Optimal Algorithms and Inapproximability Results for Every CSP?"** *STOC.* The UGC dichotomy: basic SDP is optimal for all CSPs.
- **Khot, S., Minzer, D., & Safra, M. (2018). "Pseudorandom Sets in Grassmann Graph Have Near-Perfect Expansion."** The 2-to-2 Games theorem ("half of UGC").
- **Arora, S. (1998). "Polynomial Time Approximation Schemes for Euclidean TSP and Other Geometric Problems."** *JACM.*; **Mitchell, J. (1999).** Independent Euclidean-TSP PTAS.
- **Baker, B. (1994). "Approximation Algorithms for NP-Complete Problems on Planar Graphs."** *JACM.* Layering / bounded-treewidth PTAS.
- **Papadimitriou, C., & Yannakakis, M. (1991). "Optimization, Approximation, and Complexity Classes."** *JCSS.* L-reductions and MAX-SNP.

---

## Key Takeaways

1. **Hardness of approximation is hardness of a gap.** "No `ρ`-approximation unless `P = NP`" is *exactly* "`Gap-Π[c, s]` is NP-hard with `c/s = ρ`." A `ρ`-approximation algorithm is a decider for every gap problem with ratio `> ρ`, so the entire subject is "how large a `c/s` gap can we prove NP-hard."
2. **The PCP theorem manufactures the gap.** `NP = PCP(O(log n), O(1))` (Arora–Safra; ALMSS) is *equivalent* to "`Gap-MAX-3SAT[1, 1−ε]` is NP-hard." It is the one gap-*introducing* reduction; ordinary Karp reductions destroy the ratio. Everything else is gap-*preserving* propagation via L-reductions and AP-reductions.
3. **Håstad's bounds are tight against random guessing.** MAX-3SAT is NP-hard beyond `7/8` — and a random assignment *achieves* `7/8`. MAX-E3-LIN is hard beyond `1/2` — and random achieves `1/2`. The dumbest algorithm is provably optimal; the problems are *completely* understood.
4. **The landmark thresholds.** Set cover: `(1−o(1)) ln n` (Dinur–Steurer), matching greedy. Max-clique: `n^{1−ε}` (Håstad/FGLSS), essentially total inapproximability. Vertex cover: `1.36` unconditionally (Dinur–Safra), `2−ε` under UGC (Khot–Regev), matching the trivial `2`.
5. **The Unique Games Conjecture closes the remaining gaps.** Khot's UGC (2002) — near-`1` completeness vs near-`0` soundness for unique-constraint label CSPs is NP-hard — implies vertex cover `2−ε` and MAX-CUT `α_GW ≈ 0.878` (Goemans–Williamson is *exactly* optimal, via KKMO). It is **still open**; the 2-to-2 Games theorem (Khot–Minzer–Safra 2018) proved "half" of it.
6. **Raghavendra's dichotomy unifies the field.** Under UGC, the *basic SDP* achieves the optimal ratio for *every* CSP, equal to its integrality gap — one generic algorithm is simultaneously optimal everywhere. This is why UGC is the central conjecture of approximation hardness.
7. **The theory explains who gets a PTAS.** APX-hard ⇒ no PTAS unless `P = NP` (the PCP gap is the obstruction). But Euclidean TSP (Arora/Mitchell) and planar problems (Baker's layering → bounded local treewidth) *do* have a PTAS — geometry and topology block the gap from being embedded. The *same* problem (vertex cover) is APX-hard in general yet has a PTAS on planar graphs.
8. **Match the algorithm to the proven threshold.** When a ratio refuses to improve (`2` for vertex cover, `0.878` for MAX-CUT), suspect a UGC-tight barrier rather than a missing trick; the SDP / Goemans–Williamson rounding is the canonical algorithm that *meets* the hardness, with the same `arccos`-geometry on both sides.

---

> **See also:** [`./middle.md`](./middle.md) for approximation ratios, PTAS/FPTAS, and the rounding toolkit · [`../07-reductions-and-np-completeness/senior.md`](../07-reductions-and-np-completeness/senior.md) for L-/AP-/gap-preserving reductions · [`../06-complexity-classes-p-np/senior.md`](../06-complexity-classes-p-np/senior.md) for NP, randomized verifiers, and what NP-hardness licenses · [`../09-lower-bounds-and-adversary-arguments/senior.md`](../09-lower-bounds-and-adversary-arguments/senior.md) for unconditional lower bounds in restricted models
