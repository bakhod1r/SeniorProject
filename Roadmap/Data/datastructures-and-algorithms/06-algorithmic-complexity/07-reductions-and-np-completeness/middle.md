# Reductions and NP-Completeness — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Polynomial-Time Many-One Reductions, Formally](#polynomial-time-many-one-reductions-formally)
3. [Algebra of Reductions: The Three Load-Bearing Lemmas](#algebra-of-reductions-the-three-load-bearing-lemmas)
4. [The Two-Step Recipe for Proving NP-Completeness](#the-two-step-recipe-for-proving-np-completeness)
5. [The Cook–Levin Theorem](#the-cooklevin-theorem)
6. [Gadget Design as a Methodology](#gadget-design-as-a-methodology)
7. [Reduction 1 — SAT ≤ₚ 3-SAT (Clause-Width)](#reduction-1--sat-p-3-sat-clause-width)
8. [Reduction 2 — 3-SAT ≤ₚ INDEPENDENT SET](#reduction-2--3-sat-p-independent-set)
9. [Reduction 3 — INDEPENDENT SET ≤ₚ VERTEX COVER ≤ₚ CLIQUE](#reduction-3--independent-set-p-vertex-cover-p-clique)
10. [Reduction 4 — 3-SAT ≤ₚ SUBSET-SUM](#reduction-4--3-sat-p-subset-sum)
11. [The Reduction Map and Two More Classics](#the-reduction-map-and-two-more-classics)
12. [Code: The 3-SAT → Independent Set Reduction, Verified](#code-the-3-sat--independent-set-reduction-verified)
13. [Pitfalls](#pitfalls)
14. [Summary](#summary)

---

## Introduction

> Focus: turn "reductions point the easy problem at the hard one" into a toolkit you can use to prove a *new* problem NP-complete.

At the junior level you collected the vocabulary: a reduction transforms one problem into another, the *direction* matters, "NP-complete" means "in NP **and** NP-hard," and SAT was the first problem proven NP-complete. That is the map legend. This file is the map: the precise definition of a polynomial-time reduction, the three lemmas that make reductions compose, the **two-step recipe** every NP-completeness proof follows, a proof sketch of the **Cook–Levin** theorem (why NP-complete problems exist at all), and a worked **reduction zoo** where each transformation is built gadget-by-gadget and verified in *both* correctness directions.

By the end you should be able to take an unfamiliar problem and, on a whiteboard, (1) write its verifier, (2) pick the right known-hard source problem, (3) design gadgets, and (4) prove `x ∈ A ⟺ f(x) ∈ B`. That is the single most valuable skill in this whole chapter, because in practice "this problem is NP-complete" is the verdict that tells you to stop hunting for an exact polynomial algorithm and reach for [approximation and hardness-aware design](../08-approximation-and-hardness/middle.md) instead.

This file assumes the definitions from [complexity classes P and NP](../06-complexity-classes-p-np/middle.md): the verifier definition of NP, `≤ₚ`, NP-hardness, and NP-completeness. If those are not solid, read that file first. The ground-floor intuition is in [the junior level](./junior.md); barriers, the polynomial hierarchy, and randomized reductions are in [the senior level](./senior.md).

---

## Polynomial-Time Many-One Reductions, Formally

> A **polynomial-time many-one reduction** (also Karp reduction, mapping reduction) from language `A` to language `B`, written `A ≤ₚ B`, is a function `f : Σ* → Σ*` such that:
>
> 1. `f` is computable in **polynomial time** — there is a deterministic algorithm and a fixed `k` that computes `f(x)` in `O(|x|^k)` steps; and
> 2. `f` preserves membership in **both directions**:
>
> ```text
> for all x:    x ∈ A   ⟺   f(x) ∈ B
> ```

Unpack the two clauses, because most flawed reductions break one of them.

**The map preserves the answer (both directions).** The biconditional `⟺` is two implications glued together, and *both* are obligatory:

```text
(forward / completeness)   x ∈ A   ⟹   f(x) ∈ B      "yes maps to yes"
(backward / soundness)     x ∉ A   ⟹   f(x) ∉ B      "no maps to no"
```

The contrapositive of the backward direction — `f(x) ∈ B ⟹ x ∈ A` — is usually how you actually argue it: assume the *target* instance is a YES, and reconstruct a YES for the source. A reduction that only proves the forward direction is **wrong**, not merely incomplete: it might map a NO-instance of `A` to a YES-instance of `B`, and then "solve `B`, read off `A`" would return the wrong answer.

**The map is cheap.** `f` must run in time polynomial in `|x|`. A consequence you will use constantly: because `f` runs in polynomial time, `|f(x)|` is itself polynomial in `|x|` (a machine cannot write more output than it has steps). So the target instance is never more than polynomially larger than the source. If your construction produces, say, `2^n` vertices, it is not a polynomial reduction — even if the biconditional holds.

The intuitive reading is "**`A` is no harder than `B`**, up to polynomial overhead." If you owned a fast solver for `B`, you could solve `A`: compute `f(x)`, hand it to the `B`-solver, and return its answer unchanged. The arrow points from the easier (or equal) problem to the harder (or equal) one.

```text
        f (poly-time)            B-solver
   x  ─────────────▶  f(x)  ─────────────▶  yes / no
  (A-instance)      (B-instance)        (also the answer for x)

   A ≤ₚ B   means   "solve B  ⟹  solve A"
```

---

## Algebra of Reductions: The Three Load-Bearing Lemmas

Three properties make `≤ₚ` usable as an ordering of difficulty. Each has a one-paragraph proof, and you should be able to reproduce all three.

**Lemma 1 (Transitivity).** If `A ≤ₚ B` and `B ≤ₚ C`, then `A ≤ₚ C`.

*Proof.* Let `f` reduce `A` to `B` and `g` reduce `B` to `C`. Define `h(x) = g(f(x))`. Then `x ∈ A ⟺ f(x) ∈ B ⟺ g(f(x)) ∈ C`, so `h` preserves membership. For the time bound: `f(x)` is computable in `O(|x|^a)` and has length `O(|x|^a)`; feeding it to `g` costs `O(|f(x)|^b) = O(|x|^{ab})`. Polynomial composed with polynomial is polynomial, so `h` is a polynomial-time reduction. ∎

Transitivity is what lets us build a *chain*: prove `SAT ≤ₚ 3SAT`, `3SAT ≤ₚ INDSET`, `INDSET ≤ₚ VC`, and transitivity hands you `SAT ≤ₚ VC` for free. You never re-reduce from scratch.

**Lemma 2 (Downward closure of P).** If `A ≤ₚ B` and `B ∈ P`, then `A ∈ P`.

*Proof.* To decide `x ∈ A`: compute `f(x)` (polynomial), then run `B`'s polynomial decider on `f(x)`. Correct because `x ∈ A ⟺ f(x) ∈ B`. Total time = polynomial + polynomial(on a polynomially-larger input) = polynomial. ∎

This is the lemma that powers the contrapositive engineers care about: if `A` is known NP-complete and `A ≤ₚ B`, then `B ∈ P` would drag `A` into P and collapse P = NP. So a hardness proof for `B` is a *license to give up* on an exact polynomial algorithm.

**Lemma 3 (Hardness transfers forward).** If `A` is NP-hard and `A ≤ₚ B`, then `B` is NP-hard.

*Proof.* `A` NP-hard means every `L ∈ NP` satisfies `L ≤ₚ A`. Take any `L ∈ NP`: `L ≤ₚ A` and `A ≤ₚ B`, so by transitivity `L ≤ₚ B`. Since `L` was arbitrary, every NP language reduces to `B`, i.e. `B` is NP-hard. ∎

Lemma 3 is the engine of the entire zoo. Cook–Levin establishes *one* NP-hard problem (SAT). After that, **a single new reduction from any known-NP-hard problem** transfers hardness to the next problem — we never again reduce "every NP language." The direction is the whole game: you reduce **from** the known-hard problem **to** your new one.

```text
   Cook–Levin:  every L ∈ NP  ≤ₚ  SAT          (SAT is NP-hard)
   then chain:  SAT ≤ₚ 3SAT ≤ₚ INDSET ≤ₚ VC ≤ₚ CLIQUE
                3SAT ≤ₚ SUBSET-SUM,  3SAT ≤ₚ 3COLOR,  3SAT ≤ₚ HAM-CYCLE
   each arrow uses Lemma 3 + Lemma 1: hardness flows rightward.
```

---

## The Two-Step Recipe for Proving NP-Completeness

To prove a problem `B` is **NP-complete**, you discharge exactly two obligations. Skipping or swapping them is the single most common error.

> **Step 1 — Show `B ∈ NP`.** Exhibit a certificate and a polynomial-time verifier `V(x, c)`: a string `c`, polynomially bounded in `|x|`, such that `x ∈ B ⟺ ∃c, V(x, c) = 1`. This is usually the easy step — for most natural problems the "obvious solution" *is* the certificate, and checking it is a linear scan.
>
> **Step 2 — Show `B` is NP-hard.** Pick a problem `A` **already known to be NP-complete**, and give a polynomial-time reduction `A ≤ₚ B`. By Lemma 3, this makes `B` NP-hard. To establish the reduction you must:
>
> - **define `f`** — the transformation from `A`-instances to `B`-instances, built from gadgets;
> - **prove `f` is polynomial-time** — bound the size of `f(x)` and the work to build it;
> - **prove the forward direction** — `x ∈ A ⟹ f(x) ∈ B` (a YES-solution for `A` constructs a YES-solution for `B`);
> - **prove the backward direction** — `f(x) ∈ B ⟹ x ∈ A` (a YES-solution for `f(x)` *reconstructs* a YES-solution for `A`).

```text
        ┌─────────────────────────────────────────────┐
        │  B is NP-complete                            │
        │     =  B ∈ NP        (Step 1: verifier)      │
        │     ∧  B is NP-hard  (Step 2: A ≤ₚ B,        │
        │                        A known NP-complete)  │
        └─────────────────────────────────────────────┘
   Step 2 requires BOTH correctness directions:
       x ∈ A  ⟹  f(x) ∈ B     and     f(x) ∈ B  ⟹  x ∈ A
```

Two discipline notes. First, **the reduction goes from the known-hard problem to your new problem**, never the reverse — reducing `B ≤ₚ A` proves `B` *easy relative to* `A`, the opposite of what you want. Second, **both correctness directions are mandatory**: the forward direction alone leaves open that some NO-instance of `A` slipped through to a YES of `B`. We will be pedantic about both directions in every reduction below.

Why is Step 1 (membership) needed at all? Because **NP-hard ≠ NP-complete**. A problem can be NP-hard yet sit far above NP (e.g. the *halting* problem is NP-hard but not in NP — not even decidable). "Complete" means "the hardest problems *inside* NP," which requires membership.

---

## The Cook–Levin Theorem

Everything above is bootstrapped from one foundational result: that an NP-complete problem exists at all.

> **Cook–Levin Theorem.** SAT — the language of satisfiable Boolean CNF formulas — is **NP-complete**.

Membership (`SAT ∈ NP`) is the easy half: a satisfying assignment is a polynomial-size certificate, and plugging it in to evaluate the formula is linear. The deep half is **NP-hardness**: *every* language `L ∈ NP` reduces to SAT. This is the only time anyone reduces "all of NP" directly; afterward we chain.

### Proof sketch of NP-hardness

Let `L ∈ NP`. By the [nondeterministic-machine definition](../06-complexity-classes-p-np/middle.md), there is a nondeterministic Turing machine `N` and a polynomial `p` such that `N` decides `L` and halts within `p(n)` steps on inputs of length `n`. We build, in polynomial time, a CNF formula `φ_x` such that:

```text
   x ∈ L   ⟺   N has an accepting computation on x   ⟺   φ_x is satisfiable.
```

The construction encodes a whole computation as Boolean variables, then writes clauses that are satisfied **exactly** by encodings of *valid accepting* computations.

**The tableau.** A computation of `N` for `p(n)` steps touches at most `p(n)` tape cells. Lay it out as a `(p(n)+1) × p(n)` grid — the **tableau** — where row `t` is the machine's configuration at time `t` (tape contents, head position, control state), and row `0` encodes the start configuration on input `x`.

```text
        cell 0   cell 1   cell 2  ...  cell p(n)-1
 t=0   [ start configuration: x written, head at 0, state q0      ]
 t=1   [ configuration after one step                            ]
 t=2   [ ...                                                      ]
  ...
 t=p(n)[ final configuration                                     ]
```

**The variables.** For each cell `(t, i)` and each possible content symbol `s` (a tape symbol, or a (state, symbol) pair marking where the head sits), introduce a Boolean variable `x_{t,i,s}` meaning "cell `(t, i)` holds `s` at time `t`." There are `O(p(n)^2)` cells and constantly many symbols, so `O(p(n)^2)` variables — polynomial.

**The clauses.** `φ_x` is a conjunction of four families, each a set of *local* constraints expressible as CNF:

- **Cell** — every cell holds exactly one symbol: at least one `x_{t,i,s}` true, and no two true. (Encodes a legal grid.)
- **Start** — row `0` spells out the initial configuration: head at cell 0, state `q₀`, input `x` written, rest blank.
- **Accept** — some cell carries the accepting state: a disjunction over all `(t, i)` of "cell `(t,i)` is in state `q_accept`."
- **Move (transition)** — the heart. Any `2 × 3` window of cells (two adjacent rows, three adjacent columns) must be *consistent with `N`'s transition relation* `δ`. Because a Turing-machine step only changes cells near the head, checking every overlapping `2×3` window enforces that row `t+1` legally follows from row `t`. There are `O(p(n)^2)` windows, each constrained by a constant-size CNF over its 6 cells' variables.

**Why this is a correct reduction.**

- *Forward (`x ∈ L ⟹ φ_x satisfiable`).* If `N` accepts `x`, take an accepting computation, read off its tableau, and set each `x_{t,i,s}` to match. The Cell, Start, Accept, and Move clauses are all satisfied because the tableau is, by construction, a legal accepting run. So `φ_x` has a satisfying assignment.
- *Backward (`φ_x satisfiable ⟹ x ∈ L`).* Any satisfying assignment encodes a grid that (Cell) is well-formed, (Start) begins correctly on `x`, (Move) transitions legally at every step — so it *is* a valid computation of `N` — and (Accept) reaches the accept state. Hence `N` has an accepting computation on `x`, i.e. `x ∈ L`.

**Why it is polynomial-time.** The number of variables and clauses is `O(p(n)^2)` with constant-size clauses, and each clause is mechanically generated from `N`'s fixed transition table. The whole formula is written in time polynomial in `n`. (The non-CNF "exactly one symbol" and window constraints are turned into CNF by standard local rewriting, only blowing up size by a constant factor.) ∎ (sketch)

The takeaway, beyond the gadgetry: **SAT is "computation expressed as logic."** A CNF formula is general enough to *simulate any polynomial-time-verifiable search*, which is exactly why every NP problem collapses into it. Once SAT is anchored, the rest of NP-completeness is the comparatively gentle business of reducing SAT (and its descendants) to one new problem at a time.

---

## Gadget Design as a Methodology

Almost every reduction in the zoo is built from **gadgets** — small, reusable structures, one per "part" of the source instance, wired together so the target's solution concept matches the source's. The recurring pattern, especially when reducing **from 3-SAT**, is two kinds of gadget:

- **Variable gadgets** encode a binary choice — should `xᵢ` be true or false? The gadget has exactly two "stable" states, and any valid solution of the target instance forces it into one of them. This is how an assignment to the variables is *read off* a target solution.
- **Clause gadgets** encode a constraint — "this clause must have a satisfied literal." The gadget is *solvable* (in the target's sense) **iff** at least one of its literals is set true by the variable gadgets it connects to.
- **Wiring / consistency** connects the two so that a variable gadget's state is the *same* everywhere a literal of that variable appears, and so that satisfying all clause gadgets requires a globally consistent assignment.

```text
   3-SAT instance φ
   ┌───────────┐        wires (consistency edges/constraints)        ┌────────────┐
   │ variable  │◀───────────────────────────────────────────────────▶│  clause    │
   │ gadgets   │   forces a true/false choice per variable            │  gadgets   │
   │ x1,x2,...  │   that propagates to every literal occurrence        │ C1,C2,...   │
   └───────────┘                                                      └────────────┘
   target YES  ⟺  variable gadgets pick a consistent assignment
                   AND every clause gadget is satisfiable under it
   ⟺  φ is satisfiable
```

Designing a reduction is mostly designing these gadgets so the biconditional falls out. The art is making the *only* valid target solutions correspond to *exactly* the satisfying assignments — no spurious solutions (which would break the backward direction) and no missed ones (which would break the forward direction). Watch this pattern recur in the next two reductions.

---

## Reduction 1 — SAT ≤ₚ 3-SAT (Clause-Width)

**3-SAT** is SAT restricted to formulas where every clause has **exactly three literals**. It is the workhorse source problem for the zoo because three literals is the sweet spot — small enough to make graph gadgets clean, still NP-hard. First we must *earn* its NP-completeness from SAT.

`3SAT ∈ NP`: same as SAT — a satisfying assignment is the certificate, checked in linear time.

**NP-hardness via `SAT ≤ₚ 3SAT`.** Given a CNF formula `φ`, rewrite each clause to have exactly three literals while preserving satisfiability. Process each clause `C` by its width `w` (number of literals), introducing fresh auxiliary variables `y₁, y₂, …` local to that clause:

```text
 w = 1:  (a)            →  (a ∨ y1 ∨ y2) ∧ (a ∨ y1 ∨ ¬y2) ∧
                           (a ∨ ¬y1 ∨ y2) ∧ (a ∨ ¬y1 ∨ ¬y2)
 w = 2:  (a ∨ b)        →  (a ∨ b ∨ y1) ∧ (a ∨ b ∨ ¬y1)
 w = 3:  (a ∨ b ∨ c)    →  (a ∨ b ∨ c)                        # unchanged
 w ≥ 4:  (ℓ1 ∨ ... ∨ ℓw) → (ℓ1 ∨ ℓ2 ∨ y1) ∧ (¬y1 ∨ ℓ3 ∨ y2) ∧
                            (¬y2 ∨ ℓ4 ∨ y3) ∧ ... ∧
                            (¬y_{w-3} ∨ ℓ_{w-1} ∨ ℓw)
```

The `w ≥ 4` case is the interesting one: a chain of `w − 2` triples linked by auxiliaries `y₁ … y_{w-3}`. The `yⱼ` form a "carry" that lets a satisfied literal propagate down the chain.

**Forward (`φ sat ⟹ φ' sat`).** Take a satisfying assignment of `φ`. For a long clause `(ℓ₁ ∨ … ∨ ℓ_w)`, some `ℓ_m` is true. Set `y₁ = … = y_{m-2} = true` and `y_{m-1} = … = false`. Check: the triples *before* `ℓ_m` are satisfied by their `yⱼ = true` literal; the triple *containing* `ℓ_m` is satisfied by `ℓ_m`; the triples *after* are satisfied by `¬y_j = true`. Every triple is satisfied, so `φ'` is satisfied. (The `w ≤ 2` cases satisfy trivially since `a`, `b` cover every triple regardless of the `yⱼ`.)

**Backward (`φ' sat ⟹ φ sat`).** Suppose some long clause has **all** original literals `ℓ₁ … ℓ_w` false. Then the chain forces `y₁ = true` (first triple needs it), which forces `y₂ = true` (second triple), … cascading to require `y_{w-3} = true`; but then the **last** triple `(¬y_{w-3} ∨ ℓ_{w-1} ∨ ℓ_w)` has all three literals false — contradiction. So no assignment can satisfy `φ'` while leaving a clause's original literals all-false; i.e. the restriction of a satisfying assignment of `φ'` to the original variables satisfies every clause of `φ`. The auxiliaries `yⱼ` cannot "rescue" an unsatisfied clause.

**Polynomial-time.** A clause of width `w` becomes `O(w)` triples and `O(w)` new variables; summed over all clauses the formula grows by a constant factor. ✔ Therefore `SAT ≤ₚ 3SAT`, and **3-SAT is NP-complete**.

---

## Reduction 2 — 3-SAT ≤ₚ INDEPENDENT SET

This is the canonical graph reduction and the one we implement in code. An **independent set** in a graph `G` is a set of vertices with no edge between any two; `INDSET = { ⟨G, k⟩ : G has an independent set of size ≥ k }`.

`INDSET ∈ NP`: certificate is the vertex set `S`; verify `|S| ≥ k` and check no edge lies inside `S` — `O(V + E)`. ✔

**NP-hardness via `3SAT ≤ₚ INDSET`.** Given a 3-CNF `φ` with `m` clauses `C₁ … C_m`, build a graph `G` and set the target `k = m`.

- **Clause gadget (triangle).** For each clause `Cⱼ = (ℓ_{j1} ∨ ℓ_{j2} ∨ ℓ_{j3})` create **three vertices**, one per literal occurrence, and connect them in a **triangle** (all three pairwise edges). Within a triangle an independent set may pick **at most one** vertex — this encodes "choose one literal to be the clause's satisfied witness."
- **Consistency edges (variable wiring).** Add an edge between **every pair of conflicting literal-vertices** across different clauses — that is, between any `xᵢ`-vertex and any `¬xᵢ`-vertex. This forbids an independent set from simultaneously "witnessing" `xᵢ` true in one clause and `xᵢ` false in another.

```text
   φ = (x1 ∨ x2 ∨ ¬x3) ∧ (¬x1 ∨ x2 ∨ x3)

   clause C1 triangle        clause C2 triangle
        x1                       ¬x1
       /  \                     /   \
     x2 ─ ¬x3                  x2 ─  x3

   consistency edges (dashed): x1 ── ¬x1 ,  ¬x3 ── x3
   target  k = m = 2
```

The construction has `3m` vertices and `O(m²)` edges — built in polynomial time. ✔

**Forward (`φ sat ⟹ G has independent set of size m`).** Take a satisfying assignment. In each clause pick *one* literal that the assignment makes true (one exists, since the clause is satisfied) and put its vertex into `S`. Then `|S| = m`. `S` is independent: (a) it has at most one vertex per triangle (we picked exactly one per clause), so no triangle edge is inside `S`; (b) it never contains both an `xᵢ`-vertex and a `¬xᵢ`-vertex, because all chosen literals are *true* under one consistent assignment, so no consistency edge is inside `S`. Hence an independent set of size `m` exists.

**Backward (`G has independent set of size m ⟹ φ sat`).** Suppose `S` is independent with `|S| = m`. Each triangle contributes **at most one** vertex to `S` (triangle edges), and there are `m` triangles, so `S` contains **exactly one** vertex per clause. Define an assignment: for each vertex `xᵢ` in `S` set `xᵢ = true`; for each `¬xᵢ` in `S` set `xᵢ = false`. This is **consistent** — `S` never contains both `xᵢ` and `¬xᵢ` (consistency edge) — and any variable not pinned by `S` can be set arbitrarily (say true). Under this assignment, each clause's chosen literal is true, so **every clause is satisfied**. Hence `φ` is satisfiable.

Both directions hold, the map is polynomial, so `3SAT ≤ₚ INDSET` and **INDEPENDENT SET is NP-complete.** The choice `k = m` is the crux: it forces "one true literal per clause," which is precisely satisfiability.

---

## Reduction 3 — INDEPENDENT SET ≤ₚ VERTEX COVER ≤ₚ CLIQUE

Two short reductions that share a single combinatorial fact, illustrating how *trivial* a reduction can be once you spot a duality. They give VERTEX COVER and CLIQUE their NP-completeness for free.

A **vertex cover** is a set of vertices `T` such that every edge has at least one endpoint in `T`; `VC = { ⟨G, k⟩ : G has a vertex cover of size ≤ k }`. A **clique** is a set of pairwise-adjacent vertices; `CLIQUE = { ⟨G, k⟩ : G has a clique of size ≥ k }`. Both are in NP (verify the defining property of the supplied vertex set in `O(V + E)` / `O(k²)`). ✔

### INDSET ≤ₚ VC — the complement-set identity

**Key fact.** In a graph `G = (V, E)`, a set `S` is an **independent set iff its complement `V \ S` is a vertex cover.**

*Why:* `S` independent ⟺ no edge has *both* endpoints in `S` ⟺ every edge has *at least one* endpoint outside `S`, i.e. in `V \ S` ⟺ `V \ S` is a vertex cover.

**Reduction.** `f(⟨G, k⟩) = ⟨G, n − k⟩` where `n = |V|`. The graph is unchanged; only the target number flips.

- Forward: if `G` has an independent set of size `≥ k`, its complement is a vertex cover of size `≤ n − k`.
- Backward: if `G` has a vertex cover of size `≤ n − k`, its complement is an independent set of size `≥ k`.

Both directions are the same identity read two ways; `f` is `O(1)` work beyond copying `G`. So `INDSET ≤ₚ VC`, and **VERTEX COVER is NP-complete.** (The relationship `α(G) + τ(G) = n` — independence number plus vertex-cover number equals `n` — is exactly this identity.)

### INDSET ≤ₚ CLIQUE — the complement-graph identity

**Key fact.** `S` is an **independent set in `G` iff `S` is a clique in the complement graph `Ḡ`** (where `Ḡ` has an edge exactly where `G` does not).

*Why:* `S` independent in `G` ⟺ no two vertices of `S` are adjacent in `G` ⟺ every two vertices of `S` *are* adjacent in `Ḡ` ⟺ `S` is a clique in `Ḡ`.

**Reduction.** `f(⟨G, k⟩) = ⟨Ḡ, k⟩` — build the complement graph, keep `k`.

- Forward: an independent set of size `k` in `G` is a clique of size `k` in `Ḡ`.
- Backward: a clique of size `k` in `Ḡ` is an independent set of size `k` in `G`.

Building `Ḡ` is `O(V²)`. So `INDSET ≤ₚ CLIQUE`, and **CLIQUE is NP-complete.** By transitivity (Lemma 1) we now have `3SAT ≤ₚ INDSET ≤ₚ {VC, CLIQUE}` — three problems hardened from one graph construction plus two near-trivial maps.

---

## Reduction 4 — 3-SAT ≤ₚ SUBSET-SUM

A reduction of a different flavor — from logic to *arithmetic* — showing the toolkit is not graph-bound. **SUBSET-SUM** asks: given positive integers `a₁ … a_r` and target `t`, is there a subset summing to exactly `t`? `SS = { ⟨a₁…a_r, t⟩ : some subset sums to t }`. It is in NP (the subset is the certificate; add and compare). ✔

**NP-hardness via `3SAT ≤ₚ SUBSET-SUM` — the digit gadget.** Given a 3-CNF `φ` over variables `x₁ … x_n` with clauses `C₁ … C_m`, we build base-10 numbers laid out in **columns**: one column per variable (`n` columns) and one column per clause (`m` columns), `n + m` decimal digits total. The trick is to choose digits so that no column can produce a *carry*, so column sums behave independently.

- **Variable numbers.** For each variable `xᵢ`, create two numbers `t_i` (means "`xᵢ` = true") and `f_i` ("`xᵢ` = false"). Each has a `1` in **its own variable column** `i`. Additionally, `t_i` has a `1` in every **clause column** `Cⱼ` where the literal `xᵢ` appears; `f_i` has a `1` in every clause column where `¬xᵢ` appears.
- **Slack numbers.** For each clause `Cⱼ`, add two "filler" numbers `s_j` and `s'_j`, each with a `1` only in clause column `Cⱼ`.
- **Target `t`.** Put a `1` in every variable column and a `3` in every clause column:

```text
            var cols           clause cols
            x1 x2 ... xn     C1 C2 ... Cm
   target    1  1  ...  1     3  3  ...  3
```

**Reading the target.** A subset summing to `t` must, in each **variable column**, total `1` — so it picks **exactly one** of `{t_i, f_i}` per variable (they are the only numbers with a `1` there). That is a clean truth assignment: choosing `t_i` ⟺ `xᵢ = true`. In each **clause column**, the target is `3`; the contributions come from (a) the variable numbers whose literal satisfies `Cⱼ` and (b) the two slack numbers `s_j, s'_j`. The two slacks supply at most `2`, so the column reaches `3` **iff at least one satisfying literal was chosen** — i.e. the clause is satisfied. (If 1 literal satisfies it, use both slacks: `1 + 2 = 3`; if 2, use one slack: `2 + 1 = 3`; if 3, use no slack: `3`. If 0 literals satisfy it, slacks give at most `2 < 3` — unreachable.) Digits stay ≤ a constant, so no carries cross columns and the analysis is column-local.

- **Forward:** a satisfying assignment chooses the matching `t_i`/`f_i` and, per clause, the right number of slacks to top each clause column up to `3` — a subset summing to `t`.
- **Backward:** a subset summing to `t` picks exactly one of `t_i/f_i` per variable (variable columns) → a consistent assignment, and reaches `3` in every clause column → every clause has a satisfying literal → `φ` is satisfied.

The numbers are `n + m` digits long, and there are `2n + 2m` of them — all written in polynomial time. So `3SAT ≤ₚ SUBSET-SUM` and **SUBSET-SUM is NP-complete.** Note the digits are *encoded in binary as usual*; the values are exponential but their **bit-lengths are polynomial**, which is why this is a legitimate reduction (and why the famous `O(r·t)` DP for SUBSET-SUM is only *pseudo*-polynomial — `t` is exponential in its bit-length).

---

## The Reduction Map and Two More Classics

The web below is the standard "first dozen" NP-complete problems, all rooted at Cook–Levin's SAT and chained by the reductions above (and two more named next).

```text
                         SAT  (Cook–Levin: every L ∈ NP ≤ₚ SAT)
                          │  clause-width
                          ▼
                        3-SAT ────────────────┬──────────────┬───────────────┐
                          │ triangles+wires    │ digit gadget  │ gadgets        │ gadgets
                          ▼                    ▼               ▼               ▼
                  INDEPENDENT SET          SUBSET-SUM       3-COLORING     HAMILTONIAN
                    │            │             │            (graph)         CYCLE
            complement│      complement        │                              │
              set     │       graph            ▼                              ▼
                ▼     ▼                     PARTITION,                    TRAVELING
          VERTEX    CLIQUE                  KNAPSACK(dec.)                SALESMAN(dec.)
          COVER
```

Two reductions worth knowing by name even if we only sketch them:

- **3-SAT ≤ₚ 3-COLORING.** Uses a fixed "palette" triangle (colors True/False/Base), one True/False vertex pair per variable wired to the palette, and a per-clause **OR-gadget** (a small fixed graph) that is 3-colorable iff at least one of its three literal-inputs is colored True. A proper 3-coloring forces a consistent True/False choice per variable and a satisfied literal per clause — so the graph is 3-colorable iff `φ` is satisfiable.
- **3-SAT ≤ₚ HAMILTONIAN CYCLE.** Uses a long "two-way traversable" path gadget per variable (direction of traversal = the variable's truth value) and a clause node that the Hamiltonian cycle can detour into iff some literal is set to satisfy it. The cycle exists iff `φ` is satisfiable. From HAM-CYCLE, the **Traveling Salesman** decision problem follows by a one-line reduction (edge weights `1`/`2`, ask for a tour of length `≤ n`).

The point of the map is leverage: **proving SAT NP-hard once** (the hard, all-of-NP Cook–Levin argument) lets every other node inherit hardness through *one local gadget construction* apiece. When you meet a *new* problem, your job is to attach it to this map with a single arrow from a node that "looks structurally similar" — graph problems usually reduce from 3-SAT/INDSET/3-COLOR/HAM-CYCLE; number problems from SUBSET-SUM/PARTITION.

---

## Code: The 3-SAT → Independent Set Reduction, Verified

The most convincing way to trust a reduction is to *run* it: build `f(φ) = ⟨G, k⟩`, then brute-force both sides on small instances and confirm `φ satisfiable ⟺ G has an independent set of size k`. Both programs do exactly that.

### Go

```go
package main

import "fmt"

// A 3-CNF formula: each clause is exactly 3 literals.
// Literal +v means variable v true, -v means variable v false (1-indexed).
type Clause [3]int

// ---- The reduction f: 3-SAT  ->  (graph G, k) ---------------------------
// Vertices: 3 per clause (one per literal occurrence), id = clauseIndex*3 + pos.
// Edges:  (a) triangle inside each clause; (b) consistency edge between any
//             two literal-vertices that are negations of the same variable.
// Target: k = number of clauses.
type Graph struct {
	N    int       // vertex count
	Adj  [][]bool  // adjacency matrix
	Lit  []int     // Lit[i] = the literal that vertex i represents
}

func reduce(clauses []Clause) (Graph, int) {
	n := 3 * len(clauses)
	g := Graph{N: n, Adj: make([][]bool, n), Lit: make([]int, n)}
	for i := range g.Adj {
		g.Adj[i] = make([]bool, n)
	}
	for ci, c := range clauses {
		for p := 0; p < 3; p++ {
			g.Lit[ci*3+p] = c[p]
		}
		// (a) triangle edges within this clause
		a, b, d := ci*3+0, ci*3+1, ci*3+2
		addEdge(&g, a, b)
		addEdge(&g, a, d)
		addEdge(&g, b, d)
	}
	// (b) consistency edges: conflicting literals across the whole graph
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			if g.Lit[i] == -g.Lit[j] { // e.g. +x and -x
				addEdge(&g, i, j)
			}
		}
	}
	return g, len(clauses)
}

func addEdge(g *Graph, u, v int) { g.Adj[u][v] = true; g.Adj[v][u] = true }

// ---- Brute force: is φ satisfiable? -------------------------------------
func satisfiable(clauses []Clause, numVars int) bool {
	for mask := 0; mask < (1 << numVars); mask++ {
		ok := true
		for _, c := range clauses {
			clauseSat := false
			for _, lit := range c {
				v := lit
				if v < 0 {
					v = -v
				}
				val := mask&(1<<(v-1)) != 0
				if (lit > 0) == val {
					clauseSat = true
					break
				}
			}
			if !clauseSat {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}

// ---- Brute force: does G have an independent set of size k? -------------
func hasIndependentSet(g Graph, k int) bool {
	for mask := 0; mask < (1 << g.N); mask++ {
		if bits(mask) != k {
			continue
		}
		if independent(g, mask) {
			return true
		}
	}
	return false
}

func independent(g Graph, mask int) bool {
	for i := 0; i < g.N; i++ {
		if mask&(1<<i) == 0 {
			continue
		}
		for j := i + 1; j < g.N; j++ {
			if mask&(1<<j) != 0 && g.Adj[i][j] {
				return false // both endpoints chosen on an edge
			}
		}
	}
	return true
}

func bits(x int) int { n := 0; for x > 0 { n += x & 1; x >>= 1 }; return n }

func main() {
	// Try several formulas; confirm sat(φ) == hasIndependentSet(reduce(φ)).
	cases := [][]Clause{
		{{1, 2, -3}, {-1, 2, 3}},          // satisfiable
		{{1, 1, 1}, {-1, -1, -1}},         // (x1) ∧ (¬x1): UNSAT
		{{1, 2, 3}, {-1, -2, -3}, {1, -2, 3}},
	}
	for _, clauses := range cases {
		numVars := 0
		for _, c := range clauses {
			for _, l := range c {
				if a := abs(l); a > numVars {
					numVars = a
				}
			}
		}
		g, k := reduce(clauses)
		sat := satisfiable(clauses, numVars)
		ind := hasIndependentSet(g, k)
		fmt.Printf("sat=%-5v  indset(k=%d)=%-5v  match=%v\n", sat, k, ind, sat == ind)
	}
}

func abs(x int) int { if x < 0 { return -x }; return x }
```

### Python

```python
from itertools import combinations, product


# ---- The reduction f: 3-SAT  ->  (graph G as edge set, k) ----------------
# Vertices: 3 per clause; vertex id = clause_index * 3 + position.
# Edges:  (a) triangle within each clause; (b) consistency edge between any
#             two literal-vertices that negate the same variable.
# Target: k = number of clauses.
def reduce(clauses):
    n = 3 * len(clauses)
    lit = [0] * n
    edges = set()

    def add(u, v):
        edges.add((min(u, v), max(u, v)))

    for ci, clause in enumerate(clauses):
        for p in range(3):
            lit[ci * 3 + p] = clause[p]
        a, b, c = ci * 3, ci * 3 + 1, ci * 3 + 2
        add(a, b); add(a, c); add(b, c)          # (a) triangle

    for i in range(n):                           # (b) consistency edges
        for j in range(i + 1, n):
            if lit[i] == -lit[j]:
                add(i, j)

    return n, edges, len(clauses)


# ---- Brute force: is the 3-CNF satisfiable? ------------------------------
def satisfiable(clauses):
    variables = sorted({abs(l) for clause in clauses for l in clause})
    for bits in product([False, True], repeat=len(variables)):
        assign = dict(zip(variables, bits))
        if all(any((l > 0) == assign[abs(l)] for l in clause) for clause in clauses):
            return True
    return False


# ---- Brute force: independent set of size exactly k? ---------------------
def has_independent_set(n, edges, k):
    for subset in combinations(range(n), k):
        s = set(subset)
        if not any(u in s and v in s for (u, v) in edges):
            return True
    return False


def main():
    cases = [
        [(1, 2, -3), (-1, 2, 3)],                 # satisfiable
        [(1, 1, 1), (-1, -1, -1)],                # (x1) ∧ (¬x1): UNSAT
        [(1, 2, 3), (-1, -2, -3), (1, -2, 3)],
    ]
    for clauses in cases:
        n, edges, k = reduce(clauses)
        sat = satisfiable(clauses)
        ind = has_independent_set(n, edges, k)
        print(f"sat={sat!s:<5} indset(k={k})={ind!s:<5} match={sat == ind}")


if __name__ == "__main__":
    main()
```

Both programs print `match=True` on every case: `φ` is satisfiable **exactly when** its reduced graph has an independent set of size `k = m`. That empirical agreement is the biconditional `x ∈ A ⟺ f(x) ∈ B` made executable. The structural lesson: the reduction `reduce` is *cheap* (polynomial — it just lays down triangles and consistency edges), while both `satisfiable` and `has_independent_set` are *exponential* brute forces. The reduction does not make either problem easier; it certifies they are the **same** problem wearing different clothes. A polynomial algorithm for one would, through `reduce`, be a polynomial algorithm for the other — and (chaining back) for all of NP.

---

## Pitfalls

**1. Reducing in the wrong direction.** To prove your problem `B` is NP-hard, reduce a *known NP-complete* problem **to** `B` (`A ≤ₚ B`, `A` known hard). Reducing `B ≤ₚ A` proves `B` is *easy relative to `A`* — the opposite. Mnemonic: "reduce **from** the monster **onto** your problem." The monster's hardness flows along the arrow into `B`.

**2. Proving only one correctness direction.** `x ∈ A ⟹ f(x) ∈ B` alone is worthless: it does not rule out a NO-instance of `A` mapping to a YES-instance of `B`. You must also prove `f(x) ∈ B ⟹ x ∈ A` (typically by reconstructing an `A`-solution from a `B`-solution). Both directions, every time.

**3. A reduction that is not polynomial-time.** A construction whose output has exponentially many objects (e.g. `2^n` vertices, or numbers whose *bit-length* is exponential) is not a valid reduction even if the biconditional holds. Always bound `|f(x)|` as a polynomial in `|x|`. This is the trap behind "pseudo-polynomial" algorithms: SUBSET-SUM's `O(r·t)` DP is *not* polynomial because `t` is exponential in its bit-length.

**4. Forgetting Step 1 (membership in NP).** Proving NP-hardness alone gives "NP-hard," not "NP-complete." You still need a polynomial verifier to show `B ∈ NP`. Some NP-hard problems (e.g. TSP-optimization stated as "find the *shortest* tour," or the halting problem) are not in NP at all.

**5. Gadgets with spurious solutions.** If your target instance has valid solutions that do *not* correspond to any source solution, the backward direction fails. Design gadgets so the *only* valid target solutions are images of source solutions — this is the real difficulty in inventing a reduction.

**6. Mis-setting the target parameter.** In `3SAT ≤ₚ INDSET`, `k = m` (number of clauses) is not arbitrary: a smaller `k` would not force one true literal per clause; a larger `k` is unachievable (triangles cap the set at `m`). The numeric target is part of the gadget design, not an afterthought.

**7. Confusing NP-hard with "uncomputable" or "exponential-proven."** NP-hardness is a *relative* statement (`≤ₚ`-above all of NP). It is *evidence* of intractability conditioned on `P ≠ NP`, not a proof that no polynomial algorithm exists — see [complexity classes P and NP](../06-complexity-classes-p-np/middle.md) on why `P ⊊ EXP` does not settle this.

---

## Summary

- A **polynomial-time many-one reduction** `A ≤ₚ B` is a polynomial-time `f` with `x ∈ A ⟺ f(x) ∈ B`. The biconditional is **two** obligations — yes↦yes and no↦no — and `f`'s output is at most polynomially larger than its input. It means "`A` is no harder than `B`."
- Three lemmas make `≤ₚ` an ordering of difficulty: **transitivity** (chain reductions), **downward closure of P** (`A ≤ₚ B`, `B ∈ P` ⟹ `A ∈ P`), and **forward transfer of hardness** (`A` NP-hard, `A ≤ₚ B` ⟹ `B` NP-hard). The last is the engine of the zoo.
- The **two-step recipe** to prove `B` NP-complete: (1) `B ∈ NP` via a polynomial verifier; (2) `A ≤ₚ B` from a known NP-complete `A`, with `f` polynomial and **both** correctness directions proven.
- **Cook–Levin** anchors the whole edifice: SAT is NP-complete because an NP machine's `p(n)`-step computation can be encoded as a **tableau** of `O(p(n)²)` Boolean cell-variables, and four clause families (Cell, Start, Accept, Move-window) make `φ_x` satisfiable iff the machine accepts. SAT is "computation as logic."
- The worked zoo, each gadget-built and both-directions-checked: **SAT ≤ₚ 3-SAT** (clause-width chains), **3-SAT ≤ₚ INDEPENDENT SET** (clause triangles + conflict edges, `k = m`), **INDSET ≤ₚ VERTEX COVER** (complement set, `k ↦ n − k`) **≤ₚ CLIQUE** (complement graph, same `k`), and **3-SAT ≤ₚ SUBSET-SUM** (carry-free digit gadgets). **3-COLORING** and **HAMILTONIAN CYCLE** follow from 3-SAT by analogous gadgets.
- **Gadget methodology**: variable gadgets encode a binary choice, clause gadgets encode "at least one true literal," wiring enforces global consistency; the craft is admitting *exactly* the satisfying assignments as target solutions. The code makes the 3-SAT → INDSET biconditional executable and confirms `sat(φ) = hasIndependentSet(reduce(φ), m)` on every test.

Continue to the [senior level](./senior.md) for the relativization/oracle barrier (why these techniques cannot resolve P vs NP), Turing vs many-one reductions, the polynomial hierarchy, and randomized/approximation-preserving reductions. Back to the [junior level](./junior.md) for the ground intuition, sideways to [complexity classes P and NP](../06-complexity-classes-p-np/middle.md) for the class definitions these reductions act on, or onward to [approximation and hardness](../08-approximation-and-hardness/middle.md) for what to *do* once your problem is proven NP-complete.
