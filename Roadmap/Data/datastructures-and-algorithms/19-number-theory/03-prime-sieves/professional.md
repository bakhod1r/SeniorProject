# Prime Sieves — Professional / Mathematical Foundations

> **Focus:** Rigorous proofs. Why the Sieve of Eratosthenes is *correct*; the `O(n log log n)` running-time bound via `Σ_{p ≤ n} 1/p ~ ln ln n` (Mertens' theorem); the linear sieve's correctness — that each composite is struck exactly once, by its smallest prime factor; segmented-sieve correctness; and the correctness of sieving multiplicative functions (`φ`, `μ`, `τ`, `σ`).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Foundations: Primes, Divisibility, Unique Factorization](#foundations-primes-divisibility-unique-factorization)
3. [Correctness of the Sieve of Eratosthenes](#correctness-of-the-sieve-of-eratosthenes)
4. [The O(n log log n) Bound](#the-on-log-log-n-bound)
5. [Correctness of the Linear (Euler) Sieve](#correctness-of-the-linear-euler-sieve)
6. [Correctness of the Segmented Sieve](#correctness-of-the-segmented-sieve)
7. [Multiplicative Functions and Their Sieving](#multiplicative-functions-and-their-sieving)
8. [The Prime Number Theorem in Context](#the-prime-number-theorem-in-context)
9. [Worked Proof Walkthrough: φ over [1, 12]](#worked-proof-walkthrough-φ-over-1-12)
10. [Numerical Sanity Checks](#numerical-sanity-checks)
11. [Summary](#summary)
12. [Further Reading](#further-reading)

---

## Introduction

The sieve "obviously works" — but *obvious* is not *proven*, and the subtleties (why start at `p²`, why `√n` suffices, why the linear sieve never double-marks, why the `μ`/`φ` recurrences are valid) are exactly what professional-level understanding demands. This file proves the four central claims:

1. **Correctness of Eratosthenes:** after the procedure, `isPrime[x]` is `true` iff `x` is prime.
2. **Running time:** the procedure runs in `Θ(n log log n)`, and we derive the `log log n` from `Σ_{p≤n} 1/p ~ ln ln n`.
3. **Linear-sieve correctness:** every composite `c ≤ n` is marked exactly once, by the unique pair `(c/spf(c), spf(c))`, giving `O(n)` and a correct SPF table.
4. **Multiplicative-function correctness:** the sieved recurrences for `φ`, `μ`, `τ`, `σ` agree with the closed-form definitions.

Throughout, `p`, `q` denote primes; `spf(x)` is the smallest prime factor of `x`; `π(n)` is the number of primes `≤ n`.

A note on rigor: each claim below is stated as a lemma/theorem with an explicit proof, in the style of a number-theory text. The goal is not just to convince you the sieve "works," but to give you proofs you could reproduce on a whiteboard in an interview or use to debug a subtle off-by-one. Where a result (PNT, Mertens) is too deep to prove in full here, we cite it precisely and prove the consequences we need.

---

## Notation and Standing Assumptions

| Symbol | Meaning |
|--------|---------|
| `p`, `q` | prime numbers |
| `spf(x)` | smallest prime factor of `x` (with `spf(p)=p` for prime `p`) |
| `π(x)` | number of primes `≤ x` |
| `φ(n)` | Euler's totient: count of `k ∈ [1,n]` with `gcd(k,n)=1` |
| `μ(n)` | Möbius function |
| `τ(n)`, `σ(n)` | number of divisors, sum of divisors |
| `ω(n)`, `Ω(n)` | distinct, and total-with-multiplicity, prime-factor counts |
| `Λ(n)` | von Mangoldt function (`ln p` if `n=p^k`, else 0) |
| `ψ(x)` | `Σ_{n≤x} Λ(n)` (Chebyshev's function) |
| `f * g` | Dirichlet convolution `Σ_{d∣n} f(d) g(n/d)` |
| `ε`, `1`, `id` | convolution identity (`ε(1)=1`), constant-1, and identity (`id(n)=n`) functions |

Standing assumptions: all variables are positive integers unless stated; "log" without base is natural log in analytic statements (`ln`) and base-2 in complexity statements where noted; arithmetic is exact (overflow caveats are discussed separately).

## Foundations: Primes, Divisibility, Unique Factorization

**Definition.** An integer `p > 1` is *prime* if its only positive divisors are `1` and `p`. Otherwise `p > 1` is *composite*.

**Lemma (smallest divisor is prime).** Every integer `n > 1` has a smallest divisor `d > 1`, and that `d` is prime. *Proof.* The set of divisors of `n` exceeding 1 is nonempty (it contains `n`) and bounded below by 2, so it has a least element `d`. If `d` were composite, it would have a divisor `e` with `1 < e < d`, and `e ∣ d ∣ n` so `e ∣ n`, contradicting minimality of `d`. Hence `d` is prime. ∎

**Corollary (the `√n` bound).** If `n > 1` is composite, it has a prime factor `p ≤ √n`. *Proof.* Write `n = d·m` with `d` its smallest (prime) divisor; then `d ≤ m` (else `m < d` would be a smaller divisor `> 1`, since `m = n/d > 1` as `n` is composite), so `d² ≤ d·m = n`, giving `d ≤ √n`. ∎ This corollary is the mathematical justification for stopping the outer sieve loop at `√n`: every composite `≤ n` is eliminated by a prime `≤ √n`. It is used in all three sieve correctness proofs below — Eratosthenes (stop at `√n`), the linear sieve (the SPF cofactor `≥ p`), and the segmented sieve (base primes to `√R`). Every "`√` bound" in this topic traces back to this one lemma, which is why it is stated first.

**Euclid's Lemma.** If `p` is prime and `p ∣ ab`, then `p ∣ a` or `p ∣ b`. *Proof.* If `p ∤ a`, then `gcd(p, a) = 1` (the only divisors of `p` are `1` and `p`, and `p` does not divide `a`). By Bézout there exist integers `u, v` with `up + va = 1`. Multiply by `b`: `upb + vab = b`. Since `p ∣ upb` and `p ∣ ab` (hence `p ∣ vab`), `p` divides the left side, so `p ∣ b`. ∎ Euclid's lemma is the linchpin of uniqueness: it forbids a "second" prime factorization from disagreeing.

**Fundamental Theorem of Arithmetic.** Every integer `n > 1` factors into primes uniquely up to order: `n = p₁^{a₁} ⋯ p_k^{a_k}`. *Existence:* by strong induction — if `n` is prime, done; otherwise `n = ab` with `1 < a, b < n`, and both factor by the inductive hypothesis. *Uniqueness:* suppose `n = p₁⋯p_r = q₁⋯q_s` are two prime factorizations. Then `p₁ ∣ q₁⋯q_s`, so by Euclid's lemma `p₁ ∣ q_j` for some `j`, forcing `p₁ = q_j` (both prime). Cancel and induct on the number of factors. ∎ Unique factorization is what makes "smallest prime factor" well-defined and what makes multiplicative functions well-behaved: `f` is determined by its values on the prime-power components `p_i^{a_i}`.

**Definition of `spf`.** For `n > 1`, `spf(n)` is the least prime in `n`'s unique factorization. It is well-defined precisely because that factorization is unique. The linear sieve computes `spf` for all `n ≤ N`; everything downstream (factorization, multiplicative-function recurrences) is justified by the uniqueness just proved.

---

## Correctness of the Sieve of Eratosthenes

We prove: after running the sieve on `[2, n]` (starting each inner loop at `p²`, outer loop while `p² ≤ n`), the array satisfies `isPrime[x] = true ⟺ x` is prime, for all `2 ≤ x ≤ n`.

**Setup.** Initialize `isPrime[x] = true` for all `2 ≤ x ≤ n`. The procedure: for `p = 2, 3, …` while `p² ≤ n`, if `isPrime[p]` is still `true`, set `isPrime[m] = false` for `m = p², p²+p, …, ≤ n`.

We prove correctness by establishing a **loop invariant** and then three claims. The invariant, maintained before processing each new `p`, is:

> **(Inv)** For every `x ≤ n`, `isPrime[x] = false` iff `x` has a prime factor strictly less than the current `p` that is `≤ √x`; equivalently, `x` has been correctly identified as composite by some smaller prime, and no prime has been falsely marked.

Initially (before `p = 2`) no number is marked, which is vacuously consistent. We show each iteration preserves (Inv), and that at termination (Inv) yields the full correctness statement. The three claims below are the substance of that argument.

**Claim 1 (no prime is ever crossed out).** Suppose `x` is prime. The inner loop only writes `false` to multiples `m = k·p` with `k ≥ p ≥ 2`, hence `m ≥ 2p > p ≥ x`... more precisely, every value written `false` is a proper multiple of some `p` with a cofactor `≥ p ≥ 2`, so it is composite. A prime `x` is divisible only by `1` and `x`, so it is *not* a proper multiple of any `p < x`, and the inner loop for `p = x` starts at `x² > x` (for `x ≥ 2`), never touching `x` itself. Therefore no prime is ever set to `false`; primes keep `isPrime = true`. ∎

**Claim 2 (every composite is crossed out).** Let `c ≤ n` be composite. By the Corollary above, `c` has a prime factor `p ≤ √c ≤ √n`, so the outer loop *does* reach `p` (since `p² ≤ c ≤ n`). At that moment `isPrime[p]` is still `true`: by Claim 1 primes are never crossed out, so the guard `if isPrime[p]` passes and the inner loop runs. Now `c = p·k` with `k = c/p ≥ p` (because `p ≤ √c ≤ √(p·k)` forces `k ≥ p`). Thus `c ≥ p²`, so `c` lies in the inner loop's range `[p², n]` and is hit by `m = c`. Hence `isPrime[c]` is set `false`. ∎

**Claim 3 (the `if isPrime[p]` guard is sound).** We only ever launch the inner loop for values `p` that are *actually prime*. When the outer loop reaches `p`, if `p` is composite then by Claim 2 it was already crossed out by a smaller prime, so `isPrime[p] = false` and we skip it. If `p` is prime, by Claim 1 it is still `true` and we sieve it. So the guard exactly selects primes — we never sieve "multiples of a composite," which would be redundant (its prime factors already did the work). ∎

Combining Claims 1–2: `isPrime[x]` is `true` iff `x` is prime. The starting point `p²` is justified because any multiple `k·p` with `k < p` has a prime factor `≤ k < p`, hence was already crossed out by that smaller prime — so no correctness is lost by skipping `[2p, p²)`, only redundant work.

---

## The O(n log log n) Bound

**Operation count.** The dominant cost is inner-loop iterations. For each prime `p ≤ √n`, the inner loop runs `⌊(n − p²)/p⌋ + 1 ≤ n/p` times. (We may bound the total by summing `n/p` over all primes `p ≤ n`; primes in `(√n, n]` contribute nothing, which only helps.) So total work `T(n)` satisfies:

```
T(n) ≤ n · Σ_{p ≤ n, p prime} (1/p) + O(n)
```

The `O(n)` covers initialization and the outer scan. Everything hinges on the prime-reciprocal sum.

**Contrast with the naive trial-division "sieve".** If instead one tested each `x ≤ n` by trial division up to `√x`, the cost would be `Σ_{x≤n} √x = Θ(n^{3/2})` — polynomially worse than the sieve's near-linear bound. And testing each `x` against *all* primes up to `x` (not just `√x`) is worse still. The sieve's cleverness is that it never asks "is `x` prime?"; it only ever *removes* composites, and each removal is a single array write. The number of writes, not the number of candidates, governs the cost — and that number is `n·Σ 1/p`.

**Comparison of the candidate bounds.**

```
naive per-number trial division : Θ(n^{1.5})
sieve of Eratosthenes           : Θ(n log log n)
linear (Euler) sieve            : Θ(n)
```

The gap between `n^{1.5}` and `n log log n` at `n = 10^9` is roughly a factor of `√n / log log n ≈ 31623 / 3 ≈ 10⁴` — four orders of magnitude. That is the practical payoff of the analysis below.

**Mertens' Second Theorem.** `Σ_{p ≤ x} 1/p = ln ln x + M + o(1)`, where `M ≈ 0.2615` is the Meissel-Mertens constant.

**Sketch of why `Σ 1/p ~ ln ln x`.** Two ingredients:

1. *Euler's product / divergence.* From `Σ_{n≤x} 1/n ~ ln x` and the Euler product `Σ 1/n = Π_p (1 − 1/p)^{-1}`, taking logarithms gives `ln(Σ 1/n) = Σ_p −ln(1 − 1/p) = Σ_p (1/p + 1/(2p²) + …)`. The tail `Σ_p Σ_{k≥2} 1/(k p^k)` converges (dominated by `Σ_p 1/p²·(1/(1−1/p))`, finite). Hence `Σ_{p≤x} 1/p = ln ln x + O(1)`.
2. *Refinement via Abel summation* over the Chebyshev/PNT estimate `π(t) ~ t/ln t` turns the `O(1)` into the precise constant `M`, but for the running-time bound the leading `ln ln x` is all we need.

**Conclusion.** `T(n) ≤ n·(ln ln n + M + o(1)) + O(n) = Θ(n log log n)`. The lower bound matches: summing over primes `p ≤ √n` still yields `Θ(log log n)`, so the bound is tight, not just an upper estimate.

**Why `log log n` is "almost constant".** `ln ln(10^9) ≈ 3.03`, `ln ln(10^{18}) ≈ 3.72`. Doubling the digit count of `n` barely changes the factor. This is why practitioners treat the sieve as effectively `O(n)`.

**Space complexity.** The classic sieve uses `Θ(n)` bits for the boolean array (or `Θ(n)` machine words for an SPF table in the linear sieve). It is impossible to do better for the *full-table* problem: the output alone (one bit per number) is `Θ(n)` bits. The segmented sieve sidesteps this by *not materializing* the full output — it streams primes window-by-window with `Θ(√n + window)` space, trading random-access lookups for bounded memory. So there are two distinct space regimes: `Θ(n)` if you keep the table for `O(1)` queries, `Θ(√n + w)` if you only stream.

**A subtlety: the guard-read cost.** The outer loop runs `p` from `2` to `√n`, performing a constant-time read at each `p` to decide whether to sieve — `Θ(√n)` reads, dominated by the `Θ(n log log n)` inner work. This is why stopping the outer loop at `√n` (not `n`) matters: extending it to `n` adds a useless `Θ(n)` of guard reads with no cross-outs to show for it.

---

## Correctness of the Linear (Euler) Sieve

Recall the procedure: maintain a list `primes`. For `i = 2 … n`: if `spf[i]` unset, `i` is prime (`spf[i] = i`, append to `primes`). Then for each `p` in `primes` in increasing order, if `p > spf[i]` **break**; else set `spf[i·p] = p` (guarding `i·p ≤ n`).

We prove two things: (A) the marking is correct — `spf[x]` ends up equal to the true smallest prime factor — and (B) each composite is marked exactly once, giving `O(n)`.

**Lemma (the inner loop sets the true SPF).** When the loop sets `spf[i·p] = p`, the value `p` is indeed the smallest prime factor of `i·p`. *Proof.* We iterate `p` over primes in increasing order and have not yet broken, so `p ≤ spf[i]`. Every prime factor of `i·p` is either `p` or a prime factor of `i`, and all prime factors of `i` are `≥ spf[i] ≥ p`. Hence `p` is the smallest prime factor of `i·p`. ∎

**Lemma (each composite is reached exactly once).** Let `c ≤ n` be composite with smallest prime factor `q = spf(c)`. Set `m = c/q`. Then:
- `q ≤ spf(m)`: because `q` is the smallest prime dividing `c = q·m`, and `spf(m)` is a prime dividing `c`, so `spf(m) ≥ q`.
- When the outer loop reaches `i = m`, the inner loop iterates primes increasingly and reaches `p = q` *before or at* the break point, since the break is `p > spf[m]` and `q ≤ spf(m) = spf[m]`. So `spf[m·q] = spf[c] = q` is set at `(i, p) = (m, q)`.

*Uniqueness.* Suppose `(i', p')` also sets `spf[c] = p'`. By the previous Lemma `p' = spf(c) = q`, forcing `i' = c/p' = c/q = m`. So `(i', p') = (m, q)` — the pair is unique. Hence `c` is marked exactly once. ∎

**Why the break matters.** The break `if p > spf[i]: break` is what enforces uniqueness. Without it, `c = m·q` could *also* be marked when `i = c/q'` for a larger prime factor `q'` of `c`, double-counting and destroying the `O(n)` bound (you would recover Eratosthenes' `log log n`). The condition is often coded as "stop once `p` divides `i`," because the first prime with `p ∣ i` is exactly `p = spf[i]`; after marking `spf[i·spf[i]]` we break.

**Complexity.** Each composite is assigned `spf` once and each prime is appended once, so the total inner-loop work is `n − π(n) + π(n) = O(n)`. ∎

---

## Correctness of the Segmented Sieve

**Claim.** The segmented sieve correctly identifies all primes in `[L, R]` using only the primes `≤ √R`.

**Proof.** Initialize `inRange[x] = true` for `x ∈ [L, R]`. By the `√n` Corollary, every composite `c ≤ R` has a prime factor `p ≤ √c ≤ √R`. The base sieve produces all such primes. For each base prime `p`, we mark every multiple of `p` in `[L, R]` (starting at `start = max(p², ⌈L/p⌉·p)`):

- *Completeness:* any composite `c ∈ [L, R]` has a prime factor `p ≤ √R`; that `p` is in the base list, and `c` is a multiple of `p` in `[L, R]`, with `c ≥ p²` (same `k ≥ p` argument as Eratosthenes), so `c ≥ start` and is marked. Hence every composite in the window is crossed out.
- *Soundness:* we only mark proper multiples of base primes, all of which are composite (or the prime `p` itself when `p ∈ [L,R]`, but we start at `p² > p`, so `p` is never marked). Therefore primes in `[L, R]` survive.

The only special handling is `0` and `1` when `L ≤ 1`, which are non-prime by definition and must be cleared manually. Starting at `max(p², ⌈L/p⌉·p)` ensures we (i) never mark `p` itself and (ii) skip multiples below `L`. ∎

**Why `√R` and not `√L`.** A common error is to sieve base primes only up to `√L`. But a composite `c ∈ [L, R]` could be as large as `R`, so it may need a prime factor as large as `√R > √L`. Sieving only to `√L` would miss composites whose smallest factor lies in `(√L, √R]`, reporting them as prime. The bound is governed by the *top* of the window, `R`, always.

**Why `start ≥ p²` and not just `start ≥ L`.** If we began crossing out at `⌈L/p⌉·p` without the `p²` floor, then for a prime `p` lying inside `[L, R]` with `p² > R`, the first multiple `≥ L` would be `p` itself (when `p ≥ L`), and we would wrongly cross out `p`. The `max(p², …)` floor guarantees the first crossed value is a genuine composite (`≥ p²`), preserving the prime `p`. When `p² < L`, the `⌈L/p⌉·p` term dominates and we correctly start inside the window. Both clamps are necessary; dropping either produces a wrong result on some input — which is why the segmented-vs-whole parity test in `senior.md` is essential.

The memory is `O(R − L + √R)` and the time `O((R − L)·log log R + √R)`, independent of the magnitude of `R` beyond its square root — which is what lets `R` reach `10^{12}` with a modest window.

---

## Multiplicative Functions and Their Sieving

**Definition.** `f: ℤ⁺ → ℂ` is *multiplicative* if `f(1) = 1` and `f(ab) = f(a)f(b)` whenever `gcd(a,b) = 1`. It is *completely multiplicative* if this holds for all `a, b`. A multiplicative `f` is determined by its values on prime powers `f(p^e)`.

The linear sieve visits every `n > 1` as `n = p · m` with `p = spf(n)` and `m = n/p`. Two cases drive the recurrences:

- **Case A: `p ∤ m`** (equivalently `p < spf(m)`, the coprime branch). Then `gcd(p, m) = 1`, so by multiplicativity `f(n) = f(p)·f(m)`.
- **Case B: `p ∣ m`** (the break branch, `p = spf(m)`). Then `n = p·m` increases the exponent of `p`; we use the prime-power rule.

We verify each function.

**General principle for the sieve.** Whenever the linear sieve forms `n = i · p` with `p = spf(n)`, the value `f(n)` is computed from `f(i)` — which is *already finalized*, because `i < n` and the outer loop processed `i` earlier. Two situations arise, distinguished by whether `p` is a *new* prime for `n` or *raises* an existing exponent. The next subsections instantiate this for each function and prove the recurrence matches the definition.

### Euler's totient `φ`

`φ(p^e) = p^e − p^{e−1} = p^{e−1}(p−1)`, and `φ` is multiplicative.

- *Case A (`p ∤ m`):* `φ(n) = φ(p)·φ(m) = (p−1)·φ(m)`. ✓ matches the code `phi[i*p] = phi[i]*(p−1)`.
- *Case B (`p ∣ m`):* write `m = p^{e−1}·m'` with `p ∤ m'`, so `n = p^e·m'`. Then `φ(n) = φ(p^e)φ(m') = p^{e−1}(p−1)φ(m')`, while `φ(m) = p^{e−2}(p−1)φ(m')`, hence `φ(n) = p·φ(m)`. ✓ matches `phi[i*p] = phi[i]*p`.

*Closed-form cross-check:* `φ(n) = n·Π_{p∣n}(1 − 1/p)`. Both branches preserve this product form, as verified numerically in `middle.md`.

**Independent verification via the closed form.** Beyond the recurrence, `φ(n) = n·Π_{p∣n}(1 − 1/p)`. *Proof of the closed form (inclusion-exclusion).* The count of `k ∈ [1, n]` divisible by a prime `p` dividing `n` is `n/p`; by inclusion-exclusion over the distinct primes `p₁,…,p_r` of `n`, the count coprime to `n` is `Σ_{S ⊆ {1..r}} (−1)^{|S|} n / Π_{i∈S} p_i = n·Π_i (1 − 1/p_i)`. ∎ The sieve recurrence and this product must agree for every `n` — a redundancy that makes a strong test.

### Möbius `μ`

`μ(1) = 1`; `μ(n) = (−1)^k` if `n` is a product of `k` distinct primes (squarefree); `μ(n) = 0` if any prime divides `n` twice. `μ` is multiplicative.

- *Case A (`p ∤ m`):* `n = p·m` adds a new distinct prime, flipping the sign: `μ(n) = μ(p)·μ(m) = −μ(m)`. ✓ matches `mu[i*p] = −mu[i]`.
- *Case B (`p ∣ m`):* then `p² ∣ n`, so `n` is non-squarefree and `μ(n) = 0`. ✓ matches `mu[i*p] = 0`.

### Divisor count `τ` and divisor sum `σ`

For a prime power, `τ(p^e) = e+1` and `σ(p^e) = (p^{e+1} − 1)/(p − 1)`; both are multiplicative.

- *Case A (`p ∤ m`):* `τ(n) = τ(p)·τ(m) = 2·τ(m)`; `σ(n) = σ(p)·σ(m) = (p+1)·σ(m)`. ✓
- *Case B (`p ∣ m`):* you must track the exponent `e` of `p = spf` so far. With auxiliary `cnt[m]` (exponent of `spf(m)` in `m`), `τ(n) = τ(m)/(cnt[m]+1)·(cnt[m]+2)` and `σ(n) = σ(m/p^{cnt[m]})·(p^{cnt[m]+2} − 1)/(p − 1)` using a cached power of `p`. The auxiliary arrays make Case B a constant-time update, preserving `O(n)`. ✓

Because each `n` is processed in exactly one `(i, p)` pair (linear-sieve uniqueness), each `f(n)` is computed exactly once from already-finalized `f(m)` (since `m < n`), so the whole table is correct and the pass is `O(n)`.

---

### Worked exponent-tracking for τ and σ

The Case-B updates for `τ` and `σ` are the only ones needing auxiliary state. Here is the full recurrence with the exponent array `cnt[]` (exponent of `spf` in the number) and a cached `low[]` (the part of the number after removing all factors of its smallest prime). Below, `i` is the outer index, `p = spf(i*p)`, and the new number is `n = i*p`.

When `p ∤ i` (coprime, fresh prime): `cnt[n] = 1`. Then `τ(n) = τ(i)·2` and `σ(n) = σ(i)·(p+1)`, and `low[n] = i` (the part coprime to `p`).

When `p ∣ i` (the break branch, raising `p`'s exponent): `cnt[n] = cnt[i] + 1`. Then:

```
τ(n) = τ(i) / (cnt[i] + 1) * (cnt[i] + 2)
σ(n) = σ(low[i]) * ( (p^{cnt[n]+1} − 1) / (p − 1) )
low[n] = low[i]
```

Each step is `O(1)` (the power `p^{cnt[n]+1}` is built incrementally), so the whole `τ`/`σ` sieve stays `O(n)`. Correctness follows because `i`, `low[i]`, and their function values are *finalized* before `n = i·p > i` is processed — the linear sieve always builds larger numbers from smaller, already-complete ones.

**Verification.** For `n = 360 = 2³·3²·5`: `τ = (3+1)(2+1)(1+1) = 24` and `σ = (2⁴−1)(3³−1)/2·(5²−1)/4 = 15·13·6 = ... ` more directly `σ(360) = σ(8)σ(9)σ(5) = 15·13·6 = 1170`. A sieve producing `τ[360]=24` and `σ[360]=1170` confirms the exponent-tracking is correct.

### Dirichlet convolution view (why these recurrences exist)

Multiplicative functions form a group under **Dirichlet convolution** `(f * g)(n) = Σ_{d∣n} f(d) g(n/d)`. Key identities the sieve implicitly respects:

- `φ * 1 = id`, i.e. `Σ_{d∣n} φ(d) = n` (verified in the sanity table).
- `μ * 1 = ε` (the identity `ε(1)=1, ε(n>1)=0`) — Möbius inversion.
- `τ = 1 * 1` and `σ = id * 1`.

The convolution of two multiplicative functions is multiplicative, which is *why* `τ`, `σ` (built from `1` and `id`) are multiplicative and therefore sievable by the prime-power decomposition above. This is the structural reason the linear sieve can compute so many functions with the same machinery.

### Divisor count `τ` and divisor sum `σ` — closed-form check

For `n = p₁^{a₁} ⋯ p_k^{a_k}`: `τ(n) = Π (a_i + 1)` and `σ(n) = Π (p_i^{a_i+1} − 1)/(p_i − 1)`. *Proof of `τ`:* a divisor of `n` chooses, independently for each prime `p_i`, an exponent in `{0, 1, …, a_i}` — that is `a_i + 1` choices — so the number of divisors is the product. *Proof of `σ`:* sum over those same independent choices, `Σ_{e_i=0}^{a_i} p_i^{e_i} = (p_i^{a_i+1}−1)/(p_i−1)`, and the total divisor sum factors as the product of these geometric sums by distributivity. ∎ The sieve's exponent-tracking recurrence (Case B) is exactly this product updated one prime power at a time; the closed form is the regression oracle.

## The Prime Number Theorem in Context

The sieve does not *prove* the PNT, but the PNT explains the sieve's outputs. **PNT:** `π(n) ~ n/ln n`; equivalently the `n`-th prime `p_n ~ n ln n`. Consequences relevant to sieving:

- The prime list has length `≈ n/ln n`, which bounds the memory needed to store all primes (versus the `n` bits to store the boolean sieve).
- The base-prime sieve for a segmented sieve over `[L, R]` stores `≈ √R / ln √R` primes — tiny.
- The "density of primes near `x`" is `≈ 1/ln x`, which is why prime gaps grow slowly and why a small segmented window still contains many primes even near `10^{12}`.

The `Σ 1/p ~ ln ln n` used in the timing analysis is itself a corollary of the PNT (via Mertens), tying the running-time bound to the deep analytic structure of the primes.

**The prime-counting hierarchy (why segmented sieving cannot count `π(10^{12})` cheaply).** Computing `π(x)` exactly comes in tiers of cost:
- *Sieve and count:* `Θ(x)` time/space (or `Θ(x)` time, `Θ(√x)` space segmented). Fine to `x ≈ 10^{10}`–`10^{11}`.
- *Meissel–Mertens / Lehmer:* `Θ(x^{2/3})`-ish, no full sieve, combinatorial.
- *Lagarias–Miller–Odlyzko (LMO):* `Θ(x^{2/3} / log x)`.
- *Lucy_Hedgehog DP:* `Θ(x^{3/4})` time, `Θ(√x)` space — a popular contest method.

The segmented sieve belongs to the first tier: it *enumerates*, so counting a window costs proportional to the window. The higher tiers count *without* enumerating each prime, which is why `π(10^{12})` is feasible with LMO/Lucy but not by sieving the whole range. This boundary is a frequent senior-interview discriminator.

---

## The Infinitude of Primes, Three Ways

The sieve's reason for existing presupposes there are infinitely many primes; three classical proofs, each illuminating a different facet relevant to sieving:

**1. Euclid's proof.** Given primes `p₁, …, p_k`, the number `N = p₁⋯p_k + 1` is divisible by none of them (each leaves remainder 1), so its smallest prime factor is a new prime. Hence no finite list is complete. *Relevance:* this is the "smallest prime factor" idea — `spf(N)` is a prime not in the list — the same notion the linear sieve computes.

**2. Euler's analytic proof.** `Σ_p 1/p` diverges (shown above via the Euler product). A divergent sum has infinitely many terms, so there are infinitely many primes. *Relevance:* this is *exactly* the sum that governs the sieve's running time; the proof of infinitude and the proof of the `log log n` bound are the same calculation read two ways.

**3. Sieve-theoretic / counting.** If there were only `k` primes, every integer `≤ n` would be a product of powers of those `k` primes; counting such products gives `≤ (log₂ n + 1)^k`, which is `o(n)` — contradicting that there are `n` integers `≤ n`. *Relevance:* this counting argument is the same flavor as bounding `π(n)` and the prime list length, directly informing how much memory the prime list needs.

These three viewpoints — divisibility, analytic, counting — recur throughout sieve analysis, which is why a professional treatment grounds the algorithm in all three.

## Detailed Derivation: Mertens' Second Theorem

Because the `O(n log log n)` bound rests entirely on `Σ_{p≤x} 1/p ~ ln ln x`, it is worth seeing the derivation in more detail.

**Step 1 — Chebyshev / the von Mangoldt sum.** Define `Λ(n) = ln p` if `n = p^k` and `0` otherwise. One shows (Chebyshev) that `ψ(x) = Σ_{n≤x} Λ(n) = Θ(x)`, and more sharply (PNT) `ψ(x) ~ x`. A consequence via Abel summation is **Mertens' first theorem**:

```
Σ_{p ≤ x} (ln p)/p = ln x + O(1).
```

**Step 2 — Abel summation to remove the `ln p` weight.** Let `a_p = (ln p)/p` so that the partial sums `A(t) = Σ_{p≤t} a_p = ln t + O(1)`. We want `Σ_{p≤x} 1/p = Σ_{p≤x} a_p · (1/ln p)`. Apply Abel/partial summation with `g(t) = 1/ln t`:

```
Σ_{p≤x} 1/p = A(x)/ln x + ∫₂ˣ A(t) / (t (ln t)²) dt.
```

Substituting `A(t) = ln t + O(1)`:

```
= (ln x + O(1))/ln x + ∫₂ˣ (ln t + O(1)) / (t (ln t)²) dt
= 1 + O(1/ln x) + ∫₂ˣ dt/(t ln t) + ∫₂ˣ O(1)/(t (ln t)²) dt.
```

The first integral is `ln ln x − ln ln 2`; the second converges to a constant as `x → ∞`. Collecting constants into `M`:

```
Σ_{p ≤ x} 1/p = ln ln x + M + o(1).
```

**Step 3 — feed back into the sieve cost.** `T(n) ≤ n·(ln ln n + M + o(1)) + O(n)`. Since the bracket is `Θ(log log n)`, `T(n) = Θ(n log log n)`. The matching lower bound comes from restricting the sum to primes `p ≤ √n`, whose reciprocal sum is `ln ln √n + O(1) = ln ln n − ln 2 + O(1) = Θ(log log n)`. ∎

**Why the product side diverges (intuition).** The Euler product `Π_p (1 − 1/p)^{-1} = Σ_n 1/n = ∞` diverges; taking `−log` shows `Σ_p [−ln(1 − 1/p)] = ∞`. Since `−ln(1 − 1/p) = 1/p + 1/(2p²) + …` and the higher terms sum to a finite constant, `Σ_p 1/p` itself must diverge — and at the rate `ln ln x`. The divergence of `Σ 1/p` (Euler, 1737) is itself a proof that there are infinitely many primes, stronger than Euclid's: not only are there infinitely many, they are "dense enough" that their reciprocals diverge.

## Formal Treatment of the Linear-Sieve Uniqueness (Expanded)

The single most error-prone claim in the whole topic is "each composite is struck exactly once." Let us restate and prove it with no hand-waving, since it is what separates `O(n)` from `O(n log log n)`.

**Setup recap.** For `i = 2 … n`, after possibly recording `i` as prime, we run: `for p in primes (increasing): if p > spf[i] then break; spf[i*p] = p`. Equivalently many texts write `if i % p == 0 then { spf[i*p] = p; break } else spf[i*p] = p`, marking and then breaking on the first prime dividing `i`. The two formulations are identical because the first prime in the increasing list that divides `i` is precisely `spf[i]`.

**Theorem.** For each composite `c` with `2 ≤ c ≤ n`, there is exactly one pair `(i, p)` with `i ≥ 2`, `p` prime, `p ≤ spf[i]`, `i·p = c`, and the loop executes `spf[i·p] = p` for that pair. Moreover `p = spf(c)`.

**Proof of existence.** Let `q = spf(c)` and `m = c/q ≥ 2` (it is `≥ 2` because `c` is composite, so `c ≥ q²`, giving `m = c/q ≥ q ≥ 2`). Every prime factor of `m` is also a prime factor of `c`, hence `≥ q` (as `q` is the *smallest* prime factor of `c`). In particular `spf(m) ≥ q`. When the outer loop reaches `i = m`, the inner loop walks primes `2, 3, 5, …` increasingly. The break fires at the first prime `> spf[m]`. Since `q ≤ spf(m) = spf[m]`, prime `q` is reached *before* the break, and at that point we execute `spf[m·q] = q`, i.e. `spf[c] = q`. So the pair `(m, q)` exists and assigns `spf[c] = q = spf(c)`. ∎

**Proof of uniqueness.** Suppose `(i, p)` is any pair the loop uses to write `spf[c]`. By the construction the written value equals `p`, and we showed (SPF Lemma) that this written value is always the *true* smallest prime factor of `i·p = c`. Hence `p = spf(c) = q`. Then `i = c/p = c/q = m`. So `(i, p) = (m, q)`: the pair is forced. No second pair can write `spf[c]`. ∎

**Corollary (linear time).** The number of inner-loop *body executions* equals the number of `(i, p)` pairs that fall inside `[1, n]`, which by the theorem is exactly the number of composites `≤ n`, i.e. `n − 1 − π(n) < n`. Adding the `π(n)` prime-recording steps and the `O(n)` outer scan, total work is `O(n)`. ∎

**Where it breaks if you drop the break.** Suppose you *omit* the `break`. Then for `c = 12 = 2²·3` with `q = 2, m = 6`: at `i = 6`, you would mark `spf[12]` at `p = 2` (correct), but *also*, at `i = 4` (`spf[4] = 2`) with `p = 3`, you would attempt `spf[12] = 3` — a second, *wrong* write (3 is not the smallest prime factor of 12). So without the break you (a) violate uniqueness, (b) corrupt the SPF value, and (c) inflate the work to `Θ(n log log n)`. The break is load-bearing for both correctness *and* complexity. This is the precise reason the linear sieve is subtle despite its short code.

## Invariant-Based Proof of the Segmented Sieve (Block Form)

Production segmented sieves process `[2, n]` (or `[L, R]`) in consecutive blocks, carrying for each base prime `p` a "next offset" `off[p]` = the index, relative to the current block's start, of the next multiple of `p` to cross out. We prove this carried-offset scheme is correct.

**Invariant (Inv-Block).** Before processing block `[lo, hi]`, for each base prime `p`, `lo + off[p]` is the smallest multiple of `p` that is `≥ lo` and `≥ p²`.

*Initialization.* For the first block, set `off[p]` so that `lo + off[p] = p²` (or the first multiple `≥ lo` if `lo > p²`). (Inv-Block) holds by construction.

*Maintenance.* While sieving block `[lo, hi]`, we cross out `lo+off[p], lo+off[p]+p, …` up to `hi`, then set `off[p] ← (last crossed + p) − (hi + 1)` so that relative to the *next* block's start `hi+1`, `off[p]` again points at the first multiple `≥ hi+1`. Since multiples of `p` are exactly `p`-spaced, the next multiple after `hi` is well-defined and the update preserves (Inv-Block) for the next block.

*Correctness.* By (Inv-Block) every multiple of every base prime `p ≥ p²` in `[2, n]` is crossed out exactly in the block containing it, and by the segmented-sieve theorem those are precisely the composites. So survivors per block are exactly the primes in that block. The carried offset avoids recomputing `⌈lo/p⌉·p` from scratch each block — an `O(1)`-per-prime-per-block update instead of a division — which is the performance reason production code uses it. ∎

This invariant proof is the formal backing for the cache-blocked implementations in `senior.md`: the blocking is not just a performance trick, it is a provably-correct reformulation of the same sieve.

### A concrete `[L, R]` trace: sieving `[100, 120]`

Abstract invariants land better against numbers. Suppose we want the primes in `[L, R] = [100, 120]` without an array of size `120`. The segmented-sieve theorem says every composite in `[100, 120]` has a prime factor `≤ √120 ≈ 10.95`, so the *base primes* are exactly `{2, 3, 5, 7}` (primes `≤ ⌊√120⌋ = 10`), obtained by a small ordinary sieve up to `10`. We allocate a boolean window `mark[0 … 20]`, where slot `j` represents the value `100 + j`, all initialized "prime".

For each base prime `p` we compute the first multiple of `p` that is `≥ L`, namely `start_p = ⌈L/p⌉·p`, then cross out `start_p, start_p+p, start_p+2p, …` up to `R` (writing slot `value − L`):

| `p` | `⌈100/p⌉·p` | multiples crossed out in `[100,120]` |
|-----|-------------|--------------------------------------|
| 2 | 100 | 100,102,104,106,108,110,112,114,116,118,120 |
| 3 | 102 | 102,105,108,111,114,117,120 |
| 5 | 100 | 100,105,110,115,120 |
| 7 | 105 | 105,112,119 |

Note we may start at `L` rather than `p²` here because `p² ≤ 49 < L`: the entire window lies above every base prime's square, so *every* in-window multiple of `p` is a genuine composite (its cofactor `≥ L/p > p`). The survivors — slots never crossed out — are the values `101, 103, 107, 109, 113`. These are exactly the primes in `[100, 120]` (one can verify `100 = 2²·5²`, `119 = 7·17`, `120 = 2³·3·5` are all composite, and no prime in this gap was missed). The window used `21` bytes plus a 4-element base list, independent of how large `L` is — that memory independence is the whole point of segmenting. ∎(by exhibition)

The trace also makes the `⌈L/p⌉` formula concrete: for `p = 3`, `⌈100/3⌉ = 34`, so `start = 102`; for `p = 7`, `⌈100/7⌉ = 15`, so `start = 105`. Getting this ceiling wrong by one is the single most common segmented-sieve bug — it either crosses out a value below `L` (out-of-bounds, since slot `−1` does not exist) or skips the first multiple (leaving a composite marked prime). Asserting `start_p ≥ L` and `start_p % p == 0` before the inner loop catches both, and the trace above is the kind of fixture a unit test should encode verbatim.

## Summary of the Four Central Theorems

For quick reference, the load-bearing results proven in this file:

1. **Eratosthenes correctness.** After the procedure, `isPrime[x] ⟺ x` prime. Primes survive (never a proper multiple of a smaller number; own loop starts at `p²`); composites die (some prime factor `≤ √n` reaches them). The `if isPrime[p]` guard selects exactly primes.
2. **Eratosthenes complexity.** `Θ(n log log n)`, from `T(n) ≤ n·Σ_{p≤n} 1/p` and Mertens' `Σ_{p≤x} 1/p = ln ln x + M + o(1)`.
3. **Linear-sieve correctness + complexity.** Each composite `c` is struck exactly once, by the unique pair `(c/spf(c), spf(c))`; the `p > spf[i]` break enforces uniqueness; total markings `< n`, so `Θ(n)`, and `spf` is the true smallest prime factor.
4. **Multiplicative-function correctness.** Sieving `φ`, `μ`, `τ`, `σ` is correct because each `n = i·p` (with `p = spf(n)`, `i` finalized) splits into a coprime case (multiplicativity) and a prime-power case (the prime-power formula), each computed once and matching the closed forms.

Plus the supporting results: the segmented sieve (base primes to `√R`), the odd-only/wheel bijection correctness, and the `√n` smallest-divisor lemma underpinning all three.

## A Note on Correctness Under Modular and Bounded Arithmetic

The proofs above assume exact integer arithmetic. In implementation, two arithmetic subtleties can break the *theorems* even when the *code* compiles:

- **`p² > n` overflow:** the loop guard `p*p ≤ n` is the encoding of "outer loop runs to `√n`." If `p*p` overflows a 32-bit type, the guard can wrap to a negative value and either terminate early (missing cross-outs, → composites reported prime) or loop forever. The fix preserves the *theorem*: compute `p*p` in 64-bit so the guard faithfully encodes the mathematical bound.
- **`i*p` overflow in the linear sieve:** the uniqueness lemma assumes `i·p` is the true product. An overflowed product indexes a wrong cell, corrupting the SPF table silently. Widen to 64-bit before the `≤ n` test.

Neither is a flaw in the mathematics; both are reminders that the proofs hold only when the machine faithfully represents the integers the proofs reason about. This is why the testing layer in `senior.md` cross-checks against reference `π(n)` values — it detects exactly these representation failures.

## Worked Proof Walkthrough: φ over [1, 12]

To make the abstract recurrence proofs concrete, here is the linear sieve filling `φ` for `n = 12`, annotated with which proof branch fires. We track `primes` and `φ`.

```
i=1:  seed φ[1]=1
i=2:  spf[2]=0 → prime. φ[2]=1. primes=[2].
      inner p=2: 2·2=4, 2%2==0 (Case B, p|i): φ[4]=φ[2]·2=2. break.
i=3:  prime. φ[3]=2. primes=[2,3].
      inner p=2: 3·2=6, 3%2≠0 (Case A): φ[6]=φ[3]·(2−1)=2.
      inner p=3: 3·3=9 >12? no. 3%3==0 (Case B): φ[9]=φ[3]·3=6. break.
i=4:  composite (φ[4]=2 set). inner p=2: 4·2=8, 4%2==0 (Case B): φ[8]=φ[4]·2=4. break.
i=5:  prime. φ[5]=4. primes=[2,3,5].
      inner p=2: 5·2=10, 5%2≠0 (Case A): φ[10]=φ[5]·1=4.
      inner p=3: 5·3=15>12 → break (bound).
i=6:  composite. inner p=2: 6·2=12, 6%2==0 (Case B): φ[12]=φ[6]·2=4. break.
...
```

Final: `φ = [_,1,1,2,2,4,2,_,4,6,4,_,4]` (indices 1..12). Verify the non-trivial ones against `φ(n)=n·Π(1−1/p)`: `φ(8)=8·½=4` ✓, `φ(9)=9·⅔=6` ✓, `φ(12)=12·½·⅔=4` ✓. Note `12` was filled at `i=6, p=2` (Case B), *not* at `i=4, p=3` — the break on `i=4` after `p=2` prevented the latter, which is exactly the uniqueness guarantee in action. Every composite was filled exactly once, from an already-finalized smaller value.

## Generalized Sieving: Beyond Primality

The cross-out machinery generalizes well beyond "is prime." Two professional generalizations:

**Sieving a completely multiplicative function over an Eratosthenes pass.** If you only need a multiplicative `f` and not `spf`, you can sometimes compute it during a *modified Eratosthenes* by accumulating prime-power contributions. For `φ`, initialize `phi[i] = i`, then for each prime `p`, for each multiple `m` of `p`, do `phi[m] -= phi[m] / p`. *Correctness:* this applies the factor `(1 − 1/p)` once per distinct prime `p ∣ m`, yielding `phi[m] = m·Π_{p∣m}(1 − 1/p) = φ(m)`. The cost is `Θ(n log log n)` (one pass per prime over its multiples), slightly worse than the linear sieve's `Θ(n)` but conceptually simpler and bit-array-free for `μ`/`φ`.

```
phi[i] = i for all i
for p = 2..n:
    if phi[p] == p:          # p is prime (untouched)
        for m = p, 2p, ...:
            phi[m] -= phi[m] / p
```

*Why the `phi[p] == p` test detects primes:* a prime `p` is touched only when some `q ≤ p` divides it, i.e. only by `q = p` itself; before that moment `phi[p]` is still its initial `p`. So the first time we reach `p` with `phi[p]` unchanged, `p` is prime — the sieve's prime-detection reused for `φ`.

**Sieving the Möbius function for inclusion-exclusion.** Many counting problems (counting coprime pairs, squarefree numbers, gcd sums) reduce to `Σ μ(d)·g(⌊n/d⌋)`. The sieved `μ` makes these `O(n)` to set up and `O(n)` or `O(√n)` to evaluate per query via Möbius inversion. The correctness of these reductions is `μ * 1 = ε` (proven above); the sieve supplies the `μ(d)` values that the inversion formula consumes. This is the single most common downstream use of a Möbius sieve and the reason `professional.md` proves `μ`'s recurrence so carefully.

## Numerical Sanity Checks

| Quantity | Value | Check |
|----------|-------|-------|
| `π(10)` | 4 | {2,3,5,7} |
| `π(100)` | 25 | matches sieve count |
| `π(10^6)` | 78498 | reference |
| `Σ_{p≤100} 1/p` | ≈ 1.803 | grows like `ln ln 100 + M ≈ 1.53 + 0.26`; finite-`n` correction |
| `φ(360)` | 96 | `360·(1−½)(1−⅓)(1−⅕) = 96` |
| `μ(30)` | −1 | `30 = 2·3·5`, three distinct primes |
| `μ(12)` | 0 | `12 = 2²·3`, square factor |
| `τ(360)` | 24 | `(3+1)(2+1)(1+1) = 24` for `2³·3²·5` |
| `σ(6)` | 12 | `1+2+3+6` |
| `Σ_{d∣n} φ(d)` | `n` | e.g. `n=12`: `φ(1)+φ(2)+φ(3)+φ(4)+φ(6)+φ(12)=1+1+2+2+2+4=12` |
| `σ(360)` | 1170 | `σ(8)σ(9)σ(5)=15·13·6` |
| `Σ_{d∣n} μ(d)` | `[n=1]` | 0 for `n>1`, 1 for `n=1` (the `ε` identity) |
| `ω(360)` | 3 | distinct primes 2,3,5 |
| `Ω(360)` | 6 | `2³·3²·5` → 3+2+1 |

These identities are excellent regression tests: any sieve or multiplicative-function implementation that violates one has a bug. A practical CI strategy is to assert *all* of them for every `n ≤ 10^4` against both the sieved values and a direct (trial-factorization) computation; a discrepancy localizes the bug to a specific function and a specific small `n`, which is far easier to debug than a failure deep in a `10^9` sieve.

### Deriving `Σ_{d∣n} φ(d) = n` (the totient summation identity)

This identity is both a sanity check and a window into Dirichlet convolution. *Proof.* Partition the `n` fractions `1/n, 2/n, …, n/n` by their reduced denominator. A fraction `k/n` in lowest terms `a/d` has denominator `d ∣ n`, and for each divisor `d` of `n` the number of reduced fractions with denominator exactly `d` is `φ(d)` (the `a` coprime to `d`, `1 ≤ a ≤ d`). Every one of the `n` fractions appears exactly once across these classes, so `Σ_{d∣n} φ(d) = n`. ∎ Equivalently, `φ * 1 = id` in convolution notation. A sieved `φ` that fails this for any `n ≤ 10^4` has an exponent-handling bug.

### Möbius inversion as a corollary

From `μ * 1 = ε` and `φ * 1 = id`, convolving the second with `μ` gives `φ = μ * id`, i.e. `φ(n) = Σ_{d∣n} μ(d)·(n/d)`. This is an alternative way to *compute* `φ` and a cross-check on the sieved values: for `n = 12`, `Σ_{d∣12} μ(d)(12/d) = μ(1)·12 + μ(2)·6 + μ(3)·4 + μ(4)·3 + μ(6)·2 + μ(12)·1 = 12 − 6 − 4 + 0 + 2 + 0 = 4 = φ(12)` ✓. A sieve producing both `μ` and `φ` should satisfy this identity for all `n` in range — a powerful joint regression test that catches errors in *either* function.

---

## Further Theoretical Notes

### Why starting at `p²` loses no correctness — restated formally

Let `S_p = {k·p : k ≥ 2, k·p ≤ n}` be all proper multiples of `p`, and `S_p' = {k·p : k ≥ p, k·p ≤ n}` be those starting at `p²`. We claim sieving with `⋃_p S_p'` (the `p²`-start version) crosses out exactly the same *set of composites* as sieving with `⋃_p S_p`. Indeed any `c ∈ S_p \ S_p'` has `c = k·p` with `2 ≤ k < p`; then `c` has a prime factor `q ≤ k < p` (the smallest prime factor of `k`), so `c ∈ S_q'` (since `c/q ≥ c/k = p > q`, giving `c ≥ q²`). Hence `c` is still crossed out — by `q` instead of `p`. So `⋃_p S_p' = ⋃_p S_p = {composites ≤ n}`. The `p²` optimization changes *who* crosses out a composite, never *whether* it gets crossed out. ∎

### Bertrand's postulate and prime gaps

**Bertrand's postulate:** for every `n ≥ 1` there is a prime in `(n, 2n]`. A practical corollary: to guarantee at least one prime above a bound `B`, sieving up to `2B` always suffices. More refined, the PNT gives average prime gap `≈ ln x` near `x`, so a segmented window of width `w ≫ ln R` near `R` is essentially guaranteed to contain primes — relevant when choosing window sizes for the segmented sieve.

### The linear sieve and the `O(n)` lower bound

Any algorithm that *outputs* the primality status (or SPF) of all `n` numbers must write `Ω(n)` cells, so `O(n)` is asymptotically optimal for the full-table problem. The linear sieve matches this bound. Eratosthenes' extra `log log n` factor is the price of its redundant marking; the linear sieve removes exactly that redundancy by the uniqueness lemma proved above. This is a rare case where a textbook algorithm (`O(n log log n)`) is improved to the provable optimum (`O(n)`) by a small structural change — at the cost of `O(n)` integer storage rather than `O(n)` bits.

## Correctness Under Composition: Sieve Then Factor

A frequent production pipeline is: sieve SPF up to `n`, then factor many `x ≤ n`. We verify the *composite* algorithm (factorization via SPF) is correct.

**Algorithm.** `factor(x)`: while `x > 1`, let `p = spf[x]`, output `p`, and divide all factors of `p` out of `x` (`while x % p == 0: x /= p`).

**Termination.** Each outer iteration strictly decreases `x` (it removes at least one prime factor), and `x ≥ 1` is bounded below, so the loop terminates. In fact `x` at least halves per outer iteration when `p = 2`, and in general the number of *distinct* primes is `≤ log₂ x`, so there are `O(log x)` outer iterations.

**Correctness.** *Invariant:* at the top of the loop, the primes output so far are exactly the distinct primes of the original `x₀` larger than... more simply, the multiset of `(p, removed exponent)` accumulated equals the prime factorization of `x₀`. Each step takes `p = spf[x]`, the genuine smallest prime factor of the current `x` (the sieve guarantees this), removes its full exponent, and recurses on the cofactor, which is `x₀` with that prime power removed. By the Fundamental Theorem of Arithmetic the factorization is unique, and the algorithm reconstructs it prime by prime in increasing order. When `x` reaches `1`, all primes have been extracted. ∎

This is why the SPF sieve is so valuable: the *table* is built once in `O(n)`, and every subsequent factorization is provably correct in `O(log x)` with no further primality testing. The composition of "linear sieve" + "SPF factor" is the canonical fast-factorization-of-many-numbers pipeline.

## Correctness of the Odd-Only and Wheel Optimizations

The odd-only and wheel sieves change the *representation* but must not change the *result*. We verify they are correct, not merely faster.

**Odd-only correctness.** All primes except `2` are odd. So: handle `2` separately, then sieve only the odd numbers `≥ 3`. Map odd value `v = 2i + 3` to index `i`. For an odd prime `p`, its multiples are `p, 2p, 3p, …`; the *even* multiples (`2p, 4p, …`) are not represented (they are even, hence already known composite via the separate `2`), so we cross out only the *odd* multiples `p², p²+2p, p²+4p, …` (step `2p`, since `p·odd` is odd when `p` is odd). *Claim:* this crosses out exactly the odd composites. Every odd composite `c` has an odd smallest prime factor `p ≥ 3` with cofactor `c/p ≥ p ≥ 3` odd, so `c = p·(odd ≥ p)` appears in the step-`2p`-from-`p²` sequence. Conversely every value crossed out is `p·m` with `m ≥ p` odd, hence composite. So the odd-only sieve marks precisely the odd composites; combined with the special-cased `2`, it yields all primes. ∎

**Wheel correctness (mod-30 example).** Numbers coprime to `30 = 2·3·5` fall in 8 residue classes mod 30: `{1, 7, 11, 13, 17, 19, 23, 29}`. Every prime `> 5` lies in one of these classes (a prime cannot be divisible by 2, 3, or 5). So after special-casing `2, 3, 5`, sieving only these 8 classes per block of 30 captures all remaining primes. *Claim:* no prime `> 5` is skipped, and every composite among the stored residues is crossed out by some prime in the wheel. The first part holds because primes `> 5` are coprime to 30; the second is the standard Eratosthenes argument restricted to the stored residues, with cross-out steps precomputed per residue class. The bookkeeping (mapping a value to its slot and stepping within the wheel) is mechanical but must be exact — an error in the residue map silently misclassifies one class, which is why wheel sieves demand the parity tests of `senior.md`. ∎

The general lesson: every memory optimization is a *bijection* between stored slots and a subset of integers (those coprime to the wheel primes). Correctness reduces to (i) the omitted integers are provably composite (or the special-cased small primes), and (ii) the bijection is implemented without off-by-one. The asymptotic complexity is unchanged; only the constant shrinks.

## Comparison of Sieve Variants — A Unified View

All three sieves rest on the same lemma (every composite `≤ N` has a prime factor `≤ √N`) but exploit it differently:

| Variant | What it exploits | Marking rule | Each composite marked | Cost |
|---------|------------------|--------------|------------------------|------|
| Eratosthenes | `√n` bound | every prime marks all its multiples from `p²` | once per *distinct prime factor* | `Θ(n log log n)` |
| Linear (Euler) | `√n` bound + SPF uniqueness | `spf[i·p]=p` for `p ≤ spf[i]` | exactly **once** (by SPF) | `Θ(n)` |
| Segmented | `√R` bound | base primes mark multiples in window | once per distinct prime factor (within window) | `Θ((R−L)log log R + √R)` |

The progression Eratosthenes → linear is "remove the redundant markings"; the progression Eratosthenes → segmented is "don't hold the whole array." The linear and segmented optimizations are *orthogonal* — one can segment a linear-sieve-style computation, though in practice segmented sieves use the simpler Eratosthenes marking per window because SPF for a far window is rarely needed.

## Why the Composite-Marking Counts Differ (Eratosthenes vs Linear)

It is worth quantifying *exactly* how many marking operations each sieve performs, since that is the crux of `Θ(n log log n)` vs `Θ(n)`.

**Eratosthenes marking count.** A composite `c` is marked once for each *distinct prime factor `p ≤ √c`* that owns it... more precisely, in the `p²`-start version, `c` is marked once for each prime `p` with `p ≤ √c` and `p ∣ c`. Summed over all `c ≤ n`, the total equals `Σ_{p ≤ √n} ⌊(n − p²)/p⌋ + (count of primes) ≈ n Σ_{p ≤ √n} 1/p = n(ln ln √n + O(1)) = Θ(n log log n)`. So a number like `2³·3·5·7 = 840` is marked up to 4 times (by 2, 3, 5, 7), once each.

**Linear marking count.** By the uniqueness theorem, each composite is marked *exactly once*, by `(c/spf(c), spf(c))`. Total markings `= #composites ≤ n = n − 1 − π(n) < n`. So `840` is marked exactly once, by the pair `(420, 2)`. The ratio of the two counts is `≈ ln ln n` — the asymptotic gap, made concrete.

**The trade the linear sieve makes.** It pays for "exactly once" with: (a) an `O(n)`-word `spf` array instead of `O(n)` *bits*; (b) maintaining a growing prime list and an inner loop with a data-dependent break, which has slightly worse branch prediction and memory locality than Eratosthenes' tight stride. This is why, for *pure primality up to `n`*, a cache-friendly bitset Eratosthenes often wins wall-clock despite the extra `log log n` factor (as `senior.md` notes) — the constant and cache behavior beat the asymptotics at realistic `n`. The linear sieve wins when you genuinely need `spf` or a multiplicative function, where Eratosthenes would need a second pass anyway.

## On the Limits of Sieving

The sieve's `Θ(n)`–`Θ(n log log n)` cost is in `n`, the *magnitude* of the bound, not in the *bit-length* `log n`. So sieving is exponential in the input size when the input is a single number written in `log n` bits. This is why:

- **Primality of one `m`-bit number** is *not* done by sieving — it would cost `Θ(2^m)`. Miller-Rabin (topic `08`) runs in polynomial time in `m`.
- **Factoring one `m`-bit number** is likewise not a sieve problem; Pollard's rho (topic `09`) and, for cryptographic sizes, the number field sieve (a different "sieve" entirely, operating on smooth numbers, not this array sieve) are the tools.

The array sieve is the right tool precisely when you need results for *all* (or a dense window of) numbers up to a bound that fits in memory — a fundamentally different regime from "one big number." Keeping this distinction sharp is the mark of professional-level judgment, and it is why this topic explicitly hands off to topics `08` and `09` at its boundary.

## Summary

The Sieve of Eratosthenes is correct because every prime survives (it is never a proper multiple of a smaller number, and its own loop starts at `p² > p`) while every composite is struck by a prime factor `≤ √n` (the smallest-divisor lemma). Its running time is `Θ(n log log n)`, derived from `T(n) ≤ n·Σ_{p≤n} 1/p` and Mertens' theorem `Σ_{p≤n} 1/p = ln ln n + M + o(1)`. The linear sieve achieves `O(n)` and a correct smallest-prime-factor table because each composite `c` is marked exactly once, by the unique pair `(c/spf(c), spf(c))` — the `p > spf[i]` break is precisely what enforces that uniqueness. The segmented sieve is correct because base primes `≤ √R` suffice to eliminate every composite in `[L, R]`. And sieving `φ`, `μ`, `τ`, `σ` is correct because the linear sieve factors each `n` as `p·m` with `p = spf(n)`, splitting into a coprime case (apply multiplicativity) and a prime-power case (apply the prime-power formula), each computed once from a finalized smaller value. Together these proofs turn "the sieve obviously works" into "the sieve provably works, in provably `Θ(n log log n)` or `O(n)` time."

---

## Further Reading

- Hardy & Wright, *An Introduction to the Theory of Numbers* — unique factorization, Mertens' theorems, the totient and Möbius functions.
- Apostol, *Introduction to Analytic Number Theory* — Dirichlet convolution, multiplicative functions, Abel summation, the PNT.
- Tenenbaum, *Introduction to Analytic and Probabilistic Number Theory* — sharp forms of Mertens' theorems and prime-reciprocal sums.
- cp-algorithms.com — "Sieve of Eratosthenes", "Linear Sieve", "Euler's totient function", "Möbius function".
- Sibling file [`middle.md`](./middle.md) — the algorithms whose correctness is proven here.
- Sibling file [`senior.md`](./senior.md) — how the bounded-arithmetic caveats above manifest as production failure modes.
- Sibling topics `08-miller-rabin` and `09-pollard-rho` — the polynomial-in-bit-length tools for the single-huge-number regime where sieving is exponential.
- Crandall & Pomerance, *Prime Numbers: A Computational Perspective* — segmented sieving, prime counting (Meissel/Lehmer/LMO), and the number field sieve.
- Sibling files [`junior.md`](./junior.md) and [`interview.md`](./interview.md) — the intuition and the practiced coding form of these same proofs.

A closing note on rigor and practice: every proof here has an operational shadow in the implementation files. The `√n` lemma is the loop bound; the linear-sieve uniqueness theorem is the `break` statement; the multiplicative recurrences are four lines inside one loop; the Mertens bound is why `n = 10^8` is a few hundred milliseconds. Mathematics and code are the same object viewed from two sides — which is exactly the professional-level fluency this topic aims to build.
