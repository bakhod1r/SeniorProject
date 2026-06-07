# MinHash — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Collision Theorem: P(minhash(A) = minhash(B)) = Jaccard(A,B)
3. The Estimator: Unbiasedness
4. Variance of the Estimator
5. Concentration: Chernoff/Hoeffding Bounds on k
6. Permutations vs Hash Functions; Min-wise Independence
7. The Estimator for Bottom-k and One-Permutation MinHash
8. LSH Banding: the S-curve and Optimal (b, r)
9. Comparison to SimHash (Sign Random Projections)
10. Complexity Analysis
11. Summary

---

## 1. Formal Definitions

Let `U` be a finite universe of elements, and `A, B ⊆ U` two sets. Let `h : U → [0, 1)` (or, in practice, `U → {0, …, M−1}`) be a hash function we model as assigning each element an **independent uniform** value, all values distinct almost surely (ties broken arbitrarily; collisions are negligible for large range `M`).

**Definition 1.1 (Jaccard similarity).** `J(A, B) = |A ∩ B| / |A ∪ B|`, with the convention `J(∅, ∅) = 1`. `J ∈ [0, 1]`.

**Definition 1.2 (MinHash under `h`).** `h_min(A) = min_{x ∈ A} h(x)`, the element value attaining the minimum being `argmin_{x∈A} h(x)`.

**Definition 1.3 (Signature).** Given `k` independent hash functions `h_1, …, h_k`, the signature of `A` is `sig(A) = ( h_min^{(1)}(A), …, h_min^{(k)}(A) )`.

**Definition 1.4 (Agreement indicator and estimator).** For two signatures, `X_i = 𝟙[ sig_A[i] = sig_B[i] ]`, and the estimator
```
Ĵ = (1/k) Σ_{i=1}^k X_i.
```

**Definition 1.5 (Min-wise independent family).** A family `H` of permutations (or hash functions) over `U` is **min-wise independent** if for every `S ⊆ U` and every `x ∈ S`,
```
Pr_{h ∈ H}[ argmin_{y∈S} h(y) = x ] = 1/|S|,
```
i.e. every element of `S` is equally likely to be the minimum. This is the exact property the collision theorem requires.

**Standing assumptions.** `h` is drawn from a min-wise independent family (idealized as a uniform random permutation of `U`); `A ∪ B ≠ ∅`; range `M` is large enough that hash collisions among distinct elements are negligible. Section 6 quantifies what changes when `H` is only *approximately* min-wise independent (e.g. 2-universal affine hashes).

**Remark (permutation view vs hash view).** Classically (Broder) MinHash uses a random **permutation** `π` of `U` and defines `π_min(A) = min_{x∈A} π(x)`. Drawing a uniform `π` is the cleanest model for the proof, but storing a permutation of a huge universe is infeasible, so in practice a hash function `h` *imitates* `π`: if `h` is injective on `A∪B` with uniform-looking values, the *relative order* it induces on `A∪B` is a uniformly random ordering — exactly what the permutation model needs. The two views are interchangeable for the collision theorem; the hash view is what code uses, the permutation view is what proofs use. The only gap (hash collisions, finite range) is the `O(1/M)` correction quantified in Section 6.

**Definition 1.6 (Hash-collision negligibility).** With `h : U → {0,…,M−1}` uniform, the probability two distinct elements of `A∪B` (size `u`) share a hash value is `≤ (u choose 2)/M` by the birthday bound. For `u ≤ 10⁶` and `M = 2⁶⁴`, this is `< 2^{−24}` — negligible. When it *does* occur, a tie at the minimum can spuriously equalize or split minima; large `M` makes this vanish, which is why 64-bit (or larger) hash ranges are standard.

**Notation summary.** Throughout: `U` = universe; `A, B ⊆ U` the two sets; `u = |A∪B|`; `J = J(A,B)`; `h, h_1,…,h_k` hash functions; `k` the signature length; `X_i` the slot-`i` agreement indicator; `Ĵ = (1/k)ΣX_i` the estimator; `ε` an error tolerance; `δ` a failure probability; `M` the hash range; `b, r` the LSH bands and rows with `k = b·r`; `S(J) = 1 − (1−J^r)^b` the candidate (S-curve) probability; `θ` an angle (SimHash); `ρ` the LSH quality exponent. "Slot" = one signature coordinate; "collision" = two minima being equal; "candidate" = a pair sharing an LSH band bucket.

**Roadmap of results.** Section 2 proves the collision identity; Sections 3–4 derive the unbiased estimator and its variance; Section 5 gives concentration (how to pick `k`); Section 6 addresses the gap between idealized and real hash families; Section 7 covers the bottom-k and one-permutation variants; Section 8 lifts the per-slot probability into the LSH S-curve; Section 9 contrasts SimHash and frames everything as LSH families; Section 10 collects complexity and optimality. The single thread connecting all of them is Theorem 2.1.

---

## 2. The Collision Theorem

**Theorem 2.1 (Broder).** For sets `A, B` with `A ∪ B ≠ ∅` and `h` drawn from a min-wise independent family,
```
Pr[ h_min(A) = h_min(B) ] = J(A, B) = |A ∩ B| / |A ∪ B|.
```

**Proof.** Consider the combined set `S = A ∪ B`, with `|S| = u = |A ∪ B|`. Let `e* = argmin_{x∈S} h(x)` be the element of `S` with the smallest hash value. By min-wise independence (Def. 1.5), `e*` is uniform over `S`: `Pr[e* = x] = 1/u` for each `x ∈ S`.

Now observe two facts about the minima of the subsets `A` and `B`:

- `h_min(A) = h(argmin_{x∈A} h(x))`, the smallest hash among `A`'s elements; similarly for `B`.
- Since `A, B ⊆ S`, the global minimizer `e*` of `S` is also the minimizer of whichever of `A, B` contain it.

**Claim:** `h_min(A) = h_min(B)` **if and only if** `e* ∈ A ∩ B`.

*(⇐)* If `e* ∈ A ∩ B`, then `e*` has the smallest hash in all of `S ⊇ A` and `S ⊇ B`, so it is simultaneously the minimizer of `A` and of `B`. Hence `h_min(A) = h(e*) = h_min(B)`.

*(⇒)* Suppose `e* ∉ A ∩ B`. Then `e*` lies in exactly one of `A \ B` or `B \ A` (it must lie in `S = A ∪ B`). WLOG `e* ∈ A \ B`. Then `h_min(A) = h(e*)` (it is the global minimum, so certainly the minimum of `A`). But `e* ∉ B`, and `h(e*)` is strictly smaller than every other hash in `S ⊇ B`, so no element of `B` attains `h(e*)`; thus `h_min(B) > h(e*) = h_min(A)`, giving `h_min(A) ≠ h_min(B)`. (Distinctness of hash values rules out ties.)

