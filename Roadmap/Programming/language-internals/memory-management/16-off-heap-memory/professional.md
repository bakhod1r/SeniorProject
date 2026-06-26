# Off-heap / Native Memory — Professional Level

> **Topic:** [Off-heap / Native Memory](README.md)
> **Focus:** Production reality — sizing the whole process, diagnosing native leaks that no heap dump shows, the tooling that actually finds them, and war stories from the field.

---

## Table of Contents

- [Introduction](#introduction)
- [Core Concepts](#core-concepts)
  - [RSS vs heap: the accounting model that matters](#rss-vs-heap-the-accounting-model-that-matters)
  - [Sizing a container that uses off-heap](#sizing-a-container-that-uses-off-heap)
  - [The native-leak diagnosis playbook](#the-native-leak-diagnosis-playbook)
  - [The tooling, in order of cost](#the-tooling-in-order-of-cost)
- [War Stories](#war-stories)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

In production, off-heap memory's defining property is that it is *invisible to the tools you reach for first*. A heap dump won't show it. `-Xmx` doesn't bound it. The GC log never mentions it. So the failure mode is brutal in its asymmetry: a slow native leak grows process RSS for hours while every JVM-level dashboard stays green, until the kernel's OOM killer or the container runtime sends a `SIGKILL` and your service vanishes with no Java stack trace, no `OutOfMemoryError`, no heap dump — just exit code 137. This page is about not being surprised by that, and about finding the leak fast when you are.

---

## Core Concepts

### RSS vs heap: the accounting model that matters

The number the kernel cares about is **RSS** (resident set size): physical pages your process actually occupies. For a JVM, RSS is the sum of many things, and the Java heap is only one:

```
RSS ≈ Java heap (used, not -Xmx)
    + Metaspace / class metadata
    + Code cache (JIT-compiled code)
    + Thread stacks (≈ 1 MiB × thread count)
    + GC internal structures (card tables, remembered sets)
    + Direct byte buffers / Panama segments   ← off-heap
    + mmap'd files (resident pages)            ← off-heap
    + Native libraries' own malloc (JNI, zlib, ...) ← off-heap
    + malloc arena fragmentation / retention   ← off-heap
```

The classic incident: **"heap is 2 GiB, RSS is 8 GiB."** The 6 GiB delta is everything below the heap line, and a runaway entry there is your leak. The first diagnostic instinct must be to *stop looking at the heap* and start accounting for RSS.

### Sizing a container that uses off-heap

Never set the container memory limit equal to `-Xmx`. A safe starting budget:

```
container_limit = -Xmx
               + MaxDirectMemorySize
               + MaxMetaspaceSize
               + ReservedCodeCacheSize
               + (thread_count × ThreadStackSize)
               + your_explicit_off_heap_budget
               + ~10-20% headroom (malloc fragmentation, GC structures, native libs)
```

Two production essentials: (1) **always set `-XX:MaxDirectMemorySize` explicitly** — its default in modern JVMs is roughly `-Xmx`, which silently doubles your direct-memory ceiling and ruins the budget. (2) On the JVM, `-XX:+UseContainerSupport` (default on) sizes the heap from the cgroup limit, but it knows nothing about your off-heap usage — so if you're off-heap-heavy, set `-XX:MaxRAMPercentage` low enough to leave room. The same discipline applies to Go (`GOMEMLIMIT` bounds the heap, not your `mmap`) and .NET.

### The native-leak diagnosis playbook

When RSS climbs and the heap doesn't, work top-down:

1. **Confirm it's native, not heap.** Compare `Used heap` (from GC logs / `jcmd GC.heap_info`) against RSS (`ps -o rss`, `/proc/<pid>/status` → `VmRSS`). A growing gap = native growth.
2. **Categorize with Native Memory Tracking.** Start the JVM with `-XX:NativeMemoryTracking=summary` (or `detail`), then `jcmd <pid> VM.native_memory summary`. NMT buckets memory by subsystem (Java Heap, Class, Thread, Code, **Internal** — where direct buffers historically land, **Other** — Panama/Unsafe). Take a baseline (`VM.native_memory baseline`) and diff later (`VM.native_memory summary.diff`) to see which bucket is growing.
3. **Check the buffer-pool MXBeans.** `BufferPoolMXBean` exposes `direct` and `mapped` pool counts and total capacity. If `direct` capacity is climbing unbounded, you have a `DirectByteBuffer` leak (Cleaners not running, or genuine retention).
4. **Map the address space.** `pmap -X <pid>` and `/proc/<pid>/smaps` show every mapping with RSS. A single anonymous mapping growing to gigabytes points at one `malloc` arena or one giant allocation; many small ones point at fragmentation or per-request leaks.
5. **Profile the allocator itself.** If NMT's "Internal/Other" is growing but you can't tie it to Java code, the leak is below the JVM — in a JNI library or in `malloc` retention. Swap in **jemalloc with profiling** (`MALLOC_CONF=prof:true,prof_leak:true`, or `LD_PRELOAD=libjemalloc.so` + `jeprof`) to get a native allocation flame graph showing the C call stack that allocated the leaked bytes.

NMT itself adds 5–10% overhead and per-allocation bytes, so it's a "turn on to investigate" tool, not always-on.

### The tooling, in order of cost

| Tool | Cost | Tells you |
|---|---|---|
| `ps` / `/proc/<pid>/status` (`VmRSS`) | free | Total RSS — is it growing? |
| `BufferPoolMXBean` | free, always-on | Direct + mapped buffer totals (JVM) |
| `jcmd VM.native_memory` (NMT) | 5–10% | Which JVM subsystem is growing |
| `pmap -X` / `smaps` | free, snapshot | Per-mapping RSS, find the big/many mapping(s) |
| jemalloc profiling / `jeprof` | moderate | The native (C/JNI) call stack that allocated |
| `bpftrace` / eBPF on `brk`/`mmap` | low, advanced | Live syscall-level allocation tracing |

---

## War Stories

**The Cleaner that never ran.** A streaming service held `DirectByteBuffer`s in a long-lived `ConcurrentHashMap` cache. The heap was tiny and healthy, so the GC almost never ran, so the buffers' Cleaners almost never fired, so direct memory grew without bound. RSS climbed for days; the heap dump (taken in desperation) showed nothing relevant. The fix was twofold: set `-XX:MaxDirectMemorySize` to force GC-on-pressure, and migrate the cache to explicitly-freed `Arena` segments so lifetime stopped depending on GC at all.

**The container that died with no stack trace.** A service ran fine in QA, then in production got OOM-killed (exit 137) every few hours. Heap was capped at 4 GiB; container limit was 4 GiB. The culprit: thread-per-request scaling pushed thread count to 2,000, and each thread's 1 MiB stack plus per-thread direct buffers pushed RSS past the limit — the heap never touched its ceiling, so no `OutOfMemoryError`, just a kernel kill. The fix was budgeting the *process*, not the heap, and bounding the thread pool.

**The JNI library that leaked below the JVM.** Image-processing throughput was fine but RSS crept up. NMT showed nothing alarming in Java buckets. `jemalloc` profiling revealed a native decoder library `malloc`ing per-call and freeing only on a code path that an exception skipped. No amount of Java-level analysis would have found it — the leak was in C, beneath everything the JVM could report.

**glibc malloc retention masquerading as a leak.** A service's RSS plateaued well above its actual live native memory and never came back down. Not a leak — glibc's `malloc` keeps per-thread arenas and rarely returns freed memory to the OS, so RSS reflects high-water-mark, not current use. Setting `MALLOC_ARENA_MAX=2` (or switching to jemalloc) cut the retention. The lesson: high RSS isn't always a leak; sometimes it's allocator retention policy.

---

## Code Examples

**Enable and read NMT (the first move in any native-memory incident):**

```bash
# Launch with tracking on:
java -XX:NativeMemoryTracking=summary -XX:MaxDirectMemorySize=2g -jar app.jar

# Baseline, then diff later to find what grew:
jcmd <pid> VM.native_memory baseline
# ... wait while RSS climbs ...
jcmd <pid> VM.native_memory summary.diff
```

**Find the big mapping with pmap:**

```bash
pmap -X <pid> | sort -k3 -n | tail        # mappings by RSS, largest last
grep -A2 'rw-p' /proc/<pid>/smaps | grep Rss | sort -n | tail
```

**Expose direct-buffer usage as a metric (always-on early warning):**

```java
BufferPoolMXBean direct = ManagementFactory
    .getPlatformMXBeans(BufferPoolMXBean.class).stream()
    .filter(b -> b.getName().equals("direct")).findFirst().orElseThrow();
gauge("jvm.buffer.direct.used.bytes", direct::getMemoryUsed); // alert on growth
```

**jemalloc leak profiling for sub-JVM native leaks:**

```bash
LD_PRELOAD=/usr/lib/libjemalloc.so \
MALLOC_CONF=prof:true,prof_leak:true,lg_prof_sample:19 \
java -jar app.jar
# On exit (or via prof.dump), render the native allocation call graph:
jeprof --show_bytes --pdf $(which java) jeprof.*.heap > leak.pdf
```

---

## Pros & Cons

**Pros (operational)**
- Off-heap removes the big-dataset GC pause that would otherwise dominate tail latency in production.
- mmap'd page cache is shared across restarts and processes — warm caches survive a process bounce.

**Cons (operational)**
- Leaks are invisible to first-line tools and kill the process without a Java-level signal — the hardest class of memory bug to diagnose.
- Capacity planning is manual and unforgiving; a wrong budget means periodic OOM kills.
- Requires a second toolchain (NMT, pmap, jemalloc) that on-call engineers must know exists before they need it at 3 a.m.

---

## Best Practices

1. **Always run with `-XX:MaxDirectMemorySize` set explicitly** and alert on `BufferPoolMXBean` direct usage approaching it.
2. **Budget the container against RSS, not `-Xmx`.** Leave 10–20% headroom for fragmentation and native libs.
3. **Have NMT ready.** Document the `jcmd VM.native_memory baseline`/`summary.diff` runbook before an incident; consider running with `summary` tracking on by default if you can absorb the overhead.
4. **Consider jemalloc as the default allocator** in containers — better fragmentation behavior than glibc and built-in profiling; or set `MALLOC_ARENA_MAX` to tame glibc retention.
5. **Alert on the RSS-minus-heap gap.** A widening gap between `VmRSS` and used heap is the earliest signal of a native leak — make it a dashboard panel.
6. **Prefer deterministic freeing** (`Arena`, explicit pool return) so leaks become missed-return bugs you can detect, not Cleaner-schedule lottery.

---

## Edge Cases & Pitfalls

- **Exit 137 with a green heap dashboard.** The signature of an off-heap/native problem. Stop staring at the heap.
- **NMT undercounts third-party native allocations.** It tracks JVM-internal `malloc`, not arbitrary JNI library allocations — those need jemalloc/valgrind. Don't conclude "no leak" from a clean NMT.
- **RSS that won't shrink after freeing.** Often glibc arena retention, not a leak — verify before chasing phantom bugs (`MALLOC_ARENA_MAX`, jemalloc `purge`).
- **mmap'd file RSS counts against the container.** Resident pages of a memory-mapped file show in `VmRSS` and count toward the cgroup limit; mapping a huge file and touching it all can OOM-kill you even though it's "just the page cache."
- **Cleaner-based reclamation under low GC pressure.** With a generously sized heap, the GC may run so rarely that `DirectByteBuffer` Cleaners effectively never fire — paradoxically, a *bigger* heap can worsen a native leak.
- **`-XX:MaxRAMPercentage` ignoring off-heap.** Container-aware heap sizing fills the cgroup with heap and leaves no room for your off-heap budget unless you lower it.

---

## Summary

In production, off-heap memory is defined by its invisibility: the heap dump, `-Xmx`, and the GC log all lie about it, and its failure mode is a kernel OOM kill with no Java-level diagnostics. The professional defends against this by *budgeting the whole process against RSS* (heap + direct + metaspace + code cache + stacks + explicit off-heap + headroom), capping direct memory explicitly, and alerting on the RSS-minus-heap gap. When a native leak strikes, the playbook is top-down: confirm it's native, categorize with NMT, check buffer-pool MXBeans, locate the mapping with `pmap`/`smaps`, and drop to jemalloc profiling for leaks below the JVM. The recurring war-story lessons — Cleaners that never run under low GC pressure, kills with no stack trace, JNI leaks NMT can't see, and glibc retention that looks like a leak but isn't — all reduce to one rule: when RSS grows and the heap doesn't, you are in native territory, and you need native tools.
