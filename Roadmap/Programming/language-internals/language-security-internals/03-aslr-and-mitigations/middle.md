# ASLR & Mitigations — Middle Level

> **Topic:** [ASLR & Mitigations](README.md)
> **Focus:** How randomization is actually implemented at exec/mmap time, where the entropy comes from, how PIC threads through the GOT/PLT, and how each companion mitigation composes — and is undermined — in practice.

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

> Focus: **Where do the random bits come from, how does the loader place each region, and how exactly does PIC indirect through the GOT — so you can reason about what each mitigation does and does not protect?**

At the junior level, ASLR was "the OS randomizes base addresses." That's true, but a working engineer needs the next layer of detail: *which* component does the randomizing (the kernel, the dynamic linker, or the program loader), *how many bits* of entropy each region actually gets, and *what the layout looks like in memory* once everything is placed. You also need to understand the GOT/PLT machinery concretely, because half of the companion mitigations (RELRO, lazy vs. eager binding) only make sense once you can picture how a call to `printf` actually resolves.

The through-line of this level is **composition**. ASLR alone is a single layer; in the real world it is always part of a stack — PIE, NX, RELRO, canaries, FORTIFY — and the security you get depends on how those layers *combine* and where the seams are. Equally important is understanding how the stack *fails*: the precise mechanisms by which an info leak, a partial overwrite, a low-entropy region, or a forking server quietly hands the attacker back the addresses you thought you'd hidden.

This page stays defensive and conceptual. We describe *bypass classes* (info-leak-then-reuse, brute force on forks, partial overwrites) at the level needed to design and audit defenses — never as working exploits.

---

## Prerequisites

- **Required:** The junior-level picture: ASLR randomizes base addresses; PIE randomizes the executable; NX/canary/RELRO/FORTIFY are companions; an info leak defeats ASLR.
- **Required:** Comfort reading C and a terminal. You should be able to compile with flags and read tool output.
- **Required:** The virtual-memory basics: pages, page permissions (read/write/execute), `mmap`, the stack and heap.
- **Helpful:** A rough idea of how dynamic linking works — that `libc` is loaded separately and your program calls into it.
- **Helpful:** Familiarity with ELF (the Linux executable format) terminology: sections, segments, the dynamic linker `ld.so`.

You do **not** need to write ROP chains or read disassembly fluently — that's `senior.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **mmap base / mmap_base** | The address the kernel uses as the starting point for memory mappings (shared libraries, large allocations). Randomized under ASLR. |
| **Load bias** | The random offset added to a PIE/library's preferred base when the loader places it. "Base = preferred + bias." |
| **Dynamic linker (`ld.so`, `dyld`)** | The component that loads shared libraries, applies relocations, and resolves symbols at runtime. |
| **Relocation** | A fix-up the linker applies so that addresses in loaded code/data point to the right place after the load bias is applied. |
| **GOT (Global Offset Table)** | Writable table holding resolved addresses of external functions/data. Lives in the data segment. |
| **PLT (Procedure Linkage Table)** | Code stubs that route external calls through the GOT; implement lazy binding. |
| **Lazy binding** | Resolving a function's real address on its *first* call rather than at load time. Requires a writable GOT. |
| **Eager binding (`-z now`)** | Resolving all symbols at load time, so the GOT can then be made read-only. |
| **Partial RELRO** | Reorders sections so GOT-for-data is read-only, but the **PLT-related GOT** (`.got.plt`) stays writable for lazy binding. |
| **Full RELRO** | `-z relro -z now`: resolve everything eagerly, then mark the entire GOT read-only. |
| **Stack canary / stack cookie** | A random per-process guard value placed before the saved return address; checked on function return. |
| **FORTIFY_SOURCE** | Compiler/libc feature that replaces certain functions with size-checked `__*_chk` variants when a compile-time size is known. |
| **Entropy bits** | log2 of the number of possible base positions for a region. |
| **Prelink** | A historical Linux optimization that pre-assigned fixed library addresses to speed loading — and thereby *weakened* ASLR. |
| **Info leak** | A bug disclosing a real runtime address, collapsing ASLR for the containing region. |
| **W^X** | Write-XOR-Execute: a page may be writable or executable but not both. The principle behind NX. |

---

## Core Concepts

### 1. Who randomizes what, and when

Randomization is not one mechanism; it's a division of labor:

