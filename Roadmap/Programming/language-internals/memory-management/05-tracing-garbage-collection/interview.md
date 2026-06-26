# Tracing Garbage Collection — Interview Questions

> **Topic:** [Tracing Garbage Collection](README.md)

A bank of interview questions on tracing garbage collection, from fundamentals to design. Each answer is written to be said out loud in 1–3 minutes and to reveal depth, not just recall. Use the trap questions to pressure-test understanding.

---

## Table of Contents

- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What does a tracing garbage collector consider "alive", and why is that definition safe?**

An object is alive if and only if it is **reachable** — there is a chain of pointers from a **root** (stack variables, CPU registers, globals) to it. It's safe because to *use* an object the program must hold a reference to it, and references ultimately originate at roots; if no path of pointers reaches an object, no executable code can ever touch it again, so reclaiming it cannot change observable behavior. The crucial caveat: reachable ≠ needed. A forgotten reference in a global keeps dead-but-reachable objects alive forever — that's how you leak memory in a GC'd language.

## Question 2

**Walk me through mark-sweep.**

Two phases. **Mark:** start from the roots and trace the object graph (DFS/BFS), setting a mark bit on every reachable object. **Sweep:** scan the whole heap linearly; any object without a mark bit is garbage — reclaim it onto a free list — and clear the mark bits of survivors for next time. Cost is `O(live)` to mark plus `O(heap)` to sweep. It's non-moving, so addresses stay stable, but the heap fragments over time, and allocation must search a free list.

## Question 3

**Tracing GC vs reference counting — compare them.**

Reference counting keeps a per-object count of incoming references and frees an object the instant its count hits zero — immediate, incremental reclamation. Its fatal flaw is **reference cycles**: A↔B keep each other's count at 1 even when unreachable, so they leak unless a backup tracer exists. Tracing collects in batches and handles cycles naturally (an unreachable cycle is simply never marked), but can introduce pauses. Refcounting also taxes every pointer assignment with a count update and can cause cascading frees. CPython uses both: refcounting for the common case, a cyclic tracer to break cycles.

## Question 4

**Explain the tri-color abstraction and the tri-color invariant.**

Every object is white (unvisited), grey (visited but children not yet scanned — the work frontier), or black (visited and fully scanned). Marking repeatedly takes a grey object, greys its white children, and blackens it; when no grey remains, white = garbage. The **strong invariant** is "no black object points directly to a white object"; the **weak invariant** relaxes this to "any white object referenced by a black object is also reachable from a grey object." Concurrent collectors must preserve one of these despite mutator writes, using a write barrier, otherwise a live object can stay white and be wrongly collected.

## Question 5

**What is the weak generational hypothesis and how do collectors exploit it?**

It states that **most objects die young** — the bulk of allocations become garbage almost immediately. Generational collectors split the heap into a small young generation (nursery), collected frequently and cheaply (often by a copying collector, since almost everything there is dead), and an old generation, collected rarely by a more expensive algorithm. Objects surviving several minor GCs are promoted (tenured) to the old gen. This concentrates GC effort on a small, mostly-garbage region, dramatically improving throughput.

## Question 6

**Why does a copying collector "waste" half the heap, and when is that a good trade?**

Copying splits the heap into from-space and to-space; you allocate only in from-space, and on collection you evacuate live objects into to-space and abandon from-space wholesale. Only one half is usable at a time, so you reserve 50%. The trade is excellent when the region is **small and mostly dead** — you pay `O(live)` (never touching garbage), get bump allocation and automatic compaction, and the wasted half is tiny. That's exactly the young generation, which is why copying nurseries are ubiquitous and full-heap copying is not.

## Question 7

**What problem do write barriers and remembered sets solve in generational GC?**

A minor GC wants to collect only the young gen using roots as its starting set, but an **old object may point to a young object** (you stored a new item into a long-lived list). Ignoring the old gen would wrongly collect that young object; scanning the whole old gen would kill the performance win. The **write barrier** is compiler-injected code on every pointer store that detects old→young references and records them (commonly via a card table) in the **remembered set**. The minor GC then scans roots plus the remembered set, catching those references cheaply.

## Question 8

**Stop-the-world vs concurrent vs incremental — define each.**

