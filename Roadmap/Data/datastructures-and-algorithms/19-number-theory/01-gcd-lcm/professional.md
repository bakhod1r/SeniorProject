# GCD and LCM — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Euclidean Recurrence (Proof of `gcd(a,b)=gcd(b, a mod b)`)
3. Termination and the Well-Ordering Argument
4. The O(log) Bound and Lamé's Theorem (Fibonacci Worst Case)
5. Bezout's Identity and the Extended Algorithm
6. GCD as the Generator of the Ideal `aℤ + bℤ`
7. The Identity `gcd·lcm = |a·b|`
8. Binary GCD: Correctness Proof
9. Properties: Distributivity, Multiplicativity, Coprimality
10. Divisibility, Primes, and the Fundamental Theorem
11. Generalization to Euclidean Domains
12. Summary

---

## 1. Formal Definitions

Work in the ring of integers `ℤ`.

**Definition 1.1 (Divisibility).** For `a, b ∈ ℤ`, `a` **divides** `b` (written `a | b`) if there exists `k ∈ ℤ` with `b = a·k`. Note `a | 0` for every `a` (take `k = 0`), and `0 | b` only if `b = 0`.

**Definition 1.2 (Greatest common divisor).** For `a, b ∈ ℤ` not both zero, `gcd(a, b)` is the unique non-negative integer `g` such that (i) `g | a` and `g | b`, and (ii) every common divisor `d` of `a` and `b` satisfies `d | g`. We set `gcd(0, 0) = 0`.

Condition (ii) is stronger than "g is the numerically largest common divisor"; it says `g` is greatest **in the divisibility order**. For integers the two notions coincide (when not both zero), but the divisibility formulation is the one that generalizes (Section 11) and that makes the proofs clean.

**Definition 1.3 (Least common multiple).** For `a, b ∈ ℤ`, `lcm(a, b)` is the unique non-negative integer `m` such that (i) `a | m` and `b | m`, and (ii) every common multiple `c` of `a` and `b` satisfies `m | c`. We set `lcm(a, 0) = lcm(0, b) = 0`.

**Definition 1.4 (Coprime).** `a` and `b` are **relatively prime** (coprime) if `gcd(a, b) = 1`.

**Notation conventions.** Throughout, `a = q·b + r` denotes the division algorithm with `q = ⌊a/b⌋` and unique remainder `0 ≤ r < |b|` for `b ≠ 0`. `F_n` is the `n`-th Fibonacci number (`F_0 = 0, F_1 = 1`), `φ = (1+√5)/2` the golden ratio, and `aℤ = {a·k : k ∈ ℤ}` the set (ideal) of multiples of `a`. The Iverson bracket `[P]` is `1` if `P` holds else `0`. "Divides" always means Definition 1.1; "greatest" in Definition 1.2 means greatest in the divisibility partial order. We write `M(n)` for the bit-cost of multiplying two `n`-bit integers, and `ρ(·)` is reserved for spectral radius in sibling topics (not used here).

**The division algorithm (Theorem 1.5).** For integers `a` and `b ≠ 0`, there exist *unique* integers `q, r` with `a = q·b + r` and `0 ≤ r < |b|`. *Existence:* take `q = ⌊a/|b|⌋·sign(b)` and `r = a − q·b`. *Uniqueness:* if `a = q·b + r = q'·b + r'` with both remainders in `[0, |b|)`, then `(q − q')·b = r' − r`, whose right side has absolute value `< |b|` while the left is a multiple of `|b|`, forcing both to be `0`. This unique-remainder fact is the bedrock under every theorem below — the Euclidean step `a mod b` is *well-defined* precisely because `r` is unique.

**Remark (uniqueness).** The GCD is unique *because* we require it non-negative: if `g` and `g'` both satisfy Definition 1.2, then `g | g'` and `g' | g`, forcing `g = ±g'`, and non-negativity pins the sign. This is why we standardize on `gcd ≥ 0`. The same divisibility-order uniqueness applies to the LCM (Definition 1.3): condition (ii) — *every* common multiple is a multiple of `m` — is strictly stronger than "numerically smallest", and it is what makes `lcm` the lattice join (Section 10.1) rather than merely a minimum. For example, the common multiples of `4` and `6` are `12, 24, 36, …`; `12` is least *and* divides all the others, satisfying (ii). Were we to define LCM only as "numerically smallest positive common multiple", the two definitions would still coincide for integers, but the divisibility-order form is the one that generalizes to rings where "smallest" is undefined.

**Why both definitions matter.** Definition 1.2's clause (ii) (`d | g` for every common divisor `d`) is what we actually *use* in every proof — Theorem 2.1, Bezout, and the ideal-generator theorem all reason about divisibility, never about numerical size. The "numerically greatest" intuition is a helpful mnemonic but a weaker statement; the divisibility-order definition is the load-bearing one, and conflating the two is the subtle gap that the abstract (Euclidean-domain) generalization in Section 11 exposes.

---

## 2. The Euclidean Recurrence

The entire algorithm is a single theorem.

**Theorem 2.1.** For integers `a, b` with `b ≠ 0`, writing `a = q·b + r` (so `r = a mod b`),

```
gcd(a, b) = gcd(b, r) = gcd(b, a mod b).
```

**Proof.** It suffices to show that the **set of common divisors** of `(a, b)` equals the set of common divisors of `(b, r)`; the greatest element (Definition 1.2) is then necessarily the same.

(⊆) Let `d` be a common divisor of `a` and `b`, so `d | a` and `d | b`. Then `d | (a − q·b)` because `a − q·b` is an integer combination of `a` and `b` (if `a = d·s` and `b = d·t`, then `a − q·b = d·(s − q·t)`). But `a − q·b = r`, so `d | r`. Hence `d` is a common divisor of `b` and `r`.

(⊇) Conversely, let `d` be a common divisor of `b` and `r`, so `d | b` and `d | r`. Then `d | (q·b + r)` for the same reason, and `q·b + r = a`, so `d | a`. Hence `d` is a common divisor of `a` and `b`.

The two sets of common divisors are equal; therefore their greatest elements are equal: `gcd(a, b) = gcd(b, r)`. ∎

**Corollary 2.2 (Base case).** `gcd(a, 0) = |a|`. The common divisors of `a` and `0` are exactly the divisors of `a` (since every integer divides `0`), whose greatest is `|a|`.

**Remark.** Theorem 2.1 plus Corollary 2.2 *is* the Euclidean algorithm: repeatedly apply 2.1 to shrink the second argument until it is `0`, then read off `|a|`. Every line of the algorithm is justified by exactly these two facts; the rest is bookkeeping.

### 2.1 Worked Verification

Compute `gcd(1071, 462)`:

```
1071 = 2·462 + 147   → gcd(1071, 462) = gcd(462, 147)
 462 = 3·147 +  21   → gcd(462, 147)  = gcd(147, 21)
 147 = 7· 21 +   0   → gcd(147, 21)   = gcd(21, 0) = 21
```

