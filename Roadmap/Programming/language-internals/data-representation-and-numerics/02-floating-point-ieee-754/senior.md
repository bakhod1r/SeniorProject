# Floating-Point (IEEE 754) — Senior Level

> **Topic:** [Floating-Point (IEEE 754)](README.md)
> **Focus:** Below the language — fused multiply-add, x87 80-bit extended precision and `FLT_EVAL_METHOD`, the real cost of `-ffast-math`, deterministic FP across platforms, NaN payloads and signaling NaNs, decimal floating point, and the print/parse round-trip (Grisu/Ryū).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Trade-offs](#trade-offs)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)
20. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> 🎓 At middle level you learned ULPs, cancellation, and how to compare floats correctly. At senior level you confront the gap between the *standard* and the *machine*: the same `a*b + c` may be computed with one rounding or two depending on whether the compiler emitted an FMA; the same expression may carry 64 bits of mantissa on SSE and 64 bits *of integer* — really 80-bit floats — on a 1999 x87 FPU; the same binary, recompiled with `-ffast-math`, may quietly stop being IEEE 754 at all. Your job at this level is to know exactly which guarantees survive each layer.

IEEE 754 is a *correctly-rounded* specification: each of the basic operations (`+`, `−`, `×`, `÷`, `sqrt`, FMA) must return the exactly-rounded result as if computed with infinite precision and then rounded once. That is a strong, beautiful guarantee — and almost every way real systems violate "FP determinism" is a violation of *when* and *how many times* that rounding happens, not of the rounding itself. Extended precision evaluates intermediates wider than the destination. FMA rounds once instead of twice. Fast-math lets the compiler pretend FP is associative. Different `libm` implementations round transcendental functions (`sin`, `exp`) differently because the standard does *not* require those to be correctly rounded.

This level is the reconciliation: the standard's promises, the hardware's reality, and the engineering discipline that gets you reproducible, correct numerics across compilers and CPUs. We will also cover the **print/parse round-trip** — the surprisingly deep problem of converting a binary64 to the shortest decimal string that reads back identically (Steele & White, Grisu, Ryū) — and **decimal floating point** (IEEE 754-2008), the format that actually exists for money.

The next level (`professional.md`) takes all of this into production: the war stories (Patriot, Ariane 5, Vancouver), perf tuning, and debugging numerical drift in live systems.

---

## Prerequisites

- The [middle](middle.md) level: ULP, epsilon, rounding modes, cancellation, non-associativity, correct comparison.
- Comfort reading x86-64 / ARM assembly: recognizing `mulsd`, `addsd`, `vfmadd231sd`, `fld`/`fmul` (x87).
- Familiarity with at least one compiler's optimization flags (`-O2`, `-ffast-math`, `-mfma`, `/fp:`).
- An idea of what a `libm` is and that `sin`/`cos`/`exp` are *library*, not hardware-mandated, on most platforms.

## Glossary

| Term | Meaning |
|------|---------|
| **Correctly rounded** | The result equals the infinitely-precise result rounded once to the destination format. Required for `+−×÷√` and FMA, *not* for transcendentals. |
| **FMA (fused multiply-add)** | `a*b + c` computed with a **single** rounding of the full-width product-plus-sum. More accurate than separate `*` then `+`. |
| **x87** | The legacy x86 floating-point stack unit. Computes internally in **80-bit extended precision** regardless of operand type. |
| **Extended precision (binary80)** | 64-bit mantissa, 15-bit exponent, *explicit* leading bit. The x87 internal format. |
| **`FLT_EVAL_METHOD`** | C macro stating how much precision intermediate results carry: 0 = to type, 1 = double, 2 = long double (x87). |
| **`-ffast-math`** | GCC/Clang umbrella flag that relaxes IEEE compliance (assumes no NaN/Inf, allows reassociation, flushes subnormals, etc.). |
| **Reassociation** | Compiler rewriting `(a+b)+c` as `a+(b+c)` — illegal under strict IEEE, allowed under fast-math. |
| **FTZ / DAZ** | Flush-To-Zero (subnormal *results* → 0) and Denormals-Are-Zero (subnormal *inputs* → 0). MXCSR control bits. |
| **Quiet NaN (qNaN)** | A NaN that propagates silently through arithmetic. Top mantissa bit = 1. |
| **Signaling NaN (sNaN)** | A NaN that raises an invalid-operation exception when used. Top mantissa bit = 0 (with nonzero remaining payload). |
| **NaN payload** | The remaining mantissa bits of a NaN — can carry diagnostic information; mostly unused in practice. |
| **decimal64 / decimal128** | IEEE 754-2008 *decimal* floating-point formats (base 10), for exact decimal fractions. |
| **Densely Packed Decimal (DPD) / BID** | Two encodings of decimal significands (IBM's DPD vs Intel's Binary Integer Decimal). |
| **Shortest round-trip** | The shortest decimal string that parses back to the exact same binary float. |
| **Grisu / Ryū** | Modern fast algorithms producing the shortest round-trippable decimal. Ryū (2018) is the current state of the art. |

## Core Concepts

### 1. Correctly-rounded operations vs library functions

IEEE 754 mandates **correct rounding** for `+`, `−`, `×`, `÷`, `√`, remainder, and FMA: the answer is the true mathematical result rounded once. This is why `+−×÷√` are *portable* — every conforming machine gives bit-identical results for them.

It does **not** require correct rounding for transcendentals (`sin`, `cos`, `exp`, `log`, `pow`). The reason is the **Table Maker's Dilemma**: to round `sin(x)` correctly you may need to compute it to arbitrarily many extra digits to resolve a near-tie, and nobody can bound how many. So `libm` implementations settle for "faithfully rounded" (within 1 ULP) and *differ across platforms*. glibc's `sin`, macOS's `sin`, and MSVC's `sin` can disagree in the last bit. **This is the single biggest source of cross-platform FP non-determinism in real code**, and it is not a bug in any of them.

### 2. Fused multiply-add (FMA)

`fma(a, b, c)` computes `a*b + c` with the full-precision product, adding `c`, and rounding **once**. A naive `a*b + c` rounds twice (once after the multiply, once after the add). Consequences:

- FMA is **more accurate** — it's the foundation of accurate dot products, polynomial evaluation (Horner's method), and Newton iterations.
- FMA **changes results**. Code compiled with `-mfma` produces different bits than without it. `a*a - b*b` via two FMAs can even yield a *different sign* near zero than the separated form.
- FMA enables exact error extraction: `err = fma(a, b, -(a*b))` gives the exact rounding error of `a*b` — the building block of double-double arithmetic and TwoProduct.
- The C standard lets the compiler **contract** `a*b+c` into an FMA at its discretion unless you set `#pragma STDC FP_CONTRACT OFF`. So "the same source" silently rounds differently depending on `-ffp-contract`.

