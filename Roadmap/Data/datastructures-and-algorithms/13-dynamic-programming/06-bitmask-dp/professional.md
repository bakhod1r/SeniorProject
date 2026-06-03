# Bitmask DP (DP over Subsets) — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Held-Karp Recurrence (Correctness Proof)
3. Complexity of Held-Karp: O(2^n · n^2)
4. The Subset-Sum Identity Σ C(n,k)·k = n·2^{n−1}
5. The Submask Sum: Σ 2^{popcount(mask)} = 3^n
6. The Assignment-Problem DP and Its Dimension Collapse
7. Counting and Inclusion-Exclusion
8. Lower-Bound Context: TSP NP-Hardness and the Held-Karp Conjecture
9. Sum-over-Subsets (SOS) Transform and Möbius Inversion
10. Profile DP as a Transfer Matrix
11. Summary

---

## 1. Formal Definitions

Let `[n] = {0, 1, …, n−1}` be the ground set of `n` items. Subsets of `[n]` are identified with integers in `[0, 2^n)` via the **characteristic vector**: integer `S` represents the subset `{i : bit i of S is 1}`.

**Definition 1.1 (Bitmask / characteristic integer).** For `S ⊆ [n]`, its bitmask is `χ(S) = Σ_{i∈S} 2^i ∈ [0, 2^n)`. The map `χ` is a bijection between subsets of `[n]` and `[0, 2^n)`. Set operations correspond to bit operations: union ↔ `|`, intersection ↔ `&`, symmetric difference ↔ `^`, membership of `i` ↔ `S & (1<<i) ≠ 0`, complement (within `[n]`) ↔ `S ^ ((1<<n)−1)`.

**Definition 1.2 (Popcount).** `popcount(S) = |S|`, the number of set bits, equivalently the cardinality of the subset.

**Definition 1.3 (Submask).** `T` is a **submask** of `S`, written `T ⊑ S`, iff `T & S = T`, equivalently `T ⊆ S` as sets. Each `S` has exactly `2^{popcount(S)}` submasks.

**Definition 1.4 (TSP instance).** A complete directed graph on `[n]` with cost matrix `dist : [n]×[n] → ℝ_{≥0} ∪ {∞}`. A **tour** is a cyclic permutation visiting every vertex exactly once; its cost is the sum of consecutive `dist` entries including the closing edge. The TSP asks for a minimum-cost tour.

**Definition 1.5 (Held-Karp state).** For `S ⊆ [n]` with `0 ∈ S` and `last ∈ S`, define
```
dp[S][last] = minimum cost of a path that starts at vertex 0,
              visits exactly the vertices in S, and ends at `last`.
```
We prove the recurrence in Section 2 and that the optimal tour is `min_{last≠0} dp[[n]][last] + dist[last][0]`.

**Remark (walks vs simple paths).** Held-Karp computes shortest **simple** paths (each vertex once) by encoding the visited set `S` in the state. This is exactly the state the polynomial walk-counting recurrence (sibling topic in `11-graphs`) lacks — and it is why TSP is exponential while walk counting is polynomial: the visited-set state has `2^n` values.

**Notation conventions.** Throughout, `n = |V|` is the ground-set size (mask width), `S ⊆ [n]` a subset with bitmask `χ(S)`, `popcount(S) = |S|`, `T ⊑ S` the submask relation, `[P]` the Iverson bracket (`1` if `P` holds else `0`), `p` a prime modulus, and `⊎` a disjoint union. We freely identify a subset with its characteristic integer and write `mask` for either. "Path" means simple path (no repeated vertex) unless stated; "walk" (used only in cross-references) permits repeats. The semiring is `(min, +)` for optimisation, `(+, ×)` for counting, and `(∨, ∧)` for feasibility, with identities `(∞, 0)`, `(0, 1)`, `(false, true)` respectively — the same identity-per-semiring discipline as the matrix-power topic in `11-graphs/32-paths-fixed-length`.

---

## 2. The Held-Karp Recurrence (Correctness Proof)

**Theorem 2.1.** For all `S ⊆ [n]` with `0 ∈ S` and `last ∈ S`,
```
dp[{0}][0] = 0,
dp[S][last] = min_{prev ∈ S∖{last}, prev≠last}  ( dp[S∖{last}][prev] + dist[prev][last] )   for |S| ≥ 2.
```
correctly equals the minimum cost of a simple path from `0` visiting exactly `S` and ending at `last`. Moreover the optimal tour cost is `min_{last∈[n]∖{0}} ( dp[[n]][last] + dist[last][0] )`.

**Proof (induction on `|S|`).**

*Base case `|S| = 1`.* The only such `S` with `0 ∈ S` is `S = {0}`, `last = 0`. The unique path visiting exactly `{0}` and ending at `0` is the trivial one-vertex path of cost `0`. Thus `dp[{0}][0] = 0`, as defined.

*Inductive step.* Assume the claim for all sets of size `m−1`; take `|S| = m ≥ 2` and `last ∈ S`. Any simple path `P` from `0` visiting exactly `S` and ending at `last` has length `m−1` edges and visits `m` distinct vertices. Let `prev` be the vertex immediately before `last` on `P`. Then `prev ∈ S∖{last}`, and deleting the final edge `(prev, last)` leaves a simple path `P'` from `0` visiting exactly `S∖{last}` and ending at `prev`. Conversely, any simple path from `0` visiting `S∖{last}` ending at some `prev ∈ S∖{last}`, extended by the edge `(prev, last)`, is a simple path visiting exactly `S` ending at `last` (it remains simple because `last ∉ S∖{last}`). This is a **bijection** between
```
{ simple paths 0 ⇝ last visiting exactly S }
   ≅   ⊎_{prev ∈ S∖{last}} { simple paths 0 ⇝ prev visiting exactly S∖{last} } × {edge (prev,last)}.
```
The cost decomposes additively: `cost(P) = cost(P') + dist[prev][last]`. Minimising over the (disjoint) choices of `prev` and, within each, over the optimal `P'` (given by the inductive hypothesis as `dp[S∖{last}][prev]`), yields
```
min cost = min_{prev ∈ S∖{last}} ( dp[S∖{last}][prev] + dist[prev][last] ),
```
which is the recurrence. The disjointness holds because `prev` is uniquely determined by `P` (it is the penultimate vertex), so no path is counted under two different `prev`.

*Tour.* A tour is a path from `0` visiting all of `[n]` and ending at some `last ≠ 0`, plus the closing edge `(last, 0)`. Its cost is `dp[[n]][last] + dist[last][0]`; minimising over `last` gives the optimum. ∎

**Corollary 2.2 (Dependency order).** `dp[S][·]` depends only on `dp[S∖{last}][·]`, and `χ(S∖{last}) < χ(S)` (clearing a bit strictly decreases the integer). Hence processing masks in increasing numeric order guarantees every right-hand-side state is already computed — the iteration order is correct without any topological sort.

**Proof of Corollary 2.2.** Clearing bit `last` from `S` removes the term `2^{last} > 0` from the integer `χ(S)`, so `χ(S∖{last}) = χ(S) − 2^{last} < χ(S)`. The recurrence reads only `dp[S∖{last}][·]`, whose mask index is strictly smaller. An ascending loop `for mask = 0 .. 2^n−1` therefore computes every dependency before its dependent. This replaces an explicit topological sort of the `2^n`-vertex dependency DAG with a trivial integer loop — a structural gift of the bitmask encoding: *the integer order on masks is a linear extension of the subset-inclusion partial order.* ∎

