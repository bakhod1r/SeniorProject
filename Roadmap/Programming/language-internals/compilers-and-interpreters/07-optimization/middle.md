# Optimization — Middle Level

> **Topic:** [Optimization](README.md)
> **Focus:** *How does the compiler know a transformation is safe?* The answer is **dataflow analysis** — a lattice-and-fixpoint framework — plus **SSA form**, the IR shape that makes most optimizations cheap. This page is the machinery underneath the rewrites.

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
13. [Summary](#summary)

---

## Introduction

> Focus: **What proves a rewrite is legal, and what representation makes rewrites cheap?**

At the junior level, optimizations were named and shown: constant folding, CSE, DCE, LICM. But naming them dodges the hard question every real optimizer must answer: **how does the compiler *know* a transformation preserves behavior?** To delete a store, it must *prove* the value is never read. To hoist a computation out of a loop, it must *prove* nothing in the loop changes its inputs. To propagate a constant, it must *prove* the variable holds that constant on every path that reaches the use. These proofs are not ad hoc. They come from one unified framework: **dataflow analysis**.

Dataflow analysis computes, for every program point, a conservative summary of facts that hold there — which definitions can reach here, which variables are still live, which expressions are already available. It does this by modeling the program as a **control-flow graph (CFG)**, attaching a set of facts to each node, and iterating a **transfer function** over the graph until the facts stop changing — a **fixpoint**. The math that guarantees this terminates and gives a sensible answer is the theory of **lattices** and **monotone functions**. It sounds abstract; it is the most reused idea in the entire compiler.

The second half of this page is **SSA (Static Single Assignment) form** — an IR where every variable is assigned exactly once. This single discipline turns expensive global analyses into cheap, almost trivial ones, which is why every serious optimizer (LLVM, GCC's GIMPLE, V8's Turbofan, the JVM's C2) is built on SSA.

In one sentence: **optimizations are *what*; dataflow analysis is *how do we know it's safe*; SSA is *how do we make the proof cheap*.**

> 🎓 **Why this matters for a mid-level engineer:** Once you understand dataflow, the optimizer stops being magic. You can predict what it *can't* do — and most "the compiler should have optimized this but didn't" cases are situations where the analysis couldn't *prove* the precondition (a pointer might alias, a function might have side effects, a value might escape). You start writing code the analyzer can *see through*, which is the real skill behind "writing optimizer-friendly code."

This page covers: the CFG and basic blocks; the four canonical dataflow analyses (reaching definitions, live variables, available expressions, very-busy expressions); the lattice/fixpoint framework with forward/backward and may/must axes; SSA form and phi nodes; and a tour of SSA-based optimizations (GVN, SCCP, sparse DCE). The phase-ordering problem and `-O` level internals appear here in outline and get full treatment in `senior.md`.

---

## Prerequisites

- **Required:** The junior tier — you should recognize constant folding, CSE, DCE, LICM, inlining by name.
- **Required:** Basic graph vocabulary: nodes, edges, paths, predecessors/successors.
- **Required:** Comfort with sets and set operations (union, intersection, difference).
- **Helpful but not required:** A sense of what an *intermediate representation* is — a simplified, language-neutral program form the compiler manipulates (three-address code, LLVM IR, bytecode).
- **Helpful but not required:** Partial orders / lattices from a discrete-math course. We re-derive what we need.

You do **not** need to know:

- Register allocation internals — touched in prose, detailed in codegen topics.
- LTO/PGO mechanics — that's `senior.md` and `professional.md`.
- The undefined-behavior controversy in depth — that's `senior.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Intermediate representation (IR)** | A language-neutral program form the optimizer operates on (e.g. three-address code, LLVM IR, GIMPLE). |
| **Basic block** | A maximal straight-line sequence of instructions with one entry and one exit — no branches in except at the top, none out except at the bottom. |
| **Control-flow graph (CFG)** | A directed graph whose nodes are basic blocks and whose edges are possible control transfers. |
| **Dataflow analysis** | Computing a conservative set of facts true at each program point by iterating to a fixpoint over the CFG. |
| **Transfer function** | The rule describing how a basic block transforms the set of facts flowing through it (`OUT = f(IN)`). |
| **Meet / join** | How facts from multiple incoming paths combine (set union or intersection, depending on the analysis). |
| **Lattice** | A partially ordered set where every pair of elements has a well-defined meet and join. The space of possible dataflow facts forms one. |
| **Fixpoint** | The state where another iteration produces no change. The analysis result. |
| **Forward vs backward** | Whether facts flow with control (reaching definitions) or against it (live variables). |
| **May vs must** | Whether a fact holds on *some* path (may, uses union) or *all* paths (must, uses intersection). |
| **Reaching definitions** | Which assignments could be the source of a variable's current value at a point. |
| **Live variable** | A variable whose current value *may* be read later before being overwritten. |
| **Available expression** | An expression already computed on every path to a point, with no intervening change to its operands. |
| **SSA (Static Single Assignment)** | An IR where every variable is assigned exactly once; uses point to a single definition. |
| **Phi (φ) node** | A pseudo-instruction at a control-flow merge that "selects" which incoming definition reaches the merge, restoring single-assignment. |
| **Dominance** | Block A *dominates* B if every path from entry to B passes through A. The basis for placing phi nodes. |
| **GVN (Global Value Numbering)** | An SSA optimization that gives equal values the same number and eliminates redundant computations across the whole function. |
| **SCCP (Sparse Conditional Constant Propagation)** | An SSA analysis that propagates constants *and* prunes unreachable branches simultaneously. |

---

## Core Concepts

### 1. The CFG and Basic Blocks

Optimizers don't work on source text; they work on an **intermediate representation** arranged as a **control-flow graph**. First, the linear instruction stream is chopped into **basic blocks** — straight-line runs with a single entry and single exit. A block ends at any branch, jump, return, or label that's a branch target. Then directed edges connect a block to every block control can flow to next.

```
        ┌──────────────┐
        │ B0: a = 1     │
        │     b = 2     │
        │  if a<b goto  │
        └───┬───────┬───┘
            │true   │false
        ┌───▼──┐ ┌──▼────┐
        │B1:   │ │B2:     │
        │ x=10 │ │ x=20   │
        └───┬──┘ └──┬─────┘
            └───┬───┘
         ┌──────▼──────┐
         │ B3: use x    │  ← merge point
         └─────────────┘
```

Every dataflow analysis is "walk this graph, carrying facts, until they settle." The graph structure — especially merge points like B3 where two paths join — is the whole reason analysis is non-trivial: at a merge, you must *combine* the facts arriving from different predecessors.

### 2. The Four Canonical Analyses

Four classic analyses cover most of what optimizers need. They differ along two axes — **direction** (forward/backward) and **combination** (may/must) — and that's the whole taxonomy.

**Reaching definitions (forward, may).** At each point, which assignments *could* be the source of a variable's current value? Used by constant propagation (if exactly one definition reaches, and it's a constant, propagate it). A definition "reaches" if there's *some* path from it to the use with no intervening redefinition — hence **may** (union at merges).

**Live variables (backward, may).** At each point, which variables *may* be read later before being overwritten? Flows **backward** (a variable is live if a *future* use exists). The foundation of **dead store elimination** (a store to a non-live variable is dead) and **register allocation** (only live variables need registers). May-analysis: live on *some* future path.

**Available expressions (forward, must).** At each point, which expressions are already computed on *every* path to here, with operands unchanged since? The basis for **common subexpression elimination** — if `a+b` is available, don't recompute it. **Must**-analysis: available on *all* paths, so it uses **intersection** at merges.

**Very-busy / anticipated expressions (backward, must).** Expressions that *will* be computed on every path forward before their operands change. Used for **code hoisting** (compute once early instead of in multiple successors).

| Analysis | Direction | Combine (meet) | Enables |
|----------|-----------|----------------|---------|
| Reaching definitions | Forward | Union (may) | Constant/copy propagation |
| Live variables | Backward | Union (may) | Dead store elim, register alloc |
| Available expressions | Forward | Intersection (must) | CSE |
| Very-busy expressions | Backward | Intersection (must) | Code hoisting |

That 2×2 (forward/backward × may/must) is the entire conceptual map. Learn it and every dataflow analysis you meet slots into a corner.

### 3. The Lattice / Fixpoint Framework

Here's *why* iterating to a fixpoint works and terminates.

The set of possible dataflow facts at a point forms a **lattice**: a partially ordered set where any two elements have a greatest-lower-bound (**meet**) and least-upper-bound (**join**). For "available expressions," the lattice elements are sets of expressions ordered by ⊆, meet is ∩. For constant propagation, each variable's lattice is `⊤ (unknown) → constants → ⊥ (not-a-constant)`.

Each basic block has a **transfer function** `OUT = gen ∪ (IN − kill)` (for the classic bit-vector analyses): the block *generates* some facts and *kills* others. At a merge, the **meet operator** combines predecessors' OUT sets into the successor's IN.

The algorithm: initialize every block's facts to the lattice top (or bottom), then repeatedly apply transfer functions and meets until **nothing changes** — the **fixpoint**. Termination is guaranteed because the lattice has **finite height** and the transfer/meet functions are **monotone** (they only move facts in one direction along the lattice). A monotone function on a finite-height lattice *must* converge. This is the theoretical backbone (Kildall's framework, 1973); it's the reason the loop "iterate until stable" always halts.

