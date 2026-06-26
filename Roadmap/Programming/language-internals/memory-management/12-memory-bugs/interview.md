# Memory Bugs — Interview Questions

> **Topic:** [Memory Bugs](README.md)

A bank of interview questions on practical memory bugs: leaks in managed and unmanaged runtimes, fragmentation, allocation churn, retention analysis, and the tools and methodology used to diagnose them in production. Each question includes a model answer with the depth an interviewer expects from a strong candidate.

---

## Table of Contents

- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**How can a program written in a garbage-collected language still leak memory?**

A garbage collector reclaims memory that is *unreachable*, not memory that is *unneeded*. If any chain of references leads from a GC root (a global/static, a live stack frame, a thread, a JNI/global ref) to an object, the collector treats that object as alive and never frees it. A "leak" in a managed language is therefore an object you keep *reachable* but will never use again — typically through an unbounded collection, a forgotten listener, a long-lived closure capturing it, a parked thread/goroutine, or a thread-local on a pooled thread. The fix is never "tune the GC"; it's "break the reference that keeps it alive." The diagnostic question is always *"what is keeping this object alive?"*

## Question 2

**Distinguish a memory leak from allocation churn. Why does the distinction matter?**

A **leak (retention)** means objects accumulate and are never released — the *live set grows over time* (the post-GC floor rises). **Churn** means objects are created and discarded rapidly — the live set may be perfectly flat, but the *allocation rate* is high, forcing the GC to run constantly, burning CPU and spiking tail latency. They matter because they have opposite cures and different tools: a leak is fixed by breaking references / bounding collections and diagnosed with **heap dumps and dominator trees**; churn is fixed by allocating less (pooling, reuse, avoiding boxing) and diagnosed with **allocation profiles**. Confusing them sends you to the wrong tool — heap-dumping a churn problem finds nothing alarming.

## Question 3

**You see RSS climbing but a heap dump shows the live heap is flat. What are the possible causes?**

A flat live heap with rising RSS rules out a reachable-object leak. The remaining causes: (1) **Fragmentation** — the allocator/collector can't pack the live set densely (external) or wastes space rounding to size classes (internal), so committed memory exceeds used memory; (2) **Off-heap / native memory growth** — direct `ByteBuffer`s, `mmap`, JNI/cgo, native libraries that the heap dump cannot see by construction; (3) **The runtime not returning committed memory to the OS** after a spike (often benign). The lesson: when the live set is flat, the heap analyzer is the wrong tool. Pivot to native memory tracking, `pmap`, and GC/allocator behavior instead of re-reading the dump.

## Question 4

**Explain external vs internal fragmentation and which allocators are prone to each.**