Therefore
```
Pr[ h_min(A) = h_min(B) ] = Pr[ e* ∈ A ∩ B ] = |A ∩ B| / |S| = |A ∩ B| / |A ∪ B| = J(A,B).
```
∎

This is the entire foundation: a single MinHash slot is a Bernoulli trial whose success probability is *exactly* the Jaccard. Everything in this file flows from Theorem 2.1.

**Corollary 2.2.** `E[X_i] = Pr[X_i = 1] = J(A,B)` for each slot `i`.

### 2.1 Worked Trace of the Collision Event

Take `A = {1,2,3,4}`, `B = {2,3,5}`, so `A∪B = {1,2,3,4,5}` (`u=5`) and `A∩B = {2,3}`. Suppose a random hash assigns ranks (smallest = the minimum):

```
element:  1    2    3    4    5
rank h:   0.81 0.12 0.47 0.93 0.30
```

The global minimum over `A∪B` is element `2` (rank `0.12`), which lies in `A∩B`. Then `h_min(A) = h(2) = 0.12` (element `2` is in `A`) and `h_min(B) = h(2) = 0.12` (element `2` is in `B`) — **collision**, as Theorem 2.1 predicts whenever `e* ∈ A∩B`. Now reshuffle so that element `1` (in `A` only) is the global minimum:

```
element:  1    2    3    4    5
rank h:   0.05 0.62 0.47 0.93 0.30
```

Now `h_min(A) = h(1) = 0.05` but `1 ∉ B`, so `h_min(B) = min(h(2),h(3),h(5)) = min(0.62,0.47,0.30) = 0.30` — **no collision**, again matching the theorem (`e* ∈ A\B`). Across all `5! ` orderings the fraction with a collision is exactly `|A∩B|/u = 2/5 = J`, the verifiable instance of Theorem 2.1.

### 2.2 The Containment (Asymmetric) Variant

A related quantity is **containment** `C(A,B) = |A∩B|/|A|` (how much of `A` is inside `B`). MinHash also estimates it: with bottom-k sketches one can recover `C` from `J` and the cardinalities via `|A∩B| = J·|A∪B|` and `|A∪B| = |A|+|B|−|A∩B|`. This is the basis of **containment search** (e.g. "which large documents contain this small query set") and shows the collision identity is the hub from which several similarity functionals are derived.

---

## 3. The Estimator: Unbiasedness

**Theorem 3.1.** `Ĵ = (1/k) Σ X_i` is an **unbiased** estimator of `J = J(A,B)`: `E[Ĵ] = J`.

**Proof.** By linearity of expectation and Corollary 2.2,
```
E[Ĵ] = (1/k) Σ_{i=1}^k E[X_i] = (1/k) Σ_{i=1}^k J = (1/k)(kJ) = J.
```
∎

Unbiasedness holds for **every** `k ≥ 1`; the choice of `k` affects only the spread (Section 4), never the center. Note that unbiasedness needs only `E[X_i] = J` (Corollary 2.2), which needs only min-wise independence of each individual `h_i` — *not* independence across `i`. Independence across the `k` functions is required for the *variance* result, not for unbiasedness.

### 3.1 Consistency and Efficiency

`Ĵ` is **consistent**: as `k → ∞`, `Ĵ → J` almost surely (strong law of large numbers on the i.i.d. `X_i`). It is also the **maximum-likelihood estimator** of the success probability of a Bernoulli sample (the sample proportion), and by the Cramér–Rao bound the variance `J(1−J)/k` is the minimum achievable for *any* unbiased estimator from `k` independent `Bernoulli(J)` slots — so MinHash's estimator is not just unbiased but **efficient**: no cleverer post-processing of the same `k` slots can reduce its variance. The only way to do better is to *change the sketch* (e.g. b-bit's adjusted estimator trades a known bias correction for storage, not variance).

### 3.2 What Unbiasedness Does Not Give You

Unbiasedness is about the *average* over infinitely many random seeds; for a *single fixed* signature, `Ĵ` is a specific number that may be off by up to `O(1/√k)`. In production each pair is estimated *once* with *one* fixed hash family, so the relevant guarantee is the **concentration** bound (Section 5), not unbiasedness per se. The two together — "right on average, and tightly concentrated for a given `k`" — are what justify trusting a single signature's estimate.

---

## 4. Variance of the Estimator

**Theorem 4.1.** If `h_1, …, h_k` are independent (so `X_1, …, X_k` are i.i.d. `Bernoulli(J)`), then
```
Var(Ĵ) = J(1 − J) / k,    and    SE(Ĵ) = √(J(1−J)/k) ≤ 1/(2√k).
```

**Proof.** Each `X_i ∼ Bernoulli(J)` has `Var(X_i) = J(1−J)`. By independence,
```
Var(Ĵ) = Var( (1/k) Σ X_i ) = (1/k²) Σ Var(X_i) = (1/k²) · k · J(1−J) = J(1−J)/k.
```
Since `J(1−J)` is maximized at `J = 1/2` with value `1/4`, `SE(Ĵ) = √(J(1−J)/k) ≤ √(1/(4k)) = 1/(2√k)`. ∎

**Corollary 4.2 (the `O(1/√k)` rule).** The standard error decays like `1/√k`: to halve the error, quadruple `k`. The error is *largest near `J = 1/2`* and *smallest near `J ∈ {0, 1}`* — MinHash is most precise on the highly-similar or highly-dissimilar pairs that dedup systems care about.

**Remark (effect of dependence).** If the `h_i` are positively correlated (e.g. derived from one hash with weak mixing), `Cov(X_i, X_j) > 0` and `Var(Ĵ) = J(1−J)/k + (1/k²) Σ_{i≠j} Cov(X_i, X_j) > J(1−J)/k`. The estimator stays unbiased but converges slower than `1/√k` — the quantitative cost of reusing weak hashes.

### 4.1 Mean Squared Error and Confidence Intervals

Because `Ĵ` is unbiased, its **mean squared error** equals its variance: `MSE(Ĵ) = Var(Ĵ) = J(1−J)/k`. For inference, the central limit theorem applies (sum of `k` i.i.d. bounded variables), so for large `k`:

```
Ĵ ≈ Normal( J, J(1−J)/k ),
```

and an approximate `(1−α)` confidence interval is `Ĵ ± z_{α/2} · √(Ĵ(1−Ĵ)/k)` (plugging in `Ĵ` for the unknown `J`, a Wald interval). For `k = 400`, `Ĵ = 0.5`: half-width `1.96·√(0.25/400) = 1.96·0.025 ≈ 0.049`, i.e. a 95% CI of about `±0.05`. For small `Ĵ` near `0` or `1`, prefer a Wilson or Clopper–Pearson interval, since the Wald interval is poor at the boundary — the same caveat as any binomial-proportion estimate.

### 4.2 The Variance Profile Across J

