# HyperLogLog — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Why Leading Zeros Estimate Cardinality (the Core Probabilistic Argument)
3. From One Counter to Stochastic Averaging
4. The Harmonic-Mean Estimator and the Indicator Function
5. Why the Harmonic Mean (Variance Rationale)
6. Bias and the Constant alpha_m
7. Variance / Error Analysis: the 1.04/√m Law
8. The Corrections: Linear Counting and Large-Range
9. HLL++: Sparse Encoding and Empirical Bias Correction
10. Complexity, Space Lower Bounds, and Optimality
11. Relation to Other Sketches (LogLog, KMV, MinHash, Theta)
12. Numerical and Practical Theorems
13. Summary

---

## 1. Formal Definitions

Let `M` be a multiset (stream) drawn from a universe `U`, and let `n = |{distinct elements of M}|` be its **cardinality**. Fix a hash function `h : U → {0,1}^L` (here `L = 64`) modeled, for analysis, as an **idealized uniform random function**: the hash values are i.i.d. uniform over `{0,1}^L`, and identical elements share a hash (so duplicates collapse — HLL counts distinct elements).

**Definition 1.1 (precision, registers).** Fix `p ∈ {4,…,L}` and let `m = 2^p`. The first `p` bits of a hash select a **register index** `j ∈ {0,…,m-1}`; the remaining `w = L - p` bits form the **suffix**.

**Definition 1.2 (rank).** For a bit-string `b = b_1 b_2 …`, define `ρ(b) = ` position of the leftmost `1` `= 1 + (number of leading zeros)`. If `b` is all zeros over `w` bits, `ρ(b) = w + 1`. Thus `ρ ∈ {1, …, w+1}`.

**Definition 1.3 (registers / sketch).** For element `x` with hash `h(x) = ⟨j(x), s(x)⟩` (index `j`, suffix `s`), the HLL maintains
```
M[j] = max over all distinct x with j(x) = j  of  ρ(s(x)),     M[j] = 0 if no such x.
```
The sketch is the array `(M[0], …, M[m-1])`.

**Definition 1.4 (the estimator).** With `Z = Σ_{j=0}^{m-1} 2^{-M[j]}` (the "indicator" sum),
```
                  alpha_m · m^2
   E_hll  =  ----------------------- ,
                       Z
```
where `alpha_m` is the bias-correction constant of Section 6.

**Definition 1.5 (relative error).** The estimator's quality is measured by the **relative standard error** `RSE = √(Var(E_hll)) / n` (equivalently the standard deviation of `E_hll / n`).

**Notation.** Throughout, `n` is the true cardinality, `m = 2^p` the register count, `w = L - p` the suffix width, `M[j]` register `j`, `Z` the indicator sum, `V` the number of empty registers, `γ` Euler's constant, and `H` the harmonic-mean operator. Idealized-hash (uniform random) analysis is assumed unless stated; real hashes (good avalanche) match it closely.

**Standing assumptions.** `h` is an idealized uniform random hash; `w` is large enough that `ρ ≤ w+1` never saturates in the regime of interest (with `L = 64`, saturation requires `n ≈ 2^{64}`); and `n` is large enough that the central-limit / Poissonization approximations of Sections 5–7 hold (the corrections of Section 8 handle small `n`).

**On the idealized-hash assumption.** The entire analysis models `h` as a uniform random function, but real hashes are fixed deterministic functions. The justification is twofold: (1) for a *fixed* input set, a hash with good avalanche (each output bit depends on all input bits, flipping with probability ≈½ when any input bit flips) produces outputs statistically indistinguishable from uniform for the leading-zero and routing statistics HLL uses; (2) empirically, MurmurHash3, xxHash, and CityHash all reproduce the `1.04/√m` error to within measurement noise. A *cryptographic* hash is provably close to a random oracle but unnecessarily slow; the practical requirement is only good avalanche on the *top* bits (routing) and the *suffix* bits (rank), which non-cryptographic 64-bit hashes satisfy. A hash failing avalanche (e.g. multiplicative hashes with poor constants, or identity-like hashes) biases register routing and ranks, breaking every theorem here.

### 1.1 The Dependency of the Argument

```mermaid
graph TD
    A["rank ρ = 1 + leading zeros (Def 1.2)<br/>Pr[ρ ≥ k] = 2^-(k-1)"] --> B["single counter: max ρ ≈ log2 n (Sec 2)"]
    B -->|too noisy: constant-factor error| C["stochastic averaging over m registers (Sec 3)"]
    C -->|combine via indicator Z = Σ 2^-M[j]| D["harmonic-mean estimator<br/>E = alpha_m·m²/Z (Sec 4–6)"]
    D -->|variance / delta method| E["RSE ≈ 1.04/√m (Sec 7)"]
    E -->|extremes break CLT| F["corrections: linear counting + large-range (Sec 8)"]
    F --> G["HLL++: bias table + sparse (Sec 9)"]
```

Reading top to bottom: the rank's geometric tail makes a single counter's max track `log2 n` but too noisily; stochastic averaging over `m` registers and the harmonic-mean estimator drive the relative error to `1.04/√m`; corrections patch the low/high extremes; HLL++ refines both. Every theorem in this document attaches to one node of this chain:

- Lemma 2.1 and Proposition 2.2 justify node A→B (leading zeros ↔ cardinality).
- Lemma 3.2 and depoissonization justify B→C (independence of registers).
- Sections 4–6 construct the estimator at node D and remove its bias (`alpha_m`).
- Theorem 7.1 establishes the `1.04/√m` at node E, with the `√(3 ln 2 − 1)` constant.
- Propositions 8.1–8.2 and Section 9 supply nodes F and G.

Keeping this skeleton in mind prevents the common confusion of mixing the *bias* corrections (nodes D, F, G) with the *variance* law (node E) — they are orthogonal: variance is set by `m` alone, bias by the constants and corrections.

---

## 2. Why Leading Zeros Estimate Cardinality (the Core Probabilistic Argument)

This section answers the deepest "why": *why does the longest run of leading zeros measure how many distinct things you have seen?*

**Lemma 2.1 (tail of the rank).** For a uniform random suffix `s ∈ {0,1}^w` and `1 ≤ k ≤ w`,
```
Pr[ρ(s) ≥ k] = 2^{-(k-1)},      Pr[ρ(s) = k] = 2^{-k}.
```
**Proof.** `ρ(s) ≥ k` iff the first `k-1` bits are all `0`, which has probability `2^{-(k-1)}` since the bits are independent fair. Then `Pr[ρ = k] = Pr[ρ ≥ k] - Pr[ρ ≥ k+1] = 2^{-(k-1)} - 2^{-k} = 2^{-k}`. ∎

