# Integer Representation & Overflow — Junior Level

> **Topic:** [Integer Representation & Overflow](README.md)
> **Focus:** What an integer *actually is* in memory — just a fixed number of bits — and what happens when you ask those bits to hold a number that doesn't fit.

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
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **An integer in a computer is not "a number." It is a fixed-size box of bits.** Understanding the box — how wide it is, how it encodes negatives, and what happens when a value is too big for it — is the whole topic.

When you write `int x = 5;`, you imagine a number `5` living in a variable. The hardware sees something more literal: a small, fixed run of binary digits — say 32 of them — set to `00000000 00000000 00000000 00000101`. That box has a maximum capacity. A 32-bit signed integer can hold values from about **−2.1 billion to +2.1 billion** and *not one more*. Ask it to hold 2,147,483,648 and it cannot; instead of erroring, on most languages it silently **wraps around** to −2,147,483,648. The odometer rolled over.

This single fact — **integers have a finite width, and arithmetic that exceeds it does something other than what math says** — is responsible for an astonishing number of real bugs: a flight-control system that needed rebooting every 248 days, a video that broke YouTube's view counter, a financial calculation that flipped a balance negative, and a long list of security vulnerabilities where an attacker made a size calculation wrap to a tiny number and then wrote past the end of a buffer.

In one sentence: **a computer integer is a clock face — count past the top and you land back at the bottom.** Everything in this page is a consequence of that.

> 🎓 **Why this matters for a junior:** You will reach for `int` thousands of times in your career. Most of the time it just works, which is exactly why the day it *doesn't* — a counter wrapping, a `length * size` multiplication overflowing, a negative number compared against an unsigned one — you will be utterly baffled unless you already know what's happening underneath. Ten minutes of understanding now saves you a day of debugging later.

This page covers: how bits encode unsigned and signed integers, why negatives are stored in "two's complement," what the different widths (8/16/32/64) mean, what **overflow** is, and how five mainstream languages (C, Java, Python, Go, Rust) each react to it — because they react *very* differently. The next level (`middle.md`) goes deep on overflow detection and conversion bugs; `senior.md` covers cross-language internals and the `INT_MIN` traps; `professional.md` covers real CVEs, security, and production debugging.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to declare a variable and do arithmetic (`+ - * /`) in at least one language (C, Java, Python, Go, or Rust).
- **Required:** What a `for` loop and a counter variable are.
- **Helpful but not required:** A vague sense that data in a computer is stored as bits (0s and 1s).
- **Helpful but not required:** Knowing what "binary" means — base-2 counting. We'll re-explain it.

You do **not** need to know:

