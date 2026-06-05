# Chinese Remainder Theorem (CRT) — Senior Level

> CRT is rarely the headline algorithm — but the moment the combined modulus `M` overflows a machine word, the residues come from an NTT or a distributed computation, or the moduli are attacker- or data-controlled, every detail (overflow in the merge, `mulmod` correctness, prime selection, inconsistency handling, the RSA-CRT timing channel) becomes a correctness, performance, or *security* incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Overflow in the Construction (mulmod)](#2-overflow-in-the-construction-mulmod)
3. [Multi-Prime Reconstruction for NTT and Bignum](#3-multi-prime-reconstruction-for-ntt-and-bignum)
4. [RSA-CRT: The 4x Decryption Speedup](#4-rsa-crt-the-4x-decryption-speedup)
5. [Inconsistent and Non-Coprime Systems in Production](#5-inconsistent-and-non-coprime-systems-in-production)
6. [Prime and Modulus Selection](#6-prime-and-modulus-selection)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Concurrency and Parallelism](#9-concurrency-and-parallelism)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is not "what is CRT" but "what am I actually building with it, and what breaks at scale?" CRT shows up in three production guises that share one engine — *map a residue tuple back to a single number*:

1. **Overflow avoidance / bignum** — compute or multiply numbers too large for a single modulus by splitting across several small primes and reconstructing. The arithmetic during reconstruction can itself overflow, so the reconstruction code must be as careful as the computation it serves.
2. **NTT multi-mod** — convolve polynomials whose coefficients exceed any single NTT-friendly prime; run under 3–4 primes and CRT the coefficient vectors.
3. **RSA-CRT** — decrypt/sign by working mod `p` and mod `q` separately instead of mod `n = p·q`, a ~4x speedup that also opens a notorious fault-injection attack if done carelessly.

A fourth, increasingly common guise is **exact modular linear algebra**: computing an integer determinant, a matrix solution over ℚ, or a polynomial GCD by working modulo several primes and reconstructing, which keeps every intermediate coefficient word-sized instead of letting it blow up during elimination.

The senior decisions are: keep every intermediate inside the word (or use `mulmod` / 128-bit / big integers deliberately), pick primes whose product safely bounds the true result, handle inconsistency as a first-class outcome (not a panic), and — for RSA-CRT — defend against fault and timing attacks.

**When NOT to reach for multi-mod CRT.** If a single 64-bit prime (or `__int128` arithmetic) already bounds every intermediate, the multi-mod machinery is pure overhead — more code, more chances to misplace an inverse, and the reconstruction cost on top. Multi-mod earns its keep only when *no* single in-word modulus suffices: the convolution coefficients genuinely exceed `2⁶³`, or you need the exact arbitrary-precision result. The senior instinct is to first ask "does one prime / one `__int128` suffice?" and only escalate to CRT reconstruction when the answer is provably no. Premature multi-mod is a real anti-pattern in performance-sensitive code.

---

## 2. Overflow in the Construction (mulmod)

The merge computes `x = a₁ + m₁·t (mod L)`. The product `m₁·t` can reach almost `m₁·m₂ = L`, and `L` is by design the *combined* modulus — frequently near or beyond `2⁶³`. A plain `int64` multiply overflows silently and corrupts the answer.

**Three escalating defenses:**

1. **`mulmod` via 128-bit intermediate.** In Go use `math/bits.Mul64` + `Div64`; in Java use `Math.multiplyHigh` or `BigInteger`; in C++ use `__int128`. This computes `(a·b) mod m` correctly for `a, b, m < 2⁶³`.
2. **`mulmod` via `__int128`-free fallback** (binary "Russian peasant" multiply mod): `O(log b)` additions, each safe. Slower but portable to environments without 128-bit support.
3. **Big integers** for the reconstruction stage when `L` itself exceeds 64 bits (multi-mod with product `> 2⁶⁴`). Garner with big-integer assembly, or full big-int CRT.

**Where overflow specifically bites in CRT:**

- `m₁ * t` in the merge back-substitution (use `mulmod` with modulus `L`).
- `lcm = m₁ * m₂` — always compute `m₁ / g * m₂`, dividing first.
- The symmetric formula's `aᵢ · Mᵢ · yᵢ` — `Mᵢ` is already huge; this term is the worst offender, which is one more reason to prefer the fold or Garner.
- `(a₂ − a₁)` can be negative; reduce into `[0, m₂)` before any multiply.

Rule: **assume every product in CRT can overflow** and route it through `mulmod` or big integers unless you have proven the operands are small.

---

## 3. Multi-Prime Reconstruction for NTT and Bignum

The canonical senior application. To multiply two large integers (or convolve two coefficient vectors) whose result coefficients can reach `~ n · B²` (where `B` is the base and `n` the length), a single NTT prime near `2⁶⁰` would overflow during the butterfly. The fix:

1. Choose **NTT-friendly primes** `p₁, p₂, p₃` (each of the form `c·2ᵏ + 1` with a high power of two, e.g. `998244353 = 119·2²³ + 1`, `985661441`, `943718401`).
2. Run the forward NTT, pointwise multiply, and inverse NTT **independently mod each prime**. Each stays under `pⱼ²  < 2⁶⁰`, safe in 64 bits with a single `mulmod`.
3. For each output coefficient you now have a residue tuple `(r₁, r₂, r₃)`. **CRT-reconstruct** it to recover the true coefficient mod `p₁p₂p₃ ≈ 8.7 · 10²⁶`, which exceeds the max coefficient, so the reconstruction is exact.

For three primes the reconstruction is usually done by **Garner** (see `15-garner`): compute mixed-radix digits, which stay small, then assemble. If the final answer is wanted mod some target `M` (e.g., `10⁹+7`), reduce the assembled value mod `M` at the end — never lose precision mid-reconstruction.

**Distributed / fault-tolerant reconstruction.** The same machinery recovers a big integer `X` from residues computed on separate machines mod different primes (e.g., computing a determinant of a big-integer matrix prime-by-prime to avoid intermediate blow-up). If `X < ∏ pᵢ`, CRT recovers it exactly. Adding **redundant** primes turns CRT into an error-detecting/correcting code (the basis of Redundant Residue Number Systems): a single corrupted residue makes the reconstruction inconsistent with the redundant modulus, flagging the fault.

**Bounding the result before you know it.** A practical subtlety: CRT-reconstruction is only exact when the true `X` is below the product `∏ pⱼ`. For a determinant or a polynomial-GCD coefficient you may not know `X` in advance, so you use an a-priori bound (Hadamard's inequality for determinants; coefficient bounds for polynomials) to pick enough primes. If the bound is uncertain, an **early-termination** strategy adds primes incrementally and stops when two successive reconstructions agree (a one-prime redundancy check) — at the cost of a small probability of a false stop, mitigated by one extra confirming prime.

---

## 4. RSA-CRT: The 4x Decryption Speedup

RSA decryption computes `m = cᵈ mod n` where `n = p·q` and `d` is large. Modular exponentiation is `O(log d · M(log n))` where `M` is multiply cost — and multiply cost is **quadratic** in operand size. Working mod `n` (size `2k` bits) instead of mod `p` and `q` (size `k` bits each) is therefore expensive.

**RSA-CRT** precomputes `dp = d mod (p−1)`, `dq = d mod (q−1)`, and `qinv = q⁻¹ mod p`, then:

```
m₁ = c^dp mod p          # exponent and modulus both half-size
m₂ = c^dq mod q
h  = ( qinv · (m₁ − m₂) ) mod p     # Garner-style single combine
m  = m₂ + h · q          # the CRT reconstruction of (m₁ mod p, m₂ mod q)
```

Each exponentiation is on `k`-bit numbers, so ~`(1/2)³ · 2 = 1/4` the work of one `2k`-bit exponentiation — the classic **~4x speedup**. The final combine is a single CRT merge specialized for two coprime primes (this `m₂ + h·q` form *is* Garner's mixed-radix for two moduli).

**Security caveat — the Bellcore / fault attack.** If a transient fault corrupts exactly one of `m₁` or `m₂` (e.g., a glitch during `c^dq mod q`), the faulty signature `m'` satisfies `gcd(m' − m, n) = p` (or `q`), instantly **factoring `n`**. Defenses: verify the result (`re-encrypt: m^e mod n == c`?) before releasing it, or compute redundantly and compare. Never ship RSA-CRT without an output verification step. Constant-time implementation is also required to avoid timing leaks of `p`, `q`.

**Worked RSA-CRT example (toy primes).** Let `p = 11`, `q = 13`, so `n = 143`, `φ(n) = 120`. Public `e = 7`; private `d = e⁻¹ mod 120 = 103`. Precompute `dp = 103 mod 10 = 3`, `dq = 103 mod 12 = 7`, `qinv = 13⁻¹ mod 11 = 2⁻¹ mod 11 = 6`. Decrypt ciphertext `c = 9`:

```
m1 = 9^3 mod 11 = 729 mod 11 = 3
m2 = 9^7 mod 13 = 4782969 mod 13 = 9
h  = qinv·(m1 − m2) mod p = 6·(3 − 9) mod 11 = 6·(−6) mod 11 = (−36) mod 11 = 8
m  = m2 + h·q = 9 + 8·13 = 113
```

Check directly: `9^103 mod 143 = 113` (and `113^7 mod 143 = 9`, the re-encryption verification). The two exponentiations used 3-bit and 7-bit exponents on single-digit moduli instead of a 103-as-binary exponent on a 3-digit modulus — the structural source of the speedup, scaled up to 1024-bit primes in production.

**Fault-injection demonstration.** Suppose the `m₂` computation glitches to `m₂' = 5` instead of `9`. Then `m' = 5 + qinv·(3−5) mod 11 · 13 = …` produces a wrong `m'`, and an attacker computing `gcd(m' − m, n)` (with a correct `m` from a non-faulty run, or via `gcd((m')^e − c, n)`) recovers a nontrivial factor of `143`. This is why the unconditional re-encryption check `m^e ≡ c (mod n)` must gate every released signature.

---

## 5. Inconsistent and Non-Coprime Systems in Production

When moduli come from data (sensor periods, scheduling constraints, parsed input), they are not guaranteed coprime, and the system may have **no solution**. Treat "no solution" as a normal return value, not an exception path that crashes a request handler.

- **Detect early:** in every merge, check `(a₂ − a₁) mod gcd(m₁, m₂) == 0`. On failure, short-circuit and return a typed "inconsistent" result.
- **Report which pair conflicted** for debuggability — store the index that broke consistency.
- **Order independence:** the consistency outcome does not depend on merge order, but accumulated rounding/overflow can, so keep arithmetic exact.
- **Duplicate / refining moduli:** `x ≡ 3 (mod 4)` then `x ≡ 7 (mod 8)` is consistent (`gcd 4`, `3 ≡ 7 mod 4`) and *refines* the answer to mod 8. `x ≡ 3 (mod 4)` then `x ≡ 6 (mod 8)` is inconsistent. Production code must distinguish refine vs conflict.
- **Adversarial input:** if moduli are attacker-controlled, bound `n` and the product to prevent resource exhaustion in big-integer reconstruction.

---

## 6. Prime and Modulus Selection

| Goal | Choose | Why |
|------|--------|-----|
| Avoid coefficient overflow in NTT product | `∏ pⱼ > max coefficient`, margin ≥ 1 bit | reconstruction is exact only if `X < ∏ pⱼ` |
| NTT-friendly | `pⱼ = c·2ᵏ + 1`, large `k` | guarantees a `2ᵏ`-th root of unity for the transform |
| Keep `mulmod` in 64 bits | each `pⱼ < 2³¹` (or `< 2⁶³` with 128-bit mulmod) | products stay representable |
| Error detection | add a redundant prime | inconsistency flags a corrupted residue |
| RSA | `p, q` strong primes, balanced size | half-size operands; resist factoring |

For "compute mod `M = 10⁹+7`" via three primes, any three distinct primes whose product exceeds the max intermediate work; reduce mod `M` only at the very end. Fewer primes = less reconstruction work, so use the minimum count whose product gives the needed bound.

**Sizing the prime count.** If a single convolution output coefficient can reach `B = n · (P−1)²` where `P` is your base prime and `n` the transform length, you need `∏ pⱼ > B`. With primes near `10⁹` (≈ 30 bits each), three give ≈ 90 bits of headroom (`> 10²⁷`), enough for `n` up to ≈ `10⁶` with 30-bit coefficients. Four primes buy another 30 bits for larger `n` or 60-bit coefficients. The decision is purely "how many bits does the true coefficient need" divided by "bits per prime", rounded up. Over-provisioning primes wastes both the per-prime NTT time and the reconstruction time, so size it precisely from the coefficient bound, not by guessing.

**Friendly-prime catalog.** Common 30–31-bit NTT primes with large power-of-two factors: `998244353 = 119·2²³ + 1` (root 3), `985661441 = 235·2²² + 1`, `943718401 = 225·2²² + 1`, `167772161 = 5·2²⁵ + 1`, `469762049 = 7·2²⁶ + 1`. Keep a vetted list with a known primitive root for each, since recomputing roots at runtime is error-prone.

**Beyond NTT — exact linear algebra.** The same prime selection logic drives **modular linear algebra**: to compute the exact integer determinant of a matrix whose entries are large, evaluate the determinant modulo several primes (each computation is a cheap Gaussian elimination mod a word-sized prime, with no coefficient growth) and CRT-reconstruct. The Hadamard bound `|det| ≤ ∏ ‖rowᵢ‖₂` tells you how many primes you need so the product exceeds `2|det|` (the factor 2 handles the sign via the symmetric residue representative `(−P/2, P/2]`). The same pattern computes exact polynomial GCDs and resultants. In all cases the per-prime computation is the expensive part and CRT is the cheap glue — the recurring senior shape.

---

## 7. Code Examples

### Example: Overflow-Safe Merge with mulmod, plus Garner Two-Modulus Combine

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

// mulmod computes (a*b) % m correctly for a,b,m < 2^63 using a 128-bit product.
func mulmod(a, b, m uint64) uint64 {
	hi, lo := bits.Mul64(a, b)
	_, rem := bits.Div64(hi%m, lo, m)
	return rem
}

func extgcd(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x1, y1 := extgcd(b, a%b)
	return g, y1, x1 - (a/b)*y1
}

// crtMergeSafe merges arbitrary congruences with overflow-safe multiply.
func crtMergeSafe(a1, m1, a2, m2 int64) (int64, int64, bool) {
	g, p, _ := extgcd(m1, m2)
	c := a2 - a1
	if c%g != 0 {
		return 0, 0, false
	}
	lcm := m1 / g * m2
	mod := m2 / g
	tBase := ((c/g%mod)*(p%mod))%mod
	t := ((tBase % mod) + mod) % mod
	// a1 + m1*t mod lcm, with mulmod to avoid overflow
	prod := int64(mulmod(uint64(m1%lcm), uint64(t), uint64(lcm)))
	x := ((a1+prod)%lcm + lcm) % lcm
	return x, lcm, true
}

func main() {
	x, l, ok := crtMergeSafe(2, 1_000_000_007, 3, 998_244_353)
	fmt.Println(x, l, ok)
}
```

#### Java

```java
import java.math.BigInteger;

public class CrtSafe {
    static long[] extgcd(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extgcd(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }

    // Overflow-safe via BigInteger for the single risky product.
    static long mulmod(long a, long b, long m) {
        return BigInteger.valueOf(a).multiply(BigInteger.valueOf(b))
                .mod(BigInteger.valueOf(m)).longValue();
    }

    static long[] crtMergeSafe(long a1, long m1, long a2, long m2) {
        long[] e = extgcd(m1, m2);
        long g = e[0], p = e[1];
        long c = a2 - a1;
        if (c % g != 0) return new long[]{0, 0, 0};
        long lcm = m1 / g * m2;
        long mod = m2 / g;
        long t = ((c / g % mod) * (p % mod)) % mod;
        t = ((t % mod) + mod) % mod;
        long prod = mulmod(((m1 % lcm) + lcm) % lcm, t, lcm);
        long x = ((a1 + prod) % lcm + lcm) % lcm;
        return new long[]{x, lcm, 1};
    }

    public static void main(String[] args) {
        long[] r = crtMergeSafe(2, 1_000_000_007L, 3, 998_244_353L);
        System.out.println(r[0] + " " + r[1] + " ok=" + r[2]);
    }
}
```

#### Python

```python
# Python has unbounded ints, so overflow is a non-issue; the same code is the
# REFERENCE implementation to validate the Go/Java overflow-safe versions.
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = extgcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def crt_merge_safe(a1, m1, a2, m2):
    g, p, _ = extgcd(m1, m2)
    c = a2 - a1
    if c % g != 0:
        return None
    lcm = m1 // g * m2
    mod = m2 // g
    t = (c // g) * p % mod
    x = (a1 + m1 * t) % lcm
    return x % lcm, lcm


def rsa_crt_decrypt(c, dp, dq, p, q, qinv):
    """RSA-CRT: m = c^d mod n via half-size exponentiations + Garner combine."""
    m1 = pow(c, dp, p)
    m2 = pow(c, dq, q)
    h = (qinv * (m1 - m2)) % p
    return m2 + h * q


if __name__ == "__main__":
    print(crt_merge_safe(2, 1_000_000_007, 3, 998_244_353))
```

**Run:** `go run main.go` | `javac CrtSafe.java && java CrtSafe` | `python crt_safe.py`

### Example: Three-Prime Coefficient Reconstruction (NTT post-process)

After running an NTT under three primes, each output coefficient is known mod `p₁, p₂, p₃`. This reconstructs the true coefficient (assumed `< p₁p₂p₃`) and reduces it mod a target. Reconstruction uses Garner two steps to keep intermediates small.

#### Go
```go
package main

import "fmt"

func powmod(a, e, m int64) int64 {
	r := int64(1) % m
	a %= m
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}
func inv(a, m int64) int64 { return powmod(((a%m)+m)%m, m-2, m) } // prime modulus

// reconstruct3 builds the true coefficient mod p1*p2*p3, then reduces mod target.
func reconstruct3(r1, r2, r3, p1, p2, p3, target int64) int64 {
	// Garner: x = r1 + p1*(c2 + p2*c3)
	c2 := ((r2-r1)%p2 + p2) % p2 * inv(p1%p2, p2) % p2
	v := r1 + p1*c2 // value mod p1*p2
	mod12 := p1 * p2
	c3 := ((r3-v)%p3 + p3) % p3 * inv(mod12%p3, p3) % p3
	// assemble mod target using mulmod-style reductions
	res := (r1%target + (p1%target)*(c2%target)) % target
	res = (res + (mod12%target)*(c3%target)) % target
	return ((res % target) + target) % target
}
func main() {
	// true coefficient 123456789 under primes 998244353, 985661441, 943718401
	p1, p2, p3 := int64(998244353), int64(985661441), int64(943718401)
	x := int64(123456789)
	fmt.Println(reconstruct3(x%p1, x%p2, x%p3, p1, p2, p3, 1_000_000_007)) // 123456789
}
```

#### Java
```java
public class Reconstruct3 {
    static long powmod(long a, long e, long m) {
        long r = 1 % m; a %= m;
        while (e > 0) { if ((e & 1) == 1) r = r * a % m; a = a * a % m; e >>= 1; }
        return r;
    }
    static long inv(long a, long m) { return powmod(((a % m) + m) % m, m - 2, m); }
    static long reconstruct3(long r1, long r2, long r3,
                             long p1, long p2, long p3, long target) {
        long c2 = ((r2 - r1) % p2 + p2) % p2 * inv(p1 % p2, p2) % p2;
        long v = r1 + p1 * c2;
        long mod12 = p1 * p2;
        long c3 = ((r3 - v) % p3 + p3) % p3 * inv(mod12 % p3, p3) % p3;
        long res = (r1 % target + (p1 % target) * (c2 % target)) % target;
        res = (res + (mod12 % target) * (c3 % target)) % target;
        return ((res % target) + target) % target;
    }
    public static void main(String[] a) {
        long p1 = 998244353L, p2 = 985661441L, p3 = 943718401L, x = 123456789L;
        System.out.println(reconstruct3(x % p1, x % p2, x % p3, p1, p2, p3, 1_000_000_007L));
    }
}
```

#### Python
```python
def reconstruct3(r1, r2, r3, p1, p2, p3, target):
    c2 = (r2 - r1) % p2 * pow(p1, -1, p2) % p2
    v = r1 + p1 * c2
    mod12 = p1 * p2
    c3 = (r3 - v) % p3 * pow(mod12, -1, p3) % p3
    x = r1 + p1 * c2 + mod12 * c3   # exact big int
    return x % target

if __name__ == "__main__":
    p1, p2, p3 = 998244353, 985661441, 943718401
    x = 123456789
    print(reconstruct3(x % p1, x % p2, x % p3, p1, p2, p3, 1_000_000_007))  # 123456789
```

**Run:** `go run r3.go` | `javac Reconstruct3.java && java Reconstruct3` | `python r3.py`

---

## 8. Observability and Testing

- **Cross-check against the big-integer reference** (Python's unbounded ints, or Java `BigInteger`): generate random coprime and non-coprime systems, solve with the fast path, and assert the result satisfies every congruence and lies in `[0, lcm)`.
- **Property tests:** the reconstructed `x` must satisfy `x % mᵢ == aᵢ % mᵢ` for all `i`; merge order must not change the result (for solvable systems); inconsistent systems must be reported, never "solved".
- **Fuzz the consistency boundary:** deliberately build refine vs conflict pairs to confirm correct classification.
- **mulmod tests:** verify `mulmod(a, b, m)` against big-integer truth across `a, b, m` near `2⁶³`.
- **RSA-CRT:** always include the re-encryption check (`pow(m, e, n) == c`) in tests *and* in production, to catch faults.
- **Metrics:** in services, count inconsistent-system rates and reconstruction sizes to catch malformed input.

### Property-Test Skeleton

A concrete property test (Python) that catches overflow, wrong-modulus, and missing-consistency bugs in one sweep:

```python
import random

def property_test(crt_fn, trials=10000):
    for _ in range(trials):
        n = random.randint(1, 5)
        mods = random.sample(range(2, 50), n)          # may share factors
        x_true = random.randint(0, 10**6)
        res = [x_true % m for m in mods]               # guaranteed consistent
        out = crt_fn(res, mods)
        assert out is not None, "consistent system reported unsolvable"
        x, lcm = out
        for a, m in zip(res, mods):
            assert x % m == a % m, "solution violates a congruence"
        assert 0 <= x < lcm, "solution out of [0, lcm)"
        # build a deliberately inconsistent system and expect rejection
        if n >= 2 and mods[0] % 2 == 0 and mods[1] % 2 == 0:
            bad = res[:]; bad[0] ^= 1                    # break parity agreement
            assert crt_fn(bad, mods) is None or bad[0] % 2 == res[0] % 2
```

The trick of deriving residues from a known `x_true` guarantees consistency, so any failure is a real bug; the inconsistent branch checks the rejection path. Run this against the fast implementation in CI; it is fast and high-signal.

### Worked Case Study: A Silent Overflow Incident

A service computed `(A·B) mod 10¹⁸` via three primes near `10⁹` and a coprime CRT fold. Unit tests passed (small inputs), but production produced sporadic wrong answers. Root cause: the fold's back-substitution `a + m·t` was done in plain `int64`, and once two primes had been merged the running modulus `m ≈ 10¹⁸` made `m·t` overflow. The fix had three parts:

1. Route the product through `mulmod` with modulus equal to the running `lcm`.
2. Add a **property test** asserting `result % pⱼ == rⱼ` for all `j` on random large inputs — this fails immediately under overflow, unlike the small unit tests.
3. Add a **shadow check** in production behind a flag: recompute with `BigInteger` for 0.1% of requests and alert on mismatch.

The lesson: CRT bugs are overflow bugs in disguise, and they hide below the threshold where the *running* modulus exceeds the operands. Test with operands large enough that the **combined** modulus (not the individual moduli) approaches the word limit.

### Reconstruction Strategy Decision Table

| Situation | Reconstruction | Why |
|-----------|----------------|-----|
| `M` fits in 64 bits, few moduli | coprime fold + `mulmod` | simplest, in-word |
| `M` overflows, fixed moduli, many reconstructions | Garner with precomputed inverses | small digits, reuse inverses |
| Result wanted mod a target `M` only | fold then reduce mod `M` last | never lose precision |
| Need the exact big integer | Garner + big-int assembly | overflow-free intermediates |
| Fault tolerance required | redundant moduli + consistency check | localizes corrupted residue |

---

## 9. Concurrency and Parallelism

The RNS structure is *embarrassingly parallel up to the reconstruction*. Each per-prime computation (a full NTT, a matrix determinant mod `pⱼ`, a big-integer multiply mod `pⱼ`) is independent, so they distribute cleanly across cores or machines:

- **Fan-out:** dispatch the `n` per-prime computations as independent tasks. No shared mutable state, no locks.
- **Fan-in (the only serial part):** the CRT/Garner reconstruction. It is cheap relative to the per-prime work, but it must wait for all components. If one component is slow (straggler), the whole reconstruction stalls — apply the usual straggler mitigations (hedged requests, timeouts with a recompute).
- **Determinism:** reconstruction is order-independent for a solvable system, so components can arrive in any order; collect into a fixed-index array keyed by prime before folding to keep results reproducible.
- **Memory:** each component holds only its residue vector mod `pⱼ` (size of the problem, in `pⱼ`-sized words), not the full big integer — a major memory win over computing in one giant modulus.

This is why RNS underlies high-performance modular arithmetic on GPUs and FPGAs: the lane independence maps onto SIMD/threads, and the carry-free property removes the cross-lane dependencies that plague positional big-integer arithmetic.

### Profiling the Reconstruction Path

When CRT *does* show up in a profile, the usual culprits are:

- **`extgcd` / inverse calls in a hot loop.** If you reconstruct millions of coefficients with the *same* moduli, the per-modulus inverses are constant — hoist them out and precompute. A profile showing `extgcd` dominating means you forgot to precompute.
- **`mulmod` overhead.** A 128-bit `mulmod` is several instructions; if each is only barely needed, branch on whether the operands are small enough to multiply directly. Montgomery or Barrett reduction amortizes the cost when one modulus is reused for many multiplies.
- **Cache behavior in multi-coefficient reconstruction.** Reconstruct coefficient-major (all primes for one coefficient, then next) so the per-coefficient residue tuple stays in registers; prime-major order thrashes.
- **Big-integer assembly.** If the final integer is huge, the Horner assembly `Σ cᵢ ∏mⱼ` is `O(n²)` in naive big-int; switch to the product-tree/remainder-tree method (see `professional.md`) when `n` is large.

A representative micro-benchmark target: three-prime reconstruction of one 64-bit coefficient should be a few hundred nanoseconds with precomputed inverses and Montgomery `mulmod`; anything in microseconds means an inverse or allocation is on the hot path.

### Constant-Time Considerations

For cryptographic CRT (RSA-CRT), the reconstruction must be **constant-time** in the secret operands: no data-dependent branches, no secret-indexed memory access, and a `mulmod` whose timing does not depend on operand values. A timing difference in the `m₂ + h·q` combine, or an early-exit in `extgcd`, can leak bits of `p` or `q`. Use constant-time modular reduction and verify with a timing-leakage tool; the fault-attack verification (`m^e ≡ c`) must itself be constant-time and unconditional.

### Montgomery and Barrett Reduction in the Reconstruction

When one modulus is reused across many `mulmod`s — exactly the multi-mod NTT situation — replace generic `mulmod` with **Montgomery** or **Barrett** reduction:

- **Montgomery** keeps operands in a transformed "Montgomery domain" (`x̃ = x·R mod p`) where reduction is a multiply-and-shift with no division. Converting in/out costs one Montgomery multiply each; amortized over the whole per-prime NTT (thousands of multiplies), the conversions vanish.
- **Barrett** precomputes `⌊2^{2k}/p⌋` once and reduces with two multiplies and a subtract — no domain change, convenient when you cannot keep everything in Montgomery form.

For the final CRT/Garner combine, the inverses are constants, so Montgomery-domain accumulation of `Σ cᵢ ∏ mⱼ` mod the target is the fast path. The rule: division is the enemy; precompute a reciprocal once and turn every modular reduction into multiplies and shifts.

### Probabilistic and Markov Variants

CRT also serves probabilistic computations where the "answer" is a distribution. If a Markov chain's step matrix has rational entries with a common denominator, you can carry the numerators modulo several primes, evolve the chain mod each prime, and CRT-reconstruct the exact rational stationary or `k`-step distribution (combined with rational reconstruction, `professional.md` Section 22). This avoids floating-point drift in long chains. The catch: probabilities must be tracked as exact rationals, and the denominator bound must be known to size the prime product — otherwise reconstruction is ambiguous. This is a niche but powerful use when exactness matters more than speed.

---

## 10. Failure Modes

| Failure | Symptom | Root cause | Mitigation |
|---------|---------|-----------|------------|
| Silent overflow in merge | Wrong `x`, passes small tests | `m₁·t` exceeded 64 bits | route through `mulmod` / big int |
| `lcm` overflow | Garbage modulus | `m₁·m₂` before dividing by gcd | `lcm = m₁/g*m₂` |
| Inconsistent treated as solved | Plausible-but-wrong answer | skipped consistency check | check `(a₂−a₁) % g == 0` every merge |
| NTT reconstruction wrong | Off-by-multiple-of-P errors | product `∏ pⱼ` too small | add a prime / bigger primes |
| RSA-CRT key leak | `n` factored from one bad signature | fault during `c^dq mod q` | verify `m^e ≡ c` before release |
| Negative residue propagates | Sporadic wrong answers | un-normalized `(a₂−a₁)` | normalize into `[0, m₂)` |
| Reconstruction DoS | OOM / timeout | adversarial huge `n` / product | bound inputs, cap product size |
| Loss of precision mid-Garner | Truncated big result | reduced mod target too early | assemble exactly, reduce last |
| Wrong sign in modular det | residue `> P/2` not mapped to negative | symmetric representative not applied | map `r → r − P` when `r > P/2` |
| Timing leak of `p`/`q` | side-channel recovers factor | data-dependent branch in combine | constant-time reduction + verify |
| Too few primes chosen | off-by-multiple-of-`P` result | result bound underestimated | size from Hadamard/coeff bound + margin |

### Production Deployment Checklist

Before shipping CRT-based code, confirm:

- [ ] Every product that can reach the combined modulus goes through `mulmod` or big integers.
- [ ] `lcm` is computed as `m / g * mᵢ` (divide first), never `m * mᵢ`.
- [ ] All residues and intermediate differences are normalized into `[0, modulus)`.
- [ ] The consistency check runs on every merge; "no solution" is a typed return, not an exception.
- [ ] Per-modulus inverses are precomputed when moduli are fixed and reused.
- [ ] The reconstruction product strictly exceeds the maximum possible true value, with margin.
- [ ] (Crypto) RSA-CRT output is verified with `m^e ≡ c (mod n)` unconditionally and in constant time.
- [ ] (Crypto) No data-dependent branches or secret-indexed memory in the reconstruction path.
- [ ] A big-integer reference cross-check exists in the test suite and (optionally) as a sampled shadow check in production.
- [ ] Input size (`n`, product bit-length) is bounded against resource-exhaustion when moduli are externally supplied.

Treat this list as a gate: each unchecked item is a known failure mode from the table above waiting to happen.

### Operational FAQ

**Q: My CRT passes all unit tests but fails in production sporadically. Where do I look first?**
Overflow in the back-substitution once the *running* modulus grows. Add a property test with operands large enough that the combined modulus nears `2⁶³`, and route products through `mulmod`. This is the single most common production CRT bug.

**Q: Should I always use the general (non-coprime) merge?**
If moduli are data-derived, yes — it costs one extra gcd and never silently returns a wrong answer. If you control the moduli and they are provably coprime primes (multi-mod NTT), the coprime fold is fine and slightly faster.

**Q: How do I choose between fold, Garner, and big-integer CRT?**
Fits-in-word + one-shot → fold. Overflows word or many reconstructions with fixed moduli → Garner. Need the exact arbitrary-precision integer → Garner with big-int assembly or full big-int CRT. Need rationals → CRT then rational reconstruction.

**Q: Is RSA-CRT safe to enable by default?**
Only with an unconditional, constant-time re-encryption verification of every output. Without it, a single hardware fault factors the key. With it, RSA-CRT is the standard ~4x speedup used in essentially all production RSA.

**Q: How many primes for an NTT product?**
Exactly enough that `∏ pⱼ` exceeds the maximum output coefficient bound, plus one if you want a redundancy/early-termination check. More primes only waste time.

**Q: Can I parallelize CRT?**
The per-prime computations, yes — they are independent. The reconstruction is a cheap serial fan-in; parallelize it only at very large `n` via a product-tree.

---

## 11. Summary

**Key takeaways:**

- The combined modulus is large by design, so treat **every product in the merge as an overflow hazard** — `mulmod` or big integers, and `lcm = m/g·mᵢ`.
- **Multi-prime reconstruction** is the flagship use: size the prime product strictly above the true-result bound, reconstruct (Garner for fixed moduli), reduce mod a target last.
- **RSA-CRT** is ~4x faster but unsafe without an unconditional, constant-time re-encryption check.
- **Inconsistency is data, not a crash** — the gcd consistency check belongs in every merge.
- **Don't over-engineer:** if one prime or `__int128` suffices, skip multi-mod entirely.
- **Normalize everywhere:** reduce residues and differences into `[0, modulus)` at every boundary to avoid sign-induced bugs.
- The per-prime work parallelizes cleanly; the reconstruction is a cheap serial fan-in.
- **Exact modular linear algebra** (determinants, GCDs, solving over ℚ) follows the same recipe: compute mod several bound-sized primes, then CRT-reconstruct (with rational reconstruction when the answer is a fraction).

The senior view of CRT is less about the theorem and more about the *engineering envelope* around it: where the arithmetic overflows, which primes to pick, how to reconstruct safely, and how to fail loudly on inconsistent input rather than returning a plausible-but-wrong answer. Master those and CRT becomes a dependable building block under NTT-based multiplication, exact modular linear algebra, and RSA — three very different systems that all lean on the same residue-tuple-to-number map.

Senior CRT is about the boundaries where the textbook formula meets the machine. The combined modulus is by construction large, so **every product in the merge can overflow** — route them through `mulmod` (128-bit or peasant) or big integers, and always compute `lcm` as `m₁/g·m₂`. The flagship application is **multi-prime reconstruction**: run NTTs or bignum arithmetic under 3–4 coprime (NTT-friendly) primes whose product bounds the true result, then CRT/Garner the residue tuples back — exactly, reducing mod a target only at the very end. **RSA-CRT** halves operand size for a ~4x decryption speedup but demands an output verification step to defend against the fault attack that otherwise factors the modulus. Finally, **inconsistent and non-coprime** systems are normal in production: detect them with the gcd consistency check, classify refine vs conflict, and return "no solution" as data, not as a crash. Get the overflow discipline, the prime selection, and the failure handling right, and CRT becomes a quiet, reliable workhorse under high-performance and cryptographic systems alike.
