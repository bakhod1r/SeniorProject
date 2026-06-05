# Pollard's Rho Factorization — Senior Level

> Pollard's rho is rarely the bottleneck on a small composite — but the moment `n` reaches 64 bits, the modular multiply must be both **overflow-safe and fast** (Montgomery), the rare `gcd = n` collapse must be **recovered**, perfect powers and tiny factors must be **handled before** the main loop, and the whole thing must be **provably correct** when paired with primality testing. Every one of those details is a correctness or performance incident in production.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Overflow-Safe and Montgomery mulmod](#2-overflow-safe-and-montgomery-mulmod)
3. [Restart-on-Failure and Collapse Recovery](#3-restart-on-failure-and-collapse-recovery)
4. [Perfect Powers and Small Factors First](#4-perfect-powers-and-small-factors-first)
5. [Combining with Primality for Complete Factorization](#5-combining-with-primality-for-complete-factorization)
6. [Cryptographic Context: Why 64-bit Is Easy and RSA-2048 Is Not](#6-cryptographic-context)
7. [Performance Engineering](#7-performance-engineering)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "why does `gcd(|x − y|, n)` reveal a factor" but "what breaks when I ship a 64-bit factorizer and run it on adversarial inputs at scale?" Pollard's rho in production has four engineering pillars:

1. **A correct, fast modular multiply.** On 64-bit `n`, `a*b` overflows; the entire algorithm's correctness rides on `mulmod`. Montgomery multiplication makes it both safe and ~2–3× faster than the naive 128-bit path in the hot loop.
2. **Robust restarts.** rho is a *Monte Carlo* algorithm: a bad `c` yields no factor (`gcd` stays `1`) or collapses (`gcd = n`). The driver must detect both and retry with fresh randomness, with a recovery path for batched-gcd collapse.
3. **Pre-processing.** Stripping small primes and detecting perfect powers up front removes the inputs rho handles poorly (small factors, prime powers) and shrinks the hard core.
4. **Provably complete factorization.** rho splits; Miller-Rabin classifies; the recursion must be *correct* (every reported factor prime, product equals `n`, multiplicities right) and *terminating*.

This document treats those four pillars in production terms, plus the crypto context that explains why the same algorithm trivially factors 64-bit numbers yet cannot dent RSA.

---

## 2. Overflow-Safe and Montgomery mulmod

### 2.1 The overflow problem

For `n` near `2^{63}`, the product `a * b` of two residues `< n` is near `2^{126}` — far past 64 bits. A naive `(a*b) % n` in C/Go/Java silently wraps and returns a wrong "factor." This is the **single most common** rho bug. Three correct approaches:

- **128-bit product:** compute the full 128-bit `a*b` then reduce. `__int128` in C/C++; `math/bits.Mul64` + `bits.Div64` in Go; `Math.multiplyHigh` or `BigInteger` in Java; Python's arbitrary-precision ints make this automatic.
- **`__int128` everywhere** (C/C++): simplest correct path, good enough for most contests.
- **Montgomery multiplication:** transform operands into "Montgomery form" once, then each multiply is two 64-bit multiplies and a shift — **no division** in the inner loop. This is the production-grade choice.

### 2.2 Montgomery form

Montgomery multiplication replaces the expensive `% n` (a division) with cheap shifts and multiplies by working in a transformed domain. With `R = 2^{64}` and `n` odd:

- Precompute `n' = −n^{−1} mod R` (via Newton iteration) and `R² mod n`.
- `montMul(a, b)` computes `a·b·R^{−1} mod n` using `t = a*b; m = (t mod R)·n' mod R; (t + m·n) / R`, a conditional subtract — **all without a hardware divide**.
- Convert `x → xR mod n` on entry, `→ x` on exit.

Because rho does millions of multiplies in the hot loop and almost no conversions, the one-time setup amortizes away. Montgomery typically beats the 128-bit-divide path by 2–3× because integer division is the slowest ALU op. The catch: `n` must be **odd** (we strip the factor `2` first anyway) and `gcd(n, R) = 1` (automatic for odd `n`).

### 2.3 Newton iteration for the inverse

`n' = −n^{−1} mod 2^{64}` is computed by lifting the inverse mod `2^k`:

```
inv = n                      # inv ≡ n^{-1} mod 2^3 (n odd)
repeat 5 times: inv *= 2 - n*inv     # doubles the correct bits each step (mod 2^64)
n' = -inv (mod 2^64)
```

Five Newton steps suffice to reach 64 correct bits starting from 3. This is `O(1)` setup per `n`.

---

## 3. Restart-on-Failure and Collapse Recovery

### 3.1 rho is Monte Carlo

A single rho run can fail to produce a useful factor in two ways:

- **No collision found / `gcd` stays `1`** — the chosen `f` (this `c`) traced a cycle that never aligned mod `p` within the budget. Rare but possible. **Restart** with a new `c` and seed.
- **`gcd(|x − y|, n) = n`** — tortoise and hare collided mod `n` (or, with batching, the product over-multiplied past a factor). The result collapsed to the trivial divisor `n`. **Restart** (Floyd) or **recover** (Brent + batching).

A production driver wraps the core in a retry loop:

```
factorOne(n):
    for attempt in 1, 2, 3, …:
        d = rhoCore(n, c = random, seed = random)
        if 1 < d < n: return d
        # d == 1 or d == n → try again with fresh randomness
```

### 3.2 Collapse recovery with batched gcd

With batched gcd, a collapse means some `|x − y|` in the batch was a multiple of `p` but the batch product also hit a multiple of `n`. The fix is to **remember the batch start** `ys` and re-walk it one step at a time, taking a per-step gcd:

```
on gcd(Q, n) == n:
    y = ys                       # rewind to batch start
    repeat:
        y = f(y)
        d = gcd(|x − y|, n)
        if d > 1: break          # the first nontrivial gcd is the factor
    if d < n: return d           # recovered
    else: restart with new c
```

This recovers the factor the batch overshot in the vast majority of collapses; a true mod-`n` collision (no factor in the batch) still triggers a `c`-restart.

### 3.3 Choosing `c` and the seed

- **Never `c = 0`**: `f(x) = x²` has fixed points (`0`, `1`) and degenerate orbits.
- **Avoid `c = n − 2`**: known to be a poor choice for the `x²+c` family (it interacts badly with the seed `2`).
- **Randomize** both `c ∈ [1, n)` and the seed `x₀ ∈ [2, n)` per attempt. Determinism across attempts (reusing the same `c`) re-triggers the same failure.

---

## 4. Perfect Powers and Small Factors First

### 4.1 Strip small primes

Trial-divide by `2, 3, 5, 7, …` up to a few hundred or a thousand before rho. This:

- handles the **even** case (`2`) that rho treats awkwardly;
- removes small factors whose `√p` is so tiny that rho's overhead dominates;
- frequently reduces `n` to a single prime or a hard semiprime, the case rho is built for.

### 4.2 Detect perfect powers

rho can struggle to split a **prime power** `p^k` (the sequence mod `p` and mod `p²` correlate, weakening the collision). Before the main loop, check whether `n = m^k` for some `k ≥ 2`:

```
isPerfectPower(n):
    for k = 2 .. log2(n):
        r = round(n^{1/k})
        if r^k == n: return (r, k)     # n is a perfect power
    return none
```

If `n = m^k`, factor `m` (recursively) and raise each prime's multiplicity by `k`. This both speeds things up and sidesteps rho's prime-power weakness. The check is `O(log² n)` — negligible.

### 4.3 Order of operations

A robust `factor(n)`:

```
1. strip small primes (trial division)
2. if remaining n == 1: done
3. if isPrime(n): record; done                  # Miller-Rabin
4. if n = m^k (perfect power): factor(m), ×k multiplicities; done
5. d = rho(n) with restarts
6. recurse on d and n/d
```

---

## 5. Combining with Primality for Complete Factorization

### 5.1 The contract

rho returns *a* nontrivial factor, not necessarily prime. Completeness requires:

- **Every recursion node is classified** by Miller-Rabin: prime → leaf (record), composite → split.
- **Multiplicities are preserved**: if `d` and `n/d` share a prime, both subtrees contribute, and the final multiset is correct.
- **Termination**: each split yields strictly smaller numbers; Miller-Rabin halts at primes; small-prime stripping bounds the recursion depth.

### 5.2 Why correctness holds

`d = gcd(|x − y|, n)` with `1 < d < n` **divides** `n` by definition of gcd, so `d` and `n/d` are genuine cofactors with `d · (n/d) = n`. Recursing on both and recording only Miller-Rabin-certified primes yields a multiset whose product is `n` and whose every element is prime — exactly the prime factorization (unique by the Fundamental Theorem of Arithmetic). Miller-Rabin is deterministic for `n < 3.3 × 10^{24}` with the witness set `{2,3,5,7,11,13,17,19,23,29,31,37}`, so for 64-bit `n` the classification is **exact**, not probabilistic.

### 5.3 Miller-Rabin as both guard and base case

Miller-Rabin (sibling `08-miller-rabin`) plays two roles: it **prevents** rho from being called on a prime (which would loop), and it is the recursion's **base case**. Run it at the top of every recursion node. For 64-bit inputs use the deterministic witness set; for larger inputs use enough random bases that the error probability is `< 2^{−100}`.

---

## 6. Cryptographic Context

### 6.1 Why 64-bit is trivial

A 64-bit composite has a smallest prime factor `p ≤ √n ≤ 2^{32} ≈ 4.3 × 10^9`. rho finds it in `≈ √p ≤ 2^{16} ≈ 65000` iterations — microseconds. Even a hard 64-bit semiprime (two ~`2^{32}` primes) falls in `≈ n^{1/4} ≈ 65000` steps. The factorization of any 64-bit integer is, for practical purposes, instant.

### 6.2 Why RSA-2048 is safe from rho

RSA moduli are ~2048-bit semiprimes `n = p·q` with `p, q ≈ 2^{1024}`. rho's cost is `≈ √p ≈ 2^{512}` operations — vastly beyond any conceivable computation (the number of atoms in the universe is ~`2^{266}`). rho's `O(n^{1/4})` is exponential in the *bit length* of `n`, so doubling the key size squares the work. Real crypto-breaking uses the **General Number Field Sieve** (GNFS), sub-exponential at `L_n[1/3]` — still infeasible for 2048-bit but the asymptotically right tool, not rho.

### 6.3 What rho *can* do in crypto

rho and p−1 matter in crypto **defensively**: they are why key generation must avoid factors with smooth `p − 1` (use **safe primes** `p = 2q + 1`) and why moduli must be large. A weak RSA key with a small or smooth factor *can* be cracked by rho/p−1/ECM — these algorithms define the *floor* of acceptable key strength. They also factor the small numbers inside larger protocols (e.g., parameter validation).

### 6.4 The escalation ladder

| `n` bit length | Tool | Feasibility |
|----------------|------|-------------|
| ≤ 64 | Pollard's rho + Miller-Rabin | microseconds |
| 64–120 | rho, then ECM | milliseconds–seconds |
| 120–400 | ECM (factors up to ~`10^{40}`) | minutes–hours |
| 400–800 | Quadratic Sieve | hours–days (research) |
| 800–2048+ | GNFS | infeasible (RSA security margin) |

---

## 7. Performance Engineering

### 7.1 The hot loop is the multiply

rho does `O(n^{1/4})` iterations, each one mulmod for the iteration plus an amortized fraction of a gcd (with batching). The mulmod is `~90%` of the time. Therefore:

- **Montgomery** beats 128-bit-divide by 2–3× — the single biggest win.
- **Batched gcd** (Section middle) removes nearly all gcd cost: one gcd per ~128 multiplies.
- **Brent** over Floyd cuts `f` evaluations ~25%.
- **Strip small primes** so rho runs only on the hard core.

### 7.2 Binary gcd

The inner gcd, called once per batch, can use the **binary (Stein's) gcd** — only shifts and subtractions, no division — a further constant-factor win over the Euclidean `%`-based gcd, especially on architectures with slow integer division.

### 7.3 Parallelism

Multiple `c`-attempts are **independent** and can run concurrently; the first to find a factor wins (cancel the rest). Factoring a batch of many numbers is embarrassingly parallel across numbers. Within one rho run the sequence is inherently sequential (each `f` depends on the last), so parallelism lives across attempts and across inputs, not within a single walk.

### 7.4 Memory

rho is `O(1)` memory — a handful of 64-bit variables. There is no large allocation to tune; the performance story is entirely about the multiply and the gcd cadence.

---

## 8. Code Examples

### 8.1 Go — Montgomery-backed rho (full 64-bit safe)

```go
package main

import (
	"fmt"
	"math/bits"
	"math/rand"
)

// Montgomery context for an odd modulus n.
type mont struct {
	n, ninv, r2 uint64
}

func newMont(n uint64) mont {
	inv := n
	for i := 0; i < 5; i++ {
		inv *= 2 - n*inv // Newton: lifts n^{-1} mod 2^64
	}
	// r2 = (2^64)^2 mod n
	// compute 2^64 mod n first
	_, r := bits.Div64(1, 0, n) // 2^64 mod n
	r2 := mulmodPlain(r, r, n)
	return mont{n: n, ninv: -inv, r2: r2}
}

func mulmodPlain(a, b, m uint64) uint64 {
	hi, lo := bits.Mul64(a, b)
	_, r := bits.Div64(hi%m, lo, m)
	return r
}

// montMul returns a*b*R^{-1} mod n.
func (m mont) mul(a, b uint64) uint64 {
	hi, lo := bits.Mul64(a, b)
	t := lo * m.ninv
	mh, ml := bits.Mul64(t, m.n)
	_ = ml
	res, carry := bits.Add64(hi, mh, 0)
	if carry != 0 || res >= m.n {
		res -= m.n
	}
	return res
}

func (m mont) toMont(a uint64) uint64  { return m.mul(a, m.r2) }
func (m mont) fromMont(a uint64) uint64 { return m.mul(a, 1) }

func gcd(a, b uint64) uint64 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func absdiff(a, b uint64) uint64 {
	if a > b {
		return a - b
	}
	return b - a
}

func pollardRho(n uint64) uint64 {
	if n%2 == 0 {
		return 2
	}
	m := newMont(n)
	for {
		c := m.toMont(uint64(rand.Int63n(int64(n-1))) + 1)
		x := m.toMont(2)
		y := x
		d := uint64(1)
		f := func(v uint64) uint64 {
			r := m.mul(v, v) + c
			if r >= n {
				r -= n
			}
			return r
		}
		q := m.toMont(1)
		count := 0
		for d == 1 {
			x = f(x)
			y = f(f(y))
			q = m.mul(q, absdiff(m.fromMont(x), m.fromMont(y))%n+1) // +1 avoids zero-collapse
			count++
			if count%128 == 0 {
				d = gcd(m.fromMont(q), n)
				q = m.toMont(1)
			}
		}
		if d == 0 {
			d = gcd(m.fromMont(q), n)
		}
		if d > 1 && d < n {
			return d
		}
		// d == n or 1 → retry
	}
}

func main() {
	fmt.Println(pollardRho(1234567891011121314))
	fmt.Println(pollardRho(1000000007 * 1000000009))
}
```

### 8.2 Java — rho with small-prime strip and perfect-power check

```java
import java.math.BigInteger;
import java.util.*;

public class RhoSenior {
    static long mulmod(long a, long b, long m) {
        return BigInteger.valueOf(a).multiply(BigInteger.valueOf(b))
                .mod(BigInteger.valueOf(m)).longValue();
    }
    static long gcd(long a, long b) { while (b != 0) { long t = a % b; a = b; b = t; } return a; }

    static long[] perfectPower(long n) {           // returns {base, exp} or null
        for (int k = 2; (1L << k) <= n; k++) {
            long r = Math.round(Math.pow(n, 1.0 / k));
            for (long b = Math.max(2, r - 1); b <= r + 1; b++) {
                long p = 1; boolean of = false;
                for (int i = 0; i < k; i++) {
                    p *= b;
                    if (p > n) { of = true; break; }
                }
                if (!of && p == n) return new long[]{b, k};
            }
        }
        return null;
    }

    static long rho(long n) {
        if (n % 2 == 0) return 2;
        Random rnd = new Random();
        while (true) {
            long c = 1 + (Math.abs(rnd.nextLong()) % (n - 1));
            long x = 2, y = 2, d = 1;
            while (d == 1) {
                x = (mulmod(x, x, n) + c) % n;
                y = (mulmod(y, y, n) + c) % n;
                y = (mulmod(y, y, n) + c) % n;
                d = gcd(Math.abs(x - y), n);
            }
            if (d > 1 && d < n) return d;
        }
    }

    static boolean isPrime(long n) {
        if (n < 2) return false;
        for (long p : new long[]{2,3,5,7,11,13,17,19,23,29,31,37})
            if (n % p == 0) return n == p;
        long d = n - 1; int s = 0;
        while (d % 2 == 0) { d /= 2; s++; }
        for (long a : new long[]{2,3,5,7,11,13,17,19,23,29,31,37}) {
            long x = BigInteger.valueOf(a).modPow(BigInteger.valueOf(d), BigInteger.valueOf(n)).longValue();
            if (x == 1 || x == n - 1) continue;
            boolean ok = false;
            for (int i = 0; i < s - 1; i++) { x = mulmod(x, x, n); if (x == n - 1) { ok = true; break; } }
            if (!ok) return false;
        }
        return true;
    }

    static void rec(long m, List<Long> fs) {
        if (m == 1) return;
        if (isPrime(m)) { fs.add(m); return; }
        long[] pp = perfectPower(m);
        if (pp != null) {
            List<Long> sub = new ArrayList<>();
            rec(pp[0], sub);
            for (int i = 0; i < pp[1]; i++) fs.addAll(sub);
            return;
        }
        long d = rho(m);
        rec(d, fs); rec(m / d, fs);
    }

    static List<Long> factor(long n) {
        List<Long> fs = new ArrayList<>();
        for (long p = 2; p < 1000; p++) while (n % p == 0) { fs.add(p); n /= p; }
        rec(n, fs); Collections.sort(fs); return fs;
    }

    public static void main(String[] args) {
        System.out.println(factor(1000000007L * 1000000009L));
        System.out.println(factor(1024L));   // 2^10 — perfect power
    }
}
```

### 8.3 Python — robust driver with restart and collapse recovery

```python
from math import gcd, isqrt
from random import randrange


def is_prime(n):
    if n < 2:
        return False
    for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        if n % p == 0:
            return n == p
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2; s += 1
    for a in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = x * x % n
            if x == n - 1:
                break
        else:
            return False
    return True


def perfect_power(n):
    for k in range(2, n.bit_length() + 1):
        r = round(n ** (1.0 / k))
        for b in (r - 1, r, r + 1):
            if b >= 2 and b ** k == n:
                return b, k
    return None


def rho(n):
    if n % 2 == 0:
        return 2
    while True:
        c, x = randrange(1, n), randrange(2, n)
        y, d, q = x, 1, 1
        f = lambda v: (v * v + c) % n
        for _ in range(1 << 20):
            ys = y
            for _ in range(128):
                x = f(x); y = f(f(y))
                q = q * abs(x - y) % n
            d = gcd(q, n)
            if d == n:                       # collapse: recover step-by-step
                y = ys
                while True:
                    y = f(f(y))
                    d = gcd(abs(x - y), n)
                    if d > 1:
                        break
            if 1 < d < n:
                return d
            if d == 1:
                continue
            break                            # d == n unrecoverable → new c
        # exhausted budget → new c


def factor(n):
    fs = []

    def rec(m):
        if m == 1:
            return
        if is_prime(m):
            fs.append(m); return
        pp = perfect_power(m)
        if pp:
            base, k = pp
            sub = []
            rec_into(base, sub)
            fs.extend(sub * k)
            return
        d = rho(m)
        rec(d); rec(m // d)

    def rec_into(m, out):
        nonlocal fs
        save = fs; fs = out; rec(m); fs = save

    for p in range(2, 1000):
        while n % p == 0:
            fs.append(p); n //= p
    rec(n)
    return sorted(fs)


if __name__ == "__main__":
    print(factor(1000000007 * 1000000009))
    print(factor(1024))   # [2]*10
```

---

## 9. Observability and Testing

A factorization result is easy to **verify** even when hard to compute — this is a gift; use it.

| Check | Why |
|-------|-----|
| Product of returned factors equals `n` | Catches a dropped or duplicated factor instantly. |
| Every returned factor passes Miller-Rabin | Ensures leaves are truly prime, not composite cofactors. |
| Trial-division oracle on small `n` | Exact ground truth for `n ≤ 10^9`. |
| Random round-trip: pick primes, multiply, re-factor | Property test — the multiset must come back. |
| Restart counter / attempt histogram | Anomalous restart rates signal a bad `c`-choice or a mulmod bug. |
| `mulmod` cross-check vs BigInteger | The one routine whose silent overflow corrupts everything. |

### 9.1 Property-test battery

```text
for many random instances:
    pick random primes p1..pm (mixed sizes, with repeats)
    n = product
    f = factor(n)
    assert product(f) == n
    assert all(is_prime(x) for x in f)
    assert sorted(f) == sorted([p1..pm])
    assert mulmod(a, b, n) == (a*b) % n     # against big-int reference
```

The **product-equals-`n` + all-prime** pair is the highest-value invariant: it fully certifies a factorization without needing a known answer, because a multiset of primes multiplying to `n` *is* the unique factorization.

### 9.2 Production guardrails

For a service factoring numbers at scale: bound the **restart count** (after, say, 100 failed `c`-attempts, escalate or alert — a healthy 64-bit rho almost never needs that many); log the **smallest-factor size** alongside latency (latency should track `√(smallest prime)`); and validate inputs (`n ≥ 2`, fits in the supported width) before entering the loop. A self-check that re-multiplies the factors and compares to `n` on every call is cheap insurance.

---

## 10. Failure Modes

### 10.1 Silent overflow in mulmod

`(a*b) % n` wraps for 64-bit `n`, yielding a wrong "factor" that fails `d | n`. **Mitigation:** 128-bit product or Montgomery; cross-test against BigInteger.

### 10.2 Infinite loop on a prime

rho on a prime never finds a nontrivial gcd. **Mitigation:** Miller-Rabin before every rho call; bound iterations and restart.

### 10.3 Unrecovered collapse (`gcd = n`)

A batched-gcd collapse, if not recovered, looks like a failed run and wastes a restart — or, if mis-handled, returns `n` as a "factor." **Mitigation:** rewind to batch start and re-walk step-by-step; never return `n`.

### 10.4 Bad constant `c`

`c = 0` (fixed points) or `c = n − 2` (degenerate) cause repeated failure. **Mitigation:** randomize `c ∈ [1, n)` and reseed each attempt; exclude the known-bad values.

### 10.5 Prime-power blindness

rho can stall on `p^k`. **Mitigation:** perfect-power check before the main loop; factor the base and scale multiplicities.

### 10.6 Small factors slipping through

rho is awkward with tiny primes and the even case. **Mitigation:** strip small primes by trial division first.

### 10.7 Probabilistic primality on large inputs

For `n` beyond the deterministic Miller-Rabin range, too few witnesses can misclassify a composite as prime, ending recursion early and reporting a composite "prime." **Mitigation:** deterministic witness set for 64-bit; for larger `n`, enough random bases for `< 2^{−100}` error, or a BPSW test.

### 10.8 Non-termination from a missing base case

Forgetting `m == 1` or the `isPrime` leaf makes `factor` recurse forever. **Mitigation:** explicit base cases; assert progress (each split strictly decreases the operand).

---

## 11. Summary

- rho's correctness rides on a **safe `mulmod`**: 128-bit product or, in production, **Montgomery multiplication** (no inner-loop divide, 2–3× faster). The naive `(a*b) % n` silently overflows on 64-bit `n` and is the dominant bug.
- rho is **Monte Carlo**: wrap the core in a **restart loop** that retries with fresh random `c` and seed on `gcd == 1` or `gcd == n`, and **recover** batched-gcd collapses by re-walking the batch step-by-step.
- **Pre-process**: strip small primes (handles `2`, removes tiny-factor cases) and detect **perfect powers** (rho stalls on `p^k`) before the main loop.
- Pair with **Miller-Rabin** (sibling `08`) for a **provably complete** factorization: it guards rho from primes, serves as the recursion base case, and — deterministic for 64-bit — certifies every leaf prime. Verify by re-multiplying to `n`.
- **Crypto context**: 64-bit factors in `≈ n^{1/4} ≈ 65000` steps (microseconds); RSA-2048's `√p ≈ 2^{512}` is hopeless for rho. rho/p−1/ECM define the *floor* of key strength (hence safe primes); GNFS is the real large-`n` tool.
- **Performance** lives in the multiply: Montgomery + batched binary-gcd + Brent + small-prime strip. Parallelize across `c`-attempts and across inputs, never within one sequential walk.
- Always verify: product equals `n` and every factor is prime — a self-certifying invariant that catches nearly every bug.

### Decision summary

- **64-bit composite** → rho (Montgomery) + Miller-Rabin recursion; microseconds.
- **`gcd == 1` or `== n`** → restart with fresh random `c`/seed; recover collapses.
- **`n = p^k`** → perfect-power check, factor the base, scale multiplicities.
- **Small factors / even `n`** → strip by trial division first.
- **`n` beyond ~`10^{20}`** → escalate to ECM; crypto-size → GNFS (rho is hopeless).
- **Always** → verify by re-multiplying and re-testing primality.

References to study further: Montgomery multiplication (Montgomery 1985), Brent's improved rho (1980), Pollard's p−1 and original rho (1974/1975), the Elliptic Curve Method (Lenstra 1987), BPSW primality, and sibling topics `01-gcd-euclidean` and `08-miller-rabin`.