**STW:** all mutator threads are paused while the collector runs; simplest, highest throughput, but pauses scale with heap/live size. **Concurrent:** the collector runs on its own threads *simultaneously* with the mutator, requiring barriers to stay correct; pauses shrink toward just root-scan time. **Incremental:** the collector runs in small slices interleaved with the mutator on the same threads, bounding each pause without true parallelism. Concurrent and incremental trade throughput (barrier overhead, extra CPU) and memory (headroom) for lower latency.

## Tool-Specific

## Question 9

**Describe Go's garbage collector.**

Go uses a **concurrent, non-generational, non-moving, tri-color mark-sweep** collector. Marking runs concurrently with the program, kept correct by a hybrid write barrier (a Yuasa deletion barrier plus a Dijkstra insertion barrier) so it avoids re-scanning stacks. Sweeping is concurrent/lazy. It's non-moving (cgo pointers stay valid) and deliberately non-generational — Go instead reduces allocation via escape analysis and stack allocation. The **pacer**, governed by `GOGC` (and `GOMEMLIMIT`), decides when to start a cycle to hit a heap-growth target; if the app out-allocates the collector, mutators do **GC assist** work. Pauses are typically sub-millisecond.

## Question 10

**Tour the HotSpot collectors. When would you pick each?**

**Serial** — single-threaded STW, for tiny heaps/containers. **Parallel** — multi-threaded STW, maximizes throughput, tolerates long pauses; ideal for batch/analytics. **G1** — region-based, generational, mostly-concurrent marking (SATB) with STW evacuation, targets a pause-time goal by collecting the emptiest regions first; the balanced default. **ZGC** — concurrent-compacting via colored-pointer load barriers, sub-millisecond pauses independent of heap size, scales to terabytes (now generational). **Shenandoah** — concurrent-compacting via load-reference barriers, similar low-pause goals. Choose by SLO: throughput → Parallel, balance → G1, flat low latency on huge heaps → ZGC/Shenandoah.

## Question 11

**What's the difference between G1's and ZGC's approach to low pauses?**

G1 is **mostly-concurrent**: it marks concurrently (SATB) but evacuates live objects during **STW** pauses, sizing the collection set to *try* to meet a pause goal — so pauses still grow somewhat with the work per cycle. ZGC is **fully concurrent-compacting**: it relocates objects while the mutator runs, using **load barriers** and **colored pointers** to forward/remap references on every read, so its STW phases are just brief root-scan/handshake work and pauses stay sub-millisecond *regardless of heap size*. ZGC pays for this with load-barrier throughput overhead and more memory headroom.

## Question 12

**How does CPython manage memory?**

Primarily **reference counting**: every object has a refcount adjusted on each reference change, and it's freed immediately when the count reaches zero — giving prompt, fairly deterministic reclamation. Because refcounting can't reclaim **reference cycles**, CPython adds a **generational cyclic garbage collector** that periodically traces to find and break unreachable cycles. It's the textbook hybrid: refcounting handles the common case cheaply and predictably; tracing handles the cycles refcounting misses.

## Tricky / Trap

## Question 13

**"Tracing GC can't handle cyclic references." True or false?**

**False** — and it's the reverse of the truth. *Reference counting* is the one that leaks cycles, because each object in an A↔B cycle keeps the other's count above zero. *Tracing* handles cycles trivially: reachability is defined from roots, so an unreachable cycle is simply never marked and gets collected. The mark loop's "already marked?" check both terminates the trace and makes cycles a non-issue. (CPython adds a tracer to its refcounting specifically to clean up the cycles refcounting can't.)

## Question 14

**An object is unreachable. Has its memory been freed?**

Not necessarily — and not immediately under tracing. Unreachability makes an object *collectable*, but the memory is only reclaimed when the next GC cycle runs and the collector marks/sweeps. Under a concurrent collector it may also linger as **floating garbage** for a cycle (especially with SATB, which conserves the snapshot at GC start). Under reference counting it would be freed at once when the count hits zero — but that's a different mechanism. So "unreachable" ≠ "already freed."

## Question 15

**You set every reference to a big cache to null but memory doesn't drop. Why might that be, and is it a GC bug?**

Almost never a GC bug. Likely causes: (1) something *still* references the objects — an event listener, a closure capture, a thread-local, a slice aliasing a huge backing array, an unbounded map you forgot to clear — so they remain reachable; (2) the GC simply hasn't run yet, since unreachable ≠ freed; (3) the runtime reclaimed the objects but hasn't **returned the pages to the OS** (many allocators keep freed memory for reuse, so RSS stays flat). Diagnose with a heap profiler showing the retention path before blaming the collector.

