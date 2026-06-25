# Side Channels & Spectre — Senior Level

> **Topic:** [Side Channels & Spectre](README.md)
> **Focus:** The full transient-execution taxonomy — Spectre v1/v2/v4, Meltdown, MDS/RIDL/Fallout/ZombieLoad, L1TF/Foreshadow, retbleed/PACMAN-class — what microarchitectural structure each one leaks from, and the matching defense for each.

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
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction

> Focus: **Once you understand "transient execution leaks via the cache," how many different microarchitectural structures can you mislead into leaking — and how does each defense map to a structure?**

The middle page gave you the skeleton every transient-execution attack shares: an **encode** phase (transient, secret-dependent microarchitectural footprint) and a **read** phase (a cache attack that decodes it). The senior task is to see the *whole zoo* and to organize it. The zoo is large because a modern core has *many* speculative and out-of-order structures, and each one is a different lever an attacker can pull: the conditional branch predictor (Spectre v1), the indirect branch predictor / BTB (Spectre v2), the store-to-load forwarding / memory-disambiguation predictor (Spectre v4), the deferred handling of permission faults (Meltdown, L1TF), and the internal data buffers that hold in-flight data (MDS/RIDL/Fallout/ZombieLoad). The return-stack and indirect-branch story even came back from the dead after the first round of mitigations (retbleed).

A senior engineer must be able to do three things with this material: **(1) classify** a new "scary CPU bug" headline into the right bucket within minutes, by asking "which structure does it mislead, and is the boundary it crosses a *bounds check* (Spectre-type) or a *permission/privilege boundary* (Meltdown-type)?"; **(2) reason about defense applicability** — software-only (v1 masking) vs. firmware/microcode (v2, MDS, v4) vs. OS structural (KPTI for Meltdown) vs. scheduling/co-location policy; and **(3) reason about cost** — KPTI's TLB-flush tax, retpoline's indirect-call penalty, buffer-flush-on-context-switch, disabling hyperthreading. This page builds that classification and the defense map. The deep mitigation engineering and the performance/operations economics are `professional.md`.

> 🎓 **Why this matters for a senior:** You will be the person asked "are we affected by <today's CPU CVE>, and do we need to act?" The right answer is rarely "panic" or "ignore" — it's a reasoned mapping from the attack's mechanism to your trust boundaries (do you run untrusted code? on shared cores? across a privilege boundary?) and to the mitigations already deployed in your stack. This page gives you the framework to answer that quickly and correctly.

---

## Prerequisites

- **Required:** `middle.md` — speculative/OoO execution, the encode/read model, Flush+Reload and Prime+Probe, Spectre v1, `lfence`, index masking.
- **Required:** Virtual memory and privilege levels: user vs. kernel, page-table permission bits, the TLB, the difference between a load *issuing* and a fault *being delivered at retirement*.
- **Required:** Indirect branches (calls/jumps through a register or pointer), the return-stack buffer, and the branch-target buffer (BTB) concept.
- **Helpful:** SMT / hyperthreading — two logical threads sharing one core's structures (caches, buffers, predictors).
- **Helpful:** Store buffers and store-to-load forwarding.

