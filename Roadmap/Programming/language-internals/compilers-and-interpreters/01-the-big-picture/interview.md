# The Big Picture (Compiler Architecture) — Interview Questions

> **Topic:** [The Big Picture (Compiler Architecture)](README.md)

---

## Introduction

These questions test whether a candidate can describe the end-to-end compiler
pipeline, justify the front/middle/back split via the M×N argument, place real
toolchains (LLVM, GCC, JVM, V8, rustc) on that map, and reason about AOT vs JIT,
bootstrapping, and cross-compilation. Strong answers connect the architecture to its
payoff (reuse, optimization locality, portability) rather than reciting phase names.

## Table of Contents

- [Conceptual](#conceptual)
- [Toolchain-Specific](#toolchain-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**List the phases of a typical compiler and what each consumes/produces.**

Source → **lexer** (tokens) → **parser** (AST/parse tree) → **semantic analysis**
(typed/annotated AST: name resolution + type checking) → **IR generation** (IR) →
**optimization** (better IR) → **code generation** (assembly/machine code) →
**assembler + linker** (executable). Each phase consumes the previous representation
and lowers it toward the machine.

## Question 2

**What is the front/middle/back-end split and why does it matter?**

Front end = language-dependent (lex/parse/semantic, produces IR); middle end =
language- and target-independent (IR optimization); back end = target-dependent
(codegen). It matters because it lets M front ends and N back ends share one
optimizer — M+N work instead of M×N — and localizes each concern (no target details
in the front end, no source semantics in the back end).

## Question 3

**Compiler vs interpreter vs JIT vs transpiler — distinguish them.**

A compiler translates source to a lower-level target (usually machine code) ahead of
execution; an interpreter executes the program directly (often via bytecode); a JIT
compiles at run time using runtime profiles; a transpiler compiles between
*high-level* languages (TS→JS, C++→C). They're points on a spectrum, and real systems
mix them (a JIT has a compiler inside; CPython compiles to bytecode then interprets).

## Question 4

**What is an IR and why have one?**

An intermediate representation is a program form between source and target where
optimization happens. It exists to decouple front ends from back ends (the M+N
argument), to provide a target-independent place for optimization, and to enable
progressive lowering. LLVM IR is the canonical example.

## Question 5

**Single-pass vs multi-pass compilation?**

Single-pass does everything in one sweep — fast, low memory, but limited optimization
and awkward forward references. Multi-pass runs successive passes over the program,
enabling separation of concerns, whole-program analysis, and optimization. Modern
compilers are multi-pass.

---

## Toolchain-Specific

## Question 6

**Describe LLVM's architecture and why it succeeded.**

A front end (e.g. Clang) lowers source to **LLVM IR** (typed, SSA, virtual
registers); a shared optimizer runs IR passes; target backends emit machine code. It
succeeded because the well-specified reusable IR let many languages (Rust, Swift,
Julia, Clang) share one optimizer and all targets — solving M×N and letting new
languages/targets plug in cheaply.

## Question 7

**Walk through GCC's IRs.**

Language front ends produce **GENERIC** (a language-independent tree), lowered to
**GIMPLE** (a simplified, SSA-capable form where most optimization runs), then to
**RTL** (register transfer language, close to the machine), then assembly. Three IRs,
each chosen for the work it makes natural.

## Question 8

**How is the JVM's "compiler" split?**

`javac` is a thin front end: lex/parse/typecheck → **bytecode** (a portable IR). The
heavy optimization happens at run time in the JIT (HotSpot C1/C2) using profiles, with
tiering and deoptimization. So compilation is split across build time (to bytecode)
and run time (to native).

## Question 9

**What does `gcc`/`clang` the command actually do?**

It's a **driver**: it orchestrates the preprocessor, the real compiler (`cc1`), the
assembler (`as`), and the linker (`ld`), passing the right flags to each. "The
compiler" you invoke is usually the driver conducting a whole toolchain, not a single
program.

---

## Tricky / Trap

## Question 10

**Is bytecode "compiled" or "interpreted"?**

Both, in stages. Source is *compiled* to bytecode ahead of time; the bytecode is then
*interpreted* (and possibly JIT-compiled to native) at run time. CPython compiles to
`.pyc` bytecode and interprets it; the JVM compiles to bytecode and JITs it. The
question conflates two different stages.

## Question 11

**Why can't you fully trust a compiler binary even with its source?**

Thompson's *Trusting Trust*: a compiler can be rigged to inject a backdoor when
compiling a target program *and* to re-inject that logic when compiling itself, so the
malicious behavior persists even after recompiling from clean source. The source looks
clean; the binary isn't. Diverse double-compilation mitigates it.

## Question 12

**A flag isn't working as expected. Why might it be a "compiler" misunderstanding?**

Because the flag may belong to a different toolchain stage — the linker (`ld`),
assembler, or preprocessor — not the compiler proper. The driver routes flags to
sub-tools; treating the driver as a monolith hides where the flag actually applies.

## Question 13

**Build vs host vs target — define them.**

**Build** = the machine where the compiler is built; **host** = the machine where the
compiler runs; **target** = the machine the compiler emits code for. A normal compiler
has host == target; a cross-compiler has host ≠ target; a Canadian cross has all three
different. Confusing them breaks cross-compilation.

---

## Design

## Question 14

**You're building a new language. Reuse LLVM or write your own backend?**

Reuse LLVM if you want many targets and strong optimization cheaply (you write only a
front end + IR lowering) — accepting LLVM's compile-time cost and coupling. Write your
own (or use Cranelift) if compile speed or tight runtime integration (GC safepoints,
stacks) dominates, as Go did. Decide from target count, perf-vs-compile-speed, runtime
coupling, and team size.

## Question 15

**Where would you place optimization for (a) a CLI tool, (b) a long-running server,
(c) a browser JS engine?**

(a) AOT — fast startup, no warmup. (b) Either, but JIT/tiered pays off as peak
throughput is amortized over a long run; (c) JIT with tiering and deopt, because the
code is delivered as source at runtime and benefits from runtime type profiles. The
deployment target and lifetime drive the choice.

## Question 16

**How would you design the compiler so adding a new target is cheap?**

Funnel everything through a stable, target-independent IR and keep all
machine-specific logic in a swappable back end (instruction selection, register
allocation, scheduling). Then a new target is a new back end against the same IR, and
every existing language inherits it — the LLVM model.
