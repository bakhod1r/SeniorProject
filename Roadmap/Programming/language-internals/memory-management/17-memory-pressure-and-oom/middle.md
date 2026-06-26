# Memory Pressure & OOM — Middle Level
> **Topic:** [Memory Pressure & OOM](README.md)
> **Focus:** The kernel mechanisms behind memory pressure — overcommit, reclaim, swap, cgroups, and the OOM killer.

---

## Table of Contents
- [Introduction](#introduction)
- [Core Concepts](#core-concepts)
  - [Virtual vs Resident: why your process "uses" memory it never touches](#virtual-vs-resident-why-your-process-uses-memory-it-never-touches)
  - [Overcommit: why malloc almost never fails](#overcommit-why-malloc-almost-never-fails)
  - [Page cache, the working set, and reclaimable memory](#page-cache-the-working-set-and-reclaimable-memory)
  - [Reclaim: kswapd and direct-reclaim stalls](#reclaim-kswapd-and-direct-reclaim-stalls)
  - [Swap and thrashing](#swap-and-thrashing)
  - [PSI: measuring pressure directly](#psi-measuring-pressure-directly)
  - [The OOM killer](#the-oom-killer)
  - [cgroups: per-group memory accounting](#cgroups-per-group-memory-accounting)
- [Pros & Cons](#pros--cons)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

"Memory pressure" is the state where demand for physical memory approaches or exceeds what is available, forcing the kernel to do work it would rather not: reclaim pages, swap, stall threads, and — as a last resort — kill a process. The frustrating part for engineers moving up from the junior level is that none of this is a clean `malloc returned NULL` boundary. Linux deliberately blurs the line between "you have memory" and "you don't," and the failure mode is usually a process getting `SIGKILL`'d with no stack trace, no exception, and a one-line message buried in `dmesg`.

At this level you need a working model of the cascade: how memory is accounted, what the kernel does as it fills up, and why the OOM killer picks the victim it picks. Everything in the senior and professional tiers — graceful degradation, container limits, GC death spirals — is a reaction to the mechanisms described here.

---

## Core Concepts

### Virtual vs Resident: why your process "uses" memory it never touches

Every process has a *virtual address space* — a map of addresses it is allowed to use. Mapping an address is cheap and costs no physical memory. Physical memory (RAM) is only consumed when the process *touches* a page, triggering a page fault that the kernel satisfies by handing over a physical frame.

This is why two numbers in `top`/`ps` differ so wildly:

- **VSZ / VIRT** — virtual size: everything mapped, including memory that has never been touched, shared libraries, and reserved-but-unused regions. Largely useless for capacity planning.
- **RSS / RES** — resident set size: physical pages actually backing this process *right now*. This is what counts against memory pressure.

A process can `mmap` 100 GB of anonymous memory on a 16 GB machine and run fine — as long as it only ever touches a few gigabytes. RSS is the number that matters. RSS is also imperfect: it counts shared pages (like libc) against every process that maps them, so summing RSS across processes overcounts. For container accounting the kernel uses *working set* and per-cgroup counters instead, which we get to below.

### Overcommit: why malloc almost never fails

Because mapping is decoupled from backing, Linux lets you allocate more virtual memory than you have RAM + swap. This is **overcommit**, controlled by `vm.overcommit_memory`:

- `0` (default, heuristic) — the kernel allows allocations up to a fuzzy heuristic limit. Obvious overallocations fail; most pass.
- `1` (always) — never refuse. `malloc` essentially never returns `NULL`. Common for workloads that allocate huge sparse arrays (e.g. some ML and Redis setups; Redis explicitly recommends this for `fork`-based persistence).
- `2` (never) — strict accounting against `swap + RAM * overcommit_ratio`. Allocations fail when committed memory would exceed the limit. Honest, but breaks software that assumes overcommit.

The critical consequence: **you do not run out of memory at allocation time, you run out at first-touch time.** `malloc` succeeds, the pointer is valid, and then writing to that memory faults in a page — and *that* is where the OOM killer can fire. Defensive `if (ptr == NULL)` checks are nearly worthless on a default-overcommit Linux box; the kill happens in the middle of a memset, not at the call site. This single fact explains most "but I checked the return value!" confusion.

### Page cache, the working set, and reclaimable memory

Free RAM is wasted RAM, so Linux fills it with **page cache**: copies of file data read from or written to disk. When you see "only 200 MB free" on a 64 GB box, most of the rest is usually page cache, which is *reclaimable* — the kernel can drop clean cached pages instantly to satisfy a new allocation.

So "available" memory (the `available` column in `free -m`, backed by `MemAvailable` in `/proc/meminfo`) is the honest number: free memory **plus** reclaimable cache. Pressure begins when even the reclaimable pool can't keep up with demand.

Pages fall into two broad classes for reclaim:
- **File-backed pages** — page cache. Clean ones are dropped for free; dirty ones must be written back to disk first.
- **Anonymous pages** — heap, stack, anything with no file behind it. These cannot be dropped; they can only be reclaimed by **swapping** them out to disk. With no swap, anonymous memory is unreclaimable.

### Reclaim: kswapd and direct-reclaim stalls

When free memory drops below a watermark, the kernel reclaims:

- **kswapd** — a background kernel thread that wakes when memory crosses the low watermark and reclaims asynchronously. Healthy, invisible to your application.
- **Direct reclaim** — when an allocation can't be satisfied *right now* and kswapd hasn't kept up, the allocating thread is forced to do reclaim work itself, *synchronously, in your application's call stack*. Your code stalls inside what looked like a simple allocation while the kernel scans pages, writes back dirty data, or swaps.

Direct reclaim is one of the most insidious latency sources in production. A service can look healthy on CPU and have no GC activity, yet exhibit multi-hundred-millisecond tail latencies because threads keep falling into direct reclaim. It rarely shows up in application-level profilers — it manifests as time mysteriously spent inside `malloc` or a page fault handler.

### Swap and thrashing

Swap is disk space used to hold anonymous pages evicted from RAM, giving the kernel somewhere to put unreclaimable memory. `vm.swappiness` (0–100, default ~60) tunes how aggressively the kernel prefers swapping anonymous pages versus dropping file cache.

Swap buys you headroom, but it has a livelock failure mode: **thrashing**. When the working set genuinely exceeds RAM, the kernel swaps a page out, the process immediately needs it again and faults it back in, evicting another needed page, and so on. The system spends nearly all its time moving pages between RAM and disk and almost none doing useful work. CPU looks idle, disk I/O is pinned, and everything crawls — often for minutes — without ever cleanly failing.

This is why many production systems **disable swap entirely** (`swapoff -a`, and Kubernetes historically *required* it off). The trade-off is stark and worth stating honestly:
- **Swap off:** no thrashing livelock; pressure resolves quickly into a clean OOM kill. But you lose the safety buffer, so transient spikes that swap would have absorbed now kill a process instead.
- **Swap on:** absorbs spikes and lets cold pages leave RAM, but risks a thrash livelock that is *worse* than a fast kill because the whole node degrades.

Modern compromises soften this. **zram** and **zswap** keep swap in *compressed RAM* instead of on disk — much faster than disk swap, so the thrash penalty is far lower while still buying headroom. Newer Kubernetes versions are re-introducing controlled swap support partly on the back of these.

### PSI: measuring pressure directly

Older signals (free memory, swap-in rate) are proxies. **Pressure Stall Information (PSI)**, exposed at `/proc/pressure/memory`, measures the thing you actually care about: the percentage of time tasks were *stalled* waiting on memory.

```
some avg10=0.00 avg60=0.12 avg300=0.05 total=1234567
full avg10=0.00 avg60=0.00 avg300=0.00 total=89012
```

- `some` — some tasks stalled on memory (partial slowdown).
- `full` — *all* non-idle tasks stalled (the machine is effectively frozen on memory). Sustained non-zero `full` is an emergency.

PSI is the modern, direct way to detect memory pressure early — before the OOM killer fires — and it is per-cgroup, so you can attribute pressure to a specific container.

### The OOM killer

When reclaim can no longer free enough memory to satisfy an allocation, the kernel invokes the **OOM killer**. It scores every eligible process by `oom_score` (roughly proportional to memory footprint, adjustable via `oom_score_adj` in the range −1000 to +1000), picks the highest scorer, and sends it `SIGKILL`. You'll find the evidence in `dmesg`:

```
Out of memory: Killed process 4242 (java) total-vm:8123456kB, anon-rss:6234112kB, file-rss:2048kB, ...
```

Two things bite engineers repeatedly:
1. **The victim is often not the culprit.** The killer optimizes for *recovering the most memory*, so it tends to kill your biggest process — which may be an innocent database while a leaking sidecar is the real cause.
2. **There is no graceful shutdown.** `SIGKILL` cannot be caught. No flush, no cleanup, no exception. The process simply vanishes.

`vm.panic_on_oom=1` makes the kernel panic (reboot) instead of killing a process — chosen by systems that prefer a clean restart to running in a degraded, partially-killed state. `oom_score_adj=-1000` makes a process effectively unkillable (used for critical daemons), at the cost of pushing the kill onto something else.

### cgroups: per-group memory accounting

Global OOM is a blunt machine-wide instrument. **cgroups** (control groups) let the kernel account and limit memory *per group of processes* — the foundation of containers.

- **cgroup v1** uses `memory.limit_in_bytes` as the hard cap. Hitting it triggers a *cgroup-local* OOM kill (only processes in that cgroup are candidates), not a machine-wide one.
- **cgroup v2** (the modern default) splits the cap into two knobs:
  - `memory.high` — a *soft* limit. Crossing it puts the cgroup under aggressive reclaim and *throttles* allocations (deliberately slowing the group) but does **not** kill. A pressure valve.
  - `memory.max` — the *hard* limit. Crossing it after reclaim fails triggers a cgroup OOM kill.
  - `memory.swap.max` — caps how much swap the cgroup may use.

This two-tier design (`high` to throttle, `max` to kill) is the kernel-level basis for graceful degradation: you get a warning region where the group slows down and emits pressure signals *before* the hard kill. Senior-tier design leans heavily on it.

---

## Pros & Cons

**Overcommit + lazy mapping**
- ✅ Lets programs allocate sparse/optimistic and only pay for what they touch; enables cheap `fork`, sparse arrays, large reserved arenas.
- ❌ Decouples allocation success from actual availability, so failures arrive as async kills mid-execution instead of clean `NULL` returns.

**Swap**
- ✅ Absorbs transient spikes, evicts genuinely cold pages, prevents kills for over-provisioned-but-idle workloads.
- ❌ Thrashing livelock when the working set exceeds RAM; turns a fast failure into a slow node-wide meltdown.

**OOM killer**
- ✅ Keeps the machine alive instead of deadlocking the whole system on memory.
- ❌ Picks by footprint not blame; uncatchable `SIGKILL` means no cleanup; often kills the wrong process.

**cgroup limits**
- ✅ Contain a leaking process to its own group; per-container accounting and isolation; `memory.high` enables soft throttling.
- ❌ A too-low limit turns normal spikes into constant kills; off-heap/native allocations still count and surprise heap-focused monitoring.

---

## Best Practices

- **Monitor RSS and `MemAvailable`, not VSZ.** Alert on available memory and on PSI (`some`/`full` from `/proc/pressure/memory`) rather than on raw free memory.
- **Read `dmesg` first** after any unexplained process death. The `Out of memory: Killed process` line tells you the victim, its RSS, and the triggering cgroup.
- **Decide swap deliberately.** Off for latency-sensitive services that prefer fast clean kills; on (ideally zram/zswap) for batch/throughput workloads that benefit from spike absorption. Don't leave it to default by accident.
- **Use `memory.high` before `memory.max`** when you control cgroups directly, so the group throttles and signals pressure before being killed.
- **Set `oom_score_adj` intentionally** for critical processes — but remember every protected process pushes the kill onto another.
- **Never rely on `malloc` returning `NULL`** for capacity safety on default-overcommit Linux. It mostly won't.

---

## Edge Cases & Pitfalls

- **The killed process didn't leak.** Before blaming the victim from `dmesg`, check which process's *growth* preceded the kill. The biggest process is the easiest target, not necessarily the cause.
- **`free` shows "no free memory" and that's fine.** Most of it is reclaimable page cache. Look at `available`, not `free`.
- **Direct-reclaim latency hides from profilers.** Tail-latency spikes with idle CPU and no GC often trace back to reclaim stalls; only PSI and kernel-level tracing reveal them.
- **Swap "working" can be worse than swap failing.** A node at 100% disk-swap I/O and near-zero throughput is thrashing — it would have been healthier to OOM-kill quickly.
- **cgroup v1 vs v2 differ.** `memory.limit_in_bytes` (v1) vs `memory.max`/`memory.high` (v2). Tooling and scripts assuming one will silently misbehave on the other.
- **Native/off-heap memory counts against the cgroup but not the language heap.** A JVM heap at 60% can still get cgroup-OOM-killed because direct buffers, thread stacks, and JIT code blew the container limit. (Detailed in senior/professional tiers.)

---

## Summary

Memory pressure on Linux is a cascade, not a cliff. Allocation is decoupled from backing by overcommit, so failures surface at first-touch rather than at `malloc`. As RAM fills, the kernel reclaims page cache and swaps anonymous pages — first via background `kswapd`, then via latency-killing synchronous direct reclaim. Swap can absorb spikes or collapse into a thrashing livelock, which is why production teams disable it or move it into compressed RAM. PSI gives a direct early read on stall time. When reclaim finally fails, the OOM killer sends an uncatchable `SIGKILL` to a victim chosen by footprint, not fault. cgroups scope all of this per-container, with `memory.high` to throttle and `memory.max` to kill — the mechanism every higher-tier graceful-degradation strategy is built on.
