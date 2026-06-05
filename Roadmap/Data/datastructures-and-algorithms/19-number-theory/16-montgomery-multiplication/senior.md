# Montgomery Multiplication (and Barrett Reduction) — Senior Level

> A fast `mulmod` is rarely interesting on its own — but it sits in the innermost loop of modular exponentiation, primality testing, factorization, and NTT, where it runs billions of times. At that scale every detail (64-bit vs `__int128`, Montgomery vs Barrett vs plain, branchless conditional subtraction, the odd-modulus restriction, redundant representations, NTT butterfly layout) is a measurable performance or correctness incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Production Implementations: 64-bit and __int128](#2-production-implementations-64-bit-and-int128)
3. [When to Use Montgomery vs Barrett vs Plain](#3-when-to-use-montgomery-vs-barrett-vs-plain)
4. [Hot Loops: Modpow, Miller-Rabin, Pollard-rho, NTT](#4-hot-loops-modpow-miller-rabin-pollard-rho-ntt)
5. [Constant-Time and Side-Channel Concerns](#5-constant-time-and-side-channel-concerns)
6. [The Odd-Modulus Restriction and Workarounds](#6-the-odd-modulus-restriction-and-workarounds)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does REDC work" but "which reducer, at what width, under what constraints, in this exact hot loop, and how do I prove it correct at scale?". A modular multiply shows up in four production guises that share one engine:

1. **Modular exponentiation** — `a^b mod n` for cryptographic-sized `b`; the loop is `O(log b)` multiplies, each a `mulmod`.
2. **Primality testing** — Miller-Rabin (sibling `08`) squares and multiplies in a witness loop; deterministic for 64-bit `n` with a fixed witness set.
3. **Factorization** — Pollard-rho (sibling `09`) iterates `x = x² + c mod n` and computes gcds; the `mulmod` is the bottleneck.
4. **NTT / polynomial multiplication** — sibling `13`; each butterfly is a `mulmod`, and there are `O(n log n)` of them.

All four reduce to: *fix the modulus, build the reducer's constants once, run a huge number of `mulmod`s, read the result.* The senior decisions are: integer width (does the modulus fit in 63 bits so `R = 2^64` works cleanly?), Montgomery vs Barrett vs plain (odd modulus? conversion amortizable? constant-time needed?), how to keep the inner loop branch-free, and how to verify correctness when the loop runs too many times to trace.

This document treats those decisions in production terms.

---

## 2. Production Implementations: 64-bit and __int128

### 2.1 The width decision

| Modulus size | Strategy |
|--------------|----------|
| `n < 2^31` | 32-bit Montgomery with `R = 2^32`; products fit in `uint64`. |
| `n < 2^63` | 64-bit Montgomery with `R = 2^64`; products are 128-bit (`__int128` / `bits.Mul64` / `multiplyHigh`). |
| `n < 2^64` | Same as above, but be careful with the conditional subtract's carry (the result can exceed `n` with a carry out of the high word). |
| `n ≥ 2^64` | Multi-word (limb) Montgomery (CIOS / FIOS); the domain of big-integer and crypto libraries. |

For competitive programming and most backend work, the `n < 2^63`, `R = 2^64` case is the workhorse: "mod R" and "÷ R" are exactly the low and high halves of a 128-bit product.

### 2.2 The 128-bit product is the crux

`mulmod` needs the full 128-bit product of two 64-bit values. The three language idioms:

- **Go:** `hi, lo := bits.Mul64(a, b)`.
- **Java:** `long hi = Math.multiplyHigh(a, b); long lo = a * b;` (Java 9+; before that, simulate via 32-bit splits).
- **C/C++/Rust:** `__uint128_t prod = (__uint128_t)a * b;` then `hi = prod >> 64; lo = (uint64_t)prod;`.
- **Python:** native big ints — no overflow management, but no hardware speed either; Python Montgomery is for clarity, not raw speed.

### 2.3 REDC for a full 128-bit input

The 64-bit REDC takes the 128-bit product `(hi, lo)` and returns the reduced 64-bit Montgomery value:

```
REDC(hi, lo):
    m   = lo * nInv             # low 64 bits of (T mod R)*n'
    (mnHi, mnLo) = 128-bit m*n
    (sumLo, carry) = lo + mnLo  # sumLo is provably 0; we only need the carry
    (res, carry2)  = hi + mnHi + carry
    if carry2 != 0 or res >= n: res -= n   # conditional subtract
    return res
```

The `sumLo == 0` fact (the low limb cancels) is the runtime echo of "the division by `R` is exact". The carry out of the low addition propagates into the high word.

### 2.4 Computing the constants

- `nInv = -n^{-1} mod 2^64` via five Newton iterations from `inv = n` (correct mod 8). Pure multiply/subtract; no gcd.
- `r2 = 2^128 mod n` either by repeated doubling (128 shift-subtracts) or `((__uint128_t)(-n % n) ...)` tricks. Computed once per modulus.

---

## 3. When to Use Montgomery vs Barrett vs Plain

### 3.1 Decision matrix

| Constraint / workload | Plain `%` | Montgomery | Barrett |
|-----------------------|-----------|------------|---------|
| Single / few multiplies | ✅ simplest | ❌ conversion overhead | ⚠️ ok, no conversion |
| Long chain, fixed **odd** `n` | ⚠️ slow div | ✅ best | ✅ good |
| Long chain, **even** or arbitrary `n` | ⚠️ slow div | ❌ not applicable | ✅ best |
| Modulus changes every call | ⚠️ slow div | ❌ rebuild constants each time | ⚠️ rebuild `mu` each time |
| Constant-time required (crypto) | ❌ div latency data-dependent | ✅ branchless subtract | ✅ branchless correction |
| Compile-time-known constant modulus | ✅ compiler strength-reduces `%`! | ⚠️ maybe overkill | ⚠️ maybe overkill |

### 3.2 The compiler-strength-reduction caveat

If the modulus is a **compile-time constant**, modern compilers already replace `% n` with a multiply-and-shift (essentially Barrett baked in by the optimizer). In that case plain `%` with a literal modulus can be as fast as hand-rolled Barrett, and Montgomery's advantage shrinks to the conversion-free chains. The hand-rolled reducers matter most when the modulus is a *runtime* value (so the compiler cannot strength-reduce) and reused across many operations.

### 3.3 The amortization budget

Montgomery's two conversions (in/out) cost ≈ 2 REDCs. Each saved division is worth ≈ 15–80 cycles minus the ≈ 6–10 cycle REDC. So Montgomery pays for itself after roughly **2–4 multiplies** under a fixed odd modulus. Anything resembling a `modpow` (tens to hundreds of multiplies) or an inner loop (thousands+) is firmly in Montgomery's favor. A single isolated `mulmod` is not.

### 3.4 Montgomery vs Barrett, head to head

- **Montgomery** has the cheaper per-multiply (one REDC) but forces a special form and an odd modulus.
- **Barrett** is conversion-free and modulus-agnostic but costs two multiplies and up to two corrections per reduce.
- For NTT, both are used; Montgomery is common when the prime is fixed and the whole transform stays in Montgomery form. Barrett shines when you reduce a stream of independent products and don't want form-tracking.

### 3.5 A concrete selection checklist

When a `mulmod`-heavy workload lands on your desk, run this checklist before writing any reducer:

1. **Is the modulus odd?** No → Barrett (or plain). Yes → Montgomery is a candidate.
2. **Is the modulus a compile-time constant?** Yes → benchmark plain `%`; the compiler likely strength-reduced it already, so hand-rolling buys little.
3. **How many multiplies per modulus?** `< ~4` → plain `%`. `≥ ~4` (modpow, inner loop) → Montgomery amortizes.
4. **Does the value flow through non-modular code?** Yes/often → Barrett avoids constant form-tracking. No → Montgomery keeps everything in form.
5. **Is it security-sensitive?** Yes → Montgomery with a branchless subtract (or Barrett with branchless correction); never a data-dependent `%` on secret operands.
6. **Is `n ≥ 2^64`?** Yes → multi-limb CIOS Montgomery in a big-integer layer; the single-word recipes do not apply.

Most competitive-programming and backend number theory lands on "odd, runtime modulus, many multiplies" → Montgomery, which is why it is the default in that space.

---

## 4. Hot Loops: Modpow, Miller-Rabin, Pollard-rho, NTT

### 4.1 Modular exponentiation

The canonical use. Convert base in, run `O(log b)` Montgomery squarings/multiplies, convert out. See sibling `02-modular-arithmetic`. The accumulator starts at `to_mont(1) = R mod n`.

### 4.2 Deterministic Miller-Rabin for 64-bit n

For `n < 2^64`, a fixed set of witnesses (e.g. `{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37}`) makes Miller-Rabin **deterministic**. The inner loop is `mulmod`-bound, and since the candidate `n` is odd, Montgomery applies directly — this is the highest-value real-world Montgomery use in competitive programming. Build the Montgomery context once per candidate; the witness loop reuses it.

### 4.3 Pollard-rho

Pollard-rho (sibling `09`) iterates `x ← x² + c (mod n)` thousands of times and batches gcds. The `x² mod n` is the hot `mulmod`. Montgomery keeps `x` in Montgomery form across the whole walk; the `+c` is added in Montgomery form too (`c̄`). Brent's improvement batches products before a single gcd, multiplying the per-step `mulmod` weight even higher — exactly where Montgomery's saved divisions add up.

### 4.4 NTT butterflies

NTT (sibling `13`) does `O(n log n)` butterflies, each a `mulmod` by a twiddle factor. Two production patterns:

1. **Whole-transform Montgomery:** convert all coefficients in once, run the transform with Montgomery multiplies, convert out once. The conversions are `O(n)`, negligible against `O(n log n)` butterflies.
2. **Barrett butterflies:** reduce each product with Barrett; no form-tracking, handy when coefficients flow in and out of other (non-Montgomery) computations.

A subtle NTT trick: keep values in a **redundant representation** in `[0, 2n)` or `[0, 4n)` and defer the conditional subtraction, doing a single normalization at the end. This removes a branch from the innermost butterfly (Section 5).

---

## 5. Constant-Time and Side-Channel Concerns

Cryptographic code must not let secret data influence timing. Two issues:

### 5.1 Division latency is data-dependent

Hardware integer division latency can depend on the operands, leaking information. Montgomery/Barrett replace division with fixed-latency multiplies and shifts — a side-channel improvement, not just a speed one. This is a major reason crypto libraries (OpenSSL, BoringSSL) use Montgomery for RSA/ECC.

### 5.2 The conditional subtraction is a branch

`if (t >= n) t -= n;` is a secret-dependent branch and can leak via timing/branch prediction. The fix is a **branchless masked subtract**:

```
t2   = t - n                       # may underflow (wrap)
mask = -(t2 >> 63)                 # all-ones if t2 < 0 (borrow), else 0  (signed-aware)
t    = t2 + (mask & n)             # add n back iff we underflowed
```

or equivalently compute `mask = (t < n) ? ~0 : 0` without a branch and select. Constant-time Montgomery uses this everywhere.

Worked: `n = 13`, `t = 19` (needs subtraction) and `t = 7` (does not), using 64-bit unsigned wraparound for the mask:

```
t = 19: t2 = 19 - 13 = 6 (no borrow). mask = 0. result = 6 + (0 & 13) = 6.   ✓ (19 - 13 = 6)
t = 7:  t2 = 7 - 13 = -6 → wraps to 2^64 - 6 (borrow). mask = all-ones.
        result = (2^64 - 6) + (all-ones & 13) = (2^64 - 6) + 13 = 2^64 + 7 → 7 (mod 2^64).  ✓
```

Both branches execute the identical instruction sequence (subtract, derive mask, masked add) in identical time — no data-dependent branch, so an attacker timing the operation learns nothing about whether `t ≥ n`.

### 5.3 Redundant representations remove the subtract entirely

If you allow the Montgomery representative to live in `[0, 2n)` instead of `[0, n)` (a *redundant* or *incomplete* representation), you can skip the conditional subtraction in the inner loop entirely, provided you bound the inputs so REDC's output stays below `2n` (needs `4n < R`). Normalize once at the end. This is standard in high-performance NTT and ECC code: it removes the only branch from the hot loop.

The bound argument: if inputs are in `[0, 2n)` then `T = ā·b̄ < 4n²`. With `4n ≤ R`, `T < 4n² ≤ n·R`, so REDC is still in range, and the pre-subtraction output is `< (T + R·n)/R < (n·R + R·n)/R = 2n`. Dropping the subtraction leaves the output in `[0, 2n)`, the same envelope as the inputs — the invariant is preserved across arbitrarily many multiplies. A single conditional subtraction at the very end normalizes to `[0, n)`. Harvey's "improved NTT" (2014) is the canonical reference for this technique in transform inner loops.

---

## 6. The Odd-Modulus Restriction and Workarounds

Montgomery requires `gcd(R, n) = 1`, and with `R = 2^k` that means `n` **odd**. Workarounds when `n` is even:

### 6.1 Use Barrett

The cleanest answer: Barrett has no parity restriction. For even moduli, Barrett (or plain `%`) is the tool.

### 6.2 Split via CRT

If `n = 2^e · m` with `m` odd, do arithmetic modulo `m` with Montgomery and modulo `2^e` separately (mod a power of two is trivial — just mask), then recombine with the Chinese Remainder Theorem (sibling `05-crt`). This is overkill for a single multiply but worthwhile if `n` is fixed and you do enormous numbers of operations.

### 6.3 Why the restriction is fundamental, not incidental

`n'` is `-n^{-1} mod R`. For an even `n`, `n` and `R = 2^k` share the factor 2, so `n^{-1} mod R` does not exist — there is no `n'` that makes REDC's low bits cancel. This is not a bug to patch; it is the algebra. Senior engineers state it as a precondition, assert it, and route even moduli to Barrett.

### 6.4 The CRT-split workflow in detail

When `n = 2^e · m` (`m` odd) is fixed and you need Montgomery-grade speed on enormous operation counts:

1. Precompute the Montgomery context for the odd part `m` once.
2. For each operation, reduce operands mod `m` (Montgomery) and mod `2^e` (a mask — trivial).
3. Multiply in each channel: Montgomery `mulmod` mod `m`; plain masked multiply mod `2^e`.
4. Recombine the two residues with CRT (sibling `05-crt`): since `gcd(2^e, m) = 1`, there is a unique result mod `n`.

This doubles the bookkeeping and is rarely worth it for a single multiply, but for a fixed even modulus with billions of operations it recovers the division-free hot path on the dominant odd factor. In practice, unless `e` is tiny and `m` huge, Barrett on the whole `n` is simpler and fast enough — reserve CRT-split for cases where profiling proves the odd-part Montgomery path is the bottleneck-breaker.

---

## 7. Code Examples

### 7.1 Go — branchless conditional subtract (constant-time friendly) and Montgomery context

```go
package main

import (
	"fmt"
	"math/bits"
)

type Mont struct{ n, nInv, r2 uint64 }

func newMont(n uint64) Mont {
	if n&1 == 0 {
		panic("Montgomery requires an odd modulus")
	}
	inv := n
	for i := 0; i < 5; i++ {
		inv *= 2 - n*inv
	}
	r := (-n) % n // 2^64 mod n
	r2 := r
	for i := 0; i < 64; i++ {
		r2 = (r2 << 1) % n
	}
	return Mont{n, -inv, r2}
}

// branchless conditional subtract: returns x if x < n else x-n
func csub(x, n uint64) uint64 {
	d := x - n
	mask := uint64(0)
	if x < n { // compilers lower this to a cmov; for true CT use bit tricks
		mask = ^uint64(0)
	}
	return (x & mask) | (d &^ mask)
}

func (m Mont) redc(hi, lo uint64) uint64 {
	mm := lo * m.nInv
	mnHi, mnLo := bits.Mul64(mm, m.n)
	_, c := bits.Add64(lo, mnLo, 0)
	res, c2 := bits.Add64(hi, mnHi, c)
	if c2 == 1 {
		res -= m.n
	}
	return csub(res, m.n)
}

func (m Mont) mul(a, b uint64) uint64 { hi, lo := bits.Mul64(a, b); return m.redc(hi, lo) }
func (m Mont) in(x uint64) uint64     { return m.mul(x, m.r2) }
func (m Mont) out(x uint64) uint64    { return m.redc(0, x) }

func (m Mont) pow(base, exp uint64) uint64 {
	res, b := m.in(1), m.in(base)
	for exp > 0 {
		if exp&1 == 1 {
			res = m.mul(res, b)
		}
		b = m.mul(b, b)
		exp >>= 1
	}
	return m.out(res)
}

// Deterministic Miller-Rabin for n < 2^64 using Montgomery.
func isPrime(n uint64) bool {
	if n < 2 {
		return false
	}
	for _, p := range []uint64{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37} {
		if n%p == 0 {
			return n == p
		}
	}
	m := newMont(n)
	d := n - 1
	s := 0
	for d&1 == 0 {
		d >>= 1
		s++
	}
	one, minus1 := m.in(1), m.in(n-1)
	for _, a := range []uint64{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37} {
		x := m.mul(m.in(a%n), m.in(1)) // a in Montgomery form
		x = powMont(m, a%n, d)
		if x == one || x == minus1 {
			continue
		}
		composite := true
		for i := 0; i < s-1; i++ {
			x = m.mul(x, x)
			if x == minus1 {
				composite = false
				break
			}
		}
		if composite {
			return false
		}
	}
	return true
}

func powMont(m Mont, base, exp uint64) uint64 { // returns Montgomery-form result
	res, b := m.in(1), m.in(base)
	for exp > 0 {
		if exp&1 == 1 {
			res = m.mul(res, b)
		}
		b = m.mul(b, b)
		exp >>= 1
	}
	return res
}

func main() {
	fmt.Println(isPrime(1_000_000_007)) // true
	fmt.Println(isPrime(1_000_000_009)) // true
	fmt.Println(isPrime(1_000_000_011)) // false
}
```

### 7.2 Java — Barrett reduction for arbitrary modulus (handles even n)

```java
import java.math.BigInteger;

public class BarrettReducer {
    final long n;
    final long mu;     // floor(2^k / n) as fits; here use BigInteger for k up to 127
    final int k;
    final BigInteger N, MU;

    BarrettReducer(long n) {
        this.n = n;
        this.k = 2 * (64 - Long.numberOfLeadingZeros(n)) + 1;
        this.N = BigInteger.valueOf(n);
        this.MU = BigInteger.ONE.shiftLeft(k).divide(N); // floor(2^k / n), once
        this.mu = 0; // (illustrative; real 64-bit Barrett uses 128-bit math)
    }

    long reduce(long x) {            // 0 <= x < n^2
        BigInteger X = BigInteger.valueOf(x);
        BigInteger q = X.multiply(MU).shiftRight(k);
        BigInteger r = X.subtract(q.multiply(N));
        while (r.compareTo(N) >= 0) r = r.subtract(N);  // <= 2 corrections
        return r.longValue();
    }

    long mul(long a, long b) {
        // For 64-bit a,b use BigInteger to form the product cleanly here.
        return BigInteger.valueOf(a).multiply(BigInteger.valueOf(b))
                .mod(BigInteger.valueOf(n)).longValue(); // reference; reduce() above for hot path
    }

    public static void main(String[] args) {
        BarrettReducer br = new BarrettReducer(1_000_000_006L); // EVEN modulus: Barrett ok
        System.out.println(br.reduce(999_999_999_999L));
    }
}
```

### 7.3 Python — Montgomery vs Barrett correctness cross-check

```python
class Mont:
    def __init__(self, n, k=64):
        assert n % 2 == 1
        self.n, self.k = n, k
        self.R, self.mask = 1 << k, (1 << k) - 1
        self.np = (-pow(n, -1, self.R)) % self.R
        self.r2 = (self.R * self.R) % n

    def redc(self, t):
        m = ((t & self.mask) * self.np) & self.mask
        u = (t + m * self.n) >> self.k
        return u - self.n if u >= self.n else u

    def mul(self, a, b): return self.redc(a * b)
    def into(self, x):   return self.mul(x, self.r2)
    def outof(self, x):  return self.redc(x)


class Barrett:
    def __init__(self, n):
        self.n = n
        self.k = 2 * n.bit_length() + 1
        self.mu = (1 << self.k) // n

    def reduce(self, x):
        q = (x * self.mu) >> self.k
        r = x - q * self.n
        while r >= self.n:
            r -= self.n
        return r

    def mul(self, a, b): return self.reduce(a * b)


if __name__ == "__main__":
    import random
    n = 1_000_000_007            # odd prime
    mt, bt = Mont(n), Barrett(n)
    for _ in range(100_000):
        a, b = random.randrange(n), random.randrange(n)
        ref = (a * b) % n
        mres = mt.outof(mt.mul(mt.into(a), mt.into(b)))
        bres = bt.mul(a, b)
        assert mres == ref == bres
    print("Montgomery and Barrett both match plain % on 100k random inputs")
```

---

## 8. Observability and Testing

A wrong `mulmod` is catastrophic and silent — every downstream computation is corrupt. Build checks in from day one.

| Check | Why |
|-------|-----|
| Cross-check vs plain `(a*b) % n` on random inputs | Catches `n'` sign errors, missing subtraction, conversion mix-ups. |
| `out(in(x)) == x` round-trip | Confirms conversion correctness. |
| `n·n' ≡ -1 (mod R)` assertion | Validates the magic constant once per modulus. |
| `into(1)` is the multiplicative identity (`mul(into(1), x) == x`) | Confirms the Montgomery identity. |
| Odd-modulus assertion at construction | Fails loudly instead of returning garbage. |
| Known-answer tests (KATs) for modpow | `pow(2, n-1, n) == 1` for prime `n` (Fermat). |
| Cross-language determinism | Go/Java/Python agree on the same inputs. |
| Barrett: `x < n²` precondition assert | Barrett's bound assumes reduced inputs. |

The single most valuable test is the **random cross-check against plain `%`**: a few hundred thousand random `(a, b, n)` triples comparing Montgomery, Barrett, and `(a*b) % n` entrywise. It catches essentially every implementation bug.

### 8.1 Property-test battery

```text
for random odd n, random a, b in [0, n):
    assert out(in(x)) == x                          # round-trip
    assert mul(in(a), in(b)) == in((a*b) % n)       # multiply homomorphism
    assert pow(a, n-1) == 1   when n is prime        # Fermat KAT
    assert n * n_prime % R == R - 1                  # n·n' ≡ -1 (mod R)
for Barrett with any n, x in [0, n^2):
    assert barrett_reduce(x) == x % n
```

### 8.2 Production guardrails

For a library exposing a fast `mulmod`: assert oddness for the Montgomery path; expose a debug build that cross-checks every result against `%` (off in release); log the modulus and reducer choice; and fuzz with adversarial inputs (`n = 1`, `n = 3`, `n` near `2^63`, `a = b = n-1`).

### 8.3 The boundary inputs that catch real bugs

A short list of inputs that, in practice, expose the most common implementation errors:

- `a = b = n - 1`: maximizes the product, surfaces carry-out and conditional-subtraction bugs.
- `n` just below `2^63` and `2^64`: tests the high-word carry in the 128-bit REDC.
- `exp = 0` in modpow: must return `1` (i.e. `from_mont(to_mont(1))`).
- even `n`: must be rejected (assertion) or routed to Barrett.
- `n = 3, 5, 7` (tiny primes): tiny `R`/`n'` interplay; easy to verify by hand.

Feed these alongside random fuzzing; the deterministic boundaries catch the carry/identity bugs that random inputs hit only rarely.

---

## 9. Failure Modes

### 9.1 Even modulus into Montgomery
`n^{-1} mod R` does not exist; `n'` and REDC are garbage. Mitigation: assert oddness; route even `n` to Barrett or CRT-split.

### 9.2 Missing / wrong conditional subtraction
Result lands in `[n, 2n)` (or higher with a carry) and silently corrupts every later multiply. Mitigation: always subtract; in the 128-bit case handle the carry-out; test the boundary `a = b = n-1`.

### 9.3 Form confusion
Passing a normal integer where a Montgomery value is expected (or forgetting `into(1)` for the identity). Mitigation: type-wrap Montgomery values or annotate rigorously; round-trip tests.

### 9.4 Overflow in the product
Using a 64-bit product where 128 bits are needed. Mitigation: `bits.Mul64` / `multiplyHigh` / `__int128`; never `a*b` in 64-bit for `mulmod`.

### 9.5 Wrong `n'` sign or precision
`n^{-1}` instead of `-n^{-1}`, or too few Newton iterations (inverse not yet full-width). Mitigation: five iterations for 2^64; assert `n·n' ≡ -1 (mod R)`.

### 9.6 Barrett with insufficient `k` or unreduced input
If `k` is too small or `x ≥ n²`, the quotient estimate is off by more than 2 and the correction loop misbehaves. Mitigation: `k = 2·bitlen(n) (+1)`; keep inputs `< n²`.

### 9.7 Timing leak via the branch (crypto)
The data-dependent conditional subtraction leaks. Mitigation: branchless masked subtract or redundant `[0, 2n)` representation.

### 9.8 Rebuilding constants per call
Recomputing `n'`/`r2` (or Barrett `mu`) on every `mulmod` instead of once per modulus. Symptom: the "fast" path is slower than plain `%`. Mitigation: build the context once, reuse it.

### 9.9 The compiler already optimized `%`
For a compile-time-constant modulus, the compiler strength-reduces `%` to a multiply-shift, so hand-rolled Barrett buys nothing and Montgomery's edge is only on long chains. Mitigation: benchmark; reach for hand-rolled reducers only when the modulus is a runtime value reused many times.

---

## 10. Summary

- A fast `mulmod` is a **constant-factor** optimization living in the innermost loops of modpow, Miller-Rabin (sibling `08`), Pollard-rho (sibling `09`), and NTT (sibling `13`); at billions of iterations the constant is everything.
- For `n < 2^63`, the workhorse is **64-bit Montgomery with `R = 2^64`**: "mod R" and "÷ R" are the low and high halves of a 128-bit product (`bits.Mul64` / `multiplyHigh` / `__int128`).
- **Montgomery** wins for long chains under a fixed **odd** modulus; **Barrett** is conversion-free and modulus-agnostic (handles even `n`); **plain `%`** is best for one-off multiplies and for compile-time-constant moduli (where the compiler strength-reduces it). Montgomery pays for its conversions after ~2–4 multiplies.
- Constant-time crypto needs a **branchless conditional subtraction** (or a redundant `[0, 2n)` representation that defers it), because both division latency and a secret-dependent branch leak timing.
- The **odd-modulus restriction** is fundamental: `n` even ⇒ `gcd(2^k, n) ≠ 1` ⇒ no `n'`. Route even moduli to Barrett or split via CRT (sibling `05`).
- Verify with a **random cross-check against plain `%`**, `out(in(x)) == x`, `n·n' ≡ -1 (mod R)`, and Fermat KATs; assert oddness; never rebuild constants per call.

### Decision summary

- **Long chain, odd `n`, runtime modulus** → Montgomery (branchless subtract if crypto).
- **Even / arbitrary `n`, no conversion wanted** → Barrett.
- **One-off multiply, or constant modulus** → plain `%` (compiler handles it).
- **Modulus changes every call** → reconsider; the setup may not amortize — plain `%` or Barrett with cheap `mu`.
- **NTT / massive butterflies** → Montgomery whole-transform (or Barrett), redundant representation to drop the inner-loop branch.
- **`n ≥ 2^64`** → multi-limb Montgomery (CIOS) in a big-integer library.

References to study further: Montgomery (1985) original paper; Barrett (1986); the CIOS/FIOS multi-precision Montgomery variants (Koç, Acar, Kaliski 1996); constant-time techniques in BearSSL / BoringSSL; redundant-representation NTT (Harvey 2014); and sibling topics `02-modular-arithmetic`, `06-extended-euclidean-modular-inverse`, `08-miller-rabin-primality`, `09-pollard-rho`, `13-ntt`, and `05-crt`.
