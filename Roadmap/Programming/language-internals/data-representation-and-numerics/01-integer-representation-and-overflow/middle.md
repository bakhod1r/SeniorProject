# Integer Representation & Overflow — Middle Level

> **Topic:** [Integer Representation & Overflow](README.md)
> **Focus:** The practical bug-finding layer — integer promotion, implicit conversions, signed/unsigned comparisons, truncation, and the concrete techniques to *detect* overflow before it bites you.

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

> Focus: **Most integer bugs don't come from a single big number. They come from quiet, automatic conversions** — a `short` promoted to `int`, a signed value compared against an unsigned one, a 64-bit length truncated into a 32-bit field — and from doing arithmetic without *checking* whether it overflowed.

At the junior level you learned the model: integers are fixed-width, two's complement, and overflow wraps (or doesn't) depending on the language. At the middle level the work is different. You will rarely write `INT_MAX + 1` on purpose. You *will* constantly write code where the language **silently changes a value's type or width behind your back** — and that is where production overflow bugs actually live.

Three families dominate:

1. **Implicit conversions and integer promotion** — the compiler widens, narrows, or re-signs operands of an expression according to rules you didn't write and probably can't recite. `byte b = (byte)(a + c)` in Java; the "usual arithmetic conversions" in C; `as` casts in Rust.
2. **Signed/unsigned comparison** — when you compare a signed and an unsigned value, one of them is converted, and the conversion can turn `−1` into `4294967295`, flipping the comparison.
3. **Overflow detection** — since most languages won't tell you overflow happened, you need *techniques* to find out: pre-checks against the limits, wider-type computation, the post-condition trick (carefully, because of UB), and compiler builtins.

This page is the toolkit. By the end you should be able to look at a line like `if (a + b > LIMIT)` or `arr[i - 1]` or `int len = (int)bigValue;` and immediately ask the right question: *what got converted, what width is this evaluated at, and can it overflow?*

---

## Prerequisites

- **Required:** The junior page — two's complement, fixed widths, per-language overflow behavior, wraparound.
- **Required:** Comfort reading C, Java, and Go arithmetic; basic Rust helps.
- **Helpful:** Knowing what a cast/conversion looks like in your language(s).
- **Helpful:** Having been bitten by at least one "the number came out wrong/negative" bug — this page explains why.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Integer promotion** | The C rule that operands narrower than `int` (`char`, `short`, bitfields) are converted to `int` (or `unsigned int`) before arithmetic. |
| **Usual arithmetic conversions** | C/C++ rules that bring the two operands of a binary operator to a common type before computing. |
| **Implicit conversion** | A type/width/sign change the language performs without an explicit cast. |
| **Narrowing / truncation** | Converting to a smaller type; high bits are discarded. |
| **Widening** | Converting to a larger type; sign-extended (signed) or zero-extended (unsigned). |
| **Signed-to-unsigned conversion** | Reinterpreting the bit pattern under the unsigned reading; `−1` becomes the type's max. |
| **Rank** | C's ordering of integer types by size/precedence; used to decide the common type. |
| **`size_t`** | An unsigned type wide enough to hold any object size on the platform (32-bit on 32-bit systems, 64-bit on 64-bit). |
| **`ptrdiff_t`** | The *signed* counterpart to `size_t`; the type of a pointer difference. |
| **Pre-check** | Testing operands against limits *before* the operation, to predict overflow. |
| **Post-check** | Testing the *result* after the operation to infer overflow (unsafe for signed in C — UB). |
| **Checked arithmetic** | An operation that reports overflow rather than silently producing a value. |
| **Saturating arithmetic** | Overflow clamps to the type's max/min instead of wrapping. |
| **Wrapping arithmetic** | Overflow is defined to wrap modulo 2ⁿ, deliberately. |

---

## Core Concepts

### 1. Integer Promotion (C/C++): Small Types Become `int`

In C and C++, you cannot do arithmetic on a `char` or `short` directly. Before any arithmetic operator, **operands smaller than `int` are promoted to `int`** (the "integer promotions"). This produces results that surprise people:

```c
unsigned char a = 200, b = 100;
unsigned char c = a + b;     // a,b promoted to int: 200+100 = 300 (an int)
                             // then assigned back to unsigned char: 300 & 0xFF = 44
printf("%d\n", a + b);       // prints 300, NOT 44 — the expression is an int!
printf("%d\n", c);           // prints 44 — truncation happened on assignment
```

The expression `a + b` has type `int` and value `300`. Only when you *store* it into the 8-bit `c` does truncation to `44` occur. A common bug: people think 8-bit arithmetic wraps at 256, but the *arithmetic* happens in `int`; the wrap only happens at the narrowing store.

### 2. Usual Arithmetic Conversions: Finding the Common Type

When the two operands of `+ - * / % < > == &` etc. have different types, C/C++ converts them to a single "common type" by a ranked procedure (simplified):

1. Apply integer promotions to both.
2. If both are signed or both unsigned, convert to the higher-ranked type.
3. **If one is unsigned and the other signed, and the unsigned type's rank is ≥ the signed type's, the signed operand is converted to unsigned.** ← the dangerous rule.

That last rule is the root of the signed/unsigned comparison bug below.

### 3. The Signed/Unsigned Comparison Trap

```c
int a = -1;
unsigned int b = 1;
if (a < b) printf("less\n"); else printf("not less\n");
```

You expect "less" — `−1 < 1`. You get **"not less."** Why? `b` is `unsigned int`, same rank as `int`, so the signed `a` is converted to unsigned: `−1` becomes `4294967295`. Now the comparison is `4294967295 < 1`, which is false. The mathematical relationship inverted because of an implicit conversion you never wrote.

This is one of the most common real bugs in C/C++:

```c
int len = get_length();        // could return -1 on error
char buf[100];
if (len < sizeof(buf)) {       // sizeof is size_t (unsigned)!
    // if len == -1, it becomes a huge unsigned, condition FALSE,
    // so the "safe" branch is skipped — or in other framings, taken when it shouldn't be
}
```

### 4. Truncation: Narrowing Keeps the Low Bits

Assigning a wide value into a narrow type discards the high bits — it does **not** clamp or round:

```c
long big = 0x1_0000_002A;     // 4294967338
int  small = (int)big;        // keeps low 32 bits: 0x0000002A = 42
short tiny = (short)0x12345;  // keeps low 16 bits: 0x2345 = 9029
```

For signed targets, the kept low bits are then *reinterpreted* under the target's sign rule, which can flip the sign:

```c
int x = 0xFFFF_0001;          // some 32-bit value
short s = (short)x;           // low 16 bits = 0x0001 = 1   (fine here)
short t = (short)0x0000_8000; // low 16 bits = 0x8000 = -32768 (sign flips!)
```

### 5. Overflow Detection Technique A: Pre-Check Against Limits

The *correct, portable* way to detect overflow is to test the operands against the type's limits **before** computing, so you never actually overflow:

```c
#include <limits.h>
// Will a + b overflow a signed int?
bool add_overflows(int a, int b) {
    if (b > 0 && a > INT_MAX - b) return true;   // a + b would exceed INT_MAX
    if (b < 0 && a < INT_MIN - b) return true;   // a + b would go below INT_MIN
    return false;
}
```

This never triggers UB because it never performs the overflowing addition. The same shape works for multiplication (`a > INT_MAX / b`, with care for sign and zero).

### 6. Overflow Detection Technique B: Compute in a Wider Type

If a wider type exists, compute there and check the result fits:

```c
int32_t a, b;
int64_t wide = (int64_t)a + (int64_t)b;   // 32-bit operands can't overflow 64-bit sum
if (wide > INT32_MAX || wide < INT32_MIN) { /* overflow */ }
int32_t result = (int32_t)wide;
```

