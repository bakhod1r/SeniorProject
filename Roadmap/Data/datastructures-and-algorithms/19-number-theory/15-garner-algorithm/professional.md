# Garner's Algorithm — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Mixed-Radix Representation: Existence and Uniqueness
3. Garner's Digit Recurrence (Correctness Proof)
4. Equivalence to the Classic CRT Formula
5. Complexity Analysis: The O(k²) Bound
6. Error, Overflow, and Range Analysis
7. Residue Number System Theory
8. Signed and Centered Reconstruction
9. Non-Coprime Moduli and Generalized Reconstruction
10. Base Extension and Incrementality
10.5. Worked Proof Trace
10.6. The Product/Remainder Tree (Fast CRT)
10.7. Numerical Stability and Integer Exactness
10.8. The Mixed-Radix Number System as a Ring Structure
10.9. Comparison of Reconstruction Algorithms
10.10. Lower Bound and Optimality Remarks
10.11. Connection to NTT and Polynomial Arithmetic
10.12. Generalized Mixed-Radix and Factor-Base Variants
10.13. The Newton-Form Derivation in Detail
10.14. Worked Non-Coprime Detection
10.15. Detailed Proof of the mod-M Assembly
10.16. Edge Cases and Their Formal Resolution
11. Summary

---

## 1. Formal Definitions

Let `p_0, p_1, …, p_{k-1}` be **pairwise coprime** moduli (`gcd(p_i, p_j) = 1` for `i ≠ j`), each `p_i ≥ 2`. Define the **full product** and the **prefix products**:

```
P   = ∏_{i=0}^{k-1} p_i,        the modulus of the combined system.
W_i = ∏_{j=0}^{i-1} p_j,        the prefix product (W_0 = 1, W_k = P).
```

**Definition 1.1 (Residue tuple).** For `x ∈ ℤ`, its residue tuple under the moduli is `ρ(x) = (x mod p_0, …, x mod p_{k-1}) ∈ ∏_i ℤ_{p_i}`.

The map `ρ` is the central object: Garner is, precisely, an algorithm for computing a representative of `ρ^{-1}` restricted to `[0, P)`.

**Definition 1.2 (Reconstruction problem).** Given residues `r = (r_0, …, r_{k-1})` with `0 ≤ r_i < p_i`, find the unique `x` with `ρ(x) = r` and `0 ≤ x < P`.

**Definition 1.3 (Mixed-radix representation).** A representation of `x ∈ [0, P)` as

```
x = Σ_{i=0}^{k-1} a_i · W_i,      with    0 ≤ a_i < p_i for each i.
```

The coefficients `a_i` are the **mixed-radix digits**; `W_i` is the **weight** of digit `a_i`. This generalizes ordinary positional notation, in which all weights are powers of a single base; here the `i`-th weight is the product of the first `i` moduli.

**Notation conventions.** Throughout, `k = |p|` is the number of moduli; `p_i` a modulus (often prime, but only pairwise coprimality is used); `r_i = x mod p_i`; `a_i` the mixed-radix digit; `W_i` the prefix product; `P = W_k`; `M` an unrelated target modulus for `x mod M`; `inv(a, m)` the modular inverse of `a` mod `m`. The Iverson bracket `[Q]` is `1` if `Q` holds else `0`. "Pairwise coprime" is the standing hypothesis; everything in Sections 2–8 assumes it, and Section 9 lifts it.

**Why "pairwise" and not merely "coprime as a set".** The hypothesis is that *every pair* `(p_i, p_j)` is coprime, which is strictly stronger than `gcd(p_0, …, p_{k-1}) = 1`. For example `{6, 10, 15}` has overall gcd `1` but no pair is coprime; CRT and Garner both require the pairwise condition, because the prefix-product inverse step needs `gcd(W_i, p_i) = 1` for each `i` individually. Distinct primes satisfy pairwise coprimality automatically, which is why prime moduli are the default — though, as Section 10.12 shows, any pairwise-coprime moduli (including prime powers) work.

---

## 2. The Mixed-Radix Representation: Existence and Uniqueness

The entire correctness of Garner rests on the following counting/uniqueness fact, the analogue of "every integer in `[0, b^k)` has a unique base-`b` representation."

**Theorem 2.1 (Existence and uniqueness of mixed-radix).** Every integer `x ∈ [0, P)` has exactly one representation `x = Σ_{i=0}^{k-1} a_i W_i` with `0 ≤ a_i < p_i`.

**Proof (counting / bijection).** Consider the map

```
Φ : ∏_{i=0}^{k-1} {0, 1, …, p_i − 1}  →  {0, 1, …, P − 1},
Φ(a_0, …, a_{k-1}) = Σ_i a_i W_i.
```

The domain has `∏_i p_i = P` tuples; the codomain has `P` values. We show `Φ` is injective, hence bijective (equal finite cardinalities).

*Well-defined codomain.* First note `Φ(a) ∈ [0, P)`. Each weight satisfies the **carry-free bound** `W_{i+1} = W_i p_i > W_i(p_i − 1) ≥ Σ_{m≤i} a_m W_m` (the max value of all digits up to `i`). Summing, the maximum of `Φ` is `Σ_i (p_i − 1) W_i = W_k − 1 = P − 1`, so `0 ≤ Φ(a) ≤ P − 1`.

*Injectivity (digit-extraction / induction on `k`).* Let `x = Φ(a)`. Reducing mod `p_0` kills every term with `i ≥ 1` (each divisible by `W_1 = p_0`), leaving `x ≡ a_0 (mod p_0)`; since `0 ≤ a_0 < p_0`, this determines `a_0` uniquely as `x mod p_0`. Now `(x − a_0)/W_1` is a nonnegative integer in `[0, P/p_0)`, and it equals `Σ_{i≥1} a_i (W_i/W_1)` — a mixed-radix number over the moduli `(p_1, …, p_{k-1})` with weights `W_i/W_1 = p_1·…·p_{i-1}`. By the induction hypothesis (on the number of moduli `k`), its digits `(a_1, …, a_{k-1})` are uniquely determined. Hence the entire tuple `a` is recovered from `x`, so `Φ` is injective. ∎

**Corollary 2.2 (Range).** Because `Φ` is a bijection onto `[0, P)`, the mixed-radix sum `Σ a_i W_i` automatically lies in `[0, P)`: it requires **no final reduction mod `P`** (contrast the classic CRT formula, Section 4). This is a genuine practical saving: the classic formula's sum can reach `k·P` before reduction, demanding a big-integer division by `P`, whereas Garner's sum is range-bounded by construction.

**Remark.** Theorem 2.1 is a statement about integers and weights only; it does not yet use the residues `r_i`. The link to the reconstruction problem is that the *unique* `x ∈ [0, P)` with prescribed residues (CRT) must equal the *unique* mixed-radix `Σ a_i W_i`; Garner computes the digits `a_i` of precisely that `x`.

---

## 3. Garner's Digit Recurrence (Correctness Proof)

We now prove that the sequential digit-solve recovers exactly the digits of the target `x`.

**Theorem 3.1 (CRT existence/uniqueness).** With `p_i` pairwise coprime, the map `ρ : ℤ_P → ∏_i ℤ_{p_i}` is a ring isomorphism (Chinese Remainder Theorem). In particular, for any residue tuple `r` there is a unique `x ∈ [0, P)` with `ρ(x) = r`.

(Proved in sibling `05-crt`; we use it as a black box.)

