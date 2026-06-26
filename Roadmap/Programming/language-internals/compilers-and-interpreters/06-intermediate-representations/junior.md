# Intermediate Representations — Junior Level

> **Topic:** [Intermediate Representations](README.md)
> **Focus:** The data structure that lives *between* the parser and the machine — what it is, why every serious compiler has one, and the simplest forms (three-address code and the control-flow graph) you should be able to draw by hand.

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

> Focus: **What sits between "I parsed the source" and "I emitted machine code"?** And **why is there anything there at all?**

When you first imagine a compiler, you picture a single arrow: *source code → machine code*. That picture is wrong for every compiler you will actually use. Real compilers insert a third thing in the middle — an **intermediate representation**, or **IR**. The IR is a data structure (not text you usually write, though it can be printed as text) that captures *what the program does* in a form that is no longer the source language and not yet the target machine.

The front end (lexer, parser, semantic analysis) turns your `.c` / `.rs` / `.java` file into the IR. The back end (optimizer, code generator) turns the IR into x86, ARM, or bytecode. The IR is the **handoff point** — the neutral meeting ground where the front end stops caring about syntax and the back end starts caring about registers.

In one sentence: **an IR is the compiler's own private language, designed not for humans to write but for machines to analyze and transform.**

Why bother? Two reasons that a junior should burn into memory:

1. **It decouples languages from machines.** Suppose you support *M* source languages (C, C++, Rust, Swift) and *N* target machines (x86, ARM, RISC-V, WebAssembly). Without an IR, you write a compiler for every pair: *M × N* full compilers. With one shared IR, every language compiles *to* the IR (*M* front ends) and the IR compiles *to* every machine (*N* back ends). You build *M + N* pieces, not *M × N*. This is the single most important idea on this page, and it is exactly why LLVM exists.

2. **It is the place where optimization happens.** You do not want to optimize raw syntax trees (too close to the messy source) or raw assembly (too close to one specific chip). The IR is the sweet spot: clean, regular, and target-independent enough that one optimization (say, "delete code that computes a value nobody uses") works for *every* language and *every* machine at once.

This page covers the *what* and the simplest *how*: the narrow-waist idea, **three-address code** (the classic linear IR shape, e.g. `t1 = a + b`), and the **control-flow graph** (the picture of basic blocks and the jumps between them that every later analysis stands on). Deeper levels go further: `middle.md` introduces **static single assignment (SSA)** and how you build a CFG; `senior.md` covers real IRs (LLVM IR, GIMPLE, JVM bytecode); `professional.md` covers multi-level IRs, MLIR, and how production compilers stack many IRs on top of each other.

> 🎓 **Why this matters for a junior:** The day you understand that the IR is "just a simpler, more regular program that means the same thing," compilers stop being magic. Every confusing thing a compiler does — inlining, constant folding, vectorization — is a transformation on this in-between structure. Learn the structure, and the transformations become obvious.

---

## Prerequisites

What you should know before reading this:

- **Required:** What an **abstract syntax tree (AST)** is — the tree a parser builds from source code. (See `../04-abstract-syntax-trees/junior.md`.)
- **Required:** Basic control flow in any language: `if`, `while`, `for`, function calls.
- **Required:** The rough shape of a compiler pipeline: *lexer → parser → ... → code generator*. (See `../01-the-big-picture/junior.md`.)
- **Helpful but not required:** A vague idea of what assembly looks like — that machines execute small, simple instructions one after another.
- **Helpful but not required:** Knowing that a variable lives in a register or in memory.

You do **not** need to know:

