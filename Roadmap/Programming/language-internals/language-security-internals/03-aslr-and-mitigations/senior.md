# ASLR & Mitigations — Senior Level

> **Topic:** [ASLR & Mitigations](README.md)
> **Focus:** The bypass *classes* — info-leak-then-reuse, brute force on forking servers, partial overwrites, JIT spray, side-channel de-randomization — and the modern hardening that answers them: re-randomization, shadow stacks, CET, and KASLR.

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
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **Why does ASLR fail in the field, and what replaces or augments it — so you can reason about the security of a system the way an attacker and a defender both do?**

A senior engineer's job is not to recite "ASLR randomizes addresses." It is to predict *how a real attacker bypasses it* and to design systems whose defenses don't collapse to a single bug. The central truth: **modern ASLR bypasses are not about beating randomization head-on — they're about getting the addresses by other means.** An information leak hands them over. A forking server hands them over by repetition. A partial overwrite sidesteps them. A JIT hands the attacker a writable-executable region whose contents they influence. A microarchitectural side channel can recover them without ever reading them through the program's logic.

Understanding these bypass *classes* is what lets you reason about residual risk. When you enable Full RELRO, NX, PIE, and canaries, you have forced the attacker into a specific shape: **they now need an info leak plus a control-flow corruption, and they must turn those into a reuse chain (ROP/JOP) against addresses the leak revealed.** That's a much higher bar than 1996's "inject shellcode and jump." But it's not infinite, which is why the frontier moved on: **re-randomization** (move the targets faster than they can be used), **shadow stacks and CET** (make return-address and indirect-call corruption fail even with addresses in hand), and **KASLR** for the kernel (with its own famous breaks, like Meltdown).

This page is conceptual and defensive throughout. We describe attack *classes* at the level a defender needs to design countermeasures; we do not provide working exploits, gadgets, or chains.

---

## Prerequisites

- **Required:** The middle-level mechanics: who randomizes what at exec, entropy quantification, the GOT/PLT call path, Partial vs. Full RELRO, NX forcing code reuse, partial overwrites within a page.
- **Required:** Comfort with the idea of **code reuse** attacks (return-to-libc, ROP/JOP) at a conceptual level — chaining existing executable fragments instead of injecting code.
- **Required:** Virtual memory, page permissions, and the difference between user-space and kernel-space address randomization.
- **Helpful:** Awareness of microarchitecture (caches, TLBs, speculative execution) for the side-channel discussion.
- **Helpful:** Familiarity with how JITs allocate and emit executable memory.

You do **not** need to write exploits; we reason about classes and defenses, not payloads.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Code reuse attack** | Hijacking control flow to chain together existing executable code instead of injecting new code. ROP and JOP are instances. |
| **ROP (Return-Oriented Programming)** | Chaining short instruction sequences ("gadgets") ending in `ret`, driven by a crafted stack, to compute arbitrary behavior from existing code. |
| **JOP (Jump-Oriented Programming)** | Like ROP but built around indirect jumps/calls rather than returns; relevant when return-protection is deployed. |
| **Gadget** | A short sequence of existing instructions ending in a controllable transfer (`ret`, `jmp reg`, `call reg`). |
| **Info leak** | A vulnerability disclosing a real runtime address, collapsing ASLR for the containing region. |
| **BROP (Blind ROP)** | A technique to build a ROP attack against a *forking* server with no binary and no leak, by observing crash-vs-survive behavior across attempts that share the parent's layout. |
| **JIT spray** | Coercing a JIT to emit predictable executable bytes whose embedded constants form usable instructions, sidestepping ASLR/DEP by attacking the predictable JIT region. |
| **Side-channel de-randomization** | Recovering layout information through timing/microarchitectural effects (cache, TLB, branch predictor) rather than logical disclosure. |
| **Re-randomization** | Periodically re-randomizing a running process's layout so leaked addresses go stale before they can be used. |
| **Shadow stack** | A separate, protected stack holding a copy of return addresses; a mismatch on return aborts — defeats return-address overwrite. |
| **CET (Control-flow Enforcement Technology)** | Intel hardware: a shadow stack (return protection) plus IBT (indirect-branch tracking via `endbr` landing pads). |
| **IBT** | Indirect Branch Tracking: indirect calls/jumps must land on an `endbr` instruction, constraining JOP/COP. |
| **KASLR** | Kernel ASLR: randomizing the kernel's base load address. |
| **KPTI** | Kernel Page-Table Isolation: separates kernel/user page tables, a mitigation for Meltdown that also re-strengthens KASLR. |

