# Off-heap / Native Memory — Senior Level

> **Topic:** [Off-heap / Native Memory](README.md)
> **Focus:** Design and cross-runtime trade-offs — when off-heap is the right architecture, how to model lifetime and ownership across a system, and how the choice ripples into GC tuning, serialization, and the OS.

---

## Table of Contents

- [Introduction](#introduction)
- [Core Concepts](#core-concepts)
  - [When off-heap is actually the right call](#when-off-heap-is-actually-the-right-call)
  - [Designing ownership and lifetime](#designing-ownership-and-lifetime)
  - [The serialization boundary](#the-serialization-boundary)
  - [How off-heap reshapes GC behavior](#how-off-heap-reshapes-gc-behavior)
  - [mmap as an architecture, not just an API](#mmap-as-an-architecture-not-just-an-api)
  - [Cross-runtime trade-off table](#cross-runtime-trade-off-table)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

Knowing the off-heap APIs is the middle tier. The senior question is *whether to reach for them at all*, and if so, how to structure the system so the manual-memory responsibility doesn't metastasize into leaks and crashes scattered across the codebase. Off-heap is a power tool: it removes the GC from the hot path for huge datasets, but it reintroduces every problem managed runtimes were invented to solve. The senior skill is containing that blast radius — concentrating native ownership in a few well-tested components and keeping the rest of the system in the safe, managed world.

---

## Core Concepts

### When off-heap is actually the right call

Off-heap pays for itself in a narrow set of scenarios. Reach for it when:

- **A large, long-lived dataset dominates the heap and inflates GC pauses.** A 30 GiB in-process cache on the JVM means the GC must scan tens of millions of references every cycle; pauses scale with live-set size. Move it off-heap and the GC's live set shrinks to your *actual* short-lived working objects, and pauses collapse. This is the single strongest motivator and the reason Cassandra, Kafka, Ignite, and Elasticsearch all use off-heap structures.
- **You need zero-copy interop** with native libraries, the kernel, or DMA-capable hardware (NICs, GPUs). On-heap data may be moved by a compacting GC, so handing its address to native code requires *pinning*; off-heap memory is never moved, so no pinning, no copy.
- **The dataset exceeds RAM** and you want the OS to manage the working set — memory-mapped files.
- **You need a packed binary layout** without per-object header overhead, or **inter-process shared memory**.

Reach for it for **none of these** when the data is small, short-lived, or churns rapidly — the GC handles that case better than you will, and you'll spend your innovation budget debugging native leaks instead of shipping features. "We might need it for performance" is not a reason; a profiler showing GC pauses dominated by a specific large structure is.

### Designing ownership and lifetime

The cardinal rule: **every off-heap region has exactly one owner, and that owner's lifetime is explicit in the code.** Diffuse ownership ("whoever allocated it frees it, somewhere") is how you get leaks. Concrete patterns:

- **Arena/region per request or per task.** Allocate everything for a unit of work from one `Arena`, close it at the boundary, free everything at once. This is both fast (one free, not N) and leak-proof (you can't forget an individual buffer). Panama's confined `Arena`, Rust's bump allocators, and C's region allocators all express this.
- **Pool with explicit return.** For hot reusable buffers (network IO), an owner-pool hands out and reclaims buffers; reference-counting (Netty's `ByteBuf.retain()/release()`) tracks shared ownership. Leaks here are *missed releases*, which Netty famously detects with sampled leak tracking.
- **Lifetime tied to a managed object as a last resort.** `Arena.ofAuto()` / a `Cleaner` / a finalizer ties native lifetime to GC. Use this only when you genuinely cannot scope the lifetime, and never as the primary strategy — it reintroduces the unpredictability of the `DirectByteBuffer` Cleaner trap.

### The serialization boundary

Off-heap memory holds *bytes*, not objects. You cannot store a `User` object off-heap; you store its serialized form and reconstruct (or read fields in place). This forces a design decision:

- **Decode-on-read** (deserialize to a heap object each access): simple, but every read allocates and you've partly re-created the GC pressure you fled.
- **Read-in-place / flyweight** (access fields directly at their off-heap offsets, never materializing an object): maximum performance, zero allocation, but you hand-roll a binary layout and accessor methods. This is what high-performance systems (Chronicle, columnar engines, Aeron) do.

The read-in-place style is the reason off-heap and *binary columnar formats* (Arrow, custom layouts) travel together: the format is the off-heap representation, and the off-heap representation is the format. Choosing decode-on-read often means off-heap wasn't worth it.

### How off-heap reshapes GC behavior

Moving the big data off-heap doesn't just reduce pauses — it changes your whole tuning posture:

- The live set shrinks, so you can often run a **smaller `-Xmx`**, which means faster GC cycles and lower per-cycle cost.
- Generational GCs benefit most: the off-heap data was likely long-lived (old-gen), and removing it cuts old-gen collection cost, which is where the big pauses live.
- But you've added a **native allocation cost** and a **native footprint** that the GC heuristics know nothing about. The JVM's ergonomics size the heap against `-Xmx`, oblivious to your 30 GiB off-heap, so on a container you must hand-budget: `container_limit ≈ -Xmx + MaxDirectMemorySize + thread_stacks + code_cache + metaspace + your_off_heap + headroom`.

### mmap as an architecture, not just an API

Memory-mapped files are a design choice with deep consequences, which is why databases split into two camps. **mmap-based engines** (LMDB, and historically MongoDB's MMAPv1) delegate caching, eviction, and IO scheduling entirely to the kernel page cache — simple, zero-copy reads, but you lose control: you can't prioritize eviction, page faults cause unpredictable latency stalls, and write durability via `msync` is subtle. **Buffer-pool engines** (PostgreSQL, InnoDB, RocksDB's block cache) manage their own cache in userspace — more code, but full control over eviction policy, prefetch, and write ordering. The famous "Are You Sure You Want to Use MMAP in Your Database Management System?" critique (Crotty et al.) argues serious DBMSs should own their buffer pool; LMDB's success argues the opposite for read-mostly workloads. The senior takeaway: mmap trades control for simplicity, and that trade is workload-dependent.

### Cross-runtime trade-off table

| Runtime | Primary off-heap API | Lifetime model | Safety | Best for |
|---|---|---|---|---|
| JVM (legacy) | `Unsafe.allocateMemory` | Manual `freeMemory` | None (raw) | Existing libraries only |
| JVM (modern) | `Arena`/`MemorySegment` | Scoped `Arena.close()` | Bounds-checked | New off-heap + FFI |
| JVM (IO) | `allocateDirect` | Cleaner (GC) | Bounds-checked | NIO buffers (cap it!) |
| Go | `unix.Mmap` | Manual `Munmap` | None on the slice past bounds | Large maps, mmap files |
| Rust | `memmap2`, raw `alloc` | RAII `Drop` | Compiler-enforced | The safest manual off-heap |
| .NET | `NativeMemory.Alloc` | Manual `Free` / `using` | None (raw) | Interop, packed buffers |

---

## Code Examples

**Arena-per-task ownership (JVM/Panama) — the recommended structure:**

```java
void processBatch(List<Record> records) {
    try (Arena arena = Arena.ofConfined()) {
        // every off-heap allocation for this batch comes from `arena`
        MemorySegment scratch = arena.allocate(records.size() * RECORD_SIZE);
        encodeAll(records, scratch);
        nativeProcess(scratch);          // zero-copy handoff to native code
    } // ALL batch memory freed here in one shot — impossible to leak a buffer
}
```

**Read-in-place flyweight over an off-heap region (no object materialized):**

```java
// Layout: [int id @0][long ts @8][int score @16], stride 24 bytes
static int recordId(MemorySegment seg, long index) {
    return seg.get(ValueLayout.JAVA_INT, index * 24);     // direct field read
}
static long recordTs(MemorySegment seg, long index) {
    return seg.get(ValueLayout.JAVA_LONG, index * 24 + 8); // no allocation, no GC
}
```

**Go — mmap a file with an access-pattern hint:**

```go
m, _ := unix.Mmap(int(f.Fd()), 0, size, unix.PROT_READ, unix.MAP_SHARED)
defer unix.Munmap(m)
// Tell the kernel we'll scan sequentially so it reads ahead aggressively.
_ = unix.Madvise(m, unix.MADV_SEQUENTIAL)
```

---

## Pros & Cons

**Pros (design-level)**
- Decouples dataset size from GC pause time — the core architectural win.
- Enables zero-copy pipelines (mmap → off-heap parse → native/DMA) with no intermediate copies.
- Region/arena ownership can be *more* leak-resistant than reference-counted on-heap graphs, because freeing is bulk and scoped.

**Cons (design-level)**
- You take on a buffer-management and serialization layer the runtime used to provide for free.
- Tuning and capacity planning become manual and error-prone (heap limit no longer bounds the process).
- Diffuse ownership leaks are subtle and invisible to standard tools — a real operational tax.
- Read-in-place layouts are rigid: schema evolution means versioned binary formats.

---

## Best Practices

1. **Profile first.** Only move a structure off-heap after a profiler shows it dominating GC cost or footprint. Don't speculate.
2. **Concentrate native ownership.** Put all `malloc`/`mmap`/free in a small, well-tested set of components behind a safe API; keep application code on the heap.
3. **Prefer arena/region scoping** over per-object freeing — it's faster and harder to leak.
4. **Budget the whole process, not the heap.** Compute the container limit from heap + off-heap + all the other native consumers, with headroom.
5. **Choose your serialization stance deliberately.** If you're decode-on-read, re-question whether off-heap is even worth it.
6. **Make off-heap observable from day one** — metrics, NMT, leak detection — because you cannot debug what you can't see, and you will need to.

---

## Edge Cases & Pitfalls

- **Off-heap that's secretly on the hot allocation path.** If you allocate/free native memory per request, the `malloc` cost and lock contention can erase the GC savings. Pool it.
- **NUMA effects on huge regions.** A 64 GiB off-heap region touched by threads pinned to a different socket pays remote-memory latency; first-touch placement matters at this scale.
- **Transparent Huge Pages.** THP can cause latency spikes and bloat on large `mmap` regions; many databases recommend disabling it. Know your defaults.
- **mmap latency cliffs.** A page fault on a cold mmap'd page is a synchronous disk read in the middle of your "memory" access — a tail-latency source invisible in CPU profiles.
- **Shared-memory lifetime across processes.** With inter-process shared memory, *no single process owns the lifetime*; you need an out-of-band protocol (or `shm_unlink` discipline) to avoid leaking segments that outlive every process.

---

## Summary

At the senior level, off-heap is an architectural decision with a narrow but high-value sweet spot: large, long-lived, GC-pressuring datasets; zero-copy native interop; data larger than RAM. The discipline that makes it safe is *concentrated, explicit ownership* — arena/region scoping over diffuse per-object freeing, a small native core behind a safe API, and a serialization stance (read-in-place vs decode-on-read) chosen on purpose. Off-heap reshapes GC tuning (smaller heap, smaller live set, but a native footprint the ergonomics can't see), and mmap-based designs trade control for simplicity in a way that's right for some databases and wrong for others. The recurring lesson: off-heap gives back the performance the GC costs you, in exchange for the safety the GC gave you — make that trade only where the profiler proves it pays.