**Theorem 3.2 (Garner correctness).** Let `x ∈ [0, P)` be the unique value with `x ≡ r_i (mod p_i)` for all `i`. Define digits sequentially by

```
a_i = ( r_i − Σ_{j<i} a_j W_j ) · (W_i)^{-1}   (mod p_i),     with a_i ∈ [0, p_i).      (★)
```

Then `(a_0, …, a_{k-1})` is the mixed-radix representation of `x`, i.e. `x = Σ_i a_i W_i`.

**Proof (induction on `i`).** First, the inverse `(W_i)^{-1} mod p_i` exists: `W_i = ∏_{j<i} p_j` is a product of moduli each coprime to `p_i` (pairwise coprimality), hence `gcd(W_i, p_i) = 1`.

Let `(â_0, …, â_{k-1})` be the *true* mixed-radix digits of `x` (Theorem 2.1), so `x = Σ_i â_i W_i`. We show `a_i = â_i` for all `i`.

*Base `i = 0`.* `W_0 = 1`, and the sum `Σ_{j<0}` is empty, so `(★)` gives `a_0 = r_0 · 1 = r_0 (mod p_0)`. Reducing `x = Σ_i â_i W_i` mod `p_0`: every term with `i ≥ 1` carries the factor `W_1 = p_0`, vanishing, so `x ≡ â_0 (mod p_0)`. But `x ≡ r_0`, so `â_0 = r_0 = a_0`.

*Inductive step.* Assume `a_j = â_j` for all `j < i`. Reduce `x = Σ_m â_m W_m` modulo `p_i`. Terms with `m > i` carry the factor `W_{i+1} = W_i·p_i ≡ 0 (mod p_i)`, so they vanish; terms with `m ≤ i` survive:

```
r_i ≡ x ≡ Σ_{m≤i} â_m W_m  (mod p_i)
    = ( Σ_{m<i} â_m W_m ) + â_i W_i   (mod p_i).
```

By the inductive hypothesis `â_m = a_m` for `m < i`, so

```
r_i ≡ ( Σ_{m<i} a_m W_m ) + â_i W_i   (mod p_i)
⟹ â_i W_i ≡ r_i − Σ_{m<i} a_m W_m   (mod p_i)
⟹ â_i ≡ ( r_i − Σ_{m<i} a_m W_m ) · (W_i)^{-1}   (mod p_i).
```

The right-hand side is exactly `a_i` by `(★)`, and both `a_i, â_i ∈ [0, p_i)`, so `a_i = â_i`. By induction the digits agree for all `i`, hence `Σ_i a_i W_i = Σ_i â_i W_i = x`. ∎

**Corollary 3.3 (No big modulus in the digit solve).** Every operation in `(★)` is performed modulo `p_i`; the only quantities exceeding a single modulus are the *weights* `W_j`, which appear **reduced mod `p_i`** inside the partial sum. Hence the digit-solve phase requires no arithmetic on numbers larger than `p_i²` (a product of two residues before reduction). The full-size integer arises only in the final assembly `Σ a_i W_i`.

**Corollary 3.4 (Reconstruction mod `M`).** For any modulus `M`, `x mod M = (Σ_i a_i (W_i mod M)) mod M`, computable with all intermediates `< M²`. This follows because `Σ a_i W_i = x` exactly (Theorem 3.2), and reduction mod `M` distributes over the sum and products.

---

## 4. Equivalence to the Classic CRT Formula

The classic (Lagrange-style) CRT reconstruction is

```
x = ( Σ_{i=0}^{k-1} r_i · M_i · y_i ) mod P,    M_i = P / p_i,   y_i = (M_i)^{-1} mod p_i.    (CLASSIC)
```

**Theorem 4.1 (Equivalence).** Formula (CLASSIC) and Garner's recurrence `(★)` compute the same `x ∈ [0, P)`.

**Proof.** Both compute the unique `x` of Theorem 3.1. (CLASSIC) satisfies the congruences because `M_i ≡ 0 (mod p_j)` for `j ≠ i` (since `p_j | M_i`) and `M_i y_i ≡ 1 (mod p_i)`, so the `i`-th term is `≡ r_i (mod p_i)` and all others vanish mod `p_i`; reducing mod `P` lands it in `[0, P)`. Garner's output equals `x` by Theorem 3.2. Two values in `[0, P)` with identical residues are equal (uniqueness, Theorem 3.1). ∎

**The cost difference (the reason Garner is preferred).** Although both are `O(k²)` in modular operations, the *operands* differ fundamentally:

| Quantity | (CLASSIC) | Garner |
|----------|-----------|--------|
| Largest intermediate in the solve | `M_i = P/p_i` (≈ `P`, a big integer) | `< p_i²` (single-prime sized) |
| Inverses | `(M_i)^{-1} mod p_i`, requires `M_i mod p_i` (big reduce) | `(W_i)^{-1} mod p_i`, prefix product mod `p_i` |
| Final reduction | mod `P` required (sum can reach `k·P`) | none — sum already in `[0, P)` (Corollary 2.2) |
| Incrementality | add a prime ⇒ recompute all `M_i, y_i` | append one digit `a_k`, earlier digits fixed |

So the two formulas are mathematically identical but Garner's *arithmetic stays small* throughout the digit solve, and the mixed-radix digits are a positional structure usable for comparison/sign (Section 7–8). This is precisely why Garner dominates in big-integer and NTT contexts.

**A second equivalence (mixed-radix ↔ Newton form).** Garner's mixed-radix expansion is the **Newton interpolation** of the residue data with respect to the "nodes" `p_i`: digit `a_i` is the `i`-th divided-difference-like coefficient, computed from lower coefficients. (CLASSIC) is the **Lagrange** form. The Newton/Lagrange duality of polynomial interpolation is the exact algebraic mirror of the Garner/classic-CRT duality, and explains why Newton's form (Garner) is incremental while Lagrange's (CLASSIC) is not.

---

## 5. Complexity Analysis: The O(k²) Bound

**Theorem 5.1 (Garner runs in O(k²) modular operations).** Computing all digits `a_0, …, a_{k-1}` via `(★)` takes `Θ(k²)` operations on numbers smaller than `p_max²`, plus `k` modular inverses.

**Proof.** Digit `a_i` requires evaluating the partial sum `Σ_{j<i} a_j W_j (mod p_i)`. Done iteratively (maintaining the running partial and the running prefix product mod `p_i`), this is `Θ(i)` multiply-adds. Summing over `i = 0, …, k-1` gives `Σ_i Θ(i) = Θ(k²)`. Each digit also needs one inverse `(W_i)^{-1} mod p_i` at `O(log p_i)`, contributing `O(k log p_max)`, dominated by `Θ(k²)` for `k ≳ log p_max` (and precomputable to `O(1)` amortized when primes are fixed). ∎

**Theorem 5.2 (Assembly cost).** The final big-integer assembly `x = Σ a_i W_i` costs `O(k)` big-integer operations on integers of `≤ B = Σ log_2 p_i` bits. With schoolbook big-int multiply this is `O(k·B)` word operations; the mod-`M` assembly (Corollary 3.4) is `O(k)` machine-word operations.