### 3. x87 extended precision and `FLT_EVAL_METHOD`

The original x86 FPU (x87) has an 80-bit internal stack. When you compute `double x = a*b + c` on x87, the intermediate `a*b` is held in **80-bit precision**, not 64-bit, until it's stored back to memory as a `double`. This causes the infamous **"works in debug, breaks in release"** and **"the value changes when I print it"** bugs: a value living in an 80-bit register compares unequal to the same value after being spilled to a 64-bit memory slot.

`FLT_EVAL_METHOD` tells you the regime:
- `0` — intermediates evaluated to their type (SSE2 default on x86-64). Clean and portable.
- `1` — `float` intermediates promoted to `double`.
- `2` — everything in `long double` / 80-bit (classic 32-bit x87).

Modern x86-64 uses **SSE2** scalar instructions (`FLT_EVAL_METHOD == 0`) by default, which killed most of the 80-bit surprises. But 32-bit x86 targets, `long double`, and `-mfpmath=387` resurrect them. The lesson: on x87, an expression's value depends on *register allocation* — a property the language standard does not control.

### 4. `-ffast-math`: what you actually give up

`-ffast-math` (GCC/Clang) is a bundle. Each sub-flag trades a guarantee for speed:

- `-fno-signaling-nans`, `-ffinite-math-only` — **assume no NaN or Inf exist.** Now `x == x` may be optimized to `true` even when `x` is NaN; `isnan(x)` can be folded to `false`. Your NaN checks *stop working*.
- `-fassociative-math` — **allow reassociation.** `(a+b)+c → a+(b+c)`, vectorized reductions, Kahan summation gets *optimized away* (the compiler "simplifies" the compensation to zero).
- `-freciprocal-math` — replace `x/y` with `x * (1/y)`, losing a rounding.
- `-fno-trapping-math`, `-funsafe-math-optimizations` — assume no FP exceptions.
- Flush subnormals to zero.
- It also sets `-fno-honor-nans` in a way that can change `min`/`max` semantics.