Clean and obvious — but it fails for the *widest* type (there's nothing wider than `int64_t` to promote a 64-bit sum into), and it costs a wider operation.

### 7. Overflow Detection Technique C: Compiler Builtins / Checked APIs

The best modern answer is to let the hardware/compiler tell you, using the CPU's overflow flag:

```c
int32_t a, b, r;
if (__builtin_add_overflow(a, b, &r)) { /* overflowed */ }   // GCC/Clang
```

```rust
let (r, overflowed) = a.overflowing_add(b);
match a.checked_mul(b) { Some(v) => /* ok */, None => /* overflow */ }
```

```java
int r = Math.addExact(a, b);   // throws ArithmeticException on overflow
```

```go
// Go has no builtin; use math/bits for the unsigned case:
sum, carry := bits.Add64(a, b, 0)   // carry != 0 means overflow
```

### 8. Why the Post-Check Trick Is a Trap in C

A classic "detect overflow after the fact" idiom:

```c
int r = a + b;
if (r < a) { /* overflowed */ }   // BUG in C for SIGNED ints
```

For **unsigned** this is valid (wraparound is defined, so a smaller result means it wrapped). For **signed**, the addition `a + b` *itself* is undefined behavior when it overflows — so by the time you check `r`, you've already invoked UB and the compiler may have assumed it never happened and deleted your check. **Detect before, not after, for signed types.**

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Integer promotion** | Everyone at a meeting being asked to convert their notes to A4 before comparing — even the people who wrote on index cards. |
| **Usual arithmetic conversions** | Two travelers with different currencies; before settling a bill, both convert to one agreed currency — and the conversion can surprise you. |
| **Signed→unsigned flip** | Reading a "−1" written as "all 9s on the odometer" (999999) — same dial, wildly different number. |
| **Truncation** | Cutting a long receipt to fit a small frame — you keep only the bottom portion, losing the total at the top. |
| **Pre-check** | Weighing your luggage at home before the airport so you never get hit with the overweight fee at the gate. |
| **Post-check (signed, UB)** | Checking your bank balance *after* a bounced transaction already triggered penalties — the damage is done. |
| **Wider-type computation** | Doing the math on a bigger whiteboard, then copying only the result that fits back onto the small one. |

---

## Mental Models

### The "Expression Has a Type" Model

Stop reading `a + b` as "add two numbers." Read it as: *"the language picks a common type T, converts both operands to T, computes in T, and the result is of type T."* Almost every middle-level integer bug is explained by being wrong about what T is. In C, `char + char` has type `int`. In `unsignedInt < negativeInt`, T is unsigned and the negative becomes huge. Always ask: **what is the type of this expression, and at what width does it compute?**

### The "Conversion Is a Reinterpretation, Not a Move" Model

A signed→unsigned conversion doesn't change the bits — it changes the *reading rule*. `(unsigned)-1` is the same `0xFFFFFFFF` bit pattern, now read as 4294967295. Truncation discards high bits; widening adds bits (copying the sign for signed). Picture the bits staying put while a different "lens" is placed over them.

### The "Detect Before You Leap" Model

For overflow, the safe mental default is: **never perform an operation that might overflow and then inspect the wreckage** (especially in C, where the wreckage is UB). Instead, *ask in advance* whether the operation will overflow — compare against the limit, or compute in a wider type, or use a checked primitive that does the asking atomically with the operation.

---

## Code Examples

### C — The promotion + truncation surprise

```c
#include <stdio.h>

int main(void) {
    unsigned char a = 0xFF;     // 255
    unsigned char b = 0x01;     // 1
    printf("a + b as expr = %d\n", a + b);        // 256  (computed as int!)
    unsigned char c = a + b;                       // truncated to 8 bits
    printf("a + b stored   = %u\n", c);           // 0

    short s = -1;
    int   i = s;                                   // widening: sign-extended
    printf("widened -1     = %d\n", i);           // -1, not 65535
    return 0;
}
```

### C — Safe addition with pre-check vs builtin

```c
#include <stdio.h>
#include <limits.h>
#include <stdbool.h>

bool safe_add(int a, int b, int *out) {
    if (b > 0 && a > INT_MAX - b) return false;   // would overflow high
    if (b < 0 && a < INT_MIN - b) return false;   // would overflow low
    *out = a + b;                                  // now guaranteed safe
    return true;
}

bool safe_add_builtin(int a, int b, int *out) {
    return !__builtin_add_overflow(a, b, out);     // hardware flag, GCC/Clang
}

int main(void) {
    int r;
    printf("%d\n", safe_add(INT_MAX, 1, &r));      // 0 (refused)
    printf("%d\n", safe_add(2, 3, &r));            // 1, r = 5
    return 0;
}
```

### C — The signed/unsigned comparison bug, demonstrated and fixed

```c
#include <stdio.h>

int main(void) {
    int n = -1;
    unsigned int count = 5;

    if (n < count) printf("n < count\n");          // does NOT print!
    else           printf("n NOT < count\n");      // prints (because -1 -> 4294967295)

    // Fix: compare in a common SIGNED domain, or guard the sign first:
    if (n < 0 || (unsigned)n < count) printf("fixed: n < count\n");
    return 0;
}
```

### Java — Promotion and the cast-back gotcha

```java
public class Promotion {
    public static void main(String[] args) {
        byte a = 100, b = 100;
        // byte + byte is computed as int; you MUST cast to store in a byte:
        // byte sum = a + b;          // compile error: possible lossy conversion
        byte sum = (byte)(a + b);     // 200 doesn't fit in byte -> wraps to -56
        System.out.println(sum);      // -56

        int big = 300;
        byte truncated = (byte) big;  // 300 & 0xFF = 44
        System.out.println(truncated);// 44

        // Java has no unsigned types (pre-Java 8 helpers exist):
        int x = -1;
        System.out.println(Integer.toUnsignedLong(x)); // 4294967295
        System.out.println(Integer.compareUnsigned(-1, 1) > 0); // true
    }
}
```

### Go — Explicit conversions, no implicit mixing

```go
package main

import (
	"fmt"
	"math/bits"
)

func main() {
	var a int32 = 2_000_000_000
	var b int32 = 2_000_000_000
	// Go forbids mixing types implicitly; you must convert.
	wide := int64(a) + int64(b) // compute in 64-bit, no overflow
	fmt.Println(wide)           // 4000000000

	// Detecting unsigned overflow with math/bits:
	sum, carry := bits.Add64(^uint64(0), 1, 0) // MAX + 1
	fmt.Println(sum, carry)                     // 0 1  (carry==1 => overflowed)

	// Go also forbids signed/unsigned mixing — a whole bug class is gone:
	// var s int = -1; var u uint = 1; _ = s < u  // compile error
}
```

Go's design choice — **no implicit conversions at all** — eliminates the C signed/unsigned comparison trap by construction. You must write every conversion, which is verbose but safe.

### Rust — Conversions are explicit; choose your overflow semantics

```rust
fn main() {
    let a: i32 = 2_000_000_000;
    let b: i32 = 2_000_000_000;

    // `as` truncates/reinterprets silently — the one footgun in Rust:
    let truncated = 300_i32 as u8;        // 44
    println!("{}", truncated);

    // Prefer fallible conversions that report loss:
    let r: Result<u8, _> = u8::try_from(300_i32);
    println!("{:?}", r);                  // Err(TryFromIntError(()))

    // Choose overflow semantics explicitly:
    println!("{:?}", a.checked_add(b));   // None (overflow)
    println!("{}",   a.wrapping_add(b));  // -294967296
    println!("{}",   a.saturating_add(b));// 2147483647

    // Wider-type compute:
    let wide = a as i64 + b as i64;       // 4000000000
    println!("{}", wide);
}
```

---

## Pros & Cons

| Technique | Pros | Cons |
|-----------|------|------|
| **Pre-check against limits** | Portable, no UB, works for the widest type. | Verbose; easy to get the sign cases wrong (especially multiplication). |
| **Compute in wider type** | Simple and obvious; one check at the end. | Doesn't work for the widest type; costs a wider operation. |
| **Compiler builtins (`__builtin_*_overflow`)** | Fast (uses CPU overflow flag), correct, concise. | Non-standard (GCC/Clang); not portable to MSVC without alternatives. |
| **Checked APIs (Rust `checked_*`, Java `*Exact`)** | Idiomatic, safe, expresses intent. | Java throws (exception cost); must remember to use them. |
| **Saturating arithmetic** | Never wraps to a wrong-direction value; great for DSP/graphics/clamped meters. | Silently caps — can hide that a limit was hit. |
| **Wrapping arithmetic** | Correct and intended for hashing, checksums, ring buffers. | A footgun if used by accident; reader must know it's deliberate. |

---

## Use Cases

- **Parsing untrusted input (file/network):** pre-check every size/length/count field before arithmetic. This is where conversion and overflow bugs become CVEs.
- **Buffer/size calculations:** compute `count * elementSize` with overflow detection (builtin or wider type) before allocating.
- **Cross-width serialization:** when packing a 64-bit value into a 32-bit wire field, validate it fits *before* truncating.
- **Index math:** `i - 1`, `mid = lo + (hi - lo)/2`, ring-buffer `(head + 1) % cap` — all need overflow/underflow awareness, especially with unsigned indices.
- **Interop with C from a safer language:** when crossing into `size_t`/`int` land, conversions are where data quietly changes.

---

## Coding Patterns

### Pattern 1: Overflow-safe multiplication via division check

```c
bool mul_overflows(size_t a, size_t b) {
    if (a == 0 || b == 0) return false;
    return a > SIZE_MAX / b;    // if a > MAX/b, then a*b > MAX
}
```

### Pattern 2: Overflow-safe binary-search midpoint

```c
// BAD:  int mid = (lo + hi) / 2;          // lo + hi can overflow
// GOOD:
int mid = lo + (hi - lo) / 2;              // no overflow when lo <= hi
```

This exact bug lived in `java.util.Arrays.binarySearch` for years until Joshua Bloch wrote it up in 2006.

### Pattern 3: Guard unsigned subtraction

```rust
// BAD:  let last = len - 1;               // panics/wraps if len == 0
// GOOD:
let last = len.checked_sub(1);             // None when len == 0
if let Some(idx) = last { /* safe */ }
```

### Pattern 4: Compare signed and unsigned safely

```java
// Don't let one operand silently convert. Normalize the domain:
if (Integer.compareUnsigned(x, y) < 0) { ... }   // Java
```

```c
if (a < 0 || (size_t)a < n) { ... }   // handle the sign before converting
```

### Pattern 5: Validate-then-narrow

```rust
let small: u16 = u16::try_from(value).map_err(|_| Error::TooLarge)?;
```

Never narrow blindly; convert through a fallible path that reports the loss.

---

## Clean Code

- **Make every conversion visible and intentional.** Prefer `try_from`/`compareUnsigned`/explicit casts over relying on implicit promotion. A reader should see where a value changes width or sign.
- **Compute at the right width from the start.** If a product can exceed 32 bits, declare the operands or an intermediate as 64-bit; don't compute narrow then "fix" it.
- **Encapsulate overflow checks in named helpers** (`safe_add`, `checked_size`) so the call sites read as intent, not arithmetic.
- **Comment why a wrap is deliberate.** `hash = hash.wrapping_mul(31)  // intentional modular hashing` saves the next reader a panic.
- **Prefer the type the domain demands.** `size_t`/`usize` for sizes, signed for deltas, fixed-width (`int32_t`) when wire/format compatibility matters.

---

## Best Practices

- **Validate ranges at trust boundaries.** Any integer from a file, socket, or user gets checked against the limits before it participates in arithmetic.
- **Use checked/builtin overflow operations for size and money math.** The performance hit is negligible next to the bug cost.
- **Never compare signed and unsigned directly in C/C++.** Enable `-Wsign-compare` (it's in `-Wextra`) and treat every warning as a bug.
- **Avoid narrowing where you can; when you must, do it through a fallible conversion.**
- **Compile tests with UBSan** (`-fsanitize=signed-integer-overflow,unsigned-integer-overflow`) — it pinpoints the exact line and values at runtime.
- **Prefer languages/APIs that remove the footgun** when you have the choice: Go's no-implicit-conversion rule and Rust's `try_from` eliminate whole categories of these bugs.

---

## Edge Cases & Pitfalls

- **`char + char` is `int` in C.** People expecting 8-bit wrap during the arithmetic are wrong; the wrap only happens on the narrowing store.
- **`sizeof` is `size_t` (unsigned).** Comparing a signed length against `sizeof(buf)` silently converts the signed value — the classic bug.
- **Post-overflow checks for signed ints are UB in C.** `if (a + b < a)` has already overflowed before the check; the compiler may delete it.
- **`% ` of a negative number varies by language.** C's `-7 % 3` is `-1`; Python's is `2`. Ring-buffer index math `(i + n) % cap` can return negative in C if `i` is signed and negative.
- **Multiplying then dividing in the wrong order overflows needlessly.** `(a * b) / c` may overflow where `a * (b / c)` (when exact) or wider math wouldn't.
- **Mixed-width shifts.** `1 << 31` is UB/overflow for a signed 32-bit `int` (the sign bit); use `1u << 31` or a 64-bit literal.
- **`int` width is platform-dependent.** LP64 (Linux/macOS) has 32-bit `int`, 64-bit `long`; LLP64 (Windows) has 32-bit `int` *and* 32-bit `long`, 64-bit `long long`. Code that assumes `long` is 64-bit breaks on Windows.

---

## Common Mistakes

1. **Comparing a signed length to `sizeof`/`.size()`.** The signed side converts to a huge unsigned and the check inverts.
2. **Detecting signed overflow with a post-check** (`r < a`) — undefined behavior; the check can be optimized away.
3. **Truncating without validating.** `(int)bigValue` silently loses the high bits; a 5 GB size becomes a small or negative `int`.
4. **`(lo + hi) / 2` midpoints.** Overflows for large indices; the canonical binary-search bug.
5. **Assuming 8/16-bit arithmetic wraps mid-expression in C.** It promotes to `int` first.
6. **`for (size_t i = n - 1; i >= 0; i--)`.** `i >= 0` is always true for unsigned; infinite loop, or underflow on the last decrement.
7. **Forgetting Java has no unsigned types.** Treating `int` as unsigned without `Integer.*Unsigned` helpers gives wrong comparisons and divisions.
8. **Relying on `long` being 64-bit.** True on Linux/macOS, false on Windows. Use `int64_t`/`<stdint.h>`.

---

## Tricky Points

- **The conversion happens at the operator, not at the variable.** `a < b` converts *for that comparison*; `a` itself doesn't change. Two comparisons of the same variable can convert it differently depending on the other operand.
- **Unsigned makes the *whole expression* unsigned.** One unsigned operand of sufficient rank "infects" the comparison/arithmetic, dragging the signed operand into the unsigned domain.
- **Wider-type detection breaks at the top.** You can detect 32-bit overflow with 64-bit math, but you can't detect 64-bit overflow that way — there's no 128-bit standard type in C. Use builtins or 128-bit extensions.
- **Saturating and wrapping are *both* "correct" — for different problems.** Audio sample mixing wants saturation (clipping, not a pop); a hash wants wrapping. The bug is using one where you meant the other.
- **UBSan changes the program.** Code that "works" because of incidental wraparound will start aborting under UBSan — that's the point, but it means UBSan can surface latent bugs in old code suddenly.

---

## Test Yourself

1. In C, what is the *type* of `('a' + 1)`? What about `(unsigned char)200 + (unsigned char)100` — type and value of the expression vs. when stored back into an `unsigned char`?
2. Why does `if (-1 < (unsigned)1)` evaluate false? Walk through the conversion.
3. Write `safe_mul(a, b, &out)` for signed 32-bit ints using only pre-checks (no wider type, no builtin). Handle the sign and zero cases.
4. Show the bit-level steps that turn `(short)0x8000` into `−32768` (truncation + sign reinterpretation).
5. Why is `int r = a + b; if (r < a) overflow();` valid for unsigned `a, b` but a bug for signed ones in C?
6. Rewrite `(lo + hi) / 2` to be overflow-safe and explain why it can't overflow when `lo <= hi`.
7. In Java, `byte x = (byte)(127 + 1);` — what is `x` and why? What was the type of `127 + 1` before the cast?
8. On a Windows LLP64 system, what is `sizeof(long)`? Why does code assuming `long == 64 bits` break there?

---

## Tricky Questions

**Q1: Does C's integer promotion mean 8-bit arithmetic never wraps mid-expression?**

Correct. `char`/`short` operands are promoted to `int` first, so the arithmetic happens in (at least) 32 bits. Wrapping/truncation to the small type only occurs when you *store* the result back into the narrow type. So `(unsigned char)255 + (unsigned char)1` is `256` as an expression, and becomes `0` only on assignment to an `unsigned char`.

**Q2: Why does Go forbid `var s int; var u uint; s < u`?**

By design, Go has no implicit numeric conversions. It refuses to silently convert between signed and unsigned (or between widths), which structurally eliminates the C signed/unsigned comparison bug. You must write `int64(s) < int64(u)` (or similar), making the conversion — and its risks — explicit.

**Q3: Is `__builtin_add_overflow` portable?**

It's a GCC/Clang extension (also accepted by recent Clang on Windows), but not standard C and not in MSVC by that name. For portability, wrap it: use the builtin where available, fall back to pre-checks or `<intrin.h>` `_addcarry_u32`/`_addcarry_u64` on MSVC. C23 adds `<stdckdint.h>` (`ckd_add`, `ckd_mul`) as a standard solution.

**Q4: When should I use saturating vs wrapping arithmetic?**

Saturating when exceeding a bound should *clamp* and continuing makes sense: audio samples, color channels, progress meters, a rate counter you cap. Wrapping when modular behavior is the actual semantics: hash functions, checksums, ring-buffer indices, PRNGs. Using wrapping where you meant saturating produces a loud glitch (a pop, a wrong color); the reverse silently hides that a limit was hit.

**Q5: Why is comparing a signed value to `.size()` in C++ a warning?**

`std::vector::size()` returns `size_t` (unsigned). `for (int i = 0; i < v.size(); i++)` compares signed `i` to unsigned `size()`; the signed `i` converts to unsigned. It usually works but breaks if `size()` exceeds `INT_MAX` or if `i` ever goes negative. Compilers emit `-Wsign-compare`. Use `size_t i` or `std::ssize(v)` (C++20).

**Q6: Can I detect 64-bit overflow without a 128-bit type?**

For addition, yes — pre-check against limits, or use `__builtin_add_overflow`. For multiplication, the cleanest portable route is `__builtin_mul_overflow`, or `unsigned __int128` on GCC/Clang, or a high/low product via `_umul128`/`math/bits.Mul64`. Pure pre-check multiplication (`a > MAX/b`) also works and needs no wide type.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│              CONVERSIONS, COMPARISONS & DETECTION                │
├──────────────────────────────────────────────────────────────────┤
│ C integer promotion: char/short  →  int  BEFORE arithmetic       │
│   so 8/16-bit "wrap" only happens on the NARROWING STORE          │
├──────────────────────────────────────────────────────────────────┤
│ Usual arithmetic conversions pick a common type:                 │
│   unsigned (rank >= signed) WINS → signed operand goes unsigned   │
│   => (-1 < 1u) is FALSE   (-1 becomes 4294967295)                │
├──────────────────────────────────────────────────────────────────┤
│ Truncation = keep low bits (no round, no clamp)                  │
│   300 -> u8  = 300 & 0xFF = 44                                   │
│ Widening: signed sign-extends, unsigned zero-extends             │
├──────────────────────────────────────────────────────────────────┤
│ Overflow detection:                                              │
│   A) pre-check:  b>0 && a > MAX-b   (portable, no UB)            │
│   B) wider type: (int64)a + (int64)b, check fits                 │
│   C) builtin:    __builtin_add_overflow / ckd_add (C23)          │
│   D) checked API: Rust checked_add / Java addExact               │
│   * signed POST-check (r<a) is UB in C — never do it             │
├──────────────────────────────────────────────────────────────────┤
│ Safe idioms:                                                     │
│   midpoint:   lo + (hi - lo)/2                                   │
│   unsigned -: len.checked_sub(1) / guard len>0                  │
│   sign cmp:   compareUnsigned / guard sign first                │
│   narrow:     try_from(...) -> Result                           │
├──────────────────────────────────────────────────────────────────┤
│ Platform: int=32 almost everywhere; long=64 (Unix) / 32 (Win)   │
│   use int32_t / int64_t when width matters                      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The middle-level danger is **silent conversions**, not lone giant numbers.
- **C integer promotion** widens `char`/`short` to `int` before arithmetic; narrow-type wrap happens only on the store-back.
- The **usual arithmetic conversions** can convert a signed operand to unsigned, which is why **`−1 < 1u` is false** — the canonical signed/unsigned trap.
- **Truncation keeps the low bits** (no rounding, no clamping) and can flip the sign of a signed target.
- **Detect overflow before you compute** (pre-check against limits, or compute in a wider type, or use builtins/checked APIs). **Never** post-check signed overflow in C — the overflow itself is UB.
- **Saturating vs wrapping** are both legitimate; choose by domain and make the choice explicit in code.
- Languages differ in how much footgun they leave: **Go forbids implicit conversions**, **Rust pushes you toward `try_from`/`checked_*`**, **C/C++ leave it all to you** (so turn on `-Wsign-compare` and UBSan).
- A middle engineer's habit: for every arithmetic expression, ask *"what is its type, at what width does it compute, and can it overflow?"* — and validate ranges at every trust boundary.