## Question 16

**Why can't a conservative collector move objects?**

A conservative collector can't tell for certain whether a given word is a pointer or just an integer that happens to look like a heap address. To **move** an object you must rewrite every pointer to it; if you "updated" a value that was actually a non-pointer integer, you'd corrupt the program's data. Since the collector can't be sure, it must leave objects in place — conservative collectors are inherently **non-moving** (and they also suffer false retention, pinning dead objects that an integer coincidentally points into). Moving collectors require **precise** scanning with compiler-generated pointer maps.

## Question 17

**Your service shows sub-millisecond average GC pauses but occasional 50 ms latency spikes correlated with GC. What's going on?**

The advertised sub-ms is the *typical* STW, but the outliers usually come from one of: (1) **time-to-safepoint** — a thread stuck off-safepoint (long counted loop, JNI critical section, syscall) delays the whole STW root scan, so the *pause* is small but threads took ages to *reach* it; (2) a **fallback STW collection** — the mutator out-allocated the concurrent collector, forcing an evacuation failure / full GC (or, in Go, heavy **GC assist** that looks like sporadic per-request slowness); (3) the machine is CPU-saturated so concurrent GC threads starve the app. Decompose the pause and check allocation/promotion rate and TTSP before tuning.

## Design

## Question 18

**Sketch a minimal mark-sweep collector. What are its core data structures and phases?**

Each object needs a **mark bit** and a way to enumerate its pointer fields. You need the **root set** (stack/registers/globals) and a list of all heap objects (or a way to walk the heap linearly), plus a **free list** for reclaimed space. **Mark:** push roots onto a worklist; pop, skip if nil or already marked, set the mark bit, push children; the "already marked" check handles cycles and termination. **Sweep:** walk all objects; unmarked → reclaim to the free list; marked → clear the bit for the next cycle. Allocation pops from the free list and triggers a collection when free space runs low. Limitations to call out: STW, fragmentation, free-list search cost.

## Question 19

**Design a GC for a low-latency trading service with a 100 GB heap and a p99.9 pause budget of 1 ms.**

This is a pure latency play, so I'd choose a **fully concurrent-compacting** collector — ZGC (generational) or Shenandoah on the JVM, or accept Go's concurrent non-moving collector if the language is fixed. Requirements: pauses must be **independent of heap size**, which rules out STW marking/evacuation; load-barrier-based concurrent relocation provides that. I'd **provision generous headroom** (run well below the limit) so the concurrent cycle finishes before the heap fills and never falls back to STW. I'd **minimize allocation rate** in the hot path (object reuse, off-heap or value types, escape analysis) to keep cycles infrequent, and obsess over **time-to-safepoint** (no long off-safepoint loops). I'd explicitly accept the costs: lower throughput from load barriers and higher memory footprint — both worth it for the 1 ms tail. Validate with tail-percentile load tests at production scale.

## Question 20

**When would you deliberately choose a non-generational collector?**

When the generational assumptions don't pay off or the complexity isn't worth it. Go made this call: it relies on **escape analysis and stack allocation** to absorb the short-lived allocations a nursery would catch, so a young generation buys less; staying non-generational keeps the collector simpler, avoids generational write-barrier/remembered-set machinery, and keeps it non-moving (good for cgo). You'd also consider it for workloads whose allocations *don't* follow the weak generational hypothesis — e.g., objects with a roughly uniform or bimodal-but-long lifetime — where a nursery just adds promotion churn without reducing work. The trade is potentially lower throughput than a tuned generational compactor and no defragmentation.

## Question 21

**Insertion barrier (incremental-update) vs deletion barrier (SATB) — which would you pick for a concurrent collector and why?**

Both preserve a tri-color invariant during concurrent marking but conserve different things. **SATB/deletion** shades the *overwritten* (old) target grey, preserving a logical snapshot of the graph at GC start: easy, provable marking termination and no need to re-scan stacks, at the cost of **more floating garbage** (objects live at snapshot survive the cycle even if dropped). **Incremental-update/insertion** shades the *new* target grey on writes into black objects: tracks newly-reachable objects precisely, so **less floating garbage**, but termination is trickier because the live set can grow during the cycle. I'd pick SATB (like G1/Shenandoah) when predictable termination and stack handling matter most and a little extra transient memory is acceptable; Go uses a hybrid to get the best of both while avoiding stack re-scans.
