# Chinese Remainder Theorem — Mathematical Foundations and Complexity

## Table of Contents
1. Formal Definitions
2. The CRT Statement (Coprime Case)
3. Proof via the Ring Isomorphism Z/MZ ≅ ∏ Z/mᵢZ
4. Uniqueness Modulo M
5. The Constructive Formula and Its Correctness
6. The Generalized CRT: Merge Correctness
7. The GCD Consistency Condition (Proof)
8. The Combined Modulus Is the LCM
9. Garner's Mixed-Radix Representation
10. Complexity Analysis
11. CRT as a Functor and the RNS Viewpoint
12. Euler's φ and the Multiplicative-Group Decomposition
13. Lifting the Exponents: CRT and Modular Exponentiation
14. Prime-Power Refinement and Hensel's Connection
15. Error-Correcting Residue Codes
16. Worked Proof Trace: The Idempotents Concretely
17. Counting Solutions and the Failure of Coprimality
18. CRT for Polynomial Rings and the Lagrange Analogy
19. Exercises with Solutions
20. Bezout's Identity as the Engine of CRT
21. Asymptotically Fast Multi-Modular Reconstruction
22. Rational Reconstruction: Beyond Integer Recovery
23. The Isomorphism Preserves Order Structure Only Trivially
24. Complexity of the Consistency Decision
25. Connections and Further Theory
26. CRT-Based Secret Sharing: A Worked Theorem
27. The CRT Map and Idempotent Decomposition Restated
28. Algorithmic Summary Table
29. Notation and Symbol Reference
30. Theorem Index
31. Summary

---

## 1. Formal Definitions

Let `ℤ` be the integers and, for a positive integer `m`, let `ℤ/mℤ` denote the ring of residues modulo `m` with operations `+` and `·` reduced mod `m`.

**Definition 1.1 (Congruence).** For integers `x, a` and modulus `m > 0`, write `x ≡ a (mod m)` iff `m ∣ (x − a)`. Equivalently `x` and `a` lie in the same coset of the subgroup `mℤ ≤ ℤ`.

**Definition 1.2 (System of congruences).** Given residues `a₁, …, aₙ` and moduli `m₁, …, mₙ > 0`, the system is the simultaneous requirement `x ≡ aᵢ (mod mᵢ)` for all `i ∈ {1, …, n}`. A **solution** is any integer `x` satisfying all `n` congruences; the **solution set** is `S ⊆ ℤ`.

**Definition 1.3 (Pairwise coprime).** The moduli are pairwise coprime iff `gcd(mᵢ, mⱼ) = 1` for every `i ≠ j`. Write `M = ∏ᵢ mᵢ`.

**Definition 1.4 (Reduction map).** Define `φ : ℤ/Mℤ → ∏ᵢ ℤ/mᵢℤ` by `φ(x mod M) = (x mod m₁, …, x mod mₙ)`. This is well-defined because each `mᵢ ∣ M`, so `x mod mᵢ` depends only on `x mod M`.

**Notation.** Throughout, `M = ∏ mᵢ`, `Mᵢ = M/mᵢ`, `g = gcd`, `L = lcm`, `φ` the reduction map, and `[P]` the Iverson bracket (`1` if `P` holds, else `0`). "Coprime" without qualifier means pairwise coprime when applied to a set.

---

## 2. The CRT Statement (Coprime Case)

**Theorem 2.1 (Chinese Remainder Theorem).** If `m₁, …, mₙ` are pairwise coprime, then for any residues `a₁, …, aₙ` the system `x ≡ aᵢ (mod mᵢ)` has a solution, and that solution is **unique modulo `M = ∏ mᵢ`**. Equivalently, the map `φ` of Definition 1.4 is a **bijection** (in fact a ring isomorphism, Theorem 3.1).

The theorem bundles three claims: **existence** (a solution exists), **uniqueness mod M** (any two solutions differ by a multiple of `M`), and **structure** (`φ` preserves `+` and `·`). We prove all three.

---

## 3. Proof via the Ring Isomorphism Z/MZ ≅ ∏ Z/mᵢZ

**Theorem 3.1.** For pairwise-coprime `m₁, …, mₙ` with `M = ∏ mᵢ`, the map

```
φ : ℤ/Mℤ → (ℤ/m₁ℤ) × … × (ℤ/mₙℤ),   φ(x) = (x mod m₁, …, x mod mₙ)
```

is a **ring isomorphism**.

**Proof.**

*(φ is a ring homomorphism.)* Reduction mod `mᵢ` is a ring homomorphism `ℤ → ℤ/mᵢℤ`, and `M ℤ ⊆ mᵢ ℤ` for each `i`, so each component factors through `ℤ/Mℤ`. The product of homomorphisms is a homomorphism, and it sends `1 ↦ (1, …, 1)`. Hence `φ(x + y) = φ(x) + φ(y)` and `φ(xy) = φ(x)φ(y)`, componentwise.

*(φ is injective.)* Suppose `φ(x) = φ(y)`. Then `mᵢ ∣ (x − y)` for every `i`. Because the `mᵢ` are pairwise coprime, their product divides any common multiple, so `M = ∏ mᵢ ∣ (x − y)` (Lemma 3.2 below). Thus `x ≡ y (mod M)`, i.e. they are equal in `ℤ/Mℤ`. So `ker φ = {0}` and `φ` is injective.

*(φ is surjective / bijective.)* The domain `ℤ/Mℤ` and the codomain `∏ᵢ ℤ/mᵢℤ` are **finite sets of the same cardinality**: `|ℤ/Mℤ| = M = ∏ mᵢ = ∏ |ℤ/mᵢℤ| = |∏ᵢ ℤ/mᵢℤ|`. An injective map between finite sets of equal cardinality is a bijection. A bijective ring homomorphism is a ring isomorphism. ∎

**Lemma 3.2 (pairwise-coprime product divides).** If `d₁, …, dₙ` pairwise coprime and each `dᵢ ∣ N`, then `∏ dᵢ ∣ N`.

*Proof.* Induction on `n`. Base `n = 1` trivial. Suppose `d₁⋯d_{n−1} ∣ N`; write `N = (d₁⋯d_{n−1})·t`. Since `dₙ` is coprime to each `d₁, …, d_{n−1}`, it is coprime to their product `d₁⋯d_{n−1}`. Also `dₙ ∣ N = (d₁⋯d_{n−1})·t`; by Euclid's lemma (coprime to the first factor) `dₙ ∣ t`. Hence `(d₁⋯d_{n−1})·dₙ ∣ (d₁⋯d_{n−1})·t = N`. ∎

