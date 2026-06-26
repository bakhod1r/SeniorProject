# Intermediate Representations — Middle Level

> **Topic:** [Intermediate Representations](README.md)
> **Focus:** From a flat list of three-address code to the structures real optimizers stand on — building the control-flow graph, understanding **static single assignment (SSA)** and its φ-functions, and seeing why register-based, stack-based, and functional IRs each exist.

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
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)

---

## Introduction

> Focus: **You can already flatten an expression into three-address code and draw a control-flow graph. Now: what makes one IR *good* for optimization, and why does almost every serious compiler convert its IR into SSA form?**

At the junior level the IR was a "simpler program that means the same thing": three-address code (`t1 = a + b`), grouped into basic blocks, wired together by a control-flow graph (CFG). That is enough to *represent* a program. It is not enough to *optimize* one cheaply. The instant you try to write a real optimization — "is this variable's value constant here?", "is this assignment dead?", "can I reuse this computation?" — you hit the same wall over and over: a variable name like `x` can hold many different values over its lifetime, and to know *which* value `x` holds at a given instruction you must trace control flow backward, merging information from every path that could have reached this point. This backward, path-merging reasoning is **dataflow analysis**, and on an ordinary three-address IR it is expensive, fiddly, and easy to get wrong.

The middle level is where you meet the single most important structural idea in modern compiler IRs: **static single assignment**. The trick is almost embarrassingly simple — rename variables so that *each name is assigned exactly once*. After SSA conversion there is no `x` that means three different things; there is `x1`, `x2`, `x3`, each defined at exactly one instruction. The payoff is enormous: "what value does this name hold?" now has a single, syntactically obvious answer — the one definition. Use-def chains become trivial. Constant propagation, dead-code elimination, value numbering, and a dozen other optimizations collapse from "walk the CFG tracking facts per variable" to "look at the one definition." The price is one new construct, the **φ-function** (phi), which appears at points where control flow merges and a name's value depends on *which path you took to get here*. Understanding φ — why it exists, where it goes, what it compiles down to — is the core skill of this page.

Around SSA sit the other structural choices that distinguish real IRs. Is your IR **register-based** (LLVM: an unlimited supply of named virtual registers) or **stack-based** (JVM bytecode, .NET CIL, WebAssembly: an implicit operand stack)? Does it carry **types** (LLVM IR is fully typed) or not? Is it the only IR, or one of several stacked at different abstraction levels? And how do functional-language compilers, which often skip mutable variables entirely, get SSA "for free" through **continuation-passing style (CPS)** and **A-normal form (ANF)**? This page builds the CFG properly, derives SSA and φ from first principles, shows out-of-SSA conversion (because no CPU has a φ instruction), and surveys the IR families you will actually read in the wild — leaving the deep tour of LLVM IR, GIMPLE, and MIR to `senior.md`.

---

## Prerequisites

Before reading this page you should be comfortable with:

- Three-address code: `t1 = a + b`, temporaries, copies, conditional and unconditional branches, labels (the junior level of this topic).
- Basic blocks and the control-flow graph: what a basic block is, what an edge means, how an `if` and a `while` look as a CFG.
- The narrow-waist / M+N argument for why an IR exists at all.
- Reading pseudocode and at least skimming C, Java, and a little assembly.
- The idea that the front end produces the IR and the back end consumes it.

You do **not** yet need:

- The exact textual syntax of LLVM IR, GIMPLE, or JVM bytecode (that is `senior.md`).
- The dominance-frontier algorithm in full rigor (we sketch it here, formalize it in `senior.md`).
- Register allocation, instruction selection, or scheduling (the back end, a later topic).

---

## Glossary

