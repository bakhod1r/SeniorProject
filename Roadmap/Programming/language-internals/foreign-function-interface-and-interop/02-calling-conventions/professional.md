# Calling Conventions — Professional Level

> **Topic:** [Calling Conventions](README.md)
> **Focus:** Owning the ABI boundary in production — variadic fragility, struct classification surprises, `sret`/RVO, save-discipline, alignment faults, red zone vs shadow space, convention mismatch corruption, and how FFI glue must encode the convention exactly.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Variadic ABI in Production](#variadic-abi-in-production)
5. [Struct-by-Value Classification Surprises](#struct-by-value-classification-surprises)
6. [`sret` and RVO: The Hidden Return Pointer](#sret-and-rvo-the-hidden-return-pointer)
7. [Caller- vs Callee-Saved Discipline](#caller--vs-callee-saved-discipline)
8. [Stack Alignment and `movaps` Faults](#stack-alignment-and-movaps-faults)
9. [The Red Zone vs Windows Shadow Space](#the-red-zone-vs-windows-shadow-space)
10. [Convention Mismatch: stdcall as cdecl](#convention-mismatch-stdcall-as-cdecl)
11. [Mixing ABIs in One Binary: `ms_abi` / `sysv_abi`](#mixing-abis-in-one-binary-ms_abi--sysv_abi)
12. [How FFI Glue Must Know the Convention](#how-ffi-glue-must-know-the-convention)
13. [Production War Stories](#production-war-stories)
14. [Best Practices](#best-practices)
15. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

> Focus: **At this tier the calling convention is a production liability you own, not a textbook curiosity.** The bugs that reach you do not crash at the call site; they corrupt a struct field, scramble a `double`, smash the stack two frames down, or fault on a SIMD store inside `memcpy` — and they reproduce only on one OS, one optimization level, or one core count.

The senior tier taught you the *mechanism*: the SysV INTEGER/SSE/MEMORY classification, the 16-byte rule, `sret`, and the variadic `AL` register. The professional tier is about what happens when that mechanism meets a real codebase under real load: a binding generator that misclassifies one struct in ten thousand, a hand-written assembly trampoline that forgot to align the stack before a `call`, a plugin compiled by a different vendor's toolchain that disagrees about who saves `RBX`, a `printf`-style logging API wrapped through a `void(*)()` cast that drops the prototype.

These failures share a signature: **the call returns, but the program is now wrong.** There is no segfault at the boundary. The damage shows up later — a metric reads garbage, a returned matrix has its second row shifted by eight bytes, a destructor runs on a pointer that was never a valid object, or a `movaps` deep inside an inlined `std::vector` copy faults with `SIGSEGV` on an address that is *almost* aligned. Diagnosing these requires you to read disassembly fluently, to know the exact register a hidden `sret` pointer occupies, and to understand why a 15-byte misalignment never crashes until the optimizer chooses an aligned SSE store.

This document is the field manual for that work. It covers variadic ABI as it actually behaves in production (and why `printf`-family FFI is perennially fragile), the struct classification cases that surprise even experienced engineers, the `sret`/RVO contract and its argument-shift, caller/callee save-discipline as a corruption source, the 16-byte stack alignment invariant and the `movaps` faults that punish violations, the red zone versus Windows shadow space, what literally happens to the stack when you call a `stdcall` function through a `cdecl` declaration, the `__attribute__((ms_abi))` / `((sysv_abi))` escape hatches for mixing ABIs in one image, and the central professional lesson: **FFI glue is correct only if it encodes the callee's convention exactly — and the cheapest way to guarantee that is to let the C compiler do it.**

> 🎓 **Why this matters at the professional level:** You own the interop layer, the JIT's call lowering, the plugin ABI policy, or the binding generator everyone else depends on. When a customer reports "works on Linux, garbage on Windows" or "fine at `-O0`, crashes at `-O2`," the root cause is almost always one of the items in this document. Your value is being the person who can name the failure mode from the symptom and the disassembly.

---

## Prerequisites

- **Required:** The senior tier — SysV eightbyte classification, the 16-byte rule, `sret`, the variadic `AL` rule, and the Windows by-reference-unless-1/2/4/8 model.
- **Required:** Fluent reading of x86-64 and (ideally) AArch64 disassembly: register files, `call`/`ret`, `push`/`pop`, `movaps`/`movups`, `sub rsp`.
- **Required:** C struct layout, `va_list`/`va_start`/`va_arg`, and how `<stdarg.h>` lowers.
- **Helpful:** Having shipped or maintained FFI glue (cgo, `bindgen`, P/Invoke, JNA/JNI, ctypes, a JIT call site).
- **Helpful:** Debugging weakly-ordered and optimization-sensitive corruption with `gdb`/`lldb`, `objdump`, and a sanitizer.

You do **not** need here:

- Symbol versioning, ABI compatibility policy across releases (separate topic).
- Name decoration / mangling in depth (its own topic; touched on only where the symbol name encodes the convention).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Variadic prologue / register save area** | The block a variadic callee fills from the argument registers (and `AL`-selected XMMs) so `va_arg` can index it later. |
| **`AL` rule** | SysV: the caller must set `AL` to the number of vector (XMM) registers used by variadic arguments. |
| **Default argument promotions** | Variadic args are promoted: `float`→`double`, sub-`int` integers→`int`. `va_arg(ap, float)` is undefined. |
| **`sret`** | Structure-return: caller-allocated storage whose pointer is passed implicitly (RDI on SysV, RCX on Win64), returned in RAX. |
| **(N)RVO** | (Named) Return Value Optimization — constructing the return object directly in the caller's `sret` slot, eliminating a copy. |
| **Caller-saved (volatile)** | Registers the *caller* must preserve across a call if it needs them (RAX, RCX, RDX, RSI, RDI, R8–R11 on SysV). |
| **Callee-saved (non-volatile)** | Registers the *callee* must restore before returning (RBX, RBP, R12–R15, and RSP on SysV). |
| **16-byte alignment invariant** | At a `call` instruction, `RSP % 16 == 0`; at function entry (after the return address is pushed) `RSP % 16 == 8`. |
| **`movaps`/`movdqa`** | Aligned 16-byte SSE moves; fault (`#GP`/`SIGSEGV`) if the operand is not 16-byte aligned. |
| **Red zone** | SysV: 128 bytes below RSP that leaf functions may use without adjusting RSP; signal handlers must respect it. |
| **Shadow space (home space)** | Win64: 32 bytes the caller reserves above the return address for the callee to spill its four register parameters. |
| **`ms_abi` / `sysv_abi`** | GCC/Clang function attributes forcing the Windows or SysV convention on a single function regardless of target. |

---

## Variadic ABI in Production

### How `printf` actually receives its arguments

A variadic function declares only its fixed parameters; everything after the `...` arrives "somehow." On SysV AMD64 the lowering is precise and the caller carries an obligation that is invisible in C source:

```c
printf("%d %.2f %s\n", 42, 3.14, name);
```

```asm
    lea   rdi, [fmt]          ; fixed arg: format        -> RDI
    mov   esi, 42             ; "%d"  (integer)          -> RSI
    movsd xmm0, [pi]          ; "%f"  (double)           -> XMM0
    mov   rdx, [name]         ; "%s"  (pointer)          -> RDX
    mov   al, 1               ; <-- one XMM register used by varargs
    call  printf
```

That `mov al, 1` is the **`AL` rule**: the caller must announce how many vector registers the variadic arguments consumed. The callee's prologue, when it executes `va_start`, spills the integer argument registers and *exactly `AL`* of the eight XMM registers into a register save area. `va_arg(ap, double)` then indexes that area. If `AL` says zero but a `double` actually rode in `XMM0`, the prologue never saves `XMM0`, and `va_arg` reads stale stack memory — garbage, not a crash.

### Why varargs FFI is fragile

The fragility is structural, not incidental:

1. **The `AL` obligation lives in the prototype, and FFI routinely loses the prototype.** Calling a variadic function through a non-variadic function pointer — `((void(*)())fn)(...)` or a generic `void*` trampoline — drops the variadic flag. The compiler no longer emits the `AL` setup. Integer-only calls survive by luck; the first floating argument breaks.
2. **`va_arg` types must match exactly, post-promotion.** `va_arg(ap, float)` is undefined; you must read `double`. A binding that marshals a 32-bit `float` desynchronizes the entire cursor, corrupting every subsequent fetch.
3. **The three ABIs disagree on the same `printf`.** SysV uses the `AL` rule and an XMM save area. Windows x64 passes floating variadic args in **both** the integer register *and* the XMM register (no `AL`), so a callee that reads either is satisfied. AArch64 has yet another variadic save-area layout (separate GP and FP/SIMD save regions). One construct, three contracts.
4. **Type erasure at the boundary.** FFI runtimes that build calls dynamically (libffi, ctypes, JNA) must be *told* which trailing arguments are variadic and their promoted types; they cannot infer it from a `void*`.

The professional rule: **never FFI a variadic function directly.** Route through the `v`-suffixed sibling that takes a `va_list` (`vprintf`, `vsnprintf`, `vfprintf`), which you construct deliberately, or generate a fixed-arity C shim. The `AL`/save-area machinery then becomes the compiler's problem on a fully prototyped call.

```c
// Deterministic FFI: wrap the va_list variant, not the variadic one.
int log_line(const char *fmt, ...) {
    va_list ap; va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof buf, fmt, ap);  // compiler owns AL/save area
    va_end(ap);
    return n;
}
```

---

## Struct-by-Value Classification Surprises

The senior tier introduced the SysV classification. In production the surprises are concentrated in a handful of shapes that misclassify under a naive marshaller. Memorize these; they are the field's most common struct-FFI corruptions.

### The 16-byte cliff and the per-eightbyte rule

```c
struct V2  { double x, y; };          // 16B: two SSE eightbytes -> XMM0, XMM1
struct V3  { double x, y, z; };       // 24B: > 16  -> MEMORY (stack), sret on return
struct M   { long a; double b; };     // 16B: INTEGER eightbyte + SSE eightbyte -> RDI + XMM0
struct Px  { int a; float b; };       //  8B: mixed in ONE eightbyte -> merge to INTEGER -> RDI
struct Pk  { float x, y; };           //  8B: all-float one eightbyte -> ONE XMM (packed pair)
```

Three traps fire here:

- **`V2` vs the platform.** Sixteen bytes of two doubles rides in **two XMM registers on SysV** but is passed **by reference (a pointer in RCX) on Windows x64**. A marshaller that copies SysV behavior to Win64 transposes the entire struct.
- **`Px` (the merge rule).** An `int` and a `float` in the *same* eightbyte merge to INTEGER — both ride in `RDI`. A per-field marshaller that puts the `float` in `XMM0` corrupts both fields.
- **`Pk` (packed floats).** Two `float`s in one all-float eightbyte ride in **one** XMM register (low 64 bits), not two. Assigning `x`→XMM0, `y`→XMM1 shifts the second field.

### The "add one field" ABI flip

The most dangerous property: **editing a struct silently changes the convention of every function that takes or returns it by value.**

```c
struct R { int a, b; };          // 8B  -> returned in RAX
struct R3 { int a, b, c; };      // 12B -> returned in RAX:RDX (two eightbytes)
struct R5 { int a,b,c,d,e; };    // 20B -> > 16 -> sret (hidden pointer, arg shift)
```

A teammate adds a debug counter to `R`, and now every cross-language caller that loaded the result from `RAX` reads a truncated or garbage value, because the function now returns via `sret`. No compiler warns across the FFI boundary. This is why structs that cross an FFI seam must be *frozen* — explicit padding, `static_assert(sizeof(...) == N)`, and a review rule forbidding casual edits.

### Unaligned and non-trivial members

An aggregate with an under-aligned field (e.g., `#pragma pack(1)`) classifies as MEMORY regardless of size on SysV. In C++, a struct with a non-trivial copy constructor or destructor is *always* passed and returned in memory (by an invisible reference) on both major ABIs, because the caller must be able to run the special member functions on a stable address. A binding generator that treats such a type as a trivial value will corrupt it.

---

## `sret` and RVO: The Hidden Return Pointer

When a function returns a MEMORY-class aggregate, no register can hold it. The ABI rewrites the function:

```c
struct Big { double m[8]; };       // 64 bytes
struct Big make(int seed);
```

becomes, at the machine level:

```c
// caller allocates the slot; passes its address as an implicit first argument
void make(struct Big *sret /* RDI */, int seed /* RSI */);
//   make() writes through RDI and returns RDI in RAX
```

Two consequences dominate production debugging:

1. **The argument shift.** The `sret` pointer consumes `RDI` (SysV) or `RCX` (Win64). The declared first argument moves to `RSI` / `RDX`. A hand-written caller or JIT that loads the first real argument into `RDI` *overwrites the return-slot pointer* — the callee then writes the result to whatever was in `RDI`, scribbling on caller memory.
2. **This is the (N)RVO mechanism.** C++'s guaranteed RVO is not magic; it is the compiler constructing the returned object *directly in the caller-provided `sret` slot*, so there is no copy on return. When you see RVO "eliminate a copy," what you are seeing is the ABI's hidden out-pointer being handed straight to the constructor.

```asm
; struct Big scaled(double k);  -- 64-byte return
    lea   rdi, [result_slot]    ; hidden sret pointer        -> RDI
    movsd xmm0, [k]             ; real first arg 'k' (SSE)   -> XMM0 (not shifted; SSE file)
    call  scaled                ; writes through RDI, echoes RDI in RAX
```

Note the subtlety: an *integer* first argument shifts to `RSI`, but a *floating* first argument stays in `XMM0` because `sret` only consumed an integer register. Tools must model the integer and SSE register files independently when accounting for the shift. AArch64 sidesteps the shift entirely by using a dedicated indirect-result register, `X8`, leaving `X0–X7` for real arguments.

---

## Caller- vs Callee-Saved Discipline

Every convention partitions the register file into **caller-saved (volatile)** and **callee-saved (non-volatile)** registers. The contract is symmetric and unforgiving:

- A **caller** that needs a value in a *volatile* register across a call must save it first; the callee is free to clobber it.
- A **callee** that wants to use a *non-volatile* register must save it on entry and restore it before `ret`.

SysV AMD64 callee-saved: `RBX`, `RBP`, `R12`, `R13`, `R14`, `R15` (and `RSP`). Win64 callee-saved adds `RSI`, `RDI`, and the upper halves of `XMM6–XMM15`. The two lists differ — which is itself a corruption source when ABIs mix.

The professional failure mode here is **hand-written or generated assembly that violates the contract**:

```asm
; A trampoline that clobbers RBX without saving it -- silent corruption.
my_trampoline:
    mov   rbx, rdi          ; BUG: RBX is callee-saved; we never push/pop it
    call  real_target
    mov   rax, rbx          ; ... and the CALLER expected RBX intact
    ret
```

The caller of `my_trampoline` was entitled to find `RBX` unchanged. Because the trampoline overwrote it without save/restore, the caller's loop counter, base pointer, or pinned register now holds garbage — and the crash, if any, happens *in the caller's frame*, frames away from the actual bug. The corollary: a callee that *does* save `RBX` but forgets to restore it on an early-return path is equally lethal.

JITs and FFI trampolines must encode the exact save set for the target convention. A common, subtle bug is a trampoline built for SysV that omits saving `RSI`/`RDI` and is then reused for a Win64 callee, where those registers are non-volatile.

---

## Stack Alignment and `movaps` Faults

### The invariant

The ABI guarantees that **at the point of a `call` instruction, `RSP` is 16-byte aligned.** Because `call` pushes an 8-byte return address, **on entry to the callee, `RSP % 16 == 8`.** Compilers rely on this to place 16-byte-aligned locals and to emit aligned SSE stores. AArch64 is stricter still: `SP` must be 16-byte aligned at all times a memory access uses it as a base.

### Why violations fault on `movaps`, not at the call

The invariant is "free" when you let the compiler manage the frame, but hand-written assembly and JITs break it constantly:

```asm
; WRONG: odd number of pushes leaves RSP misaligned at the call
trampoline:
    push  rbx               ; RSP now %16 == 0  (entry was 8, push subtracts 8)
    call  target            ; BUG: target's compiler assumes %16 == 8 -> its locals
    ...                     ;      become misaligned; an aligned SSE store faults
```

The fault does not occur at the `call`. It occurs deep inside the callee, when the optimizer emits a `movaps`/`movdqa` to a 16-byte-aligned local — for example inside an inlined `std::vector` copy, a memset, a `std::complex` operation, or any vectorized loop. The address is *almost* aligned (off by 8), so most byte-wise code works fine; only the aligned-SIMD instruction faults with `#GP`/`SIGSEGV`. The signature — "crashes at `-O2` inside `memcpy`/`std::` code, fine at `-O0`" — is the canonical misalignment tell, because `-O0` rarely emits aligned SIMD.

The fix is to keep the push count even (or `sub rsp, 8`) so the call site re-establishes `RSP % 16 == 0`:

```asm
trampoline:
    push  rbx
    sub   rsp, 8            ; re-align: now RSP %16 == 8 at entry -> %16==0 at call
    call  target           ; correct
    add   rsp, 8
    pop   rbx
    ret
```

---

## The Red Zone vs Windows Shadow Space

These are two opposite stack conventions, and confusing them across an ABI boundary corrupts memory silently.

### SysV red zone

SysV reserves a **128-byte red zone below `RSP`** that a leaf function (one that makes no calls) may use as scratch *without adjusting `RSP`*. It saves a `sub rsp`/`add rsp` pair in hot leaf functions. The danger is that **anything that writes below `RSP` asynchronously must respect it**: signal handlers, kernel entry, and hand-written interrupt-like code must skip 128 bytes before pushing, or they clobber the interrupted function's live data. Code compiled with `-mno-red-zone` (kernel code, some interrupt handlers) cannot interoperate at the frame level with red-zone-assuming code.

### Windows shadow space (home space)

Win64 mandates the opposite: the **caller** reserves **32 bytes of "shadow space"** on the stack *above* the return address, before the call, regardless of argument count. The callee may spill its four register parameters (`RCX`, `RDX`, `R8`, `R9`) into this home area. A caller that forgets the 32 bytes lets the callee's parameter spills land on the caller's own locals or return address.

```asm
; Win64 caller -- MUST reserve 32 bytes shadow space (plus alignment)
    sub   rsp, 32           ; shadow space for callee's 4 register params
    mov   rcx, arg0
    call  callee
    add   rsp, 32
```

The cross-ABI trap: a trampoline written for SysV (no shadow space, relies on red zone) calling a Win64 function under emulation, or vice versa, gets this exactly backward — the SysV side scribbles in the red zone the Win64 callee never reserved, or the Win64 callee spills into the SysV caller's frame. This is one reason mixed-ABI binaries demand the `ms_abi`/`sysv_abi` attributes below.

---

## Convention Mismatch: stdcall as cdecl

The clearest, most instructive corruption is a 32-bit x86 mismatch: **who cleans up the arguments pushed on the stack.**

- **cdecl:** the *caller* removes the arguments after the call (`add esp, N`). This is why cdecl supports varargs — only the caller knows how many it pushed.
- **stdcall:** the *callee* removes the arguments (`ret N`, which pops `N` bytes after returning). The Win32 API is overwhelmingly stdcall.

Now declare a `stdcall` function as `cdecl` and call it:

```c
// The real function is stdcall and pops 8 bytes itself.
int __stdcall RealApi(int a, int b);

// FFI declares it cdecl by mistake:
typedef int (__cdecl *Wrong)(int, int);
Wrong f = (Wrong)GetProcAddress(h, "RealApi");
int r = f(1, 2);
```

Step through the stack:

1. The caller (thinking cdecl) pushes `b`, `a`, then `call`s.
2. `RealApi` (actually stdcall) runs, then executes `ret 8` — it pops the return address **and** 8 bytes of arguments.
3. Control returns to the caller, which *also* believes it must clean up, and executes `add esp, 8`.
4. **`ESP` is now 8 bytes too high.** The arguments were removed twice. Every subsequent stack reference is off by 8: the next function reads the wrong locals, a `ret` jumps to a garbage address, and the program crashes — typically not here, but at the next return or the next stack access.

The reverse mismatch (cdecl declared as stdcall) leaves `ESP` 8 bytes *too low* and leaks stack on every call until it overflows. Both are silent at the call site and lethal frames later. On 32-bit Windows, name decoration is a partial defense: stdcall symbols are decorated `_Name@8` (the `@N` is the argument byte count), cdecl as `_Name`, fastcall as `@Name@N` — so a mismatched declaration often fails to *link* rather than corrupting at runtime. FFI that resolves symbols dynamically (`GetProcAddress`) loses that protection, which is exactly why dynamic interop must pin the convention explicitly.

---

## Mixing ABIs in One Binary: `ms_abi` / `sysv_abi`

Sometimes one image must speak two conventions: a SysV Linux program calling a Windows DLL under Wine/emulation, UEFI firmware (Microsoft x64 ABI) called from a SysV-compiled bootloader, or a foreign function whose object was compiled for the other platform. GCC and Clang expose per-function overrides:

```c
// Force the Windows x64 convention on a single function, on a SysV target.
__attribute__((ms_abi))   uint64_t call_uefi(uint64_t a, uint64_t b);

// Force the SysV convention on a single function, on a Windows target.
__attribute__((sysv_abi)) double   sysv_helper(double x, double y);
```

The attribute changes everything the convention controls for that function: argument registers (`RCX/RDX/R8/R9` vs `RDI/RSI/RDX/RCX/R8/R9`), the callee-saved set (`ms_abi` adds `RSI/RDI` and `XMM6–XMM15`), shadow space vs red zone, and the struct passing model (by-reference-unless-1/2/4/8 vs eightbyte classification). The compiler then emits a correct prologue/epilogue and call sequence for that single boundary, including saving the additional non-volatile registers when crossing in.

The professional discipline: **apply the attribute at the exact boundary function and nowhere else.** The interior of your program stays native; only the thin shim that touches the foreign code wears the foreign ABI. Getting the attribute wrong — or omitting it on a hand-rolled trampoline — reproduces every failure in this document at once: wrong argument registers, missing shadow space, unsaved non-volatiles, and red-zone clobber.

---

## How FFI Glue Must Know the Convention

Everything above converges on one point: **FFI glue cannot "just pass the bytes."** To call a single function correctly the glue must know, for the target platform:

- Which **register file** each scalar argument uses (integer vs SSE), and the platform's register order.
- The **struct classification** for every by-value aggregate — which registers, or `sret`/by-reference, and the resulting **argument shift**.
- Whether the return is a register, an `RAX:RDX`/`XMM0:XMM1` pair, or an `sret`/`X8` indirect result.
- The **`AL` obligation** and `va_list` layout for variadic calls.
- The **callee-saved set** the trampoline must preserve, and the **16-byte alignment** at the call.
- **Shadow space** (Win64) or **red-zone** assumptions (SysV).

Get any one wrong and there is no diagnostic — only shifted fields, garbage floats, or a stack smash. There are two robust strategies, and a professional reaches for them in this order:

**1. Generate a C shim and let the C compiler apply the ABI.** Emit a tiny C function with the *real* signature and call it from your runtime through a uniform, pointer-based interface. The compiler then performs classification, `sret`, `AL`, alignment, and save-discipline for you — for whatever target it is compiled on. This is what cgo, much of `bindgen`'s heavy cases, and most production interop layers do.

```c
// Generated shim: the C compiler owns the entire ABI for `make`.
void shim_make(struct Big *out, int seed) { *out = make(seed); }
// The runtime calls shim_make through a trivial pointer-args interface.
```

**2. Use a battle-tested ABI library (libffi) and feed it the *exact* type descriptors.** libffi encodes per-platform classification. But it is only as correct as the type information you give it — including marking variadic arguments and their promoted types. A wrong `ffi_type` reproduces the same corruptions.

**Prefer pointers over by-value aggregates at any boundary you control.** A pointer is just an integer argument on every ABI; passing `void f(const Foo *in, Foo *out)` sidesteps classification, `sret`, and the platform split entirely. Reserve by-value structs for boundaries where the foreign API forces them — and then verify the placement in the disassembler.

---

## Production War Stories

- **"Returns the right matrix on Linux, garbage on Windows."** A 16-byte `struct {double a, b;}` returned by value: SysV brings it back in `XMM0:XMM1`; Win64 returns it via a hidden `RCX` pointer. The marshaller hard-coded the SysV path, so on Windows it read two doubles out of registers that held nothing relevant.
- **"`printf` wrapper works until someone logs a float."** A logging facade called the C `printf` through a `void(*)()` cast to erase the signature. The compiler stopped emitting `mov al, N`. Integer logs worked; the first `%f` printed garbage on Linux because no XMM was saved.
- **"Crashes at `-O2`, fine at `-O0`, only inside `std::vector`."** A hand-written trampoline pushed an odd number of registers, leaving `RSP` misaligned at the `call`. At `-O2` the callee inlined a `movaps` store to an aligned local that was now off by 8 → `SIGSEGV`. At `-O0` no aligned SIMD was emitted, so it "worked."
- **"Random corruption two functions up the stack."** A JIT trampoline used `RBX` as scratch without saving it (it is callee-saved on SysV). The corruption surfaced in an unrelated caller's frame whose loop counter lived in `RBX`.
- **"`ESP` drifts and the app dies after a few thousand Win32 calls."** A `stdcall` API declared `cdecl` via `GetProcAddress`; the caller cleaned up arguments the callee had already popped. Each call moved `ESP` by 8 until a `ret` jumped into the void.
- **"Signal handler corrupts a leaf function's locals."** Hand-rolled handler entry pushed onto the stack without skipping the 128-byte SysV red zone, overwriting the interrupted leaf function's scratch data.

---

## Best Practices

- **Never FFI a variadic function directly.** Route through the `va_list` variant or a fixed-arity C shim so the compiler owns `AL` and the save area.
- **Freeze by-value structs that cross an FFI seam.** Explicit padding, `static_assert(sizeof)`, a no-casual-edits rule. Adding a field can flip the convention.
- **Prefer pointers to structs across boundaries you control.** A pointer is an integer argument on every ABI; it avoids classification, `sret`, and the platform split.
- **Generate C shims; let the C compiler apply the ABI.** It is the only tool guaranteed to implement classification, `sret`, `AL`, alignment, and save-discipline correctly per target.
- **Branch on OS for aggregate passing and returning.** SysV classification, Win64 by-reference-unless-1/2/4/8, AArch64 HFAs/`X8` are three different models.
- **Keep `RSP % 16 == 0` at every `call` in hand-written/JIT code.** Count your pushes; pad with `sub rsp, 8` when odd.
- **Encode the exact callee-saved set in trampolines**, and remember Win64's set differs from SysV's (`RSI`/`RDI`/`XMM6–15`).
- **Reserve 32 bytes of shadow space before every Win64 call**; respect the 128-byte red zone in anything that writes below `RSP` on SysV.
- **Pin the convention at dynamic-resolution boundaries.** `GetProcAddress`/`dlsym` lose the linker's decoration-based mismatch defense; declare `__stdcall`/`__cdecl` (or the `ms_abi`/`sysv_abi` attribute) explicitly.
- **Verify in the disassembler.** For every struct argument/return and every trampoline, confirm the actual registers, the `sret` slot, and the alignment at the call.

---

## Edge Cases & Pitfalls

### Pitfall 1: Variadic prototype erased by a function-pointer cast

Casting a variadic function to a non-variadic pointer drops the `AL` setup; floating variadic arguments read garbage on SysV. Keep the prototype or use the `va_list` variant.

### Pitfall 2: The `sret` argument shift forgotten

A MEMORY-class return consumes `RDI` (SysV) / `RCX` (Win64) for the hidden pointer, shifting the real first *integer* argument to `RSI`/`RDX`. Loading the first arg into `RDI` overwrites the return slot pointer.

### Pitfall 3: Per-field struct marshalling

`struct {float x, y;}` is one XMM; `struct {int a; float b;}` merges to one integer register. Assigning a register per field corrupts the layout.

### Pitfall 4: Odd push count → `movaps` fault at `-O2`

Misaligning `RSP` at the call doesn't fault there; it faults inside the callee on an aligned SIMD store, often inside inlined library code, only at optimization levels that emit `movaps`.

### Pitfall 5: Clobbering a callee-saved register in a trampoline

Using `RBX`/`R12–R15` (or Win64 `RSI`/`RDI`) as scratch without save/restore corrupts the *caller's* state; the crash appears frames away.

### Pitfall 6: Missing Win64 shadow space / violated SysV red zone

A Win64 caller that omits the 32-byte shadow space lets the callee spill onto its frame; SysV async code that writes below `RSP` without skipping 128 bytes clobbers a leaf function's scratch.

### Pitfall 7: stdcall/cdecl mismatch under dynamic resolution

`GetProcAddress` loses decoration-based link-time protection. A stdcall function called as cdecl double-cleans the stack, drifting `ESP` until a later `ret` jumps to garbage.

### Pitfall 8: Non-trivial C++ types passed "by value"

A type with a non-trivial copy/dtor is always passed/returned in memory by an invisible reference so its special members can run on a stable address. Treating it as a trivial value corrupts it and skips its constructors/destructors.

---

## Cheat Sheet

```text
VARIADICS (production)
  SysV:    caller sets AL = # of XMM regs used by varargs; callee spills save area
  Win64:   float varargs in BOTH gp and xmm reg; no AL
  AArch64: separate GP/FP save areas
  RULE:    never FFI a variadic fn; use the va_list sibling or a C shim
  va_arg:  promotions float->double, sub-int->int; va_arg(ap,float) is UB

STRUCT-BY-VALUE TRAPS (SysV)
  {float x,y}        -> ONE xmm (packed)        | {int a; float b} -> ONE gp (merged INTEGER)
  {double a,b}       -> XMM0,XMM1               | {long a; double b}-> RDI + XMM0
  add a field        -> may flip RAX -> sret    | packed/under-aligned -> MEMORY
  Win64 {double a,b} -> BY REFERENCE (ptr RCX)  | C++ non-trivial type -> always in memory

sret / RVO
  >16B (SysV) return -> caller allocs, hidden ptr in RDI, echoed in RAX
  shifts real INTEGER arg1 -> RSI (SSE arg1 stays in XMM0)
  Win64 hidden ptr -> RCX ; AArch64 indirect result -> X8 (no arg shift)
  == the mechanism behind guaranteed (N)RVO

SAVE DISCIPLINE
  SysV callee-saved : RBX RBP R12-R15 RSP
  Win64 callee-saved: + RSI RDI + XMM6-XMM15
  trampoline MUST push/restore the exact set; clobber -> caller-frame corruption

ALIGNMENT
  at `call`: RSP % 16 == 0  (entry: RSP % 16 == 8)
  violation faults on movaps/movdqa inside callee, often only at -O2
  fix: even push count, or `sub rsp,8`

RED ZONE vs SHADOW SPACE
  SysV red zone : 128B below RSP, leaf scratch, no RSP adjust; async writers must skip it
  Win64 shadow  : caller reserves 32B above return addr for callee param spills

CONVENTION MISMATCH (x86 32-bit)
  cdecl   : CALLER cleans args (`add esp,N`)  -> supports varargs
  stdcall : CALLEE cleans args (`ret N`)      -> Win32 API
  stdcall-as-cdecl: args cleaned twice -> ESP drifts +N -> later ret crashes
  defense: name decoration _Name@N ; lost under GetProcAddress/dlsym -> pin convention

MIXING ABIs
  __attribute__((ms_abi))   -> force Win64 conv on one fn (regs, +nonvol, shadow space)
  __attribute__((sysv_abi)) -> force SysV conv on one fn
  apply at the boundary fn ONLY

FFI GLUE RULE
  glue must encode: arg register file, struct classification + arg shift,
  return path (reg/pair/sret/X8), AL+va_list, callee-saved set, 16B align,
  shadow space / red zone.  CHEAPEST CORRECT PATH: generate a C shim.
```

---

## Summary

At the professional tier, the calling convention is a production contract you enforce, and its violations are silent: the call returns, but a struct field is shifted, a `double` is garbage, the stack is smashed two frames down, or a `movaps` faults inside inlined library code. **Variadics** are perennially fragile because the SysV `AL` obligation and the `va_arg` type rules live in the prototype, which FFI routinely erases through `void*` casts — so you wrap the `va_list` sibling or a C shim instead of calling `printf` directly, and you remember that SysV, Win64, and AArch64 implement the *same* `printf` three different ways.

**Struct-by-value** is where the surprises cluster: two floats ride in one XMM, an int+float merges to one integer register, a 16-byte two-double struct travels in registers on SysV but by reference on Win64, and adding a single field can flip a function from register-return to `sret`. **`sret`** is the hidden out-pointer that makes large returns and guaranteed RVO work — and it shifts the real arguments down a register, a shift that hand-written callers and JITs forget. **Save-discipline** failures (clobbering `RBX` or Win64's `RSI`/`RDI`) corrupt the caller's frame; **alignment** failures (an odd push count) fault on aligned SIMD deep inside the callee, only at `-O2`. The **red zone** (SysV leaf scratch below `RSP`) and **shadow space** (Win64's 32 caller-reserved bytes) are opposite conventions that corrupt each other when crossed. The **stdcall-as-cdecl** mismatch double-cleans the 32-bit stack and drifts `ESP` until a later `ret` jumps into garbage. The `ms_abi`/`sysv_abi` attributes let one binary speak both conventions, but only at the exact boundary function.

The throughline is that **FFI glue is correct only if it encodes the callee's convention exactly** — register file, classification, argument shift, return path, `AL`, save set, alignment, shadow/red zone — and the cheapest way to guarantee all of that is to stop reimplementing the ABI and let the C compiler do it: generate a C shim, prefer pointers over by-value aggregates, branch on OS for structs, and verify every boundary in the disassembler. The next tier addresses ABI *stability* across releases — versioning and the compatibility policy that keeps all of this from breaking under your customers.

---

## Further Reading

- *System V AMD64 ABI*, §3.2 (parameter passing, the variadic register-save area) and §3.2.3 (the classification algorithm, red zone).
- Microsoft, "x64 calling convention" and "x64 stack usage" — shadow space, by-reference structs, the `RCX` return pointer.
- Arm, *AAPCS64* — HFAs, the `X8` indirect result register, and SP alignment.
- GCC/Clang documentation for `__attribute__((ms_abi))`, `((sysv_abi))`, and `-mno-red-zone`.
- libffi internals and the per-platform `ffi_prep_cif`/`ffi_call` paths, including variadic CIF preparation.
- ISO C `<stdarg.h>` semantics and the default argument promotions.
- Agner Fog, *Calling Conventions for Different C++ Compilers and Operating Systems* — a cross-platform reference table.
