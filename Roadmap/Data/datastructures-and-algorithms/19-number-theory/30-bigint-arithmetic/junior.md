# Big Integer (Arbitrary-Precision) Arithmetic — Junior Level

> **One-line summary:** A *big integer* is a number too large to fit in a single machine word (`int`, `long`, `int64`). We store it as an **array of "digits"** — but the digits live in a big base such as `10^9` or `2^32`, so each array slot (a *limb*) holds many decimal digits at once. Then we re-implement grade-school **addition, subtraction, and multiplication** on those limb arrays, propagating **carries** (add) and **borrows** (subtract) exactly the way you learned in primary school — only the base is huge.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

A normal integer variable has a fixed size. A 64-bit signed integer (`long` in Java, `int64` in Go, formerly the cap of many languages) can only hold values up to `9_223_372_036_854_775_807` — about 19 decimal digits. Try to compute `100!` (the factorial of 100), the public modulus of an RSA key, or the 1000th Fibonacci number, and you blow straight past that limit. The variable **overflows**: it silently wraps around and gives you nonsense.

A **big integer** (also called *arbitrary-precision integer* or *bignum*) lifts that ceiling. Instead of one fixed-width slot, it uses **as many slots as the number needs**, growing on demand. A 300-digit number simply uses more memory than a 30-digit one. The number of digits is limited only by available RAM, not by the CPU's word size.

How do we store a 300-digit number when the CPU can only natively handle ~19 digits at a time? We do exactly what you do on paper: we **break the number into digits and store them in an array**. The clever twist is the *base*. On paper you use base 10, so each slot holds one digit `0–9`. A computer can do far better: it stores each slot ("limb") in a big base like `10^9` (one billion) or `2^32` (about four billion). Each limb is itself an ordinary machine integer, but it represents **nine decimal digits at once** (for base `10^9`). This packs the number tightly and makes the arithmetic fast.

Once the number is an array of limbs, every operation is the grade-school algorithm you already know:

- **Addition**: add the matching limbs, carry the overflow into the next position.
- **Subtraction**: subtract matching limbs, borrow from the next position when needed.
- **Multiplication**: the "long multiplication" you learned — multiply each limb of one number by each limb of the other and add up the shifted partial products.

This junior file focuses on that foundation: the **limb-array representation**, and **addition, subtraction, and schoolbook (`O(n²)`) multiplication** on small, hand-checkable examples. Faster multiplication (Karatsuba, FFT) is the subject of the middle and senior files.

Why does any of this matter? Because big integers are everywhere underneath the things you use:

- **Cryptography** — RSA and Diffie–Hellman do arithmetic on 2048-bit or 4096-bit numbers (hundreds of digits).
- **Exact arithmetic** — Python's `int`, Java's `BigInteger`, and Go's `math/big` never overflow; your scripts "just work" on huge numbers because a bignum library runs underneath.
- **Combinatorics** — factorials, binomial coefficients, and Catalan numbers explode in size fast (cross-link `23-binomial-coefficients`, `25-catalan-numbers`).
- **Competitive programming** — many problems ask for exact answers far beyond 64 bits.

---

## Prerequisites

Before reading this file you should be comfortable with:

- **Arrays / slices / lists** in at least one of Go, Java, Python — indexing, length, appending.
- **Loops and conditionals** — you will write nested loops for multiplication.
- **Grade-school arithmetic** — column addition with carry, column subtraction with borrow, long multiplication. (Yes, primary-school math. It is the whole algorithm.)
- **Integer division and modulo** (`/` and `%`) — to split a sum into a digit and a carry.
- **The idea of a *base*** — that `573` in base 10 means `3 + 7·10 + 5·100`. We generalize the base.
- **Big-O notation** — `O(n)`, `O(n²)`, where `n` is the number of limbs.

Optional but helpful:

- Awareness that machine integers **overflow** (wrap around) — this is the exact problem big integers solve.
- A glance at positional numeral systems (`02-modular-arithmetic` touches base ideas).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Big integer / bignum** | An integer of arbitrary size, stored as an array of limbs rather than a single machine word. |
| **Limb** | One element of the digit array. Holds a "digit" in a large base (e.g. one value `0 … 10^9−1`). |
| **Base `B`** | The radix of each limb. Common choices: `10^9` (decimal-friendly) or `2^32` / `2^64` (binary, fast). |
| **Carry** | The overflow from one column's addition that must be added into the next-higher column. |
| **Borrow** | The deficit in a column's subtraction that must be taken from the next-higher column. |
| **Little-endian limbs** | Storing the *least*-significant limb at index 0. Standard for bignum libraries (easy carry flow). |
| **Normalization** | Removing leading zero limbs so the length reflects the true magnitude. |
| **Schoolbook multiplication** | The classic `O(n²)` "multiply each digit by each digit and add" algorithm. |
| **Sign / magnitude** | Storing the absolute value as limbs plus a separate sign flag. |
| **Overflow** | When a fixed-width integer exceeds its capacity and wraps around — the bug bignums avoid. |
| **`n`** | Throughout, the number of limbs (the "length" of the big integer). |

---

## Core Concepts

### 1. A Number Is an Array of Limbs

Pick a base `B`. The big integer `x` is stored as limbs `d[0], d[1], …, d[n−1]` with each `0 ≤ d[i] < B`, meaning

```
x = d[0] + d[1]·B + d[2]·B² + … + d[n−1]·B^(n−1).
```

We store **least-significant first** (little-endian): `d[0]` is the "ones" limb. This makes carries flow naturally from low index to high index, just like writing addition with the ones column on the right.

**Example (base `B = 1000`, so 3 decimal digits per limb).** The number `123456789` becomes:

```
123456789 = 789 + 456·1000 + 123·1000²
           → limbs (little-endian): [789, 456, 123]
```

Read it back-to-front and you literally see the original digits: `123 | 456 | 789`. Real libraries use `B = 10^9` (9 digits per limb) or `B = 2^32`; we use small bases here so the examples fit on the page.

### 2. Choosing the Base

| Base | Limb holds | Best for |
|------|-----------|----------|
| `10` | one decimal digit | teaching only — wastes space |
| `10^9` | nine decimal digits | easy to print in decimal, fits in 32-bit limb; product of two limbs fits in 64-bit |
| `2^32` | a 32-bit chunk | fastest binary arithmetic; product fits in 64-bit |
| `2^64` | a 64-bit chunk | maximum density, but needs 128-bit multiply support |

The rule of thumb: pick the **largest base whose limb-times-limb product still fits in a wider native type**. With `B = 10^9`, two limbs multiply to `< 10^18`, which fits in a 64-bit integer — no overflow during multiplication. That is why `10^9` and `2^32` are the everyday choices.

### 3. Addition With Carry

Add limb by limb from index 0 upward. At each position, sum the two limbs plus the incoming carry; the *digit* you keep is `sum % B`, and the *carry* you pass on is `sum / B` (which is 0 or 1 when `B` is the limb base).

```
for i in 0 .. max_len-1:
    s = a[i] + b[i] + carry
    result[i] = s % B
    carry     = s / B
if carry > 0: append carry as a new top limb
```

The result can be **one limb longer** than the longer input (the final carry). That is the bignum version of "9 + 1 = 10 needs an extra column."

### 4. Subtraction With Borrow

For `a − b` with `a ≥ b`, go limb by limb subtracting `b[i]` and any borrow. If the result goes negative, add `B` and set borrow = 1 for the next column.

```
for i in 0 .. len-1:
    diff = a[i] - b[i] - borrow
    if diff < 0: diff += B; borrow = 1
    else:        borrow = 0
    result[i] = diff
normalize(result)   # drop leading zero limbs
```

If `a < b`, swap them, subtract, and flip the sign — that is why a real bignum keeps a sign flag.