So `ρ` is (essentially) a **geometric random variable**: `ρ` records "the index of the first heads in a sequence of fair coin flips."

**Proposition 2.2 (max rank tracks log2 of count).** Suppose `n` distinct elements hash into a single counter (no register split). Let `R = max_i ρ(s_i)` over the `n` items. Then `E[R] ≈ log2(n) + O(1)`, and `2^R` is an estimator of `n`.

**Heuristic derivation (the heart of HLL).** The probability that **none** of the `n` items achieves rank `≥ k` is
```
Pr[R < k] = (1 - 2^{-(k-1)})^n ≈ exp(-n · 2^{-(k-1)}).
```
Examine this as a function of `k`:

- If `2^{k} ≪ n` (i.e. `k ≪ log2 n`), then `n·2^{-(k-1)} ≫ 1`, so `Pr[R < k] ≈ 0`: it is almost certain *some* item reached rank `k`.
- If `2^{k} ≫ n` (i.e. `k ≫ log2 n`), then `n·2^{-(k-1)} ≈ 0`, so `Pr[R < k] ≈ 1`: almost surely *no* item reached rank `k`.

The transition happens sharply around `k ≈ log2 n`. In words: **you expect to see a rank-`k` item roughly once every `2^k` distinct items**, so the *largest* rank you have seen is about `log2 n`, and `2^R ≈ n`. This is the entire intuition — leading zeros are rare in proportion to `2^k`, so the rarest one you have observed reveals the scale of the count. ∎ (heuristic; made rigorous via the harmonic-mean estimator below)

**Why a single counter is not enough.** `R` has a *spread* of about ±1.87 around `log2 n` (the standard deviation of the maximum of `n` geometrics is `Θ(1)` in `R`, i.e. `Θ(1)` *bits*). A `Θ(1)`-bit spread in `R = log2(estimate)` means the multiplicative error of `2^R` is a *constant factor* — useless. We must average many independent `R`'s to shrink the variance, which is the role of the `m` registers.

### 2.0 The coin-flip restatement

The cleanest way to internalize Lemma 2.1 is the **coin-flip** model. Treat each item's hash suffix as a sequence of fair coin flips; `ρ` is "the position of the first heads." Across `n` items you run `n` such sequences and record the deepest first-heads position seen. The probabilities:

```
P(an item's first heads is at position ≥ k) = P(first k-1 flips all tails) = 2^{-(k-1)}
expected number of items reaching depth ≥ k = n · 2^{-(k-1)}
```

The deepest depth reached crosses `1` (i.e. "expected to see at least one") exactly when `n · 2^{-(k-1)} ≈ 1`, i.e. `k ≈ log2(n) + 1`. So the deepest run is `≈ log2 n`. This is the same argument as Proposition 2.2 in plain language, and it is the sentence to say in an interview: *"a run of `k` zeros happens about once per `2^k` items, so the longest run I have seen is about `log2` of the count."*

### 2.1 The expectation of the maximum, made precise

The exact distribution of `R = max_i ρ_i` over `n` i.i.d. ranks is `Pr[R ≤ k] = (1 - 2^{-k})^n` (each item has `ρ ≤ k` with probability `1 - 2^{-k}`). The expectation admits the classic "sum of survival probabilities" form:

```
E[R] = Σ_{k≥0} Pr[R > k] = Σ_{k≥0} (1 - (1 - 2^{-k})^n).
```

Splitting the sum at `k ≈ log2 n` shows the summand is ≈1 for `k ≲ log2 n` and decays for `k ≳ log2 n`, so `E[R] = log2 n + P(log2 n) + o(1)`, where `P` is a tiny periodic fluctuation (amplitude `< 10^{-5}`) arising from the discreteness of `k`. The leading term `log2 n` is the rigorous statement of "max rank tracks the log of the count." The periodic term `P` is a hallmark of this family of analyses (it appears in tries, digital search trees, and LogLog) and is what `alpha_m` and the asymptotic constants quietly absorb.

### 2.15 Why a hash, and not the value itself

The leading-zero argument requires the bit-string to look like fair coin flips. Raw item values do **not**: user ids might be sequential integers (`1, 2, 3, …`), whose binary representations have highly correlated leading bits and no uniform leading-zero distribution. A good hash *destroys* that structure, mapping any input distribution to (approximately) uniform 64-bit strings. This is also why duplicates collapse: identical inputs hash identically, so re-adding an item touches the same register with the same rank — the idempotence that makes HLL count *distinct* items. The hash does double duty: (1) randomizing bits so the probabilistic analysis holds, and (2) canonicalizing identity so duplicates are free. Both are essential; neither survives if you feed raw values or a weak hash.

### 2.2 Why the single-counter variance is fatal

`Var(2^R)` is dominated by the heavy tail: `Pr[R ≥ log2 n + t] ≈ 1 - exp(-2^{-t})`, so `2^R` has a non-negligible chance of being `2, 4, 8, …` times too large. The coefficient of variation of `2^R` is `Θ(1)` — a *constant* relative error that does **not** shrink with `n`. No amount of data in one counter helps; only **parallel replication** (the `m` registers) reduces it, and it does so at the canonical `1/√m` Monte-Carlo rate (Section 7). This is the precise reason HLL spends its memory on *many small* registers rather than one big counter.

---

## 3. From One Counter to Stochastic Averaging

**Definition 3.1 (stochastic averaging).** Rather than `m` independent hash functions (expensive), HLL uses **one** hash and splits its bits: the top `p` bits assign each element to one of `m` registers; the suffix gives the rank. Each register `j` independently runs the single-counter experiment on the `≈ n/m` items routed to it, storing `M[j] = max ρ`.

**Lemma 3.2 (uniform routing).** Under the idealized hash, each element lands in register `j` with probability `1/m`, independently; the per-register count `N_j` is `Binomial(n, 1/m)`, with `E[N_j] = n/m`. For large `n`, `N_j ≈ Poisson(n/m)` (Poissonization), and the `N_j` are asymptotically independent.

Thus each `M[j] ≈ log2(N_j) ≈ log2(n/m)`, and we have `m` noisy estimates of `n/m`. The estimator must combine them so that the relative error drops like `1/√m`. The naive choice — average the `2^{M[j]}` arithmetically — is the original **LogLog** estimator and is dominated by the heavy right tail of `max`-of-geometrics. HLL's contribution is to combine via the **harmonic mean**.

### 3.1 Why stochastic averaging instead of `m` hashes

