# Memory Safety — Professional Level

> **Topic:** [Memory Safety](README.md)
> **Focus:** Tooling pipelines, hardware/OS defense-in-depth, organizational strategy, and migration of legacy C/C++ — turning memory safety from a language property into a program-wide engineering discipline.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

At organizational scale, memory safety is not a checkbox on a language choice — it's a multi-year strategy spanning tooling in CI, hardware mitigations in production, prioritized migration of a legacy C/C++ estate, and sandboxing what can't be rewritten yet. The professional question isn't "is this language safe?" but "given a 20-million-line C++ codebase, finite engineers, and active attackers, how do I drive memory-safety vulnerabilities toward zero — and prove I'm making progress?"

This tier covers the full defense-in-depth stack: dynamic detection (sanitizers + fuzzing), hardware/OS mitigations (ASLR, DEP, CFI, PAC, MTE, CHERI), the economic and policy case (CISA/NSA, the ~70% statistic, Android/Chromium data), and concrete migration patterns.

---

## Prerequisites

- Senior-tier grasp of the safety guarantees, soundness, and the `unsafe` contract.
- Working knowledge of CI/CD, compiler flags, and build systems.
- Familiarity with the violation categories and how sanitizers detect them.
- Basic exposure to the exploitation model (control-flow hijack, info leak) at a conceptual level — to understand what each mitigation stops.

---

## Glossary

| Term | Meaning |
| --- | --- |
| **ASLR** | Address Space Layout Randomization — randomizes memory layout so attackers can't predict addresses. |
| **DEP / NX** | Data Execution Prevention / No-eXecute — marks data pages non-executable. |
| **Stack canary** | A guard value placed before the return address; corruption is detected on return. |
| **CFI** | Control-Flow Integrity — restricts indirect jumps/calls to legitimate targets. |
| **Shadow stack** | A protected second copy of return addresses to detect stack corruption. |
| **PAC** | Pointer Authentication (ARM) — cryptographic signatures embedded in pointers. |
| **MTE** | Memory Tagging Extension (ARM) — hardware tags on memory + pointers, checked on access. |
| **CHERI** | Capability hardware — pointers carry unforgeable bounds + permissions in hardware. |
| **HWASan** | Hardware-assisted AddressSanitizer — tag-based, lower overhead than classic ASan. |
| **Quarantine / redzone** | ASan's freed-memory hold pool / poisoned allocation padding. |
| **Sandboxing** | Isolating untrusted/unsafe code so a memory bug can't compromise the host. |

---

## Core Concepts

### The defense-in-depth stack

No single layer is sufficient for unsafe code; production security comes from *stacking* mitigations so an attacker must defeat all of them.

**Layer 0 — Prevention (best).** Use a memory-safe language. Everything below is for the code you *can't* (yet) make safe.

**Layer 1 — Dynamic detection in CI.** Sanitizers + fuzzing find bugs before shipping.

**Layer 2 — Compiler/OS exploit mitigations (always on in prod).** ASLR, DEP/NX, stack canaries, CFI, shadow stacks — these don't *fix* bugs, they make the surviving bugs *harder to exploit*.

**Layer 3 — Hardware-assisted safety.** PAC, MTE, CHERI — push detection/prevention into silicon at low overhead, viable in *production*, not just testing.

**Layer 4 — Isolation.** Sandboxing and process separation so a compromise of unsafe code is contained.

The professional mindset: assume bugs exist, and ensure each one must pierce multiple independent layers to cause harm.

### Dynamic detection tooling — the production pipeline

