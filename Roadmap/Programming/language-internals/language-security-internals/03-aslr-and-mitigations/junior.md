# ASLR & Mitigations — Junior Level

> **Topic:** [ASLR & Mitigations](README.md)
> **Focus:** Why randomizing where your program's pieces live in memory makes an attacker's job harder — and the simple companion defenses that work alongside it.

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
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is ASLR, and why does randomizing memory addresses stop a whole class of attacks?**

When a program runs, the operating system loads it into memory. The code, the stack, the heap, and every shared library each gets a **base address** — a starting location in the process's virtual address space. An attacker who wants to hijack the program usually needs to know those addresses. If they want to make the program "jump to the function that runs a shell," they need to know *where that function lives* in memory. If they want to write a return address onto the stack that points at a useful gadget, they need to know *where that gadget is*.

**Address Space Layout Randomization (ASLR)** takes those base addresses and **randomizes them every time the program starts.** The stack starts at a different place. The heap starts at a different place. Each shared library is loaded at a different place. With **PIE** (Position-Independent Executable), even the program's own code moves. The attacker can no longer hardcode an address into their exploit, because the address that worked yesterday is wrong today, and the address that works on your machine is wrong on mine.

That is the entire idea in one sentence: **if the attacker doesn't know where things are, they can't reliably point at them.** ASLR doesn't fix the underlying bug — a buffer overflow is still a buffer overflow — it makes *exploiting* the bug into a guessing game.

> 🎓 **Why this matters for a junior:** You will eventually compile and ship software, and the flags you pass to the compiler and linker decide whether your binary gets these protections. A program built without PIE or without a non-executable stack is *easier to attack* even if your code is otherwise fine. Knowing what `-fPIE -pie` and `-z relro -z now` do — and being able to read a `checksec` report — is a baseline skill for anyone who ships native code.

ASLR rarely works alone. It is paired with **DEP/NX** (memory marked as data cannot be executed as code), **stack canaries** (a guard value that detects stack overwrites), **RELRO** (making certain tables read-only), and **FORTIFY_SOURCE** (compiler-inserted bounds checks on common functions). Together these are called **defense in depth**: no single layer is perfect, but each one removes an easy path, and an attacker has to defeat all of them at once. This page introduces each layer and shows you how to check whether a binary has them.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a variable, a function, and a pointer are. You don't need to write C fluently, but you should know that a pointer holds an *address*.
- **Required:** The rough idea that a running program lives in memory and has a **stack** (for function calls and local variables) and a **heap** (for dynamic allocations).
- **Required:** How to run a command in a terminal.
- **Helpful but not required:** A vague sense of what a "buffer overflow" is — writing past the end of an array.
- **Helpful but not required:** That programs link against **shared libraries** (like the C standard library, `libc`).

You do **not** need to know:

- How to write an exploit (we never do that here — this is defensive material).
- Assembly language, ROP chains, or gadget hunting in detail (that's `senior.md`).
- The kernel internals of how randomization entropy is generated (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Address space** | The full range of memory addresses a process can use. On 64-bit systems it is enormous (millions of terabytes of *virtual* space). |
| **Base address** | The starting address where a region (code, stack, heap, a library) is placed in memory. |
| **ASLR** | Address Space Layout Randomization — randomizing base addresses each run so attackers can't predict where things are. |
| **Entropy** | The amount of randomness, measured in bits. More bits = more possible positions = harder to guess. |
| **PIE** | Position-Independent Executable — a program compiled so its *own code* can be loaded at a random base, not just the libraries. |
| **PIC** | Position-Independent Code — code that works regardless of where it's loaded, using relative addressing. PIE is built from PIC. |
| **DEP / NX / W^X** | Data Execution Prevention / No-eXecute / Write-XOR-Execute — a memory page is either writable or executable, never both. Stops running injected data as code. |
| **Stack canary** | A random guard value placed before the return address; if an overflow smashes it, the program aborts instead of returning to attacker-controlled code. |
| **RELRO** | RELocation Read-Only — makes the linker's resolved-address tables read-only so attackers can't overwrite them. |
| **GOT** | Global Offset Table — a table of resolved addresses for external functions/data a PIC program calls. |
| **PLT** | Procedure Linkage Table — small stubs that route calls to external functions through the GOT. |
| **FORTIFY_SOURCE** | A compiler feature that swaps risky functions (`strcpy`, `memcpy`, `sprintf`) for bounds-checked versions when the size is known. |
| **Info leak** | A bug that discloses a real runtime address (or other secret) to the attacker, undoing randomization for that region. |
| **Shared library** | Reusable code (like `libc`) loaded into many processes; under ASLR, loaded at a random base each time. |
| **`checksec`** | A common tool that reports which mitigations a binary has (PIE, NX, RELRO, canary, FORTIFY). |

---

## Core Concepts

### 1. Where the pieces of a program live

When a process starts, its virtual address space is carved into regions. A simplified picture:

```text
high addresses
  ┌───────────────────────────┐
  │  stack (grows downward)   │   local variables, return addresses
  ├───────────────────────────┤
  │           ...             │
  │   shared libraries        │   libc, libssl, ...
  │           ...             │
  ├───────────────────────────┤
  │  heap (grows upward)      │   malloc / new
  ├───────────────────────────┤
  │  BSS / data               │   globals
  │  text (code)              │   your program's machine instructions
  └───────────────────────────┘
low addresses
```

Each of those regions has a **base address**. Without ASLR, those bases are the *same every run* — predictable. An attacker can open the binary, note that some useful function sits at, say, `0x401234`, and bake that number into their attack. It will work every time.

### 2. What ASLR actually randomizes

ASLR shifts the base address of each region by a random amount each time the program starts:

- **Stack base** — randomized.
- **Heap / `mmap` base** — randomized (this also covers where shared libraries land).
- **Shared libraries** — each loaded at a random offset.
- **The executable itself** — randomized *only if it's a PIE*. A non-PIE executable's code stays at a fixed address even with ASLR on. This is a crucial gap.

So `0x401234` is no longer a stable target. The same function might be at `0x55a3b1e91234` this run and `0x7f02c4d51234` the next. The attacker's hardcoded number is now wrong.

### 3. Entropy: why 64-bit beats 32-bit

The strength of ASLR is the number of possible positions, measured in **bits of entropy**. If there are 2^N possible base addresses, the attacker has a 1-in-2^N chance of guessing right.

- On **32-bit** systems, the usable address space is small, so ASLR can only offer roughly 8–16 bits of entropy for some regions. 2^8 = 256, 2^16 = 65,536. Those are small enough that an attacker who can retry quickly can simply **brute-force** them — guess until one works.
- On **64-bit** systems, there's vastly more room, so regions can get ~28–30+ bits of entropy. 2^28 ≈ 268 million guesses. Brute-forcing becomes impractical for most attacks (and each wrong guess usually crashes the process, which is noisy and slow).

**Takeaway:** 32-bit ASLR is weak by design; 64-bit ASLR is genuinely strong. If you can build 64-bit, do.

### 4. PIE and PIC: making the code itself movable

For the libraries to be relocatable, their code must not contain hardcoded absolute addresses. **Position-Independent Code (PIC)** uses *relative* addressing ("jump 200 bytes forward from here") and routes external references through a small table. A **Position-Independent Executable (PIE)** applies the same technique to your main program, so the OS can load *it* at a random base too.

When PIC code needs to call an external function like `printf`, it doesn't jump to a fixed address. It goes through two tables:

- The **PLT (Procedure Linkage Table)** — a small stub for each external function.
- The **GOT (Global Offset Table)** — where the *real, resolved* address of each external function gets stored at runtime.

The first call to `printf` resolves its real address and stores it in the GOT; later calls jump straight through. This indirection is what makes the code position-independent. It's also a target: if an attacker can overwrite a GOT entry, they can redirect a function call. That's exactly why **RELRO** exists.

### 5. The companion mitigations

ASLR is one layer. The others:

- **DEP / NX / W^X:** Marks the stack, heap, and data pages as **non-executable**. An old attack technique was to inject machine code into a buffer and jump to it; NX makes that injected code un-runnable. This forces attackers toward more complex techniques (reusing existing code instead of injecting new code).
- **Stack canaries:** The compiler inserts a random value between local variables and the saved return address. Before a function returns, it checks the canary. A linear buffer overflow that overwrites the return address *also* overwrites the canary, the check fails, and the program aborts. (Covered in depth in a sibling stack-protection topic; here we just note it composes with ASLR.)
- **RELRO:** After the dynamic linker resolves external addresses into the GOT, **Full RELRO** marks the GOT read-only. Now an attacker can't overwrite GOT entries to hijack calls. **Partial RELRO** protects less.
- **FORTIFY_SOURCE:** When you call `strcpy(dst, src)` and the compiler can see the size of `dst`, FORTIFY swaps in a checked version that aborts on overflow instead of corrupting memory.

### 6. Why they're stronger together

Imagine an attacker with a buffer overflow:

- With **NX** on, they can't inject and run shellcode. They must reuse existing code.
- To reuse existing code, they need to know *where that code is* — but **ASLR** randomized it.
- To learn where it is, they need an **info leak** (a separate bug that discloses an address).
- Even with a leak, **canaries** make smashing the stack to reach the return address risky.
- Even if they redirect a call, **Full RELRO** stopped the easy GOT overwrite.

Each layer doesn't *prevent* the next attack outright; it *raises the cost*. The attacker now needs the overflow **plus** an info leak **plus** a way around the canary, instead of just the overflow. That compounding cost is the whole point of defense in depth.

### 7. The one weakness to remember: info leaks

This is the single most important caveat about ASLR, and it's worth memorizing now: **ASLR is defeated by an information leak.** If any bug lets the attacker read even *one* real pointer from a randomized region, they learn that region's base, and the *entire region is de-randomized*. Leak one libc pointer, and you know where *all* of libc is, because the internal layout of a library is fixed — only the base moves. ASLR randomizes *where the deck starts*, but the cards are still in the same order. See one card's position and you know them all.

This is why modern exploits are usually **two bugs**: an info-leak bug to beat ASLR, and a memory-corruption bug to take control.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **ASLR** | A hotel that shuffles every guest into a different room number each night. A burglar who knew "room 412 has the safe" is now lost. |
| **Base address** | The room number where a given guest is staying tonight. |
| **Fixed (non-PIE) code** | One room — the manager's office — that never moves no matter how much the guests are shuffled. The burglar targets that one. |
| **Entropy / bits** | How many rooms the hotel has. A 4-room motel (low entropy) is easy to search door-to-door; a 10,000-room resort (high entropy) is not. |
| **Brute force** | Trying every door. Feasible in the motel, hopeless in the resort. |
| **Info leak** | A clerk who accidentally tells the burglar one guest's room number — and the burglar happens to know the whole VIP floor is always laid out the same way relative to that guest. |
| **NX / DEP** | A rule that you can store luggage in a room but cannot *live* there — data can be stored but not executed. |
| **Stack canary** | A thin paper seal across the safe's door. If it's torn, you know someone tried to break in, and you sound the alarm before they get anything. |
| **RELRO** | Bolting the hotel directory (which maps names to rooms) to the wall after check-in so nobody can rewrite it to misdirect deliveries. |
| **Defense in depth** | Shuffled rooms *and* sealed safes *and* a bolted directory *and* a "no living in storage rooms" rule. Beating one isn't enough. |

---

## Mental Models

### The "shuffled deck" model

A loaded library is a deck of cards in a fixed order. ASLR shuffles *where the deck sits on the table* (the base address) but never reorders the cards (the internal layout). So if you ever spot one card's exact position — an info leak — you instantly know where every other card is, by simple offset arithmetic. This is why a single leaked pointer collapses ASLR for an entire region. Carry this image: **ASLR moves the deck, not the cards.**

### The "two locks, one key each" model

Think of a modern exploit as needing to open two locks: one randomizes *where* the useful code is (ASLR), and one forbids *running your own injected* code (NX). A pre-2000s attacker carried one key (inject shellcode, jump to it). Modern mitigations split the door into two locks needing two different keys — typically an info leak (for ASLR) and a corruption primitive (for control). Each mitigation you enable adds a lock.

### The "cost, not impossibility" model

Don't think of mitigations as walls that make exploitation *impossible*. Think of them as **tolls**. Each one adds a cost — another bug the attacker must find, another constraint they must satisfy. Most attackers give up when the toll exceeds the payoff. A determined, well-resourced attacker with enough bugs can still pass, which is why you never rely on a single mitigation and never stop fixing the underlying memory-safety bugs.

---

## Code Examples

We are **defensive** here. The examples below are about *building* and *checking* protections, not attacking. There are no exploits.

### Checking ASLR status on Linux

```bash
# 0 = off, 1 = partial (stacks/libs/mmap), 2 = full (also brk heap)
cat /proc/sys/kernel/randomize_va_space
# Most modern distros report: 2
```

### Observing that addresses move between runs

A tiny, safe program that prints the address of a stack variable, a heap allocation, and a libc function. Run it a few times: with ASLR on, the numbers change each run.

```c
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int local = 0;
    int *heap = malloc(sizeof(int));
    printf("stack var : %p\n", (void *)&local);
    printf("heap alloc: %p\n", (void *)heap);
    printf("printf @  : %p\n", (void *)printf);  // a libc address
    free(heap);
    return 0;
}
```

```bash
$ ./addrs ; ./addrs
stack var : 0x7ffe1a2b3c4c
heap alloc: 0x55d9e4f012a0
printf @  : 0x7f3c9a1b2d40
stack var : 0x7ffd88c4e91c    # different each run = ASLR working
heap alloc: 0x561af20b32a0
printf @  : 0x7f81c33a4d40
```

If those numbers were *identical* across runs, ASLR would be off (or the binary is non-PIE for the executable's own addresses).

### Compiling with the protections turned on (GCC/Clang on Linux)

```bash
# PIE + non-executable stack + stack canaries + Full RELRO + FORTIFY
gcc -O2 -D_FORTIFY_SOURCE=2 \
    -fstack-protector-strong \
    -fPIE -pie \
    -Wl,-z,relro,-z,now \
    -Wl,-z,noexecstack \
    program.c -o program
```

- `-fPIE -pie` → the executable's code is position-independent and gets randomized.
- `-fstack-protector-strong` → stack canaries on functions that need them.
- `-Wl,-z,relro,-z,now` → Full RELRO (resolve everything at load, then make the GOT read-only).
- `-Wl,-z,noexecstack` → ensure the stack page is non-executable (NX).
- `-D_FORTIFY_SOURCE=2` → bounds-checked variants of common functions (needs optimization, e.g. `-O2`).

### Reading a `checksec` report

```bash
$ checksec --file=./program
RELRO           STACK CANARY      NX            PIE
Full RELRO      Canary found      NX enabled    PIE enabled
```

That is the "all green" report you want for a hardened native binary. A report showing `No RELRO`, `No canary found`, `NX disabled`, or `No PIE` flags a binary that's easier to attack.

### Confirming a binary is a PIE

```bash
$ file ./program
./program: ELF 64-bit LSB pie executable, x86-64, ...
#                          ^^^ "pie executable" — good

# A non-PIE binary would say "LSB executable" without "pie".
```

### Checking ASLR-relevant settings on other platforms (conceptual)

- **Windows:** ASLR (and DEP) are controlled per-binary by linker flags (`/DYNAMICBASE` for ASLR, `/NXCOMPAT` for DEP, `/HIGHENTROPYVA` for 64-bit high-entropy ASLR). System-wide and per-app policy can also be set via **Exploit Protection** (the modern successor to the older EMET tool) in Windows Security.
- **macOS:** ASLR is on by default; system binaries are built position-independent, and the loader (`dyld`) randomizes the shared cache and library placement.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Security value** | Cheaply breaks exploits that rely on hardcoded addresses; raises attacker cost dramatically. | Does **not** fix the underlying bug; a single info leak can fully bypass it for a region. |
| **Performance** | On 64-bit, the runtime cost is negligible. NX and RELRO are essentially free. | PIE can add a small overhead (extra indirection through GOT/PLT, lost addressing optimizations) — usually low single-digit percent, occasionally more on register-starved 32-bit x86. |
| **Compatibility** | On by default in modern OSes; most toolchains support it. | Some old or unusual code (JITs, certain self-modifying programs) needs care to coexist with NX and ASLR. |
| **Entropy** | Strong on 64-bit (28–30+ bits). | Weak on 32-bit (brute-forceable); some regions have lower entropy than others. |
| **Operational** | A `checksec`-clean binary is a clear, auditable signal of hardening. | Mixed binaries (one non-PIE module) silently weaken the whole process. Easy to misconfigure. |

---

## Use Cases

ASLR and its companions matter most when:

- **You ship native binaries** (C, C++, Rust, Go cgo) that process untrusted input — parsers, servers, image/codec libraries, anything reachable from the network or from files.
- **You run setuid or privileged processes** where a single bug can mean privilege escalation. Hardening flags are non-negotiable here.
- **You're packaging software for a distribution** — distros run `checksec`-style audits and expect PIE + Full RELRO + NX + canaries.
- **You're doing a security review** and need to quickly assess a binary's baseline defenses before digging deeper.

They matter **less** (but are still good hygiene) when:

- The code is pure managed/memory-safe language with no native parts and no FFI to untrusted native code. Memory-safety bugs that ASLR mitigates are rarer there — but the runtime itself is still native and benefits.

---

## Coding Patterns

### Pattern 1: Make hardening flags a build default, not an afterthought

Bake the flags into your build system so every binary gets them, instead of relying on memory:

```makefile
CFLAGS  += -O2 -D_FORTIFY_SOURCE=2 -fstack-protector-strong -fPIE
LDFLAGS += -pie -Wl,-z,relro,-z,now -Wl,-z,noexecstack
```

### Pattern 2: Verify in CI, don't trust

Add a CI step that fails the build if a binary loses a protection:

```bash
# Fail if PIE, RELRO, NX, or canary is missing.
checksec --file=./build/program --output=json \
  | grep -q '"pie":"yes"' || { echo "FAIL: not a PIE"; exit 1; }
```

(Use the tool's actual JSON keys; the point is *automated enforcement*.)

### Pattern 3: Don't undo ASLR by accident

Avoid build or runtime settings that disable randomization unless you have a strong reason:

- Don't `setarch -R` (which disables ASLR) outside of debugging.
- Don't ship a non-PIE executable in a process that loads PIE libraries — the fixed module becomes the attacker's anchor.
- Don't bake absolute addresses into your own code or config.

### Pattern 4: Treat info leaks as critical, not cosmetic

A log line, error message, or debug endpoint that prints a raw pointer is an **ASLR bypass primitive**. Strip pointers from anything an attacker can read. Treat "this prints an address" as a security bug, not a logging nuisance.

---

## Best Practices

- **Build 64-bit when you can.** It's the single biggest entropy win.
- **Turn everything on:** PIE, NX, Full RELRO, stack canaries, FORTIFY. The combined cost is small; the combined benefit is large.
- **Audit with `checksec`** (or platform equivalents) and enforce the result in CI.
- **Don't let one non-PIE module weaken the process.** Hardening is only as strong as the least-hardened loaded object.
- **Fix the bug, don't just rely on the mitigation.** ASLR makes exploitation harder, not impossible. Memory-safe languages and careful bounds-checking remove the bug class entirely.
- **Treat any pointer disclosure as a serious vulnerability.** It's the master key to ASLR.
- **Keep your OS and libraries updated.** Entropy improvements, stronger KASLR, and CET/shadow-stack support arrive through updates.
- **On Windows, opt into high-entropy 64-bit ASLR** (`/HIGHENTROPYVA`) and DEP (`/NXCOMPAT`), and consider Exploit Protection policies.

---

## Edge Cases & Pitfalls

- **Non-PIE in an ASLR world.** Turning ASLR on does **not** randomize a non-PIE executable's own code — only the stack, heap, and libraries move. The fixed code becomes a reliable anchor for attackers. You must compile with `-fPIE -pie` to randomize the executable.
- **One un-randomized module breaks the chain.** A process is a mix of the executable and all its libraries. If even one of them is loaded at a fixed address (non-PIC, or a legacy DLL without ASLR), the attacker has a fixed reference point that doesn't depend on guessing.
- **Low-entropy regions.** Not all regions get equal randomization. Historically some had far fewer bits than others; an attacker targets the weakest region.
- **Forking servers don't re-randomize.** When a process `fork()`s, the child inherits the *same* memory layout as the parent — same randomization. A server that handles each request in a fork, and *crashes and respawns from the same parent* on failure, gives the attacker many identical-layout attempts. This is the core insight behind brute-forcing forking servers, even on 64-bit.
- **`_FORTIFY_SOURCE` needs optimization.** It only kicks in with `-O1` or higher; at `-O0` it silently does nothing. A debug build is less protected than a release build.
- **Disabling ASLR for debugging and forgetting.** Developers often disable ASLR to make debugging reproducible (`setarch -R`, or core-dump tooling). Make sure production never runs that way.
- **JITs and ASLR.** Just-in-time compilers generate executable code at runtime, which interacts with NX/W^X. Done carelessly, a JIT region can become an attacker's playground (see "JIT spray" in later levels). This is an advanced concern; just know JITs need special handling.

---

## Common Mistakes

1. **Thinking ASLR fixes the bug.** It doesn't. It makes the bug harder to *exploit*. The buffer overflow is still there.
2. **Shipping a non-PIE binary and assuming ASLR covers it.** The executable's own code stays put without PIE.
3. **Leaving `_FORTIFY_SOURCE` on but building at `-O0`.** It does nothing without optimization.
4. **Printing pointers in logs or errors.** That's a free ASLR bypass handed to anyone who reads the output.
5. **Disabling ASLR globally "to make a crash reproducible" and never re-enabling it** in the shipped artifact.
6. **Confusing Partial and Full RELRO.** Partial RELRO leaves the GOT writable; only Full RELRO (`-z now`) makes it read-only.
7. **Assuming 32-bit ASLR is strong.** It's brute-forceable. Don't rely on it.
8. **Forgetting that mitigations compose.** Enabling only one (say, just NX) leaves the others' attack paths wide open.

---

## Test Yourself

1. Compile the `addrs` example and run it five times. Do the three addresses change each run? Which one *doesn't* change if you build with `-no-pie`, and why?
2. Read `/proc/sys/kernel/randomize_va_space` on your machine. What does each of `0`, `1`, `2` mean?
3. Run `checksec` on a system binary like `/bin/ls` and on a hello-world you compiled with no special flags. Compare the reports. Which protections are missing on your hello-world?
4. Explain in one sentence why leaking a single `libc` pointer de-randomizes all of `libc`.
5. A forking web server crashes and respawns on each malformed request, always from the same parent process. Why does this *help* an attacker brute-force ASLR, even on 64-bit?
6. Which mitigation stops an attacker from *injecting* shellcode into a buffer and running it: ASLR, NX, or RELRO? Which one stops them from *finding* existing code to reuse?
7. Why does PIE sometimes cost a little performance, while NX and RELRO are essentially free?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                    ASLR & COMPANION MITIGATIONS                  │
├──────────────────────────────────────────────────────────────────┤
│ ASLR   randomize base addresses each run                         │
│        stack / heap / libs always; executable ONLY if PIE        │
│        32-bit = weak (brute-forceable); 64-bit = strong          │
├──────────────────────────────────────────────────────────────────┤
│ PIE/PIC  make code relocatable (relative addressing + GOT/PLT)   │
│ NX/DEP   data pages not executable — no injected shellcode       │
│ Canary   guard value detects stack-return-address smash          │
│ RELRO    GOT read-only (Full) so calls can't be hijacked         │
│ FORTIFY  bounds-checked strcpy/memcpy/sprintf (needs -O1+)       │
├──────────────────────────────────────────────────────────────────┤
│ THE WEAKNESS:  one info-leak de-randomizes a whole region        │
│                (move the deck, not the cards)                    │
├──────────────────────────────────────────────────────────────────┤
│ BUILD (gcc/clang, Linux):                                        │
│   -O2 -D_FORTIFY_SOURCE=2 -fstack-protector-strong               │
│   -fPIE -pie -Wl,-z,relro,-z,now -Wl,-z,noexecstack              │
│ CHECK:  checksec --file=./bin   |   file ./bin  (look for "pie") │
│ ASLR:   cat /proc/sys/kernel/randomize_va_space  (want 2)        │
├──────────────────────────────────────────────────────────────────┤
│ RULE:  mitigations RAISE COST; they don't replace fixing bugs.   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **ASLR** randomizes the **base addresses** of the stack, heap, libraries, and (with **PIE**) the executable itself, every time the program runs. An attacker can no longer hardcode an address.
- The strength is **entropy**: 32-bit ASLR is weak (brute-forceable); 64-bit ASLR is strong (hundreds of millions of positions).
- **PIE/PIC** make code relocatable using relative addressing and the **GOT/PLT** indirection for external calls.
- Companion mitigations: **NX/DEP** (no executing data), **stack canaries** (detect stack smashes), **RELRO** (read-only GOT), **FORTIFY_SOURCE** (bounds-checked library functions).
- Together they form **defense in depth** — each layer raises the attacker's cost, forcing them to find multiple bugs instead of one.
- **The key weakness:** ASLR is defeated by an **information leak**. One disclosed pointer de-randomizes its whole region, because the layout inside a region is fixed — only the base moves.
- A **non-PIE** module, a **forking server** that doesn't re-randomize, and **low-entropy** regions all weaken ASLR in practice.
- Build hardened (`-fPIE -pie -fstack-protector-strong -Wl,-z,relro,-z,now -D_FORTIFY_SOURCE=2`), verify with `checksec`, enforce in CI, and **still fix the underlying bug** — mitigations make exploitation harder, not impossible.

---

## Further Reading

- *PaX ASLR documentation* — the original design from the PaX/grsecurity project that pioneered ASLR on Linux. https://pax.grsecurity.net/docs/aslr.txt
- *"On the Effectiveness of Address-Space Randomization"* — Shacham et al., 2004. The classic paper showing 32-bit ASLR can be brute-forced.
- *Linux kernel documentation* — `Documentation/admin-guide/sysctl/kernel.rst` (the `randomize_va_space` knob).
- *"A Eulogy for Format Strings"* and general write-ups on `checksec` usage — Phrack and the `checksec.sh` project page.
- *Microsoft documentation* — "Exploit protection reference" and the `/DYNAMICBASE`, `/NXCOMPAT`, `/HIGHENTROPYVA` linker options.
- *The GCC manual* — sections on `-fstack-protector`, `-fPIE`, and `_FORTIFY_SOURCE`.
- *"Smashing The Stack For Fun And Profit"* — Aleph One, 1996. The historical context for *why* these mitigations exist (read for understanding, not instruction).

---

## Diagrams & Visual Aids

### Same program, two runs (ASLR on)

```text
RUN 1                              RUN 2
┌───────────────┐  0x7ffe…         ┌───────────────┐  0x7ffd…   <- stack moved
│  stack        │                  │  stack        │
├───────────────┤                  ├───────────────┤
│  libc @ 0x7f3c…│                 │  libc @ 0x7f81…│           <- libc moved
├───────────────┤                  ├───────────────┤
│  heap @ 0x55d9…│                 │  heap @ 0x561a…│           <- heap moved
├───────────────┤                  ├───────────────┤
│  code (PIE)   │  random base     │  code (PIE)   │  random base
└───────────────┘                  └───────────────┘
   A hardcoded address from RUN 1 is wrong in RUN 2.
```

### How an info leak collapses ASLR for a region

```text
   libc loaded at random base B (unknown to attacker)
   ┌──────────────────────────── libc ───────────────────────────┐
   │  B+0x000   B+0x100   ...   printf@B+0x64d40   system@B+0x50d70 │
   └───────────────────────────────────────────────────────────────┘

   Attacker leaks ONE real address:  printf is at 0x7f3c9a1b2d40
   Since printf is always at B+0x64d40:
        B = 0x7f3c9a1b2d40 - 0x64d40 = 0x7f3c9a14e000
   Now EVERY libc address is known:  system = B + 0x50d70  ...

   One leaked card → the whole deck's positions are known.
```

### Defense-in-depth: the attacker must defeat ALL layers

```text
   buffer overflow  ──►  wants to run attacker code
        │
        ├─ NX/DEP    : can't run injected data  ─► must reuse existing code
        ├─ ASLR      : doesn't know where code is ─► needs an INFO LEAK
        ├─ Canary    : smashing the stack is detected ─► must avoid/leak it
        └─ Full RELRO: GOT is read-only ─► can't hijack the call table

   Result: one bug is no longer enough. Attacker needs leak + corruption
           + canary bypass, all at once. THAT is the raised cost.
```
