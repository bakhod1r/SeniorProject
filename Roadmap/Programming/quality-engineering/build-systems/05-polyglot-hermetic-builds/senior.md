# Polyglot / Hermetic Builds — Senior Level

> **Roadmap:** [Build Systems](../README.md) → Polyglot / Hermetic Builds
> *Hermeticity is the property; remote execution, toolchain resolution, and the extension API are how you cash it in at scale — and the BUILD-file upkeep, dependency wrangling, and leak-hunting are the bill that comes with it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Remote Caching and Remote Execution (RBE)](#remote-caching-and-remote-execution-rbe)
3. [Toolchains and Platforms — Clean Cross-Compilation](#toolchains-and-platforms--clean-cross-compilation)
4. [Rules, Providers, and Aspects](#rules-providers-and-aspects)
5. [Bazel vs Buck2 vs Pants](#bazel-vs-buck2-vs-pants)
6. [Third-Party Dependencies — the Real Cost Center](#third-party-dependencies--the-real-cost-center)
7. [Hermeticity Leaks and How to Find Them](#hermeticity-leaks-and-how-to-find-them)
8. [Correctness vs Convenience — the Tradeoffs](#correctness-vs-convenience--the-tradeoffs)
9. [Mental Models](#mental-models)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do you scale a hermetic build to a cluster, build cleanly for any platform, extend it correctly, and keep it honest?**

By the middle level you can read the action graph and explain why content-addressed caching is safe. The senior job is different: you decide *how* to operate this at the scale where it pays off, *how* to extend it without breaking its guarantees, and *how* to diagnose the failures unique to hermetic systems — the test that only passed because the sandbox happened to leak, the cache that served a wrong artifact because an action key was incomplete.

This page covers the four levers that turn hermeticity into competitive advantage (remote execution, platforms/toolchains, the rule/provider/aspect API, the dependency model) and the four bills that come due (BUILD upkeep, third-party wrangling, leak-hunting, and the convenience you trade away). It also positions Bazel against Buck2 and Pants honestly, because "use Bazel" is not always the right answer.

---

## Remote Caching and Remote Execution (RBE)

Two distinct capabilities, often conflated. Both exploit the same property — actions are pure functions keyed by content — but they scale different bottlenecks.

**Remote caching (RBE's little sibling).** A shared, networked content-addressed store. Before running an action, Bazel asks the remote cache "have you seen this action key?" Hit → download outputs; miss → build locally and upload. The action *executes on your machine*; only the *results* are shared. This alone collapses CI time: most pull requests touch a thin slice of the graph, and the rest was built by someone earlier.

```bash
bazel build //... \
  --remote_cache=grpc://cache.mycorp:9092 \
  --remote_upload_local_results=true        # contribute your builds back
```

**Remote execution (full RBE).** The actions *themselves* run on a remote cluster, not your laptop. Bazel ships each action's inputs (by hash, deduplicated against what the cluster already has) to a fleet of workers, they execute in their own sandboxes, and outputs come back. Now you are not bounded by your laptop's cores — a from-scratch build of a massive repo runs across hundreds of remote workers in parallel.

```bash
bazel build //... \
  --remote_executor=grpc://rbe.mycorp:8980 \
  --jobs=500                                 # 500 concurrent remote actions
```

The protocol underneath both is the open **Remote Execution API (REAPI)**, which is why third-party backends interoperate: self-hosted **BuildBarn** / **Buildfarm**, or SaaS like **BuildBuddy** and **EngFlow**. (Operating these clusters and measuring their payoff is a [professional](professional.md) concern.)

> **Why RBE is only safe under hermeticity:** shipping an action to a stranger's machine and trusting the result requires that the action depend *only* on what you shipped. A non-hermetic action would read the worker's environment and return an output that does not match your machine — silently poisoning the shared cache for everyone. RBE is hermeticity's highest-stakes payoff *and* its strictest auditor: leaks that were invisible locally fail loudly on a remote worker that lacks the file you forgot to declare.

The two big numbers to watch are **cache hit rate** (fraction of actions served from cache) and **critical path time** (longest dependency chain — the floor RBE cannot beat by adding workers). Parallelism helps width; only graph restructuring helps the critical path.

---

## Toolchains and Platforms — Clean Cross-Compilation

Hermeticity demands a *pinned, declared* toolchain — but a real build targets multiple platforms (build a Linux binary from a Mac, an ARM image from x86). Bazel solves this with **toolchain resolution** over **platforms** and **constraints**, which is the cleanest model for cross-compilation in any mainstream build tool. (See [08 — Cross-Compilation](../08-cross-compilation/senior.md) for the general problem.)

Three concepts:

- **Constraint** — a dimension of a platform: `@platforms//cpu:arm64`, `@platforms//os:linux`.
- **Platform** — a named set of constraint values describing a machine: "linux + arm64."
- **Toolchain** — an implementation (a C++ compiler, a Go SDK) tagged with which platforms it *runs on* (`exec_compatible_with`) and which it *targets* (`target_compatible_with`).

```python
# platforms/BUILD.bazel
platform(
    name = "linux_arm64",
    constraint_values = [
        "@platforms//os:linux",
        "@platforms//cpu:arm64",
    ],
)
```

```bash
# build for a target platform that is NOT the host — no Docker, no "works on my arch"
bazel build //services/payments \
  --platforms=//platforms:linux_arm64
```

Bazel's resolution algorithm matches the requested **target platform** and the available **execution platform** against every registered toolchain's compatibility tags, and picks the right compiler automatically — per target, transitively. Because the chosen toolchain is a hash-pinned input, a cross-compile on a Mac laptop and on a Linux CI box produce *bit-identical* output for the same target platform. That is cross-compilation without the usual swamp of environment-specific shell scripts.

> **Key insight:** the per-language tools cross-compile too (`GOOS=linux GOARCH=arm64 go build`), but each does it its own way and none guarantees the *toolchain* is identical across machines. Bazel unifies cross-compilation across *all* languages under one resolution model, with the toolchain pinned — so "it cross-compiled differently on CI" becomes structurally impossible.

---

## Rules, Providers, and Aspects

Eventually a built-in rule does not exist for your need — a custom code generator, a bespoke packaging step. You extend Bazel in Starlark. Three primitives, in increasing subtlety:

**Rules** create actions and return providers. A rule's `implementation` function declares actions via `ctx.actions.run`:

```python
# tools/stamp.bzl
def _stamp_impl(ctx):
    out = ctx.actions.declare_file(ctx.label.name + ".stamped")
    ctx.actions.run(
        outputs = [out],
        inputs = [ctx.file.src],
        executable = ctx.executable._stamper,   # a pinned tool, an INPUT
        arguments = [ctx.file.src.path, out.path],
        mnemonic = "Stamp",
    )
    return [DefaultInfo(files = depset([out]))]

stamp = rule(
    implementation = _stamp_impl,
    attrs = {
        "src": attr.label(allow_single_file = True),
        "_stamper": attr.label(default = "//tools:stamper", executable = True, cfg = "exec"),
    },
)
```

Note the discipline baked into the API: outputs are *declared* (`declare_file`), inputs are *declared* (`inputs=[...]`), and the tool is itself an input. The API makes it hard to write a non-hermetic action — you have to go out of your way (e.g., `use_default_shell_env = True`) to leak.

**Providers** are the typed structs targets pass *up* the graph. `DefaultInfo` carries the output files; language rule sets define their own (`GoInfo`, `JavaInfo`) so a `go_binary` can collect transitive `.a` files from its `deps` without re-deriving them. Providers are how information flows along dependency edges — the typed contract between rules.

**Aspects** are the advanced tool: they walk an *existing* dependency graph and attach extra computation to every node *without modifying the rules*. This is how you build a linter that runs over every target, generate IDE project files, or emit a compile-commands database across the whole repo — orthogonal cross-cutting analysis layered on top of the build graph.

```bash
bazel build //... --aspects=//tools:lint.bzl%lint_aspect --output_groups=report
```

> **Key insight:** providers flow *up* (a target tells its dependents what it produced); aspects flow *across* (a computation visits every node of someone else's graph). Most engineers never write a rule. The few who own the build platform write all three — and a badly-written rule that forgets to declare an input is the most common source of org-wide cache poisoning.

---

## Bazel vs Buck2 vs Pants

All three are polyglot and pursue hermeticity; they differ in lineage, language, and ergonomics.

| | **Bazel** (Google) | **Buck2** (Meta) | **Pants** (Toolchain Labs) |
|---|---|---|---|
| Core language | C++/Java; rules in Starlark | **Rust** core; rules in Starlark | **Rust** core (since v2); Python plugins |
| Model | Targets → actions, REAPI RBE | Targets → actions, REAPI RBE; rules-as-data | Targets, fine-grained, dependency inference |
| Standout strength | Maturity, ecosystem, biggest rule sets | **Performance**, cleaner internals, virtual FS | **Low-config**: infers deps, esp. Python |
| BUILD authoring | Manual (or Gazelle) | Manual (or generators) | Often **inferred** — minimal BUILD files |
| Maturity / community | Largest, most battle-tested | Newer, open-sourced 2023, fast-moving | Mature in Python world, smaller overall |
| Best fit | Large polyglot orgs wanting the standard | Teams wanting Bazel's model but faster | Python-heavy repos wanting low ceremony |

The honest summary: **Bazel is the default** because of ecosystem gravity — the most rule sets, the most documentation, the most engineers who already know it, the most RBE backends. **Buck2** is technically excellent (Rust, a smarter incrementality engine, often dramatically faster) but younger, with a thinner ecosystem and more "you're early" sharp edges. **Pants** wins specifically when dependency *inference* matters — its killer feature is generating much of the dependency graph automatically (parsing imports), which slashes the BUILD-file tax that drives most Bazel complaints, at the cost of being strongest in Python.

Choosing is mostly a bet on ecosystem and team familiarity, not raw capability. If you must justify Buck2 or Pants over Bazel, the argument is concrete (we are Python-first; we have measured Buck2 N× faster on our graph), not aesthetic.

---

## Third-Party Dependencies — the Real Cost Center

The dirty secret of hermetic builds: your *own* code is easy. The expensive, ongoing friction is making the *outside world* hermetic — every third-party library must be fetched, pinned by hash, and given a BUILD file describing its targets, because upstream packages do not ship Bazel rules.

The mechanisms, per ecosystem:

- **Bzlmod (`MODULE.bazel`)** for Bazel-native deps and rule sets — version resolution with hash verification.
- **Language extensions** that translate a native lockfile into Bazel targets: `go_deps` reads `go.mod`; `rules_jvm_external`'s `maven.install` pins a Maven coordinate set with a lock file; `rules_python`'s `pip.parse` consumes a `requirements.txt` with hashes; `rules_js` / `aspect_rules_js` consume a pnpm lockfile.

```python
# MODULE.bazel — JVM deps pinned with a generated lock
maven = use_extension("@rules_jvm_external//:extensions.bzl", "maven")
maven.install(
    artifacts = ["com.google.guava:guava:32.1.3-jre"],
    lock_file = "//:maven_install.json",   # hashes pinned here, regenerated on change
)
use_repo(maven, "maven")
```

The labor: every dependency bump must be re-pinned and re-locked, occasionally a package needs a hand-written `BUILD` patch (`patches = [...]`), and a transitive C/C++ dependency may demand wrangling a whole `rules_foreign_cc` `./configure && make` into the hermetic model. This is where teams burn quarters, and it is the single biggest driver of "Bazel is painful." Budget for an owner. (See [06 — Dependency Management](../06-dependency-management/senior.md).)

---

## Hermeticity Leaks and How to Find Them

A **hermeticity leak** is an action whose real output depends on something *not* in its key — the system clock, an environment variable, an undeclared file, network access, build order, or nondeterministic compiler output. Leaks are insidious because the build keeps *working*; it just stops being trustworthy, and a shared cache amplifies one machine's leak into everyone's wrong artifact.

The detection toolkit:

```bash
# 1. Run every action twice and diff outputs — the canonical leak detector.
bazel build //... --experimental_repeated_executions=2 \
  || echo "non-deterministic action detected"

# 2. Tighten the sandbox to expose undeclared reads.
bazel build //... --spawn_strategy=sandboxed --sandbox_default_allow_network=false

# 3. Build the SAME targets on two machines (or local vs RBE) and compare action
#    outputs by hash — divergence localizes the leaky action.
bazel build //pkg:t --execution_log_json_file=local.json
# ... on RBE ...
bazel build //pkg:t --execution_log_json_file=rbe.json   # diff the two logs

# 4. Audit which env vars an action is allowed to see.
bazel aquery 'mnemonic("GoCompile", //...)'   # inspect the exact commands/inputs
```

The usual culprits, in rough order of frequency: timestamps and embedded build dates; absolute paths baked into output; `__pycache__`/zip-mtime nondeterminism; map/set iteration order; `--action_env` passing through a host variable; and `use_default_shell_env = True` in a custom rule (it leaks the entire host `PATH`). The fixes connect directly to [09 — Reproducible Builds](../09-reproducible-builds/senior.md): force `SOURCE_DATE_EPOCH`, sort outputs, strip paths, zero zip timestamps.

> **Key insight:** the most dangerous leak is the one the sandbox accidentally *tolerates* — a file present on every machine in your fleet (`/etc/ssl/certs`, a system Python) so the build "works" everywhere until it lands on the one machine that lacks it, or until RBE workers (which lack it) start failing or, worse, succeeding with a different result. "Passes locally, fails on RBE" is almost always a hermeticity leak the local environment was quietly filling in.

---

## Correctness vs Convenience — the Tradeoffs

Bazel optimizes relentlessly for *correctness* (provably-right incremental and cached builds) and pays for it in *convenience*. Senior judgment is knowing where you are willing to spend convenience and where you are not:

- **Strict deps vs ergonomics.** `strict_deps`/layering checks force every *used* dependency to be a *declared* dependency — catching the case where you accidentally rely on a transitive dep. Correct, but it generates churn and "buildozer fix-it" work. Most serious shops turn it on anyway.
- **Sandboxing cost.** Sandboxing has real per-action overhead (creating/tearing down the clean room). `--spawn_strategy` lets you trade isolation for speed; doing so risks reintroducing leaks. The mature stance: keep the sandbox on, fix the slow actions, and use RBE so the cost is amortized across the cluster.
- **`local` exceptions.** Sometimes an action genuinely cannot be hermetic (talks to a license server, needs a GPU driver). Bazel lets you tag it `tags = ["local", "no-remote", "no-cache"]` — a deliberate, *contained* hole rather than a global one. The skill is making the hole as small as possible and documenting why.
- **The BUILD tax vs the cache dividend.** Every gain (exact incrementality, shared cache, safe parallelism, clean cross-compile) is paid for in BUILD-file maintenance and ramp-up. The trade only nets positive at scale — which is the [adoption decision](professional.md) the whole next level is about.

---

## Mental Models

- **Remote cache shares *answers*; remote execution shares *the work*.** The cache says "someone already computed this." RBE says "let the cluster compute it." You usually want the cache first (cheap, huge win) and add execution when laptops/CI cores become the bottleneck.

- **Toolchain resolution is dependency injection for compilers.** You request a target platform; Bazel *injects* the compatible, pinned toolchain. You never name a compiler path — you declare a need and the resolver satisfies it. That indirection is what makes one BUILD file cross-compile everywhere.

- **Providers flow up, aspects flow across.** A provider is what a target hands its dependents. An aspect is a visitor you send over someone else's whole graph. Different directions, different jobs.

- **A leak is an edge missing from the action key.** Every non-hermetic behavior is, formally, an input the key forgot. Find the input; add it to the key (declare it) or eliminate it (force determinism). "Find the missing edge" is the entire debugging loop.

- **Correctness is the product; convenience is the price.** Bazel will always choose to be *right* over being *easy*. If a feature feels bureaucratic, ask what correctness guarantee it is buying — usually a real one.

---

## Common Mistakes

1. **Enabling RBE before fixing leaks.** RBE is a brutal leak detector. Teams flip it on, get a storm of "works locally, fails remote" failures, and blame RBE. The failures are pre-existing hermeticity bugs that the local environment was hiding. Audit determinism *first*.

2. **Treating remote cache and remote execution as one switch.** They are separate (`--remote_cache` vs `--remote_executor`). Start with caching; it is most of the win for least operational cost. Add execution deliberately.

3. **`use_default_shell_env = True` in custom rules.** It pipes the host `PATH` and environment into the action — the fastest way to write a leak. Declare the tools and env you actually need (`env = {...}`) instead.

4. **Letting third-party dep pinning rot.** Stale lock files, hand-patched BUILD files nobody owns, transitive C deps held together with tape. Without a designated owner, the dependency layer decays into the thing everyone hates about the build.

5. **Reaching for a custom rule when a macro or `genrule` would do.** Writing rules correctly (declaring every input/output, getting providers right) is genuinely hard. Most needs are a macro over existing rules; only reach for a rule when you must emit new action types.

6. **Ignoring the critical path while throwing workers at RBE.** Adding remote workers widens parallelism but cannot beat the longest dependency chain. If the critical path is the bottleneck, the fix is restructuring the graph (splitting fat targets), not more machines.

7. **Picking Buck2/Pants on vibes.** "Bazel is slow/painful" is sometimes true, but switching tools is a multi-quarter migration. Justify it with measured numbers and ecosystem fit, not a benchmark blog post.

---

## Test Yourself

1. Distinguish remote *caching* from remote *execution*. Which do you adopt first, and why?
2. Why is RBE *only* safe for hermetic builds, and why does it surface leaks that never appeared locally?
3. Explain toolchain resolution in terms of platforms and constraints. How does it make cross-compilation reproducible across machines?
4. What is the difference between a provider and an aspect? Give one real use for each.
5. Your CI uses a shared remote cache. One day a build produces a binary with the wrong embedded version string, and it spreads. Name the class of bug and three things you would run to localize it.
6. When would you choose Pants or Buck2 over Bazel, and what kind of argument justifies it?

<details>
<summary>Answers</summary>

1. Remote *caching* shares action *outputs* (the action runs on your machine; only results are reused across machines). Remote *execution* runs the *actions themselves* on a remote cluster. Adopt caching first: it is most of the CI win for the least operational cost, and execution can be layered on when local cores become the bottleneck.
2. RBE ships an action's declared inputs to a stranger machine and trusts the result; that is only valid if the output depends *solely* on declared inputs. A non-hermetic action reads the worker's environment and returns a divergent (cache-poisoning) result. It surfaces local leaks because the remote worker lacks the undeclared files your local machine happened to have, so the leak fails loudly instead of being silently satisfied.
3. A *constraint* is a platform dimension (os, cpu); a *platform* is a named set of constraint values; a *toolchain* declares which platforms it runs on and targets. Resolution matches the requested target platform (and the exec platform) against registered toolchains and picks the compatible, hash-pinned one — per target. Because the chosen toolchain is a pinned input, the same cross-compile produces bit-identical output on any host.
4. A *provider* is a typed struct a target returns to its dependents (flows *up* the graph) — e.g., `JavaInfo` carrying transitive jars. An *aspect* is a visitor that walks an existing graph and attaches computation to every node without changing rules (flows *across*) — e.g., generating a repo-wide compile-commands DB or a lint pass.
5. A **hermeticity leak / cache poisoning** (the action key omitted something that affected the output — almost certainly a timestamp/version source). Run: (a) `--experimental_repeated_executions=2` to catch the nondeterministic action; (b) build the target on two machines with `--execution_log_json_file` and diff; (c) `aquery` the suspect action to inspect its real inputs/command and look for `use_default_shell_env`, `--action_env` passthrough, or an embedded clock/path.
6. **Pants** when the repo is Python-heavy and the BUILD-file tax is the main pain — its dependency *inference* generates much of the graph automatically. **Buck2** when you want Bazel's model but have *measured* it materially faster on your graph and can absorb a thinner ecosystem. The justification must be concrete (ecosystem fit, measured numbers), not aesthetic — switching is a multi-quarter migration.

</details>

---

## Cheat Sheet

```
RBE — TWO THINGS
  remote cache      --remote_cache=...       share action OUTPUTS  (adopt first)
  remote execution  --remote_executor=...    run ACTIONS on a cluster
  protocol: REAPI → BuildBarn/Buildfarm (self-host), BuildBuddy/EngFlow (SaaS)
  watch: cache hit rate (width) + critical path (the floor RBE can't beat)

PLATFORMS / TOOLCHAINS  (clean cross-compile)
  constraint  @platforms//cpu:arm64, //os:linux
  platform    named set of constraint values
  toolchain   exec_compatible_with / target_compatible_with (hash-pinned)
  bazel build //t --platforms=//platforms:linux_arm64   # any host → identical output

EXTENSION API
  rule      declares actions (declare_file / actions.run); returns providers
  provider  typed struct flowing UP the graph (DefaultInfo, JavaInfo, GoInfo)
  aspect    visitor flowing ACROSS an existing graph (lint, IDE files, compdb)
  trap: use_default_shell_env=True  → leaks host PATH (don't)

TOOLS COMPARED
  Bazel  default; biggest ecosystem; manual BUILD (or Gazelle)
  Buck2  Rust core; faster; younger ecosystem
  Pants  infers deps (low BUILD ceremony); strongest in Python

THIRD-PARTY (the cost center)
  Bzlmod MODULE.bazel (hash-pinned) ; rules_jvm_external/maven.install + lock
  rules_python pip.parse ; go_deps (go.mod) ; aspect_rules_js (pnpm lock)
  → every bump = re-pin + re-lock; needs an OWNER

FIND LEAKS
  --experimental_repeated_executions=2     run twice, diff (nondeterminism)
  --execution_log_json_file=... (2 machines, diff)   localize divergence
  aquery 'mnemonic("X", //...)'            inspect real inputs/command
  usual culprits: clock, abs paths, $env passthrough, iteration order, network
```

---

## Summary

- **Remote caching** shares action *outputs* across machines (run local, reuse results); **remote execution (RBE)** runs the *actions* on a cluster. Adopt caching first; both ride the open REAPI (BuildBarn/Buildfarm self-hosted, BuildBuddy/EngFlow SaaS). RBE is hermeticity's biggest payoff *and* its strictest auditor.
- **Toolchain resolution** over **platforms** and **constraints** is the cleanest cross-compilation model in any build tool: request a target platform, get the compatible *pinned* toolchain injected per target — so the same cross-compile is bit-identical on any host.
- The extension API has three primitives: **rules** (emit actions, return providers — the API makes hermeticity the default and leaking deliberate), **providers** (typed structs flowing *up* the graph), and **aspects** (visitors flowing *across* someone else's graph).
- **Bazel** is the default by ecosystem gravity; **Buck2** is faster (Rust) but younger; **Pants** wins on dependency *inference* (low BUILD ceremony), strongest in Python. Choose on ecosystem fit and measured numbers, not aesthetics.
- The real cost center is **third-party dependencies** — every external library must be fetched, hash-pinned, and given BUILD targets via `rules_*`/Bzlmod. Budget an owner; this is where quarters are burned.
- A **hermeticity leak** is an input missing from the action key (clock, path, env, undeclared file, nondeterminism). Detect with repeated executions, cross-machine output diffs, and `aquery`; fix by declaring the input or forcing determinism. "Passes locally, fails on RBE" is almost always a leak the local environment was filling in.
- Bazel trades **convenience for correctness** at every turn; senior judgment is keeping the sandbox on, the leaks closed, and the deliberate `local`/`no-cache` holes small.

The professional level turns this into decisions: whether to adopt at all, how to survive a multi-quarter migration, how to run/buy RBE, how to measure cache hit rate, and the war stories that teach why hermeticity is non-negotiable.

---

## Further Reading

- [Remote Execution API (REAPI)](https://github.com/bazelbuild/remote-apis) — the protocol both caching and execution speak; reading the proto clarifies the whole model.
- [Bazel — *Toolchains*](https://bazel.build/extending/toolchains) and [*Platforms*](https://bazel.build/extending/platforms) — the resolution algorithm, in depth.
- [Bazel — *Rules*](https://bazel.build/extending/rules) / [*Aspects*](https://bazel.build/extending/aspects) — the extension API with worked examples.
- [Buck2 documentation](https://buck2.build/) and [Pants documentation](https://www.pantsbuild.org/) — read each project's own "why we differ from Bazel" framing.
- [professional.md](professional.md) — adoption decisions, migration cost, running RBE, and war stories.

---

## Related Topics

- [07 — Build Caching](../07-build-caching/senior.md) — content-addressing and remote cache correctness in depth.
- [08 — Cross-Compilation](../08-cross-compilation/senior.md) — the general cross-compile problem Bazel platforms solve cleanly.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — the determinism fixes that close hermeticity leaks.
- [06 — Dependency Management](../06-dependency-management/senior.md) — pinning, locking, and the third-party model.
- [02 — Dependency Graphs](../02-dependency-graphs/senior.md) — critical path, blast radius, and graph restructuring.
- [professional.md](professional.md) — the org-level adoption and operations decisions.