- **AddressSanitizer (ASan):** shadow memory + redzones + quarantine; catches overflows, UAF, double-free. ~2x slowdown, ~2x memory. CI/test only.
- **MemorySanitizer (MSan):** uninitialized reads; requires fully-instrumented dependencies.
- **UndefinedBehaviorSanitizer (UBSan):** integer overflow, alignment, invalid casts. Cheap; some checks shippable in production (`-fsanitize=...-trap`).
- **ThreadSanitizer (TSan):** data races via happens-before tracking.
- **Valgrind/Memcheck:** no recompilation needed (binary instrumentation), broad coverage, but ~10–50x slowdown — useful for third-party binaries you can't rebuild.
- **MIRI:** interprets Rust's MIR to detect UB in `unsafe` code (out-of-bounds, UAF, invalid values, some data races) — the way you validate `unsafe` Rust.
- **Fuzzing (libFuzzer, AFL++):** generates inputs to drive code into new paths. **Fuzzing × sanitizers is the multiplier** — the fuzzer reaches the buggy path, the sanitizer catches the violation precisely. This combination (e.g., Google's OSS-Fuzz) has found tens of thousands of bugs across open-source C/C++.
- **HWASan:** tag-based ASan with much lower overhead (~10–35%), enabling sanitizer-grade detection on real devices (Android dogfood builds).

The pipeline: unit/integration tests under ASan+UBSan in CI; continuous fuzzing of parsers/protocol handlers under sanitizers; periodic MSan and TSan runs; MIRI for `unsafe` Rust.

### Hardware & OS mitigations — what each stops and its limit

| Mitigation | Stops | Limit |
| --- | --- | --- |
| **ASLR** | Hardcoded-address exploits | Defeated by an info leak that reveals a base address; weak with low entropy (32-bit). |
| **DEP / NX** | Executing injected shellcode on the stack/heap | Bypassed by ROP/JOP (reusing existing executable code). |
| **Stack canaries** | Linear stack overflows clobbering the return address | Useless against UAF, heap overflows, or targeted writes that skip the canary. |
| **CFI** | Hijacking indirect calls to arbitrary code | Coarse CFI still allows calls to *any* valid target of the right type; data-only attacks unaffected. |
| **Shadow stack** | Return-address corruption (ROP) | Protects returns only, not forward-edge (indirect calls). |
| **PAC (ARM)** | Forging/corrupting pointers (signed before use, verified on use) | Signing gadgets, reuse within the same context, limited tag bits. |
| **MTE (ARM)** | Spatial *and* temporal bugs — tag mismatch on access faults | 4-bit tags → ~1/16 chance a random mismatch slips; needs OS/allocator support. |
| **CHERI** | Spatial + temporal at the pointer level — unforgeable capabilities with bounds | Requires new hardware + recompilation; ABI changes; still maturing (Arm Morello prototype). |

The pattern: each mitigation closes specific exploitation techniques but is bypassable in isolation. **MTE and CHERI are different** — they attack the *root cause* (invalid access) in hardware rather than a specific exploitation step, which is why they're the most promising for legacy C/C++.

### The economic and policy case

The numbers drive the strategy:
- **~70% of severe vulnerabilities** at Microsoft (analyzing CVEs since 2006), Google/Chromium, and Android are memory-safety bugs — a remarkably stable figure across organizations.
- **CISA and NSA** have published guidance urging adoption of memory-safe languages; the US ONCD released a report ("Back to the Building Blocks") making memory safety a national priority.
- **The cost asymmetry:** a memory-safety vuln found post-release can cost orders of magnitude more (incident response, patching, breach impact) than preventing it. The economic argument for safe languages is a *risk-reduction* argument, quantified by the vulnerability rate.

A landmark empirical result from **Android**: as new code shifted to Rust, the *fraction* of memory-safety vulnerabilities fell sharply — from ~76% of vulnerabilities in 2019 toward ~24% in 2024 — without a corresponding spike in other vulnerability classes. Google's key finding: you don't need to rewrite everything; **writing new code in a safe language drives the vulnerability rate down**, because vulnerabilities are concentrated in *new* code, which ages out.

### Migration strategy for a legacy C/C++ estate

You cannot rewrite 20M lines. The proven strategies:

1. **"Safe by default for new code."** The highest-ROI move (per Android data): mandate a memory-safe language for *new* components. Vulnerability density is highest in fresh code; this bends the curve without touching the legacy mountain.
2. **Incremental, interop-driven rewrites.** Rust ↔ C++ FFI (and tooling like `cxx`, autocxx) lets you replace high-risk modules (parsers, decoders) piecemeal. Chromium did this for specific components.
3. **Sandbox what you can't rewrite.** Wrap untrusted-input C/C++ (image/font/media decoders) in a tightly-confined process or a WebAssembly sandbox (Firefox's RLBox isolates third-party libraries this way), so a bug can't escape into the host.
4. **Harden the rest.** Compile legacy code with all mitigations (CFI, stack protector, `_FORTIFY_SOURCE`, MTE where available), fuzz it continuously under sanitizers, and prioritize by attack-surface exposure.
5. **Measure.** Track the *fraction* of vulnerabilities that are memory-safety bugs over time; that ratio is the leading indicator of whether the strategy is working.

The strategic insight: **prioritize the trust boundary.** Code that parses untrusted input is where memory bugs become remote exploits — migrate and sandbox there first.

---

## Real-World Analogies

