# Build Caching — Senior Level

> **Roadmap:** [Build Systems](../README.md) → Build Caching
> *A cache that's slow wastes minutes. A cache that's wrong corrupts artifacts you can't tell are corrupt. Senior-level caching is the discipline of making the key provably complete — because hermeticity, not cleverness, is what makes reuse safe.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Two-Level Model — Action Cache vs CAS](#the-two-level-model--action-cache-vs-cas)
3. [Cache Key Design Is Correctness Engineering](#cache-key-design-is-correctness-engineering)
4. [Hermeticity Is What Makes Caching Safe](#hermeticity-is-what-makes-caching-safe)
5. [The Poisoned Cache — the Scariest Build Bug](#the-poisoned-cache--the-scariest-build-bug)
6. [Remote Caching Architecture](#remote-caching-architecture)
7. [Eviction, Sizing, and the Economics of a Cache](#eviction-sizing-and-the-economics-of-a-cache)
8. [Measuring and Improving Hit Rate](#measuring-and-improving-hit-rate)
9. [Caching, Reproducibility, and Remote Execution](#caching-reproducibility-and-remote-execution)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What makes a build cache provably correct, not just empirically fast?**

By the middle level you can configure a shared cache and you know the key must include every input. The senior question is sharper: *how do you know it does?* A key that's missing an input doesn't fail loudly during testing — it works perfectly until the day someone changes the un-keyed input, and then it serves a wrong artifact to everyone, silently, with a green build.

This is why senior-level caching is not a performance topic dressed up — it's a *correctness* topic. The performance is almost free once the design is right; the design is the hard part. And the design rests on one foundation: **hermeticity**. A build is hermetic when its outputs are a pure function of its declared inputs and nothing else — no clock, no network, no ambient environment, no undeclared file. That property is *exactly* the precondition that makes a cache key complete and cache reuse safe. Caching and hermeticity aren't two topics that happen to be adjacent; caching is the *payoff* of hermeticity, and an un-hermetic build is one you fundamentally cannot cache correctly. ([05 — Polyglot & Hermetic Builds › senior.md](../05-polyglot-hermetic-builds/senior.md) develops hermeticity itself; this page is what it buys you.)

---

## The Two-Level Model — Action Cache vs CAS

Bazel's design is the reference architecture, and understanding its two levels precisely is what separates "I use a cache" from "I can reason about a cache."

**The Content-Addressable Store (CAS).** A flat key-value store: `sha256(bytes) → bytes`. It holds *everything* — source file contents, intermediate objects, final binaries, even the serialized action definitions. There is no concept of "a file named X"; there are only blobs addressed by their digest. Immutable, deduplicated, integrity-checkable by re-hashing.

**The Action Cache (AC).** Maps an **action digest** to an **ActionResult**. The action digest is the hash of a fully-specified action: the command line, the digests of every input file, the input tree structure, the declared output paths, the platform/environment. The ActionResult is *not* the outputs themselves — it's a small record of the *digests* of the outputs (plus exit code, stdout/stderr digests). To materialize the outputs you take those digests and fetch the bytes from the CAS.

```
                 ┌─────────────────────────── ACTION CACHE ───────────────────────────┐
  action digest  │  sha256(cmd + input digests + tree + outputs + platform)            │
       │         │            │                                                         │
       ▼         │            ▼                                                         │
  [ lookup ] ────┼──► ActionResult { stdout: <digest>, outputs: [out.o → <digest>] }    │
                 └──────────────────────────────────│──────────────────────────────────┘
                                                     ▼
                 ┌──────────────────────────────── CAS ───────────────────────────────┐
                 │   <digest> → bytes      (fetch the actual out.o here)               │
                 └─────────────────────────────────────────────────────────────────────┘
```

Why split them? Three reasons that all matter at scale:

- **Deduplication.** Thousands of actions produce the identical `libc.a`; the CAS stores it once. Many ActionResults can reference the same output digest.
- **Cheap negative lookups.** Checking "do I have this action?" is one small AC lookup; you only pay to transfer large outputs on a confirmed hit, and only the outputs you don't already have locally.
- **It's the substrate for remote *execution*.** Once actions and their inputs/outputs are all content-addressed, a remote worker can be handed an action digest, pull inputs from the CAS, run it, and push outputs back. Caching and remote execution share the *exact same* CAS and action-digest scheme — which is why they're specified together in the [Remote Execution API](https://github.com/bazelbuild/remote-apis).

---

## Cache Key Design Is Correctness Engineering

The cache key (action digest) is a *claim*: "any build whose inputs hash to this digest produces these outputs." That claim is only true if the digest captures every input. So key design is the engineering of making that claim sound.

The discipline has a precise shape:

1. **Enumerate every input that can influence the output.** Not just files — the command line, the toolchain binaries (hashed, not version-string-trusted, because two `gcc 13.2` builds can differ), the declared environment, the execution platform.
2. **Hash content, never identity.** Hash the *bytes* of the compiler, not the string `"gcc-13.2"`; hash the *contents* of inputs, not their paths or mtimes. Identity-based keys (a version string, a path) are how subtle miscompiles slip through — two binaries with the same version string but different patch levels collide.
3. **Exclude nothing that affects output; include nothing that doesn't.** Including irrelevant inputs (an unrelated file, a wall-clock timestamp) *destroys hit rate* — every build gets a unique key. So the key must be exactly the set of *relevant* inputs: a tight, complete superset of "what affects output."

The two failure directions, stated as a senior would:

| Failure | Cause | Symptom | Severity |
|---|---|---|---|
| **Under-specified key** | An input that affects output is *missing* from the key | Distinct builds collide → **wrong output served** | Catastrophic, silent |
| **Over-specified key** | An input that *doesn't* affect output is in the key | Identical builds get distinct keys → **cache never hits** | Performance only, visible |

> **Key insight:** Over-specification is a *performance bug you can measure* (hit rate craters, you investigate, you fix it). Under-specification is a *correctness bug you cannot measure from the outside* — the cache reports healthy hit rates while serving wrong answers. This asymmetry is why mature systems bias toward completeness and treat any "phantom miss" investigation as routine, but any "stale hit" as a Sev-1. Design keys to be *trivially obviously complete*, even at some hit-rate cost.

---

## Hermeticity Is What Makes Caching Safe

Here is the load-bearing idea of the whole topic. A cache key is a *promise* about the inputs. But a promise is only as good as your ability to *enforce* that nothing outside the key influenced the output. That enforcement is **hermeticity**.

An action is hermetic if its output depends *only* on its declared inputs — it reads no undeclared file, no environment variable you didn't list, no network resource, no system clock, no random seed. If a build is hermetic, then the action digest (which hashes the declared inputs) *provably* captures everything that affects output, so cache reuse is *guaranteed correct*. If a build is *not* hermetic, then something outside the key affects the output, the key is *necessarily* under-specified, and the cache *can* serve wrong artifacts — there is no key clever enough to fix it, because the influencing input was never declared.

This is why Bazel **sandboxes** actions: it runs each action in an environment where only the declared inputs are visible (other files literally don't exist in the sandbox), with a scrubbed environment and (optionally) no network. The sandbox doesn't just encourage hermeticity — it *enforces* it, turning "the developer remembered to declare all inputs" into "the action physically cannot read an undeclared input." That enforcement is what upgrades the cache from "fast, probably correct" to "fast, provably correct."

```
NON-HERMETIC build:    output = f(declared inputs, AND clock, AND $HOME, AND /usr/lib/..., AND network)
                       key = hash(declared inputs)   ← misses clock/env/system libs/network
                       → key is under-specified BY CONSTRUCTION → cache CAN be wrong

HERMETIC build:        output = f(declared inputs)   ← and nothing else, enforced by sandbox
                       key = hash(declared inputs)   ← complete by construction
                       → cache reuse is PROVABLY correct
```

> **Key insight:** You don't make a cache correct by perfecting the key. You make it correct by making the *build* hermetic, so that a key over the declared inputs is *automatically* complete. Effort spent hardening hermeticity buys cache correctness for free; effort spent patching keys on a non-hermetic build is a leak you can never fully plug.

---

## The Poisoned Cache — the Scariest Build Bug

A **poisoned cache** is a cache entry whose stored output does *not* correspond to the inputs its key claims — so a correct build, doing everything right, fetches a wrong artifact. It is the most dangerous class of build bug because every defense you have assumes the cache is honest.

How a cache gets poisoned:

1. **Under-specified key (the common case).** An input that affects output isn't in the key. Build A (input set X) and build B (input set Y) hash to the same key; whichever ran first wins, and the other gets its output. The canonical instance: an environment variable like `CGO_ENABLED`, `RUSTFLAGS`, or a feature flag that changes codegen but isn't keyed. (See the professional page for the war stories.)
2. **Non-determinism in a "hermetic" action.** The build *thinks* it's hermetic, but an action embeds a timestamp, a random map iteration order, or an absolute path. Two runs of the *same* inputs produce *different* outputs; the cache stores one and serves it for the other. Functionally "correct" but it wrecks reproducibility and any digest-based trust ([09 — Reproducible Builds › senior.md](../09-reproducible-builds/senior.md)).
3. **A write you shouldn't trust.** On a shared cache, an untrusted or buggy producer uploads a bad artifact under a key trusted consumers read. Now the poison is *deliberate or accidental supply-chain*, covered in the professional tier's security section.

Why it's terrifying operationally:

- **No error.** The build is green. Tests may pass (they were also built from the cache). The bad artifact reaches production.
- **It propagates.** On a shared cache, one poisoned entry is served to everyone, and downstream actions that consume it get *their* keys computed over the poisoned input, poisoning further entries.
- **It's hard to even reproduce.** "Clear your cache and it works" is the tell — but by then you've shipped.

The defenses are layered: hermeticity + sandboxing to prevent under-specification; reproducible (deterministic) builds so the same key always yields the same bytes; integrity verification on the CAS; and strict write trust boundaries on shared caches. None alone is sufficient; together they make poisoning rare and detectable.

---

## Remote Caching Architecture

A production remote cache is the AC + CAS served over a network, with the layering and properties that make it fast and safe.

```
   developer / CI ──┬── LOCAL disk cache (--disk_cache)        ← microseconds, private
                    │        miss?
                    └── REMOTE cache (gRPC / HTTP)              ← milliseconds, shared
                              ├── Action Cache  (AC)
                              └── CAS (often backed by object storage / blob store)
```

Design points a senior weighs:

- **Protocol.** The de-facto standard is the gRPC **Remote Execution API** (`ContentAddressableStorage`, `ActionCache`, `Execution` services), implemented by Bazel, Buck2, Pants, and reused by remote-execution backends. HTTP caches (Gradle's, Bazel's `--remote_cache=http://`) are simpler but coarser.
- **CAS backend.** Small/fast deployments use a dedicated service with local SSD; large ones back the CAS with object storage (S3/GCS) for capacity and a hot tier for latency. Digests make this safe — content can move tiers freely because its address never changes.
- **Read vs write split.** Almost always: many readers, *few trusted writers*. `--remote_upload_local_results=false` lets developers *read* the cache without polluting it; only trusted CI uploads.
- **Cache vs execution colocation.** Because remote *execution* uses the same CAS, colocating the cache with the executors avoids re-uploading inputs the workers already have — caching and execution are one system, not two ([05 — Polyglot & Hermetic Builds › senior.md](../05-polyglot-hermetic-builds/senior.md) and the topic-05 remote-execution material).
- **Failure modes are non-fatal.** A remote cache must be *advisory*: if it's down, slow, or returns a miss, the build still works (just slower). A cache that can *break* the build when unavailable is a worse availability liability than the time it saves. Bazel treats remote-cache errors as soft by default (`--remote_local_fallback`).

---

## Eviction, Sizing, and the Economics of a Cache

A cache is finite; a monorepo's action space is effectively infinite (every commit creates new keys). So a cache is fundamentally a *bet*: store the things most likely to be asked for again.

- **Eviction policy.** **LRU** (least-recently-used) is the default and the right default — recently-used artifacts are the ones active branches depend on. Size-aware variants evict large rarely-used blobs first. Because entries are immutable and content-addressed, eviction is *safe*: evicting a blob just turns a future hit into a miss (a rebuild), never a wrong answer.
- **Sizing.** Size the cache to hold the *working set*: the artifacts produced by the commits people actively build against (roughly `main` plus open branches over the retention window). Too small → thrashing (you evict things you'll need next hour, hit rate tanks). Too large → you pay for storage holding artifacts from commits no one will ever build again. Measure the working set; don't guess.
- **TTLs and reference integrity.** A subtle CAS hazard: the AC references output blobs *by digest*. If eviction removes a blob still referenced by a live ActionResult, the AC hit becomes a *dangling reference* — a confirmed action hit that then can't fetch its output. Good caches either pin CAS blobs referenced by recent AC entries, or treat a dangling fetch as a miss and rebuild. Knowing this exists is what stops "cache hit but no artifact" from being a mystery.

The economics: a cache trades **storage cost** for **compute cost + developer wall-clock**. The right size is where the marginal storage dollar saves more than a dollar of CI compute and engineer waiting. At org scale this is a real budget line, and the lever is hit rate.

---

## Measuring and Improving Hit Rate

**Hit rate is the single metric of a cache's health.** It's the fraction of executed actions served from cache rather than run. Everything else — build time, CI cost, developer velocity — moves with it.

Measure it honestly:

```bash
# Bazel: per-invocation summary
bazel build //... --execution_log_json_file=exec.log
# inspect: how many actions were "remote cache hit" vs "executed"
# or use the Build Event Protocol / a results UI (BuildBuddy, EngFlow)

ccache -s       # cache hit rate (direct + preprocessed), misses, size
sccache --show-stats
```

Distinguish the cases — they have different fixes:

- **Cold miss (first build of a key).** Unavoidable; someone must build a thing once. Lower it by having *trusted CI populate the cache* so humans rarely hit a true cold key.
- **Phantom miss (should have hit, didn't).** The dangerous-for-velocity case: an over-specified or *unstable* key. Causes: a non-deterministic input sneaking into the key (a timestamp, an absolute path, a `$PWD`-dependent flag), a toolchain that isn't pinned, or a volatile generated file in the input set. Each phantom miss is an investigation: dump the action's inputs across two builds and *diff the keys* to find what changed that shouldn't have.
- **True miss (inputs genuinely changed).** Working as intended.

Levers to raise hit rate, in rough order of impact:

1. **Make builds deterministic** so identical inputs yield identical keys *and* identical outputs (kills phantom misses and enables dedup). This is the [09 — Reproducible Builds](../09-reproducible-builds/senior.md) link in action.
2. **Tighten keys** to exclude irrelevant inputs (strip volatile paths/timestamps, pin toolchains by content).
3. **Improve graph granularity** — finer-grained actions/targets mean a small change invalidates fewer keys ([02 — Dependency Graphs](../02-dependency-graphs/middle.md)).
4. **Populate from trusted CI** so the human-facing hit rate is high from the first checkout.

> **Key insight:** A *high* hit rate that's also *correct* is the goal — and the two can conflict. Loosening a key (dropping an input) raises hit rate while risking poisoning; that's the wrong trade every time. Raise hit rate by *removing non-determinism and irrelevant inputs*, never by removing *relevant* ones. "We improved hit rate" must always be qualified with "without weakening correctness."

---

## Caching, Reproducibility, and Remote Execution

These three are one system viewed from three angles:

- **Reproducible builds** ([09](../09-reproducible-builds/senior.md)) make an action's output a deterministic function of its inputs. This is what lets the cache key — a hash of inputs — *predict* the output. Without determinism, the same key can correspond to different bytes (timestamps, ordering), so caching becomes "probably the same" instead of "provably the same," and cross-machine dedup and trust collapse.
- **Hermeticity** ([05](../05-polyglot-hermetic-builds/senior.md)) makes the *declared* inputs the *only* inputs, so the key is complete. Reproducibility + hermeticity together are the necessary and sufficient conditions for a provably-correct cache.
- **Remote execution** ([05](../05-polyglot-hermetic-builds/senior.md) and topic-05 material) reuses the *exact same* AC + CAS + action-digest scheme to run actions on a farm. A remote build is really "look up the action in the cache; on a miss, dispatch it to a worker instead of running it locally; store the result." Caching is the read path; remote execution is the miss path. They are inseparable by design — which is why the Remote Execution API specifies both.

> **Key insight:** "Build cache," "reproducible build," and "remote execution" are not three features to adopt separately. They are three consequences of one decision: *model the build as a graph of hermetic, deterministic, content-addressed actions.* Make that decision and you get all three; skip it and you can bolt on a cache that's fast and occasionally, silently, wrong.

---

## Mental Models

- **The action digest is a falsifiable claim.** It asserts "these inputs → these outputs." Hermeticity makes the claim true; sandboxing enforces it; reproducibility makes it stable; integrity checks let you verify it. A cache is only as trustworthy as that claim.

- **Hermeticity is the cache's correctness proof, not a nice-to-have.** A non-hermetic build cannot have a complete key, so its cache *can* be wrong — full stop. Don't debug keys on a leaky build; seal the build.

- **Under-spec is silent, over-spec is loud.** Bias every key-design decision toward completeness. You'll find and fix over-specification from the hit-rate graph; you'll find under-specification from a production incident.

- **Eviction is safe; the references aren't.** Dropping a content-addressed blob only costs a rebuild. But an AC entry pointing at an evicted CAS blob is a dangling reference — "hit, but no artifact." Pin or fall back.

- **One system, three views.** Cache (reuse), remote execution (offload the miss), reproducibility (make the key predictive) all ride the same content-addressed action model. Adopt the model, get the trio.

---

## Common Mistakes

1. **Treating the cache key as a performance knob.** It's a correctness contract. "Loosen the key to get more hits" trades a measurable speedup for an unmeasurable chance of serving wrong artifacts.

2. **Caching a non-hermetic build and trusting the result.** If the action reads anything undeclared (env, clock, system lib, network), the key is under-specified by construction and the cache *can* poison. Seal the build (sandbox, scrub env, pin toolchain) before trusting the cache.

3. **Keying on identity instead of content.** A toolchain *version string* isn't the toolchain. Two `1.78.0` builds can differ; hash the bytes. Identity keys are how miscompiles sneak past.

4. **Making the remote cache a hard dependency.** If a cache outage *breaks* builds rather than just slowing them, the cache is a liability. Keep it advisory with local fallback.

5. **Ignoring CAS↔AC reference integrity under eviction.** Evicting a referenced blob yields "cache hit, missing output." Pin referenced blobs or treat dangling fetches as misses.

6. **Reporting hit rate without distinguishing miss types.** Cold, phantom, and true misses have different fixes. A flat "70% hit rate" hides whether you have a non-determinism problem (phantom misses) you could fix.

---

## Test Yourself

1. Describe the action-cache/CAS split precisely, and explain why deduplication and remote execution both fall out of it.
2. Why is hermeticity — not key cleverness — the thing that makes a cache *correct*? Give the one-line argument.
3. Define a poisoned cache and give the most common mechanism that produces one.
4. Why is an over-specified key a performance bug but an under-specified key a correctness bug? Why does that asymmetry dictate how you design keys?
5. You see a steady stream of "phantom misses" — actions that should hit but don't. List three likely causes and how you'd confirm each.
6. Explain how build caching, reproducible builds, and remote execution are "one system, three views."

<details>
<summary>Answers</summary>

1. The **CAS** maps `digest → bytes` for all blobs (inputs, intermediates, outputs); the **Action Cache** maps `action digest → ActionResult`, where the ActionResult holds the *digests* of outputs, not the bytes. **Dedup** falls out because many ActionResults can reference one output digest (stored once). **Remote execution** falls out because once actions and inputs/outputs are all content-addressed, a worker can be handed an action digest, pull inputs from the CAS, run it, and push outputs back — the same scheme caching uses, which is why both are in one API.
2. A cache key is a hash of the *declared* inputs; it's only complete if nothing *undeclared* affects the output. Hermeticity *is* the property "only declared inputs affect output," so it's the precondition that makes the key complete and reuse correct. One line: *a non-hermetic build has, by construction, an input outside its key, so its cache can be wrong — no key can fix that.*
3. A poisoned cache is an entry whose stored output doesn't match the inputs its key claims, so a correct build fetches a wrong artifact (silently, no error). Most common mechanism: an **under-specified key** — an input that affects output (e.g. `CGO_ENABLED`/`RUSTFLAGS`/a feature flag) isn't hashed, so two different builds collide on one key.
4. **Over-spec**: an irrelevant input is in the key, so identical builds get *different* keys and the cache never hits — slow but always *correct*, and *visible* on the hit-rate graph. **Under-spec**: a relevant input is missing, so different builds *collide* and one gets the other's output — *wrong*, and *invisible* (no error, healthy-looking hit rate). Because under-spec is silent and catastrophic while over-spec is loud and recoverable, you bias every key toward completeness, accepting some hit-rate cost.
5. (a) **Non-deterministic input in the key** — a timestamp, absolute path, or `$PWD`-dependent flag; confirm by diffing the action's key/inputs across two identical builds. (b) **Unpinned toolchain** — the compiler differs run-to-run; confirm by checking the toolchain digest in the key. (c) **Volatile generated file** in the input set; confirm by checking whether a generator emits non-reproducible output. General method: dump and *diff the action inputs/keys* between two builds that should have matched.
6. Reproducible builds make output a *deterministic function of inputs*, so a hash-of-inputs key *predicts* output. Hermeticity makes *declared* inputs the *only* inputs, so the key is *complete*. Remote execution reuses the same action-digest + CAS to run the *miss path* on a farm (cache = read path, execution = miss path). All three ride one content-addressed, hermetic, deterministic action model — adopt the model and you get the trio.

</details>

---

## Cheat Sheet

```
TWO LEVELS
  CAS  : digest → bytes            (all blobs; immutable, dedup, integrity)
  AC   : action digest → ActionResult{ output DIGESTS, exit, stdout digest }
  lookup AC → get output digests → fetch from CAS

KEY DESIGN = CORRECTNESS
  hash CONTENT not IDENTITY (toolchain BYTES, not "v1.78.0")
  include EVERYTHING affecting output; nothing that doesn't
  under-spec → wrong output, SILENT  (Sev-1)   ── bias toward completeness
  over-spec  → no hits, VISIBLE      (perf)

HERMETICITY = SAFETY
  output = f(declared inputs ONLY)  → key is complete BY CONSTRUCTION
  sandbox ENFORCES it (undeclared files invisible, env scrubbed, no net)
  non-hermetic build → key under-specified by construction → CAN poison

POISONED CACHE (correct build, wrong artifact, no error)
  causes: under-spec key | non-determinism | untrusted write
  defenses: hermeticity+sandbox, reproducible builds, CAS integrity, write trust

REMOTE CACHE
  local disk → remote (gRPC Remote Execution API: CAS + AC + Execution)
  many readers, FEW trusted writers (--remote_upload_local_results=false)
  ADVISORY: cache down ≠ build broken (local fallback)

EVICTION / SIZING
  LRU; eviction is SAFE (miss = rebuild, never wrong)
  size to the WORKING SET (main + active branches)
  hazard: AC entry → evicted CAS blob = dangling ref ("hit, no artifact") → pin/fallback

HIT RATE = the metric
  cold miss (first build) | phantom miss (should hit: non-determinism/unpinned) | true miss
  raise it by REMOVING non-determinism + irrelevant inputs, NEVER relevant ones
```

---

## Summary

- A production cache is **two levels**: a **CAS** (`digest → bytes`, immutable/dedup/integrity) and an **Action Cache** (`action digest → output digests`). Deduplication and remote execution both fall out of content-addressing the whole build.
- **Cache key design is correctness engineering.** Hash *content*, not identity; include everything that affects output and nothing that doesn't. The failure modes are asymmetric: over-specification is a *visible performance* bug; under-specification is a *silent correctness* bug. Bias hard toward completeness.
- **Hermeticity is what makes caching safe** — it makes the declared inputs the *only* inputs, so a key over them is complete by construction. Sandboxing *enforces* this. A non-hermetic build cannot have a correct cache, period.
- The **poisoned cache** — a correct build fetching a wrong artifact with no error — is the scariest build bug. Defenses are layered: hermeticity, reproducibility, CAS integrity, and write trust boundaries.
- A **remote cache** is the AC+CAS over gRPC (the Remote Execution API), layered behind a local disk cache, with many readers and few trusted writers, kept **advisory** so an outage slows but never breaks builds.
- **Eviction** (LRU) is safe because misses only cost rebuilds; size to the working set; watch for AC→CAS dangling references. **Hit rate** is the health metric — raise it by removing non-determinism and irrelevant inputs, *never* by dropping relevant ones.
- Caching, **reproducible builds**, and **remote execution** are one system: model the build as hermetic, deterministic, content-addressed actions and you get all three.

---

## Further Reading

- [Bazel — Remote Caching](https://bazel.build/remote/caching) and [Remote Execution Overview](https://bazel.build/remote/rbe) — the reference architecture for AC + CAS.
- [Remote Execution API specification](https://github.com/bazelbuild/remote-apis) — the gRPC protocol shared by caching and execution; read the `ActionCache`/`CAS` service definitions.
- [Build Systems à la Carte](https://www.microsoft.com/en-us/research/publication/build-systems-la-carte/) (Mokhov, Mitchell, Peyton Jones) — a rigorous taxonomy of build systems including content-based "constructive traces" (caching) vs verifying traces.
- [professional.md](professional.md) — running a remote cache at org scale, security/trust boundaries, and debugging "why was this a miss / why did I get a stale artifact?"

---

## Related Topics

- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/senior.md) — hermeticity and remote execution, the foundations that make caching correct and scalable.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — determinism, the property that makes a key *predict* its output.
- [02 — Dependency Graphs](../02-dependency-graphs/middle.md) — the graph whose granularity determines how much a change invalidates.
- [10 — Build Performance](../10-build-performance/senior.md) — caching as one lever among many for fast builds.
