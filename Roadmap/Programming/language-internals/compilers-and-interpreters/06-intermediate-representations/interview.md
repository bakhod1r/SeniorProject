# Intermediate Representations — Interview Questions

> **Topic:** [Intermediate Representations](README.md)
> **Focus:** Interview-ready questions and model answers on compiler IRs — concepts (narrow waist, IR levels, three-address code, CFG, SSA), real IRs (LLVM IR, GCC GIMPLE/RTL, JVM bytecode, rustc MIR, Cranelift, sea of nodes, MLIR), the tricky traps that separate "read about it" from "built one," and open-ended design questions.

---

## How to use this page

Questions are grouped: **Conceptual**, **IR-Specific** (real IRs), **Tricky-Trap** (the misconceptions interviewers probe), and **Design** (open-ended). Each has a model answer at the depth a senior compiler engineer would give. Read the question, answer aloud, then check.

---

## Conceptual

## Question 1

**Why does a compiler have an intermediate representation at all? Give the strongest single argument.**

The decoupling argument — the **narrow waist**. With *M* source languages and *N* target machines, compiling each pair directly costs *M × N* full compilers. With one shared IR, every language compiles *to* the IR (*M* front ends) and the IR compiles *to* every machine (*N* back ends): *M + N* pieces. Adding a language costs one front end that immediately works on all targets; adding a target costs one back end that immediately works for all languages. This combinatorial saving is exactly why LLVM became the shared substrate for Clang, Rust, Swift, Julia, and others. The secondary argument is that the IR is the natural home for target-independent optimization: you don't want to optimize raw ASTs (too close to messy syntax) or raw assembly (too target-specific); the IR is the clean, regular middle.

## Question 2

**What are the main *levels* of IR, and why have more than one?**

Compilers lower **progressively** through altitudes: a **high-level IR** (close to the AST, retains language structure — GCC's GENERIC, an HIR), a **mid-level IR** (three-address, SSA, target-independent — GIMPLE-SSA, LLVM IR), and a **low-level IR** (machine-near: registers, addressing modes, ABI — GCC's RTL). Each level is the right altitude for a class of work: language-specific checks and some high-level optimizations up top, the big target-independent optimizations (inlining, GVN, LICM) in the middle, and instruction selection/register allocation/scheduling at the bottom. One IR can't do all of it: too high and you can't express machine cost; too low and you've lost portability and high-level structure.

## Question 3

**What is three-address code and why that shape?**

Three-address code (TAC) is a linear IR where each instruction names at most three things — one result, up to two operands — and performs one operation: `t1 = a + b`. A nested expression like `(a+b)*(a-b)` flattens into a sequence (`t1=a+b; t2=a-b; t3=t1*t2`) by inventing temporaries. The shape exists because *uniform, single-operation instructions are easy to analyze and easy to translate to machine code*. It's more lines than the source, but each line is trivial — that trade is the whole point. (Triples and quads are encodings of TAC differing in how they reference results.)

## Question 4

**What is a basic block and a control-flow graph, and why is the CFG the "substrate"?**

A **basic block** is a maximal straight-line instruction sequence: one entry at the top, one exit at the bottom, no jumps into the middle, only the last instruction may branch. A **control-flow graph (CFG)** has basic blocks as nodes and possible control transfers as edges. It's the substrate because nearly every analysis is a walk over it: liveness, reachability, loop detection (loops are cycles / back edges), and all dataflow analyses propagate facts along its edges. You build the CFG by finding **leaders** (first instruction, branch targets, instructions after branches), cutting blocks at leaders, and adding edges per the branches.

## Question 5

**What is SSA and what problem does it solve?**