---

## What You Can Build

- **A `safe_int` library** with `add/sub/mul/div` that pre-check and return success/failure, tested at the boundaries against the compiler builtins.
- **A signed/unsigned comparison linter** (toy): scan C source for `<`/`>` where one side is signed and the other `size_t`/unsigned.
- **A truncation playground** that takes any 64-bit value and shows what survives narrowing to 32/16/8 bits, signed and unsigned.
- **An overflow-detection benchmark** comparing pre-check vs wider-type vs `__builtin_*_overflow` performance.
- **A binary-search implementation** with both the buggy `(lo+hi)/2` and the safe `lo+(hi-lo)/2` midpoint, plus a test that triggers the overflow on a huge (or simulated huge) array.
- **A cross-platform width reporter** that prints `sizeof` for `int/long/size_t/ptrdiff_t` and explains LP64 vs LLP64.

---

## Further Reading

- *Computer Systems: A Programmer's Perspective* (Bryant & O'Hallaron), Ch. 2.2–2.3 — conversions and the signed/unsigned interactions, with proofs.
- *Secure Coding in C and C++* — Robert Seacord. The authoritative treatment of integer conversion and overflow vulnerabilities. CERT INT rules.
- CERT C Coding Standard — INT30-C, INT31-C, INT32-C (overflow, conversion, signed overflow). https://wiki.sei.cmu.edu/confluence/display/c
- "Extra, Extra - Read All About It: Nearly All Binary Searches and Mergesorts are Broken" — Joshua Bloch, 2006 (the `(lo+hi)/2` bug).
- *The C Standard* (n2310/C17) §6.3 (conversions), §6.3.1.1 (promotion) — dense but definitive.
- GCC/Clang docs for `__builtin_add_overflow` and the C23 `<stdckdint.h>` proposal.
- UndefinedBehaviorSanitizer documentation (`-fsanitize=integer`).

---

## Related Topics

- This folder: [`junior.md`](junior.md) (the model), [`senior.md`](senior.md) (internals & `INT_MIN` traps), [`professional.md`](professional.md) (CVEs & production), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling numerics:
  - [Floating-Point Representation](../02-floating-point-ieee-754/middle.md) — conversions between int and float, another lossy boundary.
- Security framing: `../../../quality-engineering/static-analysis/sast/middle.md` — tools that flag integer-conversion bugs.
- Hardware: `../../cpu-architecture/01-alu/middle.md` — the overflow and carry flags these techniques read.
