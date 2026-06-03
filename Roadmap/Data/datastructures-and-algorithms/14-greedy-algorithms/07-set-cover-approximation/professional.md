# Set Cover Approximation — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions — Set Cover, Weighted Set Cover, Frequency
2. The Greedy Algorithm (statement)
3. Proof of the `H(n)` Approximation Bound
4. Tightness of the Bound — A Matching Lower-Bound Instance
5. Hardness of Approximation — Feige's `ln n` Threshold
6. The LP Relaxation, Duality, and the Integrality Gap
7. LP Rounding Alternatives — Frequency and Randomized
8. Submodularity and the `1 − 1/e` Bound for Max Coverage
9. Complexity, Cache Behavior, and Average-Case Analysis
10. Space–Time Trade-offs
11. Comparison with Alternatives
12. Open Problems and Summary
13. Reference Code (Greedy with Dual-Fitting Certificate, Go / Java / Python)

---

## 1. Formal Definitions — Set Cover, Weighted Set Cover, Frequency

**Definition 1.1 (Universe and sets).** A set-cover instance is `(U, 𝓢)` where `U = {1, …, n}` is the **universe** and `𝓢 = {S₁, …, S_m}` with each `Sᵢ ⊆ U`. We assume `⋃ᵢ Sᵢ = U` (feasibility); otherwise no cover exists.

**Definition 1.2 (Cover).** A **cover** is a sub-collection `𝓒 ⊆ 𝓢` with `⋃_{S ∈ 𝓒} S = U`. The **set cover problem** seeks a cover minimizing `|𝓒|`. Its optimum is `OPT`.

**Definition 1.3 (Weighted set cover).** Each set carries a cost `c : 𝓢 → ℝ_{>0}`. A weighted cover minimizes `Σ_{S ∈ 𝓒} c(S)`. Unit costs `c ≡ 1` recover Definition 1.2.

**Definition 1.4 (Frequency).** The **frequency** of an element `e` is `f(e) = |{i : e ∈ Sᵢ}|`, the number of sets containing it. The instance frequency is `f = max_e f(e)`. (Vertex cover is the case `f = 2`: each edge lies in exactly the two vertex-sets of its endpoints.)

**Definition 1.5 (Harmonic number).** `H(k) = Σ_{j=1}^{k} 1/j`. Standard bounds: `ln(k) < H(k) ≤ ln(k) + 1`, and `H(k) = ln k + γ + O(1/k)` with `γ ≈ 0.5772` the Euler–Mascheroni constant.

**Definition 1.6 (Maximum set size).** `d = max_i |Sᵢ|`. The first set greedy can pick covers at most `d` elements, which sharpens the bound to `H(d) ≤ H(n)`.

**Proposition 1.7 (NP-hardness).** Set cover is NP-hard; its decision version ("is there a cover of size `≤ k`?") is NP-complete (Karp, 1972), via reduction from vertex cover (itself from 3-SAT / clique). Hence no polynomial exact algorithm is expected.

---

## 2. The Greedy Algorithm (statement)

**Algorithm (Greedy, weighted form).**

```
𝓒 ← ∅;  Covered ← ∅
while Covered ≠ U:
    pick S ∈ 𝓢 minimizing  c(S) / |S \ Covered|   (over sets with |S \ Covered| > 0)
    𝓒 ← 𝓒 ∪ {S};  Covered ← Covered ∪ S
return 𝓒
```

The quantity `|S \ Covered|` is the **gain** (newly covered elements). For the unweighted problem `c ≡ 1`, "minimize `c(S)/gain`" is exactly "**maximize gain**." When `S` is chosen, define for each newly covered element `e ∈ S \ Covered` its **price**

```
price(e) = c(S) / |S \ Covered|.
```

Since the gain elements each receive this price and there are exactly `|S \ Covered|` of them, the prices of one chosen set sum to `c(S)`. Summing over all chosen sets:

```
Σ_{S ∈ 𝓒} c(S) = Σ_{e ∈ U} price(e).      (♦)
```

This identity — total cost equals total price — is the bridge to the analysis.

---

## 3. Proof of the `H(n)` Approximation Bound

**Theorem 3.1 (Greedy guarantee).** Greedy returns a cover of cost at most `H(n) · OPT`, where `n = |U|`. More sharply, at most `H(d) · OPT` with `d = max_i |Sᵢ|`.

We prove the stronger element-ordering version.

**Lemma 3.2 (Price bound per element).** Order the elements `e₁, e₂, …, e_n` in the order greedy covers them (ties within one set broken arbitrarily). Then for the `k`-th covered element `eₖ`,

```
price(eₖ) ≤ OPT / (n − k + 1).
```

