# Intermediate Representations — Tasks

> **Topic:** [Intermediate Representations](README.md)
> **Focus:** Hands-on exercises that build IR intuition by *doing* — lowering ASTs to three-address code, constructing control-flow graphs, computing dominance, converting to and out of SSA, reading real IR dumps (LLVM, GIMPLE, bytecode, MIR), and finally building a small IR + SSA pipeline end-to-end.

---

## How to use this page

Work top to bottom: **Warm-Up** builds reflexes, **Core** builds the real skills (CFG, dominance, SSA, out-of-SSA), **Advanced** pushes into real IRs and optimization, and the **Capstone** ties everything into one small working pipeline. Each task has a **self-check** so you can grade yourself; hints are folded after the task; full solutions are deliberately **sparse** — given only where the answer is non-obvious or a sanity anchor is valuable. Do the work before peeking.

You'll want: a C compiler with `clang`/`gcc`, a JVM with `javap`, and (optionally) `rustc` for MIR. Any scripting language works for the build tasks; pseudocode is fine if you reason through it carefully.

---

## Warm-Up

### Task W1 — Flatten an expression to three-address code

Lower `x = (a + b) * (a - c) - d` to three-address code, inventing temporaries `t1, t2, …`. Each instruction may have one operator and at most two operands.

**Self-check:** You should have exactly four instructions before the final assignment to `x` (one per operator: `+`, `-`, `*`, `-`), each defining a fresh temporary, and the last operation feeding `x`.

<details>
<summary>Hint</summary>
Walk the expression tree bottom-up; each operator node emits one instruction whose result is a new temp, and returns that temp to its parent.
</details>

<details>
<summary>Solution</summary>

```text
t1 = a + b
t2 = a - c
t3 = t1 * t2
t4 = t3 - d
x  = t4
```
</details>

### Task W2 — Lower an `if/else` to TAC with labels

Lower this to three-address code using labels and conditional/unconditional branches:

```c
if (a > b) m = a; else m = b;
return m;
```

**Self-check:** You must have a comparison producing a boolean temp, a conditional branch, two labeled arms each ending in a jump to a common label, and the `return` after that common label. No high-level `if` should remain.

<details>
<summary>Hint</summary>
Allocate three label names up front (`then`, `else`, `end`); emit the branch to them before you emit their bodies.
</details>

### Task W3 — Identify the leaders

Given this flat instruction list, list the **leaders** (block-start instructions) and state the rule that makes each one a leader.

```text
0: t = n > 0
1: br t, L1, L2
2: L1: x = 1
3: br L3
4: L2: x = 2
5: br L3
6: L3: y = x
```

**Self-check:** There are four leaders: index 0 (first instruction), and the targets of branches. Map each to one of the three leader rules.

<details>
<summary>Solution</summary>
Leaders: 0 (first instruction), 2 (branch target `L1`), 4 (branch target `L2`), 6 (branch target `L3`). Indices 3 and 5 are *not* leaders even though they follow nothing special — but note the "instruction after a branch" rule would make index 2 and 4 leaders anyway; here the branch-target rule already covers them.
</details>

### Task W4 — Draw the CFG

From Task W3's leaders, draw the control-flow graph: list the basic blocks (by their instruction ranges) and all edges.

**Self-check:** Four blocks; `B0` has two successors (`B1`, `B2`); both `B1` and `B2` go to `B3`; `B3` has two predecessors.

### Task W5 — Stack-based vs register-based

Write `(a + b) * c` in (a) a register/SSA style (`t1 = ...`) and (b) a JVM-bytecode-style stack form (`load`, `add`, `mul`). Annotate the operand stack contents after each stack instruction.

**Self-check:** The register form has two instructions; the stack form has five (`load a`, `load b`, `add`, `load c`, `mul`) and the stack ends with a single value `(a+b)*c`.

---

## Core

### Task C1 — Convert a diamond to SSA

Convert to SSA, inserting a φ where needed. Subscript every variable.

```text
        x = 1
     if c goto T
        x = 2
   T:  y = x + 10
```

**Self-check:** `x` becomes two definitions plus a φ at the merge `T`; `y` reads the φ result. The φ must have exactly two arguments, one per path into `T`.

<details>
<summary>Solution</summary>

```text
        x1 = 1
        if c goto T
        x2 = 2
   T:   x3 = φ(x1, x2)
        y1 = x3 + 10
```
The φ at `T` has one argument per predecessor edge: `x1` from the `if-true` path, `x2` from the fall-through path.
</details>

