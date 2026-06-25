# Integer Representation & Overflow — Hands-On Tasks

> **Topic:** [Integer Representation & Overflow](README.md)
> **Focus:** Build, break, and reason about fixed-width integers and overflow with your own hands. Every task has a self-check box, a hint, and (for the harder ones) a sparse sample solution.

---

## How to Use This Page

Work top to bottom; the tasks escalate from "see the wrap with your own eyes" to "exploit a size-calculation overflow and then fix it." Do them in a language with **fixed-width integers and visible overflow** — C is ideal because it shows the rawest behavior; Rust is excellent because its `checked_*`/`wrapping_*` APIs make intent explicit; Go and Java work well too. Avoid doing the early tasks *only* in Python — its arbitrary-precision integers hide the very behavior you're trying to observe (though Python is great for the masking exercises at the end).

For each task:
- [ ] Read it and predict the answer **before** running anything. Write your prediction down.
- [ ] Run it. Compare to your prediction.
- [ ] If they differ, figure out *why* using the tier pages — that gap is where the learning is.

> Tooling tip: compile C tasks with `-fsanitize=signed-integer-overflow -fsanitize=unsigned-integer-overflow` to get a runtime diagnostic at the exact overflow point, and *also* with `-O2 -fstrict-overflow` to watch the optimizer change behavior. Run Rust tasks in **debug** mode (default) so overflow panics fire.

---

## Section 1 — See the Representation

### Task 1.1 — Watch the seam (signed 8-bit wrap)

- [ ] Print an 8-bit signed integer as you increment it from `124` to `130`. Observe the jump at `127`.

**Hint:** Use `int8_t` in C, `i8` in Rust, `int8` in Go, `byte` in Java. Increment in a loop and print each value.

<details>
<summary>Sample solution (C)</summary>

```c
#include <stdio.h>
#include <stdint.h>
int main(void) {
    for (int v = 124; v <= 130; v++) {
        int8_t x = (int8_t)v;   // forced into 8 bits
        printf("%d -> %d\n", v, x);
    }
    return 0;
}
// 124->124 125->125 126->126 127->127 128->-128 129->-127 130->-126
```
The wrap at 127→−128 is the two's-complement seam.
</details>

### Task 1.2 — Two readings of one bit pattern

- [ ] Take the byte `0xFF` and print it interpreted as **unsigned** (expect 255) and as **signed** (expect −1) without changing the bits.

**Hint:** Store `0xFF` in a `uint8_t`, print with `%u`; cast the same bits to `int8_t`, print with `%d`.

### Task 1.3 — Build two's complement by hand

- [ ] Write a function `negate8(x)` that computes the 8-bit two's complement of `x` using only bitwise NOT and `+1` (i.e., `~x + 1`), and verify it matches `-x` for all values **except** `INT8_MIN`. Explain the exception.

**Hint:** Loop `x` over `−128..127`, compare `negate8(x)` to `(int8_t)(-x)`. Watch what happens at `−128`.

<details>
<summary>Sample solution (C)</summary>

```c
#include <stdio.h>
#include <stdint.h>
int8_t negate8(int8_t x) { return (int8_t)(~(uint8_t)x + 1); }
int main(void) {
    for (int v = -128; v <= 127; v++) {
        int8_t x = (int8_t)v;
        int8_t n = negate8(x);
        if (n != (int8_t)(-x))
            printf("mismatch at %d: ~x+1=%d, -x=%d\n", x, n, (int8_t)(-x));
    }
    return 0;
}
// negate8(-128) == -128 (the asymmetry: -(-128) overflows; ~x+1 wraps to itself)
```
</details>

### Task 1.4 — Sign extension vs zero extension

- [ ] Widen the 8-bit value `0xFF` to 32 bits two ways: as a signed type (expect `−1`) and as an unsigned type (expect `255`). Print both as `%d` and as hex.

**Hint:** `int32_t s = (int8_t)0xFF;` vs `uint32_t u = (uint8_t)0xFF;`. Notice the high bits.

---

## Section 2 — Make It Overflow

### Task 2.1 — One overflow, five languages

- [ ] Compute `MAX + 1` for a 32-bit signed integer in **C, Java, Go, Rust (debug), and Python**, and tabulate the results.

