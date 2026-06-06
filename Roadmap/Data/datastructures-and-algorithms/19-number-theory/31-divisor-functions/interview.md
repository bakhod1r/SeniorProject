# Divisor Functions — Interview Preparation

Divisor functions are a favorite interview topic because they reward one crisp insight — *"a divisor is an independent choice of exponent for each prime, so `d(n) = Π(a_i+1)` and `σ(n) = Π(1+p+…+p^a)`"* — and then probe whether you can (a) derive the formulas from factorization, (b) recognize **multiplicativity** and use it, (c) compute the functions for *all* `n ≤ N` with a sieve and analyze its `O(N log N)` cost, (d) upgrade to the **linear sieve** for `O(N)`, and (e) know when to *stop* sieving and factor a single number instead. This file is a tiered question bank, behavioral prompts, and a coding challenge with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Task | Tool | Complexity |
|------|------|------------|
| `d(n)`/`σ(n)` for one number | factor, then formula | `O(√n)` |
| `d(n)`/`σ(n)` naive (one number) | walk `1..√n`, pair divisors | `O(√n)` |
| `d(m)`/`σ(m)` for all `m ≤ N` | divisor sieve | `O(N log N)` |
| Same, true linear | linear sieve + exponent tracking | `O(N)` |
| Query after sieving | array lookup | `O(1)` |
| Range sum of `σ` | sieve + prefix sums | `O(1)` per query |
| `d`/`σ` of one huge `n` | factor via Pollard's rho (topic `09`) | `~O(n^{1/4})` |

Core formulas (from `n = p₁^{a₁} ⋯ p_k^{a_k}`):

```text
d(n)   = Π (a_i + 1)
σ(n)   = Π (p_i^{a_i+1} − 1)/(p_i − 1) = Π (1 + p_i + … + p_i^{a_i})
σ_k(n) = Π (p_i^{k(a_i+1)} − 1)/(p_i^k − 1)
d = σ₀ = 1 * 1,   σ = σ₁ = id * 1     (Dirichlet convolution)
```

Key facts:
- A divisor of `n` is `Π p_i^{b_i}` with `0 ≤ b_i ≤ a_i` — independent choices, so count = product.
- `d` and `σ` are **multiplicative** (`f(ab)=f(a)f(b)` when `gcd(a,b)=1`), not completely multiplicative.
- Divisor sieve: for each divisor `d`, stride its multiples; total work `Σ N/d ≈ N ln N`.
- Always 64-bit `σ`; `d(n)` is small (16-bit suffices).
- Perfect ⇔ `σ(n) = 2n`; abundant `>`, deficient `<`.

---

## Junior Questions (15 Q&A)

### J1. What are `d(n)` and `σ(n)`?
`d(n)` (also `τ(n)`, `σ₀(n)`) is the *number* of positive divisors of `n`; `σ(n)` (also `σ₁(n)`) is their *sum*. For `12`: divisors `1,2,3,4,6,12`, so `d(12)=6` and `σ(12)=28`.

### J2. How do you compute `d(n)` from the factorization?
If `n = p₁^{a₁} ⋯ p_k^{a_k}`, then `d(n) = (a₁+1)(a₂+1)…(a_k+1)`. Each prime independently contributes an exponent from `0` to `a_i`, which is `a_i+1` choices.

### J3. Why `(a_i + 1)` and not `a_i`?
Because the exponent `0` is a valid choice — it means "this prime does not appear in the divisor." Forgetting it is the most common bug.

### J4. How do you compute `σ(n)` from the factorization?
`σ(n) = Π (1 + p_i + p_i² + … + p_i^{a_i}) = Π (p_i^{a_i+1}−1)/(p_i−1)`. Each factor is the sum of all powers of one prime up to its exponent.

### J5. Compute `d(72)` and `σ(72)`.
`72 = 2³·3²`. `d = (3+1)(2+1) = 12`. `σ = (1+2+4+8)(1+3+9) = 15·13 = 195`.

### J6. What is `σ_k`?
`σ_k(n) = Σ_{d∣n} d^k`, the sum of the `k`-th powers of divisors. `σ₀ = d` (count), `σ₁ = σ` (sum).

### J7. What are `d(1)` and `σ(1)`?
Both are `1`. `1` has exactly one divisor (itself), and it sums to `1`. The factorization is empty, so the product is the empty product `= 1`.