**Remark (is O(k²) optimal?).** The `O(k²)` reflects that each digit depends on all previous digits' contributions reduced mod the current prime. Asymptotically faster CRT reconstruction exists via a **product/remainder tree** (divide-and-conquer with fast multiplication): building the prefix-product tree and doing a recursive CRT combine achieves `O(M(B) log k)` bit operations, where `M(B)` is the cost of multiplying `B`-bit integers. For large `k` this beats `O(k²)`; for the small `k` of NTT combining (`k = 2, 3, 4`), plain Garner's constant factor and simplicity win decisively. The `O(k²)` is the classic, practical bound; the tree method is the asymptotic refinement.

**Why not just `O(k)`?** A natural question is whether the digit solve can avoid recomputing the partial sum from scratch each row. The obstacle is that the partial `Σ_{j<i} a_j W_j` is needed **modulo the current prime `p_i`**, which changes every row; a partial computed mod `p_{i-1}` cannot be reused mod `p_i`. One could maintain the *exact* running integer `Σ_{j<i} a_j W_j` (a big integer) and reduce it mod `p_i` per row, but the reduction of a `B`-bit integer mod `p_i` is `O(B/w) = O(i)` word operations — still `Θ(k²)` total, now in big-integer reductions rather than mod-`p` multiplies. The quadratic is intrinsic to the linear elimination order; only balancing (the tree) escapes it.

**Theorem 5.3 (Per-element amortization).** When the same fixed moduli are used to reconstruct `N` different residue tuples (the NTT-combine setting), precomputing the `k` prefix-product inverses once makes each reconstruction `Θ(k²)` *multiply-adds with no inverses*. For fixed small `k` this is `Θ(1)` per element, so combining `N` coefficients is `Θ(N)`.

**Exact operation count.** For digit `a_i` (0-indexed), the inner loop runs `i` iterations, each doing two modular multiplications (`a_j·prefix` and `prefix·p_j`) and one addition, plus one final multiply by the inverse. The total modular multiplications are `Σ_{i=0}^{k-1}(2i + 1) = k² ` (since `Σ 2i = k(k-1)` and `Σ 1 = k`, summing to `k²`). So a `k`-prime reconstruction costs exactly `k²` modular multiplications in the digit solve — for `k = 3` that is 9, for `k = 4` it is 16. This precise constant is why the small-`k` NTT combine is effectively free relative to the transforms.

---

## 6. Error, Overflow, and Range Analysis

**Proposition 6.1 (Range correctness).** The reconstructed `x = Σ a_i W_i` satisfies `0 ≤ x < P` exactly (Corollary 2.2). If the true value `v` to be represented satisfies `0 ≤ v < P`, then `x = v`. If `v ≥ P`, then `x = v mod P ≠ v` — a **silent** error.

**Consequence (the prime-product bound).** To recover an exact value `v`, the moduli must satisfy `P = ∏ p_i > v_max`. For signed values in `[−V, V)`, require `P > 2V` and use centered recovery (Section 8). Failing this bound causes wraparound with no exception — the single most dangerous Garner/NTT defect.

**Proposition 6.2 (Intermediate overflow bound).** In the digit solve, the largest pre-reduction quantity is a product of two values each `< p_i`, i.e. `< p_i² ≤ p_max²`. If `p_max < 2^{w/2}` for a `w`-bit integer type, all products fit before reduction. For `p_max ≥ 2^{w/2}` (e.g. 62-bit NTT primes in 64-bit words), a wider multiply (128-bit, or Montgomery/Barrett reduction, `14-montgomery-multiplication`) is required.

**Proposition 6.3 (Homomorphism / reduction commutes).** Let `φ_m : ℤ → ℤ_m` be reduction mod `m`. Garner's digit recurrence `(★)` only uses `+`, `−`, `×`, and inverse mod `p_i`; since `φ_{p_i}` is a ring homomorphism, interleaving reductions at every step yields the same digits as computing exactly then reducing. Likewise the mod-`M` assembly is correct because `φ_M(Σ a_i W_i) = Σ φ_M(a_i) φ_M(W_i)`. This justifies "reduce in the inner loop" and the no-big-integer mod-`M` reconstruction.

**Error model summary.**

| Source | Effect | Guard |
|--------|--------|-------|
| `P ≤ v_max` | `x = v mod P` (wraparound) | bound check `∏ p_i > v_max` |
| `p_i` not coprime | inverse missing / wrong `x` | `gcd` pairwise check |
| `r_i ∉ [0, p_i)` | wrong first digit | normalize residues |
| product overflow `> 2^w` | corrupted digit | 128-bit / Montgomery |
| signedness ignored | result off by `P` | centered recovery |

---

## 7. Residue Number System Theory

The residue map `ρ` of Definition 1.1 is a **ring isomorphism** `ℤ_P ≅ ∏_i ℤ_{p_i}` (Theorem 3.1). Three consequences structure all RNS practice:

**7.1 Carry-free arithmetic.** `+, −, ×` in `∏_i ℤ_{p_i}` are componentwise, so RNS addition/multiplication of two `k`-residue numbers are `k` independent operations — no carry propagation, fully parallel. This is the speed argument for RNS in cryptography and bignum.

**7.2 Hard operations need magnitude.** Order comparison, sign, exact division, and overflow detection are **not** ring operations on `∏_i ℤ_{p_i}`; they depend on the positional magnitude of the represented integer. The isomorphism `ρ` is order-*destroying*: residue tuples carry no ordering information. Recovering order requires (partial) reconstruction.

**Theorem 7.3 (Mixed-radix supports comparison).** Given two values by their mixed-radix digit vectors `a = (a_0, …, a_{k-1})` and `b = (b_0, …, b_{k-1})` (same moduli), `x_a < x_b` iff `a < b` in **reverse-lexicographic** order (compare the highest-weight digit `a_{k-1}` vs `b_{k-1}` first; on ties descend).

**Proof.** `x = Σ a_i W_i` with `0 ≤ a_i < p_i` and weights `W_0 < W_1 < … < W_{k-1}`, and crucially `W_{i+1} = W_i p_i > W_i · (max digit at i) = W_i(p_i − 1) ≥ Σ_{j≤i} a_j W_j` worst case — i.e. each weight exceeds the maximum possible contribution of all lower digits combined (a "carry-free positional" property, the mixed-radix analogue of `10^{i+1} > Σ_{j≤i} 9·10^j`). Hence the highest differing digit dominates, giving reverse-lex order. ∎

This is why Garner's mixed-radix digits — not the raw residues — are the right RNS structure for the magnitude-dependent operations: they linearize the order.

**7.4 Base extension as a ring map composition.** Adding a new channel `p_k` is computing `ρ_{p_k}(x)` from `ρ(x)`. Via Garner, `x mod p_k = (Σ a_i W_i) mod p_k`, an `O(k)` evaluation once the digits are known — no full reconstruction needed (Section 10).

---

## 8. Signed and Centered Reconstruction

Garner yields `x ∈ [0, P)`. For applications whose true values lie in `[−⌊P/2⌋, ⌈P/2⌉)`, define the **centered representative**:

```
center(x) = x        if  2x < P,
            x − P     if  2x ≥ P.
```

**Proposition 8.1.** If the true value `v ∈ [−⌊P/2⌋, ⌈P/2⌉)` and `ρ(v) = r` (residues taken in `[0, p_i)`), then `center(garner(r)) = v`.

**Proof.** `garner(r) = v mod P ∈ [0, P)`. If `v ≥ 0`, then `v mod P = v < P/2` (since `v < P/2`), and `center` returns `v`. If `v < 0`, then `v mod P = v + P ∈ [P/2, P)`, and `center` subtracts `P`, returning `v`. ∎

