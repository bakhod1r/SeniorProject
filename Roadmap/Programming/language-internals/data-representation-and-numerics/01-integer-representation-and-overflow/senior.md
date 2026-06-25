# Integer Representation & Overflow — Senior Level

> **Topic:** [Integer Representation & Overflow](README.md)
> **Focus:** The internals and the cross-language design space — why two's complement won, the `INT_MIN` asymmetry and its traps, what "undefined behavior" actually licenses the optimizer to do, and how each language's memory/overflow model trades safety against speed.

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

> Focus: **At the senior level, "it overflows" is not an answer — the question is *what the specification permits the compiler to assume*, and *what the hardware actually does*.** Those two layers diverge most sharply in C/C++, where signed overflow is undefined behavior, and the gap between "what you wrote" and "what runs" is wide enough to hide both performance wins and security holes.

A senior engineer must hold three things in their head simultaneously:

1. **The hardware reality.** Essentially every CPU since the early 1970s uses two's complement, has a single adder that serves signed and unsigned, and exposes overflow/carry flags. Wraparound is *physically* what the silicon does. Understanding *why* two's complement won — one zero, identical add/subtract circuitry, free sign extension, monotonic modular arithmetic — explains why higher layers are shaped the way they are.

2. **The language specification.** What the *standard* says may differ from what the hardware does. C/C++ declare signed overflow *undefined* even though the chip would happily wrap. That declaration is not pedantry: it licenses the optimizer to assume `x + 1 > x`, to promote loop counters, to delete "impossible" branches. The same physical operation is "defined wrap" in Java/Go, "panic-or-wrap" in Rust, "impossible" in Python.

3. **The asymmetry and its consequences.** Two's complement has one more negative than positive value. `INT_MIN` has no positive twin. Therefore `−INT_MIN`, `abs(INT_MIN)`, and `INT_MIN / −1` are all broken — and the last one *traps* (SIGFPE) on x86, a fact most engineers never learn until production crashes.

This page is about those three layers and how they interact. The recurring theme: **the bug is rarely in the arithmetic you see; it's in the assumption — yours or the compiler's — about what the arithmetic is allowed to do.**

---

## Prerequisites

- **Required:** Junior and middle pages — representation, promotion, conversions, detection techniques.
- **Required:** Reading assembly comfortably enough to follow an x86-64 `add`/`idiv`/`movsx` snippet.
- **Helpful:** Familiarity with the notion of undefined behavior and compiler optimization passes.
- **Helpful:** Having debugged at least one "works at -O0, breaks at -O2" issue.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Two's complement** | Signed encoding where the value of an n-bit pattern is `−bₙ₋₁·2ⁿ⁻¹ + Σ bᵢ·2ⁱ`. |
| **Modular arithmetic (mod 2ⁿ)** | The ring unsigned arithmetic lives in; addition/multiplication wrap exactly mod 2ⁿ. |
| **Undefined behavior (UB)** | A program construct the standard imposes *no requirements* on; the compiler may assume it never happens. |
| **Implementation-defined** | Behavior the standard leaves to the implementation but requires it to *document* (e.g., `int` width). |
| **`INT_MIN`** | The most negative value of a signed type; `−2ⁿ⁻¹`. Has no positive counterpart. |
| **Overflow flag (OF)** | x86 status bit set when a *signed* operation overflows. |
| **Carry flag (CF)** | x86 status bit set when an *unsigned* operation produces a carry/borrow out. |
| **Sign extension** | Widening a signed value by replicating its sign bit (`movsx`/`cdqe`). |
| **Strength reduction** | Optimizer replacing a costly op with a cheaper one, sometimes assuming no overflow. |
| **`-ftrapv` / `-fwrapv`** | GCC/Clang flags: trap on signed overflow / define signed overflow to wrap (disable UB). |
| **UBSan** | UndefinedBehaviorSanitizer; instruments code to detect overflow/UB at runtime. |
| **Saturating** | Overflow clamps to MAX/MIN (hardware `paddsb`, Rust `saturating_*`). |
| **Wrapping** | Overflow defined as mod 2ⁿ (Rust `Wrapping<T>`, Java/Go default). |

---

## Core Concepts

### 1. The Algebra of Two's Complement

For an n-bit pattern with bits `bₙ₋₁ … b₀`, two's complement defines the value as:

```text
   value = −bₙ₋₁ · 2ⁿ⁻¹  +  Σ (i=0..n-2) bᵢ · 2ⁱ
```

Only the top bit's weight is negated. This single definition gives every desirable property:

- **One zero.** `0` has exactly one representation, `000…0`.
- **Negation is "flip all bits, add 1."** `−x = ~x + 1`. Provable from the definition; it's why hardware negation is trivial.
- **Signed and unsigned addition are bit-identical.** Add the patterns mod 2ⁿ; the result is correct under *both* interpretations. One adder, two readings.
- **Subtraction is addition of the negation.** `a − b = a + (~b + 1)`, again one adder.
- **Overflow is detectable from the sign bits.** Signed overflow occurred iff the two operands had the same sign and the result has the opposite sign — exactly the condition the x86 OF flag encodes.

Contrast the historical alternatives — **sign-magnitude** (two zeros, separate add/subtract logic) and **ones' complement** (two zeros, "end-around carry" needed for addition). Both were used in real machines (CDC, PDP-1) and both lost precisely because two's complement makes the hardware adder do double duty with no special cases. *This is the "why" behind the whole topic.*

### 2. The `INT_MIN` Asymmetry — and Why It Breaks Things

An n-bit signed type ranges over `[−2ⁿ⁻¹, 2ⁿ⁻¹ − 1]`. There are `2ⁿ⁻¹` negatives but only `2ⁿ⁻¹ − 1` positives, because zero consumes a non-negative slot. Consequence: **`INT_MIN` has no positive counterpart.** `−INT_MIN = INT_MAX + 1`, which overflows. This poisons several operations:

```c
int x = INT_MIN;            // -2147483648
int y = -x;                 // UB: -INT_MIN overflows (would be 2147483648)
int z = abs(x);             // UB / returns INT_MIN (negative!) — abs is broken here
int q = INT_MIN / -1;       // UB; on x86 it TRAPS (SIGFPE), same as div-by-zero
int r = INT_MIN % -1;       // same trap on many platforms
```

The `INT_MIN / −1` trap surprises everyone: division by −1 should be negation, but the negation overflows, and the x86 `idiv` instruction raises `#DE` (divide error) — the *same exception as divide-by-zero*. A robust signed-division guard must check **both** `b == 0` **and** `(a == INT_MIN && b == -1)`.

`abs(INT_MIN)` is undefined in C and returns `INT_MIN` (still negative) in Java's `Math.abs(int)`. Rust's `i32::MIN.abs()` panics in debug. The correct tool is `checked_abs`/`unsigned_abs` (Rust), `Math.absExact` (Java 15+), or manual handling.

### 3. What "Undefined Behavior" Actually Licenses

C/C++ make signed overflow UB. The practical meaning is not "it might wrap weirdly" — it's "**the optimizer may assume the program never overflows and rewrite code accordingly.**" Examples that bite seniors:

```c
// 1. The optimizer assumes x + 1 > x always:
for (int i = 0; i <= n; i++) { ... }   // may be assumed to terminate even if n == INT_MAX
                                       // (it would never terminate with wrapping)

// 2. Deletion of "redundant" overflow checks:
int f(int a) {
    if (a + 100 < a) return ERROR;     // looks like overflow detection
    return a + 100;                    // compiler: "a+100<a is impossible (UB),
}                                      //  so delete the check." Your guard vanishes.

// 3. Promoting int loop counters to 64-bit / vectorizing,
//    valid only if no wrap occurs.
```

The famous demonstrations (Chris Lattner's "What Every C Programmer Should Know About Undefined Behavior," and the Linux kernel's `-fno-strict-overflow` adoption) show that overflow checks written *after* the overflow are routinely optimized away. The senior takeaways:

- **Detect overflow before performing it** (pre-checks, builtins) — covered in `middle.md`, now you know *why* the post-check fails.
- **Know the escape hatches:** `-fwrapv` makes signed overflow defined-to-wrap (kills the UB and the optimizations that depend on it). `-ftrapv` makes it trap. `-fsanitize=signed-integer-overflow` makes it diagnosable. The Linux kernel compiles with `-fno-strict-overflow`.

### 4. Hardware: Flags, Sign Extension, and the Single Adder

At the ISA level, one `add` instruction serves both signednesses; the CPU sets **both** OF (signed overflow) and CF (unsigned carry) on every add, and *you* (or the compiler) read whichever is relevant. This is why Rust's `overflowing_add`, Go's `bits.Add64` carry-out, and `__builtin_add_overflow` are cheap — they compile to one `add` plus a conditional read of a flag, not a separate slow check.

Sign extension is likewise a single instruction (`movsx`, `cdqe` for eax→rax). When you widen a signed value, the hardware replicates the sign bit; when you widen unsigned, it zero-extends (`movzx`). A senior should be able to predict which the compiler emits from the source types.

### 5. The Cross-Language Overflow Model, Precisely

