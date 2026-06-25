# Control-Flow Integrity — Middle Level

> **Topic:** [Control-Flow Integrity](README.md)
> **Focus:** How code reuse generalizes into ROP/JOP/COP, and how forward-edge CFI (LLVM CFI, Microsoft CFG/XFG) restricts indirect calls to legitimate target sets.

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

---

## Introduction

> Focus: **Once injected code is dead (NX) and the return address has a tripwire (canary), how do attackers still hijack control flow — and how do we restrict the *forward edge* to fight back?**

At the junior level, the story ended with two facts: NX killed injected shellcode, and the attacker's response was *code reuse* — running the program's own executable code in an order the programmer never intended. Return-to-libc was the toy version. This page covers the industrial version: **Return-Oriented Programming (ROP)** and its cousins JOP/COP, which compose tiny existing snippets into arbitrary computation, and then the first systematic defense aimed at the **forward edge**: restricting where indirect *calls* are allowed to go, via **LLVM CFI**, **Microsoft Control Flow Guard (CFG)**, and **XFG**.

The mental pivot from junior to middle is this: stop thinking about *one* corrupted address jumping to *one* place. Start thinking about a corrupted **stack full of addresses**, each one a "return" that lands on a tiny code fragment, runs two or three instructions, and "returns" again — to the next fragment. The attacker isn't supplying *code*; they're supplying a *sequence of addresses* (a "chain"), and the program's own bytes do the work. This is the abstraction that made NX, by itself, insufficient, and forced the industry toward CFI.

> 🎓 **Why this matters for a mid-level engineer:** This is the level where security stops being "use `snprintf`" and becomes "understand the threat model your platform mitigations assume." If you ship C/C++ — drivers, runtimes, services, plugins — you need to know what `-fsanitize=cfi` and `/guard:cf` actually check, what they *don't*, and why "coarse" CFI got bypassed while "fine-grained" CFI is the real target. This is also where you learn to read a hardening report and know whether "CFI: enabled" means much.

This page covers: ROP gadgets and the chain abstraction (conceptually, no working chains), JOP/COP for indirect jumps and calls, the distinction between **coarse-** and **fine-grained** CFI and why coarse CFI fell, and the design of forward-edge CFI — **type-based target sets** (LLVM CFI), Microsoft **CFG/XFG**, and the related hardening of GOT/PLT via **RELRO**. The next level (`senior.md`) covers the backward edge: shadow stacks and hardware (CET, PAC, BTI).

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in `junior.md` — control flow, indirect branches, stack smashing, NX, canaries, return-to-libc.
- **Required:** A working picture of a stack frame: return address, saved registers, locals.
- **Required:** What a C++ **vtable** is — a per-class table of function pointers used for virtual dispatch.
- **Helpful but not required:** Basic familiarity with `ret`, `call`, `jmp` instructions and the idea that `ret` pops an address off the stack and jumps to it.
- **Helpful but not required:** Awareness of dynamic linking (the GOT and PLT).

You do **not** need to know:

- How to *build* a ROP chain (we describe the concept defensively, not the construction).
- Shadow stacks, CET, PAC, BTI — those are `senior.md`.
- The CFI bypass research frontier (COOP, data-only attacks) — that's `professional.md`.

> ⚠️ **Defensive scope.** We describe *classes* of attack and the *mechanisms* of defenses. No gadget chains, payloads, or step-by-step exploit construction appear here.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Gadget** | A short sequence of existing instructions ending in a `ret` (ROP), `jmp` (JOP), or `call` (COP). The building block of code reuse. |
| **ROP (Return-Oriented Programming)** | Chaining gadgets that each end in `ret`, driven by a stack full of attacker-placed addresses. |
| **JOP (Jump-Oriented Programming)** | Code reuse using gadgets ending in indirect `jmp`, coordinated by a "dispatcher" instead of `ret`. |
| **COP (Call-Oriented Programming)** | Code reuse using gadgets ending in indirect `call`. |
| **Gadget chain** | The ordered list of addresses (and data) the attacker places to drive a ROP/JOP/COP attack. |
| **Forward edge** | Indirect calls/jumps *into* a function: function pointers and virtual (vtable) calls. |
| **Backward edge** | Returns *out of* a function. |
| **CFI (Control-Flow Integrity)** | Enforcing that indirect branches reach only legitimate targets. |
| **Coarse-grained CFI** | CFI with a loose policy (e.g., "any function entry," "any address after a `call`"). Cheap, but bypassable. |
| **Fine-grained CFI** | CFI with tight, per-call-site target sets derived from program structure/types. |
| **Target set** | The set of addresses a given indirect branch is allowed to reach. |
| **LLVM CFI** | Clang/LLVM's compiler-based CFI; uses **type signatures** to compute target sets for indirect calls and vtable dispatch. |
| **CFG (Control Flow Guard)** | Microsoft's forward-edge CFI: a bitmap of valid call targets, checked before each indirect call. |
| **XFG (eXtended Flow Guard)** | Microsoft's finer-grained successor to CFG, adding type-hash checks to the target check. |
| **vtable** | C++ table of virtual function pointers; a prime forward-edge target via *vtable hijacking*. |
| **GOT / PLT** | Global Offset Table / Procedure Linkage Table — dynamic-linking structures of function pointers; classic corruption targets. |
| **RELRO** | "RELocation Read-Only" — makes the GOT (and other relocations) read-only after startup, hardening it against overwrite. |

