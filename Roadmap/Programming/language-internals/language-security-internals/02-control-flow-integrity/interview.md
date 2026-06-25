# Control-Flow Integrity — Interview Questions

> **Topic:** [Control-Flow Integrity](README.md)
> **Focus:** Conceptual foundations, toolchain/hardware specifics (Clang/LLVM CFI, MSVC CFG/XFG, kernel CFI, CET/PAC/BTI), traps, and design questions — with model answers.

---

## Introduction

This file is a graded question bank for control-flow integrity, the defense
family that keeps a memory-buggy program from being redirected to attacker-chosen
code. Questions are flat and numbered, grouped into four bands: **Conceptual**
(the attack/defense fundamentals), **Toolchain-Specific** (LLVM CFI, MSVC
CFG/XFG, kernel CFI, hardware CET/PAC/BTI), **Tricky-Trap** (where confident
candidates fail), and **Design** (open-ended, judgment-revealing). Every answer
is defensive and conceptual — we explain *mechanisms* and *bypass classes*, never
working exploits. Use the questions to interview others or to pressure-test your
own mental model.

## Table of Contents

- [Conceptual](#conceptual)
- [Toolchain-Specific](#toolchain-specific)
- [Tricky-Trap](#tricky-trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is Control-Flow Integrity, in one sentence, and what problem does it solve?**

CFI is a family of defenses that constrain a program's **indirect branches** (returns, function-pointer calls, virtual calls) to only the targets the programmer intended, so that a memory-corruption bug cannot be turned into "run attacker-chosen code." It solves the problem that jump targets (return addresses, code pointers) live in ordinary, corruptible memory, and the CPU follows them blindly.

## Question 2

**Why does CFI care only about *indirect* branches and not direct ones?**

A direct branch has its destination encoded in the instruction itself (`jmp 0x4011a0`); to change it the attacker would have to rewrite the program's code, which W^X/NX forbids (code pages are read-only). An indirect branch reads its target from a register or memory at runtime, and that memory can be corrupted. Only indirect branches are attacker-steerable, so only they need checking.

## Question 3

**Walk me through how a stack buffer overflow becomes a control-flow hijack.**

A function stores a local buffer and its return address on the same writable stack, with the return address at a higher address. If the function copies attacker-controlled input into the buffer without a length check, an over-long input writes past the buffer's end, over saved registers, and onto the return address. When the function executes `ret`, the CPU reads the now-corrupted return address and jumps wherever the attacker placed — historically into injected shellcode.

## Question 4

**NX/DEP made injected shellcode non-executable. Why didn't that end the problem?**

NX stops running *new* code but not *existing* code. The program and its libraries are full of legitimate executable code. Attackers pivoted to **code reuse** — return-to-libc (jump into an existing function like `system`) and, more generally, **ROP**, which chains tiny existing instruction sequences ("gadgets"). Every address is legitimate executable memory, so NX is satisfied while the attacker still controls behavior.

## Question 5

**Explain ROP without describing how to build a chain.**

ROP composes **gadgets** — short existing instruction sequences ending in `ret`. Because `ret` pops the next address off the stack and jumps to it, an attacker who controls the stack lays out a list of gadget addresses; each gadget runs a couple of instructions and "returns" into the next. The corrupted stack becomes a little program, and the program's own bytes execute it. It defeats NX entirely and can be Turing-complete given enough gadgets.

## Question 6

**What is the difference between the forward edge and the backward edge?**

The **forward edge** is indirect calls/jumps *into* code: function pointers and C++ virtual (vtable) calls. The **backward edge** is *returns* — the return address. They need different defenses: forward edge → type-based CFI (LLVM CFI, CFG/XFG), backward edge → stack canaries (weak) and shadow stacks / PAC-ret (strong). Protecting only one edge pushes attackers to the other (ROP ↔ JOP/COP).

## Question 7

**How does a stack canary work, and what does it miss?**

The compiler places a secret random value (the canary/cookie) between local buffers and the return address, and checks it just before `ret`; if a contiguous overflow corrupted the return address it also corrupted the canary, so the program aborts. It **misses**: non-contiguous/targeted writes, overflows of targets that sit before the canary, heap bugs and use-after-free (it's stack-only), and info-leak-then-rewrite (read the canary, write it back correctly). It's a tripwire, not integrity.

## Question 8

**Why is a shadow stack stronger than a stack canary for the backward edge?**

A canary only *detects* a specific corruption shape near the return address. A shadow stack keeps a separate, protected copy of every return address and compares it to the on-stack value at `ret`, faulting on any mismatch. Even a perfectly targeted overwrite of the return-address slot is caught, because the attacker can't forge the protected copy. That's **integrity** (a forged value won't be used) versus the canary's **tripwire** (detect a crossing).

## Question 9

**What is coarse-grained vs fine-grained CFI, and why did coarse CFI get bypassed?**

Coarse CFI uses a loose policy ("any function entry," "any address after a `call`"). Fine-grained CFI uses a small, per-call-site target set derived from types. Coarse CFI was bypassed because real binaries contain *so many* legal targets under a loose policy that attackers could still assemble useful gadget chains entirely from "allowed" targets. Security scales with how *small* the allowed set is.

## Question 10

**What is JOP/COP and why does it matter for defense design?**

JOP (Jump-Oriented) and COP (Call-Oriented) Programming reuse gadgets ending in indirect `jmp` or `call` instead of `ret`, often coordinated by a "dispatcher" gadget rather than the stack. They matter because a defense that only protects the backward edge (shadow stacks watch `ret`) leaves the forward edge open — so you need forward-edge CFI *and* backward-edge integrity together.

## Question 11

**What is a data-only attack, and why is CFI blind to it?**

A data-only attack corrupts *non-control* data — an `is_admin` flag, a length field, a data pointer — so the program's behavior changes while every branch still goes exactly where the source says. CFI only checks *control* data (return addresses, code pointers), so a hijack-free, fully-legitimate control flow is invisible to it. This is CFI's structural blind spot.

## Question 12

**Why is this whole topic mostly about C and C++?**

Memory-safe languages (Rust, Go, Java, managed runtimes) prevent the precondition — out-of-bounds writes and use-after-free that let an attacker overwrite a return address or code pointer. In C/C++ those bugs are reachable, and control data lives in corruptible memory. CFI is the safety net for code that must be C/C++ (kernels, runtimes, `libc`, browsers); for memory-safe code the bug class largely doesn't exist (except across the FFI boundary).

---

## Toolchain-Specific

## Question 13

**How does Clang/LLVM CFI decide whether an indirect call is legal?**

LLVM CFI (`-fsanitize=cfi`) is type-based. The compiler groups functions by their **type signature** and, for an indirect call through, say, an `int(char*)` pointer, restricts the target to functions of that exact type. It lays the sets out so a fast range/bitmask check answers "in set?" before each call (and before each vtable dispatch with `cfi-vcall`); a mismatch traps. Its precision limit: all functions sharing a type are mutually substitutable.

## Question 14

**Why does LLVM CFI require LTO?**

Type-based target sets must include *every* function of a given type across the whole program; otherwise the sets are incomplete and the checks are either over-restrictive (false traps) or unsound. Link-Time Optimization gives the compiler whole-program visibility to build complete sets. Calls crossing into separately-built shared libraries are a known weak spot for the same reason.

## Question 15

**What are the main LLVM CFI schemes you'd enable, and what does each cover?**

`cfi-icall` checks indirect calls through function pointers. `cfi-vcall` enforces vtable integrity for C++ virtual calls (the main anti-vtable-hijack control). `cfi-nvcall` covers non-virtual member calls. There are also cast-checking schemes (`cfi-derived-cast`, `cfi-unrelated-cast`) that catch illegal `static_cast`/reinterpret patterns. In development you add `-fno-sanitize-trap=cfi -fsanitize-recover=cfi` to *diagnose* violations rather than trap.

## Question 16

**How does Microsoft Control Flow Guard (CFG) work, and how is XFG different?**

CFG is compiler- and loader-supported: the compiler emits a **bitmap of valid indirect-call targets** (legitimate function entries) and inserts a guard check before each indirect call that consults the bitmap. It's *coarse* — essentially "is this a valid function start?" — which is why it was shown bypassable. **XFG (eXtended Flow Guard)** adds a **type hash** per target, so the check verifies both "valid target" *and* "matching prototype hash," moving Windows toward fine-grained, LLVM-CFI-style precision.

## Question 17

**Explain Intel CET — both halves.**

CET is hardware CFI with two parts. The **shadow stack** (backward edge) keeps a hardware-managed protected copy of return addresses; `call` pushes to both stacks, `ret` compares them and faults (control-protection fault) on mismatch — and the shadow pages are unwritable by ordinary stores. **IBT** (Indirect Branch Tracking, forward edge) requires every indirect-branch target to begin with an `endbranch` (`ENDBR64`) instruction; landing elsewhere faults. IBT alone is coarse (any `endbranch`), so it's paired with a type check (FineIBT) for precision.

## Question 18

**How does ARM Pointer Authentication (PAC) protect a return address, and where does the secret live?**

At function entry, `PACIASP` computes a keyed MAC over the return address (with the stack pointer as context) and stuffs the truncated MAC into the pointer's unused high virtual-address bits. Before returning, `AUTIASP` recomputes and verifies it, stripping the signature on success and poisoning the pointer (so any use faults) on failure. The **key** lives in privileged system registers and is *not readable by user code*, so an attacker who overwrites the return address can't forge a valid signature. PAC needs no separate memory region — the check rides in the pointer's spare bits.

## Question 19

**What is ARM BTI and how does it relate to PAC?**

BTI (Branch Target Identification, ARMv8.5) requires indirect branches to land on a `BTI` landing-pad instruction or the CPU faults — ARM's analog of Intel IBT, and coarse on its own. PAC and BTI are complementary: BTI restricts *where* an indirect branch may land; PAC ensures the *pointer* used is authentic. Together they constrain forward-edge code reuse on ARM. You enable both with `-mbranch-protection=standard` (`pac-ret` + `bti`).

## Question 20

**What is kernel CFI — KCFI and FineIBT?**

**KCFI** (Clang's kernel CFI) puts a **type hash** just before each function and checks it before every indirect call — a fine-grained, software, forward-edge scheme designed to fit kernel calling patterns without whole-program LTO assumptions. **FineIBT** combines hardware **IBT landing pads** (cheap coarse filter) with a **software type check** at the landing pad (fine precision), getting both at low cost; Linux uses it on CET-capable CPUs.

## Question 21

**What does `-fcf-protection=full` (GCC/Clang) actually emit, and how do you verify it's active?**

It emits CET-compatible code: an `ENDBR64` landing pad at each indirect-branch target (IBT) and shadow-stack-compatible prologues/epilogues (so `call`/`ret` use the hardware shadow stack). `=branch` is IBT-only, `=return` is shadow-stack-only. Verify with `readelf -n` and look for the GNU property notes advertising SHSTK/IBT; if the notes are absent, capable hardware won't enforce CET on that binary.

## Question 22

**What is RELRO and why is it discussed alongside CFI?**

RELRO ("RELocation Read-Only") hardens the GOT, a table of function pointers the dynamic linker fills in. **Partial RELRO** reorders sections; **Full RELRO** resolves all symbols at startup and marks the GOT read-only, so an overflow can't rewrite those pointers. It's not CFI itself, but overwriting a GOT entry is a classic forward-edge hijack, so RELRO removes a major corruption target and always appears in CFI hardening checklists.

---

## Tricky-Trap

## Question 23

**"We enabled stack canaries, so we're safe from buffer overflows." What's wrong?**

Canaries only catch *contiguous* stack overflows that smash the return address, and only at `ret`. They miss heap overflows, use-after-free, type confusion, forward-edge hijacks, targeted/non-contiguous writes, overflows of locals positioned before the canary, and any attack that leaks the canary and writes it back. They're one narrow tripwire, not overflow safety.

## Question 24

**A candidate says "NX prevents return-to-libc." True or false?**

False. NX prevents executing *injected* data as code. Return-to-libc reuses *existing* executable code (a real library function), so NX is fully satisfied. This is the whole reason code-reuse attacks exist — they were the response to NX.

## Question 25

**"Fine-grained CFI restricts each call to its one correct target." Is that accurate?**

No. Fine-grained CFI restricts a call to an **equivalence class** — typically all functions sharing a type — not a single target. The runtime information needed to pick *the* correct target at a given call in a given state generally isn't statically available. This **precision ceiling** is why attacks can live *inside* the allowed class. (The backward edge is the exception: one correct return target, so it can be precise.)

## Question 26

**"Our binary has CFI enabled" — but it links a third-party `.so` compiled without it. What's the catch?**

The guarantee is only as strong as the weakest linked object. The un-instrumented library is a CFI-free region: indirect branches there aren't checked, landing pads may be absent, and an attacker can pivot into it. "CFI enabled" must mean the *whole reachable closure* participates, not just your own translation units.

## Question 27

**Why doesn't vtable-integrity CFI (`cfi-vcall`) stop COOP?**

COOP (Counterfeit Object-Oriented Programming) doesn't forge *fake* vtables — it builds counterfeit objects whose vtable pointers point at **real, valid** vtables and invokes a malicious *sequence* of **legitimate, type-valid** virtual functions. Every dispatch is through a genuine vtable to a type-correct method, so vtable-integrity CFI sees nothing wrong. It proves that enforcing each call's validity doesn't prevent a hostile *composition* of valid calls.

## Question 28

**A team turned off `-fstack-protector` and marked the stack `RWX` to make their JIT work. What did they break, and what's the right fix?**

They removed the backward-edge tripwire *and* defeated NX/W^X (writable+executable memory is exactly what NX forbids), re-enabling injected-shellcode attacks. The right fix is W^X-correct JIT memory management: write to a writable mapping, then flip it to executable (and vice versa) with explicit permission transitions, plus emitting CET/PAC landing pads/signatures for JIT'd code — never a globally `RWX` stack.

## Question 29

**Is PAC unbreakable because the key is secret?**

No. The dominant real-world weakness is a **signing oracle** — a bug that gets the CPU to sign a pointer of the attacker's choosing, which hands them validly-signed pointers without ever knowing the key. Additionally, the MAC is short (limited by spare VA bits), so an **authentication oracle** can enable brute force, and weak signing *modifiers* can allow PAC reuse across contexts. PAC raises cost substantially; it isn't absolute.

## Question 30

**"CFI plus ASLR means an info leak doesn't matter." Why is that wrong?**

ASLR's protection collapses the moment the attacker learns a single address (an info leak), and CFI does nothing to prevent leaks. A read primitive can de-randomize the address space and supply the addresses needed to construct CFI-compatible (or data-only) attacks. Read primitives are first-class threats; "we have ASLR" is not a defense against leaks.

## Question 31

**Backward-edge integrity (shadow stack/PAC-ret) is enabled. Does that stop JOP and COP?**

No. JOP and COP use indirect `jmp`/`call` gadgets, not `ret`, so the shadow stack / PAC-ret check (which guards returns) never fires. You still need forward-edge enforcement (IBT/BTI + type check, or LLVM CFI/CFG/XFG). Protecting one edge relocates the attacker to the other.

## Question 32

**If CET and PAC are enabled, are data-only attacks prevented?**

No — and this is the most important "no" in the topic. CET (shadow stack + IBT) and PAC protect *control* data. A data-only attack corrupts *non-control* data and leaves control flow entirely legitimate, so no control-protection fault or PAC mismatch ever occurs. None of the hardware CFI features can see it.

---

## Design

## Question 33

**Design a hardening strategy for a network-facing C++ service that parses untrusted input.**

Layer mitigations by exploit step: (1) prevention — bound all copies, validate lengths, minimize and tightly-type function pointers; (2) forward edge — LLVM CFI (`cfi-icall`/`cfi-vcall`, LTO) or CFG/XFG on Windows; (3) backward edge — CET shadow stack (`-fcf-protection=full`) or PAC-ret on ARM; (4) landing pads — IBT/BTI; (5) ancillary — Full RELRO, PIE/ASLR; (6) early detection — MTE where available; (7) containment — sandbox the parser so even full code execution yields little; (8) strategic — migrate the highest-risk parser to a memory-safe language. State the residual (data-only, COOP, info leaks) explicitly and assign compensating controls.

## Question 34

**You have budget for exactly one more mitigation on a fleet that's already running CFI + ASLR + canaries. ARM hardware. What do you pick and why?**

Strong candidates: **MTE**, **PAC/BTI**, or **sandboxing**. I'd argue for MTE if not present: it attacks the bug *upstream* of CFI — catching the out-of-bounds/use-after-free at the bad access before any pointer is hijacked — which closes many paths CFI only mitigates downstream and complements everything already deployed. If the highest-risk component isn't yet isolated, **sandboxing** is the alternative: it contains success regardless of which bug class is used. The wrong answer is "more CFI"; the existing CFI already prices out cheap control-flow hijacks, so the marginal value is elsewhere.

## Question 35

**Write the security claim for a product that has fully deployed forward- and backward-edge CFI. Make it precise.**

"Forward-edge CFI restricts indirect calls to type-compatible targets and backward-edge integrity (shadow stack / PAC-ret) makes return-address forgery infeasible, so classic stack-smash-to-shellcode, ROP `ret`-chaining, GOT overwrite, and fake-vtable hijacks are blocked. **Residual:** data-only / DOP attacks (control flow stays legitimate), COOP-style composition of type-valid virtual calls, info-leak-assisted attacks, and any path opened by our JIT/FFI exemptions. **Mitigations for the residual:** ARM MTE where available, sandboxing of untrusted-input parsers, least privilege, and migration of the media/JSON parsers to Rust (tracked)." The point is a bounded statement with an explicit residual and plan — never "we're protected from memory corruption."

## Question 36

**How would you decide *where* to spend forward-edge CFI's runtime cost across a large codebase?**

By attack surface, not uniformly. Maximum protection on indirect calls reachable from untrusted input — parsers, deserializers, IPC/RPC dispatch, network handlers. Measure overhead on the genuinely hot indirect-call paths (interpreter loops, dispatch tables) with a before/after benchmark, and accept relaxation in trusted internal hot paths if the perf cost is real and the reachability from untrusted input is nil. Tighten function-pointer *types* first — that shrinks the equivalence class for free and improves CFI precision without runtime cost. Document every `no_sanitize` exemption with an owner and a compensating control.

## Question 37

**Argue for and against rewriting a critical C parser in Rust versus hardening it with maximal CFI.**

**For the rewrite:** it deletes the bug class (out-of-bounds, use-after-free) that CFI only mitigates, removing the precondition for *all* of ROP, COOP, and data-only attacks in that component — the strongest possible outcome. **Against / costs:** engineering time and risk, the FFI boundary remains unsafe (and must be audited/sandboxed), parity bugs during migration, and the rest of the process is still C++ so the parser's safety doesn't extend outward. **Decision frame:** rewrite the *highest-risk, untrusted-input* components where the payoff is largest; keep CFI + MTE + sandboxing as the net for the C++ that remains. They're complementary phases, not either/or.

---
