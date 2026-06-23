# Make & Descendants — Interview Preparation

> **Roadmap:** [Build Systems](../README.md) → Make & Descendants
> *Build-system questions are deceptively revealing. Anyone can recite "Make rebuilds what changed." The signal is whether you understand the dependency-graph and timestamp model well enough to debug a build that's lying to you — and whether you know why an entire family of tools grew up to replace hand-written Make.*

---

## Table of Contents

1. [How Build Questions Are Used in Interviews](#how-build-questions-are-used-in-interviews)
2. [Group 1 — Make Mechanics](#group-1--make-mechanics)
3. [Group 2 — Automatic Variables & Pattern Rules](#group-2--automatic-variables--pattern-rules)
4. [Group 3 — Incrementality & the Timestamp Model](#group-3--incrementality--the-timestamp-model)
5. [Group 4 — Recursive Make](#group-4--recursive-make)
6. [Group 5 — Ninja](#group-5--ninja)
7. [Group 6 — CMake & Meson as Generators](#group-6--cmake--meson-as-generators)
8. [Group 7 — Tool Selection](#group-7--tool-selection)
9. [Group 8 — Advanced Make & Correctness](#group-8--advanced-make--correctness)
10. [Debugging Scenarios](#debugging-scenarios)
11. [Rapid-Fire Round](#rapid-fire-round)
12. [Red Flags Interviewers Listen For](#red-flags-interviewers-listen-for)
13. [Closing Advice](#closing-advice)
14. [Related Topics](#related-topics)

---

## How Build Questions Are Used in Interviews

Build-system questions appear in three contexts, and knowing which you're in shapes your answer:

- **Systems / infra / platform roles** — direct and deep. Expect "design our build," "debug this Makefile," "why is CI slow." They want the dependency-graph model and correctness reasoning, not trivia.
- **Backend / C++ / embedded roles** — practical. "Walk me through your project's build," "why does this always rebuild," "static vs shared libs." Tied to [01 — Build Fundamentals](../01-build-fundamentals/junior.md).
- **Senior/staff design rounds** — judgment. "When would you adopt Bazel," "how do you migrate off recursive Make," "how do you keep a build correct across a team." They're testing whether you treat the build as infrastructure.

The unifying skill being probed is **mental-model depth**: do you actually know that Make compares timestamps over a graph you declared, or do you just know the incantations? Every good question is designed to separate those two.

> **Throughout, each question lists "What's really being tested" — the interpretation under the question. Answer *that*, not just the literal words.**

---

## Group 1 — Make Mechanics

**Q1.1 — What does Make actually do? Explain its core algorithm in a few sentences.**

> *What's really being tested:* whether you have the model or just usage.

Make reads a `Makefile` describing a dependency graph of **targets**, **prerequisites**, and **recipes**. For each target it needs, it checks: does the target file exist, and is it newer than all its prerequisites? If the target is missing or any prerequisite has a **newer modification time**, Make runs the recipe to rebuild it; otherwise it does nothing. It walks the graph bottom-up so prerequisites are brought up to date first. Crucially, Make understands **files and timestamps**, not compilers — everything else is you telling it which command turns one file into another.

---

**Q1.2 — What are the three parts of a Make rule?**

**Target** (the file produced, before the `:`), **prerequisites** (files it depends on, after the `:` — rebuild if any is newer), and the **recipe** (TAB-indented shell commands that build it). The first target in the file is the **default** that plain `make` builds. Worth knowing: a rule with prerequisites but *no* recipe just adds dependency edges (you can spread one target's prerequisites across several such rules), and a rule with a recipe but no prerequisites (other than phony) always runs when invoked.

---

**Q1.2b — Read this Makefile aloud. What does `make` do the first time, and the second time with nothing changed?**

```makefile
app: main.o util.o
	gcc $^ -o $@
%.o: %.c
	gcc -c $< -o $@
```

First run: there are no `.o` files and no `app`, so Make builds `main.o` (from `main.c`), `util.o` (from `util.c`) via the pattern rule, then links `app` from both — bottom-up. Second run with nothing changed: each `.o` is newer than its `.c`, and `app` is newer than both objects, so Make prints "`app` is up to date" and runs nothing. The interviewer is checking that you can trace the graph and the timestamp comparison by hand, not just recite the algorithm.

---

**Q1.3 — Why does Make require a TAB before recipe lines, and what's the error if you use spaces?**

> *What's really being tested:* have you actually used Make, or only read about it?

It's a historical design wart: Make distinguishes recipe lines from other lines by a leading literal TAB. Use spaces and you get `missing separator. Stop.` — which really means "I expected a tab here." Confirm with `cat -A Makefile`; recipe lines should start with `^I`. (This wart is one of the small reasons descendants like CMake/Meson, whose configs aren't tab-sensitive, became popular.)

---

**Q1.4 — What is a `.PHONY` target and why does it matter?**

A phony target is a named *action* that isn't a real file (`clean`, `all`, `test`, `run`). Declaring `.PHONY: clean` tells Make to *always* run the recipe and never check for an up-to-date file. Without it, if a file named `clean` ever exists, Make sees it as "up to date" and silently skips the recipe — a correctness bug, not a style issue. A strong answer adds the flip side: a *real* file should never depend on a phony target, because phony targets are treated as always-newer and would force perpetual rebuilds.

---

**Q1.5 — What does `make -j` do, and what's the prerequisite for using it safely?**

`-j[N]` runs up to N recipe jobs in parallel (`-jN`, or `-j$(nproc)` for one per core). Make derives what's safe to parallelize from the dependency graph: two targets can run concurrently if neither depends on the other. **The prerequisite for safety is a complete, honest dependency graph** — if a target secretly depends on another but you didn't declare the edge, `-j` may run them in the wrong order, producing intermittent failures. So `-j` is also a correctness test for your graph.

---

**Q1.6 — Why is the *first* target in a Makefile special, and how do you build a non-first target?**

The first target is the **default goal** — running plain `make` with no arguments builds it. Convention is to put `all` (or your main artifact) first so `make` does the obvious thing. To build any other target, name it: `make clean`, `make test`, `make foo.o`. (You can also override the default with the `.DEFAULT_GOAL` variable.) A common bug: putting `clean` first, so a bare `make` *cleans* instead of building.

---

**Q1.7 — What does `make` do if a recipe command fails (non-zero exit)?**

By default it **stops immediately** — Make aborts the build on the first failed command, so you don't proceed on a broken artifact. You can prefix a command with `-` to ignore its failure (`-rm -f foo`, useful in `clean`), or pass `-k` ("keep going") to build as much as possible despite failures (handy in CI to surface *all* errors at once). Knowing the default is "fail fast" — and that recipe lines run in *separate shells* unless joined with `\` or `.ONESHELL` — separates real users from readers.

---

## Group 2 — Automatic Variables & Pattern Rules

**Q2.1 — What do `$@`, `$<`, and `$^` mean?**

`$@` = the **target**; `$<` = the **first prerequisite** (usually the source); `$^` = **all prerequisites** (deduplicated, used for the link step). They let recipes refer to names abstractly instead of hardcoding them — which is the precondition for pattern rules. A complete answer adds the two others worth knowing: `$?` = prerequisites *newer than the target* (useful for incremental archive updates), and `$*` = the **stem** matched by `%` in a pattern rule. The reason they matter beyond convenience: you cannot write a single generic rule for *all* `.o` files unless the recipe can say "the target" and "the source" without naming them — so automatic variables are what make pattern rules possible at all.

---

**Q2.2 — Write a pattern rule that compiles any `.c` into its `.o`.**

```makefile
%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@
```

The `%` is the **stem**; both `%`s match the same stem, so `main.o` matches with stem `main` and prerequisite `main.c`. One rule covers every object file in the project. A good follow-up answer: Make ships with *built-in* pattern rules (including this one), which is why some tiny Makefiles compile C with no recipe written at all (`make -p` dumps them).

---

**Q2.3 — What's the difference between `:=` and `=` in a Makefile?**

> *What's really being tested:* awareness of a real footgun.

`:=` is **simple expansion** — the right-hand side is evaluated once, immediately. `=` is **recursive expansion** — re-evaluated every time the variable is *used*, which can be surprising (and slow) if the RHS references other variables that change. Default to `:=` unless you specifically need lazy evaluation. The classic footgun: `CFLAGS = $(shell expensive-command)` with `=` re-runs that shell command on *every* reference; with `:=` it runs once. There's also `?=` (assign only if not already set, common for user-overridable defaults like `CC ?= gcc`) and `+=` (append). Knowing `:=` is the safe default — and *why* — is the signal here.

---

**Q2.4 — How would you avoid maintaining a source-file list by hand?**

Use functions: `SRCS := $(wildcard *.c)` to glob, then `OBJS := $(SRCS:.c=.o)` (or `$(patsubst %.c,%.o,$(SRCS))`) to derive object names. A complete answer names the trade-off: `wildcard` makes adding/removing files automatic but *invisible* — a deleted source silently drops from the build with no review. Some teams list sources explicitly precisely so file additions are deliberate, reviewable changes.

---

## Group 3 — Incrementality & the Timestamp Model

**Q3.1 — How does Make decide whether to rebuild a target?**

It compares **modification times (mtimes)**. A target is rebuilt if it doesn't exist, or if **any prerequisite has a newer mtime** than the target. Make does *not* hash contents or look inside files — it's purely a timestamp comparison over the declared graph. This is the single most important fact, because nearly every "Make is acting weird" situation is a mismatch between timestamps/declared-deps and reality.

---

**Q3.2 — You edit a header file, rebuild, and the binary still has the old behavior even though Make said it built. What happened?**

> *What's really being tested:* the #1 silent Make bug.

A **missing header dependency**. The rule declares the object depends on `foo.c` but not on the `config.h` that `foo.c` includes. Editing the header doesn't change `foo.c`'s mtime, so Make sees the object as fresh and skips the rebuild — you get a **stale-but-green** build compiled against the old header. The fix is compiler-generated dependencies: compile with `-MMD -MP`, collect the emitted `.d` files, and `-include $(DEPS)` so the compiler's discovered headers enter Make's graph. This is *the* answer that signals you've maintained real C/C++ Makefiles.

---

**Q3.3 — Why does Make sometimes say "Nothing to be done" when you definitely changed a file?**

Either (a) the file you changed isn't a declared prerequisite of any target Make is asked to build (so Make can't know), or (b) you asked for a target whose file is already newer than its prerequisites. Most commonly it's an undeclared dependency. Diagnose with `make -d` (debug) to see exactly why Make considered each target up to date.

---

**Q3.4 — Name two ways Make's timestamp model can give a wrong answer even when dependencies are fully declared.**

> *What's really being tested:* senior-level awareness that mtime is a fragile proxy.

(1) **Clock skew / VCS checkout** — Git sets mtime to checkout time, not commit time; a fresh clone or an NFS/container clock difference can make an output appear newer or older than reality, masking or forcing rebuilds. (2) **Sub-second granularity** — if a build step finishes within the filesystem's mtime resolution (e.g. 1s), input and output get the *same* timestamp and Make can't tell stale from fresh. (Bonus: a flag change rebuilds nothing because it changes no file's mtime.) These are why descendants moved toward command-hashing (Ninja) and content-hashing + hermeticity (Bazel).

---

## Group 4 — Recursive Make

**Q4.1 — What is "recursive make" and why is it considered harmful?**

> *What's really being tested:* whether you know the most influential idea in build tooling.

Recursive make is the pattern where a top-level Makefile loops over subdirectories running `$(MAKE) -C subdir` — each subdirectory has its own Makefile and its own Make invocation. Peter Miller's 1997 paper *"Recursive Make Considered Harmful"* showed the core flaw: **each invocation sees only its own subdirectory's dependency graph, never the whole project's.** Consequences: cross-directory dependencies are invisible, so build order is wrong or relies on hand-sequencing; `-j` can't parallelize across the boundary; and each sub-make redundantly re-parses and re-stats, making it slow. The fix is **non-recursive make**: one Make process that `include`s fragment Makefiles from each subdirectory, assembling *one complete graph*.

---

**Q4.2 — So is recursion itself the problem?**

No — the problem is **fragmenting the dependency graph across processes**. A correct incremental build needs one complete graph so it can compute correct order and full parallelism. This realization is the seed of every descendant: Ninja executes a single precomputed graph; CMake/Meson generate one; Bazel enforces a global graph by construction. Naming this — "it's about graph completeness, not recursion" — is what distinguishes a memorized answer from an understood one.

---

## Group 5 — Ninja

**Q5.1 — What is Ninja and how is it different from Make?**

Ninja is a low-level build *executor*. Unlike Make, it deliberately has **no high-level features** — no pattern rules, no wildcards, no functions or conditionals — and its files are **machine-generated, not hand-written**. Its one job is to execute an already-computed dependency graph as fast as possible. Make tries to be both a *language for describing builds* and an *engine for running them*; Ninja keeps only the engine and optimizes it ruthlessly.

It was written for Chromium, where even *correct* non-recursive Make was too slow — the diagnosis being that Make's dual role (language + engine) made it both slow to parse and easy to get wrong. Ninja's answer was to be only the engine.

---

**Q5.2 — Why is Ninja so fast, and why is its minimalism a feature?**

> *What's really being tested:* do you understand design-by-restriction.

Because it forbids build-time computation, the **entire graph is known before any work starts** — Ninja never globs or evaluates anything to *discover* the graph; it only stats known files. So a no-op build of a huge project reads the graph, checks mtimes against a build log, and returns in well under a second. The minimalism *is* the speed: "Ninja is fast" and "Ninja is dumb" are the same sentence. It also records the **exact command** used to produce each output, so a flag change (from the generator) forces a rebuild — closing a hole Make has.

---

**Q5.3 — Should you ever write a `build.ninja` by hand?**

No. Its verbosity (an explicit `build` line per output, no abstraction) is intentional — it's output for a *generator* (CMake/Meson) to produce, freeing the generator to use a pleasant high-level language. If you find yourself hand-writing Ninja, you want CMake or Meson generating it instead.

---

**Q5.4 — How does Ninja handle header dependencies, given it has no pattern rules or functions?**

The same way the generator wires it: each `build` edge can name a `depfile` (the compiler's `-MMD`-generated `.d` file) or use `deps = gcc`/`deps = msvc` so Ninja parses the compiler's dependency output directly into its own fast database. So Ninja *does* track headers correctly — it just relies on the compiler to discover them and on the generator to declare the mechanism, rather than computing anything itself. This is the same underlying `-MMD` trick Make uses; Ninja just stores the result more efficiently.

---

## Group 6 — CMake & Meson as Generators

**Q6.1 — What is CMake, and what does it produce?**

> *What's really being tested:* the "meta-build / generator" concept.

CMake is a **meta-build system**: you describe your project at a high, cross-platform level in `CMakeLists.txt` (targets and their relationships — *not* commands), and CMake **generates** the native low-level build files for your platform and toolchain — a Ninja file, a Makefile, a Visual Studio solution, an Xcode project. You don't tell it `gcc` or `.o`; you say "there's a library `math` and an executable `app` that links it," and CMake figures out the rest. The throughline of the whole family: hand-written Make split into a *high-level project description* (CMake/Meson) on top and a *fast low-level executor* (Ninja/Make) underneath, with a generator bridging them.

---

**Q6.2 — Walk me through the phases of a CMake build.**

Three phases: **Configure** — `cmake -S . -B build` runs `CMakeLists.txt` as a script, detects the compiler, probes the system (`find_package`, feature checks), builds the in-memory target graph, and caches decisions in `CMakeCache.txt`. **Generate** — the same command emits the chosen generator's files (`build.ninja`). **Build** — `cmake --build build` (or `ninja -C build`) runs those files. Knowing these are distinct is the diagnostic for almost every CMake problem: ask *which phase* failed.

---

**Q6.3 — What's the difference between `PRIVATE`, `PUBLIC`, and `INTERFACE` in `target_link_libraries`?**

> *What's really being tested:* modern vs legacy CMake.

They scope a target's **usage requirements** (include dirs, compile features, link deps) and control what *propagates* to consumers: `PRIVATE` = needed to build this target only; `INTERFACE` = not needed here but propagated to consumers (header-only libs); `PUBLIC` = both. Modern target-based CMake relies on this so a consumer that links a library *automatically inherits* its `PUBLIC` requirements — no global `include_directories()` or `CMAKE_CXX_FLAGS`. Mentioning that global-variable CMake is the legacy anti-pattern is a strong signal.

---

**Q6.4 — What is Meson and how does it relate to CMake and Ninja?**

Meson is a modern meta-build system that generates **Ninja** (so it inherits Ninja's speed and never tries to be an execution engine). Versus CMake: it uses a deliberately **restricted, non-Turing-complete DSL** (declarative and readable by design, no user functions), enforces sane defaults and out-of-source builds, and has first-class dependency fetching (wraps). The trade-off is ecosystem gravity — CMake is the de facto standard with vastly more `find_package` modules and existing projects, so a public C++ library usually still ships CMake despite Meson's cleaner language.

---

**Q6.5 — A teammate edits a generated `Makefile` to fix the build. What do you say?**

Revert it. Generated files are overwritten on the next configure/generate; the change must go in the *source* (`CMakeLists.txt`/`meson.build`). Hand-editing generated output is a guaranteed-to-be-lost fix and a code-review red flag.

---

**Q6.6 — You've seen `./configure && make && make install`. What is that, and how does it relate to CMake?**

That's **Autotools** (autoconf/automake) — the historical GNU meta-build. `./configure` is a generated shell script that *probes the system* (does this header exist? what's `sizeof(long)`? which libraries are present?) and emits a platform-specific `Makefile`; then `make` builds and `make install` copies artifacts into place. It's the *original* "configure step generates the build" idea — CMake and Meson are its conceptual successors. Why it's painful: the configure scripts are enormous generated M4/shell, agonizingly slow, hard to debug, and the M4 macro language is famously inscrutable. CMake won largely by doing the same configure-then-build job with a saner language, real cross-platform (including Windows/MSVC, which Autotools never handled well) and multiple generator backends. Recognizing `./configure` as "the same configure/generate/build pattern, older and clunkier" is the connective-tissue answer.

---

## Group 7 — Tool Selection

**Q7.1 — When would you choose Make vs CMake vs Meson vs Bazel?**

> *What's really being tested:* judgment, not favorites.

- **Make** (non-recursive): small/medium, Unix-only, Make-fluent team. Lowest barrier.
- **CMake**: C/C++ that *others must consume* via `find_package` — it's the ecosystem standard; correct exported targets matter more than language quality.
- **Meson**: greenfield C/C++ where you value a clean, readable build and can accept a smaller ecosystem.
- **Ninja**: always the *backend* under CMake/Meson (`-G Ninja`), never alone.
- **Bazel/Buck** ([05](../05-polyglot-hermetic-builds/junior.md)): large polyglot monorepo needing hermeticity, a shared remote cache, and remote execution — where Make's mtime/non-hermetic model breaks.

The pivotal axis is usually **library-for-others (lean CMake) vs application-for-us (freer choice)**, plus team fluency, platforms, and scale.

A weak answer names a favorite tool; a strong answer names the *axis the decision turns on* and the migration cost if you're wrong. "It depends" is acceptable here only if you then say *on what*.

---

**Q7.2 — When is it worth escaping the entire Make family for Bazel?**

When the problem *category* shifts from "fast, correct, local *incremental* build" to "hermetic, content-hashed, *distributed/cached/polyglot* build." Concrete triggers: a polyglot monorepo CMake is being bent to orchestrate; needing a *shared* remote cache (which requires hermetic, content-addressed inputs — impossible under Make's mtime model); a hard reproducibility/hermeticity requirement; build time as an org-level bottleneck. Bazel has a real adoption tax (BUILD-per-package, sandboxing), so the escape is justified only when those symptoms are real and costly — adopting too early is as much a mistake as clinging too long.

---

**Q7.3 — How do you keep a build correct and fast across a 100-engineer team over years?**

> *What's really being tested:* do you treat the build as infrastructure, not a file.

Treat it as **shared production infrastructure**: give it an owner and an escalation path; review changes to it with blast-radius scrutiny (a flag change is a behavior change; a new dependency is a supply-chain decision). In CI, run not just incremental builds but a periodic **clean build** and a **clean-vs-incremental artifact diff** to catch the stale-but-green class, and verify a fresh checkout builds from zero. **Track build time as a metric** — both clean and no-op — because a 10% regression taxes every engineer on every commit. Pin and enforce the toolchain (`cmake_minimum_required`, compiler-version checks) so it doesn't silently drift. The mindset shift is the answer: the build is the highest-leverage shared file in the repo.

---

## Group 8 — Advanced Make & Correctness

**Q8.1 — What's the difference between a normal prerequisite and an order-only prerequisite?**

A normal prerequisite triggers a rebuild if it's *newer* than the target. An **order-only prerequisite** (written after a `|`, e.g. `build/%.o: src/%.c | build`) must merely *exist before* the target builds, but its timestamp is ignored for staleness. The canonical use is an output directory: you need `build/` to exist before compiling, but you don't want every object to recompile just because adding a file bumped the directory's mtime. Mixing the two — making a directory a normal prerequisite — is a classic cause of "why does everything rebuild when I add a file?"

**Q8.2 — Why can two source files each define a `static` function named `helper` without a linker conflict, and how does that relate to Make?**

`static` at file scope gives **internal linkage** — the symbol is private to its translation unit and never enters the linker's view ([01 — Build Fundamentals › middle](../01-build-fundamentals/middle.md)). It's not directly a Make question, but it's the kind of "do you understand what the recipes Make runs actually *do*" probe that separates someone who orchestrates a build from someone who only types `make`. Make doesn't know or care about symbols; it runs the compiler/linker and checks file timestamps.

**Q8.3 — A recipe has multiple lines. Do they share shell state (variables, `cd`)?**

By default, **no** — each recipe line runs in its own shell, so a `cd` or shell variable on line 1 is gone by line 2. To share state, join lines with `\` (one logical command), use `&&` chaining, or enable `.ONESHELL` (whole recipe in one shell). This trips up people who write `cd subdir` then expect the next line to be in `subdir`. It's also why `$$` is needed to pass a literal `$` to the shell — Make expands `$` first.

---

## Debugging Scenarios

These are the questions that most separate candidates. Reason out loud; the *method* is the signal.

**D1 — "This target always rebuilds, even when nothing changed. Why?"**

Walk the hypotheses:
1. **It's an undeclared phony / missing output file.** The recipe never actually creates the file named by the target (or creates a differently-named file), so the target is *always* "missing" → always rebuilt. Either fix the recipe to produce the file, or if it's a true action, declare it `.PHONY` (and stop other targets from depending on it).
2. **A prerequisite is itself phony or always-regenerated**, so it's perpetually "newer."
3. **Clock skew / sub-second mtime** making the output never appear newer than its inputs.
4. **The recipe touches the target with an old timestamp** (e.g. `cp -p` preserving an older mtime).

Diagnose with `make -d` (or `--debug=v`) — it prints *why* it decided to rebuild each target.

---

**D2 — "`make` says 'Nothing to be done' but I just edited a source file. Why?"**

The inverse problem — Make thinks it's fresh when it's stale:
1. **The edited file isn't a declared prerequisite** of the target (the classic missing-header case) → add the dependency, ideally via `-MMD -MP` auto-generation.
2. **You asked for the wrong target**, or the default target doesn't depend on what you changed.
3. **mtime didn't actually advance** — clock skew, or you edited on a different machine/filesystem whose clock is behind. `stat` the file and the target to compare.
4. **Sub-second build granularity** gave input and output equal timestamps.

`make -d` again; it tells you the comparison it made.

---

**D3 — "The build is green in CI but the deployed binary is subtly wrong / stale. How do you find it?"**

This is the **stale-but-green** class — an incremental build skipping work it shouldn't because of an **undeclared dependency** (header, generated file, flag, or tool version). The reliable detector: run a **clean build** (`make clean && make`) and **diff its artifacts** against the incremental build's. Any difference is an undeclared input. Long-term fix: turn that diff into a CI check so the bug can't hide again.

---

**D4 — "The build passes on laptops but fails intermittently on the 64-core build farm. What's going on?"**

An **undeclared dependency edge** exposed by parallelism. Low `-j` on laptops happened to schedule the dependent target after its (undeclared) producer; high `-j` on the farm sometimes runs them concurrently or out of order → intermittent failure. `-j` doesn't *cause* the race; it *reveals* the lie already in the graph. Fix: declare the missing edge. Reproduce locally with a high `-j` and `make --shuffle` (where available) to surface ordering bugs.

---

**D5 — "After upgrading the compiler, CMake gives bizarre link errors on some machines but not others. What do you check first?"**

A stale/corrupt **`CMakeCache.txt`**. It froze the *old* compiler path and detected features at first configure; machines with an old `build/` directory are still using them, while freshly-cloned machines are fine. Don't debug the link errors — `rm -rf build && cmake -B build` to re-configure from scratch. Make "blow away `build/` on toolchain changes" a team policy.

---

**D6 — "We changed `CFLAGS` from `-O2` to `-O3` in the Makefile, but the binary didn't get faster — it seems like nothing recompiled. Why?"**

Make decides solely on **file mtimes**, and changing a *variable* in the Makefile changes no source file's timestamp — so Make sees every object as still fresh and recompiles nothing. The old `-O2` objects are simply relinked. This is a real Make limitation. Fixes: force a clean rebuild (`make clean && make`), or encode the flags into a tracked file (e.g. write `CFLAGS` to a `.flags` file and make objects depend on it, rebuilding when it changes). A strong answer notes this is one thing **Ninja gets right for free** — it records the exact command line per output, so a generator-driven flag change triggers a rebuild automatically.

---

**D7 — "Our CMake project builds with `make` locally but a colleague's `ninja` build behaves differently. How is that possible if it's the same `CMakeLists.txt`?"**

First confirm they configured the *same* generator into the *same* build directory — `cmake -B build -G "Unix Makefiles"` and `cmake -B build -G Ninja` write *different* files into `build/`, and a directory configured for one generator can't be driven by the other. If the build dirs differ but the `CMakeLists.txt` is identical, the likely culprits are **configure-time differences**: different cached options in each `CMakeCache.txt`, different detected compilers/library versions on the two machines, or a `find_package` resolving to different installed packages. The diagnostic is to compare the two `CMakeCache.txt` files (or `cmake -LAH build`) — most "same source, different build" puzzles are really "different *configure* results," which is exactly why CMake's configure phase is the first place to look. Generated low-level files (`Makefile` vs `build.ninja`) should produce identical *artifacts* given identical configure inputs; if they don't, suspect an undeclared dependency or a generator-specific bug, not the source.

---

## Rapid-Fire Round

Quick, confident one-liners:

- **Default target?** The first target in the Makefile.
- **`$@` vs `$<` vs `$^`?** Target / first prereq / all prereqs.
- **`:=` vs `=`?** Simple (eval once) vs recursive (eval on every use).
- **Symptom of a missing `.PHONY`?** A same-named file makes Make say "up to date" and skip the action.
- **What does Make compare to decide staleness?** Modification timestamps (mtimes), not contents.
- **One paper to know?** "Recursive Make Considered Harmful," Miller, 1997.
- **What does Ninja refuse to do?** Compute anything at build time (no wildcards/functions) — it only executes a precomputed graph.
- **Who writes `build.ninja`?** A generator (CMake/Meson), never a human.
- **CMake's three phases?** Configure, generate, build.
- **Fix for a corrupt CMake cache?** Delete `build/` and re-configure.
- **`PUBLIC`/`PRIVATE`/`INTERFACE`?** Propagated+local / local only / consumers only.
- **Meson generates what?** Ninja.
- **When Bazel?** Hermetic, cached, distributed, polyglot — when the Make family's mtime/non-hermetic model breaks.
- **Why is `-j` a correctness test?** It exposes any dependency edge you failed to declare.
- **`./configure && make && make install` is what tool?** Autotools (autoconf/automake) — the historical configure/generate/build ancestor of CMake.
- **What is `make -d` for?** Debug output: it prints *why* Make decided to (not) rebuild each target — the first tool for "always rebuilds" / "nothing to do" bugs.
- **What does a leading `-` on a recipe command mean?** Ignore that command's failure (common in `clean`).
- **What does `make -k` do?** Keep going after errors — build as much as possible; useful in CI to surface all failures at once.
- **Order-only prerequisite syntax?** After a `|`: `target: src | dir` — `dir` must exist but its mtime doesn't trigger a rebuild.
- **Do recipe lines share shell state?** No — each line runs in its own shell unless joined (`\`), chained (`&&`), or `.ONESHELL` is set.
- **Why `$$` in a recipe?** To pass a literal `$` to the shell; Make expands `$` first.
- **What does `-MMD -MP` do?** Compiler emits Make-format header dependencies (`.d`); `-MP` adds phony targets so deleting a header doesn't error.
- **Autotools' worst pain point?** Slow, inscrutable generated M4/shell `configure` scripts; poor Windows support — why CMake displaced it.
- **Meson's language design choice?** Deliberately non-Turing-complete/declarative for readability and analyzability.

---

## Red Flags Interviewers Listen For

- **"Make compiles my code."** Make doesn't compile anything; it runs recipes based on a timestamp/graph model. This phrasing reveals a missing mental model.
- **Treating "it builds" as "it's correct."** No mention of stale-but-green or clean-vs-incremental checking signals you've never been burned by an incremental build, i.e. never operated one at scale.
- **Recommending Bazel reflexively.** "Just use Bazel" for a small single-language project shows no awareness of its adoption tax. Judgment means naming the trade-off.
- **Hand-writing `build.ninja`** or proposing to edit generated files — fundamental misunderstanding of the generator/executor split.
- **Blaming `-j` for race conditions.** The race was always there; `-j` revealed it. Blaming parallelism instead of the missing edge is the wrong instinct.
- **Not knowing the recursive-make problem.** It's the most-cited result in build tooling; not knowing it (or thinking recursion itself is the issue rather than graph fragmentation) caps the conversation.

---

## Closing Advice

Three things carry most build-system interviews:

1. **Lead with the model, not the syntax.** "Make compares timestamps over a dependency graph I declared" answers more questions than memorized flags, and signals real understanding.
2. **Make correctness your default frame.** The most impressive answers are about *stale-but-green* builds, undeclared dependencies, and how `-j` and clean-vs-incremental diffs expose them. That's the difference between someone who *used* a build and someone who *operated* one.
3. **Explain the family as a story.** Hand-written Make → "graph must be complete" (recursive-make paper) → split into generated low-level executor (Ninja) + high-level description (CMake/Meson) → hermetic/distributed (Bazel). If you can tell *why each tool exists*, you'll out-answer candidates who just list features.

For the underlying mechanics, revisit [01 — Build Fundamentals](../01-build-fundamentals/junior.md) (compile vs link) and [02 — Dependency Graphs](../02-dependency-graphs/middle.md) (the incrementality model). For where the family ends, [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/junior.md).

One last framing: when an interviewer hands you a Makefile or a build-failure story, narrate the **graph and the timestamps** out loud. "Make will check whether `app` is newer than `main.o` and `util.o`; `main.o` depends on `main.c`, so…" — that running commentary *is* the demonstration of the mental model they're listening for. Silent correct answers score lower than reasoned ones.

---

## Related Topics

- [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md) — the full depth behind every answer here.
- [01 — Build Fundamentals](../01-build-fundamentals/junior.md) — compile vs link, the pipeline Make orchestrates.
- [02 — Dependency Graphs](../02-dependency-graphs/middle.md) — the formal incrementality model the whole family executes.
- [04 — Per-Language Tools](../04-per-language-tools/junior.md) — how `cargo`/`go build`/Gradle internalize these ideas.
- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/junior.md) — Bazel/Buck, where the Make family's model ends.