**Worked dependency-order example.** For `n = 3`, the masks containing city `0` in ascending order are `001, 011, 101, 111`. When the loop reaches `011 = {0,1}`, its only dependency `001 = {0}` (clearing bit 1) has already been processed (`1 < 3`). When it reaches `111 = {0,1,2}`, its dependencies `011` and `101` (each clearing one bit) are both `< 7` and already computed. No state is ever read before it is written — the ascending integer loop is a valid evaluation order. This is why bitmask DP needs no explicit topological sort even though the state-dependency graph has `2^n` vertices: subset inclusion `T ⊂ S ⟹ χ(T) < χ(S)` makes integer order a topological order automatically.

**Corollary 2.3 (Path vs tour).** Replacing the final step with `min_{last} dp[[n]][last]` (no closing edge) gives the shortest Hamiltonian *path* from `0`; allowing any start by initialising `dp[{s}][s] = 0` for all `s` gives the shortest Hamiltonian path over all start vertices.

### 2.1 Worked Verification

Take the symmetric instance on `[3] = {0,1,2}` with `dist = [[0,10,15],[10,0,20],[15,20,0]]`. Trace the recurrence:

```
Base:    dp[{0}][0] = 0.
Size 2:  dp[{0,1}][1] = dp[{0}][0] + dist[0][1] = 0 + 10 = 10.
         dp[{0,2}][2] = dp[{0}][0] + dist[0][2] = 0 + 15 = 15.
Size 3:  dp[{0,1,2}][1] = dp[{0,2}][2] + dist[2][1] = 15 + 20 = 35.
         dp[{0,1,2}][2] = dp[{0,1}][1] + dist[1][2] = 10 + 20 = 30.
Close:   via last=1: 35 + dist[1][0] = 35 + 10 = 45.
         via last=2: 30 + dist[2][0] = 30 + 15 = 45.
Optimum = 45.
```

Both tours `0→1→2→0` and `0→2→1→0` cost `45`, matching the brute-force enumeration of all `(3−1)! = 2` tours. The DP reused `dp[{0,2}][2]` and `dp[{0,1}][1]` rather than re-summing whole tours — the source of the speedup.

### 2.2 The Bijection, Made Explicit

The inductive step rests on a disjoint-union bijection over the penultimate vertex `prev`:

```
{ simple paths 0 ⇝ last visiting exactly S }
   ≅  ⊎_{prev ∈ S∖{last}} ( { simple paths 0 ⇝ prev visiting exactly S∖{last} } × { edge (prev,last) } ).
```

Disjointness: `prev` is the uniquely determined penultimate vertex of the path, so no path appears under two values of `prev`. Surjectivity: deleting the last edge of any qualifying path yields a path on the left of one summand. Injectivity: the (prefix, last edge) pair reconstructs the path uniquely. Taking minimum costs (rather than counting cardinalities) and using that `+ dist[prev][last]` is monotone in the prefix cost gives the `min`-recurrence. The *same* bijection, with cardinalities instead of costs, gives the **counting** recurrence (Section 7) — one combinatorial fact, two semiring readings.

---

## 3. Complexity of Held-Karp: O(2^n · n^2)

**Theorem 3.1.** The Held-Karp DP runs in `Θ(2^n · n^2)` time and `Θ(2^n · n)` space.

**Proof.** The table has one entry per `(S, last)` pair with `last ∈ S`. The number of such pairs is
```
Σ_{S ⊆ [n]} popcount(S) = n · 2^{n−1}            (Section 4),
```
so `Θ(2^n · n)` cells — the space bound. Each cell `dp[S][last]` is computed by minimising over `prev ∈ S∖{last}`, at most `n−1` candidates, i.e. `O(n)` work per cell. Total time `Σ_{(S,last)} O(n) = O(n · 2^{n−1} · n) = O(2^n · n^2)`. The lower bound `Ω(2^n · n^2)` follows because the dense transition examines `Θ(n)` predecessors for each of `Θ(2^n · n)` cells when the graph is complete. ∎

**Comparison to brute force.** Enumerating all `(n−1)!` tours costs `Θ((n−1)! · n)`. The ratio `(n−1)! / (2^n n^2)` grows super-exponentially; e.g. at `n = 15`, brute force is `~1.2×10^{12}` operations versus Held-Karp's `~7.4×10^6` — a factor of ~160 000. Held-Karp converts a factorial into an exponential, which is the entire point.

**Worked complexity at small n.** The exact table-size identity `n·2^{n−1}` and transition count `n(n−1)2^{n−2}` give concrete numbers:

| `n` | cells `n·2^{n−1}` | push transitions `n(n−1)2^{n−2}` | `(n−1)!` tours |
|-----|-------------------|----------------------------------|----------------|
| 5 | 80 | 240 | 24 |
| 10 | 5 120 | 46 080 | 362 880 |
| 15 | 245 760 | 3 440 640 | ~8.7×10^{10} |
| 18 | 2 359 296 | ~40 M | ~3.6×10^{14} |
| 20 | 10 485 760 | ~199 M | ~1.2×10^{17} |

The push-transition column is the true operation count; it crosses below the factorial column around `n = 7` and then the gap widens without bound. Past `n = 20` the *cells* column (memory) is what fails first.

### 3.1 Pull and Push Are the Same Bound

The **pull** form computes `dp[S][last]` by reading all `dp[S∖{last}][prev]`; the **push** form, from each `dp[S][last]`, writes all `dp[S∪{next}][next]`. They visit the same set of `(smaller-set, larger-set, transition-vertex)` triples in different orders. Both are `Θ(2^n n^2)` by the identities above (`n·2^{n−1}` cells × `Θ(n)` work, or `n(n−1)2^{n−2}` triples directly). The choice is purely about memory-access locality and whether you initialise targets to `∞` (push) or fold predecessors into a fresh cell (pull); the asymptotics are identical. Implementations usually prefer push for TSP (it skips dead source states cheaply) and pull for assignment (the single target cell `dp[mask]` is written once).

### 3.2 Optimality Within the State Model

