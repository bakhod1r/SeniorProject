# Calling Conventions — Middle Level

> **Topic:** [Calling Conventions](README.md)
> **Focus:** The four conventions you actually meet — SysV AMD64, Windows x64, AArch64 AAPCS64, and the x86 family (cdecl/stdcall/fastcall) — plus stack alignment, the red zone, shadow space, and who saves which registers.

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

> Focus: **There is no single calling convention.** There are several, and they disagree on almost every detail — which registers carry arguments, how the stack is aligned, whether there's scratch space below the stack pointer, and who cleans up. To do FFI correctly you must know *which one* applies at each boundary.

At the junior tier you learned the SysV AMD64 rules: integer arguments in `RDI`, `RSI`, `RDX`, `RCX`, `R8`, `R9`; floats in `XMM0`–`XMM7`; return in `RAX`/`XMM0`; caller cleanup. That convention rules Linux and macOS on 64-bit x86. But the same physical CPU runs *Windows* with a completely different convention, your phone runs *AArch64* with yet another, and 32-bit x86 has a whole zoo of historical conventions (`cdecl`, `stdcall`, `fastcall`, `thiscall`) that still leak into Win32 APIs you may have to call today.

This is not academic. The Windows x64 convention passes its first integer argument in `RCX`, not `RDI`. It reserves 32 bytes of "shadow space" on the stack that SysV knows nothing about. SysV has a 128-byte "red zone" below the stack pointer that Windows forbids. AArch64 uses `X0`–`X7`. Call a function with the wrong convention and you don't get a tidy error — you get corrupted arguments, a misaligned stack that faults on the first SSE instruction, or a `RSP` that's off by 32 bytes for the rest of the program.

In one sentence: **the calling convention is a per-platform contract, and "which platform" is the first question you must answer at any FFI boundary, before "which registers."**

> 🎓 **Why this matters at the middle level:** You're now the person writing the FFI glue, the cross-platform build, or the inline assembly. The bugs you'll create — and have to debug — come precisely from convention mismatches: a stack misaligned by 8 that crashes `movaps`, a stdcall function called as cdecl that leaks 16 bytes of stack per call until you blow the frame, a Windows callback that clobbers the shadow space. This tier gives you the four conventions side by side and the rules that differ between them.

This page covers: SysV AMD64 vs Windows x64 vs AArch64 AAPCS64 side by side; the full caller-saved/callee-saved register tables; 16-byte stack alignment and where it's measured; the SysV red zone; the Windows shadow/home space; and the x86 cleanup conventions (cdecl vs stdcall vs fastcall) and why they mattered for the Win32 API. Struct-by-value classification and variadics get their full treatment in `senior.md`.

---

## Prerequisites

- **Required:** The junior tier — argument registers, `RAX`/`XMM0` returns, caller cleanup, the call/ret mechanism.
- **Required:** Comfort reading x86-64 disassembly (`mov`, `push`, `sub rsp`, `call`, `ret`).
- **Helpful:** Having built or linked something cross-platform (a `.dll` and a `.so` of the same library).
- **Helpful:** Awareness that SSE instructions like `movaps` require 16-byte-aligned memory operands.

You do **not** yet need:

- The SysV struct classification algorithm (INTEGER/SSE/MEMORY) — that's `senior.md`.
- Variadic argument passing internals (the `AL` register rule) — `senior.md`.
- `sret`/hidden-pointer struct returns in depth — `senior.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **SysV AMD64 ABI** | The 64-bit x86 convention on Linux, macOS, BSD, and most Unix. |
| **Windows x64 ABI** | Microsoft's 64-bit x86 convention. Different argument registers, shadow space, no red zone. |
| **AAPCS64** | The "Procedure Call Standard for the Arm 64-bit Architecture" — the AArch64 convention. |
| **cdecl** | 32-bit x86: arguments on the stack, **caller** cleans up. The C default. |
| **stdcall** | 32-bit x86: arguments on the stack, **callee** cleans up (via `ret N`). The Win32 API convention. |
| **fastcall** | 32-bit x86: first two integer args in `ECX`, `EDX`, rest on stack. |
| **thiscall** | 32-bit x86 (MSVC): `this` pointer in `ECX`, rest like cdecl/stdcall. |
| **vectorcall** | A modern Microsoft convention passing more vector arguments in `XMM`/`YMM` registers. |
| **Shadow space / home space** | 32 bytes the **caller** reserves on the stack on Windows x64, even when args fit in registers. The callee may spill the four register args there. |
| **Red zone** | 128 bytes **below** `RSP` that a SysV leaf function may use without adjusting `RSP`. Forbidden on Windows. |
| **Stack alignment** | The rule that `RSP` is a 16-byte multiple *at the point of a `call`* on SysV and Windows x64; 16-byte for `SP` on AArch64. |
| **Caller-saved (volatile)** | A register the callee may overwrite; the caller saves it if needed. |
| **Callee-saved (non-volatile)** | A register the callee must restore before returning. |
| **Leaf function** | A function that calls no other function. Can exploit the red zone and skip some bookkeeping. |
| **`movaps` fault** | A general-protection fault raised when an aligned SSE move hits a non-16-byte-aligned address. The classic symptom of stack misalignment. |
| **Stack slot** | An 8-byte (x86-64) region on the stack used for one spilled argument or saved register. |

---

## Core Concepts

### 1. The three 64-bit conventions, side by side

| | **SysV AMD64** (Linux/macOS) | **Windows x64** | **AArch64 AAPCS64** |
|---|---|---|---|
| Integer arg registers | RDI, RSI, RDX, RCX, R8, R9 | RCX, RDX, R8, R9 | X0–X7 |
| Float/vector arg registers | XMM0–XMM7 | XMM0–XMM3 | V0–V7 |
| Integer return | RAX (+RDX for 128-bit) | RAX | X0 (+X1) |
| Float return | XMM0 | XMM0 | V0 |
| Register/stack pairing | int & float counted **separately** | by **position**: 4th arg → R9 *or* XMM3, not both | int & float counted separately |
| Shadow space | none | **32 bytes**, caller-reserved | none |
| Red zone | **128 bytes** below RSP | none | none (but 16-byte SP alignment) |
| Stack alignment at call | RSP % 16 == 0 | RSP % 16 == 0 | SP % 16 == 0 |
| Stack cleanup | caller | caller | caller |

The two most dangerous differences for FFI:

1. **Different first-argument register.** SysV: `RDI`. Windows: `RCX`. AArch64: `X0`. Mixing these up corrupts every argument.
2. **Windows pairs by position, not by separate counts.** In `f(int a, double b, int c, double d)` on Windows, `a→RCX`, `b→XMM1` (slot 2), `c→R8` (slot 3), `d→XMM3` (slot 4). Each *positional* slot maps to one integer register **or** one XMM register. SysV instead counts integers and floats independently, so `b→XMM0` and `c→RSI`.

### 2. Windows shadow space (home space)

On Windows x64, **the caller must allocate 32 bytes of stack space immediately above the return address before every call**, even if all four arguments fit in registers. This "shadow space" (also "home space") gives the callee a place to spill `RCX`, `RDX`, `R8`, `R9` back to memory if it wants to take their address or just needs the registers.

```asm
; Windows x64 call to f(1, 2):
mov  rcx, 1
mov  rdx, 2
sub  rsp, 32          ; allocate the 32-byte shadow space
call f
add  rsp, 32          ; reclaim it
```

Forget the `sub rsp, 32` and the callee will spill into *your* stack frame, corrupting locals. This is a top cause of "works on Linux, crashes on Windows" FFI bugs.

### 3. The SysV red zone

On SysV, the 128 bytes **below** `RSP` are reserved for the current function: a **leaf function** (one that calls nothing) may freely use that space for scratch without ever decrementing `RSP`. Signal handlers and the OS promise not to clobber it.

```asm
; SysV leaf function using the red zone:
mov  [rsp-8],  rdi    ; scratch storage BELOW rsp, no 'sub rsp'
mov  [rsp-16], rsi
; ... compute ...
ret                    ; no stack adjustment needed
```

The catch: **the red zone does not exist on Windows.** Hand-written assembly or a custom code generator that assumes a red zone will silently corrupt memory on Windows, because an interrupt or the next call can overwrite that region. This is also why kernel code (where interrupts use the same stack) is compiled with `-mno-red-zone`.

### 4. 16-byte stack alignment and the `movaps` fault

Both SysV and Windows x64 require `RSP` to be **16-byte aligned at the moment a `call` executes**. Because `call` then pushes an 8-byte return address, **on entry to the callee `RSP` is 16n + 8** — i.e., 8 *off* alignment. The callee's prologue (`push rbp` makes it 16-aligned again, or `sub rsp, N` with the right N) restores 16-byte alignment before it issues any aligned SSE instruction.

Why it matters: instructions like `movaps`, `movdqa`, and many vectorized library routines require a 16-byte-aligned memory operand. If your hand-written call site leaves `RSP` misaligned by 8, the *callee's* first aligned SSE access faults with a general-protection (`#GP`) fault. The symptom — a crash inside `memset` or `printf` on the first SSE move — looks unrelated to your call until you check `RSP & 15`.