A textbook way to get `m` independent estimates is `m` independent hash functions, each run over the *whole* stream — costing `m` hash evaluations per element. **Stochastic averaging** (Flajolet–Martin) instead splits *one* hash: the top `p` bits route the element to one register, the rest feed that register's rank. This costs **one** hash per element (O(1) `add`) and is statistically equivalent in the limit: the partition of `n` elements into `m` registers is a multinomial, and conditioned on the per-register loads `N_j`, the registers are independent single-counter experiments. The only price is that the `N_j` are coupled by `Σ N_j = n` (removed by Poissonization), and that each register sees `n/m` rather than `n` elements — which is *why* the estimator multiplies by `m` and is accurate only once `n ≳ m` (below that, linear counting takes over). Stochastic averaging is the design decision that turns an `O(m)`-per-element idea into an `O(1)`-per-element one.

### 3.2 De-Poissonization

The clean i.i.d. analysis assumes `n ~ Poisson(λ)`. To transfer results to a *fixed* `n`, one shows the relevant functionals (mean and variance of `Z`) are smooth in `λ` and concentrate, so the Poisson and fixed-`n` models agree to leading order — `E_Poisson[·] = E_fixed[·](1 + O(1/n))`. The depoissonization lemmas (analytic, via Mellin transforms in Flajolet et al.) are what make the heuristic "registers are independent" rigorous despite the hard constraint `Σ N_j = n`. The leading `1.04/√m` constant survives the transfer unchanged; only lower-order terms differ.

---

## 4. The Harmonic-Mean Estimator and the Indicator Function

Define the **indicator sum**
```
Z = Σ_{j=0}^{m-1} 2^{-M[j]}.
```
The harmonic mean of the per-register estimates `2^{M[j]}` is `H = m / Z`. HLL sets
```
E_hll = alpha_m · m · H = alpha_m · m · (m / Z) = alpha_m · m^2 / Z.
```

**Why `m^2`.** Each register estimates the *per-register* count `n/m ≈ H` (the harmonic mean of the `2^{M[j]}`). To recover the *total*, multiply by `m`: `n ≈ m · (n/m) = m·H`. With `H = m/Z`, that is `m·(m/Z) = m^2/Z`, scaled by `alpha_m` to remove bias. The square arises because one factor of `m` is the number of registers and the other converts the harmonic mean back to a count.

**Why the indicator form is convenient.** `Z` is a simple sum of powers of two, computable in one O(m) pass, mergeable (a max on `M[j]` maps to a min on `2^{-M[j]}`), and analytically tractable: under Poissonization, the `2^{-M[j]}` are i.i.d., so `Z` is a sum of i.i.d. terms — ideal for variance analysis (Section 7).

### 4.1 Worked micro-example

Take `m = 4` registers and a stream whose registers ended at `M = (2, 4, 3, 0)` (register 3 empty). Then:

```
Z = 2^{-2} + 2^{-4} + 2^{-3} + 2^{-0}
  = 0.25 + 0.0625 + 0.125 + 1.0 = 1.4375
alpha_4 ≈ 0.5305            (interpolated small-m constant)
E_hll = 0.5305 · 4² / 1.4375 = 8.488 / 1.4375 ≈ 5.9.
```

Because `m = 4` is tiny and one register is empty (`V = 1`), the small-range rule applies (`E ≤ 2.5m = 10` and `V > 0`), handing off to linear counting `4·ln(4/1) ≈ 5.55`. With realistic `m = 16384` and 64-bit hashes the same arithmetic lands within ~0.8% of the truth; the toy values merely expose the mechanism. Note the empty register contributes the largest term (`2^{-0} = 1`) to `Z`, which is exactly why an abundance of empty registers drives `Z` up, `E_hll` down, and signals the low-cardinality regime where linear counting is the better estimator.

### 4.2 The estimator as a method-of-moments inversion

`E_hll` can be read as a **method-of-moments** estimator. Under Poissonization with rate `λ` (cardinality), `E[2^{-M[j]}]` is a known decreasing function `g(λ/m)` of the per-register load. The observed `Z/m` is the empirical mean of `2^{-M[j]}`; setting `Z/m = g(λ/m)` and inverting `g` yields `λ̂`. The harmonic-mean closed form `alpha_m m^2/Z` is precisely the first-order inversion of `g` (which behaves like `c·(m/λ)` for `λ ≫ m`), and the corrections of Section 8 are the higher-order terms of the inversion in the regimes where the linearization `g(x) ≈ c·x` breaks down (small and very large `λ`).

---

## 5. Why the Harmonic Mean (Variance Rationale)

**The problem with the arithmetic mean.** `2^{M[j]}` has a heavy upper tail: `Pr[M[j] ≥ k] ≈ 2^{-k}` per item gives `2^{M[j]}` an *infinite* second moment in the limit. The arithmetic mean `(1/m)Σ 2^{M[j]}` is therefore dominated by the single largest register and has large variance. The geometric mean (LogLog: average the `M[j]` in the exponent) tames this somewhat (`RSE ≈ 1.30/√m`).

**Why harmonic is better.** The harmonic mean uses `2^{-M[j]}`, which lies in `[0, 1]` and is **bounded** — a register with a freakishly large `M[j]` contributes `2^{-M[j]} ≈ 0` and cannot blow up `Z`. The estimator is robust to the upper tail *by construction*. Formally, `2^{-M[j]}` has finite moments of all orders, so `Z = Σ 2^{-M[j]}` obeys a central limit theorem and concentrates tightly. The penalty of LogLog's `1.30` versus HLL's `1.04` is precisely the cost of the geometric mean's residual tail sensitivity.

**Ordering of means.** For positive data, `harmonic ≤ geometric ≤ arithmetic`. The estimators line up the same way in robustness:

| Estimator | Combine `2^{M[j]}` via | RSE | Tail sensitivity |
|-----------|------------------------|-----|-------------------|
| (naive) | arithmetic mean | poor | dominated by max register |
| LogLog | geometric mean | `1.30/√m` | moderate |
| SuperLogLog | geometric mean, top regs dropped | `1.05/√m` | reduced, but ad hoc |
| **HyperLogLog** | **harmonic mean** | **`1.04/√m`** | bounded — no register dominates |

HyperLogLog attains nearly the SuperLogLog constant *without* discarding data — a cleaner, provably near-optimal estimator.

### 5.1 The moments of `Y = 2^{-M[j]}`

To make "bounded, finite moments" concrete, compute the law of a single register's contribution under Poissonization with per-register rate `μ = λ/m`. The register value `M[j]` satisfies `Pr[M[j] ≥ k] = 1 - exp(-μ·2^{-(k-1)})` (no item of rank `≥ k` arrived). The key transform `Y = 2^{-M[j]} ∈ (0, 1]` then has