| Term | Meaning |
|------|---------|
| **CFG** | Control-flow graph: nodes are basic blocks, edges are possible transfers of control. The substrate for all dataflow analysis. |
| **Predecessor / successor** | In the CFG, the blocks that can branch *to* a block / that a block can branch *to*. |
| **Dataflow analysis** | Computing a fact (constant? live? available?) at every program point by propagating it along CFG edges until it stops changing (a fixpoint). |
| **Use-def chain** | A link from a *use* of a variable to the definition(s) that could supply its value. SSA makes this a single link. |
| **SSA** | Static Single Assignment: an IR form where every variable is assigned exactly once. "Static" = once in the program text, not once at runtime. |
| **φ-function (phi)** | A pseudo-instruction at a merge point: `x3 = φ(x1, x2)` means "x3 is x1 if we arrived via the first predecessor, x2 if via the second." |
| **Dominator** | Block A *dominates* block B if every path from entry to B passes through A. Entry dominates everything. |
| **Dominator tree** | A tree where each block's parent is its *immediate dominator* — the closest strict dominator. |
| **Dominance frontier** | For block A, the set of blocks where A's dominance "stops": the merge points where a definition in A may need a φ. The key to minimal SSA placement. |
| **Out-of-SSA** | Lowering φ-functions back into ordinary copies before code generation, because hardware has no φ instruction. |
| **Register-based IR** | An IR that names every value in a (virtual) register: `%1 = add %a, %b`. LLVM IR, GIMPLE-in-SSA. |
| **Stack-based IR** | An IR with an implicit operand stack; operators pop inputs and push results. JVM bytecode, CIL, Wasm. |
| **CPS** | Continuation-passing style: a functional IR where every function takes an extra argument, the *continuation*, called instead of returning. |
| **ANF** | A-normal form: a functional IR where every intermediate result is `let`-bound to a name — essentially functional three-address code. |
| **Typed IR** | An IR where every value carries a type (`i32`, `double`, `ptr`). Enables verification and type-driven lowering. |
| **Critical edge** | A CFG edge from a block with multiple successors to a block with multiple predecessors. Must be split before out-of-SSA copy placement. |

---

## Core Concepts

### 1. From the AST to the CFG: building the graph

The junior level *showed* you a CFG; the middle level *builds* one. Construction has two phases.

**Phase 1 — lower the AST to a flat instruction list with labels and branches.** Control-flow constructs become explicit jumps:

- `if (c) A else B` → evaluate `c`, conditional branch to `then`/`else`, both ending in a jump to a common `join` label.
- `while (c) Body` → a `header` label, evaluate `c`, conditional branch to `body`/`exit`, body ends with a jump back to `header` (the **back edge**).
- `for`, `break`, `continue` desugar into the same primitives.

**Phase 2 — partition the list into basic blocks and connect edges.** A **leader** is the first instruction of a block. The leaders are: (1) the first instruction, (2) any branch *target*, (3) any instruction *immediately after* a branch. A basic block runs from one leader up to (but not including) the next. Then add edges: a conditional branch creates two edges (taken / fall-through), an unconditional branch one, a `return` none.

```text
Leaders rule, by example:

  0: t = x > 0          <- leader (first instr)
  1: br t, L_then, L_else
  2: L_then: y = 1      <- leader (branch target)
  3: br L_join
  4: L_else: y = 2      <- leader (branch target)
  5: br L_join
  6: L_join: z = y      <- leader (branch target)
```

Once you have the CFG you have the universal substrate: liveness, reachability, loop detection, and every optimization are graph walks over it.

### 2. Why ordinary IRs make optimization expensive

Consider this fragment after lowering:

```text
x = 1
if c goto L2
x = 2
L2:
y = x + 10
```

Question: at `y = x + 10`, what value does `x` have? **It depends on the path.** If `c` was true, `x` is 1; otherwise `x` is 2. To answer mechanically you run a dataflow analysis: start at entry, push facts forward along edges, and at the merge (`L2`) *combine* the facts arriving from both predecessors. The combination here is "1 or 2 — not a single constant," so constant propagation correctly refuses to fold `x`.

That works, but notice the cost: every analysis must independently re-derive "which definition reaches this use," because the name `x` is overloaded — it names two different runtime values at two different program points. **SSA removes the overloading**, and with it most of the bookkeeping.

### 3. SSA: every name assigned once

Rename so each assignment gets a fresh subscript, and each use refers to the subscript that defined it:

```text
x1 = 1
if c goto L2
x2 = 2
L2:
x3 = φ(x1, x2)
y1 = x3 + 10
```

Three things happened:

1. `x` became `x1`, `x2`, `x3` — each defined exactly once.
2. At the merge `L2`, a **φ-function** `x3 = φ(x1, x2)` was inserted: it selects `x1` if control arrived from the first predecessor (the `if`-true path) and `x2` if from the second (the fall-through). φ is not a real machine instruction; it is a *notation* for "the value depends on which edge we came in on."
3. The use in `y1 = x3 + 10` names `x3` — and `x3` has exactly one definition (the φ), so the use-def link is a single, unambiguous pointer.

Now any optimization that needs "where did this value come from?" follows one edge. Constant propagation, for instance, walks `x3 → φ(x1, x2) → {1, 2}` and immediately sees the merge is non-constant. No per-block fact tables, no fixpoint iteration over the whole function for this query.

### 4. Where do φ-functions go? Dominance frontiers, intuitively

You do not slap a φ at every merge. You need one for a variable `v` exactly where two different definitions of `v` can *both* reach a block. The precise, minimal rule uses **dominance**:

- **A dominates B** if every path from the function entry to B goes through A.
- The **dominance frontier of A**, written DF(A), is the set of blocks B such that A dominates a *predecessor* of B but does not strictly dominate B itself. Intuitively: DF(A) is the first place where A's influence merges with control flow that bypassed A.

The placement rule (Cytron et al., 1991): **for each block that defines `v`, insert φ-functions for `v` at every block in that block's dominance frontier** — and repeat, because a freshly inserted φ is itself a new definition (the iterated dominance frontier). This produces *minimal* SSA: the fewest φ-functions that still capture every merge. You do not have to memorize the algorithm at this level; you must understand its output — **φ lands at control-flow merges where a value could have come from more than one definition.** The two canonical cases:

```text
if-merge:                          loop header:

  def x1        def x2               x0 = ...        (before loop)
     \           /                      |
      \         /                  +---> header:
       merge:                      |       x1 = φ(x0, x2)
       x3 = φ(x1, x2)              |       ...uses x1...
                                   |       x2 = x1 + 1
                                   +------ back edge to header
```

The **loop φ** is the one that surprises people: the header has two predecessors — the preheader (first time in) and the back edge (every later iteration) — so the loop variable needs `x1 = φ(x0, x2)` at the top. This is the SSA fingerprint of a loop.

### 5. The dominator tree

Dominance also gives you the **dominator tree**: each block's parent is its *immediate dominator* (idom), the closest block that strictly dominates it. The dominator tree is to SSA what the CFG is to dataflow: many SSA algorithms (φ placement, the renaming pass, scoped value numbering) walk the dominator tree rather than the CFG, because dominance precisely captures "definitions visible here." A definition in block A is visible (without a φ) in every block A dominates — i.e., A's subtree in the dominator tree.

### 6. Getting out of SSA

No CPU has a φ instruction. Before code generation you must **destruct SSA**, turning each φ into ordinary copies on the incoming edges:

```text
SSA:                          After out-of-SSA:

L2: x3 = φ(x1, x2)            in the if-true predecessor:  x3 = x1
                              in the fall-through predecessor: x3 = x2
                              L2: (x3 already set on whichever edge)
```

A φ with N arguments becomes N copies, one placed at the end of each corresponding predecessor block. Two subtleties bite here:

- **Critical edges** — an edge from a block with multiple successors to a block with multiple predecessors — have nowhere safe to put the copy (putting it in the source affects the *other* successor; putting it in the destination affects the *other* predecessor). You **split** the critical edge by inserting a fresh empty block on it, then place the copy there.
- **Parallel φ semantics / the swap problem** — all φ-functions at the top of a block execute *simultaneously*. Naively serializing copies like `a2 = b1; b2 = a1` corrupts the swap. Correct out-of-SSA uses a parallel-copy sequencer (sometimes needing a temporary) to preserve the simultaneous semantics.

### 7. Register-based vs stack-based vs functional IRs

SSA lives most naturally in a **register-based** IR, where each value already has a name. But not every IR is register-based:

- **Register-based** (LLVM IR, GIMPLE): unlimited virtual registers, every value named. Easy to analyze, easy to put in SSA, larger to encode. Optimizing compilers prefer it.
- **Stack-based** (JVM bytecode, .NET CIL, WebAssembly): no named temporaries; operands live on an implicit **operand stack**. `a + b` is `load a; load b; add`. Compact and easy to verify/distribute — which is why *bytecode* you download (a `.class`, a `.wasm`) is stack-based — but the implicit stack obscures dataflow, so JITs immediately convert stack bytecode into a register/SSA IR before optimizing.
- **Functional / CPS / ANF** (compilers for ML, Scheme, Haskell-ish languages): instead of mutable variables they use immutable `let`-bindings. **A-normal form** names every intermediate result with a `let` — which is *exactly* three-address code, and because each `let` binds once, ANF is **SSA by construction**. **Continuation-passing style** goes further: functions never return; they call a *continuation*. CPS makes control flow explicit as function calls and, like ANF, gives single-assignment for free. The deep insight — that SSA and functional CPS/ANF are two views of the same thing — is one of the elegant results in compiler theory.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **SSA renaming** | Versioning a document: instead of overwriting `report.doc`, you save `report_v1`, `report_v2`, `report_v3`. Each name pins one exact content. |
| **φ-function** | A confluence of two rivers labeled "the water here is whichever river you floated down." It does not *do* anything physical; it records which source fed this point. |
| **Loop φ** | A meeting that starts with "who's here from last time, and who's new?" — reconciling the first-iteration value with the carried-over value. |
| **Dominator** | A mountain pass every route to the valley must cross. If you're in the valley, you definitely came through the pass. |
| **Dominance frontier** | The town square where the road *through the pass* first meets a road that went around it. That's exactly where you must ask "which way did you come?" — i.e., place a φ. |
| **Out-of-SSA copies** | Translating the abstract "whichever river" note back into concrete plumbing: lay a pipe on each incoming branch. |
| **Critical edge splitting** | Adding a small junction box on a wire that fans both in and out, so you have a place to attach a tap without affecting other circuits. |
| **Stack-based IR** | Reverse-Polish (HP) calculator: push operands, hit `+`, it consumes the top two. |
| **CPS** | Giving a courier the *next* address to deliver to instead of expecting them to come back to you. |

---

## Mental Models

### The "one name, one meaning" model

The whole point of SSA is to make a name mean exactly one thing. In ordinary code, `x` is a *mailbox* whose contents change. In SSA, each `xk` is a *value*, written once, never overwritten. When you reason about SSA, stop thinking "what's in the box now?" and start thinking "this name *is* this value." Almost every optimization gets simpler under this shift, because a value can be substituted for its name freely — it never changes underneath you.

### The "φ records the past, it doesn't compute" model

Beginners try to "run" φ and ask what it does. It does nothing operationally except *select based on the incoming edge*. Think of φ as a label the compiler attached to a merge point: "the value living here is x1 along this edge and x2 along that edge." All the real work happens when you go out of SSA and turn that label into actual copies on the edges. Until then, φ is pure bookkeeping that makes the merge analyzable.

### The "dominance = visibility" model

A definition is "in scope" — usable without a φ — exactly in the part of the program it dominates, i.e., its subtree in the dominator tree. The moment control flow can reach a block *without* passing through your definition, your value is no longer the only candidate, and you've hit a dominance frontier: insert a φ. Hold this picture and SSA construction stops being magic — φ goes precisely where dominance "runs out."

### The "stack IR is for transport, register IR is for thinking" model

Stack-based bytecode is optimized for being small, verifiable, and portable — a transport format. Register/SSA IR is optimized for analysis and transformation — a thinking format. Real systems use both: ship stack bytecode, then the JIT rebuilds a register-SSA IR in memory to optimize. Don't ask "which is better"; ask "for which job."

---

## Code Examples

The IR syntax below is faithful in *shape* to real IRs; exact LLVM/GIMPLE/bytecode syntax is in `senior.md`.

### Example 1: Building basic blocks from a flat list

Source:

```c
int classify(int x) {
    int r;
    if (x > 0) r = 1; else r = -1;
    return r;
}
```

Flat IR with labels, then the block partition:

```text
entry:
    t1 = x > 0
    br t1, then, else
then:
    r1 = 1
    br join
else:
    r2 = -1
    br join
join:
    r3 = φ(r1, r2)      ; <- merge needs a φ
    ret r3
```

