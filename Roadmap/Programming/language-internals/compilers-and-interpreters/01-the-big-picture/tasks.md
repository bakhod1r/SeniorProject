# The Big Picture (Compiler Architecture) — Hands-On Tasks

> **Topic:** [The Big Picture (Compiler Architecture)](README.md)

---

## Introduction

You internalize the pipeline by watching a real toolchain move a program through its
stages — tokens, AST, IR, assembly, object, executable — and by inspecting the IRs the
big compilers actually use. These tasks use `clang`/`gcc`, `-emit-llvm`, `-S`, and a
debugger/disassembler to make the abstract pipeline concrete. No need to build a
compiler here; the goal is to *see* the architecture in tools you already have.

Tick a self-check box when you can explain *which stage produced what*, not merely when
a command runs.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Stop the pipeline at each stage

Take a tiny C file and run the compiler stopping at each stage:

```sh
clang -E hello.c        # preprocessor output
clang -S hello.c        # assembly (-o hello.s)
clang -c hello.c        # object file
clang hello.c -o hello  # full pipeline + link
```

**Self-check:**
- [ ] I can match each command to a pipeline stage.
- [ ] I can explain that the final step invoked the linker, and the others didn't.

### Task 2 — See the LLVM IR

`clang -emit-llvm -S hello.c -o hello.ll` and read the IR.

**Self-check:**
- [ ] I can identify functions, virtual registers, and the typed instructions.
- [ ] I can explain that this IR is target-independent and where optimization would run on it.

---

## Core

### Task 3 — Front/middle/back on one function

Write `int sq(int x){ return x*x; }`. Produce its LLVM IR (`-O0` and `-O2`) and its
assembly (`-S`). Compare.

**Self-check:**
- [ ] I can see the front end's faithful IR at `-O0` and the middle end's optimized IR at `-O2`.
- [ ] I can see the back end's target instructions in the `.s` file.
- [ ] I can state which stage did each transformation.

### Task 4 — The M+N argument, concretely

List three LLVM front-end languages and three LLVM targets you know. Explain, in
writing, how many "compilers" a monolithic design would need versus LLVM's M+N.

**Self-check:**
- [ ] I can compute M×N vs M+N for my example.
- [ ] I can explain what the shared IR buys.

### Task 5 — Find the driver's sub-tools

Run `clang -v hello.c -o hello` (or `gcc -v`) and read what sub-programs it invokes.

**Self-check:**
- [ ] I can point to the compiler, assembler, and linker invocations.
- [ ] I can explain why "the compiler" is really a driver conducting a toolchain.

---

## Advanced

### Task 6 — Compare two toolchains' IRs

For the same small program, inspect LLVM IR (`clang -emit-llvm`) and, if available,
GCC's GIMPLE (`gcc -fdump-tree-gimple`). Note how each represents the same computation.

**Self-check:**
- [ ] I can identify SSA-like structure / three-address form in both.
- [ ] I can explain why each compiler picked its IR level.

### Task 7 — AOT vs JIT, observed

Take a compute-heavy function and run it (a) compiled with `clang -O2` and (b) on a
JIT runtime (JVM with `-XX:+PrintCompilation`, or Node with `--trace-opt`). Note
startup vs steady-state behavior.

**Self-check:**
- [ ] The AOT binary has no warmup; the JIT shows compilation events mid-run.
- [ ] I can explain where each places the optimizer in time.

### Task 8 — Cross-compile

Use `clang --target=aarch64-linux-gnu -S hello.c` (or a cross toolchain) to emit code
for a different architecture than your host.

**Self-check:**
- [ ] The emitted assembly is for the target arch, not my host.
- [ ] I can define build/host/target for this invocation.

---

## Capstone

### Task 9 — Map a real compiler end to end

Pick one real compiler (rustc, V8, the JVM, or GCC) and produce a one-page diagram
tracing a program from source to execution through *its* actual stages and IRs
(e.g. rustc: AST → HIR → MIR → LLVM IR → machine code). For each stage, state what
representation it uses and what work happens there, and mark where it reuses a shared
component (e.g. rustc reusing LLVM).

**Self-check:**
- [ ] My diagram names each real IR and the work at each stage.
- [ ] I correctly mark front/middle/back boundaries and any reused components.
- [ ] I can explain where this compiler places optimization (build vs run time).

---

## Self-Assessment

You own this topic when you can:

- [ ] Name the pipeline phases and what each consumes/produces.
- [ ] Justify the front/middle/back split with the M×N→M+N argument.
- [ ] Place LLVM, GCC, JVM, V8, and rustc on the architecture map.
- [ ] Distinguish compiler/interpreter/JIT/transpiler and AOT/JIT placement.
- [ ] Explain bootstrapping, Trusting Trust, the driver-vs-toolchain distinction, and build/host/target.