*Proof.* Consider the moment just before `eₖ` is covered. At least the elements `eₖ, e_{k+1}, …, e_n` are still uncovered, so the number of uncovered elements is `r ≥ n − k + 1`. The optimal cover `𝓒*` covers all of `U`, in particular these `r` uncovered elements, using at most `OPT` sets *of total cost `OPT`*. Restrict `𝓒*` to these uncovered elements: their total cost is `≤ OPT` and they cover all `r` of them, so by an averaging argument **some** set `S* ∈ 𝓒*` satisfies

```
c(S*) / |S* ∩ Uncovered|  ≤  OPT / r.
```

(Indeed, if every set in `𝓒*` had ratio `> OPT/r`, then `Σ c(S*) > (OPT/r) · Σ|S* ∩ Uncovered| ≥ (OPT/r) · r = OPT`, since the optimal sets cover all `r` uncovered elements, contradicting `Σ_{𝓒*} c ≤ OPT`.) Greedy picks the set minimizing this ratio over **all** sets, so the set `S` greedy actually chooses to cover `eₖ` has ratio at most that of `S*`:

```
price(eₖ) = c(S) / |S \ Covered| ≤ c(S*)/|S* ∩ Uncovered| ≤ OPT / r ≤ OPT/(n − k + 1).  ∎
```

**Proof of Theorem 3.1.** Sum the per-element price bound using identity (♦):

```
cost(greedy) = Σ_{k=1}^{n} price(eₖ)
             ≤ Σ_{k=1}^{n} OPT/(n − k + 1)
             = OPT · Σ_{j=1}^{n} 1/j
             = OPT · H(n).
```

The substitution `j = n − k + 1` turns the sum into the harmonic series. The sharper `H(d)` bound follows because the first element greedy covers is covered by a set of size at most `d`, so the largest ratio any element pays is at most `OPT/`(gain of its set), and the gains never exceed `d`; re-running the telescoping with the first `d` terms gives `H(d)`. ∎

**Remark.** This is the **dual-fitting** proof in disguise: the prices `price(e)` form an (almost-)feasible solution to the LP dual scaled by `1/H(n)`, certifying the bound. Section 6 makes the LP duality explicit.

### 3.1 Worked instance of the price telescoping

Take `U = {1,…,n}` and suppose greedy covers elements in five batches with gains `g₁ ≥ g₂ ≥ …`. The price each element pays is `1/gⱼ` for the batch `j` that covers it (unit costs). Consider a concrete run with `n = 6`, `OPT = 2`, where greedy's batches cover `(3, 2, 1)` elements:

```
batch 1 covers 3 elements, each priced 1/3   (uncovered before: 6, bound OPT/6 = 1/3 ✓)
batch 2 covers 2 elements, each priced 1/2   (uncovered before: 3, bound OPT/3 = 2/3 ✓ ≥ 1/2)
batch 3 covers 1 element,  priced 1/1 = 1    (uncovered before: 1, bound OPT/1 = 2 ✓ ≥ 1)
total price = 3·(1/3) + 2·(1/2) + 1·1 = 1 + 1 + 1 = 3 sets.
```

The per-element bound `price(eₖ) ≤ OPT/(n−k+1)` holds at each step (the `✓` checks), and summing the bounds gives `OPT·H(6) = 2·2.45 = 4.9 ≥ 3`. The actual cost `3` sits below the bound, as it must. The harmonic structure is visible: later-covered elements pay more (`1/3 → 1/2 → 1`), and the worst-case instances of Section 4 push the last elements all the way to the `OPT/1` ceiling.

---

## 4. Tightness of the Bound — A Matching Lower-Bound Instance

The `H(n)` bound is not an artifact of a loose proof: there are instances on which greedy uses `≈ ln(n) · OPT` sets.

**Construction 4.1.** Let `U = {1, …, n}`. Include two "good" sets `A` and `B` that partition `U` into two halves — `{A, B}` is an optimal cover of size `OPT = 2`. Additionally include a chain of "bad" sets `T₁, T₂, …, T_k` where `Tⱼ` covers exactly the largest still-uncoverable block — engineered so that `|T₁| = n/2`, `|T₂| = n/4`, …, each strictly larger than what `A` or `B` would newly cover at that round. Greedy, breaking ties toward the bad sets, picks `T₁, …, T_k` with `k ≈ log₂ n`, while OPT = 2. The ratio is `≈ (log₂ n)/2 = Θ(log n)`.

