# Calling Conventions — Hands-On Tasks

> **Topic:** [Calling Conventions](README.md)
> **Focus:** Seeing the ABI with your own eyes — arguments in `RDI/RSI/…`, shadow space on Win64, structs returned via a hidden pointer, and a deliberately misaligned stack faulting on `movaps`.

---

## Introduction

You cannot learn calling conventions by reading the ABI document; you learn them by compiling small functions, opening the disassembly, and confirming that the bytes match the theory. These tasks build that reflex. You will watch scalar arguments land in `RDI`, `RSI`, `RDX`; observe a struct split across an integer and a vector register; find a large struct return that is secretly an out-parameter; reserve shadow space on Windows; and deliberately break the 16-byte stack alignment to make a `movaps` fault.

Every task is self-checking: a self-check tells you what to look for, a hint nudges you if you are stuck, and a sparse solution gives the key command or code fragment without doing all the work for you. Work on Linux/macOS for the SysV tasks and a Windows machine (or cross-compiler) for the Win64 task. Tools you will use: `gcc`/`clang`, `objdump -d` or `clang -S`, `gdb`/`lldb`, and `cl`/`dumpbin` on Windows. Throughout, the discipline is the same: *predict first, then verify in the disassembler.*

Recommended setup:

```bash
# SysV (Linux/macOS)
gcc -O2 -S file.c -o file.s        # readable assembly
gcc -O2 -c file.c && objdump -d file.o
gcc -g -O0 file.c -o prog          # for gdb stepping
```

---

## Warm-Up

### Task W1 — Find the argument registers

Compile this and read the assembly.

```c
long add6(long a, long b, long c, long d, long e, long f) {
    return a + b + c + d + e + f;
}
```

**Self-check:** Confirm the six arguments arrive in `RDI`, `RSI`, `RDX`, `RCX`, `R8`, `R9` (in that order) before any addition. There should be no stack loads — all six fit in registers.

<details>
<summary>Hint</summary>
Use `gcc -O1 -S add6.c -o -` so the registers aren't optimized into a single fused expression. At `-O2` the compiler may reorder, but the *inputs* still originate from those six registers.
</details>

<details>
<summary>Solution sketch</summary>

```bash
gcc -O1 -S add6.c -o -
```
You'll see additions chaining `rdi`, `rsi`, `rdx`, `rcx`, `r8d`/`r8`, `r9d`/`r9` into `rax`. The return value lands in `RAX`.
</details>

---

### Task W2 — A seventh argument spills to the stack

Add one more parameter and find where it comes from.

```c
long add7(long a, long b, long c, long d, long e, long f, long g) {
    return a + b + c + d + e + f + g;
}
```

**Self-check:** The seventh argument `g` is not in a register — it is loaded from the stack, at a positive offset from `RSP` (above the return address). Find the `mov ... [rsp+N]` or `[rbp+N]` that reads it.

<details>
<summary>Hint</summary>
Stack arguments live above the return address. At `-O0` you'll typically see `mov rax, [rbp+0x10]` (or similar) for the first stacked argument.
</details>

---

### Task W3 — Float vs integer argument registers

Compile a mixed-signature function.

```c
double mix(int a, double x, int b, double y) {
    return a + x + b + y;
}
```

**Self-check:** Confirm `a` and `b` use integer registers (`EDI`, `ESI`) while `x` and `y` use vector registers (`XMM0`, `XMM1`). The two register sequences advance independently — `b` is `ESI` (second integer), not the fourth argument's register.

<details>
<summary>Hint</summary>
Look for `cvtsi2sd` converting the ints to double, and `addsd` operating on `xmm0`/`xmm1`.
</details>

---

## Core

### Task C1 — Watch a struct split across two register files

Pass a hybrid struct by value and prove it occupies both an integer and a vector register.

```c
struct C { long a; double b; };
long use(struct C c) { return c.a + (long)c.b; }
```

**Self-check:** In `use`, confirm `c.a` is read from `RDI` and `c.b` from `XMM0`. One struct argument, two register files. You should see something like `cvttsd2si rax, xmm0` then `add rax, rdi`.

<details>
<summary>Hint</summary>
The first eightbyte (`long a`) is INTEGER → `RDI`; the second (`double b`) is SSE → `XMM0`. There is no stack access.
</details>

<details>
<summary>Solution sketch</summary>

```asm
use:
    cvttsd2si rax, xmm0    ; (long)c.b came in XMM0
    add       rax, rdi     ; + c.a came in RDI
    ret
```
</details>