| `J` | `J(1−J)` | `Var` at `k=256` | `SE` |
|----:|---------:|-----------------:|-----:|
| 0.05 | 0.0475 | 0.000186 | 0.0136 |
| 0.20 | 0.16 | 0.000625 | 0.0250 |
| 0.50 | 0.25 | 0.000977 | 0.0313 |
| 0.80 | 0.16 | 0.000625 | 0.0250 |
| 0.95 | 0.0475 | 0.000186 | 0.0136 |

The variance is a downward parabola in `J`, peaking at `0.5`. The practical reading: a dedup system thresholding at `J ≥ 0.9` operates in the *low-variance* regime, so a moderate `k` already gives tight estimates exactly where the decision boundary sits.

---

## 5. Concentration: Chernoff/Hoeffding Bounds on k

Variance bounds the *typical* error; for a *high-probability* guarantee use concentration inequalities on the sum `Y = Σ X_i = k·Ĵ`, a sum of `k` independent `Bernoulli(J)` with `μ = E[Y] = kJ`.

**Theorem 5.1 (Hoeffding).** For independent `X_i ∈ [0,1]` and any `ε > 0`,
```
Pr[ |Ĵ − J| ≥ ε ] ≤ 2 · exp(−2 k ε²).
```

**Proof.** Hoeffding's inequality for the average of `k` independent variables bounded in `[0,1]` gives `Pr[ |Ĵ − E[Ĵ]| ≥ ε ] ≤ 2 exp(−2kε²)`; substitute `E[Ĵ] = J`. ∎

**Corollary 5.2 (sample size).** To guarantee `Pr[|Ĵ − J| ≥ ε] ≤ δ`, it suffices that
```
2 exp(−2kε²) ≤ δ   ⟺   k ≥ (1/(2ε²)) · ln(2/δ).
```
Example: `ε = 0.05`, `δ = 0.01` → `k ≥ (1/0.005)·ln 200 ≈ 200 · 5.298 ≈ 1060`.

**Theorem 5.3 (Multiplicative Chernoff).** For `Y = Σ X_i`, `μ = kJ`, and `0 < γ ≤ 1`,
```
Pr[ Y ≥ (1+γ)μ ] ≤ exp(−μγ²/3),    Pr[ Y ≤ (1−γ)μ ] ≤ exp(−μγ²/2).
```

**Use.** When `J` is small (the common case for "are these two unrelated?"), the multiplicative bound is sharper than the additive Hoeffding bound: it controls *relative* error and shows that even modest `k` drives the probability of badly over/under-estimating a small `J` to be exponentially small in `μ = kJ`. Combined, Hoeffding (absolute error, any `J`) and Chernoff (relative error, small `J`) give the full picture of how `k` controls reliability.

### 5.0 Worked Bound Comparison

Take `J = 0.85` (a dedup threshold), `k = 128`, `ε = 0.05`. Hoeffding: `Pr[|Ĵ−0.85| ≥ 0.05] ≤ 2e^{−2·128·0.0025} = 2e^{−0.64} ≈ 1.05` — *vacuous* (the additive bound is weak at moderate `k`). Now the variance/CLT view: `SE = √(0.85·0.15/128) = √(0.000996) ≈ 0.0316`, so `ε = 0.05` is `1.58·SE`, giving tail `≈ 2·(1−Φ(1.58)) ≈ 2·0.057 = 0.114` — about an 11% chance of exceeding `±0.05`, far tighter than Hoeffding admits. Lesson: Hoeffding is a *worst-case* (`J=0.5`-flavored) bound; the actual reliability near `J=0.85` is much better because the variance `J(1−J)` is small there. For a guaranteed `±0.05` at this `J`, the variance formula recommends `k ≈ (1.96/0.05)²·0.85·0.15 ≈ 196` for 95% — a sharper budget than Hoeffding's conservative `~1060`.

**Theorem 5.4 (Union bound over many pairs).** To estimate `J` for all `(N choose 2)` pairs within `ε` simultaneously with probability `≥ 1 − δ`, set per-pair failure `δ' = δ / (N choose 2)`; then `k ≥ (1/(2ε²)) ln(2 (N choose 2)/δ) = O(ε^{−2} log(N/δ))`. The `log N` price for simultaneous control over all pairs is mild — `k` grows only logarithmically in the corpus size.

**Proof.** Apply Theorem 5.1 to each of the `m = (N choose 2)` pairs with tolerance `ε`, then union-bound the failure events: `Pr[∃ pair with |Ĵ−J| ≥ ε] ≤ m · 2e^{−2kε²}`. Requiring this `≤ δ` gives `e^{−2kε²} ≤ δ/(2m)`, i.e. `k ≥ ln(2m/δ)/(2ε²)`. Since `ln(2m/δ) = O(log N + log(1/δ))`, the claim follows. ∎

**Corollary 5.5 (median-of-means amplification).** An alternative to a single large `k` is to compute `t` independent estimators each with modest `k₀` and take their **median**. By a Chernoff argument on the count of "good" estimators, the median is within `ε` of `J` with probability `≥ 1 − e^{−Ω(t)}` whenever each estimator is within `ε` with probability `≥ 2/3` (i.e. `k₀ = O(ε^{−2})`). Total work `t·k₀ = O(ε^{−2} log(1/δ))` matches the direct bound but is more robust to heavy-tailed per-estimator behavior — a standard "median-of-means" boost used across randomized sketches.

---

## 6. Permutations vs Hash Functions; Min-wise Independence

The idealized analysis (Sections 2–5) assumes `h` is a **uniform random permutation** of `U`, equivalently a perfectly min-wise independent family (Def. 1.5). In practice we use hash functions, which only approximate this.

**Definition 6.1 (ε-approximate min-wise independence).** `H` is `ε`-approximately min-wise independent if for all `S, x ∈ S`,
```
| Pr_{h}[ argmin_{y∈S} h(y) = x ] − 1/|S| | ≤ ε/|S|.
```

**Theorem 6.2 (Broder–Charikar–Frieze–Mitzenmacher, lower bound).** Any *exactly* min-wise independent family of hash functions on `U` with `|U| = u` requires functions describable by `Ω(u)` bits in the worst case — exact min-wise independence is expensive.

**Consequence.** We use **approximately** min-wise independent families. Two practical choices:

- **k-universal / fully random (idealized):** treat each `h_i` as independent uniform. Clean theory; achieved approximately by strong hashes (xxHash/Murmur) seeded `k` ways.
- **2-universal affine `h(x) = ((a x + b) mod p) mod M`:** cheap, but only *pairwise* independent. The minimum's distribution is then only approximately uniform; the bias in `Pr[X_i = 1]` is `O(1/M)`-small for large prime `p` and range `M`, but `X_i` across slots may carry mild correlation if the `(a_i,b_i)` are not well separated.