- **Defense in depth = a castle, not a wall.** Moat (ASLR), drawbridge (DEP), murder holes (canaries), inner keep (CFI), and a final vault (sandbox). Any one can be breached; an attacker must beat all of them in sequence.

- **MTE = color-coded keys and locks.** Each allocation and the pointers to it are painted the same color (tag). Access with a wrong-colored pointer triggers the alarm — catching both "wrong room" (spatial) and "expired key" (temporal) in hardware, at the moment of misuse.

- **Sandboxing legacy decoders = handling hazardous material in a sealed glovebox.** You still process the dangerous input, but if it blows up, the blast is contained to the glovebox and never reaches the lab.

- **"Safe by default for new code" = stopping the leak before bailing the boat.** You can't instantly bail twenty million liters, but if you stop *adding* water (new unsafe code), the existing water gets pumped/ages out and the level drops.

---

## Mental Models

**Model 1: Mitigations buy time and raise cost; they don't remove bugs.** ASLR/DEP/CFI make exploitation expensive and unreliable. They're a tax on attackers, not a cure. The cure is prevention (safe languages) and root-cause hardware (MTE/CHERI).

**Model 2: Vulnerabilities live in new code.** The Android data's punchline: bug density decays with code age. So *where you write new code* matters more than *what you do with old code* for the long-run trend.

**Model 3: Detection coverage = reachability × sanitization.** A sanitizer only catches what's executed; a fuzzer drives execution. Coverage of the *bug space* is the product — invest in both.

**Model 4: Prioritize by the trust boundary.** Effort should be proportional to exposure to untrusted input. A parser facing the network is worth ten times the hardening of an internal batch tool.

---

## Code Examples

### Wiring sanitizers and mitigations into a build

```bash
# CI test build: catch bugs at the moment they happen.
clang -fsanitize=address,undefined -fno-omit-frame-pointer -g app.c -o app_asan

# Continuous fuzzing target under sanitizers (libFuzzer).
clang -fsanitize=address,fuzzer -g parser_fuzz.c -o parser_fuzz
./parser_fuzz -max_total_time=3600 corpus/    # fuzz the parser for an hour

# Production hardening flags (mitigations, not detection):
clang -O2 -D_FORTIFY_SOURCE=2 \
      -fstack-protector-strong \
      -fcf-protection=full \          # Intel CET: shadow stack + IBT
      -Wl,-z,relro,-z,now \           # full RELRO
      app.c -o app_prod
# (ASLR/DEP are enabled by the OS loader for PIE binaries by default.)
```

### A libFuzzer harness (the fuzzing × sanitizer multiplier)

```c
// Compiled with -fsanitize=address,fuzzer. The fuzzer reaches deep paths;
// ASan catches any memory violation precisely, with a stack trace + repro input.
#include <stdint.h>
#include <stddef.h>
extern int parse_packet(const uint8_t *data, size_t len);

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t len) {
    parse_packet(data, len);   // any overflow/UAF here -> ASan report + crashing input
    return 0;
}
```

### Validating `unsafe` Rust with MIRI

```bash
# MIRI interprets MIR and flags UB inside unsafe blocks that ordinary tests miss.
cargo +nightly miri test
# Catches: out-of-bounds via raw pointers, use-after-free, invalid values,
# uninitialized reads, some data races — exactly the unsafe-island risks.
```

### Tracking the metric that matters

```text
Quarter   Total vulns   Memory-safety vulns   MS fraction
2023-Q1        120              78                65%
2023-Q3        110              61                55%
2024-Q1        105              42                40%   <- new code in safe lang
2024-Q3         98              27                28%
# The falling FRACTION is the leading indicator the strategy is working.
```

---

## Pros & Cons

**Sanitizers + fuzzing:**
- ✅ Find real, exploitable bugs pre-ship with precise diagnostics; industry-proven (OSS-Fuzz).
- ❌ Coverage-limited; test-time cost; need engineering to build/maintain harnesses and corpora.

**Hardware/OS mitigations:**
- ✅ Always-on protection for shipped unsafe code; low/zero source changes; raise attacker cost.
- ❌ Individually bypassable; CFI/ASLR don't stop the bug, only some exploit techniques; performance/compat caveats.

**MTE / CHERI (root-cause hardware):**
- ✅ Attack the cause (invalid access) at low overhead; spatial *and* temporal; production-viable (MTE).
- ❌ Hardware/OS/allocator dependencies; tag-collision probabilistic (MTE); CHERI needs new silicon + ABI changes.

