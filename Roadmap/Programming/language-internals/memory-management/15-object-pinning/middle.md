# Object Pinning & Movable Heaps — Middle Level

> **Topic:** [Object Pinning & Movable Heaps](README.md)
> **Focus:** The concrete mechanisms — how .NET, the JVM, and Go actually pin, and what pinning costs the collector.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Mechanisms by Runtime](#mechanisms-by-runtime)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [The Cost of Pinning](#the-cost-of-pinning)
- [Coding Patterns](#coding-patterns)
- [Pros & Cons](#pros--cons)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

The junior tier established *why* pinning exists: a moving GC relocates live objects, the GC rewrites managed references, but raw addresses held outside the runtime would be left dangling. This tier gets concrete. You will see the actual APIs — .NET's `fixed`, `GCHandle`, and `Memory<T>.Pin()`; the JVM's JNI critical regions; Go's `runtime.Pinner` — and you will understand the **mechanics and the cost**: how a pinned object becomes an immovable island that fragments a compacting heap, and how each runtime tries to limit the damage.

A key theme: pinning is not one thing. Different runtimes implement it differently, with different rules, and "pin" sometimes even means "copy instead of pin" under the hood (JNI). Knowing the mechanism is what separates a developer who *uses* an interop API from one who understands why it occasionally tanks GC performance.

## Prerequisites

- Junior tier: moving GC, managed vs. raw pointers, the basic pin/unpin idea.
- Familiarity with **generational GC**: young objects in a nursery (gen0), survivors promoted to older generations.
- Basic understanding of **heap fragmentation** (free space split into unusable small gaps).
- Exposure to at least one FFI mechanism (P/Invoke, JNI, or cgo) is helpful.

## Glossary

- **Compaction** — sliding live objects together to eliminate gaps; the operation pinning interferes with.
- **Bump allocation** — allocating by advancing a single pointer; enabled by a compact heap.
- **Generational GC** — segregates objects by age; collects the young generation frequently and cheaply.
- **GCHandle** — a .NET handle giving stable indirection to an object; `Pinned` variant fixes its address.
- **Pinned Object Heap (POH)** — a .NET 5+ heap segment dedicated to pinned objects, kept apart from the compacting heap.
- **JNI critical region** — a JVM bracket (`GetPrimitiveArrayCritical`/`Release...`) where the GC may be disabled and the array address exposed.
- **`runtime.Pinner`** — Go 1.21's official type for pinning Go objects across a cgo call.
- **Interior pointer** — a pointer into the *middle* of an object (or stack frame), not its head.

## Core Concepts

### Why a moving heap is worth defending

Compaction buys two things: **zero fragmentation** and **bump allocation**. When live objects are packed contiguously, free memory is one large block, and allocating is `top += size`. This is dramatically faster than a free-list walk and is one reason managed allocation can outpace `malloc`. Generational collectors lean on this hard: gen0 is collected constantly, survivors are *copied* (moved) to gen1, and so on. Moving is not incidental — it is the engine.

So when you pin, you are inserting a fixed obstacle into a system whose performance *depends* on freely rearranging objects.

### A pinned object is an immovable island

During compaction, the collector slides live objects toward one end. A pinned object cannot slide. The collector must leave it exactly where it is and route the compaction *around* it. The result is a **hole**: the space objects would have occupied had they been allowed to move into the pinned object's location. Pin several objects scattered across gen0 and you get Swiss cheese — many small holes that can't be coalesced. That is **pinning-induced fragmentation**, and it is the central performance cost.

### Pinning lives at war with generational collection

Pinning is worst in the **young generation**, because gen0 is collected frequently and is meant to be cheap. A pin there forces the collector to special-case the nursery on every collection. This is the motivation behind .NET's Pinned Object Heap: move pinned objects *out* of the compacting generations entirely so the nursery stays clean.

## Mechanisms by Runtime

### .NET / CLR

.NET's GC is generational and **compacting**, so pinning is a first-class, frequently-used concept. There are several APIs, escalating in lifetime:

1. **`fixed` statement** — scoped, stack-rooted pinning for the duration of a block. The pin is recorded cheaply on the stack; the GC sees it during a collection that overlaps the block. Lowest overhead, shortest lifetime. Use this by default.

2. **`GCHandle.Alloc(obj, GCHandleType.Pinned)`** — a *heap-rooted* pin with an explicit lifetime. You get a `GCHandle`, call `AddrOfPinnedObject()` for the stable address, and must `Free()` it later. Use when the pin must outlive a single stack frame (e.g., the address is stored and used across multiple managed calls). More dangerous: forgetting `Free()` leaks the pin.

3. **`Memory<T>.Pin()` → `MemoryHandle`** — the modern, abstraction-friendly path. `MemoryHandle` is `IDisposable`; disposing it unpins. Works uniformly over arrays, native memory, and custom `MemoryManager<T>`.

4. **Pinned Object Heap (POH), .NET 5+** — allocate inherently-pinned objects via `GC.AllocateArray<T>(length, pinned: true)`. These live on a separate, non-compacting heap. Ideal for **long-lived** pinned buffers (e.g., a reused DMA/IO buffer) because they never fragment the normal generations.

### JVM / JNI

The JVM standard does **not** expose object pinning to Java code; it surfaces in **JNI** (native interop):

- **`GetPrimitiveArrayCritical` / `ReleasePrimitiveArrayCritical`** — requests a direct pointer to a primitive array's storage. Inside the **critical region** you must obey strict rules: do not block, do not make other JNI calls, do not allocate on the Java heap, keep it short. The JVM may **disable GC** for the duration (a heavyweight "stop everything" form of pinning) or it may copy — it is implementation-defined.

- **`Get<Type>ArrayElements` / `Release...`** — returns a pointer that *may be a pin or may be a copy* (`isCopy` out-parameter tells you). If copied, your writes only take effect on `Release` with mode `0` or `JNI_COMMIT`. This ambiguity is a defining JNI gotcha.

- **`DirectByteBuffer`** — the copy-free, *pin-free* alternative. Its storage is **off the Java heap** (native memory), so its address is permanently stable and no pinning is needed. Preferred for long-lived native sharing.

### Go / cgo

Go's heap is historically **non-moving for heap objects**, which made cgo simpler — a heap object's address was stable. But Go **moves goroutine stacks**: when a stack grows, it is copied to a larger region and all pointers into it are rewritten. So the real hazard is pointers to *stack-allocated* data, and the rule that **C must not retain a Go pointer after the call returns** (the GC may move/free it later, and the pointer-passing rules forbid C holding Go pointers).

- **cgo pointer-passing rules**: Go memory passed to C must not itself *contain* Go pointers (unless pinned), and C must not keep copies of Go pointers past the call. Violations are caught at runtime by `cgocheck`.
- **`runtime.Pinner` (Go 1.21)**: the official API. `var p runtime.Pinner; p.Pin(obj)` keeps `obj` (and lets you legally pass Go memory containing Go pointers to C); `p.Unpin()` releases all pins on that Pinner. This finally gives Go a clean, supported pinning primitive instead of `unsafe` hacks.

### Rust — a different "pinning" (sidebar)

Rust's `Pin<P>` is **not** GC pinning. Rust has no moving GC. `Pin` is a **type-system guarantee** that a value will not be *moved in memory by safe code* after being pinned — needed for **self-referential types**, most importantly `async` futures that hold pointers into their own storage. It prevents the *compiler/library* from moving a value, not a *collector*. Same word, unrelated mechanism. Do not conflate the two: GC pinning protects addresses from a *relocating collector*; Rust `Pin` protects addresses from *ordinary moves* in a language that has no collector.

## Mental Models

**Model 1 — Lifetime ladder.** Pinning APIs form a ladder by lifetime: `fixed` (one block) < `MemoryHandle`/`GCHandle` (explicit span) < POH/off-heap (effectively permanent). Climb only as high as you must.

**Model 2 — "Pin or copy" is the real choice.** Every interop boundary forces a decision: pin the managed buffer (cheap now, fragments later) or copy to native memory (cost up front, no GC interference). JNI even folds both into one API.

**Model 3 — Pins are holes.** Visualize each pinned object as a peg the compactor cannot remove. Few short pegs: fine. Many long-lived pegs: a fragmented board.

## Code Examples

**.NET — `GCHandle` for a pin that outlives a block:**

```csharp
byte[] buffer = new byte[4096];
GCHandle handle = GCHandle.Alloc(buffer, GCHandleType.Pinned);
try
{
    IntPtr addr = handle.AddrOfPinnedObject(); // stable while pinned
    StartAsyncNativeRead(addr, buffer.Length); // native code keeps addr briefly
    WaitForNativeReadToComplete();
}
finally
{
    handle.Free(); // <-- MUST run, or the pin leaks forever
}
```

**.NET — Pinned Object Heap for a long-lived reused buffer:**

```csharp
// Allocated already-pinned, on the POH: never fragments gen0/gen1/gen2.
byte[] dmaBuffer = GC.AllocateArray<byte>(65536, pinned: true);
// Reuse `dmaBuffer` for many native IO operations without per-use pinning.
```

**Go — `runtime.Pinner` across a cgo call:**

```go
func sendToC(data []byte) {
    var pinner runtime.Pinner
    defer pinner.Unpin()          // releases on return

    pinner.Pin(&data[0])          // pin the backing array element
    C.consume(unsafe.Pointer(&data[0]), C.int(len(data)))
    // Pin lets us legally pass Go memory to C; C must not retain it after return.
}
```

**JNI — a critical region (C side):**

```c
jint *elems = (*env)->GetPrimitiveArrayCritical(env, arr, NULL);
/* INSIDE the critical region: no blocking, no other JNI calls, keep it short. */
process(elems, length);          // may run with GC disabled
(*env)->ReleasePrimitiveArrayCritical(env, arr, elems, 0); // unpin / commit
```

## The Cost of Pinning

- **Fragmentation.** Pinned objects block compaction, leaving holes that waste memory and can force the heap to grow.
- **Longer pauses.** The collector must track and work around pins; heavy pinning lengthens GC pauses.
- **Reduced allocation throughput.** A fragmented heap loses cheap bump allocation in the affected regions.
- **Worst in gen0.** A short-lived buffer pinned in the nursery punishes the most frequent, most latency-sensitive collections — exactly why POH/off-heap exists.

## Coding Patterns

- **Scope-bound pin.** Prefer `fixed` / `using (memory.Pin())` / `defer pinner.Unpin()` so the pin is released deterministically.
- **Allocate-pinned for reuse.** For a buffer used repeatedly by native IO, allocate it pinned once (POH or off-heap) rather than pinning/unpinning each call.
- **Copy-out for hand-off.** If native code needs the data *after* the call, copy it into native memory and pin nothing.
- **`isCopy` discipline (JNI).** Always check `isCopy`; never assume you got a real pin.

## Pros & Cons

**Pros**

- Enables zero-copy interop for large buffers.
- Each runtime offers a scoped, deterministic form (low risk when used tightly).
- POH / `DirectByteBuffer` / off-heap give a fragmentation-free path for long-lived sharing.

**Cons**

- Fragments compacting heaps; degrades GC throughput and pause times.
- Manual-lifetime APIs (`GCHandle`, JNI) leak pins if release is missed.
- JNI's pin-or-copy ambiguity complicates reasoning.
- Raw pointers from pins are inherently unsafe.

## Best Practices

- **Default to the scoped API**; reach for manual-lifetime pins only when the address genuinely must outlive a block.
- **Segregate long-lived pins** onto the POH or off-heap memory; never park a long-lived pin in the normal heap.
- **Pin few, briefly.** Treat every pin as a temporary obstacle to the collector.
- **In JNI, keep critical regions tiny** and never block or re-enter JNI inside them.
- **In Go, prefer `runtime.Pinner`** over `unsafe` tricks, and never let C retain Go pointers past the call.

## Edge Cases & Pitfalls

- **Leaked `GCHandle`.** No `Free()` → a permanent immovable object → silent fragmentation. Wrap in `try/finally`.
- **Blocking inside a JNI critical region.** Can stall the whole VM (GC may be disabled). Strictly forbidden.
- **Assuming JNI pinned, but it copied.** Writes are lost if you don't `Release` with the committing mode.
- **Confusing Rust `Pin` with GC pinning.** They solve unrelated problems; mixing the concepts leads to nonsense designs.
- **Pinning interior/stack pointers in Go.** Stack copying moves stack data; never hand a stack-interior address to C without understanding the lifetime — heap-allocate and pin instead.

## Summary

- Compaction gives managed runtimes zero fragmentation and bump allocation; pinning inserts an immovable obstacle into that machinery.
- **.NET** offers a lifetime ladder: `fixed` → `GCHandle`/`MemoryHandle` → Pinned Object Heap, the last for long-lived pins without fragmenting normal generations.
- **JNI** exposes pinning through critical regions and `Get...ArrayElements`, but may *copy* instead of pin; `DirectByteBuffer` sidesteps pinning entirely.
- **Go** historically had a non-moving heap, but moving *stacks* are the hazard; `runtime.Pinner` (1.21) is the official pinning API alongside the cgo pointer rules.
- **Rust `Pin`** is a type-system move-prevention for self-referential/async types — a different concept that shares only the name.
- The cost is always **fragmentation and GC degradation**, worst in the young generation — so pin few, briefly, and segregate long-lived pins.
