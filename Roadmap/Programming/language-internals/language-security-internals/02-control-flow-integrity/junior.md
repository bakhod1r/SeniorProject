# Control-Flow Integrity — Junior Level

> **Topic:** [Control-Flow Integrity](README.md)
> **Focus:** What "control flow" is, how a memory bug lets an attacker steal it, and the first wave of defenses (NX/DEP, stack canaries) that make stealing it harder.

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

> Focus: **What is "control flow," and what does it mean for an attacker to hijack it?**

Every program is a sequence of decisions about *what to run next*. Run this instruction, then the next, then jump into a function, then return from it. That ordering — the path the CPU walks through your code — is the program's **control flow**. **Control-Flow Integrity (CFI)** is the family of defenses that make sure the CPU only ever follows paths the *programmer* intended, even when the program has a memory bug an attacker is trying to exploit.

Here is the one-sentence version of the whole problem. In a language like C or C++, the addresses the CPU jumps to — the *return address* of a function, the *target* of a function-pointer call — live in ordinary memory, right next to ordinary data like buffers and arrays. If an attacker can corrupt that data (by overflowing a buffer, for example), they can also corrupt the *jump targets*. And once you control where the CPU jumps next, you control the program.

CFI is the answer to: **"A memory bug let the attacker overwrite an address. How do we stop them from turning that into 'run my code'?"**

> 🎓 **Why this matters for a junior:** You will spend most of your early career writing memory-safe code (Python, Go, Java, Rust, JavaScript) where these attacks mostly don't apply. But the systems *under* you — the OS kernel, the language runtime, the browser engine, `libc` — are written in C and C++, and they are the real targets. Understanding *why* your OS has features called "DEP," "stack canaries," and "CET" tells you what classes of bug are catastrophic and which are merely annoying. This is also the bedrock vocabulary for every security conversation you will ever have.

This page covers: what control flow is, the historical attack (a stack buffer overflow rewriting a return address), the first defense (NX/DEP, which made injected code non-runnable), the attacker's response (reusing code that's *already* runnable — return-to-libc), and the first cheap guard you'll see everywhere (the **stack canary**). The next levels go deeper: `middle.md` covers ROP and forward-edge CFI, `senior.md` covers shadow stacks and hardware (CET, PAC, BTI), and `professional.md` covers the cat-and-mouse of CFI bypasses and deployment.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a function call is, and the vague idea that calling a function "remembers where to come back to."
- **Required:** What a pointer is — a variable that holds a memory address.
- **Required:** What an array or buffer is, and that writing past its end is a bug.
- **Helpful but not required:** Any exposure to C or C++ — `char buf[64]`, `strcpy`, that kind of thing.
- **Helpful but not required:** A rough mental picture that programs have memory split into *stack*, *heap*, and *code*.

You do **not** need to know:

