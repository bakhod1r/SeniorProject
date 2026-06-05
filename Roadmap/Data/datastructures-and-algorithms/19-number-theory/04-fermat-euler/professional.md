# Fermat's Little Theorem & Euler's Theorem — Mathematical Foundations

## Table of Contents
1. Formal Definitions
2. The Units Group `(ℤ/mℤ)^*`
3. Fermat's Little Theorem (Two Proofs)
4. Euler's Theorem (Units Group of Order `φ(m)`)
5. The Totient Formula (Multiplicativity + Prime Powers)
6. Order of an Element Divides `φ(m)` (Lagrange)
7. The Exponent-Reduction Theorem
8. The Generalized Rule for `gcd(a, m) > 1`
9. Carmichael's Function `λ(m)`
10. Primitive Roots and the Cyclic Structure
11. Pseudoprimes, Carmichael Numbers, and the Limits of FLT
12. Summary

---

## 1. Formal Definitions

Throughout, `m ≥ 1` and `p` denotes a prime. We work in the ring `ℤ/mℤ` of residues mod `m`.

**Definition 1.1 (Congruence).** `a ≡ b (mod m)` means `m | (a − b)`. Congruence is an equivalence relation compatible with `+` and `×`, so `ℤ/mℤ` is a commutative ring with `m` elements.

The compatibility is worth stating precisely: if `a ≡ a'` and `b ≡ b'` then `a + b ≡ a' + b'` and `ab ≡ a'b' (mod m)`. This is what licenses *reducing at every step* of a modular computation — the homomorphism `ℤ → ℤ/mℤ` commutes with `+` and `×`, so we may reduce inputs, intermediate results, or both, in any order, without changing the final residue. Every fast-exponentiation routine in this topic relies on this: `a^e mod m` reduces after each squaring precisely because reduction is a ring homomorphism.

**Definition 1.2 (Unit).** A residue `a ∈ ℤ/mℤ` is a **unit** (invertible) if there exists `x` with `ax ≡ 1 (mod m)`. 

**Proposition 1.3.** `a` is a unit mod `m` **iff** `gcd(a, m) = 1`.

*Proof.* If `gcd(a, m) = 1`, Bézout gives integers `x, y` with `ax + my = 1`, so `ax ≡ 1 (mod m)` and `x` is an inverse. Conversely, if `ax ≡ 1 (mod m)`, then `ax − 1 = my` for some `y`, so `ax − my = 1`, forcing `gcd(a, m) | 1`, i.e. `gcd(a, m) = 1`. ∎

