# Build Caching — Junior Level

> **Roadmap:** [Build Systems](../README.md) → Build Caching
> *The fastest build step is the one you never run. A build cache remembers the output of work you've already done, so when the inputs haven't changed, it hands you the answer instead of computing it again.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why Rebuild Work You Already Did?](#core-concept-1--why-rebuild-work-you-already-did)
5. [Core Concept 2 — The Cache Key Is a Fingerprint of the Inputs](#core-concept-2--the-cache-key-is-a-fingerprint-of-the-inputs)
6. [Core Concept 3 — Cache Hit vs Cache Miss](#core-concept-3--cache-hit-vs-cache-miss)
7. [Core Concept 4 — A Changed Input Busts the Cache](#core-concept-4--a-changed-input-busts-the-cache)
8. [Core Concept 5 — Caching Is Not the Same as Incrementality](#core-concept-5--caching-is-not-the-same-as-incrementality)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Why do builds get faster the second time, and what is actually doing the remembering?**

You change one comment in one file, type `go build`, and it finishes in a fraction of a second. The first time you built that project it took thirty seconds. What happened? The compiler did *almost no work* the second time — because it had already compiled everything else, and it *remembered the results*.

That memory is a **build cache**. The core idea is almost insultingly simple: building software is a pile of small, repetitive transformations (compile this file, run this code generator, bundle these assets), and most of the time the *inputs* to those transformations haven't changed since the last build. If the inputs are identical, the output must be identical too — so why recompute it? Just keep the answer in a folder and hand it back.

The whole subject lives or dies on one question: **how do you decide whether the inputs have changed?** Get that wrong in one direction and you waste time recomputing things that didn't change. Get it wrong in the *other* direction — reuse an answer when the inputs actually *did* change — and you ship a wrong binary that compiled "successfully." This page builds the simple, correct intuition before any of the scary parts.

> **The mindset shift:** stop thinking "the build compiles my code." Start thinking "the build looks up an answer it might already have, and only computes it if it doesn't." Every fast build is mostly a *lookup*, not a *computation*.

---

## Prerequisites

- **Required:** You've read [01 — Build Fundamentals › junior.md](../01-build-fundamentals/junior.md) and know that a build compiles source files into outputs.
- **Required:** You can run a build tool — `go build`, `cargo build`, `gradle build`, `make`, or similar — from a terminal.
- **Helpful:** You've noticed that the second build of a project is faster than the first and wondered why.
- **Helpful:** You roughly know what a "hash" is — a function that turns any input into a short fixed-size string.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Build action** | One small unit of build work: compile a file, link a binary, run a generator. |
| **Cache** | A store of previously-computed results, keyed so you can find them again. |
| **Cache key** | A fingerprint of *all the inputs* to an action — change any input, the key changes. |
| **Hash** | A function turning any input into a short fixed-size string; same input → same hash. |
| **Cache hit** | The key is already in the cache — reuse the stored output, skip the work. |
| **Cache miss** | The key is not in the cache — do the work, then store the result under that key. |
| **Cache invalidation / "busting"** | An input changed, so the key changed, so the old entry no longer applies. |
| **Hit rate** | The fraction of actions that were hits. Higher = faster builds. |
| **Local cache** | A cache on your own machine (e.g. `~/.cache`). |
| **Stale artifact** | A wrong cached output served because the key missed a real input. The scariest bug here. |

---

## Core Concept 1 — Why Rebuild Work You Already Did?

A build is made of many small, independent steps. Compiling a 50-file C project is 50 separate "compile this file" actions plus one "link them" action. Building a Go program compiles each package. Bundling a web app transforms hundreds of modules.

Here's the thing: between two builds, *most of those steps have identical inputs*. You edited one file; the other 49 are byte-for-byte the same as last time. The compiler flags are the same. The compiler version is the same. So the output of compiling those 49 files **must** be exactly what it was last time — recomputing it produces the same bytes, just slower.

A build cache exploits this. After it compiles a file, it saves the resulting object file in a cache folder, tagged with a label that captures *what produced it*. Next build, before compiling that file, it checks: *do I already have an answer for this exact input?* If yes, copy it from the cache. Done in milliseconds instead of seconds.

```
First build:   compile A (slow), compile B (slow), compile C (slow), link
Edit only B.
Second build:  A → cache HIT (instant), B → recompile (slow), C → cache HIT (instant), link
```

The savings scale with the project. On a tiny project, who cares. On a project with 10,000 files where you touched 3, a cache turns a ten-minute build into a five-second one. That's the difference between "I can iterate quickly" and "I get a coffee every time I save."

> **Key insight:** Caching doesn't make any single step faster. It makes you *skip steps entirely*. The win isn't a faster compiler — it's a compiler you don't have to run.

---

## Core Concept 2 — The Cache Key Is a Fingerprint of the Inputs

How does the cache know whether it "already has an answer"? It needs a label for each entry — and that label must capture *everything that could change the output*. That label is the **cache key**.

The cache key is a **hash of all the inputs** to an action. For "compile `math.c`," the inputs include:

- The **contents** of `math.c` (not its name or timestamp — its actual bytes).
- Every **header** `math.c` includes (their contents too).
- The **compiler flags** (`-O2` produces different output than `-O0`).
- The **compiler version** (GCC 12 and GCC 13 emit different code).
- The **target platform** (compiling for ARM vs x86 differs).

You feed all of that into a hash function, and out comes a short fixed-size string like `a3f9c2...`. That string *is* the key. The defining property of a hash: **the same inputs always produce the same key, and any change to any input produces a completely different key.**

```
inputs:  contents(math.c) + contents(math.h) + "-O2" + "gcc-13.2" + "x86_64"
              │
              ▼  hash
key:     a3f9c2e1b7...
              │
              ▼
cache:   a3f9c2e1b7...  →  [ the compiled math.o ]
```

This is called **content-addressable storage**: you find a stored thing not by *where you put it* or *what you named it*, but by *what's in it* (a hash of its inputs). Ask for key `a3f9c2...` and you get back exactly the output that those inputs produce — or nothing, if it was never built.

> **Key insight:** The cache key is the entire ballgame. If it captures every input faithfully, the cache is correct and fast. If it *misses* an input — say, it forgets the compiler flags — then two different builds get the same key and one gets the *wrong* answer. Everything hard about caching is "did we put the right things in the key?"

---

## Core Concept 3 — Cache Hit vs Cache Miss

Every build action goes through the same little decision:

```
1. Compute the cache key from the action's inputs.
2. Look up the key in the cache.
3a. Key found?     → CACHE HIT.  Copy the stored output. Skip the work.
3b. Key not found? → CACHE MISS. Do the work. Store the output under the key.
```

A **hit** is free (or nearly — just a copy). A **miss** costs the full work, *plus* a tiny bit to store the result. So the first time you ever build anything, *everything misses* — the cache is empty, there are no answers yet. That's expected and unavoidable; you have to pay once to populate the cache.

After that, your hit rate depends on how much you change. Touch one file, and only the actions downstream of that file miss; everything else hits.

You can watch this happen with Go's build cache. Go caches compiled packages automatically in a directory:

```bash
go env GOCACHE
# /Users/you/Library/Caches/go-build   (the cache lives here)

go build ./...        # first time: lots of misses, slow
go build ./...        # second time: all hits, near-instant — nothing changed

go clean -cache       # wipe the cache entirely
go build ./...        # slow again — every action misses, cache is empty
```

Run those four commands and you can *feel* the cache: the middle build is instant, and the moment you wipe the cache the next build is slow again. The compiler didn't change. The code didn't change. Only the *cache contents* changed — proof that the speed came from the cache, not the compiler.

> **Why the first build is "slow forever" the first time on a new machine:** a fresh checkout on a new laptop has an empty cache, so *every* action misses. This is why CI builds that start from scratch are slow — and why sharing a cache across machines (a later topic) is such a big deal.

---

## Core Concept 4 — A Changed Input Busts the Cache

The flip side of "same inputs → same key → hit" is the safety mechanism: **change any input and the key changes, so the old answer no longer matches — you get a miss and the work reruns.** This is called **busting** or **invalidating** the cache, and it's exactly what you want.

Watch it with a concrete example. Two builds, where the only difference is a compiler flag:

```bash
go build ./...               # builds with default flags → key K1
go build -gcflags=-l ./...   # different flags → different inputs → key K2 → MISS, rebuilds
```

The second command doesn't reuse the first build's output, *because the flags are part of the key*. `-gcflags=-l` (disable inlining) genuinely produces different machine code, so reusing the old output would be wrong. The cache correctly refuses to.

The same logic covers every input:

- Edit a source file's contents → its hash changes → key changes → that file recompiles. ✅
- Upgrade your compiler → the compiler-version input changes → *everything* rebuilds. ✅ (This is why a Go or Rust version bump triggers a full rebuild — and it's correct, because the new compiler emits different code.)
- Add a `#define` or change a build flag → key changes → rebuild. ✅

```
key = hash( source + headers + flags + compiler-version + target )
        change ANY term ──────────────────────────────────────► new key ──► miss ──► rebuild
        change NOTHING  ──────────────────────────────────────► same key ──► hit  ──► reuse
```

> **Key insight:** Cache invalidation isn't a separate, complicated feature you bolt on. It's a *free consequence* of putting inputs in the key. There's no "expire this entry" logic for build actions — if an input changed, the key is simply different, and the old entry is irrelevant (it'll be served again the moment those exact inputs reappear, e.g. when you `git checkout` the old version back).

---

## Core Concept 5 — Caching Is Not the Same as Incrementality

This trips up almost everyone, so let's nail it. You met **incremental builds** in [02 — Dependency Graphs](../02-dependency-graphs/junior.md): the build skips a step if the output file is *newer than its inputs* (timestamp-based, the way `make` works).

Both caching and incrementality try to *avoid redundant work*, but they decide "can I skip this?" in completely different ways:

| | Timestamp incrementality (`make`) | Content-based caching (Go, ccache, Bazel) |
|---|---|---|
| "Has the input changed?" answered by | Is the output **newer** than the input? | Does a **hash of the inputs** match a stored key? |
| What it actually compares | File modification *times* | File *contents* + flags + tool version |
| `touch file.c` (no content change) | Rebuilds (timestamp is newer) — wasteful | Hit (contents unchanged) — correct, no rebuild |
| `git checkout` an old version | May *not* rebuild (old timestamps) — **wrong** | Rebuilds correctly (different contents → different key) |
| Works across machines? | No (timestamps are machine-local) | Yes (a hash is the same everywhere) |

The timestamp approach is fast and simple but fragile: timestamps lie. Copying files, switching git branches, or restoring from backup can leave a *new* file with an *old* timestamp (or vice versa), and `make` will skip a build it should have run — or rerun one it shouldn't.

Content-based caching asks the *honest* question — "are the actual bytes the same?" — which is both more correct and *shareable*: a content hash is identical on every machine, so two people (or a CI server) can use the same cache. A timestamp means nothing on another machine.

> **Key insight:** "Don't rebuild what didn't change" can be implemented by *time* (fast, fragile, local) or by *content* (robust, shareable, what modern tools do). When this roadmap says "build cache," it means the content-based kind. Timestamp incrementality is the old, leakier cousin.

---

## Real-World Examples

**1. The instant second `go build`.** You build a Go service: 28 seconds. You add a log line to one file and build again: 0.4 seconds. Go hashed every package's inputs, found 200 of 201 keys already in `$GOCACHE`, reused those compiled packages, and only recompiled the one package you touched (plus relinked). Wipe the cache with `go clean -cache` and the next build is 28 seconds again — the cache *was* the speed.

**2. ccache making a C++ rebuild fly.** A large C++ project takes 12 minutes from clean. The team installs [`ccache`](https://ccache.dev/), a drop-in cache for the C/C++ compiler. After the first build populates it, switching branches and rebuilding takes 90 seconds — because most files are byte-identical between branches, so `ccache` hashes each compilation's inputs, finds a hit, and returns the cached `.o` instead of invoking the compiler:

```bash
export CC="ccache gcc"      # wrap the compiler with ccache
make                        # first build: misses, populates the cache
git switch other-branch
make                        # mostly hits — ccache returns cached objects
ccache -s                   # show statistics: hits, misses, hit rate
```

**3. The branch switch that "shouldn't have rebuilt everything" — but did, correctly.** A developer switches from `main` to a branch that bumped the Go version in CI config and the toolchain. Suddenly the whole project rebuilds. They file a bug: "caching is broken." It isn't. The compiler version is part of every key; a new compiler means every key changed, so every action correctly missed. A cache that *didn't* rebuild here would be the actual bug — it would reuse code compiled by the wrong compiler.

---

## Mental Models

- **The cache is a lookup table keyed by a fingerprint.** Before doing any work, the build asks "do I already have the answer for *these exact inputs*?" The fingerprint (hash) is how it asks. Hit = found, copy it. Miss = not found, compute and file it away.

- **The key is a recipe, not a label.** A cache key isn't a name someone chose; it's mechanically derived from *every ingredient* (source, flags, tool version). Two builds collide on a key only if they truly used identical ingredients — in which case they *should* produce identical output.

- **Content-addressing is "find it by what it's made of."** Instead of "give me the file at this path," it's "give me the output produced by *these inputs*." Same inputs anywhere on earth → same key → same answer. That's why caches can be shared.

- **Invalidation is automatic, not manual.** You never "expire" a build cache entry. You change an input; the key changes; the old entry is simply not asked for. The old entry isn't *wrong* — it's the right answer for the *old* inputs, which you'll get back if those inputs ever return.

---

## Common Mistakes

1. **Thinking the cache makes the compiler faster.** It doesn't touch the compiler. It lets you *skip running the compiler*. A cache hit is a file copy; the speedup is from work avoided, not work accelerated.

2. **Confusing caching with timestamp incrementality.** `make` skips work based on file *times*; a content cache skips based on input *hashes*. The timestamp version breaks on branch switches and file copies; the content version doesn't. They are different mechanisms.

3. **Expecting the *first* build to be fast.** An empty cache means everything misses. You always pay full price once to populate it. CI from a clean checkout is slow for exactly this reason.

4. **Blaming the cache when a tool upgrade rebuilds everything.** Upgrading the compiler/toolchain *should* rebuild everything — the new compiler emits different code, so every key legitimately changes. A cache that skipped this would be serving wrong output.

5. **`touch`-ing a file expecting a rebuild.** A content cache hashes *contents*, not timestamps. `touch math.c` changes the timestamp but not the bytes, so the key is unchanged and you get a hit (no rebuild). To force a rebuild, change the contents or clean the cache.

6. **Assuming "the build succeeded" means "the cache was correct."** A build can succeed while serving a *stale* artifact if the key missed a real input. The build doesn't error — it confidently hands you the wrong output. This is the dangerous failure mode the higher tiers obsess over.

---

## Test Yourself

1. In one sentence, what is a cache key, and what must it capture?
2. The first build of a fresh checkout is slow; the second is instant. Why?
3. You run `touch main.go` (changing only its timestamp) and rebuild with `go build`. Does Go recompile `main.go`? Why or why not?
4. You upgrade your Go compiler and the *entire* project rebuilds. Is the cache broken? Explain.
5. Name one concrete difference between `make`'s timestamp incrementality and a content-based build cache.
6. What command shows you where Go's build cache lives, and what command wipes it?

<details>
<summary>Answers</summary>

1. A cache key is a **hash of all the inputs** to a build action — source contents, headers, compiler flags, compiler version, target platform — so that any change to any input changes the key.
2. The first build runs against an **empty cache**, so every action misses and does full work (and stores its result). The second build finds every key already present (nothing changed) → all hits → it just copies stored outputs.
3. **No.** Go's cache keys are based on file *contents*, not timestamps. `touch` changes only the timestamp; the bytes are identical, so the key is unchanged and Go serves a cache hit.
4. **Not broken — correct.** The compiler version is part of every cache key. A new compiler emits different code, so every key changes, every action misses, and everything correctly rebuilds. A cache that *reused* output here would be the real bug.
5. Timestamp incrementality compares file modification *times* (and breaks on branch switches / file copies where timestamps lie and are machine-local); content caching compares *hashes of inputs* (robust to timestamp games and identical across machines, so it can be shared).
6. `go env GOCACHE` shows the location; `go clean -cache` wipes it.

</details>

---

## Cheat Sheet

```
THE CORE LOOP (every build action)
  key = hash(inputs)
  if key in cache:  HIT  → copy stored output, skip work
  else:             MISS → do work, store output under key

WHAT GOES IN A KEY (compile action)
  source file CONTENTS  (bytes, not name/timestamp)
  + included headers' contents
  + compiler FLAGS        (-O2 vs -O0 → different output)
  + compiler VERSION      (gcc 12 vs 13 → different output)
  + target PLATFORM       (x86 vs arm)

HIT vs MISS
  first build / fresh checkout → everything MISSES (empty cache)
  nothing changed              → everything HITS
  changed one file             → that file + downstream MISS, rest HIT

CACHING ≠ TIMESTAMP INCREMENTALITY
  make:        skip if output NEWER than input   (time-based, fragile, local)
  go/ccache:   skip if input HASH matches key     (content-based, robust, shareable)

GO BUILD CACHE
  go env GOCACHE     # where it lives
  go build ./...     # populates / uses it
  go clean -cache    # wipe it (next build is slow)

CCACHE (C/C++)
  export CC="ccache gcc"
  ccache -s          # hit/miss statistics
```

---

## Summary

- A **build cache** avoids redundant work by remembering the output of build actions: same inputs → reuse the stored answer instead of recomputing it. The win is *skipping work entirely*, not running it faster.
- The heart of caching is the **cache key**: a **hash of all the inputs** to an action (source contents, headers, flags, compiler version, target). Same inputs → same key; any change → a new key.
- A **cache hit** reuses a stored output (fast); a **cache miss** does the work and stores it. The first build, or any fresh checkout, misses everything because the cache is empty.
- Looking things up by a hash of their inputs is **content-addressable storage**: you fetch an output by *what produced it*, not where it sits. This makes invalidation automatic — change an input, the key changes, the old entry simply isn't asked for.
- This is *not* timestamp incrementality. `make` decides "skip?" by comparing modification *times* (fragile, machine-local). A content cache decides by hashing *contents* (robust, and shareable across machines and CI).

You now have the correct, simple intuition. The middle page goes deeper into *what exactly belongs in a key* (and the dangerous bugs from leaving something out), content-addressable storage, and how a whole team or CI system can **share one cache** so only the first person to build anything pays for it.

---

## Further Reading

- [Go command documentation — build cache](https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching) — how Go's cache works and what controls it.
- [ccache documentation](https://ccache.dev/) — the canonical drop-in compiler cache; the manual explains hashing and statistics clearly.
- [middle.md](middle.md) of this topic — what belongs in a cache key, content-addressable storage, and shared/remote caches.

---

## Related Topics

- [02 — Dependency Graphs](../02-dependency-graphs/junior.md) — incremental builds and the timestamp-based approach a content cache improves on.
- [04 — Per-Language Tools](../04-per-language-tools/junior.md) — `go build`, `cargo`, and `gradle` and the caches they ship with.
- [10 — Build Performance](../10-build-performance/junior.md) — where caching fits among all the levers for making builds fast.
- [Caching Strategies](../../../../skills/caching-strategies) — caching as a general engineering pattern (TTLs, eviction, invalidation) beyond builds.
