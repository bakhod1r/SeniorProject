# Memory Pressure & OOM — Interview Questions
> **Topic:** [Memory Pressure & OOM](README.md)

A bank of interview questions spanning the mechanics of Linux memory pressure, the OOM killer, cgroups and containers, runtime/GC interaction, and graceful-degradation design. Questions progress from conceptual fundamentals to tool-specific knowledge, deliberate traps, and open-ended design.

---

## Table of Contents
- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1
**Why does `malloc` almost never return `NULL` on a default Linux system, and where does the program actually fail instead?**

Because of **overcommit** (`vm.overcommit_memory=0`, heuristic): the kernel maps virtual address space without backing it with physical pages. `malloc` only reserves a virtual mapping, which is cheap and almost always succeeds. Physical memory is consumed at **first touch** — when the program writes to a page and triggers a page fault. So the failure surfaces not at the allocation call but inside a later memory access (e.g. mid-`memset`), and the failure mode is the OOM killer sending `SIGKILL`, not a `NULL` return. This is why defensive `if (ptr == NULL)` checks give almost no protection on stock Linux.

## Question 2
**Explain the difference between virtual size (VSZ) and resident set size (RSS). Which matters for memory pressure?**

VSZ is everything the process has *mapped* — touched or not, including reserved regions and shared libraries. RSS is the physical pages *actually backing* the process right now. Only RSS consumes real RAM, so RSS is what counts toward memory pressure and the OOM killer's scoring. A process can have a huge VSZ (e.g. a 100GB sparse `mmap`) with tiny RSS and run fine. RSS itself overcounts shared pages across processes, which is why containers rely on per-cgroup working-set accounting instead of summing RSS.

## Question 3
**What is the page cache, and why can a server show almost no "free" memory yet be perfectly healthy?**

The page cache holds in-RAM copies of file data to avoid disk I/O. Linux deliberately fills otherwise-idle RAM with it ("free RAM is wasted RAM"). Clean page-cache pages are **reclaimable** — the kernel drops them instantly to satisfy a new allocation. So low `free` is normal; the honest number is `available` (`MemAvailable`), which is free memory *plus* reclaimable cache. Pressure only begins when even that reclaimable pool can't keep up.

## Question 4
**Describe the reclaim cascade as memory fills up, and explain why direct reclaim hurts application latency.**

When free memory drops below a watermark, **kswapd** (a background kernel thread) reclaims asynchronously — invisible to the app. If allocations outpace kswapd and memory is needed *now*, the allocating thread is forced into **direct reclaim**: it does the reclaim work itself, synchronously, inside the application's own call stack. The thread stalls while the kernel scans pages, writes back dirty data, or swaps. This produces tail-latency spikes with idle CPU and no GC activity — and it hides from application profilers because the time is spent inside the page-fault/allocation path.

## Question 5
**What is thrashing, and why do many production teams disable swap?**

Thrashing is a livelock: when the working set genuinely exceeds RAM, the kernel swaps a page out, the process immediately needs it back, faulting it in and evicting another needed page, ad infinitum. The system spends nearly all its time moving pages between RAM and disk and almost none doing useful work — CPU idle, disk pinned, everything frozen, often for minutes, *without ever cleanly failing*. Teams disable swap so pressure resolves into a **fast, clean OOM-kill** instead of a slow node-wide meltdown. The trade-off: you lose the buffer that would have absorbed transient spikes, so spikes now kill a process. zram/zswap (compressed-RAM swap) is the modern compromise — buffer without the disk-thrash penalty.

## Question 6
**How does the OOM killer choose its victim, and why is the victim often not the culprit?**

It scores eligible processes by `oom_score` — roughly proportional to memory footprint, adjusted by `oom_score_adj` (−1000 to +1000) — and `SIGKILL`s the highest scorer. Because it optimizes for *recovering the most memory*, it targets the biggest process, which is frequently an innocent large service (a database) rather than the small process that leaked and drove the system into pressure. There's no graceful shutdown: `SIGKILL` can't be caught, so there's no flush or cleanup.

---

## Tool-Specific

## Question 7
**What does an `Out of memory: Killed process` line in `dmesg` tell you, and which fields matter?**