**Theorem 6.3 (effect of `ε`-approximation).** Under `ε`-approximate min-wise independence, `|E[X_i] − J| ≤ ε`, so `|E[Ĵ] − J| ≤ ε` — the estimator is *nearly* unbiased with bias at most `ε`. Thus a good hash family (small `ε`) keeps both the bias (`≤ ε`) and the variance (`≈ J(1−J)/k`) controlled; the engineering rule "use a strong base hash" is exactly the statement "make `ε` negligible."

This is the formal gap behind the senior-level caution: affine hashes are fine in practice but the pristine `Bernoulli(J)` analysis assumes full randomness; validate variance empirically when correctness is critical.

### 6.1 Why 2-Universal Is Usually Enough

A 2-universal family guarantees `Pr[h(x)=h(y)] ≤ 1/M` and pairwise-uniform values, but *not* that the minimum is uniform over a set. Indyk (1999) showed that **`O(log(1/ε))`-wise independence** suffices for `ε`-approximate min-wise independence — far less than full independence. In practice, a single strong avalanche hash (xxHash/Murmur) behaves close to fully random on realistic inputs, so the empirical bias is tiny. The theoretical hierarchy is:

```
fully random  ⊃  k-wise independent  ⊃  ε-approx min-wise  ⊃  2-universal
(ideal)          (Indyk: log(1/ε)-wise ⇒ approx min-wise)        (cheapest, weakest)
```

The engineering takeaway: do not build MinHash directly on a raw 2-universal affine of the *element* — first push elements through a strong mixing hash, *then* apply cheap affine transforms or binning to that well-mixed value. The mixing supplies the near-independence the theory wants; the affine/binning supplies the `k` cheap variations.

### 6.2 The Cost of Exact Min-wise Independence

Theorem 6.2's `Ω(u)` lower bound is striking: to be *exactly* min-wise independent over a universe of size `u`, a family essentially needs to encode arbitrary permutations, costing `Ω(u)` bits per function. This is why no production system uses exact min-wise hashing — it would defeat the entire point of a compact sketch. Approximate families with bias `ε` cost only `O(log u · log(1/ε))` bits (a few machine words), and the resulting `≤ ε` bias on `E[Ĵ]` is dwarfed by the `O(1/√k)` sampling error for any reasonable `k`. So the *statistical* error (variance) dominates the *systematic* error (hash-family bias), and `k`, not hash exactness, is the lever that matters.

---

## 7. The Estimator for Bottom-k and One-Permutation MinHash

The k-hash estimator (Section 3) is not the only unbiased one. Two important variants:

**Bottom-k (KMV).** Use *one* hash `h`; let `L_A` be the `k` smallest values of `{h(x) : x ∈ A}`, similarly `L_B`. Let `L = ` the `k` smallest values of `L_A ∪ L_B` (the `k` smallest of `A ∪ B` under `h`). Estimate
```
Ĵ_btm = |L ∩ L_A ∩ L_B| / |L| = (#{v ∈ L : v ∈ L_A and v ∈ L_B}) / k.
```

**Theorem 7.1.** `Ĵ_btm` is an unbiased estimator of `J` with variance `≈ J(1−J)/k` to leading order (asymptotically matching the k-hash estimator), at the cost of **one** hash per element instead of `k`.

*Proof idea.* The `k` smallest values of `A ∪ B` correspond to `k` uniformly random elements of `A ∪ B` (the order statistics of a random hash). Each such element lies in `A ∩ B` with probability `J` independently to leading order, so the count of those also in both `L_A, L_B` is `≈ Binomial(k, J)`, giving mean `kJ` and variance `kJ(1−J)`. Dividing by `k` yields the claim. (Exact finite-sample corrections are `O(1/u)`.) ∎

**Why bottom-k is one hash, not `k`.** The crucial efficiency win: k-hash recomputes `k` independent minima, touching every element `k` times. Bottom-k takes the `k` order statistics of a *single* hash, touching every element *once* and maintaining a size-`k` heap. The `k` order statistics of one random permutation play the same role as `k` independent first-order statistics — they are `k` uniform samples *without replacement* from `A∪B`, which has the same leading-order behavior as the with-replacement k-hash sampling but with a slightly *smaller* variance (the finite-population correction `(u−k)/(u−1)`), making bottom-k marginally more accurate than k-hash for the same `k` when `k` is a non-trivial fraction of `u`.

KMV doubly serves as a **distinct-count** estimator: if `v_{(k)}` is the `k`-th smallest hash normalized to `[0,1)`, then `(k−1)/v_{(k)}` is an unbiased estimator of `|A|` — a separate use of the same sketch.

**One-permutation MinHash (OPH).** Hash each element once with `h`, partition the range `[0, M)` into `k` equal bins, and set slot `i` to the minimum hash in bin `i` (or "empty"). Build cost `O(n + k)`.

**Theorem 7.2 (OPH with densification, Shrivastava–Li).** Naive OPH is biased because *empty* bins (no element fell there) cannot be compared. With proper **densification** — filling each empty bin by copying the value of the nearest non-empty bin under a fixed deterministic rule (with an offset to preserve independence) — the resulting `X_i` again satisfy `E[X_i] = J`, so `Ĵ_OPH` is unbiased, with variance approaching `J(1−J)/k` as the expected bin occupancy grows.

*Why densification preserves unbiasedness.* An empty bin in *both* signatures is filled from the same source bin by the same rule, so the collision probability of the filled slot still equals `J`; the offset prevents systematically inflating agreement. The detailed argument (one-permutation + optimal densification) shows the variance penalty vanishes as `n ≫ k`. ∎

| Estimator | hashes/elem | build | bias | variance (leading) | extra capability |
|-----------|-------------|-------|------|--------------------|------------------|
| k-hash | `k` | `O(nk)` | 0 (idealized) | `J(1−J)/k` | — |
| bottom-k | 1 | `O(n log k)` | 0 | `≈ J(1−J)/k` | cardinality estimate |
| OPH + densify | 1 | `O(n+k)` | 0 (after densify) | `≈ J(1−J)/k` for `n≫k` | fastest build |

### 7.1 Worked OPH Densification

Let the hash range be `[0, 1)` split into `k = 4` bins `[0,.25), [.25,.5), [.5,.75), [.75,1)`. Set `A` has element hashes `{0.10, 0.31, 0.92}`:

```
bin 0: {0.10}  -> min 0.10
bin 1: {0.31}  -> min 0.31
bin 2: {}      -> EMPTY
bin 3: {0.92}  -> min 0.92
sig(A) = [0.10, 0.31, ∅, 0.92]
```

Bin 2 is empty. **Densification** fills it deterministically: scan circularly to the next non-empty bin (bin 3) and copy its value with a fixed per-bin offset that the *same rule* applies to both signatures being compared. So `sig(A)[2] ← value derived from bin 3`. If `B` also has bin 2 empty, `B`'s densified slot 2 derives from `B`'s same circular neighbor under the identical rule, so the two filled slots collide with the correct probability `J`. The offset prevents the empty bin from *always* echoing its neighbor (which would inflate agreement). Optimal densification (Shrivastava 2017) shows the resulting variance matches k-hash up to `O(k/n)` terms.