### J8. What are `d(p)` and `σ(p)` for a prime `p`?
`d(p) = 2` (divisors `1` and `p`); `σ(p) = p + 1`.

### J9. What is the time complexity of computing `d(n)` for one number?
Via factorization by trial division, `O(√n)`. Naively walking `1..n` is `O(n)`; pairing divisors around `√n` is also `O(√n)` without factoring.

### J10. Why do divisors come in pairs?
If `d ∣ n`, then so does `n/d`, and they pair as `(d, n/d)`. So you only need to scan `d ≤ √n` and add both `d` and `n/d` — except when `d = √n` (perfect square), where you count it once.

### J11. How do you compute `d`/`σ` for all numbers up to `N`?
A divisor sieve: for each divisor `d` from `1` to `N`, walk its multiples `d, 2d, 3d, …` and do `cnt[m]++`, `sum[m] += d`. After the loop, `cnt[m] = d(m)`, `sum[m] = σ(m)`.

### J12. What is the complexity of the divisor sieve?
`O(N log N)`. The inner loop runs `N/d` times for each `d`; summing gives `N·(1 + 1/2 + … + 1/N) ≈ N ln N`.

### J13. Why must `σ` use 64-bit integers?
`σ(n)` can substantially exceed `n` (e.g. for abundant numbers), and summed over a range it grows fast. 32-bit overflows silently and corrupts results.

### J14. What is a perfect number?
A number equal to the sum of its proper divisors: `σ(n) = 2n`. Examples: `6`, `28`, `496`, `8128`.

### J15. Is `d` or `σ` related to whether `n` is prime?
`d(n) = 2` exactly when `n` is prime (its only divisors are `1` and `n`). So `d` distinguishes primes, but a dedicated primality test is faster than factoring.

### J16. What is the sum of *proper* divisors and how do you get it?
`s(n) = σ(n) − n` — all divisors except `n` itself. For `12`: `28 − 12 = 16`.

### J17. Why is `d(n)` always odd for a perfect square?
Divisors pair as `(d, n/d)`. For a perfect square, the root `√n` pairs with itself, leaving one unpaired divisor — so the total count is odd. For non-squares, every divisor has a distinct partner, giving an even count.

### J18. What is `σ(16)`?
`16 = 2⁴`, so `σ(16) = 1+2+4+8+16 = 31 = (2⁵−1)/(2−1)`. Since `31 < 32 = 2·16`, `16` is deficient.

---

## Mid-Level Questions (14 Q&A)

### M1. What does it mean that `d` and `σ` are multiplicative?
`f(ab) = f(a)f(b)` whenever `gcd(a,b) = 1`. It lets you compute `f(n)` as a product over its prime-power components, which is exactly why the closed forms work.

### M2. Are they *completely* multiplicative?
No. Complete multiplicativity requires `f(ab)=f(a)f(b)` for *all* `a,b`. But `d(4) = 3 ≠ d(2)d(2) = 4`, and `gcd(2,2)=2≠1`, so the rule does not apply. They are multiplicative, not completely.

### M3. Why are `d` and `σ` multiplicative (intuition)?
If `gcd(a,b)=1`, every divisor of `ab` factors uniquely as `d_a·d_b` with `d_a ∣ a`, `d_b ∣ b`. Counting these pairs gives `d(a)d(b)`; summing their products gives `σ(a)σ(b)`.

### M4. How do you classify a number as perfect/abundant/deficient?
Compute `s(n) = σ(n) − n` (sum of proper divisors). Perfect if `s = n`, abundant if `s > n`, deficient if `s < n`. Equivalently compare `σ(n)` to `2n`.

### M5. What are amicable numbers?
A pair `(a, b)` with `a ≠ b` where each is the sum of the other's proper divisors: `s(a) = b` and `s(b) = a`. Smallest pair: `(220, 284)`.

### M6. What is a highly composite number?
A number with more divisors than any smaller positive integer. Examples: `1,2,4,6,12,24,36,48,60,120,…`. They use small primes with non-increasing exponents to maximize `Π(a_i+1)`.

### M7. Why does the divisor sieve have a `log N` factor while the prime sieve has `log log N`?
The prime sieve strides only *primes* (`Σ_{p≤N} N/p ≈ N ln ln N`); the divisor sieve strides *every* divisor `d` (`Σ_{d≤N} N/d ≈ N ln N`). Working with all divisors, not just primes, costs the extra factor.