- How SSA is constructed (that is `middle.md`).
- LLVM, GIMPLE, or any real IR's exact syntax (that is `senior.md`).
- Register allocation or instruction selection (that is `../08-code-generation/`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Intermediate Representation (IR)** | A data structure the compiler uses to represent a program *between* the source and the target. Not the source language, not machine code. |
| **Front end** | The part of a compiler that reads source and produces IR: lexer, parser, semantic analysis. Language-specific. |
| **Back end** | The part that turns IR into machine code: optimization and code generation. Machine-specific. |
| **Narrow waist** | The design where many inputs and many outputs all meet at one shared format in the middle — like the hourglass shape of the internet's IP layer. The IR is a compiler's narrow waist. |
| **Lowering** | Translating from a *higher-level* representation to a *lower-level* one (AST → IR, or high-level IR → low-level IR). The information loss is intentional. |
| **Three-address code (TAC)** | A linear IR form where each instruction has at most one operator and (usually) three operands: `result = operand1 op operand2`. |
| **Temporary (temp)** | A compiler-generated variable, usually written `t1`, `t2`, that holds an intermediate value. The compiler invents as many as it needs. |
| **Basic block** | A straight-line sequence of instructions with one entry at the top and one exit at the bottom — no jumps *into* the middle, no jumps *out of* the middle. |
| **Control-flow graph (CFG)** | A graph whose nodes are basic blocks and whose edges are the possible jumps between them. The map of "where can execution go next." |
| **Edge** | A directed connection in the CFG from one block to a block that can run next. |
| **Branch / jump** | An instruction that changes which block runs next (`goto`, `if x goto L`). |
| **Target-independent** | A property of code/IR/optimizations that does not depend on which machine you compile for. |
| **Optimization** | A transformation that makes the program faster or smaller while keeping its meaning. Most optimizations operate on the IR. |
| **SSA** | Static Single Assignment — an IR property where every variable is assigned exactly once. Introduced properly in `middle.md`. |

---

## Core Concepts

### 1. The IR Is a Program That Means the Same Thing, Said More Simply

Take this source line:

```c
x = (a + b) * (a + b);
```

The AST for it is a tree with a `*` at the root and two identical `(a + b)` subtrees. That is faithful to the syntax, but it is awkward to optimize and impossible to hand to a CPU, because a CPU does not understand "multiply two subtrees." The IR rewrites it as a *flat list of one-operation-at-a-time steps*:

```text
t1 = a + b
t2 = a + b
t3 = t1 * t2
x  = t3
```

Each line does exactly one thing. Each line names its result. This is **three-address code**, and it is the most common shape for a beginner-friendly IR. Notice that the IR has *more lines* than the source but each line is *simpler*. That trade — more steps, each trivial — is the whole point: simple, regular steps are easy for the compiler to reason about.

(An optimizer would later notice `t1` and `t2` compute the same thing and rewrite this to one addition. That optimization — *common subexpression elimination* — is exactly the kind of thing the IR exists to enable.)

### 2. The Narrow Waist: M + N, Not M × N

Here is the idea that justifies the existence of IRs. Draw it:

```text
WITHOUT a shared IR:                  WITH a shared IR:

C ──► x86                             C ────┐         ┌──► x86
C ──► ARM                             C++ ──┤         ├──► ARM
C++ ─► x86                            Rust ─┤──► IR ──┤──► RISC-V
C++ ─► ARM                            Swift ┘         └──► Wasm
Rust ► x86
Rust ► ARM       ... (M × N paths)       (M front ends + N back ends)
```

With 4 languages and 4 targets, the left side needs **16** complete compilers. The right side needs **4 + 4 = 8** pieces, and adding a *fifth* language costs one front end (which immediately works on all targets), while adding a *fifth* target costs one back end (which immediately works for all languages). This combinatorial saving is *the* reason LLVM became the foundation of Clang, Rust, Swift, Julia, and dozens of other languages — they all share one IR and one set of back ends.

### 3. Three-Address Code: The Shape

"Three-address" means each instruction names *at most three things*: one result and (up to) two operands. The forms you will see:

| TAC form | Example | Meaning |
|----------|---------|---------|
| Binary op | `t1 = a + b` | compute `a + b`, store in `t1` |
| Unary op | `t2 = -x` | negate `x` |
| Copy | `y = t1` | move a value |
| Conditional branch | `if t1 goto L2` | jump if `t1` is true |
| Unconditional branch | `goto L3` | always jump |
| Label | `L2:` | a named position to jump to |
| Call | `t3 = call f, 2` | call `f` with 2 args |

A complex expression becomes a *sequence* of these by inventing temporaries for each intermediate result. This "flattening" of a tree into a list is one of the first jobs the IR-builder does.

### 4. The Control-Flow Graph: The Picture Underneath Everything

A linear list of TAC has branches in it (`goto`, `if ... goto`). To analyze a program, the compiler groups instructions into **basic blocks** and connects them with edges. A **basic block** is a run of instructions you always execute together: you enter at the top, and you fall straight through to the bottom — no jump can land in the middle, and only the last instruction can be a branch.

Consider:

```c
if (x > 0)
    y = 1;
else
    y = 2;
z = y;
```

As a CFG:

```text
        ┌─────────────────────┐
        │ B0 (entry)          │
        │   t = x > 0         │
        │   if t goto B1      │
        │   else goto B2      │
        └────────┬─────┬──────┘
            true │     │ false
                 ▼     ▼
        ┌──────────┐ ┌──────────┐
        │ B1       │ │ B2       │
        │  y = 1   │ │  y = 2   │
        │ goto B3  │ │ goto B3  │
        └─────┬────┘ └────┬─────┘
              │           │
              └─────┬─────┘
                    ▼
              ┌──────────┐
              │ B3       │
              │  z = y   │
              └──────────┘
```

This graph is the **substrate** for almost everything a compiler does later: figuring out which variables are alive where, which code is unreachable, where loops are, and so on. When you hear "dataflow analysis," it means "walk this graph and track facts." **Build the CFG, and you have unlocked the entire optimization toolbox.**

### 5. Lowering: Information Loss on Purpose

Going from AST to IR is called **lowering**. Each step throws away high-level structure that the machine does not need and makes the low-level structure explicit. The AST says "this is a `for` loop"; the IR says "here is a block, here is a comparison, here is a conditional branch back to the top." The loop *concept* is gone; the loop *mechanics* are spelled out. That is deliberate. Lower-level forms are more uniform and therefore easier to optimize and to translate to machine code. Compilers often lower in several stages — high-level IR, then mid-level, then low-level — which is the subject of later levels.

### 6. Stack-Based vs Register-Based IRs (a First Taste)

There are two big families of IR you will meet:

- **Register-based** IRs (like LLVM IR) use an *unlimited* supply of named virtual registers: `%1 = add i32 %a, %b`. The three-address code above is register-based — each `t1`, `t2` is a virtual register. This is convenient for analysis and is what optimizing compilers prefer.
- **Stack-based** IRs (like **JVM bytecode**, **.NET CIL**, and **WebAssembly**) have no named temporaries. Instead they push operands onto an operand stack and apply operators that pop their inputs and push their result. `a + b` becomes "push a, push b, add" — and `add` implicitly takes the top two stack slots. This is compact (great for *distributing* code, e.g. a `.class` file you download) but the implicit stack makes some analyses fiddlier.

You will meet both. For now just know: a register-based IR names every value; a stack-based IR keeps values on an implicit stack. We will say much more in `senior.md`.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Intermediate representation** | A pivot language at the UN. Instead of training translators for every pair of the 6 official languages, everything goes through one neutral hub. |
| **Narrow waist (M + N)** | A power adapter standard. Every device and every wall socket meets at one plug shape, so you need adapters to the standard, not adapters for every device-to-socket pair. |
| **Three-address code** | A recipe rewritten so each step does one action: "crack egg into bowl," "add flour to bowl," not "combine the egg, flour, and milk." |
| **Temporary variable** | The "hold this for a second" sticky note you write a partial sum on while doing long arithmetic. |
| **Basic block** | A one-way street with no side exits: once you enter, you go straight to the end. |
| **Control-flow graph** | A subway map. Stations are basic blocks; lines are the edges showing where you can go next. |
| **Lowering** | Translating an architect's blueprint into a bricklayer's step-by-step instructions. The "room" concept disappears; the brick-by-brick mechanics appear. |
| **Stack-based IR** | A stack of plates: you put values on top and the operations always work on whatever is at the top. |
| **Register-based IR** | A whiteboard with named boxes; every value gets its own labeled box. |
| **Front end / back end split** | An assembly line where one half builds a neutral chassis and the other half customizes it per market. |

---

## Mental Models

### The Hourglass Model

Picture an hourglass. The wide top is "all the source languages." The wide bottom is "all the target machines." The narrow neck in the middle is the IR. *Everything* flows through that neck. The genius is that you only have to make each language reach the neck, and each machine accept the neck — never connect a language directly to a machine. Whenever someone says "narrow waist," picture this hourglass.

### The "Simpler Program That Means the Same Thing" Model

The IR is not magic and it is not a tree of abstract symbols. It is *a program* — you can read it top to bottom, and it computes the same answer as your source. It is just written in a deliberately boring, regular, one-step-at-a-time style so the compiler can reason about it mechanically. When IR confuses you, slow down and *execute it in your head*. It will produce the same result as the source. That demystifies it instantly.

### The "Map Before You Travel" Model (for the CFG)

Before the compiler can ask "is this variable ever used?" or "can this branch ever be taken?", it needs a *map* of where execution can go. The CFG is that map. Linear instructions are a list of streets; the CFG is the map showing how the streets connect. Every clever analysis is a walk over this map collecting facts. Draw the CFG first; reason second.

---

## Code Examples

Below we take one small function and show its source, its three-address code, and its control-flow graph. The exact IR syntax is invented for teaching (real IRs come in `senior.md`), but the *shape* is faithful.

### Example 1: A straight-line expression → TAC

Source:

```c
int f(int a, int b) {
    return (a + b) * (a - b);
}
```

Three-address code:

```text
f(a, b):
    t1 = a + b
    t2 = a - b
    t3 = t1 * t2
    return t3
```

Each operation gets its own line and its own temporary. The nested expression tree becomes a flat list. This is the most basic lowering: walk the AST, and for each operator node, emit one instruction and a fresh temp.

### Example 2: An `if` → TAC with branches and labels

Source:

```c
int max(int a, int b) {
    int m;
    if (a > b)
        m = a;
    else
        m = b;
    return m;
}
```

Three-address code:

```text
max(a, b):
    t1 = a > b
    if t1 goto L_then
    goto L_else
L_then:
    m = a
    goto L_end
L_else:
    m = b
    goto L_end
L_end:
    return m
```

The high-level `if/else` is gone. In its place: a comparison producing a boolean temp, a conditional jump, and labels marking where execution can land. This is what "lowering control flow" looks like.

### Example 3: The same `max` as a control-flow graph

```text
        ┌─────────────────────┐
        │ entry               │
        │   t1 = a > b        │
        │   if t1 goto then   │
        └───────┬──────┬──────┘
           true │      │ false
                ▼      ▼
        ┌──────────┐ ┌──────────┐
        │ then     │ │ else     │
        │  m = a   │ │  m = b   │
        └─────┬────┘ └────┬─────┘
              └─────┬──────┘
                    ▼
              ┌──────────┐
              │ end      │
              │ return m │
              └──────────┘
```

Four basic blocks, edges showing the two ways to reach `end`. Notice that `m` is assigned in *two different blocks*. The block `end` reads whichever value arrived. Keep this picture in mind — when you reach `middle.md`, this exact "value comes from two places at a merge" situation is what **SSA's φ (phi) function** is invented to handle.

### Example 4: A loop → CFG with a back edge

Source:

```c
int sum_to(int n) {
    int s = 0;
    int i = 1;
    while (i <= n) {
        s = s + i;
        i = i + 1;
    }
    return s;
}
```

Control-flow graph:

```text
   ┌──────────────┐
   │ entry        │
   │  s = 0       │
   │  i = 1       │
   └──────┬───────┘
          ▼
   ┌──────────────┐ ◄────────────┐
   │ header       │              │
   │  t = i <= n  │              │  back edge
   │  if t goto   │              │  (loop)
   │   body       │              │
   └───┬──────┬───┘              │
 true  │      │ false            │
       ▼      ▼                  │
 ┌──────────┐ ┌──────────┐       │
 │ body     │ │ exit     │       │
 │  s = s+i │ │ return s │       │
 │  i = i+1 │ └──────────┘       │
 └────┬─────┘                    │
      └──────────────────────────┘
```

The edge from `body` back up to `header` is a **back edge** — it is how the compiler recognizes a loop. Loops are just cycles in the CFG. Once you can see loops as cycles, loop optimizations (hoisting code out of the loop, unrolling) become graph manipulations.

### Example 5: Stack-based vs register-based for `a + b`

Same expression, two IR families:

```text
Register-based (LLVM-style, named values):
    %1 = add i32 %a, %b

Stack-based (JVM-bytecode-style, implicit operand stack):
    iload a      ; push a
    iload b      ; push b
    iadd         ; pop b, pop a, push a+b
```

The register form names the result (`%1`). The stack form leaves the result on top of the stack for the next instruction to consume. Both are valid IRs; they make different trade-offs (compactness vs ease of analysis).

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Reusability** | One IR lets *M* languages share *N* back ends — the M + N saving. | Designing an IR general enough for many languages is hard; it can become a compromise that serves none perfectly. |
| **Optimization** | A single optimization on the IR benefits every language and every target at once. | An IR too high-level hides machine costs; too low-level loses portability. Picking the level is a real tension. |
| **Analyzability** | A regular, one-operation-per-instruction form is far easier to analyze than an AST or assembly. | More instructions than the source means more to process; naive IRs can be verbose. |
| **Separation of concerns** | Front end and back end can be developed by different teams and evolve independently. | An extra translation stage means more code, more bugs-surface, and a thing to keep in sync. |
| **Portability** | Target-independent IR means new CPUs need only a new back end. | The IR itself must be carefully kept target-neutral, which constrains its design. |
| **Tooling** | The IR can be printed, verified, diffed, and fuzzed — a stable contract in the middle of the compiler. | You now need an IR *verifier* and IR-level tests, more infrastructure to maintain. |

---

## Use Cases

You will encounter or build an IR whenever:

- **You write a compiler or transpiler.** Any tool turning one language into another benefits from an IR in the middle, even a simple one.
- **You optimize code.** Every optimization pass — constant folding, dead-code elimination, inlining — reads and writes the IR.
- **You target multiple platforms.** Compile once to IR, then generate code for x86, ARM, and WebAssembly from the same IR.
- **You build static-analysis or linting tools.** Many bug-finders lower code to an IR (or use SSA form) because it is far more regular than the source.
- **You write an interpreter with a bytecode VM.** The bytecode *is* an IR — a stack-based one you execute directly. (See `../09-interpreters/`.)
- **You instrument or profile programs.** Inserting counters, coverage probes, or sanitizer checks is an IR transformation.

An IR is *overkill* when:

- You are writing a one-shot transpiler between two very similar languages, where a direct AST-to-AST walk is simpler.
- You have exactly one source language and one target and never expect more — though even then, an IR usually pays off the moment you want to optimize.

---

## Coding Patterns

### Pattern 1: Emit-as-you-walk (AST → TAC)

Lowering an AST to three-address code is a recursive walk. Each `gen` call emits instructions and *returns the temporary holding its result*:

```python
counter = 0
def fresh():
    global counter
    counter += 1
    return f"t{counter}"

def gen(node):
    if node.kind == "num":
        return str(node.value)            # literals need no temp
    if node.kind == "var":
        return node.name
    if node.kind == "binop":
        left  = gen(node.left)            # recursively lower operands
        right = gen(node.right)
        t = fresh()
        emit(f"{t} = {left} {node.op} {right}")
        return t                          # caller uses this temp
```

The key idea: a child lowers itself and hands its result up as a temp name; the parent combines child temps into one new instruction. This single pattern lowers any expression tree.

### Pattern 2: Build basic blocks while emitting

Start a new block whenever you emit a label or just after a branch. A simple builder keeps a "current block" and appends to it:

```python
def emit(instr):
    current_block.instructions.append(instr)

def start_block(label):
    global current_block
    current_block = Block(label)
    cfg.add(current_block)
```

The rule for *ending* a block: a branch (`goto`, `if ... goto`) or a `return` is always the last instruction in its block. The next instruction begins a new block.

### Pattern 3: Labels first, fill later (forward branches)

When lowering an `if`, you need to jump to the `else` block before you have emitted it. Allocate the *label name* up front, emit the branch to it, and define the label's block later:

```python
l_then, l_else, l_end = fresh_label(), fresh_label(), fresh_label()
cond = gen(if_node.condition)
emit(f"if {cond} goto {l_then}")
emit(f"goto {l_else}")
start_block(l_then); gen(if_node.then_branch); emit(f"goto {l_end}")
start_block(l_else); gen(if_node.else_branch); emit(f"goto {l_end}")
start_block(l_end)
```

### Pattern 4: One pass per concern

Resist doing everything in one giant pass. Lower to IR in one pass; build the CFG in another; run each optimization as its own pass over the IR. Passes that each do one thing are easy to test and reorder.

---

## Best Practices

- **Keep each IR instruction trivially simple.** One operator, named result. If an instruction does two things, split it. Simplicity is what makes analysis tractable.
- **Make every value have a clear name (in register-based IR).** Never reuse a temp for an unrelated value during lowering — fresh temps are cheap and prevent confusion. (This habit also eases the jump to SSA later.)
- **Build the CFG explicitly.** Do not leave control flow implicit in a flat list. The graph is the thing every later pass needs.
- **Decide your IR's *level* deliberately.** High-level enough to be target-independent, low-level enough that lowering to machine code is straightforward. When unsure, start higher and lower in stages.
- **Print your IR.** A textual dump you can read (and diff in tests) is worth its weight in gold. Every real compiler can print its IR; yours should too.
- **Lower in stages, not one leap.** AST → high-level IR → low-level IR is easier to get right than AST → assembly directly.
- **Verify the IR.** A small checker that asserts "every temp is defined before use," "every block ends in a branch or return," and "every branch target exists" catches a huge class of bugs early.

---

## Edge Cases & Pitfalls

- **Falling off the end of a block.** Every basic block must end in a branch, jump, or return. A block that "just stops" with no terminator is malformed — the CFG has no edge out of it. Forgetting the terminator on the `then` branch of an `if` (so it falls into the `else`) is a classic beginner bug.
- **Reusing a temporary across an unrelated computation.** If `t1` holds `a + b` and you later reuse `t1` for `c * d`, you have created a fake dependency and likely a wrong-code bug. Always use fresh temps while lowering.
- **Confusing "the IR is text" with "the IR is a data structure."** The textual dump is a *view*. Internally the IR is objects/graphs. You manipulate the structure, not strings.
- **Branching into the middle of a block.** By definition impossible in a correct CFG — a jump target must be the *start* of a block. If your lowering produces a jump into the middle of a block, you have split the block wrong.
- **Forgetting that a value at a merge can come from two places.** In the `max` example, `m` is set in two blocks and read in a third. A naive IR just writes `m` twice; this is fine until you move to SSA, where it forces the φ-function. Knowing this now makes `middle.md` painless.
- **Choosing the wrong IR level.** Too high-level (close to the AST) and you cannot express machine concerns; too low-level (close to assembly) and you lose portability and the ability to optimize generally. This is a genuine design decision, not a detail.
- **Treating the IR as throwaway.** Beginners sometimes skip the IR and translate AST straight to assembly. It works for toys and collapses the moment you want optimization or a second target. The IR is the investment that pays off later.
- **Assuming one IR is enough.** Real compilers stack several IRs at different levels. You do not need that on day one, but do not be surprised that LLVM has GENERIC/GIMPLE/RTL-like layering elsewhere and MLIR has many "dialects" — covered in higher levels.