**Centered residues variant.** Alternatively keep each `r_i` in `(−p_i/2, p_i/2]`; the digit solve is identical with signed normalization, and the resulting digits encode the signed value directly, avoiding a final `≥ P/2` test (useful when `P` is not materialized, e.g. in the mod-`M` pipeline where you instead track sign separately). The pitfall is consistent normalization at every subtraction; an asymmetric `%` corrupts the sign. This is the formal basis for the "off-by-`P`" failure mode of Section 9 in [`senior.md`](./senior.md).

---

## 9. Non-Coprime Moduli and Generalized Reconstruction

Garner's recurrence requires `gcd(W_i, p_i) = 1`, which **fails** if the moduli are not pairwise coprime. The general theory:

**Theorem 9.1 (CRT with non-coprime moduli).** A system `x ≡ r_i (mod m_i)` has a solution iff for every pair `r_i ≡ r_j (mod gcd(m_i, m_j))`; when solvable, the solution is unique modulo `lcm(m_i)`.

**Reconstruction by pairwise merge.** Merge two congruences `x ≡ r_1 (mod m_1)`, `x ≡ r_2 (mod m_2)` using the extended Euclidean algorithm (`06-extended-euclidean-modular-inverse`): let `g = gcd(m_1, m_2)`, check `r_1 ≡ r_2 (mod g)` (else no solution), and combine into a single congruence mod `lcm(m_1, m_2)`. Iterating gives generalized CRT. This **reduces to plain Garner** when all `g = 1` (the pairwise-coprime case), but with non-coprime moduli the mixed-radix prefix-product inverses do not exist and the merge form must be used (see `05-crt`).

**Reduction to coprime case.** Any non-coprime system can be *split* into a coprime one by prime-factorizing each modulus and keeping, for each prime power, the strongest constraint (largest exponent), after checking consistency. The resulting coprime system is then solvable by Garner. This is mostly of theoretical interest; in practice one either guarantees coprime primes by construction (NTT, RNS) or uses the merge form.

---

## 10. Base Extension and Incrementality

**Proposition 10.1 (Incremental digit append).** Adding a new coprime modulus `p_k` with residue `r_k` extends an existing Garner reconstruction by one digit: the digits `a_0, …, a_{k-1}` are unchanged, and

```
a_k = ( r_k − Σ_{j<k} a_j W_j ) · (W_k)^{-1}   (mod p_k),     W_k = ∏_{j<k} p_j = old P.
```

**Proof.** Theorem 3.2's recurrence for index `k` depends only on `r_k`, the already-fixed digits `a_{j<k}`, and `W_k`; none of the earlier digits' defining equations reference `p_k`. Hence appending is `O(k)` extra work. ∎

This is the **Newton-form incrementality** of Section 4: Garner is online in the number of moduli, whereas the classic Lagrange formula (CLASSIC) must recompute every `M_i = P/p_i` when `P` changes. It is the formal reason RNS systems can *add a channel* cheaply (base extension) when an intermediate product threatens to exceed the current product `P`.

**Base extension without full reconstruction.** To get `x mod p_new` (a new prime) from residues `(p_0, …, p_{k-1})`: run Garner to obtain digits `a_i`, then evaluate `Σ_i a_i (W_i mod p_new) (mod p_new)` in `O(k)`. The big integer `x` is never formed — only its image mod `p_new`. This is the workhorse of RNS overflow management.

---

## 10.5 Worked Proof Trace

To make Theorem 3.2 concrete, trace the digit recurrence on `p = (3, 5, 7)`, `r = (2, 3, 2)`, whose unique solution is `x = 23` (the value we will recover).

**Digit `a_0` (mod 3).** Empty partial sum, `W_0 = 1`, so `a_0 ≡ r_0·1^{-1} = 2 (mod 3)`, giving `a_0 = 2`. This is forced because `x = a_0 + a_1·3 + a_2·15 ≡ a_0 (mod 3)` and `x ≡ 2 (mod 3)`.

**Digit `a_1` (mod 5).** Prefix product `W_1 = 3 ≡ 3 (mod 5)`. Partial `= a_0·W_0 = 2 (mod 5)`. Then

```
a_1 = (r_1 − partial)·(W_1)^{-1} = (3 − 2)·3^{-1} = 1·2 = 2  (mod 5),
```

since `3^{-1} ≡ 2 (mod 5)`. So `a_1 = 2`. Indeed `x ≡ a_0 + a_1·3 = 2 + 6 = 8 ≡ 3 (mod 5)` ✓.

**Digit `a_2` (mod 7).** Prefix product `W_2 = 15 ≡ 1 (mod 7)`. Partial `= a_0·1 + a_1·(3 mod 7) = 2 + 6 = 8 ≡ 1 (mod 7)`. Then

```
a_2 = (r_2 − partial)·(W_2)^{-1} = (2 − 1)·1^{-1} = 1  (mod 7).
```

So `a_2 = 1`. Assembling: `x = 2 + 2·3 + 1·15 = 23`. Each step used arithmetic mod a single prime ≤ 7, never mod `P = 105` — the concrete manifestation of Corollary 3.3. The digits `(2, 2, 1)` are exactly the unique mixed-radix digits of 23 over the variable bases `(3, 5, 7)`, confirming Theorem 2.1 and Theorem 3.2 simultaneously.

---

## 10.6 The Product/Remainder Tree (Fast CRT)

For very large `k`, the `O(k²)` of plain Garner can be improved to a near-linear (in bit-length) bound using **divide and conquer with fast integer multiplication**. The construction:

1. **Product tree.** Build a balanced binary tree whose leaves are `p_0, …, p_{k-1}` and whose internal nodes store the product of their children's products. The root is `P = ∏ p_i`. Building the tree costs `O(M(B) log k)` where `B = log_2 P` and `M(B)` is the cost of multiplying `B`-bit integers (`M(B) = O(B log B)` with FFT-based multiplication).

2. **Remainder tree.** Propagate `x` (unknown) — actually, propagate the CRT combination upward. At each internal node combine the two children's partial solutions via a two-modulus CRT merge using the precomputed subtree products. The recursion `T(k) = 2 T(k/2) + O(M(B))` solves to `O(M(B) log k)`.

**Theorem 10.5.1.** CRT reconstruction of `k` residues with product of bit-length `B` can be performed in `O(M(B) log k)` bit operations.

**When it beats Garner.** Plain Garner's `O(k²)` mod-`p` operations cost `O(k² · w)` word operations for word-size primes (`w`-bit). The tree costs `O(M(B) log k) = O(B log B log k)` with `B ≈ k·w`. For large `k` (hundreds to thousands of primes — RNS bignum, cryptographic moduli), the tree wins; for the `k = 2, 3, 4` of NTT combining, Garner's tiny constant and cache-friendliness dominate. This is the standard "Modern Computer Arithmetic" (Brent–Zimmermann) result.

**Relation to Garner.** The tree is *not* mixed-radix; it is a balanced application of the two-modulus merge. Garner's mixed-radix form is the *unbalanced* (linear-chain) special case of the same divide-and-conquer, which is why Garner is `O(k²)` (a chain of depth `k`) while the balanced tree is `O(M(B) log k)`. Garner trades asymptotic optimality for simplicity, incrementality, and small constants.

---

## 10.7 Numerical Stability and Integer Exactness