### M8. How do you compute `σ_k` with a sieve?
Same divisor sieve, but accumulate `sum[m] += d^k` instead of `+= d`.

### M9. How is `d` related to Dirichlet convolution?
`d = 1 * 1`, where `1(n)=1` and `(f*g)(n)=Σ_{d∣n}f(d)g(n/d)`. Similarly `σ = id * 1` with `id(n)=n`. Convolution of multiplicative functions is multiplicative — a structural proof that `d` and `σ` are multiplicative.

### M10. The sum of proper divisors of `12`?
`σ(12) − 12 = 28 − 12 = 16`. Since `16 > 12`, `12` is abundant.

### M11. How do you avoid floating-point error in the `σ` formula?
Do not use `(p^{a+1}−1)/(p−1)` in floats. Accumulate `1 + p + p² + … + p^a` by integer addition, or use the identity `σ(p^{e+1}) = p·σ(p^e) + 1`.

### M12. When should you sieve vs factor a single number?
All numbers up to a RAM-fittable `N` → sieve once, `O(1)` queries. One number you can factor (`≤ ~10^{12}`) → trial-division factorization + formula, `O(√n)`. The discriminant is cardinality.

### M13. How do you answer "sum of `σ(i)` for `i ∈ [a,b]`" fast?
Sieve `σ`, build a prefix-sum array `pref[i] = pref[i-1]+σ(i)`, then each range query is `pref[b] − pref[a-1]` in `O(1)`.

### M14. How do you find the smallest number with at least `k` divisors?
Sieve `d(n)` up to a bound, scan for the first `n` with `d(n) ≥ k` (highly composite numbers are the candidates). For large `k`, generate candidates by assigning non-increasing exponents to the smallest primes.

### M15. Why are abundant numbers "contagious" under divisibility?
Every multiple of an abundant number is abundant, because `σ(N)/N ≥ σ(m)/m` whenever `m ∣ N`. So once `12` (abundant) divides `N`, `N` is abundant too — which is why abundant numbers become dense.

### M16. Compute `d(n)` of `T_n = n(n+1)/2` efficiently.
Since `gcd(n, n+1) = 1`, split the even one by 2 and use multiplicativity: if `n` even, `T_n = (n/2)·(n+1)` with coprime factors, so `d(T_n) = d(n/2)·d(n+1)`. This avoids factoring the (large) product directly — the Project Euler 12 trick.

### M17. What does `σ(n) = kn` mean?
`n` is *`k`-perfect* (multiply perfect). `k=2` is ordinary perfect; `120` is 3-perfect (`σ(120)=360`). All decided by the same multiplicative `σ` formula.

---

## Senior Questions (11 Q&A)

### S1. How do you compute `d`/`σ` for all `n ≤ N` in `O(N)`?
Linear sieve: visit each `n = i·p` once with `p = spf(n)`. If `p ∤ i` (coprime), `d(n)=2·d(i)`, `σ(n)=(p+1)·σ(i)`. If `p ∣ i` (raise exponent), track `cnt` (exponent of smallest prime) and update `d(n)=d(i)/(cnt+1)·(cnt+2)`, `σ(n)=σ(i)/σ(p^{cnt})·σ(p^{cnt+1})` using `σ(p^{e+1})=p·σ(p^e)+1`.

### S2. Which array is the memory bottleneck and why?
The `σ[]` array, because it must be 64-bit (`σ` grows fast). `d[]` can be 16-bit (`d(n) ≤ 1344` for `n ≤ 10^9`). At `N=10^8`, `σ[]` is ~800 MB — the binding constraint.

### S3. How do you serve millions of `σ(n)` queries?
Build the array once at startup, publish it immutable behind a memory barrier, then each query is an `O(1)` array read with no locks. Cap `N` against RAM before allocating; never rebuild per request.

### S4. What if `N` is too large to materialize?
Either segment / stream-and-reduce (process `[1,N]` in blocks, striding divisors into each block, `O(block)` memory) for reductions like sums, or — for sparse queries — sieve base primes to `√N` and factor each query in `O(√n)`.