You do **not** yet need: the operational rollout, microcode-update mechanics, and detailed performance-cost engineering — that is `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **BTB (Branch Target Buffer)** | Predicts the *target* of an indirect branch. Mistrained → Spectre v2. |
| **RSB (Return Stack Buffer)** | Predicts return addresses for `ret`. Underflow/mistraining underlies some v2 and retbleed variants. |
| **Branch-target injection** | Spectre v2: training the BTB so a victim's indirect branch speculatively jumps to an attacker-chosen gadget. |
| **Meltdown** | Transiently reading data across a *privilege* boundary (kernel from user) before the permission fault retires. |
| **Deferred fault** | A permission fault is detected at *retirement*, not at *issue* — so the forbidden load's data can be used transiently before the fault squashes it. |
| **KPTI / KAISER** | Kernel Page Table Isolation: unmap (most of) the kernel from user-mode page tables so Meltdown has nothing to read. |
| **SSB (Speculative Store Bypass)** | Spectre v4: a load speculatively bypasses an older store to the same address (memory-disambiguation misprediction), reading stale data. |
| **MDS (Microarchitectural Data Sampling)** | A class (RIDL, Fallout, ZombieLoad) leaking *in-flight* data from internal buffers, not from a chosen address. |
| **Line-fill buffer / store buffer / load port** | Internal staging buffers MDS variants sample from. |
| **L1TF / Foreshadow** | L1 Terminal Fault: transiently reading data present in L1 via a not-present/altered page-table entry; breaks SGX enclaves and crosses VM boundaries. |
| **Retbleed** | A return-oriented Spectre-v2-style attack that mistrains the branch predictor to mispredict `ret` instructions, bypassing some retpoline-era assumptions. |
| **PACMAN** | A speculative attack against ARM Pointer Authentication: speculatively brute-forcing a PAC without crashing, undermining a memory-safety mitigation. |
| **IBRS / STIBP / IBPB** | Indirect Branch Restricted Speculation / Single-Thread Indirect Branch Predictors / Indirect Branch Prediction Barrier — microcode controls over indirect-branch prediction (v2 defenses). |
| **eIBRS** | "Enhanced" IBRS — an always-on hardware mode that isolates indirect-branch prediction by privilege domain. |
| **Retpoline** | A software construct (a "return trampoline") that converts indirect branches into a controlled `ret` sequence the predictor can't be tricked through. |
| **VERW flush** | An instruction (re-purposed by microcode) used to flush MDS-affected buffers on a security boundary crossing. |

---

## Core Concepts

### 1. The organizing question: which structure, which boundary?

Every transient-execution attack answers two questions. Memorize them; they classify the whole zoo.

- **Which microarchitectural structure does it mislead?** A predictor (conditional, BTB, RSB, memory disambiguation) or a deferred check (permission fault) or an internal buffer (line-fill, store buffer, load port).
- **What boundary does the leak cross?** A *bounds check* within the same privilege level (the **Spectre** family — you trick a victim into leaking *its own* in-bounds-checked data) versus a *privilege/protection boundary* (the **Meltdown / L1TF / MDS** family — you directly read data you were never permitted to access).

A blunt but useful summary: **Spectre = "make the victim leak its own secret across a software check."** **Meltdown-class = "read data across a hardware protection boundary that the CPU enforces too late."** The defenses differ accordingly: Spectre is fought at the gadget and the predictor; Meltdown-class is fought by removing the data from reach (KPTI, flushing buffers, not sharing cores).

### 2. Spectre v1 — bounds-check bypass (recap, conditional branch predictor)

Covered in depth in `middle.md`. Mislead structure: the **conditional branch predictor**. Boundary crossed: a software **bounds check** (no privilege boundary). Defense: `lfence` or **index masking** (`array_index_nospec`) at the gadget; isolation of untrusted code. Software-fixable because the gadget is in your code.

### 3. Spectre v2 — branch-target injection (indirect branch predictor / BTB)

Indirect branches — calls/jumps through a function pointer, vtable, or jump table — get their *target* predicted by the **BTB**. v2 trains the BTB (often from a *different* context, e.g., an attacker process or sibling SMT thread) so that when the victim executes an indirect branch, the CPU **speculatively jumps to an attacker-chosen address** — a "Spectre gadget" already present in the victim's code. That gadget transiently performs a secret-dependent load and encodes it in cache.

This is more dangerous than v1: the attacker steers *where* the victim speculatively executes, not just *whether* it skips a check. Defenses are mostly **microcode/firmware + compiler**:

- **Retpoline** (compiler): replace indirect branches with a "return trampoline" — a contrived `call`/`ret` sequence whose speculation is steered to a benign infinite-loop pad, so the BTB can't redirect it. Costs indirect-call performance.
- **IBRS / eIBRS** (microcode/hardware): restrict or isolate indirect-branch prediction so a less-privileged domain can't influence a more-privileged one. eIBRS is the modern always-on hardware version.
- **STIBP**: prevent one SMT sibling from influencing the other's indirect-branch predictor.
- **IBPB**: a barrier that flushes indirect-branch predictor state on a context/domain switch.

### 4. Meltdown — transient read across the user/kernel boundary (deferred fault)

Meltdown is the Meltdown-class archetype. A user-mode load of a *kernel* address normally faults — but on affected CPUs the **permission check is resolved at retirement, not at issue**. So the load's *data* is forwarded to dependent instructions **transiently**, *before* the fault squashes everything. The attacker uses that brief window to do the standard encode: `probe[kernel_byte * 64]`, leaving a cache footprint, then reads it back. Architecturally the fault is delivered and no kernel value lands in a register — but the cache footprint already leaked it.

Meltdown is *not* fixed by patching code (there is no gadget — the attacker writes the whole thing). It is fixed **structurally** by **KPTI/KAISER**: unmap the kernel from the user-mode page tables, so when user code transiently reads a kernel address, there is simply *no mapping* and *no data* to forward. The cost is a page-table switch (and historically a TLB flush) on every user↔kernel transition — the headline "Meltdown patch slowdown." Newer CPUs fix the deferred-fault behavior in hardware, removing the need for KPTI.

### 5. Spectre v4 — speculative store bypass (memory-disambiguation predictor)

When a load follows a store whose address isn't yet computed, the CPU *predicts* whether they alias. If it predicts "no alias," the load **speculatively bypasses the older store** and reads the *stale* value from cache/memory — then later discovers they *did* alias and squashes. During that window, code can transiently operate on stale data, which can become a gadget (notably in language sandboxes/JITs that rely on a just-written guard or mask). Mislead structure: the **memory-disambiguation / store-to-load-forwarding predictor**. Defense: **SSBD (Speculative Store Bypass Disable)** via microcode/MSR (turn off the bypass for sensitive code), plus sandbox hardening. SSBD has a performance cost, so it is often enabled selectively (e.g., for processes that run untrusted code).

### 6. MDS / RIDL / Fallout / ZombieLoad — sampling internal buffers

The MDS family is different in spirit: instead of choosing an address, the attacker **samples whatever data happens to be in flight** in internal CPU buffers — the **line-fill buffer**, **store buffer**, and **load ports**. A faulting or assisting load can transiently receive *stale data from these buffers* that belongs to another context (another thread, another privilege level, even another VM on the same core via SMT). It's a "scoop up whatever's passing through" attack — lower precision (you don't target a specific address; you sample and filter), but it crosses boundaries the address-based attacks can't.

- **RIDL** (line-fill buffer), **Fallout** (store buffer), **ZombieLoad** (multiple buffers) are the named instances.
- Defense: **microcode that flushes the affected buffers on security-boundary crossings** (re-purposed `VERW`), often combined with **disabling SMT** for the strongest guarantee, since an SMT sibling shares those buffers concurrently. Later CPUs fix it in hardware.

### 7. L1TF / Foreshadow — L1 terminal fault

L1TF abuses page-table entries marked *not present* (or with manipulated physical address bits). On affected CPUs, a load to such an address can **transiently read whatever data sits at that physical address in the L1 cache**, ignoring the not-present bit during speculation. This is potent: it breaks **SGX enclaves** (Foreshadow), and across **hypervisor/VM** boundaries it lets a guest read host or other-guest data resident in L1. Defenses: **flush L1D on VM entry**, **page-table inversion** for not-present entries (so the physical address bits point to non-existent memory), and — for the cross-VM SMT case — **core scheduling / disabling SMT** so an attacker VM and victim VM never share a core's L1 simultaneously.

### 8. Retbleed and the PACMAN-class — the arms race continues

Mitigations created assumptions that later attacks broke:

- **Retbleed** showed that on some CPUs, `ret` instructions can be predicted via the same BTB-style machinery as indirect branches, so the retpoline assumption ("returns are safe") didn't hold universally. The fix involved additional microcode and, on affected parts, return-stack-stuffing / IBPB-style measures — at a real performance cost.
- **PACMAN** (a class on ARM) attacked **Pointer Authentication (PAC)**: it used speculation to *brute-force a PAC value without crashing the process*, since wrong guesses are squashed transiently rather than faulting architecturally. This undermines a *memory-safety* mitigation using a *side channel*, illustrating the recurring theme: **transient execution can quietly probe any check that would normally fault, by testing it speculatively where mistakes are free.**

The senior takeaway is not the name list — it's the pattern: each new structure or each new mitigation assumption is a new attack surface, and the defense map keeps expanding.

### 9. The defense map (structure → mitigation → layer)

| Attack | Structure misled | Boundary | Primary mitigation | Layer |
|--------|------------------|----------|--------------------|-------|
| Spectre v1 | Conditional predictor | Bounds check | `lfence` / index masking | Software / compiler |
| Spectre v2 | BTB (indirect) | Bounds/domain | Retpoline + IBRS/eIBRS/STIBP/IBPB | Compiler + microcode |
| Spectre v4 | Mem-disambiguation | Stale-data | SSBD (selective) | Microcode + sandbox |
| Meltdown | Deferred fault | User↔kernel | KPTI/KAISER | OS (or HW fix) |
| MDS/RIDL/etc. | Internal buffers | Cross-domain/SMT | Buffer flush (VERW) + disable SMT | Microcode + scheduling |
| L1TF/Foreshadow | L1 + not-present PTE | Enclave/VM | L1D flush + PTE inversion + core sched | OS/hypervisor + microcode |
| Retbleed | RSB/BTB for `ret` | Domain | Extra microcode + return stuffing | Microcode + kernel |
| PACMAN | Speculation vs. PAC | Memory-safety mitigation | HW/arch hardening of PAC checks | Hardware/arch |

---

## Real-World Analogies

**Spectre vs. Meltdown — burglar vs. inside job.** Meltdown is a burglar who walks into a vault that *should* be locked but the lock only clicks shut *a second after* the door opens — they grab what they can in that second. Spectre is subtler: you can't get into the vault, so you trick an *authorized clerk* into fetching a secret "by mistake" and leaving it on the counter (the cache) where you can read it.

**v2 (branch-target injection) — forging the GPS destination.** The victim's car uses GPS to pick where to drive (indirect branch). You hack the GPS history so it momentarily routes the car to a spot *you* chose — where a useful "gadget" is parked — before it realizes the route was wrong and turns back. The brief detour is enough to leak.

**MDS — eavesdropping on the conveyor belt.** Instead of asking for a specific package, you stand next to the shared conveyor belt (internal buffers) and photograph whatever happens to pass — letters meant for other departments included. Lower aim, but you see traffic you were never meant to.

**L1TF — reading through a "wall under construction" sign.** A wall is marked "not built yet" (not-present page), but there's actually a finished room behind it (data in L1). On affected hardware, you can peek through during the moment the CPU hasn't yet enforced the sign.

**PACMAN — guessing a PIN with a silent keypad.** Normally a wrong PIN locks you out (faults). Here, wrong guesses are *silent and free* because they happen speculatively — so you brute-force the PIN without ever triggering the alarm.

---

## Mental Models

**Model 1: Two families, one question each.** Spectre family → "what *check* did I trick the victim into speculating past?" Meltdown family → "what *protection* did the hardware enforce too late, letting me transiently read forbidden data?"

**Model 2: Predictor or buffer or deferred fault.** Every attack misleads one of three kinds of structure. Predictors (conditional/BTB/RSB/disambiguation) → Spectre-style. Deferred faults → Meltdown/L1TF. Internal buffers → MDS. Naming the structure tells you the mitigation layer.

**Model 3: Mitigations create new assumptions, attacks break them.** Retpoline assumed returns were safe → retbleed. PAC assumed wrong guesses fault → PACMAN. Treat every mitigation as a hypothesis that the next paper will test.

**Model 4: SMT is a force multiplier for the attacker.** Many of the nastiest cross-domain leaks (MDS, L1TF, some v2) rely on two logical threads sharing one core's buffers/caches *at the same time*. "Disable SMT" recurs as the heaviest hammer precisely because it removes that concurrency.

**Model 5: Free speculative probing.** Anything that would normally *fault* (a wrong PAC, a not-present page, an out-of-bounds index) can be *tested* speculatively where the fault is squashed and free. That is the unifying superpower of the whole class.

---

## Code Examples

### Recognizing a v2 indirect-branch gadget surface

```c
/* Indirect branches through attacker-influenceable function pointers are the
 * v2 attack surface. Retpoline (compiler flag) converts these so the BTB
 * cannot redirect speculation. You usually enable the flag, not hand-write it. */
