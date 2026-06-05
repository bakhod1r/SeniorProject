# Modular Arithmetic — Mathematical Foundations and Algebraic Structure

## Table of Contents
1. Formal Definitions: Congruence and Residue Classes
   - 1.1 The Quotient Construction
2. `Z/mZ` as a Commutative Ring
3. Well-Definedness of Modular Operations
4. Units, Coprimality, and the Group `(Z/mZ)*`
   - 4.1 Worked Example: Units mod 12
5. Euler's Totient and the Order of the Unit Group
   - 5.1 Worked Totient Computations
6. Existence of Inverses: Bézout and Euler
   - 6.1 Worked Bézout Inverse
7. Fermat's Little Theorem and Euler's Theorem
   - 7.1 Worked Example: Euler vs Fermat Inverse
   - 7.2 The Order of an Element
8. The Field `Z/pZ` (Prime Modulus)
   - 8.1 Worked Example: the Field `Z/5Z`
   - 8.2 Why Polynomials over `Z/pZ` Behave Well
9. Wilson's Theorem
   - 9.1 Worked Wilson Pairing
10. Zero Divisors and Cancellation in Composite Moduli
    - 10.1 Worked Example: Cancellation Failure
    - 10.2 Solvability of Linear Congruences
11. The Chinese Remainder Theorem (Structural View)
    - 11.1 Worked CRT Isomorphism
    - 11.2 RSA as a CRT Application
11c. Worked Fermat Inverse via Modpow
11b. From Theorems to Algorithms: The Foundations Map
12. Summary

---

## 1. Formal Definitions: Congruence and Residue Classes

Fix an integer modulus `m ≥ 1`.

**Definition 1.1 (Congruence).** For integers `a, b`, we say `a` is **congruent to** `b` **modulo** `m`, written `a ≡ b (mod m)`, iff `m | (a − b)` (i.e. `m` divides `a − b`).

**Proposition 1.2 (Congruence is an equivalence relation).** For fixed `m`, `≡ (mod m)` is reflexive, symmetric, and transitive.

**Proof.** *Reflexive:* `m | (a − a) = 0`. *Symmetric:* if `m | (a − b)` then `m | −(a − b) = (b − a)`. *Transitive:* if `m | (a − b)` and `m | (b − c)`, then `m | ((a − b) + (b − c)) = (a − c)`. ∎

**Definition 1.3 (Residue class).** The **residue class** of `a` modulo `m` is the equivalence class

```
[a]_m = { x ∈ Z : x ≡ a (mod m) } = { a + km : k ∈ Z }.
```

There are exactly `m` distinct residue classes, represented by `0, 1, …, m−1` (the **least non-negative residues**). The set of all residue classes is denoted `Z/mZ`.

**Proposition 1.4 (Equivalent characterizations).** The following are equivalent: (i) `a ≡ b (mod m)`; (ii) `a` and `b` have the same remainder under Euclidean division by `m`; (iii) `[a]_m = [b]_m`.

**Proof.** Write `a = q_a m + r_a` and `b = q_b m + r_b` with `0 ≤ r_a, r_b < m` (Euclidean division, which exists and is unique). Then `a − b = (q_a − q_b)m + (r_a − r_b)`, so `m | (a − b)` iff `m | (r_a − r_b)`. Since `|r_a − r_b| < m`, this holds iff `r_a = r_b`. That is (i) ⟺ (ii). The equivalence with (iii) is immediate from the definition of the class. ∎

**Worked example.** Mod `m = 12`: is `−9 ≡ 27`? By (i), `12 | (−9 − 27) = −36`, and `12 | 36`, so yes. By (ii), `−9 = (−1)·12 + 3` has remainder `3`, and `27 = 2·12 + 3` has remainder `3` — same remainder. By (iii), both lie in `[3]_12 = {…, −21, −9, 3, 15, 27, 39, …}`. All three characterizations confirm the congruence, illustrating that the "clock slot `3`" of the junior file is the rigorous residue class `[3]_12`. The negative representative `−9` is congruent to the canonical `3` — exactly the situation the `((x%m)+m)%m` idiom normalizes in code.

**Notation.** Throughout, `m` is the modulus, `p` a prime, `φ` Euler's totient, `gcd(a, b)` the greatest common divisor, and `(Z/mZ)*` the group of units. The **Iverson bracket** `[P]` is `1` if `P` holds, else `0`.

### 1.1 The Quotient Construction

Formally, `Z/mZ` is the **quotient ring** of `Z` by the ideal `mZ = {km : k ∈ Z}`. The residue classes `[a]_m = a + mZ` are precisely the **cosets** of this ideal, and the ring operations on classes are inherited from `Z` via the canonical surjection `π : Z → Z/mZ`, `π(a) = [a]_m`. This is the abstract-algebra viewpoint behind everything that follows: `π` is a *ring homomorphism* (it preserves `+` and `·`), its kernel is exactly `mZ`, and the first isomorphism theorem identifies `Z/ker(π) = Z/mZ` with the image. The "reduce mod `m`" operation of programming *is* this homomorphism `π`, and Theorem 3.1 is just the statement that `π` is well-defined and structure-preserving.

The ideal `mZ` is **maximal** iff `m` is prime, and a quotient by a maximal ideal is a field — which is the abstract reason for Theorem 8.2 (`Z/pZ` is a field iff `p` is prime). For composite `m`, `mZ` is not maximal (it sits inside larger proper ideals like `dZ` for `d | m`), so the quotient is only a ring, with the zero divisors of Section 10. This single algebraic fact — maximal ideal ⟺ prime modulus ⟺ field quotient — organizes the entire document.

---

## 2. `Z/mZ` as a Commutative Ring

We equip the set `Z/mZ` of residue classes with two operations:

```
[a]_m + [b]_m := [a + b]_m,        [a]_m · [b]_m := [a · b]_m.
```

These are well-defined (Section 3). With them, `Z/mZ` is a ring.

**Theorem 2.1.** `(Z/mZ, +, ·)` is a commutative ring with multiplicative identity `[1]_m`.

**Proof.** Each axiom is inherited from `Z` via the representatives:
- `(Z/mZ, +)` is an abelian group: associativity and commutativity of `+` come from `Z`; the identity is `[0]_m`; the inverse of `[a]_m` is `[−a]_m` (since `[a]_m + [−a]_m = [0]_m`).
- `·` is associative and commutative, inherited from `Z`.
- `[1]_m` is the multiplicative identity: `[a]_m · [1]_m = [a·1]_m = [a]_m`.
- Distributivity: `[a]_m · ([b]_m + [c]_m) = [a(b+c)]_m = [ab + ac]_m = [a]_m·[b]_m + [a]_m·[c]_m`.

All axioms hold, so `Z/mZ` is a commutative ring with unity. ∎

This is the algebraic home of all of modular arithmetic: `+`, `−`, `·` are the ring operations, and the central question of the rest of this document is *which elements have multiplicative inverses* — i.e., when can we divide.

