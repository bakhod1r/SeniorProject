# Divisor Functions (d(n), σ(n)) — Junior Level

> **One-line summary:** The *divisor functions* count and sum the divisors of a number. From a number's prime factorization `n = p₁^a₁ · p₂^a₂ · …`, the **number of divisors** is `d(n) = (a₁+1)(a₂+1)…` and the **sum of divisors** is `σ(n) = Π (p_i^{a_i+1} − 1)/(p_i − 1)`. Both come straight out of the factorization — no need to list every divisor.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Suppose someone hands you the number `12` and asks two questions: *"How many divisors does it have?"* and *"What is the sum of all its divisors?"* The divisors of `12` are `1, 2, 3, 4, 6, 12` — six of them — and their sum is `1 + 2 + 3 + 4 + 6 + 12 = 28`. We have just computed two famous quantities:

- **`d(12) = 6`** — the *number of divisors* (also written `τ(12)`, the Greek letter tau, or `σ₀(12)`).
- **`σ(12) = 28`** — the *sum of divisors* (also written `σ₁(12)`).

The naive way to find these is exactly what we just did: walk through every integer from `1` to `n`, test which ones divide `n`, count them, and add them up. That works, but it takes `O(n)` time per number, and it completely ignores a beautiful shortcut hiding inside the **prime factorization**.

> **The key idea:** if you know the prime factorization `n = p₁^a₁ · p₂^a₂ · … · p_k^a_k`, you can compute `d(n)` and `σ(n)` *directly* from the exponents and primes — without ever listing the divisors. For the number of divisors, `d(n) = (a₁+1)(a₂+1)…(a_k+1)`. For the sum of divisors, `σ(n) = Π (p_i^{a_i+1} − 1)/(p_i − 1)`.

Why does counting divisors reduce to a product of `(exponent + 1)`? Because **every divisor of `n` is built by choosing, for each prime, how many copies of that prime to include** — anywhere from `0` up to its full exponent `a_i`. For `12 = 2² · 3¹`, a divisor picks `0`, `1`, or `2` twos (3 choices) and `0` or `1` threes (2 choices). That is `3 × 2 = 6` divisors — exactly `(2+1)(1+1)`. The same independent-choice argument, summed instead of counted, gives the divisor-sum formula.

This single observation transforms divisor problems. Once you can factor a number, you get `d(n)` and `σ(n)` almost for free. And when you need these values for *every* number up to some bound `N` — a common task in competitive programming and number theory — you can compute them all at once with a **divisor sieve**, the same "stride through multiples" trick that powers the prime sieve (see topic `03-prime-sieves`).

In this junior file we focus on the basics: what `d(n)` and `σ(n)` are, why the factorization formulas work, how to compute them for a single number, and the small mistakes that trip up beginners. The deeper "why" — multiplicativity, the all-at-once divisor sieve, perfect and abundant numbers, and the Dirichlet-convolution view — lives in [`middle.md`](./middle.md) and beyond.

---

## Prerequisites

Before reading this file you should be comfortable with:

- **What a divisor is** — `d` is a divisor of `n` if `n % d == 0` (it divides evenly, leaving no remainder). Every `n ≥ 1` has at least the divisors `1` and `n`.
- **Prime factorization** — every integer `> 1` factors uniquely into primes, e.g. `360 = 2³ · 3² · 5¹`. (See topic `02-prime-factorization`.)
- **Exponents** — in `2³`, the `3` is the exponent. The formulas below are products over the exponents.
- **Loops and arrays** — counting and summing divisors naively uses a loop; the sieve uses an array indexed by number.
- **Big-O notation** — enough to read `O(√n)`, `O(n)`, `O(n log n)`.
- **Integer division and modulo** — `a % b == 0` tests divisibility; `a / b` for the cofactor.

Optional but helpful:

- A glance at the **Sieve of Eratosthenes** (topic `03-prime-sieves`) — the divisor sieve borrows the same "iterate over multiples" structure.
- The notion of a **geometric series** `1 + p + p² + … + p^a = (p^{a+1} − 1)/(p − 1)` — this *is* the divisor-sum formula for a single prime power.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Divisor (factor)** | An integer `d ≥ 1` with `n % d == 0`. Divisors of `12`: `1,2,3,4,6,12`. |
| **`d(n)` / `τ(n)` / `σ₀(n)`** | The **number of divisors** of `n`. `d(12) = 6`. |
| **`σ(n)` / `σ₁(n)`** | The **sum of divisors** of `n` (including `1` and `n`). `σ(12) = 28`. |
| **`σ_k(n)`** | The sum of the `k`-th powers of the divisors: `Σ_{d∣n} d^k`. `σ₀ = d`, `σ₁ = σ`. |
| **Prime factorization** | `n = p₁^a₁ · … · p_k^a_k`, unique up to order (Fundamental Theorem of Arithmetic). |
| **Exponent `a_i`** | The power of prime `p_i` in the factorization. |
| **Proper divisor** | A divisor of `n` other than `n` itself. Their sum is `σ(n) − n`, written `s(n)`. |
| **Divisor sieve** | An `O(N log N)` method to compute `d` or `σ` for *all* numbers up to `N` at once. |
| **Multiplicative function** | `f(ab) = f(a)f(b)` whenever `gcd(a,b)=1`. `d` and `σ` are both multiplicative (see `middle.md`). |
| **Perfect number** | A number equal to the sum of its proper divisors, i.e. `σ(n) = 2n`. `6` and `28` are perfect. |

---

## Core Concepts

### 1. Every Divisor Is a Choice of Exponents

Take `n = p₁^a₁ · p₂^a₂ · … · p_k^a_k`. A number `d` divides `n` **if and only if** `d = p₁^b₁ · p₂^b₂ · … · p_k^b_k` where each exponent satisfies `0 ≤ b_i ≤ a_i`. In words: a divisor uses the *same primes*, each raised to a power no larger than in `n`.

So building a divisor is a sequence of independent choices — one per prime. For prime `p_i` you may pick its exponent to be `0, 1, 2, …, a_i`, which is `a_i + 1` options.

```
n = 12 = 2² · 3¹
divisor = 2^b · 3^c   with b ∈ {0,1,2}, c ∈ {0,1}
   b=0,c=0 → 1     b=1,c=0 → 2     b=2,c=0 → 4
   b=0,c=1 → 3     b=1,c=1 → 6     b=2,c=1 → 12
6 divisors total = (2+1) · (1+1)
```

### 2. The Number-of-Divisors Formula: `d(n) = Π (a_i + 1)`

Because the choices are independent, the total number of divisors is the *product* of the number of choices for each prime:

```
d(n) = (a₁ + 1)(a₂ + 1) … (a_k + 1)
```

Examples:
- `d(12) = d(2²·3) = (2+1)(1+1) = 6`.
- `d(360) = d(2³·3²·5) = (3+1)(2+1)(1+1) = 4·3·2 = 24`.
- `d(p) = (1+1) = 2` for any prime `p` (its only divisors are `1` and `p`).
- `d(p²) = 3` (divisors `1, p, p²`).

### 3. The Sum-of-Divisors Formula: `σ(n) = Π (p_i^{a_i+1} − 1)/(p_i − 1)`

To *sum* the divisors instead of counting them, sum over the same independent choices. For a single prime power `p^a`, the divisors are `1, p, p², …, p^a`, and their sum is a geometric series:

```
σ(p^a) = 1 + p + p² + … + p^a = (p^{a+1} − 1)/(p − 1)
```

For a product of prime powers, the total divisor sum **factors** into the product of these per-prime sums (this is the multiplicativity proved in [`professional.md`](./professional.md)):

```
σ(n) = Π (1 + p_i + p_i² + … + p_i^{a_i}) = Π (p_i^{a_i+1} − 1)/(p_i − 1)
```

