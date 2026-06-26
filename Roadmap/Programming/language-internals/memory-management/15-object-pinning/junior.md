# Object Pinning & Movable Heaps — Junior Level

> **Topic:** [Object Pinning & Movable Heaps](README.md)
> **Focus:** Why a managed object's address can change, and what "pinning" means in the simplest terms.

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

In many languages with a garbage collector (GC) — C#, Java, Go — you never think about *where* in memory an object lives. You hold a reference, you use it, and the runtime takes care of the rest. But a subtle and important fact hides under that convenience: **the object can physically move to a different memory address while your program runs.**

That sounds alarming. If the address changes, why don't your variables break? They don't break because the GC is honest: whenever it moves an object, it finds every managed reference pointing at the old address and rewrites it to point at the new one. Your `var customer = ...` keeps working because the runtime fixed it for you behind the scenes.

The trouble starts when a reference is held somewhere the GC **cannot see and cannot fix** — most commonly a raw memory address handed to native C code, the operating system, or a hardware device. If the GC moves the object, those outside parties are now looking at the wrong (or freed) memory. **Pinning** is the mechanism that says to the GC: *"Do not move this object for now."* That keeps the address stable long enough to safely share it with the outside world.

This page builds the foundation: why objects move, why that's normally a *good* thing, and the basic idea of pinning.

## Prerequisites

- You know what a **variable**, **reference**, and **pointer** are.
- You have heard of **garbage collection** — automatic memory reclamation.
- You understand that a program's memory is split into the **stack** (local call frames) and the **heap** (longer-lived objects).
- Optional: passing exposure to "calling C from a managed language."

## Glossary

- **Managed heap** — the region of memory the garbage collector owns and manages.
- **Reference (managed pointer)** — a handle to an object that the GC knows about and can update.
- **Raw pointer** — a plain memory address (a number), with no GC bookkeeping attached.
- **Moving (or compacting) GC** — a garbage collector that relocates live objects to new addresses.
- **Pinning** — telling the GC to keep a specific object at a fixed address temporarily.
- **Native / unmanaged code** — code (usually C/C++) running outside the managed runtime, which the GC cannot inspect.
- **Dangling pointer** — a pointer to memory that has moved away or been freed; reading it is a bug.
- **DMA (Direct Memory Access)** — hardware reading/writing memory directly, bypassing the CPU.

## Core Concepts

### 1. Objects can move

A **moving GC** does not just free dead objects; it slides the surviving ones together to one end of the heap. Picture a bookshelf with gaps where books were removed. A moving GC pushes all the remaining books to the left so the empty space forms one big block on the right. After this **compaction**, the shelf has no gaps, and allocating a new "book" is trivial — you just place it at the boundary.

This is why many managed runtimes allocate so fast: with a compact heap, allocation is little more than "advance a pointer by N bytes." That speed is a *direct payoff* of being allowed to move objects.

### 2. The GC fixes managed references for you

When the GC moves an object from address `A` to address `B`, it walks all live references and rewrites every one that pointed to `A` so it now points to `B`. Because it does this atomically (while your code is paused or carefully coordinated), your program never sees a half-updated state. From your code's view, the object simply *is* where it is.

### 3. The GC cannot fix what it cannot see

Here is the crux. If you take an object's address and hand it to:

- a **C library** that stores it in its own variable,
- the **operating system** during a file or network read that writes into your buffer,
- a **hardware device** doing DMA into your buffer,

then the GC has no idea those copies exist. If it moves the object, those external addresses become **dangling** — they point at memory that has moved or been reused. Corruption or a crash follows.

### 4. Pinning = "do not move this"

**Pinning** marks an object as immovable for a window of time. While pinned, the GC skips it during compaction. Now its address is stable, and you can safely give that address to native code. When the native work is done, you **unpin**, and the object is free to move again on the next GC.

The golden rule, even at this level: **pin for the shortest time possible, and pin as few objects as possible.** A pinned object is a rock the GC must compact around — too many rocks, held too long, make the GC's job harder.

## Real-World Analogies

- **The moving warehouse.** A warehouse constantly reorganizes shelves overnight to keep things tidy (compaction). The internal catalog is always updated, so workers find items by name (managed references). But if you wrote a physical address on a sticky note and mailed it to a customer (a raw pointer to native code), and the item then moved, your customer drives to an empty shelf. Pinning is putting a **"DO NOT MOVE"** tag on that one item until the customer has come and gone.

- **A passport photo booth.** While the camera takes the picture, you must hold still (pinned). Move during the exposure and the photo is ruined (corruption). The instant the flash fires, you're free to move again (unpin).

