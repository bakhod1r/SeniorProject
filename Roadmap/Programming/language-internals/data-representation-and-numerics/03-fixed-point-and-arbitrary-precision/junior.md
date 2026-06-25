# Fixed-Point & Arbitrary Precision — Junior Level

> **Topic:** [Fixed-Point & Arbitrary Precision](README.md)
> **Focus:** Why `0.1 + 0.2 != 0.3`, why you must never store money in a `float`, and the two escape hatches every language gives you: integers scaled by a factor, and numbers that grow as big as they need to.

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

> Focus: **Where does the number `0.30000000000000004` come from, and what do professionals use instead?**

Open a Python shell and type `0.1 + 0.2`. You get `0.30000000000000004`. This is not a bug in Python — you will see the same thing in Java, JavaScript, Go, C, and almost every language on the planet. It happens because the `float` and `double` types your CPU uses **cannot represent the number 0.1 exactly**. They store numbers in binary (base 2), and 0.1 in binary is a repeating fraction, just like 1/3 is `0.333...` in decimal. The computer rounds it, and the rounding error leaks out when you add.

For a game where a coin floats up and down on the screen, nobody cares about an error in the 17th decimal place. For **money**, it is a disaster. If you store a customer's balance as a `double` and add up a million small transactions, the rounding errors accumulate, your ledger stops balancing, an auditor finds a few cents missing, and now you have a very uncomfortable meeting. The rule every backend engineer learns early is blunt: **never store money in a binary floating-point type.**

This page is about the two families of tools that fix this, and a third that solves a different problem:

1. **Fixed-point** — store the number as a plain **integer scaled by a known factor**. Store $19.99 as the integer `1999` and remember "this is in cents." No floats, no rounding surprises, exact arithmetic.
2. **Decimal / arbitrary-precision decimal** — a number type (`BigDecimal` in Java, `Decimal` in Python, `decimal` in C#) that does arithmetic the way *you* learned in school, in base 10, with exactly the digits you ask for.
3. **Arbitrary-precision integers (bignums)** — integers that have **no upper limit**. When a normal `int` would overflow at ~9 quintillion, a bignum just grows and keeps the exact answer. Python uses these by default; Java has `BigInteger`; JavaScript has `BigInt`.

> 🎓 **Why this matters for a junior:** The single most common production bug a junior ships is "I used a float for a price." It passes every test (the numbers are small and round), then fails in production after thousands of transactions. Learning this *once* prevents a whole category of expensive, embarrassing bugs. It is one of the highest-leverage things you can learn in your first month writing backend code.

This page covers: what fixed-point really means, how to store money correctly, why floats are wrong for currency, what a "bignum" is, and the same money example done right across several languages. The `middle.md` page goes into rounding rules (banker's rounding), scale and precision, and Q-notation. `senior.md` covers how bignum multiplication actually works (Karatsuba, FFT) and where bignums quietly destroy performance.

---

## Prerequisites

What you should know before reading this:

- **Required:** What an integer (`int`) and a floating-point number (`float`/`double`) are, and how to declare and add them in at least one language.
- **Required:** What "overflow" means in one sentence — when a number gets too big for its type and wraps around.
- **Required:** Basic decimal arithmetic (you know that 1/3 is a repeating decimal).
- **Helpful but not required:** A vague memory of binary — that computers store numbers in base 2.
- **Helpful but not required:** Having once been bitten by a money rounding bug. (You will be, if you haven't.)

You do **not** need to know:

- IEEE 754 bit layout (mantissa, exponent — that's the floating-point topic next door).
- How bignum multiplication algorithms work (Karatsuba, Toom-Cook, FFT — that's `senior.md`).
- The exact rounding modes and `MathContext` semantics (that's `middle.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Floating-point** | The `float`/`double` types your CPU has. Fast, but **binary** — cannot represent most decimal fractions (like 0.1) exactly. |
| **Fixed-point** | Storing a fractional number as a plain **integer scaled by a fixed factor**. Store $1.23 as the integer `123` (cents). |
| **Scale factor** | The fixed number you multiply by to get the integer. For cents, the scale is 100. For 4 decimal places, it's 10,000. |
| **Minor unit** | The smallest unit of a currency. For USD it's the cent (1/100 of a dollar). For JPY it's the yen itself (no subdivisions). |
| **Decimal type** | A number type that does arithmetic in base 10, exactly: `BigDecimal` (Java), `Decimal` (Python), `decimal` (C#). |
| **Arbitrary precision** | "As many digits as needed." A type that grows to hold the exact answer instead of overflowing or rounding. |
| **Bignum / big integer** | An integer with no fixed size limit. `BigInteger` (Java), `int` (Python), `BigInt` (JS), `big.Int` (Go). |
| **Overflow** | When a value exceeds what its fixed-size type can hold and wraps around (e.g. a 64-bit int past ~9.2 quintillion). |
| **Rounding** | Choosing a representable value when the exact one has too many digits. There are several *rules* for which way to round. |
| **Banker's rounding** | Round-half-to-even: 2.5 → 2, 3.5 → 4. The default for money in many systems because it doesn't bias sums upward. |
| **Precision** | The total number of significant digits a number carries. |
| **Scale** | The number of digits to the *right* of the decimal point. `1.230` has scale 3. |
| **Q-notation** | A way to write a fixed-point format: `Q16.16` means 16 integer bits and 16 fraction bits. (You'll meet this in `middle.md`.) |

---

## Core Concepts

### 1. Why Binary Floats Cannot Hold 0.1

Your computer stores `double` values in **binary**. In binary, the only fractions that are exact are sums of `1/2, 1/4, 1/8, 1/16, ...` So `0.5` is exact (it's `1/2`). `0.25` is exact. But `0.1`? There is no finite sum of halves, quarters, and eighths that equals exactly 0.1 — it's a repeating binary fraction, the same way `1/3 = 0.3333...` repeats in decimal. The computer keeps about 15–16 significant decimal digits and rounds the rest away.

So when you write `0.1` in your code, the value actually stored is approximately `0.1000000000000000055511151231257827021181583404541015625`. Tiny error. But `0.1 + 0.2` produces a value whose nearest stored double is `0.30000000000000004`, and now the error is visible. Multiply that by a million transactions and the errors stop being invisible.

The key sentence: **a binary float can represent any power-of-two fraction exactly and almost nothing else exactly.** Money is in base 10. Base 10 and base 2 do not mix cleanly.

### 2. Fixed-Point: Store Money as Integers

The oldest, simplest, fastest fix: **don't store dollars, store cents.** $19.99 becomes the integer `1999`. $0.01 becomes `1`. Now:

- Addition is exact: `1999 + 1 = 2000` (= $20.00). No rounding, ever.
- There is no "0.1 problem" because integers have no fractional part to mess up.
- It's just integer math, which CPUs do perfectly and instantly.

This is **fixed-point**: a number with a fractional value, stored as an integer, with the position of the decimal point *fixed* and *implicit*. You — the programmer — remember "this integer is in cents." The computer just sees an integer.

The catch: you must be consistent and you must be careful at the boundaries (multiplication and division need extra thought — covered below and in `middle.md`).

### 3. Decimal Types: Base-10 Arithmetic on Demand

Sometimes you want fractions but cents aren't enough — currency conversion, tax at 8.25%, interest at 3.7% APR. For these, languages provide a **decimal type** that does arithmetic in base 10 *exactly*, carrying as many digits as you ask for.

```python
from decimal import Decimal
Decimal("0.1") + Decimal("0.2")   # -> Decimal('0.3')   exactly!
```

`Decimal("0.3")` is the *exact* value 0.3, because it stores the digits `3` and the scale (one place after the point) directly, in base 10. No binary approximation. The price you pay: it's slower than a hardware `double` (it's software, not a CPU instruction). For money, that's almost always a fine trade.

### 4. Arbitrary-Precision Integers (Bignums)

A normal 64-bit integer maxes out at about 9.2 quintillion (`9,223,372,854,775,807`). Add one more and it **overflows** — in C/Java/Go it silently wraps to a negative number; the result is wrong.

A **bignum** (big integer) has no such limit. It stores the number across as many machine words as needed and grows automatically. Compute `2^1000` or `100!` (the factorial of 100, a 158-digit number) and a bignum gives you the **exact** answer.

```python
2 ** 1000   # Python: a 302-digit exact integer, no overflow
```

Different languages handle this very differently, and this is a frequent source of confusion:

- **Python:** every `int` is *already* a bignum. You never overflow. (You also pay a little speed for it.)
- **JavaScript:** numbers are doubles; you must use the `BigInt` type (`10n`) explicitly.
- **Java:** `int`/`long` overflow silently; use `BigInteger` for unbounded.
- **Go:** `int64` overflows silently; use `math/big.Int`.
- **C/C++/Rust:** overflow on fixed-size types; use a library (GMP, `num-bigint`) for bignums.

### 5. Three Tools, Three Jobs

It's easy to confuse these. Keep them straight:

| You need... | Use |
|-------------|-----|
| Exact money with a fixed number of decimals (cents) | **Fixed-point integers** (store cents) |
| Exact decimal math with flexible precision (tax, interest) | **Decimal type** (`BigDecimal`, `Decimal`) |
| Huge whole numbers that never overflow (factorials, crypto, IDs) | **Bignum** (`BigInteger`, Python `int`, `BigInt`) |

---

## Real-World Analogies

**The recipe in grams, not "cups-ish."** Imagine a baker who measures everything in whole grams (an integer) instead of "about a cup." Two bakers using grams will always get the same dough. Two bakers using "a cup-ish" will drift apart. Fixed-point (store cents) is the gram approach: an exact, agreed-upon smallest unit.

**The ruler with no markings between millimeters.** A binary float is like a ruler whose tick marks are at weird, uneven positions — and 0.1 cm falls *between* two ticks, so you can only ever say "close to 0.1." Fixed-point is a ruler whose smallest tick is exactly one cent: every value you care about lands exactly on a tick.

**The odometer that never rolls over.** A normal `int` is a car odometer with six digits — past 999,999 it rolls back to 000000 and lies to you (that's overflow). A bignum is a magic odometer that grows a new digit whenever it needs one, so it never rolls over and never lies.

**Counting in pennies on a table.** Fixed-point money is literally counting physical pennies. You never have "half a penny" floating around — you have a whole number of pennies. Addition is just sliding piles together. There is no ambiguity about what you have.

---

## Mental Models

**Model 1 — "The decimal point is in your head, not in the computer."** With fixed-point, the computer only ever sees an integer like `1999`. The "decimal point goes two places from the right" lives in *your* code and your conventions, not in the data. Keep that convention airtight (always cents, never sometimes-dollars) and the math is exact.

**Model 2 — "Binary floats lie about base-10 fractions; integers never lie."** Any time you store a fraction of money in a `double`, assume it's *approximately* that value, not exactly. Integers (and decimal types) store the value you actually meant.

**Model 3 — "Bignums trade speed for never being wrong about size."** A fixed `int64` is fast but has a hard ceiling. A bignum has no ceiling but is slower (it's an array of machine words plus bookkeeping). You pick based on whether *overflow* or *speed* is the bigger risk.

**Model 4 — "Round at the edges, compute in the middle."** Keep money in exact integers/decimals through all the computation, and only round to a displayable value at the very end (when you show it or settle a payment). Rounding early and often is how cents leak.

---

## Code Examples

### The bug, in five languages

The classic float-money bug looks identical everywhere:

```python
# Python
price = 0.1
total = price * 3          # 0.30000000000000004
print(total == 0.3)        # False  ← would fail an equality check
```

```javascript
// JavaScript
console.log(0.1 + 0.2);          // 0.30000000000000004
console.log(0.1 + 0.2 === 0.3);  // false
```

```java
// Java
double total = 0.1 + 0.2;        // 0.30000000000000004
System.out.println(total == 0.3); // false
```

```go
// Go
package main
import "fmt"
func main() {
    fmt.Println(0.1 + 0.2)        // 0.30000000000000004
}
```

```c
// C
#include <stdio.h>
int main(void) {
    printf("%.17f\n", 0.1 + 0.2); // 0.30000000000000004
    return 0;
}
```

### Fix 1 — Fixed-point: store cents (works in any language)

```go
// Go — money as int64 cents. Exact, fast, no surprises.
package main

import "fmt"

func main() {
    var priceCents int64 = 1999 // $19.99
    var qty int64 = 3
    total := priceCents * qty // 5997 cents = $59.97, exact
    fmt.Printf("$%d.%02d\n", total/100, total%100) // $59.97
}
```

```python
# Python — same idea, integer cents
price_cents = 1999
total = price_cents * 3          # 5997, exact
dollars, cents = divmod(total, 100)
print(f"${dollars}.{cents:02d}") # $59.97
```

### Fix 2 — Decimal type (when cents aren't enough)

```python
# Python Decimal — exact base-10 arithmetic
from decimal import Decimal

price = Decimal("19.99")
qty = Decimal("3")
print(price * qty)               # 59.97  (exact)
print(Decimal("0.1") + Decimal("0.2"))  # 0.3  (exact!)
```

```java
// Java BigDecimal — ALWAYS construct from a String, never a double
import java.math.BigDecimal;

BigDecimal price = new BigDecimal("19.99");   // exact
BigDecimal qty   = new BigDecimal("3");
System.out.println(price.multiply(qty));      // 59.97

// WRONG: new BigDecimal(0.1) captures the binary error -> 0.1000000000000000055...
// RIGHT: new BigDecimal("0.1")  is exactly 0.1
```

### Fix 3 — Bignum (numbers that never overflow)

```python
# Python: int is already a bignum
print(2 ** 100)      # 1267650600228229401496703205376  (exact, 31 digits)
import math
print(math.factorial(50))  # exact 65-digit number
```

```java
// Java: BigInteger
import java.math.BigInteger;
BigInteger big = BigInteger.TWO.pow(100); // exact
System.out.println(big);                  // 1267650600228229401496703205376
```

```javascript
// JavaScript: BigInt with the `n` suffix
console.log(2n ** 100n); // 1267650600228229401496703205376n
console.log(9007199254740993n);          // exact; a plain Number can't hold this
```

```go
// Go: math/big
package main
import (
    "fmt"
    "math/big"
)
func main() {
    big1 := new(big.Int).Exp(big.NewInt(2), big.NewInt(100), nil)
    fmt.Println(big1) // 1267650600228229401496703205376
}
```

---

## Pros & Cons

### Fixed-point integers (store cents)

**Pros**
- Exact for addition and subtraction — no rounding at all.
- As fast as integer math (it *is* integer math).
- Trivially serializable, comparable, sortable.
- Works in every language with no library.

**Cons**
- You must remember and enforce the scale ("this is cents") everywhere.
- Multiplication and division need care (covered in `middle.md`) — multiplying two "cents" values double-scales the result.
- A fixed `int64` can still overflow for very large totals (rare for money, real for some domains).

### Decimal types (`BigDecimal`, `Decimal`)

**Pros**
- Exact base-10 arithmetic with flexible precision.
- Built-in, controllable rounding rules.
- Reads naturally (`Decimal("19.99")` *is* 19.99).

**Cons**
- Slower than hardware floats (software, not a CPU instruction).
- Easy to misuse (constructing from a `double` re-introduces the binary error).
- More memory per value.

### Bignums

**Pros**
- Never overflow — exact answers for arbitrarily large numbers.
- Essential for cryptography, combinatorics, exact math.

**Cons**
- Slower and heavier than fixed-size ints — can quietly tank performance in a hot loop.
- In Python, *every* int is a bignum, so you pay this everywhere by default.

---

## Use Cases

- **Money and accounting:** fixed-point cents for ledgers; `Decimal`/`BigDecimal` for tax, interest, currency conversion. Never floats.
- **Embedded / DSP / audio:** fixed-point (Q-notation) when the chip has no fast floating-point unit. (More in `middle.md`.)
- **Game physics on a grid:** integer or fixed-point coordinates so two machines simulate *identically* (lockstep multiplayer needs bit-exact math, which floats can't guarantee across hardware).
- **Cryptography:** bignums — RSA keys are 2048+ bit integers; you *must* have arbitrary precision.
- **Combinatorics / math:** factorials, big powers, exact fractions — bignums and rationals.
- **Database IDs and counters:** sometimes exceed 64 bits; bignums or 128-bit types.

---

## Coding Patterns

**Pattern 1 — "Money is an integer count of minor units."** Pick the smallest unit (cents) and store everything as a whole number of them. Convert to a display string only when showing the user.

```python
def format_cents(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}${cents // 100}.{cents % 100:02d}"
```

**Pattern 2 — "Parse decimal input to cents safely."** Don't multiply a parsed float by 100 (that re-introduces float error). Parse with a decimal type, then convert.

```python
from decimal import Decimal
def to_cents(s: str) -> int:
    return int((Decimal(s) * 100).to_integral_value())  # "19.99" -> 1999
```

**Pattern 3 — "Construct decimals from strings, never from floats."** `Decimal("0.1")` is exact; `Decimal(0.1)` captures the binary error. Same warning for Java's `new BigDecimal("0.1")` vs `new BigDecimal(0.1)`.

**Pattern 4 — "A Money type, not a bare int."** Wrap the integer (and a currency code) in a small type/class so you can't accidentally add cents to dollars, or USD to EUR.

---

## Best Practices

1. **Never use `float`/`double` for money.** Not for storage, not for arithmetic, not even "just temporarily." This is the rule.
2. **Pick one representation per system and document it.** "All money is `int64` cents" or "all money is `BigDecimal` with scale 2." Mixing causes bugs.
3. **Construct decimals from strings.** `Decimal("0.1")`, `new BigDecimal("0.1")`. Never from a `double`.
4. **Round only at the boundary** (display, settlement, persistence to a fixed-scale column) — not in the middle of a calculation.
5. **Know your language's default.** Python ints are bignums (no overflow); Java/Go/C ints overflow silently. This changes which bugs you can hit.
6. **Don't compare floats (or money) with `==`.** For floats, compare within a tolerance. For money, use exact integer/decimal equality (which is safe *because* it's exact).
7. **Use the currency's real minor unit.** USD = 2 decimals, JPY = 0, some currencies/markets need 3 or 4. Hard-coding "always 2 decimals" is a bug for JPY.

---

## Edge Cases & Pitfalls

- **Constructing a decimal from a float.** `new BigDecimal(0.1)` in Java gives `0.1000000000000000055511151231257827021181583404541015625` — the binary error, captured forever. Always use the string constructor.
- **Multiplying two cent-values.** `priceCents * priceCents` gives "square cents," which is meaningless. Multiplication changes the scale; only multiply money by a *plain* quantity, and rescale carefully for percentages (see `middle.md`).
- **Float-to-int conversion truncates, not rounds.** `int(19.99 * 100)` in many languages gives `1998`, not `1999`, because `19.99 * 100` is actually `1998.9999...` in binary. Round explicitly, or parse with a decimal.
- **Silent integer overflow.** In C/Java/Go, a sum of money in `int64` *can* overflow for huge aggregates (national-scale totals in a tiny minor unit). It wraps to negative silently. Check, or use bignums/decimals.
- **JavaScript's `Number` can't hold all integers.** Past `2^53` (`9007199254740992`), plain JS numbers lose precision. Use `BigInt` for large integer IDs. A user ID arriving as JSON can silently corrupt.
- **JPY has no cents.** Storing yen "in cents" (×100) is wrong for the domain — there is no sub-yen unit. Use each currency's actual minor-unit count.
- **Bignums in a hot loop.** In Python, a tight numeric loop on big ints is far slower than on small ones, and you may not notice until the inputs grow. (Detailed in `senior.md`.)

---

## Summary

- Binary `float`/`double` **cannot represent most decimal fractions exactly** (0.1, 0.2, 0.3...), so they are wrong for money.
- **Fixed-point** = store the value as an integer scaled by a fixed factor (store cents). Exact, fast, simple. The decimal point lives in your conventions, not the data.
- **Decimal types** (`BigDecimal`, `Decimal`) do exact base-10 arithmetic with flexible precision — use them for tax, interest, conversions. Always build them from strings.
- **Bignums** are integers with no size limit — never overflow. Python uses them by default; other languages require explicit types (`BigInteger`, `BigInt`, `big.Int`).
- The rule that prevents an entire class of production bugs: **never store money in a float.**

---

## Further Reading

- David Goldberg, *What Every Computer Scientist Should Know About Floating-Point Arithmetic* (the canonical paper on why floats round).
- The Python `decimal` module documentation and its "floating-point notes."
- Martin Fowler, *Patterns of Enterprise Application Architecture* — the **Money** pattern.
- Your language's docs for `BigInteger` / `BigDecimal` / `big.Int` / `BigInt`.
- Next in this topic: `middle.md` for rounding rules, scale/precision, and Q-notation; `senior.md` for how bignum multiplication actually works.
