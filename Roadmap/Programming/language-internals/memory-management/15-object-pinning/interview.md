# Object Pinning & Movable Heaps — Interview Questions

> **Topic:** [Object Pinning & Movable Heaps](README.md)

A movable heap is one of the cleaner ways an interviewer can probe whether you understand garbage collection as a *system* rather than a black box. These questions move from "why do objects move at all" through runtime-specific mechanisms (.NET, JVM, Go) to the traps that separate people who have actually shipped FFI code from those who have only read about it. Answer with concrete mechanisms and honest trade-offs.

---

## Table of Contents

- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**Why does a managed heap move live objects at all, and what does the collector do to keep references valid?**

Compacting and copying collectors relocate live objects to defragment the heap, keep allocation a cheap bump of a pointer, and promote survivors between generations. Moving lets the collector reclaim one large contiguous free region instead of a free-list riddled with holes, and bump allocation (`top += size`) is only possible if the live set stays packed. After a move, the collector rewrites every *managed* reference it can find — stack and register roots, static fields, and pointers inside other heap objects — so your code never observes the move through a managed reference. The illusion holds because the collector owns the complete set of managed pointers.

## Question 2

**Distinguish reference validity, address stability, and identity on a movable heap.**

Three different guarantees. **Reference validity** means a managed reference stays usable across moves — always true, the runtime fixes it up. **Address stability** means the raw numeric address stays constant — explicitly *not* guaranteed by a movable heap. **Identity** (reference equality, identity hash) is preserved across moves and is independent of address. Bugs come from assuming address stability because you have reference validity. Pinning is exactly the operation that temporarily promotes reference validity to address stability.

## Question 3

**What is pinning, and what problem does it solve?**

Pinning marks an object as immovable so the collector leaves it at its current address. It solves the problem that arises when you hand a raw address to code the collector can't see — a C library, a device doing DMA, the kernel during a syscall. If the GC relocated the object while the unmanaged side held its address, that side would read or write freed/moved memory. Pinning guarantees the address stays valid for the duration of the external reference.

## Question 4

**Give the canonical real-world scenario that requires pinning.**

A DMA or asynchronous-I/O buffer. A NIC or NVMe controller is programmed with a buffer address and reads/writes that memory itself, asynchronously, without the CPU — it has no concept of a managed heap. Likewise an async `ReadFile`/`recv` hands the kernel a buffer address and completes later. The buffer must stay at its address for the whole transaction, which is dictated by hardware/kernel timing, not your control flow. That mismatch is why pins so easily become longer than intended.

## Question 5

**Why does pinning fragment a compacting heap?**

Compaction works by sliding survivors toward one end so free space coalesces into one block. A pinned object can't move, so survivors pile up against it and the reclaimed space is broken into fragments straddling each pin. The result is external fragmentation — large allocations can fail while plenty of total free space exists scattered around pins — plus more expensive, constrained compaction. Many or long-lived pins defeat the very compaction the heap was designed around.

## Question 6

**How does pinning affect GC pause time and frequency?**

Two ways. First, planning a compaction around immovable objects is more expensive than unconstrained sliding, so each pause does more work. Second, fragmentation means each GC reclaims less usable contiguous space, so the allocator hits the next threshold sooner and GCs run more frequently. More frequent GCs means more total pause time even if individual pauses are similar.

---

## Tool-Specific

## Question 7

**Compare .NET's `fixed` statement and `GCHandle.Alloc(obj, GCHandleType.Pinned)`.**

`fixed` is a lexically scoped, stack-cheap pin: the object is immovable inside the block and unpinned deterministically at the closing brace, with no way to leak past the scope. Use it for a synchronous native call. `GCHandle.Pinned` is an *unscoped* pin: it keeps the object pinned and alive until you explicitly call `Free()`. Use it when the native side outlives a single call (e.g. async I/O the kernel completes later). The trade-off is ownership: `GCHandle` is more flexible but leak-prone — forget `Free()` and you have a permanently immovable, never-collected object.

## Question 8

**What is the Pinned Object Heap and what problem does it solve?**

The POH (.NET 5+) is a separate, non-compacting heap segment dedicated to pinned objects; `GC.AllocateArray<T>(n, pinned: true)` allocates straight into it. It solves the fragmentation problem at its root: if an object will be pinned for its whole life (a long-lived I/O buffer), put it where it can't obstruct the general heap. The general heap then compacts freely, and the collector never special-cases pins during compaction. It's a "segregate the irregular case" design — pins do their damage in a region that wasn't going to compact anyway.

## Question 9

**Explain the JVM's `GetPrimitiveArrayCritical` and its critical-region restrictions.**

`GetPrimitiveArrayCritical`/`ReleasePrimitiveArrayCritical` requests a direct pointer into a primitive array; the VM may pin or may copy. Between get and release you're in a *critical region* with strict rules: no other JNI calls, no blocking, nothing that could trigger a GC or run arbitrary Java. In practice the VM often disables GC globally while a thread is in a critical region, so a slow region stalls every thread that needs to allocate. The restrictions exist because pinning is so disruptive that the VM only allows it under a no-blocking, no-allocation straitjacket. Keep the region to a tight loop and release immediately.

## Question 10

**How do `Get<Type>ArrayElements` and `DirectByteBuffer` differ from critical regions as JNI strategies?**

