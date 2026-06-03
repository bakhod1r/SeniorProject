# Job Scheduling (Job Sequencing with Deadlines) — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions — Jobs, Schedules, Feasibility
2. The Problem and the Greedy Algorithm (statement)
3. Optimality Proof I — The Exchange Argument
4. Feasibility Characterization (Hall-type condition)
5. Optimality Proof II — Job Sequencing as a Matroid
6. The Matroid-Greedy Theorem and Why It Applies
7. Complexity — Linear Scan, Union-Find, Heap
8. Cache Behavior and Average-Case Analysis
9. Space–Time Trade-offs
10. Generalizations and Their Complexity (k machines, weighted, NP-hardness boundary)
11. Open Problems and Summary
12. Reference Code (union-find / heap, Go / Java / Python)

---

## 1. Formal Definitions — Jobs, Schedules, Feasibility

Let `J = {1, …, n}` be a set of **jobs**. Each job `i` has a **profit** `p_i ∈ ℝ_{>0}` and an integer **deadline** `d_i ∈ ℤ_{≥1}`. Time is partitioned into unit **slots** indexed `1, 2, 3, …`. Each job requires exactly one unit of processing on a **single machine**, and at most one job runs per slot.

**Definition 1.1 (Schedule).** A schedule is a partial injection `σ : S → ℤ_{≥1}` from a subset `S ⊆ J` of accepted jobs to distinct slots.

**Definition 1.2 (Feasibility).** A schedule `σ` is *feasible* if every accepted job meets its deadline: `σ(i) ≤ d_i` for all `i ∈ S`. A set `S ⊆ J` is *feasible* if there exists a feasible schedule on `S` (an injective assignment of each `i ∈ S` to a slot `≤ d_i`).

Note that feasibility is a property of the *set*, not of any particular schedule: a set is feasible if *some* valid assignment exists. Theorem 4.1 will reduce this existential statement to a simple counting condition, and Corollary 4.2 will show the latest-first and earliest-first canonical schedules both realize it whenever any schedule does — so the algorithm never needs to search over assignments.

**Definition 1.3 (Objective).** Maximize total profit `P(S) = Σ_{i ∈ S} p_i` over all feasible sets `S`.

We assume `p_i > 0` without loss of generality: a job with `p_i ≤ 0` is never worth scheduling (dropping it cannot decrease the objective), so it can be discarded in preprocessing. Deadlines are positive integers; a job with `d_i ≤ 0` is infeasible and likewise discarded. After this normalization `1 ≤ d_i` and `D = max_i d_i` is well-defined.

**Definition 1.4 (Canonical / latest-slot schedule).** Given a feasible set `S`, the *canonical schedule* assigns jobs to slots greedily latest-first: process `S` in any order and place each job in the largest free slot `≤` its deadline. (We will show feasibility does not depend on order.)

**Notation.** `D = max_i d_i` is the maximum deadline; `τ(S)` denotes whether `S` is feasible. For a threshold `t`, let `N(t) = |{ i ∈ S : d_i ≤ t }|` be the number of accepted jobs with deadline at most `t`.

---

**Definition 1.8 (Profile function).** For a job set `S`, the *deadline profile* is the function `t ↦ N(t)`. It is non-decreasing, right-continuous (as a step function over integers), and satisfies `N(D) = |S|`. The entire theory of feasibility (§4) is a statement about this profile lying weakly below the identity line `t`. Two job sets with the same profile are equivalent for all scheduling purposes, a fact exploited by coordinate compression in the engineering files.

---

## 2. The Problem and the Greedy Algorithm (statement)

**Problem (Job Sequencing with Deadlines).** Given `(p_i, d_i)_{i=1}^n`, find a feasible set `S*` maximizing `P(S)`.

**Greedy Algorithm G.**

```
1. Sort jobs so that p_{π(1)} ≥ p_{π(2)} ≥ … ≥ p_{π(n)}.
2. S ← ∅.
3. For i = π(1), …, π(n):
       if S ∪ {i} is feasible:
           S ← S ∪ {i}.
4. Return S.
```

The feasibility test in line 3 is realized by attempting to place job `i` in the latest free slot `≤ d_i`; the placement succeeds iff `S ∪ {i}` is feasible (proved in §4–§5).

**Theorem 2.1 (Optimality).** The set `S` returned by `G` maximizes `P` over all feasible sets.

We give two independent proofs: an elementary **exchange argument** (§3) and a structural **matroid** proof (§5–§6). A third, polyhedral proof via total unimodularity appears in §10.1. All three establish the same conclusion; they differ in the machinery invoked and in what generalizations each suggests.

The feasibility test in line 3 deserves emphasis: it must be an *exact* oracle (accept iff the augmented set is feasible), and Lemma 4.3 proves the "place in the latest free slot" attempt is exactly that oracle — it succeeds precisely when feasibility is preserved. This equivalence between an *operational* test (can I place it?) and a *combinatorial* property (is the set feasible?) is what lets the abstract matroid greedy be realized by concrete slot manipulation.

---

## 3. Optimality Proof I — The Exchange Argument

We first record the key feasibility lemma that the greedy relies on.

**Lemma 3.1 (Latest-slot placement preserves feasibility).** Let `S` be feasible and let `j ∉ S`. If, in the canonical latest-first schedule of `S`, some slot `≤ d_j` is free, then `S ∪ {j}` is feasible (place `j` in that latest free slot). Conversely, if all slots `1, …, d_j` are occupied by `S`, then `S ∪ {j}` is infeasible.

