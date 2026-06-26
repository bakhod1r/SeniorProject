# The Big Picture (Compiler Architecture) — Middle Level

> **Topic:** [The Big Picture (Compiler Architecture)](README.md)
> **Focus:** The phases as real engineering boundaries — why the IR is the load-bearing wall, why front/middle/back is a contract, and how real compilers (GCC, LLVM, JVM) actually lay this out.

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
18. [What You Can Build](#what-you-can-build)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)
21. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: At junior level the pipeline was a list of boxes. Here the boxes become **engineering boundaries with real contracts** — and you learn why those boundaries are where they are, not somewhere else.

The junior page gave you the stages and their order. Now the harder questions: *Why is the IR the dividing line between "middle" and "back" rather than the AST? Why does semantic analysis come after parsing and not during it? Why does GCC have three IRs (GENERIC, GIMPLE, RTL) while LLVM brags about having essentially one? What does it actually mean for a representation to be "language-independent"?*

A compiler is a sequence of transformations between **data structures**, and the architecture is fundamentally about *where you draw the lines* between those structures and *what invariant each line guarantees*. The front/middle/back-end split is not decoration — it is a **contract**. The front end promises the middle end: "I will hand you well-formed IR with all names resolved and all types checked." The middle end promises the back end: "I will hand you optimized IR that means exactly what the program means." Because these contracts are clean, you can replace any one stage without touching the others — and that replaceability is the whole economic argument for the design.

This level builds the working mental model a mid-level engineer needs: what each phase's data structure is, what invariant it establishes, where the IR sits and why, and how the three biggest real systems (LLVM, GCC, the JVM) instantiate the same abstract pipeline differently.

---

## Prerequisites

- The [junior](junior.md) page: the names and order of the pipeline stages, and the front/middle/back split.
- Comfort reading a tree data structure and a simple grammar (you have seen `expr := expr '+' term` style rules).
- Having run `gcc -S` or `clang -emit-llvm` at least once and looked at the output.
- Basic understanding of types and scopes in a programming language (what "x is out of scope here" means).
- A rough idea of what assembly is — you don't need to write it, but you should recognize `mov`/`add`/`ret`.

You do **not** yet need:

- SSA form, dataflow analysis, or specific optimization algorithms (senior material).
- Register allocation or instruction scheduling internals (senior/professional).
- The formal theory of parsing (LL/LR) — that's the parser topic.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Phase** | A logical stage of compilation (lexing, parsing, semantic analysis, optimization, codegen). Phases are conceptual; passes are concrete traversals. |
| **Pass** | One concrete traversal of the program's data structure. A phase may take several passes. |
| **Parse tree (CST)** | A "concrete syntax tree" mirroring the grammar exactly, including every punctuation token. Usually transformed into an AST. |
| **AST** | "Abstract" syntax tree: the parse tree with noise (parentheses, semicolons) removed, keeping only structure. |
| **Name resolution** | Binding each use of a name to its declaration. Resolves scopes and shadowing. Part of semantic analysis. |
| **Type checking** | Verifying that operations are applied to compatible types; inferring types where the language allows. |
| **Symbol table** | The data structure mapping names to declarations, types, and scope information. Built and consulted during semantic analysis. |
| **IR (Intermediate Representation)** | The compiler's internal program form between front and back end. May be tree-like, graph-like (CFG), or linear (three-address). |
| **Lowering** | Translating a higher-level representation into a lower-level one (AST → IR, IR → machine code). |
| **CFG (Control-Flow Graph)** | A graph whose nodes are straight-line "basic blocks" and whose edges are jumps/branches. The standard IR shape for optimization. |
| **GENERIC / GIMPLE / RTL** | GCC's three internal IRs: a language-neutral tree (GENERIC), a simplified three-address form (GIMPLE), and a low-level register-transfer form (RTL). |
| **LLVM IR** | LLVM's single, typed, SSA-based intermediate representation, usable as in-memory data, readable text (`.ll`), or binary bitcode (`.bc`). |
| **Bytecode** | A compact, portable IR designed to be executed by a virtual machine (JVM bytecode, CPython bytecode, V8's Ignition bytecode). |
| **Translation unit** | The unit of separate compilation: roughly one source file plus its includes, compiled independently. |
| **Driver** | The orchestrating program (`gcc`, `clang`, `rustc`) that runs the sub-tools in order. |
| **AOT / JIT** | Ahead-of-Time (compile before run) vs Just-In-Time (compile during run) — two architectural placements of the back end. |
| **Front/middle/back end** | The language-specific / neutral / target-specific three-way partition of the pipeline. |

---

## Core Concepts

### 1. Phases vs passes: the conceptual and the concrete

A **phase** is a *responsibility* (lexing, parsing, type-checking). A **pass** is a *traversal* — one walk over the data structure. The mapping is not one-to-one:

- The lexer is usually one pass, on demand (the parser pulls tokens as it needs them).
- Parsing is typically one pass.
- Semantic analysis is often *several* passes: one to collect all top-level declarations (so functions can call each other regardless of order), then one to resolve names and check types.
- Optimization is *many* passes — constant folding, then dead-code elimination, then inlining, then constant folding again because inlining exposed new constants.

This is the line between a **single-pass** and **multi-pass** compiler. Single-pass compilers (classic Pascal, Go's front end is famously fast) fuse phases to read the source once. The cost is power: you can't optimize across the whole program if you've already emitted code for the first half of it. Multi-pass trades compile time for the ability to see the whole program before committing.

### 2. Each phase establishes an invariant for the next

The pipeline works because each phase *guarantees something* its successor can rely on:

| After this phase... | ...the next phase can assume: |
|---------------------|-------------------------------|
| Lexing | The input is a clean stream of tokens; no stray characters, comments stripped. |
| Parsing | The token stream was grammatically valid; we have a well-formed tree. |
| Name resolution | Every identifier points at a real declaration; no "undeclared variable" remains. |
| Type checking | Every operation is type-correct; no "can't add a string to an int" remains. |
| IR generation | The program is in a uniform, simple form; high-level sugar (for-loops, ternaries) is desugared into primitives. |
| Optimization | The IR is semantically equivalent but improved; the back end need not re-optimize. |

This is why **order matters and is not arbitrary**: you cannot type-check a name you haven't resolved; you cannot resolve a name in a tree you haven't built; you cannot build a tree from tokens you haven't lexed. Each phase *depends on the invariant the previous one established*.

### 3. Why the IR — not the AST — is the front/back boundary

You might think the AST is the natural meeting point: it's already language-structured. But the AST is the *wrong* boundary, for three reasons:

1. **The AST is too language-specific.** A Rust AST has `match` and lifetimes; a C AST has `goto` and pointer arithmetic. A back end shouldn't have to understand every language's syntax tree. The IR is *deliberately impoverished* — a small, uniform instruction set that all front ends lower into.
2. **The AST is too high-level for optimization.** Optimizations want simple, explicit operations (one operation per instruction, explicit temporaries, explicit control flow as a graph). The AST hides control flow inside nested nodes. The IR makes it a flat **control-flow graph** that algorithms can walk.
3. **The IR is where the M + N reuse pays off.** If the boundary were the AST, every back end would need M parsers' worth of knowledge. By lowering all languages to one IR, the back end learns *one* thing. This is the entire reason LLVM IR exists as a first-class, documented, stable artifact.

So the IR sits *below* the AST and *above* machine code. It is the **narrow waist** of the system.

### 4. What makes a good IR: the "narrow waist" principle

A good IR is a careful balance:

- **Low enough** that the back end can generate efficient machine code without re-deriving the program's structure.
- **High enough** that it's still target-independent — no x86-specific registers, no ARM-specific addressing modes leaking in.
- **Uniform and small** — few instruction kinds, explicit and regular, so optimization passes are simple to write.
- **Typed and verifiable** — LLVM IR carries types (`i32`, `i8*`) and can be *verified* for internal consistency, catching front-end bugs.

The "narrow waist" metaphor (borrowed from the way IP is the narrow waist of the internet protocol stack) captures it: a *single, stable, narrow* interface that everything above and below agrees on. Many things plug in above (languages); many things plug in below (targets); the waist itself stays small and stable. The narrower and more stable the waist, the more reuse you get.

### 5. The three real architectures, mapped to the abstract pipeline

The abstract pipeline is the same everywhere, but the famous systems instantiate it differently:

**LLVM (Clang, Rust, Swift, Julia, …).**
```text
source ─[Clang/rustc/swiftc front end]→ LLVM IR ─[opt passes]→ LLVM IR ─[target backend]→ asm
        └─────── front end ──────────┘ └──────── middle end ────────┘ └──── back end ────┘
```
One IR, deliberately the product. Any front end that emits valid LLVM IR gets every back end. This is why three different languages, written by three different teams, share the same optimizer and code generators.

**GCC.** GCC predates LLVM's "single IR" philosophy and uses *three* IRs at descending levels:
```text
source ─[front end]→ GENERIC ─→ GIMPLE ─[tree opts]→ RTL ─[RTL opts + codegen]→ asm
        front end    (lang-       (SSA-      middle      (register-     back end
                      neutral      able 3-     end         transfer)
                      tree)        address)
```
- **GENERIC** — a language-neutral tree all GCC front ends produce.
- **GIMPLE** — a simplified, three-address form (max one operation per statement) where most middle-end optimization happens.
- **RTL (Register Transfer Language)** — a low-level form close to the machine, where the back end does its work.

GCC reaches the same goal (language- and target-independent middle) by a staircase of IRs rather than one.

**The JVM (javac + HotSpot).** Here the architecture is *split across two programs and two times*:
```text
.java ─[javac, AOT]→ JVM bytecode (.class) ─[ship it] ─[HotSpot at runtime]→ interpret → JIT → machine code
       front+IR-gen   the IR you distribute              back end happens AT RUNTIME, on hot code
```
`javac` is a small AOT compiler that targets **bytecode** — a portable IR. The real back end (the optimizing compiler) lives inside the JVM and runs **just in time**, only on code that proves hot. The "compiler" here is two compilers in two architectural positions.

**V8 (JavaScript).** Similar split, JS-flavored:
```text
JS source ─[parser]→ AST ─[Ignition]→ bytecode ─[interpret]→ ...hot?... ─[TurboFan]→ optimized machine code
```
Ignition is a bytecode interpreter; TurboFan is the optimizing JIT that kicks in for hot functions. Same shape: front end → bytecode IR → interpret → JIT the hot paths.

**rustc.** Lowers through *its own* IRs before handing off to LLVM:
```text
Rust ─[parse]→ AST ─→ HIR ─→ MIR ─[borrow-check, MIR opts]→ LLVM IR ─[LLVM]→ asm
                    (desugared) (borrow-check IR)            └── reuses LLVM's middle+back end ──┘
```
rustc does Rust-specific analysis (borrow checking) on its own **MIR**, then lowers to LLVM IR to reuse LLVM's optimizer and back ends. It is a front end (plus extra middle-end analysis) bolted onto LLVM.

The lesson: **one abstract pipeline, many concrete embodiments.** Where you place the back end (AOT vs JIT), how many IRs you use, and whether you reuse someone else's middle/back end are all engineering choices.

### 6. AOT vs JIT as an architectural decision

The pipeline's *stages* are fixed; *when and where* you run the back end is the architecture:

- **AOT (Ahead-Of-Time):** run the whole pipeline before the program ships. The user runs pure machine code. Pros: fast startup, no runtime compile cost, smaller runtime. Cons: can't use runtime information (actual types, hot paths), must commit to one target. (gcc, clang, rustc, go build.)
- **JIT (Just-In-Time):** ship an IR (bytecode), run an interpreter, and compile hot code to machine code *at runtime*, using profiling data. Pros: can specialize to actual runtime behavior, portable artifact (bytecode runs anywhere the VM does). Cons: warm-up cost, runtime memory and CPU overhead, harder to reason about. (JVM, V8, .NET CLR.)
- **Hybrid / tiered:** modern VMs run several tiers — interpreter → quick baseline JIT → aggressive optimizing JIT — promoting code up the tiers as it gets hotter. (HotSpot's C1/C2, V8's Ignition/Sparkplug/Maglev/TurboFan.)

This is one of the most consequential architecture decisions a language makes, and it's invisible in the source code.

### 7. The toolchain and the driver, more precisely

The **driver** (`gcc`, `clang`, `cc`) is itself just an orchestrator. For one `.c` file it typically runs:

1. **Preprocessor** (`cpp`, or built into `cc1`) — text substitution: `#include`, `#define`, conditional compilation. Output is still C source.
2. **Compiler proper** (`cc1` for C, `cc1plus` for C++) — the front/middle/back-end pipeline. Output is assembly text.
3. **Assembler** (`as`) — assembly text → object file (`.o`), a binary container of machine code plus relocation info.
4. **Linker** (`ld`, invoked via `collect2`) — combines object files and libraries, resolves cross-references, lays out the final executable.

The crucial mental separation: the "compiler" is step 2. Steps 1, 3, 4 are *other tools*. "Compiler error," "assembler error," and "linker error" are three different things, and conflating them sends you debugging in the wrong place. Separate compilation works because each translation unit becomes an independent `.o`, and the linker stitches them at the end — which is why editing one file recompiles only that file.

### 8. Error reporting and recovery as a cross-cutting concern

Notice that *every* phase can produce errors, and good diagnostics are not an afterthought — they are a product feature. The lexer reports illegal characters; the parser reports syntax errors; semantic analysis reports type and name errors; the linker reports unresolved symbols. Two design pressures cut across all phases:

- **Error recovery:** a good front end doesn't stop at the first syntax error — it recovers and keeps parsing to report *several* errors per run, so you fix many at once. This requires the parser to guess where the next valid construct starts.
- **Source location tracking:** to point at the right line and column, *every* token, AST node, and IR instruction must carry a source location. This metadata threads through the entire pipeline. The reason Rust and Clang have famously good errors is that they invested heavily in carrying precise spans and in clear recovery — it is engineering, not luck.

---

## Real-World Analogies

| Concept | Real-world analogy |
|---------|--------------------|
| **Phases establishing invariants** | An assembly line where each station can only do its job if the previous one finished correctly — you can't paint a car before the body is welded. |
| **IR as the narrow waist** | The standard shipping container: any cargo (language) packs into it, any ship/truck/train (target) carries it. The container interface is narrow and universal. |
| **GCC's three IRs** | Translating a contract through three drafts: plain-language summary → structured outline → legal boilerplate, each closer to the final form. |
| **LLVM's single IR** | One universal interchange format that every tool reads and writes — like everyone agreeing on PDF. |
| **JVM bytecode** | A recipe written in metric units (portable); each kitchen (JVM) converts to its own equipment at cook time. |
| **AOT vs JIT** | AOT: prefab house built in a factory, shipped complete. JIT: house assembled on-site, adapting to the actual lot. |
| **Tiered JIT** | A new hire who starts on simple tasks (interpreter), and as they prove themselves on a task they get specialized tooling for it (optimizing JIT). |
| **Driver orchestrating tools** | A film director coordinating the camera, sound, and lighting crews — the director doesn't operate the camera, just sequences everyone. |
| **Error recovery** | A proofreader who, after finding one typo, keeps reading the whole page instead of stopping, so you get all the corrections at once. |

---

## Mental Models

### "Each phase narrows the space of legal programs"

Think of the set of all possible inputs. The lexer rejects character-level garbage. The parser rejects everything not matching the grammar. Semantic analysis rejects everything grammatical-but-meaningless. By the time you reach IR generation, the program is *guaranteed valid* — IR generation never has to ask "is this legal?", only "how do I lower this?". Each phase is a filter that shrinks the input space, so later phases get simpler.

### "The IR is the API between two teams who never talk"

Imagine the front-end team and the back-end team in different buildings, never meeting. The only thing connecting them is the IR specification. As long as the front end emits valid IR and the back end consumes valid IR, both can evolve independently. This is *literally* how LLVM is developed: the Rust team and the Clang team don't coordinate releases — they coordinate on the IR contract. The IR is an API, and a stable API is the most valuable thing in the system.

### "Lowering is a staircase, not a cliff"

The program doesn't jump from source to machine code. It descends a staircase of representations, each a small step lower: source → AST → high IR → low IR → machine code. GCC makes this literal (GENERIC → GIMPLE → RTL). Each step does *one kind* of simplification, which is easier to get right than one giant leap. When you design a compiler, you decide how many steps the staircase has.

---

## Code Examples

These show the *same program* through different real compilers' representations, so you can see the abstract pipeline in concrete output.

### One C function through Clang's IR pipeline

```c
// sq.c
int square(int n) {
    return n * n;
}
```

```bash
# Unoptimized LLVM IR — close to a literal lowering of the AST:
clang -O0 -S -emit-llvm sq.c -o -
```
```llvm
define i32 @square(i32 %n) {
entry:
  %n.addr = alloca i32
  store i32 %n, i32* %n.addr
  %0 = load i32, i32* %n.addr
  %1 = load i32, i32* %n.addr
  %mul = mul i32 %0, %1
  ret i32 %mul
}
```
```bash
# Optimized — the middle end removed the redundant memory traffic:
clang -O2 -S -emit-llvm sq.c -o -
```
```llvm
define i32 @square(i32 %n) {
entry:
  %mul = mul i32 %n, %n
  ret i32 %mul
}
```

Same program, same IR *language*, but the optimizer (middle end) collapsed the `alloca`/`store`/`load` shuffle into a single `mul`. This is the middle end doing its job on a target-neutral form, before any CPU is chosen.

### The same program through GCC's GIMPLE

```bash
# Dump GCC's GIMPLE — its three-address middle-end IR:
gcc -O1 -fdump-tree-gimple -S sq.c
cat sq.c.*.gimple
```
```text
square (int n)
{
  int D.1234;
  D.1234 = n * n;
  return D.1234;
}
```

GIMPLE is GCC's analogue of LLVM IR: three-address, simplified, language-neutral. Note the temporary `D.1234` — GIMPLE enforces "at most one operation per statement," exactly the uniformity that makes optimization passes simple.

### The same logic as JVM bytecode

```java
// Square.java
class Square {
    static int square(int n) { return n * n; }
}
```
```bash
javac Square.java
javap -c Square          # disassemble the bytecode
```
```text
static int square(int);
  Code:
     0: iload_0          // push n
     1: iload_0          // push n
     2: imul             // multiply
     3: ireturn          // return
```

This bytecode is the **IR that javac ships**. The JVM will interpret it, and if `square` runs hot, HotSpot's JIT will compile it to machine code at runtime — the back end deferred to runtime.

### Watching the driver run the toolchain

```bash
clang -v -c sq.c -o sq.o 2>&1 | head
```
You'll see the driver invoke the internal front-end/codegen step and then the integrated assembler, with the exact flags. `-###` shows the commands *without* running them:
```bash
clang -### -c sq.c
```

### Cross-compilation: same front/middle end, different back end

```bash
# Same source, two targets — only the back end differs:
clang --target=x86_64-linux-gnu  -S sq.c -o sq.x86.s
clang --target=aarch64-linux-gnu -S sq.c -o sq.arm.s
diff sq.x86.s sq.arm.s     # totally different instructions, same logic
```

The front end and middle end produced identical IR; only the **back end** (selected by `--target`) changed. This is cross-compilation in one command, and it's possible *only* because the target is an isolated, swappable stage.

---

## Pros & Cons

Comparing the **multi-IR, cleanly-phased architecture** against simpler alternatives (single-pass, or AST-as-boundary).

| Aspect | Pros | Cons |
|--------|------|------|
| **Reuse (M + N)** | One IR lets many front ends share many back ends. Adding a language is a front end; adding a CPU is a back end. | Designing an IR that genuinely serves all languages and targets is a multi-year effort. |
| **Optimization power** | A neutral IR with a CFG is the ideal substrate for dataflow optimization; passes are reusable. | Multiple lowering steps add compile time; each conversion costs memory and code. |
| **Modularity / testing** | Each phase has a typed input/output and can be unit-tested and fuzzed independently. | Many interfaces to keep stable; a change to the IR ripples to every front and back end. |
| **Portability** | Cross-compilation is "swap the back end." Bytecode IR (JVM) is portable by construction. | Target assumptions (pointer width, endianness) can leak into a supposedly neutral IR. |
| **Diagnostics** | Each phase knows its error category, enabling precise messages and recovery. | Errors found in the back end are far from source; carrying spans through every phase is real overhead. |
| **Compile speed** | — | The cleanly-phased multi-pass design is slower than a fused single-pass one (why Go keeps it lean). |
| **Runtime adaptivity** | JIT placement lets the back end specialize to real runtime behavior. | JIT adds warm-up latency and runtime memory/CPU cost; harder to reason about and profile. |

---

## Use Cases

A mid-level engineer leans on this architecture when:

- **Diagnosing build pipelines.** Knowing exactly which tool (preprocessor / compiler / assembler / linker) failed, and at which phase, turns a cryptic build log into a targeted fix.
- **Reading IR/assembly to verify optimizations.** Dumping `-emit-llvm` or GIMPLE at `-O0` vs `-O2` shows you concretely what the middle end did — essential for performance work and for trusting (or distrusting) the compiler.
- **Choosing AOT vs JIT for a service.** Startup-sensitive serverless functions favor AOT; long-running servers can amortize JIT warm-up and benefit from runtime specialization.
- **Setting up cross-compilation.** Building on a beefy x86 CI machine for ARM devices, WASM, or embedded targets — understanding that only the back end changes makes the toolchain flags make sense.
- **Evaluating a new language's tooling.** "It targets LLVM" instantly tells you it inherits a mature optimizer and many back ends; "it has its own back end" tells you the opposite.
- **Building developer tools.** Linters, formatters, IDE language servers, and codemod tools all reuse front-end machinery (lex → parse → semantic), and understanding the phase boundaries tells you where to hook in.
- **Reasoning about portability.** Why a `.class` file runs on any OS but an ELF binary doesn't — because one is IR for a VM and the other is back-end output for a specific target.

---

## Coding Patterns

### Pattern 1: Stage isolation — never let a phase peek ahead

When building any pipeline tool, keep each phase's output a *self-contained data structure* the next phase consumes, with no back-references:

```text
tokens   = lex(source)         # lexer knows nothing about grammar
ast      = parse(tokens)       # parser knows nothing about types
checked  = analyze(ast)        # semantic analysis adds symbol table
ir       = lower(checked)      # IR-gen knows nothing about the target CPU
asm      = codegen(ir, target) # back end is the ONLY target-aware stage
```

If your back end needs to know something about the source language, your IR boundary is in the wrong place.

### Pattern 2: Carry source spans end-to-end

Every node — token, AST node, IR instruction — should hold a `(file, line, col)` span. This is what lets a back-end error (e.g., "this would overflow") point at the original source line. Add the span *at creation* and propagate it through every lowering.

### Pattern 3: Make the IR verifiable

Give the IR an explicit `verify()` that checks its invariants (types match, every block ends in a terminator, no use-before-def). Run it after every pass in debug builds. LLVM's `-verify` pass exists precisely to catch front-end bugs at the IR boundary instead of as mysterious miscompiles later.

### Pattern 4: Separate compilation by translation unit

Compile each unit to an object file independently, link at the end:

```bash
clang -c parser.c -o parser.o
clang -c lexer.c  -o lexer.o
clang parser.o lexer.o -o tool   # link step resolves cross-references
```

This is the pattern `make`/Bazel exploit: a changed unit recompiles alone, and only the fast link step runs over the rest.

### Pattern 5: Choose the lowering depth deliberately

If you're building a simple language, a *tree-walking interpreter* (no IR, just walk the AST) may be enough. If you need speed, lower to a bytecode IR and interpret that. If you need native speed, lower further or emit LLVM IR and reuse LLVM. Pick the rung of the staircase that matches your performance budget.

---

## Best Practices

- **Pin down the IR contract first.** In any multi-stage tool, the interface between stages (the IR/data structure) is the most important design decision. Get it right and stages become swappable; get it wrong and everything is coupled.
- **Verify the IR after every transformation in debug builds.** Catch the bug at the boundary, not three passes downstream.
- **Keep the back end the *only* target-aware stage.** The moment x86 knowledge leaks into the middle end, you've lost portability.
- **Track source locations religiously.** Good diagnostics are a feature; they require spans threaded through the whole pipeline. Add them early, never strip them.
- **Recover from errors; report many.** A front end that stops at the first error wastes the user's time. Recover and continue parsing.
- **Dump intermediate forms when debugging.** `-emit-llvm`, `-fdump-tree-*`, `javap -c`, `--emit=mir` (rustc) — each lets you inspect the program between phases.
- **Match architecture to constraints.** AOT for startup-critical and offline; JIT for long-running and adaptive; tree-walk for simplicity; LLVM-backed for native performance with low effort.

---

## Edge Cases & Pitfalls

- **The AST is not the parse tree.** The parse tree (CST) mirrors the grammar literally, including every `(` and `;`. The AST throws that noise away. Tools that need exact source (formatters, refactoring) sometimes need the CST, not the AST.
- **Forward references break single-pass designs.** If function A calls B but B is defined later, a single-pass compiler hasn't seen B yet. C solved this with forward declarations; multi-pass compilers solve it with a declaration-collection pass first.
- **A "language-independent" IR can still leak target details.** Pointer size, integer width, struct layout, and endianness are easy to bake in accidentally. LLVM IR carries an explicit *data layout* string to keep this honest.
- **Bytecode is not machine code.** A `.class` or `.pyc` is IR for a VM; it still needs the VM (and its JIT) to run. People conflate "compiled to bytecode" with "compiled to native."
- **Optimization can change observable behavior if your program has undefined behavior.** The optimizer assumes your program is well-defined; UB (signed overflow, out-of-bounds) lets it do surprising things. The bug is in the source, but it *surfaces* in the optimizer.
- **`-O3` is not strictly faster than `-O2`.** Aggressive inlining and unrolling can bloat code and thrash the instruction cache. Measure, don't assume.
- **Linker errors masquerade as compiler errors to beginners.** "Undefined reference" is a *linker* failure; the compiler was happy. Fixing it means linking the right object/library, not editing the source.
- **JIT warm-up skews benchmarks.** Benchmarking a JIT'd language without warming it up measures the interpreter, not the optimized code. Always warm up before timing.

---

## Common Mistakes

1. **Drawing the front/back boundary at the AST.** The AST is too language-specific and too high-level. The IR is the boundary precisely because it's neither.
2. **Assuming one compiler = one IR.** GCC has three (GENERIC/GIMPLE/RTL); rustc has HIR/MIR before LLVM IR. Multiple IRs at descending levels is normal.
3. **Believing JIT and AOT compile *differently*.** They run the *same pipeline*; they differ in *when* and *where* the back end runs. The phases are identical.
4. **Thinking the linker is part of "the compiler."** It's a separate tool the driver invokes. Treating it as part of the compiler hides where build failures come from.
5. **Stripping source locations during lowering.** Then your back-end errors point at nothing, and your diagnostics are useless.
6. **Letting the middle end know the target.** This couples the neutral stage to one CPU and kills cross-compilation.
7. **Optimizing source code the compiler already optimizes.** Read the `-O2` IR first; the middle end probably did it for you.
8. **Treating GENERIC/GIMPLE/RTL or HIR/MIR as trivia.** They're the concrete answer to "how do real compilers lower in steps" — they make the abstract staircase real.

---

## Tricky Points

- **The IR is both a data structure and a *language*.** LLVM IR has an in-memory form, a text form (`.ll`), and a binary form (`.bc`) — all the same thing. Treating it as a first-class, serializable language (not just an internal struct) is what enabled link-time optimization and a whole ecosystem of tools.
- **GCC and LLVM reach the same goal differently.** GCC's staircase of IRs and LLVM's single IR both achieve language- and target-independence. There is no one right number of IRs.
- **rustc is "a front end on LLVM," but does serious middle-end work itself.** Borrow checking happens on MIR, *before* lowering to LLVM IR — because borrow checking is Rust-specific and LLVM knows nothing about lifetimes. The phase boundary is "Rust-specific analysis on MIR, then reuse LLVM."
- **The JVM splits the pipeline across compile time and run time.** `javac` (AOT) does the front end + IR generation; HotSpot (JIT) does the back end at runtime. "The Java compiler" is genuinely two compilers in two architectural positions.
- **Tiered JITs run several back ends at once.** V8 has Ignition (interpreter), Sparkplug/Maglev (fast JITs), and TurboFan (optimizing JIT). A hot function is re-compiled at higher tiers while older versions still run. The architecture is dynamic.
- **The preprocessor is a separate language.** C's `#include`/`#define` is text substitution that runs *before* the compiler sees real C. It has its own bugs and its own error class, distinct from the compiler proper.
- **"Compile to native" can still mean "via LLVM IR."** rustc, Swift, and Clang all produce native code, but route through LLVM IR. "Native" describes the output, not the absence of an IR.

---

## Test Yourself

1. Explain the difference between a *phase* and a *pass*. Give an example of a phase that takes multiple passes.
2. Why is the front/back-end boundary drawn at the IR rather than the AST? Give all three reasons.
3. List GCC's three IRs in order and say what each is for. Do the same for rustc's lowering chain to LLVM.
4. The JVM "splits the pipeline across two programs and two times." Explain what `javac` does, what HotSpot does, and which phases happen when.
5. Name the four invariants established by lexing, parsing, name resolution, and type checking — i.e., what each guarantees its successor.
6. Run `clang -O0 -emit-llvm` and `clang -O2 -emit-llvm` on a small function. Describe what the optimizer changed and why it's still target-neutral.
7. What is the "narrow waist," and what four properties make an IR a good one?
8. Cross-compile one source file for two targets with `--target`. Which stages produced identical output? Which differed?
9. Why does a forward reference (A calls B, B defined later) break a single-pass compiler, and how do multi-pass compilers handle it?
10. Classify the architecture of each: gcc, the JVM, V8, rustc, classic CPython. For each, say where the back end runs (compile time vs runtime) and how many IRs it uses.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────────┐
│              COMPILER ARCHITECTURE — MIDDLE LEVEL                    │
├──────────────────────────────────────────────────────────────────────┤
│ PHASE vs PASS:  phase = responsibility;  pass = one traversal.       │
│   semantic analysis is often MANY passes (collect decls, then check) │
├──────────────────────────────────────────────────────────────────────┤
│ EACH PHASE ESTABLISHES AN INVARIANT for the next:                    │
│   lex→clean tokens · parse→valid tree · resolve→names bound          │
│   typecheck→types ok · IR-gen→uniform form · opt→equivalent+better   │
├──────────────────────────────────────────────────────────────────────┤
│ WHY THE IR (not the AST) IS THE BOUNDARY:                            │
│   AST too language-specific · AST too high-level for opt             │
│   IR = the narrow waist where M+N reuse pays off                     │
│ GOOD IR: low enough · high enough (target-neutral) · uniform · typed │
├──────────────────────────────────────────────────────────────────────┤
│ REAL ARCHITECTURES:                                                  │
│   LLVM  : src → LLVM IR (one IR) → backend           [AOT]           │
│   GCC   : src → GENERIC → GIMPLE → RTL → asm         [AOT]           │
│   JVM   : javac → bytecode  |  HotSpot interpret→JIT [AOT+JIT]       │
│   V8    : parse → Ignition bytecode → TurboFan JIT   [JIT, tiered]   │
│   rustc : AST → HIR → MIR (borrow-ck) → LLVM IR      [AOT, on LLVM]  │
├──────────────────────────────────────────────────────────────────────┤
│ AOT vs JIT = WHERE the back end runs (not WHICH phases run)          │
│   AOT: fast start, no runtime cost, fixed target                     │
│   JIT: warm-up, runtime overhead, specialize to real behavior        │
├──────────────────────────────────────────────────────────────────────┤
│ TOOLCHAIN:  driver → cpp → cc1 → as → ld                            │
│   "compiler" = cc1 only.  linker error ≠ compiler error.            │
├──────────────────────────────────────────────────────────────────────┤
│ CROSS-CUTTING: error recovery + source spans thread ALL phases       │
│   (good diagnostics = a feature, e.g. Rust/Clang)                    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The pipeline's stages are **phases** (responsibilities); concrete traversals are **passes**. One phase may take several passes (declaration collection, then name resolution, then type checking).
- **Each phase establishes an invariant** the next relies on. That is why the order is fixed and not arbitrary — you cannot type-check unresolved names or parse unlexed text.
- The **front/back boundary is the IR, not the AST**, because the AST is too language-specific and too high-level, and because the IR is where M + N reuse pays off. The IR is the **narrow waist**.
- A **good IR** is low enough for efficient codegen, high enough to stay target-neutral, uniform and small for simple passes, and typed/verifiable to catch front-end bugs.
- The same abstract pipeline is embodied differently: **LLVM** (one IR), **GCC** (GENERIC → GIMPLE → RTL), the **JVM** (javac → bytecode, then runtime JIT), **V8** (Ignition → TurboFan), **rustc** (HIR → MIR → LLVM IR).
- **AOT vs JIT** is an architectural choice about *when and where* the back end runs, not about which phases exist. Tiered JITs run several back ends dynamically.
- The **driver** orchestrates the toolchain (`cpp → cc1 → as → ld`); the "compiler" is just `cc1`, and a linker error is not a compiler error.
- **Error recovery and source-location tracking** cut across every phase. Good diagnostics (Rust, Clang) are deliberate engineering, requiring spans threaded through the whole pipeline.

---

## What You Can Build

- **A multi-IR mini-compiler.** Build a tiny language that lowers source → AST → a simple three-address IR → a stack-bytecode IR, with a `verify()` at each boundary. Feel why the boundaries help.
- **A side-by-side IR comparer.** Dump LLVM IR (`clang`/`rustc --emit=llvm-ir`), GIMPLE (`gcc -fdump-tree-gimple`), and JVM bytecode (`javap -c`) for the same algorithm. Annotate how each embodies the same abstract IR idea.
- **A cross-compilation demo.** Compile one source for x86, ARM, and WASM with `--target`, and show that only the back-end output differs while the IR is identical.
- **An AOT-vs-JIT warm-up study.** Benchmark the same loop in Go (AOT) and Java (JIT), plotting per-iteration time over the first thousand runs to make JIT warm-up visible.
- **A source-span tracer.** Add spans to a toy AST and IR, deliberately introduce a "would overflow" check in the back end, and have it point at the exact original source line — proving why spans must thread through every phase.
- **A toolchain visualizer.** Wrap `clang -###` output into a diagram of the actual tools invoked, their flags, and their inputs/outputs.

---

## Further Reading

- *Engineering a Compiler* — Cooper & Torczon. The clearest treatment of phases, IRs, and the front/middle/back split.
- *Crafting Interpreters* — Robert Nystrom. Builds both a tree-walking interpreter and a bytecode VM; the best hands-on view of lowering depth. https://craftinginterpreters.com/
- Chris Lattner, "LLVM" in *The Architecture of Open Source Applications* — the front/middle/back-end thesis and the case for one IR. https://aosabook.org/en/llvm.html
- *GCC Internals* manual — GENERIC, GIMPLE, RTL. https://gcc.gnu.org/onlinedocs/gccint/
- *The Java Virtual Machine Specification* — what bytecode is and why it's the shipped IR.
- V8 blog, "Ignition" and "TurboFan" posts. https://v8.dev/blog
- The Rust compiler dev guide — HIR, MIR, and the lowering to LLVM. https://rustc-dev-guide.rust-lang.org/
- *Compilers: Principles, Techniques, and Tools* (Dragon Book), Chapters 1–2, for the canonical phase decomposition.

---

## Related Topics

- This folder, other levels: [`junior.md`](junior.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- The rest of this section is each phase in depth: the lexer (text → tokens), the parser (tokens → AST), semantic analysis (name resolution, type checking, symbol tables), IR design and generation, the optimization passes of the middle end, code generation in the back end, and the interpreter and runtime topics that cover executing the result. This page is the architectural map those topics fit into; read it first, then descend into any box.

---

## Diagrams & Visual Aids

### Phases, their data structures, and their invariants

```text
  SOURCE TEXT
     │  LEXER ───────────────► invariant: clean token stream, no garbage chars
     ▼
  TOKENS
     │  PARSER ──────────────► invariant: grammatically valid → well-formed tree
     ▼
  AST
     │  NAME RESOLUTION ─────► invariant: every name bound to a declaration
     │  TYPE CHECKING ───────► invariant: every operation type-correct
     ▼
  CHECKED AST + SYMBOL TABLE
     │  IR GENERATION ───────► invariant: uniform, desugared, target-neutral form
     ▼
  IR  ◄──────────────────────  THE NARROW WAIST
     │  OPTIMIZATION (many passes) ► invariant: equivalent meaning, improved
     ▼
  OPTIMIZED IR
     │  CODE GENERATION ─────► invariant: valid machine code for THIS target
     ▼
  MACHINE CODE
```

### Three real systems on one diagram

```text
  LLVM      src ─► [front end] ─► LLVM IR ─► [opt] ─► LLVM IR ─► [backend] ─► asm
                                  └── one IR, the documented product ──┘

  GCC       src ─► [front end] ─► GENERIC ─► GIMPLE ─► [tree opt] ─► RTL ─► asm
                                  └──── staircase of three IRs ────┘

  JVM       .java ─► [javac AOT] ─► bytecode ──ship──► [HotSpot] interp ─► JIT ─► native
                     compile time                      run time  └─ backend deferred ─┘

  rustc     Rust ─► AST ─► HIR ─► MIR ─[borrow-ck]─► LLVM IR ─► [LLVM backend] ─► asm
                          └─ rust-specific ─┘        └──── reuses LLVM ────┘
```

### AOT vs JIT placement of the back end

```text
  AOT:   ┌── compile time ───────────────┐   ┌─ run time ─┐
         │ front → middle → BACK END → exe│   │  run exe   │
         └────────────────────────────────┘   └────────────┘

  JIT:   ┌─ compile time ─┐   ┌──────────── run time ─────────────┐
         │ front → bytecode│   │ interpret → spot hot → BACK END   │
         └─────────────────┘   │            → run native          │
                               └────────────────────────────────────┘
                                back end runs WHILE the program runs
```

### The driver and the toolchain

```text
   clang foo.c -o foo
        │  (driver: orchestrates, translates nothing itself)
        ├──► preprocess  (cpp / built-in)     foo.c  → foo.i
        ├──► compile     (front+middle+back)  foo.i  → foo.s
        ├──► assemble    (as)                 foo.s  → foo.o
        └──► link        (ld via collect2)    foo.o + libs → foo

   "compiler error"  ← compile step
   "linker error"    ← link step      ← DIFFERENT TOOL, DIFFERENT FIX
```
