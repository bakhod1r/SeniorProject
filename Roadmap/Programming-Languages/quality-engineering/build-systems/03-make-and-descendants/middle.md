# Make & Descendants — Middle Level

> **Roadmap:** [Build Systems](../README.md) → Make & Descendants
> *The junior page wrote rules by hand, one per file. That doesn't scale past a toy. This page is where Make becomes a real tool — automatic variables, pattern rules, generated header dependencies — and where you finally understand why "Recursive Make Considered Harmful" is the most-cited paper in build tooling, and why Ninja and CMake were born from its pain.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Automatic Variables — `$@`, `$<`, `$^`](#automatic-variables------)
4. [Pattern Rules — One Rule for All `.o` Files](#pattern-rules--one-rule-for-all-o-files)
5. [Variables and Functions](#variables-and-functions)
6. [The Header Problem and Auto-Generated Dependencies](#the-header-problem-and-auto-generated-dependencies)
7. [`.PHONY` Correctness and Order-Only Prerequisites](#phony-correctness-and-order-only-prerequisites)
8. [Recursive Make Considered Harmful](#recursive-make-considered-harmful)
9. [Why Ninja Exists](#why-ninja-exists)
10. [Reading a `build.ninja`](#reading-a-buildninja)
11. [CMake as a Generator](#cmake-as-a-generator)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do you write Make that scales — and why did its scaling failures create Ninja and CMake?**

The [junior.md](junior.md) Makefile had one rule per object file. That's fine for three files and unbearable for three hundred — you'd be copy-pasting near-identical rules and updating them by hand forever. Worse, the naive version is *silently wrong*: it never tracks headers, so it produces stale builds that "compiled fine" but contain old code.

This page fixes both. **Automatic variables** and **pattern rules** collapse hundreds of rules into one. **Generated dependency files** make Make track headers correctly. Then we confront Make's structural limit — the **recursive make** pattern that fragments the dependency graph and quietly corrupts incremental builds — and see how that exact pain produced its descendants: **Ninja** (a fast, correct, *generated* low-level executor) and **CMake** (a high-level generator that emits Ninja or Make for you).

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md): rules, targets, prerequisites, recipes, `.PHONY`, the tab gotcha, `make -j`.
- **Required:** You understand the translation unit and why headers fan out into many object files ([01 — Build Fundamentals › middle](../01-build-fundamentals/middle.md)).
- **Helpful:** You've maintained or debugged a non-trivial Makefile and felt friction.
- **Helpful:** You can read the dependency-graph model in [02 — Dependency Graphs › middle](../02-dependency-graphs/middle.md).

---

## Automatic Variables — `$@`, `$<`, `$^`

Writing the target's name twice in every recipe (`gcc -c main.c -o main.o`) is exactly the kind of repetition that breaks down at scale. **Automatic variables** let Make fill in the names for you. Learn these three and you can read most Makefiles:

| Variable | Means | In `app: main.o math.o` |
|---|---|---|
| `$@` | the **target** | `app` |
| `$<` | the **first prerequisite** | `main.o` |
| `$^` | **all prerequisites** (deduplicated) | `main.o math.o` |

Rewriting the junior example with them:

```makefile
app: main.o math.o
	gcc $^ -o $@          # gcc main.o math.o -o app

main.o: main.c
	gcc -c $< -o $@       # gcc -c main.c -o main.o

math.o: math.c
	gcc -c $< -o $@       # gcc -c math.c -o math.o
```

Nothing is hardcoded twice. `$<` (first prereq — the source) and `$@` (target — the output) are the two you'll use constantly; `$^` (all prereqs) is for the link step. There are more (`$?` = prereqs newer than target, `$*` = the stem in a pattern rule), but these three carry the load.

> **Key insight:** automatic variables aren't a convenience — they're the precondition for the *next* idea. You can't write one generic rule for all `.o` files unless the recipe refers to "the target" and "the source" abstractly, instead of by literal name. `$@` and `$<` are what make pattern rules possible.

---

## Pattern Rules — One Rule for All `.o` Files

Notice the two object-file rules above are *identical except for the names*. A **pattern rule** uses `%` as a wildcard "stem" to express the whole family in one rule:

```makefile
# "To build ANY x.o, compile the matching x.c"
%.o: %.c
	gcc -c $< -o $@
```

The `%` matches any stem; both `%`s in one rule match the *same* stem. So `main.o` matches with stem `main`, prerequisite `main.c`; `math.o` matches with stem `math`. One rule now covers every object file in the project. The complete, scalable Makefile becomes:

```makefile
CC      := gcc
CFLAGS  := -Wall -Wextra -O2
OBJS    := main.o math.o util.o

app: $(OBJS)
	$(CC) $(CFLAGS) $^ -o $@

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

.PHONY: clean
clean:
	rm -f app $(OBJS)
```

Add a fourth source file? Add its `.o` to `OBJS`. The pattern rule already knows how to build it. This is Make scaling properly: a fixed number of rules regardless of file count.

> **Key insight:** Make ships with **built-in** pattern rules — it already knows `%.o: %.c` uses `$(CC)` and `$(CFLAGS)`. That's why some tiny Makefiles compile C with *no* recipe written at all. Run `make -p` to dump every built-in rule and variable Make is silently applying.

---

## Variables and Functions

Variables remove magic strings and centralize configuration. Two assignment flavors matter:

```makefile
CC := gcc                 # := simple — evaluated ONCE, immediately (use this by default)
CFLAGS = -O$(LEVEL)       # =  recursive — re-evaluated every USE (lazy; can surprise you)
```

Prefer `:=` (simple expansion). `=` re-expands on every reference, which is occasionally what you want but more often a source of confusing, slow behaviour.

Make also has **functions** for computing values — most usefully, deriving file lists so you never maintain them by hand:

```makefile
SRCS := $(wildcard src/*.c)              # find all .c files in src/
OBJS := $(patsubst src/%.c,build/%.o,$(SRCS))   # src/foo.c → build/foo.o

app: $(OBJS)
	$(CC) $^ -o $@

build/%.o: src/%.c
	$(CC) -c $< -o $@
```

`$(wildcard ...)` globs the filesystem; `$(patsubst pattern,replacement,list)` rewrites each entry. Now adding a source file requires *zero* Makefile edits — `wildcard` finds it automatically. Other common functions: `$(shell cmd)` (run a command, capture output), `$(subst from,to,text)`, `$(filter ...)`, `$(foreach ...)`.

> **Caution:** `$(wildcard)` is convenient but has a real downside — a *deleted* source file silently drops out of the build with no error, and a *new* file appears only because the glob re-ran. Some teams list sources explicitly precisely so that adding/removing a file is a deliberate, reviewable change. Both are defensible; know the trade-off.

---

## The Header Problem and Auto-Generated Dependencies

Here is the bug that makes hand-written Make *dangerous*, not just verbose. Consider:

```makefile
%.o: %.c
	gcc -c $< -o $@
```

This says `main.o` depends on `main.c`. But `main.c` does `#include "config.h"`. If you edit `config.h`, **`main.c`'s timestamp doesn't change** — so Make sees `main.o` as still fresh and *skips the rebuild*. Your binary now contains code compiled against the *old* `config.h`. It compiled with no error. It is wrong.

The naive fix — listing headers by hand — is unmaintainable and always drifts out of date:

```makefile
main.o: main.c config.h types.h     # you will forget to update this. Everyone does.
```

The real fix: **let the compiler generate the dependencies.** GCC and Clang emit a Make-format dependency file with `-MMD`:

```makefile
CFLAGS := -Wall -O2 -MMD -MP        # -MMD: write main.d listing main.c's #includes
                                    # -MP : add phony targets for each header (prevents
                                    #       errors when a header is later deleted)

SRCS := $(wildcard *.c)
OBJS := $(SRCS:.c=.o)
DEPS := $(OBJS:.o=.d)               # one .d file per object

app: $(OBJS)
	$(CC) $^ -o $@

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

-include $(DEPS)                    # pull in the generated dependency rules
                                    # leading - = "don't error if they don't exist yet"
```

After the first build, `main.d` contains something like `main.o: main.c config.h types.h`. The `-include` line merges those into Make's graph, so editing `config.h` now correctly rebuilds `main.o`. This **compiler-generated dependency** trick is the standard, correct way to do C/C++ headers in Make — and it's exactly the kind of fiddly correctness work that CMake later automated entirely.

> **Key insight:** the single most common *silent* bug in hand-rolled Make is missing header dependencies — builds that are stale but report success. If you take one practical skill from this page, it's `-MMD -MP` + `-include $(DEPS)`. The deeper treatment of *why* this matters is in [02 — Dependency Graphs › middle](../02-dependency-graphs/middle.md).

---

## `.PHONY` Correctness and Order-Only Prerequisites

Two refinements that separate a correct Makefile from a flaky one.

**`.PHONY` is about correctness, not style.** A phony target always runs and is never confused by a same-named file (covered in [junior.md](junior.md)). At this level, also know: phony targets are how you express "run these in this order" without faking file dependencies. But beware — a phony prerequisite is *always considered newer*, so anything depending on a phony target **always rebuilds**. Don't make a real file depend on a phony target unless you mean "rebuild me every time."

**Order-only prerequisites** solve a specific real problem: a target needs a directory to *exist* before it builds, but you don't want the target to rebuild every time the directory's timestamp changes (directories' mtimes change whenever a file is added). The syntax puts such prerequisites after a `|`:

```makefile
build/%.o: src/%.c | build           # `build` is order-only (after the |)
	$(CC) -c $< -o $@

build:                               # create the dir if missing
	mkdir -p build
```

This means: *"`build/` must exist before I compile, but don't rebuild the object just because `build/`'s timestamp moved."* Without the `|`, every new file in `build/` would bump the directory mtime and trigger needless recompiles of unrelated objects.

> **Key insight:** order-only prerequisites encode "must exist first" separately from "if newer, rebuild." Mixing the two — making a directory a normal prerequisite — is a classic cause of "why does everything rebuild whenever I add a file?"

---

## Recursive Make Considered Harmful

The most influential paper in build tooling is Peter Miller's 1997 *"Recursive Make Considered Harmful."* You must know its argument, because it explains the design of *everything* that came after Make.

**The recursive pattern.** Large projects often give each subdirectory its own Makefile, and a top-level Makefile that `cd`s into each and runs `make` again:

```makefile
# top-level Makefile — the harmful pattern
SUBDIRS := libfoo libbar app

all:
	for dir in $(SUBDIRS); do \
		$(MAKE) -C $$dir;        \
	done
```

It *looks* clean and modular. It is structurally broken. **The problem: each recursive `make` invocation sees only its own subdirectory's dependency graph — never the whole project's.**

Concretely, the failures:

1. **Incomplete graphs → wrong builds.** `app` depends on `libfoo`. But when Make runs in `app/`, it has no idea `libfoo`'s sources changed — that's a *different* Make invocation with a *different* graph. So `app` may link against a stale `libfoo`, or the directories build in the wrong order. The fix people reach for is "build `libfoo` first," which just hides the missing dependency.
2. **Broken parallelism.** `make -j` can't parallelize *across* the recursive boundary effectively, because the top level serializes one `$(MAKE) -C` at a time. Cores sit idle.
3. **Redundant work and slowness.** Each sub-make re-reads its Makefiles, re-stats files, and re-derives its graph from scratch. Multiply by hundreds of directories.

**Miller's prescription: non-recursive Make.** Use *one* Make invocation that `include`s fragment Makefiles from each subdirectory, so the entire project's dependency graph is assembled in a single process. Make then sees all dependencies, computes a correct global order, and parallelizes across the whole tree.

```makefile
# one top-level Makefile that INCLUDES fragments (the correct pattern)
include libfoo/module.mk
include libbar/module.mk
include app/module.mk
# each module.mk adds its targets/prereqs to ONE shared graph
```

> **Key insight:** the harm isn't recursion *per se* — it's *fragmenting the dependency graph across processes*. A correct build needs *one* complete graph. This realization is the seed of every descendant: Ninja takes a single, complete, precomputed graph and just runs it; Bazel ([05](../05-polyglot-hermetic-builds/junior.md)) enforces a single global graph by construction. The whole family is, in part, an answer to this 1997 paper.

---

## Why Ninja Exists

Ninja was written for Chromium, where even *correct* non-recursive Make was too slow. The diagnosis: Make tries to be two things at once — a *language for describing builds* (variables, functions, pattern rules) **and** an *engine for executing them*. Doing both makes it slow to parse and easy to write incorrectly.

Ninja's radical decision: **be only the engine, and make the file machine-generated.** Its design goals (read them straight from the manual):

- **No high-level features.** No pattern rules, no `wildcard`, minimal string handling. The generator (CMake/Meson) computes everything; Ninja just records concrete commands.
- **Be fast.** Starting a no-op build of a huge project should take well under a second. Ninja keeps the dependency graph and a log of what it built, so "is anything stale?" is a quick check, not a full re-derivation.
- **Maximize parallelism from a complete graph.** Because the entire graph is in one file, Ninja saturates every core — the thing recursive Make couldn't do.

The trade-off is deliberate: `build.ninja` is verbose, repetitive, and miserable to write by hand. **That's intentional.** You're not supposed to write it. A generator does, and the generator gets to use a pleasant high-level language.

> **Key insight:** Make conflated *description* and *execution*. Ninja split them apart and kept only execution, ruthlessly optimized. "Do one thing well" applied to builds. This is *why* the standard modern stack is "high-level generator → Ninja," not "Ninja alone."

---

## Reading a `build.ninja`

You'll rarely write one, but you must be able to *read* one when debugging. The syntax is tiny:

```ninja
# a "rule" defines a command template
rule cc
  command = gcc -MMD -MF $out.d -c $in -o $out
  depfile = $out.d
  description = CC $out

rule link
  command = gcc $in -o $out
  description = LINK $out

# "build" statements are the actual graph edges: outputs: rule inputs
build main.o: cc main.c
build math.o: cc math.c
build app: link main.o math.o      # app depends on both objects

default app
```

Note how concrete it is: no `%`, no wildcards, no variables computed at build time. Every object file gets its *own* explicit `build` line — the generator expanded the pattern *once*, ahead of time. `$in`/`$out` are Ninja's equivalents of `$<`/`$@`. The `depfile` line is how Ninja consumes the compiler's generated header dependencies — same `-MMD` mechanism as Make, wired in by the generator.

Run it:

```bash
ninja              # build the default target
ninja -t graph | dot -Tpng -o graph.png   # visualize the dependency graph
ninja -t deps main.o                       # show the recorded header deps for a target
ninja -v           # print the full commands being run
```

When you open a generated `build.ninja` and see thousands of explicit `build` lines, that's the point: the high-level tool did the thinking; Ninja just executes.

---

## CMake as a Generator

CMake is the most widely used **meta-build system**: you describe your project once, and CMake generates the native build files for whatever platform/toolchain you target — Unix Makefiles, Ninja, Visual Studio projects, Xcode projects.

You write `CMakeLists.txt` in CMake's own language, describing *targets and relationships* — not commands:

```cmake
cmake_minimum_required(VERSION 3.20)
project(myapp LANGUAGES C)

add_library(math math.c)            # a library target
add_executable(app main.c)          # an executable target
target_link_libraries(app PRIVATE math)   # app depends on math
```

Notice what's *absent*: no `gcc`, no `.o`, no platform paths, no header-dependency wiring. You declared "there is a library `math`, an executable `app`, and `app` uses `math`." CMake figures out the rest for your platform.

The workflow is **two explicit phases**:

```bash
# 1. CONFIGURE + GENERATE: read CMakeLists.txt, probe the system, write build files
cmake -S . -B build -G Ninja        # -G picks the generator (Ninja here; default varies)

# 2. BUILD: run the generated low-level build
cmake --build build                 # portable wrapper; runs `ninja` (or `make`) in build/
#   or directly:  ninja -C build
```

That `cmake -B build` step is doing the work a hand-written Makefile makes *you* do: detecting the compiler, finding libraries, computing header dependencies, and emitting a correct, complete `build.ninja`. Re-run `cmake --build build` after editing a source file and only the affected targets rebuild — because the generated Ninja graph is correct.

> **Key insight:** CMake is to your project what a compiler is to your source — a *translator*. `CMakeLists.txt` (portable, high-level) → `build.ninja` (platform-specific, low-level). The two-phase "configure then build" split is the defining shape of the meta-build descendants, and the source of both their power (cross-platform, correct) and their confusion (a stale or corrupt `build/` cache — a [senior.md](senior.md)/[professional.md](professional.md) war story). Meson follows the same pattern with a cleaner language and is Ninja-only.

---

## Mental Models

- **Automatic variables are pronouns.** `$@` = "this target (it)," `$<` = "its main source," `$^` = "all its sources." Pronouns are what let one pattern rule speak about *any* file abstractly.

- **A pattern rule is a function over filenames.** `%.o: %.c` is "given a stem, here's how to make its `.o` from its `.c`." Make calls that function on demand for every object it needs. You write the recipe once; Make instantiates it N times.

- **The header bug is a lie of omission.** Your Makefile *says* `main.o` depends only on `main.c`. It's lying — it also depends on every header `main.c` includes. `-MMD` makes the compiler tell the truth, and `-include` writes that truth into the graph.

- **Recursive Make shards one graph into many blind ones.** Each sub-make is a person who can only see their own room and is asked to build a house. The fix is one person with the whole blueprint — a single complete graph. Every descendant enforces that.

- **The descendants are "compiler / runtime" applied to builds.** CMake/Meson = the *compiler* (translate a high-level description to a low-level artifact). Ninja = the *runtime* (execute that artifact fast). You stopped hand-writing the low-level layer for the same reason you stopped hand-writing assembly.

---

## Common Mistakes

1. **Hardcoding names instead of `$@`/`$<`/`$^`.** Repetition that pattern rules are meant to eliminate. If a recipe names its own target/source literally, it can't become a pattern rule.

2. **Omitting header dependencies.** The classic silent staleness bug. Without `-MMD -MP` + `-include $(DEPS)`, editing a header doesn't rebuild dependents — you ship code compiled against an old header. Compiles clean, runs wrong.

3. **Using `=` where you meant `:=`.** Recursive (`=`) variables re-expand on every use; surprising and slow. Default to simple (`:=`) unless you specifically need lazy evaluation.

4. **Making a real file depend on a phony target.** Phony prereqs are always "newer," so the file rebuilds *every single time*. Use order-only (`|`) prerequisites for "must exist first" instead.

5. **Reaching for recursive Make for modularity.** It fragments the dependency graph, breaks `-j`, and produces stale/wrong builds. Use non-recursive `include`d fragments — one Make process, one complete graph.

6. **Trying to hand-edit a generated `build.ninja` or CMake-generated `Makefile`.** Your edits are erased on the next generate. Change the *source* (`CMakeLists.txt` / `meson.build`) and regenerate.

7. **Forgetting CMake is two phases.** Editing `CMakeLists.txt` and running only `ninja` may not pick up structural changes; the *configure* step must re-run. (CMake usually re-triggers it automatically, but don't rely on it after big edits — or after a cache goes stale.)

---

## Test Yourself

1. Rewrite `foo.o: foo.c` + `gcc -c foo.c -o foo.o` using automatic variables, then generalize it to a pattern rule.
2. You edit `config.h`, run `make`, and the binary still has old behaviour even though "it built." What's the bug, and what's the standard fix?
3. Why does a target that depends on a `.PHONY` prerequisite rebuild every time? When is that not what you want, and what do you use instead?
4. State the core argument of "Recursive Make Considered Harmful" in two sentences.
5. Why is `build.ninja` deliberately verbose and not meant to be hand-written?
6. Describe the two phases of a CMake build and what each produces.

<details>
<summary>Answers</summary>

1. With automatic variables: `foo.o: foo.c` then recipe `gcc -c $< -o $@`. As a pattern rule: `%.o: %.c` with recipe `gcc -c $< -o $@` — now it builds *any* `.o` from its matching `.c`.
2. **Missing header dependency:** the rule lists only `foo.c`, not `config.h`, so editing the header doesn't update `foo.c`'s timestamp and Make skips the rebuild — you get a stale binary. Fix: compile with `-MMD -MP`, collect the generated `.d` files, and `-include` them so the compiler's discovered header dependencies enter Make's graph.
3. A phony prerequisite has no file/timestamp, so Make treats it as always newer than the target — forcing a rebuild every run. That's wrong when you only need the prerequisite to *exist first* (e.g. a directory). Use an **order-only prerequisite** (`target: src | dir`) instead.
4. Splitting a project into per-directory recursive `make` invocations gives each invocation only a *fragment* of the dependency graph, so it can't see cross-directory dependencies — producing wrong build order, stale results, and broken parallelism. The fix is non-recursive Make: one process that `include`s all fragments into a single complete graph.
5. Because Ninja is *only* an execution engine — it deliberately omits high-level features (patterns, wildcards, functions) so it can be fast and simple. The high-level generator (CMake/Meson) expands everything into explicit `build` lines ahead of time, so the verbosity is the generator's output, not something a human authors.
6. **Configure/generate:** `cmake -S . -B build -G Ninja` reads `CMakeLists.txt`, probes the system (compiler, libraries), and writes low-level build files (`build.ninja`). **Build:** `cmake --build build` (or `ninja -C build`) runs that generated graph to produce the artifacts.

</details>

---

## Cheat Sheet

```
AUTOMATIC VARIABLES
  $@  target          $<  first prereq        $^  all prereqs (deduped)
  $?  prereqs newer than target               $*  the stem matched by %

PATTERN RULE (one rule, all files)
  %.o: %.c
  →   $(CC) $(CFLAGS) -c $< -o $@

VARIABLES
  CC := gcc           := simple   (eval once — prefer this)
  X   = $(Y)           = recursive (eval on every use — careful)
  SRCS := $(wildcard *.c)
  OBJS := $(SRCS:.c=.o)          # or $(patsubst %.c,%.o,$(SRCS))

HEADER DEPS (fixes silent staleness)
  CFLAGS += -MMD -MP
  DEPS := $(OBJS:.o=.d)
  -include $(DEPS)               # leading - = no error if missing

ORDER-ONLY PREREQ ("must exist first", don't trigger rebuild)
  build/%.o: src/%.c | build
  build: ; mkdir -p build

RECURSIVE MAKE = HARMFUL
  bad : top-level loops `$(MAKE) -C subdir`  → fragmented graph, wrong/slow
  good: one make, `include subdir/module.mk` → one complete graph

THE STACK
  CMakeLists.txt / meson.build   --(cmake/meson configure)-->  build.ninja
  build.ninja                    --(ninja)-->                  artifacts
  cmake -S . -B build -G Ninja   then   cmake --build build
  ninja files are GENERATED, never hand-written
```

---

## Summary

- **Automatic variables** (`$@`, `$<`, `$^`) and **pattern rules** (`%.o: %.c`) collapse hundreds of near-identical rules into one — the difference between Make-as-toy and Make-that-scales.
- **Variables** (`:=` simple vs `=` recursive) and **functions** (`wildcard`, `patsubst`, `shell`) let you compute file lists instead of maintaining them by hand.
- The **header problem** is hand-written Make's most dangerous bug: forget a header dependency and you ship stale code that "built fine." The standard fix is compiler-generated dependencies: `-MMD -MP` + `-include $(DEPS)`.
- **Order-only prerequisites** (`| dir`) express "must exist first" without triggering needless rebuilds; phony prerequisites always force a rebuild.
- **"Recursive Make Considered Harmful"** (Miller, 1997): fragmenting the dependency graph across per-directory `make` invocations breaks correctness and parallelism. Use one non-recursive Make with `include`d fragments — *one complete graph*.
- That demand for *one complete, fast graph* produced the descendants: **Ninja** (execution-only, generated, fast — never hand-written) and **CMake/Meson** (high-level project descriptions that *generate* Ninja/Make). The modern stack is "describe high-level → generate → execute fast."

The [senior.md](senior.md) page goes deeper into correctness pitfalls, non-recursive Make patterns at scale, Ninja's and Meson's design philosophies, and CMake's internals (configure vs generate vs build, toolchain files, modern target-based usage requirements).

---

## Further Reading

- [*Recursive Make Considered Harmful*](https://aegis.sourceforge.net/auug97.pdf) — Peter Miller, 1997. Read the original; it's short and changed how everyone thinks about builds.
- [GNU Make Manual — "Automatic Variables"](https://www.gnu.org/software/make/manual/make.html#Automatic-Variables) and [— "Pattern Rules"](https://www.gnu.org/software/make/manual/make.html#Pattern-Rules).
- [Ninja Manual](https://ninja-build.org/manual.html) — short enough to read in full; the design-goals section is essential.
- [CMake — "Step 1: A Basic Starting Point"](https://cmake.org/cmake/help/latest/guide/tutorial/A%20Basic%20Starting%20Point.html) and Daniel Pfeifer's talk *"Effective CMake."*
- *Auto-dependency generation* — the GNU Make manual's "Generating Prerequisites Automatically" section, for the `-MMD` mechanism.

---

## Related Topics

- [01 — Build Fundamentals › middle](../01-build-fundamentals/middle.md) — translation units and why one header fans out across many object files (the root of the header-dependency problem).
- [02 — Dependency Graphs › middle](../02-dependency-graphs/middle.md) — the formal graph model Make, Ninja, and CMake all execute.
- [04 — Per-Language Tools](../04-per-language-tools/middle.md) — how `cargo`, `go build`, and Gradle internalize these same ideas behind one command.
- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/junior.md) — Bazel/Buck, which take "one complete graph" further into hermetic, content-addressed builds.
- [senior.md](senior.md) — correctness pitfalls, non-recursive Make at scale, Ninja/Meson design, CMake internals.