Four blocks; edges `entry→then`, `entry→else`, `then→join`, `else→join`. The merge `join` has two predecessors and a value (`r`) defined differently on each path — hence the φ.

### Example 2: A loop and its loop-header φ

Source:

```c
int sum_to(int n) {
    int s = 0, i = 1;
    while (i <= n) { s = s + i; i = i + 1; }
    return s;
}
```

SSA form:

```text
entry:
    s0 = 0
    i0 = 1
    br header
header:
    s1 = φ(s0, s2)      ; s from preheader OR from back edge
    i1 = φ(i0, i2)
    t  = i1 <= n
    br t, body, exit
body:
    s2 = s1 + i1
    i2 = i1 + 1
    br header           ; back edge
exit:
    ret s1
```

Two φ-functions at the header, one per loop-carried variable. The first argument of each comes from the preheader (`entry`), the second from the back edge (`body`). This "two-argument φ at the header" is the unmistakable SSA signature of a loop, and it is what lets loop optimizations identify induction variables (`i` here, with `i1 = φ(i0, i2)` and `i2 = i1 + 1`).

### Example 3: SSA simplifies constant propagation (a worked transform)

Before:

```text
a1 = 3
b1 = 4
c1 = a1 + b1        ; both operands have single defs that are constants
d1 = c1 * 2
```

Because each name has one definition, the optimizer reads `a1=3`, `b1=4`, folds `c1 = 7`, then `d1 = 14`, in a single forward sweep with no per-block fact merging:

```text
a1 = 3
b1 = 4
c1 = 7
d1 = 14            ; and a1,b1,c1 are now dead -> DCE removes them
```

In a non-SSA IR you'd have to prove no intervening redefinition of `a` or `b` reaches the `c = a + b` use. In SSA that proof is free — there *is* no other definition.

### Example 4: Out-of-SSA — φ becomes copies, with a critical edge

Take Example 1's φ `r3 = φ(r1, r2)`. The edges `then→join` and `else→join` are *not* critical (each predecessor has one successor), so we can place copies directly:

```text
then:
    r1 = 1
    r3 = r1            ; copy inserted on the then->join edge
    br join
else:
    r2 = -1
    r3 = r2            ; copy inserted on the else->join edge
    br join
join:
    ret r3             ; φ gone
```

If an edge *had* been critical (its source had another successor), we'd first split it:

```text
     A (br t, join, other)         A (br t, edge_block, other)
        |                              |
        v                  ==>     edge_block:  r3 = r1; br join
       join (multiple preds)           |
                                        v
                                       join
```

The fresh `edge_block` gives the copy a home that affects only the `A→join` path.

### Example 5: Stack-based vs register/SSA for `(a + b) * c`

```text
Register / SSA (LLVM-ish, every value named):
    t1 = add a, b
    t2 = mul t1, c

Stack-based (JVM-bytecode-ish, implicit operand stack):
    load a        ; stack: [a]
    load b        ; stack: [a, b]
    add           ; stack: [a+b]
    load c        ; stack: [a+b, c]
    mul           ; stack: [(a+b)*c]
```

The register form already names every intermediate (so it's one rename away from SSA). The stack form is shorter and trivially verifiable (each opcode's stack effect is fixed) but you must *simulate the stack* to recover the dataflow — which is exactly the first thing a JIT does when it ingests bytecode.

### Example 6: ANF is SSA-by-construction

A functional expression and its A-normal form:

```text
Source:    (f (g x) (h y))

ANF:       let t1 = g x in
           let t2 = h y in
           let t3 = f t1 t2 in
           t3
```

