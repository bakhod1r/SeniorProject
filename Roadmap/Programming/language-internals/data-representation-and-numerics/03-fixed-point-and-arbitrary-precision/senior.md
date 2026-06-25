# Fixed-Point & Arbitrary Precision — Senior Level

> **Topic:** [Fixed-Point & Arbitrary Precision](README.md)
> **Focus:** How bignums are actually built (limbs), the multiplication ladder from schoolbook through Karatsuba, Toom-Cook, and FFT, the real cost model, arbitrary-precision rationals and decimal floating point, and the places where bignums silently destroy your performance.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What is inside a `BigInteger`, why does multiplying two huge numbers cost *less* than O(n²), and where do bignums quietly turn an O(n) loop into O(n²) or worse?**

By now you can use fixed-point and decimals correctly. The senior question is *mechanical*: when you call `a.multiply(b)` on two thousand-digit integers, what runs, and what does it cost? The answer determines whether your cryptography, your combinatorics, your big-rational geometry, or your "I just used Python ints in a loop" code is fast or pathologically slow.

A bignum is an array of machine words — **limbs** — representing a number in base `2^64` (or `2^32`). All the interesting engineering is in the algorithms over those limbs, and they form a ladder where each rung wins for larger inputs:

- **Schoolbook** multiply: O(n²). Best for small numbers; the constant factor is tiny.
- **Karatsuba:** O(n^1.585). Three half-size multiplies instead of four.
- **Toom-Cook** (Toom-3, Toom-4…): O(n^1.465) and lower. More splits, more additions.
- **FFT-based** (Schönhage–Strassen, and the 2019 Harvey–van der Hoeven O(n log n)): for *enormous* numbers.

Production libraries (GMP, Java's `BigInteger`, Go's `math/big`) implement several of these and switch between them by operand size. Knowing the *thresholds* and the *cost model* is the senior skill — and so is knowing the failure mode: bignums are allocated, immutable in many languages, and have non-constant-time operations, so naïve use turns linear algorithms quadratic.

> 🎓 **Why this matters for a senior:** The performance cliffs here are invisible in small tests and brutal in production. "Why is this number-crunching endpoint 100× slower than estimated?" is very often "an inner-loop bignum op that isn't O(1)." And in cryptography, "why does this branch on the secret?" is a timing side channel. Senior engineers are expected to reason about both.

This page covers: limb representation; the multiplication ladder and the cost model; division and modular reduction; arbitrary-precision rationals and where they explode; decimal floating point internals; and the performance traps. `professional.md` puts this to work in real money and crypto systems.

---

## Prerequisites

- **Required:** Middle page — Q-notation, scale/precision, rounding, allocation.
- **Required:** Big-O analysis and the difference between asymptotic and constant-factor wins.
- **Required:** What a machine word is; modular arithmetic basics (`mod`, GCD).
- **Helpful:** Awareness of the FFT / convolution at a high level.
- **Helpful:** Some exposure to RSA / modular exponentiation.

You do **not** need a full proof of Karatsuba's complexity or the FFT — the recurrences and the *when-to-use* are what matter.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Limb** | One machine word of a bignum (commonly 64-bit). A bignum is an array of limbs in base `2^64`. |
| **Normalization** | Trimming leading zero limbs and fixing the sign so each number has one canonical representation. |
| **Schoolbook multiply** | Grade-school long multiplication: multiply every limb by every limb. O(n²). |
| **Karatsuba** | Split each operand in half; compute the product with **three** half-multiplies instead of four. O(n^log₂3) ≈ O(n^1.585). |
| **Toom-Cook** | Generalization of Karatsuba splitting into k parts; Toom-3 ≈ O(n^1.465). |
| **Schönhage–Strassen** | FFT-based multiplication over a ring, O(n log n log log n). For very large n. |
| **Harvey–van der Hoeven** | 2019 algorithm achieving the long-conjectured O(n log n) bound (galactic — practical only at astronomical sizes). |
| **Crossover / threshold** | The operand size at which a library switches from one algorithm to a faster-asymptotic one. |
| **Modular exponentiation** | Computing `a^b mod m` efficiently (square-and-multiply), the heart of RSA/DH. |
| **Montgomery / Barrett reduction** | Techniques to do repeated `mod m` without expensive division. |
| **Arbitrary-precision rational** | An exact fraction `p/q` of two bignums, kept in lowest terms via GCD. |
| **Decimal floating point** | A float whose base is 10 (IEEE 754-2008 `decimal64`/`decimal128`); exact for decimal fractions. |
| **Constant-time** | An operation whose running time does not depend on secret data — required to avoid timing side channels. |
| **Limb-walking** | Iterating limb by limb with carry/borrow propagation — the inner loop of add/sub/mul. |

