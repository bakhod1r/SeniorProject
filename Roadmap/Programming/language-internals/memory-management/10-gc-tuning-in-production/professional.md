# GC Tuning in Production — Professional Level
> **Topic:** [GC Tuning in Production](README.md)
> **Focus:** SLO-driven tuning under real load, incident war stories with root causes and fixes, and the container/k8s reality where most GC outages actually happen.

---

## Table of Contents
- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [SLO-Driven Tuning: Turning a Latency Target into GC Settings](#slo-driven-tuning-turning-a-latency-target-into-gc-settings)
- [The Container Reality: Where GC Outages Are Born](#the-container-reality-where-gc-outages-are-born)
- [War Stories](#war-stories)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Operational Patterns](#operational-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

At this level GC tuning stops being about flags and starts being about **incidents, SLOs, and 3 a.m. pages.** The questions change: not "what does `MaxGCPauseMillis` do," but "our p999 jumped from 40 ms to 1.2 s at 14:03 and the on-call needs a root cause." Most real GC outages are not exotic collector internals — they're a container memory limit set wrong, an allocation regression from a deploy, or a slow leak that finally crossed the line under peak traffic.

This tier is built around two things professionals actually live with: **deriving GC settings from an SLO budget**, and **a catalog of war stories** with the symptom, the misdiagnosis, the real root cause, and the fix. The container section gets its own treatment because, in the Kubernetes era, the heap-vs-cgroup interaction is the **single most common GC-related production failure.**

## Prerequisites

- Senior tier: collector selection framework, concurrent-compaction mechanics, the diagnosis-then-tune order, heap-after-GC as leak detector.
- Operational fluency: dashboards, alerting, on-call, reading a heap dump, cgroups/k8s resource limits.
- An SLO mindset: error budgets, p99/p999, "the tail is the product."

## SLO-Driven Tuning: Turning a Latency Target into GC Settings

Tuning without a number is fiddling. Tuning *to an SLO* is engineering. The workflow:

**1. State the SLO as a measurable budget.** Example: *"p999 end-to-end latency < 200 ms at 2× current peak QPS."* Note the two non-negotiables professionals add: a **percentile** (p999, not mean) and a **load condition** (2× peak — you tune for the bad day, not the average Tuesday).

**2. Decompose the latency budget.** If p999 is 200 ms and your service does ~80 ms of real work at p999, the GC pause budget is roughly the remainder minus margin — say **GC pauses must stay under ~30–40 ms even at the tail.** That number *picks your collector*: 30–40 ms is comfortable G1 territory; if the budget were 5 ms you'd be looking at ZGC/Shenandoah, and if it were 2 ms you'd be questioning whether a managed runtime fits at all (or moving to off-heap/arena allocation for the hot path).

**3. Translate the pause budget into config and validate under load.** Set `MaxGCPauseMillis` to the budget, size the heap for headroom, then **run a load test at 2× peak and read the actual p999 of pauses** — not the goal, the measured outcome. The flag is a hint; the load test is the verdict.

**4. Wire the SLO into alerting.** Alert on the *symptom that maps to the SLO*, with leading indicators:
- p999 latency (the SLO itself).
- GC pause p99 (the leading indicator — it moves before user latency does).
- **Heap-after-GC trend** (catches leaks days before they OOM).
- GC% / fraction of CPU in GC (catches allocation regressions after a deploy).

**5. Protect the budget operationally.** A collector cannot meet an SLO if allocation outruns it. Pair tuning with **load shedding / backpressure** so a traffic spike degrades gracefully instead of triggering GC thrash or allocation stalls. The GC is part of your capacity model, not separate from it.

The professional reframe: **the GC budget is a line item in your latency budget, and the heap is a line item in your capacity model.** Treat them like any other dependency.

## The Container Reality: Where GC Outages Are Born

If you run on Kubernetes, internalize one fact: **your container's memory limit is not your heap size, and getting that wrong is the most common GC outage there is.**

**The cgroup mismatch.** A pod has a memory limit (cgroup). Inside it, the runtime allocates an *object heap* — but the process also uses thread stacks, metaspace/code cache, native libraries, direct byte buffers, and the GC's own bookkeeping. If `heap + non-heap > cgroup limit`, the kernel **OOMKills** the container. The heap dashboard looks healthy right up to the kill, because the heap *was* fine — it was the total that blew the limit.

**Old, broken default:** a JVM that doesn't read cgroups sees the *host's* RAM (say 256 GB), sizes a default heap off that, and gets OOMKilled in a 4 GB pod within seconds. JDK 10+ reads cgroup limits by default; older JVMs need `-XX:+UseContainerSupport` (or you pin `-Xmx` manually).

**The correct recipes:**

*JVM — size heap as a percentage of the container limit, leaving headroom for non-heap:*
```yaml
resources:
  limits: { memory: "4Gi" }
env:
  - name: JAVA_TOOL_OPTIONS
    value: "-XX:MaxRAMPercentage=70.0 -XX:+UseG1GC -Xlog:gc*:file=/proc/1/fd/1:time,tags"
# 70% of 4Gi ≈ 2.8Gi heap, leaving ~1.2Gi for metaspace/stacks/native/GC.
```

*Go — `GOMEMLIMIT` set below the cgroup limit, with `GOMAXPROCS` matched to the CPU limit:*
```yaml
resources:
  limits: { memory: "4Gi", cpu: "2" }
env:
  - name: GOMEMLIMIT
    value: "3600MiB"      # ~90% of 4Gi: soft ceiling keeps Go reclaiming
  - name: GOMAXPROCS      # match CPU limit so the GC sizes its worker pool right
    value: "2"
```

**Why `GOMEMLIMIT` is the k8s game-changer.** Before Go 1.19, a Go service in a tight container would either OOM (heap grew past the limit between collections) or you'd hack a ballast. `GOMEMLIMIT` makes the GC *aware of the ceiling*: as the heap approaches it, the GC runs harder to stay under, trading CPU for survival. The idiom is **high `GOGC` (or off) + `GOMEMLIMIT`**: collect lazily for throughput on a normal day, but never breach the limit on a bad one. Set it to ~90–95% of the cgroup limit (leave room for non-heap Go memory and the kernel's slack).

**`GOMAXPROCS` and CPU limits.** A Go process not told its CPU limit may spawn 64 GC workers on a 2-CPU pod, causing throttling and *worse* pauses. Set `GOMAXPROCS` to the CPU limit (or use `automaxprocs`). The JVM analog: `ActiveProcessorCount` / cgroup CPU awareness sizing the GC thread pool.

## War Stories

Each is a real pattern. Symptom → misdiagnosis → root cause → fix.

**War story 1 — "The deploy that doubled p999."**
*Symptom:* right after a release, p999 latency doubled; GC% climbed from 3% to 11%. *Misdiagnosis:* "the GC is broken, switch to ZGC." *Root cause:* a new JSON-serialization path allocated a fresh 64 KB buffer per request — an **allocation regression**. GC frequency tripled because the heap filled three times faster. *Fix:* pooled the buffer (`sync.Pool` / reused `byte[]`); GC% and p999 returned to baseline. **Lesson:** a sudden GC% jump after a deploy is almost always an allocation regression, not a collector problem. Diff the allocation flame graph against the previous release.

**War story 2 — "Healthy heap, dead pod."**
*Symptom:* pods OOMKilled every few hours; heap dashboard showed heap comfortably under `-Xmx`. *Misdiagnosis:* "raise the memory limit." *Root cause:* a native library (compression) allocated **off-heap direct byte buffers** that don't count against `-Xmx` but do count against the cgroup; total RSS crossed the 4 Gi limit. *Fix:* capped `-XX:MaxDirectMemorySize`, lowered `MaxRAMPercentage` to leave headroom, and alerted on **container RSS**, not just heap. **Lesson:** the heap is not the process. Watch RSS vs. cgroup limit.

**War story 3 — "The midnight Full GC cliff."**
*Symptom:* nightly at peak, p999 spiked to 1.5 s for ~30 s, then recovered. *Misdiagnosis:* "network blip." *Root cause:* under the nightly batch overlay, G1 hit an **evacuation failure** — no room to promote survivors — and fell back to a serial **Full GC**. *Fix:* lowered `InitiatingHeapOccupancyPercent` from 70 to 40 (start concurrent marking earlier), added heap headroom, and shed batch load. Full GCs disappeared. **Lesson:** a periodic latency cliff that matches a load pattern smells like Full GC / promotion failure. Grep the GC log for `Full`.

**War story 4 — "The leak that looked like a tuning problem."**
*Symptom:* over ~36 hours GC frequency crept up and pauses lengthened; restarting "fixed" it. *Misdiagnosis:* "tune GOGC / MaxGCPauseMillis." *Root cause:* an unbounded in-memory cache (no eviction) — **heap-after-GC trended upward** the whole time. *Fix:* bounded the cache (LRU with a size cap); no GC flag involved. **Lesson:** rising *floor* of heap-after-GC = leak. Tuning a leak only postpones the OOM. The restart "fix" is the tell.

**War story 5 — "ZGC stalled."**
*Symptom:* moved a high-allocation service to ZGC for the sub-ms pauses; instead saw periodic multi-hundred-ms latency spikes. *Misdiagnosis:* "ZGC is buggy." *Root cause:* the service allocated faster than ZGC could reclaim; threads hit **allocation stalls** waiting for memory. *Fix:* reduced allocation rate and added headroom so the collector stayed ahead of the mutator; ZGC then delivered as advertised. **Lesson:** low-pause collectors must *win the race with allocation*. Give them headroom and don't feed them a firehose.

**War story 6 — "Finalizer backlog."**
*Symptom:* intermittent long pauses uncorrelated with allocation; a growing finalizer queue. *Root cause:* objects with `finalize()`/`Cleaner`s wrapping native resources piled up faster than the single finalizer thread could process, stalling reference processing. *Fix:* replaced finalizers with explicit `close()`/try-with-resources and `-XX:+ParallelRefProcEnabled`. **Lesson:** finalizers and weak/soft/phantom references add a GC phase that can stall independently of heap pressure.

## Mental Models

**Model 1: "The GC is a dependency with an SLO."** Treat its pause budget like a downstream service's latency budget — measured, alerted, capacity-planned.

**Model 2: "RSS is the truth; heap is a subplot."** In containers, the kernel kills on total RSS vs. cgroup limit. Always know your non-heap budget.

**Model 3: "A GC% jump is a deploy diff."** Sudden throughput cost after a release → bisect to the allocation regression, not the collector.

**Model 4: "Restart-fixes-it = leak."** Any GC symptom cured by a restart and recurring on a schedule is a retention bug until proven otherwise.

## Code Examples

**SLO-anchored G1 config (p999 < 200 ms, ~30 ms pause budget):**
```bash
java -Xms6g -Xmx6g -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=30 \
  -XX:InitiatingHeapOccupancyPercent=40 \
  -XX:+ParallelRefProcEnabled \
  -Xlog:gc*,gc+ergo*=debug:file=/var/log/gc.log:time,uptime,tags:filecount=8,filesize=32m
```

**A leak-detection alert expression (PromQL-style, conceptual):**
```
# Page if heap-after-GC floor rises >5% per hour for 3h — a leak signature.
deriv(min_over_time(jvm_gc_live_data_size_bytes[1h])[3h:]) > 0
```

**Go k8s deployment env (the full recipe):**
```yaml
env:
  - name: GOMEMLIMIT
    value: "3600MiB"
  - name: GOGC
    value: "200"            # lazy on normal days; GOMEMLIMIT caps the bad days
  - name: GOMAXPROCS
    value: "2"              # match CPU limit
  - name: GODEBUG
    value: "gctrace=1"      # narrate GC to stdout for log-based dashboards
```

## Operational Patterns

- **Canary GC metrics on every deploy.** Compare GC% and pause p99 of the canary vs. baseline before promoting. Catches allocation regressions (war story 1) automatically.
- **Heap-dump-on-OOM, automatically.** `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=...` so an OOM is debuggable post-mortem, not just a crash.
- **Continuous profiling** (async-profiler / Pyroscope / `pprof` endpoints) so the allocation flame graph is always available, not something you scramble to attach mid-incident.
- **Two-layer memory alerting:** heap-after-GC trend (leaks) *and* container RSS vs. limit (OOMKill prevention).
- **Load-test the tail at 2× peak** as a release gate for latency-critical services.

## Best Practices

- **Derive GC settings from an SLO budget** with a percentile and a load condition; validate by load test, not by the flag's promise.
- **In containers, size heap below the cgroup limit** and alert on RSS, not just heap.
- **Use `GOMEMLIMIT` + matched `GOMAXPROCS`** in k8s; `MaxRAMPercentage` + container support on the JVM.
- **Make allocation profiles a release gate**; treat a GC% jump as a regression.
- **Distinguish leak from tuning** via heap-after-GC trend before touching a flag.
- **Pair tuning with backpressure** so the collector can win the allocation race under burst.

## Edge Cases & Pitfalls

- **Off-heap memory eats the cgroup headroom** (direct buffers, native libs, memory-mapped files). Cap and account for it; heap dashboards won't show it.
- **`GOMAXPROCS`/JVM CPU-count mismatch** in throttled pods spawns too many GC workers → throttling → *worse* pauses. Match to the CPU limit.
- **Logging to a slow disk** can itself stall the app during heavy GC logging; log async or to a fast volume.
- **Tuning on a quiet environment** that doesn't reproduce production allocation rates yields settings that collapse under real load. Tune against production-like load.
- **Forgetting the bad day.** Settings validated at average QPS fail at peak; always tune and test at the load you're afraid of.

## Summary

At the professional level, GC tuning is **SLO-driven and incident-shaped**. You turn a latency target (with a percentile *and* a load condition) into a **pause budget**, which picks your collector and heap size, then **validate under 2× peak load** and **wire it into alerting** — with GC pause p99 and heap-after-GC trend as leading indicators. The dominant real-world failure mode is the **container/cgroup mismatch**: heap is not RSS, so you size the heap *below* the limit (`MaxRAMPercentage` / `GOMEMLIMIT`), match `GOMAXPROCS` to the CPU limit, and alert on RSS. The war stories rhyme: a **GC% jump after a deploy is an allocation regression**, a **rising heap-after-GC floor is a leak** (restart-fixes-it is the tell), a **periodic latency cliff is a Full GC / promotion failure**, and a **low-pause collector that stalls is losing the race with allocation**. None of those are fixed by a clever flag — they're fixed by measuring the right signal and addressing the actual cause.
