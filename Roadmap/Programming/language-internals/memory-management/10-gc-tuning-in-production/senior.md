# GC Tuning in Production — Senior Level
> **Topic:** [GC Tuning in Production](README.md)
> **Focus:** Choosing a collector for a workload, the deep mechanics of concurrent compaction, and a disciplined diagnosis-then-tune workflow.

---

## Table of Contents
- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Collector Selection: A Decision Framework](#collector-selection-a-decision-framework)
- [Inside Concurrent Compaction](#inside-concurrent-compaction)
- [The Diagnosis-Then-Tune Workflow](#the-diagnosis-then-tune-workflow)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons of the Major Collectors](#pros--cons-of-the-major-collectors)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

By now you can read a GC log and turn the knobs. The senior question is harder and more consequential: **which collector should this service run, and how do I prove it?** This is where the triangle stops being a diagram and becomes a budget you allocate against an SLO.

Collector choice is the single highest-leverage GC decision, because it determines the *shape* of your trade-off — and it's mostly a one-line flag. A trading engine and a nightly ETL job have opposite needs; running G1 on both is a missed opportunity in both directions. This tier gives you a defensible framework for the choice, the mechanics behind why low-pause collectors cost throughput, and a workflow that prevents the most common senior mistake: tuning before measuring.

## Prerequisites

- Middle tier: heap sizing, generations, `GOGC`/`GOMEMLIMIT`, reading GC logs, the frequency-vs-cost trade.
- Familiarity with the idea of a **write/read barrier** (compiler-inserted bookkeeping around pointer access).
- Comfort with percentiles and the concept of an **SLO** (a target like "p99 < 50 ms").

## Glossary

- **Concurrent compaction** — relocating live objects to defragment the heap *while the application runs*. The hard problem ZGC and Shenandoah solve.
- **Colored / load barrier (ZGC)** — metadata stored in unused high bits of a pointer plus a tiny check on every pointer *load*; lets the GC relocate objects and fix references lazily.
- **Brooks pointer / forwarding pointer (Shenandoah)** — an extra indirection word per object pointing to its current location, so the app always reaches the up-to-date copy.
- **Evacuation** — copying live objects out of a region so the region can be reclaimed wholesale.
- **Floating garbage** — objects that became dead *during* a concurrent cycle but won't be reclaimed until the next one; the price of concurrency.
- **Allocation stall (ZGC)** — when allocation outruns the concurrent collector and a thread must wait; the failure mode of concurrent collectors.
- **IHOP (`InitiatingHeapOccupancyPercent`)** — the old-gen occupancy at which G1 starts a concurrent marking cycle.
- **Promotion failure / evacuation failure** — no room to promote/evacuate survivors, forcing a fallback Full GC. The G1 nightmare.

## Collector Selection: A Decision Framework

Pick by **workload shape**, not by hype. Ask three questions: *What is my latency SLO? How big is my heap? How much throughput/CPU am I willing to spend?*

| Collector | Heap sweet spot | Pause profile | Throughput | Use when |
|---|---|---|---|---|
| **Serial** | < ~100 MB | Long, single-threaded | Fine for tiny heaps | Tiny containers, CLI tools, single-vCPU pods |
| **Parallel** | Any | Long STW, but rare | **Highest** | Batch/ETL, offline jobs, where throughput is king and pauses don't matter |
| **G1** | ~1–32 GB | Tunable goal (tens–low-hundreds ms) | High | The **balanced default** for most services; mixed latency/throughput needs |
| **ZGC** | ~Multi-GB to **terabytes** | **< 1 ms**, heap-size-independent | ~10–15% below G1 | Large heaps + strict tail-latency SLOs; pauses must not scale with heap |
| **Shenandoah** | Large | **< 1–10 ms** | Slightly below G1 | Same niche as ZGC; available on more JDK distributions/versions |
| **Go runtime** | Any | **Sub-ms** by design | Trades CPU/memory for it | Anything in Go — you don't choose, you tune `GOGC`/`GOMEMLIMIT` |

**The decision tree in prose:**

1. **Is this a batch job where total wall-clock time matters and pauses don't?** → **Parallel GC**. It will finish fastest. Don't pay for concurrency you don't need.
2. **Is this a latency-sensitive service with a heap under ~16–32 GB and an SLO in the tens of milliseconds?** → **G1** with a `MaxGCPauseMillis` goal. It's the default for good reason: balanced, well-understood, predictable.
3. **Is your heap huge (tens of GB to TB) and/or your tail SLO sub-10ms — and full GC pauses scaling with heap size are unacceptable?** → **ZGC** (or **Shenandoah** if your JDK distribution favors it). Their headline property: **pause time is independent of heap size and live-set size.** A 4 GB heap and a 4 TB heap pause for the same sub-millisecond window.
4. **Are you on Go?** You don't pick a collector — Go ships one concurrent low-latency collector and you shape it with `GOGC`/`GOMEMLIMIT`.

**The cost you're buying when you choose low-pause:** ZGC and Shenandoah are not free lunches. They typically give up **~10–15% throughput** versus G1/Parallel and consume more memory (barrier overhead, extra metadata, more headroom to stay ahead of mutators). You are explicitly spending throughput and footprint to buy tail latency. If your SLO doesn't need sub-millisecond pauses, **don't** pay that bill — G1 will give you more requests per core.

## Inside Concurrent Compaction

Why is "short pauses on a huge heap" hard, and why does it cost throughput? Because **defragmentation requires moving live objects**, and moving an object means every pointer to it must be updated. Doing that with the app stopped is easy but slow (pause scales with live set). Doing it *while the app runs* is the deep trick.

**ZGC — colored pointers + load barrier.** ZGC stores GC-state bits in unused high bits of every pointer ("colors"). On **every pointer load**, a tiny **load barrier** checks the color: if the referenced object has been (or is being) relocated, the barrier transparently fixes the pointer to the new location ("self-healing") before the app sees it. Because the fix-up is lazy and per-load, ZGC can relocate objects concurrently and its STW pauses contain only root-scanning-class work that doesn't grow with the heap. The cost: a check on every load (throughput tax) and the inability to use those pointer bits for anything else.

**Shenandoah — forwarding (Brooks) pointers + read barrier.** Shenandoah historically gave each object an extra word pointing to its current location. The app dereferences through that forwarding pointer (a read barrier), so even mid-relocation it reaches the live copy. Concurrent evacuation copies objects and updates forwarding pointers without a global stop. The cost: the indirection word (memory) and barrier overhead on access.

**The unifying insight:** both pay a **per-access barrier tax** so that relocation can happen concurrently. That tax is exactly the **throughput** you trade for **latency**. The triangle, made silicon.

**Floating garbage and allocation stalls** are the other side: because collection overlaps with allocation, some garbage created mid-cycle survives to the next cycle (floating garbage → more footprint), and if your allocation rate outruns the collector, threads **stall** waiting for memory (latency spike — the exact thing you were avoiding). This is why low-pause collectors need *more* headroom and lower `GOGC`-equivalent thresholds: they must stay ahead of the mutator.

## The Diagnosis-Then-Tune Workflow

The senior failure mode is reaching for a flag before understanding the problem. The discipline is a fixed order. **Reduce allocation > size the heap > pick the collector > micro-tune.** Never skip a step to get to the fun one.

**Step 0 — Measure. Establish a baseline.** Before touching anything, capture:
- **GC%** (throughput cost) — from `gctrace`/`-Xlog:gc`.
- **Pause-time distribution** — not the mean; the p99/p999 of pause durations.
- **GC frequency** — collections per minute.
- **Heap-after-GC** over time — *the* leak detector (see pitfalls).
- **Allocation rate** — bytes/sec, from profiles.

Tools: `-Xlog:gc*` / JFR / async-profiler on the JVM; `GODEBUG=gctrace=1`, `pprof` (`-alloc_space`, `-inuse_space`), and `runtime/metrics` on Go; and dashboards (Grafana) plotting pause/frequency/heap-after-GC/alloc-rate over time. **You cannot tune what you haven't graphed.**

**Step 1 — Reduce allocation.** Profile *where* the garbage is born (`pprof -alloc_space`, async-profiler's allocation flame graph). The top few allocation sites usually dominate. Pool buffers, preallocate, avoid boxing, stream instead of materialize. This shrinks the problem for every collector and is the only step that helps throughput *and* latency *and* footprint at once.

**Step 2 — Size the heap.** Give the GC headroom. More heap → lower frequency → fewer pauses (junior's "bigger heap = better"). Pin `-Xms`=`-Xmx`; set `GOMEMLIMIT` with headroom under the container limit. Often the fix ends here.

**Step 3 — Pick the collector.** Only now, with allocation reduced and heap sized, choose the collector that matches the residual SLO (the table above). Switching collectors before steps 1–2 means you're tuning the wrong thing.

**Step 4 — Micro-tune.** `MaxGCPauseMillis`, `IHOP`, region size, `GOGC` fine-tuning. Last, and only against a measured target. Change one knob, re-measure p99/GC%, keep or revert.

## Mental Models

**Model 1: "Collector choice sets the *shape*; knobs set the *position*."** You choose which two corners of the triangle you're near by collector, then fine-position with flags.

**Model 2: "Barriers are the exchange rate."** Every concurrent collector taxes ordinary pointer access to buy short pauses. Throughput-per-latency is a literal exchange rate you're paying on every memory op.

**Model 3: "Heap-after-GC is the truth serum."** Pause and frequency wobble with load. The *floor* of heap-after-GC over time tells you the real live set — and whether it's growing (a leak) or flat (healthy churn).

**Model 4: "Stay ahead of the mutator."** A concurrent collector is in a race with allocation. Tuning low-pause collectors is mostly about ensuring the collector always wins that race (enough headroom, enough GC CPU), because losing it = stalls.

## Code Examples

**A ZGC config for a large-heap, strict-tail service:**

```bash
java \
  -Xms32g -Xmx32g \
  -XX:+UseZGC -XX:+ZGenerational \
  -XX:SoftMaxHeapSize=28g \
  -Xlog:gc*:file=/var/log/gc.log:time,uptime,tags \
  -jar service.jar
# Sub-ms pauses independent of the 32g heap; SoftMaxHeapSize gives a
# soft target so ZGC starts reclaiming before hard exhaustion.
```

**G1 with an explicit SLO budget:**

```bash
java -Xms16g -Xmx16g -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=50 \
  -XX:InitiatingHeapOccupancyPercent=40 \
  -XX:G1HeapRegionSize=16m \
  -jar service.jar
# Lower IHOP starts concurrent marking earlier -> avoids evacuation
# failure under bursty load; larger regions reduce humongous allocations.
```

**Go: confirming allocation is the bottleneck before tuning knobs:**

```bash
# Step 0/1: find where garbage is born — this is the real fix.
go tool pprof -alloc_space http://localhost:6060/debug/pprof/heap
# Only after killing the top allocators do you reach for:
GOGC=200 GOMEMLIMIT=14GiB ./server
```

## Pros & Cons of the Major Collectors

- **Parallel** — *Pro:* maximum throughput, simple. *Con:* STW pauses scale with heap; unusable for tight latency SLOs.
- **G1** — *Pro:* balanced, predictable, great default, tunable pause goal. *Con:* pauses still in the tens-of-ms range; evacuation/promotion failures degrade to Full GC; humongous-object pitfalls.
- **ZGC** — *Pro:* sub-ms pauses independent of heap size, scales to TB heaps. *Con:* ~10–15% throughput cost, more memory, allocation stalls if you fall behind.
- **Shenandoah** — *Pro:* same low-pause goal, broad JDK availability. *Con:* forwarding-pointer/barrier overhead, similar throughput cost.
- **Go runtime** — *Pro:* sub-ms by design, almost no tuning. *Con:* non-compacting (fragmentation possible), non-generational (less efficient for some lifetime patterns), few escape hatches when you need them.

## Coding Patterns

- **Allocation-site elimination**: drive the top-N allocation sites toward zero before any flag change.
- **Region-friendly sizing in G1**: keep large arrays under the humongous threshold (half a region) or raise `G1HeapRegionSize`.
- **Backpressure to protect concurrent collectors**: rate-limit/shed load so allocation can't outrun ZGC/Shenandoah and cause stalls.
- **Lifetime separation**: keep long-lived caches structurally distinct from request-scoped churn so generational/region heuristics work.

## Best Practices

- **Match collector to workload shape**; don't default ZGC onto a batch job or Parallel onto a latency service.
- **Follow the order**: reduce allocation → size heap → pick collector → micro-tune. Resist jumping to step 3 or 4.
- **Budget against an SLO**, not a vibe: "p99 pause < 10 ms at 2× peak load," then verify.
- **Always have a baseline** captured before the change, and the same graphs after.
- **Give low-pause collectors headroom**; they need to win the race with allocation.

## Edge Cases & Pitfalls

- **A leak masquerading as a GC problem.** If GC frequency and pause time climb over hours and **heap-after-GC trends upward** (the floor keeps rising), you have a leak, not a tuning problem. No flag fixes it; you must find the retained objects (heap dump, dominator tree). Tuning a leak just delays the OOM.
- **Promotion / evacuation failure → Full GC.** Under a load burst, G1 may have no room to evacuate survivors and falls back to a long Full GC — a latency cliff. Mitigate with a lower IHOP (start marking earlier) and more headroom.
- **Reference-processing / finalizer stalls.** Heavy use of finalizers, weak/soft/phantom references, or `Cleaner`s adds a reference-processing phase that can stall the GC. `-XX:+ParallelRefProcEnabled` helps; avoiding finalizers helps more.
- **Switching collectors to fix a code problem.** ZGC won't save a service that allocates 10 GB/s of garbage — it'll stall. Fix allocation first.
- **Tuning to the mean.** A change that lowers average pause but worsens p999 is a regression for users. Always evaluate against the tail.

## Summary

The senior-level decision is **collector selection**, made by **workload shape**: Parallel for throughput/batch, G1 as the balanced latency-service default, ZGC/Shenandoah when you need **sub-millisecond pauses independent of heap size** on large heaps — paying a real **~10–15% throughput and memory tax** to get there. That tax is mechanical: concurrent compaction relies on **per-access barriers** (ZGC's colored-pointer load barrier, Shenandoah's forwarding pointer) to relocate objects while the app runs, and on staying ahead of the mutator to avoid **allocation stalls**. Above all, follow the **diagnosis-then-tune order — measure, reduce allocation, size the heap, pick the collector, micro-tune** — and use **heap-after-GC over time** as your truth serum to separate a real leak from a tunable GC problem.