### Task C2 — SSA for a loop (find the header φ)

Convert to SSA and identify the loop-header φ-functions and the origin (preheader vs back edge) of each argument:

```c
int s = 0, i = 1;
while (i <= n) { s = s + i; i = i + 1; }
return s;
```

**Self-check:** The loop header carries two φ-functions, one for `s` and one for `i`. Each has two arguments: the initial value (from the preheader) and the updated value (from the back edge).

<details>
<summary>Hint</summary>
The header has two predecessors: the block before the loop (first entry) and the loop body (every later iteration). That's why each loop-carried variable needs a φ there.
</details>

<details>
<summary>Solution (header only)</summary>

```text
header:
    s1 = φ(s0, s2)    ; s0 from preheader, s2 from back edge
    i1 = φ(i0, i2)    ; i0 from preheader, i2 from back edge
```
</details>

### Task C3 — Compute dominators and the dominator tree

For this CFG, compute the dominator set of each block and draw the dominator tree:

```text
entry -> A
A -> B, A -> C
B -> D
C -> D
D -> exit
```

**Self-check:** `entry` dominates everything. `A` dominates `B, C, D, exit`. `D` dominates `exit` but **not** `B` or `C`. `B` and `C` dominate only themselves (besides being dominated by `A`). The dominator tree has `entry → A`, `A → {B, C, D}`, `D → exit`.

<details>
<summary>Hint</summary>
A block X dominates Y iff *every* path from entry to Y passes through X. `D` is reachable via either B or C, so neither B nor C dominates D — but A does, since both paths go through A.
</details>

### Task C4 — Compute a dominance frontier and place a φ

Using Task C3's CFG, suppose variable `v` is defined in both `B` and `C`. Compute the dominance frontier of `B` (and of `C`), and state where a φ for `v` must go.

**Self-check:** `DF(B) = {D}` and `DF(C) = {D}` — `D` is the block where each definition's dominance "stops" (B dominates a predecessor of D but not D itself). So a φ for `v` goes at `D`: `v3 = φ(v1, v2)`.

<details>
<summary>Hint</summary>
DF(X) = blocks Y where X dominates a predecessor of Y but does not strictly dominate Y. D's predecessors are B and C; B dominates B (a pred of D) but not D → D is in DF(B).
</details>

### Task C5 — Destruct SSA into copies

Take the φ from Task C1 (`x3 = φ(x1, x2)` at `T`) and convert out of SSA: place the correct copy on each predecessor edge. State whether either edge is critical.