---

## Core Concepts

### 1. Limb Representation

A bignum stores a magnitude as an array of limbs (words) in radix `B = 2^w` (w = 32 or 64), plus a sign and a length:

```
struct BigInt {
    int sign;        // -1, 0, +1
    size_t len;      // number of significant limbs
    uint64_t *limbs; // little-endian: limbs[0] is least significant
};
```

The value is `sign · Σ limbs[i] · B^i`. Most libraries keep numbers **normalized** (no leading zero limbs; a single canonical zero) so comparison and equality are cheap. Add and subtract are O(n) limb-walks with carry/borrow. The interesting cost is **multiplication and division**.

### 2. The Multiplication Ladder and the Cost Model

**Schoolbook (O(n²)).** For n-limb operands, multiply each limb of `a` by each limb of `b`, shifting and accumulating with carries. n² limb-multiplies. The constant factor is small and cache-friendly, so for small n (a few limbs) this *wins*. Every library uses it below its first threshold.

**Karatsuba (O(n^1.585)).** Split each operand into high/low halves: `a = a₁·B^k + a₀`, `b = b₁·B^k + b₀`. The naïve product needs four half-multiplies (`a₁b₁`, `a₁b₀`, `a₀b₁`, `a₀b₀`). Karatsuba's trick computes the middle term from the other two:

```
z2 = a1*b1
z0 = a0*b0
z1 = (a0+a1)*(b0+b1) - z2 - z0     // one multiply instead of two
result = z2·B^(2k) + z1·B^k + z0
```

Three half-size multiplies → recurrence `T(n) = 3·T(n/2) + O(n)` → O(n^log₂3). The extra additions cost something, so Karatsuba only beats schoolbook above a crossover (often ~20–40 limbs in GMP).

**Toom-Cook (Toom-3 ≈ O(n^1.465)).** Split into 3 (or more) parts, evaluate the operand polynomials at several points, multiply pointwise (5 multiplies for Toom-3), then interpolate. Lower exponent, but more overhead, so it wins only above a *higher* threshold than Karatsuba.

**FFT (Schönhage–Strassen, O(n log n log log n)).** Treat the digits as coefficients of a polynomial; multiplication is convolution; convolution is pointwise multiply in the frequency domain via FFT. The asymptotic champion, but the constant factor and memory are large, so it only wins for *very* large numbers (tens of thousands of bits and up — e.g., computing π to billions of digits).

The cost model in one line: **bignum multiply of two n-limb numbers is roughly O(n^1.585) in practice** (Karatsuba range) for "big but not astronomical" inputs, **and definitely not O(1).** That last fact is the source of most performance surprises.

### 3. Division, Modulo, and Modular Exponentiation

Division is harder than multiplication and is the bottleneck in modular arithmetic. Schoolbook long division is O(n·m). For cryptography you do `a^b mod m` thousands of times, so libraries avoid raw division per step:

- **Square-and-multiply** turns `a^b` into O(log b) multiplications.
- **Montgomery reduction** replaces each `mod m` with shifts/multiplies in a transformed domain — no trial division.
- **Barrett reduction** precomputes a reciprocal of `m` to turn `mod` into multiply-and-shift.

RSA-2048 signature verification, Diffie-Hellman, and ECC scalar multiplication all live and die by how fast these run.

### 4. Arbitrary-Precision Rationals

A rational `Rat` is two bignums `p/q` kept coprime via GCD after every operation:

```
a/b + c/d = (a·d + c·b) / (b·d)   then divide both by gcd(numerator, denominator)
```

