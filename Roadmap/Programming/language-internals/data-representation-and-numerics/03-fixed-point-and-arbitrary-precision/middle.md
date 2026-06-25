# Fixed-Point & Arbitrary Precision — Middle Level

> **Topic:** [Fixed-Point & Arbitrary Precision](README.md)
> **Focus:** Q-notation and fixed-point arithmetic that doesn't overflow; scale vs precision in decimal types; the rounding rules that decide who gets the half-cent; and how to allocate money so the pennies always add up.

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

> Focus: **Now that you know *not* to use floats for money, how do you actually do the arithmetic correctly — including the awkward part where someone has to get the leftover penny?**

The junior page established the *what* and *why*: store money as scaled integers or decimal types, never floats. This page is about the *how*, and specifically the parts that bite once you go past addition.

Three things separate a junior money implementation from a correct one:

1. **Multiplication and division change the scale.** Adding two cent-amounts is trivial. Multiplying a price by a tax rate, or splitting a bill three ways, is where rounding enters — and where most bugs live. You need to understand **scale** and **precision** precisely, and you need a deliberate **rounding mode**.
2. **Fixed-point math overflows in the intermediate product.** When you multiply two `Q16.16` numbers, the *true* product needs 64 bits before you rescale it back to 32. Forget the wider intermediate and you get garbage. Q-notation makes this explicit and tractable.
3. **Allocation must conserve the total.** Split $100 three ways and naive rounding gives you $33.33 × 3 = $99.99. A cent vanished. Correct money systems use an **allocation** algorithm that distributes the remainder so the parts always sum to the whole.

> 🎓 **Why this matters for a mid-level engineer:** Anyone can store cents in an `int`. The mid-level skill is handling the *operations* — tax, discounts, splits, currency conversion — so that rounding is intentional, documented, and conserves money. This is exactly the code that ends up under audit, and "the pennies don't add up" is a real, recurring incident in real billing systems.

