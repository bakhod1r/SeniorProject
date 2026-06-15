# Polyglot / Hermetic Builds — Professional Level

> **Roadmap:** [Build Systems](../README.md) → Polyglot / Hermetic Builds
> *The hardest question about Bazel is not how it works — it is whether you should adopt it, how to survive the migration if you do, and how to keep a thousand engineers' BUILD files honest afterward. This page is about the decision and the operation, not the syntax.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Adoption Decision — When It Pays Off, When It's Overkill](#the-adoption-decision--when-it-pays-off-when-its-overkill)
3. [Migration Strategy and Its Multi-Quarter Cost](#migration-strategy-and-its-multi-quarter-cost)
4. [Running RBE — Self-Hosted vs SaaS](#running-rbe--self-hosted-vs-saas)
5. [Measuring What Matters — Cache Hit Rate and Beyond](#measuring-what-matters--cache-hit-rate-and-beyond)
6. [Org-Wide BUILD Hygiene and Gazelle](#org-wide-build-hygiene-and-gazelle)
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

> Focus: **Should we adopt a hermetic build at all, and if so, how do we run it without it running us?**

Every previous level taught capability. This one teaches *judgment under cost*. Bazel and its kin deliver real, measurable wins — but they are infrastructure investments with a steep, sustained price, and the graveyard of half-migrated monorepos is large. The professional questions are: does our scale justify the spend; how do we migrate without freezing feature work for a year; do we build or buy the RBE cluster; how do we know it is actually paying off; and how do we keep the BUILD files from rotting once everyone is forced to write them.

The throughline: a hermetic build is not a tool you install, it is an *organizational commitment* with a dedicated owner, a budget, and a multi-quarter horizon. Treat it as a weekend tooling upgrade and it will fail expensively.

---

## The Adoption Decision — When It Pays Off, When It's Overkill

The wins of hermetic builds are real but *conditional*. They compound with scale and evaporate without it. Run the decision against four axes:

| Axis | Favors hermetic (Bazel) | Favors per-language tools |
|---|---|---|
| **Repo shape** | One large monorepo | Many small, independent repos |
| **Languages** | Polyglot, cross-language deps (proto, gRPC) | Single language |
| **Scale** | Hundreds+ of engineers, millions of LOC | Small team, modest codebase |
| **CI cost** | CI time/$ is a top pain; high rebuild waste | CI is fast and cheap already |

The mechanism behind the table: every benefit (shared cache hits, exact incrementality, safe parallelism, cross-language graph) scales with **how much work is shared and avoided**. A 50-engineer monorepo where everyone rebuilds overlapping code in CI all day reaps enormous cache reuse. A 4-person single-Go-service repo reuses almost nothing it would not already get from `go build`'s own cache — so it pays the BUILD-file tax for no return.

The decisive, often-overlooked factor is **cross-language dependencies**. If your Go, Java, and TS genuinely depend on shared `.proto` and must rebuild in lockstep, no per-language tool models that graph, and the glue scripts are a permanent tax — Bazel's value is highest. If your languages are *independent* services that never share build inputs, the polyglot argument largely collapses, and you can keep per-language tools per service.

> **The honest default for most teams:** *do not adopt Bazel.* The number of organizations that genuinely benefit is small, the number that adopt it cargo-culting Google is large, and the latter mostly suffer. Adopt when you can articulate a specific, measured pain (CI is N hours, cross-language glue breaks weekly, "works on my machine" is a recurring fire) that hermeticity *specifically* solves — not because it is what serious companies use.

---

## Migration Strategy and Its Multi-Quarter Cost

Assume the decision is yes. A migration of a live, large repo is a multi-quarter program, and the only strategy that survives contact with reality is **incremental coexistence**, never big-bang.

The phased shape that works:

1. **Foothold (weeks).** Stand up `MODULE.bazel`, pick *one* leaf service, get `bazel build //that/service` green. Prove the model end to end, including its third-party deps.
2. **Coexistence (months).** Bazel and the old tool build side by side. The old build stays authoritative; Bazel builds an expanding subset. CI runs *both* and compares — Bazel is not trusted until it matches the incumbent on real artifacts.
3. **Generate, don't hand-write.** No human writes thousands of BUILD files. **Gazelle** generates and maintains them from source (below). The migration is largely "make Gazelle understand our layout."
4. **Flip authority (per area).** When Bazel matches the old build for an area and the team is trained, make Bazel authoritative there and delete the old config. Area by area, never all at once.
5. **Turn on the dividends.** Only after the graph is correct do you enable the shared remote cache and (later) RBE — the payoff phase, deliberately last.

The costs nobody budgets for:

- **The third-party long tail.** Each external dependency must be pinned and given BUILD targets; the awkward 5% (transitive C deps, code generators, packages with no Bazel support) consumes disproportionate time.
- **Developer ramp.** Every engineer must relearn how to build, test, and add a dependency. Expect a productivity dip for a quarter and invest heavily in internal docs and a support channel.
- **A dedicated team.** A real adoption needs an owner — typically a small build/DevEx team — for the duration *and afterward*. Bazel is not "set up once."
- **Sunk-cost risk.** Stalled-at-50% migrations are the worst outcome: you pay both tools' costs and reap neither's full benefit. Set explicit kill criteria before you start.

> **Key insight:** the migration cost is dominated by *people and the third-party tail*, not by Bazel itself. The tool works; getting a thousand engineers and ten thousand dependencies into its model is the multi-quarter expense. Plan for the org, not the technology.

---

## Running RBE — Self-Hosted vs SaaS

Remote caching and remote execution need a backend. The build-vs-buy decision mirrors every infra build-vs-buy, with build-system-specific wrinkles.

**SaaS (BuildBuddy, EngFlow).** Point `--remote_cache`/`--remote_executor` at a vendor endpoint. You get a remote cache, an execution cluster, and a build results UI (timing, cache stats, flaky-test detection) without operating anything. Fastest path to value; ongoing per-build or per-seat cost; your build inputs/outputs transit a third party (a security/compliance review for proprietary code).

**Self-hosted (BuildBarn, Buildfarm).** You run the REAPI server, the content-addressed storage (often backed by object storage), and a worker fleet on your own Kubernetes. Full control, no per-build vendor fee, data stays in-house — but you now operate a *distributed storage and scheduling system* with real on-call burden: CAS capacity and eviction, worker autoscaling, network bandwidth to ship action inputs, and cache GC.

The pragmatic path most teams take: **start with a remote *cache* only** — it is the bulk of the win, far simpler to run (it is essentially a content-addressed blob store), and a reasonable first self-hosted component. Add remote *execution* only when local/CI compute is the proven bottleneck, and strongly consider SaaS for execution first to learn the operational shape before committing to running a worker fleet.

Operational realities regardless of choice:
- **Cache eviction policy is load-bearing.** Too-aggressive eviction tanks the hit rate; unbounded growth blows your storage budget. Tune against measured hit rate.
- **Bandwidth, not CPU, is often the RBE bottleneck.** Shipping large action inputs to workers can saturate the network; deduplication against the CAS and locality matter.
- **Security of the cache is security of your artifacts.** A poisoned or compromised cache serves malicious outputs to everyone. Authenticate writers; some shops make CI the only writer and developers read-only.

---

## Measuring What Matters — Cache Hit Rate and Beyond

You cannot manage what you do not measure, and the headline number is **cache hit rate**: the fraction of executed actions served from cache rather than run.

```bash
# Per-build summary, including cache stats
bazel build //... --remote_cache=... --build_event_json_file=bep.json
# parse bep.json for: actions total, cache hits, remote hits, local executions

# Profiling: where did the time actually go?
bazel build //... --profile=/tmp/prof.gz
bazel analyze-profile /tmp/prof.gz       # critical path, action timing breakdown
```

What "good" looks like and how to read it:

- **Cache hit rate.** On a mature setup, incremental and CI builds should hit *high* (often 90%+ on PRs that touch a thin slice). A *falling* hit rate is an alarm: usually a hermeticity leak (action keys vary run-to-run), an over-broad dependency (a widely-depended-on target changing constantly), or eviction too aggressive.
- **Critical path time.** The longest dependency chain — the floor RBE cannot beat by adding workers. If wall-clock is bad but parallelism is high, the critical path is your problem; fix it by splitting fat targets, not buying machines.
- **A near-zero hit rate is a *correctness* smell, not just a perf one.** If "nothing ever hits," some input is varying that should not — a timestamp, a path, an env var in the key. Chase it as a leak (see [senior.md](senior.md)).
- **Remote vs local execution mix** and **bytes transferred** tell you whether RBE is helping or whether you are network-bound.

> **Key insight:** cache hit rate is the single most diagnostic metric a hermetic build emits. High and stable means the system is healthy and honest. Falling or low almost always means a *hermeticity* problem, not a *caching* problem — the cache is faithfully reporting that your "same" inputs are not actually the same.

---

## Org-Wide BUILD Hygiene and Gazelle

At a thousand engineers, hand-maintained BUILD files are unmanageable and inconsistent. The answer is **generation plus enforcement**.

**Gazelle** generates and updates BUILD files from source by parsing imports — originally for Go, now extended (via plugins) to Python, JS/TS, protobuf, and more.

```bash
# Generate/refresh BUILD files for the whole repo from the actual imports
bazel run //:gazelle

# Add/repin a Go dependency and wire it into BUILD files
bazel run //:gazelle -- update-repos github.com/redis/go-redis/v9
```

Gazelle turns "every engineer writes BUILD files by hand" into "imports are the source of truth; BUILD files are generated" — which is the single biggest lever for surviving the BUILD-file tax (and is essentially what Pants does natively via inference).

The enforcement layer that keeps it honest:

- **`gazelle` in CI as a check, not just a command.** A presubmit runs Gazelle and fails if it would change anything — so BUILD files can never drift from imports.
- **`buildifier`** formats and lints BUILD/`.bzl` files; run it as a presubmit so style never becomes a review topic.
- **`buildozer`** scripts bulk edits ("add this dep to every target matching X") across thousands of files — essential for org-wide refactors and strict-deps cleanups.
- **Strict dependency checking** (`--strict_deps`, layering checks) catches reliance on transitive deps; combined with Gazelle regeneration it keeps the declared graph equal to the *real* graph.
- **Visibility as policy.** `visibility = [...]` is how a platform team prevents arbitrary cross-team coupling — a target is only depended-on by who you allow, turning architectural boundaries into build-enforced rules.

> **Key insight:** the way you make BUILD files sustainable at scale is to stop treating them as source you write and start treating them as *generated artifacts* (Gazelle) guarded by *presubmit enforcement* (buildifier, gazelle-check, strict-deps). Organizations that make engineers hand-author and hand-maintain BUILD files at scale are the ones where Bazel becomes hated.

---

## War Stories

**The non-hermetic test that only passed locally.** A team's integration test read a fixture from an absolute path that existed on every developer laptop (a shared NFS mount) but not on the RBE workers. For a year it was green on laptops and "flaky" in CI. The truth: it was *never* hermetic; the laptop environment silently supplied the fixture. The fix was to declare the fixture as a `data` dependency so the sandbox provided it everywhere — after which it passed *identically* on every machine. The lesson teams relearn constantly: **"passes locally, fails on RBE" is not RBE being flaky; it is the local environment having been quietly dishonest.**

**The cache poisoning incident.** A custom code-gen rule embedded the build timestamp in its output and used `use_default_shell_env = True`. Two consequences: every build got a *different* action output (so the cache key was unstable — terrible hit rate), and because the rule also picked up the host `PATH`, a developer with a different tool version on PATH produced a *subtly different* artifact, uploaded it to the shared cache, and that wrong artifact was then served to everyone whose action key happened to collide. Production shipped a binary built with the wrong code generator. The remediation: strip the timestamp (`SOURCE_DATE_EPOCH`), remove the env leak, make CI the only cache *writer*, and add a repeated-execution determinism check to presubmit. (See [09 — Reproducible Builds](../09-reproducible-builds/senior.md).)

**The stalled migration.** A company started a Bazel migration, got the easy services across, hit the third-party C-dependency tail, lost the dedicated build engineer to a reorg, and froze at ~40%. For eighteen months they paid *both* build systems' costs — two CI configs, two ways to add a dependency, constant confusion — and reaped neither's full benefit. The lesson: **a migration without a committed owner and explicit completion (or kill) criteria is the most expensive outcome of all.**

---

## Mental Models

- **Bazel is an organizational commitment, not a tool install.** It comes with a team, a budget, and a multi-quarter horizon. Price it like hiring, not like `brew install`.

- **The benefit is "work avoided"; it scales with sharing.** Every win is proportional to how much redundant work the cache lets you skip. Big shared monorepo → huge avoidance. Small independent repo → almost none. The ROI is a function of scale, full stop.

- **Cache hit rate is the build's vital sign.** Stable and high = healthy and hermetic. Falling = a leak or an over-broad dep is making "the same" inputs differ. Read it like a heartbeat monitor.

- **BUILD files should be generated and guarded, never hand-curated at scale.** Gazelle generates, presubmit enforces. The moment humans are the source of truth for ten thousand BUILD files, the system rots.

- **Coexist, then flip; never big-bang.** The old build stays authoritative until Bazel demonstrably matches it. Migration is a series of small, reversible authority flips, area by area.

---

## Common Mistakes

1. **Adopting Bazel because Google/Meta use it.** Their scale justifies it; yours may not. Cargo-cult adoption is the most common and most expensive build mistake. Demand a specific measured pain it solves.

2. **Big-bang migration.** Trying to flip the whole repo at once. It always overruns, blocks feature work, and demoralizes. Coexist and flip incrementally, with the old build as the safety net.

3. **No dedicated owner.** Treating the migration and ongoing operation as a side project. Without a committed team, it stalls at partial completion — the worst state.

4. **Turning on the cache before the build is hermetic.** A shared cache over a leaky build *distributes wrong artifacts*. Earn the cache: prove determinism (repeated-execution checks) first, then enable sharing, with CI as the only writer initially.

5. **Ignoring a falling cache hit rate.** It is the early warning of a hermeticity leak or a hot, over-broad target. Teams that treat it as "just slower today" miss the correctness bug it is reporting.

6. **Letting developers hand-maintain BUILD files at scale.** Without Gazelle + buildifier + presubmit enforcement, BUILD files drift from reality, reviews bog down in formatting, and the tool becomes hated.

7. **Building an RBE worker fleet before needing it.** Operating BuildBarn/Buildfarm is real distributed-systems work. Start with a remote *cache* (mostly the win, far simpler); add execution — ideally via SaaS first — only when compute is the proven bottleneck.

---

## Test Yourself

1. Give the four axes of the adopt-or-not decision, and name the single factor that most strongly favors a hermetic build.
2. Why is big-bang migration almost always wrong, and what is the coexistence strategy that replaces it?
3. You see cache hit rate steadily falling over a month. What does that most likely indicate, and is it primarily a performance or a correctness problem?
4. When would you self-host RBE (BuildBarn/Buildfarm) vs use SaaS (BuildBuddy/EngFlow)? Which component do you stand up first regardless?
5. How do you keep ten thousand BUILD files honest across a thousand engineers?
6. A test passes on every laptop but fails on RBE. What is the most likely root cause, and why is "RBE is flaky" the wrong conclusion?

<details>
<summary>Answers</summary>

1. Repo shape (monorepo vs many repos), languages (polyglot vs single), scale (hundreds of engineers vs small team), CI cost (a top pain vs already cheap). The strongest single factor is genuine **cross-language dependencies** (shared proto/gRPC that must rebuild in lockstep) — no per-language tool models that graph.
2. Big-bang freezes feature work, always overruns, and has no safety net if Bazel does not yet match the old build. Replace it with **incremental coexistence**: stand up one service, run both builds side by side with the old one authoritative and CI comparing artifacts, generate BUILD files with Gazelle, then flip authority area by area, enabling cache/RBE only after the graph is correct.
3. Most likely a **hermeticity leak** (action keys varying run-to-run) or an over-broad, frequently-changing dependency. It is *primarily a correctness problem* — the cache is faithfully reporting that your "same" inputs are not actually identical; the slowdown is a symptom.
4. Self-host when you need data to stay in-house, want no per-build vendor fee, and can staff the distributed-systems operations (CAS, workers, eviction). Use SaaS for speed-to-value and to avoid operating a fleet. Regardless, stand up the remote **cache** first — it is most of the win and far simpler than execution.
5. Generate BUILD files from imports with **Gazelle** (treat them as artifacts, not hand-written source), and enforce with presubmits: a `gazelle` check that fails on drift, `buildifier` for formatting/lint, `--strict_deps`/layering checks so declared deps equal real deps, `buildozer` for bulk edits, and `visibility` for architectural boundaries.
6. A **hermeticity leak**: the test depends on something the laptop environment silently supplies (an absolute path, a system file, a tool on PATH) that the clean RBE worker lacks. "RBE is flaky" is wrong because RBE is doing exactly its job — enforcing that the test only use declared inputs — and exposing a pre-existing dishonesty the local environment was masking. Fix by declaring the dependency (e.g., as `data`).

</details>

---

## Cheat Sheet

```
ADOPT?  (all four lean "yes" → strong case; mixed → probably no)
  monorepo · polyglot w/ cross-lang deps · hundreds of engineers · CI is a top cost
  strongest signal: shared proto/gRPC that must rebuild in lockstep
  default for most teams: DON'T adopt — demand a specific measured pain

MIGRATE (never big-bang)
  1 foothold: MODULE.bazel + one leaf service green
  2 coexist: both builds; OLD is authoritative; CI compares artifacts
  3 generate BUILD files (Gazelle), don't hand-write
  4 flip authority per-area when Bazel matches
  5 enable remote CACHE, then RBE — last
  costs: third-party tail · dev ramp (1 quarter dip) · dedicated owner · kill criteria

RBE BUILD vs BUY
  SaaS  BuildBuddy/EngFlow   fast, UI+stats, vendor fee, data leaves
  self  BuildBarn/Buildfarm  control, no fee, in-house — but you run a distributed system
  start with remote CACHE only (most of the win, simplest); add execution when compute-bound
  CI = only cache WRITER (security); bandwidth often the RBE bottleneck

MEASURE
  cache hit rate   THE vital sign; falling = leak / hot dep (correctness, not just perf)
  critical path    floor RBE can't beat → split fat targets, don't add workers
  --build_event_json_file / --profile + analyze-profile

BUILD HYGIENE AT SCALE
  gazelle    generate BUILD from imports (+ CI check: fail on drift)
  buildifier format/lint (presubmit)   buildozer bulk edits
  --strict_deps  declared == real      visibility = architectural policy

WAR-STORY LESSONS
  "passes locally, fails on RBE" = leak, NOT flaky RBE
  cache poisoning = unstable key (clock) + env leak → CI-only writer + determinism check
  stalled migration = no owner / no kill criteria = pay both, gain neither
```

---

## Summary

- **Adopt only with a measured reason.** The benefits scale with *work avoided*, so they compound in a large polyglot monorepo with cross-language dependencies and expensive CI, and evaporate on small or single-language repos. For most teams the honest default is *don't* — adopt to solve a specific, named pain, not to imitate Google.
- **Migration is multi-quarter and people-bound.** The only strategy that works is incremental coexistence: foothold → run both builds with the old one authoritative → generate BUILD files with Gazelle → flip authority area by area → enable cache then RBE last. The cost is dominated by the third-party dependency tail and developer ramp, and needs a committed owner with explicit kill criteria.
- **RBE: cache first, execution later; SaaS to learn, self-host to control.** Start with a remote *cache* (most of the win, simplest to run), add remote *execution* when compute is the proven bottleneck. SaaS (BuildBuddy/EngFlow) is fastest; self-hosting (BuildBarn/Buildfarm) is running a distributed system. Make CI the only cache writer.
- **Cache hit rate is the build's vital sign.** High and stable = healthy and hermetic; falling = a hermeticity leak or hot over-broad dependency — a *correctness* signal, not merely a speed one. Watch critical path separately; only graph restructuring beats it.
- **BUILD hygiene at scale = generate + enforce.** Gazelle generates BUILD files from imports; buildifier, a gazelle presubmit check, strict-deps, buildozer, and visibility keep the declared graph equal to the real graph. Hand-maintained BUILD files at scale are why Bazel becomes hated.
- **The war stories rhyme:** "passes locally, fails on RBE" is a hermeticity leak the local environment masked; cache poisoning comes from unstable keys plus env leaks; and a stalled migration — paying two build systems forever — is the most expensive outcome of all.

---

## Further Reading

- *Software Engineering at Google*, Chapter 18 — the canonical organizational case for hermetic builds, written by the people who paid the bill. Free online.
- [BuildBuddy](https://www.buildbuddy.io/docs/) and [EngFlow](https://www.engflow.com/) docs — SaaS RBE, build results UIs, and the metrics they surface.
- [Buildfarm](https://bazelbuild.github.io/bazel-buildfarm/) / [BuildBarn](https://github.com/buildbarn) — self-hosted RBE; read the ops guides before committing to a fleet.
- [Gazelle](https://github.com/bazelbuild/bazel-gazelle), [buildtools (buildifier/buildozer)](https://github.com/bazelbuild/buildtools) — the BUILD-hygiene toolchain.
- [Bazel — *Build Event Protocol*](https://bazel.build/remote/bep) — the data stream behind cache-hit and timing dashboards.

---

## Related Topics

- [07 — Build Caching](../07-build-caching/senior.md) — remote cache internals, eviction, and correctness.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — the determinism work that prevents cache poisoning.
- [06 — Dependency Management](../06-dependency-management/senior.md) — the third-party pinning/locking that dominates migration cost.
- [10 — Build Performance](../10-build-performance/senior.md) — critical-path analysis and where wall-clock actually goes.
- [senior.md](senior.md) — the RBE, toolchain, and leak-hunting mechanics this page operationalizes.
- [interview.md](interview.md) — how these decisions get probed in senior/staff interviews.