Examples:
- `σ(12) = σ(2²)·σ(3¹) = (1+2+4)·(1+3) = 7·4 = 28`.
- `σ(360) = σ(2³)·σ(3²)·σ(5) = 15·13·6 = 1170`.
- `σ(p) = 1 + p` for a prime.

### 4. Why the Sum Factors (the Distributive-Law Picture)

Multiplying out `(1 + 2 + 4)(1 + 3)` term-by-term gives `1·1 + 1·3 + 2·1 + 2·3 + 4·1 + 4·3 = 1 + 3 + 2 + 6 + 4 + 12`, which is *exactly* the list of all six divisors of `12`. The distributive law is doing the "choose an exponent for each prime" enumeration for us, automatically. That is the whole reason the closed form works.

### 5. `σ_k`: The General Divisor Power Sum

Both `d` and `σ` are special cases of one family. Define `σ_k(n) = Σ_{d∣n} d^k`, the sum of the `k`-th powers of the divisors. Then:

- `σ₀(n) = Σ_{d∣n} d⁰ = Σ_{d∣n} 1 = d(n)` — the count.
- `σ₁(n) = Σ_{d∣n} d¹ = σ(n)` — the sum.

The closed form generalizes the geometric series with `p` replaced by `p^k`:

```
σ_k(n) = Π (p_i^{k(a_i+1)} − 1)/(p_i^k − 1)        (for k ≥ 1)
```

You will mostly use `d` and `σ` at this level; `σ_k` shows up in more advanced problems.

### 6. Computing for a Single `n` via Factorization

The recipe for one number is direct: factor `n`, then plug the primes and exponents into the formulas.

```
compute_d_sigma(n):
    d = 1; sigma = 1
    for each (prime p, exponent a) in factorize(n):
        d     *= (a + 1)
        sigma *= (p^(a+1) - 1) / (p - 1)   # = 1 + p + ... + p^a
    return d, sigma
```

Factoring `n` by trial division takes `O(√n)`, and the formula step is tiny, so the whole thing is `O(√n)` per number — far faster than the `O(n)` naive divisor walk for large `n`.

### 7. Computing for ALL `n ≤ N` via a Sieve

When you need `d` or `σ` for *every* number up to `N`, do not factor each one separately. Instead, flip the loop: for each potential divisor `d` from `1` to `N`, walk through its multiples `d, 2d, 3d, …` and contribute to each. Every multiple of `d` has `d` as one of its divisors, so:

```
divisor_sieve(N):
    cnt[1..N] = 0; sum[1..N] = 0
    for d = 1; d <= N; d++:
        for m = d; m <= N; m += d:
            cnt[m] += 1     # d is a divisor of m
            sum[m] += d     # add divisor d to m's total
    # now cnt[m] = d(m), sum[m] = σ(m)
```

The inner loop runs `N/d` times for each `d`, so the total work is `N/1 + N/2 + N/3 + … + N/N = N·(1 + 1/2 + 1/3 + … + 1/N) ≈ N·ln N`, i.e. **`O(N log N)`** — the same harmonic-sum analysis you will see proven in [`professional.md`](./professional.md). This is the workhorse for "all divisor counts/sums up to `N`."

---

## Big-O Summary

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| Naive `d(n)`/`σ(n)` by walking `1..n` | O(n) | O(1) | Simple; slow for large `n`. |
| Walking `1..√n` (pair divisors) | O(√n) | O(1) | Each `d ≤ √n` pairs with `n/d`. |
| `d(n)`/`σ(n)` via factorization | O(√n) | O(log n) | Factor by trial division, then formula. |
| `d(n)`/`σ(n)` with precomputed primes | O(√n / ln √n) | O(√n) | Trial-divide by primes only. |
| Divisor sieve for **all** `m ≤ N` | **O(N log N)** | O(N) | The all-at-once method. |
| Linear sieve for all `m ≤ N` | **O(N)** | O(N) | Multiplicative recurrence (see `senior.md`). |
| Query `d(m)`/`σ(m)` after sieving | O(1) | — | Array lookup. |