No algorithm using the `(visited set, current vertex)` state can beat `Θ(2^n n)` cells, because all `n·2^{n−1}` such cells are reachable and distinct for a complete graph: each corresponds to a genuinely different (set, endpoint) pair with its own optimal cost. Within this state model `Θ(2^n n^2)` time is therefore essentially optimal; improvements (Björklund's `O^*(1.657^n)`) come only from *changing the state model* (algebraic / determinant encodings), not from a smarter fill of the Held-Karp table.

**Remark (the push formulation).** The implementation in the junior file uses a *push*: for each `(mask, last)` it iterates over unvisited `next` and updates `dp[mask|(1<<next)][next]`. This visits each `(mask, last, next)` triple once; the triple count is `Σ_S popcount(S)·(n − popcount(S))`, still `O(2^n n^2)`, matching the pull bound.

**Exact triple count.** The push transition count is
```
Σ_{S} popcount(S)·(n − popcount(S)) = Σ_{k=0}^{n} C(n,k) · k · (n−k).
```
Using `Σ_k C(n,k) k (n−k) = n(n−1) 2^{n−2}` (differentiate `(1+x)^n` twice, or count ordered triples (i, j, S) with `i ∈ S, j ∉ S`: `n` choices for `i`, `n−1` for `j ≠ i`, `2^{n−2}` for the rest of `S`), the push form does exactly `n(n−1)2^{n−2} = Θ(2^n n^2)` constant-work steps. The constant `1/4` (from `2^{n−2}` vs `2^n`) is why a tuned implementation has a smaller hidden constant than the naive `2^n n^2` bound suggests.

---

## 4. The Subset-Sum Identity Σ C(n,k)·k = n·2^{n−1}

This identity gives the exact size of the Held-Karp table (`Σ_S popcount(S)`), so it is worth a clean derivation.

**Theorem 4.1.** `Σ_{S ⊆ [n]} popcount(S) = Σ_{k=0}^{n} C(n,k)·k = n · 2^{n−1}.`

**Proof 1 (double counting).** Count pairs `(i, S)` with `i ∈ S ⊆ [n]`. Summing over `S` first gives `Σ_S |S| = Σ_S popcount(S)`. Summing over `i` first: fix item `i`; the subsets containing `i` are determined by the other `n−1` items freely, so there are `2^{n−1}` of them. With `n` choices of `i`, the total is `n · 2^{n−1}`. The two counts are equal. ∎

**Proof 2 (binomial / calculus).** Differentiate `(1+x)^n = Σ_k C(n,k) x^k` to get `n(1+x)^{n−1} = Σ_k C(n,k) k x^{k−1}`; set `x = 1`: `n·2^{n−1} = Σ_k C(n,k) k`. ∎

**Proof 3 (symmetry).** Pair each subset `S` with its complement `[n]∖S`; the two have sizes summing to `n`. Averaging, the mean size over all `2^n` subsets is `n/2`, so the total is `2^n · n/2 = n·2^{n−1}`. ∎

**Consequence.** The Held-Karp table has exactly `n·2^{n−1}` reachable `(S, last)` cells (those with `last ∈ S`), confirming the `Θ(2^n n)` space and feeding the `Θ(2^n n^2)` time bound of Theorem 3.1. The same identity bounds the work of any "for each subset, for each element of the subset" loop at `Θ(n 2^n)`.

**Worked check at n = 3.** `Σ_S popcount(S)` over the 8 subsets of `{0,1,2}`:
```
∅:0, {0}:1, {1}:1, {2}:1, {0,1}:2, {0,2}:2, {1,2}:2, {0,1,2}:3
sum = 0+1+1+1+2+2+2+3 = 12 = 3·2^{3−1} = 3·4.    ✓
```
And by double counting: each of the 3 items is in `2^{3−1} = 4` subsets, so `3·4 = 12`. Both views agree, anchoring Theorem 4.1 concretely. The same number, `12`, is the count of reachable `(S, last)` Held-Karp cells for `n = 3` (each subset contributes one cell per element it contains), which is why a careful implementation allocates exactly `n·2^{n−1}` meaningful cells, not the full `n·2^n` — half the array is the unreachable `last ∉ S` region and can be skipped with the `mask & (1<<last)` guard.

---

## 5. The Submask Sum: Σ 2^{popcount(mask)} = 3^n

The defining cost of partition / set-cover DPs is the total work of enumerating, for every mask, all of its submasks.

**Theorem 5.1.** `Σ_{S ⊆ [n]} 2^{popcount(S)} = Σ_{S} |{T : T ⊑ S}| = 3^n.`

**Proof 1 (three states per item).** The left side counts pairs `(S, T)` with `T ⊑ S ⊆ [n]`. For each item `i ∈ [n]`, exactly one of three mutually exclusive cases holds in the pair `(S, T)`:
- `i ∉ S` (hence `i ∉ T`),
- `i ∈ S` but `i ∉ T`,
- `i ∈ S` and `i ∈ T`.
(The fourth combination `i ∈ T, i ∉ S` is forbidden by `T ⊑ S`.) The `n` items choose independently among `3` states, so there are `3^n` pairs. ∎

**Proof 2 (binomial).** Group masks by popcount: there are `C(n,k)` masks of size `k`, each with `2^k` submasks. Hence
```
Σ_{k=0}^{n} C(n,k) · 2^k = (1 + 2)^n = 3^n,
```
by the binomial theorem with `x = 2`. ∎

**Corollary 5.2.** The submask-enumeration DP `dp[S] = best over T ⊑ S of f(combine(value(T), dp[S∖T]))`, with `O(1)` work per `(S, T)` pair, runs in `Θ(3^n)` time. The canonical inner loop `for (T = S; T; T = (T-1)&S)` visits each nonempty submask once: correctness because `(T−1)&S` is the largest submask of `S` strictly below `T`, so the sequence is strictly decreasing and hits every submask exactly once.

**Quantitative gap.** `3^n / 2^n = 1.5^n` grows without bound, so the submask DP is meaningfully more expensive than a per-mask loop: `3^{18} ≈ 3.9×10^8` (feasible), `3^{20} ≈ 3.5×10^9` (borderline), `3^{22} ≈ 3.1×10^{10}` (too slow). The exponent base `3` (not `4`) is precisely the content of Theorem 5.1 — a careless analyst who bounds "all masks × all masks" gets `4^n` and a wrong ceiling.

### 5.1 Correctness of the Submask Idiom

**Claim.** Starting from `T = S` and repeating `T ← (T − 1) & S` until `T = 0` visits every submask of `S` exactly once, in strictly decreasing order.

**Proof.** Let `T` be a current submask with `T ⊑ S`, `T > 0`. The integer `T − 1` flips `T`'s lowest set bit to `0` and sets all lower bits to `1`. Intersecting with `S` (`& S`) keeps only the bits that belong to `S`, producing the largest integer `T'` with `T' ⊑ S` and `T' < T`. Indeed, any submask `U ⊑ S` with `U < T` satisfies `U ≤ T − 1` and `U ⊑ S`, so `U = U & S ≤ (T−1) & S = T'`; thus `T'` is the immediate predecessor among submasks. The sequence therefore enumerates submasks strictly downward with no gaps, terminating at `0` (handled after the loop if the empty submask is needed). Each submask appears once because the sequence is strictly decreasing. ∎

### 5.2 Worked Submask Sum at n = 2

For `n = 2` the (mask, submask) pairs `T ⊑ S` are:
```
S=00: T ∈ {00}                      (1 pair)
S=01: T ∈ {01, 00}                  (2 pairs)
S=10: T ∈ {10, 00}                  (2 pairs)
S=11: T ∈ {11, 10, 01, 00}          (4 pairs)
total = 1 + 2 + 2 + 4 = 9 = 3^2.    ✓
```
Each of the two items is independently *out / in-mask-only / in-both*: `3 × 3 = 9`, confirming Theorem 5.1 concretely.

### 5.3 The Partition DP Cost in Practice

A canonical `O(3^n)` use is the set-partition DP `dp[S] = min over T ⊑ S of (cost(T) + dp[S∖T])`. The total work is `Σ_S 2^{popcount(S)} = 3^n` submask visits, *provided* `cost(T)` is precomputed in `O(2^n)` beforehand. A subtle but common mistake is computing `cost(T)` inside the submask loop in `O(|T|)`, which inflates the bound to `Σ_S Σ_{T⊑S} popcount(T)`. By an analogous three-state count (now weighting the "in-both" state by its contribution), this sum is `n·3^{n−1}` — a factor `n` worse. The fix is to precompute all `cost(T)` once (`O(2^n)` or `O(2^n n)` depending on `cost`), keeping the partition DP at a clean `O(3^n)`. The discipline mirrors the assignment-DP lesson: hoist any per-mask quantity out of the inner loop.

**Derivation of `Σ_S Σ_{T⊑S} popcount(T) = n·3^{n−1}`.** Count triples `(i, T, S)` with `i ∈ T ⊑ S`. Fix `i`: it is *in both* `T` and `S`; each other item independently chooses among the three states, giving `3^{n−1}`. With `n` choices of `i`, the total is `n·3^{n−1}`. This is the `3^n`-analogue of the `n·2^{n−1}` identity of Theorem 4.1, and it quantifies exactly the penalty of not hoisting `cost(T)`.

---

## 6. The Assignment-Problem DP and Its Dimension Collapse

**Setup.** `n` workers, `n` jobs, cost `c[i][j]` for worker `i` on job `j`; find a minimum-cost perfect matching. Define
```
A[mask] = minimum cost of assigning workers 0..(popcount(mask)−1)
          to exactly the set of jobs in `mask` (one worker per job).
```

**Theorem 6.1.** `A[0] = 0` and for `mask ≠ 0`, with `i = popcount(mask) − 1`,
```
A[mask] = min_{j ∈ mask} ( A[mask ∖ {j}] + c[i][j] ),
```
and `A[(1<<n)−1]` is the optimal assignment cost.

**Proof.** A matching of workers `0..i` to the jobs in `mask` (where `|mask| = i+1`) assigns worker `i` to some job `j ∈ mask`; deleting that pair leaves a matching of workers `0..i−1` to `mask∖{j}`. This is a bijection between the assignments and `⊎_{j∈mask}` (assignments of `0..i−1` to `mask∖{j}`), with additive cost `c[i][j]`. Minimising gives the recurrence; induction on `popcount(mask)` (using `A[0]=0` as the base) establishes correctness. ∎

**Why the worker dimension collapses (the key structural fact).** A naive formulation would index `dp[i][mask]` (worker `i`, jobs `mask`). But a *reachable* state always satisfies `i = popcount(mask)`: after assigning `i+1` workers we have used exactly `i+1` jobs. The worker count is a **function of the mask**, not an independent coordinate, so the `[i]` dimension is redundant. Dropping it changes `O(n · 2^n)` cells to `O(2^n)` cells and the transition stays `O(n)`, giving `O(2^n · n)` total — a clean factor-`n` and `n×`-memory improvement. This dimension-collapse-by-invariant is a recurring theme: whenever one coordinate is determined by another, eliminate it.

**Lemma 6.2 (Reachability invariant).** Every `mask` with `A[mask] < ∞` (reachable) is reached only from masks of popcount `popcount(mask) − 1`, and the transition assigns worker `popcount(mask) − 1`.

**Proof.** `A[0] = 0` has popcount `0`. Inductively, the recurrence sets `A[mask]` from `A[mask∖{j}]` by assigning one worker to job `j`, so `popcount(mask) = popcount(mask∖{j}) + 1`. Hence the popcount equals the number of workers assigned, and the worker just placed is indexed `popcount(mask) − 1`. The popcount is thus a derived quantity, justifying its elimination from the state. ∎

**Contrast with TSP.** The same collapse does *not* apply to Held-Karp: after visiting a set `S`, the current vertex `last` can be *any* element of `S`, not a function of `S`. That genuine freedom is why TSP keeps the `[last]` dimension (`O(2^n n)` cells) while assignment does not (`O(2^n)` cells). Recognising which coordinates are free versus derived is the core of optimal state design.

**Relation to the permanent.** Replacing `min` with `+` and `c[i][j]` by an indicator `M[i][j]` counts perfect matchings, i.e. computes the **permanent** of the 0/1 matrix `M`. This is Ryser's-formula territory (Section 7): the same `O(2^n n)` DP computes `perm(M)`, and the permanent is #P-complete in general (Valiant 1979), which is why no polynomial algorithm is expected.

### 6.1 Worked Assignment Trace

For `cost = [[9,2,7],[6,4,3],[5,8,1]]` the DP fills `A[mask]` with worker `i = popcount(mask)`:
```
A[000] = 0                                   (worker 0 next)
A[001] = A[000] + cost[0][0] = 9             A[010] = 2     A[100] = 7
worker 1 next for popcount-1 masks:
A[011] = min(A[001]+cost[1][1], A[010]+cost[1][0]) = min(9+4, 2+6) = 8
A[101] = min(A[001]+cost[1][2], A[100]+cost[1][0]) = min(9+3, 7+6) = 12
A[110] = min(A[010]+cost[1][2], A[100]+cost[1][1]) = min(2+3, 7+4) = 5
worker 2 next:
A[111] = min(A[011]+cost[2][2], A[101]+cost[2][1], A[110]+cost[2][0])
       = min(8+1, 12+8, 5+5) = 9
```
The optimum `A[111] = 9` is achieved by worker0→job1 (2), worker1→job2 (3), worker2→job0 (5)? That sums to 10; the DP's `9` comes from worker0→job0(9)? No — trace the argmin: `A[111]=8+cost[2][2]=8+1=9` via `A[011]` = worker0→job1(2)+worker1→job0(6)=8, then worker2→job2(1). So assignment `0→1, 1→0, 2→2` costs `2+6+1 = 9`. The brute-force minimum over all `3! = 6` permutations confirms `9` is optimal — a vivid reminder to trust the argmin path, not a hand-guessed assignment.

### 6.2 Counting Variant on the Same Trace

If instead each job is either allowed (`1`) or forbidden (`0`) and we count perfect matchings, the same `dp[mask]` becomes a *count*: `dp[mask] = Σ_{j ∈ mask, allowed[i][j]} dp[mask∖{j}]` with `i = popcount(mask)−1`. For the all-ones `3×3` allowance matrix this yields `dp[111] = 3! = 6`, the permanent of the all-ones matrix. The optimisation DP (`min`, returns `9`) and the counting DP (`Σ`, returns `6`) share the *identical* state space and transition structure — only the combine operator differs. This is the assignment-problem instance of the "one bijection, three semirings" theme: the `(min, +)` reading optimises, the `(+, ×)` reading counts, and a `(∨, ∧)` reading would decide *feasibility* of a perfect matching (Hall's condition), all from the same `dp[mask]` recurrence.

---

## 7. Counting and Inclusion-Exclusion

Switching the optimisation semiring `(min, +)` to the counting semiring `(+, ×)` (or `(+)` with indicator transitions) turns the same DPs into counting algorithms.

**Hamiltonian path counting.** `dp[S][last]` counts simple paths from a fixed start visiting exactly `S` ending at `last`; the recurrence sums predecessors (Section 2 with `min → Σ`). Total Hamiltonian paths = `Σ_{last} dp[[n]][last]`, in `O(2^n n^2)`. The semiring switch is total: the same penultimate-vertex bijection (Section 2.2) reads as cardinalities (`|A ⊎ B| = |A| + |B|`, `|A × B| = |A|·|B|`) instead of minima, so correctness is inherited from the same combinatorial fact — no separate proof needed.

**Theorem 7.1 (Inclusion-exclusion for Hamiltonian paths, Karp/Kohn-Gottlieb-Kohn / Bax).** The number of Hamiltonian paths can be computed in `O(2^n · n)` (better than the `O(2^n n^2)` DP by a factor of `n`) via inclusion-exclusion over the set of *forbidden* vertices. Sketch: let `walks_k(S)` count walks of length `n−1` that avoid all vertices outside `S` (this is a fast matrix/vector recurrence over the induced subgraph). By inclusion-exclusion,
```
#Hamiltonian = Σ_{S ⊆ [n]} (−1)^{n − |S|} · (number of length-(n−1) walks from s to t staying within S),
```
because a walk that uses all `n` vertices is exactly a Hamiltonian path, and the alternating sum sieves out walks missing at least one vertex. Each term's walk count is computed by a `(min n)`-step recurrence in `O(n)` amortised, and there are `2^n` subsets `S`, giving `O(2^n n)`. ∎ (sketch)

**The permanent and Ryser's formula.** For counting perfect matchings (`perm` of a 0/1 matrix),
```
perm(A) = (−1)^n Σ_{S ⊆ [n]} (−1)^{|S|} Π_{i=1}^{n} ( Σ_{j∈S} A[i][j] ),
```
Ryser's formula, evaluable in `O(2^n · n)` (or `O(2^n)` amortised using Gray-code submask updates). This is the counting analogue of the assignment DP and the canonical #P-complete problem.

**Connection between the two views.** The subset DP and the inclusion-exclusion sum are two evaluations of the same generating identity: the DP sums over *paths* grouped by visited-set; inclusion-exclusion sums over *vertex subsets* with alternating signs to enforce "all vertices used." Both are `2^n`-flavoured; inclusion-exclusion often shaves the `n^2` to `n` by replacing the per-state `last` bookkeeping with an algebraic sieve.

### 7.1 Worked Hamiltonian-Path Count

On the complete directed graph `K_3` (`adj[i][j] = 1` for all `i ≠ j`), the counting DP gives:
```
Base: dp[{0}][0] = dp[{1}][1] = dp[{2}][2] = 1.
Size 2 (sum predecessors):
   dp[{0,1}][1] = dp[{0}][0] = 1 ; dp[{0,1}][0] = dp[{1}][1] = 1 ; (and the other pairs)
Size 3, e.g. ending at 2:
   dp[{0,1,2}][2] = dp[{0,1}][0] + dp[{0,1}][1] = 1 + 1 = 2.
By symmetry dp[full][0] = dp[full][1] = dp[full][2] = 2.
Total = 2 + 2 + 2 = 6 = 3!.    ✓
```
Six directed Hamiltonian paths is exactly `3!` (every ordering of the three vertices is a valid path in the complete graph), confirming the summation recurrence.

### 7.2 Ryser's Formula Worked at n = 2

For `M = [[1,1],[1,1]]` (the `2×2` all-ones, whose permanent is `2`):
```
perm(M) = (−1)^2 Σ_{S ⊆ {1,2}} (−1)^{|S|} Π_{i=1}^{2} ( Σ_{j∈S} M[i][j] ).
S = ∅:   (−1)^0 · (0)(0) = 0
S = {1}: (−1)^1 · (M[1][1])(M[2][1]) = −(1)(1) = −1
S = {2}: (−1)^1 · (M[1][2])(M[2][2]) = −(1)(1) = −1
S = {1,2}: (−1)^2 · (M[1][1]+M[1][2])(M[2][1]+M[2][2]) = (2)(2) = 4
Σ = 0 − 1 − 1 + 4 = 2 = perm(M).    ✓
```
The `2^n` subsets and `O(n)` product per subset give the `O(2^n n)` evaluation; the alternating sign is the inclusion-exclusion sieve removing assignments that miss a column.

---

## 8. Lower-Bound Context: TSP NP-Hardness and the Held-Karp Conjecture

**Theorem 8.1 (TSP NP-hardness).** The decision version of TSP ("is there a tour of cost `≤ B`?") is NP-complete; the optimisation version is NP-hard.

**Proof sketch.** Reduce from Hamiltonian Cycle (Karp 1972, one of the original 21 NP-complete problems). Given a graph `G`, build a complete TSP instance with `dist[i][j] = 1` if `(i,j) ∈ E(G)` and `dist[i][j] = 2` otherwise; `G` has a Hamiltonian cycle iff the TSP optimum is exactly `n`. The reduction is polynomial, so a polynomial TSP solver would solve Hamiltonian Cycle, hence `P = NP`. ∎

**Consequence for bitmask DP.** Since TSP is NP-hard, no polynomial algorithm is expected; the `O(2^n n^2)` Held-Karp is, up to the `poly(n)` factor, among the best *exact* worst-case bounds known.

**The Held-Karp lower-bound question (a major open problem).** Is there an exact TSP algorithm running in `O((2−ε)^n)` for some `ε > 0`? For *general* TSP this is open and tied to the **Strong Exponential Time Hypothesis (SETH)** circle of conjectures. For *symmetric undirected* TSP and Hamiltonicity there are randomized improvements (Björklund 2010: Hamiltonicity in `O^*(1.657^n)` via algebraic / determinant-of-the-graph-polynomial methods), but no general deterministic `(2−ε)^n` exact TSP algorithm is known. The practical takeaway: `2^n` is, to current knowledge, essentially the exact-TSP barrier, and improvements are subtle and problem-specific.

### 8.1 The Reduction in Detail

Given an undirected graph `G = (V, E)` with `|V| = n`, build a complete TSP instance on `V` with
```
dist[i][j] = 1  if {i,j} ∈ E,
dist[i][j] = 2  if {i,j} ∉ E  (i ≠ j).
```
A Hamiltonian cycle in `G` uses `n` edges all of weight `1`, giving a tour of cost exactly `n`. Conversely, any tour has `n` edges each of weight `≥ 1`, so cost `≥ n`, with equality iff every tour edge is a `G`-edge — i.e. iff the tour is a Hamiltonian cycle of `G`. Thus `G` is Hamiltonian ⟺ TSP-optimum `= n`. The construction is `O(n^2)` time, hence polynomial; a polynomial TSP solver would decide Hamiltonian Cycle in polynomial time, forcing `P = NP`. This is the metric (triangle-inequality-respecting, since weights `1` and `2` satisfy `2 ≤ 1 + 1`) version, so even *metric* TSP is NP-hard. ∎

### 8.2 Why the Bitmask State Is Forced

The NP-hardness explains *why* the DP state must be exponential. The Held-Karp state `(visited set, current vertex)` is, in a precise sense, the minimal sufficient statistic: to extend a partial tour optimally you must know which vertices remain (to forbid repeats) and where you are (to price the next edge). The "which vertices remain" component cannot be compressed below `2^n` distinct values in general, because distinguishing partial tours by their *unvisited sets* is exactly what a correct algorithm must do — and that is the combinatorial reason no `poly(n)`-state DP can exist unless `P = NP`. Contrast walk counting (sibling `11-graphs/32-paths-fixed-length`), whose memoryless state is just "current vertex" (`n` values), placing it in `P`.

**Held-Karp's *other* meaning.** "Held-Karp" also names the **Held-Karp lower bound** (the 1-tree LP relaxation), a different result by the same authors used inside branch-and-bound to prune. It is a strong, polynomially computable lower bound (within a factor `~2/3` to the optimum empirically), not to be confused with the DP. Both come from Held & Karp (1962–1971).

---

## 9. Sum-over-Subsets (SOS) Transform and Möbius Inversion

A foundational tool that generalises submask enumeration: the **sum-over-subsets (SOS) DP**, also called the zeta transform over the subset lattice.

**Definition 9.1 (Zeta / SOS transform).** Given `f : 2^{[n]} → ℝ`, its subset-sum transform is
```
F[S] = Σ_{T ⊑ S} f[T].
```
Naively this is `O(3^n)` (Theorem 5.1). The **SOS DP** computes all `F[S]` in `O(2^n · n)`:
```
F = copy of f
for i in 0..n−1:
    for S in 0..2^n−1:
        if S & (1<<i):  F[S] += F[S ^ (1<<i)]
```

**Theorem 9.2 (SOS correctness and complexity).** The above computes `F[S] = Σ_{T ⊑ S} f[T]` in `Θ(2^n · n)` time.

**Proof.** Loop invariant: after processing bits `0..i−1`, `F[S]` equals the sum of `f[T]` over all `T` that agree with `S` on bits `≥ i` and are arbitrary submasks on bits `< i`. Processing bit `i` adds, for masks `S` with bit `i` set, the contribution from `T` with bit `i` cleared, merging the two halves. After all `n` bits, `F[S]` sums over all submasks. Each of `n` passes does `O(2^n)` work. ∎

**Möbius inversion (the inverse transform).** The transform is invertible:
```
f[S] = Σ_{T ⊑ S} (−1)^{|S| − |T|} F[T],
```
computed by the same DP with `+=` replaced by `−=`. This **subset-lattice Möbius inversion** is the algebraic backbone of inclusion-exclusion algorithms (Section 7) and of **subset-convolution** (the Björklund-Husfeldt-Kaski-Koivisto `O(2^n · n^2)` algorithm), which computes `(f * g)[S] = Σ_{T ⊑ S} f[T] g[S∖T]` — the operation behind fast set-partition and graph-colouring DPs. The reduction from a naive `O(3^n)` submask convolution to `O(2^n n^2)` via SOS + the "rank/popcount" trick is one of the deepest results in subset DP.

**Practical note.** Many DPs phrased as `O(3^n)` submask loops can be sped to `O(2^n n)` or `O(2^n n^2)` with SOS / subset convolution when the `combine` operation is a sum or a `(min,+)` over a *bounded* additive structure. Recognising this is the difference between `n = 18` and `n = 22` feasibility.

### 9.1 Worked SOS Transform at n = 2

Let `f = [f_{00}, f_{01}, f_{10}, f_{11}] = [1, 2, 3, 4]` (indexed by mask). Apply the SOS DP:
```
Initial F = [1, 2, 3, 4].
Bit 0: for masks with bit 0 set, add the bit-0-cleared sibling.
   F[01] += F[00] → 2 + 1 = 3
   F[11] += F[10] → 4 + 3 = 7
   F = [1, 3, 3, 7].
Bit 1: for masks with bit 1 set, add the bit-1-cleared sibling.
   F[10] += F[00] → 3 + 1 = 4
   F[11] += F[01] → 7 + 3 = 10
   F = [1, 3, 4, 10].
```
Check: `F[11]` should be `f_{00}+f_{01}+f_{10}+f_{11} = 1+2+3+4 = 10`. ✓ `F[10] = f_{00}+f_{10} = 1+3 = 4`. ✓ Two passes of `O(2^n)` work, no submask loop — the `O(2^n n)` zeta transform in action.

### 9.2 Möbius Inversion Check

Inverting `F = [1,3,4,10]` with `−=` recovers `f`:
```
Bit 1: F[10] −= F[00] → 4−1 = 3 ; F[11] −= F[01] → 10−3 = 7  ⇒ [1,3,3,7]
Bit 0: F[01] −= F[00] → 3−1 = 2 ; F[11] −= F[10] → 7−3 = 4   ⇒ [1,2,3,4] = f. ✓
```
The transform and its inverse are the same DP with `+=`/`−=` swapped, confirming the subset-lattice zeta/Möbius pair operationally — the algebraic engine behind inclusion-exclusion counting (Section 7).

### 9.3 Subset Convolution in O(2^n · n^2)

**Definition 9.3.** The subset (covering) convolution of `f, g : 2^{[n]} → ℝ` is
```
(f * g)[S] = Σ_{T ⊑ S} f[T] · g[S ∖ T].
```
The naive evaluation is `O(3^n)` (sum over submasks of every `S`). The Björklund-Husfeldt-Kaski-Koivisto (2007) algorithm achieves `O(2^n · n^2)`.

**The popcount-ranking trick.** Define the *ranked* function `f̂_r[S] = f[S]·[popcount(S) = r]` for each rank `r ∈ {0,…,n}`. The key observation: in `(f * g)[S]`, the parts `T` and `S∖T` have sizes summing to `|S|`, so the convolution decomposes by rank as a sum of `(n+1)^2` ordinary *subset-sum* (zeta) products, each computable in `O(2^n n)`. Concretely:
1. Zeta-transform each ranked layer `f̂_r` and `ĝ_r` (`O(2^n n)` each, `O(2^n n^2)` total).
2. For each `S` and target rank `q = popcount(S)`, combine `Σ_{a+b=q} F̂_a[S]·Ĝ_b[S]` in the *transformed* domain (`O(2^n n^2)`).
3. Möbius-invert the result rank by rank.
The rank constraint `|T| + |S∖T| = |S|` is what lets the ordinary (overlapping) zeta product be sieved back into the disjoint-cover convolution. This `O(2^n n^2)` algorithm powers fast graph-colouring and set-partition counting, replacing many `O(3^n)` DPs — the single deepest result in subset-DP theory.

**Gray-code Ryser.** Ryser's formula (Section 7) can be evaluated in `O(2^n)` arithmetic (not `O(2^n n)`) by visiting subsets in **Gray-code** order: consecutive subsets differ in one element, so the inner row-sums `Σ_{j∈S} M[i][j]` update in `O(n)` *amortised `O(1)` per step* via a single add/subtract per row. This is the standard production implementation of the permanent for `n ≤ ~28`, beyond which even `2^n` becomes infeasible — the permanent's #P-completeness asserting itself.

---

## 10. Profile DP as a Transfer Matrix

Broken-profile / column-by-column grid DP (senior §5) has a clean algebraic form.

**Setup.** Fill an `m × k` grid; the state between columns is a profile mask `P ∈ [0, 2^m)` recording which cells protrude into the next column. Let `T[P][P'] = ` number of ways to fill one column given incoming profile `P` and producing outgoing profile `P'`.

**Theorem 10.1.** The number of tilings is `(T^k)[0][0]` (start and end with empty profile), where `T` is the `2^m × 2^m` transfer matrix and the product is the counting `(+, ×)` matrix power.

**Proof.** Filling proceeds column by column; the ways to go from an all-empty start profile to an all-empty end profile in `k` columns is, by the matrix-power walk-counting theorem (sibling topic `11-graphs/32-paths-fixed-length`), the `(0,0)` entry of `T^k`. Each column transition is independent given the incoming profile, so the per-column ways multiply and sum exactly as matrix multiplication prescribes. ∎

**Consequence.** For *fixed width* `m` and *huge height* `k`, the tiling count is computable in `O((2^m)^3 · log k)` by binary exponentiation of the `2^m × 2^m` transfer matrix — connecting bitmask profile DP to fast matrix exponentiation. For moderate `k`, the linear `O(k · 2^m · transitions)` column sweep is simpler and usually preferred; the transfer-matrix view is what enables the `log k` speedup when `k` is astronomically large.

**Why width must be small.** The transfer matrix is `2^m × 2^m`; both the sweep (`O(k 2^m)` with `O(m)` transition work) and the matrix power (`O(2^{3m} log k)`) are exponential in the *width* `m` only. This is the formal reason senior §5 insists on choosing the narrow grid dimension as the profile.

### 10.1 Worked Tiling Count: 2 × k Dominoes

For a board of width `m = 2`, the profile is a 2-bit mask. Let `D(k)` be the number of domino tilings of a `2 × k` board. The classic recurrence (placing a vertical domino in the last column, or two horizontals spanning the last two columns) is
```
D(k) = D(k−1) + D(k−2),    D(0) = 1, D(1) = 1,
```
so `D = 1, 1, 2, 3, 5, 8, …` — the Fibonacci numbers. The transfer-matrix view recovers this: the `2^2 × 2^2 = 4×4` column-transition matrix `T`, restricted to the reachable profiles, has characteristic polynomial whose dominant root is the golden ratio `φ`, so `D(k) ∼ φ^{k}/√5`. The general broken-profile DP reproduces `D(2)=2, D(3)=3, D(4)=5`, and for an `m×k` board with larger `m` the count grows like `λ_max(T)^k` where `λ_max(T)` is the spectral radius of the width-`m` transfer matrix — the same `λ_max^k` growth law as the matrix-power walk theorem. This is the precise sense in which profile DP *is* fixed-length walk counting on the graph of profiles.

### 10.2 Why the Profile Graph Is the Right Abstraction

Each profile mask is a vertex; `T[P][P']` is the number of ways one column transitions from incoming profile `P` to outgoing profile `P'`. A full tiling is then a *walk* of length `k` on this profile graph from the empty profile back to the empty profile — exactly `(T^k)[0][0]`. The bitmask (profile) is the state; the column index is the "time"; and the whole apparatus is the transfer-matrix method of analytic combinatorics. Recognising a grid-DP as a walk on the profile graph is what unlocks the `O(2^{3m} log k)` matrix-exponentiation speedup for astronomically tall boards, and explains why tiling counts satisfy linear recurrences (the characteristic polynomial of `T`).

---

### 10.3 Transfer-Matrix Exponentiation Worked

For the `2 × k` domino board, the reachable profiles between columns are `{empty}` and `{top-protruding}`-style states; reducing to the two essential states gives the `2×2` transfer matrix `T = [[1,1],[1,0]]` (the Fibonacci matrix). Then the number of tilings of width `2`, length `k` is `(T^k)[0][0]`-style entry, computed by binary exponentiation:
```
T^1 = [[1,1],[1,0]]
T^2 = [[2,1],[1,1]]
T^4 = (T^2)^2 = [[5,3],[3,2]]
For k = 5: T^5 = T^4 · T^1 = [[8,5],[5,3]], reading D(5) = 8.    ✓
```
Only `⌊log₂ k⌋ + popcount(k)` matrix multiplies are needed, so `D(10^{18})` mod a prime is computed in ~60 `2×2` multiplies — the `O(2^{3m} log k)` bound with `m = 2`. This is the bridge from bitmask profile DP to the matrix-power machinery of `11-graphs/32-paths-fixed-length`.

---

## 10b. Parameterized and Comparative Landscape

Bitmask DP sits in a landscape of exact and parameterized methods. The boundaries are sharp and worth memorising.

| Problem | Best known exact | Parameterized / note |
|---------|------------------|----------------------|
| TSP / shortest Hamiltonian path | `O(2^n n^2)` Held-Karp | NP-hard; `(2−ε)^n` open |
| Hamiltonicity (decision) | `O^*(1.657^n)` (Björklund 2010, randomized) | beats `2^n` for the *decision* version |
| Min-cost assignment | `O(2^n n)` bitmask, `O(n^3)` Hungarian | Hungarian polynomial — preferred for large `n` |
| Count Hamiltonian paths | `O(2^n n)` inclusion-exclusion | #P-complete |
| Permanent / count matchings | `O(2^n)` Gray-code Ryser | #P-complete (Valiant 1979) |
| Set partition / colouring | `O(2^n n^2)` subset convolution | improves naive `O(3^n)` |
| Graph colouring (chromatic number) | `O(2^n n)` via inclusion-exclusion | counts proper colourings |
| Steiner tree (`k` terminals) | `O(3^k n + 2^k n^2 + ...)` Dreyfus-Wagner / DW-with-merge | bitmask over terminal set, *not* all vertices |

**The Steiner-tree subtlety.** A frequent and instructive case: the minimum Steiner tree connecting `k` specified terminals in an `n`-vertex graph is solved by the Dreyfus-Wagner DP with a bitmask over the **`k` terminals**, not all `n` vertices — `dp[S][v]` = cheapest tree connecting terminal-subset `S` with `v` in the tree. The submask merge step (`Σ_{T ⊑ S} dp[T][v] + dp[S∖T][v]`) makes it `O(3^k n + 2^k n^2)`. The lesson: **choose the ground set whose size is genuinely small** — here the terminals, not the vertices — so the `2^{(·)}` factor stays tame. Misidentifying the ground set is the single most common modelling error, turning a feasible `2^k` into an infeasible `2^n`.

**Color-coding bridge.** For *detecting* (not optimally weighting) a length-`k` simple path, color-coding (Alon-Yuster-Zwick 1995) randomly `k`-colours the vertices and runs a bitmask DP over the `2^k` colour-subset — turning a `2^n`-vertex-subset DP into a `2^k`-colour-subset DP, parameterized by `k` rather than `n`. This is the same "shrink the ground set" principle applied via randomization, and it is why path *detection* parameterized by length is FPT while exact-weight Hamiltonicity is not.

**The unifying principle.** Every entry in the table above is some bitmask DP whose ground set was chosen as small as the problem permits: all `n` vertices (Held-Karp, forced because the visited set is intrinsic), the `k` terminals (Steiner), the `k` colours (color-coding), the `m`-cell frontier (profile DP), or the universe of `m` requirements (set cover). The art of the field is reading a problem and identifying the *smallest* set whose subsets form a sufficient state — because that set's size is the exponent, and the exponent is destiny. Once the ground set is fixed, the recurrence, the dependency order (ascending masks), and the semiring (`min` / `Σ` / `∨`) follow mechanically from the templates proved above.

---

## 10c. Worked End-to-End: Why n = 20 Is the Wall

Combining the identities gives a single, memorable picture of the feasibility ceiling for Held-Karp:

- **Cells:** `n · 2^{n−1}`. At `n = 20`: `20 · 2^{19} ≈ 1.05 × 10^7` cells.
- **Bytes (8 B each):** `≈ 84 MB` — fits, but tight with overhead.
- **Transitions:** `n(n−1) 2^{n−2} ≈ 10^8` — sub-second in Go/Java, a few seconds in CPython.
- **At `n = 24`:** cells `≈ 2 × 10^8`, bytes `≈ 1.6 GB`, transitions `≈ 1.6 × 10^9` — memory becomes the binding constraint.
- **At `n = 30`:** cells `≈ 1.6 × 10^{10}`, bytes `≈ 128 GB` — infeasible on commodity hardware.

The exponential `2^n` term dominates everything: each `+1` to `n` roughly doubles both time and memory. The `n^2` polynomial factor is a rounding error by comparison. This is the precise quantitative content of the senior-level advice "`n ≤ 20`" — not a rule of thumb but a direct reading of `n · 2^{n−1}` against a few-GB memory budget. The same arithmetic, with the cell count divided by `n` (the assignment DP's `2^n` cells), pushes the ceiling to `n ≈ 24`; the `3^n` partition DP drops it back to `n ≈ 18`.

---

## 11. Summary

- **Held-Karp recurrence.** `dp[S][last]` is the cheapest simple path from `0` visiting exactly `S` ending at `last`; proved by a penultimate-vertex bijection (Theorem 2.1). The optimal tour adds the closing edge. Dependency order is automatic because clearing a bit decreases the mask.
- **Complexity.** `Θ(2^n n^2)` time, `Θ(2^n n)` space (Theorem 3.1), the table size being `Σ_S popcount(S) = n·2^{n−1}` (Theorem 4.1, proved three ways). This converts the factorial brute force into an exponential.
- **Submask sum.** `Σ_S 2^{popcount(S)} = 3^n` (Theorem 5.1), because each item is independently *out / in-mask-only / in-both* — the exact cost of partition / set-cover submask DPs, and the reason the base is `3`, not `4`.
- **Dimension collapse.** The assignment DP needs only `dp[mask]` because the current worker `= popcount(mask)` is determined by the mask; eliminating the redundant coordinate gives `O(2^n n)` (Theorem 6.1).
- **Counting and inclusion-exclusion.** The same DPs count Hamiltonian paths and perfect matchings under the `(+,×)` semiring; inclusion-exclusion (Karp/Bax for paths, Ryser for the permanent) often shaves `n^2` to `n` via an alternating subset sieve.
- **Hardness.** TSP is NP-hard (reduction from Hamiltonian Cycle, Karp 1972); `2^n` is essentially the exact-TSP barrier, with only subtle randomized improvements (Björklund's `O^*(1.657^n)` Hamiltonicity) known. Whether a deterministic `(2−ε)^n` exact TSP exists is open.
- **SOS / Möbius.** The subset-lattice zeta transform computes all subset sums in `O(2^n n)`, its Möbius inverse drives inclusion-exclusion, and subset convolution (`O(2^n n^2)`) speeds many naive `O(3^n)` DPs — the deepest algorithmic content of the area.
- **Profile DP.** Broken-profile grid DP is a transfer-matrix power on a `2^m × 2^m` matrix; for huge height it powers in `O(2^{3m} log k)`, linking subset DP to matrix exponentiation, and forcing the narrow grid dimension to be the mask width.

### Complexity Cheat Table

| Task | Recurrence / method | Complexity |
|------|---------------------|-----------|
| Shortest Hamiltonian path / TSP tour | `dp[S][last]`, `min` | `O(2^n · n^2)` time, `O(2^n · n)` space |
| Assignment / min-cost matching | `dp[mask]`, `i = popcount(mask)` | `O(2^n · n)` |
| Count Hamiltonian paths (DP) | `dp[S][last]`, `Σ` | `O(2^n · n^2)` |
| Count Hamiltonian paths (sieve) | inclusion-exclusion | `O(2^n · n)` |
| Permanent / count matchings | Ryser's formula | `O(2^n · n)` |
| Partition / set-cover | submask DP | `O(3^n)` |
| Sum-over-subsets (zeta) | SOS DP | `O(2^n · n)` |
| Subset convolution | SOS + popcount rank | `O(2^n · n^2)` |
| Broken-profile grid, width `m`, height `k` | transfer-matrix power | `O(2^{3m} log k)` |
| TSP exact lower bound (state of the art) | open / SETH-conjectured | `~2^n` barrier |
| Steiner tree, `k` terminals | Dreyfus-Wagner, bitmask over terminals | `O(3^k n + 2^k n^2)` |
| Detect length-`k` simple path | color-coding (randomized) | `O^*(2^k)` |
| Chromatic number / proper colourings | inclusion-exclusion | `O(2^n · n)` |

### Closing Notes

- **State design is the discipline.** Eliminate any coordinate that is a function of another (the assignment dimension collapse, Lemma 6.2); choose the smallest ground set (terminals for Steiner, colours for color-coding) so the `2^{(·)}` exponent stays tame. Misidentifying the ground set is the dominant modelling error.
- **One bijection, three semirings.** The penultimate-vertex decomposition (Section 2.2) proves the `min` (shortest), `Σ` (count), and `∨` (feasibility) variants simultaneously — only the semiring reading changes. This is the same identity-per-semiring structure as matrix-power walk counting in `11-graphs/32-paths-fixed-length`.
- **The integer order is a topological sort.** Ascending mask order is a linear extension of subset inclusion (Corollary 2.2), so no explicit topological sort of the `2^n`-state DAG is ever needed.
- **Hoist per-mask quantities.** Computing `cost(T)` inside a submask loop inflates `O(3^n)` to `O(n·3^{n−1})` (Section 5.3); precompute it once. The analogue of the `n·2^{n−1}` table identity for the `3^n` world.
- **Hardness is structural.** The visited-set state cannot be compressed below `2^n` without changing the model (Section 3.2, 8.2); the memoryless walk recurrence (`n` states, in `P`) and the visited-set simple-path recurrence (`2^n` states, NP-hard) differ by exactly the "no repeats" constraint.

Foundational references: Held & Karp (1962), *A Dynamic Programming Approach to Sequencing Problems*; Bellman (1962) for the independent DP discovery; Karp (1972) for NP-completeness; Valiant (1979) for #P-completeness of the permanent; Ryser (1963) for the permanent formula; Yates (1937) / Kennes for the fast zeta (SOS) transform; Björklund-Husfeldt-Kaski-Koivisto (2007) for subset convolution; Björklund (2010) for `O^*(1.657^n)` Hamiltonicity. Sibling topics: `11-graphs/32-paths-fixed-length` (matrix-power walk counting), and other formulations in `13-dynamic-programming`.