*Proof.* The forward direction is immediate: an explicit feasible schedule for `S ∪ {j}` is the canonical schedule of `S` with `j` in the free slot `≤ d_j`. For the converse, if slots `1..d_j` are all used by `S`, then `S ∪ {j}` has `≥ d_j + 1` jobs all with deadline `≤ d_j` in the worst case... more carefully: the `d_j` jobs occupying `1..d_j` together with `j` all have deadline `≤ d_j` only if those occupants do; but the canonical schedule places jobs as late as possible, so any job sitting in a slot `≤ d_j` could not be moved later. By Hall's condition (§4), `S ∪ {j}` violates feasibility. ∎

**Theorem 3.2 (Greedy is optimal — exchange argument).** Let `S` be the greedy set and `O` an optimal feasible set. Then `P(S) = P(O)`.

*Proof.* Order both `S` and `O` by descending profit. Suppose for contradiction `P(O) > P(S)`. Consider the jobs in descending profit order `j₁, j₂, …` (over all of `J`). Let `k` be the **first** job (highest profit) on which `S` and `O` differ:

- **Case A: `k ∈ O`, `k ∉ S`.** Greedy considered `k` and rejected it, so when greedy reached `k`, the set `S_{<k}` of already-accepted higher-profit jobs (all of which lie in `O` too, by minimality of `k`) made `S_{<k} ∪ {k}` infeasible — i.e. slots `1..d_k` were full of jobs in `S_{<k} ⊆ O`. But then `O ⊇ S_{<k} ∪ {k}` would have `d_k + 1` jobs competing for slots `1..d_k`, contradicting `O`'s feasibility (Hall, §4). So Case A cannot occur.
- **Case B: `k ∈ S`, `k ∉ O`.** Then `O ∪ {k}` — or, if adding `k` overfills, `O` with some **lower-profit** job `ℓ` (processed after `k`, hence `p_ℓ ≤ p_k`) **swapped out for `k`** — is feasible and has profit `≥ P(O)`. Concretely, since `S_{<k} = O_{<k}` and greedy accepted `k`, the set `O_{<k} ∪ {k} = S_{≤k}` is feasible; extend it to a feasible superset within `O`'s deadline structure by removing at most one job of profit `≤ p_k`. This yields a feasible set `O'` with `P(O') ≥ P(O)` that agrees with `S` on the top `k` jobs.

Repeating the exchange in Case B strictly increases the prefix on which `O'` agrees with `S`, never decreasing profit. After finitely many steps `O'` equals `S`, so `P(S) ≥ P(O)`. Combined with optimality of `O`, `P(S) = P(O)`. ∎

The exchange argument is elementary but the bookkeeping of "swap out a lower-profit job" is exactly what the matroid view (§5) makes automatic.

**Remark 3.3 (Why the exchange is always *toward* the greedy).** A common confusion is whether the exchange might cycle or get stuck. It cannot, because each exchange strictly extends the prefix of jobs (in descending profit order) on which `O'` agrees with the greedy set `S`. This prefix length is a non-negative integer bounded by `n`, and it strictly increases at every step, so the process terminates after at most `n` exchanges with `O' = S`. Monovariant arguments of this shape — "find a potential that strictly improves and is bounded" — are the standard template for proving greedy optimality and are worth recognizing across problems (interval scheduling, Huffman, MST cut property all use the same skeleton).

**Remark 3.4 (Equivalence of the two greedy orderings).** The exchange argument as stated processes jobs in *descending profit* (the slot method). An entirely parallel argument processes jobs in *ascending deadline* with min-heap eviction (the heap method) and reaches the same `S` up to profit-ties. The cleanest way to see they coincide is the matroid uniqueness-of-weight proposition (6.3): both are greedy constructions of a maximum-weight basis, and all such bases share the same weight. The exchange argument proves optimality of *each* ordering; the matroid proposition proves they *agree in value*.

---

## 4. Feasibility Characterization (Hall-type Condition)

**Theorem 4.1 (Feasibility criterion).** A set `S` of jobs is feasible **iff** for every integer `t ≥ 1`,

```
N(t) = |{ i ∈ S : d_i ≤ t }| ≤ t.
```

That is, the number of jobs with deadline `≤ t` never exceeds the number of available slots `1..t`.

*Proof.* (⇒) In any feasible schedule, the jobs with deadline `≤ t` must occupy distinct slots all `≤ t`; there are only `t` such slots, so `N(t) ≤ t`.

(⇐) Suppose `N(t) ≤ t` for all `t`. Sort `S` by deadline ascending and place jobs greedily into the earliest free slot. Job with deadline `d` is the `k`-th job with deadline `≤ d` for some `k ≤ N(d) ≤ d`, so a slot `≤ d` is free. Hence the assignment is feasible. (This is exactly **Hall's marriage condition** for the bipartite graph jobs↔slots, with `S` on one side and slots `1..D` on the other; a job `i` is adjacent to slots `1..d_i`.) ∎

**Corollary 4.2.** Feasibility is independent of the placement order: if any feasible schedule exists, the latest-first (and the earliest-first) canonical schedules are both feasible.

This Hall condition is the engine of every optimality proof: it converts "can these jobs be scheduled?" into a clean counting inequality.

**Worked example of the Hall test.** Consider jobs with deadlines `{1, 1, 2, 3}`. Sort ascending: `[1, 1, 2, 3]`. Check the `k`-th element against `k`: `d_1 = 1 ≥ 1`? yes. `d_2 = 1 ≥ 2`? **no.** The set is infeasible — two jobs both demand slot 1, but only one slot ≤ 1 exists (`N(1) = 2 > 1`). Removing one of the `d=1` jobs gives `{1, 2, 3}`: `1≥1, 2≥2, 3≥3` — feasible. This `d_{(k)} ≥ k` reformulation (the `k`-th smallest deadline must be at least `k`) is the most convenient computational form of Theorem 4.1 and is exactly what the brute-force oracle in `tasks.md` uses.

**Lemma 4.3 (Latest-first never blocks a feasible insertion).** If `S` is feasible and `S ∪ {j}` is feasible, then placing `j` in the latest free slot ≤ `d_j` of `S`'s canonical schedule yields a feasible schedule for `S ∪ {j}`. *Proof.* Feasibility of `S ∪ {j}` plus the Hall condition guarantee `N_{S}(t) < t` for some `t ≤ d_j` (else `S ∪ {j}` would violate `N(t) ≤ t` at `t = d_j`), so a free slot ≤ `d_j` exists; the latest such slot is a valid placement. ∎ This lemma is precisely why the greedy's "try to place; accept iff a slot is found" is an exact feasibility oracle, justifying line 3 of Algorithm `G`.

---

## 5. Optimality Proof II — Job Sequencing as a Matroid

**Definition 5.1 (Matroid).** A matroid `M = (E, ℐ)` is a finite ground set `E` with a family `ℐ ⊆ 2^E` of *independent sets* satisfying:
- **(I1)** `∅ ∈ ℐ`.
- **(I2) (hereditary)** `A ⊆ B ∈ ℐ ⇒ A ∈ ℐ`.
- **(I3) (exchange)** `A, B ∈ ℐ`, `|A| < |B|` ⇒ `∃ x ∈ B \ A` with `A ∪ {x} ∈ ℐ`.

A brief orientation before the proof: a matroid is the abstract structure that captures "independence" in a way that makes the greedy algorithm provably optimal. The two canonical examples are *linear* matroids (independent = linearly independent columns of a matrix) and *graphic* matroids (independent = acyclic edge sets — the structure behind Kruskal's MST greedy). Job sequencing supplies a third family — *transversal* matroids — and recognizing it as one immediately imports the entire greedy-optimality machinery with no problem-specific cleverness.

**Theorem 5.2 (Job sequencing forms a matroid).** Let `E = J` (the jobs) and `ℐ = { S ⊆ J : S is feasible }`. Then `M = (E, ℐ)` is a matroid — the **transversal matroid** of the bipartite graph jobs↔slots.

*Proof.*
- **(I1)** `∅` is trivially feasible.
- **(I2)** A subset of a feasible set is feasible (drop jobs from a feasible schedule). Equivalently, the Hall condition `N(t) ≤ t` only weakens when removing jobs.
- **(I3)** Let `A, B` be feasible with `|A| < |B|`. We must find `x ∈ B \ A` with `A ∪ {x}` feasible. Consider the smallest threshold `t*` where `B` has *more* jobs with deadline `≤ t*` than `A` does — such `t*` exists because `|B| > |A|` forces `N_B(t) > N_A(t)` for some `t` (otherwise `|B| = N_B(D) ≤ N_A(D) = |A|`). Pick `x ∈ B` with `d_x ≤ t*` and `x ∉ A`. Then for every `t ≥ d_x`, `N_{A∪{x}}(t) = N_A(t) + 1 ≤ N_B(t) ≤ t` (using `N_A(t) < N_B(t)` for `t ≥ t*` ≥ ... ); for `t < d_x` nothing changes. Hence `A ∪ {x}` satisfies Hall and is feasible. ∎

(More directly, transversal matroids — independent sets are the matchable subsets of one side of a bipartite graph — are a classical matroid family; here jobs are the left side and slots `1..D` the right.)

**Definition 5.3 (Weighting).** Assign weight `w(i) = p_i` to each job. The job-sequencing objective is to find a maximum-weight independent set of `M`.

**Definition 5.4 (Rank and bases).** The **rank** `r(M)` of the matroid is the size of any maximal independent set (a *basis*); all bases have the same size by the exchange axiom. For job sequencing:

- A **basis** is a *maximal* feasible set of jobs — one to which no further job can be added without violating a deadline.
- The **rank** equals the maximum number of jobs that can be scheduled simultaneously, which by König's theorem on the jobs↔slots bipartite graph equals the size of a maximum matching there.
- The rank can be computed directly as `r(M) = max over feasible S of |S|`, or operationally by the unweighted greedy (profits = 1).

These notions matter in practice: a maximum-*profit* set need not be a *maximal-cardinality* set — the greedy may stop early if remaining jobs have tight deadlines and low profit. Distinguishing "max weight" from "max cardinality" is exactly the difference between the `max_profit` and `max_count` objectives in the engineering files, and the matroid vocabulary makes the distinction precise: both are bases-or-subsets of the *same* matroid under *different* weightings (real profits vs all-ones).

---

## 6. The Matroid-Greedy Theorem and Why It Applies

**Theorem 6.1 (Matroid greedy — Rado/Edmonds).** For a matroid `M = (E, ℐ)` with non-negative weights `w`, the greedy algorithm that sorts `E` by descending weight and adds each element whenever it keeps the set independent returns a **maximum-weight basis** (hence a maximum-weight independent set). Conversely, if `(E, ℐ)` is a hereditary system for which this greedy is optimal **for every** weighting, then `(E, ℐ)` is a matroid.

*Proof sketch.* Optimality follows from the exchange axiom (I3): if greedy's output `S` and an optimal `O` first differ at the greedy's `k`-th pick `g_k`, then `O` lacks some element of weight `≥ w(g_k)` that greedy could (and did) take, and (I3) lets us exchange an element of `O` of weight `≤ w(g_k)` for it, never decreasing weight. Iterating equalizes `O` to `S`. The converse (matroids are *exactly* the systems on which greedy always works) is the classical characterization. ∎

**Corollary 6.2 (Optimality of `G`, restated).** Since job feasibility forms a matroid (Theorem 5.2) and profit-descending greedy is the matroid greedy, Algorithm `G` returns a maximum-profit feasible set. This *re-derives* Theorem 2.1 with no ad-hoc swapping — the matroid axioms carry all the bookkeeping.

**Why this matters.** The matroid view explains *why* both the slot-based (profit-descending, latest-slot) and heap-based (deadline-ascending, evict-cheapest) algorithms are optimal: both compute a maximum-weight basis of the same matroid, just by different orderings of the same greedy/exchange. It also tells you instantly which generalizations preserve optimality (anything that keeps the feasibility system a matroid — e.g. `k` identical machines, a *partition*/uniform-style transversal matroid) and which break it (variable processing times, which destroy the clean Hall condition and the matroid structure).

**Proposition 6.3 (Uniqueness of the optimal weight).** Every basis of a matroid has the same cardinality (the rank `r`), and every *maximum-weight* basis has the same total weight, even when the basis itself is not unique. *Proof.* Suppose bases `B₁, B₂` are both maximum-weight but `w(B₁) ≠ w(B₂)`; WLOG `w(B₁) > w(B₂)`. List both by descending weight; at the first index where their weights differ, the matroid exchange property lets us swap an element of `B₂` for a heavier one available from `B₁` (a standard "greedy bases agree position-by-position in sorted weight" argument), contradicting `B₂`'s maximality. Hence `w(B₁) = w(B₂)`. ∎ This is the formal justification for the cross-check assertion in `senior.md` and `tasks.md`: the slot and heap methods may return *different sets* under profit ties, but their *total profit must be equal* — a mismatch is a guaranteed bug, not a legitimate alternative optimum.

---

## 7. Complexity — Linear Scan, Union-Find, Heap

Let `n = |J|`, `m = n` edges in the implicit bipartite graph, `D = max deadline`.

**Sorting.** `O(n log n)` for the profit (or deadline) sort. With integer deadlines bounded by `n`, counting/radix sort gives `O(n)`. This is the dominant term in every comparison-model variant; the lower bound of Theorem 7.2 below shows it is unavoidable without exploiting bounded keys.

**Building the slot universe.** `O(D)` to allocate the array allocator, or `O(1)` amortized per touched slot for the hash allocator. The heap method allocates nothing time-indexed. This is the only place `D` enters the complexity of the array method, and the reason the hash/heap variants are `D`-independent in space.

**Slot-based, linear scan.** Each job scans up to `D` slots: `O(n · D)` worst case (e.g. all deadlines `= D`). Total `O(n log n + n D)`.

**Slot-based, union-find.** With path compression, the `n` `find`/`allocate` operations on a universe of `≤ D` slots cost `O(n α(n))` amortized. Total `O(n log n + n α(n)) = O(n log n)`.

> **Theorem 7.1.** The union-find slot allocator performs the `n` "latest free slot ≤ d" queries in `O(n α(n))` amortized time, where `α` is the inverse Ackermann function. The bound follows from Tarjan's analysis of union-find with path compression (the "interval union-find" / "union-find with deletions on a line" special case has the same `α` bound; in fact this restricted form — only unions of adjacent intervals toward decreasing index — admits an even simpler near-linear analysis).

**Heap-based.** Sort by deadline `O(n log n)`; each job does `O(log n)` heap work; total `O(n log n)`. Space `O(n)` (no `D` dependence).

**Summary table.**

| Method | Time | Space | Returns slots? | Best when |
|--------|------|-------|----------------|-----------|
| Linear scan | `O(n log n + nD)` | `O(D)` | yes | tiny / teaching |
| Union-find (array) | `O(n log n)` | `O(D)` | yes | dense small `D` |
| Union-find (hash) | `O(n log n)` | `O(n)` | yes | large/sparse `D` |
| Heap eviction | `O(n log n)` | `O(n)` | no | value/set only, large `D` |

**Detailed accounting of the union-find bound.** The `n` allocations perform, in total, a sequence of `find` operations interleaved with the pointer updates `parent[s] ← s − 1`. Crucially, every union here is between a node `s` and the node immediately to its left, `s − 1` — a *restricted* union pattern (always toward decreasing index on a line). For the general union-find with path compression and arbitrary unions, Tarjan's bound gives `O((n + m) α(n + m))` for `m` operations on `n` elements. For this line-restricted variant, an even cleaner argument applies: assign each slot a "remaining hops to the sentinel" potential; each `find` either does `O(1)` work or shortens a chain it traverses (path compression), and the total chain-shortening over all operations is bounded by the initial total chain length `O(D)` plus the `n` increments from allocations. The amortized per-operation cost is therefore inverse-Ackermann at worst and `O(1)` in the line-restricted analysis — either way negligible beside the sort.

**Theorem 7.3 (Correctness of the allocator invariant).** Throughout Algorithm `G` with the union-find allocator, `find(t)` returns the largest index `s ∈ {1, …, t}` not yet consumed, or `0` if none. *Proof by induction on allocations.* Initially `parent[t] = t` for all `t`, so `find(t) = t` is the largest free slot ≤ `t` (none consumed). Inductive step: after consuming slot `s` via `parent[s] ← find(s − 1)`, any subsequent `find(t)` for `t ≥ s` that would have returned `s` now follows `s`'s pointer to `find(s − 1)` = the largest free slot ≤ `s − 1`, which is exactly the largest free slot ≤ `t` after `s`'s removal; for `t < s` nothing changed. Path compression only shortens pointer chains without changing the root, preserving the invariant. ∎ This is the formal guarantee that the fast allocator computes the *same* schedule as the `O(D)` linear scan.

**Lower bound.** Any comparison-based algorithm must sort by weight (or deadline) to know the order, giving an `Ω(n log n)` lower bound in the comparison model; with bounded integer keys, `Θ(n)` is achievable via radix/counting sort plus union-find.

**Theorem 7.2 (Comparison-model `Ω(n log n)` lower bound).** Solving maximum-profit job sequencing in the comparison model requires `Ω(n log n)` comparisons. *Proof.* Reduce sorting to job sequencing. Given `n` distinct numbers `a_1, …, a_n` to sort, create jobs with profits `p_i = a_i` and deadlines `d_i = i` after relabeling — more directly, take all deadlines equal to `n` so every job is feasible and the *order in which the greedy accepts them* (highest profit first into slots `n, n-1, …`) reveals the sorted permutation of the profits. Recovering that permutation sorts the inputs, and sorting `n` distinct elements has the classic `Ω(n log n)` comparison lower bound. Hence job sequencing inherits it. ∎ This confirms the sort is not merely the dominant term by habit but an *intrinsic* `Ω(n log n)` floor in the comparison model — only the bounded-integer-key escape (counting/radix sort) beats it.

---

## 8. Cache Behavior and Average-Case Analysis

- **Sort dominance.** For all practical `n`, the `O(n log n)` sort dominates the `O(n α(n))` union-find pass; cache behavior is governed by the sort's access pattern (merge sort: sequential and cache-friendly; quicksort: in-place, good locality).
- **Union-find locality.** The `parent[]` array is accessed by `find(d_i)` then chained toward decreasing index. Path compression flattens chains so repeated finds touch few cache lines. Because consumed slots point to `s-1`, accesses cluster near recently used indices — good temporal locality.
- **Branch prediction.** The greedy's inner accept/reject branch is data-dependent on whether a slot is free, which is poorly predictable on random inputs. The union-find path largely removes the inner *scan* loop (and its mispredicted branches) that the linear-scan method suffers; this is a real constant-factor win beyond the asymptotic improvement, since the scan loop's branch on `slot[t]` mispredicts roughly half the time on dense random fills.
- **Hash-map union-find.** The map version trades the array's locality for `O(n)` memory; expect cache misses on map probes but only `O(n)` distinct keys are ever touched.
- **Average case.** Under random deadlines uniform in `1..D`, the expected number of accepted jobs is `Θ(min(n, D))` and the union-find chains stay short (expected `find` cost `O(1)` amortized, well below the `α` worst case). The expected realized profit concentrates around the top order statistics of the profit distribution restricted to feasible jobs.
- **Heap average case.** The min-heap holds at most `min(n, D)` elements; expected `O(log min(n,D))` per operation, with the heap rarely growing to its `D` cap when deadlines are spread out.

**A concrete average-case sketch.** Let deadlines be i.i.d. uniform on `{1, …, D}` with `n` jobs. The expected number of jobs with deadline `≤ t` is `n·t/D`; feasibility caps acceptances near where `n·t/D ≈ t`, i.e. the schedule fills until roughly `min(n, D)` slots are used. For the dense regime `D = Θ(n)`, a constant fraction of jobs are accepted, the union-find chains have expected length `O(1)` (each consumed slot points one step left, and random deadlines rarely chain long runs), and the realized profit is the sum of the top `≈ min(n,D)` profits among feasible jobs — well-approximated by the upper order statistics of the profit distribution. This is why, on random dense inputs, the union-find pass behaves like a flat `O(n)` sweep despite its `O(n α(n))` worst-case bound.

---

## 9. Space–Time Trade-offs

A subtle point before the table: the three space-saving variants (hash union-find, coordinate compression, heap) are *not* interchangeable in what they output. The hash union-find and coordinate-compression methods still produce an explicit slot assignment, just with `O(n)` rather than `O(D)` memory; the heap method discards the slot timeline entirely and keeps only the multiset of accepted profits. The choice is therefore two-dimensional — *(memory budget) × (do you need the schedule?)* — and the table should be read alongside the "Returns slots?" column of §7. When a caller needs only the maximum profit (e.g. a revenue estimate), the heap is strictly dominant on memory; when it needs "which job runs when" (an execution plan), a union-find variant is mandatory and the only remaining question is array vs hash by deadline density.

| Choice | Time | Space | Note |
|--------|------|-------|------|
| Array union-find | `O(n log n)` | `O(D)` | fastest constant; needs `D` words |
| Hash-map union-find | `O(n log n)` (× hash constant) | `O(n)` | `D`-independent memory |
| Coordinate compression | `O(n log n)` | `O(n)` | preprocess deadlines to ranks |
| Heap eviction | `O(n log n)` | `O(n)` | no slots; minimal memory |
| Linear scan | `O(nD)` | `O(D)` | only if `D` tiny |

The fundamental trade-off is **`O(D)` vs `O(n)` memory**: the array allocator is fastest but pays for the slot universe; the hash/heap variants drop `D` from memory at a modest time constant. With integer deadlines `≤ n`, counting sort makes the whole pipeline `O(n)` time and `O(n)` space — optimal.

**A note on the optimality of `O(n)` total.** Once deadlines and profits are bounded integers in `[1, n]`, every stage of the pipeline is linear: counting/radix sort is `O(n)`, the union-find pass is `O(n α(n))` (effectively `O(n)`), and the output is `O(n)`. No algorithm can do asymptotically better, since merely reading the input is `Ω(n)`. Thus job sequencing with bounded integer keys is *strongly* linear-time — a rare and pleasant property that distinguishes it from problems whose lower bound is genuinely `Θ(n log n)` regardless of key structure. The only reason production code usually shows `O(n log n)` is that real profits/deadlines are not conveniently bounded by `n`, so the comparison sort is retained for simplicity.

---

## 10. Generalizations and Their Complexity

**`k` identical machines.** Each slot holds up to `k` jobs. Feasibility becomes `N(t) ≤ k·t`. The system is still a (transversal) matroid, so greedy stays optimal; the slot allocator caps each slot at `k` (or the heap threshold becomes `k·d`). Complexity unchanged: `O(n log n)`.

**Maximize number of jobs (unweighted).** Set `p_i = 1`. Greedy returns a maximum-cardinality feasible set — equivalently a maximum matching in the jobs↔slots bipartite graph. This is the **Moore-Hodgson** setting for unit jobs. Still `O(n log n)`.

**Profits and deadlines both as tie-breaks.** A frequently overlooked generalization: when two jobs have equal profit, the matroid permits *either* in the optimal basis, but a deterministic implementation must pick one. Choosing the job with the *larger* deadline on a profit tie is a safe default — it is at least as feasible-flexible as the tighter-deadline twin — but any fixed rule preserves optimality of the *weight* (Proposition 6.3). The freedom here is exactly the non-uniqueness of a maximum-weight basis under ties, and it has no effect on the objective value.

**Weighted, variable processing times — `1 || Σ wⱼ Uⱼ`.** Minimizing the weighted number of late jobs with **arbitrary** processing times is **NP-hard** (the feasibility system is no longer a matroid; the Hall condition fails). Solvable in pseudo-polynomial `O(n · Σ pⱼ)` time by dynamic programming; admits an FPTAS. The unit-time special case is precisely our tractable greedy.

**Release times / online arrival.** With release times on one machine, EDF is optimal for *feasibility*; for *profit* the offline matroid greedy no longer applies, and online versions are analyzed by competitive ratio.

**Weighted, `k` *unrelated* machines.** If processing time depends on the machine (job `i` takes `t_{im}` on machine `m`), even feasibility checking becomes a harder assignment problem and the simple matroid disappears; this is generally NP-hard and handled by LP-rounding approximations (e.g. the classic Lenstra-Shmoys-Tardos 2-approximation for makespan-style objectives, with analogous results for weighted late jobs).

**Precedence constraints / conflicts.** Adding precedence or pairwise conflicts generally destroys the matroid structure and pushes the problem toward NP-hardness or min-cost-flow formulations.

> **The complexity boundary:** the problem is polynomial (indeed `O(n log n)`) **exactly** while the feasible sets form a matroid — unit processing times on `k` identical machines. Break that (variable lengths, precedence, conflicts) and you generally leave P.

### 10.1 The bipartite-matching / LP view

Model the problem as a bipartite graph `H = (J ∪ T, E)` where `J` is the jobs, `T = {1, …, D}` the slots, and `(i, t) ∈ E` iff `t ≤ d_i`. A feasible set of jobs is exactly a set of left vertices saturated by some matching — the defining structure of a **transversal matroid**. Maximum-profit job sequencing is therefore a **maximum-weight bipartite matching** with weights on the left vertices.

Write the LP relaxation with `x_{it} ∈ [0,1]` indicating job `i` runs in slot `t`:

```
maximize    Σ_i p_i · ( Σ_{t ≤ d_i} x_{it} )
subject to  Σ_{t ≤ d_i} x_{it} ≤ 1        for each job i      (each job once)
            Σ_i x_{it}        ≤ 1        for each slot t      (each slot once)
            x_{it} ≥ 0.
```

**Proposition 10.2 (Integrality).** The constraint matrix of this LP is the incidence matrix of a bipartite graph, hence **totally unimodular**; every basic feasible solution is integral, so the LP optimum equals the integer optimum. *Consequence:* the matroid greedy is a purely combinatorial algorithm that attains the LP bound, and LP duality furnishes an independent optimality certificate. The dual assigns prices to slots and jobs; complementary slackness states that an accepted job's profit is "paid for" by the price of the slot it occupies — which is exactly the economic intuition behind processing high-profit jobs first.

### 10.2 Matroid intersection for richer constraints

Suppose two independent constraints apply simultaneously — say deadlines **and** a machine-eligibility restriction (each job may run only on a subset of machines). Each constraint individually defines a matroid; their common independent sets are the intersection of two matroids. By **Edmonds' matroid intersection theorem**, a maximum-weight common independent set is computable in polynomial time (not by simple greedy — greedy fails for intersections of ≥ 2 matroids, but the augmenting-path matroid-intersection algorithm succeeds). This is the precise reason a senior engineer reaches for min-cost flow / matroid intersection once "deadlines" are joined by a second resource constraint: the single-matroid greedy is no longer optimal, but the problem has not yet fallen into NP-hardness — it sits in the polynomial matroid-intersection regime. Adding a *third* matroid constraint, by contrast, makes the problem NP-hard in general (matroid intersection of three matroids is NP-hard).

---

## 11. Open Problems and Summary

**Summary.** Job sequencing with deadlines is the canonical "greedy = optimal" problem because its feasible sets form a **transversal matroid** (Theorem 5.2), on which the **matroid-greedy theorem** (Theorem 6.1) guarantees that profit-descending greedy returns a maximum-weight basis (Corollary 6.2). The same optimum is reachable by the deadline-ascending heap-eviction greedy. Feasibility reduces to the **Hall-type counting condition** `N(t) ≤ t` (Theorem 4.1), which both drives the exchange-argument proof and explains why "latest-slot" placement is harmless. Algorithmically, the slow `O(nD)` scan collapses to `O(n α(n))` via a **union-find slot allocator**, making the whole pipeline `O(n log n)` (or `O(n)` with bounded integer deadlines and counting sort).

**Open / advanced directions.**

- Tight bounds for *online* job sequencing with deadlines (best competitive ratio for randomized algorithms under various profit models).
- Practical instances of the weighted variable-length NP-hard variant and the empirical quality of its FPTAS at scale.
- Matroid intersection formulations when two independent constraint systems apply (e.g. machine-eligibility plus deadlines), which remain polynomial via matroid-intersection algorithms.
- Parallel / distributed maximum-weight matroid basis computation for extremely large `n`.

### 11.3 Self-test: proving you understand the structure

A reader who has internalized this file should be able to answer, without code:

1. **Is `{d = (2,2,2)}` feasible?** Apply Theorem 4.1 / the `d_{(k)} ≥ k` form: sorted `[2,2,2]`, the 3rd element `2 < 3` — **infeasible**; at most 2 jobs with deadline ≤ 2 can run.
2. **Why does adding a job of profit 0 never change the optimal profit?** Profit 0 contributes nothing whether or not it is scheduled; the matroid's max-weight basis is unaffected by a weight-0 element (it may or may not be included, identically valued).
3. **If all profits are distinct, is the optimal set unique?** Yes. Distinct weights force a *unique* maximum-weight basis (the tie-breaking that allowed multiple optima in Proposition 6.3 vanishes), so the slot and heap methods return the identical set, not merely the identical profit.
4. **What is the rank of the matroid?** The maximum number of simultaneously schedulable jobs — equivalently `max_t min(t, N(t))`-style, the size of a maximum matching in the jobs↔slots graph. Every basis (maximal feasible set) has this size.
5. **Does doubling every profit change the chosen set?** No. Scaling all weights by a positive constant preserves the relative order, hence the greedy's decisions; only the reported total profit doubles.

Being able to reason through these from the definitions — rather than by running the algorithm — is the signal that the matroid abstraction, not just the procedure, has been understood.

The enduring lesson: recognizing the **matroid** behind a greedy turns a fragile-looking "sort and place" heuristic into a *provably optimal* algorithm, tells you exactly which generalizations stay polynomial, and pinpoints the boundary where the problem becomes NP-hard.

### 11.1 A unified statement of the three optimality proofs

It is worth seeing how the three arguments in this file relate, because each is preferred in a different context:

1. **Exchange argument (§3).** Elementary, self-contained, and the right level of detail for an interview. It manipulates `OPT` directly, swapping a lower-profit job for a higher-profit one. Its weakness is bookkeeping: you must argue feasibility is preserved at each swap, which is where the Hall condition (§4) silently does the work.
2. **Matroid argument (§5–§6).** The most powerful. It outsources *all* the bookkeeping to the matroid axioms: once you verify (I1)–(I3), the Rado-Edmonds theorem hands you optimality for free, *and* the uniqueness-of-weight proposition, *and* a roadmap for which generalizations survive. The cost is the upfront investment in matroid theory.
3. **LP / total-unimodularity argument (§10.1).** The most *general* and the one that connects to optimization software. It proves the integer optimum equals the LP optimum, gives a dual certificate, and extends to richer constraints via polyhedral methods. It is the lens an OR practitioner would use.

All three prove the same fact — Algorithm `G` is optimal — and a complete understanding means being able to switch among them depending on whether the audience wants intuition (exchange), structure (matroid), or generality (LP).

### 11.2 Why this problem is the canonical greedy teaching example

Job sequencing is pedagogically special because it is one of the few "real" problems where the greedy is *exactly* optimal (not a `1 − 1/e` approximation, not a constant-factor heuristic) **and** the reason is a clean, namable structure (a matroid) rather than ad-hoc luck. Compare: interval scheduling (a different greedy-correctness mechanism), Huffman coding (correctness via the cut/exchange property), and Dijkstra (greedy correctness from a monotone invariant). Job sequencing uniquely showcases the matroid mechanism in a form simple enough to implement in ten lines yet deep enough to motivate Edmonds' broader theory of polymatroids and submodular optimization. That combination — trivial to code, rich to prove, and a gateway to a whole branch of combinatorial optimization — is why it appears in every algorithms curriculum and so frequently in interviews.

---

## 12. Reference Code (union-find / heap, Go / Java / Python)

Both methods compute the maximum profit; we assert they agree (matroid basis is weight-unique). Each prints `profit = 142, count = 3`.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
	"sort"
)

type Job struct{ Profit, Deadline int }

// --- union-find (latest free slot) ---
func find(par []int, x int) int {
	for par[x] != x {
		par[x] = par[par[x]]
		x = par[x]
	}
	return x
}

func greedyUF(jobs []Job) (int, int) {
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].Profit > jobs[j].Profit })
	maxD := 0
	for _, j := range jobs {
		if j.Deadline > maxD {
			maxD = j.Deadline
		}
	}
	par := make([]int, maxD+1)
	for i := range par {
		par[i] = i
	}
	count, profit := 0, 0
	for _, j := range jobs {
		s := find(par, j.Deadline)
		if s > 0 {
			par[s] = s - 1
			count++
			profit += j.Profit
		}
	}
	return count, profit
}

