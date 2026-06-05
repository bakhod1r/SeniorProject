# Miller-Rabin Primality Testing — Middle Level

> **Focus:** Why the `n-1 = d·2^s` decomposition plus the witness inner loop catches every composite that Fermat misses, the probabilistic `≤ 1/4` error per base, the *proven* deterministic 64-bit witness sets, overflow-safe `mulmod`, and how Miller-Rabin compares with trial division, Fermat, and AKS.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The `n-1 = d·2^s` Decomposition and Witness Loop](#the-n-1--d2s-decomposition-and-witness-loop)
4. [Comparison with Alternatives](#comparison-with-alternatives)
5. [Deterministic 64-bit Witness Sets](#deterministic-64-bit-witness-sets)
6. [Overflow-Safe mulmod](#overflow-safe-mulmod)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was the recipe: write `n - 1 = d·2^s`, run the witness loop, look for `1` and `-1`. At middle level you start asking the questions that decide whether your implementation is correct *and* fast *and* (when needed) exact:

- *Why* does watching the squaring chain `a^d, a^(2d), a^(4d), …` catch composites the Fermat test misses?
- What exactly is the `≤ 1/4` error bound per random base, and how does it compound over `k` bases?
- Which *fixed* base sets are *proven* to make Miller-Rabin deterministic for all `n < 2^64`, and where did they come from?
- How do you multiply two near-`2^64` values modulo `n` without overflow — `__int128`, the doubling trick, or Montgomery?
- When is plain trial division actually the right call, and how does AKS fit in?

These separate "I copied a Miller-Rabin snippet" from "I can choose the right base set, prove my mulmod is overflow-free, and explain the error bound."

---

## Deeper Concepts

### Fermat, restated, and its liars

Fermat's Little Theorem gives, for prime `n` and `gcd(a, n) = 1`,

```
a^(n-1) ≡ 1 (mod n).
```

The Fermat test computes `a^(n-1) mod n`; a result `≠ 1` is a **Fermat witness** proving compositeness. The trouble is the **Fermat liars**: composites `n` for which `a^(n-1) ≡ 1` anyway. For a **Carmichael number** *every* coprime base is a liar, so Fermat is hopeless. Miller-Rabin strengthens the test so that liars become rare and Carmichael numbers lose their immunity.

### The square-root-of-1 lemma (the engine)

The whole improvement rests on one fact (proved in [`professional.md`](./professional.md)):

> **Modulo a prime `p`, `x² ≡ 1` implies `x ≡ 1` or `x ≡ -1`.**

Because `x² - 1 = (x-1)(x+1)` and a prime dividing a product must divide a factor. For a **composite** `n` with at least two distinct prime factors, the Chinese Remainder Theorem produces *extra* "nontrivial" square roots of `1`. Miller-Rabin hunts for one of them inside the Fermat computation.

### Reading Fermat's exponent as a squaring chain

Since `n - 1 = d·2^s`, we have

```
a^(n-1) = a^(d·2^s) = ( … ((a^d)²)² … )²     (s squarings)
```

Define the chain `x_0 = a^d`, `x_1 = x_0²`, …, `x_s = x_{s-1}² = a^(n-1) (mod n)`. If `n` is prime then `x_s ≡ 1`, and the **first time** the chain hits `1`, the value just before it must be a square root of `1`, hence `±1`. If we ever see the chain reach `1` from a value that is **not** `±1`, we have caught a nontrivial square root of `1` — `n` is composite. Equivalently, a prime forces either `x_0 ≡ 1` or some `x_r ≡ -1` for `0 ≤ r < s`. Miller-Rabin checks exactly that.

---

## The `n-1 = d·2^s` Decomposition and Witness Loop

### Step 1 — decompose

For odd `n > 2`, `n - 1` is even; pull out **all** the 2s:

```
n - 1 = d · 2^s,   d odd,   s ≥ 1.
```

`s` is the number of trailing zero bits of `n - 1`; `d` is `(n-1) >> s`. Examples:

| `n` | `n - 1` | `d` | `s` |
|-----|---------|-----|-----|
| 13 | 12 = 3·4 | 3 | 2 |
| 561 | 560 = 35·16 | 35 | 4 |
| 2047 | 2046 = 1023·2 | 1023 | 1 |
| 25326001 | 25326000 | 1582875 | 4 |

### Step 2 — the witness inner loop

For a base `a`:

```
x = a^d mod n
if x == 1 or x == n-1:
    base passes (no witness)        # x_0 is already ±1
else:
    repeat s-1 times:
        x = x*x mod n               # advance the chain x_r -> x_{r+1}
        if x == n-1:                # found -1 in the chain
            base passes; stop
    if loop finished without seeing n-1:
        a is a WITNESS -> n is composite
```

Two subtle correctness points:

1. **Why `s-1` squarings, not `s`?** We already checked `x_0 = a^d`. The chain has `x_0, …, x_{s-1}` as the values that could legitimately equal `-1` (the final `x_s` would be `a^(n-1)`, which we do not need to test for `-1` — if a prime, `x_{s-1}` was already `±1`). So we square `s-1` times, testing each new value against `n-1`.
2. **Why does hitting `1` mid-loop without a prior `-1` prove composite?** If `x_r ≠ ±1` but `x_{r+1} = x_r² = 1`, then `x_r` is a nontrivial square root of `1` — impossible mod a prime. In code we detect this implicitly: if we never see `-1`, we declare a witness (the value would have to become `1` via a forbidden root).

### Why this catches Carmichael numbers

Take `n = 561`, `a = 2`, `d = 35`, `s = 4`. Fermat gives `2^560 ≡ 1`. But the chain is `2^35 ≡ 263`, then `263² ≡ 166`, `166² ≡ 67`, `67² ≡ 1`. We hit `1` from `67`, never having seen `-1`. So `2` is a witness — Miller-Rabin reports composite where Fermat was fooled.

### Tracing the chain as a table

It helps to lay the chain out explicitly. For `n = 561`, `a = 2`, `d = 35`, `s = 4`, the relevant values `x_r = a^(d·2^r) mod n` are:

| `r` | `x_r = 2^(35·2^r) mod 561` | check |
|-----|-----------------------------|-------|
| 0 | `2^35 mod 561 = 263` | not `1`, not `560` |
| 1 | `263² mod 561 = 166` | not `560` |
| 2 | `166² mod 561 = 67` | not `560` |
| 3 | `67² mod 561 = 1` | hit `1` from `67 ≠ ±1` → **witness** |

We test `x_0` against `1` and `-1`, then square `s-1 = 3` times testing each new value against `-1`. The chain reached `1` at `r = 3` from a non-`±1` predecessor, so `2` is a witness. Compare a prime: for `n = 97`, `a = 5`, `96 = 3·2^5`, the chain reaches `-1` somewhere before `1`, so `5` passes — and so does every base, confirming `97` prime.

### What "passes" really proves (and does not)

When a base passes, it does **not** prove `n` is prime — it only fails to prove compositeness. A composite can pass for some bases (a *strong liar*). The strength of Miller-Rabin is the *bound*: at most a quarter of bases are liars (next section), so passing many independent bases makes compositeness increasingly implausible, and a proven base set makes it impossible below the threshold.

---

## Comparison with Alternatives

| Method | Time per test | Exact? | Notes |
|--------|---------------|--------|-------|
| Trial division | `O(√n)` | Yes | Simple; only viable for small `n`. |
| Fermat test (`k` bases) | `O(k log³ n)` | **No** | Fooled forever by Carmichael numbers. |
| **Miller-Rabin (probabilistic, `k` bases)** | `O(k log³ n)` | No, error `≤ (1/4)^k` | The practical workhorse for huge `n`. |
| **Miller-Rabin (deterministic, `n < 2^64`)** | `O(log³ n)` | **Yes** | Fixed proven base set; the standard exact 64-bit test. |
| BPSW (MR base 2 + Lucas) | `O(log³ n)` | Yes (no counterexample below `2^64`) | Two-part test; no known pseudoprime. |
| AKS | `Õ(log⁶ n)`-ish | Yes, unconditional | Polynomial-time, but slow in practice. |

Concrete intuition for `n ≈ 10^18`:

| Method | Rough operation count |
|--------|------------------------|
| Trial division | `√n ≈ 10^9` divisions — too slow |
| Deterministic MR (12 bases) | `12 · 60 ≈ 720` modular multiplications — microseconds |
| Deterministic MR (7 bases) | `7 · 60 ≈ 420` modular multiplications — faster |

The lesson: for any `n` past a few million, Miller-Rabin is the answer; trial division survives only as a small-factor pre-filter and as a correctness oracle. AKS matters theoretically (it proved primality is in `P`) but is not used in practice; for 64-bit work the deterministic base sets win.

### Fermat vs Miller-Rabin, side by side

| Aspect | Fermat | Miller-Rabin |
|--------|--------|--------------|
| Checks | `a^(n-1) ≡ 1` | the full squaring chain incl. `-1` |
| Carmichael numbers | always fooled | caught |
| Worst-case liar fraction | up to *all* coprime bases | `≤ 1/4` of all bases |
| Cost | `O(log³ n)` per base | `O(log³ n)` per base (same!) |

Miller-Rabin costs essentially the same as Fermat (one fast power plus a short squaring loop) yet is far stronger — there is no reason to ship the plain Fermat test.

### Trial division as a complement, not a competitor

Trial division is not just the slow baseline — it has two live roles alongside Miller-Rabin:

1. **Small-prime pre-filter.** Dividing by the first ~25-100 primes before any modular exponentiation rejects the majority of random composites at near-zero cost, and correctly classifies tiny `n`. This is a *speedup*, not a replacement.
2. **Correctness oracle.** For all `n` up to a few million, run trial division and assert it agrees with Miller-Rabin. This is the cheapest, most reliable way to catch a mulmod-overflow, a decomposition off-by-one, or an accidental Fermat-only implementation.

So the production pattern is: trial-divide by small primes → if it survives, run Miller-Rabin with the right base set. The two work together; trial division alone only stands in for `n` small enough that `√n` is cheap.

### A note on the AKS comparison

AKS proved primality is in `P` (deterministic polynomial time, unconditional), a landmark result. But its `Õ(log⁶ n)`-class cost dwarfs Miller-Rabin's `O(log³ n)` (and `O(1)` for fixed-width 64-bit), and the hidden constants are large. In practice no one uses AKS to *test* a number; Miller-Rabin (or BPSW) is used instead. AKS matters because it settled a deep theoretical question, not because it is fast.

---

## Deterministic 64-bit Witness Sets

Rabin's theorem gives `≤ 1/4` error *per random base*, but for *bounded* `n` mathematicians have searched exhaustively for fixed base sets that catch **every** composite below a threshold. These make Miller-Rabin **deterministic** — no randomness, no error — in that range:

| Bound on `n` | Sufficient bases (all are witnesses for every composite below the bound) |
|--------------|--------------------------------------------------------------------------|
| `2,047` | `{2}` |
| `1,373,653` | `{2, 3}` |
| `9,080,191` | `{31, 73}` |
| `25,326,001` | `{2, 3, 5}` |
| `3,215,031,751` | `{2, 3, 5, 7}` |
| `3,474,749,660,383` | `{2, 3, 5, 7, 11, 13}` |
| `341,550,071,728,321` | `{2, 3, 5, 7, 11, 13, 17}` |
| `3,825,123,056,546,413,051` | `{2, 3, 5, 7, 11, 13, 17, 19, 23}` |
| `< 2^64` | `{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37}` |
| `< 3.3·10^24` (and `< 2^64`) | `{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37}` (Jaeschke/Sorenson-Webster) |

A widely used minimal set for the full 64-bit range is the **first twelve primes** `{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37}` (proven by Sorenson & Webster, 2015). A smaller 7-base set `{2, 325, 9375, 28178, 450775, 9780504, 1795265022}` is also proven sufficient for all `n < 2^64` (found by Jim Sinclair), and is popular in competitive programming because it runs fewer bases. Pick the smallest proven set that covers your range. (See `professional.md` for the Pomerance-Selfridge-Wagstaff and Jaeschke bounds.)

> **Rule of thumb:** if `n` is guaranteed `< 3.2·10^9`, four bases `{2,3,5,7}` are exact. If `n` can be any 64-bit value, use the 12-base or the 7-base proven set.

### Where the thresholds come from

Each threshold `ψ_m` is the **smallest** composite that is a strong pseudoprime to *all* of the first `m` prime bases. Below `ψ_m`, those `m` bases contain a witness for every composite, so the test is exact. The values were found by exhaustive computer search (Pomerance-Selfridge-Wagstaff, Jaeschke, Sorenson-Webster): strong pseudoprimes to base 2 are already rare, and requiring a number to fool base 2 *and* 3 *and* 5 *and* … pushes the smallest survivor up astronomically. By twelve bases, no survivor exists below `3·10^{23}`, comfortably past `2^64 ≈ 1.8·10^{19}`.

### The smallest failing example per set

It is instructive to know the exact number each set first fails on, for testing:

| Base set | first composite it wrongly calls prime |
|----------|----------------------------------------|
| `{2}` | `2047 = 23·89` |
| `{2,3}` | `1373653` |
| `{2,3,5}` | `25326001` |
| `{2,3,5,7}` | `3215031751` |

Including these "threshold pseudoprimes" in your test suite confirms your base set is large enough for your range — if your `{2,3}`-test reports `1373653` as prime, that is *correct behaviour* for that set, signalling you must add more bases for larger inputs.

---

## Overflow-Safe mulmod

For `n` near `2^64`, the product `a · b` of two residues can be up to `~2^128`, overflowing a 64-bit register. The squaring step `x = x*x mod n` is where this bites. Three standard fixes:

### Option A — 128-bit intermediate (`__int128`)

If the language has a 128-bit type, compute the full product and reduce:

```
mulmod(a, b, n) = (uint128(a) * b) % n
```

C/C++ has `__int128`; Go has `math/bits.Mul64` + `Div64`; Java has `Math.multiplyHigh` / `BigInteger`. This is the simplest and fastest portable choice when available.

### Option B — the doubling (Russian-peasant) trick

Without a 128-bit type, multiply by repeated doubling, reducing mod `n` at every step so values stay `< n < 2^63`:

```
mulmod(a, b, n):
    result = 0
    a %= n
    while b > 0:
        if b & 1: result = (result + a) % n
        a = (a + a) % n        # never exceeds 2n < 2^64 if n < 2^63
        b >>= 1
    return result
```

This is `O(log b)` additions per multiply — slower, but needs no wide type. It requires `n < 2^63` so `a + a` does not overflow; for the full `2^64` range, lift to `__int128` or `unsigned __int128`.

### Option C — Montgomery multiplication

For *many* multiplications modulo the same `n` (exactly the case in `powMod`), **Montgomery form** replaces the expensive `% n` with cheap shifts and multiplies. It is the fastest production choice for repeated modular multiplication; details and code are in [`senior.md`](./senior.md). The trade-off: a one-time setup per `n` and slightly more complex code.

| mulmod | Needs wide type? | Speed | When |
|--------|------------------|-------|------|
| `__int128` | yes | fast | C/C++/Rust; Go via `bits` |
| doubling trick | no | slow (`O(log b)`) | any language, `n < 2^63` |
| Montgomery | no (uses words) | fastest for many muls | hot loops, crypto |

---

## Code Examples

### Probabilistic Miller-Rabin with `k` random bases (with portable mulmod)

This version uses `k` random bases for a `≤ (1/4)^k` error bound and a doubling `mulmod` that needs no 128-bit type (valid for `n < 2^63`).

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

func mulMod(a, b, n uint64) uint64 {
	var res uint64 = 0
	a %= n
	for b > 0 {
		if b&1 == 1 {
			res = (res + a) % n
		}
		a = (a + a) % n
		b >>= 1
	}
	return res
}

func powMod(a, e, n uint64) uint64 {
	res := uint64(1) % n
	a %= n
	for e > 0 {
		if e&1 == 1 {
			res = mulMod(res, a, n)
		}
		a = mulMod(a, a, n)
		e >>= 1
	}
	return res
}

func isComposite(n, a uint64) bool {
	d, s := n-1, 0
	for d&1 == 0 {
		d >>= 1
		s++
	}
	x := powMod(a, d, n)
	if x == 1 || x == n-1 {
		return false
	}
	for r := 0; r < s-1; r++ {
		x = mulMod(x, x, n)
		if x == n-1 {
			return false
		}
	}
	return true
}

func isPrimeProb(n uint64, k int) bool {
	if n < 2 {
		return false
	}
	if n%2 == 0 {
		return n == 2
	}
	for i := 0; i < k; i++ {
		a := 2 + uint64(rand.Int63n(int64(n-3))) // base in [2, n-2]
		if isComposite(n, a) {
			return false
		}
	}
	return true
}

func main() {
	fmt.Println(isPrimeProb(561, 20))        // false
	fmt.Println(isPrimeProb(1000000007, 20)) // true
}
```

#### Java

```java
import java.util.Random;

public class MillerRabinProb {
    static long mulMod(long a, long b, long n) {
        long res = 0;
        a %= n;
        while (b > 0) {
            if ((b & 1) == 1) res = (res + a) % n;
            a = (a + a) % n;
            b >>= 1;
        }
        return res;
    }

    static long powMod(long a, long e, long n) {
        long res = 1 % n;
        a %= n;
        while (e > 0) {
            if ((e & 1) == 1) res = mulMod(res, a, n);
            a = mulMod(a, a, n);
            e >>= 1;
        }
        return res;
    }

    static boolean isComposite(long n, long a) {
        long d = n - 1;
        int s = 0;
        while ((d & 1) == 0) { d >>= 1; s++; }
        long x = powMod(a, d, n);
        if (x == 1 || x == n - 1) return false;
        for (int r = 0; r < s - 1; r++) {
            x = mulMod(x, x, n);
            if (x == n - 1) return false;
        }
        return true;
    }

    static boolean isPrimeProb(long n, int k) {
        if (n < 2) return false;
        if (n % 2 == 0) return n == 2;
        Random rnd = new Random(12345);
        for (int i = 0; i < k; i++) {
            long a = 2 + (Math.floorMod(rnd.nextLong(), n - 3));
            if (isComposite(n, a)) return false;
        }
        return true;
    }

    public static void main(String[] args) {
        System.out.println(isPrimeProb(561, 20));        // false
        System.out.println(isPrimeProb(1000000007L, 20)); // true
    }
}
```

#### Python

```python
import random


def is_composite(n, a, d, s):
    x = pow(a, d, n)
    if x == 1 or x == n - 1:
        return False
    for _ in range(s - 1):
        x = x * x % n
        if x == n - 1:
            return False
    return True


def is_prime_prob(n, k=20):
    if n < 2:
        return False
    if n % 2 == 0:
        return n == 2
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for _ in range(k):
        a = random.randrange(2, n - 1)   # base in [2, n-2]
        if is_composite(n, a, d, s):
            return False
    return True


if __name__ == "__main__":
    print(is_prime_prob(561))         # False
    print(is_prime_prob(1000000007))  # True
```

The probabilistic version is preferred when `n` may exceed `2^64` (no proven finite base set covers arbitrary `n`); the deterministic fixed-base version (junior.md) is preferred for `n < 2^64`.

### Understanding the `(1/4)^k` bound concretely

Rabin's theorem says at most `1/4` of bases are strong liars for a composite. So:

| `k` (random bases) | worst-case error `(1/4)^k` |
|--------------------|-----------------------------|
| 1 | `0.25` |
| 5 | `~0.00098` (`≈ 1/1024`) |
| 10 | `~9.5·10^{-7}` |
| 20 | `~9.1·10^{-13}` |
| 40 | `~8.3·10^{-25}` |

For `k = 40` the error is below the probability of a hardware cosmic-ray bit flip — effectively zero. Two important caveats: (1) this is the **worst case**; for a *random* `n`, the average-case error per round is far smaller (Damgård-Landrock-Pomerance), so cryptographic standards use only ~5 rounds for large random candidates. (2) The bound assumes **independent random** bases — repeating the same base, or using a fixed small set on adversarially crafted `n`, voids the guarantee. Always draw bases uniformly from `[2, n-2]` for the probabilistic mode.

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| `a*b` overflow near `2^64` | wrong residues → wrong verdict | overflow-safe mulmod (`__int128` / doubling / Montgomery) |
| Random base `a ∉ [2, n-2]` | `a = 0,1` always "pass"; `a = n-1` is `-1` | draw bases in `[2, n-2]`; reduce `a %= n` |
| `s` off-by-one | miss the legitimate `-1` or over-loop | square exactly `s-1` times after `a^d` |
| even `n` or `n ≤ 3` unhandled | decomposition `d,s` degenerates | special-case before the loop |
| Fermat-only logic | Carmichael numbers pass | include the `x == n-1` chain check |
| wrong base set for range | a composite slips through deterministically | use a *proven* set covering your `n` |

---

## Performance Analysis

| `n` size | mulmod | bases | rough modular multiplies |
|----------|--------|-------|--------------------------|
| `< 3.2·10^9` | `__int128` | `{2,3,5,7}` | `4 · ~30 ≈ 120` |
| `< 2^64` | `__int128` | 12-base set | `12 · ~60 ≈ 720` |
| `< 2^64` | `__int128` | 7-base set | `7 · ~60 ≈ 420` |
| `< 2^63` | doubling | 12-base | `720 · ~60` adds (doubling makes each mul `~log n` adds) |

Each base does one `powMod` (`O(log n)` modular multiplies) plus up to `s-1 < log n` extra squarings — so `O(log n)` multiplies per base, `O(log² n)` bit-ops per multiply (schoolbook) or `O(1)` per `__int128` multiply on 64-bit hardware. With `__int128`, a full deterministic 64-bit test is a few hundred machine multiplies — well under a microsecond.

```python
import time

def benchmark(numbers, k=12):
    start = time.perf_counter()
    for n in numbers:
        is_prime_prob(n, k)
    return time.perf_counter() - start

# Testing 100_000 random 60-bit numbers with k=12 finishes in a fraction of a second.
```

The single biggest constant-factor wins are: the **small-prime pre-filter** (rejects ~80% of random composites before any exponentiation), the **smaller proven base set**, and an `__int128` (or Montgomery) **mulmod** instead of the doubling trick.

The doubling-trick `mulmod` is `O(log b)` per multiply, so it inflates every modular multiplication by a `~60×` factor for 64-bit operands compared to a single `__int128` multiply. If your language has any 128-bit (or wide-multiply) primitive, use it; reserve the doubling trick for environments without one and `n < 2^63`. For very high volume (millions of tests), Montgomery form removes the division entirely and is worth the extra setup code.

---

## Best Practices

- **Decompose once:** compute `d, s` from `n-1` a single time per `n`, then reuse across all bases.
- **Pre-filter small primes** before the witness loop; it is the cheapest big speedup.
- **Use the smallest proven base set** for your guaranteed range; do not over-test.
- **Pin the mulmod strategy** to your language: `__int128` where available, doubling for `n < 2^63` portably, Montgomery for hot loops.
- **Choose deterministic vs probabilistic deliberately:** fixed proven bases for `n < 2^64`; random `k` bases (with the `(1/4)^k` bound stated) for larger `n`.
- **Always validate against trial division** for all `n` up to a million, including the Carmichael numbers `561, 1105, 1729, 2465, 2821, 6601, 8911`.
- **Test the largest 64-bit prime** `18446744073709551557` to confirm your `mulmod` does not overflow at the top of the range — small-number tests cannot catch this.
- **Document the verdict's meaning:** "composite" is a proof; "prime" is exact only with a proven base set, otherwise probabilistic with the stated `(1/4)^k` bound.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The `n - 1 = d·2^s` split with `s` shown as the number of squarings.
> - The chain `a^d, a^(2d), a^(4d), …` advancing one squaring per step.
> - The `1` / `-1` checks that decide "passes" vs "witness."
> - An editable `n` so you can watch a Carmichael number (e.g. `561`) get caught.

---

## Summary

Miller-Rabin reads Fermat's exponent `n - 1 = d·2^s` as a **squaring chain** `a^d, a^(2d), …` and inspects every step for `1` and `-1`, not just the endpoint. That extra inspection finds **nontrivial square roots of 1**, which exist only for composites, so it catches the **Carmichael numbers** that fool Fermat forever — at the same `O(log³ n)` cost per base. Each random base has error `≤ 1/4`, so `k` bases give `≤ (1/4)^k`; and for `n < 2^64` *proven* fixed base sets (the first 12 primes, or a 7-base set) make the test **deterministic and exact**. The one implementation hazard is **overflow in `mulmod`** for `n` near `2^64`: use `__int128`, the doubling trick (for `n < 2^63`), or Montgomery in hot loops. Against trial division (`O(√n)`), Fermat (Carmichael-fooled), and AKS (polynomial but slow), Miller-Rabin with a proven base set is the practical, exact 64-bit primality test.