**Worked ring laws mod 6.** Take `Z/6Z = {0,1,2,3,4,5}`. Additive inverses: `−[1] = [5]`, `−[2] = [4]`, `−[3] = [3]` (self-inverse, since `3 + 3 = 6 ≡ 0`). Distributivity check: `[2]·([3]+[5]) = [2]·[8] = [2]·[2] = [4]`, and `[2]·[3] + [2]·[5] = [6] + [10] = [0] + [4] = [4]` — they agree. Note this ring is *not* a field: `[2]·[3] = [6] = [0]`, so `[2]` and `[3]` are zero divisors, and neither has a multiplicative inverse. The ring axioms hold for every `m`; the *field* property (Section 8) is the extra structure only primes provide.

---

## 3. Well-Definedness of Modular Operations

Before using `[a]_m + [b]_m := [a+b]_m`, we must verify the result does not depend on which representatives `a, b` we picked. This is the **compatibility** (or **congruence**) property that makes the junior-level rule "reduce mod `m` at any time" valid.

**Theorem 3.1 (Compatibility of congruence with `+`, `−`, `·`).** If `a ≡ a' (mod m)` and `b ≡ b' (mod m)`, then:

```
(1)  a + b ≡ a' + b'   (mod m)
(2)  a − b ≡ a' − b'   (mod m)
(3)  a · b ≡ a' · b'   (mod m)
```

**Proof.** By hypothesis `m | (a − a')` and `m | (b − b')`. Write `a − a' = m s` and `b − b' = m t`.

*(1):* `(a + b) − (a' + b') = (a − a') + (b − b') = m(s + t)`, so `m | ((a+b) − (a'+b'))`.

*(2):* `(a − b) − (a' − b') = (a − a') − (b − b') = m(s − t)`.

*(3):* `ab − a'b' = ab − a'b + a'b − a'b' = b(a − a') + a'(b − b') = m(bs + a't)`, so `m | (ab − a'b')`. ∎

**Corollary 3.2 (Reduce-anytime).** For any integer expression built from `+`, `−`, `·`, reducing any subexpression mod `m` does not change the final residue mod `m`. In particular `(a · b) mod m = ((a mod m) · (b mod m)) mod m`.

**Worked illustration.** With `m = 7`, evaluate `(50 · 50) mod 7` two ways. Directly: `2500 mod 7 = 2500 − 357·7 = 2500 − 2499 = 1`. Reduced first: `50 mod 7 = 1`, so `(1 · 1) mod 7 = 1`. Both give `1` — Corollary 3.2 in action, and the reason `mulmod` may reduce operands before the multiply to keep them small. This is not a numerical coincidence; Theorem 3.1(3) guarantees it for *every* input.

**Remark (why subtraction needs the normalization idiom).** Theorem 3.1(2) guarantees the *residue class* `[a − b]_m` is correct, but a programming-language `%` may return a *representative* outside `[0, m)`. The identity `((x % m) + m) % m` selects the canonical least non-negative representative; it changes the representative, never the class. The mathematics and the code agree precisely once you fix the representative.

---

## 4. Units, Coprimality, and the Group `(Z/mZ)*`

**Definition 4.1 (Unit).** An element `[a]_m ∈ Z/mZ` is a **unit** if it has a multiplicative inverse: there exists `[b]_m` with `[a]_m · [b]_m = [1]_m`, i.e. `a·b ≡ 1 (mod m)`.

**Theorem 4.2 (Unit ⟺ coprime).** `[a]_m` is a unit iff `gcd(a, m) = 1`.

**Proof.** *(⇐)* If `gcd(a, m) = 1`, by Bézout's identity there exist integers `x, y` with `ax + my = 1`. Reducing mod `m`: `ax ≡ 1 (mod m)`, so `[x]_m` is the inverse of `[a]_m`.

*(⇒)* If `ab ≡ 1 (mod m)`, then `ab = 1 + km` for some `k`, i.e. `ab − km = 1`. Any common divisor `d` of `a` and `m` divides the left side, hence divides `1`, so `d = 1`. Thus `gcd(a, m) = 1`. ∎

**Definition 4.3 (Unit group).** The set of units forms a group under multiplication, denoted `(Z/mZ)*`:

```
(Z/mZ)* = { [a]_m : gcd(a, m) = 1 }.
```

**Proposition 4.4.** `(Z/mZ)*` is an abelian group.

**Proof.** Closure: if `gcd(a, m) = gcd(b, m) = 1` then `gcd(ab, m) = 1` (a prime dividing `ab` and `m` would divide `a` or `b`, contradiction), so the product of units is a unit. Associativity and commutativity are inherited from the ring. Identity is `[1]_m`. Inverses exist by definition of unit, and the inverse of a unit is a unit (`[a]_m·[a⁻¹]_m = [1]_m` makes `[a⁻¹]_m` a unit too). ∎

This is the precise algebraic statement of the junior/middle claim: **`a` is invertible mod `m` exactly when `a` is coprime to `m`.** For composite `m`, the non-coprime elements are non-units — they have no inverse and cannot be divided by.

### 4.1 Worked Example: Units mod 12

`Z/12Z` has elements `{0, 1, …, 11}`. The units are those coprime to `12 = 2²·3`: `{1, 5, 7, 11}`. So `|(Z/12Z)*| = 4 = φ(12)`. Verify one inverse: `5·5 = 25 ≡ 1 (mod 12)`, so `5⁻¹ = 5`; also `7·7 = 49 ≡ 1` and `11·11 = 121 ≡ 1`, so every unit here is self-inverse — `(Z/12Z)* ≅ Z/2Z × Z/2Z` (the Klein four-group), not cyclic, which is why `12` has no primitive root. The non-units `{2, 3, 4, 6, 8, 9, 10}` (and `0`) have no inverse: `gcd(2, 12) = 2 ≠ 1`, and indeed no `x` satisfies `2x ≡ 1 (mod 12)` since `2x` is always even but `1` is odd. This single example shows units, totient, and the absence of a primitive root all at once.

---

## 5. Euler's Totient and the Order of the Unit Group