```
E[Y]   = Σ_k 2^{-k} · Pr[M[j] = k]   →   finite,  ≈ (ln 2)·(m/λ)   for λ ≫ m,
E[Y^2] = Σ_k 4^{-k} · Pr[M[j] = k]   →   finite.
```

Both moments are finite because `Y ≤ 1` is bounded — the crucial contrast with `2^{M[j]}`, whose second moment diverges. Finiteness of `E[Y^2]` is exactly the hypothesis the CLT needs for `Z = Σ Y_j`, so the harmonic-mean estimator inherits a clean Gaussian limit while the arithmetic-mean estimator does not.

### 5.2 Robustness restated as influence

In robust-statistics language, the *influence* of one register on `E_hll = alpha_m m^2 / Z` is `∂E_hll/∂Y_j = -alpha_m m^2 / Z^2`, uniform across registers and bounded because `Y_j ∈ (0,1]` keeps `Z ≥ Σ` away from 0 (at least `m·2^{-(w+1)}`). No single register can swing the estimate by more than a bounded amount — the formal sense in which the harmonic mean is "outlier-resistant." Under the arithmetic mean of `2^{M[j]}`, the analogous influence is `∝ 2^{M[j]}`, unbounded, so one freak register dominates.

---

## 6. Bias and the Constant alpha_m

The raw harmonic-mean estimator `m^2/Z` is biased; `alpha_m` removes the leading bias. Flajolet et al. compute it as an integral over the limiting distribution of `Z/m`:

```
alpha_m = ( m · ∫_0^∞ ( log2( (2 + u)/(1 + u) ) )^m du )^{-1}.
```

This has closed/series forms for small `m` and a clean limit:

```
alpha_16 = 0.673
alpha_32 = 0.697
alpha_64 = 0.709
alpha_m  ≈ 0.7213 / (1 + 1.079/m)     (m ≥ 128)
alpha_∞  = 1 / (2 ln 2) ≈ 0.72134.
```

**Interpretation.** `1/(2 ln 2)` is the precise factor that makes `alpha_m · m^2 / Z` asymptotically unbiased: `E[E_hll] = n · (1 + o(1))`. The small-`m` values correct the `O(1/m)` finite-register bias. Crucially, `alpha_m` corrects bias **in the mid-cardinality range**; the *low* and *high* ranges need the separate corrections of Section 8 (or, in HLL++, the empirical bias table of Section 9).

**Where the integral comes from.** Under Poissonization, `Z/m` converges in distribution to a fixed law independent of `λ` (the scale-invariance of Section 7.2). The constant `alpha_m` is chosen so that `E[alpha_m m^2 / Z] = λ` exactly in this limit. Computing `E[m/Z]` requires the limiting density of `Z/m`, whose Laplace/Mellin transform is `(log2((2+u)/(1+u)))^m` integrated over `u` — hence the integral form. The function `log2((2+u)/(1+u))` is the per-register characteristic of a single `2^{-M[j]}`; raising to the `m`-th power reflects the `m` independent registers, and the integral averages over the load. The remarkable fact is that this constant is *universal*: it does not depend on `n`, only weakly on `m`, and converges to `0.72134…`. Practitioners simply use `alpha_m ≈ 0.7213/(1+1.079/m)` for `m ≥ 128` and the tabulated `0.673, 0.697, 0.709` for `m = 16, 32, 64`.

**Bias vs variance, separated.** `alpha_m` controls *bias* (the systematic offset of `E[E_hll]` from `n`); `m` controls *variance* (the `1.04/√m` spread). They are independent knobs: choosing `m` fixes the achievable precision, while `alpha_m` is then determined to center the estimator. HLL++'s empirical correction (Section 9.2) is a *further* bias adjustment in the regime where the single constant `alpha_m` is insufficient (the `[m, 5m]` transition), measured rather than derived in closed form.

---

## 7. Variance / Error Analysis: the 1.04/√m Law

**Theorem 7.1 (relative standard error).** Under the idealized-hash model, for cardinalities in the estimator's central range,
```
RSE(E_hll) = √(Var(E_hll)) / n  =  β_m / √m  →  1.03896… / √m   as m → ∞,
```
so the standard relative error is `≈ 1.04/√m`.

**Proof sketch.** Poissonize: condition on `n ~ Poisson(λ)`. Then the registers are independent, and `M[j]` has the distribution of `1 + ⌊log2 E_j⌋`-type quantity where `E_j` are exponential inter-arrival scales. The transform `Y_j = 2^{-M[j]}` are i.i.d. bounded variables with computable mean `μ` and variance `σ^2`. By the CLT, `Z = Σ Y_j` concentrates with relative standard deviation `(σ/μ)/√m`. Propagating through `E_hll = alpha_m m^2 / Z` (delta method: `Var(1/Z) ≈ Var(Z)/E[Z]^4`) gives `RSE = c/√m` with the constant `c` evaluating to `√(3 ln 2 − 1) ≈ 1.03896`. De-Poissonization (transfer back to fixed `n`) leaves the leading term unchanged. ∎

**Consequences.**

1. **Error depends only on `m`, not `n`.** The `n` cancels in the relative analysis — the same `m` gives the same *relative* error at any scale. This is the property that makes "12 KB for billions" work.
2. **Square-root memory law.** To halve `RSE`, quadruple `m` (add `2` to `p`). Equivalently, `RSE` is `Θ(1/√m)` and memory is `Θ(m)`, so memory is `Θ(1/RSE^2)`.

| `m = 2^p` | `1.04/√m` | dense bits (`6m`) |
|-----------|-----------|-------------------|
| 1,024 | 3.25% | ~768 B |
| 4,096 | 1.62% | ~3 KB |
| 16,384 | **0.81%** | **~12 KB** |
| 65,536 | 0.41% | ~48 KB |

**Theorem 7.2 (concentration).** Because each `Y_j ∈ [0,1]`, Hoeffding/Bernstein bounds give exponential tails: `Pr[ |E_hll/n − 1| > t·(1.04/√m) ] ≤ 2 e^{-Θ(t^2)}`, so estimates rarely stray beyond a few RSEs. ∎

### 7.1 The delta-method computation in full

Write `Z = Σ_{j} Y_j` with `μ = E[Y_j]`, `σ^2 = Var(Y_j)`. By independence (Poissonized), `E[Z] = mμ`, `Var(Z) = mσ^2`. The estimator is `E_hll = c/Z` with `c = alpha_m m^2`. A first-order Taylor expansion of `1/Z` around `E[Z]` gives