Unlike floating-point reconstruction methods (e.g. recovering `x` from `Σ r_i/p_i`-style approximations used in some RNS-to-binary conversions), Garner is **exact integer arithmetic** throughout. There is no rounding, no catastrophic cancellation, and no error accumulation across digits: every intermediate is an exact residue in `[0, p_i)`. This is a decisive advantage for applications requiring bit-exact results (cryptography, exact polynomial arithmetic, computer algebra).

The only "stability" concern is the **range hypothesis** `P > v_max` (Proposition 6.1): violating it produces an exact but *wrong* (wrapped) answer, not an approximate one. Thus Garner's correctness is binary — either the range covers the value (exact recovery) or it does not (exact recovery of `v mod P`). There is no graceful degradation, which is why the product-bound proof obligation is non-negotiable.

**Contrast with approximate RNS-to-binary.** Some hardware RNS converters use the *Chinese Remainder Theorem with fractional values* (the "approximate CRT"): `x/P ≈ Σ (r_i · (P/p_i)^{-1} mod p_i)/p_i (mod 1)`. This is fast but introduces floating-point error that can flip the integer part near boundaries. Garner's mixed-radix conversion avoids this entirely by staying in exact modular integer arithmetic — at the cost of being inherently sequential in the digits.

---

## 10.8 The Mixed-Radix Number System as a Group/Ring Structure

The set `D = ∏_i {0, …, p_i − 1}` of digit tuples, together with the bijection `Φ : D → ℤ_P`, inherits a ring structure from `ℤ_P` by transport. But the *direct* arithmetic on digit tuples is **not** componentwise — it involves carries, exactly like ordinary multi-digit addition.

**Mixed-radix addition with carry.** To add two mixed-radix numbers `a` and `b` digit-wise: `s_0 = (a_0 + b_0)`, emit `s_0 mod p_0`, carry `⌊s_0 / p_0⌋` into position 1, where the carry is multiplied appropriately by the ratio of consecutive weights. Because `W_{i+1}/W_i = p_i`, a carry out of position `i` adds 1 to position `i+1` — the familiar positional carry, with variable bases. This is why the **mixed-radix representation supports comparison and addition** (Theorem 7.3) while raw residues do not: the carry chain encodes magnitude.

**Why RNS chooses residues over mixed-radix for arithmetic.** Residue (RNS) arithmetic is carry-free and parallel — its entire appeal. Mixed-radix arithmetic has carries (sequential), so it is *worse* for bulk arithmetic but *better* for magnitude operations. The practical pattern is therefore: compute in **residues** (RNS, parallel), convert to **mixed-radix** (Garner) only when magnitude is needed. Garner is precisely the bridge between the two representations, and the carry structure of mixed-radix is what makes that bridge yield comparison/sign for free.

**Lemma 10.8.1 (carry bound).** When adding two valid mixed-radix numbers, every carry is `0` or `1`. *Proof.* `s_i = a_i + b_i + c_i` with `a_i, b_i ≤ p_i − 1` and incoming carry `c_i ∈ {0,1}`, so `s_i ≤ 2(p_i − 1) + 1 = 2p_i − 1 < 2 p_i`, hence `⌊s_i / p_i⌋ ∈ {0, 1}`. ∎ This bounds the cost of mixed-radix addition at `O(k)` with single-bit carries, the analogue of binary ripple-carry.

---

## 10.9 Comparison of Reconstruction Algorithms

A consolidated comparison of the three classical CRT reconstruction strategies, all computing the identical `x`:

| Algorithm | Idea | Largest intermediate | Incremental? | Best for |
|-----------|------|----------------------|--------------|----------|
| **Garner (mixed-radix)** | solve digits `a_i` sequentially via prefix-product inverses | `< p_max²` (digit solve) | yes (Newton form) | bignum, NTT combine, RNS exit |
| **Classic CRT (Lagrange)** | `Σ r_i (P/p_i)(…)^{-1} mod P` | `≈ P` (the `M_i`) | no (recompute all `M_i`) | small `P` fitting a word; closed-form clarity |
| **Iterated 2-modulus merge** | fold pairs `(r,m)` into one congruence mod `lcm` | grows to `P` (running modulus) | yes (append) | non-coprime moduli; simple online merge |
| **Product/remainder tree** | balanced divide-and-conquer + fast multiply | `≈ P` (subtree products) | no | very large `k`, asymptotic speed |

**Theorem 10.9.1 (all four agree).** On pairwise-coprime moduli, all four algorithms output the same `x ∈ [0, P)`. *Proof.* Each produces a value congruent to `r_i (mod p_i)` for all `i` and lying in `[0, P)`; by CRT uniqueness (Theorem 3.1) these are equal. ∎

The distinction is *operational*, not *mathematical*: they differ only in operand size, incrementality, and constants — which is exactly what determines the right choice in practice. Garner's combination of small operands, incrementality, and a magnitude-bearing output (mixed-radix digits) is why it dominates the bignum/NTT/RNS niche.

---

## 10.10 Lower Bound and Optimality Remarks

**Information-theoretic floor.** Reconstructing `x` requires reading all `k` residues (`Ω(k)` operations) and producing an output of `B = Σ log_2 p_i` bits (`Ω(B)` to write it). So no algorithm beats `Ω(k + B)`. The product/remainder tree's `O(M(B) log k)` is within a `log k · (M(B)/B)` factor of this floor — near-optimal for large `k`.

**Why Garner is `Θ(k²)` and not better in the schoolbook model.** Each digit `a_i` depends on the partial reconstruction `Σ_{j<i} a_j W_j mod p_i`, an `i`-term sum. Without fast multiplication or a balanced tree, this dependency chain forces `Σ_i i = Θ(k²)`. The quadratic is not wasteful — it is the cost of the linear (unbalanced) elimination order. Balancing the order (the tree) is the only way to reduce it, and it requires fast multiplication to pay off.

**Practical optimality for small `k`.** For `k ≤ ~16`, `k²` is at most a few hundred cheap modular multiplies — far below the overhead of building product/remainder trees or invoking FFT-based multiplication. Hence the universal practical advice: **Garner for small `k` (the common case), tree for large `k` (the rare case).** The crossover depends on the multiplication implementation but is typically in the dozens-to-hundreds of primes range.

---

## 10.11 Connection to NTT and Polynomial Arithmetic

The number-theoretic transform (`13-ntt`) computes a cyclic convolution `c = a ⊛ b` modulo a prime `q` with a suitable root of unity. The convolution coefficients `c_t = Σ_{i} a_i b_{t-i}` are integers; a single NTT recovers only `c_t mod q`. Garner is the mechanism that lifts several `c_t mod q_s` (one per prime `q_s`) back to the integer `c_t` (or `c_t mod M`).

**Theorem 10.11.1 (correctness of multi-prime convolution).** Let `q_0, …, q_{k-1}` be pairwise-coprime NTT-friendly primes with `Q = ∏ q_s > max_t |c_t|`. Computing `c^{(s)} = (a ⊛ b) mod q_s` for each `s` and Garner-combining the residues `(c^{(0)}_t, …, c^{(k-1)}_t)` for each output index `t` yields the exact `c_t`.

**Proof.** NTT correctness gives `c^{(s)}_t = c_t mod q_s`. Garner reconstructs the unique value in `[0, Q)` congruent to `c_t` mod every `q_s` (Theorem 3.2); since `0 ≤ c_t < Q` (by the range hypothesis, after centering for signed coefficients), that value is exactly `c_t`. ∎