// --- heap (deadline ascending, min-heap eviction) ---
type IntHeap []int

func (h IntHeap) Len() int            { return len(h) }
func (h IntHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *IntHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *IntHeap) Pop() interface{} {
	o := *h
	n := len(o)
	v := o[n-1]
	*h = o[:n-1]
	return v
}

func greedyHeap(jobs []Job) (int, int) {
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].Deadline < jobs[j].Deadline })
	h := &IntHeap{}
	for _, j := range jobs {
		if h.Len() < j.Deadline {
			heap.Push(h, j.Profit)
		} else if h.Len() > 0 && (*h)[0] < j.Profit {
			heap.Pop(h)
			heap.Push(h, j.Profit)
		}
	}
	profit := 0
	for _, p := range *h {
		profit += p
	}
	return h.Len(), profit
}

func main() {
	jobs := []Job{{100, 2}, {19, 1}, {27, 2}, {25, 1}, {15, 3}}
	c1, p1 := greedyUF(append([]Job(nil), jobs...))
	c2, p2 := greedyHeap(append([]Job(nil), jobs...))
	fmt.Printf("UF:   count = %d, profit = %d\n", c1, p1)   // 3, 142
	fmt.Printf("heap: count = %d, profit = %d\n", c2, p2)   // 3, 142
	if p1 != p2 {
		panic("matroid basis weight must match")
	}
}
```

#### Java

```java
import java.util.*;