```
E[1/Z] ≈ 1/(mμ),
Var(1/Z) ≈ Var(Z) / (mμ)^4 = σ^2 / (m^3 μ^4),
RSE(E_hll) = √Var(1/Z) / E[1/Z] = (σ/μ) / √m.
```

So the whole error reduces to the **coefficient of variation** `σ/μ` of a single `Y_j`, divided by `√m`. Evaluating the moments of Section 5.1 in the central regime yields `(σ/μ)^2 → 3 ln 2 − 1`, hence `σ/μ → √(3 ln 2 − 1) ≈ 1.03896`. This is where the magic constant `1.04` comes from — it is the coefficient of variation of `2^{-M[j]}` for a uniformly loaded register, a pure number independent of `n` and `m`.

### 7.2 Why error is independent of `n` — the scale invariance

The argument above never used `n` except through the per-register load `μ = λ/m`, and `μ` enters only through the *constant* `σ/μ`, which converges to `1.04` for all loads `μ ≫ 1`. Geometrically, doubling `n` shifts every `M[j]` up by ≈1 (one more leading-zero level reachable), scaling `Z` by ≈`1/2` and `E_hll` by ≈2 — but the *relative* fluctuation of `Z` is unchanged. The estimator is **scale-invariant**: it measures `log2 n` modulo an additive shift, and the relative error of a log-domain measurement is constant. This is the rigorous backbone of the headline claim "the same 12 KB gives ~0.8% error from thousands to billions."

---

## 8. The Corrections: Linear Counting and Large-Range

The CLT analysis of Section 7 holds in the **mid** range. Two regimes break it.

### 8.1 Small range — linear counting

**Setup.** When `n ≲ m`, many registers remain empty (`M[j] = 0`). The harmonic estimator is biased *upward* there. But the **number of empty registers** `V` is itself an excellent estimator.

**Proposition 8.1 (linear counting).** Under uniform routing, `Pr[register j empty] = (1 - 1/m)^n ≈ e^{-n/m}`, so `E[V] = m e^{-n/m}`. Inverting the (concentrated) `V`:
```
n̂ = m · ln(m / V).
```
**Derivation.** `V/m ≈ e^{-n/m}` ⟹ `ln(V/m) ≈ -n/m` ⟹ `n ≈ -m ln(V/m) = m ln(m/V)`. ∎

This is the Whang–Vander-Zanden–Taylor linear-counting estimator. Its own RSE degrades as `V → 0` (registers fill), so HLL uses it **only** in the low range (classic rule: when raw `E ≤ (5/2)m` and `V > 0`) and hands off to the harmonic estimator above.

**Linear counting's own error.** `V = Σ_j 1[M[j]=0]` is a sum of (weakly dependent) Bernoulli's with `Pr = e^{-n/m}`. Its relative standard error works out to

```
RSE(n̂_LC) = √(e^{n/m} − n/m − 1) / (n/m) · (1/√m).
```

For `n ≪ m` this is *better* than HLL's `1.04/√m` (the numerator `→ √((n/m)^2/2)/(n/m) = 1/√2 · …` is small), which is precisely why HLL borrows it in the low range. As `n/m` grows past ~`2.5`, the `e^{n/m}` term explodes and linear counting becomes worse than the harmonic estimator — fixing the handoff threshold. The two estimators are complementary: linear counting excels when registers are mostly empty; the harmonic mean excels when they are mostly full.

### 8.2 Large range — hash-collision correction (32-bit hashes)

**Setup.** With an `L`-bit hash and `m` registers, the suffix is `w = L - p` bits, and distinct elements begin to **collide** in hash space as `n` approaches `2^L`. For `L = 32` this matters around `n ≈ 2^{32}/30`.

**Proposition 8.2 (large-range correction).** Modeling the `2^L` hash slots as a balls-in-bins occupancy with collisions, the bias-corrected estimate is
```
E* = -2^L · ln(1 - E / 2^L).
```
For `L = 64` (HLL++), the correction is negligible for any realistic `n` and is **omitted** — switching to 64-bit hashing removes this entire branch, leaving only the small-range correction. ∎

### 8.3 The decision rule (classic HLL)

```
E = alpha_m m^2 / Z
if E ≤ (5/2) m and V > 0:   return m ln(m / V)          # linear counting
elif E ≤ (1/30) 2^L:        return E                    # mid: raw harmonic
else:                       return -2^L ln(1 - E/2^L)   # large-range (L=32)
```

### 8.4 Worked large-range example (why 64-bit hashing wins)

Take `L = 32`, `n = 3·10^8` (300 million), `m = 16384`. The raw estimate `E` is near `n`, and `E/2^L ≈ 0.0698 > 1/30 ≈ 0.0333`, so the large-range branch fires:

```
E* = -2^32 · ln(1 - 0.0698)
   = -4.295·10^9 · ln(0.9302)
   = -4.295·10^9 · (-0.07236)
   ≈ 3.108·10^8.
```

The raw `E` under-counts (hash collisions merge distinct items into the same 32-bit value); the correction inflates it back toward the truth. But the correction is *itself* noisy and breaks down entirely as `E → 2^32`. With `L = 64`, the same `n = 3·10^8` gives `E/2^64 ≈ 1.6·10^{-11}` — utterly negligible — so the branch never fires and the estimator stays in its clean mid-range regime. This single example is the whole argument for HLL++'s switch to 64-bit hashing: it pushes the collision horizon from `~4·10^9` out to `~1.8·10^{19}`, beyond any realistic cardinality, deleting an entire source of error and a fragile code path.

---

## 9. HLL++: Sparse Encoding and Empirical Bias Correction

Heule–Nunkesser–Hall (2013) refine the estimator on three fronts; the math worth stating:

**9.1 64-bit hashing.** Replacing `L = 32` with `L = 64` removes Proposition 8.2 entirely (Section 8.2): saturation needs `n ≈ 2^{64}`, unreachable in practice. The estimator then has only one correction (low range).

**9.2 Empirical bias correction.** The hard handoff in Section 8.3 leaves a measurable bias bump for cardinalities a few times `m`. HLL++ measures the *empirical* bias `B(E, p) = E[raw estimate] − n` by Monte-Carlo simulation at many cardinalities for each `p`, and stores a lookup table. At query time it subtracts an **interpolated** bias (k-nearest-neighbor on the raw estimate):
```
n̂ = E − B̂(E, p),       with linear counting still used when V ≠ 0 and E below threshold.
```
This is a *data-driven* correction replacing the closed-form mid/low handoff — it lowers RSE in the troublesome `[m, 5m]` region with no asymptotic cost.

