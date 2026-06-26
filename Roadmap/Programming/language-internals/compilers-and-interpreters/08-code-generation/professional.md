# Code Generation — Professional Level

> **Topic:** [Code Generation](README.md)
> **Focus:** Table-driven back ends (LLVM TableGen target descriptions), JIT code generation and patching, position-independent code, machine-level peephole optimization, and DWARF debug-info generation — the engineering that makes a back end shippable.

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

---

## Introduction

> Focus: **What does it take to ship a real back end — and to debug it in production?** Algorithms are necessary but not sufficient. A production back end is mostly *engineering*: target descriptions you can maintain, JIT machinery that generates code while the program runs, and debug info that survives optimization.

The senior page laid out the frameworks. This page is about the parts that don't appear in textbooks but consume most of a back-end engineer's time:

- **Target description tables.** No serious back end hand-codes every instruction's encoding, latency, and selection pattern. LLVM uses **TableGen**: a declarative DSL describing registers, instructions, calling conventions, and scheduling models, from which the build generates C++. Adding an ISA extension is largely a TableGen exercise.
- **JIT code generation.** A JIT is a code generator that runs *inside* the program, turning hot bytecode/IR into machine code at runtime, writing it into an executable **code cache**, and sometimes **patching** it in place (inline caches, deoptimization, on-stack replacement). The constraints — compile time *is* run time, code must be made executable safely, threads may be running the code you're patching — are unlike any ahead-of-time concern.
- **Position-independent code (PIC).** Shared libraries and ASLR require code that runs at any load address, which changes how the back end emits address references (GOT/PLT, `rip`-relative addressing). (The dynamic-linking side of this is its own topic.)
- **Machine-level peephole.** The last cleanup pass over real instructions: redundant moves, strength reductions, branch simplifications, target-specific idioms.
- **DWARF debug info.** Keeping the mapping from optimized machine code back to source lines, variable locations (which move between registers and stack as live ranges split), and unwind tables — generated *by the back end* alongside the code.