By Theorem 2.1 each arrow preserves the GCD; by Corollary 2.2 the final `gcd(21, 0) = 21`. Direct check: `1071 = 21·51`, `462 = 21·22`, and `gcd(51, 22) = 1`, so `21` is indeed the greatest common divisor.

**Invariance of the common-divisor set, made concrete.** The common divisors of `(1071, 462)` are exactly the divisors of `21`: `{1, 3, 7, 21}`. After the first step `(462, 147)`, the common divisors are still `{1, 3, 7, 21}` — the set is *literally unchanged*, not merely the maximum. This is the operational meaning of Theorem 2.1: each line of the algorithm replaces the pair with a smaller one having the *same* common-divisor set, so the greatest element is preserved automatically. Tracking the set (not just its max) makes the proof's claim visible and is a useful debugging lens — if an implementation's intermediate pair has a different common-divisor set, the bug is a misplaced quotient or remainder.

---

## 3. Termination and the Well-Ordering Argument

**Theorem 3.1.** The Euclidean algorithm terminates after finitely many steps.

**Proof.** Let the sequence of second arguments be `b = r₀ > r₁ > r₂ > …`, where `r_{i+1} = r_{i-1} mod r_i`. By the division algorithm, `0 ≤ r_{i+1} < r_i`, so the sequence is **strictly decreasing** and bounded below by `0`. A strictly decreasing sequence of non-negative integers is finite (the well-ordering principle: a non-empty set of non-negative integers has a least element, which the sequence must reach). Hence some `r_m = 0`, at which point the algorithm halts and returns `r_{m-1}`. ∎

**Corollary 3.2.** The returned value `r_{m-1}` equals `gcd(a, b)`. By Theorem 2.1 applied at each step, `gcd(a, b) = gcd(r₀, r₁) = … = gcd(r_{m-1}, r_m) = gcd(r_{m-1}, 0) = r_{m-1}`. ∎

This is a textbook instance of proving termination via a **monovariant** (the strictly decreasing remainder) — the same technique used to prove termination of many recursive algorithms.

**Worked decreasing sequence.** For `gcd(1071, 462)` the second-argument sequence is `462, 147, 21, 0`: strictly decreasing, bounded below by `0`, reaching `0` in three steps. Contrast a *subtractive* variant `gcd(a, b) = gcd(a − b, b)`: its monovariant is `a + b`, which decreases by only `b` per step — for `gcd(10^9, 1)` that is a billion steps. Both terminate (both have a valid monovariant), but only the mod-based version decreases the monovariant *geometrically* (Lemma 4.1), which is the difference between `O(log)` and `O(max)`. Termination and *efficiency* are distinct properties proven by distinct arguments: well-ordering gives the former, the halving lemma the latter.

---

## 4. The O(log) Bound and Lamé's Theorem

Termination is not enough; we want *fast* termination. The key is that the remainder doesn't merely decrease — it decreases geometrically.

**Lemma 4.1 (Two-step halving).** For three consecutive remainders `r_{i-1} > r_i > r_{i+1}` in the Euclidean sequence, `r_{i+1} < r_{i-1} / 2`.

**Proof.** `r_{i+1} = r_{i-1} mod r_i = r_{i-1} − ⌊r_{i-1}/r_i⌋·r_i`. Two cases:
- If `r_i ≤ r_{i-1}/2`, then `r_{i+1} < r_i ≤ r_{i-1}/2`.
- If `r_i > r_{i-1}/2`, then `⌊r_{i-1}/r_i⌋ = 1`, so `r_{i+1} = r_{i-1} − r_i < r_{i-1} − r_{i-1}/2 = r_{i-1}/2`.

Either way `r_{i+1} < r_{i-1}/2`. ∎

**Theorem 4.2 (Logarithmic step count).** The Euclidean algorithm on inputs `a ≥ b > 0` performs `O(log b)` division steps.

**Proof.** By Lemma 4.1, every two steps reduce the value by more than half. After `2t` steps the remainder is below `b / 2^t`. The algorithm stops when the remainder hits `0`, which must happen by the time `b / 2^t < 1`, i.e. `t > log₂ b`. Hence the number of steps is at most `2 log₂ b + O(1) = O(log b)`. ∎

### 4.1 Lamé's Theorem — the Fibonacci worst case

The bound above is tight, and the extremal inputs are the **Fibonacci numbers**.

**Theorem 4.3 (Lamé, 1844).** For `n ≥ 1`, if the Euclidean algorithm requires exactly `n` division steps for some pair `a > b > 0`, then `a ≥ F_{n+2}` and `b ≥ F_{n+1}`, where `F_k` is the `k`-th Fibonacci number. Equivalently, the pair `(F_{n+2}, F_{n+1})` requires exactly `n` steps and is the **smallest** pair forcing `n` steps.

**Proof (induction on `n`).** *Base `n = 1`:* one step requires `b > 0`, so `b ≥ 1 = F_2` and `a ≥ b+0`... more precisely the smallest one-step pair is `(2, 1) = (F_3, F_2)`. *Inductive step:* suppose any pair needing `n−1` steps has `a' ≥ F_{n+1}`, `b' ≥ F_n`. A pair `(a, b)` needing `n` steps reduces in one step to `(b, a mod b)`, which needs `n−1` steps, so `b ≥ F_{n+1}` and `a mod b ≥ F_n`. Since `a = q·b + (a mod b) ≥ b + (a mod b) ≥ F_{n+1} + F_n = F_{n+2}` (using `q ≥ 1` because `a > b`), we get `a ≥ F_{n+2}`. The Fibonacci pair achieves equality: `gcd(F_{n+2}, F_{n+1})` takes exactly `n` steps because `F_{n+2} = 1·F_{n+1} + F_n`, peeling one Fibonacci index per step. ∎

**Corollary 4.4 (Exact constant).** Since `F_k ∼ φ^k / √5` with `φ = (1+√5)/2`, the number of steps for inputs bounded by `N` is at most `⌊log_φ(√5 · N)⌋ ≈ 1.4404 · log₂ N + O(1)`. So the worst case is about `1.44 log₂ N` divisions — the constant in the `O(log)` bound, achieved by consecutive Fibonacci numbers.

**Worked instance.** `gcd(F_9, F_8) = gcd(34, 21)`:

```
34 = 1·21 + 13   (= F_7)
21 = 1·13 +  8   (= F_6)
13 = 1· 8 +  5   (= F_5)
 8 = 1· 5 +  3   (= F_4)
 5 = 1· 3 +  2   (= F_3)
 3 = 1· 2 +  1   (= F_2)
 2 = 2· 1 +  0
```

Seven steps for inputs `≤ 34`, each quotient `1` (the slowest possible), each remainder the previous Fibonacci number — the algorithm crawls down the Fibonacci sequence one index at a time. Every quotient being `1` is precisely what makes Fibonacci pairs worst-case: a larger quotient would skip indices and finish sooner.

### 4.2 The Continued-Fraction Connection

