# CPU-Bound Optimization — Professional Level

> **Roadmap:** [Performance](../README.md) → CPU-Bound Optimization
> *The senior page taught you to find and fix the hot path. This page is about deciding whether you should — when a 5% CPU win pays an engineer's salary and when it's a vanity metric, how to feed production profiles back into your compiler, and how to drop to a Rust kernel without your on-call rotation paying for it later. CPU here stops being a flame graph and becomes a line on a cloud bill.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The ROI of CPU Work — Cycles as Dollars](#the-roi-of-cpu-work--cycles-as-dollars)
4. [Optimization Altitude — Start at the Top](#optimization-altitude--start-at-the-top)
5. [Profile-Guided Optimization in a Production Pipeline](#profile-guided-optimization-in-a-production-pipeline)
6. [Language and Runtime Choice as a CPU Lever](#language-and-runtime-choice-as-a-cpu-lever)
7. [Compiler and Flag Governance](#compiler-and-flag-governance)
8. [Dropping to a Native Kernel — and Wrapping It Safely](#dropping-to-a-native-kernel--and-wrapping-it-safely)
9. [The Maintainability Cost of Fast Code](#the-maintainability-cost-of-fast-code)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **CPU optimization as an engineering and economic decision at fleet scale — where the question is not "can I make this faster?" but "is making this faster the best use of an engineer-month?"**

The senior page framed CPU optimization as a craft: read the flame graph, find the hot function, fix the algorithm or the allocation, measure the delta. That skill is necessary and assumed here. What it doesn't tell you is whether the work was *worth it* — and at the professional level, that's the entire question.

At scale, CPU is money in the most literal sense. A service running 4,000 cores at roughly $0.03/core-hour is burning about **$1.05M/year** in compute. A 5% CPU reduction on that service is **~$52K/year** — recurring, every year, for as long as the service runs. That changes the math on a two-week optimization sprint from "nice to have" to "pays for itself in a quarter." It also means the inverse: spending an engineer-month shaving 5% off a service that costs $8K/year in compute is a clear loss, no matter how satisfying the flame graph looks afterward.

This page is about that judgment, and about the production machinery that makes high-leverage CPU work cheap: **profile-guided optimization** that lets the compiler do the work using real traffic, **deliberate choice of optimization altitude** so you don't hand-vectorize a loop that an O(n²)→O(n log n) change would have deleted, **language and runtime selection** as a coarse but powerful CPU lever, **flag governance** so `-O3` and `-march=native` don't quietly break your fleet, and the discipline of **isolating a hot native kernel** so its complexity stays in a box the rest of the team never has to open.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — reading flame graphs, finding hot paths, algorithmic vs allocation vs micro-architectural fixes, `benchstat`/JMH/criterion for honest deltas.
- **Required:** You've shipped a measured optimization and verified the win in production, not just on your laptop.
- **Helpful:** You've owned a service's cloud bill, or at least seen the line item for the team you're on.
- **Helpful:** You've maintained code someone else "optimized" and had to reverse-engineer why it looked the way it did.

---

## The ROI of CPU Work — Cycles as Dollars

Before any CPU optimization, do the arithmetic. The unit that matters is **cost saved per engineer-time spent**, and it's almost always estimable to within a factor of two before you write a line of code.

The model is simple. Take the service's steady-state core count (from your autoscaler or capacity dashboard), multiply by the effective per-core-hour cost (on-demand list price is the ceiling; with reserved/spot/committed-use discounts the *effective* rate is often $0.01–0.02/core-hour), and you have annual compute cost. A CPU reduction that lets the autoscaler hold the same SLO with fewer cores converts directly into that percentage of the bill — **but only if the service is actually CPU-bound at its scaling boundary.** If your autoscaler scales on memory, connection count, or a fixed replica floor, a CPU win buys you nothing on the bill; it buys headroom, which has value but is not cash.

```
Annual compute  = cores × $/core-hour × 8760
                = 4000 × $0.03 × 8760  ≈ $1,050,000
5% CPU win      ≈ $52,500/yr  (recurring)  → pays a sprint in one quarter
5% on an $8K/yr service ≈ $400/yr          → an engineer-month loses ~$15K net
```

Three refinements separate the professional estimate from the napkin one:

- **Does the win remove capacity, or just headroom?** Only wins that the autoscaler can act on (CPU is the binding constraint) become dollars. Confirm what your HPA / scaling policy actually keys on.
- **Is the win at the scaling boundary or in the noise?** A 30% speedup in a function that's 2% of total CPU is a 0.6% service win. Amdahl governs the bill exactly as it governs latency — optimize what dominates the *aggregate* profile, not what's locally ugliest.
- **Does the win persist?** A one-time win that regresses in three releases (no [regression gate](../07-performance-budgets-and-regression-testing/professional.md)) is a depreciating asset. A 5% win protected by a CI benchmark gate is the one that actually pays the salary year after year.

> **The professional framing:** "premature optimization" isn't about *when in the code's life* you optimize — it's about *optimizing before you've shown the work has positive ROI.* The senior who hand-tunes a SIMD loop on a service that costs $5K/year hasn't been clever; they've spent a $15K engineer-month to save $250. Do the multiplication first. It takes five minutes and it's the highest-leverage thing on this page.

---

## Optimization Altitude — Start at the Top

CPU wins live at four altitudes, and the cost-to-benefit ratio is brutally non-linear across them. You almost always start at the top and descend only when forced.

| Altitude | Example | Typical win | Maintainability cost |
|---|---|---|---|
| **Algorithm / complexity** | O(n²) → O(n log n); cache a recomputed result; batch N calls into 1 | 10×–1000× | Often *lowers* it (less code) |
| **Data structure** | `map` → slice + binary search; B-tree → hash; pointer-chasing → flat array | 2×–10× | Neutral to slightly higher |
| **Memory layout** | AoS → SoA; pad to avoid [false sharing](../06-concurrency-and-contention/professional.md); arena allocation | 1.2×–3× | Higher — reads less obviously |
| **Micro-architecture** | SIMD intrinsics, branch elimination, manual loop unrolling, prefetch hints | 1.1×–2× | Much higher — and fragile across CPUs |

The reason to start high is that the top of this table dominates the bottom *and* costs less to maintain. An O(n²)→O(n log n) change at n=10⁴ is a 700× algorithmic win; the best hand-vectorized inner loop will get you maybe 4×. If you vectorize first, you've spent your hardest engineering on the quadratic loop — and the moment someone fixes the algorithm, your SIMD code is deleted, having earned nothing.

The discipline:

- **Profile the aggregate, then ask "why is this hot at all?" before "how do I make this instruction faster?"** Frequently the hot function shouldn't be called as often as it is — a caching or batching change at a higher altitude deletes the hotspot entirely.
- **Exhaust each altitude before descending.** Only reach for memory layout once the algorithm and data structures are right; only reach for intrinsics once layout is right. Each step down roughly doubles maintenance cost for a fraction of the win.
- **Let the compiler own the bottom altitude where it can.** Auto-vectorization, inlining, and PGO (next section) cover much of the micro-arch altitude *for free and portably*. Hand-written intrinsics are the last resort, justified only when the compiler provably can't and the kernel is hot enough to matter.

> **The trap, named:** "micro-optimization theater" is descending to the bottom altitude because it *feels* like hardcore performance work, while an algorithmic fix two altitudes up sits ignored. The flame graph tells you *where* the time goes; it does not tell you *which altitude* to fix it at. That judgment is yours, and it's where most CPU effort is wasted.

---

## Profile-Guided Optimization in a Production Pipeline

PGO (also AutoFDO / feedback-directed optimization) is the highest-leverage CPU lever most teams never turn on. The idea: a compiler optimizing blind has to *guess* which branches are taken, which functions are hot, and what to inline. Feed it a **profile of real execution** and it stops guessing — it lays out hot code contiguously, inlines along hot paths, and arranges branches so the common case falls through. Typical wins are **5–15% CPU, fleet-wide, for near-zero ongoing engineering cost.** That is often the single largest line-item-to-effort ratio available.

The production pattern is a closed loop: **collect profiles from prod → store them → feed them into the build.**

**Go (since 1.21)** makes this almost trivial — a `default.pgo` next to `main` is picked up automatically:

```bash
# 1. Collect a representative CPU profile from production (e.g. via pprof endpoint)
curl -o cpu.pprof "http://prod-host:6060/debug/pprof/profile?seconds=60"

# 2. Commit it as default.pgo (or wire it into the build); go build finds it automatically
cp cpu.pprof ./cmd/server/default.pgo
go build ./cmd/server      # PGO-optimized, no flags needed

# 3. Verify the win against the non-PGO baseline
benchstat baseline.txt pgo.txt   # expect ~2-14% on hot paths
```

**LLVM (C/C++/Rust) AutoFDO + BOLT** is the heavier-duty version that Google, Meta, and others run at scale:

```bash
# AutoFDO: collect with perf (LBR), convert to LLVM profile, rebuild
perf record -e cycles:u -j any,u -- ./server --bench   # sample with branch stacks
create_llvm_prof --binary=./server --out=app.afdo --profile=perf.data
clang -O2 -fprofile-sample-use=app.afdo -o server app.c

# BOLT: a post-link optimizer — re-orders the *already-linked* binary using the same profile
perf2bolt -p perf.data -o app.fdata ./server
llvm-bolt ./server -o server.bolt -data=app.fdata \
  -reorder-blocks=ext-tsp -reorder-functions=hfsort -split-functions
```

The professional concerns are operational, not theoretical:

- **Profile freshness and representativeness.** A profile from last quarter's traffic mix, or from a synthetic load test that doesn't match prod, can *mis*-optimize — laying out the wrong paths as hot. Refresh profiles on a cadence (e.g., weekly, sampled across the fleet and time-of-day), and treat the profile as a versioned build input like any other.
- **Build determinism.** A profile makes the build a function of *that profile*. Pin it, store it in artifact storage, and record which profile produced which binary, so a build is reproducible and a regression is bisectable. This is the same hermeticity discipline as toolchain pinning.
- **Stale-profile safety.** Both Go and LLVM tolerate a profile that no longer matches the source (a renamed function just doesn't get its hint) — it degrades to "no worse than non-PGO," it doesn't break. But a *systematically* stale profile silently caps your wins; monitor the realized delta.
- **Sampling overhead in prod.** Continuous profilers (Google Cloud Profiler, Parca, Pyroscope, Polar Signals) sample at well under 1% overhead, which makes "collect from prod" a standing service rather than a manual `curl`. That is the mature shape: profiling is always-on, profiles flow into the build automatically, and the feedback loop closes without a human in it.

> **Why this is the first thing to try:** PGO is a *coupon for free CPU*. Before anyone hand-optimizes anything, turn on PGO and re-measure — it's hours of work for a fleet-wide percentage win, it's portable, and it's maintenance-free. Hand-tuning a function that PGO would have improved anyway is wasted effort.

---

## Language and Runtime Choice as a CPU Lever

The coarsest CPU lever is the one you usually can't pull (the code's already written) but must understand — because it sets the ceiling everything else operates under, and because it's the right lever for *new* hot services.

The dominant runtime factors:

- **GC overhead and pauses.** A garbage-collected runtime spends CPU on the collector and, more subtly, on allocation and write barriers in the mutator. Go's GC is low-pause but you pay it in throughput and allocation cost; the JVM's collectors (G1, ZGC, Shenandoah) are tunable and can be excellent, but defaults rarely fit a latency-critical service. For an allocation-heavy hot path, **GC and allocator cost can be 20–40% of total CPU** — which is why the highest-altitude memory fix is often "stop allocating," not "tune the GC."
- **Escape analysis quality.** Whether a value lands on the stack (free) or the heap (allocation + GC pressure) is decided by the compiler's escape analysis. Go's is decent but conservative; the JVM's JIT does aggressive escape analysis and scalar replacement *at runtime* once a method is hot. This is why a Java microbenchmark can beat the equivalent Go one after warm-up — the JIT eliminated allocations Go's static analysis couldn't prove safe.
- **JIT vs AOT.** A JIT (HotSpot, V8) profiles at runtime and re-optimizes hot methods with knowledge a static compiler lacks — at the cost of warm-up time and memory, and unpredictability (de-optimization stalls). AOT (Go, Rust, C++, GraalVM native-image) gives instant peak performance and predictable behavior, no warm-up, lower memory — at the cost of the runtime adaptivity. For a long-running throughput service, the JIT's warm-up amortizes to nothing and its peak is hard to beat. For a short-lived process, a serverless cold-start, or a latency-SLO service that can't tolerate warm-up jitter, AOT wins decisively.
- **No-runtime languages.** Rust and C++ have no GC and no runtime tax — what you write is roughly what runs. That's the CPU ceiling, paid for in development cost and (for C++) memory-safety risk.

> **The decision, when you actually have it:** for a *new* service whose CPU cost will be a meaningful fleet line item, language choice is the cheapest 2–5× you'll ever get — far cheaper than clawing back the same factor in micro-optimization later. A latency-critical, allocation-heavy data plane is a strong case for Rust or carefully-tuned C++; a throughput service where developer velocity dominates is a strong case for Go or a well-tuned JVM. The mistake is treating language as fixed when you're greenfielding the very service whose CPU bill you'll be optimizing for the next three years.

---

## Compiler and Flag Governance

Optimization flags are a fleet-wide policy, not a per-developer preference, and the seductive ones have sharp edges.

**`-O2` vs `-O3`.** `-O2` is the production default for a reason: it's the well-tested, broadly-beneficial optimization set. `-O3` adds aggressive auto-vectorization and inlining that *sometimes* helps and *sometimes* hurts — more aggressive inlining can blow out the instruction cache, and the extra code size can make a hot loop slower, not faster. `-O3` is also less exercised, so it surfaces more compiler bugs and more undefined-behavior landmines in your own code. **Treat `-O3` as a per-target, benchmarked decision, never a blanket default.** Measure it on the actual binary; the win is frequently zero or negative.

**`-march=native` — the portability trap.** This tells the compiler to use every instruction the *build machine's* CPU supports — AVX-512, BMI2, whatever. It's a real win on a homogeneous fleet you fully control. It's a **production incident** the day a binary built on a new CI runner (AVX-512) lands on an older host (no AVX-512) and dies with `SIGILL — illegal instruction`. The professional move is to pin an explicit, fleet-wide baseline (`-march=x86-64-v2` or `-v3`, or an explicit `-mavx2`) that you *know* every target supports, never the build machine's incidental capabilities.

```bash
# DANGER: optimizes for the build box; SIGILLs on any older host
clang -O2 -march=native -o server app.c

# SAFE: explicit baseline every host in the fleet is guaranteed to support
clang -O2 -march=x86-64-v3 -o server app.c   # AVX2/BMI2 baseline, fleet-pinned

# Runtime dispatch: ship one binary, pick the best path per host
#   compile multiple versions of a hot kernel, choose at startup via CPUID
clang -O2 -mavx2 -DKERNEL_AVX2 ... ; clang -O2 -DKERNEL_SCALAR ...   # selected at runtime
```

**LTO (link-time optimization).** Cross-module inlining and dead-code elimination across the whole program — a real CPU and binary-size win, and it composes with PGO (PGO tells LTO *what* to inline). The cost is build time (full/monolithic LTO can be very slow; thin-LTO is the scalable middle ground) and harder debugging. **ThinLTO + PGO is the modern production combination** for C++/Rust release builds; reserve full LTO for the rare case where the extra cross-module work measurably pays.

> **The governance reality:** these flags belong in a shared, reviewed build template — never copy-pasted per-project where they drift, and never set to the build machine's capabilities. A security review or a postmortem will eventually ask "why did this binary SIGILL on 15% of the fleet?" and the answer should never be "someone left `-march=native` in a Makefile." Pin the baseline, benchmark `-O3`/LTO per target, and verify the emitted ISA in CI.

---

## Dropping to a Native Kernel — and Wrapping It Safely

Sometimes the algorithm is optimal, the layout is tuned, PGO is on, and the hot kernel is *still* the bottleneck — and the host language's runtime is the ceiling. That's when you drop one hot kernel to C, Rust, or hand-written assembly. The skill is not writing the kernel; it's **containing it** so its complexity and risk never leak into the rest of the codebase.

When it's justified:

- The kernel is a *measured* dominant fraction of CPU (Amdahl: a 10× win on 2% of CPU isn't worth a new language boundary).
- The work is tight, numeric, branch-light, or SIMD-friendly — exactly what a managed runtime is worst at and what intrinsics are best at.
- PGO and higher altitudes are exhausted; the remaining win provably requires instructions or memory control the host language won't emit.

How to wrap it safely:

- **Isolate it behind a stable, narrow interface.** One function, one well-documented contract (preconditions, alignment, length invariants), with a *pure-host-language reference implementation kept alongside it.* The reference is your correctness oracle and your fallback.
- **Differential-test the kernel against the reference** with property-based / fuzz inputs, on every CI run. A hand-written SIMD kernel that's right for the cases you thought of and wrong for the tail is the classic, dangerous bug.
- **Pay the FFI tax knowingly.** Crossing the Go cgo boundary or the JNI boundary has real per-call overhead (cgo is roughly tens of nanoseconds; JNI similar) and can pessimize the scheduler/GC (a cgo call occupies an OS thread). **Batch across the boundary** — call the kernel once per 10⁴ elements, not once per element — or the boundary cost eats the kernel win.
- **Contain the unsafety.** In Rust, the `unsafe` block is the box; keep it tiny, audited, and wrapped in a safe API. In C, the kernel is the one place memory-safety bugs can live, so it gets the heaviest review and the fuzzing. Document, at the call site, *why* this exists and what would let you delete it.

> **The maintainability contract:** a native kernel is a debt you take on deliberately and pay down in documentation and tests. The rest of the team should be able to use it through a safe, obvious interface without ever reading the intrinsics — and a future engineer should find a comment explaining the benchmark that justified it, the reference implementation that validates it, and the conditions under which it can be ripped out. A hot kernel without that scaffolding is a landmine, not an optimization.

---

## The Maintainability Cost of Fast Code

Every optimization below the algorithmic altitude trades readability for speed, and that trade is a real, recurring cost paid by everyone who touches the code afterward. The professional skill is making the trade *visibly* and *locally*.

- **Isolate hot kernels; keep the rest idiomatic.** The 3% of the code that's hot can afford to be ugly; the other 97% should stay readable. Don't let micro-optimizations metastasize across a codebase where they earn nothing — a manually-unrolled loop in a cold path is pure cost.
- **Document the "why," not the "what."** Optimized code is non-obvious by construction; the comment that matters explains *the measurement that justified it* ("benchmark: this AoS→SoA flip cut L2 misses 60%, 1.8× on the hot path — see bench/foo_test.go") so the next engineer knows it's load-bearing and why, and doesn't "simplify" it back.
- **Guard the win with a benchmark gate.** An optimization with no [regression test](../07-performance-budgets-and-regression-testing/professional.md) is one refactor away from silently reverting — and now you have ugly code that's *also* slow. The gate is what makes the readability cost worth paying.
- **Prefer wins that *lower* complexity.** The best CPU optimizations — better algorithm, less allocation, fewer round-trips — frequently delete code. Reach for those first not only because they're bigger wins but because they have *negative* maintenance cost. Save the readability-eroding micro-optimizations for the proven, isolated, gated hot kernel.

> **The senior-vs-professional distinction:** the senior can make code fast. The professional knows that fast code someone has to maintain for five years has an ongoing cost, and prices that cost into the decision — keeping optimized code rare, contained, documented, and gated, so the speed is permanent and the complexity is quarantined.

---

## War Stories

**The 6% win that paid two salaries.** A team ran a JSON-heavy ingestion service at ~6,000 cores. Profiling showed 18% of CPU in reflection-based serialization. Switching the hot path to a code-generated marshaler cut total CPU 11%; turning on PGO on top added another ~4%. Combined, ~15% of a $1.5M/year compute bill — ~$225K/year, recurring. The two-engineer, six-week project paid for itself in under two months and kept paying every year after. The flame graph was the easy part; the part that got the project funded was the dollar arithmetic in the proposal.

**The `-march=native` SIGILL.** A C++ service built fine and benched 8% faster after someone added `-march=native` to "make it fast." It ran clean in CI and on the newer staging hosts. In production, ~15% of the fleet — older instance types without AVX-512 — crashed on startup with `SIGILL`. The build machine's incidental CPU capabilities had become a hard runtime requirement. Fix: pin `-march=x86-64-v3` fleet-wide and verify the emitted ISA in CI. The 8% was real; it just wasn't worth a partial fleet outage.

**The SIMD kernel that was subtly wrong.** A hand-written AVX2 kernel for a similarity computation passed all the example-based tests and shipped a 5× win on the hot path. Months later, results drifted for inputs whose length wasn't a multiple of the vector width — the scalar remainder loop had an off-by-one. There was no reference implementation to differential-test against, so the bug lived in production for a quarter. The rewrite kept the kernel but added a pure-Rust reference and property-based differential tests in CI; the speed survived, the silent-wrongness didn't.

**Premature optimization, fleet edition.** An engineer spent three weeks hand-tuning the parsing inner loop of an internal admin tool — real, clever, 3× work. The tool ran on two cores, a few hours a day. Annual compute saved: about $40. The same three weeks aimed at the customer-facing ingestion service (thousands of cores) would have been worth six figures. The work was excellent; the *target selection* was the failure. Cycles are dollars only where there are a lot of them.

---

## Decision Frameworks

**Should I optimize this at all? Ask:**
- What's the annual compute cost of this service, and is CPU its scaling constraint? → if cost is low or CPU isn't binding, stop; the win isn't dollars.
- What fraction of *aggregate* CPU is this code? → Amdahl-cap the realizable win before estimating effort.
- Cost saved per engineer-month vs the engineer-month's cost? → if it's not clearly positive, the time is better spent elsewhere.

**At what altitude? Ask, top-down:**
- Is the algorithm/complexity right? → fix here first; biggest win, often *lowers* complexity.
- Are the data structures right? → next.
- Is the memory layout right (cache, false sharing, allocation)? → next.
- Only now: does a *proven, isolated, gated* micro-arch / native kernel pay? → last resort.

**Free wins before hand-work? Always try:**
- PGO/AutoFDO turned on with a fresh prod profile, re-measured. → fleet-wide %, near-zero maintenance.
- Benchmarked `-O3`/ThinLTO per target. → sometimes free, sometimes negative — measure.

**Flags. Default to:**
- `-O2`, fleet-pinned `-march=x86-64-v3` (never `native`), ThinLTO + PGO for release, ISA verified in CI.

**Drop to a native kernel only when:**
- Measured dominant CPU fraction, higher altitudes exhausted, PGO on, AND you'll add a reference impl + differential tests + a documented "why" + batched FFI.

---

## Mental Models

- **Cycles are dollars, but only where there are a lot of them.** A percentage win is worth `cores × $/core-hour × 8760 × %` per year — recurring. Do that multiplication *before* you optimize. It's the cheapest, highest-leverage step on the page.

- **Premature optimization is optimizing before you've shown positive ROI** — not optimizing "early." Sometimes the right time to hand-tune is day one (a known hot data plane); sometimes it's never (a tool on two cores).

- **Optimize top-down through the altitudes.** Algorithm > data structure > memory layout > micro-arch. The top dominates the bottom *and* costs less to maintain. Starting at the bottom is theater.

- **PGO is a coupon for free CPU.** Real-traffic profiles let the compiler stop guessing — 5–15% fleet-wide, portable, maintenance-free. Turn it on before hand-optimizing anything.

- **A flag set to the build machine's capabilities is a latent fleet outage.** `-march=native` SIGILLs on older hosts. Pin a baseline you *know* every target supports.

- **A native kernel is debt, not just speed.** It's worth it only behind a narrow interface, with a reference implementation, differential tests, batched FFI, and a documented justification. Otherwise it's a landmine.

---

## Common Mistakes

1. **Optimizing without doing the dollar arithmetic.** A 5% win on a cheap service loses money once you price the engineer-month. Multiply `cores × $/core-hour × % × 8760` first; it takes five minutes and reframes the whole project.

2. **Confusing "binding constraint."** A CPU win on a service that scales on memory or a replica floor saves no money — it buys headroom, not cash. Confirm what the autoscaler keys on.

3. **Starting at the bottom altitude.** Hand-vectorizing a loop that an algorithmic fix would delete is wasted effort. Exhaust algorithm → data structure → layout before reaching for intrinsics.

4. **Not turning on PGO.** Leaving a fleet-wide 5–15% on the table while hand-tuning is the most common high-cost omission. PGO/AutoFDO is hours of work for a recurring percentage win.

5. **`-march=native` in a shared build.** It encodes the build machine's incidental ISA as a hard runtime requirement and SIGILLs on older hosts. Pin an explicit fleet baseline; verify the emitted ISA in CI.

6. **Blanket `-O3`.** Often zero or negative (i-cache pressure, code bloat) and surfaces more UB. Benchmark it per target; keep `-O2` as the default.

7. **A native kernel with no reference and no differential tests.** Subtle SIMD/edge-case bugs ship silently. Keep a pure-host reference as the oracle and fuzz-differential it in CI.

8. **Optimized code with no comment and no benchmark gate.** The next engineer "simplifies" it back, or it silently regresses — leaving you with ugly code that's also slow. Document the measurement; gate the win.

---

## Test Yourself

1. A service runs at 3,000 cores at an effective $0.02/core-hour. You can deliver a 7% CPU reduction in an estimated six engineer-weeks. Is it worth it? Show the arithmetic, and name the one precondition that could make the answer "no" even if the math looks good.
2. You're handed a flame graph with one obviously hot, ugly function. Why is "make this function's instructions faster" the wrong first question, and what do you ask instead?
3. Explain PGO in one sentence, the production loop that operationalizes it, and the one thing that can make a profile *hurt* rather than help.
4. A teammate adds `-march=native` and shows an 8% benchmark win. What's your objection, and what do you propose instead?
5. When is the right time to choose Rust/C++ over Go/JVM for CPU reasons, and why is *that* moment far cheaper than achieving the same factor later?
6. List the four scaffolding requirements before you'd approve dropping a hot path to a hand-written native kernel.
7. Why is an algorithmic optimization often *better* for maintainability than a micro-architectural one, beyond just being a bigger speedup?

<details>
<summary>Answers</summary>

1. Annual cost = 3000 × $0.02 × 8760 ≈ **$525K/yr**; 7% ≈ **$37K/yr recurring**. Six engineer-weeks costs roughly $17–20K once; it pays back in ~6 months and saves $37K/year thereafter — **worth it.** The killer precondition: the service must be **CPU-bound at its scaling boundary** (the autoscaler scales on CPU). If it scales on memory or a replica floor, the CPU win removes no cores and saves no money — it buys headroom, not cash.
2. Because the flame graph tells you *where* time goes, not *which altitude* to fix it at. The function may be hot because it's **called too often** — a caching/batching change one or two altitudes up could delete the hotspot entirely, for a bigger win at lower maintenance cost. Ask **"why is this hot at all, and what's the highest altitude I can fix it at?"** before micro-optimizing the instructions.
3. PGO feeds a profile of **real execution** into the compiler so it optimizes hot paths and branch layout from fact instead of guessing. The loop: **collect a profile from prod → store/version it → feed it into the build → re-measure.** A **stale or unrepresentative profile** can mis-optimize (lay out the wrong paths as hot) — keep profiles fresh and representative; both Go and LLVM degrade safely to "no worse than non-PGO" for merely-outdated ones.
4. `-march=native` encodes the **build machine's incidental ISA** (e.g., AVX-512) as a hard runtime requirement; on any older host without those instructions the binary **SIGILLs**. Propose a **fleet-pinned explicit baseline** (`-march=x86-64-v3` / explicit `-mavx2`) that every target is known to support — or runtime CPUID dispatch for the hot kernel — and **verify the emitted ISA in CI.**
5. When **greenfielding a service whose CPU cost will be a meaningful fleet line item** (especially latency-critical, allocation-heavy data planes). It's cheaper because **language choice is a one-time 2–5× ceiling shift**, whereas clawing back the same factor later means months of micro-optimization across an existing codebase — far more engineer-time for the same result, and it erodes maintainability doing it.
6. (a) A **narrow, stable, documented interface**; (b) a **pure-host-language reference implementation** as the correctness oracle/fallback; (c) **differential/property-based tests** of kernel-vs-reference in CI; (d) **batched FFI** so per-call boundary cost doesn't eat the win — plus a documented "why" (the benchmark that justified it and the conditions to delete it).
7. Because an algorithmic optimization often **deletes code** (less to maintain — *negative* maintenance cost), is portable across CPUs, and reads as intent; a micro-arch optimization **adds** non-obvious, CPU-fragile code that the next engineer must understand and not break — *positive*, recurring maintenance cost — on top of being the smaller speedup.

</details>

---

## Cheat Sheet

```
ROI ARITHMETIC (do this FIRST)
  annual $ = cores × $/core-hour × 8760
  win $    = annual $ × win%       (recurring, per year)
  GATE: CPU must be the autoscaler's binding constraint, else it's headroom not cash
  GATE: Amdahl — win is capped by the hot code's share of AGGREGATE CPU

OPTIMIZATION ALTITUDE (top-down; top wins big AND costs less to maintain)
  algorithm/complexity   10x-1000x   often LOWERS complexity   ← start here
  data structure         2x-10x      neutral
  memory layout          1.2x-3x     higher maint
  micro-arch / SIMD      1.1x-2x     much higher, CPU-fragile   ← last resort

FREE WINS (before any hand-work)
  Go:    cp cpu.pprof ./default.pgo ; go build      ~2-14%, auto-detected
  LLVM:  perf record -j any,u ... ; create_llvm_prof ; clang -fprofile-sample-use
         + llvm-bolt (post-link reorder)            ~5-15% fleet-wide
  REFRESH profiles on a cadence; pin them as a versioned build input

FLAGS (shared template; never per-project drift)
  -O2                       production default
  -O3                       benchmark per-target; often 0 or negative
  -march=x86-64-v3          fleet-pinned baseline  (NEVER -march=native → SIGILL)
  ThinLTO + PGO             modern release combo; verify emitted ISA in CI

NATIVE KERNEL (only after higher altitudes + PGO exhausted)
  narrow interface • pure-host REFERENCE impl • differential/fuzz tests in CI
  BATCH the FFI boundary (cgo/JNI ~tens of ns/call) • document the "why"

MAINTAINABILITY
  isolate hot kernels; keep 97% idiomatic
  comment the MEASUREMENT that justified it, not the mechanics
  gate every win with a CI benchmark — else it silently regresses
```

---

## Summary

- **Do the dollar arithmetic before optimizing.** A percentage CPU win is worth `cores × $/core-hour × 8760 × %` per year, recurring — but only if CPU is the autoscaler's binding constraint and the hot code is a real share of *aggregate* CPU. "Premature optimization" means optimizing before you've shown positive ROI, not optimizing early.
- **Optimize top-down through the altitudes:** algorithm > data structure > memory layout > micro-architecture. The top dominates the bottom *and* costs less to maintain — starting at the bottom is theater.
- **Turn on PGO/AutoFDO before hand-tuning anything.** Real-traffic profiles fed back into the build buy 5–15% fleet-wide, portably and maintenance-free — Go's `default.pgo`, LLVM's `-fprofile-sample-use` + BOLT. Operationalize it as a closed loop with fresh, versioned profiles.
- **Language and runtime are the coarsest CPU lever** — GC overhead, escape-analysis quality, JIT vs AOT. For a *new* service whose CPU bill will matter, this is the cheapest 2–5× you'll get; treating it as fixed while greenfielding is the mistake.
- **Govern flags fleet-wide:** `-O2` default, benchmark `-O3` per target, **pin `-march` to a baseline every host supports** (never `native` — it SIGILLs), ThinLTO + PGO for release, verify the ISA in CI.
- **Drop to a native kernel only as a last resort, and box it:** narrow interface, pure-host reference implementation, differential tests, batched FFI, documented justification. Keep optimized code rare, isolated, documented, and gated — fast code someone maintains for five years has a price, and the professional pays it deliberately.

The remaining tier — [interview.md](interview.md) — distills this into the questions that reveal whether someone can reason about CPU work as an economic decision, not just a flame graph.

---

## Further Reading

- *Systems Performance* — Brendan Gregg — the canonical methodology; the USE method and reasoning about cost at scale.
- [Go PGO documentation](https://go.dev/doc/pgo) — the `default.pgo` workflow, expected wins, and stale-profile behavior.
- [LLVM AutoFDO](https://clang.llvm.org/docs/UsersManual.html#profile-guided-optimization) and the [BOLT paper](https://github.com/llvm/llvm-project/tree/main/bolt) — feedback-directed and post-link optimization at scale.
- Google's *AutoFDO* and *Propeller* papers — the production pattern of collecting prod profiles and feeding them into the build for an entire fleet.
- *The Art of Writing Efficient Programs* — Fedor Pikus — micro-architecture, when it pays, and how the compiler already handles much of it.
- Continuous-profiling tooling (Parca, Pyroscope, Google Cloud Profiler) — making "collect from prod" a standing service rather than a manual step.

---

## Related Topics

- [junior.md](junior.md) — what CPU-bound means, reading a basic profile, the obvious algorithmic wins.
- [senior.md](senior.md) — flame graphs, hot-path identification, algorithm vs allocation vs micro-arch fixes, honest benchmarking.
- [interview.md](interview.md) — the questions that probe CPU optimization as an economic and engineering decision.
- [07 — Performance Budgets and Regression Testing](../07-performance-budgets-and-regression-testing/professional.md) — the CI gate that makes a CPU win permanent instead of depreciating.
- [06 — Concurrency and Contention](../06-concurrency-and-contention/professional.md) — false sharing, cache-coherence traffic, and the contention side of memory-layout decisions.
- [01 — Profiling](../01-profiling/01-cpu-profiling/professional.md) — the production profiling that feeds both your decisions and your PGO pipeline.