public class JobSchedulingPro {
    static class Job { int profit, deadline; Job(int p, int d){profit=p;deadline=d;} }

    static int find(int[] par, int x) {
        while (par[x] != x) { par[x] = par[par[x]]; x = par[x]; }
        return x;
    }

    static int[] greedyUF(Job[] jobs) {
        Arrays.sort(jobs, (a, b) -> b.profit - a.profit);
        int maxD = 0;
        for (Job j : jobs) maxD = Math.max(maxD, j.deadline);
        int[] par = new int[maxD + 1];
        for (int i = 0; i <= maxD; i++) par[i] = i;
        int count = 0, profit = 0;
        for (Job j : jobs) {
            int s = find(par, j.deadline);
            if (s > 0) { par[s] = s - 1; count++; profit += j.profit; }
        }
        return new int[]{count, profit};
    }

    static int[] greedyHeap(Job[] jobs) {
        Arrays.sort(jobs, Comparator.comparingInt(a -> a.deadline));
        PriorityQueue<Integer> h = new PriorityQueue<>();
        for (Job j : jobs) {
            if (h.size() < j.deadline) h.add(j.profit);
            else if (!h.isEmpty() && h.peek() < j.profit) { h.poll(); h.add(j.profit); }
        }
        int profit = 0;
        for (int p : h) profit += p;
        return new int[]{h.size(), profit};
    }