---

### Task C2 — Two floats packed into one XMM register

Pass an all-float struct and confirm it does *not* use two vector registers.

```c
struct A { float x, y; };
float sumA(struct A a) { return a.x + a.y; }
```

**Self-check:** `sumA` receives the whole struct in `XMM0` (both floats in its low 64 bits) and never touches `XMM1`. Look for `movshdup`/`shufps` extracting the high float from the same register, then `addss`.

<details>
<summary>Hint</summary>
A marshaller that put `x` in `XMM0` and `y` in `XMM1` would be wrong — verify the assembly only references `XMM0`.
</details>

---

### Task C3 — The int+float merge rule

Confirm a struct mixing an int and a float in one eightbyte rides entirely in an integer register.

```c
struct Px { int a; float b; };
long pick(struct Px p) { return p.a; }
```

**Self-check:** `p` arrives in `RDI` (one merged INTEGER eightbyte), not split into an integer and a vector register. To read `p.b` you would shift/extract from `RDI`, not read `XMM0`.

<details>
<summary>Hint</summary>
Both fields are within bytes 0–7, so the eightbyte mixes INTEGER and SSE and merges to INTEGER.
</details>

---

### Task C4 — Find a struct returned via a hidden pointer

Return a large struct and locate the `sret` out-parameter and the argument shift.

```c
struct Big { double m[8]; };          // 64 bytes > 16
struct Big scaled(struct Big in, double k) {
    struct Big out;
    for (int i = 0; i < 8; i++) out.m[i] = in.m[i] * k;
    return out;
}
```

**Self-check:** At the call site of `scaled`, confirm: (1) the caller allocates a 64-byte slot and passes its address in `RDI`; (2) the real first argument `in` is *also* a large struct passed in memory; (3) `k` (a double) is in `XMM0`; (4) `scaled` returns the slot pointer in `RAX`. The key observation: `RDI` holds the hidden return pointer, not the first declared argument.

<details>
<summary>Hint</summary>
Compile a tiny `main` that calls `scaled` and disassemble *main*, not `scaled`, to see the caller-side `lea rdi, [result_slot]` and the returned `RAX`.
</details>

<details>
<summary>Solution sketch</summary>

```c
int main(void) {
    struct Big a = { .m = {1,2,3,4,5,6,7,8} };
    struct Big r = scaled(a, 2.0);
    return (int)r.m[0];
}
```
In `main`'s disassembly: `lea rdi, [rsp+off]` (the sret slot) before the `call scaled`, and the result read back from that slot. `scaled` writes through its first integer-register pointer and returns it in `RAX`.
</details>

---

### Task C5 — The "add a field flips the ABI" experiment

Show that growing a returned struct changes how it is returned.

```c
struct R2 { int a, b; };              // 8B  -> RAX
struct R3 { int a, b, c; };           // 12B -> RAX:RDX
struct R5 { int a,b,c,d,e; };         // 20B -> sret
struct R2 mk2(void); struct R3 mk3(void); struct R5 mk5(void);
```

**Self-check:** Disassemble three callers. `mk2`'s result is read from `RAX` only; `mk3`'s from `RAX` *and* `RDX`; `mk5`'s caller allocates a slot and passes a hidden pointer in `RDI`. Note how a one-field edit silently changed the convention — the lesson for FFI struct stability.

<details>
<summary>Hint</summary>
Give each `mk` a trivial definition (`return (struct R2){1,2};`) so it compiles, and call all three from `main`.
</details>

---

## Advanced

### Task A1 — Observe Windows x64 shadow space

On Windows (or via `x86_64-w64-mingw32-gcc`), confirm the caller reserves 32 bytes before a call.

```c
extern void callee(int, int, int, int);
void caller(void) { callee(1, 2, 3, 4); }
```

**Self-check:** In `caller`'s prologue/call setup, find `sub rsp, 0x28` (or `0x20` plus alignment). The 32 (`0x20`) bytes are shadow space the callee may use to spill `RCX/RDX/R8/R9`. Confirm arguments go in `RCX`, `RDX`, `R8`, `R9` — not `RDI/RSI/…`.

<details>
<summary>Hint</summary>
```bash
x86_64-w64-mingw32-gcc -O2 -S caller.c -o -
```
The `sub rsp` reserves shadow space *plus* enough to keep `RSP` 16-byte aligned at the inner `call`.
</details>