A cleaner classical instance: take `OPT` disjoint optimal sets of `n/OPT` elements each, and a family of greedy-luring sets whose marginal gains are `n/OPT · H`-spaced; the analysis yields greedy `= H(n/OPT) · OPT ≈ ln(n)·OPT`. The precise construction (Johnson 1974; Lovász 1975) shows greedy's worst case is `(1 − o(1)) ln n · OPT`, matching Theorem 3.1 up to lower-order terms.

**Consequence.** No analysis can prove a `o(log n)` guarantee for greedy — the logarithmic growth is intrinsic. The natural follow-up: can a *different* polynomial algorithm beat `ln n`? Section 5 says essentially no.

---

## 5. Hardness of Approximation — Feige's `ln n` Threshold

**Theorem 5.1 (Lund–Yannakakis 1994; Feige 1998).** Unless `NP ⊆ DTIME(n^{O(log log n)})` (a hypothesis nearly as strong as `P = NP`), no polynomial-time algorithm approximates set cover within a factor `(1 − ε)·ln n` for any constant `ε > 0`. Under the standard assumption `P ≠ NP`, set cover cannot be approximated within `c·ln n` for some constant `c < 1`; subsequent work (Dinur–Steurer 2014) tightened this to `(1 − o(1))·ln n` under `P ≠ NP` itself.

*Proof idea (sketch).* The reduction goes through **multi-prover interaction / PCP** and the hardness of **Label Cover**. One builds a set-cover instance from a Label-Cover instance using a **partition system** `B(m, L, d, ℓ)`: a ground set of `m` points with `L` partitions into `d` parts each, such that covering all points with parts from *fewer than* `ℓ ≈ (1−ε)ln m` distinct partitions is impossible. A "yes" Label-Cover instance yields a small set cover; a "no" instance forces `≈ ln n` times as many sets, because no consistent labeling exists and one must pay the partition system's `ln m` price. The gap between yes and no cases is exactly the `(1−ε)ln n` inapproximability factor. ∎

**Corollary 5.2.** Greedy's `H(n) = ln n + Θ(1)` guarantee is **optimal up to lower-order terms** among polynomial algorithms. This is one of the cleanest "algorithm matches hardness" pairings in approximation theory: a trivial greedy achieves what no clever algorithm can beat.

---

## 6. The LP Relaxation, Duality, and the Integrality Gap

**The IP and its relaxation.** With a variable `xᵢ ∈ {0,1}` per set:

```
(IP)  min Σᵢ c(Sᵢ) xᵢ   s.t.  Σ_{i : e ∈ Sᵢ} xᵢ ≥ 1  ∀e,   xᵢ ∈ {0,1}.
(LP)  relax to xᵢ ≥ 0.
```

`OPT_LP ≤ OPT_IP = OPT`, and `OPT_LP` is computable in polynomial time.

**The dual.** Assign a variable `yₑ ≥ 0` to each element (its "price" / packing value):

```
(DUAL)  max Σₑ yₑ   s.t.  Σ_{e ∈ Sᵢ} yₑ ≤ c(Sᵢ)  ∀i,   yₑ ≥ 0.
```

By LP duality, `Σₑ yₑ ≤ OPT_LP ≤ OPT` for any feasible `y`. **Dual fitting** is the technique behind Theorem 3.1: set `yₑ = price(e)/H(n)`. The price identity (♦) and Lemma 3.2 show this scaled `y` is dual-feasible, so

```
cost(greedy)/H(n) = Σₑ price(e)/H(n) = Σₑ yₑ ≤ OPT,
```

reproving `cost(greedy) ≤ H(n)·OPT` purely via duality — and yielding a **certificate** (`y`) of the bound that a service can emit.

**Theorem 6.1 (Integrality gap).** The set-cover LP has integrality gap `Θ(log n)`: there are instances with `OPT / OPT_LP = Θ(log n)`, and the gap is never worse than `H(n)`.

*Proof sketch.* The upper bound `OPT ≤ H(n)·OPT_LP` follows because greedy's cost is `≤ H(n)·OPT ≤ H(n)·(OPT \text{ which} ≥ OPT_LP)` — more directly, the dual-fitting `y` shows `OPT_LP ≥ cost(greedy)/H(n)`, so `OPT ≤ cost(greedy) ≤ H(n)·OPT_LP`. The lower bound uses the same partition-system instances as Section 5: the fractional optimum spreads weight evenly (cost `≈ 1`) while any integral cover needs `Θ(log n)` sets. ∎

**Consequence.** No LP-rounding algorithm using *only* this LP can beat `Θ(log n)` in general — the gap is a fundamental barrier, explaining why greedy and LP rounding both land at `Θ(log n)`.

---

## 7. LP Rounding Alternatives — Frequency and Randomized

### 7.1 Deterministic frequency rounding