### S5. How do you compute `σ` modulo a prime `M`?
Keep all adds/multiplies mod `M`. Accumulate the geometric sum `1+p+…+p^a` by addition mod `M` — avoid the division closed form unless you compute a modular inverse of `(p−1)`, valid only when `gcd(p−1,M)=1`.

### S6. Linear sieve vs `O(N log N)` divisor sieve in practice?
Linear is `O(N)` but has non-local access (`i = n/spf(n)`) and extra exponent arrays, so it can be *slower wall-clock* for moderate `N`. The simpler divisor sieve is cache-friendly and blockable. Use linear when `N` is large or you compute `d`/`σ` alongside φ/μ/SPF in one pass.

### S7. How do you test a divisor-function table?
Cross-check the sieve against an independent trial-division `d`/`σ` for all `n ≤ 10^5`; check linear-vs-`N log N` parity; assert multiplicativity on random coprime pairs; verify perfect numbers `6,28,496,8128` satisfy `σ=2n`. A single wrong exponent corrupts one entry among millions.

### S8. How does the divisor sieve's runtime relate to a known number-theoretic sum?
It is exactly `Σ_{n≤N} d(n)` — the total number of divisors of all `n ≤ N` — which equals `N ln N + (2γ−1)N + O(√N)` (the Dirichlet divisor problem). The leading `N ln N` is the complexity bound.

### S9. What is the average and extremal order of `σ`?
Average: `σ(n) ≈ (π²/6)·n ≈ 1.645 n`. Extremal: `lim sup σ(n)/(n ln ln n) = e^γ` (Gronwall). Robin's inequality ties `σ(n) < e^γ n ln ln n` (for `n>5040`) to the Riemann Hypothesis.

### S10. Why can `d[]` be 16-bit but `σ[]` cannot?
`d(n)` grows like `2^{O(ln n/ln ln n)}` — only ~`1344` even for `n ≤ 10^9`, fits in 16 bits. `σ(n)` grows like `e^γ n ln ln n`, exceeding 32-bit quickly, so it needs 64-bit.

### S11. How do you handle range sums of `σ` that overflow 64-bit?
Use big integers (Java `BigInteger`, Go `math/big`, Python native) for exact sums, or work modulo `M` if the problem allows. Prefix sums of `σ` over large `N` overflow 64-bit and must be guarded.

### S12. How would you compute `Σ_{n≤N} σ(n)` for `N = 10^9` without 8 GB of RAM?
Use the swap-order identity `Σ_{n≤N} σ(n) = Σ_{d≤N} d·⌊N/d⌋`, computable in `O(N)` (or `O(√N)` with the hyperbola method) using `O(1)` memory — no array at all. Recognizing that a reduction does not need the materialized array turns an 8 GB job into a few-KB one.

### S13. The divisor sieve is sometimes faster than the linear sieve despite worse asymptotics — why?
The divisor sieve strides arrays sequentially (cache-friendly), while the linear sieve's `i = n/spf(n)` access is scattered. At moderate `N` (`≤ ~10^6`) the cache advantage outweighs the `log N` factor; the linear sieve only wins once `N` is large. Always benchmark at your actual `N`.

---

## Professional / Theory Questions (6 Q&A)

### P1. Prove `d(n) = Π(a_i+1)`.
Divisors of `n=Π p_i^{a_i}` are exactly `Π p_i^{b_i}` with `0 ≤ b_i ≤ a_i` (Divisor Characterization Lemma, via unique factorization). They biject with exponent vectors in `Π{0,…,a_i}`; the count is the product of choice-set sizes `Π(a_i+1)`.

### P2. Prove `σ` is multiplicative.
For `gcd(a,b)=1`, the map `(d_a,d_b)↦d_a d_b` is a bijection between divisor-pairs and divisors of `ab` (coprimality makes the prime sets disjoint). Then `σ(ab)=Σ_{d_a∣a}Σ_{d_b∣b}d_a d_b = (Σ d_a)(Σ d_b) = σ(a)σ(b)`. Structurally: `σ=id*1`, and convolution of multiplicative functions is multiplicative.

### P3. Derive the `O(N log N)` bound.
`T(N)=Σ_{d=1}^{N}⌊N/d⌋ = N Σ 1/d − Σ{N/d} = N·H_N − Θ(N)`, and `H_N = ln N + γ + o(1)`, so `T(N) = N ln N + O(N) = Θ(N log N)`.