### 5. Schoolbook (Long) Multiplication

Multiply every limb of `a` by every limb of `b`. The product of limbs at positions `i` and `j` contributes to result position `i + j` (just like "tens × hundreds = thousands"). Accumulate everything, then propagate carries.

```
result = array of zeros, length len(a)+len(b)
for i in 0 .. len(a)-1:
    carry = 0
    for j in 0 .. len(b)-1:
        cur = result[i+j] + a[i]*b[j] + carry
        result[i+j] = cur % B
        carry       = cur / B
    result[i+len(b)] += carry
normalize(result)
```

Two `n`-limb numbers do `n × n` limb multiplications — hence **`O(n²)`**. For small numbers this is perfectly fine and is what every library uses below a size threshold. Beating `O(n²)` is the job of Karatsuba and FFT (middle / senior files).

### 6. Comparison and Normalization

To compare two big integers: first compare lengths (after normalizing — fewer limbs means smaller, assuming no leading zeros); if equal, compare limbs from the **most**-significant down to the first difference. **Normalization** (stripping leading zero limbs) must happen after subtraction and multiplication so that length is a reliable size signal and `[0]` (the number zero) is stored consistently.

---

## Big-O Summary

Let `n` and `m` be the limb counts of the two operands.

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| Compare | O(max(n, m)) | O(1) | length first, then limb-by-limb |
| Add | O(max(n, m)) | O(max(n, m)) | one carry pass |
| Subtract | O(max(n, m)) | O(max(n, m)) | one borrow pass |
| Multiply (schoolbook) | **O(n·m)** = O(n²) | O(n + m) | nested loops |
| Multiply (Karatsuba) | O(n^1.585) | O(n) | middle file |
| Multiply (FFT/NTT) | O(n log n) | O(n) | senior file; see `15-ntt` |
| Long division | O(n·m) | O(n) | quotient digit by digit |
| Base conversion (e.g. → decimal) | O(n²) naive | O(n) | repeated divide; faster with divide-and-conquer |

For this junior level, remember the two headline numbers: **add/subtract are linear `O(n)`**, **schoolbook multiply is quadratic `O(n²)`**.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Limb array | An abacus with many rods; each rod (limb) counts up to base `B` before "carrying" to the next rod. |
| Base `10^9` per limb | Packing nine playing cards into one box, so you carry fewer boxes than loose cards. |
| Carry in addition | Filling a 10-egg carton: the 11th egg starts a new carton (carry to the next column). |
| Borrow in subtraction | Breaking a $10 bill into ten $1 bills because you need to pay $3 from an empty $1 pile. |
| Schoolbook multiply | Long multiplication on paper — multiply, shift, add the partial products. |
| Normalization | Erasing leading zeros so "007" is written as "7". |
| Sign + magnitude | A thermometer: the number's size is the magnitude, the `+/−` is a separate marker. |

Where the analogy breaks: a CPU limb is **far** bigger than a single abacus bead (a billion values, not ten), and carries propagate in a tight loop rather than one bead at a time.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| No overflow — handles numbers of any size up to available memory. | Far slower than native `int64` (every op touches an array). |
| Exact results — no floating-point rounding error. | Uses more memory (one limb per ~9 digits, plus object overhead). |
| Foundation for cryptography, combinatorics, exact math. | Schoolbook multiply is `O(n²)` — slow for very large numbers. |
| Simple algorithms (add/sub/mul are grade-school). | Hand-rolling one correctly is error-prone (carry/borrow/sign bugs). |
| Built into Python (`int`), Java (`BigInteger`), Go (`math/big`). | Not constant-time by default — a hazard for cryptography (senior file). |

**When to use:** any time a value can exceed 64 bits — factorials, large Fibonacci, RSA-sized numbers, exact rational/combinatorial math, or competitive-programming "print the exact answer" problems.