It records an OOM-kill event: the PID and name of the **victim**, plus memory stats. The key fields are `anon-rss` (the process's real anonymous footprint — the number that matters), `total-vm` (virtual, large and mostly irrelevant), and on cgroup kills `oom_memcg`/`task_memcg` (which cgroup hit its limit, confirming a *container* OOM versus a node-wide one). It's the first thing to check after any unexplained process death on bare metal or a VM.

## Question 8
**In cgroup v2, what's the difference between `memory.high` and `memory.max`?**

`memory.max` is the **hard** limit (the cgroup `memory.max` / what Kubernetes `limits.memory` sets): crossing it after reclaim fails triggers a cgroup OOM-kill. `memory.high` is a **soft** limit: crossing it puts the cgroup under aggressive reclaim and **throttles** allocations (deliberately slowing the group) but does *not* kill. The two-tier design gives a warning region — the group slows and emits pressure signals before the hard kill — which is the kernel-level foundation for graceful degradation. `memory.swap.max` separately caps the cgroup's swap.

## Question 9
**What is PSI and how do you use `/proc/pressure/memory`?**

Pressure Stall Information directly measures the *time tasks spent stalled* waiting on memory, rather than proxy metrics like free bytes. `/proc/pressure/memory` reports `some` (some tasks stalled — partial slowdown) and `full` (all non-idle tasks stalled — effectively frozen), each with `avg10/avg60/avg300` percentages. Sustained non-zero `full` is an emergency. PSI is per-cgroup, so you can attribute pressure to a specific container, and it's the modern way to detect pressure *early* and drive load-shedding before the OOM killer fires.

## Question 10
**How do you make a JVM and a Go service respect a container's memory limit?**

**JVM:** modern JDKs honor cgroup limits via `-XX:+UseContainerSupport` (default on). Size the heap relative to the container with `-XX:MaxRAMPercentage=75.0` (not a fixed `-Xmx`), leaving 25–35% headroom for native memory (metaspace, thread stacks, direct buffers, JIT code). **Go:** set `GOMEMLIMIT` (Go 1.19+) to a soft target *below* the cgroup `memory.max` (~90%), so the GC becomes increasingly aggressive and collects hard *before* the kernel kills. Both runtimes must be explicitly *told* the limit and must reserve headroom for memory they don't count.

## Question 11
**In Kubernetes, what does exit code 137 mean, and how do you tell an OOMKill from a node-pressure eviction?**

137 = 128 + 9 (`SIGKILL`), produced by a **cgroup OOM-kill**: the container exceeded *its own* `limits.memory`. `kubectl describe pod` shows `Last State: Terminated, Reason: OOMKilled, Exit Code: 137`. A **node-pressure eviction** is different: the *node* ran low on memory and the kubelet proactively evicted whole pods; the status is `Evicted` with `The node was low on resource: memory`. Same symptom (pod restarts), opposite root cause — my limit vs the node's capacity — so always read the `Reason` field, not just the restart.

## Question 12
**What are Kubernetes QoS classes and how do they affect eviction order?**

Derived from requests/limits: **Guaranteed** (`requests == limits` for memory and CPU on every container), **Burstable** (at least one request below its limit), **BestEffort** (no requests or limits). Under node memory pressure the kubelet evicts **BestEffort first**, then **Burstable** pods exceeding their requests (ranked by overage), and **Guaranteed last**. So a BestEffort pod is a designed sacrificial victim, and anything that matters should be Guaranteed.

---

## Tricky / Trap

## Question 13
**A Java service is repeatedly OOMKilled (exit 137), but every heap dump shows the heap at ~55% of `-Xmx`. The team raised `-Xmx` and it got worse. What's going on?**

The container is killed on **total RSS** (heap + native), not heap alone, and the culprit is **off-heap** memory: direct `ByteBuffer`s, thread stacks from an unbounded pool, metaspace growth, JNI, or glibc arena fragmentation. The heap monitor is blind to all of it. Raising `-Xmx` made it *worse* because a bigger heap leaves *less* room for native memory inside the same fixed container, so the cgroup limit is hit sooner. Fix: size the heap *down* (`MaxRAMPercentage=75`), cap the off-heap source, enable Native Memory Tracking, and compare heap-used against container RSS — the gap is the native memory.

## Question 14
**A garbage-collected service has its CPU pinned at 100% with GC dominating, latency degraded 20×, but the process won't die. Is this a GC tuning problem?**

No — it's a **GC death spiral** on a **live** working set. The live set has grown to near the heap/soft limit, so the GC runs back-to-back collections that free almost nothing (the memory is reachable, not garbage). No GC setting fixes a live set that doesn't fit; "tuning the GC" is the trap. The real fixes are upstream: bound the offending cache, shed load to shrink the working set, or raise the limit if the working set is legitimate. The JVM's `GC overhead limit exceeded` is exactly this tripwire.

## Question 15
**Your monitoring shows a node with idle CPU but it's completely unresponsive and there's no OOM-kill in the logs. What happened?**

A **swap-thrash livelock**. Swap was on, the working set exceeded RAM, and the system is shuttling pages between RAM and disk endlessly. The OOM killer never fires because reclaim technically "succeeds" via swap — it's just catastrophically slow. The tells are huge `si`/`so` in `vmstat`, PSI `full` near 100%, pinned disk I/O, and high iowait with idle CPU. Short-term fix: manually kill the offending process to break the livelock. Long-term: disable disk swap (so pressure becomes a fast clean kill) or move to zram/zswap.

## Question 16
**A pod shows `Evicted`, not `OOMKilled`. The team starts tuning the pod's memory limit. Why is this the wrong move?**

Because an eviction is a *node-level* action: the kubelet evicted the pod because the **node** ran low on memory, not because this pod exceeded its own limit. The pod may be entirely well-behaved — it was collateral damage from oversubscribed **noisy neighbors**. Tuning the evicted pod's limit fixes nothing; the fix lives at the node/scheduling layer: set `requests == limits` to get Guaranteed QoS, reduce neighbor oversubscription, or add node memory. `OOMKilled` → fix the container; `Evicted` → fix the node.

---

## Design

## Question 17
**Design a service that degrades gracefully under memory pressure instead of getting OOM-killed.**

Build graduated soft limits that trigger behavioral change before the hard limit. Bound *every* unbounded structure — caches, queues, connection pools, in-flight request count — converting "grow until killed" into backpressure or eviction. Add **admission control**: a concurrency semaphore sized from `(memory budget) / (peak per-request footprint)`, so you never admit more work than memory can hold. Add **load shedding** driven by PSI or an RSS threshold: return `503 Retry-After` when pressure crosses a soft line, dropping the least valuable work to protect the majority. Set the runtime's soft limit (`GOMEMLIMIT` / `MaxRAMPercentage`) below the cgroup hard limit so the GC pre-empts the kernel. For genuinely-too-big operations, **spill to disk** and **reduce concurrency**. Key principle: the hard limit is the line you architect *never to reach* — and alerts fire on the soft limits, while there's still time to act.

## Question 18
**Why set `requests == limits` for memory in Kubernetes, and what's the trade-off?**

Memory is **incompressible** — you can't throttle a container to use less, only kill it — so allowing `requests < limits` (bursting) means borrowing memory the scheduler never guaranteed; when the node fills, that loan can't be honored and something dies. Setting `requests == limits` reserves exactly what the cgroup enforces: predictable placement, no surprise bursting, and **Guaranteed** QoS (evicted last). It also stops you from externalizing risk onto neighbors via oversubscription. The trade-off is lower bin-packing density — you can't oversubscribe, so you use more nodes. It's a deliberate exchange of utilization for predictability, and for anything that matters it's the right default.

## Question 19
**How would you instrument a service to catch memory problems before they cause an OOM-kill?**

Track the right signals, not just usage. Alert on `MemAvailable`/working-set and on **PSI** (`some`/`full` stall time) rather than raw free memory — PSI reacts before usage alone reveals trouble. Plot **RSS over time** to distinguish a leak (monotonic trend), a spike (transient, event-correlated), and an undersized limit (sane plateau above the configured cap). For managed runtimes, continuously compare **heap-used to RSS**; a growing gap is the early signal of off-heap trouble. Fire alerts on **soft-limit breaches** (the early warning) rather than on the kill (the incident). Capture `dmesg` OOM lines and `kubectl describe` reasons automatically so every kill is attributable to a victim, a cgroup, and a root-cause class.