The danger is that fast-math is **not local** — linking a fast-math object can set the FTZ/DAZ MXCSR bits process-wide (notoriously, some libraries' static initializers do this), changing the behavior of code that never opted in. **Rule: never put `-ffast-math` on a whole project.** Apply `-ffp-contract=fast` and targeted `__attribute__((optimize))` to the hot kernels you've validated, and keep the rest strict.

### 5. Deterministic floating point across platforms

"Bit-identical results everywhere" is achievable but requires discipline, because every layer above conspires against it:

- **Compiler:** disable FMA contraction (`-ffp-contract=off`), forbid reassociation (don't use fast-math), pin the rounding mode.
- **Hardware:** force SSE2 (not x87), set consistent FTZ/DAZ, beware that `sqrt` is correctly rounded but `rsqrt`/`recip` *approximations* (`vrsqrtps`) are not — and differ across vendors.
- **Library:** the killer. You cannot rely on `sin`/`exp` matching across platforms. For determinism you must **ship your own** correctly-rounded or fixed implementations (e.g., a vendored polynomial, `crlibm`, or SLEEF in a pinned mode).
- **Language runtime:** Java's `strictfp` (pre-Java 17 it was opt-in; Java 17 made *all* FP strict by default) guaranteed reproducibility at a small speed cost. Most languages have no such mode.

Games (lockstep multiplayer), blockchains (consensus on computed values), and scientific reproducibility all hit this. The pragmatic answer is often "avoid floats in the consensus path" — use integers/fixed-point for anything that must agree bit-for-bit across nodes.

### 6. NaN: quiet vs signaling, payloads, propagation

All NaNs share `exponent = all-ones, fraction ≠ 0`. The **top fraction bit** distinguishes them:

- **Quiet NaN (qNaN):** top fraction bit = 1. Propagates silently: any operation with a qNaN yields a qNaN. This is the NaN you normally see.
- **Signaling NaN (sNaN):** top fraction bit = 0 (rest nonzero). Using it in arithmetic raises the **invalid-operation** exception; if unmasked, it traps. Intended to flag uninitialized memory. Rarely used because most languages can't even produce one without bit tricks, and loading an sNaN into a register often quiets it.

The remaining **payload** bits can carry diagnostic data (which operation produced this NaN), but the standard barely constrains propagation of payloads, and most hardware just picks one of the input NaNs (or a canonical qNaN). Don't rely on payloads in portable code.

Practical NaN facts a senior must own: `NaN != NaN` (so `x != x` ⇔ `isnan(x)`); `min(NaN, 5)` is **platform-dependent** in older specs (IEEE 754-2008 `minNum` returns the non-NaN operand; 754-2019 changed this — `fmin`/`fmax` vs `min`/`max` differ); sorting arrays with NaN can violate the comparator's total-order contract and corrupt the sort (Java's `Arrays.sort` handles it via total-order bits, but a raw `<` comparator does not).

### 7. Decimal floating point (IEEE 754-2008)

Binary floating point cannot represent `0.10` exactly. IEEE 754-2008 added **decimal** formats — `decimal32`, `decimal64`, `decimal128` — where the significand is a *decimal* integer and the exponent is a power of 10. Now `0.1` is exact. These power:

- IBM POWER and z/Architecture mainframes (hardware decimal FP — banking runs on them).
- Java's `BigDecimal` (software, arbitrary precision), C#'s `decimal` (128-bit, 28-29 digits), Python's `decimal.Decimal`.
- The C `_Decimal64` type (GCC extension).

Two competing significand encodings exist: **DPD** (Densely Packed Decimal, IBM, packs 3 digits into 10 bits) and **BID** (Binary Integer Decimal, Intel, stores the significand as a plain binary integer). They represent the same values but with different bit patterns; libraries pick one. For money, decimal FP or scaled integers are the correct tools — binary FP never is.

### 8. The print/parse round-trip problem

Converting binary64 → decimal string → binary64 must round-trip: you should get the *same* double back. Two sub-problems:

- **Shortest representation:** there are infinitely many decimal strings that round to a given double; you want the *shortest* one that's unambiguous (`0.1`, not `0.1000000000000000055`). This is the Steele & White "Dragon4" problem (1990). Modern algorithms: **Grisu** (Loitsch, 2010) — fast but occasionally falls back to a slow path — and **Ryū** (Adams, 2018) — always fast, always shortest, now used in Java, Rust, and many stdlibs. Go uses a Grisu-derived shortest algorithm in `strconv`.
- **Correct parsing:** `strtod`/`ParseFloat` must return the correctly-rounded double nearest the decimal. This is harder than it looks (Clinger 1990; the "Eisel-Lemire" fast parser, 2020, made it both fast and correct).

The practical knobs: `%.17g` always round-trips a double (17 significant decimal digits suffice for binary64; `9` for binary32), but it's *not shortest* — it prints `0.30000000000000004`. The shortest-round-trip printer prints `0.1` for `0.1`. Know which your language's default uses: Python `repr`, Go `%v`, Rust `{}`, modern JS all print shortest-round-trip; C `printf("%g")` does not.

### 9. The fast inverse square root, as a cultural artifact

The Quake III `0x5f3759df` trick computes `1/sqrt(x)` by reinterpreting the float bits as an integer, doing `i = 0x5f3759df - (i >> 1)`, reinterpreting back, and running one Newton-Raphson step. It works because **the exponent field of an IEEE 754 float is (almost) the base-2 logarithm of the number**, so an integer right-shift halves the log → square roots, and the subtraction implements the `-1/2` of the inverse-sqrt exponent plus a bias correction. The magic constant restores the bias and minimizes the linear approximation error.

Its real lesson for a senior is not the constant — modern CPUs have `rsqrtss` that's faster and the trick is obsolete — but the **insight that a float's bit pattern, read as an integer, is a piecewise-linear approximation of its logarithm.** That same insight powers ULP comparison (middle level), `frexp`/`ldexp`, and fast `log2` estimates. The number `0x5f3759df` is a museum piece; the bit-pattern-as-log intuition is permanent.

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| FMA single rounding | Measuring a board once at full length vs cutting it, measuring the offcut separately, and adding — fewer roundings, less error. |
| x87 80-bit intermediates | Doing arithmetic on a high-precision lab scale, then transcribing to a kitchen scale; the transcription is where the value "changes." |
| Correctly rounded vs faithfully rounded | A GPS that's always exactly right (×÷√) vs one that's within a meter (`sin`/`exp`) — and different brands disagree by that meter. |
| `-ffast-math` | Removing the speed limiter *and* the seatbelts: faster, until the one corner where you needed them. |
| Quiet vs signaling NaN | A silent error that spreads through your spreadsheet (qNaN) vs an alarm that goes off the moment you touch the bad cell (sNaN). |
| Decimal floating point | An abacus (base-10 beads) vs a binary ruler — the abacus represents `0.10` exactly. |
| Shortest round-trip printing | Writing the *shortest* address that still gets the letter to the right house. |
| Bit-pattern-as-log (fast invsqrt) | The Richter scale: the exponent of a number is already a logarithm, so halving it is a shift, not a divide. |

## Mental Models

### "Count the roundings"

Every IEEE operation rounds exactly once. To reason about an expression's accuracy *and* its portability, count where the roundings happen. `a*b + c` is two roundings; `fma(a,b,c)` is one. The compiler may turn the former into the latter — so the *number of roundings is a compiler decision* unless you pin `FP_CONTRACT`. Determinism = controlling the rounding count and the rounding mode at every step.

### "The standard is a contract with holes"

IEEE 754 guarantees `+−×÷√`/FMA bit-for-bit. It guarantees NaN/Inf *behavior*. It does **not** guarantee transcendentals, does not forbid extended-precision intermediates (it permits them), and does not stop your compiler from reassociating under fast-math. Map every "FP gives different answers on machine X" complaint onto one of these holes; it's never magic.

### "Float bits, read as an int, are a logarithm"

A positive float `v = 2^e × 1.f`. Its bit pattern (exponent then fraction) read as an unsigned integer is approximately `(e + bias + f) × 2^52` — a *linear function of log2(v)*. This single fact explains ULP-distance comparison, fast inverse sqrt, `frexp`, and why incrementing a float's bit pattern by 1 moves to the next representable value (one ULP). Keep this isomorphism in your head; it unlocks a dozen tricks.

## Code Examples

### FMA changes the answer

```c
#include <stdio.h>
#include <math.h>
int main(void) {
    double a = 1.0 + 0x1p-27;   // 1 + 2^-27
    double b = 1.0 - 0x1p-27;
    // a*b = 1 - 2^-54 exactly; but rounding a*b to double gives exactly 1.0
    double sep  = a*b - 1.0;          // -> 0.0  (a*b rounded to 1.0 first)
    double fused = fma(a, b, -1.0);   // -> -2^-54  (single rounding keeps it)
    printf("separate: %.20g\n", sep);    // 0
    printf("fused:    %.20g\n", fused);  // -5.5511151231257827021e-17
    return 0;
}
```

`fma` recovers the exact `-2^-54`; the separated form lost it to double rounding. This is why `fma(a,b,-(a*b))` extracts the exact product error.

### x87 vs SSE: the value that changes when stored

```c
// Compile 32-bit with -mfpmath=387 to observe; on x86-64 SSE this is clean.
#include <stdio.h>
int main(void) {
    volatile double x = 0.1 + 0.2;   // volatile forces a store to 64-bit memory
    double y = 0.1 + 0.2;            // may stay in an 80-bit x87 register
    printf("x == y ? %d\n", x == y); // can print 0 under x87! same source, different precision
    return 0;
}
```

The `volatile` store rounds to 64 bits; the register-held `y` may carry 80. They compare unequal — the textbook "it changes when I print it" bug.

### Reassociation under fast-math kills Kahan summation

```c
// gcc -O2            -> Kahan works
// gcc -O2 -ffast-math -> compiler "simplifies" comp to 0, accuracy lost
double kahan(const double *v, int n) {
    double sum = 0.0, comp = 0.0;
    for (int i = 0; i < n; i++) {
        double y = v[i] - comp;
        double t = sum + y;
        comp = (t - sum) - y;   // -ffast-math reassociates this to 0!
        sum = t;
    }
    return sum;
}
```

`-fassociative-math` proves `(t - sum) - y == (sum + y - sum) - y == 0` algebraically and deletes the compensation. The defense: isolate this function from fast-math, or use `volatile` on `comp`/`t`.

### Detecting NaN survives only without `-ffinite-math-only`

```c
#include <math.h>
int has_nan(const double *v, int n) {
    for (int i = 0; i < n; i++)
        if (v[i] != v[i]) return 1;   // -ffinite-math-only folds this to 'return 0'
    return 0;
}
```

### Quiet vs signaling NaN bit patterns

```python
import struct
def make_nan(signaling: bool, payload: int = 1):
    # exponent all ones; top fraction bit = quiet flag
    frac = payload & ((1 << 51) - 1)
    quiet_bit = 0 if signaling else (1 << 51)
    bits = (0x7FF << 52) | quiet_bit | (frac or 1)
    return struct.unpack('>d', struct.pack('>Q', bits))[0]

qnan = make_nan(signaling=False)
print(qnan, qnan != qnan)   # nan True
# Note: most CPUs quiet an sNaN on load; producing a *persistent* sNaN in pure
# Python is essentially impossible — this is why sNaNs are rare in practice.
```

### Decimal floating point for money

```python
from decimal import Decimal, getcontext, ROUND_HALF_EVEN
getcontext().rounding = ROUND_HALF_EVEN
price = Decimal('0.10')
total = sum((price for _ in range(10)), Decimal('0'))
print(total)            # 1.00  exactly — base-10 significand, no binary error
print(Decimal('0.1') + Decimal('0.2') == Decimal('0.3'))  # True
```

```java
import java.math.BigDecimal;
import java.math.RoundingMode;
BigDecimal price = new BigDecimal("0.10");
BigDecimal total = price.multiply(new BigDecimal(10));
System.out.println(total.setScale(2, RoundingMode.HALF_EVEN)); // 1.00
```

### Shortest round-trip vs 17-digit printing

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    x := 0.1 + 0.2
    fmt.Println(x)                                  // 0.30000000000000004 (shortest that round-trips)
    fmt.Println(strconv.FormatFloat(x, 'g', -1, 64)) // same: -1 precision = shortest (Ryū-like)
    fmt.Println(strconv.FormatFloat(x, 'g', 17, 64)) // 0.30000000000000004 (forced 17 digits)
    fmt.Println(0.1)                                // 0.1  ← shortest, not 0.1000000000000000055
}
```

## Trade-offs

| You gain... | ...at the cost of... |
|-------------|----------------------|
| FMA accuracy + speed | Different bits than non-FMA; breaks bit-reproducibility |
| x87 80-bit intermediates | Value depends on register allocation; non-portable |
| `-ffast-math` throughput (often 2-4×) | NaN/Inf checks break, Kahan deleted, subnormals flushed, non-IEEE |
| FTZ/DAZ (no subnormal stalls) | Gradual underflow lost; tiny values snap to 0 |
| Decimal FP exactness for money | Slower, larger, software-emulated off mainframes |
| Bit-deterministic FP across nodes | Must vendor your own libm and disable FMA/reassoc — big effort |
| Shortest round-trip printing (Ryū) | More complex than `%.17g`; historically slower (Ryū fixed that) |

## Use Cases

- **Accurate dot products / polynomial eval / Newton iteration** → FMA, error-free transforms (TwoSum/TwoProduct).
- **Lockstep multiplayer games, blockchains, reproducible science** → deterministic FP (no FMA contraction, no fast-math, vendored math, or integers in the consensus path).
- **DSP / audio / dense linear algebra hot loops** → FTZ/DAZ to avoid subnormal stalls, validated `-ffp-contract=fast`.
- **Money, billing, tax** → decimal FP or scaled integers — *never* binary FP.
- **Serialization / config / logging** → shortest round-trip printing so values reload identically.
- **High-perf math kernels** → SLEEF/SVML vectorized transcendentals, accepting their ULP error budget.

## Coding Patterns

### 1. Error-free transforms (TwoSum / TwoProduct)

```c
// exact sum: s = round(a+b), e = the exact rounding error, so a+b == s+e exactly
void two_sum(double a, double b, double *s, double *e) {
    *s = a + b;
    double bb = *s - a;
    *e = (a - (*s - bb)) + (b - bb);
}
// exact product via FMA:
void two_product(double a, double b, double *p, double *e) {
    *p = a * b;
    *e = fma(a, b, -*p);   // requires hardware FMA
}
```

These are the atoms of double-double / compensated arithmetic.

### 2. Pin the floating-point environment for determinism

```c
#pragma STDC FP_CONTRACT OFF        // forbid implicit FMA contraction
// build flags: -ffp-contract=off -fno-fast-math -msse2 (not -mfpmath=387)
#include <fenv.h>
fesetround(FE_TONEAREST);           // explicit default rounding
```

### 3. Quarantine fast-math to validated kernels

```c
// Only this function is fast; the rest of the TU stays strict.
__attribute__((optimize("fast-math")))
double hot_kernel(const float *a, const float *b, int n) { /* ... */ }
```

Never `-ffast-math` globally; never let it touch NaN checks or Kahan loops.

### 4. Java strictfp for reproducibility (pre-17)

```java
public strictfp class Deterministic {   // Java 17+: all FP is strict by default
    static double f(double x) { return x * x + x; }
}
```

### 5. Decimal/scaled-integer money types

```python
# scaled-integer money: store minor units (cents), do exact integer math,
# format only at the boundary. Decimal when you need division/percentages.
from decimal import Decimal
def tax(amount: Decimal, rate: Decimal) -> Decimal:
    return (amount * rate).quantize(Decimal('0.01'))  # explicit rounding step
