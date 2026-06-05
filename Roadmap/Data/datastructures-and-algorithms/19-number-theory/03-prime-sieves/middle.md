# Prime Sieves — Middle Level

> **Focus:** The **linear (Euler) sieve** that runs in `O(n)` and records the smallest prime factor (SPF) of every number, the **segmented sieve** for ranges `[L, R]` with huge `R`, the odd-only / wheel / bitset memory optimizations, and how to sieve the multiplicative functions `φ`, `μ`, divisor count, and divisor sum along the way.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The Linear (Euler) Sieve with SPF](#the-linear-euler-sieve-with-spf)
4. [Segmented Sieve for Ranges](#segmented-sieve-for-ranges)
5. [Memory Optimizations: Odd-Only, Wheel, Bitset](#memory-optimizations-odd-only-wheel-bitset)
6. [Sieving Multiplicative Functions](#sieving-multiplicative-functions)
7. [Comparison with Alternatives](#comparison-with-alternatives)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was: the Sieve of Eratosthenes crosses out multiples of each prime and runs in `O(n log log n)`. At middle level we sharpen that into the tools real number-theory code uses every day:

- The **linear sieve** (also called Euler's sieve) eliminates the redundant re-crossing of the classic sieve so that *every composite is struck exactly once* — giving a true `O(n)` bound and, as a bonus, the **smallest prime factor** of every number.
- The **smallest prime factor (SPF)** table turns factorization of any `x ≤ n` into an `O(log x)` walk: repeatedly divide out `spf[x]`.
- The **segmented sieve** lets you find primes in a window `[L, R]` even when `R` is as large as `10^12`, as long as `R − L` is modest — by sieving the window with the precomputed primes up to `√R`.
- **Odd-only**, **wheel factorization**, and **bitset** representations cut the constant factor and the memory by 2×–8×, which is what makes `n = 10^8`–`10^9` feasible.
- The linear sieve also computes **multiplicative functions** — Euler's totient `φ`, the Möbius function `μ`, the number of divisors `τ`, the sum of divisors `σ` — in the same `O(n)` pass.

These are the building blocks of nearly every number-theory problem that asks you to precompute something for "all numbers up to `n`."

---

## Deeper Concepts

### Why the classic sieve is *not* linear

In Eratosthenes, a composite like `12 = 2²·3` is crossed out twice: once as a multiple of 2, once as a multiple of 3. In general a composite with `k` distinct prime factors gets crossed out roughly `k` times. Summed over all numbers, this redundancy is what produces the `log log n` factor. If we could arrange for **each composite to be struck exactly once**, the total work would be exactly `n − π(n)` cross-outs, i.e. `O(n)`. That is precisely what the linear sieve achieves, by the rule "strike `i·p` only by `p` = the smallest prime factor of `i·p`."

### Smallest prime factor (SPF)

Define `spf[x]` = the smallest prime that divides `x` (with `spf[prime] = prime`). If you know `spf[x]` for all `x ≤ n`, factorization is trivial:

```
factorize(x):
    while x > 1:
        p = spf[x]
        record p
        while x % p == 0: x /= p
```

Each step removes at least one prime factor, and `x` at least halves over the whole loop, so factorization is `O(log x)`. This is the single most useful by-product of the linear sieve, and the reason competitive programmers reach for it over plain Eratosthenes whenever factorization is needed.

### Multiplicative functions, briefly

A function `f` is **multiplicative** if `f(ab) = f(a)f(b)` whenever `gcd(a, b) = 1`. Euler's totient `φ`, Möbius `μ`, divisor count `τ`, and divisor sum `σ` are all multiplicative. Because the linear sieve visits every number as `n = p · m` (with `p = spf[n]`), it can propagate `f(n)` from `f(m)` using the function's behavior on prime powers. The exact recurrences appear below and are proven in [`professional.md`](./professional.md).

---

## The Linear (Euler) Sieve with SPF

The linear sieve maintains a growing list of primes. For each `i` from 2 to `n`, it marks `i · p` composite for each known prime `p`, **but stops the inner loop as soon as `p` divides `i`**. That stopping rule is the whole trick: it guarantees every composite `c` is marked exactly once — by the pair `(c / spf[c], spf[c])`.

```
linear_sieve(n):
    spf[0..n] = 0
    primes = []
    for i = 2; i <= n; i++:
        if spf[i] == 0:          # i is prime
            spf[i] = i
            primes.append(i)
        for p in primes:
            if p > spf[i] or i*p > n: break   # p must be <= spf[i]
            spf[i*p] = p          # p is the smallest prime factor of i*p
```

**Why exactly once?** Consider any composite `c` with smallest prime factor `q`. Write `c = q · m` where `m = c / q`. Then `q ≤ spf[m]` (because `q` is the *smallest* prime factor of `c`, hence no larger than the smallest prime factor of `m`). So when the outer loop reaches `i = m`, the inner loop reaches `p = q` *before* breaking (the break happens when `p > spf[i]`), and marks `spf[c] = q`. No other `(i, p)` pair can produce `c`, because `spf[c] = q` forces `i = c/q` and `p = q` uniquely. The full proof is in [`professional.md`](./professional.md).

The cost is `O(n)`: each composite is assigned its `spf` exactly once, and each prime is appended once. The trade-off versus Eratosthenes is a slightly larger constant and `O(n)` integer storage for `spf` instead of `O(n)` bits — but you gain instant factorization.

---

## Segmented Sieve for Ranges

Sometimes you need the primes in `[L, R]` where `R` is huge (say `10^12`) but the window `R − L` is small (say `10^6`). You cannot allocate an array of size `R`. The **segmented sieve** observes that any composite `c ≤ R` has a prime factor `≤ √R`. So:

1. Sieve all primes up to `√R` with a plain Eratosthenes (cheap: `√(10^12) = 10^6`).
2. Allocate a boolean array `inRange[0 .. R−L]` representing `[L, R]`, all `true`.
3. For each prime `p ≤ √R`, cross out its multiples *within the window*. The first multiple of `p` that is `≥ L` is `start = max(p², ⌈L/p⌉ · p)`. Cross out `start, start+p, start+2p, …` up to `R`, mapping index `m` to `m − L`.
4. Survivors in the window are the primes in `[L, R]` (handle `L ≤ 1` specially).

```
segmented_sieve(L, R):
    base_primes = sieve(floor(sqrt(R)))
    inRange = [true] * (R - L + 1)
    if L == 0: inRange[0] = inRange[1 - L if 1 in range else ...] ...  # clear 0,1
    for p in base_primes:
        start = max(p*p, ((L + p - 1) / p) * p)   # first multiple of p >= L, >= p²
        for m = start; m <= R; m += p:
            inRange[m - L] = false
    primes = [L + i for i in 0..R-L if inRange[i] and L+i >= 2]
```

This runs in `O((R − L + 1) · log log R + √R)` time and `O(R − L + √R)` space — independent of how large `R` is, only of the window size. Counting primes near `10^12` in a small window is exactly the kind of task this solves. (Counting *all* primes up to `10^12` requires sublinear methods like Meissel-Mertens / Lucy_Hedgehog, beyond this sieve.)

---

## Memory Optimizations: Odd-Only, Wheel, Bitset

The plain sieve wastes half its array on even numbers (all composite except 2) and stores one byte per flag. Three optimizations stack:

- **Odd-only sieve.** Handle 2 separately, then store only odd numbers. Index `i` represents the value `2i + 1` (or `2i + 3`). This halves memory and roughly halves time. When crossing out multiples of an odd prime `p`, step by `2p` (skip the even multiples, which are not in the array).
- **Wheel factorization.** Generalize odd-only by skipping multiples of the first few primes (2, 3, 5). A "mod-30 wheel" stores only the 8 residues coprime to 30 per block of 30 integers, reducing both memory and cross-outs to `8/30 ≈ 27%` of the naive count. The bookkeeping is fiddlier; odd-only is the common sweet spot.
- **Bitset / bit-packing.** Store each flag as a single *bit* rather than a byte: 8× memory reduction. A `uint64` array with bit `x` representing number `x` lets you sieve `n = 10^9` in ~125 MB (or ~60 MB odd-only). Crossing out is `bits[m>>6] |= 1<<(m&63)` style. This is the standard approach for large `n` (see [`senior.md`](./senior.md) for cache implications).

These optimizations change only the constant factor and memory, not the asymptotic complexity — but in practice they are the difference between a sieve that fits in cache/RAM and one that does not.

---

## Sieving Multiplicative Functions

Inside the same linear-sieve loop, we can compute `f(n)` for a multiplicative `f` using its values on prime powers. The key cases in the inner loop, when we set `spf[i*p] = p`:

- If `p` does **not** divide `i` (i.e. `p < spf[i]`, so `gcd(i, p) = 1`): `f(i·p) = f(i) · f(p)` by multiplicativity.
- If `p` **does** divide `i` (i.e. `p == spf[i]`, the break case): `i·p` raises the power of `p`, so we use the prime-power rule for `f`.

Concrete recurrences (all proven in [`professional.md`](./professional.md)):

| Function | At prime `p` | When `p ∤ i` | When `p ∣ i` |
|----------|--------------|--------------|--------------|
| Euler `φ(n)` | `φ(p) = p − 1` | `φ(i·p) = φ(i)·(p−1)` | `φ(i·p) = φ(i)·p` |
| Möbius `μ(n)` | `μ(p) = −1` | `μ(i·p) = −μ(i)` | `μ(i·p) = 0` (square factor) |
| Divisor count `τ(n)` | `τ(p) = 2` | `τ(i·p) = τ(i)·2` | track exponent `cnt[i·p] = cnt[i]+1`, `τ = τ(i)/(cnt[i]+1)·(cnt[i]+2)` |
| Divisor sum `σ(n)` | `σ(p) = p+1` | `σ(i·p) = σ(i)·(p+1)` | use `pow[]` of `p`: `σ(i·p) = σ(i/pₖ)·(p^{e+2}−1)/(p−1)` |

For `φ` and `μ` the rules are clean and need no extra bookkeeping. For `τ` and `σ` you keep an auxiliary array tracking the exponent of the smallest prime (and a power array for `σ`). The result: all four functions for every `x ≤ n` in one `O(n)` pass.

---

### Worked recurrence example: φ via the linear sieve

Let us trace how `φ` is filled for the first composites, so the two branches feel concrete.

- `φ(1) = 1` (seeded).
- `i = 2` prime: `φ(2) = 1`. Inner loop with `p = 2`: `2·2 = 4`, and `2 % 2 == 0`, so the *square-factor* branch: `φ(4) = φ(2)·2 = 2`.
- `i = 3` prime: `φ(3) = 2`. Inner with `p = 2`: `3·2 = 6`, `3 % 2 ≠ 0` (coprime): `φ(6) = φ(3)·(2−1) = 2`. Next `p = 3`: `3·3 = 9`, `3 % 3 == 0`: `φ(9) = φ(3)·3 = 6`.
- `i = 4` (composite, `spf=2`): `φ(4)=2` already. Inner with `p = 2`: `4·2 = 8`, `4 % 2 == 0`: `φ(8) = φ(4)·2 = 4`. Then `p = 2 == spf[4]` triggers the break — we do **not** try `p = 3` on `i = 4`, which is exactly what prevents `12` from being marked here (it will be marked at `i = 6, p = 2`).

Cross-check against the closed form `φ(n) = n · Π (1 − 1/p)`: `φ(8) = 8·(1−1/2) = 4` ✓, `φ(9) = 9·(1−1/3) = 6` ✓, `φ(6) = 6·(1−1/2)(1−1/3) = 2` ✓. The sieve reproduces the formula without ever computing the product explicitly.

### Counting primes in a window vs counting all primes

A common confusion: the segmented sieve can *list* primes in `[L, R]` and thus *count* them (`π(R) − π(L−1)` for that window), but it costs `O(R − L)` per window. To count primes up to a huge bound like `π(10^12)` you would need `10^12` cells across all windows — too slow. That global count uses sublinear prime-counting algorithms (Meissel-Mertens, Lucy_Hedgehog / "Lucy's method", or the Lehmer/LMO method), which are a different topic. The segmented sieve is for *enumerating* a manageable window, not for global counting.

### Wheel sizes and their trade-offs

| Wheel | Skips multiples of | Residues kept per period | Fraction of integers stored |
|-------|--------------------|--------------------------|-----------------------------|
| none | — | all | 100% |
| mod-2 (odd-only) | 2 | 1 of 2 | 50% |
| mod-6 | 2, 3 | 2 of 6 | 33% |
| mod-30 | 2, 3, 5 | 8 of 30 | 27% |
| mod-210 | 2, 3, 5, 7 | 48 of 210 | 23% |

Diminishing returns set in fast: mod-30 captures most of the benefit with manageable code, while mod-210 adds complexity for a few percent. Odd-only (mod-2) is the pragmatic default and what most production sieves ship.

## Comparison with Alternatives

| Method | Time | Space | Gives you | Use when |
|--------|------|-------|-----------|----------|
| Eratosthenes | `O(n log log n)` | `O(n)` bits | primality, prime list | simplest; just need primes up to `n` |
| Linear (Euler) sieve | `O(n)` | `O(n)` ints | primality + **SPF** + mult. functions | need factorization or `φ`/`μ`/`τ`/`σ` |
| Segmented sieve | `O((R−L)log log R + √R)` | `O(R−L+√R)` | primes in `[L, R]` | `R` huge, window small |
| Trial division (per number) | `O(√x)` each | `O(1)` | factor one `x` | a single number, no precompute |
| Miller-Rabin (topic `08`) | `O(k log³ x)` | `O(1)` | primality of one huge `x` | `x` far beyond any sieve bound |
| Pollard's rho (topic `09`) | `~O(x^{1/4})` | `O(1)` | factor one huge `x` | factoring a single `10^18` number |

**Rule of thumb:** need primes/factorization for *all* numbers up to a bound that fits in RAM → linear sieve (or Eratosthenes if SPF unneeded). Need a window with a huge upper bound → segmented sieve. Need *one* number that is too big to sieve → Miller-Rabin / Pollard's rho. The most common production mistake is reaching for a full sieve when a single Miller-Rabin call would do, or vice versa; match the tool to whether you have *one* number or *a dense range*.

---

## Advanced Patterns

### Pattern: factor count and SMOD-style queries

With `spf[]` you can answer many number-theoretic queries about every `x ≤ n` cheaply:

- **Number of distinct prime factors** `ω(x)`: walk the SPF chain, counting distinct primes.
- **Number of prime factors with multiplicity** `Ω(x)`: count every division step.
- **Largest prime factor**: the last `spf` reached as you divide down.
- **Squarefree test**: `x` is squarefree iff every prime in its SPF walk appears once iff `μ(x) ≠ 0`.

### Pattern: smallest sieve that fits — choose `n` from constraints

Decide the sieve bound from the problem, not by guessing. If you must factor any `x ≤ X`, sieve SPF up to `X`. If you only need *primes used as trial divisors* for numbers up to `Y`, you only need primes up to `√Y`. Sieving the wrong (too-large) bound is a frequent memory-limit-exceeded cause.

### Pattern: precompute then prefix-sum

Most "sum of `f` over a range" problems become two `O(n)` passes: sieve `f`, then prefix-sum it so range queries are `O(1)`.

```python
spf, phi, mu, _ = linear_sieve(n)
pref_phi = [0] * (n + 1)
for i in range(1, n + 1):
    pref_phi[i] = pref_phi[i - 1] + phi[i]
# sum of phi over [a, b] = pref_phi[b] - pref_phi[a-1], in O(1)
```

## Code Examples

### Linear sieve with SPF, plus `φ` and `μ`

#### Go

```go
package main

import "fmt"

func linearSieve(n int) (spf, phi, mu []int, primes []int) {
	spf = make([]int, n+1)
	phi = make([]int, n+1)
	mu = make([]int, n+1)
	phi[1], mu[1] = 1, 1
	for i := 2; i <= n; i++ {
		if spf[i] == 0 { // i is prime
			spf[i] = i
			phi[i] = i - 1
			mu[i] = -1
			primes = append(primes, i)
		}
		for _, p := range primes {
			if p > spf[i] || i*p > n {
				break
			}
			spf[i*p] = p
			if i%p == 0 { // p divides i: square factor
				phi[i*p] = phi[i] * p
				mu[i*p] = 0
			} else { // coprime
				phi[i*p] = phi[i] * (p - 1)
				mu[i*p] = -mu[i]
			}
		}
	}
	return
}

func factorize(x int, spf []int) []int {
	var f []int
	for x > 1 {
		p := spf[x]
		f = append(f, p)
		for x%p == 0 {
			x /= p
		}
	}
	return f
}

func main() {
	n := 30
	spf, phi, mu, primes := linearSieve(n)
	fmt.Println("primes:", primes)
	fmt.Println("spf[24] =", spf[24], " phi[12] =", phi[12], " mu[30] =", mu[30])
	fmt.Println("distinct prime factors of 360:", factorize(360, mustSieve(360)))
}

func mustSieve(n int) []int { s, _, _, _ := linearSieve(n); return s }
```

#### Java

```java
import java.util.*;

public class LinearSieve {
    static int[] spf, phi, mu;
    static List<Integer> primes = new ArrayList<>();

    static void linearSieve(int n) {
        spf = new int[n + 1];
        phi = new int[n + 1];
        mu = new int[n + 1];
        phi[1] = 1; mu[1] = 1;
        for (int i = 2; i <= n; i++) {
            if (spf[i] == 0) { // prime
                spf[i] = i; phi[i] = i - 1; mu[i] = -1;
                primes.add(i);
            }
            for (int p : primes) {
                if (p > spf[i] || (long) i * p > n) break;
                spf[i * p] = p;
                if (i % p == 0) {           // square factor
                    phi[i * p] = phi[i] * p;
                    mu[i * p] = 0;
                } else {                    // coprime
                    phi[i * p] = phi[i] * (p - 1);
                    mu[i * p] = -mu[i];
                }
            }
        }
    }

    static List<Integer> factorize(int x) {
        List<Integer> f = new ArrayList<>();
        while (x > 1) {
            int p = spf[x];
            f.add(p);
            while (x % p == 0) x /= p;
        }
        return f;
    }

    public static void main(String[] args) {
        linearSieve(360);
        System.out.println("spf[24] = " + spf[24] + " phi[12] = " + phi[12] + " mu[30] = " + mu[30]);
        System.out.println("distinct prime factors of 360: " + factorize(360));
    }
}
```

#### Python

```python
def linear_sieve(n):
    spf = [0] * (n + 1)
    phi = [0] * (n + 1)
    mu = [0] * (n + 1)
    phi[1] = mu[1] = 1
    primes = []
    for i in range(2, n + 1):
        if spf[i] == 0:        # prime
            spf[i] = i
            phi[i] = i - 1
            mu[i] = -1
            primes.append(i)
        for p in primes:
            if p > spf[i] or i * p > n:
                break
            spf[i * p] = p
            if i % p == 0:      # square factor
                phi[i * p] = phi[i] * p
                mu[i * p] = 0
            else:               # coprime
                phi[i * p] = phi[i] * (p - 1)
                mu[i * p] = -mu[i]
    return spf, phi, mu, primes


def factorize(x, spf):
    f = []
    while x > 1:
        p = spf[x]
        f.append(p)
        while x % p == 0:
            x //= p
    return f


if __name__ == "__main__":
    spf, phi, mu, primes = linear_sieve(360)
    print("spf[24] =", spf[24], "phi[12] =", phi[12], "mu[30] =", mu[30])
    print("distinct prime factors of 360:", factorize(360, spf))
```

**Expected:** `spf[24] = 2`, `phi[12] = 4`, `mu[30] = -1`; prime factors of 360 = `[2, 3, 5]`.

### Segmented sieve for `[L, R]` (Python)

```python
import math


def simple_sieve(limit):
    is_p = bytearray([1]) * (limit + 1)
    is_p[0] = is_p[1] = 0
    for p in range(2, int(limit ** 0.5) + 1):
        if is_p[p]:
            is_p[p * p :: p] = b"\x00" * len(range(p * p, limit + 1, p))
    return [i for i in range(2, limit + 1) if is_p[i]]


def segmented_sieve(L, R):
    base = simple_sieve(int(math.isqrt(R)))
    size = R - L + 1
    in_range = bytearray([1]) * size
    if L == 0:
        in_range[0] = 0
        if size > 1:
            in_range[1] = 0
    elif L == 1:
        in_range[0] = 0
    for p in base:
        start = max(p * p, (L + p - 1) // p * p)
        for m in range(start, R + 1, p):
            in_range[m - L] = 0
    return [L + i for i in range(size) if in_range[i]]


if __name__ == "__main__":
    print(segmented_sieve(10**12, 10**12 + 50))
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Linear sieve marks a composite twice | Forgot the `p > spf[i]` break (or used `i % p == 0` then continue, not break). | Break the inner loop when `p == spf[i]` (after marking). |
| `φ`/`μ` wrong for prime powers | Did not distinguish `p ∣ i` from `p ∤ i`. | Use the `i % p == 0` branch for square factors. |
| Segmented sieve misses `start` | Used `2p` or `p` as the start instead of `max(p², ⌈L/p⌉·p)`. | Compute the first multiple of `p` that is `≥ L` and `≥ p²`. |
| `0`/`1` reported prime in window | Did not clear them when `L ≤ 1`. | Special-case `L == 0` and `L == 1`. |
| Overflow in `i*p` or `p*p` | 32-bit multiply for large `n`/`R`. | Use 64-bit; check `i*p > n` with widened types. |
| Bitset off-by-one | Wrong bit index for odd-only mapping. | Keep the value↔index map (e.g. value `2i+1`) consistent everywhere. |

---

## Performance Analysis

- **Linear vs Eratosthenes constant.** The linear sieve does `~n` operations but writes to an `int` SPF array (4–8 bytes/entry) with less cache-friendly access patterns than the tight byte/bit cross-out of Eratosthenes. For *just primality up to `n`*, an odd-only bitset Eratosthenes is often *faster wall-clock* despite the `log log n` factor, because it is cache-friendly. Use the linear sieve when you specifically need SPF or multiplicative functions.
- **Segmented sieve and cache.** Process the range in cache-sized blocks (e.g. 32 KB) so each block stays in L1/L2 while you stride through the base primes — this is the dominant performance lever for large `R` (covered in `senior.md`).
- **Odd-only / wheel** cut both the array size and the number of cross-outs; a mod-30 wheel does ~73% fewer cross-outs than the naive sieve.
- **`φ`/`μ` prefix sums.** Many problems want `Σ φ(i)` or `Σ μ(i)`; compute them in a second `O(n)` pass after sieving.

---

### Odd-only Eratosthenes (bitset-friendly) — Go

A practical, fast primality sieve that stores only odd numbers. Value `2i+3` lives at index `i`.

```go
package main

import "fmt"

// oddSieve returns a list of primes up to n using an odd-only sieve.
func oddSieve(n int) []int {
	if n < 2 {
		return nil
	}
	primes := []int{2}
	// index i represents the odd number 2*i + 3
	size := (n - 1) / 2 // count of odds in [3, n]
	composite := make([]bool, size)
	for i := 0; i < size; i++ {
		if composite[i] {
			continue
		}
		p := 2*i + 3
		primes = append(primes, p)
		// first odd multiple of p that is >= p*p is p*p (odd*odd = odd)
		for m := p * p; m <= n; m += 2 * p { // step 2p skips even multiples
			composite[(m-3)/2] = true
		}
	}
	return primes
}

func main() {
	fmt.Println(oddSieve(50)) // [2 3 5 7 11 13 17 19 23 29 31 37 41 43 47]
}
```

This stores ~`n/2` flags and steps by `2p`, halving both memory and cross-out work versus the naive version, while remaining cache-friendly — often the fastest pure-primality sieve in practice.

## Best Practices

- Prefer the **linear sieve** whenever you need factorization (`spf`) or a multiplicative function; prefer **bitset Eratosthenes** when you need only primality for large `n` and care about wall-clock.
- For ranges with huge `R`, always **segment** and reuse base primes up to `√R`; never allocate an array of size `R`.
- Keep the value-to-index mapping explicit and commented in odd-only/wheel sieves — that is where bugs hide.
- Initialize `f(1)` correctly: `φ(1) = 1`, `μ(1) = 1`, `τ(1) = 1`, `σ(1) = 1`.
- Validate sieved functions against direct formulas on small inputs (`φ(12)=4`, `μ(30)=−1`, `τ(360)=24`, `σ(6)=12`).
- Decide *once* whether you need the prime list, the SPF table, or both, and return exactly that.
- When sieving multiplicative functions, write a tiny brute-force `f` (direct factorization) and assert equality for all `x ≤ 1000` before trusting the sieved version.
- For segmented sieving, process `[L, R]` in fixed-size blocks sized to L2 cache rather than as one giant window; this keeps the working set hot and is the main speed lever (detailed in `senior.md`).
- Keep `int` vs `long` discipline: indices can stay 32-bit, but products (`i*p`, `p*p`, `start`) that approach the bound should be 64-bit.

---

## Further Reading

- cp-algorithms.com — "Linear Sieve", "Sieve of Eratosthenes", "Segmented Sieve".
- Sibling file [`interview.md`](./interview.md) — SPF factorization, segmented-sieve, and sum-of-totient coding challenges with runnable Go/Java/Python.
- Sibling file [`professional.md`](./professional.md) — proof that the linear sieve marks each composite exactly once, and the multiplicative-function correctness proofs.
- Sibling file [`senior.md`](./senior.md) — bitset/wheel memory layout, cache blocking, parallel sieving.
- Sibling topics `04-factorization`, `05-totient`, `06-mobius` — downstream uses of the SPF table and the sieved functions.
- Sibling topics `08-miller-rabin`, `09-pollard-rho` — primality and factorization for single huge numbers.

## Visual Animation

> See [`animation.html`](./animation.html) for the interactive Sieve of Eratosthenes. The same striking-out mechanic underlies the linear sieve; the difference (each composite struck exactly once, by its smallest prime factor) is the conceptual upgrade this file makes.

---

## Edge Cases Across the Three Sieves

- **Linear sieve, `i*p` overflow.** For large `n`, the product `i*p` can exceed the index type; widen to 64-bit when comparing `i*p > n`.
- **Segmented sieve, `L == p`.** If a base prime `p` itself falls in `[L, R]`, your `start = max(p², ⌈L/p⌉·p)` correctly begins at `p²`, leaving `p` itself marked prime — good.
- **Segmented sieve, narrow window.** If `R − L` is tiny (a few values), the `√R` base sieve dominates the cost; that is expected and unavoidable.
- **Odd-only sieve, `n` even vs odd.** The number of stored odds is `(n − 1)/2`; double-check the count so the last odd `≤ n` has a valid index.
- **Multiplicative functions at `n = 1`.** Seed `f(1)` explicitly; the loop starts at `i = 2` and never sets index 1.
- **`μ` of a number with a squared prime.** Must be `0`; the `i % p == 0` branch enforces this. A common bug is forgetting that branch and getting nonzero `μ` for non-squarefree numbers.

## When to Choose Which Sieve (Decision Flow)

```mermaid
graph TD
    A[Need primes / factors] --> B{Single huge number?}
    B -->|yes| C[Miller-Rabin / Pollard rho — topics 08, 09]
    B -->|no| D{Range [L,R] with huge R?}
    D -->|yes| E[Segmented sieve, base primes up to sqrt R]
    D -->|no| F{Need SPF or phi/mu/tau/sigma?}
    F -->|yes| G[Linear / Euler sieve, O(n)]
    F -->|no| H[Bitset odd-only Eratosthenes, fastest primality]
```

## Summary

The linear (Euler) sieve fixes the redundancy of Eratosthenes by striking each composite exactly once — by its smallest prime factor — giving a true `O(n)` bound plus an SPF table that factorizes any `x ≤ n` in `O(log x)`. The same `O(n)` pass computes `φ`, `μ`, `τ`, and `σ` via their multiplicative recurrences. For ranges `[L, R]` with enormous `R`, the segmented sieve uses base primes up to `√R` to sieve a small window without ever allocating an `R`-sized array. Odd-only, wheel, and bitset representations shave constants and memory by 2×–8×, making `n` up to `10^9` practical. Choose the linear sieve for factorization and multiplicative functions, bitset Eratosthenes for raw primality speed, and the segmented sieve for huge bounds — and reach for Miller-Rabin / Pollard's rho (topics `08`/`09`) when a *single* number outgrows any sieve.
