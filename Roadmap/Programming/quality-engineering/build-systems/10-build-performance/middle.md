# Build Performance — Middle Level

> **Roadmap:** [Build Systems](../README.md) → Build Performance
> *Parallelism has a hard floor you can't drill through: the longest chain of dependencies. The path to a fast build runs through measuring where time actually goes — and the answer, in C and C++, is almost always headers.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Parallelism and the Critical Path](#parallelism-and-the-critical-path)
4. [Incrementality, Recapped — and Where It Leaks](#incrementality-recapped--and-where-it-leaks)
5. [Measuring Build Time Properly](#measuring-build-time-properly)
6. [Profiling: Where Is the Time Going?](#profiling-where-is-the-time-going)
7. [The Cost of Fan-Out and Heavy Headers](#the-cost-of-fan-out-and-heavy-headers)
8. [Cutting the Work: Forward Declarations, PCH, Unity Builds](#cutting-the-work-forward-declarations-pch-unity-builds)
9. [Link Time as a Bottleneck](#link-time-as-a-bottleneck)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Where does build time actually go, and what determines the floor that parallelism can't beat?**

The junior page gave you the three levers and the one flag (`-j`) that pays off immediately. But it leaves three questions unanswered, and each one separates a beginner from an engineer who can actually make a slow build fast.

First: *why doesn't `-j64` make my build 64× faster?* There's a hard limit, and it has a name — the **critical path**. Second: *where is the time actually going?* Guessing is for amateurs; there are real profilers (`clang -ftime-trace`, ninja's log, `make -d`) that show you exactly which files and which phases dominate. Third: *what is the work, really?* In C and C++ the answer is rarely "the compiler is slow" — it's that headers force the compiler to re-read and re-parse enormous amounts of text, over and over, across thousands of translation units.

This page is about *seeing* your build clearly enough to fix it: the floor parallelism can't beat, the tools that show where time goes, and the specific techniques (forward declarations, precompiled headers, unity builds) that attack the dominant cost.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and the three levers (do less, parallelize, don't repeat).
- **Required:** You understand the **translation unit** from [01 — Build Fundamentals (middle)](../01-build-fundamentals/middle.md) — a source file with all its headers expanded.
- **Helpful:** You've used `make -j` and noticed it doesn't scale linearly.
- **Helpful:** You know roughly what a flame graph or trace timeline looks like.

---

## Parallelism and the Critical Path

Parallelism does not give you a free 64× from `-j64`. Two limits cap it.

The obvious one: you only have as many cores as you have. On 8 cores, the most parallelism can do is roughly 8× — and that's before overhead.

The deeper, more interesting one: the **critical path**. A build is a dependency graph ([02 — Dependency Graphs](../02-dependency-graphs/middle.md)). Some steps *must* happen before others — you cannot link until every object file exists; you cannot compile a generated file until the generator runs. The longest chain of must-happen-in-order steps is the critical path, and **it is the floor on build time that no amount of parallelism can break**.

```
  generate code (4s) → compile big_module.o (30s) → link (12s)   = 46s critical path

  Even with infinite cores and infinite other files compiling in parallel,
  this build cannot finish in less than 46 seconds. That chain is serial.
```

If your critical path is 46 seconds, then `-j8`, `-j64`, and `-j1000` all bottom out at ~46 seconds once the parallel parts are absorbed. Adding cores past that point does *nothing*.

This is why two builds with the same total CPU-seconds can have completely different wall-clock times. A build that's 1,000 tiny independent files parallelizes beautifully. A build that's one 5-minute file feeding the link step is serial no matter how many cores you throw at it — the 5-minute file *is* the critical path.

> **Key insight:** The question is never "how many cores do I have?" It's "what's my critical path, and what's on it?" To make a well-parallelized build faster, you must shorten the *longest dependency chain* — split the slow file on the path, remove a serialization point, or make the slowest step itself faster. Throwing cores at a critical-path-bound build is wasted money. (The senior page formalizes this as Amdahl's law.)

---

## Incrementality, Recapped — and Where It Leaks

Incrementality means: this build only redoes what changed since the last build. It's the lever you feel most all day. The mechanism, from [02 — Dependency Graphs](../02-dependency-graphs/middle.md), is comparing each output against its inputs — if `math.o` is newer than `math.c` *and* every header `math.c` includes, skip the recompile.

Incrementality *leaks* — silently rebuilds more than it should — in predictable ways, and a leaking incremental build feels mysteriously slow:

- **Missing dependency edges.** If the build doesn't know `math.c` includes `config.h`, editing `config.h` won't trigger a `math.c` rebuild — *correctness* bug. The reverse — a dependency that's recorded too coarsely (e.g. "depends on the whole `include/` directory") — over-triggers and rebuilds too much.
- **Timestamps that always change.** A build step that touches a file's timestamp on every run (without changing content) makes everything downstream think it changed. Content-hash–based tools (see [07 — Build Caching](../07-build-caching/middle.md)) avoid this by keying on *content*, not mtime.
- **Non-deterministic outputs.** If compiling the same input twice produces byte-different output (embedded timestamps, absolute paths), downstream steps re-run needlessly — and caching breaks entirely. This is the bridge to [09 — Reproducible Builds](../09-reproducible-builds/middle.md).

> **Key insight:** A slow *incremental* build is almost always one of two things: high **fan-out** (a small change legitimately forces a big rebuild) or a **leaking dependency graph** (the build rebuilds things that didn't actually change). The fixes are opposite — fan-out is "reduce the blast radius," leaks are "fix the dependency tracking" — so diagnose which one you have before acting.

---

## Measuring Build Time Properly

You cannot optimize what you don't measure, and the naive measurement misleads. Start with `time`, but read it correctly:

```bash
time make -j8
# real    0m42.118s   ← wall clock — what you actually wait for
# user    4m51.203s   ← total CPU time summed across ALL cores
# sys     0m18.402s   ← kernel time (I/O, process spawning)
```

`real` is your pain. `user` is total work. The ratio `user / real` is your *effective parallelism* — here ~4.9×, meaning on average ~5 cores were busy. If `user ≈ real`, you're effectively serial (missing `-j`, or critical-path-bound). If `user / real` is well below your core count, something is serializing the build.

For repeatable comparison, measure both build kinds and pin the conditions:

```bash
make clean && time make -j$(nproc)     # CLEAN build — CI's worst case
touch src/foo.c && time make -j$(nproc) # INCREMENTAL after a one-line touch — daily case
```

Use a tool like `hyperfine` to run each several times and report a stable mean rather than one noisy number:

```bash
hyperfine --prepare 'make clean' 'make -j8'      # warm vs cold, repeated, with stats
```

> **Key insight:** One build-time number is a lie. Report at minimum *clean* time, *incremental-after-small-change* time, and the *effective parallelism* (`user/real`). Those three together tell you whether your problem is total work (clean too slow), fan-out (incremental too slow), or serialization (parallelism far below core count) — three different problems with three different fixes.

---

## Profiling: Where Is the Time Going?

`time` tells you the build is slow. Profiling tells you *which part*. Each ecosystem has a profiler; learn the one for your build.

**Clang `-ftime-trace` (per–translation-unit timing).** This is the sharpest tool in C++. Add `-ftime-trace` and each `.o` gets a `.json` trace next to it:

```bash
clang++ -ftime-trace -c heavy.cpp -o heavy.o   # emits heavy.json
```

Open `heavy.json` in `chrome://tracing` (or [Speedscope](https://www.speedscope.app/)) and you get a flame view of *where the compiler spent its time inside this file*: parsing headers, instantiating templates, generating code. This is how you discover that one file spends 8 seconds instantiating a single template, or that `<regex>` alone costs 2 seconds of header parsing.

**Ninja's build log + ninjatracing.** Ninja records the duration of every build step in `.ninja_log`. Convert it to a Chrome trace to see the whole build laid out on a timeline — including the critical path:

```bash
ninja                                   # produces .ninja_log
ninjatracing .ninja_log > trace.json    # convert to chrome://tracing format
ninja -d stats                          # per-rule timing summary
```

The timeline shows gaps where cores sat idle (a serialization point) and the long pole that defines the critical path.

**Bazel `--profile`.** Bazel writes a structured profile you can open in `chrome://tracing` or its own viewer:

```bash
bazel build //... --profile=/tmp/prof.gz
# then: analyze in chrome://tracing or `bazel analyze-profile /tmp/prof.gz`
```

**`make -d` and timing.** `make -d` prints *why* `make` decided to rebuild each target (which dependency was newer) — invaluable for diagnosing a leaking incremental build. For raw timing, wrap recipes or use `remake --profile`.

```bash
make -d 2>&1 | grep -i 'newer\|remake\|consider'   # why did each target rebuild?
```

> **Key insight:** "The build is slow" must become "*this* is slow." `-ftime-trace` localizes cost *inside* a file (which header, which template); ninja/bazel profiles localize cost *across* files (which step is the long pole, where do cores idle); `make -d` explains *why* something rebuilt. Pick the tool that answers the question you actually have, and let the data — not intuition — pick your next move.

---

## The Cost of Fan-Out and Heavy Headers

In C and C++, the dominant build cost is almost never "the compiler runs slowly." It's that the compiler re-reads, re-parses, and re-instantiates *enormous* amounts of header text, once per translation unit, across thousands of TUs.

Recall from [Fundamentals (middle)](../01-build-fundamentals/middle.md): a TU is a source file *with all its headers fully expanded*. `#include <vector>` can pull in tens of thousands of lines after transitive expansion. If 1,000 source files each `#include` a heavy header, that header is parsed **1,000 times** — the compiler has no memory between TUs.

Two distinct costs hide here:

1. **Per-build parse cost.** Every TU pays to parse every header it transitively includes. A bloated header tax is multiplied by the number of TUs that include it.
2. **Fan-out (incremental cost).** When a header changes, *every* TU that includes it recompiles. A header included by 800 files turns a one-line edit into an 800-file rebuild. This is the number-one cause of slow *incremental* builds in C++.

```bash
# how many files transitively include this header? (a fan-out proxy)
grep -rl 'include "common.h"' src/ | wc -l        # direct includers
clang++ -H -c app.cpp 2>&1 | grep -c '\.'         # full transitive include depth for one TU
```

The lever here is **reduce the work**: make headers lighter (include less), and make fewer files include them.

> **Key insight:** In C++, build performance is mostly an *include hygiene* problem. The cost of a header is not paid once — it's paid once *per TU that includes it*, every build (parse cost), and *per dependent TU*, every time it changes (fan-out). A single fat header included everywhere can dominate both your clean and incremental times simultaneously. Find it with `-ftime-trace` and include-counting, then put it on a diet.

---

## Cutting the Work: Forward Declarations, PCH, Unity Builds

Three concrete techniques attack header cost. They trade differently; know what each buys.

**Forward declarations** — don't include a header just to name a type as a pointer or reference. Declaring `class Widget;` lets you use `Widget*` without parsing all of `widget.h`. This cuts both parse cost and fan-out, because your file no longer depends on `widget.h` at all.

```cpp
// header.h — BAD: pulls in all of widget.h into everyone who includes header.h
#include "widget.h"
class Manager { Widget* w; };          // only needs that Widget exists

// header.h — GOOD: forward-declare; include widget.h only in the .cpp that uses Widget's members
class Widget;                          // a promise; zero parse cost, breaks the dependency edge
class Manager { Widget* w; };
```

**Precompiled headers (PCH)** — parse a set of stable, heavy headers *once* and reuse the parsed result across all TUs. Instead of parsing `<vector>`, `<string>`, `<map>` a thousand times, parse them once into a binary blob:

```bash
clang++ -x c++-header pch.h -o pch.h.pch          # build the precompiled header once
clang++ -include-pch pch.h.pch -c app.cpp -o app.o # reuse it — skip re-parsing those headers
```

PCH is a big win for *clean* build parse cost, but only for headers that rarely change — if a header in the PCH changes, the whole PCH (and everything using it) rebuilds.

**Unity (jumbo) builds** — concatenate many `.cpp` files into one big TU so shared headers are parsed once for the group instead of once per file:

```cpp
// unity_0.cpp
#include "a.cpp"
#include "b.cpp"
#include "c.cpp"   // a/b/c's common headers now parsed ONCE for all three
```

Unity builds can dramatically speed up *clean* builds (CMake supports them via `set(CMAKE_UNITY_BUILD ON)`), but they *hurt incrementality* — changing one file now rebuilds the whole jumbo group — and can cause subtle symbol clashes. They're a CI clean-build optimization, not a daily-driver one.

> **Key insight:** These three trade along the clean/incremental axis. Forward declarations help *both* (they cut real dependency edges — the best kind of win). PCH and unity builds shrink *clean* parse cost but can *worsen* incremental fan-out. Choose based on which build kind hurts: forward-declare aggressively always; reach for PCH/unity when CI's clean build is the pain.

---

## Link Time as a Bottleneck

Compilation parallelizes across files; **linking does not** — it's a single step that must wait for every object file and then process them all serially. On a large C++ project, the link step can take *minutes*, and because it's at the end of the critical path, no amount of `-j` touches it.

Why is linking slow? It reads every object file, resolves every symbol, applies every relocation ([Fundamentals (middle)](../01-build-fundamentals/middle.md)), and on large binaries with debug info and link-time optimization, does a lot of it serially. The classic GNU linker `ld.bfd` is the slowest; `gold` is faster; the modern linkers are dramatically faster.

The cheapest link-time win is **swapping the linker** — no code changes, just a flag:

```bash
# LLVM's lld — much faster than ld.bfd, drop-in
clang++ app.o lib.o -fuse-ld=lld -o app

# mold — currently the fastest mainstream linker, often several times faster than lld
clang++ app.o lib.o -fuse-ld=mold -o app
g++     app.o lib.o -fuse-ld=mold -o app
```

`mold` was designed for exactly this problem — multi-threaded, cache-friendly linking — and on a large project can turn a 40-second link into a few seconds. Because linking sits on the critical path of nearly every build (incremental builds still relink!), a faster linker often improves your *everyday* iteration time more than any compile optimization.

> **Key insight:** Link time is a critical-path bottleneck that parallelism can't touch, and it's paid on *every* incremental build (you recompile one file, then relink the whole program). Swapping in `lld` or `mold` via a single `-fuse-ld=` flag is one of the highest-leverage, lowest-effort build-speed wins available — often bigger than any compile-side change for day-to-day iteration. (More on linkers in [01 — Build Fundamentals](../01-build-fundamentals/senior.md).)

---

## Mental Models

- **The critical path is the floor; parallelism only fills the room above it.** `-j` puts your idle cores to work on the *parallel* parts, but the longest serial chain sets a hard minimum. Want a faster build? Find the longest chain and shorten *it*.

- **A header is a tax paid per includer, per build.** It's not parsed once — it's parsed once for every TU that includes it, every time. A fat header included by 1,000 files is parsed 1,000 times. Fan-out is the same tax in the incremental dimension: change it, and 1,000 files re-pay.

- **`-ftime-trace` is an X-ray of one file; a ninja/bazel profile is an X-ray of the whole build.** Use the X-ray for the question you have: "why is *this file* slow?" → time-trace. "what's the long pole *across files*?" → build profile.

- **The linker is the cashier at the end of the line.** Every shopper (object file) must finish before the cashier can total the order, and there's only one cashier. A faster cashier (`mold`) speeds up *every* checkout, including the small ones (incremental relinks).

---

## Common Mistakes

1. **Expecting `-j` to scale forever.** Past your core count, or once you hit the critical path, more jobs do nothing. If `-j16` and `-j64` give the same time, you're critical-path- or core-bound — optimize the longest chain, don't add jobs.

2. **Optimizing without profiling.** Rewriting a file that turns out to take 0.2 seconds while ignoring the one that takes 30. Run `-ftime-trace` or a ninja/bazel profile *first*; let data pick the target.

3. **Including a header when a forward declaration would do.** `#include "widget.h"` to use only `Widget*` drags all of `widget.h` into your TU and ties you to its changes. Forward-declare and include only in the `.cpp` that touches members.

4. **Reaching for unity builds to fix slow incremental builds.** Unity builds speed *clean* builds but *worsen* incremental ones (one edit rebuilds the whole jumbo group). If your daily iteration is the pain, unity builds make it worse.

5. **Ignoring the linker.** Teams pour effort into compile speed while a 40-second `ld.bfd` link sits on the critical path of every build. `-fuse-ld=mold` is often the single biggest win and takes one flag.

6. **Trusting timestamps blindly.** A step that rewrites a file's mtime without changing content makes incrementality leak — everything downstream rebuilds. If unchanged code keeps rebuilding, suspect timestamp churn or a missing/over-broad dependency edge; `make -d` will tell you why.

---

## Test Yourself

1. Why doesn't `-j64` make a build 64× faster? Name *two* distinct limits.
2. What is the critical path of a build, and what's the only way to make a fully-parallelized build faster?
3. `time make -j8` shows `real 0m40s`, `user 0m44s`. What does the `user/real` ratio tell you, and what should you suspect?
4. In C++, why is a heavy header included by 1,000 files expensive in *two* different ways?
5. You want to speed up CI's clean build, but a teammate warns your fix could slow daily incremental builds. What technique are they probably worried about, and why?
6. Your incremental build recompiles one file in 2 seconds but then spends 35 seconds linking. What's happening, and what's the cheapest fix?

<details>
<summary>Answers</summary>

1. **(a)** You only have as many cores as you have — past your core count, extra jobs just queue. **(b)** The **critical path**: the longest chain of must-happen-in-order steps can't be parallelized away, so once the parallel parts are absorbed, build time bottoms out at the critical-path length regardless of core count.
2. The critical path is the **longest chain of dependent steps that must run in order** (e.g. generate → compile the slow file → link). The only way to speed up an already-parallel build is to **shorten that chain** — split the slow file on it, remove a serialization point, or make the slowest step itself faster.
3. `user/real ≈ 1.1`, meaning effective parallelism is barely above 1 — the build is essentially **serial** despite `-j8`. Suspect a critical-path-bound build (one long chain), or that most work is in a single step, or jobs blocking on each other. Profile to find the long pole.
4. **(1) Parse cost:** the header is parsed once per TU that includes it — 1,000 times every build. **(2) Fan-out:** when the header changes, all 1,000 dependent TUs must recompile, turning a one-line edit into a 1,000-file rebuild.
5. **Unity (jumbo) builds.** They concatenate many `.cpp` files so shared headers parse once per group — great for *clean* builds — but a change to any file in a group now rebuilds the whole group, hurting *incremental* iteration. (PCH has a milder version of the same risk.)
6. The 35 seconds is **link time**, which is serial and sits on the critical path of every incremental build (you recompile one file, then relink the whole program). The cheapest fix is **swapping the linker**: add `-fuse-ld=mold` (or `lld`), no code changes, often turning the link from 35s into a few seconds.

</details>

---

## Cheat Sheet

```
THE FLOOR: CRITICAL PATH
  longest chain of dependent steps = minimum build time
  -j fills cores on the PARALLEL parts; can't beat the serial chain
  to go faster: SHORTEN THE LONGEST CHAIN (split slow file / remove serialization)

MEASURE
  time make -j8        real=wall  user=total CPU  → user/real = effective parallelism
  user >> real         parallelism working
  user ≈  real         serial (critical-path/core-bound or missing -j)
  hyperfine 'make -j8' repeated runs, stable mean

PROFILE (where's the time?)
  clang++ -ftime-trace -c f.cpp   → f.json → chrome://tracing  (cost INSIDE a TU)
  ninja && ninjatracing .ninja_log > trace.json                (cost ACROSS files)
  ninja -d stats                  per-rule timing
  bazel build //... --profile=p.gz                             (bazel timeline)
  make -d                         WHY each target rebuilt (diagnose leaks)

HEADERS = THE C++ COST
  cost paid PER includer PER build (parse) + PER dependent on change (fan-out)
  grep -rl 'include "x.h"' src | wc -l    # includer count (fan-out proxy)
  clang++ -H -c f.cpp                      # transitive include tree

CUT THE WORK
  forward decl  class Widget;     → cuts parse + fan-out (best; cuts real edges)
  PCH           -include-pch x.pch → cuts CLEAN parse; bad if PCH headers churn
  unity build   #include "a.cpp"   → cuts CLEAN parse; WORSENS incremental

LINK (serial, on critical path, paid every build)
  -fuse-ld=lld    much faster than ld.bfd
  -fuse-ld=mold   fastest mainstream linker
```

---

## Summary

- Parallelism is capped by two limits: your **core count** and the **critical path** — the longest chain of must-happen-in-order steps. No amount of `-j` beats the critical path; to speed up a parallel build you must *shorten the longest chain*.
- **Incrementality** rebuilds only what changed; it *leaks* (rebuilds too much) when dependency edges are missing/over-broad, timestamps churn, or outputs aren't deterministic. A slow incremental build is either legitimate fan-out or a leaking graph — diagnose which.
- **Measure properly:** `time` gives `real` (your wait) and `user` (total CPU); their ratio is effective parallelism. Always report clean time, incremental-after-small-change time, and that ratio — three different problems hide behind one number.
- **Profile to localize cost:** `clang -ftime-trace` X-rays inside a TU (which header, which template); ninja/bazel profiles X-ray across files (the long pole, idle cores); `make -d` explains why targets rebuilt.
- In C++, **headers dominate**: a heavy header costs parse time *per includer per build* and fan-out *per dependent on change*. Cut it with **forward declarations** (help both clean and incremental), **PCH** and **unity builds** (help clean, can hurt incremental).
- **Link time** is serial, on the critical path, and paid on *every* incremental build. Swapping in **`lld` or `mold`** via one `-fuse-ld=` flag is often the single highest-leverage speedup for daily iteration.

The [senior.md](senior.md) takes this further: Amdahl's law on the critical path, reading a build flame graph in anger, C++ template-instantiation cost and modules, cache hit rate as the dominant lever at scale, and distributed vs remote-execution builds.

---

## Further Reading

- [Clang `-ftime-trace` documentation](https://clang.llvm.org/docs/index.html) and Aras Pranckevičius's "Investigating compile times" series — the canonical guide to reading C++ build traces.
- [mold linker README](https://github.com/rui314/mold) — why it's fast and how to adopt it.
- [Ninja manual](https://ninja-build.org/manual.html) and `ninjatracing` — profiling a ninja build.
- "Physical Design of C++" / John Lakos, *Large-Scale C++ Software Design* — the definitive treatment of include hygiene, fan-out, and forward declarations.

---

## Related Topics

- [02 — Dependency Graphs](../02-dependency-graphs/middle.md) — the graph that defines the critical path and drives incrementality.
- [07 — Build Caching](../07-build-caching/middle.md) — the third lever: content-addressed reuse that avoids timestamp leaks.
- [01 — Build Fundamentals](../01-build-fundamentals/senior.md) — linkers, ELF, and link-time optimization in depth.
- [09 — Reproducible Builds](../09-reproducible-builds/middle.md) — deterministic output, the prerequisite for caching to work.
- [senior.md](senior.md) — Amdahl on builds, C++ build costs, caching at scale, distributed compilation.
