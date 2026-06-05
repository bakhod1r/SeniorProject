# Pollard's Rho Factorization — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Setup and the Iteration
   - 1.1 Worked Trajectory: the Two Scales
2. The Birthday Paradox and Expected Cycle Length
   - 2.1 The Birthday Number, Concretely
   - 2.2 Distribution of the Cycle, Not Just the Mean
3. Why `gcd(|x − y|, n)` Reveals a Factor
   - 3.1 Which Prime Does the gcd Return?
   - 3.2 The gcd Cannot Lie
4. The Expected `O(n^{1/4})` Running Time
   - 4.1 Where the log Factors Come From
   - 4.2 The Smallest-Factor Dependence, Visualized
5. Floyd vs Brent: Correctness and Speedup
   - 5.3 Worked Floyd Trace on `n = 8051`
   - 5.4 Why the Hare Speed Is Exactly Two
   - 5.5 The O(1)-Memory Guarantee
6. Failure Cases, Collapses, and Restarts
   - 6.1 The Collapse Probability, Quantified
   - 6.2 The Role of Randomization in the Restart
   - 6.3 Distinguishing the Two Failure Outcomes in Code
7. Pollard's p−1: Smoothness and Fermat's Little Theorem
   - 7.1 Worked p−1 Example
   - 7.2 The p+1 Sibling and Generalizations
8. Combining with Primality: Complete-Factorization Correctness
   - 8.1 Worked Recursion Tree
   - 8.2 Why the Recursion Depth Is Shallow
9. Heuristics, Rigor, and What Is Actually Proven
   - 9.1 What Could Make the Heuristic Fail
   - 9.2 Relationship to Provable Sub-Exponential Methods
   - 9.3 The Verification Asymmetry as a Safety Net
10. Comparison with Other Factoring Algorithms
    - 10.1 The Two Axes of "Hard"
    - 10.2 When to Reach for Each Tool
11. Cryptographic Hardness and Lower Bounds
    - 11.1 The Bit-Length Table
    - 11.2 Why Factoring Sits in NP ∩ co-NP
    - 11.3 The Optimality of √p Within the Paradigm
    - 11.4 A Worked Hardness Estimate
12. Summary

---

## 1. Formal Setup and the Iteration

Let `n` be an odd composite integer with an unknown prime factor `p`, and assume `p ≤ √n` (the smallest prime factor satisfies this).

**Definition 1.1 (The rho map).** Fix a constant `c ∈ {1, …, n−1}` with `c ∉ {0, n−2}` and a seed `x₀ ∈ {2, …, n−1}`. Define

```
f : Z/nZ → Z/nZ,    f(x) = (x² + c) mod n,
xₖ₊₁ = f(xₖ).
```

**Definition 1.2 (Reduced sequence).** For the prime `p | n`, the **reduced** map `f_p(y) = (y² + c) mod p` on `Z/pZ` satisfies the *commutation* property

```
xₖ mod p = (the k-th iterate of f_p applied to x₀ mod p),
```

because reducing `(x² + c) mod n` further mod `p` equals `(x² + c) mod p` (`p | n`). Write `yₖ = xₖ mod p`.

**Definition 1.3 (Tail and cycle).** Any function on a finite set `S` of size `s`, iterated from a start point, produces an eventually periodic sequence: a **tail** of length `λ` (the pre-period) followed by a **cycle** of length `μ` (the period), with `λ + μ ≤ s`. The trajectory drawn out resembles the Greek letter **ρ**: a tail leading into a loop. The first repeated value occurs at index `λ + μ`.

**Lemma 1.4 (Commutation is exact).** For every `k`, `xₖ mod p = f_p^{(k)}(x₀ mod p)`, where `f_p^{(k)}` is the `k`-fold iterate of `f_p`. *Proof:* by induction on `k`. Base `k = 0` is `x₀ mod p`. Step: `x_{k+1} mod p = ((x_k² + c) mod n) mod p = (x_k² + c) mod p` (since `p | n`, reducing mod `n` then mod `p` equals reducing mod `p`) `= ((x_k mod p)² + c) mod p = f_p(x_k mod p)`, which by the inductive hypothesis is `f_p(f_p^{(k)}(x₀ mod p)) = f_p^{(k+1)}(x₀ mod p)`. ∎ This exactness — that the visible sequence's shadow mod `p` is *itself* a clean rho walk in `Z/pZ` — is what licenses the entire mod-`p` analysis even though we compute only mod `n`.

**Remark.** The entire algorithm is the interplay of two ρ-shaped orbits at different scales: the visible orbit in `Z/nZ` (large, never directly examined) and the hidden orbit in `Z/pZ` (small, size `p`), whose early collision is what we exploit. We never compute mod `p` — we only *detect its consequences* via the gcd.

### 1.1 Worked Trajectory: the Two Scales

Take `n = 8051 = 83 × 97`, `c = 1`, `x₀ = 2`, so `p = 83` is the hidden prime. The visible sequence in `Z/8051Z` and its shadow in `Z/83Z` run side by side:

```
k :   x_k (mod 8051)        x_k mod 83
0 :        2                    2
1 :        5                    5
2 :       26                   26
3 :      677                   13      (677 = 8·83 + 13)
4 :     7474                    4      (7474 = 90·83 + 4)
5 :     2839                   17      (2839 = 34·83 + 17)
```

The mod-83 column lives in a 83-element world and, by the birthday paradox, repeats after `≈ √83 ≈ 9` steps; the mod-8051 column lives in an 8051-element world and would take `≈ √8051 ≈ 90` steps to repeat. The mod-83 collision therefore fires roughly **ten times sooner**, and at that moment two visible values differ by a multiple of `83` (but not of `8051`), so the gcd surfaces a factor. This `√p ≪ √n` gap — visible here as `9 ≪ 90` — is the entire speedup, and it scales: for 64-bit `n` the gap is `2^{16}` vs `2^{32}`.

**Why we never reduce mod `p`.** We cannot reduce mod `83` because we do not know `83` — that is what we are trying to find. The gcd is the oracle that *detects* the mod-`p` collision through its visible consequence (a difference divisible by `p`) without ever naming `p`. This indirection is the conceptual heart of the method.

---

## 2. The Birthday Paradox and Expected Cycle Length

The speed of rho rests on a probabilistic model: `f_p` behaves like a **random function** on `Z/pZ`.

**Heuristic 2.1 (Random-function model).** Treat `f_p : Z/pZ → Z/pZ` as a uniformly random function. Under this model, the iterated sequence `y₀, y₁, …` first repeats a value (closes its cycle) after an expected number of steps

```
E[λ + μ] = √(π p / 8) · (1 + o(1)) ≈ 1.25 √p.
```

**Justification (birthday paradox).** After generating `t` values `y₀, …, y_{t−1}`, the probability that all are distinct is

```
∏_{i=1}^{t−1} (1 − i/p) ≈ exp(−Σ i/p) = exp(−t²/2p).
```