| Language | Signed overflow | Unsigned overflow | Width model | Escape / explicit ops |
|----------|-----------------|-------------------|-------------|------------------------|
| **C/C++** | **UB** | wraps (defined) | `int`≥16, impl-defined widths; `<stdint.h>` for fixed | `-fwrapv`, `-ftrapv`, `__builtin_*_overflow`, C23 `ckd_*` |
| **Rust** | panic (debug) / wrap (release) | same | fixed widths, `usize`/`isize` = pointer width | `checked_*`, `wrapping_*`, `saturating_*`, `overflowing_*`, `Wrapping<T>` |
| **Go** | wraps (defined) | wraps (defined) | fixed; `int`/`uint` = platform word | `math/bits` for carry; const overflow is a compile error |
| **Java** | wraps (defined) | n/a (no unsigned) | fixed (8/16/32/64); `int` always 32 | `Math.*Exact`, `Integer.*Unsigned`, `BigInteger` |
| **Python** | impossible (bignum) | impossible | arbitrary precision | n/a; NumPy reintroduces fixed widths that wrap |
| **JS** | n/a (f64) | n/a | `Number` = f64 (safe to 2⁵³); `BigInt` arbitrary | `BigInt`, `Math.imul`, `>>> 0` for uint32 |
| **Swift** | **traps** by default | traps | fixed | `&+`/`&-`/`&*` overflow operators, `addingReportingOverflow` |

Two observations a senior should internalize. First, **safety-by-default and speed-by-default are a deliberate dial**: Swift and Rust-debug trap (find bugs early), C wraps-or-UB and Rust-release wrap (speed), Java/Go define wrap (predictable but silent). Second, **the "defined wrap" languages still have bugs** — defined-but-wrong is a wrong answer; only the *checked* path is correct for arithmetic that must not silently lie.

### 6. Why Java Has No Unsigned Types (and How It Copes)