    public static void main(String[] args) {
        Job[] base = {
            new Job(100,2), new Job(19,1), new Job(27,2), new Job(25,1), new Job(15,3)
        };
        int[] a = greedyUF(base.clone());
        int[] b = greedyHeap(base.clone());
        System.out.printf("UF:   count = %d, profit = %d%n", a[0], a[1]); // 3, 142
        System.out.printf("heap: count = %d, profit = %d%n", b[0], b[1]); // 3, 142
        if (a[1] != b[1]) throw new AssertionError("weights must match");
    }
}
```

#### Python

```python
import heapq


def find(par, x):
    while par[x] != x:
        par[x] = par[par[x]]
        x = par[x]
    return x


def greedy_uf(jobs):
    jobs = sorted(jobs, key=lambda j: -j[0])
    max_d = max((d for _, d in jobs), default=0)
    par = list(range(max_d + 1))
    count = profit = 0
    for p, d in jobs:
        s = find(par, d)
        if s > 0:
            par[s] = s - 1
            count += 1
            profit += p
    return count, profit


def greedy_heap(jobs):
    jobs = sorted(jobs, key=lambda j: j[1])
    h = []
    for p, d in jobs:
        if len(h) < d:
            heapq.heappush(h, p)
        elif h and h[0] < p:
            heapq.heapreplace(h, p)
    return len(h), sum(h)