This drops below `1/2` near `t ≈ √(2 ln 2 · p) ≈ 1.18 √p`. So a **collision among `t` random draws from a `p`-element set appears after `≈ √p` draws**, not `≈ p` — the birthday phenomenon. The constant `√(π/8)` comes from a more careful expectation over the random-functional-graph (Flajolet-Odlyzko, *Random mapping statistics*, 1990), which also gives `E[λ] ≈ E[μ] ≈ √(πp/8)`.

**Theorem 2.2 (Rigorous lower bound, no heuristic).** Independently of the random-function model, the *worst-case* cycle length is bounded by `λ + μ ≤ p` (pigeonhole). The `√p` figure is the *expected* value under the model and matches experiment extremely well, but is not a worst-case guarantee — which is why rho is a Monte Carlo, expected-time algorithm.

### 2.1 The Birthday Number, Concretely

The classical birthday problem asks: how many people before two share a birthday among `365` days? The answer is `23` — far below `365`, indeed close to `√365 ≈ 19`. The general law is that a collision among uniform draws from an `s`-element set appears after `≈ 1.2 √s` draws. Plugging `s = p`:

| Hidden prime `p` | `√p` | `1.25 √p` (expected collision step) |
|------------------|------|--------------------------------------|
| `100` | `10` | `~13` |
| `10⁴` | `100` | `~125` |
| `10⁶` | `1000` | `~1250` |
| `10⁹` | `~31623` | `~39500` |

So even for a prime factor near `10^9` (the largest possible smallest-factor of a 64-bit semiprime), rho expects a collision in `~40000` steps — a few milliseconds. Contrast trial division, which would need `~10^9` divisions to reach `p`. The square-root saving (`√p` vs `p`) is the difference between the two columns of the analogy, made arithmetic.

### 2.2 Distribution of the Cycle, Not Just the Mean

The random-functional-graph analysis (Flajolet-Odlyzko) gives not only `E[λ + μ] ≈ √(πp/8)` but the full distributional picture: the **rho length** `λ + μ` concentrates around `√p` with a heavy-ish right tail, so individual runs vary but rarely by more than a small constant factor. The tail is what occasionally forces a restart (a run that wanders far before colliding); because the distribution decays, the **expected number of restarts is `O(1)`**, and the expected total work remains `O(√p)`. This is the formal reason the restart loop does not blow up the asymptotics: a geometric-ish number of `O(√p)`-cost attempts still has `O(√p)` expectation.

---

## 3. Why `gcd(|x − y|, n)` Reveals a Factor

**Theorem 3.1 (The factor-extraction lemma).** Suppose at some step the algorithm holds two iterates `xᵢ, xⱼ` with

```
xᵢ ≡ xⱼ (mod p)   but   xᵢ ≢ xⱼ (mod n).
```

Then `g := gcd(|xᵢ − xⱼ|, n)` satisfies `1 < g < n`, i.e. `g` is a **nontrivial factor** of `n`.

**Proof.** Since `xᵢ ≡ xⱼ (mod p)`, we have `p | (xᵢ − xⱼ)`, hence `p | gcd(|xᵢ − xⱼ|, n)` because `p | n` as well; therefore `g ≥ p > 1`. Conversely, since `xᵢ ≢ xⱼ (mod n)`, the difference `xᵢ − xⱼ` is **not** a multiple of `n`, so `n ∤ |xᵢ − xⱼ|`, and `g = gcd(|xᵢ − xⱼ|, n) < n` (a gcd of `n` with a non-multiple of `n` is a proper divisor). Combining, `1 < p ≤ g < n`. ∎

**Corollary 3.2 (When a collision mod `p` occurs).** By Section 2, the reduced sequence `yₖ = xₖ mod p` collides within `≈ √p` steps. At that collision the hypothesis `xᵢ ≡ xⱼ (mod p)` of Theorem 3.1 holds. Provided the *same* indices do not also satisfy `xᵢ ≡ xⱼ (mod n)` (the non-collapse condition), the gcd is a nontrivial factor.

**The key asymmetry.** The collision happens mod `p` (after `√p` steps) *long before* it would happen mod `n` (after `√n` steps), because `√p ≤ n^{1/4} ≪ √n`. This gap — the same difference being `0 mod p` but nonzero `mod n` — is the entire engine. The gcd is the instrument that detects "divisible by `p`, not by `n`" without ever knowing `p`.

### 3.1 Which Prime Does the gcd Return?

When the gcd fires, it returns `gcd(|xᵢ − xⱼ|, n)`, which is the product of *all* prime powers `r^e | n` such that `r^e | (xᵢ − xⱼ)`. Generically only the prime `p` whose orbit collided first divides the difference, so `g = p`. But it is possible (rare) that the difference is divisible by two prime factors at once, returning their product `p·q` — still a nontrivial factor, just a larger one. And if the difference is divisible by *every* prime factor (so `n | difference`), we get `g = n`, the collapse. The general statement: `g` is whatever portion of `n` divides the current difference, and the algorithm succeeds precisely when that portion is neither `1` (nothing) nor all of `n` (everything). The recursion then handles any composite `g` by splitting it again — rho never needs `g` to be prime.

### 3.2 The gcd Cannot Lie

A crucial robustness property: `gcd(|xᵢ − xⱼ|, n)` is *always* a genuine divisor of `n`, **no matter what** `xᵢ, xⱼ` are — even if the random-function heuristic is wrong, even with a bad `c`, even mid-collapse. This is because the gcd of `n` with *any* integer divides `n` by definition. So the only thing that can go wrong is *efficiency* (how long until a useful gcd appears), never *correctness* (a returned `d` is always a true factor). This sharp separation — heuristic time, rigorous correctness — is what makes rho safe to deploy despite its probabilistic running-time analysis: a wrong heuristic costs time, never a wrong answer.

---

## 4. The Expected `O(n^{1/4})` Running Time

**Theorem 4.1 (Expected running time).** Under the random-function heuristic (2.1), Pollard's rho finds a nontrivial factor of `n` in an expected

```
O(√p) = O(n^{1/4})    iterations,
```

where `p` is the smallest prime factor of `n` (so `p ≤ √n`). Each iteration costs `O(log² n)` bit operations (one modular multiply) plus an amortized `O(log n)` for batched gcd, giving expected `O(n^{1/4} · log² n)` bit operations total.

**Proof.** By Heuristic 2.1, the reduced sequence mod `p` collides after `E[λ + μ] ≈ √(πp/8)` steps. Cycle detection (Floyd or Brent, Section 5) locates a collision within a constant factor of `λ + μ`, i.e. `O(√p)` iterations. Since `p ≤ √n`, `√p ≤ n^{1/4}`. Each iteration performs `O(1)` modular operations on `O(log n)`-bit numbers; schoolbook modular multiplication is `O(log² n)`. Batched gcd amortizes the Euclidean cost to `O(log n)` per step. The total is `O(n^{1/4} log² n)`. ∎