**Definition 1.4 (Euler's totient).** `φ(m) = #{a : 1 ≤ a ≤ m, gcd(a, m) = 1}` — the number of units in `ℤ/mℤ`. Equivalently `φ(m) = |(ℤ/mℤ)^*|`. By convention `φ(1) = 1`.

The two characterizations of `φ(m)` — "count of coprime residues" (combinatorial) and "size of the units group" (algebraic) — are the same number viewed from the two sides this document repeatedly bridges. The combinatorial side gives the product formula (Section 5) and the sieve; the algebraic side gives Euler's theorem (Section 4) via group order. Keeping both in mind is the single most useful habit for reasoning about totient identities.

**Definition 1.5 (Order).** For a unit `a`, the **order** `ord_m(a)` is the least `d ≥ 1` with `a^d ≡ 1 (mod m)`. It is well-defined: the powers `a, a^2, a^3, …` lie in the finite set of units, so two coincide, `a^i ≡ a^j` with `i < j`, and cancelling (units cancel) gives `a^{j-i} ≡ 1`. The order is the central numeric invariant of this topic: it is simultaneously the period of the power sequence (Theorem 7.2), the size of the cyclic subgroup `⟨a⟩` (Theorem 6.1), and the minimal exponent one may reduce by (Section 7) — three viewpoints on one number, all reconciled by Lagrange's theorem.

**Notation.** `(ℤ/mℤ)^*` is the **multiplicative group of units**, of size `φ(m)`. We write `[a]` for the residue class of `a`, and use the Iverson bracket `[P] = 1` if `P` holds else `0`. We freely identify a residue class with its canonical representative in `{0, 1, …, m-1}` when no confusion arises.

**Roadmap of this document.** Sections 2–4 build the units group and prove Fermat and Euler two ways each. Section 5 proves the totient formula. Section 6 proves order divides `φ(m)` (the structural heart). Sections 7–8 derive the exponent-reduction rules (coprime and general). Sections 9–10 expose the finer group structure (`λ(m)`, primitive roots). Section 11 bounds the converse (pseudoprimes), and Section 11b closes the loop to RSA. Every result is anchored by an explicit worked numeric example, indexed at the end.

---

## 2. The Units Group `(ℤ/mℤ)^*`

**Theorem 2.1.** The units of `ℤ/mℤ` form an abelian group under multiplication, of order `φ(m)`.

*Proof.* Closure: if `a, b` are units with inverses `a', b'`, then `(ab)(b'a') = a(bb')a' = a·1·a' = 1`, so `ab` is a unit. Associativity and commutativity are inherited from `ℤ/mℤ`. Identity is `[1]` (a unit). Inverses exist by definition of unit. The order is `|(ℤ/mℤ)^*| = φ(m)` by Definition 1.4. ∎

This group is the central object: **Fermat and Euler are both the statement "raising a group element to the order of the group gives the identity."** Everything below specializes or proves that statement.

**Lemma 2.2 (Cancellation / multiplication is a bijection).** Fix a unit `a`. The map `μ_a : (ℤ/mℤ)^* → (ℤ/mℤ)^*`, `x ↦ ax`, is a bijection of the units onto themselves.

*Proof.* `μ_a` is well-defined (product of units is a unit) and has inverse `μ_{a^{-1}}` since `a^{-1}(ax) = x`. A map with a two-sided inverse is a bijection. ∎

Lemma 2.2 is the engine of the "rearrangement" proof of Euler's theorem (Section 4).

### 2.1 Worked unit group

For `m = 8`, the residues are `{0, 1, …, 7}`. The units (coprime to `8`) are `{1, 3, 5, 7}`, so `φ(8) = 4`. The multiplication table mod `8`, restricted to units, is:

```
×   1  3  5  7
1   1  3  5  7
3   3  1  7  5
5   5  7  1  3
7   7  5  3  1
```

Every row is a permutation of `{1, 3, 5, 7}` (Lemma 2.2), and the diagonal is all `1`s: every unit is its own inverse, so every element has order dividing `2`. Hence `λ(8) = 2` (Section 9) while `φ(8) = 4` — the group is `ℤ/2 × ℤ/2` (Klein four-group), **not** cyclic, so `8` has no primitive root. This single `4 × 4` table simultaneously exhibits the units group, the rearrangement permutation, the totient count, the Carmichael exponent, and the failure of cyclicity — every theme of this document in one picture.

### 2.2 Cosets and the partition view

Each row `μ_a` of the table is a bijection; the *set of rows* is the group acting on itself by left multiplication (Cayley's theorem in miniature). The subgroup `⟨3⟩ = {1, 3}` partitions the units into two cosets `{1, 3}` and `{5, 7}` (each of size `|⟨3⟩| = 2`), visibly illustrating Lagrange (`2 | 4`). This coset partition is exactly the mechanism by which Theorem 6.2 forces element orders to divide `φ(m)`.

---

## 3. Fermat's Little Theorem (Two Proofs)

**Theorem 3.1 (FLT).** For a prime `p` and `gcd(a, p) = 1`, `a^{p-1} ≡ 1 (mod p)`. Equivalently, for *every* integer `a`, `a^p ≡ a (mod p)`.

### 3.1 Proof A — Rearrangement (specialize Euler)

Since `p` is prime, the units mod `p` are exactly `{1, 2, …, p-1}`. By Lemma 2.2 the map `x ↦ ax` permutes this set. Hence the product of all elements is preserved:

```
∏_{x=1}^{p-1} (a x) ≡ ∏_{x=1}^{p-1} x   (mod p)
a^{p-1} · (p-1)! ≡ (p-1)! (mod p).
```

`(p-1)!` is a product of units, hence a unit, so it cancels: `a^{p-1} ≡ 1 (mod p)`. ∎

### 3.2 Proof B — Combinatorial / Group-Theoretic

**Group-theoretic.** `(ℤ/pℤ)^*` has order `p-1`. By Lagrange's theorem (Section 6) the order of any element divides `p-1`, so `a^{p-1} = (a^{ord})^{(p-1)/ord} ≡ 1`. This is the cleanest proof and generalizes verbatim to Euler.

**Combinatorial (necklace counting).** Count strings of length `p` over an alphabet of size `a`. There are `a^p` strings. Group them under cyclic rotation. A string is fixed by a nontrivial rotation iff all its characters are equal — there are exactly `a` such "constant" strings. Every non-constant string lies in an orbit of size exactly `p` (since `p` is prime, the only rotation-subgroup sizes are `1` and `p`). Therefore `a^p − a` is divisible by `p` (it counts non-constant strings, partitioned into orbits of size `p`):

```
a^p ≡ a (mod p).
```

For `gcd(a, p) = 1`, divide by `a` (a unit) to get `a^{p-1} ≡ 1`. ∎ This proof is attractive because it needs no group theory — only that prime-length orbits of a cyclic action have size `1` or `p`.

**Corollary 3.2 (Fermat inverse).** For prime `p` and `gcd(a, p) = 1`, `a^{-1} ≡ a^{p-2} (mod p)`, since `a · a^{p-2} = a^{p-1} ≡ 1`. ∎

### 3.3 Worked necklace count

Let `p = 5`, `a = 2` (alphabet `{R, B}` of size 2). There are `2^5 = 32` strings of length 5. The constant strings are `RRRRR` and `BBBBB` — exactly `a = 2` of them. The remaining `32 − 2 = 30` strings split into orbits of size `5` under cyclic rotation (e.g. `RRRRB, RRRBR, RRBRR, RBRRR, BRRRR` is one orbit). Indeed `30 / 5 = 6` orbits, an integer, confirming `5 | (2^5 − 2) = 30`. So `2^5 ≡ 2 (mod 5)`, i.e. `2^4 ≡ 1 (mod 5)` after dividing by the unit `2`. The combinatorial proof is *constructive*: each orbit of a non-constant string has size exactly `p` because the rotation order must divide `p` (prime) and cannot be `1` (that would force a constant string).

### 3.4 Why the orbit size is exactly `p`

The rotation group acting on length-`p` strings is cyclic of order `p`. By the orbit-stabilizer theorem, every orbit size divides `|group| = p`, so orbits have size `1` or `p`. An orbit of size `1` is a fixed point of every rotation — a string invariant under a shift by `1`, which forces all characters equal (constant). Hence non-constant strings have orbits of size exactly `p`, and `a^p − a` (the count of non-constant strings) is a multiple of `p`. This is the cleanest "no group theory beyond orbit-stabilizer" route to FLT, and it generalizes (with Möbius inversion over divisors of `n`) to counting aperiodic necklaces and to Fermat-quotient identities.

---

## 4. Euler's Theorem (Units Group of Order `φ(m)`)

**Theorem 4.1 (Euler).** For `gcd(a, m) = 1`, `a^{φ(m)} ≡ 1 (mod m)`.

### 4.1 Proof — Rearrangement over the units

Let `u_1, u_2, …, u_{φ(m)}` enumerate the units of `ℤ/mℤ`. By Lemma 2.2, multiplication by the unit `a` permutes this list: `{a u_1, …, a u_{φ(m)}}` is the same set `{u_1, …, u_{φ(m)}}` reordered. Taking products:

```
∏_{i} (a u_i) ≡ ∏_{i} u_i (mod m)
a^{φ(m)} · ∏_i u_i ≡ ∏_i u_i (mod m).
```

`U := ∏_i u_i` is a product of units, hence a unit, so it cancels: `a^{φ(m)} ≡ 1 (mod m)`. ∎

### 4.2 Proof — Group-theoretic (Lagrange)

`(ℤ/mℤ)^*` is a group of order `φ(m)` (Theorem 2.1). By Lagrange's theorem, the order of every element divides the group order, so `ord_m(a) | φ(m)`. Writing `φ(m) = ord_m(a) · t`:

```
a^{φ(m)} = (a^{ord_m(a)})^t = 1^t = 1 (mod m). ∎
```

**Remark.** Fermat is the case `m = p` (then `φ(p) = p−1`). The two proofs of Euler are the two proofs of Fermat lifted from `{1,…,p-1}` to the units `(ℤ/mℤ)^*`. The group-theoretic proof is conceptually primary: **Euler's theorem is "element order divides group order" for the units group.**

**Corollary 4.2 (Euler inverse).** For `gcd(a, m) = 1`, `a^{-1} ≡ a^{φ(m)-1} (mod m)`. ∎

### 4.3 Worked verification of Euler's theorem

Take `m = 10`, `a = 3`. The units are `{1, 3, 7, 9}`, so `φ(10) = 4`. Multiplying each unit by `3` mod `10` permutes the set:

```
3·1 = 3,  3·3 = 9,  3·7 = 21 ≡ 1,  3·9 = 27 ≡ 7   →  {3, 9, 1, 7} = {1, 3, 7, 9}.
```

The permutation is confirmed, so the rearrangement proof applies: `3^4 · (1·3·7·9) ≡ (1·3·7·9)`, and `1·3·7·9 = 189 ≡ 9 (mod 10)`, a unit, so it cancels: `3^4 ≡ 1`. Direct check: `3^4 = 81 ≡ 1 (mod 10)`. The order of `3` here is `4 = φ(10)`, so `3` is a primitive root mod `10`. Compare `a = 9`: `9^2 = 81 ≡ 1`, so `ord_10(9) = 2`, which divides `φ(10) = 4` — Euler still gives `9^4 ≡ 1` but is not sharp for `9`.

### 4.4 The non-coprime contrast

If instead `a = 2`, then `gcd(2, 10) = 2 ≠ 1`, so `2` is not a unit and Theorem 4.1 says nothing. Indeed the powers `2, 4, 8, 6, 2, 4, …` mod `10` cycle but **never hit `1`** — they form a cycle `2 → 4 → 8 → 6 → 2` disjoint from the unit group. This is the structural reason exponent reduction mod `φ(m)` fails for non-coprime bases (Section 8): the orbit of a non-unit avoids the identity entirely.

---

## 5. The Totient Formula (Multiplicativity + Prime Powers)

We prove `φ(m) = m ∏_{p | m}(1 − 1/p)` in two steps: prime powers, then multiplicativity via CRT.

### 5.1 Prime powers

**Lemma 5.1.** `φ(p^e) = p^e − p^{e-1} = p^{e-1}(p − 1)` for prime `p`, `e ≥ 1`.

*Proof.* An integer in `{1, …, p^e}` fails to be coprime to `p^e` exactly when it is a multiple of `p`. The multiples of `p` in that range are `p, 2p, …, p^{e-1}·p`, numbering `p^{e-1}`. The remaining `p^e − p^{e-1}` integers are coprime to `p^e`. ∎

### 5.2 Multiplicativity

**Theorem 5.2.** `φ` is multiplicative: `gcd(a, b) = 1 ⟹ φ(ab) = φ(a)φ(b)`.

*Proof (CRT bijection).* The Chinese Remainder Theorem (sibling `05-crt`) gives a ring isomorphism `ℤ/abℤ ≅ ℤ/aℤ × ℤ/bℤ` (valid because `gcd(a,b)=1`). A ring isomorphism maps units to units, so it restricts to a bijection of unit groups:

```
(ℤ/abℤ)^* ≅ (ℤ/aℤ)^* × (ℤ/bℤ)^*.
```

Concretely, `x` is coprime to `ab` iff `x mod a` is coprime to `a` **and** `x mod b` is coprime to `b`. Counting both sides: `φ(ab) = φ(a)·φ(b)`. ∎

**Worked CRT count.** Take `a = 3`, `b = 5`, `ab = 15`. The units mod `15` are `{1, 2, 4, 7, 8, 11, 13, 14}`, so `φ(15) = 8 = φ(3)·φ(5) = 2·4`. The CRT map sends each unit to its `(mod 3, mod 5)` pair; e.g. `7 ↦ (1, 2)`, `11 ↦ (2, 1)`. Every unit mod `15` corresponds to exactly one pair `(u, v)` with `u ∈ {1, 2}` (units mod 3) and `v ∈ {1, 2, 3, 4}` (units mod 5), and there are `2 × 4 = 8` such pairs — the bijection made visible. A *non*-unit like `6` maps to `(0, 1)`, with a zero coordinate, confirming it is not coprime to `3`.

### 5.3 The product formula

**Theorem 5.3.** If `m = p_1^{e_1} ⋯ p_r^{e_r}` (distinct primes), then

```
φ(m) = ∏_{i=1}^r φ(p_i^{e_i}) = ∏_{i=1}^r p_i^{e_i-1}(p_i − 1) = m ∏_{i=1}^r (1 − 1/p_i).
```

*Proof.* The prime powers `p_i^{e_i}` are pairwise coprime, so iterating Theorem 5.2 gives `φ(m) = ∏_i φ(p_i^{e_i})`. Substitute Lemma 5.1: `φ(p_i^{e_i}) = p_i^{e_i}(1 − 1/p_i)`, and `∏_i p_i^{e_i} = m`. ∎

**Worked example.** Let `m = 360 = 2^3 · 3^2 · 5`. Then

```
φ(360) = φ(2^3)·φ(3^2)·φ(5)
       = (2^3 − 2^2)·(3^2 − 3^1)·(5 − 1)
       = 4 · 6 · 4 = 96,
```

equivalently `360·(1 − 1/2)(1 − 1/3)(1 − 1/5) = 360 · ½ · ⅔ · ⅘ = 96`. The trial-division algorithm computes exactly this: starting from `result = 360`, it does `result -= result/2` (→ 180), `result -= result/3` (→ 120), `result -= result/5` (→ 96) — one subtraction per distinct prime, in any order, because the operations on disjoint prime factors commute. This commuting independence is the algorithmic shadow of multiplicativity (Theorem 5.2).

**Corollary 5.4 (Divisor-sum identity).** `Σ_{d | n} φ(d) = n`.

*Proof.* Partition `{1, …, n}` by `g = gcd(k, n)`. The count of `k ≤ n` with `gcd(k, n) = d` equals `φ(n/d)` (write `k = d·k'`, then `gcd(k', n/d) = 1`). Summing over divisors `d`: `n = Σ_{d|n} φ(n/d) = Σ_{d|n} φ(d)`. ∎ This identity underlies the totient sieve's correctness and Möbius-inversion arguments.

**Worked check.** For `n = 12`, divisors are `{1, 2, 3, 4, 6, 12}`:

```
φ(1) + φ(2) + φ(3) + φ(4) + φ(6) + φ(12)
  = 1  +  1  +  2  +  2  +  2  +  4   = 12.  ✓
```

The partition reads: of `{1, …, 12}`, exactly `φ(12/d)` numbers have `gcd(·, 12) = d`. E.g. the `φ(12) = 4` numbers `{1, 5, 7, 11}` are coprime (`d = 1`), the `φ(6) = 2` numbers `{2, 10}` have `gcd = 2`, and so on, totalling `12`. This identity is the inverse, under Dirichlet convolution, of `φ = μ * id` (Möbius inversion gives `φ(n) = Σ_{d|n} μ(d)·(n/d)`), the analytic-number-theory restatement of the product formula.

---

## 6. Order of an Element Divides `φ(m)` (Lagrange)

**Theorem 6.1.** For `gcd(a, m) = 1`, `ord_m(a)` divides `φ(m)`.

### 6.1 Proof via the cyclic subgroup

The powers `⟨a⟩ = {a^0, a^1, …, a^{d-1}}` (where `d = ord_m(a)`) form a subgroup of `(ℤ/mℤ)^*` of size exactly `d`: they are distinct (if `a^i ≡ a^j` with `0 ≤ i < j < d`, then `a^{j-i} ≡ 1` with `0 < j-i < d`, contradicting minimality of `d`), closed (`a^i a^j = a^{(i+j) mod d}`), and contain inverses (`a^{d-i}` inverts `a^i`). By **Lagrange's theorem**, the order of a subgroup divides the order of the group: `d | φ(m)`. ∎

### 6.2 Lagrange's theorem, stated

**Theorem 6.2 (Lagrange).** In a finite group `G`, the order of any subgroup `H` divides `|G|`.

*Proof sketch.* The left cosets `gH` partition `G` and each has `|H|` elements (the map `h ↦ gh` is a bijection `H → gH`). Hence `|G| = (number of cosets) · |H|`, so `|H| divides |G|`. ∎

**Worked coset partition.** In `(ℤ/7ℤ)^* = {1,2,3,4,5,6}` of order `6`, take `a = 2` with `⟨2⟩ = {1, 2, 4}` (since `2^3 = 8 ≡ 1`), a subgroup of order `3`. Its cosets are:

```
1·⟨2⟩ = {1, 2, 4}
3·⟨2⟩ = {3, 6, 5}   (3·1=3, 3·2=6, 3·4=12≡5)
```

Two cosets, each of size `3`, partitioning all `6` units: `6 = 2 · 3`, so `|⟨2⟩| = 3` divides `φ(7) = 6` exactly as Lagrange requires. This is the concrete mechanism behind `ord_7(2) = 3 | 6`, and hence behind `2^6 ≡ 1 (mod 7)` (Euler/Fermat): `2^6 = (2^3)^2 ≡ 1^2 = 1`.

**Corollary 6.3.** `a^{φ(m)} ≡ 1` (Euler) is immediate: `φ(m) = d · t`, so `a^{φ(m)} = (a^d)^t ≡ 1`. This is the second proof of Theorem 4.1 made fully explicit.

**Why this is the deepest "why".** Many learners memorize Euler's theorem as a standalone fact; Corollary 6.3 reveals it as a one-line consequence of pure group theory. The chain is: (i) units form a group of order `φ(m)` (Theorem 2.1); (ii) the powers of any element form a subgroup of order `ord_m(a)` (Theorem 6.1); (iii) Lagrange forces `ord_m(a) | φ(m)` (Theorem 6.2); (iv) hence raising to `φ(m)` is raising to a multiple of the order, landing on the identity. Every algorithmic fact downstream — exponent reduction, the inverse formula, RSA correctness — is a corollary of this four-step chain. The combinatorial and rearrangement proofs are valuable for intuition, but the Lagrange route is the *structural* reason the theorem is true, and it generalizes to any finite group verbatim.

**Theorem 6.4 (Order of a power).** `ord_m(a^k) = ord_m(a) / gcd(k, ord_m(a))`.

*Proof.* Let `d = ord_m(a)`. Then `(a^k)^j ≡ 1` iff `d | kj` iff `(d/g) | j` where `g = gcd(k, d)`. The least such `j > 0` is `d/g`. ∎ This computes the order of any power without re-scanning, and characterizes which powers of a primitive root are themselves primitive roots (`gcd(k, φ(m)) = 1`).

### 6.3 The fast order algorithm, justified

The naive search for `ord_m(a)` scans `d = 1, 2, …, φ(m)` — `O(φ(m))` powers, infeasible for large `m`. Theorem 6.1 enables a `O(log m · #primes)` algorithm: since `ord_m(a) | φ(m)`, start with the candidate `ord = φ(m)` and remove prime factors that are not needed.

```
ORDER(a, m):
  t := φ(m); ord := t
  for each prime q dividing t:
    while ord % q == 0 and a^(ord/q) ≡ 1 (mod m):
      ord := ord / q
  return ord
```

*Correctness.* The invariant is `a^ord ≡ 1` throughout (we only divide `ord` by `q` when `a^(ord/q) ≡ 1`). At termination, for every prime `q | ord` we have `a^(ord/q) ≢ 1`, so no proper divisor of `ord` annihilates `a` — `ord` is minimal. *Complexity.* Each `while` runs at most `v_q(φ(m)) = O(log m)` times, and there are `O(log m)` distinct primes, each fast power costing `O(log m)`; the dominant cost is usually factoring `φ(m)` (`O(√m)` by trial division).

### 6.4 Worked order computation

Compute `ord_7(3)`. Here `φ(7) = 6 = 2 · 3`. Start `ord = 6`.

```
q = 2:  3^(6/2) = 3^3 = 27 ≡ 6 ≢ 1 (mod 7)  →  keep ord = 6.
q = 3:  3^(6/3) = 3^2 = 9 ≡ 2 ≢ 1 (mod 7)   →  keep ord = 6.
```

No prime can be removed, so `ord_7(3) = 6 = φ(7)`: `3` is a primitive root mod `7`. Contrast `ord_7(2)`: `2^(6/2) = 2^3 = 8 ≡ 1`, so divide by `2` → `ord = 3`; then `q = 3` gives `2^(3/3) = 2 ≢ 1`, stop. `ord_7(2) = 3`, dividing `φ(7) = 6` as Theorem 6.1 guarantees.

---

## 7. The Exponent-Reduction Theorem

**Theorem 7.1.** For `gcd(a, m) = 1` and integers `e, f ≥ 0`:

```
e ≡ f (mod φ(m))   ⟹   a^e ≡ a^f (mod m).
```

In particular `a^e ≡ a^{e mod φ(m)} (mod m)`.

*Proof.* Write `e = f + φ(m)·t` (WLOG `e ≥ f`). Then `a^e = a^f · (a^{φ(m)})^t ≡ a^f · 1^t = a^f (mod m)` by Euler's theorem (Theorem 4.1). ∎

**Sharper version with the order.** The minimal modulus for which the implication holds is `ord_m(a)`, not `φ(m)`: `a^e ≡ a^f (mod m) ⟺ e ≡ f (mod ord_m(a))`. Since `ord_m(a) | φ(m)`, reducing mod `φ(m)` (or mod Carmichael's `λ(m)`, Section 9) is always *sufficient*, though not always minimal.

**Worked reduction.** Compute `3^{1000} mod 7`. `φ(7) = 6` and `gcd(3, 7) = 1`, so `3^{1000} ≡ 3^{1000 mod 6} = 3^{4} = 81 ≡ 4 (mod 7)`. The sharper modulus is `ord_7(3) = 6` (Section 6.4), which here equals `φ(7)`, so no further reduction is possible — `3` is a primitive root, the worst case for shrinking the exponent. For `a = 2` (`ord_7(2) = 3`), `2^{1000} ≡ 2^{1000 mod 3} = 2^{1} = 2 (mod 7)`, a tighter reduction than mod `6` would give (`2^{1000 mod 6} = 2^{4} = 16 ≡ 2` — same answer, confirming both moduli are valid, the order just being the minimal one).

**Theorem 7.2 (Order is the exact period).** The sequence `(a^e mod m)_{e≥0}` is purely periodic with period exactly `ord_m(a)` when `gcd(a, m) = 1`.

*Proof.* `a^{e + ord_m(a)} = a^e · a^{ord_m(a)} ≡ a^e`, so `ord_m(a)` is a period. If `t < ord_m(a)` were a period, then `a^t = a^0·a^t ≡ a^0 = 1` (taking `e = 0`), contradicting minimality. Purity (no non-repeating prefix) holds because `a` is invertible: `a^e ≡ a^{e+T}` can be cancelled back to `a^{e-1} ≡ a^{e-1+T}`, down to `e = 0`. ∎

The purity in Theorem 7.2 is *exactly* what fails when `gcd(a, m) > 1` — the base is not invertible, cancellation is blocked, and a non-periodic tail appears. That is the subject of Section 8.

---

## 8. The Generalized Rule for `gcd(a, m) > 1`

When `a` and `m` share a factor, `a` is not a unit, the sequence `a^e mod m` has a **non-periodic prefix**, and Theorem 7.1 fails. The repair:

**Theorem 8.1 (Generalized Euler / lifting the exponent of the modulus).** For all `a, m ≥ 1` and `e ≥ log₂ m`:

```
a^e ≡ a^{(e mod φ(m)) + φ(m)}  (mod m).
```

*Proof.* Factor `m = m_1 · m_2` where `m_1` collects the prime powers `p^{k}` with `p | a`, and `m_2 = m / m_1` is coprime to `a`. Then by CRT it suffices to prove the congruence mod `m_1` and mod `m_2` separately.

*Mod `m_2` (coprime part):* `gcd(a, m_2) = 1`, so by Theorem 7.1, `a^e ≡ a^{e mod φ(m_2)}`. Since `φ(m_2) | φ(m)`, adding any multiple of `φ(m)` does not change the residue mod `m_2`. Hence `a^e ≡ a^{(e mod φ(m)) + φ(m)} (mod m_2)`.

*Mod `m_1` (shared part):* every prime in `m_1` divides `a`, so `m_1 | a^{e}` once `e ≥ (max prime-power exponent in m_1)`. Because `m_1 ≤ m`, that exponent is at most `log₂ m`. Both `a^e` and `a^{(e mod φ(m)) + φ(m)}` have exponents `≥ log₂ m` (the right side is `≥ φ(m) ≥ 1`, and we require `e ≥ log₂ m`), so both are `≡ 0 (mod m_1)`.

The congruence holds mod both `m_1` and `m_2`, hence mod `m` by CRT. ∎

**Why the `+φ(m)` guard.** The reduced exponent `e mod φ(m)` could be smaller than `log₂ m`, landing *inside* the non-periodic tail mod `m_1`. Adding `φ(m)` pushes it past the tail (since `φ(m) ≥ √(m/2) ≥ log₂ m` for `m ≥ 2`... more simply, `φ(m) ≥ log₂ m` for all practical `m`) while leaving the residue mod `m_2` unchanged. This is the precise reason towers use `(e mod φ(m)) + φ(m)` unconditionally.

### 8.1 Worked example of the generalized rule

Compute `2^100 mod 12`. Here `gcd(2, 12) = 2 ≠ 1`, so plain Euler reduction is invalid. Factor `12 = 4 · 3` with `m_1 = 4` (shares the prime `2` with the base) and `m_2 = 3` (coprime). `φ(12) = 4`.

```
e = 100,  e mod φ(12) = 100 mod 4 = 0.
Naive (wrong): 2^0 = 1.
Generalized:   2^(0 + 4) = 2^4 = 16 ≡ 4 (mod 12).
```

Direct check: the powers of `2` mod `12` are `2, 4, 8, 4, 8, 4, …` — a tail `2` then the cycle `(4, 8)` of length 2. For `e ≥ 2` they are `4` when `e` is even and `8` when `e` is odd. Since `100` is even, `2^100 ≡ 4 (mod 12)` — matching the generalized rule and refuting the naive `1`. The `+φ` guard rescued the answer by lifting the exponent `0` past the length-1 tail.

### 8.2 The iterated-totient chain length

**Lemma 8.3.** The chain `m_0 = m, m_{i+1} = φ(m_i)` reaches `1` in at most `⌈2 log₂ m⌉` steps.

*Proof.* If `m_i` is even, `φ(m_i) ≤ m_i / 2` (at least half the residues are even, hence non-coprime). If `m_i` is odd and `> 1`, then `φ(m_i)` is even (a number `> 2` has even totient, and odd primes contribute the even factor `p − 1`), so the *next* step halves. Thus every two steps at least halve the value, giving the `O(log m)` bound. ∎ This bounds the recursion depth of tower evaluation independently of the tower's height — a height-`10^9` tower mod a 64-bit modulus still recurses at most ~128 levels.

**Corollary 8.2 (Tower recursion).** A tower `a_1^{a_2^{⋰}} mod m` is computed by recursing on the iterated totient: the exponent is evaluated mod `φ(m)` using `a_2^{⋰} mod φ(m)` with the same `+φ` guard, and so on. The chain `m, φ(m), φ(φ(m)), …` reaches `1` in `O(log m)` steps because `φ(m) ≤ m/2` for even `m` and `φ(φ(m))` is even, so the chain at least halves every two steps. ∎

---

## 9. Carmichael's Function `λ(m)`

Euler's exponent `φ(m)` is universal but not always minimal. The least universal exponent is Carmichael's `λ(m)`.

**Definition 9.1.** `λ(m)` is the smallest positive integer such that `a^{λ(m)} ≡ 1 (mod m)` for *all* `a` with `gcd(a, m) = 1`. Equivalently, `λ(m) = max_{gcd(a,m)=1} ord_m(a)` is the **exponent of the group** `(ℤ/mℤ)^*`.

**Theorem 9.2 (Formula).**
```
λ(p^e) = φ(p^e) = p^{e-1}(p-1)   for odd prime p, and for p^e ∈ {2, 4};
λ(2^e) = 2^{e-2}                  for e ≥ 3;
λ(p_1^{e_1} ⋯ p_r^{e_r}) = lcm( λ(p_1^{e_1}), …, λ(p_r^{e_r}) ).
```

*Proof sketch.* For odd prime powers and for `2, 4`, the units group is **cyclic** (Section 10), so its exponent equals its order `φ(p^e)`. For `2^e` with `e ≥ 3`, `(ℤ/2^eℤ)^* ≅ ℤ/2 × ℤ/2^{e-2}`, whose exponent is `lcm(2, 2^{e-2}) = 2^{e-2}`. By CRT, `(ℤ/mℤ)^*` is the product of the prime-power unit groups, and the exponent of a product of groups is the lcm of the exponents. ∎

**Theorem 9.3.** `λ(m) | φ(m)`, and `a^{λ(m)} ≡ 1 (mod m)` for every unit `a`.

*Proof.* `λ(m)` is the lcm of element orders, each of which divides `φ(m)` (Theorem 6.1), so the lcm divides `φ(m)`. Every element's order divides `λ(m)` by definition of the group exponent, giving `a^{λ(m)} ≡ 1`. ∎

**Consequence.** Theorems 7.1 and 8.1 hold verbatim with `φ(m)` replaced by `λ(m)` — a tighter (smaller) reduction modulus. The notorious case is `λ(2^e) = 2^{e-2}`, exactly half of `φ(2^e) = 2^{e-1}`: e.g. every odd square is `≡ 1 (mod 8)`, so `λ(8) = 2 < 4 = φ(8)`. Standardized RSA (PKCS#1) defines `d = e^{-1} mod λ(N)` to allow the minimal private exponent.

### 9.1 Worked Carmichael computation

Compute `λ(360)` for `360 = 2^3 · 3^2 · 5`:

```
λ(2^3) = 2^{3-2} = 2          (special case, NOT φ(2^3) = 4)
λ(3^2) = φ(3^2) = 3·2 = 6
λ(5)   = φ(5)   = 4
λ(360) = lcm(2, 6, 4) = 12.
```

Contrast `φ(360) = 96` (Section 5 worked example): `λ(360) = 12` is eight times smaller. Both are valid universal exponents (`a^96 ≡ 1` and `a^12 ≡ 1` for every coprime `a`), but `12` is minimal. Verify on `a = 7`: `7^12 mod 360`. By CRT it suffices that `7^12 ≡ 1` mod `8`, `9`, `5`: `7 ≡ −1 (mod 8)` so `7^12 ≡ 1`; `ord_9(7) = 3 | 12`; `ord_5(7) = ord_5(2) = 4 | 12` — all hold, so `7^12 ≡ 1 (mod 360)`. No smaller universal exponent works because `λ(360) = 12` is achieved by an element of order `12` (e.g. one of order `4` mod `5` combined via CRT with order `6` mod `9`).

### 9.2 Why `λ(2^e) = 2^{e-2}` for `e ≥ 3`

The unit group `(ℤ/2^eℤ)^*` is **not cyclic** for `e ≥ 3`; it is `⟨−1⟩ × ⟨5⟩ ≅ ℤ/2 × ℤ/2^{e-2}`. The element `−1` has order `2`, and `5` (or `3`) has order `2^{e-2}`. The group exponent is `lcm(2, 2^{e-2}) = 2^{e-2}`, half of `φ(2^e) = 2^{e-1}`. Concretely mod `8`: the units are `{1, 3, 5, 7}` and *every one squares to `1`* (`3^2 = 9 ≡ 1`, `5^2 = 25 ≡ 1`, `7^2 = 49 ≡ 1`), so `λ(8) = 2` even though `φ(8) = 4`. This is the canonical example of Euler's exponent being non-sharp, and the single most common implementation bug in Carmichael-function code.

---

## 10. Primitive Roots and the Cyclic Structure

**Definition 10.1.** A **primitive root** mod `m` is a unit `g` with `ord_m(g) = φ(m)` — a generator of `(ℤ/mℤ)^*`. It exists iff `(ℤ/mℤ)^*` is cyclic.

**Theorem 10.2 (Existence).** `(ℤ/mℤ)^*` is cyclic (a primitive root exists) **iff** `m ∈ {1, 2, 4, p^k, 2p^k}` for an odd prime `p`.

*Proof sketch.* For prime `p`, the polynomial `x^d − 1` has at most `d` roots in the field `ℤ/pℤ`; a counting argument (Gauss) over divisors of `p-1` using `Σ_{d|p-1} φ(d) = p-1` (Corollary 5.4) shows an element of order exactly `p-1` exists. The result lifts to `p^k` and `2p^k` by Hensel-type arguments. For all other `m` the group is a nontrivial product of cyclic groups (e.g. `(ℤ/8ℤ)^* ≅ ℤ/2 × ℤ/2`), hence not cyclic. ∎

**Theorem 10.3 (Count of primitive roots).** If a primitive root exists mod `m`, there are exactly `φ(φ(m))` of them. 

*Proof.* If `g` is a primitive root, the primitive roots are precisely `g^k` with `gcd(k, φ(m)) = 1` (Theorem 6.4 with `d = φ(m)`), and there are `φ(φ(m))` such `k`. ∎

**Significance.** When `(ℤ/mℤ)^*` is cyclic, `λ(m) = φ(m)` and a single generator `g` lets you take **discrete logarithms** (sibling `11-discrete-log-bsgs`) and **discrete roots** (sibling `12-primitive-root-discrete-root`). Cyclicity is exactly why Fermat's `a^{p-1} ≡ 1` is *sharp* for some `a` (a primitive root mod `p` has order exactly `p-1`), whereas Euler's `a^{φ(m)} ≡ 1` may be non-sharp for non-cyclic `m` (where `λ(m) < φ(m)`).

### 10.1 Worked primitive-root count

Mod `7` (prime, hence cyclic), `φ(7) = 6` and there are `φ(φ(7)) = φ(6) = 2` primitive roots. From Section 6.4, `3` is one (`ord = 6`). The other is `3^k` with `gcd(k, 6) = 1`, i.e. `k ∈ {1, 5}`: `3^1 = 3` and `3^5 = 243 ≡ 5 (mod 7)`. So the primitive roots mod `7` are exactly `{3, 5}`, and indeed `ord_7(5) = 6` (check: `5^2 = 25 ≡ 4`, `5^3 = 125 ≡ 6 ≢ 1`). The non-generators `{2, 4, 6}` have orders `3, 3, 2` respectively, each a *proper* divisor of `6`. This illustrates Theorem 10.3: the count of generators is `φ(φ(m))`, and the generators are precisely the `g^k` with `k` coprime to `φ(m)`.

### 10.2 The structure theorem in one line

Combining Sections 9–10: `(ℤ/mℤ)^*` decomposes by CRT into a product `∏ (ℤ/p_i^{e_i}ℤ)^*`, each factor cyclic except `(ℤ/2^eℤ)^*` for `e ≥ 3` (which is `ℤ/2 × ℤ/2^{e-2}`). The whole group is cyclic iff that product is cyclic iff `m ∈ {1, 2, 4, p^k, 2p^k}` — the precise list of Theorem 10.2. This single structural fact subsumes the totient (group order `φ(m)`), the Carmichael function (group exponent `λ(m)`), the existence of primitive roots (cyclicity), and the order of every element (a divisor of `λ(m)`, itself a divisor of `φ(m)`).

---

## 11. Pseudoprimes, Carmichael Numbers, and the Limits of FLT

The converse of Fermat is false, which bounds its use as a primality test.

**Definition 11.1 (Fermat pseudoprime).** A composite `n` is a **Fermat pseudoprime to base `a`** if `gcd(a, n) = 1` and `a^{n-1} ≡ 1 (mod n)` — it *passes* the Fermat test despite being composite.

**Definition 11.2 (Carmichael number).** A composite `n` that is a Fermat pseudoprime to **every** base `a` coprime to `n`.

**Theorem 11.3 (Korselt's criterion).** A composite `n` is a Carmichael number iff `n` is **squarefree** and `(p − 1) | (n − 1)` for every prime `p | n`.

*Proof sketch.* `a^{n-1} ≡ 1 (mod n)` for all coprime `a` iff `λ(n) | (n-1)`. With `n = ∏ p_i` squarefree, `λ(n) = lcm(p_i − 1)`, so `λ(n) | (n-1)` iff each `(p_i − 1) | (n-1)`. A repeated prime factor would force `p | λ(n)` while `p ∤ (n-1)`, breaking the condition — hence squarefree. ∎

**Corollary 11.4.** Carmichael numbers exist (the smallest is `561 = 3·11·17`: check `2|560, 10|560, 16|560`), there are infinitely many (Alford–Granville–Pomerance 1994), and they make the Fermat test **unreliable** as a primality proof. The remedy is **Miller-Rabin** (sibling `08-miller-rabin-primality`), which additionally tests for nontrivial square roots of `1` and provably has no "Carmichael-like" universal liar: for every odd composite `n`, at least `3/4` of bases are witnesses.

**Theorem 11.5 (Why Miller-Rabin escapes the Carmichael trap).** For odd composite `n`, write `n - 1 = 2^s d` with `d` odd. The Miller-Rabin condition `a^d ≡ 1` or `a^{2^r d} ≡ -1` for some `0 ≤ r < s` is satisfied by at most `φ(n)/4` bases. Carmichael numbers fail it because they admit nontrivial square roots of `1` (a consequence of having ≥ 3 prime factors or specific structure), which the extra `-1` check detects. ∎

This is the precise sense in which Fermat's theorem is *necessary but not sufficient* for primality, and why production code never relies on FLT alone.

### 11.1 Worked Carmichael verification: 561

`561 = 3 · 11 · 17` is squarefree (no repeated prime). Check Korselt's divisibility `(p − 1) | (n − 1) = 560`:

```
3 − 1  = 2,   560 / 2  = 280  ✓
11 − 1 = 10,  560 / 10 = 56   ✓
17 − 1 = 16,  560 / 16 = 35   ✓
```

All three hold, so by Theorem 11.3, `561` is a Carmichael number — `a^560 ≡ 1 (mod 561)` for *every* `a` coprime to `561`. A naive Fermat test would declare `561` "probably prime" for all bases, a complete failure. Miller-Rabin catches it: `560 = 2^4 · 35`, and testing base `a = 2`, the chain `2^35, 2^70, 2^140, 2^280 (mod 561)` never produces `−1` before reaching `1`, exposing a nontrivial square root of `1` and hence compositeness. The smallest Carmichael numbers are `561, 1105, 1729, 2465, 2821, 6601, 8911` — all squarefree with `≥ 3` prime factors (a Carmichael number must have at least three prime factors, a corollary of Korselt's criterion).

### 11.2 Fermat quotient and Wieferich primes (aside)

The "amount by which FLT holds" is captured by the **Fermat quotient** `q_p(a) = (a^{p-1} − 1)/p`, an integer by Theorem 3.1. Primes `p` with `q_p(2) ≡ 0 (mod p)` — i.e. `2^{p-1} ≡ 1 (mod p^2)` — are **Wieferich primes** (only `1093` and `3511` are known below `10^{18}`). These refine FLT from a mod-`p` to a mod-`p^2` statement and connect to Fermat's Last Theorem's first case; they are mentioned to show that the *sharpness* of Fermat's congruence is itself a deep object of study, not a closed book.

---

## 11b. RSA Correctness and the `φ(N)`-Factoring Equivalence

Euler's theorem is the *reason* RSA decrypts; the totient's secrecy is the *reason* RSA is secure. We make both precise.

**Theorem 11b.1 (RSA correctness).** Let `N = pq` (distinct primes), `gcd(e, λ(N)) = 1`, and `d ≡ e^{-1} (mod λ(N))`. Then for every integer `m`, `(m^e)^d ≡ m (mod N)`.

*Proof.* `ed = 1 + kλ(N)` for some `k ≥ 0`. By CRT it suffices to show `m^{ed} ≡ m (mod p)` and `(mod q)`. Mod `p`: if `p ∤ m`, then by Fermat `m^{p-1} ≡ 1`, and since `(p-1) | λ(N)`, `m^{ed} = m·(m^{λ(N)})^k ≡ m·1 = m`. If `p | m`, both sides are `≡ 0 (mod p)`. The same holds mod `q`. By CRT, `m^{ed} ≡ m (mod N)`. ∎

Note the proof uses `λ(N) = lcm(p-1, q-1)` (Section 9), not `φ(N) = (p-1)(q-1)`; either works since `λ(N) | φ(N)`, but `λ(N)` yields the smaller `d`.

**Theorem 11b.2 (Computing `φ(N)` is equivalent to factoring `N = pq`).** Given `N` and `φ(N)`, the factors `p, q` are recoverable in polynomial time; conversely `φ(N)` is trivially computed from `p, q`.

*Proof.* From `φ(N) = (p-1)(q-1) = N − (p+q) + 1`, set `S = p + q = N − φ(N) + 1`. Then `p, q` are the roots of `x² − Sx + N = 0`, i.e.

```
p, q = ( S ± √(S² − 4N) ) / 2.
```

`S² − 4N = (p+q)² − 4pq = (p−q)²` is a perfect square, so the square root is exact and `p, q` are integers recovered in `O(poly(log N))`. Conversely `φ(N) = (p-1)(q-1)` is immediate from the factorization. ∎

**Worked example.** `N = 3233 = 53 · 61`, `φ(N) = 52 · 60 = 3120`. An attacker who learns `φ(N) = 3120` computes `S = 3233 − 3120 + 1 = 114`, then `√(114² − 4·3233) = √(12996 − 12932) = √64 = 8`, giving `p, q = (114 ± 8)/2 = 61, 53`. The factorization falls out instantly. This is why `φ(N)` (equivalently `d`, equivalently the factorization) must remain secret: any one of them yields all the others. The hardness of *obtaining* `φ(N)` from `N` alone — believed to require factoring — is the entire security assumption of RSA.

**Corollary 11b.3 (Knowing `d` factors `N`).** Even the private exponent `d` alone (with `e`, `N`) suffices to factor `N` in randomized polynomial time: `ed − 1` is a multiple of `λ(N)`, and a standard probabilistic argument (find a nontrivial square root of `1` mod `N` by halving the exponent `ed − 1`) splits `N`. Hence revealing `d` is as catastrophic as revealing the factorization — there is no "use `d` but keep `p, q` secret."

---

## 12. Summary

- **Units group.** `(ℤ/mℤ)^*` is an abelian group of order `φ(m)` (Theorem 2.1); `a` is a unit iff `gcd(a, m) = 1` (Prop. 1.3). Fermat and Euler are both "element order divides group order."
- **Fermat (Theorem 3.1).** `a^{p-1} ≡ 1 (mod p)` for prime `p`, `gcd(a,p)=1`; equivalently `a^p ≡ a`. Proven by rearrangement (units permute) and combinatorially (prime-length necklace orbits have size 1 or p). Inverse: `a^{-1} ≡ a^{p-2}`.
- **Euler (Theorem 4.1).** `a^{φ(m)} ≡ 1 (mod m)` for `gcd(a,m)=1`, by the same rearrangement over the `φ(m)` units or by Lagrange. Inverse: `a^{-1} ≡ a^{φ(m)-1}`.
- **Totient formula (Theorems 5.1–5.3).** `φ(p^e) = p^{e-1}(p-1)`; `φ` is multiplicative via the CRT unit-group isomorphism; hence `φ(m) = m ∏_{p|m}(1 − 1/p)`. The divisor-sum identity `Σ_{d|n} φ(d) = n` (Cor. 5.4) underlies the sieve.
- **Order divides `φ(m)` (Theorem 6.1).** The cyclic subgroup `⟨a⟩` has order `ord_m(a)`, which divides `|G| = φ(m)` by Lagrange — the structural reason Euler's theorem holds. `ord_m(a^k) = ord_m(a)/gcd(k, ord_m(a))`.
- **Exponent reduction (Theorem 7.1).** `a^e ≡ a^{e mod φ(m)} (mod m)` for coprime `a`; the exact period is `ord_m(a)` and the sequence is purely periodic.
- **Generalized rule (Theorem 8.1).** For any base and `e ≥ log₂ m`: `a^e ≡ a^{(e mod φ(m)) + φ(m)}` — the `+φ` guard clears the non-periodic tail from the shared (non-coprime) part of the modulus; towers recurse through the `O(log m)`-length iterated-totient chain.
- **Carmichael `λ(m)` (Theorems 9.2–9.3).** The least universal exponent, the group's exponent, `λ(m) | φ(m)`; the trap `λ(2^e) = 2^{e-2}`; RSA uses `λ(N) = lcm(p-1, q-1)`.
- **Primitive roots (Theorems 10.2–10.3).** `(ℤ/mℤ)^*` is cyclic iff `m ∈ {1,2,4,p^k,2p^k}`; then `φ(φ(m))` generators exist — the gateway to discrete logs.
- **Limits of FLT (Theorems 11.3–11.5).** The converse fails: Fermat pseudoprimes and Carmichael numbers (Korselt's criterion) fool the Fermat test for all bases; Miller-Rabin repairs this with the square-root-of-1 check.
- **RSA (Theorems 11b.1–11b.3).** Decryption recovers the message by Euler/Fermat via CRT; computing `φ(N)` (or `d`) is equivalent to factoring `N = pq`, the security assumption made precise by the quadratic `x² − Sx + N = 0`.

### Worked-Example Index

| Section | What it demonstrates |
|---------|----------------------|
| 2.1–2.2 | Units group mod 8, rearrangement permutation, coset partition |
| 3.3–3.4 | Necklace count proof of FLT for `p = 5` |
| 4.3–4.4 | Euler rearrangement mod 10; non-coprime orbit avoiding 1 |
| 5 (×3) | `φ(360) = 96`; divisor-sum for 12; CRT count mod 15 |
| 6.4 | Fast order: `ord_7(3) = 6`, `ord_7(2) = 3` |
| 6.2 | Lagrange coset partition of `(ℤ/7ℤ)^*` by `⟨2⟩` |
| 7 | Exponent reduction `3^1000 mod 7`, `2^1000 mod 7` |
| 8.1 | Generalized rule `2^100 mod 12 = 4` (non-coprime) |
| 9.1–9.2 | `λ(360) = 12`; why `λ(8) = 2 < φ(8) = 4` |
| 10.1 | Primitive roots mod 7 are exactly `{3, 5}` |
| 11.1 | Korselt verification of `561` |
| 11b.2 | Factoring `N = 3233` from `φ(N) = 3120` |

Read in sequence, these examples form a self-contained numeric companion to the proofs: a reader who verifies each by hand will have re-derived the entire theory on small cases before trusting the general theorems.

### Theorem-Dependency Cheat Table

| Result | Depends on | Used by |
|--------|-----------|---------|
| Euler `a^{φ(m)} ≡ 1` | Lagrange / units bijection | exponent reduction, RSA, inverses |
| Fermat `a^{p-1} ≡ 1` | Euler at `m = p` | prime-modulus inverse, primality test |
| Totient formula | CRT + prime-power count | computing/sieving `φ`, RSA `φ(N)` |
| `ord | φ(m)` | Lagrange | order/primitive-root computation, Euler |
| Exponent reduction | Euler | huge exponents, towers |
| Generalized `+φ` rule | CRT split + Euler | non-coprime towers |
| Carmichael `λ` | group exponent + CRT | tightest reduction, RSA `d` |
| Primitive roots | cyclicity of `(ℤ/p^kℤ)^*` | discrete log/root |

### Closing Notes

- **One structure, many theorems.** The single object `(ℤ/mℤ)^*` — abelian of order `φ(m)`, exponent `λ(m)`, cyclic iff `m ∈ {1,2,4,p^k,2p^k}` — generates Fermat, Euler, totient, order divisibility, primitive roots, and the exponent rules. Memorize the structure, derive the rest.
- **Lagrange is the spine.** "Element order divides group order" yields Euler directly and Fermat as a special case; everything about exponent reduction is downstream of this one fact.
- **Coprimality is the precondition that recurs everywhere.** Inverses exist iff `gcd(a,m)=1`; reduction mod `φ(m)` is valid iff `gcd(a,m)=1`; the `+φ` guard is exactly the repair when it fails. Track coprimality and the theorems align.
- **Sharpness vs sufficiency.** `a^{φ(m)} ≡ 1` is always *true* but *sharp* only for primitive roots; the order (or `λ(m)`) is the minimal exponent, and the gap (e.g. `λ(8) = 2 < φ(8) = 4`) is where subtle bugs hide.
- **The converse fails.** FLT is necessary, not sufficient, for primality (Carmichael numbers); RSA's security is the *non*-invertibility of `N ↦ φ(N)` without factoring — the same totient that makes decryption work makes the cipher hard.

Foundational references: Hardy & Wright, *An Introduction to the Theory of Numbers* (Fermat, Euler, totient, primitive roots); Ireland & Rosen, *A Classical Introduction to Modern Number Theory* (units groups, Carmichael); Korselt (1899) and Alford–Granville–Pomerance (1994) for Carmichael numbers; Miller (1976) and Rabin (1980) for the primality test. Sibling topics: `02-modular-arithmetic`, `03-prime-sieves`, `05-crt`, `06-extended-euclidean-modular-inverse`, `08-miller-rabin-primality`, `11-discrete-log-bsgs`, `12-primitive-root-discrete-root`, `26-binary-exponentiation`.