---

## Core Concepts

### 1. The Gadget: Why "Ending in `ret`" Is the Whole Trick

NX guarantees the attacker can only jump to *existing executable code*. ROP turns that constraint into a feature. Scattered through any large binary are millions of short instruction sequences that happen to **end in a `ret`**. A few examples of the *kinds* of useful sequences (described, not weaponized):

```text
gadget A:  pop rdi ; ret        -> loads a value from the stack into rdi, then "returns"
gadget B:  pop rsi ; ret        -> loads a value into rsi, then "returns"
gadget C:  mov [rax], rbx ; ret -> stores rbx into memory at rax, then "returns"
```

Each gadget is two or three instructions and then `ret`. Here's the key insight: **`ret` pops the next address off the stack and jumps to it.** So if the attacker controls the stack (which they do — that's the original overflow), they can lay out a *list of gadget addresses*. Gadget A runs, hits `ret`, which jumps to gadget B, which hits `ret`, which jumps to gadget C... The stack becomes a *program*, and the gadgets are its instructions.

### 2. The Chain: A Stack-Driven Program

A ROP "chain" is just the attacker's stack layout:

```text
   stack (attacker-controlled after overflow)
   +------------------+
   | addr of gadget A |  -> initial ret lands here: pop rdi; ret
   +------------------+
   | value for rdi    |  <- gadget A pops this
   +------------------+
   | addr of gadget B |  -> next ret lands here: pop rsi; ret
   +------------------+
   | value for rsi    |  <- gadget B pops this
   +------------------+
   | addr of gadget C |  -> ... and so on
   +------------------+
```

With enough gadgets, the attacker can perform *arbitrary computation* — set registers, write memory, call functions — without ever supplying a single byte of executable code. NX is fully satisfied: every address is in legitimate executable memory. This is why **NX alone is not enough**, and why the security community needed something that checks *which existing code* a branch may reach.

### 3. JOP and COP: When You Run Out of `ret`s

If a defense specifically watches returns (shadow stacks do this — see `senior.md`), attackers can pivot to gadgets ending in indirect `jmp` (**JOP**) or indirect `call` (**COP**). These don't use the stack's `ret` mechanism; instead a **dispatcher gadget** acts like a little interpreter, advancing through a table of gadget addresses. The takeaway: **protecting only the backward edge isn't enough**, because JOP/COP attack the *forward* edge. You need defenses on both edges. This bidirectional pressure is exactly why modern systems pair shadow stacks (backward) with forward-edge CFI.

### 4. vtable Hijacking: The Forward Edge in C++

The most common real-world forward-edge target is the **C++ vtable**. A virtual call looks like:

```text
object -> [ vtable pointer ] -> [ method0, method1, method2, ... ]
call: load vtable pointer from object, load method from vtable, call it
```

If an attacker corrupts the **vtable pointer** in an object (via a heap overflow or use-after-free), they can point it at a fake table full of attacker-chosen addresses. The next virtual call jumps wherever they want. Crucially, the vtable pointer lives in *data* (the object on the heap), so a data-corruption bug becomes a control-flow hijack. Microsoft's early **vtguard** and modern forward-edge CFI both exist largely to stop this.

### 5. Coarse vs Fine-Grained CFI — and Why Coarse Fell

The first wave of practical CFI was **coarse-grained**: cheap, approximate policies like:

- "An indirect call may only target a *function entry point*."
- "A `ret` may only land *just after some `call` instruction*."

These cut the attack surface, but researchers showed they were **bypassable**: there are *so many* legal function entries and call-preceded addresses in a real binary that you can still assemble a useful gadget chain entirely from "allowed" targets. The defense allowed too much. The lesson reshaped the field:

> **Coarse CFI restricts the *kind* of target; fine-grained CFI restricts the *specific set* of targets per call site.** Only the latter meaningfully shrinks the gadget space.

Modern CFI (LLVM CFI, XFG) is fine-grained: each call site gets a *small, type-derived* set of legal targets, not "any function."

### 6. Forward-Edge CFI Mechanism 1: LLVM CFI (Type-Based Sets)

Clang/LLVM's CFI (`-fsanitize=cfi`) is **compiler-based** and uses **type signatures**. The compiler knows the type of every function pointer and the type of every function. For an indirect call through a `int (*)(char*)` pointer, the legal targets are *only functions whose type matches* `int(char*)`. The compiler:

1. Groups functions by type signature into sets.
2. Lays them out so a fast range/bitmask check can answer "is this target in the set?"
3. Inserts that check before each indirect call (and before each vtable dispatch — `-fsanitize=cfi-vcall`).

If the target isn't in the type set, the program traps. This is far tighter than "any function entry" — typically a handful of targets per site. Its **precision limit**: all functions sharing a type are mutually substitutable, so if many functions share a signature (very common with `void(void)` or `void*(void*)`), the set is still larger than the *one* legitimate target. Type-based CFI shrinks but does not eliminate the gadget space.

### 7. Forward-Edge CFI Mechanism 2: Microsoft CFG and XFG

Windows uses a different design. **Control Flow Guard (CFG)** is supported by the compiler *and the OS loader*:

- The compiler emits, for each module, a **bitmap of valid indirect-call targets** (every legitimate function entry).
- Before each indirect call, the compiler inserts a call to a guard check that consults the bitmap: "is this address a valid call target?"
- The OS maintains the bitmap and the check function.

CFG is *coarser* than LLVM CFI — its set is essentially "any address marked as a valid function start," not a per-type set — which is why it was shown bypassable in practice. **XFG (eXtended Flow Guard)** tightens it by adding a **type hash**: each valid target is tagged with a hash of its function prototype, and the check verifies *both* "valid target" *and* "matching type hash." That moves Windows toward LLVM-CFI-style fine granularity.

### 8. Related Hardening: RELRO and the GOT/PLT

A program's indirect calls into shared libraries route through the **GOT** (Global Offset Table) and **PLT**. The GOT is a table of function pointers the dynamic linker fills in. Historically, overwriting a GOT entry was a clean way to hijack a call. **RELRO** ("RELocation Read-Only") hardens this:

- **Partial RELRO** reorders sections so the GOT is less exposed.
- **Full RELRO** resolves all symbols at startup and then marks the GOT **read-only**, so an overflow can't rewrite those pointers.

RELRO isn't CFI per se, but it removes a major forward-edge corruption target, and you'll always see it discussed alongside CFI in hardening checklists.

---

## Real-World Analogies

**ROP as a ransom note cut from a magazine.** A kidnapper who can't write their own note (NX: no new code) cuts individual words out of existing magazines and pastes them in order to spell a new message. Each word is a "gadget"; the pasted sequence is the "chain." The magazine (the program's own code) supplied every word; the attacker only supplied the *arrangement*.

**Coarse CFI as "you may only enter through a door."** A building with a rule "intruders may only enter through *a* door" sounds safe — until you notice it has 500 doors. There are so many legal doors that you can still walk a useful path. Fine-grained CFI is "this hallway connects only to *these three* specific doors," which actually constrains movement.

**Type-based target sets as job titles.** LLVM CFI says: "this call slot can only be filled by someone with the job title `int(char*)`." That's much better than "any employee." But if a thousand people share that title, the slot is still loosely guarded — the precision limit of type-based CFI.

**RELRO as drying the cement.** When a building is constructed, the dynamic linker pours the "cement" of the GOT (filling in addresses). RELRO lets it *dry* — once set at startup, it's read-only and can't be re-poured by an attacker mid-run.

---

## Mental Models