**When NOT to use:** when the value provably fits in `int64`, or when you only need the answer *modulo* a small number (then use modular arithmetic — `02-modular-arithmetic` — which stays in machine words and is much faster).

---

## Step-by-Step Walkthrough

We use base `B = 1000` (3 decimal digits per limb) so every step is hand-checkable.

### Addition: `923_456 + 88_999`

Limbs (little-endian):

```
a = 923456 → [456, 923]
b =  88999 → [999,  88]
```

| Position | a[i] | b[i] | carry-in | sum | digit (sum%1000) | carry-out (sum/1000) |
|:--------:|:----:|:----:|:--------:|:---:|:----------------:|:--------------------:|
| 0 | 456 | 999 | 0 | 1455 | **455** | 1 |
| 1 | 923 | 88  | 1 | 1012 | **012** | 1 |
| 2 | —   | —   | 1 | 1    | **001** | 0 |

Result limbs: `[455, 12, 1]` → read high-to-low: `1 | 012 | 455` = `1_012_455`. Check: `923456 + 88999 = 1012455`. ✓ Notice the result grew by one limb because of the final carry.

### Subtraction: `1_012_455 − 88_999`

```
a = 1012455 → [455, 12, 1]
b =   88999 → [999, 88, 0]
```

| Position | a[i] | b[i] | borrow-in | diff | result (+1000 if negative) | borrow-out |
|:--------:|:----:|:----:|:---------:|:----:|:--------------------------:|:----------:|
| 0 | 455 | 999 | 0 | −544 | **456** (−544+1000) | 1 |
| 1 | 12  | 88  | 1 | −77  | **923** (−77+1000)  | 1 |
| 2 | 1   | 0   | 1 | 0    | **0**               | 0 |

Result limbs: `[456, 923, 0]` → normalize (drop the leading 0) → `[456, 923]` = `923_456`. ✓ (We got back the number we started the addition from.)

### Schoolbook Multiplication: `456 × 789` (single-limb operands, base 1000)

Both fit in one limb, but the *product* `456 × 789 = 359784` exceeds the base, so it spreads across two result limbs:

```
result has length 2, start [0, 0]
i=0, j=0: cur = 0 + 456*789 + 0 = 359784
          result[0] = 359784 % 1000 = 784
          carry      = 359784 / 1000 = 359
result[0+1] += carry → result[1] = 359
```

Result limbs: `[784, 359]` → `359 | 784` = `359_784`. ✓

### Schoolbook Multiplication: `1_234 × 5_678` (two limbs each)

```
a = 1234 → [234, 1]      b = 5678 → [678, 5]
```

Outer `i=0` (a[0]=234), carry=0:
- `j=0`: `234·678 = 158652` → `result[0]=652`, carry=158
- `j=1`: `234·5 + 158 = 1328` → `result[1]=328`, carry=1
- spill: `result[2] += 1`

State: `[652, 328, 1, 0]`.

Outer `i=1` (a[1]=1), carry=0:
- `j=0`: `result[1] + 1·678 + 0 = 328 + 678 = 1006` → `result[1]=6`, carry=1
- `j=1`: `result[2] + 1·5 + 1 = 1 + 5 + 1 = 7` → `result[2]=7`, carry=0
- spill: `result[3] += 0`

Final limbs: `[652, 6, 7, 0]` → normalize → `[652, 6, 7]` = `7 | 006 | 652` = `7_006_652`. Check: `1234 × 5678 = 7006652`. ✓ Two 2-limb numbers needed `2×2 = 4` limb multiplications — the `O(n²)` cost in action.

---

## Code Examples

We implement a minimal bignum with base `B = 1_000_000_000` (`10^9`, nine decimal digits per limb). Limb products fit in 64 bits (`< 10^18`). Limbs are little-endian. These examples handle **non-negative** numbers; signed handling is discussed in the middle file.

### Example: Add, Subtract, and Schoolbook-Multiply

#### Go

