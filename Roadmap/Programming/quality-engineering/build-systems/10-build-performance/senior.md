# Build Performance — Senior Level

> **Roadmap:** [Build Systems](../README.md) → Build Performance
> *At scale the lever stops being your CPU and becomes your cache hit rate. Amdahl's law sets the ceiling on parallelism; the critical path sets the floor; and the only way to drop below it is to stop computing things — or to compute them on someone else's machines.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Amdahl's Law on the Build Graph](#amdahls-law-on-the-build-graph)
3. [Reading a Build Profile in Anger](#reading-a-build-profile-in-anger)
4. [C++ Build Costs: Templates, Includes, Modules](#c-build-costs-templates-includes-modules)
5. [Faster Linkers and the Link Critical Path](#faster-linkers-and-the-link-critical-path)
6. [Cache Hit Rate: The Dominant Lever at Scale](#cache-hit-rate-the-dominant-lever-at-scale)
7. [Distributed Compilation vs Remote Execution](#distributed-compilation-vs-remote-execution)
8. [The Clean-vs-Incremental Tradeoff in CI](#the-clean-vs-incremental-tradeoff-in-ci)
9. [Mental Models](#mental-models)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What governs build speed at scale, and where should a senior engineer actually spend the optimization budget?**

At the middle level you can profile a build and shorten its critical path. The senior level is about *judgment under constraint*: you have finite time and a build that's slow in several places at once. Which one do you fix? The answer comes from a small set of quantitative ideas applied honestly.

Amdahl's law tells you the *ceiling* parallelism can ever reach — and it's brutally low when a serial fraction remains. The critical path tells you the *floor*. Together they bound the entire problem: no amount of hardware or cleverness moves a build outside `[critical path, total-work / cores]`. Once you accept that, the highest-leverage move at scale is rarely "go faster" — it's "stop computing things," which means **cache hit rate**, and beyond that, "compute on more machines," which means **distributed or remote execution**.

This page is the senior's decision framework: read the profile, identify the binding constraint (work? parallelism? critical path? cache?), and spend effort where the math says it pays.

---

## Amdahl's Law on the Build Graph

Amdahl's law, stated for builds: if a fraction `p` of your build's work is parallelizable and `(1 − p)` is irreducibly serial, then with `N` cores the best possible speedup is

```
  speedup(N) = 1 / ( (1 − p) + p/N )

  as N → ∞:  speedup → 1 / (1 − p)
```

The consequence is harsh. If just **10%** of your build is serial (`p = 0.9`), then *infinite* cores give you at most a **10× speedup** — never more. If 25% is serial, your ceiling is **4×**, no matter how big your build farm. The serial fraction, not the core count, dominates once you have a handful of cores.

What is "serial" in a build? Anything on the critical path that can't overlap: code generation that must finish before compilation, a single huge translation unit feeding the link, the link step itself, sequential test phases, `configure` scripts. These are the `(1 − p)` that caps everything.

```
  build = 200 CPU-minutes total
          180 min parallelizable across files
           20 min serial (codegen 5 + the one 8-min TU + 7-min link)

  16 cores:  ~180/16 + 20  =  ~31 min   (not 200/16 = 12.5!)
  ∞  cores:           0 + 20  =   20 min   (the serial floor — your critical path)
```

> **Key insight:** Before buying a bigger build farm, estimate your serial fraction. If 20% of your build is serial, doubling your cores from 32 to 64 barely moves the needle — you're already near the `1/(1−p)` ceiling. The high-leverage move is to *attack the serial fraction*: parallelize codegen, split the giant TU off the critical path, use a faster (multi-threaded) linker, run tests concurrently. Reducing the serial fraction raises the ceiling for *every* core count at once.

---

## Reading a Build Profile in Anger

Given a real profile, a senior reads it in a fixed order, because the order encodes the leverage.

**1. Find the critical path, not the biggest sum.** A ninja trace (`ninjatracing .ninja_log`) or `bazel build --profile` opened in `chrome://tracing` lays every step on a timeline. The *total time spent compiling* is irrelevant if it's well-parallelized — what matters is the **longest unbroken chain from start to finish**. Look for the steps that, if removed, would let everything after them start earlier.

**2. Look for idle gaps.** Stretches where cores sit empty mean a *serialization point*: everything is waiting on one step (often codegen or a long-pole TU) before the next wave can start. Idle cores are wasted parallelism — the gap *is* the serial fraction made visible.

**3. Localize the long pole.** Once you've found the step on the critical path that dominates, X-ray *inside* it with `clang -ftime-trace` → `chrome://tracing`. The flame view splits the cost into **Frontend** (parsing headers, instantiating templates) vs **Backend** (optimization, codegen). This tells you whether the fix is include hygiene (frontend) or `-O` level / codegen (backend).

```bash
# whole-build timeline → find the long pole and idle gaps
ninja && ninjatracing .ninja_log > trace.json     # open in chrome://tracing
# inside the long-pole TU → frontend vs backend
clang++ -ftime-trace -c long_pole.cpp              # open long_pole.json
# aggregate across the build: which files / templates dominate?
# (ClangBuildAnalyzer ingests all the .json traces and ranks the worst offenders)
ClangBuildAnalyzer --all . capture.bin && ClangBuildAnalyzer --analyze capture.bin
```

`ClangBuildAnalyzer` is the senior's aggregate tool: it reads every `-ftime-trace` output across the build and ranks the most expensive headers, the most-instantiated templates, and the slowest functions to compile — turning thousands of traces into a prioritized hit list.

> **Key insight:** Reading a profile is not "find the slowest thing." It's "find the slowest thing *on the critical path*, then determine whether its cost is frontend or backend." A 30-second file that runs fully in parallel with everything else is not your problem; a 6-second file that the link step waits on *is*. Leverage lives on the critical path; everything off it is a distraction.

---

## C++ Build Costs: Templates, Includes, Modules

C++ is the worst-case build-performance language, and the costs have specific names a senior can attack individually.

**Template instantiation.** Every distinct instantiation (`std::vector<MyType>`, `std::map<K,V>`) is compiled *fresh in every TU that uses it* — there's no cross-TU memoization in the classic model. Heavy template metaprogramming and deep instantiation chains can dominate frontend time. `ClangBuildAnalyzer` ranks the worst-instantiated templates; `extern template` declarations move an instantiation to *one* TU and suppress it elsewhere:

```cpp
// in a header: tell every TU "don't instantiate this; someone else will"
extern template class std::vector<MyHeavyType>;
// in exactly ONE .cpp: force the single instantiation
template class std::vector<MyHeavyType>;
```

**Includes.** Covered at middle level: a heavy header is parsed once per includer per build, and changing it fans out to every dependent. Include-what-you-use (the `iwyu` tool) finds headers you include but don't need; forward declarations cut real dependency edges.

```bash
include-what-you-use -Xiwyu --no_comments app.cpp   # flags unnecessary includes
```

**Unity builds and PCH** trade clean speed for incremental fan-out (middle level). At scale you tune the unity *group size* — bigger groups = faster clean, worse incremental — per the team's pain point.

**C++20 modules** are the structural fix. A module is compiled once into a binary module interface (BMI) and *imported* — parsed once, reused everywhere — instead of textually re-included per TU. This collapses the per-includer parse tax that has defined C++ build times for decades:

```cpp
// math.cppm — compiled once to a BMI
export module math;
export int add(int, int);

// consumer.cpp — imports the prebuilt interface; no re-parse of math's internals
import math;
```

Modules eliminate the textual-inclusion model's quadratic parse cost, but adoption is gated on toolchain and build-system support (CMake + Clang/MSVC are maturing; dependency scanning for modules is itself a build-graph problem).

> **Key insight:** C++ build cost is structural — it comes from textual inclusion (parse-per-TU) and per-TU template instantiation. Tactical fixes (forward decls, IWYU, `extern template`, PCH, unity) chip at the symptoms; **modules** attack the cause. A senior picks tactics for today's codebase and tracks modules as the strategic exit from the include tax — but doesn't bet a deadline on bleeding-edge module support.

---

## Faster Linkers and the Link Critical Path

The link step is serial, sits at the end of the critical path, and is paid on *every* build including incremental ones (recompile one file → relink everything). It's therefore one of the highest-leverage targets, and the fix is usually a flag, not a refactor.

```bash
g++  *.o -fuse-ld=mold -o app      # mold: multi-threaded, currently fastest mainstream
clang++ *.o -fuse-ld=lld -o app    # lld: LLVM's linker, much faster than ld.bfd
# verify which linker actually ran:
readelf -p .comment app | grep -i 'ld\|mold\|lld'
```

Beyond swapping linkers:

- **Split debug info** (`-gsplit-dwarf`) keeps debug data out of the object files the linker has to crunch, shrinking link input.
- **Link-time optimization (LTO)** *increases* link time (it moves optimization into the link) — a runtime-perf vs build-time tradeoff. Use *thin* LTO (`-flto=thin`) to keep it parallel and far cheaper than monolithic LTO.
- **Fewer, smaller link units** — if you relink a 2 GB monolith on every change, consider splitting into shared libraries so a change relinks only one. (This trades load-time cost for link-time speed — see [Fundamentals](../01-build-fundamentals/senior.md).)

> **Key insight:** Because the linker runs on every incremental build's critical path, link speed often dominates *iteration* speed more than compile speed does. `mold`/`lld` via `-fuse-ld=` is the cheapest large win in the entire build-performance toolbox. And beware LTO: it's a *runtime* optimization that *taxes build time* — never enable it for fast-iteration dev builds, only for release.

---

## Cache Hit Rate: The Dominant Lever at Scale

Here is the lever that dwarfs all others on a large codebase or a busy CI fleet: **don't compute what you've already computed.** A build cache ([07 — Build Caching](../07-build-caching/senior.md)) stores the output of each compile/action keyed by a hash of all its inputs (source, flags, compiler version, included headers). On a cache *hit*, the result is fetched instead of recomputed.

```bash
# ccache: drop-in compiler wrapper, content-addressed
export CC="ccache gcc"
ccache -s          # statistics: hit rate, size — the number that matters
# cacheable, hit rate, miss → recompiled

# bazel / build systems with a remote cache shared across the whole team + CI
bazel build //... --remote_cache=grpc://cache.internal:9092
```

The economics flip at scale. With a **shared remote cache**, work compiled once by *anyone* — a teammate, a previous CI run, the nightly build — is reused by *everyone*. A CI clean build that would take 25 minutes becomes 3 minutes because 90% of its actions are cache hits from earlier runs. The dominant variable is no longer your CPU count; it's your **cache hit rate**.

This is why senior build engineers obsess over hit rate, and why it's so fragile:

- **Determinism is the precondition.** If the same input produces byte-different output (embedded timestamps, absolute paths, `__DATE__`), the *next* step's input hash changes and the cache misses — cascading. This is the hard dependency on [09 — Reproducible Builds](../09-reproducible-builds/senior.md).
- **Over-broad cache keys destroy hit rate.** If the key includes something that legitimately varies (build machine hostname, a wall-clock timestamp, an absolute path), every build is a miss. Key on *content that affects the output*, nothing more.
- **A 70% hit rate vs a 95% hit rate** is often a larger build-time difference than doubling your cores — because the 25% gap is full recompilation.

> **Key insight:** At scale, build performance *is* cache-hit-rate engineering. Going from 70% to 95% hit rate eliminates most of your remaining compute — a bigger win than any reasonable hardware upgrade. But the cache only works if builds are *deterministic* and keys are *exactly as broad as the inputs that affect the output*. Reproducibility (topic 09) and caching (topic 07) are not separate concerns from performance — at scale they *are* performance.

---

## Distributed Compilation vs Remote Execution

When you've maximized cache hits and still face too much *cold* work (a true clean build, a from-scratch CI run), the next lever is computing on more machines than one. Two families, often confused:

**Distributed compilation (`distcc`, `icecc`).** A *local* build that ships individual compile jobs to other machines and links locally. The build graph, dependency tracking, and orchestration stay on your machine; only the per-file compile is offloaded.

```bash
# icecc / icecream: zero-config LAN compile farm
export CC="icecc gcc"
make -j100         # -j far above local cores: jobs fan out to the farm
# distcc: similar, explicit host list
export DISTCC_HOSTS="localhost host1 host2 host3"
make -j$(distcc -j) CC="distcc gcc"
```

This is cheap to adopt and great for C/C++, but it only parallelizes *compilation* — the graph, the cache, the link, and correctness all still live on the originating machine, and it's network-sensitive.

**Remote execution (Bazel RBE, BuildBarn, BuildBuddy).** The build system ships *entire actions* — each with its full, hermetic input set — to a remote cluster that executes them in isolation and returns outputs. This requires **hermetic builds** ([05 — Polyglot/Hermetic Builds](../05-polyglot-hermetic-builds/senior.md)): every action must declare *all* its inputs precisely, because the remote worker has *nothing* but what's declared. The payoff is enormous — hundreds or thousands of actions running in parallel across a cluster, with a shared cache, language-agnostic.

```bash
bazel build //... \
  --remote_executor=grpc://rbe.internal:8980 \
  --remote_cache=grpc://rbe.internal:8980 \
  --jobs=1000        # thousands of remote actions in flight
```

| | Distributed compilation (distcc/icecc) | Remote execution (RBE) |
|---|---|---|
| Unit shipped | one compile job | a whole hermetic action |
| Requires hermeticity? | No | **Yes** — all inputs declared |
| Languages | mainly C/C++ | any (it's action-agnostic) |
| Shared cache | external (e.g. + ccache) | built-in, content-addressed |
| Adoption cost | low (a wrapper + hosts) | high (hermetic build, infra) |
| Ceiling | parallelizes compile only | parallelizes the *whole graph* |

> **Key insight:** distcc/icecc is a *cheap, local* speedup for C/C++ clean builds — reach for it first when the barrier is low. Remote execution is a *strategic platform* investment: it parallelizes the entire build graph across a fleet and shares one cache, but it demands hermetic builds (topic 05) as the entry fee. Choose based on the entry cost you can pay and whether your build is already hermetic — you can't bolt RBE onto a non-hermetic build.

---

## The Clean-vs-Incremental Tradeoff in CI

Local dev lives on *incremental* builds; CI traditionally does *clean* builds for trust (no stale state, reproducible). That clean-build cost is what most CI optimization targets, and the levers differ from local dev:

- **A remote cache turns CI's clean build into a mostly-cached build.** CI starts with no local state, but with a shared cache it fetches the 90%+ of actions already computed elsewhere — getting clean-build *trust* at near-incremental *speed*. This is the single most important CI build optimization.
- **Sharding and fan-out.** Split CI into parallel shards (per target, per test suite) so wall-clock time is `total / shards` (Amdahl applies — the un-shardable setup/link is your floor).
- **Don't relink the world per shard.** A common waste: every CI shard rebuilds shared libraries from scratch. Cache or pre-build them.
- **Warm vs cold cache.** A *cold* CI runner (fresh container, empty cache) pays full price; a *warm* one (persisted or remote cache) pays little. The gap between cold and warm is exactly your cache's value — measure both.

> **Key insight:** CI's clean build is non-negotiable for trust, but "clean" doesn't have to mean "recompute everything." A **shared remote cache** gives you clean-build correctness at incremental-build speed, because clean only means "no stale local state" — not "no reuse." The biggest CI win at scale is almost always raising the cache hit rate on the clean build, not adding more CI cores.

---

## Mental Models

- **Amdahl is the ceiling; the critical path is the floor.** Parallelism lives in the band between `1/(1−p)` (ceiling) and the critical-path length (floor). To raise the ceiling, shrink the serial fraction. To lower the floor, shorten the longest chain. Adding cores does neither past a point.

- **At scale, you stop optimizing speed and start optimizing *avoidance*.** The fastest compile is the one that's a cache hit. Beyond a certain size, hit rate dominates core count, and reproducibility becomes a *performance* feature because non-determinism murders hit rate.

- **The profile is a map; the critical path is the road.** Off-path work, however large, is scenery. Always optimize the road.

- **distcc is renting hands; RBE is moving to a factory.** distcc lends you extra hands for the compile step. RBE rebuilds your whole production line in a shared facility — far more powerful, but you must package every job hermetically before it can leave your building.

---

## Common Mistakes

1. **Adding cores when the serial fraction is the cap.** If `p = 0.8`, your ceiling is 5× no matter the core count. Measure the serial fraction *before* scaling hardware; attack the serial steps instead.

2. **Optimizing the biggest file instead of the critical-path file.** A 40-second compile that overlaps everything else costs you nothing. Read the timeline; optimize what the *link* (or the next wave) waits on.

3. **Enabling LTO on dev builds.** LTO trades build time for runtime speed. On fast-iteration dev builds it's pure loss — use thin LTO only for release artifacts.

4. **Chasing cache misses caused by non-determinism.** A low hit rate "for no reason" is usually embedded timestamps, absolute paths, or unstable ordering breaking input hashes. Fix determinism ([09](../09-reproducible-builds/senior.md)) before blaming the cache.

5. **Trying to adopt remote execution without hermeticity.** RBE workers see only declared inputs. A build that implicitly relies on system headers, ambient tools, or undeclared files will fail or, worse, silently produce wrong results remotely. Hermeticity ([05](../05-polyglot-hermetic-builds/senior.md)) is the entry fee, not an add-on.

6. **Treating clean CI builds as un-cacheable.** "Clean" means no stale local state, not no reuse. A remote cache gives clean correctness at incremental speed; teams that skip it pay full compile price on every PR.

---

## Test Yourself

1. Your build is 15% serial. What's the maximum speedup from parallelism, even with infinite cores? What's the lever that raises that ceiling?
2. You open a ninja timeline. What do you look for *first*, and why is "total time spent compiling" the wrong number?
3. Name the C++ structural cost that `extern template` addresses, and the one that C++20 modules address.
4. Why does link speed often matter more for *iteration* speed than compile speed?
5. Your remote cache hit rate is 60% and you can't figure out why builds keep missing. What's the most likely root cause, and which topic does the fix live in?
6. A teammate wants remote execution (RBE) for your non-hermetic build. Why won't it work as-is, and what's the prerequisite?

<details>
<summary>Answers</summary>

1. Ceiling = `1/(1−p) = 1/0.15 ≈ 6.7×` — infinite cores can't beat ~6.7×. The lever that raises the ceiling is **reducing the serial fraction** (parallelize codegen, split the long-pole TU off the critical path, use a multi-threaded linker, run tests concurrently); lowering `p` raises the ceiling for every core count at once.
2. Look for the **critical path** — the longest unbroken chain from start to finish — and the **idle gaps** (serialization points). Total compile time is irrelevant when well-parallelized; only the longest dependent chain bounds wall-clock time, so optimizing off-path work yields nothing.
3. `extern template` addresses **redundant template instantiation** (the same instantiation compiled fresh in every TU) by forcing it into one TU. **C++20 modules** address **textual inclusion / per-TU header parsing** — a module's interface is parsed once into a BMI and imported, instead of re-parsed per includer.
4. Because the link step is serial, on the critical path, and paid on **every incremental build**: you recompile one file in seconds, then relink the *whole* program. So link time is a fixed tax on every iteration, where compile time scales with how much you changed. A faster linker (`mold`/`lld`) speeds up all iterations.
5. Most likely **non-determinism** breaking input hashes — embedded timestamps, absolute paths, `__DATE__`, unstable ordering — so the same logical input hashes differently and misses. The fix lives in [09 — Reproducible Builds](../09-reproducible-builds/senior.md): make outputs byte-identical so hashes are stable.
6. RBE workers execute each action in isolation with **only its declared inputs** — they have none of your machine's ambient state. A non-hermetic build that implicitly depends on system headers, installed tools, or undeclared files will fail remotely or produce wrong output. The prerequisite is **hermeticity** ([05 — Polyglot/Hermetic Builds](../05-polyglot-hermetic-builds/senior.md)): every action must declare all its inputs precisely.

</details>

---

## Cheat Sheet

```
AMDAHL (the ceiling)        speedup = 1/((1−p) + p/N) ;  N→∞ ⇒ 1/(1−p)
  p=0.9 → max 10×    p=0.8 → max 5×    p=0.75 → max 4×
  serial fraction dominates past a few cores → ATTACK THE SERIAL PART
CRITICAL PATH (the floor)   longest dependent chain = min wall-clock time

READ A PROFILE (in order)
  1. critical path (longest chain), NOT biggest sum
  2. idle gaps = serialization points
  3. X-ray long pole: clang -ftime-trace → frontend(parse/template) vs backend(codegen)
  ninja && ninjatracing .ninja_log > trace.json   # whole-build timeline
  ClangBuildAnalyzer --analyze capture.bin          # worst headers/templates ranked

C++ COSTS
  templates  → extern template (instantiate once)
  includes   → forward-decl, include-what-you-use (iwyu)
  PCH/unity  → faster CLEAN, worse INCREMENTAL
  modules    → kill per-TU parse tax (export module / import) — strategic fix

LINK (serial, every build, critical path)
  -fuse-ld=mold / -fuse-ld=lld   cheapest big win
  -gsplit-dwarf                  shrink link input
  -flto=thin                     LTO without serial blowup (RELEASE only)

CACHE HIT RATE = dominant lever at scale
  ccache -s                      watch the hit rate
  bazel --remote_cache=...       shared across team + CI
  70%→95% hit rate > doubling cores
  precondition: DETERMINISM (topic 09); keys exactly as broad as real inputs

MORE MACHINES
  distcc / icecc   ship compile jobs   | no hermeticity | C/C++ | low cost
  RBE (bazel)      ship whole actions  | REQUIRES hermeticity (topic 05) | any lang

CI
  clean ≠ recompute-all → remote cache = clean trust at incremental speed
  shard for parallelism; don't relink shared libs per shard; warm vs cold cache gap
```

---

## Summary

- **Amdahl's law** caps parallel speedup at `1/(1−p)`; a 20% serial fraction limits you to 5× regardless of cores. The **critical path** is the floor. Together they bound the build, and the high-leverage move is shrinking the *serial fraction* — not buying cores.
- **Read a profile** in a fixed order: critical path first (not the biggest sum), then idle gaps (serialization), then X-ray the long pole with `-ftime-trace` to split frontend (parse/template) from backend (codegen). `ClangBuildAnalyzer` ranks the worst offenders across the whole build.
- **C++ costs are structural:** template instantiation (`extern template`), textual includes (forward decls, IWYU, PCH/unity tradeoffs), and the underlying parse-per-TU tax that **C++20 modules** finally attack at the cause.
- **Link time** is serial, on the critical path, and paid every build — `-fuse-ld=mold`/`lld` is the cheapest large win; LTO is a release-only runtime tradeoff that *taxes* build time.
- **At scale, cache hit rate dominates.** A shared remote cache reuses anyone's prior work; 70%→95% hit rate beats doubling cores. Its precondition is **determinism** ([09](../09-reproducible-builds/senior.md)) and precisely-scoped keys.
- **More machines:** `distcc`/`icecc` ship compile jobs cheaply (no hermeticity, C/C++); **remote execution** ships whole actions across a fleet with a shared cache but *requires hermetic builds* ([05](../05-polyglot-hermetic-builds/senior.md)). **CI's clean build** isn't un-cacheable — a remote cache buys clean-build trust at incremental speed.

The [professional.md](professional.md) reframes all of this as an org-level investment: build-time budgets and SLOs, instrumenting builds in CI, computing developer-hours and CI-dollars saved, and the war stories of rollouts that cut 45-minute builds to 4.

---

## Further Reading

- Gene Amdahl, "Validity of the single processor approach…" (1967) — the original; the build framing is a direct application.
- Aras Pranckevičius, "Investigating compile times" and `ClangBuildAnalyzer` — the practical C++ profiling playbook.
- [Bazel Remote Execution](https://bazel.build/remote/rbe) and the Remote Execution API — the protocol behind RBE.
- [`ccache` manual](https://ccache.dev/manual/latest.html) and [`mold` README](https://github.com/rui314/mold) — the two cheapest big wins, documented.
- "C++20 Modules" (cppreference) and CMake's module support docs — the strategic exit from the include tax.

---

## Related Topics

- [07 — Build Caching](../07-build-caching/senior.md) — cache hit rate, the dominant lever; how content-addressed caching works.
- [05 — Polyglot/Hermetic Builds](../05-polyglot-hermetic-builds/senior.md) — hermeticity, the prerequisite for remote execution.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — determinism, the precondition for a high cache hit rate.
- [02 — Dependency Graphs](../02-dependency-graphs/senior.md) — the graph that defines the critical path and parallelism.
- [01 — Build Fundamentals](../01-build-fundamentals/senior.md) — linkers, LTO, and link-time mechanics.
- [Performance](../../performance/README.md) — Amdahl's law and profiling as a general discipline.