The sequence of quotients `q₁, q₂, …, q_m` produced by the Euclidean algorithm on `(a, b)` is exactly the **continued-fraction expansion** of `a / b`:

```
a / b = q₁ + 1 / (q₂ + 1 / (q₃ + … + 1/q_m))  =  [q₁; q₂, …, q_m].
```

For `48 / 18`: the quotients are `2, 1, 2` (from `48 = 2·18 + 12`, `18 = 1·12 + 6`, `12 = 2·6 + 0`), so `48/18 = [2; 1, 2] = 2 + 1/(1 + 1/2) = 8/3`, the reduced fraction. This is why the **number of Euclidean steps equals the length of the continued fraction**, and why Fibonacci pairs — whose continued fraction is all `1`s (`[1; 1, 1, …]`, the expansion of `φ`) — are extremal: the golden ratio has the "most irrational" (slowest-converging) continued fraction, so its rational truncations (Fibonacci ratios) cost the most steps. The connection ties the complexity analysis (Lamé) directly to the metric theory of continued fractions, and is the reason the extended algorithm's convergents `p_i / q_i` are the best rational approximations to `a/b`.

**Khinchin's perspective.** Averaged over random inputs, the *expected* number of Euclidean steps is `≈ (12 ln 2 / π²) ln b ≈ 0.843 · log₂ b` (a result of the metric theory of continued fractions), well below the worst-case `1.44 log₂ b`. So typical inputs run noticeably faster than the Fibonacci worst case — the average and worst cases differ by a constant factor, both logarithmic.

### 4.3 Worst-Case Step Table

The Fibonacci pairs realize the maximum step count for each input magnitude:

| Fibonacci pair `(F_{n+2}, F_{n+1})` | value bound | steps `n` | `1.44 log₂ F_{n+2}` |
|-------------------------------------|-------------|-----------|----------------------|
| `(5, 3)` | < 8 | 3 | ≈ 3.3 |
| `(13, 8)` | < 16 | 5 | ≈ 5.3 |
| `(89, 55)` | < 128 | 9 | ≈ 9.1 |
| `(10946, 6765)` | < 2^14 | 19 | ≈ 19.2 |
| `(F_{88}, F_{87})` | < 2^61 | 85 | ≈ 86 |

The observed step count `n` tracks `1.44 log₂(value)` exactly, confirming Corollary 4.4's constant. No pair below each value bound exceeds the corresponding `n` — that is the content of Lamé's theorem. For 64-bit inputs the worst case is thus under ~90 divisions, the practical guarantee behind "GCD is instant."

---

## 5. Bezout's Identity and the Extended Algorithm

