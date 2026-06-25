# Calling Conventions — Junior Level

> **Topic:** [Calling Conventions](README.md)
> **Focus:** When you call a function, where do the arguments actually go, and who gets the return value back? The answer is a contract written in registers and stack slots.

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
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What physically happens when one function calls another?** The arguments don't travel by magic. They are placed in agreed-upon CPU registers and stack slots, and the result comes back the same way.

When you write `int z = add(3, 4);` you think of it as "pass 3 and 4 to `add`, get a number back." But the CPU has no idea what `add` or "argument" mean. It only knows registers (`RDI`, `RSI`, `RAX`, …), a stack (a region of memory the `RSP` register points at), and a `call` instruction that jumps to an address while remembering where to come back.

So *something* must decide: **when I pass 3 and 4, which exact register or memory slot does each number go into?** And when `add` finishes, **where does it leave the answer so the caller can find it?** That set of rules is the **calling convention**.

The crucial point: the caller and the callee are often compiled separately — your code in one `.c` file, the library function in another, maybe in a different language entirely. They never see each other's source. The *only* reason `add(3, 4)` works is that **both sides agreed on the same convention in advance**. The convention is a contract. Break it and you don't get a compiler error — you get a crash, or worse, silently wrong numbers.

In one sentence: **a calling convention is the precise rulebook for "arguments in, result out" at the machine level, so that code compiled separately can still call each other correctly.**

> 🎓 **Why this matters for a junior:** You will almost never write a calling convention by hand. But the moment you call C from Python, call an OS function, link against a `.dll`, read a stack trace in a debugger, or chase a mysterious crash on "release builds only," you are standing on top of one. Knowing that arguments live in specific registers turns "magic crash" into "oh, the convention is mismatched."

This page covers: what the `call` instruction does, where the first few arguments go on the most common platform (Linux/macOS x86-64), where the return value comes from, the idea of "the caller cleans up its own mess," and your first look at a disassembly showing arguments being loaded into registers. Deeper material — the full SysV classification algorithm, Windows x64, AArch64, variadics, struct-by-value rules — lives in the higher tiers.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a small program with functions in C (or another compiled language you can disassemble).
- **Required:** What a function parameter and a return value are.
- **Helpful but not required:** A vague sense that a CPU has *registers* (tiny named storage slots, faster than RAM) and a *stack* (a region of memory that grows and shrinks as functions call each other).
- **Helpful but not required:** Having once seen assembly output, even if it looked like noise.

You do **not** need to know:

- The full SysV AMD64 struct classification algorithm (that's `senior.md`).
- Windows x64, AArch64, or x86 `stdcall`/`fastcall` details (that's `middle.md` and beyond).
- How variadic functions like `printf` pass their arguments (that's `senior.md`).
- Caller-saved vs callee-saved register tables (`middle.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Calling convention** | The agreed rules for how arguments are passed, where the return value goes, stack alignment, and who cleans up. Also called an **ABI** (the calling convention is a big part of an ABI). |
| **ABI** | Application Binary Interface. The broader contract for how compiled code interoperates: calling convention, struct layout, name mangling, and more. |
| **Caller** | The function doing the calling. |
| **Callee** | The function being called. |
| **Register** | A tiny, named, very fast storage slot inside the CPU (e.g. `RAX`, `RDI`). There are only a handful. |
| **Stack** | A region of memory used for local data and (when registers run out) arguments. `RSP` points at its top. Grows *downward* (toward lower addresses) on x86-64. |
| **`RSP`** | The stack pointer register — points at the current top of the stack. |
| **`call` instruction** | Pushes the return address onto the stack and jumps to the function's first instruction. |
| **`ret` instruction** | Pops the return address off the stack and jumps back to it. |
| **Return address** | The address the callee jumps back to when it's done — pushed by `call`, popped by `ret`. |
| **Argument register** | A register the convention designates for passing a specific argument (e.g. first integer argument → `RDI` on Linux x86-64). |
| **Return register** | The register the result comes back in (`RAX` for integers on x86-64). |
| **SysV AMD64 ABI** | The calling convention used on Linux, macOS, and most Unix systems for 64-bit x86. |
| **Stack alignment** | A rule that `RSP` must be a multiple of 16 at certain points. Violating it crashes some instructions. |
| **Volatile / caller-saved register** | A register the callee may overwrite freely; if the caller needs its value, the caller must save it first. |
| **Non-volatile / callee-saved register** | A register the callee must restore to its original value before returning. |

---

## Core Concepts

### 1. A function call is three machine-level steps

When you write `z = add(3, 4)`, the compiler emits roughly:

```text
1. Put the arguments where the convention says.   (load 3 → RDI, 4 → RSI)
2. CALL add.                                       (push return address, jump)
3. Read the result from where the convention says. (RAX → z)
```

Step 1 and step 3 are pure convention. There is nothing physically forcing `3` to go into `RDI` — it's a rule both sides obey. The `call` and `ret` instructions in step 2 are real hardware, but even they cooperate with the convention: `call` *pushes a return address onto the stack*, and the convention says the stack must look a certain way.

### 2. The first few arguments go in registers (on x86-64 Linux/macOS)

On the SysV AMD64 ABI — what you get on Linux and macOS — **integer and pointer arguments** are passed in these registers, in this exact order:

```text
1st arg → RDI
2nd arg → RSI
3rd arg → RDX
4th arg → RCX
5th arg → R8
6th arg → R9
7th arg and beyond → on the stack
```

So for `add(3, 4)`: `3` goes in `RDI`, `4` goes in `RSI`. For a function with ten integer arguments, the first six ride in registers and the last four are pushed onto the stack.

**Floating-point arguments** (`float`, `double`) use a *different* set of registers — `XMM0` through `XMM7` — counted independently. So `void f(int a, double b, int c)` puts `a` in `RDI`, `c` in `RSI` (the *second integer*), and `b` in `XMM0` (the *first float*). The integer count and the float count advance separately. This trips people up the first time.

> A handy mnemonic for the integer order on Linux/macOS: **"Diane's Silk Dress Cost $89"** → **D**I, **S**I, **D**X, **C**X, **8**, **9**.

### 3. The return value comes back in a register

An integer or pointer result comes back in **`RAX`**. So `add` ends with the sum in `RAX`, and the caller copies `RAX` into `z`. A `double` result comes back in `XMM0`. That's it for the common case — one register in, one register out.

### 4. The stack: where call and ret live

The `call` instruction doesn't just jump. It first **pushes the return address** (the instruction right after the `call`) onto the stack. When the callee runs `ret`, it **pops that address** and jumps back. This is how a function knows where to return — even though the same function may be called from a hundred different places.

```text
Before CALL:                 After CALL (inside callee):
  RSP ──► [ caller locals ]    RSP ──► [ return address ]   ◄── pushed by call
                                       [ caller locals ]
```

The stack grows *downward*: pushing makes `RSP` smaller. This is just the convention on x86-64; it's not a law of nature, but every tool assumes it.

### 5. Caller-cleanup: the caller fixes the stack afterward

On x86-64, if some arguments were passed on the stack, **the caller is responsible for removing them** after the call returns. The callee just does its job and returns; it doesn't tidy up arguments the caller pushed. This is called **caller cleanup** (the historical x86 name is `cdecl`). It's the default you'll meet first. (There's an alternative — *callee cleanup* / `stdcall` — but that's a `middle.md` topic, and it's mostly an old 32-bit Windows thing.)

### 6. Some registers must survive the call; some may not

Imagine you put a value in `RBX`, then call a function. When the function returns, is your value still in `RBX`? The answer depends on the convention's two categories:

- **Caller-saved (volatile)** registers: the callee is allowed to clobber them. If you need the value to survive, **you** save it first. `RAX`, `RDI`, `RSI`, `RDX`, `RCX`, `R8`–`R11` are caller-saved on SysV.
- **Callee-saved (non-volatile)** registers: the callee promises to restore them before returning. `RBX`, `RBP`, `R12`–`R15` are callee-saved on SysV.

You don't usually manage this by hand — the compiler does — but it explains why a debugger can recover some of your variables across a call and not others.

---

## Real-World Analogies

**The drive-through window.** You pull up (the `call`). The convention says: order goes in lane 1, payment in lane 2, the bag comes back through the window slot. Both you and the restaurant know the layout in advance, so a stranger can serve you correctly. If the restaurant suddenly decided the bag comes through a different window, you'd drive off empty-handed — a convention mismatch.

**A standardized shipping pallet.** Argument registers are the pallet slots. Everyone agrees "first box goes here, second there." A truck (the callee) loaded by one warehouse can be unloaded by another, because the slot assignment is standard. Change the standard on one side only and boxes go missing.

**A relay race baton.** The return address is the baton handed over at the `call`. The callee holds it and, when finished, hands it right back (`ret`) so the race continues from exactly the right spot. Drop or corrupt the baton (overwrite the return address) and the runner sprints off in a random direction — that's a stack-smash crash.

**A coat check.** Callee-saved registers are like a coat you check at the door: the establishment (callee) promises to give it back exactly as it was. Caller-saved registers are the loose change in your pocket — nobody promises it's untouched, so if it matters, you stash it yourself first.

---

## Mental Models

### Model 1: The convention is a contract between strangers

The single most important idea: **the caller and callee are strangers who never met.** They were compiled at different times, possibly in different languages, by different teams. The only thing that makes the call work is that **both obey the same written rulebook.** When you "call a C function from Python," you are really saying "Python's runtime will place arguments exactly where the C function's convention expects them."

### Model 2: Registers first, stack when you run out

Picture a small set of numbered cubbies (the argument registers). You fill them in order. When you run out of cubbies, you start stacking the rest on the floor (the stack). The callee looks in the cubbies first, then on the floor, in the same order. Floats use a *separate* set of cubbies counted on their own.

### Model 3: One door in, one door out

Arguments go in through the argument registers; the result comes out through `RAX` (or `XMM0` for floats). For simple functions that's the whole picture: a small fixed set of doors. The complications in later tiers — big structs, variadics, different OSes — are all variations on "what if one door isn't enough?"

---

## Code Examples

### A function and what the compiler does with the call

```c
// add.c
int add(int a, int b) {
    return a + b;
}

int main(void) {
    int z = add(3, 4);
    return z;
}
```

Compile and disassemble on Linux/macOS x86-64:

```bash
gcc -O0 -c add.c -o add.o
objdump -d add.o          # show the machine code
```

The interesting part of `main` looks roughly like:

```asm
; main: int z = add(3, 4);
mov    esi, 4          ; 2nd argument → ESI (low half of RSI)
mov    edi, 3          ; 1st argument → EDI (low half of RDI)
call   add             ; push return address, jump to add
; result is now in EAX (low half of RAX)
mov    DWORD PTR [rbp-4], eax   ; store result into local z
```

And `add` itself:

```asm
; add:
mov    eax, edi        ; eax = a   (1st arg came in via EDI)
add    eax, esi        ; eax += b  (2nd arg came in via ESI)
ret                    ; return; result is in EAX
```

Read those two `mov`s in `main` carefully: **`3` is loaded into `EDI` and `4` into `ESI` *before* the `call`.** That is the calling convention in action. `add` doesn't "receive" parameters — it just reads `EDI` and `ESI` because the contract guarantees they hold the arguments. The result is left in `EAX`, and `main` reads it from there.

> `EDI`/`ESI`/`EAX` are the 32-bit halves of the 64-bit `RDI`/`RSI`/`RAX`. Because `int` is 32 bits, the compiler uses the 32-bit names. Same registers.

### Floats use different registers

```c
double scale(int n, double factor) {
    return n * factor;
}
```

Disassembly highlights:

```asm
; scale:
; n      arrived in EDI   (1st INTEGER argument)
; factor arrived in XMM0  (1st FLOAT argument)
cvtsi2sd xmm1, edi        ; convert int n to double in xmm1
mulsd    xmm1, xmm0       ; xmm1 = n * factor
movsd    xmm0, xmm1       ; result → XMM0 (float return register)
ret
```

Notice: the integer argument went to `EDI`, the floating argument went to `XMM0`, and the `double` result came back in `XMM0`. Two independent lanes.

### Calling a function with more than six integer arguments

```c
long sum8(long a, long b, long c, long d,
          long e, long f, long g, long h) {
    return a + b + c + d + e + f + g + h;
}
```

When `main` calls `sum8(1,2,3,4,5,6,7,8)`:

```asm
; first six go in registers:
mov edi, 1   ; a
mov esi, 2   ; b
mov edx, 3   ; c
mov ecx, 4   ; d
mov r8d, 5   ; e
mov r9d, 6   ; f
; the seventh and eighth go on the stack:
push 8       ; h   (pushed first / higher)
push 7       ; g
call sum8
add  rsp, 16 ; CALLER cleans up the two stack args (caller cleanup)
```

That final `add rsp, 16` is the caller removing the two 8-byte arguments it pushed — the "caller cleanup" rule made concrete.

---

## Pros & Cons

Calling conventions are not something you choose to use — every compiled program has one. But the *design choices* inside a convention have trade-offs worth understanding.

**Why pass arguments in registers (pros):**

- **Fast.** Registers are the quickest storage the CPU has; no memory access for the first several arguments.
- **Cache-friendly.** Fewer stack writes means fewer memory operations and better cache behavior.

**Why the stack is still needed (cons / limits):**

- There are only a handful of argument registers (six integer, eight float on SysV). Beyond that you *must* spill to the stack.
- Large structs may not fit in registers and go to memory regardless.

**Why a *standardized* convention is good:**

- **Interoperability.** Separately compiled modules, libraries, and languages can call each other.
- **Tooling.** Debuggers, profilers, and stack-unwinders can make sense of any binary that follows the standard.

**The cost of standardization:**

- **Rigidity.** Once an ABI ships, it's frozen essentially forever — you can't "improve" it without breaking every existing binary.
- **Platform fragmentation.** Linux, Windows, and ARM each picked different rules, so cross-platform FFI tools must know all of them.

---

## Use Cases

You meet calling conventions whenever compiled code talks to *other* compiled code:

- **Calling C from a higher-level language** (Python `ctypes`/`cffi`, Node N-API, Go `cgo`, Java JNI/Panama, Rust `extern "C"`). The runtime must place arguments per the C convention.
- **Calling operating-system APIs.** A syscall wrapper or a Win32 function follows a specific convention; get it wrong and the call corrupts memory.
- **Linking against a shared library** (`.so`, `.dll`, `.dylib`). The library was compiled assuming a convention; your code must match.
- **Reading a stack trace or debugging a crash.** Knowing arguments live in `RDI`/`RSI`/… lets you recover a function's parameters from a core dump.
- **Writing a tiny bit of assembly** that calls into C, or that C calls into.

---

## Coding Patterns

As a junior you rarely touch the convention directly, but a few patterns keep you safe:

### Pattern 1: Always declare `extern "C"` (or the equivalent) at FFI boundaries

When you expose a function to be called from another language, mark it with the plain C convention so name mangling and the convention are predictable:

```c
// In C++ — without extern "C", the name gets mangled and may use a
// different convention.
extern "C" int add(int a, int b) {
    return a + b;
}
```

### Pattern 2: Match the declared prototype exactly on both sides

The convention is computed from the function's *types*. If one side thinks the second argument is an `int` and the other thinks it's a `double`, they look at different registers (`RSI` vs `XMM0`) and the call goes wrong with no warning. Keep the header the single source of truth.

### Pattern 3: Let the compiler do the work — don't hand-roll calls

If you write inline assembly to call a function, you become responsible for the entire convention (argument placement, alignment, cleanup, register preservation). Avoid it until you genuinely need it. The compiler is correct by construction.

---

## Best Practices

- **Trust the prototype, keep it shared.** The function signature in a shared header is what generates correct calls on both sides. Never let two translation units disagree about a function's types.
- **Always use `extern "C"` for cross-language entry points** so the name and convention are the plain, predictable C ABI.
- **Don't assume registers survive a call.** If you're reading values in a debugger after a call, only callee-saved registers are guaranteed intact.
- **Compile both sides for the same platform/architecture.** The SysV convention on Linux differs from the Windows x64 convention; a 32-bit and a 64-bit build use different conventions entirely.
- **When something crashes "only in release builds," suspect a convention or undefined-behavior mismatch**, not the optimizer being "buggy."
- **Read the disassembly when confused.** `objdump -d` (or your IDE's disassembly view) shows you exactly which register each argument went into. It removes all guesswork.

---

## Edge Cases & Pitfalls

### Pitfall 1: Mismatched prototypes silently corrupt arguments

If a header declares `void f(int)` but the real function is `void f(double)`, the caller loads the value into `EDI` and the callee reads `XMM0`. No crash at the call — just garbage. **Always include the real header; never re-declare functions yourself.**

### Pitfall 2: Wrong platform's convention

A function compiled for Windows x64 expects its first argument in `RCX`, not `RDI`. If a tool calls it as if it were SysV, the first argument lands in the wrong register. This is why FFI glue must know the target OS, not just the architecture.

### Pitfall 3: Forgetting that floats live in separate registers

`f(int, double, int)` does **not** put the three arguments in `RDI`, `RSI`, `RDX`. It puts the two ints in `RDI`, `RSI` and the double in `XMM0`. Counting integers and floats together is a classic beginner error.

### Pitfall 4: Assuming the stack frame stays put

Stack-passed arguments and the return address sit in memory just above `RSP`. Writing past the end of a local array can overwrite the return address — and then `ret` jumps somewhere random. This is the mechanism behind classic stack-smashing bugs.

### Pitfall 5: Thinking the convention is "just how computers work"

It isn't — it's a *choice*. Different OSes, architectures, and even special function attributes change it. Treat "which convention?" as a real question whenever you cross a boundary between separately built code.

---

## Cheat Sheet

```text
SYSV AMD64 (Linux / macOS), integer/pointer arguments, in order:
    RDI, RSI, RDX, RCX, R8, R9   then the stack

Floating-point arguments:
    XMM0 .. XMM7                 then the stack (separate count)

Return value:
    integer/pointer → RAX
    floating-point  → XMM0

Stack:
    grows DOWNWARD; RSP points at the top
    CALL pushes the return address; RET pops it
    caller cleans up its own stack arguments (cdecl-style)

Register preservation (SysV):
    caller-saved (clobberable): RAX RDI RSI RDX RCX R8 R9 R10 R11
    callee-saved (preserved):   RBX RBP R12 R13 R14 R15  (and RSP)

Mnemonic for integer order: "Diane's Silk Dress Cost $89"
    DI  SI  DX  CX  8  9
```

---

## Summary

A **calling convention** is the precise, agreed rulebook for how a function call happens at the machine level: which registers and stack slots carry the arguments, where the return value comes back, and who cleans up afterward. It exists so that code compiled separately — different files, libraries, even languages — can call each other correctly without ever seeing each other's source.

On the most common platform you'll meet first (SysV AMD64, used by Linux and macOS), the first six integer/pointer arguments ride in `RDI`, `RSI`, `RDX`, `RCX`, `R8`, `R9`; floats ride in `XMM0`–`XMM7`; the result comes back in `RAX` (or `XMM0`). When arguments run out of registers they spill to the stack, and the caller cleans those up afterward. Some registers must survive a call (callee-saved) and some may not (caller-saved).

You rarely write this by hand, but it underlies every FFI call, every OS API, every shared library, and every crash dump you'll ever read. When in doubt, disassemble — the registers don't lie. The next tier covers the other major conventions (Windows x64, AArch64), the caller-vs-callee cleanup distinction, and stack alignment in detail.

---

## Further Reading

- *System V Application Binary Interface, AMD64 Architecture Processor Supplement* — the authoritative SysV AMD64 spec (figures 3.x cover argument passing).
- Agner Fog, *Calling Conventions for Different C++ Compilers and Operating Systems* — a famously clear cross-platform reference.
- Eli Bendersky, "Stack frame layout on x86-64" — a readable walkthrough with diagrams.
- The Intel and AMD architecture manuals — for `call`/`ret` and the register set.

---

## Diagrams & Visual Aids

### Where the first arguments go (SysV AMD64)

```text
   call  f(a, b, c, d, e, f7, g8)
          │  │  │  │  │   │   │
          ▼  ▼  ▼  ▼  ▼   ▼   ▼
        RDI SI DX CX R8  R9  [stack]
         a  b  c  d  e   f7   g8   ◄── 7th+ spill to stack
```

### The call/ret baton

```text
   caller:  ... mov edi,3 ; mov esi,4 ;  CALL f  ────────┐
                                                          │ push return addr
                                                          ▼
   callee:  f:  read EDI, ESI ... put result in RAX ;  RET
                                                          │ pop return addr
   caller:  ◄───────────────────────────────────────────┘
            read result from RAX
```

### Two independent lanes: integers and floats

```text
   f(int a, double b, int c, double d)

   integer lane:  a → RDI     c → RSI
   float   lane:  b → XMM0    d → XMM1
                  (counted separately!)
```

### The stack after a call with two spilled arguments

```text
   higher addresses
        ┌───────────────┐
        │   8th arg (h) │
        ├───────────────┤
        │   7th arg (g) │
        ├───────────────┤
        │ return address│ ◄── pushed by CALL
        ├───────────────┤
RSP ──► │ callee frame  │
        └───────────────┘
   lower addresses  (stack grows down)
```
