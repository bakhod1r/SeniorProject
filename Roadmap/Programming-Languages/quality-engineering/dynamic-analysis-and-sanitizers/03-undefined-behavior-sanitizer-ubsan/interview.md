# UndefinedBehaviorSanitizer (UBSan) — Interview Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → UndefinedBehaviorSanitizer (UBSan)
> *A UBSan interview rarely asks "what is undefined behaviour." It asks "this code worked for a year, then `-O2` deleted your null check — explain it," and watches whether you understand that UB is a license the optimizer cashes in, not a "weird result." This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Introduction](#introduction)
3. [Prerequisites](#prerequisites)
4. [Fundamentals](#fundamentals)
5. [Check Families](#check-families)
6. [Modes, Cost & Production](#modes-cost--production)
7. [The Optimizer & UB](#the-optimizer--ub)
8. [Practice at Scale](#practice-at-scale)
9. [Scenario & Debugging](#scenario--debugging)
10. [Rapid-Fire](#rapid-fire)
11. [Red Flags / Green Flags](#red-flags--green-flags)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **UB is a premise, not a result** (the compiler *assumes it can't happen* and optimizes on that assumption — it doesn't "produce a wrong value")
- **signed vs unsigned** (signed overflow is UB; unsigned overflow is defined wraparound — only one is a finding)
- **detect vs define-away** (UBSan *reports* UB; `-fwrapv`/`-fno-strict-aliasing` *change the language* so it's no longer UB)
- **recover vs trap** (keep going and log, vs abort immediately — a CI choice and a production choice)
- **executed vs existing** (UBSan only catches UB on code paths you actually run — it is not a prover)

Nearly every question in this bank is one of those distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a flag.

---

## Introduction

UndefinedBehaviorSanitizer (UBSan) is a compiler instrumentation that catches undefined behaviour *at the moment it executes* — signed overflow, out-of-bounds shifts, null dereferences, misaligned loads, calling through a bad vptr, and a dozen more. It ships with Clang and GCC, you enable it with `-fsanitize=undefined`, and it costs a few percent rather than the 2× of AddressSanitizer.

What makes UBSan an *interview* topic rather than a flag to memorize is the conceptual layer underneath it. UB is the single most misunderstood idea in C and C++: most engineers think it means "you get a garbage value," when it actually means "the compiler is allowed to assume this never happens and rewrite your program accordingly." That gap is where the good questions live — the deleted null check, the loop the optimizer proved infinite, the bounds check that vanished on a compiler upgrade. A candidate who can explain *why* the optimizer is allowed to do that, and when to *fix the code* versus *change the language semantics* with `-fwrapv`, is operating at a different level from one who just knows the flag.

This page spans junior ("what is UB, how do you turn UBSan on") to staff ("design a sanitizer strategy across a fuzzed, CI-gated codebase that ships some checks to production as hardening").

---

## Prerequisites

You'll answer these better if you're comfortable with:

- **C/C++ at the spec level** — the difference between *unspecified*, *implementation-defined*, and *undefined* behaviour, and that the standard lists dozens of UB triggers.
- **Integer representation** — two's complement, the range of `int32_t`, why `INT_MAX + 1` is special but `UINT_MAX + 1` is not.
- **The compiler pipeline** — that optimization passes transform IR under a set of *assumptions*, and UB is one of those assumptions. (See [Build Fundamentals](../../build-systems/01-build-fundamentals/interview.md).)
- **The other sanitizers** — [ASan](../01-address-sanitizer-asan/interview.md) for memory and [TSan](../02-thread-sanitizer-tsan/interview.md) for data races; UBSan is the third leg and composes with ASan.

If "signed overflow is UB but unsigned overflow wraps" is news to you, read [junior.md](junior.md) first.

---

## Fundamentals

### Q1.1 — What is undefined behaviour, and why is it dangerous? Give the precise definition, not "you get a weird result."

> **Testing:** The single most important concept in the topic. Do you think UB means *garbage value*, or do you understand it's an *assumption the compiler optimizes on*?

**A.** Undefined behaviour is a construct for which the language standard imposes **no requirements at all** — the implementation may do *anything*. The dangerous part is not the runtime symptom; it's what the *compiler* does at build time. The optimizer is permitted to **assume UB never occurs** and to transform your code under that assumption. So `x + 1 > x` for a signed `int` folds to `true` (because signed overflow is UB, the compiler assumes it can't happen, so `x` can't be `INT_MAX`). A null check *after* a dereference gets deleted (the dereference already "proved" the pointer non-null, since dereferencing null is UB).

The framing that separates strong candidates: **UB is a premise, not a result.** It doesn't "produce" a wrong value at the point of the operation — it gives the compiler a license it cashes in *elsewhere*, often deleting safety checks far from the original line. That's why UB bugs are nonlocal, version-dependent, and terrifying: the same source compiles to safe code at `-O0` and to an exploitable binary at `-O2`, with no warning.

### Q1.2 — What is UBSan and how do you enable it?

> **Testing:** Do you know the basic mechanism and invocation, junior-level?

**A.** UBSan is a **compiler instrumentation** (Clang and GCC) that inserts runtime checks *before* potentially-undefined operations and reports when one is about to happen. You enable it at both compile and link with `-fsanitize=undefined`:

```bash
clang -fsanitize=undefined -fno-sanitize-recover=all -g -O1 prog.c -o prog
```

It's not a separate tool you run afterward — it's baked into the build, so you instrument the binary and then just *run your tests/workload*. Because the checks are inline, UBSan only catches UB on code paths that **actually execute** (it's a dynamic analysis, not a static prover). `-g` gets you file:line in reports; `-fno-sanitize-recover=all` makes the first finding abort (useful in CI).

### Q1.3 — What does a UBSan report actually look like, and what should you read off it?

> **Testing:** Have you seen real output, or only read about it?

**A.** A default UBSan report is one line per finding, pointing at the exact operation:

```
runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'
    main.c:42:13
```

You read off three things: the **check that fired** (signed integer overflow), the **operands and type** (`2147483647 + 1`, `int` — the values that triggered it), and the **location** (`main.c:42:13`). With `-fsanitize=undefined` (non-trap mode) the default is to *log and continue* (recover), so you can collect many findings in one run. Add `UBSAN_OPTIONS=print_stacktrace=1` (plus a symbolizer) to get a backtrace, which you usually want for anything beyond a trivial reproducer.

### Q1.4 — Is UB the same as a crash, an "implementation-defined" result, or an error?

> **Testing:** Whether you can place UB correctly in the taxonomy of "things that aren't fully specified."

**A.** No — they're three distinct categories. **Implementation-defined** behaviour is well-defined but varies by platform and *must be documented* (e.g., the size of `int`, the result of right-shifting a negative number is implementation-defined). **Unspecified** behaviour is a choice the implementation makes without documenting (e.g., argument evaluation order). **Undefined** behaviour has *no constraints whatsoever* — the program is meaningless, and "crash" is just one of infinitely many permitted outcomes. The dangerous outcomes are the *non*-crashes: the optimizer silently deletes a check, or the program "works" until a compiler upgrade. UBSan exists precisely because UB doesn't reliably crash — it would be far less dangerous if it did.

---

## Check Families

### Q2.1 — Name the major UBSan check families.

> **Testing:** Breadth. Do you know UBSan is a *suite* of checks, not one thing?

**A.** UBSan bundles many checks under `-fsanitize=undefined`; the headline ones:

| Check | Catches |
| --- | --- |
| `signed-integer-overflow` | `INT_MAX + 1`, `INT_MIN / -1` |
| `integer-divide-by-zero` | `x / 0`, `x % 0` |
| `shift` | shift count ≥ width, negative shift, shifting into/out of the sign bit |
| `null` | dereference / member access / method call on a null pointer |
| `alignment` | misaligned load/store (e.g., a `double` read at an odd address) |
| `bounds` | out-of-bounds index on an array of *known* size |
| `vptr` | call through a bad/wrong-type vptr (type confusion); needs RTTI |
| `object-size` | access past the end of an object (`__builtin_object_size`) |
| `return` | falling off the end of a value-returning function |
| `unreachable` | reaching a `__builtin_unreachable()` |
| `float-cast-overflow` | a float→int cast whose value doesn't fit the target |

There are more (`bool`, `enum`, `pointer-overflow`, `nonnull-attribute`, …). The key point is that it's a *menu* — you can enable the whole group or pick individual checks, e.g. `-fsanitize=signed-integer-overflow,bounds`.

### Q2.2 — Why is `signed-integer-overflow` a check but there's no "unsigned overflow" check by default?

> **Testing:** The signed-vs-unsigned distinction — a very common interview filter.

**A.** Because **signed overflow is undefined behaviour, and unsigned overflow is not.** The standard *defines* unsigned arithmetic to wrap modulo 2ⁿ — `UINT_MAX + 1 == 0` is well-defined, portable, and intentional in lots of code (hashes, checksums, ring buffers). Signed overflow has no defined result, so the compiler optimizes assuming it can't happen, which is exactly what makes it dangerous. UBSan's `signed-integer-overflow` catches the UB; there's nothing to catch on the unsigned side because there's no UB. (You *can* opt into `-fsanitize=unsigned-integer-overflow`, but it's deliberately **not** in the `undefined` group — it flags *defined* behaviour, so it's a code-smell/audit tool, not a UB detector, and it's noisy.)

### Q2.3 — Walk through the `shift` check. What exactly is undefined about shifts?

> **Testing:** Whether you know the several distinct ways a shift becomes UB.

**A.** Several conditions, all caught by `-fsanitize=shift`:
- **Shift count ≥ the operand width** — `x << 32` on a 32-bit `int` is UB (not "x << 32 == 0"). This is the classic "shift exponent N is too large" finding.
- **Negative shift count** — `x << -1` is UB.
- **Shifting a negative value left**, or shifting a 1 *into or past* the sign bit, is UB (the C rules here are subtle and were tightened across standard versions).

The dangerous instance is the width one, because on many CPUs the hardware shift instruction *masks* the count (x86 uses `count & 31`), so `x << 32` "happens" to behave like `x << 0` at `-O0` — and then the optimizer, knowing it's UB, does something else entirely at `-O2`. UBSan turns that silent disagreement into an explicit report.

### Q2.4 — The `vptr` check needs RTTI. Why, and what does it catch?

> **Testing:** Senior C++ detail — type confusion and the cost of detecting it.

**A.** `vptr` (under `-fsanitize=vptr`) catches **type confusion**: calling a virtual method or doing a polymorphic operation through a pointer whose dynamic type isn't what the static type claims — e.g., using an object after its lifetime, a bad `reinterpret_cast`, or a corrupted vtable pointer. To verify "the object at this address really is (or derives from) the expected type," UBSan reads the runtime type information attached to the vtable — so it requires **RTTI**, and it's disabled if you build with `-fno-rtti`. It also can't be combined with some setups that strip type info. It's one of the more expensive UBSan checks and one of the few that interacts with a major compiler flag, which is why it's worth calling out specifically.

### Q2.5 — UBSan's `bounds` catches some out-of-bounds accesses but not all. Where's the line, and how does it relate to ASan?

> **Testing:** Whether you understand UBSan vs ASan division of labor on memory.

**A.** UBSan's `bounds` is a **language-level** check: it fires when you index past the end of an array whose size the *compiler statically knows* — a fixed C array, a VLA — because indexing out of those is UB by the language. It does **not** track heap allocations, and it won't catch a wild pointer or a use-after-free. That's **ASan's** job: ASan is a *memory* sanitizer with shadow memory and redzones that catches heap/stack overflows, UAF, and double-free at the allocation level. So the honest answer is "UBSan `bounds` for the cases the type system pins down; **ASan** for the general memory-safety story" — and in practice you run **ASan + UBSan together** so you cover both the language-UB and the memory-corruption sides.

---

## Modes, Cost & Production

### Q3.1 — UBSan has recover, no-recover, and trap modes. Explain the difference and when you'd use each.

> **Testing:** Operational fluency — these three modes map to three real use cases.

**A.** Three behaviours for "what happens when a check fires":

- **Recover** (`-fsanitize-recover=...`, the default for most checks under `-fsanitize=undefined`): print a diagnostic and **keep running**. Good for a *survey* run — one pass surfaces many findings instead of stopping at the first. This is what gives you the full report.
- **No-recover** (`-fno-sanitize-recover=all`): print and **abort** on the first finding. This is the **CI** setting — a UBSan finding should fail the build deterministically, and you don't want it limping past the bug.
- **Trap** (`-fsanitize-trap=...` or `-fsanitize=undefined -fsanitize-trap=undefined`): no diagnostic, no runtime library — just emit an illegal instruction (`ud2`) so the process dies immediately at the UB. Tiny code-size and runtime footprint, no symbolized message. This is the mode you'd consider **shipping in production** as a hardening measure (turn UB into a controlled crash instead of an exploit).

The mental model: recover = "tell me everything," no-recover = "fail my CI," trap = "harden my release."

### Q3.2 — Why is UBSan cheap (~a few percent) when ASan is roughly 2×?

> **Testing:** Whether you understand the cost models differ because the techniques differ.

**A.** Because they instrument *different things by different means*. **ASan** maintains **shadow memory** — a parallel map of every byte's addressability — and consults it on *every load and store*, plus redzones and quarantine; that pervasive memory bookkeeping is what costs ~2× CPU and a large memory multiplier. **UBSan** inserts a small, *local* check only before *specific operations* (an add, a shift, a divide, a deref) — typically a compare-and-branch to a cold "report" path. There's no shadow memory, no allocator interception in the base case, so the overhead is usually **single-digit percent**, especially if you enable only a subset like `signed-integer-overflow,bounds`. The cheapness is exactly why some UBSan checks are viable as *always-on production hardening* while ASan is a test-time-only tool.

### Q3.3 — Which UBSan checks can ship in production, and who actually does it?

> **Testing:** Staff-level awareness that UBSan blurs the test/production line.

**A.** A curated subset of UBSan checks — typically in **trap** or **minimal-runtime** mode — is cheap and deterministic enough to ship as **runtime hardening**, turning exploitable UB into an immediate, controlled abort. Real adopters:
- **Android** compiles much of the platform with **Integer Overflow Sanitizer** (a subset of UBSan: signed/unsigned overflow, etc.) in production to neutralize a whole class of overflow-driven memory-corruption bugs.
- **Chrome** and other browsers use UBSan checks (notably bounds/overflow) as part of their defense-in-depth.
- The **Linux kernel** has UBSAN as a config option for hardened builds.

The enabling tech is `-fsanitize-minimal-runtime` (a stripped runtime, no symbolizer, tiny overhead) or trap mode. The point you want to make: UBSan is unusual among sanitizers in being *fast enough to be a security control*, not just a debugging aid — `-fsanitize=undefined` is the test posture, a hardened subset with minimal-runtime is the ship posture.

### Q3.4 — What is `-fsanitize-minimal-runtime` and when would you reach for it?

> **Testing:** Knowing the production-hardening knob specifically.

**A.** `-fsanitize-minimal-runtime` links a **stripped-down UBSan runtime**: no symbolization, no rich diagnostics, much smaller code size and overhead. You give up the friendly `file:line` report and get a terse message (or, with trap mode, just a crash). You reach for it when you want UBSan checks **in a shipping binary** as hardening — where you can't afford the full runtime's size/latency and you'd rather the program *die safely* on UB than continue into exploitable territory. For *development and CI* you'd use the full runtime (you want the detailed report); minimal-runtime is the production counterpart.

---

## The Optimizer & UB

### Q4.1 — Show me the classic "the compiler deleted my null check" example and explain why the compiler is *allowed* to.

> **Testing:** The senior differentiator — can you reason about UB from the optimizer's seat, not the programmer's?

**A.** Canonical shape:

```c
void f(int *p) {
    int x = *p;          // (1) dereference p
    if (p == NULL)       // (2) null check
        return;
    use(x);
}
```

At `-O2`, the optimizer reasons: line (1) dereferences `p`; dereferencing null is **undefined behaviour**; therefore, *in any defined execution*, `p` is non-null by the time we reach line (2). So the check `p == NULL` is provably `false` and the `return` is dead code — both get **deleted**. The "protective" null check vanishes, and a later null `p` sails straight into `use()`.

The compiler is allowed to because the standard says UB programs have no meaning, so it only has to preserve behaviour for *defined* executions — and in every defined execution the check is false. The fix is to **check before you dereference** (reorder), and UBSan's `null` check catches the dereference at runtime so you find it before the optimizer's logic bites in production. This example is the whole reason UB matters: a line you wrote *for safety* was legally deleted.

### Q4.2 — Same idea with signed overflow: why can the compiler assume `i + 1 > i` is always true, and how does that bite a loop?

> **Testing:** Whether you can connect signed-overflow UB to a real miscompilation, e.g. an unbounded loop.

**A.** For signed `int i`, the expression `i + 1 > i` looks like it should be `false` when `i == INT_MAX` (it wraps to `INT_MIN`). But signed overflow is **UB**, so the compiler assumes it never happens — meaning `i` is never `INT_MAX` at that point — so `i + 1 > i` folds to the constant **`true`**. The loop bite:

```c
for (int i = 0; i <= n; i++) { ... }   // n is int
```

The compiler may assume `i` never overflows, conclude the loop counter is *monotonically increasing without bound*, and in some cases prove the loop **can't terminate** via overflow — generating code that loops forever or that it "optimizes" in surprising ways when `n == INT_MAX`. The defined-behaviour fix is to use an **unsigned** or wider counter, or `size_t`; UBSan's `signed-integer-overflow` flags the `i++` the moment it overflows. The lesson: signed overflow isn't "wraps to a negative number," it's "the compiler builds your loop on the assumption it never wraps."

### Q4.3 — What's the "time bomb on compiler upgrade" risk, and why is it specific to UB?

> **Testing:** Whether you understand UB latency — code that's "fine" until the toolchain changes.

**A.** UB doesn't have to manifest *today*. A program with latent UB can compile to perfectly safe machine code under your *current* optimizer, because that version happened not to exploit the assumption. A **compiler upgrade** (or a new `-O` level, or a different target) can add a pass that *does* exploit it — and suddenly the null check is deleted or the loop is miscompiled, with **no source change**. That's the time bomb: the bug was always there as UB, but the *symptom* is gated on optimizer behaviour you don't control. It's specific to UB because only UB gives the compiler latitude to change observable behaviour between versions; defined code must behave consistently. This is the strongest argument for running UBSan *continuously* — you want to find latent UB while it's still dormant, not when an LLVM bump weaponizes it in a release.

### Q4.4 — `-fwrapv` and `-fno-strict-aliasing` are alternatives to "fixing" UB. Explain what they do and when they're the right call.

> **Testing:** The *detect vs define-away* distinction — and the judgment of when changing language semantics beats changing code.

**A.** These flags **redefine the language** so that what *was* UB becomes well-defined — they make the problem go away rather than detect it:
- **`-fwrapv`** tells the compiler that **signed overflow wraps** (two's-complement), exactly like unsigned. The optimizer can no longer assume `i + 1 > i`, so the deleted-check/infinite-loop class disappears. Cost: you lose some loop optimizations that relied on the no-overflow assumption.
- **`-fno-strict-aliasing`** disables type-based alias analysis, so accessing an object through an incompatible pointer type (the classic "cast a `float*` to `int*`") is no longer UB. The Linux kernel builds with this. Cost: the compiler must assume more aliasing, losing some optimizations.

When are they right? When you have a **large legacy codebase** that deliberately relies on wraparound or type-punning and you can't audit every site, defining-away is pragmatic and safe (the kernel does both). When you have a *specific, isolated* overflow that's a genuine bug, **fix the code** — don't paper over a real defect by changing global semantics. The senior framing: `-fwrapv` is a *blast-radius* tool for whole-codebase guarantees; UBSan is a *discovery* tool for finding the individual sites. They're complementary, not competing.

---

## Practice at Scale

### Q5.1 — How do you run ASan and UBSan together, and why pair them?

> **Testing:** Practical knowledge that they compose, and what each covers.

**A.** They compose in one build:

```bash
clang -fsanitize=address,undefined -fno-sanitize-recover=all -g -O1 ...
```

You pair them because they catch **disjoint bug classes** for a small combined cost. ASan owns *memory* errors (heap/stack overflow, use-after-free, double-free, leaks via LSan); UBSan owns *language* UB (overflow, shifts, alignment, null, type confusion). A single instrumented test run then guards both fronts. Caveat: **ASan and TSan are mutually exclusive** (both need exclusive control of memory/shadow), so the usual rotation is an **ASan+UBSan** build *and* a separate **TSan** build, each running the suite. The combined ASan+UBSan overhead is dominated by ASan (~2×); UBSan adds little on top.

### Q5.2 — Why is UBSan especially valuable as a *fuzzing oracle*?

> **Testing:** Staff-level — connecting sanitizers to fuzzing's "what counts as a bug" problem.

**A.** A fuzzer generates inputs fast, but it can only flag a bug it can *observe* — by default that's a crash. Plain UB usually **doesn't crash** (that's the whole danger), so a fuzzer running an uninstrumented target walks right past overflow, OOB shift, and type confusion. Compiling the fuzz target with **UBSan turns silent UB into a detectable abort** — UBSan becomes the **oracle** that tells the fuzzer "this input triggered a bug." Combined with **ASan** (memory bugs) under **libFuzzer/AFL++**, and run continuously by **OSS-Fuzz** across thousands of open-source projects, sanitizers-as-oracles are how fuzzing finds *correctness* and *security* bugs, not just hangs and segfaults. Use `-fno-sanitize-recover=all` so the first finding aborts and the fuzzer records it as a crash.

### Q5.3 — How do you gate UBSan in CI without drowning in noise or flakiness?

> **Testing:** Turning a sanitizer into a sustainable quality gate.

**A.** A few disciplines:
- **No-recover in CI** (`-fno-sanitize-recover=all`) so a finding *fails the build* deterministically — a UBSan finding that only prints is a finding everyone ignores.
- **Separate sanitizer jobs**, not one mega-build: ASan+UBSan in one, TSan in another, because they conflict and because failures are easier to triage isolated.
- **Get to green, then ratchet.** A legacy codebase lights up on first run; you either fix the backlog or use an **ignorelist** to suppress known sites, then forbid *new* findings. Never start by disabling the sanitizer.
- **Stable symbolization** (ship `llvm-symbolizer`, set `UBSAN_OPTIONS`) so reports are actionable, not hex addresses.
- **Reproducibility** — UBSan findings are deterministic given the same input (unlike TSan races), so a CI failure should reproduce locally with the same test, which keeps it from being dismissed as "flaky."

### Q5.4 — What is a UBSan ignorelist (suppression file) and when is it the right tool vs the wrong one?

> **Testing:** Whether you can use suppressions responsibly rather than as a mute button.

**A.** An **ignorelist** (`-fsanitize-ignorelist=blacklist.txt`) tells the compiler *not to instrument* specified functions, files, or types — so those sites never report. The **right** uses: a third-party header you can't change that's clean-by-design but trips a check; a deliberate, audited construct (e.g., a function that intentionally relies on wraparound) where you've decided `-fwrapv`-style local semantics; or a staged rollout where you suppress the legacy backlog to get CI green and then burn it down. The **wrong** use is silencing a *real* finding because it's inconvenient — that just re-arms the time bomb. The governance rule: every ignorelist entry needs a comment with a reason and ideally a ticket, and the list should *shrink* over time, not grow.

### Q5.5 — A teammate says "we ran UBSan and it's clean, so our code has no UB." What's wrong with that claim?

> **Testing:** The *executed vs existing* distinction — the fundamental limit of dynamic analysis.

**A.** UBSan is a **dynamic** analysis: it only catches UB on code paths that **actually executed** during the run. "Clean" means *the inputs you ran didn't trigger UB*, not *there is no UB*. An overflow on an error path, a null deref reachable only with a rare config, a shift that's only out-of-range for inputs your tests never produced — all invisible to a UBSan run that never hit them. So the honest statement is "UBSan found no UB *in the executed paths*," and the way to make that statement stronger is **coverage**: drive UBSan with a high-coverage test suite *and* a fuzzer, so "executed" approaches "exists." Static analyzers and `-fwrapv`-style define-aways cover different parts of the gap. Anyone who treats a clean UBSan run as a *proof* of UB-freedom doesn't understand what dynamic analysis can promise.

---

## Scenario & Debugging

### Q6.1 — You get `shift exponent 34 is too large for 32-bit type 'int'`. What's wrong, and how do you fix it?

> **Testing:** Reading a real UBSan message and reasoning to the root cause.

**A.** You shifted a 32-bit `int` by **34 bits**, and a shift count **≥ the operand's width (32)** is undefined behaviour — that's `-fsanitize=shift` firing. The deceptive part: on x86 the hardware masks the count (`34 & 31 == 2`), so unsanitized it may *look* like `x << 2` and "work," which is exactly why it lurked. Root causes, in order: an off-by-something in a computed shift count; building a mask like `1 << bits` where `bits` can reach 32+ (very common when iterating to `<= width`); or shifting a 32-bit value when you meant 64-bit. Fixes: **clamp/validate the shift count** before shifting; **widen the operand** to 64-bit if you legitimately need ≥32 bits (`1ULL << bits`); or correct the loop bound. The general fix is never "mask the count to hide it" — that's defining-away a logic bug.

### Q6.2 — UBSan reports `signed integer overflow` inside a hash function, but the wraparound is *intentional* — it's how the hash is specified. Fix, `-fwrapv`, or annotate?

> **Testing:** The capstone judgment question — choosing the right response to a *false-positive-shaped* finding that's actually defined-intent-on-undefined-construct.

**A.** This is the case where the *behaviour* is intended but the *mechanism* is UB — the hash relies on wraparound, but it's written on **signed** integers, where overflow is undefined. UBSan is correct: it's real UB, even though the author's intent is benign. Three options, best-first:

1. **Fix the code — switch to `unsigned`.** Unsigned overflow is *defined* to wrap, which is exactly what the hash wants. This makes the intent explicit, removes the UB entirely, and needs no flags. This is almost always the right answer: the operation *should* have been unsigned in the first place.
2. **`-fwrapv`** — defines signed overflow to wrap *globally*. Correct semantics, but it's a blunt, whole-translation-unit instrument and it silently changes optimization for *all* signed arithmetic, not just this hash. Reasonable for a legacy codebase full of such patterns; overkill for one function.
3. **Annotate / suppress** — `__attribute__((no_sanitize("signed-integer-overflow")))` on the function (or an ignorelist entry). This *hides the report* but leaves the UB in place — the optimizer can still bite. Only acceptable as a last resort when you genuinely can't change the type and have audited that the current compiler is safe.

The senior signal is ranking them: **change the type** to make the wraparound *defined*, don't just silence the *detector* of UB you've left in the code.

### Q6.3 — A binary is clean at `-O0` with UBSan but the *production* `-O2` build misbehaves with no UBSan report. How do you investigate?

> **Testing:** Whether you know UB symptoms are optimization-dependent and how to chase them.

**A.** This smells like **latent UB the optimizer is exploiting at `-O2`** that your `-O0` UBSan run didn't trigger (different codegen, different executed paths, or a check the optimizer assumed-away before UBSan could instrument it). Investigation:
1. **Run UBSan *at `-O2`*, not just `-O0`** — `clang -fsanitize=undefined -O2`. UBSan instrumentation interacts with optimization, and some UB only appears in the optimized path; the report may show up at `-O1`/`-O2` when it didn't at `-O0`.
2. **Bisect the optimization level** — does it break at `-O1`? `-O2`? — to localize which class of pass is involved.
3. **Try `-fwrapv` / `-fno-strict-aliasing`** as a diagnostic: if `-fwrapv` makes the `-O2` build behave, you've got a **signed-overflow** UB; if `-fno-strict-aliasing` fixes it, it's a **type-punning/aliasing** UB. That's a fast way to *classify* the UB even before you find the exact line.
4. Then **find and fix the actual site** UBSan points to (or that the flag implicates) — don't ship with the define-away flag as the "fix" unless it's a deliberate codebase-wide policy.

The mindset: an `-O0`-clean / `-O2`-broken split is the *signature* of UB, so the first move is to widen UBSan's view (run it optimized) rather than assume it's a compiler bug.

### Q6.4 — Your service crashes with a UBSan `null` finding only under production load, never in tests. How do you make it reproducible?

> **Testing:** Bridging dynamic analysis to a real, load-dependent bug.

**A.** The crash is real (UBSan turned a null deref into a clean abort instead of a silent corruption — that's a win), but tests don't hit the path. To reproduce:
1. **Capture the trigger** — get `UBSAN_OPTIONS=print_stacktrace=1` with a symbolizer wired up in the production build so the crash gives you a *backtrace*, not just a line; that tells you the call path that reached the null.
2. **Pull the inputs/config** for that path from logs and turn them into a **targeted test** — the value is null only under some condition (a cache miss, a failed upstream call returning null), so reproduce *that condition*.
3. **Fuzz the entry point** with UBSan on if the input space is large — the fuzzer will rediscover the null-producing input fast once UBSan is the oracle.
4. **Fix at the source** — add the missing null check *before* the deref (and recall Q4.1: at `-O2` the compiler may have *deleted* a check placed after the deref, so order matters). UBSan stays on in CI to keep the regression from returning.

The point: a sanitizer crash under load is a *gift* — it pinpoints the operation; the work is recreating the *condition*, which is a coverage/observability problem, not a UBSan problem.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: One flag to turn UBSan on?** A: `-fsanitize=undefined` at compile and link.
- **Q: Signed or unsigned overflow is UB?** A: **Signed** is UB; unsigned is defined wraparound.
- **Q: Roughly what's UBSan's overhead?** A: A few percent — single digits — versus ASan's ~2×.
- **Q: What does trap mode emit?** A: An illegal instruction (`ud2`), no diagnostic, no runtime — the process just dies at the UB.
- **Q: Which check needs RTTI?** A: `vptr` (type-confusion) — it reads runtime type info, so `-fno-rtti` disables it.
- **Q: What does `-fno-sanitize-recover=all` do?** A: Aborts on the first finding instead of logging-and-continuing — the CI setting.
- **Q: ASan + UBSan in one build?** A: Yes — `-fsanitize=address,undefined`. ASan + TSan, no (mutually exclusive).
- **Q: Does `-fsanitize=undefined` include unsigned overflow?** A: No — `unsigned-integer-overflow` is separate and opt-in because it's not UB.
- **Q: What does `-fwrapv` do?** A: Defines signed overflow to wrap, removing that UB (and the optimizations that depended on it).
- **Q: UBSan vs ASan for out-of-bounds?** A: UBSan `bounds` for arrays of *known* size; ASan for heap/stack overflow and use-after-free.
- **Q: Why is a clean UBSan run not a proof of UB-freedom?** A: It's dynamic — it only sees *executed* paths, so coverage gates the guarantee.
- **Q: Which company ships UBSan-style checks in production?** A: Android (Integer Overflow Sanitizer), plus Chrome and the Linux kernel (UBSAN config) for hardening.
- **Q: What flag shrinks the runtime for shipping?** A: `-fsanitize-minimal-runtime`.
- **Q: Why does UBSan make a good fuzzing oracle?** A: It turns silent UB into a detectable abort, so the fuzzer can recognize it as a bug.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Defining UB as "you get a weird/garbage value" — missing that it's an *optimizer assumption*.
- Thinking unsigned overflow is UB, or that signed and unsigned wrap the same way by the standard.
- Treating `-fwrapv` as "the fix for overflow bugs" — confusing *defining-away* with *fixing*.
- Claiming a clean UBSan run proves there's no UB — ignoring that it only sees executed paths.
- Saying UBSan and ASan are redundant, or that you can run ASan+TSan together.
- Silencing a real finding with an ignorelist/`no_sanitize` and calling it resolved.
- Surprised that a compiler upgrade "broke working code" — not recognizing the latent-UB time bomb.

**Green flags:**
- Leading with "UB is a premise the optimizer cashes in," and giving the deleted-null-check example unprompted.
- Distinguishing **detect** (UBSan) from **define-away** (`-fwrapv`/`-fno-strict-aliasing`) and saying when each is right.
- Knowing UBSan is cheap *because* it's local checks, not shadow memory — and that this is what makes production hardening viable.
- Naming the executed-vs-existing limit and pairing UBSan with a fuzzer to close it.
- For the hash-wraparound scenario, choosing "switch to unsigned" over `-fwrapv` over suppression — and *ranking* them.
- Reaching for "run UBSan at `-O2`" when `-O0` is clean but the release misbehaves.
- Caveating tradeoffs ("trap mode hardens the release *but* you lose the symbolized report").

---

## Cheat Sheet

```bash
# Survey run (collect all findings, with backtraces)
clang -fsanitize=undefined -g -O1 prog.c -o prog
UBSAN_OPTIONS=print_stacktrace=1 ./prog

# CI gate (abort on first finding)
clang -fsanitize=undefined -fno-sanitize-recover=all -g -O1 prog.c -o prog

# Pair with ASan (memory + UB in one build)
clang -fsanitize=address,undefined -fno-sanitize-recover=all -g -O1 ...

# Production hardening (trap, minimal runtime)
clang -fsanitize=undefined -fsanitize-trap=undefined -fsanitize-minimal-runtime -O2 ...

# Pick specific checks
clang -fsanitize=signed-integer-overflow,bounds,shift,null ...

# Define-away (change semantics instead of detecting)
clang -fwrapv ...                 # signed overflow wraps
clang -fno-strict-aliasing ...    # type-punning no longer UB
```

| Concept | One-liner |
| --- | --- |
| UB | A *premise* the optimizer assumes never happens — not a "wrong value." |
| Signed overflow | **UB** (catch with `signed-integer-overflow`). Unsigned = defined wrap. |
| recover / no-recover / trap | "tell me everything" / "fail CI" / "harden release." |
| Cost | Few percent (local checks, no shadow memory) vs ASan ~2×. |
| `vptr` | Type confusion; needs **RTTI** (`-fno-rtti` disables). |
| UBSan vs ASan | Language UB vs memory corruption — run both. |
| `-fwrapv` | *Define-away* signed-overflow UB; UBSan *detects* it. |
| Fuzzing oracle | UBSan turns silent UB into a detectable abort. |
| Dynamic limit | Only catches **executed** UB — coverage gates the guarantee. |

---

## Summary

- The bank reduces to a few distinctions in costumes: **premise vs result** (UB is an optimizer assumption, not a garbage value), **signed vs unsigned** (only signed overflow is UB), **detect vs define-away** (UBSan reports; `-fwrapv` changes semantics), **recover/trap** (survey / CI / harden), and **executed vs existing** (dynamic analysis only sees the paths you run). Name the distinction first; the flag follows.
- **Fundamentals:** UB lets the compiler delete checks and miscompile under the assumption it can't happen — nonlocal, version-dependent, and silent. UBSan inserts inline runtime checks; enable with `-fsanitize=undefined`; a report names the check, operands+type, and location.
- **Check families:** signed-overflow, divide-by-zero, shift (count ≥ width), null, alignment, bounds (known-size arrays), vptr (needs RTTI), object-size, return, unreachable, float-cast-overflow. Unsigned overflow is *not* in the group because it isn't UB.
- **Modes & cost:** recover (survey) / no-recover (CI) / trap (harden); UBSan is cheap because it's local checks, not shadow memory — cheap enough that Android, Chrome, and the kernel ship a hardened subset via `-fsanitize-minimal-runtime`.
- **Optimizer angle:** the deleted-null-check and `i + 1 > i` examples show UB as a license the optimizer cashes in; latent UB is a time bomb on compiler upgrade; `-fwrapv`/`-fno-strict-aliasing` *define-away* whole classes when fixing every site isn't feasible.
- **At scale:** pair ASan+UBSan; use UBSan as a fuzzing oracle (OSS-Fuzz); gate in CI with no-recover; manage backlog with a *shrinking* ignorelist; never mistake a clean run for proof.
- **Debugging:** read the message (shift count ≥ width → clamp or widen; intended wraparound → switch to **unsigned**, not `-fwrapv`-or-suppress); when `-O0` is clean but `-O2` breaks, run UBSan *at `-O2`* and use the define-away flags to *classify* the UB.

---

## Further Reading

- **Clang UBSan documentation** — `clang.llvm.org/docs/UndefinedBehaviorSanitizer.html`. The authoritative list of every check, flag, and the recover/trap/minimal-runtime modes.
- **John Regehr — "A Guide to Undefined Behavior in C and C++"** (the three-part series) and the LLVM blog's "What Every C Programmer Should Know About Undefined Behavior." The canonical explanation of *why* the optimizer exploits UB.
- **Chris Lattner — "What Every C Programmer Should Know About Undefined Behavior"** (LLVM blog, 3 parts) — the deleted-check and overflow examples from the compiler author's seat.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — junior grounds the vocabulary; senior covers the production-hardening and CI-strategy depth these answers reference.
- `man clang`, the GCC `-fsanitize` documentation, and the **Android "Integer Overflow Sanitizer"** docs — primary sources for the flags and the production story.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/interview.md) — the memory sanitizer UBSan pairs with; covers the out-of-bounds/use-after-free side UBSan doesn't.
- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/interview.md) — the data-race sanitizer; mutually exclusive with ASan, so it runs in a separate build from ASan+UBSan.
- [04 — Leak Detection & Valgrind](../04-memory-leak-detection-valgrind/interview.md) — the older instrumentation approach and how it contrasts with compile-time sanitizers.
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/interview.md) — UBSan as machine-checked contracts on integer/pointer operations.
- [Static Analysis & Linting](../../static-analysis/) — the complementary *static* path to catching some UB before it ever executes.
