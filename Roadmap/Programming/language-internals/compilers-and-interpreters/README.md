# Compilers & Interpreters Roadmap

> *"A compiler is just a function from strings to strings — but it's the most interesting such function ever written."*

This roadmap is about **how a programming language is turned into something that runs** — lexing, parsing, type-checking, optimization, code generation, and the runtime that supports it all. It's also the gateway to the practical skills every senior engineer needs: writing DSLs, reading compiler errors fluently, understanding why the language behaves the way it does at the edges.

> Looking for the *CS-foundations angle* (formal grammars, automata theory, optimization theory)? See [Architecture → CS → Compilers](../../../Architecture/computer-science/04-compilers/) — that section approaches compilers as a CS topic. **This** roadmap approaches them as a tool a working engineer reaches for (parsing DSLs, building linters, reading codegen output).
>
> Looking for *build orchestration* (make, bazel, cargo)? See [Build Systems](../../quality-engineering/build-systems/README.md).

---

## Why a Dedicated Roadmap

Most engineers will never write a production compiler — but most engineers *will*:

- Read a parser/AST library (Tree-sitter, ANTLR, `go/ast`)
- Write a small DSL or a config-language interpreter
- Debug "why does the compiler emit this weird code?"
- Implement a linter, codemod, or codegen tool
- Read LLVM IR or JVM bytecode to understand a performance issue

This roadmap targets that working-engineer slice — the parts of compilers that **show up in everyday senior work**.

| Roadmap | Question it answers |
|---|---|
| [Type Systems](../type-systems/README.md) | What can the compiler prove about my program? |
| [Build Systems](../../quality-engineering/build-systems/README.md) | How is source turned into a runnable artifact? |
| **Compilers & Interpreters** (this) | How does a language *actually* understand and execute code? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-the-big-picture/) | The Big Picture | Source → tokens → AST → IR → target; the phases and what each does |
| [02](02-lexers-and-tokenizers/) | Lexers / Tokenizers | Regular languages, state machines, hand-written vs generated lexers |
| [03](03-parsers/) | Parsers | Grammar classes (LL, LR, PEG), recursive descent, Pratt parsing, error recovery |
| [04](04-abstract-syntax-trees/) | Abstract Syntax Trees | Designing an AST, visitor pattern, immutable trees, source positions |
| [05](05-semantic-analysis/) | Semantic Analysis | Name resolution, scopes, type checking, constant folding |
| [06](06-intermediate-representations/) | Intermediate Representations | Three-address code, SSA form, LLVM IR, JVM bytecode |
| [07](07-optimization/) | Optimization | Constant folding, inlining, DCE, escape analysis, loop optimizations |
| [08](08-code-generation/) | Code Generation | Register allocation, instruction selection, target ABIs |
| [09](09-interpreters/) | Interpreters | Tree-walking, bytecode VMs, JIT compilers, AOT vs JIT trade-offs |
| [10](10-runtimes/) | Runtimes | GC, threads, FFI, the line between language and runtime |
| [11](11-dsls-in-practice/) | DSLs in Practice | External vs internal DSLs, when to design one, when to just use a library |
| [12](12-reading-codegen/) | Reading Codegen | Inspecting Go's SSA dumps, JVM bytecode (`javap`), Rust's MIR, LLVM IR |

---

## Languages

The roadmap is meta-linguistic: examples in **Go** (writing a small interpreter, using `go/ast` and `go/parser`), **Java** (reading bytecode, ASM), **Python** (`ast` module, building DSLs), and **Rust** (`syn`, procedural macros) — the four languages most likely to show up in real codegen / tooling work.

---

## Status

⏳ **Structure defined; 12 sub-folders scaffolded. Per-topic files (junior / middle / senior / professional / interview) pending.**

---

## References

- *Compilers: Principles, Techniques, and Tools* — Aho, Lam, Sethi, Ullman ("the Dragon Book")
- *Engineering a Compiler* — Cooper & Torczon
- *Crafting Interpreters* — Robert Nystrom (free online, the modern hands-on classic)
- *Writing an Interpreter in Go* / *Writing a Compiler in Go* — Thorsten Ball

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