- **The kernel** randomizes the **stack base**, the **mmap base** (which determines where libraries and large allocations land), and the **brk heap** offset. On Linux this is governed by `randomize_va_space` (0/1/2) plus per-architecture entropy settings.
- **The kernel's ELF loader** applies a random **load bias** to a PIE executable when it `exec`s it — that's what randomizes your own code.
- **The dynamic linker** (`ld.so`) then loads each shared library at an address derived from the randomized mmap base and applies **relocations** so the code works at its new location.

So a single `exec` of a PIE program involves the kernel randomizing the executable's base, the stack, and the mmap region, and `ld.so` placing libraries within that randomized mmap region. Each of these is a separate source of entropy with its own bit count.

### 2. Entropy, quantified

"More bits is better" — but the actual numbers matter because they decide whether brute force is feasible.

- **Why 32-bit is weak:** On 32-bit x86 Linux, the classic result (Shacham et al., 2004) is that the mmap region had only **16 bits** of entropy for library placement. 2^16 = 65,536 positions. A forking server that doesn't re-randomize across child crashes can be brute-forced in seconds to minutes, because each wrong guess just crashes a child and the attacker retries against the *same* layout.
- **Why 64-bit is strong:** On x86-64 Linux, mmap entropy is typically **28 bits** (and stack/PIE entropy often higher). 2^28 ≈ 268 million. Each wrong guess on most targets crashes the process, so without a leak, brute force is impractical — you'd need hundreds of millions of crashes.
- **Region asymmetry:** Not all regions get the same entropy. Historically the executable (PIE) base, the stack, and the mmap base differed. An attacker targets the *lowest-entropy* region in the process. A region with only 8 bits is a soft underbelly even when everything else has 28.

The headline rule for a mid-level engineer: **ASLR's strength is the minimum entropy across the regions the attacker can target, not the maximum.**

### 3. Position-independent code, concretely

PIC's job: produce code that runs correctly no matter what base it's loaded at. The trick is to never embed an absolute address. Two mechanisms:

- **RIP-relative addressing (x86-64):** "load from *here + offset*" instead of "load from *absolute address*." The CPU computes the target relative to the current instruction pointer. Self-relative references inside the same module need no fix-up at all.
- **GOT/PLT indirection for *external* references:** A call to another module's function can't be self-relative (the other module's bias is unknown at compile time), so it's resolved at runtime and stored in the GOT.

### 4. The GOT/PLT walk-through

Picture a PIC program calling `printf`. Compile time produces:

```text
call printf@plt        # not a direct call to printf
```

`printf@plt` is a tiny stub in the **PLT**. With **lazy binding**, the first call works like this:

```text
1. call printf@plt
2. PLT stub: jump to *GOT[printf]
3. GOT[printf] initially points BACK into the PLT (the "resolver" path)
4. resolver (in ld.so) computes printf's real address
5. resolver writes that real address into GOT[printf]
6. control transfers to printf
   --- on every later call ---
1. call printf@plt
2. PLT stub: jump to *GOT[printf]   # now points straight at printf
```

The GOT must be **writable** for step 5 to work. That writability is exactly what an attacker wants to abuse: overwrite `GOT[printf]` with the address of some other function, and the next `printf` call jumps there instead. **RELRO** closes this.

### 5. RELRO: Partial vs. Full

- **Partial RELRO** (`-z relro` alone): The linker groups read-only-after-relocation data together and `mprotect`s it read-only after startup. But the **`.got.plt`** (the part of the GOT used by lazy binding) stays writable, because lazy binding needs to write to it on first call. So **function-pointer GOT entries remain hijackable.**
- **Full RELRO** (`-z relro -z now`): `-z now` forces **eager binding** — every symbol is resolved at load time. Now nothing needs to write to the GOT afterward, so the loader can make the *entire* GOT read-only. A GOT-overwrite attack is dead. The cost is slightly slower startup (resolve everything up front) and you lose lazy binding's "only pay for what you call."

A mid-level takeaway: **Full RELRO is the one to want.** Partial RELRO sounds protective but leaves the most attacked table writable.

### 6. NX / DEP / W^X and what it forces

NX marks data pages (stack, heap, `.data`, `.bss`) non-executable. This kills the oldest exploit shape — inject machine code into a buffer, overwrite a return address to point at it, run it. With NX, the injected bytes are data and can't be executed.

NX doesn't stop the attacker from *taking control*; it changes *what they can do with it*. They pivot to **code reuse**: chaining together fragments of *already-executable* code (the program's own code, libc, etc.). That's return-to-libc and ROP, covered at the senior level. The key composition fact for now: **NX is what makes ASLR matter so much.** If you could inject and run code, you wouldn't care where existing code lives. NX forces reuse, and reuse requires knowing addresses, which ASLR hides. The two mitigations are designed to work as a pair.

