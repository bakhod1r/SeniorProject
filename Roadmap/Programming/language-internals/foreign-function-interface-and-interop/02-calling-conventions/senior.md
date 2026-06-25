# Calling Conventions — Senior Level

> **Topic:** [Calling Conventions](README.md)
> **Focus:** The corner cases that break naive FFI — passing and returning structs by value (the SysV INTEGER/SSE/MEMORY classification and the 16-byte rule), large-struct returns via a hidden `sret` pointer, and how variadic functions like `printf` actually pass their arguments.

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

> Focus: **Scalars are easy; aggregates are where conventions get vicious.** How a `struct {double; double}` versus a `struct {int; double}` versus a `struct {char[20]}` is passed differs in ways no one would guess, and getting it wrong produces silently shifted fields rather than a crash.

For scalar arguments — `int`, `double`, pointers — the rules from the middle tier are mechanical: drop them into the next register of the right class. The trouble starts when you pass a **struct by value** or **return one**. Suddenly the ABI has to answer questions like: *Does this 12-byte struct go in one register or two? In integer or SSE registers? Or is it too awkward and shoved onto the stack? If a function returns a 64-byte struct, where does the result even live — there's no 64-byte register?*

The SysV AMD64 answer is a genuine **classification algorithm**: it walks the struct's fields, assigns each 8-byte chunk ("eightbyte") a class — `INTEGER`, `SSE`, or `MEMORY` — applies merge rules, and only then decides registers vs stack. The result is full of surprises: `struct {float x, y;}` (two floats, 8 bytes) is passed in *one* `XMM` register as a packed pair, not two; `struct {double; double;}` (16 bytes) goes in *two* XMM registers; but add one more field and it overflows to memory. Returning a large struct doesn't use a register at all — the caller secretly allocates space and passes a hidden pointer as if it were the first argument (this is the `sret` / "return value optimization" mechanism). And variadic functions like `printf` add a final twist: on SysV the caller must set `AL` to the number of vector registers used, or the callee's `va_arg` machinery reads garbage.

In one sentence: **aggregate passing and returning, plus variadics, are where calling conventions stop being a lookup table and become an algorithm — and where FFI tools must replicate that algorithm exactly or corrupt your data.**

> 🎓 **Why this matters at the senior level:** You own the FFI layer, the codegen, or the binding generator. The bugs that reach you are the subtle ones: a struct whose fields are shifted by 8 bytes because your marshaller classified it wrong, a function that "returns the right value on Linux but garbage on Windows" because the two ABIs return small structs differently, a variadic call that works for `printf("%d")` but crashes for `printf("%f")` because `AL` wasn't set. These require understanding the *classification*, not just the register list.

This page covers: the SysV INTEGER/SSE/MEMORY classification and the 16-byte rule; how `RAX`/`RDX` and `XMM0`/`XMM1` combine to return small structs; the hidden `sret` pointer for large returns and its tie to C++ RVO; how Windows x64 treats structs entirely differently (anything not 1/2/4/8 bytes goes by reference); and the variadic ABI, including the SysV `AL` rule and why variadics are a perennial FFI hazard. Name decoration is mentioned in prose; it has its own topic.

---

## Prerequisites

- **Required:** The middle tier — the three 64-bit conventions, caller/callee-saved tables, alignment, shadow space, red zone.
- **Required:** Solid C struct layout knowledge: size, alignment, padding, `offsetof`.
- **Helpful:** Familiarity with `va_list`, `va_start`, `va_arg`, `va_end`.
- **Helpful:** Having generated FFI glue or read a binding generator's output (cgo, bindgen, SWIG).

You do **not** yet need:

- ABI versioning, symbol versioning, and large-scale compatibility policy (that's `professional.md`).
- Exception-unwinding/`.eh_frame` interaction (`professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Eightbyte** | An aligned 8-byte chunk of an aggregate. SysV classifies aggregates one eightbyte at a time. |
| **INTEGER class** | An eightbyte passed in a general-purpose register (RDI, RSI, …). |
| **SSE class** | An eightbyte passed in an XMM register. |
| **MEMORY class** | An eightbyte (and thus the whole aggregate) that must be passed on the stack. |
| **Classification algorithm** | The SysV procedure that assigns each eightbyte a class, merges, and post-processes to decide register vs stack. |
| **16-byte rule** | SysV: aggregates larger than 16 bytes (two eightbytes) are MEMORY — passed on the stack. (Also any with unaligned fields, etc.) |
| **`sret` / structure return** | Returning a large aggregate: the caller allocates space and passes a hidden pointer to it (in `RDI` on SysV / `RCX` on Windows), shifting the real arguments down one register. |
| **RVO / NRVO** | (Named) Return Value Optimization — the compiler constructs the returned object directly in the caller's `sret` slot, avoiding a copy. The ABI's hidden-pointer return is what makes it possible. |
| **Variadic function** | A function taking a variable number of arguments (`printf(const char*, ...)`). |
| **`va_list`** | The opaque cursor (`<stdarg.h>`) used to walk variadic arguments. |
| **`AL` rule** | SysV: for a variadic call, `AL` must hold the number of vector (XMM) registers used by the variadic arguments, so the prologue saves the right ones. |
| **Register save area** | The block a variadic callee fills in its prologue (from the arg registers + saved XMMs) so `va_arg` can fetch later. |
| **HFA / HVA** | Homogeneous Float/Vector Aggregate — AArch64's special case: a struct of up to 4 identical float/vector members passed in consecutive V registers. |

---

## Core Concepts

### 1. The SysV classification algorithm (the heart of struct passing)

To pass or return a struct on SysV AMD64, the ABI runs this procedure:

1. **If the aggregate is larger than 16 bytes** (more than two eightbytes), or has unaligned fields, the whole thing is **MEMORY** → passed on the stack (and for returns, via `sret`).
2. **Otherwise**, split it into one or two eightbytes. Classify each eightbyte:
   - If *every* field overlapping that eightbyte is a float/double → **SSE**.
   - If *any* field overlapping it is an integer/pointer → **INTEGER**.
3. **Merge** the per-field classes within each eightbyte (INTEGER wins over SSE if they mix in the same eightbyte).
4. **Post-merge fixups** (e.g., if either eightbyte ended up MEMORY, the whole thing is MEMORY).
5. **Assign registers:** each INTEGER eightbyte consumes the next integer register (`RDI`→`RSI`→…), each SSE eightbyte the next XMM. **If not enough registers remain, the whole aggregate goes to MEMORY** (it is not split across registers and stack).

The consequences are deeply non-obvious:

```c
struct A { float x, y; };          // 8 bytes, one SSE eightbyte → ONE xmm reg
struct B { double a; double b; };  // 16 bytes, two SSE eightbytes → XMM0, XMM1
struct C { long a; double b; };    // 16 bytes: int8b → RDI, sse8b → XMM0 (!)
struct D { long a, b, c; };        // 24 bytes → MEMORY, on the stack
struct E { int a; float b; };      // 8 bytes, mixed in one eightbyte → INTEGER (RDI)
```

Look at `struct A`: two `float`s pack into one eightbyte that is all-float → **SSE** → passed in **one** `XMM` register (the two floats packed into its low 64 bits). Look at `struct C`: the first eightbyte is integer (`long`), the second is float (`double`), so it's passed split across `RDI` and `XMM0`. And `struct E` mixes an int and a float in the *same* eightbyte, so the merge rule makes it **INTEGER** — both fields ride in `RDI`. No casual observer would predict these.

### 2. Returning small structs: registers; large structs: `sret`

For **returns**, SysV runs the same classification on the return type:

- ≤ 16 bytes → comes back in `RAX`/`RDX` (INTEGER eightbytes) and/or `XMM0`/`XMM1` (SSE eightbytes), per classification. So `struct {int x, y;}` returns in `RAX`, and `struct {double a, b;}` returns in `XMM0:XMM1`.
- \> 16 bytes (MEMORY) → **the caller allocates the storage and passes a hidden pointer to it as an implicit first argument.** The function writes the result through that pointer and returns the pointer in `RAX`. This implicit pointer is called **`sret`** (structure return). Crucially, **it shifts every real argument down one integer register**: the real first argument now lands in `RSI`, not `RDI`.

```c
struct Big { double m[8]; };  // 64 bytes > 16  → sret
struct Big make(int seed);
// At the machine level this behaves like:
// void make(struct Big *hidden_ret /* RDI */, int seed /* RSI */);
```

This is the same mechanism C++ uses for **RVO/NRVO**: the compiler constructs the returned object *directly* in the caller-provided `sret` slot, so there's no copy on return. The ABI's hidden-pointer rule is precisely what makes (N)RVO an ABI-level guarantee rather than just an optimization.

### 3. Windows x64 handles structs completely differently

Windows x64 has no eightbyte classification. The rule is brutally simple and *different*:

- A struct/union is passed **by value in a single register only if its size is exactly 1, 2, 4, or 8 bytes**.
- **Anything else** (3, 5, 6, 7 bytes, or > 8 bytes) is passed **by reference**: the caller copies it to a temporary and passes a *pointer* in the argument register.
- Returns: a struct that is 1/2/4/8 bytes comes back in `RAX`; otherwise the caller allocates and passes a hidden pointer (in `RCX`), shifting real args down — same idea as `sret`, different register.

So `struct {double a, b;}` (16 bytes) is passed **in two XMM registers on SysV** but **by reference (a pointer) on Windows**. A marshaller that copies the SysV behavior to Windows shifts fields catastrophically. "Returns the right struct on Linux, garbage on Windows" is almost always this.

### 4. AArch64: HFAs and the indirect-return pointer

AArch64 adds the **Homogeneous Float Aggregate (HFA)** case: a struct of up to four members *all* of the same floating/vector type is passed in consecutive `V` registers (so `struct {float x, y, z;}` → `V0, V1, V2`). Other small aggregates (≤ 16 bytes) go in `X` registers; larger ones are passed indirectly. Large returns use the dedicated indirect-result register `X8` (the caller puts the result address there before the call).

### 5. Variadic functions: how `printf` really works

A variadic function declares only its fixed parameters; the rest arrive "somehow," and `<stdarg.h>` walks them. Under the hood on SysV:

- Fixed arguments occupy registers as usual. Variadic arguments *also* go in the remaining argument registers (and then the stack), classified the same way.
- The callee's prologue, if it ever calls `va_start`, **spills all the argument registers into a "register save area"** on its own stack — all six integer registers and (potentially) all eight XMM registers — so `va_arg` can later fetch them by index.
- **The `AL` rule:** to avoid spilling eight XMMs on every variadic call, the *caller* sets `AL` to the **number of vector registers actually used** by the variadic arguments. The prologue checks `AL` and saves only that many XMMs. If `AL` is wrong (e.g., you call a variadic function through a mismatched pointer and `AL` isn't set), the callee may not save the XMM holding a `double` argument, and `va_arg(ap, double)` returns garbage.

```asm
; SysV call: printf("%d %f\n", 42, 3.14);
lea  rdi, [fmt]        ; format string  → RDI
mov  esi, 42           ; "%d" arg       → RSI (integer)
movsd xmm0, [pi]       ; "%f" arg       → XMM0 (one vector reg used)
mov  al, 1             ; <-- number of vector registers used: 1
call printf
```

That `mov al, 1` is mandatory and invisible in C source. Omit it (as a hand-written or mis-generated call easily does) and floating variadic arguments break.

On **Windows x64**, variadics are simpler and stricter: floating-point variadic arguments are passed in **both** the integer register *and* the XMM register (the callee reads whichever it needs), and there's no `AL` rule. AArch64 has its own variadic register-save layout. So the *one* construct — `printf` — has three different ABIs, which is exactly why hand-rolling variadic FFI is a recurring source of bugs.

### 6. Why FFI tools must encode all of this — and the name-decoration tie-in

A binding generator or marshaller can't just "pass the bytes." To call `f(struct C c)` correctly it must run the classification to know `c` occupies `RDI` *and* `XMM0`. To call a function returning `struct Big` it must allocate the `sret` slot and shift arguments. To call `printf` it must set `AL`. Get any of these wrong and there is no diagnostic — only shifted fields or garbage floats. This is why robust FFI defers to the C compiler (e.g., generating a C shim) rather than reimplementing the ABI.

Closely related is **name decoration / mangling** (its own topic): the symbol name a function is exported under often *encodes* part of the convention. On 32-bit Windows, stdcall names are decorated with `@N` (the argument byte count), cdecl with a leading underscore, fastcall with `@`-prefix — so the linker can catch some convention mismatches. C++ mangling encodes parameter types entirely. The convention and the symbol name are two halves of the same binary contract; FFI must respect both.

---

## Real-World Analogies

**Sorting luggage by shape, not just count.** Scalar arguments are identical suitcases — drop each on the next belt. Structs are oddly shaped freight: the ABI inspects each piece, decides "this 8-byte all-float chunk rides belt SSE, that mixed chunk rides belt INTEGER, that 24-byte crate is too big — put it in the cargo hold (stack)." The classification *is* this shape-sorting, and the rules are surprising precisely because freight is irregular.

**Mailing something too big for the slot (`sret`).** You can hand back a postcard through the mail slot (`RAX`). You cannot push a wardrobe through it. So the convention says: *you* (the caller) clear out a room and slip the mover a note saying where to put it (`sret` pointer). The mover assembles the wardrobe directly in your room — no double-handling. That "no double-handling" is RVO.

**A buffet where you must announce your tray count (`AL`).** A variadic callee is a kitchen that pre-plates dishes. To avoid plating all eight, it asks: "how many hot dishes (vector args) are you taking?" `AL` is your answer. Lie or forget, and your soufflé (a `double`) never gets plated — `va_arg` serves you an empty plate (garbage).

---

## Mental Models

### Model 1: Classification is a per-eightbyte state machine

Don't think "struct → register." Think "split into eightbytes → classify each (SSE if all-float, else INTEGER) → too big or won't fit ⇒ MEMORY → assign from the right register file." Running this in your head for any struct tells you exactly which registers it lands in.

### Model 2: A large return is a hidden out-parameter

Rewrite `Big f(args)` mentally as `void f(Big* out, args)` with `out` in the first integer register and a pointer echoed back in `RAX`. Once you see returns-by-value-of-large-types as out-parameters, `sret`, RVO, and the argument-shift all become obvious.

### Model 3: Variadics are "registers spilled to an array the callee indexes"

`va_arg` is array indexing over the register-save area plus the overflow stack area. `va_start` records where that array begins; each `va_arg` advances a cursor and may switch from the saved-register region to the stack region. `AL` decides how much of that array got populated.

### Model 4: SysV and Windows disagree most on aggregates

For scalars the platforms differ in *which* register. For aggregates they differ in *the entire model* (classification vs by-reference-unless-1/2/4/8). Aggregates are where "it worked on the other OS" bugs concentrate.

---

## Code Examples

### Watching a struct land in two register files (SysV)

```c
// classify.c
struct C { long a; double b; };     // INTEGER eightbyte + SSE eightbyte
long use(struct C c) { return c.a + (long)c.b; }
```

```bash
gcc -O2 -S classify.c -o -      # read the assembly
```

`use` reads its argument from **both** `RDI` (the `long`) and `XMM0` (the `double`) — proof that one struct argument was split across the integer and SSE register files:

```asm
use:
    cvttsd2si rax, xmm0    ; (long)c.b  — b came in XMM0
    add       rax, rdi     ; + c.a      — a came in RDI
    ret
```

### Two floats in one XMM register

```c
struct A { float x, y; };           // 8 bytes, one all-float eightbyte
float sumA(struct A a) { return a.x + a.y; }
```

`sumA` receives the whole struct in `XMM0` (the two floats packed into its low 64 bits) and uses `movshdup`/`addss` to add them — never touching an integer register. A marshaller that passes `x` in `XMM0` and `y` in `XMM1` is wrong.

### A large return becomes a hidden pointer

```c
struct Big { double m[8]; };        // 64 bytes > 16 → sret
struct Big scaled(double k);
```

The caller side compiles to (conceptually):

```asm
    lea  rdi, [result_slot]   ; hidden sret pointer  → RDI
    movsd xmm0, [k]           ; real first arg 'k'   → XMM0 (NOT shifted; it's SSE)
    call scaled               ; scaled writes through RDI, returns RDI in RAX
    ; result lives in [result_slot]
```

For a returned-large-struct function with an integer first argument, that integer argument moves from `RDI` to `RSI` because `sret` consumed `RDI`. Tools must account for the shift.

### The `AL` register on a variadic call

```c
extern int printf(const char *, ...);
int main(void) { return printf("%d %.2f\n", 7, 2.5); }
```

```asm
    lea   rdi, [fmt]
    mov   esi, 7
    movsd xmm0, [two_point_five]
    mov   al, 1            ; one vector register used by varargs
    call  printf
```

Delete the `mov al, 1` (e.g., by calling through a `void(*)()` cast that drops the prototype) and the `%f` reads garbage on SysV — a textbook variadic-FFI failure.

### Same struct, opposite ABI on Windows

```c
struct P { double a, b; };          // 16 bytes
double sum(struct P p);
```

- **SysV:** `p.a` in `XMM0`, `p.b` in `XMM1` (two SSE eightbytes).
- **Windows x64:** the caller copies `p` to a temporary and passes a **pointer** to it in `RCX`; the callee dereferences it.

An FFI binding must branch on the target OS here, or fields silently transpose.

---

## Pros & Cons

**SysV eightbyte classification:**

- ✅ Packs small structs efficiently into registers (often zero memory traffic).
- ✅ Splits hybrid structs across register files for speed.
- ❌ Complex and surprising; reimplementing it correctly in a marshaller is genuinely hard.
- ❌ Tiny source changes (adding a field, reordering) silently change the ABI of a function.

**Windows by-reference-unless-1/2/4/8:**

- ✅ Dead simple to implement and reason about.
- ❌ Extra copies and indirection for common 16-byte structs; less efficient.

**`sret` / RVO:**

- ✅ Eliminates the return copy for large objects; enables guaranteed RVO.
- ❌ Shifts argument registers; an easy thing for tools and hand assembly to miss.

**SysV variadic `AL` rule:**

- ✅ Avoids spilling eight XMMs on every variadic call.
- ❌ A hidden, prototype-derived requirement that breaks the moment the prototype is lost.

---

## Use Cases

- **Writing binding generators / marshallers** (cgo, Rust `bindgen`, .NET interop, JNA): must replicate classification, `sret`, and the `AL` rule per platform.
- **Generating C shims at the FFI boundary** so the *C compiler* applies the ABI, sidestepping manual classification.
- **Implementing a JIT or codegen backend** that lowers calls to the platform ABI for structs and returns.
- **Diagnosing field-shift bugs** where a returned/passed struct's fields are off by 8 bytes — a classification or `sret` mistake.
- **Porting variadic-using FFI** (anything wrapping `printf`-family or custom variadic C APIs) across OSes.

---

## Coding Patterns

### Pattern 1: Prefer pointers to structs across the FFI boundary

Passing/returning structs *by value* drags in the full classification. Passing a *pointer* to a struct is trivially portable — it's just an integer argument. When you control both sides of an FFI, prefer `void f(const Foo *in, Foo *out)` over by-value aggregates.

```c
// Portable and ABI-trivial: pointers only.
void transform(const struct Vec3 *in, struct Vec3 *out);
```

### Pattern 2: Generate a C shim instead of hand-classifying

Let the compiler own the ABI: emit a tiny C function with the real signature and call *that* from your runtime via a uniform pointer-based interface.

```c
// Generated shim — the C compiler applies classification/sret/AL for you.
void shim_make(struct Big *out) { *out = make(SEED); }
```

### Pattern 3: Wrap variadics behind a fixed-arity `va_list` entry point

Don't FFI a variadic function directly. Call its `v`-suffixed sibling (`vprintf`, `vsnprintf`) which takes a `va_list` you build deliberately, removing the `AL`/register-spill guesswork.

### Pattern 4: Pin the struct layout that the ABI depends on

Because adding or reordering a field silently changes a by-value struct's ABI, freeze such structs (explicit padding, `static_assert(sizeof(...) == ...)`, no casual edits) when they cross an FFI boundary.

---

## Best Practices

- **Run the classification mentally (or with the compiler) before trusting a by-value struct's register placement.** Never assume "each field gets its own register."
- **Branch on OS for aggregate passing/returning.** SysV and Windows use entirely different models; AArch64 adds HFAs.
- **Model large returns as a hidden first-argument out-pointer**, and remember it shifts the real arguments down a register.
- **Always set `AL` correctly for SysV variadic calls** — or avoid hand-emitting them; use the `va_list` variant.
- **Prefer pointer-to-struct over struct-by-value at FFI boundaries** for portability and to avoid classification entirely.
- **Generate C shims and let the C compiler apply the ABI** rather than reimplementing it.
- **Treat the symbol name as part of the contract:** stdcall decoration, C++ mangling, and the convention must all line up (see the name-decoration topic).
- **Verify with the disassembler.** For any struct argument or return, confirm in the assembly which registers and/or `sret` slot are actually used.

---

## Edge Cases & Pitfalls

### Pitfall 1: Adding a field silently changes a function's ABI

`struct {int a; int b;}` returns in `RAX`; add a third int and it's 12 bytes (still ≤ 16, two eightbytes → `RAX:RDX`); add a fifth and it's > 16 → `sret`. A "trivial" struct edit can flip the calling convention of every function using it. Recompile *all* sides.

### Pitfall 2: Assuming each struct field gets its own register

`struct {float x, y;}` is *one* XMM register, not two; `struct {int a; float b;}` is *one* integer register (the float merges to INTEGER). Marshallers that assign per-field corrupt the layout.

### Pitfall 3: Forgetting the `sret` argument shift

When a function returns a MEMORY-class struct, the hidden pointer takes `RDI`, so the declared first argument is actually in `RSI`. Hand-written callers that load the first arg into `RDI` overwrite the `sret` pointer.

### Pitfall 4: Copying SysV struct rules to Windows (or vice versa)

A 16-byte struct goes in two registers on SysV but *by reference* on Windows. Returns differ too. This is the canonical "right on Linux, garbage on Windows" struct bug.

### Pitfall 5: Variadic `AL` not set / prototype lost

Calling a variadic function through a non-variadic function-pointer cast drops the `AL` setup; floating variadic arguments then read garbage on SysV. Keep the variadic prototype, or use the `va_list` variant.

### Pitfall 6: `va_arg` type mismatch and default promotions

Variadic arguments undergo default argument promotions (`float`→`double`, small ints→`int`). `va_arg(ap, float)` is undefined — you must use `va_arg(ap, double)`. Mismatching the type desynchronizes the cursor and corrupts every subsequent fetch.

### Pitfall 7: AArch64 HFA surprises

`struct {float x, y, z;}` occupies `V0, V1, V2` on AArch64 (an HFA) but is handled by eightbyte classification on SysV x86-64. Cross-arch marshallers need an HFA branch.

---

## Cheat Sheet

```text
SYSV STRUCT CLASSIFICATION
  > 16 bytes (or unaligned)        → MEMORY (stack; sret for return)
  else split into 1-2 eightbytes:
    eightbyte all float/double     → SSE   → next XMM
    eightbyte has any int/pointer  → INTEGER → next GP reg
    (mixed in same eightbyte → INTEGER wins)
  not enough registers left        → whole thing → MEMORY

  struct{float x,y}     -> 1 XMM (packed pair)
  struct{double a,b}    -> XMM0, XMM1
  struct{long a;double b} -> RDI + XMM0
  struct{int a;float b} -> RDI (merged INTEGER)
  struct{long a,b,c}    -> MEMORY (stack)

RETURNS
  <=16 bytes  -> RAX/RDX and/or XMM0/XMM1 by classification
  >16  bytes  -> sret: caller allocs, hidden ptr in RDI, returned in RAX
                 (shifts real args: 1st arg -> RSI)
  == C++ (N)RVO mechanism

WINDOWS x64 STRUCTS
  size 1/2/4/8  -> by value in one register
  anything else -> BY REFERENCE (caller copies, passes pointer)
  large return  -> hidden pointer in RCX

AArch64
  HFA (<=4 same float/vector members) -> consecutive V regs
  large return -> address in X8

VARIADICS (SysV)
  set AL = number of vector (XMM) regs used by varargs
  callee spills arg regs to a save area; va_arg indexes it
  default promotions: float->double, small int->int
  Windows: float varargs in BOTH gp and xmm reg; no AL
```

---

## Summary

Scalar arguments are a lookup; **aggregates are an algorithm.** On SysV AMD64, passing or returning a struct runs the **INTEGER/SSE/MEMORY classification**: structs > 16 bytes go to memory; smaller ones split into eightbytes that ride in integer or XMM registers depending on whether each 8-byte chunk is all-float or contains any integer/pointer — producing genuinely unguessable placements like "two floats in one XMM" and "this 16-byte struct split across `RDI` and `XMM0`." Returning a large struct uses no register at all: the caller allocates space and passes a hidden **`sret`** pointer (shifting the real arguments down a register), the same mechanism that makes C++ **RVO** an ABI guarantee.

Windows x64 throws all of that out and uses a flat rule — by value only if 1/2/4/8 bytes, otherwise by reference — so a 16-byte struct that travels in two registers on Linux travels as a pointer on Windows. AArch64 adds HFAs and an `X8` result pointer. **Variadics** add a final hazard: SysV requires the caller to set `AL` to the number of vector registers used, or the callee's `va_arg` machinery returns garbage for floating arguments — and Windows and AArch64 handle variadics differently again.

The practical upshot for FFI: don't reimplement the ABI by hand. Prefer pointers over by-value structs, generate C shims so the compiler applies classification, route variadics through `va_list` entry points, branch on OS for aggregates, and verify everything in the disassembler. The next tier covers ABI *stability* — versioning, symbol versioning, and the compatibility policy that keeps all of this from breaking across releases.

---

## Further Reading

- *System V AMD64 ABI*, §3.2.3 "Parameter Passing" — the full classification algorithm and `sret` rules, plus the variadic register-save-area diagram.
- Microsoft, "x64 calling convention" — the 1/2/4/8 struct rule and indirect passing.
- Arm, *AAPCS64*, the HFA/HVA rules and `X8` indirect result register.
- ISO C `<stdarg.h>` semantics and default argument promotions.
- Clang/GCC source: the `X86_64ABIInfo` / target ABI lowering — a reference implementation of the classification.

---

## Diagrams & Visual Aids

### SysV classification decision flow

```text
   aggregate
       │
  size > 16 bytes? ──yes──► MEMORY (stack; sret on return)
       │ no
   split into eightbytes
       │
   for each eightbyte:
     all fields float/double? ──yes──► SSE  → next XMM
              │ no
              └──────────────────────► INTEGER → next GP reg
       │
  enough registers left? ──no──► MEMORY (whole aggregate)
       │ yes
   pass in assigned registers
```

### A hybrid struct splitting across register files

```text
   struct C { long a;  double b; }   (16 bytes, two eightbytes)

   eightbyte 0: long a   → INTEGER → RDI
   eightbyte 1: double b → SSE     → XMM0

   one argument, two different register files.
```

### Large return via sret

```text
   struct Big make(int seed);    // 64 bytes

   rewritten by the ABI as:
   void make(Big* sret /*RDI*/, int seed /*RSI*/);
                  │                    │
   caller-allocated slot         shifted: was RDI, now RSI
   make() writes through RDI, returns RDI in RAX
```

### Variadic register-save area (SysV)

```text
   printf(fmt, 7, 2.5)   with  AL = 1

   prologue spills:
     [save area] RDI RSI RDX RCX R8 R9   (gp regs)
                 XMM0                      (AL says save 1 of 8)
   va_start → cursor at start of save area
   va_arg(int)    → reads RSI slot, advances
   va_arg(double) → reads XMM0 slot, advances
   (overflow args continue on the incoming stack)
```

### Same 16-byte struct, two ABIs

```text
   struct P { double a, b; };

   SysV:    a → XMM0 , b → XMM1        (in registers, by value)
   Win x64: &copy_of_p → RCX           (by reference, a pointer)
```
