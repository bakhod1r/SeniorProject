# Dependency Graphs — Interview Preparation

> **Roadmap:** [Build Systems](../README.md) → Dependency Graphs
> *A graded question bank for build dependency graphs — from "what's a DAG" to "design incremental CI for a monorepo." Each answer comes with what the interviewer is really probing for.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [How to Use This Page](#how-to-use-this-page)
3. [Theme 1 — Graphs and DAGs (Fundamentals)](#theme-1--graphs-and-dags-fundamentals)
4. [Theme 2 — Topological Scheduling](#theme-2--topological-scheduling)
5. [Theme 3 — Incrementality and Correctness](#theme-3--incrementality-and-correctness)
6. [Theme 4 — Change Detection (Timestamps vs Hashes)](#theme-4--change-detection-timestamps-vs-hashes)
7. [Theme 5 — Diamonds and Cycles](#theme-5--diamonds-and-cycles)
8. [Theme 6 — Parallelism and the Critical Path](#theme-6--parallelism-and-the-critical-path)
9. [Theme 7 — Scale, Querying, and Models (Make vs Bazel)](#theme-7--scale-querying-and-models-make-vs-bazel)
10. [Design Scenarios](#design-scenarios)
11. [Debugging Scenarios](#debugging-scenarios)
12. [Rapid-Fire Round](#rapid-fire-round)
13. [Red Flags Interviewers Watch For](#red-flags-interviewers-watch-for)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

Build-system questions appear in infra/platform/build-engineering interviews, in senior backend rounds (monorepo experience), and increasingly in any role that owns CI. They're loved by interviewers because the dependency graph sits at the intersection of *algorithms* (DAGs, topological sort, graph traversal) and *systems judgment* (correctness vs speed, caching, scale) — so one topic separates "memorized an algorithm" from "operates real systems."

This page groups questions by theme, ordered roughly junior → professional within each. Every answer leads with a tight model response, then a **"What they're testing"** note so you can read the *intent* behind the question and adapt.

---

## How to Use This Page

- **Answer out loud before reading the model answer.** Recognition is not recall.
- **Watch the "What they're testing" notes** — the same surface question (e.g. "timestamps vs hashes") is junior-screening at one company and senior-architecture at another. Pitch your depth to the signal.
- **For design/debug scenarios, narrate your reasoning.** The interviewer wants the *path*, not just the destination.
- Depth ladder: [junior](junior.md) (graph basics, incremental, diamond/cycle) → [middle](middle.md) (make's model, headers, parallelism) → [senior](senior.md) (approximation, dynamic deps, early cutoff, scale) → [professional](professional.md) (operating, debugging, CI cost).

---

## Theme 1 — Graphs and DAGs (Fundamentals)

**Q1.1 — Why is a build modeled as a graph rather than a list of steps?**

Because steps have *dependencies* with structure that a linear list can't express: some steps must precede others, but many are independent and order-free. A graph captures "X needs Y" directly as edges, which lets the build (a) compute a valid order automatically instead of you hand-ordering, (b) skip steps whose inputs didn't change (incremental), and (c) run independent steps in parallel. A list forces a single fixed order and loses all of that.

> **What they're testing:** Do you understand *why* the abstraction exists, not just that it does? Strong answers tie the graph to its three payoffs (ordering, incrementality, parallelism).

---

**Q1.2 — What does "DAG" stand for, and why must a build graph be each of those three things?**

**Directed Acyclic Graph.** *Directed*: dependencies point one way ("X needs Y" ≠ "Y needs X"). *Acyclic*: no cycles — a cycle means mutual dependence with no valid starting point, so the build can never begin. *Graph*: nodes (targets) connected by edges (dependencies). The acyclic property is the load-bearing one: a directed graph has a valid build order (topological sort) *if and only if* it's acyclic.

> **What they're testing:** Precision. Many candidates say "DAG" without being able to justify *acyclic*. The iff-with-topological-sort connection is the senior-signal.

---

**Q1.3 — Define fan-in and fan-out for a build node, and why each matters operationally.**

**Fan-out** = how many nodes depend *on* this one (its reverse-dependency count). High fan-out = large blast radius: change this node and many things rebuild. It's the build-graph measure of *coupling*. **Fan-in** = how many nodes this one depends *on*. High fan-in = waits for many things (a link step), often the tail of the critical path, and frequently rebuilt (any of its many deps changing triggers it). Operationally: monitor high-fan-out nodes as CI-cost and coupling risks; high-fan-in nodes as latency/critical-path risks.

> **What they're testing:** Whether you connect graph terms to real consequences (blast radius, coupling, critical path) rather than reciting definitions.

---

## Theme 2 — Topological Scheduling

**Q2.1 — What is a topological order, and how is one computed?**

A topological order is a linear sequence of all nodes such that every node appears *after* all the nodes it depends on (every dependency precedes its dependent). Compute it with **Kahn's algorithm** (repeatedly emit a node with no remaining unbuilt dependencies, remove it, repeat) or a **DFS** that emits each node after recursing into its dependencies. Both are O(V + E).

> **What they're testing:** Core CS literacy. They may push to code Kahn's algorithm — be ready to track in-degrees and a queue of zero-in-degree nodes.

---

**Q2.2 — Is the topological order of a build unique? Why does the answer matter?**

Usually **no** — whenever two nodes don't depend on each other, their relative order is free, so many valid orders exist. It matters enormously: that freedom is *exactly* what permits parallelism. Independent nodes (no path between them) can be built simultaneously. A build with a unique topological order is a pure chain — fully serial, un-parallelizable.

> **What they're testing:** Do you see the link between "non-unique ordering" and "parallelizable"? This is the conceptual bridge to the critical-path discussion.

---

**Q2.3 — How does a topological-sort algorithm detect a cycle?**

It's a free by-product. In **Kahn's**, you repeatedly remove zero-dependency nodes; if you exhaust those but nodes remain, the remaining nodes have no valid starting point — they form a cycle. In **DFS**, encountering a node that's currently on the recursion stack (a "back edge") means you've looped back to an ancestor — a cycle. So "compute the order" and "detect a cycle" are the same traversal; failure to produce a complete order *is* the cycle detection.

> **What they're testing:** That you understand cycle detection isn't a separate pass — it falls out of the sort. Bonus if you name back-edges (DFS) or remaining-nodes (Kahn).

---

## Theme 3 — Incrementality and Correctness

**Q3.1 — What is an incremental build, and what is the formal correctness contract?**

An incremental build reuses prior outputs and rebuilds only what's affected by a change. The correctness contract: **the outputs of an incremental build must be byte-identical to those of a full clean build from the same inputs.** Incrementality may change *time* only, never *results*. A build is additionally *minimal* if it rebuilds only the actions whose transitive inputs actually changed.

> **What they're testing:** Whether you can state correctness rigorously. The "byte-identical to clean" framing is the senior answer; vague "rebuilds what changed" is the junior one.

---

**Q3.2 — Explain over- vs under-approximation of dependencies. Which is the safer error and why?**

Let **T** be the true set of inputs that affect an output and **D** the declared set. **Over-approximation (D ⊇ T):** you declared every real input plus maybe extras — *correct* (never stale) but possibly *slow* (rebuilds on irrelevant changes). **Under-approximation (D ⊊ T):** a real input is undeclared — its change triggers no rebuild → **stale build / wrong output**, possibly a race under parallelism. **Over is far safer**: its error costs *time* (recoverable); under's error costs *correctness* (ships a wrong binary, invisible until production). When you can't be exact, always over-approximate.

> **What they're testing:** The single most important judgment in build systems — the asymmetry between time and correctness. A candidate who treats both errors as equally bad hasn't operated a real build.

---

**Q3.3 — A bug disappears after `make clean` / `bazel clean` but incremental builds keep reproducing it. Diagnose it.**

That's the signature of an **under-approximated graph — a missing input edge.** The incremental build never marks the affected action dirty because it doesn't know about the changed input; `clean` forces a full rebuild that happens to be correct. The fix: find and declare the missing input (for C/C++, ensure `-MMD -MP` + `-include` is wired so the compiler-discovered header deps enter the graph), and ideally enable **sandboxing/hermeticity** so an undeclared read *fails loudly the first time* instead of silently going stale. `clean` is a *diagnosis*, never a fix.

> **What they're testing:** Pattern recognition for the most common real-world build bug, and whether you reach for the structural cure (hermeticity) rather than "just always run clean."

---

**Q3.4 — What are dynamic dependencies, and why can't a tool like `make` model them natively?**

Dynamic (a.k.a. monadic) dependencies are inputs knowable only *after* running an action — e.g. which headers a compile includes, the files a code generator emits from a schema, the modules a bundler reaches by following imports. `make` requires a **static** graph: all edges must be known *before* any recipe runs. So it can't express "the deps depend on the action's behavior." Its workaround is two-pass: emit discovered deps (`gcc -MMD` writes `.d` as a side effect) and `-include` them on the *next* build — accurate after the first run, over-cautious on the first. Ninja models them via `depfile`/`deps`; Bazel/Buck2/Shake support discovered inputs natively while staying hermetic.

> **What they're testing:** Whether you understand the static-vs-dynamic-graph limitation and recognize that `.d` files are a workaround for it, not just a make idiom.

---

## Theme 4 — Change Detection (Timestamps vs Hashes)

**Q4.1 — How does `make` decide a target is out of date? Give three ways that decision can be wrong.**

`make` compares modification times: a target is stale if it doesn't exist or **any prerequisite's mtime is newer** than the target's. Failure modes: (1) **clock skew** — on NFS/CI/distributed builds, machine clocks disagree, so a source can look newer/older than reality, scrambling decisions (`make` warns "Clock skew detected"); (2) **`touch` / `cp` / `git checkout`** — bump mtime with no content change → spurious rebuild, or preserve an old mtime → skipped rebuild; (3) **coarse mtime resolution** — edit and rebuild within the same second on a 1s-granularity filesystem and the two share a timestamp, so a *needed* rebuild is skipped (silent staleness).

> **What they're testing:** Depth on why mtime is a leaky proxy. Naming clock skew specifically signals real CI experience.

---

**Q4.2 — Contrast timestamp-based and content-hash-based change detection.**

Timestamps ask "is a prerequisite *newer*?"; hashes ask "is the content *different* from last time?" Hashing is **touch-proof** (touching doesn't change content), **clock-skew-proof** (no clocks involved), and **survives undo/checkout** (revert to old content ⇒ matching hash ⇒ no rebuild) — and crucially it's **safe to cache across machines**, because the key is content, not a local clock. The cost: hashing must *read the bytes* (mtime is just metadata). Real systems mitigate by caching hashes keyed on mtime+size, re-hashing only files whose mtime moved.

> **What they're testing:** Whether you know the trade-off both ways — hashing isn't strictly better, it costs I/O — and that you connect content-hashing to cross-machine caching.

---

**Q4.3 — What is early cutoff, and which detection model enables it?**

Early cutoff stops a rebuild from *propagating downstream* when an action's **output** is unchanged despite a changed input — e.g. you edit a comment, the source's hash changes so the object is recompiled, but the recompiled object is byte-identical to before, so nothing that depends on it needs rebuilding. It requires **content-addressing the outputs** (compare the new output hash to the recorded one) — Bazel, Buck2, Shake do this. Plain `make` *cannot*: the rebuilt file always has a newer mtime, so the change always propagates. Ninja approximates it with `restat = 1` (re-stat the output; if mtime didn't advance, don't propagate).

> **What they're testing:** A senior concept. Knowing early cutoff needs *output* hashing (not just input hashing) and that mtime structurally can't do it is a strong differentiator.

---

## Theme 5 — Diamonds and Cycles

**Q5.1 — Describe the diamond problem and how a correct build system handles it.**

A diamond: `D` depends on `B` and `C`, and both `B` and `C` depend on `A`. So `A` is reachable from `D` by two paths. A naive builder might build `A` twice. A correct build system builds **each node exactly once**, no matter how many dependents it has — when `A` is needed the second time, it's already built and is reused. `D` waits until *both* `B` and `C` complete. This is why a shared library used by ten modules compiles once, not ten times.

> **What they're testing:** Whether you know the "build each node exactly once" invariant — the basic correctness/efficiency property of any real graph engine.

---

**Q5.2 — Why are cycles illegal in a build graph, and what should you do when you hit one?**

A cycle (`A→B→C→A`) means every node is waiting on another with **no valid starting point** — no topological order exists, so the build can never begin. Build tools detect it (it falls out of the topological sort) and refuse to run (`make: Circular ... dependency dropped`). The fix is *not* to fight the tool: a cycle is almost always a **design problem** — two modules that mutually depend should either be merged, or the shared piece extracted into a third module that both depend on (converting the cycle into a *diamond*), or one direction of the dependency removed (e.g. via an interface/inversion).

> **What they're testing:** That you treat a build cycle as an *architecture* signal, not a tooling annoyance, and can name the standard resolution (extract a shared dependency).

---

**Q5.3 — How is the build-graph diamond related to the C++/multiple-inheritance "diamond problem"?**

Same graph shape, different domain. Both describe `D` reaching `A` via two paths (`B`, `C`). In C++ inheritance the danger is *two copies of A's state* (solved with virtual inheritance); in builds the danger is *building A twice* (solved by "build each node once"). The shared lesson: a shared ancestor reachable by multiple paths must be *resolved to a single instance*, whether that's one base subobject or one build action.

> **What they're testing:** Conceptual transfer — recognizing the same DAG pattern across domains signals depth.

---

## Theme 6 — Parallelism and the Critical Path

**Q6.1 — What is the critical path of a build, and why does it cap parallel speedup?**

The critical path is the **longest chain of dependent nodes** through the graph. Each node on it must wait for the previous, so even with infinite cores the build can't finish faster than the sum of the critical path's action times. Parallelism (`make -j`, Bazel's scheduler) compresses the graph's *width* (independent nodes run together) but never its *depth*. So a long, thin graph barely speeds up no matter how many cores you add.

> **What they're testing:** The depth-vs-width insight. Candidates who think "more cores = faster" without the critical-path caveat reveal a gap.

---

**Q6.2 — You add cores and `-j32`, but the build is barely faster. What's going on and how do you confirm?**

The build is likely **critical-path-bound** — a long dependency chain that parallelism can't shorten — or contended on a shared resource (disk/IO, a serializing link step, lock contention). Confirm with a profile: `bazel build --profile=prof.gz` then `bazel analyze-profile`, or read the end-of-build **Critical Path** report; for `make`, instrument timings. If the critical path ≈ total time, cores won't help — you must **restructure the graph** (split a god-target, break a serializing header, parallelize the link) or speed the individual actions on the path. Optimizing nodes *off* the critical path does nothing for wall time.

> **What they're testing:** Diagnostic instinct — measure the critical path before scaling hardware — and the judgment that graph shape, not core count, can be the bottleneck.

---

**Q6.3 — A test suite passes at `-j1` but flakes intermittently at `-j16`. Diagnose it.**

Classic **missing-edge race under parallelism.** Two actions/tests share a resource (a temp file path, a fixture, an output) that *isn't modeled in the graph* as a dependency. Serially they happen to run in a safe order; in parallel they interleave and corrupt each other — nondeterministically, which is why it's flaky. "Passes at `-j1`, flaky at `-jN`" is *always* a graph-completeness bug. Fix: declare the missing input/output, and enforce **per-action hermetic sandboxing** so the shared access is impossible (and fails loudly if attempted).

> **What they're testing:** Whether you map a flaky-under-parallelism symptom to an *under-specified graph* rather than blaming "flaky tests." This is a high-signal senior diagnosis.

---

## Theme 7 — Scale, Querying, and Models (Make vs Bazel)

**Q7.1 — What's the fundamental difference between `make`'s model and Bazel's, beyond "Bazel is faster"?**

The **identity model** — what keys a build result. `make` keys a result on a **mutable output path + mtime**; Bazel keys it on the **hash of (action definition + all input contents)**. Consequences cascade: `make`'s key doesn't travel between machines (mtimes are local), so results can't be safely shared → local-only, no remote cache, no early cutoff (a rebuilt file is always "newer"). Bazel's content-hash key is machine-independent → the same inputs yield the same output anywhere → results are **fetchable from a shared cache** (remote caching/execution), and output hashing enables **early cutoff**. "Faster" is the symptom; the cause is path+mtime vs content-hash identity.

> **What they're testing:** The deepest conceptual question in the topic. A candidate who reaches "identity model / content-addressing" rather than listing features understands build systems at the architecture level.

---

**Q7.2 — At monorepo scale you can't draw the graph. How do you reason about it?**

You **query** it. Bazel/Buck expose a query language: `deps(//x)` (what x needs), `rdeps(//..., //x)` (the blast radius — who depends on x), `somepath(//x, //y)` (*why* x depends on y — a connecting path), `kind(test, rdeps(//..., //x))` (the tests affected by changing x), and `aquery` (the concrete actions/commands an inspection of the *action* graph). You distinguish the **target graph** (coarse, human-authored) from the **action graph** (fine, executed). And you treat analysis/loading time itself as a cost (Bazel keeps a warm daemon holding the analyzed graph).

> **What they're testing:** Practical monorepo experience. Naming `rdeps` and `somepath` with their real use (blast radius, "why does X depend on Y") signals you've actually operated one.

---

**Q7.3 — What are visibility rules, and why do they matter for the graph at scale?**

Visibility rules (Bazel `visibility`, Buck visibility lists) make a dependency edge *require permission* — a target can only depend on another if the latter allows it. They're **dependency-graph governance**: without them, every target can depend on every other, and the graph degenerates into a hairball where nothing is removable and every change rebuilds the world. Visibility encodes intended architecture (layering, module boundaries, public vs internal APIs) as an *enforced* constraint — an unauthorized edge simply won't build.

> **What they're testing:** Whether you see the graph as a *governed* shared resource with a tragedy-of-the-commons failure mode, not just a thing the tool computes.

---

## Design Scenarios

**D1 — Design incremental CI for a 5,000-module monorepo so a PR runs only the work it affects.**

Structure the answer:

1. **Model the build as a graph** with one tool that tracks precise per-target inputs (Bazel/Buck2), so the graph is queryable and reasonably exact (**D ≈ T**).
2. **Map the diff to changed targets** — translate the PR's changed files into the targets that own them.
3. **Compute the affected set** = the reverse-dependency closure of the changed targets: `rdeps(//..., $CHANGED)`; affected tests = `kind(test, rdeps(...))`.
4. **Build/test only the affected set**, and lean on **remote caching** so even within that set, anything with a matching input hash is fetched, not rebuilt.
5. **Make selection conservative (over-approximate).** A selection that *misses* an affected test greenlights a broken change — far worse than running extra. When unsure, include.
6. **Guard the preconditions:** hermeticity (so the graph is complete and the cache is trustworthy), reproducibility (no nondeterministic inputs poisoning hashes), and flake management (flaky affected tests erode the whole scheme).
7. **Observe it:** dashboard cache-hit rate and affected-set size over time; a falling hit rate flags a hermeticity regression.

> **What they're testing:** Whether you can assemble graph + rdeps + caching + the over-approximation safety rule into a coherent, safe system — and whether you remember the *preconditions* (hermeticity/reproducibility) that make it trustworthy.

---

**D2 — A single shared `proto`/header is causing company-wide rebuilds on every small edit. Redesign.**

The root cause is **excessive fan-out**: one node many things depend on, so any change has a huge blast radius. Options, roughly in order:

- **Split by change frequency.** Separate the stable, rarely-edited core types from the churny, frequently-edited ones into distinct targets. Now a hot field no longer invalidates the stable core's large `rdeps`.
- **Split by consumer.** If different groups of consumers use disjoint subsets, partition the definitions so each consumer depends only on what it uses (tightens **D** toward **T**).
- **Introduce a stable interface boundary.** Consumers depend on a small, stable facade; implementation churn stays behind it.
- **Reduce the fan-out at the source** — question whether everyone *should* depend on this; `somepath` audits often find lazy edges to cut.

Measure success by the drop in `rdeps(//..., //the:target) | wc -l` for the hot parts.

> **What they're testing:** Treating fan-out as a designed-against liability and reaching for "split by change frequency" — the canonical fix for a god-proto/god-header rebuild storm.

---

**D3 — Design change detection for a build tool that must support a remote, shared cache across thousands of machines.**

You **cannot** use timestamps — mtimes are machine-local and clock-skew-prone, so they can't key a shared cache. Use **content hashing**: key each action's result on `hash(action_definition + hashes_of_all_inputs)`. Identical keys ⇒ identical outputs ⇒ safe reuse anywhere. Add: (a) **mtime+size-keyed hash caching** to avoid re-reading unchanged files; (b) **content-addressed output storage** to enable early cutoff and dedup identical outputs; (c) **hermetic execution (sandboxing)** so the input set is complete and no undeclared input poisons a key; (d) **reproducible actions** (strip timestamps/paths/hostnames) so the same inputs really do hash to the same outputs. Without (c) and (d), the cache serves wrong results to everyone.

> **What they're testing:** That you immediately rule out timestamps for distributed caching and can name the full supporting cast (hashing, content-addressed storage, hermeticity, reproducibility) — not just "use hashes."

---

## Debugging Scenarios

**B1 — "I changed the code and rebuilt, but it's still running the old behavior."** 

Most likely an **under-approximated graph** (a missing input edge) — the build doesn't know about the input you changed, so it skips the rebuild. Confirm with the litmus test: does `clean` fix it? If yes, hunt the missing input (`aquery` the action's declared inputs vs. what it actually reads; for C/C++ check `-MMD`/`-include` is wired). Fix by declaring the input and enabling sandboxing so undeclared reads fail loudly. (Secondary suspects: stale remote cache entry from a non-hermetic action; mtime granularity on a `make` build.)

---

**B2 — "CI cache-hit rate dropped from 85% to 12% over a week and builds doubled."**

A **non-deterministic input** crept into an action — a build timestamp, hostname, absolute path, or unsorted map embedded in an output. Its hash changes every build, so its output (and every downstream input hash) changes, making cache reuse impossible. Confirm via the BEP/cache dashboard (which action's hits collapsed) and by diffing two builds' action keys (`aquery`) for the unstable input. Fix is a **reproducibility fix** — strip the nondeterminism (e.g. `-Wdate-time`, `SOURCE_DATE_EPOCH`, sorted outputs).

---

**B3 — "A trivial one-character edit rebuilds thousands of targets."**

Either you touched a **high-fan-out node** (a base library/proto/header everyone imports — confirm with `rdeps`), an **over-broad input glob** made a target depend on far more than it uses (`glob(["**/*"])`), or you bumped a **toolchain/flag** that legitimately changed every action's key (correct, but avoid doing it casually mid-day). Use `--explain` + `somepath` + `rdeps` to identify which. Fix: split the god-node, narrow the glob, or schedule toolchain bumps deliberately.

---

**B4 — "Build passes locally and on one CI runner but fails on another."**

Suspect an **input that isn't part of the declared graph but differs across machines** — an environment variable, a tool version, a file outside the workspace, network access, or clock skew affecting an mtime-based build. The build is implicitly depending on something it didn't declare (under-approximation against the *environment*). Reproduce under **hermetic sandboxing**, which makes the hidden dependency fail consistently and visibly; then declare/pin it (toolchain, env, inputs).

> **What they're testing (B1–B4):** Whether you have a *systematic* diagnostic loop — symptom → category (under/over-approximation, nondeterminism, environment leak) → tool to confirm → structural fix — rather than guessing or reaching for `clean`.

---

## Rapid-Fire Round

- **Edge `X → Y` means?** X needs Y; Y must be built first.
- **DAG?** Directed Acyclic Graph — the shape of every build graph.
- **Topological order in one line?** Build each node only after all its dependencies.
- **Many valid orders implies?** Independent nodes → parallelism is possible.
- **Diamond?** Shared dependency reachable two ways → built exactly once. Fine.
- **Cycle?** No valid order → illegal → build refuses. Design smell.
- **Incremental correctness?** Output byte-identical to a clean build.
- **Under-approximation?** Missing edge → stale/flaky (unsafe).
- **Over-approximation?** Extra edge → wasted rebuilds (safe but slow).
- **Safe direction when unsure?** Over-approximate.
- **make change detection?** Prerequisite mtime newer than target.
- **Why mtime lies?** Clock skew, touch, coarse resolution.
- **Hash detection asks?** Is the content different?
- **Early cutoff needs?** Output content-addressing (Bazel, not make).
- **`-MMD -MP` does?** Compiler emits real header deps (`.d`) + phony targets.
- **Critical path?** Longest dependency chain — the parallel-speedup floor.
- **"Works -j1, flaky -jN"?** Missing edge → race.
- **Fan-out = ?** Coupling / blast radius.
- **rdeps gives?** Reverse deps — who's affected by a change.
- **somepath gives?** Why X depends on Y (a connecting path).
- **make vs bazel core difference?** path+mtime identity vs content-hash identity.
- **"clean fixes it, incremental doesn't"?** Under-approximated graph.
- **Biggest CI cost lever?** Affected-test selection via rdeps.

---

## Red Flags Interviewers Watch For

- **Treating under- and over-approximation as equally bad.** Reveals you've never operated a build where a stale binary shipped. The asymmetry (time vs correctness) is the whole game.
- **"Just run `clean`."** Masks a real graph bug. Senior engineers diagnose the missing edge.
- **"More cores = faster build."** Without the critical-path caveat, this signals no real performance experience.
- **Confusing "it linked/built" with "it's correct."** Incremental correctness is about matching a clean build, not about the build succeeding.
- **Thinking the `Makefile`/`BUILD` file runs top-to-bottom.** It's a graph, not a script; order of declarations rarely matters.
- **Not knowing why timestamps fail.** Clock skew and `touch` are table stakes for anyone claiming CI experience.
- **Reaching for features ("Bazel has remote caching") without the underlying model (content-addressed identity).** Shows memorization over understanding.
- **Ignoring hermeticity/reproducibility as preconditions** when designing caching or incremental CI. Without them the cache serves wrong results — a correctness incident, not an optimization.

---

## Further Reading

- *Build Systems à la Carte* (Mokhov, Mitchell, Peyton Jones) — the formal model behind correctness, minimality, and early cutoff; the single best source for senior depth.
- *Software Engineering at Google* — build-system and dependency-management chapters; the org-scale and monorepo perspective interviewers from large companies expect.
- [GNU Make manual](https://www.gnu.org/software/make/manual/) and [Bazel query docs](https://bazel.build/query/quickstart) — to ground your answers in real commands, not hand-waving.
- The [senior.md](senior.md) and [professional.md](professional.md) pages of this topic — the source material for the harder questions here.

---

## Related Topics

- [01 — Build Fundamentals](../01-build-fundamentals/interview.md) — compile/link questions that pair with graph questions.
- [03 — Make and Descendants](../03-make-and-descendants/interview.md) — tool-specific questions on Make, Ninja, Bazel, Buck2.
- [07 — Build Caching](../07-build-caching/interview.md) — content-addressing and remote-cache design questions.
- [10 — Build Performance](../10-build-performance/interview.md) — critical-path and CI-cost optimization questions.
- [Topological Sort (DSA)](../../../../Data/datastructures-and-algorithms/11-graphs/08-topological-sort/middle.md) — topological ordering, cycle detection, and DAG algorithms in depth.
