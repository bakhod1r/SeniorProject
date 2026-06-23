# UndefinedBehaviorSanitizer (UBSan) — Middle Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → UndefinedBehaviorSanitizer (UBSan)
> *The junior page said "UB is bad and UBSan finds it." This page formalizes what "it" is: UBSan is not one tool but a suite of two-dozen granular checks, each with its own flag, three failure modes, and a cost model — and it explains why undefined behavior doesn't make your program "behave differently," it makes your safety checks silently vanish.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why UB Is Not "Works Differently" but "Your Check Vanished"](#core-concept-1--why-ub-is-not-works-differently-but-your-check-vanished)
5. [Core Concept 2 — UBSan Is a Suite of Granular Checks](#core-concept-2--ubsan-is-a-suite-of-granular-checks)
6. [Core Concept 3 — The Three Modes: Recover, Abort, Trap](#core-concept-3--the-three-modes-recover-abort-trap)
7. [Core Concept 4 — Cost, Composition, and What to Combine](#core-concept-4--cost-composition-and-what-to-combine)
8. [Core Concept 5 — UBSan in CI](#core-concept-5--ubsan-in-ci)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What exactly does UBSan check, how do I control its behavior, and how do I wire it into CI?**

At the junior level, UndefinedBehaviorSanitizer is a switch you flip — `-fsanitize=undefined` — that prints `runtime error:` when your program does something the C or C++ standard leaves undefined. That model is correct but coarse. It can't yet explain *why* a null check you clearly wrote got deleted by the optimizer, *why* you'd ever want UBSan to **not** print a message, or *why* a hardened production kernel ships a subset of these very checks despite the cost.

The answers come from three refinements. First, **UB is a license the optimizer takes**: the compiler is allowed to assume UB never happens, so it deletes the code paths that would only execute *if* UB occurred — including your guards. Second, **UBSan is a suite**, not a monolith: `-fsanitize=undefined` is shorthand for roughly twenty independent checks, each enableable on its own. Third, **UBSan has three failure modes** — recover, abort, and trap — and choosing among them is what lets the same instrumentation serve both a developer's noisy debug build and a hardened production binary. This page makes all three concrete with real flags, real diagnostic output, and a CI variant you can paste.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can give two or three examples of undefined behavior (signed overflow, null deref, out-of-bounds).
- **Required:** You can compile with `clang` or `gcc` and pass `-fsanitize=...` flags.
- **Required:** You've seen at least one ASan or UBSan report and know it prints a file/line.
- **Helpful:** A rough sense of how an optimizer transforms code (constant folding, dead-code elimination).
- **Helpful:** You've configured a CI job (GitHub Actions, GitLab CI) before.

---

## Glossary

| Term | Meaning |
|---|---|
| **Undefined behavior (UB)** | A program construct the language standard places **no** requirements on. The compiler may assume it never occurs. |
| **Check family** | One specific UBSan detector (e.g. `signed-integer-overflow`), toggled by its own `-fsanitize=` flag. |
| **`-fsanitize=undefined`** | The umbrella group enabling the standard set of UB checks at once. |
| **Recover** | Default mode: print a diagnostic and **continue** executing. |
| **Abort** | Print a diagnostic, then **terminate** the process (`-fno-sanitize-recover`). |
| **Trap** | Emit a tiny illegal-instruction (`ud2`) on violation — **no diagnostic, no runtime library** (`-fsanitize-trap`). |
| **Runtime** | The `libubsan` support library linked in for recover/abort modes that formats and prints reports. |
| **Suppression** | A rule (env var or attribute) telling UBSan to ignore a specific check or location. |

---

## Core Concept 1 — Why UB Is Not "Works Differently" but "Your Check Vanished"

The single most important thing to internalize about UB is the **optimizer's** view of it. The standard says UB has *no* defined behavior; the compiler reads that as a *promise from you* that the UB never happens — and then optimizes on that promise.

Consider the canonical null-check deletion:

```c
int read(int *p) {
    int x = *p;          // dereference: if p were NULL this is UB
    if (p == NULL)       // ...so the compiler concludes p is NOT NULL here
        return -1;       // ...so THIS branch is dead and gets deleted
    return x;
}
```

The compiler reasons: line 2 dereferenced `p`. If `p` were null, that's UB, which "can't happen." Therefore on line 3, `p` is provably non-null, so the `if` is always false, so the `return -1;` is **dead code** and is removed. Your null check is *gone* — not because the compiler is malicious, but because you already promised (by dereferencing) that it couldn't trigger.

Signed overflow is the same trap in arithmetic form:

```c
int grows(int x) {
    return x + 1 > x;    // folds to `return 1;` — ALWAYS true
}
```

Signed overflow is UB, so the compiler assumes `x + 1` never overflows, so `x + 1 > x` is always true, so the whole function becomes `return 1;`. Pass `INT_MAX` and the "obvious" answer (`false`, because `INT_MAX + 1` wraps negative) never happens — the comparison was optimized to a constant *before* the wrap could occur.

> **Key insight:** UB doesn't make your program *do the wrong thing at the point of UB*. It makes the compiler delete or rewrite code *elsewhere* based on the assumption that the UB is impossible. This is why "but I tested it and it worked" is meaningless for UB: it worked at `-O0`, and the optimizer dismantled your assumptions at `-O2`. UBSan's whole purpose is to make the violated assumption **visible at runtime** instead of letting it silently reshape your binary.

This is also why UBSan must *instrument* the code rather than just analyze it: the violations are data-dependent (does *this* input overflow?) and only knowable at runtime.

---

## Core Concept 2 — UBSan Is a Suite of Granular Checks

`-fsanitize=undefined` is not a single detector. It's a **group flag** that turns on roughly twenty independent checks, each of which you can enable or disable by name. Knowing the names is what lets you build a targeted production subset or silence one noisy check without losing the rest.

The major check families:

| Flag | Catches |
|---|---|
| `signed-integer-overflow` | `a + b`, `a * b`, etc. overflowing a signed type (UB) |
| `unsigned-integer-overflow` | Unsigned wraparound — **not UB**, but often a bug; opt-in only |
| `integer-divide-by-zero` | `a / 0`, `a % 0` |
| `shift` / `shift-base` / `shift-exponent` | Shift by ≥ bit-width or negative; shifting a negative value |
| `null` | Dereferencing or member-accessing a null pointer |
| `nonnull-attribute` / `returns-nonnull-attribute` | Passing/returning null where `__attribute__((nonnull))` promised otherwise |
| `alignment` | Accessing an object through a misaligned pointer |
| `bounds` / `array-bounds` | Indexing past a fixed-size array whose size is statically known |
| `pointer-overflow` | Pointer arithmetic that overflows or wraps |
| `object-size` | Access provably past the end of an object (uses `__builtin_object_size`) |
| `vptr` | Bad C++ vtable / type confusion (a downcast to the wrong dynamic type) |
| `enum` | Loading an `enum` value outside its declared range |
| `bool` | Loading a `bool` that isn't `0` or `1` |
| `float-cast-overflow` | A float→integer cast whose value doesn't fit |
| `float-divide-by-zero` | Floating `x / 0.0` (UB in C; opt-in) |
| `return` | Falling off the end of a value-returning function without `return` |
| `unreachable` | Reaching `__builtin_unreachable()` |
| `vla-bound` | A variable-length array with a non-positive size |
| `function` | An indirect call through a pointer of the wrong function type (C++) |

Enable everything, or compose a subset:

```bash
# The whole standard suite:
clang -fsanitize=undefined -g app.c -o app

# A targeted subset (comma-separated, no spaces):
clang -fsanitize=signed-integer-overflow,bounds,null -g app.c -o app

# Add an opt-in check and subtract a noisy one:
clang -fsanitize=undefined,unsigned-integer-overflow -fno-sanitize=alignment -g app.c -o app
```

Two families come with strings attached, and they're worth memorizing:

- **`vptr` needs RTTI.** It reads the C++ runtime type info to verify a pointer's dynamic type, so it **cannot** be combined with `-fno-rtti`. If your build disables RTTI for code size, `vptr` is off the table for that translation unit.
- **`unsigned-integer-overflow` and `float-divide-by-zero` are not UB** by the standard (unsigned arithmetic is defined to wrap; the float case is implementation-defined or produces infinity). They're *opt-in* because they're frequently *bugs* even when defined — but expect false positives anywhere you intentionally rely on wraparound (hashing, checksums, ring buffers). They are **not** in the `undefined` group; you add them by name.

> **Key insight:** "Turn on UBSan" is too vague to be a real decision. The real decision is *which checks*, and the answer differs by build: a debug build wants `-fsanitize=undefined` (everything that's actually UB); a fuzzing build adds `unsigned-integer-overflow` to catch wraps too; a hardened production build wants a tiny subset like `bounds,object-size` in trap mode. The granularity is the feature.

---

## Core Concept 3 — The Three Modes: Recover, Abort, Trap

A UBSan check, once it fires, can respond in one of three ways. Picking the right one per build is the difference between a useful debug session, a clean CI signal, and a shippable hardened binary.

**Mode 1 — Recover (the default).** Print `runtime error:` with file, line, and details, then **keep running**. One violation per location is reported by default (so a hot loop doesn't flood you).

```bash
clang -fsanitize=undefined -g app.c -o app   # recover is default
./app
# app.c:7:14: runtime error: signed integer overflow: 2147483647 + 1 ...
# (program continues)
```

Recover is great for *exploration*: you see every distinct violation in one run. It's wrong for CI, because the process exits `0` despite reporting errors — your pipeline goes green on broken code.

**Mode 2 — Abort.** Print the diagnostic *and then terminate*. This is the CI/fuzzing default you want, because a violation becomes a non-zero exit the harness can detect.

```bash
clang -fsanitize=undefined -fno-sanitize-recover=undefined -g app.c -o app
./app
# app.c:7:14: runtime error: signed integer overflow ...
# (process aborts, non-zero exit)
```

The flag is `-fno-sanitize-recover=<group-or-check>`: "do **not** recover from these checks." You can scope it (`-fno-sanitize-recover=signed-integer-overflow`) or apply it to the whole group (`-fno-sanitize-recover=undefined`). Equivalently `ABORT_ON_ERROR` can be set via the `UBSAN_OPTIONS=halt_on_error=1` env var at runtime.

**Mode 3 — Trap.** On violation, emit a single illegal instruction (`ud2` on x86, `brk` on ARM) — **no message, no `libubsan` linked in**. The program just crashes with `SIGILL` at the offending instruction.

```bash
clang -fsanitize=undefined -fsanitize-trap=undefined -g app.c -o app
./app
# (no diagnostic — process dies with SIGILL; use a debugger to find the spot)
```

Trap mode is radically cheaper: each check compiles to a compare-and-`ud2` with no call into a runtime library and no string formatting. That cheapness is exactly why **hardened production builds** can afford to ship a *subset* of UBSan permanently. The Linux kernel's `CONFIG_UBSAN`, and the spirit behind fortified builds (`-D_FORTIFY_SOURCE`), rest on the same idea: instrument the dangerous operations (bounds, object-size) in trap mode so an exploit attempt becomes a clean crash rather than a memory-corruption foothold. (Older compilers spell this `-fsanitize-undefined-trap-on-error`; modern Clang/GCC use `-fsanitize-trap=undefined`.)

| Mode | Flag | On violation | Runtime lib? | Use |
|---|---|---|---|---|
| **Recover** | (default) | print, **continue** | yes | Local exploration — see all violations |
| **Abort** | `-fno-sanitize-recover=undefined` | print, **terminate** | yes | CI, fuzzing — turn violations into exit codes |
| **Trap** | `-fsanitize-trap=undefined` | `ud2`, **crash** | **no** | Hardened production subsets — tiny code, no diagnostic |

> **Key insight:** Recover, abort, and trap are the same *detection* with three different *reactions*. That separation is what lets one instrumentation technology serve developers (verbose recover), CI (loud abort), and production (silent trap) — you tune the reaction to the audience, not the check.

---

## Core Concept 4 — Cost, Composition, and What to Combine

UBSan is cheap relative to its peers, and it composes with almost everything — which is why it's rarely used alone.

**Cost.** UBSan's overhead is typically a few percent up to ~20%, depending on which checks are on and how arithmetic-heavy the code is. There is essentially **no memory overhead** — unlike AddressSanitizer, UBSan doesn't shadow memory; it just inserts comparisons before risky operations. For contrast:

| Tool | Time overhead | Memory overhead |
|---|---|---|
| **UBSan** (recover/abort) | ~few %–20% | negligible |
| **UBSan** (trap subset) | ~0–few % | negligible |
| **ASan** | ~2× (100%) | ~2–3× |
| **TSan** | ~5–15× | ~5–10× |

That low cost is the second reason hardened production builds can keep a trap-mode subset on permanently.

**Composition.** UBSan layers cleanly on top of other sanitizers. The standard pairing is **ASan + UBSan**: ASan catches spatial/temporal *memory* errors (use-after-free, heap overflow), UBSan catches *language-level* UB (overflow, bad casts, null). They cover disjoint bug classes, so together they catch far more in one run:

```bash
clang -fsanitize=address,undefined -fno-sanitize-recover=undefined -g app.c -o app
```

The one combination you **cannot** make is **ASan + TSan** (or MSan + TSan) — their shadow-memory schemes conflict. UBSan, having no shadow memory, sidesteps that: it combines with ASan *and* with TSan *and* with MSan. The practical rule: pick one *memory* sanitizer (ASan, TSan, or MSan) and add UBSan to it.

> **Key insight:** UBSan is the cheap, composable sanitizer with no memory cost, which is why it's almost always paired rather than run solo. "ASan + UBSan" is the default debug/CI build for C and C++ codebases: one is your memory-safety net, the other your language-rules net, and together they cost about what ASan costs alone.

---

## Core Concept 5 — UBSan in CI

A UBSan build belongs in CI as a dedicated **build variant**: compile the whole project (and tests) with sanitizers in **abort** mode, run the test suite, and **fail the job on any runtime error**. The two non-negotiables are abort mode (so violations become non-zero exits) and a clean way to surface and suppress the rare intentional case.

A minimal GitHub Actions job:

```yaml
ubsan:
  runs-on: ubuntu-latest
  env:
    CC: clang
    CXX: clang++
    CFLAGS:   "-fsanitize=address,undefined -fno-sanitize-recover=all -g -O1"
    CXXFLAGS: "-fsanitize=address,undefined -fno-sanitize-recover=all -g -O1"
    UBSAN_OPTIONS: "print_stacktrace=1:halt_on_error=1"
    ASAN_OPTIONS: "abort_on_error=1"
  steps:
    - uses: actions/checkout@v4
    - run: cmake -B build -DCMAKE_BUILD_TYPE=Debug
    - run: cmake --build build
    - run: ctest --test-dir build --output-on-failure
```

The pieces that matter:

- `-fno-sanitize-recover=all` makes *every* fired check abort, so a violation fails the test that triggered it. (`=all` also covers the ASan side.)
- `UBSAN_OPTIONS=print_stacktrace=1` gives you a symbolized stack on each report — invaluable for diagnosing which call site overflowed. (Requires `llvm-symbolizer` on `PATH`.) `halt_on_error=1` is belt-and-suspenders alongside the compile flag.
- Building at `-O1` (not `-O0`) keeps it fast *and* exercises the optimizer's UB assumptions, so the checks see roughly the code production runs.

**Suppressing the rare intentional case.** Sometimes a single function legitimately relies on behavior UBSan flags (a hashing routine that wants unsigned wrap, a low-level cast). Two tools:

1. **Source-level opt-out** — exclude one function from instrumentation:

   ```c
   __attribute__((no_sanitize("undefined")))
   uint64_t mix(uint64_t h, uint64_t x) {
       return (h ^ x) * 0x9E3779B97F4A7C15ull;   // intentional unsigned math
   }
   // or scope it: no_sanitize("signed-integer-overflow")
   ```

2. **A suppressions file** — for third-party code you can't annotate, list functions/files to ignore and point UBSan at it:

   ```
   # ubsan_suppressions.txt
   signed-integer-overflow:third_party/legacy_math.c
   alignment:packed_struct_reader
   ```
   ```bash
   UBSAN_OPTIONS=suppressions=ubsan_suppressions.txt ./app
   ```

> **Key insight:** A UBSan CI job is only useful if it's **loud and binary**: abort mode turns every violation into a failed test, and a stack trace turns "test 14 failed" into "line 88 overflowed." Suppress *narrowly* — `no_sanitize` on the one function or a single suppressions line — never by deleting a whole check family, or you blind the build to real bugs to hide one known one.

---

## Real-World Examples

Here is what several check families actually print. Reading these fluently is the skill — each message names the *check*, the *operation*, and the *values*.

**Signed integer overflow** (the most common find):

```
calc.c:12:18: runtime error: signed integer overflow:
  2147483647 + 1 cannot be represented in type 'int'
```

**Array bounds** (size known at compile time):

```
buf.c:8:11: runtime error: index 10 out of bounds for type 'int [10]'
```

**Null pointer dereference**:

```
node.c:23:9: runtime error: member access within null pointer of type 'struct Node'
```

**Shift past the bit width**:

```
flags.c:5:14: runtime error: shift exponent 35 is too large for 32-bit type 'int'
```

**Misaligned access** (common in hand-rolled packed-buffer parsers):

```
parse.c:40:5: runtime error: load of misaligned address 0x55... for type 'uint32_t',
  which requires 4 byte alignment
```

**Float→int cast overflow**:

```
conv.c:9:20: runtime error: 1e+300 is outside the range of representable values
  of type 'int'
```

**Bad C++ vtable / type confusion** (`vptr`):

```
shape.cpp:31:5: runtime error: downcast of address 0x55... which does not point
  to an object of type 'Circle'
  0x55...: note: object is of type 'Square'
```

A realistic bug UBSan turns from "occasional crash" into a precise report — computing a midpoint:

```c
int midpoint(int lo, int hi) {
    return (lo + hi) / 2;     // lo+hi overflows for large values
}
```
```
search.c:2:15: runtime error: signed integer overflow:
  1500000000 + 1500000000 cannot be represented in type 'int'
```

Without UBSan this is the infamous binary-search overflow bug: it "works" until the array is huge, then the index goes negative. The fix is `lo + (hi - lo) / 2`. UBSan reports it the first time a test feeds large enough values — *deterministically*, with the exact line.

---

## Mental Models

- **UBSan is a fire alarm wired to specific appliances.** It's not one smoke detector — it's twenty, one per dangerous operation (the stove, the heater, the wiring). You can arm them all (`undefined`) or just the kitchen (`bounds,null`). Each detector reports independently.

- **UB is a promise, not a behavior.** When you dereference `p`, you *promise* `p` is non-null; when you write `a + b` on signed ints, you *promise* it won't overflow. The optimizer believes your promise and rewrites code around it. UBSan is the auditor that checks, at runtime, whether you kept the promise.

- **Recover / abort / trap is detect-then-react.** The detection is identical; only the reaction differs — a printout you walk past (recover), an alarm that stops the line (abort), or a silent kill switch (trap). Match the reaction to who's listening: developer, CI, or production.

- **UBSan is the spice, ASan is the main dish.** You rarely serve UBSan alone. It has no memory cost and composes with any single memory sanitizer, so the default plate is "ASan + UBSan" — memory safety plus language-rules safety for roughly the price of ASan.

---

## Common Mistakes

1. **Running UBSan in recover mode in CI.** The default prints `runtime error:` but exits `0`. Your pipeline stays green while reporting real UB. Always add `-fno-sanitize-recover=all` (or `=undefined`) for CI so violations abort and fail the test.

2. **Assuming `-fsanitize=undefined` covers unsigned overflow.** Unsigned wraparound is *defined* (it wraps), so it's **not** in the `undefined` group. If you want to catch accidental unsigned wrap, add `unsigned-integer-overflow` by name — and expect false positives in code that wraps on purpose.

3. **Enabling `vptr` with `-fno-rtti`.** `vptr` reads runtime type info; with RTTI disabled it can't work and the build errors or silently drops the check. Either keep RTTI or exclude `vptr` from your flag list.

4. **Testing only at `-O0`.** UB's effects (deleted checks, folded comparisons) appear under optimization. A `-O0` UBSan run misses the very transformations that make UB dangerous in production. Build the sanitizer variant at `-O1` to exercise the optimizer.

5. **Suppressing a whole check family to silence one site.** Dropping `-fno-sanitize=signed-integer-overflow` to quiet one intentional wrap blinds the entire build to *all* signed overflow. Use `__attribute__((no_sanitize(...)))` on the one function, or a single suppressions-file line, instead.

6. **Forgetting `-g` (and the symbolizer).** Without debug info, reports lack file/line; without `llvm-symbolizer` on `PATH`, `print_stacktrace=1` gives bare addresses. A UBSan report you can't locate is barely better than a crash.

7. **Treating trap mode as a debugging build.** Trap mode emits no message — just `SIGILL`. It's for hardened *production*, not for finding bugs at your desk. For diagnosis use recover or abort, which print what and where.

---

## Test Yourself

1. Why does the optimizer delete the null check in `int x = *p; if (p == NULL) return -1;`? What category of behavior makes this legal?
2. Name three distinct UBSan check families and one example each.
3. Is `unsigned-integer-overflow` part of `-fsanitize=undefined`? Why or why not, and when would you add it?
4. What are the three UBSan modes, what flag selects each, and which one ships in hardened production builds — and why is that affordable?
5. Why can you combine ASan + UBSan but not ASan + TSan? Where does that put UBSan?
6. For a CI job, which two flags/options are non-negotiable, and what does each accomplish?
7. You need to keep `signed-integer-overflow` on globally but exempt one hashing function that wraps on purpose. What's the right tool — and what's the wrong one?

<details>
<summary>Answers</summary>

1. Dereferencing `*p` is UB if `p` is null. The compiler assumes UB never happens, so after line 1 it concludes `p` is non-null; therefore `p == NULL` is always false and the branch is dead code, which it deletes. The category is **undefined behavior** — the optimizer treats it as a promise the violation can't occur.
2. Any three, e.g.: `signed-integer-overflow` (`INT_MAX + 1`); `null` (dereferencing a null pointer); `bounds` (indexing past a fixed-size array); `shift-exponent` (shifting by ≥ bit width); `float-cast-overflow` (a float that doesn't fit in the target int).
3. **No.** Unsigned overflow is *defined* by the standard to wrap, so it isn't UB and isn't in the `undefined` group. You add `unsigned-integer-overflow` by name when you suspect *unintended* wraps are bugs — accepting false positives in code (hashing, ring buffers) that wraps deliberately.
4. **Recover** (default — print and continue), **abort** (`-fno-sanitize-recover=undefined` — print and terminate), **trap** (`-fsanitize-trap=undefined` — emit `ud2`, no message, no runtime lib). **Trap** ships in production because it's tiny (a compare + illegal instruction, no library call or string formatting) and has near-zero overhead, so a subset like `bounds`+trap can stay on permanently.
5. ASan and UBSan cover disjoint bug classes and UBSan has **no shadow memory**, so they layer cleanly. ASan and TSan both use conflicting shadow-memory schemes, so they can't coexist. UBSan's lack of shadow memory means it composes with *any* single memory sanitizer (ASan, TSan, or MSan).
6. `-fno-sanitize-recover=all` (or `=undefined`) so a fired check **aborts**, turning the violation into a non-zero exit that fails the test; and `UBSAN_OPTIONS=print_stacktrace=1` (with `llvm-symbolizer` available) so each report carries a **symbolized stack** pinpointing the site.
7. **Right:** annotate just that function with `__attribute__((no_sanitize("signed-integer-overflow")))` (or add one suppressions-file line). **Wrong:** removing the check globally with `-fno-sanitize=signed-integer-overflow`, which blinds the entire build to all signed overflow to hide one known case.

</details>

---

## Cheat Sheet

```
ENABLE
  -fsanitize=undefined                     all standard UB checks (a group flag)
  -fsanitize=signed-integer-overflow,bounds,null   a targeted subset
  -fsanitize=undefined,unsigned-integer-overflow   add opt-in unsigned wrap
  -fno-sanitize=alignment                  subtract one noisy check
  -g  -O1                                  debug info + exercise the optimizer

CHECK FAMILIES (each its own flag)
  signed-integer-overflow   integer-divide-by-zero   shift / shift-exponent
  null   nonnull-attribute   alignment   bounds / array-bounds
  pointer-overflow   object-size   vptr(*needs RTTI)   enum   bool
  float-cast-overflow   float-divide-by-zero   return   unreachable
  vla-bound   function   unsigned-integer-overflow(*not UB, opt-in)

MODES (same detection, different reaction)
  (default)                          recover: print + CONTINUE   (local exploration)
  -fno-sanitize-recover=undefined    abort:   print + TERMINATE   (CI / fuzzing)
  -fsanitize-trap=undefined          trap:    ud2, NO message     (hardened prod)

COMBINE
  -fsanitize=address,undefined       the standard debug/CI pairing
  rule: one memory sanitizer (ASan|TSan|MSan) + UBSan;  ASan+TSan is illegal

COST     ~few%-20% time, ~0 memory   (trap subset: ~0%)   | ASan ~2x time, ~3x mem

SUPPRESS (narrowly!)
  __attribute__((no_sanitize("undefined")))   one function opts out
  UBSAN_OPTIONS=suppressions=file.txt          ignore listed funcs/files
  UBSAN_OPTIONS=print_stacktrace=1:halt_on_error=1   symbolized stacks, abort
```

---

## Summary

- UB is not "the program does something weird at the UB site" — it's a **promise to the optimizer** that the violation never happens, which lets the compiler delete your null checks and fold your comparisons. UBSan makes that violated assumption **visible at runtime**.
- UBSan is a **suite of ~20 granular checks**, each with its own flag. `-fsanitize=undefined` is the umbrella; you can compose a subset (`bounds,null`) or add opt-in checks (`unsigned-integer-overflow`). Note `vptr` needs RTTI and unsigned/float-divide checks are not actually UB.
- There are **three modes**: recover (print + continue, the default), abort (`-fno-sanitize-recover`, for CI/fuzzing), and trap (`-fsanitize-trap`, tiny code with no diagnostic — the basis for hardened production subsets and the kernel's UBSAN).
- UBSan is **cheap** (~few %–20% time, negligible memory) and **composable** — it has no shadow memory, so it pairs with any one memory sanitizer. **ASan + UBSan** is the standard debug/CI build.
- In **CI**, run a sanitizer build variant in abort mode (`-fno-sanitize-recover=all`), enable `print_stacktrace=1`, build at `-O1`, and fail on any runtime error. Suppress the rare intentional case narrowly with `no_sanitize` or a suppressions file — never by dropping a whole check.

---

## Further Reading

- [Clang UndefinedBehaviorSanitizer documentation](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html) — the authoritative list of every check flag, the `-fsanitize-trap` / `-fno-sanitize-recover` semantics, and suppression mechanics.
- *A Guide to Undefined Behavior in C and C++* — John Regehr's three-part series. The definitive explanation of *why* the optimizer treats UB the way it does; required reading for Core Concept 1.
- [GCC Instrumentation Options (`-fsanitize=`)](https://gcc.gnu.org/onlinedocs/gcc/Instrumentation-Options.html) — GCC's UBSan flags, which track Clang's closely with a few naming differences.
- `man clang` / the LLVM `SanitizerCoverage` docs — for combining UBSan with fuzzing harnesses.
- [senior.md](senior.md) — how UBSan's checks lower to IR, the trap-handler design, ABI implications, and building a permanent hardened production subset.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/middle.md) — the memory-error sanitizer UBSan is almost always paired with; covers the bug classes UBSan doesn't.
- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/middle.md) — data-race detection; combines with UBSan (but not with ASan).
- [04 — Leak Detection & Valgrind](../04-memory-leak-detection-valgrind/middle.md) — the heavier, no-recompile alternative for finding what sanitizers don't.
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/middle.md) — your own runtime checks, the layer above compiler-inserted UB checks.
- [Static Analysis & Linting](../../static-analysis/) — catching some of the same UB *before* runtime, at compile time, without instrumentation.
