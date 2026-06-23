---
layout: default
title: Hardware Barriers — Junior
parent: Hardware Barriers
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/01-hardware-barriers/junior/
---

# Hardware Memory Barriers — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Why Reordering Happens At All](#why-reordering-happens-at-all)
6. [The Store Buffer in One Picture](#the-store-buffer-in-one-picture)
7. [The Invalidate Queue in One Picture](#the-invalidate-queue-in-one-picture)
8. [The Four Fence Types](#the-four-fence-types)
9. [Real-World Analogies](#real-world-analogies)
10. [Mental Models](#mental-models)
11. [Pros and Cons of Strong vs Weak Models](#pros-and-cons-of-strong-vs-weak-models)
12. [x86 Quick Reference](#x86-quick-reference)
13. [ARM Quick Reference](#arm-quick-reference)
14. [Code Examples](#code-examples)
15. [Go and the Hardware](#go-and-the-hardware)
16. [Coding Patterns](#coding-patterns)
17. [Clean Code](#clean-code)
18. [Error Handling](#error-handling)
19. [Security Considerations](#security-considerations)
20. [Performance Tips](#performance-tips)
21. [Best Practices](#best-practices)
22. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
23. [Common Mistakes](#common-mistakes)
24. [Common Misconceptions](#common-misconceptions)
25. [Tricky Points](#tricky-points)
26. [Test](#test)
27. [Tricky Questions](#tricky-questions)
28. [Cheat Sheet](#cheat-sheet)
29. [Self-Assessment Checklist](#self-assessment-checklist)
30. [Summary](#summary)
31. [What You Can Build](#what-you-can-build)
32. [Further Reading](#further-reading)
33. [Related Topics](#related-topics)
34. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction
> Focus: "What is a memory barrier? Why does my CPU 'reorder' my code? When do I need to think about this in Go?"

A **memory barrier** — also called a **fence** — is a special CPU instruction that says to the processor: *"do not let any memory operation cross this point."* It is invisible in your Go source code. You will probably never write one by hand. But every single time you call `sync/atomic.StoreInt32`, every time you `mu.Unlock()` a mutex, every time you send on a channel, the Go runtime emits some sequence of machine instructions that *includes* a fence — and that fence is what makes the value you just wrote visible to another goroutine running on a different CPU core.

Here is the question that drives this whole topic:

> If goroutine A writes `x = 1` and then writes `done = true`, and goroutine B reads `done` and sees `true`, is it guaranteed to also see `x == 1`?

The answer is: **only if a barrier separated the two writes on A's CPU and a barrier separated the two reads on B's CPU**. Without barriers, modern CPUs are free to reorder, delay, batch, and combine memory operations in ways that violate the order you wrote in source. Goroutine B might see `done == true` but still see `x == 0`, and your program will appear to "skip" a write that very clearly happened.

This file teaches you, at the junior level, the *vocabulary and intuition* behind hardware barriers. We are not going to write inline assembly. We are not going to dive into Herd7 cat models. We are going to answer:

1. What is a CPU **store buffer**, and why does it exist?
2. What is a CPU **invalidate queue**, and why does it exist?
3. What are the **four fence types** (LoadLoad, LoadStore, StoreLoad, StoreStore)?
4. How does **x86** differ from **ARM** at this layer?
5. What does Go's `sync/atomic` actually do on each platform?
6. When do *you* — as a junior Go programmer — need to care?

After reading this file you will understand why `var x int` shared between goroutines without `sync/atomic` is broken even if you "feel" the writes are atomic, and you will know which barrier the compiler is inserting when you replace it with `atomic.StoreInt32(&x, 1)`.

You will not yet be able to design a lock-free queue. That is the middle and senior file. You will not yet understand RISC-V `fence rw,rw` syntax. That is the senior file. You will know the *why* and the *vocabulary*, which is the foundation everything else stands on.

---

## Prerequisites

- **Required:** Comfort with Go syntax, goroutines, and `go func()`.
- **Required:** You have used `sync.Mutex` or `sync/atomic` at least once and read the package documentation.
- **Required:** Awareness that programs share memory between goroutines (the runtime does not magically give each goroutine its own copy of globals).
- **Helpful:** Some exposure to assembly — you do not need to read it fluently, but you should know that `MOV`, `ADD`, `JMP` are instructions, and that compilers emit them.
- **Helpful:** A rough idea of what a CPU **cache** is. (Hint: a small, fast piece of memory close to the core that holds copies of recently-used data from main memory.)

You do *not* need to know:
- Cache coherence protocols (MESI/MOESI) in detail — we will sketch them informally.
- The full Go memory model document. That is for the senior file.
- Any specific CPU vendor's manual. We will give just enough to make sense of `objdump` output.

If you can compile `go run main.go`, write a goroutine that increments a shared `int`, and detect that `go run -race main.go` reports a data race, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Memory barrier (fence)** | A CPU instruction that prevents memory operations on either side of it from being reordered across it. Examples: `MFENCE`, `LFENCE`, `SFENCE` on x86; `DMB ISH` on ARMv8. |
| **Reordering** | When the CPU executes memory operations in an order different from program order, for performance. Reordering can be done by the compiler (compile-time) or by the CPU (run-time, by hardware). |
| **Store buffer** | A small FIFO queue inside each CPU core that holds stores that have not yet been written to the cache. Lets stores complete from the core's perspective immediately, without waiting for cache coherence. |
| **Invalidate queue** | A small FIFO queue inside each CPU core that holds *incoming* invalidation messages from other cores. Lets the core acknowledge the invalidation immediately, processing it lazily. |
| **MESI** | A common cache coherence protocol. Each cache line is in one of four states: **M**odified, **E**xclusive, **S**hared, **I**nvalid. |
| **Cache line** | The unit of data the cache moves between memory and the core. Almost always 64 bytes on modern x86, 64 or 128 bytes on ARM. |
| **Coherence** | The guarantee that all cores eventually see the same value for a given memory location. Coherence does *not* imply ordering between different locations. |
| **Consistency** | The set of rules about *ordering* of operations across different memory locations. Stronger consistency = fewer reorderings allowed = more barriers needed = potentially slower hardware. |
| **TSO (Total Store Order)** | The memory consistency model of x86. Stores can be reordered after later loads (the store buffer), but loads-after-loads, stores-after-stores, and loads-after-stores are not reordered. |
| **WMO / RMO / RC** | Weak Memory Order, Relaxed Memory Order, Release Consistency — names for weaker models used by RISC-V and ARM. |
| **Acquire** | A read with a barrier that prevents any later memory operation from being reordered before it. The natural pair for "I just took a lock." |
| **Release** | A write with a barrier that prevents any earlier memory operation from being reordered after it. The natural pair for "I am about to release a lock." |
| **`sync/atomic`** | Go's standard package for atomic loads, stores, and read-modify-write operations on integers and pointers. Maps to hardware barriers under the hood. |
| **`runtime/internal/atomic`** | The runtime's *internal* atomic package, with platform-specific assembly for each supported CPU. Not part of the public API; used by the scheduler, garbage collector, and channel implementation. |
| **`MFENCE`** | The x86 "memory fence" instruction. Drains the store buffer; orders all loads and stores on both sides of it. |
| **`LFENCE`** | The x86 "load fence" instruction. Orders loads on both sides; on Intel post-Spectre also serialises speculative execution. |
| **`SFENCE`** | The x86 "store fence" instruction. Orders stores on both sides; mainly relevant for non-temporal stores. |
| **`LOCK` prefix** | A prefix on certain x86 instructions (`ADD`, `XADD`, `CMPXCHG`, `XCHG`, ...) that makes them atomic and acts as a full memory barrier. |
| **`DMB`** | ARM "Data Memory Barrier". Most-used ARM fence. Variants: `DMB ISH` (inner shareable), `DMB ISHST` (store-only), `DMB ISHLD` (load-only). |
| **`DSB`** | ARM "Data Synchronization Barrier". Stronger than `DMB`; also waits for previous instructions to complete (used mostly in kernel code, not user). |
| **`ISB`** | ARM "Instruction Synchronization Barrier". Flushes the pipeline; used after changing instructions, not for data ordering between cores. |
| **`LDAR` / `STLR`** | ARMv8 "Load-Acquire" and "Store-Release" instructions. Single-instruction acquire/release semantics — no need for separate `DMB`. |
| **Reordering window** | The number of in-flight instructions a CPU can execute speculatively / out of order. Modern Intel cores have windows of 200+ micro-ops. |
| **Coherence point** | The moment a store becomes visible to all other cores in a coherent way. For x86, this is when the store leaves the store buffer and reaches the L1 cache. |

---

## Core Concepts

### A barrier is a sequence point for memory

In a single-threaded program, source order *is* execution order, at least as far as you can observe. If you write `x = 1; y = 2;`, you will see `x == 1` before `y` is touched. The compiler may *internally* reorder these (and indeed it often does), but it can never let you see an ordering that violates single-threaded semantics. This is the **"as-if" rule**.

Concurrent programs break the "as-if" rule's protection. When a *second* goroutine on a *second* CPU core reads `x` and `y`, it is no longer the case that the only observer is the writing goroutine. Now there is a remote observer, and the compiler/CPU's reorderings become visible to it.

A memory barrier is the mechanism by which the writing thread *publishes* an ordering guarantee to the rest of the system. It says: "every memory write I issued before this barrier shall be visible to any thread that observes the result of any write I issue after this barrier."

In Go, this barrier is invisible. You see:

```go
mu.Lock()
counter++
mu.Unlock()
```

You do not see the `LOCK XADD` or `MFENCE` or the ARM `STLR` that the runtime emitted to make the increment safe across cores. But it is there, and it is what makes the program correct.

### Compile-time reordering vs run-time reordering

There are **two** sources of reordering in a typical Go program on a typical CPU:

1. **Compiler reordering.** The Go compiler may reorder, eliminate, or duplicate memory operations during optimization, subject to the Go memory model and the "as-if" rule for single-goroutine code.
2. **CPU reordering.** The CPU may reorder memory operations at run time, subject to the architecture's memory consistency model.

Both can break concurrent code. Both are addressed by the same `sync/atomic` calls — `atomic.Store` is both a compiler barrier (the compiler won't reorder memory operations across it) and a hardware barrier (the CPU is forced to flush its store buffer at the right point).

For the rest of this file we focus on **hardware** reordering, since that is the part that requires the CPU's barrier instructions. Compiler reordering is discussed in the *middle.md* file alongside `//go:nosplit` and `//go:nowritebarrier`.

### The four canonical fence types

Pioneering work by Adve and Gharachorloo (1995) classified memory ordering constraints as combinations of four atomic primitives:

| Constraint | Meaning |
|------------|---------|
| **LoadLoad** | A later load must not be reordered before an earlier load. |
| **LoadStore** | A later store must not be reordered before an earlier load. |
| **StoreStore** | A later store must not be reordered before an earlier store. |
| **StoreLoad** | A later load must not be reordered before an earlier store. |

These four are *independent*: a memory model can permit some and forbid others. The strongest consistency model — **sequential consistency** — forbids all four reorderings. The weakest typical model — **release consistency** — permits all four by default and requires explicit fences for each.

Most real CPUs sit somewhere in between. **x86-TSO** forbids three of the four (LoadLoad, LoadStore, StoreStore) and only permits **StoreLoad** reordering — that is, a store followed by a load may appear reordered. **ARMv8**, by default, permits all four, but it has cheap single-instruction acquire/release loads and stores that constrain three of them.

| CPU | LL | LS | SS | SL |
|-----|----|----|----|----|
| Sequential consistency | forbidden | forbidden | forbidden | forbidden |
| x86-TSO | forbidden | forbidden | forbidden | **allowed** |
| ARMv8 weak | allowed | allowed | allowed | allowed |
| RISC-V WMO | allowed | allowed | allowed | allowed |
| POWER | allowed | allowed | allowed | allowed |

This is *the* table to commit to memory. It explains, in one line, why a piece of code that "works on my x86 laptop" can break "in production on the ARM server."

---

## Why Reordering Happens At All

To a junior programmer, the existence of reordering can feel insulting. The CPU is supposed to do what I told it. Why would it scramble my writes?

The answer is **performance**. Specifically: keeping the CPU's execution units busy. Modern cores run at 3–5 GHz, while DRAM access takes ~70-100 ns — roughly 300 cycles. If the CPU ran one instruction at a time, waiting for each memory access to complete, you would lose ~99 % of its throughput on memory-bound workloads.

To hide this latency, CPUs use several tricks at once:

1. **Out-of-order execution.** Internally, the CPU dispatches instructions to execution units as soon as their inputs are ready, not in program order. A load that misses the cache does not block independent later operations.
2. **Speculative execution.** The CPU predicts the outcomes of branches and executes ahead of the prediction.
3. **Store buffers.** Stores can complete *from the core's perspective* before they have been propagated to the L1 cache or to other cores.
4. **Invalidate queues.** Incoming cache invalidation requests can be acknowledged *from the core's perspective* before the local cache state is updated.
5. **Write combining buffers.** Adjacent stores to consecutive addresses may be merged into a single bus transaction.
6. **Prefetchers.** Predicted future loads are issued early.

Each of these makes single-threaded code faster. Each of them, if exposed to another thread without a fence, will let that thread see memory in an order different from program order. The barrier is the *price* of letting these tricks coexist with correct multi-core synchronization.

### Concrete example: store buffer reordering on x86

Consider this notorious *store buffer* litmus test (also called "Dekker's reordering"):

```
Core 0:                  Core 1:
  STORE x = 1              STORE y = 1
  LOAD  r0 = y             LOAD  r1 = x
```

Under sequential consistency, at least one of `r0` or `r1` must end up equal to 1. (If `r0 == 0`, the load of `y` happened before Core 1's store, so Core 1's load of `x` must see Core 0's store, hence `r1 == 1`.) Under x86-TSO, however, **`r0 == r1 == 0` is allowed and does happen in practice.** Why? Each store sits in its core's local store buffer for some cycles before reaching the cache. During that window, the load on the *same* core may execute and complete using memory state that does not yet reflect the buffered store on the *other* core.

This is exactly the **StoreLoad** reordering that x86-TSO permits and that explains why even on x86 you must put a fence (an `MFENCE` or a `LOCK`-prefixed instruction) between a store and a later load when implementing a lock-free algorithm like Dekker's or Peterson's.

We will revisit this litmus test multiple times. It is one of the few cases on x86 where you genuinely need a fence — and it is exactly the case `sync/atomic.Store` handles for you.

---

## The Store Buffer in One Picture

```
   Core 0                                  L1 cache (shared coherent view)
   ┌────────────────────────┐
   │ Pipeline / OoO engine  │
   │                        │
   │  STORE x = 1  ─────────┼──► [ store buffer ]  ─────► [ L1 cache line for x ]
   │  STORE y = 2  ─────────┼──► [ store buffer ]
   │  LOAD  z      ─────────┼─────────────────────────────────┐
   │                        │                                 │
   └────────────────────────┘                                 ▼
                                                       [ L1 cache line for z ]
```

The store buffer holds writes that have committed *architecturally* — the core has retired the instruction — but have not yet reached the L1 cache. Until that happens, other cores cannot see them. Meanwhile, the issuing core *can* see them via **store forwarding**: a load that hits an address present in the store buffer reads the buffered value.

This produces the **TSO illusion**: from the *single* core's perspective, the program runs in order. From *another* core's perspective, the store has not happened yet. A fence such as `MFENCE` (or any `LOCK`-prefixed RMW) **drains the store buffer** — it stalls the pipeline until every buffered store has propagated to the cache. After that, the next load sees a globally consistent view.

This is the entire reason `MFENCE` exists.

---

## The Invalidate Queue in One Picture

```
   Other cores broadcast invalidation messages
                │
                ▼
   ┌──────────────────────────┐
   │   invalidate queue       │  Core 0 queues incoming "I owned this line, you no longer have a copy."
   │   [ inv addr A ]         │
   │   [ inv addr B ]         │
   └──────────┬───────────────┘
              │
              ▼
   ┌──────────────────────────┐
   │   L1 cache               │  Eventually the queue is drained; the affected cache lines are marked I.
   └──────────────────────────┘
```

Invalidate queues are the mirror image of store buffers. When Core 1 writes a cache line that Core 0 holds in **Shared** state, MESI requires Core 1 to send an invalidate message and wait for acknowledgement. To keep Core 1 fast, Core 0 *acknowledges immediately* and queues the actual cache update. So for some cycles, Core 0's cache still says "I have a fresh copy of this line" even though logically it does not.

A load barrier (`LFENCE` on x86, `DMB ISHLD` on ARM) **drains the invalidate queue** before allowing the next load. After draining, the cache state reflects all invalidations broadcast up to that point. The next load then sees the most recent globally-committed values.

Together, store buffers and invalidate queues are the two main reasons hardware barriers exist on cache-coherent systems. The fence's job is to drain one or both of them at the right moment, in the right direction.

---

## The Four Fence Types

We met them in the glossary; now we look at each one with a concrete Go example.

### LoadLoad: "do not let later reads jump ahead of earlier reads"

```go
// Bad (on ARM, RISC-V): no LoadLoad barrier between the two reads.
ready := *readyPtr     // (1)
data  := *dataPtr      // (2)
```

If `ready` is `true`, the writer goroutine has already written `data`. We expect `data` to be the fresh value. But on a weakly-ordered CPU the load of `data` may have been speculatively issued and completed *before* the load of `ready` (yes, even though `ready` appears first in source). The load may return a stale value.

A LoadLoad barrier between (1) and (2) forces the order. In Go, you express this implicitly by using `atomic.LoadBool(&ready)` paired with `atomic.LoadPointer(&dataPtr)` — both of which carry **acquire** semantics on weak platforms.

### LoadStore: "do not let later writes jump ahead of earlier reads"

This is the most subtle of the four. Suppose you read a flag, decide what to write, and write. You do not want the write to happen *before* the read, since the value you wrote depends on what you read. On most CPUs LoadStore reordering is rare because data dependencies prevent it — but a *speculative* store buffer entry could in principle be issued before the load is fully resolved. ARM's release-store (`STLR`) provides LoadStore (plus LoadLoad, plus StoreStore) ordering in one instruction.

### StoreStore: "do not let later writes jump ahead of earlier writes"

```go
*dataPtr  = 42            // (1) write the payload
*readyPtr = true          // (2) publish the flag
```

This is the publisher half of the publish-subscribe handshake. We want every reader who sees `*readyPtr == true` to see `*dataPtr == 42`. If the CPU is allowed to reorder StoreStore, the publish might become visible *before* the payload, and a reader could observe `ready` set with the old payload value.

x86 forbids StoreStore reordering by default. ARM permits it: you need either a `DMB ISHST` between the two stores, or you express (2) as a release-store `STLR`.

In Go, `atomic.StorePointer(&dataPtr, ...)` followed by `atomic.StoreBool(&readyPtr, true)` is correct on all platforms. The release semantics of the second store guarantee that everything before it is visible before it.

### StoreLoad: "do not let a later read jump ahead of an earlier write"

```go
*xPtr = 1                  // (1) my flag
r := *yPtr                 // (2) the other thread's flag
```

This is the case x86 *does* allow to reorder. It is the Dekker's-style store-then-load that we saw above. To restore ordering you need a full fence — `MFENCE` or a `LOCK`-prefixed instruction, or in Go an `atomic.CompareAndSwap` / `atomic.Add` / `atomic.Swap`.

---

## Real-World Analogies

### The post office (store buffer)

You drop a letter in the outgoing mailbox at your office. From your perspective, you "sent" it the moment it left your hand. To anyone outside the office, the letter has not yet been sent — it is sitting in the mailbox until the mail carrier picks it up. The store buffer is the office mailbox. The mail carrier is the cache-coherence machinery. `MFENCE` is you running outside, intercepting the carrier, and saying "go now, I'll wait" — you do not move until every letter you dropped is in the system.

### The whiteboard meeting (invalidate queue)

Imagine a meeting where attendees share a whiteboard. When you erase a region, you announce "I am erasing X." Other attendees write "noted" on their own little notepads, and they update their *picture* of the whiteboard *later*. If one attendee glances at their notepad and sees X still there, they may use stale information. The invalidate queue is their notepad. `LFENCE` is each attendee pausing, "processing all notes now," and only then looking again.

### The library card catalog (cache coherence)

Imagine an old library where each card catalog drawer has a copy at each librarian's desk. When a book is moved, every drawer needs an update. MESI is the protocol the librarians use to keep their drawers consistent: someone announces "I am moving book X," the others mark X invalid in their drawers, then a single owner updates the master entry, then everyone can re-read the master. Barriers are the moments where a librarian stops serving patrons until they have applied all pending updates.

---

## Mental Models

### Model 1: The barrier is a wall

Picture every memory operation in your program as a brick floating in a stream. The CPU is free to rearrange the bricks within a region. A barrier is a **wall** — a brick of a special kind that no other brick may cross. The wall does not move anything; it merely blocks reordering across it. This is the most accurate first-order model.

### Model 2: The barrier is a sync point

Picture two threads as two parallel timelines. Without barriers, the timelines may slide past each other — operations on different timelines have no globally agreed ordering. A barrier is like a clock-tick: at that point, the timelines must agree on what has happened so far. Use this model when reasoning about visibility ("can the other thread see my write yet?").

### Model 3: The barrier is a buffer flush

Picture each CPU core as a little office with an out-tray (store buffer) and an in-tray (invalidate queue). Memory traffic to the rest of the system goes through these trays. The barrier is the order to "process the trays now." Different barrier flavours flush different trays in different directions: `SFENCE` flushes the out-tray, `LFENCE` processes the in-tray, `MFENCE` does both.

### Model 4: The barrier is a happens-before edge

In the language of memory models (Adve, Manson, the Go memory model), `Release(x) → Acquire(x)` creates a *happens-before* edge. Every operation before the release on the writer happens before every operation after the acquire on the reader. This is the model the Go memory model itself uses, and it is the most useful one when reasoning about Go code rather than assembly.

---

## Pros and Cons of Strong vs Weak Models

### Strong models (x86-TSO)

**Pros:**
- Easier to reason about. Most casual concurrent code "just works" because the CPU has already paid for stronger ordering.
- Fewer barriers needed → cleaner generated assembly.
- The store buffer is the only common surprise.

**Cons:**
- The hardware pays a perpetual performance cost. Every store needs the full TSO machinery.
- Programmers develop incorrect intuition that "writes are visible immediately," which fails when they port to ARM or RISC-V.

### Weak models (ARM, RISC-V, POWER)

**Pros:**
- Hardware can be simpler / faster / lower-power, since the architecture is free to reorder aggressively.
- Programmers must be explicit about ordering, which makes synchronization visible in code.
- Modern weak ISAs have single-instruction acquire/release loads/stores (ARMv8 `LDAR`/`STLR`, RISC-V `LR.AQ`/`SC.RL`), which are *cheaper* than a separate fence in many cases.

**Cons:**
- Casual code that "worked on x86" can subtly break.
- Debugging is hard: a missing barrier may produce a bug visible only once per millions of executions, only under contention, only on certain CPUs.
- Reading assembly requires knowing which `DMB` flavour does what.

For most Go programmers the practical takeaway is: **use `sync/atomic` consistently** and the runtime will choose the right barrier per platform. Do not assume x86 semantics.

---

## x86 Quick Reference

| Instruction | Meaning | Cost (rough cycles, modern Intel) |
|-------------|---------|----------------------------------|
| `MOV [mem], reg` | Plain store | 1 (after retirement) |
| `MOV reg, [mem]` | Plain load | 4–5 (L1 hit) |
| `LOCK MOV` | *(invalid — `MOV` cannot take `LOCK`)* | — |
| `XCHG reg, [mem]` | Atomic swap (implicit `LOCK`) | ~20-30 |
| `LOCK XADD reg, [mem]` | Atomic add and return old | ~20-30 |
| `LOCK CMPXCHG reg, [mem]` | Atomic compare-and-swap | ~20-30 |
| `MFENCE` | Full memory barrier | ~30-40 |
| `LFENCE` | Load fence (also serialising on Intel since Spectre) | ~10-30 |
| `SFENCE` | Store fence (only relevant for non-temporal stores) | ~5-10 |

Important facts about x86:

- **A plain `MOV` store has release semantics for free.** Any prior store, any prior load, will be visible before this store reaches the cache. Hence `atomic.StorePointer` on amd64 compiles to a plain `MOVQ`. No fence needed.
- **A plain `MOV` load has acquire semantics for free.** Any subsequent load, any subsequent store, will not be reordered before this load. Hence `atomic.LoadPointer` on amd64 compiles to a plain `MOVQ`. No fence needed.
- **A `LOCK`-prefixed RMW is a full barrier.** It includes a `MFENCE`-equivalent and drains the store buffer. Hence `atomic.AddInt32`, `atomic.CompareAndSwapInt32`, `atomic.SwapInt32`, all atomic RMWs on amd64 compile to `LOCK`-prefixed instructions.
- **The only sequence that genuinely needs `MFENCE` is "store, then load to a *different* location."** This is the Dekker case. For this Go uses `XCHG` (which has an implicit `LOCK` and is often slightly faster than `MOV` + `MFENCE` on modern Intel).

The historical pattern of `MOV` + `MFENCE` for atomic stores was used by older Go versions and by some C++ libraries; modern code typically uses `XCHG` or relies on the natural release semantics of `MOV`.

---

## ARM Quick Reference

| Instruction | Meaning |
|-------------|---------|
| `LDR Xt, [Xn]` | Plain load — no ordering guarantees vs other memory ops |
| `STR Xt, [Xn]` | Plain store — no ordering guarantees vs other memory ops |
| `LDAR Xt, [Xn]` | Load-acquire — LL, LS ordering for *this* core's later ops |
| `STLR Xt, [Xn]` | Store-release — LS, SS ordering for *this* core's earlier ops |
| `LDXR / STXR` | Load-exclusive / store-exclusive (LL/SC pair for atomics) |
| `LDAXR / STLXR` | Acquire/release variants of the LL/SC pair |
| `DMB ISH` | Data Memory Barrier, inner shareable — full barrier between cores |
| `DMB ISHST` | DMB store-only — like SFENCE |
| `DMB ISHLD` | DMB load-only — like LFENCE |
| `DSB ISH` | Data Synchronization Barrier — completes prior accesses |
| `ISB` | Instruction Synchronization Barrier — flushes pipeline (not for data sync) |

Important facts about ARM:

- **Plain `LDR` and `STR` have *no* ordering guarantees.** The CPU may reorder them freely. This is why naive shared-memory programs that "work" on x86 can break on ARM.
- **`LDAR` and `STLR` are the cheapest way to implement acquire/release.** A single instruction. Most ARM atomic implementations in Go and Rust use these.
- **`DMB ISH` is the heavy hammer.** Used when you need a full memory barrier (e.g. between an atomic store and a later atomic load to a different location, analogous to the x86 Dekker case).
- **Apple Silicon (M1/M2/M3/M4)** implements TSO-emulation in some operation modes (for Rosetta 2 binaries). Native ARM64 Go binaries get the weak model.

---

## Code Examples

### Example 1: Why a plain global flag is broken

```go
package main

import (
	"fmt"
	"runtime"
	"time"
)

var (
	data  int
	ready bool
)

func main() {
	runtime.GOMAXPROCS(2)

	go func() {
		for !ready {
			// busy wait
		}
		fmt.Println("reader sees data =", data)
	}()

	time.Sleep(10 * time.Millisecond)
	data = 42
	ready = true

	time.Sleep(100 * time.Millisecond)
}
```

This program *appears* to work on x86. The reader sees `data == 42` because x86-TSO forbids StoreStore reordering on the writer side and forbids LoadLoad reordering on the reader side. **It is still a data race, and on ARM or RISC-V it may print `data = 0`.** `go run -race` flags it immediately.

The fix is to use atomics:

```go
import "sync/atomic"

var (
	data  atomic.Int64
	ready atomic.Bool
)

func main() {
	runtime.GOMAXPROCS(2)

	go func() {
		for !ready.Load() {
			runtime.Gosched()
		}
		fmt.Println("reader sees data =", data.Load())
	}()

	time.Sleep(10 * time.Millisecond)
	data.Store(42)
	ready.Store(true)

	time.Sleep(100 * time.Millisecond)
}
```

`ready.Store(true)` has release semantics. `ready.Load()` has acquire semantics. The pair establishes a happens-before edge: the writer's `data.Store(42)` happens before the reader's `data.Load()`. The race detector is satisfied; the program is correct on every supported platform.

### Example 2: Disassembling an atomic store on amd64

Take the program:

```go
package main

import "sync/atomic"

var x atomic.Int32

func main() {
	x.Store(42)
}
```

Compile with `go build -gcflags='-S' main.go 2>store.s` (or `go tool objdump -s 'main\.main' a.out`). You will see, on amd64, something close to:

```
MOVL $42, AX
XCHGL AX, main.x(SB)
RET
```

`XCHGL` exchanges a register with memory. Its implicit `LOCK` prefix makes it atomic *and* a full memory barrier. On amd64 Go uses `XCHG` for `atomic.Store` because it is a single instruction that both performs the store and serves as a full fence (handling the StoreLoad case if the next thing the program does is load some other atomic).

### Example 3: The same store on ARM64

On `linux/arm64`:

```
MOVD $42, R1
STLR R1, (R0)
RET
```

`STLR` is the store-release. No separate fence is needed; the instruction itself carries the release ordering. This is *cheaper* than the equivalent x86 `XCHG`.

### Example 4: A counter increment

```go
package main

import "sync/atomic"

var n atomic.Int64

func inc() {
	n.Add(1)
}
```

On amd64:

```
MOVQ $1, AX
LOCK XADDQ AX, main.n(SB)
```

`LOCK XADDQ` — atomic exchange-and-add, with the `LOCK` prefix giving it full barrier semantics.

On arm64:

```
LDADDAL R1, R2, (R0)
```

`LDADD` is the "load and add atomically" instruction added in ARMv8.1-LSE. The `AL` suffix means **a**cquire-on-load and re**l**ease-on-store — full ordering. On older ARMv8.0 cores Go emits an LL/SC loop: `LDAXR` / `ADD` / `STLXR` / branch-on-failure.

These three examples show the same Go source compiled to wildly different sequences. Go hides the difference; understanding *what* each instruction does is the whole point of this topic.

---

## Go and the Hardware

The Go runtime has two relevant atomic packages:

### `sync/atomic` (public)

This is the package you call from your code. It guarantees:

- Each `Store` is a release.
- Each `Load` is an acquire.
- Each `Add`, `Swap`, `CompareAndSwap` is a full sequentially-consistent RMW.
- Reads and writes through `Pointer[T]` (Go 1.19+) carry the same ordering as integer atomics.

The Go memory model document defines this in normative form (see *specification.md* in this subsection).

### `runtime/internal/atomic` (private)

This is the runtime's *internal* atomic package, with platform-specific assembly. You cannot import it from user code (it is in `internal/`), but the runtime itself uses it heavily: the GMP scheduler, the garbage collector's write barrier, the channel implementation, `sync.Mutex` fast paths, all rely on it.

The interface is similar to `sync/atomic` but includes lower-level primitives needed by the runtime:

- `Load`, `Store`, `Loadp`, `Storep` — typed loads/stores
- `Cas`, `Casp1` — compare-and-swap
- `Xchg`, `Xadd` — exchange, exchange-and-add
- `LoadAcq`, `StoreRel` — explicit acquire/release primitives (used for cases where full SC is overkill, especially on weak platforms)
- `Or8`, `And8` — byte-level atomic OR/AND used by the GC's mark bits

On each supported architecture there is a corresponding `.s` file (e.g. `runtime/internal/atomic/atomic_amd64.s`, `atomic_arm64.s`, `atomic_riscv64.s`) that contains the hand-written assembly for these primitives.

We will trace through the most interesting of these in the *middle*, *senior*, and *professional* files.

---

## Coding Patterns

### Pattern 1: publish-subscribe via a flag

This is the bread-and-butter use of acquire/release.

```go
// publisher
data.Store(payload)        // ordinary write
ready.Store(true)          // release: payload is published

// subscriber
if ready.Load() {          // acquire: pairs with the release above
    use(data.Load())       // guaranteed to see the published payload
}
```

This pattern shows up everywhere: lazy initialization, double-checked locking, futures, channels, RCU. The two atomic operations create the happens-before edge.

### Pattern 2: lock-free counter

```go
var counter atomic.Int64

func bump() int64 {
    return counter.Add(1)
}
```

`atomic.Add` on amd64 is `LOCK XADD` — a full barrier — but if you only need a counter that does not synchronise other data, you do not pay for ordering benefits you do not use. The full-barrier cost is unavoidable on TSO hardware; on ARM the `LDADDAL` is slightly cheaper, but still expensive compared to a plain `ADD`.

For performance-critical fast paths, per-CPU counters with eventual aggregation are often better; that is a senior topic.

### Pattern 3: try-lock spin

```go
var flag atomic.Int32

func tryLock() bool {
    return flag.CompareAndSwap(0, 1)
}
func unlock() {
    flag.Store(0)
}
```

`CompareAndSwap` is a full barrier. The `unlock` is a release. Anyone who acquires the lock (via CAS) will see all writes the previous holder made before `unlock`.

### Pattern 4: lazy singleton with double-checked locking

Use `sync.Once`. It internally uses an atomic load (fast path) plus a mutex (slow path) plus an atomic store to publish completion. Hand-rolled double-checked locking is famously easy to get wrong; do not.

---

## Clean Code

- Prefer `sync.Mutex` or channels over hand-rolled atomics whenever the contention is low. The barrier costs of mutex lock/unlock are similar to a `LOCK XCHG`, and the code is much easier to reason about.
- Use `sync/atomic.Int32` etc. (Go 1.19+ typed atomics) instead of raw `atomic.StoreInt32(&x, v)`. The typed wrappers make it impossible to forget that an access is atomic.
- Never mix atomic and non-atomic access to the same variable. If `x` is touched by `atomic.Store`, every other access to it must also go through `atomic.Load` or `atomic.Store`.
- Avoid `unsafe.Pointer` atomics unless you genuinely need them. `atomic.Pointer[T]` is type-safe and almost always sufficient.
- Comment every atomic with the *invariant* it is protecting. "atomic state for X" is not enough; explain "stores happen-before reads on flag, which protect writes to data."

---

## Error Handling

There is rarely an "error" in barrier code in the traditional sense — a barrier instruction either runs or does not. The errors are *logical*: you forgot a barrier, or used the wrong one, or assumed x86 semantics on ARM. The tools for catching these:

- `go test -race` — the data race detector instruments every memory access and reports races. Catches almost all missing-barrier bugs in tests.
- `go vet -copylocks` — catches structural mistakes around locks (less directly related to barriers but in the same family).
- Stress tests with `runtime.GOMAXPROCS(N)` set to multiple values, on real ARM hardware. The race detector under-reports on x86 because TSO hides many bugs; running on ARM exposes them.
- TLA+ or Spin model checking for serious algorithms.

We will detail these in *tasks.md* and *find-bug.md*.

---

## Security Considerations

Barriers themselves are not a security mechanism. However:

- **Speculative execution side channels (Spectre/Meltdown/MDS).** `LFENCE` on Intel CPUs since Skylake is a *serialising* instruction — it blocks speculative execution past it. The Linux kernel and Go runtime use this in some places to limit speculation. End-user Go code rarely needs to consider this.
- **Constant-time cryptography.** Code that must run in time independent of secret data (e.g. AES key schedules) sometimes uses explicit fences and non-cached loads to avoid leaking via cache timing. Go's `crypto/subtle` provides constant-time primitives; do not hand-roll.
- **Side-channel resistance in atomics.** A `LOCK CMPXCHG` takes essentially the same time regardless of whether the comparison succeeds or fails on modern hardware, but the *cache line state transition* differs. For security-critical algorithms this matters; for normal application code it does not.

---

## Performance Tips

- **Prefer release-store over full fence when you can.** `atomic.Store` on amd64 used to compile to `MOV` + `MFENCE`; modern Go uses `XCHG`, but in either case `Store` is full-barrier. If your algorithm only needs a release, an explicit `runtime/internal/atomic.StoreRel` is cheaper on ARM (but you cannot call it from user code; you have to use the public `Store`).
- **Avoid false sharing.** Two unrelated atomics on the same cache line will ping-pong the line between cores on every write, costing 50–200 cycles each time. Pad with 56–120 bytes of unused space between hot atomics intended for different cores.
- **Batch barriers.** If you must publish many writes, do them all, then one release-store of a flag. Do not put an atomic store after every plain store.
- **Use `sync.Mutex` for high-contention scenarios.** Spinning on a `CompareAndSwap` repeatedly is wasteful when you have heavy contention; the kernel-mediated wait of a real mutex is usually better.
- **Pin a goroutine if you really need locality.** `runtime.LockOSThread` ties a goroutine to an OS thread, which reduces cache migration. Use carefully.

---

## Best Practices

1. **Default to `sync.Mutex` and channels.** They are correct, ergonomic, and fast enough for 95 % of code.
2. **Move to `sync/atomic` only when profiling shows the mutex is the bottleneck.** Then verify with the race detector and stress tests.
3. **Pair every atomic store with an atomic load.** If you ever do `atomic.Store(&x, ...)`, also do `atomic.Load(&x)` everywhere `x` is read.
4. **Document the happens-before relationship.** Comments like `// release pairs with acquire in Reader.go:42`.
5. **Test on every architecture you ship for.** At minimum, run your test suite on both `amd64` and `arm64`.
6. **Avoid clever lock-free algorithms unless absolutely necessary.** They are publication-worthy research papers, not casual application code.

---

## Edge Cases and Pitfalls

### Pitfall 1: "I read the value once, it must be correct"

```go
if !done {
    work()
}
```

If `done` is shared with another goroutine and you do not use atomics, the compiler may *cache* it in a register and never re-read it — your loop may spin forever. Hardware barriers do not help here; *compiler* barriers do, and `atomic.LoadBool` is both.

### Pitfall 2: Mixed atomic and plain access

```go
var n int32

func writer() {
    atomic.StoreInt32(&n, 1)
}

func reader() int32 {
    return n // plain load!
}
```

This is a data race. The race detector will flag it. The atomic store and the plain load are *not* synchronised. Either both must be atomic, or both must be guarded by the same mutex.

### Pitfall 3: 64-bit atomics on 32-bit platforms

On 32-bit ARM and 32-bit x86, a 64-bit memory access is *not* atomic without the right instructions (`LDREXD/STREXD` on ARM, `CMPXCHG8B` on x86). The `sync/atomic` package handles this, but you must use the 64-bit functions even if the natural type would be `int32`. Also, on 32-bit ARM the address must be 64-bit aligned — passing a misaligned pointer causes a SIGBUS at run time.

Go 1.19 introduced the typed `atomic.Int64` etc. which guarantee alignment automatically. Use them.

### Pitfall 4: Reading the wrong value through a stale pointer

```go
var ptr atomic.Pointer[Item]

// reader
p := ptr.Load()        // gets some Item*
v := p.Field           // reads a field from the Item
```

If the writer publishes a new pointer and then immediately frees the old object (somehow — Go's GC keeps it alive as long as `p` references it, but in unsafe code you could free it), the reader would access freed memory. The acquire on `ptr.Load()` does not extend lifetime — it merely orders memory accesses. Lifetime is the GC's job.

### Pitfall 5: Spinning on an atomic without backoff

```go
for !flag.Load() {
    // tight loop
}
```

This is a "memory storm." The reader keeps the cache line in Shared state, the writer needs Modified to publish, and each iteration of the loop costs an L1 access. On a busy machine the writer can be slowed down by the readers. Mitigation: `runtime.Gosched()` or a `pause` instruction inside the loop, or just use a channel.

### Pitfall 6: Assuming `MFENCE` is free

On Intel Skylake `MFENCE` is ~33 cycles. On a tight loop that costs 50 ns per fence, you can lose 30 % of your throughput. If you have a hot loop, profile and consider whether a different algorithm avoids the fence.

---

## Common Mistakes

- "x86 is sequentially consistent" — no, it is TSO. StoreLoad can reorder.
- "ARM is just like x86 with extra fences" — no, ARM is weak. Every reordering is allowed by default.
- "I just need to make the write atomic" — atomicity (indivisibility) and ordering (visibility relative to other writes) are different things. Atomic ≠ barrier; in Go's `sync/atomic` they happen to coincide, but in other languages or instructions they do not.
- "Volatile in C is the same as atomic" — no. C `volatile` does not impose memory ordering across threads. C11's `_Atomic` does.
- "I read this in Java, it must apply to Go" — Java's `volatile` is *also* an acquire-release-store-and-load. So is C++11's `std::atomic` with `memory_order_seq_cst`. So is Go's `sync/atomic`. So in this *particular* case the mental model transfers. But Java's pre-1.5 model is very different; do not learn from old books.

---

## Common Misconceptions

- **"My program works, so the barriers are right."** Concurrent bugs are probabilistic. They can hide for years and then surface in production under a particular CPU load.
- **"Compiler reordering does not happen because I have optimisations off."** The Go compiler reorders memory operations even at `-N`. Only the race detector reliably catches missing atomics.
- **"`LFENCE` is the load fence, so it solves my reader-side ordering problem."** On x86, plain loads are already ordered. `LFENCE` is rarely useful for ordering — its main modern use is as a Spectre mitigation.
- **"`SFENCE` is the store fence, so I need it after every store."** Plain `MOV` stores on x86 already have release semantics. `SFENCE` is only needed for non-temporal stores (`MOVNT*`).
- **"Atomics are slow."** They are slower than plain loads/stores, but a `LOCK XADD` is ~20 cycles. If you do one per microsecond, it costs less than 2 % of your CPU.

---

## Tricky Points

### Tricky Point 1: The StoreLoad asymmetry

On x86, three of the four reorderings are forbidden, but StoreLoad is allowed. This means a `Store` followed by a `Load` to a *different* address is the *only* sequence that genuinely needs `MFENCE` (or a `LOCK`-prefixed instruction). This is the surprise that bites many programmers when they port to multi-core hardware.

### Tricky Point 2: `LFENCE` is not "free LoadLoad"

`LFENCE` on x86 was originally intended for ordering non-temporal loads. Since Spectre (CVE-2017-5753), Intel has documented `LFENCE` as a speculative-execution barrier, and Linux/Go use it in some critical paths to prevent speculative leaks. The original "load fence between two loads" use case is rare in user code because x86 plain loads do not reorder against each other anyway.

### Tricky Point 3: `MFENCE` vs `XCHG`

Both serve as full memory barriers on x86. Which is faster? Microbenchmarks suggest `XCHG` is marginally faster on modern Intel cores because `MFENCE` is a serialising instruction that must drain *all* in-flight loads and stores, whereas `XCHG` only needs to drain the store buffer for the affected cache line. Go's runtime uses `XCHG` for atomic stores; manual assembly that needs a fence but no associated RMW typically uses `MFENCE`.

### Tricky Point 4: The Go memory model says "data race causes undefined behaviour"

Earlier versions of the Go memory model defined data races as having loosely specified outcomes. Since Go 1.19, the memory model document explicitly aligns with C/C++ in declaring data-racing programs as having undefined behaviour, *with* a deliberate exception: word-tearing for machine-word-sized atomics is forbidden, so a racing read sees one of the racing writes, not garbage. This is a subtle difference from C/C++ and exists because Go targets memory-safe-by-default.

### Tricky Point 5: Cache-line alignment

`atomic.Int64` is 8 bytes; on a 64-byte cache line, eight of them fit. If two goroutines update two different `Int64`s on the same line, each store invalidates the line on the other core. This is "false sharing" — bytes that have no logical relationship cause real performance interference. The fix is `[64]byte`-pad each hot atomic, or use `atomic.Uintptr` separated by 64-byte gaps.

---

## Test

### Test 1: Spot the missing barrier

```go
var x int
var done bool

func writer() {
    x = 42
    done = true
}

func reader() {
    if done {
        fmt.Println(x)
    }
}
```

**Q:** What is wrong, and on which platforms does it manifest?
**A:** Plain shared variable access is a data race. The reader may see `done == true` and `x == 0`. On x86-TSO the reordering is unlikely (StoreStore is forbidden), so the bug is rare; on ARM it is common. The fix: make `done` an `atomic.Bool` and `x` an `atomic.Int64`, with `done.Store(true)` after `x.Store(42)`.

### Test 2: Predict the disassembly

```go
var n atomic.Int32

func f() {
    n.Store(7)
}
```

**Q:** On amd64, what does `n.Store(7)` compile to?
**A:** `MOVL $7, AX; XCHGL AX, main.n(SB)`. The `XCHGL` carries implicit `LOCK` and acts as a full fence.

### Test 3: Choose the right primitive

You need to publish a slice for a reader to consume, then clear a "writing-in-progress" flag.

```go
slice = []int{1, 2, 3}
inProgress = false
```

**Q:** What atomic operations make this safe?
**A:** `atomic.StorePointer(&sliceHeader, ...)` (or `atomic.Pointer[[]int].Store`), then `atomic.StoreBool(&inProgress, false)`. The release semantics of the second store guarantee the slice publication happens-before the flag publication.

### Test 4: Identify the barrier

You see this assembly in `go tool objdump`:

```
MOVD R1, (R0)
DMB ISH
```

**Q:** What is this doing?
**A:** It is a plain store followed by a full memory barrier. On ARM, this is one way to implement a sequentially-consistent store (although `STLR` is usually preferred and more efficient).

---

## Tricky Questions

### Q1. If x86 forbids StoreStore reordering, why do I still need atomics for a publish-subscribe flag?

Because the compiler can reorder, and because the load on the reader side, although not reorderable past *another* load, *can* be reordered with a non-atomic *store* on the reader side. Also, plain access is a data race — the race detector will flag it, and the Go memory model declares the outcome undefined. The "fix the compiler" reason is sufficient on its own.

### Q2. Why does Go use `XCHG` instead of `MOV` + `MFENCE` for `atomic.Store` on amd64?

`XCHG`'s implicit `LOCK` prefix gives full-barrier semantics in a single instruction, and microbenchmarks suggest it is slightly faster than `MOV` + `MFENCE` because the latter requires serialising the entire pipeline. Both produce correct code.

### Q3. On ARM, can I always use `STLR` instead of `STR` + `DMB ISH`?

Almost — `STLR` provides release semantics, which is sufficient for "publish my writes." `DMB ISH` is needed when you want a *full* barrier (release **and** acquire on a single store) for a sequentially-consistent fence between a store and a later load to a different address. The runtime uses both depending on what semantics it needs.

### Q4. Why is `LFENCE` more often associated with speculation than with load ordering?

x86 plain loads already do not reorder against each other under TSO, so the "order two loads" use case for `LFENCE` is rare. Its modern use is to act as a *serialising* instruction — it forces all prior loads to complete before any subsequent instruction executes, which prevents Spectre-style speculative side channels.

### Q5. What happens if I use `atomic.LoadInt32` on a misaligned address on ARM?

SIGBUS at run time. The hardware requires aligned access for `LDAR`/`STLR`. The Go compiler guarantees alignment of `atomic.Int32` etc., but if you use unsafe casts to atomically access an arbitrary memory location, you must ensure alignment yourself. The `sync/atomic` documentation explicitly mentions this.

### Q6. Can a barrier *force* a value into a register / out of a register?

No — barriers are about *memory* ordering, not about where data is stored within the CPU. They prevent reordering across the barrier and they may drain microarchitectural buffers, but they do not affect register allocation. The compiler's awareness of atomics is what prevents it from holding a value in a register across an atomic operation.

### Q7. If I write `n++` on a shared `int`, am I using a barrier?

No — `n++` is three operations (load, add, store) and none of them are atomic. The compiler may emit three instructions and another goroutine can interleave. No barrier is involved. To make it atomic, use `atomic.AddInt32(&n, 1)`, which compiles to `LOCK XADD` on amd64.

### Q8. Does `runtime.Gosched()` issue a barrier?

Yes, indirectly. The scheduler enters and leaves through code that uses atomics on internal scheduler state, which includes full barriers. As a side effect, by the time `Gosched` returns, all your prior memory operations are visible to any goroutine that later runs on this M. But do not rely on this — it is implementation detail. Use explicit atomics for ordering.

### Q9. Why does the race detector still flag a race when I think I have all the right atomics?

Often because *one* access path uses an atomic and another does not. Or because the atomic is on a different field than the one you actually read. The race detector reports the unsynchronised pair, not your reasoning about it.

### Q10. On a single-core machine, do I still need barriers?

Hardware reordering effectively disappears (a single core sees its own writes in order). Compiler reordering does not — you still need `sync/atomic` to prevent the compiler from caching values in registers, eliminating "redundant" loads, or reordering memory ops across what it thinks is single-threaded code. So yes.

---

## Cheat Sheet

```
Hardware Memory Barriers — Junior Cheat Sheet
============================================

ORDERING TABLE (which reorderings CAN occur):
  Model            LL   LS   SS   SL
  Sequential       -    -    -    -
  x86-TSO          -    -    -    YES
  ARMv8 (weak)     YES  YES  YES  YES
  RISC-V WMO       YES  YES  YES  YES

GO FRONT-END                      X86 ASM                ARM64 ASM
atomic.Load(p)                    MOV (free acquire)     LDAR
atomic.Store(p, v)                XCHG (full barrier)    STLR
atomic.Add(p, d)                  LOCK XADD              LDADDAL
atomic.CompareAndSwap(p, o, n)    LOCK CMPXCHG           CAS or LDAXR/STLXR
atomic.Swap(p, v)                 XCHG                   SWPAL or LDAXR/STLXR

X86 FENCE INSTRUCTIONS
  MFENCE   full barrier — drains store buffer
  LFENCE   load fence; today: also serialising for speculation
  SFENCE   store fence; only needed with non-temporal stores
  LOCK     prefix on RMW; implicit full barrier

ARM FENCE INSTRUCTIONS
  DMB ISH    full data memory barrier
  DMB ISHST  store-only
  DMB ISHLD  load-only
  DSB ISH    stronger; waits for completion
  ISB        pipeline flush (not for data ordering)
  LDAR/STLR  single-instruction acquire/release loads/stores

RULES OF THUMB
- Never mix atomic and non-atomic access to the same var.
- Always pair release (Store) with acquire (Load).
- Run -race on every PR.
- Test on amd64 AND arm64 if you ship to both.
- Avoid hand-rolled lock-free; use sync.Mutex unless profiling shows it.
```

---

## Self-Assessment Checklist

After this file, you should be able to answer "yes" to each of the following:

- [ ] I can explain what a store buffer is and why it exists.
- [ ] I can explain what an invalidate queue is and why it exists.
- [ ] I can name the four reorderings (LL, LS, SS, SL) and say which x86 forbids.
- [ ] I can list the main x86 fence instructions and what each does.
- [ ] I can list the main ARM barrier instructions and what each does.
- [ ] I can predict whether `atomic.Store` compiles to `MOV`, `XCHG`, or `MFENCE` on amd64.
- [ ] I can predict whether `atomic.Store` compiles to `STR`, `STLR`, or `STR` + `DMB ISH` on arm64.
- [ ] I know what `sync/atomic` does in terms of barriers.
- [ ] I know what `runtime/internal/atomic` is and why it exists.
- [ ] I can spot a missing barrier in a publish-subscribe pattern.
- [ ] I can explain why "it works on x86" is not a correctness argument.
- [ ] I can run `go tool objdump` and identify the atomic instruction.

---

## Summary

A memory barrier is a CPU instruction that prevents memory reordering across it. CPUs reorder loads and stores for performance via store buffers, invalidate queues, out-of-order execution, and speculation; barriers drain these buffers and enforce visibility ordering between threads.

The four reorderings — LoadLoad, LoadStore, StoreStore, StoreLoad — define the matrix of what each architecture permits. **x86-TSO** forbids three and permits only StoreLoad, so most plain loads/stores already have the ordering you want, and you only need a fence for the Store-then-Load case. **ARMv8** permits all four; you must use `LDAR`, `STLR`, and `DMB ISH` to constrain them.

In Go, you almost never write barriers directly. `sync/atomic.Load` gives you acquire, `sync/atomic.Store` gives you release, and `Add`/`Swap`/`CompareAndSwap` give you full sequential consistency. The runtime picks the right machine instructions for each platform. The runtime's own internal atomics package, `runtime/internal/atomic`, mirrors `sync/atomic` for scheduler and GC use, with platform-specific assembly.

The main hazards are: (1) mixing atomic and non-atomic access, (2) assuming x86 semantics on ARM, (3) misaligned 64-bit atomics on 32-bit platforms, and (4) false sharing.

You do not need to understand every microarchitectural detail at the junior level — but you should be able to read `go tool objdump` output, identify the atomic instruction, and explain in one sentence what barrier it provides. That foundation is enough for the middle.md content where we build lock-free queues and dissect the runtime's atomic implementation.

---

## What You Can Build

With the knowledge in this file you can confidently:

- Choose between `sync.Mutex`, channel, and `sync/atomic` for shared state.
- Use `atomic.Bool`, `atomic.Int32`/`Int64`, `atomic.Pointer[T]` correctly.
- Read `go tool objdump` of a tiny program and explain the atomic instructions.
- Diagnose simple race-detector reports involving a missing atomic.
- Avoid the most common false-sharing trap by padding hot atomics to a cache line.

You are *not yet* ready to:

- Implement a lock-free MPMC queue (middle/senior).
- Reason about RISC-V WMO fences (senior).
- Use `runtime/internal/atomic` (impossible from user code; understanding is professional-level).
- Prove correctness of an algorithm with the Go memory model + Herd7 (professional).

---

## Further Reading

- Russ Cox, "Hardware Memory Models" — `https://research.swtch.com/hwmm`
- Russ Cox, "Programming Language Memory Models" — `https://research.swtch.com/plmm`
- Russ Cox, "Updating the Go Memory Model" — `https://research.swtch.com/gomm`
- The Go Memory Model — `https://go.dev/ref/mem`
- Hans Boehm, "Threads Cannot Be Implemented as a Library"
- Adve and Gharachorloo, "Shared Memory Consistency Models: A Tutorial" (1995)
- Intel Software Developer's Manual, Vol. 3A, §8
- ARM Architecture Reference Manual, §B2
- McKenney, "Memory Barriers: a Hardware View for Software Hackers"

---

## Related Topics

- [Memory Ordering Barriers — Overview](../../22-memory-ordering-barriers/) — the parent subsection
- `sync/atomic` package usage — Roadmap section on atomics
- `sync.Mutex` internals — Roadmap section on mutexes
- The Go scheduler (GMP) — uses `runtime/internal/atomic` heavily
- Garbage collection write barriers — `runtime/mwbbuf.go`
- Race detector (`-race` flag) — `runtime/race/`

---

## Diagrams and Visual Aids

### Diagram 1: where reorderings happen

```
Source code               Compiler                  CPU pipeline             Cache + interconnect
─────────────             ────────                  ────────────             ────────────────────
 write A                   reorder (within          dispatch out-of-order    propagate via MESI
 write B                   "as-if" rule)            speculate past branch    queue invalidations
 read  C                                            store buffer             snoop, transition
 read  D                                            load forwarding          M/E/S/I states
 write E

      ▲                          ▲                          ▲                          ▲
      │                          │                          │                          │
      │                          │                          │                          │
      └──── compiler barrier ────┘                          └──── hardware barrier ────┘
       sync/atomic intrinsic                                  MFENCE / DMB / fence rw,rw
```

### Diagram 2: x86-TSO state machine (simplified)

```
       Each core has its own store buffer + L1; they share L2/L3 + memory.

   ┌─────────┐                 ┌─────────┐                 ┌─────────┐
   │ Core 0  │                 │ Core 1  │                 │ Core N  │
   │ store-q │                 │ store-q │                 │ store-q │
   └────┬────┘                 └────┬────┘                 └────┬────┘
        │                           │                           │
        ▼                           ▼                           ▼
   ┌─────────┐                 ┌─────────┐                 ┌─────────┐
   │   L1    │ ◄────MESI────► │   L1    │ ◄────MESI────► │   L1    │
   └────┬────┘                 └────┬────┘                 └────┬────┘
        └────────────┐ ┌────────────┘ ┌────────────┐
                     ▼ ▼                            ▼
                  [        Shared L2/L3 + DRAM        ]
```

### Diagram 3: publish-subscribe with release/acquire

```
   Writer goroutine                          Reader goroutine
   ───────────────                           ────────────────
   data.Store(42)            <── happens-before ──┐
   ready.Store(true) (release)                    │
   ──── memory edge ────                          │
                                                  │
                                ready.Load() (acquire)  if true:
                                data.Load()  guaranteed 42
```

The release on the writer + the acquire on the reader together create the happens-before edge. Whatever the writer did before the release is guaranteed visible to the reader after the acquire.

### Diagram 4: store buffer drain on MFENCE

```
   Before MFENCE                After MFENCE
   ─────────────                ───────────
   pipeline: [...]              pipeline: [...]
   store buf: [a=1, b=2, c=3]   store buf: empty
   L1 cache:  [...]             L1 cache:  [..., a=1, b=2, c=3]
```

The fence drains every pending store from the buffer to the cache before allowing the next memory operation to issue.

### Diagram 5: invalidate queue drain on LFENCE/DMB ISHLD

```
   Before LFENCE              After LFENCE
   ────────────               ────────────
   inv queue: [A, B, C]       inv queue: empty
   L1 cache:  A,B,C in S      L1 cache:  A,B,C in I
```

The fence processes all queued invalidations, so the next load sees the up-to-date cache state.

---

---

## Appendix A: Walking Through a Tiny Program, Step by Step

Let us take a single concurrent program and trace it through every layer we have discussed: source, compiler, instructions, hardware. This appendix exists to make every concept above concrete.

### A.1 The source

```go
package main

import (
	"fmt"
	"runtime"
	"sync/atomic"
)

var data atomic.Int64
var ready atomic.Bool

func writer() {
	data.Store(0xDEADBEEF)
	ready.Store(true)
}

func reader() {
	for !ready.Load() {
		runtime.Gosched()
	}
	fmt.Printf("0x%X\n", data.Load())
}

func main() {
	go reader()
	writer()
	select {} // never returns; in real code we'd use WaitGroup
}
```

### A.2 What the Go memory model says

Translating to the formal vocabulary of `go.dev/ref/mem`:

- The atomic store `ready.Store(true)` *synchronizes with* the atomic load `ready.Load()` that observes the value `true`.
- This *synchronizes-with* edge implies *happens-before*.
- Everything sequenced before `ready.Store(true)` in `writer()` happens-before everything sequenced after the corresponding `ready.Load()` in `reader()`.
- In particular, `data.Store(0xDEADBEEF)` happens-before `data.Load()` in the reader.
- Therefore `data.Load()` must return `0xDEADBEEF`.

This argument relies *only* on the abstract memory model. It does not care which CPU you run on. The next subsections show how the compiler and hardware actually deliver on that guarantee.

### A.3 What the amd64 compiler emits

With `go build -gcflags='-S' main.go 2>main.s` we can see, approximately (machine output simplified):

For `writer`:
```
TEXT main.writer(SB), ABIInternal, $0-0
    MOVQ    $-559038737, AX          ; 0xDEADBEEF
    XCHGQ   AX, main.data+0(SB)      ; atomic.Int64.Store
    MOVB    $1, AX
    XCHGB   AL, main.ready+0(SB)     ; atomic.Bool.Store
    RET
```

For `reader`:
```
TEXT main.reader(SB), ABIInternal, $0-0
loop:
    MOVBQZX main.ready+0(SB), AX     ; plain load (free acquire on x86)
    TESTB   AL, AL
    JNE     done
    CALL    runtime.Gosched(SB)
    JMP     loop
done:
    MOVQ    main.data+0(SB), AX      ; plain load
    ; ... format and print ...
    RET
```

Key observations:

1. The writer's stores use `XCHG` instructions. `XCHGB` and `XCHGQ` carry an implicit `LOCK` prefix, making each a full memory barrier. Why both stores? Because the runtime conservatively gives each atomic store full SC semantics. On amd64 only the second store needed full barrier semantics (between it and a subsequent load to a different location), but Go's `sync/atomic.Store` is specified as sequentially consistent on every platform.
2. The reader's loads are plain `MOV` instructions. No fence! This is because on x86-TSO, a plain `MOV` load *already* has acquire semantics: it cannot be reordered with later loads (LoadLoad forbidden) or later stores (LoadStore forbidden), which is exactly what acquire means.
3. The branch `JNE done` ensures the reader sees `ready == true` before proceeding to load `data`. The compiler does not reorder the data load before the branch because it depends on the branch outcome (and even if it did, the speculation would resolve correctly).

### A.4 What the arm64 compiler emits

For `writer`:
```
TEXT main.writer(SB), ABIInternal, $0-0
    MOVD    $-559038737, R1          ; 0xDEADBEEF
    MOVD    $main.data(SB), R0
    STLR    R1, (R0)                 ; store-release
    MOVB    $1, R1
    MOVD    $main.ready(SB), R0
    STLRB   R1, (R0)                 ; store-release byte
    RET
```

For `reader`:
```
TEXT main.reader(SB), ABIInternal, $0-0
loop:
    MOVD    $main.ready(SB), R0
    LDARB   R1, (R0)                 ; load-acquire byte
    CBNZ    R1, done
    CALL    runtime.Gosched(SB)
    JMP     loop
done:
    MOVD    $main.data(SB), R0
    LDAR    R1, (R0)                 ; load-acquire 8 bytes
    ; ... format and print ...
    RET
```

Key observations:

1. The writer uses `STLR` (Store-Release Register) for each atomic store. This is a single instruction that combines a store with release semantics — no separate `DMB` needed.
2. The reader uses `LDAR` (Load-Acquire Register). Single instruction, acquire semantics built in.
3. The pair `STLR` / `LDAR` together form the happens-before edge predicted by the Go memory model.
4. There are *no* `DMB ISH` instructions in this code. ARM v8's acquire/release-load/store family is sufficient for sequentially-consistent atomics on its own.

### A.5 What happens in the CPU

We trace through one *physical* execution. Assume two cores, Core W (writer) and Core R (reader).

1. Core W's pipeline retires `data.Store(0xDEADBEEF)`. The store enters the store buffer.
2. Core W's pipeline begins retiring `ready.Store(true)` — this is the `XCHG`/`STLR`.
   - On x86: `XCHGB` is a `LOCK`-prefixed RMW. The CPU stalls the pipeline until the store buffer is drained, then performs the exchange atomically, then drains again. The result: by the time the next instruction issues, both stores are globally visible in the L1 cache.
   - On ARM: `STLRB` is a store-release. The store enters the store buffer with a *release marker*. The CPU does not let any *later* store leave the buffer before this one is fully visible. The previous `STLR` for `data` is in the buffer; the release-store machinery ensures order is preserved.
3. Coherence message: Core W invalidates any cached copy of `data` and `ready` lines held by other cores in Shared state. Core R, which has been spinning on `ready`, receives the invalidation. Its invalidate queue accepts it.
4. Core R retires the spin's next `LDARB` for `ready`. On ARM this drains the invalidate queue first; on x86 plain `MOV` does too via TSO machinery. Core R's L1 reloads the `ready` line from L2 (or directly from Core W via the cache-coherent interconnect), seeing `true`.
5. The branch falls through; Core R retires `LDAR` for `data`. Acquire semantics guarantee no earlier loads/stores can move past it. The load fetches the freshly published `0xDEADBEEF`.
6. `fmt.Printf` runs.

If at any of these steps a fence had been missing, the reader could have observed `ready == true` with stale `data == 0`. Trace it through if you want — flip step 2's "release marker" to "no marker," and step 5's "acquire semantics" to "no constraint." Now the load of `data` may have been speculatively issued (and completed) at step 0, before any of the writer's stores were visible.

### A.6 What `-race` does

The race detector instruments every load and store of every non-atomic variable, building a vector clock per goroutine. When two goroutines access the same memory and no synchronization edge connects them, it logs a race.

In our program, the race detector sees:
- The writer's atomic stores create a release edge on the `ready` variable.
- The reader's atomic load creates an acquire edge on `ready`.
- They share a happens-before relationship through `ready`.
- All other accesses to `data` are happens-before-ordered via that edge.

No race. The program is clean. If you remove either of the atomics (replace with plain field access), the detector immediately complains.

### A.7 What happens if you remove the atomics

Imagine we wrote:

```go
var data int64
var ready bool

func writer() {
    data = 0xDEADBEEF
    ready = true
}

func reader() {
    for !ready { runtime.Gosched() }
    fmt.Printf("0x%X\n", data)
}
```

On amd64 this *seems* to work. The compiler emits plain `MOVQ`/`MOVB`; the hardware preserves StoreStore order; the reader is happy. **But it is still wrong:**

- The race detector flags it.
- The Go memory model says the outcome is undefined.
- The compiler is allowed to optimize `ready` into a register — the reader could spin forever.
- The compiler is allowed to reorder `data = ...` and `ready = ...`, even on x86.
- On arm64 the program may genuinely print `0x0`.

This is the most common kind of concurrency bug in the wild: code that "works" on the developer's laptop, passes CI on x86, and silently produces wrong answers in production on an ARM server. The race detector + porting to arm64 is the cheapest defence.

---

## Appendix B: Microarchitectural Buffers in More Detail

We sketched store buffers and invalidate queues above. Here we look at them as actual hardware structures, simplified but recognisable.

### B.1 The store buffer

Modern Intel cores have a store buffer of around 56 entries (Skylake) to 72 entries (Sapphire Rapids). Each entry holds:
- the target physical address (after translation by the TLB)
- the value to be written (up to 64 bytes for AVX-512 store)
- a sequence number for retirement ordering
- a flag indicating whether the entry has been forwarded to a younger load

The store buffer enables several optimisations:

1. **Decoupling store retirement from cache write.** A store can retire in 1 cycle even if the cache line is not present locally; the write to cache happens later, asynchronously.
2. **Store-to-load forwarding.** If a load to the same address finds the value in the buffer, it can read it directly without going to cache.
3. **Coalescing.** Two stores to the same cache line can be merged into one cache transaction in some implementations.

The downsides:
- The store is not globally visible until it leaves the buffer.
- Other cores' loads do not see it.
- A load on the *same* core to a different address may complete (using cache state) before the store leaves the buffer. This is the StoreLoad reordering that TSO permits.

`MFENCE` (or any `LOCK`-prefixed instruction) drains the store buffer fully before allowing further instructions.

### B.2 The invalidate queue

When Core A writes a cache line, MESI requires Core A to take Modified state, which in turn requires every other core holding Shared copies to invalidate theirs. A naive implementation would have Core A wait for acknowledgements from every other core — slow.

The optimisation: each core has a small invalidate queue. Incoming invalidation messages are placed in the queue and acknowledged *immediately*. The local cache state is updated lazily, in the background. This decouples acknowledgement latency from cache-state update latency.

Cost: between receiving an invalidation and processing it, the local core sees stale Shared-state cache lines. A load may return a stale value.

`LFENCE` and `DMB ISHLD` drain the invalidate queue before subsequent loads.

### B.3 Memory order buffer (MOB)

Intel cores beyond about Pentium 4 implement the store buffer and the load buffer as parts of a single structure called the Memory Order Buffer (MOB), with combined retirement and ordering logic. The MOB handles:

- Speculative load reordering: a younger load can complete before an older load, provided that ordering rules are preserved on retirement.
- Load-store dependency checking: if a younger load reads from an address that an older still-pending store writes, store-to-load forwarding kicks in (or, if not possible, the load is squashed and replayed).
- Memory-order violation detection: if some external event would invalidate a speculative load's value (e.g. an invalidation arrives), the load is squashed and replayed. This is what makes TSO actually work on out-of-order cores.

You do not need to know MOB internals for any practical Go programming. They explain *why* TSO is fast in practice: the CPU is happily speculative-executing many memory operations, then validating ordering at retirement.

### B.4 Write-combining buffers

For non-temporal stores (`MOVNT*`) and stores to write-combining memory (used by graphics drivers, some network interfaces), Intel cores have a separate write-combining buffer. Stores accumulate in this buffer and are flushed to memory in larger units, bypassing the normal cache hierarchy.

`SFENCE` is the instruction that orders these. For normal Go programs, write-combining is irrelevant — Go uses normal write-back memory throughout. But you may see `SFENCE` in the Linux kernel or in graphics code.

### B.5 The cache line and false sharing

A cache line is 64 bytes on practically every modern CPU. The coherence protocol operates at line granularity: a write to byte 0 invalidates the whole 64-byte line everywhere else.

If two `atomic.Int32` values land on the same line and two goroutines write them concurrently, every write triggers the full coherence dance: each core must request the line in Modified state, the other core must invalidate its copy, and so on. The performance cost is dramatic — 50–200 cycles per access instead of 1.

To prevent this, pad hot atomics:

```go
type paddedCounter struct {
    n   atomic.Int64
    _   [56]byte // 64-byte line, 8 bytes for atomic.Int64, 56 bytes padding
}
```

We will see a benchmark of this in *optimize.md*.

---

## Appendix C: Reading Real `objdump` Output

Practical tip: when you suspect a barrier issue, dump the function in question and look at it. Here is the workflow:

```
$ go build -o myprog ./...
$ go tool objdump -s 'mypkg\.MyFunc' ./myprog | head -50
```

This prints the disassembly of any function whose name matches the regex. You will see:
- The architecture-specific instructions.
- Memory operations with the relevant addresses.
- Any `LOCK`, `XCHG`, `MFENCE`, `DMB`, `STLR`, `LDAR` instructions.

A typical reading session looks like:

1. Compile your program.
2. Identify the function that owns the suspect concurrent code.
3. Dump it.
4. For each atomic operation, identify the corresponding assembly: is it `LOCK XADD`? `XCHG`? `STLR`? `LDADDAL`?
5. Reason about ordering using the architecture's rules.
6. If something is missing, look at the Go source: is the variable actually `atomic.X`? Or is one path using plain access?

This is a *junior* skill. It is the cheapest debug technique for concurrent code, and it pays off massively. Train it.

---

## Appendix D: A Tour of `runtime/internal/atomic`

Although you cannot import `runtime/internal/atomic` from user code, it is useful to look at it as a model for what atomics look like in *practice*. Each architecture has its own assembly file: `atomic_amd64.s`, `atomic_arm64.s`, `atomic_riscv64.s`, `atomic_mips64x.s`, `atomic_ppc64x.s`, `atomic_wasm.s`, etc.

A few highlights from `atomic_amd64.s` (paraphrased):

```
TEXT runtime∕internal∕atomic·Load(SB), NOSPLIT, $0-12
    MOVQ ptr+0(FP), AX
    MOVL (AX), AX                  ; plain MOV — free acquire on x86
    MOVL AX, ret+8(FP)
    RET

TEXT runtime∕internal∕atomic·Store(SB), NOSPLIT, $0-12
    MOVQ ptr+0(FP), BX
    MOVL val+8(FP), AX
    XCHGL AX, (BX)                 ; XCHG = full barrier
    RET

TEXT runtime∕internal∕atomic·Cas(SB), NOSPLIT, $0-17
    MOVQ ptr+0(FP), BX
    MOVL old+8(FP), AX
    MOVL new+12(FP), CX
    LOCK
    CMPXCHGL CX, (BX)
    SETEQ ret+16(FP)
    RET
```

These are the bread-and-butter primitives. `sync/atomic` wraps similar code; the runtime calls these directly without the wrapping overhead.

On `arm64` the same primitives look like (paraphrased):

```
TEXT runtime∕internal∕atomic·Load(SB), NOSPLIT, $0-12
    MOVD ptr+0(FP), R0
    LDARW R1, (R0)
    MOVW R1, ret+8(FP)
    RET

TEXT runtime∕internal∕atomic·Store(SB), NOSPLIT, $0-12
    MOVD ptr+0(FP), R0
    MOVW val+8(FP), R1
    STLRW R1, (R0)
    RET

TEXT runtime∕internal∕atomic·Cas(SB), NOSPLIT, $0-17
    MOVD ptr+0(FP), R0
    MOVW old+8(FP), R1
    MOVW new+12(FP), R2
loop:
    LDAXRW R3, (R0)
    CMPW R3, R1
    BNE fail
    STLXRW R4, R2, (R0)
    CBNZ R4, loop
    MOVD $1, R0
    JMP done
fail:
    CLREX
    MOVD $0, R0
done:
    MOVB R0, ret+16(FP)
    RET
```

Notice the LL/SC pattern: `LDAXRW` loads the value and marks the cache line "monitored." `STLXRW` succeeds only if no other core has written to the line in between. If it fails, we loop and try again.

ARMv8.1 introduced the LSE extension with single-instruction atomics (`LDADD`, `SWP`, `CAS`, etc.). Modern Go runtimes choose between LL/SC and LSE based on the target CPU's capabilities.

---

## Appendix E: 30 Sentences You Should Be Able to Finish

Self-test: read each prompt, complete it from memory, then check against the file.

1. "A memory barrier is a CPU instruction that prevents …"
2. "The four reorderings are …"
3. "x86-TSO forbids three and allows …"
4. "The store buffer's purpose is to …"
5. "The invalidate queue's purpose is to …"
6. "On x86, `atomic.Store` compiles to …"
7. "On arm64, `atomic.Store` compiles to …"
8. "On x86, `atomic.Load` compiles to …"
9. "On arm64, `atomic.Load` compiles to …"
10. "`MFENCE` drains …"
11. "`LFENCE` drains …"
12. "`SFENCE` drains …"
13. "A `LOCK`-prefixed instruction is equivalent to …"
14. "`DMB ISH` is the ARM equivalent of …"
15. "`STLR` is a single-instruction …"
16. "`LDAR` is a single-instruction …"
17. "A release-store pairs with a/an …"
18. "An acquire-load pairs with a/an …"
19. "The Dekker litmus test demonstrates …"
20. "Cache coherence guarantees … but not …"
21. "MESI stands for …"
22. "A cache line is typically … bytes."
23. "False sharing happens when …"
24. "The race detector cannot replace …"
25. "On ARM, plain `LDR` and `STR` have …"
26. "Mixing atomic and plain access on the same variable …"
27. "64-bit atomics on 32-bit ARM require …"
28. "`runtime/internal/atomic` is …"
29. "Go's memory model declares a data race as …"
30. "If your test passes on x86 but fails on arm64, the likely cause is …"

---

## Appendix F: Going Deeper Without Drowning

If everything in this file has clicked, you can confidently move to *middle.md*. If parts of it felt fuzzy, that is fine — barriers are notoriously hard, and you should expect to re-read this file two or three times before everything settles.

Suggested path:

1. First pass: skim everything to absorb vocabulary.
2. Write a tiny program with `atomic.Store` and `atomic.Load`, run `go tool objdump`, identify the instructions. Do this on both `amd64` and `arm64` (use a Raspberry Pi 4, an Apple Silicon Mac, an AWS Graviton instance, or `GOOS=linux GOARCH=arm64 go build` if you only want the assembly — you do not need to run it).
3. Run `go test -race` on a deliberately broken example and observe the report.
4. Re-read sections 1–8 of this file with the assembly in front of you.
5. Move to *middle.md*.

The single biggest impediment to understanding barriers is treating them as magic. They are not. They are CPU instructions with precise semantics. Every minute spent staring at real disassembly pays back tenfold in concurrent programming confidence.

---

## Final Thoughts

Hardware barriers are the silicon-level promise that makes concurrent Go programs correct across all platforms. They are not visible in your source code, they are not even visible at the Go IR level — but they sit underneath every atomic operation, every channel send, every mutex unlock. The `sync/atomic` package is the contract Go offers you: "give me an `atomic.X`, and I will emit the right instructions on every platform, so that the Go memory model's release-acquire edges hold."

You do not need to understand microarchitectural buffers to *use* atomics. You do need to understand them to *debug* atomics, to *port* code across architectures, to *profile* concurrent hot paths, and to *read* the runtime source code.

The middle level continues with x86-TSO's formal model, ARMv8 acquire/release in detail, the runtime's exact instruction choices, and how to diagnose false sharing with perf counters. The senior level dives into RISC-V WMO, the MESI/MOESI protocols, and how to reason about correctness with the Herd7 tool. The professional level covers the most esoteric corners: non-temporal stores, RDTSC fencing, formal verification, and designing fence-free fast paths.

For now, you have the foundation. Use it.

---

## Appendix G: The Ten Most Important Sentences in This File

These ten sentences condense the entire junior-level material. If you remember nothing else, remember these.

1. **A memory barrier is a CPU instruction that prevents memory operations on either side of it from being reordered across it.**
2. **The four reorderings are LoadLoad, LoadStore, StoreStore, and StoreLoad; x86-TSO forbids the first three and allows only StoreLoad.**
3. **The store buffer makes single-core writes look fast by deferring propagation to cache; it is the reason StoreLoad reordering is observable.**
4. **The invalidate queue makes single-core reads look fast by deferring processing of remote invalidations; it is the reason weakly-ordered CPUs need acquire fences.**
5. **`MOV` on x86 already has acquire/release semantics for free, so `atomic.Load` and (sometimes) `atomic.Store` compile to a plain `MOV`.**
6. **`XCHG` and `LOCK`-prefixed RMW instructions on x86 are full barriers; Go uses them for `atomic.Store`, `atomic.Add`, `atomic.Swap`, `atomic.CompareAndSwap`.**
7. **ARM's `LDAR` and `STLR` are single-instruction acquire-load and release-store; ARM atomics typically use them instead of separate `DMB`.**
8. **Release pairs with acquire to create a happens-before edge; everything before the release on the writer is visible after the acquire on the reader.**
9. **Mixing atomic and non-atomic access to the same variable is a data race; the race detector catches it; the Go memory model declares the outcome undefined.**
10. **Test on at least one weakly-ordered architecture (`arm64`) before you ship; "works on amd64" is not a correctness argument.**

---

## Appendix H: Frequently Confused Pairs

The terminology around barriers is rich and often imprecise. Here are the most common confusions clarified.

### "Atomic" vs "Barrier"

- **Atomic** means *indivisible*: the operation appears to happen instantaneously to other threads. There is no intermediate state visible. Example: a 64-bit aligned store on amd64 is naturally atomic — no other thread can see half of it.
- **Barrier** means *ordered*: the operation has a defined ordering relationship to other operations. Example: a `MFENCE` does not touch memory itself; it constrains the order of surrounding accesses.

A `sync/atomic` operation is both: it is atomic *and* it is a barrier. But in principle the two are independent. Pure atomicity without barrier is called "relaxed atomic" in C++ (`memory_order_relaxed`); Go does not expose this directly.

### "Memory order" vs "Cache coherence"

- **Memory order** is the set of allowed orderings of operations to *different* memory locations. This is what fences address.
- **Cache coherence** is the protocol that ensures all caches eventually agree on the value at a *single* memory location. MESI is a coherence protocol.

Coherence is automatic on every cache-coherent CPU; you cannot turn it off. Memory order is configurable via fences. The two are orthogonal.

### "Visible" vs "Ordered"

- **Visible** means another thread, looking at memory, will see the value.
- **Ordered** means the relative position of this operation to others is constrained.

You can have visible-but-not-ordered: every store eventually becomes visible thanks to cache coherence, but without fences the *order* in which other threads see them is not constrained.

### "Acquire" vs "Read barrier"

- **Acquire** is a property of a *load*: subsequent operations cannot be reordered before it.
- **Read barrier** (or "load fence") is a *standalone* instruction that imposes LL ordering across it for surrounding loads.

A read barrier between two loads is functionally equivalent to making the second load an acquire. Most modern ISAs prefer the inline acquire-load form because it can be cheaper.

### "Release" vs "Write barrier"

- **Release** is a property of a *store*: prior operations cannot be reordered after it.
- **Write barrier** (or "store fence") is a *standalone* instruction that imposes SS ordering for surrounding stores.

Same pattern: modern ISAs prefer the inline release-store. **Note:** "write barrier" in the Go runtime refers to a *garbage collection* mechanism, not a memory barrier. Be careful not to confuse the two — `runtime/mwbbuf.go` is GC, not memory ordering.

### "Sequential consistency" vs "Total store order"

- **Sequential consistency (SC)** requires that the operations of all threads appear to execute in some global interleaving, with each thread's operations in program order. This is the strongest reasonable model.
- **Total store order (TSO)** is slightly weaker: stores from a single thread are seen in program order globally, but a thread may see its own store before other threads (via store-to-load forwarding). This is what x86 implements.

Practically, SC is what programmers wish for, TSO is what x86 gives them, and weak ordering is what ARM/RISC-V give them. Fences bridge the gap.

### "Compiler barrier" vs "Hardware barrier"

- **Compiler barrier** prevents the compiler from reordering memory operations across it. Implemented as compiler intrinsic — does not emit any instruction.
- **Hardware barrier** prevents the CPU from reordering memory operations across it. Emits an instruction (`MFENCE`, `DMB`, etc.).

You need both. Fortunately, `sync/atomic` operations are both compiler barriers and hardware barriers — the compiler knows about them, and they emit the necessary instructions.

---

## Appendix I: A Worked Litmus Test

Let us run through the classic *store-buffer* litmus test by hand, on x86-TSO. This is the canonical example of TSO's deviation from sequential consistency.

### The test

```
Initial: x = 0, y = 0

P0:                  P1:
  STORE x, 1          STORE y, 1
  LOAD  r0 = y        LOAD  r1 = x

Final: r0 == 0 AND r1 == 0?
```

### Sequential consistency analysis

Under SC, the operations interleave globally. Consider every interleaving:

1. P0's store, P0's load, P1's store, P1's load → r0=0, r1=1. NOT the bad outcome.
2. P0's store, P1's store, P0's load, P1's load → r0=1, r1=1. NOT.
3. P0's store, P1's store, P1's load, P0's load → r0=1, r1=1. NOT.
4. P1's store, P0's store, P0's load, P1's load → r0=1, r1=1. NOT.
5. ... (similar for the rest)

No SC interleaving produces `r0 == 0 && r1 == 0`. Under SC, the bad outcome is impossible.

### TSO analysis

Under TSO, each core has a store buffer. P0's store of `x = 1` may sit in P0's store buffer for a while; meanwhile P0's load of `y` proceeds. If P1's `y = 1` is also still in P1's buffer at that moment, P0 sees `y == 0`. Symmetrically for P1. Both buffers eventually drain, but by then both loads have already taken their stale values.

So TSO permits `r0 == r1 == 0`. The reordering is *store-then-load*, the StoreLoad case we keep returning to.

### How to forbid it

Insert a barrier between the store and the load on both sides:

```
P0:                   P1:
  STORE x, 1           STORE y, 1
  MFENCE               MFENCE
  LOAD  r0 = y         LOAD  r1 = x
```

`MFENCE` drains the store buffer. After it, the store has reached cache, the coherence machinery has invalidated the other core's stale copy, and the subsequent load sees the up-to-date value.

In Go, you achieve this by using `atomic.Store` for both writes and `atomic.Load` for both reads — though, for this specific anti-litmus, you also need `atomic.Store`'s full-barrier semantics rather than just release. This is why `sync/atomic.Store` is full-barrier on all platforms, not just release.

### How to run the test yourself

```go
package main

import (
	"runtime"
	"sync"
	"sync/atomic"
)

var (
	x, y         atomic.Int32
	violations   atomic.Int64
	iterations   = 10000000
)

func main() {
	runtime.GOMAXPROCS(2)
	for i := 0; i < iterations; i++ {
		x.Store(0)
		y.Store(0)
		var wg sync.WaitGroup
		wg.Add(2)
		var r0, r1 int32
		go func() {
			defer wg.Done()
			x.Store(1)
			r0 = y.Load()
		}()
		go func() {
			defer wg.Done()
			y.Store(1)
			r1 = x.Load()
		}()
		wg.Wait()
		if r0 == 0 && r1 == 0 {
			violations.Add(1)
		}
	}
	println("violations:", violations.Load(), "of", iterations)
}
```

Because we used `atomic.Store` (full barrier) and `atomic.Load` (acquire on every platform), `violations` should be zero. If you replace the atomics with plain access, you can observe non-zero violations on some platforms (and the race detector will scream).

This litmus test, in its many variants, is the basis for understanding any memory model. The McKenney book and the cat-style memory models compile down to enumerating which litmus tests are forbidden.

---

## Appendix J: Why Go Picked Sequential Consistency for `sync/atomic`

Go's `sync/atomic` is **sequentially consistent**: every atomic operation, on every platform, has the strongest ordering. This is a deliberate choice. C++11 and Rust expose weaker orderings (`memory_order_relaxed`, `memory_order_acquire`, etc.); Go does not.

Reasons for the choice:

1. **Simplicity.** Most application programmers do not need to reason about weak orderings. SC atomics behave like Java `volatile`, which generations of programmers already understand.
2. **Safety.** Weak orderings are extremely easy to misuse. A relaxed atomic that should have been release is the classic "I tested it and it worked" bug.
3. **Performance pragmatism.** On x86, SC atomics are essentially free for loads (`MOV` is acquire) and only slightly more expensive for stores (`XCHG` vs `MOV` + nothing). On ARM, `LDAR`/`STLR` cost about the same as ordinary load/store under low contention.
4. **Memory model clarity.** A small surface area is easier to specify correctly. The Go memory model document is shorter than the C++ one largely because of this choice.

The cost is some lost performance for advanced lock-free algorithms. If you really need relaxed atomics, you have to drop into assembly via `runtime/internal/atomic` (which is unavailable to user code) or write `.s` files yourself. In practice this is rarely worth doing.

---

## Appendix K: Common Junior-Level Mistakes Recapped

A short list to keep at hand:

1. Using a plain `bool` flag for cross-goroutine signalling.
2. Mixing `atomic.StoreInt32(&x, ...)` with plain reads of `x`.
3. Putting `atomic.Store` after the last write but reading the *data* with a plain load.
4. Assuming `runtime.Gosched()` synchronises anything (it does not, semantically).
5. Believing the race detector found everything (it only catches what your test exercised).
6. Padding atomics for false-sharing prevention but forgetting that two `int32`s on the same line still share.
7. Using `atomic.Pointer[T]` and then accessing fields of `*T` with plain reads. The acquire-on-load applies only to the pointer access, not to the dereference.
8. Calling `sync.Mutex.Lock()` in one goroutine and `Unlock()` from a different one. Legal in Go (Mutex is not goroutine-bound), but a common source of confusion.
9. Trying to "atomically read two variables." `sync/atomic` does not provide multi-word atomics; you need a mutex or a packed struct.
10. Using `unsafe.Pointer` casts to atomically access a `time.Time` or any struct larger than a machine word. Doesn't work.

---

## Appendix L: A Visual Recap

```
                    YOUR Go CODE
                         │
                         │  uses sync/atomic, sync.Mutex, channels
                         ▼
                  GO RUNTIME
            ┌──────────────────────┐
            │ sync/atomic           │
            │ runtime/internal/     │
            │   atomic (private)    │
            │ sync.Mutex / chan     │
            └──────────┬────────────┘
                       │  generates assembly per architecture
                       ▼
              MACHINE INSTRUCTIONS
       ┌──────────────────────────────┐
       │ amd64:  MOV, XCHG, LOCK ..., │
       │         MFENCE, LFENCE,      │
       │         SFENCE, CMPXCHG      │
       │ arm64:  LDR, STR, LDAR,      │
       │         STLR, DMB ISH/ISHST, │
       │         LDADDAL, CAS         │
       │ riscv64: LD, SD, FENCE,      │
       │          AMOSWAP.AQ.RL       │
       └──────────┬────────────────────┘
                  │  executed by
                  ▼
                 CPU
       ┌─────────────────────────┐
       │ pipeline (out-of-order) │
       │ store buffer            │
       │ invalidate queue        │
       │ L1 cache (MESI/MOESI)   │
       │ cache-coherent intercon-│
       │ nect to other cores     │
       └─────────────────────────┘
```

The Go programmer sees only the top layer. The bottom layer is what actually runs. The middle layer is what `sync/atomic` provides — the bridge that makes correct concurrent programs portable across very different CPUs.

---

That is everything for the junior level. Next file: `middle.md`.

---

## Appendix M: Walking Through a Real Disassembly

The best way to convince yourself that fences are real and present in your binary is to look at the assembly Go emits. You do not have to be able to write x86 or ARM assembly to read it — you just need to know where the boundaries are.

Here is a tiny program:

```go
package main

import (
    "sync/atomic"
)

var flag int32

//go:noinline
func storeFlag() {
    atomic.StoreInt32(&flag, 1)
}

//go:noinline
func loadFlag() int32 {
    return atomic.LoadInt32(&flag)
}

func main() {
    storeFlag()
    _ = loadFlag()
}
```

The directive `//go:noinline` prevents Go from inlining the wrappers, so we can see them as discrete functions in the object dump. Build it with the toolchain you have:

```
GOOS=linux GOARCH=amd64 go build -o /tmp/barrier-demo
go tool objdump -s storeFlag /tmp/barrier-demo
go tool objdump -s loadFlag /tmp/barrier-demo
```

On `amd64`, the store function dumps something like (cleaned up):

```
TEXT main.storeFlag(SB)
    MOVL    $1, AX
    XCHGL   AX, main.flag(SB)
    RET
```

There is the `XCHGL` instruction. `XCHG` with a memory operand is implicitly `LOCK`-prefixed in x86 (the CPU guarantees it). The `LOCK` prefix on `XCHG` is the *full barrier* on x86. So an `atomic.StoreInt32` of a 32-bit value compiles down to "exchange the register and the memory address" — one instruction, which is a full StoreLoad fence. This is why x86 atomic stores are slightly slower than plain `MOV` (typically 10–30 ns penalty vs 1–2 ns for a plain store).

The load function:

```
TEXT main.loadFlag(SB)
    MOVL    main.flag(SB), AX
    RET
```

Just a plain `MOVL`. No fence. Because x86 is **TSO** — Total Store Order — every load already has acquire semantics for free. The "expensive" part of a sequentially consistent atomic on x86 is the store side, not the load side.

Now switch architectures:

```
GOOS=linux GOARCH=arm64 go build -o /tmp/barrier-demo-arm64
go tool objdump -s storeFlag /tmp/barrier-demo-arm64
go tool objdump -s loadFlag /tmp/barrier-demo-arm64
```

On ARM64 the store function looks like:

```
TEXT main.storeFlag(SB)
    MOVD    $1, R0
    STLRW   R0, (R1)
    RET
```

`STLRW` is "Store-Release Word" — a single instruction that does the store **and** the release ordering in one step. ARMv8.0 introduced these. Before ARMv8 (and on some 32-bit ARM systems) you had to emit a `DMB ISHST` explicitly. Modern Go on `arm64` uses `STLR` because it is cheaper and more precise.

The load:

```
TEXT main.loadFlag(SB)
    LDARW   R0, (R1)
    RET
```

`LDARW` is "Load-Acquire Word." Again, acquire ordering encoded in the load instruction itself. The CPU guarantees that no younger memory operation (in program order) can move before this load.

Compare these two architectures side by side and you can see the difference between **TSO** (x86: free loads, expensive stores) and **multi-copy-atomic acquire/release** (ARM: balanced cost, every load and store carries its own ordering).

---

## Appendix N: A Hands-On Race Detector Exercise

Many junior Go programmers run `go test -race` once or twice and never look at the output. Let's slow down and read it carefully, because the race detector is the single most important tool for catching missing barriers in production Go.

Save this as `race_demo_test.go`:

```go
package racedemo

import (
    "sync"
    "testing"
)

var counter int

func TestUnsafeIncrement(t *testing.T) {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++ // intentional race
        }()
    }
    wg.Wait()
}
```

Run it:

```
go test -race -run TestUnsafeIncrement
```

The output will include something like:

```
WARNING: DATA RACE
Write at 0x... by goroutine 12:
  example.com/racedemo.TestUnsafeIncrement.func1()
      race_demo_test.go:14 +0x...

Previous write at 0x... by goroutine 8:
  example.com/racedemo.TestUnsafeIncrement.func1()
      race_demo_test.go:14 +0x...
```

What the race detector is telling you is: "two goroutines wrote to the same address with no happens-before relationship between them." Internally, the race detector instruments every load and store and tracks **vector clocks** for each goroutine. Each synchronization primitive in the Go runtime (mutex lock/unlock, channel send/recv, atomic operation) updates these clocks. If two accesses to the same address happen on different goroutines without a clock relationship, you get a race report.

Now fix the race:

```go
import "sync/atomic"

var counter int64

func TestSafeIncrement(t *testing.T) {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            atomic.AddInt64(&counter, 1)
        }()
    }
    wg.Wait()
}
```

Re-run with `-race`. No warnings. Why? Because `atomic.AddInt64` emits a `LOCK XADD` on x86 (or `LDADDAL` on arm64v8.1+, or a `LL/SC` pair on older ARM). The race detector understands these instructions are atomic and establishes a happens-before across them.

The lesson for juniors: **the race detector is not just a bug finder. It is a teacher.** Run your tests with `-race` early, and treat every warning as a hint that you forgot a barrier somewhere.

---

## Appendix O: A Short Tour Through `runtime/internal/atomic`

You cannot import this package as a user (it is internal to the runtime), but you should still glance at it. It lives at `$GOROOT/src/runtime/internal/atomic/` in your Go installation.

The file structure is:

```
atomic_amd64.s        — amd64 assembly stubs
atomic_arm64.s        — arm64 assembly stubs
atomic_riscv64.s      — risc-v assembly stubs
atomic_ppc64x.s       — POWER assembly stubs
atomic_386.s          — 32-bit x86 stubs
atomic_arm.s          — 32-bit ARM stubs
types.go              — Go type wrappers
types_64bit.go        — 64-bit only types
```

Open `atomic_amd64.s` and you'll see entries like:

```
TEXT ·Xchg(SB), NOSPLIT, $0-20
    MOVQ    ptr+0(FP), BX
    MOVL    new+8(FP), AX
    XCHGL   AX, 0(BX)
    MOVL    AX, ret+16(FP)
    RET
```

This is the implementation of `runtime/internal/atomic.Xchg`. It is plain assembly with no Go indirection. The user-facing `sync/atomic.SwapInt32` is a thin wrapper around it. So when you call `atomic.SwapInt32`, the actual sequence is:

```
sync/atomic.SwapInt32
   └─> runtime/internal/atomic.Xchg
         └─> XCHGL (amd64)
```

On `arm64` the same function compiles to a `SWPALW` (Swap-Acquire-Release Word, ARMv8.1+) or, on older cores, an `LDAXR`/`STLXR` loop.

This layering is why Go atomics work uniformly across architectures while being efficient on each: the runtime contains hand-written assembly per ISA, picked at link time based on `GOARCH`.

---

## Appendix P: Demonstrating Reordering Yourself (Litmus Test 2)

Appendix I covered store-buffer reordering. Here is another classic — the **load buffering (LB)** pattern. Two threads each load one variable then store to the other:

```
Initial: x = 0, y = 0

Thread A           Thread B
r1 = x             r2 = y
y = 1              x = 1

Forbidden under SC: r1 == 1 AND r2 == 1
```

Under sequential consistency, you cannot have both reads see the future stores. But on **ARM** (without DMB), this is observable in hardware — both reads can see the stores because the CPU is allowed to speculatively execute the load before the prior store retires.

On **x86-TSO**, this pattern is forbidden. TSO does not allow loads to be reordered *before* stores on the same core. (TSO only allows the reverse: a store buffered before a load.)

Let's write the Go demonstration:

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

var x, y int32

func litmusLB() {
    var r1, r2 int32
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        r1 = atomic.LoadInt32(&x)
        atomic.StoreInt32(&y, 1)
    }()
    go func() {
        defer wg.Done()
        r2 = atomic.LoadInt32(&y)
        atomic.StoreInt32(&x, 1)
    }()
    wg.Wait()
    if r1 == 1 && r2 == 1 {
        fmt.Println("LB violation!")
    }
}

func main() {
    for i := 0; i < 1_000_000; i++ {
        x, y = 0, 0
        litmusLB()
    }
    fmt.Println("done")
}
```

Because we are using `sync/atomic`, which is sequentially consistent on all Go platforms, you will never observe the violation. If you rewrote the code with `unsafe.Pointer` accesses to bypass the atomic ordering, you might see violations on ARM but not on x86.

The takeaway: the **memory model of the architecture** decides which interleavings are possible. Go's atomics paper over the differences and give you SC on all platforms.

---

## Appendix Q: A Cheat Sheet for Go Synchronisation Primitives

| Primitive | When to use | Barrier emitted (conceptually) |
|---|---|---|
| `sync/atomic.LoadXxx`  | Read one machine-word value safely | Acquire |
| `sync/atomic.StoreXxx` | Write one machine-word value safely | Release + StoreLoad (i.e. full) |
| `sync/atomic.AddXxx`   | Increment / decrement safely | Full (RMW) |
| `sync/atomic.CompareAndSwapXxx` | Lock-free compare-and-swap | Full (RMW) |
| `sync/atomic.SwapXxx`  | Lock-free exchange | Full (RMW) |
| `sync.Mutex.Lock`      | Mutual exclusion entry | Acquire |
| `sync.Mutex.Unlock`    | Mutual exclusion exit | Release |
| `sync.RWMutex.RLock`   | Reader entry | Acquire |
| `sync.RWMutex.RUnlock` | Reader exit | Release |
| `sync.WaitGroup.Wait`  | Wait until counter hits zero | Acquire |
| `sync.WaitGroup.Done`  | Decrement counter | Release |
| `chan` send            | Send a value | Release |
| `chan` recv            | Receive a value | Acquire |
| `close(ch)`            | Mark channel as closed | Release |
| `sync.Once.Do`         | Run once across goroutines | Acquire (for waiters), Release (for runner) |
| `runtime.Gosched`      | Hint to the scheduler | **NONE** (not a synchronisation point) |

Mistake spotting: `runtime.Gosched()` is *not* a barrier. It tells the scheduler "I'm willing to yield"; it does not establish any happens-before relation.

---

## Appendix R: How to Read a Memory-Model Litmus Diagram

Throughout this topic and in academic literature you will see diagrams like:

```
       Thread 1        Thread 2
       --------        --------
       x = 1           r1 = y
       y = 1           r2 = x
       
Initial: x = y = 0
Forbidden: r1 == 1 AND r2 == 0   (this is the "message passing" pattern)
```

Reading guide:

- **Initial** describes the state of variables at the start.
- The lines **inside** each thread are in **program order** (top to bottom).
- The **Forbidden** clause says: "under the model in question, this outcome must not occur."
- An **Allowed** clause says: the outcome is observable under the model.

This `MP` (message passing) pattern is the foundation of every signalling protocol. SC forbids the outcome. ARM and POWER allow it without explicit fences. x86-TSO forbids it too.

When working in Go you do not have to memorise the table — `sync/atomic` is SC everywhere. But understanding the diagrams lets you read research papers, the Linux kernel mailing list, and even Go runtime issues without getting lost.

---

## Appendix S: Worked Example — Building Your First Safe Flag

Let us pull everything together into a single, complete, runnable example. This is the kind of code you might write as a junior to coordinate a worker goroutine.

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

// Worker holds the cross-goroutine state for one worker.
type Worker struct {
    // shouldStop is set by the main goroutine to ask the worker
    // to finish at the next iteration. Reads and writes MUST go
    // through sync/atomic because the worker runs on a different
    // OS thread, possibly a different CPU core, with its own cache.
    shouldStop int32

    // processed counts how many items the worker has handled.
    // Same rule: cross-goroutine, so use atomics.
    processed int64
}

// Run is the worker's main loop. It exits when shouldStop becomes 1.
func (w *Worker) Run() {
    for atomic.LoadInt32(&w.shouldStop) == 0 {
        // Pretend we did work.
        time.Sleep(10 * time.Millisecond)
        atomic.AddInt64(&w.processed, 1)
    }
    fmt.Println("worker exiting cleanly")
}

// Stop asks the worker to stop. Returns immediately; the worker
// will notice on its next iteration.
func (w *Worker) Stop() {
    atomic.StoreInt32(&w.shouldStop, 1)
}

// Processed returns the current count of processed items.
func (w *Worker) Processed() int64 {
    return atomic.LoadInt64(&w.processed)
}

func main() {
    w := &Worker{}
    go w.Run()
    time.Sleep(100 * time.Millisecond)
    w.Stop()
    time.Sleep(50 * time.Millisecond) // let it print
    fmt.Println("final count:", w.Processed())
}
```

Things to notice line by line:

1. `shouldStop int32` — 32-bit because Go's `sync/atomic` requires word-aligned accesses, and 32-bit values are naturally aligned on every supported platform.
2. `atomic.LoadInt32` in the loop — establishes the acquire fence so the read sees whatever was published by `Stop`.
3. `atomic.StoreInt32(&w.shouldStop, 1)` — release fence so the write is visible to the worker's next load.
4. `atomic.AddInt64(&w.processed, 1)` — full barrier (RMW). This is safer than `processed++` because increment-from-multiple-goroutines is exactly the case where you need atomicity.
5. `time.Sleep` is **not** a barrier. It is a synchronisation point only because the runtime parks and unparks the goroutine; do not rely on its barrier semantics.

The pattern is rock-solid, portable across `amd64`/`arm64`/`riscv64`, and survives all the surprises this file has warned about.

---

## Appendix T: When You Have to Drop Down to `unsafe`

There are rare cases — most often in performance-critical libraries or in low-level systems code — where you cannot use `sync/atomic` directly because the value you want to update is not a primitive type. For example, you might want to atomically swap a pointer to a *struct*:

```go
package main

import (
    "sync/atomic"
)

type Config struct {
    Endpoint string
    Timeout  int
}

var cfg atomic.Pointer[Config]

func setConfig(c *Config) {
    cfg.Store(c) // release
}

func getConfig() *Config {
    return cfg.Load() // acquire
}
```

`atomic.Pointer[T]` (added in Go 1.19) is the safe way. It exposes typed atomic pointer operations and emits exactly the right fences. You should always prefer it to manual `unsafe.Pointer` gymnastics.

If you find yourself reaching for `unsafe.Pointer` and `atomic.LoadPointer`, ask whether you really need this. In almost every case you do not. The race detector will not save you if you bypass the type system.

---

## Appendix U: Anti-Patterns Specifically About Hardware Barriers

Below are concrete code shapes that should make you nervous. Each one is a real bug found in real Go codebases.

### U.1 The "I'll add atomic later" pattern

```go
type service struct {
    ready bool // TODO: make atomic
}

func (s *service) Init() {
    // ... setup ...
    s.ready = true
}

func (s *service) Handle() error {
    if !s.ready {
        return errors.New("not ready")
    }
    // ...
}
```

This will appear to work in tests. In production, on `arm64`, on a busy machine, one out of ten thousand calls to `Handle` will see `ready == false` even after `Init` returned. Fix it now, not later.

### U.2 The "double-checked init without barrier" pattern

```go
type cache struct {
    once *sync.Once // pointer, not value!
    data map[string]string
}

func (c *cache) Get(k string) string {
    if c.once == nil {
        c.once = &sync.Once{}        // race!
    }
    c.once.Do(func() { c.load() })
    return c.data[k]
}
```

Two problems: the `if c.once == nil` check is racy, and the pointer assignment is also racy. Use `sync.Once` as a value field, not a pointer, and let the language do the work:

```go
type cache struct {
    once sync.Once
    data map[string]string
}

func (c *cache) Get(k string) string {
    c.once.Do(func() { c.load() })
    return c.data[k]
}
```

### U.3 The "I'll use a channel as a flag and read the channel field directly"

```go
type worker struct {
    done chan struct{}
}

func (w *worker) Done() bool {
    select {
    case <-w.done:
        return true
    default:
        return false
    }
}
```

This is fine — the `select` against the channel is a proper synchronisation point. The mistake people make is doing `len(w.done) > 0` instead, which is a plain field read and has no ordering guarantees with respect to whoever closed the channel.

### U.4 The "I wrote my own spinlock without LOCK"

```go
type spin struct {
    state int32
}

func (s *spin) Lock() {
    for s.state != 0 { // plain read!
        runtime.Gosched()
    }
    s.state = 1 // plain write!
}
```

This is broken in three ways: the read is not atomic, the write is not atomic, and there is no `CompareAndSwap` ensuring exclusivity. Even on x86 (TSO) this will allow two goroutines into the critical section. Use `sync.Mutex` or, if you really must spin, use `atomic.CompareAndSwapInt32`.

---

## Appendix V: A Final Self-Assessment

If you can answer the following questions out loud without looking things up, you have absorbed the junior material on hardware barriers:

1. Why does a CPU have a store buffer?
2. What does an "invalidate queue" do, and why does it exist?
3. Name the four fence types and give one CPU instruction that implements each (on either x86 or ARM).
4. Why is `MOV` on x86 already an acquire fence, but `STR` on ARM is not?
5. What is the difference between a *compiler* fence and a *CPU* fence?
6. If goroutine A does `atomic.StoreInt32(&flag, 1)` and goroutine B does `atomic.LoadInt32(&flag)`, what specific instructions does the Go runtime emit on `amd64`? On `arm64`?
7. Is `runtime.Gosched()` a barrier?
8. Why does Go's `sync/atomic` give you sequential consistency on every platform, even when the hardware would allow weaker orderings?
9. What is the race detector actually measuring?
10. If you replace `atomic.LoadInt32` with a plain field read, why does the program "work" on x86 but break on ARM?

If any of these are still hazy, re-read the relevant section. The middle file assumes you can answer all ten without hesitation.

---

## Appendix W: Glossary Recap (Quick Lookup)

- **Barrier / Fence:** A CPU instruction that constrains the order of memory operations across it.
- **Store buffer:** Per-CPU FIFO of pending writes that have not yet hit cache.
- **Invalidate queue:** Per-CPU FIFO of cache-line invalidation messages waiting to be applied.
- **TSO (Total Store Order):** The x86 memory model. Loads can pass earlier stores to *different* addresses, but nothing else.
- **MCA (Multi-Copy Atomic):** A memory model where, once a store is visible to one observer, it is visible to all. ARMv8.0+ is "other-multi-copy-atomic"; POWER is **not** multi-copy-atomic.
- **Weak Model:** Any model where program order does *not* automatically match observed memory order. ARM, POWER, RISC-V are weak (each in different ways).
- **Sequential Consistency (SC):** The strongest reasonable model: every operation appears to execute in some global total order that respects per-thread program order. Go's `sync/atomic` gives you SC.
- **Acquire / Release:** Half-fences. Acquire on a load: no younger op can move before. Release on a store: no older op can move after.
- **LOCK prefix (x86):** Turns an instruction into an atomic, full-barrier operation.
- **DMB (ARM):** Data Memory Barrier — full fence between memory operations.
- **DSB (ARM):** Data Synchronization Barrier — stronger than DMB; waits for everything to complete (used in OS code).
- **ISB (ARM):** Instruction Synchronization Barrier — flushes the instruction pipeline; not a data fence, used for self-modifying code.
- **FENCE (RISC-V):** Configurable fence with predecessor/successor sets like `fence rw,rw`.

---

## Appendix X: Where to Go Next

After absorbing this file, the natural reading order is:

1. `middle.md` in the same directory — covers acquire-release in detail, lock-free queues, and how Go's `sync.Mutex` uses futex under the hood.
2. `senior.md` — RISC-V WMO, POWER, x86-TSO axioms, Linux kernel `smp_mb()` family.
3. `professional.md` — formal models, compiler intrinsics, GC interaction with hardware barriers, performance benchmarks across ISAs.

Then move to topic `22/02-acquire-release` for the next sub-topic. The whole `Memory Ordering Barriers` tree (`22-memory-ordering-barriers`) covers the wider memory-model story; this `01-hardware-barriers` file is just the foundation.

Happy fencing.

---

## Appendix Y: A Tour of `go tool compile -S`

Sometimes you want to see the actual instructions Go emits without dropping out to `objdump`. The `compile -S` flag prints the Go-internal "Plan 9-flavoured" assembly directly:

```
go tool compile -S -N -l snippet.go > snippet.s
```

`-N` disables optimisation, `-l` disables inlining. The resulting `snippet.s` is enormous but greppable. Here is what an `atomic.StoreInt32` shows up as on `amd64`:

```
0x0018 00024 (snippet.go:9)  MOVL    $1, AX
0x001d 00029 (snippet.go:9)  XCHGL   AX, (CX)
```

And on `arm64`:

```
0x0018 00024 (snippet.go:9)  MOVD    $1, R0
0x001c 00028 (snippet.go:9)  STLRW   R0, (R1)
```

Notice the difference between Go's Plan 9 assembly mnemonics and "real" assembly mnemonics. `MOVL` in Plan 9 is "move long" (32 bits); in Intel syntax it would be `MOV` with a 32-bit register operand. Plan 9 syntax originated at Bell Labs and is what the Go compiler uses internally, but the *meaning* and the *machine instructions* are exactly what they say on the tin.

Three quick reading rules:

1. **Operands go left-to-right, source-to-destination.** `XCHGL AX, (CX)` means "exchange AX with the memory at address CX." This is the opposite of Intel syntax but the same as AT&T syntax.
2. **Suffix letters tell you the operand size.** `B` = byte, `W` = word (16 bits in Plan 9), `L` = long (32), `Q` = quad (64). `MOVQ` is a 64-bit move.
3. **Special prefixes are spelled out.** Instead of writing `LOCK XCHG`, the Go assembler emits `LOCK ; XCHGQ` or relies on the fact that `XCHG` with a memory operand is implicitly locked.

The first time you read Plan 9 assembly you will trip over the operand order. After half an hour it stops bothering you.

---

## Appendix Z: A Concrete Walk Through One Bug

Here is a real bug, simplified from a real production incident I have personally chased. The symptom: a metric counter occasionally reads "zero items processed" even though clearly thousands have been processed. The code was:

```go
type counter struct {
    started bool
    n       int64
}

func (c *counter) Start() {
    c.started = true
}

func (c *counter) Inc() {
    if c.started {
        c.n++
    }
}

func (c *counter) Read() int64 {
    return c.n
}
```

Three goroutines were involved:

- Goroutine A called `Start` once at boot.
- Goroutines B1..Bn called `Inc` in a tight loop.
- Goroutine C called `Read` once per second to publish the metric.

The "zero items" report came from goroutine C, even though B-goroutines had clearly been incrementing for many seconds.

What was going wrong:

1. `c.started = true` is a plain write. There is no fence after it. Even though `Start` returned, the write might still sit in the store buffer of CPU 0 for many microseconds.
2. `if c.started` is a plain read. CPU 1 (running a B-goroutine) caches its own view of `c.started`. Until something invalidates that cache line, the B-goroutine sees `false` and never enters the increment block.
3. `c.n++` is a plain RMW. Even when finally entering the block, multiple B-goroutines race on `n`, losing updates.
4. `c.Read` is a plain read of `c.n` — yet again, no fence, so the metric goroutine sees whatever happens to be in *its* L1 cache.

The fix:

```go
type counter struct {
    started int32
    n       int64
}

func (c *counter) Start() {
    atomic.StoreInt32(&c.started, 1)
}

func (c *counter) Inc() {
    if atomic.LoadInt32(&c.started) == 1 {
        atomic.AddInt64(&c.n, 1)
    }
}

func (c *counter) Read() int64 {
    return atomic.LoadInt64(&c.n)
}
```

Three changes:

- `started` is `int32` and uses `atomic.LoadInt32`/`atomic.StoreInt32`. Now `Start` releases the write through a barrier and `Inc` acquires it through a barrier.
- `n` is `int64` and uses `atomic.AddInt64` for the RMW. No more lost updates.
- `Read` uses `atomic.LoadInt64`. The metric goroutine now sees a value that is at least as recent as some store committed by some B-goroutine.

There are still subtle properties to worry about (`Read` is not "totally ordered" with `Inc` in the sense that you might miss a partial update), but the metric never reads zero when it should be nonzero. The bug was a textbook missing-fence problem, and the fix was textbook atomic-fence application.

Lesson: any cross-goroutine shared field that is read or written without a synchronisation primitive (`sync/atomic`, `sync.Mutex`, channel) is a bug, even if your tests pass. The race detector would have flagged this immediately.

---

## Appendix AA: Three Mental Exercises

Try to answer these without running code. Solutions are at the end of the section.

### Exercise 1

```go
var a, b int32

func t1() {
    atomic.StoreInt32(&a, 1)
    _ = atomic.LoadInt32(&b)
}

func t2() {
    atomic.StoreInt32(&b, 1)
    _ = atomic.LoadInt32(&a)
}
```

If `t1` and `t2` run concurrently, is it possible for **both** loads to read `0`?

### Exercise 2

```go
var ready int32
var data int

func producer() {
    data = 42
    atomic.StoreInt32(&ready, 1)
}

func consumer() {
    for atomic.LoadInt32(&ready) == 0 {
        // spin
    }
    fmt.Println(data)
}
```

Is the consumer guaranteed to print `42`? If yes, why? If no, why?

### Exercise 3

```go
var x int32

func t1() {
    atomic.StoreInt32(&x, 1)
}

func t2() int32 {
    return atomic.LoadInt32(&x)
}
```

What instruction sequence does `t1` compile to on `amd64`? On `arm64`? On `riscv64`?

### Solutions

**Exercise 1.** Under sequential consistency (which Go's `sync/atomic` provides), no — at least one of the loads must observe the other thread's store. The "both zero" outcome is forbidden. On bare x86-TSO it is *allowed* (this is the classic store-buffering pattern), but Go's atomic store inserts a `LOCK XCHG`, which acts as a `StoreLoad` barrier, ruling it out.

**Exercise 2.** Yes. The release on `atomic.StoreInt32` plus the acquire on `atomic.LoadInt32` establishes a happens-before relationship between the write to `data` and the read of `data`. The consumer will print `42`. (This is the classic "Dekker / publish-once" pattern and is the bread-and-butter use of release/acquire.)

**Exercise 3.**

- amd64: `MOVL $1, AX; XCHGL AX, (mem)`
- arm64: `MOVD $1, R0; STLRW R0, (mem)`
- riscv64: `ADDIW T0, ZERO, 1; AMOSWAP.W.AQ.RL ZERO, T0, (mem)` (or `SW` followed by `FENCE rw,rw` on older cores)

If you got 1 of 3 right, re-read the architecture sections. If you got 2 of 3, you are at the lower edge of "junior solid." If you got 3 of 3, you are ready for the middle file.

---

## Appendix AB: The Cost Profile of Atomic Operations

A short table you can mentally carry around. All numbers are *rough orders of magnitude* on a modern x86 server (Skylake-class) and a modern arm64 server (Graviton 3-class). Real numbers vary by microarchitecture, contention level, and cache state.

| Operation | x86 (ns) | arm64 (ns) |
|---|---|---|
| Plain load (cached) | 1 | 1 |
| Plain store (cached) | 1 | 1 |
| `atomic.Load`        | 1 | 2 |
| `atomic.Store`       | 10–20 | 4–8 |
| `atomic.Add`         | 10–20 | 4–8 |
| `atomic.CompareAndSwap` (success) | 15–25 | 5–10 |
| `atomic.CompareAndSwap` (fail, retry) | 30+ | 15+ |
| `sync.Mutex.Lock` (uncontended) | 15–25 | 10–15 |
| `sync.Mutex.Lock` (contended)   | 1000+ (futex syscall) | 1000+ |
| Channel send/recv (uncontended) | 50–80 | 50–80 |

Two takeaways:

1. **`atomic.Load` is essentially free.** Use it freely.
2. **`atomic.Store`, `Add`, `CAS` all cost the same.** They all become a single `LOCK`-prefixed instruction. The marginal cost of using `Add` vs `Store` is zero — choose based on semantics, not micro-performance.

The interesting cliff is **contention.** An uncontended mutex is fine. A contended mutex calls into the kernel via `futex` and costs 1000+ ns. This is why people reach for atomics instead of mutexes when they have a small hot field — but the right answer is almost always "use the mutex unless you have profiled and found it as a bottleneck."

---

## Appendix AC: Where the Race Detector Fits Into Your Workflow

A short pragmatic guide for juniors:

1. **Always run unit tests with `-race` locally.** Make this a habit.
2. **Run integration tests with `-race` in CI.** The cost is roughly 2x slowdown and 5x memory; usually fine for CI.
3. **Do not deploy `-race` to production.** The slowdown is real, and the race detector itself has bugs in extreme cases.
4. **Treat race reports as P0 bugs.** Even if the test "happens to pass" most of the time, a race is undefined behaviour and will eventually corrupt your program in production.
5. **Read race reports carefully.** The stacktrace shows both racing accesses, and the line numbers are exact.

If you do all of this, the vast majority of missing-barrier bugs will never reach production.

---

That is, truly, everything for the junior level. The next file, `middle.md`, will assume you have absorbed it.

---

## Appendix AD: Reordering By Whom — Compiler vs CPU vs Cache

A common confusion at the junior level is: when people say "the program got reordered," who did the reordering? There are at least three distinct actors, and all three are doing it independently. Knowing which is which makes you a more precise communicator.

### AD.1 The Compiler

Long before the CPU sees your code, the Go compiler can rearrange independent operations. Consider:

```go
a := compute1()
b := compute2()
c := a + b
```

If `compute1` and `compute2` have no dependencies, the compiler can compute them in either order. Within a single goroutine this is invisible. Across goroutines it can be ruinous if `compute2` happened to set a flag that another goroutine was waiting on.

To prevent the compiler from moving things across a barrier, the Go compiler treats every `sync/atomic`, `sync.Mutex`, and channel operation as an **opaque function call** that may read and write any memory. This is the "compiler barrier" part of the fence. Even on a hypothetical CPU with no reordering, this part still matters.

### AD.2 The CPU's Out-Of-Order Engine

Inside a modern CPU core, the front end issues instructions in program order, but the back end has dozens of execution units that pick up whichever instructions have their operands ready first. So the *physical* execution order can be wildly different from the *architectural* program order. The CPU maintains a "reorder buffer" that lets it retire instructions in order, preserving the illusion that they ran sequentially — but only as far as a single core can see. Other cores can observe the side effects in a different order.

### AD.3 The Cache Hierarchy

Even after the CPU has retired a store, the store sits in the per-core **store buffer** until it migrates to L1 cache. Other cores see the store only when their L1 receives the corresponding cache-coherence message (typically MESI: Modified/Exclusive/Shared/Invalid transitions). The latency between "core 0 retires the store" and "core 1 sees the store" can be tens to hundreds of cycles. This is where the most surprising reorderings come from — they happen *after* both compilers and CPUs have done their part.

### AD.4 What a Fence Does to All Three

A full barrier:

- Tells the **compiler** "do not move any memory operation past this point."
- Tells the **CPU back end** "do not let any subsequent instruction execute until all prior memory ops have left the store buffer."
- Tells the **cache subsystem** "ensure pending invalidations are processed before the next load."

This is why fences are expensive: they force all three layers to synchronise.

---

## Appendix AE: A Note on `volatile` (and Why Go Doesn't Have It)

Programmers coming from C and C++ ask: "Where is Go's `volatile`?" The answer is that Go intentionally does not have one, and the reasoning is interesting.

In C, `volatile` was originally designed for memory-mapped I/O (MMIO) and signal handlers. It tells the compiler not to optimise away or reorder accesses to a variable. But `volatile` was **never** a thread-synchronisation primitive in C — it gives you no fence semantics, no atomicity. People misused it for that purpose for two decades, and the C11 / C++11 memory models replaced it with the `<atomic>` header.

Java's `volatile` is different — it *is* a full SC primitive, and Go's `sync/atomic` is essentially the Go equivalent. So if you are thinking "Java volatile," you want `sync/atomic`. If you are thinking "C volatile for MMIO," Go does not give you a portable way to do that and discourages MMIO from user code anyway.

The single Go feature that comes closest to C's `volatile` is `unsafe.Pointer` accesses through `runtime/internal/atomic.LoadPointer`, but as noted earlier, this is not user-importable. The right move is to use `sync/atomic` types directly: `atomic.Int32`, `atomic.Int64`, `atomic.Pointer[T]`, etc.

---

## Appendix AF: Closing Mental Model — Three Sentences

If you have to summarise this entire file in three sentences to a co-worker, here is one acceptable rendering:

1. CPUs reorder memory operations for performance, and Go's `sync/atomic`, `sync.Mutex`, and channels insert the architecture-appropriate fences to make those reorderings invisible to your goroutines.
2. On x86-TSO the fences are mostly free for loads and a `LOCK`-prefixed instruction for stores; on ARM and RISC-V they are encoded as `LDAR`/`STLR` (acquire/release) or explicit `DMB`/`FENCE`.
3. As long as every cross-goroutine field uses `sync/atomic` (or a mutex/channel), your Go program is portably correct on every supported architecture — but a single plain access to a shared variable is undefined behaviour, and the race detector exists precisely to catch it.

Memorise these. Repeat them. They are the seed crystal around which all the rest of this knowledge grows.

---

End of `junior.md`.

---

## Appendix AG: Looking at One Real Production Trace

The earlier appendices used simplified bug reports. Here is a slightly more realistic snippet, redacted from a production trace that the author has personally seen. Setting: a high-volume API service running on `arm64` (AWS Graviton 2), Go 1.21, ~2k requests per second.

Symptom: a single warning line appears in logs roughly every 4 hours: `"requestID is empty"`. The line is supposed to be unreachable; the request ID is set near the top of every handler.

Initial code:

```go
type ctxKey struct{}

type RequestContext struct {
    RequestID string
}

func WithRequestContext(ctx context.Context, rc *RequestContext) context.Context {
    return context.WithValue(ctx, ctxKey{}, rc)
}

func FromContext(ctx context.Context) *RequestContext {
    rc, _ := ctx.Value(ctxKey{}).(*RequestContext)
    return rc
}

// In each handler:
func handle(ctx context.Context, w http.ResponseWriter, r *http.Request) {
    rc := &RequestContext{RequestID: r.Header.Get("X-Request-ID")}
    ctx = WithRequestContext(ctx, rc)

    // ... pass ctx down through many layers ...
    audit(ctx)
}

func audit(ctx context.Context) {
    rc := FromContext(ctx)
    if rc == nil || rc.RequestID == "" {
        log.Println("requestID is empty")  // appears every 4 hours
        return
    }
    // ...
}
```

What could go wrong? `context.Context` is immutable and goroutine-safe — that's documented and audited. Yet the assertion fails.

The culprit, after a week of investigation: a third-party middleware further down the chain was storing the pointer `rc` in a global map indexed by trace ID, and a *separate* goroutine was reading it to attach to spans. That separate goroutine was doing:

```go
var idsByTrace map[string]*RequestContext // !

func attach(trace string) {
    rc := idsByTrace[trace] // unsynchronised map read
    // ... use rc.RequestID ...
}

func remember(trace string, rc *RequestContext) {
    idsByTrace[trace] = rc // unsynchronised map write
}
```

The map is read and written concurrently with no fence and no mutex. On `arm64`, the map header (a `*hmap`) can be observed in a partially-initialised state. Sometimes the bucket array pointer is non-nil but the bucket itself is still in another core's store buffer; the read pulls a zero value out, and `rc.RequestID` is the zero string.

This bug would have been caught immediately by `go test -race`. The team had no race tests on the middleware. The fix was to replace the map with `sync.Map`, which uses atomics internally.

Two lessons:

1. The bug had nothing to do with the obvious code (`audit`, `FromContext`). It was buried two layers deep.
2. `-race` is your friend even — especially — when the failure is rare. "Once every 4 hours at 2k rps" is *constant* on the timescale that matters.

---

## Appendix AH: A Short Quiz to End

Five rapid-fire questions. Answer in your head, then check.

**Q1.** True or false: on x86, you never need an explicit `MFENCE` because every memory operation is already a fence.

**A1.** False. Loads are acquire and stores in some forms are release, but `MFENCE` (StoreLoad) is required when you need a store followed by a load to *not* be reordered, and only `LOCK`-prefixed instructions or `MFENCE` provide that. The Go runtime relies on this; user code rarely uses `MFENCE` directly because `sync/atomic.Store` already includes a `LOCK XCHG`.

**Q2.** Why does `STLR` on ARM cost less than `DMB + STR`?

**A2.** `STLR` couples the release ordering to the store itself, so the CPU only needs to ensure that no younger memory op moves past *this specific* store, rather than a full bidirectional fence. `DMB + STR` is a heavier bidirectional barrier and a separate store, two instructions, with broader ordering implications. Empirically, `STLR` is roughly 2–4x faster than `DMB ISH + STR` on the same arm64 core.

**Q3.** In `runtime/internal/atomic`, what is the difference between `Store` and `StoreRel`?

**A3.** `Store` is sequentially consistent — on x86 it uses `XCHG` (full barrier), on arm64 it uses `STLR` then `DMB` if needed. `StoreRel` is release-only — on arm64 it just uses `STLR`. The runtime can use the cheaper release-only form internally when it knows full SC is not required. User code via `sync/atomic` only ever gets the full SC form.

**Q4.** Why does Go's `sync.WaitGroup.Wait` count as an acquire?

**A4.** Because `Wait` reads the counter (via atomic) and only returns when it observes the counter at zero — implying that every `Done` (which decremented the counter) happened-before this read. That happens-before relation requires acquire semantics on the read.

**Q5.** On `riscv64`, what fence does Go emit for `atomic.StoreInt32`?

**A5.** It emits an `AMOSWAP.W.AQ.RL` — an atomic memory operation with both acquire and release ordering. This is the RISC-V equivalent of a full barrier on the store side. Older Go versions used a separate `FENCE rw,rw` plus `SW`, which is also valid but less efficient.

---

## Appendix AI: A Final Word From the Pragmatic Side

This file is long. The actual day-to-day takeaway can be condensed to one rule:

> **Any field that more than one goroutine touches must be accessed exclusively through `sync/atomic`, a `sync.Mutex`, or a channel. No exceptions.**

If you follow that rule, you never have to think about hardware barriers in your own code. You can read the rest of this topic as background material — useful for code review, for debugging, for systems programming — but the rule above is what keeps your production code correct.

The deeper file `middle.md` will assume you have this rule wired in as a reflex.

---

## Appendix AJ: GC Write Barriers Are Not CPU Memory Barriers

A subtle point that confuses juniors and even some seniors: Go has *two* completely different things called "barriers" in its runtime, and they have nothing to do with each other.

1. **CPU memory barrier (hardware fence):** what this entire file is about. An instruction like `LOCK XCHG`, `MFENCE`, `DMB ISH`, or `FENCE rw,rw`. Constrains the order in which memory operations become visible across CPU cores.

2. **GC write barrier:** a piece of code the Go compiler inserts *before* every pointer write in heap memory. It exists so the garbage collector can run concurrently with the mutator (your program) without losing track of pointers. It looks roughly like:

```go
// Pseudocode for what happens on `obj.field = newValue`
gcWriteBarrier(&obj.field, newValue)
obj.field = newValue
```

The GC write barrier is *software*; it is conceptually a function call (although Go inlines it heavily for performance). It does *not* emit a CPU memory fence. It is unrelated to cross-CPU ordering. Its job is to inform the GC: "I'm about to overwrite a pointer, please record this so I don't lose track of what it used to point to (for snapshot-at-the-beginning correctness)."

People sometimes hear "Go has write barriers" and think Go is doing something special for cross-CPU ordering. It isn't, beyond what `sync/atomic` already provides. The GC write barrier is a *coordination protocol with the garbage collector*, not a *coordination protocol with other CPU cores*.

The two share a name because both "guard" memory writes in some abstract sense, but architecturally they are distinct. The professional file goes much deeper into the GC write barrier; the junior takeaway is just "they exist and are not the same thing."

---

## Appendix AK: Why You Should Care Even Though Go "Just Works"

A reasonable junior could ask: "If Go's `sync/atomic` gives me sequential consistency on every architecture, and I always use a mutex or channel for shared state, why do I need to understand hardware barriers at all?"

There are at least four answers.

1. **Bug diagnosis.** When a colleague's code goes wrong on `arm64` but not `amd64`, you need vocabulary to discuss the bug. "On ARM you don't have TSO, so the store-buffering pattern allows reorderings that x86 forbids" is a sentence that takes thirty seconds to say and saves hours of debugging.

2. **Code review.** You'll see patches that subtly mix `atomic` and plain accesses, and you need to spot them. If you don't know that a plain read of an atomic field is broken on weak architectures, you'll wave it through.

3. **Performance.** Some lock-free algorithms can be made dramatically faster by understanding which barriers can be omitted. The middle and senior files will show you exactly how.

4. **Talking to other communities.** Linux kernel, Java, C++, and Rust developers all live with explicit memory ordering. If you want to understand their code, blog posts, or research papers, you need the vocabulary.

So even though daily Go usage doesn't require this knowledge, the moments it matters are pivotal: a 4 am bug, a 0.5 ms latency improvement, a code review that catches a future production fire. Worth the time.

---

## Appendix AL: A Reading List in Order

If you want to extend this knowledge in a structured way, read in this order:

1. **Russ Cox, "Hardware Memory Models"** (research.swtch.com). Two-part essay. Outstanding introduction.
2. **Russ Cox, "Programming Language Memory Models"** (same series). Continues from hardware to language-level models.
3. **The Go Memory Model specification** (go.dev/ref/mem). Short, official, occasionally subtle.
4. **Hans Boehm, "Threads Cannot Be Implemented as a Library"** (HP Labs). The paper that killed `volatile`-for-threads in C/C++ and pushed the industry toward `<atomic>`.
5. **Sewell et al., "x86-TSO: A Rigorous and Usable Programmer's Model for x86 Multiprocessors"**. The definitive formal model of x86 memory ordering.
6. **Maranget, Sarkar, Sewell, "A Tutorial Introduction to the ARM and POWER Relaxed Memory Models"**. The companion paper for weak architectures.
7. **McKenney, "Is Parallel Programming Hard, And, If So, What Can You Do About It?"** (free PDF, perfbook). Long but the gold standard.
8. **Vyukov's writings** (1024cores.net, archived). The single best treatment of lock-free queues.

You don't need to read all of these to write correct Go. You do need to be aware they exist, and to look up the one you need when you find yourself in unfamiliar territory.

---

## Appendix AM: One Last Bug-Hunt Walkthrough

Let me end with a single, fully-worked debugging session. Imagine you receive this bug report:

> "On our `arm64` workers, the metric for `requests_in_flight` occasionally goes negative. On `amd64` it never does. Code in `metrics.go`. Please fix."

You open `metrics.go`:

```go
var inFlight int64

func handleRequest() {
    inFlight++
    defer func() { inFlight-- }()
    // ...
}

func currentInFlight() int64 {
    return inFlight
}
```

Diagnosis steps:

1. **First red flag:** `inFlight` is read and written from multiple goroutines (each request handler runs concurrently) without `sync/atomic` or a mutex. This is a data race.

2. **Why `arm64` and not `amd64`?** On `amd64`, individual 64-bit aligned reads and writes are *implicitly* atomic (the CPU never tears them). So the race is invisible-ish; the worst you see is lost updates. On `arm64`, 64-bit reads and writes are still atomic if aligned, but the memory ordering is weaker. Reading `inFlight` mid-update from another core can return a value that looks "back in time" relative to other goroutines' views, causing the negative count.

3. **Run `go test -race`.** Confirmed: data race on `inFlight`.

4. **Fix:**

```go
var inFlight atomic.Int64

func handleRequest() {
    inFlight.Add(1)
    defer inFlight.Add(-1)
    // ...
}

func currentInFlight() int64 {
    return inFlight.Load()
}
```

5. **Verify:** rerun the workload on `arm64`. No more negative values. Run `go test -race`. Clean.

What happened? Every `inFlight++` is read-modify-write: load, increment, store. Two goroutines racing on this pattern can:

- T1 loads 5.
- T2 loads 5.
- T1 stores 6.
- T2 stores 6.
- One increment was lost.

The mirror image happens on decrement. If you lose two increments and gain none on the decrement side, the count goes negative. On `amd64` the *visibility* of each step happens to make this rarer; on `arm64` the relaxed ordering exposes it. The bug existed on both platforms; only the *frequency of observation* differed.

This is the textbook story for "works on x86, fails on ARM." It is also the textbook story for "always use atomics for cross-goroutine counters, regardless of platform."

---

End — for real this time.

---

## Appendix AN: Vocabulary Drill

A drill you can do on a long walk or in the shower. Define each of these terms in one sentence, out loud, without looking:

- Memory barrier
- Store buffer
- Invalidate queue
- LoadLoad / LoadStore / StoreLoad / StoreStore fence
- Acquire / release
- Sequential consistency
- TSO
- LOCK prefix
- `XCHG`
- `MFENCE`
- `LDAR` / `STLR`
- `DMB ISH`
- RVWMO
- `FENCE rw,rw`
- Happens-before
- Data race
- Cache line
- False sharing
- MESI / MOESI
- Race detector
- `runtime/internal/atomic`
- `sync/atomic`
- `sync.Mutex`
- `sync.Once`

If you fluffed on five or more, re-read the glossary and the architecture sections. If you got them all, you are well above the junior bar. Most of these come up again in `middle.md` with more depth, so don't worry if your one-sentence answer isn't perfect.

---

## Appendix AO: One More Closing Mental Image

Picture an enormous open-plan office, with hundreds of desks. Each desk is a CPU core. Each person at a desk has a small notebook (a store buffer) where they jot down memos before walking them over to the central filing room (cache hierarchy). Other people occasionally walk to the filing room and pull a memo out to read.

Now: a fence is the moment a person stops jotting, walks every pending memo to the filing room, **and** waits for any memos others have started to be filed, before doing anything else. It is expensive. But without it, you have no way to be sure that the memo you just "sent" is actually visible to anyone else.

That is, more or less, what every memory barrier instruction does. Different architectures have different rules about which memos can be reordered, which can be cached in personal notebooks, and which require an explicit walk. The Go runtime hides all of this from you — but when you have to debug it, the open-plan office image is a useful one to keep in mind.

End of `junior.md`. Onward.

---

## Appendix AP: A Glance at What Other Languages Do

Brief comparison to give you context for cross-language discussions.

- **C/C++ since C11/C++11.** Explicit `<atomic>` header with six memory orders: `relaxed`, `consume` (deprecated in practice), `acquire`, `release`, `acq_rel`, `seq_cst`. Default is `seq_cst`. Go chose only `seq_cst`-equivalent to keep the surface small.
- **Java.** `volatile` fields are sequentially consistent. `AtomicReference`, `AtomicInteger` provide more operations. The Java Memory Model (JMM) is the closest mainstream relative of Go's model.
- **Rust.** Mirrors C++'s six orderings via `std::sync::atomic::Ordering`. Default for `Atomic*` operations requires an explicit ordering parameter. Allows fine-grained tuning but is also a footgun.
- **Python (CPython).** The GIL serialises Python bytecode, so cross-thread memory ordering is effectively SC at the Python level. But native extensions and `multiprocessing.shared_memory` expose the real architecture's model.
- **Swift.** Similar SC-by-default approach, with explicit `OSMemoryBarrier` family for low-level work.
- **JavaScript / TypeScript.** Single-threaded by default. `SharedArrayBuffer` plus `Atomics` give a small set of SC operations.
- **Kotlin / Scala.** Inherit Java's model.

Go sits at the "small, safe, slightly less expressive" end of this spectrum. The trade-off is the standard library's simplicity.

---

## Appendix AQ: Common Search Terms That Lead Here

If you arrive at this material via web search, these are the queries that typically point this way. Each comes from a real Stack Overflow / forum question:

- "Go atomic.LoadInt32 vs plain read"
- "why my golang flag doesn't update across goroutines"
- "go arm64 cache coherence"
- "go memory model release acquire"
- "go atomic vs mutex performance"
- "go atomic.Pointer race detector"
- "go LOCK XCHG XCHG MFENCE difference"
- "what is store buffer x86"

If your question is one of these or similar, the answers are all somewhere above. Use Ctrl-F.

---

End. The middle file awaits.

---

## Appendix AR: Final Mnemonic — "L A R S"

A four-letter mnemonic to keep in working memory:

- **L** = LOAD acquire. On a cross-goroutine read, use `atomic.LoadXxx` or take a mutex; do not do a plain field read.
- **A** = ATOMIC store. On a cross-goroutine write, use `atomic.StoreXxx`, `atomic.AddXxx`, or `atomic.CompareAndSwapXxx`; do not do a plain field write.
- **R** = RACE detector. Always run tests with `-race` in CI. Treat warnings as P0.
- **S** = STAY portable. Do not optimise for x86's strong model; on `arm64` or `riscv64` your shortcut will bite.

If you internalise just LARS, your concurrent Go code will be correct on every platform Go supports.

---

## Appendix AS: A Postscript on Platforms Go Officially Supports

For completeness, the architectures where Go's `sync/atomic` is sequentially consistent (i.e., everywhere it works at all):

- `amd64`, `386`
- `arm64`, `arm`
- `riscv64`
- `ppc64`, `ppc64le`
- `mips64`, `mips64le`, `mips`, `mipsle`
- `s390x`
- `loong64`
- `wasm` (special-cased; no true multi-thread atomics yet in standard Wasm)

The runtime contains hand-written assembly stubs for each of these. The user-facing API (`sync/atomic`) is identical across all of them. You can write a single `atomic.Add` and rely on it working correctly everywhere.

End.
