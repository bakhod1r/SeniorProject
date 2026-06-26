# Memory Pressure & OOM — Senior Level
> **Topic:** [Memory Pressure & OOM](README.md)
> **Focus:** Designing services that degrade gracefully under memory pressure instead of crashing — backpressure, bounded resources, soft limits, and runtime cooperation.

---

## Table of Contents
- [Introduction](#introduction)
- [Core Concepts](#core-concepts)
  - [The three deaths: heap OOM vs native OOM vs cgroup OOM-kill](#the-three-deaths-heap-oom-vs-native-oom-vs-cgroup-oom-kill)
  - [Soft limits vs hard limits as a design primitive](#soft-limits-vs-hard-limits-as-a-design-primitive)
  - [Making the runtime aware of the container limit](#making-the-runtime-aware-of-the-container-limit)
  - [The GC death spiral](#the-gc-death-spiral)
  - [Graceful degradation: load shedding, backpressure, bounded resources](#graceful-degradation-load-shedding-backpressure-bounded-resources)
  - [Admission control and circuit breakers](#admission-control-and-circuit-breakers)
  - [Spill-to-disk and reducing concurrency](#spill-to-disk-and-reducing-concurrency)
- [Pros & Cons](#pros--cons)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

The middle tier covered the mechanisms the kernel uses under pressure. Senior engineering is about *not being a passive victim of them*. A service that simply runs until the cgroup OOM-kills it has made a design choice — usually unintentionally — to convert memory pressure into the worst possible outcome: an abrupt, uncatchable death with in-flight requests dropped and no chance to shed load or restart cleanly.

The senior goal is a service that, as memory tightens, slows down, sheds the least important work, signals upstream to back off, and stays *up* — rather than one that runs at full throttle into a wall. This requires understanding which of several distinct "out of memory" failures you're actually facing, designing limits as graduated rather than binary, and getting the language runtime to cooperate with the container instead of fighting it.

---

## Core Concepts

### The three deaths: heap OOM vs native OOM vs cgroup OOM-kill

A senior engineer must distinguish three failures that look superficially similar but have completely different causes and fixes:

1. **Managed-heap OOM** — the runtime's own heap limit is exhausted. Java throws `java.lang.OutOfMemoryError: Java heap space`; Go panics with `runtime: out of memory` / `fatal error: runtime: cannot allocate memory`; Python raises `MemoryError`. The process is still alive at the moment of failure and can (in Java's case) catch it, log a stack trace, and dump the heap. The fix is heap sizing or a heap leak.

2. **Native / off-heap OOM** — memory outside the managed heap is exhausted: JVM direct `ByteBuffer`s, thread stacks, JIT code cache, metaspace, JNI allocations, mmap'd regions, glibc arena fragmentation, a CGo/native library leaking. The managed heap can look perfectly healthy at 50% while total RSS climbs. This is the hardest of the three to diagnose because your heap profiler shows nothing.

3. **cgroup OOM-kill** — total RSS (heap + native + page cache charged to the cgroup) crossed `memory.max`, and the kernel `SIGKILL`'d the process. No exception, no stack trace, exit code 137. This is the kernel acting, not the runtime.

The diagnostic discipline: when you see exit 137 / `OOMKilled`, the runtime never got a chance to react — it's a cgroup kill, look at total RSS and native memory. When you see an `OutOfMemoryError` stack trace in your logs, the *runtime* hit *its* limit and the container had headroom to spare. Confusing these two sends teams down weeks of wrong-path debugging — e.g. raising the Java heap when the real problem was off-heap blowing the cgroup, which makes things *worse* because a bigger heap leaves *less* room for native memory inside the same container.

### Soft limits vs hard limits as a design primitive

A hard limit is binary: under it you're fine, over it you die. That gives you no room to react. Good designs introduce a **soft limit** below the hard limit — a threshold that triggers *behavioral change* (shed load, trigger GC, refuse new work) while there's still headroom to act.

This shows up at every layer:
- **Kernel:** `memory.high` (soft, throttles) sits below `memory.max` (hard, kills).
- **Runtime:** Go's `GOMEMLIMIT` is a *soft* target that makes the GC work harder as you approach it, ideally collecting enough to never reach the cgroup's hard `memory.max`.
- **Application:** a cache that starts evicting at 80% of its budget, or a queue that starts rejecting at 90% depth.

The design principle: **the hard limit should be the thing you never hit because soft limits triggered corrective action first.** Reaching the hard limit means every softer mechanism already failed. Treat hitting `memory.max` as an incident, not normal operation.

### Making the runtime aware of the container limit

Historically, language runtimes read *host* memory, not the cgroup limit. A JVM on a 256 GB node in a container limited to 2 GB would size its heap as if it had 256 GB — and get instantly OOM-killed. This "container-unaware runtime" bug caused enormous pain in the early container era.

The fixes you must know:

- **JVM:** Modern JVMs (8u191+, 11+) honor cgroup limits via `-XX:+UseContainerSupport` (default on). Size the heap *relative to the container* with `-XX:MaxRAMPercentage=75.0` rather than a fixed `-Xmx`, so the same image adapts to different limits. Crucially, leave 25–35% headroom for native memory — `MaxRAMPercentage=100` is a guaranteed cgroup kill because thread stacks, metaspace, and direct buffers all live *outside* `MaxRAM`.

- **Go:** `GOMEMLIMIT` (Go 1.19+) sets a soft memory target. The GC becomes increasingly aggressive as the live heap approaches it, trading CPU for staying under the limit. Set it *below* the cgroup `memory.max` (commonly ~90–95% of the limit, leaving room for Go's own non-heap memory and a margin), so Go collects hard *before* the kernel kills. Without it, a Go service's default GC pacing (`GOGC=100`, collect when heap doubles) can overshoot a tight container limit between collections and get killed mid-cycle.

- **Node.js:** `--max-old-space-size` must be set relative to the container; Node does not auto-detect cgroup limits as cleanly, and the V8 heap is only part of total RSS.

The recurring lesson: every managed runtime needs to be *told* the container's limit, and you must reserve headroom between the runtime's self-imposed limit and the cgroup's hard limit for memory the runtime doesn't count.

### The GC death spiral

This is the canonical pathology of a garbage-collected service under memory pressure, and seniors must recognize it on sight.

As live data approaches the heap limit, the GC collects more frequently because each collection frees less. But if the memory is **live** (genuinely reachable, not garbage — e.g. an unbounded cache or a large in-flight working set), the GC *cannot reclaim it*. So it runs again almost immediately, frees almost nothing again, and the process spends an ever-growing fraction of CPU in back-to-back collections while throughput collapses. The JVM has a built-in tripwire for exactly this: `GC overhead limit exceeded` fires when more than ~98% of time is spent in GC recovering less than ~2% of the heap.

The death spiral is uniquely nasty because it *looks like high CPU and high GC*, tempting you to "tune the GC" — but no GC tuning fixes a live-set that doesn't fit. The real fixes are upstream: bound the cache, shed load to shrink the working set, or raise the limit. A soft limit (`GOMEMLIMIT`, `memory.high`) can convert a sudden kill into a visible spiral that you can alert on and shed against — turning an instant death into a degradation you can manage, which is the whole point of senior design.

### Graceful degradation: load shedding, backpressure, bounded resources

The core senior move is to make every unbounded thing bounded, and to push back when bounds are reached:

- **Bounded queues and caches.** An unbounded in-memory queue *is* a memory leak waiting for a traffic spike. Cap every queue and cache by size or memory budget. When full, choose a policy: reject, evict, or block. The bound converts "grow until OOM-kill" into "apply backpressure or drop the oldest."

- **Backpressure.** When a bounded buffer fills, don't silently accept more — signal upstream to slow down. In a pipeline this means a full stage blocks (or returns "busy" to) its producer, propagating the slowdown to the source rather than accumulating an unbounded backlog in RAM. This is the difference between a system that throttles and one that buries itself.

- **Load shedding.** Under pressure, *deliberately drop work* — preferably the cheapest/least valuable. Reject new requests with `503` and `Retry-After` rather than accept them and OOM-kill (which drops *all* in-flight work, including requests you'd already half-served). Shedding 10% of traffic to keep 90% healthy beats accepting 100% and killing the process.

Memory-pressure-aware shedding can be driven by PSI or by RSS thresholds: when `/proc/pressure/memory` `some avg10` crosses a threshold, start refusing new connections.

### Admission control and circuit breakers

- **Admission control** decides at the front door whether to accept a request *before* committing resources to it. Sizing the concurrency limit so that worst-case per-request memory × max-concurrent stays under the heap/cgroup budget is a direct memory-safety control. A semaphore that bounds in-flight requests to N — chosen from `(memory budget) / (peak per-request footprint)` — is often more effective than any GC tuning.

- **Circuit breakers** protect against pressure caused by a slow/failing dependency: if a downstream is timing out, requests pile up in memory waiting on it. Tripping the breaker (fail fast instead of queueing) prevents that backlog from becoming a memory crisis. Memory pressure and dependency latency are coupled — slow dependencies are a leading cause of memory blowups via request accumulation.

### Spill-to-disk and reducing concurrency

When the working set legitimately exceeds RAM, two escape hatches keep you alive:

- **Spill-to-disk.** Databases and query engines (sorts, hash joins, aggregations) detect when an operation won't fit in memory and *spill* intermediate state to disk, trading speed for survival. Designing your own large-data operations to spill — rather than buffering everything in RAM — turns an OOM into a slow-but-completes operation.

- **Reduce concurrency under pressure.** Memory footprint often scales with concurrency (each in-flight request/goroutine/thread holds a working set). Dynamically lowering the concurrency limit when memory tightens shrinks the aggregate footprint. This is a cleaner lever than per-request optimization because it attacks the multiplier directly.

---

## Pros & Cons

**Soft-limit-driven degradation**
- ✅ Converts abrupt kills into observable, manageable slowdowns; preserves in-flight work; keeps the service up.
- ❌ Adds complexity and tuning; a mis-set soft limit can shed load you didn't need to, hurting throughput for no reason.

**Bounded queues/caches + backpressure**
- ✅ Removes the most common OOM cause (unbounded growth); makes memory usage predictable and capacity-plannable.
- ❌ Backpressure propagates latency to clients; rejecting work needs upstream retry/queue handling or you just move the problem.

**Runtime-aware limits (GOMEMLIMIT / MaxRAMPercentage)**
- ✅ Lets the GC pre-empt the kernel; one image adapts to many container sizes.
- ❌ Aggressive soft limits burn CPU on GC; wrong headroom math still ends in a cgroup kill from native memory.

**Load shedding / admission control**
- ✅ Protects the majority of traffic; degrades gracefully under overload.
- ❌ Choosing *what* to shed is a product decision, not just a technical one; naive shedding can drop high-value requests.

---

## Best Practices

- **Classify the failure before fixing it.** Exit 137 → cgroup kill, look at total RSS/native; `OutOfMemoryError` in logs → runtime heap limit, container had room. Never raise the heap in response to a cgroup kill without checking native memory first.
- **Set the runtime's limit below the cgroup's hard limit with explicit headroom.** `MaxRAMPercentage≈75`, `GOMEMLIMIT≈90–95%` of `memory.max`. Document *why* the headroom exists (native memory).
- **Bound everything.** Every cache, every queue, every connection pool, every in-flight-request count. An unbounded structure is a latent OOM.
- **Prefer shedding to dying.** A `503` returns one request; an OOM-kill drops all of them plus corrupts in-flight state and triggers a cold restart.
- **Drive degradation off PSI, not just RSS.** PSI measures actual stall; it reacts before RSS alone reveals trouble.
- **Make the soft limit the alert.** Alert when soft thresholds trip, while there's still time to act — not when the process is already dead.

---

## Edge Cases & Pitfalls

- **Raising the heap to fix a cgroup OOM makes it worse.** A bigger managed heap leaves *less* room for native memory in a fixed container, so off-heap-driven kills happen *sooner*.
- **`GOMEMLIMIT` set too aggressively causes a GC-bound death spiral of its own.** If the live set is near the limit, Go will burn the CPU collecting constantly; it doesn't kill, but the service becomes unusably slow. The soft limit can hide a too-small container.
- **Backpressure deadlocks.** A pipeline where stage A blocks on a full stage B, and B is waiting on A (shared pool, mutual dependency), can deadlock when both are under pressure. Backpressure topology needs care.
- **Load shedding the wrong thing.** Shedding by arrival order can drop expensive, already-mostly-completed work while admitting cheap new work — or vice versa. Shed by value/cost, not just recency.
- **Spill-to-disk just moves the bottleneck.** If disk is slow or also full, spilling trades an OOM for I/O collapse. Spill needs its own headroom and monitoring.
- **Per-request footprint is bimodal.** Sizing admission control on *average* request memory underprovisions for the occasional huge request; size on a high percentile or cap request size explicitly.

---

## Summary

Senior-level memory engineering is the art of not being killed by the kernel. It starts with correctly classifying the failure — managed-heap OOM, native OOM, or cgroup OOM-kill — because the fixes diverge and the intuitive fix (more heap) often worsens a cgroup kill. It requires teaching the runtime the container's true limit with deliberate headroom (`MaxRAMPercentage`, `GOMEMLIMIT`) so the GC pre-empts the kernel. And it demands designing graduated soft limits that trigger graceful degradation — bounded queues and caches, backpressure, load shedding, admission control, circuit breakers, spill-to-disk, and reduced concurrency — so that as memory tightens the service slows and sheds rather than crashes. The recurring failure to recognize is the GC death spiral: a live working set that won't fit, which no GC tuning can fix and which only upstream bounding or shedding resolves. The hard limit is the line you architect never to reach.