- How the CPU's adder circuit works at the gate level (that's an internals detail, touched in `senior.md`).
- Floating-point numbers — those are a *different* representation with their own page. This page is integers only.
- Undefined behavior subtleties in the C standard (that's `middle.md` / `senior.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Bit** | A single binary digit: `0` or `1`. The atom of all data. |
| **Byte** | 8 bits. The smallest individually-addressable unit of memory. |
| **Integer** | A whole number with no fractional part, stored in a fixed number of bits. |
| **Width / size** | How many bits an integer occupies: 8, 16, 32, or 64. Determines its range. |
| **Unsigned** | An integer that can only be ≥ 0. All its bits encode magnitude. |
| **Signed** | An integer that can be negative or positive. One bit's worth of range is "spent" representing the sign. |
| **Two's complement** | The near-universal scheme for encoding signed integers in binary. Explained below. |
| **MSB (most significant bit)** | The leftmost, highest-value bit. In two's complement signed integers, it acts as the sign bit. |
| **LSB (least significant bit)** | The rightmost, lowest-value bit (the "ones" place). |
| **Range** | The set of values a given integer type can hold, e.g. `[−128, 127]` for a signed 8-bit. |
| **Overflow** | When an arithmetic result is larger than the type's maximum (or smaller than its minimum). |
| **Wraparound** | What overflow does in many languages: the value "rolls over" past the max back to the min (or vice versa), like an odometer. |
| **Modular arithmetic** | Arithmetic "mod 2ⁿ" — exactly what unsigned wraparound is. `255 + 1 == 0` for an 8-bit unsigned. |
| **`MAX` / `MIN`** | The largest and smallest value a type holds, e.g. `INT_MAX`, `Integer.MAX_VALUE`. |
| **Undefined behavior (UB)** | In C/C++, the standard says signed overflow has *no defined result* — the program may do anything. A serious trap. |

---

## Core Concepts

### 1. Binary: How Bits Make a Number (Unsigned)

In our everyday base-10 system, the digits of `253` mean `2×100 + 5×10 + 3×1`. Binary is the same idea with base 2: each position is a power of two. An unsigned 8-bit integer has 8 positions worth `128 64 32 16 8 4 2 1`:

```text
   bit:   1   1   1   1   1   1   0   1
 place: 128  64  32  16   8   4   2   1
        128 +64 +32 +16  +8  +4  +0  +1   = 253
```

So `11111101` in binary is 253. An **unsigned 8-bit** integer can hold the patterns from `00000000` (0) to `11111111` (255). That's **256 distinct values: 0 through 255**. In general, an n-bit unsigned integer holds `0` to `2ⁿ − 1`.

| Width | Unsigned range |
|-------|----------------|
| 8-bit | 0 … 255 |
| 16-bit | 0 … 65,535 |
| 32-bit | 0 … 4,294,967,295 (~4.3 billion) |
| 64-bit | 0 … 18,446,744,073,709,551,615 (~1.8×10¹⁹) |

### 2. How Do We Store Negative Numbers? (Two's Complement)

We need negatives too. The clever, universal trick is **two's complement**. Here's the rule for a signed n-bit integer: the **top bit's place value is made negative**. For a signed 8-bit, instead of the top bit meaning `+128`, it means `−128`:

```text
   bit:   1   0   0   0   0   0   0   0
 place:-128  64  32  16   8   4   2   1
       -128 + 0 ...                       = -128   (the most negative value)

   bit:   1   1   1   1   1   1   1   1
 place:-128  64  32  16   8   4   2   1
       -128 +64 +32 +16 +8 +4 +2 +1       = -1     (all ones = negative one)
```

So a signed 8-bit integer ranges from **−128 to +127**. Notice the asymmetry: there is **one more negative number than positive**, because zero takes up a slot on the "positive" side. Hold onto that — it causes a famous bug we'll meet later.

| Width | Signed range (two's complement) |
|-------|----------------------------------|
| 8-bit | −128 … 127 |
| 16-bit | −32,768 … 32,767 |
| 32-bit | −2,147,483,648 … 2,147,483,647 |
| 64-bit | −9,223,372,036,854,775,808 … 9,223,372,036,854,775,807 |

### 3. Why Two's Complement and Not Something Simpler?

A natural first idea is "use the top bit as a plus/minus sign and the rest as the magnitude" (called *sign-magnitude*). It seems obvious — but it's a mess in hardware:

- It has **two zeros**: `00000000` (+0) and `10000000` (−0). Now equality checks and loops have to special-case "is this the other zero?"
- **Addition needs special logic.** To add a positive and a negative you have to inspect the signs and decide whether to add or subtract magnitudes.

Two's complement fixes both:

- **Exactly one zero.** `00000000` is the only zero.
- **Addition just works.** The CPU adds the bit patterns as if they were unsigned, throws away any carry off the top, and the answer is correct for signed numbers too. `(-1) + 1`: `11111111 + 00000001 = 1 00000000`, drop the carried `1`, get `00000000 = 0`. The *same adder circuit* handles signed and unsigned. That hardware simplicity is why essentially every CPU since the 1970s uses two's complement.

### 4. Sign Extension: Widening a Number

When you copy a signed 8-bit value into a 32-bit slot, you can't just pad with zeros — `−1` is `11111111` in 8 bits, but `00000000 00000000 00000000 11111111` in 32 bits is **255**, not −1. To preserve the value you **copy the sign bit** into all the new high bits. `−1` becomes `11111111 11111111 11111111 11111111`. This is **sign extension**, and the hardware does it automatically when widening signed types. (Unsigned values just pad with zeros — "zero extension.")

### 5. Overflow: When the Box Is Too Small

Take a signed 8-bit `int` holding `127` (`01111111`) and add 1. Mathematically that's 128 — but 128 doesn't fit in `[−128, 127]`. Bit-wise, `01111111 + 1 = 10000000`, which in two's complement is **−128**. The number jumped from the most positive to the most negative. That's **overflow**, and the "rolling over" is **wraparound**.

```text
   ... 125  126  127  -128  -127 ...
                  ^      ^
                  └──────┘  +1 here wraps from +127 to -128
```

Unsigned overflow is the same odometer behavior at the top: an unsigned 8-bit `255 + 1 = 0`. And going below zero wraps the other way: unsigned `0 − 1 = 255`.

### 6. The Crucial Twist: Different Languages React Differently

This is the part juniors most need to internalize. **Overflow is not one behavior** — it depends entirely on your language:

| Language | Signed overflow does… |
|----------|------------------------|
| **C / C++** | **Undefined behavior.** The standard says *anything* may happen. The compiler may assume it never occurs and optimize accordingly. The most dangerous case. |
| **Java** | **Defined wraparound.** `Integer.MAX_VALUE + 1 == Integer.MIN_VALUE`. Silent but predictable. |
| **Go** | **Defined wraparound** (like Java). Silent, predictable, well-specified. |
| **Rust** | **Panics in debug builds** (crashes loudly so you catch it), **wraps in release builds** (for speed). Plus explicit `checked_add`, `wrapping_add`, `saturating_add`. |
| **Python** | **Never overflows.** Python integers grow to arbitrary size automatically. `2 ** 1000` just works. |
| **JavaScript** | Numbers are 64-bit floats; they lose precision past 2⁵³ rather than wrap. `BigInt` gives true arbitrary precision. |

The same line of code — `x + 1` — can crash, silently corrupt, or quietly produce a giant number, depending on the language. There is no universal answer; you must know your language's rule.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Fixed-width integer** | A car odometer with a fixed number of dials. |
| **Maximum value** | The odometer reading `999999`. |
| **Overflow / wraparound** | Driving one more mile: the odometer flips to `000000`. |
| **Unsigned** | An odometer that only counts up from 0 (mileage). |
| **Signed (two's complement)** | A thermometer that goes below zero — half the dial is negative. |
| **Two's complement's single zero** | One "0°" mark, not a separate "+0" and "−0". |
| **`INT_MIN` asymmetry** | A 12-hour clock where there's a 12 but you reach −11 differently than +11 — the range isn't symmetric. |
| **Truncation (narrowing)** | Pouring a gallon into a pint glass — most of it just doesn't fit, and you keep only the bottom part. |
| **Sign extension** | When you reformat "−5°" from a tiny display into a big one, you must keep the minus sign, not pad with blanks. |
| **Python's big integers** | A magic notebook where you can always add another page — it never runs out of room. |

---

## Mental Models

### The Clock / Odometer Model

The single best model: **integers live on a clock face (a ring), not a number line.** On a 12-hour clock, `11 o'clock + 2 hours = 1 o'clock` — you wrapped past 12. Computer integers are the same: count past the maximum and you land back at the minimum. For an unsigned 8-bit, the "clock" has 256 positions, `0` next to `255`. When you do arithmetic, imagine moving around the ring. Overflow is simply *crossing the seam* where max meets min.

### The "Box of N Bits" Model

Stop thinking of `int x` as "a number." Think of it as **a box exactly 32 bits wide**. Every operation must produce something that fits in 32 bits. If math wants to produce more, the extra bits *fall off the top* and are gone. Truncation, overflow, and wraparound are all the same phenomenon: bits that don't fit are discarded.

### The "Two Interpretations of the Same Bits" Model

The bit pattern `11111111` (8 bits) is **both** 255 (read as unsigned) **and** −1 (read as signed). The bits don't carry a label saying which they are — *the type tells the compiler how to read them.* This is why a value can change meaning when you reinterpret its type: nothing in memory moved, but the rule for reading it did. Carry this when you debug "why did my number suddenly become huge/negative?"

---

## Code Examples

We'll repeatedly take a value at the maximum and add 1, and watch each language react.

### C — Signed overflow is Undefined Behavior

```c
#include <stdio.h>
#include <limits.h>

int main(void) {
    int x = INT_MAX;          // 2147483647
    printf("INT_MAX   = %d\n", x);
    printf("INT_MAX+1 = %d\n", x + 1);   // UNDEFINED BEHAVIOR

    unsigned int u = UINT_MAX; // 4294967295
    printf("UINT_MAX   = %u\n", u);
    printf("UINT_MAX+1 = %u\n", u + 1);  // DEFINED: wraps to 0
    return 0;
}
```

On a typical compiler with no optimization you'll *see* `INT_MIN` printed for `x + 1`, which makes it look harmless. But it is **undefined behavior** — the compiler is allowed to assume signed overflow never happens and may delete an `if (x + 1 < x)` overflow check entirely. The unsigned case, by contrast, is *defined* to wrap to 0.

### Java — Defined silent wraparound

```java
public class Overflow {
    public static void main(String[] args) {
        int x = Integer.MAX_VALUE;     // 2147483647
        System.out.println(x);
        System.out.println(x + 1);     // -2147483648  (wraps, defined)

        // Math.addExact throws instead of wrapping:
        try {
            Math.addExact(x, 1);
        } catch (ArithmeticException e) {
            System.out.println("addExact caught: " + e.getMessage());
        }
    }
}
```

Java *guarantees* the wrap: `MAX + 1 == MIN`. It's predictable but silent, which is its own danger. Since Java 8, `Math.addExact` / `multiplyExact` throw on overflow when you want to be told.

### Go — Defined wraparound (and constants are checked)

```go
package main

import (
	"fmt"
	"math"
)

func main() {
	var x int32 = math.MaxInt32 // 2147483647
	fmt.Println(x)
	fmt.Println(x + 1) // -2147483648 (defined wrap)

	var u uint8 = 255
	fmt.Println(u + 1) // 0 (wraps)
}
```

Go's wraparound is fully specified. A nice safety net: Go rejects *constant* overflow at compile time — `var x int8 = 300` won't compile. But runtime variable overflow still wraps silently.

### Rust — Panics in debug, wraps in release, plus explicit APIs

```rust
fn main() {
    let x: i32 = i32::MAX;     // 2147483647

    // In a debug build, `x + 1` PANICS: "attempt to add with overflow".
    // In a release build, it WRAPS silently. So be explicit:

    println!("{:?}", x.checked_add(1));    // None  (overflowed)
    println!("{}",   x.wrapping_add(1));   // -2147483648
    println!("{}",   x.saturating_add(1)); // 2147483647 (clamps at max)
    let (v, of) = x.overflowing_add(1);
    println!("{} overflowed={}", v, of);   // -2147483648 overflowed=true
}
```

Rust is the most honest: it crashes loudly during development so you *find* overflow, and gives you four named operations so you say exactly what you mean — fail, wrap, clamp, or report.

### Python — Integers never overflow

```python
x = 2 ** 62
print(x)            # 4611686018427387904
print(x * x * x)    # a 187-digit number, computed exactly — no overflow

import sys
# There is no fixed-width int; Python promotes to arbitrary precision automatically.
print((2 ** 1000) + 1)   # works fine
```

Python's `int` is arbitrary precision: it grows as needed. You trade speed and memory for never having to think about overflow. (Inside NumPy, however, you're back to fixed-width types that *do* wrap.)

### JavaScript — Floats, then BigInt

```javascript
console.log(Number.MAX_SAFE_INTEGER);       // 9007199254740991  (2^53 - 1)
console.log(Number.MAX_SAFE_INTEGER + 1);    // 9007199254740992
console.log(Number.MAX_SAFE_INTEGER + 2);    // 9007199254740992  <-- WRONG, precision lost

console.log(9007199254740991n + 2n);         // 9007199254740993n  (BigInt: exact)
```

JS numbers are 64-bit floats. Past 2⁵³ they don't wrap — they lose the ability to represent every integer. `BigInt` (the `n` suffix) gives true arbitrary-precision integers.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Fixed-width (C/Java/Go/Rust)** | Fast — maps directly to a CPU register and one instruction. Predictable memory size. | Can overflow; you must reason about range. |
| **Wraparound semantics (Java/Go)** | Fully defined, portable, no UB, useful for hashing and checksums. | Silent — a bug produces wrong numbers with no signal. |
| **Undefined behavior (C/C++)** | Lets the compiler optimize aggressively (assume loops terminate, etc.). | Catastrophic: optimizer can delete your overflow checks; bugs become security holes. |
| **Panic-on-overflow (Rust debug)** | Catches bugs at the moment they happen, during development. | Off in release builds by default; you must opt into checked ops for production safety. |
| **Arbitrary precision (Python)** | You literally never overflow. Simplicity. | Slower, uses more memory, unpredictable performance for huge numbers. |
| **Unsigned types** | Double the positive range; correct modular arithmetic; right for sizes/indices/bitmasks. | Subtracting can wrap to a giant number; mixing with signed is a notorious bug source. |

---

## Use Cases

Pick the representation deliberately:

- **Counters, IDs, indices:** fixed-width integers. Use 64-bit when in doubt — a 32-bit counter at 1000/sec overflows in ~50 days; a 64-bit one effectively never does.
- **Sizes, lengths, memory offsets:** unsigned types (`size_t` in C, `usize` in Rust) — a length is never negative, and the modular semantics are right.
- **Bit flags / bitmasks:** unsigned, so shifts and masks behave predictably without sign extension surprises.
- **Money:** **never** floating point. Use fixed-width integers counting the smallest unit (cents, satoshis) — but then guard multiplication against overflow.
- **Cryptographic / huge math:** Python's big ints, Java's `BigInteger`, or a bignum library — correctness over speed.
- **Hashing, checksums, PRNGs:** wraparound is a *feature*; use it deliberately (Go/Java naturally, Rust's `Wrapping<T>`).

---

## Coding Patterns

### Pattern 1: Choose a width that can't overflow for your domain

```go
// Counting nanoseconds in a 32-bit int overflows after ~2.1 seconds. Use 64-bit.
var elapsedNanos int64
```

The cheapest fix for overflow is to use a type big enough that overflow is physically impossible in your problem's lifetime.

### Pattern 2: Check before you compute (C/Java)

```java
// Instead of: int total = a + b;  (might overflow silently)
int total = Math.addExact(a, b);  // throws ArithmeticException on overflow
```

```c
// Use the compiler builtin (GCC/Clang) that returns whether overflow occurred:
int result;
if (__builtin_add_overflow(a, b, &result)) {
    // handle overflow
}
```

### Pattern 3: Say what you mean (Rust)

```rust
let total = a.checked_add(b).expect("transaction total overflowed");  // explicit failure
let hash  = a.wrapping_add(b);                                         // deliberate wrap
let level = a.saturating_add(b);                                       // clamp, never exceed max
```

### Pattern 4: Use unsigned for things that are never negative — carefully

```rust
let len: usize = data.len();   // a length is never negative; usize is correct
// but beware: `len - 1` when len == 0 wraps to a huge number. Guard it:
if len > 0 { let last = len - 1; /* ... */ }
```

---

## Clean Code

- **Name the width when it matters.** `int32`, `uint64`, `i8` are clearer than a bare `int` whose size varies by platform.
- **Pick signedness by meaning, not by habit.** A length or a count uses unsigned; a delta that can go negative uses signed.
- **Make overflow intent explicit in code that relies on it.** If you *want* wraparound (hashing), use the named API (`wrapping_add`, `Wrapping<T>`) so a reader knows it's deliberate, not a bug.
- **Don't reuse a too-small type to "save memory" on a hot counter.** The bytes saved are dwarfed by the bug risk. Default to the natural machine word.
- **Comment range assumptions.** If a function assumes its input fits in 16 bits, say so and validate it.

---

## Best Practices

- **Default to 64-bit for counters and accumulators** unless you have a measured reason to go smaller. It removes a whole class of bugs.
- **Validate external input ranges** before doing arithmetic. A `length` field from a network packet or file is attacker-controlled; a giant value can overflow your size math.
- **Use checked arithmetic on anything safety- or money-critical.** `addExact`/`checked_add`/`__builtin_*_overflow`. The performance cost is negligible compared to a wrong answer.
- **Never mix signed and unsigned in a comparison without thinking.** `-1 < someUnsigned` can be *false* because `-1` converts to a giant unsigned value. (Deep dive in `middle.md`.)
- **In C/C++, treat signed overflow as a bug to be prevented, never relied upon** — it's undefined behavior, and the optimizer will punish you.
- **Turn on the tools.** Compile C/C++ with `-fsanitize=signed-integer-overflow` (UBSan) in tests; run Rust tests in debug mode so overflow panics fire.

---

## Edge Cases & Pitfalls

- **`255 + 1 == 0`, `0 − 1 == 255`** for an unsigned 8-bit. Subtracting below zero on an unsigned type produces a *huge* number, not a negative one. This is the single most common unsigned bug.
- **`length - 1` when length is 0** on an unsigned type underflows to the maximum value — then used as an array bound, it reads way out of bounds.
- **Multiplication overflows long before addition.** `a * b` where both are large 32-bit numbers overflows easily even when `a + b` wouldn't. Size calculations (`count * elementSize`) are the classic overflow-to-exploit vector.
- **The most-negative number has no positive twin.** `−INT_MIN` cannot be represented (it would be `INT_MAX + 1`), so `abs(INT_MIN)` is broken. (Famous trap, detailed in `senior.md`.)
- **Narrowing truncates, it doesn't round or saturate.** Assigning a 32-bit `300` into an 8-bit type keeps only the low 8 bits → `300 & 255 == 44`.
- **`int` is not always 32 bits.** In C it's "at least 16"; on different platforms `long` is 32 or 64 bits. Use explicit-width types (`int32_t`, `int64_t`) when size matters.
- **A successful test run hides overflow bugs.** They only appear at the extreme values, which your tests probably don't hit. Test the boundaries explicitly.

---

## Common Mistakes

1. **Assuming `int` is big enough.** A 32-bit counter looks infinite until it isn't. Default to 64-bit for anything that grows over time.
2. **Treating unsigned subtraction like math.** `unsignedA - unsignedB` when `B > A` wraps to a huge number. Check `A >= B` first.
3. **Relying on C signed overflow "wrapping."** It's undefined behavior, not wraparound. The compiler may do something else entirely.
4. **Using `abs()` and forgetting `INT_MIN`.** `abs(INT_MIN)` is broken in C/Java. (See `senior.md`.)
5. **Computing `(a + b) / 2` for a midpoint.** If `a + b` overflows, your midpoint is wrong/negative — a real bug that lived in binary search for years. Use `a + (b - a) / 2`.
6. **Storing a size in a signed 32-bit on a system with >2 GB data.** The size goes negative. Use `size_t` / 64-bit.
7. **Assuming Python's behavior elsewhere.** Python never overflows, so habits formed there crash or wrap when you move to C/Go/Java.
8. **Mixing widths in arithmetic without noticing the promotion.** A `byte + byte` in Java is computed as `int`; in C it's worse with implicit conversions (covered in `middle.md`).

---

## Tricky Points

- **The same bits are two numbers.** `0xFF` is `255` *or* `−1`. Only the type decides. Reinterpreting type changes the value with zero memory movement.
- **Overflow is not an error in most languages — it's a result.** Java and Go return a wrong-but-defined value; only Rust-debug and checked APIs treat it as an event.
- **"It worked on my machine" is especially dangerous here.** Overflow depends on type width, which depends on platform (`int`, `long`, `size_t` vary). Same code, different range, different bug.
- **C's undefined signed overflow can delete your safety check.** `if (x + 1 < x)` looks like an overflow test, but since signed overflow "can't happen" per the standard, the compiler may optimize the whole `if` away. You must check *before* overflowing, not after.
- **Constants vs variables.** Many languages catch *constant* overflow at compile time (`int8 x = 300` fails) but silently wrap the identical *runtime* computation.

---

## Test Yourself

1. Write out the 8-bit two's-complement representation of `−5`. (Hint: take `5` = `00000101`, flip all bits, add 1.)
2. What is the unsigned 8-bit result of `200 + 100`? What's the signed 8-bit result of the same bit pattern?
3. For a signed 16-bit integer, what does `32767 + 1` equal? Why?
4. In C, `unsigned char c = 0; c = c - 1;` — what is `c` now? Why isn't it `−1`?
5. Why does two's complement have only one zero while sign-magnitude has two? Show both bit patterns for "zero" in sign-magnitude.
6. Predict the output of `Integer.MAX_VALUE + 1` in Java, then the same operation in Rust debug mode. Why do they differ?
7. Compute `(2_000_000_000 + 2_000_000_000) / 2` using 32-bit signed `int` math. Is the answer 2,000,000,000? If not, why, and how do you fix the midpoint formula?
8. Take the value `300` and store it in an unsigned 8-bit type. What value remains, and what bit operation explains it?

---

## Tricky Questions

**Q1: Is `unsigned x = 0; x--;` undefined behavior in C?**

No. Unsigned arithmetic is *defined* to wrap modulo 2ⁿ, so `0 - 1` becomes `UINT_MAX` (4294967295 for 32-bit). It's a bug if you didn't expect it, but it is well-defined. Signed overflow is the undefined one.

**Q2: If `11111111` can mean both 255 and −1, how does the CPU know which to add correctly?**

It doesn't need to — that's the beauty of two's complement. The *same* binary addition produces the correct bit pattern for both interpretations. The CPU just adds bits; *you* decide whether to read the result as signed or unsigned.

**Q3: Why is 64-bit usually "safe enough" for counters?**

A 64-bit unsigned counter holds ~1.8×10¹⁹ values. Incrementing it a billion times per second, it would take roughly 585 years to overflow. For almost any real counter, that's effectively never — which is why "just use int64" is sound default advice.

**Q4: Does Python ever overflow integers?**

No. Python's `int` automatically grows to arbitrary precision. `2 ** 10000` computes exactly. The trade-off is speed and memory. Note: NumPy arrays use fixed-width C types and *do* wrap.

**Q5: My loop `for (unsigned i = n; i >= 0; i--)` never ends. Why?**

Because an unsigned `i` is *always* `≥ 0` — when `i` is 0 and you do `i--`, it wraps to `UINT_MAX`, which is still `≥ 0`. The condition can never become false. Use a signed loop variable or restructure the loop.

**Q6: Is the wraparound from `MAX + 1` to `MIN` guaranteed in every language?**

No! It's guaranteed in Java and Go. It's *undefined* in C/C++. In Rust it panics (debug) or wraps (release). In Python it can't happen. Never assume wraparound is portable.

**Q7: Why might `count * size` be a security vulnerability?**

If an attacker supplies a large `count`, the multiplication can overflow to a *small* number. The program then allocates a small buffer (the wrapped size) but later writes `count` elements into it — a heap buffer overflow. Many real CVEs follow exactly this shape.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                INTEGER REPRESENTATION & OVERFLOW                 │
├──────────────────────────────────────────────────────────────────┤
│ An integer = a fixed box of N bits. Count past the top → wrap.   │
├──────────────────────────────────────────────────────────────────┤
│ Unsigned n-bit range:   0 .. 2^n - 1                             │
│ Signed   n-bit range:  -2^(n-1) .. 2^(n-1) - 1   (two's comp)    │
│   one more negative than positive  → -INT_MIN is BROKEN          │
├──────────────────────────────────────────────────────────────────┤
│ Ranges:                                                          │
│   8-bit  signed -128..127        unsigned 0..255                 │
│  16-bit  signed -32768..32767    unsigned 0..65535               │
│  32-bit  signed +/-2.1 billion   unsigned 0..4.29 billion        │
│  64-bit  signed +/-9.2e18        unsigned 0..1.8e19              │
├──────────────────────────────────────────────────────────────────┤
│ Two's complement: top bit's place value is NEGATIVE.            │
│   one zero, one adder for signed+unsigned → hardware loves it    │
├──────────────────────────────────────────────────────────────────┤
│ Overflow behavior BY LANGUAGE:                                   │
│   C/C++   signed=UNDEFINED, unsigned=wraps                       │
│   Java    wraps (silent, defined); Math.addExact throws          │
│   Go      wraps (silent, defined)                                │
│   Rust    panics(debug)/wraps(release); checked/wrapping/sat.    │
│   Python  never overflows (arbitrary precision)                  │
│   JS      float past 2^53 loses precision; BigInt is exact       │
├──────────────────────────────────────────────────────────────────┤
│ Classic traps:                                                   │
│   * unsigned 0 - 1  = MAX  (not -1)                              │
│   * len - 1 when len==0  → huge index                            │
│   * count * size overflow → tiny alloc → buffer overflow         │
│   * (a + b) / 2 midpoint overflows → use a + (b - a)/2           │
│   * narrowing truncates (keeps low bits), never rounds           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A computer integer is a **fixed-width box of bits**, not an abstract number. Its width (8/16/32/64) sets its range.
- **Unsigned** integers hold `0 … 2ⁿ−1`; all bits are magnitude.
- **Signed** integers use **two's complement**: the top bit carries a *negative* place value. This gives exactly one zero, lets one adder serve both signed and unsigned, and is why every modern CPU uses it.
- Two's complement is **asymmetric**: one more negative than positive value, so `−INT_MIN` and `abs(INT_MIN)` are broken.
- **Overflow** happens when a result won't fit; the visible effect is **wraparound** (the odometer rolls over).
- **The reaction to overflow is language-specific**: C/C++ undefined, Java/Go silent wrap, Rust panic-or-wrap-plus-explicit-APIs, Python never overflows, JS loses precision.
- **Narrowing truncates** (keeps the low bits); **widening sign-extends** signed values.
- The big real-world dangers: **unsigned underflow** (`0 − 1` = huge), **multiplication overflow in size math** (a security vector), and **C's undefined behavior** silently deleting overflow checks.
- A junior's #1 habit: **know your language's overflow rule, default to 64-bit for counters, and validate the range of any externally-supplied number before you do arithmetic on it.**

---

## What You Can Build

- **A wraparound visualizer.** Print the value of an 8-bit signed and unsigned counter as you increment it from 250 to 260, showing the wrap.
- **A "five languages, one overflow" demo.** Run `MAX + 1` in C, Java, Go, Rust, and Python and tabulate the wildly different results.
- **A binary↔decimal converter** that shows the two's-complement interpretation of any 8-bit pattern (both the signed and unsigned reading).
- **A safe-add library** in your language: `safeAdd(a, b)` that returns an error/None on overflow instead of wrapping. Test it at the boundaries.
- **An odometer simulation** that wraps at a configurable width — make the off-by-one at the seam obvious.
- **A "find the overflow" challenge** for a friend: write a size calculation `count * size` that overflows for a specific input, and see if they can spot why it's exploitable.

---

## Further Reading

- *Computer Systems: A Programmer's Perspective* (Bryant & O'Hallaron) — Chapter 2 is the definitive, accessible treatment of integer representation.
- *Code: The Hidden Language of Computer Hardware and Software* — Charles Petzold. Builds binary from first principles.
- *Hacker's Delight* — Henry S. Warren. The bible of bit-level integer tricks (more advanced).
- *The Rust Book* — section on integer overflow. https://doc.rust-lang.org/book/ch03-02-data-types.html
- Two's complement on Wikipedia — surprisingly good, with worked examples.
- *What Every Computer Scientist Should Know About... integer overflow* — various blog treatments; search "integer overflow CWE-190".
- The CWE entry **CWE-190: Integer Overflow or Wraparound** — the security framing.

---

## Related Topics

- This folder, next levels: [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling numeric topics (same section):
  - [Floating-Point Representation](../02-floating-point-ieee-754/junior.md) — the *other* number representation, with its own surprises.
- The hardware view: `../../cpu-architecture/01-alu/junior.md` — how the adder actually works.
- The security view: `../../../quality-engineering/static-analysis/junior.md` — tools that catch overflow.

---

## Diagrams & Visual Aids

### The Integer Clock (8-bit unsigned)

```text
                     0
              255 ─┐ │ ┌─ 1
                   ╲│╱
            254 ────●──── 2
                   ╱│╲
                  ╱ │ ╲
                 ...   ...
                       │
              128 ───────── 127     ← wrap seam is between 255 and 0
        (count past 255 → back to 0; below 0 → back to 255)
```

### Two's Complement Place Values (signed 8-bit)

```text
   bit position:   7    6    5    4    3    2    1    0
   place value:  -128  +64  +32  +16  +8   +4   +2   +1
                   ▲
                   └── only the TOP bit is negative

   10000000 = -128                (most negative; no positive twin)
   11111111 =  -1                 (all ones)
   00000000 =   0                 (only one zero)
   01111111 = +127                (most positive)
```

### Signed 8-bit Overflow at the Seam

```text
 value:  ... 125  126  127 │-128  -127  -126 ...
                       │   │
              +1 ──────┘   │
                           ▼
                    wraps to -128   (127 + 1 ≠ 128; it's the minimum)
```

### Sign Extension vs Zero Extension (8-bit → 16-bit)

```text
  signed   -1  =  11111111   →  11111111 11111111   (-1, sign-extended)
  unsigned 255 =  11111111   →  00000000 11111111   (255, zero-extended)

  same 8 bits, different widening rule because the TYPE differs
```

### The "count * size" Overflow-to-Exploit Pattern

```text
  attacker sends count = 4294967296 / size  (chosen to overflow)
        count * size  ──overflows──►  small number, e.g. 16
        malloc(16)    ──allocates──►  tiny buffer
        write `count` elements into it  ──►  HEAP BUFFER OVERFLOW
```