The headline for *one* number is `O(√n)` (via factorization); for *all* numbers up to `N` it is `O(N log N)` with the simple divisor sieve, or `O(N)` with the linear sieve.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Divisor = choice of exponents | Building an outfit: for each clothing category (prime) you pick how many items (exponent) up to a max. The number of outfits is the product of choices. |
| `d(n) = Π(a_i+1)` | A combination lock with `k` dials, where dial `i` has `a_i + 1` positions. Total combinations = product of positions. |
| `σ(n)` distributing | Expanding `(1+2+4)(1+3)` is like a vending machine offering one item from each row; every full selection is a divisor. |
| Divisor sieve | A mailroom: clerk `d` drops a "I divide you" note into the mailbox of every `d`-th house. At the end, each house counts its notes (`d(m)`) and sums the clerk numbers (`σ(m)`). |
| Perfect number | A number whose proper parts (`σ(n) − n`) rebuild it exactly — like a Lego set whose smaller official sub-builds add up to the same brick count. |

Where the analogies break: the lock/outfit picture assumes you know the exponents (the factorization). If you only have the raw number, you must factor it first — the analogy hides that step, which is the real cost.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Formula gives `d(n)`/`σ(n)` instantly once you have the factorization. | You must *factor* `n` first; factoring a single huge `n` is the bottleneck. |
| The divisor sieve computes all values up to `N` in `O(N log N)` — one pass, then `O(1)` queries. | The sieve needs `O(N)` memory; for huge `N` this is the limit. |
| Multiplicativity (`middle.md`) makes the functions easy to reason about and to sieve linearly. | The naive `1..n` walk is `O(n)` per number — fine for small `n`, hopeless for many large `n`. |
| `σ_k` unifies counting and summing under one closed form. | `σ(n)` grows fast; you must watch for integer overflow (use 64-bit). |
| Foundation for perfect/abundant numbers, divisor-sum identities, and Möbius problems. | The formula requires *exact* exponents; an off-by-one in the exponent ruins `d` and `σ`. |

**When to use:** you need `d(n)` or `σ(n)` for one number you can factor, or for *all* numbers up to a memory-fittable bound `N` (the common competitive-programming case — sieve once, answer many queries).

**When NOT to use:** computing `σ` of a single number near `10^18` whose factorization you do not have — that reduces to *factoring* a huge number (topics `08-miller-rabin`, `09-pollard-rho`), which is a different and harder problem.

---

## Step-by-Step Walkthrough

Let us compute `d(72)` and `σ(72)` by hand, both ways, and watch them agree.

**Way 1 — list the divisors (the slow check).** Divisors of `72`: `1, 2, 3, 4, 6, 8, 9, 12, 18, 24, 36, 72`.

```
count: 12 divisors          → d(72) = 12
sum:   1+2+3+4+6+8+9+12+18+24+36+72 = 195   → σ(72) = 195
```

**Way 2 — use the factorization formula (the fast way).** Factor `72 = 8 · 9 = 2³ · 3²`. So the exponents are `a₁ = 3` (for `p = 2`) and `a₂ = 2` (for `p = 3`).

```
d(72) = (3+1)(2+1) = 4 · 3 = 12                          ✓ matches
σ(72) = σ(2³) · σ(3²)
      = (1+2+4+8) · (1+3+9)
      = (2⁴−1)/(2−1) · (3³−1)/(3−1)
      = 15 · 13
      = 195                                              ✓ matches
```

Both ways give `d(72) = 12` and `σ(72) = 195`. The factorization route did a tiny amount of arithmetic; the listing route required generating all twelve divisors. For `72` the difference is trivial, but for `n = 10^12` the formula route (after factoring) is the only practical option.

**Bonus — is `72` perfect, abundant, or deficient?** The sum of *proper* divisors is `σ(72) − 72 = 195 − 72 = 123`. Since `123 > 72`, the proper divisors *over*shoot — `72` is **abundant**. (A perfect number would have `σ(n) − n = n`, i.e. `σ(n) = 2n`; a deficient one falls short.)