**Consequence.** Existence is the surjectivity of `φ`: every target tuple `(a₁, …, aₙ)` is the image of some `x`, i.e. the system is solvable. The isomorphism also proves the deeper structural fact that arithmetic mod `M` *is* componentwise arithmetic on residue tuples — the foundation of multi-mod (RNS) computation.

---

## 4. Uniqueness Modulo M

Uniqueness is the injectivity established in Theorem 3.1, restated concretely.

**Corollary 4.1.** If `x` and `x′` both solve the coprime system, then `x ≡ x′ (mod M)`. Conversely every member of the residue class `x + Mℤ` is also a solution.

*Proof.* Both directions follow from Lemma 3.2. If `x, x′` are solutions then `mᵢ ∣ (x − x′)` for all `i`, so `M ∣ (x − x′)`. Conversely if `x′ = x + kM`, then `x′ mod mᵢ = (x + kM) mod mᵢ = x mod mᵢ = aᵢ` because `mᵢ ∣ M`. ∎

Thus the solution set is exactly one residue class mod `M`; the canonical representative is `x₀ ∈ [0, M)`, and the full set is `{ x₀ + kM : k ∈ ℤ }`.

---

## 5. The Constructive Formula and Its Correctness

The isomorphism proof is non-constructive; here is the explicit inverse `φ⁻¹`.

