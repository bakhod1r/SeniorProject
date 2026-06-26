# The Big Picture (Compiler Architecture) — Junior Level

> **Topic:** [The Big Picture (Compiler Architecture)](README.md)
> **Focus:** What actually happens between you typing `gcc hello.c` and an executable existing? The end-to-end pipeline, named.

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

> Focus: **What does a compiler actually do, step by step?** And **why is it built as a pipeline rather than one giant function?**

A **compiler** is a program that reads source code in one language and produces equivalent code in another — usually machine code your CPU can run. You have used one a hundred times: `gcc`, `clang`, `javac`, `rustc`, `tsc`, `go build`. It feels like a black box: text goes in, an executable comes out. This page opens the box.

The single most important idea is this: **a compiler is not one step. It is a pipeline of stages, each transforming the program into a slightly lower-level form.** Source text becomes a stream of words (tokens), the words become a tree (an AST), the tree gets checked for meaning (types, names), the tree becomes a simpler internal language (IR), the IR gets cleaned up and sped up (optimization), and finally the IR becomes machine instructions (code generation). An assembler and a linker turn those instructions into a runnable file.

Each stage does one job and hands its output to the next. This is the same engineering instinct you already know from Unix pipes (`cat | grep | sort`) or from breaking a big function into small ones: small, testable stages beat one tangled monster.

> 🎓 **Why this matters for a junior:** Once you can name the stages, compiler error messages stop being scary. "Syntax error" means the *parser* choked. "Undefined symbol" means the *linker* couldn't find something. "Type mismatch" means *semantic analysis* rejected your program. Knowing *which stage* complained tells you *what kind* of mistake you made — and that cuts your debugging time in half.

This page covers: the names and order of the pipeline stages, what each stage's input and output look like, the big split into **front end / middle end / back end**, and the difference between a "compiler" and the whole "toolchain." It is the map for the rest of this section — every other topic (lexing, parsing, the AST, semantic analysis, IR, optimization, code generation, interpreters) is a zoom-in on one box of this map.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to compile and run a simple program in at least one language — you have typed `gcc file.c` or `javac File.java` or `go run main.go` at least once.
- **Required:** What "source code" and "machine code / executable" are, roughly — that the CPU runs ones and zeros, not your text file.
- **Required:** Comfort with the idea of a tree (a root with children), because the AST is a tree.
- **Helpful but not required:** Some idea of what a function call or a variable is — used in examples.
- **Helpful but not required:** Having seen a compiler error message and wondered what produced it.

You do **not** need to know:

- How to *write* a lexer or parser (those are later topics).
- Assembly language (we will show a little, but you don't need to read it fluently).
- Anything about register allocation, SSA form, or optimization passes (middle/senior material).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Compiler** | A program that translates source code into another (usually lower-level) language, ahead of running it. |
| **Interpreter** | A program that executes source code directly, without producing a separate executable first. |
| **Source code** | The text you write (`.c`, `.java`, `.go`, `.rs`). The input to a compiler. |
| **Token** | A single meaningful "word" of the source: a keyword, identifier, number, operator, or punctuation. |
| **Lexer (scanner / tokenizer)** | The stage that turns the raw character stream into a stream of tokens. |
| **Parser** | The stage that turns the token stream into a tree structure following the language's grammar. |
| **AST (Abstract Syntax Tree)** | The tree representing the program's structure: an `if` node with a condition child and a body child, etc. |
| **Semantic analysis** | The stage that checks *meaning*: are names declared? do types match? It also builds the symbol table. |
| **Symbol table** | A lookup table mapping names (variables, functions, types) to information about them (type, scope, location). |
| **IR (Intermediate Representation)** | A simplified internal language the compiler uses between the front end and the back end. Not source, not machine code. |
| **Optimization** | Transforming the IR into a faster or smaller equivalent program (constant folding, dead-code removal, inlining). |
| **Code generation (codegen)** | The stage that turns IR into actual machine instructions (or assembly) for a specific CPU. |
| **Assembler** | A tool that turns assembly text into binary object code. |
| **Linker** | A tool that stitches multiple object files (and libraries) into one executable, resolving references between them. |
| **Front end** | The language-specific part: lexer + parser + semantic analysis. Depends on the *source language*. |
| **Middle end** | The IR + optimization part. Independent of both the source language and the target CPU. |
| **Back end** | The target-specific part: code generation for a particular CPU/OS. Depends on the *target*. |
| **Toolchain** | The whole set of tools — preprocessor, compiler, assembler, linker — orchestrated to go from source to executable. |
| **Driver** | The single command (`gcc`, `clang`) that you invoke; it runs the other tools in order behind the scenes. |
| **Pass** | One traversal of the program by the compiler. A "multi-pass" compiler makes several. |

---

## Core Concepts

### 1. A compiler is a pipeline

Picture an assembly line. The program enters as raw text and exits as machine code, getting transformed at each station. The classic stations, in order:

```text
source text
   │  (lexer)
   ▼
tokens
   │  (parser)
   ▼
AST (parse tree)
   │  (semantic analysis: name resolution + type checking)
   ▼
checked AST + symbol table
   │  (IR generation)
   ▼
intermediate representation (IR)
   │  (optimization)
   ▼
optimized IR
   │  (code generation)
   ▼
assembly / machine code
   │  (assembler)
   ▼
object file(s)
   │  (linker)
   ▼
executable
```

Each arrow is a transformation. Each box is a *representation* of your program at a different level of detail. The program never changes meaning — it just changes form, getting lower-level at each step.

### 2. What each stage does, concretely

Take the line `x = a + 2;` and follow it down.

- **Lexer** turns the characters into tokens: `IDENT(x)`, `EQUALS`, `IDENT(a)`, `PLUS`, `NUMBER(2)`, `SEMICOLON`. It throws away spaces and comments. It does *not* understand structure — it just chops the text into words.
- **Parser** assembles those tokens into a tree according to grammar rules: an *assignment* node, whose left side is `x` and whose right side is an *addition* of `a` and `2`. Now we have structure.
- **Semantic analysis** checks meaning: Is `x` declared? Is `a` declared? Is `a` a number, so that `a + 2` makes sense? It records `x` and `a` in the **symbol table** with their types. If `a` were a string, this stage would reject the program.
- **IR generation** lowers the tree into simple, uniform instructions, something like: `t1 = a + 2; x = t1`. The IR looks the same whether the source was C, Rust, or Swift.
- **Optimization** improves the IR. If `a` were known to be `5`, it might fold `5 + 2` into `7`. If `x` were never used, it might delete the whole line.
- **Code generation** turns the IR into real CPU instructions: `mov eax, [a]; add eax, 2; mov [x], eax`.
- **Assembler + linker** turn that into bytes in an executable file.

### 3. The three big stages: front end, middle end, back end

The pipeline is grouped into three parts, and this grouping is the single most important architectural idea in compilers:

| Part | Stages | Depends on | Job |
|------|--------|-----------|-----|
| **Front end** | lexer, parser, semantic analysis | the **source language** | Understand the program. Catch syntax and type errors. Produce IR. |
| **Middle end** | IR optimization | **neither** language nor target | Improve the program. Make it faster/smaller. |
| **Back end** | code generation | the **target CPU/OS** | Emit machine code for a specific machine. |

The front end speaks your language. The back end speaks your CPU. The middle end speaks neither — it works only on the IR, which is the neutral meeting point.

### 4. Why this split saves enormous work: the M × N problem

Suppose you support **M** source languages (C, C++, Rust, Swift…) and **N** target CPUs (x86, ARM, RISC-V, WebAssembly…). If every language compiled directly to every CPU, you would need to write **M × N** separate compilers. Five languages and five CPUs would be twenty-five from-scratch back ends.

Instead, you funnel every language down to **one shared IR**, and translate that one IR to every CPU. Now you write **M** front ends (one per language) and **N** back ends (one per CPU), and they all meet at the IR. That is **M + N** pieces of work, not M × N. Add a new language, you write one front end and get every CPU for free. Add a new CPU, you write one back end and every language gets it for free.

This is the entire thesis of **LLVM**, and the reason Clang (C/C++), Rust, and Swift can all share the same back ends — they all emit **LLVM IR**, and LLVM takes it from there. We come back to this.

### 5. Compiler vs interpreter (and JIT, and transpiler)

These are different *architectures* for running code, and the line is blurrier than it looks:

- A **compiler** translates the whole program ahead of time into machine code, then you run that. (`gcc`, `go build`, `rustc`.)
- An **interpreter** reads your program and executes it directly, statement by statement, with no separate executable. (Classic Python, older Ruby, a calculator REPL.)
- A **JIT (Just-In-Time) compiler** is a hybrid: it starts by interpreting, watches which code runs a lot ("hot"), and compiles *that* to machine code while the program runs. (The JVM, V8 for JavaScript, .NET.)
- A **transpiler** is a compiler whose *target* is another high-level language, not machine code. (TypeScript → JavaScript, Babel, the C++-to-C compilers of the 1980s.)

All four share the same front end ideas (lex, parse, check). They differ in what they do with the result. We treat these in their own topics; here the point is that they are *variations on the same pipeline*.

### 6. Single-pass vs multi-pass

A **pass** is one walk over the program. Early compilers (and some modern ones, like Go's gc and many Pascal compilers) are designed to be fast and do as few passes as possible. A **single-pass** compiler reads the source once and emits code as it goes. This is fast but limiting — you can't optimize something you've already emitted, and you must declare things before you use them (which is why old C required forward declarations).

A **multi-pass** compiler walks the program several times: once to parse, once to resolve names, once or many times to optimize, once to generate code. Multi-pass is slower but far more powerful — each optimization pass can assume the previous one already ran. Almost every serious optimizing compiler today is multi-pass.

### 7. The compiler vs the toolchain (the driver)

When you type `gcc hello.c -o hello`, you think you ran "the compiler." You actually ran a **driver**. `gcc` is a conductor that runs, in order:

1. The **preprocessor** (`cpp`) — handles `#include`, `#define`.
2. The actual **compiler** (`cc1`) — source → assembly.
3. The **assembler** (`as`) — assembly → object file.
4. The **linker** (`ld`) — object files + libraries → executable.

The "compiler" is really just step 2. The **toolchain** is all four working together, and the **driver** is the program that orchestrates them. This distinction matters: a "linker error" is *not* a compiler error — a different tool, at a different stage, failed.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **The pipeline** | A factory assembly line: raw material in one end, finished product out the other, transformed at each station. |
| **Lexer** | Splitting a sentence into individual words, ignoring the spaces. |
| **Parser** | Diagramming the sentence: subject, verb, object — building the grammatical tree. |
| **Semantic analysis** | A proofreader checking that the sentence makes *sense*, not just that it's grammatical ("colorless green ideas" parses but means nothing). |
| **IR** | Translating any human language into a neutral "interlingua" before translating into the target language. |
| **Front / middle / back end** | A translation agency: one expert per source language, one neutral middle stage, one expert per target language. |
| **M × N problem** | Instead of teaching every translator every language pair, everyone learns one shared pivot language. |
| **Optimization** | An editor tightening prose: removing redundant sentences, simplifying phrasing, without changing the meaning. |
| **Code generation** | A printer turning the finished manuscript into a physical book for a specific paper size. |
| **Linker** | A bookbinder assembling separately printed chapters into one bound book, fixing up the cross-references. |
| **Driver** | The general contractor who hires the plumber, electrician, and painter and makes sure they work in order. |
| **Interpreter** | A live human interpreter translating speech sentence-by-sentence, in real time, with nothing written down. |
| **JIT** | A live interpreter who, noticing you keep saying the same phrase, writes down a fast canned translation for it. |

---

## Mental Models

### The Assembly-Line Model

Hold this picture above all others: an **assembly line** where the program rides down the belt and each station lowers it one level. Source → tokens → tree → checked tree → IR → machine code. You never skip a station, and each station only needs to understand its own input and output, not the whole journey. When you hit a compiler error, ask: *which station rejected the part?* That tells you what's wrong.

### The "Funnel and Fan-Out" Model (for the M × N split)

Many source languages **funnel down** into one IR; that one IR **fans out** to many target CPUs. The IR is the narrow neck of an hourglass — the "narrow waist." Everything above the waist is language-specific; everything below is target-specific; the waist itself is neutral. Adding a language widens the top; adding a CPU widens the bottom; neither touches the other.

### The "Lowering" Model

Every stage **lowers** the program: it expresses the same meaning in a more detailed, more machine-like, less human-like form. Source is the most human form; machine code is the most machine form. "Lowering" is the verb compiler engineers use, and once you internalize it, the whole pipeline is just "lower, lower, lower, until it's machine code." Optimization is the one stage that stays at the same level — it rewrites IR into better IR.

---

## Code Examples

You can *watch* the pipeline happen with command-line flags. None of this requires writing a compiler — just running one and asking it to stop early or dump an intermediate form. Try these yourself.

### See the preprocessor output (the very first step)

```bash
# hello.c with an #include and a #define, after the preprocessor runs:
gcc -E hello.c | tail -20
```

`-E` says "stop after preprocessing." You'll see your file with every `#include` expanded inline and every macro substituted. This is the *input* to the actual compiler stage.

### See the generated assembly (front + middle + back end, stopping before the assembler)

```bash
# Compile to assembly text instead of an object file:
gcc -S hello.c -o hello.s     # GCC
clang -S hello.c -o hello.s   # Clang

cat hello.s
```

`-S` says "stop after code generation, before assembling." `hello.s` is human-readable assembly — the output of the **back end**. This is the moment your program first becomes CPU-specific.

### See the LLVM IR (the famous "narrow waist")

```bash
# Clang can dump LLVM IR — the language-neutral middle representation:
clang -S -emit-llvm hello.c -o hello.ll

cat hello.ll
```

For this tiny C program:

```c
int add(int a, int b) {
    return a + b;
}
```

`clang -S -emit-llvm` produces LLVM IR roughly like:

```llvm
define i32 @add(i32 %a, i32 %b) {
entry:
  %sum = add i32 %a, %b
  ret i32 %sum
}
```

This `.ll` file is the **IR** — the meeting point. Rust and Swift produce IR in this same language. That is why they can share LLVM's back ends.

### Stop the driver at each stage

```bash
gcc -E hello.c -o hello.i     # preprocess only  → hello.i
gcc -S hello.i -o hello.s     # compile only     → hello.s (assembly)
gcc -c hello.s -o hello.o     # assemble only    → hello.o (object file)
gcc    hello.o -o hello       # link only        → hello   (executable)
```

These four commands do, separately, exactly what `gcc hello.c -o hello` does in one shot. Running them by hand is the clearest possible demonstration that `gcc` is a **driver** orchestrating four tools.

### See which tools the driver actually runs

```bash
gcc -v hello.c -o hello
```

`-v` (verbose) prints the real commands `gcc` issues: you'll see `cc1`, `as`, and `collect2`/`ld` invoked one after another. This is the toolchain, exposed.

### Watch a JIT vs an interpreter (no compiler internals needed)

```bash
# Python: an interpreter. No separate executable produced.
python3 hello.py        # runs directly

# Java: compile to bytecode (javac), then a JIT runs it (java).
javac Hello.java        # produces Hello.class — bytecode, not machine code
java Hello              # the JVM interprets, then JIT-compiles hot code
```

`javac` is an **ahead-of-time** compiler that targets **bytecode** (a portable IR), not your CPU. The `java` command runs a virtual machine that interprets the bytecode and **JIT-compiles** the hot parts to machine code at runtime. Two different architectures, side by side.

---

## Pros & Cons

This compares the *pipeline architecture itself* — building a compiler as separate stages with a shared IR — against the imaginary alternative of one giant translate-everything-at-once function.

| Aspect | Pros | Cons |
|--------|------|------|
| **Reuse** | One IR lets M languages share N back ends (M + N work, not M × N). LLVM's whole reason to exist. | The IR must be carefully designed to serve every language and every target — a hard, slow design problem. |
| **Testability** | Each stage has clear input/output and can be tested in isolation. | More moving parts; more interfaces to define and keep stable. |
| **Maintainability** | A bug is localizable to one stage. Add a language by adding a front end only. | Indirection: data passes through several representations, each needing memory and conversion code. |
| **Optimization** | Optimizing the IR once benefits all languages and all targets. | Multi-pass design is slower to compile than single-pass. |
| **Portability** | A new CPU needs only a new back end. | The IR can leak target assumptions if you're not careful (pointer size, endianness). |
| **Error reporting** | Each stage knows what kind of error it found, giving precise messages. | Errors found late (in the back end) are far from the source the user wrote; mapping back is extra work. |
| **Compile speed** | — | The funnel adds overhead vs a hypothetical direct path; this is why fast compilers (Go) keep passes minimal. |

---

## Use Cases

Understanding the pipeline architecture matters whenever you:

- **Read compiler errors** and want to know *which stage* failed (syntax = parser, type = semantic analysis, undefined symbol = linker).
- **Choose a language or runtime** and need to reason about AOT vs JIT vs interpreted trade-offs (startup time, peak speed, portability).
- **Use compiler flags** like `-S`, `-emit-llvm`, `-O2`, `-c` and want to know what each one stops at or turns on.
- **Cross-compile** — build on your laptop (the *host*) for a Raspberry Pi or microcontroller (the *target*). This is only possible because the back end is a swappable stage.
- **Debug a slow build** — knowing it's the linker, not the compiler, that's slow changes how you fix it.
- **Write any kind of "language" tool** — a linter, a formatter, a config-file parser, a template engine. They all reuse front-end ideas (lex, parse, build a tree).
- **Pick a tooling ecosystem** — knowing that Clang, Rust, and Swift share LLVM explains why they share so many flags and behaviors.

It is *not* something you need to master to write everyday application code — but the moment a build breaks in a confusing way, this map is what tells you where to look.

---

## Coding Patterns

These are patterns for *interacting with* compilers as a junior, not for building one.

### Pattern 1: Bisect the pipeline to locate an error

When a build fails confusingly, stop the driver at each stage to find where it breaks:

```bash
gcc -E file.c > /dev/null   # did preprocessing succeed?
gcc -S file.c               # did the compiler (front+middle+back) succeed?
gcc -c file.c               # did assembly succeed?
gcc    file.o               # did linking succeed?
```

The first command that fails tells you the failing stage.

### Pattern 2: Read the IR/assembly to understand "what did the compiler do?"

```bash
clang -O2 -S -emit-llvm file.c -o -   # IR after optimization, to stdout
gcc   -O2 -S            file.c -o -    # assembly after optimization
```

This is how you answer "did my optimization actually get applied?" — you look at the lowered form, not the source.

### Pattern 3: Separate compile, then link (translation units)

```bash
gcc -c a.c -o a.o    # compile each file independently
gcc -c b.c -o b.o
gcc a.o b.o -o app   # link them together at the end
```

Each `.c` file is a **translation unit**, compiled in isolation. The **linker** resolves references between them at the end. This is why changing one file only recompiles that file (the basis of `make`).

### Pattern 4: Pick the AOT-vs-interpreted tool deliberately

- Long-running server where peak speed matters → AOT (Go, Rust, C++) or JIT (JVM).
- Quick script, glue code, fast iteration → interpreted (Python).
- "Compile once, run anywhere" → bytecode + VM (Java, C#).

---

## Best Practices

- **Name the failing stage before you debug.** "Linker error" and "parser error" call for completely different fixes. The error *category* is half the diagnosis.
- **Use `-S` and `-emit-llvm` to learn.** When you wonder how something compiles, dump the assembly or IR. It is the single best way to build intuition about what the compiler really does.
- **Trust optimization, then verify.** Modern compilers optimize aggressively. Don't hand-optimize source for speed before checking the generated code at `-O2` — the compiler probably already did it.
- **Keep translation units small and independent.** Faster incremental builds, clearer linker errors.
- **Read warnings, not just errors.** Warnings come from semantic analysis catching *suspicious-but-legal* code — they catch real bugs before runtime.
- **Match the architecture to the workload.** Don't reach for a heavy AOT toolchain for a throwaway script, or an interpreter for a hot inner loop.
- **Learn your driver's verbose flag.** `gcc -v` / `clang -v` demystifies the toolchain by showing the real commands.

---

## Edge Cases & Pitfalls

- **"It compiled but won't link."** Compilation (per-file) and linking (combining files) are *different stages*. A missing function body is a *link* error, not a *compile* error. Don't search the compiler stage for a linker problem.
- **"Undefined reference to `foo`."** The compiler trusted that `foo` exists somewhere (you declared it); the linker looked for the actual code and didn't find it. You forgot to link a library or a `.o` file.
- **Confusing the preprocessor with the compiler.** A bad `#include` path fails at preprocessing, *before* the compiler ever sees your real code. The error mentions a header, not your logic.
- **Assuming an interpreter "doesn't compile."** Most modern interpreters (CPython) still *parse* and *compile to bytecode* internally; they just don't write a separate executable. The front-end stages still run.
- **Thinking `javac` produces machine code.** It produces **bytecode** — a portable IR for the JVM. The JVM (with its JIT) produces machine code, later, at runtime.
- **Believing `-O3` is always faster than `-O2`.** More optimization can bloat code, hurt the instruction cache, or expose latent undefined-behavior bugs. "More passes" ≠ "always faster."
- **Forgetting that warnings are real.** Semantic analysis emits warnings for code that is legal but probably wrong (unused variable, implicit conversion). Ignoring them is ignoring free bug reports.
- **Expecting the same binary to run anywhere.** An executable is **target-specific** — built by a back end for one CPU/OS. An x86 Linux binary won't run on an ARM Mac. (Bytecode + a VM is the portable alternative.)

---

## Common Mistakes

1. **Calling every build failure a "compiler error."** Half of them are *linker* errors. Learn to tell them apart from the message.
2. **Not knowing what stage a tool is.** `cpp`, `cc1`, `as`, `ld` are four different tools; `gcc` just runs them in order.
3. **Believing the compiler runs your source as-is.** It transforms your program through several representations; the machine code may look nothing like your source (especially at `-O2`).
4. **Thinking the AST is the source text.** The AST is a *tree* the parser builds; it has thrown away whitespace, comments, and exact formatting.
5. **Assuming "interpreted = no compilation."** Interpreters lex and parse too; many compile to bytecode internally.
6. **Confusing AOT and JIT.** AOT compiles before you run; JIT compiles *while* you run. The JVM and V8 are JIT; `gcc` is AOT.
7. **Ignoring the order of stages.** A type error is caught in semantic analysis, *after* parsing — so if parsing fails, you never even reach the type check. Fix the earlier error first.
8. **Hand-optimizing source the compiler already optimizes.** Check the `-O2` output before twisting your code into knots for speed.

---

## Tricky Points

- **The "compiler" is just one tool in the toolchain.** When you say "the compiler did X," you may actually mean the preprocessor, the assembler, or the linker. Precision here saves debugging time.
- **An interpreter and a compiler share a front end.** Both lex, parse, and often type-check. They diverge only at the back: one emits machine code, the other walks the tree (or bytecode) and *does* the work.
- **The IR is where the magic of reuse lives.** It's easy to skip past "intermediate representation" as jargon. It is the single design choice that makes LLVM, GCC, and the JVM possible. The IR is the product; the front and back ends are adapters.
- **Multi-pass is the norm, but Go is proudly fast and minimal.** Don't assume every compiler is a 30-pass behemoth. Go's compiler prioritizes *compile speed* and keeps its pass count low on purpose. Architecture is a trade-off, not a fixed recipe.
- **Bytecode is an IR you can ship.** Java's `.class` files and Python's `.pyc` files are IR that gets distributed and run later by a VM. "IR" and "the thing you ship" are sometimes the same thing.
- **Cross-compilation is just swapping the back end.** Building for ARM on an x86 laptop sounds exotic; architecturally it's "use the ARM back end instead of the x86 one." The front and middle ends don't change at all.

---

## Test Yourself

1. List the pipeline stages in order, from source text to executable. For each, say what its input is and what its output is.
2. Which stage catches each of these? (a) a missing semicolon, (b) using an undeclared variable, (c) calling a function whose body is never linked in, (d) a typo in an `#include` path.
3. Run `gcc -S hello.c` and `clang -S -emit-llvm hello.c`. What is in each output file, and which stage produced it?
4. Explain the M × N problem in one sentence, and how a shared IR turns it into M + N.
5. What is the difference between the "compiler" and the "toolchain"? Name the four tools a typical C toolchain runs.
6. Is `javac` an ahead-of-time or just-in-time compiler? What does it target? What runs its output?
7. Classify each as compiler, interpreter, JIT, or transpiler: `gcc`, classic CPython, the JVM, TypeScript's `tsc`, `rustc`, V8.
8. Why can an x86 executable not run on an ARM machine, while a `.class` file can run on both?
9. Run `gcc -v hello.c`. List the actual sub-tools the driver invoked.
10. What is a "pass," and what is the trade-off between a single-pass and a multi-pass compiler?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────────┐
│                 THE COMPILER PIPELINE                                │
├──────────────────────────────────────────────────────────────────────┤
│ source text                                                          │
│   → LEXER        → tokens                                            │
│   → PARSER       → AST (tree)                                        │
│   → SEMANTIC     → checked AST + symbol table (names, types)        │
│   → IR GEN       → intermediate representation                       │
│   → OPTIMIZER    → better IR                                         │
│   → CODEGEN      → assembly / machine code                          │
│   → ASSEMBLER    → object file (.o)                                  │
│   → LINKER       → executable                                        │
├──────────────────────────────────────────────────────────────────────┤
│ THREE STAGES (the key split):                                        │
│   FRONT END   lex+parse+semantic   depends on SOURCE LANGUAGE        │
│   MIDDLE END  IR + optimization    depends on NEITHER                │
│   BACK END    code generation      depends on TARGET CPU            │
├──────────────────────────────────────────────────────────────────────┤
│ M×N → M+N : funnel M languages into 1 IR, fan out to N targets       │
│   (this is LLVM's whole thesis)                                      │
├──────────────────────────────────────────────────────────────────────┤
│ ARCHITECTURES:                                                       │
│   Compiler     translate all, ahead of time   (gcc, rustc, go)      │
│   Interpreter  execute directly, no exe       (classic Python)      │
│   JIT          interpret, then compile hot     (JVM, V8, .NET)      │
│   Transpiler   compile to another HLL          (tsc, Babel)         │
├──────────────────────────────────────────────────────────────────────┤
│ COMPILER ≠ TOOLCHAIN                                                  │
│   driver (gcc/clang) runs:  cpp → cc1 → as → ld                     │
├──────────────────────────────────────────────────────────────────────┤
│ FLAGS TO WATCH THE PIPELINE:                                         │
│   gcc -E      stop after preprocess                                 │
│   gcc -S      stop after codegen (emit assembly)                    │
│   clang -S -emit-llvm   dump LLVM IR (the narrow waist)             │
│   gcc -c      stop after assemble (emit .o)                         │
│   gcc -v      show the tools the driver runs                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **compiler** is a **pipeline**, not a single step: source → tokens → AST → checked AST → IR → optimized IR → machine code → object file → executable.
- Each stage **lowers** the program one level, transforming its *form* while preserving its *meaning*.
- The pipeline groups into three parts: the **front end** (language-specific: lex, parse, semantic analysis), the **middle end** (IR + optimization, neutral), and the **back end** (target-specific: code generation).
- This split solves the **M × N problem**: funnel M languages into one shared IR and fan that IR out to N targets — M + N pieces of work instead of M × N. This is LLVM's central idea, and why Clang, Rust, and Swift share back ends.
- **Compiler, interpreter, JIT, and transpiler** are different architectures built on the same front-end ideas; they differ in what they do with the parsed program.
- A **single-pass** compiler is fast but limited; a **multi-pass** compiler walks the program several times and can optimize far more. Go deliberately keeps passes minimal for speed.
- The **compiler** is one tool; the **toolchain** is the preprocessor + compiler + assembler + linker, orchestrated by a **driver** (`gcc`, `clang`).
- You can *watch* every stage with flags: `-E`, `-S`, `-emit-llvm`, `-c`, `-v`.
- A junior's superpower: when a build breaks, **name the failing stage first** — it tells you what kind of mistake you made.

---

## What You Can Build

- **A pipeline visualizer script.** Take one `.c` file and run `gcc -E`, `gcc -S`, `clang -S -emit-llvm`, `gcc -c`, `gcc` in turn, saving each intermediate. Open them side by side and trace one line of source down through every form.
- **A "which stage failed?" diagnostic helper.** A shell script that runs each stage separately and prints "preprocessing/compiling/assembling/linking failed here" — your own pipeline bisector.
- **A toolchain map.** Run `gcc -v` on a real program and draw the actual graph of tools invoked, with their inputs and outputs labeled.
- **An IR explorer.** Write the same tiny function in C, then in Rust, dump the LLVM IR for both (`clang -emit-llvm`, `rustc --emit=llvm-ir`), and compare. See for yourself that they meet at the same representation.
- **An AOT-vs-JIT-vs-interpreted benchmark.** Write a simple loop in C, Java, and Python. Time startup and time the hot loop. Explain the results in terms of architecture.
- **A separate-compilation demo.** Split a program into three `.c` files, compile each to a `.o`, and link them. Change one file and watch only that one recompile — the foundation of `make`.

---

## Further Reading

- *Compilers: Principles, Techniques, and Tools* — Aho, Lam, Sethi, Ullman ("the Dragon Book"). The canonical introduction to the pipeline. Read Chapter 1.
- *Crafting Interpreters* — Robert Nystrom. The most readable modern walkthrough of building a language end to end. Free online at https://craftinginterpreters.com/
- *Engineering a Compiler* — Cooper & Torczon. A clearer, more modern alternative to the Dragon Book.
- *The LLVM Compiler Infrastructure* — https://llvm.org/ — read "The Architecture of Open Source Applications: LLVM" by Chris Lattner for the front/middle/back-end thesis in the author's own words.
- *GCC Internals* — https://gcc.gnu.org/onlinedocs/gccint/ — for GENERIC/GIMPLE/RTL.
- *Reflections on Trusting Trust* — Ken Thompson, 1984. The classic on bootstrapping and compiler trust. Short and mind-bending.
- *A Tour of the JVM* and the V8 blog (https://v8.dev/blog) for real JIT architectures.

---

## Related Topics

- This folder, next levels: [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- The rest of this section zooms into one box of the pipeline each — the lexer turns text into tokens; the parser builds the AST; semantic analysis does name resolution and type checking with the symbol table; IR topics cover the intermediate representation; optimization covers the middle-end passes; code generation covers the back end; the interpreter and runtime topics cover executing the result. Read this page first; it is the map for all of them.

---

## Diagrams & Visual Aids

### The Full Pipeline

```text
   ┌─────────────┐
   │ source.c    │   "x = a + 2;"
   └──────┬──────┘
          │  LEXER (scanner)
          ▼
   ┌─────────────┐
   │  tokens     │   IDENT(x) EQ IDENT(a) PLUS NUM(2) SEMI
   └──────┬──────┘
          │  PARSER
          ▼
   ┌─────────────┐
   │   AST       │      (=)
   │             │     /   \
   │             │   x     (+)
   │             │        /   \
   │             │      a       2
   └──────┬──────┘
          │  SEMANTIC ANALYSIS (names declared? types match?)
          ▼
   ┌─────────────┐
   │ checked AST │   + symbol table { x: int, a: int }
   └──────┬──────┘
          │  IR GENERATION
          ▼
   ┌─────────────┐
   │     IR      │   t1 = a + 2 ;  x = t1
   └──────┬──────┘
          │  OPTIMIZATION
          ▼
   ┌─────────────┐
   │ better IR   │
   └──────┬──────┘
          │  CODE GENERATION
          ▼
   ┌─────────────┐
   │  assembly   │   mov eax,[a]; add eax,2; mov [x],eax
   └──────┬──────┘
          │  ASSEMBLER + LINKER
          ▼
   ┌─────────────┐
   │ executable  │
   └─────────────┘
```

### The Front / Middle / Back-End Split

```text
   C  ─┐                                          ┌─► x86
   C++─┤                                          ├─► ARM
   Rust┤── FRONT ENDS ──►  [ SHARED IR ]  ──► ────┤─► RISC-V
   Swift┤  (one per lang)   (the waist)   BACK ENDS├─► WASM
   ...─┘                                          └─► ...

   └─ language-specific ─┘ └─ neutral ─┘ └─ target-specific ─┘
        FRONT END           MIDDLE END        BACK END
```

### The M × N → M + N Hourglass

```text
   many languages
   ╲   ╲   │   ╱   ╱      (M front ends funnel down)
    ╲   ╲  │  ╱   ╱
     ╲   ╲ │ ╱   ╱
      ═════╪═════           ◄── THE NARROW WAIST: one shared IR
     ╱   ╱ │ ╲   ╲
    ╱   ╱  │  ╲   ╲
   ╱   ╱   │   ╲   ╲      (N back ends fan out)
   many targets

   Without the waist:  M × N  compilers.
   With the waist:     M + N  pieces (M fronts + N backs).
```

### The Toolchain Behind `gcc hello.c`

```text
   you type:   gcc hello.c -o hello
                 │
   ┌─────────────▼──────────────────────────────────────────┐
   │  DRIVER (gcc) — orchestrates, doesn't translate itself  │
   └───┬─────────┬──────────┬────────────────┬───────────────┘
       │         │          │                │
       ▼         ▼          ▼                ▼
    ┌──────┐ ┌──────┐   ┌──────┐         ┌──────┐
    │ cpp  │→│ cc1  │ → │  as  │  ────►  │  ld  │ ──► hello
    │preproc│ │compile│  │assemble│        │link │     (exe)
    └──────┘ └──────┘   └──────┘         └──────┘
     .i       .s          .o          + libraries
```

### Compiler vs Interpreter vs JIT

```text
   COMPILER (AOT):   source ─► [compile once] ─► machine code ─► run, run, run
                              (before running)

   INTERPRETER:      source ─► [parse] ─► walk & execute each statement, every run
                              (no machine code emitted)

   JIT:              source ─► [parse] ─► interpret... spot "hot" code...
                              ─► [compile hot code] ─► run hot code as machine code
                              (compile WHILE running)
```