**Model 1: The stack is a program; the gadgets are its opcodes.** Once you see a ROP chain as "the overflowed stack *is* the attacker's bytecode, interpreted by `ret`," you understand why NX is helpless and why protecting the backward edge (shadow stacks) and forward edge (CFI) are *both* necessary.

**Model 2: CFI quality = how small is the target set.** Every forward-edge CFI scheme answers "where may this indirect branch go?" The *security value* is inversely proportional to the size of that set. "Any function entry" (coarse) ≈ weak. "Functions of this exact type" (LLVM CFI) ≈ strong. "This one function" (ideal, rarely achievable) ≈ strongest.

**Model 3: Two edges, two defenses, both required.** Forward edge → LLVM CFI / CFG / XFG. Backward edge → canaries (weak) and shadow stacks (strong, `senior.md`). Defending one edge just pushes attackers to the other (ROP↔JOP/COP).

**Model 4: Hardening is a checklist, not a switch.** NX + canary + PIE/ASLR + Full RELRO + forward-edge CFI + shadow stack together raise the cost dramatically. Each closes a specific door; the attacker needs to defeat the *combination*.

---

## Code Examples

> Defensive/illustrative only. We show how to *enable and reason about* defenses, and the *shape* of vulnerable patterns — never working exploits.

### 1. Enabling LLVM CFI (Clang)

```bash
# Forward-edge CFI: indirect-call and vtable checks.
# Requires LTO (whole-program visibility to compute type sets).
$ clang++ -flto -fvisibility=hidden \
          -fsanitize=cfi \
          app.cpp -o app

# Narrow to specific schemes if needed:
#   -fsanitize=cfi-icall   (indirect function-pointer calls)
#   -fsanitize=cfi-vcall   (C++ virtual calls / vtable integrity)
#   -fsanitize=cfi-nvcall  (non-virtual member calls)

# Diagnose violations instead of trapping (development only):
$ clang++ -flto -fsanitize=cfi -fno-sanitize-trap=cfi \
          -fsanitize-recover=cfi app.cpp -o app
```

Why `-flto`? Type-based CFI needs to see *all* functions of a given type across the whole program to build the target set. Without whole-program visibility, the sets would be incomplete and either over-restrictive (false traps) or unsound.

### 2. The pattern CFI protects: an indirect call

```c
typedef int (*handler_t)(const char *);

struct request {
    handler_t handler;   // a function pointer stored in data
    char payload[256];   // ... right next to a buffer (BUG bait)
};

void dispatch(struct request *r, const char *msg) {
    // If a bug let an attacker overwrite r->handler, this indirect
    // call would jump wherever they chose. CFI checks, before the
    // call, that r->handler is a function of type int(const char*).
    r->handler(msg);
}
```

With `-fsanitize=cfi-icall`, the compiler inserts: *"is `r->handler` in the set of `int(const char*)` functions? If not, trap."* The attacker can still corrupt the pointer, but they can only redirect to a *type-matching* function — a drastically smaller set than "anywhere."

### 3. vtable integrity (C++)

```cpp
struct Codec {
    virtual int decode(const char *in) = 0;
    virtual ~Codec() = default;
};

void run(Codec *c, const char *in) {
    // Virtual dispatch reads c's vtable pointer (in heap data) and
    // calls through it. If a use-after-free or heap overflow swapped
    // the vtable pointer, this would be a hijack.
    // -fsanitize=cfi-vcall verifies the vtable belongs to a class
    // in Codec's hierarchy before dispatching.
    int n = c->decode(in);
    (void)n;
}
```

### 4. Enabling Microsoft CFG / XFG (MSVC)

```text
# CFG: compiler emits the valid-target bitmap; loader enforces it.
cl /guard:cf app.cpp /link /guard:cf

# XFG (newer toolchains): adds type-hash checks on top of CFG.
cl /guard:xfg app.cpp /link /guard:xfg
```

### 5. Verifying mitigations are present

```bash
# Linux: confirm NX, canary, PIE, and Full RELRO.
$ checksec --file=./app
RELRO      STACK CANARY  NX     PIE  ...
Full RELRO   Canary found  NX enabled  PIE enabled
```

```text
# Windows: dumpbin shows whether CFG is on.
dumpbin /headers /loadconfig app.exe   # look for "Guard CF" flags
```

---

## Pros & Cons

**ROP/JOP/COP (the threat)** — not a defense; listed so you weigh defenses against it.