```

## Best Practices

- **Decide your FP contract per module:** strict-and-portable, or fast-and-local. Document it. Never let fast-math leak project-wide.
- **Set `-ffp-contract` explicitly.** Don't let "did I get an FMA?" be implicit — it changes results.
- **Never rely on transcendental functions matching across platforms.** If you need that, vendor the implementation or use integers.
- **On x86, ensure SSE2, not x87.** Avoid `long double` if you need portability; it's 80-bit on x86, 64-bit on MSVC, 128-bit on some ARM.
- **For money, use decimal or scaled integers. Always.** Pick the rounding mode explicitly (usually HALF_EVEN, or HALF_UP for regulatory rounding).
- **Use shortest-round-trip printing for persistence**, `%.17g` only when you need guaranteed-but-verbose round-trip.
- **Use FMA-based error-free transforms** when you need extra precision without a bignum library.
- **Test numerics under the exact build flags you ship** — `-O2 -ffast-math` can pass tests that `-O0` fails, and vice versa.

## Edge Cases & Pitfalls

- **FMA flips the sign of `a*a - b*b` near `a ≈ b`** because it removes an intermediate rounding — surprising in geometry predicates.
- **Linking one fast-math object sets FTZ/DAZ process-wide** via a static initializer, silently changing unrelated subnormal behavior.
- **`long double` is a portability trap:** 80-bit (x86 Linux), 64-bit (MSVC, so identical to `double`), 128-bit (AArch64, IBM double-double on POWER). Same code, three precisions.
- **`min`/`max` with NaN are not portable across IEEE 754 revisions** — 2008's `minNum` returned the non-NaN; 2019 deprecated it for `minimum`/`maximumNumber`. C's `fmin` returns the non-NaN; `<` does not.
- **Sorting with a `<` comparator and NaN present** breaks total-order assumptions; Java throws `IllegalArgumentException` ("Comparison method violates its general contract") in some paths.
- **`0.0 == -0.0` but `1/0.0 != 1/-0.0`** — sign of zero survives through division and `atan2`, `copysign`, `signbit`.
- **`pow(x, 0.5)` is not always `sqrt(x)`** — `pow` is faithfully rounded, `sqrt` is correctly rounded; they can differ by a ULP.
- **Casting `double`→`float`→`double` is lossy and non-idempotent** for most values.
- **`printf("%g")` does not round-trip;** parsing its output can give a different double.

## Common Mistakes

1. **Global `-ffast-math`** that silently breaks NaN handling and Kahan summation somewhere far away.
2. **Assuming `sin`/`exp` are bit-identical across OSes** in a reproducibility-critical path.
3. **Using `long double` for "more precision"** without knowing it's just `double` on MSVC.
4. **Relying on FMA contraction being on (or off)** without setting `-ffp-contract`.
5. **Shipping binary floats for money** because "doubles have 15 digits, that's plenty."
6. **Comparing values that may live in 80-bit x87 registers** with `==` and getting flaky results.
7. **Trusting `%g`/`%f` to round-trip** for serialization.
8. **Flushing subnormals to zero** without realizing a static-init in a dependency already did it for you (or didn't).
9. **Writing a custom NaN-aware sort with a raw `<`** and corrupting the order.
10. **Believing IEEE 754 makes everything deterministic** — it makes `+−×÷√` deterministic; the rest is up to you.

## Tricky Points

- **Double rounding:** computing in 80-bit then storing to 64-bit can round *twice* and give a different result than a single direct 64-bit round (the "double-rounding" pathology). FMA and SSE avoid it; x87 reintroduces it.
- **`fma` without hardware support is slow** — softfloat `fma` can be 50× slower; check that your target actually has FMA before relying on it for speed.
- **Signaling NaNs rarely survive** — most loads/moves quiet them; `memcpy` preserves them, register moves may not.
- **Correctly-rounded `sqrt` but approximate `rsqrt`:** `vrsqrtps` gives ~12-bit accuracy; you must Newton-refine. Vendors' approximations differ → non-determinism.
- **`FLT_EVAL_METHOD == 2` makes `float` comparisons lie** — a `float` compared in `long double` precision passes a check it fails after assignment.
- **Java's pre-17 `strictfp`** only mattered on x87; on SSE2 it was already strict. Java 17 removed the distinction by making everything strict.
- **Decimal FP rounding has *more* modes** (round-half-up, round-half-even, round-ceiling…) and you must pick one explicitly; the default differs by library.
- **The shortest-round-trip string is not unique across formats:** a number printed shortest as a `double` may not be the shortest for the `float` that produced it.

## Test Yourself

1. Find a pair `(a, b)` where `fma(a, b, c)` and `a*b + c` differ, and explain via rounding count.
2. Compile a program at `-O2` and `-O2 -ffast-math`; show that a NaN check stops working under the latter. Inspect the assembly.
3. On a 32-bit x86 target with `-mfpmath=387`, reproduce a case where `volatile double x = expr; double y = expr; x != y`.
4. Use `fma(a, b, -(a*b))` to extract the exact rounding error of a product; verify `a*b == p + e` exactly.
5. Show `Decimal('0.1') + Decimal('0.2') == Decimal('0.3')` is `True` while the binary version is `False`. Explain the significand encoding.
6. Print `0.1` with your language's default printer and with `%.17g`. Explain why the defaults show `0.1`.
7. Construct a quiet NaN with a custom payload and show whether your platform preserves the payload through `+`.
8. Demonstrate that `min(NaN, 5.0)` differs between `fmin` (C) and a `<`-based min in your language.

## Cheat Sheet

```text
┌─────────────────────────────────────────────────────────────────────┐
│              FLOATING-POINT — SENIOR CHEAT SHEET                    │
├─────────────────────────────────────────────────────────────────────┤
│ Correctly rounded (portable, bit-identical):  + - * / sqrt FMA rem │
│ Faithfully rounded (NOT portable, ±1 ULP):    sin cos exp log pow  │
│   → cross-platform FP drift usually = libm transcendentals         │
├─────────────────────────────────────────────────────────────────────┤
│ FMA: a*b+c with ONE rounding. More accurate, DIFFERENT bits.       │
│   compiler may contract a*b+c → fma unless FP_CONTRACT OFF          │
│   fma(a,b,-(a*b)) = exact error of a*b  (error-free transform)      │
├─────────────────────────────────────────────────────────────────────┤
│ x87 = 80-bit intermediates. FLT_EVAL_METHOD: 0=type 1=double 2=80b │
│   "value changes when stored/printed" = double rounding on x87      │
│   x86-64 default = SSE2 = method 0 = clean                          │
├─────────────────────────────────────────────────────────────────────┤
│ -ffast-math BREAKS: NaN/Inf checks, Kahan (reassoc→0), subnormals  │
│   never global; quarantine to validated kernels                    │
├─────────────────────────────────────────────────────────────────────┤
│ NaN: exp=all-ones, frac≠0. qNaN top-frac=1 (silent),               │
│      sNaN top-frac=0 (traps). NaN!=NaN. payloads unreliable.       │
├─────────────────────────────────────────────────────────────────────┤
│ MONEY → decimal64/128 or scaled integers. NEVER binary float.      │
│ PRINT → shortest round-trip (Ryū/Grisu); %.17g = verbose but safe  │
│ DETERMINISM → no FMA contract, no fast-math, SSE2, vendored libm   │
└─────────────────────────────────────────────────────────────────────┘
```

## Summary

- IEEE 754 mandates **correct rounding** for `+−×÷√`/FMA — these are bit-portable. It does **not** mandate it for transcendentals, which is why `sin`/`exp` differ across platforms and cause most cross-platform FP drift.
- **FMA** rounds `a*b+c` once instead of twice: more accurate, but it *changes results*, and the compiler may insert it implicitly unless you set `FP_CONTRACT`/`-ffp-contract`.
- **x87 extended precision** evaluates intermediates in 80 bits, making values depend on register allocation (`FLT_EVAL_METHOD`); modern x86-64 defaults to clean SSE2.
- **`-ffast-math`** trades IEEE compliance for speed: it breaks NaN checks, deletes Kahan compensation via reassociation, and flushes subnormals — never apply it globally.
- **Deterministic FP** across machines requires disabling FMA contraction and fast-math, forcing SSE2, and *vendoring your own* transcendentals — or keeping integers in the consensus path.
- **NaN** comes in quiet (silent propagation) and signaling (traps) forms distinguished by the top fraction bit; payloads exist but aren't portable.
- **Decimal floating point** (754-2008) and scaled integers are the correct tools for money; binary FP never is.
- The **print/parse round-trip** (Grisu/Ryū for shortest output, Clinger/Eisel-Lemire for correct parsing) is why `0.1` prints as `0.1`; `%.17g` round-trips but verbosely.
- The **fast inverse square root** is obsolete code but encodes a permanent insight: a float's bits, read as an integer, approximate its base-2 logarithm.

## Further Reading

- IEEE 754-2019 standard — the authoritative source for formats, rounding, and special values.
- Jean-Michel Muller et al., *Handbook of Floating-Point Arithmetic*, 2nd ed. — the comprehensive modern reference (FMA, error-free transforms, table maker's dilemma).
- David Goldberg, *What Every Computer Scientist Should Know About Floating-Point Arithmetic* (with the Sun addendum on x87/extended precision).
- Ulf Adams, *Ryū: Fast Float-to-String Conversion*, PLDI 2018.
- Florian Loitsch, *Printing Floating-Point Numbers Quickly and Accurately with Integers* (Grisu), PLDI 2010.
- Daniel Lemire, *Number Parsing at a Gigabyte per Second* (Eisel-Lemire), 2021.
- Kahan, *Lecture Notes on the Status of IEEE 754* and *How Java's Floating-Point Hurts Everyone Everywhere*.
- Intel/AMD architecture manuals on MXCSR, FTZ/DAZ, FMA, and `rsqrt` accuracy.

## Related Topics

- This folder: [`junior.md`](junior.md), [`middle.md`](middle.md), [`professional.md`](professional.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling numerics topics: integer representation, fixed-point arithmetic, decimal/arbitrary-precision types, and number parsing/formatting in the parent section.

## Diagrams & Visual Aids

### Counting roundings: separate mul+add vs FMA

```text
   a*b + c   (separate)                 fma(a, b, c)
   ────────────────────                 ────────────
   t = round(a*b)   ← rounding #1       p = a*b      (full width, NOT rounded)
   r = round(t+c)   ← rounding #2       r = round(p + c)  ← single rounding
                                        ▲
   two roundings → more error           one rounding → tighter, but DIFFERENT bits