**Why this is the canonical industrial use of Garner.** A degree-`n` polynomial product has `~2n` coefficients, each needing a reconstruction; with `k` fixed primes the per-coefficient Garner is `Θ(k²)` constant-time work with precomputed inverses, so combining is `Θ(n)` overall — negligible beside the `Θ(n log n)` NTTs. The polynomial-arithmetic stack (`20-polynomial-operations`) thus rests on: NTT for fast convolution per prime, Garner for exact lift across primes. Without Garner, multi-prime NTT could not return exact (or large-modulus) coefficients.

**Coefficient bound drives the prime count.** For `|a_i|, |b_i| ≤ V` and `n`-term sums, `|c_t| ≤ n V²`. Choosing the smallest `k` with `∏ q_s > 2 n V²` (the factor 2 for signed coefficients, recovered by centering, Section 8) is the design rule. Over-provisioning a prime wastes a full `Θ(n log n)` NTT pass; under-provisioning silently wraps (Proposition 6.1). This is the formal statement of the senior-level "choosing the primes" discussion.

---

## 10.12 Generalized Mixed-Radix and Factor-Base Variants

Garner's weights are the prefix products of the chosen moduli, but the mixed-radix framework generalizes.

**Arbitrary radix sequences.** Any sequence of bases `b_0, b_1, …` with weights `W_0 = 1`, `W_{i+1} = W_i b_i` yields a positional system; Garner is the special case `b_i = p_i`. Factorial number system (`b_i = i+1`, weights `i!`), and ordinary base-`b` (`b_i = b`) are other instances. The uniqueness theorem (Theorem 2.1) holds whenever each digit ranges over `[0, b_i)` — the proof used only the carry-free weight bound `W_{i+1} > Σ_{m≤i}(b_m − 1)W_m`, which holds for any positive bases.

**Prime-power moduli.** If a modulus is a prime power `p^e` (still pairwise coprime to the others), Garner works verbatim — primality is never used, only coprimality and invertibility of the prefix product. This matters when an RNS uses `p^e` channels for alignment with machine arithmetic (e.g. `2^{32}` or `2^{64}` as one "prime-power" channel coprime to odd primes).

**Theorem 10.12.1 (Garner over prime powers).** With pairwise-coprime moduli `m_i` (each possibly a prime power), the recurrence `(★)` with `p_i := m_i` recovers the unique `x ∈ [0, ∏ m_i)`, provided each prefix product `∏_{j<i} m_j` is invertible mod `m_i` — which holds exactly because the `m_i` are pairwise coprime. *Proof.* Identical to Theorem 3.2; coprimality, not primality, is the only hypothesis used. ∎

**A subtlety with `2^w` channels.** Using `m = 2^{64}` as a channel makes its arithmetic free (native wraparound), but the prefix-product inverse mod `2^{64}` exists only if the prefix product is **odd** — i.e. all other moduli are odd. This is automatically satisfied when the other channels are odd primes, and is the standard configuration in high-performance RNS bignum libraries. It is a clean illustration that the abstract requirement "prefix product invertible mod `m_i`" is the true hypothesis, with "pairwise coprime primes" merely the most common way to guarantee it.

---

## 10.13 The Newton-Form Derivation in Detail

Section 4 asserted Garner is the Newton-interpolation analogue of CRT. Here is the precise correspondence, which both proves the equivalence and explains the incrementality structurally.

**The interpolation analogy.** Polynomial interpolation through points `(x_0, y_0), …, (x_{k-1}, y_{k-1})` has two classical forms. Lagrange writes `p(x) = Σ_i y_i L_i(x)` with global basis polynomials `L_i`. Newton writes `p(x) = c_0 + c_1(x − x_0) + c_2(x − x_0)(x − x_1) + …`, where `c_i` is the `i`-th divided difference, computed incrementally from `c_0, …, c_{i-1}`.

**The CRT dictionary.** Replace the polynomial ring `K[x]` evaluated at nodes `x_i` by the integer ring `ℤ` reduced at moduli `p_i`. The "evaluation" `p(x_i) = y_i` becomes `x ≡ r_i (mod p_i)`. The Newton basis products `(x − x_0)·…·(x − x_{i-1})` become the prefix products `W_i = p_0·…·p_{i-1}`. The divided differences `c_i` become the mixed-radix digits `a_i`. Under this dictionary:

```
Newton:  p(x) = Σ_i c_i · ∏_{j<i}(x − x_j),     c_i from c_{j<i}.
Garner:  x    = Σ_i a_i · ∏_{j<i} p_j,           a_i from a_{j<i}.
```

**Theorem 10.13.1.** Garner's digit recurrence `(★)` is exactly the Newton divided-difference recurrence transported along the ring homomorphisms `ℤ → ℤ_{p_i}`.

**Proof sketch.** The Newton coefficient `c_i` is determined by forcing `p(x_i) = y_i` given `c_{j<i}`: `c_i = (y_i − Σ_{j<i} c_j ∏_{l<j}(x_i − x_l)) / ∏_{j<i}(x_i − x_j)`. Reducing the integer analogue mod `p_i` (where `x_i − x_l` becomes the residue-difference and the product `∏_{j<i} p_j` becomes `W_i`), and replacing division by multiplication with the modular inverse `(W_i)^{-1} mod p_i`, yields `(★)` verbatim. ∎

**Why this matters.** The Newton form is incremental *because* adding a node only appends one divided-difference coefficient; the existing ones are unchanged. Transported to CRT, this is exactly Proposition 10.1: appending a modulus appends one mixed-radix digit. The Lagrange form is non-incremental because every basis polynomial `L_i` (resp. every `M_i = P/p_i`) depends on *all* nodes. Thus the Garner-vs-classic distinction is not an accident of algorithm design but a reflection of the deep Newton-vs-Lagrange duality of interpolation.

---

## 10.14 Worked Non-Coprime Detection

To illustrate Section 9, consider the *non-coprime* system `x ≡ 2 (mod 6)`, `x ≡ 5 (mod 9)`. Here `gcd(6, 9) = 3 ≠ 1`, so plain Garner's prefix-product inverse `(6)^{-1} mod 9` does not exist (`gcd(6, 9) = 3`).

**Consistency check.** A solution exists iff `2 ≡ 5 (mod gcd(6,9) = 3)`, i.e. `2 ≡ 5 (mod 3)` ⟺ `2 ≡ 2 (mod 3)` ✓ — consistent.

**Generalized merge.** Solve `x = 2 + 6t` with `2 + 6t ≡ 5 (mod 9)` ⟹ `6t ≡ 3 (mod 9)` ⟹ `2t ≡ 1 (mod 3)` (dividing by `gcd = 3`) ⟹ `t ≡ 2 (mod 3)`. So `t = 2 + 3s`, `x = 2 + 6(2 + 3s) = 14 + 18s`, i.e. `x ≡ 14 (mod 18)` with `18 = lcm(6, 9)`. The solution is unique mod `lcm`, not mod the product `54`.

**Contrast with a contradictory system.** `x ≡ 1 (mod 6)`, `x ≡ 2 (mod 9)`: need `1 ≡ 2 (mod 3)` ⟺ `1 ≡ 2 (mod 3)` ✗ — **no solution**. Plain Garner would silently produce a meaningless number; the generalized merge correctly reports infeasibility. This is the formal justification for the pairwise-coprime precondition: it is exactly the regime where the consistency check is vacuous (`gcd = 1` makes any pair consistent) and the inverse always exists.