```go
package main

import (
	"fmt"
	"strings"
)

const Base = 1_000_000_000 // 10^9

// normalize drops trailing (most-significant) zero limbs, keeping at least [0].
func normalize(a []int64) []int64 {
	for len(a) > 1 && a[len(a)-1] == 0 {
		a = a[:len(a)-1]
	}
	return a
}

// add returns a + b (both non-negative, little-endian limbs).
func add(a, b []int64) []int64 {
	n := len(a)
	if len(b) > n {
		n = len(b)
	}
	res := make([]int64, 0, n+1)
	var carry int64 = 0
	for i := 0; i < n; i++ {
		var s int64 = carry
		if i < len(a) {
			s += a[i]
		}
		if i < len(b) {
			s += b[i]
		}
		res = append(res, s%Base)
		carry = s / Base
	}
	if carry > 0 {
		res = append(res, carry)
	}
	return normalize(res)
}

// sub returns a - b, assuming a >= b.
func sub(a, b []int64) []int64 {
	res := make([]int64, len(a))
	var borrow int64 = 0
	for i := 0; i < len(a); i++ {
		diff := a[i] - borrow
		if i < len(b) {
			diff -= b[i]
		}
		if diff < 0 {
			diff += Base
			borrow = 1
		} else {
			borrow = 0
		}
		res[i] = diff
	}
	return normalize(res)
}

// mul returns a * b using the O(n*m) schoolbook algorithm.
func mul(a, b []int64) []int64 {
	res := make([]int64, len(a)+len(b))
	for i := 0; i < len(a); i++ {
		var carry int64 = 0
		for j := 0; j < len(b); j++ {
			cur := res[i+j] + a[i]*b[j] + carry
			res[i+j] = cur % Base
			carry = cur / Base
		}
		res[i+len(b)] += carry
	}
	return normalize(res)
}

// toString prints little-endian limbs as a decimal number.
func toString(a []int64) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("%d", a[len(a)-1])) // top limb: no leading zeros
	for i := len(a) - 2; i >= 0; i-- {
		sb.WriteString(fmt.Sprintf("%09d", a[i])) // lower limbs: pad to 9 digits
	}
	return sb.String()
}

func main() {
	a := []int64{234, 1}    // 1234
	b := []int64{678, 5}    // 5678 (note: each < 10^9, here values are small)
	fmt.Println(toString(add(a, b))) // 6912
	fmt.Println(toString(mul(a, b))) // 7006652
}
```

#### Java

```java
import java.util.Arrays;

public class BigIntBasics {
    static final long BASE = 1_000_000_000L; // 10^9

    static long[] normalize(long[] a) {
        int n = a.length;
        while (n > 1 && a[n - 1] == 0) n--;
        return Arrays.copyOf(a, n);
    }

    static long[] add(long[] a, long[] b) {
        int n = Math.max(a.length, b.length);
        long[] res = new long[n + 1];
        long carry = 0;
        for (int i = 0; i < n; i++) {
            long s = carry;
            if (i < a.length) s += a[i];
            if (i < b.length) s += b[i];
            res[i] = s % BASE;
            carry = s / BASE;
        }
        res[n] = carry;
        return normalize(res);
    }

    static long[] sub(long[] a, long[] b) { // assumes a >= b
        long[] res = new long[a.length];
        long borrow = 0;
        for (int i = 0; i < a.length; i++) {
            long diff = a[i] - borrow - (i < b.length ? b[i] : 0);
            if (diff < 0) { diff += BASE; borrow = 1; } else borrow = 0;
            res[i] = diff;
        }
        return normalize(res);
    }

    static long[] mul(long[] a, long[] b) { // O(n*m) schoolbook
        long[] res = new long[a.length + b.length];
        for (int i = 0; i < a.length; i++) {
            long carry = 0;
            for (int j = 0; j < b.length; j++) {
                long cur = res[i + j] + a[i] * b[j] + carry;
                res[i + j] = cur % BASE;
                carry = cur / BASE;
            }
            res[i + b.length] += carry;
        }
        return normalize(res);
    }

    static String toStr(long[] a) {
        StringBuilder sb = new StringBuilder(Long.toString(a[a.length - 1]));
        for (int i = a.length - 2; i >= 0; i--) sb.append(String.format("%09d", a[i]));
        return sb.toString();
    }

    public static void main(String[] args) {
        long[] a = {234, 1};  // 1234
        long[] b = {678, 5};  // 5678
        System.out.println(toStr(add(a, b))); // 6912
        System.out.println(toStr(mul(a, b))); // 7006652
    }
}
```

