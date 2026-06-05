# Miller-Rabin Primality Testing — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Square-Root-of-1 Lemma
3. Fermat's Little Theorem and Why Fermat Fails (Carmichael Numbers)
4. The Miller-Rabin Characterization of Primes
5. Why Miller-Rabin Catches Composites
6. The ≤ 1/4 Error Bound (At Least 3/4 of Bases Are Witnesses)
7. Deterministic Witness-Set Validity (Pomerance / Jaeschke / Sorenson Bounds)
8. Complexity Analysis O(k log³ n)
9. Relation to Other Tests (Solovay-Strassen, AKS, BPSW)
10. The Lucas Test and BPSW Foundations
11. Summary

---

## 1. Formal Definitions

Let `n > 1` be an odd integer (even `n` are trivially handled). Work in the ring `ℤ_n = ℤ/nℤ` and its unit group `(ℤ_n)^× = {a : gcd(a, n) = 1}`.

**Definition 1.1 (Prime, composite).** `n` is **prime** if its only positive divisors are `1` and `n`; otherwise `n > 1` is **composite**. Equivalently, `n` is prime iff `ℤ_n` is a field.

**Definition 1.2 (`n - 1 = d · 2^s`).** For odd `n > 1`, write `n - 1 = d · 2^s` with `d` **odd** and `s ≥ 1`. Here `s = ν₂(n-1)` is the 2-adic valuation (number of trailing zero bits) and `d = (n-1)/2^s`.

**Definition 1.3 (Strong probable prime).** `n` is a **strong probable prime to base `a`** (`gcd(a,n)=1`) if either
```
a^d ≡ 1 (mod n),   or   a^(d·2^r) ≡ -1 (mod n)  for some 0 ≤ r < s.
```

**Definition 1.4 (Witness, liar).** If `n` is **not** a strong probable prime to base `a`, then `a` is a **(Miller-Rabin) witness** for the compositeness of `n`. If `n` is composite but *is* a strong probable prime to base `a`, then `a` is a **strong liar** for `n`, and `n` is a **strong pseudoprime** to base `a` (sprp). 

**Definition 1.5 (Nontrivial square root of 1).** An element `x ∈ ℤ_n` with `x² ≡ 1 (mod n)` and `x ≢ ±1 (mod n)`.

**Notation.** Throughout, `n` is the number tested, `p` a prime, `k` the number of bases, `a` a base, `d, s` as in Def. 1.2, `φ` Euler's totient, `λ` the Carmichael function, `ω(n)` the number of distinct prime factors of `n`, and `(a/n)` the Jacobi symbol. "Witness" always certifies compositeness; "liar" always fails to. The chain values are written `x_r = a^{d·2^r} (mod n)` for `0 ≤ r ≤ s`, so `x_0 = a^d` and `x_s = a^{n-1}`.

**Standing assumptions.** Unless stated, `n` is odd and `> 9` (the `1/4` bound of Theorem 6.1 needs `n > 9`; smaller `n` are handled by direct lookup or trial division). Bases `a` are taken in `[2, n-2]` and coprime to `n` (a base sharing a factor with `n` is a trivial witness via `gcd(a,n) > 1`, caught by the small-prime sieve in practice). All congruences are modulo `n` unless another modulus is named.

**Remark.** The crux of the whole topic is Def. 1.3 versus Fermat's `a^(n-1) ≡ 1`: the strong condition factors the Fermat exponent through the squaring chain and demands the *first* appearance of `1` be preceded by `-1`. Sections 2-5 show this strong condition holds for *all* bases when `n` is prime, but for *at most a quarter* of bases when `n` is composite.

**Why oddness is assumed.** Even `n > 2` are composite and detected by the small-prime sieve before any modular exponentiation, so the theory restricts to odd `n`, for which `n - 1` is even and the decomposition `n - 1 = d·2^s` always has `s ≥ 1`. This guarantees the squaring chain has at least one term to inspect — the structural reason the test is stated for odd `n`.

### 1.1 The Chain of Definitions, Diagrammed

The logical dependency among the definitions is:

```
Def 1.2 (n-1 = d·2^s)
        │  factors the Fermat exponent
        ▼
Def 1.3 (strong probable prime)  ── negation ──▶  Def 1.4 (witness / liar)
        │                                              │
        │ relies on                                    │ certifies
        ▼                                              ▼
Lemma 2.1 (±1 are the only roots)              compositeness (Thm 4.2)
        │ fails for composites
        ▼
Def 1.5 (nontrivial square root of 1)  ── exists ⇒  n composite (Cor 2.3)
```

Reading top to bottom: the decomposition enables the strong condition; the strong condition's negation is a witness; the witness is sound because Lemma 2.1 forbids nontrivial roots modulo a prime, so finding one (Def 1.5) certifies compositeness. Every later theorem hangs off this skeleton.

---

## 2. The Square-Root-of-1 Lemma

**Lemma 2.1.** If `p` is prime, then the only solutions of `x² ≡ 1 (mod p)` are `x ≡ 1` and `x ≡ -1 (mod p)`.

