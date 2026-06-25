# Control-Flow Integrity — Senior Level

> **Topic:** [Control-Flow Integrity](README.md)
> **Focus:** The backward edge done right — shadow stacks (software and Intel CET) — plus hardware-assisted CFI: Intel CET IBT, ARM Pointer Authentication (PAC), and Branch Target Identification (BTI).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Trade-offs](#trade-offs)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

> Focus: **Canaries are a tripwire, not integrity. How do we make the *return address* tamper-proof, and how does the silicon enforce CFI cheaply enough to ship by default?**

The middle level closed the forward edge with type-based CFI. This level closes the **backward edge** the right way and explains why the industry moved CFI *into hardware*. The headline ideas: a **shadow stack** keeps a second, protected copy of every return address so a corrupted on-stack return is detected on `ret`; **Intel CET** implements that shadow stack in silicon and adds **IBT** (indirect-branch tracking via `endbranch` landing pads) for the forward edge; **ARM Pointer Authentication (PAC)** cryptographically *signs* pointers using a key and spare virtual-address bits so a forged pointer fails verification; and **ARM BTI** mirrors Intel IBT with landing-pad enforcement.

The senior framing: software CFI (canaries, LLVM CFI, CFG) is *policy enforced by inserted checks*, and inserted checks cost cycles and can be bypassed if the attacker controls enough state. Hardware CFI changes the economics — the CPU enforces the invariant with negligible overhead and stores secrets (the shadow stack pointer, the PAC key) in places software-level corruption can't reach. That is what made CFI cheap enough to enable platform-wide on modern Windows, Linux, iOS, and macOS.

> 🎓 **Why this matters for a senior:** You're now the person who decides *which* mitigations a product ships, owns the threat model, and explains to leadership why a binary needs CET or why an ARM64 build should sign return addresses. You need to reason precisely about what each hardware feature guarantees, what it *doesn't* (none of these stop data-only attacks), the residual bypasses (signing gadgets, PAC oracle leaks), and the deployment realities (CPU support, ABI, library participation). This is also the layer interviewers probe to separate "I've heard of CFI" from "I understand the guarantee."

This page covers: software vs hardware **shadow stacks**, **Intel CET** (shadow stack + IBT `endbranch`), **ARM PAC** (signing with `PAC*`/`AUT*`, the key in spare VA bits, `-mbranch-protection`), **ARM BTI**, how kernels use these (**kCFI/FineIBT**), and the precise guarantees and residual gaps. The next level (`professional.md`) covers CFI *bypass classes* (COOP, data-only attacks), performance/adoption, and program-wide strategy.

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in `junior.md` and `middle.md` — stack smashing, NX, canaries, ROP/JOP/COP, forward vs backward edge, LLVM CFI, CFG/XFG.
- **Required:** A clear picture of how `call` pushes and `ret` pops the return address.
- **Helpful but not required:** Familiarity with 64-bit virtual addressing — that real addresses use far fewer than 64 bits, leaving spare high bits (this is where PAC lives).
- **Helpful but not required:** Awareness of CPU privilege levels and that some registers/state are inaccessible to user-mode corruption.

You do **not** need to know:

- The exact CET MSR/XSAVE state encodings or PAC's QARMA cipher internals (we explain the *guarantee*, not the silicon spec).
- The detailed kCFI/FineIBT kernel patch history (we cover the concept).
- The CFI bypass research frontier — that's `professional.md`.

> ⚠️ **Defensive scope.** Mechanisms and guarantee/residual-gap analysis only. No working signing-gadget chains or oracle constructions.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Shadow stack** | A second, protected stack holding *only* return addresses; checked against the regular stack on `ret`. |
| **Backward-edge CFI** | Protecting returns: ensuring `ret` goes back to the real caller. |
| **Intel CET** | "Control-flow Enforcement Technology" — Intel's hardware CFI: shadow stack + IBT. |
| **IBT (Indirect Branch Tracking)** | CET's forward-edge feature: indirect branches must land on an `endbranch` instruction. |
| **`endbranch` / `ENDBR64`** | A no-op-like landing-pad instruction marking a legal indirect-branch target. |
| **PAC (Pointer Authentication)** | ARMv8.3 feature that signs a pointer with a secret key into its unused high bits; verified before use. |
| **PAC signing / authing** | `PAC*` instructions add a signature; `AUT*` instructions verify and strip it (faulting/poisoning on mismatch). |
| **PAC key** | A secret held in privileged registers, not readable by user code; per-process/per-context. |
| **BTI (Branch Target Identification)** | ARMv8.5 forward-edge feature: indirect branches must land on a `BTI` landing-pad instruction. |
| **Landing pad** | An instruction (`endbranch`/`BTI`) that marks a valid indirect-branch entry point; landing elsewhere faults. |
| **kCFI** | Kernel CFI — CFI applied inside the OS kernel (e.g., Clang's KCFI scheme). |
| **FineIBT** | A scheme combining Intel IBT landing pads with a fine-grained software type check for tight kernel CFI. |
| **Signing oracle** | A bug that lets an attacker get the CPU to sign a pointer of their choosing, undermining PAC. |
| **Shadow stack pointer (SSP)** | The CPU register pointing at the current top of the shadow stack; managed in hardware. |

---

## Core Concepts

### 1. Why Canaries Aren't Integrity

A stack canary is a *tripwire*: it detects a *contiguous* overwrite that crosses it, and only just before `ret`. It does not protect the return address itself — it protects a value *near* it, and only against one corruption shape. Targeted writes (precise heap-to-stack, format-string writes, non-contiguous overflows), and info-leak-then-rewrite (read the canary, write it back correctly) all defeat it. **Integrity** means: even if the attacker can write the return-address slot, the program won't *use* a forged value. Shadow stacks provide that; canaries don't.

### 2. Shadow Stacks: A Second, Protected Copy

A **shadow stack** is a separate region holding *only* return addresses. The contract:

- On `call`: push the return address to the *regular* stack **and** to the shadow stack.
- On `ret`: pop from the regular stack, and compare it to the top of the shadow stack. **If they differ, fault.**

Because the attacker's overflow corrupts the *regular* stack but not the (separately located, hardware-protected) shadow stack, a forged return address no longer matches and the `ret` traps. This directly kills ROP's core mechanism: you can pile addresses on the regular stack all you like, but each `ret` is now validated against an untouched record of where it should go.

Shadow stacks come in two forms:

- **Software shadow stacks** (compiler-instrumented). Sound but costly, and the protection of the shadow region itself is the hard part — if it's just normal memory, a write primitive can corrupt it too. Various tricks (segment isolation, randomization, info-hiding) were used, with mixed durability.
- **Hardware shadow stacks** (Intel CET, ARM GCS). The CPU manages a shadow stack pointer and enforces that shadow-stack pages are only writable by `call`/`ret` and dedicated instructions — *not* by ordinary stores. This is the version that scales: cheap and genuinely tamper-resistant.

### 3. Intel CET: Shadow Stack + IBT

**Intel CET** ("Control-flow Enforcement Technology") brings both edges into silicon:

**Shadow stack (backward edge).** As above, hardware-managed. The shadow-stack pages have a special memory type that ordinary writes can't modify; only `call`/`ret` and shadow-stack instructions touch them. A mismatch on `ret` raises a control-protection fault. This is the strong backward-edge guarantee.

**IBT — Indirect Branch Tracking (forward edge).** Every legal target of an indirect `call`/`jmp` must begin with an **`endbranch`** instruction (`ENDBR64` on x86-64). After an indirect branch, the CPU enters a "wait-for-endbranch" state; if the very next instruction isn't `endbranch`, it faults. This means an attacker can only redirect an indirect branch to an address that *starts with `endbranch`* — i.e., a deliberately-marked function entry, not the middle of a gadget. IBT is *coarse* on its own (any `endbranch` is allowed), which is why it's often combined with a software type check (**FineIBT**) for fine granularity.

### 4. ARM Pointer Authentication (PAC): Sign the Pointer Itself

ARM takes a different, cryptographic approach. On a 64-bit ARM core, virtual addresses don't use all 64 bits — the high bits are unused. **PAC** stuffs a **cryptographic signature** (a PAC) into those spare bits:

- `PAC*` instructions compute a keyed MAC over the pointer value (and a *context* / modifier, often the stack-pointer value) and write the truncated MAC into the pointer's high bits.
- `AUT*` instructions recompute the MAC and verify it; on success they strip the signature back to a usable address, on failure they *poison* the pointer so any use faults.

The **key** lives in privileged system registers and is **not readable by user code**. So for the backward edge: at function entry, sign the return address (`PACIASP`); before returning, authenticate it (`AUTIASP`). An attacker who overwrites the return address can't produce a valid signature (they don't have the key), so the `AUT*`/`ret` faults. PAC also protects forward-edge pointers (signed function pointers, signed C++ vtable entries) — this is the basis of Apple's pervasive use in iOS/macOS on Apple Silicon.

PAC's elegance is that it needs *no extra memory region* — the integrity check rides in the pointer's spare bits. Its key residual risks: **signing oracles** (a bug that signs attacker-chosen pointers), **PAC value reuse** across contexts if the modifier is weak, and **brute force** of the short MAC if an attacker has an authentication oracle and the PAC field is small.

### 5. ARM BTI: Landing Pads for the Forward Edge

**BTI (Branch Target Identification)**, from ARMv8.5, is ARM's analog of Intel IBT: indirect branches must land on a **`BTI`** landing-pad instruction, or the CPU faults. Like IBT, it's coarse on its own (any valid landing pad is allowed) but eliminates "land in the middle of a gadget." BTI and PAC are complementary: BTI restricts *where* an indirect branch may land; PAC ensures the *pointer* used to get there is authentic. Together they sharply constrain forward-edge code reuse.

### 6. Kernel CFI: kCFI and FineIBT

The kernel is the prize target, so CFI inside the kernel matters most. Two notable schemes:

- **kCFI (KCFI)** — Clang's kernel-oriented CFI: before each indirect call, check a **type hash** stored just before the target function. It's a fine-grained, software, type-based forward-edge check designed to be small and robust enough for kernel code (no LTO-wide assumptions, works with the kernel's calling patterns).
- **FineIBT** — combines hardware **IBT landing pads** (so the branch can only reach marked entries cheaply) with a **software type check** at the landing pad (so among marked entries, only the type-correct one is allowed). It gets IBT's hardware coarse filter *and* fine-grained type precision, at low cost. Linux uses FineIBT on CET-capable CPUs.

### 7. The Honest Boundary: What None of This Stops

Every mechanism here protects *control data* — return addresses and code pointers. **None of them stops a data-only attack**, where the attacker corrupts *non-control* data (a privilege flag, a length, a file path, an `is_admin` boolean) to change behavior without ever redirecting a branch. Shadow stacks, CET, PAC, and BTI all see a perfectly legal control flow in that case. That residual is the subject of `professional.md`, and it's the senior engineer's job never to overclaim: "CET + PAC enabled" means "control-flow hijacking is hard," not "the process is secure."

---

## Real-World Analogies

**Shadow stack as a coat-check ticket.** When you enter (a `call`), you check your coat and get a numbered ticket — a copy of "where you came from." When you leave (a `ret`), the attendant matches your ticket against the coat's tag. Tamper with the tag on the coat (corrupt the on-stack return address) and it no longer matches your ticket (the shadow copy) — you're stopped at the door. The ticket stub lives behind the counter where you can't reach it (hardware-protected shadow region).

**IBT/BTI landing pads as designated helicopter pads.** A helicopter (indirect branch) may only touch down on a marked **H** pad (`endbranch`/`BTI`). It can't land in the middle of a field (the middle of a gadget). It still doesn't say *which* helipad — that's the coarseness — but it eliminates landing anywhere you please.

**PAC as a tamper-evident signature on a check.** A bank check (pointer) carries a signature the bank can verify with a secret key. You can write any amount on a forged check (overwrite the return address), but without the key you can't produce a valid signature, and the teller (`AUT*`) rejects it. The signature even rides in the check's existing margin (the spare VA bits) — no extra paper needed.

**FineIBT as "land on the helipad, then show your badge."** IBT says you may only land on an **H** pad; the FineIBT software check at the pad then verifies your badge says you belong on *this specific* pad. Coarse hardware filter plus fine software identity.

---

## Mental Models

**Model 1: Tripwire vs integrity.** Canary = tripwire (detects a crossing). Shadow stack/PAC = integrity (a forged value won't verify). Seniors must articulate this difference; it's the core of "why CET, not just `-fstack-protector`."

**Model 2: Two enforcement strategies — *separate copy* vs *sign in place*.** Shadow stacks keep a protected *duplicate* (Intel's approach for returns). PAC *signs the value itself* using spare bits and a hidden key (ARM's approach). Same goal — backward-edge integrity — two engineering philosophies, with different residual risks (shadow-region protection vs signing oracles).

**Model 3: Landing pads make the forward edge coarse-but-bounded; type checks make it fine.** IBT/BTI alone bound indirect branches to marked entries (coarse). Layering a type check (FineIBT, KCFI, XFG, LLVM CFI) makes it precise. Hardware filter + software identity is the modern recipe.

**Model 4: The data-only floor.** All control-flow defenses sit *above* a floor they cannot reach: corrupting non-control data. As you push control-flow attacks toward impossible, attackers descend to that floor. Knowing where the floor is keeps your threat model honest.

---

## Code Examples

> Mechanisms and enablement only — no working oracles or signing gadgets.

### 1. Enabling Intel CET (shadow stack + IBT)

```bash
# GCC/Clang: emit CET-compatible code (endbranch + shadow-stack support).
$ gcc -fcf-protection=full app.c -o app
#   =branch  -> IBT only
#   =return  -> shadow stack only
#   =full    -> both

# Verify the marking is present in the binary:
$ readelf -n ./app | grep -i 'SHSTK\|IBT'   # GNU property notes for CET
```

What the compiler emits, conceptually:

```text
function entry:    ENDBR64            ; legal indirect-branch landing pad (IBT)
call somewhere:    (CPU pushes return addr to BOTH normal + shadow stack)
function return:   RET                ; CPU compares normal-stack addr to shadow top
                                      ; mismatch -> #CP control-protection fault
```

### 2. Enabling ARM Pointer Authentication and BTI

```bash
# Sign return addresses (PAC) and require BTI landing pads.
$ clang -mbranch-protection=standard app.c -o app
#   pac-ret        -> sign/auth return addresses
#   bti            -> require BTI landing pads
#   standard       -> pac-ret + bti
```

What the compiler emits, conceptually:

```text
function entry:    PACIASP            ; sign return addr (LR) with key + SP as context
                   BTI c              ; legal indirect-call landing pad
... body ...
function return:   AUTIASP            ; verify+strip signature; poison on mismatch
                   RET                ; ret on a poisoned pointer faults
```

The PAC key is loaded by the OS into privileged registers per context; user code can sign/auth but **cannot read the key**.

### 3. The guarantee, stated as an invariant

```text
Backward-edge invariant (shadow stack / PAC-ret):
    The address `ret` jumps to == the address the matching `call` pushed.
    Any tampering between call and ret is detected and faults.

Forward-edge invariant (IBT / BTI [+ type check]):
    An indirect call/jmp lands only on a marked entry (endbranch/BTI),
    and (with FineIBT/KCFI/CFI) only on a type-compatible one.
```

### 4. Kernel CFI knobs (Linux, conceptual)

```text
# Clang KCFI: per-call type-hash check in front of indirect calls.
CONFIG_CFI_CLANG=y

# On CET-capable x86-64, the kernel can use FineIBT:
#   hardware IBT landing pads + software type check at the pad.
CONFIG_FINEIBT=y     # (selected with X86_KERNEL_IBT + CFI_CLANG)
```

### 5. Detecting a violation at runtime

```text
# A backward-edge violation under CET surfaces as a control-protection fault:
#   signal SIGSEGV with si_code = SEGV_CPERR (control protection)
# A PAC auth failure surfaces as a fault when the poisoned pointer is used.
# Treat either as "an exploit attempt was just stopped," not a normal bug.
```

---

## Trade-offs

**Shadow stacks (hardware, CET)**

| Pros | Cons |
|------|------|
| True backward-edge *integrity*, not a tripwire. | Requires CET-capable CPU + OS support. |
| Near-zero runtime cost (hardware-managed). | Edge cases with stack-switching, `setjmp`/`longjmp`, unwinding need special handling. |
| Kills ROP's `ret`-chaining mechanism. | Doesn't touch the forward edge or data-only attacks. |

**Intel IBT**

| Pros | Cons |
|------|------|
| Cheap forward-edge coarse filter (land only on `endbranch`). | Coarse alone — needs FineIBT/type check for precision. |
| Hardware-enforced. | Requires recompilation with `endbranch` emission. |

**ARM PAC**

| Pros | Cons |
|------|------|
| No extra memory region; signature rides in spare VA bits. | Short MAC ⇒ brute-forceable *if* an auth oracle exists. |
| Key unreadable by user code; protects both edges. | **Signing oracles** (sign attacker-chosen pointers) undermine it. |
| Deployed at huge scale (Apple Silicon). | Context/modifier choice matters; weak modifiers enable reuse. |

**ARM BTI** — same shape as IBT: cheap, coarse, needs a type check for fine granularity.

---

## Use Cases

- **Modern Windows** ships hardware shadow stacks (CET) for user-mode processes that opt in; kernel uses additional CFI.
- **Linux** uses **FineIBT** on CET CPUs and **KCFI** for kernel forward-edge CFI; user-space shadow stacks are rolling out.
- **iOS / macOS on Apple Silicon** use **PAC** pervasively — signed return addresses, signed function pointers, signed vtable/Objective-C pointers — as a primary exploit-mitigation pillar.
- **High-value C/C++ targets** (browsers, hypervisors, baseband, secure enclaves) layer hardware CFI on top of LLVM CFI/CFG/XFG.

---

## Coding Patterns

**Pattern: Build with full protection and verify it landed.** `-fcf-protection=full` (x86) / `-mbranch-protection=standard` (ARM), then check GNU property notes (`readelf -n`). A binary missing the notes silently runs without CET/PAC even on capable hardware.

**Pattern: Make the whole dependency chain participate.** Hardware CFI is only as strong as its weakest linked object. A single library compiled without `endbranch`/BTI marks creates "legacy" regions where enforcement is relaxed. Audit third-party binaries.

**Pattern: Handle the legitimate control-flow oddities explicitly.** `setjmp`/`longjmp`, exception unwinding, fiber/coroutine stack switches, and JITs all move or rewrite return state; they need CET/PAC-aware support or they'll fault. Use the platform's sanctioned APIs, don't hand-roll stack switches.

**Pattern: Treat a control-protection / PAC fault as an attack signal.** Log it, alert on it, and crash safely — it usually means a mitigation just stopped an exploitation attempt.

---

## Best Practices

1. **Prefer integrity over tripwires for the backward edge.** Where the platform supports it, enable hardware shadow stacks (CET) or PAC-ret instead of relying on canaries alone.
2. **Enable both edges:** shadow stack/PAC-ret (backward) *and* IBT/BTI + a type check (forward). One edge protected just relocates the attacker.
3. **Use FineIBT/KCFI/XFG for fine granularity** — landing pads alone are coarse.
4. **Audit the full binary closure for participation.** Mixed CET/non-CET or BTI/non-BTI objects weaken the guarantee.
5. **Never overclaim.** Document explicitly that these stop control-flow hijacking, not data-only attacks.
6. **Watch PAC's oracle surface.** Avoid code that signs attacker-influenced pointers; choose strong signing modifiers (e.g., SP-based context).

---

## Edge Cases & Pitfalls

- **`setjmp`/`longjmp` and C++ unwinding** legitimately change the return target; CET shadow stacks and PAC need special handling so unwinding doesn't look like an attack.
- **JIT compilers** generate code and indirect-call targets at runtime; they must emit landing pads and (for PAC) sign pointers correctly, or fault.
- **PAC signing oracles** are the dominant real-world PAC weakness: if any code path signs a pointer the attacker controls, PAC's protection collapses for that pointer type.
- **Short PAC fields + an auth oracle ⇒ brute force.** The MAC is only as many bits as the spare VA space allows; repeated authentication attempts can leak validity.
- **Coarse IBT/BTI misconception.** Landing-pad enforcement alone still allows reaching *any* marked entry; without a type check it doesn't pin down the single intended target.
- **GNU property notes missing** ⇒ silent downgrade. Capable hardware won't enforce CET/PAC on an unmarked binary.

---

## Common Mistakes

- Equating stack canaries with backward-edge *integrity*. They're a tripwire.
- Enabling forward-edge landing pads (IBT/BTI) and assuming the forward edge is "fine-grained protected" without a type check.
- Shipping a binary without verifying the CET/PAC property notes are present.
- Linking one un-instrumented library and assuming whole-program enforcement.
- Claiming hardware CFI defeats data-only attacks. It does not.
- Hand-rolling stack switches or `longjmp`-like control flow that breaks shadow-stack/PAC assumptions.

---

## Tricky Points

- **PAC needs no shadow region** because the integrity check lives *in the pointer*; the secret is the key, not a separate memory copy.
- **The shadow-stack security depends on the shadow region being unwritable by ordinary stores** — that protection is exactly what hardware (CET) provides and what software shadow stacks struggled to guarantee.
- **IBT/BTI is intentionally coarse** — it's a cheap *filter*, designed to be paired with a software type check (FineIBT/KCFI), not used alone.
- **A signing oracle is to PAC what an info leak is to a canary** — it hands the attacker the one secret the scheme relied on.
- **Backward-edge integrity does not stop JOP/COP** (no `ret` involved); you still need forward-edge enforcement.

---

## Test Yourself

1. Why is a stack canary a "tripwire" and a shadow stack "integrity"? Give a concrete case the canary misses but the shadow stack catches.
2. Describe the shadow-stack contract on `call` and `ret`. Why must the shadow region be unwritable by ordinary stores?
3. What does Intel **IBT** enforce, and why is it called *coarse*? What does **FineIBT** add?
4. How does **PAC** protect a return address without a second memory region? Where does the key live?
5. What is a **signing oracle**, and why does it undermine PAC?
6. How do **BTI** and **PAC** complement each other on the forward edge?
7. What is **KCFI**, and why does kernel CFI favor a per-call type hash?
8. Name one class of attack that *all* of CET, PAC, BTI, and shadow stacks fail to stop, and explain why.

> If you can answer 1–5 and 8 cleanly, you're ready for `professional.md` (bypass classes, data-only attacks, COOP, performance, and adoption).

---

## Cheat Sheet

| Concept | One-liner |
|---------|-----------|
| **Shadow stack** | Protected duplicate of return addresses; mismatch on `ret` faults. |
| **Canary vs shadow stack** | Tripwire vs integrity. |
| **Intel CET** | Hardware shadow stack (backward) + IBT (forward). |
| **IBT / `endbranch`** | Indirect branches must land on a marked entry; coarse alone. |
| **FineIBT** | IBT landing pad + software type check (fine). |
| **PAC** | Sign pointers into spare VA bits with a hidden key; verify before use. |
| **PAC residual** | Signing oracles; short-MAC brute force with an auth oracle. |
| **BTI** | ARM landing-pad enforcement; pairs with PAC. |
| **KCFI** | Kernel forward-edge CFI via per-call type hash. |
| **Floor** | None of these stop **data-only** attacks. |

---

## Summary

Canaries detect a contiguous overwrite near the return address; they are a *tripwire*, not *integrity*. The backward edge done right means the program will not *use* a forged return address even if the attacker can write it — achieved two ways. **Shadow stacks** keep a protected duplicate of every return address and fault on mismatch at `ret`; in **Intel CET** the shadow stack is hardware-managed (its pages unwritable by ordinary stores) and is paired with **IBT**, which forces indirect branches to land on `endbranch` pads — a coarse forward-edge filter made fine by **FineIBT** (landing pad + type check). **ARM PAC** instead *signs the pointer itself* into spare virtual-address bits using a key held in privileged registers, so a forged return address or function pointer fails authentication; **BTI** adds ARM landing pads, complementing PAC. Kernels use **KCFI** and **FineIBT** for tight, low-cost forward-edge CFI. The unifying senior insight: hardware changes the economics, giving cheap, tamper-resistant integrity on both edges — but **none of it stops data-only attacks**, and PAC has its own residual surface (**signing oracles**). Overclaiming is the mistake; precise guarantees are the job. `professional.md` takes on the bypass classes and deployment strategy.

---

## Further Reading

- Intel, "Control-flow Enforcement Technology" specification and developer overview (shadow stack + IBT).
- ARM, "Pointer Authentication" and "BTI" sections of the ARMv8 architecture reference; Qualcomm's PAC whitepaper.
- Apple Platform Security guide — Pointer Authentication on Apple Silicon.
- "FineIBT" paper and the Linux kernel KCFI/FineIBT documentation.
- "Pointer Authentication on ARMv8.3" (Azad et al., PAC analysis) and PAC-oracle research — read for residual risks.
- Continue to `professional.md` for CFI bypass classes and program-wide deployment.