### 7. Stack canaries and FORTIFY, in composition

- **Stack canaries** (covered in depth in a sibling stack-protection topic) place a random value between local buffers and the saved return address. A *contiguous* overflow that reaches the return address must pass through the canary; the function-epilogue check then aborts. Canaries compose with ASLR by adding *another* secret the attacker must either avoid disturbing or leak. Note their limits: they don't stop *non-contiguous* writes (e.g., an attacker-controlled index that writes directly at the return address), and the canary value itself can be leaked.
- **FORTIFY_SOURCE** rewrites calls like `memcpy(dst, src, n)` to `__memcpy_chk(dst, src, n, __builtin_object_size(dst, ...))` when the destination size is known at compile time, aborting on overflow. It requires optimization (`-O1`+) and only helps where the size is statically derivable. It's a cheap, targeted layer that catches the most common library-function overflows.

### 8. Prelink: how an optimization weakened ASLR

A historical cautionary tale worth knowing. **Prelink** was a Linux tool that pre-computed and *baked in* fixed load addresses for shared libraries to speed up program startup (skipping relocation work). The side effect: every prelinked library loaded at the *same* address across runs and across machines — effectively **disabling ASLR for those libraries.** It traded a security property for a small startup speedup. Modern systems have largely abandoned prelink (faster hardware and better linking made the speedup marginal, and the ASLR cost unacceptable). The lesson generalizes: **any optimization that fixes an address re-introduces the predictability ASLR removed.** Watch for it in your own systems — pinned addresses, cached layouts, shared snapshots.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Load bias** | The random number of floors a building's elevator is shifted before you enter — the apartments keep their relative positions, but the whole stack slides. |
| **GOT/PLT** | A company phone directory (GOT) and the receptionist (PLT) who looks up the right extension the first time you ask, then writes it on a sticky note for next time. |
| **Lazy binding** | The receptionist only looks up an extension when someone actually calls it. |
| **RELRO (Full)** | Laminating the directory after everyone's looked up their numbers, so nobody can scribble a fake extension into it. |
| **Partial RELRO** | Laminating the *address* pages but leaving the *phone-number* page (`.got.plt`) on a wipe-clean whiteboard — exactly the page a saboteur wants. |
| **Entropy asymmetry** | A bank with a 10-digit vault code but a 2-digit code on the back door. Thieves attack the back door. |
| **Prelink** | Management posting everyone's permanent room number on the lobby wall "to save time" — convenient, and a gift to burglars. |
| **NX forcing reuse** | Banning visitors from bringing their own tools; they must improvise using equipment already in the building (and so must know where it is). |

---

## Mental Models

### The "entropy is a minimum, not an average" model

When you reason about a process's randomization, don't average the bits across regions. The attacker picks the weakest region they can reach. A process with a 28-bit library base but a 12-bit something-else has a 12-bit weak point. Always ask: *what is the lowest-entropy region an attacker can target, and is that region enough to pivot from?*

### The "writable table is a steering wheel" model

The GOT is a table of *where to go when I call X*. While it's writable, it's a steering wheel an attacker can grab: change one entry and you redirect a call. RELRO (Full) welds the steering wheel in place after startup. Whenever you see a writable table of function pointers, ask whether it can be frozen.

### The "every fixed address is a free anchor" model

ASLR's value is that nothing is predictable. Every component that *does* sit at a fixed address — a non-PIE executable, a prelinked library, a hardcoded mapping, a JIT region at a guessable address — is a free anchor the attacker gets without spending a guess or a leak. Audit for fixed anchors; they're where ASLR silently fails.

---

## Code Examples

Defensive and observational only.

### Seeing the actual memory map and its randomization

```bash
# Map of a running process: bases of stack, heap, each library.
cat /proc/$$/maps | head
# Example lines:
# 55a3b1e91000-55a3b1e92000 r-xp ... /usr/bin/bash      <- code (PIE base)
# 7f3c9a100000-7f3c9a2c0000 r-xp ... /usr/lib/libc.so.6 <- libc base
# 7ffe1a200000-7ffe1a221000 rw-p ... [stack]            <- stack
```

