# Make & Descendants — Senior Level

> **Roadmap:** [Build Systems](../README.md) → Make & Descendants
> *The middle page made Make correct and introduced its descendants. This page is about judgment: where Make's correctness model actually fails, why Ninja's minimalism is a feature and not a limitation, what CMake's three phases really do, how Meson made different choices, and how a senior engineer chooses among them rather than cargo-culting whatever the last project used.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Make's Correctness Failure Modes](#makes-correctness-failure-modes)
4. [Non-Recursive Make at Scale](#non-recursive-make-at-scale)
5. [Ninja's Design Philosophy: Execute a Precomputed Graph, Fast](#ninjas-design-philosophy-execute-a-precomputed-graph-fast)
6. [CMake Internals: Configure vs Generate vs Build](#cmake-internals-configure-vs-generate-vs-build)
7. [Modern Target-Based CMake and Usage Requirements](#modern-target-based-cmake-and-usage-requirements)
8. [Toolchain Files and Cross-Compilation](#toolchain-files-and-cross-compilation)
9. [Meson's Design Choices](#mesons-design-choices)
10. [Choosing Among Them](#choosing-among-them)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What are the real correctness and design trade-offs across the Make family, and how do you choose?**

A senior engineer's relationship with build tools is not "I can write a Makefile." It's "I know exactly how this tool's correctness model can lie to me, I know why each descendant exists, and I can pick the right one for a given project and defend the choice in a design review."

This page covers the three things that distinguish that level. First, **Make's correctness failure modes** — the ways an incremental build can be *wrong* while reporting success, which is far more dangerous than a build that visibly fails. Second, the **design philosophies** of the descendants — not just "Ninja is fast" but *why* its minimalism is the source of that speed and correctness. Third, **selection judgment** — the actual decision matrix among Make, Ninja-via-generator, CMake, and Meson, with the trade-offs that matter in practice.

---

## Prerequisites

- **Required:** [middle.md](middle.md) — pattern rules, generated header deps, the recursive-make problem, reading `build.ninja`, CMake as a generator.
- **Required:** Comfort with the dependency-graph model and incrementality from [02 — Dependency Graphs](../02-dependency-graphs/middle.md).
- **Helpful:** You've maintained a multi-thousand-line build configuration and felt where it hurt.
- **Helpful:** Familiarity with where Bazel/Buck go beyond this family ([05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/junior.md)).

---

## Make's Correctness Failure Modes

Make's incrementality rests on two assumptions, and *every* correctness bug is one of them being violated:

1. The declared dependency graph is **complete** (every real input is a declared prerequisite).
2. File **mtimes** faithfully reflect "did the content change."

Both are routinely false. The failures, ranked by how much time they cost:

**Incomplete dependencies (the silent killer).** If an input isn't declared, Make won't rebuild on its change — and reports success. The header case is the famous one (fixed by `-MMD`, see [middle.md](middle.md)), but it generalizes: a generated source not declared as a prerequisite, a `CFLAGS` change that Make can't see (changing a flag doesn't change any file's mtime, so nothing rebuilds), a tool-version bump. **A build that is stale-but-green is worse than one that's red**, because it ships. Detection: periodically diff an incremental build against a clean (`make clean && make`) build; any difference is an undeclared dependency.

**`.PHONY` misuse.** Two opposite errors. (a) Forgetting `.PHONY` on an action target — a same-named file disables it ([junior.md](junior.md)). (b) Over-using phony: making real artifacts depend on phony targets forces perpetual rebuilds, destroying incrementality. A phony target is "always newer," so its dependents are always stale.

**Clock skew and mtime fragility.** Make trusts mtimes absolutely. This breaks when:
- Files are checked out from version control (Git sets mtime to *checkout time*, not commit time) — a fresh clone can have a `.o` "newer" than its `.c` purely by checkout order, masking a needed rebuild, or the reverse.
- Builds run across NFS or in containers where the build host and file host clocks differ — a file can appear to be from the *future*, and Make will rebuild it forever (or never).
- `touch` / `cp -p` / restored backups reset mtimes in ways that don't reflect content.
- A build completes in under one second on a filesystem with 1-second mtime granularity — input and output get the *same* timestamp, and Make can't tell stale from fresh.

> **Key insight:** Make's model is "mtime is a proxy for content change." Every descendant that improved on Make attacked this proxy. Ninja additionally records the *command line* used (so a flag change forces a rebuild — Make can't do this without manual `.FORCE` tricks). Bazel ([05](../05-polyglot-hermetic-builds/junior.md)) abandons mtime entirely for **content hashing** plus a *hermetic, fully-declared* input set, eliminating both failure classes by construction. When you understand Make's two assumptions, you understand precisely what each successor was buying you.

---

## Non-Recursive Make at Scale

The middle page named the recursive-make problem; here's how the *correct* pattern is actually built. The goal: one Make process, one complete graph, with per-directory modularity preserved through `include` rather than `$(MAKE) -C`.

The technique uses a per-directory fragment plus a small stack to track "which directory am I in":

```makefile
# top-level Makefile
all:                       # default target declared early, before fragments add prereqs

include libfoo/module.mk
include libbar/module.mk
include app/module.mk

# libfoo/module.mk — note paths are relative to the TOP, not the subdir
LIBFOO_SRCS := $(wildcard libfoo/*.c)
LIBFOO_OBJS := $(LIBFOO_SRCS:.c=.o)
libfoo/libfoo.a: $(LIBFOO_OBJS)
	$(AR) rcs $@ $^
all: libfoo/libfoo.a       # fragment APPENDS to the shared `all` target

# app/module.mk
app/app: $(wildcard app/*.o) libfoo/libfoo.a
	$(CC) $^ -o $@
all: app/app
```

Key properties this buys you: one process sees `app` depends on `libfoo/libfoo.a`, so the order is *derived*, not hand-sequenced; `make -j` parallelizes across the whole tree; no redundant re-parsing. The cost is discipline — every path is relative to the top-level directory, and large non-recursive Makefiles develop their own conventions (variable namespacing per module, `$(d)` directory-stack macros) that are real engineering. This is why, past a certain size, teams stop hand-rolling non-recursive Make and adopt a generator (CMake/Meson) that produces a correct single graph automatically.

> **Practical reality:** non-recursive Make is *correct* but *expensive to maintain by hand*. The honest senior position is: know how and why it works, but reach for a generator before you reinvent half of CMake in `.mk` fragments. The exception is a small-to-medium project where the team's Make fluency exceeds its CMake fluency.

---

## Ninja's Design Philosophy: Execute a Precomputed Graph, Fast

Ninja is the purest expression of a single principle: **separate description from execution, then optimize execution to the metal.** Understanding *why* its restrictions exist is the senior-level point.

What Ninja deliberately lacks, and what each omission buys:

- **No globbing/wildcards.** The generator must list every input explicitly. This means the graph is *fully known before any work starts* — Ninja never has to touch the filesystem to *discover* the graph, only to check mtimes of known files. A no-op build is then nearly instant: read the graph, stat the known files, compare against the build log.
- **No general string functions or conditionals.** Nothing to *evaluate* at build time, so parsing is trivial and fast.
- **Per-output explicit `build` statements.** No rule has to be matched/instantiated at build time; the generator already did that. Ninja just walks edges.
- **A build log + command hashing.** Ninja stores the exact command used to produce each output. If the *command* changes (a flag flip from the generator) — even with identical mtimes — Ninja rebuilds. This closes Make's "flag change → no rebuild" hole.
- **`depfile` / `deps` support.** Ninja consumes the compiler's generated header deps and can store them in its own fast database (`deps = gcc`), avoiding re-parsing `.d` files.

The result is the property Chromium needed: a multi-hundred-thousand-file project where `ninja` with nothing to do returns in well under a second. That speed is not a clever optimization bolted on — it is the *consequence* of refusing to do anything but execute a complete, precomputed graph.

> **Key insight:** Ninja's minimalism is a *correctness and speed strategy*, not asceticism. By forbidding build-time computation, it guarantees the graph is complete and known up front, which is exactly what makes both fast no-op builds and full-core parallelism possible. "Ninja is fast" and "Ninja is dumb" are the same sentence — and that's the design.

---

## CMake Internals: Configure vs Generate vs Build

Most CMake confusion comes from not distinguishing its three phases. They run at different times, fail for different reasons, and produce different things:

| Phase | Trigger | What it does | Output |
|---|---|---|---|
| **Configure** | `cmake -S . -B build` | Runs `CMakeLists.txt` as a *script*: detects compiler, probes the system (`check_symbol_exists`, `find_package`), builds the in-memory target graph. Results cached in `CMakeCache.txt`. | `CMakeCache.txt`, configured headers |
| **Generate** | (end of the same command) | Translates the in-memory target graph into the chosen generator's files. | `build.ninja` / `Makefile` / `.sln` |
| **Build** | `cmake --build build` / `ninja -C build` | Runs the generated low-level build. CMake/CMake-language no longer involved. | Artifacts |

Critical consequences a senior must internalize:

- **`CMakeCache.txt` persists configure-time decisions.** Found-library paths, compiler identity, cached options — all frozen at first configure. This is the source of the infamous **cache corruption**: you switch compilers or move the source tree, but the cache still points at the old compiler/paths, and you get bizarre failures. The fix is brutal and correct: `rm -rf build/` and re-configure. Never debug a corrupted cache; delete it.
- **Out-of-source builds are mandatory practice.** Always `-B build` (a separate directory). In-source builds litter your tree with generated files and make "delete and re-configure" mean "delete everything."
- **Configure runs your `CMakeLists.txt` as code.** It is a full imperative language with variables, control flow, and side effects. This is why CMake is powerful *and* why old CMake is a swamp — people wrote elaborate configure-time logic that modern target-based CMake makes unnecessary.

> **Key insight:** "CMake is slow / weird / corrupts" almost always means someone is conflating the phases — editing source and only re-running build, or fighting a stale cache. The three-phase model is the diagnostic: *which phase failed?* tells you where to look. (Meson splits the same way: `meson setup` = configure+generate, `ninja`/`meson compile` = build.)

---

## Modern Target-Based CMake and Usage Requirements

CMake before ~3.0 was *directory-and-variable* oriented: global `include_directories()`, global `CMAKE_CXX_FLAGS`, manual propagation of flags to every consumer. It did not scale — flags leaked, dependencies were implicit, and large projects became unmaintainable.

Modern ("target-based") CMake treats each target as an object carrying its own **usage requirements** that propagate automatically along the dependency edges:

```cmake
add_library(json src/json.c)

# Usage requirements, scoped:
target_include_directories(json
  PUBLIC  include            # consumers of json AND json itself see this
  PRIVATE src)               # only json's own build sees this

target_compile_features(json PUBLIC c_std_11)
target_link_libraries(json PUBLIC m)     # consumers also link libm

add_executable(app main.c)
target_link_libraries(app PRIVATE json)  # app inherits json's PUBLIC requirements
                                          # → app automatically gets include/ and links m
```

The scoping keywords are the whole idea:

- **`PRIVATE`** — needed to build *this* target, not propagated to consumers.
- **`INTERFACE`** — *not* needed to build this target, but propagated to consumers (header-only libraries use this).
- **`PUBLIC`** — both (`PRIVATE` + `INTERFACE`).

`app` links `json` and *automatically* inherits `json`'s include directory, C standard, and transitive `libm` link — because they were declared `PUBLIC` on `json`. No global state, no manual propagation. This is the difference between CMake that scales to a large org ([professional.md](professional.md)) and CMake that becomes a tarball of global-variable spaghetti.

> **Key insight:** modern CMake is "describe each target's interface; let propagation handle the rest" — the same encapsulation principle as good software design, applied to the build graph. If a CMake codebase uses global `include_directories()` and `CMAKE_*_FLAGS` instead of `target_*`, it predates this model and is a migration candidate.

---

## Toolchain Files and Cross-Compilation

Cross-compilation ([08 — Cross-Compilation](../08-cross-compilation/junior.md) goes deep) is where CMake's configure phase earns its keep. A **toolchain file** is a small CMake script, passed at configure time, that tells CMake "you are not building for this machine":

```cmake
# arm64-linux.toolchain.cmake
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)
set(CMAKE_C_COMPILER   aarch64-linux-gnu-gcc)
set(CMAKE_CXX_COMPILER aarch64-linux-gnu-g++)
set(CMAKE_FIND_ROOT_PATH /opt/sysroots/arm64)
# only find target libraries in the sysroot, never the host's:
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
```

```bash
cmake -S . -B build-arm64 --toolchain arm64-linux.toolchain.cmake -G Ninja
cmake --build build-arm64
```

The toolchain file is consumed at *configure* time, which is exactly right: cross-compilation decisions (which compiler, which sysroot, which libraries are "the target's") must be fixed before any probing happens. The `CMAKE_FIND_ROOT_PATH_MODE_*` settings prevent the classic cross-compile bug — `find_package` silently picking up the *host's* libraries instead of the target's. Meson uses an analogous "cross file" (`--cross-file`) for the same purpose. Hand-written Make has no built-in concept here; you wire it all through variables manually, which is why cross-compiling raw Makefiles is notoriously fragile.

---

## Meson's Design Choices

Meson is the "what would we build if we started over in 2012" answer. It generates Ninja (and only Ninja, plus VS/Xcode), so it inherits Ninja's speed and never tries to be an execution engine. Its deliberate choices, contrasted with CMake:

- **A real, restricted DSL — not Turing-complete.** Meson's language has no user-defined functions and no arbitrary loops over mutable state by design. The point: build descriptions should be *declarative and analyzable*, not programs. This trades flexibility for readability and predictability — the opposite of CMake's "configure is a full language" stance.
- **Sane defaults and conventions.** Out-of-source builds enforced, sensible warning levels, built-in unit-test and install support. Less ceremony to do the common thing right.
- **First-class subprojects and wraps.** Dependency fetching (`subprojects/*.wrap`) is built in, addressing the C/C++ "there is no package manager" gap more cleanly than CMake's `FetchContent`.
- **Speed and readability as explicit goals**, learned directly from watching CMake's pain points.

```meson
project('myapp', 'c', default_options : ['c_std=c11', 'warning_level=3'])

json = static_library('json', 'src/json.c', include_directories : 'include')
executable('app', 'main.c',
  link_with : json,
  include_directories : 'include',
  install : true)
```

The trade-off is ecosystem gravity: CMake is the de facto standard with vastly more `find_package` modules, IDE support, and existing projects. Meson is technically cleaner but adopting it means swimming against the current of "every C++ dependency assumes CMake." A senior weighs *language quality* against *ecosystem inertia* — and inertia usually wins for libraries meant to be consumed by others.

---

## Choosing Among Them

The decision is not aesthetic. The factors that actually drive it:

| If you... | Choose | Because |
|---|---|---|
| Have a small/medium project, Make-fluent team, Unix-only | **Make** (non-recursive) | Lowest barrier; ubiquitous; fine at this scale |
| Build C/C++ that others must *consume* and `find_package` | **CMake** | Ecosystem standard; export targets/package config others expect |
| Want a clean greenfield C/C++ build, value readability | **Meson** | Better language, faster, sane defaults — if you can accept smaller ecosystem |
| Need a fast executor under a generator | **Ninja** (never alone) | The default backend for both CMake and Meson |
| Have a large polyglot monorepo needing hermeticity & remote cache | **Bazel/Buck** ([05](../05-polyglot-hermetic-builds/junior.md)) | Make-family's mtime/non-hermetic model breaks at this scale |

Two principles cut through it:

1. **Always generate Ninja, never hand-write the low-level layer.** Whether CMake or Meson, target Ninja as the backend (`-G Ninja`). It's faster than Make backends and the standard.
2. **Library-for-others vs application-for-us is the pivotal axis.** A library that others embed almost *has* to ship CMake (and good `find_package` support) because that's what consumers expect — ecosystem compatibility outweighs language quality. An internal application has more freedom to pick Meson or even raw Make.

> **Key insight:** the senior question is never "which tool is best" in the abstract — it's "given this project's *consumers*, *team*, *platforms*, and *scale*, which trade-off is correct, and what's the migration cost if I'm wrong?" Generated vs authored, ecosystem vs ergonomics, mtime-incrementality vs hermeticity: name the axis the decision turns on, and the answer follows.

---

## Mental Models

- **Make's mtime model is a *proxy*, and every descendant attacks the proxy.** Make: mtime ≈ content change. Ninja: mtime + recorded command line. Bazel: content hash + hermetic declared inputs. Each step buys correctness by relying less on the proxy.

- **A stale-but-green build is the worst outcome in the whole field.** A red build stops you. A green-but-wrong build ships. The entire discipline of build correctness exists to eliminate the second case — which is why "diff incremental vs clean build" is a senior reflex.

- **CMake is a compiler; its bugs are compiler-phase bugs.** Configure = front end (parse + analyze the system). Generate = code generation (emit Ninja). Build = running the output. Diagnose by asking *which phase* — same as you would for a misbehaving compiler.

- **Usage requirements are encapsulation for the build graph.** A `target_*(... PUBLIC ...)` declaration is an *interface*; `PRIVATE` is an *implementation detail*. Good build design, like good code design, is about controlling what propagates across boundaries.

- **Ninja's stupidity is its correctness.** It can't compute anything at build time, so it can't be *wrong* about a graph it didn't compute — it only executes one handed to it complete. Restriction as a guarantee.

---

## Common Mistakes

1. **Trusting an incremental build's green status.** Undeclared dependencies (headers, flags, generated files, tool versions) make Make report success on a stale result. Periodically validate against a clean build.

2. **Debugging a corrupt `CMakeCache.txt` instead of deleting it.** Switched compilers, moved the tree, or got mysterious configure errors? `rm -rf build/` and re-configure. The cache freezes first-configure decisions; don't fight it.

3. **In-source CMake/Meson builds.** Generated files pollute the source tree; "clean" becomes dangerous. Always build in a separate directory (`-B build`).

4. **Writing old-style global CMake** (`include_directories()`, `CMAKE_CXX_FLAGS`) in new code. Flags leak, dependencies go implicit, it doesn't scale. Use `target_*` with `PUBLIC`/`PRIVATE`/`INTERFACE`.

5. **Letting a flag change not trigger a rebuild in Make.** Changing `CFLAGS` changes no file's mtime, so Make won't rebuild. Either force a clean, or encode flags into a tracked file the targets depend on. (Ninja handles this natively via command hashing.)

6. **Cross-compiling without root-path scoping.** Omitting `CMAKE_FIND_ROOT_PATH_MODE_*` lets `find_package` grab host libraries into a target build — links fine, fails on the device.

7. **Picking Meson for a public library and surprising consumers.** Technically nicer, but consumers expect CMake's `find_package`. For libraries-for-others, ecosystem compatibility usually outranks language quality.

---

## Test Yourself

1. Give two distinct ways a Make incremental build can report success while producing a *wrong* artifact, and how each is prevented.
2. Why does changing a compiler flag fail to trigger a rebuild in plain Make but not in Ninja?
3. Explain the three CMake phases. Which one does `CMakeCache.txt` belong to, and what's the standard fix for cache corruption?
4. What do `PUBLIC`, `PRIVATE`, and `INTERFACE` mean on a `target_*` command, and why do they matter at scale?
5. Why is a CMake/Meson toolchain/cross file consumed at *configure* time rather than build time?
6. You're choosing a build tool for a new C++ *library* meant for wide reuse. What's the decisive factor, and what do you likely pick?

<details>
<summary>Answers</summary>

1. (a) **Undeclared header dependency** — editing a header doesn't change the source's mtime, so Make skips the rebuild; prevented by compiler-generated deps (`-MMD -MP` + `-include`). (b) **Flag/tool change** — altering `CFLAGS` or the compiler version changes no file mtime, so nothing rebuilds; prevented by forcing a clean build or encoding flags into a tracked dependency (Ninja prevents it natively by hashing the command line). (Also acceptable: clock skew / sub-second mtime granularity.)
2. Make decides solely on file mtimes; a flag change modifies no file, so the comparison is unchanged and nothing rebuilds. Ninja additionally records the exact command used to produce each output and rebuilds when that command string changes — so a generator-emitted flag change forces a rebuild.
3. **Configure** (run `CMakeLists.txt` as a script, probe the system, build the target graph), **generate** (emit `build.ninja`/`Makefile` from that graph), **build** (run the generated files). `CMakeCache.txt` is a configure-phase artifact freezing detected compiler/library/option values. Fix for corruption: delete the build directory (`rm -rf build`) and re-configure; don't try to repair the cache.
4. They scope **usage requirements**: `PRIVATE` = needed to build this target only; `INTERFACE` = not needed here but propagated to consumers; `PUBLIC` = both. They matter because consumers automatically inherit `PUBLIC`/`INTERFACE` requirements along dependency edges — eliminating manual, leak-prone global flag propagation, which is what lets CMake scale.
5. Because cross-compilation decisions (which compiler, sysroot, which libraries count as "the target's") must be fixed *before* CMake probes the system and resolves dependencies. Those probes happen in the configure phase, so the toolchain/cross file must be in effect then — applying it at build time would be too late.
6. Decisive factor: **what consumers expect**. C++ libraries are overwhelmingly consumed via CMake's `find_package`/exported targets, so ecosystem compatibility outweighs Meson's cleaner language — you likely pick **CMake** with proper installed-target/package-config export.

</details>

---

## Cheat Sheet

```
MAKE'S TWO ASSUMPTIONS (every bug violates one)
  1. declared deps are COMPLETE   → undeclared header/flag/tool = stale-but-green
  2. mtime == content change      → clock skew, sub-second granularity, VCS checkout
  validate: diff `make` (incremental) vs `make clean && make`

DESCENDANTS vs THE MTIME PROXY
  Make   : mtime
  Ninja  : mtime + recorded command line (flag change → rebuild)
  Bazel  : content hash + hermetic declared inputs   (see ../05)

NON-RECURSIVE MAKE
  one process, `include subdir/module.mk`, paths relative to TOP
  → complete graph, correct order, full -j  (vs recursive: fragmented, slow, wrong)

CMAKE THREE PHASES
  configure  cmake -S . -B build   parse+probe → CMakeCache.txt
  generate   (same command)        → build.ninja / Makefile
  build      cmake --build build   run it
  cache corrupt? → rm -rf build && re-configure   (never repair)
  ALWAYS out-of-source (-B build)

MODERN CMAKE (target-based)
  target_link_libraries(app PRIVATE json)
  target_include_directories(json PUBLIC include PRIVATE src)
  PRIVATE  = build this only      INTERFACE = consumers only      PUBLIC = both
  AVOID global include_directories() / CMAKE_*_FLAGS

CROSS-COMPILE
  cmake --toolchain arm64.cmake     (consumed at CONFIGURE time)
  set CMAKE_FIND_ROOT_PATH_MODE_{LIBRARY,INCLUDE} ONLY  (no host leakage)
  Meson: --cross-file

CHOOSING
  consume-by-others C/C++  → CMake (ecosystem)
  greenfield, readability  → Meson
  small, Make-fluent, Unix → non-recursive Make
  always backend           → Ninja (never hand-written)
  huge polyglot/hermetic   → Bazel/Buck (../05)
```

---

## Summary

- Make's correctness rests on two assumptions — **complete declared dependencies** and **mtime ≈ content change** — and *every* Make bug is one being violated. The dangerous class is **stale-but-green**: undeclared headers/flags/tools producing a wrong artifact that reports success. Validate with incremental-vs-clean diffs.
- **Non-recursive Make** (one process, `include`d fragments, one complete graph) is the correct pattern but expensive to hand-maintain — past a point, generate instead.
- **Ninja's minimalism is its strategy**: by forbidding build-time computation it guarantees a complete, precomputed graph, enabling sub-second no-op builds and full-core parallelism. It also records command lines, closing Make's flag-change hole.
- **CMake has three phases** — configure (probe + build graph, cached in `CMakeCache.txt`), generate (emit Ninja/Make), build. Most CMake pain is phase confusion or cache corruption; the fix for the latter is to delete and re-configure.
- **Modern target-based CMake** uses `target_*` with `PUBLIC`/`PRIVATE`/`INTERFACE` usage requirements that propagate along edges — encapsulation for the build graph, and what makes CMake scale.
- **Meson** is the "start-over" design: a restricted, declarative DSL, Ninja-only, sane defaults — cleaner than CMake but with smaller ecosystem gravity.
- **Choosing** turns on concrete axes: consumers (libraries-for-others lean CMake for `find_package`), team fluency, platforms, and scale (huge polyglot/hermetic → Bazel/Buck). Name the axis; the answer follows.

The [professional.md](professional.md) page takes this into the field: maintaining and migrating large Make/CMake codebases, CMake at org scale (`find_package`, exported targets, package config), cross-platform realities, when to escape to Bazel, and the war stories that teach what the docs don't.

---

## Further Reading

- [*Recursive Make Considered Harmful*](https://aegis.sourceforge.net/auug97.pdf) — Miller, 1997, re-read now for the single-graph argument behind every descendant.
- *Effective CMake* — Daniel Pfeifer (talk + slides). The canonical guide to target-based, modern CMake.
- *Professional CMake: A Practical Guide* — Craig Scott. The definitive deep reference.
- [Ninja Manual — design goals & the build log](https://ninja-build.org/manual.html) — for *why* the restrictions exist.
- [The Meson Build System paper / docs](https://mesonbuild.com/) — Jussi Pakkanen on the design rationale.

---

## Related Topics

- [02 — Dependency Graphs](../02-dependency-graphs/middle.md) — the incrementality and graph-completeness model these correctness arguments rest on.
- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/junior.md) — Bazel/Buck: content hashing and hermeticity that abandon Make's mtime model entirely.
- [06 — Dependency Management](../06-dependency-management/junior.md) — `find_package`, `FetchContent`, and Meson wraps as the C/C++ "missing package manager."
- [08 — Cross-Compilation](../08-cross-compilation/junior.md) — toolchain/cross files in depth.
- [professional.md](professional.md) — large-codebase maintenance, migration, org-scale CMake, and war stories.
