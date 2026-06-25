# Stack Management & Unwinding — Middle Level

> **Topic:** [Stack Management & Unwinding](README.md)
> **Focus:** Calling conventions and exact frame layout — the red zone, shadow space, caller/callee-saved registers, and why omitting the frame pointer means stack walking now needs a *table*.

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

---

## Introduction

> Focus: **Exactly how is a stack frame laid out, who is responsible for saving which register, and what changes when the compiler drops the frame pointer?**

At the junior level the frame was "a block with a return address, a saved frame pointer, and locals." That's the right shape, but the *details* are dictated by a contract called the **calling convention** (also: the *ABI*, application binary interface). The calling convention is the agreement between caller and callee about: which registers carry arguments, which carries the return value, which registers the callee must preserve, where the return address goes, and how the stack must be aligned. Two functions compiled by *different* compilers can call each other only because they both obey the same ABI.

This level pulls the frame apart precisely. You'll meet two platform-specific oddities that trip up everyone: the **red zone** on the System V (Linux/macOS) ABI — 128 bytes *below* the stack pointer that a leaf function may scribble in without adjusting SP — and **shadow space** on the Windows x64 ABI — 32 bytes the caller must reserve for the callee. You'll see the split between **caller-saved** and **callee-saved** registers and why it exists. And you'll meet the single most consequential optimization in this whole topic: **frame-pointer omission** (`-fomit-frame-pointer`), which frees up `rbp` as a general register but *destroys the simple frame-pointer chain that stack walkers rely on* — setting up the need for unwind tables, the headline subject of `senior.md`.

In one sentence: **the calling convention is the law that says where every byte of a frame goes, and frame-pointer omission is the optimization that makes obeying-the-law no longer enough to find your way home.**

> 🎓 **Why this matters for a middle engineer:** When your profiler shows a flame graph that's all `[unknown]`, when your crash dump has a truncated backtrace, when FFI between two languages corrupts the stack — the cause is almost always an ABI mismatch or missing frame pointers. Understanding the convention turns these from mysteries into a checklist.

This page covers: the SysV x86-64 and Win64 conventions, the precise frame layout, the red zone, shadow space, caller/callee-saved registers, stack alignment, leaf-function optimizations, and frame-pointer omission with its consequences for stack walking. `senior.md` then shows the *fix* for FP omission: DWARF CFI and Windows `.pdata`/`.xdata` unwind tables.

---

## Prerequisites

- **Required:** The junior file — what a frame, return address, SP, and FP are.
- **Required:** Comfort reading a little x86-64 assembly (`push`, `mov`, `sub`, `call`, `ret`).
- **Required:** What a CPU register is and that there are a fixed number of them.
- **Helpful:** Having compiled C with `gcc -S` / `clang -S` and looked at the output.
- **Helpful:** Awareness that 64-bit ABIs pass the first several arguments in *registers*, not on the stack.

You do **not** yet need:

- DWARF CFI / `.eh_frame` internals (that's `senior.md`).
- Exception unwinding and personality routines (that's `senior.md`).
- Growable stacks, guard pages, GC stack maps (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Calling convention / ABI** | The binary contract for how functions call each other: argument registers, return register, who saves what, stack alignment, return-address placement. |
| **System V AMD64 ABI** | The convention used on Linux, macOS, and most Unix on x86-64. |
| **Windows x64 ABI** | Microsoft's convention on 64-bit Windows. Differs notably from SysV. |
| **Caller-saved (volatile)** | Registers the *callee* may freely clobber. If the caller wants them preserved, the caller must save them before the call. |
| **Callee-saved (non-volatile)** | Registers the *callee* must restore to their original value before returning. |
| **Red zone** | (SysV) 128 bytes *below* `rsp` that a leaf function may use without moving `rsp`. Signal handlers must not clobber it. |
| **Shadow space / home space** | (Win64) 32 bytes the *caller* allocates above the return address so the callee can spill its 4 register arguments. |
| **Stack alignment** | The ABI requirement that `rsp` be 16-byte aligned at the point of a `call` (so it's 16-aligned + 8 on entry, after the return address is pushed). |
| **Leaf function** | A function that calls no other function. Can skip frame setup and use the red zone. |
| **Prologue / Epilogue** | The instructions that build / tear down a frame. |
| **Register spill** | Storing a register's value to the stack because there aren't enough registers. |
| **Frame-pointer omission (FPO)** | Compiling without a dedicated frame pointer (`rbp` becomes a general register). Speeds code up; breaks naive stack walking. |
| **`-fomit-frame-pointer`** | The GCC/Clang flag that enables FPO. On by default at `-O1` and above for many targets. |
| **CFA (Canonical Frame Address)** | A reference address for a frame used by unwind info; conceptually the value of `rsp` just before the `call` that entered this function. |

---

## Core Concepts

### 1. The Calling Convention Is a Contract

When `caller` calls `callee`, both sides must agree on:

- **Where arguments go.** SysV passes the first 6 integer/pointer args in `rdi, rsi, rdx, rcx, r8, r9`, and the first 8 floating-point args in `xmm0–xmm7`. Win64 passes the first 4 args in `rcx, rdx, r8, r9` (integers) or `xmm0–xmm3` (floats), *by position* — the second arg is always in `rdx`/`xmm1` regardless of type.
- **Where the return value goes.** `rax` (and `rdx` for 128-bit), or `xmm0` for floats, on both conventions.
- **Who preserves which registers** (next section).
- **Stack alignment** at the call site.

Two compilers can interoperate *only because* they both implement the same convention. This is also why FFI (calling C from Go, Rust, Python via ctypes) requires care: you're manually honoring the ABI across a language boundary.

### 2. Caller-Saved vs Callee-Saved

There are not enough registers for every function to have its own private set, so the ABI splits them:

- **Callee-saved (non-volatile):** the callee promises to leave them exactly as it found them. If it wants to use one, it must `push` it in the prologue and `pop` it in the epilogue. On SysV: `rbx, rbp, r12–r15`.
- **Caller-saved (volatile):** the callee may trash them freely. If the *caller* has a live value in one across a call, *the caller* must save it first. On SysV: `rax, rcx, rdx, rsi, rdi, r8–r11`.

This split is a performance bargain: short functions that don't call anything can use the volatile registers without any save/restore overhead, and only pay to preserve callee-saved registers if they actually need them.

### 3. Precise SysV Frame Layout

Here is a typical SysV frame for a function that *does* use a frame pointer and *does* call other functions:

```text
   high addresses
   +-----------------------------+
   |  7th, 8th, ... stack args   |  (args beyond the 6 register args)
   +-----------------------------+
   |  return address             |  <- pushed by caller's `call`
   +-----------------------------+
   |  saved rbp (caller's FP)    |  <- prologue: push rbp
   +-----------------------------+  <- rbp points here
   |  saved callee-saved regs    |  (rbx, r12-r15 if this fn uses them)
   |  local variables            |
   |  spilled temporaries        |
   +-----------------------------+
   |  outgoing arg area / pad    |  (kept 16-byte aligned for next call)
   +-----------------------------+  <- rsp points here
   |  ...128-byte RED ZONE...    |  (below rsp; only safe in leaf fns)
   +-----------------------------+
   low addresses
```

Locals are addressed relative to `rbp` (e.g. `[rbp-8]`), which stays put even as `rsp` moves during the function.

### 4. The Red Zone (SysV)

On SysV, the 128 bytes *immediately below* `rsp` are the **red zone**. A **leaf function** (one that calls nothing) may store its locals there *without bothering to subtract from `rsp` at all* — saving two instructions. This is safe only because nothing else will touch that region: there's no `call` to push a return address over it, and the kernel guarantees signal handlers won't run on the user stack's red zone (they allocate below it).

```asm
; A SysV leaf function using the red zone — note: NO `sub rsp, N`.
leaf:
    mov   [rsp-8], rdi      ; stash arg in the red zone
    mov   rax, [rsp-8]
    ret                     ; rsp never moved
```

**Pitfall:** code that *does* run asynchronously on the stack (some signal handlers, interrupt-like contexts, hand-written assembly) can corrupt the red zone. Kernels compile with `-mno-red-zone` for exactly this reason.

### 5. Shadow Space (Win64)

Windows x64 has no red zone. Instead it has the opposite idea: **shadow space** (a.k.a. *home space*). The *caller* must allocate **32 bytes** on the stack (room for 4 eightbyte slots) *before* the return address, even though the 4 arguments are passed in registers. The callee may use these 32 bytes to spill `rcx, rdx, r8, r9` if it wants their values on the stack (e.g. for debugging or because it's variadic).

```text
   Win64 at the moment a callee is entered:
   +-----------------------------+
   |  5th, 6th, ... stack args   |
   +-----------------------------+
   |  shadow space for arg4 (r9) |
   |  shadow space for arg3 (r8) |
   |  shadow space for arg2 (rdx)|
   |  shadow space for arg1 (rcx)|  <- caller reserved these 32 bytes
   +-----------------------------+
   |  return address             |  <- rsp on entry
   +-----------------------------+
```

Forgetting to reserve shadow space when hand-writing Win64 assembly or doing FFI is a classic stack-corruption bug.

### 6. Stack Alignment

Both conventions require `rsp` to be **16-byte aligned at the point of a `call`**. Because `call` then pushes the 8-byte return address, a function is *entered* with `rsp ≡ 8 (mod 16)`. The prologue's `push rbp` makes it 16-aligned again. Misalignment doesn't always crash, but SIMD instructions (`movaps`, etc.) that *require* 16-byte alignment will fault — a notoriously confusing bug when it shows up only on certain code paths.

### 7. Frame-Pointer Omission — and Why It Breaks Walking

`rbp` is a perfectly good general-purpose register. If the compiler doesn't *need* it as a frame anchor — because it can address all locals relative to `rsp` instead — it can free `rbp` for computation. That's **frame-pointer omission**, enabled by `-fomit-frame-pointer` (default at `-O1`+ on many targets). The win: one more register, and two fewer instructions per call (`push rbp` / `pop rbp`).

The cost is fundamental to this whole topic. The naive stack walk — "read the saved `rbp`, that's the next frame; the slot next to it is the return address; repeat" — **depends on the frame-pointer chain existing**. With FPO there is no chain: `rbp` holds an unrelated computed value, and the saved-FP slots aren't there. A profiler or debugger walking the stack the naive way will read garbage and either stop, produce a bogus trace, or crash.

```asm
; WITH frame pointer (walkable by following rbp):
f:  push rbp
    mov  rbp, rsp
    sub  rsp, 32
    ; locals at [rbp-8], [rbp-16] ...
    leave            ; mov rsp,rbp ; pop rbp
    ret

; WITH -fomit-frame-pointer (no rbp chain; rbp is free):
f:  sub  rsp, 40
    ; locals at [rsp+0], [rsp+8] ...  (relative to a moving rsp!)
    add  rsp, 40
    ret
```

So how does anything walk an FPO stack? **Unwind tables**: side data, emitted by the compiler, that says "at this instruction offset, the return address is at `rsp + N` and the CFA is `rsp + M`." That's DWARF CFI on Unix and `.pdata`/`.xdata` on Windows — the entire subject of `senior.md`. The key insight to carry forward: *with FPO, finding the caller is a lookup, not a pointer-chase.*

---

## Real-World Analogies

- **The red zone is a "scratchpad you don't have to clock in for."** A leaf worker can scribble on the margin of their own desk without filing paperwork (moving `rsp`), because no one else will use that margin while they're working.

- **Shadow space is "a reserved parking spot the visitor pays for."** Even though the visitor (callee) arrives by car (arguments in registers), the host (caller) must reserve 4 parking spots in case the visitor wants to park.

- **Caller-saved vs callee-saved is a "who cleans the borrowed tool" rule.** Some tools you must return spotless (callee-saved); others you can use up and the owner re-sharpens them after lending (caller-saved). The contract avoids both of you cleaning the same tool.

- **Frame-pointer omission is "removing the handrail to widen the stairs."** Faster to walk normally, but now anyone trying to feel their way down in the dark (a stack walker) needs a printed map (unwind tables) instead of the rail.

---

## Mental Models

- **"The ABI is the only reason separately-compiled code works."** Every register choice and stack slot is a clause in that contract.

- **"`rbp` is a luxury, not a law."** A frame pointer is a *convention for walkability*, not a hardware requirement. The compiler will spend it on speed unless told otherwise.

- **"Red zone = 'I'm a leaf, I can be lazy.' Shadow space = 'I'm a caller, I must be generous.'"** Two conventions, opposite philosophies about who reserves space.

- **"Without a frame pointer, the stack has no inherent structure — only the unwind table knows the shape."** This is the bridge to the senior level.

- **"Alignment bugs hide until SIMD shows up."** Misaligned `rsp` is invisible to scalar code and fatal to aligned vector loads.

---

## Code Examples

### Example 1: See the convention with your own compiler

```bash
# Compile to assembly and read the prologue/epilogue and arg registers.
cat > frame.c <<'EOF'
long add3(long a, long b, long c) {
    long sum = a + b + c;   // a in rdi, b in rsi, c in rdx (SysV)
    return sum;             // result in rax
}
EOF
gcc -O0 -S -masm=intel frame.c -o frame_O0.s   # frame pointer kept
gcc -O2 -S -masm=intel frame.c -o frame_O2.s   # FPO likely; rbp gone
diff frame_O0.s frame_O2.s
```

At `-O0` you'll see the `push rbp; mov rbp, rsp` prologue. At `-O2`, for a small leaf like this, the frame may vanish entirely (locals stay in registers, no stack used at all).

### Example 2: Force the frame pointer back on

```bash
# -O2 speed, but keep walkable stacks for the profiler:
gcc -O2 -fno-omit-frame-pointer -S -masm=intel frame.c -o frame_fp.s
```

This is the single most common flag in modern "make `perf` work again" guidance. You give up one register and a couple of instructions per call in exchange for cheap, reliable stack walking. (Why this is "back in fashion" is covered in `professional.md`.)

### Example 3: The red zone, made visible

```c
// A leaf function: gcc -O2 may use the red zone (no `sub rsp`).
// Compile with and without -mno-red-zone and diff the assembly.
long square(long x) {
    long tmp = x * x;   // small leaf: may live in red zone or just a register
    return tmp;
}
// gcc -O2 -S -masm=intel redzone.c
// gcc -O2 -mno-red-zone -S -masm=intel redzone.c   <- kernel-style build
```

### Example 4: An FFI ABI bug (the abstract shape)

```text
A Go program calls a C function via cgo. The C function is declared in Go
with the wrong argument count. Go arranges arguments per the SysV ABI for
the signature *it believes*; C reads them per the signature *it* was
compiled with. The two disagree about which register holds which argument,
or about stack-arg layout. Result: garbage arguments, or a corrupted stack
and a crash whose backtrace is nonsense — because the corruption broke the
very frame chain the debugger walks.

Lesson: an ABI mismatch corrupts the structure the backtrace depends on,
so the symptom (bad trace) is downstream of the real cause (bad contract).
```

### Example 5: Alignment matters for SIMD

```c
// If rsp is misaligned at a call (e.g. hand-written asm forgot the +8),
// a callee that does an aligned 16-byte vector load can fault:
#include <immintrin.h>
void uses_simd(float *p) {
    __m128 v = _mm_load_ps(p);   // needs 16-byte alignment
    // ... if the compiler also aligns a stack temporary to 16 and rsp was
    //     misaligned coming in, the aligned spill/reload can #GP fault.
    (void)v;
}
```

---

## Pros & Cons

**Keeping a frame pointer (`-fno-omit-frame-pointer`):**

| Pro | Con |
|-----|-----|
| Trivial, reliable stack walking (profilers, debuggers, crash dumps). | One fewer general-purpose register. |
| No unwind-table lookup needed at sample time → cheap, accurate `perf`. | A couple of extra instructions per call. |
| Crash backtraces work even when unwind info is stripped. | Marginal code-size and speed cost (~1% on many workloads). |

**Omitting the frame pointer (`-fomit-frame-pointer`):**

| Pro | Con |
|-----|-----|
| Extra register → faster, smaller code. | Naive stack walking is impossible; needs unwind tables. |
| The historical default at `-O1`+. | `perf` flame graphs become `[unknown]` without DWARF/LBR. |
| | Harder, slower stack walks (DWARF interpretation) at profiling time. |

---

## Use Cases

- **FFI / interop** between languages — you must honor the ABI by hand (cgo, JNI, ctypes, Rust `extern "C"`).
- **Hand-written assembly** — you are personally responsible for alignment, shadow space, and callee-saved registers.
- **Tuning profilability** — choosing `-fno-omit-frame-pointer` (or relying on DWARF/LBR) to get usable flame graphs.
- **Debugging stack corruption** — recognizing the symptoms of a blown convention (nonsense backtraces, args off by one register).
- **Kernel / low-level code** — disabling the red zone (`-mno-red-zone`) where async contexts run on the stack.

---

## Coding Patterns

**Pattern: Build with frame pointers in performance-critical, profiled services.** The whole industry (Linux distros, large server fleets) has been re-enabling `-fno-omit-frame-pointer` because reliable profiling is worth the ~1%. Make it your default for code you'll profile.

**Pattern: When writing assembly, honor the convention explicitly.**

```asm
; SysV: preserve callee-saved regs you use; keep 16-byte alignment.
my_asm:
    push rbx            ; rbx is callee-saved -> must restore it
    sub  rsp, 8         ; realign: entry rsp is 16k+8; push made it 16k;
                        ; we need 16k+8 again before our own `call`... count carefully!
    ; ... body, calls ...
    add  rsp, 8
    pop  rbx
    ret
```

**Pattern: For Win64 FFI/asm, always reserve 32 bytes of shadow space before a call**, even if you pass everything in registers. Forgetting it lets the callee's spills overwrite *your* stack.

**Pattern: Verify your ABI assumptions by reading the generated assembly.** `gcc -S -masm=intel` (or `objdump -d`) is the ground truth. Don't guess which register an argument is in — look.

---

## Best Practices

1. **Default to `-fno-omit-frame-pointer` for anything you profile.** The reliability of flame graphs and crash traces is worth the small cost.
2. **Never trust a backtrace from an FPO build without DWARF or LBR backing it.** It may be silently truncated or wrong.
3. **Match the ABI exactly at FFI boundaries.** Argument count, types, and the `extern "C"` convention must agree on both sides.
4. **Reserve shadow space on Win64; respect the red zone on SysV.** Disable the red zone (`-mno-red-zone`) wherever async code runs on the user stack.
5. **Keep `rsp` 16-byte aligned before every `call`** in hand-written assembly. Alignment bugs surface only under SIMD and are miserable to diagnose.
6. **Save and restore every callee-saved register you touch** in assembly. Forgetting clobbers the caller and produces "impossible" corruption.

---

## Edge Cases & Pitfalls

- **Mixed FPO / non-FPO code.** A stack walk that crosses from a frame-pointer build into an FPO library (or vice versa) can desync mid-walk, producing a plausible-looking but wrong trace.
- **Red-zone corruption by signal/interrupt code.** Async code that uses the stack below `rsp` silently smashes a leaf function's locals. Symptom: rare, data-dependent wrong answers.
- **Forgetting shadow space on Win64.** The callee spills its register args over your stack data. Corruption with no obvious cause.
- **Off-by-8 alignment in assembly.** Everything works until a SIMD instruction faults. The arithmetic of "entry is 16k+8, each push subtracts 8" is easy to get wrong.
- **Variadic functions need the convention's extra rules.** On SysV, `al` must hold the number of vector registers used for a variadic call; getting it wrong corrupts argument passing.
- **Assuming `rbp` is always the frame pointer.** In FPO builds `rbp` holds arbitrary data. Tools that hardcode "follow `rbp`" produce garbage.
- **Tail calls reuse the frame.** A tail-call-optimized call replaces the current frame instead of adding one — so the *caller* may be missing from the backtrace (more in `senior.md`).

---

## Cheat Sheet

```text
SYSV AMD64 (Linux/macOS)
  int args:   rdi rsi rdx rcx r8 r9   (then stack)
  fp args:    xmm0..xmm7
  return:     rax (rdx:rax for 128b), xmm0 for fp
  callee-saved: rbx rbp r12 r13 r14 r15
  caller-saved: rax rcx rdx rsi rdi r8 r9 r10 r11
  RED ZONE:   128 bytes below rsp, leaf-only
  align:      rsp 16-byte aligned at `call`

WINDOWS x64
  int args:   rcx rdx r8 r9            (by position; then stack)
  fp args:    xmm0..xmm3
  return:     rax / xmm0
  callee-saved: rbx rbp rdi rsi r12-r15 rsp + xmm6-xmm15
  SHADOW SPACE: caller reserves 32 bytes before the call
  NO red zone

FRAME POINTER
  kept:   push rbp; mov rbp,rsp  -> walkable by chasing rbp
  omitted (-fomit-frame-pointer): rbp is general; walking needs unwind tables
  fix profilability: compile with -fno-omit-frame-pointer

GOLDEN RULES
  - honor the ABI exactly at FFI / asm boundaries
  - keep rsp 16-aligned before every call (SIMD will punish you otherwise)
  - save callee-saved regs you clobber
  - no frame pointer => backtrace is a LOOKUP (DWARF/.pdata), not a chase
```

---

## Summary

The **calling convention (ABI)** is the binary contract that fixes every detail a frame's junior-level shape left open: which registers carry arguments (`rdi…r9` on SysV, `rcx…r9` on Win64), where the return value goes (`rax`/`xmm0`), the split between **caller-saved** and **callee-saved** registers, the 16-byte **stack alignment** at each call, the SysV **red zone** (128 bytes a leaf may use for free), and the Win64 **shadow space** (32 bytes the caller must reserve). Locals are addressed off `rbp` when a frame pointer is kept, or off a moving `rsp` when it isn't.

The pivotal idea at this level is **frame-pointer omission**. Freeing `rbp` makes code faster but removes the linked chain that naive stack walking depends on — so finding a caller becomes a *table lookup* rather than a pointer-chase. That table is DWARF CFI on Unix and `.pdata`/`.xdata` on Windows, and reconstructing caller frames from it — for debuggers, profilers, and exception unwinding — is exactly what `senior.md` builds next.

---

## Further Reading

- *System V Application Binary Interface, AMD64 Architecture Processor Supplement* — the authoritative SysV spec (argument registers, red zone, alignment).
- Microsoft's *x64 calling convention* and *x64 prolog and epilog* documentation (shadow space, unwind data).
- Agner Fog, *Calling conventions for different C++ compilers and operating systems*.
- The GCC/Clang manuals on `-fomit-frame-pointer` and `-mno-red-zone`.
- The next files: `senior.md` (DWARF CFI / `.eh_frame`, exception unwinding) and `professional.md` (growable stacks, guard pages, profiling at scale).