---

## Code Examples

### Example 1: `d(n)` and `σ(n)` by trial-division factorization (single number)

Factor `n` by trial division, accumulating `d` and `σ` from each prime power.

#### Go

```go
package main

import "fmt"

// dSigma returns the number of divisors d(n) and the sum of divisors sigma(n).
func dSigma(n int64) (d int64, sigma int64) {
	d, sigma = 1, 1
	for p := int64(2); p*p <= n; p++ {
		if n%p == 0 {
			// count the exponent a of prime p, and accumulate p^0+...+p^a
			a := int64(0)
			term := int64(1) // will become 1 + p + ... + p^a
			pk := int64(1)   // p^k
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
	if n > 1 { // a leftover prime factor with exponent 1
		d *= 2
		sigma *= 1 + n
	}
	return
}

func main() {
	for _, n := range []int64{12, 72, 360, 97} {
		d, s := dSigma(n)
		fmt.Printf("n=%d: d=%d sigma=%d\n", n, d, s)
	}
	// n=12: d=6 sigma=28
	// n=72: d=12 sigma=195
	// n=360: d=24 sigma=1170
	// n=97: d=2 sigma=98
}
```

#### Java

```java
public class DivisorFunctions {
    // returns {d(n), sigma(n)}
    static long[] dSigma(long n) {
        long d = 1, sigma = 1;
        for (long p = 2; p * p <= n; p++) {
            if (n % p == 0) {
                long a = 0, term = 1, pk = 1;
                while (n % p == 0) {
                    n /= p;
                    a++;
                    pk *= p;
                    term += pk; // 1 + p + ... + p^a
                }
                d *= (a + 1);
                sigma *= term;
            }
        }
        if (n > 1) { // leftover prime
            d *= 2;
            sigma *= (1 + n);
        }
        return new long[]{d, sigma};
    }

    public static void main(String[] args) {
        for (long n : new long[]{12, 72, 360, 97}) {
            long[] r = dSigma(n);
            System.out.printf("n=%d: d=%d sigma=%d%n", n, r[0], r[1]);
        }
    }
}
```

#### Python

```python
def d_sigma(n):
    """Return (number of divisors, sum of divisors) of n."""
    d, sigma = 1, 1
    p = 2
    while p * p <= n:
        if n % p == 0:
            a, term, pk = 0, 1, 1
            while n % p == 0:
                n //= p
                a += 1
                pk *= p
                term += pk          # 1 + p + ... + p^a
            d *= a + 1
            sigma *= term
        p += 1
    if n > 1:                       # leftover prime factor
        d *= 2
        sigma *= 1 + n
    return d, sigma


if __name__ == "__main__":
    for n in (12, 72, 360, 97):
        print(f"n={n}: d, sigma = {d_sigma(n)}")
    # n=12: (6, 28)   n=72: (12, 195)   n=360: (24, 1170)   n=97: (2, 98)
```

**What it does:** factors each `n` in `O(√n)`, building `d(n)` as a product of `(exponent+1)` and `σ(n)` as a product of geometric sums. The `if n > 1` tail handles a single large prime factor left after the loop.
**Run:** `go run main.go` | `javac DivisorFunctions.java && java DivisorFunctions` | `python divisors.py`

### Example 2: Divisor sieve — `d(m)` and `σ(m)` for ALL `m ≤ N`

For every divisor `d`, stride through its multiples and contribute. `O(N log N)`.

#### Go

```go
package main

import "fmt"

// divisorSieve returns cnt and sum where cnt[m]=d(m), sum[m]=sigma(m) for m<=N.
func divisorSieve(N int) (cnt []int, sum []int64) {
	cnt = make([]int, N+1)
	sum = make([]int64, N+1)
	for d := 1; d <= N; d++ {
		for m := d; m <= N; m += d {
			cnt[m]++          // d divides m
			sum[m] += int64(d) // add divisor d
		}
	}
	return
}

func main() {
	cnt, sum := divisorSieve(12)
	for m := 1; m <= 12; m++ {
		fmt.Printf("m=%2d  d=%d  sigma=%d\n", m, cnt[m], sum[m])
	}
}
```