**Theorem 7.1.** Rounding `xᵢ ← 1` for all `i` with `x*ᵢ ≥ 1/f` (where `f` is the max frequency) yields a feasible integral cover of cost `≤ f · OPT_LP ≤ f · OPT`.

*Proof.* Feasibility: each element `e` has `Σ_{i : e ∈ Sᵢ} x*ᵢ ≥ 1` with at most `f` terms, so by averaging some term `x*ᵢ ≥ 1/f`; that set is rounded up and covers `e`. Cost: each rounded variable had `x*ᵢ ≥ 1/f`, so `1 ≤ f·x*ᵢ`, and `Σ_{rounded} c(Sᵢ) ≤ f·Σᵢ c(Sᵢ)x*ᵢ = f·OPT_LP`. ∎

For **vertex cover** `f = 2`, giving the classic **2-approximation** — strictly better than `ln n` when `f` is a small constant. (A purely combinatorial 2-approximation via maximal matching exists too.)

### 7.2 Randomized rounding

**Theorem 7.2.** Independently set `xᵢ = 1` with probability `x*ᵢ`; repeat the whole rounding `t = ⌈c·ln n⌉` times and take the union. The result is feasible with high probability and has expected cost `O(log n)·OPT_LP`.

*Proof sketch.* In one round, the probability element `e` is **not** covered is `∏_{i : e∈Sᵢ}(1 − x*ᵢ) ≤ e^{−Σ x*ᵢ} ≤ e^{−1}` (using `Σ_{e∈Sᵢ} x*ᵢ ≥ 1` and `1 − x ≤ e^{−x}`). After `t = O(log n)` independent rounds, `Pr[e \text{ uncovered}] ≤ e^{−t} ≤ 1/n²`; a union bound over `n` elements gives full coverage with probability `≥ 1 − 1/n`. Expected cost per round is `OPT_LP`, so `t` rounds cost `O(log n)·OPT_LP`. ∎

Both rounding routes reproduce, by different mechanisms, the `Θ(log n)` regime predicted by the integrality gap (Theorem 6.1).

---

## 8. Submodularity and the `1 − 1/e` Bound for Max Coverage

**Definition 8.1 (Coverage function).** For `𝓐 ⊆ 𝓢`, let `f(𝓐) = |⋃_{S ∈ 𝓐} S|`. Then `f` is **monotone** (`𝓐 ⊆ 𝓑 ⇒ f(𝓐) ≤ f(𝓑)`) and **submodular**: for `𝓐 ⊆ 𝓑` and `S ∉ 𝓑`,

```
f(𝓐 ∪ {S}) − f(𝓐)  ≥  f(𝓑 ∪ {S}) − f(𝓑)       (diminishing returns).
```

*Proof of submodularity.* The marginal gain of `S` over `𝓐` is `|S \ ⋃𝓐|`. Since `⋃𝓐 ⊆ ⋃𝓑`, we have `S \ ⋃𝓑 ⊆ S \ ⋃𝓐`, so the marginal over `𝓑` is no larger. ∎

**Theorem 8.2 (Nemhauser–Wolsey–Fisher 1978).** For **max k-coverage** (choose `k` sets maximizing `f`), greedy — pick the maximum-marginal-gain set `k` times — achieves

```
f(greedy) ≥ (1 − (1 − 1/k)^k) · f(OPT) ≥ (1 − 1/e) · f(OPT) ≈ 0.632 · f(OPT).
```

*Proof.* Let `Aᵢ` be the greedy solution after `i` picks and `OPT` the optimal `k`-set value. By submodularity and monotonicity, at step `i+1` some optimal set has marginal gain `≥ (OPT − f(Aᵢ))/k`, and greedy takes at least that, so

```
f(A_{i+1}) − f(Aᵢ) ≥ (OPT − f(Aᵢ))/k  ⟹  OPT − f(A_{i+1}) ≤ (1 − 1/k)(OPT − f(Aᵢ)).
```

Unrolling `k` times: `OPT − f(A_k) ≤ (1 − 1/k)^k · OPT ≤ e^{−1}·OPT`, hence `f(A_k) ≥ (1 − 1/e)OPT`. ∎

**Theorem 8.3 (Feige 1998, tightness).** `1 − 1/e` is optimal for max coverage: no polynomial algorithm achieves `1 − 1/e + ε` unless `P = NP`.

Thus Set Cover (minimize sets to cover all, `H(n)`-tight) and Max Coverage (maximize coverage with `k` sets, `(1−1/e)`-tight) are the two faces of monotone submodular optimization, each with greedy achieving the best possible factor.

---

## 9. Complexity, Cache Behavior, and Average-Case Analysis

### 9.1 Time complexity

