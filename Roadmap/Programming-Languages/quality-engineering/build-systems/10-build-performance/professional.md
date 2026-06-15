# Build Performance — Professional Level

> **Roadmap:** [Build Systems](../README.md) → Build Performance
> *A slow build is not an engineering annoyance — it's a line item. Multiply the wait by every engineer, every day, and build time becomes one of the largest, most invisible costs an organization pays. Treating it as an investment, with budgets and SLOs, is what separates teams that ship from teams that wait.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Build Performance as an Org Investment](#build-performance-as-an-org-investment)
3. [Setting Build-Time Budgets and SLOs](#setting-build-time-budgets-and-slos)
4. [Instrumenting Builds: You Can't Manage What You Don't Measure](#instrumenting-builds-you-cant-manage-what-you-dont-measure)
5. [Where to Spend the Effort](#where-to-spend-the-effort)
6. [Rolling Out Distributed and Remote Execution](#rolling-out-distributed-and-remote-execution)
7. [War Stories](#war-stories)
8. [Mental Models](#mental-models)
9. [Common Mistakes](#common-mistakes)
10. [Test Yourself](#test-yourself)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do you justify, budget, measure, and roll out build-performance work at organizational scale?**

The senior page gave you the technical levers. The professional question is different: *with finite engineering time, is build-performance work worth doing, how much, and how do you prove it?* This is a business case, not a profiling exercise — and the engineers who get headcount and infrastructure budget for build work are the ones who can put a dollar figure and a velocity figure on the table.

The core argument is simple and almost always overwhelming once you do the arithmetic: build time is paid by *every engineer, every iteration, every day*, and by *every CI run*. A 30-second improvement that feels trivial, multiplied across 200 engineers doing 50 builds a day, is **hours of reclaimed engineering time daily** — recurring, forever. The cost of the slow build is invisible precisely because it's spread across everyone in small pieces, which is exactly why it never gets prioritized until someone makes it visible.

This page is about making it visible (instrumentation), making it accountable (budgets and SLOs), spending the effort where it pays (the critical path, the cache hit rate, the long-pole target), and rolling out the big platform investments (remote execution) without breaking the team.

---

## Build Performance as an Org Investment

Frame build work the way finance frames any investment: cost saved versus cost spent.

**The developer-hours arithmetic.** This is the headline number, and it's usually shocking:

```
  engineers              = 200
  builds per eng per day = 40
  time saved per build   = 45 seconds
  → 200 × 40 × 45s       = 360,000 s/day = 100 engineer-hours PER DAY
  → ~12.5 engineer-days reclaimed every working day, recurring
```

Even discounting heavily for "they don't sit idle the whole time" — much of that wait is the costly *context-switch* loss, not pure idle — the number is enormous and it *recurs daily forever*. A one-week project that delivers it pays back in days.

**The CI-dollars arithmetic.** Separate and additive:

```
  CI runs per day        = 2,000  (PRs, merges, nightly)
  build minutes per run  = 25 → 4   (after caching)
  cloud cost per minute  = $0.02 (a fleet of build runners)
  → before: 2000 × 25 × $0.02 = $1,000/day = ~$365k/yr
  → after:  2000 × 4  × $0.02 = $160/day  = ~$58k/yr
  → ~$300k/yr saved, plus faster merges (velocity, unpriced here)
```

**The velocity argument (the one that actually wins).** Beyond hours and dollars, slow builds *change behavior* in destructive ways: engineers batch larger changes to avoid the wait, large changes are riskier and harder to review, long CI queues delay merges, and the whole org's cycle time stretches. Fast builds enable small, frequent, low-risk changes — the foundation of high-performing teams (the DORA research ties build/test feedback speed directly to deployment frequency and lead time).

> **Key insight:** The case for build performance is rarely "the build is slow" — that gets ignored. It's "we are spending ~100 engineer-hours and ~$1,000 every day on build wait, recurring, and it's making everyone batch risky changes." Put the recurring developer-hours, the CI dollars, and the velocity drag on one slide. The numbers are almost always so large that the only question left is who does the work, not whether.

---

## Setting Build-Time Budgets and SLOs

What gets measured against a target gets defended; what doesn't, regresses silently. Treat build time like latency: set explicit objectives and alert on violations.

A workable structure, distinguishing the build kinds (because they have different audiences and fixes):

```
  Incremental build (one-file change)   p50 < 5s,  p95 < 15s    ← developer flow
  Clean build (local, from scratch)     p50 < 3m,  p95 < 6m     ← onboarding, full rebuild
  CI build (warm cache)                 p50 < 6m,  p95 < 10m    ← merge velocity
  CI build (cold cache)                 p95 < 15m               ← worst case
```

Make these **SLOs with owners**, not aspirations:

- **A budget per target.** No single library may exceed N seconds to compile, or N includers. New code that blows the budget fails review. This stops the slow death by a thousand cuts.
- **A regression gate.** CI tracks build time over commits; a commit that regresses the p95 by more than a threshold triggers an alert (or blocks). Build time regresses *one header at a time* — catch it at the commit that caused it, when it's cheap to fix.
- **An error budget mentality.** When you breach the SLO, that's the signal to spend an iteration on build work — the same discipline you'd apply to a latency SLO.

> **Key insight:** Build performance, left unmanaged, *only ever regresses* — every new dependency, header, and target adds cost, and no single commit looks bad enough to block. SLOs and a per-commit regression gate convert that one-way ratchet into a managed quantity: you catch the regressing commit when it lands, attribute it to an owner, and fix it for the cost of one header instead of a quarter-long "build is slow now" investigation.

---

## Instrumenting Builds: You Can't Manage What You Don't Measure

You cannot set budgets or prove savings without a build-telemetry pipeline. At org scale, every build — local and CI — should emit structured data to a central store.

**Build scans / profiles, collected centrally.** Gradle Build Scans, Bazel's `--profile`, and Buck2's logs each emit per-build structured data: total time, per-task/per-target time, cache hit rate, critical path. Pipe them to a dashboard:

```bash
# Gradle: every build uploads a scan
./gradlew build --scan                       # → develocity / build-scan service

# Bazel: emit a profile per CI build; also stream Build Event Protocol to a collector
bazel build //... --profile=$BUILD_ID.profile.gz \
  --bes_backend=grpc://bes.internal:8980      # Build Event Protocol → central store

# ccache fleet-wide hit rate, scraped into metrics
ccache -s --verbose                           # cache_hit_rate → Prometheus
```

**The metrics that matter on the dashboard:**

- **p50 / p95 build time**, split by clean/incremental/CI and by team.
- **Cache hit rate** (the dominant lever at scale — watch it like a hawk; a drop usually means a determinism regression, [09](../09-reproducible-builds/senior.md)).
- **Critical-path length** and **the top long-pole targets** (where to spend next).
- **Build-time-by-commit** (the regression gate's input).
- **Cold vs warm CI time** (the value your cache delivers).

**Build scans in CI are non-negotiable** because the worst regressions appear there first and at full cost. A scan link on every failed/slow CI build lets any engineer self-diagnose ("your PR added a header included by 600 files; here's the trace") instead of escalating to the build team.

> **Key insight:** Treat builds as a production service with telemetry. The single most important number on the dashboard is **cache hit rate**, because at scale it dominates total cost and because a sudden drop is the leading indicator of a determinism regression that will silently inflate everyone's build time. If you instrument one thing, instrument hit rate; if you instrument two, add build-time-by-commit so regressions have a culprit.

---

## Where to Spend the Effort

With a dashboard, you stop guessing and spend the budget where the math says. The priority order, almost universally:

**1. Raise the cache hit rate first.** At scale this dwarfs everything. Going 70%→95% removes most remaining compute for the cost of fixing determinism and cache-key scope — a far better return than any hardware buy. Most "slow build at scale" problems are really "low/regressed hit rate" problems.

**2. Attack the critical path / the long-pole target.** From the profile, find the single target that the most things wait on. Splitting one monolithic library that 80% of the build depends on can unblock massive parallelism — one structural fix beating dozens of micro-optimizations.

**3. Kill the worst fan-out headers.** The dashboard's "most-included headers" list is your hit list. The header included by 600 files that changes weekly is costing the org hours; splitting it or forward-declaring is high-leverage and one-time.

**4. Swap the linker / fix the obvious.** `-fuse-ld=mold`, dropping LTO from dev builds, right-sizing `-j` — cheap, fast wins to bank early for credibility.

**5. Only then, more hardware / remote execution.** When you've maximized avoidance (cache) and structure (critical path), *then* throw machines at the residual cold work via RBE or a bigger CI fleet.

> **Key insight:** The order is **avoidance → structure → hardware**, and people get it backwards. The instinct is to buy faster CI machines first (visible, easy to approve), but that's the *last* lever — it only helps the work you couldn't cache or restructure away. Spend the early budget on cache hit rate and the critical path; bank a cheap linker swap for credibility; buy hardware only for the residue. Hardware is the lever with the worst ROI and the one most often pulled first.

---

## Rolling Out Distributed and Remote Execution

Remote execution (RBE) and distributed compilation are the big platform investments. They fail when rolled out as a big bang; they succeed when rolled out as a migration with measurement gates.

**Distributed compilation (distcc/icecc)** is the cheap on-ramp for C/C++ shops: a compile farm on the LAN, adopted with a compiler wrapper and a host list. Low risk, no hermeticity requirement, immediate clean-build speedup. Reach for it when the bar to RBE is too high.

**Remote execution** is a platform migration with a hard prerequisite — **hermetic builds** ([05 — Polyglot/Hermetic Builds](../05-polyglot-hermetic-builds/senior.md)). The rollout sequence that works:

```
  1. Achieve hermeticity FIRST.  Every action declares all inputs; no ambient deps.
     (This is the real project; RBE is the easy part once it's done.)
  2. Turn on the REMOTE CACHE only (read).  Validate hit rate; no execution yet.
  3. Enable remote EXECUTION for a subset of targets.  Compare outputs byte-for-byte
     against local (catch hermeticity gaps that produce wrong results, not just failures).
  4. Expand coverage; watch p95, cache hit rate, and worker saturation.
  5. Make it the default for CI; keep a local-fallback escape hatch.
```

The dangerous failure mode is **silent incorrectness**: a non-hermetic action that *happens* to work locally (it reads an undeclared system header) produces *wrong* output remotely where that header differs or is absent. This is why step 3's byte-for-byte comparison exists — RBE doesn't just need to be fast, it needs to be *correct*, and the gap is hermeticity.

> **Key insight:** RBE is 10% turning on a flag and 90% making the build hermetic. Organizations that "try RBE" and fail almost always skipped the hermeticity work and hit silent-incorrectness or constant failures. Sell and budget the rollout as a *hermeticity project* with RBE as the payoff — and gate every expansion step on a byte-for-byte output comparison, because a remote build that's fast and wrong is worse than a slow build that's right.

---

## War Stories

**The 45-minute build cut to 4.** A mid-size company's monorepo CI took 45 minutes per PR; engineers context-switched away on every run and merges queued for hours. Investigation (via a build dashboard, added first) showed two things: no shared cache (every CI run recompiled from scratch) and a non-hermetic build that wouldn't allow one. The team spent six weeks on hermeticity, turned on a remote cache, and CI dropped to ~4 minutes warm. The hermeticity work — not the cache flag — was the actual project; the cache was the payoff. Cost: six engineer-weeks. Recurring saving: tens of engineer-hours per day plus a dramatic drop in merge latency. Payback: under a month.

**The header that cost an hour a day across the team.** A single `types.h`, included transitively by ~700 of 900 files, was edited several times a week during active development. Each edit triggered a 4-minute incremental rebuild for everyone who pulled the change — measured across the team, roughly an engineer-hour per day evaporating into recompiles of files that didn't logically depend on the change. A build scan made it visible (the "most-included header, highest churn" line on the dashboard). Splitting `types.h` into focused headers and forward-declaring dropped most files' dependency on it; incremental builds fell to seconds. One afternoon's work; a permanent reclaim.

**The CI cache that silently rotted.** A team's CI build time crept from 5 minutes back up to 18 over a quarter with no obvious cause. The dashboard showed cache hit rate had quietly fallen from 94% to 31%. Root cause: a well-meaning change embedded a build timestamp into a generated file, so its hash changed every build, cascading misses through everything downstream ([09 — Reproducible Builds](../09-reproducible-builds/senior.md)). Removing the timestamp restored the hit rate overnight. The lesson the team institutionalized: **alert on cache-hit-rate drops**, because they're the leading indicator of a determinism regression long before build time looks alarming.

> **Key insight:** Every one of these started invisible and stayed unprioritized until someone made the cost *visible and quantified* — a dashboard, a build scan, a hit-rate metric. The technical fixes were almost mundane (split a header, remove a timestamp, do the hermeticity work). The hard part was *measuring* so the right fix was obvious and the business case wrote itself. Instrument first; the fixes follow.

---

## Mental Models

- **Build time is a tax everyone pays in tiny installments.** That's why it's invisible and why it never gets prioritized — no single person feels the full cost. Your job is to *sum the installments* into one number that demands attention.

- **Unmanaged build performance only ratchets one way: slower.** Every commit can add cost; none looks bad alone. SLOs and a per-commit regression gate are the ratchet's pawl — they catch the regression at the commit, not the quarter.

- **Avoidance beats structure beats hardware.** Spend budget in that order. Cache hit rate (avoid the work) first, critical-path/structure second, machines last. Buying hardware first is the most common and most expensive mistake.

- **Cache hit rate is your check-engine light.** It's the dominant cost lever *and* the earliest warning of a determinism regression. Watch it above all other build metrics.

- **RBE is a hermeticity project wearing a performance costume.** The flag is trivial; the inputs-declaration work is the whole thing. Budget accordingly.

---

## Common Mistakes

1. **Pitching "the build is slow" instead of the dollar/hour figure.** Decision-makers can't act on "slow." They can act on "100 engineer-hours and $1,000 per day, recurring." Always do the arithmetic.

2. **Buying CI hardware first.** It's the easiest spend to approve and the worst ROI — it only helps work you failed to cache or restructure. Raise hit rate and fix the critical path before scaling machines.

3. **Not instrumenting before optimizing.** Without a dashboard you optimize by anecdote and can't prove savings. Stand up build scans / profiles *first*; the data picks the target and proves the win.

4. **Letting build time regress un-gated.** Without a per-commit regression check, the build slowly rots and you're left with an expensive archaeology project. Gate it.

5. **Rolling out RBE before hermeticity.** Leads to constant failures or — worse — silent wrong results from undeclared inputs. Do the hermeticity work first; gate expansion on byte-for-byte output comparison.

6. **Ignoring a falling cache hit rate.** A hit-rate drop is the leading indicator of a determinism regression that will inflate everyone's build time. Alert on it; don't wait for build time to look bad.

---

## Test Yourself

1. Your build is "a bit slow." How do you turn that into a business case a VP will fund? Sketch the two arithmetic calculations.
2. Why distinguish incremental, clean, and CI build SLOs instead of having one build-time target?
3. What single metric would you put first on a build dashboard, and why does it serve double duty?
4. Order these by ROI for an at-scale slow build: buy faster CI machines, raise cache hit rate, swap the linker, split the long-pole target.
5. A team turned on RBE and got intermittent *wrong* build outputs (not just failures). What's the root cause and what step in the rollout should have caught it?
6. Build time crept from 5 to 18 minutes over a quarter with no big change. What do you check first, and what's the likely root cause?

<details>
<summary>Answers</summary>

1. **(a) Developer-hours:** engineers × builds/day × seconds-saved → engineer-hours/day reclaimed (e.g. 200 × 40 × 45s ≈ 100 eng-hours/day, recurring). **(b) CI dollars:** CI-runs/day × minutes-saved × $/minute → annual savings, plus the unpriced velocity gain (faster merges, smaller safer changes). Lead with the recurring nature and the velocity drag.
2. They have **different audiences, costs, and fixes**: incremental is developer *flow* (seconds matter, fan-out is the lever), clean is onboarding/full-rebuild (total work), CI is *merge velocity* (cache hit rate dominates). One target hides which problem you have and who owns it.
3. **Cache hit rate.** It's the dominant cost lever at scale, *and* a sudden drop is the leading indicator of a determinism regression that will silently inflate everyone's build time — so one metric tells you both your biggest opportunity and your earliest warning.
4. Best→worst ROI: **raise cache hit rate** (removes most compute, cheap) → **split the long-pole target** (unblocks parallelism, one-time structural) → **swap the linker** (`mold`/`lld`, cheap, every-build win) → **buy faster CI machines** (last; only helps residual cold work, worst ROI). (Linker vs split can swap depending on specifics, but hardware is always last.)
5. **Root cause: the build isn't hermetic** — some action read an undeclared input (e.g. a system header) that exists/differs locally but not on the remote worker, so it produced different output. The rollout should have caught it at the **byte-for-byte output comparison** step (enable remote execution for a subset, diff outputs against local *before* expanding).
6. Check the **cache hit rate** first — a quarter-long creep with no big change is classic cache rot. Likely root cause: a **determinism regression** ([09](../09-reproducible-builds/senior.md)) — an embedded timestamp, absolute path, or unstable ordering that changed an input hash and cascaded misses downstream. Fix the non-determinism; the hit rate (and build time) recovers.

</details>

---

## Cheat Sheet

```
THE BUSINESS CASE (always quantify)
  dev-hours/day = engineers × builds/day × seconds_saved
  CI $/yr       = runs/day × minutes_saved × $/min × 365
  + velocity: fast builds → small, frequent, low-risk changes (DORA)
  pitch the RECURRING number, not "it's slow"

SLOs (split by build kind — different audiences)
  incremental p95 < 15s   clean p95 < 6m   CI warm p95 < 10m / cold < 15m
  + per-TARGET budget (max compile time / max includers; fails review)
  + per-COMMIT regression gate (catch the culprit commit)
  unmanaged build perf only ratchets SLOWER

INSTRUMENT (you can't manage what you don't measure)
  gradle --scan | bazel --profile + --bes_backend | ccache -s
  dashboard: p50/p95 (clean/incr/CI), CACHE HIT RATE, critical path,
             top long-poles, build-time-by-commit, cold vs warm

SPEND ORDER (avoidance → structure → hardware)
  1. raise cache hit rate (70→95% beats hardware)
  2. split long-pole / critical-path target
  3. kill worst fan-out headers
  4. swap linker (mold/lld), drop dev-build LTO
  5. THEN hardware / RBE (residual cold work only)

RBE ROLLOUT (it's a hermeticity project)
  hermetic FIRST → remote cache (read) → remote exec subset + BYTE-DIFF
  → expand (watch p95/hit-rate/saturation) → default + local fallback
  danger: silent WRONG output from undeclared inputs

WATCH: cache-hit-rate DROP = leading indicator of determinism regression (topic 09)
```

---

## Summary

- **Build time is an org-scale cost paid in tiny installments by everyone.** The business case is arithmetic: developer-hours/day reclaimed (engineers × builds × seconds) and CI dollars/year, plus the velocity gain (fast builds enable small, frequent, low-risk changes). Lead with the recurring number.
- **Set SLOs, split by build kind** (incremental for flow, clean for onboarding, CI for merge velocity), with **per-target budgets** and a **per-commit regression gate** — because unmanaged build performance only ever gets slower, one header at a time.
- **Instrument everything** (build scans, profiles, fleet `ccache -s`) into a dashboard. The headline metric is **cache hit rate** — the dominant cost lever *and* the leading indicator of a determinism regression.
- **Spend in order: avoidance → structure → hardware.** Raise the cache hit rate, split the long-pole/critical-path target, kill fan-out headers, swap the linker — and buy machines or roll out RBE only for the residual cold work. Hardware-first is the common, expensive mistake.
- **Remote execution is a hermeticity project** ([05](../05-polyglot-hermetic-builds/senior.md)) with a performance payoff. Roll it out as a gated migration — hermetic first, cache-only, then execution with byte-for-byte output validation — because a fast-but-wrong remote build is worse than a slow correct one.
- The **war stories** all share a shape: the cost was invisible until someone *measured* it; the technical fix was then almost mundane. Instrument first; the priorities and the business case write themselves.

The [interview.md](interview.md) drills the questions that probe this judgment: the three levers, why `-j64` isn't 64×, profiling, C++ costs, linkers, caching at scale, distributed builds, and the design scenarios ("your build takes 30 minutes — make it fast").

---

## Further Reading

- *Accelerate* (Forsgren, Humble, Kim) — the DORA research linking fast feedback (build/test) to deployment frequency and lead time; the data behind the velocity argument.
- [Gradle Develocity / Build Scan](https://docs.gradle.org/current/userguide/build_scans.html) and [Bazel Build Event Protocol](https://bazel.build/remote/bep) — central build telemetry in practice.
- Google's "Build in the Cloud" papers and the Bazel/Blaze remote-execution writeups — how a monorepo at scale runs builds.
- Site Reliability Engineering (Google) — the SLO / error-budget discipline, applied here to build time.

---

## Related Topics

- [07 — Build Caching](../07-build-caching/senior.md) — cache hit rate, the lever you spend on first.
- [05 — Polyglot/Hermetic Builds](../05-polyglot-hermetic-builds/senior.md) — hermeticity, the prerequisite for the RBE rollout.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — determinism, whose regression silently destroys hit rate.
- [02 — Dependency Graphs](../02-dependency-graphs/senior.md) — the critical path you target after the cache.
- [Performance](../../performance/README.md) — measuring, budgeting, and SLOs as a general engineering discipline.
- [Quality Engineering](../../README.md) — where build performance sits in the larger quality picture.
