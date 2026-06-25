# ASLR & Mitigations — Interview Questions

> **Topic:** [ASLR & Mitigations](README.md)

---

## Introduction

These questions probe whether a candidate understands ASLR as one layer in a
defense-in-depth stack rather than a magic bullet. Strong answers connect the
mechanism (randomize where things live) to its single greatest weakness (any
information leak collapses it), and can compose ASLR with DEP/NX, RELRO, stack
canaries, and CET into a coherent exploitation-mitigation story. Everything here
is conceptual and defensive — the goal is to reason about *why* attacks get hard,
not to construct them.

## Table of Contents

- [Conceptual](#conceptual)
- [Platform-Specific](#platform-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What problem does ASLR solve, and what does it *not* solve?**

ASLR randomizes the base addresses of the stack, heap, shared libraries, and
(with PIE) the main executable, so an attacker can no longer hardcode the address
of a function or gadget. It raises the cost of *exploiting* a memory-corruption
bug. It does **not** fix the bug itself — the overflow or use-after-free is still
there — and it does nothing once the attacker obtains an address leak.

## Question 2

**Where does the entropy come from, and why is 32-bit ASLR considered weak?**

The loader picks random offsets at `exec`/`mmap` time from the kernel's RNG. On
32-bit systems only a handful of bits (often ~8–16) are available for mmap
randomization because the address space is small and must stay usable, so the
keyspace is brute-forceable — especially against a forking server that doesn't
re-randomize children. 64-bit gives far more entropy (tens of bits), making blind
brute force impractical.

## Question 3

**Explain PIE vs PIC and why both matter for ASLR.**

PIC (Position-Independent Code) is compiled to run at any base by referencing
globals/functions indirectly through the GOT/PLT rather than at fixed absolute
addresses — this is how shared libraries have always worked. PIE
(Position-Independent Executable) applies the same to the *main* program so its
own code and globals can be randomized too. Without PIE, the executable loads at a
fixed base and gives the attacker a reliable island of known addresses even when
libraries are randomized.

## Question 4

**Why is ASLR almost worthless without DEP/NX, and vice versa?**

DEP/NX makes data pages non-executable, so an attacker can't just inject and run
shellcode — they're pushed toward code reuse (ROP). ASLR then hides *where* the
reusable code is. Each alone is weak: without NX, ASLR can be sidestepped by
jumping to injected code on a leaked stack; without ASLR, NX is bypassed by ROP
against known addresses. Together they force the attacker to *both* reuse
existing code *and* first obtain an address leak.

## Question 5

**What is RELRO and how does it complement ASLR?**

RELRO (RELocation Read-Only) makes the GOT read-only after dynamic linking. Full
RELRO resolves all symbols at startup (`-z now`) then maps the GOT read-only, so
an attacker who corrupts a pointer can't overwrite a GOT entry to hijack control
flow. It closes a classic technique that would otherwise work *regardless* of
ASLR.

---

## Platform-Specific

## Question 6

**Linux: how do you check and control ASLR system-wide?**

`/proc/sys/kernel/randomize_va_space`: `0` off, `1` partial (stack/mmap/vdso),
`2` full (adds heap/brk). `checksec` (or `hardening-check`) on a binary reports
PIE, NX, RELRO, canary, and Fortify status. Build hardening flags:
`-fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIE -pie -Wl,-z,relro,-z,now`.

## Question 7

**Windows: what are the equivalents?**

Windows has ASLR controlled per-image by the `/DYNAMICBASE` linker flag, plus
system/mandatory ASLR and "force ASLR" via Exploit Protection (formerly EMET).
DEP is `/NXCOMPAT`. Control Flow Guard (`/guard:cf`) and CET shadow stacks add
control-flow protection. A non-`/DYNAMICBASE` DLL loaded into a process can
de-randomize the whole address space.

## Question 8

**macOS/iOS and Android specifics?**

macOS/iOS ship PIE by default and combine ASLR with code signing, W^X, and (on
Apple silicon) Pointer Authentication. iOS's tight code-signing means injecting
new code is hard, pushing attackers to ROP/JOP under strong ASLR + PAC. Android
enables ASLR and (modern devices) uses ARM MTE and CFI in the platform; full
ASLR + SELinux + seccomp form its layered model.

## Question 9

**What is KASLR and how was it broken?**

KASLR randomizes the *kernel's* base address. Meltdown (and related transient
side-channel attacks) defeated KASLR by letting unprivileged code infer kernel
addresses through microarchitectural timing, which is why KPTI/KAISER (kernel
page-table isolation) was deployed — it unmaps most kernel memory from user space
to deny that side channel.

---

## Tricky / Trap

## Question 10

**"We enabled ASLR, so memory bugs aren't exploitable anymore." Respond.**

False comfort. ASLR raises cost but is routinely bypassed by an **information
leak**: any disclosure of a single pointer de-randomizes the region it belongs to,
after which the attacker computes every other address by fixed offset. Real
exploits are "leak, then ROP." ASLR is a speed bump, not a fix — fix the bug.

## Question 11

**A process has full ASLR but links one library built without PIC/at a fixed
base. What happens?**

That module sits at a predictable address and becomes an anchor: the attacker
sources gadgets from it without needing a leak, undermining ASLR for the whole
process. ASLR is only as strong as its *least*-randomized mapping. (Historically,
prelink weakened ASLR the same way by fixing library bases.)

## Question 12

**Does `fork()` re-randomize the child's address space?**

No. A forked child inherits the parent's layout. This is why forking servers are
vulnerable to brute-force / BROP-style approaches: each crash-and-retry faces the
*same* layout, so the attacker can probe one byte at a time. Re-`exec` (not just
fork) is what re-randomizes.

## Question 13

**Why doesn't ASLR stop a data-only attack?**

Data-only attacks corrupt *data* (a flag, a length, a function-pointer table the
program already uses) to change behaviour without redirecting to a chosen address,
so not knowing absolute addresses doesn't necessarily block them. ASLR targets the
"jump somewhere known" step, which these attacks avoid.

---

## Design

## Question 14

**Design the build/hardening configuration for a network-facing C service.
Justify each layer.**

- **PIE + full ASLR** — randomize all mappings, including the executable.
- **NX/DEP** — no executable data pages; forces code reuse.
- **Full RELRO (`-z relro -z now`)** — read-only GOT; kills GOT overwrite.
- **Stack canaries (`-fstack-protector-strong`)** — detect linear stack overwrite before return.
- **`_FORTIFY_SOURCE=2`** — catch known-size buffer misuse at compile/run time.
- **CET (IBT + shadow stack) / PAC where available** — enforce control-flow integrity so a leak-plus-ROP still fails.
- **Minimize info leaks** — no pointer values in logs/errors, because one leak undoes ASLR.

The theme: assume the bug exists; layer mechanisms so that defeating one
(e.g. a leak beating ASLR) still leaves CFI/canaries/RELRO in the way.

## Question 15

**How would you audit a fleet of binaries for missing mitigations?**

Script `checksec`-style introspection (ELF header for PIE/NX, dynamic section for
RELRO/BIND_NOW, symbol for stack canary, notes for CET) across all binaries,
flag any that are non-PIE, partial-RELRO, canary-less, or NX-disabled, and gate
releases on the policy. Treat a single non-PIE shared object as a fleet-wide
regression because it anchors ASLR bypasses.

## Question 16

**When is ASLR genuinely insufficient and you need something stronger?**

When attackers have a reliable info-leak primitive (common in browsers/complex
parsers) or can brute-force (32-bit, forking servers). Then you escalate to CFI
(CET/PAC/Clang CFI) to constrain control flow even with known addresses, to
memory-safe languages to remove the bug class, and to sandboxing to bound the
blast radius of a successful exploit.