**Self-check:** Two copies — `x3 = x1` at the end of the `if-true` path, `x3 = x2` at the end of the fall-through path — and the φ is deleted. Neither edge is critical here (the merge's predecessors each have a single successor), so no edge splitting is required.

### Task C6 — The swap problem

Convert these parallel φ-functions out of SSA *correctly*. Show why naive sequential copies fail.

```text
loop_header:
    a2 = φ(a0, b1)
    b2 = φ(b0, a1)
    ; ... on the back edge, the previous iteration's a1, b1 are the swapped values
```

Assume on the back edge you must effectively perform `a := b; b := a` (a swap).

**Self-check:** Naive `a := b; b := a` loses `a`'s old value. The correct sequence uses a temporary: `tmp := a; a := b; b := tmp`. φ-functions execute in parallel — all read before any write — so the destruction must preserve that simultaneity.

<details>
<summary>Solution</summary>

```text
tmp = a
a   = b
b   = tmp
```
A parallel-copy sequencer detects the cycle (a↔b) and breaks it with one temporary.
</details>

### Task C7 — Split a critical edge

Given:

```text
A: br t, J, K     ; A has two successors (J, K)
J: ...            ; J has two predecessors (A and M)
M: br J
```

The edge `A → J` is critical. You need to destruct a φ at `J` by placing a copy on the `A → J` edge. Show how to split the edge and where the copy goes.

**Self-check:** Insert a fresh block `E` on the `A → J` edge: `A` now branches to `E` (in the `t`-taken case), `E` contains the copy and an unconditional jump to `J`. The copy now affects only the `A → J` path, not `A → K` and not `M → J`.

---

## Advanced

### Task A1 — Read real LLVM IR

Compile a small function and read its LLVM IR:

```c
int sel(int a, int b) { return a > 0 ? a + b : b; }
```

Run `clang -O1 -S -emit-llvm sel.c -o sel.ll` and open `sel.ll`. Identify: the comparison (`icmp`), the branch (`br`), the φ at the merge (its `[value, predecessor]` pairs), and any instruction flags (`nsw`).

**Self-check:** You should find an `icmp sgt`, a conditional `br i1`, a `phi i32 [ ..., %then ], [ ..., %else ]` at the merge block, and the addition likely tagged `nsw` (no-signed-wrap). If `-O1` folded it into a `select`, drop to `-O0` then run `opt -passes=mem2reg` to see the φ.

<details>
<summary>Hint</summary>
At `-O0` LLVM keeps values in stack `alloca` slots (no φ). The `mem2reg` pass promotes them to SSA registers and *introduces* the φ — that's the cleanest way to see SSA.
</details>

### Task A2 — Compare LLVM IR, GIMPLE, and bytecode

Take the same `sel` function. Produce:
- LLVM IR: `clang -O1 -S -emit-llvm`
- GIMPLE-SSA: `gcc -O1 -fdump-tree-ssa sel.c` (read the generated `sel.c.*.ssa` file)
- JVM bytecode: write the equivalent Java method, compile, `javap -c`

Write one paragraph: what's the **same** structurally across all three, and what's **different** about the bytecode.

**Self-check:** Same: all encode a compare + branch + merge; both LLVM and GIMPLE put the merge value behind a φ (`phi` / `PHI`). Different: bytecode is stack-based — no named temporaries, no φ; the merge is just two paths leaving the operand stack consistent, which the verifier checks. To optimize the bytecode a JIT must reconstruct named values and SSA.

### Task A3 — Read rustc MIR

If you have `rustc`, compile:

```rust
fn sel(a: i32, b: i32) -> i32 { if a > 0 { a + b } else { b } }
```

with `rustc --emit=mir sel.rs` (or `-Z dump-mir=all` on nightly). Identify the basic blocks (`bb0`, `bb1`, …), the `switchInt`/`goto`/`return` terminators, and the *places* (`_0`, `_1`, …). Then answer: **why does MIR exist** — what analysis is it primarily there to serve?

**Self-check:** You should see numbered basic blocks ending in terminators, with `_0` as the return place and `_1`/`_2` as the parameters. Primary purpose: **borrow checking** (and drop elaboration, const eval) — MIR is a control-flow-explicit, simplified form built so dataflow analyses like the borrow checker can run; optimization is secondary.

### Task A4 — Constant propagation on SSA, by hand

Put this in SSA, then perform constant propagation + dead-code elimination, showing each step:

```text
a = 3
b = 4
c = a + b
d = c * 2
e = d + a
```

**Self-check:** Because each name has a single definition, you fold forward: `a=3`, `b=4`, `c=7`, `d=14`, `e=17`. Then `a, b, c, d` are dead (if only `e` is used) and DCE removes them, leaving `e = 17`. The point: SSA made every operand's source a single, obvious definition, so no per-block fact-merging was needed.

### Task A5 — Block parameters vs φ (Cranelift style)

Rewrite the SSA from Task C1 using **block parameters** instead of a φ-function (Cranelift/CLIF style): the merge block takes a parameter, and each predecessor passes its value on the jump.

**Self-check:** The merge block becomes `T(x3): y1 = x3 + 10`; the `if-true` path jumps `jump T(x1)` and the fall-through jumps `jump T(x2)`. Semantically identical to `x3 = φ(x1, x2)`, but the merge value is just a normal block argument.

### Task A6 — Find the loop and its induction variable

Given an SSA-form CFG with a back edge, write down (a) how you'd detect the loop (back edge to a block that dominates its source), and (b) how the loop-header φ identifies the induction variable. Use Task C2's result as your example.

**Self-check:** (a) The back edge `body → header` exists and `header` dominates `body`, so it's a natural loop. (b) `i1 = φ(i0, i2)` with `i2 = i1 + 1` is the classic induction-variable pattern: a header φ whose back-edge argument is `header_value + constant`. This is what enables strength reduction and loop-invariant code motion.

---

## Capstone

### Task CAP — Build a mini IR + SSA pipeline

Build a small but complete pipeline for a tiny language (integer variables, `+ - * /`, comparisons, `if/else`, `while`, `return`). Implement, in any language, the following stages, each separately testable:

1. **Parse** the source into an AST (a trivial recursive-descent parser, or hand-build ASTs to skip parsing).
2. **Lower** the AST to three-address code with explicit labels and branches (Warm-Up skills).
3. **Build the CFG**: compute leaders, cut basic blocks, add edges (Core C-tasks).
4. **Compute dominators and the dominator tree** (iterative dataflow is fine; Lengauer–Tarjan if ambitious).
5. **Convert to SSA**: compute dominance frontiers, place φ at iterated dominance frontiers, rename by a dominator-tree walk (Cytron).
6. **Run one optimization**: sparse conditional constant propagation *or* dead-code elimination over the SSA form.
7. **Go out of SSA**: split critical edges, lower φ to parallel copies (mind the swap problem).
8. **Verify** after each stage: every block ends in a terminator; every branch target exists; every SSA name has exactly one definition that dominates all uses; every φ has one argument per predecessor.
9. **Pretty-print** the IR at each stage so you can read and diff it.

**Self-check (acceptance tests):**
- A diamond `if/else` writing the same variable on both arms produces exactly one φ at the merge.
- A `while` loop produces a header φ per loop-carried variable, each with a preheader argument and a back-edge argument.
- Constant propagation reduces a chain of constant arithmetic to a single value, and DCE removes the now-dead definitions.
- Out-of-SSA produces a φ-free IR; a swap-shaped pair of φ-functions is destructed correctly (test it explicitly).
- The verifier rejects an intentionally corrupted IR (e.g., a block with no terminator, or a φ with the wrong argument count).
- Print → parse → print is a fixpoint for your textual IR.

<details>
<summary>Hints / staging advice</summary>

- Implement and test stages **in order**; do not move on until the verifier passes for the current stage. Stale dominator info after a CFG change is the #1 bug — recompute, don't cache, until it works.
- For SSA renaming, walk the **dominator tree** (not the CFG), maintaining a version stack per variable; fill each successor's φ-argument for the edge you traverse.
- For out-of-SSA, split **every** critical edge first, then place copies; sequence parallel copies through a temporary when a cycle (swap) exists.
- Keep φ as an explicit IR node until stage 7; never emit a "phi instruction" to your final printed code — no machine has one.
- A 50-line verifier saves you hours; write it early and run it after every transform.
</details>

<details>
<summary>Stretch goals</summary>

- Add **pruned** SSA (skip φ for variables dead past the merge) by combining φ placement with a liveness analysis.
- Add a second optimization (global value numbering / common-subexpression elimination) and show it removes a redundant computation that constant propagation alone misses.
- Emit the optimized IR as **LLVM IR text** and pipe it through `clang`/`llc` to produce a real executable — proving your IR can ride the real narrow waist.
- Replace φ-functions with **block parameters** throughout and compare which encoding made your passes simpler.
</details>

---

## Progress checklist

```
WARM-UP
  [ ] W1 expression -> TAC
  [ ] W2 if/else -> TAC with labels
  [ ] W3 identify leaders
  [ ] W4 draw the CFG
  [ ] W5 stack vs register form

CORE
  [ ] C1 diamond -> SSA (one phi)
  [ ] C2 loop SSA (header phi)
  [ ] C3 dominators + dom tree
  [ ] C4 dominance frontier + phi placement
  [ ] C5 out-of-SSA copies
  [ ] C6 swap problem (parallel copies)
  [ ] C7 split a critical edge

ADVANCED
  [ ] A1 read LLVM IR (mem2reg phi)
  [ ] A2 LLVM vs GIMPLE vs bytecode
  [ ] A3 read rustc MIR (why it exists)
  [ ] A4 const prop + DCE on SSA
  [ ] A5 block parameters vs phi
  [ ] A6 loop + induction variable

CAPSTONE
  [ ] CAP mini IR + SSA pipeline (all acceptance tests green)
```

---

## What you should be able to do now

- Flatten any expression and control-flow construct into three-address code with explicit basic blocks and edges.
- Compute dominators, the dominator tree, and dominance frontiers, and use them to place φ-functions minimally.
- Convert to and out of SSA correctly — including the swap problem and critical-edge splitting.
- Read and compare real IR dumps (LLVM IR, GIMPLE, JVM bytecode, rustc MIR) and explain each IR's design intent.
- Run a basic SSA-based optimization by hand and see why SSA makes it cheap.
- Build a small, verifiable IR pipeline end to end — the concrete proof that you understand the structure every real compiler stands on.