**Why the smallest prime governs the cost.** rho's cost is `√(smallest p)`, not `√n` or `n^{1/4}` unconditionally. For a number with a *small* prime factor (say `p ≈ 10^6`), rho finds it in `~1000` steps regardless of how large `n` is. The `n^{1/4}` bound is the **worst case**, achieved when `n` is a semiprime `p·q` with `p ≈ q ≈ √n`, so `p ≈ √n` and `√p ≈ n^{1/4}`. This is precisely the cryptographically hard shape, and why hard 64-bit inputs are balanced semiprimes.

**Comparison to trial division.** Trial division finds the smallest prime `p` in `O(p)` operations; rho finds it in `O(√p)`. The speedup is a clean square root — `O(√p)` vs `O(p)` — which at the `n^{1/4}` vs `√n` scale is the difference between `65000` and `4 × 10^9` for 64-bit `n`.

### 4.1 Where the log Factors Come From

The full bit-complexity `O(n^{1/4} log² n)` decomposes as: `O(n^{1/4})` *iterations* (the heuristic part), each doing one **modular multiply** at `O(log² n)` with schoolbook arithmetic (or `O(log n · log log n)` with FFT-based multiplication for very large `n`, irrelevant at 64-bit). The gcd, if taken every step, would add `O(log n)` per step; **batching** (one gcd per `m ≈ 128` steps) amortizes that to `O(log n / m)` per step, effectively removing it. With Montgomery multiplication the per-multiply constant drops because the `% n` division is replaced by shifts — the `log² n` stays but with a 2–3× smaller constant. For fixed 64-bit width, all the `log` factors are constants (`log n ≤ 64`), so the practical cost is simply "`n^{1/4}` cheap iterations."

### 4.2 The Smallest-Factor Dependence, Visualized

Consider three 64-bit numbers of the same magnitude `n ≈ 10^{18}`:

| `n` shape | smallest prime `p` | rho iterations `≈ √p` |
|-----------|--------------------|-----------------------|
| `2 × (5×10^{17})` | `2` | `~1` (found by trial division) |
| `10^6 × 10^{12}` | `~10^6` | `~1000` |
| `10^9 × 10^9` (balanced) | `~10^9` | `~31000` |

All three have the *same* `n`, yet rho's cost spans four orders of magnitude — governed entirely by the **smallest** prime, not by `n`. This is why stripping small primes first is so valuable: it converts the first two rows into trivial cases, leaving only the genuinely balanced semiprime (the third row) for rho to grind on. It is also why "is `n` hard to factor?" depends on `n`'s *structure*, not just its size — the crux of RSA security.

---

## 5. Floyd vs Brent: Correctness and Speedup

### 5.1 Floyd's tortoise and hare

**Algorithm.** Maintain `x` (tortoise, `x ← f(x)`) and `y` (hare, `y ← f(f(y))`), both started at `x₀`. After `k` rounds, `x = x_k` and `y = x_{2k}`.

**Theorem 5.1 (Floyd correctness).** If the reduced sequence has tail `λ` and cycle `μ` mod `p`, then there exists `k ≤ λ + μ` with `y_{2k} ≡ x_k (mod p)`, i.e. a collision is detected. 

**Proof.** Inside the cycle, `x_a ≡ x_b (mod p)` iff `a ≡ b (mod μ)` and both `a, b ≥ λ`. The hare's index `2k` and tortoise's index `k` differ by `k`; once `k ≥ λ` and `μ | (2k − k) = k`, i.e. `k` is the least multiple of `μ` that is `≥ λ`, we get `x_{2k} ≡ x_k (mod p)`. Such a `k` exists with `k ≤ λ + μ` (take `k = μ·⌈λ/μ⌉ ≤ λ + μ`). At that round `gcd(|x_k − x_{2k}|, n)` is nontrivial unless the collapse condition holds. ∎

Floyd costs **3** evaluations of `f` per round (one tortoise, two hare).

### 5.2 Brent's improvement

**Algorithm (Brent 1980).** Keep a reference `y` fixed; advance a single pointer `x` by `f` one step at a time; after each block of `2^i` steps, set the reference `y ← x` and double the block length. A collision is detected when `x` returns to the value of the reference within a block.

**Theorem 5.2 (Brent correctness & speedup).** Brent's method detects the cycle using only **one** `f` evaluation per step (no hare), and the total number of `f` evaluations is at most `≈ (λ + μ)·(1 + ε)` with a smaller constant than Floyd. Empirically Brent uses about **25% fewer** evaluations of `f` than Floyd to find the same factor.

**Proof idea.** Floyd "wastes" the hare's second step: it advances `f` three times per useful comparison, while the actual cycle is traversed at the tortoise's rate. Brent advances `f` exactly once per step and only resets the reference at power-of-two boundaries, so the reference is always within a factor of 2 of the true distance to the cycle entry. The expected number of `f`-applications is `≈ √(πp/8)·(some constant < Floyd's)`; the precise constant analysis is in Brent's original paper. The correctness is identical: it still detects the first `x` value that re-equals a previously stored reference within a block, which mod `p` is a genuine collision. ∎

Brent also composes cleanly with **batched gcd**: accumulate `Q ← Q · |x − y| (mod n)` over a block and take one `gcd(Q, n)` per block. If any factor in the block was a multiple of `p`, then `p | Q`, so the batched gcd still surfaces it (Section 6 covers the collapse risk).

### 5.3 Worked Floyd Trace on `n = 8051`

With `f(x) = (x² + 1) mod 8051`, both pointers start at `2`. Each round: `x ← f(x)`, `y ← f(f(y))`, then `gcd(|x − y|, 8051)`.

```
round 1: x = f(2) = 5         y = f(f(2)) = f(5) = 26       gcd(|5−26|, 8051)   = gcd(21, 8051)   = 1
round 2: x = f(5) = 26        y = f(f(26)) = f(677) = 7474   gcd(|26−7474|, 8051) = gcd(7448, 8051) = 1
round 3: x = f(26) = 677      y = f(f(7474)) = … = 871       gcd(|677−871|, 8051) = gcd(194, 8051)  = 97
```

At round 3 the difference `194 = 2 × 97` shares the factor `97` with `n`, so `gcd = 97` — a nontrivial factor, found in **3 rounds** (9 `f`-evaluations). The tortoise index is `3`, the hare index `6`; the collision `x₃ ≡ x₆ (mod 97)` is exactly the `a ≡ b (mod μ)` alignment of Theorem 5.1 (`μ | (6 − 3) = 3`). Note that rho surfaced `97`, not the smaller `83` — whichever prime's collision aligns first wins, and either is a valid split. The expected step count `√(min(83,97)) ≈ 9` predicts a handful of rounds, matching the observed `3`.

### 5.4 Why the Hare Speed Is Exactly Two