### 7.2 Weighted MinHash

For **multisets / weighted sets** (element `x` has weight `w_x ≥ 0`), the generalization is **weighted Jaccard** `J_W(A,B) = Σ_x min(w_x^A, w_x^B) / Σ_x max(w_x^A, w_x^B)`. **Consistent Weighted Sampling** (Ioffe 2010) produces a hash whose collision probability equals `J_W`, by sampling `(element, "active interval")` pairs proportional to weight so that the argmin is consistent under weight changes. This extends MinHash from set overlap to weighted-feature overlap (e.g. term-frequency vectors) while keeping the collision-probability-equals-similarity property — the bridge between plain MinHash and weighted retrieval, and an alternative to SimHash for weighted data when the *weighted Jaccard* (not cosine) is the desired metric.

### 7.3 b-bit MinHash Estimator Correction

Storing only the low `b` bits of each slot introduces *random* agreement: two unrelated slots agree on their low `b` bits with probability `2^{−b}` even when their full values differ. Let `p_b` be the observed fraction of `b`-bit-slot agreements. The expected agreement is `E[p_b] = J + (1−J)·2^{−b}` (true collisions, prob `J`, always agree; non-collisions, prob `1−J`, agree by chance with prob `2^{−b}`). Inverting gives the **unbiased b-bit estimator**:

```
Ĵ_b = (p_b − 2^{−b}) / (1 − 2^{−b}).
```

Its variance inflates by a factor `≈ 1/(1 − 2^{−b})²` over full-width MinHash — small for `b ≥ 2`, modest for `b = 1` (factor `4`, i.e. you need ~`4×` more slots to match accuracy, but each slot is `64×` smaller, a net `~16×` space win). This precise bias-correction is why b-bit MinHash is sound, not a hack: the random-agreement term is *exactly* `2^{−b}` and subtracts out.

---

## 8. LSH Banding: the S-curve and Optimal (b, r)

Signatures of length `k = b·r` are split into `b` bands of `r` rows. Two signatures are a **candidate pair** iff they agree on *all `r` rows of at least one band*.

**Theorem 8.1.** For sets with Jaccard `J` (so per-slot agreement probability `J`),
```
Pr[ agree on a fixed band of r rows ] = J^r,
Pr[ NOT a candidate ] = (1 − J^r)^b,
Pr[ candidate pair ] = 1 − (1 − J^r)^b  =: S(J).
```

**Proof.** Under the per-slot `Bernoulli(J)` model with independence across slots, a band of `r` rows matches with probability `J^r` (all `r` must agree). The `b` bands are independent (disjoint slots), so the probability *no* band matches is `(1 − J^r)^b`; the complement is the candidate probability. ∎

**Properties of the S-curve.**

- `S` is increasing in `J`, with `S(0) = 0`, `S(1) = 1`.
- It has a sharp **threshold** near `J* ≈ (1/b)^{1/r}` where the curve's slope is maximal; below `J*` candidacy is rare, above it nearly certain. (Setting `(J*)^r = 1/b` makes `(1 − J^r)^b ≈ e^{−1}`, the inflection neighborhood.)
- Increasing `r` (more rows/band) **raises** the threshold (favors precision: fewer false candidates). Increasing `b` (more bands) **lowers** it (favors recall). With `k = b·r` fixed, `(b, r)` slides the threshold.

**Theorem 8.2 (tuning).** Given a target threshold `t` (report pairs with `J ≥ t`), choose `(b, r)` with `b·r = k` and `(1/b)^{1/r} ≈ t`. Recall at `J = t` is `≈ 1 − e^{−1} ≈ 0.63`; choosing `t` slightly below the true cutoff and using more bands sharpens recall toward `1`. The expected number of *false* candidates scales with `Σ_{pairs J < t} S(J)`, controlled by the steepness (large `r`).

This is the precise statement of why MinHash signatures must be *banded* to scale: the S-curve converts a smooth similarity into a near-step membership test, making candidate generation sublinear. Full treatment: [`../10-locality-sensitive-hashing`](../10-locality-sensitive-hashing).

### 8.1 Worked S-curve Table

Take `k = 20`, `b = 5` bands, `r = 4` rows. Threshold `(1/b)^{1/r} = (1/5)^{1/4} ≈ 0.669`. Evaluate `S(J) = 1 − (1 − J^4)^5`:

| `J` | `J^4` | `(1−J^4)^5` | `S(J) = candidate prob` |
|----:|------:|------------:|------------------------:|
| 0.3 | 0.0081 | 0.960 | 0.040 |
| 0.5 | 0.0625 | 0.725 | 0.275 |
| 0.669 | 0.200 | 0.328 | 0.672 |
| 0.8 | 0.410 | 0.072 | 0.928 |
| 0.9 | 0.656 | 0.0042 | 0.996 |

The curve is shallow below `0.5`, crosses ~`0.67` at the inflection, and is nearly `1` by `0.8` — the step-like behavior that makes "report pairs with `J ≳ 0.7`" cheap. Re-banding the same `k=20` as `b=4, r=5` raises the threshold to `(1/4)^{1/5} ≈ 0.758` (more precision); as `b=10, r=2` it drops to `(1/10)^{1/2} ≈ 0.316` (more recall). Same signatures, different operating point — the engineering knob is `(b,r)`, never the signatures.

### 8.2 Expected Candidate Count

For a corpus with pair-Jaccard distribution `D`, the expected number of candidate pairs is `Σ_{pairs} S(J_{pair}) ≈ (N choose 2) · E_{D}[S(J)]`. Splitting into "true" pairs (`J ≥ t`) and "noise" pairs (`J < t`): true pairs contribute recall `≈ S(t)` each (want near `1`), noise pairs contribute false candidates `≈ S(J)` each (want near `0`). Because the bulk of `(N choose 2)` pairs have tiny `J`, and `S` is `≈ J^r·b` for small `J`, the false-candidate load scales with `b·E[J^r]` — increasing `r` crushes it super-linearly. This is the quantitative reason precision is controlled by **rows** and recall by **bands**.

---

## 9. Comparison to SimHash (Sign Random Projections)