#### Java

```java
public class DivisorSieve {
    static int[] cnt;
    static long[] sum;

    static void divisorSieve(int N) {
        cnt = new int[N + 1];
        sum = new long[N + 1];
        for (int d = 1; d <= N; d++) {
            for (int m = d; m <= N; m += d) {
                cnt[m]++;
                sum[m] += d;
            }
        }
    }

    public static void main(String[] args) {
        divisorSieve(12);
        for (int m = 1; m <= 12; m++) {
            System.out.printf("m=%2d  d=%d  sigma=%d%n", m, cnt[m], sum[m]);
        }
    }
}
```

#### Python

```python
def divisor_sieve(N):
    cnt = [0] * (N + 1)
    sig = [0] * (N + 1)
    for d in range(1, N + 1):
        for m in range(d, N + 1, d):
            cnt[m] += 1     # d divides m
            sig[m] += d     # add divisor d
    return cnt, sig


if __name__ == "__main__":
    cnt, sig = divisor_sieve(12)
    for m in range(1, 13):
        print(f"m={m:2d}  d={cnt[m]}  sigma={sig[m]}")
```

**What it does:** fills `d(m)` and `σ(m)` for every `m ≤ N` in one `O(N log N)` double loop. After this, each query is a single array read.
**Run:** same commands as Example 1.

---

## Coding Patterns

### Pattern 1: Pair divisors around `√n` (faster single-number naive)

**Intent:** When you do not want to factor but still want better than `O(n)`, use that divisors come in pairs `(d, n/d)`. Walk only to `√n`.

```python
def d_sigma_pairs(n):
    cnt, total = 0, 0
    i = 1
    while i * i <= n:
        if n % i == 0:
            cnt += 1
            total += i
            j = n // i
            if j != i:        # avoid double-counting a perfect square's root
                cnt += 1
                total += j
        i += 1
    return cnt, total
```

This is `O(√n)` and needs no factorization — handy when `n` is small enough that `√n` is cheap.

### Pattern 2: Sieve once, query many

**Intent:** When you must answer "what is `σ(m)`?" for thousands of `m ≤ N`, run the divisor sieve once and answer each query in `O(1)`.

```python
cnt, sig = divisor_sieve(1_000_000)
for q in (12, 360, 1000):
    print(q, "-> d =", cnt[q], ", sigma =", sig[q])
```

### Pattern 3: Sum of divisors only (skip the count)

**Intent:** If you need only `σ`, drop the `cnt` array to save memory and a tiny bit of time.

```python
def sigma_sieve(N):
    sig = [0] * (N + 1)
    for d in range(1, N + 1):
        for m in range(d, N + 1, d):
            sig[m] += d
    return sig
```

### Pattern 4: Find numbers with the most divisors (highly composite probe)

**Intent:** Many problems ask for the smallest number `≤ N` with the maximum `d(n)`. Sieve `d`, then scan.

```python
cnt, _ = divisor_sieve(100)
best_m = max(range(1, 101), key=lambda m: cnt[m])
print("most divisors <= 100:", best_m, "with d =", cnt[best_m])  # 60 with d=12
```