---

## Core Concepts

### 1. The modern exploit shape ASLR forces

With NX + ASLR + Full RELRO + canaries deployed, the attacker can no longer inject shellcode, can no longer hardcode addresses, can no longer overwrite the GOT, and can no longer naively smash the stack past a canary. So the canonical exploit becomes a **two-bug** affair:

1. **An information leak** to defeat ASLR — recover the base of a region containing useful code (often libc).
2. **A memory-corruption primitive** to hijack control flow — overwrite a return address, a function pointer, or a vtable.

The hijack then drives a **code-reuse chain** (ROP/JOP) built from gadgets at addresses the leak revealed. The whole point of the senior view is that each mitigation you removed from the attacker's path *added a required capability to their attack.* ASLR's specific contribution: it converts "I know where the gadgets are" into "I must leak where the gadgets are." That's why **the info leak is the master key.**

### 2. Bypass class A: info-leak-then-reuse

The dominant class. Any primitive that discloses a real pointer suffices: an out-of-bounds *read* (format-string `%p`, a length-confusion that returns adjacent memory, an uninitialized-memory disclosure, a type confusion that reads a vtable pointer). Because a region's internal layout is fixed and only its base is randomized, **one leaked pointer yields the base by subtraction**, and from the base every address in that region is computable. Defensive implications:

- Out-of-bounds *reads* are as dangerous as writes — they're ASLR's undoing. Treat read-disclosure bugs as critical.
- Minimizing what a leak reveals (e.g., not co-locating sensitive code with leakable data) raises the cost.
- This class is why **re-randomization** and **leak-resistant designs** (below) exist: the only structural answer to "they will eventually leak something" is to make the leak stale or useless.

### 3. Bypass class B: brute force on forking servers (the BROP insight)

`fork()` copies the parent's address space, *including its randomization*. A server that forks a worker per connection and respawns identically on crash gives the attacker **many attempts against the same layout**. Two consequences:

- **Brute force becomes feasible even at 64-bit entropy** for the *purpose of locating a few key addresses*, because the attacker isn't guessing the whole space at once — they probe one byte/region at a time, using the **crash-vs-no-crash signal** as an oracle. Each probe either crashes the child (wrong) or doesn't (right), and the layout never changes, so information accumulates across attempts.
- **BROP (Blind ROP)** generalizes this: an attacker with *no copy of the binary and no explicit leak* can, against such a server, discover enough gadgets to build a chain purely from the crash oracle, then use a write primitive to dump the binary and complete a normal ROP attack.

Defensive answer: **break the shared-layout assumption.** Re-`exec` workers (fresh randomization), use crash-only respawn that re-randomizes, rate-limit/penalize crashes, and detect crash storms. The vulnerability isn't ASLR's entropy; it's the *reuse of one randomized layout across many trials*.

### 4. Bypass class C: partial overwrites and low-entropy footholds

Recall ASLR randomizes high bits; the page offset (low ~12 bits) is fixed. If a bug lets the attacker overwrite only the **low byte(s)** of a saved pointer, they can retarget it *within the same page or nearby* with **certainty**, not probability — no entropy is defeated because the randomized bits are untouched. This is potent against vtable/function pointers where a nearby method or gadget is reachable by changing a few low bits. Defensive implications:

- High entropy doesn't help against partial overwrites; you need to stop the *write* (bounds checking, memory safety) or make the nearby targets useless (CFI/IBT).
- Co-locating hostile-reachable pointers near useful code is risky.

### 5. Bypass class D: JIT spray vs. ASLR/DEP