MinHash estimates **Jaccard** of sets; **SimHash** (Charikar's sign random projections) estimates **cosine** of vectors. Both are LSH sketches, but for different metrics.

**SimHash definition.** For a vector `v ∈ ℝ^d` and a random hyperplane normal `w ∼ N(0, I_d)`, the bit is `sign(⟨w, v⟩)`. A SimHash fingerprint is `b` such bits from `b` random `w`.

**Proof of Theorem 9.1 (sketch).** Two vectors `u, v` span a 2D plane; the random hyperplane `w` separates them iff its projection onto that plane falls in the angular wedge between `u` and `v`. By rotational symmetry of the Gaussian, the projected direction is uniform on the circle, so the probability the hyperplane lands in the wedge of angle `θ` is `θ/π`. Hence `Pr[sign⟨w,u⟩ ≠ sign⟨w,v⟩] = θ/π`, and bit agreement is `1 − θ/π`. This is the exact cosine analogue of Theorem 2.1's `Pr[collision] = J`: in both, a single random projection's "match" probability is a monotone function of the target similarity. ∎

**Theorem 9.1 (Goemans–Williamson / Charikar).** For vectors `u, v` with angle `θ = arccos( ⟨u,v⟩ / (‖u‖‖v‖) )`,
```
Pr[ sign(⟨w,u⟩) ≠ sign(⟨w,v⟩) ] = θ / π,
so   Pr[ bits agree ] = 1 − θ/π.
```

Thus the *bit-agreement probability* of SimHash is a (linear-in-angle) function of cosine similarity, exactly as MinHash's *slot-collision probability* equals Jaccard.

**Theorem 9.2 (no cross-substitution).** MinHash's collision probability `J` cannot in general be matched by any cosine-based sketch, and vice versa, because Jaccard and cosine are *different* set/vector functionals (e.g. duplicating an element changes cosine of the multiset representation but not Jaccard of the set). Choosing the sketch is choosing the metric.

| Aspect | MinHash | SimHash |
|--------|---------|---------|
| Metric | Jaccard `|A∩B|/|A∪B|` | cosine `1 − θ/π` agreement |
| Input | sets | (weighted) vectors |
| Collision law | `Pr[match] = J` | `Pr[bit agree] = 1 − θ/π` |
| Sketch | `k` integers (or b-bit) | `b` bits |
| Compare | count equal slots | popcount (Hamming) |
| Estimator | `Ĵ = matches/k`, unbiased | `cos θ ≈ cos(π·(disagreements/b))` |
| Variance | `J(1−J)/k` | `p(1−p)/b`, `p = 1 − θ/π` |
| Best for | dedup, set overlap | TF-IDF/embedding similarity |

**Unifying view.** Both are **locality-sensitive hash families**: families where `Pr[h(x) = h(y)]` is a monotone function of similarity. MinHash realizes the LSH property for Jaccard; SimHash realizes it for cosine. The S-curve banding analysis (Section 8) applies to *either* once you have a per-slot/per-bit collision probability that tracks the target similarity.

### 9.1 Formal (r₁, r₂, p₁, p₂)-Sensitivity

The LSH framework formalizes a family `H` as **`(r₁, r₂, p₁, p₂)`-sensitive** for a distance `d` if `d(x,y) ≤ r₁ ⇒ Pr[h(x)=h(y)] ≥ p₁` and `d(x,y) ≥ r₂ ⇒ Pr[h(x)=h(y)] ≤ p₂`, with `p₁ > p₂`. For MinHash with Jaccard *distance* `d_J = 1 − J`: it is `(r₁, r₂, 1−r₁, 1−r₂)`-sensitive, since `Pr[collision] = J = 1 − d_J`. The **quality** of an LSH family is `ρ = ln(1/p₁)/ln(1/p₂) < 1`; the resulting query time is `O(N^ρ)`. MinHash's `ρ` for Jaccard is what makes near-duplicate search sublinear; the banding `(b,r)` is the concrete realization of the generic LSH amplification `AND`-then-`OR` construction (`r` rows = AND, `b` bands = OR).

### 9.2 When SimHash Beats MinHash and Vice Versa

| Situation | Prefer | Why |
|-----------|--------|-----|
| Binary feature sets, set overlap | MinHash | collision = Jaccard, exactly the metric |
| TF-IDF / dense embeddings | SimHash | collision tracks cosine/angle of vectors |
| Weighted multisets, weighted Jaccard | Weighted MinHash (CWS) | collision = weighted Jaccard (§7.2) |
| Extreme storage pressure | SimHash or b-bit MinHash | 64-bit fingerprint / 1-bit slots |
| Need cardinality too | bottom-k MinHash | KMV gives distinct-count for free |

The decision is *always* "which similarity is correct for the data," then "which sketch realizes it most cheaply" — never the reverse.

---

## 10. Complexity Analysis

**Theorem 10.1.** With `n = |A|` and signature length `k`:

| Operation | Time | Space |
|-----------|------|-------|
| k-hash signature build | `O(n·k)` | `O(k)` |
| bottom-k build | `O(n log k)` | `O(k)` |
| OPH build (+densify) | `O(n + k)` | `O(k)` |
| compare two signatures | `O(k)` | `O(1)` |
| estimate variance target `ε` | `k = O(ε^{−2})` | — |
| all-pairs (no LSH) | `O(N² k)` | `O(N k)` |
| LSH candidate gen | `O(N b)` index + output | `O(N b + buckets)` |

**Proof sketches.** Build costs are direct from the loop structure (k-hash: `k` updates per element; bottom-k: a size-`k` heap; OPH: one hash + bin assignment). Comparison counts `k` equalities. The estimation `k = O(ε^{−2})` is Corollary 5.2 (drop the log factor for variance-only control). All-pairs without LSH is the `(N choose 2)` comparisons times `O(k)`. LSH replaces it with `O(b)` band insertions/lookups per signature plus output-sensitive candidate cost. ∎

**Cache and SIMD remarks.** Signature comparison (`k` equality tests) is a tight, vectorizable loop; b-bit MinHash makes it a popcount over packed bits, like SimHash's Hamming compare. The k-hash build is the cost center and is embarrassingly parallel across elements and across the `k` functions.

### 10.1 Lower Bounds on Sketch Size

**Theorem 10.2 (sketch-size lower bound).** Any sketch that estimates Jaccard within additive `ε` with constant success probability must use `Ω(1/ε²)` bits per set in the worst case. MinHash with `k = Θ(1/ε²)` slots matches this up to the per-slot bit cost; b-bit MinHash pushes the constant down by storing `b` bits/slot instead of `O(log M)`. Thus MinHash is, up to constants, an *optimal* Jaccard sketch — there is no asymptotically smaller summary that achieves the same `ε`-accuracy. This information-theoretic optimality is the theoretical justification for MinHash's ubiquity.

### 10.2 The All-Pairs vs LSH Cost Crossover

For `N` sets each of size `n`, exact all-pairs Jaccard is `O(N² · n)`. MinHash + all-pairs signature compare is `O(N·n·k + N²·k)` — the `N²` term still dominates for large `N`. LSH banding makes candidate generation `O(N·b + |candidates|·k)`. The crossover where LSH wins is essentially immediate for any nontrivial `N`, because `N²·k` is catastrophic at `N = 10⁶`+ (`10¹²·k` operations). This is the formal reason signatures *must* be banded, not compared pairwise, at scale.

### 10.3 Streaming and Distributed Complexity

Because `min` is an associative, commutative, idempotent monoid operation, the signature is a **mergeable sketch**: combining `p` partial signatures (one per shard) is `O(p·k)`, and a streaming update is `O(k)` per element with `O(k)` state — independent of how many elements have been seen. This places MinHash in the same complexity class as other mergeable sketches (HyperLogLog, count-min) for distributed aggregation: a single pass, sublinear (here `O(k)`, constant in `n`) memory, and embarrassingly parallel reduction. The total work to sketch a corpus of total size `T = Σ n_i` is `O(T·k)` for k-hash or `O(T)` for one-permutation, perfectly partitionable across machines with an `O((#machines)·k)` final merge.

### 10.4 Comparison Table of Asymptotics

| Quantity | Exact | k-hash MinHash | bottom-k | OPH |
|----------|-------|----------------|----------|-----|
| build one set | `O(n)` | `O(n·k)` | `O(n log k)` | `O(n+k)` |
| sketch space | `O(n)` | `O(k)` | `O(k)` | `O(k)` |
| pairwise compare | `O(n)` | `O(k)` | `O(k)` | `O(k)` |
| merge two sketches | `O(n)` | `O(k)` | `O(k log k)` | `O(k)` |
| all-pairs (N sets) | `O(N²n)` | `O(N²k)` | `O(N²k)` | `O(N²k)` |
| LSH candidate gen | — | `O(Nb + C k)` | `O(Nb + C k)` | `O(Nb + C k)` |

(`C` = number of candidate pairs.) The columns make the trade explicit: variants differ in *build* and *merge* cost, but all share the same compact `O(k)` sketch and the same `O(k)` compare — the properties that matter at query time — and all require LSH to escape the `O(N²)` all-pairs term.

---

## 11. Summary

- **Collision theorem (Section 2).** `Pr[h_min(A) = h_min(B)] = J(A,B)`, because the minimizer of `A ∪ B` is uniform over the union (min-wise independence) and the minima coincide iff that minimizer lies in `A ∩ B`. This single identity is the foundation.
- **Unbiased estimator (Section 3).** `Ĵ = matches/k` has `E[Ĵ] = J` for every `k`, by linearity of expectation; unbiasedness needs only per-function min-wise independence.
- **Variance and `1/√k` (Section 4).** With independent hashes, `Var(Ĵ) = J(1−J)/k ≤ 1/(4k)`, so `SE ≤ 1/(2√k)` — quadruple `k` to halve the error; most precise near `J ∈ {0,1}`. The estimator is also efficient (meets the Cramér–Rao bound for `k` Bernoulli slots), so no post-processing of the same slots can do better.
- **Concentration (Section 5).** Hoeffding gives `Pr[|Ĵ−J| ≥ ε] ≤ 2e^{−2kε²}`, so `k = O(ε^{−2} log(1/δ))` for an `(ε,δ)` guarantee; Chernoff sharpens the small-`J` regime; a union bound costs only `log N` extra for all pairs.
- **Min-wise independence (Section 6).** Exact min-wise families need `Ω(u)` bits; we use approximate families (strong base hashes), incurring bias `≤ ε` and mild extra variance — the theory behind "use a good hash."
- **Variants (Section 7).** Bottom-k (one hash, also gives cardinality) and one-permutation MinHash with densification (one hash + binning) are both unbiased with variance `≈ J(1−J)/k`, at far lower build cost than k-hash.
- **LSH banding (Section 8).** `Pr[candidate] = 1 − (1 − J^r)^b` is an S-curve with threshold `≈ (1/b)^{1/r}`; tuning `(b,r)` trades recall vs precision and makes candidate generation sublinear.
- **SimHash (Section 9).** SimHash's bit-agreement `1 − θ/π` tracks *cosine*, not Jaccard; MinHash and SimHash are the LSH realizations of two different metrics and are not interchangeable.

### Worked Integration: Estimating J(A,B) for a Real Pair

Tie the whole chain together on `A = {1,…,8}`, `B = {3,…,10}` (`|A∩B| = 6`, `|A∪B| = 10`, so `J = 0.6`).

1. **Collision (Thm 2.1):** any single hash collides with prob exactly `0.6`.
2. **Estimator (Thm 3.1):** with `k = 100` independent hashes, `E[Ĵ] = 0.6`.
3. **Variance (Thm 4.1):** `Var = 0.6·0.4/100 = 0.0024`, `SE = 0.049`, so a typical run lands in `[0.55, 0.65]`.
4. **Concentration (Thm 5.1):** `Pr[|Ĵ−0.6| ≥ 0.1] ≤ 2e^{−2·100·0.01} = 2e^{−2} ≈ 0.27` (loose), while the CLT view gives `Pr[|Ĵ−0.6| ≥ 0.1] ≈ 2(1−Φ(0.1/0.049)) ≈ 2(1−Φ(2.04)) ≈ 0.04`.
5. **Variant (Thm 7.1):** bottom-k with `k=100` gives the same `0.6` with a slightly smaller variance (finite-population correction), plus a free estimate of `|A|, |B|`.
6. **Banding (Thm 8.1):** with `b=20, r=5`, candidacy prob `S(0.6) = 1 − (1 − 0.6^5)^{20} = 1 − (1 − 0.0778)^{20} ≈ 1 − 0.198 = 0.80`; raise `b` or lower `r` to push recall toward `1` at this `J`.
7. **Metric check (Thm 9.2):** if the data were weighted TF-IDF vectors, we would instead use SimHash (cosine) or weighted MinHash (weighted Jaccard) — the set-based `J = 0.6` answers a *set-overlap* question only.

Every step is one of the numbered theorems applied in sequence — the file in miniature.

**Sanity check against exact computation.** The exact `J = 6/10 = 0.6` is the ground truth; the estimator's job is to recover it from `k` slots without ever materializing `A∩B` or `A∪B`. The variance and concentration results bound how close a *single* `k=100` run will be, and the banding result decides whether this pair even surfaces as a candidate in a large index. Nothing in the chain ever stores the sets — only `k` integers per set — which is the entire point: a `0.6`-similar pair among `10⁹` documents is found in microseconds from two `k`-integer signatures.

### Reliability / cost cheat table

| Quantity | Formula | Meaning |
|----------|---------|---------|
| collision prob | `Pr[match] = J` | one slot is `Bernoulli(J)` |
| estimator | `Ĵ = matches/k` | unbiased |
| variance | `J(1−J)/k` | `≤ 1/(4k)` |
| standard error | `√(J(1−J)/k)` | `≤ 1/(2√k)` |
| Hoeffding | `2e^{−2kε²}` | tail bound |
| sample size | `k ≥ ln(2/δ)/(2ε²)` | `(ε,δ)` guarantee |
| LSH candidacy | `1 − (1−J^r)^b` | S-curve |
| LSH threshold | `(1/b)^{1/r}` | inflection of S-curve |

### Worked end-to-end variance check

Let `J = 0.5` (worst case), `k = 400`. Then `Var(Ĵ) = 0.5·0.5/400 = 1/1600`, `SE = 1/40 = 0.025`. A 95% interval is `≈ ±2·0.025 = ±0.05`. Hoeffding for `ε = 0.05`: `Pr[|Ĵ−J| ≥ 0.05] ≤ 2e^{−2·400·0.0025} = 2e^{−2} ≈ 0.27` — a loose tail bound that the variance/CLT estimate (`±0.05` ≈ 2σ) sharpens; both confirm `k = 400` puts you in the `±0.05` regime, matching the junior-level rule of thumb.

### Theorem Dependency Recap

| Result | Depends on | Used by |
|--------|-----------|---------|
| Theorem 2.1 (collision = J) | min-wise independence (Def 1.5) | Cor 2.2, all of §3–§8 |
| Theorem 3.1 (unbiased) | Cor 2.2, linearity of expectation | estimator, §5 |
| Theorem 4.1 (variance) | independence of slots | §5, §8 banding |
| Theorem 5.1 (Hoeffding) | bounded independent sum | sample-size rule, §5.4 union |
| Theorem 6.2 (min-wise lower bound) | combinatorics of permutations | choice of approximate families |
| Theorem 8.1 (S-curve) | per-slot Bernoulli(J), independence | LSH tuning, §8.1–§8.2 |
| Theorem 9.1 (SimHash) | random hyperplanes, GW lemma | metric-selection (§9.2) |

This table is the dependency graph of the topic: **Theorem 2.1 is the root** (collision = Jaccard), unbiasedness and variance are its immediate statistical consequences, concentration quantifies reliability, and the S-curve lifts a single-slot probability into a scalable index. SimHash sits parallel as the cosine analogue.

### Closing Notes

- **The collision identity is everything (Section 2):** `Pr[h_min(A)=h_min(B)] = J` because the minimizer of `A∪B` is uniform and the minima agree iff it lands in `A∩B`. Every statistical and systems result is a corollary of this one fact.
- **Unbiased at any k, tighter with more k (Sections 3–4):** the center never moves (`E[Ĵ]=J`); only the spread shrinks, as `J(1−J)/k`, so the error is `O(1/√k)` — most precise exactly where `J` is near `0` or `1`, the dedup decision regime.
- **Concentration sizes k (Section 5):** Hoeffding gives `k = O(ε^{−2}log(1/δ))`; a union bound adds only `log N` for all pairs; median-of-means is an equally cheap, robust alternative.
- **Approximate min-wise independence is what we actually deploy (Section 6):** exact families cost `Ω(|U|)` bits, so strong base hashes (small bias `ε`) are the practical compromise — "use a good hash" is a theorem, not folklore.
- **Variants trade build cost for the same accuracy (Section 7):** bottom-k (one hash + free cardinality) and one-permutation MinHash with densification (one hash + binning) both reach `≈ J(1−J)/k` variance far more cheaply than k-hash; weighted MinHash extends the collision identity to weighted Jaccard.
- **Banding makes it scale (Section 8):** `1 − (1 − J^r)^b` is a tunable S-curve; rows control precision, bands control recall, and the analysis is the AND/OR amplification of the generic LSH framework.
- **Metric, then sketch (Section 9):** MinHash is the LSH realization for Jaccard, SimHash for cosine; they are not interchangeable, and the choice is dictated by the data's correct similarity.

One last unifying observation: MinHash is a single algebraic identity (collision probability equals Jaccard) wrapped in two layers of engineering — *averaging* `k` slots to turn a coin flip into a precise estimate, and *banding* those slots to turn a precise estimate into a sublinear search. The mathematics gives correctness (unbiasedness from the identity); the counting gives efficiency (concentration for `k`, the S-curve for `(b,r)`). That clean separation — identity for correctness, concentration for efficiency — is the conceptual signature of MinHash and the reason it has been the backbone of large-scale similarity search since Broder introduced it for AltaVista's web-dedup in the late 1990s.

### Practitioner Corollaries

A compact list of the theorems' practical consequences, each traceable to a numbered result above:

- Pick `k` from variance (`k ≈ z²·J(1−J)/ε²`) for tight estimates near your threshold, or from Hoeffding (`k ≥ ln(2/δ)/(2ε²)`) for a worst-case guarantee (Thms 4.1, 5.1).
- Use a strong base hash, then cheap affine/binning; exact min-wise independence is unaffordable and unnecessary (Thms 6.2, 6.3, §6.1).
- Prefer bottom-k or OPH when build cost dominates; both reach the same accuracy at one hash per element (§7).
- Use b-bit MinHash with the `(p_b − 2^{−b})/(1 − 2^{−b})` correction for space-critical stores (§7.3).
- Always band (`k=b·r`) to escape `O(N²)`; rows tune precision, bands tune recall (Thm 8.1, §8.2).
- Choose MinHash vs SimHash by the *metric* (Jaccard vs cosine), never by convenience (§9.2).

### Where the Proofs Bite in Practice

Each result above maps to a failure you can observe in production if you ignore it:

| Theorem ignored | Symptom in production | Fix traced to the proof |
|---|---|---|
| Unbiasedness (Thm 3.1) | Estimates systematically off | Verify the hash induces a near-uniform permutation (§6) |
| Variance / Hoeffding (Thms 4.1, 5.1) | Estimates too noisy near threshold | Raise `k` to the sized value |
| Min-wise lower bound (Thm 6.2) | Memory blows up chasing exactness | Accept small bias `ε`; use a strong base hash |
| S-curve (Thm 8.1) | Recall or precision collapses | Re-tune `(b, r)` to the threshold |

The throughline: every tuning knob (`k`, `(b,r)`, the hash family) is the operational shadow of a specific theorem, so a regression in recall, precision, or memory is almost always a violated precondition rather than a bug in the code.

Foundational references: Broder (1997, 1998) for MinHash and the collision theorem; Broder, Charikar, Frieze, Mitzenmacher (1998) for min-wise independence and its lower bounds; Bar-Yossef et al. / Beyer et al. for bottom-k (KMV) and distinct counting; Li, König, Shrivastava for b-bit MinHash and one-permutation MinHash with densification; Charikar (2002) and Goemans–Williamson for SimHash / sign random projections; Indyk–Motwani (1998) and Gionis–Indyk–Motwani for LSH and the banding S-curve; Leskovec–Rajaraman–Ullman, *Mining of Massive Datasets*, Ch. 3, for the unified treatment. Sibling topic [`../10-locality-sensitive-hashing`](../10-locality-sensitive-hashing) for the banding internals and multi-probe extensions.
