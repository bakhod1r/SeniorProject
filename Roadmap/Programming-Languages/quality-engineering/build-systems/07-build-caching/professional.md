# Build Caching — Professional Level

> **Roadmap:** [Build Systems](../README.md) → Build Caching
> *Running a cache for one person is a feature. Running one for a thousand engineers is an operated service with an SLO, a security model, a cost line, and an incident history — where the worst outage isn't downtime, it's serving the wrong artifact and not knowing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Running a Remote Cache at Org Scale](#running-a-remote-cache-at-org-scale)
3. [The Cache as a Cost and Velocity Lever](#the-cache-as-a-cost-and-velocity-lever)
4. [Security of a Shared Cache — Who Can Write?](#security-of-a-shared-cache--who-can-write)
5. [Trust Boundaries and Supply-Chain Risk](#trust-boundaries-and-supply-chain-risk)
6. [Debugging "Why Was This a Cache Miss?"](#debugging-why-was-this-a-cache-miss)
7. [Debugging "Why Did I Get a Stale Artifact?"](#debugging-why-did-i-get-a-stale-artifact)
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

> Focus: **How do you operate a shared build cache for a whole org — its cost, its security, and the two questions you'll be paged about?**

The senior page established what makes a cache *correct*. This page is about what happens when that cache becomes infrastructure: a multi-terabyte, multi-region service that thousands of builds-per-minute depend on, that shows up on the CI invoice, and that — if compromised — can inject a malicious binary into every artifact the company ships.

At this scale the cache stops being a build-tool detail and becomes three things at once: a **performance and cost lever** (often the single biggest one for CI), a **security surface** (a shared write path into everyone's build outputs), and a **support burden** (every engineer who ever sees a slow build or a weird artifact files a ticket against it). You'll either buy this as a SaaS — BuildBuddy, EngFlow, Gradle's Develocity (formerly Gradle Enterprise), Bazel's own remote backends — or run it yourself, and either way you own the two questions that define cache operations: *why was this a miss?* and *why did I get a stale artifact?* The first is about money and velocity; the second is about correctness and, occasionally, security.

---

## Prerequisites

- **Required:** You've read [senior.md](senior.md) — AC/CAS, hermeticity as the correctness proof, poisoned caches, hit rate.
- **Required:** You've operated or closely observed CI at a scale where build time is a real cost or velocity concern.
- **Helpful:** Familiarity with object storage (S3/GCS), gRPC services, and basic threat modeling (trust boundaries, supply-chain).
- **Helpful:** You've debugged at least one "works locally, not in CI" or "stale artifact" incident.

---

## Running a Remote Cache at Org Scale

A remote cache for an org is a stateful service with the usual operational concerns plus a few unique to content-addressing.

**Buy vs build.** Most orgs buy. The SaaS/managed options each bundle the AC+CAS with a results UI and execution:

| Option | What it is | Notable for |
|---|---|---|
| **BuildBuddy** | Remote cache + execution + results UI (Bazel/Buck2) | Open-core; self-host or cloud; strong RBE story |
| **EngFlow** | Remote cache + execution + observability | Performance-focused RBE at very large scale |
| **Develocity (Gradle Enterprise)** | Remote build cache + Build Scans for Gradle/Maven | The standard for the JVM/Gradle world; deep "why was this a miss" analytics |
| **Self-hosted** (`bazel-remote`, NativeLink, a Remote Execution API server) | Run the gRPC services yourself | Full control, full ops burden |

What you operate either way:

- **CAS sizing and tiering.** Back the CAS with object storage for capacity, front it with SSD/NVMe for the hot working set. Digests make tiering trivial — content never changes address, so it migrates between tiers freely.
- **Eviction at scale.** LRU over the working set; monitor the *eviction rate* and *hit rate* together. Rising eviction with falling hit rate = the cache is too small for the active commit set; thrashing is silently re-spending compute.
- **Multi-region.** Latency to the cache gates *every* action. Geo-distributed teams need regional cache replicas or a CDN-like CAS layer, because a cross-continent round-trip per action can make the cache slower than local builds for cheap actions.
- **Advisory, always.** The cache must be removable from the critical path on failure (local fallback, soft errors). A cache outage that *halts* all builds is a worse incident than the latency it ever saved.
- **Observability.** Per-build hit rate, action counts, bytes transferred, cache-server p99 latency, eviction rate. Without these you're flying blind on both cost and the phantom-miss problem.

---

## The Cache as a Cost and Velocity Lever

At org scale the build cache is usually the *highest-leverage* knob on two numbers leadership actually watches: CI spend and engineer wait time.

**CI cost.** Every cache hit is a compute action that *didn't run* on a paid CI runner. On a large monorepo where PR validation rebuilds against `main`, a well-populated cache can take CI compute from "rebuild the world every PR" to "build only what the PR changed." The math is direct: `CI_cost ≈ (actions_executed) × (cost_per_action)`, and the cache attacks `actions_executed` by the hit rate. A jump from 50% to 90% hit rate roughly *fifths* the executed actions on the cached portion — often six- or seven-figure annual swings at large companies.

**Developer velocity.** The clean-checkout and branch-switch experience is governed by the cache. With a remote cache populated by trusted CI, a developer's first build of a fresh branch downloads almost everything and compiles only their diff — minutes instead of an hour. That's the difference between "I can run the full suite locally before pushing" and "I'll let CI tell me," which changes how the whole org works.

The discipline is to *measure the lever*:

```bash
# Gradle/Develocity: Build Scans quantify cache hit rate and the time it saved per build
./gradlew build --scan

# Bazel + a results service: per-invocation hit rate and bytes saved
bazel build //... --bes_backend=... --remote_cache=...
```

> **The leadership translation:** "raise cache hit rate from X to Y" is one of the few engineering-productivity initiatives with a *directly attributable* dollar and wall-clock return. Frame cache work in those terms and it gets funded. But always pair the hit-rate target with a correctness guardrail — "raise hit rate *without* weakening keys" — or you've incentivized the exact change (loosening keys) that causes poisoning.

---

## Security of a Shared Cache — Who Can Write?

A shared cache is a **shared, content-addressed store of build outputs that consumers execute or ship**. That sentence should set off alarms: if an attacker can write a chosen blob under a key a victim will read, they can substitute a malicious artifact into the victim's build. The cache is a supply-chain entry point.

The central control is the **write trust boundary**:

- **Read is broad, write is narrow.** Developers and PR-validation jobs should *read* the cache and almost never *write* it. In Bazel: `--remote_upload_local_results=false` for untrusted contexts; only trusted CI on protected branches uploads.
- **Why untrusted writes are dangerous.** If a PR build can upload results, a malicious (or merely buggy/non-hermetic) PR can compute a key that a *trusted* build will later read and populate it with a bad output. The trusted build does everything right and fetches poison. Worse, if the PR build is non-hermetic, it can produce a *different* output than a trusted build would for the *same* key — a deliberate collision attack.
- **Integrity verification.** The CAS is content-addressed, so a consumer can re-hash a fetched blob and verify it matches the requested digest. This defeats *transport corruption* and *blind tampering*. It does **not** defeat a poisoned *Action Cache* entry that points at a legitimately-hashed-but-wrong blob — which is exactly why the AC write path is the sensitive one.
- **Authn/authz.** Mutual TLS or signed tokens for cache access; separate credentials for read vs write; per-team scoping if the cache is multi-tenant. Treat write credentials like deploy credentials, because functionally they are.
- **Encryption.** TLS in transit; encryption at rest on the CAS backend (build outputs can contain source, secrets baked into artifacts, proprietary code).

---

## Trust Boundaries and Supply-Chain Risk

The deeper framing: a build cache is a node in your software supply chain, and content-addressing gives *integrity* (the bytes match the digest) but not *authenticity* (the digest is the one a correct, trusted build would produce).

Map the trust boundaries explicitly:

```
   UNTRUSTED                         │   TRUSTED
   - developer laptops               │   - CI on protected branches
   - PR / fork builds                │   - release pipeline
   - third-party contributors        │
        │ READ-only                  │        │ READ + WRITE
        └──────────────►  REMOTE CACHE (AC + CAS)  ◄──────────┘
                          writes ONLY from trusted side
```

Risks and mitigations a professional weighs:

- **AC poisoning across the boundary.** Mitigation: only trusted, hermetic builds write the AC; untrusted contexts are read-only. Optionally, sign ActionResults so consumers can verify the *writer* was trusted, not just that the bytes are intact.
- **Toolchain in the key.** If the toolchain is hashed by content (senior page), a swapped/backdoored compiler produces a *different* key — it can't silently masquerade as the trusted toolchain's output. Identity-based keys ("gcc 13.2") lose this protection; content-based keys preserve it.
- **Hermeticity as a security property.** A hermetic, sandboxed build *can't* reach out to fetch a malicious dependency mid-action or read an attacker-controlled ambient file — so it can't be tricked into producing poison even if the environment is hostile. Hermeticity isn't just correctness; it's a supply-chain control.
- **Blast radius.** One poisoned entry on a shared cache propagates to everyone who hits it, and to every downstream action that consumes it. Containment matters: per-environment caches (dev vs release), the ability to *purge a key and its dependents*, and an audit log of who wrote what.

> **Key insight:** Content-addressing answers "are these the bytes that hash to this digest?" — integrity. It does *not* answer "is this the output a *trusted* build would produce?" — authenticity. The write trust boundary and (optionally) signing ActionResults are how you add authenticity. Conflating the two is how a cache becomes a supply-chain hole that every audit will eventually find.

---

## Debugging "Why Was This a Cache Miss?"

This is the velocity-and-cost ticket. The build was slow because actions you expected to hit, missed. The method is always the same: **find the input that differs between the build that populated the cache and the build that missed.**

1. **Confirm it's a phantom miss, not a true miss.** Did the inputs actually change? If you genuinely edited an upstream file, the miss is correct and cascades downstream — not a bug.
2. **Diff the action keys across the two builds.** Every serious system can dump an action's inputs/digest. Capture it from the cache-populating build and the missing build and *diff*:

```bash
# Bazel: dump what fed each action
bazel aquery 'deps(//target)' --output=text          # the action graph + command lines
bazel build //target --execution_log_json_file=a.log  # per-action inputs/digests
# diff a.log vs the populating build's log; the differing input is your culprit

# Develocity/Gradle: Build Scan compares two builds' task inputs directly
./gradlew build --scan      # then use the scan UI's "compare" to find the changed input
```

3. **Classify the differing input.** It will be one of:
   - **A volatile path** — an absolute path, `$PWD`, `$HOME`, or build directory baked into the key (different per machine/checkout). Fix: relativize/strip paths; build in a stable, sandboxed root.
   - **An unpinned toolchain** — the compiler/SDK differs between machines or over time. Fix: pin by content (hermetic toolchain).
   - **A timestamp or other non-determinism** in a *generated input* that feeds the action. Fix: make the generator deterministic ([09 — Reproducible Builds](../09-reproducible-builds/senior.md)).
   - **An environment variable** that's in the key and differs (`LANG`, `TZ`, a CI-injected var). Fix: scrub or pin the relevant env.
4. **Fix the *instability*, not the symptom.** The wrong fix is to drop the differing input from the key (that risks poisoning). The right fix is to make that input *stable* across builds.

> The recurring lesson: a phantom-miss investigation is an input-stability bug hunt, and the answer is almost always "something machine- or time-specific leaked into the key." The tooling exists precisely to *diff the inputs* — use it instead of guessing.

---

## Debugging "Why Did I Get a Stale Artifact?"

This is the correctness ticket, and it is a potential incident. Someone got an output that doesn't match the source — a poisoned or stale cache hit.

1. **Reproduce against the cache.** Build with caching, observe the wrong artifact; then **build with the cache disabled** and observe the correct one:

```bash
bazel build //target --noremote_accept_cached --nocache_test_results   # ignore cache, force local build
go build -a ./...                                                       # Go: force rebuild of everything
ccache -C && make                                                       # clear ccache, rebuild
```

   If "cache off → correct, cache on → wrong," you have confirmed a **stale/poisoned cache hit**. That confirmation alone is the most important step — it tells you the *build* is fine and the *cache* lied.
2. **Find the un-keyed input.** Take the two builds (the one that *wrote* the bad entry and yours) and find an input that affects output but is *not* in the key. It's the same diff as a miss investigation, except now the input *changed the output but did not change the key* — a missing-input bug. The usual suspects: an environment variable, a feature flag, an undeclared file read, or a non-deterministic action that produced different bytes for the same key.
3. **Contain.** Purge the poisoned key (and dependents) from the shared cache so you stop serving it to others. If the artifact reached production, treat it as an artifact-integrity incident.
4. **Fix the root cause: complete the key and/or seal the build.** Add the missing input to the key, *or* (better) make the build hermetic so undeclared inputs are impossible. If it was non-determinism, make the action reproducible. Patching keys is a stopgap; hermeticity is the cure.

> **Key insight:** "Clear the cache and it works" is the *diagnostic signature* of a poisoned cache, and it should escalate the ticket, not close it. The bug isn't the cache — it's an under-specified key or a non-hermetic build that the cache faithfully exposed. Closing it as "cleared the cache, all good" guarantees a recurrence and possibly a shipped wrong binary.

---

## War Stories

**1. The environment variable that wasn't in the key.** A team's home-grown CI cache keyed compilation on source + flags + compiler version — but not on `CGO_ENABLED`. A release build (CGO off, for static linking) ran *after* a CI build (CGO on) had populated the cache for the same sources. The release fetched the CGO-*on* objects, linked a binary that dynamically needed `libc`, and shipped it to a scratch container with no libc. It crashed on startup in production with `no such file or directory` — a binary that "built and tested green." Root cause: an input that changed the output was absent from the key. Fix: include the full relevant environment in the key (which is exactly why Go's *own* cache hashes that environment) and, longer-term, make the build hermetic so the env can't leak un-keyed.

**2. The cache that served a malicious artifact.** An org let PR-validation builds *write* to the shared remote cache to "warm it up." A contributor's PR build (untrusted, non-hermetic, able to run arbitrary build scripts) computed the action key for a widely-used internal library and uploaded a tampered output under it. The next trusted build that needed that library got a cache *hit* and pulled the malicious artifact into the release. The build was green; the artifact was backdoored. Root cause: an untrusted write path into a trusted read path — no write trust boundary. Fix: untrusted contexts read-only (`--remote_upload_local_results=false`), only trusted hermetic CI writes, ActionResults signed and verified, and an audit log on the write path.

**3. The phantom-miss mystery that was an absolute path.** A monorepo's remote cache had a miserable cross-developer hit rate; everyone effectively built from scratch. Diffing two engineers' action keys for identical sources showed the keys differed — because the build embedded the *absolute checkout path* (`/home/alice/...` vs `/home/bob/...`) into a compiler flag (debug info prefix), and that path was in the key. Every engineer's checkout path was unique → every key was unique → near-zero shared hits. Fix: a path-remapping flag (`-ffile-prefix-map`/`-trimpath`) to make paths build-location-independent, which both restored cross-developer hits *and* made the builds more reproducible ([09](../09-reproducible-builds/senior.md)). One change fixed hit rate and reproducibility at once — because they're the same property.

---

## Mental Models

- **The cache is a service with an SLO, not a folder.** It has latency, capacity, availability, a cost line, and a security model. Operate it like the production dependency it is — advisory on the critical path, observable, and capacity-planned to the working set.

- **Hit rate is a dollar figure; correctness is a Sev-1.** Frame cache work to leadership as cost/velocity (it's one of the highest-leverage CI knobs), but never let a hit-rate target license weakening a key. Pair every "raise hit rate" with "without touching key completeness."

- **Read broadly, write narrowly.** The write path is a supply-chain entry point. Trusted, hermetic builds write; everyone else reads. This single boundary prevents the scariest incident class.

- **Integrity ≠ authenticity.** Content-addressing guarantees the bytes match the digest, not that the digest came from a trusted build. Add authenticity with the write boundary and signed results.

- **"Clear the cache and it works" is a diagnosis, not a fix.** It means an un-keyed input or a non-hermetic build. Escalate, find the input, complete the key or seal the build. Never close it on the cache-clear.

---

## Common Mistakes

1. **Letting untrusted contexts write the shared cache.** The single most dangerous misconfiguration — it turns the cache into a supply-chain injection point. Untrusted = read-only.

2. **Making the cache a hard dependency.** A cache outage that *breaks* builds is a worse incident than the latency it saved. Keep it advisory with local fallback.

3. **Chasing hit rate by loosening keys.** It works (more hits!) right up until it serves a poisoned artifact. Raise hit rate by *stabilizing inputs*, never by dropping relevant ones.

4. **Closing stale-artifact tickets with "cleared the cache."** That's the symptom. The root cause is an under-specified key or a non-hermetic build, and it *will* recur — possibly in a shipped binary.

5. **Confusing integrity with authenticity.** Re-hashing a blob proves it wasn't corrupted in transit; it does *not* prove a trusted build produced it. You need the write boundary (and ideally signing) for that.

6. **Not sizing the cache to the working set.** Too small → thrashing eviction silently re-spends compute (and money) while hit rate quietly degrades. Monitor eviction rate alongside hit rate.

---

## Test Yourself

1. Why is "raise cache hit rate" a fundable initiative, and what guardrail must always accompany the target?
2. Explain the write trust boundary and the specific attack it prevents.
3. A blob fetched from the CAS re-hashes to its requested digest. What security property does that give you, and what property does it *not* give you?
4. Walk through your method for debugging "this action was a cache miss and shouldn't have been." What are you ultimately looking for?
5. A teammate reports "I built `foo`, got the wrong binary, cleared the cache, and it was fine." What does this tell you, what's the likely root cause, and why is "cleared the cache" not an acceptable resolution?
6. In the war story where a PR build poisoned a release, name the single configuration change that would have prevented it and why.

<details>
<summary>Answers</summary>

1. Because hit rate maps directly to *CI compute cost* (hits = actions not run on paid runners) and *developer wall-clock* (fresh-checkout/branch-switch builds download instead of compile) — both numbers leadership watches, with attributable dollar/time returns. Guardrail: "*without weakening key completeness*," because the easiest way to raise hit rate (dropping inputs from the key) is exactly what causes poisoned caches.
2. Reads are broad (everyone), writes are narrow (only trusted, hermetic builds on protected branches). It prevents an **untrusted producer** (a PR/fork build) from uploading a chosen output under a key that a **trusted consumer** will later read — i.e., injecting a malicious or wrong artifact into trusted builds via the cache.
3. It gives **integrity**: the bytes weren't corrupted or blindly tampered in transit/storage — they're exactly the content that hashes to the requested digest. It does **not** give **authenticity**: it says nothing about whether a *trusted* build produced that digest. A poisoned Action Cache entry can point at a legitimately-hashed-but-wrong blob, and re-hashing won't catch it; you need the write boundary / signed results.
4. Confirm it's a *phantom* miss (inputs didn't really change), then dump and **diff the action's inputs/key** between the build that populated the cache and the one that missed. Classify the differing input — volatile path, unpinned toolchain, timestamp/non-determinism in a generated input, or a differing keyed env var — and fix the *instability* (stabilize/pin the input), never by dropping it from the key. You're ultimately looking for *what machine- or time-specific thing leaked into the key*.
5. "Clear cache → correct" is the signature of a **stale/poisoned cache hit**: the build is fine, the cache served an output that doesn't match the inputs. Likely root cause: an **under-specified key** (an input that affects output isn't hashed) or a **non-hermetic/non-deterministic build**. "Cleared the cache" is unacceptable because it only hides the missing-input/hermeticity bug, which will recur — and may already have shipped a wrong artifact. You must find the un-keyed input, complete the key or seal the build, and purge the poisoned entry.
6. Make untrusted (PR/fork) builds **read-only** to the shared cache — e.g. `--remote_upload_local_results=false` — so only trusted, hermetic CI can write. The poisoning required an *untrusted write path into a trusted read path*; removing the write path closes it.

</details>

---

## Cheat Sheet

```
OPERATE IT LIKE A SERVICE
  buy: BuildBuddy / EngFlow / Develocity (Gradle) | build: bazel-remote, NativeLink, RE-API server
  CAS: object store (capacity) + SSD hot tier; digests make tiering free
  ADVISORY on critical path (local fallback; outage = slow, not broken)
  observe: hit rate, eviction rate, bytes moved, cache p99 latency
  multi-region: latency gates EVERY action → regional replicas

COST / VELOCITY LEVER
  CI_cost ≈ actions_executed × cost_per_action ; cache attacks actions_executed
  50%→90% hit rate ≈ fifths the executed actions on cached work
  pitch: "raise hit rate" = $ + wall-clock, WITH guardrail "don't weaken keys"

SECURITY — WHO CAN WRITE?
  READ broad, WRITE narrow (trusted hermetic CI only)
  untrusted (PR/fork/laptop): --remote_upload_local_results=false
  integrity (re-hash blob) ≠ authenticity (trusted producer) → add write boundary + signing
  toolchain hashed by CONTENT → backdoored compiler can't masquerade
  TLS in transit + encryption at rest; write creds = deploy creds

DEBUG: WHY A MISS?
  confirm phantom (inputs really unchanged) → diff action keys across builds
  culprit = volatile path | unpinned toolchain | timestamp/non-det input | keyed env var
  FIX the instability (pin/stabilize), NOT by dropping the input

DEBUG: WHY STALE ARTIFACT?
  cache OFF → correct, cache ON → wrong  ⇒ poisoned hit (build fine, cache lied)
  --noremote_accept_cached / go build -a / ccache -C
  find the un-keyed input → complete key OR make hermetic → PURGE poisoned key
  "cleared the cache" = diagnosis, NOT resolution (escalate)
```

---

## Summary

- At org scale a remote cache is an **operated service**: capacity-planned to the working set, multi-region for latency, observable (hit rate, eviction, latency, bytes), and **advisory** so an outage slows but never breaks builds. Buy (BuildBuddy/EngFlow/Develocity) or build (bazel-remote, RE-API servers).
- The cache is the **highest-leverage CI cost and velocity lever** — hits are compute that didn't run and minutes developers didn't wait. Frame it in dollars and wall-clock, but always pair a hit-rate target with the guardrail "without weakening keys."
- A shared cache is a **supply-chain surface**. The central control is the **write trust boundary**: read broad, write narrow (only trusted, hermetic CI). Content-addressing gives **integrity** (bytes match digest) but not **authenticity** (a trusted build produced it) — add the write boundary and signed results for that.
- You own two debugging questions. **"Why a miss?"** is a phantom-miss bug hunt: diff action keys, find the machine/time-specific input that leaked in, *stabilize* it (don't drop it). **"Why a stale artifact?"** is a poisoned-cache incident: confirm via cache-off-vs-on, find the *un-keyed* input, complete the key or seal the build, and purge the entry. "Cleared the cache" is a diagnosis, never a resolution.
- The war stories rhyme: an env var missing from the key, an untrusted write path, an absolute path in the key. All three are the same lesson — **hermeticity and complete content-based keys are simultaneously a correctness, performance, and security property.**

---

## Further Reading

- [BuildBuddy docs](https://www.buildbuddy.io/docs/introduction) and [EngFlow](https://www.engflow.com/) — managed remote cache + execution with results/observability UIs.
- [Gradle Develocity (Build Cache + Build Scans)](https://docs.gradle.com/develocity/) — the JVM-world standard, with deep "why was this a miss" comparison tooling.
- [SLSA — Supply-chain Levels for Software Artifacts](https://slsa.dev/) — the framework for build-artifact integrity/authenticity that the trust-boundary discussion maps onto.
- [Bazel — Remote Caching & sandboxing flags](https://bazel.build/remote/caching) — `--remote_upload_local_results`, `--noremote_accept_cached`, and the soft-error/fallback options referenced here.

---

## Related Topics

- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/senior.md) — hermeticity as correctness *and* a supply-chain control; remote execution sharing the cache's CAS.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — determinism, which fixes both phantom misses and stale-artifact non-determinism.
- [10 — Build Performance](../10-build-performance/senior.md) — caching among the full set of build-speed levers and how to measure them.
- [interview.md](interview.md) — the question bank: cache keys, CAS, correctness/poisoning, hit rate, and the "design a shared cache for 500 engineers" scenario.