```mermaid
graph TD
    A["n = p1^a1 * p2^a2 * ..."] -->|factorize| B[primes and exponents]
    B -->|product of (a_i + 1)| C["d(n) = number of divisors"]
    B -->|product of geometric sums| D["sigma(n) = sum of divisors"]
    A -->|"for all m <= N: stride multiples"| E["divisor sieve O(N log N)"]
    E --> C
    E --> D
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| `σ(n)` overflows | Sum of divisors grows large; 32-bit too small. | Use 64-bit (`int64`/`long`) for `σ` and `σ_k`. |
| `d(n)` wrong by a factor | Off-by-one: used `a_i` instead of `a_i + 1`. | The count per prime is `exponent + 1`. |
| Forgot the leftover prime | Trial loop stops at `√n`; a prime `> √n` remains. | After the loop, if `n > 1`, multiply `d` by `2` and `σ` by `1 + n`. |
| Division gives wrong `σ` | Used floating-point `(p^{a+1}-1)/(p-1)`. | Accumulate `1 + p + … + p^a` with integer addition instead. |
| Sieve too slow / wrong bound | Inner loop or array sized incorrectly. | Size arrays `N+1`; inner loop `m = d; m <= N; m += d`. |
| `n = 0` handled wrongly | `0` has no well-defined divisor functions. | Guard: divisor functions are defined for `n ≥ 1`. |

---

## Performance Tips

- **For one number, factor instead of walking.** `O(√n)` factorization beats the `O(n)` divisor walk for any sizeable `n`.
- **Accumulate the geometric sum with integers**, not the closed-form division — it avoids floating-point error and is just as fast.
- **For all numbers up to `N`, use the divisor sieve.** Never factor each of `N` numbers separately when one `O(N log N)` pass does all of them.
- **Drop arrays you do not need.** If you only want `σ`, skip the `cnt` array; if only `d`, skip `sum`.
- **Use the linear sieve** (see `senior.md`) when `N` is large and you need true `O(N)` instead of `O(N log N)`.
- **Sieve once, query `O(1)`.** The whole point of the sieve is amortizing one build over many lookups.

---

## Best Practices

- Always use 64-bit for `σ(n)`; it grows much faster than `n` and overflows 32-bit quickly.
- Write the naive `1..n` (or `1..√n`) version first and use it to *test* the formula version on all `n ≤ 1000`.
- Remember the leftover-prime tail in trial-division factorization — it is the most common correctness bug.
- For `d(n)`, the per-prime contribution is `(exponent + 1)`; for `σ(n)` it is `1 + p + … + p^a`.
- When sieving, size arrays `N+1` and index by the number itself for clarity.
- Validate against known values: `d(12)=6`, `σ(12)=28`, `d(360)=24`, `σ(360)=1170`, `σ(6)=12`.

---

## Edge Cases & Pitfalls

- **`n = 1`** — `d(1) = 1` (only divisor is `1`) and `σ(1) = 1`. The factorization is empty, so the product is `1` (the empty product). Make sure your code returns `1`, not `0`.
- **`n` prime** — `d(p) = 2`, `σ(p) = p + 1`. The trial loop never enters the body; the leftover-prime tail handles it.
- **`n` a perfect square** — when pairing divisors, the root `√n` pairs with itself; count it once, not twice.
- **Large `σ`** — `σ(n)` can exceed `n` substantially (e.g. abundant numbers); always 64-bit.
- **`n = 0`** — undefined; guard against it.
- **Repeated prime factors** — `12 = 2²·3` has exponent `2` for `2`; do not treat repeated primes as distinct.
- **Sieve memory** — `N = 10^8` with two arrays is hundreds of MB; mind the budget.

---

## Common Mistakes

1. **Using `a_i` instead of `a_i + 1`** in the divisor count — forgetting the `exponent = 0` choice (the divisor that omits that prime).
2. **Forgetting the leftover prime** after trial division stops at `√n`.
3. **Overflowing `σ`** by using 32-bit integers.
4. **Floating-point geometric sum** — `(p^{a+1}-1)/(p-1)` in floats loses precision; sum with integers.
5. **Double-counting `√n`** when pairing divisors of a perfect square.
6. **Returning `0` for `d(1)` or `σ(1)`** instead of `1` (the empty product).
7. **Factoring every number** in a range instead of using one divisor sieve.

---

## Cheat Sheet

| Question | Tool | Note |
|----------|------|------|
| `d(n)` for one number | factor, then `Π(a_i+1)` | `O(√n)` |
| `σ(n)` for one number | factor, then `Π(1+p+…+p^a)` | `O(√n)` |
| `d(m)`/`σ(m)` for all `m ≤ N` | divisor sieve | `O(N log N)` |
| All values in true `O(N)` | linear sieve | see `senior.md` |
| Number of divisors of `p^a` | `a + 1` | |
| Sum of divisors of `p^a` | `(p^{a+1}−1)/(p−1)` | geometric series |
| Is `n` perfect? | `σ(n) == 2n` | abundant if `>`, deficient if `<` |

Core formulas (from `n = p₁^a₁ · … · p_k^a_k`):

```
d(n)   = Π (a_i + 1)
σ(n)   = Π (p_i^{a_i+1} − 1)/(p_i − 1)
σ_k(n) = Π (p_i^{k(a_i+1)} − 1)/(p_i^k − 1)
d = σ₀,   σ = σ₁
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - A number's prime factorization broken into prime-power blocks, each contributing `(a_i+1)` to `d(n)` and a geometric sum to `σ(n)`
> - The product building up live as each prime power is folded in
> - A divisor sieve sweeping a row of numbers `1..N`, with divisor `d` striking its multiples and incrementing their divisor counts / sums
> - Step / Run / Reset controls, an editable `n` and `N`, an info panel, a Big-O table, and an operation log

