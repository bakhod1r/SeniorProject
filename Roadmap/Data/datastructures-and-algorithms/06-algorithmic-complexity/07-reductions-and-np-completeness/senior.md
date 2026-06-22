# Reductions and NP-Completeness — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — many-one reductions, the reduction recipe, the Cook–Levin theorem sketch, the basic zoo (SAT, 3-SAT, CLIQUE, VERTEX-COVER, HAM-CYCLE, SUBSET-SUM, TSP)
- [Complexity Classes: P and NP — Senior](../06-complexity-classes-p-np/senior.md) — the polynomial hierarchy, the barriers, what NP-hardness licenses

## Table of Contents

1. [What Senior-Level Reductions Are About](#what-senior-level-reductions-are-about)
2. [Cook–Levin in Full Rigor: The Computation Tableau](#cook-levin-in-full-rigor)
3. [The Taxonomy of Reductions](#the-taxonomy-of-reductions)
4. [Parsimonious Reductions and #P-Completeness](#parsimonious-reductions-and-p-completeness)
5. [Strong vs Weak NP-Completeness](#strong-vs-weak-np-completeness)
6. [Approximation-Preserving Reductions and PCP](#approximation-preserving-reductions-and-pcp)
7. [ETH, SETH, and Fine-Grained Complexity](#eth-seth-and-fine-grained-complexity)
8. [Reductions Among Restricted Instances](#reductions-among-restricted-instances)
9. [A Worked Reduction: 3-SAT ≤ₚ SUBSET-SUM](#a-worked-reduction-3-sat-to-subset-sum)
10. [Decision Framework](#decision-framework)
11. [Research Pointers](#research-pointers)
12. [Key Takeaways](#key-takeaways)

---

## What Senior-Level Reductions Are About

Junior and middle levels teach the *craft*: a many-one reduction `A ≤ₚ B` is a poly-time map `f` with `x ∈ A ⇔ f(x) ∈ B`; you prove NP-hardness by reducing a known-hard problem *to* yours; you design gadgets; you remember that SAT, 3-SAT, CLIQUE, and the rest form a connected web. That is enough to *use* NP-completeness.

Senior-level reductions are about the **internal machinery and the refined notions of reducibility** that turn "NP-complete" from a single coarse label into a precise instrument:

1. **Cook–Levin is not a black box.** The proof *is* a reduction — from an arbitrary NP machine to a CNF formula — and understanding its tableau construction is what lets you believe (rather than recite) that SAT captures all of NP. It is also the template every later reduction imitates.
2. **"Reduction" is a family, not a single relation.** Many-one vs Turing, polynomial-time vs log-space, parsimonious vs lossy, approximation-preserving vs not. *Which* reduction you use determines *which* completeness theory you get — completeness in P, in NL, in #P, in the approximation classes.
3. **Numbers matter.** A reduction that smuggles a large integer into a unary-vs-binary encoding is the difference between *weak* and *strong* NP-completeness — between "there's a pseudo-polynomial algorithm" and "there isn't one unless P = NP."
4. **Reductions transport lower bounds, not just hardness.** Under ETH/SETH, a reduction with controlled blow-up moves a *fine-grained* time lower bound from one problem to another — the modern engine behind "this `O(n²)` algorithm is probably optimal."

Get the refinements wrong and you will say "NP-complete" when you mean "weakly NP-complete and your instances have small numbers," or you will trust a reduction that preserves *decidability* but destroys the *approximation ratio* you actually care about.

---

## Cook–Levin in Full Rigor: The Computation Tableau

> **Theorem (Cook 1971; Levin 1973).** SAT is NP-complete. Equivalently, for *every* language `L ∈ NP`, `L ≤ₚ SAT`.

Middle level sketched this. Here is the construction with enough rigor to see *why it is polynomial* and *why it captures all of NP*.

### The setup

Let `L ∈ NP`. By definition there is a nondeterministic Turing machine `M` deciding `L` in time `p(n)` for a polynomial `p`. Given an input `x` of length `n`, we build a CNF formula `φ_x` that is satisfiable **iff** `M` has an accepting computation on `x`. The reduction maps `x ↦ φ_x` in polynomial time.

The key object is the **computation tableau**: a `T × T` grid where `T = p(n)` is both the time bound and (since `M` cannot move its head past cell `p(n)` in `p(n)` steps) the relevant tape width.

```text
              tape cell →   0     1     2    ...   T-1
  time step ↓
       0          [q0,x0] [x1]  [x2]  ...  [_]     ← start configuration
       1            ...    ...   ...        ...
       2            ...    ...   ...        ...
      ...
      T-1           ...    ...  [qacc] ...  ...     ← must contain accept
```

Row `t` is the full configuration of `M` after `t` steps: tape contents, head position, and current state (encoded into the cell the head sits on). An accepting computation is a legal filling of this grid.

### The variables

Let `Γ` be the tape alphabet and `Q` the state set. Define a Boolean variable for every (cell, time, possible-content) triple:

```text
x[t, i, s] = 1   iff   at time t, tape cell i holds symbol-or-state-marker s
```

There are `T × T × |Γ ∪ (Q×Γ)|` such variables — `O(T²)` of them, since the alphabet and state set are fixed constants of `M`. **Polynomially many variables.** A satisfying assignment is a candidate tableau; the clauses below force it to be a *legal, accepting* one.

### The clause groups

The formula is a conjunction of four groups. Each group is a polynomial-size CNF.

**(1) Well-formedness — exactly one symbol per cell.** For each `(t, i)`, at least one content is set (`⋁_s x[t,i,s]`) and no two are simultaneously set (`⋀_{s≠s'} (¬x[t,i,s] ∨ ¬x[t,i,s'])`). This is `O(T²)` cells × `O(1)` clauses each = `O(T²)` clauses. Without this group a "tableau" could place two symbols in one cell and cheat.

**(2) Start — row 0 encodes the initial configuration.** Force `x[0, ·, ·]` to spell out `q₀ x₁ x₂ … xₙ` followed by blanks, with the head at cell 0 in the start state. This is `O(T)` unit clauses, hard-wired from `x`.

**(3) Accept — some cell is the accept state.** `⋁_{t,i} x[t, i, q_accept]`. A single clause of `O(T²)` literals (or, fixing the convention that an accepting machine loops in `q_accept`, just the last row). This is the *only* place the existential "M accepts" enters.

**(4) Transition — every 2×3 window is legal.** This is the heart. Locality of Turing machines means that the content of cell `i` at time `t+1` depends only on cells `i-1, i, i+1` at time `t` (the head can affect at most its own cell and shift one step). So we constrain every **2×3 window**:

```text
       cell i-1   cell i   cell i+1
 t:      a          b         c
 t+1:    a'         b'        c'
```

For each window position `(t, i)`, add clauses asserting that the six cells `(a,b,c,a',b',c')` form one of the **legal window patterns** — patterns consistent with `M`'s transition function `δ` (where the head is) or with "nothing changed here" (where the head is not). The set of legal windows is a fixed, finite table derived once from `δ`; a window's legality is a constant-size Boolean condition, expressible as `O(1)` clauses. There are `O(T²)` windows, hence `O(T²)` clauses.

The subtlety worth internalizing: **window legality is a *local* check, yet it enforces a *global* property** — that row `t+1` is a genuine successor configuration of row `t` under `M`. If every window is locally legal and the head appears in exactly one place per row (forced by group 1 plus the encoding), then the whole row transition is a valid step. Locality is *exactly* why a polynomial-size formula suffices: a Turing machine step touches `O(1)` cells, so its legality decomposes into `O(T²)` independent constant-size constraints.

### Why it is polynomial, and why it captures all of NP

- **Polynomial size:** `O(T²)` variables and `O(T²) = O(p(n)²)` clauses. The map `x ↦ φ_x` is computable in time polynomial in `n` — it is mostly bookkeeping over the grid plus emitting a fixed window table.
- **Correctness, forward:** if `M` accepts `x`, the actual accepting computation *is* a legal tableau; reading it off gives a satisfying assignment.
- **Correctness, backward:** any satisfying assignment encodes a grid that is well-formed (group 1), starts correctly (group 2), transitions legally at every window (group 4), and reaches accept (group 3) — i.e., a valid accepting computation of `M`. So `φ_x` satisfiable ⇒ `M` accepts `x`.

Because `L` was an *arbitrary* member of NP, **every** NP language reduces to SAT. SAT is therefore NP-hard, and since SAT ∈ NP (guess an assignment, check in linear time), SAT is **NP-complete**. The reduction to 3-SAT is then a clause-splitting gadget (a `k`-literal clause becomes `k-2` three-literal clauses chained by fresh variables), so 3-SAT inherits completeness. *Every NP-hardness proof you will ever write is, transitively, riding on this tableau.*

### Why this is the master reduction

It is worth pausing on *what just happened*, because it is the conceptual peak of the topic. Cook–Levin reduces a *quantified-over-all* object — "every language in NP" — to a *single concrete problem*, SAT. That is structurally unusual: most reductions go between two named problems. Here the source is the *entire class*. The trick is that NP has a **uniform definition** (poly-time verifier / poly-time NTM), so "an arbitrary NP language" is really "an arbitrary polynomial-time machine plus a polynomial bound," and a machine's behavior over time *is* a tableau. The reduction encodes *computation itself* into propositional logic.

Two consequences follow that engineers should internalize:

- **SAT is a universal substrate.** Because everything in NP funnels into SAT, an efficient SAT solver is an efficient solver for *all* of NP. This is not just theory — it is *why* industrial SAT/SMT solvers are the practical engine for verification, planning, and combinatorial optimization: you express your NP problem as clauses and let a decades-tuned solver attack it. The Cook–Levin reduction is the license to do that.
- **The tableau is local, so the formula is sparse and structured.** The transition clauses only ever relate adjacent cells. That locality is exactly the structure that real SAT solvers (CDCL, with their conflict-driven clause learning) exploit. Hardness in the worst case coexists with tractable structure in practice — a recurring senior theme.

---

## The Taxonomy of Reductions

The single word "reduction" hides a lattice of distinct relations. Choosing the right one is a senior skill because **completeness is always completeness *under a specified reducibility*.**

### Many-one (Karp) vs Turing (Cook)

- **Many-one / Karp reduction** `A ≤ₘ B`: a single function `f` with `x ∈ A ⇔ f(x) ∈ B`. *One* call to a `B`-oracle, and you must output its answer unchanged. This is the reduction that defines NP-completeness.
- **Turing / Cook reduction** `A ≤_T B`: a poly-time algorithm for `A` that may call a `B`-oracle **polynomially many times**, adaptively, and post-process the answers (including negating them).

Turing reductions are strictly more powerful, and that extra power is exactly why we *don't* use them to define NP-completeness:

- Under Cook reductions, `co-NP ≤_T NP` trivially (solve the NP problem, flip the bit). So NP-completeness-under-Cook-reductions would blur the NP/co-NP distinction we care about. **Karp reductions cannot negate**, which is precisely what keeps NP and co-NP separable in the theory.
- Cook reductions are the right tool for **NP-hardness of search/optimization** ("NP-hard" without "NP-complete"): TSP-optimization is NP-hard under Turing reductions to its decision version (binary-search the threshold), even though the optimization problem isn't a language and can't be NP-*complete*.

The discipline: use **Karp (many-one)** when you want to place a problem *inside and complete-for* a class; reach for **Cook (Turing)** when you only need "at least as hard as," e.g., reducing optimization to decision.

### Polynomial-time vs log-space reductions

Polynomial-time reductions are too coarse for the classes *inside* P. If you want to talk about completeness for **P**, **NL**, or **L**, a polynomial-time reduction is useless: it could *solve* the whole problem itself. The fix is to weaken the reduction's own resources below the class being studied.

- **Log-space reductions (`≤_log`):** `f` is computable by a deterministic Turing machine using `O(log n)` work space (read-only input, write-only output). These compose, and crucially `≤_log ⊆ ≤ₚ`.
- **P-completeness** is defined under log-space (or `NC`) reductions. The canonical P-complete problem is **Circuit Value (CVP)**: given a Boolean circuit and inputs, is the output 1? P-completeness is the formal sense in which a problem is **inherently sequential** — "probably not efficiently parallelizable," because `P = NC` is widely disbelieved, just as `P = NP` is.
- **NL-completeness** (e.g., directed `s–t` connectivity, STCON) is also defined under log-space reductions.

Why this matters in practice: when someone asks "can this be parallelized?", the honest theoretical answer is "is it P-complete under log-space reductions?" A log-space reduction *from* CVP *to* your problem says your problem is as sequential as anything in P. The reduction's *resource bound* is load-bearing — a poly-time reduction would say nothing.

> Almost all standard NP-completeness reductions (including the Cook–Levin tableau) are in fact **already log-space computable** — the gadget constructions are local and need only a few counters. So the textbook NP-complete problems are NP-complete under the stricter log-space reductions too, which is what makes them robust completeness statements.

---

## Parsimonious Reductions and #P-Completeness

A many-one reduction preserves *whether* a solution exists. A **parsimonious reduction** additionally preserves *how many* solutions exist:

> A reduction `f: A → B` is **parsimonious** if `#{ solutions of x } = #{ solutions of f(x) }` for every `x` — a bijection between the witness sets.

This refinement opens the door to **counting complexity**.

### The class #P

`#P` (Valiant 1979) is the class of *counting* functions: `f ∈ #P` if `f(x)` counts the accepting paths of a poly-time nondeterministic machine — equivalently, counts the witnesses of an NP problem. Where NP asks "*is there* a satisfying assignment?", `#SAT` asks "*how many*?"

- **#P-completeness** is defined under (parsimonious or, more generally, poly-time counting) reductions. `#SAT` and `#3-SAT` are #P-complete — and because Cook–Levin is parsimonious (each accepting computation maps to exactly one satisfying assignment), this follows directly.
- `P^{#P}` contains the entire polynomial hierarchy (**Toda's theorem**, 1991: `PH ⊆ P^{#P}`). Counting is, in a precise sense, harder than alternation.

### Counting can be hard even when deciding is easy

This is the headline that makes #P matter to engineers:

> **Theorem (Valiant 1979).** Computing the **PERMANENT** of a 0/1 matrix is #P-complete.

The permanent looks like the determinant — same `n!` sum over permutations, but *without the sign*:

```text
perm(A) = Σ_{σ ∈ S_n}  Π_i A[i, σ(i)]
det(A)  = Σ_{σ ∈ S_n}  sgn(σ) · Π_i A[i, σ(i)]
```

The determinant is computable in `O(n³)` by Gaussian elimination. The permanent — algebraically a one-character edit away — is **#P-complete**. The signs in the determinant enable cancellation (row operations); the permanent has no cancellation structure, and nothing polynomial is known.

Concretely: for a bipartite graph with biadjacency matrix `A`, `perm(A)` is exactly the **number of perfect matchings**. And here is the dissonance:

- **Deciding** whether a perfect matching *exists* is in **P** (Hopcroft–Karp, augmenting paths).
- **Counting** perfect matchings is **#P-complete** (Valiant, via the permanent).

So the *decision* problem is easy and the *counting* problem is as hard as anything in #P. **Tractable existence does not imply tractable counting.** This is the senior lesson of parsimonious reductions: they are the tool that lets you say "and the counting version is #P-hard" — which is a *separate, stronger* claim than NP-hardness of decision, and one you must prove with a *counting-preserving* (parsimonious) reduction, not just any reduction.

> Note the asymmetry: a many-one reduction that *isn't* parsimonious can preserve NP-completeness while *destroying* solution counts (it might map a satisfiable instance to one with a different number of witnesses). To transport #P-hardness you need the parsimonious version — many classical reductions are parsimonious, but you must check.

### Where this bites in practice

The decision-easy/counting-hard gap is not an exotic edge case; it is the normal state of affairs for *probabilistic inference and reliability*:

- **Network reliability** — "what is the probability the network stays connected if each edge fails independently?" — is a #P-hard counting question, even though connectivity itself is a trivial BFS. Exact reliability computation is intractable; you fall back to Monte Carlo estimation.
- **Bayesian inference** (computing a marginal probability) is #P-hard in general, which is the formal reason exact inference in large graphical models is hopeless and the field runs on sampling (MCMC) and variational approximation.
- **Counting solutions** to a constraint system — for capacity planning, model counting, or measuring "how robust" a satisfying configuration is — sits in #P even when *finding one* solution is fast.

The senior move when a stakeholder asks "how many ways…" or "with what probability…": recognize you may have crossed from P (or NP) into **#P**, where exact answers are off the table and **approximate counting** (e.g., an FPRAS via Markov-chain sampling, where one exists) is the realistic target. The reduction discipline — *parsimonious* to claim #P-hardness — is what justifies that pivot rigorously.

---

## Strong vs Weak NP-Completeness

The most slippery distinction in applied NP-completeness. It hinges on **how numbers in the input are encoded** — unary vs binary.

### Pseudo-polynomial algorithms

Consider **SUBSET-SUM** / **KNAPSACK**. The textbook dynamic program runs in `O(n · W)` time, where `n` is the number of items and `W` is the target (or capacity). That looks polynomial — but it is not, because `W` is a *number*, and a number is written in `log W` bits. So `O(nW) = O(n · 2^{log W})` is **exponential in the input size** (the bit-length of `W`).

An algorithm polynomial in `n` and in the **numeric value** `W` (rather than its bit-length) is called **pseudo-polynomial**.

> A problem is **weakly NP-complete** if it is NP-complete but admits a pseudo-polynomial algorithm. KNAPSACK and SUBSET-SUM are the canonical examples.

The practical consequence is enormous and frequently missed:

- If the numbers in *your* instances are **bounded by a polynomial in `n`** (small capacities, small weights), the pseudo-polynomial DP **is** polynomial *for your inputs*. KNAPSACK with `W ≤ n²` is trivially solvable. The NP-completeness lives entirely in the regime of *large* numbers written in binary.

### Strong NP-completeness

Some problems stay NP-complete **even when all numbers are written in unary** — i.e., even when every number is bounded by a polynomial in the input length.

> A problem is **strongly NP-complete** if it remains NP-complete when the numerical inputs are encoded in **unary** (equivalently, are polynomially bounded). For such a problem, **no pseudo-polynomial algorithm exists unless P = NP.**

Canonical examples:

| Problem | Status | Why it matters |
|---|---|---|
| **3-PARTITION** | **Strongly** NP-complete | The workhorse for proving *other* scheduling/packing problems strongly hard |
| **BIN PACKING** | **Strongly** NP-complete | No pseudo-poly even with small item sizes |
| **TSP** (general) | **Strongly** NP-complete | Hardness survives unary distances |
| **KNAPSACK / SUBSET-SUM** | **Weakly** NP-complete | `O(nW)` DP — pseudo-poly exists |
| **PARTITION** (2-way) | **Weakly** NP-complete | `O(n·Sum)` DP — pseudo-poly exists |

The encoding is the whole game. In **PARTITION** the hardness is *concentrated in one huge number* split across a few items — make the numbers small (unary) and the DP wins. In **3-PARTITION** the hardness is *combinatorial* — distributing `3m` items into `m` triples each summing to the same target — and it persists even with tiny, unary-bounded numbers. That structural difference is exactly why 3-PARTITION is the go-to source problem for strong-hardness reductions: a reduction *from* 3-PARTITION transfers strong NP-completeness, ruling out a pseudo-polynomial algorithm for the target, whereas a reduction from SUBSET-SUM only transfers weak hardness.

**The senior diagnostic:** before declaring a number-laden problem hopeless, ask *which kind* of NP-complete it is. Weakly NP-complete + polynomially-bounded numbers = solvable by the pseudo-poly DP. Strongly NP-complete = the DP won't save you, and you should pivot to approximation (note FPTAS existence is itself tied to weak-vs-strong: a strongly NP-hard problem has **no FPTAS** unless P = NP).

---

## Approximation-Preserving Reductions and PCP

Ordinary many-one reductions preserve *decidability* of the optimum but can wreck the *approximation ratio* — they may map a near-optimal solution of one problem to a terrible solution of the other. To transport *inapproximability*, you need reductions that respect the objective's quality.

### The approximation-preserving family

- **L-reduction (linear reduction; Papadimitriou–Yannakakis 1991):** a pair of maps with two linear guarantees — `OPT(f(x)) ≤ α · OPT(x)`, and a feasible `B`-solution of value `c` maps back to an `A`-solution whose *cost gap from optimal* is at most `β` times `B`'s gap. The linearity ensures a `(1+ε)`-approximation for `B` yields a `(1+O(ε))`-approximation for `A`. L-reductions are the backbone of **MAX-SNP / APX-completeness**.
- **AP-reduction (approximation-preserving):** the more general notion that defines **APX-completeness**; an AP-reduction transfers PTAS-membership both ways, so an APX-complete problem has a PTAS iff `P = NP`.
- **Gap-preserving reduction:** maps a "gap instance" (YES instances have `OPT ≥ c`, NO instances have `OPT ≤ s`) of one problem to a gap instance of another, transporting the *gap* — and a gap is exactly what rules out approximation between the two thresholds.

The point of all three: **they preserve the *ratio*, not merely the *existence* of a solution.** A standard Karp reduction is the wrong tool for inapproximability — it can collapse the very gap you are trying to propagate.

### The PCP connection

Why do gaps exist to propagate in the first place? The **PCP theorem** (`NP = PCP(O(log n), O(1))`; Arora–Safra and Arora–Lund–Motwani–Sudan–Szegedy, 1992) is the source. Its operational form:

> It is NP-hard to distinguish satisfiable 3-SAT instances from instances where **at most a `(1−ε)` fraction** of clauses can be satisfied (for some constant `ε > 0`).

This is a **gap** baked into NP itself. Once you have one gap problem (gap-MAX-3SAT), gap-preserving reductions *spread* the gap across the optimization landscape — yielding "NP-hard to approximate within factor `ρ`" results for VERTEX-COVER, MAX-CUT, CLIQUE (Håstad's `n^{1−ε}` for CLIQUE), and many more. Without the PCP theorem there would be no starting gap and inapproximability would be unprovable.

This is the bridge to the next topic: the PCP theorem manufactures the gap, and approximation-preserving reductions transport it. See [`../08-approximation-and-hardness/senior.md`](../08-approximation-and-hardness/senior.md) for how these inapproximability ceilings interact with the approximation algorithms that try to reach them, and where the Unique Games Conjecture pins the exact thresholds.

---

## ETH, SETH, and Fine-Grained Complexity

`P ≠ NP` says NP-complete problems have no *polynomial* algorithm. It says **nothing** about the *exact* exponential — whether 3-SAT needs `2^n` or merely `2^{√n}` or `1.3^n`. Fine-grained complexity sharpens "intractable" into a *precise* running-time lower bound, and it relies on **stronger-than-P≠NP** hypotheses plus reductions that control the *exponent*.

### The Exponential Time Hypothesis

> **ETH (Impagliazzo–Paturi 2001).** There is a constant `δ > 0` such that **3-SAT** on `n` variables cannot be solved in time `2^{δn}`. Informally: 3-SAT requires `2^{Ω(n)}` time — no `2^{o(n)}` algorithm.

> **SETH (Strong ETH; Impagliazzo–Paturi).** For every `ε > 0` there is a `k` such that `k`-SAT cannot be solved in time `2^{(1−ε)n}`. Informally: as clause width grows, brute-force `2^n` is *essentially optimal* — you cannot shave the base of the exponent below 2.

Both are *conjectures strictly stronger* than `P ≠ NP` (each implies `P ≠ NP`, but not conversely). They are the axioms of fine-grained complexity, accepted as working hypotheses much as `P ≠ NP` is.

### Reductions transfer fine-grained lower bounds

The power of ETH comes through reductions that preserve the *parameter linearly*. The **Sparsification Lemma** (Impagliazzo–Paturi–Zane) lets you assume 3-SAT instances have `O(n)` clauses, so ETH gives a `2^{Ω(n)}` lower bound in terms of *clauses* too. Then a reduction with **linear blow-up** in the parameter transports the bound:

- A classic linear-size reduction from 3-SAT to many problems shows, under ETH, that they also need `2^{Ω(·)}` time — e.g., no `2^{o(n)}` algorithm for VERTEX-COVER, INDEPENDENT-SET, HAMILTONIAN-CYCLE, 3-COLORING on `n`-vertex graphs.
- For problems on **planar** graphs, reductions blow the parameter up only to `O(√·)`, matching the `2^{O(√n)}` algorithms from planar separators — ETH explains the **square-root phenomenon** (why planar NP-hard problems run in `2^{Θ(√n)}`, not `2^{Θ(n)}`).

The senior reading: a reduction is no longer just "preserves YES/NO" — under ETH it is "preserves the *exponent*," and that is what licenses claims like "your `2^{o(n)}` dream algorithm would refute ETH."

### Fine-grained / polynomial lower bounds

The same philosophy, applied *inside* P, explains why some polynomial algorithms resist improvement. Conjectured-hard "core" problems anchor entire equivalence webs under **fine-grained (often sub-quadratic) reductions**:

| Conjecture / core problem | Reductions imply |
|---|---|
| **3SUM** (no `O(n^{2−ε})`) | Many `O(n²)` geometry problems are "3SUM-hard" — no truly sub-quadratic algorithm unless 3SUM falls |
| **Orthogonal Vectors (OV)** (no `O(n^{2−ε})`, implied by SETH) | Edit distance, longest common subsequence, Fréchet distance — all `O(n²)`-hard |
| **APSP** (no `O(n^{3−ε})`) | Negative triangle, min-plus product, graph radius — all "APSP-hard" |

So when your edit-distance code runs in `O(n²)` and you wonder whether `O(n^{1.9})` is possible: a SETH-based fine-grained reduction says **no, not without refuting SETH** (Backurs–Indyk 2015). This is the modern, *quantitative* successor to NP-completeness, and it is built entirely from reductions — just reductions that now account for the exponent. See [`../09-lower-bounds-and-adversary-arguments/senior.md`](../09-lower-bounds-and-adversary-arguments/senior.md) for how these conditional lower bounds sit alongside the *unconditional* lower-bound techniques.

---

## Reductions Among Restricted Instances

NP-completeness is a worst-case statement over *all* instances. A natural and practically vital question: does the hardness survive when you **restrict the instances** — to planar graphs, bounded degree, special clause structure? Sometimes yes (the restriction is still rich enough to embed the gadgets), sometimes no (the restriction kills the construction and the problem becomes tractable). Knowing *which* is a senior skill, because your real instances are almost always restricted.

### Restrictions that stay hard

- **PLANAR 3-SAT** (Lichtenstein 1982): 3-SAT remains NP-complete even when the variable–clause incidence graph is *planar*. This is a workhorse: it lets you reduce to *geometric* and *map-like* problems while preserving planarity in the gadgets.
- **3-COLORING of planar graphs** is NP-complete (planar graphs are always 4-colorable by the Four Color Theorem, but deciding 3-colorability stays hard). The reduction from planar 3-SAT plants color-forcing gadgets that survive planar embedding.
- **HAM-CYCLE / TSP** stay NP-complete on planar, even grid-like, graphs.
- **VERTEX-COVER / INDEPENDENT-SET** remain NP-complete on planar and on bounded-degree graphs.

The principle: a restriction stays hard when its instances are still **expressive enough to host the gadgets** — planar 3-SAT survives because variable and clause gadgets can be laid out in the plane with crossover gadgets eliminating edge crossings.

### Restrictions that become easy

The flip side is more useful than it looks — these are the structural escape hatches:

- **2-SAT ∈ P.** Restrict clauses to **2 literals** and satisfiability becomes polynomial (Aspvall–Plass–Tarjan: build the implication graph, check no variable shares a strongly-connected component with its negation — linear time). The jump from 2 to 3 literals is the *entire* boundary between P and NP-complete for SAT.
- **Horn-SAT ∈ P.** Restrict to **Horn clauses** (at most one positive literal each) and unit-propagation solves it in linear time. Horn structure is exactly what makes logic-programming/Datalog evaluation tractable.
- **XOR-SAT ∈ P.** Clauses as XOR (linear equations over GF(2)) → Gaussian elimination.

The deep takeaway, due to **Schaefer's Dichotomy Theorem (1978)**: for Boolean constraint satisfaction defined by a fixed set of relations, the problem is **either in P or NP-complete — never anything in between.** The polynomial islands are exactly the 2-SAT-like, Horn-like, dual-Horn, affine (XOR), and trivially-satisfiable cases; *everything else* is NP-complete. There is no NP-intermediate Boolean CSP. So when you face a constraint problem, the right senior question is: *does it fall into one of Schaefer's tractable classes?* If yes, you have a polynomial algorithm; if no, it is NP-complete and you proceed to approximation/parameterization.

This is why restriction analysis pays rent: the *general* problem being NP-complete tells you nothing about whether *your* restricted version is a 2-SAT (free) or a planar-3-SAT (still hard). You must check the restriction against the known tractable/intractable boundary.

---

## A Worked Reduction: 3-SAT ≤ₚ SUBSET-SUM

A nontrivial reduction in full, with correctness in **both** directions — the digit-gadget reduction from 3-SAT to SUBSET-SUM. It is the cleanest illustration of a *number-encoding* gadget, and it explains why SUBSET-SUM is (weakly) NP-complete.

### The target

**SUBSET-SUM:** given a multiset `S = {a₁, …, a_k}` of positive integers and a target `t`, is there a subset summing to exactly `t`?

### The construction

Let `φ` be a 3-SAT formula with variables `x₁, …, xₙ` and clauses `C₁, …, C_m`. We build numbers in **base 10**, each with `n + m` decimal digit-positions: one position per variable (the "variable columns") and one per clause (the "clause columns"). Base 10 is chosen so columns *cannot carry into each other* — a column never sums past 9 — which is the linchpin of correctness.

**Variable numbers (two per variable `xᵢ`):**

- `v_i` (for `xᵢ = true`): a `1` in variable-column `i`, and a `1` in every clause-column `j` such that `xᵢ` appears **positively** in `Cⱼ`.
- `v_i'` (for `xᵢ = false`): a `1` in variable-column `i`, and a `1` in every clause-column `j` such that `xᵢ` appears **negatively** (as `¬xᵢ`) in `Cⱼ`.

**Slack numbers (two per clause `Cⱼ`):** `s_j` and `s_j'`, each with a single `1` in clause-column `j`. These absorb the difference between "how many literals satisfy `Cⱼ`" (1, 2, or 3) and the target digit.

**The target `t`:**

- A `1` in every **variable-column** (forcing exactly one of `vᵢ, vᵢ'` to be chosen per variable — a consistent truth assignment).
- A `3` in every **clause-column** (we will see why 3).

```text
                  var cols (n)        clause cols (m)
                 x1  x2 ... xn      C1  C2  ...  Cm
  v_1   (x1=T)    1   0      0       1   0        0     ← x1 satisfies C1 positively
  v_1'  (x1=F)    1   0      0       0   1        0     ← ¬x1 satisfies C2
  ...
  s_j , s_j'      0   0      0      (1 in column Cj only)
  --------------------------------------------------------
  target t        1   1      1       3   3        3
```

### Correctness — forward (satisfiable ⇒ subset exists)

Suppose `φ` has a satisfying assignment `A`. Choose `vᵢ` if `A(xᵢ) = true`, else `vᵢ'`. Then:

- **Variable columns:** exactly one of `{vᵢ, vᵢ'}` is picked per `i`, so each variable-column sums to exactly `1` = target. ✓
- **Clause columns:** since `A` satisfies `Cⱼ`, between **1 and 3** of the chosen variable-numbers contribute a `1` to clause-column `j`. Add the slacks `sⱼ, sⱼ'` as needed to top the column up to exactly `3` (if the literals contributed 1, take both slacks; if 2, take one; if 3, take none). Each column reaches `3` = target. ✓

No column ever exceeds `3 + 0 = 3` from variable+slack contributions, so there are **no carries**; column-wise correctness = numeric equality. The chosen subset sums to `t`.

### Correctness — backward (subset exists ⇒ satisfiable)

Suppose some subset sums to exactly `t`. Because base 10 forbids carries (max possible digit in any column is `5`: at most 3 variable-numbers + 2 slacks, all `< 10`), the sum must match `t` **column by column**.

- **Variable columns** must each sum to `1`. Only `vᵢ` and `vᵢ'` touch variable-column `i`, and each contributes `1`; to total `1`, **exactly one** is chosen. Reading "chose `vᵢ`" as `xᵢ = true` yields a well-defined, consistent assignment `A`. ✓
- **Clause columns** must each sum to `3`. The two slacks contribute at most `2`, so **at least `1`** must come from the chosen *variable-numbers* — meaning at least one literal of `Cⱼ` is set true by `A`. Hence every clause is satisfied. ✓

So a valid subset forces a consistent, satisfying assignment. Both directions hold, the construction is clearly polynomial (`2n + 2m` numbers, each `n + m` digits), and therefore **3-SAT ≤ₚ SUBSET-SUM**, proving SUBSET-SUM NP-complete.

### What the gadget teaches

The hardness is encoded entirely **in the *magnitude* of the numbers** — each is roughly `10^{n+m}`, i.e., `O(n+m)` *digits* but an astronomically large *value*. This is *precisely* why SUBSET-SUM is **weakly**, not strongly, NP-complete: the reduction needs numbers exponentially large in the input, so it breaks down if numbers are forced to be polynomially bounded (unary) — and indeed the `O(n·t)` pseudo-polynomial DP solves the unary case. The number-encoding gadget *is* the boundary between weak and strong hardness, made concrete.

> Contrast: a reduction like **3-SAT ≤ₚ HAMILTONIAN-CYCLE** encodes hardness *combinatorially* (choice gadgets for variables, traversal gadgets that force each clause to be "visited"), with no large numbers — which is why HAM-CYCLE is *strongly* NP-complete. The *form* of the gadget (numeric vs combinatorial) tells you the *kind* of NP-completeness you get.

---

## Decision Framework

| Situation | Reach for |
|---|---|
| Want to prove a problem **NP-complete** | Many-one (Karp) reduction *from* a known NP-complete problem, *to* yours; show membership in NP separately |
| Reducing **optimization to decision** ("at least as hard as") | Turing (Cook) reduction — multiple oracle calls / binary search allowed |
| Studying **completeness inside P** (P-complete, NL-complete) | **Log-space** reductions — poly-time ones are too powerful to be meaningful |
| Need the **counting** version's hardness | **Parsimonious** reduction → #P-completeness; check witness counts are preserved |
| Problem has **large numbers** in the input | Determine **weak vs strong**: is there an `O(n · value)` DP? If numbers are poly-bounded, weak ⇒ tractable |
| Want to rule out **good approximation** | **L-/AP-/gap-preserving** reduction from a PCP-derived gap problem — Karp reductions destroy the ratio |
| Want a **precise exponential lower bound** | ETH/SETH + a **parameter-linear** reduction; transports `2^{Ω(·)}` bounds |
| `O(n²)`/`O(n³)` algorithm you suspect is optimal | **Fine-grained** reduction from 3SUM / OV / APSP; conditional sub-quadratic/cubic lower bound |
| Your instances are **restricted** (planar, 2-literal, Horn) | Check the restriction against the tractable boundary (Schaefer, planar-3-SAT) — it may be in P |

---

## Research Pointers

- **Cook, S. (1971). "The Complexity of Theorem-Proving Procedures."** *STOC.* The tableau reduction; SAT is NP-complete.
- **Levin, L. (1973). "Universal Sequential Search Problems."** Independent discovery; the "Levin" of Cook–Levin.
- **Karp, R. (1972). "Reducibility Among Combinatorial Problems."** The original 21 NP-complete problems, all via many-one reductions.
- **Valiant, L. (1979). "The Complexity of Computing the Permanent."** *TCS.* PERMANENT is #P-complete; counting perfect matchings is hard.
- **Toda, S. (1991). "PP is as Hard as the Polynomial-Time Hierarchy."** `PH ⊆ P^{#P}`.
- **Garey, M., & Johnson, D. (1979). *Computers and Intractability.*** The reference on strong vs weak NP-completeness, 3-PARTITION, and the reduction catalogue.
- **Lichtenstein, D. (1982). "Planar Formulae and Their Uses."** Planar 3-SAT is NP-complete.
- **Schaefer, T. (1978). "The Complexity of Satisfiability Problems."** The dichotomy theorem for Boolean CSP.
- **Papadimitriou, C., & Yannakakis, M. (1991). "Optimization, Approximation, and Complexity Classes."** L-reductions and MAX-SNP.
- **Arora, S., & Safra, S. (1998); ALMSS (1998).** The PCP theorem; the engine of hardness of approximation.
- **Impagliazzo, R., & Paturi, R. (2001). "On the Complexity of k-SAT."** *JCSS.* ETH and SETH.
- **Impagliazzo, R., Paturi, R., & Zane, F. (2001). "Which Problems Have Strongly Exponential Complexity?"** The sparsification lemma.
- **Williams, V. V., & Williams, R. (2018). "Subcubic Equivalences Between Path, Matrix, and Triangle Problems."** APSP fine-grained equivalences.
- **Backurs, A., & Indyk, P. (2015). "Edit Distance Cannot Be Computed in Strongly Subquadratic Time (unless SETH is false)."** *STOC.* The OV/SETH lower bound for edit distance.
- **Arora, S., & Barak, B. (2009). *Computational Complexity: A Modern Approach.*** Covers Cook–Levin, #P, PCP, and the reduction zoo rigorously.

---

## Key Takeaways

1. **Cook–Levin is a reduction, not a slogan.** The `O(T²)`-variable, `O(T²)`-clause computation tableau — well-formedness, start, accept, and *local 2×3 transition windows* — turns any NP machine into a CNF formula in polynomial time. Locality of TM steps is *why* polynomial size suffices; this is the template every later reduction imitates.
2. **"Reduction" is a lattice.** Many-one (Karp, defines NP-completeness, cannot negate) vs Turing (Cook, for optimization-to-decision); poly-time vs **log-space** (the latter is mandatory for completeness *inside* P — P-complete, NL-complete). The resource bound on the reduction itself is load-bearing.
3. **Parsimonious reductions count.** They preserve the *number* of witnesses, giving #P-completeness. Valiant: the PERMANENT (= number of perfect matchings) is #P-complete — **counting can be hard even when deciding is in P.**
4. **Weak vs strong NP-completeness is about number encoding.** KNAPSACK/SUBSET-SUM are *weakly* NP-complete — the `O(n·W)` pseudo-polynomial DP wins when numbers are poly-bounded. 3-PARTITION/BIN-PACKING/TSP are *strongly* NP-complete — no pseudo-poly algorithm unless P = NP. Always ask *which* before despairing over a number-laden problem.
5. **Approximation-preserving reductions transport gaps.** L-/AP-/gap-preserving reductions (not Karp reductions) move inapproximability; the **PCP theorem** manufactures the original gap that makes "NP-hard to approximate within `ρ`" provable — link to [`../08-approximation-and-hardness/senior.md`](../08-approximation-and-hardness/senior.md).
6. **ETH/SETH turn hardness quantitative.** Stronger than `P ≠ NP`: 3-SAT needs `2^{Ω(n)}` (ETH); `k`-SAT can't beat `2^{(1−ε)n}` (SETH). Parameter-linear reductions transport these `2^{Ω(·)}` bounds; fine-grained reductions from 3SUM/OV/APSP explain why your `O(n²)`/`O(n³)` algorithm is probably optimal — link to [`../09-lower-bounds-and-adversary-arguments/senior.md`](../09-lower-bounds-and-adversary-arguments/senior.md).
7. **Restrictions decide tractability.** 3-SAT stays hard restricted to planar (planar 3-SAT, planar 3-coloring); 2-SAT, Horn-SAT, XOR-SAT collapse to P. Schaefer's dichotomy: every Boolean CSP is *either* in P *or* NP-complete — no middle. Check *your* restricted instances against the boundary.
8. **The gadget's form reveals the hardness type.** The 3-SAT ≤ₚ SUBSET-SUM digit gadget (base-10, no-carry columns, both directions verified) hides hardness in *number magnitude* → weak NP-completeness; a combinatorial gadget (3-SAT ≤ₚ HAM-CYCLE) hides it in *structure* → strong NP-completeness.

---

> **See also:** [`./middle.md`](./middle.md) for the reduction recipe and the basic zoo · [`../06-complexity-classes-p-np/senior.md`](../06-complexity-classes-p-np/senior.md) · [`../08-approximation-and-hardness/senior.md`](../08-approximation-and-hardness/senior.md) · [`../09-lower-bounds-and-adversary-arguments/senior.md`](../09-lower-bounds-and-adversary-arguments/senior.md)