Run a PIE program twice and diff the bases — they move. Run a non-PIE program twice and its *code* base stays fixed while stack/heap/libs still move.

### Measuring stack entropy empirically (safe)

```bash
# Print a stack address many times; count distinct high bits to estimate entropy.
for i in $(seq 1 20); do
  ./addrs | awk '/stack var/ {print $4}'
done | sort -u | head
# Many distinct values => randomization is active.
```

### Lazy vs. eager binding, observed

```bash
# Force eager binding for one run (resolve all symbols at startup):
LD_BIND_NOW=1 ./program
# With Full RELRO compiled in (-z now), this is the default behavior.
```

### Inspecting GOT/PLT and RELRO status

```bash
# Is RELRO partial or full? Look for GNU_RELRO segment and BIND_NOW flag.
readelf -d ./program | grep -E 'BIND_NOW|FLAGS'
# DT_FLAGS BIND_NOW present  => eager binding => Full RELRO

readelf -l ./program | grep GNU_RELRO     # presence of the RELRO segment

# checksec summarizes it:
checksec --file=./program     # RELRO column: "Full RELRO" vs "Partial RELRO"
```

### A FORTIFY_SOURCE demonstration (defensive)

```c
#include <string.h>
#include <stdio.h>

int main(void) {
    char buf[8];
    const char *input = "this string is way too long for buf";
    // With -O2 -D_FORTIFY_SOURCE=2, the compiler rewrites this strcpy to
    // __strcpy_chk, which detects the overflow and aborts:
    //   *** buffer overflow detected ***: terminated
    // Without FORTIFY, this silently corrupts the stack.
    strcpy(buf, input);     // intentional bug, caught by FORTIFY
    printf("%s\n", buf);
    return 0;
}
```

```bash
gcc -O2 -D_FORTIFY_SOURCE=2 demo.c -o demo && ./demo
# *** buffer overflow detected ***: terminated   <- FORTIFY caught it
gcc -O0 demo.c -o demo_unsafe && ./demo_unsafe
# (no check at -O0 — silent corruption / crash)
```

### Building with the full hardening set (and what each flag buys)

```bash
gcc -O2 \
    -D_FORTIFY_SOURCE=2     `# size-checked libc funcs` \
    -fstack-protector-strong `# canaries` \
    -fstack-clash-protection `# defends against stack/heap clash` \
    -fcf-protection=full     `# Intel CET (shadow stack + IBT) where supported` \
    -fPIE -pie               `# randomize the executable` \
    -Wl,-z,relro,-z,now      `# Full RELRO` \
    -Wl,-z,noexecstack       `# NX stack` \
    -Wl,-z,separate-code     `# don't mix exec + writable in one page` \
    program.c -o program
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **ASLR** | Cheap on 64-bit; breaks hardcoded-address exploits; layered with NX it forces leaks. | Defeated by a single info leak; weakest region sets the bar; non-PIE/prelink create fixed anchors. |
| **PIE** | Randomizes your own code; closes the biggest fixed anchor. | Small perf cost (GOT/PLT indirection, RIP-relative); historically worse on 32-bit x86. |
| **NX/DEP** | Essentially free; kills code injection; the reason ASLR matters. | Pushes attackers to ROP/return-to-libc, not a complete stop; complicates JITs. |
| **Full RELRO** | Freezes the GOT — no GOT-overwrite hijack. | Slower startup (eager binding); loses lazy binding's pay-for-use. |
| **Stack canaries** | Cheap; catches the classic contiguous stack smash. | Misses non-contiguous writes; the cookie can be leaked; per-function cost. |
| **FORTIFY** | Free, targeted; catches common library overflows. | Only where size is statically known; needs `-O1`+; not a general bounds check. |

---

## Use Cases

- **Hardening a network-facing native service.** Full set: PIE, NX, Full RELRO, canaries, FORTIFY, plus CET/shadow stack where the hardware supports it.
- **Auditing third-party binaries** before deploying them: `checksec` + `readelf` to confirm the protections, and to flag any non-PIE or Partial-RELRO modules.
- **Distribution packaging policy.** Enforce hardening flags across all packages; CI gates on `checksec`.
- **Incident triage.** When investigating a crash that might be exploitation, the layout (`/proc/pid/maps`), RELRO status, and whether a region had low entropy inform how reachable an exploit was.
- **Designing a forking server safely.** Knowing that forks share layout, you add re-exec-on-crash or per-connection process spawning to restore re-randomization, closing the brute-force door.

