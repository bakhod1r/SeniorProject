# Off-heap / Native Memory — Junior Level

> **Topic:** [Off-heap / Native Memory](README.md)
> **Focus:** What "off-heap" means, why a managed runtime would ever leave its own GC heap, and the foundational mental model of two memory worlds.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

When you write `new byte[1024]` in Java, `make([]byte, 1024)` in Go, or `new` anything in C#, the bytes live on the **managed heap**: a region of memory owned and controlled by the language runtime's **garbage collector (GC)**. The GC decides where those bytes sit, whether to move them around to fight fragmentation, and when to reclaim them once nothing points to them. You never call `free`. This is the whole selling point of a managed language.

**Off-heap memory** (also called **native memory** or **direct memory**) is the opposite arrangement. It is memory you ask the *operating system* for directly — bypassing the runtime's allocator and its GC. The GC does not know this memory exists. It will not scan it, will not move it, and will not free it. That last part is the catch: **what the GC does not free, you must free yourself.**

This topic is foundational because the moment you work with high-performance caches, network buffers, memory-mapped files, or any code that talks to C libraries, you cross out of the comfortable managed heap and into native memory. Understanding the boundary — and what changes when you cross it — is the entire game.

---

## Prerequisites

You should be comfortable with:

- **What a heap is.** The runtime-managed region where your objects live after `new`/`make`. (As opposed to the *call stack*, which holds local variables and function frames.)
- **What garbage collection does at a high level.** It finds objects that are still reachable from your program and reclaims everything else. You do not manually free managed objects.
- **What a pointer / reference is.** A value that holds the address of some data rather than the data itself.
- **Bytes and addresses.** Memory is a giant array of bytes; an address is an index into that array.

You do **not** need to know how a GC algorithm works internally, nor how to write C. We build from the ground up.

---

## Glossary

- **Managed heap (GC heap):** Memory the runtime owns. Objects here are tracked, possibly moved, and automatically reclaimed by the GC.
- **Off-heap / native memory:** Memory obtained straight from the OS, outside the GC's control. Not scanned, not moved, not auto-freed.
- **RSS (Resident Set Size):** The total physical RAM a process is actually using *right now*, as the OS sees it. Includes heap **and** off-heap memory.
- **Heap size (`-Xmx` in Java):** The cap on the *managed* heap only. Off-heap memory does not count against it.
- **`malloc` / `free`:** The classic C functions to request and release raw memory from the OS allocator.
- **`mmap`:** An OS call that maps a region of memory (often backed by a file) directly into your process's address space.
- **DirectByteBuffer:** The JVM's standard way to hold a chunk of off-heap memory and read/write it like an array.
- **Cleaner / finalizer:** A runtime mechanism that runs cleanup code (like freeing native memory) when a managed wrapper object is finally collected.
- **OOM (Out Of Memory):** Running out of memory. Crucially, off-heap can OOM the *whole process at the OS level* without the GC ever noticing.

---

## Core Concepts

### Two worlds of memory

Picture your process's memory split into two territories:

```
+-------------------------------------------------------+
|                  Your process (one OS process)        |
|                                                       |
|   +------------------+        +--------------------+  |
|   |  MANAGED HEAP    |        |  OFF-HEAP / NATIVE |  |
|   |  (GC owns this)  |        |  (you own this)    |  |
|   |                  |        |                    |  |
|   |  objects, arrays |        |  malloc/mmap blocks|  |
|   |  GC scans + frees|        |  GC ignores it     |  |
|   |  capped by -Xmx  |        |  you must free it  |  |
|   +------------------+        +--------------------+  |
|                                                       |
|   Both count toward RSS (what the OS sees you using)  |
+-------------------------------------------------------+
```

Both regions live inside the *same* process and both consume real RAM. The difference is **who is responsible for them**.

### Why leave the managed heap at all?

A garbage collector is wonderful, but it is not free. Three foundational reasons push data off-heap:

1. **GC pressure.** Every object on the managed heap is something the GC must eventually look at. A 10 GB in-memory cache means 10 GB the GC has to scan and reason about, which lengthens pauses. Move that cache off-heap and the GC sees almost nothing — the cache is invisible to it. This is the single biggest motivator for JVM off-heap caches.

2. **Talking to the outside world.** When you do file I/O, network I/O, or call into a C library, the OS and native code want a stable block of memory at a fixed address. The GC likes to *move* objects around. Off-heap memory never moves, so it is safe to hand to the OS.

3. **Precise control.** Sometimes you want to free memory *the instant* you are done with it, not "eventually, whenever the GC gets around to it." Off-heap gives you that exact control — at the cost of having to remember to do it.

### The fundamental trade

> **The GC will not free what it cannot see. Off-heap memory is invisible to the GC. Therefore off-heap memory must be freed by you.**

This one sentence is the source of nearly every off-heap bug, every "my Java process is using 8 GB but the heap is only 2 GB" incident, and every container that gets killed by the kernel for reasons the application logs never explain.

---

## Real-World Analogies

**The company storage room vs. the rented warehouse.**
Your managed heap is the office storage room. The office cleaning staff (the GC) walks through nightly, throws out anything nobody is using, and reorganizes shelves so things fit. You never think about it. Off-heap memory is a warehouse you personally rent across town. The cleaning staff never goes there — they don't even know it exists. If you stop using a warehouse but forget to cancel the lease, you keep paying rent forever (the leak), and it never shows up in the office's storage report (the heap dump).

**The library vs. your personal bookshelf.**
The library (managed heap) reclaims books automatically when they're overdue and reshelves them where it likes. Your personal bookshelf (off-heap) is yours: nobody reshelves it, nobody removes old books, and if you never throw a book out, the shelf overflows. Total clutter in your apartment (RSS) includes *both* the library books you borrowed *and* your own shelf.