if __name__ == "__main__":
    base = [(100, 2), (19, 1), (27, 2), (25, 1), (15, 3)]
    a = greedy_uf(base)
    b = greedy_heap(base)
    print("UF:  ", a)    # (3, 142)
    print("heap:", b)    # (3, 142)
    assert a[1] == b[1], "matroid basis weight must match"
```

**What it does:** two orderings of the same matroid greedy — profit-descending union-find and deadline-ascending heap eviction — computing the same maximum-weight basis; the assertion encodes the matroid uniqueness of the optimal weight.
**Run:** `go run main.go` | `javac JobSchedulingPro.java && java JobSchedulingPro` | `python jobs_pro.py`

### 12.1 Verification checklist for an implementation

A correct, production-grade implementation should pass all of the following — each targets a specific theorem in this file:

- **Hall oracle agreement (Thm 4.1).** For random sets, the operational "place latest-first" feasibility test agrees with the `d_{(k)} ≥ k` counting test.
- **Two-method weight equality (Prop 6.3).** Slot and heap methods return equal *profit* on every input, even when the chosen *sets* differ under ties.
- **Brute-force optimality (Thm 2.1 / 6.1).** For `n ≤ 14`, the greedy profit equals the exhaustive subset-enumeration optimum.
- **Scale invariance (self-test #5).** Doubling all profits doubles the reported profit and leaves the chosen set unchanged.
- **Unweighted = max matching (§10).** With profits set to 1, the result equals the size of a maximum matching in the jobs↔slots graph.
- **Allocator equivalence (Thm 7.3).** Array, hash, and linear-scan slot methods produce identical schedules; the heap matches on profit.

A suite covering these six checks pins down every load-bearing claim, turning the theory above into executable confidence.

Taken together, these checks are not redundant: each isolates a different theorem, so a failure points directly at the broken claim. A mismatch in two-method weight equality implicates the matroid greedy or a sort bug; a Hall-oracle disagreement implicates the feasibility test; an allocator-equivalence failure implicates the union-find invariant (Theorem 7.3). This diagnostic precision is the practical payoff of having three independent proofs and a clean structural characterization, rather than a single opaque "it works" argument.

In short: the mathematics is not decoration — it is the test plan. Every theorem in this file corresponds to an assertion you can run, and the matroid abstraction is what makes those assertions both minimal and complete.
</content>
</invoke>
