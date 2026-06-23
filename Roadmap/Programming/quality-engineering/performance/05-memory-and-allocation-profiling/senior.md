# Memory and Allocation Optimization — Senior Level

> **Roadmap:** [Performance](../README.md) → Memory and Allocation Optimization
> *The middle page taught you to read a heap profile and cut allocations. This page is about why allocation costs what it costs: the size-class machinery inside the allocator, the write barriers and pacing logic inside the garbage collector, and the moment a per-object `malloc` should become an arena. Profiler tooling — pprof, heaptrack, async-profiler — lives next door in [01-profiling](../01-profiling/); here we use the numbers those tools give you to reshape how memory actually flows.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [How a Modern Allocator Works — Size Classes and Thread Caches](#how-a-modern-allocator-works--size-classes-and-thread-caches)
4. [Fragmentation, Working Set, and Why RSS Lies](#fragmentation-working-set-and-why-rss-lies)
5. [GC Algorithms and the Three-Way Trade-off](#gc-algorithms-and-the-three-way-trade-off)
6. [The Go GC — Pacer, Write Barriers, and GOMEMLIMIT](#the-go-gc--pacer-write-barriers-and-gomemlimit)
7. [The JVM Collectors — G1, ZGC, Shenandoah, and Off-Heap](#the-jvm-collectors--g1-zgc-shenandoah-and-off-heap)
8. [Custom Allocation — Arenas, Slabs, Free Lists, and Pools at Scale](#custom-allocation--arenas-slabs-free-lists-and-pools-at-scale)
9. [Data-Structure Memory Efficiency — Layout, SoA, and Interning](#data-structure-memory-efficiency--layout-soa-and-interning)
10. [Off-Heap and mmap for Huge Datasets](#off-heap-and-mmap-for-huge-datasets)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The allocator and GC internals a senior reasons about when memory — not CPU — is what sets the ceiling on latency, density, or cost.**

By the middle level you can profile a heap, find the hot allocation site, hoist a slice out of a loop, and reuse a buffer. That fixes the obvious leaks and the obvious bloat. The senior jump is different: you now treat the *allocator* and the *garbage collector* as systems with internals you can model and tune, not black boxes you allocate against.

Why that matters: the cost of `malloc(48)` is not "a function call." It is, in the fast path, a pop from a per-thread free list — a handful of instructions — and in the slow path a trip through a central cache, a page-level allocator, and possibly the kernel's `mmap`. The cost of `new byte[1<<20]` in Java is an allocation-rate contribution that the GC must eventually scan, copy, or reclaim, paid back as pause time or throughput loss somewhere you can't see at the call site. Until you understand size classes, thread caches, generational hypotheses, write barriers, and GC pacing, you are tuning by superstition.

This page is that machinery — for Go, the JVM, Rust, and C++ — with the numbers and the levers. The goal is to be able to look at "RSS is 4 GB but the live heap is 900 MB" and know *which* of fragmentation, retained-but-unreturned pages, off-heap mappings, or a too-loose GC target is responsible, and what to do about each.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — escape analysis, stack vs heap, reading a heap/allocation profile, eliminating allocations in hot paths.
- **Required:** You can read a [memory profile](../01-profiling/02-memory-profiling/) and an [allocation profile](../01-profiling/03-allocation-profiling/) and distinguish *in-use* (live) from *alloc* (cumulative) views.
- **Helpful:** A working model of virtual memory — pages, page faults, `mmap`/`munmap`/`madvise`, RSS vs virtual size, and that the OS reclaims memory in *pages*, not bytes.
- **Helpful:** You've felt a GC pause in production, or watched a service's RSS climb and not come back, and wanted to know exactly why.

---

## How a Modern Allocator Works — Size Classes and Thread Caches

A general-purpose allocator (tcmalloc, jemalloc, Go's runtime allocator, glibc's ptmalloc) faces three pressures at once: it must be **fast** (the fast path runs on every allocation), **scalable** (many threads allocating concurrently must not serialize on one lock), and **space-efficient** (low fragmentation). Every modern design resolves these with the same two ideas: **size classes** and **per-thread caches**.

**Size classes.** Instead of satisfying an arbitrary request size exactly, the allocator rounds up to one of a fixed set of sizes — Go uses ~68 classes (8, 16, 24, 32, 48, 64, 80, 96, 112, 128, … up to 32 KB); tcmalloc and jemalloc use similar geometrically-spaced ladders. A request for 50 bytes is served from the 64-byte class. This turns allocation into "find the right class, pop a fixed-size object off that class's free list" — O(1), no first-fit search, no coalescing on the fast path. The cost is **internal fragmentation**: those 14 wasted bytes per 50-byte object. Class spacing is the explicit knob trading wasted space against the number of classes; jemalloc's default wastes at most ~20% within a size class.

**Per-thread / per-CPU caches.** The fast path must not take a global lock. So each thread (Go: each P, via `mcache`) keeps a small private cache of free objects per size class:

```
Go's allocator tiers (small objects, <32 KB):
  mcache   per-P, lock-free   pop a free object of the right size class      ← fast path
  mcentral per-size-class     refill an mcache's class from a shared span    ← contended, locked
  mheap    global             carve spans (runs of 8 KB pages) from the OS   ← slow path, may mmap
```

tcmalloc and jemalloc mirror this: tcmalloc has a per-thread cache → central free list → page heap; jemalloc has per-thread caches (`tcache`) in front of multiple **arenas** (independent heaps, by default one per few CPUs) precisely so threads assigned to different arenas never contend. Large objects (Go: ≥32 KB) skip the cache tiers and go straight to the page-level heap.

```bash
# See which allocator a process actually uses (glibc malloc? jemalloc? tcmalloc?)
LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2 ./app   # swap in jemalloc, no recompile
MALLOC_CONF=stats_print:true ./app                            # jemalloc: dump arena/bin stats at exit
```

> **Key insight:** Allocation is cheap *because* of the cache tiers and expensive *when you fall through them*. A tight loop allocating same-size objects stays in the lock-free per-thread cache and costs a few instructions each. The same loop under thread-cache exhaustion, or allocating sizes that miss the cached classes, drops to the contended central path. Allocation-cost spikes are usually "I fell out of the fast path," not "allocation got slower."

---

## Fragmentation, Working Set, and Why RSS Lies

Two processes with identical *live* heaps can have wildly different memory footprints. The gap is fragmentation plus retention policy.

**Internal fragmentation** is waste *inside* an allocated block — the 14 bytes lost rounding 50 up to the 64-byte class, or struct padding. It is bounded and predictable (size-class spacing caps it at ~10–25%).

**External fragmentation** is free memory that exists but is *unusable* because it is scattered in pieces too small (or too oddly placed) to satisfy a request. A heap with 500 MB free in 8-byte holes cannot serve a 4 KB request without going to the OS for more. Size-class allocators largely defeat external fragmentation *within* a class (every object in a span is interchangeable) but suffer it *across* spans: a span dedicated to the 64-byte class with one live object pins all 8 KB even though 127 slots are free. This is **span-level retention**, the dominant fragmentation mode in tcmalloc/jemalloc/Go.

**RSS vs live heap.** Resident set size (RSS) is what the OS thinks you're using — pages that are mapped and resident. Your live heap is what your program is actually keeping alive. These diverge for three independent reasons:

1. **Fragmentation** — spans/pages held for a few live objects each.
2. **Retention policy** — after a GC frees objects, the runtime may not return the pages to the OS immediately (returning them costs syscalls and re-faulting on reuse). Go uses `madvise(MADV_FREE)` (lazy: the page stays in RSS until the kernel needs it) by default on Linux; `MADV_DONTNEED` (eager: drops it from RSS now) under `GODEBUG=madvdontneed=1`. This is why a Go service's RSS can stay high long after a load spike even though the heap shrank.
3. **Off-heap mappings** — `mmap`'d files, off-heap buffers, thread stacks, JIT code caches, metaspace — none of which appear in a *heap* profiler but all of which are in RSS.

```bash
# The diagnostic question is always: heap or non-heap?
cat /proc/$PID/smaps_rollup     # RSS broken down: anon vs file-backed, shared vs private
jcmd $PID GC.heap_info          # JVM: live heap, separate from RSS
GODEBUG=gctrace=1 ./app         # Go: HeapInuse/HeapReleased vs process RSS
```

> **Key insight:** "Memory is high" is not a diagnosis. *Live heap high* means a leak or genuine bloat — chase it with a heap profiler. *RSS high but live heap low* means fragmentation or unreturned pages — chase it with `smaps`, allocator stats, and retention settings. They have opposite fixes; conflating them sends you optimizing the wrong layer.

---

## GC Algorithms and the Three-Way Trade-off

Every tracing garbage collector is a point in a space bounded by three quantities that cannot all be maximized at once:

```
        throughput  (fraction of CPU doing your work, not collecting)
            /\
           /  \
          /    \
   pause /------\ footprint
   time          (how much extra heap you keep to amortize collection)
```

- **Throughput** ↑ by collecting *less often* (bigger heap, more headroom) and *in bulk* (stop-the-world). Pays in pause time and footprint.
- **Pause time** ↓ by doing GC work *concurrently* with the application and *incrementally*. Pays in throughput (write barriers, coordination overhead) and often footprint (you collect before the heap is full).
- **Footprint** ↓ by collecting *eagerly* at a low heap target. Pays in throughput (more frequent collections) — this is the **allocation-rate / pause / heap-size** triangle in another guise.

The core algorithm families:

| Family | Idea | Trade-off |
|---|---|---|
| **Mark-sweep** | Mark reachable from roots, sweep the rest into free lists | Simple; no compaction → fragmentation; sweep is O(heap) |
| **Mark-compact** | Mark, then slide live objects together | Defeats fragmentation; compaction is expensive, usually STW |
| **Copying / semispace** | Copy live objects to a fresh space, abandon the old | Fast allocation (bump pointer), self-compacting; needs 2× space |
| **Generational** | Collect the *young* generation often, *old* rarely | Exploits the weak generational hypothesis; needs a write barrier |

**The generational hypothesis** — *most objects die young* — is the single most exploited fact in GC design. If 90%+ of objects become garbage almost immediately, then collecting a small young generation frequently reclaims most garbage for a small fraction of the cost of scanning the whole heap. The price: when an *old* object points to a *young* one, the young collection must know about it without scanning the old generation — so every pointer write is intercepted by a **write barrier** that records cross-generational references (in a card table or remembered set). This is why generational GCs make every reference store slightly more expensive: it's the toll for cheap young collections.

**Concurrent vs stop-the-world.** A STW collector freezes all application threads while it works — simple and high-throughput, but the pause scales with heap size (a 50 GB STW heap can pause for seconds). A *concurrent* collector does marking (and, in the best designs, compaction) while the application runs. The hard part is **mutation during marking**: if the app rewrites pointers while the collector is tracing, the collector can miss a live object. This is solved by write (and sometimes read) barriers that maintain a tricolor invariant — the same barrier machinery, now serving concurrency instead of (or as well as) generations.

> **Key insight:** There is no "best" GC, only a best point on the triangle *for your workload*. A batch job wants throughput (big heap, STW is fine). A latency-SLO service wants bounded pauses (concurrent, pay throughput). A high-density multi-tenant box wants footprint (eager, small target). Choosing or tuning a collector is choosing which corner to sacrifice.

---

## The Go GC — Pacer, Write Barriers, and GOMEMLIMIT

Go's collector is a **concurrent, non-generational, non-moving, tricolor mark-sweep**. Two of those words surprise people: *non-generational* (Go bets that escape analysis + cheap stack allocation already keep most short-lived objects off the heap, so the generational win is smaller than in Java) and *non-moving* (objects never relocate, which keeps interior pointers and cgo-shared memory valid but means Go relies on size-class spans rather than compaction to manage fragmentation).

**Tricolor marking with a write barrier.** Objects are white (unvisited), grey (visited, children pending), black (done). The invariant: *no black object may point to a white object* without the collector knowing. Because the app mutates pointers during concurrent marking, Go inserts a **hybrid write barrier** (Yuasa-style deletion + Dijkstra-style insertion, since Go 1.8) on pointer writes during a GC cycle. The barrier shades the relevant objects grey so nothing live is missed — and crucially it lets Go avoid a STW stack re-scan, keeping pauses sub-millisecond. The barrier is *off* outside a GC cycle, so it costs nothing when not collecting.

**The pacer.** The central tuning question is *when to start* a concurrent cycle so it finishes just before the heap would otherwise overflow the target — start too early and you collect too often (throughput loss); too late and the heap blows past the target before the cycle ends. `GOGC` (default 100) sets the target: heap may grow to `live × (1 + GOGC/100)` before the next cycle's goal. `GOGC=100` means "collect when the heap doubles relative to the live set after the last GC." `GOGC=200` collects half as often (more throughput, more footprint); `GOGC=50` twice as often (less footprint, more CPU).

```bash
GODEBUG=gctrace=1 ./app
# gc 42 @8.1s 1%: 0.018+1.2+0.004 ms clock, ...  4->5->2 MB, 5 MB goal, 8 P
#   1%         = fraction of CPU spent in GC since start
#   0.018+1.2+0.004 = STW-start + concurrent-mark + STW-end (ms) — note the tiny STW parts
#   4->5->2 MB = heap at start -> peak -> live after; "5 MB goal" = the pacer's target
```

**GOMEMLIMIT** (Go 1.19) is the most important addition in years. `GOGC` alone is a *ratio* — it can't bound absolute memory, so a workload that grows its live set grows RSS unboundedly and gets OOM-killed in a container. `GOMEMLIMIT` sets a **soft total-memory limit**: as the heap approaches it, the pacer collects more aggressively (effectively raising the GC frequency beyond what GOGC asked) to stay under the cap, trading CPU for survival. The idiomatic container config is `GOGC=off`-style behavior bounded by a limit:

```bash
GOMEMLIMIT=900MiB ./app        # soft cap ~90% of a 1Gi container; GC ramps up near it
# Pair with: set GOMEMLIMIT to (container limit − headroom for off-heap/stacks/CGO),
# and keep GOGC at default so steady state stays efficient and the limit is only a backstop.
```

> **Key insight:** Go's GC has essentially one tuning surface — heap *headroom*. `GOGC` sets it as a ratio (throughput vs footprint), `GOMEMLIMIT` sets it as an absolute backstop (survival vs CPU). You do not tune pauses directly because they're already tiny by design; you tune *how much memory you spend to keep them tiny*, and `GOMEMLIMIT` is how you stop that spend from getting you OOM-killed.

---

## The JVM Collectors — G1, ZGC, Shenandoah, and Off-Heap

The JVM ships several collectors precisely because the triangle has no universal answer; you pick by SLO.

**G1 (Garbage-First, default since JDK 9).** Region-based (the heap is split into ~2048 equal regions), generational, mostly-concurrent marking with **STW evacuation** (it copies live objects out of selected regions to compact them). G1 targets a *pause-time goal* (`-XX:MaxGCPauseMillis=200`) and picks how many regions to collect per pause to meet it — hence "garbage-first": it collects the regions with the most garbage for the best reclaim-per-pause. Pauses are bounded but real (typically tens to low-hundreds of ms) and *do* grow with live-set size because evacuation is STW.

**ZGC and Shenandoah (low-latency, concurrent compaction).** Both push pause time toward *constant, sub-millisecond, independent of heap size* — ZGC advertises pauses under ~1 ms on heaps from a few GB to terabytes. They achieve this by doing **concurrent compaction**: relocating objects while the application runs. The enabling trick is a **load (read) barrier** plus **colored pointers** (ZGC) or **Brooks forwarding pointers** (classic Shenandoah): when the app dereferences a reference to an object mid-relocation, the barrier transparently fixes up the pointer to the object's new location. The cost is throughput — read barriers run on loads, which are far more frequent than stores — and footprint (they need headroom to relocate into). ZGC is generational since JDK 21, which recovers much of the throughput gap.

```
              pause time        throughput        heap size scaling
G1            tens–100s ms      high              pause grows with live set
Shenandoah    < ~10 ms          medium            pause ~flat
ZGC           < ~1 ms           medium (better w/ gen)  pause flat to TB heaps
```

```bash
java -XX:+UseG1GC        -XX:MaxGCPauseMillis=200 -Xmx8g -Xlog:gc*:file=gc.log MyApp
java -XX:+UseZGC         -XX:+ZGenerational       -Xmx32g -Xlog:gc* MyApp
java -XX:+UseShenandoahGC -Xmx16g -Xlog:gc* MyApp
```

**Off-heap on the JVM.** When even a low-pause collector can't keep up — multi-hundred-GB caches, or data you don't want the GC to scan at all — the move is to take memory *out of the managed heap*. `ByteBuffer.allocateDirect` and the newer `java.lang.foreign` (Foreign Function & Memory API, JDK 22) allocate native memory the GC never traces; the object stays alive only as a small on-heap handle. This is how Cassandra, Kafka's page-cache reliance, Netty's pooled `ByteBuf`s, and off-heap caches (Ehcache/Chronicle) keep enormous datasets resident without imposing GC scan cost. The trade: you now manage lifetime manually (or via the FFM `Arena` scope), reintroducing the exact use-after-free and leak risks the GC existed to prevent.

> **Key insight:** On the JVM the collector choice *is* the latency decision: G1 for "low-effort, good-enough pauses with high throughput," ZGC/Shenandoah for "pauses must stay flat as the heap grows." And when the answer is "this data should not be GC-managed at all," off-heap is the escape hatch — paying manual-memory risk to buy GC-invisible footprint.

---

## Custom Allocation — Arenas, Slabs, Free Lists, and Pools at Scale

General-purpose allocators are general because they don't know your lifetimes. When you *do* know them, a custom strategy can beat malloc by an order of magnitude — but each has a precise sweet spot, and outside it they're a liability.

**Arena / region allocation.** Allocate from a large contiguous block by bumping a pointer; *free everything at once* by resetting the pointer. Per-object allocation is a pointer add and bounds check (a few instructions, zero metadata, zero fragmentation); per-object free does not exist. The catch: you cannot free individual objects. This is perfect for **phase-scoped** lifetimes — everything allocated during one request, one compiler pass, one frame — where the whole batch dies together.

```rust
// Rust: bumpalo arena — allocate many short-lived nodes, drop the whole arena at once
let arena = bumpalo::Bump::new();
let node = arena.alloc(Node { value: 42, next: None });   // pointer bump, no per-object free
// ... build a whole graph in the arena ...
drop(arena);                                              // frees everything in one shot
```

Rust makes arenas especially attractive because it has *no GC* — lifetimes are explicit, so an arena's "free everything at scope end" maps cleanly onto ownership. C++ does the same with monotonic buffer resources (`std::pmr::monotonic_buffer_resource`).

**Slab allocation.** Pre-carve a block into fixed-size slots for *one* type, with a free list of slots. Allocation/free is push/pop on the free list — O(1), no fragmentation (every slot is identical), and excellent cache locality (objects of the same type packed together). This is the Linux kernel's `kmem_cache` and the model behind most object pools. Sweet spot: **many objects of one type, allocated and freed individually at high frequency** (inodes, network buffers, connection structs).

**Free lists** are the primitive underneath both — a singly-linked list of reclaimed blocks, threaded through the free blocks themselves (no extra storage). They turn allocation into a list pop.

**Object pools at scale.** Reuse expensive-to-construct objects instead of reallocating. Go's `sync.Pool` is the canonical case — a per-P cache of reusable objects that the GC may drain between cycles:

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func handle(w io.Writer, r io.Reader) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()                 // MUST reset — pooled objects carry old state
    defer bufPool.Put(buf)
    // ... use buf without allocating ...
}
```

Pools pay off only when (a) construction is genuinely expensive *or* (b) the allocation rate is high enough that you're pressuring the GC. They have real failure modes: a pool of *variable-size* buffers can retain the largest buffer ever seen forever (memory bloat), and a pooled object handed out without a reset is a correctness bug that leaks data across requests.

> **Key insight:** Custom allocators trade generality for a lifetime assumption. Arenas assume *batch death* (free all at once); slabs/pools assume *uniform type, individual reuse*. The win is real — arenas turn N frees into 1, pools turn allocation into a list pop and drop GC pressure — but only when your lifetimes actually match the assumption. Reach for them when a profiler shows allocation/GC dominating *and* the lifetimes are regular; otherwise the bookkeeping and the bloat/UAF risk cost more than the default allocator.

---

## Data-Structure Memory Efficiency — Layout, SoA, and Interning

How much memory a structure uses, and how fast it is to traverse, is often decided by *layout*, not by the algorithm.

**Struct padding and alignment.** The compiler inserts padding so each field meets its alignment requirement, and rounds the struct up to its largest field's alignment. Field *order* therefore changes size:

```go
type Bad  struct { a bool; b int64; c bool }   // 1 + 7pad + 8 + 1 + 7pad = 24 bytes
type Good struct { b int64; a bool; c bool }   // 8 + 1 + 1 + 6pad     = 16 bytes
// 33% smaller, same fields — order largest-to-smallest to minimize padding.
```

At scale this compounds: 24 vs 16 bytes across 100M records is 800 MB vs 1.6 GB, and the smaller layout fits more records per cache line. Tools: Go `fieldalignment` (in `go vet`), Rust `#[repr(C)]` + manual ordering, C `pahole` (shows holes in any struct).

**Array of Structs vs Struct of Arrays (AoS vs SoA).** AoS stores records contiguously (`[]Point{{x,y,z}, ...}`); SoA stores each field in its own array (`xs []float64; ys []float64; zs []float64`). When you process *one field across all records* (sum all `x`s, filter by one column), SoA is dramatically faster: it brings only the needed field into cache (no wasted bytes on `y`/`z`) and lets the CPU vectorize. This is the entire premise of **columnar** storage (Arrow, Parquet, ClickHouse, vectorized query engines) — column-at-a-time scans with SIMD over dense, same-type runs. AoS wins when you touch *whole records* (random access to one object's all fields).

**Interning and compression.** When a value space is small but repeated billions of times, store each distinct value once. **String interning** replaces N copies of `"us-east-1"` with one shared instance referenced by index — turning a string column into a dictionary + small integer codes (dictionary encoding, again a columnar staple). For numeric columns, delta/run-length/bit-packing encodings shrink memory and improve scan speed because more values fit per cache line. The general principle: *the cheapest byte is the one you never store* — exploit redundancy in the data's value distribution, not just its allocation pattern.

> **Key insight:** Memory efficiency is mostly layout and redundancy, decided before the first allocation. Reorder fields to kill padding; choose SoA/columnar when access is field-at-a-time; intern and encode when the value distribution is skewed. These change the *constant factor* on every record, which at scale beats almost any allocator tweak.

---

## Off-Heap and mmap for Huge Datasets

When a dataset is larger than you want resident — or larger than RAM — the answer is to stop treating it as heap objects and let the OS page it for you.

**`mmap` for huge read-mostly datasets.** Mapping a file into the address space makes the OS page cache your memory manager: pages fault in on first touch, and the kernel evicts cold pages under pressure (file-backed clean pages cost nothing to evict — no swap write). You can map a 200 GB index into a process with 16 GB of RAM and touch it as if it were an array; only the hot pages stay resident. This is how LMDB, many search indexes, and memory-mapped model weights work. The cost is that access patterns now matter enormously — a random walk over a memory-mapped dataset is a storm of page faults, and the OS, not you, decides what stays.

```c
int fd = open("index.dat", O_RDONLY);
void *p = mmap(NULL, len, PROT_READ, MAP_PRIVATE, fd, 0);
madvise(p, len, MADV_RANDOM);     // tell the kernel: don't readahead, access is random
// ... treat p as an array; pages fault in lazily, evict under pressure ...
```

**Off-heap for GC avoidance.** In managed runtimes, the second reason to go off-heap is to hide data from the collector entirely. A 100 GB on-heap cache forces the GC to scan 100 GB of pointers every cycle, even if nothing changes; moving it off-heap (direct `ByteBuffer`s, the FFM API, or a serialized blob in `mmap`'d memory) makes it *GC-invisible* — the collector sees one handle, not a billion entries. The trade is the one custom allocation always makes: you reclaim manual-memory risk in exchange for not paying GC scan cost.

**Measuring it all.** None of this off-heap memory shows up in a *heap* profiler — which is exactly why "the heap profile says 900 MB but the process is using 8 GB" is the signature of an off-heap-heavy program. The accounting must come from the OS:

```bash
cat /proc/$PID/smaps_rollup        # Rss, Pss; file-backed (mmap) vs anon (heap/off-heap)
pmap -x $PID                        # per-mapping RSS — find the big mmap'd files
GODEBUG=gctrace=1 ./app | ...       # Go: compare HeapInuse to process RSS
jcmd $PID VM.native_memory summary  # JVM NMT: heap vs metaspace vs direct vs thread stacks
```

> **Key insight:** Past a certain size, the OS is a better memory manager than your allocator or GC, and `mmap` is how you delegate to it. The decision point: data too big for RAM, or too big to let the GC scan → push it off-heap / `mmap` it, accept that access patterns and manual lifetime now dominate, and *measure footprint from the OS*, because no heap profiler will ever see it.

---

## Mental Models

- **Allocation is a cache hierarchy, not a function.** Per-thread cache (fast, lock-free) → central cache (locked) → page heap → OS. Cheap allocations stay in the top tier; cost spikes mean you fell through. Tune to keep the hot path in the per-thread cache.

- **RSS = live heap + fragmentation + unreturned pages + off-heap.** Four independent terms with four different fixes. "Memory is high" is never a diagnosis until you've attributed it to one of them.

- **Every GC sits on a three-way trade-off.** Throughput, pause, footprint — pick two to favor, sacrifice the third. The collector and its flags are how you choose your corner; there is no universal best.

- **The generational hypothesis buys cheap collection with a write barrier.** "Most objects die young" lets you collect a small young generation often — but every pointer store now pays a small tax to track cross-generation references. Concurrent collectors pay the analogous tax to track mutation during marking.

- **Custom allocators trade generality for a lifetime assumption.** Arenas assume batch death; slabs/pools assume uniform type with individual reuse. The win is real only when your lifetimes actually match the assumption.

- **The cheapest byte is the one you never store.** Layout (kill padding), access pattern (SoA/columnar), and redundancy (interning, encoding) change the constant factor on every record — which at scale beats allocator micro-tuning.

---

## Common Mistakes

1. **Treating RSS and live heap as the same number.** They diverge via fragmentation, unreturned pages, and off-heap mappings. A heap profiler explains live heap only; for the rest you need `smaps`, allocator stats, and NMT/gctrace. Conflating them sends you optimizing the wrong layer.

2. **Tuning `GOGC` to fight OOM-kills in a container.** `GOGC` is a *ratio* and can't bound absolute memory — a growing live set still blows the limit. Use **`GOMEMLIMIT`** as the absolute backstop and leave `GOGC` at default for steady-state efficiency.

3. **Reaching for `sync.Pool` (or any pool) without a profile showing allocation/GC pressure.** Pools add reset-bug and bloat risk (a variable-size pool retains the largest object forever). They pay off only when construction is expensive or allocation rate is genuinely pressuring the GC.

4. **Picking a low-pause collector (ZGC/Shenandoah) for a throughput batch job.** Their read/relocation barriers and headroom cost throughput you don't need to spend. Match the collector to the SLO: G1 or a throughput collector for batch; ZGC/Shenandoah only when pauses must stay flat as the heap grows.

5. **Using an arena where lifetimes aren't batch-scoped.** Arenas can't free individual objects; one long-lived object pins the whole arena. They fit phase-scoped lifetimes (request, pass, frame) and nothing else.

6. **Ignoring struct field order at scale.** Padding silently inflates per-record size 20–50%. Order fields largest-to-smallest (or run `fieldalignment` / `pahole`); across 100M records the difference is gigabytes.

7. **Profiling only the heap on an off-heap-heavy program.** Direct buffers, `mmap`, metaspace, thread stacks, and JIT caches are all in RSS and invisible to a heap profiler. When heap profile ≪ RSS, the memory is non-heap — measure it from the OS (`smaps`, `pmap`, NMT).

---

## Test Yourself

1. Walk a 50-byte allocation through a tcmalloc/Go-style allocator's tiers. Where is the fast path, and what makes it fast? When does it fall to a slower tier?
2. Distinguish internal from external fragmentation, and explain why a size-class allocator nearly eliminates one but can still suffer the other at the span level.
3. A service's live heap is 900 MB but RSS is 4 GB. Name three independent causes and the tool you'd use to attribute the gap to each.
4. State the three-way GC trade-off. For a latency-SLO service vs a nightly batch job, which corner does each sacrifice, and which collector fits?
5. Why does Go's GC need a write barrier, and why is it *off* outside a GC cycle? What does `GOMEMLIMIT` do that `GOGC` cannot?
6. When does an arena beat per-object `malloc`/`free`, and what lifetime assumption must hold? When does it actively hurt?
7. You have a 200 GB read-mostly index and 16 GB of RAM. How do you make it usable, and why won't a heap profiler tell you its footprint?

<details>
<summary>Answers</summary>

1. The request rounds up to the 64-byte size class. The **fast path** pops a free 64-byte object off the per-thread (Go: per-P `mcache`) free list for that class — lock-free, a few instructions, no search. It falls to the **central cache** (`mcentral`, locked) when the thread cache is empty and needs a refill, and to the **page heap** (`mheap`, possibly `mmap`) when no span of that class is available. Cost spikes are "fell out of the per-thread cache," not "allocation got slower."
2. **Internal** = waste inside an allocated block (rounding 50→64; struct padding) — bounded by size-class spacing (~10–25%). **External** = free memory unusable because it's scattered/oddly placed. Size classes nearly eliminate external fragmentation *within* a class (objects are interchangeable) but suffer **span-level retention** across classes: a span with one live 64-byte object pins all 8 KB even though 127 slots are free.
3. (a) **Fragmentation** — spans/pages held for few live objects → allocator stats (`MALLOC_CONF=stats_print`, jemalloc) / Go `HeapInuse` vs `HeapReleased`. (b) **Unreturned pages** — runtime kept freed pages (Go `MADV_FREE` lazily) → `gctrace`, `smaps_rollup`. (c) **Off-heap** — `mmap`, direct buffers, stacks, metaspace → `pmap -x`, `/proc/PID/smaps_rollup`, JVM NMT.
4. **Throughput vs pause vs footprint** — you favor two, sacrifice one. The **SLO service** sacrifices throughput to keep pauses bounded → concurrent collector (Go GC; JVM ZGC/Shenandoah, or G1 if tens of ms is acceptable). The **batch job** sacrifices pause time (STW is fine) to maximize throughput → a throughput/parallel collector or big-heap G1.
5. During concurrent marking the app mutates pointers; without a barrier the collector could miss a live object (a black object newly pointing to a white one). The **hybrid write barrier** shades objects to preserve the tricolor invariant. It's *off* outside a cycle because there's no marking to protect, so it costs nothing in steady state. **`GOMEMLIMIT`** sets an absolute soft memory cap and makes the pacer collect harder as you approach it; **`GOGC`** is only a *ratio* relative to the live set and cannot bound absolute memory.
6. An arena beats `malloc`/`free` when many objects share a **batch lifetime** (request, compiler pass, frame): per-object alloc is a pointer bump, and you free the whole batch with one pointer reset (N frees → 1), with zero fragmentation. It **hurts** when lifetimes are individual/long — you can't free one object, so any long-lived object pins the entire arena until reset.
7. **`mmap`** the file (`MAP_PRIVATE`, `PROT_READ`, `madvise(MADV_RANDOM)`): the OS page cache faults hot pages in and evicts cold clean pages for free, so only the working set stays resident in 16 GB. A *heap* profiler won't see it because the data is **file-backed off-heap** memory, not heap objects — measure footprint from the OS (`pmap -x`, `smaps_rollup`).

</details>

---

## Cheat Sheet

```
ALLOCATOR TIERS (Go / tcmalloc / jemalloc)
  per-thread cache   lock-free pop of a size-class object        ← fast path, a few instrs
  central cache      locked refill of a thread cache             ← contended
  page heap          carve spans/pages, may mmap from OS         ← slow path
  size classes       round up to fixed sizes → O(1) alloc, internal fragmentation
  swap allocator:    LD_PRELOAD=libjemalloc.so.2 ./app ; MALLOC_CONF=stats_print:true

RSS vs LIVE HEAP  (RSS = live + fragmentation + unreturned pages + off-heap)
  /proc/PID/smaps_rollup        Rss/Pss, anon (heap) vs file (mmap)
  pmap -x PID                   per-mapping RSS — find big mmaps
  Go:  GODEBUG=gctrace=1        HeapInuse / HeapReleased vs RSS
  JVM: jcmd PID VM.native_memory summary   heap vs metaspace vs direct vs stacks

GC TRADE-OFF TRIANGLE:  throughput  ↔  pause time  ↔  footprint  (favor 2, lose 1)

GO GC  (concurrent, non-generational, non-moving, tricolor mark-sweep)
  GOGC=100 (default)   collect when heap ~doubles vs live set (ratio: tput↔footprint)
  GOMEMLIMIT=900MiB    absolute soft cap; pacer ramps GC near it (survival↔CPU)
  hybrid write barrier on pointer stores DURING a cycle; off otherwise

JVM COLLECTORS                pause          throughput    heap scaling
  G1 (default)                tens–100s ms   high          pause grows w/ live set
  Shenandoah                  < ~10 ms       medium        flat
  ZGC (+ZGenerational)        < ~1 ms        medium+       flat to TB
  off-heap: ByteBuffer.allocateDirect / java.lang.foreign → GC-invisible

CUSTOM ALLOCATION (when profile shows alloc/GC dominates AND lifetimes are regular)
  arena/region   bump-pointer alloc, free-all-at-once   → batch lifetimes (req/pass/frame)
  slab           fixed-size slots, free-list push/pop   → many objects of one type
  object pool    reuse expensive objects (sync.Pool)    → MUST reset; watch size bloat

LAYOUT (constant-factor wins, decided before allocation)
  order struct fields large→small  (go vet fieldalignment / pahole)  kill padding
  SoA / columnar for field-at-a-time scans (cache + SIMD); AoS for whole-record access
  intern / dictionary-encode skewed value distributions
```

---

## Summary

- A modern allocator is a **cache hierarchy** — per-thread cache → central cache → page heap → OS — built on **size classes**. Allocation is cheap in the top tier and expensive when you fall through; cost spikes are usually "fell out of the fast path," not slower allocation.
- **RSS is not live heap.** It's live heap + **internal/external fragmentation** + **unreturned pages** (retention policy) + **off-heap** mappings. Each term has a different tool and a different fix; attribute before you optimize.
- Every tracing **GC** is a point on the **throughput / pause / footprint** triangle; the **generational hypothesis** buys cheap collection at the cost of a **write barrier**, and concurrent collectors pay an analogous barrier tax to relocate or mark while the app runs.
- **Go's GC** is concurrent, non-moving, tricolor mark-sweep with a hybrid write barrier and a pacer; you tune *heap headroom* via `GOGC` (ratio) and bound it absolutely with **`GOMEMLIMIT`** (the container-safety backstop). **JVM** collector choice *is* the latency decision — G1 for good-enough bounded pauses, ZGC/Shenandoah for flat sub-ms pauses via concurrent compaction, **off-heap** to escape GC scanning entirely.
- **Custom allocators** (arena, slab, pool) trade generality for a lifetime assumption and pay off when a profile shows allocation/GC dominating *and* lifetimes are regular. **Layout** (padding, SoA/columnar) and **redundancy** (interning, encoding) deliver constant-factor wins that beat allocator tweaks at scale. Past RAM size, **`mmap`** delegates memory management to the OS — and only the OS can measure its footprint.

You now reason about memory as allocator and GC *internals* with tunable levers, not as an opaque cost you allocate against. The next layer — [professional.md](professional.md) — is about operating these decisions in production: regression-gating allocation budgets, capacity-planning around GC, and diagnosing memory incidents under load.

---

## Further Reading

- *The Garbage Collection Handbook* — Jones, Hosking, Moss. The authoritative treatment of tracing, generational, and concurrent collection.
- [TCMalloc design documentation](https://google.github.io/tcmalloc/design.html) — size classes, per-thread/per-CPU caches, and the page heap, from the source.
- [The jemalloc paper and `MALLOC_CONF` man page](http://jemalloc.net/) — arenas, bins, and how to read its statistics.
- ["Getting to Go: The Journey of Go's Garbage Collector"](https://go.dev/blog/ismmkeynote) — the Go team on the pacer, the hybrid write barrier, and the non-generational bet.
- [ZGC and Shenandoah design docs](https://wiki.openjdk.org/display/zgc/Main) — colored pointers, load barriers, and concurrent compaction.
- *What Every Programmer Should Know About Memory* — Ulrich Drepper. Cache lines, alignment, and why layout dominates.

---

## Related Topics

- [junior.md](junior.md) — stack vs heap, what allocation is, and reading basic memory usage.
- [middle.md](middle.md) — escape analysis, eliminating allocations, reading heap/allocation profiles.
- [professional.md](professional.md) — operating memory decisions in production: budgets, capacity planning, incident diagnosis.
- [01-profiling › 02-memory-profiling](../01-profiling/02-memory-profiling/) — the tooling (pprof, heaptrack, async-profiler) that produces the heap profiles this page acts on.
- [06-concurrency-and-contention › senior.md](../06-concurrency-and-contention/senior.md) — why per-thread allocator caches matter under concurrency, and lock contention vs allocation contention.