**Theorem 5.1 (Bezout's identity).** For integers `a, b` not both zero, there exist integers `x, y` with

```
a·x + b·y = gcd(a, b),
```

and `gcd(a, b)` is the **smallest positive** integer expressible as `a·x + b·y`.

**Proof.** Let `S = { a·x + b·y : x, y ∈ ℤ, a·x + b·y > 0 }`. `S` is non-empty (it contains `|a|` or `|b|`), so by well-ordering it has a least element `d = a·x₀ + b·y₀`. We show `d = gcd(a, b)`.

First, `d | a`: divide `a = q·d + r` with `0 ≤ r < d`. Then `r = a − q·d = a − q(a·x₀ + b·y₀) = a(1 − q·x₀) + b(−q·y₀)`, an integer combination of `a` and `b`. If `r > 0`, then `r ∈ S` and `r < d`, contradicting minimality. So `r = 0` and `d | a`. By the same argument `d | b`, so `d` is a common divisor.

Second, any common divisor `c` of `a` and `b` divides `a·x₀ + b·y₀ = d`, so `c | d` and hence `c ≤ d`. Thus `d` is the greatest common divisor, and it is the least positive value of `a·x + b·y`. ∎

**The extended algorithm constructs `(x, y)`.** Running the Euclidean recurrence and back-substituting yields the coefficients. The recurrence: if `ext_gcd(b, a mod b) = (g, x', y')` so that `b·x' + (a mod b)·y' = g`, then substituting `a mod b = a − ⌊a/b⌋·b` gives

```
g = b·x' + (a − ⌊a/b⌋·b)·y' = a·y' + b·(x' − ⌊a/b⌋·y'),
```

so `(x, y) = (y', x' − ⌊a/b⌋·y')`. The base case `ext_gcd(a, 0) = (a, 1, 0)`. (Full algorithm and applications: sibling `06-extended-euclidean`.)

**Corollary 5.2 (Modular inverse existence).** `a` is invertible modulo `m` iff `gcd(a, m) = 1`. *Proof.* If `gcd(a, m) = 1`, Bezout gives `a·x + m·y = 1`, so `a·x ≡ 1 (mod m)`. Conversely, if `a·x ≡ 1 (mod m)`, then `a·x − 1 = m·k`, so `a·x − m·k = 1`, making `1` an integer combination of `a` and `m`; by Theorem 5.1 `gcd(a, m) | 1`, forcing `gcd(a, m) = 1`. ∎

**Worked inverse.** Find `3⁻¹ mod 11`. Extended Euclid on `(3, 11)`: `11 = 3·3 + 2`, `3 = 1·2 + 1`, `2 = 2·1 + 0`, so `gcd = 1` (an inverse exists). Back-substitute: `1 = 3 − 1·2 = 3 − 1·(11 − 3·3) = 4·3 − 1·11`. Thus `3·4 ≡ 1 (mod 11)` and `3⁻¹ ≡ 4`. Check: `3·4 = 12 = 11 + 1 ≡ 1`. ✓ Contrast `6⁻¹ mod 9`: `gcd(6, 9) = 3 ≠ 1`, so no inverse exists — indeed `6·x mod 9 ∈ {0, 6, 3}` cycles and never hits `1`, exactly because every value of `6·x` is a multiple of `gcd(6, 9) = 3`.

**Corollary 5.3 (Linear Diophantine solvability).** `a·x + b·y = c` has integer solutions iff `gcd(a, b) | c`. *Proof.* Every value of `a·x + b·y` is a multiple of `g = gcd(a, b)` (since `g | a`, `g | b`), so `g | c` is necessary. If `g | c`, scale a Bezout solution of `a·x₀ + b·y₀ = g` by `c/g`. ∎

### 5.1 Worked Extended-Euclidean Trace

Compute Bezout coefficients for `gcd(48, 18)` by forward division then back-substitution:

```
Forward:   48 = 2·18 + 12
           18 = 1·12 +  6
           12 = 2· 6 +  0   → gcd = 6
Back-sub:   6 = 18 − 1·12
              = 18 − 1·(48 − 2·18)
              = 3·18 − 1·48
```

So `(x, y) = (−1, 3)` with `48·(−1) + 18·3 = −48 + 54 = 6 = gcd`. ✓ The recursive form computes the same coefficients bottom-up: `ext_gcd(6, 0) = (6, 1, 0)`, then unwinding through `ext_gcd(12, 6)`, `ext_gcd(18, 12)`, `ext_gcd(48, 18)` applies `(x, y) = (y', x' − ⌊a/b⌋·y')` at each level, arriving at `(−1, 3)`.

### 5.2 Structure of the Full Solution Set

**Theorem 5.4 (General Diophantine solution).** If `gcd(a, b) = g` divides `c` and `(x₀, y₀)` is one solution of `a·x + b·y = c`, then *all* integer solutions are

```
x = x₀ + t·(b/g),     y = y₀ − t·(a/g),     t ∈ ℤ.
```

**Proof.** Each such `(x, y)` is a solution: `a(x₀ + t·b/g) + b(y₀ − t·a/g) = a·x₀ + b·y₀ + t(ab/g − ba/g) = c`. Conversely, if `(x, y)` is any solution, subtracting `a·x₀ + b·y₀ = c` gives `a(x − x₀) = −b(y − y₀)`. Dividing by `g`: `(a/g)(x − x₀) = −(b/g)(y − y₀)`. Since `gcd(a/g, b/g) = 1`, Euclid's lemma (Theorem 9.2) forces `(b/g) | (x − x₀)`, so `x − x₀ = t·(b/g)` for some integer `t`, and back-substitution gives `y − y₀ = −t·(a/g)`. ∎

This is why the modular inverse (the `c = 1` case mod `m`) is unique *modulo `m`*: the solutions differ by multiples of `m/gcd = m` (when `gcd = 1`), collapsing to a single residue class. The same parametrization underlies the Chinese Remainder Theorem's reconstruction step.

### 5.3 The CRT Solvability Condition

The general (non-coprime) Chinese Remainder Theorem is a direct corollary of the Diophantine theory. The system

```
x ≡ r₁ (mod m₁),     x ≡ r₂ (mod m₂)
```

has a solution **iff** `gcd(m₁, m₂) | (r₁ − r₂)`, and when it does, the solution is unique modulo `lcm(m₁, m₂)`. *Proof sketch:* writing `x = r₁ + m₁·t`, the second congruence becomes `m₁·t ≡ (r₂ − r₁) (mod m₂)`, a linear congruence solvable in `t` iff `gcd(m₁, m₂) | (r₂ − r₁)` (Corollary 5.3 applied to `m₁·t − m₂·s = r₂ − r₁`). The period of solutions is `lcm(m₁, m₂)` because that is the smallest modulus on which both congruences are determined. When the moduli are coprime (`gcd = 1`), the divisibility condition is automatic and `lcm = m₁·m₂`, recovering the classical CRT. Thus *both* the GCD (solvability gate) and the LCM (solution period) appear in the CRT — the GCD/LCM pair is the algebraic substrate of the whole theorem, developed fully in the CRT material of `19-number-theory`.

---

## 6. GCD as the Generator of the Ideal `aℤ + bℤ`

The cleanest algebraic statement of Bezout's identity is in the language of ideals.

**Definition 6.1.** For `a, b ∈ ℤ`, the set `aℤ + bℤ = { a·x + b·y : x, y ∈ ℤ }` is an **ideal** of `ℤ` (closed under addition and under multiplication by any integer).

**Theorem 6.2.** `ℤ` is a **principal ideal domain**: every ideal `I ⊆ ℤ` equals `dℤ` for a unique non-negative `d`. Moreover `aℤ + bℤ = gcd(a, b)·ℤ`.

**Proof.** Let `I = aℤ + bℤ`. If `I = {0}` then `a = b = 0` and `d = 0`. Otherwise let `d` be the least positive element of `I` (well-ordering). Clearly `dℤ ⊆ I`. For the reverse, take any `e ∈ I` and write `e = q·d + r` with `0 ≤ r < d`; then `r = e − q·d ∈ I` (ideals are closed under these operations), and minimality of `d` forces `r = 0`, so `d | e` and `e ∈ dℤ`. Thus `I = dℤ`. By Theorem 5.1 this `d` is exactly `gcd(a, b)`. ∎

**Significance.** This is the structural reason Bezout's identity holds and the reason `gcd` is "greatest in the divisibility order" (Definition 1.2): `gcd(a, b)` is the **generator** of the smallest ideal containing both `a` and `b`, equivalently the smallest positive integer combination of them. The whole theory — Bezout, modular inverses, Diophantine solvability — is the statement that `ℤ` is a PID and the GCD is the generator. This viewpoint generalizes verbatim to any principal ideal domain (Section 11), which is why "GCD" makes sense for polynomials and Gaussian integers.

**Dual statement for LCM.** Symmetrically, the intersection `aℤ ∩ bℤ` (the common multiples) is also an ideal, generated by `lcm(a, b)`: `aℤ ∩ bℤ = lcm(a, b)·ℤ`. So GCD generates the sum of the ideals and LCM generates their intersection — a clean lattice duality on the divisibility order.

### 6.1 The n-Number GCD and Bezout

The ideal viewpoint extends cleanly to any finite list. For `a₁, …, a_n ∈ ℤ`,

```
a₁ℤ + a₂ℤ + … + a_nℤ = gcd(a₁, …, a_n)·ℤ,
```

so the GCD of `n` numbers is the generator of the ideal they jointly span, and there exist integers `x₁, …, x_n` with `a₁x₁ + … + a_nx_n = gcd(a₁, …, a_n)` (the **`n`-ary Bezout identity**). Computationally this is just the associative fold:

```
gcd(a₁, …, a_n) = gcd(gcd(…gcd(a₁, a₂), a₃)…, a_n),
```

because `gcd` is associative — itself a consequence of the ideal sum being associative. The fold computes the coefficients incrementally: maintain a running Bezout combination and update it at each step. **Associativity is why the array-fold pattern from the implementation files is correct**, and the identity element `0` (for the fold) is the generator of the zero ideal `{0} = 0ℤ`.

**Theorem 6.3 (Coprimality of the whole list).** `gcd(a₁, …, a_n) = 1` iff there exist integers `x_i` with `Σ a_i x_i = 1`, iff the ideal they generate is all of `ℤ`. Note this is *weaker* than pairwise coprimality: `gcd(6, 10, 15) = 1` even though no two of `6, 10, 15` are coprime. The distinction matters for CRT (which needs *pairwise* coprime moduli) versus joint coprimality conditions.

---

## 7. The Identity `gcd·lcm = |a·b|`

**Theorem 7.1.** For all integers `a, b`, `gcd(a, b) · lcm(a, b) = |a·b|`.

**Proof (via prime factorizations).** The case where `a` or `b` is `0` holds by convention (both sides `0`). For non-zero `a, b`, write their prime factorizations

```
|a| = ∏_p p^{α_p},     |b| = ∏_p p^{β_p}     (finitely many nonzero exponents).
```

By the characterization of GCD and LCM via prime exponents (Section 10),

```
gcd(a, b) = ∏_p p^{min(α_p, β_p)},     lcm(a, b) = ∏_p p^{max(α_p, β_p)}.
```

Multiplying, the exponent of each prime `p` on the left is `min(α_p, β_p) + max(α_p, β_p) = α_p + β_p`, because for any two numbers `min(α,β) + max(α,β) = α + β`. Hence

```
gcd(a, b) · lcm(a, b) = ∏_p p^{α_p + β_p} = |a|·|b| = |a·b|. ∎
```

**Proof (factorization-free, via ideals).** `lcm(a, b)` generates `aℤ ∩ bℤ`. The product-and-quotient `|a·b| / gcd(a, b)` is a common multiple of `a` and `b` (since `gcd(a,b) | a` and `gcd(a,b) | b`), and any common multiple is divisible by it (using Bezout). Hence it is the least common multiple, giving the identity without invoking unique factorization — important because it shows the identity holds in any PID. ∎

**Corollary 7.2 (Computational form).** `lcm(a, b) = |a| / gcd(a, b) · |b|`. The division is exact because `gcd(a, b) | a`. Dividing before multiplying bounds the largest intermediate by the LCM itself, the basis of the overflow-safe implementation.

### 7.1 Worked Numeric Verification

For `a = 48, b = 18` with prime factorizations `48 = 2^4·3^1` and `18 = 2^1·3^2`:

```
gcd = 2^min(4,1) · 3^min(1,2) = 2^1·3^1 = 6
lcm = 2^max(4,1) · 3^max(1,2) = 2^4·3^2 = 144
gcd · lcm = 6 · 144 = 864 = 48 · 18 = |a·b|   ✓
exponent check, prime 2:  min(4,1) + max(4,1) = 1 + 4 = 5 = 4 + 1
exponent check, prime 3:  min(1,2) + max(1,2) = 1 + 2 = 3 = 1 + 2
```

Each prime's `min + max = sum` identity holds independently, and their product reconstitutes `|a·b|`. The overflow-safe order computes `lcm = 48/6 · 18 = 8 · 18 = 144`, whose largest intermediate (`144`) is the LCM itself, never the product `864`.

### 7.2 The Three-Number Caveat

The clean identity does **not** generalize naively to three numbers: `gcd(a,b,c) · lcm(a,b,c) ≠ |a·b·c|` in general. For `a = b = c = 2`, the left side is `2·2 = 4` but `|a·b·c| = 8`. The correct three-number relation requires inclusion-exclusion over the pairwise GCDs:

```
lcm(a,b,c) = |a·b·c| · gcd(a,b,c) / (gcd(a,b)·gcd(b,c)·gcd(a,c)).
```

This is the Mobius/inclusion-exclusion structure of the divisor lattice and a frequent source of off-by-a-factor bugs when engineers over-extend the two-number identity. The safe computational route for `n` numbers is the **prime-exponent merge** (max per prime, Section 10), which sidesteps the inclusion-exclusion entirely.

**Corollary 7.3 (Coprime case).** If `gcd(a, b) = 1` then `lcm(a, b) = |a·b|`: coprime numbers have the largest possible LCM. This is why coprime gear-tooth counts cycle through every relative position before realigning.

---

## 8. Binary GCD: Correctness Proof

Stein's algorithm computes the GCD using only parity tests, shifts, and subtraction. Its correctness rests on four identities.

**Lemma 8.1.** For positive integers `a, b`:
1. `gcd(2a, 2b) = 2·gcd(a, b)`.
2. If `a` is even and `b` is odd, `gcd(a, b) = gcd(a/2, b)`.
3. If `a, b` are both odd and `a ≥ b`, `gcd(a, b) = gcd((a − b)/2, b)`.
4. `gcd(a, a) = a` and `gcd(a, 0) = a`.

**Proof.**
1. `2` divides both, and `gcd(2a, 2b) = ∏ p^{min(α'_p, β'_p)}` where the exponent of `2` increases by `1` in each; equivalently any common divisor `d` of `2a, 2b` corresponds to a common divisor `d/gcd(d,2)·…` — concretely, by the distributive property (Theorem 9.1) `gcd(2a, 2b) = 2·gcd(a, b)`.
2. Since `b` is odd, `2 ∤ gcd(a, b)`, so the factor `2` in `a` is not shared; removing it (`a → a/2`) does not change the set of common divisors. Hence `gcd(a, b) = gcd(a/2, b)`.
3. Both odd ⇒ `a − b` is even. By Theorem 2.1-style reasoning `gcd(a, b) = gcd(a − b, b)` (since common divisors of `(a,b)` and `(a−b, b)` coincide), and since `b` is odd, `gcd(a − b, b) = gcd((a−b)/2, b)` by identity 2. So `gcd(a, b) = gcd((a−b)/2, b)`.
4. Immediate from the definitions. ∎

**Theorem 8.2 (Binary GCD correctness).** Repeatedly applying Lemma 8.1 — extracting the common power of two once, then alternately stripping lone factors of two and replacing the larger odd value `a` by `(a − b)/2` — terminates and returns `gcd(a, b)`.

**Proof.** Each identity preserves the GCD (Lemma 8.1), modulo the bookkept common power of two `2^k` factored out at the start (restored at the end via identity 1, applied `k` times). Termination: identities 2 and 3 strictly reduce `a + b` (each removes a factor of two or replaces `a` by the smaller `(a−b)/2`), a non-negative monovariant, so the process halts when one argument is `0` and the other is the odd part of the GCD; multiplying back `2^k` gives `gcd(a, b)`. ∎

**Complexity.** Each step reduces the total bit-length of `(a, b)` by at least one, so there are `O(log a + log b)` steps, each `O(log)` bit operations in the worst case ⇒ `O(log² max(a, b))` bit operations. On fixed-width machine words it is `O(log)` word operations, comparable to the Euclidean algorithm but division-free.

### 8.1 Worked Binary-GCD Trace

Compute `gcd(48, 18)` by Stein's algorithm, tracking the extracted power of two `k`:

```
48 = 110000₂, 18 = 10010₂.  Both even → k=1, halve both:  24, 9
24 even, 9 odd → strip 2s from 24:  3 (24 → 12 → 6 → 3)
both odd, 3 < 9 → swap to (3, 9), subtract: 9 − 3 = 6
6 even, 3 odd → strip:  3
both odd, equal → subtract: 3 − 3 = 0
remaining odd value = 3; restore 2^k = 2^1 → gcd = 2·3 = 6  ✓
```

The trace uses only halving (shifts), parity tests, comparison, and one subtraction per round — no division — and reproduces the Euclidean result `gcd(48, 18) = 6`. The extracted `k = 1` records the single shared factor of two (`48 = 2^4·3`, `18 = 2·3^2`, so `min` exponent of `2` is `1`).

The correctness of factoring out `2^k` first is Lemma 8.1 identity 1 applied `k` times; everything after operates on the *odd parts* `3` and `9`, whose GCD is `3`, and the final answer multiplies back `2^k`. This separation — handle the prime `2` by shifts, all other primes by subtraction — is the structural insight of the algorithm and the reason it never needs division.

### 8.2 Why Binary GCD Avoids Division

The Euclidean step `a mod b` is a *division*, costing `O(M(n))` per step for `n`-bit integers. Stein's identities replace it with: a shift (`a/2`, exact because the value is even), a comparison, and a subtraction — each `O(n)` bit operations, none requiring division. For big-integer arithmetic, where division is several times more expensive than addition/shift, this is the source of binary GCD's practical advantage, even though its asymptotic bit-complexity `O(log² max)` matches the Euclidean algorithm's. The trade is "more, cheaper steps" against "fewer, expensive steps."

---

## 9. Properties: Distributivity, Multiplicativity, Coprimality

**Theorem 9.1 (Distributive / scaling law).** For `c ≥ 0`, `gcd(c·a, c·b) = c · gcd(a, b)`.

**Proof.** Via prime exponents: `min(γ_p + α_p, γ_p + β_p) = γ_p + min(α_p, β_p)`, where `γ_p` is the exponent of `p` in `c`. Summing over primes gives `gcd(c·a, c·b) = c · gcd(a, b)`. (Factorization-free: every common divisor of `ca, cb` is `c` times a common divisor of `a, b` once the shared `c` is accounted for, by the ideal `caℤ + cbℤ = c(aℤ + bℤ) = c·gcd(a,b)ℤ`.) ∎

**Theorem 9.2 (Euclid's lemma).** If `gcd(a, b) = 1` and `a | b·c`, then `a | c`.

**Proof.** By Bezout, `a·x + b·y = 1` for some `x, y`. Multiply by `c`: `a·c·x + b·c·y = c`. Since `a | a·c·x` trivially and `a | b·c` (hence `a | b·c·y`), `a` divides the left side, so `a | c`. ∎

This lemma is the linchpin of the **uniqueness** half of the Fundamental Theorem of Arithmetic (Section 10): it is what forces prime factorizations to be unique.

**Worked instance of Euclid's lemma.** Take `a = 4`, `b·c = 6·10 = 60`. Here `4 | 60`, but `gcd(4, 6) = 2 ≠ 1`, so the lemma's hypothesis fails — and indeed `4 ∤ 10`. The coprimality condition is essential: without it, a factor can "split" across `b` and `c`. Contrast `a = 7` (prime, so coprime to `6`): `7 | 6·c` forces `7 | c`. This is exactly why **primes** satisfy the lemma unconditionally (a prime is coprime to anything it does not divide), which is what makes them the atoms of unique factorization.

**Theorem 9.3 (Coprime splitting / multiplicativity).** If `gcd(m, n) = 1`, then `gcd(a, m·n) = gcd(a, m)·gcd(a, n)`. More generally the GCD is multiplicative over coprime arguments. *Sketch:* exponent-wise, coprimality means `m` and `n` share no prime, so the `min` operations over their prime sets are independent and factor. ∎

**Corollary 9.4.** `gcd(a, b) = 1` and `gcd(a, c) = 1` imply `gcd(a, b·c) = 1`: a number coprime to two factors is coprime to their product. This underlies the Chinese Remainder Theorem's coprime-moduli hypothesis.

**Worked multiplicativity.** Take `a = 35 = 5·7`, `m = 4`, `n = 9` (coprime). Then `gcd(35, 4) = 1`, `gcd(35, 9) = 1`, and indeed `gcd(35, 36) = 1`, matching `gcd(a, m)·gcd(a, n) = 1·1`. Now break coprimality of the split: `gcd(12, 4·6) = gcd(12, 24) = 12`, but `gcd(12, 4)·gcd(12, 6) = 4·6 = 24 ≠ 12` — the factorization *fails* because `gcd(4, 6) = 2 ≠ 1`. The coprimality of `m, n` in Theorem 9.3 is essential, exactly as the coprimality of moduli is essential for the multiplicative form of the Chinese Remainder Theorem (`ℤ/mnℤ ≅ ℤ/mℤ × ℤ/nℤ` only when `gcd(m, n) = 1`).

---

## 10. Divisibility, Primes, and the Fundamental Theorem

**Theorem 10.1 (Prime-exponent characterization).** Writing `|a| = ∏_p p^{α_p}` and `|b| = ∏_p p^{β_p}`,

```
gcd(a, b) = ∏_p p^{min(α_p, β_p)},     lcm(a, b) = ∏_p p^{max(α_p, β_p)}.
```

**Proof.** A number `d = ∏_p p^{δ_p}` divides `a` iff `δ_p ≤ α_p` for all `p` (unique factorization). So `d` divides both `a` and `b` iff `δ_p ≤ min(α_p, β_p)`; the greatest such `d` takes `δ_p = min(α_p, β_p)`. The LCM argument is dual with `max` and `≥`. ∎

**Theorem 10.2 (Fundamental Theorem of Arithmetic).** Every integer `n > 1` factors into primes uniquely up to order.

**Proof (uniqueness via Euclid's lemma).** Existence is by strong induction (a non-prime `n` splits into smaller factors). Uniqueness: suppose `n = p₁⋯p_r = q₁⋯q_s`. Then `p₁ | q₁⋯q_s`; since `p₁` is prime, repeated application of Euclid's lemma (Theorem 9.2) forces `p₁ = q_j` for some `j`. Cancel and induct. ∎

The dependence chain is worth noting: **Theorem 2.1 (Euclid) → Bezout (5.1) → Euclid's lemma (9.2) → uniqueness of factorization (10.2) → prime-exponent GCD/LCM (10.1) → the `gcd·lcm` identity (7.1)**. The humble Euclidean recurrence sits at the root of elementary number theory.

### 10.1 The Divisibility Lattice

The positive integers under divisibility form a **lattice**: the *meet* (greatest lower bound) of `a` and `b` is `gcd(a, b)`, and the *join* (least upper bound) is `lcm(a, b)`. The prime-exponent characterization (Theorem 10.1) makes this precise: each integer maps to its exponent vector `(α₂, α₃, α₅, …)`, and

```
gcd  ↔  componentwise min  (meet)
lcm  ↔  componentwise max  (join)
```

so the divisibility lattice is a product of chains, one per prime. The lattice identities `min(min(α,β),γ) = min(α,min(β,γ))` give associativity of GCD; the absorption laws `gcd(a, lcm(a, b)) = a` and `lcm(a, gcd(a, b)) = a` mirror `min(α, max(α,β)) = α`. The bottom of the lattice is `1` (the empty exponent vector — divides everything), and the top is `0` (every integer divides `0`, so `0` is the join of everything, consistent with `lcm(_, 0) = 0` and `gcd(a, 0) = a`). This lattice structure is the abstract reason GCD and LCM are *dual* operations and the cleanest way to remember which takes `min` and which takes `max`.

---

## 11. Generalization to Euclidean Domains

The Euclidean algorithm works in any ring with a notion of "division with smaller remainder".

**Definition 11.1 (Euclidean domain).** An integral domain `R` is **Euclidean** if there is a function `N : R \ {0} → ℕ` (a "norm") such that for any `a, b ∈ R` with `b ≠ 0`, there exist `q, r` with `a = q·b + r` and either `r = 0` or `N(r) < N(b)`.

**Theorem 11.2.** In a Euclidean domain the Euclidean algorithm terminates and computes a GCD (unique up to a unit multiple), and Bezout's identity holds.

**Proof.** The norm `N(r)` strictly decreases (it is the monovariant replacing the integer remainder of Section 3), so the algorithm terminates. Theorem 2.1's argument — common divisors are preserved — uses only the division identity `a = q·b + r`, which holds by definition. Bezout follows because every Euclidean domain is a PID (the ideal argument of Section 6 transfers, using `N` to pick a least-norm generator). ∎

**Examples.**
- `ℤ` with `N(n) = |n|` — the integers (this whole document).
- `K[x]` (polynomials over a field) with `N(p) = deg(p)` — the *polynomial GCD*, used in computer algebra, error-correcting codes, and rational-function simplification.
- `ℤ[i]` (Gaussian integers) with `N(a + bi) = a² + b²` — GCDs of Gaussian integers, used in sums-of-two-squares results.

In each, "GCD", "Bezout", "coprime", and "modular inverse" mean exactly what they do in `ℤ`, with the *same* algorithm. The integer case is the prototype; the abstraction (Section 6, Theorem 6.2) is what makes the generalization automatic.

### 11.1 Worked Polynomial GCD

Over `ℚ[x]`, compute `gcd(x² − 1, x² − x)`. Run the Euclidean algorithm with polynomial division (the norm is the degree):

```
x² − 1 = 1·(x² − x) + (x − 1)        remainder x − 1, degree 1 < 2
x² − x = (x + 1)·(x − 1) + 0          remainder 0
```

So `gcd(x² − 1, x² − x) = x − 1` (up to a unit, i.e. a nonzero scalar). Verify: `x² − 1 = (x − 1)(x + 1)` and `x² − x = x(x − 1)`, sharing exactly the factor `x − 1`. The algorithm is identical to the integer case — replace `a mod b` with polynomial remainder and the degree replaces `|·|` as the strictly decreasing monovariant. This is the engine behind partial-fraction decomposition, the Cantor-Zassenhaus factoring algorithm, and BCH/Reed-Solomon decoding.

### 11.2 Worked Gaussian-Integer GCD

In `ℤ[i]` with norm `N(a + bi) = a² + b²`, compute `gcd(5, 2 + i)`. Note `5 = (2 + i)(2 − i)`, so `2 + i | 5`:

```
5 = (2 − i)·(2 + i) + 0       remainder 0  (since 5/(2+i) = 2 − i exactly)
```

Hence `gcd(5, 2 + i) = 2 + i` (up to a unit `±1, ±i`). This reflects that `5` is *not* a Gaussian prime — it splits as `(2+i)(2−i)` — which is the algebraic content of "5 is a sum of two squares, `5 = 2² + 1²`". The Euclidean algorithm in `ℤ[i]` is the computational tool behind the two-squares theorem and factoring in the Gaussian integers, again with no change to the recurrence beyond the norm.

### 11.3 Consecutive Fibonacci Numbers Are Coprime

**Proposition 11.3.** For all `n ≥ 1`, `gcd(F_n, F_{n+1}) = 1`.

**Proof.** Apply the Euclidean recurrence: since `F_{n+1} = 1·F_n + F_{n-1}`, we have `gcd(F_{n+1}, F_n) = gcd(F_n, F_{n-1})`, descending to `gcd(F_2, F_1) = gcd(1, 1) = 1`. ∎

So the very pairs that are the *worst case* for the algorithm's speed are also always *coprime* — the algorithm grinds through `n` steps only to return `1`. More generally, `gcd(F_m, F_n) = F_{gcd(m, n)}`, a striking identity (the Fibonacci sequence is a "strong divisibility sequence") proved by the same Euclidean descent on the indices. This is a clean illustration that the Euclidean structure appears not just *in* the algorithm but in the objects it operates on.

### 11.4 GCD and Canonical Forms in the Field of Fractions

The field of fractions of a Euclidean domain `R` is `Frac(R) = { a/b : a, b ∈ R, b ≠ 0 }`. The GCD is precisely what gives each element a **canonical reduced representative**: `a/b` reduces to `(a/g)/(b/g)` with `g = gcd(a, b)`, so the numerator and denominator are coprime. Without a GCD, there is no canonical form, and equality testing (`a/b = c/d` iff `ad = bc`) cannot be normalized to a unique representation.

This is why every computer-algebra system's rational-number type stores fractions in GCD-reduced form: it makes equality `O(1)` (compare normalized pairs), keeps numerators and denominators small, and is the `Frac(ℤ) = ℚ` instance of a general PID construction. For `Frac(K[x])` — rational functions — the *polynomial* GCD (Section 11.1) plays the identical role, reducing `p(x)/q(x)` to lowest terms before any further symbolic manipulation. The humble fraction-reduction step of the junior file is, abstractly, the construction of canonical forms in a field of fractions, valid in any Euclidean domain.

---

## 12. Summary

- **Euclidean recurrence.** `gcd(a, b) = gcd(b, a mod b)` because the substitution `a → a mod b` preserves the *set* of common divisors (Theorem 2.1); the base case `gcd(a, 0) = |a|` (Corollary 2.2). This is the entire algorithm.
- **Termination.** The remainder strictly decreases (a non-negative monovariant), so by well-ordering it reaches `0` in finitely many steps (Theorem 3.1).
- **O(log) bound.** Every two steps more than halve the value (Lemma 4.1), giving `O(log min(a,b))` steps; the tight worst case is consecutive **Fibonacci numbers** (Lamé's Theorem 4.3), with the exact constant `~1.44 log₂ N` (Corollary 4.4) because every quotient is `1`.
- **Bezout.** `gcd(a, b)` is the smallest positive value of `a·x + b·y` (Theorem 5.1); the extended algorithm constructs `(x, y)`. This gives modular-inverse existence (iff `gcd(a, m) = 1`, Corollary 5.2) and Diophantine solvability (iff `gcd(a, b) | c`, Corollary 5.3).
- **Ideal generator.** `aℤ + bℤ = gcd(a, b)·ℤ` (Theorem 6.2): the GCD generates the smallest ideal containing `a` and `b`; LCM generates the intersection `aℤ ∩ bℤ`. `ℤ` is a PID, the structural source of Bezout.
- **`gcd·lcm = |a·b|`** (Theorem 7.1), proved via prime exponents `min + max = sum` or factorization-free via ideals; the computational form `lcm = |a|/gcd · |b|` is the overflow-safe one.
- **Binary GCD.** Correct by the parity/shift identities (Lemma 8.1, Theorem 8.2); division-free, `O(log² max)` bit operations.
- **Properties.** Distributivity `gcd(ca, cb) = c·gcd(a, b)`, Euclid's lemma (the key to unique factorization), and coprime multiplicativity — together rooting elementary number theory in the Euclidean recurrence.
- **Generalization.** The same algorithm computes GCDs in any **Euclidean domain** — integers, polynomials, Gaussian integers — with identical Bezout/inverse/coprime theory.
- **Continued fractions and average case.** The Euclidean quotients are the continued-fraction expansion of `a/b` (Section 4.2); the average step count `≈ 0.84 log₂ b` (Khinchin) sits a constant factor below the Fibonacci worst case `≈ 1.44 log₂ b`.
- **Diophantine structure.** `a·x + b·y = c` is solvable iff `gcd(a,b) | c`, with the full solution set parametrized by `t·(b/g), −t·(a/g)` (Theorem 5.4); this is the engine behind modular inverses and the general CRT (Section 5.3).
- **Lattice duality.** Under divisibility, GCD is the meet (min of prime exponents) and LCM the join (max), so `gcd·lcm = |a·b|` is the lattice identity `min + max = sum` (Section 10.1) — and it fails for three or more numbers (Section 7.2).

### Complexity Cheat Table

| Task | Method | Complexity | Note |
|------|--------|-----------|------|
| `gcd(a, b)`, machine ints | Euclidean | `O(log min(a,b))` | tight; Fibonacci worst case |
| `gcd(a, b)`, division-free | binary / Stein | `O(log² max)` bit-ops | useful for big integers |
| `gcd(a, b)`, `n`-bit big ints | Lehmer / half-GCD | `O(M(n) log n)` | subquadratic |
| Bezout `(x, y)` | extended Euclidean | `O(log min(a,b))` | sibling `06` |
| `lcm(a, b)` | `|a|/gcd · |b|` | `O(log min(a,b))` | overflow-safe order |
| modular inverse | extended Euclidean | `O(log m)` | exists iff `gcd(a, m) = 1` |
| polynomial GCD | Euclidean in `K[x]` | `O(deg²)` schoolbook | Euclidean domain |

### Closing Notes

- **Root of the tree** (Section 10): Euclid → Bezout → Euclid's lemma → unique factorization → prime-exponent GCD/LCM → the product identity. One recurrence underlies it all.
- **Ideal viewpoint** (Section 6): "GCD = generator of `aℤ + bℤ`" is the cleanest statement and the one that generalizes to every PID.
- **Lamé** (Section 4): the Fibonacci worst case is not a curiosity — it pins the exact constant in the `O(log)` bound and is the canonical stress test.
- **Euclidean domains** (Section 11): the integer algorithm is a special case of a structure that also computes polynomial and Gaussian-integer GCDs verbatim.
- **Continued fractions** (Section 4.2): the Euclidean quotients *are* the continued-fraction expansion of `a/b`, tying the step count to the length of that expansion and the worst case to the golden ratio's all-`1` expansion; the average case (`≈ 0.84 log₂ b`, Khinchin) is a constant factor below the worst.
- **Lattice duality** (Section 10.1): GCD = meet (componentwise min of prime exponents), LCM = join (componentwise max); associativity, absorption, and the `min + max = sum` identity behind `gcd·lcm = |a·b|` are all lattice laws — the cleanest mnemonic for which operation takes min and which takes max.
- **CRT substrate** (Section 5.3): the GCD gates solvability (`gcd(m₁,m₂) | (r₁−r₂)`) and the LCM gives the solution period — both halves of the Chinese Remainder Theorem are GCD/LCM facts.
- **Canonical forms** (Section 11.4): the GCD is what gives every element of a field of fractions a unique reduced representative — the abstract content of fraction reduction, valid in any Euclidean domain.
- **Division algorithm uniqueness** (Theorem 1.5): the entire edifice rests on the *unique* remainder of `a = q·b + r`, which is what makes `a mod b` well-defined and every subsequent theorem possible.

### One-Paragraph Synthesis

The Euclidean recurrence `gcd(a, b) = gcd(b, a mod b)` is correct because the substitution preserves the common-divisor *set*, terminates because the remainder is a strictly decreasing non-negative monovariant, and runs in `O(log min(a, b))` because that remainder more than halves every two steps — with consecutive Fibonacci numbers as the tight worst case. Algebraically, `gcd(a, b)` is the generator of the ideal `aℤ + bℤ` (Bezout), which makes it the smallest positive integer combination `a·x + b·y`, which in turn decides when modular inverses and Diophantine solutions exist, gives the `gcd · lcm = |a·b|` identity (the lattice law `min + max = sum`), and generalizes verbatim to every Euclidean domain. Five lines of code; the root of elementary number theory.

### A Note on "Fast GCD"

Unlike matrix multiplication, there is no Strassen-style algebraic shortcut for GCD: the speedup for big integers comes entirely from *batching* Euclidean steps (Lehmer's matrix, half-GCD) on top of a fast underlying multiply `M(n)`, not from a fundamentally different recurrence. The lower bound is `Ω(n)` just to read the inputs, and the best known is `O(M(n) log n)`; whether GCD can be done in `O(M(n))` (matching one multiply) is open. For machine-word integers none of this matters — the schoolbook `O(log)` loop is optimal in practice and its worst case (Section 4.3) is under ~90 steps. The theory of "fast GCD" is therefore a big-integer story, layered on the same Euclidean recurrence proven in Section 2.

### Pitfall Index for the Theory

- Treating `gcd·lcm = |a·b|` as if it extends to three numbers — it does not (Section 7.2); use prime-exponent merge for `n` numbers.
- Confusing *joint* coprimality `gcd(a₁,…,a_n) = 1` with *pairwise* coprimality (Theorem 6.3) — CRT needs the pairwise version.
- Using "numerically greatest/smallest" instead of the divisibility-order definition — fine for `ℤ`, but it silently breaks the Euclidean-domain generalization (Section 11) where size is undefined.
- Assuming Euclid's lemma holds without the coprimality hypothesis (Section 9 worked instance) — `4 | 6·10` but `4 ∤ 10`.
- Forgetting that `gcd` is "greatest in the divisibility order" (clause (ii) of Definition 1.2), not merely numerically greatest — the weaker reading silently breaks in Euclidean domains where size is undefined (Section 11).
- Conflating termination with efficiency (Section 3 worked sequence) — the subtractive variant *terminates* but is `O(max)`; only the mod-based version's geometric monovariant gives `O(log)`.
- Reading the spectral / closed-form growth of *walk* counts onto GCD — unrelated; GCD has no eigenvalue story, its speed comes purely from the halving lemma.

Foundational references: Euclid, *Elements* Book VII; Knuth, *TAOCP* Vol. 2 (Euclid, binary GCD, Lamé's theorem); Hardy & Wright, *An Introduction to the Theory of Numbers* (Bezout, unique factorization); Dummit & Foote, *Abstract Algebra* (Euclidean domains, PIDs). Sibling topics: `06-extended-euclidean`, `02-modular-arithmetic`, and the CRT material in `19-number-theory`.