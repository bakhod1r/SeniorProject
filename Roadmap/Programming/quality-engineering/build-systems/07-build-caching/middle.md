# Build Caching — Middle Level

> **Roadmap:** [Build Systems](../README.md) → Build Caching
> *The junior page said "hash the inputs." This page asks the question that decides whether your cache is a speedup or a time bomb: which inputs, exactly? Forget one, and the cache will confidently hand you the wrong binary.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Content-Addressable Storage — Fetch by What's Inside](#content-addressable-storage--fetch-by-whats-inside)
4. [What Belongs in a Cache Key (and Why Missing One Is Dangerous)](#what-belongs-in-a-cache-key-and-why-missing-one-is-dangerous)
5. [Local vs Remote Caches](#local-vs-remote-caches)
6. [Sharing a Cache Across a Team and CI](#sharing-a-cache-across-a-team-and-ci)
7. [ccache and sccache, Configured](#ccache-and-sccache-configured)
8. [Gradle and Bazel Cache Basics](#gradle-and-bazel-cache-basics)
9. [Caching vs Timestamp Incrementality, Mechanically](#caching-vs-timestamp-incrementality-mechanically)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What exactly goes into a cache key, and how do a team and CI share one cache safely?**

At the junior level the cache key is "a hash of the inputs," and a cache is a folder on your laptop. That model is correct but incomplete in the two ways that matter most in real engineering.

First, *which* inputs? "The source file" is obvious; the compiler version, the environment variables the compiler reads, the locale, the working directory baked into debug info — these are inputs too, and every single one that you *forget* to put in the key is a latent correctness bug. A cache that's missing an input doesn't crash. It silently returns the wrong answer. This page makes the input set concrete.

Second, a cache is most valuable when it's *shared*. If every engineer and every CI runner builds from an empty cache, you've duplicated the same compilation thousands of times across the org. A **remote cache** lets the first person (or CI job) to build something pay the cost, and everyone else downloads the result. That requires the key to mean the same thing on every machine — which circles right back to: *did you put the right things in the key, and nothing machine-specific?*

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) — cache key, hit/miss, content-addressing, caching vs timestamps.
- **Required:** You can run and configure at least one real build tool (Go, Gradle, Bazel, or a C/C++ toolchain).
- **Helpful:** You've felt a CI pipeline that rebuilds everything from scratch on every run and wished it didn't.
- **Helpful:** You understand a cryptographic hash (SHA-256) well enough to know that a tiny input change yields a totally different output.

---

## Content-Addressable Storage — Fetch by What's Inside

A normal file store is addressed by **location**: "give me `/builds/math.o`." A **content-addressable store (CAS)** is addressed by **content**: "give me the blob whose hash is `sha256:9f86d0...`." You don't ask for a name; you ask for a fingerprint, and you get back exactly the bytes that hash to it — or nothing.

This is the storage substrate underneath build caching, and it has properties that make it ideal for the job:

- **Deduplication is automatic.** Two builds that produce the identical `libfoo.a` store it under the same hash → one copy, not two. Git works exactly this way (every blob/tree/commit is content-addressed by SHA), which is why a repo with thousands of copies of an unchanged file stores it once.
- **Integrity is free.** You asked for `sha256:9f86d0...`; you can re-hash what you got and verify it's correct. A corrupted or tampered blob has a different hash and is rejected. (This matters enormously for *shared* caches — see senior/professional tiers.)
- **Immutability.** A content address can never point to two different things. Once `9f86d0...` means a specific blob, it always does. There's no "update in place," so there's no cache-coherency problem of the usual kind.

Build caches use CAS in two layers, which the junior page collapsed into one:

```
ACTION CACHE:   key = hash(all inputs of an action)  →  value = a list of output hashes
CAS (blobs):    output hash                           →  the actual output bytes
```

The **action cache** maps "this exact action" to "the hashes of the outputs it produced." The **CAS** maps "an output hash" to "the bytes." Ask the action cache with your input-key; it returns the output hashes; you fetch those bytes from the CAS. This two-level split is exactly how Bazel's remote caching works, and the senior page returns to it — but even at this level it's worth seeing that "the cache" is really *a map of input-keys to outputs* plus *a content-addressed blob store*.

> **Key insight:** Content-addressing flips the question from "where did I save it?" to "what is it made of?" That single flip gives you free deduplication, free integrity checks, and immutability — the three properties that make a build cache both fast and trustworthy, especially once it's shared across machines.

---

## What Belongs in a Cache Key (and Why Missing One Is Dangerous)

Here is the most important table in this entire topic. A cache key for a compile action must hash **every input that can change the output**. Miss one, and you've built a cache that returns stale, wrong results when that input changes.

| Input category | Examples | What happens if you forget it |
|---|---|---|
| **Source content** | the `.c`/`.go`/`.rs` file's bytes | Edit a file, get the old binary. (Everyone remembers this one.) |
| **Transitive inputs** | included headers, imported packages, generated code | Change a header, dependents reuse stale objects → ABI mismatch, crashes. |
| **Compiler/tool version** | `gcc 13.2`, `go1.22.3`, `rustc 1.78` | Upgrade the compiler, get code from the *old* one. Subtle miscompiles. |
| **Compiler flags / options** | `-O2`, `-DNDEBUG`, `--target`, `-std=c++20` | Build release flags, get the debug binary (or vice versa). |
| **Target platform** | OS, architecture, ABI (`x86_64-linux`, `aarch64-darwin`) | Cross-compile for ARM, get an x86 object. Won't even load. |
| **Relevant environment** | `CGO_ENABLED`, `CFLAGS`, locale, `SOURCE_DATE_EPOCH` | The classic invisible bug — see below. |
| **The action definition** | the command line / build rule itself | Change *how* you build, reuse output from the old recipe. |

The terrifying category is **environment**. Compilers read environment variables, the working directory, the locale, the system clock, and umpteen other ambient things — and many of those leak into the output (a `__DATE__` macro, an absolute path embedded in debug info, an env-var-driven code path). If such a thing affects the output but is **not** in the key, you get the canonical caching disaster:

```
Build #1:  CGO_ENABLED=1  → produces binary WITH cgo   → stored under key K
Build #2:  CGO_ENABLED=0  → key is STILL K (env not hashed!)
           → CACHE HIT → you get the cgo binary you did NOT ask for.
```

This is a **poisoned cache**: a wrong artifact served as if correct. The build succeeds. Tests might even pass. And you ship the wrong thing. (Go actually *does* include the relevant environment in its keys, precisely to prevent this — but home-grown caches and naive CI cache configs get it wrong constantly.)

> **Key insight:** The danger of caching is asymmetric. Putting *too much* in the key only costs you cache hits (you rebuild more than necessary — annoying, safe). Putting *too little* in the key costs you **correctness** (you reuse output that doesn't match the current inputs — silent, catastrophic). When in doubt, over-include. The right mental model is "the key must be a *superset* of everything that affects the output."

---

## Local vs Remote Caches

A cache lives somewhere, and *where* decides who can benefit from it.

**Local cache** — a directory on your machine (`$GOCACHE`, `~/.cache/ccache`, `~/.cache/bazel`). Only *your* builds populate and read it. Fast (it's local disk), private, and wasteful at scale: every engineer rebuilds everything once, and your CI runners — which are often ephemeral and start empty — rebuild *everything every single time*.

**Remote (shared) cache** — a service over the network that many machines read and write. The action cache and CAS live on a server (or object storage like S3/GCS). Now the key insight of caching scales across the whole org:

```
Engineer A builds libfoo  → MISS locally → MISS remotely → builds it → UPLOADS to remote cache
Engineer B (same inputs)  → MISS locally → HIT remotely  → DOWNLOADS libfoo (no compile)
CI runner (same inputs)   → empty local  → HIT remotely  → DOWNLOADS (no compile)
```

The first person to build any given thing pays; **everyone else downloads**. On a large monorepo this is transformational — a fresh-checkout CI build that would take 40 minutes finishes in 4, because almost everything was already built by *someone* and is sitting in the remote cache.

The trade-off is the network. A remote hit means downloading the artifact instead of computing it, so it only wins when **download time < compute time**. For a 5-millisecond compile of a tiny file, hitting a remote cache over the network can be *slower* than just compiling. Good systems therefore layer caches:

```
look in LOCAL cache (fastest)  →  miss?  →  look in REMOTE cache (network)  →  miss?  →  build
```

The local cache absorbs the cheap, frequent hits; the remote cache absorbs the expensive ones and the cold-start cases. Bazel does exactly this with `--disk_cache` (local) plus `--remote_cache` (shared) configured together.

---

## Sharing a Cache Across a Team and CI

Sharing a cache is where the *correctness* requirements from earlier become non-negotiable. On your own machine, a slightly-wrong key just wastes *your* time. On a shared cache, a wrong key means you can serve a poisoned artifact to *the entire team and every CI job*. The blast radius is the whole org.

For a shared cache to be both fast and correct, the key must be:

1. **Machine-independent.** The key must hash the *content* of inputs and the *logical* toolchain, never anything machine-specific — not absolute paths, not hostnames, not the local username, not timestamps. If two engineers' builds of identical sources produce different keys because their home directory paths differ, the cache never hits across people. This is precisely why **hermetic builds** matter so much (forward ref: [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/middle.md)): a hermetic build declares *all* its inputs and depends on *nothing* ambient, which is exactly the property that makes its cache key portable and its cache hits safe.
2. **Complete.** Everything that affects output is in the key (the table above). On a shared cache, a missing input doesn't poison just you — it poisons everyone who hits that key.

The most common real-world setup is "CI populates, everyone benefits":

- CI builds on every merge to `main` and **writes** results to the remote cache.
- Engineers' machines and PR-validation CI jobs have **read** access. They check out a branch, and the vast majority of actions hit the cache populated by `main` — they only build what their branch actually changed.

A subtle and important policy choice: **who is allowed to write to the cache?** If untrusted PR builds can write, a malicious or buggy PR can upload a poisoned artifact under a key that trusted builds will later read. The common safe default is *trusted CI writes, everyone reads* — a theme the professional page develops into a full trust-boundary discussion.

---

## ccache and sccache, Configured

[`ccache`](https://ccache.dev/) caches C/C++ compilation; [`sccache`](https://github.com/mozilla/sccache) does the same for C/C++/Rust and crucially supports *remote* backends (S3, GCS, Redis, Memcached). Both work by intercepting the compiler invocation, hashing the inputs, and returning a cached object on a hit.

**ccache, local:**

```bash
export CC="ccache gcc"
export CXX="ccache g++"
ccache --max-size=20G          # cap the cache size; LRU eviction beyond it
ccache -s                      # statistics: cache hit/miss counts and rates
ccache -z                      # zero the statistics (measure one build cleanly)
ccache -C                      # clear all cached objects
```

`ccache` hashes the preprocessed source (or, faster, the source plus dependencies in "direct mode"), the compiler binary's mtime/size/version, and the relevant flags. Its config (`~/.config/ccache/ccache.conf`) controls subtleties that are *correctness* knobs, e.g. whether to hash the compiler's real path and whether `__DATE__`/`__TIME__` macros disable caching (they do by default, because they'd make output non-deterministic).

**sccache, remote (shared across a team):**

```bash
export SCCACHE_BUCKET=my-build-cache       # S3 bucket as the shared backend
export SCCACHE_REGION=us-east-1
export RUSTC_WRAPPER=sccache               # Rust: route rustc through sccache
export CC="sccache gcc"                    # C/C++ as well
sccache --show-stats                       # hits, misses, cache size, backend
```

Now every developer and CI runner shares one S3-backed cache: the first build of a crate anywhere uploads it; everyone else downloads. `RUSTC_WRAPPER=sccache` is the standard way Rust projects get a shared compilation cache, and it's a massive win for CI on large Rust workspaces.

> **Watch the env:** both tools, by default, *refuse to cache* compilations that use `__DATE__`/`__TIME__`/`__TIMESTAMP__`, because those embed the wall clock into the output and would make the cache return time-dependent garbage. That refusal is a *correctness* safeguard — the tool noticing an input (the clock) it can't faithfully key on, and bailing out rather than poisoning the cache.

---

## Gradle and Bazel Cache Basics

**Gradle** has a content-based build cache, off by default for historical reasons:

```bash
./gradlew build --build-cache            # one-off
# or in gradle.properties:
#   org.gradle.caching=true
```

Gradle computes a cache key per *task* from its inputs (source files, classpath, task configuration, and the Gradle/JVM version) and outputs. A local cache lives under `~/.gradle/caches/build-cache-1`; a **remote** HTTP cache is configured in `settings.gradle` and is the basis of Gradle's team/CI sharing. The catch unique to Gradle: a task is only cacheable if it has correctly *declared* all its inputs and outputs via the task API. A task that reads an undeclared file is the Gradle-flavored version of the "missing input in the key" bug — Gradle can't hash what the task didn't tell it about.

**Bazel** treats caching as a first-class, two-level system (the action cache + CAS from earlier):

```bash
bazel build //... --disk_cache=~/.cache/bazel-disk        # local content cache
bazel build //... --remote_cache=grpc://cache.corp:9092   # shared remote cache
```

Bazel's superpower is that its keys are *trustworthy by construction*: because Bazel builds are **hermetic** (every action declares its exact inputs, tools, and environment, and runs sandboxed so it *can't* read undeclared inputs), the action key provably captures everything that affects the output. That's why Bazel can share a cache across thousands of engineers safely — the sandbox enforces the very property ("no hidden inputs") that makes the key complete. Gradle and ccache *trust* you to declare inputs correctly; Bazel *enforces* it.

---

## Caching vs Timestamp Incrementality, Mechanically

The junior page contrasted these. Here is the mechanism, because the distinction is the most-confused thing in the whole topic.

**Timestamp incrementality** (`make`): for a rule `out: in`, rebuild `out` if `mtime(out) < mtime(in)`. The build state is implicit in the filesystem's modification times. It's O(1) per file (just `stat` the files) and needs no extra storage — but it's *trusting the clock*, and clocks lie:

```bash
touch math.c        # mtime now newer than math.o → make rebuilds, though bytes are identical
git checkout old    # restores OLD contents, possibly with NEW mtime → make may SKIP a needed rebuild
cp -p (preserve)    # can give a fresh file an old mtime → make skips a needed rebuild
```

That last category — a build that *skips work it should have done* — is a correctness bug, and it's depressingly common with timestamp systems on branch switches and restored backups.

**Content caching** (Go, ccache, Bazel): rebuild if `hash(inputs) ∉ cache`. The build state is an explicit store keyed by input-hashes. It costs a hash computation per action and storage for results — but it answers the *honest* question ("are the bytes the same?"), so:

```
touch math.c        → contents unchanged → same key → HIT (correctly no rebuild)
git checkout old    → old contents back  → old key  → HIT on the old result (correct)
cp anywhere         → contents identical → same key → HIT (correct)
```

And critically, a content hash is **identical on every machine**, so the cache is *shareable*; an mtime is meaningless on another machine, so timestamp incrementality is *inherently local*. This is the deep reason the industry moved from "make-style timestamps" to "content-addressed caching" for anything that needs to scale across a team. (See [02 — Dependency Graphs](../02-dependency-graphs/middle.md) for how the graph that *drives* either approach is built.)

> **Key insight:** Timestamp incrementality and content caching are both "avoid redundant work," but they trust different things. Timestamps trust the clock and the filesystem (fast, fragile, local). Content hashes trust the bytes (robust, shareable, slightly more expensive). The moment you want to share results across machines, timestamps are *impossible* and content hashing is *mandatory*.

---

## Mental Models

- **Two-level cache: the index and the warehouse.** The *action cache* is an index card — "the build defined by key K produced outputs with hashes H1, H2." The *CAS* is the warehouse — "hash H1 lives in this bin." You read the card, then fetch from the warehouse. Separating them gives free deduplication: many cards can point at the same warehouse bin.

- **The key is a superset, never a subset.** Everything that affects the output must be in the key. Over-include and you lose a few hits (annoying); under-include and you serve wrong answers (catastrophic). The asymmetry should make you bias hard toward including more.

- **Hermeticity is what makes a shared key portable.** A build that depends only on *declared content* (not on paths, clocks, or ambient env) produces the *same key everywhere* — which is exactly what lets two machines share a cache safely. Caching and hermeticity are the same idea viewed from two angles.

- **Local cache = your fridge; remote cache = the supermarket.** You check the fridge first (fast, but only what you've made). Miss? Go to the supermarket (the network — slower, but stocked by everyone). Only worth the trip when shopping is cheaper than cooking from scratch.

---

## Common Mistakes

1. **Leaving an input out of the key.** The cardinal sin. Forgotten compiler flags, environment variables, or transitive headers cause a *poisoned cache*: a wrong artifact served as correct, with no error. When unsure, over-include.

2. **Keying on something machine-specific.** Absolute paths, hostnames, usernames, or timestamps in the key destroy cross-machine hit rates (everyone gets a unique key) — and if they *also* leak into output, you've combined poor hit rate with a correctness risk.

3. **Treating timestamp incrementality and content caching as the same thing.** They trust different signals (clock vs bytes), break differently (skipped rebuilds vs none), and only one is shareable across machines.

4. **Enabling a shared cache without thinking about *who can write*.** If untrusted builds can upload, a single poisoned entry compromises everyone. Default to "trusted CI writes, everyone reads."

5. **Expecting a remote cache to always be faster.** A remote hit downloads instead of computes; for cheap actions that can be *slower* than just building. Layer a local cache in front, and don't remote-cache trivially fast actions.

6. **Forgetting that a Gradle/ccache cache only knows the inputs you declared.** If a task or compilation reads an undeclared file, the cache can't hash it — so changing that file won't bust the key. Bazel's sandbox prevents this; most tools trust you to get it right.

---

## Test Yourself

1. Explain content-addressable storage in one sentence, and name two properties it gives a build cache for free.
2. What is the difference between the *action cache* and the *CAS*, and how do they work together on a lookup?
3. You add support for an environment variable that changes the compiler's output, but you don't add it to the cache key. Walk through the exact bug that results.
4. Why is putting *too much* in a cache key merely annoying, while putting *too little* is catastrophic?
5. Your team enables a remote cache and a fresh-checkout CI build drops from 40 minutes to 4. Where did the 36 minutes go — what actually happened?
6. Why can a content-based cache be shared across machines while `make`'s timestamp incrementality fundamentally cannot?

<details>
<summary>Answers</summary>

1. CAS stores and retrieves blobs by a hash of their *content* rather than a name/location. Free properties: **deduplication** (identical content stored once), **integrity** (re-hash to verify), and **immutability** (a hash always means the same bytes).
2. The **action cache** maps an action's input-key → the *hashes* of its outputs; the **CAS** maps an output-hash → the actual *bytes*. On lookup you query the action cache with your input-key, get back output hashes, then fetch those bytes from the CAS. Splitting them lets many actions dedupe identical outputs.
3. Build #1 sets the var one way, produces output X, stores it under key K (which doesn't include the var). Build #2 sets the var differently — but since the var isn't in the key, the key is *still K*, so you get a **cache hit** and receive output X, not the output the new var should produce. The build succeeds while serving the wrong artifact: a poisoned cache.
4. Too much in the key only loses you cache *hits* — you rebuild more than necessary, which is slow but always *correct*. Too little means two genuinely-different builds collide on one key, so you serve one build's output for the other's inputs — *wrong output, no error*. Speed is recoverable; a silent wrong binary may ship.
5. Almost every build action had already been compiled by a prior `main` CI run and uploaded to the remote cache. The fresh checkout's actions hashed to keys already present remotely, so they **downloaded** finished artifacts instead of compiling. The 36 minutes was compute that simply didn't happen — it was reused from the shared cache.
6. A content hash of identical inputs is *identical on every machine* — it's a property of the bytes, not the host — so a key computed on machine A is meaningful on machine B. An mtime is a machine-local, clock-dependent number with no meaning on another host, so there's nothing to compare across machines; timestamp incrementality is inherently single-machine.

</details>

---

## Cheat Sheet

```
TWO-LEVEL CACHE
  ACTION CACHE:  hash(inputs) → [output hashes]
  CAS:           output hash  → bytes
  lookup: query action cache with input-key → get output hashes → fetch from CAS

WHAT MUST BE IN A COMPILE KEY
  source content + transitive inputs (headers/imports/codegen)
  + compiler/tool VERSION + FLAGS + TARGET platform
  + relevant ENVIRONMENT (CGO_ENABLED, CFLAGS, locale, SOURCE_DATE_EPOCH...)
  + the action/command itself
  RULE: key = SUPERSET of everything affecting output.
        too much → lose hits (safe).  too little → POISONED CACHE (catastrophic).

LOCAL vs REMOTE
  local  = your disk; private; CI starts empty → rebuilds all
  remote = shared service/object store; first builder pays, REST DOWNLOAD
  layer:  local (fast) → remote (network) → build
  remote only wins when download time < compute time

TOOLS
  go:      go env GOCACHE; go clean -cache   (env IS in the key)
  ccache:  export CC="ccache gcc"; ccache -s; --max-size=20G
  sccache: SCCACHE_BUCKET=...; RUSTC_WRAPPER=sccache  (S3-backed, shared)
  gradle:  --build-cache  / org.gradle.caching=true   (must declare task in/out)
  bazel:   --disk_cache=DIR  --remote_cache=grpc://...  (hermetic → key is complete)

SHARED-CACHE SAFETY
  key must be machine-INDEPENDENT (no paths/hosts/users/timestamps)
  WHO CAN WRITE? default: trusted CI writes, everyone reads
```

---

## Summary

- **Content-addressable storage (CAS)** fetches blobs by a hash of their content, not a name. It gives a cache free **deduplication**, **integrity**, and **immutability** — the foundation under all build caching.
- A real cache is **two levels**: an *action cache* (input-key → output hashes) over a *CAS* (output-hash → bytes). Bazel exposes this directly; other tools collapse it.
- The **cache key must include every input that affects the output**: source + transitive inputs + tool version + flags + target + relevant environment + the action itself. The danger is asymmetric — *too much* costs hits (safe), *too little* serves a **poisoned cache** (catastrophic). When unsure, over-include.
- A **local** cache benefits only you; a **remote/shared** cache lets the first builder pay and everyone else download. This is transformational for CI, but the key must be **machine-independent**, which is why **hermetic builds** are the prerequisite for a safe shared cache.
- Real tools: `ccache`/`sccache` (the latter S3-backed and shareable, the Rust standard via `RUSTC_WRAPPER`), Gradle's task cache (you must declare inputs/outputs), and Bazel (sandboxing *enforces* complete keys).
- This is **not** timestamp incrementality: `make` trusts the clock (fast, fragile, local); content caching trusts the bytes (robust, and the only approach that can be shared across machines).

---

## Further Reading

- [Bazel — Remote Caching](https://bazel.build/remote/caching) — the canonical action-cache + CAS model, explained by the system that pioneered it at scale.
- [sccache README](https://github.com/mozilla/sccache) — configuring a shared, cloud-backed compiler cache for C/C++/Rust.
- [Gradle — Build Cache](https://docs.gradle.org/current/userguide/build_cache.html) — task input/output declaration and local + remote caching.
- [senior.md](senior.md) — action-cache/CAS correctness, hermeticity as the safety guarantee, poisoned-cache failure modes, and measuring hit rate.

---

## Related Topics

- [02 — Dependency Graphs](../02-dependency-graphs/middle.md) — the graph that tells the cache what an action's inputs even are.
- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/middle.md) — hermeticity, the property that makes shared cache keys portable and safe.
- [09 — Reproducible Builds](../09-reproducible-builds/middle.md) — making outputs bit-identical, which maximizes cache hits and dedup.
- [04 — Per-Language Tools](../04-per-language-tools/middle.md) — how each language toolchain implements its own cache.