Each `let` binds a name exactly once — that is single assignment with no φ needed for straight-line code, and φ-equivalents arise only at functional `if`/`match` merges. This is why ML- and Scheme-family compilers often phrase their optimizations on ANF/CPS rather than building classical SSA: they already have it.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **SSA form** | Trivial use-def chains; most optimizations get simpler and faster; enables sparse analyses | Construction needs dominance machinery; φ adds a non-native construct you must later remove |
| **CFG substrate** | Universal basis for liveness, loops, reachability, all dataflow | Must be kept consistent on every transform; stale CFG = miscompile |
| **Register-based IR** | Named values; natural fit for SSA and optimization | Larger encoding; not as compact for shipping |
| **Stack-based IR** | Compact, easy to verify, portable for distribution | Implicit stack hides dataflow; usually re-lifted to registers before optimizing |
| **Typed IR** | Verifiable; catches malformed transforms; drives correct lowering | Type system adds complexity and must be maintained across passes |
| **CPS / ANF** | Single-assignment for free; control flow explicit; clean for functional langs | Verbose; closure conversion and continuation handling add their own complexity |
| **φ-functions** | Capture merge values precisely and minimally | Parallel-execution semantics and critical edges make out-of-SSA subtle |

---

## Use Cases

- **Constant propagation / folding** — SSA gives single-definition operands; conditional constant propagation (SCCP) walks the SSA graph and the CFG together.
- **Dead-code elimination** — a definition with no uses (no SSA name reads it) is dead; mark-and-sweep over use-def chains.
- **Global value numbering / CSE** — equal SSA values share a number; redundant computations collapse.
- **Loop optimizations** — loop-header φ identifies induction variables, enabling strength reduction, LICM (hoisting), and unrolling.
- **Register allocation** — operates after out-of-SSA (or on SSA directly, where interference has nice structure thanks to dominance).
- **Lifting bytecode in a JIT** — JVM/CLR/Wasm bytecode is decoded, the operand stack is simulated, and a register-SSA IR is built for the optimizer.
- **Static analyzers and verifiers** — many lower to SSA because single-assignment makes taint/def-use reasoning direct.

---

## Coding Patterns

### Pattern 1: Compute leaders, then cut blocks

```python
def basic_blocks(instrs):
    leaders = {0}
    for i, ins in enumerate(instrs):
        if ins.is_branch():
            for target in ins.targets():
                leaders.add(label_index[target])
            if i + 1 < len(instrs):
                leaders.add(i + 1)          # fall-through after a branch
    # cut the instruction list at each leader
    ...
```

The three leader rules (first instruction, branch targets, instruction-after-branch) are all you need.

### Pattern 2: φ placement via (iterated) dominance frontiers

```text
for each variable v:
    worklist = blocks that define v
    while worklist not empty:
        b = worklist.pop()
        for d in DominanceFrontier[b]:
            if d has no φ for v:
                insert φ for v at d
                if d did not previously define v:
                    worklist.add(d)        # the φ is itself a new def
```

This is the heart of Cytron's algorithm: a φ is a definition, so inserting one can force more φ-functions downstream.

### Pattern 3: SSA renaming by a dominator-tree walk

```text
rename(block):
    for each φ and instruction in block:
        replace each used name with the current top-of-stack version
        if it defines v: push a fresh version vk, record it as the def
    for each successor s: fill in s's φ argument for the edge block->s
    for each child c in the dominator tree: rename(c)
    pop the versions this block pushed
```

Renaming walks the **dominator tree** (not the CFG) because dominance is exactly "which definition is visible here."

### Pattern 4: Out-of-SSA with critical-edge splitting

```text
for each critical edge (u -> v): insert a new block on it
for each φ  x = φ(a_pred1, a_pred2, ...) in block v:
    for each predecessor p_i with argument a_i:
        append copy "x = a_i" at the end of p_i
    delete the φ
sequence parallel copies in each block to preserve simultaneous semantics
```

### Pattern 5: Verify after every structural pass

Run a cheap checker: every block ends in exactly one terminator; every branch target exists; every SSA name has exactly one definition that dominates all its uses; every φ has one argument per predecessor. Cheap to write, saves hours.

---

## Best Practices

- **Keep the CFG and SSA invariants true at all times.** If a pass deletes a block, fix predecessor lists and φ-argument counts in the same step. A φ with the wrong number of arguments is a silent miscompile.
- **Walk the dominator tree for SSA work, the CFG for dataflow.** Using the wrong graph is a common source of subtle bugs.
- **Split critical edges before going out of SSA.** It's the standard prerequisite; skipping it places copies that corrupt sibling paths.
- **Respect parallel φ semantics.** All φ at a block top fire simultaneously; serialize copies through a sequencer (and a temp for cycles like swaps).
- **Prefer minimal/pruned SSA.** Don't insert φ for a variable that's dead at the merge; pruned SSA combines φ placement with liveness to avoid useless φ.
- **Lift stack bytecode to a register IR before optimizing.** Don't try to optimize directly on an implicit operand stack.
- **Type your IR if you can.** A verifier that checks types catches the majority of malformed-transform bugs immediately.
- **Make the IR printable and round-trippable.** Print → reparse should give an equivalent IR; it makes tests and debugging vastly easier.

