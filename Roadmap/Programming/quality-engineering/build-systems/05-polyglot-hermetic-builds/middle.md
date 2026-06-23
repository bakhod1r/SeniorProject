# Polyglot / Hermetic Builds — Middle Level

> **Roadmap:** [Build Systems](../README.md) → Polyglot / Hermetic Builds
> *The junior page sold you the idea: declared inputs only, same inputs same outputs. This page shows the machinery that makes it true — the action graph, the sandbox that enforces it, and the content-addressed cache that turns it into speed.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Everything Is a Target — the Three-Phase Model](#everything-is-a-target--the-three-phase-model)
4. [The Action Graph — the Real Unit of Work](#the-action-graph--the-real-unit-of-work)
5. [Starlark Basics — Loading Rules and Declaring Targets](#starlark-basics--loading-rules-and-declaring-targets)
6. [How Hermeticity Is Actually Enforced](#how-hermeticity-is-actually-enforced)
7. [The Content-Addressed Action Cache](#the-content-addressed-action-cache)
8. [Why Hermeticity Enables Safe Caching and Parallelism](#why-hermeticity-enables-safe-caching-and-parallelism)
9. [Driving Bazel — build, test, and query](#driving-bazel--build-test-and-query)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does Bazel model the build, and how do sandboxing and content-addressing turn hermeticity into speed?**

At the junior level, "hermetic" was a promise: declare your inputs, get reproducibility and caching. That model is correct but cannot yet explain *how* Bazel knows what to rebuild, *what* it actually caches (it is not "files" — it is **actions**), or *why* the same source can be safely built in parallel across a hundred machines and reassembled into one correct result.

The answers come from three concepts the junior page glossed: the **action** (the true atomic unit of work, below targets), the **sandbox** (the mechanism that *enforces* hermeticity instead of trusting you), and **content-addressing** (the fingerprint that makes caching exact rather than hopeful). This page makes them concrete — with real Starlark and real `bazel` commands you can inspect.

---

## Prerequisites

- **Required:** You have read [junior.md](junior.md) and can define hermeticity in your own words.
- **Required:** You understand dependency graphs and incremental builds. ([02 — Dependency Graphs](../02-dependency-graphs/middle.md).)
- **Helpful:** You have written or read a Makefile (targets, prerequisites, recipes) — Bazel generalizes the same idea.
- **Helpful:** Basic Python — Starlark is a Python subset.

---

## Everything Is a Target — the Three-Phase Model

Bazel's slogan is "everything is a target," but the more useful truth is that Bazel runs your build in **three distinct phases**, and confusing them is the source of most beginner errors.

| Phase | What runs | Output | Can it touch the filesystem? |
|---|---|---|---|
| **1. Loading** | Reads `BUILD` files, evaluates `load()` and macros | The set of *targets* in scope | No build I/O — just evaluates Starlark |
| **2. Analysis** | Rules run, producing **actions** and **providers** | The **action graph** (commands + their declared inputs/outputs) | No — still no actual building |
| **3. Execution** | Runs the actions whose outputs are needed and not cached | **Artifacts** (the real files) | Yes — this is where compilers run |

The key separation: **analysis decides *what* to do; execution does it.** During analysis, no compiler runs and no file is produced — Bazel is just building a complete plan: a graph of every command it *would* run, each with its exact declared inputs and outputs. Only in execution does it run the subset of that plan whose outputs are actually requested and not already cached.

```
BUILD files ──load──▶ targets ──analyze──▶ ACTION GRAPH ──execute──▶ artifacts
              (phase 1)          (phase 2: no I/O)         (phase 3: compilers run)
```

> **Key insight:** A *target* (`//services/payments:payments`) is what *you* name. An *action* (`run go compiler on these 4 files → this .a`) is what Bazel actually executes. One target usually expands into many actions. The cache, the sandbox, and parallelism all operate on **actions**, not targets — which is why understanding the action layer is the whole game.

---

## The Action Graph — the Real Unit of Work

An **action** is the atomic unit Bazel executes. Each action is, precisely:

- a **command** to run (e.g., invoke the Go compiler with these flags),
- an explicit, complete set of **input files** (sources, tools, dependencies' outputs),
- an explicit, complete set of **output files** it will produce.

That is it. An action is a pure function from declared inputs to declared outputs. The **action graph** is the directed graph where one action's outputs are another action's inputs — the cross-language dependency graph from [topic 02](../02-dependency-graphs/middle.md), but now every node is a concrete command with fully-declared edges.

Why is "complete and explicit" so load-bearing? Because Bazel computes, for each action, a fingerprint over *everything that could affect its output*:

```
action key = hash(
    command line + flags,
    content hashes of ALL input files,
    content hashes of the tools (the pinned compiler!),
    the execution platform / environment it declares
)
```

If two actions have the same key, they *must* produce the same output — *provided the action only depends on its declared inputs*. That proviso is hermeticity, and the sandbox is how Bazel makes it true rather than assumed.

When you change one source file, only the actions whose input hashes changed get a new key; everything else keeps its old key and is served from cache. This is incremental building made exact: not "did the timestamp change?" (Make's fragile heuristic) but "did the *content* of any declared input change?"

---

## Starlark Basics — Loading Rules and Declaring Targets

BUILD files are written in **Starlark**: Python's syntax, deliberately stripped of the dangerous parts. No `while` loops, no recursion, no arbitrary I/O, no `import` of the filesystem, deterministic dict ordering. That restriction is intentional — **loading must itself be hermetic and deterministic**, or the plan it produces would not be either.

A minimal cross-language slice:

```python
# proto/BUILD.bazel
load("@rules_proto//proto:defs.bzl", "proto_library")
load("@rules_go//proto:def.bzl", "go_proto_library")

proto_library(
    name = "user_proto",
    srcs = ["user.proto"],
)

go_proto_library(
    name = "user_go_proto",
    proto = ":user_proto",          # generate Go from the proto above
    importpath = "myrepo/proto/user",
    visibility = ["//visibility:public"],
)
```

```python
# services/payments/BUILD.bazel
load("@rules_go//go:def.bzl", "go_binary", "go_library", "go_test")

go_library(
    name = "payments_lib",
    srcs = ["server.go", "handler.go"],
    deps = ["//proto:user_go_proto"],     # the generated Go target above
    importpath = "myrepo/services/payments",
)

go_binary(name = "payments", embed = [":payments_lib"])

go_test(
    name = "payments_test",
    srcs = ["handler_test.go"],
    embed = [":payments_lib"],
)
```

Three pieces of Starlark literacy:

- **`load("@repo//pkg:file.bzl", "symbol")`** imports a rule. `@rules_go` is an *external repository* (a versioned, hash-pinned dependency declared in `MODULE.bazel`, below). The rule set is what teaches Bazel a language.
- **Labels.** `//proto:user_go_proto` is an absolute label: `//` = repo root, `proto` = package (directory with a BUILD file), `user_go_proto` = target name. `:foo` is shorthand for a target in the *same* package. `@redis//:redis` is a target in an external repo.
- **Macros vs rules.** A *rule* (`go_library`) is implemented in a special context and emits actions. A *macro* is just a Starlark function that expands into one or more rule calls — sugar, evaluated during loading. Most things you write are rule calls; you write macros to avoid repetition.

Where do external repos like `@rules_go` and `@redis` come from? Modern Bazel declares them in **`MODULE.bazel`** via **Bzlmod**:

```python
# MODULE.bazel
module(name = "myrepo", version = "1.0")

bazel_dep(name = "rules_go", version = "0.46.0")
bazel_dep(name = "gazelle",  version = "0.35.0")
bazel_dep(name = "protobuf", version = "23.1")
```

Each dependency is resolved to an exact version and verified by hash. That hash-pinning is the "no surprise versions" half of hermeticity — the build cannot silently get a different `rules_go`. (The older mechanism was `WORKSPACE`; Bzlmod is its replacement.)

---

## How Hermeticity Is Actually Enforced

Declaring inputs is a *promise*. Bazel does not trust the promise — it **enforces** it. Three mechanisms:

**1. Sandboxing.** Before running an action, Bazel creates a fresh, isolated directory containing *only* the action's declared inputs (often via symlinks or a `mount` namespace on Linux), runs the command with that as its working tree, and discards it after. If the action tries to read a file it did not declare — a header in `/usr/include`, a config in `$HOME` — the file *is not there*. The action fails, surfacing the missing-input bug *at build time* instead of letting it leak in.

```bash
bazel build //services/payments:payments --sandbox_debug
# on failure, leaves the sandbox dir intact so you can see EXACTLY
# which files the action could (and couldn't) see
```

**2. Pinned, declared toolchains.** The compiler is not "whatever `go` is on PATH." It is a toolchain Bazel downloaded and pinned (an exact Go SDK, fetched by hash). The toolchain is itself an *input* to every action that uses it, so upgrading Go changes the action keys and correctly invalidates the cache. (How Bazel *selects* which toolchain for which target — `toolchain` resolution and `platform`s — is covered at [senior level](senior.md).)

**3. No network during execution.** All external dependencies are fetched during a separate, earlier *repository fetch* phase and pinned by hash. The execution phase runs offline. An action cannot `curl`, because the thing on the other end could change and break reproducibility.

> **Key insight:** Other build tools *ask* you to be hermetic and hope. Bazel *removes your ability to cheat*: the sandbox physically hides undeclared files, the toolchain is pinned not borrowed, and the network is off. Hermeticity stops being a discipline you must remember and becomes a property the tool guarantees. Disabling the sandbox (`--spawn_strategy=local`) is the single most common way teams accidentally let leaks back in.

---

## The Content-Addressed Action Cache

Here is what Bazel actually caches. For each action, it stores a mapping:

```
action key  →  the set of output files that action produced
hash(inputs+command+tools+platform)  →  outputs
```

This is a **content-addressed action cache**: the key is a content hash of everything that defines the action, and the value is its outputs. Before running any action, Bazel computes its key and looks it up. **Hit** → fetch the stored outputs, skip the work entirely. **Miss** → run the action (in the sandbox), then store `key → outputs` for next time.

Because the key is a content hash, it is *position- and machine-independent*. The same action built on your laptop and on a CI server computes the *same key* — so they can share one cache. This is exactly the **remote cache** the junior page promised, and it is the mechanism behind "40-minute build → 90 seconds":

```bash
# point the build at a shared remote cache
bazel build //... --remote_cache=grpc://cache.mycorp.internal:9092
# unchanged actions are fetched from the network instead of recomputed
```

A subtle but critical detail: the cache stores outputs *by the hash of their content too*. Identical output bytes are stored once. This is the same content-addressing idea as [build caching](../07-build-caching/senior.md) and Git's object store — a file is named by what it *is*, not where it lives.

> **The proviso, restated:** content-addressing makes caching *exact*, but only correct if the action key captures *everything* that affects the output. If an action secretly reads the system clock, two runs with the same key produce different outputs — and the cache will confidently serve the stale one. This is a **hermeticity leak**, and it is the root cause of nearly every "the cache gave me a wrong build" incident. Finding such leaks is a senior skill ([senior.md](senior.md)).

---

## Why Hermeticity Enables Safe Caching and Parallelism

Tie it together. Two huge capabilities fall out of "an action is a pure function of its declared inputs":

**Safe caching (across time and machines).** If an action is pure, its output depends *only* on its key. So:
- *Incremental*: unchanged inputs → same key → reuse last build's output. No rebuild.
- *Shared*: same key on any machine → same output → one machine's result is reusable by all. The remote cache is correct precisely because purity makes the key a complete description.

**Safe parallelism (and remote execution).** Two actions with no dependency edge between them share no state — the sandbox guarantees neither can see the other's scratch files. Therefore Bazel can run them **simultaneously**, on different cores or different machines, in any order, and the result is identical. There is no "but action A left a file action B depended on" — undeclared side effects are impossible. This is what makes **remote execution** (farming actions out to a cluster of build machines) safe and is explored at [senior level](senior.md).

```bash
bazel build //... --jobs=200     # 200 actions in parallel; correct because actions are isolated
```

Contrast a Makefile: parallel `make -j` is famously fragile because recipes can have undeclared dependencies and shared scratch files, so a target may build before its real (undeclared) prerequisite. Bazel forbids the undeclared dependency, so `-j` is *always* safe. **Correctness under parallelism is a direct dividend of hermeticity.**

---

## Driving Bazel — build, test, and query

The day-to-day commands, and the one that makes Bazel feel like a database of your codebase:

```bash
bazel build //...                     # build every target
bazel build //services/payments:all   # every target in that package
bazel test  //services/payments/...   # test that subtree
bazel run   //services/payments        # build then run the binary

bazel clean                           # drop outputs (rarely needed; cache handles staleness)
bazel build //web:app --jobs=auto     # parallelism
```

**Query** lets you interrogate the graph itself — invaluable for understanding a large repo and for CI:

```bash
# What does this target depend on (transitively)?
bazel query "deps(//web:app)"

# Who depends on the proto target? (i.e. what must rebuild if it changes?)
bazel query "rdeps(//..., //proto:user_proto)"

# What tests are affected by a change to one file?
bazel query "rdeps(//..., //proto:user_proto)" --output=label | grep _test

# Show the dependency path between two targets
bazel query "somepath(//web:app, //proto:user_proto)"
```

`rdeps` ("reverse deps") is the killer query for CI: *given the files this pull request changed, which tests could possibly be affected?* Run only those, skip the rest — safely, because hermeticity guarantees nothing outside the dependency closure can be affected. There is also `cquery` (configured query, post-analysis, aware of platforms/flags) and `aquery` (action query, shows the actual actions) for deeper inspection. (See [02 — Dependency Graphs](../02-dependency-graphs/senior.md) for the graph theory.)

---

## Mental Models

- **Three phases = plan, then do.** Loading reads the files, analysis writes the *plan* (the action graph) without touching a compiler, execution runs the needed slice of the plan. "It fails in analysis" and "it fails in execution" are different bugs: the first is a wiring error in BUILD files, the second is a real compile/test failure.

- **An action is a pure function; the cache is its memoization table.** `output = f(inputs, command, tools, platform)`. The content-addressed cache is `memoize(f)`. Memoization is only correct for *pure* functions — which is exactly why hermeticity (purity) is non-negotiable.

- **The sandbox is a clean room, not a request.** Other tools post a sign saying "please don't touch undeclared files." Bazel builds a room with only the declared files in it. You *cannot* touch what is not there.

- **`rdeps` is "blast radius."** Changing target X can only affect things in `rdeps(//..., X)`. That set is the exact, provable blast radius of a change — the foundation of fast, correct CI.

- **Targets are nouns you name; actions are verbs Bazel runs.** You reason about targets; the engine reasons about actions. The cache and parallelism live at the verb layer.

---

## Common Mistakes

1. **Disabling the sandbox to "make it faster," then losing hermeticity.** `--spawn_strategy=local` runs actions directly on the host, where undeclared files exist again. Builds start passing for the wrong reason; the cache starts lying. If you must do it, know you have traded away the guarantee.

2. **Forgetting the toolchain is an input.** People expect "I upgraded Go but Bazel reused the cache." If the toolchain is properly declared, upgrading it *changes every action key* and correctly rebuilds. If your build reused stale outputs after a compiler change, the compiler was probably *not* a declared input — a hermeticity bug.

3. **Confusing targets and actions when reading errors.** "Action failed" with a compiler error is an *execution* problem in your code. "No such target" or "rule X has no attribute Y" is a *loading/analysis* problem in your BUILD files. Different phase, different fix.

4. **Over-broad `deps` or `glob`.** Listing more dependencies than a target uses enlarges its action keys, so it rebuilds when unrelated things change — quietly killing your cache hit rate. Declare the *minimal true* set.

5. **Treating `bazel clean` as the fix for everything.** In Make, `make clean` is routine. In Bazel, needing `clean` usually means something is *non-hermetic* (the cache should already be correct). Reaching for `clean` repeatedly is a symptom to investigate, not a workflow.

6. **Assuming `query` results reflect flags.** Plain `query` works on the *loading-phase* graph and ignores `--config` and platform settings. Use `cquery` when you need the configured (post-analysis) truth.

---

## Test Yourself

1. Name Bazel's three phases and state, for each, whether a compiler actually runs.
2. What is the difference between a *target* and an *action*? Which one does the cache key over?
3. What four things go into an action's cache key, and why must they be *complete*?
4. By what mechanism does Bazel *enforce* (not merely request) that an action only reads its declared inputs?
5. Why is `bazel build --jobs=200` safe in a way that `make -j200` is not?
6. You change one `.proto` file. Which `bazel query` tells you exactly which tests to run, and why is that set provably complete?

<details>
<summary>Answers</summary>

1. **Loading** (read BUILD files / evaluate Starlark — no compiler), **Analysis** (rules emit the action graph — still no compiler, no I/O), **Execution** (run the needed, uncached actions — *this* is where compilers run).
2. A *target* is the named buildable thing you write in a BUILD file (`//web:app`); an *action* is one concrete command Bazel runs (compile these files → this output). One target expands into many actions. The cache keys over **actions**.
3. The command line/flags, the content hashes of all input files, the content hashes of the tools (the pinned compiler), and the execution platform/environment. They must be *complete* because the key is only a valid stand-in for the output if it captures *everything* that affects the output — otherwise the cache serves stale/wrong results.
4. **Sandboxing**: Bazel runs the action in an isolated directory containing only its declared inputs (via symlinks/mount namespaces), so undeclared files physically are not present and reads of them fail.
5. Bazel forbids undeclared dependencies and isolates each action in a sandbox, so two actions with no edge between them share no state and can run in any order/concurrently with identical results. Make recipes can have undeclared deps and shared scratch files, so `-j` can build a target before its real (undeclared) prerequisite.
6. `bazel query "rdeps(//..., //proto:user_proto)"` (filtered to `_test` targets). It is provably complete because hermeticity guarantees a target can only be affected by changes within its declared dependency closure — nothing outside `rdeps` can possibly be impacted.

</details>

---

## Cheat Sheet

```
THREE PHASES
  loading    read BUILD files / eval Starlark      → targets        (no compiler)
  analysis   rules emit actions + providers        → ACTION GRAPH   (no I/O)
  execution  run needed, uncached actions          → artifacts      (compilers run)

TARGET vs ACTION
  target  //pkg:name        what YOU name (binary/library/test)
  action  one command       what BAZEL runs; 1 target → many actions
  cache & sandbox & parallelism operate on ACTIONS

ACTION KEY (content-addressed)
  hash( command+flags + input file hashes + TOOL hashes + platform )
  same key  ⇒  same output  (IF hermetic)  ⇒  reuse from cache

HERMETICITY ENFORCED BY
  sandbox          isolated dir with ONLY declared inputs (undeclared files vanish)
  pinned toolchain compiler is a declared input, not PATH
  no network       deps fetched+hashed beforehand; execution runs offline

STARLARK / LABELS
  load("@rules_go//go:def.bzl","go_binary")   import a rule
  //proto:user_go_proto   absolute label   :foo same-package   @repo//:t external
  MODULE.bazel: bazel_dep(name=..., version=...)   hash-pinned deps (Bzlmod)

COMMANDS
  bazel build //...                       build all
  bazel test  //pkg/...                   test subtree
  bazel build //... --remote_cache=...    shared cache
  bazel query "deps(//web:app)"           what it depends on
  bazel query "rdeps(//..., //proto:x)"   what's affected if x changes (CI gold)
  cquery (configured) / aquery (actions)  deeper inspection

SAFE BECAUSE PURE
  caching     memoize a pure function    (incremental + shared)
  parallelism isolated actions, any order (--jobs=N always safe)
```

---

## Summary

- Bazel runs in **three phases**: *loading* (read BUILD/Starlark → targets), *analysis* (rules emit the **action graph** — no I/O), *execution* (run the needed, uncached **actions** — compilers run here). Plan, then do.
- A **target** is what you name; an **action** is the atomic command Bazel runs — a pure function from explicit inputs to explicit outputs. One target expands into many actions, and **the cache, sandbox, and parallelism all operate on actions.**
- Each action has a **content-addressed key** = hash(command + input hashes + *tool* hashes + platform). Same key ⇒ same output ⇒ cache hit. This makes incremental builds *exact* (content, not timestamps) and the cache *shareable* across machines.
- Hermeticity is **enforced**, not requested: **sandboxing** hides undeclared files, **pinned toolchains** replace PATH, and **no network** runs during execution. The toolchain is itself a declared input, so upgrading it correctly invalidates the cache.
- Because actions are pure, **caching and parallelism are safe**: results are reusable across time and machines, and independent actions run concurrently in any order with identical results — `--jobs=N` is always safe in a way `make -j` is not.
- **`bazel query rdeps(...)`** gives the provable blast radius of a change — the foundation of fast, correct CI. Plain `query` is loading-phase; use `cquery`/`aquery` for configured/action-level truth.

The next level scales this up: remote caching and remote execution across clusters, toolchain resolution and platforms for clean cross-compilation, rules/providers/aspects in depth, Bazel vs Buck2 vs Pants, and how to hunt down the hermeticity leaks that poison caches.

---

## Further Reading

- [Bazel — *Build phases*](https://bazel.build/run/build) and [*Extension overview*](https://bazel.build/extending/concepts) — loading/analysis/execution and how rules emit actions.
- [Bazel — *Bzlmod / external dependencies*](https://bazel.build/external/module) — `MODULE.bazel`, version resolution, hash-pinning.
- [Bazel — *Query guide*](https://bazel.build/query/guide) — `deps`, `rdeps`, `somepath`, and the `cquery`/`aquery` variants.
- [Bazel — *Sandboxing*](https://bazel.build/docs/sandboxing) — how the clean room is actually built per platform.
- [senior.md](senior.md) — remote execution, toolchains/platforms, providers/aspects, and finding hermeticity leaks.

---

## Related Topics

- [02 — Dependency Graphs](../02-dependency-graphs/middle.md) — the graph theory under the action graph and `rdeps`.
- [07 — Build Caching](../07-build-caching/senior.md) — content-addressing, remote caches, and cache correctness in depth.
- [04 — Per-Language Tools](../04-per-language-tools/senior.md) — why their caches are *not* safely shareable across machines.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — turning "same key → same bytes" into a hard, audited guarantee.
- [senior.md](senior.md) — remote execution, platforms/toolchains, and the cost of adoption.
