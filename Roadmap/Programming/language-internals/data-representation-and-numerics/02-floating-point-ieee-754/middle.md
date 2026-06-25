# Floating-Point (IEEE 754) — Middle Level

> **Topic:** [Floating-Point (IEEE 754)](README.md)
> **Focus:** The bit layout in detail, normalized vs subnormal numbers, rounding modes (and why the default is "round half to even"), machine epsilon and ULP, catastrophic cancellation, non-associativity, and how to compare floats *correctly*.

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
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)
19. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **You know floats are approximate. Now: *how* approximate, *which way* do they round, and *when* does a small error become a catastrophic one?**

At junior level "compare with a tolerance" was the whole lesson. That advice has a hidden flaw: **what tolerance?** A fixed `1e-9` is wrong for comparing two values near a billion (where the gap between adjacent doubles is bigger than `1e-9`) and wrong for comparing two values near `1e-30` (where it's enormous relative to the numbers). To choose tolerances correctly you need to understand the *spacing* of floating-point numbers — and that spacing has a name: the **ULP** (unit in the last place).

This level makes the model quantitative. We will pin down the exact bit fields, the meaning of all-zero and all-one exponents (which give you zero, subnormals, infinity, and NaN), the **four rounding modes** the standard defines and why "round half to even" (banker's rounding) is the default, **machine epsilon**, and the two error-amplifying phenomena every numerical programmer must recognize on sight: **catastrophic cancellation** (subtracting nearly-equal numbers) and **absorption** (adding a tiny number to a huge one). We will also confront the uncomfortable truth that floating-point addition is **not associative**: `(a + b) + c` can differ from `a + (b + c)`, which means the *order you sum a list* changes the answer.

In one sentence: **the gap between adjacent representable numbers is not constant, and almost every floating-point bug comes from forgetting that.**

The next level (`senior.md`) takes this into hardware: FMA, x87 80-bit extended precision, `-ffast-math`, and deterministic FP across platforms.

---

## Prerequisites

- The [junior](junior.md) level: bit layout sketch, `0.1 + 0.2`, NaN/Inf, signed zero, the golden rule.
- Comfort with binary and powers of 2.
- Basic algebra — you should be able to follow why `(a − b)` loses precision when `a ≈ b`.
- Some experience writing loops that accumulate sums.

You do **not** yet need: FMA semantics, x87 internals, compiler fast-math flags, or cross-platform determinism — those are `senior.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **binary32 / binary64** | The IEEE 754 names for 32-bit `float` and 64-bit `double`. |
| **Normalized number** | A number with the implicit leading 1: `1.fraction × 2^e`. The common case. |
| **Subnormal / denormal** | A number too small to normalize. The leading bit is 0, the exponent field is all-zeros. Fills the gap between the smallest normal number and zero. |
| **Significand / mantissa** | The fraction bits plus the implied leading bit. 53 effective bits for double. |
| **Bias** | Offset added to the true exponent: 127 (binary32), 1023 (binary64). |
| **ULP (unit in the last place)** | The distance between a float and the next representable float. The "grid spacing" at that magnitude. |
| **Machine epsilon (ε)** | The gap between 1.0 and the next representable number. `2^-52 ≈ 2.22e-16` for double, `2^-23 ≈ 1.19e-7` for float. |
| **Round to nearest, ties to even** | The default rounding mode. On an exact tie, round toward the value with an even last bit. Also called *banker's rounding*. |
| **Round toward zero / +∞ / −∞** | The three "directed" rounding modes (truncate, ceiling, floor). |
| **Catastrophic cancellation** | Loss of significant digits when subtracting two nearly-equal numbers. |
| **Absorption / swamping** | When adding a small number to a large one, the small one's bits fall off the end and are lost. |
| **Non-associativity** | `(a + b) + c ≠ a + (b + c)` in floating point. |
| **Kahan summation** | A compensated-summation algorithm that recovers lost low-order bits when summing many numbers. |
| **Monotonic representation** | The bit-pattern trick: interpreting positive floats as integers preserves ordering, enabling ULP distance. |

---

## Core Concepts

### 1. The exact bit layout, and what the exponent field encodes

For binary64, the 64 bits are: 1 sign `S`, 11 exponent bits `E` (as an unsigned integer 0–2047), and 52 fraction bits `F`. The **value** depends on `E`:

| `E` (raw) | Meaning | Value |
|-----------|---------|-------|
| `1` to `2046` | **Normalized** | `(-1)^S × 1.F × 2^(E - 1023)` |
| `0`, `F = 0` | **Zero** | `(-1)^S × 0` (so `+0` and `-0`) |
| `0`, `F ≠ 0` | **Subnormal** | `(-1)^S × 0.F × 2^(1 - 1023)` (note: no implicit 1, exponent fixed at the minimum) |
| `2047`, `F = 0` | **Infinity** | `(-1)^S × ∞` |
| `2047`, `F ≠ 0` | **NaN** | the fraction bits are the NaN "payload" |

The two reserved exponent values (`all-zeros` and `all-ones`) are what carve out the special cases. Everything else is a normal number.

### 2. Normalized vs subnormal (denormal) numbers

A normalized double's smallest positive value is `2^-1022 ≈ 2.2e-308`. What about numbers smaller than that but bigger than zero? Without a special case, there'd be a sudden gap — you'd jump from `2.2e-308` straight to `0`, a phenomenon called **underflow to zero**. IEEE 754 fills this gap with **subnormal numbers**: when the exponent field is all-zeros, the implicit leading bit becomes `0` instead of `1`, and the exponent is pinned at the minimum. This gives **gradual underflow** — as numbers shrink below `2^-1022`, they lose precision bit by bit instead of snapping to zero all at once. The smallest positive subnormal double is `2^-1074 ≈ 4.9e-324`.

The trade-off: subnormals are **slow** on many CPUs. Some hardware traps to microcode or even software to handle them, costing 100× the time of a normal operation. This is why high-performance code (audio DSP, ML) often enables **flush-to-zero (FTZ)** and **denormals-are-zero (DAZ)** modes — covered in `senior.md` — which sacrifice gradual underflow for speed.

### 3. ULP: the grid spacing of floating point

The key quantitative insight: **representable numbers are not evenly spaced.** They're spaced like `2^e × ε` — the gap doubles every time you cross a power of 2. The gap between a value and its nearest neighbor is one **ULP** (unit in the last place).

- Between `1.0` and `2.0`, the ULP is `2^-52 ≈ 2.2e-16`.
- Between `1024.0` and `2048.0`, the ULP is `2^-52 × 2^10 ≈ 2.3e-13` — a thousand times bigger.
- Between `2^52` and `2^53`, the ULP is exactly `1.0`. Above `2^53`, consecutive integers are no longer all representable.

This is why a fixed absolute tolerance is wrong: `1e-9` is far smaller than one ULP near a billion (you'd never find two "close" billion-sized values equal) and far larger than one ULP near `1e-15`.

### 4. Machine epsilon

**Machine epsilon (ε)** is the ULP at 1.0: the smallest number you can add to `1.0` and get something other than `1.0`. For double it is `2^-52 ≈ 2.220446049250313e-16`; for float it is `2^-23 ≈ 1.19e-7`. A useful interpretation: **ε is the relative rounding error of a single operation.** Any single correctly-rounded operation gives a result within `ε/2` (relative) of the true value. It's the building block for error analysis.

> Note: some languages (C++'s `numeric_limits::epsilon`, Python's `sys.float_info.epsilon`) define ε as exactly this `1.0`-to-next gap. Don't confuse it with "a small tolerance" — they're related but not the same.

### 5. Rounding modes, and why "round half to even"

When a result isn't representable, IEEE 754 must round it to a representable value. The standard defines four (plus one) rounding modes:

1. **Round to nearest, ties to even** — the **default**. Pick the nearest representable value; on an exact tie, pick the one whose last bit is `0` (even).
2. **Round to nearest, ties away from zero** — the "school" rounding (0.5 → 1).
3. **Round toward zero** (truncate).
4. **Round toward +∞** (ceiling).
5. **Round toward −∞** (floor).

Why is "ties to even" (banker's rounding) the default instead of the "round 0.5 up" you learned in school? Because rounding `0.5` always up introduces a **systematic bias**: across many roundings, results creep upward. Rounding ties to even has no such bias — half the ties round up, half round down, on average. For statistics, accounting, and long computations, removing that drift matters. `round(0.5)` gives `0`, `round(1.5)` gives `2`, `round(2.5)` gives `2` — surprising the first time, but bias-free. (This is also why Python 3's `round()` does ties-to-even and confuses people coming from Python 2.)

### 6. Catastrophic cancellation

The most important error mechanism to recognize: **subtracting two nearly-equal numbers destroys precision.** Suppose `a = 1.0000000123` and `b = 1.0000000001`, each known to ~10 significant digits. Their difference is `0.0000000122` — but the *leading* significant digits cancelled, and you're left with only a couple of meaningful digits; the rest of the result is rounding noise from the original approximations. The relative error in the difference can be enormous even though both inputs were accurate.

Classic victims:
- The quadratic formula `(-b ± sqrt(b² - 4ac)) / 2a` when `b² ≫ 4ac`: `-b + sqrt(b²-...)` cancels.
- Computing variance as `E[x²] - E[x]²` (the "naive" formula) — both terms can be huge and nearly equal.
- `1 - cos(x)` for small `x`.

The cure is *algebraic reformulation* to avoid the subtraction — e.g., rationalizing the quadratic formula, or using Welford's online algorithm for variance.

### 7. Absorption (swamping / loss of significance)

The mirror image: **adding a small number to a much larger one loses the small number entirely.** `1e16 + 1.0 == 1e16` in double, because `1.0` is smaller than one ULP at `1e16` — it falls off the bottom of the significand. This is why summing a large array of small numbers into a growing accumulator loses accuracy: late additions get "swamped" by the large running total. Kahan summation (below) fixes this.

### 8. Non-associativity: order changes the answer

Because every operation rounds, **floating-point addition and multiplication are not associative**:

```text
(1e16 + 1.0) - 1e16   →  0.0      (the 1.0 was absorbed, then subtracted away)
1e16 + (1.0 - 1e16)   →  ... different
```

A more practical statement: **summing the same list in a different order gives a different result.** This has real consequences:

- Parallel reductions (sum an array across threads) are non-deterministic in the low bits, because the combination order depends on scheduling.
- Compilers under `-ffast-math` (see `senior.md`) reorder sums and change results.
- "Sort smallest-magnitude-first" gives a more accurate sum than a random order, because it delays absorption.

### 9. Comparing floats correctly: absolute, relative, ULP

The junior advice "use a tolerance" needs three refinements:

- **Absolute tolerance**: `abs(a - b) < atol`. Correct only when you know the *scale* of the numbers and they're near a known magnitude (e.g., comparing to 0 within `1e-12`). Wrong across scales.
- **Relative tolerance**: `abs(a - b) <= rtol * max(abs(a), abs(b))`. Scale-independent — works for tiny and huge numbers. But it fails near zero (relative error explodes when both are ~0).
- **Combined**: `abs(a - b) <= max(atol, rtol * max(abs(a), abs(b)))`. This is what Python's `math.isclose` and NumPy's `allclose` do. The `atol` term saves you near zero; the `rtol` term saves you everywhere else.
- **ULP-based**: reinterpret the float bits as integers and compare the integer distance. `2` ULPs means "at most two representable values apart." The most precise notion of "almost equal," used in numerical libraries and test frameworks. Caveat: handle signs and NaN specially.

There is no universal tolerance. The right one depends on how the numbers were computed and how much error the algorithm accumulated.

---

## Real-World Analogies

| Concept | Real-world analogy |
|---------|--------------------|
| ULP grid spacing | A ruler whose tick marks get coarser as you move right: millimeters near 0, then centimeters, then meters. |
| Machine epsilon | The smallest bump you can detect on that ruler right at the "1" mark. |
| Subnormal numbers | The fine extra tick marks crammed in just before zero so you don't fall off a cliff to nothing. |
| Round half to even | A fair coin for ties — half up, half down — so a long sequence of rounds doesn't drift. |
| Catastrophic cancellation | Two tall buildings of nearly equal height; measuring the *difference* in their heights, your tape measure error now dominates. |
| Absorption | Pouring a teaspoon of water into a swimming pool and trying to measure the level rise. |
| Non-associativity | Splitting a restaurant bill: rounding each share separately vs rounding the total gives different cents. |
| Kahan summation | Keeping a running note of the pennies you dropped, and adding them back later. |

---

## Mental Models

### "The grid gets coarser as you go right"

Picture the positive number line tiled with a grid. Near `1.0` the cells are `2.2e-16` wide. Each time you double the magnitude, the cells double in width. By `2^53` each cell is `1.0` wide — integers stop being exactly representable. *Every* arithmetic result snaps to a grid cell. The width of the local cell *is* one ULP, and it's the natural unit for "how close is close." Carrying this picture, you instantly know that "tolerance `1e-9`" is meaningless without knowing *where* on the line you are.

### "Error has a budget, and ε is the unit"

Each correctly-rounded operation injects at most `ε/2` relative error. Chain `N` operations and (worst case) the error can grow like `N × ε`, or in well-conditioned problems like `sqrt(N) × ε`. Think of every computation as *spending* an error budget. Cancellation is a *withdrawal of significant digits*; it can blow your whole budget in one subtraction. This framing tells you *where* to be careful: not everywhere, but at the cancellations and the long sums.

### "Subtraction reveals the lie"

Floats lie about their low-order bits — those are rounding noise. Most operations keep the lie hidden in the bottom. Subtraction of near-equal numbers *promotes the lie to the top*: it cancels the trustworthy high digits and leaves the noisy low digits as your whole answer. Whenever you see `a - b` with `a ≈ b`, alarm bells.

---

## Code Examples

### Inspecting the bits

**C** — see the raw layout:

```c
#include <stdio.h>
#include <stdint.h>
#include <string.h>

void dump(double d) {
    uint64_t bits;
    memcpy(&bits, &d, sizeof bits);
    int sign = (int)(bits >> 63);
    int exp  = (int)((bits >> 52) & 0x7FF);
    uint64_t frac = bits & 0xFFFFFFFFFFFFFULL;
    printf("%-22.17g  S=%d  E=%4d (unbiased %5d)  F=%013llx\n",
           d, sign, exp, exp - 1023, (unsigned long long)frac);
}

int main(void) {
    dump(1.0);          // E=1023, F=0
    dump(0.1);          // repeating fraction, rounded
    dump(0.5);          // exact
    dump(2.0);          // E=1024
    dump(5e-324);       // smallest subnormal
    dump(1.0/0.0);      // +Inf: E=2047, F=0
    dump(0.0/0.0);      // NaN:  E=2047, F!=0
    return 0;
}
```

**Python** — same idea via `struct`:

```python
import struct
def bits(x):
    (b,) = struct.unpack('>Q', struct.pack('>d', x))
    return f"{b:064b}"
print(bits(1.0))   # 0 01111111111 0000...   (sign exp[1023] frac[0])
print(bits(0.1))   # 0 01111111011 1001100110011...  (repeating, rounded)
```

### Machine epsilon and ULP

```python
import sys, math
print(sys.float_info.epsilon)            # 2.220446049250313e-16
print(1.0 + sys.float_info.epsilon != 1.0)   # True
print(1.0 + sys.float_info.epsilon/2 == 1.0) # True (rounds away)

# ULP at a given magnitude:
print(math.ulp(1.0))      # 2.220446049250313e-16
print(math.ulp(1e9))      # 1.1920928955078125e-07  — far larger!
print(math.ulp(1e16))     # 2.0  — adjacent doubles are 2 apart here
```

### The 2^53 integer ceiling

```javascript
console.log(2 ** 53);            // 9007199254740992
console.log(2 ** 53 + 1);       // 9007199254740992  — the +1 vanished!
console.log(Number.MAX_SAFE_INTEGER); // 9007199254740991
```

### Catastrophic cancellation — the quadratic formula

```python
import math

def naive_root(a, b, c):
    d = math.sqrt(b*b - 4*a*c)
    return (-b + d) / (2*a)   # cancels when b is large and positive

def stable_root(a, b, c):
    d = math.sqrt(b*b - 4*a*c)
    # avoid cancellation by choosing the sign that adds magnitudes
    if b >= 0:
        q = -(b + d) / 2
    else:
        q = -(b - d) / 2
    return c / q              # use the product-of-roots identity

a, b, c = 1.0, 1e8, 1.0
print(naive_root(a, b, c))    # -7.450580596923828e-09  (garbage, lost digits)
print(stable_root(a, b, c))   # -1.0000000000000002e-08 (correct)
```

The true root is `-1e-8`. The naive form cancels `-b + sqrt(b² - 4)` ≈ `-1e8 + 1e8` and is left with noise.

### Non-associativity demonstrated

```python
a, b, c = 1e16, 1.0, -1e16
print((a + b) + c)   # 0.0   — b was absorbed, then a cancelled
print(a + (b + c))   # 0.0 here too, but...
print((1e16 + 1.0) - 1e16)   # 0.0   — the 1.0 is gone
print(1e16 + (1.0 - 1e16))   # 0.0
# A clearer case — summing a list in two orders:
xs = [1e16, 1.0, -1e16, 1.0]
print(sum(xs))                    # 2.0  if added left to right? Often 0.0!
print(sum(sorted(xs, key=abs)))   # 2.0  — small first preserves them
```

### Kahan (compensated) summation

```python
def kahan_sum(values):
    total = 0.0
    comp = 0.0          # running compensation for lost low-order bits
    for x in values:
        y = x - comp
        t = total + y
        comp = (t - total) - y   # recovers what was lost in (total + y)
        total = t
    return total

import random
data = [0.1] * 10_000_000
print(sum(data))        # 999999.9999...  drifts
print(kahan_sum(data))  # 1000000.0000... much closer
```

### Correct comparison with `isclose`

```python
import math
print(math.isclose(0.1 + 0.2, 0.3))                 # True
print(math.isclose(1e-18, 0.0))                     # False! rel_tol fails near 0
print(math.isclose(1e-18, 0.0, abs_tol=1e-12))      # True — abs_tol saves it
# signature: isclose(a, b, rel_tol=1e-09, abs_tol=0.0)
```

```go
import "math"

func almostEqual(a, b, relTol, absTol float64) bool {
    diff := math.Abs(a - b)
    return diff <= absTol || diff <= relTol*math.Max(math.Abs(a), math.Abs(b))
}
```

### ULP-based comparison

```c
#include <stdint.h>
#include <string.h>
#include <stdbool.h>

int64_t to_ordered(double d) {
    int64_t i;
    memcpy(&i, &d, sizeof i);
    // make the integer monotonic across the sign boundary
    return i < 0 ? (int64_t)0x8000000000000000ULL - i : i;
}

bool within_ulps(double a, double b, int64_t max_ulps) {
    int64_t ia = to_ordered(a), ib = to_ordered(b);
    int64_t d = ia > ib ? ia - ib : ib - ia;
    return d <= max_ulps;   // NaN handling omitted for brevity
}
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **ULP awareness** | Lets you choose correct tolerances and reason about error. | Requires understanding non-uniform spacing — not obvious. |
| **Round-to-even default** | Eliminates statistical bias in long computations and accounting. | Surprises programmers expecting "0.5 rounds up." |
| **Subnormals** | Gradual underflow avoids a precision cliff at the smallest normals. | Can be 10–100× slower; sometimes disabled for performance. |
| **Relative comparison** | Scale-independent equality testing. | Breaks near zero; needs an absolute fallback. |
| **Kahan summation** | Recovers near-full precision when summing many values. | ~4× the operations; compilers can break it under fast-math. |
| **Reformulation for cancellation** | Restores accuracy lost to subtraction. | Requires recognizing the problem and knowing the algebra. |

---

## Use Cases

- **Numerical libraries** (BLAS, NumPy, Eigen) live and die by ULP reasoning and stable formulas.
- **Test frameworks** need ULP/relative comparison to assert "approximately equal" without flakiness.
- **Statistics** — use Welford's algorithm for variance, not `E[x²] − E[x]²`, to avoid cancellation.
- **Financial analytics** (not transactions) — when you *do* use doubles, Kahan summation keeps long sums accurate.
- **Signal processing / audio** — subnormal handling matters; a decaying filter tail produces subnormals that tank performance.
- **Scientific simulation** — error-budget reasoning decides whether `float` precision suffices or you need `double`.

---

## Coding Patterns

### Pattern 1: `isclose` with both tolerances

Never ship a bare `abs(a-b) < eps`. Use the combined form so it works near zero *and* at scale:

```python
def isclose(a, b, rel_tol=1e-9, abs_tol=1e-12):
    return abs(a - b) <= max(rel_tol * max(abs(a), abs(b)), abs_tol)
```

### Pattern 2: Welford's online variance (cancellation-free)

```python
def variance(values):
    n = 0; mean = 0.0; m2 = 0.0
    for x in values:
        n += 1
        delta = x - mean
        mean += delta / n
        m2 += delta * (x - mean)
    return m2 / n if n else 0.0
```

### Pattern 3: Sort-then-sum for accuracy

```python
def accurate_sum(values):
    return sum(sorted(values, key=abs))   # smallest magnitude first
```

For the gold standard, use Kahan or pairwise summation (NumPy uses pairwise internally).

### Pattern 4: Rationalize to kill cancellation

`sqrt(x + 1) - sqrt(x)` cancels for large `x`. Multiply by the conjugate:

```python
import math
def diff_sqrt(x):
    # (sqrt(x+1) - sqrt(x)) * (sqrt(x+1)+sqrt(x)) / (...) = 1 / (sqrt(x+1)+sqrt(x))
    return 1.0 / (math.sqrt(x + 1) + math.sqrt(x))
```

### Pattern 5: Use `log1p` / `expm1` for small arguments

Standard libraries provide `log1p(x) = log(1+x)` and `expm1(x) = exp(x)-1`, which stay accurate when `x` is tiny and the naive form would cancel against 1.

```python
import math
print(math.log(1 + 1e-16))    # 0.0  — lost entirely
print(math.log1p(1e-16))      # 1e-16 — correct
```

---

## Best Practices

- **Choose tolerances by magnitude.** Use relative tolerance for general values, an absolute floor near zero. Prefer `math.isclose` / `numpy.allclose` over hand-rolled comparisons.
- **Recognize cancellation and reformulate.** Conjugate multiplication, `log1p`/`expm1`, the stable quadratic formula, Welford's variance.
- **Use compensated summation for long sums.** Kahan or pairwise. Sort smallest-first if you can't.
- **Know that round-to-even is the default** and don't fight it; it's the correct, unbiased choice.
- **Don't disable subnormals casually** — only flush-to-zero when you've measured a real performance problem and accepted the precision loss.
- **Reason in ULPs when writing numerical tests.** "Within 4 ULPs" is a precise, scale-independent assertion.
- **Prefer `double` for accumulation even if inputs are `float`** — accumulate in higher precision, store in lower.

---

## Edge Cases & Pitfalls

- **`1e16 + 1.0 == 1e16`.** Absorption. The `1.0` is below one ULP at that magnitude.
- **`(a + b) + c != a + (b + c)`.** Reordering a sum changes the result; parallel reductions are non-deterministic in low bits.
- **Round-to-even surprises:** `round(0.5) == 0`, `round(2.5) == 2` in Python 3, banker's rounding by design.
- **Subnormal performance cliff:** a filter or physics sim producing tiny values can suddenly run 50× slower when it enters the subnormal range.
- **Naive variance `E[x²] − E[x]²` can go negative** due to cancellation — then `sqrt` gives NaN.
- **Relative tolerance fails at zero:** `isclose(1e-300, 0.0)` is `False` without an `abs_tol`.
- **`float` accumulation overflows precision fast:** summing a million `float`s in `float` precision can be wildly off; accumulate in `double`.
- **The quadratic formula's "minus" branch** silently returns garbage when `b² ≫ 4ac`.
- **Comparing across types:** `0.1f` (float) and `0.1` (double) are different values; `(double)0.1f != 0.1`.

---

## Common Mistakes

1. **A single global `EPSILON = 1e-9` for all comparisons.** Wrong at large and tiny magnitudes.
2. **Subtracting nearly-equal numbers without noticing.** The classic source of "my result is mostly noise."
3. **Computing variance/stddev with the naive two-pass-into-one formula.** Use Welford.
4. **Summing a huge list in naive left-to-right order** and trusting the low digits.
5. **Expecting `round(2.5) == 3`.** It's `2` under ties-to-even.
6. **Flushing subnormals to zero "for speed" without measuring** — and silently changing results.
7. **Asserting exact equality in tests** for computed floats. Use ULP or `isclose`.
8. **Accumulating in `float` instead of `double`.** Always accumulate in the widest practical type.
9. **Ignoring that `b*b - 4*a*c` itself can cancel**, not just the outer formula.
10. **Believing two algebraically-equal expressions are numerically equal.** They round differently.

---

## Test Yourself

1. What is `math.ulp(1.0)`, `math.ulp(1e6)`, and `math.ulp(1e16)` in your language? Why do they differ by powers of 2?
2. Why does rounding ties *up* introduce bias, while ties-to-even does not? Round `0.5, 1.5, 2.5, 3.5` both ways and sum.
3. Predict and verify: `2**53 + 1 == 2**53`. At what magnitude do consecutive integers stop being representable?
4. Solve `x² + 1e8·x + 1 = 0` with the naive quadratic formula and with the stable version. Compare to the true roots.
5. Sum the list `[1.0, 1e16, -1e16, 1.0]` left-to-right and smallest-magnitude-first. Explain the difference.
6. Implement Kahan summation and compare `sum([0.1]*10_000_000)` against it. How far does naive summation drift?
7. Why does `math.isclose(1e-18, 0.0)` return `False`? Fix it.
8. Compute `sqrt(x+1) - sqrt(x)` for `x = 1e16` naively and via the conjugate trick. Which is right?

---

## Cheat Sheet

```text
┌─────────────────────────────────────────────────────────────────────┐
│              FLOATING-POINT — MIDDLE CHEAT SHEET                    │
├─────────────────────────────────────────────────────────────────────┤
│ binary64:  E=1..2046 normal | E=0 zero/subnormal | E=2047 Inf/NaN   │
│ machine epsilon ε = 2^-52 ≈ 2.22e-16 (double), 2^-23 (float)        │
│ ULP doubles every power of 2; ULP(2^52)=1.0                         │
├─────────────────────────────────────────────────────────────────────┤
│ Rounding modes (default = nearest, ties to EVEN / banker's):       │
│   nearest-even | nearest-away | toward 0 | toward +∞ | toward −∞    │
│   round(2.5)=2, round(0.5)=0  ← ties to even, NOT "always up"       │
├─────────────────────────────────────────────────────────────────────┤
│ Error mechanisms to recognize on sight:                            │
│   CANCELLATION : a - b with a ≈ b  → high digits vanish             │
│   ABSORPTION   : big + tiny        → tiny falls off the end         │
│   NON-ASSOC    : (a+b)+c ≠ a+(b+c) → sum order matters              │
├─────────────────────────────────────────────────────────────────────┤
│ Comparing floats:                                                  │
│   absolute  abs(a-b) < atol           (only near a known scale)    │
│   relative  abs(a-b) <= rtol*max(|a|,|b|)  (fails near 0)          │
│   combined  max(atol, rtol*max(...))  ← use isclose/allclose       │
│   ULP       integer distance of bit patterns                       │
├─────────────────────────────────────────────────────────────────────┤
│ Fixes:                                                             │
│   Kahan / pairwise summation   |  Welford variance                 │
│   conjugate trick              |  log1p / expm1                     │
│   accumulate in double         |  sort smallest-magnitude first    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The exponent field's reserved values (all-zeros, all-ones) carve out **zero, subnormals, infinity, and NaN**; everything between is a normal number with an implicit leading 1.
- **Subnormals** provide gradual underflow below `2^-1022` but can be dramatically slower on real hardware.
- Representable numbers are spaced in **ULPs** that double every power of 2; **machine epsilon** is the ULP at 1.0 (`2^-52` for double).
- The default rounding mode is **round to nearest, ties to even** (banker's rounding) — chosen to eliminate the upward bias of "always round 0.5 up."
- **Catastrophic cancellation** (subtracting near-equal numbers) and **absorption** (adding tiny to huge) are the two error amplifiers to recognize instantly.
- Floating-point arithmetic is **not associative**: sum order changes the result, making parallel reductions non-deterministic in the low bits.
- Compare floats with a **combined relative+absolute tolerance** (`isclose`/`allclose`) or with **ULP distance** — never a single fixed `eps`, and never `==`.
- Fix accuracy problems with **Kahan/pairwise summation, Welford's variance, the conjugate trick, and `log1p`/`expm1`** — and accumulate in `double`.

---

## Further Reading

- David Goldberg, *What Every Computer Scientist Should Know About Floating-Point Arithmetic*, 1991 — the rounding and error-analysis sections especially.
- Nicholas Higham, *Accuracy and Stability of Numerical Algorithms*, 2nd ed. — the rigorous treatment of cancellation, summation, and conditioning.
- William Kahan's writings (Berkeley) on summation and the design of IEEE 754.
- Bruce Dawson, *Comparing Floating Point Numbers, 2012 Edition* — the definitive practical guide to ULP comparison. https://randomascii.wordpress.com/2012/02/25/comparing-floating-point-numbers-2012-edition/
- Python `math.isclose` PEP 485 — the rationale for combined relative/absolute tolerance.
- *Float Exposed* — interactive bit/ULP explorer. https://float.exposed/

---

## Related Topics

- This folder: [`junior.md`](junior.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling numerics topics: integer overflow, fixed-point arithmetic, and decimal/arbitrary-precision types in the parent section.

---

## Diagrams & Visual Aids

### Exponent-field decode table

```text
   raw E (11 bits)      fraction F        meaning
   ────────────────     ──────────        ─────────────────────────────
   000 0000 0000        = 0               +0 / -0  (depending on sign)
   000 0000 0000        ≠ 0               subnormal: 0.F × 2^(-1022)
   001..7FE (1..2046)   any               normal:   1.F × 2^(E-1023)
   111 1111 1111        = 0               +Inf / -Inf
   111 1111 1111        ≠ 0               NaN (F = payload)
```

### ULP grows with magnitude

```text
   value:     1.0        2.0        4.0   ...   2^52        2^53
   ULP:    2.2e-16    4.4e-16    8.9e-16        1.0          2.0
            └─ fine near 1 ─┘            └─ at 2^52 integers stop being exact ─┘

   gap DOUBLES every time you cross a power of two
```

### Catastrophic cancellation

```text
   a = 1.0000000000000003   (~16 good digits)
   b = 1.0000000000000001   (~16 good digits)
       └──── identical high digits ────┘
   a - b = 0.0000000000000002
           └ only 1-2 trustworthy digits left; rest is rounding noise ┘

   The subtraction PROMOTED the noise to the top.
```

### Absorption (swamping)

```text
   1e16  =  1 0000 0000 0000 000.        (16 significant digits used up)
   +  1.0                       ↑ the "1" wants to go HERE, past the last bit
   ────────────────────────────
   =  1e16    ← the 1.0 fell off the end of the significand and vanished
```

### Choosing a comparison

```text
              are both values near zero?
                       │
              ┌────────┴────────┐
             yes               no
              │                 │
        use ABSOLUTE      know the scale exactly?
        tolerance          ┌─────┴─────┐
        abs(a-b)<atol     yes         no
                           │           │
                      absolute     RELATIVE or ULP
                                   rtol*max(|a|,|b|)
                                   or integer ULP distance

   In practice: isclose(a, b, rel_tol=..., abs_tol=...) covers all cases.
```
