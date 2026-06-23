# Build Performance — Junior Level

> **Roadmap:** [Build Systems](../README.md) → Build Performance
> *A slow build doesn't just waste time — it breaks your concentration. The fix is rarely a faster computer; it's making the build do less work, do it in parallel, and never repeat work it's already done.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why Build Speed Actually Matters](#core-concept-1--why-build-speed-actually-matters)
5. [Core Concept 2 — The Three Big Levers](#core-concept-2--the-three-big-levers)
6. [Core Concept 3 — Parallelism: `make -j`](#core-concept-3--parallelism-make--j)
7. [Core Concept 4 — Clean vs Incremental Builds](#core-concept-4--clean-vs-incremental-builds)
8. [Core Concept 5 — "Why Is My Build Slow?" — First Questions](#core-concept-5--why-is-my-build-slow--first-questions)
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

> Focus: **Why are builds slow, and what are the basic moves that make them fast?**

You change one line, hit build, and wait. Thirty seconds. A minute. Five minutes. By the time it finishes you've checked Slack, read half a notification, and forgotten what you were about to test. That gap — between "I made a change" and "I can see if it worked" — is the single most expensive number in your daily workflow, and almost nobody measures it.

Build speed is not a vanity metric. A two-second rebuild keeps you *in flow*: change, run, observe, change again, all inside one train of thought. A two-minute rebuild forces you out of that loop every single time, and the cost compounds across dozens of cycles a day and dozens of engineers on a team. On the continuous-integration (CI) server, slow builds cost real money — every minute of build time is a minute of rented compute, multiplied by every commit, every pull request, every day.

The good news: making builds fast is mostly mechanical, and the same three ideas explain almost every win. This page teaches those three ideas in plain terms, shows you the one flag (`make -j`) that gives you the biggest free speedup, and teaches you to ask the right first questions when a build is mysteriously slow.

> **The mindset shift:** stop treating build time as a fixed cost of your computer. It's a *property of how the build is set up* — and you, the developer, control most of the levers. A slow build is usually a fixable bug, not a hardware limit.

---

## Prerequisites

- **Required:** You've read [01 — Build Fundamentals (junior)](../01-build-fundamentals/junior.md) and know that a build is a pipeline (compile → link) that turns source into a program.
- **Required:** You can run a build from the terminal (`make`, `go build`, `cargo build`, or similar).
- **Helpful:** You've waited too long for a build and wondered why.
- **Helpful:** You know roughly how many CPU cores your machine has (`nproc` on Linux, `sysctl -n hw.ncpu` on macOS).

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Build time** | How long it takes to turn source into a runnable artifact. |
| **Incremental build** | Rebuilding only the parts that changed since last time. |
| **Clean build** | Building everything from scratch, with nothing reused. |
| **Parallelism** | Doing several independent build steps at the same time on multiple CPU cores. |
| **`-j` (jobs)** | The flag that tells a build tool how many tasks to run at once. |
| **Cache** | Stored results of past work, reused so you don't redo it. |
| **CI** | Continuous Integration — the server that builds and tests your code automatically on every push. |
| **Translation unit** | One source file plus its headers — the unit the compiler chews on (from Fundamentals). |
| **Critical path** | The longest unavoidable chain of steps; the floor on how fast a build can possibly be. |
| **Fan-out** | How many files a single change forces to rebuild. |

---

## Core Concept 1 — Why Build Speed Actually Matters

There are two completely separate reasons to care about build speed, and they're worth naming because they justify different amounts of effort.

**Reason 1 — Developer flow.** Software research has a well-known finding: there are rough thresholds in how long a person will wait before their attention drifts.

```
  < ~1 second   →  feels instant; you stay in flow
  ~1–10 seconds →  you wait, but stay on task
  > ~10 seconds →  your mind wanders; you context-switch away
```

A build under a second or two lets you iterate without ever leaving the problem you're solving. Cross ten seconds and you check your phone. The damage isn't the ten seconds — it's the *minutes* it takes to rebuild your mental context afterward. A team that shaves a 90-second rebuild down to 5 seconds doesn't save 85 seconds; it saves the dozens of broken trains of thought those 85 seconds caused.

**Reason 2 — CI cost and velocity.** Your CI server builds your code on every pull request. If that build takes 30 minutes:

- Every code review waits 30 minutes for a green check before merging.
- A flaky failure costs another 30-minute retry.
- You're paying for 30 minutes of cloud compute per run, times hundreds of runs a day.

A 30-minute CI build doesn't just cost money — it slows down *how fast the whole team can ship*. Engineers batch up changes to avoid the wait, batches make bugs harder to find, and the whole loop gets sluggish. Build time is a **velocity metric**, not just an efficiency one.

> **Key insight:** Build speed pays off twice — once in *human attention* (flow, fewer context switches) and once in *machine cost* (CI minutes, faster merges). When you argue for spending time on build speed, name both. The human cost is usually the bigger one, and the one people forget to count.

---

## Core Concept 2 — The Three Big Levers

Almost every build speedup in existence is one of three moves. Learn these three and you have a checklist for the rest of your career.

**Lever 1 — Do less work.** The fastest work is the work you never do. If your build is compiling 5,000 files when only 200 are actually needed, the win isn't a faster compiler — it's *not compiling the other 4,800*. This means: cutting unnecessary dependencies, splitting giant files so a change touches fewer of them, and not pulling in code you don't use.

**Lever 2 — Do it in parallel.** Modern machines have many CPU cores. If your build compiles one file at a time on an 8-core machine, seven cores sit idle. Telling the build tool to run independent steps at once (the `-j` flag) can give you a near-free 4–8x speedup with a single flag change.

**Lever 3 — Don't repeat work.** If you already compiled `math.c` yesterday and it hasn't changed, compiling it again is pure waste. Two mechanisms avoid this: **incrementality** (this build skips what didn't change since last build) and **caching** (reuse a result computed earlier, even by someone else or on another machine — see [07 — Build Caching](../07-build-caching/junior.md)).

```
  SLOW BUILD                         FAST BUILD
  compile all 5000 files       →     do less:     compile only the 200 needed
  one file at a time           →     parallel:    8 files at once
  rebuild everything each time →     don't repeat: reuse yesterday's results
```

These three are not competing strategies — you stack all three. A great build does the *minimum* work, *in parallel*, *reusing* everything it can.

> **Key insight:** Before optimizing anything, ask which lever you're pulling. "I bought a faster CPU" only helps Lever 2 (and only a little). "I deleted an unused dependency" pulls Lever 1 and may erase thousands of files of compilation for free. The cheapest wins are usually *doing less*, not *going faster*.

---

## Core Concept 3 — Parallelism: `make -j`

Here is the single most valuable flag a junior engineer can learn. By default, `make` builds one thing at a time:

```bash
make            # builds serially — one compile step at a time
```

On an 8-core laptop, that wastes seven cores. The `-j` ("jobs") flag tells `make` how many independent steps to run *at the same time*:

```bash
make -j8        # run up to 8 build jobs in parallel
make -j         # (GNU make) run as many jobs as possible — careful, can overload the machine
nproc           # how many cores you have (Linux)
make -j$(nproc) # use exactly one job per core — a safe, common default
```

The speedup is often dramatic — a build that took 4 minutes serially might finish in 40 seconds with `-j8`. Other tools have the same idea under different names:

```bash
ninja                      # ninja parallelizes by default, using all your cores
cargo build -j 8           # Rust's cargo
go build                   # Go parallelizes automatically — no flag needed
bazel build //...          # bazel parallelizes automatically
make -j8 / ninja -j8       # cap the job count explicitly
```

Why does this work? Because most files in a project *don't depend on each other*. `math.c` and `network.c` can compile completely independently — there's no reason to wait for one before starting the other. The build tool knows which steps are independent (from the dependency graph — see [02 — Dependency Graphs](../02-dependency-graphs/junior.md)) and runs them simultaneously.

But parallelism has a ceiling. Some steps *must* happen in order: you can't **link** the final program until *every* object file is compiled. And `-j64` on a 4-core machine won't help — you only have 4 cores to run on; the extra jobs just queue up. The senior page covers the deeper limit (the *critical path*), but the junior takeaway is simple:

> **Key insight:** `make -j$(nproc)` is the closest thing to a free lunch in build performance. It costs one flag and often cuts build time by several times. If you're running `make` with no `-j`, you are leaving most of your machine idle. Add it today.

---

## Core Concept 4 — Clean vs Incremental Builds

These are two completely different things that take wildly different amounts of time, and confusing them leads to bad conclusions.

**A clean build** starts from nothing. Everything compiles from scratch. This is what happens the first time you build a project, or after you run `make clean` (which deletes all the previous outputs):

```bash
make clean      # delete every built artifact
make            # now EVERYTHING must be rebuilt — the slow case
```

**An incremental build** reuses last time's work. You changed one file; the build recompiles *that file* and anything that depends on it, and reuses the rest:

```bash
# edit one source file...
make            # only the changed file + its dependents rebuild — usually fast
```

The difference is enormous. A clean build of a large C++ project might take 20 minutes; an incremental build after a one-line change might take 3 seconds. They are *not the same number*, and you must always say which one you mean.

```
  CLEAN BUILD       everything from scratch     →  minutes (your worst case)
  INCREMENTAL BUILD only what changed           →  seconds (your everyday case)
```

How does the build know what changed? It compares timestamps (or hashes) of source files against the outputs they produced. If `math.c` is *newer* than `math.o`, it recompiles. If not, it skips. This is the heart of incremental builds, and it's why [02 — Dependency Graphs](../02-dependency-graphs/junior.md) matters so much: the build can only skip work correctly if it knows exactly what depends on what.

When you measure build time, always report *both*: "clean build is 8 minutes; incremental is 4 seconds." Optimizing the wrong one wastes effort. Developers feel the *incremental* time all day; CI usually pays the *clean* time on every run.

> **Key insight:** "How long does the build take?" is an incomplete question. The real questions are "how long is a *clean* build?" (CI's pain) and "how long is an *incremental* build after a small change?" (your daily pain). They have different causes and different fixes. Never quote one number.

---

## Core Concept 5 — "Why Is My Build Slow?" — First Questions

When a build feels slow, don't guess. Work through these questions in order — each one narrows the problem.

**1. Is it clean or incremental?** A slow *clean* build is normal-ish; a slow *incremental* build (3 minutes to rebuild after a one-line change!) is a smell — it means a tiny change is forcing a huge rebuild (high **fan-out**).

**2. Am I using parallelism?** Check whether you're running `make` with no `-j`. If so, you found the problem. Add `-j$(nproc)`.

```bash
make -j$(nproc)        # the first thing to try
```

**3. Is one change rebuilding too much?** If editing one line rebuilds hundreds of files, something everyone depends on changed — usually a **header** that's `#include`d everywhere. (Why: the header's text is copied into every file that includes it, so changing it changes them all — see Fundamentals.)

**4. Is the build redoing work it already did?** If the *second* build of the same unchanged code is still slow, incrementality or caching is broken — the build isn't reusing past results. (Caching is [07 — Build Caching](../07-build-caching/junior.md).)

**5. Where is the time actually going?** Don't assume — measure. The simplest measurement:

```bash
time make -j$(nproc)
# real    0m42.118s   ← wall-clock time (what you actually wait)
# user    4m51.203s   ← total CPU time across all cores
# sys     0m18.402s
```

When `user` time is much larger than `real` time, parallelism *is* working (many cores busy at once). When `user ≈ real`, you're running serially — likely missing `-j`.

> **Key insight:** "My build is slow" is not actionable. "My *incremental* build takes 90 seconds after a one-line change, running `make -j8`, and `time` shows `user` barely above `real`" *is* — it tells you parallelism isn't kicking in and a small change has huge fan-out. Always turn the vague complaint into measured specifics before touching anything.

---

## Real-World Examples

**1. The forgotten `-j`.** A new engineer joins a team and complains the C++ project takes 9 minutes to build. A teammate looks over their shoulder and sees them running plain `make`. They switch to `make -j$(nproc)` on the 16-core machine and the build drops to 90 seconds. The "slow build" was never the project — it was 15 idle cores. This is the most common build-speed bug there is, and the fix is one flag.

**2. The header that cost everyone an hour a day.** A widely-included header (`common.h`, pulled in by 800 of 1,000 files) got edited several times a day during a feature. Each edit forced 800 files to recompile — a 4-minute incremental build *every time*, dozens of times across the team. The fix was splitting that header so most files only needed a tiny piece of it. Incremental builds dropped to seconds. The problem wasn't the compiler; it was *fan-out*.

**3. The CI bill.** A startup's CI ran a 25-minute clean build on every pull request, hundreds of times a day. The cloud bill for build minutes was eye-watering, and reviews stalled waiting for green checks. Turning on a shared build cache ([07](../07-build-caching/junior.md)) so unchanged code wasn't recompiled on every run cut typical CI builds to 4 minutes — and the bill and the waiting with it. Build time was literally a line item.

---

## Mental Models

- **Build time is a flow tax.** Every second of build is a second your attention is at risk. Under ~1 second you pay nothing; over ~10 seconds you pay the much larger cost of rebuilding your concentration. You're not optimizing seconds — you're protecting trains of thought.

- **The three levers are a checklist.** Faced with any slow build, ask in order: can it do *less* work? can it do it *in parallel*? can it *reuse* work it already did? Almost every speedup is one of these three. If your idea isn't one of them, be suspicious.

- **`-j` fills the idle cores.** Picture your CPU as a kitchen with 8 cooks. Plain `make` has one cook working while seven watch. `-j8` puts them all to work on independent dishes. But you can't have a cook plate the meal (link) before every dish (object file) is done — some steps must wait.

- **Clean vs incremental are different animals.** A clean build is moving house; an incremental build is putting away one bag of groceries. Quoting one when you mean the other leads everyone to optimize the wrong thing.

---

## Common Mistakes

1. **Running `make` with no `-j`.** The single most common build-speed mistake. You're using one core out of many. `make -j$(nproc)` is almost always the right default and costs nothing.

2. **Quoting one build-time number.** "The build takes 8 minutes" is meaningless without saying *clean* or *incremental*. They differ by orders of magnitude and have different fixes.

3. **Blaming the hardware first.** A faster CPU helps a little. Doing less work and reusing results helps a lot, costs nothing, and is usually the real problem. Buy a faster machine *last*, not first.

4. **Setting `-j` absurdly high.** `make -j1000` on an 8-core box doesn't help — you only have 8 cores. Worse, too many jobs can exhaust RAM (each compile uses memory) and *slow the build down* by thrashing. Match `-j` to your cores (`$(nproc)`) as a starting point.

5. **Editing widely-included headers without noticing the blast radius.** Touch a header that 800 files include and you've signed those 800 files up for recompilation. If a "tiny" change triggers a huge rebuild, this is usually why.

6. **Assuming the second build will be fast.** It's only fast if incrementality and caching actually work. If rebuilding *unchanged* code is still slow, that machinery is broken — investigate, don't accept it.

---

## Test Yourself

1. Name the three big levers of build performance in plain terms.
2. You run plain `make` on a 16-core machine and the build is slow. What's the first thing to try, and roughly why does it help?
3. What's the difference between a clean build and an incremental build, and which one do you feel most during a normal workday?
4. You edit one comment in a header file and 800 files recompile. Why? What's this called?
5. `time make -j8` reports `real 0m50s` and `user 0m52s`. Is parallelism working? How can you tell?
6. Why is "do less work" usually a better first move than "buy a faster CPU"?

<details>
<summary>Answers</summary>

1. **Do less work** (don't compile what you don't need), **do it in parallel** (use all your cores), and **don't repeat work** (reuse past results via incrementality and caching).
2. Add `-j` — e.g. `make -j$(nproc)`. Plain `make` builds serially on one core; `-j` runs independent steps across all cores, often a several-times speedup, because most files don't depend on each other.
3. A **clean build** rebuilds everything from scratch (slow, minutes); an **incremental build** rebuilds only what changed (fast, seconds). You feel the *incremental* time most all day, since you're making small changes; CI usually pays the *clean* time.
4. The header's text is `#include`d (copied) into every file that uses it, so changing it changes all 800 of those files and forces them to recompile. This large blast radius from a small change is called **fan-out**.
5. **No, parallelism is barely working.** `user` time (~52s, total CPU across cores) is almost equal to `real` time (~50s, wall clock). If 8 cores were busy in parallel, `user` would be several times larger than `real`. This suggests the build is effectively serial — maybe a long dependency chain, or jobs blocked waiting.
6. Because the fastest work is the work you never do. Deleting an unused dependency or splitting a giant file can erase thousands of files of compilation for free, while a faster CPU gives a modest, costly, one-time gain that doesn't fix high fan-out or repeated work.

</details>

---

## Cheat Sheet

```
THE THREE LEVERS
  1. DO LESS         fewer deps, smaller files, less fan-out
  2. DO IT PARALLEL  make -j$(nproc)   ← biggest free win
  3. DON'T REPEAT    incremental builds + caching (topic 07)

PARALLELISM
  make -j$(nproc)    one job per core (safe default)
  make -j8           cap at 8 jobs
  ninja              parallel by default
  go build           parallel automatically
  nproc              count your cores (Linux)
  sysctl -n hw.ncpu  count your cores (macOS)

CLEAN vs INCREMENTAL
  make clean && make   CLEAN       everything from scratch   (minutes, CI's pain)
  <edit one file> make INCREMENTAL only changed + dependents (seconds, daily pain)
  → ALWAYS say which one you mean

MEASURE FIRST
  time make -j$(nproc)
    real >> ... = wall-clock you actually wait
    user        = total CPU across cores
    user >> real → parallelism working
    user ≈  real → effectively serial (missing -j?)

"WHY SLOW?" FIRST QUESTIONS
  1. clean or incremental?
  2. am I using -j ?
  3. does one change rebuild too much? (header fan-out)
  4. is it redoing unchanged work? (caching broken)
  5. where's the time? → measure, don't guess
```

---

## Summary

- Build speed matters for two separate reasons: **developer flow** (slow builds break concentration; the real cost is rebuilding your mental context, not the seconds) and **CI cost & velocity** (build minutes are money, and slow builds stall the whole team's shipping speed).
- Almost every speedup is one of **three levers**: do *less* work, do it in *parallel*, and *don't repeat* work already done. You stack all three.
- **`make -j$(nproc)`** is the closest thing to a free lunch — it uses all your cores instead of one, often a several-times speedup, because most files compile independently. It's the first thing to try on any slow build.
- A **clean build** (everything from scratch, minutes) and an **incremental build** (only what changed, seconds) are wildly different; always say which one you mean. A slow *incremental* build is a smell — usually high **fan-out** from a widely-included header.
- When a build is slow, **measure before guessing**: `time make` tells you whether parallelism is working (compare `user` to `real`), and a short checklist (clean/incremental? using `-j`? rebuilding too much? redoing work?) points you at the cause.

Master these basics and you've solved most everyday slow builds. The [middle.md](middle.md) goes deeper: the *critical path* that no amount of parallelism can beat, how to *profile* where build time actually goes, and why heavy headers are so expensive.

---

## Further Reading

- [GNU `make` manual — Parallel Execution](https://www.gnu.org/software/make/manual/html_node/Parallel.html) — exactly what `-j` does and its gotchas.
- *The Pragmatic Programmer* — on the cost of broken flow and fast feedback loops.
- [Ninja build system manual](https://ninja-build.org/manual.html) — a build tool designed from the ground up to be fast and parallel.
- The [middle.md](middle.md) of this topic — the critical path, profiling, and the cost of heavy headers.

---

## Related Topics

- [02 — Dependency Graphs](../02-dependency-graphs/junior.md) — how the build knows what's independent (parallelizable) and what changed (incremental).
- [07 — Build Caching](../07-build-caching/junior.md) — the third lever: reusing results so you never redo work.
- [01 — Build Fundamentals](../01-build-fundamentals/junior.md) — what a build *is*, and why headers cause fan-out.
- [Performance](../../performance/README.md) — the broader discipline of measuring and improving speed.
