# Dependency Graphs — Professional Level

> **Roadmap:** [Build Systems](../README.md) → Dependency Graphs
> *Operating a build graph nobody can draw: answering "why did this rebuild?" and "why didn't it?", keeping the graph honest at org scale, and treating it as both an architecture signal and a CI cost lever.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Debugging "Why Did This Rebuild?"](#debugging-why-did-this-rebuild)
3. [Debugging "Why Didn't This Rebuild?"](#debugging-why-didnt-this-rebuild)
4. [Graph Hygiene at Org Scale](#graph-hygiene-at-org-scale)
5. [The Dependency Graph as an Architecture Signal](#the-dependency-graph-as-an-architecture-signal)
6. [Incrementality as a CI Cost Lever](#incrementality-as-a-ci-cost-lever)
7. [Tooling: Reading the Action Graph](#tooling-reading-the-action-graph)
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

> Focus: **How do you run, debug, and govern a build graph in production — and turn it into leverage?**

At senior level the graph became a correctness model you could query. At the professional level it's a *system you operate*, with the same disciplines as any production system: observability ("why did it do that?"), hygiene (keeping it from rotting), governance (who's allowed to add edges), and cost control (incrementality is a line item in the CI bill).

This page is about the recurring operational questions — *why did this rebuild?*, *why didn't this rebuild?*, *why is CI suddenly building the world?* — and the tooling and habits that answer them. It also treats the graph as a *signal*: its shape encodes your architecture's coupling, and reading that signal catches design rot earlier than any code review.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — approximation, dynamic deps, early cutoff, content-addressed graphs, `bazel query`/`aquery`.
- **Required:** You operate or own a real build in CI (Bazel/Buck2/Ninja/large `make`).
- **Helpful:** You've debugged a "works locally, fails in CI" build or a runaway CI bill.

---

## Debugging "Why Did This Rebuild?"

The most common ops question. Someone changed "one line" and CI rebuilt 3,000 targets. The skill is turning that into a *traced cause*, not a shrug.

**Step 1 — establish what changed.** The build's view of "changed inputs" may differ from your `git diff` (generated files, toolchain bumps, environment). Start from the build's perspective.

**Step 2 — ask the tool for the propagation.** Bazel can explain its rebuild decisions:

```bash
# Why is this action being executed? (per-action rebuild reasons)
bazel build //app:server --explain=explain.log --verbose_explanations
grep -i "rebuild\|stamp\|changed" explain.log

# What's the dependency PATH from the changed target to the thing that rebuilt?
bazel query 'somepath(//app:server, //lib:changed)'

# What's the full blast radius of the change?
bazel query 'rdeps(//..., //lib:changed)'
```

`--explain` writes, per action, *why* Bazel ran it: "no entry in cache," "an input changed," "a dependency was rebuilt." That log is the rebuild's stack trace.

**Step 3 — find the chokepoint.** If the blast radius is absurd, the cause is almost always one of:

- **A high-fan-out node was touched.** A common header, a base library, a proto everyone imports. `rdeps` of the changed target reveals it. Fix at the *graph* level (split it), not by avoiding the edit.
- **An over-broad input glob.** A `BUILD` target with `srcs = glob(["**/*"])` depends on everything in its directory; editing an unrelated file in that dir invalidates the whole target. Narrow the glob.
- **A toolchain / configuration change.** Bumping the compiler version, a `--copt`, or a workspace-wide flag changes the *action key* of nearly every action → everything legitimately rebuilds. This is correct (the actions really are different), and the fix is "don't bump toolchains casually in a way that invalidates the whole cache mid-day."
- **A non-deterministic input leaked into the action.** A timestamp, a hostname, a `$PWD` baked into output. Then *every* build looks "changed" because the input hash never stabilizes — a reproducibility failure masquerading as a rebuild storm ([09 — Reproducible Builds](../09-reproducible-builds/professional.md)).

The discipline: **never accept "it just rebuilt a lot" — produce the edge or the input that caused it.** `--explain` + `somepath` + `rdeps` always can.

---

## Debugging "Why Didn't This Rebuild?"

The scarier question, because the symptom is a *wrong artifact*, not a slow one. The user changed something, the build said "up to date," and the running program uses old logic.

**The diagnostic litmus test:** *does `bazel clean` (or `make clean`) make the problem disappear?* If a clean build fixes a bug that incremental builds can't, you have an **under-approximated graph — a missing input edge**. (Restated from [senior.md](senior.md), because in practice this is *the* tell, and recognizing it fast saves hours.)

Hunt the missing input:

```bash
# What inputs does Bazel THINK this action has? Compare to what it really reads.
bazel aquery 'mnemonic("CppCompile", //lib:thing)' --output text | grep -i input

# Run hermetically; an undeclared read now FAILS instead of silently succeeding.
bazel build //lib:thing --spawn_strategy=sandboxed
# or globally tighten:
bazel build //... --sandbox_default_allow_network=false
```

Sandboxing is the structural cure: an action that secretly reads a file outside its declared inputs *fails the first time* under a sandbox, surfacing the missing edge immediately instead of letting it rot into intermittent staleness. For `make`, the equivalent fix is making sure `-MMD`/`-include` is actually wired up and the `.d` files are being read (a classic bug: the `.d` files are generated but the `-include` line is missing or the path is wrong, so they're silently ignored).

Other "didn't rebuild" causes:

- **`restat`/early-cutoff over-pruned.** A generator wrote *new* content but the wrapper's "write only if changed" logic was buggy, or two semantically different outputs hashed the same. Rare, but check the cutoff logic if a known-different output didn't propagate.
- **A stale remote cache entry.** A poisoned cache key (an action that wasn't hermetic) serves a wrong cached output to everyone. The fix is hermeticity *plus* the ability to invalidate/evict; never "just trust the cache" — see [07 — Build Caching](../07-build-caching/professional.md).
- **mtime granularity / clock skew** on a `make` build (from [middle.md](middle.md)) — a same-second edit-and-rebuild that `make`'s strict `>` skipped.

> **Operating principle:** "rebuilt too much" wastes money and is *visible*. "rebuilt too little" ships a wrong binary and is *invisible until production*. Spend your debugging rigor disproportionately on the second — and invest in sandboxing/hermeticity so the build *can't* under-approximate silently.

---

## Graph Hygiene at Org Scale

A build graph, like a codebase, rots without maintenance. Hygiene is the set of habits and guardrails that keep **D ≈ T** and keep the graph's shape sane across thousands of contributors.

- **Visibility as governance.** `visibility = ["//some/package:__subpackages__"]` makes an edge *require permission*. Without it, every target can depend on every other and the graph becomes a hairball where nothing is removable. Visibility encodes intended architecture as an *enforced* constraint — a dependency you didn't authorize won't even build. Treat it as API surface, not bureaucracy.

- **No over-broad globs.** `glob(["**/*"])` and giant catch-all targets over-approximate the graph, destroying incrementality and inflating every `rdeps`. Lint for them. Prefer many small, precisely-scoped targets.

- **Layering / dependency direction enforcement.** Tools like Bazel's `--check_visibility`, custom Starlark aspects, `buildozer`, or third-party layering checks (e.g. import-linter for Python, ArchUnit for JVM) *fail the build* when an edge crosses a forbidden boundary (UI → domain → infra must not reverse). This keeps the graph a DAG that mirrors the architecture, not just *any* DAG.

- **Cycle prevention, not just detection.** The build rejects cycles, but you want them caught at *review* time, before the merge. CI runs `bazel query` for new back-edges; `buildozer`/codeowners gate changes to high-fan-out `BUILD` files.

- **Target sizing as a tuned parameter.** Too-coarse targets over-approximate (poor incrementality); too-fine targets explode graph size and analysis time. Periodically split chokepoint targets and merge trivially-coupled micro-targets. This is ongoing gardening, not a one-time setup.

- **Detecting and removing dead edges.** Unused dependencies inflate the blast radius and slow analysis. Tools (`unused_deps` for Bazel, Gazelle for Go, `depcheck` for JS) report declared-but-unused edges; strip them. A lean graph is a fast, legible graph.

The throughline: **the graph is a shared resource with a tragedy-of-the-commons failure mode.** Any one engineer adding one convenient edge is fine; ten thousand doing it unchecked produces a graph where every change rebuilds the world. Governance is what prevents that.

---

## The Dependency Graph as an Architecture Signal

The build graph is the most *honest* picture of your architecture you have. Diagrams lie (they show intent); the build graph shows what the code *actually* depends on, because the build won't link otherwise. Read it as an architecture diagnostic.

- **Fan-out = coupling.** A node with huge `rdeps` (everyone depends on it) is a coupling hotspot. Change it and the org rebuilds; depend on it and you inherit its churn. A "utils" or "common" target with 4,000 reverse deps is the build-graph signature of a god-module. The metric is objective: `bazel query 'rdeps(//..., //lib:util)' | wc -l`.

- **Fan-in + responsibilities = cohesion.** A target that depends on database, UI, crypto, and networking has low cohesion — it's doing too much, and its high fan-in makes it slow to build (waits for everything) and a frequent rebuild victim (any of its many deps changing triggers it).

- **Cycles attempted (and rejected) = a design smell surfacing.** When two modules "want" to depend on each other (the build keeps rejecting a cycle, and engineers keep adding shims to work around it), the graph is telling you those modules have a misplaced boundary. The right fix is extracting the shared piece into a third module — converting the would-be cycle into a diamond.

- **`somepath` reveals unintended coupling.** "Why does our tiny CLI tool transitively depend on the entire ML training stack?" `bazel query 'somepath(//tools:cli, //ml:training)'` prints the offending chain — usually one lazy edge ("I just needed one constant from there") dragging in a continent. Cutting that edge is a concrete, measurable architecture improvement.

> **Key insight:** you don't need a separate "architecture fitness" tool — the build graph *is* one, and it's continuously validated by the fact that the build runs. Coupling and cohesion stop being subjective review opinions and become queryable metrics: fan-out counts, `somepath` chains, attempted cycles. Wire those into CI and architecture erosion fails the build.

---

## Incrementality as a CI Cost Lever

CI compute is often a top-three engineering expense, and the dependency graph is the single biggest lever on it. The mechanism: **don't build or test what the change can't possibly affect.**

**Affected-target / affected-test selection.** Given the targets a PR changed, build and test only their reverse-dependency closure:

```bash
# changed targets from the diff (e.g. via `bazel query` over changed files):
CHANGED=$(bazel query "set($(git diff --name-only origin/main | ...))")

# build only what's downstream of the change:
bazel build $(bazel query "rdeps(//..., $CHANGED)")

# run only the tests downstream of the change:
bazel test  $(bazel query "kind(test, rdeps(//..., $CHANGED))")
```

A docs-only PR touches no code targets → zero tests run. A leaf-library PR runs a handful. Only a change to a high-fan-out core target triggers a large run — and *that's correct*, because such a change genuinely can break a lot. This converts "run the entire test suite on every PR" (minutes-to-hours, flat cost) into "run work proportional to the blast radius" (often seconds). It's the highest-ROI build investment most orgs can make. (Tools: Bazel's `--build_event_json_file` + skyframe diff, or off-the-shelf systems like Bazel-diff, Aspect, EngFlow, BuildBuddy.)

**Remote caching closes the loop.** Affected-test selection decides *what to run*; remote caching ([07 — Build Caching](../07-build-caching/professional.md)) ensures that even within the affected set, anything someone already built (same input hash) is *fetched, not recomputed*. Together: CI does only the work that is both *downstream of the change* and *not already cached*.

**The dangers to manage:**

- **Selection must over-approximate, never under.** A buggy "affected" computation that *misses* an affected test is worse than running everything — it greenlights a broken change. The selection logic must be conservative (when unsure, include) and itself tested. This is the approximation rule from [senior.md](senior.md) applied to CI scope.
- **Flaky tests poison the lever.** If "affected" tests are flaky, engineers retry-until-green and trust erodes; the cost savings get spent on retries. Incrementality and test reliability are coupled investments.
- **Cache hygiene.** A poisoned cache entry (non-hermetic action) silently serves wrong results to *everyone*, turning your cost lever into a correctness incident. Hermeticity is the precondition for safely trusting the cache.

> **The leverage framing:** every unnecessary rebuild/test in CI is multiplied by your PR rate. At 1,000 PRs/day, shaving the average CI run from "full suite" to "blast-radius only" is the difference between a five- and a six-figure monthly bill — and a 30-minute vs 3-minute feedback loop, which compounds into engineering velocity. The dependency graph is what makes that selection *safe*.

---

## Tooling: Reading the Action Graph

Beyond `query`/`rdeps`, the professional toolkit reads the *action* graph — the concrete commands — to debug performance and correctness.

```bash
# The actual command lines, inputs, outputs for a target's actions:
bazel aquery 'deps(//app:server)' --output text
bazel aquery '//app:server' --output jsonproto > aquery.json   # machine-readable

# Profile: where did build time go? (critical path, action durations)
bazel build //app:server --profile=prof.gz
bazel analyze-profile prof.gz          # or open chrome://tracing on the json

# The critical path is printed at the end of a build:
#   Critical Path: 42.13s
#     12.0s //lib:huge   [CppCompile]
#      9.8s //app:server [CppLink]
```

What to extract:

- **Critical path breakdown.** The end-of-build "Critical Path" lines name the longest dependency chain and its slowest actions — *exactly* where to focus optimization ([10 — Build Performance](../10-build-performance/professional.md)). Adding cores won't help these; restructuring the graph or speeding the action will.
- **`aquery` for "what does this action actually consume?"** The ground truth for debugging missing/extra inputs — compare declared inputs against what the tool really reads (under sandbox).
- **Build Event Protocol (BEP).** `--build_event_json_file` streams structured events (targets built, tests run, cache hits/misses, timings) consumed by CI dashboards (BuildBuddy, EngFlow) to track cache-hit rate, incrementality, and regressions *over time*. A dropping cache-hit rate is an early warning of a hermeticity regression.
- **Buck2** mirrors all of this (`buck2 aquery`, `buck2 log`, superconsole) and adds first-class profiling of the materialization and execution phases.

The mindset: you observe a build graph the way you observe a distributed system — structured events, profiles, critical-path traces — not by reading logs and guessing.

---

## War Stories

**1. The proto that rebuilt the company.** A widely-imported `.proto` defining a base message type got a one-field addition. Every service importing it (directly or transitively) rebuilt — thousands of targets, a multi-hour CI storm, cache largely cold because the action keys all changed. *Root cause:* the proto was a single god-message with high fan-out. *Fix:* split rarely-changing core types from frequently-changing ones into separate protos/targets, so a churny field no longer invalidates the stable core's huge `rdeps`. Lesson: **fan-out is a liability you design against, not just measure.**

**2. The `clean`-only bug.** A service intermittently shipped a stale feature flag default. Incremental builds never fixed it; `bazel clean && build` always did. *Root cause:* a codegen step read a config file *not* listed in its declared inputs (an under-approximated edge), so editing the config never invalidated the generated code. It "worked" because most builds were clean in CI; locally, incremental builds went stale. *Fix:* declared the config as an input and turned on sandboxing, which would have failed the undeclared read immediately. Lesson: **`clean` fixing it is a diagnosis — chase the missing edge.**

**3. The non-deterministic input that killed caching.** Cache-hit rate quietly fell from 85% to 12% over a week; CI times doubled. *Root cause:* a build rule started embedding `__DATE__`/`__TIME__` (build timestamp) into an object file, so its output — and every downstream action's input hash — changed on every build, making cache reuse impossible. *Fix:* strip the timestamp (a reproducibility fix, [09 — Reproducible Builds](../09-reproducible-builds/professional.md)); cache-hit rate recovered. Lesson: **a single non-deterministic input poisons incrementality and caching org-wide** — and BEP dashboards catch it as a falling hit rate before anyone files a ticket.

**4. The `-j` race that only failed in CI.** Tests passed locally, failed ~5% of the time in CI. *Root cause:* two test targets wrote to the same hard-coded temp path; locally they ran serially, in CI's higher parallelism they raced. The graph didn't model the shared file because it was an *undeclared* output. *Fix:* hermetic per-action sandbox dirs; the shared write became impossible. Lesson: **missing edges become races under parallelism — "passes at -j1, flaky at -jN" is a graph completeness bug, every time.**

---

## Mental Models

- **`--explain` is the rebuild's stack trace; `somepath` is its call graph.** Don't accept "it rebuilt a lot." Every rebuild has a traceable cause — an input, an edge, a key change. Produce it.

- **`clean` fixing a bug is a *diagnosis*: your graph under-approximates.** It localizes the bug to a missing input edge. Treat it as a lead, never a fix.

- **The graph is a commons.** One convenient edge is harmless; unchecked, the whole org adds them and the graph rebuilds everything on every change. Visibility and layering checks are the fences that prevent the tragedy.

- **Fan-out is a designed-against liability.** A high-`rdeps` node is a blast-radius bomb and a coupling hotspot. You don't just monitor it — you split it before it dominates your CI bill.

- **Incrementality is money and velocity.** Affected-test selection × PR rate is a six-figure line item and a 10× feedback-loop difference. The graph is the lever; hermeticity is what makes pulling it safe.

- **Observe builds like distributed systems.** Critical-path traces, BEP event streams, cache-hit dashboards. A falling cache-hit rate is an incident signal, not a curiosity.

---

## Common Mistakes

1. **Accepting "it just rebuilt a lot" without tracing it.** Use `--explain`, `somepath`, `rdeps` to name the chokepoint or changed input. Every rebuild storm has a specific cause.

2. **Treating `clean` as a fix instead of a diagnosis.** It masks an under-approximated graph that will go stale again. Find and declare the missing input; enable sandboxing.

3. **Letting fan-out grow unchecked.** A target with thousands of reverse deps becomes a CI tax on every edit. Split god-targets/god-protos proactively.

4. **Affected-test selection that can under-approximate.** A selection that *misses* an affected test greenlights broken changes — worse than running everything. Make selection conservative and test it.

5. **Ignoring a falling cache-hit rate.** It's the leading indicator of a hermeticity regression (a non-deterministic input crept in). Dashboard it and alert.

6. **Skipping visibility/layering enforcement.** Without enforced edge constraints the graph rots into a hairball; architecture erodes invisibly. Make forbidden edges fail the build.

7. **Optimizing actions that aren't on the critical path.** Speeding up a node that runs in parallel off the critical path doesn't move wall-clock time. Read the critical-path trace first.

---

## Test Yourself

1. A PR "changed one line" and CI rebuilt 3,000 targets. Walk through the exact commands you'd run to find the cause, and list the four usual culprits.
2. What is the single litmus test that tells you a "didn't rebuild" bug is an under-approximated graph? Why does sandboxing structurally cure it?
3. Express coupling and cohesion as queryable build-graph metrics. What query reveals an unintended dependency, and how do you read its output?
4. Why must CI affected-test selection over-approximate rather than under-approximate? What failure does under-approximation cause?
5. Cache-hit rate fell from 85% to 12% over a week with no graph changes. Give the most likely cause and how you'd confirm it.
6. Two tests pass at `-j1` but flake at `-j16` in CI. What category of graph error is this, and what's the structural fix?
7. You sped up a slow compile action but total build time didn't change. What did you probably miss, and how do you check?

<details>
<summary>Answers</summary>

1. `bazel build //... --explain=explain.log --verbose_explanations` to get per-action rebuild reasons; `bazel query 'somepath(//affected, //changed)'` for the propagation path; `bazel query 'rdeps(//..., //changed)'` for the blast radius. Four culprits: **high-fan-out node touched**, **over-broad input glob**, **toolchain/config change** (invalidates many action keys — correct), **non-deterministic input** (hash never stabilizes → constant rebuilds).
2. **Does `clean` fix what incremental can't?** If yes, the incremental graph is missing an input edge (under-approximation) — incremental never marks the action dirty, but `clean` forces a correct full rebuild. **Sandboxing** cures it structurally: an action that reads an undeclared file *fails the first time* under the sandbox, surfacing the missing edge immediately instead of going silently stale.
3. **Coupling = fan-out**: `bazel query 'rdeps(//..., //lib:x)' | wc -l` (how many depend on x). **Cohesion = a target's mix of responsibilities / high fan-in** (depends on DB+UI+crypto = low cohesion). Unintended dependency: `bazel query 'somepath(//tools:cli, //ml:training)'` prints the chain of edges connecting them; read it to find the one lazy edge to cut.
4. Because **missing an affected test greenlights a broken change** — a correctness failure, far worse than the wasted time of running extra tests. Under-approximation here = false "this PR is safe." Selection must include when unsure (conservative/over-approximate).
5. A **non-deterministic input crept into an action** (e.g. a build timestamp/hostname/path baked into output), so its output hash — and every downstream input hash — changes every build, making cache reuse impossible. Confirm via BEP/cache dashboards (which action's hit rate dropped) and `aquery`/diffing two builds' action keys to find the unstable input; fix is a reproducibility fix.
6. A **missing edge → race under parallelism** (an undeclared shared input/output two actions both touch). At `-j1` they serialize and never collide; at `-jN` they race. Structural fix: **hermetic per-action sandboxing** so the shared access is impossible / fails loudly, plus declaring the real input/output.
7. The action probably **wasn't on the critical path** — speeding a node that runs in parallel off the longest dependency chain doesn't reduce wall time. Check the end-of-build **Critical Path** report (or `--profile` / `analyze-profile`) and optimize the actions actually on it.

</details>

---

## Cheat Sheet

```
WHY DID THIS REBUILD?
  bazel build //x --explain=e.log --verbose_explanations   # per-action reasons
  bazel query 'somepath(//x, //changed)'                   # propagation path
  bazel query 'rdeps(//..., //changed)'                    # blast radius
  culprits: high fan-out · over-broad glob · toolchain/config bump · nondeterministic input

WHY DIDN'T THIS REBUILD?  (scarier — wrong artifact)
  litmus: does `clean` fix it but incremental can't?  → MISSING EDGE (under-approx)
  bazel aquery 'mnemonic("CppCompile",//x)' | grep input   # declared inputs
  build under --spawn_strategy=sandboxed  → undeclared read FAILS loudly (cure)

GRAPH HYGIENE (keep D ≈ T, shape sane)
  visibility = enforced edge permissions (governance, not bureaucracy)
  ban glob(["**/*"]) / god-targets  · layering checks fail forbidden edges
  unused_deps / Gazelle / depcheck → strip dead edges · tune target size

ARCHITECTURE SIGNAL
  fan-out (rdeps count) = COUPLING hotspot   bazel query 'rdeps(//...,//x)'|wc -l
  high fan-in + mixed responsibilities = low COHESION
  somepath(//a,//b) = "WHY does a depend on b?" → find the edge to cut
  attempted cycles = misplaced boundary → extract shared module (cycle→diamond)

CI COST LEVER
  build/test only rdeps of changed targets:
    bazel test $(bazel query "kind(test, rdeps(//..., $CHANGED))")
  selection must OVER-approximate (missing an affected test = greenlit bug)
  remote cache closes loop: run only what's downstream AND not cached
  watch cache-hit rate (BEP dashboard) → drop = hermeticity regression

PERF / OBSERVABILITY
  --profile=prof.gz ; bazel analyze-profile ; end-of-build "Critical Path"
  optimize ONLY actions on the critical path (cores won't help depth)
  aquery = concrete commands/inputs · BEP = structured events for dashboards
```

---

## Summary

- **"Why did this rebuild?"** is answered, never shrugged at: `--explain` (rebuild reasons) + `somepath` (path) + `rdeps` (blast radius). The usual culprits are a high-fan-out node, an over-broad glob, a toolchain/config bump, or a non-deterministic input.
- **"Why didn't this rebuild?"** is the dangerous one (wrong artifact, not slow). The litmus test: *`clean` fixes it but incremental can't* ⇒ under-approximated graph / missing input edge. **Sandboxing** cures it structurally by making undeclared reads fail loudly.
- **Graph hygiene** keeps **D ≈ T** and the shape sane at org scale: visibility as enforced governance, no over-broad globs, layering/cycle checks in CI, dead-edge removal, and target sizing as ongoing gardening. The graph is a commons with a tragedy-of-the-commons failure mode.
- The graph is the **most honest architecture signal** you have: **fan-out = coupling** (queryable via `rdeps | wc -l`), low **cohesion** shows as mixed-responsibility high-fan-in targets, attempted cycles flag misplaced boundaries, and `somepath` exposes unintended coupling to cut. Wire these into CI and architecture erosion fails the build.
- **Incrementality is the top CI cost lever**: build/test only the reverse-dependency closure of a change (over-approximating for safety), with remote caching ensuring even that set isn't recomputed. The savings scale with PR rate — a six-figure bill and a 10× feedback-loop difference.
- **Operate builds like distributed systems**: critical-path traces, `--profile`, BEP event streams, cache-hit dashboards. A falling cache-hit rate is an incident signal (hermeticity regression), and optimization effort belongs on the critical path, not on parallel-but-fast nodes.

Next: [interview.md](interview.md) — a graded question bank with model answers and what each question is really testing.

---

## Further Reading

- [Bazel — "Build performance" and "Aquery"](https://bazel.build/rules/performance) — profiling, critical path, and action-graph inspection in production.
- *Software Engineering at Google* (Winters, Manshreck, Wright) — chapters on build systems, dependency management, and large-scale change; the canonical org-scale treatment.
- [BuildBuddy / EngFlow engineering blogs](https://www.buildbuddy.io/blog/) — real-world remote caching, BEP dashboards, and incrementality-at-scale war stories.
- *Recursive Make Considered Harmful* (Peter Miller) — still the clearest case study of how a fragmented graph destroys incremental correctness.

---

## Related Topics

- [07 — Build Caching](../07-build-caching/professional.md) — remote caching, cache poisoning, and hermeticity as the precondition for trusting the cache.
- [09 — Reproducible Builds](../09-reproducible-builds/professional.md) — eliminating non-deterministic inputs that poison incrementality and caching.
- [10 — Build Performance](../10-build-performance/professional.md) — critical-path optimization and CI cost engineering.
- [03 — Make and Descendants](../03-make-and-descendants/professional.md) — operating Bazel/Buck2 graph engines at scale.
- [interview.md](interview.md) — graded questions on everything in this topic.
