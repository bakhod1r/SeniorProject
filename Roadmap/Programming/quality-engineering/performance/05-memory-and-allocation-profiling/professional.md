# Memory and Allocation Optimization — Professional Level

> **Roadmap:** [Performance](../README.md) → Memory and Allocation Optimization
> *The senior page taught you to read a heap profile and cut allocations. This page is about memory as a production resource you pay for and get killed by — where "how much does this allocate?" stops being a benchmark question and becomes "what's our $/GB, why did the pod OOMKill at 3 a.m., and does the GC even know it's running in a 2 GiB cgroup?"*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Container Memory Limits and the OOMKill](#container-memory-limits-and-the-oomkill)
4. [Making the GC Aware of Its Budget](#making-the-gc-aware-of-its-budget)
5. [Tuning the GC for the Workload](#tuning-the-gc-for-the-workload)
6. [Continuous Memory Profiling in Production](#continuous-memory-profiling-in-production)
7. [Diagnosing Production Memory Incidents](#diagnosing-production-memory-incidents)
8. [Capacity, Cost, and Right-Sizing](#capacity-cost-and-right-sizing)
9. [War Stories](#war-stories)
10. [Decision Frameworks](#decision-frameworks)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Managing memory as a production resource and a line item — limits, headroom, GC tuning for a workload, always-on profiling, incident diagnosis, and the RAM-vs-CPU-vs-instance-count cost trade.**

> *Profiler tooling — how to capture and read a heap or allocation profile (`pprof`, JFR, async-profiler, `tracemalloc`) — lives in [01 — Profiling](../01-profiling/). This page assumes you can read a profile and asks the next question: how do you run memory well in production?*

The senior page optimized a hot path: fewer allocations, less GC pressure, a tighter working set. At the professional level the same physics shows up in different rooms. A pod gets `OOMKilled` and CrashLoopBackOffs through a deploy because the JVM never saw the cgroup limit and sized its heap for the *host's* 64 GiB. A Go service that ran fine for months starts GC-thrashing — burning 60% of CPU on garbage collection — after a traffic shift pushed live heap toward the limit and `GOGC` panicked the collector into back-to-back cycles. A finance review asks why the fleet is provisioned at 16 GiB per instance when p99 RSS is 5 GiB, and whether that headroom is worth roughly $90/instance/month.

None of these are new *concepts* — they're the allocation and GC fundamentals from the earlier tiers, now multiplied by a cgroup limit, a Kubernetes scheduler, a GC that has to be *told* its budget, and a bill. The skill here is judgment: knowing that memory headroom is insurance you pay for in dollars, that the GC trades CPU for RAM and you get to set the exchange rate, that an always-on heap profiler is the difference between diagnosing a leak in ten minutes and bisecting deploys for a day. This is the pragmatic, on-call layer.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — escape analysis, allocation rate, GC pressure, working set, fragmentation, generational/region collectors.
- **Required:** You can read a heap and an allocation profile and tell *retained live heap* from *allocation throughput*. (See [01 — Profiling](../01-profiling/).)
- **Helpful:** You've run a service under a container orchestrator with memory limits and seen an `OOMKilled` event.
- **Helpful:** You've owned a capacity or cost budget, or argued an instance-type choice with someone who reads the bill.

---

## Container Memory Limits and the OOMKill

In production your process almost never owns the machine — it owns a **cgroup** with a memory limit. On Linux, `memory.max` (cgroup v2; `memory.limit_in_bytes` on v1) is a hard ceiling enforced by the kernel. The instant the cgroup's resident memory (RSS + page cache it can't reclaim + kernel accounting) crosses that line, the kernel's OOM killer terminates a process in the group — usually *your* process, with `SIGKILL`. No stack trace, no graceful shutdown, no chance to flush. In Kubernetes you see it as a pod `Reason: OOMKilled`, exit code 137 (128 + SIGKILL's signal 9).

The crucial property: **an OOMKill is not a leak; it's exceeding a number.** A perfectly healthy process that simply needed 2.1 GiB in a 2 GiB cgroup dies exactly as hard as a leaking one. This is why so much production memory work is about the *relationship between the limit and the process's real footprint*, not about the code.

```yaml
# Kubernetes: request is what the scheduler reserves; limit is the OOMKill line.
resources:
  requests:
    memory: "2Gi"   # scheduling guarantee; bin-packing uses this
  limits:
    memory: "2Gi"   # hard cap; cross it and the kernel SIGKILLs you
```

Two facts that bite teams:

- **RSS, not heap, is what gets you killed.** The kernel counts *everything* resident: the GC heap, thread stacks, the runtime/JIT, native allocations (mmap'd buffers, JNI, cgo, glibc `malloc` arenas), and code. A JVM with a 1.5 GiB `-Xmx` can easily sit at 2.2 GiB RSS once Metaspace, thread stacks, code cache, direct byte buffers, and `malloc` overhead are added. Sizing the *heap* to the limit guarantees an OOMKill on the *non-heap* overhead.
- **The kill is abrupt and lossy.** No `defer`, no shutdown hook, no in-flight request drain. Anything you cared about flushing on exit is gone.

> **The professional reality:** the limit is a contract the kernel enforces with `SIGKILL`. You don't get to negotiate it at runtime, so you negotiate it at design time — with headroom and with a GC that respects it.

---

## Making the GC Aware of Its Budget

Here is the single most common production memory bug that isn't a leak: **the runtime doesn't know about the cgroup limit, so it sizes itself for the host.** A managed runtime grows its heap toward whatever it believes the machine has. If it believes the machine has 64 GiB but lives in a 2 GiB cgroup, it will happily allocate past 2 GiB and get OOMKilled — *while convinced it has tons of room and therefore running the GC lazily.*

**The JVM "ignores the cgroup" classic.** Old JVMs read `/proc/meminfo` (the *host's* memory) and defaulted the heap to ~1/4 of it. In a 2 GiB cgroup on a 64 GiB host, the JVM would target a ~16 GiB heap and OOMKill almost immediately. Fixes, in order of how modern they are:

```bash
# Pre-fix legacy JVMs (8u131..8u191): opt in to container awareness
-XX:+UnlockExperimentalVMOptions -XX:+UseCGroupMemoryLimitForHeap

# Modern JVMs (8u192+, 11+, 17+, 21): container-aware by default. Set heap as a
# PERCENTAGE of the cgroup limit, leaving headroom for non-heap memory.
-XX:MaxRAMPercentage=75.0   # 75% of the 2Gi limit -> ~1.5Gi heap, ~0.5Gi headroom
-XX:InitialRAMPercentage=75.0 -XX:MinRAMPercentage=75.0
```

Never use `-Xmx` as a fraction-of-the-limit hardcode in a templated deployment — the day someone changes the k8s limit, the `-Xmx` doesn't follow and you either waste RAM or OOMKill. `MaxRAMPercentage` tracks the cgroup automatically.

**The Go equivalent: `GOMEMLIMIT`.** Go's GC is paced by `GOGC` (a *relative* target: collect when the heap has grown `GOGC`% over live data). A relative target has no idea about an absolute ceiling, so under a load spike Go can blow past a cgroup limit before the next GC. `GOMEMLIMIT` (Go 1.19+) gives the GC an **absolute soft limit** it will work harder and harder to stay under:

```bash
# Tell the Go GC the budget. Set it BELOW the cgroup limit for non-heap headroom.
GOMEMLIMIT=1750MiB        # in a 2Gi (2048Mi) cgroup: ~300Mi for stacks/runtime/off-heap
# Common pattern: keep GOGC default (100) but cap with GOMEMLIMIT as a safety net,
# or set GOGC=off and rely solely on GOMEMLIMIT for a fixed-budget service.
```

`GOMEMLIMIT` is a *soft* limit: as live heap approaches it, the GC runs more frequently to avoid crossing it — trading CPU for staying under the ceiling. If the live set genuinely exceeds the limit (a real leak or undersized budget), Go will GC-thrash rather than OOM-protect you; the limit buys grace, not magic. The headroom you leave (cgroup limit minus `GOMEMLIMIT`) absorbs stacks, the runtime, and cgo/off-heap.

> **The principle:** *the runtime must know its limit, and the limit it's told must be below the cgroup limit by the non-heap margin.* Heap budget = cgroup limit − (thread stacks + runtime/JIT + native/off-heap + safety). A GC tuned against the host's memory in a container is a latent OOMKill that fires the first busy hour.

---

## Tuning the GC for the Workload

There is no universal GC setting; there's a setting *for a workload's objective*. The fundamental knob every collector exposes is **how much RAM you're willing to spend to save CPU** (or how much latency you'll tolerate to save RAM). More headroom between live heap and the limit means the GC runs less often → less CPU spent collecting → but more RAM provisioned. This is the money knob.

**Latency-sensitive services (request/response, p99 matters):**

- **Java:** use a concurrent, low-pause collector. **ZGC** (`-XX:+UseZGC`) and **Shenandoah** (`-XX:+UseShenandoahGC`) do almost all work concurrently with sub-millisecond pauses, largely decoupled from heap size — at the cost of higher CPU and memory overhead than the throughput collector. **G1** (the default since JDK 9) targets a pause goal (`-XX:MaxGCPauseMillis=200`) and is the sensible middle.
- **Go:** the GC is already a concurrent low-pause design (sub-millisecond STW). Tune for latency by giving it room: keep `GOGC` moderate and set `GOMEMLIMIT` so it isn't forced into frequent emergency collections. *Lowering* `GOGC` (e.g. 50) shrinks the heap and cuts peak RSS but raises GC CPU and frequency — the opposite trade.

```bash
# Java, latency-first, 8Gi container:
-XX:+UseZGC -XX:MaxRAMPercentage=70 -XX:+ZGenerational   # JDK 21 generational ZGC
# Go, latency-first, 2Gi container:
GOGC=100 GOMEMLIMIT=1750MiB
```

**Throughput / batch jobs (total work per dollar; pauses don't matter):**

- **Java:** use the **Parallel** collector (`-XX:+UseParallelGC`) — stop-the-world but the highest raw throughput and lowest overhead. Give it a large heap and let GC pauses be long but rare.
- **Go:** raise `GOGC` (e.g. `GOGC=300` or higher) so the heap grows large between collections — fewer, bigger GCs, less CPU spent collecting, more RAM consumed. Perfect when the box is yours for the duration of the batch.

```bash
# Java batch, throughput-first:
-XX:+UseParallelGC -Xmx48g          # rare, long pauses; max work/sec
# Go batch, throughput-first:
GOGC=400 GOMEMLIMIT=60GiB           # big heap, infrequent GC, low GC CPU
```

The cost trade in one sentence: **more RAM = less CPU on GC, and RAM and CPU have different prices.** On typical cloud pricing a vCPU costs roughly 6–8× a GiB of RAM per hour, so for a CPU-bound service that's GC-heavy, *buying RAM to lower GC CPU is often the cheaper trade* — but only up to the point where you'd have to jump to a larger (pricier) instance to get that RAM. Measure GC CPU% (`gc` time in JFR / Go's `GODEBUG=gctrace=1`) and price both sides before turning the knob.

> **Rust / C++ note:** no tracing GC, so none of this applies — instead you manage allocators and arenas directly. Swapping the global allocator (`jemalloc`, `mimalloc`, `tcmalloc`) is the analogous "tuning knob," and fragmentation in long-lived processes (next section) is the dominant memory-creep mechanism rather than GC pacing.

---

## Continuous Memory Profiling in Production

The senior tier profiled *during development*. The professional tier profiles *all the time, in production*, because the memory bugs that matter — slow leaks, gradual heap growth, fragmentation — are invisible in a five-minute benchmark and only manifest after hours or days of real traffic.

**Always-on profiling.** Keep a low-overhead profiler armed in production so that when an incident happens you already have the data:

- **Go:** expose `net/http/pprof` (behind auth / a debug port). Heap and allocation profiles are sampled and cost ~1–2% — cheap enough to leave on. Continuous-profiling systems (Pyroscope, Parca, Google Cloud Profiler, Datadog) scrape `/debug/pprof/heap` on a schedule and store a time series of *where* memory lives.
- **Java:** **JFR** (`-XX:StartFlightRecording`) runs continuously at ~1–2% overhead and records allocation events, GC, and live-set samples; pair with async-profiler for allocation flame graphs. JFR is designed to be always-on in production.

**The two signals to alert on:**

1. **RSS trend.** A monotonically rising RSS that never returns to baseline after GC is the classic leak shape. Alert on a sustained upward slope over hours (e.g. RSS grew > X% over 6 h with no deploy).
2. **Live-heap divergence.** The sharper signal: **post-GC live heap rising over time.** A healthy service's *live* heap (what survives a full GC) oscillates around a stable baseline; total heap sawtooths but the troughs stay flat. A leak shows the *troughs themselves climbing* — each GC frees less than the last because retained objects accumulate. Watching the post-GC floor (Go: live heap from `gctrace`; Java: old-gen occupancy after full GC) catches a leak long before RSS alone makes it obvious.

> **The discipline:** RSS-vs-live-heap divergence is your leak detector. If RSS climbs but live heap is flat, you have fragmentation or off-heap growth, not a heap leak — a completely different fix. Wiring both into your dashboards turns "memory is weird" into a one-glance diagnosis.

---

## Diagnosing Production Memory Incidents

When a memory incident pages you, the first job is **classification**, because the four common shapes have four different fixes and confusing them wastes the incident.

```
Shape on the RSS / live-heap graph              →  Diagnosis            →  First move
──────────────────────────────────────────────────────────────────────────────────────
slow, steady climb over hours/days; live-heap   →  LEAK                 →  heap diff (two profiles
  troughs rising; never returns to baseline                                over time), find growing type
sudden step up after a deploy or input spike     →  BLOAT               →  what changed: input size,
  (big request, cache-fill, unbounded buffer)                              cache config, batch size
RSS climbs but post-GC LIVE heap is FLAT          →  FRAGMENTATION       →  allocator (jemalloc), arena
  (long-lived process, glibc malloc, mixed sizes)    / off-heap growth      tuning, or check off-heap
GC CPU% spiking toward 100%, latency exploding,   →  GC THRASH / DEATH   →  raise limit/headroom NOW,
  throughput collapsing, live heap near limit         SPIRAL               then fix allocation rate
```

**Leak.** Live heap trends up; GC can't reclaim it because something holds references (a growing map/cache without eviction, a registered-but-never-removed listener, a goroutine/thread leak holding closures). Diagnose with a **heap diff**: capture two heap profiles minutes/hours apart and look for the type whose retained bytes grew. In Go, `go tool pprof -base old.heap new.heap`; in Java, two heap dumps compared in Eclipse MAT's "dominator tree" / histogram delta.

**Bloat.** A step change, not a slope — usually traceable to a single event: a deploy that raised a buffer or batch size, a request with an unexpectedly large payload, a cache that filled. Correlate the step with the deploy/traffic timeline; the fix is bounding the input, not finding a leak.

**Fragmentation.** RSS rises while live heap stays flat — the allocator is holding pages it can't return because freed objects left holes too small to reuse and too scattered to coalesce. Endemic to long-lived processes with mixed allocation sizes under glibc `malloc`. Fixes: switch allocator (`jemalloc`/`tcmalloc`), tune `malloc` arenas (`MALLOC_ARENA_MAX`), or use slabs/arenas for the offending size class. In Go, fragmentation is mostly handled by the runtime, so RSS-flat-live divergence there usually points to *off-heap* (cgo, mmap) growth instead.

**GC thrash / death spiral.** The dangerous one. As live heap approaches the limit, the GC fires more and more often to stay under it, each cycle reclaiming less, until the process spends nearly all CPU collecting and almost none doing work. Throughput collapses, latency explodes, and — because it's slow, not crashed — health checks may still pass while the service is effectively down. The JVM's `OutOfMemoryError: GC overhead limit exceeded` is the explicit version (>98% time in GC, <2% heap recovered). **The immediate move is to add headroom (raise the limit / `GOMEMLIMIT` / heap) to break the spiral, then fix the underlying allocation rate or live-set growth** — never just leave the limit raised, or you've only deferred it.

> **The professional discipline:** classify before you fix. "Memory is high" is not a diagnosis. RSS slope + post-GC live-heap behavior + the deploy/traffic timeline tell you which of the four shapes you have, and each one has a different first move.

---

## Capacity, Cost, and Right-Sizing

Memory is a line item. At fleet scale, the difference between provisioning each instance at 16 GiB and 8 GiB is real money, and the job is to **provision the smallest footprint that survives the peak with safe headroom** — no more, no less.

**The headroom margin.** Set the limit above *peak* RSS (p99/p100 over a representative window including the worst load), not average. A limit at average RSS OOMKills on every spike; a limit at 3× peak burns money. A common starting point is **peak RSS × 1.3–1.5**, then tighten with observed data. The margin covers GC overshoot, traffic spikes, and the non-heap memory that grows with concurrency (more in-flight requests → more thread stacks and buffers).

**The three-way trade.** For a fixed total workload you can usually spend it as:

- **Bigger instances, fewer of them** — fewer per-instance fixed overheads (runtime, caches, base RSS amortized over more work), but coarser bin-packing and a bigger blast radius per failure.
- **Smaller instances, more of them** — finer scaling granularity and smaller blast radius, but the per-instance fixed memory overhead is paid many more times (N copies of the JVM/runtime base, N caches).
- **Same instances, tune the GC** — buy RAM to cut GC CPU (or the reverse) *within* an instance before changing the instance count.

**Putting numbers on it.** Suppose a service runs 40 instances at 16 GiB but p99 RSS is 5 GiB. At a representative ~$0.005/GiB-hour for provisioned memory, the 11 GiB of slack per instance is `11 × 40 × 0.005 × 730 ≈ $1,600/month` of headroom you may not need. Drop to an 8 GiB limit (peak 5 GiB × 1.5 = 7.5 GiB, round up) and you reclaim most of it — *if* the live-heap and spike data say 8 GiB survives the peak. The discipline is to let the profiling data, not fear, set the limit.

> **The reality:** right-sizing is a measured trade, not a vibe. Pull p99/peak RSS from the same continuous-profiling you set up above, add a deliberate margin, and price both the slack you're carrying and the OOMKill risk you'd take by trimming it. "16 GiB to be safe" with p99 at 5 GiB is a budget bug, not safety.

---

## War Stories

**The OOMKill CrashLoop on deploy.** A Java service was migrated to a 2 GiB Kubernetes limit on a 64 GiB node, JVM 8u151 (pre-container-aware). The JVM read the *host's* 64 GiB, defaulted the heap to ~16 GiB, and OOMKilled within seconds of startup — every pod, every deploy, an instant CrashLoopBackOff that never served a request. Nothing in the *application* was wrong; the JVM simply never saw the cgroup. Fix: upgrade to a container-aware JVM and set `-XX:MaxRAMPercentage=75`, giving a ~1.5 GiB heap with ~0.5 GiB for Metaspace, stacks, and direct buffers. The lesson: *a managed runtime that doesn't know its cgroup limit will size for the host and die on the limit.*

**The Go GC death spiral.** A Go service ran fine at `GOGC=100` with no `GOMEMLIMIT` in a 4 GiB cgroup. A traffic shift roughly doubled live heap; with a relative-only target the heap grew toward 4 GiB, and as it approached the cgroup limit the runtime — *and the kernel* — pressured it into near-continuous GC. GC CPU climbed past 70%, p99 latency went from 40 ms to 4 s, throughput cratered, but liveness checks still passed (the process wasn't dead, just suffocating). Immediate mitigation: set `GOMEMLIMIT=3500MiB` and scale out to break the spiral; real fix: an unbounded in-memory cache was the live-set growth, capped with an LRU. The lesson: *a relative GC target with no absolute limit has no defense against live-set growth near a hard ceiling.*

**The leak found by RSS-vs-live divergence.** A service's RSS crept up ~150 MiB/day, far too slow to catch in any test, and it took ~10 days to threaten the limit — long enough that engineers blamed "normal growth." Continuous profiling showed the tell: **post-GC live heap was climbing in lockstep with RSS** (not fragmentation — the live floor itself rose). A `pprof` heap diff between two days pinpointed a `map[string]*Session` that registered sessions but never deleted expired ones; entries accumulated forever. One eviction call fixed a leak that deploy-bisecting would never have isolated. The lesson: *watching the post-GC live-heap floor, not just RSS, turns a slow leak from a multi-day mystery into a ten-minute heap diff.*

---

## Decision Frameworks

**What heap budget do I give the runtime? Compute:**
- Heap budget = cgroup limit − (thread stacks + runtime/JIT/Metaspace + native/off-heap + safety margin).
- Java: express as `-XX:MaxRAMPercentage` (~70–75% is a common start) so it tracks the limit automatically.
- Go: set `GOMEMLIMIT` below the cgroup limit by the non-heap margin; keep `GOGC` for pacing.

**Which GC / GC mode? Ask:**
- Latency-sensitive request/response? → Java: ZGC/Shenandoah (or G1 with a pause goal); Go: default GC with adequate `GOMEMLIMIT` headroom.
- Throughput batch, pauses irrelevant? → Java: Parallel GC, big heap; Go: high `GOGC`, big `GOMEMLIMIT`.
- Want to spend RAM to cut GC CPU? → raise headroom / `GOGC`; verify GC CPU% actually drops and price the RAM.

**Is this incident a leak, bloat, fragmentation, or thrash? Look at:**
- Post-GC live heap rising over time → **leak** (heap diff to find the type).
- Sudden step correlated with deploy/input → **bloat** (bound the input).
- RSS up, live heap flat → **fragmentation / off-heap** (allocator or off-heap fix).
- GC CPU% → 100%, latency exploding, live near limit → **thrash** (add headroom now, fix allocation rate after).

**What's the right limit / instance? Ask:**
- Limit ≈ peak (p99/p100) RSS × 1.3–1.5, validated against live-heap and spike data.
- Bigger/fewer vs smaller/more: weigh per-instance fixed overhead × N against blast radius and scaling granularity.

---

## Mental Models

- **The cgroup limit is a hard line the kernel enforces with `SIGKILL`.** An OOMKill isn't a leak; it's RSS crossing a number. You manage the *relationship* between the limit and the real footprint, not just the code.

- **RSS is what kills you, not heap.** The kernel counts the GC heap *plus* stacks, runtime/JIT, and native/off-heap. Sizing the heap to the limit guarantees a kill on the non-heap overhead. Always leave the margin.

- **The GC only respects a limit it's told about.** A runtime that reads host memory in a container sizes for 64 GiB in a 2 GiB box and dies. `MaxRAMPercentage` (Java) and `GOMEMLIMIT` (Go) are how you tell it.

- **RAM-for-CPU is the money knob.** More headroom → fewer GCs → less GC CPU, paid in provisioned RAM. RAM and a vCPU have different prices; measure GC CPU% and price both sides before turning it.

- **Post-GC live heap is the leak signal; RSS-vs-live divergence is the fragmentation signal.** A rising live floor = leak. RSS up with a flat live floor = fragmentation or off-heap. Two different shapes, two different fixes.

---

## Common Mistakes

1. **Letting the runtime size for the host inside a container.** A pre-container-aware JVM (or a Go service with no `GOMEMLIMIT`) sizes for the node's memory and OOMKills on the cgroup limit. Set `MaxRAMPercentage` / `GOMEMLIMIT` against the *limit*.

2. **Sizing the heap equal to the cgroup limit.** RSS = heap + stacks + runtime + native; equal heap and limit OOMKills on the overhead. Leave a non-heap margin (a chunk of the limit, not zero).

3. **Hardcoding `-Xmx` as a fraction of the limit in a template.** When the k8s limit changes, the `-Xmx` doesn't follow — you waste RAM or OOMKill. Use `MaxRAMPercentage` so it tracks automatically.

4. **Calling every high-memory incident a "leak."** Bloat, fragmentation, and GC thrash look like "memory is high" but have different fixes. Classify by live-heap slope and the deploy timeline first.

5. **Leaving a raised limit as the "fix" for GC thrash.** Adding headroom breaks the spiral but only defers it if live-set growth or allocation rate is the real cause. Mitigate fast, then fix the root cause.

6. **Provisioning for fear instead of data.** "16 GiB to be safe" with p99 RSS at 5 GiB is a budget bug. Right-size from peak RSS × a deliberate margin, using your continuous-profiling data.

7. **Profiling only in dev.** Slow leaks and fragmentation never show in a five-minute benchmark. Run an always-on profiler (JFR / continuous pprof) so the data exists *before* the incident.

---

## Test Yourself

1. A Java pod CrashLoopBackOffs with exit code 137 the instant it starts, on a 2 GiB limit / 64 GiB node, JVM 8u151. What's the root cause and the fix?
2. Why does setting `-Xmx` equal to the cgroup limit still OOMKill, and how do you size the heap correctly?
3. Explain `GOMEMLIMIT` vs `GOGC`. Why does a relative target alone leave you exposed near a hard cgroup limit?
4. Your RSS climbs steadily but post-GC live heap is flat. Is this a leak? What is it, and how do you fix it?
5. Describe a GC death spiral: the mechanism, why health checks may still pass, and the correct two-step response.
6. You want to cut GC CPU on a Go service. Which way do you turn `GOGC`/`GOMEMLIMIT`, what do you spend, and how do you confirm the trade was worth it?
7. A fleet runs 40 instances at 16 GiB but p99 RSS is 5 GiB. How do you decide the right limit, and roughly what's at stake in dollars?

<details>
<summary>Answers</summary>

1. The JVM is **pre-container-aware** (8u151), so it reads the *host's* 64 GiB from `/proc/meminfo` and defaults the heap to ~1/4 → ~16 GiB, which exceeds the 2 GiB cgroup; the kernel OOMKills it immediately (137 = 128 + SIGKILL). **Fix:** upgrade to a container-aware JVM (8u192+/11+/17+/21) and set `-XX:MaxRAMPercentage=75` so the heap is ~1.5 GiB with headroom for non-heap memory; or as a legacy stopgap, `-XX:+UnlockExperimentalVMOptions -XX:+UseCGroupMemoryLimitForHeap`.

2. Because **RSS = heap + thread stacks + runtime/JIT/Metaspace + native/off-heap (direct buffers, malloc overhead)**. A heap sized to the full limit leaves zero room for that overhead, so RSS crosses the limit and the kernel kills the process. Size the heap to roughly 70–75% of the limit (`MaxRAMPercentage`), leaving the rest as a non-heap margin.

3. `GOGC` is a **relative** pacing target — collect when heap grows `GOGC`% over live data — with no notion of an absolute ceiling. `GOMEMLIMIT` is an **absolute soft limit** the GC works progressively harder to stay under. With only `GOGC`, a live-set spike can grow the heap toward the cgroup limit before the next GC and trigger an OOMKill (or thrash); `GOMEMLIMIT`, set below the cgroup limit by the non-heap margin, gives the GC an absolute budget to defend.

4. **Not a heap leak** — a leak would show the *post-GC live heap rising*. Flat live heap with rising RSS is **fragmentation** (allocator holding unreclaimable pages) or **off-heap growth** (cgo/mmap/native). Fixes: switch allocator (`jemalloc`/`tcmalloc`), tune `MALLOC_ARENA_MAX`, or use arenas/slabs for the offending size class; for off-heap, find the native/cgo allocation that's growing.

5. As live heap nears the limit, the GC fires more and more often, each cycle reclaiming less, until the process spends ~all CPU collecting and ~none doing work; throughput collapses and latency explodes. **Health checks may still pass** because the process is alive (just suffocating), not crashed. **Correct response:** (1) immediately add headroom — raise the limit / `GOMEMLIMIT` / heap — to break the spiral; (2) then fix the underlying allocation rate or live-set growth. Never leave the raised limit as the only fix.

6. **Raise `GOGC`** (and/or `GOMEMLIMIT`) so the heap grows larger between collections → fewer, less frequent GCs → less GC CPU. What you spend is **RAM** (higher peak RSS). Confirm via `GODEBUG=gctrace=1` (or a continuous profiler) that GC CPU% actually dropped, check peak RSS still fits the limit with margin, and price the extra RAM against the CPU saved — only worth it if it doesn't force a larger instance.

7. Pull **peak (p99/p100) RSS** and the post-GC live-heap baseline from continuous profiling; set the limit to roughly peak × 1.3–1.5 (5 GiB × 1.5 ≈ 7.5 → an 8 GiB limit), validated against spike data. At stake: ~11 GiB slack × 40 instances × ~$0.005/GiB-hr × 730 hr ≈ **~$1,600/month** of headroom — reclaimable if the data says 8 GiB survives the peak, at the cost of less OOMKill margin.

</details>

---

## Cheat Sheet

```
OOMKILL
  cgroup memory.max crossed -> kernel SIGKILL -> k8s OOMKilled, exit 137
  RSS (not heap) is the killed quantity: heap + stacks + runtime + native/off-heap
  the kill is abrupt: no shutdown hook, no drain, no flush

TELL THE GC ITS BUDGET
  Java (modern): -XX:MaxRAMPercentage=75   (tracks the cgroup limit)
  Java (legacy): -XX:+UnlockExperimentalVMOptions -XX:+UseCGroupMemoryLimitForHeap
  Go:            GOMEMLIMIT=1750MiB        (soft absolute limit, below cgroup limit)
  RULE: heap budget = cgroup limit - (stacks + runtime + native + margin)

GC FOR THE WORKLOAD
  latency:    Java ZGC/Shenandoah/G1(pause goal); Go default GC + GOMEMLIMIT headroom
  throughput: Java -XX:+UseParallelGC big heap;   Go GOGC=300+ big GOMEMLIMIT
  money knob: more RAM = fewer GCs = less GC CPU. vCPU ~ 6-8x price of a GiB RAM.

CONTINUOUS PROFILING (leave it ON, ~1-2% overhead)
  Go:   net/http/pprof  /debug/pprof/heap   + Pyroscope/Parca scrape
  Java: -XX:StartFlightRecording (JFR) + async-profiler alloc flame graphs
  ALERT on: RSS upward slope; POST-GC live-heap floor rising (the real leak signal)

INCIDENT CLASSIFICATION
  live-heap troughs rising      -> LEAK         -> pprof/MAT heap DIFF, find growing type
  step up after deploy/input    -> BLOAT        -> bound the input/cache/batch
  RSS up, post-GC live FLAT     -> FRAGMENTATION-> jemalloc/MALLOC_ARENA_MAX / off-heap
  GC CPU% -> 100, latency blows  -> GC THRASH    -> add headroom NOW, fix alloc rate after

RIGHT-SIZING
  limit ~= peak(p99/p100) RSS x 1.3-1.5, validated vs spike + live-heap data
  price the slack: GiB_slack x instances x $/GiB-hr x 730 = $/month carried
```

---

## Summary

- A production process owns a **cgroup**, not a machine. Crossing `memory.max` gets you `SIGKILL`ed (k8s `OOMKilled`, exit 137) — abrupt, lossy, no shutdown. **An OOMKill is RSS crossing a number, not necessarily a leak.**
- **RSS, not heap, is what kills you**: heap + thread stacks + runtime/JIT + native/off-heap. Size the heap *below* the limit by the non-heap margin, or you OOMKill on the overhead.
- **The GC must be told its budget.** A container-unaware runtime sizes for the host and dies on the limit. Use `-XX:MaxRAMPercentage` (Java) and `GOMEMLIMIT` (Go), set against the cgroup limit — the JVM-ignores-the-cgroup classic.
- **Tune the GC for the objective**: latency → ZGC/Shenandoah/G1 or Go's GC with headroom; throughput → Parallel GC / high `GOGC`. The core trade is **RAM for CPU** — the money knob, priced by the different costs of RAM and vCPU.
- **Profile continuously in production** (~1–2% via JFR / pprof), and alert on **RSS slope** and the **post-GC live-heap floor** — divergence between them tells leak from fragmentation.
- **Classify incidents before fixing**: leak (rising live floor), bloat (step change), fragmentation (RSS up / live flat), GC thrash (CPU → 100%). Each has a distinct first move; the death spiral is mitigated with headroom *now*, root-caused after.
- **Right-size from data**: limit ≈ peak RSS × a deliberate margin; price the slack you carry. "Plenty to be safe" with p99 far below the limit is a budget bug.

You can now operate memory as a production resource — limits, headroom, GC budget, always-on profiling, incident triage, and the cost trade. The remaining tier — [interview.md](interview.md) — consolidates this into the questions that probe whether someone has actually run memory in production.

---

## Further Reading

- [GOMEMLIMIT and the Go GC guide](https://tip.golang.org/doc/gc-guide) — the authoritative explanation of `GOGC`, `GOMEMLIMIT`, and the soft-limit pacing model.
- [JDK container-awareness and `MaxRAMPercentage`](https://docs.oracle.com/en/java/javase/21/) — how modern JVMs read the cgroup and size the heap as a percentage.
- *Java Performance: The Definitive Guide* — Scott Oaks — GC selection (G1/ZGC/Shenandoah/Parallel) and the latency-vs-throughput trade.
- [ZGC and Shenandoah design docs](https://wiki.openjdk.org/display/zgc/Main) — concurrent low-pause collectors and their memory/CPU overhead.
- *Systems Performance* — Brendan Gregg — the USE method applied to memory, and reading RSS/working-set behavior.
- Continuous-profiling tooling docs (Pyroscope, Parca, JFR, async-profiler) — always-on heap/allocation profiling in production.
- jemalloc / mimalloc / tcmalloc documentation — allocator choice and fragmentation control for GC-less (Rust/C++) and off-heap cases.

---

## Related Topics

- [01 — Profiling](../01-profiling/) — capturing and reading the heap/allocation profiles this page assumes you can interpret.
- [07 — Performance Budgets and Regression Testing](../07-performance-budgets-and-regression-testing/professional.md) — catching the allocation/RSS regressions that become tomorrow's OOMKill before they ship.
- [junior.md](junior.md) — what allocation and the GC are, and why memory matters at all.
- [senior.md](senior.md) — escape analysis, allocation rate, GC pressure, working set, fragmentation — the optimization fundamentals this page operationalizes.
- [interview.md](interview.md) — the questions that probe production memory judgment end to end.
- [Diagnostics](../../../diagnostics/) — when high memory becomes a live incident.