Let `N = Σᵢ |Sᵢ|` be the total input size (number of (element, set) incidences).

- **Naive greedy.** Each round recomputes all gains in `O(N)` and there are at most `min(m, n)` rounds: `O(N · min(m, n))` worst case.
- **Inverted-index greedy.** When a set is picked, only sets sharing a newly covered element update their gain. Total update work across the whole run is `O(Σₑ f(e)·1) = O(N)` (each incidence is touched a constant number of times). With a heap for argmax, total `O(N log m)`. This is the standard efficient implementation.
- **Bitset greedy.** Gains via `popcount` over `n/w` words (`w = 64`): a round is `O(m·n/w)`, total `O(min(m,n)·m·n/w)`, excellent for moderate `n`.

### 9.2 Cache behavior

The inverted-index update pattern is **scatter** — touching `index[e]` for each newly covered `e` jumps across memory. Sorting incidences by set (CSR-style storage) and processing a chosen set's elements contiguously improves locality; the gain array `gain[1..m]` is hot and stays in cache. Bitset greedy is **streaming**: it sweeps each set's words linearly, achieving near-peak memory bandwidth — the cache-friendliest variant when `n` is moderate.

### 9.3 Average-case

On **random instances** (each element placed in each set independently with probability `p`), greedy is typically far better than `ln n·OPT` — often within a small constant of OPT — because no adversary engineers the halving structure. For random instances above the coverage threshold, the first few sets already cover most of the universe, and the harmonic "tail" rarely materializes. The worst case is engineered (Section 4); the expected case is benign, which is why greedy is trusted in practice.

### 9.4 The price-distribution view

The proof's per-element prices `price(eₖ) ≤ OPT/(n−k+1)` describe a *decreasing* sequence: the first-covered elements pay little, the last-covered pay up to `OPT`. The harmonic sum is dominated by its tail (the last `O(1)` elements contribute `≈ OPT` each, the rest contribute `OPT·ln n` collectively). This is *why* the worst case forces the last handful of elements to be expensive — adversarial instances delay a few stubborn elements to the final, costly rounds.

---

### 9.5 The dual-fitting lower bound in detail

The dual-fitting argument (Section 6) deserves a fully explicit statement, since it is what lets a *solver* certify its own near-optimality.

**Claim.** Define `yₑ = price(e) / H(n)` for each element `e`, where `price(e)` is the cost-effectiveness ratio of the set that first covered `e`. Then `y` is feasible for the dual `max Σ yₑ s.t. Σ_{e∈Sᵢ} yₑ ≤ c(Sᵢ)`.

*Proof.* Fix a set `Sⱼ = {a₁, …, a_t}`, indexed so that `aₗ` is covered no earlier than `a_{ℓ+1}` (later-covered first). Just before `aₗ` is covered, all of `a₁, …, aₗ` are still uncovered, so at that moment `Sⱼ` itself has gain `≥ ℓ`, giving cost-effectiveness `c(Sⱼ)/ℓ`. Since greedy chose the *most* cost-effective set to cover `aₗ`, `price(aₗ) ≤ c(Sⱼ)/ℓ`. Therefore

```
Σ_{e∈Sⱼ} yₑ = (1/H(n)) Σ_{ℓ=1}^{t} price(aₗ)
            ≤ (1/H(n)) Σ_{ℓ=1}^{t} c(Sⱼ)/ℓ
            = (c(Sⱼ)/H(n)) · H(t)
            ≤ c(Sⱼ),
```

using `H(t) ≤ H(n)`. So `y` is dual-feasible. ∎

By weak LP duality, `Σₑ yₑ ≤ OPT_LP ≤ OPT`. And `Σₑ price(e) = cost(greedy)` (identity ♦), so `cost(greedy) = H(n)·Σₑ yₑ ≤ H(n)·OPT`. This reproves Theorem 3.1 *and* yields the emittable certificate `Σₑ yₑ` — a verifiable lower bound on OPT that the reference code in Section 13 returns.

### 9.6 Greedy as a special case of submodular cover

Set cover is the instance of **submodular cover** where the function is `f(𝓐) = |⋃𝓐|` and the target is `f(𝓢) = n`. The general result (Wolsey 1982): to cover a monotone submodular integer-valued function up to its maximum, greedy (pick max marginal gain per unit cost) achieves an `H(max marginal)`-approximation. For plain set cover, `max marginal = d` (largest set), recovering the `H(d)` bound. This framing explains why the *same* greedy and the *same* `H` analysis appear across set cover, dominating set, set multicover, and feature selection — they are all submodular cover with different `f`. It also delimits the technique: when `f` is **not** submodular, the `H` guarantee can fail entirely.