#### Python

```python
BASE = 10 ** 9  # one billion: nine decimal digits per limb


def normalize(a):
    while len(a) > 1 and a[-1] == 0:
        a.pop()
    return a


def add(a, b):
    res, carry = [], 0
    for i in range(max(len(a), len(b))):
        s = carry + (a[i] if i < len(a) else 0) + (b[i] if i < len(b) else 0)
        res.append(s % BASE)
        carry = s // BASE
    if carry:
        res.append(carry)
    return normalize(res)


def sub(a, b):  # assumes a >= b
    res, borrow = [], 0
    for i in range(len(a)):
        diff = a[i] - borrow - (b[i] if i < len(b) else 0)
        if diff < 0:
            diff += BASE
            borrow = 1
        else:
            borrow = 0
        res.append(diff)
    return normalize(res)


def mul(a, b):  # O(n*m) schoolbook
    res = [0] * (len(a) + len(b))
    for i in range(len(a)):
        carry = 0
        for j in range(len(b)):
            cur = res[i + j] + a[i] * b[j] + carry
            res[i + j] = cur % BASE
            carry = cur // BASE
        res[i + len(b)] += carry
    return normalize(res)


def to_str(a):
    s = str(a[-1])
    for limb in reversed(a[:-1]):
        s += f"{limb:09d}"
    return s


if __name__ == "__main__":
    a = [234, 1]   # 1234
    b = [678, 5]   # 5678
    print(to_str(add(a, b)))  # 6912
    print(to_str(mul(a, b)))  # 7006652
```

**What it does:** stores numbers as base-`10^9` little-endian limb arrays and implements add, subtract, and schoolbook multiply with proper carry/borrow handling and normalization.
**Run:** `go run main.go` | `javac BigIntBasics.java && java BigIntBasics` | `python bigint.py`

---

## Coding Patterns

### Pattern 1: Parse a Decimal String Into Limbs

**Intent:** Real input is a decimal string; chunk it from the right into groups of 9 digits, each group becoming one base-`10^9` limb.

```python
def from_string(s):
    s = s.lstrip("0") or "0"
    limbs = []
    while s:
        limbs.append(int(s[-9:]))   # take last 9 digits as one limb
        s = s[:-9]
    return limbs or [0]
```

This is the inverse of `to_str`. Together they let you read big numbers in and print them out.

### Pattern 2: Multiply by a Single Limb (cheap special case)

**Intent:** Multiplying a bignum by a small number (e.g. inside a factorial loop) is `O(n)`, not `O(n²)`.

```python
def mul_small(a, k):  # k fits in one limb
    res, carry = [], 0
    for limb in a:
        cur = limb * k + carry
        res.append(cur % BASE)
        carry = cur // BASE
    while carry:
        res.append(carry % BASE)
        carry //= BASE
    return normalize(res)
```

### Pattern 3: Compare Two Bignums

**Intent:** Decide order without subtracting. Compare lengths, then top-down limbs.

```python
def cmp(a, b):  # -1, 0, +1  (assumes normalized)
    if len(a) != len(b):
        return -1 if len(a) < len(b) else 1
    for i in range(len(a) - 1, -1, -1):
        if a[i] != b[i]:
            return -1 if a[i] < b[i] else 1
    return 0
```