---

## Coding Patterns

### Pattern 1: Re-randomize per request where it matters

A forking server's children share the parent's layout. If a worker can crash and respawn, an attacker gets repeated identical-layout attempts (the brute-force-the-fork class). Defenses:

- **`execve` after `fork`** (not just `fork`) for new workers, so the child gets a fresh randomized layout.
- **Crash-only design:** on a worker crash, fully re-exec rather than silently respawning a clone, so the attacker can't grind the same layout.

### Pattern 2: Eager binding by default

Compile with `-z now` (Full RELRO). The slightly slower startup is almost always worth a read-only GOT for a security-sensitive service.

### Pattern 3: Don't reintroduce fixed addresses

Audit for anything that pins an address: prelink-style caching, fixed `mmap(MAP_FIXED, ...)` at a constant address, shared memory at a constant address, JIT regions allocated at a predictable base. Each is a fixed anchor. If you must use `MAP_FIXED`, derive the address from a randomized base.

### Pattern 4: Make pointer disclosure impossible by construction

Strip raw pointers from logs, error messages, serialized output, and debug endpoints. Where you need a stable identifier, use an opaque, randomized handle that doesn't reveal an address.

---

## Best Practices

- **Compile 64-bit, PIE, Full RELRO, NX, canaries, FORTIFY** — the full set, as a build default and a CI gate.
- **Prefer eager binding** (`-z now`) for anything security-relevant.
- **Audit for the weakest region and for fixed anchors**, not just "is ASLR on."
- **Restore re-randomization in forking/crash-respawn servers** by re-`exec`ing children.
- **Treat info leaks as critical** — they're the master bypass.
- **Keep toolchain and OS current** to get entropy improvements and CET/shadow-stack support.
- **Don't ship prelinked or non-PIE modules** into hardened processes.
- **Verify, don't assume** — `checksec` and `readelf` on the actual artifact, every build.

---

## Edge Cases & Pitfalls

- **Partial RELRO masquerading as protection.** Many binaries ship Partial RELRO and look "hardened," but the lazy-binding GOT (`.got.plt`) is still writable — the most-attacked table. Insist on Full RELRO.
- **Forking servers re-use layout.** The single biggest practical ASLR weakness for servers. `fork` copies the layout; only `exec` re-randomizes.
- **Partial overwrites beat high entropy.** ASLR randomizes the *high* bits of an address; the *low* bits within a page are fixed. An attacker who can overwrite only the low byte(s) of a pointer can retarget it within a known page *without* defeating randomization at all. This is why "high entropy" isn't a complete answer.
- **Low-entropy stragglers.** A single region with weak entropy undermines the rest. Audit per-region.
- **Mixed PIE/non-PIE process.** One non-PIE library or executable provides a fixed anchor; the attacker doesn't need to beat ASLR for the rest if they can pivot from the fixed module.
- **`MAP_FIXED` and hugepages.** Code that maps memory at a fixed address (some allocators, some JITs, some DBs) creates predictable regions.
- **`_FORTIFY_SOURCE` quietly off.** At `-O0`, or when the destination size isn't statically known, FORTIFY does nothing. Don't assume it's protecting a given call.
- **`LD_PRELOAD`/`LD_LIBRARY_PATH` and setuid.** The loader ignores these for setuid binaries (good), but mis-set environments can change which libraries load where in non-privileged contexts.

---

## Common Mistakes

1. **Accepting Partial RELRO as "RELRO is on."** The function-pointer GOT is still writable.
2. **Forgetting forks share layout.** Respawning a crashed worker as a clone gives attackers unlimited identical attempts.
3. **Trusting entropy numbers as an average.** The minimum-entropy region is what matters.
4. **Ignoring partial overwrites.** High entropy doesn't help when the attacker only needs to flip low bits within a page.
5. **Building with `_FORTIFY_SOURCE` at `-O0`** and believing it's active.
6. **Leaving a non-PIE module in a hardened process** and assuming ASLR covers everything.
7. **Reintroducing fixed addresses** via `MAP_FIXED`, prelink-style caching, or constant-address shared memory.
8. **Disclosing pointers** in logs/errors and treating it as cosmetic.