<details>
<summary>Solution sketch</summary>
On Win64 you'll see the four args loaded into `ecx, edx, r8d, r9d`, then `call callee`. Contrast with the SysV build of the same code, which uses `edi, esi, edx, ecx` and reserves no shadow space (it relies on the red zone for leaves instead).
</details>

---

### Task A2 — Confirm the SysV red zone

Show that a leaf function uses scratch below `RSP` without adjusting it.

```c
int leaf(int x) {
    volatile int tmp[4];                // small scratch
    for (int i = 0; i < 4; i++) tmp[i] = x + i;
    return tmp[0] + tmp[3];
}
```

**Self-check:** Built `-O0` on SysV, `leaf` may store `tmp` at negative offsets from `RSP` (e.g., `mov [rsp-0x10], …`) *without* a `sub rsp` — it is using the 128-byte red zone. Recompile with `-mno-red-zone` and confirm a `sub rsp`/`add rsp` pair appears instead.

<details>
<summary>Hint</summary>
Compare `gcc -O0 -S leaf.c` against `gcc -O0 -mno-red-zone -S leaf.c`. The red-zone version writes below `RSP`; the no-red-zone version adjusts `RSP` first.
</details>

---

### Task A3 — Set the `AL` register for a variadic call

Confirm the caller announces the number of vector registers to a variadic function.

```c
#include <stdio.h>
int main(void) { return printf("%d %.2f %s\n", 7, 2.5, "hi"); }
```

**Self-check:** Before `call printf`, find `mov al, 1` (or `mov eax, 1`) — exactly one XMM register (`XMM0`, holding `2.5`) is used by the variadic arguments. The format string is in `RDI`, `7` in `RSI`, the pointer in `RDX`, and `2.5` in `XMM0`.

<details>
<summary>Hint</summary>
```bash
gcc -O2 -S main.c -o - | grep -A1 -B6 'call.*printf'
```
Now add a second `%.2f` and a second double argument and confirm `AL` becomes `2`.
</details>

<details>
<summary>Solution sketch</summary>

```asm
    lea   rdi, [fmt]
    mov   esi, 7
    lea   rdx, [hi]
    movsd xmm0, [two_point_five]
    mov   al, 1          ; <-- one vector register used by varargs
    call  printf
```
If you cast `printf` to `void(*)()` before calling, the `mov al` disappears — reproduce that and watch the float break at runtime.
</details>

---

### Task A4 — Break the stack alignment and fault on `movaps`

Deliberately misalign `RSP` at a call and trigger an aligned-SIMD fault inside the callee.

```c
// callee that the optimizer will vectorize with aligned SSE
void fill(double *d) {
    for (int i = 0; i < 4; i++) d[i] = i * 1.5;   // -O2 may emit movaps
}
```

Write a small assembly trampoline (or inline asm) that pushes an *odd* number of 8-byte values, then `call`s a function whose compiler assumes `RSP % 16 == 8` at entry.

**Self-check:** When the stack is misaligned, an aligned `movaps`/`movdqa` to a 16-byte-aligned local faults with `SIGSEGV` — and the fault is *inside* the callee, not at the `call`. Fix it by making the push count even (or `sub rsp, 8`) and confirm the fault disappears.

<details>
<summary>Hint</summary>
The invariant: at a `call`, `RSP % 16 == 0`. A single `push` after entry (where `RSP % 16 == 8`) makes it `0`; a second `push` (or `sub rsp,8`) restores the entry invariant for the next call. The crash signature — fault inside vectorized code, only at `-O2` — is the canonical misalignment tell.
</details>

<details>
<summary>Solution sketch</summary>

```asm
; misaligned (WRONG):
my_tramp:
    push rbx            ; RSP %16 == 0 now -> call entry will be %16 == 0, callee expects 8
    call target         ; callee's aligned movaps faults
    pop  rbx
    ret

; aligned (CORRECT):
my_tramp:
    push rbx
    sub  rsp, 8         ; re-establish RSP %16 == 0 at the call
    call target
    add  rsp, 8
    pop  rbx
    ret
```
Easiest reproduction: compile `fill` at `-O2`, confirm it uses `movaps`/`movupd`; force the aligned variant with `-O3 -ffast-math` if needed, then call it from the misaligned trampoline.
</details>

---

### Task A5 — Prove a callee-saved register is preserved

Confirm the compiler saves and restores a callee-saved register when it uses one.