Floyd's hare advances at **twice** the tortoise's rate for a reason: inside a cycle of length `μ`, the indices `2k` (hare) and `k` (tortoise) become congruent mod `μ` for the *first* time at `k = μ⌈λ/μ⌉ ≤ λ + μ`, guaranteeing detection within `O(λ + μ)` rounds. A hare speed of `3` (or any constant `> 1`) also works, but `2` minimizes wasted `f`-evaluations among the simple two-pointer schemes while keeping the "indices differ by `k`" invariant clean. Brent abandons the two-pointer idea entirely, which is how it shaves the constant further.

### 5.5 The O(1)-Memory Guarantee

Both Floyd and Brent detect the cycle using a **constant** number of integer variables — no hash set of past values, no growing list. This is essential: a naive collision detector that stores all `√p ≈ n^{1/4}` past values to check for repeats would use `O(n^{1/4})` memory, which for a 64-bit number is `~65000` stored integers — acceptable here but disastrous if `n^{1/4}` were larger, and entirely unnecessary. The two-pointer (Floyd) and reference-reset (Brent) schemes detect the cycle *implicitly* from the pointer relationship, trading the stored-history space for a constant factor more `f`-evaluations. The `O(1)`-memory property is one of rho's defining advantages over collision search by tabulation, and it composes with batched gcd (which also needs only a single running product `Q` and the batch-start value `ys`).

---

## 6. Failure Cases, Collapses, and Restarts

rho is a *Monte Carlo* algorithm; it can fail to produce a useful factor in a single run.

**Failure 6.1 (No nontrivial gcd within budget).** For a particular `(c, x₀)`, the reduced orbit mod `p` may have a long tail/cycle, or the algorithm's comparison schedule may not align with a collision quickly. The gcd stays `1` past the iteration budget. **Remedy:** restart with a fresh random `(c, x₀)`; the expected number of restarts is `O(1)`.

**Failure 6.2 (Collapse, `gcd = n`).** The collision detected mod `p` simultaneously satisfies `xᵢ ≡ xⱼ (mod n)` — the orbit mod `n` also closed at those indices. Then `n | (xᵢ − xⱼ)`, so `gcd = n`, the trivial divisor. This happens when **all** prime factors of `n` collided in the same step (or, with batching, the batch product captured every prime). **Remedy:** with Floyd, restart with new `c`; with batched gcd, *rewind* to the batch start and re-walk one step at a time, taking a per-step gcd — the first step whose individual difference is a multiple of `p` (but not of every prime) yields the factor.

**Proposition 6.3 (Why distinct primes usually separate).** For `n = p·q` with `p < q`, the orbits mod `p` and mod `q` are (heuristically) independent. The mod-`p` orbit collides after `≈ √p` steps, the mod-`q` orbit after `≈ √q ≥ √p`. The mod-`p` collision therefore almost always occurs **strictly earlier**, at a step where the mod-`q` difference is still nonzero — so `gcd = p` (nontrivial), not `n`. A simultaneous collision (collapse) requires both orbits to close at the same step, an `O(1/√(min(p,q)))`-probability coincidence per detection, hence rare. This is the formal reason collapses are infrequent and restarts cheap.

**Bad constants.** `c = 0` gives `f(x) = x²`, which has fixed points `0, 1` and small-order orbits, breaking the random-function model. `c = n − 2` with seed `2` is a documented degenerate pair. Excluding these and randomizing restores the heuristic.

### 6.1 The Collapse Probability, Quantified

Suppose `n = p·q` with `p < q`. At the step where the mod-`p` orbit first collides (around step `√p`), what is the chance the mod-`q` orbit *also* collides simultaneously (causing `gcd = n`)? Under independence, the mod-`q` orbit has visited only `≈ √p ≪ √q` values, so it has not yet entered its own cycle with high probability; a coincidental mod-`q` collision at that exact step has probability `≈ √p / q ≤ 1/√q`. For 64-bit semiprimes (`q ≈ 10^9`), that is `≈ 3 × 10^{-5}` per detection — so collapses occur in well under one run in ten thousand, and when they do, batched-gcd recovery resolves most of them without even a restart. This is why a production rho almost never restarts in practice.

### 6.2 The Role of Randomization in the Restart

It is essential that restarts use **fresh randomness** in *both* `c` and the seed `x₀`. The map `f` and its starting point jointly determine the orbit; reusing either re-traces a correlated trajectory that tends to fail the same way (a long tail mod `p`, say, is a property of the orbit, which a new `c` reshapes but the same `c` preserves). Drawing `(c, x₀)` independently each attempt makes the attempts *probabilistically independent*, which is exactly what the `O(1)`-expected-restarts analysis (Section 2.2) requires. A subtle bug is to randomize only `c` while fixing `x₀ = 2`; this is usually fine but loses independence in edge cases — randomize both.

### 6.3 Distinguishing the Two Failure Outcomes in Code

A correct driver must branch on the gcd's value, not just "did we find something":

```
d = gcd(|x − y|, n)
if d == 1:  continue              # no collision yet — keep iterating
if d == n:  goto restart_or_recover   # COLLAPSE — never return n
else:       return d              # 1 < d < n — the factor
```

Conflating `d == n` with success and returning `n` as a "factor" silently corrupts the entire factorization (it asserts `n` divides `n` nontrivially, which then recurses on `n/n = 1` and the original `n` again — an infinite loop or a dropped factor). The three-way branch is mandatory; it mirrors the three-way gcd outcome that is the algorithm's only decision point.

---

## 7. Pollard's p−1: Smoothness and Fermat's Little Theorem

Pollard's **p−1** method (Pollard 1974) is a different factoring algorithm that succeeds under a *smoothness* condition, complementary to rho's `√p` dependence.

**Definition 7.1 (B-smooth).** An integer is **B-smooth** if all its prime factors are `≤ B`.

**Theorem 7.2 (p−1 correctness).** Let `p | n` be prime such that `p − 1` is `B`-smooth. Let `M = lcm(1, 2, …, B)` (equivalently the product of prime powers `≤ B`). Then for any `a` with `gcd(a, n) = 1`,

```
(p − 1) | M   ⟹   a^M ≡ 1 (mod p)   ⟹   p | (a^M − 1)   ⟹   p | gcd(a^M − 1, n).
```

If additionally `q − 1 ∤ M` for another prime factor `q`, then `gcd(a^M − 1, n)` is a **nontrivial** factor.

**Proof.** By Fermat's little theorem, `a^{p−1} ≡ 1 (mod p)` for `a` coprime to `p`. Since `p − 1` is `B`-smooth, every prime power dividing `p − 1` is `≤ B`, so `(p − 1) | M`. Write `M = (p − 1)·t`; then `a^M = (a^{p−1})^t ≡ 1^t = 1 (mod p)`, so `p | (a^M − 1)`. As `p | n`, we get `p | gcd(a^M − 1, n)`. If some other factor `q` has `q − 1 ∤ M`, then generically `q ∤ (a^M − 1)`, keeping the gcd below `n`. ∎