```text
At the CALL:        RSP % 16 == 0          (required)
After CALL pushes:  RSP % 16 == 8          (8 bytes of return addr)
Callee prologue:    push rbp  →  RSP % 16 == 0  again
```

AArch64 has the same spirit: `SP` must be 16-byte aligned at any point an instruction accesses memory relative to it, and always at a public function boundary.

### 5. Caller-saved vs callee-saved — the full tables

**SysV AMD64:**

```text
caller-saved (volatile):  RAX RCX RDX RSI RDI R8 R9 R10 R11
                          XMM0–XMM15
callee-saved (preserved): RBX RBP R12 R13 R14 R15   (and RSP)
```

**Windows x64:**

```text
caller-saved (volatile):  RAX RCX RDX R8 R9 R10 R11
                          XMM0–XMM5
callee-saved (preserved): RBX RBP RDI RSI R12 R13 R14 R15
                          XMM6–XMM15   (and RSP)
```

Note the asymmetry: **`RSI` and `RDI` are caller-saved on SysV but callee-saved on Windows**, and Windows treats `XMM6`–`XMM15` as callee-saved while SysV treats *all* XMM registers as caller-saved. Hand-written assembly ported between the two that forgets to save `RDI`/`RSI` (or `XMM6+`) on Windows will corrupt the caller's state.

**AArch64 AAPCS64:**

```text
caller-saved:  X0–X18 (X16/X17 are intra-call temps, X18 is platform-reserved)
               V0–V7, V16–V31
callee-saved:  X19–X28, FP (X29), LR (X30)
               V8–V15 (low 64 bits only)
```

### 6. The x86 cleanup conventions (still matter)

On 32-bit x86 there were no argument registers in the original conventions — everything went on the stack — so the *cleanup* question was central:

- **cdecl:** caller cleans up. Supports variadics (the callee can't know how many args were pushed, but the caller does). The C default.
- **stdcall:** callee cleans up with `ret N` (pop N bytes on return). Smaller call sites. **The entire Win32 API uses stdcall** (`WINAPI`/`__stdcall`).
- **fastcall:** first two integer args in `ECX`, `EDX`; rest on stack; callee cleans up.
- **thiscall:** the C++ MSVC convention for member functions — `this` in `ECX`.

Why this still bites you: if you declare a Win32 function as cdecl (caller cleanup) but it's really stdcall (callee cleanup), **both sides clean up the same stack arguments** — the stack pointer ends up wrong by the argument size after every call. A few calls in, the stack is hopelessly corrupted. This is the legendary "calling a stdcall function as cdecl" bug, and on 64-bit it's why everyone collapsed to a single convention.

> On 64-bit x86 these distinctions largely vanished: there is one convention per OS, always caller-cleanup, with the keywords kept only for source compatibility (the compiler ignores `__stdcall` in 64-bit builds).

---

## Real-World Analogies

**Driving on different sides of the road.** SysV, Windows, and AArch64 are like the UK, the US, and Japan: the *task* (drive a car / call a function) is the same, but the rules differ in ways that cause head-on collisions if you assume the wrong one. "Which country am I in?" is the question you ask before "which lane?"

**Hotel coat check vs self-storage.** Callee-saved registers are the hotel coat check: the establishment guarantees your coat comes back unchanged. Caller-saved are a public locker you didn't reserve — touch at your own risk, stash valuables yourself. The catch is that the *list of which is which* changes between hotels (SysV vs Windows), and `RSI`/`RDI` swap categories.

**Reserved parking out front (shadow space).** On Windows, the caller must always leave 32 bytes of "reserved parking" right in front of the building for the callee, even if the callee never uses it. Forget to reserve it and the callee parks on top of your flower bed (your locals).

**The basement scratch room (red zone).** SysV gives each function a 128-byte basement just below the stairs (below `RSP`) it can scribble in without telling anyone — but only because the building's rules promise nobody else enters it. Move to a Windows building with no such rule and the cleaning crew (an interrupt) walks right through it.

---

## Mental Models

### Model 1: "Which OS, which arch, then which registers"

Make the lookup a fixed ritual: **OS → architecture → register table → alignment/shadow/red-zone rules.** Never reach for `RDI` reflexively; reach for it only after confirming you're on SysV.

### Model 2: The stack pointer is a precise number, not a vague "top"

Treat `RSP` as a value you must keep congruent to 0 mod 16 at every `call`. Walk the arithmetic: entry leaves it at 8 mod 16; each `push` subtracts 8; your `sub rsp, N` must land it back on 16 before the next `call`. Most hand-written-assembly crashes are this number being off by 8.

### Model 3: Two cleanup philosophies

"Whoever knows how many arguments there are should clean them up." Variadic functions force *caller* cleanup (only the caller knows the count) — which is exactly why `printf` is cdecl and why stdcall can't be variadic. This single principle explains the cdecl/stdcall split.

---

## Code Examples

### Same function, three conventions — argument loading

```c
long f(long a, long b, long c) { return a + b + c; }
```

**SysV (Linux/macOS):**

```asm
; caller: f(10, 20, 30)
mov  edi, 10        ; a → RDI
mov  esi, 20        ; b → RSI
mov  edx, 30        ; c → RDX
call f
```

**Windows x64:**

```asm
; caller: f(10, 20, 30)
mov  ecx, 10        ; a → RCX
mov  edx, 20        ; b → RDX
mov  r8d, 30        ; c → R8
sub  rsp, 32        ; shadow space — required!
call f
add  rsp, 32
```

**AArch64:**

```asm
; caller: f(10, 20, 30)
mov  x0, 10         ; a → X0
mov  x1, 20         ; b → X1
mov  x2, 30         ; c → X2
bl   f             ; bl = branch-and-link; return addr → LR (X30)
```

### Mixed int/float, SysV vs Windows (the positional trap)

```c
double g(int a, double b, int c, double d);
```

**SysV** — integers and floats counted separately:

```asm
mov   edi, ...      ; a → RDI   (1st integer)
movsd xmm0, ...     ; b → XMM0  (1st float)
mov   esi, ...      ; c → RSI   (2nd integer)
movsd xmm1, ...     ; d → XMM1  (2nd float)
```

**Windows x64** — by *positional* slot, int OR xmm per slot:

```asm
mov   ecx, ...      ; a → RCX   (slot 1)
movsd xmm1, ...     ; b → XMM1  (slot 2)
mov   r8d, ...      ; c → R8    (slot 3)
movsd xmm3, ...     ; d → XMM3  (slot 4)
```

Same source, completely different register assignment. An FFI tool that hard-codes "floats go in XMM0, XMM1, …" is correct on SysV and *wrong* on Windows.

### Keeping the stack aligned by hand

```asm
; SysV leaf that needs to make ONE call and keep 16-byte alignment:
my_func:
    push rbp            ; rsp: 16n+8 → 16n  (now aligned)
    mov  rbp, rsp
    sub  rsp, 16        ; reserve 16 bytes of locals, still aligned
    ; ... rsp is 16-aligned here, safe to call ...
    call other
    leave              ; mov rsp,rbp ; pop rbp
    ret
```

If you `sub rsp, 8` instead of 16, the next `call` happens with `RSP` misaligned and the callee may fault on `movaps`.

### Demonstrating the red zone (SysV only)

```c
// Compile twice and diff the assembly:
//   gcc -O2 -S leaf.c               (uses [rsp-8], no 'sub rsp')
//   gcc -O2 -S -mno-red-zone leaf.c (adds 'sub rsp, 8')
long leaf(long x) {
    long tmp = x * x;     // scratch the compiler may park in the red zone
    return tmp + 1;
}
```

With the red zone, the compiler stores `tmp` at `[rsp-8]` without adjusting `RSP`. With `-mno-red-zone` it must `sub rsp` first. This flag is mandatory for kernel and interrupt code.

---

## Pros & Cons

**Register-passing conventions (all modern ones):**

- ✅ Fast: first several arguments never touch memory.
- ✅ Standardized per platform: predictable for tools and FFI.
- ❌ Limited register count forces stack spill for many-argument functions.

**Windows shadow space:**

- ✅ Gives the callee guaranteed spill slots; simplifies debugging (args have a home address).
- ❌ Wastes 32 bytes per frame; an easy thing to forget in hand-written calls.

**SysV red zone:**

- ✅ Leaf functions skip prologue/epilogue stack adjustment — faster, smaller.
- ❌ Fragile: invalid under interrupts on the same stack; a portability footgun.

**stdcall (callee cleanup):**

- ✅ Smaller call sites (cleanup encoded once in the callee).
- ❌ Cannot support variadics; deadly if mismatched with cdecl.

---

## Use Cases

- **Cross-platform FFI bindings.** A library binding (Python, Go, Rust, .NET P/Invoke) must select the right convention per target OS — `RDI` on Linux, `RCX` on Windows, shadow space and all.
- **Calling the Win32 API.** Every `WINAPI` function is stdcall on 32-bit and the unified x64 convention on 64-bit; your declarations must match.
- **Writing or porting hand assembly / JITs.** A JIT emitting calls must reserve shadow space on Windows and keep 16-byte alignment everywhere.
- **Kernel and embedded code.** `-mno-red-zone` is required where the same stack is reused by interrupts.
- **Debugging "works on one OS, crashes on another."** Almost always a convention or alignment difference.

---

## Coding Patterns

### Pattern 1: Select the convention per platform with attributes

GCC/Clang let you force a convention regardless of the host:

```c
#ifdef _WIN32
  #define CB __attribute__((ms_abi))
#else
  #define CB __attribute__((sysv_abi))
#endif

// A callback that must follow a specific OS's convention even when
// compiled on the other OS (useful for emulators, loaders, JITs).
int CB on_event(int code, void *ctx);
```

### Pattern 2: Always reserve shadow space in emitted Windows calls

If you generate code, make "reserve 32 bytes + align to 16" a non-negotiable step of your call-emission routine. Bake it in so it can't be forgotten per-call.

### Pattern 3: Annotate Win32 declarations precisely

```c
// Match the OS convention; on 64-bit the keyword is a harmless no-op,
// on 32-bit it's load-bearing (callee cleanup).
int WINAPI MessageBoxA(void *hWnd, const char *text,
                       const char *caption, unsigned type);
```

### Pattern 4: Keep alignment arithmetic explicit in assembly

Comment every `push`/`sub rsp`/`call` with the resulting `RSP mod 16`. Reviewers (and you, later) can verify alignment by reading the comments.

---

## Best Practices

- **Decide the convention from OS + architecture first**, every time, before touching registers.
- **On Windows x64, always allocate the 32-byte shadow space** before a call, even when every argument is in a register.
- **Keep `RSP` 16-byte aligned at every `call`.** When hand-writing, track it instruction by instruction.
- **Compile kernel/interrupt code with `-mno-red-zone`.** The red zone is unsafe wherever interrupts share the stack.
- **Match cleanup conventions exactly on 32-bit x86.** Never declare a stdcall function as cdecl or vice versa.
- **Watch the callee-saved tables when porting assembly** — `RSI`/`RDI` and `XMM6+` change category between SysV and Windows.
- **Reproduce the crash under a debugger and inspect `RSP & 15` and the argument registers.** Convention bugs are obvious once you look at the actual register state.

---

## Edge Cases & Pitfalls

### Pitfall 1: The `movaps` crash from an 8-byte misalignment

A call site that leaves `RSP` at `16n+8` makes the callee fault on its first aligned SSE move. The crash appears deep inside a library function, with a stack that looks fine. Always check alignment at *your* call site, not the library's.

### Pitfall 2: Forgetting shadow space on Windows

No shadow space → the callee spills `RCX`/`RDX`/`R8`/`R9` over your local variables. Symptoms are corrupted locals that change as you edit unrelated code. Add `sub rsp, 32`.

### Pitfall 3: Assuming the red zone exists on Windows

Hand assembly or a code generator that uses `[rsp-8]` scratch works on Linux and silently corrupts data on Windows (and in any interrupt context). The red zone is a SysV-only luxury.

### Pitfall 4: stdcall ↔ cdecl mismatch

If declarations disagree about who cleans up, the stack pointer drifts by the argument size each call until the program collapses. On 32-bit Win32 code this is the classic "random crash after N calls."

### Pitfall 5: Windows positional pairing vs SysV separate counts

`f(int, double, int, double)` puts the floats in different XMM registers on the two platforms. An FFI marshaller that assumes "Nth float → XMM(N-1)" is wrong on Windows. Use the positional rule there.

### Pitfall 6: Porting assembly that clobbers `RSI`/`RDI` on Windows

They're scratch on SysV but callee-saved on Windows. Reuse them without saving and you corrupt the caller. Same trap with `XMM6`–`XMM15`.

---

## Cheat Sheet

```text
INTEGER ARG REGISTERS
  SysV    : RDI RSI RDX RCX R8 R9         then stack
  Win x64 : RCX RDX R8 R9                 then stack (after 32B shadow)
  AArch64 : X0 X1 X2 X3 X4 X5 X6 X7       then stack

FLOAT ARG REGISTERS
  SysV    : XMM0..XMM7   (separate count from integers)
  Win x64 : XMM0..XMM3   (paired by positional slot)
  AArch64 : V0..V7       (separate count)

RETURN
  int  : RAX (SysV/Win) | X0 (AArch64)
  float: XMM0           | V0

STACK
  16-byte aligned at every CALL (SysV, Win x64); SP 16-byte (AArch64)
  after CALL pushes return addr, RSP is 16n+8 on entry
  caller cleanup everywhere on 64-bit

WINDOWS-ONLY : 32-byte shadow/home space, reserved by caller
SYSV-ONLY    : 128-byte red zone below RSP (NOT on Windows; -mno-red-zone)

CALLEE-SAVED
  SysV    : RBX RBP R12 R13 R14 R15
  Win x64 : RBX RBP RDI RSI R12-R15  +  XMM6-XMM15
  AArch64 : X19-X28 FP LR  +  V8-V15(low64)

32-BIT x86 CLEANUP
  cdecl   : caller cleanup (variadic-capable) — C default
  stdcall : callee cleanup (ret N) — Win32 API
  fastcall: ECX,EDX then stack, callee cleanup
  thiscall: this in ECX (MSVC member fns)
```

---

## Summary

There isn't one calling convention — there are several, and the FFI engineer's first job is to identify *which one* applies. The 64-bit landscape has three you must know: **SysV AMD64** (Linux/macOS: args in `RDI`/`RSI`/…, a 128-byte red zone, no shadow space), **Windows x64** (args in `RCX`/`RDX`/`R8`/`R9`, a mandatory 32-byte shadow space, no red zone, positional int/float pairing), and **AArch64 AAPCS64** (args in `X0`–`X7`). All three are caller-cleanup, all three require 16-byte stack alignment at the call, and all three differ on which registers the callee must preserve — notably `RSI`/`RDI` and `XMM6+` flip category between SysV and Windows.

The 32-bit x86 conventions (**cdecl**, **stdcall**, **fastcall**, **thiscall**) still matter when calling legacy Win32 APIs, where the cleanup-side mismatch between cdecl and stdcall is a notorious source of slow stack corruption.

The recurring failure modes — `movaps` faults from 8-byte misalignment, forgotten shadow space corrupting locals, an assumed-but-absent red zone, and cleanup mismatches — are all "looked at the wrong convention" bugs. Confirm OS and architecture, look up the table, and check `RSP & 15` and the argument registers in a debugger. The next tier dissects the hardest part: how *structs* are passed and returned, and how variadic functions work under the hood.

---

## Further Reading

- *System V AMD64 ABI* spec — §3.2 (stack), §3.2.3 (parameter passing), the red zone in §3.2.2.
- Microsoft, "x64 calling convention" and "x64 stack usage" docs — shadow space, no red zone, register volatility.
- Arm, *Procedure Call Standard for the Arm 64-bit Architecture (AAPCS64)*.
- Agner Fog, *Calling Conventions for Different C++ Compilers and Operating Systems* — the cross-platform comparison tables.
- GCC manual, `__attribute__((ms_abi))` / `((sysv_abi))` and `-mno-red-zone`.

---

## Diagrams & Visual Aids

### First integer argument by platform

```text
   f(a, ...)
        │
   SysV │──► RDI
  Win64 │──► RCX
 AArch64│──► X0
```

### Windows x64 stack frame at a call

```text
   higher addresses
     ┌──────────────────┐
     │ 5th arg (if any) │
     ├──────────────────┤
     │ shadow slot R9   │  ◄┐
     │ shadow slot R8   │   │ 32 bytes, reserved by CALLER
     │ shadow slot RDX  │   │ even when args are in registers
     │ shadow slot RCX  │  ◄┘
     ├──────────────────┤
     │  return address  │  ◄── pushed by CALL
RSP ►├──────────────────┤
     │  callee frame    │
     └──────────────────┘
   lower addresses
```

### SysV red zone

```text
        ┌──────────────────┐
RSP ──► │  (top of stack)  │
        ├──────────────────┤  ◄── RSP - 1
        │                  │
        │   RED ZONE       │  128 bytes a LEAF function may scribble in
        │   (128 bytes)    │  WITHOUT moving RSP. Safe on SysV only.
        │                  │
        ├──────────────────┤  ◄── RSP - 128
        │ (below: unsafe)  │
        └──────────────────┘
```

### Alignment arithmetic across a call

```text
   at CALL site:        RSP ≡ 0  (mod 16)   ← required
   CALL pushes 8:       RSP ≡ 8  (mod 16)   ← state on callee entry
   push rbp (-8):       RSP ≡ 0  (mod 16)   ← realigned, safe for movaps
   sub rsp, 8 instead:  RSP ≡ 8  (mod 16)   ← BUG: next aligned SSE faults
```

### cdecl vs stdcall cleanup (32-bit)

```text
   cdecl :  caller pushes args, CALLS, then 'add esp, N' to clean up
   stdcall: caller pushes args, CALLS; callee does 'ret N' to clean up

   MISMATCH (declare stdcall fn as cdecl):
     both clean up the same N bytes → ESP drifts by N every call → crash
```