---

## 10. Space–Time Trade-offs

| Method | Time | Memory | Exactness | Notes |
|--------|------|--------|-----------|-------|
| Brute force | `O(2^m · n)` | `O(n)` | exact OPT | tiny `m` only |
| ILP solver (B&B) | exponential worst case | solver-dependent | exact OPT | practical for moderate `m` with good solvers |
| Naive greedy | `O(N · min(m,n))` | `O(N)` | `H(n)`-approx | simple; slow at scale |
| Inverted-index greedy | `O(N log m)` | `O(N + m)` | `H(n)`-approx | production default |
| Bitset greedy | `O(min(m,n)·m·n/w)` | `O(m·n/w)` | `H(n)`-approx | best for moderate `n` |
| LP + rounding | LP solve + `O(N)` | `O(N)` | `f`- or `O(log n)`-approx | gives `OPT_LP` certificate |
| Streaming greedy | `O(N)` one pass | `O(k log n)` or `O(n)` | `O(log n)`-approx | bounded memory, data streams |

The fundamental trade-off: **exactness costs exponential time (ILP/brute force); the `H(n)` approximation costs near-linear time.** Within approximation, the choice is memory (dense bitsets vs sparse index) and whether a certified lower bound (`OPT_LP`) is required.

---

## 11. Comparison with Alternatives

| Task | Greedy | Alternative | Asymptotics |
|------|--------|-------------|-------------|
| Min sets, general | `H(n)` greedy `O(N log m)` | ILP exact | exponential worst case |
| Min sets, frequency `f` | `H(n)` | LP frequency rounding | `f`-approx, `O(N)` after LP |
| Vertex cover (`f=2`) | `H(n)` (loose) | LP / matching | `2`-approx (better) |
| Min cost cover | weighted greedy `H(n)` | primal-dual | `f`-approx + dual certificate |
| Max coverage, budget `k` | greedy `1−1/e` | (none better) | tight |
| Want LP lower bound | dual-fitting (implicit) | LP relaxation | `OPT_LP` explicit |
| Geometric / interval cover | greedy | exact DP / sweep | poly-time exact for special structure |

The recurring theme: greedy is the **general-purpose** near-optimal method; LP rounding wins only when **frequency is low**, ILP wins only when **`m` is small enough** for exact solving, and **special structure** (intervals, trees, planar) can admit exact polynomial algorithms or PTASs that escape the `ln n` barrier.

---

## 12. Open Problems and Summary

### 12.1 Open / advanced directions

1. **Geometric set cover.** For ranges in the plane (disks, halfplanes, fat objects), the `ln n` barrier breaks: `O(1)`-approximations and PTASs exist via `ε`-nets and local search. Mapping the exact boundary of which geometric families admit `O(1)`-approximations is active.
2. **Online and dynamic set cover.** Sets/elements arrive over time; maintaining an `O(log n)`-competitive cover with few changes (recourse) is studied; tight bounds for fully-dynamic set cover are not all settled.
3. **Streaming set cover.** Minimizing passes and memory for an `O(log n)` (or better) approximation; the pass/memory/approximation trade-off frontier is partly open.
4. **Submodular cover generalizations.** Covering a monotone submodular function to a target value generalizes set cover; greedy gives `H` of the target, and the precise approximability of variants (cost, multiple constraints, non-monotone) is ongoing.
5. **Beyond `1−1/e` with extra structure.** For special submodular functions (coverage with bounded VC dimension, matroid constraints with continuous greedy) one can sometimes match or approach `1−1/e` under richer constraints; the limits are studied.
6. **Parallel / distributed greedy guarantees.** How close can distributed or low-adaptivity (parallel-round) greedy get to sequential greedy's factor? Recent adaptive-complexity results give `1−1/e−ε` in `O(log n)` rounds; closing constants is open.

### 12.2 Historical and complexity placement

| Result | Author(s), year | Significance |
|--------|-----------------|--------------|
| NP-completeness of set cover | Karp, 1972 | one of the original 21 NP-complete problems |
| Greedy `H(n)` analysis | Johnson 1974; Lovász 1975; Chvátal 1979 (weighted) | the `ln n` upper bound |
| Submodular `1 − 1/e` | Nemhauser–Wolsey–Fisher, 1978 | greedy for max coverage / submodular max |
| `ln n` inapproximability | Lund–Yannakakis 1994; Feige 1998 | greedy is essentially optimal |
| Tight `(1−o(1))ln n` under P≠NP | Dinur–Steurer, 2014 | sharpened hardness |
| Influence maximization | Kempe–Kleinberg–Tardos, 2003 | submodular coverage in networks |