```c
long worker(long n) {
    long acc = 0;
    for (long i = 0; i < n; i++) acc += heavy(i);   // heavy() is an external call
    return acc;
}
```

**Self-check:** Because `worker` keeps `acc`/`i` live across the call to `heavy`, the compiler stores them in callee-saved registers (e.g., `RBX`, `R12`) and emits `push rbx`/`pop rbx` (or `push r12`) in the prologue/epilogue. Verify the save/restore pairing — every pushed non-volatile is popped on every return path.

<details>
<summary>Hint</summary>
Declare `extern long heavy(long);`. Values that must survive a call cannot live in caller-saved registers, so the compiler reaches for `RBX`/`R12–R15` and saves them.
</details>

---

## Capstone

### Task CAP1 — A complete FFI mismatch demonstration

Build a self-contained program that demonstrates *why* FFI glue must encode the convention, by getting it wrong in three ways and then fixing each.

Requirements:

1. **Struct-return shift.** Call a function returning a 64-byte struct from hand-written assembly (or careful inline asm) that mistakenly loads the first real argument into `RDI`. Show the result is written to the wrong address (corrupting memory), then fix it by putting the real argument in `RSI` and the `sret` pointer in `RDI`.
2. **Variadic `AL`.** Call `printf("%f", 1.5)` through a `void(*)()` cast (dropping the prototype) and show the float prints garbage; fix it by routing through `vprintf` with a deliberately built `va_list`, or by restoring the prototype.
3. **Alignment.** Reuse Task A4's misaligned trampoline to fault a vectorized callee, then fix the alignment.

**Self-check:** Each "broken" version should corrupt, misprint, or fault; each "fixed" version should produce the correct result. Write a short paragraph for each explaining the exact ABI rule that was violated (the `sret` argument shift, the `AL` rule, the 16-byte alignment invariant).

<details>
<summary>Hint</summary>
You don't need full assembly trampolines for all three — inline asm or a tiny `.s` file per case is enough. For case 1, the corruption is observable by printing memory you didn't intend to write; for case 2, the garbage is observable directly; for case 3, the crash is the signal.
</details>

<details>
<summary>Solution direction</summary>
The unifying lesson: in all three cases the *call returns* (or appears to) but the program is wrong, because the glue disagreed with the callee's convention. The robust production fix for all three is the same — generate a fully-prototyped C shim and let the compiler emit the correct `sret` handling, `AL` setup, and aligned call sequence. Conclude by rewriting all three boundaries as C shims and confirming they are correct by construction.
</details>

---

### Task CAP2 — Cross-platform struct passing report

Take three structs and document, with disassembly evidence, how each is passed and returned on SysV AMD64 versus Windows x64 (use a MinGW cross-compiler for the Win64 side).

```c
struct S1 { double a, b; };           // 16B
struct S2 { int a; char buf[20]; };   // 24B
struct S3 { float x, y, z; };         // 12B
```

**Self-check:** For each struct, on each platform, record: passed in registers (which?) or by reference/memory; returned in registers (which?) or via hidden pointer. Confirm the canonical divergence: `S1` rides in `XMM0:XMM1` on SysV but is passed by reference (pointer in `RCX`) on Windows. Note where AArch64 would differ (`S3` becomes an HFA in `V0–V2`).

<details>
<summary>Hint</summary>
```bash
gcc -O2 -S cross.c -o sysv.s
x86_64-w64-mingw32-gcc -O2 -S cross.c -o win.s
```
Diff the two for each function. The differences are exactly the platform's struct model: SysV eightbyte classification vs Windows by-reference-unless-1/2/4/8.
</details>

---

## Wrap-Up

You have now seen, in disassembly, the facts that make calling conventions an *exact* contract: arguments in `RDI/RSI/RDX/RCX/R8/R9`, structs splitting across integer and vector register files, two floats packed into one XMM, an int+float struct merging to one integer register, a large struct returned through a hidden `RDI` pointer that shifts the real arguments, the `AL` register announcing vector-register count to a variadic callee, Windows shadow space and the SysV red zone, callee-saved registers being preserved across calls, and a misaligned stack faulting on `movaps` deep inside the callee. The capstone tied these into the central FFI lesson: glue is correct only when it encodes the callee's convention exactly, and the cheapest way to guarantee that is to let the C compiler do it. Keep the habit you built here — *predict the registers, then verify in the disassembler* — and ABI bugs stop being mysterious and start being readable.
