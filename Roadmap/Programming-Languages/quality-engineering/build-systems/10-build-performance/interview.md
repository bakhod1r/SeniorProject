# Build Performance — Interview Level

> **Roadmap:** [Build Systems](../README.md) → Build Performance
> *Build-performance questions are a fast way to tell a coder from an engineer. Anyone can say "use `-j`." The signal is whether you understand the critical path, profile before guessing, and know that at scale the lever isn't your CPU — it's your cache hit rate.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [How to Use This Page](#how-to-use-this-page)
3. [Section 1 — The Three Levers](#section-1--the-three-levers)
4. [Section 2 — Parallelism and the Critical Path](#section-2--parallelism-and-the-critical-path)
5. [Section 3 — Profiling and Measurement](#section-3--profiling-and-measurement)
6. [Section 4 — C++ Build Costs](#section-4--c-build-costs)
7. [Section 5 — Linkers](#section-5--linkers)
8. [Section 6 — Caching at Scale](#section-6--caching-at-scale)
9. [Section 7 — Distributed and Remote Builds](#section-7--distributed-and-remote-builds)
10. [Section 8 — The Economics](#section-8--the-economics)
11. [Design Scenarios](#design-scenarios)
12. [Rapid-Fire Round](#rapid-fire-round)
13. [Red Flags Interviewers Listen For](#red-flags-interviewers-listen-for)
14. [Summary](#summary)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The build-performance questions you'll actually be asked, what each one is really probing, and answers that demonstrate senior judgment.**

Build-performance questions appear in infra, platform, build/release, and senior generalist interviews — and increasingly in any role touching a large codebase, because everyone has felt a slow build. They're effective interview questions because the naive answer ("add more cores," "use `-j`") is right enough to sound plausible but shallow enough to expose, and the follow-ups ("why doesn't `-j64` make it 64× faster?") quickly separate depth from buzzwords.

This page is a question bank grouped by theme, each with what the interviewer is *really* testing, a model answer, and the follow-ups that probe deeper. Then design scenarios — the ones that actually get asked — and a rapid-fire round for breadth.

---

## How to Use This Page

Don't memorize answers — internalize the *reasoning*. The unifying frame that earns senior signal across every question:

> **There are three levers (do less / parallel / don't repeat); parallelism is bounded by the critical path and Amdahl's law; you profile before optimizing; and at scale the dominant lever stops being CPU and becomes cache hit rate — which depends on determinism.**

Say that frame, apply it to the specific question, and you'll sound like someone who has actually made a slow build fast.

---

## Section 1 — The Three Levers

**Q1.1 — "A build is too slow. How do you think about speeding it up?"**

*What's really being tested:* Do you have a structured framework, or do you reach for random tricks?

**Model answer:** "Every build speedup is one of three levers, and I'd consider them in order. **Do less work** — fewer dependencies, less fan-out, don't compile what isn't needed; the fastest work is work you never do. **Do it in parallel** — use all cores (`-j$(nproc)`), since most files are independent. **Don't repeat work** — incrementality (skip what didn't change) and caching (reuse prior results, even across machines). But before I touch anything, I'd *measure*: is the pain in clean or incremental builds, and where is the time actually going? Optimizing without profiling is how you spend a week on a file that costs 0.2 seconds."

*Follow-up — "Which lever has the biggest payoff?"* "Depends on scale. On one machine, parallelism (`-j`) is the free win and 'do less' (cutting fan-out) is the structural one. At org scale, *don't repeat* dominates — a shared cache hit rate of 95% vs 70% beats almost any hardware change, because the gap is full recompilation."

---

**Q1.2 — "Why is 'do less work' usually better than 'buy a faster CPU'?"**

*What's really being tested:* Do you reach for hardware reflexively?

**Model answer:** "Because deleting work is unbounded and free; a faster CPU is bounded and costs money. Removing an unused dependency or splitting a fat header can erase thousands of files of compilation permanently. A faster CPU gives a modest one-time multiplier and doesn't fix the real problems — high fan-out, repeated work, a long critical path. Hardware is the *last* lever, not the first; it only helps the work you couldn't avoid or restructure."

---

## Section 2 — Parallelism and the Critical Path

**Q2.1 — "Why doesn't `-j64` make my build 64× faster?" (the classic)**

*What's really being tested:* Do you understand the *limits* of parallelism — the single most important concept in this topic.

**Model answer:** "Two reasons. First, you only have as many cores as you have — `-j64` on an 8-core box just queues the extra jobs; you cap at ~8×. Second, and deeper: the **critical path**. A build is a dependency graph, and some steps must happen in order — you can't link until every object file exists, can't compile a generated file until the generator runs. The longest chain of must-happen-in-order steps is the critical path, and it's a hard floor that *no* amount of parallelism beats. If your critical path is 46 seconds, `-j8`, `-j64`, and `-j1000` all bottom out around 46 seconds. Adding cores only fills the parallel work *above* that floor."

*Follow-up — "So how do you make an already-parallel build faster?"* "Shorten the critical path. Find the longest dependency chain — usually a slow code-gen step, a giant translation unit, or the link — and either split the slow node, remove a serialization point, or make that node itself faster (e.g. a faster linker). You attack the *longest chain*, not the total work."

*Follow-up — "Formalize the ceiling."* "Amdahl's law: if fraction `p` is parallelizable, max speedup is `1/((1−p)+p/N)`, approaching `1/(1−p)` as cores grow. If even 10% is serial, infinite cores give at most 10×. So the high-leverage move is *reducing the serial fraction*, which raises the ceiling for every core count at once."

---

**Q2.2 — "`time make -j8` shows `real 40s`, `user 44s`. Diagnose it."**

*What's really being tested:* Can you read the basic measurement correctly?

**Model answer:** "`user/real ≈ 1.1` — effective parallelism is barely above 1, so despite `-j8` the build is essentially *serial*. If 8 cores were busy in parallel I'd expect `user` several times larger than `real`. Likely causes: the build is critical-path-bound (one long dependent chain), or almost all the work is in a single step, or jobs are blocking on each other. Next move: open a build-timeline profile (ninja log → `chrome://tracing`) to find the long pole and any idle gaps where cores sat empty."

---

## Section 3 — Profiling and Measurement

**Q3.1 — "Your build is slow. Walk me through finding out why — concretely."**

*What's really being tested:* Do you measure, and do you know the actual tools?

**Model answer:** "First, separate clean from incremental — they have different causes. Then `time make -j$(nproc)`: `real` is my wait, `user/real` is effective parallelism. Then I localize with the right profiler:

- **C++ inside one file:** `clang++ -ftime-trace -c f.cpp` emits `f.json`; open in `chrome://tracing` to see parse vs template-instantiation vs codegen cost. Aggregate across the build with `ClangBuildAnalyzer` to rank the worst headers and templates.
- **Across files:** ninja records step durations in `.ninja_log`; `ninjatracing` converts it to a Chrome timeline showing the critical path and idle gaps. Bazel: `--profile=p.gz`.
- **Why did it rebuild?** `make -d` prints which dependency triggered each rebuild — essential for diagnosing a leaking incremental build.

The rule: find the slowest thing *on the critical path*, then determine if its cost is frontend (parsing/templates → include hygiene) or backend (codegen → optimization level)."

*Follow-up — "What's the wrong way to profile?"* "Guessing. Rewriting the file you *assume* is slow. I've seen people optimize a 0.2s file while a 30s file sits on the critical path. Always let the trace pick the target."

---

## Section 4 — C++ Build Costs

**Q4.1 — "Why are C++ builds notoriously slow, and what do you do about it?"**

*What's really being tested:* Do you understand that the cost is *structural*, not "the compiler is slow"?

**Model answer:** "The cost is structural: textual `#include`. A translation unit is a source file with *all* its headers fully expanded, and the compiler has no memory between TUs — so a heavy header included by 1,000 files is parsed 1,000 times *every build*. Two costs hide there: per-build parse cost (per includer) and fan-out (change the header → every dependent recompiles). Plus template instantiation: each distinct instantiation is compiled fresh in every TU that uses it.

Fixes, by leverage: **forward declarations** (declare `class Widget;` instead of including `widget.h` when you only use a pointer — cuts the real dependency edge, helps both clean and incremental); **include-what-you-use** to drop unneeded includes; **`extern template`** to instantiate a heavy template once; **precompiled headers** and **unity builds** to parse stable headers once (great for *clean* builds, but they *worsen* incremental fan-out, so they're a CI tool, not a daily-driver one). The structural fix is **C++20 modules** — a module's interface is parsed once into a BMI and imported, killing the per-TU parse tax — but adoption is gated on toolchain maturity."

*Follow-up — "Unity builds sped up CI but engineers complain dev builds got slower. Why?"* "Unity builds concatenate many `.cpp` into one TU so shared headers parse once *per group* — faster clean build. But now changing *any* file in a group rebuilds the *whole* group, so incremental iteration gets worse. It's a clean-build optimization; it taxes incremental. If daily iteration is the pain, unity builds are the wrong tool."

---

## Section 5 — Linkers

**Q5.1 — "Linking takes 40 seconds on every incremental build. What do you do?"**

*What's really being tested:* Do you know link time is serial, on the critical path, and paid every build — and the cheap fix?

**Model answer:** "Linking is serial — it waits for every object file, then resolves symbols and applies relocations in one step — and it sits at the end of the critical path of *every* build, including incremental ones: recompile one file, then relink the whole program. So 40s of link is a fixed tax on every iteration. The cheapest fix by far is **swapping the linker**: `-fuse-ld=mold` (currently the fastest mainstream, multi-threaded) or `-fuse-ld=lld` — no code changes, often turning 40s into a few seconds. The default `ld.bfd` is the slowest. Beyond that: `-gsplit-dwarf` to shrink link input, and if the binary's a monolith, splitting into shared libraries so a change relinks only one."

*Follow-up — "Does LTO help build performance?"* "No — the opposite. LTO moves optimization *into* the link, so it *increases* build time to improve *runtime* performance. Never enable it on fast-iteration dev builds; it's release-only. If you must, use thin LTO (`-flto=thin`) to keep it parallel and far cheaper than monolithic LTO."

---

## Section 6 — Caching at Scale

**Q6.1 — "You've got a 200-engineer monorepo. What's the biggest build-performance lever?"**

*What's really being tested:* Do you know that at scale the game changes from CPU to cache hit rate?

**Model answer:** "**Cache hit rate**, via a shared remote cache. At this scale the dominant cost isn't your CPU — it's recomputing work someone (a teammate, a prior CI run, the nightly) already computed. A build cache keys each compile/action by a hash of all its inputs (source, flags, compiler version, headers) and fetches the result on a hit. With a *shared* remote cache, work compiled once by anyone is reused by everyone — a 25-minute CI clean build becomes 3 minutes when 90% of its actions hit. Going from 70% to 95% hit rate removes most remaining compute — a bigger win than doubling cores."

*Follow-up — "Hit rate is mysteriously low. Why?"* "Almost always **non-determinism** breaking input hashes — embedded timestamps, absolute paths, `__DATE__`, unstable ordering — so the same logical input hashes differently and misses, cascading downstream. The cache's precondition is **reproducible builds**: byte-identical output for identical input. The other cause is over-broad cache keys (keying on hostname or wall-clock), so every build is a miss. Key on exactly the inputs that affect the output, nothing more."

*Follow-up — "Why is determinism a *performance* concern?"* "Because at scale, performance *is* cache hit rate, and a non-deterministic output silently destroys hit rate by changing every downstream input hash. Reproducibility and performance are the same problem above a certain size."

---

## Section 7 — Distributed and Remote Builds

**Q7.1 — "Single-machine builds are maxed out. How do you scale beyond one machine?"**

*What's really being tested:* Do you know the two families and their *very different* entry costs?

**Model answer:** "Two families. **Distributed compilation** — `distcc` or `icecc` — ships individual compile jobs to other machines on the LAN and links locally. Cheap to adopt (a compiler wrapper plus a host list), no special requirements, great for C/C++ clean builds. But it only parallelizes *compilation*; the graph, cache, link, and correctness stay on your machine. **Remote execution** — Bazel RBE, BuildBuddy — ships *entire actions* with their full declared input sets to a cluster that runs them in isolation. It parallelizes the *whole* build graph across a fleet with a shared cache, language-agnostic. But it has a hard prerequisite: **hermetic builds** — every action must declare *all* its inputs, because the remote worker has nothing but what's declared.

So the choice is about entry cost: distcc is a cheap on-ramp for C/C++ today; RBE is a platform investment that requires hermeticity first."

*Follow-up — "A team turned on RBE and got intermittent *wrong* outputs, not just failures. Why?"* "The build isn't hermetic. Some action reads an undeclared input — a system header, an ambient tool — that exists or differs locally but not on the remote worker, so it silently produces different output. This is the dangerous failure mode: fast *and wrong*. The fix is hermeticity, and the rollout should gate every step on a byte-for-byte comparison of remote vs local output before expanding coverage. A fast-but-wrong build is worse than a slow correct one."

---

## Section 8 — The Economics

**Q8.1 — "How do you justify spending engineering time on build performance?"**

*What's really being tested:* Can you make a business case, not just an engineering complaint?

**Model answer:** "With arithmetic, not 'it's slow.' Two recurring numbers plus a velocity argument:

- **Developer-hours:** engineers × builds/day × seconds-saved. 200 engineers × 40 builds × 45s ≈ 100 engineer-hours *per day*, recurring forever. A one-week project pays back in days.
- **CI dollars:** runs/day × minutes-saved × $/minute. 2,000 runs × 21 min saved × $0.02 ≈ $300k/year.
- **Velocity (the one that wins):** slow builds make engineers batch larger, riskier changes and stall merge queues; fast builds enable small, frequent, low-risk changes — the DORA-correlated foundation of high-performing teams.

I'd lead with the recurring developer-hours and the velocity drag, because the dollars are usually the smaller number."

*Follow-up — "How do you keep it from regressing after you fix it?"* "Build-time SLOs split by kind (incremental p95 for flow, clean for onboarding, CI for merge velocity), a per-target budget that fails review when a new library blows it, and a per-commit regression gate that flags the commit that regressed p95 — because build performance, unmanaged, only ratchets slower, one header at a time. And I'd alert on *cache hit rate drops*, since that's the leading indicator of a determinism regression long before build time looks alarming."

---

## Design Scenarios

**Scenario A — "Your build takes 30 minutes. Make it fast. Walk me through it."**

A staple. Structure the answer as *measure → diagnose → fix in leverage order*; don't jump to a fix.

1. **Clarify and measure.** "Is the 30 minutes a *clean* CI build or an *incremental* dev build? They're different problems. I'll measure both, plus `user/real` for effective parallelism, and stand up a build profile (ninja/bazel timeline, `-ftime-trace` for C++)."
2. **Check the obvious.** "Is `-j` set to core count? Is a fast linker in use (`mold`/`lld`)? Is dev-build LTO accidentally on? Cheap wins to bank first."
3. **Read the profile.** "Find the critical path — the longest dependent chain — and idle gaps (serialization points). Is the long pole one giant TU, code-gen, or the link?"
4. **Apply leverage in order:**
   - *Cache hit rate first* (at scale): shared remote cache, fix determinism so hits actually land. This often turns a 30-min clean build into minutes by itself.
   - *Critical path / structure*: split the long-pole target everything waits on; cut the worst fan-out header (forward-decl, IWYU).
   - *C++ specifics*: `extern template`, PCH/unity for clean builds.
   - *Hardware/RBE last*: only for residual cold work, and RBE only if hermetic.
5. **Lock it in.** "SLOs + per-commit regression gate so it doesn't rot back to 30 minutes."

The signal: you *measured first*, you know the *critical path* bounds parallelism, and you put *cache hit rate* at the top of the leverage order at scale.

---

**Scenario B — "Editing one header rebuilds 800 files and takes 4 minutes. Fix it."**

*Probing:* fan-out understanding.

**Model answer:** "That's fan-out: the header's text is `#include`d into 800 TUs, so changing it changes all 800 and forces them to recompile. The fix is reducing the blast radius. **Split the header** so most files include only the small piece they need. **Forward-declare** where files use only pointers/references to a type — that removes the dependency edge entirely, so those files no longer rebuild when the header changes. **Run include-what-you-use** to find files that include it but don't need it. The goal: drop the number of files that genuinely depend on this header from 800 to the handful that actually use its definitions. PCH/unity won't help here — they'd make incremental *worse*."

---

**Scenario C — "Your CI clean build is slow but you can't use incremental builds in CI (you need clean for trust). What now?"**

*Probing:* the clean-vs-incremental-in-CI insight.

**Model answer:** "'Clean' means no stale *local* state — it does *not* have to mean recompute everything. A **shared remote cache** gives clean-build correctness at incremental-build speed: CI starts with no local state but fetches the 90%+ of actions already computed by teammates and prior runs. That's the single biggest CI optimization. On top: shard CI into parallel jobs (Amdahl — the un-shardable setup/link is the floor), don't rebuild shared libraries per shard, and measure cold vs warm cache so you know the cache's value. The mental shift is decoupling 'clean' (trust) from 'recompute everything' (cost)."

---

## Rapid-Fire Round

- **"Three levers of build performance?"** Do less work, do it in parallel, don't repeat work.
- **"Flag for parallel make?"** `-j`, e.g. `make -j$(nproc)`.
- **"Clean vs incremental?"** Clean = everything from scratch (minutes, CI's pain); incremental = only what changed (seconds, daily pain). Always say which.
- **"What's the critical path?"** Longest chain of dependent steps; the floor parallelism can't beat.
- **"Why won't `-j1000` help on 8 cores?"** Only 8 cores to run on; extra jobs queue, and you're still bounded by the critical path.
- **"Profile C++ compile time inside one file?"** `clang++ -ftime-trace -c f.cpp` → `chrome://tracing`.
- **"Fastest mainstream linker / flag?"** `mold`, via `-fuse-ld=mold`.
- **"Does LTO speed up builds?"** No — it slows builds to speed *runtime*; release-only.
- **"Why is a heavy header expensive twice?"** Parse cost per includer per build, *and* fan-out (all dependents rebuild on change).
- **"Dominant build lever at scale?"** Cache hit rate (shared remote cache).
- **"Precondition for a high cache hit rate?"** Determinism / reproducible builds.
- **"distcc vs RBE in one line?"** distcc ships compile jobs (cheap, C/C++, no hermeticity); RBE ships whole actions across a fleet (any language, requires hermeticity).
- **"C++20 modules solve what?"** The per-TU textual-include parse tax — parsed once into a BMI, imported.
- **"`extern template` does what?"** Instantiates a heavy template once instead of per TU.
- **"Leading indicator of a determinism regression?"** A drop in cache hit rate.

---

## Red Flags Interviewers Listen For

- **"Just add more cores / buy a faster CPU."** Reflexive hardware, ignores the critical path, fan-out, and caching. Hardware is the *last* lever.
- **Not knowing why `-j64` ≠ 64×.** Missing the critical path / Amdahl is the single biggest tell of shallow understanding.
- **Optimizing without profiling.** "I'd rewrite the file I think is slow." No measurement, no critical-path awareness.
- **Quoting one build-time number.** Conflating clean and incremental; they're different problems with different fixes.
- **Thinking caching is just `ccache` on one machine.** Missing the *shared remote cache* and that determinism is its precondition — the whole at-scale story.
- **Wanting RBE without hermeticity.** Not knowing the prerequisite, or that the failure mode is silent *wrong* output, not just failures.
- **Enabling LTO to "make the build faster."** Backwards — LTO trades build time for runtime.
- **No business framing.** Can't turn "slow build" into recurring developer-hours and CI dollars — can't get the work funded.

---

## Summary

- The unifying frame to lead with: **three levers (do less / parallel / don't repeat); parallelism is bounded by the critical path and Amdahl's law; profile before optimizing; at scale the dominant lever is cache hit rate, which requires determinism.** Apply it to whatever question is asked.
- The **critical path** is the make-or-break concept: it's why `-j64` isn't 64×, why you optimize the longest dependent chain (not the biggest total), and why Amdahl caps speedup at `1/(1−p)`.
- **Profile before optimizing**, with the real tools: `-ftime-trace` inside a TU, ninja/bazel timelines across files, `make -d` for "why did it rebuild." Find the slowest thing *on the critical path*, then frontend vs backend.
- **C++ cost is structural** (textual includes, per-TU template instantiation): forward decls and IWYU help both build kinds; PCH/unity help clean but hurt incremental; modules are the strategic fix. The **linker** is serial, on the critical path, paid every build — `-fuse-ld=mold` is the cheapest big win; LTO is release-only.
- **At scale, cache hit rate dominates** (shared remote cache, determinism as precondition), and scaling beyond one machine means **distcc** (cheap, C/C++) or **RBE** (powerful, requires hermeticity — watch for silent wrong output).
- **The economics** close the deal: recurring developer-hours and CI dollars, the velocity argument, and SLOs + a regression gate so the win doesn't rot. The design scenarios all reward *measure → diagnose → fix in leverage order* over jumping to a fix.

---

## Related Topics

- [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md) — the full depth behind every answer here.
- [02 — Dependency Graphs](../02-dependency-graphs/senior.md) — the critical path and parallelism.
- [07 — Build Caching](../07-build-caching/senior.md) — cache hit rate, the at-scale lever.
- [05 — Polyglot/Hermetic Builds](../05-polyglot-hermetic-builds/senior.md) — hermeticity, the RBE prerequisite.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — determinism, the precondition for caching.
- [01 — Build Fundamentals](../01-build-fundamentals/senior.md) — linkers and link-time mechanics.