```mermaid
graph TD
    S["Decimal string"] -->|parse, chunk by 9| L["Limb array, little-endian"]
    L -->|add / sub: one carry/borrow pass O(n)| R1["Result limbs"]
    L -->|mul: nested loops O(n^2)| R2["Product limbs"]
    R1 --> N["normalize: drop leading zeros"]
    R2 --> N
    N -->|format, pad lower limbs to 9 digits| OUT["Decimal string output"]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Overflow during limb multiply | Limb product exceeds the wider type | Keep `B ≤ 10^9` so `limb*limb < 10^18` fits in 64-bit; or use 128-bit |
| Negative subtraction result | `a < b` but you assumed `a ≥ b` | Compare first; if `a < b`, compute `b − a` and flip the sign |
| Wrong printed digits | Lower limbs not zero-padded | Pad every non-top limb to the base's digit width (e.g. `%09d`) |
| Stray leading zeros | Forgot to normalize after sub/mul | Call `normalize` (drop top zero limbs) after every op that can shrink |
| Reading garbage from short input | Indexing past array length | Treat missing limbs as `0` (`i < len(a) ? a[i] : 0`) |
| `0` represented as empty array | Stripped all limbs | Keep at least one limb `[0]` for the value zero |

---

## Performance Tips

- **Use a big base.** `B = 10^9` packs nine decimal digits per limb, so a 900-digit number is only ~100 limbs — 9× fewer iterations than base 10.
- **Special-case small multipliers.** Multiplying by an `int` is `O(n)` (Pattern 2); don't promote the small number to a full bignum and run `O(n²)`.
- **Reserve capacity.** Pre-size result arrays (`len(a)+len(b)` for multiply) to avoid repeated reallocation.
- **Reduce `%`/`/` pressure.** With base `2^32` you can replace `% B` and `/ B` with bit-mask and shift — much faster than decimal division.
- **Reach for the library.** For real work, Python `int`, Java `BigInteger`, and Go `math/big` are heavily optimized (they switch to Karatsuba/FFT automatically). Hand-roll only to *learn* or when you need a custom guarantee.

---

## Best Practices

- Always **normalize** after subtraction and multiplication so length reliably encodes magnitude.
- Store limbs **little-endian** (least significant at index 0); it makes carry/borrow loops natural.
- Keep the value **zero** as a single `[0]` limb, never an empty array.
- Treat **out-of-range indices as 0** when operands have different lengths.
- Separate **sign** from **magnitude**; implement unsigned add/sub/mul first, then layer signs on top (middle file).
- **Test against the language's native bignum** (`big.Int`, `BigInteger`, Python `int`) on thousands of random inputs — that is the cheapest correctness oracle you have.
- Pick the **largest base** whose limb product still fits a native wide type.

---

## Edge Cases & Pitfalls

- **Zero operands** — `0 + x`, `x − x = 0`, `0 · x = 0` must all normalize to `[0]`, not an empty array.
- **Different lengths** — adding a 2-limb and a 50-limb number: pad the shorter with implicit zeros.
- **Final carry** — addition can grow the result by exactly one limb; allocate room for it.
- **`a < b` in subtraction** — guard with a comparison; naive subtraction underflows.
- **Single-limb product overflowing the base** — `456 × 789` spills into two limbs even though both inputs are one limb.
- **Leading-zero input strings** — `"007"` must parse to `[7]`, not `[7,0]`.
- **Base too large** — `B = 2^63` makes `limb*limb` overflow 64-bit; the multiply silently corrupts.

---

## Common Mistakes

1. **Forgetting the final carry** in addition — the top limb is lost, the result is too small.
2. **Not normalizing** — leftover zero limbs break comparison-by-length.
3. **Assuming `a ≥ b`** in subtraction without checking — silent underflow / wrong sign.
4. **Wrong padding when printing** — `[5, 0, 1]` (base `10^9`) printed as `501` instead of `1000000005`.
5. **Big-endian confusion** — mixing up which index is the ones place; carries then flow the wrong way.
6. **Base too big** — choosing `B = 2^64` and overflowing on `limb*limb` without 128-bit support.
7. **Promoting a small int to a bignum** for multiplication — runs `O(n²)` when `O(n)` suffices.

---

## Cheat Sheet

| Task | Rule |
|------|------|
| Store `x` | little-endian limbs, `x = Σ d[i]·B^i`, each `0 ≤ d[i] < B` |
| Pick base | largest `B` with `B·B` fitting a native wide type (`10^9`, `2^32`) |
| Add | `s = a[i]+b[i]+carry`; `digit = s%B`; `carry = s/B`; append final carry |
| Subtract (`a≥b`) | `d = a[i]−b[i]−borrow`; if `d<0`: `d+=B, borrow=1`; normalize |
| Multiply | `res[i+j] += a[i]*b[j] + carry`; `O(n²)` |
| Compare | length first, then top-down limbs |
| Print | top limb plain, lower limbs zero-padded to base width |
| Zero | exactly `[0]` |

Core algorithms:

```text
add(a, b):
    carry = 0
    for i in 0 .. max(len a, len b)-1:
        s = (a[i]||0) + (b[i]||0) + carry
        res[i] = s mod B;  carry = s div B
    if carry: append carry
    return normalize(res)

