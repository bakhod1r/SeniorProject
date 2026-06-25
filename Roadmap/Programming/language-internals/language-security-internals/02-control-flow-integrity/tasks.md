# Control-Flow Integrity — Hands-On Tasks

> **Topic:** [Control-Flow Integrity](README.md)

---

## Introduction

This file is a structured, **defensive** set of exercises that take you from
"I have heard of a stack canary" to "I can read a binary's mitigations, reason
about which exploit class each one stops, and design a layered hardening
strategy with an honest residual." Every task is doable on your own machine
with a standard toolchain, and they build on one another.

A firm rule for this file: **everything here is conceptual and defensive.** The
tasks ask you to *observe* mitigations, *reason* about attack *classes*, and
*harden* code — never to construct a working exploit, gadget chain, or payload.
Where a task touches a vulnerable pattern, the deliverable is always
understanding or a fix, not a weapon. If a task ever seems to be steering you
toward a usable exploit, you've misread it; stop and re-read the goal.

How to use this file: read the task, do the work (compile, inspect, reason,
write the fix or the analysis), and only then check the hints. The self-check
boxes mean "I can explain this to another engineer," not "it compiled." Sample
solutions are intentionally sparse — they appear only where the canonical answer
teaches more than your first attempt would.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These tasks rebuild the mental model and get you reading mitigations off real
binaries. Short, but each introduces a primitive you'll reuse.

### Task 1: Read the mitigations off a binary

**Problem.** Compile a trivial C program two ways — once with default flags,
once with `-fno-stack-protector -no-pie -z norelro` — and inspect both with a
mitigation checker. Record which of {NX, stack canary, PIE, RELRO} each has.

**Constraints.**
- Use `checksec --file=./prog` (or `readelf -d` / `scanelf`) to inspect.
- Don't change the source between the two builds — only the flags.

**Hints (try without first).**
- The default modern toolchain turns most mitigations *on*; you're proving you
  can see them and that flags toggle them.
- `NX enabled` means the stack/heap are non-executable.
- `Canary found` means the compiler inserted stack-cookie checks.

**Self-check.**
- [ ] You can name each mitigation `checksec` reports and the attack it targets.
- [ ] You can predict the report before running it, from the build flags.

---

### Task 2: Find the canary in the disassembly

**Problem.** Compile a function with a local `char buf[64]` under
`-fstack-protector-strong -O0` and disassemble it (`objdump -d` or `gdb`).
Locate the prologue instruction that loads/stores the canary and the epilogue
check before `ret`.