- Assembly language (we'll show tiny snippets and explain every line).
- How the CPU pipelines or caches instructions.
- The exact byte layout of a stack frame (that's `middle.md`).
- Anything about ROP gadget hunting, shadow stacks, or pointer authentication — those are later levels.

> ⚠️ **A note on ethics and scope.** Everything here is **defensive and conceptual**. We explain *mechanisms* and *classes* of attack so you can reason about defenses. We do not show working exploits, payloads, or step-by-step instructions to compromise anything. The goal is to make you a better defender, not to hand anyone a weapon.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Control flow** | The order in which a program's instructions execute — including jumps, calls, and returns. |
| **Indirect branch** | A jump or call whose target is read from memory or a register at runtime, not fixed in the instruction. Returns, function-pointer calls, and virtual calls are all indirect. |
| **Return address** | The address the CPU jumps back to when a function finishes. Stored on the stack. The classic hijack target. |
| **Stack** | The region of memory holding local variables, function arguments, and return addresses. Grows and shrinks as functions call and return. |
| **Buffer overflow** | Writing more data into a buffer than it can hold, corrupting whatever sits next to it in memory. |
| **Stack smashing** | A buffer overflow on the stack that overwrites the return address. |
| **Shellcode** | Attacker-supplied machine code injected into the process, historically aiming to spawn a shell. |
| **NX / DEP / W^X** | "No-eXecute" / "Data Execution Prevention" / "Write XOR eXecute." A rule: a memory page may be writable *or* executable, never both. Stops injected data from running as code. |
| **Code reuse** | Instead of injecting new code, the attacker jumps into code *already present* (and already executable) in the program. Defeats NX. |
| **Return-to-libc** | A code-reuse attack that redirects a return into an existing library function (like `system`). |
| **Stack canary / cookie** | A secret value placed just before the return address. If an overflow corrupts the return address, it also corrupts the canary; the program checks the canary before returning and aborts if it changed. |
| **CFI (Control-Flow Integrity)** | The umbrella term for defenses that restrict indirect branches to legitimate targets. |
| **Forward edge** | An indirect call or jump *into* a function (function pointers, virtual calls). |
| **Backward edge** | A return *out of* a function (the return address). |
| **Undefined behavior (UB)** | In C/C++, behavior the standard does not define — like writing past a buffer. The compiler may do anything, and attackers exploit it. |

---

## Core Concepts

### 1. What "Control Flow" Actually Is

Think of your program as a recipe. Most steps are "do this, then the next line." But some steps say "go do *that* whole sub-procedure and come back," or "depending on a value, jump to one of several places." Those branching steps are where control flow gets interesting — and where attackers live.

Branches come in two flavors:

- **Direct branches** have their destination baked into the instruction itself: `jump to address 0x4011a0`. The attacker can't change these without rewriting the program's code (which NX/DEP forbids). These are safe.
- **Indirect branches** read their destination *from memory or a register at runtime*. Three kinds matter:
  - **Returns** — "go back to wherever I was called from." The destination is the **return address**, stored on the stack.
  - **Function-pointer calls** — `callback()` where `callback` is a variable holding an address.
  - **Virtual calls** — in C++, calling a method through a base-class pointer looks up the real function in a table (the *vtable*) at runtime.

CFI is entirely about indirect branches. Direct branches are fixed; indirect branches read a target from data, and **data can be corrupted**.

### 2. The Original Sin: The Return Address Lives in Writable Memory

When function `A` calls function `B`, the CPU has to remember where to resume in `A` once `B` finishes. On most architectures it pushes the **return address** onto the **stack**. So the stack ends up holding, mixed together:

```text
   higher addresses
   +--------------------+
   | return address     |   <- where we jump back to when B returns
   +--------------------+
   | saved registers    |
   +--------------------+
   | local buffer[64]   |   <- our data, e.g. a 64-byte array
   +--------------------+
   lower addresses
```

The buffer (data we might write into) and the return address (a jump target) sit in the **same writable region**, often only a few bytes apart. That adjacency is the whole problem.

### 3. Stack Smashing: Turning a Buffer Bug Into a Hijack

Suppose `B` copies attacker-controlled input into `buffer[64]` *without checking the length* (the classic `strcpy(buffer, input)` bug). If the input is longer than 64 bytes, the write keeps going — past the end of the buffer, over the saved registers, and right onto the **return address**.

Now when `B` finishes and does its `ret`, the CPU reads the (corrupted) return address and jumps to wherever the attacker put. Historically, the attacker would put the address of code they had *also* placed in the buffer — their **shellcode**. Result: the attacker's code runs with the program's privileges.

This single technique — overflow a stack buffer, overwrite the return address, jump to injected shellcode — was the dominant remote-exploitation pattern for over a decade. Every defense on this page exists to break some link in that chain.

### 4. First Defense — NX / DEP / W^X: "Data Can't Run"

The injected-shellcode attack has an obvious weak point: the shellcode is sitting in a *data* buffer (the stack), but the CPU is being asked to *execute* it. What if we forbid that?

**NX** (No-eXecute), marketed as **DEP** on Windows and generalized as **W^X** ("write XOR execute"), is a hardware-backed rule enforced by the CPU and OS: every page of memory is either **writable** or **executable**, **never both at once**. Code pages are executable but read-only. Data pages (stack, heap) are writable but non-executable.

With NX on, the attacker can still corrupt the return address — but if they point it at their shellcode on the (non-executable) stack, the CPU refuses and the process crashes. **Injected-code attacks are dead.** This was a huge win, deployed broadly in the mid-2000s.

### 5. The Attacker's Answer: Reuse Code That's Already Allowed to Run

NX stops you from running *new* code. It does nothing to stop you from running *existing* code in a new order. The program is full of executable code — your functions, and crucially the entire C library (`libc`) linked in, with powerful functions like `system("...")`.

The simplest version is **return-to-libc**: instead of pointing the corrupted return address at injected shellcode, point it at an *existing* function like `system`, and arrange the stack so that function's argument is a string the attacker controls (like `"/bin/sh"`). NX is satisfied — `system` is legitimate, executable code — yet the attacker still gets what they want. (`middle.md` shows how this generalizes into the far more powerful *return-oriented programming*.)

The lesson: **NX raised the bar but didn't end the game.** It turned "inject and run my code" into "reuse the program's own code against it." That shift is *why CFI exists* — CFI is about controlling *which existing code* an indirect branch is allowed to reach.

### 6. The Cheap, Ubiquitous Guard: Stack Canaries

While the big defenses (CFI, shadow stacks) were being designed, compilers shipped a cheap, effective guard against the *specific* attack of stack smashing: the **stack canary** (also called a **stack cookie**, from StackGuard and Microsoft's `/GS` flag).

The idea is a tripwire. When a function starts, the compiler inserts code that places a secret random value — the **canary** — on the stack *between the local buffers and the return address*:

```text
   +--------------------+
   | return address     |
   +--------------------+
   | CANARY (secret)    |   <- tripwire
   +--------------------+
   | buffer[64]         |
   +--------------------+
```

Because the buffer overflow writes *upward* through memory, an overflow large enough to reach the return address **must pass through the canary first**, corrupting it. Just before the function returns, the compiler inserts a check: "is the canary still the value I stored?" If not, the program calls `__stack_chk_fail` and aborts immediately — *before* the corrupted return address is ever used.

What canaries catch and miss is the start of every real security discussion:

- **Catch:** contiguous stack buffer overflows that smash the return address. (The original attack.)
- **Miss:** overflows that *don't* cross the canary — e.g., a write to a function pointer *before* the canary, or an overflow that overwrites a local variable used as a target. Also miss: attacks that *read* the canary first (an info leak) and then write the correct value back. And miss: heap overflows, use-after-free, type confusion — none of those touch the stack canary at all.

Canaries are a great example of the recurring CFI theme: a cheap, targeted defense that closes one door, after which attackers walk through the others.

---

## Real-World Analogies

**The return address as a "return-to" sticky note.** Imagine you're reading a book, get interrupted by a phone call, and stick a Post-it on the page so you know where to resume. The phone call is a function call; the Post-it is the return address. Now imagine a prankster can reach over and rewrite your Post-it while you're on the phone. When you hang up, you "return" to the *wrong page* — the page they chose. Stack smashing is rewriting that Post-it.

**NX/DEP as "the kitchen and the dining room."** In a restaurant, the kitchen is where food is *made* (writable) and the dining room is where it's *served* (executable). NX says: you can cook in the kitchen or eat in the dining room, but you can't cook a meal and eat it in the same spot. Attacker-supplied data lands in the "kitchen" (writable stack) and can never be "served" (executed).

**Return-to-libc as ordering off the existing menu.** NX stopped you from sneaking in your own dish. So instead, you place a clever order using only items *already on the menu* — combine the "knife," the "open door," and the "cash drawer" the restaurant already provides. You didn't bring anything in; you misused what was there. That's code reuse.

**The stack canary as a wax seal on a letter.** A medieval letter was sealed with wax stamped with a secret crest. If the seal was broken or the crest was wrong, you knew it had been tampered with *before* you trusted the contents. The canary is that seal sitting in front of the return address: tampered seal → don't trust the return → abort.

**CFI itself as a guest list at the door.** A bouncer with a guest list lets people in only if they're on the list. An indirect call is a doorway; CFI is the bouncer checking that the place you're about to jump to is on the list of *legitimate* targets for that doorway. Forward-edge CFI is the door bouncer; the shadow stack (later) is the coat-check ticket that proves you're leaving the way you came in.

---

## Mental Models

**Model 1: Control flow is data, and data can be corrupted.** The single most important idea on this page. Return addresses and function pointers are *just bytes in memory*. The CPU trusts them blindly. Any bug that lets an attacker write those bytes lets them redirect the program. CFI's job is to add a *check* between "read the target from memory" and "jump to it."

**Model 2: Two edges, two problems.** Every defense targets either the **backward edge** (returns — protected by canaries and shadow stacks) or the **forward edge** (function-pointer and virtual calls — protected by forward-edge CFI like CFG and LLVM CFI). When you read about a defense, your first question should be: *backward edge or forward edge?*

**Model 3: The arms race ladder.** Inject shellcode → NX kills it → reuse existing code (return-to-libc, ROP) → CFI/shadow stacks restrict reuse → attackers find data-only attacks. Each rung is a defense that closed the previous attack, prompting the next attack. CFI is a rung, not the end of the ladder.

**Model 4: Defense in depth, not a silver bullet.** No single feature here stops everything. Canaries miss heap bugs; NX misses code reuse; CFI misses data-only attacks. Real systems stack *all* of them so an attacker has to defeat several at once. "What does this miss?" is always the right follow-up question.

---

## Code Examples

> These examples illustrate *mechanisms* defensively. The "vulnerable" snippets exist only to show *why* a defense is needed; none is a working exploit.

### 1. The shape of the vulnerable code (C)

```c
#include <string.h>
#include <stdio.h>

void greet(const char *name) {
    char buffer[64];
    // BUG: no length check. If `name` is longer than 64 bytes,
    // strcpy keeps writing past `buffer`, eventually over the
    // saved return address sitting higher on the stack.
    strcpy(buffer, name);
    printf("Hello, %s\n", buffer);
}                       // <- `ret` here reads the (maybe corrupted) return address

int main(int argc, char **argv) {
    greet(argv[1]);     // attacker controls argv[1]
    return 0;
}
```

The fix is to bound the copy. This is the most fundamental defense: don't overflow in the first place.

```c
void greet_safe(const char *name) {
    char buffer[64];
    snprintf(buffer, sizeof buffer, "%s", name);  // bounded; never overflows
    printf("Hello, %s\n", buffer);
}
```

### 2. Seeing NX / W^X in action (conceptual)

You don't write NX in C; the OS and compiler set it on memory regions. The stack is marked non-executable automatically. You can *observe* the protections on a binary:

```bash
# On Linux, inspect security mitigations baked into a binary.
# (checksec is a small helper script; many distros package it.)
$ checksec --file=./myprogram
RELRO     STACK CANARY  NX     PIE
Full RELRO  Canary found  NX enabled  PIE enabled
```

- **NX enabled** → the stack/heap are non-executable; injected shellcode won't run.
- **Canary found** → the compiler inserted stack-cookie checks.
- **PIE** → the program loads at a randomized base (works with ASLR to hide addresses).
- **Full RELRO** → certain tables are made read-only after startup (more in `middle.md`).

### 3. Turning the stack canary on/off (compiler flags)

The canary is a *compiler* feature. With GCC/Clang:

```bash
# Canaries on (this is the default on most modern toolchains):
$ gcc -fstack-protector-strong greet.c -o greet

# Canaries fully off (do NOT do this in production — shown to explain the flag):
$ gcc -fno-stack-protector greet.c -o greet
```

What the compiler *generates* for a protected function, in plain English:

```text
function prologue:
    load secret canary from a per-thread location
    store canary onto the stack, just below the return address

... function body runs (maybe overflows a buffer) ...

function epilogue (before ret):
    reload the secret canary
    compare it to the value still on the stack
    if they differ -> call __stack_chk_fail (abort the program)
    otherwise -> ret normally
```

### 4. A memory-safe language sidesteps the whole class

The reason this whole topic is "systems-level" is that memory-safe languages don't expose raw return-address corruption to ordinary code:

```go
// Go: writing past a slice's length panics with a bounds check.
// There is no path from this bug to "overwrite the return address."
func greet(name string) {
    buf := make([]byte, 64)
    copy(buf, name) // copy never writes past len(buf); it truncates safely
    fmt.Printf("Hello, %s\n", buf)
}
```

```rust
// Rust: an out-of-bounds index panics; the borrow checker and bounds
// checks prevent the classic stack-smash from being reachable in safe code.
fn greet(name: &str) {
    let mut buf = [0u8; 64];
    let n = name.len().min(buf.len());
    buf[..n].copy_from_slice(&name.as_bytes()[..n]); // bounded
}
```

The takeaway for a junior: **most CFI relevance is for C/C++ code.** When you can choose a memory-safe language for new code, you remove the *reason* CFI exists. CFI is the safety net for the code that *must* be C/C++.

---

## Pros & Cons

**Stack canaries**

| Pros | Cons |
|------|------|
| Extremely cheap (a load, a store, a compare per function). | Only protect the **backward edge** (return address), and only against *contiguous* stack overflows. |
| On by default; you get them for free. | Defeated by info leaks (read the canary, then write it back) and by overflows that skip past it. |
| Catch many real, accidental overflows early. | Do nothing for heap bugs, use-after-free, or forward-edge hijacks. |

**NX / DEP / W^X**

| Pros | Cons |
|------|------|
| Kills the entire class of injected-shellcode attacks. | Does nothing against code reuse (return-to-libc, ROP). |
| Hardware-enforced; near-zero runtime cost. | Breaks JITs (which legitimately write-then-execute) unless they manage permissions carefully. |
| Universally deployed. | Just one rung — necessary, not sufficient. |

**Forward-edge CFI (preview of `middle.md`)**

| Pros | Cons |
|------|------|
| Restricts function-pointer/virtual calls to legitimate targets. | Precision is limited; many valid targets can still be "in set." |
| Catches a large fraction of code-reuse hijacks. | Doesn't stop data-only attacks. Has some performance/compatibility cost. |

---

## Use Cases

- **Operating-system kernels.** The kernel is the highest-value C target; Linux, Windows, and macOS all ship multiple CFI mechanisms.
- **Browsers and language runtimes.** Chrome, Firefox, and the JVM/V8 native layers are huge C/C++ attack surfaces and lean heavily on CFI.
- **`libc` and core system libraries.** Compiled with canaries and (increasingly) hardware CFI.
- **Embedded and IoT firmware.** Often C, often network-facing, increasingly using ARM BTI/PAC (see `senior.md`).
- **Any networked C/C++ service** that parses untrusted input — the exact place buffer overflows turn into remote code execution.

---

## Coding Patterns

These are the day-one habits that *prevent the bug CFI is the backstop for*. CFI is a net; not falling is better.

**Pattern: Always bound your copies.**

```c
// Bad
strcpy(dst, src);
sprintf(dst, "%s", src);

// Good — always pass the destination size
snprintf(dst, sizeof dst, "%s", src);
strlcpy(dst, src, sizeof dst);   // where available
```

**Pattern: Validate lengths before writing.**

```c
if (input_len > sizeof buffer) {
    return ERR_TOO_LONG;        // reject, don't truncate-and-pray
}
memcpy(buffer, input, input_len);
```

**Pattern: Keep mitigations on.** Don't disable canaries, NX, PIE, or RELRO to "fix a build error." Those flags are your safety net.

**Pattern: Prefer memory-safe languages for new code.** If you're starting fresh and the domain allows it, Go/Rust/Java remove the entire attack class.

---

## Best Practices

1. **Treat all external input as hostile, especially in C/C++.** The overflow that smashes a return address starts with one unchecked length.
2. **Leave compiler mitigations enabled** (`-fstack-protector-strong`, NX, PIE, RELRO). Verify them with `checksec`.
3. **Know which edge a defense protects.** Canary → backward edge. Forward-edge CFI → forward edge. You need both.
4. **Don't treat any single mitigation as "secure."** Each one has a documented bypass class. Defense in depth.
5. **Use memory-safe languages where you can**, and isolate the C/C++ you can't avoid (sandboxing, least privilege).
6. **Keep your toolchain and libraries patched.** Mitigations improve every release; old binaries miss them.

---

## Edge Cases & Pitfalls

- **"Canary found means I'm safe."** No. The canary protects one narrow thing (contiguous stack overflow of the return address). Heap bugs, forward-edge hijacks, and info-leak-then-rewrite all walk around it.
- **"NX makes overflows harmless."** No. NX kills *injected code*. Code-reuse attacks (return-to-libc, ROP) defeat NX entirely.
- **Disabling mitigations to make a JIT work.** JITs legitimately need writable-then-executable memory; the right answer is careful permission management (W^X with explicit transitions), not turning NX off globally.
- **Stripped symbols ≠ security.** Hiding function names doesn't stop overflows; attackers don't need your symbol table.
- **"My language is memory-safe, so CFI doesn't matter."** It matters for the runtime, the interpreter, and any C extension/FFI you call. Your safety ends at the FFI boundary.

---

## Common Mistakes

- Believing a single mitigation is a complete defense.
- Using `strcpy`/`sprintf`/`gets` because "the input is trusted" — it rarely stays trusted.
- Turning off `-fstack-protector` or marking pages `RWX` to silence a warning.
- Confusing **forward edge** (calls) with **backward edge** (returns) when reasoning about what's protected.
- Assuming randomization (ASLR) alone is enough; a single address leak can undo it.

---

## Tricky Points

- **The canary catches the attack that *crosses* it, not all overflows.** An overflow that overwrites a local function pointer sitting *below* the canary never trips it.
- **NX and code reuse coexist.** The attacker obeys NX perfectly — they only ever jump to already-executable code. That's the point of code reuse.
- **A read bug can be as dangerous as a write bug.** Leaking the canary or a code address can be the key that unlocks an otherwise-blocked write exploit.
- **"Indirect" is the magic word.** Direct branches are fixed and safe. Every CFI concern is about *indirect* branches reading a target from corruptible memory.

---

## Test Yourself

1. What is the difference between a **direct** and an **indirect** branch, and why does CFI only care about the indirect kind?
2. In one sentence, how does a stack buffer overflow turn into a control-flow hijack?
3. What attack does **NX/DEP** stop, and what attack does it *fail* to stop?
4. Where does the compiler place a **stack canary**, and why does its position matter?
5. Name two situations a stack canary does **not** catch.
6. Why is **return-to-libc** considered a "code-reuse" attack, and why doesn't NX prevent it?
7. What's the difference between the **forward edge** and the **backward edge** of control flow?
8. Why is this entire topic mostly relevant to **C/C++** code and not, say, Python?

> Answers are woven through Core Concepts. If you can answer 1–5 cleanly, you're ready for `middle.md` (ROP and forward-edge CFI).

---

## Cheat Sheet

| Concept | One-liner |
|---------|-----------|
| **Control flow** | The order instructions run; CFI keeps it on intended paths. |
| **Indirect branch** | Jump/call/return whose target comes from corruptible memory. |
| **Stack smashing** | Overflow a stack buffer to overwrite the return address. |
| **NX / DEP / W^X** | Pages are writable or executable, never both. Kills injected shellcode. |
| **Return-to-libc** | Reuse existing functions (e.g. `system`) — defeats NX. |
| **Stack canary** | Secret tripwire before the return address; abort if it changes. |
| **Forward edge** | Indirect calls (function pointers, virtual calls). |
| **Backward edge** | Returns (the return address). |
| **CFI** | Restrict indirect branches to legitimate targets. |
| **Golden rule** | No single mitigation is enough; layer them. |

---

## Summary

Control flow is the path the CPU takes through your code, and the dangerous parts are the **indirect branches** — returns and function-pointer/virtual calls — whose targets are read from ordinary, corruptible memory. The original attack, **stack smashing**, overflows a stack buffer to overwrite the **return address** and redirect execution into injected **shellcode**. **NX/DEP/W^X** killed injected shellcode by making data non-executable, so attackers pivoted to **code reuse** (return-to-libc) — running the program's own functions against it, which NX can't stop. The cheap, ubiquitous guard you'll see everywhere is the **stack canary**: a secret tripwire placed before the return address that detects contiguous overflows before the corrupted return is used. None of these is complete on its own — canaries miss heap and forward-edge bugs, NX misses code reuse — so real systems layer them, which is exactly what **CFI** (the next levels) generalizes: checking that every indirect branch goes only where the programmer intended.

---

## Further Reading

- "Smashing the Stack for Fun and Profit" (Aleph One) — the foundational, historical description of the stack overflow. Read it as history.
- Your compiler's docs for `-fstack-protector-strong`, `-fstack-protector-all`.
- The `checksec` tool and its documentation — learn to read a binary's mitigations.
- Microsoft's documentation on `/GS` (stack cookies) and DEP.
- Continue to `middle.md` for ROP and forward-edge CFI.
