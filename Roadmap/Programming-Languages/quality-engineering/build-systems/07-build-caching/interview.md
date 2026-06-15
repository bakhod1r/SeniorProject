# Build Caching — Interview Preparation

> **Roadmap:** [Build Systems](../README.md) → Build Caching
> *Build-caching questions sort candidates fast: people who can recite "the cache key is a hash of the inputs," and people who can explain why a key missing one input is the scariest bug in the build system. This bank gives you the model answers, what each question is really probing, and the debugging scenarios that separate "I turned on the cache" from "I run a correct shared cache for hundreds of engineers."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [How to Use This Page](#how-to-use-this-page)
3. [Section 1 — Cache Keys and Fingerprints](#section-1--cache-keys-and-fingerprints)
4. [Section 2 — Content-Addressable Storage](#section-2--content-addressable-storage)
5. [Section 3 — Local, Remote, and the Two-Level Model](#section-3--local-remote-and-the-two-level-model)
6. [Section 4 — Correctness, Hermeticity, and Poisoning](#section-4--correctness-hermeticity-and-poisoning)
7. [Section 5 — Hit Rate, the Metric That Matters](#section-5--hit-rate-the-metric-that-matters)
8. [Section 6 — Remote Execution, Eviction, and Sizing](#section-6--remote-execution-eviction-and-sizing)
9. [Section 7 — Security of Shared Caches](#section-7--security-of-shared-caches)
10. [Section 8 — Design and Debugging Scenarios](#section-8--design-and-debugging-scenarios)
11. [Rapid-Fire Round](#rapid-fire-round)
12. [What the Interviewer Is Really Testing](#what-the-interviewer-is-really-testing)
13. [Red Flags That Sink Candidates](#red-flags-that-sink-candidates)
14. [Cheat Sheet](#cheat-sheet)
15. [Related Topics](#related-topics)

---

## Introduction

Build caching is a favorite interview topic for platform, build, and release-engineering roles because the easy version of the answer ("hash the inputs, reuse the output") is recall, and the hard version ("here's how that cache silently ships a wrong binary, and here's the property that prevents it") is *understanding*. A candidate's answer reveals whether they grasp determinism, hermeticity, content-addressing, and trust boundaries — or whether they've only ever set `--remote_cache` and watched the build get faster.

The questions below are grouped by theme, each with a **model answer** (what a strong candidate says), a **"really testing"** note on the subtext, and where useful, **follow-ups** an interviewer drills into. Then a **design-and-debugging** section, because senior interviews ask you to *architect a shared cache* and *debug a stale artifact*, not recite flags. Read the prior tiers first — this page tests recall plus synthesis.

---

## How to Use This Page

- **Cover the model answer**, attempt the question aloud (interviews are verbal), then compare.
- Answer the **"really testing"** subtext, not just the literal question — interviewers grade the depth you reveal.
- For scenarios, **state assumptions, name trade-offs, and decide** — a defended decision beats a hedge.
- The spine of every strong answer here is one sentence: *a cache is only as correct as its key is complete, and a key is only complete if the build is hermetic.* If you can teach that, you're ahead of most candidates.

---

## Section 1 — Cache Keys and Fingerprints

**Q1.1 — What is a cache key, and what must it contain for a compile action?**

*Model answer:* A cache key is a **fingerprint of every input** to a build action — a hash such that identical inputs produce the identical key, and any change to any input produces a completely different key. For "compile `math.c`," the key must hash: the **contents** of `math.c` (its bytes, not its name or timestamp); the contents of every **header** it includes; the **compiler flags** (`-O2` vs `-O0` produce different output); the **compiler binary itself** (different versions emit different code); and the **target platform** (x86 vs arm). The rule is: anything that can change the output must be in the key, and nothing that can't should be.

*Really testing:* whether you know the key is a hash of *inputs* (not the output, not a name someone chose) and can enumerate the non-obvious ones — flags, toolchain, platform — not just "the source file."

*Follow-up:* "What's the most commonly forgotten input?" → Environment variables that reach the compiler (`CGO_ENABLED`, `RUSTFLAGS`, `CFLAGS`) and the toolchain binary's actual bytes. People hash a version *string* instead of the compiler itself, and two `gcc 13.2` builds can differ.

---

**Q1.2 — Why hash the *contents* of inputs rather than their paths, names, or timestamps?**

*Model answer:* Because the path and timestamp aren't what determine the output — the bytes are. Two files with the same path can have different contents (across branches, across machines); two files with different paths can have identical contents. A content hash answers the *honest* question — "are the actual bytes the same?" — which is both more correct than timestamps and *portable*: a content hash is identical on every machine, so the key means the same thing on a developer laptop and a CI runner. That portability is exactly what lets a cache be *shared*. A timestamp means nothing on another machine.

*Really testing:* whether you understand the difference between content-based and identity-based keying, and that *shareability* is a consequence of content-addressing.

---

**Q1.3 — A teammate says "let's drop the compiler version from the key so we get more cache hits after toolchain upgrades." What do you say?**

*Model answer:* No — that's trading a measurable speedup for an unmeasurable chance of serving wrong artifacts. The compiler version (really, the compiler's bytes) belongs in the key *because* a new compiler emits different code. Drop it, and a build with the old compiler and a build with the new compiler collide on the same key; whoever ran first wins, and everyone else gets code compiled by the wrong compiler — with a green build and no error. The right way to get more hits after an upgrade is to *pin and share* the toolchain so everyone genuinely uses the same one, not to pretend they do by dropping the input.

*Really testing:* the core senior reflex — the key is a correctness contract, not a performance knob. A candidate who says "sure, more hits" has failed the most important question on the page.

---

## Section 2 — Content-Addressable Storage

**Q2.1 — What is content-addressable storage (CAS), and why is it the natural substrate for a build cache?**

*Model answer:* A CAS is a key-value store where the key *is the hash of the value*: `sha256(bytes) → bytes`. You don't store "the file at path X"; you store a blob and address it by its own digest. For a build cache this is natural because (a) it gives you **deduplication for free** — the same `libc.a` produced by a thousand actions is stored once, since identical bytes hash to one address; (b) it's **integrity-checkable** — re-hash the bytes and confirm they match the address you fetched them by, so corruption is detectable; and (c) it's **immutable** — a digest always refers to the same bytes, so blobs can move between storage tiers (local SSD, S3) freely because the address never changes. Find-by-content, not find-by-location, is what makes the whole thing safe to share and cheap to store.

*Really testing:* whether you understand CAS as "address equals hash of content" and can name the three properties (dedup, integrity, immutability) that follow.

---

**Q2.2 — Explain Bazel's two-level cache: the action cache vs the CAS. Why split them?**

*Model answer:* Two stores. The **CAS** maps `digest → bytes` and holds *everything* — source contents, intermediate objects, final binaries, even serialized action definitions. The **action cache (AC)** maps an **action digest** → an **ActionResult**, where the action digest is the hash of a fully-specified action (command line, the digests of all input files, the input tree, declared output paths, the platform), and the ActionResult is *not* the output bytes — it's a small record of the *digests* of the outputs (plus exit code and stdout/stderr digests). To materialize an output you look it up in the AC, get the output digests, then fetch those bytes from the CAS.

The split pays off three ways: **dedup** (many ActionResults reference one output digest, stored once in the CAS); **cheap negative lookups** (asking "do I have this action?" is one small AC lookup — you only transfer large outputs on a confirmed hit, and only the ones you don't already have); and it's **the substrate for remote execution** (once actions and inputs/outputs are all content-addressed, a worker can be handed an action digest, pull inputs from the CAS, run, and push outputs back — the same scheme caching uses).

*Really testing:* the reference architecture. Knowing the AC stores *digests of outputs* rather than the outputs themselves is the detail that distinguishes "I read the docs" from "I understand the design."

*Follow-up:* "Why doesn't the AC just store the output bytes?" → Because then you couldn't deduplicate (every action with the same output stores its own copy), and you'd transfer large outputs even on a negative lookup. The indirection through the CAS is what makes both cheap.

---

## Section 3 — Local, Remote, and the Two-Level Model

**Q3.1 — Contrast a local cache and a remote/shared cache. What does each buy you?**

*Model answer:* A **local cache** lives on your own disk (`go env GOCACHE`, `ccache`'s `~/.cache/ccache`, Bazel's `--disk_cache`); it's microsecond-fast and private, and it speeds up *your* repeated builds. A **remote/shared cache** lives over the network (Bazel's `--remote_cache`, Gradle's build cache server) and is shared across the team and CI; it's millisecond-fast and its whole point is that **only the first person to build any given action pays for it** — everyone else, and CI, gets a hit. The remote cache is what makes a fresh checkout on a new laptop fast, and what stops every CI run from rebuilding the world. In production you layer them: check local disk first, fall back to remote, fall back to actually doing the work.

*Really testing:* whether you understand the *shared* cache is the high-value one (amortizing first-build cost across a whole org) and that they're layered, not either/or.

---

**Q3.2 — Show how you'd enable a disk cache and then a remote cache in Bazel, and how the same concept appears in Go, ccache, and Gradle.**

*Model answer:*
```bash
# Bazel: local disk cache, then a shared remote cache
bazel build //... --disk_cache=~/.cache/bazel-disk
bazel build //... --remote_cache=grpc://cache.internal:9092

# Go: the build cache is automatic and local
go env GOCACHE        # where it lives
go clean -cache       # wipe it

# ccache / sccache: drop-in compiler cache (sccache also does remote: S3/Redis/GCS)
export CC="ccache gcc"
ccache -s             # hit/miss stats
sccache --show-stats

# Gradle: opt-in local + remote build cache
gradle build --build-cache
```
The pattern is identical everywhere: a content-keyed local store, optionally backed by a shared remote one. Go's is automatic and local-only; `sccache` and Bazel/Gradle add the remote tier.

*Really testing:* fluency with real tools across ecosystems, and recognizing it's one concept with different front-ends.

---

## Section 4 — Correctness, Hermeticity, and Poisoning

**Q4.1 — Define an under-specified key and an over-specified key. Why is the asymmetry between them the most important idea in caching?**

*Model answer:* An **under-specified key** omits an input that *does* affect the output — so two genuinely different builds collide on one key and one gets the other's output. An **over-specified key** includes an input that *doesn't* affect the output — so two identical builds get different keys and the cache never hits. The asymmetry: over-specification is a **performance bug that's visible and measurable** (hit rate craters, you investigate, you fix it, nothing is ever *wrong*). Under-specification is a **correctness bug that's silent and catastrophic** — the cache reports a healthy hit rate while serving wrong artifacts, with a green build and no error. Because under-spec is invisible until it ships and over-spec is loud and recoverable, you bias *every* key-design decision toward completeness, accepting some hit-rate cost. You design keys to be trivially, obviously complete.

*Really testing:* the single deepest idea in the topic. Nailing the asymmetry — and concluding "bias toward completeness" — signals real correctness thinking.

---

**Q4.2 — Why is hermeticity, not key cleverness, what makes a cache correct? Give the one-line argument.**

*Model answer:* A cache key is a hash of the *declared* inputs. It's only complete if nothing *undeclared* influences the output. **Hermeticity is exactly the property "only declared inputs affect the output"** — the build reads no undeclared file, no environment variable you didn't list, no clock, no network, no random seed. So hermeticity is the precondition that makes the key complete and reuse provably correct. The one-liner: *a non-hermetic build has, by construction, an input outside its key, so its cache can be wrong — and no key, however clever, can fix that, because the influencing input was never declared.* This is why Bazel **sandboxes** actions — running each in an environment where only declared inputs exist physically upgrades "the developer remembered every input" into "the action cannot read an undeclared one."

*Really testing:* whether you connect caching to hermeticity as cause-and-effect, not as two adjacent topics. The "no key can fix a non-hermetic build" line is the senior insight.

---

**Q4.3 — What is a poisoned cache, and what are the ways one gets poisoned?**

*Model answer:* A **poisoned cache** is an entry whose stored output does *not* correspond to the inputs its key claims — so a correct build, doing everything right, fetches a *wrong* artifact. It's the scariest build bug because every other defense assumes the cache is honest. Three mechanisms:

1. **Under-specified key (the common one).** An input that affects output isn't keyed — e.g. `CGO_ENABLED` or `RUSTFLAGS` changes codegen but isn't hashed — so two different builds collide and one serves the other's output.
2. **Non-determinism in a "hermetic" action.** The action embeds a timestamp, a random map-iteration order, or an absolute path, so the same inputs produce *different* bytes; the cache stores one and serves it for the other. This wrecks reproducibility and digest-based trust.
3. **An untrusted write.** On a shared cache, a buggy or malicious producer uploads a bad artifact under a key trusted consumers read — a supply-chain poisoning.

Operationally it's terrifying because there's **no error** (the build is green, tests built from the cache may pass, the bad artifact ships), it **propagates** (downstream actions key over the poisoned input and poison further entries), and it's **hard to reproduce** ("clear your cache and it works" is the tell — but by then you've shipped). Defenses are layered: hermeticity + sandboxing against under-spec, reproducible builds against non-determinism, CAS integrity checks, and strict write-trust boundaries.

*Really testing:* whether you can name the failure *and* its mechanisms *and* why it's uniquely dangerous (silent, propagating, ships to prod).

---

## Section 5 — Hit Rate, the Metric That Matters

**Q5.1 — Hit rate is the headline metric of a cache. Define it, and distinguish the three kinds of miss — they have different fixes.**

*Model answer:* **Hit rate** is the fraction of executed actions served from the cache rather than run; build time, CI cost, and developer wall-clock all move with it. But a flat number hides the diagnosis, so you classify misses:

- **Cold miss** — the first build of a key. Unavoidable; *someone* must build a thing once. You lower it by having **trusted CI populate the cache** so humans rarely hit a true cold key.
- **Phantom miss** — should have hit but didn't, because the key is *unstable* (over-specified). Causes: a non-deterministic input sneaking into the key (a timestamp, an absolute path, a `$PWD`-dependent flag), an unpinned toolchain, or a volatile generated file in the input set. Each phantom miss is an investigation.
- **True miss** — the inputs genuinely changed. Working as intended.

The fix for cold is "warm the cache from CI"; the fix for phantom is "remove the non-determinism / pin the toolchain"; true misses need no fix. Reporting "70% hit rate" without splitting these hides whether you have a fixable non-determinism problem.

*Really testing:* whether you treat hit rate as a *diagnostic* (cold/phantom/true) rather than a single vanity number.

---

**Q5.2 — Name the levers to raise hit rate, and the one lever you must never pull.**

*Model answer:* In rough order of impact: (1) **make builds deterministic** so identical inputs yield identical keys *and* identical outputs — this kills phantom misses and enables dedup; (2) **tighten keys** to exclude irrelevant inputs (strip volatile paths and timestamps, pin toolchains by content); (3) **improve graph granularity** so a small change invalidates fewer actions — finer targets, fewer over-broad dependencies; (4) **populate from trusted CI** so the human-facing hit rate is high from the first checkout.

The lever you must **never** pull: dropping a *relevant* input from the key to manufacture hits. That raises the number while introducing the chance of poisoning — the wrong trade every time. "We improved hit rate" must always carry the qualifier "without weakening correctness." Raise it by removing non-determinism and *irrelevant* inputs, never *relevant* ones.

*Really testing:* the same correctness reflex as Q1.3, applied to optimization — that the goal is "high *and* correct," and those can conflict.

---

## Section 6 — Remote Execution, Eviction, and Sizing

**Q6.1 — How is remote execution related to remote caching? Are they two features or one?**

*Model answer:* One system, two paths. Caching is the **read path**: look up the action digest in the AC; on a hit, fetch the outputs from the CAS. Remote execution is the **miss path**: on a miss, instead of running the action locally, hand the action digest to a remote worker, which pulls the inputs from the CAS, runs it, and pushes the outputs back — populating the cache as a side effect. They share the *exact same* CAS, action-digest scheme, and protocol, which is why Bazel's **Remote Execution API** specifies both `ActionCache`, `ContentAddressableStorage`, and `Execution` services together. You can't reason about them as separable: a remote build is "cache lookup; on miss, dispatch to a farm rather than run here." Colocating the cache with the executors is the natural deployment because workers already have inputs in the shared CAS.

*Really testing:* whether you see caching and remote execution as consequences of one content-addressed model, not two products you adopt independently.

---

**Q6.2 — Walk through eviction and sizing. Why is eviction *safe* but a dangling reference *not*?**

*Model answer:* A cache is finite; a monorepo's key space is effectively infinite (every commit mints new keys), so a cache is a bet: keep what's most likely to be asked for again. **LRU** is the right default — recently-used artifacts back the active branches. Eviction is **safe** because entries are immutable and content-addressed: evicting a blob just turns a future hit into a miss (a rebuild), *never* a wrong answer. **Size to the working set** — the artifacts produced by commits people actively build against (roughly `main` plus open branches over your retention window). Too small thrashes (you evict what you'll need next hour, hit rate tanks); too large pays storage for commits no one will build again. Measure the working set; don't guess.

The hazard: the AC references output blobs *by digest*. If eviction removes a CAS blob still referenced by a live ActionResult, the AC hit becomes a **dangling reference** — a confirmed action hit that then can't fetch its output ("cache hit, no artifact"). Good caches either pin CAS blobs referenced by recent AC entries, or treat a dangling fetch as a miss and rebuild. Knowing this exists is what stops "hit but missing output" from being a mystery.

*Really testing:* the economics (working set, LRU) plus the one non-obvious correctness gotcha — AC↔CAS reference integrity under eviction.

---

## Section 7 — Security of Shared Caches

**Q7.1 — On a shared cache, who should be allowed to write, and why?**

*Model answer:* **Many readers, few trusted writers.** Reading a cache is harmless (worst case, you fetch a hit and verify its integrity); *writing* is a supply-chain trust boundary, because anything written under a key is served to everyone who reads that key. So developers should read but typically *not* write — in Bazel, `--remote_upload_local_results=false` lets a laptop benefit from the cache without polluting it — and only **trusted CI, running in a sandboxed, hermetic, audited environment, uploads**. The reasoning: a developer's machine isn't hermetic or trustworthy (local env leaks, uncommitted changes, malware), so an artifact it produces could be subtly wrong or malicious; promoting that to a shared entry poisons everyone. The write path is where you concentrate authentication, hermeticity enforcement, and provenance.

*Really testing:* whether you recognize the cache as a supply-chain surface and that the asymmetry (read-many, write-few-trusted) is a security decision, not a performance one.

*Follow-up:* "How do you defend against a malicious or buggy writer even among 'trusted' CI?" → Verify CAS integrity on read (re-hash); require hermetic, sandboxed execution for any writer; sign/attest artifacts and check provenance (SLSA) before consuming; and segment caches by trust level so an untrusted experiment can't write where production reads.

---

**Q7.2 — Why can content-addressing detect *tampering* but not *poisoning by under-specified key*?**

*Model answer:* Content-addressing lets you verify that the bytes you fetched match the digest you fetched them by — re-hash and compare — so it catches **corruption and tampering in transit or at rest**: a flipped bit or a swapped blob fails the check. But it cannot catch a **poison from an under-specified key**, because in that case the bytes *are* internally consistent — they hash correctly to the key under which they were stored — they're just the *wrong* output for the inputs the key was supposed to represent. The CAS guarantees "these bytes are what this digest says," not "this action digest captures every input." The first is integrity; the second is *completeness of the key*, which only hermeticity provides. Two different safety properties, two different defenses.

*Really testing:* a subtle distinction that separates deep candidates — integrity (CAS) versus key completeness (hermeticity) are orthogonal, and only together do they make a shared cache trustworthy.

---

## Section 8 — Design and Debugging Scenarios

**S1 — Design a shared build cache for 500 engineers on a monorepo.**

*Strong answer structure:*

1. **Two tiers.** Local disk cache on every machine (`--disk_cache`) for microsecond repeats; a shared **remote cache** (AC + CAS over the gRPC Remote Execution API — BuildBuddy, EngFlow, or a self-hosted bazel-remote) as the team-wide layer. CAS backed by object storage (S3/GCS) for capacity with a hot SSD tier for latency; digests make tier movement safe.
2. **Write trust boundary — the linchpin.** Developers **read-only** (`--remote_upload_local_results=false`); only **hermetic, sandboxed CI** writes. This is both the correctness guarantee (only hermetic producers populate shared entries) and the security guarantee (no laptop poisons the org).
3. **Make it advisory.** A cache outage must *slow* builds, never *break* them — `--remote_local_fallback` so a miss or a down cache falls back to local execution. A cache that can fail the build is a worse liability than the time it saves.
4. **Hermeticity + determinism are prerequisites, not add-ons.** Sandbox actions, pin and content-hash toolchains, strip timestamps/absolute paths. Without these the shared cache is fast and occasionally, silently wrong — unacceptable at 500 engineers because one poisoned entry fans out to everyone.
5. **Sizing & eviction.** LRU; size to the working set (main + active branches over the retention window); pin CAS blobs referenced by recent AC entries to avoid dangling references. Measure the working set from real traffic; don't guess.
6. **Observability.** Track hit rate split into cold/phantom/true (Build Event Protocol → a results UI); alert on a phantom-miss spike (a non-determinism regression) and on hit-rate cliffs (a toolchain or key change). Provide a "diff two builds' action keys" tool for debugging.

*Trade-off to name aloud:* the entire design's correctness rests on hermeticity and a strict write boundary. I'd treat "let developers write to the shared cache" or "introduce a non-hermetic action" as significant architectural decisions, not routine conveniences — because the failure they invite is silent and org-wide.

---

**S2 — A teammate got a stale artifact from the cache — the build was green but the binary behaved like an old version. Debug it.**

*Strong answer:*

1. **Confirm the symptom and the tell.** "Clear the cache and rebuild and it's correct" confirms a **poisoned entry**, not a source bug. (`go clean -cache`, `bazel clean`, or invalidate the remote key.) That the build was *green* is the signature of a cache-correctness bug, not a compile error.
2. **Hypothesize under-specification first** — it's the common cause. Find an input that affects the output but isn't in the key. Prime suspects: an **environment variable** reaching the compiler (`CGO_ENABLED`, `RUSTFLAGS`, `CFLAGS`, a feature-flag env), an **unpinned toolchain** (the key trusted a version string while the bytes differed), or an **undeclared file** the action read (a config outside the declared inputs).
3. **Diff the keys/inputs across the two builds** that should have matched. Dump the action's declared inputs and key on the good build and the bad build and find what differs that isn't in the key, or what's identical in the key but differed in reality. This is the master technique: *the poison is whatever influenced the output but didn't move the key.*
4. **Check determinism** as the second hypothesis. If the same inputs produce different bytes (embedded timestamp, map ordering, absolute path), the cache stored one and served the other. Build the action twice in a clean sandbox and `diff` the outputs.
5. **Check the write boundary** as the third. On a shared cache, did an untrusted or non-hermetic producer upload under this key? Audit who wrote the entry.
6. **Fix the root cause, not the symptom.** Add the missing input to the key (or, better, make the build hermetic so the key is complete by construction) and/or remove the non-determinism. Clearing the cache only papers over it until the next collision.

*Trade-off to name:* you could "fix" it by disabling caching for that action — fast, but it abandons the speedup and hides a real hermeticity defect that will bite elsewhere. Sealing the build is the correct, more expensive fix.

---

**S3 — "Why was this a cache miss?" A target you expected to hit rebuilt. Diagnose.**

*Strong answer:* Classify the miss before chasing it.

- **Is it a true miss?** Did an input genuinely change? A toolchain or compiler-version bump legitimately invalidates *everything* (new compiler → new code → every key changes), and that's correct, not a bug. Check the obvious: did anyone touch a widely-depended-on header, a `BUILD` file, a flag, or the toolchain?
- **Is it a cold miss?** First build of this key on this machine/cache — expected if CI hasn't warmed the shared cache, or you're on a fresh checkout. Fix by populating from trusted CI.
- **Is it a phantom miss (the interesting case)?** It *should* have hit. Diff the action key against the previous build's and find the unstable input: a **timestamp** or build date baked in, an **absolute path** (`$PWD`-dependent flag, a sandbox path leaking into the key), an **unpinned toolchain** whose bytes drift, or a **volatile generated file** in the input set (a generator emitting non-reproducible output). Confirm by building twice with no source change and checking whether the key is stable.

The general method is always the same: **dump and diff the action's inputs/key between the two builds that should have matched.** The thing that moved is your answer.

*Really testing:* whether you debug a miss with a *taxonomy* (true/cold/phantom) and the key-diff method, rather than guessing.

---

**S4 — Your remote cache hit rate dropped from 85% to 40% overnight with no obvious code change. Investigate.**

*Strong answer:* A cliff this sharp means a **shared input that's keyed everywhere changed**, invalidating a huge slice of the action space at once. Walk the suspects from most to least likely:

1. **Toolchain or base-image bump.** A new compiler, SDK, or CI base image changes the key of *every* action that hashes it — a legitimate but enormous true-miss wave. Check the CI image digest and toolchain pins against yesterday's.
2. **A non-determinism regression went global.** Someone introduced a timestamp, absolute path, or unstable ordering into a widely-shared generated input, so now *every* dependent action gets an unstable key — a phantom-miss flood. Diff keys for an action across two identical builds; if the key is unstable, that's it.
3. **A widely-included file changed** — a common header, a root `BUILD`/config, a vendored dependency lockfile. Legitimate invalidation, but check whether the change was intended.
4. **The cache itself.** Did the remote cache get wiped, resized (mass eviction), or did the write path break so CI stopped populating it (everyone now cold-misses)? Check cache storage metrics and CI upload success.

Confirm by sampling a few "should-hit" actions and diffing their keys; the input that moved across the board is the cause. Fix depends on which: re-pin the toolchain, remove the non-determinism, or repair the write path.

*Really testing:* whether you reason from "what single keyed input could invalidate everything at once" rather than poking randomly — and whether you remember the cache infrastructure itself (eviction, broken writes) as a cause.

---

## Rapid-Fire Round

- *What is a cache key, in one phrase?* → A hash of all the inputs to an action.
- *Content hash or timestamp — which does a real build cache use, and why?* → Content; it's honest and portable across machines.
- *Command to show Go's cache location?* → `go env GOCACHE`.
- *Command to wipe Go's cache?* → `go clean -cache`.
- *ccache hit-rate stats command?* → `ccache -s` (or `sccache --show-stats`).
- *Bazel flag for a local disk cache? A remote one?* → `--disk_cache=<path>`; `--remote_cache=<url>`.
- *What does the action cache store — the outputs, or their digests?* → The *digests* of the outputs (you fetch the bytes from the CAS).
- *Under-specified key — performance bug or correctness bug?* → Correctness, and silent.
- *Over-specified key?* → Performance, and visible (hit rate drops).
- *The property that makes a key provably complete?* → Hermeticity.
- *Poisoned cache, in one line?* → A correct build fetching a wrong artifact, with no error.
- *Who writes to a shared cache?* → Few trusted (hermetic CI); many read-only.
- *Why must a remote cache be advisory?* → A cache outage should slow builds, not break them (local fallback).
- *Eviction policy default, and is eviction safe?* → LRU; safe — a miss is a rebuild, never a wrong answer.
- *AC entry pointing at an evicted CAS blob?* → A dangling reference: "hit, but no artifact."
- *Caching and remote execution — two systems or one?* → One: cache is the read path, execution the miss path, same CAS.
- *First build of a fresh checkout is slow — bug?* → No; empty cache, everything cold-misses.

---

## What the Interviewer Is Really Testing

- **Do you treat the key as a correctness contract, not a knob?** The instant a candidate offers to drop a relevant input "for more hits," they've revealed they think of caching as a speed feature. Strong candidates protect key completeness reflexively.
- **Can you connect caching to hermeticity as cause-and-effect?** "Hash the inputs" is recall. "A non-hermetic build can't have a complete key, so no key can make its cache correct" is understanding — and it's the spine of the topic.
- **Do you grasp the silent-vs-loud asymmetry?** Knowing that under-specification is invisible and catastrophic while over-specification is visible and recoverable — and concluding "bias toward completeness" — is the senior judgment call.
- **Can you debug a stale artifact methodically?** The key-diff technique and the cold/phantom/true taxonomy show you've actually operated a cache, not just enabled one.
- **Do you see the cache as a supply-chain surface?** Recognizing the write trust boundary (read-many, write-few-trusted) and integrity-vs-completeness as separate properties is what platform and release-engineering roles are screening for.

---

## Red Flags That Sink Candidates

1. **"Loosen the key to get more hits."** Trades a measurable speedup for an unmeasurable chance of shipping wrong artifacts — the single worst answer on the page.
2. **Treating caching purely as performance.** No mention of correctness, poisoning, or hermeticity means the candidate has never run a cache that mattered.
3. **Not knowing the key must include flags, toolchain bytes, and platform** — only "the source file." They'll build an under-specified key and poison their own cache.
4. **Hashing identity instead of content** — keying on a version string or a path rather than the actual bytes. That's how miscompiles sneak past.
5. **Making the remote cache a hard dependency.** "If the cache is down, builds fail" is a self-inflicted availability liability; the cache must be advisory.
6. **Letting everyone write to the shared cache.** No sense of the write trust boundary — a supply-chain hole that lets one bad producer poison the whole org.
7. **Confusing CAS integrity with key completeness.** Believing content-addressing alone makes a shared cache "safe" misses that integrity catches tampering, not under-specified-key poisoning.

---

## Cheat Sheet

```
THE ONE-LINERS
  cache key = hash of ALL inputs (source bytes + headers + flags + TOOLCHAIN BYTES + platform)
  hash CONTENT not IDENTITY (compiler bytes, not "gcc 13.2"); content keys are SHAREABLE
  a cache is only as correct as its key is COMPLETE
  a key is complete only if the build is HERMETIC (declared inputs are the ONLY inputs)

TWO-LEVEL MODEL (Bazel)
  CAS : digest -> bytes      (all blobs; immutable, dedup, integrity-checkable)
  AC  : action digest -> ActionResult{ output DIGESTS, exit, stdout digest }
  lookup AC -> get output digests -> fetch bytes from CAS

THE ASYMMETRY (most important idea)
  under-spec key -> different builds COLLIDE -> WRONG output -> SILENT  (Sev-1)
  over-spec  key -> same builds get diff keys -> NO HIT     -> visible (perf)
  => bias every key toward COMPLETENESS

POISONED CACHE = correct build, wrong artifact, no error
  causes: under-spec key | non-determinism | untrusted write
  defenses: hermeticity+sandbox | reproducible builds | CAS integrity | write trust
  integrity (CAS) catches TAMPERING ; completeness (hermeticity) catches UNDER-SPEC

HIT RATE = the metric (split it!)
  cold (first build -> warm from CI) | phantom (should hit -> kill non-determinism) | true (ok)
  raise by removing non-determinism + IRRELEVANT inputs, NEVER relevant ones

SHARED CACHE (security)
  many READERS, few TRUSTED WRITERS (only hermetic CI uploads)
  Bazel: --remote_upload_local_results=false  (devs read, don't pollute)
  ADVISORY: cache down != build broken (--remote_local_fallback)

EVICTION / SIZING
  LRU; eviction is SAFE (miss = rebuild, never wrong); size to the WORKING SET
  hazard: AC -> evicted CAS blob = dangling ref ("hit, no artifact") -> pin/fallback

TOOLS
  go env GOCACHE ; go clean -cache
  export CC="ccache gcc" ; ccache -s ; sccache --show-stats
  bazel build //... --disk_cache=PATH --remote_cache=grpc://...
  gradle build --build-cache

CACHE + REMOTE EXECUTION = ONE SYSTEM
  cache = READ path ; remote execution = MISS path ; same CAS + action digest
```

---

## Related Topics

- [junior.md](junior.md) — cache keys as fingerprints, hit vs miss, busting, caching vs timestamp incrementality.
- [middle.md](middle.md) — what belongs in a key, content-addressable storage, shared/remote caches.
- [senior.md](senior.md) — action cache vs CAS, key design as correctness, hermeticity, poisoning, hit-rate engineering.
- [professional.md](professional.md) — running a remote cache at org scale, security/trust boundaries, war stories.
- [02 — Dependency Graphs › middle](../02-dependency-graphs/middle.md) — graph granularity determines how much a change invalidates.
- [05 — Polyglot & Hermetic Builds › senior](../05-polyglot-hermetic-builds/senior.md) — hermeticity and remote execution, the foundations that make caching correct.
- [09 — Reproducible Builds › senior](../09-reproducible-builds/senior.md) — determinism, the property that makes a key *predict* its output.
- [10 — Build Performance › senior](../10-build-performance/senior.md) — caching as one lever among many for fast builds.
- [Build Systems overview](../../README.md) — where build caching sits in the quality-engineering roadmap.