---

## Tricky Points

- **ASLR randomizes pages, not bytes.** The low ~12 bits (the page offset) are *not* randomized — they're determined by alignment within the region. That's the foothold for partial overwrites.
- **The GOT for data vs. for functions are different.** Partial RELRO protects the former and not the latter. The distinction is the whole point of "partial."
- **Lazy binding requires a writable GOT, which is the security cost.** Eager binding (`-z now`) is what *enables* a read-only GOT. RELRO and binding-mode are linked.
- **NX is what gives ASLR teeth.** Reason about them together: NX forces reuse, ASLR hides the reuse targets. Either one alone is much weaker.
- **A single leaked pointer de-randomizes only its *own* region.** Leaking a stack pointer doesn't tell you libc's base unless you can chain to a libc pointer. Attackers often need a leak that reaches the region they want to reuse.
- **Re-randomization on `fork` doesn't happen; on `exec` it does.** This single fact drives the secure design of forking servers.

---

## Test Yourself

1. Run a PIE binary and a non-PIE binary twice each, dumping `/proc/pid/maps`. Which bases move in each case? Explain the difference.
2. Use `readelf -d` to determine whether a binary has Full or Partial RELRO. Which dynamic-section flag tells you eager binding is in effect?
3. Explain, in terms of writability, *why* Partial RELRO leaves function-pointer hijacking possible but Full RELRO does not.
4. A 64-bit forking server crashes and respawns a clone on each malformed request. Estimate, qualitatively, how this changes the attacker's brute-force cost compared with a server that re-`exec`s each worker.
5. Describe how a partial (low-byte) pointer overwrite can redirect a pointer *within the same page* without defeating ASLR at all. Why doesn't high entropy help here?
6. Why does eager binding (`-z now`) enable a read-only GOT, while lazy binding requires a writable one?
7. Explain the historical prelink weakness in one sentence, then name two modern ways the same "fixed address" mistake can sneak back in.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│              ASLR INTERNALS & COMPOSITION (MID-LEVEL)            │
├──────────────────────────────────────────────────────────────────┤
│ WHO RANDOMIZES:                                                  │
│   kernel  -> stack base, mmap base, brk; PIE load bias at exec   │
│   ld.so   -> places libs within randomized mmap, applies relocs  │
├──────────────────────────────────────────────────────────────────┤
│ ENTROPY:  strength = MIN entropy over targetable regions         │
│   32-bit mmap ~16 bits  -> brute-forceable                       │
│   64-bit mmap ~28 bits  -> impractical without a leak            │
│   low 12 bits (page offset) NOT randomized -> partial overwrites │
├──────────────────────────────────────────────────────────────────┤
│ PIC CALL PATH:  call f@plt -> jmp *GOT[f] -> (lazy) resolver      │
│                 resolver writes real addr into GOT[f]            │
│   GOT must be WRITABLE for lazy binding -> attack surface        │
├──────────────────────────────────────────────────────────────────┤
│ RELRO:  Partial = .got.plt still writable (func ptrs hijackable) │
│         Full (-z now) = eager bind, ENTIRE GOT read-only         │
│ NX:     data not executable -> forces code REUSE -> needs ASLR   │
│ CANARY: detects contiguous stack-return smash; can be leaked     │
│ FORTIFY:size-checked libc funcs; needs -O1+, static size known   │
├──────────────────────────────────────────────────────────────────┤
│ WEAKNESSES:  info leak (whole region), partial overwrite (page), │
│   forking servers (shared layout), non-PIE / prelink (anchors)   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Randomization is a **division of labor**: the kernel randomizes the stack/mmap/brk bases and the PIE load bias at `exec`; the dynamic linker places libraries within the randomized mmap region and applies relocations.
- **Entropy is a minimum, not an average.** 32-bit mmap (~16 bits) is brute-forceable; 64-bit (~28 bits) is not, absent a leak. The low ~12 bits (page offset) are never randomized — the door for partial overwrites.
- **PIC** avoids absolute addresses with RIP-relative addressing internally and **GOT/PLT** indirection externally. Lazy binding resolves on first call and *writes the resolved address into the GOT* — which is why the GOT is writable, which is why it's attacked.
- **RELRO**: Partial leaves the function-pointer GOT (`.got.plt`) writable; **Full** (`-z relro -z now`) eager-binds and makes the entire GOT read-only. Always want Full.
- **NX/DEP** is what gives ASLR teeth: it forbids code injection, forcing attackers into code reuse, which requires the addresses ASLR hides.
- **Canaries** and **FORTIFY** add targeted layers — contiguous-overflow detection and size-checked library calls — each with known blind spots (non-contiguous writes; unknown sizes / `-O0`).
- **Prelink** is the cautionary tale: an optimization that fixed library addresses and thereby disabled ASLR. Any pinned address (`MAP_FIXED`, cached layouts, constant shared memory, predictable JIT regions) re-creates that weakness.
- The practical bypass classes — **info leak** (de-randomizes a region), **partial overwrite** (retarget within a page), **brute force on forking servers** (shared layout), **fixed anchors** (non-PIE) — all follow from these mechanics. Design and audit against them.