A JIT compiler must allocate **executable** memory and fill it with attacker-influenceable content (the program being JIT-compiled). **JIT spray** exploits this: the attacker writes high-level code whose *constants* encode useful machine instructions; when the JIT emits the constants, the executable region contains attacker-chosen instruction bytes — sidestepping both DEP (the region is legitimately executable) and ASLR (the JIT region is large and/or predictably placed, so jumping into it doesn't require a precise address). Defensive answers, mostly the JIT's responsibility:

- **W^X for JIT memory:** never have a page simultaneously writable and executable; emit to a writable mapping, then flip to executable (dual-mapping / `MAP_JIT` on macOS, `mprotect` toggling, or a separate writer).
- **Constant blinding:** XOR constants with a per-process random key so attacker-controlled constants don't survive into emitted code verbatim.
- **Randomize JIT region placement and add guard pages / NOP insertion** to break the predictability JIT spray relies on.

### 6. Bypass class E: side-channel de-randomization

Randomization assumes the attacker can't learn the layout. **Microarchitectural side channels** break that assumption without any logical disclosure:

- **Cache/TLB timing** can reveal whether a given virtual address is mapped or which page a victim touched, leaking layout bits.
- **Branch-predictor and prefetch side channels** have been shown to recover kernel and user ASLR offsets.
- **Speculative-execution attacks** (the Meltdown/Spectre family) can read memory across protection boundaries; **Meltdown in particular was used to defeat KASLR** by reading kernel memory from user space, recovering the kernel's randomized base.

The defensive lesson: **ASLR's secret is only as strong as the hardware's ability to keep it.** Side channels are largely addressed at the hardware/OS level (KPTI, microcode, speculation barriers), not by application code — but a senior must know that "we have ASLR" is not a guarantee against an attacker with a side-channel primitive.

### 7. KASLR and its breaks

**KASLR** randomizes the *kernel's* base address so that kernel exploits can't hardcode kernel symbol addresses. It faces the same weaknesses as user-space ASLR, amplified:

- **Lower practical entropy** historically (the kernel maps into a constrained range), and many side channels target it specifically.
- **Meltdown** (2018) read kernel memory from unprivileged user space, trivially recovering the kernel base and defeating KASLR. The mitigation, **KPTI (Kernel Page-Table Isolation)**, unmaps most of the kernel from the user page tables, which both blocks Meltdown's read *and* removes the mapped kernel addresses a timing side channel could probe — restoring much of KASLR's value (at a context-switch performance cost).
- **FGKASLR (function-granular KASLR)** goes further by randomizing the *order of functions* within the kernel, so leaking one kernel address no longer reveals all of them — directly attacking the "move the deck, not the cards" weakness.

### 8. Modern hardening: making addresses-in-hand insufficient

The strategic shift: instead of only hiding addresses (which leaks defeat), make **knowing the address insufficient to hijack control flow.**

- **Re-randomization:** periodically re-randomize a live process (e.g., on a timer, or after handling a request) so any leaked address goes stale. The challenge is doing it cheaply and consistently (fixing up all live pointers), which limits adoption but research systems (e.g., Shuffler-style designs) demonstrate it.
- **Shadow stacks:** keep a second, protected copy of every return address. On `ret`, hardware/runtime compares; a mismatch (because an overflow rewrote the normal stack's return address) aborts. This **neutralizes return-address overwrite even when the attacker knows every address** — it attacks the corruption, not the secrecy.
- **Intel CET = shadow stack + IBT.** IBT requires every indirect call/jump target to be an `endbr64` landing pad, sharply constraining JOP/COP gadget chains. ARM's analogues are **PAC (Pointer Authentication)** — signing pointers with a key so a corrupted pointer fails verification — and **BTI (Branch Target Identification)**.
- **CFI (Control-Flow Integrity)**, software or hardware-assisted, restricts indirect transfers to a precomputed legal set, gutting reuse chains.

The senior framing: **ASLR is the probabilistic layer; shadow stacks/CET/PAC/CFI are the deterministic layer.** Modern defense combines both, so that beating ASLR (via leak) still leaves the attacker facing control-flow enforcement that an address alone can't bypass.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Info-leak-then-reuse** | A spy who can't find the vault but bribes one clerk for *one* room number — and, knowing the floor's fixed blueprint, now maps the whole wing. |
| **BROP / fork brute force** | A thief who gets unlimited do-overs because the building resets to the *same* layout after every failed break-in; each failure teaches them one more thing. |
| **Partial overwrite** | Not picking the lock, just bending the doorknob a few degrees to point the latch at the next room over — the random part of the address was never touched. |
| **JIT spray** | Bribing the building's own print shop to print your forged instructions on official paper — the paper is legitimately "executable," so guards wave it through. |
| **Side-channel de-randomization** | Reading which room the VIP is in from the warmth of the hallway floor, never opening a single door. |
| **Re-randomization** | Re-shuffling all the rooms every few minutes, so the clerk's leaked number is wrong before the spy can use it. |
| **Shadow stack / CET** | Even with the right room number, the door now needs a second, sealed key copy that the spy can't forge — knowing the address no longer opens it. |

---

## Mental Models

### The "secrecy layer vs. enforcement layer" model

Sort every mitigation into two buckets. **Secrecy** (ASLR, KASLR) hides where things are — defeated by leaks, brute force, side channels. **Enforcement** (shadow stacks, CET/IBT, PAC, CFI, RELRO) makes a corrupted control transfer *fail* regardless of what the attacker knows. Secrecy is probabilistic and brittle; enforcement is deterministic and durable. A serious system needs both, and you should be able to say, for any given attack, which layer is doing the work and which has been bypassed.

### The "address vs. capability" model

ASLR withholds an *address*. Modern attacks often withhold nothing about addresses (they leak them) and instead attack the *capability* to use them. So ask two separate questions of any defense: "Does it stop the attacker from *learning* the address?" and "Does it stop the attacker from *using* a known address to hijack control?" ASLR answers only the first; shadow stacks/CET answer the second.

### The "shared layout is the vulnerability" model

For the entire brute-force/BROP class, the bug isn't entropy — it's *reuse of one randomized layout across many attempts*. Whenever a design re-uses a single randomization (fork-without-exec, snapshotted images, restored checkpoints, container images sharing a base), you've converted a strong one-shot defense into a weak many-shot one. Hunt for shared layouts.

---

## Code Examples

Defensive and observational; no exploits.

### Checking for CET / shadow-stack support and opt-in

```bash
# Does the CPU/OS advertise CET shadow stack + IBT?
grep -o 'user_shstk\|ibt' /proc/cpuinfo | sort -u
# Is a binary built with CET landing pads / shstk?
readelf -n ./program | grep -i 'SHSTK\|IBT'     # GNU property notes
```

```bash
# Build with CET (shadow stack + IBT) where supported:
gcc -O2 -fcf-protection=full -fPIE -pie \
    -Wl,-z,relro,-z,now,-z,shstk program.c -o program
```

### Confirming KASLR and KPTI on Linux

```bash
# Is the kernel base randomized? (look for 'nokaslr' to know it's OFF)
cat /proc/cmdline | tr ' ' '\n' | grep -i kaslr   # absence of nokaslr => on

# Is KPTI (Meltdown mitigation, also re-strengthens KASLR) active?
cat /sys/devices/system/cpu/vulnerabilities/meltdown
# e.g.: "Mitigation: PTI"
dmesg | grep -i 'page table isolation'
```

### Detecting a forking server's shared-layout exposure (audit, not attack)

```bash
# Compare the libc base across two children of the same forking parent.
# If identical, the parent did fork WITHOUT exec -> shared randomization.
for pid in $(pgrep -P "$PARENT_PID"); do
  grep -m1 libc /proc/"$pid"/maps | awk '{print $1}'
done | sort -u
# One unique base => shared layout (brute-forceable). Many => re-exec'd.
```

### Re-exec-on-fork pattern (restores re-randomization)

```c
// After fork(), do NOT just run the handler in the child.
// execve() the worker so the kernel re-randomizes its layout.
pid_t pid = fork();
if (pid == 0) {
    // Child: replace image -> fresh ASLR for this worker.
    execve("/path/to/worker", argv, envp);
    _exit(127);   // exec failed
}
// Parent continues accepting connections.
```

### W^X discipline for a JIT region (conceptual)

```c
// NEVER map writable+executable at once. Write, then flip.
void *code = mmap(NULL, len, PROT_READ | PROT_WRITE,        // writable, not exec
                  MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
emit_machine_code(code, len);                                // fill it
mprotect(code, len, PROT_READ | PROT_EXEC);                  // now exec, not write
// Plus: constant-blind emitted immediates, randomize placement, add guard pages.
```

---

## Pros & Cons

| Mitigation | Strength | Limit / what bypasses it |
|------------|----------|--------------------------|
| **ASLR (secrecy)** | Cheap; forces a leak; layered with NX forces reuse. | Info leak, fork brute force, partial overwrite, side channels. |
| **Re-randomization** | Makes leaked addresses go stale; structural answer to leaks. | Hard to do cheaply and pointer-consistently; limited deployment. |
| **Shadow stack** | Deterministically blocks return-address overwrite even with addresses known. | Needs hardware/runtime support; doesn't stop forward-edge (call/jump) hijacks. |
| **CET IBT / BTI** | Constrains indirect-branch targets; guts JOP/COP. | Coarse (any `endbr` is legal); doesn't pin the *exact* intended target. |
| **PAC (ARM)** | Cryptographically signs pointers; corruption fails verification. | Key-recovery and signing-gadget reuse concerns; coverage gaps. |
| **CFI (software)** | Restricts indirect transfers to a legal set. | Precision/perf trade-off; coarse CFI still allows some reuse. |
| **KASLR** | Hides kernel base from kernel-exploit hardcoding. | Side channels, Meltdown; needs KPTI/FGKASLR to be meaningful. |

---

## Use Cases

- **Threat-modeling a network service.** Enumerate which bypass classes apply: Is it forking (BROP risk)? Does it expose read primitives (leak risk)? Does it JIT (spray risk)? Then map each to a defense.
- **Choosing the deterministic layer.** On modern x86, enable CET (shadow stack + IBT); on ARM, PAC + BTI. These hold even when ASLR is leaked.
- **Hardening a browser/runtime with a JIT.** W^X JIT memory, constant blinding, region randomization — the JIT is the soft spot ASLR/DEP don't cover.
- **Kernel/hypervisor hardening.** KASLR + KPTI + FGKASLR; treat any kernel info-leak as critical, since it collapses KASLR.
- **Designing crash-resilient servers without creating an oracle.** Re-exec workers, rate-limit crashes, alert on crash storms — deny the repeated-identical-layout the brute-force class needs.

---

## Coding Patterns

### Pattern 1: Pair secrecy with enforcement

Never rely on ASLR alone. Enable a deterministic control-flow defense (CET/shadow stack on x86, PAC/BTI on ARM, or software CFI) so that a leak that beats ASLR still doesn't yield control-flow hijack.

### Pattern 2: Deny the brute-force oracle

For forking/crash-respawn servers: re-`exec` workers for fresh randomization; cap crash rate per source; treat a crash storm as an attack signal, not noise. The defense targets *layout reuse*, not entropy.

### Pattern 3: Treat read-disclosure bugs as critical

Out-of-bounds reads, uninitialized-memory disclosure, and verbose error/diagnostic output that emits pointers are ASLR-bypass primitives. Gate them like memory-corruption bugs.

### Pattern 4: Lock down JIT memory

W^X (write-then-flip, never both), constant blinding, randomized + guard-paged placement. The JIT is where DEP and ASLR have the least leverage.

### Pattern 5: Where possible, remove the bug class

The most durable answer to every bypass class is **memory safety**: a memory-safe language (or safe subset / sanitizer-verified code) removes the out-of-bounds reads and writes that all of these classes depend on. Mitigations are for the native code you can't yet make safe.

---

## Best Practices

- **Deploy both layers:** ASLR/KASLR (secrecy) *and* shadow stack/CET/PAC/CFI (enforcement).
- **Full RELRO, NX, PIE, canaries, FORTIFY** remain table stakes; add `-fcf-protection=full`, `-z shstk` where supported.
- **Re-`exec` forked workers; rate-limit and alert on crashes** to kill the BROP/brute-force class.
- **Audit for shared randomization** (fork-without-exec, restored snapshots, golden images) — it's the recurring structural flaw.
- **Treat info leaks (including OOB reads) as critical**, equal to corruption bugs.
- **Harden JITs** with W^X, constant blinding, and randomized placement.
- **Keep KPTI/microcode/microarch mitigations on** for kernels and sensitive hosts; budget the perf cost deliberately.
- **Pursue memory safety** for new code — it dissolves the prerequisites the bypass classes need.

---

## Edge Cases & Pitfalls

- **Coarse enforcement still leaves gadgets.** IBT only requires landing on *an* `endbr`; coarse CFI allows a large legal set. Attackers adapt with reuse chains that respect the coarse policy. Enforcement raises the bar but isn't absolute.
- **Shadow stacks protect returns, not forward edges.** They stop return-address overwrite but not indirect call/jump (vtable, function-pointer) hijacks — pair with IBT/CFI.
- **Re-randomization can be defeated by a fast leak-and-use** if the window between re-randomizations is larger than the attacker's leak-to-use latency. Frequency matters.
- **PAC/CET keys and gadgets.** Signing-gadget reuse, key leakage, or unsigned-pointer paths can erode pointer-authentication guarantees. Coverage gaps matter.
- **KASLR without KPTI is weak.** A kernel info leak or Meltdown-style read collapses it; KPTI and FGKASLR are what make KASLR worth the name.
- **JIT W^X "toggling" races.** If the window where a page is writable overlaps with when it's executable (or another thread executes during the writable phase), the protection is moot. Use dual-mapping or strict serialization.
- **Containers/VMs sharing a base image** can share randomization-relevant state (e.g., identical layouts if checkpoint/restore is used). Verify each instance re-randomizes.

---

## Common Mistakes

1. **Treating ASLR as sufficient.** It's a secrecy layer; leaks defeat it. Without an enforcement layer, one leak ends the game.
2. **Respawning forked workers as clones.** Re-uses one layout for unlimited attacker attempts (BROP).
3. **Underrating out-of-bounds reads.** They're the master key to ASLR.
4. **Shipping a JIT with a writable-executable region** or without constant blinding.
5. **Enabling KASLR but not KPTI** (or running on un-patched microcode) and assuming the kernel base is hidden.
6. **Assuming high entropy stops partial overwrites.** It doesn't — the randomized bits aren't touched.
7. **Relying on shadow stacks for forward-edge protection.** They only protect returns.
8. **Believing coarse CFI/IBT eliminates reuse.** It constrains, not eliminates.

---

## Tricky Points

- **A leak de-randomizes only the region it points into.** Leaking a heap pointer doesn't give you libc unless you can chain to a libc pointer. Attackers plan leaks to reach the region they'll reuse; defenders can make cross-region pivots harder by separating data and code.
- **Brute force on forks doesn't fight entropy head-on.** It uses the crash oracle to recover a few addresses incrementally against a fixed layout. The fix is layout *non-reuse*, not more bits.
- **FGKASLR attacks the "fixed internal layout" assumption.** By randomizing function order, it ensures one leaked kernel address no longer reveals the rest — the kernel analogue of shuffling the cards, not just the deck.
- **Meltdown's relevance here is specifically KASLR.** It read kernel memory from user space, recovering the randomized kernel base; KPTI's unmapping both blocks the read and removes the addresses a side channel could probe.
- **CET's shadow stack is hardware-enforced and cheap** because it's a separate stack the CPU maintains — it's the rare deterministic defense with low overhead, which is why it's the modern centerpiece.
- **PAC and CET solve overlapping problems differently:** PAC signs pointers (corruption fails on use); CET tracks legal targets (transfers must land on landing pads / match the shadow stack). Both make "address known" insufficient.

---

## Test Yourself

1. Explain why, after enabling NX + ASLR + Full RELRO + canaries, the canonical exploit becomes a *two-bug* attack. Name the two capabilities the attacker needs.
2. Describe the BROP insight in terms of *layout reuse* and a *crash oracle*. Why does re-`exec`ing workers defeat it while increasing entropy does not?
3. Why does a partial (low-byte) pointer overwrite succeed with certainty against high-entropy ASLR? Which mitigation class actually stops it?
4. A browser JIT must allocate executable memory it fills with user-influenced content. Name two JIT-specific defenses and the attack (JIT spray) they target.
5. How did Meltdown defeat KASLR, and how does KPTI restore it? What does FGKASLR add on top?
6. Sort these into "secrecy" vs. "enforcement": ASLR, shadow stack, RELRO, IBT, PAC, KASLR, CFI. Why does a serious system need both buckets?
7. Shadow stacks block one class of control-flow hijack but not another. Which is which, and what do you pair them with?
8. Give two real-world ways a "shared randomization" sneaks into a deployment (besides fork-without-exec) and how to detect each.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│            ASLR BYPASS CLASSES & MODERN HARDENING (SENIOR)       │
├──────────────────────────────────────────────────────────────────┤
│ FORCED EXPLOIT SHAPE (NX+ASLR+RELRO+canary):                     │
│   need (1) INFO LEAK  +  (2) corruption -> ROP/JOP reuse chain   │
├──────────────────────────────────────────────────────────────────┤
│ BYPASS CLASSES:                                                  │
│   A info-leak-then-reuse  : 1 leaked ptr -> whole region base    │
│   B fork brute force/BROP : shared layout + crash oracle         │
│   C partial overwrite     : flip low bits, randomized bits intact│
│   D JIT spray             : predictable exec region you fill     │
│   E side channel/Meltdown : recover layout w/o logical disclosure│
├──────────────────────────────────────────────────────────────────┤
│ TWO DEFENSE LAYERS:                                              │
│   SECRECY  : ASLR, KASLR        (leaks/brute/side-channel defeat)│
│   ENFORCE  : shadow stack, CET/IBT, PAC, BTI, CFI, RELRO         │
│              -> address KNOWN is still INSUFFICIENT to hijack    │
├──────────────────────────────────────────────────────────────────┤
│ ANSWERS:                                                        │
│   leaks      -> re-randomization + enforcement layer             │
│   BROP       -> re-exec workers, rate-limit/alert crashes        │
│   partial OW -> memory safety / CFI / IBT                        │
│   JIT spray  -> W^X, constant blinding, randomized placement     │
│   KASLR break-> KPTI + FGKASLR + side-channel mitigations        │
├──────────────────────────────────────────────────────────────────┤
│ DURABLE FIX: memory safety removes the OOB read/write the whole  │
│              bypass tree depends on.                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- With NX + ASLR + Full RELRO + canaries, the attacker is forced into a **two-bug** shape: an **info leak** (beats ASLR) plus a **corruption primitive** (hijacks control), feeding a **code-reuse (ROP/JOP)** chain. ASLR's specific job is to convert "I know the addresses" into "I must leak the addresses."
- **Bypass classes:** (A) info-leak-then-reuse — one pointer de-randomizes a whole region; (B) brute force on forking servers / **BROP** — shared layout plus a crash oracle, defeated by *non-reuse* not entropy; (C) **partial overwrites** — flip low bits, randomized bits untouched, certain success; (D) **JIT spray** — a predictable, attacker-filled executable region sidesteps DEP/ASLR; (E) **side channels/Meltdown** — recover layout without logical disclosure.
- The strategic shift is from **secrecy** (hide addresses: ASLR/KASLR — brittle to leaks/brute/side-channels) to **enforcement** (make a known address insufficient: **shadow stacks, CET/IBT, PAC, BTI, CFI, RELRO**). Serious systems deploy both.
- **Re-randomization** makes leaked addresses go stale (the structural answer to "they will leak"). **Shadow stacks** deterministically defeat return-address overwrite; **IBT/CFI/PAC** constrain forward-edge (call/jump) hijacks. Shadow stacks protect returns only — pair them with forward-edge enforcement.
- **KASLR** has the same weaknesses amplified; **Meltdown** broke it by reading kernel memory from user space; **KPTI** restores it (and blocks the side channel) and **FGKASLR** shuffles function order so one kernel leak no longer reveals all.
- Recurring structural flaw: **shared randomization** (fork-without-exec, snapshots, golden images). Hunt for it.
- The durable fix beneath every mitigation is **memory safety**, which removes the out-of-bounds reads and writes that all bypass classes require. Mitigations buy time and raise cost for the native code you can't yet make safe.

---

## Further Reading

- *"Hacking Blind"* — Bittau, Belay, Mashtizadeh, Mazières, Boneh (IEEE S&P 2014). The BROP paper.
- *"On the Effectiveness of Address-Space Randomization"* — Shacham et al. (CCS 2004). The brute-force-the-fork foundation.
- *"Q: Exploit Hardening Made Easy"* and *"Return-Oriented Programming"* — Shacham et al. The conceptual basis for why NX forces reuse.
- *"Writing JIT-Spray Shellcode for Fun and Profit"* / Dion Blazakis, *"Interpreter Exploitation"* — the JIT-spray class and constant blinding as the answer.
- *Meltdown* and *Spectre* papers (Lipp et al.; Kocher et al., 2018) — speculative-execution attacks; Meltdown vs. KASLR.
- *"KASLR is Dead: Long Live KASLR"* — Gruss et al. on KAISER/KPTI.
- *FGKASLR* — Linux kernel function-granular KASLR design docs.
- *Intel CET specification* and the GCC `-fcf-protection` / `-z shstk` documentation.
- *ARMv8.3 Pointer Authentication* and *BTI* architecture reference material.
- *"Control-Flow Integrity: Principles, Implementations, and Applications"* — Abadi, Budiu, Erlingsson, Ligatti.
- *"Shuffler: Fast and Deployable Continuous Code Re-Randomization"* — Williams-King et al. (OSDI 2016).

---

## Diagrams & Visual Aids

### The forced two-bug exploit shape

```text
   mitigations deployed: NX + ASLR + Full RELRO + canary
        │
        ├─ can't inject code (NX)          ─► must REUSE existing code
        ├─ can't hardcode addrs (ASLR)     ─► need an INFO LEAK
        ├─ can't overwrite GOT (Full RELRO)─► target ret/fn-ptr/vtable
        └─ can't blindly smash stack (canary)─► leak/avoid the cookie
                         │
                         ▼
        EXPLOIT = info-leak bug  +  corruption bug  ->  ROP/JOP chain
```

### Brute force on a forking server (the oracle)

```text
   parent (randomized layout L)
        │ fork (NO exec)  -> children inherit SAME layout L
        ├── attempt: probe address A
        │      crash?  -> A wrong   (oracle bit = 0)
        │      alive?  -> A right   (oracle bit = 1)
        │      layout still L  -> info accumulates across attempts
        ▼
   recover key addresses incrementally  ->  build chain (BROP)

   FIX: re-exec each worker -> each gets a FRESH layout -> oracle dies.
```

### Secrecy layer vs. enforcement layer

```text
   ATTACKER GOAL: hijack control flow

   SECRECY (hide the address)          ENFORCEMENT (block the use)
   ┌───────────────────────┐          ┌───────────────────────────┐
   │ ASLR / KASLR          │          │ shadow stack (returns)    │
   │  defeated by:         │          │ CET IBT / BTI (fwd edge)  │
   │   - info leak         │          │ PAC (signed pointers)     │
   │   - fork brute force  │          │ CFI (legal-target set)    │
   │   - partial overwrite │          │ RELRO (frozen GOT)        │
   │   - side channel      │          │  -> address KNOWN is not  │
   └───────────────────────┘          │     enough to hijack      │
                                       └───────────────────────────┘
   Robust system = BOTH layers.  Leak beats secrecy; enforcement holds.
```

### Meltdown vs. KASLR, and KPTI's answer

```text
   BEFORE KPTI                         WITH KPTI
   user page tables map the kernel     kernel unmapped from user tables
        │                                   │
   Meltdown speculatively reads             Meltdown has nothing to read
   kernel memory from user space            (and timing side channel loses
        │                                    the mapped addrs to probe)
        ▼                                   ▼
   recover randomized kernel base       KASLR base stays hidden
   => KASLR DEFEATED                    (+ FGKASLR shuffles fn order so
                                          one leak != all kernel addrs)
```