### P4. State and prove the Euclid direction of the perfect-number theorem.
If `2^p−1` is prime, then `n=2^{p−1}(2^p−1)` is perfect. Proof: `σ(n)=σ(2^{p−1})·σ(2^p−1)=(2^p−1)·2^p = 2·2^{p−1}(2^p−1)=2n` by multiplicativity.

### P5. Why is `σ = id * 1` and what does it invert to?
`(id*1)(n)=Σ_{d∣n}(n/d)·1=Σ_{d∣n}d=σ(n)`. Since `μ*1=ε`, convolving with `μ` gives `id = σ*μ`, i.e. `n = Σ_{d∣n}σ(d)μ(n/d)` — a Möbius inversion (topic `32`).

### P6. Why does the linear-sieve recurrence give correct `σ`?
Each `n=i·p` is built once from `i<n`, already finalized. Coprime case: multiplicativity. Exponent-raise case: isolate the smallest-prime power and replace `σ(p^e)` with `σ(p^{e+1})=p·σ(p^e)+1`; the division `σ(i)/σ(p^e)` is exact because `σ(p^e)` divides `σ(i)=σ(p^e)·σ(rest)`.

### P7. What are the Dirichlet-series (zeta) generating functions of `d` and `σ`?
`Σ d(n)/n^s = ζ(s)²` (because `d = 1*1`), `Σ σ(n)/n^s = ζ(s)ζ(s−1)` (because `σ = id*1`), and `Σ σ_k(n)/n^s = ζ(s)ζ(s−k)`. The poles of these products give the average orders: the double pole of `ζ²` at `s=1` yields `Σ d(n) ~ N ln N`; the `ζ(s−1)` pole at `s=2` yields `Σ σ(n) ~ (π²/12)N²`.

### P8. State the average order of `σ` and the Gronwall extremal result.
Average: `Σ_{n≤N} σ(n) = (π²/12)N² + O(N log N)`, so `σ(n) ≈ (π²/6)n` on average. Extremal: `lim sup σ(n)/(n ln ln n) = e^γ` (Gronwall); Robin's inequality `σ(n) < e^γ n ln ln n` for `n > 5040` is equivalent to the Riemann Hypothesis.

---

### P9. Why is the divisor-sieve runtime equal to a number-theoretic sum?
The total inner-loop count is `Σ_{d≤N}⌊N/d⌋`, which counts all `(divisor, cofactor)` pairs `with d·q ≤ N` — equivalently `Σ_{n≤N} d(n)`, the total number of divisors of all `n ≤ N`. By the harmonic estimate this is `N ln N + (2γ−1)N + O(√N)` (the Dirichlet divisor sum), so the sieve is `Θ(N log N)`.

### P10. Why is the linear-sieve `σ` division exact in integers but not mod M?
In integers, `σ(p^e)` divides `σ(i) = σ(p^e)·σ(u)` (with `u = i/p^e`), so `σ(i)/σ(p^e) = σ(u)` is exact. Under a prime modulus `M`, `σ(p^e) mod M` need not divide `σ(i) mod M`, so you must accumulate the geometric sum by repeated addition instead of dividing.

---

## Common Interview Mistakes (watch list)

| Mistake | Fix |
|---------|-----|
| `d(n) = Π a_i` (drops the `+1`) | exponent `0` is a valid choice: `Π(a_i+1)` |
| Forgetting the leftover prime after trial division | `if n > 1: d *= 2; σ *= 1+n` |
| 32-bit `σ` | always 64-bit |
| Float geometric sum `(p^{a+1}-1)/(p-1)` | accumulate `1+p+…+p^a` by integer addition |
| Perfect ⇔ `σ(n)=n` | perfect ⇔ `σ(n)=2n` |
| Sieving every number for a range | one divisor/linear sieve |
| `σ(ab)=σ(a)σ(b)` for non-coprime `a,b` | only when `gcd(a,b)=1` |

---

## Behavioral / Communication Prompts