**Constraints.**
- Identify the per-thread location the canary is loaded from (on Linux/x86-64,
  it's read relative to the thread pointer, e.g. `fs:0x28`).
- Identify the call to `__stack_chk_fail` on the failure path.

**Hints (try without first).**
- The canary is loaded near the start and stored just below the saved return
  address.
- The epilogue reloads it, compares, and conditionally jumps to the fail path.

**Self-check.**
- [ ] You can point at the exact store that places the canary on the stack.
- [ ] You can explain why the canary sits *between* the buffer and the return
      address, and why that position is what makes it work.

---

### Task 3: Classify the edge

**Problem.** For each of the following, label it **forward edge** or
**backward edge**, and name a defense that protects it: (a) a `ret`
instruction, (b) a C++ virtual call, (c) a `callback()` through a function
pointer, (d) a `longjmp`.

**Hints (try without first).**
- "Into a function" = forward; "out of a function" = backward.
- `longjmp` is a deliberate, non-standard return-target change — think about why
  it's awkward for backward-edge defenses.

**Self-check.**
- [ ] You got all four edges right.
- [ ] You can name at least one concrete defense per item (canary/shadow
      stack/PAC-ret for backward; LLVM CFI/CFG/IBT/BTI for forward).

---

### Task 4: Explain why NX didn't end the game

**Problem.** In your own words (a short paragraph), explain why marking the
stack non-executable killed injected shellcode but did *not* stop attackers,
and name the technique that defeats NX.

**Hints (try without first).**
- NX forbids *new* code, not *existing* code.
- The named technique reuses legitimate, already-executable code.

**Self-check.**
- [ ] Your explanation distinguishes "inject code" from "reuse code."
- [ ] You correctly name return-to-libc / ROP as the NX-bypassing class.

---

## Core

These tasks make the defenses concrete: you'll enable forward- and
backward-edge CFI, observe the instructions they emit, and reason about target
sets.

### Task 5: Enable LLVM CFI and read a violation

**Problem.** Write a small C program with an indirect call through a function
pointer of type `int(const char*)`. Build it with
`clang -flto -fvisibility=hidden -fsanitize=cfi -fno-sanitize-trap=cfi
-fsanitize-recover=cfi`. Then **deliberately** assign the pointer a function of
a *different* type via a cast and observe the CFI diagnostic at runtime.

**Constraints.**
- This is a *type-mismatch* demonstration, not an exploit — you're triggering
  the check legitimately to see it fire.
- Use the `-fno-sanitize-trap`/`-fsanitize-recover` form so you get a readable
  report instead of an immediate trap.

**Hints (try without first).**
- Without `-flto`, the type sets are incomplete; you may get false or missing
  reports. LTO is mandatory for sound type-based CFI.
- The diagnostic names the call site and the type mismatch.

**Self-check.**
- [ ] You can explain *why* LLVM CFI needs LTO.
- [ ] You can describe what target set the call site was restricted to and why
      the mismatched function wasn't in it.

---

### Task 6: Measure the equivalence-class problem

**Problem.** Create 50 functions all of type `void(void)` and one indirect call
site through a `void(*)(void)`. With LLVM CFI enabled, argue (in writing) how
large the target set for that call site is, and contrast it with a version
where each function has a *distinct, specific* signature.

**Hints (try without first).**
- Type-based CFI groups by signature. All 50 share one type ⇒ one class.
- Distinct types shrink each call site's class toward one member.

**Self-check.**
- [ ] You can state the size of the equivalence class in both designs.
- [ ] You can explain why permissive types (`void(void)`, `void*(void*)`)
      weaken forward-edge CFI, and how typing tightens it for free.

---

### Task 7: Observe Intel CET landing pads (if on x86-64)

**Problem.** Build a program with `-fcf-protection=full` and disassemble it.
Find the `ENDBR64` instruction at the start of functions that are indirect-call
targets. Then run `readelf -n` and confirm the CET (SHSTK/IBT) GNU property
notes are present.

**Constraints.**
- If your CPU lacks CET, you can still inspect the emitted instructions and
  notes — enforcement needs the hardware, but the *marking* is visible.

**Hints (try without first).**
- `=full` emits both `endbranch` (IBT) and shadow-stack-compatible code.
- If the property notes are missing, capable hardware won't enforce CET — the
  binary silently runs unprotected.

**Self-check.**
- [ ] You can explain what `ENDBR64` does and why IBT alone is *coarse*.
- [ ] You can explain why a missing property note means a silent downgrade.

---

### Task 8: Observe ARM PAC/BTI (if on ARM64)

**Problem.** Build with `clang -mbranch-protection=standard` and disassemble a
function. Find `PACIASP` in the prologue and `AUTIASP` in the epilogue, and
`BTI` landing pads at indirect-call targets.

**Hints (try without first).**
- `PACIASP` signs the return address (in LR) with the key and SP as context;
  `AUTIASP` verifies and strips it.
- The key is loaded by the OS into privileged registers — user code can sign and
  auth but cannot *read* the key.

**Self-check.**
- [ ] You can explain how PAC protects the return address *without* a separate
      shadow region.
- [ ] You can explain where the secret lives and why that placement matters.

---

### Task 9: Harden a vulnerable function

**Problem.** Given this function, rewrite it to be overflow-safe, and write one
sentence on which mitigation would have caught the *original* bug at runtime and
which would *not*.

```c
void set_label(char *dst, const char *src) {
    strcpy(dst, src);   // BUG: unbounded copy
}
```

**Hints (try without first).**
- The fix bounds the copy (`snprintf`/`strlcpy` with the destination size), and
  the caller must pass the destination size.
- A stack canary might catch a contiguous overflow of `dst`'s return address —
  but only if `dst` is a stack buffer crossed by the overflow, and not for heap
  destinations.

**Self-check.**
- [ ] Your rewrite never writes past the destination, for any input.
- [ ] You can name a case (heap destination, targeted write) where the canary
      would *not* have helped.

---

## Advanced

These tasks push into the bypass classes and the limits of CFI — all reasoned
defensively, never constructed.

### Task 10: Explain a data-only attack class (no exploit)

**Problem.** Given a struct with an `is_admin` boolean adjacent to a fixed-size
`name[]` buffer, explain *in writing* why a buffer overflow that flips
`is_admin` would be invisible to CFI, CET, and PAC. Then propose two
*structural* defenses that would mitigate it (without relying on CFI).

**Constraints.**
- Do not write exploit code; write an *analysis* and a *hardening proposal*.

**Hints (try without first).**
- CFI/CET/PAC protect *control* data; `is_admin` is *non-control* data.
- Structural mitigations: separate allocations / guard pages between data and
  buffers; independent validation of the flag; bounds-checked copies that make
  the overflow impossible in the first place; memory-safe rewrite.

**Self-check.**
- [ ] You can articulate precisely *why* no control-flow defense fires.
- [ ] Your two mitigations attack the bug or the layout, not the (irrelevant)
      control flow.

---

### Task 11: Coarse vs fine-grained reasoning

**Problem.** You're told a system enforces "indirect calls may only target a
valid function entry." Argue *in writing* why this coarse policy can still be
insufficient, and what additional information a fine-grained scheme uses to
shrink the allowed set.

**Hints (try without first).**
- A real binary has thousands of valid entries; "any valid entry" is a large
  set.
- Fine-grained schemes add *types* (LLVM CFI, XFG, KCFI) to shrink each call
  site's set.

**Self-check.**
- [ ] You can explain *why* coarse CFI was historically bypassed in terms of set
      size, not check correctness.
- [ ] You can name the extra information (type signatures/hashes) fine-grained
      schemes use.

---

### Task 12: Why both edges (no exploit)

**Problem.** A teammate proposes shipping *only* shadow stacks (backward-edge
integrity) to save effort, arguing "ROP is the main threat." Write a rebuttal
explaining what class of code reuse remains open and why forward-edge CFI is
still needed.

**Hints (try without first).**
- Shadow stacks guard `ret`. JOP/COP use indirect `jmp`/`call`.
- COOP composes legitimate virtual calls — also a forward-edge concern.

**Self-check.**
- [ ] You can name JOP/COP and explain why the shadow stack never fires for
      them.
- [ ] You can explain the general principle: protecting one edge relocates the
      attacker to the other.

---

### Task 13: The PAC oracle concept (defensive)

**Problem.** Explain, conceptually and without any working construction, why a
"signing oracle" undermines PAC even though the attacker never learns the key.
Then state one coding guideline that reduces signing-oracle surface.

**Hints (try without first).**
- If code can be coerced into signing a pointer the attacker chose, the attacker
  obtains validly-signed pointers without the key.
- Guideline: never sign attacker-influenced pointers; use strong, context-bound
  modifiers (e.g., SP-based) so signatures aren't reusable across contexts.

**Self-check.**
- [ ] You can explain why "the key is secret" is not sufficient for PAC safety.
- [ ] Your guideline reduces the chance of an unintended signing primitive.

---

### Task 14: Audit a mixed-instrumentation link

**Problem.** You have an application built with full CFI that links a
third-party prebuilt `.so` compiled *without* CFI/CET/BTI. Write an analysis of
what the security guarantee actually is for the combined process, and propose a
remediation.

**Hints (try without first).**
- The guarantee is only as strong as the weakest reachable object; the
  un-instrumented `.so` is a CFI-free region.
- Remediation: rebuild the dependency with matching flags, isolate it (separate
  process / sandbox), or replace it.

**Self-check.**
- [ ] You can explain how an attacker benefits from the un-instrumented region.
- [ ] Your remediation closes or contains the gap, not just documents it.

---

## Capstone

### Task 15: Design and write a hardening + residual report

**Problem.** Pick a realistic target — a network-facing C++ service that parses
untrusted input — and produce a one-page hardening plan. It must: (1) list the
mitigations you'd enable mapped to the exploit *step* each owns (bug →
corruption → hijack → execution → containment); (2) give the concrete toolchain
flags for both x86-64 and ARM64; (3) state the **residual risk** explicitly
(data-only/DOP, COOP, info leaks, exemptions); (4) name the compensating
controls for each residual; and (5) identify the single highest-value *next*
investment and justify it.