`Get<Type>ArrayElements` returns a pointer plus an `isCopy` flag; on a copying collector it almost always copies. Because it may copy, it has no critical-region restrictions — safe to block or do I/O — but you pay a copy each way (and must choose the right `Release` mode: write back, commit, or abort). `DirectByteBuffer` is the copy-free *and* pin-free option: it's backed by off-heap native memory, so the GC never moves it and native code can hold its address indefinitely via `GetDirectBufferAddress`. The JVM philosophy: copy for brief reads, go off-heap for sustained sharing, pin the heap as little as possible.

## Question 11

**Explain Go's cgo pointer-passing rules and `runtime.Pinner`.**

Two rules: (1) Go memory passed to C must not itself contain Go pointers unless those are pinned; (2) C must not retain a copy of a Go pointer after the call returns. They exist because the runtime may move or collect Go memory once the call returns, and goroutine stacks/heap objects relocate. `runtime.Pinner` (Go 1.21) makes the legal window explicit: `Pin(&x)` guarantees `x` won't move until `Unpin`, and `Unpin` releases all of that pinner's pins at once (idiomatically `defer pinner.Unpin()`). Its key power is pinning Go pointers stored *inside* other Go memory passed to C, making a struct-with-pointers legal to hand across the boundary.

---

## Tricky / Trap

## Question 12

**A candidate says "Rust's `Pin<P>` is how Rust pins objects so the GC won't move them." What's wrong?**

Everything. Rust has no GC and no moving collector, so there is nothing to pin against relocation. `Pin<P>` is a *type-system* guarantee that a value won't be moved in memory again, used for self-referential types — the canonical case being `async` futures that hold pointers into their own body across an `.await`. It's enforced at compile time by the borrow checker, lasts the value's lifetime, and has no runtime collector involved. GC pinning and `Pin<P>` share only the English word "pin"; they solve opposite problems (a collector might move my object vs. a self-referential value must not move).

## Question 13

**You pin a buffer, take its address, store the address as an integer, unpin, then later use the integer. What happens?**

You read moved or freed memory. The address is only valid *while pinned*; once unpinned the object can relocate and the integer points at stale memory. In Go specifically, converting through `uintptr` is worse — the GC doesn't track a `uintptr` as a pointer, so it keeps nothing alive and provides no stability even before unpin. The rule: an address snapshot is valid only for the pin's duration, and `uintptr` is never a safe long-term handle.

## Question 14

**Go code passes a struct to C. It worked for months, then someone added a `*Logger` field and production started panicking with "cgo argument has Go pointer to Go pointer." Why?**

cgo legality is a property of the *entire reachable pointer graph*, not just the call site. Adding a pointer field made the struct contain a Go pointer, violating rule (1) — and nothing at the call site changed, so it slipped through review. It "passed tests" because the runtime check (`cgocheck`) only fires when the violating pointer is reachable at the call and the GC actually exercises the path. Fix: pin the inner pointer with `runtime.Pinner` before the call, and treat any new pointer field on a cgo-crossing struct as a potentially breaking change.

## Question 15

**Your .NET service pins receive buffers with `GCHandle.Pinned` across `await ReceiveAsync(...)`. Under a wave of slow clients, gen2 fragmentation explodes. Diagnose and fix.**

The pin lifetime is tied to your `await`, not the OS operation — and a slow client makes that `await` last seconds. With thousands of concurrent connections you get thousands of long-lived pins scattered across the heap, perforating gen2 and breaking its free space into fragments, which fails large allocations and forces frequent gen2 GCs. This is *pin amplification*. Fix: allocate buffers in the POH (`GC.AllocateArray<byte>(n, pinned: true)`) once and pool/reuse them so they never obstruct the general heap, and/or use `Memory<T>`-based async APIs (`ReceiveAsync(Memory<byte>)`) that pin only for the duration the OS operation actually needs.

---

## Design

## Question 16

**Design the buffer-management strategy for a high-throughput network proxy on a runtime with a compacting GC. Address allocation, pinning, and lifetime.**

Goal: zero-copy I/O without poisoning the GC. Core decisions:

- **Get interop buffers off the movable heap.** Allocate them where they never move: .NET POH (`pinned: true`), a JVM `DirectByteBuffer`, or native memory (`C.malloc` / `Marshal.AllocHGlobal`). This eliminates per-operation pinning and the fragmentation it causes on the general heap.
- **Pool the buffers.** Off-heap/POH allocation is more expensive than on-heap, so reuse via a pool (`MemoryPool<T>`/`ArrayPool<T>` over POH buffers, or a slab of `DirectByteBuffer`s). Reuse also bounds the number of immovable regions.
- **Tie pin/lifetime to the OS operation, not control flow.** Prefer runtime-managed pinning (`Memory<T>` async APIs) so the pin lasts exactly as long as the kernel holds the address, and guarantee release on every path (`using`/`defer`/`finally`).
- **Avoid critical regions for anything that blocks.** On the JVM, never do I/O or callbacks inside a `GetPrimitiveArrayCritical` region; off-heap direct buffers sidestep the issue entirely.
- **Use handles, not raw addresses, for long-lived identity.** If the native side needs a stable *identity* (callback context) rather than a buffer address, pass a non-pinned handle or a table index so you keep stability without forbidding relocation.
- **Instrument.** Track pin/handle counts and GC fragmentation so pin amplification or a handle leak is visible before it OOMs.

The throughline: pin briefly and locally if you must, but for sustained sharing get off the movable heap and pool — that's the only way to keep zero-copy interop from degrading the collector.