Rationals are *exact* — no rounding ever — which is wonderful for exact geometry, computer algebra, and symbolic math. The trap: **denominators blow up.** Adding many rationals, or iterating a fraction-producing recurrence, makes `p` and `q` grow without bound; each GCD is itself a bignum operation. An "exact" rational loop can go from milliseconds to minutes as the fractions balloon. Use rationals only where you genuinely need exactness *and* the denominators stay bounded, or cap them deliberately.

### 5. Decimal Floating Point (IEEE 754 `decimal64`/`decimal128`)

Distinct from `BigDecimal`: hardware/standard **decimal floating point** stores a base-10 significand and a base-10 exponent in a fixed width (64 or 128 bits), giving exact representation of decimal fractions with *bounded* precision (16 or 34 significant digits). IBM POWER and z/Architecture have hardware decimal FP; C has `_Decimal64`/`_Decimal128` (TR 24732), and it's used heavily in financial/COBOL-adjacent systems. It sits between fixed-width binary floats (fast, inexact for decimals) and arbitrary `BigDecimal` (exact, unbounded, slow): exact for decimals, but fixed-width and therefore fast and overflow-bounded.

### 6. Where Bignums Silently Kill Performance

The recurring senior incident: an algorithm that's O(n) *assuming O(1) arithmetic* becomes O(n²) because the numbers themselves grow to O(n) digits.

- **Accumulating a product/factorial in a loop:** `prod *= i` where `prod` grows to n·log n digits — total work is O(n²) limb operations, not O(n).
- **Fibonacci by naive iteration:** `F(n)` has ~n bits, so each addition is O(n); computing up to `F(n)` is O(n²).
- **Python ints in a hot numeric loop:** every value is a bignum; small-int caching helps, but once values exceed one limb you pay allocation and limb-walking per operation, with no SIMD.
- **Immutability churn:** Java `BigInteger` and Go `big.Int` (when used immutably) allocate a fresh object per operation — a tight loop becomes an allocator and GC stress test. (Go lets you mutate a receiver to avoid this.)

The fix is to *expect* non-constant arithmetic, reuse buffers, and check whether a closed-form or modular-reduced approach keeps the operands small.

---

## Real-World Analogies

**The multiplication ladder is choosing a vehicle by distance.** Walking (schoolbook) is fastest for the corner shop. A car (Karatsuba) wins across town. A plane (FFT) only pays off for another continent — and is absurd for the corner shop because boarding (setup) dominates. Libraries "check the distance" (operand size) and pick the vehicle.

**Rationals are exact bookkeeping that hoards receipts.** Keeping every fraction exact is like never rounding a receipt — perfectly accurate, but the stack of paper (the denominator) grows until it's unmanageable.

**Constant-time crypto is a poker face.** If your "thinking time" reveals whether you have a good hand, opponents read you. A modular exponentiation whose timing depends on the secret key bits leaks the key the same way.

**Bignum-in-a-loop is compound interest on cost.** Each iteration's number is a little bigger, so each operation is a little slower; the slowdown compounds into a quadratic wall you didn't budget for.

---

## Mental Models

**Model 1 — "Arithmetic is O(1) only while the number fits a register."** The instant a value spans multiple limbs, every op is O(limbs). Re-derive your algorithm's complexity with that in mind.

**Model 2 — "Asymptotics win late; constants win early."** Karatsuba/Toom/FFT each have a crossover. Below it they *lose*. That's why every serious library is a *cascade* of algorithms keyed on size.

**Model 3 — "Exact has a storage cost."** Rationals never round but their denominators grow; the price of exactness is paid in limbs. Budget it or bound it.

**Model 4 — "Secret-dependent timing is a leak."** In crypto, the *time* an operation takes is data you're broadcasting. Constant-time discipline is a correctness requirement, not an optimization.

---

## Code Examples

### Karatsuba multiplication (illustrative, Python)