This page covers: Q-notation and fixed-point multiply/divide with overflow-safe intermediates; the scale/precision model of decimal types and `MathContext`; the standard rounding modes (half-up, half-even/banker's) and when each is correct; and the penny-allocation algorithm. `senior.md` goes deeper into bignum internals and the cost model; `professional.md` covers production money systems end to end.

---

## Prerequisites

- **Required:** The junior page — fixed-point as scaled integers, decimal types, bignums, "never floats for money."
- **Required:** Comfort with integer division and remainder (`/` and `%`), and bit widths (32-bit vs 64-bit).
- **Required:** Basic binary — you know `2^16 = 65536`.
- **Helpful:** Having used `BigDecimal` / `Decimal` once.

You do **not** need:

- Bignum multiplication algorithms (Karatsuba, FFT) — that's `senior.md`.
- Constant-time / crypto considerations — that's `senior.md`/`professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Q-notation (Qm.n)** | A fixed-point format with `m` integer bits and `n` fractional bits. `Q16.16` = 16.16, stored in a 32-bit int. The *scale* is `2^n`. |
| **Scale (fixed-point)** | The implicit multiplier. For `Qm.n` it's `2^n`; for decimal cents it's `10^2 = 100`. |
| **Scale (decimal type)** | The number of digits to the right of the decimal point. `1.230` has scale 3. |
| **Precision (decimal type)** | The total count of significant digits. `1.230` has precision 4. |
| **Unscaled value** | The raw integer inside a decimal: `BigDecimal("1.23")` is unscaled `123` with scale `2`. |
| **MathContext** | Java's object bundling a *precision* (digit count) and a *RoundingMode*. Controls how operations round. |
| **Rounding mode** | The rule for picking a representable value: HALF_UP, HALF_EVEN (banker's), FLOOR, CEILING, DOWN, UP, etc. |
| **Banker's rounding** | HALF_EVEN: ties round to the nearest *even* last digit. 2.5→2, 3.5→4, 2.45→2.4. Unbiased over many roundings. |
| **Half-up rounding** | Ties round away from zero. 2.5→3, -2.5→-3. What most humans learned in school. |
| **Allocation** | Splitting a total into parts so the parts sum *exactly* to the total, distributing the leftover minor units. |
| **Intermediate overflow** | When the true product of two fixed-point values exceeds the storage type *before* you rescale it. The classic fixed-point trap. |
| **Saturating arithmetic** | On overflow, clamp to max/min instead of wrapping. Common in DSP. |

---

## Core Concepts

### 1. Q-Notation: The Decimal Point in Binary

Embedded and DSP code often can't afford floating-point hardware, so it uses **binary fixed-point**. The format is **Qm.n**: split an integer's bits into `m` integer bits and `n` fraction bits. The real value is `stored_integer / 2^n`.

- `Q16.16` in a 32-bit int: top 16 bits are the integer part, bottom 16 are the fraction. Scale = `2^16 = 65536`. The value `1.5` is stored as `1.5 * 65536 = 98304`.
- `Q8.24`: more fractional precision, smaller integer range.

To convert: `to_fixed(x) = round(x * 2^n)`; `to_real(f) = f / 2^n`.

**Addition and subtraction** of two same-format Q values is just integer add/subtract — the scales already match. Easy.

### 2. Fixed-Point Multiplication: The Rescale and the Overflow

Here's the crux. If `a` and `b` are both `Qm.n` (scale `S = 2^n`), then as integers `a = A·... ` — more precisely `a_real = A/S` and `b_real = B/S`. Their product:

```
a_real * b_real = (A/S) * (B/S) = (A*B) / S^2
```

But you want the result back in `Qm.n` (scale `S`), so you must **divide the integer product by S once**:

```
result_int = (A * B) / S        // = (A * B) >> n  for Q with n fraction bits
```

Two things follow:

1. **The intermediate `A * B` needs double the bits.** Two 32-bit `Q16.16` values multiply to a number that can need **64 bits** before the shift. If you do `(int32_t)(A * B) >> 16` in C, the multiply overflows *first* and you get garbage. The fix: widen the intermediate. `((int64_t)A * B) >> 16`, then narrow back to 32. On systems with 64-bit fixed-point, you reach for `__int128` as the intermediate.

2. **Division mirrors this.** `a_real / b_real = (A/S)/(B/S) = A/B` — which *loses* the scale, so you must multiply the numerator first: `result_int = (A << n) / B`, again needing a wider intermediate for `A << n`.

This "widen for the intermediate, then rescale" is the single most important fixed-point skill.

### 3. Decimal Types: Scale, Precision, and the Unscaled Integer

A decimal type like Java's `BigDecimal` or Python's `Decimal` is, internally, an **arbitrary-precision integer plus a scale**:

```
value = unscaledValue * 10^(-scale)
BigDecimal("1.23")  ->  unscaled = 123, scale = 2
BigDecimal("1.230") ->  unscaled = 1230, scale = 3   (different object! same value, different scale)
```

This is why `new BigDecimal("1.23").equals(new BigDecimal("1.230"))` is **false** in Java (`equals` compares scale too) but `.compareTo(...) == 0` is **true** (compareTo is value-only). A classic gotcha.

- **Scale** controls how many fractional digits. Operations have defined scale rules: `add`/`subtract` take the *max* scale of the operands; `multiply` *adds* the scales (1.2 [scale 1] × 1.2 [scale 1] = 1.44 [scale 2]); `divide` can produce a non-terminating result and therefore **requires** you to specify a scale and rounding mode or it throws `ArithmeticException`.
- **Precision** is total significant digits. Java's `MathContext` lets you cap precision (e.g., `MathContext(7, RoundingMode.HALF_EVEN)` keeps 7 significant digits).

Python's `Decimal` uses a global/thread-local **context** (`getcontext()`) carrying precision (default 28 significant digits) and rounding mode.

### 4. Rounding Modes: Who Gets the Half?

When a value lands exactly between two representable numbers (a *tie*, like 2.5 rounding to an integer), the rounding mode decides:

| Mode | 0.5 | 1.5 | 2.5 | -0.5 | Use when |
|------|-----|-----|-----|------|----------|
| **HALF_UP** | 1 | 2 | 3 | -1 | Human-facing "round half up" (taxes in some jurisdictions) |
| **HALF_EVEN** (banker's) | 0 | 2 | 2 | 0 | Statistical/financial sums — **unbiased**, the IEEE-754 default |
| **HALF_DOWN** | 0 | 1 | 2 | 0 | Rarely; ties toward zero |
| **FLOOR** | toward −∞ | | | | Always round down |
| **CEILING** | toward +∞ | | | | Always round up (e.g., billing units you can't fractionally sell) |
| **DOWN** | truncate toward 0 | | | | Truncation |
| **UP** | away from 0 | | | | Always grow the magnitude |

**Why banker's rounding (HALF_EVEN) matters:** if you always round 0.5 *up*, then over many numbers you systematically inflate the total — a tiny upward bias that, across millions of line items, becomes real money in one direction. HALF_EVEN sends ties up half the time and down half the time, so the bias cancels. That's why it's the default in IEEE 754 and in many accounting standards. **But** some tax authorities legally mandate HALF_UP. There is no universal "correct" mode — there is only "the mode your domain/regulator specifies." Hard-code it explicitly; never rely on a default.

### 5. Allocation: Making the Pennies Add Up

Split $100 (10000 cents) among 3 parties. `10000 / 3 = 3333` cents with remainder `1`. If you give everyone `3333`, you've distributed `9999` — **one cent vanished**. You can't return $33.33 three times and claim it's $100.

The fix is an **allocation algorithm** (Fowler's "Money allocate"): compute the base share, then hand out the leftover remainder one minor unit at a time:

```
total = 10000, n = 3
base = total // n = 3333
remainder = total - base*n = 1
shares = [3333, 3333, 3333]
# distribute the 1 leftover cent to the first `remainder` shares:
shares = [3334, 3333, 3333]   # sums to exactly 10000
```

For weighted/ratio splits (e.g., allocate by 1:1:1 or by a tax breakdown), the same principle holds: compute each share by rounding *down*, then distribute the leftover units to the shares with the largest fractional remainders (largest-remainder method). The invariant is sacred: **the parts must sum to the whole.** Never round each share independently and hope.

---

## Real-World Analogies

**The recipe that scales.** Doubling a recipe that calls for "1.5 eggs" forces a decision: 3 eggs (exact) is fine, but "0.5 egg" rounded independently per ingredient drifts. Allocation is deciding *up front* how the leftover gets assigned so the totals still match.

**Cutting a pizza for an odd group.** Eight slices, three people. Everyone gets two; the remaining two slices must go *somewhere* specific — you don't pretend they evaporated. Allocation names who gets the extras.

**The ruler that measures in 1/16 inch.** `Q16.16`'s fractional part is exactly this: a binary ruler subdivided into `2^16` ticks. Multiplying two measurements needs a bigger workspace (the wide intermediate) before you read the result back off the same ruler.

**The casino chip.** Banker's rounding is the casino insisting ties alternate fairly so the house doesn't quietly skim — over a million spins, "always round up" *is* skimming.

---

## Mental Models

**Model 1 — "Multiply widens, then you rescale."** Any fixed-point multiply produces a value at *double* the scale in *double* the bit-width. Always: compute wide, shift/divide back, narrow. Forgetting the wide intermediate is *the* fixed-point bug.

**Model 2 — "A decimal is an integer wearing a decimal point."** `BigDecimal` = bignum + scale. Operations are integer operations on the unscaled value, with bookkeeping on the scale. Once you see that, scale rules stop being magic.

**Model 3 — "Rounding mode is a policy, not a default."** Treat the rounding mode as a business decision you write down explicitly. The default is whatever the language picked, which is rarely what your regulator requires.

**Model 4 — "Allocation conserves; independent rounding leaks."** The moment you split a total, switch from "round each part" to "round n−1 parts and let the last absorb the remainder" (or largest-remainder). The sum-equals-whole invariant is the test.

---

## Code Examples

### Fixed-point Q16.16 multiply with safe intermediate (C)

```c
#include <stdint.h>

#define FRAC_BITS 16
#define SCALE     (1 << FRAC_BITS)   // 65536

typedef int32_t fixed_t;             // Q16.16

static inline fixed_t fx_from_double(double x) { return (fixed_t)(x * SCALE); }
static inline double  fx_to_double(fixed_t f)  { return (double)f / SCALE; }

static inline fixed_t fx_add(fixed_t a, fixed_t b) { return a + b; }

// WRONG: (a * b) overflows int32 before the shift.
// RIGHT: widen to int64 for the intermediate, then rescale.
static inline fixed_t fx_mul(fixed_t a, fixed_t b) {
    int64_t product = (int64_t)a * (int64_t)b; // up to 64 bits
    return (fixed_t)(product >> FRAC_BITS);     // rescale back to Q16.16
}

static inline fixed_t fx_div(fixed_t a, fixed_t b) {
    int64_t numerator = (int64_t)a << FRAC_BITS; // widen before dividing
    return (fixed_t)(numerator / b);
}
```

### BigDecimal: scale, equals vs compareTo, and division (Java)

```java
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;

BigDecimal a = new BigDecimal("1.23");   // unscaled 123, scale 2
BigDecimal b = new BigDecimal("1.230");  // unscaled 1230, scale 3

System.out.println(a.equals(b));        // false  (scale differs!)
System.out.println(a.compareTo(b) == 0); // true   (value equal)

// Division can be non-terminating -> MUST specify scale + rounding, else ArithmeticException
BigDecimal x = new BigDecimal("10");
BigDecimal y = new BigDecimal("3");
// x.divide(y);                          // throws: non-terminating decimal expansion
BigDecimal q = x.divide(y, 4, RoundingMode.HALF_EVEN); // 3.3333

// Cap significant digits with a MathContext:
BigDecimal r = x.divide(y, new MathContext(5, RoundingMode.HALF_EVEN)); // 3.3333
```

### Python Decimal: context, rounding mode, quantize

```python
from decimal import Decimal, getcontext, ROUND_HALF_EVEN, ROUND_HALF_UP

getcontext().prec = 28  # significant digits for the context

price = Decimal("19.99")
tax_rate = Decimal("0.0825")
tax = (price * tax_rate)                       # 1.649175
# quantize() rounds to a fixed number of decimal places, with an explicit mode:
tax_2dp = tax.quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN)  # 1.65
print(tax_2dp)

# Compare rounding modes on a tie:
half = Decimal("2.5")
print(half.quantize(Decimal("1"), ROUND_HALF_UP))    # 3
print(half.quantize(Decimal("1"), ROUND_HALF_EVEN))  # 2
```

### Penny allocation (largest-remainder), Python

```python
def allocate(total_cents: int, weights: list[int]) -> list[int]:
    """Split total_cents by weights so the parts sum EXACTLY to total_cents."""
    w_sum = sum(weights)
    # floor share + fractional remainder for each part
    raw = [(total_cents * w) // w_sum for w in weights]
    remainders = [(total_cents * w) % w_sum for w in weights]
    distributed = sum(raw)
    leftover = total_cents - distributed       # whole cents still to assign
    # give leftover cents to the parts with the largest remainders
    order = sorted(range(len(weights)), key=lambda i: remainders[i], reverse=True)
    for i in order[:leftover]:
        raw[i] += 1
    return raw

print(allocate(10000, [1, 1, 1]))  # [3334, 3333, 3333] -> sums to 10000
print(allocate(10005, [1, 1, 1]))  # [3335, 3335, 3335] -> sums to 10005
```

### Go: fixed-point cents multiply by a rate, rounding half-even

```go
// Multiply integer cents by a rate given as basis points (1bp = 0.0001).
// e.g. 825 bp = 8.25%. Use a wide intermediate, then round half-even.
func applyRate(cents int64, basisPoints int64) int64 {
    num := cents * basisPoints       // intermediate (could be large; int64 usually ok)
    // we want num / 10000, rounded half-even
    q := num / 10000
    r := num % 10000
    if twice := 2 * r; twice > 10000 || (twice == 10000 && q%2 != 0) {
        q++
    }
    return q
}
```

---

## Pros & Cons

### Q-notation / binary fixed-point

**Pros:** integer-speed math on hardware without an FPU; deterministic across platforms; predictable bit cost. **Cons:** the programmer manages scale and overflow by hand; limited dynamic range (a `Q16.16` can't hold both 0.0001 and 1,000,000); multiply needs wide intermediates.

### Decimal types with explicit scale/rounding

**Pros:** exact base-10, flexible precision, controllable rounding; matches accounting mental model. **Cons:** slower; division forces an explicit scale/mode; `equals`-vs-value confusion; per-value memory overhead.

### Allocation algorithms

**Pros:** conserve the total exactly; auditable; fair distribution of remainders. **Cons:** a little more code than naive rounding; you must decide the tie-breaking policy (largest-remainder vs first-come) and document it.

---

## Use Cases

- **Tax, discount, interest, FX:** decimal types with an explicit rounding mode chosen per regulation.
- **Bill splitting, payouts, revenue share:** allocation algorithms so distributed amounts sum to the source.
- **DSP / audio / sensor math on MCUs:** `Qm.n` fixed-point with saturating arithmetic.
- **Deterministic game/sim physics:** integer or fixed-point so all peers compute bit-identical results.
- **Invoice rounding:** CEILING/FLOOR for billable units that can't be sold fractionally.

---

## Coding Patterns

**Pattern 1 — "Wide intermediate, then rescale."** Every fixed-point multiply/divide: promote to a wider type, do the op, rescale, narrow. Encapsulate it so callers can't forget.

**Pattern 2 — "Round once, at quantize time."** Keep full precision through the calculation; call `quantize`/`setScale` exactly once, at the end, with an explicit mode.

**Pattern 3 — "Allocate, don't divide-and-round."** Whenever a total is split, route it through an `allocate()` function that conserves the sum.

**Pattern 4 — "Carry the rounding policy in the type/config."** Make the rounding mode a field on your Money/Calculator, not a literal scattered through the codebase, so it's set once and audited in one place.

**Pattern 5 — "compareTo for value equality."** With `BigDecimal`, use `compareTo(...) == 0` for "same amount"; reserve `equals` for when scale matters too.

---

## Best Practices

1. **Always widen the intermediate in fixed-point multiply/divide.** `int64` intermediate for `Q16.16`; `__int128` for 64-bit fixed-point.
2. **Specify scale and rounding mode on every decimal division.** Don't let the default throw or surprise you.
3. **Choose the rounding mode from the domain, not the default.** HALF_EVEN for unbiased sums; HALF_UP where law requires; document which and why.
4. **Use allocation for every split.** Test the invariant `sum(parts) == total` explicitly.
5. **Round exactly once, at the boundary.** Intermediate rounding accumulates error.
6. **Mind `BigDecimal.equals` vs `compareTo`.** They differ on scale; pick deliberately, especially as map keys or in tests.
7. **Pick the right minor-unit scale per currency.** 2 for USD, 0 for JPY, sometimes 3–4 for crypto or FX.

---

## Edge Cases & Pitfalls

- **Intermediate overflow in fixed-point multiply.** `(int32_t)(a*b) >> 16` overflows before the shift. The bug only appears for large operands, so small-input tests pass.
- **`BigDecimal.divide` with no scale throws.** `10.divide(3)` raises `ArithmeticException: Non-terminating decimal expansion`. Always pass a scale/MathContext.
- **`equals` mismatch from scale.** `"2.0".equals("2.00")` is false. This breaks `HashSet`/`HashMap` membership and naive test assertions. Use `compareTo` or normalize scale first.
- **Multiply doubles the scale.** `1.23 (s=2) × 1.23 (s=2) = 1.5129 (s=4)`. If your column is scale 2, you must round after, deliberately.
- **Rounding-mode mismatch with a regulator.** Using HALF_EVEN where the tax authority mandates HALF_UP produces small, systematic discrepancies that fail audit.
- **Allocation forgotten on weighted splits.** Independently rounding a 70/30 split of an odd amount can lose or duplicate a cent. Route through `allocate`.
- **Negative numbers and rounding.** HALF_UP rounds −2.5 to −3 (away from zero); FLOOR rounds it to −3 but rounds −2.4 to −3 too. Know the direction for refunds/credits.
- **Python context is thread-local and mutable.** Changing `getcontext().prec` globally can surprise other code. Prefer `localcontext()` for scoped changes.

---

## Summary

- **Q-notation (`Qm.n`)** stores a binary fixed-point value as an integer with scale `2^n`. Add/subtract is trivial; **multiply/divide require a wider intermediate then a rescale** — the central fixed-point skill.
- **Decimal types are a bignum plus a scale.** Understand scale (fractional digits), precision (significant digits), and that multiply adds scales while divide may not terminate.
- **Rounding mode is a policy.** HALF_EVEN (banker's) is unbiased and the common financial default; HALF_UP is mandated in some jurisdictions. Choose explicitly.
- **Allocation conserves the total.** Never round split-shares independently; distribute the leftover minor units (largest-remainder) so the parts sum to the whole.

---

## Further Reading

- Martin Fowler, *Patterns of Enterprise Application Architecture* — **Money** and its `allocate` operation.
- IEEE 754 on round-half-to-even as the default rounding rule.
- Java `BigDecimal`, `MathContext`, `RoundingMode` API docs; Python `decimal` module and its context/rounding constants.
- *The Art of Computer Programming, Vol. 2* (Knuth) — fixed-point and floating-point arithmetic foundations.
- Next: `senior.md` for bignum internals (limbs, Karatsuba, FFT) and the performance cost model.
