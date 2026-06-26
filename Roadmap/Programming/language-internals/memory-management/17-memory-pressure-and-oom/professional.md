# Memory Pressure & OOM — Professional Level
> **Topic:** [Memory Pressure & OOM](README.md)
> **Focus:** Production memory incidents in Kubernetes and containers — QoS, eviction, exit 137, war stories, and the config recipes that prevent them.

---

## Table of Contents
- [Introduction](#introduction)
- [Core Concepts](#core-concepts)
  - [Requests vs limits, and why limits should equal requests for memory](#requests-vs-limits-and-why-limits-should-equal-requests-for-memory)
  - [QoS classes and eviction order](#qos-classes-and-eviction-order)
  - [Two ways a pod dies: OOMKilled vs node-pressure eviction](#two-ways-a-pod-dies-oomkilled-vs-node-pressure-eviction)
  - [Noisy neighbors and node-level pressure](#noisy-neighbors-and-node-level-pressure)
- [War Stories](#war-stories)
  - [The CrashLoopBackOff from a too-low limit](#war-story-1-the-crashloopbackoff-from-a-too-low-limit)
  - [The swap-thrash livelock](#war-story-2-the-swap-thrash-livelock)
  - [The GC death spiral at the limit](#war-story-3-the-gc-death-spiral-at-the-limit)
  - [Off-heap blew the cgroup while the heap looked fine](#war-story-4-off-heap-blew-the-cgroup-while-the-heap-looked-fine)
- [Diagnosis Playbook](#diagnosis-playbook)
- [Config Recipes](#config-recipes)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

In production, memory pressure stops being a kernel abstraction and becomes a pager going off at 3am with `CrashLoopBackOff`, a dashboard of exit code 137s, and a customer-facing latency spike. The professional level is about operating real systems — almost always containerized, usually orchestrated by Kubernetes — where the failure modes from the lower tiers compound with scheduler decisions, multi-tenant nodes, and runtimes that don't know how much memory they actually have.

This tier is structured around what you actually do on the job: understand how the orchestrator allocates and reclaims memory, recognize the handful of incident shapes that recur endlessly, run a disciplined diagnosis, and apply the config that prevents recurrence. The war stories are composites of the most common real incidents.

---

## Core Concepts

### Requests vs limits, and why limits should equal requests for memory

Kubernetes gives each container two memory numbers:

- **`requests.memory`** — what the scheduler *reserves*; it places the pod on a node with at least this much allocatable memory. Pure scheduling input.
- **`limits.memory`** — the cgroup `memory.max`; cross it and the container is OOM-killed. Pure runtime enforcement.

When `requests < limits`, the pod is allowed to *burst* above its reservation — using memory the scheduler never guaranteed it. This works until the node fills, at which point that burst memory isn't there, and the pod (or a neighbor) gets killed. The burst is a loan the node may not be able to honor.

**For memory specifically, setting `requests == limits` is the safest default.** Memory is incompressible — unlike CPU, you can't "throttle" a container to use less memory; you can only kill it. Making request equal limit means the scheduler reserves exactly what the cgroup will enforce: no surprise bursting, predictable placement, and the pod lands in the **Guaranteed** QoS class (below) with the strongest protection against eviction. The cost is lower bin-packing density — you can't oversubscribe — which is a deliberate, honest trade of utilization for predictability. Teams that oversubscribe memory to save on nodes are buying noisy-neighbor incidents.

### QoS classes and eviction order

Kubernetes derives a **Quality of Service class** from your requests/limits, and uses it to decide *who dies first* when a node runs low:

- **Guaranteed** — every container has `requests == limits` for both memory and CPU. Highest protection; evicted last.
- **Burstable** — at least one container has a request lower than its limit (or only a request). Can burst, evicted in the middle.
- **BestEffort** — no requests or limits at all. Uses whatever's left; evicted *first* and hardest.

Under **node memory pressure**, the kubelet evicts in order: BestEffort first, then Burstable pods that have exceeded their *requests* (ranked by how far over they are), and Guaranteed pods last. The practical lesson: a BestEffort pod is a sacrificial victim by design, and a Burstable pod that habitually runs above its request is volunteering to be evicted. If a pod matters, make it Guaranteed.

### Two ways a pod dies: OOMKilled vs node-pressure eviction

These look similar (pod gone, restart) but are *different mechanisms* with different fixes, and confusing them is the most common diagnostic error:

**1. OOMKilled (exit code 137) — cgroup-level, the kernel acts.**
The container exceeded *its own* `limits.memory`. The kernel's cgroup OOM killer `SIGKILL`s a process inside it (137 = 128 + signal 9). `kubectl describe pod` shows:
```
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       OOMKilled
      Exit Code:    137
```
This is **about one container hitting its own limit**, regardless of node health. The fix lives with the container: raise the limit, fix the leak, or size the runtime correctly.

**2. Node-pressure eviction — kubelet-level, the orchestrator acts.**
The *node* (not the container) ran low on allocatable memory, so the kubelet proactively *evicts* whole pods to reclaim it before the node-wide OOM killer fires and kills things uncontrollably. The pod's status is `Evicted` with a message like `The node was low on resource: memory`. This is **about the node, not the container** — a perfectly well-behaved pod can be evicted because *neighbors* overran. The fix lives with the node/scheduling: better requests, fewer oversubscribed neighbors, more node memory.

Same symptom (pod restarted), opposite root cause (my limit vs the node's capacity). Always check the *reason* field, not just that a restart happened.

### Noisy neighbors and node-level pressure

A node packs many pods. If pods are Burstable and oversubscribed, several can burst simultaneously and exhaust node memory even though each is "within its limit." The result is collateral damage: a well-behaved Guaranteed pod is fine, but Burstable/BestEffort neighbors get evicted, and if eviction can't keep up, the node's *global* OOM killer fires and can kill anything — including processes the kubelet wanted to protect. This is the **noisy neighbor** problem, and it's the strongest practical argument for `requests == limits` on anything that matters: oversubscription externalizes your risk onto your neighbors.

---

## War Stories

### War Story 1: The CrashLoopBackOff from a too-low limit

**Symptom.** A new service deploys fine, serves traffic for 30–90 seconds, then `OOMKilled` (exit 137), restarts, and repeats — `CrashLoopBackOff`. Crucially, it's *not* a leak: it dies at roughly the same RSS every time.

**Root cause.** The `limits.memory` was copied from a smaller service (say 256Mi) but this service's *steady-state* working set under real traffic is ~400Mi. The limit is simply below the legitimate working set. Each restart re-warms caches and connection pools, climbs past 256Mi, and gets killed before it stabilizes — the warm-up itself guarantees the kill.

**Diagnosis.** `kubectl describe pod` → `Last State: Terminated, Reason: OOMKilled, Exit Code: 137`. RSS metric shows a sawtooth that always peaks at the limit. No upward trend across restarts (rules out a leak).

**Fix.** Right-size the limit from observed working set (peak RSS under load + headroom), not from a template. This is the single most common Kubernetes memory incident, and it's a *configuration* bug, not a code bug. The trap is "fix" by infinitely bumping the limit without ever measuring the actual working set.

### War Story 2: The swap-thrash livelock

**Symptom.** A node (or a VM running a non-containerized service) stops responding to new requests, but doesn't crash. SSH itself takes minutes. CPU shows mostly idle/iowait; disk I/O is pinned at 100%. The system is "up" but doing no useful work — for 20 minutes.

**Root cause.** Swap was enabled, the working set grew past RAM, and the system entered a **thrashing livelock**: every needed page gets swapped out and immediately faulted back in, so nearly all time is spent shuttling pages between RAM and disk. No process is ever killed because, technically, an allocation always *eventually* succeeds — it just takes forever. The OOM killer never fires because reclaim "succeeds" (via swap), it's just catastrophically slow.

**Diagnosis.** `vmstat 1` shows huge `si`/`so` (swap-in/swap-out) columns; PSI `full avg10` near 100%; load average climbing with idle CPU. The tell is high iowait + pinned disk + frozen responsiveness *without* an OOM-kill log.

**Fix.** Short-term: kill the offending process manually to break the livelock. Long-term: disable disk swap for latency-sensitive nodes (so pressure resolves into a *fast* OOM-kill instead of a slow livelock), or move swap to **zram/zswap** (compressed RAM) where the page-shuffle cost is orders of magnitude lower. This is the canonical argument for "swap off in production" — a fast clean kill beats a slow node-wide meltdown.

### War Story 3: The GC death spiral at the limit

**Symptom.** A JVM/Go service's latency suddenly degrades 10–50×, CPU pins at 100%, throughput craters — but the process *doesn't die* (or dies much later than expected). GC time dominates CPU profiles.

**Root cause.** The live working set grew to nearly the heap/soft limit — an unbounded cache, or a traffic surge inflating in-flight state. The GC runs back-to-back collections, each freeing almost nothing because the memory is *live, not garbage*. The JVM may log `GC overhead limit exceeded`; Go with a tight `GOMEMLIMIT` burns CPU collecting constantly. The service is alive but useless.

**Diagnosis.** GC logs show collection frequency climbing while reclaimed bytes shrink. CPU is GC-dominated. Heap-after-GC stays high and flat (live set, not garbage). The trap is to "tune the GC" — no GC setting fixes a live set that doesn't fit.

**Fix.** Bound the cache, shed load to shrink the working set, or raise the limit if the working set is legitimate. The deeper fix is a soft limit (`GOMEMLIMIT`, `memory.high`) plus PSI-driven load shedding so the spiral becomes an *observable, alertable* degradation you shed against — rather than a silent latency cliff or a surprise kill.

### War Story 4: Off-heap blew the cgroup while the heap looked fine

**Symptom.** A Java service is `OOMKilled` (exit 137) repeatedly, but every heap dump and JVM metric shows the heap comfortable at ~55% of `-Xmx`. The team raises `-Xmx`, and the kills get *more frequent*.

**Root cause.** The container is killed because *total RSS* — heap **plus native memory** — exceeded the cgroup `memory.max`. The culprit is off-heap: a flood of direct `ByteBuffer`s (Netty, a Kafka client), an unbounded thread pool inflating thread-stack memory, metaspace growth from dynamic class generation, or glibc arena fragmentation. The heap monitor is blind to all of it. Raising `-Xmx` made it worse: a bigger heap left *less* room for native memory inside the same fixed container, so the cgroup limit was hit *sooner*.

**Diagnosis.** Compare JVM heap-used against container RSS (`kubectl top pod` / cgroup `memory.current`): the gap *is* the native memory. Enable JVM Native Memory Tracking (`-XX:NativeMemoryTracking=summary`, then `jcmd <pid> VM.native_memory summary`) to attribute the off-heap growth. The signature is RSS climbing while heap is flat.

**Fix.** Size the heap *down* to leave native headroom (`-XX:MaxRAMPercentage=75`), cap the off-heap source (bound direct-buffer pools, limit thread count, cap metaspace with `-XX:MaxMetaspaceSize`), and consider switching glibc `malloc` for jemalloc/tcmalloc if arena fragmentation is the driver. The governing rule: **the managed heap is a fraction of the container, never the whole thing.**

---

## Diagnosis Playbook

When a process or pod dies on memory, work the evidence in order:

1. **Get the death reason, not just the symptom.** `kubectl describe pod` → look at `Last State / Reason` (`OOMKilled` vs `Evicted`) and `Exit Code` (137 = OOM-kill). For bare metal/VM: `dmesg -T | grep -i "out of memory"` for the `Killed process … anon-rss:…` line — it names the victim, its RSS, and the triggering cgroup.

2. **OOMKilled vs Evicted?** `OOMKilled`/137 → *this container* hit *its* limit (cgroup). `Evicted` → the *node* ran low and the kubelet evicted (look at the node and its neighbors). Different root cause, different owner.

3. **Leak vs spike vs undersized limit.** Plot RSS over time:
   - **Leak** — monotonic upward trend across hours/restarts; RSS never plateaus. → find the leak.
   - **Spike** — sharp transient correlated with a traffic/job event. → bound the spike (load shed, cap request size, backpressure).
   - **Undersized limit** — RSS plateaus at a sane steady state that simply exceeds the configured limit; same peak every restart. → raise the limit / right-size.

4. **Heap vs native (managed runtimes).** Compare runtime heap-used to container RSS. A large, growing gap = native/off-heap is the problem; the heap profiler will lie to you. Use NMT (JVM) / `runtime.MemStats` + RSS (Go).

5. **Pressure, not just usage.** Check PSI (`/proc/pressure/memory`, or cgroup-scoped `memory.pressure`) and `vmstat 1` (`si`/`so` for thrash). Sustained `full` PSI or heavy swap-in/out means you're stalling on memory well before any kill.

---

## Config Recipes

**Go service in Kubernetes — `GOMEMLIMIT` matched to the cgroup limit.**
Set the soft limit to ~90% of `memory.max` so Go's GC collects hard before the kernel kills. With `requests == limits`:
```yaml
resources:
  requests: { memory: "512Mi" }
  limits:   { memory: "512Mi" }
env:
  - name: GOMEMLIMIT
    value: "460MiB"      # ~90% of 512Mi, leaving margin for non-heap + spike
  # GOGC can stay default; GOMEMLIMIT acts as the backstop
```
The downshift to ~90% reserves headroom for Go's stacks, runtime structures, and short-lived allocation spikes between GC cycles.

**JVM in a container — size relative to the limit, leave native headroom.**
```yaml
resources:
  requests: { memory: "2Gi" }
  limits:   { memory: "2Gi" }
env:
  - name: JAVA_TOOL_OPTIONS
    value: >-
      -XX:+UseContainerSupport
      -XX:MaxRAMPercentage=75.0
      -XX:MaxMetaspaceSize=256m
      -XX:NativeMemoryTracking=summary
```
`MaxRAMPercentage=75` caps the heap at ~1.5Gi of the 2Gi container, deliberately reserving ~512Mi for metaspace, thread stacks, direct buffers, and JIT code. `MaxRAMPercentage=100` would guarantee a cgroup kill.

**Reading an OOM line from `dmesg`.**
```
Out of memory: Killed process 2847 (java) total-vm:4521088kB, anon-rss:1987456kB, file-rss:12044kB, ...
oom-kill: ... oom_memcg=/kubepods/burstable/pod3f.../...,task_memcg=...,task=java,...
```
`anon-rss` (~1.9Gi here) is the real footprint; `oom_memcg` names the cgroup that hit its limit (confirming it's a *cgroup* OOM, not node-wide). `total-vm` (virtual) is large and irrelevant.

**Protecting / sacrificing a process with `oom_score_adj`.**
```bash
# Make a critical daemon (near) unkillable by the OOM killer:
echo -1000 > /proc/$(pidof critical-agent)/oom_score_adj
# Volunteer a batch worker to be killed first under pressure:
echo  1000 > /proc/$(pidof batch-worker)/oom_score_adj
```
Every process you protect pushes the kill onto another — use sparingly and deliberately.

---

## Best Practices

- **`requests == limits` for memory** on anything that matters → Guaranteed QoS, predictable scheduling, no surprise bursting, last to be evicted.
- **Right-size limits from observed working set**, not from a template or a guess. Measure peak RSS under realistic load, add headroom, set the limit there.
- **Never let the managed heap equal the container.** Reserve 25–35% (JVM) or ~10% (Go) for memory the runtime doesn't count.
- **Always read the *reason*, not just the restart.** `OOMKilled` (my limit) and `Evicted` (node pressure) demand different fixes.
- **Disable disk swap on latency-sensitive nodes** (fast clean kill > slow thrash livelock), or use zram/zswap if you need spike absorption.
- **Alert on soft limits and PSI**, not on the kill. The kill is the incident; PSI and soft-limit breaches are the early warning.
- **Compare heap-used to RSS continuously.** The gap is native memory; a growing gap is the early signal of off-heap trouble before it kills.

---

## Edge Cases & Pitfalls

- **Bumping the limit forever to stop CrashLoopBackOff** hides a leak. If RSS trends upward across restarts, raising the limit just delays the kill; find the leak.
- **Raising `-Xmx` to fix a cgroup OOM makes it worse** when the cause is off-heap — less room for native memory, sooner kill.
- **A pod evicted, not OOMKilled, is innocent.** Don't tune the evicted pod; fix the node's oversubscription / neighbors.
- **`kubectl top` lags and can mislead.** It samples; a fast spike-to-kill may not appear. Use it for trends, the OOM event for the kill.
- **JVM that ignores cgroup limits** (very old JDK or `UseContainerSupport` disabled) sizes the heap from the host → instant kill on a large multi-tenant node. Verify the JDK version.
- **Multi-container pods share the pod-level limit** in some configurations; a sidecar's growth can OOM the main container. Account for every container in the pod's budget.
- **Init/warm-up spikes exceed steady state.** A limit sized for steady-state RSS can OOM during cache warm-up or a startup migration; size for the warm-up peak, not the calm middle.

---

## Summary

Production memory pressure is dominated by a small set of recurring incident shapes, and competence is recognizing them fast. In Kubernetes, the two deaths to never confuse are **OOMKilled (exit 137)** — *this* container hit *its own* cgroup limit, fixed at the container — and **node-pressure eviction** — the *node* ran low and the kubelet shed pods, fixed at the node and its neighbors. Setting `requests == limits` for memory buys Guaranteed QoS, predictable placement, and freedom from noisy-neighbor collateral, trading utilization for safety. The four canonical war stories — a too-low limit CrashLooping, a swap-thrash livelock, a GC death spiral on a live set, and off-heap silently blowing the cgroup while the heap looks fine — cover most pages you'll ever get. The diagnosis discipline is always the same: read the *reason* not the symptom, separate leak from spike from undersized limit by plotting RSS over time, and compare heap-used to RSS to catch native memory. The config that prevents recurrence is unglamorous: right-sized limits from real working sets, the runtime told its true budget with headroom (`GOMEMLIMIT`, `MaxRAMPercentage`), swap decided deliberately, and alerts on PSI and soft limits rather than on the kill itself.