The set-cover/max-coverage pair is the canonical illustration in approximation theory of a problem where a **trivial greedy algorithm exactly matches the best-possible polynomial guarantee** — `H(n)` for covering, `1−1/e` for budgeted coverage — with matching hardness proofs closing the gap from below.

### 12.3 Summary

- **Definitions.** Instance `(U, 𝓢)`, optional costs `c`, frequency `f`, max set size `d`, harmonic `H(k)`.
- **Theorem.** Greedy (pick min `c(S)/gain`) is an `H(n)`-approximation (sharper `H(d)`), proved by per-element price bounds `price(eₖ) ≤ OPT/(n−k+1)` summed into a harmonic series (Section 3) — equivalently dual fitting (Section 6).
- **Tightness.** Halving/partition instances force greedy to `(1−o(1))ln n·OPT` (Section 4).
- **Hardness.** Feige: no polynomial algorithm beats `(1−o(1))ln n` unless `P = NP` (Section 5), so greedy is optimal.
- **LP.** Relaxation gives `OPT_LP ≤ OPT`; integrality gap `Θ(log n)`; frequency rounding `f`-approx, randomized rounding `O(log n)`-approx (Sections 6–7).
- **Submodularity.** Coverage is monotone submodular; greedy max-coverage achieves the tight `1 − 1/e` (Section 8).
- **Complexity.** Near-linear `O(N log m)` with an inverted index; bitset and streaming variants for scale (Section 9).

Karp (1972) placed set cover among the hard problems; Johnson/Lovász/Chvátal (1970s) gave greedy's `H(n)` bound; Nemhauser et al. (1978) the submodular `1−1/e`; Feige (1998) proved both bounds essentially unbeatable. The result is the textbook example of an NP-hard optimization problem whose simplest heuristic is also its best efficient algorithm.

---

## 13. Reference Code (Greedy with Dual-Fitting Certificate)

Greedy weighted set cover that also emits a **dual certificate** `y` (the fitted prices scaled by `1/H(n)`), proving `Σ yₑ ≤ OPT` and hence `cost ≤ H(n)·OPT`. All three print the cover, its cost, and the dual lower bound. Verified on the worked instance: cover `[1, 2]`, cost `2`.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

// greedyWithDual returns the chosen sets, total cost, and a dual lower bound
// (sum of fitted prices / H(n)) which satisfies dualLB <= OPT <= cost.
func greedyWithDual(n int, sets [][]int, cost []float64) ([]int, float64, float64) {
	covered := make([]bool, n)
	numCovered := 0
	price := make([]float64, n)
	var chosen []int
	total := 0.0

	for numCovered < n {
		best := -1
		bestRatio := 0.0
		bestGain := 0
		for i, s := range sets {
			gain := 0
			for _, e := range s {
				if !covered[e] {
					gain++
				}
			}
			if gain == 0 {
				continue
			}
			ratio := cost[i] / float64(gain)
			if best == -1 || ratio < bestRatio {
				bestRatio, best, bestGain = ratio, i, gain
			}
		}
		if best == -1 {
			break // infeasible
		}
		chosen = append(chosen, best)
		total += cost[best]
		for _, e := range sets[best] {
			if !covered[e] {
				covered[e] = true
				numCovered++
				price[e] = cost[best] / float64(bestGain) // fitted price
			}
		}
	}
	// Dual lower bound: divide prices by H(n) to make them dual-feasible.
	Hn := 0.0
	for j := 1; j <= n; j++ {
		Hn += 1.0 / float64(j)
	}
	sumPrice := 0.0
	for _, p := range price {
		sumPrice += p
	}
	dualLB := sumPrice / math.Max(Hn, 1)
	return chosen, total, dualLB
}

func main() {
	sets := [][]int{{0, 1, 2}, {0, 1}, {2, 3}}
	cost := []float64{3, 1, 1}
	chosen, total, lb := greedyWithDual(4, sets, cost)
	fmt.Printf("cover=%v cost=%.0f dualLB=%.3f (lb<=OPT<=cost)\n", chosen, total, lb)
}
```

#### Java

```java
import java.util.*;