typedef int (*handler_t)(int);
int dispatch(handler_t h, int arg) {
    return h(arg);     /* indirect call -> BTB-predicted target -> v2 surface */
}
/* Build with -mretpoline (or the toolchain's equivalent) for untrusted-input code. */
```

### Spectre v4 (SSB) — the stale-load shape (for recognition)

```c
/* A guard write followed quickly by a dependent load. If the store's address
 * resolves late, the load may speculatively bypass it and read STALE data. */
void sandbox_check(uint8_t *guard, uint8_t *data, size_t idx) {
    *guard = 0;                 /* "deny" written here */
    if (*guard) {               /* may transiently still read the OLD (allow) value */
        leak(data[idx]);        /* gadget runs on stale guard */
    }
}
/* Mitigation: SSBD (microcode/MSR) for processes running untrusted code;
   plus restructuring so security guards don't depend on store-to-load timing. */
```

### Constant-time discipline is still your application-layer job

```rust
// Transient-execution variants are mitigated below your code (microcode/OS/
// compiler). What YOU still own at the app layer is classic constant-time:
use subtle::ConstantTimeEq; // the `subtle` crate

fn verify_tag(a: &[u8], b: &[u8]) -> bool {
    // Constant-time, branch-free, no early exit, no secret-indexed memory.
    a.ct_eq(b).into()
}
```

> The senior point: the transient-execution zoo is fought by the platform; your code's responsibility is to (a) not write Spectre-v1 gadgets in security-sensitive index-handling code, (b) keep untrusted code off shared cores, and (c) keep classic constant-time hygiene.

---

## Pros & Cons

| Mitigation | Upside | Downside |
|------------|--------|----------|
| **KPTI** (Meltdown) | Structurally removes kernel data from user reach. | Page-table switch / TLB cost on every syscall; historically large for syscall-heavy workloads. |
| **Retpoline** (v2) | Software-deployable; no microcode dependency on older CPUs. | Slows indirect calls; partially obsoleted/complicated by retbleed. |
| **IBRS/eIBRS** (v2) | Hardware-enforced domain isolation; eIBRS is low-overhead, always-on. | Older IBRS had high overhead; requires microcode/CPU support. |
| **SSBD** (v4) | Closes speculative store bypass. | Per-process performance cost; usually enabled selectively. |
| **VERW buffer flush** (MDS) | Closes buffer sampling at boundary crossings. | Flush cost per crossing; full safety often wants SMT off. |
| **Disable SMT** | Strongest cut for cross-thread leaks (MDS/L1TF). | Can cut throughput substantially; major capacity/cost impact in fleets. |
| **L1D flush + PTE inversion** (L1TF) | Protects enclaves and VM boundaries. | Flush cost on VM entry; scheduling complexity. |

---

## Use Cases

You reason with this taxonomy when:

- **Triaging a new CPU CVE:** classify it (structure + boundary), check whether your trust model is exposed (do you run untrusted code? across which boundary?), and confirm the relevant mitigation is deployed.
- **Designing multi-tenant infrastructure:** decide SMT policy, core scheduling, and co-location rules based on which cross-tenant attacks (MDS, L1TF) your hardware/microcode still allows.
- **Hardening a sandbox/JIT (browser, serverless, WASM runtime):** address v1 gadgets, v4 (SSBD), v2 (retpoline/eIBRS), and the timing primitives attackers need.
- **Protecting enclaves (SGX) or confidential computing:** L1TF/Foreshadow and MDS directly threaten enclave confidentiality; you must know the mitigations and their residual gaps.
- **Architecture review for security products:** ensuring a mitigation (PAC, retpoline) isn't itself defeated speculatively (PACMAN, retbleed).

---

## Coding Patterns

**Pattern: classify-then-check.** For any new variant, write down (structure misled, boundary crossed) → look up the mitigation layer → verify it's active in your kernel/microcode/compiler flags.

**Pattern: defense in depth across layers.** No single mitigation covers the zoo. Combine compiler (retpoline, v1 masking), microcode (IBRS/SSBD/VERW), OS (KPTI), and scheduling (SMT/core isolation).

**Pattern: isolate by trust, not just by tenant.** Put untrusted code on its own cores/processes/VMs; never let it share a core's buffers/caches with high-value secrets.

**Pattern: don't let mitigations lull you.** Re-audit when a new attack breaks a mitigation assumption (retbleed vs. retpoline; PACMAN vs. PAC).

---

## Best Practices

1. **Memorize the two-question classifier** (structure? boundary?) so you can place any new variant fast.
2. **Map each mitigation to the boundary it protects** — KPTI for user/kernel, VERW+SMT-off for cross-thread buffers, L1D flush for VM/enclave, retpoline/eIBRS for indirect branches.
3. **Decide SMT policy deliberately.** For workloads that co-locate untrusted code with secrets on shared cores, disabling SMT may be necessary despite the throughput hit.
4. **Keep microcode, kernel, and compilers current.** Most of these are mitigated below your application; your job is ensuring the mitigations are present and enabled.
5. **Treat every mitigation as provisional.** Track follow-on research (retbleed, PACMAN) that erodes prior assumptions.
6. **Still write constant-time application crypto.** The classic channel never went away and is fully in your control.

---

## Edge Cases & Pitfalls

- **Confusing Spectre with Meltdown.** They need *different* defenses. Calling a privilege-boundary leak "a Spectre variant" leads to applying the wrong mitigation.
- **Assuming KPTI helps against Spectre.** KPTI addresses Meltdown (data-in-reach), not Spectre v1/v2 (gadget/predictor). Different problem, different fix.
- **Leaving SMT on for confidential workloads.** Many cross-domain attacks (MDS, L1TF) require concurrent SMT siblings; "we patched microcode" may not be enough without SMT off.
- **Trusting retpoline post-retbleed.** On affected CPUs retpoline alone is insufficient; additional measures are needed.
- **Forgetting the read phase still needs a timing primitive.** Cutting high-resolution timers and shared-memory timers (in browsers) degrades the read phase for *all* of these.
- **Over-mitigating uniformly.** Applying every mitigation to every workload wastes enormous performance. Mitigate by *trust boundary exposure*, not blanket fear.
- **Assuming hardware fixes are universal.** Newer silicon fixes some variants in hardware, but your fleet is heterogeneous; the oldest CPU sets your exposure.

---

## Test Yourself

1. State the two classification questions and apply them to Meltdown and to Spectre v2.
2. Why is Meltdown fixed by KPTI (structural) while Spectre v1 is fixed at the gadget (software)? What's the underlying difference?
3. What structure does Spectre v2 mislead, and how do retpoline and eIBRS each defeat it?
4. How does MDS differ in *targeting* from Meltdown — and why does that make "disable SMT" a recurring remedy?
5. Why does L1TF/Foreshadow threaten SGX enclaves and cross-VM isolation specifically?
6. Explain how retbleed and PACMAN each broke an assumption created by an earlier mitigation.
7. Give the "deferred fault" mechanism in one sentence and name two attacks that exploit it.
8. For a multi-tenant cloud running untrusted guest code, list the mitigations you'd verify and why.

---

## Cheat Sheet

| Variant | Mislead | Boundary | Fix |
|---------|---------|----------|-----|
| Spectre v1 | Cond. predictor | Bounds check | `lfence` / index mask |
| Spectre v2 | BTB | Indirect branch / domain | Retpoline + (e)IBRS/STIBP/IBPB |
| Spectre v4 | Mem-disambig. | Stale store-to-load | SSBD (selective) |
| Meltdown | Deferred fault | User↔kernel | KPTI/KAISER |
| MDS/RIDL/ZombieLoad | Internal buffers | Cross-domain/SMT | VERW flush + SMT off |
| L1TF/Foreshadow | L1 + not-present PTE | Enclave/VM | L1D flush + PTE inversion + core sched |
| Retbleed | RSB/BTB for `ret` | Domain | Extra microcode/return stuffing |
| PACMAN | Speculate vs. PAC | Memory-safety mitigation | HW PAC hardening |

**Meta-rule:** Spectre = trick the victim past a *check*; Meltdown-class = read across a *protection boundary* enforced too late.

---

## Summary

The transient-execution zoo is large but organizable by two questions: **which microarchitectural structure does the attack mislead** (conditional predictor, BTB/RSB, memory-disambiguation predictor, deferred permission fault, or internal data buffers), and **which boundary does it cross** (a software *bounds check* — the **Spectre** family — or a hardware *privilege/protection boundary* — the **Meltdown/L1TF/MDS** family). **Spectre v1** misleads the conditional predictor past a bounds check; **v2** injects branch targets via the BTB to redirect the victim's speculation; **v4** speculatively bypasses an older store to read stale data. **Meltdown** transiently reads kernel memory because the permission fault is resolved at retirement, not at issue; **L1TF/Foreshadow** reads L1 data through not-present page-table entries, breaking enclaves and VM isolation; **MDS/RIDL/Fallout/ZombieLoad** sample whatever data is in flight in internal buffers, often across SMT siblings. **Retbleed** and **PACMAN** show the arms race: each defeated an assumption a prior mitigation created (retpoline's "returns are safe," PAC's "wrong guesses fault").

The defenses map to the structure and boundary: **`lfence`/index masking** (v1, software), **retpoline + IBRS/eIBRS/STIBP/IBPB** (v2, compiler+microcode), **SSBD** (v4, selective microcode), **KPTI** (Meltdown, OS), **VERW buffer flush + disabling SMT** (MDS), **L1D flush + PTE inversion + core scheduling** (L1TF). No single fix covers the zoo, all cost performance, and the oldest CPU in your fleet sets your real exposure. The senior skill is to classify a new variant in minutes, map it to your trust boundaries, confirm the right mitigation is active, and decide — by exposure, not by panic — whether to act. The economics and rollout of all this is `professional.md`.

---

## Further Reading

- The Meltdown paper (Lipp et al., 2018) and the Spectre paper (Kocher et al., 2018).
- Foreshadow / L1TF papers; the RIDL, Fallout, and ZombieLoad (MDS) papers.
- "Retbleed" (Wikner & Razavi) and "PACMAN" (Ravichandran et al.).
- Intel's and AMD's transient-execution mitigation documentation (IBRS/eIBRS/STIBP/IBPB/SSBD/MD_CLEAR).
- Continue in `professional.md` for mitigation engineering, the performance/operations economics, and verifying constant-time code at scale.