- **"Explain divisor functions to a non-technical stakeholder."** Use the combination-lock analogy: each prime is a dial with `(exponent+1)` positions; the number of combinations is the product, and that is `d(n)`.
- **"Describe optimizing a divisor-heavy computation."** Walk through replacing per-number factorization with one divisor sieve, then the linear-sieve upgrade, with before/after timings.
- **"Defend a divisor sieve in code review."** Point to 64-bit `σ`, the `d(1)=σ(1)=1` seed, the leftover-prime tail in factorization, and cross-checks against brute force.
- **"When did you choose *not* to sieve?"** A handful of `σ(n)` queries over a huge range — per-query factorization with base primes was cheaper than a giant array.
- **"How do you pick the bound `N`?"** Derive from the max value queried/factored, then cap against RAM (`σ[]` at 8 bytes/entry is the constraint); never guess.

---

## Coding Challenge — Divisor functions, both ways

**Problem.** Implement two routines and show they agree:
1. `dSigma(n)` — compute `d(n)` and `σ(n)` for a *single* `n` via factorization, `O(√n)`.
2. `sieveDSigma(N)` — compute `d(m)` and `σ(m)` for *all* `m ≤ N` with a divisor sieve, `O(N log N)`.

Then use the sieve to find all **perfect numbers** `≤ N`. Constraints: `n ≤ 10^{12}` for the single-number routine; `N ≤ 10^6` for the sieve. Use 64-bit for `σ`.

Expected: `dSigma(360) = (24, 1170)`; perfect numbers `≤ 10^4` are `6, 28, 496, 8128`.

### Go

```go
package main

import "fmt"

// dSigma: single number via factorization, O(sqrt(n)).
func dSigma(n int64) (int64, int64) {
	var d, sigma int64 = 1, 1
	for p := int64(2); p*p <= n; p++ {
		if n%p == 0 {
			var a, term, pk int64 = 0, 1, 1
			for n%p == 0 {
				n /= p
				a++
				pk *= p
				term += pk
			}
			d *= a + 1
			sigma *= term
		}
	}
	if n > 1 {
		d *= 2
		sigma *= 1 + n
	}
	return d, sigma
}

// sieveDSigma: all m <= N via divisor sieve, O(N log N).
func sieveDSigma(N int) ([]int, []int64) {
	d := make([]int, N+1)
	sigma := make([]int64, N+1)
	for div := 1; div <= N; div++ {
		for m := div; m <= N; m += div {
			d[m]++
			sigma[m] += int64(div)
		}
	}
	return d, sigma
}

func perfectUpTo(N int) []int {
	_, sigma := sieveDSigma(N)
	var out []int
	for n := 1; n <= N; n++ {
		if sigma[n] == 2*int64(n) {
			out = append(out, n)
		}
	}
	return out
}

func main() {
	fmt.Println(dSigma(360))          // 24 1170
	fmt.Println(perfectUpTo(10000))   // [6 28 496 8128]
	// cross-check single vs sieve
	d, sg := sieveDSigma(1000)
	ok := true
	for n := 1; n <= 1000; n++ {
		dd, ss := dSigma(int64(n))
		if int64(d[n]) != dd || sg[n] != ss {
			ok = false
		}
	}
	fmt.Println("agree:", ok) // true
}
```

### Java

```java
import java.util.*;

public class DivisorChallenge {
    static long[] dSigma(long n) {
        long d = 1, sigma = 1;
        for (long p = 2; p * p <= n; p++) {
            if (n % p == 0) {
                long a = 0, term = 1, pk = 1;
                while (n % p == 0) { n /= p; a++; pk *= p; term += pk; }
                d *= (a + 1);
                sigma *= term;
            }
        }
        if (n > 1) { d *= 2; sigma *= (1 + n); }
        return new long[]{d, sigma};
    }

    static int[] dArr;
    static long[] sigmaArr;

    static void sieveDSigma(int N) {
        dArr = new int[N + 1];
        sigmaArr = new long[N + 1];
        for (int div = 1; div <= N; div++)
            for (int m = div; m <= N; m += div) { dArr[m]++; sigmaArr[m] += div; }
    }

    static List<Integer> perfectUpTo(int N) {
        sieveDSigma(N);
        List<Integer> out = new ArrayList<>();
        for (int n = 1; n <= N; n++) if (sigmaArr[n] == 2L * n) out.add(n);
        return out;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(dSigma(360))); // [24, 1170]
        System.out.println(perfectUpTo(10000));            // [6, 28, 496, 8128]
        sieveDSigma(1000);
        boolean ok = true;
        for (int n = 1; n <= 1000; n++) {
            long[] r = dSigma(n);
            if (dArr[n] != r[0] || sigmaArr[n] != r[1]) ok = false;
        }
        System.out.println("agree: " + ok); // true
    }
}
```

