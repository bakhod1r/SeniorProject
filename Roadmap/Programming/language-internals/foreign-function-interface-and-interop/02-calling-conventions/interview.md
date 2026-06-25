# Calling Conventions — Interview Questions

> **Topic:** [Calling Conventions](README.md)
> **Focus:** Conceptual foundations, platform-specific ABIs (SysV AMD64, Windows x64, AArch64, x86 cdecl/stdcall/fastcall), tricky traps, and design judgment for FFI boundaries.

---

## Introduction

A calling convention is the binary contract between a caller and a callee: which registers hold arguments, where the return value lives, who cleans the stack, which registers must survive a call, and how the stack is aligned. Interviewers probe this topic because it sits exactly where compilers, operating systems, and foreign-function interfaces meet — and because the failures are subtle (shifted fields, garbage floats, stack smashes frames away) rather than obvious crashes. A strong candidate can name the argument registers for the major ABIs, explain *why* a struct's layout decides whether it travels in registers or memory, and reason about what physically happens to the stack when a convention is mismatched.

These questions are grouped into four bands: **Conceptual** (what a convention is and why it exists), **Platform-Specific** (SysV AMD64, Windows x64, AArch64, and 32-bit x86 cdecl/stdcall/fastcall), **Tricky-Trap** (the cases that corrupt silently), and **Design** (FFI and tooling judgment). Answers are written to be said aloud in two to four sentences.

---

## Table of Contents