```
worklist ← all blocks
while worklist not empty:
    B ← pop()
    IN[B]  = meet over predecessors of OUT[p]
    OUT[B] = transfer(B, IN[B])
    if OUT[B] changed:
        push all successors of B   # their inputs may now differ
```

The **worklist** variant only re-visits blocks whose inputs changed — the efficient form used in practice.

### 4. SSA Form: One Assignment Per Variable

The classic analyses above are *correct* but can be *slow* and imprecise (they track facts per program point, and "which definition reaches" requires chasing all paths). **SSA form** fixes this structurally.

In SSA, **every variable is assigned exactly once.** When source code reassigns `x`, SSA renames each assignment: `x1`, `x2`, `x3`. Now each *use* refers to exactly one definition — no analysis needed to find "the reaching definition," it's literally the name. Use-def chains become trivial.

The catch is merge points. If `x` is assigned in two branches and used after they join, *which* version does the use see? SSA inserts a **phi node** (φ) at the merge:

```
B1: x1 = 10
B2: x2 = 20
B3: x3 = φ(x1 from B1, x2 from B2)   ← selects based on which edge was taken
    use x3
```

A phi is a pseudo-instruction meaning "x3 is x1 if we came from B1, x2 if from B2." It restores single-assignment at merges. Phi placement is computed from **dominance frontiers** (the precise boundary where a definition's influence meets other definitions) — Cytron et al.'s classic algorithm. Phis are conceptual; they're lowered back to real moves before codegen ("out-of-SSA").

Why this matters: in SSA, **every variable has one definition**, so constant propagation, value numbering, and dead-code elimination become nearly local — walk the use-def edges directly instead of solving a global dataflow problem. This is why SSA is universal in modern optimizers.

### 5. SSA-Powered Optimizations

**Sparse Conditional Constant Propagation (SCCP).** The killer SSA optimization. It propagates constants *and* discovers unreachable branches *at the same time* — and that combination finds constants neither would find alone. If `x3 = φ(x1, x2)` but the analysis proves the edge feeding `x2` is unreachable (because a branch condition folded to a constant), then `x3 = x1`; if `x1` is constant, `x3` is too. Doing constant propagation and reachability *separately* misses these; SCCP fuses them into one fixpoint over the SSA graph. This is strictly more powerful than plain constant propagation.

**Global Value Numbering (GVN).** Assigns a "value number" to every computation such that two computations with the same number are *guaranteed* equal. Then redundant ones are eliminated — a smarter, global CSE. In SSA, `a1 = b + c` and `a2 = b + c` (same `b`, same `c`) get the same value number and the second is replaced by the first. GVN can see equalities across branches that local CSE misses.

**Sparse / aggressive DCE.** In SSA, a definition is dead iff it has no uses (trivially checkable). Aggressive DCE assumes everything is dead unless proven needed (transitively from observable effects backward), deleting more than conservative DCE — including whole computation chains feeding only-dead values.

These all rely on SSA's single-definition property to be cheap. That's the payoff.

---

## Real-World Analogies

**Dataflow as a rumor spreading through an office.** A fact ("the printer is broken") starts in one room and propagates room-to-room along hallways (edges). At a junction where two hallways meet, you decide: do you believe it if you heard it from *either* hallway (may / union) or only if *both* hallways confirm it (must / intersection)? You keep walking the building re-broadcasting until no room's belief changes — the fixpoint. Forward analysis follows the building's "flow"; backward analysis traces rumors back to their source.

**SSA as version control for variables.** Plain code mutates `x` in place; you can't tell which write produced the value you're reading without tracing history. SSA is like giving every write its own commit hash (`x1`, `x2`) so every read points at an exact commit. A phi node is a *merge commit*: when two branches both touched `x`, the merge records "the value here came from whichever branch we actually took."

**The lattice as a thermostat that only moves one way.** Each step can only make a fact "more known" (or "less known"), never oscillate. Because the dial has finitely many notches and only turns in one direction, it must stop. That's monotonicity + finite height = guaranteed termination.

**Available expressions as a shared scratchpad.** If everyone arriving at a meeting has already computed `a+b` on their way in (every incoming path), the value is on the shared whiteboard and nobody recomputes it. If even one path didn't compute it, it's not safely on the board — that's why availability needs *intersection* (must).

---

## Mental Models

**Model 1: Optimizations are theorems; dataflow is the proof system.** "Delete this store" is a claim. Live-variable analysis is the proof that the value is never read. Every legal optimization rests on a dataflow fact that *proves its precondition*. When the compiler "fails to optimize," the proof failed — usually because some fact was unknowable (aliasing, side effects).

**Model 2: Conservative means safe, not precise.** Dataflow analysis always errs toward "I'm not sure, so don't transform." A *may* analysis assumes a fact could hold if there's any path; a *must* analysis requires all paths. Both directions are chosen so that being wrong only *prevents* an optimization, never *breaks correctness*. Soundness over precision, always.

**Model 3: SSA makes "which definition?" a non-question.** In normal IR, finding the value a use sees is a graph search. In SSA, the answer is the name itself. Most of SSA's power is just: the expensive question was deleted by construction.

**Model 4: The 2×2 grid is the whole map.** Direction (forward/backward) × combination (may/must). Every textbook analysis is one of the four cells. New analysis you've never seen? Ask which cell. You'll know its meet operator and iteration direction immediately.

---

## Code Examples

### Reaching definitions enabling constant propagation

```c
int f(int cond) {
    int x = 5;          // d1: x = 5
    if (cond) x = 7;    // d2: x = 7
    return x + 1;       // which definitions reach here? {d1, d2}
}
```

Reaching-definitions says **both** `d1` and `d2` reach the `return` (it's a *may* analysis, union at the merge). Because two *different* constants reach, constant propagation **cannot** replace `x` with a single constant here — it must keep `x`. Contrast: if both branches set `x = 5`, only the constant 5 reaches and the return folds to `6`. The analysis result directly gates the optimization.

### Live variables enabling dead-store elimination

```c
int g(int a) {
    int x = a * a;   // store 1
    x = a + 1;       // store 2 — store 1 was never read: DEAD
    return x;
}
```

Backward live-variable analysis finds that `x` is **not live** immediately after store 1 (its value is overwritten by store 2 before any read). So store 1 (`x = a*a`) is a **dead store** and is eliminated, along with the multiply that feeds it (via DCE).

### SSA form with a phi node

```
;; source: int x; if (c) x = 10; else x = 20; return x;
B_entry:
    br c, B_then, B_else
B_then:
    x_1 = 10
    br B_merge
B_else:
    x_2 = 20
    br B_merge
B_merge:
    x_3 = phi [x_1, B_then], [x_2, B_else]
    ret x_3
```

The phi at `B_merge` selects `x_1` or `x_2` based on the incoming edge. Every use (`ret x_3`) now references exactly one definition.

### SCCP beating plain constant propagation

```c
int h(void) {
    int flag = 1;          // constant
    int x;
    if (flag) x = 42;      // flag folds to true → else branch unreachable
    else      x = compute_something();
    return x;
}
```

Plain constant propagation sees `x` could be `42` *or* `compute_something()` and gives up. **SCCP** proves `flag == 1`, marks the `else` edge **unreachable**, so only `x = 42` reaches the (implicit) phi — and returns the constant `42`, deleting `compute_something()` entirely. Fusing constant-propagation with reachability is what makes the difference.

### Inspecting LLVM IR after passes (command line)

```bash
# Emit unoptimized LLVM IR, then run mem2reg to build SSA, then SCCP:
clang -O0 -S -emit-llvm -Xclang -disable-O0-optnone f.c -o f.ll
opt -passes='mem2reg,sccp,instcombine,dce' -S f.ll -o f.opt.ll

# See exactly which transformations fired:
opt -passes='sccp' -S f.ll -print-changed -o /dev/null
```

`mem2reg` is the pass that *promotes stack slots into SSA registers* — it's where phi nodes get created. Reading `f.opt.ll` shows the phi nodes and the propagated constants directly.

---

## Pros & Cons

**Pros of the dataflow + SSA approach**

- **Unified and provably correct.** One framework (lattice + monotone transfer + fixpoint) justifies dozens of optimizations with a termination guarantee.
- **SSA makes analyses cheap and precise.** Use-def chains are explicit; many global problems become near-local.
- **Composable.** Analyses feed optimizations which expose more facts for the next analysis — the cascade.

**Cons / costs**

- **Conservatism leaves performance on the table.** When the analysis can't *prove* a precondition (aliasing, opaque calls, escaping values), it must skip the optimization even when a human can see it's safe.
- **Phi placement and out-of-SSA add complexity.** Building SSA (dominance frontiers) and lowering it back (handling phi "lost copies" and swaps) is intricate engineering.
- **Cost.** Iterating analyses to a fixpoint over large functions is part of why `-O2` compiles slower than `-O0`. Interprocedural and flow-sensitive analyses can be expensive.
- **Precision vs. speed trade-offs.** Flow-sensitive, context-sensitive, path-sensitive analyses are progressively more precise *and* more expensive; production compilers pick a pragmatic point.

---

## Use Cases

- **Understanding *why* the compiler didn't optimize.** When `-O2` leaves an obvious redundancy, it's usually because aliasing or a side-effecting call broke an *available-expressions* or *reaching-definitions* fact. Knowing the analysis tells you what to change.
- **Writing optimizer-friendly code.** Reduce pointer aliasing (use `restrict`/local copies), keep functions pure where possible, and use `const` so analyses can prove more.
- **Reading IR for performance work.** `opt -print-after-all` (LLVM) or `-fdump-tree-all` (GCC) lets you watch each analysis/transform fire and pinpoint where an expected optimization was blocked.
- **Building tooling.** Linters, refactoring engines, and static analyzers reuse the exact same dataflow framework (taint analysis, null-deref detection, uninitialized-use warnings are all dataflow).

---

## Coding Patterns

- **Shrink the live range of values the optimizer must track.** Compute close to use; don't keep a value live across an opaque call if you can recompute it cheaply. Smaller live ranges = simpler analysis = better register allocation.
- **Break aliasing the analysis can't see through.** Load a field into a local at the top of a hot loop; if the analysis can prove the local doesn't alias the memory written inside, it keeps the value in a register (this is hand-LICM when the compiler can't prove invariance).
- **Make branches statically decidable.** If a condition is a compile-time constant, SCCP can prune the dead branch and cascade. Hiding the constant behind a function call or non-`const` global blocks it.
- **Prefer single-assignment style in source too.** Code that assigns each logical value once (rather than reusing one mutable variable for many purposes) maps cleanly to SSA and is easier for *both* the compiler and the reader.

---

## Best Practices

- **Use `-fdump`/`opt -print` to verify, don't guess.** When you expect an optimization, confirm it fired by reading the post-pass IR. Intuition about what the analysis can prove is often wrong.
- **Give the analyzer information.** `const`, `restrict`, `[[gnu::pure]]`/`__attribute__((const))`, `final`, and avoiding global mutable state all *widen* what dataflow can prove.
- **Don't pre-lower to SSA in your head.** Write clear, possibly-mutating source; the compiler builds SSA far better than manual single-assignment contortions, which can hurt readability without helping.
- **Respect the conservatism.** If the compiler won't hoist something, ask "what fact can't it prove?" rather than assuming a compiler bug. The usual culprits: a pointer that might alias, a call that might have side effects, a value that might escape.

---

## Edge Cases & Pitfalls

- **Aliasing kills available-expressions facts.** `*p = ...; x = a + b; *q = ...; y = a + b;` — if `q` might alias the memory holding `a` or `b`, the second `a+b` is *not* provably available and CSE is blocked. Pointer analysis precision directly limits optimization.
- **Opaque function calls are analysis barriers.** A call to a function the compiler can't see (no body, not pure) is assumed to read and write *all* reachable memory. It clobbers available-expression and reaching-definition facts across the call. This is a major reason inlining (which removes the barrier) is so powerful.
- **Phi nodes are not real instructions.** They have no machine encoding; they're lowered to moves during out-of-SSA. Naively lowering parallel phis can introduce bugs (the "lost copy" and "swap" problems) — getting this right is subtle compiler engineering.
- **`volatile` is a hard fence for dataflow.** A `volatile` access can't be eliminated, duplicated, or reordered relative to other volatiles. Dataflow analyses must treat it as both a definition and a use of "the outside world."
- **Loops need fixpoint iteration, not one pass.** Because a loop's back-edge feeds facts from the bottom back to the top, you can't compute facts in a single forward sweep — you iterate until the loop's facts stabilize. Forgetting this is the classic dataflow-implementation bug.
- **Precision has diminishing returns.** A more precise (and expensive) analysis might unlock one extra optimization. Production compilers deliberately stop at a "good enough" precision because the compile-time cost isn't worth it — which is why some hand-obvious optimizations never fire.

---

## Summary

Optimizations are *what*; **dataflow analysis** is *how the compiler proves a rewrite is safe*. Programs become a **control-flow graph of basic blocks**; analyses attach **facts** to each point and iterate **transfer functions** plus a **meet operator** to a **fixpoint**. The whole family fits a 2×2 grid — **forward/backward** × **may/must** — with the four canonical members being **reaching definitions** (constant propagation), **live variables** (dead-store elim, register allocation), **available expressions** (CSE), and **very-busy expressions** (hoisting). Termination is guaranteed by **lattice theory**: monotone functions on a finite-height lattice converge.

**SSA form** — every variable assigned once, with **phi nodes** at merges placed via **dominance frontiers** — makes use-def chains explicit and turns expensive global analyses into cheap near-local ones. That's why **SCCP** (constant propagation fused with reachability), **GVN** (global CSE by value equality), and aggressive DCE are all SSA-based and universal in modern compilers (LLVM, GIMPLE, V8, the JVM's C2).

The practical payoff: the optimizer isn't magic, it's a prover, and it's *conservative* — when it skips an obvious optimization, some fact (usually aliasing or a side-effecting call) was unprovable. Write code the analyzer can see through (`const`, `restrict`, small live ranges, statically decidable branches) and verify with IR dumps. The next tier (`senior.md`) builds on this to tackle the **phase-ordering problem**, the full optimization pipeline, loop transforms and vectorization, LTO/PGO, and the undefined-behavior controversy.