### Python

```python
def d_sigma(n):
    d, sigma, p = 1, 1, 2
    while p * p <= n:
        if n % p == 0:
            a, term, pk = 0, 1, 1
            while n % p == 0:
                n //= p
                a += 1
                pk *= p
                term += pk
            d *= a + 1
            sigma *= term
        p += 1
    if n > 1:
        d *= 2
        sigma *= 1 + n
    return d, sigma


def sieve_d_sigma(N):
    d = [0] * (N + 1)
    sigma = [0] * (N + 1)
    for div in range(1, N + 1):
        for m in range(div, N + 1, div):
            d[m] += 1
            sigma[m] += div
    return d, sigma


def perfect_up_to(N):
    _, sigma = sieve_d_sigma(N)
    return [n for n in range(1, N + 1) if sigma[n] == 2 * n]


if __name__ == "__main__":
    print(d_sigma(360))         # (24, 1170)
    print(perfect_up_to(10000)) # [6, 28, 496, 8128]
    d, sg = sieve_d_sigma(1000)
    ok = all(d_sigma(n) == (d[n], sg[n]) for n in range(1, 1001))
    print("agree:", ok)         # True
```

---

## Coding Challenge 2 — Smallest number with > K divisors (highly composite)

**Problem.** Given a sieve bound `N`, return the smallest `n ≤ N` whose divisor count `d(n)` is strictly greater than that of every smaller number (a highly composite number sequence), and specifically the first one exceeding a threshold `K`. Constraints: `N ≤ 10^6`, `K ≤ 200`.

Expected: for `K = 10`, the answer is `48` (the first number with `d > 10`, namely `d(48) = 10`... actually the first with `d(n) > 10` is `60` with `d = 12`).

### Go

```go
package main

import "fmt"

func dSieve(N int) []int {
	d := make([]int, N+1)
	for div := 1; div <= N; div++ {
		for m := div; m <= N; m += div {
			d[m]++
		}
	}
	return d
}

// firstExceeding returns the smallest n <= N with d(n) > K, or -1.
func firstExceeding(N, K int) int {
	d := dSieve(N)
	for n := 1; n <= N; n++ {
		if d[n] > K {
			return n
		}
	}
	return -1
}

func main() {
	fmt.Println(firstExceeding(1_000_000, 10)) // 60 (d=12)
	fmt.Println(firstExceeding(1_000_000, 100)) // 45360 (d=100)
}
```

### Java

```java
public class HighlyComposite {
    static int[] dSieve(int N) {
        int[] d = new int[N + 1];
        for (int div = 1; div <= N; div++)
            for (int m = div; m <= N; m += div) d[m]++;
        return d;
    }

    static int firstExceeding(int N, int K) {
        int[] d = dSieve(N);
        for (int n = 1; n <= N; n++) if (d[n] > K) return n;
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(firstExceeding(1_000_000, 10));  // 60
        System.out.println(firstExceeding(1_000_000, 100)); // 45360
    }
}
```

### Python

```python
def d_sieve(N):
    d = [0] * (N + 1)
    for div in range(1, N + 1):
        for m in range(div, N + 1, div):
            d[m] += 1
    return d


def first_exceeding(N, K):
    d = d_sieve(N)
    for n in range(1, N + 1):
        if d[n] > K:
            return n
    return -1


if __name__ == "__main__":
    print(first_exceeding(1_000_000, 10))   # 60
    print(first_exceeding(1_000_000, 100))  # 45360
```

---

## Final Tips

- **State the formula and its reason:** "`d(n)=Π(a_i+1)` because a divisor independently chooses each prime's exponent." This signals understanding, not memorization.
- **Mention multiplicativity unprompted** — it is the property interviewers most want to hear, and it justifies the closed forms and the linear sieve.
- **Clarify the regime first:** is it *all* numbers up to `N` (sieve) or *one* number (factor)? Picking wrong is the biggest red flag.
- **Use 64-bit `σ`** and call it out; pack `d` as small if asked about memory.
- **Sanity-check with `σ(6)=12`, `d(360)=24`** to show you validate, not just write.
- **Know the convolution view** (`d=1*1`, `σ=id*1`) and the Euclid–Euler perfect-number link as senior-level asides.