- [Conceptual](#conceptual) — Q1–Q9
- [Platform-Specific](#platform-specific) — Q10–Q21
- [Tricky-Trap](#tricky-trap) — Q22–Q28
- [Design](#design) — Q29–Q32

---

## Conceptual

### Question 1
**What is a calling convention, and what does it actually specify?**

It is the binary contract between caller and callee for a function call. It specifies: which registers (or stack slots) hold each argument, where the return value is placed, who is responsible for cleaning up stack arguments, which registers are caller-saved versus callee-saved, the required stack alignment at a call, and how aggregates and variadic arguments are handled. Both sides must agree exactly, or the call corrupts state.

### Question 2
**Why do calling conventions exist at all — couldn't the compiler just decide per call?**

Within a single compilation unit it could, and link-time optimization sometimes does. But conventions exist so that *separately compiled* code — different translation units, different compilers, the OS, and shared libraries — can interoperate. The convention is the stable interface that lets a function compiled today be called by code compiled years later by a different toolchain.

### Question 3
**What is the difference between caller-saved and callee-saved registers?**

Caller-saved (volatile) registers may be freely clobbered by the callee; if the caller needs their values after the call, it must save them first. Callee-saved (non-volatile) registers must be preserved by the callee — if it uses them, it saves them on entry and restores them before returning. The split balances who pays the save cost.

### Question 4
**Where do return values go?**

Scalar integers and pointers return in the primary integer register (`RAX` on x86-64, `X0` on AArch64); floating-point returns in the primary vector register (`XMM0` / `V0`). Small aggregates may return in a register pair. Large aggregates return via a hidden caller-allocated pointer (an out-parameter the ABI inserts).

### Question 5
**What does "passing a struct by value" require the ABI to decide?**

Whether the struct fits in registers and, if so, which register file each part uses (integer vs vector), or whether it is too large/awkward and must travel in memory. The decision depends on size, alignment, and field types — and the rules differ sharply between ABIs.

### Question 6
**Why is stack alignment part of the convention?**

Compilers place aligned locals and emit aligned SIMD instructions (`movaps`) that fault if the operand isn't 16-byte aligned. The convention guarantees a known alignment at each `call` (e.g., `RSP % 16 == 0` on x86-64) so the callee can rely on it. Break it and the callee faults on an aligned access — often far from the call.

### Question 7
**What are variadic functions, and why are they special for the ABI?**

A variadic function (`printf(const char*, ...)`) takes a variable number of arguments the prototype doesn't fully describe. The callee walks them with `<stdarg.h>` machinery, which means the convention must define how the *unprototyped* arguments are passed and how the callee recovers them — typically by spilling argument registers into a save area the callee indexes.

### Question 8
**What are default argument promotions, and why do they matter here?**

Arguments passed through `...` are promoted: `float`→`double`, and integer types narrower than `int`→`int`. So `va_arg(ap, float)` is undefined; you must read `double`. This matters because a mismatched `va_arg` type desynchronizes the cursor and corrupts every later fetch.

### Question 9
**How does the calling convention relate to name decoration / mangling?**

The two are complementary halves of the binary contract. On 32-bit Windows the symbol name itself encodes the convention (stdcall as `_Name@N`, cdecl as `_Name`), which lets the linker catch some mismatches. C++ mangling encodes the full parameter types. The convention governs *how* the call happens; the decorated name governs *whether the linker lets you* call it.

---

## Platform-Specific

### Question 10
**What are the first integer-argument registers on SysV AMD64 (Linux/macOS/BSD)?**

In order: `RDI`, `RSI`, `RDX`, `RCX`, `R8`, `R9`. Floating-point arguments use `XMM0`–`XMM7`. Further arguments spill to the stack. The integer and SSE register sequences advance independently.

### Question 11
**What are the first integer-argument registers on Windows x64?**

`RCX`, `RDX`, `R8`, `R9` — only four. Floating-point uses `XMM0`–`XMM3`, and crucially the integer and vector positions are *coupled*: the Nth argument uses either the Nth integer register or the Nth XMM register, not an independent sequence. Everything beyond four spills to the stack.

### Question 12
**What is Windows x64 "shadow space" (home space)?**

The caller must reserve 32 bytes of stack above the return address before every call, even if the callee takes fewer than four arguments. The callee may spill its four register parameters (`RCX/RDX/R8/R9`) into this home area. Forgetting it lets the callee's spills overwrite the caller's frame.

### Question 13
**What is the SysV red zone?**

A 128-byte region below `RSP` that a leaf function (one that calls nothing) may use as scratch without adjusting `RSP`, saving a stack-pointer adjustment in hot leaves. Anything that writes below `RSP` asynchronously — signal handlers, kernel entry — must skip those 128 bytes or it clobbers the interrupted function's data.

### Question 14
**How does SysV classify a struct passed by value?**

If it's larger than 16 bytes (or has misaligned fields), the whole thing is MEMORY → passed on the stack. Otherwise it splits into one or two 8-byte "eightbytes"; each eightbyte is SSE if all its fields are float/double, otherwise INTEGER (a mix in one eightbyte merges to INTEGER). Each eightbyte then consumes the next integer or XMM register.

### Question 15
**On SysV, how is `struct { float x, y; }` passed?**

In one XMM register. Both floats fit in a single all-float eightbyte, classified SSE, packed into the low 64 bits of one XMM. It is *not* split across `XMM0` and `XMM1`.

### Question 16
**On SysV, how is `struct { long a; double b; }` passed?**

Split across two register files: the `long` eightbyte is INTEGER → `RDI`, the `double` eightbyte is SSE → `XMM0`. One struct argument occupies both an integer and a vector register.

### Question 17
**How does Windows x64 pass a struct by value, and how does that differ from SysV?**

Windows has no eightbyte classification. A struct is passed by value in one register *only if its size is exactly 1, 2, 4, or 8 bytes*; anything else is passed by reference — the caller copies it and passes a pointer. So a 16-byte two-double struct rides in two XMM registers on SysV but as a pointer in `RCX` on Windows.

### Question 18
**What is an HFA on AArch64?**

A Homogeneous Floating-point Aggregate: a struct of up to four members all of the same floating/vector type. It is passed in consecutive `V` registers — so `struct { float x, y, z; }` goes in `V0, V1, V2`. Other small aggregates use `X` registers; larger ones are passed indirectly.

### Question 19
**How does AArch64 return a large struct, and why is it cleaner than x86-64?**

Through the dedicated indirect-result register `X8`: the caller puts the result address in `X8` before the call. Because `X8` is separate from the argument registers `X0–X7`, the real arguments are *not* shifted — unlike SysV/Win64, where the hidden return pointer consumes an argument register and shifts everything down.

### Question 20
**Explain x86 cdecl vs stdcall.**

Both push arguments on the stack (32-bit x86 has few registers). In **cdecl**, the caller cleans up the arguments after the call (`add esp, N`) — which is why cdecl supports varargs, since only the caller knows the count. In **stdcall**, the callee cleans up (`ret N`); it's the dominant Win32 API convention and produces slightly smaller call sites.

### Question 21
**What is x86 fastcall?**

A 32-bit convention that passes the first two integer/pointer arguments in registers (`ECX`, `EDX` in the Microsoft variant) and the rest on the stack, with the callee cleaning up like stdcall. It reduces stack traffic for small argument lists. Its name decoration uses a leading and embedded `@` (e.g., `@Name@N`).

---

## Tricky-Trap

### Question 22
**A function returns a 64-byte struct and takes one `int` argument. Which register holds the `int` on SysV?**

`RSI`, not `RDI`. The 64-byte return is MEMORY class, so the ABI inserts a hidden `sret` pointer as the implicit first argument in `RDI`, shifting the real `int` argument down to `RSI`. The function writes the result through `RDI` and echoes that pointer in `RAX`.

### Question 23
**You call a variadic function through a `void(*)()` cast. Integer arguments print fine but `%f` prints garbage on Linux. Why?**

The cast erased the variadic prototype, so the compiler no longer emits `mov al, N` — the `AL` register, which tells the callee how many XMM registers to spill into its save area. With `AL` effectively zero, the `double` in `XMM0` is never saved, and `va_arg(ap, double)` reads stale stack memory.

### Question 24
**Code works at `-O0` but crashes inside `memcpy`/`std::vector` at `-O2`. The trampoline is hand-written. What's the likely cause?**

The trampoline left `RSP` misaligned at the `call` (e.g., an odd number of `push`es). At `-O0` the callee uses byte-wise/unaligned accesses, so it survives; at `-O2` the optimizer emits an aligned `movaps`/`movdqa` to a 16-byte-aligned local that is now off by 8, faulting with `SIGSEGV`. Fix the push count or `sub rsp, 8`.

### Question 25
**You declare a Win32 stdcall function as cdecl and call it. Walk through what happens to the stack.**

The caller pushes the arguments and calls. The stdcall callee runs and executes `ret N`, popping the return address *and* the N argument bytes. Back in the caller, the (mistaken) cdecl cleanup runs `add esp, N` again — so the arguments are removed twice and `ESP` ends up N bytes too high. Subsequent stack references are off; a later `ret` jumps to a garbage address and crashes, usually not at the call site.

### Question 26
**A trampoline uses `RBX` as scratch and the caller's loop counter gets corrupted. Why?**

`RBX` is callee-saved on SysV. The caller was entitled to find it unchanged across the call and had pinned its loop counter there. The trampoline clobbered it without push/restore, so the corruption appears in the *caller's* frame — frames away from the actual bug.

### Question 27
**Why does `struct { int a; float b; }` (8 bytes) ride entirely in `RDI` on SysV, even though it has a float?**

Both fields fall within a single eightbyte. The classification merges per-field classes within an eightbyte, and a mix of INTEGER and SSE merges to INTEGER. So the whole 8-byte struct — including the float — is passed in one integer register, `RDI`.

### Question 28
**A C++ function returns a type with a non-trivial destructor by value. How is it actually returned, regardless of size?**

Always in memory, via a hidden caller-provided pointer — even if it would otherwise be small enough for registers. The caller must construct/destruct the object on a stable address, so the ABI mandates the out-pointer form. This is also what makes guaranteed copy elision (RVO) possible: the object is built directly in the caller's slot.

---

## Design

### Question 29
**Why should an FFI layer prefer passing pointers to structs rather than structs by value?**

A pointer is just an integer argument on every ABI, so it sidesteps the entire classification machinery, the `sret` shift, and the SysV-vs-Windows divergence. By-value aggregates drag in platform-specific rules that a marshaller must reimplement exactly. Pointers make the boundary trivially portable.

### Question 30
**What's the most robust way to call a foreign function with complex argument/return types, and why?**

Generate a small C shim with the real signature and call it through a uniform pointer-based interface. The C compiler then applies the correct classification, `sret`, `AL`, alignment, and save-discipline for whatever target it's compiled on — so you never reimplement the ABI by hand. This is the approach cgo and most production interop layers take.

### Question 31
**How should an FFI layer handle variadic functions?**

Avoid calling them directly. Route through the `v`-suffixed sibling that takes a `va_list` (`vprintf`, `vsnprintf`), or generate a fixed-arity C shim, so the compiler owns the `AL` rule and the register save area. Dynamic FFI runtimes (libffi) must additionally be told which trailing arguments are variadic and their promoted types.

### Question 32
**When must one binary speak two calling conventions, and how do you do it on GCC/Clang?**

When a SysV program calls Windows code (Wine/emulation), or a bootloader calls UEFI firmware (Microsoft ABI), or you link an object compiled for the other platform. You apply `__attribute__((ms_abi))` or `__attribute__((sysv_abi))` to the exact boundary function, which makes the compiler emit the foreign argument registers, callee-saved set, struct model, and shadow-space/red-zone behavior for that single function — and you apply it only at the boundary, never in the program's interior.

---

## Closing Note

If you can name the argument registers for SysV, Windows x64, and AArch64; explain the SysV eightbyte classification and predict where `struct {float x,y}` and `struct {long a; double b}` land; describe `sret` and its argument shift; set the `AL` register for a variadic call; and trace the stack drift of a stdcall-as-cdecl mismatch — you understand calling conventions at the depth interviewers are probing for. The unifying theme across every answer is that the convention is an *exact* binary contract, and FFI is correct only when it encodes that contract precisely.