Java deliberately omitted unsigned integers (Gosling's stated reason: they confuse more than they help, given the conversion traps you saw in `middle.md`). The cost: bytes are signed (`byte` is `[−128,127]`), so reading raw bytes needs `b & 0xFF`. Java 8 added a *functional* unsigned layer — `Integer.toUnsignedLong`, `Integer.divideUnsigned`, `Integer.compareUnsigned`, `Long.parseUnsignedLong` — that operate on the same `int`/`long` bit patterns with unsigned semantics. The pattern is "signed storage, unsigned operations on demand," which is exactly how you should think about Java's `int` when it holds a hash, a color, or a raw byte run.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Two's complement single adder** | A cash register that handles both deposits and withdrawals with the same add mechanism — subtraction is just "add a negative." |
| **`INT_MIN` asymmetry** | A see-saw with one extra seat on the negative side; you can't mirror the most-negative person to the positive side — there's no seat there. |
| **`INT_MIN / −1` trap** | Asking "what's the opposite of the lowest possible floor?" in a building whose floors are numbered to a hard minimum — there's no such floor, and the elevator faults. |
| **Undefined behavior** | A contract clause that says "if you ever do X, all bets are off" — and the contractor (compiler) then *builds the house assuming you never will*, removing the railing you put up "in case." |
| **`-fwrapv`** | Adding back the railing by contract amendment: now overflow is defined, and your safety check survives. |
| **OF vs CF flags** | A dashboard with two warning lights — one for "signed limit exceeded," one for "unsigned limit exceeded" — both wired to the same engine. |
| **Sign extension** | Re-printing a negative temperature on a bigger sign: you must repaint the minus across the new space, not leave it blank. |

---

## Mental Models

### The "Two Layers" Model

Always separate **what the hardware does** from **what the standard permits**. The hardware *wraps* signed overflow. The C standard *forbids* it (UB). When you reason about a C program, reason at the standard's layer — the compiler does — because the optimizer's view is what actually runs. When you reason about Go/Java, the layers coincide (defined wrap). The senior error is reasoning about C as if it were Go: "it'll just wrap" — no, the compiler may have deleted your code.

### The "UB Is a Promise You Made" Model

Undefined behavior isn't the compiler being mean; it's the compiler taking you at your word. By the standard, *you promised* signed overflow never happens. The optimizer builds on that promise. So an overflow check placed *after* the overflow is self-contradictory: you both promised it can't happen and tried to detect it happening. The compiler resolves the contradiction by believing your promise and deleting the check. Detect *before*.

### The "Ring with a Seam" Model (refined)

Unsigned integers are a clean ring `ℤ/2ⁿℤ`; arithmetic is exact modular arithmetic with no exceptions — that's *defined and correct*, just possibly surprising. Signed integers are the *same ring* with a different labeling of the elements (the top half labeled negative), and the seam between `INT_MAX` and `INT_MIN` is where every signed-overflow trap, every UB, and every `INT_MIN` asymmetry lives. Know exactly where the seam is.

---

## Code Examples

### C — The `INT_MIN` traps, all of them

```c
#include <stdio.h>
#include <limits.h>
#include <stdlib.h>

int safe_negate(int x, int *out) {
    if (x == INT_MIN) return 0;   // -INT_MIN would overflow
    *out = -x; return 1;
}

int safe_div(int a, int b, int *out) {
    if (b == 0) return 0;
    if (a == INT_MIN && b == -1) return 0;  // would overflow AND traps on x86
    *out = a / b; return 1;
}

int main(void) {
    int o;
    printf("negate INT_MIN ok? %d\n", safe_negate(INT_MIN, &o)); // 0
    printf("INT_MIN / -1 ok?  %d\n", safe_div(INT_MIN, -1, &o)); // 0
    // Demonstrating abs is broken:
    printf("abs(INT_MIN) = %d\n", abs(INT_MIN));  // INT_MIN, still negative (UB)
    return 0;
}
```

### C — Watching the optimizer delete an overflow check

```c
// Compile twice: gcc -O0 and gcc -O2 -fstrict-overflow, observe the difference.
#include <stdio.h>
#include <limits.h>

__attribute__((noinline))
int check_then_add(int a) {
    if (a + 100 < a)          // "overflow check" — but a+100<a is UB-impossible
        return -1;            // at -O2, the optimizer may PROVE this never fires
    return a + 100;
}

int main(void) {
    printf("%d\n", check_then_add(INT_MAX)); // -O0: -1; -O2: may be INT_MAX+100 (UB)
    return 0;
}
```

The fix is to check before overflowing (`if (a > INT_MAX - 100) ...`) or compile with `-fwrapv` to make the wrap defined so the check is meaningful.

### Rust — The full overflow API, and why release ≠ debug

```rust
fn main() {
    let x = i32::MIN;

    // INT_MIN handling, the right way:
    println!("{:?}", x.checked_neg());      // None
    println!("{:?}", x.checked_abs());      // None
    println!("{}",   x.unsigned_abs());     // 2147483648 (returns u32, can't overflow)
    println!("{:?}", x.checked_div(-1));    // None

    // Semantics dial:
    println!("{}", 200u8.wrapping_add(100));    // 44
    println!("{}", 200u8.saturating_add(100));  // 255 (clamped)
    let (v, o) = 200u8.overflowing_add(100);
    println!("{} {}", v, o);                    // 44 true

    // Wrapping<T> makes wraparound the type's default (for hashing etc.):
    use std::num::Wrapping;
    let mut h = Wrapping(0u32);
    for &b in b"hash" { h = h * Wrapping(31) + Wrapping(b as u32); } // never panics
    println!("{}", h.0);
}
```

### Go — Defined wrap, plus carry-aware big arithmetic

```go
package main

import (
	"fmt"
	"math"
	"math/bits"
)

func main() {
	// Defined signed wrap:
	fmt.Println(int8(127) + 1) // -128

	// INT_MIN / -1 in Go does NOT trap — it's defined to overflow-wrap to MIN:
	fmt.Println(math.MinInt32 / -1) // -2147483648 (no SIGFPE; Go specifies it)

	// 128-bit-ish multiply via math/bits (no native int128):
	hi, lo := bits.Mul64(1<<40, 1<<40) // 2^80, split across two words
	fmt.Printf("hi=%d lo=%d\n", hi, lo)

	// Detecting unsigned add overflow:
	_, carry := bits.Add64(math.MaxUint64, 1, 0)
	fmt.Println("overflow:", carry == 1) // true
}
```

Note the genuinely useful contrast: Go *defines* `MinInt32 / -1` to wrap rather than trap — a deliberate spec choice to avoid the x86 SIGFPE surprise. C leaves it UB; Go nails it down.

### Java — No unsigned, but unsigned-on-demand

```java
public class Unsigned {
    public static void main(String[] args) {
        int x = -1;                                  // bits 0xFFFFFFFF
        System.out.println(Integer.toUnsignedLong(x));   // 4294967295
        System.out.println(Integer.divideUnsigned(-2, 3));// large unsigned quotient
        System.out.println(Integer.compareUnsigned(-1, 1) > 0); // true (huge > 1)

        // INT_MIN trap, Java edition:
        System.out.println(Math.abs(Integer.MIN_VALUE)); // MIN_VALUE (still negative!)
        try {
            Math.absExact(Integer.MIN_VALUE);            // Java 15+: throws
        } catch (ArithmeticException e) {
            System.out.println("absExact threw: " + e.getMessage());
        }
    }
}
```

---

## Pros & Cons

| Design choice | Pros | Cons |
|---------------|------|------|
| **Signed overflow = UB (C/C++)** | Enables loop/vectorization/strength-reduction optimizations; small, fast code. | Silently deletes overflow checks; security-critical bugs; non-portable surprises. |
| **Defined wrap (Java/Go)** | Portable, no UB, predictable; correct for hashing/modular code. | Silent wrong answers when wrap wasn't intended. |
| **Trap by default (Swift, Rust-debug)** | Bugs surface at the exact point of overflow; safest. | Runtime cost; release builds disable it (Rust), so prod safety needs explicit checked ops. |
| **Arbitrary precision (Python, Java BigInteger)** | Never overflows; correctness by construction. | Slow, allocates, unpredictable performance; no constant-time guarantees (crypto risk). |
| **Two's complement (universal)** | One zero, one adder, free negation/sign-extension, hardware overflow flags. | The `INT_MIN` asymmetry and its trap family. |
| **Unsigned types** | Correct modular semantics, full positive range, right for sizes/masks. | Underflow-to-huge, signed/unsigned comparison traps, no `INT_MIN`-style asymmetry but `0-1`=MAX. |

---

## Use Cases

- **Systems / kernel code:** compile with `-fno-strict-overflow`/`-fwrapv` and audit every size calculation; the kernel does exactly this after years of UB-driven CVEs.
- **Cryptography:** use constant-time fixed-width arithmetic; *avoid* bignums on the hot path (their timing leaks key bits) and *avoid* branches on secret-dependent overflow.
- **Numeric/DSP code:** use saturating arithmetic (hardware `padds*`, Rust `saturating_*`) so signal peaks clip rather than wrap into noise.
- **Hashing / checksums / PRNGs:** use wrapping arithmetic deliberately (`Wrapping<T>`, Go/Java natural wrap) — overflow is the algorithm.
- **Financial / safety systems:** checked arithmetic everywhere; an overflow is an error to surface, never to swallow. Or fixed-point with explicit overflow handling.

---

## Coding Patterns

### Pattern 1: The complete signed-division guard

```c
bool safe_div(int32_t a, int32_t b, int32_t *out) {
    if (b == 0) return false;
    if (a == INT32_MIN && b == -1) return false;  // overflow + SIGFPE on x86
    *out = a / b;
    return true;
}
```

### Pattern 2: `unsigned_abs` to dodge the `INT_MIN` trap

```rust
// abs() can overflow; unsigned_abs() returns the unsigned magnitude, which always fits:
let magnitude: u32 = value.unsigned_abs();   // i32::MIN -> 2147483648, no panic
```

### Pattern 3: Make wraparound a type, not a per-call decision

```rust
use std::num::Wrapping;
type Hash = Wrapping<u64>;   // every + and * on Hash is modular by construction
```

### Pattern 4: Compile-flag the UB away in legacy C

```bash
# Make signed overflow defined-to-wrap across a legacy codebase you can't fully audit:
gcc -fwrapv ...
# Or find the bugs first:
gcc -fsanitize=signed-integer-overflow -fsanitize=unsigned-integer-overflow ...
```

### Pattern 5: Read the flag instead of recomputing

```c
// One add + one flag read, vs a separate comparison the optimizer might break:
int32_t r;
if (__builtin_add_overflow(a, b, &r)) handle_overflow();   // compiles to add+jo
```

---

## Clean Code

- **Encode overflow policy in the type.** `Wrapping<T>`, a `Saturating<T>` newtype, or a `Checked<T>` wrapper communicates intent better than scattered `wrapping_add` calls.
- **Centralize the `INT_MIN`/div guards.** A single audited `safe_div`/`safe_neg`/`safe_abs` beats re-deriving the asymmetry at every call site.
- **State the compilation contract.** If a module relies on `-fwrapv`, document it at the top — building it without that flag silently changes semantics.
- **Prefer `unsigned_abs`/`checked_abs` over `abs`** in any code that could see `INT_MIN`.
- **Name the width and signedness in the type, not in a comment.** `u32`/`int64_t`/`size_t` carry the contract; a bare `int` hides it.

---

## Best Practices

- **In C/C++, never rely on signed wrap; never post-check signed overflow.** Use pre-checks, builtins, or C23 `ckd_*`. Compile tests under UBSan.
- **Guard signed division for both `b==0` and `INT_MIN/-1`.** The second is as real as the first and traps identically on x86.
- **Choose the overflow semantics explicitly** (checked/wrapping/saturating) — defaulting is how silent bugs ship.
- **For the widest type, use hardware-assisted detection** (`__builtin_mul_overflow`, `unsigned __int128`, `math/bits.Mul64`) since you can't "compute in a wider standard type."
- **Keep crypto off bignums on hot paths** and off secret-dependent branches; fixed-width constant-time is the requirement.
- **When porting C from x86 to ARM/RISC-V, audit overflow assumptions** — wrap behavior that "worked" under x86 incidentals is not guaranteed, and UB is UB everywhere.

---

## Edge Cases & Pitfalls

- **`INT_MIN / −1` traps (SIGFPE) on x86**, identically to divide-by-zero. Guarding only `b == 0` is incomplete.
- **`abs(INT_MIN)` returns a negative number** (Java) or is UB (C). `unsigned_abs`/`absExact` are the fixes.
- **`-x` is UB for `x == INT_MIN`** in C; `negate` needs a guard.
- **`1 << 31` on a signed 32-bit `int` is UB** (shifting into the sign bit). Use `1u << 31` or a wider type.
- **`-fwrapv` changes program meaning**, not just suppresses warnings — code that depended on UB-driven optimizations (e.g., assumed loop termination) can change behavior.
- **`%` sign follows the dividend in C/Java/Go/Rust but the divisor in Python.** `-7 % 3` is `-1` in C, `2` in Python. Modular index math differs.
- **Bignum timing leaks.** A "just use BigInteger" fix in crypto introduces a side channel; the running time depends on operand magnitude.
- **`int` vs `long` width across ABIs** (LP64 vs LLP64) silently changes ranges; `<stdint.h>` is mandatory for portable width.

---

## Common Mistakes

1. **Reasoning about C signed overflow as "it wraps."** It's UB; the compiler may do anything, including deleting your check.
2. **Post-checking signed overflow** (`r < a`) — self-contradictory under UB; valid only for unsigned.
3. **Guarding division for zero but not `INT_MIN/-1`.** A real crash in production.
4. **Calling `abs`/`-x` on a value that can be `INT_MIN`.** Returns wrong sign or is UB.
5. **Shifting into the sign bit of a signed type.** `1 << 31` UB; use unsigned literals.
6. **Assuming Go/Java wrap means it's *correct*.** Defined ≠ intended; use `*Exact`/`checked_*` when the answer must be right.
7. **Switching on `-O2` and "fixing" a behavior change with a sleep/volatile** instead of finding the UB. Use UBSan.
8. **Using bignums in constant-time code.** Reintroduces timing side channels.

---

## Tricky Points

- **The same expression is defined in Go and undefined in C.** `MinInt32 / -1` wraps in Go (spec'd), traps/UB in C. Portability of "what overflow does" is a per-language promise, not a hardware fact.
- **UBSan and `-fwrapv` are different tools.** UBSan *detects* (aborts/reports), `-fwrapv` *defines* (wraps, no report). Don't ship `-fwrapv` thinking you've found the bugs; you've only hidden the UB.
- **OF and CF are both always set by `add`.** Whether overflow "happened" depends on which interpretation you query — there's no single "did it overflow" without a signedness.
- **Saturating arithmetic isn't free in software** unless the ISA has it (SSE/NEON `padds`); a scalar `saturating_add` compiles to a compare + cmov.
- **Two's complement's negation `~x + 1` itself overflows at `INT_MIN`** — the asymmetry is baked into the algebra, not bolted on.
- **`size_t` is unsigned by deliberate design**, so loop-down-to-zero with `size_t` is an underflow trap; this is not an accident but a frequent foot-gun.

---

## Test Yourself

1. Prove from the two's-complement value formula that `−x = ~x + 1`, and show where the proof breaks for `x = INT_MIN`.
2. Write the complete `safe_div` for `int32_t` and explain *both* failure cases, including which one raises SIGFPE on x86 and why.
3. Compile `if (a + 100 < a) return -1;` at `-O0` and `-O2 -fstrict-overflow`. Explain what the optimizer does and why, then show two fixes.
4. Why does `abs(INT_MIN)` return `INT_MIN` in Java? Trace it through the two's-complement representation. What's the correct API?
5. Explain the difference between `-ftrapv`, `-fwrapv`, and `-fsanitize=signed-integer-overflow`. When would you ship each?
6. Show why `1 << 31` is UB for `int` but defined for `unsigned`, in terms of the sign bit and the standard's rule on shifting.
7. Why does Go define `MinInt32 / -1` while C leaves it undefined? What surprise does Go's choice prevent?
8. Demonstrate (conceptually) how using `BigInteger` to "fix" a modular-exponentiation overflow can leak timing information about the operands.

---

## Tricky Questions

**Q1: If the hardware wraps signed overflow, why does C call it undefined?**

Because the *standard* (not the hardware) defines the abstract machine, and leaving signed overflow undefined lets the optimizer assume `a + 1 > a`, that loops with `int` counters terminate, and that arithmetic identities hold — enabling vectorization, strength reduction, and loop transformations. The hardware would wrap, but the compiler is allowed to generate code that *doesn't reach* the wrapping case because it assumed it impossible. The dial between speed (UB) and safety (defined/trap) is exactly this assumption.

**Q2: Why is `INT_MIN / −1` a hardware trap and not just a wrong number?**

The true quotient is `INT_MAX + 1`, which doesn't fit in the result register. x86's `idiv` raises `#DE` (divide error) when the quotient overflows the destination — the same vector as divide-by-zero. So the CPU *faults* rather than silently truncating. Go sidesteps this by specifying the result (wrap to `INT_MIN`); C leaves it UB; a correct C guard must special-case it.

**Q3: Is two's complement guaranteed by the C standard?**

It is now. C23 *mandates* two's complement for signed integers (removing the historical allowance for sign-magnitude and ones' complement, which no real platform used). Before C23 it was implementation-defined, though every mainstream implementation used two's complement. Note: even in C23, signed *overflow* remains UB — two's-complement representation does not imply defined overflow.

**Q4: Does `-fwrapv` make my C program safe?**

Safer, not safe. It removes the UB (signed overflow becomes defined wrap, like Java), so the optimizer can no longer delete your overflow checks, and `INT_MIN/-1`-style reasoning is well-defined. But you can still produce *wrong answers* via silent wrap — `-fwrapv` defines the behavior, it doesn't detect or prevent logical overflow. For detection you still want pre-checks/builtins or UBSan.

**Q5: Why did Java omit unsigned integers, and how do you read a raw byte?**

The designers judged that unsigned types cause more confusion than they solve, largely because of the signed/unsigned conversion traps (the `-1 < 1u` family). The cost is that `byte` is signed; to get the unsigned value of a raw byte you write `b & 0xFF` (which promotes to `int` and masks the sign extension). Java 8's `Integer/Long.*Unsigned` methods give unsigned *operations* over signed storage when you need them.

**Q6: When is wrapping arithmetic the *correct* implementation, not a bug?**

When the algorithm is defined over `ℤ/2ⁿℤ`: hashing (`h = h*31 + c`), CRC/checksums, linear-congruential and xorshift PRNGs, ring-buffer index advance, and sequence numbers (TCP). For these, `Wrapping<T>`/`wrapping_*` or Java/Go's natural wrap is exactly right, and a *checked* version would be wrong (it would reject valid inputs). The skill is signaling that the wrap is intentional.

**Q7: How do you detect 64-bit multiplication overflow with no 128-bit type?**

Three portable-ish routes: `__builtin_mul_overflow` (GCC/Clang, one `mul` + flag read); the high/low split (`unsigned __int128`, `_umul128` on MSVC, `math/bits.Mul64` in Go) and check the high word is zero; or the division pre-check `a != 0 && b > MAX/a`. C23 adds `ckd_mul` as the standard answer.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│             INTERNALS, INT_MIN TRAPS & UB SEMANTICS             │
├──────────────────────────────────────────────────────────────────┤
│ Two's complement value:  -b[n-1]·2^(n-1) + Σ b[i]·2^i           │
│   one zero · one adder for signed+unsigned · -x = ~x + 1         │
│   signed overflow iff: operands same sign, result opposite sign  │
├──────────────────────────────────────────────────────────────────┤
│ THE INT_MIN ASYMMETRY (one more negative than positive):         │
│   -INT_MIN       → overflow (== INT_MAX + 1)                     │
│   abs(INT_MIN)   → INT_MIN (still negative) / UB                 │
│   INT_MIN / -1   → UB in C; TRAPS (SIGFPE) on x86; wraps in Go   │
│   guard division for BOTH b==0 AND (a==MIN && b==-1)             │
├──────────────────────────────────────────────────────────────────┤
│ UB LICENSES THE OPTIMIZER to assume overflow never happens:      │
│   - assumes a+1 > a, loops terminate, deletes post-checks        │
│   - so DETECT BEFORE, never after, for signed                    │
│ Flags: -fwrapv (define wrap) · -ftrapv (trap) · UBSan (detect)   │
├──────────────────────────────────────────────────────────────────┤
│ HARDWARE: one `add` sets OF (signed) AND CF (unsigned)           │
│   movsx = sign-extend · movzx = zero-extend                     │
│   checked ops = add + read-flag (cheap)                         │
├──────────────────────────────────────────────────────────────────┤
│ CROSS-LANGUAGE signed overflow:                                  │
│   C/C++ UB · Rust panic(dbg)/wrap(rel) · Go wrap · Java wrap     │
│   Swift TRAP · Python impossible · JS f64 precision-loss         │
│ C23: two's complement MANDATED; overflow STILL UB; ckd_* added   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Two's complement won on **hardware merit**: one zero, a single adder serving both signednesses, trivial negation (`~x + 1`), free sign extension, and overflow detectable from sign bits. C23 finally *mandates* it.
- The representation is **asymmetric** — one extra negative — so `−INT_MIN`, `abs(INT_MIN)`, and `INT_MIN / −1` are all broken; the division case **traps (SIGFPE) on x86**, so a correct guard checks both `b==0` and `INT_MIN/-1`.
- **Undefined behavior is a promise, not a wrap.** C/C++ signed overflow being UB *licenses the optimizer* to assume it never happens — which silently deletes overflow checks written after the fact. Detect *before*.
- The escape hatches differ in kind: **`-fwrapv` defines** (wrap), **`-ftrapv` traps**, **UBSan detects**. Defining is not detecting.
- The cross-language model is a deliberate **safety↔speed dial**: C/Rust-release wrap-or-UB (speed), Java/Go define wrap (predictable, still silent), Swift/Rust-debug trap (safe-by-default), Python uses bignums (never overflows, but slow and timing-leaky).
- Hardware exposes **OF and CF** on every add, which is why checked/overflowing/carry APIs are cheap — one instruction plus a flag read.
- Senior judgment: reason at the **standard's layer** for C, guard the **`INT_MIN` family**, pick overflow **semantics explicitly**, and keep **bignums off constant-time paths**.

---

## What You Can Build

- **An `INT_MIN`-safe arithmetic kit** (`safe_neg`, `safe_abs`, `safe_div`, `safe_mul`) for `int32_t`/`int64_t`, with a test suite hitting every boundary and the SIGFPE case.
- **A UB-demonstration harness**: the same overflow-check function compiled at `-O0`, `-O2`, `-O2 -fwrapv`, and under UBSan, side-by-side, showing the optimizer deleting the check.
- **A typed overflow-policy library** in Rust: `Checked<T>`, `Saturating<T>`, `Wrapping<T>` newtypes with operator overloads and clear panics/results.
- **A cross-language overflow table generator**: run identical max/min/`INT_MIN` operations in C, Go, Java, Rust, Python and emit the comparison matrix.
- **A flag-reading micro-benchmark**: compare `__builtin_add_overflow` (add+jo) against a manual pre-check and a wider-type check at the instruction level.
- **A constant-time vs bignum timing demo** for modular exponentiation, showing the side channel bignums introduce.

---

## Further Reading

- *Hacker's Delight* — Henry S. Warren. The definitive bit-and-overflow algebra (negation, overflow detection, saturating ops).
- "What Every C Programmer Should Know About Undefined Behavior" — Chris Lattner (LLVM blog), 3 parts. Why UB lets the optimizer rewrite your code.
- *Computer Systems: A Programmer's Perspective* (Bryant & O'Hallaron), Ch. 2.2–2.4 — two's complement, overflow, and the asymmetry proven.
- CERT C: INT32-C (signed overflow is UB), INT33-C (division/remainder traps, the `INT_MIN/-1` case).
- *Secure Coding in C and C++* — Robert Seacord. Overflow as a vulnerability class.
- C23 standard / WG14 papers on mandating two's complement (N2412) and `<stdckdint.h>`.
- The Linux kernel's adoption of `-fno-strict-overflow` (LWN articles) — UB in production at scale.
- Intel SDM Vol. 2 — `IDIV`/`#DE` semantics (the `INT_MIN/-1` trap at the ISA level).

---

## Related Topics

- This folder: [`junior.md`](junior.md), [`middle.md`](middle.md), [`professional.md`](professional.md) (CVEs & war stories), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling numerics:
  - [Floating-Point Representation](../02-floating-point-ieee-754/senior.md) — the *other* asymmetry (signed zero, NaN, denormals).
- Hardware: `../../cpu-architecture/01-alu/senior.md` — OF/CF flags, `idiv` `#DE`, sign-extension instructions.
- Compiler internals: `../../../code-craft/../compilers/optimization/senior.md` — how UB drives transformations.