---

## Mental Models

- **"GC-invisible" is the keyword.** Whenever you read "off-heap," translate it in your head to *"the garbage collector cannot see this and will never free it."* Everything else follows.

- **Heap size and RSS are different numbers.** The heap cap (`-Xmx`) limits one territory. RSS is the sum of *all* territories the OS sees. A junior-level "aha" moment is realizing these can diverge dramatically: heap reads 2 GB, RSS reads 8 GB, and the missing 6 GB is off-heap that no heap tool will show you.

- **Crossing the boundary changes the rules.** On the managed side, forgetting to free is impossible (the GC handles it). On the native side, forgetting to free is the *default failure mode*. Same process, opposite rules.

---

## Code Examples

### Managed heap (the familiar world) — Java

```java
// Lives on the GC heap. You never free it.
byte[] data = new byte[1024];
data[0] = 42;
// When `data` becomes unreachable, the GC reclaims it. Done.
```

### Off-heap (the new world) — Java DirectByteBuffer

```java
import java.nio.ByteBuffer;

// allocateDirect asks the OS for native memory, NOT the GC heap.
ByteBuffer buf = ByteBuffer.allocateDirect(1024); // 1 KB off-heap
buf.put(0, (byte) 42);
byte b = buf.get(0); // read it back like an array

// These 1024 bytes do NOT count against -Xmx.
// They DO count against RSS — the OS sees them.
// They are freed only when `buf` (a tiny wrapper object) is GC'd. (More on
// why that is a problem at higher tiers.)
```

The key idea for a junior: `new byte[1024]` and `ByteBuffer.allocateDirect(1024)` both give you 1 KB to use, but they live in different worlds with different rules.

### Off-heap — Go (asking the OS directly via mmap)

```go
package main

import (
	"fmt"
	"syscall"
)

func main() {
	// mmap asks the OS for a 4 KB region OUTSIDE the Go GC heap.
	mem, err := syscall.Mmap(-1, 0, 4096,
		syscall.PROT_READ|syscall.PROT_WRITE,
		syscall.MAP_ANON|syscall.MAP_PRIVATE)
	if err != nil {
		panic(err)
	}

	mem[0] = 42 // use it like a normal byte slice
	fmt.Println(mem[0])

	// The Go GC does NOT manage this. We must hand it back ourselves:
	if err := syscall.Munmap(mem); err != nil {
		panic(err)
	}
}
```

Notice the explicit `Munmap`. In normal Go you never free anything; here you must.

---

## Pros & Cons

**Pros**

- **GC stays fast** even with huge data sets, because the GC never scans off-heap memory.
- **No moving.** Memory at a fixed address is safe to give to the OS and native libraries.
- **Precise lifetime.** Free exactly when you want.
- **Can exceed normal limits.** Off-heap data is not bounded by the managed heap cap.

**Cons**

- **You must free it.** Forgetting leaks memory that no heap tool will reveal.
- **Invisible to heap dumps / heap profilers.** Standard debugging shows nothing.
- **Crashes are nastier.** A bad address read can crash the whole process, not throw a catchable exception.
- **More code, more care.** You give up the safety net the runtime normally provides.

---

## Use Cases

- **Large in-memory caches** (gigabytes) where you do not want GC pause times to grow with the cache.
- **Network and file I/O buffers**, because the OS wants stable, non-moving memory.
- **Memory-mapped files**, letting you treat a file on disk as if it were a giant byte array.
- **Interop with C / native libraries**, which expect plain memory blocks.

For most everyday application code, you do **not** need off-heap. Reach for it only when you have a measured reason.

---

## Best Practices

- **Default to the managed heap.** Off-heap is a specialized tool. Most code should never touch it. Use it when you have evidence (GC pauses, interop needs, sizes too big to manage on-heap).
- **Always pair an allocation with a free.** The instant you write an off-heap allocation, write its release. Treat them like opening and closing a bracket.
- **Prefer high-level wrappers.** Use `DirectByteBuffer`, a library's pooled buffers, or modern safe APIs rather than raw pointer arithmetic. They make the "must free" obligation harder to forget.
- **Know your two numbers.** Get used to checking both the heap size *and* the process RSS. When they diverge, off-heap is usually involved.

---

## Edge Cases & Pitfalls

- **"The heap looks fine but the process keeps growing."** Classic off-heap leak. The heap dump is clean because the leak is in territory the dump never inspects.
- **Freeing twice ("double free").** Releasing the same off-heap block twice is a corruption bug, not a no-op. Free exactly once.
- **Use-after-free.** Reading off-heap memory after you freed it gives garbage or crashes the process. There is no GC keeping it alive for you.
- **Assuming `-Xmx` protects you.** It only caps the managed heap. The OS can still run the process out of physical memory through off-heap growth, and on a container the *kernel* kills the process (OOM-kill) with no graceful error.

---

## Summary

- **Off-heap / native memory** is memory obtained directly from the OS, outside the garbage collector's control.
- The GC **cannot see it**, so it never scans, moves, or frees it — which is exactly why people use it (no GC pressure, stable addresses, precise lifetime) and exactly why it is dangerous (**you must free it yourself**).
- **Heap size** caps only the managed heap; **RSS** is the total RAM the OS sees, including off-heap. When these two numbers diverge, suspect off-heap.
- Standard heap dumps and heap profilers are **blind** to off-heap memory, which makes off-heap leaks uniquely hard to spot.
- Use off-heap deliberately — for big caches, I/O buffers, memory-mapped files, and native interop — and always pair every allocation with its matching free.