**9.2.1 The bias table, structurally.** For each precision `p`, HLL++ ships two parallel arrays measured by Monte Carlo:

```
rawEstimateData[p] = [E_1, E_2, …, E_K]      (sorted raw estimates)
biasData[p]        = [b_1, b_2, …, b_K]      (measured bias at each E_i)
```

At query time, given raw estimate `E`:

```
1. find the k nearest E_i to E   (binary search + window)
2. b̂ = average of the corresponding b_i   (k-NN interpolation)
3. corrected = E - b̂
```

The arrays have a few hundred entries per precision — kilobytes of constants compiled into the library. This is a *data-driven* replacement for a closed-form correction that has no clean analytic form in the transition region. The empirical approach is justified because the bias there is a deterministic function of `(E, p)` (not of the unknown `n`), so it can be measured once and reused forever.

**9.2.2 Threshold selection.** HLL++ also ships per-`p` thresholds `τ_p` deciding when to use linear counting versus the bias-corrected harmonic estimate. These were chosen empirically to minimize the maximum error across the cardinality range, replacing the classic universal `2.5m` rule with a per-precision tuned value. The net effect: the error curve over cardinality is *flattened*, removing the visible bias bump of classic HLL near `n ≈ 5m`.

**9.3 Sparse representation (space).** For `n ≪ m`, store only nonzero registers as encoded `(index, rank)` pairs, sorted, with **delta + varint** compression. Memory is `O(n)` (a few bytes per touched register) until it would exceed the dense `6m` bits, at which point it converts to dense. Because sparse cost is independent of `2^p`, HLL++ runs the sparse phase at a **higher precision `p' > p`** (e.g. `p' = 25`), giving near-exact low-range estimates (linear counting at `p'`), then **folds** down to `p` on conversion. This is the key to making millions of small counters affordable.