| Attacker advantage | Attacker limit |
|--------------------|----------------|
| Defeats NX entirely (reuses legitimate code). | Needs a memory bug *and* knowledge of code addresses (ASLR raises the bar). |
| Turing-complete with enough gadgets. | Fine-grained CFI + shadow stacks shrink/close usable gadgets. |

**LLVM CFI (forward edge)**

| Pros | Cons |
|------|------|
| Fine-grained, type-based sets — small target sets. | Requires LTO and whole-program visibility; awkward across shared-library boundaries. |
| Strong vtable integrity for C++. | Functions sharing a type stay mutually reachable (precision limit). |
| Low runtime overhead (a bitmask/range check). | Doesn't protect the backward edge or stop data-only attacks. |

**Microsoft CFG / XFG**

| Pros | Cons |
|------|------|
| OS-supported, broadly deployed on Windows. | Plain CFG is coarse (any valid entry) and was shown bypassable. |
| XFG adds type hashes → much finer. | Still forward-edge only; needs the loader's cooperation. |

**RELRO**

| Pros | Cons |
|------|------|
| Removes GOT overwrite as a hijack path. | Full RELRO resolves all symbols at startup (slower launch); not CFI by itself. |

---

## Use Cases

- **C++ codebases with heavy virtual dispatch** (browsers, game engines, GUI toolkits) — `cfi-vcall` directly targets vtable hijacking.
- **Plugin/handler architectures** that store function pointers in data structures — `cfi-icall` constrains them.
- **Windows applications and drivers** — CFG/XFG is the platform-native forward-edge defense.
- **Security-critical daemons** parsing untrusted input — pair forward-edge CFI with Full RELRO, PIE/ASLR, and (from `senior.md`) shadow stacks.

---

## Coding Patterns

**Pattern: Minimize and type-narrow your function pointers.** Distinct, specific signatures yield smaller CFI target sets than a sea of `void(void)` callbacks.

```c
// Weaker for CFI: everything is the same type.
typedef void (*generic_cb)(void *);

// Stronger: specific types create smaller, distinct target sets.
typedef int  (*parse_cb)(const struct packet *);
typedef void (*log_cb)(int level, const char *msg);
```

**Pattern: Don't store hot function pointers next to attacker-reachable buffers.** Layout matters; a function pointer adjacent to an input buffer is a corruption magnet.

**Pattern: Build with LTO when using LLVM CFI.** Without it, sets are incomplete.

**Pattern: Keep Full RELRO and PIE on.** They're free defense-in-depth that close adjacent doors (GOT overwrite, fixed addresses).

---

## Best Practices

1. **Enable forward-edge CFI on C/C++ that handles untrusted input** (`-fsanitize=cfi` with LTO on Clang; `/guard:xfg` on MSVC).
2. **Prefer XFG over plain CFG** where your toolchain supports it — type hashes close coarse-CFI bypasses.
3. **Use Full RELRO and PIE/ASLR** so forward-edge CFI isn't undermined by GOT overwrites or known addresses.
4. **Type your function pointers precisely** — vague signatures inflate CFI target sets.
5. **Test under `-fno-sanitize-trap=cfi` first** to find legitimate type mismatches (common with casts/`dlsym`) before shipping the trapping build.
6. **Remember CFI is forward-edge only here** — you still need shadow-stack/backward-edge protection (`senior.md`).

---

## Edge Cases & Pitfalls

- **Casting function pointers breaks type-based CFI.** Calling a function through a mismatched-type pointer (even a "harmless" cast) trips `cfi-icall`. Often this surfaces real type confusion; sometimes it's legacy code that needs a clean signature.
- **`dlsym`/`GetProcAddress` and JIT'd code** produce pointers the compiler never saw, so they're outside the type sets. They need explicit handling (e.g., `no_sanitize` annotations, or CFI-aware JIT support).
- **Shared-library boundaries weaken LLVM CFI.** Type sets are computed per LTO unit; calls crossing into a separately built `.so` may not be fully checked.
- **Plain CFG ≈ coarse CFI.** Treating "CFG enabled" as strong is a mistake; without XFG it allows any valid function entry.
- **Forward-edge CFI does nothing for returns.** JOP/COP and return-address attacks route around it; you need shadow stacks too.

---

## Common Mistakes