**Complexity.** Computing `a^M mod n` by repeated modular exponentiation over the prime powers up to `B` costs `O(B / ln B · log B · log² n) = O(B · log² n)` roughly (one modpow per prime). The method finds `p` in time depending on the **smoothness bound** `B` needed, *not* on `√p`. Thus p−1 beats rho when `p − 1` is smooth even if `p` is large; it **fails entirely** when no factor has smooth `p − 1`.

**Cryptographic consequence.** RSA primes are chosen as **safe primes** `p = 2q + 1` (q prime), making `p − 1 = 2q` non-smooth (its largest prime factor `q` is huge). This deliberately defeats p−1 — a design requirement, not an accident.

### 7.1 Worked p−1 Example

Let `p = 1009` (prime). Then `p − 1 = 1008 = 2⁴ · 3² · 7`, which is `7`-smooth (largest prime factor `7`). Pick `q = 9973` (a prime with `q − 1 = 9972 = 2² · 3 · 831 = 2² · 3 · 3 · 277`, whose largest prime factor `277` is **not** small). Set `n = p · q = 1009 · 9973 = 10062757`.

Run p−1 with `B = 10` and `a = 2`. The accumulated exponent absorbs the prime powers `≤ 10`: `2³ (=8 ≤ 10)`, `3² (=9 ≤ 10)`, `5`, `7`. Since `1008 = 2⁴·3²·7` and `M = lcm(1..10)` contains `2³·3²·5·7`, we need `2⁴` — note `1008` has `2⁴` but `lcm(1..10)` only supplies `2³`; using the standard "highest prime power `≤ B`" rule we get `2³`, *not* enough for the factor `2⁴` in `1008`. Bumping `B` to `16` supplies `2⁴`, and then `1008 | M`, so:

```
a^M ≡ 1 (mod 1009)   ⟹   1009 | (a^M − 1)   ⟹   gcd(a^M − 1, n) = 1009.
```

Meanwhile `q − 1 = 9972` has the prime factor `277 > B`, so `9972 ∤ M` and `q ∤ (a^M − 1)`, keeping the gcd at exactly `1009 < n`. p−1 cracked `n` using `B ≈ 16` — independent of `√1009 ≈ 32`, and it would still be `~16` even if `p` were `10^{18}` as long as `p − 1` stayed `16`-smooth. This is the "smoothness, not size" advantage in miniature, and it also shows the subtlety of choosing `B` large enough to cover the full prime-power multiplicity (here the `2⁴` in `1008`).

### 7.2 The p+1 Sibling and Generalizations

Williams' **p+1** method is the dual: it succeeds when `p + 1` is smooth, using Lucas-sequence arithmetic in place of plain exponentiation. The **Elliptic Curve Method** (ECM) generalizes the idea once more — it works in the group of points on a random elliptic curve mod `p`, whose order is `p + 1 − t` for a small `|t| ≤ 2√p`. Because the curve (hence the group order) can be *re-randomized* freely, ECM gets many independent chances at a smooth group order, removing p−1's "all or nothing" dependence on the single fixed value `p − 1`. This is precisely why ECM extends the reach from `√p ≈ n^{1/4}` factors (rho) to ~40-digit factors: it is "p−1 with a tunable, re-rollable group."

---

## 8. Combining with Primality: Complete-Factorization Correctness

rho splits; to fully factor we recurse with a primality test as the base case.

**Algorithm 8.1 (Complete factorization).**
```
FACTOR(n):
  strip small primes by trial division, recording them
  REC(remaining n)

REC(m):
  if m == 1: return
  if MILLER_RABIN(m): record m (prime leaf); return
  if m == b^k (perfect power): REC(b) with multiplicities ×k; return
  d := RHO(m)                     # 1 < d < m, with restarts
  REC(d); REC(m / d)
```

**Theorem 8.2 (Correctness).** `FACTOR(n)` returns the multiset of prime factors of `n` (with multiplicity), i.e. the unique factorization guaranteed by the Fundamental Theorem of Arithmetic.

**Proof.** *Soundness of splits:* `d = gcd(|xᵢ − xⱼ|, n)` divides `n` (gcd of `n` with another integer), and the restart loop guarantees `1 < d < m`, so `d` and `m/d` are genuine cofactors with `d·(m/d) = m`. *Leaves are prime:* a node is recorded only when Miller-Rabin reports prime; for `m < 3.3 × 10^{24}` the witness set `{2, …, 37}` makes Miller-Rabin **deterministic** (no false positives), so every leaf is genuinely prime. *Product preserved:* by induction on the recursion tree, the product of the leaves of `REC(m)` equals `m` (base case `m` prime or `1`; inductive step `m = d·(m/d)` with each subtree multiplying to its argument). *Multiplicities:* preserved because both cofactors are fully expanded and the perfect-power branch multiplies the base's factorization by `k`. Hence the returned multiset multiplies to `n` and consists solely of primes — the unique prime factorization. ∎

**Theorem 8.3 (Termination).** `FACTOR(n)` halts. *Proof.* Each `RHO` split produces `d, m/d` both strictly less than `m` (since `1 < d < m`), so the recursion operates on strictly decreasing positive integers, a well-founded order; Miller-Rabin terminates the recursion at every prime and at `1`. The perfect-power branch reduces to a strictly smaller base. Thus the recursion tree is finite. ∎

**On probabilistic vs deterministic primality.** For 64-bit `n`, deterministic Miller-Rabin makes Theorem 8.2 *exact* — no probabilistic caveat. For larger `n`, Miller-Rabin with `t` random bases has one-sided error `≤ 4^{−t}` per composite; choosing `t ≈ 50` (or using BPSW, for which no counterexample is known below `2^{64}` and which is conjectured infallible) drives the failure probability below cryptographic thresholds. The *only* way the factorization can be wrong is a Miller-Rabin false "prime"; the split logic itself is deterministically correct.

**Multiplicity correctness, formally.** A repeated prime `p^e | n` is recovered with its full multiplicity `e` because the recursion does not deduplicate: if `RHO` splits `m = p · (m/p)` where both cofactors are divisible by `p`, *both* subtrees independently expand their copies of `p`, and the leaf multiset accumulates `e` copies total. The perfect-power branch is the one place multiplicity is computed in bulk: `m = b^k` records `k` copies of each prime in `b`'s factorization, equivalent to (but faster than) `k` separate rho splits. Either way the final exponent of each prime equals its true multiplicity in `n` — the multiplication principle applied to the recursion tree.

### 8.1 Worked Recursion Tree

Factor `n = 360360 = 2³ · 3² · 5 · 7 · 11 · 13`. The pipeline first strips small primes by trial division up to a bound (say 1000), which already removes everything here because all factors are tiny — but to illustrate the recursion, suppose the small-prime bound were just `2`, so only the `2³` is stripped, leaving `m = 45045 = 3² · 5 · 7 · 11 · 13`:

```
REC(45045)                         # composite (Miller-Rabin: not prime)
 ├─ d = RHO(45045) = 5             # one nontrivial factor (could be any)
 ├─ REC(5)                         # Miller-Rabin: prime → record 5
 └─ REC(9009)  (= 45045 / 5)       # composite
     ├─ d = RHO(9009) = 9          # not prime; note 9 = 3² is itself composite
     ├─ REC(9)                     # composite
     │   ├─ perfect-power check: 9 = 3² → record 3, 3
     │   (or RHO(9)=3, REC(3)+REC(3) → 3, 3)
     └─ REC(1001) (= 9009 / 9)     # composite
         ├─ d = RHO(1001) = 7
         ├─ REC(7)                 # prime → record 7
         └─ REC(143) (= 1001 / 7)  # composite
             ├─ d = RHO(143) = 11
             ├─ REC(11)            # prime → record 11
             └─ REC(13)            # prime → record 13
```

Collecting the leaves (plus the stripped `2³`): `{2, 2, 2, 3, 3, 5, 7, 11, 13}`. The product is `360360 = n` ✓ and every leaf is Miller-Rabin-prime ✓ — the two self-certifying invariants of Section 9. Observe that rho returned a *composite* `9` at one node; that is fine — the recursion simply splits it again. rho is never required to return a prime; Miller-Rabin at each node decides when to stop. Note also that `RHO(45045)` could have returned `9` or `15` or `7` instead of `5`; *any* nontrivial split is correct, and the tree shape varies run to run while the leaf multiset is invariant.

### 8.2 Why the Recursion Depth Is Shallow

The recursion tree has at most `Ω(log n)` leaves (one per prime factor with multiplicity, and `n` has `O(log n)` prime factors counted with multiplicity since each is `≥ 2`). Its depth is `O(log n)` as well, because each split at least halves the larger cofactor's bit-length in the worst case and removes a prime factor in the typical case. So the *overhead* of the recursion is negligible; the cost is entirely in the `RHO` calls, dominated by the single hardest split — finding the **largest** prime factor, which is the slowest `√p`. This is why the full-factorization cost is `O(P^{1/4} polylog)` where `P` is the largest prime factor (and `P^{1/4} ≤ n^{1/4}`).

---

## 9. Heuristics, Rigor, and What Is Actually Proven

It is important to separate the **heuristic** parts from the **rigorous** parts.

| Claim | Status |
|-------|--------|
| `gcd(|xᵢ − xⱼ|, n)` is a factor when `xᵢ ≡ xⱼ (mod p)`, `≢ (mod n)` | **Rigorously proven** (Theorem 3.1) |
| Complete-factorization correctness given a correct primality test | **Rigorously proven** (Theorem 8.2) |
| Termination | **Rigorously proven** (Theorem 8.3) |
| Expected `O(n^{1/4})` running time | **Heuristic** (random-function model 2.1) |
| Collapses are rare | **Heuristic** (Proposition 6.3) |
| `p − 1` correctness | **Rigorously proven** (Theorem 7.2) |

**The honest statement.** Pollard's rho is a *heuristic* (Monte Carlo) algorithm: its **correctness when it returns** is rigorous (any returned `d` truly divides `n`), but its **running time** rests on the unproven assumption that `x² + c` behaves like a random function mod `p`. No one has proven an `o(√n)` *worst-case* bound for rho. In practice the heuristic is spectacularly accurate — rho factors 64-bit numbers in the predicted `~n^{1/4}` steps essentially always — but the `√p` time is *expected*, not guaranteed. This is the standard situation for randomized number-theoretic algorithms.

**Why `x² + c` and not a linear map.** A linear map `f(x) = ax + b mod p` is *not* random enough: its orbit length is the multiplicative order of `a`, fully determined and often short, with no birthday-style collision structure. The quadratic `x² + c` is the simplest polynomial whose orbits empirically match the random-function statistics (Flajolet-Odlyzko). Higher-degree maps work too but cost more per step without improving the `√p` exponent.

### 9.1 What Could Make the Heuristic Fail

The random-function model could in principle be violated for *adversarial* `n` constructed so that `x² + c` has anomalously long orbits mod every prime factor. No such practically harmful construction is known, and for "random" or "natural" inputs (the overwhelming case) the model holds tightly. The safety net is structural: even if one `(c, x₀)` traces a pathological orbit, the **restart** with fresh randomness draws an *independent* orbit, and the probability that many independent draws are all pathological decays geometrically. So the heuristic's potential failure on a single attempt is laundered into a near-certain success across `O(1)` expected attempts — the algorithm is robust even though its single-run analysis is heuristic.

### 9.2 Relationship to Provable Sub-Exponential Methods

Unlike rho, the Quadratic Sieve and GNFS have *rigorously analyzable* (or at least standard-conjecture-backed) sub-exponential running times, but they are far more complex and only worthwhile for large `n`. rho occupies a deliberate niche: maximal simplicity and `O(1)` memory in exchange for a heuristic (but experimentally bulletproof) `√p` time on small-to-medium `n`. The trade is almost always worth it for 64-bit work, where a rigorous bound would buy nothing practical and the heuristic never misbehaves.

### 9.3 The Verification Asymmetry as a Safety Net

There is a profound asymmetry that makes the heuristic acceptable: factoring is **hard to do but easy to check**. Once rho returns a candidate factor `d`, a single division verifies `d | n` in `O(log² n)`, and Miller-Rabin certifies primality. So even though the *time* to find `d` is only heuristically bounded, the *result* is verified rigorously and cheaply. This "easy to verify, hard to find" structure (the same structure that puts factoring in NP) means a heuristic search algorithm carries no correctness risk — the verification step catches any conceivable failure of the search. It is the formal reason the field tolerates heuristic factoring algorithms that it would never tolerate for, say, a heuristic sorting algorithm whose output could not be cheaply re-checked.

---

## 10. Comparison with Other Factoring Algorithms

| Algorithm | Time to find a factor | Depends on | Regime |
|-----------|----------------------|-----------|--------|
| Trial division | `O(p)` | smallest prime `p` | tiny `n` / small factors |
| **Pollard's rho** | `O(√p) = O(n^{1/4})` expected | `√(smallest p)` | up to ~`10^{19}` (64-bit) |
| **Pollard's p−1** | `O(B log² n)` | smoothness of `p − 1` | factors with smooth `p − 1` |
| Williams' p+1 | smoothness of `p + 1` | smoothness of `p + 1` | niche complement to p−1 |
| Elliptic Curve Method (ECM) | `L_p[1/2, √2]` sub-exp in **factor** size | size of smallest factor | factors up to ~`10^{40}` |
| Quadratic Sieve (QS) | `L_n[1/2, 1]` sub-exp in **`n`** | size of `n` | up to ~100 digits |
| General Number Field Sieve (GNFS) | `L_n[1/3, (64/9)^{1/3}]` | size of `n` | RSA-size semiprimes |

where `L_n[s, c] = exp((c + o(1)) (ln n)^s (ln ln n)^{1−s})`.