---

## Summary

The divisor functions answer two natural questions about a number: *how many* divisors it has (`d(n)`, also `τ(n)` or `σ₀(n)`) and what they *sum to* (`σ(n)`, also `σ₁(n)`). The magic is that both come straight from the prime factorization: a divisor is just an independent choice of exponent `0 … a_i` for each prime, so `d(n) = Π(a_i+1)`, and summing those choices via the distributive law gives `σ(n) = Π(1 + p_i + … + p_i^{a_i})`. For a single number, factor in `O(√n)` and apply the formula; for *all* numbers up to `N`, the divisor sieve strides through multiples in `O(N log N)` and lets you answer queries in `O(1)`. The classic bugs are tiny but fatal: using `a_i` instead of `a_i+1`, forgetting the leftover prime after trial division, and overflowing `σ` in 32-bit. Master those, and you have the foundation for perfect/abundant numbers, divisor-sum identities, and the multiplicative-function machinery that comes next. The multiplicativity, the linear-sieve recurrence, and perfect/abundant classification wait in [`middle.md`](./middle.md).

---

## Further Reading

- *Introduction to Algorithms* (CLRS) — number-theoretic algorithms and the harmonic-sum analysis behind the `O(N log N)` divisor sieve.
- Sibling file [`middle.md`](./middle.md) — multiplicativity, the divisor sieve for all `n`, perfect/abundant/deficient numbers.
- Sibling file [`senior.md`](./senior.md) — large-`N` precompute systems, memory, batch queries, and the linear-sieve `O(N)` computation.
- Sibling file [`professional.md`](./professional.md) — multiplicativity proofs, the `Σ N/i = O(N log N)` sieve bound, the Dirichlet-convolution view, and `σ` asymptotics.
- Sibling topic `02-prime-factorization` — how to obtain the factorization the formulas depend on.
- Sibling topic `03-prime-sieves` — the sieve structure the divisor sieve mirrors; the linear sieve referenced in `senior.md`.
- Sibling topic `32-mobius-inversion` — the Dirichlet-convolution and Möbius view of divisor sums.
- cp-algorithms.com — "Number of divisors / sum of divisors" and "Linear Sieve".
- Project Euler problems 12 (triangular number with 500 divisors), 21 (amicable numbers), 23 (abundant numbers) — direct practice with `d` and `σ`.
- Sibling file [`interview.md`](./interview.md) — tiered Q&A and a divisor-function coding challenge in Go/Java/Python.
- Sibling file [`tasks.md`](./tasks.md) — graded beginner/intermediate/advanced exercises in all three languages.

Next step: continue to [`middle.md`](./middle.md) — multiplicativity, the all-`n` divisor sieve, and perfect/abundant/deficient numbers.