---

## 10.15 Detailed Proof of the mod-`M` Assembly

Corollary 3.4 claimed `x mod M = (Σ_i a_i (W_i mod M)) mod M` with all intermediates `< M²`. The detail matters for the overflow-free engineering of `senior.md`.

**Proposition 10.15.1.** Let the mixed-radix digits `a_i ∈ [0, p_i)` satisfy `x = Σ_i a_i W_i` (Theorem 3.2). Define the recurrence

```
acc_0 = 0,   w_0 = 1,
acc_{i+1} = (acc_i + (a_i mod M)·w_i) mod M,
w_{i+1}   = (w_i · (p_i mod M)) mod M.
```

Then `acc_k ≡ x (mod M)`, and every intermediate product `(a_i mod M)·w_i` is `< M²`.

**Proof.** By induction, `w_i ≡ W_i (mod M)` (since `W_{i+1} = W_i p_i` and reduction is multiplicative). And `acc_i ≡ Σ_{j<i} a_j W_j (mod M)`: the base case `acc_0 = 0` is the empty sum; the step adds `(a_i mod M) w_i ≡ a_i W_i (mod M)`. Hence `acc_k ≡ Σ_j a_j W_j = x (mod M)`. Each factor `a_i mod M < M` and `w_i < M`, so the product is `< M²`. ∎

**Corollary 10.15.2 (no big integers needed for `x mod M`).** Computing `x mod M` requires only the digit solve (intermediates `< p_max²`) and this assembly (intermediates `< M²`). If `p_max < 2^{31}` and `M < 2^{31}`, all values fit in signed 64-bit; no arbitrary-precision arithmetic is invoked. This is the precise guarantee behind the NTT-combine pipeline's word-sized operation.

**Remark on the digit reduction `a_i mod M`.** Since `a_i < p_i` and typically `p_i < M` (NTT primes vs. a `10^9+7`-class `M`), `a_i mod M = a_i`; the reduction is a no-op in the common case but is written for safety when `p_i > M`.

**Corollary 10.15.3 (independence from `M`).** The mixed-radix digits `a_i` are computed once and are independent of the target modulus `M`; only the assembly depends on `M`. Hence one digit solve can be followed by assembly modulo *several* different `M` values (or both a big-int assembly and a mod-`M` assembly) at the marginal cost of `O(k)` each. This is useful when a result is needed both exactly and reduced, or modulo multiple problem moduli — the expensive part (the digits) is shared.

---

## 10.16 Edge Cases and Their Formal Resolution

| Edge case | Formal behavior | Resolution |
|-----------|-----------------|-----------|
| `k = 1` | `Φ` is the identity `a_0 ↦ a_0` on `[0, p_0)`; `x = r_0`. | Loop produces one digit, returns `r_0`. |
| Some `r_i = 0` | `a_i` may be `0`; perfectly valid digit. | No special handling. |
| `x = 0` | All `a_i = 0`; the unique zero tuple. | Reconstructs to `0`. |
| `x = P − 1` | All digits maximal `a_i = p_i − 1` (the carry-free bound is tight). | Reconstructs to `P − 1`, the top of the range. |
| `r_i` un-reduced (`r_i ≥ p_i`) | First digit `a_0 = r_0 mod p_0 ≠ intended`. | Normalize `r_i ← r_i mod p_i` on entry. |
| Negative `r_i` | `(r_i − partial)` may be negative pre-mod. | `((·) mod p_i + p_i) mod p_i`. |
| Two equal moduli `p_i = p_j` | `gcd = p_i ≠ 1`: not pairwise coprime; inverse fails. | Reject; merge or deduplicate. |
| `M = 1` | `x mod 1 = 0` trivially. | Assembly returns `0`. |

**Theorem 10.16.1 (boundary tightness).** The carry-free weight bound `W_{i+1} > Σ_{m≤i}(p_m − 1)W_m` is an equality at the top: `Σ_i (p_i − 1) W_i = W_k − 1 = P − 1`. *Proof.* Telescoping: `Σ_i (p_i − 1) W_i = Σ_i (W_{i+1} − W_i) = W_k − W_0 = P − 1`. ∎ This confirms the digit tuple `(p_0−1, …, p_{k-1}−1)` maps exactly to `P − 1`, so the bijection `Φ` covers `[0, P)` with no gap and no overlap — the combinatorial heart of uniqueness.

**Practical upshot.** These edge cases are individually trivial, but collectively they form the test matrix any robust implementation must pass: the empty/singleton cases (`k = 1`, `M = 1`), the boundary values (`0` and `P − 1`), the input-hygiene cases (un-reduced, negative), and the precondition violations (equal/non-coprime moduli). A reconstruction that handles all eight rows correctly, plus the round-trip property, is correct for all valid inputs — there are no exotic failure cases beyond this table once the product bound (Proposition 6.1) is enforced.

---

## 11. Summary

- **Mixed-radix uniqueness (Theorem 2.1).** Every `x ∈ [0, P)` has a unique representation `Σ a_i W_i` with `0 ≤ a_i < p_i`, by a counting bijection. This is the base-`b` uniqueness theorem generalized to variable bases, and it guarantees the digit solve has exactly one answer — and that the sum lies in `[0, P)` with no final reduction.
- **Garner correctness (Theorem 3.2).** Reducing `x = Σ a_i W_i` mod `p_i` kills future terms, so digit `a_i` is forced: `a_i = (r_i − Σ_{j<i} a_j W_j)·(W_i)^{-1} mod p_i`. Induction shows the computed digits equal the true mixed-radix digits. The prefix-product inverse exists by pairwise coprimality.
- **Single-prime arithmetic (Corollary 3.3).** The digit solve never exceeds `p_i²`; big integers appear only in optional exact assembly. For `x mod M`, everything stays `< M²` (Corollary 3.4) by the reduction homomorphism (Proposition 6.3).
- **Equivalence to classic CRT (Theorem 4.1).** Garner and the Lagrange formula compute the identical `x`; the duality mirrors Newton vs Lagrange interpolation. Garner's operands stay small, it needs no reduction mod `P`, and it is incremental — hence preferred for bignum/NTT.
- **Complexity (Theorems 5.1–5.3).** `O(k²)` modular operations for the digits, `O(k)` for assembly; fixed primes amortize inverses so per-element combine is `Θ(1)` for small `k`. A product/remainder tree gives `O(M(B) log k)` for large `k`.
- **Range/overflow (Section 6).** Correct iff `P > v_max` (signed: `P > 2V`); otherwise silent wraparound. Intermediate products bounded by `p_max²`; widen or use Montgomery beyond half-word primes.
- **RNS theory (Section 7).** `ρ : ℤ_P ≅ ∏ ℤ_{p_i}` is an order-destroying ring isomorphism; comparison/sign/division need magnitude, recovered via mixed-radix digits (reverse-lex order, Theorem 7.3). Garner is the RNS exit and base-extension engine.
- **Signed recovery (Section 8).** Center into `[−P/2, P/2)`; forgetting this is an off-by-`P` bug.
- **Non-coprime (Section 9).** Plain Garner fails; use the gcd-consistency pairwise merge (generalized CRT), which reduces to Garner when all gcds are 1.
- **Incrementality (Section 10).** Appending a modulus adds one digit in `O(k)` (Newton-form), enabling cheap base extension — compute `x mod p_new` from existing residues without forming the big integer.
- **Fast CRT (Section 10.6).** For large `k`, the product/remainder tree with fast multiplication achieves `O(M(B) log k)` bit operations, near the `Ω(k + B)` information-theoretic floor; Garner is the unbalanced (linear-chain) special case, optimal in constants for small `k`.
- **NTT/polynomial use (Section 10.11).** Multi-prime NTT computes a convolution mod several primes; Garner lifts the per-coefficient residues to the exact integer (or value mod `M`). With precomputed inverses this is `Θ(n)` over all coefficients — negligible beside the `Θ(n log n)` transforms — and is the foundation of fast exact polynomial multiplication (`20-polynomial-operations`).
- **Generalization (Section 10.12).** The framework extends to arbitrary radix sequences, prime powers, and `2^w` channels; the only true requirement is that each prefix product be a unit modulo the current modulus.

