# UndefinedBehaviorSanitizer (UBSan) — Professional Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → UndefinedBehaviorSanitizer (UBSan)
> *The senior page taught you what each check catches and how the instrumentation works. This page is about the property that makes UBSan unique among sanitizers — it is cheap enough to live *everywhere*, including production — and the judgment that turns that into a strategy: which checks ship in a hardened kernel, how you survive the first 3,000 signed-overflow findings, and why a compiler upgrade three years from now is the real threat you're instrumenting against.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why UBSan Is the Cheap Sanitizer, and Why That Changes the Strategy](#core-concept-1--why-ubsan-is-the-cheap-sanitizer-and-why-that-changes-the-strategy)
5. [Core Concept 2 — UBSan in Production as a Security-Hardening Control](#core-concept-2--ubsan-in-production-as-a-security-hardening-control)
6. [Core Concept 3 — Rollout to a Large C/C++ Codebase: Surviving the Flood](#core-concept-3--rollout-to-a-large-cc-codebase-surviving-the-flood)
7. [Core Concept 4 — The Time-Bomb Problem and Compiler-Upgrade Risk](#core-concept-4--the-time-bomb-problem-and-compiler-upgrade-risk)
8. [Core Concept 5 — Detect vs Define-Away: `-fwrapv` and `-fno-strict-aliasing`](#core-concept-5--detect-vs-define-away--fwrapv-and--fno-strict-aliasing)
9. [Core Concept 6 — UBSan as a Fuzzing Oracle at Scale](#core-concept-6--ubsan-as-a-fuzzing-oracle-at-scale)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Operating UBSan as an org-wide control that spans dev, CI, fuzzing, *and production* — where the choice of which checks to enable is a security, performance, and portability decision.**

The senior page framed UBSan as a debugging tool you turn on to catch undefined behavior. At the professional level the defining fact about UBSan is economic: its instrumentation is *cheap*. AddressSanitizer needs ~2× memory and a shadow-memory scheme that makes it a dev/CI tool you cannot ship. ThreadSanitizer is 5–15× and effectively dev-only. UBSan's checks are mostly a comparison and a branch inserted before an arithmetic op or a memory access — single-digit-percent overhead for the cheap subset, and *zero* runtime cost beyond the trap instruction when you compile with `-fsanitize-trap`. That one property unlocks a deployment surface no other sanitizer has: a hardened UBSan subset runs in *shipping* Android, in Chrome, and in the mainline Linux kernel (`CONFIG_UBSAN`) as a live exploit-mitigation control.

So the staff-level questions are different from "how do I find this bug." They are: *which* checks are safe and cheap enough to compile into the production fleet, and which are not? When we turn `-fsanitize=undefined` on across a ten-million-line C++ codebase and get a flood of findings, which are real bugs and which are intended wraparound we should `-fwrapv` away? How do we defend against the latent UB that today's compiler tolerates but next year's optimizer will weaponize into a deleted security check? And how does UBSan plug into the fuzzing fleet as a correctness oracle, the way OSS-Fuzz runs it on thousands of projects? This page is the judgment layer on top of a tool you already know how to invoke.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — the UBSan check families, `-fsanitize=undefined` vs the individual checks, `-fno-sanitize-recover`, how the instrumentation lowers to a check + a call into `libubsan`.
- **Required:** A working model of *what undefined behavior is* and why the optimizer is allowed to assume it never happens — signed overflow, OOB, strict aliasing, shift-by-width, null deref, `-fsanitize=undefined`'s relationship to the C/C++ standard.
- **Helpful:** You've operated a fuzzing target (libFuzzer/AFL++) or consumed OSS-Fuzz findings.
- **Helpful:** You've been through a toolchain upgrade (GCC/Clang major bump) on a large native codebase and watched behavior change.
- **Helpful:** Familiarity with build-time hardening flags (PIE, RELRO, FORTIFY) — UBSan-trap is a peer mitigation, covered in the build-fundamentals tier of [Build Systems](../../build-systems/01-build-fundamentals/professional.md).

---

## Glossary

| Term | Meaning |
|---|---|
| **Cheap subset** | The UBSan checks with single-digit-percent overhead and no semantic side effects, safe for production: `signed-integer-overflow`, `bounds`/`array-bounds`, `object-size`, `shift`, `vla-bound`, `null` (with caveats). |
| **`-fsanitize-trap`** | Lower each failed check to a trap instruction (`ud2` / `brk`) instead of a diagnostic call. No runtime library, no message — just a deterministic SIGILL/SIGTRAP. The production-hardening mode. |
| **`-fsanitize-minimal-runtime`** | A tiny runtime (used by Android/Chrome) that prints a one-line `ubsan: <check>` and aborts, without the full `libubsan` symbolizer. Smaller attack surface and footprint than the full runtime. |
| **`-fno-sanitize-recover`** | Abort on first finding instead of logging and continuing. The CI/fuzzing default; the full runtime defaults to *recover* (log-and-continue) for most checks. |
| **Trap-on-UB** | The security-hardening pattern: convert exploitable UB (an OOB write, a type confusion) into an immediate controlled crash, denying the attacker a primitive. |
| **`-fwrapv`** | A dialect flag that *defines* signed integer overflow as two's-complement wraparound, removing the UB entirely. Not a detection — a redefinition of the language. |
| **`-fno-strict-aliasing`** | A dialect flag that tells the optimizer not to assume pointers of different types don't alias, defusing type-based aliasing UB org-wide. |
| **Ignorelist** (a.k.a. suppression/sanitizer-blacklist) | A `-fsanitize-ignorelist=` file that exempts named functions/files/types from instrumentation — the ratchet you use to baseline a legacy codebase. |
| **Time-bomb UB** | Latent undefined behavior that the current compiler happens to compile "the way you meant," but a future optimizer is free to miscompile. UBSan + fuzzing is the defense. |
| **Fuzzing oracle** | A detector that turns a silent-but-wrong execution into an observable crash, giving the fuzzer a signal to optimize against. UBSan is a *correctness* oracle; ASan is a *memory-safety* oracle. |

---

## Core Concept 1 — Why UBSan Is the Cheap Sanitizer, and Why That Changes the Strategy

Every other sanitizer forces a placement decision dominated by cost. ASan's shadow memory roughly doubles RSS and adds redzones to every allocation; you run it in CI and on fuzzers, never in prod. TSan's happens-before tracking is 5–15× slower and balloons memory; it is a pre-merge gate at best. MSan needs the *entire* dependency tree instrumented or it lies. These costs define where each tool can live.

UBSan is the exception, and the cost asymmetry is the whole strategy. Most UBSan checks lower to a constant amount of work right before an operation the compiler was going to emit anyway:

```c
int32_t a, b;
int32_t c = a + b;        // becomes, conceptually:
// if (__builtin_add_overflow(a, b, &c)) __ubsan_handle_add_overflow(...);
```

The branch is almost always not-taken, so the branch predictor eats it, and modern CPUs have spare issue slots for the comparison. Measured overhead for the *cheap subset* (signed overflow, bounds, object-size, shift) is typically in the low single-digit percent on real workloads — and with `-fsanitize-trap` there is no call, no runtime library, and no message-formatting cost at all: a passing check is a predicted-not-taken branch, a failing check is a single trap instruction.

That economics is *why UBSan can be everywhere*:

| Environment | UBSan posture | Mode |
|---|---|---|
| **Developer build** | Broad `-fsanitize=undefined`, full diagnostics with file/line/values | full runtime, `-fno-sanitize-recover` for fast feedback |
| **CI** | Broad set on the test suite, fail the build on any finding | full runtime, `-fno-sanitize-recover`, symbolized |
| **Fuzzing** | Cheap + logic checks as an oracle, abort to register a crash | `-fno-sanitize-recover`, paired with ASan/libFuzzer |
| **Production** | *Hardened subset only*, trap on violation | `-fsanitize-trap` / `-fsanitize-minimal-runtime` |

> **The staff insight:** with ASan you are forced to ask "where can I afford to run this?" With UBSan you ask the *opposite* question — "is there any environment where I should *not* run at least a subset?" — and the honest answer for the cheap, exploit-relevant checks is increasingly "no, ship them." UBSan is the only sanitizer that is also a *production mitigation*, and treating it purely as a debugging tool leaves the most valuable deployment on the table.

---

## Core Concept 2 — UBSan in Production as a Security-Hardening Control

This is the distinctive UBSan story. Undefined behavior is not just a correctness bug — a large fraction of it is *exploitable*. An out-of-bounds write is a memory-corruption primitive. A type confusion via strict-aliasing UB is the foundation of many browser exploits. Signed-overflow UB in a length or index calculation is how a bounds check gets bypassed. The attacker's whole game is steering the program through one of these undefined states into a controlled corruption.

UBSan-trap inverts that. Compile the security-sensitive code with a hardened subset and `-fsanitize-trap`, and the *first* time execution hits the undefined operation, the CPU executes a trap instruction and the process dies cleanly — *before* the OOB write lands, *before* the confused type is dereferenced. You have converted an exploit primitive into a denial-of-service-at-worst crash. That is exactly the bargain stack canaries, RELRO, and CFI make: trade a clean crash for an exploitable condition.

This is not theoretical. It ships:

- **The Linux kernel** has `CONFIG_UBSAN` with `CONFIG_UBSAN_TRAP` and a curated, fast subset (`CONFIG_UBSAN_BOUNDS`, `CONFIG_UBSAN_SHIFT`, and notably `CONFIG_UBSAN_BOUNDS` for the `__counted_by` annotated arrays driving the array-bounds hardening work). On a violation it panics or oopses rather than corrupting kernel memory.
- **Android** compiles large parts of the platform and the media stack with `-fsanitize-minimal-runtime` for `integer-overflow` and `bounds` — a direct response to the Stagefright era of codec memory-corruption bugs.
- **Chrome** ships UBSan-derived bounds and type checks in production builds as part of its defense-in-depth.

The judgment is *which* checks earn a place in prod. They must be cheap, must be semantically safe (no false positives that would crash correct code), and must catch exploit-relevant UB:

| Check | Prod-trap candidate? | Why / caveat |
|---|---|---|
| `signed-integer-overflow` | **Yes** | Cheap; overflow in size/index math is a classic bypass. *But* you must first eliminate intended wraparound (see Concept 5) or it crashes correct code. |
| `bounds` / `array-bounds` | **Yes** | Directly stops OOB; the kernel's flagship hardening check. |
| `object-size` (`-fsanitize=object-size`) | **Yes** | FORTIFY-style; catches writes past a known-size object. |
| `shift` (shift-by-≥width) | **Yes** | Cheap; shift UB shows up in codecs/crypto. |
| `null` | **Careful** | Cheap, but a deliberate `(volatile int*)0` MMIO pattern or a hot null-checked path can fire; scope it. |
| `unsigned-integer-overflow` | **No** | *Not UB* — perfectly defined wraparound. Enormous false-positive rate (hashes, counters). Never ship; rarely even worth in CI. |
| `alignment`, `float-cast-overflow`, `vptr` | **No** | `vptr` needs the full runtime + RTTI and is expensive; the others are noisy or costly. Dev/CI only. |

> **The principle:** a production UBSan build is a *security control*, not a debugger. You pick the smallest set of cheap checks that turn the most-exploitable UB into a controlled crash, ship them with `-fsanitize-trap`, and you *never* include a check that can fire on correct code (the whole point is that the crash means "an attacker, or a real bug, just tried something"). Wiring the trap to your crash-reporting pipeline turns those production aborts into a high-signal bug feed — every trap is either an attack attempt or a latent bug your fuzzer missed.

---

## Core Concept 3 — Rollout to a Large C/C++ Codebase: Surviving the Flood

Turning `-fsanitize=undefined` on across a mature codebase produces a predictable disaster if you do it naively: a flood of findings dominated by *integer overflow*, most of which the original authors consider correct. The number-one rollout mistake — drowning in noise — comes from two specific sources, and the cure is to separate them up front.

**Source one: `unsigned-integer-overflow`, which is not even UB.** Unsigned wraparound is *defined* in C and C++ — it is the intended behavior of hashes, ring buffers, PRNGs, checksums, and `size_t` arithmetic. UBSan can check it (it's a non-default check), but it has no business in a UB-finding rollout. If you enabled the umbrella `-fsanitize=integer` instead of `-fsanitize=undefined`, you pulled it in by accident. **Step zero of any rollout: confirm you are running `-fsanitize=undefined` (UB only), not `-fsanitize=integer` (UB + defined-but-suspicious).**

**Source two: `signed-integer-overflow` that is *technically* UB but *intentionally* wraparound.** This is the real work. Signed overflow *is* undefined, but a lot of pre-existing code relies on it wrapping — hash mixers, `INT_MAX + 1` saturation idioms, ad-hoc fixed-point math written before anyone cared. UBSan correctly flags every one. Now you have a triage problem, and for each finding you must decide between three outcomes:

```
Finding: "signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'"
   ├─ Intended wrap, hot, hard to change       → -fwrapv (this file/TU) or annotate
   ├─ Intended wrap, isolated                   → rewrite with explicit unsigned or __builtin_add_overflow
   └─ A real bug (overflow you didn't expect)   → FIX (this is the gold UBSan finds)
```

The mechanics that make a large rollout tractable:

1. **Scope the checks before you scope the code.** Start with the cheap, high-signal set: `signed-integer-overflow,bounds,object-size,shift`. Leave the noisy/expensive ones (`alignment`, `vptr`, `float-cast-overflow`, and *never* `unsigned-integer-overflow`) off until the core set is green.
2. **Baseline with an ignorelist, then ratchet.** Generate a `-fsanitize-ignorelist=ubsan_baseline.txt` that exempts the currently-failing functions/files, so the build goes green immediately:
   ```
   # ubsan_baseline.txt — entries are PAID-DOWN over time, never added to
   fun:legacy_hash_mix
   src:third_party/oldcodec/*
   ```
3. **Gate on *new*.** The CI gate is not "zero findings" on day one — it's "no *new* findings." Any code path not on the ignorelist must be clean. The ignorelist only shrinks; a PR that adds an entry needs a sign-off and a ticket. This is the same ratchet pattern as a static-analysis baseline (see [Static Analysis & Linting](../../static-analysis/)).
4. **Apply `-fwrapv` surgically, not globally — at first.** Where a whole subsystem is built on intended wraparound (a crypto core, a codec), `-fwrapv` on that translation unit is legitimate and removes the findings *correctly* (it makes the behavior defined). Reserve the *org-wide* `-fwrapv` decision for Concept 5.

> **The staff move:** the goal of the rollout is not "zero UBSan findings" — it is "every *new* line of code is UBSan-clean, and the baseline of intended-wrap exemptions only ever shrinks." A team that demands day-one zero either disables the useful checks or `-fwrapv`s the whole tree reflexively, throwing away the signal. A team that gates-on-new turns UBSan into a steady downward ratchet on real UB while paying down the legacy exemptions on its own schedule.

---

## Core Concept 4 — The Time-Bomb Problem and Compiler-Upgrade Risk

This is the argument that makes UBSan strategic rather than tactical, and it is the one most engineers underweight. The danger of undefined behavior is not what your *current* compiler does with it — your current compiler probably compiles it "the way you meant." The danger is that the standard grants the optimizer permission to assume UB *never happens*, and a *future* compiler is free to exploit that assumption in ways that delete your code.

The canonical shape: a security or safety check written in terms of an operation that is UB on overflow.

```c
// A length check the author believed was safe:
if (len + headroom < len)        // "did the addition overflow? then reject"
    return -E2BIG;
```

`len + headroom < len` can only be true if the signed addition overflowed. But signed overflow is UB, so the optimizer is entitled to reason: "overflow is undefined, undefined never happens, therefore `len + headroom` is always `>= len`, therefore this branch is dead" — and **delete the check entirely**. Your overflow guard compiles to nothing. The code worked for years on GCC 4.x; you upgrade to a newer compiler with a smarter value-range analysis, and the check silently vanishes. Nothing in your test suite notices, because the inputs that overflow were never in the suite. This is a *latent miscompilation armed by a compiler upgrade* — a time bomb.

UBSan is the defense, in two ways:

1. **UBSan makes the bomb *audible* before it detonates.** Run the suite (and the fuzzer) under `-fsanitize=signed-integer-overflow` and the *moment* `len + headroom` overflows, UBSan fires — on the current compiler, today, regardless of whether the optimizer has started exploiting it yet. You find the UB while it is still benign and rewrite the check to be overflow-safe (`__builtin_add_overflow`, or do the math in a wider/unsigned type).
2. **UBSan + fuzzing is the *systematic* defense.** You cannot manually audit a large codebase for every UB time bomb. But a fuzzer driving UBSan-instrumented code will, over millions of executions, *reach* the overflowing inputs and trip the check — converting latent UB into a reported crash. This is precisely why a compiler-upgrade program on a serious native codebase is gated on a clean UBSan-under-fuzzing run, not just "the tests pass."

> **The risk-management framing:** treat every major compiler upgrade as a *risk event for latent UB*, and treat your UBSan-under-fuzzing corpus as the control that retires that risk. The question to ask before a GCC/Clang major bump is not "do the tests still pass" — they will — but "have we run the fuzzers under UBSan long enough to be confident no security check is sitting on undefined behavior the new optimizer will start exploiting?" The teams that get burned by upgrade-induced miscompilations are the ones that had no UBSan oracle and discovered the deleted check in production.

---

## Core Concept 5 — Detect vs Define-Away: `-fwrapv` and `-fno-strict-aliasing`

There is a second, philosophically different way to deal with UB: instead of *detecting and fixing* it, you can *change the language* so the construct is no longer undefined. Two dialect flags do this org-wide:

- **`-fwrapv`** defines signed integer overflow as two's-complement wraparound. After `-fwrapv`, `INT_MAX + 1` is `INT_MIN`, fully defined, and the optimizer may no longer assume overflow can't happen. The entire class of signed-overflow UB *ceases to exist*.
- **`-fno-strict-aliasing`** tells the optimizer not to assume that pointers of different types never alias. After it, the type-punning and aliasing patterns that are UB under the standard become defined-enough that the optimizer won't miscompile them. (The Linux kernel is famously built with `-fno-strict-aliasing` for exactly this reason.)

This is a genuine fork in the road, and the trade-offs are real:

| Axis | Detect + Fix (UBSan) | Define-away (`-fwrapv` / `-fno-strict-aliasing`) |
|---|---|---|
| **Correctness** | Code becomes standard-conforming; portable to *any* conforming compiler | Code depends on a non-standard dialect; breaks if built without the flag |
| **Performance** | No cost in the shipping (non-sanitized) build | `-fwrapv` blocks loop optimizations that rely on no-overflow (e.g. promoting `int` induction vars); `-fno-strict-aliasing` blocks load/store reordering. Measurable in hot loops. |
| **Effort** | High up front — you must triage and rewrite every finding | Low — one flag, the whole class is gone |
| **Risk** | Low residual — you've actually removed the UB | You're "no longer writing standard C." A new build target, a vendored library built without the flag, or a teammate who drops it re-arms everything. |
| **Portability** | Maximal | Minimal — the code is correct *only* under your dialect |

The mature resolution is not all-or-nothing:

- **Prefer detect-and-fix for *new* code and for *security-sensitive* code.** Code that does index/length math, or that anyone might port, should be genuinely overflow-safe, not dialect-dependent.
- **`-fwrapv` is legitimate as a *scoped* tool** for a subsystem genuinely built on wraparound (hash, crypto, some DSP) where rewriting is high-cost and low-value — applied per translation unit, documented, and ideally still fuzzed.
- **`-fno-strict-aliasing` is a defensible *org-wide* default** for codebases that do a lot of low-level type punning (kernels, allocators, serializers) and value robustness over the last few percent of optimizer aggression — but it is a real performance and "we've left standard C" decision, made once, at the platform level, with eyes open.

> **The trap to avoid:** reaching for *global* `-fwrapv` the instant the signed-overflow findings appear, because it's the one-flag way to make the noise stop. It does make the noise stop — by *defining away the very thing UBSan was telling you about*, including the genuine bugs mixed in with the intended wraparound. You've silenced the smoke detector instead of putting out the fire. Define-away is a deliberate dialect choice with a performance and portability bill, not a reflex for clearing a CI queue.

---

## Core Concept 6 — UBSan as a Fuzzing Oracle at Scale

A fuzzer is only as good as its *oracle* — the thing that tells it "this input triggered a bug." With no oracle beyond "did it crash," a fuzzer finds only inputs that already segfault. The power move is to *add oracles* that turn silent-but-wrong executions into crashes the fuzzer can latch onto. ASan is the memory-safety oracle. **UBSan is the *correctness* oracle**: it makes the fuzzer's reach extend to every undefined operation, not just the ones that happen to corrupt memory visibly.

This is why **OSS-Fuzz builds targets with UBSan** alongside ASan, and why a shift-by-width or signed-overflow bug that no human would ever spot by reading code gets found in hours of fuzzing. The combination is multiplicative:

- **Fuzzer** supplies the rare, adversarial inputs that reach deep code paths and edge conditions.
- **UBSan** (`-fno-sanitize-recover`) aborts the *instant* one of those paths executes UB, converting "ran, returned a subtly wrong value, no crash" into a crash with a precise `runtime error: shift exponent 32 is too large for 32-bit type` and a stack trace.
- **The corpus** accumulated this way is also your compiler-upgrade insurance (Concept 4): it's a body of inputs known to exercise the UB-adjacent paths.

Practical wiring, the way real fuzzing fleets run it:

```bash
# Fuzz target with BOTH oracles: memory safety (ASan) + correctness (UBSan)
clang++ -g -O1 -fsanitize=fuzzer,address,undefined \
        -fno-sanitize-recover=undefined \
        decoder_fuzzer.cc -o decoder_fuzzer
./decoder_fuzzer corpus/
# A UBSan finding aborts → libFuzzer saves the crashing input → triage like any crash
```

Two scaling notes that separate a working fuzzing program from a noisy one:

- **`-fno-sanitize-recover` is mandatory under fuzzing.** The full runtime's default is *recover* (log and continue). A recovering UBSan won't abort, so libFuzzer never registers the crash and the bug is invisible. You must force abort-on-finding.
- **Drop `unsigned-integer-overflow` (and other non-UB noise) from the fuzzing oracle**, for the same reason as in the codebase rollout: it floods the fuzzer with "crashes" that are correct behavior, wasting the campaign on triaging non-bugs.

> **The leverage:** UBSan transforms a fuzzer from a memory-corruption finder into a *general undefined-behavior* finder at near-zero added cost — the same fuzzing infrastructure, one extra `-fsanitize=undefined`, and suddenly shift-by-width, signed-overflow, and OOB-read bugs that never visibly corrupt memory become first-class findings. For any codec, parser, or crypto primitive, fuzzing *without* UBSan as an oracle is leaving the cheapest, highest-yield class of bugs on the table.

---

## War Stories

**The compiler upgrade that deleted a security check.** A networking codebase had a length-validation guard of the classic `if (a + b < a) reject();` form, relying on signed overflow to detect a malicious length. It worked for years. A major Clang upgrade brought a sharper value-range analysis that reasoned "signed overflow is UB, so `a + b` is always `>= a`, so this branch is dead" and optimized the check out. No test failed — the overflowing inputs were never in the suite. The gap was caught *after the fact* by finally enabling `-fsanitize=signed-integer-overflow` on the fuzz target, which tripped on the overflowing input within minutes and pointed straight at the now-vanished guard. The fix was `__builtin_add_overflow`; the lesson was that a "harmless" compiler bump can silently weaponize latent UB, and UBSan-under-fuzzing is the only thing that would have caught it before an attacker did.

**The kernel driver that turned a 0-day into a panic.** A vendor shipped a kernel with `CONFIG_UBSAN_BOUNDS` and `CONFIG_UBSAN_TRAP` enabled on a driver subsystem. A later-disclosed out-of-bounds write in that driver — a genuine, exploitable 0-day — never became an exploit primitive on those builds: the OOB index tripped the bounds check and the kernel took a clean trap-induced oops instead of corrupting adjacent memory. The same bug was a working memory-corruption exploit on builds *without* UBSan-trap. The takeaway that moved the org: the cheap bounds subset, shipped with `-fsanitize-trap`, is a defense-in-depth control that converts a class of 0-days from "exploit" to "availability bug" — for low single-digit-percent overhead.

**The codec shift-by-width found by fuzzer + UBSan.** A media codec had a bit-extraction path that, on a crafted stream, computed `value >> n` with `n == 32` on a 32-bit type — undefined, and on the target hardware it returned garbage that propagated into a buffer-size calculation. Pure ASan fuzzing never flagged it because the shift didn't *immediately* corrupt memory; the bad size only sometimes led to an overflow much later. Adding `-fsanitize=undefined` to the OSS-Fuzz-style target made the shift itself the crash point: `shift exponent 32 is too large for 32-bit type` fired the instant the path executed, with the exact input saved. Without UBSan as a correctness oracle the bug was a needle; with it, it was a deterministic, minimized repro in one fuzzing session.

**The team that drowned in unsigned-overflow noise.** A platform team enabled `-fsanitize=integer` (not `-fsanitize=undefined`) across their service and were buried under thousands of "unsigned integer overflow" reports — every hash, every `size_t` decrement-past-zero, every ring-buffer wrap. They nearly concluded "UBSan is unusable noise" and reverted the whole effort. The actual fix was two characters of scope: switch to `-fsanitize=undefined` (UB only, dropping the defined-behavior `unsigned-integer-overflow`), then narrow further to `signed-integer-overflow,bounds,object-size,shift` for the first pass. The flood went from thousands to a few dozen *real* findings. The lesson: most "UBSan is too noisy" complaints are actually "we enabled defined-behavior checks by mistake," and the cure is scoping the check set, not abandoning the tool.

---

## Decision Frameworks

**Which UBSan checks for dev vs CI vs prod-trap?**

| Check | Dev | CI | Prod (trap) | Notes |
|---|---|---|---|---|
| `signed-integer-overflow` | ✅ | ✅ | ✅* | *prod only after intended-wrap is scoped/`-fwrapv`'d |
| `bounds` / `array-bounds` | ✅ | ✅ | ✅ | flagship prod-hardening check (kernel/Android) |
| `object-size` | ✅ | ✅ | ✅ | FORTIFY-style; needs `-O1`+ to know sizes |
| `shift` | ✅ | ✅ | ✅ | cheap; high-value for codecs/crypto |
| `null` | ✅ | ✅ | ⚠️ | prod only if no deliberate `*(volatile*)0` MMIO patterns |
| `vla-bound`, `vptr` | ✅ | ✅ | ❌ | `vptr` needs full runtime + RTTI; expensive |
| `alignment`, `float-cast-overflow` | ✅ | ⚠️ | ❌ | noisy / costly; dev-mostly |
| `unsigned-integer-overflow` | ❌ | ❌ | ❌ | **not UB** — defined wraparound; never enable in a UB rollout |

**Detect (UBSan) vs Define-away (`-fwrapv` / `-fno-strict-aliasing`) vs Fix:**

| Situation | Best response |
|---|---|
| New code, or any index/length/size math | **Fix** — make it genuinely overflow-safe (`__builtin_*_overflow`, wider types) |
| Security-sensitive check that relies on overflow | **Fix** — never let a guard depend on UB or a dialect flag |
| Isolated legacy function with intended wrap | **Fix** if cheap; else **`-fwrapv` on that TU** + ignorelist + ticket |
| Whole subsystem built on wraparound (hash/crypto/DSP) | Scoped **`-fwrapv`** per TU, documented, still fuzzed |
| Codebase does heavy low-level type punning (kernel/allocator) | Org-wide **`-fno-strict-aliasing`** as a deliberate platform decision |
| "Make the CI queue empty fast" | **None of the above as a reflex** — global `-fwrapv` here silences real bugs |

**Recover vs no-recover vs trap, by environment:**

| Environment | Mode | Rationale |
|---|---|---|
| Local dev | full runtime, **recover** | see *all* findings in one run with messages/values; don't stop at the first |
| CI | full runtime, **`-fno-sanitize-recover`** | a finding must fail the build; symbolized for triage |
| Fuzzing | minimal/full, **`-fno-sanitize-recover`** | abort so libFuzzer registers the crash and saves the input |
| Production | **`-fsanitize-trap`** (or minimal-runtime) | no runtime/symbolizer attack surface; deterministic crash → crash-reporter |

**Is this finding a real bug or intended wraparound?**

| Signal | Leans "real bug — FIX" | Leans "intended wrap — scope/`-fwrapv`" |
|---|---|---|
| Operation context | length/size/index/pointer math | hash mix, checksum, PRNG, saturating counter |
| Author intent (comments/history) | no mention of wrap; looks like an oversight | explicit "wraps intentionally" / known idiom |
| Signedness | `signed` overflow in a value that should never go negative | wrap that would be *defined* if it were `unsigned` |
| Exploitability | overflow can bypass a check or mis-size a buffer | result is fed back into modular math, no security edge |
| Reachability | fuzzer reaches it with adversarial input | only reachable with the intended wrapping inputs |

---

## Mental Models

- **UBSan is the only sanitizer that is also a production mitigation.** ASan/TSan/MSan answer "where can I afford this?" UBSan answers "is there any environment I should *leave it out* of?" — and for the cheap exploit-relevant checks, the answer trends to "no."

- **Trap-on-UB is a peer of stack canaries and RELRO.** It trades a clean crash for an exploitable condition. A bounds/overflow trap turns an OOB write or a check-bypass from an exploit primitive into an availability bug.

- **A UBSan finding is a *time bomb made audible*.** The current compiler may compile your UB "correctly" today; UBSan tells you the operation is undefined *now*, so you can fix it before a future optimizer weaponizes it. No test will warn you; the optimizer's value-range analysis will just delete your check.

- **Define-away is silencing, not fixing.** `-fwrapv`/`-fno-strict-aliasing` make UB *defined* — useful as a deliberate, scoped dialect choice, but a global reflex to clear findings throws away the real bugs hiding in the noise. You've turned off the detector, not removed the hazard.

- **Most "UBSan is too noisy" is a scoping bug.** The flood is almost always `unsigned-integer-overflow` (not UB) or unscoped `signed-integer-overflow` over intended wraparound. Scope the check set and the signal-to-noise inverts.

- **A fuzzer without UBSan finds only what crashes; with UBSan it finds what's *wrong*.** UBSan is the correctness oracle that converts silent-but-undefined executions into deterministic, minimized repros at near-zero added cost.

---

## Common Mistakes

1. **Enabling `-fsanitize=integer` when you meant `-fsanitize=undefined`.** The former pulls in `unsigned-integer-overflow`, which is *defined behavior*, and buries you in non-bugs. Step zero of any rollout: confirm the check set is UB-only.

2. **Reaching for global `-fwrapv` to clear the signed-overflow flood.** It makes the noise stop by defining away the very thing UBSan reported — including the genuine bugs. Triage and scope instead; reserve `-fwrapv` for documented, per-TU intended-wraparound subsystems.

3. **Demanding day-one zero findings.** On a large codebase that forces either disabling the useful checks or a reflexive global define-away. Baseline with an ignorelist and **gate on *new*** — the ratchet only shrinks.

4. **Leaving UBSan in `recover` mode under fuzzing or CI.** The full runtime defaults to log-and-continue; a recovering finding never aborts, so libFuzzer never saves the input and CI never fails. Always `-fno-sanitize-recover` for those environments.

5. **Treating UBSan as dev-only and skipping the production-trap deployment.** UBSan's unique value is that the cheap subset is a *shipping* security control. Compiling bounds/overflow/shift with `-fsanitize-trap` in prod is the highest-leverage use, and it's the one teams most often miss.

6. **Shipping a prod-trap check that can fire on *correct* code.** A production UBSan crash must mean "a real bug or an attack." Including `null` where deliberate MMIO-at-zero exists, or `signed-integer-overflow` before intended wrap is scoped, turns hardening into self-inflicted outages.

7. **Upgrading the compiler without re-running UBSan-under-fuzzing.** "The tests pass" does not retire latent-UB risk — the overflowing inputs aren't in the suite. A major GCC/Clang bump is a risk event for time-bomb UB; the clean fuzz-under-UBSan run is the control that closes it.

---

## Test Yourself

1. UBSan can run in production but ASan and TSan effectively cannot. Explain the cost asymmetry that makes this true, and name the flag that makes the production deployment essentially free at the trap site.
2. You're hardening a media codec for shipment. Which UBSan checks do you compile into the production build, which mode do you use, and which check must you *never* include — and why is that last one not even a UB check?
3. A teammate enables `-fsanitize=undefined` and reports "thousands of findings, this tool is unusable." What two distinct sources produce that flood, and what's your concrete first move for each?
4. Explain the "time-bomb" failure mode with the `if (a + b < a)` overflow-check example. Why does the test suite stay green, and what is the UBSan-based defense?
5. A subsystem (a hash mixer) is full of *intended* signed wraparound and UBSan flags every line. Compare your three options — fix, scoped `-fwrapv`, global `-fwrapv` — and say which you'd choose and why.
6. Why must `-fno-sanitize-recover` be set when running UBSan as a fuzzing oracle? What silently breaks if it isn't?
7. Give two concrete signals that push a `signed-integer-overflow` finding toward "real bug, fix it" and two that push it toward "intended wraparound, scope it."

<details>
<summary>Answers</summary>

1. ASan needs a shadow-memory scheme (~2× RSS) and TSan tracks happens-before (5–15× slowdown + large memory) — both are too expensive to ship. UBSan's checks lower to a constant comparison + a predicted-not-taken branch right before an op the compiler would emit anyway, so the cheap subset is low single-digit-percent overhead. **`-fsanitize-trap`** makes it essentially free at the site: a passing check is a not-taken branch, a failing check is a single trap instruction — no runtime library, no message formatting.
2. Compile **`signed-integer-overflow`** (after scoping intended wrap), **`bounds`/`array-bounds`**, **`object-size`**, and **`shift`** — the cheap, exploit-relevant set — with **`-fsanitize-trap`** (or `-fsanitize-minimal-runtime`). **Never** include **`unsigned-integer-overflow`**: unsigned wraparound is *defined* behavior in C/C++, so it's not UB at all and would crash correct code (hashes, `size_t` math) with a huge false-positive rate.
3. (a) **`unsigned-integer-overflow`** — defined behavior pulled in by accident, usually via `-fsanitize=integer`. Move: switch to `-fsanitize=undefined` (UB only). (b) **Intended `signed-integer-overflow`** — technically UB but deliberate wraparound (hashes, idioms). Move: baseline those sites in an ignorelist and gate on *new*, then triage the baseline down, applying scoped `-fwrapv` only to genuine intended-wrap TUs.
4. `a + b < a` can only be true if the signed addition overflowed; since signed overflow is UB, the optimizer may assume it never happens, conclude the branch is always false, and **delete the check**. The suite stays green because no overflowing input is in it. **Defense:** run the suite *and the fuzzer* under `-fsanitize=signed-integer-overflow`, which fires the moment the addition overflows — on today's compiler — so you rewrite the guard (e.g. `__builtin_add_overflow`) before a future optimizer weaponizes it.
5. **Fix** = rewrite with explicit unsigned/`__builtin_*` so the code is standard-conforming and portable (best for new/security code, costly here). **Scoped `-fwrapv`** = apply to *that TU only*, documented and still fuzzed — legitimate for a genuine wraparound subsystem. **Global `-fwrapv`** = defines away signed overflow *everywhere*, silencing real bugs elsewhere and incurring a hot-loop perf cost. **Choose scoped `-fwrapv`** for the hash mixer: it makes the intended behavior defined exactly where it's intended, without blinding the rest of the codebase.
6. The full UBSan runtime defaults to **recover** (log the finding and continue). Under fuzzing that means a UBSan violation never aborts, so libFuzzer never registers a crash and never saves the triggering input — the bug is *found and then thrown away*. `-fno-sanitize-recover` forces abort-on-finding so the crash is captured.
7. **Toward "real bug, fix":** the overflow is in length/size/index/pointer math; it can bypass a check or mis-size a buffer; the value should never be negative; a fuzzer reaches it with adversarial input. **Toward "intended wraparound, scope":** the op is a hash/checksum/PRNG/saturating counter; comments or history say it wraps deliberately; the result feeds back into modular math with no security edge; it's only reachable with the intended wrapping inputs.

</details>

---

## Cheat Sheet

```
WHY UBSAN IS SPECIAL
  cheap checks (compare + predicted-not-taken branch) → runs EVERYWHERE
  the ONLY sanitizer that is also a PRODUCTION mitigation

CHECK SETS
  -fsanitize=undefined      UB only            ← USE THIS for rollouts
  -fsanitize=integer        UB + unsigned wrap ← NOT THIS (unsigned wrap is DEFINED)
  first-pass cheap subset:  signed-integer-overflow,bounds,object-size,shift

MODE BY ENVIRONMENT
  dev   full runtime, RECOVER            see all findings + values
  CI    full runtime, -fno-sanitize-recover    finding fails build
  fuzz  -fno-sanitize-recover            abort → libFuzzer saves input
  prod  -fsanitize-trap                  trap instr, no runtime, no message
        -fsanitize-minimal-runtime       tiny "ubsan: <check>" + abort (Android/Chrome)

PROD-TRAP SAFE SUBSET (security hardening)
  signed-integer-overflow  (after scoping intended wrap)
  bounds / array-bounds    (kernel CONFIG_UBSAN_BOUNDS flagship)
  object-size              (FORTIFY-style, needs -O1+)
  shift                    (codec/crypto)
  NEVER prod: unsigned-integer-overflow (not UB), vptr (heavy), noisy alignment

ROLLOUT RATCHET
  1. scope checks (cheap subset, NOT unsigned)
  2. -fsanitize-ignorelist=baseline.txt  (exempt current failures)
  3. gate on NEW; baseline only SHRINKS
  4. -fwrapv per-TU for genuine intended-wrap subsystems

DETECT vs DEFINE-AWAY
  fix / __builtin_*_overflow   standard-conforming, portable, no ship cost
  -fwrapv (scoped)             defines signed overflow = wrap, per TU
  -fno-strict-aliasing (org)   defuses type-aliasing UB (kernel does this)
  global -fwrapv as a reflex   = silencing the detector; hides real bugs

TIME BOMB + UPGRADES
  latent UB compiles "right" today, optimizer DELETES it after a compiler bump
  e.g. if (a+b < a) → "overflow is UB → branch dead" → check removed
  DEFENSE: UBSan + fuzzing; gate compiler upgrades on clean fuzz-under-UBSan

FUZZING ORACLE
  clang++ -fsanitize=fuzzer,address,undefined -fno-sanitize-recover=undefined
  ASan = memory-safety oracle ; UBSan = correctness oracle (OSS-Fuzz runs both)
```

---

## Summary

- **UBSan's defining property is that it's cheap**, so it can live in dev, CI, fuzzing, *and production*. It is the only sanitizer that is also a deployable security-hardening control — the staff question is not "where can I afford it" but "is there any environment I should leave it out of."
- **In production, the cheap subset compiled with `-fsanitize-trap`** (bounds, signed-overflow, object-size, shift) turns exploitable UB — OOB writes, type confusion, check bypasses — into a clean controlled crash. This is a peer of stack canaries and RELRO, and it ships in the Linux kernel (`CONFIG_UBSAN`), Android, and Chrome.
- **Rolling out to a large codebase means surviving the flood.** Use `-fsanitize=undefined` (UB only — never `-fsanitize=integer`, which adds *defined* unsigned wraparound), scope to the cheap subset first, baseline the legacy findings in an ignorelist, and **gate on *new*** so the ratchet only shrinks.
- **The time-bomb problem is the strategic argument:** latent UB compiles "correctly" today but a future optimizer is free to weaponize it — the canonical case is an overflow-based security check the compiler deletes after an upgrade. **UBSan + fuzzing** is the defense, and a clean fuzz-under-UBSan run is the control that retires compiler-upgrade risk.
- **Detect-and-fix vs define-away (`-fwrapv` / `-fno-strict-aliasing`) is a real fork.** Fixing makes code standard-conforming and portable; define-away is a deliberate, scoped dialect choice with a performance and portability bill. Reaching for *global* `-fwrapv` to clear a CI queue silences the real bugs along with the noise.
- **UBSan is the correctness oracle for fuzzing** (run with `-fno-sanitize-recover` so findings actually abort). The same fuzzing infrastructure plus one `-fsanitize=undefined` finds shift-by-width, signed-overflow, and OOB bugs that never visibly corrupt memory — which is exactly why OSS-Fuzz runs it on thousands of projects.

You can now operate UBSan as an org-wide control spanning the whole lifecycle, including the production deployment that makes it unique. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone truly understands the cheap-everywhere/production-mitigation thesis.

---

## Further Reading

- [Clang UBSan documentation — minimal runtime and trap modes](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html) — the authoritative check list, `-fsanitize-trap`, `-fsanitize-minimal-runtime`, and `-fno-sanitize-recover`.
- [The Linux kernel UBSAN documentation](https://www.kernel.org/doc/html/latest/dev-tools/ubsan.html) — `CONFIG_UBSAN`, `CONFIG_UBSAN_TRAP`, and the curated bounds/shift hardening subset.
- John Regehr, *"A Guide to Undefined Behavior in C and C++"* and the LLVM/Regehr posts on how the optimizer exploits UB — the canonical explanation of why latent UB is a time bomb.
- [OSS-Fuzz documentation](https://google.github.io/oss-fuzz/) — how the public fuzzing fleet builds targets with UBSan + ASan as paired oracles.
- Android Open Source Project — *integer-overflow and bounds sanitizer in the platform* — a real-world production deployment with `-fsanitize-minimal-runtime`.
- [interview.md](interview.md) — the question bank that pressure-tests this material.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/professional.md) — the memory-safety oracle UBSan pairs with under fuzzing; contrast its dev/CI-only cost with UBSan's ship-to-prod economics.
- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/professional.md) — the other expensive, dev-only sanitizer, sharpening why UBSan's cheapness is the differentiator.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/professional.md) — the fuzzing engine that uses UBSan as a correctness oracle at scale.
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/professional.md) — the same "trap on a violated invariant in production" philosophy, expressed in source rather than via the compiler.
- [Security](../../../../Security/) — the exploit-mitigation context (canaries, RELRO, CFI) that UBSan-trap is a peer control within.
- [Static Analysis & Linting](../../static-analysis/) — the complementary compile-time approach and the baseline/gate-on-new ratchet pattern UBSan rollouts borrow.