```python
def karatsuba(x: int, y: int) -> int:
    if x < 1 << 64 or y < 1 << 64:        # base case: small enough, use native
        return x * y
    n = max(x.bit_length(), y.bit_length())
    k = (n // 2)
    high_x, low_x = x >> k, x & ((1 << k) - 1)
    high_y, low_y = y >> k, y & ((1 << k) - 1)
    z2 = karatsuba(high_x, high_y)
    z0 = karatsuba(low_x, low_y)
    z1 = karatsuba(low_x + high_x, low_y + high_y) - z2 - z0
    return (z2 << (2 * k)) + (z1 << k) + z0
```

### The quadratic-factorial trap and a quick measurement (Python)

```python
import time

def factorial_loop(n: int) -> int:
    p = 1
    for i in range(2, n + 1):
        p *= i          # p grows to ~n*log2(n) bits: each multiply is NOT O(1)
    return p

# Doubling n roughly quadruples the time -> O(n^2)-ish, not O(n).
for n in (20000, 40000, 80000):
    t = time.perf_counter()
    factorial_loop(n)
    print(n, round(time.perf_counter() - t, 3), "s")
```

### Modular exponentiation, square-and-multiply (Go, math/big)

```go
package main

import (
    "fmt"
    "math/big"
)

func main() {
    base := new(big.Int).SetInt64(7)
    exp  := new(big.Int).SetInt64(1 << 20)
    mod  := new(big.Int)
    mod.SetString("32317006071311007300714876688669951960444102669715484032130345427524655138867", 10)

    // big.Int.Exp implements fast modular exponentiation (square-and-multiply + reduction)
    result := new(big.Int).Exp(base, exp, mod)
    fmt.Println(result)
}
```

### Reusing buffers to avoid allocation churn (Go)

```go
// Immutable style allocates a new big.Int each iteration:
//   sum = new(big.Int).Add(sum, term)   // garbage every loop
// Mutating receiver style reuses storage:
func sumTerms(terms []*big.Int) *big.Int {
    acc := new(big.Int)
    for _, t := range terms {
        acc.Add(acc, t) // writes into acc, no per-iteration allocation
    }
    return acc
}
```

### Arbitrary-precision rationals and the blow-up (Python Fraction)

```python
from fractions import Fraction

# Exact, but watch the denominator grow:
total = Fraction(0)
for k in range(1, 30):
    total += Fraction(1, k)     # harmonic sum; denominator = lcm(1..k), explodes
print(total.denominator.bit_length(), "bits in the denominator")
```

---

## Pros & Cons

### Bignums

**Pros:** exact unbounded integers; enable crypto, combinatorics, exact arithmetic. **Cons:** non-O(1) operations; allocation/immutability overhead; cache-unfriendly; no SIMD on a single value; timing can leak secrets.

### The algorithm cascade (schoolbook→Karatsuba→Toom→FFT)

**Pros:** near-optimal performance across the whole size range; libraries hide it. **Cons:** thresholds are platform-tuned and can be wrong for your distribution; FFT's memory/setup is heavy.

### Rationals

**Pros:** exact fractions, no rounding ever. **Cons:** denominator blow-up; every op carries a GCD; rarely the right default.

### Decimal floating point (IEEE 754-2008)

**Pros:** exact decimals at fixed width and high speed (hardware on some platforms). **Cons:** bounded precision (can still round/overflow); limited language/hardware support.

---

## Use Cases

- **Cryptography:** RSA/DH/ECC need fast, constant-time bignum modular arithmetic over hundreds–thousands of bits.
- **Computer algebra / symbolic math:** exact integers and rationals (SageMath, Mathematica, GMP underneath).
- **Arbitrary-precision constants:** computing π, e to billions of digits (FFT multiplication).
- **High-precision finance/scientific:** `decimal128` or `BigDecimal` where 16–34 exact decimal digits are required.
- **Exact computational geometry:** rationals/bignums to avoid floating-point predicate failures (orientation, in-circle tests).

---

## Coding Patterns

**Pattern 1 — "Trust the library's cascade; don't hand-roll multiply."** GMP/`BigInteger`/`math/big` already pick schoolbook/Karatsuba/Toom/FFT optimally. Reimplement only to *learn*.

**Pattern 2 — "Keep operands small with modular reduction."** In crypto and number theory, reduce mod `m` early and often so values stay bounded; use Montgomery/Barrett for the hot loop.

