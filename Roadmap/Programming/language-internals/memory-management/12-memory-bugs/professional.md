# Memory Bugs — Professional Level

> **Topic:** [Memory Bugs](README.md)
> **Focus:** Production incident debugging under pressure — war stories, the discipline of bisecting a leak in a live system, capturing artifacts safely from constrained containers, and building leak resistance into CI and observability.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [The Incident Playbook](#the-incident-playbook)
- [War Stories](#war-stories)
- [Mental Models](#mental-models)
- [Code & Command Examples](#code--command-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

Everything before this tier assumed you could reproduce the bug, capture an artifact, and read it at leisure. Production rarely grants that. The professional-level reality is: the leak only manifests under real traffic, the container is memory-limited so a heap dump might kill it, you have one good capture before the next restart, the OOM killer leaves no stack trace, and the dashboard shows a slope measured in hours. The skill is **debugging a memory bug in a live system without making it worse**, under a clock, with partial information.

This tier is about *operational* memory debugging: a repeatable incident playbook, the judgment to choose the safe capture method, the technique of **bisecting a leak** across deploys and feature flags, and — crucially — building the system so future leaks announce themselves in CI and on dashboards instead of at 3 a.m. The war stories here are the three you'll meet repeatedly: the slow reachable-object leak, the fragmentation-driven RSS creep, and the goroutine/thread leak.

---

## Prerequisites

- Senior-level model: the four-cause taxonomy (retention / fragmentation / off-heap / churn), ownership and lifetime design, dominator analysis.
- Operational fluency: reading dashboards, GC logs, container limits, and orchestrator (Kubernetes/Nomad) OOM behavior.
- The ability to safely manipulate a live service: scale replicas, drain traffic, capture artifacts, toggle flags.

---

## Glossary

| Term | Meaning |
|---|---|
| **OOM killer** | The Linux kernel mechanism that kills a process when the system/cgroup exceeds its memory limit. Leaves a kernel log line, not an app stack trace. |
| **cgroup limit** | The hard memory cap a container runs under; hitting it triggers the OOM killer regardless of runtime health. |
| **Working set** | The memory actively used over a window; orchestrators often evict/kill based on this, not just RSS. |
| **Leak bisection** | Narrowing a leak's introduction to a specific deploy, commit, or feature flag by comparing memory slopes across versions/configs. |
| **Heap-growth assertion** | A test that fails if memory after N iterations exceeds a baseline — a leak caught in CI. |
| **Canary** | A small fraction of traffic routed to a new version to observe behavior (including memory slope) before full rollout. |
| **`-XX:+HeapDumpOnOutOfMemoryError`** | JVM flag to auto-capture a heap dump at the moment of OOM — the artifact you wish you'd had. |
| **Burn rate** | How fast you're consuming a budget; here, MB/hour of memory growth, which sets your time-to-OOM. |

---

## The Incident Playbook

When the page fires for "memory climbing / pod OOM-killed," run this sequence:

1. **Stabilize, don't lose evidence.** If OOM is imminent, you have competing goals: keep serving and capture an artifact. Add a replica or raise the limit *temporarily* to buy time — but first ensure `-XX:+HeapDumpOnOutOfMemoryError` (JVM) or equivalent is on, so even a crash yields a dump. Never just restart-and-hope; that destroys the only evidence.

2. **Read the slope, compute time-to-OOM.** From the memory dashboard, get MB/hour. `(limit − current) / burn_rate` is your clock. This decides whether you have hours to investigate live or minutes to drain and capture.

3. **Classify with the four-cause branch — fast.** Pull GC logs and RSS-vs-heap. Is the *post-GC* heap rising (retention) or flat (fragmentation/off-heap/churn)? Is native memory accounting for the gap? Ten minutes here saves hours of wrong-tool investigation.

4. **Capture the right artifact safely.** Retention → heap dump from a *drained* replica or a copy, never the one serving peak traffic in a tight cgroup. Churn → continuous allocation profiler (already running, ideally). Goroutine/thread leak → goroutine/thread dump (cheap, safe). Off-heap → NMT / `pmap` / native profiler.

5. **Bisect if the artifact doesn't immediately name the cause.** Correlate the slope's onset with the deploy timeline. Did the slope start at a specific release? Toggle the suspect feature flag on a canary and watch whether the slope follows.

6. **Mitigate now, fix properly later.** Immediate mitigations: scheduled restart / rolling recycle to cap growth, raise limit, disable the offending flag, bound the offending cache via config. These stop the bleeding. The real fix (break the reference, copy the slice, cancel the goroutine) ships after.

7. **Write it up and add a guard.** Every memory incident should leave behind a heap-growth test, a dashboard panel, or an alert that would have caught it earlier. A leak that recurs is a process failure, not a code failure.

---

## War Stories

### War story 1 — The classic slow leak (the unbounded cache)

**Symptom:** A JSON API runs clean for ~7 hours, then pods get OOM-killed in a rolling wave during peak. No app errors, no stack trace — just kernel OOM lines. Restarts reset the clock.

**Investigation:** The memory dashboard shows a textbook rising post-GC floor: every minor GC reclaims slightly less, the baseline creeps up ~120 MB/hour. That's retention. We drained one replica, captured a heap dump to a mounted volume (the live pods were too close to the cgroup limit to dump safely), and opened it in MAT. The Leak Suspects report immediately flagged one `ConcurrentHashMap` with a retained size of 1.4 GB. Path-to-GC-root: a `static` field on a `MetricsRegistry`. The map was keyed by *full request URL including query string* — effectively unbounded cardinality. Every unique URL added an entry that never expired.

**Fix:** Bounded the map to an LRU with a 50k cap and normalized the key to the route template (`/users/{id}`) instead of the raw URL. **Mitigation while the fix shipped:** a 6-hourly rolling restart kept pods under the limit. **Guard added:** a heap-growth integration test that fires 100k distinct request paths and asserts heap growth stays under a threshold.

**Lesson:** The bug wasn't "a cache" — it was *unbounded key cardinality*. The most dangerous leaks are caches that look bounded until you realize the key space isn't.

### War story 2 — Fragmentation-driven RSS creep (the clean heap dump)

**Symptom:** A long-running JVM data service slowly climbed from 4 GB to 11 GB RSS over a week, then got OOM-killed. We heap-dumped it — and the *live heap was a flat 3.5 GB.* The dump was clean. Hours wasted re-reading it.

**Investigation:** The RSS-vs-live 2×2 was screaming: heap flat, RSS rising → *not a reachable-object leak.* We enabled Native Memory Tracking and ran `pmap`. The gap wasn't off-heap allocations either — `jcmd VM.native_memory` showed the heap region itself *committed* far more than it *used.* It was **fragmentation plus the collector not returning committed memory to the OS.** The workload allocated a mix of small and very large objects; the large-object space fragmented, and the collector held committed pages it couldn't compact.

**Fix:** Switched to a collector configuration that compacts and proactively uncommits idle memory (and tuned the large-object handling). RSS stabilized around the live set.

**Lesson:** A clean heap dump is *evidence*, not failure. If the live set is flat and RSS climbs, the heap analyzer is the wrong tool *by construction*. Trust the 2×2 and pivot to native/fragmentation analysis instead of re-staring at the dump.

### War story 3 — The goroutine leak (the invisible accumulation)

**Symptom:** A Go API gateway's memory crept up steadily under load. Heap profile (`inuse_space`) showed nothing dramatic — no single huge holder. Yet RSS climbed and eventually OOM'd.

**Investigation:** The tell was a metric we'd wired in early: `runtime.NumGoroutine()`. It climbed in perfect lockstep with memory, into the hundreds of thousands. We hit `/debug/pprof/goroutine?debug=2` and saw tens of thousands of goroutines all parked at the same line: a `select` reading from a channel that an upstream timeout path never closed. Each inbound request that timed out spawned a goroutine that blocked *forever* waiting on a response that would never come, each pinning its request context and buffers.

**Fix:** Added `context` cancellation and a `select { case <-ch: case <-ctx.Done(): }` so the goroutine exits when the request is cancelled. Goroutine count flattened; memory followed.

**Lesson:** Goroutine/thread leaks hide from heap profilers because the retained memory is spread thinly across thousands of small stacks and contexts. **Goroutine/thread count is a first-class leak SLI** — without that metric, this leak is nearly invisible.

---

## Mental Models

### The clock model

Under an active incident, every decision is governed by *time-to-OOM = headroom / burn-rate*. A 50 MB/hour leak with 4 GB headroom gives you 80 hours — investigate live, calmly. A 2 GB/hour leak with 500 MB headroom gives you 15 minutes — drain a replica and capture *now*, mitigate, investigate after. Reading the slope first prevents both panic and complacency.

### Evidence-before-restart

The default ops instinct — "just restart it" — destroys the one heap dump that would solve the case in five minutes. The professional reflex is *capture, then restart.* Build the system so a crash auto-captures (`HeapDumpOnOutOfMemoryError`, core dumps, retained pprof) — because the OOM that wakes you will not wait for you to attach a profiler.

### Bisection over inspection

When an artifact doesn't immediately name the cause, *don't read harder — narrow harder.* Memory slope is a measurable function of version and config. Bisect across deploys (when did the slope start?) and across flags (does the slope follow the toggle on a canary?). This converts an open-ended object-graph hunt into a binary search over your release timeline.

---

## Code & Command Examples

### Capturing a heap dump safely from a constrained container

```bash
# DON'T dump the pod serving peak traffic near its cgroup limit — the dump can OOM-kill it.
# DO: drain one replica from the load balancer, then capture to a mounted volume.

kubectl cordon/drain or remove pod from service endpoints first, then:
jmap -dump:live,format=b,file=/data/heap.hprof <pid>   # 'live' forces GC, shrinks dump, confirms retention
# Pull the file off the node and analyze offline in MAT — never analyze in the live container.
```

### Always-on safety net (set these before the incident)

```text
# JVM: capture automatically at the moment of OOM
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/oom.hprof
-Xlog:gc*:file=/data/gc.log          # GC logs reveal post-GC occupancy = the floor
-XX:NativeMemoryTracking=summary      # so off-heap is accountable when you need it
```

```go
// Go: keep pprof endpoints available and export the two leak SLIs.
import _ "net/http/pprof"
// Export as metrics on a timer:
//   runtime.NumGoroutine()              -> goroutine-leak SLI
//   runtime.ReadMemStats(&m); m.HeapInuse, m.HeapSys (RSS-ish) -> retention vs fragmentation
```

### A heap-growth leak test for CI

```go
func TestNoLeakUnderRepeatedLoad(t *testing.T) {
    var before, after runtime.MemStats
    warmUp() // let pools/caches reach steady state first
    runtime.GC(); runtime.ReadMemStats(&before)

    for i := 0; i < 100_000; i++ {
        handleRequest(uniqueRequest(i)) // distinct keys stress unbounded caches
    }

    runtime.GC(); runtime.ReadMemStats(&after)
    growth := int64(after.HeapInuse) - int64(before.HeapInuse)
    if growth > 8<<20 { // 8 MiB tolerance after warm-up
        t.Fatalf("heap grew %d MiB across 100k iterations — suspected leak", growth>>20)
    }
}
```

The `warmUp` + `runtime.GC()` framing is essential: without it, one-time initialization and pool fill-up produce false positives. The test asserts the *floor* is flat under repeated, *distinct-key* load — exactly the condition that exposes unbounded caches.

### Bisecting a leak across deploys

```bash
# Annotate the memory dashboard with deploy markers, then ask: when did the slope appear?
# If it correlates with release v1.42, diff v1.41..v1.42 for new caches/listeners/goroutines:
git log --oneline v1.41..v1.42 -- '**/cache*' '**/registry*' '**/*listener*'
# For flag-gated code, toggle the suspect flag on a canary and watch whether the slope follows.
```

---

## Pros & Cons

**Scheduled restart / pod recycling as mitigation**
- Pro: instantly caps growth; buys time; trivial to deploy.
- Con: masks the real bug; raises restart noise; hides slow leaks for months if treated as a fix. Use as a tourniquet, never a cure.

**Always-on production profilers (continuous profiling)**
- Pro: the artifact already exists when the incident hits; no scramble to attach tools.
- Con: overhead and storage cost; must be sampled cheaply enough to run safely under load.

**Auto-heap-dump on OOM**
- Pro: captures the exact moment of failure — the most valuable artifact, for free.
- Con: a multi-GB dump write can slow shutdown and needs durable, mounted storage to survive the pod's death.

---

## Use Cases

- **On-call triage of an OOM-killed pod** with no app stack trace → playbook steps 1–4: stabilize, read slope, classify, capture from a drained replica.
- **A slope that appeared "sometime last sprint"** → bisect across deploys and flags rather than open-ended graph hunting.
- **A clean heap dump on a climbing-RSS service** → pivot to native/fragmentation analysis; don't re-read the dump.
- **Recurring memory incidents** → invest in heap-growth CI tests, goroutine-count SLIs, and dashboard deploy markers so the *next* one is caught pre-production.

---

## Coding Patterns

- **Auto-capture-on-failure:** wire `HeapDumpOnOutOfMemoryError` / core dumps / retained pprof so a crash yields evidence without human intervention.
- **Two leak SLIs always exported:** post-GC heap occupancy (retention) and goroutine/thread count (accumulation leaks).
- **Drain-then-dump:** never capture heavyweight artifacts from a replica serving peak traffic in a tight limit.
- **Warm-up-then-assert:** CI heap-growth tests warm up, force GC, then measure the floor under distinct-key load.
- **Config-bounded caches:** cache sizes/TTLs are config-tunable so you can *mitigate* a leak by tightening bounds without a deploy.

---

## Best Practices

1. **Set the safety-net flags before you need them.** `HeapDumpOnOutOfMemoryError`, GC logging, NMT, and pprof endpoints must be on *in production* — you cannot add them after the OOM.
2. **Capture before you restart.** The restart that ends the page also destroys the evidence. Drain a replica and dump first.
3. **Read the slope, compute the clock.** Let time-to-OOM dictate whether you investigate live or mitigate-and-defer.
4. **Classify before you capture.** The four-cause branch tells you *which* artifact is worth the risk of capturing in production.
5. **Bisect across deploys and flags** when the artifact is ambiguous; memory slope is a function of version and config.
6. **Mitigate with restarts/limits/flag-toggles, but never call that a fix.** The tourniquet stops bleeding; the surgery still has to happen.
7. **Leave a guard behind.** Every incident yields a heap-growth test, an SLI, or an alert. Otherwise it recurs.

---

## Edge Cases & Pitfalls

- **Dumping the wrong pod under pressure** can OOM-kill it mid-capture and corrupt the dump. Always drain first and write to durable storage off the pod's ephemeral disk.
- **The OOM killer leaves no app trace.** Engineers waste time searching application logs for a crash that lives only in `dmesg`/kernel logs. Check the orchestrator's OOM events, not just app logs.
- **Restart-masking hides slow leaks indefinitely.** If pods recycle every few hours "for hygiene," a 100 MB/hour leak is invisible. Track *memory slope between restarts*, not just crash counts.
- **Heap-growth CI tests without warm-up are flaky.** One-time init and pool fill-up look like leaks. Warm up, GC, *then* measure — and tolerate a small baseline.
- **Canary too small or too short** won't surface a slow leak; a leak that needs hours of traffic won't show in a ten-minute canary. Match canary duration to the burn rate you expect.
- **Continuous profiler overhead under an already-stressed system** can tip a borderline service over. Keep sampling cheap and validate the profiler's own footprint.
- **Native/off-heap leaks ignore `runtime.GC()` and `System.gc()`.** Forcing collection won't reclaim `mmap`/JNI/direct-buffer memory whose wrappers are still reachable — and a heap-growth test that only checks heap will miss it entirely.

---

## Summary

- Production memory debugging is **operational**: the leak only shows under real traffic, the container is constrained, the OOM killer leaves no app trace, and you're on a clock. The playbook is **stabilize-without-losing-evidence → read the slope → classify → capture safely → bisect → mitigate → guard.**
- The three recurring war stories — **the unbounded-cache slow leak, the fragmentation-driven clean-dump RSS creep, and the invisible goroutine/thread leak** — teach the same meta-lessons: caches fail on *key cardinality*, a *clean dump is evidence not failure*, and *goroutine/thread count is a first-class leak SLI.*
- **Capture before you restart**, and set the safety-net flags (`HeapDumpOnOutOfMemoryError`, GC logs, NMT, pprof) *before* the incident — you can't add them mid-OOM.
- **Bisect across deploys and feature flags** when an artifact is ambiguous; memory slope is a measurable function of version and config.
- Treat restarts/limits/flag-toggles as **tourniquets, not cures**, and leave every incident with a **heap-growth CI test, a leak SLI, or an alert** so the system catches the next leak before the pager does.
