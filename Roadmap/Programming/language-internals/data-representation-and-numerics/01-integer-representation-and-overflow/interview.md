# Integer Representation & Overflow — Interview Questions

> **Topic:** [Integer Representation & Overflow](README.md)

---

## Introduction

These questions probe whether a candidate truly understands what an integer *is* at the machine level — a fixed-width box of bits interpreted under a representation scheme — and what happens when arithmetic exceeds that box. The strongest candidates answer with mechanical precision: they distinguish two's complement *representation* from overflow *behavior*, they know that "overflow" means radically different things in C, Java, Go, Rust, and Python, they can reproduce the `INT_MIN` trap family from first principles, and they recognize the size-math overflow that turns a benign bug into a remote-code-execution vulnerability.

A weaker candidate says "it just wraps around" for everything and cannot explain why that's wrong for C (undefined behavior), why `abs(INT_MIN)` is broken, or why `-1 < 1u` is false. The questions below run from foundational vocabulary, through language-specific surfaces, into traps where the textbook answer is incorrect, and finally to design and security scenarios that reveal whether the candidate has shipped systems where integer width and overflow actually mattered.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [Java](#java)
  - [Go](#go)
  - [Python](#python)
  - [C++](#c)
  - [Rust](#rust)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design / Scenario Questions](#design--scenario-questions)
- [Coding Questions](#coding-questions)
- [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)
- [Related Topics](#related-topics)

---

## Conceptual / Foundational

## Question 1

**Q: How are unsigned integers represented in binary, and what is the range of an n-bit unsigned integer?**

Each bit `bᵢ` contributes `bᵢ · 2ⁱ`; the value is the plain base-2 sum. An n-bit unsigned integer represents `0` through `2ⁿ − 1` inclusive — `2ⁿ` distinct values. So 8-bit unsigned is `0…255`, 16-bit is `0…65535`, 32-bit is `0…4294967295`, 64-bit is `0…18446744073709551615`. There is no sign bit; every bit is magnitude. Unsigned arithmetic is exact modular arithmetic mod `2ⁿ`, which is why it wraps cleanly and predictably.

## Question 2

**Q: Explain two's complement. Why is it used instead of sign-magnitude?**

In two's complement, the most significant bit carries a *negative* place value `−2ⁿ⁻¹`; the rest are positive as usual. The value of an n-bit pattern is `−bₙ₋₁·2ⁿ⁻¹ + Σ(i<n−1) bᵢ·2ⁱ`. The range is `[−2ⁿ⁻¹, 2ⁿ⁻¹ − 1]`. It's used over sign-magnitude because: (1) it has exactly **one zero** (sign-magnitude has +0 and −0, complicating equality and arithmetic); (2) the **same adder circuit** handles signed and unsigned addition — add the bit patterns mod 2ⁿ, discard the carry, and the result is correct under both interpretations; (3) **negation is `~x + 1`**, and subtraction is just adding the negation; (4) **sign extension is free** (replicate the top bit). These hardware simplicities are why every modern CPU uses it, and why C23 now mandates it.

## Question 3

**Q: What is sign extension, and how does it differ from zero extension?**

When you widen an integer to a larger type, you must fill the new high bits. For a **signed** value you replicate the sign bit (the MSB) into all new bits — *sign extension* — so the value is preserved: `−1` as 8-bit `0xFF` becomes 32-bit `0xFFFFFFFF` (still −1). For an **unsigned** value you fill with zeros — *zero extension* — so 8-bit `0xFF` (255) becomes `0x000000FF` (still 255). The compiler chooses based on the *source* type's signedness (`movsx` vs `movzx` on x86). Getting this wrong — zero-extending a signed value — turns `−1` into `255`.

## Question 4

**Q: What is integer overflow, and what is wraparound?**

Overflow is when an arithmetic result falls outside the representable range of the type — larger than MAX or smaller than MIN. Wraparound is the *behavior* (in languages that define it) where the value "rolls over" modulo 2ⁿ, like an odometer: unsigned 8-bit `255 + 1 = 0`, signed 8-bit `127 + 1 = −128`. Critically, **overflow and wraparound are not synonyms**: overflow is the condition, wraparound is one possible response to it. C signed overflow is undefined (no wrap guaranteed), Rust panics in debug, Python can't overflow at all — only some languages define the response as wraparound.

## Question 5

**Q: Why is the most-negative value special? Explain the `INT_MIN` asymmetry.**

Two's complement has one more negative value than positive, because zero occupies a slot on the non-negative side: the range is `[−2ⁿ⁻¹, 2ⁿ⁻¹ − 1]`, so there are `2ⁿ⁻¹` negatives and only `2ⁿ⁻¹ − 1` positives. Consequence: **`INT_MIN` has no positive twin.** `−INT_MIN` would be `INT_MAX + 1`, which overflows. This breaks `−x`, `abs(x)`, and `x / −1` for `x == INT_MIN`. In C all three are undefined behavior; on x86 `INT_MIN / −1` raises `#DE` (the divide-error trap, same as divide-by-zero) because the true quotient doesn't fit the destination register.

## Question 6

**Q: What is the difference between saturating and wrapping arithmetic?**

Both define what happens on overflow, differently. **Wrapping** computes mod 2ⁿ: `255 + 1 = 0` (8-bit unsigned) — correct for hashing, checksums, ring buffers, PRNGs. **Saturating** clamps to the type's limit: `255 + 1 = 255`, `0 − 1 = 0` — correct for audio samples (clipping not popping), color channels, and bounded meters. Using the wrong one is a real bug: a saturating audio mixer that wraps produces a loud glitch; a wrapping progress bar that should saturate goes backwards. Rust exposes both (`wrapping_add`, `saturating_add`); SIMD ISAs have hardware saturating ops (`paddsb`).

## Question 7

**Q: How do you detect signed integer overflow correctly, and why is the obvious post-check wrong in C?**

The correct, portable technique is to **check before computing**: `if (b > 0 && a > INT_MAX - b) overflow();` — this never performs the overflowing operation. Alternatives: compute in a wider type and check the result fits, or use a hardware-assisted builtin (`__builtin_add_overflow`, C23 `ckd_add`) that does the add and reads the CPU overflow flag in one shot. The obvious idiom `int r = a + b; if (r < a) overflow();` is **valid for unsigned** (wrap is defined, a smaller result means it wrapped) but **a bug for signed in C**: the addition `a + b` is itself undefined behavior when it overflows, so by the time you check `r` you've already invoked UB, and the optimizer — which assumes signed overflow never happens — may delete the entire check.

## Question 8

**Q: Why does the size of `int` matter, and what is `size_t`?**

`int` width is not fixed by C (it's "at least 16 bits," almost always 32 on modern systems), and `long` is 64-bit on Unix (LP64) but 32-bit on Windows (LLP64) — so code assuming a specific width breaks across platforms; use `<stdint.h>` (`int32_t`, `int64_t`) when width matters. `size_t` is an **unsigned** type guaranteed wide enough to hold the size of any object (32-bit on 32-bit platforms, 64-bit on 64-bit), and it's the type of `sizeof`, array lengths, and `malloc`'s argument. Its unsignedness is the source of the classic signed/unsigned comparison bug (`for (int i = 0; i < v.size(); i++)`), and its underflow (`size - 1` when `size == 0`) is a common OOB vector.

---

## Language-Specific

### Java

## Question 9

**Q: What does Java do on integer overflow, and how do you opt into detection?**

Java *defines* overflow as two's-complement wraparound: `Integer.MAX_VALUE + 1 == Integer.MIN_VALUE`, silently and portably (no UB). To detect it, use `Math.addExact`, `subtractExact`, `multiplyExact`, `negateExact`, `incrementExact`, `absExact` (the `*Exact` family, since Java 8 / 15 for `absExact`), which throw `ArithmeticException` on overflow. For values beyond 64 bits, use `BigInteger`. Java's wrap is predictable but silent, so for any arithmetic that must be *correct* (money, sizes), the `*Exact` methods are the right default.

## Question 10

**Q: Java has no unsigned integer types. How do you do unsigned arithmetic?**

Java's primitives are all signed (`byte` is `[−128,127]`). Java 8 added *unsigned operations over signed storage*: `Integer.toUnsignedLong(x)`, `Integer.divideUnsigned`, `Integer.remainderUnsigned`, `Integer.compareUnsigned`, `Long.parseUnsignedLong`, and the same for `Long`. To read a raw byte as 0…255 you write `b & 0xFF` (which promotes to `int` and masks off the sign extension). The mental model: store the bits in a signed type, apply unsigned *operations* when you need unsigned semantics. The designers omitted unsigned types deliberately, judging the signed/unsigned conversion traps to be more confusing than the feature was worth.

## Question 11

**Q: What is `(byte)(a + b)` doing in Java when `a` and `b` are bytes?**

Java promotes both `byte` operands to `int` before the addition, so `a + b` has type `int` — that's why `byte sum = a + b;` is a compile error ("possible lossy conversion") and you must cast. The cast `(byte)(a + b)` then **truncates** the 32-bit result to 8 bits by keeping the low byte: `(byte)(100 + 100)` = `(byte)200` = `−56` (because `200` as a signed byte is `0xC8` = −56). So the arithmetic happens in 32 bits; the wrap to 8 bits happens only at the narrowing cast.

### Go

## Question 12

**Q: How does Go handle integer overflow, and what's notable about its conversion rules?**

Go *defines* overflow as wraparound for both signed and unsigned — fully specified, no UB. `int8(127) + 1 == −128`. Notably, Go also *defines* `math.MinInt32 / −1` to wrap to `MinInt32` rather than trapping (avoiding the x86 SIGFPE surprise that C leaves undefined). Go's biggest safety win is **no implicit conversions**: you cannot mix `int` and `uint`, or `int32` and `int64`, in an expression without an explicit conversion. This structurally eliminates the C signed/unsigned comparison bug — `var s int; var u uint; s < u` simply won't compile. Go also rejects *constant* overflow at compile time (`var x int8 = 300` is an error).

## Question 13

**Q: Go has no overflow-checking arithmetic in the language. How do you detect overflow?**

You check manually or use `math/bits`: `bits.Add64(a, b, carry)` returns the carry-out (nonzero means unsigned overflow), `bits.Mul64(a, b)` returns the 128-bit product as `(hi, lo)` so a nonzero `hi` indicates overflow of the 64-bit product, and `bits.Sub64` returns the borrow. For signed checks you compare against `math.MaxInt64`/`MinInt64` before computing (the pre-check pattern). Go deliberately keeps overflow defined-but-silent and gives you `math/bits` as the toolbox when you need to know.

### Python

## Question 14

**Q: Why doesn't Python overflow, and what's the catch?**

Python's `int` is **arbitrary precision**: it automatically grows to as many machine words as needed, so `2 ** 10000` computes exactly and there is no fixed width to overflow. The catches: (1) **performance** — big-int operations are O(digits) and allocate, so a hot loop on huge numbers is slow and memory-heavy; (2) **NumPy reintroduces fixed widths** — `numpy.int32` arrays *do* wrap (or raise, depending on settings), so the "Python never overflows" intuition fails inside numerical code; (3) **timing side channels** — variable-length big-int math leaks operand magnitude, which matters in crypto. So "Python can't overflow" is true for the built-in `int` and false the moment you touch NumPy, `ctypes`, or `struct`.

## Question 15

**Q: In Python, how do you get C-style fixed-width / wrapping integer behavior when you need it?**

Mask explicitly: `(x & 0xFFFFFFFF)` gives you the low 32 bits (unsigned wrap), and to interpret as signed you subtract `0x100000000` when the high bit is set, or use `ctypes.c_int32(x).value`. The `struct` and `array` modules pack into fixed-width C types (and will raise or wrap on out-of-range). NumPy gives true fixed-width dtypes with C wrap semantics. So Python *can* emulate fixed-width integers, but you must opt in — the default `int` will never do it for you.

### C++

## Question 16

**Q: What is undefined behavior on signed overflow, and what can the compiler do with it?**

In C and C++, signed integer overflow is **undefined behavior** — the standard imposes no requirements, so the compiler may assume it *never occurs* and optimize on that assumption. Practically: it may assume `a + 1 > a` (so loops with `int` counters are assumed to terminate, enabling vectorization and induction-variable widening), and it may **delete overflow checks written after the fact** because `if (a + b < a)` is "impossible" under the no-overflow assumption. Unsigned overflow, by contrast, is *defined* to wrap mod 2ⁿ. The escape hatches: `-fwrapv` (define signed overflow as wrapping), `-ftrapv` (trap on it), and `-fsanitize=signed-integer-overflow` (detect at runtime).

## Question 17

**Q: How do you safely allocate `count * size` bytes in C/C++?**

Never `malloc(count * size)` when `count` is untrusted — the multiplication can overflow `size_t` to a small value, yielding an undersized buffer (CWE-680, the integer-overflow-to-heap-overflow chain). Use `calloc(count, size)`, which the standard *requires* to detect the overflow and return `NULL`; or `reallocarray` (BSD/glibc); or check explicitly with `__builtin_mul_overflow(count, size, &bytes)` / C23 `ckd_mul(&bytes, count, size)` before allocating. In C++, prefer `std::vector` which handles this, or `std::span`/container APIs that bound-check.

## Question 18

**Q: Why is comparing a signed `int` to `vector::size()` a warning, and how do you fix it?**

`size()` returns `size_t` (unsigned). In `for (int i = 0; i < v.size(); i++)`, the signed `i` is converted to unsigned for the comparison (the usual arithmetic conversions promote the signed operand when the unsigned type's rank is ≥). It usually works, but breaks if `v.size()` exceeds `INT_MAX` or if `i` ever goes negative (the negative `i` becomes a huge unsigned and the loop misbehaves). Compilers emit `-Wsign-compare`. Fix: use `size_t i` (or `std::size_t`), or `std::ssize(v)` (C++20, returns a signed size), or a range-based `for`.

### Rust

## Question 19

**Q: What does Rust do on overflow, and why does debug differ from release?**

In a **debug build**, arithmetic overflow **panics** ("attempt to add with overflow") — so bugs surface immediately during development. In a **release build**, it **wraps** (two's complement) for performance, because the panic checks cost cycles in hot loops. Because of this split, you should never rely on the default for correctness in release; instead use the explicit families: `checked_add` (returns `Option`, `None` on overflow), `wrapping_add` (deliberate wrap), `saturating_add` (clamp to MAX/MIN), and `overflowing_add` (returns `(value, did_overflow)`). This makes the overflow policy explicit and visible at every call site.

## Question 20

**Q: How does Rust handle the `INT_MIN` traps?**

It gives you safe APIs: `i32::MIN.checked_neg()` and `.checked_abs()` return `None`; `.unsigned_abs()` returns the magnitude as a `u32` (which always fits, since `2³¹` fits in `u32`); `.checked_div(-1)` on `MIN` returns `None`. The plain `i32::MIN.abs()` *panics* in debug (and wraps in release). For narrowing, `u8::try_from(300)` returns `Err` rather than silently truncating (whereas `300_i32 as u8` truncates to `44` — `as` is the one place Rust silently truncates, which is why `try_from` is preferred at boundaries).

## Question 21

**Q: When would you use `Wrapping<T>` versus `checked_*` in Rust?**

Use `Wrapping<T>` when **modular arithmetic is the algorithm** — hashing (`h = h * 31 + c`), CRCs, LCG/xorshift PRNGs, sequence numbers — so that `+`, `*`, etc. wrap by construction and never panic even in debug; it documents "wrap is intentional" at the type level. Use `checked_*` (or `try_*`) when **overflow is an error** — size/money/index math — so you get an `Option`/`Result` to handle. The distinction is intent: `Wrapping` says "I want mod 2ⁿ"; `checked` says "tell me if this overflowed."

---

## Tricky / Trap Questions

## Question 22

**Q: Why does `for (unsigned i = n; i >= 0; i--)` never terminate?**

Because an `unsigned` value is *always* `≥ 0` by definition. When `i` reaches 0 and you do `i--`, it underflows-wraps to `UINT_MAX` (a huge positive value), which is still `≥ 0`, so the loop condition can never become false. The fix is to use a signed loop variable, or restructure: `for (unsigned i = n; i-- > 0; )` (post-decrement test), or loop up and index `n - 1 - i`.

## Question 23

**Q: What is `(unsigned char)200 + (unsigned char)100` in C — and what's the type of the expression?**

The expression's value is `300` and its type is `int`, not `unsigned char`. C's **integer promotion** converts both `unsigned char` operands to `int` before the addition, so the arithmetic happens in (at least) 32 bits and does not wrap at 256. Wraparound to 8 bits (`300 & 0xFF = 44`) only happens if you *store* the result back into an `unsigned char`. This trips up people who expect 8-bit arithmetic to wrap mid-expression.

## Question 24

**Q: Why is `(low + high) / 2` a bug, and what's the fix?**

When `low + high` exceeds `INT_MAX` (for large array indices), the addition overflows — in C that's UB, in Java/Go it wraps to a negative number — so the computed midpoint is wrong or negative, breaking binary search and mergesort. The fix is `low + (high - low) / 2`, which can't overflow when `low ≤ high` because `high - low` is non-negative and ≤ `high` ≤ `INT_MAX`. Joshua Bloch documented that nearly all textbook and library binary searches had this bug (including `java.util.Arrays.binarySearch`).

## Question 25

**Q: Is `abs(INT_MIN)` safe? What does it return?**

No. In C it's **undefined behavior** (`abs` of `INT_MIN` would need to produce `INT_MAX + 1`, which overflows). In Java, `Math.abs(Integer.MIN_VALUE)` returns `Integer.MIN_VALUE` — a *negative* number, the broken result — because `−MIN_VALUE` wraps back to `MIN_VALUE`. In Rust debug it panics. The root cause is the `INT_MIN` asymmetry: the most-negative value has no positive counterpart. Correct tools: `Math.absExact` (Java 15+, throws), `i32::checked_abs()`/`unsigned_abs()` (Rust), or a manual guard.

## Question 26

**Q: Why is `-1 < 1u` false in C?**

In the comparison, the operands have different signedness (`int` and `unsigned int`) of equal rank, so the **usual arithmetic conversions** convert the signed `−1` to unsigned: `−1` becomes `UINT_MAX` (4294967295). The comparison is then `4294967295 < 1`, which is false. The mathematical relationship inverted purely because of an implicit conversion. This is the root of the classic bug where a signed length compared against `sizeof`/`.size()` lets a `−1` error value pass a bounds check.

## Question 27

**Q: Does `INT_MIN / -1` just give the wrong number?**

No — on x86 it **traps**. The true quotient is `INT_MAX + 1`, which doesn't fit the result register, so the `idiv` instruction raises `#DE` (divide error), the *same* hardware exception as divide-by-zero. In C it's undefined behavior. Go specifically *defines* it to wrap to `INT_MIN` (avoiding the trap). So a correct signed-division guard must check **both** `b == 0` and `(a == INT_MIN && b == -1)` — most people remember only the first.

## Question 28

**Q: My C code relies on signed overflow wrapping and "works." Why is that fragile?**

Because it works by accident of the current compiler/optimization level, not by guarantee. Signed overflow is undefined behavior; a future compiler version, a higher `-O` level, or a different target may assume it never happens and miscompile (delete a check, change a loop bound, vectorize incorrectly). The classic failure is upgrading the compiler and watching "stable" code break. If you genuinely need wrapping, compile with `-fwrapv` (which *defines* it) or use unsigned types / explicit `wrapping_*` equivalents — don't rely on the UB.

## Question 29

**Q: Will Go and Java behave identically on `MAX + 1`? What about `MIN / -1`?**

On `MAX + 1`: yes — both define it as wraparound to `MIN`. On `MIN / −1`: Go defines it (wraps to `MIN`), and Java also defines it (`Integer.MIN_VALUE / -1 == Integer.MIN_VALUE`, no exception) — both avoid the trap that C leaves undefined and x86 would raise. The portable lesson: don't assume the *C* behavior (UB/trap) when working in Go/Java, and don't assume the Go/Java behavior (defined wrap) when working in C.

---

## Design / Scenario Questions

## Question 30

**Q: You're designing a view counter for a video platform. What type do you choose and why?**

64-bit (signed or unsigned). A 32-bit signed counter caps at ~2.1 billion — YouTube literally hit this with "Gangnam Style" and had to migrate. A 64-bit counter holds ~9.2×10¹⁸ (signed) or ~1.8×10¹⁹ (unsigned); at a billion increments per second it lasts centuries, so overflow is physically impossible within the platform's lifetime. I'd also make increments atomic/idempotent for concurrency, and store as `BIGINT` in the database. The reasoning I want to show: *compute the rollover horizon against the realistic growth rate, and choose a width that puts it beyond the system's lifetime.*

## Question 31

**Q: You receive a length-prefixed message from the network. Walk me through safe parsing.**

Validate before you compute. (1) Confirm you have at least the header bytes before reading or subtracting (`if (len < HEADER) reject`) — this guards the underflow in `len - HEADER`. (2) Read the declared length and bound it against a sane maximum (`if (declared > MAX) reject`) — never trust an attacker-supplied size. (3) Confirm it fits the data you actually received (`if (declared > available) reject`). (4) Only now do arithmetic/allocation, using overflow-checked operations (`calloc`/`ckd_mul`) for any `count * size`. The principle: the first thing that happens to an untrusted integer is a range check, never arithmetic — otherwise the overflow happens before you can catch it (this is the Heartbleed-family failure).

## Question 32

**Q: Design the integer strategy for a financial ledger.**

Never floating point. Store amounts as integers in the smallest unit (cents, or micros/satoshis for higher precision), in 64-bit (or arbitrary precision / `BigInteger`/`BigDecimal` if values can be astronomical). Use **checked arithmetic** on every operation (`Math.addExact`, `checked_add`, `ckd_*`) so an overflow is a loud error — a wrong balance is a correctness violation, never a silent wrap. Guard division for the `INT_MIN/-1` case and rounding policy explicitly. For audit, keep the arithmetic deterministic and reproducible. The judgment I'm looking for: integrity over availability — crash/alert on overflow rather than silently corrupt money.

## Question 33

**Q: How would you choose between saturating and wrapping arithmetic for an audio mixer?**

Saturating. When summing audio samples, exceeding the sample range should **clip** (clamp to max/min amplitude) — an audible but graceful distortion — not **wrap**, which flips a loud positive peak to a loud negative value, producing a harsh click/pop and potentially damaging equipment or ears. Hardware SIMD provides saturating add (`paddsb`/`paddsw`, NEON `sqadd`) for exactly this. Wrapping would only be correct for things like a phase accumulator where modular behavior is the intent.

## Question 34

**Q: An embedded device must run for years without reboot. What's your integer discipline for its tick counter?**

Choose a width whose rollover horizon exceeds the mission lifetime with margin, and *document the horizon at the declaration*. A 32-bit counter at 100 Hz overflows in ~248 days (the Boeing 787 GCU bug); a 64-bit counter at the same rate lasts billions of years. Pair the width choice with a watchdog so that even a miscalculated horizon degrades safely rather than failing silently mid-operation, and add the rollover behavior to the test plan (you can't run a 248-day test, so simulate the counter near its limit).

---

## Coding Questions

## Question 35

**Q: Implement overflow-safe signed addition.**

```c
#include <limits.h>
#include <stdbool.h>

bool safe_add(int a, int b, int *out) {
    if (b > 0 && a > INT_MAX - b) return false;  // would exceed MAX
    if (b < 0 && a < INT_MIN - b) return false;  // would go below MIN
    *out = a + b;                                // now provably safe
    return true;
}
```

The key is to test the operands against the limits *before* performing the addition, so the overflowing operation never executes (avoiding C's UB). The hardware-assisted equivalent is `return !__builtin_add_overflow(a, b, out);`.

## Question 36

**Q: Implement overflow-safe signed multiplication.**

```c
#include <limits.h>
#include <stdbool.h>

bool safe_mul(int a, int b, int *out) {
    if (a == 0 || b == 0) { *out = 0; return true; }
    // The INT_MIN/-1 case overflows and would also trap if done via division checks:
    if (a == -1 && b == INT_MIN) return false;
    if (b == -1 && a == INT_MIN) return false;
    if (a > 0) {
        if (b > 0) { if (a > INT_MAX / b) return false; }
        else       { if (b < INT_MIN / a) return false; }
    } else {
        if (b > 0) { if (a < INT_MIN / b) return false; }
        else       { if (a < INT_MAX / b) return false; }
    }
    *out = a * b;
    return true;
}
```

Multiplication is trickier than addition because of the four sign quadrants and the `INT_MIN/-1` division trap inside the checks themselves. In practice, prefer `__builtin_mul_overflow` / C23 `ckd_mul`.

## Question 37

**Q: Convert a signed value to its unsigned representation manually, and back.**

```c
// signed -> unsigned: the bit pattern is preserved; conversion is defined in C
unsigned to_unsigned(int x) { return (unsigned)x; }   // -1 -> UINT_MAX

// unsigned -> signed without implementation-defined behavior (pre-C23):
int to_signed(unsigned u) {
    if (u <= (unsigned)INT_MAX) return (int)u;        // fits directly
    return (int)(u - (unsigned)INT_MIN) + INT_MIN;    // map the high half
}
```

`(unsigned)x` is fully defined (mod 2ⁿ). The reverse `(int)u` for `u > INT_MAX` was implementation-defined before C23 (now defined as two's complement), so the explicit mapping above is the portable form.

## Question 38

**Q: Write a binary search with an overflow-safe midpoint.**

```python
def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = lo + (hi - lo) // 2     # NOT (lo + hi) // 2 — avoids overflow
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

(Python doesn't overflow, so this is for illustration; in Java/C/Go/Rust the `lo + (hi - lo) / 2` form is *required* for correctness on large arrays.)

## Question 39

**Q: Detect unsigned overflow on addition (where it's legal to post-check).**

```c
#include <stdbool.h>
bool uadd_overflows(unsigned a, unsigned b, unsigned *out) {
    *out = a + b;            // unsigned wrap is DEFINED
    return *out < a;         // wrapped iff result is smaller than an operand
}
```

For unsigned, the post-check is valid precisely because the wrap is defined behavior — a sum smaller than one of its operands must have wrapped. This is exactly the check that is *invalid* for signed types in C.

---

## What I'd Ask a Candidate Now

These probe judgment rather than recall.

## Question 40

**Q: When is "just use 64-bit" a complete fix for overflow, and when isn't it?**

Looking for: it fixes unbounded counters/IDs/ticks (the time-bomb class) since the horizon becomes effectively infinite, and it's cheap on 64-bit hardware. It does *not* fix multiplication (size math overflows 64-bit easily), fixed wire/format widths, or logic errors like signed/unsigned confusion. A candidate who treats widening as a silver bullet, or who never reaches for it, both worry me.

## Question 41

**Q: How do you decide between defined-wrap, trap, and checked arithmetic for a given system?**

Looking for: a threat-model-driven answer. Defined-wrap (Java/Go) is fine where overflow can't happen or is harmless; trap (Swift, `-ftrapv`, Rust-debug) where finding bugs early or failing closed matters more than availability; checked (`*Exact`/`checked_*`/`ckd_*`) for the surgical case — size and money math — where you want the integrity guarantee without a global cost. The candidate should note that defined-wrap is *not* the same as correct.

## Question 42

**Q: What's the most dangerous integer bug you've seen in code review, and why?**

Looking for: a concrete, experienced answer. Strong ones cite the `malloc(count * size)` allocation overflow (because it chains to memory corruption / RCE), a trusted length field (Heartbleed-shaped), or a signed/unsigned bounds-check bypass. The reasoning should connect the *arithmetic* bug to its *security* consequence — overflow as an exploit enabler, not just a wrong number.

## Question 43

**Q: How would you harden an existing C/C++ codebase against integer overflow?**

Looking for: layered defense. Turn on `-Wsign-compare -Wconversion` and treat as errors; add UBSan + fuzzing in CI to surface latent overflow; static analysis (CodeQL/Semgrep) flagging `malloc(a*b)` and untrusted-length flows; replace `malloc(a*b)` with `calloc`/`reallocarray`/`ckd_mul`; widen counters; and consider `-fwrapv` or targeted checked ops on hot risk areas. Bonus: rewriting the highest-risk parsers in a memory-safe language.

## Question 44

**Q: How do you test code for overflow when the failure only appears at extreme values or after long runtimes?**

Looking for: boundary testing (MAX/MIN/0/−1, not just typical values), property-based testing/fuzzing with sanitizers to explore the input space, and *simulating* time-based counters near their limit rather than waiting (you can't run a 248-day test, so seed the counter near rollover). Acknowledging that overflow lives only at the extremes — so typical-case tests prove nothing — is the mature answer.

---

## Cheat Sheet

```text
+--------------------------------------------------------------+
| Integer Representation & Overflow Must-Know                  |
+--------------------------------------------------------------+
| 1. Two's complement: top bit = -2^(n-1); one zero, one adder |
|    -x = ~x + 1 ; signed range [-2^(n-1), 2^(n-1)-1]          |
|                                                              |
| 2. INT_MIN asymmetry: no positive twin                       |
|    -INT_MIN, abs(INT_MIN), INT_MIN/-1 all BROKEN             |
|    INT_MIN/-1 TRAPS (#DE) on x86; guard b==0 AND MIN/-1      |
|                                                              |
| 3. Overflow behavior is LANGUAGE-SPECIFIC:                   |
|    C/C++  signed=UB, unsigned=wrap                           |
|    Java   wrap (Math.*Exact throws)                          |
|    Go     wrap (math/bits for carry); no implicit convert    |
|    Rust   panic(debug)/wrap(release)+checked/wrap/saturate   |
|    Python arbitrary precision (NumPy wraps)                  |
|    Swift  TRAPS by default (&+ to wrap)                      |
|                                                              |
| 4. Detect signed overflow BEFORE, not after (post=UB in C)   |
|    pre-check / wider type / __builtin_*_overflow / ckd_*     |
|                                                              |
| 5. Promotion: char/short -> int before arithmetic (C)        |
|    so 8/16-bit wrap only on the narrowing STORE             |
|                                                              |
| 6. -1 < 1u is FALSE: signed converts to huge unsigned        |
|                                                              |
| 7. malloc(count*size) -> use calloc/reallocarray/ckd_mul     |
|    (CWE-190 -> 680 -> heap overflow -> RCE)                  |
|                                                              |
| 8. midpoint: lo + (hi-lo)/2, never (lo+hi)/2                 |
|                                                              |
| 9. saturate (clamp) vs wrap (mod 2^n) — pick by domain       |
|                                                              |
| 10. counters: 64-bit + document rollover horizon (787/YouTube)|
+--------------------------------------------------------------+
```

---

## Further Reading

- *Computer Systems: A Programmer's Perspective* (Bryant & O'Hallaron), Ch. 2 — the definitive treatment.
- *Hacker's Delight* — Henry S. Warren. Bit-level overflow detection and arithmetic.
- *Secure Coding in C and C++* — Robert Seacord. Overflow as a vulnerability class; the CERT INT rules.
- "What Every C Programmer Should Know About Undefined Behavior" — Chris Lattner (LLVM blog).
- MITRE CWE-190 / CWE-191 / CWE-680 — the vulnerability taxonomy.
- Joshua Bloch, "Nearly All Binary Searches and Mergesorts are Broken" (2006).
- The Rust Book, integer-overflow section; Rust `std::num` checked/wrapping/saturating docs.
- C23 `<stdckdint.h>` and the two's-complement mandate (WG14 N2412).

---

## Related Topics

- This folder: [`junior.md`](junior.md), [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`tasks.md`](tasks.md).
- Sibling numerics: [Floating-Point Representation](../02-floating-point-ieee-754/interview.md).
- Security: `../../../quality-engineering/static-analysis/sast/interview.md`, `../../../quality-engineering/dynamic-analysis-and-sanitizers/interview.md`.
- Hardware: `../../cpu-architecture/01-alu/interview.md` — overflow/carry flags, `idiv` trap.
