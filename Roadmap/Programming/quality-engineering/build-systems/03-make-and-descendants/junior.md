# Make & Descendants — Junior Level

> **Roadmap:** [Build Systems](../README.md) → Make & Descendants
> *Make is a 1976 program that still runs most of the world's C code. It does exactly one clever thing — rebuild only what changed — and that one idea spawned an entire family tree of build tools. Learn the parent and the children stop being intimidating.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What Make Actually Does](#core-concept-1--what-make-actually-does)
5. [Core Concept 2 — Anatomy of a Rule: Target, Prerequisites, Recipe](#core-concept-2--anatomy-of-a-rule-target-prerequisites-recipe)
6. [Core Concept 3 — The Tab Gotcha (Read This Before You Lose an Hour)](#core-concept-3--the-tab-gotcha-read-this-before-you-lose-an-hour)
7. [Core Concept 4 — Why Make Only Rebuilds What Changed](#core-concept-4--why-make-only-rebuilds-what-changed)
8. [Core Concept 5 — Phony Targets: `all`, `clean`, and Friends](#core-concept-5--phony-targets-all-clean-and-friends)
9. [Core Concept 6 — Running Builds in Parallel: `make -j`](#core-concept-6--running-builds-in-parallel-make--j)
10. [Core Concept 7 — Make's Children at a Glance: Ninja, CMake, Meson](#core-concept-7--makes-children-at-a-glance-ninja-cmake-meson)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is Make, and why does almost every build tool descend from it?**

You have already seen ([01 — Build Fundamentals](../01-build-fundamentals/junior.md)) that a build is a pipeline: compile each source file into an object file, then link the objects into a program. For one or two files you can type those commands by hand. For two hundred files you cannot — and you *especially* cannot remember which of the two hundred you just edited and which can be safely skipped.

**Make** solves exactly that. You write down, once, the recipe for turning each kind of file into the next, plus which files depend on which. From then on you type `make`, and it figures out the minimum amount of work needed to bring everything up to date. Change one file, and only that file (and whatever depends on it) gets rebuilt.

That one idea — *describe the work as a dependency graph, then do only the stale parts* — is so good that every serious build tool since has been a variation on it. Ninja, CMake, Meson, even Bazel are all answers to the question "Make had the right idea but X is painful; how do we keep the idea and fix X?" To understand the whole family, you start with the parent.

> **The mindset shift:** stop thinking of a build as "a script I run." Start thinking of it as "a description of what depends on what." A script runs every line every time. Make runs only the lines whose inputs changed. That difference is the entire reason this tool exists.

---

## Prerequisites

- **Required:** You understand compile vs link from [01 — Build Fundamentals](../01-build-fundamentals/junior.md) — what `.c`, `.o`, and an executable are.
- **Required:** You can run commands in a terminal and edit a text file.
- **Helpful:** You've written a tiny C or C++ program with more than one source file.
- **Helpful:** You've seen a `Makefile` in a project and had no idea how to read it. (You will.)

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Make** | A tool that reads a `Makefile` and runs only the build steps whose inputs changed. |
| **Makefile** | The text file (named `Makefile` or `makefile`) that tells Make the rules. |
| **Target** | The thing a rule produces — usually a file like `app` or `main.o`. |
| **Prerequisite** | A file the target depends on. If a prerequisite is newer than the target, the target is stale. |
| **Recipe** | The shell commands that build the target. Each line **must start with a TAB**. |
| **Rule** | One `target: prerequisites` line plus its recipe. |
| **Phony target** | A target that isn't a real file (`clean`, `all`) — just a named action. |
| **Timestamp (mtime)** | The "last modified" time of a file. Make compares these to decide what's stale. |
| **GNU Make** | The most common Make implementation (the `make` on Linux and macOS via Xcode/brew). |
| **CMake / Ninja / Meson** | Descendants — tools that *generate* build files or run them faster. |

---

## Core Concept 1 — What Make Actually Does

Make's algorithm is short enough to state in one breath:

> For each target, if any of its prerequisites is **newer** than the target (or the target doesn't exist yet), run the recipe to rebuild it. Otherwise, leave it alone.

That's it. Make doesn't understand C. It doesn't understand compilers. It understands **files**, **timestamps**, and **"this depends on that."** Everything else is you telling it which command turns one file into another.

Here is the simplest possible useful Makefile:

```makefile
app: main.c
	gcc main.c -o app
```

Read it as a sentence: *"The file `app` is built from `main.c`; to build it, run `gcc main.c -o app`."*

Run it:

```bash
$ make
gcc main.c -o app        # app didn't exist → built it

$ make
make: 'app' is up to date.  # nothing changed → did nothing

$ touch main.c            # pretend we edited main.c (updates its timestamp)
$ make
gcc main.c -o app        # main.c is now newer than app → rebuilt
```

The second `make` did **nothing** — and that "nothing" is the whole point. Make compared `main.c`'s timestamp to `app`'s, saw `app` was newer, and concluded there was no work to do. On a real project this is the difference between a build that takes a second and one that takes ten minutes.

---

## Core Concept 2 — Anatomy of a Rule: Target, Prerequisites, Recipe

Every rule has three parts. Memorize the shape and you can read any Makefile:

```makefile
target: prerequisite1 prerequisite2
	command-to-build-target
	another-command
```

- **Target** (before the `:`) — what gets produced. Usually a filename.
- **Prerequisites** (after the `:`) — what the target depends on. If any is newer than the target, rebuild.
- **Recipe** (the indented lines below) — the shell commands. **Each must start with a TAB**, not spaces.

Now a realistic multi-file build. Splitting compilation from linking ([01 — Build Fundamentals](../01-build-fundamentals/junior.md)) is what lets Make skip work:

```makefile
# Final program depends on two object files
app: main.o math.o
	gcc main.o math.o -o app

# Each object file depends on its source
main.o: main.c
	gcc -c main.c -o main.o

math.o: math.c
	gcc -c math.c -o math.o
```

Make reads this as a **graph**:

```
app
├── main.o ── main.c
└── math.o ── math.c
```

Now watch the magic. Edit `math.c` and run `make`:

```bash
$ touch math.c
$ make
gcc -c math.c -o math.o    # math.c changed → rebuild math.o
gcc main.o math.o -o app   # math.o changed → relink app
```

`main.o` was **not** rebuilt — `main.c` didn't change, so its object file is still valid. Make rebuilt `math.o` (its source changed) and then `app` (because one of *its* prerequisites, `math.o`, became newer). Make walked the graph from the bottom up and touched only the stale parts. This bottom-up "rebuild a thing only if something it depends on is newer" is the dependency-graph idea explored fully in [02 — Dependency Graphs](../02-dependency-graphs/junior.md).

> **Key insight:** the first target in the file is the **default** — running plain `make` builds it. So put your "main" target (here, `app`) first. You can also build any target by name: `make math.o`.

---

## Core Concept 3 — The Tab Gotcha (Read This Before You Lose an Hour)

This single rule has cost more beginner-hours than any other in build tooling:

> **Recipe lines must begin with a literal TAB character, never spaces.**

This is the most infamous wart in Make. If you indent a recipe with spaces, you get this baffling error:

```bash
Makefile:2: *** missing separator.  Stop.
```

"Missing separator" really means "you used spaces where a TAB was required." Your editor may be silently converting tabs to spaces, which is why the line *looks* correct.

```makefile
app: main.c
    gcc main.c -o app     # ← FOUR SPACES. This is broken. "missing separator."
```

```makefile
app: main.c
→   gcc main.c -o app     # ← a real TAB (shown here as →). This works.
```

**How to avoid it:**

- Configure your editor to insert a real tab inside Makefiles. In `.editorconfig`:
  ```ini
  [Makefile]
  indent_style = tab
  ```
- If unsure, check with `cat -A Makefile` — a tab shows as `^I`. A correct recipe line starts with `^I`.

This wart is so disliked that *avoiding it* is one of the reasons descendants like CMake and Meson exist — you write their config in a normal language and never touch a tab-sensitive recipe again.

---

## Core Concept 4 — Why Make Only Rebuilds What Changed

Make decides "stale or fresh" using **file modification timestamps** (mtime), nothing cleverer. The rule, precisely:

> A target is **out of date** (must rebuild) if it does not exist, **or** if any prerequisite has a newer mtime than the target.

```
main.c  mtime: 10:00
main.o  mtime: 10:05   → main.o is NEWER than main.c → main.o is fresh, skip
```

```
main.c  mtime: 10:10   ← you just edited it
main.o  mtime: 10:05   → main.c is NEWER than main.o → main.o is STALE, rebuild
```

This timestamp comparison is everything. It is also the source of Make's two most confusing behaviours, which you will hit eventually:

1. **"Nothing to be done" when you *did* change something.** Usually you changed a file Make doesn't know is a prerequisite (a header, say). Make can't rebuild based on a dependency you never told it about. (Tracking header dependencies is a [middle.md](middle.md) topic.)
2. **"Always rebuilds" when nothing changed.** Usually the target is never actually *created* as a file, so it never has a timestamp to compare — Make thinks it's perpetually missing. The fix is `.PHONY` (next section), or making sure the recipe really produces the file it claims to.

> **Key insight:** Make does not look *inside* files. It does not hash contents. It compares timestamps of files in a graph you defined. Almost every "Make is doing something weird" moment is really "the timestamps or the declared dependencies don't match reality." (Some descendants like Ninja and Bazel *do* hash contents — that's one problem they were built to fix.)

---

## Core Concept 5 — Phony Targets: `all`, `clean`, and Friends

Not every target is a file. Sometimes you want a *named action*: "delete the build outputs," "build everything," "run the tests." These are **phony targets** — targets that don't correspond to a real file.

```makefile
clean:
	rm -f app main.o math.o
```

Run `make clean` and it deletes the artifacts. But there's a trap. What if someone creates a file literally named `clean`?

```bash
$ touch clean        # now a file called "clean" exists
$ make clean
make: 'clean' is up to date.   # WRONG — it refused to run because the "target" exists
```

Make saw a file named `clean` with no prerequisites, decided it was up to date, and skipped the recipe. The fix is to *declare* such targets phony with the special `.PHONY` rule:

```makefile
.PHONY: all clean

all: app

clean:
	rm -f app main.o math.o
```

`.PHONY` tells Make: *"`all` and `clean` are not files — always run their recipes, never check timestamps."* Two conventions you'll see in almost every Makefile:

- **`all`** — the default "build everything" target. Listed first so plain `make` runs it.
- **`clean`** — remove all generated files to force a fresh build.

> **Key insight:** `.PHONY` is not optional polish — it's a correctness fix. Without it, a stray file with the same name as your action silently breaks your build. Declare every action target (`all`, `clean`, `test`, `install`, `run`) phony.

---

## Core Concept 6 — Running Builds in Parallel: `make -j`

By default Make builds one thing at a time. But look back at the graph — `main.o` and `math.o` depend on nothing in common. They could be compiled **simultaneously** on a multi-core machine. The `-j` flag enables that:

```bash
make -j8        # run up to 8 recipe jobs in parallel
make -j         # unlimited parallelism (use with care)
make -j$(nproc) # one job per CPU core (Linux); macOS: -j$(sysctl -n hw.ncpu)
```

Make uses the dependency graph to know what is *safe* to run at once: two targets can run in parallel if neither depends on the other. It will compile `main.o` and `math.o` together, then — once both finish — link `app`. On an 8-core laptop, `-j8` can cut a large build's time by a huge factor essentially for free.

> **Why this matters:** parallelism is *only* safe because you described the dependencies. If your Makefile lies about dependencies (says A doesn't depend on B when it secretly does), `-j` will expose the bug — A might build before B is ready, producing intermittent, maddening failures. **A correct dependency graph is the price of admission for safe parallelism.** This is a recurring theme: descendants like Ninja are built to extract *maximum* parallelism from a correct graph.

---

## Core Concept 7 — Make's Children at a Glance: Ninja, CMake, Meson

Make is the parent. Its descendants exist because, at scale, two different things about hand-written Make become painful — and each child fixes one of them.

**Problem A: Make is slow and awkward at large scale.** Parsing a huge Makefile and stat-ing thousands of files takes real time, and writing *correct* Make by hand (especially header dependencies and `.PHONY`) is error-prone.

→ **Ninja** is the fix. Ninja files are *not* meant to be written by hand — they're deliberately minimal and ugly. A tool generates them. Ninja's only job is to execute an already-computed dependency graph **as fast as physically possible**. It's the "do one thing, fast" descendant.

**Problem B: a Makefile is platform-specific and low-level.** It hardcodes `gcc`, Unix paths, `.o` extensions. It won't work on Windows with MSVC. And it describes *commands*, not your *project* ("I have a library `math` and a program `app` that uses it").

→ **CMake** and **Meson** are the fix. You write a high-level description of your *project* (targets, dependencies, where to find libraries). Then CMake/Meson **generate** the actual low-level build files — a Makefile, or (preferably) a Ninja file — appropriate for your platform and compiler.

```
You write:    CMakeLists.txt  (high-level: "app links against math")
                     │  cmake -B build      ← the "configure/generate" step
                     ▼
Generated:    build.ninja  (or Makefile)   (low-level, machine-written)
                     │  ninja  (or make)    ← the "build" step
                     ▼
Output:       app
```

This is the throughline of the entire family:

> **Hand-written Make** split into **two layers**: a *high-level project description* (CMake, Meson) on top, and a *fast low-level executor* (Ninja, or still Make) underneath — with a code-generator bridging them.

You will meet each tool properly in the higher tiers. For now, just hold the shape: CMake/Meson describe; Ninja/Make execute; nobody hand-writes the low-level part anymore.

---

## Real-World Examples

**1. The Linux kernel builds with Make.** One of the largest C codebases on Earth — millions of lines, thousands of files — uses GNU Make. Type `make` after editing one driver and it recompiles that driver and relinks, in seconds, not hours. This is incremental rebuilding doing its job at extreme scale. (It also uses sophisticated non-recursive Make patterns — a [senior.md](senior.md) topic.)

**2. The "it always rebuilds" mystery.** A beginner writes a target `run:` that compiles and runs the program, but never declares it `.PHONY`. As long as no file named `run` exists, it works. Then someone adds a `run` script to the repo — and `make run` silently stops compiling, just prints "up to date." Hours lost. The one-line fix: `.PHONY: run`.

**3. Why your favorite C++ project uses CMake + Ninja.** Open a modern C++ project (LLVM, KDE, most game engines) and you'll find a `CMakeLists.txt`, not a hand-written Makefile. You run `cmake -B build -G Ninja` once, then `ninja` to build. CMake handled "find the compiler, find the libraries, work on Windows and Linux"; Ninja handled "build it fast." Nobody wrote the `build.ninja` by hand — and that's exactly the point.

---

## Mental Models

- **Make is a lazy, forgetful assistant who only redoes work whose ingredients changed.** Hand it a recipe book (the Makefile) and timestamps on the ingredients. It checks: "Is the cake older than any ingredient I bought since? Then re-bake. Otherwise, the cake's fine, I'm not lifting a finger."

- **A Makefile is a graph, not a script.** A script is a list of steps run top to bottom. A Makefile is a *web of dependencies*; Make figures out the order and the subset itself. Stop reading it as "do this, then this."

- **The TAB is a landmine you defuse once.** Configure your editor for tabs-in-Makefiles and you never step on it again. Until then, `cat -A` shows you the truth (`^I` = tab).

- **Phony targets are verbs; file targets are nouns.** `app`, `main.o` are nouns (things that exist). `clean`, `all`, `test` are verbs (actions). Verbs must be `.PHONY` or a same-named file will silently disable them.

- **The descendants split Make in two.** One layer *describes the project* (CMake/Meson, human-friendly), one layer *executes the graph fast* (Ninja/Make, machine-friendly). Hold that two-layer shape and the whole family makes sense.

---

## Common Mistakes

1. **Indenting recipes with spaces.** The cause of `missing separator`. Recipe lines need a literal TAB. Use `cat -A` or an `.editorconfig` rule to be sure.

2. **Forgetting `.PHONY` on action targets.** `clean`, `all`, `test`, `run` must be declared phony, or a file with that name silently disables the recipe ("up to date" when you wanted it to run).

3. **Not declaring all the prerequisites.** If `main.c` includes `config.h` but your rule says only `main.o: main.c`, then editing `config.h` won't trigger a rebuild — Make doesn't know about the dependency. You get stale builds. (Auto-tracking headers is a [middle.md](middle.md) skill.)

4. **Expecting Make to look inside files.** Make compares **timestamps**, not contents. `touch`-ing a file (no edit) still triggers a rebuild; copying a file can reset timestamps and confuse it. Make sees mtimes, not meaning.

5. **Putting a non-default target first.** The first target is what plain `make` builds. If `clean` is first, `make` *cleans* instead of building. Put `all` (or your main artifact) first.

6. **Trying to hand-write a `build.ninja`.** Ninja files are generated, not authored. If you find yourself writing one by hand, you want CMake or Meson generating it instead.

---

## Test Yourself

1. What are the three parts of a Make rule, and what does each do?
2. You indented a recipe with spaces and got `missing separator. Stop.` — what's wrong and how do you confirm it?
3. You edit `math.c` and run `make`. `main.o` is *not* rebuilt but `app` is. Explain why, in terms of timestamps.
4. What does `.PHONY: clean` accomplish, and what breaks without it?
5. How does Make decide that two targets can be built in parallel with `-j`?
6. In one sentence each: what problem does Ninja solve, and what problem does CMake solve?

<details>
<summary>Answers</summary>

1. **Target** (the file to produce), **prerequisites** (files it depends on — rebuild if any is newer), and **recipe** (the TAB-indented shell commands that build it).
2. Recipe lines require a literal **TAB**, not spaces. Confirm with `cat -A Makefile`: a correct recipe line starts with `^I` (a tab); spaces show as spaces.
3. `main.c` was *not* modified, so `main.o` is still newer than `main.c` → fresh, skipped. `math.c` *was* modified → `math.o` rebuilt → `math.o` is now newer than `app` → `app` relinked. Make rebuilds a target only when a prerequisite's timestamp is newer.
4. It declares `clean` to be a *non-file* action, so Make always runs the recipe and never checks for an up-to-date file. Without it, a stray file named `clean` makes Make say "up to date" and skip the deletion.
5. Two targets can run in parallel if neither is (directly or transitively) a prerequisite of the other — i.e., they're independent in the dependency graph. Make derives this from the graph you declared.
6. **Ninja:** execute an already-computed dependency graph as fast as possible (it's generated, not hand-written). **CMake:** describe a project at a high, cross-platform level and *generate* the low-level build files (Makefile or Ninja).

</details>

---

## Cheat Sheet

```
RULE SHAPE
  target: prereq1 prereq2
  →   recipe-command          ← line MUST start with a TAB (→ = tab here)

CORE BEHAVIOUR
  rebuild target IF: it's missing, OR any prereq is NEWER (mtime) than it
  first target in file = default (plain `make` builds it)
  make some_target          build a specific target by name

THE TAB GOTCHA
  "missing separator. Stop." = you used spaces, not a TAB
  check it:  cat -A Makefile  → recipe lines should start with ^I

PHONY (action targets)
  .PHONY: all clean test run
  → always run recipe; never confused by a same-named file

COMMON TARGETS
  all      build everything (put first)
  clean    rm -f the generated files
  test     run the tests

PARALLEL
  make -j8            up to 8 jobs at once
  make -j$(nproc)     one per CPU core (Linux)
  (safe ONLY if dependencies are declared correctly)

THE FAMILY (two layers)
  describe project (high level):  CMakeLists.txt / meson.build   → CMake, Meson
  execute graph    (low level) :  Makefile / build.ninja         → Make, Ninja
  CMake/Meson GENERATE the low-level file; you don't hand-write build.ninja
  flow:  cmake -B build -G Ninja   →   ninja
```

---

## Summary

- **Make** reads a `Makefile` and rebuilds only the targets whose prerequisites changed, using **file timestamps** to decide. That single idea — describe a dependency graph, redo only the stale parts — is why it has survived since 1976.
- A **rule** is `target: prerequisites` plus a TAB-indented **recipe**. Make treats the whole file as a **graph** and walks it bottom-up, touching only stale nodes.
- The **TAB gotcha** (`missing separator`) bites everyone once: recipe lines need a literal tab, not spaces.
- **Phony targets** (`all`, `clean`, `test`) are named actions, not files. Declare them with `.PHONY` or a same-named file silently breaks them.
- **`make -j`** runs independent targets in parallel — but only safely if your dependency graph is honest.
- Make's **descendants** split it into two layers: a *high-level project description* (**CMake**, **Meson**) that **generates** a *fast low-level executor's* input (**Ninja**, or Make). Nobody hand-writes the low-level part anymore.

You now know what Make does and why a family of tools grew around it. The [middle.md](middle.md) page turns this into real skill: automatic variables, pattern rules, header-dependency tracking, the "recursive make considered harmful" problem, and reading a generated `build.ninja`.

---

## Further Reading

- [GNU Make Manual — "An Introduction to Makefiles"](https://www.gnu.org/software/make/manual/make.html#Introduction) — the canonical, surprisingly readable reference.
- *Managing Projects with GNU Make* (Robert Mecklenburg, O'Reilly) — the standard book; the early chapters cover everything on this page.
- [Ninja manual — "Design goals"](https://ninja-build.org/manual.html#_design_goals) — one page that explains *why* Ninja is deliberately minimal.
- [CMake Tutorial — Step 1](https://cmake.org/cmake/help/latest/guide/tutorial/index.html) — the official "your first CMakeLists.txt."

---

## Related Topics

- [01 — Build Fundamentals](../01-build-fundamentals/junior.md) — compile vs link; *why* splitting compilation per file is what makes Make's incrementality possible.
- [02 — Dependency Graphs](../02-dependency-graphs/junior.md) — the formal idea Make is built on: nodes, edges, and "rebuild if a dependency is newer."
- [04 — Per-Language Tools](../04-per-language-tools/junior.md) — how `cargo`, `go build`, and Gradle hide Make-like logic behind one command.
- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/junior.md) — where Bazel and Buck take the descendants beyond what Make/CMake can do.
- [middle.md](middle.md) — automatic variables, pattern rules, header dependencies, recursive-make, and reading a generated Ninja file.
