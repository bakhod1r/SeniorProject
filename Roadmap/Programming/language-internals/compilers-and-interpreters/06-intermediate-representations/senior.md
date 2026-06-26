# Intermediate Representations — Senior Level

> **Topic:** [Intermediate Representations](README.md)
> **Focus:** The IRs you actually read and debug in production compilers — LLVM IR, GCC's GENERIC→GIMPLE→RTL stack, JVM bytecode, rustc's MIR, Cranelift, and the sea-of-nodes IRs in V8 and HotSpot — plus the engineering of multi-level lowering, IR verification, and what makes an IR *good*.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real IRs, Surveyed](#real-irs-surveyed)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)

---

## Introduction

> Focus: **Stop inventing teaching IRs and start reading real ones.** What does LLVM IR actually look like, why is it typed and in SSA, how does GCC justify three IRs (GENERIC, GIMPLE, RTL) instead of one, what does rustc's MIR exist *for* beyond optimization, and why did V8 and HotSpot's top tier choose a graph IR (sea of nodes) over a CFG-of-blocks?

The middle level gave you the structural vocabulary — CFG, SSA, φ, dominance, register vs stack vs functional. The senior level is where that vocabulary meets the IRs shipped in compilers you depend on every day. The difference matters because every real IR is a *bundle of engineering decisions*, and you only understand the decisions by seeing what each compiler optimized for. LLVM IR optimized for being a reusable, target-independent, typed-SSA optimization substrate shared across a dozen front ends — the narrow waist made concrete. GCC predates LLVM and arrived at a *stack* of IRs (a high-level tree IR, a mid-level SSA IR, a low-level machine-ish IR) because different optimizations want different altitudes. The JVM optimized its IR for *distribution and verification* — bytecode is small, stack-based, and provably type-safe before it runs — and then the JIT throws that away and rebuilds an SSA graph to actually go fast. rustc invented MIR not primarily to optimize but because **borrow checking** needed a simplified, control-flow-explicit form to run dataflow on. And the highest-performance JITs reached for **sea of nodes**, a graph IR that merges data and control dependencies so the scheduler is free to move computation as late as legality allows.

Reading these IRs is a concrete, daily skill. `clang -S -emit-llvm` dumps LLVM IR; `gcc -fdump-tree-all -fdump-rtl-all` dumps every GIMPLE and RTL stage; `javap -c` disassembles bytecode; `rustc --emit=mir` (or `-Z dump-mir`) prints MIR; `cargo asm`/Cranelift's CLIF dumps show Cranelift IR. When you're chasing "why did the optimizer not vectorize this loop?" or "why is this bounds check still here?", the answer lives in the IR, not the source and not the assembly. This page makes you fluent: it walks the same small function through several real IRs, explains the lowering pipeline (progressive lowering through levels), shows how SSA construction via dominance frontiers (Cytron) plays out in a real pass manager, and explains MLIR's "dialects" — the modern answer to "why pick one IR level when you can have many, interoperating in one framework." It also covers the unglamorous but load-bearing engineering: IR verifiers, the properties that make an IR good (target-independent, analyzable, typed, SSA, verifiable), and the failure modes when those properties slip.

---

## Prerequisites

- SSA, φ-functions, dominance, dominator trees, dominance frontiers, out-of-SSA (the middle level of this topic).
- The CFG: basic blocks, edges, critical edges, back edges, loops as cycles.
- Register-based vs stack-based vs functional (CPS/ANF) IR families.
- Comfort reading C, a little assembly, and at least skimming Rust/Java.
- The compiler pipeline shape: front end → IR → optimizer (pass manager) → back end (instruction selection, register allocation, scheduling).

You do **not** need to have written a production compiler; you do need to be willing to run the dump flags above and read what comes out.

---

## Glossary

| Term | Meaning |
|------|---------|
| **LLVM IR** | LLVM's typed, SSA, register-based IR. Exists as in-memory C++ objects, textual `.ll`, and `.bc` bitcode — three encodings of the same thing. |
| **Module / Function / BasicBlock / Instruction** | LLVM IR's containment hierarchy. A `Value` is anything that can be used; instructions and arguments are values. |
| **GENERIC** | GCC's language-independent tree IR, the front ends' common output. High-level, close to the AST. |
| **GIMPLE** | GCC's three-address, mid-level IR; "gimplification" lowers GENERIC to it. Has a non-SSA and an SSA form. |
| **RTL** | Register Transfer Language: GCC's low-level, machine-near IR (Lisp-like s-expressions) where register allocation and scheduling happen. |
| **Bytecode** | A stack-based IR shipped as the distribution format (JVM `.class`, .NET CIL, Wasm). Verified before execution. |
| **MIR (rustc)** | Mid-level IR in rustc: a CFG of basic blocks over a simplified Rust, used for borrow checking, drop elaboration, const eval, and some optimization. |
| **CLIF / Cranelift IR** | Cranelift's SSA IR, designed for fast, predictable compilation (Wasm, debug builds) rather than peak optimization. |
| **Sea of nodes** | A graph IR (Click) merging data-flow and control-flow into one graph of nodes; used by HotSpot C2 and V8 TurboFan. Enables global code motion. |
| **MLIR** | Multi-Level IR: a framework where many **dialects** (IR sublanguages at different abstraction levels) coexist and lower into each other. |
| **Dialect (MLIR)** | A namespaced set of operations/types/attributes — e.g., `affine`, `linalg`, `llvm` — representing one abstraction level or domain. |
| **Lowering pipeline** | The ordered sequence of IRs/passes from high-level to machine code; "progressive lowering" descends one level at a time. |
| **Verifier** | A pass that checks IR invariants (well-typed, dominance respected, terminators present, φ arity correct) and rejects malformed IR. |
| **Intrinsic** | A pseudo-function the compiler understands specially (e.g., `llvm.memcpy`, `llvm.sadd.with.overflow`) and lowers per target. |
| **Pass manager** | The driver that schedules analysis and transform passes over the IR, tracking which analyses are invalidated. |
| **Poison / undef** | LLVM's models for "this value is the result of UB / is unconstrained"; they let the optimizer reason about undefined behavior soundly. |

---

## Core Concepts

### 1. Progressive lowering: one IR is rarely enough

A production compiler does not translate AST → assembly in one leap, and usually not even AST → one IR → assembly. It **lowers progressively** through a stack of representations, each more machine-specific and less language-specific than the last:

```text
   AST  --(front end)-->  HIGH-LEVEL IR    (close to source; types, high-level ops)
                                 |
                              lower
                                 v
                          MID-LEVEL IR      (three-address, SSA, target-independent opts)
                                 |
                              lower
                                 v
                          LOW-LEVEL IR      (machine-near; address modes, calling conv)
                                 |
                       instruction selection
                                 v
                            MACHINE CODE
```

Each level is the right altitude for a class of optimizations. High-level IR keeps enough structure for language-specific checks (Rust's borrow check on MIR, devirtualization, exception handling). Mid-level IR (typed SSA) is where the big target-independent optimizations live — inlining, GVN, LICM, vectorization. Low-level IR exposes machine reality — registers, addressing modes, ABI — so the back end can do instruction selection, register allocation, and scheduling. Trying to do everything at one level either loses information you need (too low) or can't express what the machine costs (too high). GCC, LLVM (with MLIR), and rustc all embrace this; the only debate is *how many* levels and *which framework* expresses them.

### 2. What makes an IR "good"

Across every real IR, the same properties recur as design goals:

| Property | Why it matters |
|----------|----------------|
| **Target-independent** (at the mid level) | One optimizer serves all back ends; the M+N narrow waist holds only if the IR doesn't bake in one machine's assumptions. |
| **Analyzable / regular** | Few, orthogonal instruction forms make writing correct passes feasible. Irregularity multiplies pass complexity. |
| **SSA** | Single definitions make use-def trivial and enable sparse, fast analyses. Nearly every optimizing mid-level IR is SSA. |
| **Typed** | Types catch malformed transforms in the verifier and drive correct lowering (size, alignment, signedness). |
| **Verifiable** | A cheap checker that rejects malformed IR turns "wrong-code miscompile" into "loud assertion at the offending pass." |
| **Explicit control flow** | A real CFG (not nested syntax) is required for dataflow; high-level loops/exceptions must be lowered to edges. |
| **Stable, documented contract** | The IR is the interface between front and back ends and between passes; if it drifts silently, everything downstream breaks. |

LLVM IR hits all of these deliberately; it is the canonical "good IR." Bytecode trades target-independence-for-optimization in favor of compactness-and-verifiability-for-distribution, then a JIT rebuilds a "good IR" in memory.

### 3. SSA construction in practice: Cytron's algorithm

The middle level sketched φ placement at the iterated dominance frontier; here is the production shape. Given a CFG:

1. **Compute dominators** (Lengauer–Tarjan, or a simple iterative algorithm for teaching) → build the **dominator tree** and **dominance frontiers**.
2. **Place φ-functions**: for each variable `v`, for each block defining `v`, insert φ for `v` at every block in the iterated dominance frontier of those defs. A φ is itself a def, so iterate (worklist).
3. **Rename**: walk the dominator tree, maintaining a version stack per variable; rewrite uses to the current version, push a fresh version on each def, and fill successor φ-arguments per edge; pop on the way back up.

This yields **minimal** SSA; adding a liveness filter yields **pruned** SSA (no φ for variables dead past the merge). LLVM builds SSA differently for some cases (`mem2reg`/`SROA` promote stack `alloca` slots to SSA registers), but the underlying theory is Cytron. Knowing this lets you read a `-print-after=mem2reg` dump and recognize the φ-functions for what they are.

### 4. Verification: the cheapest insurance in a compiler

Every serious IR ships a **verifier**. LLVM's `llvm::verifyModule` checks, among many things: every basic block ends in exactly one terminator; every use is dominated by its def; φ has one incoming value per predecessor; types match across operands; intrinsics are well-formed. GCC verifies GIMPLE/SSA invariants between passes under checking builds. The discipline is: **a transform that violates an invariant should fail loudly in the verifier at that pass, not produce wrong code three passes later.** When you add a pass, run the verifier after it during development; it converts the worst class of compiler bug (silent miscompile) into the best class (immediate, localized assertion).

### 5. Intrinsics and the IR's "escape hatch"

Real IRs can't have an opcode for everything (`memcpy`, overflow-checked add, vector shuffles, atomic fences, target-specific instructions). Instead they use **intrinsics** — pseudo-functions the optimizer understands (it knows `llvm.memcpy` has no side effects beyond the copy, can be inlined, vectorized, or lowered to a `rep movsb` or a libcall). Intrinsics keep the core IR small and regular while still letting the front end express rich operations, and they give the back end a per-target lowering point. When you see `call void @llvm.memcpy.p0.p0.i64(...)` in a dump, that's the IR's escape hatch, not a real function call.

---

## Real IRs, Surveyed

### LLVM IR — typed SSA, the canonical narrow waist

LLVM IR is register-based, fully typed, in SSA form, and exists in three isomorphic encodings: in-memory C++ objects (what passes manipulate), textual `.ll` (human-readable, `-emit-llvm -S`), and `.bc` bitcode (compact, serializable). Hierarchy: a **Module** holds **Functions**, a function holds **BasicBlocks**, a block holds **Instructions** ending in a terminator (`ret`, `br`, `switch`, `unreachable`, …). Virtual registers are SSA values written `%name`/`%0`; globals are `@name`. Types are explicit (`i32`, `i64`, `double`, `ptr`, `[4 x i32]`, `{i32, ptr}`). φ-functions are first-class (`phi`). This is the IR Clang, rustc, Swift, Julia, and many others all target — the M+N narrow waist made real.

### GCC: GENERIC → GIMPLE → RTL

GCC uses three IRs at descending altitude:

- **GENERIC** — a language-independent *tree* IR; each front end (C, C++, Fortran, Ada, …) produces it. Close to the AST; the unifying high-level form.
- **GIMPLE** — a *three-address* IR; "gimplification" flattens GENERIC into it (temporaries for subexpressions, explicit control flow). GIMPLE has a plain form and an **SSA form** where the bulk of GCC's machine-independent optimization happens (`-fdump-tree-*`).
- **RTL** (Register Transfer Language) — a *low-level*, machine-near IR written as Lisp-like s-expressions, modeling registers and machine operations. Register allocation, instruction scheduling, and final code emission happen here (`-fdump-rtl-*`).

The three-IR design predates LLVM and embodies progressive lowering: language-neutral tree → target-neutral SSA → machine-near RTL.

### JVM bytecode — stack-based, verified, for distribution

JVM bytecode is **stack-based**: instructions push/pop an implicit operand stack (`iload`, `iadd`, `invokevirtual`). It is the JVM's IR *and* its distribution format (`.class` files), chosen for compactness and **verifiability** — the bytecode verifier proves type and stack-depth consistency before any code runs. Crucially, bytecode is *not* the form the JIT optimizes: HotSpot's C1/C2 decode bytecode, simulate the operand stack to recover dataflow, and build an in-memory SSA IR (C2's is sea-of-nodes). The same pattern holds for .NET CIL and WebAssembly: a stack IR ships, a register/SSA IR optimizes.

### rustc MIR — control-flow-explicit, for analysis first

rustc's **MIR** is a CFG of basic blocks over a radically simplified Rust (no nested expressions; explicit places, moves, drops, and `Terminator`s). It was introduced not chiefly to optimize but because **borrow checking** needed a control-flow-explicit form to run dataflow (the borrow checker, later NLL/Polonius, computes liveness and region constraints over MIR). MIR also drives drop elaboration, const evaluation (the const-eval interpreter runs MIR), exhaustiveness, and a growing set of MIR optimizations. It then lowers to LLVM IR (or Cranelift IR). MIR is the textbook case that **an IR's primary purpose can be analysis, not optimization** (`rustc --emit=mir`, `-Z dump-mir=all`).

### Cranelift (CLIF) — fast, predictable compilation

Cranelift is an SSA, register-based IR/back end designed for **compile-time speed and predictability** rather than peak runtime performance: Wasmtime's Wasm JIT, rustc's debug-build back end, and others use it. CLIF is SSA with block parameters *instead of* φ-functions (an increasingly popular alternative encoding: each basic block takes arguments, and predecessors pass values — semantically equivalent to φ but cleaner to manipulate). The lesson: optimizing for *fast compilation* is a legitimate IR design axis, not just optimizing for fast output.

### Sea of nodes — V8 TurboFan, HotSpot C2

**Sea of nodes** (Cliff Click, 1995) is a graph IR that merges data-flow and control-flow into a single graph: a node is an operation; edges are *dependencies* (data and control). Unlike a CFG-of-blocks, instructions are not pinned to a block until a final **scheduling** (global code motion) phase places each node as late/early as legality allows. This freedom enables aggressive, global optimization (GVN across the whole graph, free code motion), at the cost of a more complex mental model. HotSpot's top-tier C2 and V8's TurboFan both use sea-of-nodes; their power *and* their notorious debugging difficulty both stem from it. (Note: V8 has been migrating TurboFan's frontend tiers toward a more conventional CFG IR, Turboshaft, partly because sea-of-nodes was hard to maintain — itself a senior-level lesson about IR trade-offs.)

### MLIR — many IRs, one framework

**MLIR** (Multi-Level IR) generalizes "use several IRs" into a framework where many **dialects** coexist in one module and lower into each other. A dialect is a namespaced set of ops/types (`affine`, `scf`, `linalg`, `gpu`, `llvm`, `tensor`). A machine-learning compiler might start in a high-level `tosa`/`linalg` dialect, lower through `affine` (loop nests) and `scf` (structured control flow) to the `llvm` dialect, then hand off to LLVM IR — each lowering a small, verifiable step. MLIR's bet is that the right number of IR levels is "as many as your domain needs, expressed uniformly," and it now underpins TensorFlow/IREE, Flang, and parts of the LLVM ecosystem. It is progressive lowering taken to its logical conclusion.

---

## Mental Models

### The "altitude" model of IR levels

Think of IRs as altitudes over the same terrain (your program). High altitude (GENERIC, HIR, high MLIR dialects) sees language structure but not machine cost. Low altitude (RTL, LLVM after lowering, `llvm` dialect) sees registers and addressing but has forgotten the source's intent. Optimizations are tools that work best at a specific altitude; the compiler descends, applying each at the right height. "Which IR should this optimization run on?" is really "at what altitude is the needed information still present and the cost model already meaningful?"

### The "ship one IR, optimize on another" model

Distribution formats (bytecode, Wasm, bitcode) and optimization IRs (SSA register graphs) have opposite goals: compactness/verifiability vs analyzability. Don't expect one IR to be great at both. The universal JIT pattern — decode the ship-format, lift to a register-SSA IR, optimize, emit machine code — falls directly out of this tension. When you see a stack-based format, assume something rebuilds a register IR before any serious optimization.

### The "verifier is your conscience" model

An IR without a verifier is a loaded gun. Each transform is an opportunity to violate an invariant (dangling use, missing terminator, wrong φ arity, type mismatch). The verifier is the conscience that catches the violation *at the scene*. Senior engineers run the verifier after every pass during development and treat a verifier failure as a higher-priority bug than a wrong-output test, because it pinpoints the exact pass at fault.

### The "graph vs blocks" model (sea of nodes)

A CFG-of-blocks pins every instruction to a block in program order; a sea-of-nodes graph leaves instructions *floating* on their dependencies until scheduling places them. Floating buys optimization freedom (move a computation anywhere its inputs are available and its effects are legal) but costs comprehensibility (there's no "line N" to point at). The trade-off — power vs maintainability — is exactly why some teams chose it and others (Turboshaft) are walking it back.

---

## Code Examples

### Example 1: One C function across LLVM IR

```c
int add_if_pos(int a, int b) {
    int r;
    if (a > 0) r = a + b; else r = b;
    return r;
}
```

LLVM IR after `mem2reg` (SSA, typed, φ at the merge), shape faithful to `clang -O1 -S -emit-llvm`:

```llvm
define i32 @add_if_pos(i32 %a, i32 %b) {
entry:
  %cmp = icmp sgt i32 %a, 0
  br i1 %cmp, label %then, label %else

then:
  %sum = add nsw i32 %a, %b
  br label %merge

else:
  br label %merge

merge:
  %r = phi i32 [ %sum, %then ], [ %b, %else ]
  ret i32 %r
}
```

Note: typed (`i32`, `i1`), SSA (`%cmp`, `%sum`, `%r` each defined once), explicit CFG (`br`), φ at `merge` with one `[value, pred]` pair per predecessor, and `nsw` (no-signed-wrap) flags carrying UB facts the optimizer exploits.

### Example 2: The same function as JVM bytecode (stack-based)

```text
javap -c shape:

  iload_0            // push a
  ifle else          // if a <= 0 goto else
  iload_0            // push a
  iload_1            // push b
  iadd               // a + b
  istore_2           // r = a + b
  goto end
 else:
  iload_1            // push b
  istore_2           // r = b
 end:
  iload_2            // push r
  ireturn            // return r
```

No named temporaries — values live on the operand stack. A JIT decodes this, simulates the stack (`iadd` consumes the top two pushes), and reconstructs the same dataflow LLVM had explicitly, then builds SSA.

### Example 3: GIMPLE (mid-level, three-address)

```text
-fdump-tree-gimple shape:

add_if_pos (int a, int b)
{
  int r;
  int D.1;

  if (a > 0) goto <D.2>; else goto <D.3>;
  <D.2>:
  r = a + b;
  goto <D.4>;
  <D.3>:
  r = b;
  <D.4>:
  D.1 = r;
  return D.1;
}
```

Three-address, explicit gotos, compiler temporaries (`D.1`). In *SSA* GIMPLE (`-fdump-tree-ssa`) you'd see `r_1`, `r_2`, and `r_3 = PHI <r_1(D.2), r_2(D.3)>` at the merge — GCC's φ spelled `PHI`.

### Example 4: rustc MIR (control-flow-explicit, for borrow check)

```rust
fn add_if_pos(a: i32, b: i32) -> i32 {
    if a > 0 { a + b } else { b }
}
```

```text
rustc --emit=mir shape:

fn add_if_pos(_1: i32, _2: i32) -> i32 {
    let mut _0: i32;            // return place
    let mut _3: bool;

    bb0: {
        _3 = Gt(copy _1, const 0_i32);
        switchInt(move _3) -> [0: bb2, otherwise: bb1];
    }
    bb1: {
        _0 = Add(copy _1, copy _2);  // (with overflow check in debug)
        goto -> bb3;
    }
    bb2: {
        _0 = copy _2;
        goto -> bb3;
    }
    bb3: {
        return;
    }
}
```

Places (`_0`, `_1`), `Terminator`s (`switchInt`, `goto`, `return`), explicit CFG. This is the form the borrow checker runs liveness/region dataflow over — its *reason to exist*.

### Example 5: Reading a dump to answer a real question

Suppose a hot loop isn't vectorizing. You don't guess — you dump:

```text
clang -O3 -Rpass=loop-vectorize -Rpass-missed=loop-vectorize \
      -S -emit-llvm hot.c -o hot.ll
```

Then read `hot.ll`: is the loop in canonical form (a single loop-header φ for the induction variable)? Are there loop-carried dependencies the φ-chain reveals? Is there a call inside the loop that blocks vectorization? Is a bounds check (a `br` to a trap block) still present, implying the optimizer couldn't prove the access safe? **The IR is where the answer lives.** A senior engineer reaches for the IR dump the way a junior reaches for a `printf`.

### Example 6: Cranelift CLIF — block parameters instead of φ

```text
function %add_if_pos(i32, i32) -> i32 {
block0(v0: i32, v1: i32):
    v2 = icmp sgt v0, 0
    brif v2, block1, block2

block1:
    v3 = iadd v0, v1
    jump block3(v3)        ; pass the value as a block argument

block2:
    jump block3(v1)

block3(v4: i32):           ; v4 is the "phi" — a block parameter
    return v4
}
```

CLIF encodes the merge value as a **block parameter** `v4` rather than a φ-instruction. Predecessors pass arguments on their jumps. Semantically identical to φ, but uniform with normal arguments — a clean, increasingly common SSA encoding.

---

## Pros & Cons

| IR / approach | Pros | Cons |
|---------------|------|------|
| **LLVM IR (typed SSA)** | Reusable narrow waist; rich optimizer; verifiable; three encodings | Heavyweight; slow to compile vs Cranelift; not great for sub-second JIT |
| **GCC 3-IR stack** | Each altitude optimized; mature; many languages | Three IRs to learn/maintain; RTL is arcane |
| **Bytecode (stack)** | Compact, verifiable, portable for shipping | Must be lifted to a register IR before real optimization |
| **rustc MIR** | Enables borrow check, const eval, drop elaboration; analysis-first | Yet another IR before LLVM; MIR opts still maturing |
| **Cranelift (CLIF)** | Fast, predictable compile times; clean block-param SSA | Lower peak runtime perf than LLVM |
| **Sea of nodes** | Maximal optimization freedom, global code motion | Hard to debug/maintain; teams have migrated away (Turboshaft) |
| **MLIR dialects** | Many altitudes, uniform infra, reusable lowerings | Conceptual and infrastructural overhead; ecosystem still solidifying |

---

## Use Cases

- **Picking a back end for a new language**: target LLVM IR for peak performance and reach; Cranelift for fast/predictable compiles; your own MLIR dialect lowering to `llvm` for a domain-specific compiler.
- **Diagnosing missed optimizations**: dump LLVM IR / GIMPLE with `-Rpass*` / `-fdump-tree-*` and read why a pass bailed.
- **Building static analysis or instrumentation**: lower to LLVM IR or MIR and run your analysis over SSA/CFG (sanitizers, coverage, taint).
- **JIT engineering**: lift bytecode/Wasm to an SSA IR, optimize, emit; manage deopt and OSR against IR-level state.
- **Domain compilers (ML, DSP, hardware)**: stack MLIR dialects and write progressive lowerings rather than one monolithic IR.
- **Verification and fuzzing the compiler**: use the IR verifier plus IR-level fuzzers (e.g., differential testing across `-O` levels) to find miscompiles.

---

## Coding Patterns

### Pattern 1: Drive the IR dumps before theorizing

```text
LLVM   : clang -O2 -S -emit-llvm f.c -o f.ll ; opt -print-after-all
GCC    : gcc -O2 -fdump-tree-all -fdump-rtl-all f.c   # writes f.c.NNN.<pass>
JVM    : javap -c -p Class.class
rustc  : rustc --emit=mir f.rs ; rustc -Z dump-mir=all
Cranelift: enable CLIF dumps (e.g. cargo build with the right flag / wasmtime --emit-clif)
```

Reading the actual IR beats reasoning about what you assume the compiler did.

### Pattern 2: Verify after every transform (in your own compiler)

```text
for pass in pipeline:
    pass.run(module)
    if DEBUG: verify(module)   # fail loudly here, not 3 passes later
```

### Pattern 3: Progressive lowering, one altitude at a time

```text
HIR  --lower-->  MIR/GIMPLE(SSA)  --lower-->  LIR/RTL/LLVM  --isel-->  machine
```

Each arrow is a small, separately testable lowering. Resist "lower in one giant pass."

### Pattern 4: Prefer intrinsics over new core opcodes

When the front end needs a rich operation (overflow-checked add, memcpy, a vector shuffle), emit an **intrinsic** the optimizer understands rather than bloating the core instruction set. Keeps the IR regular and gives the back end a per-target lowering hook.

### Pattern 5: Choose your SSA encoding deliberately

φ-functions (LLVM, GCC `PHI`) and block parameters (Cranelift, MLIR, Swift SIL) are equivalent. Block parameters compose better with generic argument handling and avoid special-casing φ in every pass; φ is the historical default. Pick one and be consistent.

---

## Best Practices

- **Run the IR verifier in CI and after each pass in debug builds.** It is the single highest-leverage correctness tool in a compiler.
- **Keep the mid-level IR target-independent.** The moment it encodes one machine's word size, endianness, or ABI, the narrow waist leaks and back ends diverge.
- **Lower progressively; don't skip altitudes.** Each level should be small enough to verify and test in isolation.
- **Type your IR and check types in the verifier.** Most malformed-transform bugs are type or dominance violations the verifier can catch instantly.
- **Preserve analysis-required structure until you're done with it.** Don't destroy high-level loop/exception/borrow information before the passes that need it have run.
- **Make IR printing lossless and re-parseable.** Print→parse→print should be a fixpoint; it powers tests, bug reports, and differential fuzzing.
- **Treat the IR as a versioned contract.** Between front/back ends and between passes, document invariants; silent IR drift is how multi-team compilers break.
- **Track analysis invalidation explicitly.** A pass that changes the CFG must invalidate cached dominator trees, loop info, and alias analysis, or downstream passes act on lies.

---

## Edge Cases & Pitfalls

- **Stale dominator tree / loop info after a CFG change.** Caching analyses is essential for speed and lethal if a transform forgets to invalidate them.
- **Undefined behavior modeling.** LLVM's `undef`/`poison` are not "garbage we ignore"; they encode UB so the optimizer can reason soundly. Misusing them (or front ends emitting UB the optimizer then "exploits") produces baffling miscompiles.
- **Irreducible control flow** from `goto`/computed jumps breaks the clean reducible-loop assumptions some passes make; compilers node-split or bail.
- **Bytecode verification at merges**: every path to a join must agree on operand-stack depth and types, or the JVM/CLR verifier rejects the class. A lowering bug surfaces as a verify error, not a wrong result.
- **Sea-of-nodes debuggability**: with nodes floating until scheduling, "where did this come from?" has no line number; reproductions are hard and tooling is specialized.
- **Intrinsic lowering gaps**: a target with no efficient lowering for an intrinsic falls back to a libcall, silently regressing performance you assumed was inlined.
- **MIR vs final codegen divergence**: optimizing on MIR and again on LLVM IR means a behavior can depend on which level a pass ran; keep the contract between levels precise (e.g., overflow checks are debug-only and must be consistently inserted/elided).
- **φ vs block-param mismatch when interoperating**: bridging an IR that uses φ with one that uses block parameters requires a faithful translation of merge semantics, including critical-edge handling.

---

## Common Mistakes

1. Reasoning about "what the compiler did" instead of dumping the IR and reading it.
2. Skipping the verifier, then chasing a miscompile across five passes instead of catching it at one.
3. Baking target details into the mid-level IR and wondering why a new back end misbehaves.
4. Optimizing stack bytecode directly instead of lifting to a register/SSA IR.
5. Forgetting to invalidate dominator/loop/alias analyses after a CFG-mutating pass.
6. Treating `undef`/`poison` as "don't care" rather than precise UB markers.
7. Adding a bespoke core opcode where an intrinsic would have kept the IR regular.
8. Assuming one IR level suffices; cramming machine-specific and language-specific concerns into the same form.
9. Mishandling critical edges when bridging φ-based and block-parameter IRs.
10. Believing sea-of-nodes is strictly superior; ignoring the maintainability cost that pushed V8 toward Turboshaft.
11. Reading `-O0` IR to judge optimization (it's deliberately un-optimized; promote with `mem2reg`/`-O1`+).
12. Forgetting MIR's main job is analysis (borrow check), then being confused that MIR optimizations are comparatively modest.

---

## Tricky Points

- **LLVM IR is three encodings of one thing.** `.ll` text, `.bc` bitcode, and in-memory objects are isomorphic; passes work on the objects, you read the text.
- **GCC's `PHI` and LLVM's `phi` are the same φ;** GIMPLE-SSA and LLVM IR are both mid-level typed-ish SSA, arrived at independently.
- **Bytecode is an IR *and* a wire format;** its design optimizes the second job, which is why JITs rebuild a different IR for the first.
- **MIR proves the point that IRs exist for analysis, not only optimization.** Borrow checking is the reason MIR exists; optimization came later.
- **Block parameters == φ-functions.** Two encodings, identical semantics; Cranelift/MLIR/Swift-SIL chose block params for uniformity.
- **Sea-of-nodes' superpower (floating nodes) is also its kryptonite (no fixed positions to debug).** The same property explains both its peak performance and its maintenance burden.
- **MLIR doesn't replace LLVM IR;** it lowers *to* the `llvm` dialect and then to LLVM IR. It's an additional, multi-level front of the same pipeline.
- **`nsw`/`nuw`/`exact`/`fast` flags on LLVM instructions carry UB/semantic facts** the optimizer relies on; they're not decoration.

---

## Test Yourself

1. Run `clang -O1 -S -emit-llvm` on a function with an `if/else` writing the same variable on both arms. Identify the φ and its `[value, predecessor]` pairs.
2. Dump GIMPLE-SSA (`-fdump-tree-ssa`) for the same function and map GCC's `PHI` to LLVM's `phi`.
3. `javap -c` the same logic compiled for the JVM. Trace the operand stack through the `if`; explain why there are no named temporaries.
4. `rustc --emit=mir` the function. Identify the basic blocks, the `switchInt` terminator, and why this form (not the AST) is what the borrow checker uses.
5. Explain, with an example, why LLVM's mid-level IR must stay target-independent and what breaks if it encodes a fixed pointer size.
6. Convert a small φ-using SSA snippet into Cranelift's block-parameter style and back; handle a critical edge in the translation.
7. Describe the JIT pipeline that turns Wasm (stack IR) into optimized machine code, naming every IR transition.
8. Argue both sides of sea-of-nodes vs CFG-of-blocks for a top-tier JIT, citing the optimization-freedom vs maintainability trade-off (and V8's Turboshaft move).

---

## Cheat Sheet

```
+------------------------------------------------------------------+
|             INTERMEDIATE REPRESENTATIONS — SENIOR               |
+------------------------------------------------------------------+
| GOOD-IR PROPERTIES                                               |
|   target-independent | analyzable | SSA | typed | verifiable    |
|   explicit CFG | stable documented contract                     |
|                                                                  |
| REAL IRs                                                         |
|   LLVM IR   : typed SSA register; .ll / .bc / in-memory         |
|              clang -S -emit-llvm ;  phi at merges               |
|   GCC       : GENERIC(tree) -> GIMPLE(3-addr, SSA) -> RTL(low)   |
|              -fdump-tree-all / -fdump-rtl-all ;  PHI = phi       |
|   JVM       : stack bytecode; verified; javap -c; JIT lifts SSA  |
|   rustc MIR : CFG, places, terminators; borrow-check/const-eval |
|              rustc --emit=mir / -Z dump-mir                      |
|   Cranelift : SSA + BLOCK PARAMETERS (not phi); fast compile     |
|   sea-of-nodes: graph IR (C2, TurboFan); floating nodes; GCM    |
|   MLIR      : dialects (affine/scf/linalg/llvm); multi-level    |
|                                                                  |
| SSA CONSTRUCTION (Cytron)                                        |
|   dominators -> dom tree + dominance frontiers                  |
|   place phi at iterated DF of each def (phi is itself a def)     |
|   rename by dom-tree walk; out-of-SSA = copies + split crit edge |
|                                                                  |
| ENGINEERING                                                      |
|   VERIFY after every pass (loud here, not 3 passes later)        |
|   progressive lowering: one altitude at a time                  |
|   intrinsics = escape hatch; keep core IR small                 |
|   invalidate dom/loop/alias analyses on CFG change              |
|   ship-format (stack/bitcode) != optimize-format (SSA register) |
+------------------------------------------------------------------+
```

---

## Summary

- Production compilers use **progressive lowering** through a stack of IRs at descending altitude; one IR rarely serves every optimization.
- A **good IR** is target-independent (at mid level), analyzable, SSA, typed, verifiable, with explicit control flow and a stable contract — LLVM IR is the canonical example.
- **LLVM IR**: typed, SSA, register-based, three isomorphic encodings, the M+N narrow waist made real (`clang -S -emit-llvm`).
- **GCC** stacks **GENERIC → GIMPLE(SSA) → RTL** — language-neutral tree, target-neutral SSA, machine-near RTL — embodying progressive lowering before LLVM existed.
- **JVM bytecode** is stack-based, verified, and a *distribution* format; JITs lift it to a register-SSA IR (HotSpot C2 = sea of nodes) to optimize. .NET CIL and Wasm follow the same ship-stack/optimize-SSA pattern.
- **rustc MIR** exists primarily for **analysis** (borrow checking, const eval, drop elaboration), proving an IR's purpose isn't always optimization.
- **Cranelift (CLIF)** optimizes for *fast, predictable compilation* and encodes SSA with **block parameters** instead of φ; **sea of nodes** (C2, TurboFan) merges data/control into a floating graph for maximal optimization freedom at the cost of debuggability (cf. V8's Turboshaft retreat).
- **MLIR** generalizes multi-level IR into a framework of interoperating **dialects**, lowering down to the `llvm` dialect — progressive lowering as a first-class, reusable infrastructure.
- The unglamorous load-bearers — **IR verifiers**, intrinsics as escape hatches, and disciplined analysis invalidation — are what keep a multi-pass, multi-team compiler correct.