- Enabling `-fsanitize=cfi` without `-flto` and getting incomplete (or noisy) protection.
- Treating CFG as equivalent to fine-grained CFI.
- Using a single `void(void)` callback type everywhere, collapsing all target sets into one big set.
- Forgetting RELRO/PIE, leaving GOT overwrite and fixed addresses as easy paths around CFI.
- Assuming forward-edge CFI also covers the backward edge.

---

## Tricky Points

- **A ROP chain supplies no code — only addresses.** That's why NX, which only forbids new code, can't stop it.
- **Coarse CFI fails not because the check is wrong but because the *set is too big*.** Security scales with set tightness.
- **Type-based CFI's blind spot is type aliasing.** Many functions with the same signature ⇒ they're mutually substitutable under CFI.
- **Defending the backward edge pushes attackers to the forward edge and vice versa.** This is why both shadow stacks and forward-edge CFI ship together.
- **vtable hijacking is a *data* bug with a *control-flow* consequence** — corrupt the vtable pointer (data), hijack a virtual call (control).

---

## Test Yourself

1. Explain how a stack full of addresses, plus gadgets ending in `ret`, performs computation without injecting code.
2. Why does NX fail to stop ROP, but DEP-bypass and code reuse still require a memory bug?
3. What is the difference between coarse- and fine-grained CFI, and *why* was coarse CFI bypassed?
4. How does **LLVM CFI** decide whether an indirect call is allowed? What's its precision limit?
5. How does Microsoft **CFG** decide, and what does **XFG** add?
6. What is **vtable hijacking**, and which CFI scheme (`cfi-vcall`) targets it?
7. Why does forward-edge CFI need to be paired with backward-edge protection?
8. What does **Full RELRO** protect, and why is it discussed alongside CFI?

> If you can answer 3–6 cleanly, you understand forward-edge CFI well enough to move to `senior.md` (shadow stacks and hardware: CET, PAC, BTI).

---

## Cheat Sheet

| Concept | One-liner |
|---------|-----------|
| **Gadget** | Short existing instruction run ending in `ret`/`jmp`/`call`. |
| **ROP** | Chain `ret`-ending gadgets via a corrupted stack — defeats NX. |
| **JOP / COP** | Same idea via indirect `jmp` / `call`; attack the forward edge. |
| **Forward edge** | Indirect calls (function pointers, vtables). |
| **Coarse CFI** | Loose policy ("any entry") — bypassable. |
| **Fine-grained CFI** | Small, type-derived per-site target set. |
| **LLVM CFI** | Type-signature target sets; needs LTO; `cfi-icall`/`cfi-vcall`. |
| **CFG** | MS bitmap of valid call targets (coarse). |
| **XFG** | CFG + per-target type hash (fine). |
| **RELRO** | Make GOT read-only after startup; blocks GOT overwrite. |
| **Golden rule** | CFI value ∝ smallness of the target set; protect both edges. |

---

## Summary

Once NX killed injected shellcode, attackers turned the program's own bytes into a weapon: **ROP** chains tiny existing **gadgets** (each ending in `ret`) driven by a corrupted stack, achieving arbitrary computation without supplying any code — which is exactly why NX alone is insufficient. **JOP/COP** extend this to indirect jumps and calls, attacking the **forward edge**, and **vtable hijacking** turns a heap data bug into a forward-edge control hijack. The defensive answer is **forward-edge CFI**, which restricts indirect calls to a **target set**. The crucial design axis is **coarse vs fine-grained**: coarse CFI ("any function entry") was bypassed because its set is huge, while fine-grained schemes shrink it — **LLVM CFI** uses **function-type signatures** (with the precision limit that same-typed functions stay mutually reachable), **Microsoft CFG** uses a valid-target bitmap (coarse), and **XFG** tightens CFG with type hashes. Pair all of this with **Full RELRO** (read-only GOT) and PIE/ASLR, and remember the forward edge is only half the story — `senior.md` covers the backward edge with shadow stacks and hardware.

---

## Further Reading

- Abadi et al., "Control-Flow Integrity" — the original CFI paper that named the field.
- Clang documentation: "Control Flow Integrity" (`-fsanitize=cfi`, the `cfi-*` schemes, LTO requirement).
- Microsoft documentation on Control Flow Guard (`/guard:cf`) and XFG.
- Research on coarse-CFI bypasses (e.g., "Out of Control," "Stitching the Gadgets") — read for *why* coarse CFI failed.
- Continue to `senior.md` for shadow stacks, Intel CET, ARM PAC, and BTI.