public class GreedyDual {
    static Object[] greedyWithDual(int n, int[][] sets, double[] cost) {
        boolean[] covered = new boolean[n];
        int numCovered = 0;
        double[] price = new double[n];
        List<Integer> chosen = new ArrayList<>();
        double total = 0.0;

        while (numCovered < n) {
            int best = -1, bestGain = 0;
            double bestRatio = 0.0;
            for (int i = 0; i < sets.length; i++) {
                int gain = 0;
                for (int e : sets[i]) if (!covered[e]) gain++;
                if (gain == 0) continue;
                double ratio = cost[i] / gain;
                if (best == -1 || ratio < bestRatio) { bestRatio = ratio; best = i; bestGain = gain; }
            }
            if (best == -1) break; // infeasible
            chosen.add(best);
            total += cost[best];
            for (int e : sets[best])
                if (!covered[e]) { covered[e] = true; numCovered++; price[e] = cost[best] / bestGain; }
        }
        double Hn = 0.0;
        for (int j = 1; j <= n; j++) Hn += 1.0 / j;
        double sumPrice = 0.0;
        for (double p : price) sumPrice += p;
        double dualLB = sumPrice / Math.max(Hn, 1);
        return new Object[]{chosen, total, dualLB};
    }

    public static void main(String[] args) {
        int[][] sets = {{0, 1, 2}, {0, 1}, {2, 3}};
        double[] cost = {3, 1, 1};
        Object[] r = greedyWithDual(4, sets, cost);
        System.out.printf("cover=%s cost=%.0f dualLB=%.3f%n", r[0], (double) r[1], (double) r[2]);
    }
}
```

#### Python

```python
def greedy_with_dual(n, sets, cost):
    """Greedy weighted set cover plus a dual lower bound (fitted prices / H(n)).
    Returns (chosen, total_cost, dual_lower_bound) with dual_lb <= OPT <= total_cost."""
    covered = [False] * n
    num_covered = 0
    price = [0.0] * n
    chosen, total = [], 0.0

    while num_covered < n:
        best, best_ratio, best_gain = -1, 0.0, 0
        for i, s in enumerate(sets):
            gain = sum(1 for e in s if not covered[e])
            if gain == 0:
                continue
            ratio = cost[i] / gain
            if best == -1 or ratio < best_ratio:
                best_ratio, best, best_gain = ratio, i, gain
        if best == -1:
            break  # infeasible
        chosen.append(best)
        total += cost[best]
        for e in sets[best]:
            if not covered[e]:
                covered[e] = True
                num_covered += 1
                price[e] = cost[best] / best_gain  # fitted price

    Hn = sum(1.0 / j for j in range(1, n + 1)) or 1.0
    dual_lb = sum(price) / Hn
    return chosen, total, dual_lb


if __name__ == "__main__":
    sets = [[0, 1, 2], [0, 1], [2, 3]]
    cost = [3, 1, 1]
    chosen, total, lb = greedy_with_dual(4, sets, cost)
    print(f"cover={chosen} cost={total:.0f} dualLB={lb:.3f}  (lb <= OPT <= cost)")
```

**What it does:** runs weighted greedy and simultaneously fits the LP-dual prices, emitting a lower bound `dualLB ≤ OPT`, so the result self-certifies `cost ≤ H(n)·OPT`.
**Run:** `go run main.go` | `javac GreedyDual.java && java GreedyDual` | `python greedy_dual.py`

### 13.1 Implementation notes

- **Fitted prices** record `cost(S)/gain` at the moment each element is covered; their sum equals the cover's cost (identity ♦). Dividing by `H(n)` makes them dual-feasible — a verifiable certificate.
- **Exact ratio comparison.** For integer costs/gains, compare `cᵢ·gⱼ` vs `cⱼ·gᵢ` to avoid floating-point mis-ordering of near-equal ratios.
- **Infeasibility.** Break when no set has positive gain while elements remain; report the uncovered set rather than returning a partial cover as if complete.
- **`H(d)` sharpening.** Use `H(min(n, d))` with `d` the max set size for a tighter (still valid) certificate scaling.
- **`n = 0`.** Empty universe is already covered; return an empty cover, cost 0, lower bound 0.

These five notes turn the textbook snippet into a kernel that both solves *and* certifies the bound it claims.

### 13.2 Reading the certificate

The returned `dualLB` satisfies `dualLB ≤ OPT ≤ cost`. Two consequences a caller can act on:

- **Optimality gap.** `cost / dualLB` is an upper bound on `cost / OPT`. If it prints `1.0`, the cover is *provably optimal* on this instance (greedy got lucky); if it prints `1.4`, you are within 40% of optimal, certified — without ever solving the NP-hard problem exactly.
- **Trust without an LP solver.** Because `dualLB` comes from dual fitting (Section 9.5), no LP library is needed; the certificate is a byproduct of the same `O(N)` pass. This is what makes greedy attractive in environments where pulling in an LP solver is impractical but a near-optimality guarantee is still required.

The combination — a fast greedy primal solution and a self-computed dual lower bound — is the practical embodiment of the theory in Sections 3 and 6: an NP-hard problem solved approximately *and* certified, in near-linear time, with thirty lines of code.
</content>
