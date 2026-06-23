# UndefinedBehaviorSanitizer (UBSan) — Senior Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → UndefinedBehaviorSanitizer (UBSan)
> *The middle page showed you how to turn on `-fsanitize=undefined` and read its reports. This page is about the thing underneath: why the C and C++ standards deliberately leave behavior undefined, how the optimizer turns that permission into faster — and occasionally catastrophic — code, and what UBSan actually inserts into your binary to catch the gap before the optimizer does.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why UB Exists: The Optimizer's Contract](#core-concept-1--why-ub-exists-the-optimizers-contract)
5. [Core Concept 2 — How the Optimizer Exploits UB](#core-concept-2--how-the-optimizer-exploits-ub)
6. [Core Concept 3 — How UBSan Instruments: Checks Before the Operation](#core-concept-3--how-ubsan-instruments-checks-before-the-operation)
7. [Core Concept 4 — The Check Families and Their Cost](#core-concept-4--the-check-families-and-their-cost)
8. [Core Concept 5 — Trap Mode and the Minimal Runtime](#core-concept-5--trap-mode-and-the-minimal-runtime)
9. [Core Concept 6 — Signed vs Unsigned, and Changing the Language](#core-concept-6--signed-vs-unsigned-and-changing-the-language)
10. [Core Concept 7 — What UBSan Does NOT Catch](#core-concept-7--what-ubsan-does-not-catch)
11. [Core Concept 8 — Suppression, Ignorelists, and Intentional UB](#core-concept-8--suppression-ignorelists-and-intentional-ub)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Why undefined behavior is a tool the compiler is allowed to weaponize, and how UBSan inserts a check in the narrow window before that happens.**

By the middle level you can compile with `-fsanitize=undefined`, read a `runtime error: signed integer overflow` report, and fix the offending line. That makes you effective at clearing the diagnostics a build throws at you. The senior jump is understanding the *adversary* UBSan is racing against: the optimizer.

The C and C++ standards do not say "signed overflow wraps" or "a null dereference crashes." They say those constructs are **undefined behavior** — the standard imposes *no requirements at all*. That is not an oversight; it is a deliberate grant of license to the compiler. "This cannot happen" is the single most powerful premise an optimizer has, and every UB rule hands it one for free: assume signed arithmetic never overflows, assume dereferenced pointers are valid, assume objects don't alias across incompatible types. The optimizer then deletes the checks, branches, and loop guards that those assumptions make redundant — and your program gets faster, right up until the assumption is false, at which point it does something that may bear no resemblance to the source.

UBSan is the instrument that closes that gap. It inserts an explicit runtime check *before* each potentially-UB operation — comparing the operands before the signed add, checking the shift exponent before the shift, verifying alignment before the load — so the violation is *reported* as a violation instead of *exploited* as an assumption. This page is about both halves: the optimizer's contract that makes UB dangerous, and the instrumentation that makes it observable.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — the check families at a working level, how to enable `-fsanitize=undefined`, and how to read a basic report.
- **Required:** Comfort reading C/C++ at the level where you can predict what an expression evaluates to, and a working sense of the integer promotion and conversion rules.
- **Helpful:** You've read disassembly (`objdump -d`) and can recognize a removed branch or a strength-reduced multiply when you see one.
- **Helpful:** Scar tissue from a "but it worked at `-O0`" bug — a program that behaved at `-O0` and miscompiled at `-O2` is almost always UB meeting the optimizer.

---

## Glossary

| Term | Meaning |
|---|---|
| **Undefined behavior (UB)** | A construct for which the standard imposes *no* requirements. The compiler may assume it never happens and is not obligated to do anything sensible if it does. |
| **Unspecified / implementation-defined** | Weaker cousins of UB. Unspecified = the standard allows several behaviors, compiler need not document which. Implementation-defined = a choice the compiler *must* document (e.g. `int` size). Neither grants the "assume it can't happen" license. |
| **Instrumentation** | Compiler-inserted checks/calls added to your code at compile time, distinct from your logic, used by sanitizers to observe runtime events. |
| **`__ubsan_handle_*`** | The runtime entry points UBSan calls when a check fails (e.g. `__ubsan_handle_add_overflow`). Each takes a *type descriptor* and the offending values, and formats the diagnostic. |
| **Trap mode** | `-fsanitize-trap=...`: instead of calling a handler, the failing check executes an illegal instruction (`ud2` on x86), aborting with no message — tiny and fast. |
| **Minimal runtime** | `-fsanitize-minimal-runtime`: a stripped runtime that prints a one-line summary and aborts, designed for production hardening. |
| **Strict aliasing** | The rule that an object may only be accessed through a compatible (or `char`) lvalue type. Violating it is UB and enables `-fstrict-aliasing` optimizations. |
| **Type descriptor** | A static struct UBSan emits per checked operation, carrying the type name and kind, so the handler can print `'int'` vs `'unsigned long'`. |
| **Ignorelist / blacklist** | A file (`-fsanitize-ignorelist=`) listing functions/files/types to exclude from instrumentation. |

---

## Core Concept 1 — Why UB Exists: The Optimizer's Contract

The mental shift that separates a senior from someone who merely fixes UBSan reports: **undefined behavior is not a description of what the program will do — it is a promise the programmer makes to the compiler.** When the standard calls signed overflow UB, it is telling the compiler: *you may assume signed arithmetic never overflows.* The compiler holds you to that promise and optimizes on it.

Why would a language do this? Because the alternative is slower code on real hardware. Consider a loop:

```c
// The programmer "promises" i never overflows past INT_MAX
for (int i = 0; i <= n; i++)
    sum += a[i];
```

If signed overflow were defined to wrap (as it is for `unsigned`), the compiler could not assume `i` is monotonically increasing — `i + 1` might wrap to `INT_MIN` and the loop could run forever or behave strangely. Because overflow is *UB*, the compiler may assume `i` strictly increases, which lets it:

- prove the loop terminates and is a candidate for vectorization,
- promote `i` to a 64-bit register without worrying about wraparound at 32 bits,
- convert `i <= n` to a trip-count it computes once,
- and hoist or strength-reduce the address arithmetic on `a[i]`.

Every one of those wins rests on "overflow can't happen." Define the behavior and you forfeit them. This is the bargain: the language trades safety for the *permission to assume*, and the optimizer cashes that permission in.

> **Key insight:** UB is leverage. The standard makes a construct UB precisely so the compiler can treat the bad case as *impossible* rather than *handled* — no check, no branch, no guard. That is why UB produces fast code, and exactly why a violated assumption produces code with no relationship to your intent: you removed the safety net on purpose, then fell.

The corollary that surprises people: **the optimizer is not "buggy" when UB bites you.** It is doing precisely what the standard authorized — reasoning from a premise you certified true. The defect is in the source. UBSan exists to find that defect before the premise turns into deleted code.

---

## Core Concept 2 — How the Optimizer Exploits UB

Abstract "the compiler may assume" becomes visceral when you see the transformations. These are not hypothetical; each maps to a documented optimization pass.

**Removing a null check after a dereference.** The canonical case, and the shape of a real Linux kernel CVE (CVE-2009-1897 in the `tun` driver):

```c
struct sock *sk = tun->sk;     // dereference of tun
if (!tun)                       // null check AFTER the deref
    return POLLERR;
// ... use sk ...
```

The compiler reasons: line 1 dereferenced `tun`. If `tun` were null, that dereference would be UB. *Therefore `tun` is non-null* — the compiler is entitled to assume the UB didn't happen. The `if (!tun)` is now provably false, so the optimizer **deletes the entire null check**. On a system where page zero is mappable, an attacker who arranged `tun == NULL` then sailed past the deleted guard into exploitable territory. The fix in the source was to null-check *before* the dereference; the lesson for everyone else is that a deref is an implicit, optimizer-trusted assertion of non-nullness.

**`x * 2 / 2` → `x`.** With signed `x`, `x * 2` can overflow, which is UB, so the compiler assumes it doesn't — and if `x * 2` never overflows, then `(x * 2) / 2` is exactly `x`. The multiply and divide vanish. Correct under the contract, surprising if you expected wraparound.

**Signed overflow assumed impossible, so a bound changes.** A classic miscompile shape:

```c
int foo(int x) {
    return x + 1 > x;     // "is x+1 greater than x?"
}
```

You might expect this to be `false` when `x == INT_MAX` (because the add wraps). But `x + 1 > x` is UB exactly when it would wrap, so the compiler assumes it *never* wraps, which makes `x + 1 > x` *unconditionally true*. The function is optimized to `return 1;` — the comparison is gone. (`-fwrapv` defeats this by *defining* the overflow; see Concept 6.)

**Dead-code elimination of "impossible" branches.** If a value is UB on one path, the compiler may conclude that path is unreachable and delete it — including error handling you wrote for it. A shift by an out-of-range amount, a division that could be by zero on a path the compiler proves "can't happen," an integer-to-enum conversion outside the enum's range: each can let the optimizer prune a branch you believed was live.

**Time-bomb miscompiles.** The most insidious property: UB-exploiting optimizations are *latent*. Code that "works" today does so because *this* compiler version didn't yet have the analysis to notice the UB. A future compiler gets a smarter range analysis or a new inlining heuristic, suddenly *sees* the UB, and miscompiles code that has shipped untouched for years. The source never changed; the optimizer got smarter. This is why "it's worked for a decade" is no defense, and why UBSan in CI is a hedge against your *next* compiler upgrade, not just your current bugs.

> **Key insight:** The optimizer never sets out to break your code — it propagates one assumption (`this UB can't happen`) and deletes whatever that assumption makes redundant: a null check, a multiply, a comparison, a whole branch. Read every UB rule as "the compiler may delete the code that would have handled the bad case," and the danger is no longer abstract.

---

## Core Concept 3 — How UBSan Instruments: Checks Before the Operation

UBSan's strategy is the mirror image of the optimizer's. Where the optimizer deletes the check because UB "can't happen," UBSan *inserts* a check because it might. Crucially, the check is emitted **before** the potentially-UB operation, in the compiler front/middle end, so it runs *before* the violation can be exploited.

Take a signed addition. Without instrumentation it's one instruction. With `-fsanitize=signed-integer-overflow`, the compiler lowers `a + b` to something conceptually like:

```c
// pseudo-lowering of `int r = a + b;` under UBSan
int r;
if (__builtin_add_overflow(a, b, &r))          // hardware overflow check
    __ubsan_handle_add_overflow(&descriptor, a, b);   // report, then (by default) continue
// r holds the (wrapped) result; execution proceeds unless told to abort
```

The pieces, generalized across all checks:

1. **A precondition test inserted before the operation.** For overflow, compare/predict the result (modern compilers use the CPU's overflow flag via `__builtin_*_overflow`). For shifts, test `exponent < bit_width(type)` and `exponent >= 0`. For alignment, test `(uintptr_t)p & (align - 1) == 0`. For bounds (with `-fsanitize=bounds` plus `-fsanitize=array-bounds`), test the index against the known array extent.
2. **A static type descriptor** emitted once per checked site — a small read-only struct holding the type's name and kind — so the handler can print `'int'`, `'unsigned long`, `'T*'` rather than a raw number.
3. **A call to a `__ubsan_handle_<check>` runtime function** on failure. It receives the descriptor and the offending values, formats the human-readable diagnostic, optionally prints a stack trace, and — depending on mode — returns (so the program continues, which is why you often see *many* errors in one run) or aborts.

```bash
# See the instrumentation the compiler actually emitted:
clang -fsanitize=signed-integer-overflow -O1 -S -emit-llvm add.c -o -
#   look for calls to @__ubsan_handle_add_overflow and the br to the trap/handler block
```

The handler names are part of the stable ABI between instrumented code and the runtime (`libclang_rt.ubsan_standalone`): `__ubsan_handle_add_overflow`, `__ubsan_handle_shift_out_of_bounds`, `__ubsan_handle_type_mismatch_v1` (alignment / null / size), `__ubsan_handle_divrem_overflow`, `__ubsan_handle_out_of_bounds`, `__ubsan_handle_load_invalid_value` (bad `bool`/enum), `__ubsan_handle_vla_bound_not_positive`, and so on. Seeing one in a stack trace tells you the exact check family without reading the message.

> **Key insight:** UBSan wins the race against the optimizer by ordering: the check is emitted *before* the operation and *before* most UB-exploiting passes run, so the violation is observed as data rather than consumed as a "can't happen" premise. This is also why UBSan and the optimizer can disagree about the *same* line — UBSan is asking "did this happen?" while `-O2` already assumed it didn't.

A subtle consequence: because the check sits in the IR before optimization, the optimizer can still *remove a UBSan check it can prove always passes* — which is good (zero cost where it's provably safe) — but it must not remove the underlying operation's safety on the basis of the very UB the check is guarding. Compilers special-case this so instrumentation isn't optimized into uselessness.

---

## Core Concept 4 — The Check Families and Their Cost

`-fsanitize=undefined` is an *umbrella* that enables a curated set of sub-checks. Knowing the families individually matters because their costs differ by orders of magnitude, and production hardening means enabling the cheap ones and refusing the expensive ones.

| Check (`-fsanitize=`) | Catches | Relative cost | Production-viable? |
|---|---|---|---|
| `signed-integer-overflow` | signed `+ - * /` overflow, `INT_MIN/-1` | very low (one branch on the overflow flag) | yes, especially in trap mode |
| `shift` / `shift-exponent` / `shift-base` | shift ≥ width, negative shift, negative-base shift | very low | yes |
| `integer-divide-by-zero` | `x / 0`, `x % 0` | low (you often need the zero check anyway) | yes |
| `bounds` / `array-bounds` | index outside a *statically-sized* array | low–moderate (only when extent is known) | often yes |
| `null` | dereference / member access on null | low | yes |
| `alignment` | misaligned load/store | low (a mask + branch) | usually |
| `object-size` | access past the end of an object the compiler can size | low–moderate | situational |
| `bool` / `enum` | loading a value outside a `bool`/enum's valid set | low | yes |
| `pointer-overflow` | pointer arithmetic that overflows | low | usually |
| `float-cast-overflow` | float→int conversion out of range | low–moderate | situational |
| `vptr` | bad virtual call / bad `dynamic_cast` (use-after-free, wrong type) | **high** — needs RTTI + a per-class type-hash table; cannot coexist with `-fno-rtti`; C++ only | rarely; debug/CI only |
| `function` | calling a function pointer of the wrong type | moderate; needs metadata | situational |

The headline trade-off is **`vptr`**. It is the most powerful C++ check — it catches calling a virtual method through a dangling or wrong-type pointer, a real source of exploitable bugs — but it is structurally expensive: it requires RTTI to be on, and it consults a runtime table mapping addresses to type-hash information to verify the object's dynamic type before the virtual dispatch. That table and the lookups cost both binary size and time, and `vptr` is fundamentally incompatible with the `-fno-rtti` builds that much performance-sensitive C++ uses. So `vptr` lives in debug and CI, essentially never in production.

By contrast, `signed-integer-overflow` in trap mode is nearly free: the CPU already computes an overflow flag for every add; the instrumentation is a single conditional branch to a trap on that flag, which a well-predicted not-taken branch makes almost invisible. This asymmetry is the whole reason the kernel and Android ship *some* UBSan in production: they cherry-pick the checks whose cost is a branch, and drop the ones that need tables and RTTI.

```bash
# Enable the umbrella, then surgically drop the expensive one:
clang -fsanitize=undefined -fno-sanitize=vptr -O2 app.c

# Or build exactly the cheap production set:
clang -fsanitize=signed-integer-overflow,shift,integer-divide-by-zero,bounds \
      -fsanitize-trap=all -O2 app.c
```

> **Key insight:** "Is UBSan cheap enough for production?" has no single answer — it's per-check. Overflow, shift, divide-by-zero, and bounds are a branch each; `vptr` is a table lookup plus an RTTI dependency. Production UBSan means selecting the branch-cost checks (typically in trap mode) and explicitly refusing the table-cost ones.

A second cost lever is the *runtime* you pair with the checks (next concept): the full diagnostic runtime that formats messages is itself a binary-size and dependency cost that trap mode and the minimal runtime exist to avoid.

---

## Core Concept 5 — Trap Mode and the Minimal Runtime

There are three ways UBSan can react to a failed check, and they sit on a spectrum from "debuggable" to "deployable."

**1. Full runtime (the default).** A failed check calls `__ubsan_handle_*`, which formats a rich diagnostic — file, line, the offending values, the types — optionally symbolizes a stack trace, and (unless told otherwise) *returns* so the program keeps running and reports further errors. This is the developer mode: maximally informative, but it links a sizeable runtime (`libclang_rt.ubsan_standalone`) and is not what you ship.

```
runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'
    #0 0x... in compute /home/u/app.c:42:13
```

**2. Trap mode (`-fsanitize-trap=...`).** Instead of a handler call, a failed check executes an *illegal instruction* — `ud2` on x86-64, `brk`/`udf` on ARM — which faults and terminates the process. There is **no runtime, no message, no diagnostic** — just a crash (SIGILL) at the offending instruction. The cost is therefore almost nil: the instrumentation is a branch to a `ud2`, and a `ud2` is a single trapping instruction the CPU never speculatively retires. You lose the message entirely; you gain near-zero overhead and zero runtime dependency.

```bash
clang -fsanitize=signed-integer-overflow -fsanitize-trap=signed-integer-overflow -O2 app.c
# On overflow the process dies with SIGILL; debug it under gdb to see which ud2 fired:
#   Program received signal SIGILL, Illegal instruction.  0x... in compute () at app.c:42
```

Trap mode reframes UBSan from a *diagnostic tool* into a *security mitigation*: it converts a silently-exploitable UB into a deterministic, fail-closed crash — turning "the optimizer deleted my null check and an attacker walked through" into "the process aborts at the violation." That is exactly the posture a hardened binary wants.

**3. Minimal runtime (`-fsanitize-minimal-runtime`).** A middle ground built for production hardening. It links a tiny runtime that, on failure, prints a *one-line* summary (no full formatting, no symbolized stack by default) and aborts. It exists because trap mode's total silence is sometimes too little to triage a field crash, while the full runtime is too heavy and too large an attack surface to ship. This is the mode **Android and Chrome** use for shipped UBSan: small enough to deploy, enough signal to know *which check* fired.

```bash
clang -fsanitize=signed-integer-overflow,bounds,shift \
      -fsanitize-minimal-runtime -fno-sanitize-recover=all -O2 app.c
#   one-line abort on failure; no heavyweight runtime linked
```

A related knob is **recovery**: `-fsanitize-recover=...` lets a check report-and-continue (the default for the full runtime), while `-fno-sanitize-recover=...` makes it report-and-abort. For CI you often want `-fno-sanitize-recover=all` so the *first* UB fails the build; for interactive debugging you may want recovery so one run surfaces *every* violation.

**The kernel's UBSan (`CONFIG_UBSAN`).** The Linux kernel can't link userspace sanitizer runtimes, so it ships its *own* tiny handlers in `lib/ubsan.c` that print to the kernel log (`dmesg`). `CONFIG_UBSAN` (with sub-options like `CONFIG_UBSAN_BOUNDS` and historically `CONFIG_UBSAN_SHIFT`) is exactly the "select the cheap checks, use a minimal in-tree runtime" pattern, applied to a context with no libc at all — and `CONFIG_UBSAN_TRAP` gives the kernel the message-free trap variant.

> **Key insight:** UBSan is two products wearing one flag. With the full runtime it's a *debugging instrument* (rich messages, recover-and-continue). With trap mode or the minimal runtime it's a *security mitigation* (fail-closed crash on UB, near-zero overhead). Choosing between them is choosing whether you're hunting bugs or hardening a shipped binary.

---

## Core Concept 6 — Signed vs Unsigned, and Changing the Language

A point of perpetual confusion that a senior must hold precisely: **only *signed* integer overflow is undefined.** Unsigned overflow is *defined* — the standard mandates wraparound modulo 2ⁿ. So `UINT_MAX + 1 == 0` is not UB; it is guaranteed behavior, and the optimizer may *not* assume it can't happen.

This has a direct consequence for UBSan's default set. `-fsanitize=undefined` includes `signed-integer-overflow` but **not** `unsigned-integer-overflow`, because unsigned overflow is not UB — flagging it by default would be flagging *defined* behavior. But unsigned wraparound is still a frequent *bug* (a length subtraction going negative and wrapping to a huge `size_t`, then used as an allocation size). So UBSan offers it as an **opt-in**:

```bash
# Default umbrella: signed overflow IS checked, unsigned is NOT.
clang -fsanitize=undefined app.c

# Opt in to flag unsigned wraparound as a *likely* bug (not a standard violation):
clang -fsanitize=unsigned-integer-overflow app.c
```

The distinction matters for triage: a `signed-integer-overflow` report is a *language violation* (the optimizer was about to exploit it); an `unsigned-integer-overflow` report is UBSan acting as a lint for a *probable logic error*. They demand different mental responses.

Now the orthogonal axis. There are two ways to deal with an integer-overflow UB, and they are not the same thing:

**(a) Detect it** — UBSan, as above. You keep the UB in the language; you observe it at runtime.

**(b) Change the language so it isn't UB anymore** — flags that *redefine* the semantics:

```bash
gcc -fwrapv app.c              # signed overflow is DEFINED to wrap (two's-complement)
gcc -fno-strict-overflow app.c # the compiler won't optimize on the no-overflow assumption
gcc -fno-strict-aliasing app.c # accesses through incompatible types are no longer assumed not to alias
```

`-fwrapv` makes signed overflow *defined* (it wraps), which means the `x + 1 > x → 1` miscompile from Concept 2 no longer happens — but it also forfeits the optimizations that depended on assuming no overflow. `-fno-strict-aliasing` similarly removes the strict-aliasing UB (and its optimizations); the Linux kernel builds with it precisely because so much kernel code legitimately type-puns.

The relationship to UBSan is important and easy to get wrong: **`-fwrapv` and `-fsanitize=signed-integer-overflow` are usually mutually pointless together.** If overflow is *defined* to wrap (`-fwrapv`), it is no longer UB, so there is nothing for the overflow sanitizer to flag — the construct is now legal. You either *detect* the UB (sanitize) or *eliminate* it (change the language); doing both means asking UBSan to report behavior you just made well-defined.

> **Key insight:** "UB" and "the optimization the UB enables" are two faces of one rule, and you have two distinct levers. UBSan keeps the rule and *watches* for violations (a debugging/hardening posture). `-fwrapv` / `-fno-strict-aliasing` *delete the rule*, trading the optimization for guaranteed semantics (a correctness-by-construction posture). Choose per codebase; don't expect a sanitizer to flag UB you've already legalized.

---

## Core Concept 7 — What UBSan Does NOT Catch

UBSan's false-positive rate is famously near zero — when it fires, you almost certainly have genuine UB. But its *false-negative* surface is large, and overestimating its coverage is a classic senior-level error. Four distinct gaps:

**1. UB it has no check for.** UBSan covers a specific, enumerated list. Vast categories of UB have *no* UBSan check at all: data races (that's [ThreadSanitizer](../02-thread-sanitizer-tsan/senior.md)'s domain), use-after-free and most out-of-bounds *heap* access (that's [AddressSanitizer](../01-address-sanitizer-asan/senior.md)), uninitialized reads (MemorySanitizer), violating sequencing rules in some forms, infinite loops without side effects, and many strict-aliasing violations the front end can't see locally. `-fsanitize=undefined` is a *subset* of UB, not all of it.

**2. UB the optimizer removed *before* instrumentation could see it.** This is the subtle one. UBSan's checks are inserted in the IR, but if a *different* pass already exploited the UB and deleted the operation, there may be nothing left to instrument. The interaction is mode- and order-dependent — which is one reason UBSan is most reliable at lower optimization levels and why you should not assume `-O2 -fsanitize=undefined` catches *exactly* what `-O0 -fsanitize=undefined` catches. Build your sanitizer CI at a defined, documented optimization level.

**3. Anything not executed.** UBSan is a *dynamic* tool: it only checks code that actually runs, on the inputs you actually feed it. A UB lurking on an untaken branch, behind an unhit error path, or triggered only by an input your tests never produce is invisible. This is the structural limitation of all dynamic analysis and the reason UBSan's value multiplies under a **fuzzer** (Concept: Real-World Examples) — the fuzzer manufactures the inputs that drive execution into the dark corners where the UB lives.

**4. It is not a memory-safety tool.** The single most important "does not catch" to internalize. UBSan detects *language-level* UB (overflow, bad shifts, misalignment, bad enum loads). It does **not** track heap allocations, does **not** detect use-after-free, does **not** find most buffer overruns on the heap, and does **not** detect leaks. Those are AddressSanitizer's and the leak detector's job. A team that runs UBSan and believes it's "covered for memory bugs" has a dangerous false sense of safety.

> **Key insight:** UBSan answers one narrow question — "did a *language-defined* undefined behavior just execute, of a kind I have a check for, on a path that actually ran?" Everything outside that — memory safety, races, uninitialized reads, untested paths, UB optimized away upstream — is someone else's tool or no tool at all. Treat UBSan as *one oracle*, never the whole safety net.

The practical conclusion: UBSan is a *complement*, not a substitute. The standard senior configuration pairs it with ASan and drives both with tests and fuzzing — three different oracles watching three different failure classes on the same execution.

---

## Core Concept 8 — Suppression, Ignorelists, and Intentional UB

Because UBSan flags *real* UB, suppression is rare and should make you suspicious — most "suppress this UBSan finding" requests are really "fix this bug" requests in disguise. But three legitimate cases exist, with three different mechanisms.

**1. Per-function exclusion — `__attribute__((no_sanitize(...)))`.** When a function *intentionally* relies on a behavior UBSan flags, and you've decided that's correct (e.g. a hashing routine that *wants* unsigned wraparound, or a low-level routine doing deliberate type punning), annotate it:

```c
__attribute__((no_sanitize("signed-integer-overflow")))
int64_t intentional_wrap(int64_t a, int64_t b) {
    return a + b;     // overflow here is by design; do NOT instrument
}
// C++ spelling: [[clang::no_sanitize("...")]] or [[gnu::no_sanitize_undefined]]
```

Note the granularity: `no_sanitize("signed-integer-overflow")` disables *only* that check in *only* that function — you keep every other check everywhere else.

**2. File/function/type ignorelists — `-fsanitize-ignorelist=`.** For excluding swaths of code without touching the source — a third-party header you can't annotate, a generated file, a known-noisy module:

```
# ubsan-ignore.txt
src:third_party/legacy/*
fun:*deliberately_unaligned*
type:struct.PackedWireFormat
```

```bash
clang -fsanitize=undefined -fsanitize-ignorelist=ubsan-ignore.txt app.c
```

(The older spelling is `-fsanitize-blacklist=`; modern toolchains prefer `ignorelist`.)

**3. Intentional-UB patterns that are actually wrong.** The trap here is that many "intentional UB" patterns are *not* intentional — they're folklore that happens to work today and will time-bomb later (Concept 2). Deliberate signed overflow "because it wraps on this CPU" is the archetype: it's UB, the optimizer may exploit it, and the *right* fix is usually to do the arithmetic in `unsigned` (defined wraparound) or to use `__builtin_*_overflow`, not to suppress the check. Reserve `no_sanitize` for cases where the behavior is genuinely defined-by-construction (e.g. you've moved to unsigned and the *sanitizer's opt-in* unsigned check is firing on a wrap you want).

For *reading* and triaging reports across check families, two runtime options pull their weight:

```bash
# Full stack trace on every report + symbolized frames:
UBSAN_OPTIONS=print_stacktrace=1 ./app
# Point the runtime at the symbolizer if frames show as addresses:
UBSAN_OPTIONS=print_stacktrace=1 \
  external_symbolizer_path=$(which llvm-symbolizer) ./app
# Make the first violation fatal (CI):
UBSAN_OPTIONS=halt_on_error=1 ./app
```

`print_stacktrace=1` is the difference between "overflow at line 42" and the full call chain that *reached* line 42 — usually where the actual bug (the bad input, the wrong sign) originates. Symbolization requires `llvm-symbolizer` (or `addr2line`) on `PATH` or pointed-to; without it you get addresses, not function names.

> **Key insight:** UBSan suppression is a sharp tool used rarely — a near-zero false-positive rate means most findings are bugs. Prefer *fixing* (often "do it in unsigned" or "use `__builtin_*_overflow`") over `no_sanitize`; reserve annotations and ignorelists for genuinely-defined-by-construction code and for third-party code you can't change.

---

## Real-World Examples

**1. The `tun` driver and the deleted null check (CVE-2009-1897).** The shape is in Concept 2: a dereference preceded a null check, the compiler used the deref to prove the pointer non-null, and deleted the check. With page-zero mappable, this became an exploitable null-deref bypass. UBSan's `null` check would have *reported* the null dereference at runtime instead of letting the optimizer silently turn it into a security hole — and trap mode would have converted it into a fail-closed SIGILL. This single CVE is the most-cited argument for both UBSan and for never trusting a deref-then-check ordering.

**2. STACK: UB that *only* manifests after optimization.** Wang et al.'s "Undefined Behavior: What Happened to My Code?" and the STACK checker showed this class systematically: real code in major projects contained checks the compiler *removed* because the check itself was UB-dependent (e.g. `if (p + offset < p)` to detect pointer overflow — which is UB, so the compiler assumed it false and deleted the bounds check). The bug is invisible in the source and invisible at `-O0`; it appears only when the optimizer exploits the UB. UBSan's `pointer-overflow` check catches exactly this family at runtime.

**3. Fuzzer + ASan + UBSan as three oracles on one run.** The modern bug-finding pipeline: a fuzzer (libFuzzer / AFL++) generates inputs; the target is built with `-fsanitize=address,undefined`; ASan watches for memory errors and UBSan watches for language UB *on the same execution*. The fuzzer manufactures the rare inputs that drive execution into UB-laden corners (Concept 7's gap #3), and the two sanitizers act as independent detectors — ASan catches the heap overflow, UBSan catches the signed overflow that *computed* the bad index. Neither alone would find as much; together on a fuzzer they are the highest-yield setup in practice. (Build note: ASan+UBSan combine cleanly in one binary.)

```bash
clang -fsanitize=address,undefined -fno-sanitize-recover=all \
      -fsanitize=fuzzer -g -O1 target.c -o fuzz_target
./fuzz_target corpus/    # every crash is either a memory error (ASan) or UB (UBSan)
```

**4. Production overflow hardening in a shipped binary.** A team ships a long-running C++ service. They cannot afford the full runtime, can't use `vptr` (they build `-fno-rtti`), and want a fail-closed posture. The configuration: `-fsanitize=signed-integer-overflow,bounds,shift -fsanitize-trap=all` — the branch-cost checks only, in trap mode, so a violated assumption becomes a deterministic crash with near-zero steady-state cost rather than an exploitable miscompile. This is the same logic the Linux kernel applies with `CONFIG_UBSAN_TRAP` and Android applies with the minimal runtime.

**5. The CI gate that catches the *next* compiler.** A library passes all tests on GCC 11. CI also builds and runs the suite under `clang -fsanitize=undefined -fno-sanitize-recover=all`. Two years later, a teammate's GCC-13 build silently miscompiles a function that relied on signed-overflow UB — but the UBSan CI job had been *failing on that exact line* since it was added, flagging the latent UB long before the smarter compiler weaponized it. This is the time-bomb defense (Concept 2) in operational form: UBSan in CI finds the UB while it's still benign.

---

## Mental Models

- **UB is a promise, not a behavior.** When the standard says "undefined," read it as "the programmer guarantees this never happens, and the compiler may optimize as if that's true." The optimizer isn't malfunctioning when UB bites — it's collecting on a promise you broke. UBSan is the auditor that checks whether the promise actually held.

- **Every UB rule is a deletion the optimizer is allowed to make.** Signed overflow → it deletes overflow handling. Deref → it deletes the later null check. Strict aliasing → it deletes reloads it assumes can't have changed. Translate each rule into "what code is now redundant" and the danger stops being abstract.

- **UBSan and the optimizer race in opposite directions on the same line.** The optimizer assumes the UB *didn't* happen and removes the guard; UBSan inserts a guard to check whether it *did*. They are answering opposite questions about the identical operation — which is why they can "disagree," and why instrumentation order (check *before* the op) is what lets UBSan win.

- **Cost is per-check, not per-tool.** "Is UBSan fast enough for production?" is the wrong question. Overflow/shift/divide/bounds are a branch each (yes); `vptr` is a table + RTTI (no). Production UBSan is a *curated subset* in trap or minimal-runtime mode.

- **UBSan is one oracle among several.** It watches language UB on executed paths. ASan watches memory. TSan watches races. A fuzzer feeds them inputs. The safety comes from the *ensemble* on a shared execution, never from UBSan alone.

---

## Common Mistakes

1. **Believing UBSan covers memory safety.** It does not track the heap, find use-after-free, or catch most buffer overruns. It is a *language-UB* detector. Always pair it with [AddressSanitizer](../01-address-sanitizer-asan/senior.md); a "we run UBSan" team is not a memory-safe team.

2. **Combining `-fwrapv` with `-fsanitize=signed-integer-overflow`.** `-fwrapv` *defines* signed overflow (it wraps), so it's no longer UB and there's nothing for the overflow sanitizer to flag. You either detect the UB or legalize it — doing both is contradictory.

3. **Expecting `-O2 -fsanitize=undefined` to catch the same set as `-O0`.** A UB the optimizer exploits *before* instrumentation can be deleted out from under the check. Pin your sanitizer CI to a defined optimization level and don't assume coverage is invariant across `-O` levels.

4. **Shipping the full diagnostic runtime to production.** The message-formatting runtime is binary-size and attack-surface you don't want in a shipped binary. Use `-fsanitize-trap=` (no runtime, fail-closed) or `-fsanitize-minimal-runtime` (one-line abort) — the Android/Chrome/kernel posture.

5. **Enabling `vptr` in a performance-sensitive or `-fno-rtti` build.** `vptr` requires RTTI and a runtime type-hash table; it's incompatible with `-fno-rtti` and far too costly for production. Use `-fno-sanitize=vptr` to drop it from the umbrella, or only enable it in debug/CI.

6. **Treating an `unsigned-integer-overflow` report as a standard violation.** Unsigned overflow is *defined* (wraps). That check is an opt-in *lint for a likely bug*, not a UB report — respond by checking whether the wrap is a logic error, not by assuming the optimizer was about to exploit it.

7. **Suppressing a finding with `no_sanitize` when the real fix is `unsigned` or `__builtin_*_overflow`.** Most "intentional signed overflow" is folklore that will time-bomb. Reserve `no_sanitize` for genuinely-defined-by-construction code; fix the rest properly.

8. **Running UBSan only on your tests and declaring victory.** It's dynamic — it sees only executed paths. Untested branches hide UB. Drive UBSan with a fuzzer to manufacture the inputs that reach the dark corners.

---

## Test Yourself

1. The standard calls signed integer overflow "undefined behavior." Explain, in terms of the optimizer's *contract*, why that produces faster code than defining it to wrap.
2. Walk through how a compiler can *delete a null check* that appears after a dereference. Which real CVE has this shape, and which UBSan check would have reported it?
3. UBSan inserts its check *before* the potentially-UB operation. Why is that ordering essential, and how does it let UBSan "win" against the optimizer for the same line?
4. Name two UBSan checks that are cheap enough for production and one that is not. For the expensive one, say *why* it's expensive.
5. Contrast the three failure modes: full runtime, trap mode, and minimal runtime. Which is a "debugging instrument" and which is a "security mitigation," and why?
6. Why are `-fwrapv` and `-fsanitize=signed-integer-overflow` usually pointless together? What's the conceptual difference between the two approaches to integer-overflow UB?
7. List three distinct categories of UB (or unsafe behavior) that UBSan does **not** catch, and say which tool, if any, covers each.

<details>
<summary>Answers</summary>

1. Defining overflow as wrapping forces the compiler to treat signed arithmetic as possibly non-monotonic, blocking optimizations: it can't assume a loop counter strictly increases (no proof of termination, no easy vectorization, no safe promotion to a wider register, no one-shot trip-count). Leaving overflow *UB* lets the compiler assume it never happens, so all those optimizations become legal. UB is the *permission to assume the bad case is impossible* — that permission is the speed.

2. The compiler reasons: the dereference is UB if the pointer is null; therefore (assuming UB doesn't happen) the pointer is non-null; therefore a later `if (!p)` is provably false and can be deleted. The shape is **CVE-2009-1897** in the Linux `tun` driver. UBSan's **`null`** check (part of `type_mismatch`) would have reported the null dereference at runtime; trap mode would have turned it into a fail-closed SIGILL.

3. The check must run *before* the operation so the violation is observed as *data* rather than consumed as a "can't happen" *premise*; it's also emitted in the IR before most UB-exploiting passes run. That ordering means UBSan asks "did this happen?" and reports it, while the optimizer would otherwise assume "this didn't happen" and delete the guard — same line, opposite questions, and the earlier-inserted check wins.

4. Cheap/production-viable: `signed-integer-overflow`, `shift`, `integer-divide-by-zero`, `bounds`, `null`, `alignment` (any two). Expensive: **`vptr`** — it needs RTTI enabled and consults a runtime type-hash table to verify an object's dynamic type before a virtual call, costing binary size and time, and it's incompatible with `-fno-rtti`.

5. **Full runtime**: rich, formatted diagnostics, recover-and-continue — a *debugging instrument*; too heavy/large to ship. **Trap mode**: a `ud2`/illegal-instruction crash with no message, near-zero cost, no runtime — a *security mitigation* (fail-closed on UB). **Minimal runtime**: one-line summary then abort — a deployable middle ground (Android/Chrome) when trap mode is too silent but the full runtime is too heavy.

6. `-fwrapv` *defines* signed overflow to wrap, so it's no longer UB — there's nothing left for the overflow sanitizer to flag. The conceptual split: UBSan *detects* the UB while keeping it in the language (debugging/hardening); `-fwrapv` *eliminates* the UB by changing the language semantics (correctness by construction, at the cost of the optimizations the UB enabled). You pick one.

7. Examples: **data races** → ThreadSanitizer; **use-after-free / heap buffer overflow** → AddressSanitizer; **uninitialized reads** → MemorySanitizer; **UB on untested paths** → no tool (needs a fuzzer to reach them); **UB the optimizer deleted before instrumentation** → none reliably. The throughline: UBSan covers only *language UB it has a check for, on paths that actually ran*.

</details>

---

## Cheat Sheet

```
ENABLE / SCOPE
  -fsanitize=undefined            umbrella of UB sub-checks (signed-overflow, shift,
                                  divide-by-zero, bounds, null, alignment, enum/bool, ...)
  -fsanitize=signed-integer-overflow,shift,bounds   pick exact checks
  -fno-sanitize=vptr              drop the expensive RTTI/table check from the umbrella
  -fsanitize=unsigned-integer-overflow   OPT-IN: unsigned wrap is DEFINED, flagged as a likely bug

FAILURE MODE  (debugging  ────────────────►  hardening)
  (default full runtime)          rich message, recover-and-continue
  -fsanitize-trap=all             ud2/illegal-instr, NO message, ~free, fail-closed
  -fsanitize-minimal-runtime      one-line abort, deployable (Android/Chrome)
  -fno-sanitize-recover=all       first violation aborts (CI gate)
  Linux kernel: CONFIG_UBSAN(_BOUNDS), CONFIG_UBSAN_TRAP

CHANGE THE LANGUAGE (eliminate UB instead of detecting it)
  -fwrapv                  signed overflow DEFINED to wrap (don't also sanitize it)
  -fno-strict-overflow     compiler won't optimize on the no-overflow assumption
  -fno-strict-aliasing     incompatible-type accesses no longer assumed non-aliasing

SUPPRESS (rarely — UBSan false positives are near zero)
  __attribute__((no_sanitize("signed-integer-overflow")))   per-function, per-check
  -fsanitize-ignorelist=ubsan-ignore.txt    src:/fun:/type: patterns

RUNTIME / READING REPORTS
  UBSAN_OPTIONS=print_stacktrace=1            full symbolized stack on each report
  UBSAN_OPTIONS=halt_on_error=1               stop at first violation
  external_symbolizer_path=$(which llvm-symbolizer)   names instead of addresses
  __ubsan_handle_add_overflow / _shift_out_of_bounds / _type_mismatch_v1 ...
                                              handler name in a trace = the check family

HIGH-YIELD COMBO
  clang -fsanitize=address,undefined -fno-sanitize-recover=all -fsanitize=fuzzer -g -O1
        → fuzzer feeds inputs; ASan + UBSan are two oracles on one execution
```

---

## Summary

- **Undefined behavior is a deliberate grant of license to the optimizer.** The standard makes constructs UB so the compiler may assume they *never happen* — no overflow check, no null guard, no anti-aliasing reload — and that permission is exactly what produces fast code. When UB executes, the optimizer's "can't happen" assumption turns your program into code with no relation to the source.
- **The optimizer exploits UB concretely:** it deletes a null check after a dereference (the `tun` CVE shape), folds `x*2/2` to `x`, proves `x+1 > x` always true, prunes "impossible" branches, and — worst — *time-bombs*, miscompiling untouched code the day a smarter compiler notices the UB.
- **UBSan instruments by inserting a check *before* the operation** — compare operands before the signed add, test the shift exponent, check alignment — and calling a `__ubsan_handle_*` runtime. The ordering is what lets it observe the violation before the optimizer consumes it as a premise.
- **Cost is per-check.** Overflow, shift, divide-by-zero, and bounds are a branch each (production-viable, especially in trap mode); `vptr` needs RTTI plus a type-hash table (debug/CI only). **Trap mode** (`ud2`, no message, ~free) and the **minimal runtime** (one-line abort) turn UBSan from a debugging instrument into a deployable security mitigation — the Android/Chrome/kernel posture.
- **Only *signed* overflow is UB**; unsigned wraps by definition, so UBSan checks signed by default and offers unsigned as an opt-in *lint*. You can also *eliminate* the UB with `-fwrapv` / `-fno-strict-aliasing` instead of detecting it — but don't do both for the same construct.
- **UBSan is one oracle, not a safety net.** It misses memory safety (use ASan), races (TSan), uninitialized reads (MSan), untested paths (use a fuzzer), and UB the optimizer deleted upstream. Its false-positive rate is near zero — when it fires, fix the bug; reserve `no_sanitize`/ignorelists for genuinely-defined-by-construction or untouchable third-party code.

You now reason about UBSan as the counter-move to a specific adversary — the optimizer's exploitation of a contract you may have unknowingly broken — and you can configure it as either a diagnostic or a mitigation. The next layer — [professional.md](professional.md) — is about operating that across an organization: sanitizer CI matrices, fuzzing infrastructure, triage at scale, and the policy of what ships hardened.

---

## Further Reading

- *A Guide to Undefined Behavior in C and C++* (3-part series) — John Regehr. The canonical, accessible treatment of what UB is, why it exists, and how it bites; start here.
- *What Every C Programmer Should Know About Undefined Behavior* (3-part series) — Chris Lattner, LLVM blog. The optimizer-author's view: precisely which assumptions the compiler makes and the transformations they enable.
- [Clang UndefinedBehaviorSanitizer documentation](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html) — the authoritative list of checks, flags (`-fsanitize-trap`, `-fsanitize-minimal-runtime`, ignorelists), and runtime options.
- *Undefined Behavior: What Happened to My Code?* / the **STACK** checker — Wang, Chen, Jhala, Kaashoek et al. (APSys / SOSP). The systematic study of optimization-unstable code — UB that exists only after the optimizer runs.
- The Linux kernel's `lib/ubsan.c` and `Documentation/dev-tools/ubsan.rst` — `CONFIG_UBSAN` as the minimal-runtime, cheap-check pattern applied where there is no libc.
- `man clang`, the System V ABI, and the LLVM `compiler-rt` UBSan sources for the `__ubsan_handle_*` ABI between instrumented code and the runtime.
- See [professional.md](professional.md) for operating UBSan at organizational scale — CI matrices, fuzzing integration, and ship-time hardening policy.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/senior.md) — the memory-safety oracle UBSan must be paired with; the two combine cleanly in one binary.
- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/senior.md) — covers the data-race UB that UBSan has no check for.
- [04 — Leak Detection & Valgrind](../04-memory-leak-detection-valgrind/senior.md) — a different detection approach (DBI) and the leak class outside UBSan's scope.
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/senior.md) — `assert`, contracts, and how trap-mode UBSan generalizes "fail closed on a violated precondition."
- [Static Analysis & Linting](../../static-analysis/) — catching some UB *without running the program*, complementary to UBSan's dynamic, path-dependent view.