**Definition 5.1 (Euler's totient).** `φ(m)` is the number of integers in `{1, …, m}` coprime to `m`:

```
φ(m) = #{ a : 1 ≤ a ≤ m, gcd(a, m) = 1 }.
```

**Theorem 5.2 (Order of the unit group).** `|(Z/mZ)*| = φ(m)`.

**Proof.** By Theorem 4.2 the units are exactly the classes `[a]_m` with `gcd(a, m) = 1`, and there is one such class for each `a ∈ {1, …, m}` coprime to `m` (with `[m]_m = [0]_m` excluded since `gcd(m, m) = m > 1` for `m > 1`). Counting these gives `φ(m)`. ∎

**Proposition 5.3 (Multiplicativity and prime-power formula).** `φ` is multiplicative: `φ(ab) = φ(a)φ(b)` whenever `gcd(a, b) = 1`. For a prime power, `φ(p^k) = p^k − p^{k−1} = p^{k−1}(p − 1)`. Hence for `m = ∏ p_i^{e_i}`,

```
φ(m) = m · ∏_{p | m} (1 − 1/p).
```

**Proof sketch.** `φ(p^k)` counts `1..p^k` minus the multiples of `p` (there are `p^{k−1}` of them), giving `p^k − p^{k−1}`. Multiplicativity follows from the CRT isomorphism (Section 11): `(Z/abZ)* ≅ (Z/aZ)* × (Z/bZ)*` for coprime `a, b`, and orders multiply. ∎

**Sum-over-divisors identity.** A companion fact used in number-theoretic algorithms: `Σ_{d | m} φ(d) = m`. For example `m = 12`: `φ(1)+φ(2)+φ(3)+φ(4)+φ(6)+φ(12) = 1+1+2+2+2+4 = 12`. This follows from partitioning `{1, …, m}` by `gcd(·, m)`: the integers with `gcd(k, m) = m/d` are exactly the `φ(d)` values `(m/d)·j` with `gcd(j, d) = 1`. The identity underlies Möbius inversion and divisor-sum sieves (sibling `28-divisor-functions`), and is a useful cross-check when computing totients in bulk.

**Special case.** For a prime `p`, `φ(p) = p − 1`: every nonzero residue `1, …, p−1` is coprime to `p`. This is exactly why `Z/pZ` is a field (Section 8) — *all* `p − 1` nonzero elements are units.

### 5.1 Worked Totient Computations

| `m` | factorization | `φ(m)` via formula | check |
|-----|---------------|--------------------|-------|
| `7` | `7` (prime) | `7 − 1 = 6` | units `{1..6}`, count 6 |
| `9` | `3²` | `3² − 3¹ = 6` | units `{1,2,4,5,7,8}`, count 6 |
| `10` | `2·5` | `φ(2)·φ(5) = 1·4 = 4` | units `{1,3,7,9}`, count 4 |
| `12` | `2²·3` | `φ(4)·φ(3) = 2·2 = 4` | units `{1,5,7,11}`, count 4 |
| `36` | `2²·3²` | `φ(4)·φ(9) = 2·6 = 12` | (multiplicativity) |
| `1` | (empty product) | `1` | only the residue `0`, vacuously coprime |
| `2` | `2` (prime) | `1` | unit `{1}` |
| `100` | `2²·5²` | `φ(4)·φ(25) = 2·20 = 40` | `100·(1/2)(4/5) = 40` |

Each row uses multiplicativity (Proposition 5.3) on coprime prime-power factors. For `m = 36 = 4·9` with `gcd(4, 9) = 1`, `φ(36) = φ(4)·φ(9) = 2·6 = 12`, which also equals `36·(1 − 1/2)(1 − 1/3) = 36·(1/2)(2/3) = 12`. The two formulas — product over prime powers and the `m·∏(1 − 1/p)` form — always agree, and computing `φ` therefore reduces to factoring `m`.

---

## 6. Existence of Inverses: Bézout and Euler

Two constructive routes to the inverse, matching the two algorithms in `middle.md`.

**Theorem 6.1 (Bézout / extended Euclid inverse).** If `gcd(a, m) = 1`, the extended Euclidean algorithm produces integers `x, y` with `ax + my = 1`, and `[x]_m = [a]_m⁻¹`.

**Proof.** Immediate from Theorem 4.2's (⇐) direction: `ax ≡ 1 (mod m)`. The algorithm runs in `O(log min(a, m))` divisions. This works for **any** modulus, prime or composite, requiring only coprimality. ∎

**Theorem 6.2 (Euler inverse).** If `gcd(a, m) = 1`, then `a⁻¹ ≡ a^{φ(m) − 1} (mod m)`.

**Proof.** Euler's theorem (Theorem 7.2) gives `a^{φ(m)} ≡ 1 (mod m)`. Multiplying both sides by `a⁻¹`: `a^{φ(m)−1} ≡ a⁻¹ (mod m)`. ∎

The Euler route needs `φ(m)`, i.e. the factorization of `m`. For prime `m = p`, `φ(p) = p − 1` and this specializes to Fermat: `a⁻¹ ≡ a^{p−2} (mod p)` — the one-line inverse of `middle.md`.

**Proposition 6.3 (Uniqueness of the inverse).** If `[a]_m` is a unit, its inverse is **unique**.

**Proof.** Suppose `[b]_m` and `[c]_m` both satisfy `[a]_m·[b]_m = [a]_m·[c]_m = [1]_m`. Then `[b]_m = [b]_m·[1]_m = [b]_m·([a]_m·[c]_m) = ([b]_m·[a]_m)·[c]_m = [1]_m·[c]_m = [c]_m`, using associativity and commutativity. So the two candidate inverses coincide. ∎

This is why we may speak of *the* inverse `a⁻¹` and why the Bézout coefficient `x` (reduced to `[0, m)`) and the Euler power `a^{φ(m)−1}` necessarily give the *same* value when both apply: a unit has exactly one inverse, no matter how it is computed. It is a good test invariant — the two algorithms must agree.

### 6.1 Worked Bézout Inverse

Invert `a = 7` mod `m = 26` via extended Euclid. Run the gcd, tracking coefficients:

```
26 = 3·7 + 5
 7 = 1·5 + 2
 5 = 2·2 + 1
 2 = 2·1 + 0     → gcd = 1, so 7 is a unit mod 26
```

Back-substitute to express `1` as a combination of `7` and `26`:

```
1 = 5 − 2·2
  = 5 − 2·(7 − 5)        = 3·5 − 2·7
  = 3·(26 − 3·7) − 2·7   = 3·26 − 11·7
```

So `−11·7 + 3·26 = 1`, i.e. `7·(−11) ≡ 1 (mod 26)`. Normalizing `−11` to `[0, 26)`: `−11 + 26 = 15`. Check: `7·15 = 105 = 4·26 + 1 ≡ 1 (mod 26)`. The inverse is `15`. This works for the *composite* modulus `26` precisely because `gcd(7, 26) = 1`; Fermat would be invalid here, but Bézout/extended-Euclid is not.

---

## 7. Fermat's Little Theorem and Euler's Theorem

**Theorem 7.1 (Fermat's little theorem).** For a prime `p` and any `a` with `p ∤ a`,

```
a^{p−1} ≡ 1 (mod p).
```

**Theorem 7.2 (Euler's theorem, generalization).** For any `m` and any `a` with `gcd(a, m) = 1`,

```
a^{φ(m)} ≡ 1 (mod m).
```

**Proof of Theorem 7.2 (group-theoretic, Lagrange).** `(Z/mZ)*` is a finite abelian group of order `φ(m)` (Theorem 5.2). By Lagrange's theorem the order of any element divides the group order, so `[a]_m^{φ(m)} = [1]_m`, i.e. `a^{φ(m)} ≡ 1 (mod m)`. ∎

**Proof of Theorem 7.1.** Specialize Theorem 7.2 to `m = p` prime, where `φ(p) = p − 1`. ∎

**Alternative (orbit) proof of 7.2.** Multiplication by `a` permutes the units `{u₁, …, u_{φ(m)}}` (it is a bijection since `a` is a unit). Hence `∏ (a u_i) = ∏ u_i` in `(Z/mZ)*`, i.e. `a^{φ(m)} ∏ u_i ≡ ∏ u_i`. Cancelling the (unit) product `∏ u_i` gives `a^{φ(m)} ≡ 1`. ∎

**Worked orbit illustration (`m = 10`, `a = 3`).** The units are `{1, 3, 7, 9}` with product `1·3·7·9 = 189 ≡ 9 (mod 10)`. Multiply each by `a = 3`: `3·1=3, 3·3=9, 3·7=21≡1, 3·9=27≡7`, giving `{3, 9, 1, 7}` — the *same set*, just permuted (this is the bijection). Their product is `3·9·1·7 = 189 ≡ 9`, equal to the original product. But that product is also `3^4 · (1·3·7·9) = 3^4 · 9 (mod 10)`. Cancelling the unit `9` from both sides forces `3^4 ≡ 1 (mod 10)` — which we verified earlier (`81 ≡ 1`). The orbit proof is thus a concrete shuffle-and-cancel argument, and this `m = 10` instance shows every moving part: the permutation of units, the equal products, and the final cancellation that yields Euler's congruence.

These theorems are the entire basis for the **Fermat/Euler inverse**: an inverse is just a high power. Sibling `04-fermat-euler` develops both with additional applications (primality testing, the structure of the multiplicative group).

### 7.1 Worked Example: Euler vs Fermat Inverse

Take `m = 10`, `a = 3`. The units mod 10 are `{1, 3, 7, 9}`, so `φ(10) = 4` (matching `10·(1−1/2)·(1−1/5) = 10·(1/2)·(4/5) = 4`). Euler's theorem predicts `3^4 ≡ 1 (mod 10)`: indeed `3^4 = 81 ≡ 1`. The inverse is `3^{φ(10)−1} = 3^3 = 27 ≡ 7 (mod 10)`, and `3·7 = 21 ≡ 1` confirms it. Note `10` is composite, so **Fermat** (`a^{m−2} = 3^8 = 6561 ≡ 1 (mod 10)`) gives `1`, *not* the inverse — a concrete demonstration that Fermat's formula is invalid for composite moduli, while Euler's (using the true `φ(m)`) is correct.

Now a prime case: `m = 7`, `a = 3`. Here `φ(7) = 6`, and both formulas coincide: `3^{7−2} = 3^5 = 243 ≡ 5 (mod 7)`, and `3·5 = 15 ≡ 1`. So the inverse of `3` mod `7` is `5`. The lesson: Euler is the general theorem; Fermat is its prime specialization, and only the prime case lets you blindly use `a^{m−2}`.

### 7.2 The Order of an Element

**Definition 7.3 (Multiplicative order).** For `gcd(a, m) = 1`, the **order** `ord_m(a)` is the least positive `d` with `a^d ≡ 1 (mod m)`.

**Proposition 7.4.** `ord_m(a)` divides `φ(m)`; and `a^k ≡ 1 (mod m)` iff `ord_m(a) | k`.

**Proof.** The powers `a^0, a^1, a^2, …` form a cyclic subgroup of `(Z/mZ)*` of size `ord_m(a)`. By Lagrange, the subgroup order divides the group order `φ(m)`. For the second claim, write `k = q·ord_m(a) + r` with `0 ≤ r < ord_m(a)`; then `a^k = (a^{ord})^q · a^r ≡ a^r`, which is `1` iff `r = 0`, i.e. iff `ord_m(a) | k`. ∎

This refines Euler's theorem: `φ(m)` is *an* exponent killing `a`, but `ord_m(a)` is the *smallest*. When `ord_m(a) = φ(m)`, `a` is a **primitive root** (generator) — guaranteed to exist when `m` is prime (Corollary 8.3) but not for every modulus. Orders are the bridge to discrete logarithms (sibling `11-discrete-log-bsgs`).

**Worked order computation.** Mod `7`, with `φ(7) = 6`: compute `ord_7(2)`. Powers: `2^1 = 2, 2^2 = 4, 2^3 = 8 ≡ 1`. So `ord_7(2) = 3`, which divides `6` (Proposition 7.4). Hence `2` is *not* a primitive root mod `7`. Try `3`: `3^1 = 3, 3^2 = 2, 3^3 = 6, 3^4 = 4, 3^5 = 5, 3^6 = 1` — all six nonzero residues appear before returning to `1`, so `ord_7(3) = 6 = φ(7)` and `3` *is* a primitive root. The possible orders are exactly the divisors of `6`: `{1, 2, 3, 6}`, and one checks `ord_7(1) = 1`, `ord_7(6) = 2` (`6 ≡ −1`, `(−1)² = 1`), `ord_7(2) = ord_7(4) = 3`, `ord_7(3) = ord_7(5) = 6`. The count of elements of each order matches the field-theoretic prediction (the number of primitive roots is `φ(φ(7)) = φ(6) = 2`, namely `3` and `5`).

**Exponent reduction via order.** A practical corollary: in `a^e (mod m)` with `gcd(a, m) = 1`, the exponent may be reduced mod `ord_m(a)` (or, more cheaply, mod `φ(m)`): `a^e ≡ a^{e mod φ(m)} (mod m)`. This is how a `10^18`-sized exponent in a Fermat/Euler inverse or a tower-of-powers problem is brought down to something small *before* the modpow. (When `gcd(a, m) ≠ 1`, the correct reduction uses the **Carmichael lifting / λ-exponent** and a `+φ(m)` correction — out of scope here, but flagged so the naive reduction is not misapplied to non-coprime bases.)

---

## 8. The Field `Z/pZ` (Prime Modulus)

**Definition 8.1 (Field).** A commutative ring with `1 ≠ 0` is a **field** iff every nonzero element is a unit (has a multiplicative inverse).

**Theorem 8.2 (`Z/mZ` is a field iff `m` is prime).** `Z/mZ` is a field if and only if `m` is prime.

**Proof.** *(⇐)* Let `m = p` be prime. For any `[a]_p ≠ [0]_p`, we have `1 ≤ a ≤ p−1`, so `gcd(a, p) = 1` (the only divisors of `p` are `1` and `p`, and `p ∤ a`). By Theorem 4.2, `[a]_p` is a unit. Every nonzero element is invertible, so `Z/pZ` is a field.

*(⇒)* Suppose `m` is composite, `m = a·b` with `1 < a, b < m`. Then `[a]_m ≠ [0]_m` but `gcd(a, m) = a > 1`, so `[a]_m` is **not** a unit (Theorem 4.2). A nonzero non-unit exists, so `Z/mZ` is not a field. (Equivalently, `[a]_m·[b]_m = [m]_m = [0]_m` exhibits a zero divisor, which a field cannot have.) ∎

**Consequence.** In `Z/pZ` you may add, subtract, multiply, and divide by any nonzero element — it behaves like the rationals with `p` elements. This is the structural reason competitive-programming moduli are prime: division (modular inverse) is total on nonzero elements, and algorithms like Gaussian elimination, polynomial interpolation, and `nCr mod p` go through without invertibility hazards.

**Corollary 8.3 (`(Z/pZ)*` is cyclic).** The multiplicative group of a finite field is cyclic of order `p − 1`; it has a **primitive root** (generator). This underlies discrete logarithms and NTT (siblings `11-discrete-log-bsgs`, `12-primitive-root-discrete-root`, `13-ntt`). (Stated here; proof in sibling `12`.)

### 8.1 Worked Example: the Field `Z/5Z`

Its nonzero elements `{1, 2, 3, 4}` form `(Z/5Z)*`, a cyclic group of order `4`. Inverses: `1⁻¹ = 1`, `2⁻¹ = 3` (`2·3 = 6 ≡ 1`), `3⁻¹ = 2`, `4⁻¹ = 4` (`4·4 = 16 ≡ 1`). Every nonzero element has an inverse — the defining property of a field. The element `2` is a primitive root: its powers `2^1=2, 2^2=4, 2^3=3, 2^4=1` cycle through *all* of `{1,2,3,4}`, so `ord_5(2) = 4 = φ(5)`. By contrast `4` has order `2` (`4^2 ≡ 1`), so it is not a primitive root. This concrete field is the smallest non-trivial illustration of why prime moduli give total division and cyclic structure.

### 8.2 Why Polynomials over `Z/pZ` Behave Well

Because `Z/pZ` is a field, a nonzero polynomial of degree `d` over `Z/pZ` has **at most `d` roots** (the factor theorem holds in any field). This is false over a composite-modulus ring: `x² − 1` has *four* roots mod `8` (`1, 3, 5, 7`) because `Z/8Z` is not a field. The "at most `d` roots" property is what makes Lagrange interpolation, polynomial factorization, and NTT (sibling `13-ntt`) correct over a prime modulus — another structural payoff of primality that composite moduli forfeit.

### 8.3 Worked Example: `nCr mod p` Lives in a Field

Compute `C(6, 2) mod 7` purely with field operations. `C(6, 2) = 6!/(2!·4!) = 15`, and `15 mod 7 = 1`. The field route never divides integers: `fact[6] = 720 ≡ 720 − 102·7 = 720 − 714 = 6 (mod 7)`; `fact[2] = 2`, `fact[4] = 24 ≡ 3 (mod 7)`. Inverses (all exist because `7` is prime, so every nonzero residue is a unit): `inv(2) = 4` (`2·4 = 8 ≡ 1`), `inv(3) = 5` (`3·5 = 15 ≡ 1`). Then

```
C(6,2) ≡ fact[6] · inv(fact[2]) · inv(fact[4])
       = 6 · 4 · 5 = 120 ≡ 120 − 17·7 = 120 − 119 = 1 (mod 7).
```

This matches `15 mod 7 = 1`. The computation *requires* that `2!` and `4!` be invertible — guaranteed because `Z/7Z` is a field. Over a composite modulus this can fail: `C(p, k) mod p` for the prime `p` itself has `fact[p] ≡ 0` and the factorial inverses break, which is exactly the regime where Lucas' theorem (sibling `21-binomial-coefficients`) or prime-power decomposition (Section 11) must take over. The worked numbers make concrete why "prime modulus + field" is the comfortable setting for combinatorics mod `p`.

---

## 9. Wilson's Theorem

A characterization of primality through a modular factorial identity.

**Theorem 9.1 (Wilson).** An integer `p > 1` is prime if and only if

```
(p − 1)! ≡ −1 (mod p).
```

**Proof.** *(⇒, `p` prime).* Work in the field `Z/pZ`. In the product `(p−1)! = 1·2⋯(p−1)`, pair each unit with its inverse. An element is its own inverse iff `a² ≡ 1`, i.e. `(a−1)(a+1) ≡ 0`; since `Z/pZ` is a field with no zero divisors, this forces `a ≡ 1` or `a ≡ −1 ≡ p−1`. All other elements pair off into inverse pairs whose product is `1`. Hence `(p−1)! ≡ 1 · (p−1) · 1 = p − 1 ≡ −1 (mod p)`.

*(⇐, converse).* Suppose `n > 1` is composite. If `n = 4`, check directly: `3! = 6 ≡ 2 ≢ −1 (mod 4)`. Otherwise `n` has a factor `d` with `1 < d < n`, and `d` appears among `1, …, n−1`, so `d | (n−1)!`. Then `(n−1)! ≡ 0 (mod d)`, which cannot be `≡ −1 (mod n)` (that would force `d | (n−1)! + 1` and `d | (n−1)!`, hence `d | 1`). So `(n−1)! ≢ −1 (mod n)`. ∎

**Note.** Wilson's theorem is a clean *characterization* of primes but not a *practical* primality test — computing `(p−1)! mod p` is `O(p)` multiplications, far slower than Miller-Rabin (sibling `08-miller-rabin-primality`). Its theoretical value is in proofs and in formulas for inverse factorials and the prime-counting context. It also gives the inverse-factorial corner case: in `Z/pZ`, `(p−1)!⁻¹ ≡ −1` as well.

### 9.1 Worked Wilson Pairing

Take `p = 7`. The inverse pairs among `{1, …, 6}`: `1` and `6 = −1` are self-inverse; `2·4 = 8 ≡ 1` so `{2, 4}` pair; `3·5 = 15 ≡ 1` so `{3, 5}` pair. Therefore

```
6! = 1·2·3·4·5·6 = 1 · (2·4) · (3·5) · 6 ≡ 1·1·1·6 = 6 ≡ −1 (mod 7).
```

The product collapses because each interior pair multiplies to `1`, leaving only the two self-inverse elements `1` and `6 ≡ −1`. This is the constructive heart of the proof: in a field, multiplication pairs every element with its distinct inverse, and the only survivors are the square roots of `1`. For the composite `n = 6`: `5! = 120 ≡ 0 (mod 6)` (since `6 | 120`), which is `≢ −1`, confirming `6` is not prime via the converse.

---

## 10. Zero Divisors and Cancellation in Composite Moduli

The failures that make composite moduli treacherous, stated precisely.

**Definition 10.1 (Zero divisor).** A nonzero `[a]_m` is a **zero divisor** if there exists a nonzero `[b]_m` with `[a]_m·[b]_m = [0]_m`.

**Proposition 10.2.** `[a]_m` (nonzero) is a zero divisor iff `gcd(a, m) > 1`, i.e. iff it is a non-unit. Thus for composite `m`, every nonzero non-unit is a zero divisor; for prime `m`, there are none.

**Proof.** If `d = gcd(a, m) > 1`, set `b = m/d`; then `0 < b < m` and `a·b = a·(m/d) = (a/d)·m ≡ 0 (mod m)`, so `[b]_m ≠ [0]_m` witnesses a zero divisor. Conversely, if `[a]_m` is a unit, `a·b ≡ 0` implies `b ≡ a⁻¹·0 ≡ 0`, so a unit is never a zero divisor; hence zero divisors are exactly the non-units. ∎

**Theorem 10.3 (Cancellation law).** `a·b ≡ a·c (mod m)` implies `b ≡ c (mod m)` **iff** `gcd(a, m) = 1`. In general, `a·b ≡ a·c (mod m)` implies `b ≡ c (mod m/gcd(a, m))`.

**Proof.** `a·b ≡ a·c` means `m | a(b − c)`. Let `d = gcd(a, m)`, `m = d·m'`, `a = d·a'` with `gcd(a', m') = 1`. Then `d m' | d a'(b − c)`, i.e. `m' | a'(b − c)`, and since `gcd(a', m') = 1`, `m' | (b − c)`, i.e. `b ≡ c (mod m')`. When `d = 1`, `m' = m` and we recover full cancellation; when `d > 1`, the modulus shrinks. ∎

**Consequence for algorithms.** Cancellation failure is why you cannot naively "divide both sides" in composite-modulus equations, why `nCr mod m` for composite `m` needs prime-power decomposition, and why a Gaussian-elimination pivot mod `m` must be a unit. These are the algebraic roots of the senior-level composite-modulus pitfalls.

### 10.1 Worked Example: Cancellation Failure

Mod `12`, consider `4·2 ≡ 4·5 (mod 12)`: indeed `8 ≡ 20 ≡ 8`. Naively cancelling the `4` would give `2 ≡ 5 (mod 12)`, which is **false**. The reason: `gcd(4, 12) = 4 ≠ 1`, so `4` is not a unit and cancellation is forbidden. Theorem 10.3 tells us exactly what survives: we may cancel `4` only modulo `12 / gcd(4,12) = 12/4 = 3`, giving the *correct* weaker statement `2 ≡ 5 (mod 3)` (both are `2 mod 3`). This is the precise reason a Gaussian-elimination pivot must be a unit — dividing a row by a non-unit pivot would silently produce false equations.

### 10.2 Solvability of Linear Congruences

**Theorem 10.4 (Linear congruence solvability).** The congruence `a·x ≡ b (mod m)` has a solution iff `g := gcd(a, m)` divides `b`. When it does, there are exactly `g` solutions modulo `m`, forming one residue class modulo `m/g`.

**Proof.** `a·x ≡ b (mod m)` means `a·x − m·y = b` for some integer `y`. By the theory of linear Diophantine equations (sibling `07-linear-diophantine`), this has integer solutions iff `g | b`. Given one solution `x₀`, the general solution is `x₀ + (m/g)·t`; reducing mod `m`, the values `x₀, x₀ + m/g, …, x₀ + (g−1)m/g` are the `g` distinct solutions. ∎

This generalizes "inverse exists iff coprime": when `b = 1`, solvability requires `g | 1`, i.e. `g = 1`, recovering Theorem 4.2, and then there is exactly one solution — the inverse. For `g > 1` and `g | b`, division mod `m` is *multivalued*, which is exactly why "division" is only well-defined through units.

**Worked solver.** Solve `6x ≡ 9 (mod 15)`. Here `g = gcd(6, 15) = 3`, and `3 | 9`, so solutions exist — exactly `g = 3` of them mod `15`. Divide through by `3`: `2x ≡ 3 (mod 5)`. Now `gcd(2, 5) = 1`, so invert `2`: `inv(2) = 3 (mod 5)` (`2·3 = 6 ≡ 1`), giving `x ≡ 3·3 = 9 ≡ 4 (mod 5)`. The three solutions mod `15` are `4, 4+5, 4+10 = {4, 9, 14}`. Check `6·4 = 24 ≡ 9 (mod 15)` ✓, `6·9 = 54 ≡ 9` ✓, `6·14 = 84 ≡ 9` ✓. This is the algorithm of Task 10 in `tasks.md`, and it makes Theorem 10.4 concrete: reduce by `g`, invert in the smaller coprime modulus, then fan out the `g` solutions.

By contrast, `6x ≡ 7 (mod 15)` has **no** solution: `g = 3` does not divide `7`. There is literally no `x`, because `6x` is always a multiple of `3` mod `15` while `7` is not — the solvability condition `g | b` is not a technicality but a hard obstruction.

---

## 11. The Chinese Remainder Theorem (Structural View)

**Theorem 11.1 (CRT, ring-isomorphism form).** If `m = m₁ m₂ ⋯ m_k` with the `m_i` pairwise coprime, then the map

```
Z/mZ  →  Z/m₁Z × Z/m₂Z × ⋯ × Z/m_kZ,     [x]_m ↦ ([x]_{m₁}, …, [x]_{m_k})
```

is a **ring isomorphism**.

**Proof.** The map is a well-defined ring homomorphism (reduction is a homomorphism in each coordinate). It is injective: if `x ≡ 0 (mod m_i)` for all `i`, then each `m_i | x`, and since the `m_i` are pairwise coprime, their product `m | x`, so `[x]_m = [0]_m`. Both sides have the same finite cardinality `m = ∏ m_i`, so an injective map between equal finite sets is a bijection, hence an isomorphism. ∎

**Corollary 11.2 (Unit groups multiply).** Restricting to units, `(Z/mZ)* ≅ (Z/m₁Z)* × ⋯ × (Z/m_kZ)*`, which gives multiplicativity of `φ` (Proposition 5.3): `φ(m) = ∏ φ(m_i)`.

**Algorithmic content.** The isomorphism means modular arithmetic mod a composite `m` can be performed **independently** in each coprime component and recombined — the basis for the CRT decomposition in `senior.md`, for multi-prime exact recovery, and for speeding up RSA (working mod `p` and mod `q` separately is ~4× faster than mod `pq`). The explicit reconstruction (inverse of the isomorphism) and Garner's incremental form are developed in siblings `05-crt` and `15-garner-algorithm`.

### 11.1 Worked CRT Isomorphism

Take `m = 6 = 2·3` (coprime factors). The isomorphism `Z/6Z ≅ Z/2Z × Z/3Z` maps each residue to its pair of remainders:

```
0 ↦ (0,0)   1 ↦ (1,1)   2 ↦ (0,2)   3 ↦ (1,0)   4 ↦ (0,1)   5 ↦ (1,2)
```

This pairing is a bijection (each of the `2·3 = 6` pairs appears exactly once), and arithmetic agrees coordinate-wise: `5·5 = 25 ≡ 1 (mod 6)` matches `(1,2)·(1,2) = (1·1, 2·2) = (1, 4 mod 3) = (1, 1)`, which maps back to `1`. So you can multiply in `Z/2Z` and `Z/3Z` separately and recombine. The reverse map (reconstruction) is exactly what the explicit CRT formula computes: find `x` with `x ≡ r₁ (mod 2)`, `x ≡ r₂ (mod 3)`.

**Why coprimality is essential.** If the factors share a divisor — say splitting mod `12` into mod `4` and mod `6` (which share `2`) — the map is no longer injective, distinct residues collide, and the reconstruction can be inconsistent. The general (non-coprime) CRT has a solution only when the congruences agree on the gcd of the moduli; pairwise coprimality is what guarantees a *unique* solution for every input, i.e. a true isomorphism.

**Worked reconstruction.** Solve `x ≡ 2 (mod 3)`, `x ≡ 3 (mod 5)`. The product is `M = 15`. For component `3`: `M₁ = 15/3 = 5`, and `inv(5 mod 3) = inv(2) = 2 (mod 3)` since `2·2 = 4 ≡ 1`; contribution `2·5·2 = 20`. For component `5`: `M₂ = 15/5 = 3`, and `inv(3 mod 5) = inv(3) = 2 (mod 5)` since `3·2 = 6 ≡ 1`; contribution `3·3·2 = 18`. Sum mod `15`: `(20 + 18) mod 15 = 38 mod 15 = 8`. Check: `8 ≡ 2 (mod 3)` ✓ and `8 ≡ 3 (mod 5)` ✓. The reconstruction inverts the isomorphism of Theorem 11.1, and each step uses a modular inverse — which exists precisely because the moduli are coprime (Theorem 4.2 applied to `M_i` mod `m_i`).

### 11.2 RSA as a CRT Application

RSA encryption raises a message to a secret exponent mod `n = pq`. Decryption mod `n` costs roughly `O((log n)³)`. By CRT, one instead computes `m_p = c^{d mod (p−1)} (mod p)` and `m_q = c^{d mod (q−1)} (mod q)` — two exponentiations on operands half the bit-length — then CRT-recombines. Since modular exponentiation is roughly cubic in operand size, two half-size exponentiations cost about `2·(1/2)³ = 1/4` of the full one. The exponent reduction `d mod (p−1)` is justified by Fermat (Theorem 7.1): `c^{p−1} ≡ 1 (mod p)`, so only `d mod (p−1)` matters in the exponent. This is the single most important practical use of the CRT isomorphism.

---

## 11c. Worked Fermat Inverse via Modpow

To see Theorem 7.1 turn into an algorithm, compute `inv(3) mod 7 = 3^{7−2} = 3^5 mod 7` by square-and-multiply. Write `5 = 101₂`:

```
3^1 mod 7 = 3
3^2 mod 7 = 9 mod 7 = 2          (square)
3^4 mod 7 = 2^2 mod 7 = 4        (square)
bits of 5 (low→high): 1, 0, 1
  bit0 = 1 → result = 3^1 = 3
  bit1 = 0 → skip
  bit2 = 1 → result = 3 · 3^4 = 3 · 4 = 12 ≡ 5 (mod 7)
```

So `3^5 ≡ 5 (mod 7)`, and `3·5 = 15 ≡ 1 (mod 7)` confirms `inv(3) = 5`. The exponentiation took 2 squarings and 2 multiplies — `O(log p)` work — exactly the cost claimed for the Fermat inverse. The same trace, run with a `10^9`-sized prime, computes a competitive-programming inverse in ~30 multiplications. This is the bridge from the *theorem* `a^{p−1} ≡ 1` to the *one-line routine* `inv(a) = powMod(a, p−2, p)`: the theorem guarantees `a^{p−2}` is the inverse, and binary exponentiation makes evaluating it cheap.

**Why `a ≢ 0` is required.** Fermat assumes `p ∤ a`. If `a ≡ 0 (mod p)`, then `a^{p−2} ≡ 0`, and `0` is never a unit (`0·x = 0 ≠ 1` for any `x`). The routine must guard `a % p != 0` before inverting — the algorithmic shadow of the theorem's hypothesis.

### 11c.1 Inverse Table mod 7 (every method agrees)

Because `Z/7Z` is a field, all six nonzero elements have inverses, and Bézout, Euler/Fermat, and brute search all produce the same unique value (Proposition 6.3):

| `a` | `a⁻¹` | check `a·a⁻¹` | Fermat `a^5 mod 7` |
|-----|-------|---------------|--------------------|
| `1` | `1` | `1` | `1` |
| `2` | `4` | `8 ≡ 1` | `32 ≡ 4` |
| `3` | `5` | `15 ≡ 1` | `243 ≡ 5` |
| `4` | `2` | `8 ≡ 1` | `1024 ≡ 2` |
| `5` | `3` | `15 ≡ 1` | `3125 ≡ 3` |
| `6` | `6` | `36 ≡ 1` | `7776 ≡ 6` |

Every row's Fermat column `a^{7−2} = a^5` reproduces the inverse, confirming the theorem operationally across the whole field. The self-inverse elements are `1` and `6 ≡ −1` (the only square roots of `1` in a field, as Wilson's proof used), while the rest pair up `{2,4}` and `{3,5}`. A practitioner can keep such a small table as a unit test: any modular-inverse implementation, on any of these inputs, must reproduce this column exactly — a fast, decisive correctness check.

---

## 11b. From Theorems to Algorithms: The Foundations Map

Every algorithm in this topic traces directly to a theorem above. The mapping is worth making explicit, because it shows the foundations are not decorative — each is the *correctness proof* of a routine you will write.

| Algorithm / routine | Foundational theorem | Why it is correct |
|---------------------|----------------------|-------------------|
| `(a·b) mod m = ((a%m)·(b%m))%m` | Theorem 3.1(3) (compatibility) | reducing operands preserves the residue class |
| Negative fix `((x%m)+m)%m` | Definition 1.3 (representatives) | changes the chosen representative, never the class |
| Fermat inverse `a^{p−2}` | Theorem 7.1 (Fermat) | `a·a^{p−2} = a^{p−1} ≡ 1` |
| Euler inverse `a^{φ(m)−1}` | Theorem 7.2 (Euler) + 5.2 | `a·a^{φ(m)−1} = a^{φ(m)} ≡ 1` |
| Extended-Euclid inverse | Theorem 6.1 (Bézout) | `ax + my = 1 ⟹ ax ≡ 1` |
| `nCr mod p` via inverse factorials | Theorem 8.2 (field) | `r!`, `(n−r)!` are units (nonzero in a field) |
| Linear congruence solver | Theorem 10.4 (solvability) | solution exists iff `gcd(a,m) | b` |
| CRT decomposition / multi-prime | Theorem 11.1 (isomorphism) | independent component arithmetic |
| Modpow `a^b mod m` | Proposition 5.3 / orders (7.4) | exponents may reduce mod `ord_m(a)` |

**The unifying principle.** Three structural facts drive everything: (1) **compatibility** (Theorem 3.1) licenses reduce-anytime, so machine integers stay bounded; (2) **unit ⟺ coprime** (Theorem 4.2) decides when division is possible and which algorithm computes the inverse; (3) **prime ⟺ field** (Theorem 8.2) decides whether *every* nonzero division works (prime) or only coprime ones (composite). A practitioner who internalizes just these three can derive the correct routine — and predict its failure mode — for any modular task without memorizing recipes.

**Failure modes are theorem violations.** Every silent modular bug from `senior.md` is a foundational hypothesis being violated: using Fermat on composite `m` violates the prime hypothesis of Theorem 7.1; inverting a non-unit violates the coprimality hypothesis of Theorem 4.2; combining non-coprime moduli with CRT violates the pairwise-coprime hypothesis of Theorem 11.1. The proofs above are therefore not abstract luxuries — they are exactly the preconditions your code must check.

---

## 12. Summary

- **Congruence** `a ≡ b (mod m)` (`m | (a−b)`) is an equivalence relation partitioning `Z` into `m` **residue classes**; their set `Z/mZ` is a commutative ring under representative-wise `+`, `−`, `·`.
- **Well-definedness** (Theorem 3.1): congruence is compatible with `+`, `−`, `·`, which is exactly the "reduce mod `m` anytime" license. Subtraction's negative-mod idiom changes the representative, never the class.
- **Units = coprime elements** (Theorem 4.2): `[a]_m` is invertible iff `gcd(a, m) = 1`; the units form the abelian group `(Z/mZ)*` of order `φ(m)` (Theorem 5.2).
- **Inverses** come from Bézout/extended-Euclid (any coprime `m`) or from Euler `a^{φ(m)−1}` (needs `φ(m)`), specializing to Fermat `a^{p−2}` for prime `p`.
- **Fermat/Euler** (`a^{φ(m)} ≡ 1`) follow from Lagrange's theorem on the finite group `(Z/mZ)*`; they are the algebraic basis of the modpow inverse.
- **`Z/mZ` is a field iff `m` is prime** (Theorem 8.2): for prime `p` every nonzero element is a unit, so division is total — the reason prime moduli are so well-behaved. `(Z/pZ)*` is moreover cyclic (primitive roots).
- **Wilson's theorem** (`(p−1)! ≡ −1 (mod p)`) characterizes primality via a modular factorial identity, proved by inverse-pairing in the field.
- **Composite moduli** carry **zero divisors** (Proposition 10.2) and only conditional **cancellation** (Theorem 10.3): the precise algebraic reason Fermat fails, non-units cannot be divided, and `nCr mod m` needs decomposition.
- **CRT** (Theorem 11.1) is a ring isomorphism splitting a composite modulus into coprime components, enabling independent computation, exact multi-prime recovery, and the multiplicativity of `φ`.

### Foundations cheat table

| Fact | Statement | Condition |
|------|-----------|-----------|
| Compatibility | reduce mod `m` anytime | always |
| Unit ⟺ coprime | `[a]` invertible ⟺ `gcd(a,m)=1` | always |
| `|(Z/mZ)*| = φ(m)` | unit-group order | always |
| Euler | `a^{φ(m)} ≡ 1` | `gcd(a,m)=1` |
| Fermat | `a^{p−1} ≡ 1` | `p` prime, `p ∤ a` |
| Field | every nonzero invertible | `m` prime |
| Wilson | `(p−1)! ≡ −1` | `m` prime ⟺ |
| Zero divisor | nonzero `a·b ≡ 0` exists | `m` composite |
| CRT | `Z/mZ ≅ ∏ Z/m_iZ` | `m_i` pairwise coprime |
| Order divides totient | `ord_m(a) | φ(m)` | `gcd(a,m)=1` |
| Linear congruence | `ax ≡ b` solvable ⟺ `gcd(a,m) | b` | always |

### Closing Notes

- **The quotient construction** (Section 1.1) is the organizing abstraction: `Z/mZ = Z/mZ` is the quotient by the ideal `mZ`, the reduction map `π` is a ring homomorphism, and `mZ` is maximal exactly when `m` is prime — which is *why* the prime quotient is a field. Everything else is a consequence.
- **Compatibility** (Section 3) is the single fact that makes modular *programming* possible: you may reduce at any point, so values never escape `[0, m)`. The negative-mod idiom is a representative choice, not a change of value.
- **The unit group** `(Z/mZ)*` of order `φ(m)` (Sections 4-5) governs invertibility; Lagrange's theorem on this finite group *is* Euler's theorem, and Fermat is its prime case. Orders (Section 7.2) refine this and lead to discrete logs.
- **The prime/composite dichotomy** (Sections 8, 10) is the practical fault line: prime moduli give a field (total division, ≤ `d` polynomial roots, cyclic group, Wilson), composite moduli give zero divisors and only conditional cancellation. Choose primes when you can.
- **CRT** (Section 11) splits composite moduli into well-behaved coprime components, the basis for both RSA's speedup and multi-prime exact recovery.
- **Foundations are preconditions** (Section 11b): every silent bug is a violated hypothesis. The proofs tell you precisely what to check before trusting a routine.

For a learner, the most leveraged takeaway is the three-fact core — *compatibility, unit ⟺ coprime, prime ⟺ field* — from which every algorithm and every failure mode in this topic can be re-derived on demand, rather than memorized as isolated recipes.

### Theorem dependency graph

The logical structure of this document, for revision:

- **Theorem 3.1 (compatibility)** ← definitions only; everything computational rests on it.
- **Theorem 4.2 (unit ⟺ coprime)** ← Bézout; underlies inverses, division, pivots.
- **Theorem 5.2 (`|(Z/mZ)*| = φ(m)`)** ← Theorem 4.2 + counting.
- **Theorem 7.2 (Euler)** ← Lagrange on the group of Theorem 5.2; **Theorem 7.1 (Fermat)** is its prime case.
- **Theorem 6.1/6.2 (inverses)** ← Bézout / Euler; **Proposition 6.3 (uniqueness)** ← ring axioms.
- **Theorem 8.2 (field ⟺ prime)** ← Theorem 4.2; gives polynomials-with-≤d-roots and Wilson (Theorem 9.1).
- **Theorem 10.3/10.4 (cancellation, solvability)** ← gcd structure; explains composite-modulus failures.
- **Theorem 11.1 (CRT isomorphism)** ← pairwise coprimality; gives `φ` multiplicativity and the RSA speedup.

Each arrow is a *hypothesis* that becomes a runtime check in code. Tracing these dependencies, rather than memorizing the theorems in isolation, is the fastest route to fluency with modular arithmetic.

The applied siblings then build directly on this base: fast exponentiation (`26`) evaluates the powers Euler/Fermat demand, the extended Euclidean algorithm (`06`) realizes Bézout, CRT (`05`) and Garner (`15`) realize Theorem 11.1, and Montgomery/Barrett (`14`) accelerate the reductions that Theorem 3.1 licenses.

Foundational references: Hardy & Wright, *An Introduction to the Theory of Numbers* (congruences, Fermat/Euler, Wilson); Ireland & Rosen, *A Classical Introduction to Modern Number Theory* (`Z/mZ` structure, units, CRT); Dummit & Foote, *Abstract Algebra* (rings, fields, group-theoretic proofs); Niven, Zuckerman & Montgomery, *An Introduction to the Theory of Numbers* (orders, primitive roots). Sibling topics: `04-fermat-euler`, `05-crt`, `06-extended-euclidean-modular-inverse`, `07-linear-diophantine`, `12-primitive-root-discrete-root`, `08-miller-rabin-primality`, `21-binomial-coefficients`, `26-binary-exponentiation`, and `28-divisor-functions`.
