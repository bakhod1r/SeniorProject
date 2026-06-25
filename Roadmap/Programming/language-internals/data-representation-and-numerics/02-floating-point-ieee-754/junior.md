# Floating-Point (IEEE 754) — Junior Level

> **Topic:** [Floating-Point (IEEE 754)](README.md)
> **Focus:** Why `0.1 + 0.2 != 0.3`, what the bits inside a `float` actually mean, and the single rule that saves you: never compare floats with `==`.

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

> Focus: **What is a `float` really, and why does it lie to you?**

Open a Python prompt and type `0.1 + 0.2`. You expect `0.3`. You get `0.30000000000000004`. This is not a bug in Python. It is not a bug in your CPU. It is the single most important thing to understand about how computers store numbers with a decimal point: **most decimal fractions cannot be stored exactly in binary**, and a `float` is an *approximation* dressed up to look like an exact number.

The format every mainstream language uses for `float` and `double` is called **IEEE 754** (pronounced "I-triple-E seven-fifty-four"). It is a standard from 1985, refined in 2008 and 2019, that nearly every CPU on Earth implements in hardware. It defines exactly how the bits are laid out, how arithmetic rounds, and what happens at the weird edges (dividing by zero, taking the square root of a negative number). Because it is a hardware standard, a `double` behaves *almost* identically in C, Java, Python, Go, Rust, and JavaScript.

In one sentence: **a floating-point number is `sign × mantissa × 2^exponent`, stored in a fixed number of bits, and because the bits are finite, the value is usually a tiny bit off from the decimal number you typed.**

> 🎓 **Why this matters for a junior:** The first time you write `if (total == 19.99)` and it silently fails, or you sum a column of prices and get `99.99999999998`, you will lose an afternoon to confusion. Understanding floats turns those mysteries into one-liners you fix in seconds. And the day someone asks you "why don't you use floats for money?" in an interview, you will have a real answer.

This page covers: what bits live inside a `float` and a `double`, why `0.1` is not representable, the rule that **`NaN` is never equal to anything (not even itself)**, the special values `+0`, `-0`, `+Infinity`, `-Infinity`, and `NaN`, and the one habit that prevents most float bugs: **compare with a tolerance, never with `==`**. The next level (`middle.md`) goes into rounding modes, ULPs, and cancellation; `senior.md` covers FMA, x87 surprises, and deterministic FP; `professional.md` covers real-world incidents and production debugging.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a small program in at least one language (C, Java, Python, Go, Rust, or JavaScript).
- **Required:** What an integer is, and roughly how binary works (that `5` is `101` in base 2).
- **Required:** Basic arithmetic with a decimal point — addition, multiplication.
- **Helpful but not required:** The idea that a number takes up a fixed number of bytes in memory (an `int` is often 4 bytes, a `double` is 8).
- **Helpful but not required:** Scientific notation, like `6.022 × 10^23`. Floating point is the same idea in base 2.

You do **not** need to know:

