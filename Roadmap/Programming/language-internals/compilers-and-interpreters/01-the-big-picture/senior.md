# The Big Picture (Compiler Architecture) — Senior Level

> **Topic:** [The Big Picture (Compiler Architecture)](README.md)
> **Focus:** The front/middle/back split, the shared-IR thesis, and how the real toolchains are actually organized.

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Three-Stage Architecture](#the-three-stage-architecture)
3. [The M×N Problem and the Shared IR](#the-mn-problem-and-the-shared-ir)
4. [Real Toolchain Anatomies](#real-toolchain-anatomies)
5. [Passes, Lowering, and the Narrow Waist](#passes-lowering-and-the-narrow-waist)
6. [Mental Models](#mental-models)
7. [Best Practices](#best-practices)
8. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
9. [Summary](#summary)

---

## Introduction

A compiler is not one program; it is a pipeline of transformations, each turning a
representation of the program into a slightly lower one until you reach the target.
The single most important architectural decision in that pipeline is *where you cut
it* — because the cuts determine what can be reused across languages and targets,
where optimization lives, and how hard it is to add a new front end or a new chip.
The senior view of "the big picture" is this set of cuts and the reasoning behind
them.

---

## The Three-Stage Architecture

The canonical split:

- **Front end** — language-dependent. Lexing, parsing, semantic analysis (name
  resolution, type checking). Produces a typed AST / high-level IR. Knows
  everything about the *source language*, nothing about the *target machine*.
- **Middle end** — language- and target-independent. Operates on the IR: dataflow
  analysis and the bulk of optimization (inlining, constant folding, dead-code
  elimination, loop transforms). The portable heart of the compiler.
- **Back end** — target-dependent. Instruction selection, register allocation,
  instruction scheduling, target-specific peephole. Knows everything about the
  *machine*, nothing about the *source language*.

The discipline is that information flows downward and each stage speaks only to its
neighbors through a defined IR. The middle end never sees a token; the front end
never sees a register.

---

## The M×N Problem and the Shared IR

Why the split pays off: suppose you support **M** source languages and **N** target
architectures. A monolithic compiler-per-pair needs M×N implementations. Factor a
shared IR through the middle, and you need **M** front ends + **N** back ends =
**M+N**. Every optimization written once on the IR benefits every language and every
target.

This is the entire thesis of **LLVM**: a well-specified IR (typed, SSA, virtual
registers) as a "narrow waist" so that Clang (C/C++/Obj-C), Rust, Swift, Julia, and
dozens more share one optimizer and one set of backends. Add a backend for a new
chip and *every* LLVM language can target it; add a frontend for a new language and
it inherits *every* optimization and target for free.

---

## Real Toolchain Anatomies

- **LLVM/Clang:** Clang front end → **LLVM IR** → target backends. The IR is the
  product; `clang -emit-llvm -S` shows it.
- **GCC:** language front ends → **GENERIC** (language-independent tree) → **GIMPLE**
  (simplified, SSA form for optimization) → **RTL** (register transfer language, near
  the machine) → assembly. Three IRs, progressive lowering.
- **JVM:** `javac` is a *thin* front end (lex/parse/typecheck → **bytecode**); the
  heavy optimization happens later in the JIT (C1/C2) at runtime. The "compiler" is
  split across build time and run time.
- **V8:** parser → **Ignition** bytecode → **TurboFan/Maglev** optimizing JIT — a
  runtime pipeline driven by profiling.
- **rustc:** parse → AST → **HIR** (desugared) → **MIR** (borrow-check + dataflow +
  some optimization) → **LLVM IR** → LLVM backend. Rust reuses LLVM's middle/back end
  entirely.

Notice the recurring shape: a language-specific front producing a portable IR, then
a shared optimizer, then a target-specific back. Even the JIT-based runtimes follow
it; they just relocate stages to runtime.

A crucial distinction: the **driver** vs the **toolchain**. `gcc`/`clang` are
*drivers* — they orchestrate the preprocessor, the actual compiler (`cc1`), the
assembler (`as`), and the linker (`ld`). "The compiler" people invoke is usually the
driver coordinating several programs; the real compiler is one stage in a toolchain.

---

## Passes, Lowering, and the Narrow Waist

A modern compiler is organized as a sequence of **passes**, each a function
`IR -> IR` (analysis passes annotate; transform passes rewrite). **Lowering** is the
movement from higher, source-like IRs to lower, machine-like ones — GCC's
GENERIC→GIMPLE→RTL and rustc's HIR→MIR→LLVM-IR are lowering chains. Each level is
chosen so that some class of work is *easy* there (borrow-checking on MIR,
target-independent opts on a mid IR, register allocation on a low IR).

The "narrow waist" idea: keep the central IR small, well-specified, and stable, so
many producers and consumers can plug into it — the same architectural pattern as
IP in networking or POSIX in operating systems. **MLIR** generalizes this with
multiple coexisting IR "dialects" and progressive lowering between them, which is
why it underpins modern ML compilers.

Single-pass compilers (classic Pascal, some teaching compilers) do everything in one
sweep — fast, low-memory, but limited optimization and awkward forward references.
Multi-pass is the norm precisely because separating concerns enables the reuse and
optimization above.

---

## Mental Models

- **"A series of lowerings."** Compilation is repeatedly rewriting the program into a
  lower-level but equivalent form until it's machine code.
- **"Narrow waist."** One stable IR in the middle lets M producers and N consumers
  interoperate at M+N cost.
- **"The driver is a conductor."** What you call "the compiler" usually just
  sequences cpp/cc1/as/ld.
- **"JIT is the same pipeline, relocated."** V8/JVM run front-end stages at build and
  optimize at run time using profiles AOT can't have.

---

## Best Practices

- **Respect the phase boundaries.** Don't let target details leak into the front end
  or source semantics into the back end; the IR contract is what keeps the compiler
  maintainable and reusable.
- **Reuse a mature middle/back end** (LLVM, Cranelift) when building a new language —
  you inherit decades of optimization and every target.
- **Pick IR levels by the work they enable**, not arbitrarily; each lowering should
  make some analysis natural.
- **Invest in diagnostics** as a first-class cross-cutting concern — Clang/Rust/Elm
  show error quality is a product feature, and it spans all front-end phases.

---

## Edge Cases & Pitfalls

- **Bootstrapping.** A compiler written in its own language needs an existing
  compiler to build the first version (then it self-hosts). Ken Thompson's
  *Reflections on Trusting Trust* shows a self-hosting compiler can hide a backdoor
  that survives even a clean source recompile — a sobering supply-chain lesson.
- **Cross-compilation.** Distinguish **build** (where the compiler is built),
  **host** (where it runs), and **target** (what it emits for). Confusing these is a
  classic source of broken cross builds.
- **Phase leakage.** The C "lexer hack" (the lexer needing symbol-table info) is a
  famous breach of the clean front-end layering.
- **Mistaking the driver for the compiler** when debugging — a flag may belong to
  `ld`, not `cc1`.

---

## Summary

The architecture of a compiler is a pipeline cut into a language-dependent front
end, a portable middle end, and a target-dependent back end, communicating through
one or more IRs. That split turns an M×N implementation problem into M+N and makes
the IR the most valuable asset — LLVM's entire success rests on it. Real toolchains
(LLVM, GCC, JVM, V8, rustc) all instantiate this shape, sometimes relocating stages
to runtime for JITs, and the "compiler" you invoke is usually a driver conducting a
toolchain. Keep the phase boundaries clean, choose IR levels by the work they enable,
and treat diagnostics as a product feature.
