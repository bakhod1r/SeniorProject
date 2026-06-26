# Tracing Garbage Collection — Senior Level

> **Topic:** [Tracing Garbage Collection](README.md)
> **Focus:** Design trade-offs across real collectors — concurrent vs incremental vs stop-the-world, barriers, safepoints, precise vs conservative scanning, moving vs non-moving — and how Go, the HotSpot zoo, V8, and CPython make different choices for different goals.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [The Design Space](#the-design-space)
- [Mechanisms That Enable Concurrency](#mechanisms-that-enable-concurrency)
  - [Safepoints and Root Scanning](#safepoints-and-root-scanning)
  - [Write Barriers Revisited: SATB vs Incremental-Update](#write-barriers-revisited-satb-vs-incremental-update)
  - [Read / Load Barriers and Concurrent Compaction](#read--load-barriers-and-concurrent-compaction)
  - [Precise vs Conservative GC](#precise-vs-conservative-gc)
- [Real Collectors Compared](#real-collectors-compared)
- [Mental Models](#mental-models)
- [Pros & Cons of the Major Approaches](#pros--cons-of-the-major-approaches)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

There is no "best" garbage collector — only collectors that are tuned for different objectives. The senior-level skill is not memorizing one algorithm but understanding the **design space**: the small set of axes along which every collector positions itself, the mechanisms (safepoints, barriers) that let it sit where it does, and why a runtime team chose those positions. Once you can place Go, G1, ZGC, V8, and CPython on the same axes, you can predict how each behaves under your workload and read a new collector's design in minutes.

## Prerequisites

- Middle-tier algorithms: mark-sweep, mark-compact, copying, generational, the tri-color abstraction, write barriers, remembered sets.
- The mutator/collector framing: the mutator is your program; the collector is the GC. They contend for the heap.
- Basic awareness of CPU memory ordering (barriers must be correct under concurrency).

## Glossary

- **Mutator:** application threads that read/write the heap (they "mutate" the graph).
- **Stop-the-world (STW):** all mutator threads are paused while the collector works.
- **Concurrent GC:** the collector runs *simultaneously* with the mutator on separate threads.
- **Incremental GC:** the collector runs in small slices interleaved with the mutator on the *same* thread(s), bounding each pause.
- **Safepoint:** a point in execution where a thread's stack and registers are in a known, scannable state, so it can be paused for GC.
- **SATB (snapshot-at-the-beginning):** a deletion-barrier discipline that conceptually collects the heap as it existed when marking began.
- **Incremental-update:** an insertion-barrier discipline that tracks new pointers into already-scanned (black) objects.
- **Load / read barrier:** code on every pointer *load* that can heal, forward, or remap a reference — the enabler of concurrent *moving* collection.
- **Floating garbage:** objects that became unreachable *during* a concurrent cycle but survive it, collected only next time.
- **Precise (exact) GC:** the runtime knows exactly which words are pointers.
- **Conservative GC:** the runtime guesses; any word that *could* be a pointer is treated as one.

## The Design Space

Every tracing collector is a point in a space defined by a handful of axes. Choices on one axis constrain the others.

1. **Pause discipline: STW ↔ incremental ↔ concurrent.** How much does the mutator stop? STW is simplest and highest-throughput but has pauses proportional to heap size. Concurrent collectors trade throughput (barrier overhead, extra CPU) for short, heap-size-independent pauses.

2. **Moving ↔ non-moving.** Moving collectors (copying, compacting) defragment and enable bump allocation but must update every pointer and require precise scanning. Non-moving collectors keep addresses stable (great for C interop, conservative scanning) but fragment.

3. **Generational ↔ single-region.** Generational collectors win on throughput by exploiting infant mortality, but add write-barrier and remembered-set complexity. Some low-latency collectors deliberately skip generations to simplify (Go was non-generational; ZGC was, then added generations).

4. **Throughput ↔ latency objective.** Throughput collectors maximize useful work per CPU-second and tolerate longer, rarer pauses (batch jobs, analytics). Latency collectors minimize the longest pause and accept lower throughput and more memory (interactive services, trading).

5. **Precise ↔ conservative root/heap scanning.** Determines whether moving is even possible.

The fundamental tension: **you cannot simultaneously maximize throughput, minimize pause, and minimize memory.** This is the "GC impossible trinity" — pick two and pay on the third. Concurrent collectors buy low pauses with throughput *and* memory (headroom to allocate during the cycle). Throughput collectors buy speed with pauses.

## Mechanisms That Enable Concurrency

### Safepoints and Root Scanning

To scan a thread's roots (its stack and registers), the collector needs the thread stopped at a point where it can tell which values are live pointers. That point is a **safepoint** — the compiler emits stack maps describing pointer locations only at safepoints (loop back-edges, call sites, allocation points).

"Stop the world" really means "bring every thread to a safepoint." A thread spinning in a tight pointer-free loop with no safepoint poll can delay the whole STW — the dreaded **"time to safepoint" (TTSP)** problem, where the measured GC pause is small but threads took a long time to *reach* the pause. HotSpot, Go, and others insert safepoint polls to bound TTSP.

Even the most concurrent collectors keep at least one tiny STW phase for **root scanning** (or do it incrementally per-thread). Go's sub-millisecond pauses are essentially the cost of stopping threads, enabling/disabling the write barrier, and scanning roots; the bulk of marking is concurrent.

### Write Barriers Revisited: SATB vs Incremental-Update

Both barrier families preserve a tri-color invariant during concurrent marking, but they differ in *what they conserve* and therefore in their floating-garbage and termination behavior.

- **Incremental-update (Dijkstra insertion barrier):** shade the *new target* grey when a pointer is stored into a black object. Maintains the **strong** invariant (no black→white). It precisely tracks objects that *become* reachable, so it produces **less floating garbage**, but marking termination is trickier because the live set can grow during the cycle. Go uses a hybrid (Yuasa-style deletion barrier plus a Dijkstra-style insertion barrier) so it can avoid re-scanning stacks.

- **SATB / deletion barrier (Yuasa):** when a pointer is *overwritten*, shade the *old target* grey, preserving a logical **snapshot** of the graph at GC start. Anything live at the snapshot stays live for this cycle — even if the mutator drops it — so SATB produces **more floating garbage** but has clean, easy-to-prove termination. G1 and Shenandoah use SATB.

The choice is a real engineering trade: SATB simplifies termination and stack handling at the cost of retaining more transient garbage for one extra cycle; incremental-update is tighter but harder to terminate.

### Read / Load Barriers and Concurrent Compaction

Concurrent *marking* needs only a write barrier. Concurrent *moving* (compaction) is much harder: if the collector relocates an object while the mutator holds a pointer to its old address, that pointer is now dangling. STW moving collectors fix this during the pause; concurrent moving collectors cannot.

The solution is a **load barrier** (read barrier): code on every pointer load that checks whether the referent has moved and, if so, transparently **forwards** the reference to the new location (and often "self-heals" the slot it came from). This is the heart of **ZGC** and **Shenandoah**:

- **ZGC** uses **colored pointers** (load-value barrier / "load barrier"): metadata bits are stored *inside the pointer* (marked, remapped, etc.). On each load, a fast check tests those bits; if the pointer refers to a relocated object, the barrier remaps it. This lets ZGC compact concurrently with pauses that do not grow with heap size — sub-millisecond on terabyte heaps.
- **Shenandoah** historically used a **Brooks forwarding pointer** (an indirection word per object) and now uses a load-reference barrier to achieve the same concurrent evacuation.

The cost: load barriers tax *every pointer read*, which is far more frequent than writes — so concurrent-compacting collectors trade noticeable throughput for their flat, tiny pauses.

### Precise vs Conservative GC

- **Precise GC** knows, for every stack frame and object, exactly which words are pointers (via compiler-generated stack maps and type info). Required for any **moving** collector — you can only rewrite a word if you're certain it's a pointer. Go and HotSpot are precise.
- **Conservative GC** treats any word that *looks* like a valid heap pointer as one. Necessary when you can't get pointer maps — e.g., scanning a C stack, or in the Boehm-Demers-Weiser collector for C/C++. Downsides: (1) an integer that happens to equal a heap address pins a dead object alive ("false retention"), and (2) you can't move objects, because you might corrupt a non-pointer you mistook for a pointer. Conservative collectors are therefore non-moving and leak a little.

Many real runtimes are **partly conservative** (e.g., conservative on the stack, precise on the heap) as a pragmatic compromise.

## Real Collectors Compared

**Go — concurrent, non-generational, non-moving, tri-color mark-sweep.** Go optimizes hard for low latency and simplicity. It runs a concurrent tri-color marker with a hybrid write barrier; sweeping is concurrent/lazy. It is **non-moving** (so cgo pointers stay valid and scanning can be simpler) and, deliberately, **non-generational** — Go reduces allocation pressure via escape analysis and stack allocation instead. Pacing (the `GOGC` knob / `GOMEMLIMIT`) decides *when* to collect to hit a heap-growth target. Result: typical pauses well under a millisecond, at the cost of write-barrier throughput overhead and fragmentation risk on long-lived heaps. Trade-off it accepts: lower peak throughput than a generational compactor, no defragmentation.

**HotSpot (the JVM "zoo") — pick your trade-off:**
- **Serial** — single-threaded STW, generational copying (young) + mark-compact (old). For tiny heaps / containers.
- **Parallel (Throughput)** — multi-threaded STW, generational. Maximizes throughput; tolerates long pauses. Best for batch/analytics.
- **G1 (Garbage-First)** — region-based, generational, mostly-concurrent marking (SATB) with STW evacuation pauses; targets a *pause-time goal* by collecting the regions with the most garbage first. The default since JDK 9. Balanced latency/throughput for large heaps.
- **ZGC** — region-based, concurrent-compacting, colored-pointer load barriers; sub-millisecond pauses independent of heap size, scaling to multi-terabyte heaps. Now generational. Trades throughput and memory for latency.
- **Shenandoah** — concurrent-compacting via load-reference barriers; similar low-pause goals, different mechanism (no colored pointers historically).

The JVM's superpower is that one bytecode runs under any of these — you choose the collector to match your latency/throughput/memory budget without touching code.

**V8 (Orinoco) — generational, mostly-concurrent/parallel.** A copying **scavenger** for the young generation (semispace) and a concurrent/incremental **mark-compact** (Mark-Compact / major GC) for the old space, with concurrent marking and parallel/concurrent sweeping/compaction to keep main-thread pauses small in the browser and Node.

**CPython — reference counting + a cyclic tracing collector.** The primary mechanism is reference counting (immediate, deterministic-ish reclamation). A supplementary **generational tracing collector** runs only to break **reference cycles** that refcounting can't. This is the canonical "hybrid": refcount handles the common case; tracing handles cycles. (The GIL historically simplified the refcount updates; the free-threading work changes that calculus.)

## Mental Models

- **The impossible trinity.** Throughput, latency, memory — pick two. Every collector's identity is *which* corner of the triangle it sacrifices. Go and ZGC sacrifice throughput+memory for latency; Parallel GC sacrifices latency for throughput+memory.

- **Barriers are the price of concurrency.** A write barrier buys concurrent marking; a read/load barrier buys concurrent moving. The more concurrency you want, the more per-access tax you pay. STW collectors pay zero barrier tax but pay it all back in pause.

- **Safepoints are the leash.** Concurrency doesn't eliminate stopping the world; it shrinks the STW to "reach a safepoint, flip a switch, scan roots." Anything that delays reaching a safepoint (a JNI critical section, a long counted loop) reintroduces latency.

## Pros & Cons of the Major Approaches

| Approach | Pause | Throughput | Memory | Moves? | Example |
|---|---|---|---|---|---|
| STW parallel generational | High, heap-bound | **Best** | Moderate | Yes | HotSpot Parallel |
| Mostly-concurrent generational | Low-ish, bounded | Good | Higher | Partly (evac) | G1, V8 |
| Fully concurrent compacting | **Sub-ms, flat** | Lower (load barrier) | **Highest** (headroom) | Yes, concurrently | ZGC, Shenandoah |
| Concurrent non-moving mark-sweep | Sub-ms | Good | Moderate, fragments | No | Go |
| Refcount + cyclic tracing | Spread, can cascade | Moderate | Low | No | CPython |

## Use Cases

- **Latency-critical services (trading, ad-serving, interactive APIs):** Go, ZGC, or Shenandoah — flat sub-ms pauses matter more than peak throughput.
- **Batch / throughput jobs (Spark, ETL, compilers):** HotSpot Parallel — long rare pauses are fine; total CPU efficiency wins.
- **Huge heaps (hundreds of GB to TB):** ZGC — pauses independent of heap size are the only viable option.
- **General large server apps:** G1 — balanced default.
- **Scripting / glue with C extensions:** CPython's refcount+cycle hybrid; near-deterministic reclamation, predictable interop.

## Best Practices

- **Choose the collector to the SLO, not the fashion.** A p99.9 latency budget points to a concurrent collector; a cost-per-job budget points to a throughput collector.
- **Right-size headroom.** Concurrent collectors must finish a cycle before the heap fills; too little headroom causes allocation stalls or fallback STW. `GOGC`/`GOMEMLIMIT` (Go) and `-Xmx`/`MaxHeapFreeRatio` (JVM) govern this.
- **Mind time-to-safepoint.** Long counted loops, big array operations, and native critical sections can dominate "pause" even on a concurrent collector; insert safepoint-friendly structure.
- **Don't assume moving.** If your collector is non-moving (Go), expect possible fragmentation on long-lived, varied-size heaps; if it's moving, don't pin pointers across native boundaries carelessly.

## Edge Cases & Pitfalls

- **Floating garbage tuning:** SATB collectors retain transient garbage for a cycle; a workload that churns large short-lived objects mid-cycle inflates the live set estimate and may trigger early/extra collections.
- **Allocation outpacing the collector:** if the mutator allocates faster than a concurrent collector reclaims, you hit an **allocation stall** or a STW fallback ("concurrent mode failure" in old CMS terms, "GC assist" in Go where mutators are conscripted to help mark).
- **Conservative false retention:** in conservative collectors, large integer-heavy data can accidentally pin dead objects, looking like a leak.
- **TTSP cliffs:** a single thread stuck off-safepoint stalls *all* threads during STW root scan, turning an advertised sub-ms collector into a multi-ms outlier.
- **Premature promotion under bursty load** still bites generational collectors, pushing short-lived survivors into the expensive old generation.

## Summary

A garbage collector is a set of positions in a design space: **STW vs concurrent vs incremental**, **moving vs non-moving**, **generational vs not**, **throughput- vs latency-oriented**, **precise vs conservative** — bounded by the impossible trinity of throughput, latency, and memory. **Safepoints** make stopping/scanning possible; **write barriers** (SATB/deletion vs incremental-update/insertion) enable concurrent *marking*; **load barriers** (ZGC's colored pointers, Shenandoah's reference barrier) enable concurrent *compaction*. Real collectors instantiate different corners: **Go** picks concurrent, non-moving, non-generational, sub-ms; the **HotSpot zoo** lets you pick throughput (Parallel), balance (G1), or flat low latency on huge heaps (ZGC/Shenandoah); **V8** is generational mostly-concurrent; **CPython** is refcount plus a cyclic tracer. The senior skill is matching those positions to an SLO.