**External fragmentation:** total free memory is sufficient, but it's split into pieces too small or scattered to satisfy a large request. It afflicts non-compacting allocators and collectors (`malloc`-style allocators, non-moving GCs) under long-running mixed-size workloads. **Compacting (moving) collectors** eliminate it by relocating survivors into contiguous space — at the cost of relocation and reference-updating. **Internal fragmentation:** wasted space *inside* an allocation because the allocator rounds the request up to a fixed size class (a 33-byte object in a 48-byte slot). It's inherent to size-class allocators (tcmalloc/jemalloc style, Go's allocator) and depends on the *distribution* of allocation sizes, not volume. External fragmentation looks like a leak; internal fragmentation looks like a constant overhead tax.

## Question 5

**What is a dominator tree and how does it help find a leak?**

In the object reference graph, object A *dominates* B if every path from a GC root to B passes through A. The dominator tree reorganizes the graph so each node's children are the objects it solely keeps alive, which lets you compute **retained size** — the memory freed if that object became unreachable. This answers the leak-hunter's real question: *which single object, if removed, frees the most memory?* Shallow size (the object alone) is nearly useless for leaks because the culprit holder (a `HashMap`) is tiny; its retained size (the megabytes of entries it dominates) is what indicts it. Tools like Eclipse MAT build this tree and rank suspects by retained size.

## Question 6

**Why is goroutine/thread count a useful leak indicator, and what bug does it catch that a heap profile misses?**

A goroutine or thread that never terminates — parked forever on a channel, lock, or I/O — keeps its stack and *everything it references* (request context, buffers, captured variables) alive indefinitely. Because that retained memory is spread thinly across thousands of small stacks rather than concentrated in one big object, a heap profile shows no obvious culprit. But the *count* climbs in lockstep with the leak. Exporting `runtime.NumGoroutine()` (or thread count) as a metric makes this class of leak visible and is often the single tell that distinguishes a goroutine leak from a normal retention leak.

---

## Tool-Specific

## Question 7

**In Go's pprof, what's the difference between `inuse_space` and `alloc_space`, and when do you use each?**

`inuse_space` reports memory **currently live** (allocated and not yet collected) — it answers *retention*: "what is alive right now?" Use it to hunt leaks. `alloc_space` reports **cumulative** bytes allocated over the program's life, including everything already freed — it answers *churn*: "what allocates the most?" Use it to find hot allocation sites driving GC pressure. A site can dominate `alloc_space` (massive churn) while contributing nothing to `inuse_space` (all collected) — that's a churn problem, not a leak. Picking the wrong profile is the most common Go memory-debugging mistake.

## Question 8

**Walk through diagnosing a JVM leak with `jmap` and Eclipse MAT.**

Capture a dump: `jmap -dump:live,format=b,file=heap.hprof <pid>` — the `live` flag forces a full GC first, so the dump contains only retained objects (confirming it's retention, not transient garbage). Pull the file off the host and open it in MAT *offline* (never analyze in the live container). Run the **Leak Suspects** report, then inspect the **dominator tree** sorted by retained size. Find the top dominator, then use **path to GC roots** (excluding weak/soft references) to identify the exact root anchoring it — typically a static field, a thread, or a classloader. That path *is* the bug report. For a cleaner signal, diff two dumps taken minutes apart under load and look at what *grew*.

## Question 9

**Your JVM heap looks clean but RSS keeps climbing. Which tools do you reach for and why?**

Because a clean heap means the leak is off-heap or fragmentation, the heap analyzer is useless here. Reach for: **Native Memory Tracking** (`-XX:NativeMemoryTracking=summary` then `jcmd <pid> VM.native_memory summary`) to categorize native usage (Thread, Code, GC, Internal); **`pmap -x <pid>`** to find the largest native mappings (direct buffers, `mmap`'d files); and **GC logs** to check whether committed heap vastly exceeds used heap (fragmentation / non-returned memory). For direct `ByteBuffer` leaks specifically, watch whether forcing GC eventually reclaims them — if the wrappers are reachable, it won't, confirming the off-heap leak.

## Question 10

**What does `tracemalloc` do in Python, and how would you use it to find a leak?**

`tracemalloc` records the allocation call stack for each block, so you can attribute live memory to the source line that allocated it. The workflow: `tracemalloc.start()` early, take a snapshot at a steady-state baseline, run the workload, take a second snapshot, then `snapshot2.compare_to(snapshot1, 'lineno')` to see which lines *grew* between the two — the diff isolates the leak from the legitimately large baseline. This snapshot-diff approach mirrors the JVM heap-dump-diff and Go pprof techniques: growth is far more legible than absolute size.

## Question 11

**How do you find a leak in native (C/C++) code, and what do `valgrind`/ASan-LSan report?**

`valgrind --leak-check=full` (Memcheck) tracks every `malloc`/`free` and, at exit, reports blocks still allocated with no remaining pointers ("definitely lost") plus blocks reachable only through interior pointers ("possibly lost"), each with the allocation stack. It's thorough but slows execution ~10–50×. **ASan's LeakSanitizer (LSan)** does similar leak detection at far lower overhead by instrumenting allocations at compile time; it reports leaks at exit (or on demand) with stacks. Use LSan for routine CI/dev runs and Memcheck/`massif` (heap profiler) when you need exhaustive accounting or a memory-over-time profile. For native leaks behind a managed runtime (JNI/cgo), these are the only tools that see them.

---

## Tricky / Trap

## Question 12

**A teammate returns a 20-byte slice from a 200 MB buffer in Go and stores it in a cache. Memory balloons. Why, and what's the fix?**

Re-slicing in Go does *not* copy — the returned slice points into the **same backing array** as the original 200 MB buffer. As long as that 20-byte slice is reachable (here, held in a cache), the entire 200 MB array is pinned and uncollectable. You retained 200 MB to keep 20 bytes. The fix is to **copy** the needed bytes into a fresh, right-sized slice so the small result no longer references the large array: `out := make([]byte, len(s)); copy(out, s)`. The same trap existed in Java's `String.substring` before JDK 7u6, where substrings shared the parent's `char[]`. This bug is invisible in code review and small tests — it only bites with a large backing array and a long-lived slice.

## Question 13

**Is a cache a memory leak? When is it, and when isn't it?**

An *unbounded* cache that only ever inserts and never evicts is a leak — it grows with input cardinality until OOM. A *bounded* cache (size-capped LRU, TTL-expiring) that hovers at its limit is **not** a leak; it's a flat-but-high plateau, which is healthy. The trap candidates fall into is calling any large memory footprint a "leak." A leak is *unbounded growth* or retention far exceeding need — not merely high usage. The follow-up trap: a cache keyed on something with unbounded cardinality (full URLs with query strings, user-generated keys) *looks* bounded by code but isn't bounded in practice. Always ask: *what bounds the key space?*

## Question 14

**You suspect a leak, run the service locally for five minutes, and see no growth. Does that prove there's no leak?**

No. Leaks need **time and traffic** to manifest. A bug that takes six hours of production load to OOM will look perfectly healthy in a five-minute local run with no realistic load. The trap is declaring "can't reproduce, not a bug." The correct approach is to reproduce *under sustained, realistic (ideally accelerated) load* and watch the **post-GC floor over time** — and to track the slope between production restarts rather than crash frequency, since auto-restart masks slow leaks for months. Absence of a leak in a short, unloaded run is not evidence of absence.

## Question 15

**Forcing a full GC (`System.gc()` / `runtime.GC()`) doesn't reduce RSS. What does that tell you?**

It tells you the growing memory is **not** reachable-but-collectable heap — a forced collection would have reclaimed that. The likely causes are: **off-heap/native memory** (direct buffers, `mmap`, JNI/cgo) that GC doesn't manage and won't free while the wrappers are reachable; **fragmentation** or committed-but-unused heap the runtime hasn't returned to the OS; or a genuine **reachable-object leak** (the objects are still referenced, so GC correctly keeps them). The trap is assuming `System.gc()` is a diagnostic or a fix — it's neither for these classes. If a forced GC doesn't help, stop thinking "garbage" and start thinking native/fragmentation/genuine-retention.

---

## Design

## Question 16

**Design a leak-resistant caching layer for a high-traffic service. What properties must it have?**

Key properties: (1) **Bounded by construction** — a size cap (LRU/LFU) and/or TTL enforced by the cache *type*, never a raw map, so the bound doesn't depend on reviewer vigilance; (2) **Controlled key cardinality** — normalize keys (route templates, not raw URLs) so the key space can't explode; (3) **Tunable via config** — sizes/TTLs adjustable without a deploy, so a leak can be *mitigated* by tightening bounds in an incident; (4) **Weak/soft references where appropriate** — for caches keyed on live objects, so the GC can reclaim despite the cache reference (with awareness of nondeterministic eviction); (5) **Observable** — export hit rate, size, and eviction rate so saturation and unbounded growth are visible on dashboards; (6) **Memory-pressure aware** — eviction responsive to actual memory pressure, not just count, to avoid OOM from large values. The overarching principle: make the bound a *structural property of the data structure*, and make growth *observable*, so the cache cannot silently become the leak.

## Question 17

**How would you build leak detection into CI and production observability so leaks are caught before the pager fires?**

In **CI**: a heap-growth test that warms up to steady state, forces a GC, drives a large number of *distinct-key* iterations (to stress unbounded caches), forces GC again, and asserts the post-GC heap grew less than a tolerance. Warm-up plus GC framing is essential to avoid false positives from one-time init and pool fill-up. In **production observability**: export the two leak SLIs — **post-GC heap occupancy** (catches retention; alert on a rising floor / slope) and **goroutine/thread count** (catches accumulation leaks invisible to heap size); annotate the memory dashboard with **deploy markers** so a slope's onset can be bisected to a release; enable always-on safety nets (`-XX:+HeapDumpOnOutOfMemoryError`, GC logging, NMT, pprof endpoints) so a crash auto-captures evidence; and alert on **memory burn rate** (MB/hour) and **time-to-OOM**, not just on hitting the limit, so you get hours of warning instead of a 3 a.m. OOM kill.
