# Divisor Functions — Professional / Mathematical Foundations

> **Focus:** Rigorous proofs. Why `d` and `σ` are **multiplicative** (the divisor bijection of a coprime product); the closed forms `d(n) = Π(a_i+1)` and `σ(n) = Π(p^{a+1}−1)/(p−1)` derived from first principles; the **`O(N log N)`** divisor-sieve bound via `Σ_{i=1}^{N} N/i = N·H_N ~ N ln N`; the **Dirichlet-convolution** foundation (`d = 1 * 1`, `σ = id * 1`, `σ_k = id_k * 1`) and why convolution preserves multiplicativity; the linear-sieve correctness for `d`/`σ`; the **Euclid–Euler** perfect-number theorem; and the **asymptotics** of `σ` (`σ(n)/n` average, the `lim sup σ(n)/(n ln ln n)` of Gronwall) and of `d` (`Σ d(n) ~ N ln N`, the Dirichlet divisor problem).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Notation and Standing Assumptions](#notation-and-standing-assumptions)
3. [Foundations: Divisors and Unique Factorization](#foundations-divisors-and-unique-factorization)
4. [Closed Forms for d and σ](#closed-forms-for-d-and-σ)
5. [Multiplicativity, Proved Two Ways](#multiplicativity-proved-two-ways)
6. [Dirichlet Convolution Foundation](#dirichlet-convolution-foundation)
7. [The O(N log N) Divisor-Sieve Bound](#the-on-log-n-divisor-sieve-bound)
8. [Correctness of the Linear Sieve for d and σ](#correctness-of-the-linear-sieve-for-d-and-σ)
9. [The Euclid–Euler Perfect-Number Theorem](#the-euclideuler-perfect-number-theorem)
10. [Asymptotics of σ and d](#asymptotics-of-σ-and-d)
11. [Worked Proof Walkthrough](#worked-proof-walkthrough)
12. [Numerical Sanity Checks](#numerical-sanity-checks)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction

The product formulas `d(n) = Π(a_i+1)` and `σ(n) = Π(p_i^{a_i+1}−1)/(p_i−1)` "obviously work" — but *obvious* is not *proven*. This file proves the load-bearing claims:

1. **Closed forms:** the count and sum of divisors equal the stated products, from the divisor characterization.
2. **Multiplicativity:** `d` and `σ` (and every `σ_k`) are multiplicative, proved both by a divisor bijection and structurally via Dirichlet convolution.
3. **Sieve complexity:** the divisor sieve runs in `Θ(N log N)`, derived from `Σ_{i≤N} ⌊N/i⌋ = N·H_N + O(N)` and `H_N = ln N + γ + o(1)`.
4. **Linear-sieve correctness:** the `O(N)` recurrence for `d`/`σ` agrees with the closed forms because each `n` is built once from a finalized smaller value.
5. **Euclid–Euler:** the exact characterization of even perfect numbers via Mersenne primes.
6. **Asymptotics:** the average order of `σ` and `d`, and the extremal `lim sup` behavior.

Throughout, `p, q` denote primes; `a, b, e` exponents; `n = p₁^{a₁} ⋯ p_k^{a_k}` the canonical factorization. Each claim is a lemma/theorem with an explicit proof in the style of an analytic-number-theory text.

---

## Notation and Standing Assumptions

| Symbol | Meaning |
|--------|---------|
| `d(n) = τ(n) = σ₀(n)` | number of positive divisors of `n` |
| `σ(n) = σ₁(n)` | sum of positive divisors of `n` |
| `σ_k(n)` | `Σ_{d∣n} d^k`, sum of `k`-th powers of divisors |
| `s(n) = σ(n) − n` | sum of *proper* divisors |
| `1(n)` | the constant function `1` for all `n` |
| `id(n) = n`, `id_k(n) = n^k` | identity and power functions |
| `ε(n)` | convolution identity: `ε(1)=1`, `ε(n)=0` for `n>1` |
| `μ(n)` | Möbius function |
| `(f * g)(n)` | Dirichlet convolution `Σ_{d∣n} f(d) g(n/d)` |
| `H_N` | `N`-th harmonic number `Σ_{i=1}^{N} 1/i` |
| `γ` | Euler–Mascheroni constant `≈ 0.5772` |

Standing assumptions: variables are positive integers unless noted; "log" is natural log in analytic statements; arithmetic is exact unless a modulus is stated; sums `Σ_{d∣n}` range over positive divisors of `n`.

---

## Foundations: Divisors and Unique Factorization

**Fundamental Theorem of Arithmetic.** Every integer `n > 1` factors uniquely (up to order) as `n = p₁^{a₁} ⋯ p_k^{a_k}` with distinct primes `p_i` and exponents `a_i ≥ 1`. (Proof in topic `03-prime-sieves`, professional level, via Euclid's lemma.) Uniqueness is what makes "the exponent of `p` in `n`" — written `v_p(n)` — well-defined, and divisor functions depend entirely on these exponents.

**Divisor Characterization Lemma.** For `n = p₁^{a₁} ⋯ p_k^{a_k}`, an integer `m ≥ 1` divides `n` **iff** `m = p₁^{b₁} ⋯ p_k^{b_k}` with `0 ≤ b_i ≤ a_i` for every `i`.

*Proof.* (⇐) If `0 ≤ b_i ≤ a_i`, then `n/m = p₁^{a₁−b₁} ⋯ p_k^{a_k−b_k}` is a positive integer, so `m ∣ n`. (⇒) If `m ∣ n`, write `n = m·t`. By unique factorization, the exponent of each prime in `m·t` equals its exponent in `n`; since exponents are nonnegative, the exponent `b_i` of `p_i` in `m` satisfies `0 ≤ b_i ≤ a_i`, and no prime outside `{p_i}` can appear in `m` (it would appear in `n`). ∎

This lemma is the foundation: it sets up divisors as exactly the lattice of exponent vectors `(b₁,…,b_k)` in the box `Π[0, a_i]`. Counting and summing over that box gives the closed forms.

---

## Closed Forms for d and σ

**Theorem (count).** `d(n) = Π_{i=1}^{k} (a_i + 1)`.

*Proof.* By the Divisor Characterization Lemma, divisors of `n` are in bijection with exponent vectors `(b₁,…,b_k)` where each `b_i ∈ {0,1,…,a_i}`. The number of such vectors is the product of the sizes of the independent choice sets: `Π (a_i + 1)`. ∎

**Theorem (sum).** `σ(n) = Π_{i=1}^{k} (1 + p_i + p_i² + … + p_i^{a_i}) = Π_{i=1}^{k} (p_i^{a_i+1} − 1)/(p_i − 1)`.

*Proof.* Sum over the same bijection:

```
σ(n) = Σ_{d∣n} d = Σ_{b₁=0}^{a₁} ⋯ Σ_{b_k=0}^{a_k} (p₁^{b₁} ⋯ p_k^{b_k}).
```

The multi-sum of a product factors into a product of single sums (distributive law / Fubini for finite sums):

```
     = Π_{i=1}^{k} ( Σ_{b_i=0}^{a_i} p_i^{b_i} ) = Π_{i=1}^{k} (1 + p_i + … + p_i^{a_i}).
```

Each inner sum is a finite geometric series: `1 + p + … + p^a = (p^{a+1} − 1)/(p − 1)` for `p ≠ 1`. ∎

**Corollary (`σ_k`).** The identical argument with each divisor `d` replaced by `d^k` (so `p_i^{b_i}` becomes `p_i^{k b_i}`) gives `σ_k(n) = Π (1 + p_i^k + p_i^{2k} + … + p_i^{a_i k}) = Π (p_i^{k(a_i+1)} − 1)/(p_i^k − 1)`. Setting `k = 0` recovers `d`; `k = 1` recovers `σ`. ∎

---

## Multiplicativity, Proved Two Ways

**Definition.** `f` is *multiplicative* if `f(1) = 1` and `f(ab) = f(a)f(b)` whenever `gcd(a,b) = 1`.

**Theorem.** `d`, `σ`, and every `σ_k` are multiplicative.

### Proof 1 — divisor bijection

Let `gcd(a, b) = 1`. **Claim:** the map `φ: (d_a, d_b) ↦ d_a · d_b`, from pairs of divisors `(d_a ∣ a, d_b ∣ b)` to divisors of `ab`, is a bijection.

- *Well-defined and into divisors of `ab`:* if `d_a ∣ a` and `d_b ∣ b` then `d_a d_b ∣ ab`.
- *Surjective:* let `m ∣ ab`. Set `d_a = gcd(m, a)` and `d_b = gcd(m, b)`. Since `gcd(a,b)=1`, the primes of `a` and `b` are disjoint, so `m` splits cleanly: `m = d_a d_b` with `d_a ∣ a`, `d_b ∣ b`. (Formally, for each prime `p`, `v_p(m) ≤ v_p(ab) = v_p(a) + v_p(b)`, and exactly one of `v_p(a), v_p(b)` is nonzero by coprimality, so `v_p(m)` is attributed wholly to `a` or to `b`.)
- *Injective:* if `d_a d_b = d_a' d_b'` with `d_a, d_a' ∣ a` and `d_b, d_b' ∣ b`, then comparing prime exponents on the (disjoint) prime sets of `a` and `b` forces `d_a = d_a'` and `d_b = d_b'`.

Hence divisors of `ab` correspond exactly to pairs `(d_a, d_b)`. Therefore:

```
d(ab) = #{divisors of ab} = #{(d_a,d_b)} = d(a)·d(b).
σ_k(ab) = Σ_{m∣ab} m^k = Σ_{d_a∣a} Σ_{d_b∣b} (d_a d_b)^k
        = (Σ_{d_a∣a} d_a^k)(Σ_{d_b∣b} d_b^k) = σ_k(a)·σ_k(b).
```

The `σ_k` line uses that `(d_a d_b)^k = d_a^k d_b^k` and the distributive law over the disjoint sums. Setting `k=0` gives `d`, `k=1` gives `σ`. And `f(1) = 1` holds for all three (`1` has one divisor, summing to `1`). ∎

### Proof 2 — values on prime powers (structural)

A multiplicative function is determined by `f(p^a)`. We already have `d(p^a) = a+1` and `σ_k(p^a) = (p^{k(a+1)}−1)/(p^k−1)`. For coprime `a = Π p_i^{a_i}`, `b = Π q_j^{b_j}` with disjoint prime sets, `ab`'s factorization is the union, and the closed-form *product over prime powers* splits along that union into the part from `a` times the part from `b`. This *is* `f(ab) = f(a)f(b)`. This view will be made rigorous by the convolution theorem next, which shows multiplicativity without any per-function combinatorics. ∎

---

## Dirichlet Convolution Foundation

**Definition.** For arithmetic functions `f, g`, the **Dirichlet convolution** is `(f * g)(n) = Σ_{d∣n} f(d) g(n/d)`. Convolution is commutative and associative, with identity `ε` (`ε(1)=1`, else `0`).

**Divisor functions as convolutions.**

```
(1 * 1)(n)   = Σ_{d∣n} 1·1       = #divisors        = d(n)        ⇒  d = 1 * 1
(id * 1)(n)  = Σ_{d∣n} (n/d)·1   = Σ_{d∣n} d         = σ(n)        ⇒  σ = id * 1
(id_k * 1)(n)= Σ_{d∣n} (n/d)^k·1 = Σ_{d∣n} d^k       = σ_k(n)      ⇒  σ_k = id_k * 1
```

**Theorem (convolution preserves multiplicativity).** If `f` and `g` are multiplicative, then `f * g` is multiplicative.

*Proof.* Let `gcd(m, n) = 1`. Every divisor of `mn` factors uniquely as `d = d₁ d₂` with `d₁ ∣ m`, `d₂ ∣ n` (the same coprime bijection as above), and correspondingly `mn/d = (m/d₁)(n/d₂)` with `gcd(d₁, d₂) = gcd(m/d₁, n/d₂) = 1`. Then:

```
(f*g)(mn) = Σ_{d∣mn} f(d) g(mn/d)
          = Σ_{d₁∣m} Σ_{d₂∣n} f(d₁d₂) g((m/d₁)(n/d₂))
          = Σ_{d₁∣m} Σ_{d₂∣n} f(d₁)f(d₂) g(m/d₁)g(n/d₂)    [multiplicativity + coprimality]
          = (Σ_{d₁∣m} f(d₁)g(m/d₁)) (Σ_{d₂∣n} f(d₂)g(n/d₂))
          = (f*g)(m) · (f*g)(n).
```

And `(f*g)(1) = f(1)g(1) = 1`. ∎

**Corollary.** Since `1` and `id_k` are completely multiplicative (hence multiplicative), `d = 1*1`, `σ = id*1`, and `σ_k = id_k * 1` are *immediately* multiplicative — Proof 1's combinatorics is unnecessary once this structural theorem is in hand. This is the deep reason divisor functions behave so well.

**The ring of arithmetic functions.** Under pointwise addition and Dirichlet convolution, arithmetic functions form a commutative ring with identity `ε`. A function `f` is invertible iff `f(1) ≠ 0`; the inverse is computed recursively from `(f * f^{-1})(n) = ε(n)`. The multiplicative functions form a subgroup under convolution. This algebraic frame is why "is the convolution of two nice functions still nice?" has a clean yes (the theorem above), and why divisor functions, totients, and the Möbius function all live in one structure rather than being isolated tricks.

**Connection to Möbius inversion (topic `32`).** The Möbius function is the convolution inverse of `1`: `μ * 1 = ε`. Therefore the convolution relations invert:

```
σ = id * 1   ⇒   id = σ * μ,   i.e.   n = Σ_{d∣n} σ(d) μ(n/d).
d = 1 * 1    ⇒   1  = d * μ,    i.e.   [n≥1] folds to identities like Σ_{d∣n} d(d)μ(n/d) = 1.
```

This is the bridge from divisor functions into the Möbius-inversion toolkit; topic `32-mobius-inversion` develops it for counting problems (coprime pairs, squarefree counts, gcd sums).

---

## The O(N log N) Divisor-Sieve Bound

The divisor sieve does, for each `d ∈ [1, N]`, exactly `⌊N/d⌋` inner-loop iterations (striking the multiples `d, 2d, …, ⌊N/d⌋·d`). The total operation count is:

```
T(N) = Σ_{d=1}^{N} ⌊N/d⌋.
```

**Lemma (harmonic estimate).** `Σ_{d=1}^{N} ⌊N/d⌋ = N·H_N + O(N) = N ln N + O(N)`, where `H_N = Σ_{d=1}^{N} 1/d`.

*Proof.* Write `⌊N/d⌋ = N/d − {N/d}` where the fractional part `{N/d} ∈ [0,1)`. Summing:

```
Σ_{d=1}^{N} ⌊N/d⌋ = N Σ_{d=1}^{N} 1/d − Σ_{d=1}^{N} {N/d} = N·H_N − Θ(N),
```

since `0 ≤ Σ {N/d} < N`. By the classical estimate `H_N = ln N + γ + O(1/N)` (compare the sum to `∫₁^N dx/x = ln N`), we get `N·H_N = N ln N + γN + O(1)`. Hence `T(N) = N ln N + O(N) = Θ(N log N)`. ∎

**A combinatorial reading.** `Σ_{d=1}^{N} ⌊N/d⌋` also counts the lattice points `(d, m)` with `d·m ≤ N`, i.e. the number of `(divisor, quotient)` pairs over all `n ≤ N`. Equivalently it equals `Σ_{n=1}^{N} d(n)` — the *total number of divisors* of all numbers up to `N` — because each `n` contributes `d(n)` pairs. So the sieve's running time is literally `Σ_{n≤N} d(n)`, and the harmonic estimate gives the celebrated identity:

```
Σ_{n=1}^{N} d(n) = N ln N + (2γ − 1)N + O(√N)        (Dirichlet, 1849)
```

The leading `N ln N` matches our bound; the sharper `O(√N)` error term is the **Dirichlet divisor problem**, whose optimal exponent is still open (best known error `O(N^{0.314})`, conjectured `O(N^{1/4+ε})`). For the *complexity bound* we only need the leading term: the divisor sieve is `Θ(N log N)`.

**Contrast with the prime sieve.** The prime sieve strides only *primes*, giving `Σ_{p≤N} N/p ≈ N ln ln N`. The divisor sieve strides *every* `d`, giving `Σ_{d≤N} N/d ≈ N ln N`. The extra factor of `ln N / ln ln N` is the price of working with all divisors rather than just prime ones — and is exactly why the **linear sieve** (next section), which visits each `n` once, is asymptotically preferable for large `N`.

**Space.** `Θ(N)` for the output arrays (one or two values per `n`); this is optimal for the full-table problem since the output itself is `Θ(N)` words.

---

## Correctness of the Linear Sieve for d and σ

Recall the linear sieve (topic `03-prime-sieves`, `04-dirichlet-linear-sieve`): it visits each composite `c ≤ N` exactly once, as `c = i · p` where `p = spf(c)` is the smallest prime factor and `i = c/p`. Auxiliary state `cnt[c]` records the exponent of `spf(c)` in `c`. We prove the `d`/`σ` recurrences are correct.

**Setup.** For prime `p`: `d[p] = 2`, `σ[p] = p+1`, `cnt[p] = 1`. For `c = i·p` with `p = spf(c)`:

- **Case A (`p ∤ i`):** `p` is a new smallest prime; `gcd(i, p) = 1`, and `cnt[c] = 1`.
- **Case B (`p ∣ i`):** here `p = spf(i)` too, and `cnt[c] = cnt[i] + 1`.

**Lemma (each `c` is finalized from a smaller, finalized value).** Since `i = c/p < c`, the outer loop processed `i` before `c`, so `d[i]`, `σ[i]`, `cnt[i]` are already correct when `c` is formed. (This is the linear-sieve uniqueness property, proved in topic `03`.) ∎

**Case A correctness.** `c = i·p` with `gcd(i,p)=1`, so by multiplicativity `d(c) = d(i)·d(p) = 2 d(i)` and `σ(c) = σ(i)·σ(p) = (p+1) σ(i)`. ✓ matches the code.

**Case B correctness.** Write `i = p^{e} · u` with `p ∤ u` and `e = cnt[i] ≥ 1`; then `c = p^{e+1} · u`. Using multiplicativity to isolate the `p`-power:

```
d(c) = d(p^{e+1})·d(u) = (e+2)·d(u),   d(i) = (e+1)·d(u)
   ⇒ d(c) = d(i) · (e+2)/(e+1).                          ✓  (= d[i]/(cnt[i]+1)*(cnt[i]+2))

σ(c) = σ(p^{e+1})·σ(u),   σ(i) = σ(p^{e})·σ(u)
   ⇒ σ(c) = σ(i) · σ(p^{e+1})/σ(p^{e}).                  ✓
```

The factor `σ(p^{e+1})/σ(p^{e})` is computed without division by carrying `spp[i] = σ(p^{cnt[i]})` and using the recurrence `σ(p^{e+1}) = 1 + p + … + p^{e+1} = p·σ(p^{e}) + 1`. Then `σ(c) = σ(i)/spp[i]·spp[c]` with `spp[c] = p·spp[i] + 1`. (The single division by `spp[i]` is exact in integers because `spp[i] ∣ σ(i)` — `σ(i) = σ(p^e)·σ(u)`.) ∎

**Complexity.** Each `c` is processed once; each update is `O(1)`. Total `O(N)`. The linear sieve thus removes the `log N` factor of the divisor sieve, at the cost of auxiliary `cnt`/`spp` arrays and less-local memory access (analyzed in `senior.md`). ∎

---

## The Euclid–Euler Perfect-Number Theorem

A number `n` is **perfect** iff `σ(n) = 2n`. The complete classification of *even* perfect numbers is one of the oldest theorems in mathematics.

**Theorem (Euclid, ⇐).** If `2^p − 1` is prime (a Mersenne prime `M_p`), then `n = 2^{p−1}(2^p − 1)` is perfect.

*Proof.* `n = 2^{p−1} · q` with `q = 2^p − 1` prime and `gcd(2^{p−1}, q) = 1`. By multiplicativity:

```
σ(n) = σ(2^{p−1})·σ(q) = (2^p − 1)·(q + 1) = (2^p − 1)·2^p = 2 · 2^{p−1}(2^p − 1) = 2n.
```

Here `σ(2^{p−1}) = 2^p − 1` (geometric series) and `σ(q) = q + 1 = 2^p`. So `σ(n) = 2n`, i.e. `n` is perfect. ∎

**Theorem (Euler, ⇒).** Every *even* perfect number has the form `2^{p−1}(2^p − 1)` with `2^p − 1` prime.

*Proof.* Let `n` be even and perfect. Write `n = 2^{e} · m` with `e ≥ 1` and `m` odd. By multiplicativity, `σ(n) = σ(2^e)·σ(m) = (2^{e+1} − 1)·σ(m)`. Perfection gives `σ(n) = 2n = 2^{e+1} m`. So:

```
(2^{e+1} − 1)·σ(m) = 2^{e+1} m.                                     (★)
```

Since `gcd(2^{e+1} − 1, 2^{e+1}) = 1`, the odd factor `2^{e+1} − 1` divides `m`. Write `m = (2^{e+1} − 1)·M`. Substituting into (★):

```
(2^{e+1} − 1)·σ(m) = 2^{e+1}·(2^{e+1} − 1)·M  ⇒  σ(m) = 2^{e+1}·M = m + M.
```

So `σ(m) = m + M`. But `M ∣ m` and `m ∣ m`, so `m` and `M` are *both* divisors of `m`, summing to `σ(m)`. Since `σ(m)` is the sum of **all** divisors of `m`, the only way two divisors account for the entire sum is if `m` has *exactly* the two divisors `M` and `m` — forcing `M = 1` and `m` prime. Then `m = 2^{e+1} − 1` is a (Mersenne) prime, and `n = 2^e · m = 2^{e}(2^{e+1} − 1)`. Writing `p = e + 1`, `n = 2^{p−1}(2^p − 1)` with `2^p − 1` prime. ∎

**Remark (odd perfect numbers).** Whether any *odd* perfect number exists is open; none is known below `10^{1500}`, and any such number must satisfy stringent conditions (at least 101 prime factors, etc.). The Euclid–Euler theorem settles only the even case.

---

## Asymptotics of σ and d

### Average order of `σ`

**Theorem.** `Σ_{n=1}^{N} σ(n) = (π²/12) N² + O(N log N)`. Equivalently, the *average* of `σ(n)/n` tends to `π²/6 = ζ(2)`.

*Proof sketch.* `Σ_{n≤N} σ(n) = Σ_{n≤N} Σ_{d∣n} d = Σ_{d≤N} d · ⌊N/d⌋` (swap order: divisor `d` contributes `d` to each of its `⌊N/d⌋` multiples). Then:

```
Σ_{d≤N} d·⌊N/d⌋ = Σ_{d≤N} d·(N/d − {N/d}) = N·N − Σ_{d≤N} d·{N/d}.
```

A more careful evaluation (writing `n = d·q` and summing `Σ_{dq≤N} d`) gives `½ Σ_{q≤N} ⌊N/q⌋(⌊N/q⌋+1) = ½ Σ_{q≤N} (N/q)² + O(N log N) = ½ N² Σ_{q≤N} 1/q² + O(N log N)`. Since `Σ_{q=1}^{∞} 1/q² = π²/6`, this is `(π²/12)N² + O(N log N)`. ∎ So `σ(n)` is, *on average*, about `(π²/6)·n ≈ 1.645 n`.

### Extremal order of `σ` (Gronwall)

**Theorem (Gronwall, 1913).** `lim sup_{n→∞} σ(n)/(n ln ln n) = e^{γ}` (`γ` = Euler–Mascheroni constant).

The `lim sup` is attained along highly composite-type numbers (products of the first several primes). This says the *largest* `σ(n)` can be, relative to `n`, grows like `e^γ · n · ln ln n` — extremely slowly. The **Robin inequality** states that `σ(n) < e^γ n ln ln n` for all `n > 5040` *iff the Riemann Hypothesis holds* — tying the extremal behavior of `σ` directly to RH.

### Average and extremal order of `d`

- **Average:** `Σ_{n≤N} d(n) = N ln N + (2γ−1)N + O(√N)` (Dirichlet, proved above), so `d(n)` averages `≈ ln n`.
- **Extremal:** `lim sup_{n→∞} (ln d(n) · ln ln n)/ln n = ln 2`, i.e. the maximal order of `d(n)` is `n^{(ln 2 + o(1))/ln ln n} = 2^{(1+o(1)) ln n / ln ln n}`. Highly composite numbers (topic `middle.md`) realize this growth; `d(n)` is unbounded but grows slower than any positive power of `n`.

These asymptotics explain why, in a `divisor sieve`, the *total* work `Σ d(n) ~ N ln N` is dominated by the many numbers with `d(n) ≈ ln n`, not by the rare highly composite ones — and why `σ` arrays need 64-bit (values up to `~e^γ n ln ln n`) but `d` arrays can be 16-bit (values up to `2^{O(ln n/ln ln n)}`, only ~`1344` for `n ≤ 10^9`).

### Why the average order of `d` is `ln N` (intuition and the hyperbola method)

The estimate `Σ_{n≤N} d(n) ~ N ln N` deserves a second derivation, because the **Dirichlet hyperbola method** that sharpens its error term is a reusable technique. Count the lattice points `(a, b)` with `a, b ≥ 1` and `ab ≤ N` — these are exactly the `(divisor, cofactor)` pairs across all `n ≤ N`, so their count is `Σ_{n≤N} d(n)`. The region `ab ≤ N` is bounded by the hyperbola `b = N/a`. Naively summing over `a` gives `Σ_{a≤N} ⌊N/a⌋ = N ln N + O(N)`.

The hyperbola method exploits the symmetry `a ↔ b`: split the region at the diagonal `a = b = √N`. Points with `a ≤ √N` and points with `b ≤ √N` together cover the whole region but double-count the square `[1,√N]²`. Hence:

```
Σ_{n≤N} d(n) = 2 Σ_{a≤√N} ⌊N/a⌋ − ⌊√N⌋².
```

Each `⌊N/a⌋ = N/a + O(1)`, and `Σ_{a≤√N} 1/a = ½ ln N + γ + O(1/√N)`, so:

```
= 2(N(½ ln N + γ) + O(√N)) − (N + O(√N))
= N ln N + (2γ − 1)N + O(√N).
```

The error drops from `O(N)` (naive) to `O(√N)` because we only sum to `√N` on each side. This is the Dirichlet divisor identity; tightening `O(√N)` below `O(N^{1/3})` is the still-open divisor problem. The method itself — split a convolution sum at `√N` — generalizes to any `Σ_{n≤N}(f*g)(n)` and is the workhorse for sublinear summation of multiplicative functions (used in `tasks.md` Task 13).

### The Riemann-zeta generating identities

Divisor functions have clean **Dirichlet series** (zeta) generating functions, which encode the convolution structure analytically. For `Re(s) > 1`:

```
Σ_{n≥1} d(n)/n^s   = ζ(s)²                  (since d = 1 * 1, and Σ 1/n^s = ζ(s))
Σ_{n≥1} σ(n)/n^s   = ζ(s) ζ(s−1)           (since σ = id * 1)
Σ_{n≥1} σ_k(n)/n^s = ζ(s) ζ(s−k)           (since σ_k = id_k * 1)
```

These follow from the **Euler-product / convolution correspondence**: the Dirichlet series of `f * g` is the product of the Dirichlet series of `f` and of `g`. Because `Σ 1/n^s = ζ(s)` and `Σ n/n^s = Σ 1/n^{s-1} = ζ(s−1)`, the divisor-function series are products of zeta values. The pole of `ζ(s)` at `s = 1` (residue 1) and of `ζ(s−1)` at `s = 2` (residue 1) are what produce, via Perron's formula / a Tauberian argument, the average orders `Σ d(n) ~ N ln N` (double pole of `ζ²` at `s=1`) and `Σ σ(n) ~ (π²/12)N²` (the `ζ(s−1)` pole at `s=2`, with `ζ(2) = π²/6`). The analytic viewpoint unifies all the asymptotics above under the poles of zeta — and is why the divisor problem is connected to deep questions about `ζ`.

---

## Worked Proof Walkthrough

To ground the linear-sieve recurrence, here is the construction filling `d` and `σ` for `n = 12`, annotated with the proof branch (Case A coprime, Case B exponent-raise).

```
n=1:  seed d[1]=1, σ[1]=1
n=2:  prime. d[2]=2, σ[2]=3, cnt[2]=1, spp[2]=3
      inner p=2: 2·2=4, 2%2==0 (Case B, raise exponent):
                 cnt[4]=2, d[4]=d[2]/(1+1)*(1+2)=2/2*3=3,
                 spp[4]=2·spp[2]+1=7, σ[4]=σ[2]/spp[2]*spp[4]=3/3*7=7.  break
n=3:  prime. d[3]=2, σ[3]=4, cnt[3]=1, spp[3]=4
      inner p=2: 3·2=6, 3%2≠0 (Case A, coprime):
                 cnt[6]=1, d[6]=d[3]*2=4, σ[6]=σ[3]*(2+1)=12, spp[6]=3
      inner p=3: 3·3=9, 3%3==0 (Case B): cnt[9]=2, d[9]=2/2*3=3,
                 spp[9]=3·4+1=13, σ[9]=4/4*13=13.  break
n=4:  composite (d[4]=3, σ[4]=7). inner p=2: 4·2=8, 4%2==0 (Case B):
                 cnt[8]=3, d[8]=d[4]/(2+1)*(2+2)=3/3*4=4,
                 spp[8]=2·7+1=15, σ[8]=7/7*15=15.  break
n=5:  prime. d[5]=2, σ[5]=6 ...
n=6:  composite. inner p=2: 6·2=12, 6%2==0 (Case B):
                 cnt[12]=cnt[6]+1=2, d[12]=d[6]/(1+1)*(1+2)=4/2*3=6,
                 spp[12]=2·spp[6]+1=2·3+1=7, σ[12]=σ[6]/spp[6]*spp[12]=12/3*7=28.  break
```

Final (indices 1..12): `d = [_,1,2,2,3,2,4,2,4,3,4,2,6]`, `σ = [_,1,3,4,7,6,12,8,15,13,18,12,28]`.

Cross-check against the closed forms: `d(12) = (2+1)(1+1) = 6` ✓, `σ(12) = (1+2+4)(1+3) = 7·4 = 28` ✓, `d(8) = 3+1 = 4` ✓, `σ(8) = 1+2+4+8 = 15` ✓, `σ(9) = 1+3+9 = 13` ✓. Note `12` was filled at `n=6, p=2` (Case B), *not* at `n=4, p=3` — the linear-sieve break prevents the latter, which is exactly the uniqueness guarantee. Every value was computed once, from an already-finalized smaller value.

---

## Structure of Abundant and Deficient Numbers

The abundancy index `h(n) = σ(n)/n` controls perfection (`h=2`), abundance (`h>2`), and deficiency (`h<2`). Because `σ` is multiplicative and `id` is, `h` is multiplicative: `h(n) = Π_{p^a ∥ n} σ(p^a)/p^a = Π_{p^a ∥ n} (1 + 1/p + 1/p² + … + 1/p^a)`. Several structural facts follow directly.

**Lemma (a multiple of an abundant number is abundant).** If `m` is abundant and `m ∣ N`, then `N` is abundant.

*Proof.* For any `m ∣ N`, the divisors of `m` are a subset of the divisors of `N`, and more sharply, `σ(N)/N ≥ σ(m)/m` because each divisor `d ∣ m` contributes `d/m` to `h(m)` and the divisor `(N/m)·d ∣ N` contributes `(N/m·d)/N = d/m` to `h(N)` — so `h(N) ≥ h(m) > 2`. Hence `N` is abundant. ∎ This is why abundant numbers are *dense*: every multiple of `12, 18, 20, …` is abundant, so abundance propagates upward through divisibility.

**Lemma (prime powers are deficient).** `h(p^a) = 1 + 1/p + … + 1/p^a < 1/(1 − 1/p) = p/(p−1) ≤ 2`.

*Proof.* The finite geometric sum is bounded by its infinite tail `Σ_{k≥0} p^{-k} = p/(p−1)`, which is `≤ 2` for all primes `p ≥ 2` (with equality only in the limit `p=2, a→∞`). So no prime power is abundant or perfect; in fact `h(2^a) = 2 − 2^{-a} < 2` shows powers of two are the "most abundant" prime powers yet still deficient. ∎ This is the structural reason perfect numbers need at least two distinct prime factors, and why Euler's theorem pins even perfect numbers to the form `2^{p−1}·(2^p−1)` — a power of two times a *single* extra prime.

**Quasi-perfect and multiply perfect numbers.** Generalizing `σ(n) = 2n`: a number with `σ(n) = kn` is *`k`-perfect* (or multiply perfect). `120` is 3-perfect (`σ(120) = 360`); `30240` is 4-perfect. Whether any *quasi-perfect* number (`σ(n) = 2n + 1`) exists is open, like odd perfect numbers. These generalizations are all decided by the same multiplicative `σ` formula evaluated on the factorization.

---

## Correctness of the O(N log N) Divisor Sieve

We prove the simple divisor sieve produces correct `d` and `σ` arrays, complementing the linear-sieve proof above.

**Procedure.** Initialize `cnt[m] = 0`, `sm[m] = 0` for all `m`. For `div = 1, 2, …, N`, for each multiple `m = div, 2·div, …, ⌊N/div⌋·div`, perform `cnt[m] += 1` and `sm[m] += div`.

**Theorem.** After the procedure, `cnt[m] = d(m)` and `sm[m] = σ(m)` for all `1 ≤ m ≤ N`.

*Proof.* Fix `m`. The pairs `(div, m)` for which the inner loop touches `m` are exactly those with `div ∣ m` (since `m` is reached when iterating multiples of `div` iff `m` is a multiple of `div`). Each such `div` touches `m` **exactly once** (the multiples of `div` are distinct). Therefore:

```
cnt[m] = Σ_{div ∣ m} 1 = #{divisors of m} = d(m).
sm[m]  = Σ_{div ∣ m} div = σ(m).
```

Both sums range over precisely the divisors of `m`, each contributing once. ∎

**Invariant view.** Before processing `div = k`, the invariant is: `cnt[m]` counts the divisors of `m` that are `< k`, and `sm[m]` sums them. Processing `div = k` adds `1` and `k` to every multiple of `k`, i.e. to every `m` having `k` as a divisor — preserving the invariant with `k` now included. After `div = N`, all divisors `≤ N` (hence all divisors, since divisors of `m ≤ N` are `≤ m ≤ N`) are accounted for. ∎

The key subtlety versus the linear sieve: here each `m` is touched `d(m)` times (once per divisor), summing to `Σ d(m) = Θ(N log N)` total touches; the linear sieve touches each `m` exactly once, giving `Θ(N)` but requiring the exponent-tracking recurrence. The trade is *simplicity and cache locality* (divisor sieve) versus *asymptotic optimality* (linear sieve).

---

## Why the Geometric-Sum Recurrence Is Exact in Integers

The linear-sieve `σ` update divides: `σ[c] = σ[i] / spp[i] * spp[c]`. For this to be valid in integer arithmetic, `spp[i]` must divide `σ[i]` exactly.

**Lemma.** In the linear sieve, `spp[i] = σ(p^e)` (where `p = spf(i)`, `e = cnt[i]`) always divides `σ[i]`.

*Proof.* Write `i = p^e · u` with `p ∤ u`. By multiplicativity, `σ(i) = σ(p^e)·σ(u) = spp[i]·σ(u)`. So `spp[i] ∣ σ(i)` with exact quotient `σ(u)`. The update `σ[c] = σ[i]/spp[i]·spp[c] = σ(u)·σ(p^{e+1}) = σ(u)·spp[c]` is therefore an exact integer computation equal to `σ(p^{e+1})·σ(u) = σ(c)`. ∎

This is why the division-based linear-sieve recurrence is safe in `int64` *without* a modular inverse — a subtlety that does **not** transfer to the modular setting (where you must instead accumulate the geometric sum by repeated addition, as `senior.md` warns). Under a prime modulus `M`, `spp[i] mod M` need not divide `σ[i] mod M`, so the integer-exactness argument fails and you switch to addition-based accumulation.

---

## Numerical Sanity Checks

| Quantity | Value | Check |
|----------|-------|-------|
| `d(1)`, `σ(1)` | 1, 1 | empty product |
| `d(12)` | 6 | `(2+1)(1+1)` for `2²·3` |
| `σ(12)` | 28 | `7·4` |
| `d(360)` | 24 | `(3+1)(2+1)(1+1)` for `2³·3²·5` |
| `σ(360)` | 1170 | `15·13·6` |
| `σ(6)` | 12 = 2·6 | perfect: `σ(n)=2n` |
| `σ(28)` | 56 = 2·28 | perfect |
| `σ(496)` | 992 = 2·496 | perfect (`2⁴·31`, `31=2⁵−1` Mersenne) |
| `s(220), s(284)` | 284, 220 | amicable pair |
| `Σ_{d∣n} d(d) μ(n/d)` | `1` | from `d = 1*1`, `μ*1=ε` |
| `id = σ * μ` at `n=12` | `12` | `Σ σ(d)μ(12/d) = σ(12)−σ(6)−σ(4)+σ(2)... ` |
| `Σ_{n≤100} d(n)` | 482 | `≈ 100 ln 100 + (2γ−1)100 ≈ 460 + 15` |
| `Σ_{n≤100} σ(n)` | 8299 | `≈ (π²/12)·100² ≈ 8225` |
| `σ₂(6)` | 50 | `1+4+9+36` |
| `Σ d(n)/n^s` | `ζ(s)²` | `d = 1*1` |
| `Σ σ(n)/n^s` | `ζ(s)ζ(s−1)` | `σ = id*1` |
| `h(12) = σ(12)/12` | `28/12 ≈ 2.33` | abundant (`h > 2`) |
| `h(2^a) = 2 − 2^{-a}` | `< 2` | powers of two are deficient |
| lim sup `σ(n)/(n ln ln n)` | `e^γ ≈ 1.781` | Gronwall |

These identities are excellent regression tests: any divisor-function implementation that violates one has a bug. A practical CI strategy asserts the closed forms and convolution identities for every `n ≤ 10^4` against both the sieved values and a direct trial-division computation; a discrepancy localizes the bug to a specific `n`.

The zeta identities (`Σ d/n^s = ζ²`, `Σ σ/n^s = ζ(s)ζ(s−1)`) are not directly testable on a finite array, but their *consequences* are: the partial sums `Σ_{n≤N} d(n)` and `Σ_{n≤N} σ(n)` must track `N ln N` and `(π²/12)N²` respectively, which the table above checks at `N = 100`. A divisor-function implementation whose partial sums drift from these asymptotics has a systematic (not one-off) bug — typically an exponent or overflow error affecting a whole residue class.

### Verifying `id = σ * μ` at `n = 12`

The divisors of `12` are `1,2,3,4,6,12`. Then `Σ_{d∣12} σ(d)·μ(12/d)`:

```
d=1:  σ(1)μ(12)  = 1·0   = 0      (12 = 2²·3, square factor ⇒ μ=0)
d=2:  σ(2)μ(6)   = 3·1   = 3      (6 = 2·3, two primes ⇒ μ=+1)
d=3:  σ(3)μ(4)   = 4·0   = 0      (4 = 2², μ=0)
d=4:  σ(4)μ(3)   = 7·(−1)= −7
d=6:  σ(6)μ(2)   = 12·(−1)=−12
d=12: σ(12)μ(1)  = 28·1  = 28
sum = 0+3+0−7−12+28 = 12 = id(12)   ✓
```

This confirms the Möbius-inverse relation `id = σ * μ` numerically — a joint regression test on `σ` and `μ` (topic `32-mobius-inversion`).

---

## Further Theoretical Notes

### `σ_k` and the Jordan totient family

The convolution view places `d` and `σ` in a wider lattice of arithmetic functions. Besides `σ_k = id_k * 1`, the **Jordan totient** `J_k = id_k * μ` generalizes Euler's `φ = J_1`, and the identities `J_k * 1 = id_k` mirror `φ * 1 = id`. All are multiplicative because they are convolutions of multiplicative functions. The unifying picture: the multiplicative functions form a commutative ring under pointwise addition and Dirichlet convolution, with `ε` the multiplicative identity and `μ` the convolution inverse of `1`. Divisor functions are simply the "`* 1`" image of the power functions `id_k`, and Möbius inversion is multiplication by `μ` — a single algebraic structure underlying topics `31` (this) and `32-mobius-inversion`.

### A subtlety: `σ` is *not* completely multiplicative

It is worth pinning down precisely why `σ(ab) = σ(a)σ(b)` *fails* for non-coprime `a, b`. Consider `a = b = 2`: `σ(4) = 7` but `σ(2)σ(2) = 9`. The bijection in Proof 1 relied on the prime sets of `a` and `b` being **disjoint**; when they overlap, a divisor like `2` of `ab = 4` arises from *multiple* pairs (`(1,2)` and `(2,1)`), breaking injectivity. The exponent on a shared prime does not "split" cleanly. This is exactly why the linear sieve needs a separate *exponent-raise* branch (Case B): when `p ∣ i`, the factor `p` is *not* coprime to `i`, so naive multiplication `σ(i)·σ(p)` would be wrong, and we must instead replace the smallest-prime power's contribution. The failure of complete multiplicativity is not a nuisance; it is the structural fact the algorithm is built around.

### Comparison table: divisor-function computation methods

| Method | Time (per scope) | Space | Exactness | Best for |
|--------|------------------|-------|-----------|----------|
| Naive walk `1..n` | `O(n)` | `O(1)` | exact | one tiny `n` |
| Pair walk `1..√n` | `O(√n)` | `O(1)` | exact | one moderate `n`, no factor needed |
| Factor + closed form | `O(√n)` | `O(log n)` | exact | one `n` you can factor |
| Divisor sieve | `Θ(N log N)` | `Θ(N)` | exact | all `n ≤ N`, simple/cache-friendly |
| Linear sieve | `Θ(N)` | `Θ(N)` | exact | all `n ≤ N`, large `N` or with φ/μ |
| Hyperbola sum | `O(√N)` | `O(1)` | exact | only `Σ_{n≤N} d(n)` or `Σ σ(n)` |
| Per-query factor (huge `N`) | `O(√n)`/query | `O(√N)` | exact | sparse queries over huge range |

The right column is the senior decision tree restated as a theorem-backed table: each row's complexity is *proved* in this file (closed form, `N log N` bound, linear-sieve `O(N)`) or in the cited siblings (hyperbola in `tasks.md` Task 13, per-query in `senior.md`).

---

## Summary

Divisor functions rest on the **Divisor Characterization Lemma**: divisors of `n = Π p_i^{a_i}` are exactly the exponent vectors in the box `Π[0, a_i]`. Counting that box gives `d(n) = Π(a_i+1)`; summing it (distributive law) gives `σ(n) = Π(1+p_i+…+p_i^{a_i})` and the general `σ_k`. Both are **multiplicative**, provable by a coprime divisor bijection or — more deeply — because they are Dirichlet convolutions (`d = 1*1`, `σ = id*1`, `σ_k = id_k*1`) and convolution preserves multiplicativity; the same convolution structure, with `μ*1 = ε`, yields the Möbius inversions `id = σ*μ` (topic `32`). The divisor sieve runs in `Θ(N log N)` because `Σ_{d≤N}⌊N/d⌋ = N·H_N + O(N) ~ N ln N` — which is literally `Σ_{n≤N} d(n)`, the Dirichlet divisor sum. The linear sieve achieves `Θ(N)` by building each `n` once from a finalized smaller value, with `d`/`σ` recurrences split into a coprime case (multiplicativity) and an exponent-raise case (using `σ(p^{e+1}) = p·σ(p^e)+1`). Perfect numbers are exactly characterized in the even case by **Euclid–Euler** (`2^{p−1}(2^p−1)` with `2^p−1` Mersenne prime). Finally, `σ` averages `≈ (π²/6)n` with extremal order `e^γ n ln ln n` (Gronwall, tied to RH via Robin's inequality), while `d` averages `≈ ln n` with maximal order `2^{(1+o(1))ln n/ln ln n}` — the asymptotic justification for 64-bit `σ` arrays and 16-bit `d` arrays.

Next step: continue to [`interview.md`](./interview.md) — tiered Q&A and a divisor-function coding challenge in Go, Java, and Python.

---

## Appendix: The Four Central Theorems at a Glance

For quick reference, the load-bearing results proved in this file:

1. **Closed forms.** `d(n) = Π(a_i+1)` (count the exponent box) and `σ(n) = Π(1+p_i+…+p_i^{a_i}) = Π(p_i^{a_i+1}−1)/(p_i−1)` (sum it via distributivity); `σ_k` generalizes with `p^k`.
2. **Multiplicativity.** `d`, `σ`, `σ_k` satisfy `f(ab)=f(a)f(b)` for `gcd(a,b)=1` — via the coprime divisor bijection, or structurally because they are Dirichlet convolutions (`d=1*1`, `σ=id*1`, `σ_k=id_k*1`) and convolution preserves multiplicativity.
3. **Sieve complexity.** The divisor sieve is `Θ(N log N)` because `Σ_{d≤N}⌊N/d⌋ = N·H_N + O(N) ~ N ln N = Σ_{n≤N} d(n)`; the linear sieve is `Θ(N)` by building each `n` once from a finalized smaller value with the exponent-raise recurrence.
4. **Euclid–Euler.** Even perfect numbers are exactly `2^{p−1}(2^p−1)` with `2^p−1` a Mersenne prime.

Plus the supporting results: the Divisor Characterization Lemma, the convolution-preserves-multiplicativity theorem, the integer-exactness of the linear-sieve `σ` division, the structural lemmas on abundance and deficiency, the zeta generating identities `Σ d/n^s = ζ²`, `Σ σ/n^s = ζ(s)ζ(s−1)`, and the average/extremal orders of `d` and `σ`.

## A Note on Correctness Under Bounded Arithmetic

The proofs above assume exact integer arithmetic. In implementation, overflow can break the *theorems* even when the *code* compiles:

- **`σ` overflow:** the recurrences are valid over ℤ, but a 32-bit `σ` array silently wraps, so the computed values no longer equal the proven `σ(n)`. Widen to 64-bit; for range sums use big integers or a modulus.
- **Linear-sieve division under a modulus:** the exactness lemma (`σ(p^e) ∣ σ(i)`) holds in ℤ but *not* in ℤ/Mℤ, so the division-based recurrence is invalid mod `M` — switch to addition-based geometric-sum accumulation.

Neither is a flaw in the mathematics; both are reminders that the proofs hold only when the machine faithfully represents the integers the proofs reason about — which is why `senior.md` cross-checks against brute force over a dense range.

---

## Further Reading

- Apostol, *Introduction to Analytic Number Theory* — Chapters 2–3 (arithmetic functions, Dirichlet convolution, averages of `d` and `σ`).
- Hardy & Wright, *An Introduction to the Theory of Numbers* — divisor functions, perfect numbers, the order of `d(n)` and `σ(n)`.
- Sibling file [`middle.md`](./middle.md) — multiplicativity intuition, perfect/abundant/amicable numbers, convolution overview.
- Sibling file [`senior.md`](./senior.md) — the linear-sieve implementation whose correctness is proved here.
- Sibling topic `32-mobius-inversion` — the convolution-inversion machinery (`μ*1=ε`, `id = σ*μ`).
- Sibling topic `03-prime-sieves` (professional) — unique factorization and linear-sieve uniqueness, used as lemmas here.
- Gronwall (1913) and Robin (1984) — extremal order of `σ` and its equivalence to the Riemann Hypothesis.
- Tenenbaum, *Introduction to Analytic and Probabilistic Number Theory* — Dirichlet series, the divisor problem, and average orders via contour methods.
- Dirichlet (1849) — the divisor sum `Σ_{n≤N} d(n)` and the hyperbola method, the historical root of the `O(N log N)` analysis.
- Sibling file [`interview.md`](./interview.md) — the proof questions in this file restated as interview prompts with concise model answers.
- Sibling file [`tasks.md`](./tasks.md) — Task 13 (hyperbola method) and Task 14 (Robin's inequality probe) turn these theorems into runnable exercises.