**Reading the table.** rho and ECM are **factor-size**-sensitive (fast when a *small* factor exists); QS and GNFS are **`n`-size**-sensitive (their cost ignores factor structure, so they are the only viable tools for balanced semiprimes with two huge primes, i.e. RSA). rho's `O(n^{1/4})` is *exponential in the bit-length* of `n`, which is why it dominates for 64-bit but is useless for 2048-bit. ECM extends rho's "small-factor-fast" philosophy to ~40-digit factors via the richer group structure of elliptic curves (more chances to find a smooth group order), which is why it is the next rung after rho.

### 10.1 The Two Axes of "Hard"

Factoring difficulty has two independent axes, and the algorithm zoo splits along them:

- **Factor-size axis** (rho, p−1, ECM): cost grows with the *smallest* (or smoothest) prime factor. These win when `n` has a small or structurally weak factor, *regardless of how large `n` is*. A 2048-bit number with a 50-bit factor falls to ECM in seconds.
- **Modulus-size axis** (QS, GNFS): cost grows with `n` itself, independent of factor structure. These are the only tools for *balanced* semiprimes where both factors are large — and they are sub-exponential, not exponential, in the modulus size.

RSA security depends on *both* axes being maxed out: large balanced primes (defeating the factor-size axis) and a large enough modulus that even GNFS (the best on the modulus-size axis) is infeasible. Weaken either — a small factor, or too small a modulus — and the corresponding axis's tool wins. This two-axis view explains exactly why key generation has so many constraints (large primes, balanced sizes, safe primes against p−1, avoidance of special forms exploitable by SNFS).

### 10.2 When to Reach for Each Tool

A practical factoring driver escalates: (1) trial-divide small primes; (2) Miller-Rabin (stop if prime); (3) a quick p−1/p+1 pass (cheap, catches smooth-structure factors); (4) Pollard's rho (the 64-bit workhorse); (5) ECM with increasing curve counts (factors up to ~40 digits); (6) QS/GNFS (only for genuinely large balanced semiprimes, and only in specialized software). For the 64-bit regime this entire document targets, steps (1)–(4) suffice and run in microseconds; (5)–(6) are the escalation path for the rare larger input.

---

## 11. Cryptographic Hardness and Lower Bounds

**The hard instance.** rho's worst case is a **balanced semiprime** `n = p·q` with `p ≈ q ≈ √n`. Then the smallest prime is `≈ √n`, so rho needs `≈ √(√n) = n^{1/4}` iterations. For `n ≈ 2^{2048}` this is `≈ 2^{512}` — far beyond the `≈ 2^{80}`–`2^{100}` boundary of feasible computation, and beyond `2^{266}` (atoms in the observable universe). **rho cannot factor RSA-2048.**

**Scaling law.** rho's cost `2^{(bitlen n)/4}` *quadruples in the exponent* as `n`'s bit-length grows: each extra bit of `n` multiplies the work by `2^{1/4} ≈ 1.19`. Doubling the key length squares the rho work. This exponential-in-bit-length behavior is shared by all `n^{1/4}`-class methods and is exactly why sub-exponential sieves (GNFS, `L_n[1/3]`) are the real threat model for RSA, not rho.