**Theorem 5.1 (Gauss's formula).** With `Mᵢ = M / mᵢ` and `yᵢ = Mᵢ⁻¹ (mod mᵢ)`,

```
x = ( Σᵢ aᵢ · Mᵢ · yᵢ )  (mod M)
```

solves the system.

*Proof of correctness.* First, `yᵢ` exists: `gcd(Mᵢ, mᵢ) = 1` because `Mᵢ = ∏_{j≠i} mⱼ` is a product of numbers each coprime to `mᵢ`, and a product of units mod `mᵢ` is a unit. Now fix an index `r` and reduce `x` mod `mᵣ`:

- For `i ≠ r`: `mᵣ ∣ Mᵢ` (since `Mᵢ` contains the factor `mᵣ`), so `aᵢ·Mᵢ·yᵢ ≡ 0 (mod mᵣ)`.
- For `i = r`: `Mᵣ·yᵣ ≡ 1 (mod mᵣ)` by definition of `yᵣ`, so the term is `≡ aᵣ (mod mᵣ)`.

Hence `x ≡ aᵣ (mod mᵣ)` for every `r`. ∎

This is precisely `φ⁻¹`: the basis vector `eᵢ = Mᵢ·yᵢ` maps to the indicator tuple `(0, …, 1, …, 0)` (a 1 in slot `i`), and `x = Σ aᵢ eᵢ` reconstructs an arbitrary tuple by linearity. The `eᵢ` are the **CRT idempotents**: `eᵢ² ≡ eᵢ` and `eᵢ eⱼ ≡ 0 (i ≠ j)` in `ℤ/Mℤ`, the orthogonal idempotents decomposing the ring as a product.

---

## 6. The Generalized CRT: Merge Correctness

Drop the coprimality assumption. Reduce `n` congruences to one by repeatedly merging two.

**Theorem 6.1 (two-congruence merge).** The system `{ x ≡ a₁ (mod m₁), x ≡ a₂ (mod m₂) }` has a solution **iff** `g ∣ (a₂ − a₁)` where `g = gcd(m₁, m₂)`. When it does, the solution set is a single residue class modulo `L = lcm(m₁, m₂)`.

*Proof.* A common solution has the form `x = a₁ + m₁ t` (parametrizing the first congruence). Substituting into the second:

```
a₁ + m₁ t ≡ a₂ (mod m₂)   ⟺   m₁ t ≡ (a₂ − a₁) (mod m₂).      (∗)
```

Equation `(∗)` is a linear congruence in `t`. A linear congruence `b t ≡ c (mod m)` is solvable iff `gcd(b, m) ∣ c` (Lemma 6.2). Here `b = m₁`, `m = m₂`, so `gcd(m₁, m₂) = g`, giving solvability iff `g ∣ (a₂ − a₁)` — the stated condition.

When solvable, `(∗)` has exactly `g` solutions for `t` modulo `m₂`, i.e. a unique solution `t₀` modulo `m₂/g`. Then `x = a₁ + m₁ t` with `t ≡ t₀ (mod m₂/g)` ranges over `a₁ + m₁ t₀ + m₁·(m₂/g)·ℤ`. Since `m₁·(m₂/g) = lcm(m₁, m₂) = L`, the solution set is the single residue class `x ≡ (a₁ + m₁ t₀) (mod L)`. ∎

**Lemma 6.2 (solvability of a linear congruence).** `b t ≡ c (mod m)` has a solution iff `d := gcd(b, m)` divides `c`; if so there are exactly `d` solutions mod `m`.

*Proof.* (⇒) If `t` solves it, `m ∣ (bt − c)`, so `bt − c = mk`, i.e. `c = bt − mk`. Since `d ∣ b` and `d ∣ m`, `d ∣ c`. (⇐) If `d ∣ c`, by extended Euclid get `b u + m v = d`; multiply by `c/d`: `b·(u c/d) + m·(v c/d) = c`, so `t₀ = u c/d` satisfies `b t₀ ≡ c (mod m)`. The general solution is `t₀ + (m/d)·s`, giving `d` distinct residues mod `m`. ∎

The explicit `t₀` from Lemma 6.2 is what the code computes: `t₀ = (a₂ − a₁)/g · p (mod m₂/g)` where `p` comes from `extgcd(m₁, m₂) = (g, p, q)`. Folding `n` congruences applies Theorem 6.1 repeatedly; if any merge is unsolvable, the whole system is unsolvable.

---

## 7. The GCD Consistency Condition (Proof)

The condition `a₁ ≡ a₂ (mod g)` (equivalently `g ∣ (a₂ − a₁)`) is both **necessary** and **sufficient**, and it generalizes.

**Necessity.** If `x` solves both congruences then `x ≡ a₁ (mod m₁)` implies `x ≡ a₁ (mod g)` (as `g ∣ m₁`), and likewise `x ≡ a₂ (mod g)`. Transitivity gives `a₁ ≡ a₂ (mod g)`. So consistency is forced by any solution.

**Sufficiency.** Shown in Theorem 6.1: `g ∣ (a₂ − a₁)` makes `(∗)` solvable, producing an explicit `x`.

**General necessary-and-sufficient condition (n congruences).** An arbitrary system is solvable iff **every pair** is pairwise consistent: `aᵢ ≡ aⱼ (mod gcd(mᵢ, mⱼ))` for all `i, j`. *Proof sketch:* necessity is the pairwise argument above. Sufficiency follows by induction using Theorem 6.1 — but note a subtlety: it suffices to check pairwise consistency because the merged modulus is the lcm and the structure of residues mod prime powers makes pairwise agreement imply global agreement (decompose each `mᵢ` into prime powers; for each prime, the congruences modulo its powers must form a chain, and pairwise consistency guarantees the chain is consistent). The merge-fold realizes this constructively: it succeeds iff the system is solvable.

---

## 8. The Combined Modulus Is the LCM

**Proposition 8.1.** The solution set of any solvable system `{ x ≡ aᵢ (mod mᵢ) }` is a single residue class modulo `L = lcm(m₁, …, mₙ)`.

*Proof.* If `x, x′` are both solutions, then `mᵢ ∣ (x − x′)` for all `i`, so `x − x′` is a common multiple of all `mᵢ`, hence `lcm(mᵢ) = L ∣ (x − x′)`. Conversely if `L ∣ (x − x′)` and `x` is a solution, then `mᵢ ∣ L ∣ (x − x′)` gives `x′ ≡ x ≡ aᵢ (mod mᵢ)`, so `x′` is also a solution. Hence the solution set is exactly `x + Lℤ`. ∎

In the coprime case `L = ∏ mᵢ = M`, recovering Corollary 4.1. The merge in Theorem 6.1 builds `L` incrementally as `lcm(m₁, m₂)`, then `lcm(that, m₃)`, etc.

---

## 9. Garner's Mixed-Radix Representation

For pairwise-coprime moduli, Garner expresses the unique `x ∈ [0, M)` in a **mixed-radix** basis:

```
x = c₁ + c₂ m₁ + c₃ m₁ m₂ + … + cₙ m₁ m₂ … m_{n−1},   cᵢ ∈ [0, mᵢ).
```

**Computing the digits.** Reduce both sides mod `m₁`: `x ≡ c₁ (mod m₁)`, so `c₁ = a₁`. Inductively, having `c₁, …, c_{k−1}`, reduce mod `mₖ` and solve for `cₖ`:

```
cₖ = ( aₖ − (c₁ + c₂ m₁ + … + c_{k−1} m₁…m_{k−2}) ) · (m₁ m₂ … m_{k−1})⁻¹  (mod mₖ).
```

Each inverse `(m₁…m_{k−1})⁻¹ mod mₖ` exists by pairwise coprimality and depends only on the moduli, so it is precomputable. **Correctness** is immediate: by construction `x ≡ aₖ (mod mₖ)` for every `k`, and `0 ≤ x < ∏ mᵢ = M` because each digit is bounded and the radices telescope. The key practical property: **every intermediate digit `cₖ` is smaller than `mₖ`**, so reconstruction never overflows even when `M` exceeds a machine word — the big number is assembled only at the final Horner evaluation (in big-integer arithmetic), or reduced mod a target prime on the fly. Full treatment in sibling topic `15-garner`.

---

## 10. Complexity Analysis

Let the moduli have `b = O(log M)` bits and let `n` be their count.

| Step | Operation count | Bit complexity |
|------|-----------------|----------------|
| One `extgcd(mᵢ, mⱼ)` | `O(log min(mᵢ,mⱼ))` divisions | `O(b²)` schoolbook |
| One merge (Thm 6.1) | one extgcd + `O(1)` mults | `O(b²)` |
| Fold `n` congruences | `n − 1` merges | `O(n b²)` |
| Symmetric formula | `n` inverses + building `Mᵢ` | `O(n b² + n · M(nb))` |
| Garner reconstruction | `O(n²)` digit steps (inverses precomputed) | `O(n² b²)`; final assembly `M(nb)` |

Here `M(·)` is integer-multiplication cost (`O(b²)` schoolbook, `O(b log b)` with FFT/NTT). The **fold** is asymptotically the cheapest at `O(n b²)` because it avoids the huge `Mᵢ` products of the symmetric formula. Reconstruction is dominated by either the `n²` inverse-applications (Garner) or the final big-integer assembly. In the multi-mod (RNS) application the CRT/Garner cost is a lower-order term next to the per-prime computation it serves.

---

## 11. CRT as a Functor and the RNS Viewpoint

The isomorphism `ℤ/Mℤ ≅ ∏ ℤ/mᵢℤ` is the algebraic license for the **Residue Number System (RNS)**: represent an integer in `[0, M)` by its residue tuple and perform `+`, `−`, `×` componentwise with **no carries between components**, hence in parallel and overflow-free per component. CRT/Garner is the conversion *out* of RNS back to a positional integer. This is the theory behind:

- **Multi-mod NTT / bignum multiplication** — convolve under several primes, CRT the result.
- **RSA-CRT** — `ℤ/nℤ ≅ ℤ/pℤ × ℤ/qℤ`; exponentiate in each small ring, then `φ⁻¹` (the `m₂ + h q` Garner combine).
- **Redundant RNS / error correction** — extra coprime moduli give a code; an inconsistent reconstruction localizes a faulty residue.

The only operations RNS does **not** support cheaply are magnitude comparison and division, precisely because those require the positional value that CRT reconstructs — which is why reconstruction cost matters.

---

## 12. Euler's φ and the Multiplicative-Group Decomposition

CRT also explains the multiplicativity of arithmetic functions on the unit group. The ring isomorphism restricts to a **group isomorphism** on units:

```
(ℤ/Mℤ)^×  ≅  (ℤ/m₁ℤ)^× × … × (ℤ/mₙℤ)^×      (pairwise-coprime mᵢ)
```

because `x` is a unit mod `M` iff it is a unit mod each `mᵢ` (invertibility is checkable componentwise). Taking cardinalities gives the multiplicativity of **Euler's totient**:

**Proposition 12.1.** If `gcd(m, n) = 1` then `φ(mn) = φ(m)·φ(n)`.

*Proof.* `|(ℤ/mnℤ)^×| = φ(mn)`, and by the group isomorphism this equals `|(ℤ/mℤ)^×|·|(ℤ/nℤ)^×| = φ(m)φ(n)`. ∎

This is the structural reason `φ` is computed by factoring `m = ∏ pᵢ^{eᵢ}` and multiplying `∏ pᵢ^{eᵢ−1}(pᵢ − 1)`. The same decomposition shows that the structure of `(ℤ/Mℤ)^×` (cyclic vs. product of cyclic groups, existence of primitive roots) reduces to the prime-power factors — a fact used throughout primitive-root and discrete-log theory (sibling topics `08-primitive-roots`, `09-discrete-log`). CRT is thus not merely a reconstruction trick; it is the device that *factors* questions about `ℤ/Mℤ` into independent questions about prime-power components.

---

## 13. Lifting the Exponents: CRT and Modular Exponentiation

RSA-CRT's correctness rests on a CRT-plus-Fermat argument worth stating precisely.

**Proposition 13.1.** Let `n = p·q` with distinct primes `p, q`, and let `d, e` satisfy `de ≡ 1 (mod lcm(p−1, q−1))`. Then for every `c`, `(c^e)^d ≡ c (mod n)`.

*Proof.* It suffices to show the congruence mod `p` and mod `q` separately; CRT (the injectivity of `φ` on `ℤ/nℤ`) then forces it mod `n`. Mod `p`: if `p ∤ c`, Fermat gives `c^{p−1} ≡ 1`, and since `(p−1) ∣ lcm(p−1,q−1) ∣ (de − 1)`, we get `c^{de} ≡ c^{1 + k(p−1)} ≡ c (mod p)`. If `p ∣ c`, both sides are `0 (mod p)`. The same holds mod `q`. By CRT the two component congruences combine to `c^{de} ≡ c (mod n)`. ∎

This is exactly why the RSA-CRT decryption of [`senior.md`](./senior.md) may exponentiate `dp = d mod (p−1)` and `dq = d mod (q−1)` in the small rings and then `φ⁻¹`-combine: each exponent is reduced by Fermat in its own component, and CRT glues the components. The reduction `d mod (p−1)` is legitimate precisely because the order of the unit group mod `p` divides `p − 1`.

---

## 14. Prime-Power Refinement and Hensel's Connection

Theorem 3.1 reduces any modulus to its prime-power factors: writing `M = ∏ pᵢ^{eᵢ}`, we have `ℤ/Mℤ ≅ ∏ᵢ ℤ/pᵢ^{eᵢ}ℤ`. This is the **first stage** of working modulo `M`; many algorithms then handle each prime-power factor separately.

**Proposition 14.1 (factor-then-CRT).** Solving a polynomial congruence `f(x) ≡ 0 (mod M)` is equivalent to solving `f(x) ≡ 0 (mod pᵢ^{eᵢ})` for each `i` and CRT-combining the solution sets. The number of solutions mod `M` is the **product** of the per-prime-power solution counts.

*Proof.* By the isomorphism, `f(x) ≡ 0 (mod M)` holds iff `f(x) ≡ 0 (mod pᵢ^{eᵢ})` for every `i` (a polynomial identity is preserved componentwise because `φ` is a ring homomorphism). Each independent choice of a root mod `pᵢ^{eᵢ}` yields, by surjectivity, exactly one combined `x` mod `M`. Hence solutions multiply. ∎

This is why root-counting, square-root extraction (`Tonelli–Shanks` mod a prime, then CRT across primes), and discrete-log algorithms (`Pohlig–Hellman`) all reduce to prime-power components and recombine with CRT. The remaining step — lifting a root mod `p` to a root mod `p^e` — is **Hensel's lemma** (sibling topic), which sits *inside* one CRT component; CRT handles the cross-prime gluing, Hensel handles the within-prime power lifting. Together they reduce a hard modular equation to its irreducible atomic pieces.

---

## 15. Error-Correcting Residue Codes

Adding redundant moduli turns the CRT map into a code with distance.

**Setup.** Use `n` "information" moduli `m₁, …, mₙ` and `r` "redundant" moduli `m_{n+1}, …, m_{n+r}`, all pairwise coprime, with information range `M = ∏_{i≤n} mᵢ` and full range `M' = ∏_{i≤n+r} mᵢ`. A value `X < M` is encoded by its full residue tuple of length `n + r`. Because `X < M ≤ M'/(∏ redundant)`, the redundant residues are determined by the information ones.

**Proposition 15.1.** With `r` redundant moduli, the residue code detects up to `r` corrupted residues and corrects up to `⌊r/2⌋`, provided the moduli are ordered by size and a corrupted residue cannot mimic a smaller legal value.

*Sketch.* A legal codeword reconstructs (via CRT over all `n+r` moduli) to a value `< M`. A single corrupted residue makes the full reconstruction land in `[M, M')` with high probability — outside the legal range — flagging the error. With enough redundancy, comparing reconstructions over different modulus subsets localizes which residue is wrong, enabling correction. ∎

This **Redundant Residue Number System (RRNS)** is the number-theoretic analogue of Reed–Solomon over integers; it underlies fault-tolerant arithmetic units where a stuck bit in one residue lane must not silently corrupt the result. The consistency check of the generalized merge is the degenerate `r ≥ 1` case: an inconsistency signals that no `X` produces the given tuple, i.e. a detected error.

---

## 16. Worked Proof Trace: The Idempotents Concretely

It is instructive to compute the CRT idempotents `eᵢ = Mᵢ yᵢ` for the moduli `m₁ = 3, m₂ = 5, m₃ = 7` (`M = 105`) and verify the orthogonality claims of Section 5.

```
M₁ = 105/3 = 35,  y₁ = 35⁻¹ mod 3 = 2⁻¹ mod 3 = 2,  e₁ = 35·2 = 70
M₂ = 105/5 = 21,  y₂ = 21⁻¹ mod 5 = 1⁻¹ mod 5 = 1,  e₂ = 21·1 = 21
M₃ = 105/7 = 15,  y₃ = 15⁻¹ mod 7 = 1⁻¹ mod 7 = 1,  e₃ = 15·1 = 15
```

**Indicator check.** `e₁ = 70`: `70 mod 3 = 1`, `70 mod 5 = 0`, `70 mod 7 = 0` → tuple `(1,0,0)`. Likewise `e₂ = 21` → `(0,1,0)` and `e₃ = 15` → `(0,0,1)`. So each `eᵢ` is the CRT preimage of a standard basis vector, exactly as Theorem 5.1 claims.

**Idempotency.** `e₁² = 4900 ≡ 70 (mod 105)` since `4900 = 46·105 + 70`; indeed `e₁² ≡ e₁`. **Orthogonality.** `e₁ e₂ = 70·21 = 1470 = 14·105 ≡ 0 (mod 105)`. **Completeness.** `e₁ + e₂ + e₃ = 70 + 21 + 15 = 106 ≡ 1 (mod 105)`. These three properties — `eᵢ² = eᵢ`, `eᵢ eⱼ = 0`, `Σ eᵢ = 1` — are precisely the algebraic signature of a ring decomposed as a product of factors via orthogonal idempotents, and reconstructing any tuple `(a₁,a₂,a₃)` is the single linear combination `x = a₁e₁ + a₂e₂ + a₃e₃ (mod 105)`. For `(2,3,2)`: `2·70 + 3·21 + 2·15 = 140 + 63 + 30 = 233 ≡ 23 (mod 105)`, recovering the soldier-puzzle answer.

---

## 17. Counting Solutions and the Failure of Coprimality

When moduli are *not* coprime, the number of solutions is not always 0 or 1 mod the lcm — it is exactly 1 when consistent and 0 when inconsistent **for a system of equalities**, but the count changes for richer constraints.

**Proposition 17.1.** A solvable arbitrary system `{ x ≡ aᵢ (mod mᵢ) }` has exactly **one** solution modulo `L = lcm(mᵢ)` (Proposition 8.1), hence `M/L` solutions in `[0, M)` if one (artificially) counts modulo the product `M = ∏ mᵢ`. The "lost" multiplicity `M/L = ∏ mᵢ / lcm(mᵢ)` is exactly the product of the pairwise overlaps that coprimality would have removed.

For `m₁ = 6, m₂ = 12`: `M = 72`, `L = 12`, so `M/L = 6` — there are 6 copies of the unique mod-12 solution inside `[0, 72)`. This quantifies the intuition that non-coprime moduli carry **redundant** information: the shared factor's worth of each residue is duplicated, which is also why the consistency condition is exactly the requirement that the duplicated parts agree.

**Corollary 17.2.** The system is "as informative as" `lcm(mᵢ)` distinct residue classes, never more. Adding a congruence whose modulus divides the current `lcm` and whose residue is already implied adds **no** information (a no-op merge); adding one with a new prime-power factor strictly refines the solution.

---

## 18. CRT for Polynomial Rings and the Lagrange Analogy

The Chinese Remainder Theorem is not special to `ℤ`; it holds in any commutative ring `R` for **pairwise-comaximal** ideals (ideals `I, J` with `I + J = R`, the abstract version of `gcd = 1`).

**Theorem 18.1 (CRT for rings).** If `I₁, …, Iₙ` are pairwise comaximal ideals of a commutative ring `R`, then `R / (I₁ ∩ … ∩ Iₙ) ≅ (R/I₁) × … × (R/Iₙ)`, and `I₁ ∩ … ∩ Iₙ = I₁ ⋯ Iₙ`.

The integer CRT is the case `R = ℤ`, `Iᵢ = mᵢℤ`, where comaximality `mᵢℤ + mⱼℤ = ℤ` is exactly `gcd(mᵢ, mⱼ) = 1`, and `∩ Iᵢ = (lcm)ℤ`, `∏ Iᵢ = (∏ mᵢ)ℤ` — equal precisely when coprime.

**The polynomial instance: Lagrange interpolation.** Take `R = F[X]` (polynomials over a field) and `Iᵢ = (X − xᵢ)` for distinct points `xᵢ`. These are pairwise comaximal (distinct linear factors are coprime), and `R/(X − xᵢ) ≅ F` via `f ↦ f(xᵢ)`. CRT then says

```
F[X] / ∏(X − xᵢ)  ≅  F × … × F,    f ↦ (f(x₁), …, f(xₙ)),
```

whose inverse is **Lagrange interpolation**: reconstructing the unique degree-`< n` polynomial from its values at `n` points is *the same operation* as reconstructing an integer from its residues. The Lagrange basis polynomials `ℓᵢ(X) = ∏_{j≠i}(X − xⱼ)/(xᵢ − xⱼ)` are the polynomial CRT idempotents — direct analogues of `eᵢ = Mᵢ yᵢ`. This unifies "reconstruct a number from residues" and "reconstruct a polynomial from samples" as one theorem, and it is why multpoint evaluation / interpolation and multi-modular integer reconstruction share algorithms.

---

## 19. Exercises with Solutions

**Exercise 19.1.** Prove that if `x ≡ a (mod m)` and `x ≡ a (mod n)` (same residue `a`), then `x ≡ a (mod lcm(m, n))`, with no coprimality needed.

*Solution.* `m ∣ (x − a)` and `n ∣ (x − a)` make `x − a` a common multiple of `m, n`, hence `lcm(m, n) ∣ (x − a)`. The consistency condition `a ≡ a (mod gcd)` holds trivially, so the system is always solvable here. ∎

**Exercise 19.2.** Show the symmetric Gauss formula and the pairwise fold give the same `x` for coprime moduli.

*Solution.* Both compute the unique element of `[0, M)` whose residue tuple is `(a₁, …, aₙ)`. By uniqueness (Corollary 4.1) there is only one such element, so any correct method yields it. The fold is correct because each merge is an instance of Theorem 6.1 (here with `g = 1`); the Gauss formula is correct by Theorem 5.1. Equal outputs follow. ∎

**Exercise 19.3.** For `m₁ = 4, m₂ = 6`, list the residue pairs `(x mod 4, x mod 6)` that are *achievable* and confirm the count matches `lcm = 12`.

*Solution.* The achievable pairs are those with `(x mod 4) ≡ (x mod 6) (mod gcd(4,6)=2)`, i.e. the two residues share parity. Of the `4·6 = 24` conceivable pairs, exactly half — `12` — satisfy the parity agreement, matching `lcm(4,6) = 12`. Each achievable pair has a unique `x` in `[0, 12)`. ∎

**Exercise 19.4.** Prove the CRT idempotents satisfy `Σ eᵢ ≡ 1 (mod M)`.

*Solution.* `Σ eᵢ` maps under `φ` to `Σ (0,…,1,…,0) = (1, 1, …, 1)`, which is the image of `1`. Since `φ` is injective, `Σ eᵢ ≡ 1 (mod M)`. ∎

---

## 20. Bezout's Identity as the Engine of CRT

Every constructive step in CRT — modular inverse, the merge coefficient `t₀`, the idempotents — traces back to a single object: **Bezout's identity**.

**Theorem 20.1 (Bezout).** For integers `a, b` not both zero, there exist integers `u, v` with `a u + b v = gcd(a, b)`, computed by the extended Euclidean algorithm in `O(log min(|a|,|b|))` steps.

**How CRT uses it.**

- **Modular inverse.** `a⁻¹ mod m` exists iff `gcd(a, m) = 1`; then `a u + m v = 1` gives `a u ≡ 1 (mod m)`, so `u mod m` is the inverse. Every `yᵢ = Mᵢ⁻¹ mod mᵢ` in Gauss's formula is one Bezout computation.
- **Two-coprime merge.** With `gcd(m₁, m₂) = 1`, Bezout gives `m₁ u + m₂ v = 1`. Then `e₁ = m₂ v ≡ 1 (mod m₁)` and `≡ 0 (mod m₂)`, `e₂ = m₁ u ≡ 0 (mod m₁)` and `≡ 1 (mod m₂)` — the two idempotents for `n = 2` fall directly out of a single Bezout relation, and the solution is `x = a₁ e₁ + a₂ e₂ (mod m₁ m₂)`.
- **General merge.** Bezout `m₁ p + m₂ q = g` supplies the particular solution `t₀ = (c/g)·p` of the linear congruence (Lemma 6.2). The divisibility `g ∣ c` (consistency) is exactly what makes `(c/g)` an integer.

So CRT is "Bezout, applied once per coprimality boundary, then assembled." This is why the entire topic depends on a correct, well-tested `extgcd`: it is the only nontrivial primitive, and every formula above is sugar over it.

**Numerical illustration (two-coprime via one Bezout).** For `m₁ = 3, m₂ = 5`: `extgcd(3,5)` gives `3·2 + 5·(−1) = 1`, so `u = 2, v = −1`. Then `e₁ = m₂ v = 5·(−1) = −5 ≡ 10 (mod 15)` (residue tuple `(1,0)`), `e₂ = m₁ u = 3·2 = 6` (tuple `(0,1)`). For residues `(2, 3)`: `x = 2·10 + 3·6 = 38 ≡ 8 (mod 15)` — matching the junior worked example, now derived from a single Bezout relation.

---

## 21. Asymptotically Fast Multi-Modular Reconstruction

The naive fold is `O(n²)` bit-operations when the final integer has `O(n)` machine-word size, because each merge multiplies by a running modulus of growing length. For large `n` this is improved by a **product-tree / remainder-tree** approach.

**Idea.** Build a binary tree whose leaves are the moduli `mᵢ`; each internal node stores the product of its subtree. Reconstruction proceeds bottom-up, CRT-combining sibling results, so each level does `O(M(total bits))` work and there are `O(log n)` levels. Using FFT-based integer multiplication `M(b) = O(b log b)`, the whole reconstruction is `O(N log² N)` where `N = Σ log mᵢ` is the output bit-length — quasi-linear, versus the quadratic naive fold.

**Theorem 21.1.** Multi-modular reconstruction of an `N`-bit integer from residues modulo `n` coprime moduli costs `O(M(N) log n)` bit-operations with the remainder-tree method, where `M` is the integer-multiplication cost.

This is the algorithm used in computer-algebra systems (for `gcd`, determinant, and polynomial-factorization reconstruction over many primes) and is the asymptotic justification for "compute mod many small primes, then CRT": even the *reconstruction* is near-linear, so the per-prime computations dominate and the parallelism pays off. The simple fold suffices for the small `n` (3–4 primes) typical in competitive programming and NTT; the product-tree matters when `n` reaches the hundreds or thousands, as in big-integer GCD via modular images.

---

## 22. Rational Reconstruction: Beyond Integer Recovery

CRT recovers an integer `X < M` from its residues. A striking extension recovers a **rational** `X = p/q` (in lowest terms, with `|p|, q` bounded) from its image `r ≡ p·q⁻¹ (mod M)` — even though `r` alone looks like a random residue.

**Theorem 22.1 (rational reconstruction).** If `|p| ≤ N`, `0 < q ≤ D`, `gcd(q, M) = 1`, and `2ND < M`, then the rational `p/q` is uniquely determined by `r = p q⁻¹ mod M` and is recovered by running the extended Euclidean algorithm on `(M, r)` and stopping at the first remainder `< N`.

*Sketch.* The pair `(p, q)` is the unique small solution of the lattice congruence `p ≡ q·r (mod M)`. The Euclidean algorithm on `(M, r)` enumerates the convergents of `r/M`, and the bound `2ND < M` guarantees the first convergent with numerator `< N` is exactly `p/q`. ∎

This couples CRT with the Euclidean algorithm to reconstruct *exact rational answers* from modular computations — used in solving linear systems over `ℚ` via modular images (compute the solution mod several primes, CRT to a big integer mod `M`, then rational-reconstruct the true fractions), and in certifying outputs of probabilistic algebra algorithms. It shows CRT is not the end of the pipeline: the recovered residue mod `M` can be post-processed into integers *or* rationals, depending on the size bounds.

---

## 23. The Isomorphism Preserves Order Structure Only Trivially

A subtle but important negative result: while `φ : ℤ/Mℤ → ∏ ℤ/mᵢℤ` preserves the **ring** structure, it does **not** preserve any natural order.

**Proposition 23.1.** There is no order on `∏ ℤ/mᵢℤ` (componentwise or lexicographic) that makes `φ` order-preserving for the usual `0, 1, …, M−1` ordering of `ℤ/Mℤ`, for `n ≥ 2` nontrivial moduli.

*Sketch.* Componentwise comparison of residue tuples is a partial order; consecutive integers `x, x+1` differ in *every* coordinate (each `+1 mod mᵢ`), so their tuples are generally incomparable, and the integer order cannot be read off the tuple. ∎

This is the formal reason RNS cannot compare or detect sign cheaply (Section 11): the order information lives only in the reconstructed positional value, not in the residues. Algorithms that need order (division, rounding, magnitude bounds) must either reconstruct or work in the mixed-radix (Garner) form, where the most-significant nonzero digit *does* carry magnitude information. This trade — gaining carry-free parallel `+, −, ×` at the cost of cheap order — is the defining characteristic of residue arithmetic and a direct corollary of the CRT isomorphism being purely algebraic.

---

## 24. Complexity of the Consistency Decision

Deciding whether an arbitrary system is solvable, and producing the solution or a witness of inconsistency, has tight bounds worth stating.

**Theorem 24.1.** Given `n` congruences with moduli of at most `b` bits, deciding solvability and (if solvable) computing the unique solution mod `L = lcm(mᵢ)` takes `O(n · b²)` bit-operations with the fold, and the inconsistency witness (a pair `(i, j)` with `aᵢ ≢ aⱼ (mod gcd(mᵢ, mⱼ))`) is produced at the first failing merge.

*Proof.* Each merge runs one `extgcd` (`O(b²)` schoolbook) and `O(1)` `mulmod`s (`O(b²)` each), and there are `n − 1` merges. A merge fails exactly when its consistency divisibility fails, and by Section 7 pairwise consistency is necessary and sufficient, so the first failing merge exhibits an inconsistent pair after combining. Total `O(n b²)`. ∎

**Lower bound intuition.** You must read all `n` residue–modulus pairs (`Ω(n b)` input size) and perform at least one gcd-like reduction per new modulus to detect a shared factor, so `Ω(n b)` is unavoidable and the gap to the `O(n b²)` upper bound is the cost of a single big-integer gcd/multiply — closable with fast arithmetic to `O(n · M(b))`. The decision problem is thus firmly polynomial, in sharp contrast to superficially similar simultaneous-Diophantine problems that are NP-hard; the linearity of congruences is what keeps CRT easy.

---

## 25. Connections and Further Theory

CRT sits at a hub connecting several deeper topics; this map orients further study.

- **Primitive roots and discrete log (`08`, `09`).** The unit-group decomposition (Section 12) reduces existence of primitive roots and the Pohlig–Hellman discrete-log algorithm to prime-power components glued by CRT.
- **Quadratic residues and modular square roots.** Computing `√a mod M` factors as `√a mod pᵢ^{eᵢ}` (Tonelli–Shanks + Hensel) then CRT; the number of square roots multiplies across prime-power factors (Section 14, 17).
- **Polynomial CRT / fast interpolation (Section 18).** Multipoint evaluation and interpolation are the `F[X]` instance; remainder-tree CRT (Section 21) gives the fast algorithms.
- **Lattices and rational reconstruction (Section 22).** The Euclidean post-processing connects CRT to continued fractions and the LLL-free 2D-lattice recovery of small rationals.
- **Secret sharing.** A CRT-based threshold scheme (Mignotte / Asmuth–Bloom) hides a secret as residues modulo coprime moduli; any `t` shares reconstruct it via CRT, fewer than `t` reveal nothing — the security mirrors the information-content analysis of Section 17.

The throughline: **CRT is the universal "glue" that factors a problem modulo a composite into independent problems modulo its prime-power parts and reassembles the answers.** Master the isomorphism, the constructive idempotents, the gcd consistency condition, and the overflow-safe reconstruction, and the rest of computational number theory composes cleanly on top.

---

## 26. CRT-Based Secret Sharing: A Worked Theorem

To see the theory pay off, we state and prove correctness of an **Asmuth–Bloom-style** CRT secret-sharing scheme, which encodes the security analysis of Section 17 directly.

**Setup.** Fix a secret `s` and pairwise-coprime moduli `m₀ < m₁ < … < m_k` (and optionally more) with `m₀ > s`. Choose a threshold `t` and require the *signature condition*

```
m_{1} · m_{2} · … · m_{t}  >  m₀ · m_{k−t+2} · … · m_{k},
```

i.e. the product of the `t` smallest large-moduli exceeds `m₀` times the product of the `t−1` largest. Pick a random `A` and set `y = s + A·m₀`. Each party `i` receives the share `yᵢ = y mod mᵢ`.

**Theorem 26.1 (reconstruction).** Any `t` parties can recover `s`; any `t−1` cannot.

*Proof (recovery).* From `t` shares `{ y ≡ yᵢ (mod mᵢ) }`, CRT reconstructs `y` uniquely modulo `M_t = ∏ (the t chosen mᵢ)`. By the signature condition `y < M_t` (since `y = s + A m₀` is bounded by the construction), so the reconstructed residue equals the true `y`; then `s = y mod m₀`. ∎

*Proof sketch (security).* With only `t−1` shares, `y` is known modulo `M_{t−1} = ∏ (t−1 chosen mᵢ)`. The signature condition guarantees the gap to `M_t` is at least `m₀`, so `y` could be any of ≥ `m₀` values differing by multiples of `M_{t−1}`, and these spread over **all** residues mod `m₀`. Hence `s = y mod m₀` is information-theoretically uniform given `t−1` shares — nothing leaks. ∎

This is the quantitative version of "fewer than `t` congruences under-determine the value modulo the relevant range" from Section 17, sharpened into a perfect-secrecy bound. It demonstrates that the *size relationships* between coprime moduli — not just their coprimality — carry cryptographic meaning, a recurring theme when CRT is used for more than reconstruction.

---

## 27. The CRT Map and Idempotent Decomposition Restated

It is worth recording the cleanest abstract statement, since it subsumes every concrete formula above.

**Theorem 27.1 (idempotent decomposition).** Let `R = ℤ/Mℤ` with `M = ∏ mᵢ` pairwise coprime. There exist unique idempotents `e₁, …, eₙ ∈ R` with:

```
eᵢ² = eᵢ,    eᵢ eⱼ = 0 (i ≠ j),    e₁ + … + eₙ = 1,    eᵢ ≡ [i = ·] under φ.
```

The map `x ↦ (e₁ x, …, eₙ x)` (viewing `eᵢ x` in the subring `eᵢ R ≅ ℤ/mᵢℤ`) is the ring isomorphism `φ`, and its inverse is `(a₁, …, aₙ) ↦ Σ aᵢ eᵢ`.

*Proof.* Existence and the indicator property are Theorem 5.1 with `eᵢ = Mᵢ yᵢ`. Uniqueness: any complete orthogonal idempotent system in a finite commutative ring corresponds to the unique decomposition into local/simple factors (here the `ℤ/mᵢℤ`), and `φ` already exhibits that decomposition, so the idempotents are forced. The inverse formula is the linearity of `φ⁻¹` applied to the basis tuples, each the image of one `eᵢ`. ∎

**Why this is the "real" CRT.** Everything else is a computation of these idempotents or an application of the inverse map. Gauss's formula computes `eᵢ` symmetrically; the fold computes the inverse map incrementally; Garner computes it in a mixed-radix basis; RSA-CRT is the `n = 2` inverse map. Recognizing a problem as "evaluate `φ`" (split into residues) or "evaluate `φ⁻¹`" (reconstruct) immediately tells you which direction and which algorithm applies. The idempotents are the invariant heart; the formulas are bookkeeping.

**A note on infinite analogues.** The same idempotent decomposition holds for any finite product of rings and, in the inverse limit, underlies the structure of the **profinite integers** `ℤ̂ ≅ ∏_p ℤ_p` (product over primes of the `p`-adic integers) — the "CRT for all moduli at once". While beyond practical computation, it explains why `p`-adic methods (Hensel lifting, `p`-adic reconstruction) compose so naturally with CRT: they are working in one factor of the same grand decomposition.

---

## 28. Algorithmic Summary Table

For reference, the algorithms derived above and their roles:

| Algorithm | Computes | Coprime? | Cost (ops) | Key property |
|-----------|----------|----------|-----------|--------------|
| Gauss formula (Thm 5.1) | `φ⁻¹` symmetrically | yes | `n` inverses | large intermediates `aᵢMᵢyᵢ` |
| Pairwise fold (Thm 6.1) | `φ⁻¹` incrementally | any | `n−1` merges | small running modulus; detects inconsistency |
| Garner (§9) | `φ⁻¹` in mixed radix | yes | `O(n²)` digits | digits `< mᵢ`; overflow-safe |
| Remainder-tree (§21) | `φ⁻¹` fast | yes | `O(M(N) log n)` | quasi-linear for large `n` |
| Consistency check (§7) | solvability decision | any | one gcd/merge | necessary+sufficient pairwise |
| Rational reconstruction (§22) | recover `p/q` from residue | — | one extgcd | needs `2ND < M` |

Each row is a specialization or composition of the **idempotent decomposition** of Theorem 27.1. The "coprime?" column flags where the clean isomorphism applies versus where the gcd consistency machinery is required.

---

## 29. Notation and Symbol Reference

| Symbol | Meaning |
|--------|---------|
| `ℤ/mℤ` | ring of residues modulo `m` |
| `M = ∏ mᵢ` | product of moduli (coprime case combined modulus) |
| `L = lcm(mᵢ)` | general combined modulus |
| `Mᵢ = M/mᵢ` | partial product, missing factor `mᵢ` |
| `yᵢ = Mᵢ⁻¹ mod mᵢ` | inverse used in Gauss's formula |
| `eᵢ = Mᵢ yᵢ` | CRT idempotent (indicator preimage) |
| `φ` | reduction map / ring isomorphism |
| `g = gcd(m₁, m₂)` | gcd governing the consistency condition |
| `cₖ` | `k`-th Garner mixed-radix digit (`< mₖ`) |
| `[P]` | Iverson bracket (`1` if `P`, else `0`) |
| `M(b)` | cost of multiplying `b`-bit integers |
| `(ℤ/Mℤ)^×` | group of units (invertible residues) |

These symbols are used consistently across `junior.md`, `middle.md`, `senior.md`, and this file, so a formula here maps directly onto the code in the other levels.

---

## 30. Theorem Index

A consolidated list of the results proved above, for quick navigation:

- **Theorem 2.1 / 3.1** — CRT statement; `φ : ℤ/Mℤ ≅ ∏ ℤ/mᵢℤ` is a ring isomorphism (coprime case).
- **Lemma 3.2** — pairwise-coprime divisors' product divides any common multiple (the engine of uniqueness).
- **Corollary 4.1** — uniqueness modulo `M`; solution set is one residue class.
- **Theorem 5.1** — Gauss's constructive formula `x = Σ aᵢ Mᵢ yᵢ` and the CRT idempotents.
- **Theorem 6.1 / Lemma 6.2** — two-congruence merge; solvable iff `g ∣ (a₂ − a₁)`; linear-congruence solvability.
- **§7** — gcd consistency condition: necessary and sufficient, generalizes pairwise.
- **Proposition 8.1** — combined modulus is the lcm.
- **§9** — Garner mixed-radix correctness and the small-digit property.
- **Proposition 12.1** — multiplicativity of Euler's φ from the unit-group isomorphism.
- **Proposition 13.1** — RSA-CRT correctness via Fermat-per-component + CRT.
- **Proposition 14.1** — factor-then-CRT for polynomial congruences; solution counts multiply.
- **§15** — redundant residue codes; error detection/correction.
- **Theorem 18.1** — CRT for comaximal ideals; Lagrange interpolation as the polynomial instance.
- **Theorem 20.1** — Bezout as the constructive engine.
- **Theorem 21.1** — quasi-linear remainder-tree reconstruction.
- **Theorem 22.1** — rational reconstruction from a single residue.
- **Theorem 24.1** — `O(n b²)` consistency-decision complexity.
- **Theorem 26.1** — CRT secret-sharing reconstruction and security.
- **Theorem 27.1** — idempotent decomposition (the abstract heart).

Every constructive algorithm in the sibling files is an instance of evaluating `φ` (split into residues) or `φ⁻¹` (reconstruct), and every correctness argument traces to Theorems 3.1, 6.1, and 27.1.

---

## 31. Summary

The Chinese Remainder Theorem is the statement that, for pairwise-coprime moduli, the reduction map `φ : ℤ/Mℤ → ∏ ℤ/mᵢℤ` is a **ring isomorphism**: existence is its surjectivity, uniqueness mod `M` is its injectivity (both following from the lemma that pairwise-coprime divisors' product divides any common multiple), and the structural claim is that arithmetic mod `M` is componentwise arithmetic on residue tuples. The explicit inverse is Gauss's formula `x = Σ aᵢ Mᵢ yᵢ`, built from the orthogonal CRT idempotents `eᵢ = Mᵢ yᵢ`. Dropping coprimality, the **merge** reduces two congruences to one via the linear congruence `m₁ t ≡ a₂ − a₁ (mod m₂)`, solvable **iff** the gcd consistency condition `gcd(m₁, m₂) ∣ (a₂ − a₁)` holds (necessary by transitivity through `g`, sufficient by extended Euclid), with combined modulus the **lcm**. Garner's mixed-radix form makes reconstruction overflow-safe and is the practical engine for RNS, multi-mod NTT, and RSA-CRT. The fold runs in `O(n log² M)` bit-operations, dominated in applications by the per-modulus computation it enables.