- The exact rounding rules and machine epsilon (that's `middle.md`).
- Fused multiply-add, x87 extended precision, or compiler flags (that's `senior.md`).
- Anything about decimal floating point or arbitrary-precision libraries (covered later).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Floating point** | A way to store real numbers as `sign × mantissa × 2^exponent`. The point "floats" — it can represent very large and very small numbers. |
| **`float` / binary32** | A 32-bit floating-point number (called `float` in C/Java, `float32` in Go, `f32` in Rust). ~7 decimal digits of precision. |
| **`double` / binary64** | A 64-bit floating-point number (`double` in C/Java, `float64` in Go, `f64` in Rust, the *only* number type in JavaScript). ~15-16 decimal digits. This is the default you should reach for. |
| **Sign bit** | One bit: `0` means positive, `1` means negative. |
| **Exponent** | The bits that say "how big" — the power of 2. Stored with a *bias* (an offset) so it can represent negative powers too. |
| **Mantissa / significand / fraction** | The bits that hold the actual digits of the number. |
| **Bias** | A fixed number added to the real exponent before storing, so negative exponents fit in unsigned bits. 127 for `float`, 1023 for `double`. |
| **Representable** | A value that can be stored *exactly* in floating point. `0.5` and `0.25` are; `0.1` and `0.3` are not. |
| **Rounding** | When a value can't be stored exactly, the hardware picks the nearest representable value. |
| **`NaN`** | "Not a Number." The result of undefined operations like `0.0/0.0` or `sqrt(-1)`. It is *never equal to anything*, including itself. |
| **Infinity** | `Inf` / `+Infinity` / `-Infinity`. The result of `1.0/0.0` or overflow. A real value you can do math with. |
| **Signed zero** | Floating point has both `+0.0` and `-0.0`. They compare equal but are different bit patterns. |
| **Epsilon (tolerance)** | A small number you allow as "close enough" when comparing two floats. |

---

## Core Concepts

### 1. Floating Point Is Scientific Notation in Binary

You already know scientific notation: `6.022 × 10^23`. Three parts: a **sign** (positive), a **significand** (`6.022`), and an **exponent** (`23`). Floating point is exactly this, but in base 2:

```text
value = (-1)^sign  ×  1.fraction  ×  2^exponent
```

A `double` (binary64) splits its 64 bits like this:

```text
 ┌─┬───────────────┬──────────────────────────────────────────────────┐
 │S│   exponent    │                  fraction (mantissa)             │
 │1│   11 bits     │                       52 bits                    │
 └─┴───────────────┴──────────────────────────────────────────────────┘
```

A `float` (binary32) uses 1 sign + 8 exponent + 23 fraction bits. Same shape, fewer bits, less precision.

### 2. The Hidden Leading 1

Here's a clever trick. In binary scientific notation, the part before the point is always `1` (because you shift until there's exactly one non-zero digit, and in binary the only non-zero digit *is* 1). So `1.0110 × 2^3` — that leading `1` is *always there* for normal numbers. Since it's always 1, IEEE 754 **doesn't bother storing it**. It's implied. This is the "implicit leading 1," and it gives you one extra bit of precision for free. So a `double`'s 52 stored fraction bits actually act like 53 bits of significand.

### 3. The Bias on the Exponent

The exponent needs to represent both big numbers (positive exponents) and tiny numbers (negative exponents). But the bits are stored as an unsigned integer. The fix: add a **bias**. For `double`, the bias is 1023. So if you want an exponent of `3`, you store `3 + 1023 = 1026`. If you want `-4`, you store `-4 + 1023 = 1019`. To read it back, subtract the bias. This lets a simple unsigned comparison of the bits also work as a comparison of the numbers — a deliberate design choice.

### 4. Why `0.1` Is Not Representable

In base 10, `1/3 = 0.3333...` goes on forever. You can't write it exactly with finite digits. The same thing happens in base 2 for `0.1`. In binary, `0.1` is `0.0001100110011001100...` repeating forever. Since a `double` has only 52 fraction bits, it has to **stop somewhere and round**. The number actually stored for `0.1` is approximately `0.1000000000000000055511151231257827021181583404541015625`. Slightly more than `0.1`.

So when you write `0.1 + 0.2`:
- `0.1` is stored as *slightly more* than 0.1
- `0.2` is stored as *slightly more* than 0.2
- their sum rounds to *slightly more* than 0.3

And `0.30000000000000004` is what you see. The decimal you typed was never in there to begin with.

**The rule to remember:** a decimal fraction is exactly representable in binary floating point only if its denominator (in lowest terms) is a power of 2. `0.5 = 1/2` ✓, `0.25 = 1/4` ✓, `0.75 = 3/4` ✓, `0.1 = 1/10` ✗, `0.3 = 3/10` ✗.

### 5. Special Values: Zero, Infinity, NaN

IEEE 754 reserves bit patterns for special cases:

- **`+0.0` and `-0.0`** — yes, there are two zeros. They compare equal (`-0.0 == 0.0` is `true`) but they're different bit patterns, and `1.0/-0.0` gives `-Infinity` while `1.0/+0.0` gives `+Infinity`.
- **`+Infinity` and `-Infinity`** — what you get from `1.0/0.0` or when a number gets too big to store (overflow). You can do arithmetic with them: `Infinity + 1 == Infinity`, `1/Infinity == 0`.
- **`NaN` (Not a Number)** — the result of nonsense like `0.0/0.0`, `Infinity - Infinity`, or `sqrt(-1.0)`. NaN has a poisonous property: **any arithmetic with NaN produces NaN**, and **NaN is not equal to anything, including itself**. `NaN == NaN` is `false`. This is by design (and it's how you test for NaN: `x != x` is true only when `x` is NaN).

### 6. The Golden Rule: Never Compare Floats with `==`

Because floats are approximations, two values that *should* be equal often differ by a tiny amount. `0.1 + 0.2 == 0.3` is `false`. So the rule is:

**Never use `==` (or `!=`) to compare two floating-point values that came from calculations.**

Instead, check whether they're *close enough*:

```text
abs(a - b) < epsilon
```

where `epsilon` is a small tolerance you choose (often something like `1e-9` for doubles). We'll refine this in `middle.md` (absolute vs relative tolerance), but for a junior, "compare with a small tolerance" is 90% of the battle.

The exceptions where `==` is fine: comparing against exactly `0.0` when you *set* it to zero, or comparing integer-valued floats you never did arithmetic on. When in doubt, use a tolerance.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Floating point** | Scientific notation: `6.022 × 10^23`. A sign, some digits, and a power. |
| **Fixed number of bits** | A calculator display with only 10 digits. Numbers that need more digits get truncated. |
| **`0.1` not representable** | Trying to write `1/3` exactly in decimal: `0.333...`. You run out of paper. |
| **Rounding** | A ruler marked only in millimeters. A length of 2.3 mm gets read as "2 mm" or "2.5 mm" depending on the marks. |
| **NaN** | The "ERROR" on a calculator after you divide by zero. Once it's there, everything you compute with it stays "ERROR." |
| **NaN != NaN** | Two people both answering "I don't know" — that doesn't mean they have the *same* unknown answer. Two unknowns aren't equal. |
| **Infinity** | The odometer that, instead of rolling over, just shows "∞" once you've driven impossibly far. |
| **Signed zero** | A thermometer reading 0°C approached from above (melting) vs from below (freezing). Same temperature, different history. |
| **Comparing with epsilon** | "Close enough for government work." Two measurements within a hair of each other are treated as the same. |

---

## Mental Models

### The "Number Line With Gaps" Model

Don't picture floating-point numbers as a smooth, continuous line. Picture them as **dots on a number line with gaps between them**. Near zero the dots are densely packed (you can represent `0.0001` and `0.0002` distinctly). Far from zero — say near a billion — the dots are far apart (you might not be able to represent `1000000000` and `1000000001` as different numbers). Any value you type lands *on the nearest dot*, not exactly where you meant. This single picture explains rounding, why precision degrades for large numbers, and why `0.1` snaps to a nearby dot.

### The "Approximation Wearing a Suit" Model

A `double` *looks* like an exact number when you print it, but underneath it's an approximation. When you write `0.1`, the language quietly substitutes "the nearest representable dot to 0.1." Every time you do arithmetic, the result lands on a dot and a tiny error may sneak in. Errors are usually invisible. They become visible when you (a) compare with `==`, (b) subtract two nearly-equal numbers, or (c) add up thousands of values. Treat every float as "the right answer, give or take a smidge."

### The "Calculator With Limited Digits" Model

If your calculator showed only 7 digits, you'd never expect `1/3 × 3` to come back as exactly `1` — you'd accept `0.9999999`. A `float` *is* a calculator with about 7 decimal digits; a `double` has about 15-16. When something is off in the 16th digit, that's not a bug, that's the calculator running out of display.

---

## Code Examples

### The `0.1 + 0.2` demo in every language

**Python:**

```python
print(0.1 + 0.2)            # 0.30000000000000004
print(0.1 + 0.2 == 0.3)     # False
print(f"{0.1:.17f}")        # 0.10000000000000001  (the real stored value)
```

**JavaScript** (every number is a `double`):

```javascript
console.log(0.1 + 0.2);          // 0.30000000000000004
console.log(0.1 + 0.2 === 0.3);  // false
```

**Java:**

```java
public class FloatDemo {
    public static void main(String[] args) {
        System.out.println(0.1 + 0.2);          // 0.30000000000000004
        System.out.println(0.1 + 0.2 == 0.3);   // false
    }
}
```

**Go:**

```go
package main

import "fmt"

func main() {
    fmt.Println(0.1 + 0.2)          // 0.30000000000000004
    fmt.Println(0.1+0.2 == 0.3)     // false
}
```

**C:**

```c
#include <stdio.h>
int main(void) {
    double a = 0.1, b = 0.2;
    printf("%.17g\n", a + b);        // 0.30000000000000004
    printf("%d\n", a + b == 0.3);    // 0
    return 0;
}
```

Every language prints the same `0.30000000000000004`, because they all use IEEE 754 binary64 and the same rounding. **The behavior is the standard, not the language.**

### Comparing floats the right way

Wrong:

```python
if total == 19.99:    # may silently never be true
    apply_discount()
```

Right — compare with a tolerance:

```python
EPSILON = 1e-9
if abs(total - 19.99) < EPSILON:
    apply_discount()
```

In Java:

```java
double EPSILON = 1e-9;
if (Math.abs(total - 19.99) < EPSILON) {
    applyDiscount();
}
```

In Go:

```go
import "math"

const epsilon = 1e-9
if math.Abs(total-19.99) < epsilon {
    applyDiscount()
}
```

### Detecting NaN and Infinity

NaN never equals itself, so the portable test is `x != x`. But every language also gives you a proper helper — prefer it:

```python
import math
x = float('nan')
print(x == x)            # False  (the trick)
print(math.isnan(x))     # True   (use this)
print(math.isinf(1e308 * 10))  # True — overflow to infinity
```

```java
double x = 0.0 / 0.0;          // NaN
System.out.println(x == x);             // false
System.out.println(Double.isNaN(x));    // true
System.out.println(Double.isInfinite(1.0 / 0.0)); // true
```

```go
import "math"
x := math.NaN()
fmt.Println(x == x)          // false
fmt.Println(math.IsNaN(x))   // true
fmt.Println(math.IsInf(1.0/0.0, 0)) // panics: integer div by zero — use math
```

> **Note for Go:** `1.0/0.0` with literal constants is a *compile error* in Go. You must compute infinity from variables or `math.Inf(1)`. This is Go protecting you.

### Seeing the two zeros

```python
print(0.0 == -0.0)            # True  (they compare equal)
import math
print(math.copysign(1, -0.0)) # -1.0  (but the sign is different!)
print(1.0 / 0.0 if False else 1.0 / -0.0 if False else "div by zero is an error in Python")
```

```c
#include <stdio.h>
int main(void) {
    double pz = 0.0, nz = -0.0;
    printf("%d\n", pz == nz);     // 1  (equal)
    printf("%g\n", 1.0 / pz);     // inf
    printf("%g\n", 1.0 / nz);     // -inf  (sign of zero matters here!)
    return 0;
}
```

### Money: don't use float

```python
# WRONG: floats for money
price = 0.10
total = 0.0
for _ in range(10):
    total += price
print(total)          # 0.9999999999999999  — not 1.0!

# RIGHT: integer cents
price_cents = 10
total_cents = sum(price_cents for _ in range(10))
print(total_cents / 100)   # 1.0  exactly, because the math was in integers
```

The lesson every junior must internalize: **never store money as a `float` or `double`.** Use integer cents, or a decimal type (`decimal.Decimal` in Python, `BigDecimal` in Java). More on this in `middle.md` and `professional.md`.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Speed** | Hardware-accelerated. A floating-point add/multiply is a single fast CPU instruction. | Exactness is sacrificed for that speed. |
| **Range** | A `double` covers from ~10^-308 to ~10^308 — enormous dynamic range in 8 bytes. | Precision is not uniform; large numbers lose precision. |
| **Portability** | IEEE 754 is implemented nearly identically across CPUs and languages. | "Nearly" — corner cases (NaN payloads, extended precision) differ. |
| **Convenience** | One type handles tiny and huge numbers without you thinking about scale. | Hides the approximation, leading to surprise bugs. |
| **Standardization** | A well-specified, decades-old standard. NaN/Inf behavior is defined, not chaos. | The spec has sharp edges (signed zero, NaN inequality) that trip beginners. |
| **For money** | — | Never appropriate. Decimal fractions like `0.10` aren't representable; errors accumulate. |

---

## Use Cases

Floating point is the **right** tool when:

- **You're doing science, graphics, physics, or ML.** Approximations are fine; speed and range matter. Game positions, 3D transforms, neural network weights.
- **You're measuring real-world quantities** that already have measurement error — temperatures, distances, sensor readings. The float's tiny error is dwarfed by the sensor's.
- **You need a huge dynamic range** in a fixed amount of memory.
- **You're computing averages, ratios, or statistics** where a relative error of 10^-15 is irrelevant.

Floating point is the **wrong** tool when:

- **You're handling money.** Use integer cents or a decimal type. A bank that loses a cent per transaction loses millions.
- **You need exact decimal results** that a human will compare against a hand calculation (invoices, tax).
- **You need exact equality checks.** Counting, IDs, indices — use integers.
- **You need reproducible bit-identical results across machines** without great care (covered in `senior.md`).

---

## Coding Patterns

### Pattern 1: Tolerance comparison helper

Write it once, use it everywhere:

```python
def close(a, b, eps=1e-9):
    return abs(a - b) < eps
```

```go
func Close(a, b float64) bool {
    const eps = 1e-9
    return math.Abs(a-b) < eps
}
```

### Pattern 2: Money as integers

```python
# store cents, never dollars
total_cents = 0
total_cents += 1099   # $10.99
total_cents += 250    # $2.50
print(f"${total_cents / 100:.2f}")   # $13.49
```

### Pattern 3: Format for display, don't round for storage

When you need 2 decimal places *for the user*, format on output. Don't try to "round the value" and keep computing with it:

```python
value = 0.1 + 0.2
print(f"{value:.2f}")   # "0.30"  — display only
# but `value` itself is still 0.30000000000000004 internally
```

### Pattern 4: Guard against NaN before it spreads

```python
import math
def safe_divide(a, b):
    if b == 0:
        return 0.0          # or raise, depending on your needs
    result = a / b
    if math.isnan(result):
        raise ValueError("computation produced NaN")
    return result
```

### Pattern 5: Prefer `double` over `float`

Unless you have a specific reason (huge arrays, GPU, memory pressure), use the 64-bit type (`double` / `float64` / `f64`). The extra precision prevents a whole class of bugs and costs little. A junior's default should be `double`.

---

## Best Practices

- **Default to `double`/`float64`.** Only drop to 32-bit `float` when memory or bandwidth demands it.
- **Never compare with `==`.** Use a tolerance. Make a `close()` helper and use it consistently.
- **Never store money as a float.** Integer cents or a decimal type.
- **Use the library NaN/Inf checks** (`isnan`, `isinf`, `Double.isNaN`), not hand-rolled bit tricks — except the `x != x` test, which is the one acceptable trick.
- **Format on output, compute in full precision.** Don't round intermediate values.
- **Be suspicious when you subtract two close numbers** — error can blow up (you'll learn why in `middle.md`).
- **Read the printed value with `%.17g`** when debugging — it shows the true stored value, not the friendly rounded display.
- **When summing many numbers, be aware order matters** — `(a+b)+c` can differ from `a+(b+c)`. (More in `middle.md`.)

---

## Edge Cases & Pitfalls

- **`0.1 + 0.2 != 0.3`** — the canonical surprise. Not a bug; the inputs aren't representable.
- **`NaN == NaN` is `false`.** A list containing NaN can't be de-duplicated with normal equality, and sorting a list with NaN can corrupt the sort order in some languages.
- **`-0.0 == 0.0` is `true`, but `1/-0.0` is `-Infinity`.** Sign of zero is invisible to `==` but visible to division.
- **Accumulating a float in a loop drifts.** Adding `0.1` ten times does not give `1.0`.
- **Large integers lose precision as doubles.** A `double` can hold integers exactly only up to 2^53 (≈ 9 quadrillion). Beyond that, `9007199254740993.0 == 9007199254740992.0` can be `true`. This bites JavaScript hard, since *all* its numbers are doubles.
- **Printing hides the truth.** `print(0.1)` shows `0.1`, but the stored value is `0.1000000000000000055...`. The printer rounds to the shortest string that reads back as the same double.
- **Comparing a `float` and a `double` of "the same" value can fail** — `(float)0.1 != (double)0.1` because they round to different dots.
- **`Math.sqrt(-1)` doesn't crash — it returns NaN** (in most languages). Your program keeps running with poison in it.

---

## Common Mistakes

1. **`if (price == 19.99)`.** Use a tolerance. This is the #1 float bug juniors write.
2. **Using `float`/`double` for currency.** Switch to integer cents or `BigDecimal`/`Decimal`.
3. **Assuming a sum of floats equals the obvious total.** Loop accumulation drifts.
4. **Testing NaN with `==`.** Use `isnan()`. `x == NaN` is always false, so the check never fires.
5. **Storing a giant integer in a `double` and expecting exactness** beyond 2^53.
6. **Rounding a value and continuing to compute with the rounded one** instead of formatting only at display time.
7. **Forgetting that division by zero gives Infinity (or NaN), not a crash**, in float math — so a bug silently spreads.
8. **Comparing `float` to `double`** without realizing they store the value differently.
9. **Believing the printed value is the stored value.** Print with `%.17g` to see reality.
10. **Mixing up `0.0` and `-0.0`** when the sign of a zero secretly matters (e.g., in `atan2` or division).

---

## Test Yourself

1. Predict the output of `0.1 + 0.2 == 0.3`. Now predict `0.5 + 0.25 == 0.75`. Why does one work and the other doesn't?
2. Why is `0.5` exactly representable but `0.1` is not? Express both as fractions and look at the denominator.
3. Write a function `close(a, b)` and use it to make `0.1 + 0.2` "equal" `0.3`.
4. What does `float('nan') == float('nan')` return? How do you actually test for NaN?
5. What is `1.0 / 0.0` in floating point? What is `0.0 / 0.0`? What is `-1.0 / 0.0`?
6. Add `0.1` to a running total ten times in a loop. Print the result. Is it `1.0`? Print it with 17 digits.
7. Why should you never store a price like `$10.99` as a `double`? Show the bug by summing `0.10` ten times.
8. A `double` can store integers exactly only up to about 2^53. What is `9007199254740992.0 + 1` in your language?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                  FLOATING-POINT (IEEE 754) — BASICS               │
├──────────────────────────────────────────────────────────────────┤
│ value = (-1)^sign × 1.fraction × 2^(exponent - bias)             │
├──────────────────────────────────────────────────────────────────┤
│ float  (binary32): 1 sign +  8 exp + 23 frac  ~7  digits         │
│ double (binary64): 1 sign + 11 exp + 52 frac  ~15-16 digits      │
│ bias: 127 (float), 1023 (double)                                 │
├──────────────────────────────────────────────────────────────────┤
│ THE GOLDEN RULE: never compare floats with ==                    │
│   use:  abs(a - b) < epsilon                                     │
├──────────────────────────────────────────────────────────────────┤
│ Representable exactly?  yes if denominator is a power of 2       │
│   0.5 ✓  0.25 ✓  0.75 ✓   |   0.1 ✗  0.2 ✗  0.3 ✗               │
├──────────────────────────────────────────────────────────────────┤
│ Special values:                                                  │
│   +0.0 and -0.0  (equal under ==, differ under division)        │
│   +Inf / -Inf    (1.0/0.0, overflow)                            │
│   NaN            (0.0/0.0, sqrt(-1); NaN != NaN; test isnan())   │
├──────────────────────────────────────────────────────────────────┤
│ NEVER use float/double for money. Use integer cents or Decimal.  │
├──────────────────────────────────────────────────────────────────┤
│ Debug tip: print with %.17g to see the TRUE stored value.        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A floating-point number is `sign × mantissa × 2^exponent` packed into 32 bits (`float`) or 64 bits (`double`), following the **IEEE 754** standard that almost every CPU implements.
- A `double` is 1 sign bit + 11 exponent bits + 52 fraction bits, with a **hidden leading 1** and a **bias** of 1023 on the exponent.
- **Most decimal fractions are not representable** in binary. `0.1`, `0.2`, `0.3` are stored as nearby approximations, which is why `0.1 + 0.2` prints `0.30000000000000004`.
- A value is exactly representable only if its denominator (in lowest terms) is a power of 2.
- Special values exist: **signed zeros** (`+0.0`, `-0.0`), **infinities** (`±Inf`), and **NaN** ("not a number"). NaN poisons every calculation and is **never equal to anything, including itself** — test it with `isnan()` or the `x != x` trick.
- **The golden rule: never compare floats with `==`.** Compare with a tolerance: `abs(a - b) < epsilon`.
- **Never store money as a float.** Use integer cents or a decimal type.
- Default to `double`/`float64`. The behavior is identical across C, Java, Python, Go, Rust, and JS because it's the standard, not the language.
- Printing hides the approximation; print with `%.17g` to see the true stored value.

---

## Further Reading

- *What Every Computer Scientist Should Know About Floating-Point Arithmetic* — David Goldberg, 1991. The classic. Dense but foundational. https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html
- *0.30000000000000004.com* — a tiny website showing the `0.1 + 0.2` result in dozens of languages. https://0.30000000000000004.com/
- *Float Toy* — an interactive bit-by-bit visualizer for IEEE 754. https://evanw.github.io/float-toy/
- *The Floating-Point Guide* — beginner-friendly, language-agnostic. https://floating-point-gui.de/
- *IEEE 754* — Wikipedia's overview is accurate and well-illustrated. https://en.wikipedia.org/wiki/IEEE_754
- Python docs — *Floating Point Arithmetic: Issues and Limitations*. https://docs.python.org/3/tutorial/floatingpoint.html

---

## Related Topics

- This folder, next levels: [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling topics in data representation: integer representation, two's complement, endianness, and fixed-point arithmetic (see the parent section).
- Decimal arithmetic and arbitrary-precision numbers are covered in the numerics siblings.

---

## Diagrams & Visual Aids

### The bits of a `double`

```text
 bit 63                                                          bit 0
   │                                                               │
   ▼                                                               ▼
 ┌───┬───────────────────┬───────────────────────────────────────────┐
 │ S │     exponent      │             fraction (mantissa)           │
 │ 1 │     11 bits       │                 52 bits                   │
 └───┴───────────────────┴───────────────────────────────────────────┘

 value = (-1)^S  ×  1.fraction  ×  2^(exponent - 1023)
                    ↑
                    the leading "1." is implied, not stored
```

### Why `0.1` isn't representable

```text
  0.1 in binary  =  0.0001100110011001100110011001100... (repeats forever)

  double has 52 fraction bits → must stop and round here ──┐
                                                           ▼
  stored ≈ 0.1000000000000000055511151231257827021181583404541015625
           └──────── slightly MORE than 0.1 ────────┘
```

### The number line with gaps

```text
  dots = representable values

  near 0:   ·· · · · · · ·    ·    ·    ·       ·       ·         ·
            └ dense ┘                            └─── sparse ───┘   far from 0

  Any value you type lands on the NEAREST dot.
  0.1 has no dot → snaps to the closest one → tiny error.
```

### The special-value map

```text
  ┌─────────────────────────────────────────────────────────┐
  │  -Inf  ◄── -big ... -1 ... -0.0  +0.0 ... 1 ... +big ──► +Inf │
  │                                                         │
  │   NaN  =  "off the number line entirely"                │
  │          (0/0, sqrt(-1), Inf - Inf)                     │
  │          NaN != anything, even itself                   │
  └─────────────────────────────────────────────────────────┘
```
