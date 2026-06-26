# Memory Bugs — Senior Level

> **Topic:** [Memory Bugs](README.md)
> **Focus:** Systemic patterns across GC and non-GC runtimes — fragmentation, allocator behavior, off-heap leaks, retention design, and how to engineer systems that *resist* these bugs rather than merely fixing them one at a time.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

A junior recognizes leaks; a mid-level engineer diagnoses one. A senior engineer reasons about **whole classes of memory bugs across runtimes** and designs systems where these bugs are hard to introduce, cheap to detect, and bounded in blast radius.

That demands a model that spans the GC / non-GC divide. The same RSS-creep symptom can be a reachable-object leak (your references), heap **fragmentation** (the allocator can't reuse freed space), **off-heap** growth (memory the GC never sees), or **allocation churn** stressing the collector. These have different root causes in different runtimes — a non-compacting collector fragments where a compacting one doesn't; an arena allocator behaves nothing like `malloc`; Go's `tcmalloc`-style size classes waste memory differently than the JVM's regions. A senior must hold all of these in one framework.

The throughline of this tier: **memory bugs are usually lifetime and ownership bugs in disguise.** Whether you have a GC or not, the question is always "who owns this, for how long, and what bounds its growth?" Get ownership and lifetime right architecturally and most of these bugs cease to be possible.

---

## Prerequisites

- Middle-level mastery: leak mechanisms, retention-vs-churn, dominator trees, the RSS-vs-live 2×2, and a working diagnosis methodology.
- A mental model of how at least one GC works (generational, tracing, mark-sweep-compact) and how at least one manual allocator works (`malloc`/`free`, arenas, pools).
- Experience operating a system in production: metrics, dashboards, and incident response.

---

## Glossary

| Term | Meaning |
|---|---|
| **External fragmentation** | Free memory exists in total, but it's split into pieces too small/scattered to satisfy a request. |
| **Internal fragmentation** | Wasted space *inside* an allocation because the allocator rounds up to a size class (a 17-byte object in a 32-byte slot wastes 15 bytes). |
| **Compaction** | A GC phase that relocates live objects together, eliminating external fragmentation (and enabling bump-pointer allocation). |
| **Size class** | A fixed bucket of sizes an allocator serves from (e.g., 8, 16, 32, … bytes). Source of internal fragmentation. |
| **Arena / region** | A block of memory allocated and freed as a unit; great for known-lifetime workloads, dangerous if a single object outlives the arena. |
| **Off-heap / native leak** | Growth in memory the managed runtime doesn't track: direct `ByteBuffer`, `mmap`, JNI/cgo allocations, native libraries. |
| **Dominator** | An object through which all root paths to a target must pass; removing it frees the whole dominated subtree. |
| **Retention root** | The specific GC root (static, thread, JNI global ref, classloader) that anchors a leaked subgraph. |
| **Classloader leak** | A JVM-specific leak where an undeployed app's classes (and all their statics) stay reachable, retaining the whole classloader. |

---

## Core Concepts

### 1. The unified taxonomy of "RSS is too high"

When a senior sees memory climbing, they branch on **four** systemic causes, not one:

1. **Reachable-object leak (retention).** Your references keep growing the live set. The cure is breaking references / bounding collections. Diagnosed by dominator analysis.
2. **Fragmentation.** The live set is flat, but the allocator/GC can't pack it densely, so RSS stays high. Cure depends on the allocator: compaction, size-class tuning, or restructuring allocations.
3. **Off-heap / native growth.** The managed heap is flat and clean; memory grows outside it. Cure: track native allocations explicitly; this is invisible to heap dumps.
4. **Allocation churn / GC pressure.** Live set flat, but allocation *rate* forces the GC to thrash — a latency/CPU bug presenting as a memory symptom. Cure: reduce allocation.

The senior skill is *cheaply distinguishing these four* before committing to an expensive investigation. The RSS-vs-live divergence, GC logs (frequency, pause times, post-GC occupancy), and native-memory accounting are the three readings that disambiguate them.

### 2. Fragmentation: why free memory you can't use

Fragmentation is the bug juniors don't know exists and seniors design around.

**External fragmentation** happens in non-compacting allocators and collectors. You free objects, leaving holes; later a large request can't fit in any single hole even though total free space is ample. A long-running C/C++ service with mixed allocation sizes, or a JVM using a non-compacting collector under certain conditions, can have a "live set" of 2 GB but an RSS of 5 GB — *the 3 GB gap is fragmentation, not a leak.* No heap dump will ever explain it, because every byte is legitimately structured; it's just badly packed.

**Compacting collectors** (e.g., a moving generational GC) dodge external fragmentation by relocating survivors into contiguous space, which also enables cheap bump-pointer allocation. The trade-off: compaction costs CPU and requires updating every reference to a moved object. This is the central design tension — *non-moving collectors are simpler and avoid relocation cost but fragment; moving collectors avoid fragmentation but pay to relocate.*

**Internal fragmentation** is the quieter tax. Allocators serve from size classes, so every allocation rounds up. A workload dominated by 33-byte objects landing in 48-byte slots wastes ~30% — silently, forever, with no leak anywhere. This is why allocation *shape* (the distribution of sizes) matters as much as allocation *volume*.

### 3. Off-heap leaks: the heap dump's blind spot

The most painful production leaks are the ones your primary tool can't see. Direct `ByteBuffer`s in Java are a heap-tiny wrapper around a large native buffer; the wrapper is freed only when *it* is GC'd, and native memory isn't reclaimed until then — so a low-pressure heap can sit on gigabytes of native buffers indefinitely. JNI global references, `mmap`'d files, native image/crypto/compression libraries, and cgo allocations in Go are all in this category.

The senior reflex: **when the managed heap is provably clean but RSS climbs, stop heap-dumping and start native-accounting.** On the JVM that means Native Memory Tracking (`-XX:NativeMemoryTracking`), `pmap`, and `jcmd VM.native_memory`. In native code it means `valgrind`/`massif` or ASan's LeakSanitizer. The failure mode here is *category error*: spending a day in a heap analyzer that, by construction, cannot show the leak.

### 4. Retention as an architectural property

At scale, you don't fix leaks one reference at a time; you design lifetimes so leaks can't accumulate. The systemic patterns:

- **Bounded by construction.** Every cache is an LRU/TTL/size-capped structure, never a raw map. Every queue has a max depth and a drop/back-pressure policy. The leak-resistant property is *structural*, enforced by the type, not by reviewer vigilance.
- **Ownership is explicit.** One owner is responsible for a resource's lifetime; everyone else borrows. RAII (C++), `defer close` (Go), try-with-resources (Java), and `Drop` (Rust) all encode "this *will* be released" into control flow. Leaks happen where ownership is *ambiguous* — shared mutable references with no clear releaser.
- **Weak references for back-edges.** Caches keyed on objects, observer registrations, and parent/child back-pointers use weak references so the collector can reclaim despite the reference. (Java `WeakHashMap`, soft references for memory-sensitive caches.)
- **Lifetime-scoped allocation.** Arenas/pools tie a batch of objects to a request or task; the whole batch is released at once. Powerful for churn, but a single escaping pointer turns it into a use-after-free (non-GC) or a leak (if the arena outlives expectation).

### 5. Churn as a GC-pressure systemic bug

A system can be leak-free and fragmentation-free and *still* be a memory disaster because it allocates too fast. Every short-lived object is work for the collector. Defensive copying, autoboxing (`Integer` per `int`), per-request allocation in hot paths, and excessive intermediate collections in stream pipelines can push allocation rate to gigabytes/second, forcing constant minor GCs and tail-latency spikes. The senior treats *allocation rate* as a first-class SLI and uses pooling, value types, slice reuse, and `sync.Pool`-style mechanisms to flatten it — while staying alert that pooling reintroduces lifetime bugs (a pooled object used after return is the manual-memory bug class sneaking back in).

---

## Real-World Analogies

- **External fragmentation = a parking lot of odd gaps.** The lot is half empty, but every free space is too small for a bus. Total capacity is irrelevant; *contiguous* capacity is what matters. Compaction is repainting the lines and shuffling cars to free a bus-sized space.

- **Internal fragmentation = shipping with fixed box sizes.** You only stock three box sizes. A medium item goes in a large box; the empty volume ships air. Across a million parcels, you're paying to move a warehouse of air.

- **Off-heap leak = a storage unit you rented through a shell company.** Your home (the heap) is tidy and inspectable. Meanwhile a separate storage unit (native memory) fills up, and the home inspector (heap dump) has no idea it exists.

- **Arena = a whiteboard you wipe after the meeting.** Everyone scribbles freely; at the end you erase the whole board at once (fast, no per-note cleanup). Disaster only if someone photographs a note and relies on it after the wipe (escaping pointer).

---

## Mental Models

### The four-cause branch

Internalize the decision tree: *Is the post-GC live set rising?* If yes → retention leak. If no, *is RSS rising?* If no → healthy. If yes, *is the managed heap accounting for it?* If no → off-heap. If yes but unpackable → fragmentation. And orthogonally, *is GC CPU/frequency high with flat memory?* → churn. Every memory incident routes through this branch within the first ten minutes.

### Lifetime as the real variable

Reframe every object as having a *intended* lifetime (how long the program needs it) and an *actual* lifetime (how long it stays reachable / allocated). Every memory bug is a gap between these. Leaks: actual ≫ intended. Use-after-free (non-GC): actual < intended. Good design makes actual lifetime *track* intended lifetime automatically — via ownership, scopes, and bounds.

### Density, not just volume

Memory health isn't "how much is alive" but "how *densely* is it packed and how *fast* does it turn over." Two systems with identical live sets can have wildly different RSS (fragmentation) and wildly different GC cost (churn). Seniors reason about the *shape and rate* of allocation, not only the total.

---

## Code Examples

### Java: a classloader leak (the app-server classic)

```java
// In a redeployable web app, a library starts a thread referencing app classes:
public class CacheManager {
    static { startBackgroundThread(); } // never stopped on undeploy
}
```

On redeploy, the container discards the old `WebAppClassLoader`, but the still-running background thread holds a reference to a class loaded by it. That class's classloader retains *every* class and static of the old app. Result: each redeploy leaks a full copy of the application's class metadata, eventually exhausting Metaspace. The dominator-tree fingerprint is a `Thread` (a GC root) dominating an entire `WebAppClassLoader`. The fix is lifecycle: stop the thread in a `ServletContextListener.contextDestroyed`.

### Java: weak-reference cache to make retention collectible

```java
// Entries vanish automatically once the key is unreachable elsewhere.
private final Map<Key, Value> cache = new WeakHashMap<>();
// For memory-sensitive caches that may keep values until pressure:
private final Map<Key, SoftReference<Value>> soft = new ConcurrentHashMap<>();
```

`WeakHashMap` lets the GC reclaim entries whose keys are otherwise dead — the cache stops being a leak by construction. (Caveat: weak/soft caches have surprising eviction timing; for predictable bounds prefer an explicit LRU.)

### Go: bounding churn with sync.Pool (and the lifetime hazard)

```go
var bufPool = sync.Pool{New: func() any { return make([]byte, 0, 4096) }}

func handle(r io.Reader) {
    buf := bufPool.Get().([]byte)[:0]
    defer bufPool.Put(buf[:0])
    // ... use buf; MUST NOT retain it past Put, or it's a data race / corruption
}
```

This flattens allocation rate under load. The systemic risk: pooling reintroduces manual lifetime management — a pooled buffer used after `Put` is the use-after-free bug class returning through the back door.

### Detecting off-heap growth on the JVM

```bash
# Start with: -XX:NativeMemoryTracking=summary
jcmd <pid> VM.native_memory summary   # categorizes native usage (Thread, Code, GC, Internal...)
pmap -x <pid> | sort -k3 -n | tail    # largest native mappings; spot direct buffers / mmap
```

When `VM.native_memory` shows "Internal" or "Other" ballooning while the heap is flat, you've confirmed an off-heap leak no `.hprof` would ever reveal.

---

## Pros & Cons

**Compacting (moving) collectors**
- Pro: eliminate external fragmentation; enable cheap bump-pointer allocation.
- Con: relocation cost; must update all references; can add pause time or write-barrier overhead.

**Non-compacting / manual allocators**
- Pro: no relocation cost; predictable addresses; simpler.
- Con: external fragmentation under mixed long-running workloads; RSS creep that looks like a leak.

**Arenas / pools**
- Pro: near-zero per-object cost; flatten churn; bulk release.
- Con: reintroduce lifetime/ownership bugs; an escaping reference is a leak or a corruption.

**Weak/soft references**
- Pro: let the GC reclaim despite a reference; dissolve whole leak classes.
- Con: nondeterministic eviction; subtle correctness bugs if code assumes presence.

---

## Use Cases

- **Long-running native/mixed services** where fragmentation dominates → choose a compacting collector or restructure allocation sizes; consider jemalloc/tcmalloc with tuned arenas.
- **JVM app servers with redeploy** → audit for classloader and thread leaks; treat redeploy as a leak test.
- **High-throughput data planes** (proxies, serializers) → churn is the enemy; pool, reuse buffers, avoid boxing, but guard pooled lifetimes.
- **Services using native libraries / direct buffers** → instrument native memory from day one; the heap view alone will mislead.

---

## Coding Patterns

- **Bounded-by-type:** caches are LRU/TTL types, queues have capacity, batches have limits — bounds enforced by the data structure, not the reviewer.
- **Single-owner + borrow:** one lifecycle owner per resource; everyone else holds a non-owning view; release is in the owner's `defer`/`finally`/`Drop`.
- **Weak back-edges:** observer lists, caches keyed on live objects, and parent pointers use weak references so they never anchor.
- **Scope-bound allocation:** request-scoped arenas/pools with a hard guarantee that nothing escapes the scope.
- **Native-accounting hooks:** every off-heap allocation path is wired to a metric so native growth is observable, not invisible.

---

## Best Practices

1. **Branch on the four causes early.** Don't open a heap dump until the RSS-vs-live + GC-log reading says the leak is actually *in the heap.*
2. **Make bounds structural.** Replace every raw map/list cache with a size/TTL-bounded type. Reviewer vigilance does not scale; types do.
3. **Treat allocation rate as an SLI.** Track bytes-allocated/sec and GC CPU%; a flat heap can still be a churn incident.
4. **Account for native memory explicitly.** Enable NMT/equivalent; export native usage to dashboards. The heap view is a blind spot by design.
5. **Encode lifetime in control flow.** RAII / `defer close` / try-with-resources / `Drop` make actual lifetime track intended lifetime automatically.
6. **Audit redeploys and pools as leak surfaces.** Classloader leaks and pooled-object misuse are senior-grade traps that pass casual review.
7. **Prefer compaction when fragmentation is the risk; prefer arenas when churn is the risk** — and know you can't have both for free.

---

## Edge Cases & Pitfalls

- **"It's a leak" when it's fragmentation.** Days lost heap-dumping a flat live set. If the dump is clean and RSS is high, suspect fragmentation or off-heap before re-reading the dump.
- **Pooling that becomes corruption.** A `sync.Pool` / object-pool buffer retained past return reintroduces use-after-free/aliasing. Pools trade GC pressure for manual lifetime risk — sometimes a bad trade.
- **Soft/weak caches with nondeterministic eviction** cause latency cliffs (mass eviction under pressure, then cold-start storms). Bounds you can't predict are bounds you can't capacity-plan.
- **Compaction isn't free and isn't always available.** Some collectors don't compact certain spaces (e.g., metaspace, large-object areas), so those regions still fragment.
- **Native leaks survive heap reset.** Forcing a full GC won't reclaim `mmap`/JNI memory whose wrappers are still reachable; you must release the native handle.
- **Arena escape is silent.** A pointer that outlives its arena is fine in tests and catastrophic under the right interleaving — invisible until production load.
- **Internal fragmentation has no smoking gun.** No single object is at fault; the *distribution* of sizes is. It only shows up as a persistent gap between live bytes and committed bytes.

---

## Summary

- "RSS is too high" has **four** systemic causes — **retention leak, fragmentation, off-heap growth, churn** — and the senior skill is cheaply distinguishing them before investing in a deep dive.
- **Fragmentation** (external and internal) is real free memory you can't use; it explains RSS creep with a *flat live set* and is the central tension between **compacting and non-compacting** allocators/collectors.
- **Off-heap leaks** are the heap dump's blind spot: direct buffers, JNI/cgo, `mmap`. When the heap is clean but RSS climbs, switch to native accounting instead of re-reading the dump.
- Most memory bugs are **lifetime and ownership bugs**: actual lifetime drifting from intended lifetime. Engineer ownership (single-owner + borrow), structural bounds (typed caches/queues), weak back-edges, and scope-bound allocation so the bugs become *impossible*, not just fixable.
- **Churn** is a memory-shaped latency bug; treat allocation rate as an SLI and flatten it with pooling — while respecting that pooling drags manual-lifetime risk back in.