---

## Edge Cases & Pitfalls

- **φ in the wrong place or with the wrong arity.** A φ must have exactly one argument per predecessor edge, in a consistent order. Adding or removing a CFG edge without updating φ arguments is a classic corruption.
- **The swap / parallel-copy hazard.** `a = φ(b...)` and `b = φ(a...)` at the same block top must swap *simultaneously*. Naive sequential copies (`a=b; b=a`) lose a value. Use a temporary.
- **Critical edges.** Forgetting to split them puts an out-of-SSA copy where it affects an unintended path — a wrong-code bug that only triggers on certain control flow.
- **Undefined / partially-initialized variables.** If a variable is read on a path where it was never assigned, SSA construction produces a φ with an "undef" argument. Real IRs model this explicitly (LLVM `undef`/`poison`); don't paper over it.
- **Irreducible control flow.** `goto` spaghetti can create loops with multiple entries (irreducible CFGs). Dominance still works, but loop-based optimizations and some SSA simplifications get harder; compilers sometimes node-split to recover reducibility.
- **Treating φ as executable.** φ is not a machine op; if your back end emits a "phi instruction" you forgot to destruct SSA.
- **Stale dominator tree.** Many SSA passes rely on the dominator tree; if a transform changes the CFG and you reuse a cached dominator tree, every subsequent decision is built on a lie.
- **Stack-IR depth mismatches.** In stack bytecode, every path to a join must leave the operand stack at the same depth and type; verifiers reject otherwise. A bug in your lowering shows up as a stack-underflow/verify error, not a wrong answer.

---

## Common Mistakes

1. Inserting a φ at *every* merge instead of only where two definitions actually reach (bloated SSA, slow analyses).
2. Using the CFG instead of the dominator tree for the renaming walk.
3. Forgetting that a freshly inserted φ is itself a definition (so the iterated dominance frontier matters).
4. Going out of SSA without splitting critical edges.
5. Serializing parallel φ copies and corrupting a swap or a cycle.
6. Mutating the CFG and leaving φ arguments out of sync with predecessor count/order.
7. Trying to optimize stack bytecode directly instead of lifting to a register IR.
8. Assuming SSA means "assigned once at runtime" — it means once in the *program text*; a loop body's `x2 = x1 + 1` runs many times.
9. Reusing a cached dominator tree after a CFG-changing pass.
10. Emitting code without ever destructing SSA (no hardware has φ).
11. Conflating ANF (`let`-bound names) with classical SSA φ placement — ANF gets single-assignment but still needs join handling for `if`/`match`.
12. Forgetting that JVM/CIL/Wasm verify stack consistency at merges; mismatched depth/type is rejected before your code ever runs.

---

## Tricky Points

- **"Static" in SSA refers to the text, not the dynamics.** `i1 = φ(i0, i2)` in a loop header is a single static definition that produces a different value every iteration.
- **φ-functions execute in parallel.** All φ at the top of a block read their arguments *before* any of them writes. This is why swaps are subtle going out of SSA.
- **Minimal vs pruned SSA.** Minimal SSA (dominance frontiers) can still place φ for variables that are dead past the merge. Pruned SSA adds a liveness check to drop those.
- **Dominance frontier is about *where dominance stops*, not where control merges in general.** Most merges do need a φ for some variable, but the precise trigger is "a def's dominance ends here."
- **SSA and CPS/ANF are the same idea.** A well-known result (Kelsey; Appel) is that SSA form and CPS are inter-translatable; functional compilers get SSA's benefits without ever saying "φ."
- **x86/ARM never see φ.** φ is purely an IR-internal device. By the time you're choosing real registers, every φ is gone, replaced by copies (some of which the register allocator then coalesces away).
- **Stack IRs are register IRs in disguise after lifting.** The operand stack is a compact encoding of a dataflow graph; simulating it abstractly reconstructs named values.