**Constraints.**
- The report's tone must be a *bounded statement*: what's blocked, what's not,
  and the plan — never "we're protected from memory corruption."
- No exploit content; this is a defensive architecture deliverable.

**Hints (try without first).**
- Map each layer to a step: memory safety deletes the bug; MTE catches the
  corruption; CFI/shadow stack/PAC block the hijack; sandboxing contains
  execution.
- The "next investment" is usually MTE, sandboxing, or a memory-safe rewrite —
  rarely "more CFI," because CFI already prices out cheap control-flow hijacks.

**Self-check.**
- [ ] Every mitigation in your plan is mapped to the exploit step it owns.
- [ ] Your flags are correct and verifiable (`checksec` / `readelf -n`).
- [ ] Your residual section names data-only and COOP explicitly.
- [ ] Your security claim is a precise bounded statement with a plan.

**Sparse solution sketch.**

```text
Step-to-mitigation map:
  bug exists        -> migrate highest-risk parser to Rust (deletes class)
  corruption occurs -> ARM MTE where available (catch at bad access)
  pointer hijacked  -> forward CFI (cfi-icall/cfi-vcall, LTO) +
                       backward integrity (CET shadow stack / PAC-ret) +
                       IBT/BTI landing pads; Full RELRO; PIE/ASLR
  code runs         -> sandbox the parser (contain capability)

Flags:
  x86-64: clang++ -O2 -flto -fvisibility=hidden -fsanitize=cfi \
                  -fcf-protection=full -fstack-protector-strong \
                  -pie -Wl,-z,relro,-z,now
  arm64:  clang++ -O2 -flto -fvisibility=hidden -fsanitize=cfi \
                  -mbranch-protection=standard -fstack-protector-strong \
                  -pie -Wl,-z,relro,-z,now

Verify:  checksec --file=svc ; readelf -n svc  (CET/PAC/BTI notes present)

Residual:  data-only/DOP (control flow stays legitimate; CFI/CET/PAC blind),
           COOP (composition of type-valid vcalls satisfies cfi-vcall),
           info-leak-assisted attacks, JIT/dlsym/longjmp exemptions.

Compensating: MTE, parser sandbox, least privilege, leak-resistant logging,
              audited exemption list with owners.

Next investment: MTE (if ARM and not yet on) OR sandboxing the parser —
  both attack residual steps CFI cannot reach. Not "more CFI."
```

---