**Proof.** `x² ≡ 1` means `p | x² - 1 = (x-1)(x+1)`. Since `p` is prime, `p | (x-1)` or `p | (x+1)` (Euclid's lemma / `ℤ_p` is an integral domain), i.e. `x ≡ 1` or `x ≡ -1 (mod p)`. These are distinct for `p > 2`. ∎

**Lemma 2.2 (Composite `n` has nontrivial roots).** If `n` is odd composite with at least two distinct prime factors, then `x² ≡ 1 (mod n)` has at least `4` solutions, hence at least one nontrivial square root of `1`.

**Proof.** Write `n = ∏ p_i^{e_i}` with `t = ω(n) ≥ 2` distinct primes. By the Chinese Remainder Theorem, `ℤ_n ≅ ∏ ℤ_{p_i^{e_i}}`, and `x² ≡ 1 (mod n)` iff `x² ≡ 1` in each factor. Each odd-prime-power factor has exactly two square roots of `1` (`±1`), so the number of solutions is `2^t ≥ 2² = 4`. Beyond `±1 (mod n)` there are therefore at least two more — nontrivial roots. ∎

**Corollary 2.3.** The existence of a nontrivial square root of `1` modulo `n` is a *certificate* that `n` is composite. Miller-Rabin's witness loop is precisely a search for such a root inside the Fermat computation.

This lemma is the entire mathematical engine: a prime modulus forbids nontrivial roots (Lemma 2.1), and Miller-Rabin exposes them whenever the squaring chain reaches `1` from a value other than `±1`.

### 2.1 Worked Construction of a Nontrivial Root

Take `n = 561 = 3·11·17`. By CRT, `ℤ_{561} ≅ ℤ_3 × ℤ_{11} × ℤ_{17}`, and `x² ≡ 1` corresponds to choosing a sign `±1` in each factor — `2³ = 8` solutions. Two of them are the trivial `(1,1,1) ↦ 1` and `(-1,-1,-1) ↦ 560`. A *nontrivial* one is, e.g., `(1, -1, -1)`: solve

```
x ≡ 1 (mod 3),   x ≡ -1 (mod 11),   x ≡ -1 (mod 17).
```

CRT gives `x = 67` (check: `67 ≡ 1 (mod 3)`, `67 ≡ 1 (mod 11)`? `67 = 6·11 + 1` so `≡ 1` — let us instead take the solution `x = 67` that satisfies `67² = 4489 = 8·561 + 1 ≡ 1 (mod 561)` with `67 ≢ ±1`). The point: `67` is a genuine nontrivial square root of `1` mod `561`, and the Miller-Rabin chain for base `2` lands exactly on `67` just before squaring to `1` — that is the mechanism that catches the Carmichael number. Each of the `2³ - 2 = 6` nontrivial roots is a potential "trap" that a base's chain may expose.

### 2.2 Counting Roots by the Number of Prime Factors

The number of square roots of `1` modulo `n` is `2^{ω*(n)}`, where `ω*(n)` counts the odd prime-power factors (with a correction for the power of `2` dividing `n`). For odd `n`:

| `n` form | square roots of 1 | nontrivial roots |
|----------|-------------------|-------------------|
| prime `p` | 2 | 0 |
| prime power `p^e` | 2 | 0 |
| `p·q` (two primes) | 4 | 2 |
| `p·q·r` (three) | 8 | 6 |

A prime or prime power has **no** nontrivial roots — so the square-root test alone cannot distinguish a prime from a prime power; the *Fermat* part of the strong test (the `a^d ≡ 1` branch and the small-prime sieve) handles prime powers, while the square-root part handles numbers with `≥ 2` distinct primes (including all Carmichael numbers, which are squarefree with `≥ 3` factors).

---

## 3. Fermat's Little Theorem and Why Fermat Fails (Carmichael Numbers)

**Theorem 3.1 (Fermat's Little Theorem).** If `p` is prime and `gcd(a, p) = 1`, then `a^(p-1) ≡ 1 (mod p)`.

**Proof.** `(ℤ_p)^×` is a group of order `p - 1`; by Lagrange's theorem the order of `a` divides `p - 1`, so `a^(p-1) = 1`. ∎

**Definition 3.2 (Fermat pseudoprime).** A composite `n` with `a^(n-1) ≡ 1 (mod n)` is a **Fermat pseudoprime to base `a`** (`a` is a Fermat liar).

**Definition 3.3 (Carmichael number).** A composite `n` that is a Fermat pseudoprime to **every** base `a` coprime to `n`; equivalently, `a^(n-1) ≡ 1 (mod n)` for all `a ∈ (ℤ_n)^×`.

**Theorem 3.4 (Korselt's criterion).** An odd composite `n` is a Carmichael number iff `n` is **squarefree** and for every prime `p | n`, `(p - 1) | (n - 1)`.

**Proof sketch.** `a^(n-1) ≡ 1` for all units iff the exponent `n-1` is a multiple of the group exponent `λ(n)` (Carmichael function). For squarefree `n = ∏ p_i`, `λ(n) = lcm(p_i - 1)`, so the condition is `(p_i - 1) | (n - 1)` for all `i`. If `n` is not squarefree (`p² | n`), the unit group has an element of order `p`, which cannot divide the coprime `n - 1`, so some base is a Fermat witness. ∎

**Example.** `561 = 3·11·17` is squarefree, and `(3-1)=2`, `(11-1)=10`, `(17-1)=16` all divide `560`. So `561` is Carmichael — the smallest. The next are `1105, 1729, 2465, 2821, 6601, 8911`. Alford-Granville-Pomerance (1994) proved there are **infinitely many** Carmichael numbers.

**Consequence.** The Fermat test is *useless* on Carmichael numbers: every coprime base lies. This is exactly the gap Miller-Rabin closes — by Lemma 2.2, a Carmichael number, having `ω(n) ≥ 3 ≥ 2` distinct factors, *does* admit nontrivial square roots of `1`, which the strong test detects even though the Fermat endpoint is `1`.

### 3.1 Why Carmichael Numbers Have At Least Three Prime Factors

**Proposition 3.5.** Every Carmichael number is odd, squarefree, and has at least **three** distinct prime factors.

**Proof.** *Odd:* if `n` were even and Carmichael, take `a = n - 1 ≡ -1`; then `a^{n-1} = (-1)^{n-1} = -1 ≢ 1` for odd `n-1` — contradiction (and for even `n`, `n-1` is odd). *Squarefree:* Korselt (Theorem 3.4). *Three factors:* suppose `n = p·q` with `p < q` primes. Korselt needs `(q-1) | (n-1)`. But `n - 1 = pq - 1 = p(q-1) + (p-1)`, so `(q-1) | (p-1)`, impossible since `0 < p - 1 < q - 1`. Hence `ω(n) ≥ 3`. ∎

This is why the smallest Carmichael number is `561 = 3·11·17` (three factors), and it guarantees `ω(n) ≥ 3 ≥ 2`, so Lemma 2.2 always applies: every Carmichael number admits nontrivial square roots of `1` and is therefore catchable by Miller-Rabin.

### 3.2 Density and Distribution

Carmichael numbers are rare but infinite. Let `C(x)` count them below `x`. Erdős conjectured, and Alford-Granville-Pomerance (1994) proved, that `C(x) > x^{1-ε}` for large `x` — there are infinitely many, and more than any fixed polynomial-in-`log` bound would suggest. Yet they thin out: there are only `43` below `10^6` and `2163` below `10^9`. This rarity is *why the Fermat test "usually works"* on random inputs — but "usually" is not "always," and an adversary can hand you a Carmichael number on purpose. Miller-Rabin removes the gamble entirely.

---

## 4. The Miller-Rabin Characterization of Primes

**Theorem 4.1 (Strong-prp characterization of primes).** If `n` is an odd prime, then for **every** base `a` with `gcd(a, n) = 1`, `n` is a strong probable prime to base `a`: either `a^d ≡ 1 (mod n)` or `a^(d·2^r) ≡ -1 (mod n)` for some `0 ≤ r < s`.

**Proof.** Let `n` be prime. By Fermat, `a^(n-1) = a^(d·2^s) ≡ 1`. Consider the chain
```
x_0 = a^d,  x_1 = x_0²,  …,  x_s = x_{s-1}² = a^(n-1) ≡ 1  (mod n).
```
Let `r` be the **least** index with `x_r ≡ 1` (some such `r ≤ s` exists since `x_s ≡ 1`). If `r = 0`, then `a^d ≡ 1` and we are in the first case. If `r ≥ 1`, then `x_{r-1}² = x_r ≡ 1`, so `x_{r-1}` is a square root of `1`; by Lemma 2.1, `x_{r-1} ≡ ±1`. It cannot be `≡ 1` (that would contradict minimality of `r`), so `x_{r-1} ≡ -1`, i.e. `a^(d·2^{r-1}) ≡ -1` with `0 ≤ r-1 < s`. Either way the strong condition holds. ∎

**Theorem 4.2 (Contrapositive — the witness guarantee).** If `n` is **not** a strong probable prime to base `a` (i.e. `a` is a witness), then `n` is composite — with certainty.

This is the source of the asymmetry: a witness *proves* compositeness (Theorem 4.2), but passing the strong test only makes `n` a *probable* prime, because composites can have liars (Section 6 bounds how many).

**Remark (equivalent failure detection).** In an implementation, the chain reaching `1` at some `x_r` with `x_{r-1} ≢ -1` is exactly a nontrivial square root of `1` (Def. 1.5) — the negation of the Theorem 4.1 structure. So "no `1` at start and no `-1` in the chain" ⇔ "witness."

### 4.1 Worked Proof Trace on `n = 13`

`n - 1 = 12 = 3·2²`, so `d = 3, s = 2`. For base `a = 2`:

```
x_0 = 2³ mod 13 = 8.        (≠ 1, ≠ 12)
x_1 = 8² mod 13 = 64 mod 13 = 12 = -1.   ← first 1 in chain would be x_2; x_1 = -1 ✓
x_2 = 12² mod 13 = 144 mod 13 = 1.
```

The least `r` with `x_r = 1` is `r = 2`; `x_{r-1} = x_1 = -1`, satisfying Theorem 4.1's structure (a `-1` precedes the first `1`). So `13` is a strong probable prime to base `2`, consistent with `13` being prime. Contrast `n = 561`, where the first `1` (at `x_3 = 1` from `x_2 = 67`) is preceded by `67 ≠ ±1` — the structure *fails*, exposing compositeness.

### 4.2 The Strong-prp Condition as a Disjunction

Def. 1.3's two cases are exhaustive for a prime by Theorem 4.1, but for an arbitrary `n` they define a *test*. Restating as a boolean over the chain `x_0, …, x_{s-1}` (with `x_r = a^{d·2^r}`):

```
strong_prp(n, a)  ≡  (x_0 ≡ 1)  ∨  (∃ r ∈ [0, s-1] : x_r ≡ -1).
```

`n` is composite-certified by `a` iff this disjunction is **false**. Because the chain is computed by `s-1` squarings after one fast exponentiation, evaluating the disjunction costs `O(log n)` modular multiplications (Section 8). The disjunction's first clause is the "Fermat-like" part; the second is the "square-root-of-1" part — together strictly stronger than Fermat's single `a^{n-1} ≡ 1` clause (Section 5).

---

## 5. Why Miller-Rabin Catches Composites

The contrapositive (Theorem 4.2) says witnesses prove compositeness; the practical question is *whether witnesses are plentiful*. Two structural reasons composites have witnesses:

**Reason 1 — Nontrivial roots (Lemma 2.2).** If `ω(n) ≥ 2`, nontrivial square roots of `1` exist. A base `a` whose chain passes through such a root (reaching `1` from a non-`±1` value) is a witness. Carmichael numbers (`ω ≥ 3`) fall here: Fermat's endpoint is `1`, but the chain exposes a nontrivial root.

**Reason 2 — Fermat witnesses upgrade.** If `n` is not Carmichael, some base has `a^(n-1) ≢ 1` (a Fermat witness); then certainly `a^d ≢ 1` and no `a^(d·2^r) ≡ -1` (else squaring would give `+1`), so `a` is also a strong witness. Thus every Fermat witness is a Miller-Rabin witness — Miller-Rabin is **strictly stronger** than Fermat.

**Theorem 5.1 (Strong liars form no group containing all units).** Unlike Fermat liars (which form the whole unit group for Carmichael `n`), the set of **strong liars** is never all of `(ℤ_n)^×` for composite `n`; it is contained in a *proper* subgroup-like structure of size `≤ φ(n)/4` (Section 6). This is exactly why no "strong Carmichael" numbers exist: there is no composite that is a strong pseudoprime to *all* coprime bases.

The combination — primes pass for all bases (Theorem 4.1), composites fail for at least 3/4 of bases (Theorem 6.1) — is what makes the test both sound and (probabilistically) complete.

### 5.1 Soundness and Completeness, Precisely

- **Soundness (no false "composite"):** by Theorem 4.1, a prime passes for *every* base, so Miller-Rabin never reports a prime as composite. A "composite" verdict is therefore always correct — it carries a witness, an explicit certificate.
- **One-sided completeness (rare false "prime"):** by Theorem 6.1, a composite is *missed* by a single random base with probability `≤ 1/4`. With `k` bases the miss probability is `≤ 4^{-k}`. So "prime" is correct with probability `≥ 1 - 4^{-k}` (and exactly correct for `n < 2^64` with a proven set).

This one-sidedness — *certain on "composite," probabilistic on "prime"* — is the defining feature of a **Monte Carlo** algorithm with one-sided error, and it is why Miller-Rabin is sometimes described as a "compositeness test" rather than a "primality test."

### 5.2 Worked Monier-Formula Count for `n = 65`

`n = 65 = 5 · 13`, so `t = ω(n) = 2`, `p_1 = 5, p_2 = 13`. `n - 1 = 64 = 1 · 2^6`, so `d = 1, s = 6`. The 2-adic valuations: `ν₂(5-1) = ν₂(4) = 2`, `ν₂(13-1) = ν₂(12) = 2`, so `m = min(2,2) = 2`. Also `gcd(d, p_i - 1) = gcd(1, 4) = 1` for both. Monier:

```
|S(65)| = (1 + (2^{2·2} - 1)/(2^2 - 1)) · (1 · 1)
        = (1 + (16 - 1)/(4 - 1)) · 1
        = (1 + 5) · 1 = 6.
```

So `65` has `6` strong liars in `[1, 64]`. Since `φ(65) = 48`, the liar ratio is `6/48 = 1/8 ≤ 1/4` — consistent with Theorem 6.1, and comfortably below the worst case. Indeed the bases `{2, …, 63}` contain `6` liars and the rest are witnesses, so a single random base catches `65` with probability `≥ 7/8` here — better than the guaranteed `3/4`.

---

## 6. The ≤ 1/4 Error Bound (At Least 3/4 of Bases Are Witnesses)

**Theorem 6.1 (Rabin, Monier).** For every odd composite `n > 9`, the number of strong liars in `[1, n-1]` is at most `φ(n)/4 ≤ (n-1)/4`. Equivalently, at least `3/4` of the bases `a ∈ [2, n-2]` are witnesses.

**Proof sketch (Monier's formula / group-theoretic bound).** Let `S(n)` be the set of strong liars. Monier gives an exact count
```
|S(n)| = ( 1 + (2^{m·t} - 1)/(2^t - 1) ) · ∏_{i=1}^{t} gcd(d, p_i - 1),
```
where `t = ω(n)`, `p_i` the distinct primes, and `m = min_i ν₂(p_i - 1)`. One bounds `|S(n)| ≤ φ(n)/4` by case analysis on `t` and the prime-power structure:

- If `n = p^e` is a prime power (`e ≥ 2`), the liars sit in the cyclic `(ℤ_{p^e})^×` and number at most `gcd(d, p-1) ≤ p - 1 ≤ φ(n)/p ≤ φ(n)/4` for the relevant cases.
- If `t ≥ 2`, the product `∏ gcd(d, p_i - 1)` and the geometric factor combine so that `|S(n)|/φ(n) ≤ 1/4`; the worst case `t = 2` with both `gcd` factors large still yields `≤ 1/4`, and `t ≥ 3` is smaller.

The detailed computation (Monier 1980, Rabin 1980) verifies `|S(n)| ≤ φ(n)/4` for all odd composite `n > 9`. The bound is **tight**: certain `n` (e.g. products of twin-prime-like pairs) attain exactly `φ(n)/4` strong liars. ∎

**Corollary 6.2 (Error of `k` random bases).** Choosing `k` bases independently and uniformly from `[2, n-2]`, the probability that a composite `n` passes all `k` (all are liars) is at most `(1/4)^k = 4^{-k}`. For `k = 20`, that is `< 10^{-12}`.

**Theorem 6.3 (Average-case, much better).** For a *random* odd `n` of `b` bits that passes `k` rounds, the probability `n` is actually composite is far below `4^{-k}`; Damgård-Landrock-Pomerance (1993) show, e.g., a single round on a random 500-bit candidate already gives error `< 4^{-1}` by a large margin, and a few rounds give cryptographic-grade error. The worst-case `4^{-k}` applies to *adversarial* `n`; random `n` are much safer per round.

The distinction (worst-case `4^{-k}` vs much smaller average-case) is why standards prescribe few rounds for randomly generated key primes but demand random bases (or BPSW) for externally supplied, possibly adversarial, `n`.

### 6.1 The Structure of the Strong-Liar Set

The strong liars to *all* bases never form the full group, but for a *single* base the liars `L_a = {a : strong_prp(n,a)}` have rich structure. Monier's count `|S(n)|` (the liars across all bases simultaneously is the wrong framing; precisely, `S(n) = {a ∈ [1,n-1] : a is a strong liar}`) satisfies:

```
|S(n)| = ( 1 + (2^{tm} - 1)/(2^t - 1) ) · ∏_{i=1}^{t} gcd(d, p_i - 1),
```

with `t = ω(n)`, `m = min_i ν₂(p_i - 1)`. For `n = p·q` with both `p-1, q-1` having the same 2-adic valuation, the geometric factor is largest, giving the worst case. The takeaway: composites with **two** prime factors and aligned 2-adic valuations are the hardest to detect (most liars), which is exactly the regime the deterministic base-set searches stress-test.

### 6.2 Why `> 9` and the Tightness of `1/4`

The bound `|S(n)| ≤ φ(n)/4` requires `n > 9` because the tiny composite `9` has a liar ratio exceeding `1/4` (it is a prime power with few units). For `n > 9` the `1/4` is best possible: there exist infinitely many composites (e.g. products `p·q` of certain twin-prime-like pairs) attaining exactly `φ(n)/4` strong liars. Concretely, no general single-base test can guarantee better than `3/4` witness density, so:

```
P[k random bases all lie | n composite] ≤ (1/4)^k,   and this is tight.
```

The tightness is the formal reason that *certainty* for adversarial `n` cannot come from "more rounds" — it must come from proven base sets (bounded `n`, Section 7) or the orthogonal Lucas test of BPSW (Section 10).

---

## 7. Deterministic Witness-Set Validity (Pomerance / Jaeschke / Sorenson Bounds)

For *bounded* `n`, exhaustive search yields fixed base sets that contain a witness for **every** composite below a threshold, making the test deterministic.

**Definition 7.1 (ψ_m).** Let `ψ_m` be the smallest odd composite that is a strong pseudoprime to *all* of the first `m` prime bases `2, 3, 5, …, p_m`. Any `n < ψ_m` is correctly classified by testing those `m` bases.

**Known values (Pomerance-Selfridge-Wagstaff 1980; Jaeschke 1993; Sorenson-Webster 2015):**

| `m` | first `m` prime bases | `ψ_m` (smallest sprp to all) |
|-----|------------------------|------------------------------|
| 1 | `{2}` | `2047 = 23·89` |
| 2 | `{2,3}` | `1373653` |
| 3 | `{2,3,5}` | `25326001` |
| 4 | `{2,3,5,7}` | `3215031751` |
| 5 | `{2,3,5,7,11}` | `2152302898747` |
| 6 | `{2,3,5,7,11,13}` | `3474749660383` |
| 7 | `{2,3,5,7,11,13,17}` | `341550071728321` |
| 8 | `{2,3,5,7,11,13,17,19}` | `341550071728321` |
| 9..11 | through `{…,29,31}` | `3825123056546413051` |
| 12 | `{2,…,37}` | `> 3.18·10^{23} > 2^{64}` |

**Theorem 7.2 (Deterministic 64-bit set).** Testing the first **twelve** prime bases `{2,3,5,7,11,13,17,19,23,29,31,37}` correctly decides primality for **all** `n < 3,317,044,064,679,887,385,961,981 ≈ 3.3·10^{24}`, in particular for all `n < 2^64` (Sorenson-Webster 2015, building on Jaeschke).

**Theorem 7.3 (7-base 64-bit set).** The set `{2, 325, 9375, 28178, 450775, 9780504, 1795265022}` (Sinclair) contains a witness for every odd composite `n < 2^64`, giving a deterministic 64-bit test with only 7 bases. (The non-prime entries are chosen by computer search to maximize coverage.)

**Why these exist but no infinite set does.** For each fixed finite base set `B`, there are infinitely many composites that are strong pseudoprimes to all of `B` (a consequence of the infinitude of sprp's), so `B` can only be deterministic *below a bound*. There is no finite base set deterministic for *all* `n`. Hence: fixed proven sets for bounded ranges, random bases (or BPSW) for unbounded ranges.

### 7.1 How the Thresholds Are Found

Determining `ψ_m` is a computation, not a closed form: one enumerates strong pseudoprimes to base 2 up to a bound (there are relatively few), then filters those that are *also* sprp to base 3, then base 5, and so on, intersecting the liar sets. The smallest surviving composite is `ψ_m`. The hard part is generating sprp candidates efficiently — Pomerance-Selfridge-Wagstaff used the structure `n = (2x+1)(2y+1)…` and Jaeschke/Sorenson-Webster extended the search with sieve techniques and verified results up to `2^64` and beyond. The asymmetry "few sprp to base 2 but infinitely many overall" is what makes the search feasible: each added base roughly squares the rarity, so a dozen bases push `ψ_m` past `10^{23}`.

### 7.2 Conditional vs Unconditional Bounds

Under the **Generalized Riemann Hypothesis (GRH)**, Miller (1976) showed that the smallest witness for any composite `n` is `O(log² n)`, so testing all bases `a ≤ 2 log² n` is deterministic *for all `n`* — but only *conditionally* (GRH is unproven). The Pomerance-Jaeschke-Sorenson thresholds (Theorem 7.2) are **unconditional** but bounded. So there are two flavors of "deterministic Miller-Rabin": GRH-conditional for all `n` (Miller), and unconditional below a fixed bound (the `ψ_m` tables). Production code uses the unconditional bounded sets for `n < 2^64` and never relies on GRH.

**Adversarial caveat (Arnault).** Arnault (1995) constructed composites that are strong pseudoprimes to all bases in a chosen list of small primes — so a fixed *published* small-base set is unsafe on *adversarial* input beyond its certified bound. The deterministic bounds above hold for all `n` below the threshold (adversarial or not); past it, randomization is mandatory.

---

### 7.3 Worked Threshold Boundary: `2047`

The first nontrivial threshold `ψ_1 = 2047 = 23 · 89` deserves a full trace, because it shows *exactly* how a composite fools base 2. Decompose `2046 = 1023 · 2`, so `d = 1023, s = 1`. The chain has only `x_0` (since `s - 1 = 0` squarings):

```
x_0 = 2^1023 mod 2047 = 1.
```

Because `x_0 = 1`, base 2 declares `2047` a strong probable prime — a *strong liar*. So any deterministic test using only base 2 wrongly calls `2047` prime; you must add base 3 (`2^... ` no longer saves it — base 3 is a witness), which is why `ψ_2 = 1373653 > 2047`. This single example demonstrates the meaning of the threshold table: `{2}` is exact only for `n < 2047`, and `2047` is the precise first failure.

---

## 8. Complexity Analysis O(k log³ n)

**Theorem 8.1.** Miller-Rabin with `k` bases runs in `O(k log³ n)` bit operations using schoolbook multiplication, and `O(k M(log n) log n)` in general, where `M(b)` is the cost of multiplying two `b`-bit integers.

**Proof.** Per base:
- The decomposition `n-1 = d·2^s` is `O(log n)` (counting trailing zeros).
- `powMod(a, d, n)` performs `O(log d) = O(log n)` modular multiplications (binary exponentiation, Theorem-style loop invariant identical to fast power).
- The witness loop adds at most `s - 1 < log n` further modular squarings.

So `O(log n)` modular multiplications per base. Each modular multiplication of two `< n` numbers costs `M(log n) = O(log² n)` bit operations schoolbook (or `O(log n · log log n)` with FFT-based multiply). Total per base: `O(log n · log² n) = O(log³ n)`. Over `k` bases: `O(k log³ n)`. ∎

**Corollary 8.2 (Fixed-width 64-bit).** For `n < 2^64`, each modular multiplication is `O(1)` machine operations (one `__int128` multiply + one division, or a Montgomery REDC). The decomposition and loops are `O(log n) = O(64)` multiplications per base. With a fixed base count (7 or 12), a full deterministic test is `O(1)` overall — tens to low hundreds of machine multiplications, sub-microsecond.

**Comparison of asymptotics:**

| Test | Time | Deterministic? |
|------|------|----------------|
| Trial division | `O(√n)` = `O(2^{(log n)/2})` (exponential in bit length) | yes |
| Miller-Rabin, `k` bases | `O(k log³ n)` | yes for `n < 2^64` (proven set); else probabilistic |
| AKS | `Õ(log^{6+ε} n)` (best variants `Õ(log^6 n)`) | yes, unconditional |
| ECPP | heuristic `Õ(log^{4+ε} n)`, produces a certificate | yes (certificate) |

AKS (Agrawal-Kayal-Saxena 2002) was the breakthrough proving `PRIMES ∈ P` *unconditionally and deterministically*, but its `log^6`-class exponent makes it far slower in practice than Miller-Rabin; it is of immense theoretical importance and little practical use. Miller-Rabin's `log³` (and `O(1)` for fixed width) wins everywhere practical.

### 8.1 Bit-Operation Accounting in Detail

For `n` of `b = log₂ n` bits, one modular multiplication `(x·y) mod n` decomposes as:

- a `b × b → 2b`-bit multiply: `M(b) = O(b²)` schoolbook, `O(b log b)` with FFT,
- a `2b mod b` reduction: `O(b²)` schoolbook (long division) or `O(M(b))` with Barrett/Montgomery.

So each modular multiply is `Θ(b²)` schoolbook. The witness loop for one base does `≤ 2b` modular multiplies (the fast exponentiation's `≤ 2 log d ≤ 2b`, plus `s-1 ≤ b` squarings), giving `O(b · b²) = O(b³) = O(log³ n)`. Over `k` bases: `O(k log³ n)`. With FFT-based multiplication the per-multiply cost drops to `Õ(b)`, yielding `Õ(k log² n)` — relevant only for cryptographic-size `n` where FFT multiply pays off.

### 8.2 The `O(1)` Claim for Fixed-Width `n`

For `n < 2^64`, every modular multiply is a constant number of machine instructions (one `128`-bit multiply and one `128/64 → 64` division, or one Montgomery REDC). The exponent `d < 2^64` has `< 64` bits, so the fast-power loop runs `< 64` iterations, each `O(1)`. With a fixed base count `c` (7 or 12), the total is `c · O(64) = O(1)` machine operations — a few hundred at most. This is why a deterministic 64-bit primality test is, for practical purposes, a constant-time microsecond-scale operation, dramatically faster than `√n` trial division (`~2^32` operations near `2^64`).

### 8.3 Comparison of Operation Counts Near `2^64`

| Method | operations for `n ≈ 1.8·10^{19}` | feasible? |
|--------|-----------------------------------|-----------|
| Trial division | `√n ≈ 4.3·10^9` divisions | no (seconds) |
| Pollard rho (find factor) | `~n^{1/4} ≈ 6.5·10^4` iterations | yes, but only finds a factor |
| MR deterministic, 7 bases | `7 · ~120 ≈ 840` modular multiplies | yes (sub-microsecond) |
| MR deterministic, 12 bases | `12 · ~120 ≈ 1440` modular multiplies | yes |
| BPSW | `~120 (MR) + ~250 (Lucas)` operations | yes |

The three-to-four orders of magnitude between trial division and Miller-Rabin is the practical headline: any workload testing more than a handful of large numbers must use a Miller-Rabin family test.

---

### 8.4 Counting Strong Pseudoprimes

Let `S_2(x)` count strong pseudoprimes to base 2 below `x`. These are far rarer than Fermat pseudoprimes or Carmichael numbers:

| `x` | strong pseudoprimes to base 2 below `x` |
|-----|------------------------------------------|
| `10^3` | 0 |
| `10^4` | 5 (`2047, 3277, 4033, 4681, 8321`) |
| `10^6` | 46 |
| `10^9` | 1091 |
| `10^{13}` | ~58000 |

The rarity grows slowly; Pomerance's heuristic gives `S_2(x) = x^{1 - (1+o(1)) (log log log x)/(log log x)}`, sub-polynomially smaller than `x`. The practical consequence: even base 2 alone is *empirically* an excellent test, failing on a vanishing fraction of inputs — but "vanishing fraction" is not "never," so deterministic correctness still needs the full proven base set or BPSW.

### 8.5 The Cost Hierarchy Within One Test

Within a single Miller-Rabin base test, the cost concentration is:

1. **The fast exponentiation `a^d mod n`** — `≈ log d ≈ log n` modular multiplies; the dominant term.
2. **The `s - 1` squarings** — `≤ log n` more modular multiplies; usually far fewer since `s` is small (median `s` is `1` or `2` for random `n`, because `n - 1` is "usually" only divisible by a small power of 2).
3. **The decomposition and comparisons** — `O(log n)` cheap bit operations.

So `s` being small on average means the witness loop adds little over a plain Fermat exponentiation — the strengthening from Fermat to Miller-Rabin is essentially *free*, reinforcing that there is never a reason to ship the weaker Fermat test.

---

## 9. Relation to Other Tests (Solovay-Strassen, AKS, BPSW)

**Solovay-Strassen.** Tests `a^{(n-1)/2} ≡ (a/n) (mod n)` (Euler's criterion with the Jacobi symbol). Its liars (Euler liars) number `≤ φ(n)/2`, giving error `≤ (1/2)^k` — *weaker* than Miller-Rabin's `(1/4)^k`. Moreover the **strong** liars of Miller-Rabin are a subset of the **Euler** liars, so Miller-Rabin is strictly stronger: every Solovay-Strassen witness is a Miller-Rabin witness, but not conversely. There is no reason to prefer Solovay-Strassen today.

**Why Euler's criterion is correct.** For prime `p` and `gcd(a,p)=1`, `a^{(p-1)/2}` is a square root of `a^{p-1} ≡ 1`, hence `±1`; it is `+1` iff `a` is a quadratic residue, which is exactly the Legendre symbol `(a/p)`. The Jacobi symbol `(a/n)` extends this multiplicatively to composite `n`, and Solovay-Strassen flags any `a` violating the congruence. A composite `n` always has at least one such Euler witness (the Euler liars are a proper subgroup of `(ℤ_n)^×`, so `≤ φ(n)/2`), which is why — unlike Fermat — Solovay-Strassen has *no* Carmichael-style universal-liar numbers. Miller-Rabin simply tightens the subgroup further (to index `≥ 4`).

**Hierarchy of liar sets (for composite `n`):**
```
strong liars (MR)  ⊆  Euler liars (Solovay-Strassen)  ⊆  Fermat liars.
   ≤ φ(n)/4              ≤ φ(n)/2                          up to φ(n) (Carmichael)
```
This inclusion is the formal statement that Miller-Rabin is the strongest of the three.

**Theorem 9.1 (Strong ⊆ Euler ⊆ Fermat liars).** For any odd composite `n` and base `a` coprime to `n`: if `a` is a strong liar then `a` is an Euler liar, and if `a` is an Euler liar then `a` is a Fermat liar.

**Proof.** *Strong ⇒ Euler:* a strong probable prime to base `a` satisfies `a^d ≡ 1` or `a^{d·2^r} ≡ -1`. Squaring the appropriate term up to `a^{(n-1)/2}` and tracking signs yields Euler's criterion `a^{(n-1)/2} ≡ ±1 ≡ (a/n)` (the Jacobi symbol matches by a parity argument on `r` and the structure of the chain). *Euler ⇒ Fermat:* squaring `a^{(n-1)/2} ≡ (a/n) = ±1` gives `a^{n-1} ≡ 1`. The inclusions are *strict* for many `n`: there exist Euler liars that are not strong liars, and Fermat liars (every coprime base of a Carmichael number) that are not Euler liars. ∎

**Corollary 9.2.** Miller-Rabin has the smallest liar set of the three, hence the best error bound (`1/4` vs Solovay-Strassen's `1/2` vs Fermat's "up to all"). This is the formal sense in which Miller-Rabin dominates.

**AKS.** Deterministic, polynomial, unconditional (Section 8). Based on the polynomial congruence `(x + a)^n ≡ x^n + a (mod x^r - 1, n)` for suitable small `r`. The correctness rests on: if `n` is prime, the congruence holds for *all* `a` (the "Freshman's dream" / Frobenius in characteristic-`p` polynomial rings); and if `n` is composite, it *fails* for some small `a` and a carefully chosen `r = O(log⁵ n)`. The deep part is bounding `r` and the number of `a` to check via a group-theoretic argument on the multiplicative order of `n` modulo `r`. Important for theory (`PRIMES ∈ P`); slow in practice because of the polynomial-ring arithmetic and the `log⁵`-size `r`.

**BPSW.** Combines one Miller-Rabin base-2 test with a strong Lucas test (Section 10). No composite is known to pass; proven no counterexample below `2^64`. The de facto general-purpose test in many libraries.

**ECPP (Elliptic Curve Primality Proving).** Unlike Miller-Rabin (which only certifies *compositeness*), ECPP produces a **primality certificate** — a short, independently re-verifiable proof that `n` is prime, built recursively via the group order of elliptic curves modulo `n` (Goldwasser-Kilian / Atkin-Morain). Heuristic running time `Õ(log⁴ n)`; the certificate verifies in `Õ(log³ n)`. ECPP is the tool when you need a *checkable proof of primality* (e.g. cryptographic standards, record primes), a capability Miller-Rabin lacks entirely.

**Pratt certificates.** A Pratt certificate proves `n` prime by exhibiting a primitive root `g` and the factorization of `n - 1`, recursively certifying each prime factor. It shows `PRIMES ∈ NP` (primality has succinct certificates) and predates ECPP. Its drawback: it requires factoring `n - 1`, which is hard in general, so it is practical only when `n - 1` factors easily.

### 9.3 The Test-Selection Lattice

Ordering the tests by *guarantee strength* (not speed):

```
Fermat  ⊏  Solovay-Strassen  ⊏  Miller-Rabin  ⊏  BPSW (empirically)  ⊏  ECPP / AKS (proof)
weakest                                                                strongest
```

Each step up shrinks (or eliminates) the pseudoprime set: Fermat has universal liars (Carmichael), Solovay-Strassen has no universal liars but error `1/2^k`, Miller-Rabin tightens to `1/4^k`, BPSW has no known counterexample, and ECPP/AKS give *unconditional proofs*. Production picks the lowest step meeting the requirement: deterministic MR or BPSW for `< 2^64` exactness, ECPP when a certificate is mandated.

---

## 10. The Lucas Test and BPSW Foundations

**Definition 10.1 (Lucas sequences).** For integers `P, Q` with `D = P² - 4Q`, define `U_0 = 0, U_1 = 1, V_0 = 2, V_1 = P` and the recurrences `U_{m+1} = P U_m - Q U_{m-1}`, `V_{m+1} = P V_m - Q V_{m-1}`.

**Theorem 10.2 (Lucas primality property).** If `n` is prime, `gcd(n, 2QD) = 1`, and `(D/n) = -1` (Jacobi symbol), then `U_{n+1} ≡ 0 (mod n)`. A composite `n` satisfying this is a **Lucas pseudoprime**.

**Strong Lucas test.** Factor `n + 1 = d'·2^{s'}` and check an analogous chain on `U_{d'}, V_{d'}` (vanishing of `U` or a `V`-chain), mirroring Miller-Rabin's structure but on the `n+1` side using the Lucas recurrence — hence "orthogonal" to the base-`a` power test that uses `n-1`.

**Definition 10.3 (BPSW).** `n` passes **Baillie-PSW** iff it is a Miller-Rabin strong probable prime to base 2 **and** a strong Lucas probable prime with Selfridge parameters (first `D ∈ {5,-7,9,-11,…}` with `(D/n) = -1`).

**Theorem 10.4 (BPSW reliability).** No BPSW pseudoprime is known, and exhaustive verification shows there are **none below `2^64`**. Heuristics (Pomerance) suggest BPSW pseudoprimes, if they exist, are extraordinarily rare. Thus BPSW is effectively a deterministic 64-bit test using just two checks.

**Why combine MR and Lucas.** MR-base-2 pseudoprimes and Lucas pseudoprimes are believed disjoint in practice because the two tests probe different algebraic structures (the multiplicative group via `n-1` vs the Lucas sequence via `n+1` and the Jacobi symbol). A number engineered to fool one is overwhelmingly unlikely to fool the other — the empirical basis for BPSW's strength.

### 10.1 The Selfridge Parameter Choice

The Lucas test needs `D` with Jacobi symbol `(D/n) = -1`, ensuring the Lucas sequence lives in a quadratic extension where `n` (if prime) acts like the Frobenius. **Selfridge's method A** scans `D ∈ {5, -7, 9, -11, 13, -15, …}` (i.e. `5, 7, 9, …` with alternating signs) and takes the first with `(D/n) = -1`. If during the scan some `D` shares a factor with `n` (i.e. `gcd(D, n) > 1` and `< n`), that factor *proves* compositeness immediately. A subtle case: if `n` is a perfect square, the scan never finds `(D/n) = -1` (squares have all Jacobi symbols `+1` or `0`), so BPSW rejects perfect squares up front via an integer-square-root check.

### 10.2 The Lucas Squaring Chain Mirrors Miller-Rabin

The strong Lucas test factors `n + 1 = d'·2^{s'}` (note: `n+1`, not `n-1`) and checks whether `U_{d'} ≡ 0` or some `V_{d'·2^r} ≡ 0 (mod n)` for `0 ≤ r < s'`. This is *structurally identical* to Miller-Rabin's `n-1 = d·2^s` chain — a base computation followed by repeated doubling — but on the Lucas recurrence instead of modular powers. The `V`-doubling identity `V_{2m} = V_m² - 2Q^m` plays the role that squaring `x → x²` plays in Miller-Rabin. This parallel is why both halves of BPSW share the same `O(log³ n)` cost and the same "decompose, then square/double `s` times" shape.

---

### 10.3 Worked Lucas Computation Sketch

For `n = 5777` (a known strong Lucas pseudoprime), Selfridge gives `D = -7` (first with Jacobi `-1`), `P = 1`, `Q = (1 - (-7))/4 = 2`. One factors `n + 1 = 5778 = 2889 · 2`, computes `U_{2889}, V_{2889} (mod n)` by the Lucas doubling recurrences, and checks for the vanishing condition. `5777` happens to *pass* the strong Lucas test (a Lucas liar) but *fails* the Miller-Rabin base-2 test — so BPSW (which requires passing *both*) correctly reports it composite. This is the orthogonality in action: the two halves catch different liars, and no number below `2^64` (and none known anywhere) fools both.

### 10.4 Equivalent Formulations and the Frobenius View

The Lucas test can be phrased as a **Frobenius** condition: in the ring `ℤ_n[x]/(x² - Px + Q)`, primality forces `x^n ≡ x̄` (the conjugate root) when `(D/n) = -1`, mirroring how the base-`a` test uses `a^n ≡ a` in `ℤ_n`. BPSW is thus "a Fermat-style test in `ℤ_n` (base 2) plus a Fermat-style test in a quadratic extension (Lucas)." The strong versions add the square-root/doubling refinement to each. Viewing both halves as Frobenius checks in different rings explains, at a structural level, why their pseudoprimes are believed disjoint: a composite would have to mimic the Frobenius automorphism in *two different* algebraic settings simultaneously.

---

## 11. Summary

- **Square-root-of-1 lemma (Section 2).** Modulo a prime, `x² ≡ 1 ⇒ x ≡ ±1`; composites with `ω(n) ≥ 2` admit `2^{ω(n)} ≥ 4` roots, so *nontrivial* roots exist and certify compositeness.
- **Fermat fails on Carmichael numbers (Section 3).** By Korselt's criterion, squarefree `n` with `(p-1)|(n-1)` for all `p|n` are Fermat-liars to every coprime base; infinitely many exist (Alford-Granville-Pomerance). Fermat cannot detect them.
- **Miller-Rabin characterization (Section 4).** A prime satisfies the strong condition (`a^d ≡ 1` or some `a^{d·2^r} ≡ -1`) for *every* base — proved by tracing the squaring chain and applying Lemma 2.1 at its first `1`.
- **Witness guarantee (Section 5).** The contrapositive makes any witness a *proof* of compositeness; Miller-Rabin is strictly stronger than Fermat (every Fermat witness is a strong witness), and no "strong Carmichael" numbers exist.
- **≤ 1/4 error bound (Section 6).** Rabin/Monier: at most `φ(n)/4` strong liars, so `≥ 3/4` of bases are witnesses; `k` random bases give worst-case error `4^{-k}`, with much smaller average-case error for random `n` (Damgård-Landrock-Pomerance).
- **Deterministic sets (Section 7).** Pomerance-Selfridge-Wagstaff / Jaeschke / Sorenson-Webster give proven base sets: `{2,3,5,7}` below `3.2·10^9`, the first 12 primes (or a 7-base set) below `2^64`. No finite set is deterministic for all `n`; adversarial inputs beyond the bound need randomization.
- **Complexity (Section 8).** `O(k log³ n)` bit operations (schoolbook), `O(1)` machine multiplications for fixed-width 64-bit. Far faster than trial division (`O(√n)`) and AKS (`Õ(log^6 n)`).
- **Relatives (Sections 9-10).** Strong liars ⊆ Euler liars ⊆ Fermat liars, so Miller-Rabin beats Solovay-Strassen and Fermat. BPSW (MR base 2 + strong Lucas) has no known counterexample and none below `2^64`.

### Complexity / reliability cheat table

| Test | Liar bound | Error (`k` rounds) | Time |
|------|-----------|--------------------|------|
| Fermat | up to `φ(n)` (Carmichael) | can be `1` | `O(k log³ n)` |
| Solovay-Strassen | `≤ φ(n)/2` | `≤ 2^{-k}` | `O(k log³ n)` |
| **Miller-Rabin** | `≤ φ(n)/4` | `≤ 4^{-k}` (random bases) | `O(k log³ n)` |
| MR deterministic `< 2^64` | 0 (proven set) | 0 | `O(log³ n)` |
| BPSW | 0 known, 0 below `2^64` | none observed | `O(log³ n)` |
| AKS | — | 0 (deterministic) | `Õ(log^6 n)` |

### Worked End-to-End: `n = 221`

A final integration of every idea. `n = 221 = 13 · 17` (`ω = 2`, so nontrivial roots exist by Lemma 2.2). `n - 1 = 220 = 55 · 2²`, so `d = 55, s = 2`. Test base `a = 174`:

```
x_0 = 174^55 mod 221 = 47.     (≠ 1, ≠ 220)
x_1 = 47² mod 221 = 2209 mod 221 = 220 = -1.   ← saw -1 → 174 is a strong LIAR.
```

So base `174` is fooled — `221` is a strong pseudoprime to base `174`. Now test base `a = 2`:

```
x_0 = 2^55 mod 221 = 32.       (≠ 1, ≠ 220)
x_1 = 32² mod 221 = 1024 mod 221 = 140.   (≠ 1, ≠ 220, and loop is done since s-1 = 1)
```

The chain ended with neither `1` nor `-1` reached as `±1`, so base `2` is a **witness**: `221` is composite. This shows both phenomena at once — a liar (`174`) that the bound permits, and a witness (`2`) that the guarantee promises must exist among `≥ 3/4` of bases. A deterministic test using `{2}` (valid for `n < 2047`) correctly classifies `221`.

### Closing Notes

- **The lemma is everything (Section 2):** a prime modulus forbids nontrivial square roots of `1`; Miller-Rabin is a search for one inside the Fermat exponent's squaring chain.
- **Strictly stronger than Fermat (Section 5):** the strong condition factors `a^{n-1}` through `a^d, a^{2d}, …`, catching Carmichael numbers Fermat cannot.
- **Quarter bound is tight (Section 6):** some composites attain exactly `φ(n)/4` strong liars, so `4^{-k}` cannot be improved in the worst case — only randomization or proven sets give certainty.
- **Strictly stronger than its predecessors (Section 9):** strong liars ⊆ Euler liars ⊆ Fermat liars, so Miller-Rabin beats both Solovay-Strassen (`1/2^k`) and Fermat (universal liars); BPSW and ECPP/AKS sit above it on the guarantee lattice.
- **Bounded determinism only (Section 7):** proven base sets are exact below their thresholds; no finite set is exact for all `n`, so unbounded/adversarial `n` require random bases or BPSW.
- **One-sided error (Section 5.1):** "composite" is a certificate (always correct), "prime" is probabilistic — Miller-Rabin is a Monte Carlo compositeness test, exact only with a proven base set.
- **Average vs worst case (Section 6, 8.4):** strong pseudoprimes are extraordinarily rare, so the *average-case* error after one round is tiny — but adversarial inputs force the worst-case `1/4`, which is why certainty needs proven sets or BPSW, not "more rounds."
- **The strengthening is free (Section 8.5):** the witness loop adds only `s - 1` squarings (small `s` on average) over a plain Fermat exponentiation, so Miller-Rabin costs essentially the same as Fermat while being strictly stronger — there is never a reason to ship Fermat.

### Pseudoprime Density Snapshot

| Below `x = 10^9` | count |
|------------------|-------|
| primes | `~50.8` million |
| Fermat pseudoprimes (base 2) | `5597` |
| strong pseudoprimes (base 2) | `1091` |
| Carmichael numbers | `646` |
| strong pseudoprimes to `{2,3,5,7}` | `0` (below `3.2·10^9`) |

The last row is the whole point of the deterministic base sets: intersecting enough liar sets drives the count to exactly zero below the threshold, turning a probabilistic test into a proof for bounded `n`.

Foundational references: Miller (1976) and Rabin (1980) for the test and the `1/4` bound; Monier (1980) for the exact liar count; Pomerance-Selfridge-Wagstaff (1980), Jaeschke (1993), and Sorenson-Webster (2015) for deterministic base sets; Korselt (1899) and Alford-Granville-Pomerance (1994) for Carmichael numbers; Baillie-Wagstaff (1980) for BPSW and the Lucas test; Agrawal-Kayal-Saxena (2004) for AKS; Arnault (1995) for adversarial pseudoprimes; Damgård-Landrock-Pomerance (1993) for average-case error; Goldwasser-Kilian (1986) and Atkin-Morain (1993) for ECPP; Pratt (1975) for primality certificates. Sibling topic `10-matrix-exponentiation` (`19-number-theory`) for the fast-power machinery.

### Theorem Dependency Recap

| Result | Depends on | Used by |
|--------|-----------|---------|
| Lemma 2.1 (`±1` only roots) | `ℤ_p` is a domain | Theorems 4.1, 4.2, 5.1 |
| Lemma 2.2 (composite roots) | CRT | Cor 2.3, Section 3 |
| Theorem 3.4 (Korselt) | `λ(n)` structure | Prop 3.5, Carmichael existence |
| Theorem 4.1 (primes pass) | Lemma 2.1, Fermat | Soundness (5.1) |
| Theorem 6.1 (`1/4` bound) | Monier's formula | error analysis, Section 7 |
| Theorem 7.2 (det. set) | exhaustive sprp search | production 64-bit test |

This table is the dependency graph of the whole topic: Lemma 2.1 is the root, the `1/4` bound (Theorem 6.1) is the probabilistic payoff, and the deterministic sets (Theorem 7.2) are the engineering payoff for bounded `n`. Everything else connects these three pillars.

One last unifying observation: the entire test is the *contrapositive* of one fact. A prime forces the strong-prp structure (Theorem 4.1) because of Lemma 2.1; therefore the absence of that structure (a witness) proves non-primality. The probabilistic and deterministic results then quantify *how easy it is to find such a witness* — at least `3/4` of bases (Theorem 6.1), and a specific small proven set below each threshold (Theorem 7.2). Soundness comes from the algebra; completeness comes from the abundance of witnesses. That clean separation — algebra for soundness, counting for completeness — is the conceptual signature of Miller-Rabin and the reason it remains the standard primality test decades after Miller and Rabin introduced it.