### Complexity Cheat Table

| Task | Method | Complexity |
|------|--------|-----------|
| Solve mixed-radix digits | Garner recurrence `(★)` | `O(k²)` mod ops |
| Assemble exact big `x` | `Σ a_i W_i` (big-int) | `O(k·B)` word ops, `B = Σ log p_i` bits |
| Assemble `x mod M` | mod-`M` sum | `O(k)` word ops |
| Precomputed-inverse per-element combine | fixed primes | `Θ(k²)` mults, `Θ(1)` for small `k` |
| Fast CRT (large `k`) | product/remainder tree | `O(M(B) log k)` bit ops |
| Add a modulus / base extend | append one digit | `O(k)` |
| Non-coprime reconstruct | gcd pairwise merge | `O(k · log m)` per merge |

### Theorem Index

| # | Statement | Role |
|---|-----------|------|
| 2.1 | Mixed-radix existence & uniqueness | foundation of correctness |
| 3.1 | CRT ring isomorphism | existence of the target `x` |
| 3.2 | Garner digit recurrence is correct | the algorithm works |
| 4.1 | Garner ≡ classic CRT formula | same answer, different cost |
| 5.1–5.3 | `O(k²)` digit solve, amortization | complexity |
| 6.1 | Range correctness / silent wraparound | the product-bound obligation |
| 7.3 | Mixed-radix supports comparison | RNS magnitude recovery |
| 8.1 | Centered (signed) recovery | sign handling |
| 9.1 | Generalized CRT (non-coprime) | beyond pairwise-coprime |
| 10.1 | Incremental digit append | base extension |
| 10.5.1 | Product/remainder tree `O(M(B) log k)` | asymptotic fast CRT |
| 10.13.1 | Newton-form transport | structural equivalence |
| 10.15.1 | mod-`M` assembly correctness | overflow-free pipeline |
| 10.16.1 | Boundary tightness `Σ(p_i−1)W_i = P−1` | bijection completeness |

### Closing Notes

- **Newton/Lagrange duality** (Sections 4, 10.13): Garner is the Newton interpolation of residue data; its incrementality and small operands follow from that structure, not coincidence. The classic CRT formula is the Lagrange form, which is why it is non-incremental and uses big `M_i = P/p_i` operands.
- **Order destruction** (Section 7): the CRT isomorphism `ρ : ℤ_P ≅ ∏ ℤ_{p_i}` erases magnitude; mixed-radix digits restore it (reverse-lexicographic order, Theorem 7.3), which is why Garner — not raw residues — underlies RNS comparison, sign, and overflow detection.
- **The product bound** (Section 6): `P > v_max` (or `> 2V` signed) is the one inequality whose violation is silent (Proposition 6.1); prove it, don't assume it. Under-provisioning a prime wraps; over-provisioning wastes an NTT pass (Section 10.11).
- **Coprimality, not primality** (Sections 10.12, 10.14): the true hypothesis is that each prefix product is invertible mod `p_i`, guaranteed by pairwise coprimality. Prime-power and `2^w` channels work verbatim when the prefix product is a unit.
- **Half-word primes** (Section 6.2): keep `p_max < 2^{w/2}` for overflow-free 64-bit work; for larger primes use 128-bit multiply or Montgomery/Barrett reduction (`14-montgomery-multiplication`).
- **Exactness over approximation** (Section 10.7): Garner is bit-exact integer arithmetic; its correctness is binary (covers the range or wraps), with no floating-point error, unlike approximate RNS-to-binary converters.

### The Single Most Important Theorem

If one result must be remembered, it is the pairing of **Theorem 2.1 (uniqueness)** and **Theorem 3.2 (the recurrence recovers it)**. Uniqueness guarantees there is exactly one digit tuple to find; the recurrence finds it greedily, each digit forced by reducing the (as-yet-unknown) `x = Σ a_m W_m` modulo `p_i` and solving the resulting one-unknown congruence with the prefix-product inverse. Everything else — the `O(k²)` bound, the overflow-free single-prime arithmetic, the equivalence to the classic formula, the RNS exit role, the NTT lift — is a consequence or an application of this pair. The mixed-radix representation is the data structure; the digit recurrence is the algorithm; uniqueness is the reason the algorithm is correct and the answer is well-defined.

The deeper unifying idea is the **CRT ring isomorphism** `ℤ_P ≅ ∏_i ℤ_{p_i}` (Theorem 3.1): it makes residue arithmetic carry-free and parallel but destroys magnitude. Garner is the explicit, constructive inverse of that isomorphism, and the mixed-radix digits are the form in which magnitude re-emerges. Read this way, every application — NTT lift, RNS bignum, overflow avoidance, base extension, comparison — is the same move: leave residue space (where arithmetic is cheap) and re-enter positional space (where magnitude lives) exactly once, as late as possible, via Garner.

### Practitioner's Final Checklist

1. **Normalize** residues `r_i ← ((r_i mod p_i) + p_i) mod p_i` on entry.
2. **Assert** pairwise coprimality (or prefix-product invertibility).
3. **Prove** `∏ p_i > v_max` (or `> 2V` for signed) — the silent-failure guard.
4. **Precompute** prefix-product inverses if primes are fixed (NTT/RNS).
5. **Choose** the assembly: big-int for the exact value, mod-`M` sum otherwise.
6. **Center** the result into `[−P/2, P/2)` if values may be negative.
7. **Test** with the round-trip identity `garner(to_rns(x)) == x` and the RNS homomorphism.

Each item maps to a theorem: normalization to Definition 1.2; coprimality to Theorem 3.2's inverse existence; the product bound to Proposition 6.1; precomputation to Theorem 5.3; assembly choice to Corollaries 3.3–3.4; centering to Proposition 8.1; testing to the bijection of Theorem 2.1. The theory is not decoration — every line of a correct, fast Garner implementation traces to one of these results.

Foundational references: the Chinese Remainder Theorem and mixed-radix conversion in Knuth, *TAOCP Vol. 2* (Seminumerical Algorithms, §4.3.2); Garner's original mixed-radix conversion (Garner, 1959, "The residue number system"); Newton vs Lagrange interpolation duality (any numerical-analysis text); product/remainder-tree fast CRT (Modern Computer Arithmetic, Brent & Zimmermann). Sibling topics: `05-crt`, `06-extended-euclidean-modular-inverse`, `13-ntt`, `14-montgomery-multiplication`, `27-bigint-arithmetic`.