```

### x87 double-rounding

```text
   exact a*b ─► round to 80 bits ─► round to 64 bits   (x87: TWO roundings)
                     │                     │
                can differ from ───────────┘
   exact a*b ─► round to 64 bits directly              (SSE2: ONE rounding)

   The two paths can yield different doubles → "it changes when I store it"
```

### NaN bit layout (binary64)

```text
   ┌─┬───────────────┬─┬─────────────────────────────────────────────┐
   │S│ 111 1111 1111 │Q│            payload (50 bits)                 │
   └─┴───────────────┴─┴─────────────────────────────────────────────┘
      exponent all 1s  │
                       └─ Q=1 quiet (silent)   Q=0 signaling (traps)
   fraction must be nonzero (else it's Infinity, not NaN)
```

### Binary vs decimal floating point for 0.1

```text
   binary64(0.1)  = 0.1000000000000000055511151231257827...   (inexact)
                    └ nearest dot on a base-2 grid ┘

   decimal64(0.1) = significand 1 × 10^-1  = exactly 0.1
                    └ base-10 grid hits 0.1 on the nose ┘
```

### The print/parse round-trip

```text
   double d ──[shortest-round-trip printer: Ryū/Grisu]──► "0.1"
       ▲                                                    │
       └──────[correct parser: Clinger/Eisel-Lemire]◄───────┘
                must recover the EXACT same double d

   %.17g also round-trips but prints "0.30000000000000004" (verbose, not shortest)
```