**Folding (precision downgrade).** Given a precision-`p'` register array, the precision-`p` value of merged register `j` (`p < p'`) is the max, over the `2^{p'-p}` source registers sharing `j`'s top `p` index bits, of an adjusted rank that accounts for the `p'-p` index bits that become suffix bits. Folding is lossy and one-directional (cannot upgrade).

**Sparse-encoding space, quantified.** In the sparse phase HLL++ stores a sorted list of touched registers as encoded integers. With cardinality `c` and high precision `p'`, the number of distinct touched registers is `≈ m'·(1 - e^{-c/m'}) ≈ c` while `c ≪ m' = 2^{p'}`. Each entry is an `(index, rank)` pair packed into a single `⌈(p' + 6)/8⌉`-byte word, then **delta-encoded** against the previous sorted index and **varint-compressed**, so successive entries cost `≈ log2(m'/c) / 8` bytes on average (the expected gap between sorted indices is `m'/c`). Total sparse memory is therefore `Θ(c · log(m'/c))` bits — sub-linear in `m'` and proportional to the *actual* cardinality, which is the formal reason a 5-element key costs a handful of bytes while a saturated key costs the dense `6m` bits. The promotion threshold is the `c` at which `Θ(c log(m'/c)) = 6m`, after which dense is strictly smaller.

**Rank adjustment under folding, derived.** When `p` drops to `p̂ = p - Δ`, the top `Δ` bits of the old index become the *leading* bits of the new suffix. A source register `j` (precision `p`) whose index has its low `Δ` bits equal to `b ∈ {0,…,2^Δ-1}` and whose stored rank is `r` maps into target register `j >> Δ`. The contributed rank is:

```
if b ≠ 0:   1 + (number of leading zeros of the Δ-bit value b)   (the new suffix starts with these Δ bits, all known)
if b = 0:   Δ + r                                                 (the Δ new suffix bits are all zero, then the old suffix's r zeros continue)
```

and the target register takes the max over its `2^Δ` sources. The asymmetry (the `b=0` case adds `Δ` to `r`) is exactly the bookkeeping of leading-zero runs crossing the old index/suffix boundary. This is correct because folding must yield the *same* sketch one would obtain by hashing every element directly at precision `p̂` — the leading-zero count of an element's full hash suffix is recovered by stitching the discarded index bits in front of the stored suffix rank.

---

## 10. Complexity, Space Lower Bounds, and Optimality

**Time.** `add` is `O(1)` (hash + shift + max). `count` is `O(m)`. `merge` is `O(m)`. All independent of `n`.

**Space.** Dense HLL uses `m` registers of `⌈log2(w+1)⌉` bits; with `L = 64`, `w+1 ≤ 65`, so `6` bits per register, total `6m` bits. For `p = 14`: `6·16384 = 98304` bits `= 12 KB`.

**Theorem 10.1 (near-optimality).** Any algorithm estimating cardinality up to `n_max` with relative error `ε` and success probability `2/3` requires `Ω(ε^{-2} + log n_max)` bits (Indyk–Woodruff; Kane–Nelson–Woodruff give the tight `Θ(ε^{-2} + log n)` bound). HLL uses `O(ε^{-2} log log n_max)` bits (since `m = Θ(ε^{-2})` registers of `Θ(log log n)` bits each). HLL is therefore within a `log log n` factor of optimal — and `log log n ≤ 6` for any `n ≤ 2^{64}`, so it is *effectively* optimal in practice.

| Sketch | Bits | Relative error | Note |
|--------|------|----------------|------|
| Exact set | `Θ(n log|U|)` | 0 | not sublinear |
| Linear counting | `Θ(n)` | tunable | bitmap sized to `n` |
| LogLog | `Θ(ε^{-2} log log n)` | `1.30 ε`-ish | `Θ(log log n)` regs |
| **HyperLogLog** | `Θ(ε^{-2} log log n)` | `1.04/√m` | near-optimal |
| KNW optimal | `Θ(ε^{-2} + log n)` | `ε` | tight lower bound |

**Why `log log n` per register.** A register stores `ρ ≈ log2(n/m)`, a number of size `O(log n)`, which needs `O(log log n)` bits — this is the structural reason HLL beats linear counting's `Θ(n)`: it stores *logarithms* of counts, not the counts (or a bitmap) themselves.

The hierarchy of distinct-counting space, from most to least memory:

| Method | Bits stored | What is stored |
|--------|-------------|----------------|
| Exact set | `Θ(n log\|U\|)` | every distinct element |
| Linear counting | `Θ(n)` | a bitmap, one bit per hash slot |
| HyperLogLog | `Θ(ε^{-2} log log n)` | the *log* of the per-register count |
| KNW optimal | `Θ(ε^{-2} + log n)` | tight lower bound |

Each step down stores progressively *less* information about the elements: identities → presence bits → logarithms of bucket maxima. HLL sits at the near-bottom, storing essentially the *order of magnitude* of each bucket — the minimum needed to recover a `(1±ε)` count.

### 10.1 Merge as a semilattice homomorphism

Let `S` be the set of HLL sketches with fixed `p` and hash, and define `A ⊔ B` by register-wise max. Then `(S, ⊔)` is an idempotent commutative monoid (a bounded join-semilattice with bottom = the all-zero sketch). The "sketch of" map `sk : 2^U → S` sending a set to its HLL satisfies

```
sk(A ∪ B) = sk(A) ⊔ sk(B),     sk(∅) = ⊥,
```

i.e. `sk` is a **monoid homomorphism** from `(2^U, ∪)` to `(S, ⊔)`. This algebraic fact is what makes HLL a state-based CRDT: merges are associative, commutative, idempotent, and monotone, so replicas converge regardless of message order or duplication. The *estimate* map `S → ℝ` is **not** a homomorphism (it is nonlinear), which is the abstract reason `est(sk(A) ⊔ sk(B))` recovers `|A ∪ B|` but no combination of `est` values recovers `|A ∩ B|` — intersection is not expressible through the union homomorphism.

### 10.2 The 6-bits-per-register accounting

With `L = 64` and any `p`, the suffix width is `w = 64 - p ≤ 60`, so `ρ ∈ {1, …, 61}` and a register needs `⌈log2 62⌉ = 6` bits. Hence dense memory is exactly `6m` bits independent of cardinality. For the standard sizes:

| `p` | `m` | bits `= 6m` | bytes |
|-----|-----|-------------|-------|
| 12 | 4,096 | 24,576 | 3 KB |
| 14 | 16,384 | 98,304 | 12 KB |
| 16 | 65,536 | 393,216 | 48 KB |

The "12 KB" everyone quotes is precisely `6 · 16384 / 8`. A naive one-byte-per-register layout wastes 25% (8 vs 6 bits); production sketches pack to 6 bits, which is also why packed get/set must handle registers straddling byte boundaries.

---

## 11. Relation to Other Sketches (LogLog, KMV, MinHash, Theta)

**LogLog / SuperLogLog (Durand–Flajolet 2003).** Same register scheme, different combiner (geometric mean; SuperLogLog drops top registers). HLL's harmonic mean dominates both in error per bit.

**KMV / bottom-`k` (Bar-Yossef et al.; Beyer et al.).** Keep the `k` **smallest** hash values; estimate `n̂ = (k-1)/U_(k)` where `U_(k)` is the `k`-th smallest hash in `[0,1)`. RSE `≈ 1/√k`. **Mergeable** (keep the `k` smallest of the union) and — unlike HLL — supports **intersection**: the intersection's `k`-min sample is recoverable, so `|A∩B|` is estimable directly. Costs more bits per accuracy than HLL but is set-operation-friendly.

**MinHash.** A KMV variant tuned to estimate the **Jaccard similarity** `|A∩B|/|A∪B|`: the fraction of shared minima across hash functions (or bottom-`k`) is an unbiased Jaccard estimator. The right tool when *overlap*, not raw cardinality, is the goal.

**Theta sketches (DataSketches).** Generalize KMV with a tunable threshold `θ`; support **union, intersection, and difference** with rigorous error bounds, at higher memory than HLL. The production answer when both large-scale cardinality *and* set algebra (including intersection) are required.

**Why HLL has no intersection.** `M[j] = max ρ` records the *depth* of the rarest item per register, not *which* items are present, so two sketches' registers cannot recover shared membership. The only route is inclusion-exclusion `|A∩B| = |A|+|B|−|A∪B|`, which subtracts three estimates each with absolute error `Θ(n·1.04/√m)`; for `|A∩B| ≪ |A|,|B|`, the *relative* error of the difference is `Θ((|A|+|B|)/|A∩B| · 1/√m)`, which diverges — the rigorous statement of "HLL can't intersect."

### 11.1 Solovay–Strassen analogy and the broader sketch landscape

It is instructive to place HLL beside the *membership* and *frequency* sketches it is often confused with:

| Sketch | Answers | Error type | Mergeable | Set ops |
|--------|---------|-----------|-----------|---------|
| **Bloom filter** | membership (∈?) | one-sided (false positives) | yes (bitwise OR) | union only |
| **HyperLogLog** | cardinality (\|·\|) | two-sided (`1.04/√m`) | yes (register max) | union only |
| **Count–Min** | frequency (count of x) | one-sided (over-estimate) | yes (add) | — |
| **KMV / Theta** | cardinality + set algebra | `1/√k` | yes | union, **intersect**, diff |
| **MinHash** | Jaccard similarity | `1/√k` | yes | similarity |

HLL, Bloom, and Count–Min are all linear sketches that merge by a *monotone* combiner (max, OR, add) but expose only the operation their combiner supports — none gives intersection, for the same algebraic reason given in Section 10.1. KMV/Theta break the pattern by storing the *actual* smallest hash values (a uniform sample of the hash space), which **is** intersection-recoverable: the smallest hashes of `A ∩ B` are exactly the shared smallest hashes, so `|A∩B|` is directly estimable. The cost is storing `k` full hashes (`Θ(k log n)` bits) versus HLL's `Θ(m log log n)`, the standard accuracy-per-bit trade against set-operation power.

### 11.2 HLL as the cardinality member of a sketch family

Formally, all four mergeable sketches are **linear sketches**: there is a (possibly nonlinear-readout) summary `φ(S)` with `φ(A ∪ B) = φ(A) ⊕ φ(B)` for a commutative combiner `⊕`. The readout (count, membership probability, frequency) is a fixed function of `φ`. HLL is the family member whose summary is the register-max vector and whose readout is the harmonic-mean estimator. Recognizing this places the "no intersection" limitation not as an HLL quirk but as a general property: a union-homomorphic summary cannot, in general, expose the non-monotone intersection operation, which is why intersection-capable sketches (KMV/Theta) must retain a *sample*, not just an aggregate.

---

## 12. Numerical and Practical Theorems

**Theorem 12.1 (idempotence / duplicate insensitivity).** For any element `x`, `add(add(S, x), x) = add(S, x)`. *Proof.* `add` sets `M[j(x)] ← max(M[j(x)], ρ(s(x)))`; applying the same `(j, ρ)` twice is `max(max(·, ρ), ρ) = max(·, ρ)`. Hence the sketch — and the estimate — depend only on the *set* of distinct elements, not their multiplicities. This is the formal statement that HLL counts distinct elements regardless of stream order or repetition. ∎

**Theorem 12.2 (monotonicity).** `A ⊆ B ⟹ M_A[j] ≤ M_B[j]` for all `j`, hence (modulo estimator noise) `est(A) ≤ est(B)` in expectation. *Proof.* Every element of `A` is an element of `B`, so each register's max over `A` is `≤` its max over `B`. ∎ A consequence: HLL cannot under-count a superset below a subset structurally, only by estimator variance — a useful sanity invariant in tests.

**Theorem 12.3 (merge correctness).** With equal `p` and hash, `est(sk(A) ⊔ sk(B))` is an estimate of `|A ∪ B|` with the *same* `1.04/√m` RSE as a single sketch. *Proof.* By Section 10.1, `sk(A) ⊔ sk(B) = sk(A ∪ B)`, so the merged sketch is distributed exactly as a fresh sketch of the union stream; Theorem 7.1 applies verbatim. ∎ This is why distributed roll-ups lose *no* accuracy relative to a single-machine count.

**Numerical caution — the `2^{-M[j]}` sum.** Computing `Z = Σ 2^{-M[j]}` naively in floating point is safe (terms in `[2^{-61}, 1]`, no catastrophic cancellation since all terms are positive). The estimator's only delicate step is the large-range `ln(1 - E/2^L)` (classic, 32-bit), which loses precision as `E → 2^L`; the 64-bit hash removes it. Linear counting's `ln(m/V)` is well-conditioned for `V ≥ 1`. In practice the dominant numerical concern is **register packing correctness** (6-bit fields across byte boundaries), not floating-point error.

**Practical determinism requirement.** For cross-process or persisted sketches, the hash must be *fixed* (same algorithm, same seed) — otherwise `sk` is not a well-defined function of the element set and merges are meaningless. This is a *correctness* requirement, not a tuning choice: a per-process random seed silently breaks Theorem 12.3.

**Theorem 12.4 (error is one-sided in neither direction).** Unlike Bloom filters (one-sided false positives) or Count–Min (one-sided over-estimates), HLL's error is **two-sided and approximately unbiased**: `E[E_hll] ≈ n` with symmetric `±1.04/√m` fluctuation. *Consequence.* You cannot treat an HLL count as a guaranteed upper or lower bound; it is a *point estimate* with a confidence interval. Reports should state `n̂ ± z·(1.04/√m)·n̂` for a `z`-sigma band (e.g. `z = 2` for ~95%). Quoting an HLL count without its interval is the most common reporting error in practice.

**Summary of invariants for implementers.**

| Invariant | Statement | Enforced by |
|-----------|-----------|-------------|
| Idempotence | duplicates don't change the sketch | `add` is `max` |
| Monotonicity | registers only increase | `add`/`merge` are `max` |
| Merge correctness | union recovered exactly | equal `p` + hash |
| Determinism | sketch is a function of the set | fixed hash + seed |
| Unbiasedness | `E[est] ≈ n` | `alpha_m` + corrections |

---

## 13. Summary

HyperLogLog rests on one probabilistic fact (Lemma 2.1): in a uniform hash, `ρ = 1 + leadingZeros` satisfies `Pr[ρ ≥ k] = 2^{-(k-1)}`, so a rank-`k` value appears about once per `2^k` distinct items — making the **maximum rank** seen track `log2 n`, hence `2^{max ρ} ≈ n` (Section 2). A single counter is too noisy (constant-factor multiplicative error), so HLL applies **stochastic averaging** over `m = 2^p` registers (Section 3) and combines them with the **harmonic-mean estimator** `alpha_m m^2 / Z`, `Z = Σ 2^{-M[j]}` (Section 4). The harmonic mean is chosen because `2^{-M[j]} ∈ [0,1]` is *bounded*, so no freak register dominates — yielding finite moments, a CLT, and a relative standard error `√(3 ln 2 − 1)/√m ≈ 1.04/√m` (Sections 5, 7) that is **independent of `n`** (the basis of "12 KB ≈ 0.8% for billions"). The constant `alpha_m → 1/(2 ln 2)` removes mid-range bias (Section 6); **linear counting** `m ln(m/V)` fixes the empty-register low range and a 32-bit **large-range** correction the saturation high range, the latter eliminated by HLL++'s 64-bit hash (Section 8). HLL++ adds **empirical bias correction** and a **sparse, high-precision** encoding that folds to dense (Section 9). HLL uses `Θ(ε^{-2} log log n)` bits — within a `log log n ≤ 6` factor of the `Θ(ε^{-2} + log n)` information-theoretic optimum (Section 10) — and, lacking a register operation for shared membership, supports **unions** (register-max) but not **intersections**, for which KMV, MinHash, or Theta sketches are the principled alternatives (Section 11).

---

## Further Reading (Primary Sources)

- **Flajolet, Fusy, Gandouet, Meunier (2007)** — *"HyperLogLog: the analysis of a near-optimal cardinality estimation algorithm,"* AofA '07. The original derivation of the harmonic-mean estimator, `alpha_m`, and the `1.04/√m` variance via Mellin transforms and depoissonization.
- **Durand, Flajolet (2003)** — *"Loglog counting of large cardinalities,"* ESA '03. The LogLog/SuperLogLog predecessors (`1.30/√m`, `1.05/√m`).
- **Heule, Nunkesser, Hall (2013)** — *"HyperLogLog in Practice: Algorithmic Engineering of a State of The Art Cardinality Estimation Algorithm,"* EDBT '13. The HLL++ improvements: 64-bit hashing, empirical bias correction, sparse representation.
- **Whang, Vander-Zanden, Taylor (1990)** — *"A linear-time probabilistic counting algorithm for database applications,"* TODS. The linear-counting estimator HLL borrows for its low range.
- **Kane, Nelson, Woodruff (2010)** — *"An optimal algorithm for the distinct elements problem,"* PODS. The `Θ(ε^{-2} + log n)` space lower bound and a matching algorithm.
- **Bar-Yossef et al. (2002)**, **Beyer et al. (2007)** — KMV / bottom-`k` cardinality estimation with set operations.
- **Apache DataSketches** — Theta and HLL sketch families with rigorous error bounds and set algebra (union/intersect/difference).
- **Cohen (2015)** — *"All-distances sketches"* and the broader min-hash / HIP estimator literature; the HIP (Historic Inverse Probability) estimator improves HLL's variance further.

These sources contain the full Mellin-transform derivations sketched in Sections 6–7, the exact bias tables of Section 9, and the optimality proofs of Section 10.

---

**Next step:** Continue to [`interview.md`](./interview.md) for a tiered question bank (junior → professional), behavioral prompts, and end-to-end coding challenges with runnable Go, Java, and Python solutions.
