# Build Fundamentals — Junior Level

> **Roadmap:** [Build Systems](../README.md) → Build Fundamentals
> *Source code is just text. A build is the chain of mechanical steps that turns that text into something a computer can actually run — and almost every bug you'll spend a frustrating afternoon on lives somewhere in that chain.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Build Is a Pipeline](#core-concept-1--a-build-is-a-pipeline)
5. [Core Concept 2 — Compile: Source → Object Code](#core-concept-2--compile-source--object-code)
6. [Core Concept 3 — Link: Stitching Objects Into One Program](#core-concept-3--link-stitching-objects-into-one-program)
7. [Core Concept 4 — Static vs Dynamic Linking](#core-concept-4--static-vs-dynamic-linking)
8. [Core Concept 5 — Interpreted, Compiled, and In-Between](#core-concept-5--interpreted-compiled-and-in-between)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is a build, and why should you care?**

When you press "Run" in your editor, something happens in the half-second before your program springs to life. That something is the **build**: a sequence of tools that translates the text *you* wrote into instructions the *CPU* can execute.

For a tiny script you may never notice it — Python "just runs." But the moment your project has more than one file, pulls in a library, or has to run on a machine that isn't yours, the build becomes a real thing with real failure modes. The infamous errors — `undefined reference to 'foo'`, `cannot find -lssl`, `version GLIBC_2.34 not found` — are not compiler errors. They are *build* errors, and they confuse people for years precisely because nobody taught them what a build actually is.

This page teaches you the skeleton: the four or five mechanical steps every compiled language performs, in order. Once you can name the steps, the error messages stop being noise and start telling you exactly where the pipeline broke.

> **The mindset shift:** stop thinking "I wrote code and it ran." Start thinking "I wrote text; a pipeline transformed it; each stage can fail differently." That single shift turns build errors from mysteries into a checklist.

---

## Prerequisites

- **Required:** You can write and run a program in at least one language (examples use **C**, **Go**, and a little **Python**).
- **Required:** You know what a file and a folder are, and you've used a terminal to run a command.
- **Helpful:** You've seen an error that mentioned "linker," "symbol," or "object file" and didn't know what it meant. (You will by the end.)
- **Helpful:** You've installed a library and had it "not found" at some point.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Source code** | The text you write (`main.c`, `app.go`). Human-readable. |
| **Compiler** | The tool that translates source into machine code. |
| **Object file** | The machine-code translation of *one* source file, not yet a runnable program (`.o`, `.obj`). |
| **Symbol** | A name the compiler tracks — a function or global variable, like `printf` or `main`. |
| **Linker** | The tool that combines object files (and libraries) into one runnable program. |
| **Executable / binary** | The final runnable file (`a.out`, `app.exe`). |
| **Library** | Pre-built code you reuse instead of writing yourself (`libssl`, the standard library). |
| **Toolchain** | The whole set of tools — compiler, assembler, linker — that work together. |
| **Artifact** | Any file the build *produces* (a binary, a `.jar`, a `.whl`). |

---

## Core Concept 1 — A Build Is a Pipeline

A build is not one action. It is a **pipeline**: the output of each stage is the input to the next. For a classic compiled language like C, the stages are:

```
source code  →  [preprocess]  →  [compile]  →  [assemble]  →  [link]  →  executable
  main.c                          main.s        main.o                    a.out
```

Each arrow is a *separate program* doing a *separate job*. You usually run one command (`gcc main.c`) and it quietly runs all of them for you — but they are distinct, and they fail for distinct reasons.

Here is the whole pipeline made visible. Normally `gcc` hides the intermediate files; these flags expose them:

```bash
gcc -E main.c -o main.i     # 1. preprocess: expand #include and #define
gcc -S main.i -o main.s     # 2. compile:    C → assembly (human-ish text)
gcc -c main.s -o main.o     # 3. assemble:   assembly → machine code (object file)
gcc    main.o -o app        # 4. link:       object file(s) → executable
```

The single command `gcc main.c -o app` does all four. The reason it matters that they're separate: when something breaks, the *error message* tells you *which stage* broke, and that tells you *what kind* of problem you have.

> **Key insight:** "compile error" and "link error" are completely different categories. A compile error means your *code is wrong* (syntax, types). A link error means your code is *fine* but the pieces *can't be connected* (a function is missing, a library wasn't found). People waste hours fixing the wrong category because nobody told them these are two different stages.

---

## Core Concept 2 — Compile: Source → Object Code

**Compilation** translates one source file into one **object file** — machine code for your CPU, but with a catch: it still has *holes*.

Consider `main.c`:

```c
#include <stdio.h>

int add(int a, int b);   // declaration: "add exists somewhere, trust me"

int main(void) {
    printf("%d\n", add(2, 3));
    return 0;
}
```

When the compiler processes this, it sees calls to `add` and `printf`. It does **not** have the code for either one — `add` lives in another file, `printf` lives in the C standard library. So the compiler leaves a labelled hole: *"call the function named `add` here; someone will fill in the real address later."* That label is a **symbol**.

The result, `main.o`, is real machine code but **not runnable**. It's a puzzle piece with tabs and slots, waiting to be connected.

```bash
gcc -c main.c -o main.o    # produces main.o — compiles fine even though add() has no body here
```

This compiles *successfully* even though `add` has no implementation anywhere yet — because compilation only needs the **declaration** (the promise that `add` exists), not the **definition** (the actual code). That distinction is the single most useful thing to understand at this level.

> **Why two files?** Why not compile everything at once? Because **incremental builds**: if you change `main.c` but not `math.c`, the build can recompile only `main.c` and reuse the old `math.o`. On a large project this is the difference between a 2-second rebuild and a 10-minute one. Splitting compilation per-file is what makes that possible — a theme [02 — Dependency Graphs](../02-dependency-graphs/junior.md) builds on directly.

---

## Core Concept 3 — Link: Stitching Objects Into One Program

The **linker** is the stage everyone forgets exists — until it shouts at them. Its job: take all the object files plus any libraries, **resolve every symbol** (fill every hole), and produce one executable.

Add the second file, `math.c`:

```c
int add(int a, int b) {   // the definition — the actual body
    return a + b;
}
```

Now build both:

```bash
gcc -c main.c -o main.o    # main.o has a hole labelled "add"
gcc -c math.c -o math.o    # math.o has the real "add"
gcc main.o math.o -o app   # LINK: linker fills main.o's hole with math.o's add
```

The linker matches the hole in `main.o` to the definition in `math.o`, patches in the real address, and writes `app`. Done.

Now the famous error. Forget to include `math.o`:

```bash
gcc main.o -o app
# undefined reference to 'add'
```

Read that message as what it literally is: *"You used the symbol `add`, but I searched every file you gave me and never found its definition. The hole stays empty. I refuse to make a broken program."* The fix is never "the code is wrong" — the code compiled fine. The fix is "I didn't give the linker the piece that contains `add`."

The mirror-image error:

```c
// add defined in BOTH math.c and extra.c
// multiple definition of 'add'
```

*"You gave me two pieces that both claim to be `add`. I don't know which address to use."*

> **Key insight:** Linker errors are about **availability and uniqueness of symbols**, never about logic. `undefined reference` = a piece is missing. `multiple definition` = a piece is duplicated. Train your eye to classify the error first; the fix follows from the category.

---

## Core Concept 4 — Static vs Dynamic Linking

Your program uses code it didn't write — `printf`, crypto routines, JSON parsers. There are two ways that external code gets attached, and the choice shapes how your program ships and runs.

**Static linking** — copy the library's code *into* your executable at build time:

```
[ your code ] + [ copy of libssl ] + [ copy of libc ]  →  one big self-contained binary
```

- The binary is **bigger** but **self-contained**: copy it to another machine and it runs, no dependencies.
- The library version is **frozen** at build time. A security fix in the library means you must **rebuild**.

**Dynamic linking** — leave a *reference* to the library; load it at program startup:

```
[ your code + "needs libssl.so.3" ]   →  small binary
                                          ↓ at startup, the OS finds and loads libssl.so.3
```

- The binary is **small** and the library is **shared** across all programs on the machine.
- The library can be updated independently (security patches apply to every program at once).
- **But:** the library must be *present* on the target machine and be a *compatible version*. If not:

```bash
./app
# error while loading shared libraries: libssl.so.3: cannot open shared object file
```

That error — and its cousin `version GLIBC_2.34 not found` — is the single most common reason "it works on my machine" fails on someone else's. Your machine had the shared library; theirs didn't, or had the wrong version.

| | Static | Dynamic |
|---|---|---|
| Binary size | Large | Small |
| Self-contained? | Yes | No — needs the lib present |
| Update the library | Rebuild your app | Replace the `.so`/`.dll` |
| "Works on my machine" risk | Low | **Higher** |
| Typical extensions | baked in | `.so` (Linux), `.dll` (Windows), `.dylib` (macOS) |

Go famously defaults to **static** linking — which is exactly why a Go binary is a single file you can `scp` to a server and run. C and most C++ default to **dynamic**, which is why "missing shared library" is a rite of passage.

---

## Core Concept 5 — Interpreted, Compiled, and In-Between

Not every language has a visible link step. The spectrum:

**Compiled ahead-of-time (AOT)** — C, C++, Go, Rust. The whole pipeline above runs *before* you ship. You ship machine code. Fast to start, fast to run; the build is a separate, sometimes slow, step.

**Interpreted** — classic Python, Ruby, shell. There is no separate build artifact; an *interpreter* reads your source and executes it line by line at runtime. No link step you can see. "It just runs" — because the build happens invisibly, every time, as it runs.

**Bytecode + virtual machine (the huge middle)** — Java, C#, and *also* modern Python. Source compiles to **bytecode** (not machine code — a portable instruction set), then a **virtual machine** (the JVM, the .NET CLR, the Python VM) runs the bytecode.

```
Java:   Foo.java  --javac-->  Foo.class (bytecode)  --JVM-->  runs
Python: app.py    --auto-->   app.pyc   (bytecode)  --PyVM--> runs
```

That `__pycache__/*.pyc` folder you've seen? That's Python's compile step, cached. Python *is* compiled — to bytecode — you just never run the compiler by hand.

> **Why this matters for builds:** "compiled vs interpreted" is not a clean binary; it's *where on the spectrum the translation happens and what artifact you ship*. AOT languages have a heavy, explicit build. VM languages have a light build plus a runtime dependency (the VM must be installed). Interpreted languages push the whole translation to runtime. Knowing which one you're in tells you *what you ship* and *what must exist on the target machine* — the two questions every deployment comes down to.

---

## Real-World Examples

**1. The "missing library" deployment failure.** A team builds a service on their laptops (dynamic linking, `libpq` present from their Postgres install). They copy the binary to a bare production server. It dies instantly: `libpq.so.5: cannot open shared object file`. The *code* was perfect. The build was dynamic, and the production box never had the Postgres client library. Fix: either install the lib on the server, statically link it, or ship in a container that includes it.

**2. Why a "tiny code change" triggered a 10-minute rebuild.** A developer edits one comment in a widely-`#include`d header. Because *every* file that includes that header must be recompiled, and hundreds do, the whole project rebuilds. This is the compile/link split and the dependency graph in action — covered in [02 — Dependency Graphs](../02-dependency-graphs/junior.md).

**3. The Go binary you can just copy.** A Go service compiles to one static binary with no external dependencies. Deployment is `scp app server:` and `./app`. No runtime, no shared libraries, no "wrong version." This single property is a major reason Go won so much server-side adoption — and it's a *build* property, not a language-feature property.

---

## Mental Models

- **The pipeline as a factory line.** Source is raw material. Each station (preprocess, compile, assemble, link) transforms it. A jam at one station has a different cause than a jam at another. Find the station, find the cause.

- **Object files as puzzle pieces with labelled tabs.** Compilation cuts the pieces and labels the connectors (symbols). Linking snaps them together. `undefined reference` = a connector with no matching piece. `multiple definition` = two pieces fighting for one slot.

- **Static = packed lunch, dynamic = eating at the cafeteria.** Static linking packs everything you need into one box — heavy, but works anywhere. Dynamic linking travels light but assumes the cafeteria (the target machine) stocks what you need. "Cafeteria's closed" is the missing-`.so` error.

- **Declaration is a promise; definition is the goods.** The compiler trusts promises (declarations) and lets you build. The linker collects on them (finds definitions). A broken promise surfaces at *link* time, not compile time — which is why the error appears "late."

---

## Common Mistakes

1. **Confusing compile errors with link errors.** Syntax/type error = compile (your code is wrong). `undefined reference` / missing `.so` = link (pieces missing or unconnected). Misclassifying sends you editing code that was never broken.

2. **Forgetting to give the linker every object/library.** `undefined reference to 'foo'` almost always means you compiled the file with `foo` but didn't *pass it to the link step* (or forgot a `-l` flag for a library). The body exists; you just didn't hand it over.

3. **Assuming a binary is self-contained.** It usually isn't. A dynamically linked binary needs its shared libraries present at the *right version* on the target. "It ran on my laptop" ≠ "it'll run anywhere."

4. **Thinking Python isn't compiled.** It compiles to bytecode (`.pyc`). The difference from Java isn't "compiled vs not" — it's *when* and *whether you ship the artifact*.

5. **Editing a header and being surprised the world rebuilds.** Headers are `#include`d (copied) into every file that uses them. Change the header, change every file that included it. This is expected, not a bug.

6. **Ignoring library *version* mismatches.** `cannot open shared object file` means *absent*. `version GLIBC_2.34 not found` means *present but too old*. Different problem, different fix (rebuild on an older base, or upgrade the target).

---

## Test Yourself

1. Name the four main stages a C build runs, in order, and say in one sentence what each produces.
2. You see `undefined reference to 'parse_json'`. Is this a compile error or a link error? What is the most likely cause?
3. You change one line in `utils.h` (a header) and your whole project recompiles. Why?
4. Your colleague's binary runs on their machine but dies on the server with `libcrypto.so.3: cannot open shared object file`. Was the code wrong? What are two ways to fix it?
5. Is Python compiled? Defend your answer in one sentence.
6. You want to ship a binary that runs on any Linux server with zero setup. Static or dynamic linking? What's the trade-off you accept?

<details>
<summary>Answers</summary>

1. **Preprocess** (expand `#include`/`#define` → `.i`), **compile** (C → assembly `.s`), **assemble** (assembly → object code `.o`), **link** (objects + libs → executable). 
2. **Link error.** You used `parse_json` but never gave the linker the object file or library that *defines* it.
3. The header's text is `#include`d (copied) into every file that uses it, so changing it invalidates every one of those files — they all recompile.
4. **The code was not wrong** — it compiled and linked fine on their machine. It was dynamically linked and the server lacks `libcrypto.so.3`. Fix: (a) install the library on the server, or (b) statically link it / ship in a container that bundles it.
5. **Yes** — Python compiles source to bytecode (`.pyc`) which a virtual machine runs; it's compiled-to-bytecode, just not compiled-to-machine-code ahead of time.
6. **Static.** Trade-off: a larger binary, and a security fix in any bundled library requires you to rebuild and redeploy rather than patching a shared `.so`.

</details>

---

## Cheat Sheet

```
THE PIPELINE (C-style)
  source → preprocess → compile → assemble → link → executable
  .c        .i           .s        .o         (libs)  a.out

EXPOSE THE STAGES
  gcc -E f.c   # preprocess only
  gcc -S f.c   # stop after compile (emit .s)
  gcc -c f.c   # stop after assemble (emit .o)  ← compile WITHOUT linking
  gcc f.o -o a # link

ERROR CLASSIFICATION
  syntax/type error          → COMPILE  → your code is wrong
  "undefined reference"      → LINK     → a piece is MISSING (give it to the linker)
  "multiple definition"      → LINK     → a piece is DUPLICATED
  "cannot open shared object"→ RUNTIME  → dynamic lib ABSENT on target
  "GLIBC_x.y not found"      → RUNTIME  → dynamic lib too OLD on target

LINKING
  static  = lib copied INTO binary  → big, self-contained, rebuild to update
  dynamic = lib referenced, loaded at startup → small, shared, needs lib present

DECLARATION vs DEFINITION
  declaration  int add(int,int);     → a promise (compiler trusts it)
  definition   int add(...){...}     → the goods  (linker collects it)
```

---

## Summary

- A **build is a pipeline**: preprocess → compile → assemble → link. Each stage is a separate tool that fails for separate reasons.
- **Compilation** turns one source file into one **object file** — real machine code, but with *holes* (unresolved **symbols**) where it calls code defined elsewhere. It needs only a *declaration* (a promise) to succeed.
- **Linking** fills those holes by matching symbols across all object files and libraries, producing the runnable executable. `undefined reference` = a piece is missing; `multiple definition` = a piece is duplicated.
- **Static linking** bakes libraries into the binary (big, portable). **Dynamic linking** references them at runtime (small, shared, but the lib must be present at the right version on the target — the root of most "works on my machine" failures).
- Languages sit on a spectrum: **AOT-compiled** (ship machine code), **bytecode + VM** (ship portable bytecode, need the VM), **interpreted** (ship source, translate at runtime). Knowing where you are tells you *what you ship* and *what must exist on the target*.

You now have the skeleton. Everything else in this roadmap — dependency graphs, caching, hermetic and reproducible builds — is about doing these same steps **faster**, **more reliably**, and **identically across machines**.

---

## Further Reading

- *Computer Systems: A Programmer's Perspective* (Bryant & O'Hallaron) — Chapter 7, "Linking." The clearest treatment of symbols and the linker in print.
- *How to Write Shared Libraries* — Ulrich Drepper. Deep on dynamic linking; skim the intro.
- [`gcc` manual — overall options](https://gcc.gnu.org/onlinedocs/gcc/Overall-Options.html) — what `-E`, `-S`, `-c` actually do.
- The [middle.md](middle.md) of this topic, which formalizes the toolchain, the C ABI, and how all of this generalizes beyond C.

---

## Related Topics

- [02 — Dependency Graphs](../02-dependency-graphs/junior.md) — *why* compilation is split per-file: incremental rebuilds.
- [04 — Per-Language Tools](../04-per-language-tools/junior.md) — how `go build`, `cargo`, and `gradle` hide this pipeline.
- [09 — Reproducible Builds](../09-reproducible-builds/junior.md) — making the pipeline produce *bit-identical* output every time.
- [Language Internals › Compilers](../../../language-internals/compilers-and-interpreters/README.md) — what happens *inside* the compile stage (lexing, parsing, codegen).
