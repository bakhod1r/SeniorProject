# Modular Arithmetic — Senior Level

> **Focus:** Production-grade modular arithmetic. The full landscape of overflow (signed 64-bit limits, `__int128`, Montgomery, Barrett), the failure modes of **composite** moduli, decomposing them with CRT, **constant-time** arithmetic for cryptography, and a disciplined testing strategy that catches the silent corruption modular code is famous for.

## Table of Contents
1. [Introduction](#1-introduction)
2. [The Overflow Landscape: 64-bit, __int128, Montgomery, Barrett](#2-the-overflow-landscape)
3. [Montgomery and Barrett Reduction](#3-montgomery-and-barrett-reduction)
4. [Composite Modulus Pitfalls](#4-composite-modulus-pitfalls)
5. [CRT for Non-Prime Moduli](#5-crt-for-non-prime-moduli)
6. [Constant-Time Modular Arithmetic for Crypto](#6-constant-time-modular-arithmetic-for-crypto)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Performance Benchmarks](#10-performance-benchmarks)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "what is `a mod m`" but "what breaks when this runs at scale, on adversarial inputs, or in a cryptographic context?". Modular arithmetic is deceptively simple and famously dangerous: a forgotten negative-fix or a single overflowed multiply corrupts results *silently* — no exception, no crash, just a wrong number that passes casual inspection because it is still in `[0, m)`.

Three classes of concern dominate production modular code:

1. **Overflow correctness** — choosing the right `mulmod` for the modulus size, from a plain 64-bit product (safe up to ~`3 × 10^9`) through `__int128`, Montgomery, and Barrett reduction.
2. **Modulus structure** — composite moduli have non-invertible elements and zero divisors; the algorithms that "just work" for primes (Fermat inverse, `nCr mod p`) fail or need CRT decomposition for composite `m`.
3. **Side channels** — in cryptography the *time* an operation takes must not depend on secret data, which forbids data-dependent branches and the naive `%`.

This document treats each in production terms, with a testing and failure-mode discipline at the end.

The recurring theme is **silence**: unlike a null-pointer dereference or an out-of-bounds index, a modular error produces a valid-looking number. An overflowed product is still in `[0, m)`; a negative remainder is still an integer; a Fermat "inverse" of a non-unit is still a residue. There is no crash to point at. This is why the senior practice of modular arithmetic is dominated by *prevention and verification* — size-checking moduli, asserting hypotheses (primality, coprimality), and wiring a big-integer oracle into CI — rather than by clever one-liners. The algorithms are short; the engineering discipline around them is what matters at scale.

---

## 2. The Overflow Landscape

The right `mulmod` depends entirely on how large `m` can be relative to the integer width.

| Modulus range | Safe `(a·b) mod m` strategy | Why |
|---------------|------------------------------|-----|
| `m < 2^31` (~`2.1×10^9`) | 64-bit `(a*b) % m` | product `< 2^62`, fits signed 64-bit |
| `m < ~3.04×10^9` (`2^31.5`) | 64-bit `(a*b) % m` | product `< 2^63`, still fits signed 64-bit |
| `m < 2^63` | `__int128` product, or Montgomery/Barrett | 64-bit product overflows; need 128-bit intermediate |
| `m < 2^64` (unsigned) | `__int128`, or `bits.Mul64` (Go) / `Math.multiplyHigh` (Java) | full-width unsigned multiply with high word |
| arbitrary precision | big integers (sibling `27-bigint-arithmetic`) | exceeds machine words entirely |

The signed 64-bit limit is `2^63 − 1 ≈ 9.22 × 10^18`. Two operands each `< m` multiply to `< m^2`, so the plain product is safe exactly when `m^2 < 2^63`, i.e. `m < 2^31.5 ≈ 3.04 × 10^9`. The ubiquitous `m = 10^9 + 7` is comfortably inside this; an RSA-style or hashing modulus near `10^18` is not.

A quick numeric sanity check: with `m = 10^9 + 7`, the worst-case product is `(m−1)² ≈ (10^9)² = 10^18`, and `10^18 < 9.22 × 10^18`, leaving a comfortable ~9× headroom — which is also the deferred-reduction batch bound of Section 2.2. With `m = 10^{18}`, the worst-case product is `(10^{18})² = 10^{36}`, overflowing 64-bit by 18 orders of magnitude; the wrap is total and the result bears no relation to the true value. There is no "mostly works" regime in between for large `m`: either the product fits (safe) or it wraps (garbage). This binary cliff is why the modulus-size check is the *first* thing to verify when porting modular code to a new modulus.

For `m` in the dangerous `[2^31.5, 2^63)` band, the options are:

- **`__int128`** (C/C++/Rust): `(unsigned __int128)a * b % m`. One multiply, one reduction. The default in competitive programming.
- **`bits.Mul64` / `bits.Div64`** (Go) or `Math.multiplyHigh` (Java): get the 128-bit product as a high/low word pair, then reduce.
- **Montgomery / Barrett reduction**: replace the expensive hardware `%` with multiplications and shifts; pays off when you do *many* reductions with the *same* modulus (modpow, NTT, RSA).

A useful mnemonic: the safe-product ceiling `~3.04 × 10^9` is just above `2^31`, so "if your modulus needs more than 31 bits, audit the multiply." The two canonical safe moduli `10^9 + 7` (30 bits) and `998 244 353` (30 bits) sit well under it; anything 32-bit-plus does not.

### 2.1 A concrete overflow incident

Consider a polynomial-hash service that switched its modulus from `10^9 + 7` to a `61-bit` prime `m ≈ 2.3 × 10^18` to cut collision probability. The hash loop `h = (h * base + c) % m` had run correctly for years. After the switch, `h * base` — two values each up to `2.3 × 10^18` — produced a true product near `5 × 10^36`, which wrapped silently in signed 64-bit. The hashes were *still* in `[0, m)` (the wrap then `% m` gave a valid-looking residue), so no test caught it; only a spike in hash collisions in production exposed the corruption. The fix was a one-line change to `__int128` (C++) / `bits.Mul64` (Go) in the multiply. The lesson: an overflow under a large modulus is invisible to range checks and to most unit tests — only a big-integer oracle or a collision-rate monitor reveals it.

### 2.2 The exact overflow threshold, derived

For signed 64-bit, the safe-product condition is `(m−1)² ≤ 2^63 − 1`. Solving, `m − 1 ≤ √(2^63) = 2^31.5 ≈ 3.037 × 10^9`, so `m ≤ 3 037 000 499` is safe for a *single* product. But beware **accumulation**: `c = (c + a*b) % m` adds a fresh product to an existing `c < m`, so the intermediate is `< m + (m−1)² ≈ m²`, essentially the same bound. If you defer reductions and accumulate `t` products before a single `%`, the bound tightens to `t·(m−1)² ≤ 2^63 − 1`, i.e. `t ≤ (2^63 − 1)/(m−1)²`. For `m = 10^9 + 7`, that is `t ≤ 9`, so you may sum up to 9 products between reductions — a real speedup in hot dot-product loops.

---

## 3. Montgomery and Barrett Reduction

Hardware integer division (`%`) is slow — often 20-40 cycles versus 3-5 for a multiply. When a modulus is fixed and reused millions of times (modular exponentiation, NTT, elliptic-curve point multiplication), replacing `%` with cheaper operations is a large win.

### Barrett reduction

Barrett precomputes a fixed-point reciprocal `μ = floor(2^k / m)` once, then reduces `x` (with `x < m^2`) by estimating the quotient `q ≈ (x · μ) >> k` and computing `x − q·m`, finishing with at most one or two conditional subtractions. No division at runtime — just two multiplies and a shift. Barrett works for any modulus and is the standard choice when you cannot impose Montgomery's odd-modulus and domain-transform requirements.

### Montgomery reduction

Montgomery maps every residue into the "Montgomery domain" by multiplying by `R = 2^k (mod m)`, where reductions become a multiply, a multiply, and a shift — no division. The catch: `m` must be **odd** (coprime to `R = 2^k`), and you pay a one-time cost to enter and leave the domain. Inside a long modpow or NTT, where thousands of multiplications happen in the domain, this is dramatically faster than `%`. Montgomery multiplication has its own dedicated sibling, `14-montgomery-multiplication`, which derives the algorithm and the `m' = −m^(−1) mod R` precomputation in full.

**When to use which:** Montgomery for odd moduli in hot inner loops (modpow, NTT, crypto); Barrett for arbitrary moduli or when an odd-modulus constraint is unacceptable; plain `%` (or `__int128`) for one-off reductions where setup cost would not amortize.

### 3.1 Amortization math

Let `D` be the cost of a hardware `%` (say 25 cycles) and `R` the cost of a Montgomery/Barrett reduction (say 6 cycles: two multiplies + a shift + a conditional subtract), plus a one-time setup `S` (precomputing `μ` or `m'`, and domain transforms for Montgomery, say 50 cycles). Over `N` reductions, plain `%` costs `N·D`, while reduction-based costs `S + N·R`. The break-even is `N* = S / (D − R) = 50 / (25 − 6) ≈ 3`. So even a handful of reductions with a fixed modulus justifies the machinery — which is why every serious modpow, NTT, and RSA implementation uses Montgomery or Barrett rather than the naive `%`. For a *single* `(a·b) % m`, the setup never amortizes; use `__int128`.

### 3.2 Montgomery domain bookkeeping (the gotcha)

The subtle senior bug with Montgomery is forgetting that values live in the **Montgomery domain** `x̃ = x·R mod m`. Addition and subtraction work unchanged in the domain (`(x·R) + (y·R) = (x+y)·R`), but a Montgomery *multiply* of two domain values `x̃·ỹ` gives `x·y·R²·R^{-1} = (x·y)·R = (xy)~` — correct only because Montgomery reduction folds in one factor of `R^{-1}`. Mixing a domain value with a plain value silently produces a result off by a factor of `R`. The discipline: transform *in* once at the boundary (`x̃ = x·R mod m`), do all arithmetic in the domain, transform *out* once at the end (`x = Montgomery-reduce(x̃)`). Sibling `14-montgomery-multiplication` works the full bookkeeping; the senior takeaway is that the domain boundary must be crossed exactly twice, never per operation.

---

## 4. Composite Modulus Pitfalls

Everything that "just works" for a prime modulus can break for a composite one. The root cause: `Z/mZ` for composite `m` is a ring with **zero divisors** and **non-invertible elements**.

### Non-invertible elements

`a` has an inverse mod `m` **iff** `gcd(a, m) = 1`. For composite `m`, the elements sharing a factor with `m` have **no** inverse. Examples:

- `2` has no inverse mod `4` (`gcd(2, 4) = 2`).
- `6` has no inverse mod `9` (`gcd(6, 9) = 3`).
- Exactly `φ(m)` of the `m` elements are units (invertible); the rest are not.

Any algorithm that "divides" — modular division, `nCr mod m`, Gaussian elimination mod `m` — can hit a non-invertible pivot and fail. You cannot recover by retrying; the inverse genuinely does not exist.

A concrete count: mod `m = 12`, the units are `{1, 5, 7, 11}` (those coprime to `12`), so `φ(12) = 4`. The other seven nonzero residues `{2, 3, 4, 6, 8, 9, 10}` have **no** inverse. If a modular-linear-algebra routine picks any of these as a pivot, dividing the row by it is undefined and the elimination must instead either swap to a unit pivot, scale the system, or fall back to CRT over the prime-power factors `4` and `3`. The senior fix is structural: detect the non-unit pivot via `gcd(pivot, m) ≠ 1` and branch into the decomposition path — never silently divide.

### Zero divisors

For composite `m`, two nonzero residues can multiply to zero: `2 · 3 ≡ 0 (mod 6)`. This breaks the "if `a·b ≡ 0` then `a ≡ 0` or `b ≡ 0`" reasoning that holds in a field. Cancellation laws fail: `a·b ≡ a·c (mod m)` does **not** imply `b ≡ c` unless `a` is a unit. A concrete trap: a solver that "divides both sides" of `4x ≡ 4y (mod 12)` to conclude `x ≡ y` is **wrong** — `4·2 ≡ 4·5 (mod 12)` but `2 ≢ 5`. Cancellation is only valid modulo `12/gcd(4,12) = 3`. Production code that manipulates modular equations (Gaussian elimination, lattice reduction) must treat non-unit pivots specially or the whole derivation silently produces false statements.

### Fermat is invalid

`a^(m−2)` is the inverse only when `m` is prime. For composite `m` use Euler (`a^(φ(m)−1)`, needs the factorization) or extended Euclid. Blindly applying Fermat to a composite modulus yields a plausible-looking but wrong value.

### `nCr mod m` for composite `m`

Direct factorial inverses fail because `r!` may share a factor with `m`. The production approach factors `m = ∏ p_i^{e_i}`, computes `nCr mod p_i^{e_i}` (via Andrew Granville's / Lucas-for-prime-powers techniques), and recombines with CRT (next section). This is substantially more involved than the prime case.

### Worked composite-modulus trap

A team needed `C(n, r) mod 1 000 000 000` (note: `10^9`, **not** the prime `10^9 + 7`). The factorial-inverse code, copied from a prime-modulus solution, computed `invfact[N] = powMod(fact[N], MOD−2, MOD)` via Fermat — but `10^9 = 2^9 · 5^9 · ...`actually `10^9 = (2·5)^9 = 2^9·5^9`, so `MOD` is composite. The result was silently wrong whenever `fact[N]` shared a factor of `2` or `5` with the modulus, which is *almost always* for `N ≥ 5`. Worse, the wrong values still looked like valid residues in `[0, 10^9)`. The fix required factoring `10^9 = 2^9 · 5^9`, computing the binomial mod each prime power with Granville's method, and CRT-combining — a different, much larger code path. The takeaway: **always confirm the modulus is prime before reusing prime-modulus combinatorics code**; a one-character difference (`10^9` vs `10^9 + 7`) changes the entire algorithm.

---

## 5. CRT for Non-Prime Moduli

The **Chinese Remainder Theorem** (sibling `05-crt`) is the senior workaround for composite moduli and for recovering exact values larger than one prime can hold.

### Decomposing a composite modulus

If `m = m₁ · m₂ ⋯ m_k` with the `m_i` **pairwise coprime**, then `Z/mZ ≅ Z/m₁Z × ⋯ × Z/m_kZ`. Arithmetic mod `m` can be done **independently** in each component and recombined:

```
compute x mod m₁, x mod m₂, …, x mod m_k     (independent, parallelizable)
CRT-combine → x mod m
```

This turns a hard modulus (e.g. `m = ∏ p_i^{e_i}`) into several easier prime-power moduli. For each prime-power component, the unit group is well understood and inverses behave predictably.

### Worked decomposition

Compute `7^{100} mod 1000` by splitting `1000 = 8 · 125` (coprime). Mod `8`: `7 ≡ −1`, so `7^{100} ≡ (−1)^{100} = 1 (mod 8)`. Mod `125`: `φ(125) = 100`, and `gcd(7, 125) = 1`, so by Euler `7^{100} ≡ 1 (mod 125)`. CRT-combine `x ≡ 1 (mod 8)`, `x ≡ 1 (mod 125)`: the unique solution mod `1000` is `x = 1`. Indeed `7^{100} mod 1000 = 1`. The decomposition let each component exploit its own structure — sign reduction mod `8`, Euler's theorem mod `125` — turning a `mod 1000` problem (composite, no clean Euler exponent since `φ(1000) = 400`) into two trivial sub-problems. This is the everyday payoff of CRT decomposition: each prime-power factor is individually tractable.

### Residue Number Systems (RNS)

Taken to its limit, CRT decomposition is a **residue number system**: represent every number by its tuple of residues `(x mod p₁, …, x mod p_k)` under a fixed set of coprime primes, and do *all* arithmetic component-wise. Addition, subtraction, and multiplication become embarrassingly parallel — `k` independent machine-word operations with no carries between components. RNS underlies high-throughput cryptographic hardware (RSA/ECC accelerators) and arbitrary-precision libraries: a single `4096`-bit multiply becomes ~130 independent `32`-bit modular multiplies that vectorize or pipeline cleanly. The catch is that **comparison and division are awkward** in RNS (you must reconstruct, or use base-extension tricks), so RNS shines for long chains of `+`/`−`/`×` (exactly modpow's inner loop) and is converted back only at the boundaries. This is the senior-scale generalization of "compute mod several primes and CRT-combine".

### Recovering large exact answers

When the *true* (non-modular) answer exceeds a single 30-bit prime's range, run the entire computation under several coprime primes `p₁, p₂, …` and CRT-combine. Each prime's run is independent — embarrassingly parallel. This is how you get an exact integer result from modular machinery when big-integer arithmetic would be too slow. Garner's algorithm (sibling `15-garner-algorithm`) is the incremental form of multi-prime CRT used in practice.

```
answer mod p₁ ─┐
answer mod p₂ ─┼─ CRT / Garner ─→ answer mod (p₁ p₂ p₃ …)  (exact if below the product)
answer mod p₃ ─┘
```

### Worked multi-prime recovery

Suppose a counting computation yields a value `V` known to satisfy `V < 10^{27}` but computed only modulo single ~30-bit primes. Pick three NTT-friendly primes `p₁ = 1 000 000 007`, `p₂ = 998 244 353`, `p₃ = 1 000 000 009`; their product `≈ 10^{27}` exceeds the bound, so CRT recovers `V` exactly. Run the identical modular pipeline three times, getting `r₁ = V mod p₁`, `r₂ = V mod p₂`, `r₃ = V mod p₃`, then combine. Garner's incremental form builds the answer digit-by-digit in a **mixed-radix** representation, avoiding a single huge modulus in the intermediate: `V = c₀ + c₁·p₁ + c₂·p₁p₂`, where `c₀ = r₁`, `c₁ = (r₂ − c₀)·inv(p₁, p₂) mod p₂`, `c₂ = ((r₃ − c₀)·inv(p₁, p₃) − c₁)·inv(p₂, p₃) mod p₃`. This keeps every intermediate within a machine word until the final big-integer assembly — the reason Garner is preferred over naive CRT for many primes (sibling `15-garner-algorithm`).

### Choosing the number of primes

To recover an exact answer of magnitude `≈ B`, you need primes whose product exceeds `B`. With 30-bit primes (`≈ 10^9` each), each prime contributes ~30 bits, so recovering a `k`-bit answer needs `⌈k/30⌉` primes. Estimate `B` from the problem's growth bound (e.g. for a walk-count `≈ λ_max^steps`, `k ≈ steps·log₂ λ_max`), then add a prime or two of safety margin. Over-provisioning primes is cheap (each run is independent and parallel); under-provisioning silently wraps and corrupts — so err on the side of one extra prime.

### When CRT does *not* apply

CRT requires **pairwise coprime** moduli. If the factors share a common factor (e.g. combining mod 6 and mod 9, which share 3), the system may be inconsistent or have a non-unique solution. The general CRT handles non-coprime moduli only when the congruences agree on the shared part. Concretely, `x ≡ 1 (mod 6)` and `x ≡ 2 (mod 9)` share `gcd(6, 9) = 3`; the first forces `x ≡ 1 (mod 3)`, the second `x ≡ 2 (mod 3)` — contradictory, so **no** solution exists. Always assert pairwise coprimality (or run the consistency check on the shared gcd) before trusting a CRT combine.

---

## 6. Constant-Time Modular Arithmetic for Crypto

In cryptography (RSA, ECC, Diffie-Hellman) the modulus and exponents are **secret**. If the time, memory access pattern, or branch behavior of a modular operation depends on secret bits, an attacker can recover the secret via a **timing side channel**. Senior modular code in a crypto context obeys extra rules:

- **No secret-dependent branches.** The classic `if (bit) result = result · a` in square-and-multiply leaks the exponent's Hamming weight. Use the **Montgomery ladder** or a constant-time conditional select (`result = select(bit, result·a, result)`), which performs the same operations regardless of the bit.
- **No data-dependent table lookups** indexed by secret values (cache-timing attacks). Use masked, full-table scans or constant-time selection.
- **Avoid the variable-time hardware `%`** on secret operands; use Montgomery reduction whose timing is data-independent.
- **Constant-time conditional subtract** in the final reduction step: compute both `x` and `x − m`, then select by a mask derived from the sign, never by a branch.
- **Blind the inputs** (multiply by a random factor, operate, divide it out) to decorrelate timing from secrets where full constant-time is impractical.

The trade-off is real: constant-time code is slower than the naive branchy version, but for secret-bearing operations it is mandatory. Libraries like BoringSSL and libsodium implement these patterns; do not roll your own crypto modular arithmetic for production without this discipline. (Applied-crypto skills `encryption-basics` and `secure-password-storage` cover the broader engineering context.)

### The Montgomery ladder, concretely

Naive square-and-multiply branches on each exponent bit, so its instruction trace (and timing, and power draw) encodes the secret exponent. The **Montgomery ladder** maintains two values `(R0, R1)` with the invariant `R1 = R0 · a` and, for *every* bit, performs exactly one multiply and one square — swapping roles based on the bit via a constant-time conditional swap:

```
ladder(a, e, m):                 # e has L bits, processed high→low
    R0 = 1; R1 = a
    for i from L-1 down to 0:
        bit = (e >> i) & 1
        cswap(R0, R1, bit)       # constant-time swap if bit==1
        R1 = mulmod(R0, R1, m)
        R0 = mulmod(R0, R0, m)
        cswap(R0, R1, bit)       # swap back
    return R0
```

Every iteration runs the identical sequence of operations regardless of `bit`; only the (constant-time, branchless) `cswap` differs, and it touches both registers either way. The result is timing independent of the exponent's Hamming weight and bit pattern — the property that defeats the timing/power side channels. Combined with Montgomery *reduction* (data-independent `mulmod`), the whole exponentiation is constant-time.

### Constant-time conditional select and subtract

The building block is a branchless select. From a secret `bit ∈ {0,1}`, derive a full-width mask `mask = 0 − bit` (`0x000…0` or `0xFFF…F`), then `select(bit, x, y) = (x & mask) | (y & ~mask)`. The final reduction "if `x ≥ m` then `x −= m`" becomes: compute `t = x − m`, derive a mask from the sign/borrow of `t`, and select `t` or `x` — never a branch. These idioms, not a clever `%`, are what make the inner loop's timing data-independent.

### A real timing-attack sketch

Why this matters concretely: in naive RSA, square-and-multiply does an *extra* multiply exactly on the `1`-bits of the secret exponent `d`. An attacker who can time many decryptions measures that decryptions with more `1`-bits take slightly longer, and — over enough samples to average out noise — recovers the Hamming weight of `d`, then individual bits via chosen-ciphertext timing (Kocher's 1996 attack). The Montgomery ladder defeats this because it does the *same* one-multiply-one-square per bit regardless of the bit's value; the only difference is a branchless `cswap`, which has identical timing for `0` and `1`. This is not paranoia: timing attacks have broken real TLS and SSH deployments. The rule "no secret-dependent branch" is a hard requirement, not a style preference, and it is why production crypto never uses the textbook `if (bit) result *= a` form.

---

## 7. Code Examples

### 7.1 Go — overflow-safe `mulmod` via `math/bits` (works for `m` up to 2^63)

```go
package main

import (
	"fmt"
	"math/bits"
)

// mulMod computes (a*b) % m correctly for m up to 2^63-1, using the
// full 128-bit product (hi, lo) and a 128/64 division.
func mulMod(a, b, m uint64) uint64 {
	hi, lo := bits.Mul64(a%m, b%m)
	_, rem := bits.Div64(hi%m, lo, m) // hi must be < m for Div64
	return rem
}

func powMod(a, b, m uint64) uint64 {
	a %= m
	var result uint64 = 1 % m
	for b > 0 {
		if b&1 == 1 {
			result = mulMod(result, a, m)
		}
		a = mulMod(a, a, m)
		b >>= 1
	}
	return result
}

func main() {
	const m = uint64(9_000_000_000_000_000_037) // ~9e18 prime-ish modulus
	fmt.Println(mulMod(8_999_999_999_999_999_000, 7_777_777_777_777_777, m))
	fmt.Println(powMod(3, 1_000_000_000_000, m))
}
```

### 7.2 Java — extended-Euclid inverse for composite moduli + CRT combine

```java
public class CompositeMod {
    // Extended Euclid: returns {g, x, y} with a*x + b*y = g.
    static long[] extgcd(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extgcd(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }

    // Inverse of a mod m for ANY coprime m (prime or composite).
    static long inverse(long a, long m) {
        a = ((a % m) + m) % m;
        long[] r = extgcd(a, m);
        if (r[0] != 1) throw new ArithmeticException("a, m not coprime: no inverse");
        return ((r[1] % m) + m) % m;
    }

    // CRT-combine x ≡ r1 (mod m1), x ≡ r2 (mod m2) for coprime m1, m2.
    static long crt2(long r1, long m1, long r2, long m2) {
        long inv = inverse(m1 % m2, m2);
        long t = ((r2 - r1) % m2 + m2) % m2 * inv % m2;
        return ((r1 + m1 * t) % (m1 * m2) + m1 * m2) % (m1 * m2);
    }

    public static void main(String[] args) {
        System.out.println(inverse(3, 26));       // 9  (3*9 = 27 ≡ 1 mod 26)
        // 2 has no inverse mod 4: throws.
        try { inverse(2, 4); } catch (Exception e) { System.out.println(e.getMessage()); }
        System.out.println(crt2(2, 3, 3, 5));     // x ≡ 2 mod 3, x ≡ 3 mod 5 -> 8
    }
}
```

### 7.3 Python — exact answer via multi-prime CRT (recover beyond one prime)

```python
def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def inverse(a, m):
    g, x, _ = ext_gcd(a % m, m)
    if g != 1:
        raise ValueError("no inverse")
    return x % m


def crt(remainders, moduli):
    """Combine x ≡ remainders[i] (mod moduli[i]) for pairwise-coprime moduli."""
    x, prod = 0, 1
    for m in moduli:
        prod *= m
    for r, m in zip(remainders, moduli):
        pi = prod // m
        x = (x + r * pi % prod * inverse(pi % m, m)) % prod
    return x


if __name__ == "__main__":
    # Suppose a computation yields these residues under three primes.
    primes = [1_000_000_007, 998_244_353, 1_000_000_009]
    # True value 123456789012345678 reduced under each prime:
    val = 123456789012345678
    residues = [val % p for p in primes]
    recovered = crt(residues, primes)
    print(recovered % (primes[0] * primes[1] * primes[2]) == val)  # True (val < product)
    print(recovered if recovered < primes[0] * primes[1] * primes[2] else "wrapped")
```

### 7.4 Go — Barrett reduction (replace `%` with multiply + shift)

```go
package main

import "fmt"

// Barrett reducer for a fixed modulus m (m < 2^32 here for clarity).
type Barrett struct {
	m  uint64
	mu uint64 // floor(2^64 / m)
	k  uint
}

func NewBarrett(m uint64) Barrett {
	// mu = floor(2^64 / m); computed once.
	// For m < 2^32, x < m^2 < 2^64, and the estimate is accurate to ±1.
	mu := (^uint64(0)) / m // approximates 2^64 / m
	return Barrett{m: m, mu: mu, k: 64}
}

// Reduce returns x mod m for x < m^2, using no hardware division.
func (b Barrett) Reduce(x uint64) uint64 {
	// q ≈ (x * mu) >> 64  (high 64 bits of the 128-bit product)
	hi := mulHigh(x, b.mu)
	r := x - hi*b.m
	for r >= b.m { // at most two corrections
		r -= b.m
	}
	return r
}

// mulHigh returns the high 64 bits of x*y (schoolbook; bits.Mul64 is faster).
func mulHigh(x, y uint64) uint64 {
	const mask = 0xFFFFFFFF
	x0, x1 := x&mask, x>>32
	y0, y1 := y&mask, y>>32
	mid := x1*y0 + (x0*y0)>>32
	mid2 := x0*y1 + (mid & mask)
	return x1*y1 + (mid >> 32) + (mid2 >> 32)
}

func main() {
	b := NewBarrett(1_000_000_007)
	fmt.Println(b.Reduce(999_999_999_999_999)) // == 999999999999999 % 1000000007
}
```

This illustrates the *shape* of Barrett reduction — estimate the quotient by a precomputed reciprocal, subtract, correct — without claiming production-grade edge-case handling (a real implementation uses `bits.Mul64` and proves the correction count). The point at the senior level is that the hot-loop `%` can be replaced by a multiply, a shift, and a bounded number of subtractions, which is why fixed-modulus inner loops use it. The same `Barrett` object, built once, serves every reduction with that modulus — the amortization that makes the precompute worthwhile (Section 3.1).

### 7.4b Why two corrections suffice

After `r = x − q·m` with the Barrett quotient estimate `q`, the true quotient `⌊x/m⌋` exceeds `q` by at most `2` (for the standard parameter choice `k = 2·bitlen(m)`). Hence `r` is at most `2m` above the correct residue, and a loop of at most two `r -= m` subtractions corrects it. This bounded, data-independent correction count is what lets Barrett be both branch-light and (with masked selects) constant-time. The proof of the `+2` bound is a short interval argument on `μ = ⌊2^k/m⌋`; sibling `14-montgomery-multiplication` and Barrett's original 1986 paper give it in full.
In practice, a single conditional subtract handles the common case and the rare second one is cheap, so the inner loop stays tight.

### 7.5 Worked Barrett trace

Reduce `x = 25` mod `m = 7` with a small `k = 8` (so `2^k = 256`). Precompute `μ = floor(256 / 7) = 36`. Estimate the quotient: `q = (x · μ) >> 8 = (25 · 36) >> 8 = 900 >> 8 = floor(900/256) = 3`. Then `r = x − q·m = 25 − 3·7 = 25 − 21 = 4`. Since `4 < 7`, no correction is needed, and indeed `25 mod 7 = 4`. The division `25/7` was computed with one multiply (`25·36`), one shift (`>>8`), and one subtract — no hardware `/`. The estimate `q = 3` happened to be exact here; in general it can be off by one, absorbed by the single conditional subtract, which is why Barrett is correct *and* division-free.

---

## 8. Observability and Testing

Modular bugs are silent — the wrong answer is still a valid-looking residue in `[0, m)`. Build verification in from day one.

| Check | Why it catches bugs |
|-------|---------------------|
| Brute-force / big-integer oracle on small inputs | Confirms `mulmod`, `powMod`, `inv`, `nCr` against exact arithmetic. |
| `a · inv(a) ≡ 1 (mod m)` property test | Catches a broken inverse immediately. |
| `powMod(a, 0) == 1`, `powMod(a, 1) == a%m` | Base-case sanity. |
| Negative-input round-trip: `norm(−x) == norm(m−x)` | Catches missing negative-fix. |
| `mulmod` against `__int128` reference | Verifies the overflow-safe path. |
| Fermat vs extended-Euclid inverse agreement (prime `m`) | Two independent methods must agree. |
| CRT round-trip: `combine(split(x)) == x` | Validates the decomposition pipeline. |
| Reject non-coprime inverse (expect exception) | Confirms the failure path is handled, not ignored. |

The single most valuable test is the **big-integer oracle**: recompute the same expression with arbitrary-precision integers (Python `int`, Java `BigInteger`, Go `math/big`), reduce at the end, and compare. It catches overflow, negative-mod, and inverse bugs in one shot.

### 8.1 A property-test battery

```text
for random a, b in [0, m), random m (mix of primes and composites):
    assert mulmod(a, b, m) == (bigint(a) * bigint(b)) % m
    assert powmod(a, e, m) == pow(bigint(a), e, m)
    if gcd(a, m) == 1:
        assert (a * inverse(a, m)) % m == 1
    else:
        assert inverse(a, m) raises          # no inverse for non-units
    assert norm(-a, m) == (m - a) % m
for prime p: assert inv_fermat(a, p) == inv_euclid(a, p)
```

Run these on every CI build with hundreds of random instances, mixing prime and composite moduli so the composite failure paths are actually exercised.

### 8.2 Worked oracle catch

Imagine a `mulmod` with a subtle bug: it reduces only one operand, `((a % m) * b) % m`, forgetting to reduce `b`. For `m = 10^9 + 7`, `a = 5`, `b = 3` (already small), the wrong code returns `15` — correct, so a casual test passes. But feed it `a = 2·10^9` (un-reduced) and `b = 2·10^9`: the buggy code computes `((2·10^9 % m) · 2·10^9)` where the second factor is ~`2·10^9`, and `(a%m)·b ≈ 10^9 · 2·10^9 = 2·10^18`, which is *just* under `2^63` — so it happens not to overflow and returns a plausible residue that is nonetheless wrong (it should have reduced `b` first). The big-integer oracle `bigint(a)*bigint(b) % m` immediately flags the mismatch. This is exactly the class of bug that passes hand-picked small tests and only randomized oracle testing across large, un-normalized inputs reliably catches.

### 8.3 Determinism across languages

A strong cross-check for a multi-language codebase (Go, Java, Python implementations of the same routine) is **bit-for-bit output agreement** on a shared seeded test vector. Generate `(a, b, e, m)` tuples from a fixed seed, run all three implementations, and diff. Any divergence localizes a language-specific bug — typically a negative-`%` difference (Python vs Go/Java) or an overflow that one language's wider intermediate hides. This catches the negative-mod and overflow classes structurally, before they reach production.

---

## 9. Failure Modes

### 9.1 Silent overflow in `mulmod`
A plain `(a*b) % m` overflows when `m > 2^31.5`. The result is a valid-looking wrong residue. **Mitigation:** size-check the modulus; use `__int128`/`bits.Mul64`/Montgomery above the threshold; oracle-test against big integers.

### 9.2 Negative remainder corruption
`%` returns the dividend's sign in Go/Java/C/C++. A negative residue used as an array index or in a comparison silently corrupts. **Mitigation:** `((x % m) + m) % m` after every subtraction; centralize in a `subMod` helper. A vivid instance: a hashing routine `idx = h % tableSize` with a 64-bit `h` that went negative (the high bit set) produced a *negative* index in Java, throwing `ArrayIndexOutOfBoundsException` only intermittently — when `h` happened to be negative. The `((h % n) + n) % n` fix is one line; finding the bug without it took a day. Note the symptom is sometimes a crash (out-of-bounds) and sometimes silent (a valid-but-wrong negative used in arithmetic), which makes it especially insidious.

### 9.3 Fermat inverse on a composite modulus
`a^(m−2)` is not the inverse when `m` is composite. **Mitigation:** assert primality before Fermat; default to extended Euclid for unknown/composite `m`.

### 9.4 Inverting a non-unit
For composite `m`, elements sharing a factor with `m` have no inverse; extgcd returns `g ≠ 1`. **Mitigation:** check the gcd and surface an error — never return garbage. A non-invertible pivot in modular Gaussian elimination must be handled explicitly. The subtle variant: an extgcd inverse that *forgets* to check `g == 1` returns the Bézout coefficient anyway, which is **not** an inverse when `g > 1` — a plausible-looking residue that fails `a·x ≡ 1`. Always gate the return on `g == 1`.

### 9.5 CRT on non-coprime moduli
Combining congruences with non-coprime moduli can be inconsistent or non-unique. **Mitigation:** assert pairwise coprimality, or use the general CRT that checks agreement on the gcd.

### 9.6 Timing side channels in crypto
A secret-dependent branch (square-and-multiply, table lookup) leaks key bits. **Mitigation:** Montgomery ladder, constant-time select, data-independent reductions; never use variable-time `%` on secret operands.

### 9.7 Wrong modulus constant
Using `10^9` instead of the prime `10^9 + 7`, or mixing two moduli in one expression. **Mitigation:** one named constant; assert all operands share the same modulus.

### 9.8 `nCr mod m` for composite `m`
Factorial inverses fail when `r!` shares a factor with `m`. **Mitigation:** factor `m`, compute per prime-power, CRT-combine — do not reuse the prime-`p` factorial-inverse recipe.

### 9.9 Accumulator overflow from deferred reduction
Deferring `% m` to batch reductions is a valid speedup, but the term bound `t ≤ (2^63−1)/(m−1)²` (Section 2.2) must be respected. Exceeding it overflows the accumulator silently. **Mitigation:** compute the bound from `m` at startup and reduce at least every `t` terms; add an assertion in debug builds.

### 9.10 Montgomery domain leak
Mixing a Montgomery-domain value `x̃ = x·R` with a plain value yields a result off by a factor of `R` — a silent, hard-to-spot error. **Mitigation:** cross the domain boundary exactly twice (transform in once, out once); keep domain and plain values in distinct types so the compiler rejects mixing (Section 3.2).

### 9.11 Primality assumption drift
Code that assumed a prime modulus (Fermat inverse, factorial inverses) is reused with a new, composite modulus during a refactor. **Mitigation:** make the modulus's primality an explicit, asserted precondition at the routine boundary, not an unwritten assumption; the `10^9` vs `10^9 + 7` confusion (Section 4) is the canonical instance.

---

## 10. Performance Benchmarks

Approximate cycle costs for the core modular operations on a modern x86-64 core (illustrative — measure your own platform; numbers vary by microarchitecture and modulus):

| Operation | ~Cycles | Notes |
|-----------|---------|-------|
| 64-bit add/sub + conditional subtract | 2-3 | cheaper than `%` |
| 64-bit `(a*b) % m`, `m < 2^31.5` | 25-40 | hardware `MUL` + `DIV` |
| `__int128` multiply + reduce | 30-45 | one 128-bit `MUL`, one 128/64 `DIV` |
| Barrett reduce (precomputed `μ`) | 6-10 | two `MUL` + shift + ≤2 sub |
| Montgomery multiply (in domain) | 5-9 | two `MUL` + shift + 1 cond-sub |
| `powMod`, 30-bit exponent | ~30 × multiply | ~30 squarings + ≤30 multiplies |
| Fermat inverse (`a^{p−2}`) | ~60 × multiply | one full `powMod` |
| `nCr` query (precomputed tables) | ~5 | 3 loads + 2 multiplies + reductions |

**Reading the table.** The hardware `DIV` inside a naive `(a*b) % m` is the dominant cost (~25-40 cycles), roughly 4-6× a single multiply. Montgomery/Barrett shrink the reduction to ~6-9 cycles, which is why a modpow of `~30-60` reductions runs measurably faster with them — the `O(log b)` reduction count is unchanged, but each reduction is far cheaper. The `nCr` query at ~5 cycles shows why the `O(N)` precompute is the right design: per-query work is near-free once the tables exist.

**Practical guidance.** For one-off reductions, the setup cost of Montgomery/Barrett does not amortize (Section 3.1: break-even ~3 reductions) — use `__int128`. For modpow, NTT, RSA, and any fixed-modulus hot loop, the reduction machinery pays for itself many times over. And in all cases, the cheapest reduction is *no* reduction: after an addition of two reduced values, `if (x >= m) x -= m;` (2-3 cycles) beats `x %= m` (25+ cycles) decisively.

---

## 11. Summary

- **Overflow is the first correctness gate.** Plain 64-bit `(a·b) % m` is safe only for `m < 2^31.5 ≈ 3.04 × 10^9`. Above that, use `__int128`, `bits.Mul64`/`multiplyHigh`, or Montgomery/Barrett reduction — and oracle-test against big integers.
- **Montgomery and Barrett** replace the slow hardware `%` with multiplies and shifts; they pay off in hot loops (modpow, NTT, crypto) with a fixed modulus. Montgomery needs an odd modulus; Barrett is general. (Full derivation: sibling `14-montgomery-multiplication`.)
- **Composite moduli break the prime-world assumptions.** Non-units have no inverse, zero divisors exist, cancellation fails, and Fermat is invalid. Use extended Euclid for inverses and handle non-invertible pivots explicitly.
- **CRT decomposes composite moduli** into coprime (prime-power) components for independent, parallel arithmetic, and recovers exact answers larger than one prime via multi-prime CRT / Garner (siblings `05-crt`, `15-garner-algorithm`).
- **Crypto demands constant time.** Secret-dependent branches and table lookups leak via timing/cache side channels; use the Montgomery ladder, constant-time selects, and data-independent reductions.
- **Modular bugs are silent.** A wrong answer is still a valid residue. The big-integer oracle and the `a·inv(a) ≡ 1` property test, run on both prime and composite moduli, are the highest-value defenses.
- **RNS generalizes CRT** for high-throughput `+`/`−`/`×` chains: carry-free, parallel, component-wise arithmetic, converted back only at the boundaries (comparison and division are the awkward operations).
- **The cheapest reduction is no reduction:** prefer `if (x >= m) x -= m;` over `x %= m` after additions, and respect the deferred-reduction term bound when batching multiplies.

### Decision summary

- **`m < 3×10^9`** → plain 64-bit `(a*b) % m`.
- **`3×10^9 ≤ m < 2^63`, one-off** → `__int128` / `bits.Mul64`.
- **`m` fixed, many reductions** → Montgomery (odd `m`) or Barrett (any `m`).
- **`m` composite** → extended Euclid inverses; CRT-decompose for `nCr` and division.
- **Exact answer beyond one prime** → multi-prime CRT / Garner.
- **Secret operands (crypto)** → constant-time everything (Montgomery ladder, masked select).
- **Long `+`/`−`/`×` chains, high throughput** → residue number system (RNS) over fixed primes.

### Senior checklist before shipping modular code

1. **Size the modulus.** Is `m < 3×10^9`? If not, audit every multiply for overflow.
2. **Confirm primality** if you use Fermat inverses or prime-modulus combinatorics — `10^9 + 7` (prime) vs `10^9` (composite) is a one-character, total-rewrite difference.
3. **Centralize the negative fix** in a `subMod` helper; never inline a bare `a - b`.
4. **Pick the reduction** by amortization: one-off → `__int128`; hot loop → Montgomery/Barrett.
5. **Guard non-invertible elements**; surface an error, never emit garbage from a non-unit "inverse".
6. **Assert coprimality** before any CRT combine.
7. **Constant-time** if any operand is a secret — Montgomery ladder, masked select, data-independent reduction.
8. **Wire the big-integer oracle** into CI with randomized prime *and* composite moduli; cross-check languages on a seeded vector.

Each item maps to a failure mode above; checking them all is what separates a modular routine that "works on the sample input" from one that survives adversarial inputs and scale.

References to study further: Montgomery (1985) modular multiplication; Barrett (1986) reduction; Granville's "binomial coefficients modulo prime powers"; Garner's algorithm for incremental CRT; Szabó & Tanaka on residue number systems; sibling topics `05-crt`, `06-extended-euclidean-modular-inverse`, `14-montgomery-multiplication`, `15-garner-algorithm`, `26-binary-exponentiation`, and `27-bigint-arithmetic`; the `encryption-basics` and `secure-password-storage` skills for applied-crypto context; Handbook of Applied Cryptography, Ch. 14, on efficient modular arithmetic.