**Migration (rewrite/sandbox):**
- ✅ Bends the vulnerability curve; "new code safe" is high-ROI; sandboxing contains what you can't fix.
- ❌ FFI boundaries are new bug sources; rewrites are costly and risk-laden; requires sustained org commitment.

---

## Use Cases

- **Browser/OS vendor:** full stack — Rust for new code, sandboxed legacy decoders, CFI/PAC/MTE in production, OSS-Fuzz-style continuous fuzzing. (Chromium, Android, Windows all do versions of this.)
- **Embedded/mobile with ARM v8.5+:** enable MTE in dogfood/production for hardware-grade detection of the surviving C/C++ bugs.
- **A team with a C++ parser exposed to the internet:** fuzz under ASan in CI, sandbox the parser process, and schedule it as the first migration target.

---

## Coding Patterns

- **Sanitizer matrix in CI:** separate jobs for ASan+UBSan, MSan, TSan (they don't all compose) on every PR for native code.
- **Continuous fuzzing with a persistent corpus:** seed from real inputs, store the growing corpus, run on every change (catch regressions).
- **Process/Wasm sandbox for untrusted parsers:** isolate decoders so a memory bug yields a sandbox crash, not host compromise.
- **FFI shim with explicit invariants and ownership transfer rules** at every Rust↔C++ boundary; document who frees what.
- **Mitigation baseline as policy:** a hardened compiler-flag profile applied to *all* native builds, enforced by the build system.

---

## Best Practices

1. **Adopt "memory-safe by default for new code"** — it's the single highest-ROI policy, validated by Android's vulnerability-fraction decline.
2. **Run the fuzzing × sanitizer combination continuously,** not as a one-off; integrate with the build (OSS-Fuzz model).
3. **Stack mitigations and keep them all on in production** — ASLR, DEP, CFI, stack protector, and PAC/MTE where the hardware allows.
4. **Sandbox untrusted-input code you can't yet rewrite;** containment is cheaper than a rewrite and reduces blast radius now.
5. **Prioritize the trust boundary** — migrate and harden network/parser code before internal tooling.
6. **Measure the memory-safety vulnerability *fraction* over time;** make it a tracked program metric, not a vibe.
7. **Validate every `unsafe` Rust block with MIRI** and require `// SAFETY:` justifications in review.

---

## Edge Cases & Pitfalls

- **Mitigations create false confidence.** "We have CFI and ASLR" does not mean "we're safe" — chained bypasses (info-leak + ROP) routinely defeat them. They reduce, not eliminate, risk.
- **Sanitizers don't compose;** trying to run ASan + MSan + TSan in one build fails or is invalid. Use a matrix.
- **MSan reports false positives from uninstrumented libraries** — you must instrument the whole dependency tree.
- **MTE's 4-bit tag means ~1/16 of random mismatches slip through;** it's probabilistic mitigation, not a proof. Sequential tag schemes help spatial cases.
- **Rewrites import new bugs at the FFI boundary;** a Rust rewrite calling back into C++ can be *less* safe at the seam than either side alone.
- **CFI granularity matters:** coarse, type-based CFI still permits many call targets; "we have CFI" must specify *which* CFI.
- **Continuous fuzzing rots without maintenance:** stale corpora, broken harnesses, and unfixed findings make it theater. Treat fuzzing findings as P1 bugs.
- **"70%" is an aggregate, not your number.** Measure your own codebase; the strategy follows your actual vulnerability distribution.

---

## Summary

- Memory safety at scale is **defense in depth**: prevention (safe languages) → dynamic detection (sanitizers + fuzzing) → exploit mitigations (ASLR, DEP, canaries, CFI, shadow stacks) → root-cause hardware (PAC, MTE, CHERI) → isolation (sandboxing).
- **Sanitizers detect precisely but only on executed paths; fuzzing supplies the paths** — their product is your real coverage. HWASan/MTE bring detection to production-grade overhead.
- **Each OS/HW mitigation stops a specific exploitation technique and is individually bypassable;** MTE and CHERI are different in attacking the *root cause* (invalid access) in hardware.
- The **economic/policy case** (~70% of severe CVEs are memory-safety; CISA/NSA guidance; Android's vulnerability-fraction falling from ~76% to ~24%) shows the highest-ROI strategy is **"safe by default for new code,"** since bugs concentrate in new code.
- **Migration** = new code safe + incremental interop rewrites + sandbox-what-you-can't-rewrite + harden-and-fuzz the rest, **prioritized by the trust boundary** — and **measured** via the memory-safety vulnerability fraction over time.