- **A crane lifting a container.** While the crane's hooks are attached (native code holds the address), the container must not be relocated by the yard's reshuffling crew (the GC). Detach the hooks first, then the yard can rearrange.

## Mental Models

**Model 1 — Two kinds of "who's pointing at me."**
Every object has two audiences: references the GC *knows about and can fix*, and addresses held *outside* the GC's knowledge that it *cannot* fix. Pinning exists solely to protect the second audience during a move.

**Model 2 — Pinning is a temporary promise.**
A pin is a short-lived contract: "for the next few microseconds, this address is valid; do your native work, then release me." It is not ownership and not a permanent fixture.

**Model 3 — Pinning trades flexibility for safety.**
By forbidding a move, you make one object safe for native code but slightly harder for the GC to manage. That's an acceptable trade *briefly*, a problem *chronically*.

## Code Examples

The cleanest beginner-level illustration is C#'s `fixed` statement, which pins an array for the duration of a block and gives you a raw pointer.

```csharp
// C# — the `fixed` keyword pins `data` only inside the block.
byte[] data = new byte[1024];

unsafe
{
    fixed (byte* p = data)        // <-- object pinned here
    {
        // `p` is a STABLE raw address while we are inside this block.
        // Safe to pass `p` to a native function that fills the buffer.
        NativeFill(p, data.Length);
    }                             // <-- object UNPINNED here (block exits)
}

// After the block, the GC may move `data` again on the next collection.
```

What to notice:

- The pin is **scoped**: it begins at `fixed` and ends when the block closes. Short and automatic — exactly the recommended pattern.
- Inside the block, `p` is safe to hand to native code. Outside, it must not be used.

A conceptual sketch of what goes wrong *without* pinning:

```text
1. You take the address of object X  -> 0x1000
2. You hand 0x1000 to a C function and return to managed code
3. A GC runs and compacts the heap; X moves to 0x4000
4. The C function later writes to 0x1000  -> CORRUPTION
   (0x1000 may now be unused, or hold a DIFFERENT object)
```

## Pros & Cons

**Pros of pinning**

- Lets managed objects be safely shared with native code, the OS, and hardware.
- Simple to reason about when scoped tightly (one object, one short block).
- Avoids copying data when the buffer is large and the operation is quick.

**Cons of pinning**

- A pinned object blocks the GC from compacting around it, hurting efficiency.
- Easy to misuse: pin too long or too many and you fragment the heap.
- Raw pointers from pinning are `unsafe` — mistakes can corrupt memory.

## Use Cases

- **Reading a file or socket into a managed buffer** where the OS writes directly into your memory.
- **Hardware DMA**: a device fills a buffer at a fixed address.
- **Passing an array to a native image/crypto/compression library** that expects a stable pointer.
- **Interop glue** where a C struct holds onto your buffer for the length of a call.

## Best Practices

- **Pin the shortest possible time.** Open the window, do the native work, close it.
- **Prefer scoped pins** (`fixed`-style) over manual pin/unpin you must remember to release.
- **Pin as little as possible** — one buffer, not a whole graph of objects.
- **If sharing is long-lived, copy the data** into native/off-heap memory instead of holding a pin indefinitely (you'll learn this in higher tiers).
- **Never use a pinned address after unpinning.** Treat it as instantly invalid once the pin ends.

## Edge Cases & Pitfalls

- **Forgetting to unpin.** With manual APIs (not the scoped `fixed`), a forgotten unpin leaves the object stuck forever — a quiet performance leak.
- **Using the pointer outside the pinned region.** The classic bug: capturing the address, then using it after the block closes.
- **Assuming "Go and Java don't move objects, so I'm safe."** They move things too — Go moves goroutine *stacks*, and many JVMs compact the heap. The hazard is real across runtimes.
- **Pinning when a copy would be cheaper and safer.** For small data, copying is often the right call; pinning is for avoiding copies of large buffers.

## Summary

- Moving (compacting) GCs **relocate live objects** to defragment memory and make allocation fast.
- The GC **rewrites every managed reference** when it moves an object, so your code never notices — *unless* an address was handed to code the GC can't see.
- **Native code, the OS, and hardware** can hold raw addresses the GC won't fix; moving an object out from under them causes dangling pointers and corruption.
- **Pinning** temporarily forbids a move so an address stays valid for native sharing.
- The discipline is always the same: **pin few objects, for the shortest possible time**, and prefer copying for long-lived sharing. The middle and senior tiers explain the exact mechanisms in .NET, the JVM, and Go.