**Static Single Assignment** renames variables so each name is assigned exactly once (`x` → `x1, x2, x3`). The problem it solves: in ordinary IRs a variable name is overloaded — it holds different values at different points — so every analysis must re-derive "which definition reaches this use" by walking the CFG and merging facts. SSA makes the use-def link a single, unambiguous pointer: a name *is* its one definition. This collapses constant propagation, dead-code elimination, value numbering, and more from per-variable fixpoint dataflow into direct graph lookups. The cost is the **φ-function** at merges and the need to destruct SSA before codegen. ("Static" = assigned once in the *program text*; a loop body's definition still runs many times.)

## Question 6

**What is a φ-function, where does it go, and what does it compile to?**

A φ-function `x3 = φ(x1, x2)` sits at a control-flow merge and means "x3 is x1 if we arrived via the first predecessor edge, x2 if via the second." It's needed wherever two or more definitions of a variable can both reach a block. Minimal placement is at the **iterated dominance frontier** of each definition (Cytron's algorithm) — intuitively, the first points where a definition's dominance "runs out" and merges with control flow that bypassed it; a loop header always gets `φ(preheader_value, back_edge_value)`. φ is *not* a machine instruction — it's notation. Going **out of SSA**, each φ becomes copies on the incoming predecessor edges (after splitting critical edges and respecting φ's parallel semantics).

## Question 7

**Explain dominance, the dominator tree, and the dominance frontier.**

Block **A dominates B** if every path from entry to B passes through A. The **immediate dominator** is the closest strict dominator; linking each block to its idom gives the **dominator tree**. A definition is visible without a φ exactly in the subtree it dominates. The **dominance frontier** of A is the set of blocks where A's dominance stops — blocks B such that A dominates a predecessor of B but not B itself. That's precisely where a definition in A may meet a bypassing path and need a φ, which is why φ placement uses the iterated dominance frontier.

## Question 8

**Register-based vs stack-based IR — contrast and say when each is used.**

A **register-based** IR names every value in a (virtual) register: `%1 = add %a, %b`. A **stack-based** IR has no named temporaries; operators pop operands from and push results to an implicit operand stack: `load a; load b; add`. Register IRs (LLVM IR, GIMPLE) are natural for SSA and analysis — optimizing compilers prefer them. Stack IRs (JVM bytecode, .NET CIL, WebAssembly) are compact and easy to verify, so they're chosen as *distribution/wire formats*; a JIT then lifts the stack form back to a register-SSA IR before optimizing. So: register for thinking, stack for shipping.

## Question 9

**What are CPS and ANF, and how do they relate to SSA?**

**A-normal form (ANF)** is a functional IR where every intermediate result is `let`-bound to a name — essentially functional three-address code; because each `let` binds once, ANF is **single-assignment by construction**. **Continuation-passing style (CPS)** goes further: functions never return; they take and call an explicit *continuation*, making all control flow explicit as function calls. Both give single-assignment for free. A well-known result (Appel; Kelsey) is that **SSA and CPS/ANF are inter-translatable** — they're two views of the same underlying idea, which is why ML/Scheme-family compilers optimize on ANF/CPS without ever saying "φ."

## Question 10

**What properties make an IR "good"?**

Target-independent (at the mid level, so the M+N narrow waist holds), analyzable/regular (few orthogonal instruction forms), SSA (trivial use-def), typed (verifiable, drives correct lowering), verifiable (a checker that rejects malformed IR), explicit control flow (a real CFG, not nested syntax), and a stable, documented contract (it's the interface between front/back ends and between passes). LLVM IR is the canonical IR that targets all of these on purpose.

---

## IR-Specific

## Question 11

**Describe LLVM IR's key characteristics and its three encodings.**

LLVM IR is **typed**, in **SSA** form, **register-based**, with explicit control flow. Hierarchy: Module → Functions → BasicBlocks → Instructions (each block ends in a terminator like `ret`/`br`/`switch`). Values are SSA registers (`%name`, `@global` for globals); types are explicit (`i32`, `ptr`, `[4 x i32]`, struct types). It exists in three isomorphic encodings: **in-memory** C++ objects (what passes manipulate), **textual** `.ll` (human-readable, `clang -S -emit-llvm`), and **bitcode** `.bc` (compact, serializable). It's the narrow waist made real — Clang, rustc, Swift, Julia all target it. Instruction flags like `nsw`/`nuw`/`fast` carry semantic/UB facts the optimizer exploits.

## Question 12

**Walk through GCC's IR pipeline.**

Three IRs at descending altitude. **GENERIC**: a language-independent *tree* IR each front end produces; close to the AST. **GIMPLE**: a *three-address* IR produced by "gimplification" (subexpressions get temporaries, control flow becomes explicit gotos); it has a plain form and an **SSA form** where most machine-independent optimization happens (`-fdump-tree-*`, φ spelled `PHI`). **RTL** (Register Transfer Language): a *low-level*, machine-near, Lisp-like IR where register allocation, scheduling, and final emission occur (`-fdump-rtl-*`). It's progressive lowering — language-neutral tree → target-neutral SSA → machine-near RTL — predating LLVM.

## Question 13

**Why is JVM bytecode stack-based, and what does the JIT do with it?**

Bytecode is the JVM's IR *and* its distribution format (`.class`), so it's optimized for **compactness** and **verifiability**: the stack-based form has fixed per-opcode stack effects, and the verifier proves type/stack-depth consistency at every merge before any code runs. But bytecode is *not* what gets optimized: HotSpot's JIT (C1/C2) decodes it, **simulates the operand stack** to recover the dataflow, and builds an in-memory register-SSA IR (C2 uses sea of nodes). So the answer is the ship-format/optimize-format split: stack for transport, SSA register IR for optimization. .NET CIL and Wasm follow the same pattern.

## Question 14

**What is rustc's MIR and — crucially — why does it exist?**

MIR is a **mid-level IR**: a CFG of basic blocks over a radically simplified Rust (no nested expressions; explicit places, moves, drops, and `Terminator`s like `switchInt`/`goto`/`return`). Its primary reason for existing is **not optimization but analysis**: borrow checking needs a control-flow-explicit form to run dataflow (liveness, region/lifetime constraints — NLL/Polonius). MIR also drives drop elaboration, **const evaluation** (the const-eval interpreter runs MIR), exhaustiveness, and a growing set of MIR optimizations, then lowers to LLVM IR (or Cranelift). It's the textbook example that an IR's purpose can be analysis first.

## Question 15

**What is Cranelift optimized for, and how does its SSA differ from LLVM's?**

Cranelift (IR = CLIF) optimizes for **fast, predictable compilation** rather than peak runtime performance — used by Wasmtime's Wasm JIT and rustc's debug back end. Its SSA uses **block parameters** instead of φ-functions: each basic block declares parameters, and predecessors pass values on their jumps (`jump block3(v3)`). This is semantically equivalent to φ but uniform with normal argument passing and avoids special-casing φ in every pass. The broader lesson: optimizing for *compile time* is a legitimate IR design axis, not just optimizing output.

## Question 16

**What is sea of nodes, who uses it, and what's the trade-off?**

Sea of nodes (Cliff Click) is a **graph IR** that merges data-flow and control-flow into one graph of nodes connected by dependency edges. Unlike a CFG-of-blocks, instructions aren't pinned to a block until a final **scheduling/global-code-motion** phase places each node as early/late as legality allows. That floating freedom enables very aggressive global optimization (GVN across the whole graph, free code motion). HotSpot's C2 and V8's TurboFan use it. The trade-off is **debuggability and maintainability**: floating nodes have no "line N" to point at, reproductions are hard, and the IR is complex — which is why V8 built **Turboshaft**, a more conventional CFG IR, trading a little optimization ceiling for maintainability.

## Question 17

**Explain MLIR and the concept of a "dialect."**

MLIR (Multi-Level IR) is a **framework** for IRs where many **dialects** coexist in one module and lower into each other. A dialect is a namespaced, independently-verified set of operations/types/attributes representing one abstraction level or domain (`affine`, `scf`, `linalg`, `gpu`, `tensor`, `llvm`). A compiler can start in a high-level domain dialect and lower step-by-step down to the `llvm` dialect and then LLVM IR, each step small and verifiable. The thesis: the right number of IR levels is "as many as your domain needs, expressed uniformly," so **adding an abstraction level becomes a plugin, not a fork**. It underpins TensorFlow/IREE, Flang, and more.

## Question 18

**You compile the same `if/else` to LLVM IR, GIMPLE-SSA, and JVM bytecode. What's structurally different and what's the same?**

**Same**: all three encode the same control-flow structure with a merge, and both register IRs put a merge value behind a φ (LLVM `phi`, GIMPLE `PHI`). **Different**: LLVM IR and GIMPLE-SSA name every value (register-based, SSA) and are typed; the merge value is an explicit φ. JVM bytecode is **stack-based** — no named temporaries, the value sits on the operand stack — and has no φ at all; the merge is just two paths leaving the stack in the same state, which the verifier checks. To optimize the bytecode, a JIT first reconstructs named values and SSA.

---

## Tricky-Trap

## Question 19

**A candidate says "SSA means each variable is assigned once at runtime." Correct them.**

No — "static" means once in the **program text**, not once during execution. `i1 = φ(i0, i2)` and `i2 = i1 + 1` inside a loop are *single static definitions* that each execute on every iteration, producing a new value each time. SSA constrains the *form of the code* (one defining instruction per name), not the dynamic number of writes. Confusing these leads people to think loops can't be in SSA, when in fact the loop-header φ is the defining feature of SSA loops.

## Question 20

**Why can't you serialize out-of-SSA copies naively for `a = φ(...)` and `b = φ(...)` that swap?**

Because all φ-functions at the top of a block execute **in parallel** — they read all their arguments *before* any write. Two φ that swap (`a3 = φ(b1,...)`, `b3 = φ(a1,...)`) must exchange values simultaneously. Serializing as `a3 = b1; b3 = a1` corrupts the result because the first copy clobbers `a1` before the second reads it (or vice versa). Correct out-of-SSA uses a parallel-copy sequencer with a temporary to break the cycle, preserving the simultaneous semantics.

## Question 21

**What is a critical edge and why must it be split before out-of-SSA?**

A **critical edge** runs from a block with multiple successors to a block with multiple predecessors. When you destruct a φ into a copy on that edge, there's nowhere safe to put it: placing the copy in the source block also affects its *other* successor; placing it in the destination affects its *other* predecessor. You **split** the edge — insert a fresh empty block on it — and put the copy there, so it affects only that one path. Forgetting to split critical edges is a classic wrong-code bug that only triggers on certain control flow.

## Question 22

**"I'll just optimize the JVM bytecode directly." Why is that a bad idea?**

Because the operand stack is *implicit*: dataflow isn't named, it's encoded as stack push/pop order, so even basic queries ("what value does this `iadd` consume?") require simulating the stack. Worse, the stack form is awkward for SSA-based optimizations. Every real JIT decodes bytecode, simulates the stack to recover named values, and builds a register-SSA IR *before* optimizing. The bytecode is a compact wire format, not an optimization substrate; treat it as something to lift, not to transform in place.

## Question 23

**An interviewer claims "the IR is just text like `.ll` files." What's the subtlety?**

The textual `.ll` is a *view*, not the thing. LLVM IR exists as **in-memory objects** (what passes manipulate), **bitcode** (the durable wire format), and **text** (human/test-facing). They're isomorphic, but the text form is deliberately *not* a stability contract — it can change between releases — whereas **bitcode is backward-compatible** (old bitcode auto-upgrades into new compilers). So "the IR is text" misses both that passes work on objects and that the stability guarantees differ sharply between encodings.

## Question 24

**You added `noalias` knowledge in the front end but the optimizer still won't eliminate a redundant load. Likely cause?**

The aliasing fact was probably **dropped during a lowering** before the optimization that needed it ran — an "altitude" failure: information born high but destroyed before its consumer. The optimizer, lacking the `noalias`/TBAA fact, conservatively assumes the pointers may overlap and won't reorder/eliminate the load. The fix isn't in the optimizer; it's ensuring the fact is *encoded into the IR* and *survives* the lowering boundary as a first-class attribute or metadata. If the optimizer can't see a fact in the IR, that fact doesn't exist for it.

## Question 25

**Why is treating an IR's metadata as load-bearing for correctness a bug?**

Metadata (debug info, TBAA, `!range`, profile counts) is by contract **semantically inert** — droppable without changing program meaning. Optimizers are *allowed* to discard metadata they can't maintain. If your IR's correctness (not just performance) depends on metadata surviving, then any pass that legitimately drops it produces a miscompile. Correctness facts must be encoded as first-class IR (instructions, types, attributes with defined semantics), not as droppable metadata.

## Question 26

**`volatile` and `atomic` stores in the IR — why can't the optimizer treat them like plain stores?**

A plain store can be removed if provably dead and reordered subject to data dependencies. A **volatile** store is an *observable effect* (e.g., a memory-mapped device register): it must never be removed, duplicated, or reordered relative to other volatiles. An **atomic** store participates in the memory model: its ordering (`release`, `seq_cst`, …) constrains how surrounding operations may move. The IR's **effect model** encodes these differences, and it *is* the optimization contract — misspecifying it (treating volatile/atomic as plain) authorizes a genuine miscompile that tests may not catch.

---

## Design

## Question 27

**Design the IR strategy for a new statically-typed systems language with a borrow-checker-style analysis.**

I'd use a **multi-level** stack. (1) A high-level typed IR / desugared AST for language-specific checks. (2) A **mid-level, control-flow-explicit analysis IR** (à la rustc's MIR) where I run the borrow/lifetime dataflow — borrow checking needs explicit moves, drops, places, and a CFG, and the language's types must still be present, so this altitude is mandatory. (3) Lower to **LLVM IR** for the heavy target-independent optimization and codegen — reusing the M+N narrow waist instead of writing back ends. I'd consider **Cranelift** as a fast debug-build back end. Key design rule: run each analysis at the altitude where its information still lives (borrow check high, GVN/LICM mid, regalloc low), and carry survivors (alias intent, overflow facts) as IR attributes/metadata across lowerings.

## Question 28

**How would you decide between targeting LLVM, Cranelift, or building an MLIR-based pipeline?**

By the dominant requirement. **LLVM** if peak runtime performance and broad target reach matter most and compile time is acceptable — you inherit a world-class optimizer and many back ends. **Cranelift** if fast, predictable compile times dominate (JIT, debug builds, Wasm) and you can trade some runtime performance. **MLIR** if the language/domain has its own high-level abstractions worth optimizing (ML tensors, DSP, hardware) — you build domain dialects and progressively lower to the `llvm` dialect, getting reusable infrastructure and the ability to add levels without forking. Often the answer is layered: MLIR dialects on top, lowering to LLVM IR underneath, with Cranelift as an alternative fast back end.

## Question 29

**You must ship a serialized IR (cached, used in distributed builds). What's your stability and evolution policy?**

Treat the serialized form as a **versioned protocol**. Tag every artifact with a format version. On read, run **auto-upgrade** that rewrites deprecated/old constructs into current ones, so a `.bc`/cached-IR from months ago still loads into today's compiler (essential for ThinLTO/distributed-build caches). Guarantee backward compatibility for the serialized form; keep the *textual/in-memory* form free to churn. Never change serialized semantics silently — deprecate, ship a shim, then remove across a window. Govern IR changes like an API: RFCs, deprecation periods, migration paths, because a breaking change touches every producer and consumer.

## Question 30

**How would you architect correctness assurance for a compiler used by thousands of downstream projects?**

A budgeted ladder. **Per-commit**: a fast **verifier** run after every pass (asserts SSA dominance, terminators, φ/block-param arity, type consistency) — converts miscompiles into localized assertions. **CI**: round-trip (print→parse→print) testing and canonicalization checks. **Nightly/release**: **differential testing** with random-program generators (Csmith-style) across all optimization levels and **translation validation** (Alive2-style) on the riskiest, UB-sensitive transforms like peepholes. Plus aggressive **canonicalization** (confluent and terminating) to shrink the surface of cases. The principle: spend the correctness budget where miscompiles are most likely and most costly, and make the verifier non-negotiable.

## Question 31

**Argue for and against sea of nodes for a brand-new top-tier JIT.**

**For**: maximal optimization freedom — nodes float on dependencies until scheduling, enabling global value numbering across the whole graph and free code motion (early/late as legal). This is why C2 and TurboFan reached peak performance. **Against**: total cost of ownership. Floating nodes have no fixed position, so debugging, reproducing bugs, and extending the IR are hard; onboarding is slow; tooling must be specialized. V8 concluded the maintenance floor outweighed the optimization ceiling and built **Turboshaft**, a CFG-based IR, accepting a slightly lower ceiling for far better developer velocity and maintainability. Recommendation: for a new JIT, prefer a CFG-SSA IR unless you have a team that can own sea-of-nodes' complexity and a workload that truly needs the last few percent.

## Question 32

**Where does information get irretrievably lost in lowering, and how do you design around it?**

Loop structure is explicit high, recoverable mid (via loop analysis on the CFG), and **gone** once flattened to machine code; source-level types and aliasing intent are present at the front end and erased low; UB/overflow facts are front-end knowledge. Design around it with an **altitude ledger**: for each fact, note where it's *born*, where it's *consumed*, and where it's *destroyed*. If a pass needs a fact, ensure the fact is either (a) still present at that altitude, (b) carried across the lowering as an attribute/metadata, or (c) re-derivable by analysis at acceptable cost. The failure mode to avoid is an optimization that can *never* fire because the information it needs was discarded one level too early.

---

## Closing advice

- For **conceptual** questions, always anchor on the narrow waist (M+N) and on SSA's "one name, one definition → trivial use-def."
- For **IR-specific** questions, know the one-line identity of each real IR: LLVM = typed SSA narrow waist; GCC = GENERIC/GIMPLE/RTL stack; JVM = stack bytecode lifted by the JIT; rustc MIR = analysis IR for borrow check; Cranelift = fast compile, block-parameter SSA; sea of nodes = floating graph, power vs maintainability; MLIR = dialects, multi-level.
- For **traps**, the big four: "static" SSA ≠ runtime-once; φ is parallel (swap problem); critical edges must be split; effect model (volatile/atomic) is the optimization contract.
- For **design**, reason in terms of altitude (where does each analysis run / where does information live), contract (producers, consumers, serialized artifacts), and budget (compile time and correctness assurance as outputs).
