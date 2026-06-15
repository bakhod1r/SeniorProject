# Polyglot / Hermetic Builds — Interview

> **Roadmap:** [Build Systems](../README.md) → Polyglot / Hermetic Builds
> *Build-system questions separate engineers who have only used `npm run build` from those who understand why a build can be trusted. Hermeticity is the concept interviewers probe to find out which one you are.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [How Interviewers Use These Questions](#how-interviewers-use-these-questions)
3. [Section A — Hermeticity Fundamentals](#section-a--hermeticity-fundamentals)
4. [Section B — The Action Graph and Model](#section-b--the-action-graph-and-model)
5. [Section C — Caching and Remote Execution](#section-c--caching-and-remote-execution)
6. [Section D — Toolchains and Platforms](#section-d--toolchains-and-platforms)
7. [Section E — Bazel vs Alternatives](#section-e--bazel-vs-alternatives)
8. [Section F — Adoption Decisions](#section-f--adoption-decisions)
9. [Section G — Debugging Non-Hermetic Builds](#section-g--debugging-non-hermetic-builds)
10. [Design Scenarios](#design-scenarios)
11. [Rapid-Fire Round](#rapid-fire-round)
12. [Red Flags Interviewers Listen For](#red-flags-interviewers-listen-for)
13. [Summary](#summary)
14. [Related Topics](#related-topics)

---

## Introduction

This is a question bank with model answers for polyglot and hermetic build systems, the kind asked of senior, staff, and build/DevEx-platform candidates. Each question lists **what the interviewer is really testing**, a **model answer**, and where useful a **follow-up** and the **trap** that catches under-prepared candidates.

The single idea threaded through every section: **a hermetic build depends only on explicitly declared inputs, so the same inputs always produce the same outputs — which is what makes caching, reproducibility, and remote execution correct rather than hopeful.** If you can derive everything else from that sentence, you will do well.

---

## How Interviewers Use These Questions

Build-system questions are a fast way to gauge depth because they reward systems thinking and punish memorization. An interviewer is usually checking three things:

- **Do you understand *why*, not just *what*?** Anyone can say "Bazel caches." The signal is explaining why caching is only *safe* under hermeticity.
- **Can you reason about tradeoffs?** The strongest candidates volunteer the *cost* (BUILD upkeep, migration) unprompted and say when *not* to use a hermetic build.
- **Have you operated this, or only read about it?** War stories, the cache-hit-rate-as-vital-sign instinct, and "passes locally, fails on RBE = leak" are tells of real experience.

---

## Section A — Hermeticity Fundamentals

**A1. Define a hermetic build. Why does it matter?**

> *Testing:* the core concept. If this is shaky, nothing else lands.

**Model answer.** A hermetic build depends *only* on explicitly declared inputs — its source files, pinned toolchains, and declared dependencies — and on nothing ambient: not the system `PATH`, not undeclared files on disk, not the network, not the clock or hostname. The consequence is the whole point: **same declared inputs always produce the same outputs.** That determinism is what makes builds reproducible across machines and makes caching *correct* — if the inputs did not change, the output cannot have changed, so reusing a cached output is safe. Without hermeticity, "the inputs" silently includes "whatever was on the machine that day," and reuse can hand you a wrong artifact.

**A2. Name four concrete ways a build can be non-hermetic.**

> *Testing:* whether you know the failure surface, not just the slogan.

**Model answer.** (1) Using the compiler on `PATH` rather than a pinned toolchain version. (2) Reading an undeclared file (a system header, a config in `$HOME`, `/etc/...`). (3) Fetching dependencies from the network *during* the build. (4) Baking in hidden state — the current time, a random seed, an absolute path, the hostname. Each makes "the inputs" depend on the environment.

**A3. Are `go build`, `npm run build`, and `mvn package` hermetic?**

> *Testing:* whether you understand the contrast that motivates Bazel.

**Model answer.** No, not by default. They use the toolchain on `PATH`, read global caches (`~/.m2`, the npm/Go module cache), and fetch from the network during the build. They are *convenient* — auto-discovering files and deps — but that convenience is exactly the non-hermeticity. Their caches are therefore not safely shareable across machines, because two machines can legitimately produce different outputs from the "same" checkout. **Trap:** candidates who claim a lockfile makes them hermetic — a lockfile pins *dependency versions*, but the toolchain, system libraries, and undeclared file reads are still ambient.

**A4. Why is hermeticity a prerequisite for a *shared* cache, specifically?**

> *Testing:* the causal link, the heart of the topic.

**Model answer.** A shared cache reuses an output whenever the input fingerprint matches. That reuse is only correct if the fingerprint captures *everything* that affects the output. Hermeticity is precisely the guarantee that the declared inputs *are* all the inputs — so two machines with matching fingerprints provably produced identical outputs. Drop hermeticity and a machine can produce a different output from hidden state, upload it under a fingerprint others share, and poison everyone's build. Hermeticity is what makes the cache key a *complete* description of the output.

---

## Section B — The Action Graph and Model

**B1. Walk me through Bazel's three phases.**

> *Testing:* whether you understand plan-vs-execute.

**Model answer.** **Loading** reads `BUILD` files and evaluates Starlark to produce the set of *targets* — no compiler runs. **Analysis** runs the rules, which emit *actions* (concrete commands with declared inputs/outputs) and *providers*, building the complete **action graph** — still no I/O, no building. **Execution** runs the subset of actions whose outputs are requested and not already cached — this is where compilers actually run. The separation matters for debugging: an analysis-phase failure is a wiring error in BUILD files; an execution-phase failure is a real compile/test failure.

**B2. Distinguish a target from an action. Which does the cache key over?**

> *Testing:* the single most important model distinction.

**Model answer.** A *target* (`//web:app`) is the named buildable thing you write in a BUILD file. An *action* is one concrete command Bazel runs — "compile these four files into this object." One target expands into many actions. The cache, the sandbox, and parallelism all operate on **actions**, because an action is the atomic, pure unit: a function from declared inputs to declared outputs.

**B3. What goes into an action's cache key, and why must it be complete?**

> *Testing:* the content-addressing model.

**Model answer.** The command line and flags, the content hashes of every input file, the content hashes of the *tools* (the pinned compiler), and the execution platform/environment. It must be *complete* because the key is only a valid stand-in for the output if it captures everything that could affect that output. Anything that affects the output but is missing from the key is a hermeticity leak — the cache will serve a stale or wrong result. **Follow-up they'll ask:** "Why hash *content* and not timestamps?" Because timestamps are fragile (touching a file with no content change shouldn't invalidate) and not portable across machines; content hashes are exact and machine-independent.

**B4. Why is `bazel build --jobs=200` safe when `make -j200` is famously not?**

> *Testing:* whether you connect hermeticity to parallel correctness.

**Model answer.** Bazel forbids undeclared dependencies and runs each action in a sandbox containing only its declared inputs. So two actions with no edge between them share no state and cannot interfere — they run in any order, concurrently, with identical results. Make recipes can have undeclared prerequisites and shared scratch files, so `-j` can run a recipe before the (undeclared) thing it actually needs. **Safe parallelism is a direct dividend of hermeticity.**

---

## Section C — Caching and Remote Execution

**C1. Distinguish remote caching from remote execution.**

> *Testing:* a distinction candidates routinely blur.

**Model answer.** Remote *caching* shares action *outputs* across machines: the action still executes on your machine, but if its key was already built by someone, you download the result instead. Remote *execution* (RBE) runs the *actions themselves* on a remote cluster of workers, so you are not bounded by your local cores. Both ride the open Remote Execution API. You adopt caching first — it is most of the CI win for the least operational cost — and add execution when local/CI compute becomes the proven bottleneck.

**C2. Why is RBE only safe for hermetic builds?**

> *Testing:* the consequence at the highest stakes.

**Model answer.** RBE ships an action's declared inputs to a worker you do not control and trusts the result. That is only valid if the output depends *solely* on those declared inputs. A non-hermetic action would read the worker's environment and return a divergent result that poisons the shared cache for everyone. This is also why RBE is the strictest leak detector: a worker lacks the undeclared files your laptop happened to have, so leaks that were invisible locally fail loudly remotely — the origin of "passes locally, fails on RBE."

**C3. Your cache hit rate is steadily falling. What's your hypothesis?**

> *Testing:* operational instinct; the vital-sign reflex.

**Model answer.** Most likely a **hermeticity leak** — some input (a timestamp, an absolute path, a passed-through environment variable, a nondeterministic codegen) is varying run-to-run, so action keys never match. Alternatively a hot, over-broad dependency that everything relies on is changing constantly, invalidating the world. Less likely, the cache eviction policy is too aggressive. Crucially, a falling hit rate is a *correctness* signal first, performance second: the cache is faithfully reporting that my "same" inputs are not actually the same. I'd run repeated-execution checks and diff action outputs across two machines to localize it.

**C4. What's the difference between cache hit rate and critical path, and which can RBE improve?**

> *Testing:* whether you know RBE's limits.

**Model answer.** Cache hit rate is the fraction of actions reused rather than run. Critical path is the longest dependency chain — the floor on wall-clock time. RBE (and parallelism generally) widens throughput and improves cache reuse, but it *cannot* beat the critical path: if action B depends on A, no number of workers runs them simultaneously. A bad critical path is fixed by restructuring the graph — splitting fat targets, breaking false dependencies — not by adding machines.

---

## Section D — Toolchains and Platforms

**D1. How does Bazel cross-compile cleanly, and why is the result reproducible?**

> *Testing:* the toolchain/platform model.

**Model answer.** Bazel models *constraints* (dimensions like `cpu`, `os`), *platforms* (named sets of constraint values, e.g. "linux + arm64"), and *toolchains* (compiler implementations tagged with which platforms they run on and target). You request a target platform with `--platforms=//platforms:linux_arm64`; toolchain *resolution* matches that against registered toolchains and injects the compatible, hash-pinned compiler — per target, transitively. Because the chosen toolchain is a pinned input, the same cross-compile produces bit-identical output on a Mac laptop or a Linux CI box. **Follow-up:** "How is this better than `GOOS=linux go build`?" That works per-language, ad hoc, and doesn't guarantee an identical *toolchain* across machines; Bazel unifies cross-compilation across all languages under one resolution model with the toolchain pinned.

**D2. Why is "the toolchain is an input to the action" such an important property?**

> *Testing:* whether you see how toolchains interact with caching.

**Model answer.** Because it makes compiler upgrades *correct* with respect to the cache. If the pinned toolchain's content hash is part of every action key that uses it, then upgrading the compiler changes those keys and correctly invalidates the cache — you rebuild exactly what the new compiler affects. If the toolchain were ambient (on PATH), upgrading it would silently produce different outputs under unchanged keys: a hermeticity leak and a cache-poisoning vector.

---

## Section E — Bazel vs Alternatives

**E1. Compare Bazel, Buck2, and Pants.**

> *Testing:* breadth and the ability to choose on substance.

**Model answer.** All three are polyglot and pursue hermeticity. **Bazel** (Google, Starlark rules) is the default by ecosystem gravity — the most rule sets, docs, RBE backends, and engineers who know it. **Buck2** (Meta, Rust core) shares the model but is often substantially faster with cleaner internals; it is younger with a thinner ecosystem. **Pants** (Rust core, Python plugins) wins on dependency *inference* — it generates much of the graph by parsing imports, slashing the BUILD-file tax — strongest in Python repos. The honest summary: Bazel unless you have a concrete, measured reason — Python-first low-ceremony (Pants) or measured speed wins on your graph (Buck2). Switching is a multi-quarter migration, so the justification must be data, not vibes.

**E2. What's the single biggest day-to-day complaint about Bazel, and how is it mitigated?**

> *Testing:* whether you know the real cost.

**Model answer.** The BUILD-file maintenance tax — every target and dependency must be declared explicitly. It's mitigated by **Gazelle**, which generates and updates BUILD files from source imports (so imports are the source of truth, not hand-written BUILD files), enforced by a presubmit that fails on drift, plus buildifier for formatting and buildozer for bulk edits. Pants attacks the same problem natively via inference. Organizations that make engineers hand-maintain BUILD files at scale are where Bazel becomes hated.

---

## Section F — Adoption Decisions

**F1. A startup with one 30k-line Go service asks if they should adopt Bazel. What do you say?**

> *Testing:* judgment, and the willingness to say no.

**Model answer.** No. Bazel's benefits scale with *work avoided* — shared cache hits, cross-language graphs, exact incrementality — which require a large and/or polyglot codebase to materialize. A single small Go service reuses almost nothing it wouldn't already get from `go build`'s own cache, while paying the full BUILD-file and ramp tax. The right answer is `go build`/`go test`. I'd revisit only if they grow into a large polyglot monorepo with cross-language dependencies and CI cost that becomes a top pain. **The willingness to recommend against the "impressive" tool is itself the signal.**

**F2. When *does* a hermetic build pay off?**

> *Testing:* the inverse, and the mechanism.

**Model answer.** When the benefit (avoided/shared work) outweighs the cost (BUILD upkeep, migration, an owning team). That happens with: a large monorepo, polyglot with genuine cross-language dependencies (shared proto/gRPC that must rebuild in lockstep), hundreds of engineers, and CI time/$ as a top pain. The strongest single signal is cross-language deps — no per-language tool models that graph, so the glue scripts are a permanent tax that Bazel eliminates.

**F3. How would you migrate a large live repo to Bazel?**

> *Testing:* whether you know it's an org program, not a tooling task.

**Model answer.** Incremental coexistence, never big-bang. (1) Foothold: `MODULE.bazel` plus one leaf service building green, including its third-party deps. (2) Coexistence: both builds run; the old one stays *authoritative*; CI runs both and compares artifacts so Bazel earns trust. (3) Generate BUILD files with Gazelle — never hand-write thousands. (4) Flip authority area by area as Bazel matches the incumbent. (5) Enable the remote cache, then RBE, *last*. The cost is dominated by the third-party dependency tail and developer ramp, needs a dedicated owner, and must have explicit kill criteria — a stalled 40% migration pays both build systems' costs and is the worst outcome.

---

## Section G — Debugging Non-Hermetic Builds

**G1. A test passes on every developer laptop but fails on RBE. Diagnose it.**

> *Testing:* the canonical leak scenario and the right instinct.

**Model answer.** Almost certainly a **hermeticity leak**: the test depends on something the laptop environment silently provides — an absolute file path, a system library, a tool on `PATH`, a shared mount — that the clean RBE worker lacks. "RBE is flaky" is the wrong conclusion: RBE is doing its job, enforcing that the test use only declared inputs, and surfacing a pre-existing dishonesty the local environment was masking. The fix is to declare the missing thing (e.g., add the fixture as a `data` dependency) so the sandbox provides it everywhere — after which the test behaves identically on all machines.

**G2. How do you actually *find* a non-hermetic action?**

> *Testing:* concrete tooling, not hand-waving.

**Model answer.** (1) `bazel build //... --experimental_repeated_executions=2` runs each action twice and flags any whose outputs differ — the canonical nondeterminism detector. (2) Build the same targets on two machines (or local vs RBE) with `--execution_log_json_file` and diff the logs to localize the divergent action. (3) `bazel aquery 'mnemonic("X", //...)'` inspects an action's real command and inputs to spot an embedded clock, an absolute path, `--action_env` passthrough, or `use_default_shell_env=True` (which leaks the host PATH). Common culprits: timestamps, absolute paths, map/set iteration order, zip mtimes. Fixes connect to reproducible builds — `SOURCE_DATE_EPOCH`, sorted outputs, stripped paths, zeroed archive timestamps.

**G3. Describe a cache poisoning incident and how you'd prevent recurrence.**

> *Testing:* whether you grasp the worst-case failure of a shared cache.

**Model answer.** A custom codegen rule embedded the build timestamp *and* used `use_default_shell_env=True`. The timestamp made the action key unstable (terrible hit rate); the env leak meant a developer with a different tool on PATH produced a subtly different artifact, uploaded it under a key others shared, and that wrong artifact was served to everyone — production shipped a binary built with the wrong generator. Prevention: strip the timestamp (`SOURCE_DATE_EPOCH`), remove the env leak by declaring only the needed tools/env, make **CI the only cache writer** (developers read-only), and add a repeated-execution determinism check to presubmit so unstable keys are caught before merge.

---

## Design Scenarios

**Scenario 1 — Design a build system for a 10-language monorepo.**

> *Testing:* synthesis — can you assemble the whole picture under constraints?

A strong answer hits these beats, in roughly this order:

1. **Justify the choice first.** Confirm the conditions that make a hermetic build pay off: it's a monorepo, genuinely polyglot, with cross-language dependencies (shared proto/IDL), at a scale where CI cost is real. If those don't hold, say so — don't reflexively reach for Bazel. Assuming they do, pick Bazel (default) and note when Pants/Buck2 would beat it.
2. **Model the graph.** Everything is a target in BUILD files; cross-language deps (proto → generated Go/Java/TS) are first-class edges. The shared `.proto` is one target that many languages depend on, so a change rebuilds exactly its declared dependents.
3. **Pin everything.** Toolchains per language are hash-pinned (not PATH); third-party deps are fetched and locked via `rules_*`/Bzlmod with hashes; the build runs offline. This is the hermeticity foundation.
4. **Enforce hermeticity.** Sandboxing on; the network off during execution; toolchains as declared inputs. Sandbox enforcement is what makes the next two steps *safe*.
5. **Scale with caching, then RBE.** Stand up a remote *cache* first (CI as the only writer) for the big CI win; add remote *execution* when compute is the bottleneck. SaaS (BuildBuddy/EngFlow) to start, self-host (BuildBarn) if data/control demands it.
6. **Sustain it.** Gazelle generates BUILD files from imports; presubmits (gazelle-check, buildifier, strict-deps) keep the declared graph equal to the real graph; visibility encodes architectural boundaries. Use `rdeps` to run only the tests a PR can affect.
7. **Measure.** Cache hit rate as the vital sign; critical-path analysis for wall-clock; alert on a falling hit rate as a leak signal.

The senior signal is volunteering the *cost* (a dedicated owning team, multi-quarter migration, the third-party tail) and the decision discipline (when *not* to do this), not just listing Bazel features.

**Scenario 2 — Your CI is 45 minutes and rising; PRs touch tiny slices. What do you do?**

A strong answer: first measure where the time goes (`--profile`, hit rate) rather than guessing. The symptom — small PRs, long builds — screams "we rebuild and retest things the change can't affect." If already on Bazel: enable/repair the remote cache, use `rdeps` to test only the affected closure, and hunt a falling hit rate as a leak. If on per-language tools, this is a candidate trigger for hermetic adoption — but only if the repo is large/polyglot enough to justify it; otherwise the cheaper fix is per-language build caches and test selection, not a Bazel migration.

---

## Rapid-Fire Round

> *One- or two-sentence answers. Interviewers use these to probe breadth quickly.*

- **What does `//...` mean?** Every target in the repository (relative forms: `//pkg/...` = that subtree).
- **What language are BUILD files written in?** Starlark — a deliberately limited Python subset (no loops-to-recursion, no arbitrary I/O) so loading is deterministic.
- **`MODULE.bazel` vs `WORKSPACE`?** Bzlmod's `MODULE.bazel` is the modern, hash-pinned external-dependency mechanism; `WORKSPACE` is its deprecated predecessor.
- **What does Gazelle do?** Generates and maintains BUILD files from source imports.
- **`bazel query` vs `cquery`?** `query` works on the loading-phase graph (ignores flags/platforms); `cquery` is configured (post-analysis, platform/flag-aware); `aquery` shows the actual actions.
- **What does `rdeps(//..., //x)` give you?** The reverse dependencies of `x` — the provable blast radius of changing it; the basis for affected-test selection.
- **Provider vs aspect?** Provider = typed struct a target hands its dependents (flows *up*); aspect = visitor over an existing graph (flows *across*).
- **Why no network during the build?** The thing on the other end can change, breaking reproducibility; deps are fetched and hash-pinned beforehand.
- **One flag that commonly breaks hermeticity?** `use_default_shell_env=True` (leaks host PATH); or `--spawn_strategy=local` (disables the sandbox).
- **Cache hit rate suddenly drops — perf bug or correctness bug?** Correctness first — almost always a hermeticity leak making "same" inputs differ.

---

## Red Flags Interviewers Listen For

- **Defining hermeticity as "reproducible builds."** Related but not the same — hermeticity (declared inputs only) is the *mechanism*; reproducibility (same bits) is one *result*. Conflating them signals shallow understanding.
- **Claiming Bazel is always better.** The strong candidate volunteers when *not* to use it. "Always use Bazel" is a junior tell.
- **Blaming RBE for "flakiness."** "Passes locally, fails on RBE" is a leak. A candidate who blames the infrastructure has not internalized hermeticity.
- **Hand-waving the cost.** Glossing over BUILD upkeep, the third-party tail, and multi-quarter migration suggests they've read about Bazel but never operated it.
- **Thinking a lockfile makes a build hermetic.** Lockfiles pin dependency *versions*; the toolchain, system libs, and undeclared reads are still ambient.
- **Treating "polyglot" as the hard part.** The hard, valuable part is hermeticity; polyglot support is handled by rule sets.

---

## Summary

- The one sentence to internalize: **a hermetic build depends only on explicitly declared inputs, so the same inputs always produce the same outputs — making caching, reproducibility, and remote execution correct rather than hopeful.** Almost every answer derives from it.
- Know the **model cold**: three phases (loading/analysis/execution), target vs action, the content-addressed action key, and why purity makes caching and `--jobs=N` parallelism safe.
- For **caching/RBE**: distinguish remote cache (share outputs) from remote execution (run actions remotely); know cache hit rate as the vital sign and the critical path as the floor RBE can't beat.
- For **toolchains/platforms**: constraints → platforms → toolchain resolution gives clean, reproducible cross-compilation because the toolchain is a pinned input.
- For **tools and adoption**: Bazel is the default; Buck2 (faster) and Pants (dependency inference) win with measured, concrete reasons. Be ready to say *no* to adoption for small or single-language repos, and to describe an incremental coexistence migration with a dedicated owner and kill criteria.
- For **debugging**: "passes locally, fails on RBE" = leak; find it with repeated executions, cross-machine output diffs, and `aquery`; prevent cache poisoning with stable keys, no env leaks, and CI as the only cache writer.
- The **red flags** to avoid: equating hermeticity with reproducibility, "always use Bazel," blaming RBE for flakiness, hand-waving cost, trusting a lockfile for hermeticity, and treating polyglot as the hard part.

---

## Related Topics

- [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md) — the full tier progression behind these answers.
- [07 — Build Caching](../07-build-caching/senior.md) — content-addressing and cache correctness, probed in Section C.
- [08 — Cross-Compilation](../08-cross-compilation/senior.md) — the platform/toolchain model from Section D.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — the determinism fixes behind the leak-debugging answers.
- [04 — Per-Language Tools](../04-per-language-tools/senior.md) — the non-hermetic baseline the contrast questions rely on.
- [02 — Dependency Graphs](../02-dependency-graphs/senior.md) — the graph theory under the action graph and `rdeps`.
