# Make & Descendants — Professional Level

> **Roadmap:** [Build Systems](../README.md) → Make & Descendants
> *At this level the build is not a file you write — it's a system you operate, maintain, and migrate while a hundred engineers depend on it not breaking. This page is about the long game: living with a large Make/CMake codebase, migrating off the patterns that strangle it, running CMake at org scale, knowing when to escape the family entirely, and the war stories that teach what no manual does.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Maintaining a Large Make/CMake Codebase](#maintaining-a-large-makecmake-codebase)
3. [Migrating Off Recursive Make](#migrating-off-recursive-make)
4. [CMake at Org Scale: `find_package`, Exported Targets, Package Config](#cmake-at-org-scale-find_package-exported-targets-package-config)
5. [Cross-Platform Realities](#cross-platform-realities)
6. [When to Escape to Bazel](#when-to-escape-to-bazel)
7. [The Build File as a Code-Review Surface](#the-build-file-as-a-code-review-surface)
8. [War Stories](#war-stories)
9. [Mental Models](#mental-models)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do you keep a build system alive, correct, and fast over years and across a large team?**

A junior writes a Makefile. A senior chooses the right tool and writes it correctly ([senior.md](senior.md)). A professional inherits a 3,000-line Makefile written by someone who left in 2014, must keep it building on three platforms while shipping weekly, and has to decide — with real budget and risk — whether to refactor it, migrate it, or replace it.

That is a different job. The technical content (rules, targets, `target_*`) is assumed; the work is *operational and organizational*: managing the build as shared infrastructure, paying down its debt without halting delivery, exporting it cleanly so other teams can consume your libraries, and recognizing the scale at which the entire Make family stops being the right answer. This page is the field manual for that job.

---

## Prerequisites

- [senior.md](senior.md) — correctness failure modes, non-recursive Make, CMake's three phases, target-based usage requirements, tool selection.
- Experience owning or substantially modifying a real, large build configuration.
- Familiarity with CI ([07 — Build Caching](../07-build-caching/junior.md)) and where hermetic builds live ([05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/junior.md)).

---

## Maintaining a Large Make/CMake Codebase

A large build configuration is *production infrastructure* — it gates every commit. Treat it accordingly:

- **It needs an owner and an on-call story.** "The build is broken" must have a clear escalation path. Builds without owners rot into the 3,000-line Makefile nobody dares touch.
- **It must be tested.** A green incremental build is not proof of correctness ([senior.md](senior.md)). Run, in CI, a periodic **clean build** and a **`clean && incremental` diff** to catch the stale-but-green class. Test that `clean` actually removes everything, and that a fresh checkout builds from zero.
- **Build time is a tracked metric, not a vibe.** Measure clean-build and no-op-build times over time; regressions in either are bugs. A no-op build that creeps from 1s to 30s means the graph is being re-derived needlessly (often creeping recursion or `$(shell)` calls in the hot path).
- **Changes go through review like code** (see [§ code-review surface](#the-build-file-as-a-code-review-surface)). A build file is the one file in the repo that can break *everyone simultaneously*.
- **Pin and document the toolchain.** "Builds with GCC 11+ and CMake 3.20+" belongs in the repo, enforced at configure time (`cmake_minimum_required`, compiler-version checks). Silent toolchain drift is how a build that worked for a year suddenly doesn't on a new hire's laptop.

> **Operating principle:** the build is the highest-leverage shared file in the codebase. A 10% build-time regression taxes every engineer on every commit, every day, compounding. That's why build performance ([10 — Build Performance](../10-build-performance/junior.md)) and correctness deserve dedicated ownership, not "whoever touched it last."

---

## Migrating Off Recursive Make

You will, at some point, inherit recursive Make ([the harm explained in middle.md](middle.md)) and be asked to fix the resulting slow, flaky, occasionally-wrong builds. The migration is high-value and high-risk. Do it incrementally:

1. **Establish a correctness oracle first.** Before changing anything, capture what a *correct* full build produces (artifact hashes, a clean-build manifest). Every migration step must reproduce it. Without this, you can't tell a successful migration from one that silently broke something.

2. **Make the existing build observable.** Add `--trace` / `-d` runs, measure where time goes, and map the *actual* cross-directory dependencies (the ones recursion hid). The undeclared edges are the landmines.

3. **Pick the destination deliberately.** Two viable paths:
   - **Non-recursive Make** ([senior.md](senior.md)) — lowest disruption, keeps the team's Make fluency, one process / one graph. Right when the project is mid-sized and the team won't adopt a new tool.
   - **Generate the build (CMake/Meson → Ninja)** — higher upfront cost, but you stop hand-maintaining the graph forever and gain cross-platform + correct deps for free. Right when the project is large, multi-platform, or a library others consume.

4. **Migrate leaf-first, run both builds in parallel.** Convert one subdirectory, build it the new way, and *diff its outputs* against the old build. Keep both build paths green in CI until the last directory is converted. A big-bang rewrite of a build system is how teams lose a week to "it builds but the binary is subtly wrong."

5. **Delete the old path only after the diff is clean for a sustained period.** The old Makefile is your rollback until you're certain.

> **Key insight:** migrating a build is *refactoring under a test harness*, and the test harness is "does it produce the identical artifact." The recursive→non-recursive (or →generated) move is exactly the "assemble one complete graph" lesson from 1997, applied with the operational caution of not breaking a shipping product mid-flight.

---

## CMake at Org Scale: `find_package`, Exported Targets, Package Config

The moment your library is consumed by *another team's* build, the question stops being "how do I build it" and becomes "how does someone else *find and use* it correctly." This is where CMake's real org-scale machinery lives, and where most CMake projects are quietly broken.

**Consuming dependencies — `find_package`.** The consumer side:

```cmake
find_package(fmt 9.0 REQUIRED)          # locate an installed/exported library
target_link_libraries(app PRIVATE fmt::fmt)   # use its IMPORTED target
```

`fmt::fmt` is an **imported target** that carries `fmt`'s usage requirements (include dirs, compile features, transitive deps) just like a local target. The consumer writes *no* paths and *no* flags — that's the payoff of target-based CMake crossing a package boundary.

**Producing a consumable library — the part teams skip.** For `find_package(yourlib)` to work for downstream, *you* must export and install your targets with a generated package config:

```cmake
add_library(yourlib src/yourlib.c)
target_include_directories(yourlib PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>     # path while building yourlib
  $<INSTALL_INTERFACE:include>)                              # path once installed elsewhere

install(TARGETS yourlib EXPORT yourlibTargets
        ARCHIVE DESTINATION lib INCLUDES DESTINATION include)
install(EXPORT yourlibTargets
        NAMESPACE yourlib::                  # consumers get yourlib::yourlib
        FILE yourlibTargets.cmake
        DESTINATION lib/cmake/yourlib)
# + a yourlibConfig.cmake (often via configure_package_config_file) so find_package finds it
```

The `$<BUILD_INTERFACE>` / `$<INSTALL_INTERFACE>` generator expressions exist because a header's path is *different* while you build the library versus after it's installed on a consumer's machine — and getting this wrong is the #1 reason "it works in our tree but breaks when installed." Exporting targets correctly is unglamorous, easy to skip, and the difference between a library others can adopt and one they have to vendor and patch.

> **Key insight:** at org scale, the build's *interface to other builds* matters more than its internals. A well-exported set of targets with correct install-interface paths is an API contract. Teams that nail `target_*` internally but never export properly force every consumer to reverse-engineer include paths — which is its own flavor of the 3,000-line-Makefile problem, just distributed across the org.

---

## Cross-Platform Realities

"Cross-platform" looks solved in the docs and bleeds time in practice. The realities a professional plans for:

- **Compiler divergence is the deep cost.** CMake abstracts *invocation* (you don't write `cl.exe` vs `gcc`), but it cannot abstract *semantics*: MSVC, GCC, and Clang disagree on warnings, extensions, ABI, and standard-library behavior. The build configuration is the easy 20%; the 80% is per-compiler `#ifdef`s, flag mapping, and conditional source. Budget for it.
- **Windows is structurally different**, not just "another flag set." No standard system library locations (hence the Conan/vcpkg ecosystems), different DLL/import-lib model, path-length and case-sensitivity surprises. A Unix-only build "ported" to Windows usually needs real work, not a generator switch.
- **Generated build files are platform-specific by design** — and that's the point. One `CMakeLists.txt` → a Visual Studio solution on Windows, Ninja on Linux, Xcode on macOS. This is *why* you generate instead of hand-writing: the single source of truth survives platforms; the low-level files don't have to.
- **CI must build every platform you claim to support, every commit.** "It builds on Linux" tells you nothing about the Windows build a customer hits. Cross-platform support that isn't in CI is aspirational, not real.

Cross-compilation specifically (building *for* a platform you're not *on*) is its own discipline — toolchain/cross files, sysroots, root-path scoping — covered in [08 — Cross-Compilation](../08-cross-compilation/junior.md).

---

## When to Escape to Bazel

The Make family — even modern CMake+Ninja — has a ceiling. Recognizing it is a senior/staff judgment call. Symptoms you're hitting it:

- **Polyglot monorepo.** You're building C++, Go, Java, TypeScript, and protobufs together, and CMake (a C/C++-shaped tool) is being bent to orchestrate languages it was never meant to. Each language's native tool ([04 — Per-Language Tools](../04-per-language-tools/junior.md)) plus a meta-layer becomes a Rube Goldberg machine.
- **You need a *shared, remote* cache and remote execution.** When CI rebuilds the world on every PR and you want to fetch already-built artifacts other people's builds produced. Make's mtime model and non-hermetic environment can't safely share a cache — a cache hit requires *content-addressed, hermetic* inputs.
- **Correctness at scale demands hermeticity.** You can no longer tolerate "builds differently depending on what's installed on the machine." You need the build to depend *only* on declared inputs, reproducibly.
- **Build time has become an org-level bottleneck** that incremental + local parallelism can't fix.

This is exactly what **Bazel/Buck** ([05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/junior.md)) provide: hermetic, content-hashed, language-agnostic builds with shared remote caching and remote execution. The escape is *expensive* — a real migration, a BUILD-file-per-package discipline, sandboxing your tools — so it's justified only when the symptoms above are real and costly, not aspirational. Many organizations correctly stay on CMake+Ninja for a long time; the mistake is both adopting Bazel too early (paying its tax without the scale to amortize it) and clinging to CMake too long (death by a thousand monorepo papercuts).

> **Key insight:** the Make family optimizes *incremental local* builds correctly. Bazel optimizes *distributed, cached, hermetic, polyglot* builds correctly. The escape trigger is when your problem shifts from the first category to the second — and the cost of staying exceeds the cost of migrating.

---

## The Build File as a Code-Review Surface

The build configuration is the single file that can break every engineer at once, change *what binary ships* without touching application code, and introduce supply-chain risk. Review it as such:

- **Flag changes are behavior changes.** A `-O2 → -O3`, a `-DNDEBUG`, a new `-march=native` (which can break on other CPUs), a `-fno-strict-aliasing` removed — each can change runtime behavior, performance, or portability. They deserve more scrutiny than the average code diff, not less.
- **New dependencies are supply-chain decisions.** A `find_package`/`FetchContent`/wrap pulling a new library is a new trust relationship and a new attack surface. Review who maintains it, how it's pinned, and whether it's reproducible ([06 — Dependency Management](../06-dependency-management/junior.md)).
- **Watch for hermeticity leaks.** `$(shell ...)`, `execute_process`, reading environment variables, absolute machine-specific paths — anything that makes the build depend on the *machine* rather than the *repo* is a future "works on my machine" failure and a reproducibility ([09 — Reproducible Builds](../09-reproducible-builds/junior.md)) hole.
- **Generated files must never be hand-edited or committed-then-diverged.** A reviewer should reject edits to a generated `Makefile`/`build.ninja`; the change belongs in the source (`CMakeLists.txt`).

> **Operating principle:** require build-file changes to be reviewed by someone who owns the build, and require a clean CI build on all platforms before merge. The cost of a bad build-file change is paid by the whole team; the review must reflect that blast radius.

---

## War Stories

**The 3,000-line Makefile.** A decade-old service built by a single recursive Makefile that had accreted: hand-listed header dependencies (stale for years), per-developer `$(shell hostname)` branches, and a `clean` target that missed three generated files. Symptoms: random stale builds, CI green / production wrong. The fix was *not* a rewrite — it was (1) add a CI clean-vs-incremental diff to *expose* every stale-build bug, (2) switch on `-MMD -MP` auto-dependencies to kill the hand-listed-header rot, (3) migrate leaf directories to non-recursive `include` one at a time over a quarter. The lesson: **you make a legacy build correct by making its wrongness *visible* first**, then chipping away under that oracle — never by a heroic rewrite.

**The CMake cache corruption.** A team upgraded their compiler. Half the developers got bizarre link errors; the other half were fine. The "fine" half had freshly cloned; the broken half had an old `build/` whose `CMakeCache.txt` still pinned the *previous* compiler path and its detected feature set. Hours were lost reading link errors that had nothing to do with the actual code. The fix was one line — `rm -rf build && cmake -B build` — and the lesson became team policy: **a corrupt cache is never worth debugging; delete the build directory and re-configure.** They added a `make distclean`-equivalent and documented "blow away build/ on toolchain changes."

**The `-j` race that only failed on the build farm.** A Makefile had an undeclared dependency: target B used a file produced by target A, but no edge said so. On developers' 4-core laptops, A happened to finish before B by luck of scheduling. On the 64-core build farm with high `-j`, B sometimes started before A — intermittent, unreproducible failures that "went away when retried." The fix was declaring the missing edge. The lesson: **`-j` doesn't cause races; it *reveals* the dependency lies that were always there.** Higher parallelism is a correctness test for your graph.

---

## Mental Models

- **The build is shared production infrastructure.** It gates everyone, every commit. Own it, test it, measure it, review changes to it with the blast radius in mind. "Whoever touched it last" is not an ownership model.

- **Make legacy-build wrongness *visible* before fixing it.** A clean-vs-incremental diff turns invisible stale-build bugs into failing CI. You can't refactor what you can't see; the oracle comes first.

- **A library's exported targets are an API.** Internal `target_*` correctness is necessary but not sufficient; if downstream can't `find_package` you cleanly, your build's *interface* is broken even if its *internals* are perfect.

- **`-j` is a correctness test, not just a speedup.** Parallelism reveals every dependency you failed to declare. A build that's flaky under high `-j` has a lying graph, full stop.

- **The escape to Bazel is a category shift, not an upgrade.** You leave when your problem changes from "fast correct *local incremental* build" to "hermetic cached *distributed polyglot* build" — and only when the cost of staying genuinely exceeds the cost of moving.

---

## Common Mistakes

1. **No clean-build testing in CI.** Relying on incremental green; the stale-but-green class ships silently until a fresh checkout (or a new hire) exposes it months later.

2. **Big-bang build-system rewrites.** Replacing a recursive Makefile with CMake in one PR, no artifact diff, no parallel-running old path. The way to lose a sprint to "builds but subtly wrong."

3. **Shipping a library without exported/installed targets.** Internal CMake is clean, but there's no `Config.cmake`/`install(EXPORT)`, so every consumer hardcodes include paths and breaks on the next reorg.

4. **Mismatched `$<BUILD_INTERFACE>`/`$<INSTALL_INTERFACE>` paths.** Library builds in-tree but breaks when installed and consumed, because the include path was only valid during the build.

5. **Treating build-file changes as low-risk diffs.** A flag flip or new dependency gets rubber-stamped; it changes the shipped binary or adds supply-chain risk for the whole team.

6. **Debugging a corrupt CMake cache.** Reading link/configure errors caused by a stale `CMakeCache.txt` after a toolchain or path change, instead of deleting `build/`.

7. **Adopting Bazel too early or too late.** Paying its hermeticity/sandboxing tax on a single-language mid-size project, or drowning a true polyglot monorepo in CMake glue for years past the point it stopped fitting.

---

## Test Yourself

1. You inherit a flaky, occasionally-wrong recursive Makefile on a shipping product. What's your *first* move, and why is it not a rewrite?
2. Your internal CMake is clean and target-based, but another team says they can't use your library. What's almost certainly missing?
3. Explain the purpose of `$<BUILD_INTERFACE>` vs `$<INSTALL_INTERFACE>` and the bug their misuse causes.
4. A build passes on 4-core laptops but fails intermittently on a 64-core build farm. What's the likely root cause, and how does parallelism relate to it?
5. Name three concrete signals that a project has outgrown CMake+Ninja and should consider Bazel/Buck.
6. Why should a single-character flag change in a build file get *more* review scrutiny than a typical code change?

<details>
<summary>Answers</summary>

1. First make the wrongness **visible**: add a CI step that diffs an incremental build against a clean (`clean && build`) build (and verify `clean` removes everything). This turns invisible stale-build bugs into failing CI — your correctness oracle. A rewrite without that oracle can't be verified and risks silently breaking a shipping product; you migrate incrementally *under* the oracle instead.
2. **Exported/installed targets and a package config** — `install(TARGETS ... EXPORT ...)`, `install(EXPORT ...)`, and a generated `Config.cmake` so consumers can `find_package(yourlib)` and link `yourlib::yourlib`. Without it your usage requirements never cross the package boundary.
3. A header's include path differs while *building* the library (`$<BUILD_INTERFACE>`, the source tree path) versus after it's *installed* on a consumer's machine (`$<INSTALL_INTERFACE>`, e.g. `include`). Misusing them makes the library build in-tree but fail when installed and consumed, because the exported include path was only valid during the original build.
4. An **undeclared dependency edge**: a target consumes another's output without a declared prerequisite. Low parallelism happened to schedule them in a working order; high `-j` runs them concurrently and exposes the missing edge as an intermittent failure. Parallelism doesn't cause the race — it reveals the lie already in the graph. Fix: declare the edge.
5. Any three of: a **polyglot** monorepo (C++/Go/Java/TS/proto) that CMake is being bent to orchestrate; a need for a **shared remote cache / remote execution** (requires hermetic, content-addressed inputs); a hard requirement for **hermeticity/reproducibility** (build depends only on declared inputs, not what's installed); build time being an **org-level bottleneck** local incrementality can't fix.
6. Because a build-file change can alter the **shipped binary's behavior/performance/portability** (e.g. `-O3`, `-march=native`, `-DNDEBUG`) or introduce **supply-chain risk** (a new dependency) — and its blast radius is *every engineer and every artifact*, not one feature. Higher blast radius warrants higher scrutiny.

</details>

---

## Cheat Sheet

```
OPERATING A BIG BUILD
  - it's production infra: owner, on-call, reviewed changes
  - CI: clean build + (clean vs incremental) DIFF  → catches stale-but-green
  - track clean-build AND no-op-build time as metrics
  - pin/enforce toolchain (cmake_minimum_required, compiler checks)

MIGRATE OFF RECURSIVE MAKE (incremental, under an oracle)
  1. capture correct-output oracle (artifact hashes / clean manifest)
  2. make current build observable (--trace, map hidden cross-dir deps)
  3. pick dest: non-recursive Make (low disruption) OR generate (CMake/Meson)
  4. leaf-first, run BOTH builds, diff outputs, keep both green in CI
  5. delete old path only after sustained clean diff

CMAKE AT ORG SCALE
  consume:  find_package(fmt REQUIRED); target_link_libraries(app PRIVATE fmt::fmt)
  produce:  install(TARGETS lib EXPORT libTargets ...)
            install(EXPORT libTargets NAMESPACE lib:: ...)
            + libConfig.cmake          ← so downstream find_package works
  $<BUILD_INTERFACE:...>   path while building the lib
  $<INSTALL_INTERFACE:...> path after install (consumer side)

CROSS-PLATFORM
  generator abstracts INVOCATION, not compiler SEMANTICS (MSVC/GCC/Clang differ)
  CI must build EVERY supported platform every commit

ESCAPE TO BAZEL (../05) WHEN:
  polyglot monorepo · shared remote cache/exec · hermeticity required ·
  build time = org bottleneck     (not before — it has a real tax)

REVIEW BUILD FILES LIKE BLAST-RADIUS CODE
  flag change = behavior change · new dep = supply-chain decision
  reject hand-edits to generated files · flag hermeticity leaks ($(shell), abs paths)

WAR-STORY REFLEXES
  corrupt CMakeCache → rm -rf build && reconfigure (never debug it)
  flaky under high -j → undeclared dependency edge (parallelism reveals it)
  legacy stale builds → -MMD -MP auto-deps + clean-vs-incremental diff
```

---

## Summary

- A large build is **shared production infrastructure**: it needs an owner, CI that runs *clean* builds and *clean-vs-incremental* diffs (to catch the stale-but-green class), tracked build-time metrics, a pinned toolchain, and reviewed changes.
- **Migrating off recursive Make** is refactoring under a test harness: establish a correct-output oracle, make the old build observable, migrate leaf-first while running both builds in parallel and diffing outputs, and delete the old path only after a sustained clean diff.
- **CMake at org scale** is about your build's *interface to other builds*: consume via `find_package` + imported targets, and — the part teams skip — *produce* consumable libraries via `install(EXPORT ...)`, a generated `Config.cmake`, and correct `$<BUILD_INTERFACE>`/`$<INSTALL_INTERFACE>` paths.
- **Cross-platform** support is cheap in invocation (the generator abstracts it) and expensive in semantics (MSVC/GCC/Clang diverge); it's only real if CI builds every platform every commit.
- **Escape to Bazel/Buck** when your problem shifts from fast-correct-*local-incremental* to hermetic-cached-*distributed-polyglot* — and only when the cost of staying exceeds the cost of moving.
- The **build file is a high-blast-radius code-review surface**: flag changes are behavior changes, new dependencies are supply-chain decisions, hermeticity leaks are future failures, and generated files are never hand-edited.
- The war stories converge on three reflexes: make legacy wrongness *visible* before fixing it, never debug a corrupt CMake cache (delete it), and treat flakiness-under-`-j` as proof of an undeclared dependency.

---

## Further Reading

- *Professional CMake: A Practical Guide* — Craig Scott. The org-scale reference; the install/export and package-config chapters are the ones teams most need.
- *Effective CMake* — Daniel Pfeifer. The target-based model and how to export libraries others can consume.
- *Software Engineering at Google* (Winters, Manshreck, Wright) — the build chapter, on *why* Google built Blaze/Bazel and the scale that justified leaving the Make family.
- [*Recursive Make Considered Harmful*](https://aegis.sourceforge.net/auug97.pdf) — Miller, 1997. The migration target's justification, in the original.
- [Bazel — "Migrating to Bazel"](https://bazel.build/migrate) — concrete, sobering guidance on the cost of the escape.

---

## Related Topics

- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/junior.md) — Bazel/Buck, the destination when you outgrow the Make family.
- [06 — Dependency Management](../06-dependency-management/junior.md) — `find_package`, vcpkg/Conan, and reviewing new dependencies as supply-chain decisions.
- [07 — Build Caching](../07-build-caching/junior.md) — local and remote caching; why hermeticity is the prerequisite for a shared cache.
- [08 — Cross-Compilation](../08-cross-compilation/junior.md) — toolchain/cross files and sysroots in depth.
- [09 — Reproducible Builds](../09-reproducible-builds/junior.md) — eliminating the hermeticity leaks that build-file review must catch.
- [10 — Build Performance](../10-build-performance/junior.md) — measuring and protecting clean-build and no-op-build times.