---

## Test Yourself

1. Given a flat IR with labels and branches, list the leaders and draw the basic blocks for a function containing one `if` nested inside a `while`.
2. Convert a small function with an `if/else` writing the same variable on both arms into SSA. Where does the φ go, and why exactly there?
3. Write the SSA for a `for` loop with an accumulator and an index. Identify the loop-header φ-functions and name their two arguments by origin (preheader vs back edge).
4. Take a 3-line straight-line program of constant arithmetic, put it in SSA, and show how constant propagation + DCE reduce it to a single instruction.
5. Destruct a 2-argument φ into copies. Then introduce a critical edge and show how splitting it changes where the copy goes.
6. Construct a tiny example where naive sequential out-of-SSA copies corrupt a swap, and fix it with a temporary.
7. Translate `(a + b) * (c - d)` to both a register/SSA IR and a stack-based IR; annotate the stack depth after each stack opcode.
8. Put `(f (g x) (h y))` into A-normal form and argue why ANF already satisfies the single-assignment property without φ.

---

## Cheat Sheet

```
+------------------------------------------------------------------+
|                 INTERMEDIATE REPRESENTATIONS — MIDDLE            |
+------------------------------------------------------------------+
| BUILD THE CFG                                                    |
|   leaders = first instr | branch targets | instr-after-branch   |
|   block = leader .. next leader; add taken/fall-through edges    |
|                                                                  |
| SSA                                                              |
|   rename so each name is defined ONCE: x -> x1, x2, x3           |
|   use-def becomes a single pointer  -> opts get cheap            |
|   "static" = once in the TEXT, not once at runtime              |
|                                                                  |
| PHI (φ)                                                          |
|   x3 = φ(x1, x2)  at merges; picks arg by incoming edge          |
|   placed at the (iterated) DOMINANCE FRONTIER of each def        |
|   loop header gets φ(preheader_val, backedge_val)                |
|   φ are PARALLEL; not a machine instruction                      |
|                                                                  |
| DOMINANCE                                                        |
|   A dom B: every entry->B path goes through A                    |
|   idom -> dominator tree; rename walks the DOM TREE              |
|   def visible (no φ) exactly in A's dominator-tree subtree       |
|                                                                  |
| OUT OF SSA                                                       |
|   φ -> copies on each predecessor edge                           |
|   SPLIT critical edges first                                     |
|   sequence parallel copies (temp for swaps/cycles)              |
|                                                                  |
| IR FAMILIES                                                      |
|   register-based : LLVM, GIMPLE-SSA   (named values; pref. opt)  |
|   stack-based    : JVM/CIL/Wasm       (operand stack; transport) |
|   functional     : CPS / ANF          (let-bound; SSA-for-free)  |
+------------------------------------------------------------------+
```

---

## Summary

- The CFG is built in two phases: lower the AST to a flat branch/label list, then cut basic blocks at leaders (first instruction, branch targets, instruction-after-branch) and wire edges.
- Ordinary IRs make optimization expensive because a variable name is overloaded — many runtime values, one name — forcing every analysis to re-derive which definition reaches each use.
- **SSA** fixes this by renaming so each name is defined exactly once. Use-def chains become single pointers, and most classic optimizations (constant propagation, DCE, GVN) get dramatically simpler.
- **φ-functions** appear at control-flow merges where a value could come from more than one definition; they are placed minimally at the iterated **dominance frontier**, and a loop header always carries `φ(preheader, back edge)`.
- **Dominance** ("every path from entry passes through here") defines the **dominator tree**, which SSA construction and renaming walk because dominance is exactly visibility.
- Hardware has no φ, so you **destruct SSA** into copies on predecessor edges — splitting **critical edges** first and respecting the **parallel** semantics of φ (mind the swap problem).
- IR families differ by job: **register-based** (LLVM, GIMPLE) for analysis, **stack-based** (JVM/CIL/Wasm) for compact transport (lifted back to registers before optimizing), and **functional CPS/ANF**, which is single-assignment by construction — SSA under another name.