mul(a, b):                       # schoolbook, O(n*m)
    res = zeros(len a + len b)
    for i in 0 .. len a-1:
        carry = 0
        for j in 0 .. len b-1:
            cur = res[i+j] + a[i]*b[j] + carry
            res[i+j] = cur mod B;  carry = cur div B
        res[i+len b] += carry
    return normalize(res)
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - Two numbers laid out as **limb arrays**, with the carry flowing left through an **addition**.
> - **Schoolbook multiplication** showing each `a[i]·b[j]` partial product landing in result position `i+j`.
> - A side-by-side **Karatsuba split** view (three half-size multiplies instead of four) to preview the `O(n^1.585)` idea.
> - Play / Step / Reset controls, an info panel, a Big-O table, and an operation log.

---

## Summary

A big integer is just an **array of limbs** in a large base (`10^9` or `2^32`), interpreted little-endian as `x = Σ d[i]·B^i`. Once you have that representation, arithmetic is the grade-school method you already know: **addition** sweeps limbs left-to-right propagating a **carry** (`O(n)`); **subtraction** does the same with a **borrow** (`O(n)`); **schoolbook multiplication** multiplies every limb-pair into position `i+j` and propagates carries (`O(n²)`). The non-obvious details are choosing a base whose limb products don't overflow, **normalizing** away leading zeros, handling **sign** separately, and zero-padding lower limbs when printing. This foundation underlies cryptography, exact combinatorics, and competitive programming — and is what Python's `int`, Java's `BigInteger`, and Go's `math/big` do for you under the hood. The next levels speed multiplication up dramatically with Karatsuba and FFT.

---

## Further Reading

- Sibling topic `29-binary-exponentiation` — fast powers, which call big-int multiply repeatedly.
- Sibling topic `02-modular-arithmetic` — when you only need the answer mod `m` and can stay in machine words.
- Sibling topic `23-binomial-coefficients`, `25-catalan-numbers` — combinatorics that overflow without bignums.
- Sibling topic `15-ntt` — the basis for `O(n log n)` big-int multiplication (senior file).
- Knuth, *The Art of Computer Programming, Vol. 2 (Seminumerical Algorithms)* — the classic reference on multiple-precision arithmetic.
- Go `math/big`, Java `java.math.BigInteger`, Python `int` (CPython `Objects/longobject.c`) source — production implementations.
- cp-algorithms.com — "Arbitrary-Precision Arithmetic".

**Next step:** [middle.md](./middle.md) — Karatsuba multiplication, base/limb choice, long division, signed handling, and bignum vs language built-ins.