**Pattern 3 — "Reuse receivers in mutable-bignum languages."** In Go, write into a destination `big.Int`; in Java, batch operations or use primitive paths when values fit a `long`.

**Pattern 4 — "Bound or avoid rationals."** Prefer fixed-scale decimals unless exact fractions are essential; if you must use rationals, cap denominators or periodically convert.

**Pattern 5 — "Use constant-time primitives for secrets."** Reach for vetted crypto libraries (`crypto/internal`, BoringSSL, libsodium), not generic bignum ops, on secret-dependent paths.

---

## Best Practices

1. **Re-analyze complexity assuming non-O(1) arithmetic** whenever numbers can exceed one machine word.
2. **Profile the actual operand-size distribution.** A library tuned for huge numbers may be slow for your "merely large" ones, and vice versa.
3. **Minimize allocations in bignum loops** (mutable receivers, buffer reuse, primitive fast paths).
4. **Never write your own modular exponentiation for production crypto.** Use audited, constant-time libraries.
5. **Prefer decimals over rationals** for money/measurement; reserve rationals for genuine exactness needs with bounded denominators.
6. **Choose decimal FP (`decimal128`) when you need bounded, exact decimal at speed** and your platform supports it.
7. **Watch for hidden bignums in "dynamic" languages.** Python/JS BigInt semantics can turn a simple loop quadratic without warning.

---

## Edge Cases & Pitfalls

- **O(n²) creep from growing operands:** factorials, products, Fibonacci, harmonic sums. The numbers, not the loop count, dominate.
- **Allocation storms:** immutable `BigInteger`/`big.Int` in tight loops thrash the allocator and GC.
- **Crossover misfires:** if most of your inputs sit just below a library threshold, you pay the slower algorithm; conversely, hand-tuned thresholds can regress after a library upgrade.
- **Timing side channels:** secret-dependent branches or variable-time multiplies leak key bits; even cache access patterns can leak. This is a *correctness* failure for crypto.
- **Rational denominator explosion:** exact fraction loops silently balloon memory and time; a "fast exact" approach becomes the slowest path.
- **Decimal FP overflow/rounding:** `decimal64`/`decimal128` are *fixed* width — they still round and can overflow, unlike `BigDecimal`.
- **Base conversion cost:** converting a huge bignum to/from a decimal string is *itself* super-linear (each division by 10 is O(n)); printing a million-digit number naively is slow. Libraries use divide-and-conquer base conversion.
- **`big.Float` is not decimal-exact:** Go's `big.Float` is arbitrary-precision *binary* floating point — it still can't represent 0.1 exactly. Use `big.Rat` or a decimal library for exact base-10.

---

## Summary

- A bignum is an array of **limbs** in base `2^64`; add/sub are O(n), and the action is in multiply/divide.
- Multiplication is a **cascade**: schoolbook (O(n²), small n) → Karatsuba (O(n^1.585)) → Toom-Cook (≈O(n^1.465)) → FFT (O(n log n)-ish, astronomical n). Libraries switch at tuned thresholds.
- The cost model that matters: **bignum arithmetic is not O(1)** — re-derive your algorithm's complexity accordingly, or it silently goes quadratic.
- **Rationals** are exact but their denominators blow up; **decimal floating point** is exact-for-decimals at bounded width; **`big.Float` is binary**, not decimal-exact.
- In crypto, **constant-time** behavior is mandatory — secret-dependent timing is a leak, not a micro-optimization.

---

## Further Reading

- *The Art of Computer Programming, Vol. 2: Seminumerical Algorithms* (Knuth) — classical multiplication, division, and base conversion.
- Brent & Zimmermann, *Modern Computer Arithmetic* — the definitive modern treatment (limbs, Karatsuba, Toom, FFT, division).
- The GMP manual — real-world algorithm thresholds and implementation notes.
- Harvey & van der Hoeven (2019), *Integer multiplication in time O(n log n)*.
- Montgomery (1985) and Barrett (1986) on modular reduction; any RSA/ECC implementation guide for constant-time concerns.
- Next: `professional.md` for production money and crypto systems built on these foundations.