> 🎓 **Why this matters at this level:** When you own a back end, your job is bring-up (describe the target), runtime performance (the JIT), and debuggability (DWARF that doesn't lie about optimized code). A miscompile traced to a wrong TableGen encoding, a JIT crash from patching code another thread is executing, or a debugger showing the wrong variable value at `-O2` — these are professional-grade problems, and they live here.

---

## Prerequisites

- **Required:** The senior page — SelectionDAG/GlobalISel, SSA-based allocation, scheduling, ABI lowering, target differences.
- **Required:** Comfort with object-file concepts: sections, symbols, relocations.
- **Required:** A working model of dynamic linking and virtual memory (load addresses, page permissions).
- **Helpful but not required:** Exposure to a JIT (HotSpot, V8, LLVM ORC/MCJIT, LuaJIT) or to writing TableGen.
- **Helpful but not required:** Having read DWARF or used a debugger on optimized code and noticed `<optimized out>`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **TableGen** | LLVM's declarative DSL describing targets (registers, instructions, encodings, patterns, scheduling, calling conventions); the build generates C++ from it. |
| **MC layer** | LLVM's machine-code layer: assembling `MCInst`s into bytes, emitting object files, handling relocations and the integrated assembler. |
| **Code cache** | The executable memory region a JIT writes generated code into. |
| **Inline cache (IC)** | A JIT call-site optimization caching the resolved target of a dynamic dispatch, patched as types are observed. |
| **OSR (On-Stack Replacement)** | Swapping a running function's frame from interpreted/unoptimized to optimized code (or back, "deopt") while it executes. |
| **Deoptimization** | Falling back from optimized code to a safe (interpreter/unoptimized) version when a speculative assumption breaks. |
| **PIC (Position-Independent Code)** | Code that executes correctly regardless of its load address. |
| **GOT / PLT** | Global Offset Table / Procedure Linkage Table: indirection tables enabling PIC access to globals and functions. |
| **`rip`-relative addressing** | x86-64 addressing relative to the instruction pointer, the basis of efficient PIC. |
| **Relocation** | A placeholder in emitted code/data that the linker or loader fills with a final address. |
| **Peephole optimization** | A late pass rewriting short windows of machine instructions into better equivalents. |
| **DWARF** | The standard debug-info format: line tables, variable location lists, type info, and call-frame information (CFI) for unwinding. |
| **CFI (Call Frame Information)** | DWARF data describing how to unwind the stack at each instruction (where the return address and saved registers are). |
| **Location list** | DWARF data describing where a variable lives (which register or stack slot) *over each range of instructions*, since it moves. |
| **W^X** | "Write XOR Execute": a memory page is writable or executable, never both at once — a JIT security constraint. |

---

## Core Concepts

### 1. Table-Driven Back Ends: TableGen

A back end describes thousands of instructions, dozens of registers, multiple calling conventions, and a scheduling model. Hand-writing the C++ for all of that is unmaintainable, so LLVM uses **TableGen**, a declarative DSL. You write records describing:

- **Registers and register classes:** which physical registers exist, how they alias (e.g. `al`/`ax`/`eax`/`rax` overlap), and which classes are allocatable.
- **Instructions:** operands, the **bit-level encoding**, assembly syntax, and **selection patterns** (the IR DAG shape this instruction matches, e.g. `(add GPR:$a, GPR:$b)`).
- **Calling conventions:** which registers carry which argument/return classes, declaratively.
- **Scheduling model:** per-instruction latency and functional-unit (port) usage for each subtarget.

The build runs `llvm-tblgen` to generate C++: the instruction selector's matcher tables, the encoder/decoder, the register info, and the scheduling tables. The payoff: **adding an ISA extension** (say a new RISC-V vector instruction) is mostly *adding TableGen records*, and the matcher, encoder, and disassembler regenerate consistently. The cost: TableGen is its own learning curve, and a wrong encoding record produces bytes that *assemble* but execute as the wrong instruction — a particularly nasty miscompile.

### 2. JIT Code Generation: Compile Time Is Run Time

A JIT generates machine code while the program runs. The defining constraint is that **compilation time is part of execution time** — every cycle spent compiling is a cycle not spent running. This reshapes every earlier decision:

- **Tiered compilation.** Start interpreting or compiling with a fast, low-quality compiler (HotSpot C1, V8 Sparkplug/Maglev), and only invest in expensive optimization (HotSpot C2, V8 TurboFan) for code proven *hot* by profiling. The first tier uses cheap codegen — **linear-scan allocation**, minimal scheduling — precisely because compile speed dominates.
- **Code cache management.** Generated code lives in an executable region (the **code cache**). It must be allocated, made executable, kept within a budget (evicting cold code), and protected. Modern OSes enforce **W^X**: you write code to a writable mapping, then flip it to executable (or use dual mappings), never both at once — a security requirement (and an Apple Silicon hard rule).
- **Instruction-cache coherence.** After writing new code, you must flush/invalidate the instruction cache on architectures where I-cache and D-cache aren't coherent (ARM needs explicit cache maintenance + `isb`; x86 is largely coherent for this). Forget it and the CPU executes stale bytes.

### 3. JIT Patching: Inline Caches, OSR, Deopt

JITs don't just emit code once — they **patch** it as the program's behavior is observed:

- **Inline caches** at dynamic call sites: the first time a `obj.method()` resolves, the JIT patches the call site to a fast path assuming that receiver type, with a guard. Monomorphic → polymorphic → megamorphic transitions are patches to live code.
- **On-Stack Replacement (OSR):** a long-running loop in interpreted code can be swapped to optimized code *mid-execution*, reconstructing the optimized frame from the interpreter state. The reverse, **deoptimization**, swaps optimized back to safe code when a speculative assumption (a guard) fails.
- **Patching live code is concurrency-hard.** Other threads may be executing the very instructions you're rewriting. Techniques: patch only at safepoints, use atomically-writable patch points (a single aligned instruction-sized write), or stop the world. A torn patch — another thread fetching a half-written instruction — is catastrophic.

### 4. Position-Independent Code

Shared libraries and ASLR-enabled executables must run at any address. The back end can't bake absolute addresses into the code, so it emits **position-independent** references:

- **`rip`-relative addressing** (x86-64): reference a global as an offset from the current instruction pointer, so the same bytes work at any load address. AArch64 uses `adrp`+`add` (page-relative).
- **GOT (Global Offset Table):** for symbols whose address isn't known until load time, the code reads the address from a per-process table the loader fills in.
- **PLT (Procedure Linkage Table):** lazy-bound stubs for cross-library calls.

The back end's job is to emit the right *relocation* for each reference so the assembler/linker/loader can complete it. (The full dynamic-linking mechanics — lazy binding, symbol interposition — are covered elsewhere in this roadmap.) PIC has a small cost (an extra indirection for GOT accesses) that the back end and ABI try to minimize.

### 5. Machine-Level Peephole Optimization

After selection, allocation, and scheduling, a final **peephole** pass scans short windows of real instructions and rewrites obvious waste:

- Delete a `mov rax, rax` or a `mov` whose result is immediately overwritten.
- Combine `shl` + `add` into `lea`, or two adds into one.
- Replace `cmp x, 0; je` with `test x, x; jz`, or fold a compare into a flag-setting arithmetic instruction.
- Strength-reduce a multiply-by-constant into shifts/`lea` if selection missed it.
- Simplify branch chains and remove jumps to the next instruction.

Peephole is *local* (a few instructions) and *target-specific* (it knows the ISA's idioms). It's a cheap, high-yield cleanup that catches what the bigger passes left behind.

### 6. DWARF Debug-Info Generation

Debuggers and profilers need to map machine code back to source — and the back end must produce that mapping *as it generates code*, accurately even after optimization. DWARF carries:

- **Line table:** which source line each instruction address belongs to. Optimization scrambles this (scheduling reorders, inlining mixes functions), so the line table is intricate and approximate at `-O2`.
- **Variable location lists:** *where* each variable lives over each instruction range. Because the allocator splits live ranges, a single variable may be in `rax` here, on the stack there, and **`<optimized out>`** where it's dead. The location *list* (not a single location) encodes this movement.
- **Call Frame Information (CFI):** how to unwind the stack at every instruction — where the return address and saved registers are *right now*, accounting for prologue/epilogue and frame-pointer omission. This is what makes backtraces work when there's no frame-pointer chain.

DWARF is generated by the back end because only the back end knows the final code layout, the register/stack assignments, and the schedule. Keeping it correct under optimization is a continuous engineering tax — and a wrong location list means a debugger confidently shows you the *wrong value*.

### 7. The Full Emit Path: From `MachineInstr` to Bytes

The endgame: selected, allocated, scheduled `MachineInstr`s become bytes via the **MC layer**. It lowers each to an `MCInst`, the encoder produces the instruction bytes (using the TableGen-generated encoder), unresolved references become **relocations**, and the result is written into an object file (ELF/Mach-O/COFF) with its sections (`.text`, `.data`, `.rodata`), symbol table, and the DWARF sections. A JIT does the same in memory, then links and finalizes (resolves relocations against the running process) before flipping the page executable. This integrated-assembler path is why modern compilers don't shell out to a separate `as` — they emit object code directly, faster and with full control over relocations and debug info.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **TableGen** | A parts catalog with exact specs; the factory tooling is generated from the catalog, so adding a part means adding a catalog entry, not retooling by hand. |
| **JIT compile-time-is-run-time** | A chef who must cook *and* invent the recipe while customers wait — elaborate recipes only pay off for popular dishes. |
| **Tiered compilation** | Sketch fast in pencil first; only the keeper drawings get inked and painted. |
| **Code cache / W^X** | A workshop where a bench is either a writing desk or a power-tool station, never both at once, for safety. |
| **Patching live code** | Replacing a train's engine while it's moving, with passengers aboard — only safe at precise, agreed moments. |
| **PIC / `rip`-relative** | Giving directions as "20 meters ahead of where you stand" instead of a fixed street address, so they work from anywhere. |
| **GOT** | A receptionist's lookup sheet of room numbers filled in each morning; code asks the sheet instead of memorizing rooms. |
| **Peephole** | A proofreader fixing "the the" and "go to and return" in already-typeset text. |
| **DWARF location list** | A "where is this employee right now" log that changes by the hour (desk, meeting room, gone home). |
| **CFI unwinding** | A breadcrumb trail for finding your way back up the call stack even when signposts (frame pointers) were removed. |

---

## Mental Models

### The "Generated, Not Written" Model

A maintainable back end is *described*, not *coded*. Registers, encodings, patterns, schedules, calling conventions — all declarative tables from which the implementation is generated. When you think about supporting a new instruction or extension, think "what record do I add," not "what function do I write." This is the difference between a back end you can evolve and one that ossifies.

### The "Run-Time Budget" Model for JITs

For a JIT, hold a stopwatch in mind: every optimization must *earn its compile time*. The whole architecture — interpret first, profile, tier up only the hot 1% — is this stopwatch made structural. Cheap allocation (linear scan), minimal scheduling, and lazy compilation all fall out of "compiling costs the user latency right now."

### The "Three Outputs" Model

The back end emits *three* intertwined outputs, not one: the **machine code**, the **relocations** that finish it at link/load time, and the **debug/unwind info** that explains it. They must agree. A change to code layout that doesn't update DWARF produces a debugger that lies; a missing relocation produces a crash at load. Think of the back end as emitting a consistent triple, always.

---

## Code Examples

### Reading TableGen-Described Instructions

```bash
# LLVM ships the target descriptions; inspect what a target's instructions look like:
# (in an LLVM checkout)
less llvm/lib/Target/X86/X86InstrArithmetic.td      # x86 arithmetic instrs + patterns
less llvm/lib/Target/AArch64/AArch64InstrInfo.td
less llvm/lib/Target/RISCV/RISCVInstrInfo.td

# See the generated matcher/encoder tables:
llvm-tblgen -gen-instr-info  -I llvm/include llvm/lib/Target/RISCV/RISCV.td | less
```

A simplified TableGen instruction record (illustrative) shows the encoding *and* the selection pattern together:

```text
def ADD : RVInstR<0b0000000, 0b000, OPC_OP, (outs GPR:$rd),
                  (ins GPR:$rs1, GPR:$rs2), "add", "$rd, $rs1, $rs2",
                  [(set GPR:$rd, (add GPR:$rs1, GPR:$rs2))]>;
//                  ^encoding fields                  ^selection pattern: matches (add a b)
```

The last bracket is the **DAG pattern** the selector matches; the leading fields are the **bit encoding** the MC layer emits. One record drives selection, encoding, and disassembly.

### A Minimal LLVM ORC JIT (compile and run code at runtime)

```cpp
// Sketch: take an LLVM module, JIT it, run it. (LLVM ORC v2 API, abbreviated.)
auto JIT = cantFail(LLJITBuilder().create());
cantFail(JIT->addIRModule(std::move(ThreadSafeModuleWithMyFunc)));
auto sym = cantFail(JIT->lookup("my_func"));        // triggers codegen on demand
auto *fp = sym.toPtr<int(*)(int)>();
int result = fp(41);                                // runs freshly generated machine code
```

`lookup` is where the back end runs *at runtime*: ORC compiles the requested symbol on demand, writes it into the code cache, resolves relocations against the process, and hands you a callable pointer.

### W^X and I-Cache Flush When Writing Code Yourself

```c
// The bare mechanics a JIT must handle when emitting code into memory.
#include <sys/mman.h>
#include <string.h>

void *emit(const uint8_t *code, size_t n) {
    // 1. Map writable (NOT executable yet) — W^X.
    void *mem = mmap(NULL, n, PROT_READ | PROT_WRITE,
                     MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    memcpy(mem, code, n);
    // 2. Flip to executable (drop write).
    mprotect(mem, n, PROT_READ | PROT_EXEC);
    // 3. On ARM/AArch64, the I-cache is NOT coherent with writes — flush it:
    __builtin___clear_cache((char *)mem, (char *)mem + n);   // no-op on x86, real on ARM
    return mem;   // now safely callable
}
```

Skipping step 3 on AArch64 lets the CPU execute stale instruction bytes — a classic, hard-to-debug JIT failure that "works on x86."

### Seeing PIC vs Non-PIC Codegen

```c
extern int g;
int read_global(void) { return g; }
```

```bash
gcc -O2 -fno-pic -S pic.c -o nopic.s     # absolute: mov eax, [g]
gcc -O2 -fPIC   -S pic.c -o pic.s        # rip-relative / GOT: mov rax, [rip + g@GOTPCREL]; mov eax, [rax]
```

The `-fPIC` version reaches the global through a `rip`-relative GOT load — that extra indirection is the cost of being position-independent.

### Inspecting Generated DWARF

```bash
gcc -O2 -g -c func.c -o func.o
objdump --dwarf=info       func.o | less     # variable/type/scope info
objdump --dwarf=decodedline func.o | less    # the line table (addr -> source line)
readelf --debug-dump=frames func.o | less    # CFI / unwind tables
llvm-dwarfdump --debug-loc func.o            # variable LOCATION LISTS (where each var lives)
```

In `--debug-loc` you'll see a variable described by *multiple* ranges — `DW_OP_reg` (in a register) for one address range, `DW_OP_fbreg` (on the stack) for another, and gaps where it's `<optimized out>`. That movement is live-range splitting reflected into debug info.

### Peephole, Before and After

```text
;; Pre-peephole (selection/allocation left some waste):
    mov   eax, edi
    mov   eax, eax        ; redundant self-move
    add   eax, eax        ; x + x
    cmp   eax, 0
    je    .L1

;; Post-peephole:
    lea   eax, [rdi + rdi] ; x*2 in one instruction
    test  eax, eax         ; cmp-with-0 -> test
    jz    .L1
```

The peephole pass deletes the self-move, strength-reduces `x+x` into a `lea`, and rewrites `cmp ...,0` into the cheaper `test`.

---

## Pros & Cons

| Choice | Pros | Cons |
|--------|------|------|
| **TableGen target description** | Maintainable, consistent matcher/encoder/disassembler; easy ISA extension. | Steep DSL; a wrong encoding assembles but miscompiles; build-time generation. |
| **JIT codegen** | Adapts to runtime behavior, profile-guided, can outperform AOT on dynamic languages. | Compile time hits latency; code-cache and security (W^X) burden; patching is concurrency-hard. |
| **Tiered compilation** | Fast startup + high peak performance. | Complex; deopt/OSR machinery; multiple compilers to maintain. |
| **PIC** | Shared libraries, ASLR, security. | Extra indirection (GOT) cost; more complex relocations. |
| **Peephole** | Cheap, local, high-yield cleanup. | Local scope only; target-specific rules to maintain. |
| **DWARF generation** | Debuggable, profilable, unwindable code even at `-O2`. | Large; hard to keep accurate under optimization; location lists are intricate. |
| **Integrated assembler (MC)** | Fast, full control over relocations/debug info, no external `as`. | The back end owns encoding correctness — bugs are subtle. |

---

## Use Cases

- **Bringing up a new ISA or extension.** Mostly a TableGen exercise: describe registers, instructions, encodings, patterns, calling convention, scheduling model.
- **Building or tuning a language runtime's JIT.** Choosing tiers, allocator (linear scan in the fast tier), code-cache policy, and patch-point design for ICs/OSR/deopt.
- **Shipping shared libraries safely.** Ensuring PIC codegen and correct relocations; minimizing GOT/PLT overhead.
- **Making optimized code debuggable.** Generating DWARF line tables, location lists, and CFI that survive `-O2` so production crashes are diagnosable.
- **Diagnosing a miscompile.** Tracing a wrong result to a bad TableGen encoding, a missed peephole, a torn JIT patch, or a stale I-cache.

---

## Coding Patterns

### Pattern 1: Describe the Target, Don't Hand-Code It

Encode new instructions as TableGen records (encoding + pattern + scheduling) so selection, encoding, and disassembly stay in sync. Resist one-off C++ special cases; they drift.

### Pattern 2: Make the Fast JIT Tier Genuinely Fast

In the first tier, use linear-scan allocation, skip expensive scheduling, and compile lazily. Spend optimization budget only on profiled-hot code in upper tiers. The tier boundary is where the run-time budget is enforced.

### Pattern 3: Patch Only at Safe, Atomic Points

Design patch points so a rewrite is a single aligned, atomically-visible store (or only happens at a safepoint where no thread is mid-instruction). Never tear an instruction another thread can fetch.

### Pattern 4: Always Flush the I-Cache After Emitting Code

On non-x86 targets, follow every code write with an I-cache clear/`isb` (`__builtin___clear_cache` or the platform call). Bake it into the emit primitive so it's never forgotten.

### Pattern 5: Generate DWARF Alongside Code, Not After

Emit line, location, and CFI info *as* you lay out instructions and assign registers, when the truth is known. Reconstructing it afterward is lossy — especially location lists across split live ranges.

### Pattern 6: Keep Peephole Rules Verified

Each peephole rewrite must be provably semantics-preserving on the target (flags, side effects, encodings). Test them with differential execution; a "clever" peephole that drops a flag side effect is a miscompile.

---

## Best Practices

- **Treat the back end as emitting a consistent triple:** code, relocations, debug/unwind info. A change to one demands updating the others.
- **For JITs, budget compile time explicitly.** Tier, profile, and compile lazily; never run an AOT-grade optimizer on cold code at runtime.
- **Honor W^X and I-cache coherence unconditionally.** They're not optional on modern OSes/CPUs; encode them in the emit path, not as afterthoughts.
- **Make patch points atomic and safepoint-aware.** Concurrency correctness of live-code patching outranks its performance.
- **Emit PIC by default for libraries;** minimize GOT indirections via `rip`-relative/`adrp` where the symbol is local.
- **Run a final peephole, but verify every rule.** Cheap wins, but only if each rewrite is proven on the target ISA.
- **Keep DWARF honest under optimization.** A location list that says a value is in `rax` when it's actually spilled makes the debugger lie — worse than no info. Test debug info, not just code.
- **Validate encodings against a disassembler.** Round-trip every TableGen-described instruction (assemble → disassemble) to catch wrong encoding fields before they ship as silent miscompiles.

---

## Edge Cases & Pitfalls

- **A wrong TableGen encoding assembles fine and runs wrong.** The bytes are valid for *some* instruction — just not the one you meant. Round-trip testing (assemble/disassemble) is the only reliable guard.
- **JIT patching races.** Rewriting code another thread is executing, without atomicity or a safepoint, lets that thread fetch a half-written instruction — an unreproducible crash. The bug is timing, not logic.
- **Forgetting the I-cache flush.** Works on x86 (coherent), crashes mysteriously on ARM/AArch64/RISC-V where I-cache isn't coherent with stores. "Works on my Intel laptop, fails on the phone" is the signature.
- **W^X violations on hardened platforms.** Allocating RWX memory fails outright on Apple Silicon and hardened Linux. The JIT must use write-then-protect or dual mappings; assuming RWX is a portability landmine.
- **Stale or absolute addresses break PIC.** Baking an absolute address into code that's loaded at a random address (ASLR) crashes. Every cross-module reference needs the right relocation, not a constant.
- **DWARF location lists go stale.** If the allocator splits a range but the location list isn't updated, the debugger shows the wrong register's contents as the variable — confidently and silently. Worse than `<optimized out>`.
- **CFI must be correct at *every* instruction, including mid-prologue.** An exception or signal during the prologue (before the frame is fully set up) must still unwind. Coarse, function-granularity CFI is wrong; it must track each prologue/epilogue step.
- **Frame-pointer omission + bad CFI = unwindable.** At `-O2` the FP is often gone, so unwinding *depends* entirely on CFI. If the CFI is wrong, profilers and crash reporters produce garbage stacks.
- **Peephole rules that ignore flags.** Rewriting an instruction that sets condition flags into one that doesn't (or vice versa) silently breaks a downstream branch. Flag liveness must be respected.
- **Code-cache exhaustion.** A long-running JIT that never evicts cold code runs out of code-cache space and either stops optimizing (silent perf cliff) or crashes. Eviction policy is mandatory, not optional.
- **Relocation type mismatches.** Emitting the wrong relocation kind (e.g. a 32-bit PC-relative where the displacement can exceed 2GB) produces link errors or runtime truncation — common when bringing up large-memory or large-code-model builds.