**Hint:** Expect: C = wraps but is UB (may print `INT_MIN` or anything under `-O2`); Java = `MIN_VALUE`; Go = `MinInt32`; Rust debug = **panic**; Python = a normal big number, no overflow.

<details>
<summary>Expected results table</summary>

| Language | `INT32_MAX + 1` |
|----------|-----------------|
| C | `−2147483648` at `-O0` (but **UB** — don't rely on it) |
| Java | `−2147483648` (defined wrap) |
| Go | `−2147483648` (defined wrap) |
| Rust (debug) | **panic**: "attempt to add with overflow" |
| Rust (release) | `−2147483648` (wraps) |
| Python | `2147483648` (no overflow) |
</details>

### Task 2.2 — Unsigned underflow

- [ ] Compute `0 − 1` for an **unsigned** 32-bit integer. Predict, then run. Why is it not `−1`?

**Hint:** Unsigned wrap is *defined* mod 2³². Expect `4294967295`.

### Task 2.3 — The infinite loop

- [ ] Write `for (unsigned i = 5; i >= 0; i--)` and observe (briefly!) that it never terminates. Explain why, then fix it two different ways.

**Hint:** `i >= 0` is always true for unsigned. Fixes: signed loop variable, or `for (unsigned i = 5; i-- > 0; )`.

### Task 2.4 — Multiplication overflows before addition

- [ ] Using 32-bit signed ints, compute `a + b` and `a * b` for `a = b = 100000`. One overflows, one doesn't. Which, and why?

**Hint:** `100000 + 100000 = 200000` (fine). `100000 * 100000 = 10¹⁰` ≈ 10 billion (overflows 32-bit's ~2.1 billion). Multiplication grows the magnitude far faster.

---

## Section 3 — Conversions & Promotion

### Task 3.1 — The promotion surprise

- [ ] In C, print the **type and value** of `(unsigned char)200 + (unsigned char)100`. Then store it back into an `unsigned char` and print again. Explain the two different results.

**Hint:** The expression is `int` with value `300` (promotion). Stored into `unsigned char` it truncates to `44` (`300 & 0xFF`).

### Task 3.2 — Truncation keeps the low bits

- [ ] Take the 32-bit value `0x12345678` and truncate it to 16 bits and to 8 bits. Predict the surviving bits before running.

**Hint:** 16-bit → `0x5678`, 8-bit → `0x78`. Truncation discards the *high* bits, keeps the low.

### Task 3.3 — The signed/unsigned comparison trap

- [ ] Write `if (-1 < 1u) printf("less"); else printf("not less");` in C. Predict the output, run it, then fix the comparison so it behaves mathematically.

**Hint:** It prints "not less" because `−1` converts to `4294967295`. Fix: guard the sign first — `if (a < 0 || (unsigned)a < b)`.

<details>
<summary>Sample solution (C)</summary>

```c
#include <stdio.h>
int main(void) {
    int a = -1; unsigned b = 1;
    printf("%s\n", (a < b) ? "less" : "not less");          // "not less" (bug)
    printf("%s\n", (a < 0 || (unsigned)a < b) ? "less" : "not less"); // "less"
    return 0;
}
```
</details>

### Task 3.4 — Narrowing a 64-bit id into a 32-bit field

- [ ] Take the 64-bit value `5_000_000_000` (5 billion) and assign it to a 32-bit signed `int`. What value results, and what real-world bug does this model (hint: database row counts)?

**Hint:** `5e9 & 0xFFFFFFFF` then reinterpreted as signed. It models a 32-bit primary key / API id overflowing past ~2.1 billion rows.

---

## Section 4 — Detect Overflow

### Task 4.1 — Pre-check addition

- [ ] Implement `safe_add(a, b, out)` for 32-bit signed ints using only **pre-checks** against `INT_MAX`/`INT_MIN` (no wider type, no builtin). Test it at `INT_MAX + 1`, `INT_MIN - 1`, and normal cases.

**Hint:** `if (b > 0 && a > INT_MAX - b) return false; if (b < 0 && a < INT_MIN - b) return false;`

### Task 4.2 — Why the post-check fails for signed

- [ ] Write `int r = a + b; if (r < a) overflow();` and test it with `a = INT_MAX, b = 1`. Compile at `-O0` and at `-O2 -fstrict-overflow`. Report whether the check fires in each, and explain.

**Hint:** It may fire at `-O0` but be *deleted* at `-O2` because signed overflow is UB and the compiler assumes `a + b < a` is impossible. This is the core UB lesson.

### Task 4.3 — Post-check IS valid for unsigned

- [ ] Write the same `r = a + b; if (r < a) overflow();` for **unsigned** and test `a = UINT_MAX, b = 1`. Confirm it works at all optimization levels. Explain why unsigned differs.

**Hint:** Unsigned wrap is *defined*, so a result smaller than an operand provably wrapped. No UB to exploit.

### Task 4.4 — Use the hardware

- [ ] Rewrite `safe_add` using `__builtin_add_overflow` (or `ckd_add` in C23). Disassemble (or use Compiler Explorer) and confirm it compiles to roughly `add; jo` — one instruction plus a flag-conditional branch.

**Hint:** `return !__builtin_add_overflow(a, b, out);`. The point: checked arithmetic is nearly free.

---

## Section 5 — The INT_MIN Trap Family

### Task 5.1 — Reproduce all three traps

- [ ] In C, evaluate `−INT_MIN`, `abs(INT_MIN)`, and `INT_MIN / −1`. Predict each, run each (compile without `-ftrapv` first), and note which one *crashes* and why.

**Hint:** `INT_MIN / −1` raises SIGFPE on x86 (divide error). `abs(INT_MIN)` returns `INT_MIN` (still negative). `−INT_MIN` is UB.

<details>
<summary>Sample solution (C)</summary>

```c
#include <stdio.h>
#include <stdlib.h>
#include <limits.h>
int main(void) {
    printf("-INT_MIN  = %d (UB)\n", -INT_MIN);     // UB; often prints INT_MIN
    printf("abs(MIN)  = %d (broken)\n", abs(INT_MIN)); // INT_MIN, still negative
    volatile int b = -1;                           // volatile so it's not const-folded
    printf("INT_MIN/-1 ...\n");
    printf("= %d\n", INT_MIN / b);                 // SIGFPE crash on x86
    return 0;
}
```
</details>

### Task 5.2 — A complete safe_div

- [ ] Implement `safe_div(a, b, out)` that returns false for **both** `b == 0` and the `INT_MIN / −1` case. Verify it never crashes for any 32-bit inputs.

**Hint:** `if (b == 0) return false; if (a == INT_MIN && b == -1) return false;`

### Task 5.3 — unsigned_abs

- [ ] In Rust, show that `i32::MIN.abs()` panics (debug) but `i32::MIN.unsigned_abs()` returns `2147483648`. Explain why the unsigned result can hold what the signed `abs` cannot.

**Hint:** `2³¹` fits in `u32` (range `0..2³²−1`) but not in `i32` (max `2³¹−1`). The asymmetry disappears when the result type is unsigned.

---

## Section 6 — Saturating vs Wrapping

### Task 6.1 — Choose the right one

- [ ] In Rust (or by hand in C), compute `200u8 + 100` three ways: `wrapping_add` (expect 44), `saturating_add` (expect 255), and `checked_add` (expect `None`). State a real use case where each is the *correct* choice.

**Hint:** wrap → hashing/ring buffer; saturate → audio/color/meter; checked → size/money math.

### Task 6.2 — Audio clipping demo

- [ ] Simulate mixing two audio samples near the maximum amplitude (e.g., two `i16` values `30000 + 10000`). Show the difference between wrapping (produces a huge negative "pop") and saturating (clamps to `32767`). Which would you ship and why?

**Hint:** Wrapping: `40000` overflows `i16` to `−25536` — a loud click. Saturating: clamps to `32767` — graceful clipping.

### Task 6.3 — Intentional wrapping hash

- [ ] Implement a tiny string hash `h = h * 31 + c` for each byte, using **wrapping** arithmetic explicitly (`Wrapping<u32>` in Rust, natural wrap in Go/Java). Confirm it never panics even on long strings. Explain why wrapping is *correct* here, not a bug.

**Hint:** The hash is defined over `ℤ/2³²ℤ`; wrap is the algorithm. A `checked` version would wrongly reject valid inputs.

---

## Section 7 — Security & Production

### Task 7.1 — Exploit a size calculation

- [ ] Write the vulnerable `void *buf = malloc(count * size)` followed by a loop writing `count` elements. Pick `count` and `size` so that `count * size` overflows `size_t` to a **small** value (e.g., 16) while `count` is huge. Run it under AddressSanitizer (`-fsanitize=address`) and watch the heap overflow get caught.

**Hint:** On 64-bit, `size = 16`, `count = (SIZE_MAX / 16) + 2` makes the product wrap small. ASan reports the heap-buffer-overflow on the first out-of-bounds write.

<details>
<summary>Sample solution (C, run with -fsanitize=address)</summary>

```c
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
int main(void) {
    size_t size = 16;
    size_t count = (SIZE_MAX / size) + 2;   // count*size wraps to ~16
    char *buf = malloc(count * size);        // tiny allocation!
    if (!buf) return 1;
    memset(buf, 0xAB, count * size);         // writes a few bytes... but if the loop
    // used `count` directly it would write count*size bytes -> overflow.
    for (size_t i = 0; i < count; i++) buf[i] = (char)i;  // ASan fires here
    free(buf);
    return 0;
}
```
</details>

### Task 7.2 — Fix it three ways

- [ ] Rewrite Task 7.1's allocation safely using (a) `calloc(count, size)`, (b) `__builtin_mul_overflow`, and (c) C23 `ckd_mul`. Confirm each refuses the overflowing allocation (returns `NULL`/error) instead of allocating a tiny buffer.

**Hint:** `calloc` is the one-liner; the builtins let you keep `malloc` while checking.

### Task 7.3 — Safe length-prefixed parser

- [ ] Write a function that parses a `[4-byte big-endian length][payload]` message safely. It must reject: too-short input, a declared length over a sane cap, and a declared length larger than the actual data. Then craft three malicious inputs (short, oversized, lying-length) and confirm all are rejected *before* any allocation or copy.

**Hint:** Order matters — check `len >= 4` first (guards the `len - 4` subtraction), then cap, then consistency. See `professional.md`'s template.

### Task 7.4 — Compute a rollover horizon

- [ ] For a counter incremented at 100 Hz, compute the overflow horizon for 16-bit, 32-bit, and 64-bit *unsigned* widths (in seconds/days/years). Confirm the 32-bit figure matches the ~248-day Boeing 787 GCU number. Then state which width you'd ship for a device that must run 20 years without reboot.

**Hint:** `horizon_seconds = 2^bits / 100`. `2³² / 100 / 86400 ≈ 497 days` unsigned (≈ 248 for signed, the 787 case). 64-bit is billions of years.

<details>
<summary>Expected horizons (100 Hz)</summary>

| Width | Unsigned horizon |
|-------|------------------|
| 16-bit | 65536 / 100 ≈ **10.9 minutes** |
| 32-bit | ≈ **497 days** (signed: ≈ 248 days — the 787) |
| 64-bit | ≈ **5.85 billion years** |

Ship 64-bit for a 20-year device — even 32-bit (497 days) fails, and 16-bit fails in minutes.
</details>

---

## Section 8 — Cross-Language & Tooling

### Task 8.1 — Emulate fixed-width in Python

- [ ] In Python (which never overflows), emulate 32-bit unsigned wraparound using masking, and 32-bit signed using masking + sign reinterpretation. Verify `wrap32u(0xFFFFFFFF + 1) == 0` and `wrap32s(0x7FFFFFFF + 1) == −2147483648`.

**Hint:** `wrap32u(x) = x & 0xFFFFFFFF`. For signed: mask, then `if result >= 0x80000000: result -= 0x100000000`.

<details>
<summary>Sample solution (Python)</summary>

```python
def wrap32u(x): return x & 0xFFFFFFFF
def wrap32s(x):
    x &= 0xFFFFFFFF
    return x - 0x100000000 if x >= 0x80000000 else x

assert wrap32u(0xFFFFFFFF + 1) == 0
assert wrap32s(0x7FFFFFFF + 1) == -2147483648
assert wrap32s(0xFFFFFFFF) == -1
```
</details>

### Task 8.2 — Make UBSan fire

- [ ] Compile a deliberate signed overflow with `-fsanitize=signed-integer-overflow` and confirm UBSan prints the exact file, line, and the operand values. Then add `-fwrapv` and confirm the same code now runs silently (defined wrap). Explain the difference between *detecting* and *defining*.

**Hint:** UBSan reports; `-fwrapv` defines-to-wrap (no report). Shipping `-fwrapv` hides the UB but doesn't find the bug.

### Task 8.3 — Watch the optimizer delete a check

- [ ] On Compiler Explorer (godbolt.org), paste a function with a post-overflow check (`if (a + 100 < a) return -1;`). Compare the generated assembly at `-O0` vs `-O2`. Confirm the `-O2` build can remove the check entirely (no compare against the original `a`). Then add `-fwrapv` and watch the check reappear.

**Hint:** This is the most visceral way to *see* why post-checks fail for signed overflow in C.

### Task 8.4 — Width audit across platforms

- [ ] Write a program that prints `sizeof(int)`, `sizeof(long)`, `sizeof(size_t)`, `sizeof(ptrdiff_t)` and the corresponding MAX values. Run it (or reason about it) for LP64 (Linux/macOS) vs LLP64 (Windows). Identify which type changes size between the two and what code it breaks.

**Hint:** `long` is 64-bit on LP64, 32-bit on LLP64. Code assuming `long == 64 bits` (e.g., storing a 64-bit value in a `long`) breaks on Windows.

---

## Capstone Projects

### Capstone A — A `safe_int` library

- [ ] Build a small library exposing `add/sub/mul/div/neg/abs` for `int32_t` and `int64_t`, each returning a success flag and an out-parameter, correctly handling every overflow case **including** `INT_MIN/-1` and `INT_MIN` negation/abs. Write a test suite that hits MAX, MIN, 0, −1, and the `INT_MIN` traps. Bonus: cross-check every result against `__builtin_*_overflow`.

### Capstone B — One overflow, six languages, one report

- [ ] Run an identical battery of operations (`MAX+1`, `MIN-1`, `0-1` unsigned, `MIN/-1`, `abs(MIN)`, narrowing `300→u8`) in C, Java, Go, Rust, Python, and JavaScript, and produce a single comparison matrix showing how each language responds (wrap / UB / panic / trap / no-overflow / precision-loss). This is the single best artifact for internalizing the cross-language model.

### Capstone C — Harden a vulnerable parser

- [ ] Take (or write) a tiny binary-format parser with a `count`-driven allocation and a trusted length field. Demonstrate the overflow-to-heap-overflow under ASan, then harden it: boundary validation, `calloc`/`ckd_mul`, width widening, and a fuzzing harness (libFuzzer/AFL++) under sanitizers. Show the fuzzer no longer finds a crash. Write up the before/after.

---

## Self-Assessment Checklist

After completing these tasks, you should be able to check every box:

- [ ] I can write the two's-complement representation of any small signed integer by hand and explain why `~x + 1` negates it.
- [ ] I can state the exact range of any n-bit signed and unsigned integer and explain the `INT_MIN` asymmetry.
- [ ] I can predict what `MAX + 1` does in C, Java, Go, Rust (debug & release), and Python — and explain *why* each differs.
- [ ] I can detect overflow correctly with a pre-check and explain why the signed post-check is UB in C.
- [ ] I can write a complete `safe_div` that handles both `b == 0` and `INT_MIN / −1`.
- [ ] I can explain why `−1 < 1u` is false and fix a signed/unsigned comparison.
- [ ] I can explain C integer promotion and why 8-bit arithmetic "wraps" only on the narrowing store.
- [ ] I can identify a `malloc(count * size)` vulnerability, exploit it under ASan, and fix it three ways.
- [ ] I can choose between wrapping, saturating, and checked arithmetic for a given domain and justify it.
- [ ] I can compute a counter's rollover horizon for a given width and rate, and pick a width for a multi-year system.

---

## Related Topics

- This folder: [`junior.md`](junior.md), [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`interview.md`](interview.md).
- Sibling numerics: [Floating-Point Representation](../02-floating-point-ieee-754/tasks.md).
- Security tooling: `../../../quality-engineering/dynamic-analysis-and-sanitizers/tasks.md` — UBSan/ASan/fuzzing practice.