---

## Further Reading

- *"On the Effectiveness of Address-Space Randomization"* — Shacham, Page, Pfaff, Goh, Modadugu, Boneh (CCS 2004). The 16-bit brute-force result.
- *PaX ASLR design docs* — https://pax.grsecurity.net/docs/aslr.txt
- *"RELRO: Relocation Read-Only"* — write-ups explaining Partial vs. Full RELRO and the `.got.plt` distinction.
- *ELF and dynamic linking* — *"How To Write Shared Libraries"* by Ulrich Drepper. The authoritative PIC/GOT/PLT reference.
- *Linux kernel docs* — `Documentation/admin-guide/sysctl/kernel.rst` (`randomize_va_space`) and per-arch ELF ASLR settings.
- *The GCC and binutils manuals* — `-fPIE`, `-z relro`, `-z now`, `-fstack-protector-strong`, `-D_FORTIFY_SOURCE`.
- *"Hardening ELF binaries"* — distribution hardening guides (e.g., the Debian and Gentoo hardening wikis).
- *Intel CET documentation* — shadow stacks and indirect-branch tracking (for the modern-hardening section in later levels).

---

## Diagrams & Visual Aids

### The randomization pipeline at exec

```text
   execve("/path/program")
        │
        ▼
   ┌────────────────────────── kernel ──────────────────────────┐
   │  pick random stack base                                    │
   │  pick random mmap base                                     │
   │  pick random brk offset                                    │
   │  if PIE: pick random load bias for the executable          │
   └────────────────────────────┬───────────────────────────────┘
                                 ▼
   ┌──────────────────────── ld.so ────────────────────────────┐
   │  load each shared lib within the randomized mmap region    │
   │  apply relocations (fix up addresses for the chosen bias)  │
   │  (eager binding if -z now: resolve all symbols now)        │
   │  apply RELRO: mprotect read-only-after-reloc data          │
   └────────────────────────────┬───────────────────────────────┘
                                 ▼
                       program main() runs
```

### Lazy binding through the PLT/GOT

```text
   1st call:                          subsequent calls:
   call printf@plt                    call printf@plt
        │                                  │
   PLT stub: jmp *GOT[printf]          PLT stub: jmp *GOT[printf]
        │  (points back to resolver)        │  (now points to printf)
        ▼                                    ▼
   ld.so resolver                         printf  (direct)
        │ writes real addr -> GOT[printf]
        ▼
      printf

   GOT writable  =>  lazy binding works  =>  GOT-overwrite attack works
   Full RELRO (-z now) eager-binds, then freezes GOT read-only.
```

### Partial vs. Full RELRO

```text
   PARTIAL RELRO                       FULL RELRO  (-z relro -z now)
   ┌────────────────────┐              ┌────────────────────┐
   │ .got     read-only │              │ .got     read-only │
   │ .got.plt WRITABLE  │ <-- attack   │ .got.plt read-only │ <-- frozen
   └────────────────────┘              └────────────────────┘
   func-ptr table hijackable           func-ptr table frozen
```

### Partial overwrite: why high entropy isn't enough

```text
   Pointer = [ randomized high bits | fixed page offset (low ~12 bits) ]
                       ^^^^                       ^^^^
                 ASLR randomizes here       NEVER randomized

   Attacker overwrites only the low byte(s):
     original  0x7f3c9a1b2d40
     becomes   0x7f3c9a1b2dXX   <- still in the SAME known page
   => retargets within a known region WITHOUT defeating ASLR.
```