**Lower bounds.** No unconditional lower bound proves factoring is hard — `P` vs `NP` and the precise complexity of factoring are open (factoring is in `NP ∩ co-NP`, not known `NP`-complete, and is in `BQP` via Shor's algorithm). What *is* known: rho's `√p` is the *expected* cost under the random-function model, and no better *generic* black-box collision-finding can beat `√p` (the birthday bound is tight for collision search). So within the "iterate a pseudo-random map and detect a collision" paradigm, `O(√p)` is optimal; surpassing it requires a *different* paradigm (sieving, elliptic curves, quantum).

**Quantum aside.** Shor's algorithm factors `n` in polynomial time `O(log³ n)` on a quantum computer, collapsing the entire classical hierarchy above. rho, p−1, ECM, and GNFS are all classical; Shor is the reason post-quantum cryptography abandons factoring-based schemes. For classical machines, the hierarchy of Section 10 stands.

### 11.1 The Bit-Length Table

Making the scaling concrete, here is rho's expected work `≈ 2^{(bitlen)/4}` against the size of `n`:

| `n` bit-length | rho work `≈ 2^{bits/4}` | Feasible? |
|----------------|--------------------------|-----------|
| 32 | `2⁸ ≈ 256` | trivially |
| 64 | `2^{16} ≈ 65000` | microseconds |
| 96 | `2^{24} ≈ 1.7 × 10⁷` | sub-second |
| 128 | `2^{32} ≈ 4 × 10⁹` | seconds–minutes |
| 256 | `2^{64}` | borderline (years on one core) |
| 512 | `2^{128}` | infeasible |
| 2048 (RSA) | `2^{512}` | utterly infeasible |

The cliff between "microseconds" (64-bit) and "infeasible" (512-bit+) is the practical statement of the exponential-in-bit-length law. Note that the work depends on the **smallest** prime, so a 2048-bit number with a tiny factor still falls instantly — RSA's security comes specifically from choosing *two large balanced* primes so the smallest factor is `≈ √n ≈ 2^{1024}`.

### 11.2 Why Factoring Sits in NP ∩ co-NP

The *decision* version ("does `n` have a factor `≤ k`?") is in **NP** (a factor is a short certificate, verified by one division) and in **co-NP** (the full prime factorization, each part certified prime by a Pratt certificate or AKS, certifies the *absence* of any other factor). A problem in NP ∩ co-NP is widely believed *not* to be NP-complete (else NP = co-NP), which is consistent with factoring being "hard but probably not the hardest." rho, p−1, ECM, and GNFS are all attempts to beat the trivial `O(√n)` certificate-search; none makes factoring polynomial classically, and the gap between the best classical (`L_n[1/3]`) and Shor's quantum-polynomial `O(log³ n)` is the entire basis of RSA's security model.

### 11.3 The Optimality of √p Within the Paradigm

rho's `O(√p)` is not merely a good bound — it is **optimal for generic collision search**. A black-box algorithm that only evaluates a pseudo-random function and looks for a repeated value cannot find a collision in a `p`-element set faster than `Θ(√p)` queries (this is the birthday lower bound, and it is matched by rho). Therefore any asymptotic improvement must *exploit structure* the generic model ignores: sieving exploits the multiplicative structure of smooth numbers; ECM exploits elliptic-curve group orders; Shor exploits quantum period-finding. rho deliberately uses *no* structure, which is why it is so simple — and why it cannot be sped up within its own paradigm.

### 11.4 A Worked Hardness Estimate

Estimate the time to factor a balanced 80-bit semiprime `n = p·q` with `p ≈ q ≈ 2^{40}` on one modern core (`~10^9` rho iterations/second with a tuned Montgomery loop). The smallest prime is `≈ 2^{40}`, so rho needs `≈ √(2^{40}) = 2^{20} ≈ 10^6` iterations — about **1 millisecond**. Doubling to a 160-bit balanced semiprime (`p ≈ 2^{80}`) needs `≈ 2^{40} ≈ 10^{12}` iterations — about **1000 seconds**, ~17 minutes. At 320 bits (`p ≈ 2^{160}`) it is `2^{80} ≈ 10^{24}` iterations — **millions of years**. The cliff is steep and exactly as the `2^{bitlen/4}` law predicts: every 80 bits of modulus adds `2^{20} ≈ 10^6×` to the work. RSA-2048's `2^{512}` sits unimaginably far past the right edge of this progression, which is why rho is a 64-bit tool and GNFS is the crypto-scale tool.

---

## 12. Summary

- **The iteration.** `xₖ₊₁ = (xₖ² + c) mod n` reduces mod a hidden prime `p | n` to a ρ-shaped orbit in `Z/pZ` of size `p`; we exploit its early collision without ever computing mod `p`.
- **Birthday paradox.** A random function on `p` points collides after `≈ √(πp/8) ≈ 1.25√p` steps (Flajolet-Odlyzko), the source of the square-root speedup over trial division's `O(p)`.
- **Factor extraction (rigorous).** If `xᵢ ≡ xⱼ (mod p)` but `≢ (mod n)`, then `gcd(|xᵢ − xⱼ|, n)` is a nontrivial factor — proven directly from the divisibility definitions. The gap `√p ≪ √n` is the whole engine.
- **Expected `O(n^{1/4})`.** With `p ≤ √n` the smallest prime, the collision (hence the factor) appears in `O(√p) = O(n^{1/4})` iterations under the random-function heuristic; the worst case is a balanced semiprime.
- **Floyd vs Brent.** Both detect the cycle in `O(1)` memory and `O(λ + μ)` steps; Brent uses ~25% fewer `f` evaluations and batches the gcd cleanly. Correctness rests on cycle structure mod `p`.
- **Failures & restarts.** rho is Monte Carlo: `gcd = 1` (no collision yet) or `gcd = n` (collapse) trigger a fresh random `(c, x₀)`; collapses are rare because distinct primes' orbits collide at different steps (Proposition 6.3).
- **p−1 (rigorous).** Succeeds when `p − 1` is smooth, via Fermat's little theorem; complementary to rho, defeated by safe primes — proven, not heuristic.
- **Complete factorization (rigorous).** rho + Miller-Rabin + trial division + perfect-power check yields the unique prime factorization, with proven soundness, completeness, and termination; only Miller-Rabin contributes any (controllable) error, and none for 64-bit.
- **Hardness.** rho's `O(n^{1/4})` is exponential in bit-length: trivial for 64-bit, hopeless for RSA-2048 (`≈ 2^{512}`). Sub-exponential sieves (GNFS) and quantum (Shor) are the only paths to large-`n` factoring.
- **Two axes of hardness.** Factoring difficulty splits into factor-size (rho/ECM win on small/weak factors) and modulus-size (QS/GNFS, the only tools for balanced semiprimes). RSA maxes out both axes — large balanced safe primes.
- **Correctness vs speed separation.** Every correctness theorem (factor extraction, completeness, termination, p−1) is rigorous; every running-time claim is heuristic. A wrong heuristic costs time, never a wrong answer — the property that makes rho safe to deploy.

### Complexity Cheat Table

| Quantity | Value | Status |
|----------|-------|--------|
| Expected iterations to split | `O(√p) = O(n^{1/4})` | heuristic |
| Cost per iteration | `O(log² n)` (one mulmod) | rigorous |
| Memory | `O(1)` | rigorous |
| Worst-case iterations | `O(p)` (pigeonhole) | rigorous |
| Full factorization (expected) | `O(n^{1/4} · polylog n)` | heuristic time, rigorous correctness |
| p−1 (smooth `p − 1`) | `O(B log² n)` | rigorous |
| Verifying a returned factor | `O(log² n)` (one division) | rigorous |
| Brent vs Floyd `f`-evals | `~0.75×` Floyd | empirical |
| Expected number of restarts | `O(1)` | heuristic |
| RSA-2048 via rho | `≈ 2^{512}` ops | infeasible |

### Closing Notes

- The **correctness** of rho (any returned `d | n`, `1 < d < n`) and of the full factorization (Theorem 8.2) is fully rigorous; the **`√p` running time** is a heuristic resting on the random-function model — the standard, experimentally-validated situation for this algorithm family.
- The **birthday bound** is the deep reason for the `√p` exponent, and it is tight for generic collision search — so `O(√p)` is optimal within the iterate-and-detect paradigm; beating it requires sieving, elliptic curves, or quantum methods (Sections 10–11).
- **Smoothness** (p−1, Section 7) is an orthogonal attack surface, which is why secure key generation must control *both* factor size (against rho/ECM) and `p ± 1` smoothness (against p±1) — hence safe primes.
- **Two-scale structure** (Section 1): the visible orbit mod `n` and the hidden orbit mod `p` are linked by exact commutation (Lemma 1.4); the gap `√p ≪ √n` between their cycle lengths is the algorithm's entire reason for being.
- **Correctness is unconditional** (Section 3.2): the gcd *always* returns a true divisor regardless of the heuristic, so a wrong model costs only time, never a wrong factor — the property that makes rho safe to ship.
- **Verification asymmetry** (Section 9.3): factoring is hard to do but easy to check (one division, one Miller-Rabin), so the heuristic search carries no correctness risk — the verification step rigorously catches any failure of the probabilistic find.

### Theorem Index

| # | Statement | Type |
|---|-----------|------|
| 1.4 | Commutation `xₖ mod p = f_p^{(k)}(x₀ mod p)` is exact | Lemma (rigorous) |
| 2.1 | Expected cycle length `≈ √(πp/8)` | Heuristic |
| 2.2 | Worst-case cycle length `≤ p` | Rigorous |
| 3.1 | `gcd(|xᵢ − xⱼ|, n)` is a nontrivial factor | Rigorous |
| 4.1 | Expected `O(n^{1/4})` iterations | Heuristic time |
| 5.1 | Floyd detects the collision | Rigorous |
| 5.2 | Brent's ~25% fewer evaluations | Rigorous + empirical |
| 6.3 | Distinct primes separate (collapses rare) | Heuristic |
| 7.2 | p−1 correctness via Fermat | Rigorous |
| 8.2 | Complete-factorization correctness | Rigorous |
| 8.3 | Termination | Rigorous |

The pattern across the index is unmistakable: every *correctness* statement is rigorous, every *running-time* statement is heuristic. That is the precise, honest characterization of Pollard's rho — a Monte Carlo algorithm whose outputs are always trustworthy and whose speed is reliably (but not provably) `n^{1/4}`.

Foundational references: Pollard (1975) for rho and (1974) for p−1; Brent (1980) for the improved cycle detection; Flajolet-Odlyzko (1990) *Random mapping statistics* for the `√(πp/8)` constants; Montgomery (1985) for modular multiplication; Lenstra (1987) for ECM; Crandall-Pomerance *Prime Numbers: A Computational Perspective* for the complete theory; and sibling topics `01-gcd-euclidean` and `08-miller-rabin`.
