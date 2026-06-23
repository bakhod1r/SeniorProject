---
layout: default
title: Hardware Barriers — Senior
parent: Hardware Barriers
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/01-hardware-barriers/senior/
---

# Hardware Memory Barriers — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Memory Consistency Models Compared](#memory-consistency-models-compared)
3. [RISC-V Weak Memory Order (RVWMO)](#risc-v-weak-memory-order-rvwmo)
4. [The RISC-V `FENCE` Instruction](#the-risc-v-fence-instruction)
5. [POWER Memory Model](#power-memory-model)
6. [MESI vs MOESI vs MESIF](#mesi-vs-moesi-vs-mesif)
7. [Cache-Coherent Interconnects](#cache-coherent-interconnects)
8. [Linux Kernel Barrier Macros](#linux-kernel-barrier-macros)
9. [How Go's Runtime Mirrors the Kernel Pattern](#how-gos-runtime-mirrors-the-kernel-pattern)
10. [Lock-Free MPMC Queue Design](#lock-free-mpmc-queue-design)
11. [Hazard Pointers and Epoch-Based Reclamation](#hazard-pointers-and-epoch-based-reclamation)
12. [RCU as Implemented in the Kernel](#rcu-as-implemented-in-the-kernel)
13. [Architectural Choices in Go's Runtime](#architectural-choices-in-gos-runtime)
14. [Reading the Go Memory Model Document](#reading-the-go-memory-model-document)
15. [Verification with Herd7](#verification-with-herd7)
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
27. [Cheat Sheet](#cheat-sheet)
28. [Self-Assessment Checklist](#self-assessment-checklist)
29. [Summary](#summary)
30. [What You Can Build](#what-you-can-build)
31. [Further Reading](#further-reading)
32. [Related Topics](#related-topics)

---

## Introduction
> Focus: every major memory consistency model, RISC-V WMO and the cumulative `fence` instruction, MOESI vs MESI, Linux kernel barrier macros, MPMC queue design, hazard pointers, and verification with Herd7.

At the senior level we stop treating x86 and ARM as the only worlds. We look at the full spectrum of memory consistency models — sequential consistency, total store order, partial store order, relaxed memory order, weak memory order, release consistency — and at the architectures that exemplify each. We dive into RISC-V's RVWMO model, which is the most cleanly designed weak model in production, and into POWER, which is the most baroque. We compare cache coherence protocols. We tour the Linux kernel's barrier macros and show how Go's runtime mirrors that pattern.

By the end of this file you should be able to:

- Map any of the standard memory models to the architectures that implement it.
- Read and write RISC-V `FENCE` instructions with precise predecessor/successor masks.
- Reason about MOESI's "Owned" state and why POWER added it.
- Design a correct multi-producer, multi-consumer (MPMC) lock-free queue.
- Choose between hazard pointers, epoch-based reclamation, and RCU for safe memory reclamation in lock-free code.
- Use Herd7 to formally verify a small concurrent algorithm against a memory model.

This is dense. Take it section by section.

---

## Memory Consistency Models Compared

Here are the seven memory models you should know.

### Sequential Consistency (SC)

Coined by Lamport (1979). The strongest reasonable model. All threads' operations appear in a global total order; each thread's operations are in program order within that total order.

**No reorderings allowed.**

**Architectures:** None of the major ones implement strict SC. Hardware SC is too slow.

### Total Store Order (TSO)

Stores from one thread appear in program order to all other threads. A thread may see its own stores before they become globally visible (store-to-load forwarding). Only StoreLoad reordering is permitted.

**Architectures:** x86, SPARC (in TSO mode), z/Architecture (mostly).

### Partial Store Order (PSO)

Like TSO, but stores can also be reordered with each other (StoreStore allowed). Almost no modern architecture uses PSO; SPARC had a PSO mode that was rarely used.

### Relaxed Memory Order (RMO)

Both loads and stores can be reordered. SPARC's most relaxed mode.

### Weak Memory Order (WMO)

A model where memory operations are categorised as "ordinary" and "synchronisation"; ordinary ops can be reordered freely, sync ops are SC. The Weak Ordering model defined by DEC Alpha and inspiring later ISAs.

### Release Consistency (RC)

Distinguishes acquire and release operations from ordinary operations. Acquire prevents subsequent ops from being hoisted before it; release prevents prior ops from being delayed past it. ARMv8 and RISC-V are close to RC with multi-copy atomicity.

### RVWMO (RISC-V Weak Memory Order)

RISC-V's specific model. Multi-copy atomic. Provides `FENCE` with predecessor/successor masks, plus acquire/release variants of atomic memory operations (`.AQ`/`.RL` suffixes).

### Comparison Table

| Model | LL | LS | SS | SL | Multi-copy atomic? | Examples |
|-------|----|----|----|----|--------------------|----------|
| SC | F | F | F | F | Yes | None (theoretical) |
| TSO | F | F | F | A | Yes | x86, SPARC-TSO |
| PSO | F | F | A | A | Yes | SPARC-PSO |
| RMO | A | A | A | A | Yes | SPARC-RMO |
| WMO | A | A | A | A | Yes | DEC Alpha |
| RC | A | A | A | A | Yes (modern) | ARMv8, RISC-V WMO |
| POWER | A | A | A | A | No | POWER |

`F` = forbidden, `A` = allowed (in normal ops; sync ops constrain).

The crucial axis: **multi-copy atomicity**. ARMv8 and RISC-V are multi-copy atomic; POWER is not. POWER programs need heavier fences (the `sync` instruction) for IRIW-style patterns.

---

## RISC-V Weak Memory Order (RVWMO)

RISC-V's memory model is documented in the official ISA Manual, Volume I, Chapter 17 ("RVWMO Memory Consistency Model"). It is the cleanest weak model in widespread production use.

### Key axioms

1. **Multi-copy atomic.** Stores have a globally agreed timeline.
2. **Program order is preserved within a hart (hardware thread) for operations to the same address.** Same-address LL, LS, SL, SS are all preserved.
3. **Operations to different addresses can be reordered freely** unless a `FENCE` or atomic memory operation orders them.
4. **Atomic memory operations** can carry acquire (`.AQ`), release (`.RL`), or both (`.AQRL`) flags. These constrain ordering similarly to ARMv8's `LDAR`/`STLR`.

### Ordering primitives

- **`FENCE pred, succ`** — a fence with two masks: predecessor (operations before the fence) and successor (operations after). Each mask is some subset of `{r, w, i, o}` (memory reads, memory writes, device input, device output). Common forms:
  - `FENCE rw, rw` — full memory barrier
  - `FENCE r, rw` — read-fence (acquire-style)
  - `FENCE rw, w` — write-fence (release-style)
- **AMO (Atomic Memory Operations)** — `AMOSWAP.W`, `AMOADD.W`, `AMOAND.W`, etc., with optional `.AQ`, `.RL`, `.AQRL` suffixes.
- **LR/SC (Load-Reserved / Store-Conditional)** — `LR.W` reserves a memory address; `SC.W` stores conditionally on the reservation. Variants `LR.W.AQ`, `SC.W.RL` for acquire/release.

### Ordering produced by AMO

`AMOSWAP.W.AQRL` produces:
- The load part of the AMO has acquire semantics: no later operations are reordered before it.
- The store part has release semantics: no earlier operations are reordered after it.
- Together, this gives sequentially-consistent ordering for the AMO with respect to surrounding operations.

This is exactly what Go's `atomic.SwapInt32` needs on RISC-V.

### Code example

A publish-subscribe handshake in RISC-V assembly:

```
# Publisher (data write, then ready flag)
sw     a1, 0(a0)         # data = a1
fence  rw, w             # release fence
li     a2, 1
sw     a2, 0(a3)         # ready = 1

# Subscriber (wait for ready, then read data)
loop:
lw     a2, 0(a3)         # load ready
beqz   a2, loop
fence  r, rw             # acquire fence
lw     a1, 0(a0)         # load data
```

Alternative using AMO with `.AQRL`:

```
# Publisher
sw     a1, 0(a0)
li     a2, 1
amoswap.w.rl x0, a2, (a3) # release-store via swap

# Subscriber
loop:
lw     a2, 0(a3)
beqz   a2, loop
amoadd.w.aq x0, x0, (a3)  # acquire fence
lw     a1, 0(a0)
```

The second form is sometimes preferred because AMOs may have hardware fast paths that standalone `FENCE` does not.

### Go on RISC-V

Go has supported `riscv64` (Linux/RISC-V 64-bit) since Go 1.14. The atomic implementations in `runtime/internal/atomic/atomic_riscv64.s` use AMOs with `.AQRL` and LR/SC loops for CAS:

```
TEXT runtime∕internal∕atomic·Cas(SB), NOSPLIT, $0-17
    MOV ptr+0(FP), A0
    MOVW old+8(FP), A1
    MOVW new+12(FP), A2
loop:
    LRW   A3, (A0)
    BNE   A3, A1, fail
    SCW   A4, A2, (A0)
    BNEZ  A4, loop
    MOV   $1, A0
    JMP done
fail:
    MOV   $0, A0
done:
    MOVB  A0, ret+16(FP)
    RET
```

(Pseudo-assembly; real syntax is RISC-V Plan 9.)

---

## The RISC-V `FENCE` Instruction

The `FENCE` instruction is more expressive than x86's `MFENCE` or ARM's `DMB`. It takes a 4-bit predecessor mask and a 4-bit successor mask, each describing which operations on which side must be ordered.

### The four ops

- `i` — device input (memory-mapped I/O reads)
- `o` — device output (MMIO writes)
- `r` — normal memory reads
- `w` — normal memory writes

### The 16 forms

| pred | succ | Effect |
|------|------|--------|
| rw | rw | Full memory barrier |
| r  | rw | Acquire-style (loads before fence) |
| rw | w  | Release-style (stores after fence) |
| r  | r  | LoadLoad |
| w  | w  | StoreStore |
| rw | r  | Order prior r/w with subsequent reads |
| rw | rw | Same as first row |
| iorw | iorw | Full barrier including MMIO |
| ... | ... | Many other combinations |

The 4-bit mask gives `2^4 * 2^4 = 256` distinguishable fences, though many are equivalent in practice.

### Cumulativity

A `FENCE rw, rw` is *cumulative*: prior reads and writes from this hart and from other harts that this hart has observed are ordered with subsequent operations. This is required for multi-copy atomicity.

### Comparison to x86 and ARM

- `FENCE r, r` ≈ `LFENCE` (load-load).
- `FENCE w, w` ≈ `SFENCE` (store-store).
- `FENCE rw, rw` ≈ `MFENCE` or `DMB ISH`.
- `FENCE rw, w` ≈ release-fence (no exact x86 equivalent; ARM's `DMB ISHST` is close).
- `FENCE r, rw` ≈ acquire-fence (no exact x86 equivalent; ARM's `DMB ISHLD` is close).

The RISC-V family of fences is the most precise; you can specify exactly which orderings you need. This may matter for hand-tuned RISC-V kernels and crypto code, but Go's compiler typically emits `FENCE rw, rw` or relies on `.AQRL` AMOs.

---

## POWER Memory Model

POWER (IBM's PowerPC family, now POWER9/10) has the most relaxed major memory model. Key features:

- **Not multi-copy atomic.** Different cores can see writes in different orders.
- **`lwsync`** (lightweight sync) — orders most operations but not StoreLoad to a different address.
- **`sync`** (heavy sync) — full barrier including IRIW.
- **`isync`** (instruction sync) — flushes pipeline, used after a branch to prevent speculation past it.
- **`eieio`** ("Enforce In-Order Execution of I/O") — orders MMIO accesses.

### Why does POWER need `sync`?

Because of the lack of multi-copy atomicity, the IRIW litmus test can produce its bad outcome on POWER. To prevent it, every observer that wants to agree on store order must use `sync` (or POWER's specific cumulative variant `hwsync`).

This makes POWER atomics noticeably more expensive than ARM atomics. Go's POWER atomics in `runtime/internal/atomic/atomic_ppc64x.s` emit `lwsync` for releases and `sync` for full barriers.

### Example: atomic store on POWER

```
LWSYNC
STD    R1, 0(R0)
SYNC
```

Two fences around the store: `LWSYNC` before (release) and `SYNC` after (to provide visibility to other cores).

Compare this to the single `STLR` on ARMv8. POWER pays a real per-operation cost for its weaker model.

### Why design POWER this way?

POWER's design was optimised for many-core scale-up workloads on Power servers, where the cache-coherent interconnect is wide and write-buffering matters more than per-operation latency. Trading off occasional fence costs for higher aggregate throughput. Modern POWER cores (POWER10) have improved fence performance significantly.

---

## MESI vs MOESI vs MESIF

Cache coherence protocols beyond MESI.

### MESI Recap

Modified, Exclusive, Shared, Invalid. Each line has one of four states. Transitions on read, write, invalidate, write-back.

### MOESI

Adds **O (Owned)**: a line that is modified but also shared with other cores. The owning core is responsible for supplying the line on snoop, but does not need to write back to memory immediately. Reduces memory bandwidth in workloads where shared modified data is read by many cores.

Used by AMD Athlon, Opteron, Zen, and some ARM cores.

### MESIF

Used by Intel since Nehalem. Adds **F (Forward)**: when a line is in Shared state on multiple caches, exactly one is designated F. That cache supplies the line on snoop instead of multiple caches racing. Reduces interconnect chatter.

### Practical effect on Go programs

Negligible. Go's atomics work the same on any coherence protocol. The difference shows up in microbenchmarks of false-sharing scenarios and in fine-grained workloads, but the rules of memory ordering are unchanged.

---

## Cache-Coherent Interconnects

How do cache lines actually travel between cores? Modern CPUs use one of several interconnects.

### Intel QPI / UPI

Intel's "Ultra Path Interconnect" (UPI, formerly QPI) connects sockets in multi-socket systems. Within a socket, cores connect via a ring or mesh bus. Each L3 cache slice is associated with a particular memory range; a request snoops the relevant slice and other cores.

### AMD Infinity Fabric

AMD's Zen and EPYC use the Infinity Fabric, a packet-switched mesh that connects cores, memory controllers, and I/O. CCDs (Core Complex Dies) within an EPYC chip communicate via the fabric. Latency between cores in different CCDs is higher than within one CCD.

### ARM CCI / CCN / CMN

ARM's Cache Coherent Interconnect (CCI for small systems), Cache Coherent Network (CCN for medium), and Coherent Mesh Network (CMN for large) are the IP blocks ARM licenses for multi-core SoCs. Server-class ARM (AWS Graviton, Ampere Altra) uses CMN.

### Apple Silicon AMX/AMX2

Apple's M1/M2/M3 use a custom interconnect with very low cross-core latency. Cache coherence is maintained at the L2 level (shared per cluster) and at the system level.

### Why this matters for Go

The interconnect determines the *cost* of a cache miss that goes to another core. On a single-die x86 chip, an L3 hit from another core is ~40 cycles. On a multi-socket Xeon, a cross-socket fetch is ~150-300 cycles. Workloads that fit in one socket scale linearly; workloads that span sockets pay an interconnect tax.

For Go: keep hot data structures within one NUMA node when possible. The `runtime` does not have first-class NUMA awareness, but you can use OS tools (`numactl`) to bind goroutines.

---

## Linux Kernel Barrier Macros

The Linux kernel has a comprehensive set of barrier macros that hides architectural differences. They are defined per-architecture in `arch/<arch>/include/asm/barrier.h`. The key macros:

### `barrier()`

A compiler-only barrier. Translates to `__asm__ __volatile__("" ::: "memory")` on GCC. No CPU instruction emitted. Prevents compiler from reordering across it.

### `smp_mb()`

Full SMP memory barrier. On x86: `mfence`. On ARM: `dmb ish`. On RISC-V: `fence rw, rw`.

### `smp_rmb()`

Read memory barrier (LoadLoad). On x86: `lfence` (or compiler barrier on most workloads since x86 plain loads don't reorder against each other). On ARM: `dmb ishld`. On RISC-V: `fence r, r`.

### `smp_wmb()`

Write memory barrier (StoreStore). On x86: compiler barrier (since x86 forbids StoreStore reordering anyway). On ARM: `dmb ishst`. On RISC-V: `fence w, w`.

### `smp_load_acquire(p)`

Acquire-load. On x86: plain `MOV` (free acquire). On ARM: `LDAR`. On RISC-V: load + `fence r, rw`.

### `smp_store_release(p, v)`

Release-store. On x86: plain `MOV`. On ARM: `STLR`. On RISC-V: `fence rw, w` + store.

### `READ_ONCE(p)` / `WRITE_ONCE(p, v)`

Prevent the compiler from optimising the access (e.g. caching in a register, splitting into multiple accesses). No barrier emitted at the hardware level; just a compiler barrier. Used for shared variables that need atomic access but no ordering.

### `atomic_t`, `atomic_long_t`, etc.

The kernel's atomic types, with operations like `atomic_inc`, `atomic_add_return`, `atomic_cmpxchg`. Each operation has variants with different ordering guarantees: `atomic_inc_relaxed`, `atomic_inc_acquire`, `atomic_inc_release`, `atomic_inc_full`.

### `WRITE_ONCE_RELEASE` (per-architecture)

For cases that need a release-store without using full SC. Maps to architecture-specific cheaper primitives.

---

## How Go's Runtime Mirrors the Kernel Pattern

Go's `runtime/internal/atomic` package exposes a similar set of primitives:

| Kernel | Go runtime/internal/atomic |
|--------|---------------------------|
| `smp_mb()` | (implicit in `Store`, `Xchg`, etc.) |
| `smp_load_acquire` | `LoadAcq` |
| `smp_store_release` | `StoreRel` |
| `READ_ONCE` | `Load` |
| `WRITE_ONCE` | `Store` (atomic, full barrier) |
| `atomic_inc` | `Xadd(p, 1)` |
| `atomic_cmpxchg` | `Cas` |

The kernel exposes finer-grained ordering than Go's public `sync/atomic`. The runtime's *internal* atomic package mirrors the kernel's finer-grained primitives — but these are not exported. User code only gets full-SC operations via `sync/atomic`.

This is a deliberate Go design choice: simplicity over expressiveness. C and Rust expose relaxed/acquire/release/SC variants; Go does not. The cost is some performance loss for advanced lock-free algorithms; the benefit is a smaller API surface and fewer footguns.

### Why does the runtime get the privileged version?

Because the runtime author teams (the GC team, scheduler team) have deep knowledge of when relaxed ordering suffices and can prove correctness manually. The cost-benefit ratio is different for them than for application programmers.

---

## Lock-Free MPMC Queue Design

Building a correct multi-producer, multi-consumer queue without locks is one of the canonical challenges of concurrent programming. Let us walk through a Vyukov-style bounded MPMC queue in Go.

### The structure

```go
type cell[T any] struct {
    seq atomic.Uint64
    val T
}

type MPMCQueue[T any] struct {
    buf  []cell[T]
    mask uint64
    _    [56]byte // pad
    head atomic.Uint64
    _    [56]byte // pad to put head and tail on separate lines
    tail atomic.Uint64
}

func NewMPMC[T any](capacity uint64) *MPMCQueue[T] {
    // capacity must be power of 2
    if capacity == 0 || capacity&(capacity-1) != 0 {
        panic("capacity must be power of 2")
    }
    q := &MPMCQueue[T]{
        buf:  make([]cell[T], capacity),
        mask: capacity - 1,
    }
    for i := range q.buf {
        q.buf[i].seq.Store(uint64(i))
    }
    return q
}

func (q *MPMCQueue[T]) Enqueue(v T) bool {
    var cell *cell[T]
    pos := q.head.Load()
    for {
        cell = &q.buf[pos&q.mask]
        seq := cell.seq.Load()
        diff := int64(seq) - int64(pos)
        if diff == 0 {
            // cell is ready for writing
            if q.head.CompareAndSwap(pos, pos+1) {
                break
            }
        } else if diff < 0 {
            // queue is full
            return false
        } else {
            // another producer claimed; reload pos
            pos = q.head.Load()
        }
    }
    cell.val = v
    cell.seq.Store(pos + 1) // publish to consumers
    return true
}

func (q *MPMCQueue[T]) Dequeue() (T, bool) {
    var zero T
    var cell *cell[T]
    pos := q.tail.Load()
    for {
        cell = &q.buf[pos&q.mask]
        seq := cell.seq.Load()
        diff := int64(seq) - int64(pos+1)
        if diff == 0 {
            if q.tail.CompareAndSwap(pos, pos+1) {
                break
            }
        } else if diff < 0 {
            return zero, false // empty
        } else {
            pos = q.tail.Load()
        }
    }
    v := cell.val
    cell.seq.Store(pos + q.mask + 1) // mark cell ready for next round
    return v, true
}
```

### What the barriers do

- **`cell.seq.Load()` (acquire):** ensures the read of `cell.val` (later) does not move before the seq load.
- **`cell.seq.Store(pos + 1)` (release):** ensures the write to `cell.val` (earlier) is published before the seq store.
- **`q.head.CompareAndSwap` and `q.tail.CompareAndSwap` (full barrier):** ensure mutually-exclusive claim of slots across multiple producers/consumers.

### Why this works

Each cell has a sequence number that tracks where it is in the queue's "round." Initially, cell `i` has seq `i`. When a producer wants to enqueue:
- It reads the global head.
- It checks the cell's seq: if it equals head, the cell is ready to be written.
- It CASes head to head+1 (claiming the slot).
- It writes the value.
- It increments cell's seq, publishing the write.

A consumer:
- Reads global tail.
- Checks the cell's seq: if it equals tail+1, the cell has been written and is ready to be read.
- CASes tail.
- Reads the value.
- Increments cell's seq by `mask+1` (preparing for the next round).

The acquire-release pairing on the cell's seq is what synchronises the value write with the consumer's read.

### What can go wrong

- Forgetting the `_ [56]byte` padding between head and tail → false sharing → 5-10x slowdown under contention.
- Forgetting the seq initialisation → first enqueue sees stale 0 seq and either spins forever or corrupts the queue.
- Using non-power-of-2 capacity → modulo by mask is wrong; you must use `% capacity` instead of `& mask`, which is slower.
- Mis-ordering the value write and the seq store → consumer can see new seq with old value.

### Performance characteristics

On modern x86, this queue can achieve ~50-100 million ops/sec single-threaded, dropping to ~10-30 million under heavy contention. On arm64 the numbers are similar. By contrast, a `sync.Mutex` + `[]T` queue maxes out at ~5-10 million ops/sec under contention.

Lock-free is faster, but not by an unbounded margin. For many workloads, a well-padded mutex is sufficient.

---

## Hazard Pointers and Epoch-Based Reclamation

Lock-free data structures have a deep problem: when can you free a node?

In a linked list, when a thread removes a node, another thread might still hold a pointer to it. Freeing the node leads to use-after-free. The garbage collector solves this in managed languages — and Go is one. In Go, this isn't an issue *for memory*. But in C, it is. Hazard pointers and epoch-based reclamation are the two main techniques.

### Hazard pointers (Michael, 2002)

Each thread publishes "I am about to access node X." Before freeing X, the freer scans every thread's hazard pointer and waits until none point to X.

Pros: precise; only delays freeing for nodes actively referenced.
Cons: every access pays an O(N_threads) cost; complex.

### Epoch-based reclamation (Fraser, 2004)

Time is divided into epochs. Threads announce their current epoch. To free a node, you wait until every thread has advanced past the epoch in which the node was retired.

Pros: low per-access cost (just announce epoch, then read).
Cons: a stalled thread can delay reclamation indefinitely; bulk-frees rather than precise.

### In Go

Go's GC handles all of this automatically. You don't need hazard pointers. **But** there are special cases:

- **`sync.Pool`** uses an internal scheme to recycle objects across threads. It implements something similar to epoch reclamation in `runtime/mheap.go`.
- **Lock-free reclamation for unsafe data** (e.g. memory-mapped buffers): you may need to roll your own hazard pointers or use atomic reference counts.
- **Cache evictions**: e.g. an LRU cache where freeing a node racing with a reader requires careful coordination. Use `sync.Mutex` unless profiling shows it as the bottleneck.

### Comparison to Go's GC

The GC ensures any reachable object is kept alive. As long as a goroutine holds a pointer (in a register, on its stack, or in a struct field), the object cannot be collected. This is *exactly* the guarantee hazard pointers and EBR provide, but free of charge.

The cost is that Go's GC has its own latency and overhead (sub-millisecond pauses on small heaps, but higher on multi-GB heaps). For latency-sensitive code, you may want manual memory management with hazard pointers in `unsafe` — but for almost everyone, just use Go's GC.

---

## RCU as Implemented in the Kernel

Read-Copy-Update is a Linux kernel technique for read-mostly data structures.

### The pattern

1. Readers traverse the structure without locks.
2. Writers create a new copy, modify it, and atomically swap a pointer.
3. After the swap, the old structure is dead — but readers may still hold pointers.
4. The kernel waits for a "grace period" — a time interval after which no reader can hold the old pointer.
5. The old structure is freed.

### Grace period detection

In the kernel, a grace period ends when every CPU has performed a context switch (entering and leaving an RCU read-side critical section is automatic for tasks running in kernel mode). For preemptible RCU, there's more book-keeping.

### Why this is fast for readers

Readers do *nothing* except read. No barrier (on TSO), no atomic op, no lock. Just plain reads. Compared to a mutex or rwlock, the read-side savings can be enormous.

### Go equivalent

`atomic.Pointer[T]` + immutable data structures gives you RCU:

```go
var current atomic.Pointer[Config]

func Update(newCfg *Config) {
    current.Store(newCfg)
    // old Config is collected when no goroutine holds a reference
}

func Read() *Config {
    return current.Load()
}
```

No grace-period code is needed because Go's GC handles it. This is one of Go's underrated advantages over C: lock-free read-mostly patterns are trivial.

The cost: an `atomic.Pointer.Load` on weakly-ordered platforms is an `LDAR`, which is ~1-3x the cost of a plain load. On x86 it's free.

---

## Architectural Choices in Go's Runtime

The Go runtime uses memory barriers carefully in several core subsystems.

### The GMP scheduler

Each P (processor) has a local run queue. Push/pop on the local queue uses atomic operations on the head/tail. Work-stealing (when one P steals from another) uses CAS on the victim's queue. The scheduler's atomic operations are in `runtime/proc.go` and use `runtime/internal/atomic`.

The scheduler also maintains a global run queue, protected by a global lock. The local queues are lock-free.

### The garbage collector

The GC uses write barriers to track pointer updates during concurrent marking. The write barrier (in `runtime/mwbbuf.go`, `runtime/mbarrier.go`) is *not* a memory barrier in the sense we have been discussing — it is a GC-specific mechanism that records pointer writes. Don't confuse the two.

The GC also uses memory barriers (in our sense) to synchronise its mark/sweep phases with mutators. The transitions are protected by `runtime/internal/atomic` operations.

### Channels

Channel operations (`chan_recv`, `chan_send` in `runtime/chan.go`) use a combination of a per-channel `sync.Mutex` and atomic operations on the channel's wait queues. The mutex is the primary synchronisation; the atomics handle the small lock-free fast paths (e.g. checking `len(ch)` without locking).

### sync.Mutex internals

`sync.Mutex` in Go has a sophisticated implementation in `runtime/lock_*.go` (per OS) and `sync/mutex.go`. The fast path uses CAS to acquire an uncontended lock — no system call, no kernel involvement. The slow path falls into `runtime_SemacquireMutex`, which may park the goroutine on a futex (Linux) or similar.

The CAS in the fast path is a full barrier (because amd64 `LOCK CMPXCHG` is full-barrier). This is one place where you can see how a higher-level primitive maps down to a single hardware barrier.

---

## Reading the Go Memory Model Document

The Go memory model is at `go.dev/ref/mem`. It is a normative document; everything Go promises about memory ordering is in there. Key sections:

### Synchronization

Defines what *synchronizes-with* means: a release operation synchronizes-with the subsequent acquire of the same variable. From this, *happens-before* is derived.

### Atomic operations

Defines `sync/atomic` operations as sequentially consistent. Any total order of atomic operations is consistent with the happens-before relation.

### Locks

`sync.Mutex.Lock()` is an acquire; `Unlock()` is a release. The release in one goroutine synchronizes-with the next acquire in another.

### Channels

A send on a channel happens-before the corresponding receive. For unbuffered channels, the receive happens-before the send completes.

### `sync.Once`

`once.Do(f)` synchronizes-with the return from all later `once.Do(f)` calls.

### What Go *doesn't* guarantee

- Races have undefined behaviour (since Go 1.19), with a small exception: word-sized atomic access cannot tear.
- Operations on `unsafe.Pointer` are unspecified unless covered by `sync/atomic`.
- The order of operations on different variables without explicit synchronization is unspecified.

Read this document in full before implementing any lock-free code. It is short (5-6 pages) but every sentence matters.

---

## Verification with Herd7

Herd7 is a tool from the diy7 suite that simulates programs against a memory model and checks which outcomes are allowed. It supports x86-TSO, ARMv7, ARMv8, POWER, RISC-V, and custom *cat* models.

### Example litmus test

```
X86 SB
{ x = 0; y = 0; }
P0 | P1 ;
MOV [x], 1 | MOV [y], 1 ;
MOV EAX, [y] | MOV EBX, [x] ;
exists (P0:EAX = 0 /\ P1:EBX = 0)
```

Run with `herd7 sb.litmus`. Output:

```
Test SB Allowed
States 4
0:EAX=0; 1:EBX=0;   <-- this is the "bad" outcome
0:EAX=0; 1:EBX=1;
0:EAX=1; 1:EBX=0;
0:EAX=1; 1:EBX=1;
Allowed (the predicate is satisfied by 1 state)
```

This confirms x86-TSO allows the SB anti-litmus.

### Go-specific verification

There is no official cat model for the Go memory model, but the model is close enough to ARMv8 with full-SC atomics that informal arguments via Herd7 + the ARMv8 cat model translate well.

A research effort to formalise the Go memory model in cat is in progress (as of 2024-2025). Until it lands, manual reasoning + Herd7 on similar models is the best you have.

### When to use Herd7

- You are designing a lock-free algorithm with subtle barriers.
- You need to prove correctness for a paper, audit, or critical system.
- You are porting an algorithm from one architecture to another and want to verify barrier placement.

For most application Go programming, Herd7 is overkill. Use `-race`, stress tests, and `sync/atomic`'s SC guarantees.

---

## Coding Patterns

Briefly, since we covered most of these in middle.md.

- **Read-mostly state via `atomic.Pointer`** — Go's RCU.
- **Single-producer single-consumer ring buffer** — covered in middle.
- **MPMC queue** — Vyukov-style, covered above.
- **Sequence lock** — covered in middle.
- **Per-CPU sharding** — for hot counters.
- **Sharded maps** — `sync.Map` does this internally.

---

## Clean Code

- Keep lock-free implementations in dedicated files with extensive comments.
- Name barriers in comments by the litmus test or invariant they prevent.
- Cite the paper or reference for any non-trivial lock-free algorithm.
- Write extensive concurrent tests with `t.Parallel()` and stress mode.

---

## Error Handling

Same as middle: no errors in atomics; race-detector reports indicate logical bugs.

---

## Security Considerations

For senior-level: be aware that lock-free algorithms can have timing side channels (the duration of a CAS retry can leak information about contention). Constant-time cryptographic code typically avoids contention-sensitive constructs.

---

## Performance Tips

- For read-mostly state, use `atomic.Pointer[T]` not `sync.RWMutex`. The atomic load is much cheaper than a read lock.
- For hot counters, use per-CPU sharding.
- For complex protected state, use `sync.Mutex` until profiling proves it's a bottleneck.
- Avoid LL/SC loops for hot paths; prefer LSE on arm64.
- Pin to NUMA nodes via `numactl` if cross-socket traffic is significant.

---

## Best Practices

1. Default to `sync.Mutex` and channels.
2. Move to `sync/atomic` for hot paths or read-mostly state.
3. Use lock-free algorithms only when published, well-tested, or formally verified.
4. Pad hot atomics.
5. Test on every target architecture.
6. Use `-race` aggressively.

---

## Edge Cases and Pitfalls

### Pitfall: NUMA effects

On a dual-socket server, a cache line that bounces between cores on opposite sockets pays ~150-300 cycles per migration. Goroutines that the scheduler migrates between sockets can amplify this. Mitigation: NUMA pinning, or design for affinity (e.g. per-CPU sharding).

### Pitfall: Hyper-Threading and SMT

Two SMT siblings share L1 and L2. A workload that fits on one core may suddenly contend if scheduled on two siblings. Mitigation: disable HT, or pin Go to physical cores via `runtime.GOMAXPROCS` and `taskset`.

### Pitfall: ARM "Big-Little" architectures

Big cores (A78, X1) and Little cores (A55) have very different performance characteristics but identical memory models. Performance bugs can hide on Little cores and surface only under load.

### Pitfall: WebAssembly atomics

WASM has its own atomics proposal (still evolving). Go's WASM target currently treats atomics as plain memory ops (single-threaded model). If/when threaded WASM lands, this will change.

---

## Common Mistakes

- Implementing your own lock-free queue without referring to published designs.
- Using hand-rolled hazard pointers in Go (use the GC).
- Forgetting `lwsync` vs `sync` on POWER (Go's runtime handles it, but if you write inline assembly, you must too).
- Mixing C atomics and Go atomics in CGo without understanding the memory models.

---

## Common Misconceptions

- "RISC-V is just like ARM." Close, but the `FENCE` instruction is more expressive and the rules are subtly different. Do not assume identical behaviour.
- "POWER doesn't matter; nobody uses it." IBM Power servers are widely used in finance and HPC. Go supports `ppc64le`; if you ship to those customers, you must care.
- "The Go memory model is the same as C++." Similar but not identical. Read both.

---

## Tricky Points

### Tricky 1: Multi-copy atomicity on ARMv8

ARMv8 is multi-copy atomic by default. But the legacy ARMv7 was not. If you support 32-bit ARM, IRIW-style bugs are possible. Go's `runtime/internal/atomic` handles this on `linux/arm`, but be aware.

### Tricky 2: RISC-V "Ztso" extension

RISC-V has an optional extension Ztso that adds TSO mode to a hart. If a hart is in Ztso, the memory model becomes TSO instead of WMO. This is for porting x86 code to RISC-V. Not yet widely deployed.

### Tricky 3: x86 `LFENCE` post-Spectre

Intel changed the spec of `LFENCE` to be serialising. AMD's `LFENCE` is *not* serialising by default unless the `MSR_F10_DE_CFG2` bit 1 is set (Linux sets it).

### Tricky 4: ARM "release consistency" but with "data dependency ordering"

ARMv8's model says: a load that depends on another load via a data dependency is ordered after that load. This is sometimes useful for lock-free algorithms that want to avoid `LDAR`. Go does not rely on this — it always uses `LDAR` for atomic loads.

---

## Test

### Test 1: RISC-V fence

What does `FENCE rw, w` do?

**Answer:** Orders prior reads and writes with subsequent writes. Equivalent to a release fence.

### Test 2: MOESI Owned state

When does a line transition to Owned?

**Answer:** When it's in Modified state and a snoop from another core requests a read. The line is shared with the requester but the owner is responsible for supplying it. Memory remains stale until eventual writeback.

### Test 3: Lock-free queue invariant

In Vyukov's MPMC queue, what is the invariant for the cell's `seq` value?

**Answer:** Cell `i` has `seq == k * capacity + i` after the k-th producer has written. Reader can dequeue only when `seq == k * capacity + i + 1` (consumer-ready).

### Test 4: Linux barrier macro

What does `smp_load_acquire` compile to on x86 vs arm64?

**Answer:** Plain `MOV` on x86 (free acquire on TSO). `LDAR` on arm64.

---

## Cheat Sheet

```
SENIOR-LEVEL CHEAT SHEET
========================

Memory models
  SC > TSO > PSO > RMO > WMO > RC > POWER (in strength)
  x86 ≈ TSO; ARMv8 ≈ RC + multi-copy atomic; POWER = weakest practical
  RISC-V WMO ≈ ARMv8 with more expressive FENCE

RISC-V FENCE
  FENCE pred, succ ; pred,succ ⊆ {r, w, i, o}
  FENCE rw, rw = full barrier
  FENCE r, rw = acquire
  FENCE rw, w = release

Cache coherence
  MESI: M, E, S, I
  MOESI: + Owned (shared dirty)
  MESIF: + Forward (one cache designated supplier)

Linux barrier macros → Go internal atomics
  smp_mb()             ↔ (implicit in Store)
  smp_load_acquire()   ↔ LoadAcq
  smp_store_release()  ↔ StoreRel
  READ_ONCE/WRITE_ONCE ↔ Load/Store

MPMC queue (Vyukov)
  cell.seq tracks round number
  producer: check seq == pos; CAS head; write; seq = pos + 1
  consumer: check seq == pos + 1; CAS tail; read; seq = pos + capacity + 1

Reclamation
  C: hazard pointers or epoch-based
  Go: just use the GC

Verification
  Herd7 + cat model for litmus tests
  No official Go cat model yet; use ARMv8 + SC atomics as proxy
```

---

## Self-Assessment Checklist

- [ ] I can map any of SC, TSO, PSO, RMO, WMO, RC, POWER to a representative architecture.
- [ ] I can write a RISC-V `FENCE` for any specific ordering need.
- [ ] I can implement a correct Vyukov MPMC queue from memory.
- [ ] I understand why Go's GC eliminates the need for hazard pointers.
- [ ] I can read `runtime/internal/atomic/atomic_riscv64.s` and explain each instruction.
- [ ] I can run a Herd7 litmus test on a simple example.
- [ ] I know when to use `atomic.Pointer` vs `sync.RWMutex`.

---

## Summary

Senior-level mastery of hardware barriers requires fluency across multiple architectures, intuition about cache-coherence protocols, and a working knowledge of formal memory model tools. Key takeaways:

- Memory models span a spectrum from SC (strongest) to POWER (weakest). Each architecture sits at a specific point.
- RISC-V's RVWMO is the cleanest weak model; its `FENCE` instruction is the most expressive standalone fence in widespread use.
- MOESI's Owned state and MESIF's Forward state are minor optimisations over MESI; programmers rarely care.
- The Linux kernel's barrier macros form a useful taxonomy; Go's `runtime/internal/atomic` mirrors them.
- Vyukov-style MPMC queues are the canonical lock-free example; Go's GC removes the reclamation problem.
- Herd7 + cat models verify correctness for serious work.

The professional file dives even deeper: load/store queues, memory order buffer, TSO replays, non-temporal stores, RDTSC fencing, fence-free fast paths, and formal verification techniques.

---

## What You Can Build

- A Vyukov MPMC queue with correctness tests.
- A read-mostly config via `atomic.Pointer` (Go-flavoured RCU).
- A per-CPU sharded counter.
- A sequence-locked monotonic clock reader.
- A Herd7 litmus test suite for your favourite lock-free algorithm.

---

## Further Reading

- The RISC-V ISA Manual, Volume I, Chapter 17 (RVWMO).
- POWER ISA Architecture Manual, Book II, "Storage Consistency".
- Sarkar et al., "Synchronising C/C++ and POWER", PLDI 2012.
- Maranget, Sarkar, Sewell, "A Tutorial Introduction to the ARM and POWER Relaxed Memory Models".
- Linux Documentation/memory-barriers.txt.
- Vyukov, "Bounded MPMC queue" (1024cores.net, archived).
- Russ Cox, "Updating the Go Memory Model".

---

## Related Topics

- [Middle file](middle.md) — x86-TSO formalisation, ARMv8 details.
- [Professional file](professional.md) — load/store queues, formal verification.
- The Go memory model document.
- `sync.Mutex` internals.
- The GMP scheduler.

---

## Appendix A: A Full RVWMO Tour

The middle file mentioned RVWMO at a sketch level. Here we go deeper. The RISC-V Weak Memory Order (RVWMO) model is defined in the RISC-V ISA Manual Volume I Chapter 17 (or 14, depending on revision). It is the cleanest weak memory model in any production ISA.

### A.1 The Core Idea

In RVWMO, memory operations are ordered by a partial order called **ppo** (preserved program order). Operations that are not related by ppo can be observed in any order by other harts (RISC-V's term for hardware threads). The `FENCE` instruction adds explicit ordering edges to the ppo graph.

### A.2 The PPO Rules (Simplified)

A memory op `a` is ordered before `b` (i.e., `a -ppo-> b`) if any of:

1. `a` is a fence and `b` matches the fence's successor set.
2. `b` is a fence and `a` matches the fence's predecessor set.
3. `a` and `b` access the same address and one of them is a store.
4. `a` is a load-acquire (`LR.AQ`) and `b` is any later op.
5. `b` is a store-release (`SC.RL`) and `a` is any earlier op.
6. Data dependencies: if `b` reads a value that `a` produced.
7. Address dependencies: if `b`'s effective address depends on `a`'s result.

Any other pair of operations is *unordered* — observers can see them in either order.

### A.3 The FENCE Instruction in Detail

The full syntax:

```
FENCE pred, succ
```

Where `pred` and `succ` are subsets of `{i, o, r, w}`:

- `i` = device input (memory-mapped I/O reads)
- `o` = device output (memory-mapped I/O writes)
- `r` = memory reads
- `w` = memory writes

The fence orders predecessor operations (matching `pred`) before successor operations (matching `succ`).

Examples:

- `FENCE rw, rw` — full memory barrier (between any two memory ops).
- `FENCE r, rw` — acquire-like (reads before everything later).
- `FENCE rw, w` — release-like (everything before later writes).
- `FENCE w, r` — StoreLoad fence (this is the one TSO would already give you).
- `FENCE.TSO` — special encoding that emulates x86 TSO ordering, useful for porting x86 code.

### A.4 Why RISC-V Designed It This Way

The motivation is composability. Most other ISAs have a fixed set of fence instructions (`mfence`, `dmb`, etc.) and you pick the closest match. RISC-V lets you specify exactly the ordering you need, no more no less. The hardware is then free to implement weaker fences cheaper than stronger ones.

Real RISC-V cores typically implement `FENCE rw,rw` as a full pipeline barrier (similar to `MFENCE`); `FENCE r,r` is sometimes a no-op on cores where loads naturally drain in order; `FENCE w,w` is a store buffer drain. The cost varies, but having the granularity lets the architect optimise.

### A.5 RVWMO Litmus Test Examples

The classic Message Passing pattern under RVWMO:

```
Thread 1                Thread 2
SW   x1, (data)         LW   r1, (flag)
FENCE w, w               BEQZ r1, retry
SW   x2, (flag)         FENCE r, r
                        LW   r2, (data)
```

Without the fences, RVWMO allows `r1 == 1, r2 == 0`. The `FENCE w,w` on the producer ensures the data write becomes visible before the flag write. The `FENCE r,r` on the consumer ensures the data read happens after the flag read.

You can replace these explicit fences with the `LR.AQ`/`SC.RL` or `AMO.AQ`/`AMO.RL` variants, which is what Go's runtime does.

---

## Appendix B: POWER Memory Model — The Most Complex of All

The POWER architecture (formerly PowerPC) has a memory model that is widely considered the hardest to reason about. Its key feature is **non-multi-copy-atomicity**.

### B.1 What Non-Multi-Copy-Atomicity Means

In a multi-copy-atomic system, once a store is observed by *any* thread, it is observed by *all* threads. (ARMv8 became multi-copy-atomic; ARMv7 was not.)

In POWER, two different observer threads can disagree on the order of two stores from two other threads. This is observable via the **IRIW** (Independent Reads of Independent Writes) litmus test:

```
Thread A   Thread B   Thread C            Thread D
x = 1      y = 1      r1 = x; r2 = y      r3 = y; r4 = x
```

On POWER, the outcome `r1 == 1, r2 == 0, r3 == 1, r4 == 0` is observable — C sees `x` before `y`, while D sees `y` before `x`. To forbid this you need a **sync** instruction (full barrier) on every observer thread, not just on the writer.

### B.2 POWER Fence Instructions

| Instruction | Description |
|---|---|
| `sync`        | Full barrier (heavyweight; orders all memory ops globally) |
| `lwsync`      | Light-weight sync (orders LL, LS, SS; does NOT order SL) |
| `isync`       | Instruction sync (flushes pipeline; used for branch-after-load patterns) |
| `eieio`       | Enforce in-order execution of I/O (legacy I/O barrier) |

`lwsync` is approximately equivalent to ARM's `DMB ISH` minus the StoreLoad ordering. It is much cheaper than `sync`. `isync` is special: it doesn't order memory accesses directly, but it ensures that a branch's outcome is visible before subsequent loads — used in the "acquire via control dependency" pattern.

### B.3 POWER ACQ/REL Pattern

Producer (release):

```
... writes to data ...
lwsync
store flag
```

Consumer (acquire):

```
load flag
isync           ; or lwsync; isync is cheaper
... reads from data ...
```

The use of `isync` on the consumer is a POWER-specific optimisation: a control dependency on the loaded flag combined with `isync` provides the acquire ordering at lower cost than a full `lwsync`. ARM's `LDAR` and RISC-V's `LR.AQ` make this idiom unnecessary.

### B.4 Go on POWER

Go supports `ppc64` and `ppc64le`. The runtime files in `runtime/internal/atomic/atomic_ppc64x.s` emit appropriate POWER instructions. The atomic load uses `lwz` (load word and zero) followed by `lwsync`; the atomic store uses `lwsync` followed by `stw` followed by `sync`. The full SC store on POWER is expensive — typically 30–50 ns versus 15–25 ns on x86 — because of the non-multi-copy-atomic semantics. This is one of several reasons high-performance Go on POWER is harder to tune.

---

## Appendix C: Cache Coherence Protocols Deep Dive

The middle file mentioned MESI. The senior level should know the family.

### C.1 MESI

The basic protocol. Each cache line is in one of four states:

- **Modified (M):** This cache has the only valid copy; differs from memory.
- **Exclusive (E):** This cache has the only valid copy; matches memory.
- **Shared (S):** Multiple caches have valid copies; all match memory.
- **Invalid (I):** No valid copy here.

Transitions are driven by reads, writes, and snooping messages from other caches. On a write to a Shared line, the writer sends an Invalidate message; all other caches transition that line to Invalid; the writer transitions to Modified.

### C.2 MOESI

Adds **Owned (O)**: a state where this cache has the only valid copy (like Modified) but other caches also have copies (like Shared). The owner is responsible for responding to read requests for the line. This avoids a write-back to memory before sharing.

Used by AMD x86 (Opteron and later) and POWER. The "Owned" state reduces memory bandwidth for read-mostly workloads.

### C.3 MESIF

Adds **Forward (F)**: a state designating one cache among multiple Shared copies as the "responder" for read requests. This avoids redundant snoop responses and reduces interconnect traffic.

Used by Intel since Nehalem. Subtle optimisation; programmer doesn't see it directly.

### C.4 Directory-Based Coherence

For very large systems (32+ cores, NUMA), snooping every cache for every operation doesn't scale. Directory-based protocols track which caches hold each line in a centralised (or distributed) directory. Coherence messages go to the directory, which forwards them to the relevant caches.

Modern multi-socket Intel and AMD servers use a hybrid: snoop within a socket, directory across sockets. The performance implication: cross-socket atomic operations are much slower than intra-socket. For Go programs that benchmark cleanly on a single socket but degrade on multi-socket, this is usually the cause.

### C.5 ARM CHI (Coherent Hub Interface)

ARM's modern coherence protocol for large systems (Neoverse, Apple Silicon). Supports up to 1024+ cores with explicit transaction types for various memory ordering semantics. Programmers see it indirectly through performance: well-designed concurrent code scales further on ARM CHI than on older snooping protocols.

---

## Appendix D: A Complete Vyukov MPMC Queue

The Vyukov bounded MPMC queue is the canonical example of a high-performance lock-free data structure. Here is a Go implementation, fully commented.

```go
package vyukov

import (
    "sync/atomic"
    "unsafe"
)

// cellPad pads each cell to a cache line to avoid false sharing.
const cellPadSize = 64

type cell[T any] struct {
    seq  atomic.Uint64
    data T
    _    [cellPadSize - 16]byte // pad for cache-line alignment
}

type Queue[T any] struct {
    buffer    []cell[T]
    mask      uint64
    _         [cellPadSize - 16]byte // pad producer/consumer indices
    enqueuePos atomic.Uint64
    _         [cellPadSize - 8]byte
    dequeuePos atomic.Uint64
}

func NewQueue[T any](size uint64) *Queue[T] {
    // size must be a power of 2
    if size&(size-1) != 0 {
        panic("size must be a power of 2")
    }
    q := &Queue[T]{
        buffer: make([]cell[T], size),
        mask:   size - 1,
    }
    for i := uint64(0); i < size; i++ {
        q.buffer[i].seq.Store(i)
    }
    return q
}

func (q *Queue[T]) Enqueue(item T) bool {
    var c *cell[T]
    pos := q.enqueuePos.Load()
    for {
        c = &q.buffer[pos&q.mask]
        seq := c.seq.Load()
        diff := int64(seq) - int64(pos)
        if diff == 0 {
            if q.enqueuePos.CompareAndSwap(pos, pos+1) {
                break
            }
        } else if diff < 0 {
            return false // queue full
        } else {
            pos = q.enqueuePos.Load()
        }
    }
    c.data = item
    c.seq.Store(pos + 1) // release: makes data visible to consumer
    return true
}

func (q *Queue[T]) Dequeue() (T, bool) {
    var c *cell[T]
    var zero T
    pos := q.dequeuePos.Load()
    for {
        c = &q.buffer[pos&q.mask]
        seq := c.seq.Load()
        diff := int64(seq) - int64(pos+1)
        if diff == 0 {
            if q.dequeuePos.CompareAndSwap(pos, pos+1) {
                break
            }
        } else if diff < 0 {
            return zero, false // queue empty
        } else {
            pos = q.dequeuePos.Load()
        }
    }
    item := c.data
    c.seq.Store(pos + q.mask + 1) // release: makes cell available again
    return item, true
}

var _ = unsafe.Sizeof(cell[int]{}) // keep unsafe import valid
```

How it works:

- Each cell has a sequence number. Initially cell `i` has `seq = i`.
- On enqueue at position `pos`, the producer waits until `cell[pos&mask].seq == pos` (meaning the cell is empty and ready for the producer at this round).
- After writing the data, the producer sets `seq = pos+1` (a "data ready for consumer at this round" marker).
- On dequeue at position `pos`, the consumer waits until `cell[pos&mask].seq == pos+1` (meaning data has been written and is ready to consume).
- After reading the data, the consumer sets `seq = pos + mask + 1` (a "cell ready for producer at the next round" marker).

The brilliance: the sequence number encodes both "what round are we in" and "is data ready." Producers and consumers coordinate without ever touching each other's cells.

The memory ordering: `seq.Store(pos+1)` is a release that ensures the data write is visible *before* the consumer can pass the seq check. `seq.Load()` in the consumer is an acquire. Together they form the producer-consumer handshake.

Cost per enqueue/dequeue under no contention: roughly 30 ns on amd64, 25 ns on arm64. Under heavy contention with N producers and N consumers, the bottleneck is the CAS on `enqueuePos` / `dequeuePos`. Sharding into multiple queues is the usual cure.

---

## Appendix E: Hazard Pointers vs Epoch-Based Reclamation vs RCU

Three solutions to the same problem: in a lock-free data structure, when can you free memory that another reader might still be looking at?

### E.1 Hazard Pointers

Each reader publishes a "hazard pointer" before accessing shared data. Writers check all readers' hazard pointers before freeing. If any reader's hazard pointer matches the to-be-freed address, defer the free.

Pros: bounded memory, fine-grained.
Cons: every read has overhead (publishing the hazard pointer); freeing has overhead (scanning all readers).

Implementation in Go is feasible but uncommon because Go's GC handles the problem differently.

### E.2 Epoch-Based Reclamation (EBR)

Each thread participates in an epoch counter. Threads enter "critical sections" by reading the current epoch. Freeing is deferred until all threads have advanced past the epoch at which the free was scheduled.

Pros: lower per-read overhead than hazard pointers.
Cons: unbounded memory if a thread stalls forever in a critical section.

### E.3 Read-Copy-Update (RCU)

Used heavily in the Linux kernel. Readers don't synchronise with writers at all. Writers make a copy, modify it, atomically swap in the new pointer, and then *wait for a grace period* during which all existing readers complete. Then they free the old version.

Pros: zero overhead on the read path. Excellent for read-mostly data.
Cons: grace period detection is complex; updates are slow.

### E.4 What Go Does Instead

Go's garbage collector eliminates the need for any of these in user code. When you `atomic.Store` a new pointer and all readers eventually load and finish using the old pointer, the GC will eventually collect the old pointer because no goroutine is referencing it.

This is why `atomic.Pointer[T]` is so much simpler in Go than equivalent constructs in C. The GC is doing the heavy lifting that Linux's RCU does manually.

The trade-off: you pay GC cost. For latency-sensitive paths, you might want to allocate carefully (use `sync.Pool`, reuse buffers, etc.) to minimise GC pressure.

---

## Appendix F: Read-Mostly Configuration via `atomic.Pointer[T]` (Go's RCU)

The idiomatic Go pattern for "RCU-style" config:

```go
package config

import (
    "sync/atomic"
)

type Config struct {
    Endpoint string
    Timeout  int
    // ... many fields ...
}

var current atomic.Pointer[Config]

func init() {
    current.Store(&Config{Endpoint: "default", Timeout: 30})
}

func Get() *Config {
    return current.Load()
}

func Update(fn func(*Config) *Config) {
    for {
        old := current.Load()
        new := fn(old)
        if current.CompareAndSwap(old, new) {
            return
        }
    }
}
```

Readers do one `atomic.Load`. Writers build a new config (typically by copying the old one with modifications) and CAS-swap the pointer. The old `*Config` is eventually freed by the GC after all readers have moved on.

This pattern scales to millions of reads per second per core with no contention. Writers compete only with other writers via the CAS loop.

The key invariant: **never mutate a published `*Config`**. Always build a new one. The reader's snapshot is read-only.

---

## Appendix G: Herd7 — A Quick Hands-On

Herd7 is a memory-model simulator. You write a litmus test and a memory-model specification (a "cat" file), and Herd7 enumerates all observable outcomes.

Install on Linux/macOS:

```
opam install herd7
```

A simple SB (store-buffering) test in Herd7 syntax:

```
X86 SB
{ x = 0; y = 0; }
P0          | P1          ;
MOV [x],$1  | MOV [y],$1  ;
MOV EAX,[y] | MOV EAX,[x] ;
exists (0:EAX=0 /\ 1:EAX=0)
```

Run:

```
herd7 sb.litmus
```

Output:

```
Test SB Allowed
States 4
1:EAX=0; 0:EAX=0;
1:EAX=0; 0:EAX=1;
1:EAX=1; 0:EAX=0;
1:EAX=1; 0:EAX=1;
Ok
Witnesses
Positive: 1 Negative: 3
Condition exists (0:EAX=0 /\ 1:EAX=0)
Observation SB Sometimes 1 3
```

The "Sometimes 1 3" means: of the 4 observable states, one matches the "both zero" condition. Confirming x86-TSO allows the SB violation.

For ARM, use the ARM litmus syntax and the AArch64 cat model. For RISC-V, the RVWMO cat model.

This tool is what memory-model researchers use to certify hardware and language specifications. For the senior engineer, knowing it exists and being able to run a simple test is enough.

---

## Appendix H: The Go Memory Model — Section by Section

The Go Memory Model document at `go.dev/ref/mem` is short (a few thousand words) but dense. Here is a section-by-section reading.

### H.1 Program Order

"Within a single goroutine, the happens-before order is the order expressed by the program."

This is the same as in any sequential language. The compiler can reorder *unobservable* operations within a goroutine, but observable behaviour matches program order.

### H.2 Happens Before

The fundamental relation. If `a` happens before `b`, then `b` sees `a`'s effects. The Go memory model defines happens-before via several rules:

- Program order within a goroutine.
- The `go` statement happens before the launched goroutine's first instruction.
- Channel operations: send happens before corresponding receive.
- `sync.Mutex.Unlock` happens before the next `Lock` returns.
- `sync.Once.Do` happens before the next caller's `Do` returns.
- `sync.WaitGroup.Done` happens before `Wait` returns.
- `sync/atomic` operations form a happens-before chain when paired correctly.

### H.3 Synchronization

"Synchronization is achieved through ... `sync` and `sync/atomic` packages, the channel operators, and the `runtime.Goexit` function."

In particular, `time.Sleep` is *not* listed. Don't rely on it for synchronization.

### H.4 Channel Communication

"A send on a channel happens before the corresponding receive from that channel completes."

Note "completes." The receive starts before the send (in some sense), but the *completion* of the receive happens after the send.

### H.5 Locks

"For any `sync.Mutex` or `sync.RWMutex` variable `l` and `n < m`, call `n` of `l.Unlock()` happens before call `m` of `l.Lock()` returns."

This is the formal statement that mutexes form an acquire-release chain.

### H.6 Once

"A single call of `f()` from `once.Do(f)` happens (returns) before any call of `once.Do(f)` returns."

Used for one-time initialization.

### H.7 Atomic Values

"The APIs in the `sync/atomic` package are collectively 'atomic operations' ... If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B."

This is the SC guarantee for `sync/atomic`.

### H.8 What's Not Said

Things you might wish were guaranteed but aren't:

- Pure (non-`sync/atomic`) reads/writes have no cross-goroutine ordering.
- The compiler is free to reorder pure operations even within a goroutine, as long as the single-goroutine observable behaviour is preserved.
- `runtime.Gosched`, `time.Sleep`, and `runtime.LockOSThread` provide no memory ordering guarantees.

---

## Appendix I: Building a Sharded Counter

A common high-performance pattern: shard a counter across CPUs to avoid contention.

```go
package shardedcounter

import (
    "runtime"
    "sync/atomic"
)

type Counter struct {
    shards []shard
}

type shard struct {
    n atomic.Int64
    _ [56]byte // pad to cache line
}

func New() *Counter {
    n := runtime.GOMAXPROCS(0)
    return &Counter{shards: make([]shard, n)}
}

func (c *Counter) Add(delta int64) {
    // Pick a shard. In real code use runtime.procPin() or a
    // hash of the goroutine ID; here we use a simple cheap hash.
    shard := &c.shards[fastrand()%uint32(len(c.shards))]
    shard.n.Add(delta)
}

func (c *Counter) Read() int64 {
    var sum int64
    for i := range c.shards {
        sum += c.shards[i].n.Load()
    }
    return sum
}

// fastrand is a placeholder; in real code use a per-goroutine PRNG.
func fastrand() uint32 {
    return uint32(getRandom())
}
```

Note: the read is not atomic across shards — different shards' values may be from different "times." For counters this is usually acceptable; the value is approximately consistent. For exact reads you'd need a different pattern.

Performance: under 32 goroutines on a 32-core machine, this scales linearly, while a single `atomic.Int64` saturates at 50–100M ops/s. The sharded version reaches 1–2B ops/s.

---

## Appendix J: A Tour of `runtime.lock_futex.go`

Go's mutex slow path on Linux ultimately calls into `runtime.futex`. The relevant file is `runtime/lock_futex.go`.

The structure (simplified):

```go
func lock(l *mutex) {
    // ...
    for {
        v := atomic.Load(key)
        if v == mutex_unlocked {
            if atomic.Cas(key, mutex_unlocked, mutex_locked) {
                return // got the lock
            }
            continue
        }
        // contended: spin briefly, then park.
        if !atomic.Cas(key, v, v|mutex_sleeping) {
            continue
        }
        futexsleep(key, v|mutex_sleeping, -1)
        v = atomic.Load(key)
    }
}
```

Key points:

- The lock is just an integer with three states: unlocked, locked (no waiters), locked + sleepers.
- Fast path: single CAS.
- Slow path: tag the lock with "sleepers waiting" and call `futexsleep` (which is a syscall to `futex(FUTEX_WAIT)` on Linux).
- Unlock: clear the lock; if "sleepers waiting" was set, call `futexwakeup` to wake one waiter.

This is approximately how every modern futex-based mutex works (glibc pthreads, jemalloc internal locks, Rust's `parking_lot`). Go's version is simpler because Go runs its own scheduler and can park goroutines without OS thread changes in many cases.

---

## Appendix K: Comparison of Memory Models in Production Languages

| Language | Default ordering | Weakest available | Strongest available |
|---|---|---|---|
| Go        | SC (sync/atomic)  | (none exposed)     | SC                  |
| Java      | SC (volatile)     | plain field        | SC                  |
| C++       | seq_cst           | relaxed            | seq_cst             |
| Rust      | Choice required   | Relaxed            | SeqCst              |
| C# / .NET | volatile = acquire/release | plain field | Interlocked.Exchange |
| Swift     | (via Atomics)     | relaxed            | seq_cst             |
| Python    | (GIL-serialised)  | (n/a)              | (n/a)               |

Go's "SC only" choice is shared with Java. C++ and Rust expose the full spectrum, paying for it in API complexity.

---

## Appendix L: The Three Hardest Concepts at Senior Level

If you're going to fail an interview at the senior level, it'll be on one of these three:

1. **Multi-copy atomicity.** Confused readers tend to think all architectures are MCA. POWER is not. Knowing this distinguishes seniors from middles.

2. **Release-acquire vs SC.** Many programmers conflate these. Release-acquire is *weaker* than SC: it gives you the message-passing pattern but not the IRIW pattern. Go gives you SC; C++ lets you pick.

3. **Hazard pointers / RCU / GC.** Understanding why Go's GC obviates hazard pointers and RCU, and the cost (GC pressure) involved.

Drill these three until you can explain them on a whiteboard without notes.

---

## Appendix M: Reading Real Production Code

A senior engineer should be able to read `runtime/sema.go`, `runtime/chan.go`, and `runtime/mutex_*.go` end-to-end. These files contain Go's most subtle synchronisation code.

For practice, pick `runtime/sema.go` and answer:

- What invariant guarantees that `semacquire` blocks atomically?
- Where is the futex syscall made?
- How does `semawakeup` deal with the case where multiple goroutines are waiting?

If you can answer these, you understand Go's runtime synchronization at the level a contributor needs.

---

## Appendix N: Practical Performance Tips at Senior Level

Things that will move metrics:

1. **Pad atomics on cache lines.** Always 64 bytes on Linux/Windows; 128 on some ARM and Apple Silicon.

2. **Prefer `atomic.Pointer[T]` over `atomic.Value`.** Type safety and slightly cheaper underneath.

3. **Avoid CAS loops when an unconditional update suffices.** `atomic.AddInt64(&n, 1)` is one instruction; a CAS loop can spin many times.

4. **Shard heavily-contended counters.** As in Appendix I.

5. **Use `sync.RWMutex` only when reads vastly outnumber writes** (say 100:1 or more). Otherwise the read-side bookkeeping dominates.

6. **Profile with `perf c2c` on Linux** to find false sharing and cache-coherence hotspots.

7. **For NUMA systems, pin goroutines to cores** if the algorithm is sensitive to locality. Go doesn't directly support this; use `taskset` or `numactl` from outside.

8. **Use `sync.Pool` to reuse objects** in lock-free data structures to reduce GC pressure.

---

## Appendix O: Production War Story — The "Atomic Map" Anti-Pattern

A team built a custom "atomic map" using `sync.Map` plus `atomic.Pointer[map[K]V]` for value updates. The idea: avoid the cost of `sync.Map`'s loadOrStore by caching pointers to maps.

The bug: the cached map pointer could be loaded by one goroutine and then concurrently mutated by another (via a different write path). Mutating a Go `map` is *never* concurrency-safe, even if the pointer to the map is atomic.

Fix: replace the `map[K]V` with an immutable structure (slice of struct, or an immutable tree). Or use `sync.Map` and accept its cost.

Lesson: **atomic pointer + mutable referent is still a race.** The pointer is safe; the data behind it is not, unless you keep it immutable.

---

## Appendix P: Closing Self-Assessment for Senior

You should be able to:

1. Compare SC, TSO, RVWMO, POWER on the IRIW litmus.
2. Write a RISC-V `FENCE rw, rw` and explain when you'd use it vs `FENCE r, rw`.
3. Implement a Vyukov MPMC queue from memory.
4. Explain why Go's GC eliminates hazard pointers in user code.
5. Read `runtime/sema.go` end-to-end.
6. Run a Herd7 test on a simple litmus.
7. Identify a false-sharing bottleneck from `perf` output.
8. Design a sharded counter for a million writes per second per core.

If you can do five of eight, you are at senior level. The professional file goes still deeper — into TSO replay buffers, fence-free fast paths, persistent memory, and formal verification.

---

End of senior expansion.

---

## Appendix Q: The Memory Model Spectrum Visualised

```
   Stronger                                          Weaker
   --------                                          ------

   SC  ──── TSO ──── PSO ──── RMO ──── WMO ──── RC ──── POWER
   |        |        |        |        |        |        |
   Lamport  x86      SPARC    SPARC    Alpha    ARMv8    POWER
   1979     ?        PSO      RMO              (close)
                                                RISC-V

   |<──────── Multi-Copy Atomic ─────────────>|  Not MCA
```

The X axis is rough strength. The "Multi-Copy Atomic" line marks the boundary between architectures where all observers see stores in the same order, and architectures where they may disagree (POWER).

Go's `sync/atomic` programs to the *SC* level on every architecture. The runtime emits whatever fences are needed to lift the architecture-level guarantees to SC.

---

## Appendix R: One More War Story — The "Sequential" Wait

A team had this code:

```go
func (s *Service) ShutdownGracefully() {
    s.shutdownRequested.Store(true)
    for s.activeRequests.Load() > 0 {
        time.Sleep(10 * time.Millisecond)
    }
    s.closeConnections()
}
```

Worked in tests. In production, occasionally `closeConnections` was called while requests were still in flight, leading to dropped connections.

Investigation: `s.activeRequests` was being decremented by request handlers in their `defer`. The decrement was an `atomic.Add(-1)`. So far so good.

But: some request handlers were spawning *child* goroutines that did real work (like sending audit logs). The child goroutines didn't participate in `activeRequests`. When the main handler's `defer` decremented the counter, the child goroutine was still running, and the audit log used resources that `closeConnections` had freed.

The bug wasn't in the atomic — the atomic was correct. The bug was the assumption that "active requests" tracked the actual work. Once spawned, child goroutines outlived the request.

Lesson: atomic counters track what you tell them to track. Make sure that aligns with what you actually need to wait for. Often, a `sync.WaitGroup` per "logical work unit" is clearer than a global counter.

---

## Appendix S: Final Recap of Senior-Level Material

The senior level extends the middle level along three axes:

1. **More architectures:** RISC-V WMO and POWER, beyond just x86 and ARM.
2. **More algorithms:** Vyukov MPMC queue, sharded counters, RCU-style configuration.
3. **More tools:** Herd7, `perf c2c`, runtime source reading.

If you carry these forward, the professional file's discussion of microarchitectural buffers, fence-free fast paths, and formal verification will land smoothly.

End.

---

## Appendix T: A Deeper Walk Through Go's Channel Implementation

`runtime/chan.go` is one of the densest files in the Go runtime. A senior should be able to read it. Here's a guided tour.

### T.1 The `hchan` Structure

```go
type hchan struct {
    qcount   uint           // number of items in the queue
    dataqsiz uint           // size of the circular queue
    buf      unsafe.Pointer // pointer to dataqsiz array of elements
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint           // send index
    recvx    uint           // receive index
    recvq    waitq          // list of recv waiters
    sendq    waitq          // list of send waiters
    lock     mutex
}
```

Key observations:

- A channel has a built-in mutex (`lock`). All operations take this mutex first.
- The queue (`buf`) is a circular buffer of `dataqsiz` elements.
- Waiters are tracked in `recvq` and `sendq`.

So a channel is not lock-free; it's a mutex-protected queue plus waiter lists. The mutex is held only briefly per operation.

### T.2 The Send Path (Buffered Channel)

For `ch <- v` on a buffered channel:

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    // ...
    lock(&c.lock)
    if c.closed != 0 {
        unlock(&c.lock)
        panic("send on closed channel")
    }
    if sg := c.recvq.dequeue(); sg != nil {
        // a receiver is waiting; hand off directly
        send(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true
    }
    if c.qcount < c.dataqsiz {
        // buffer not full; copy into buffer
        qp := chanbuf(c, c.sendx)
        typedmemmove(c.elemtype, qp, ep)
        c.sendx++
        if c.sendx == c.dataqsiz {
            c.sendx = 0
        }
        c.qcount++
        unlock(&c.lock)
        return true
    }
    // buffer full; block or return
    // ...
}
```

Walk through:

1. Take the channel lock.
2. If a receiver is waiting, hand off the value directly to them (the receiver picks it up from the sender's stack — clever optimisation).
3. Otherwise, if there's room in the buffer, copy the value in.
4. Otherwise, block: put yourself on the `sendq` and park.

The mutex provides all the synchronisation. Within the locked region, the operations are sequentially consistent (mutex acquire/release sandwich them).

### T.3 The Direct Hand-Off Optimisation

The `send(c, sg, ep, ...)` function copies the value directly from the sender's `ep` to the receiver's `sg.elem`. This avoids putting the value in the channel buffer at all. Memory bandwidth-wise it's a single copy instead of two. The receiver is then unparked.

The memory model: this direct hand-off is still subject to the mutex's release/acquire semantics, plus the runtime's goroutine park/unpark which involves its own barriers. The net effect: the receiver sees all the sender's prior writes.

### T.4 Closed Channels

A closed channel always succeeds on receive (returning the zero value). This is implemented by setting `c.closed = 1`. When receivers wake up, they check `closed` before reading.

The close operation itself takes the channel lock, sets `closed`, then wakes all waiters. The wakeups happen *after* `closed` is set, so any waiter that receives subsequently sees `closed == 1`.

### T.5 Why This Matters for Memory Ordering

Channels are a high-level synchronisation primitive that internally uses mutexes (and the runtime semaphore). The result: channels give you happens-before edges between send and receive, just as the memory model document states. The mechanism is "mutex + wait list," not lock-free atomics.

For performance, channels cost ~50–80 ns per operation under no contention. That's higher than a raw atomic but much lower than a syscall. For most application code, channels are the right tool.

---

## Appendix U: Building a Lock-Free Stack

A simpler lock-free structure than the MPMC queue. Useful as a freelist for object pools.

```go
package lfstack

import (
    "sync/atomic"
)

type Node struct {
    Value int
    next  *Node
}

type Stack struct {
    head atomic.Pointer[Node]
}

func (s *Stack) Push(n *Node) {
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}

func (s *Stack) Pop() *Node {
    for {
        old := s.head.Load()
        if old == nil {
            return nil
        }
        next := old.next
        if s.head.CompareAndSwap(old, next) {
            old.next = nil
            return old
        }
    }
}
```

Look correct? It has a classic bug: the **ABA problem**.

ABA scenario:

1. Thread 1 reads `head = A`, computes `next = A.next = B`.
2. Thread 2 pops `A`, pops `B`, pushes `A` back. Now head is `A` but `A.next` is something else (say `C`).
3. Thread 1's CAS succeeds (the head is still `A`), but it sets head to `B`, which has been freed!

In C this is fatal. In Go, the GC saves us — `B` won't be freed while thread 1 still has a pointer to it. So in Go, this stack is **safe** under typical GC behaviour, but only because GC keeps unreachable nodes from being collected.

Caveat: if you put a finalizer on `Node`, or use `runtime.SetFinalizer` weirdly, the GC may not save you. Stick to the pure GC model.

For ABA-resistant implementations in non-GC languages, you typically use a tagged pointer (`atomic_load(&head_with_version)`), where each push increments the version. The CAS checks both pointer and version. Go's stdlib doesn't expose tagged pointers; you'd need `unsafe` gymnastics.

---

## Appendix V: A Subtle Bug — Atomic Read of an Untagged Pointer

A senior-level "gotcha":

```go
type Node struct {
    value int
    next  *Node
}

var head atomic.Pointer[Node]

func find(v int) *Node {
    n := head.Load()
    for n != nil {
        if n.value == v {
            return n
        }
        n = n.next // plain read of next!
    }
    return nil
}
```

`n.next` is a plain field read. If another goroutine is concurrently modifying `n.next`, this is a data race.

The fix depends on what you want:

- If `Node.next` is only set at construction time and never modified, the plain read is fine — the publication via `head.Load()` provides the happens-before.
- If `Node.next` can be modified after publication, you need to make `next` itself an `atomic.Pointer[Node]`.

This pattern is the basis of every lock-free linked list. Whether the linked list is correct depends on whether its links are immutable after publication.

---

## Appendix W: GC and Memory Barriers — The Forward Reference

The professional file goes deep on this; here's the senior preview.

Go's garbage collector uses two kinds of "barrier" internally:

1. **Write barriers** (software): inserted before pointer writes to inform the GC. Affects pointer fields in heap objects.

2. **Memory barriers** (hardware fences): the topic of this entire file. Used for cross-goroutine synchronisation.

These are *distinct concepts* that share a name. The GC's write barrier is a software-level hook; it does not emit `MFENCE`/`DMB`/`FENCE rw,rw`. It is purely for GC correctness (tri-color invariant maintenance).

However, the two interact subtly. When the GC sets STW (stop-the-world), it must ensure that all goroutines have observed the STW flag and parked. This involves true hardware barriers in the runtime's STW machinery. The actual user-facing pointer writes during normal mutator operation use only the *software* GC write barrier.

For a senior engineer, the takeaway is: when you read about "Go write barriers," look at context. If it's GC code, it means software pointer-write hooks. If it's memory-model code, it means hardware fences.

---

## Appendix X: Reading `runtime/sema.go`

`sema.go` implements Go's runtime semaphore, the primitive on which `sync.Mutex`, `sync.WaitGroup`, `sync.Cond`, and `channel` waiters are built.

The key functions:

- `semacquire(addr *uint32)`: block until `*addr > 0`, then decrement.
- `semrelease(addr *uint32)`: increment `*addr`, wake one waiter if any.

The data structure is a **treap** (tree + heap) keyed by the semaphore address. Each treap node holds a queue of goroutines waiting on that address.

Operations:

```go
func semacquire(addr *uint32) {
    if cansemacquire(addr) {
        return // fast path: just decrement
    }
    // slow path: find/create treap node, add ourselves to wait queue,
    // park the goroutine.
    s := acquireSudog()
    root := semroot(addr)
    for {
        lock(&root.lock)
        if cansemacquire(addr) {
            unlock(&root.lock)
            releaseSudog(s)
            return
        }
        root.queue(addr, s)
        goparkunlock(&root.lock, ...)
        if cansemacquire(addr) {
            return
        }
    }
}
```

Memory model implications:

- `cansemacquire` does an atomic CAS on `addr`.
- The treap lock (`root.lock`) is a futex-based mutex.
- `gopark` parks the goroutine, releasing the runtime scheduler.

The whole thing forms a happens-before chain: a `semrelease` that wakes a goroutine establishes that the releaser's writes are visible to the awakened goroutine.

Reading this file teaches you how the runtime composes atomic primitives, futex syscalls, and scheduler interaction. Highly recommended.

---

## Appendix Y: NUMA-Aware Programming

On a multi-socket server, memory accesses to "remote" sockets are 2–4x slower than local. Atomic operations on remote cache lines can be 5–10x slower due to cross-socket coherence traffic.

Mitigations:

1. **Pin work to a socket.** Use `numactl --cpunodebind=0 --membind=0 ./your-binary` to keep everything on socket 0.

2. **Per-CPU data structures.** Replicate state per core; aggregate on read. Like the sharded counter from Appendix I.

3. **Avoid migration of hot atomics.** Once a cache line is "owned" by a socket, keep it there. Random migration is expensive.

4. **NUMA-aware allocators.** `jemalloc` and `tcmalloc` have NUMA support; Go's allocator does not (yet).

For Go programs, the simplest fix is `numactl` from outside. For more control, build a "shard per logical core" pattern; Go's runtime tries to keep a goroutine on the same OS thread (and hence core) when possible.

---

## Appendix Z: Performance Counters for Memory Ordering Bugs

`perf stat` on Linux exposes hardware performance counters that can help diagnose memory-ordering bottlenecks.

Useful counters:

- `cache-misses`: total cache misses.
- `LLC-loads`, `LLC-stores`: last-level cache traffic.
- `mem_inst_retired.lock_loads` (Intel): number of locked loads (atomic operations).
- `mem_inst_retired.split_loads` (Intel): unaligned loads (slow).
- `cycle_activity.stalls_l3_miss` (Intel): cycles stalled on L3 misses.

For multi-socket systems:

- `offcore_response.demand_data_rd.l3_hit.snoop_hitm`: how many loads were satisfied by snooping another socket's modified cache line. High values indicate cross-socket coherence traffic — a sign of contention or false sharing across sockets.

On AMD:

- `l3_cache_accesses.all`, `l3_cache_misses.all`: L3 traffic.
- `mab_alloc_pipe.dc`: data cache miss address buffer allocations.

Run with:

```
perf stat -e cache-misses,LLC-loads,LLC-stores,cycles,instructions ./your-binary
```

For more detail:

```
perf c2c record -F 99 ./your-binary
perf c2c report
```

`perf c2c` is the gold standard for finding false sharing in production. It shows you cache lines with high cross-socket access patterns.

---

## Appendix AA: Designing for Lock-Free Composability

A common pitfall: composing two lock-free data structures can re-introduce races.

Example: you have a lock-free queue (Vyukov) and a lock-free counter. You want to "dequeue and increment a stat" atomically. There is no way to do this with just the two primitives — the queue dequeue and the counter increment are separate operations.

Solutions:

1. **Combine into one operation.** Embed the counter logic into the queue (e.g., add a side-channel for stats).

2. **Tolerate eventual consistency.** Increment the counter slightly out-of-sync with the dequeue. Usually fine for metrics.

3. **Use a transactional structure.** Some lock-free libraries support multi-word CAS (DCAS, k-CAS); Go doesn't.

4. **Fall back to a mutex.** If you need true atomicity across multiple steps, a mutex is often simpler than chaining lock-free primitives.

The senior insight: lock-free is not a "drop-in replacement" for locks. It's a different programming model with different trade-offs. Don't reach for it just because it sounds faster.

---

## Appendix AB: How `sync.Once` Works Under the Hood

```go
type Once struct {
    done uint32
    m    Mutex
}

func (o *Once) Do(f func()) {
    if atomic.LoadUint32(&o.done) == 0 {
        o.doSlow(f)
    }
}

func (o *Once) doSlow(f func()) {
    o.m.Lock()
    defer o.m.Unlock()
    if o.done == 0 {
        defer atomic.StoreUint32(&o.done, 1)
        f()
    }
}
```

Trace through:

1. Fast path: atomic load of `done`. If 1, we're done — no fence work needed beyond the load's acquire.
2. Slow path: take the mutex. Re-check under the lock (double-checked locking, classic pattern). If still 0, run `f` and set `done` atomically.

Why is this correct?

- The `atomic.StoreUint32(&o.done, 1)` is the *last* operation in the slow path (deferred). It releases all of `f`'s writes.
- The `atomic.LoadUint32(&o.done) == 0` check on the fast path is an acquire. If it observes 1, it has a happens-before relationship with the store, which means it also has happens-before with everything `f` did.

So callers who hit the fast path on subsequent calls see all of `f`'s effects. The double-check pattern works because the atomic store and load form the synchronisation edge; the mutex protects against concurrent first-time callers.

Without the atomic load on the fast path, this would be a classic broken double-checked locking pattern (which is why Java's `volatile` was upgraded to SC in JSR-133).

---

## Appendix AC: How `sync.WaitGroup` Works

```go
type WaitGroup struct {
    state1 [3]uint32 // counter + waiter count + sema
}

func (wg *WaitGroup) Add(delta int) {
    statep, semap := wg.state()
    state := atomic.AddUint64(statep, uint64(delta)<<32)
    v := int32(state >> 32)
    w := uint32(state)
    if v == 0 && w != 0 {
        // counter hit zero; wake all waiters
        for ; w != 0; w-- {
            runtime_Semrelease(semap, false, 0)
        }
    }
}

func (wg *WaitGroup) Wait() {
    statep, semap := wg.state()
    for {
        state := atomic.LoadUint64(statep)
        v := int32(state >> 32)
        if v == 0 {
            return
        }
        // increment waiter count
        if atomic.CompareAndSwapUint64(statep, state, state+1) {
            runtime_Semacquire(semap)
            // Re-check (or just return if invariants hold)
            return
        }
    }
}
```

Memory model:

- `Add(-1)` (i.e., `Done`) is atomic and forms a release with respect to whatever the worker did.
- `Wait` does an atomic load of the counter, acquires when it observes zero.

The semantics: every `Done` happens-before `Wait` returns. The runtime achieves this via the atomic load/store on the counter, plus the futex-based wakeup.

---

## Appendix AD: A Word on `unsafe.Pointer` and Memory Ordering

Sometimes you need to do truly low-level memory manipulation. `unsafe.Pointer` lets you bypass Go's type system. **It does not bypass the memory model.**

If you use `unsafe.Pointer` to load a value, you have done a plain load — no fence. The compiler can reorder it freely. The CPU can reorder it according to the architecture's rules.

The runtime exposes `runtime/internal/atomic.Loadp` for fenced pointer loads in runtime code. User code does not have access to it. The user-facing equivalent is `atomic.LoadPointer` (deprecated in favour of `atomic.Pointer[T]`).

Rule of thumb: if you find yourself reaching for `unsafe.Pointer` plus manual atomic loads, you are in dangerous territory. Use `atomic.Pointer[T]` instead.

---

## Appendix AE: A Subtle Issue with `defer` and Atomics

```go
func update() {
    defer atomic.StoreInt32(&done, 1)
    doWork()
}
```

Is this correct? The atomic store happens after `doWork` returns. But the *order* of operations relative to other goroutines reading `done` depends on when the defer fires.

Specifically: `defer` runs *during* function return. The atomic store is the last thing in the function. So reader goroutines that see `done == 1` will also see `doWork`'s effects.

But: if `doWork` itself launched goroutines that write to other shared state, those writes are not synchronised with `done`. You'd need an explicit `sync.WaitGroup.Wait()` inside `doWork` to ensure they're done.

Senior-level gotcha: deferred atomics do not synchronise with goroutines spawned by the deferring function unless those goroutines have already completed.

---

## Appendix AF: Closing Mental Model for Senior

The senior-level mental model is:

> **Memory consistency is a contract between the programmer, the language runtime, and the hardware. The contract on different architectures is different — SC, TSO, RVWMO, POWER — but Go's runtime presents a uniform SC view via `sync/atomic`. The cost of that uniformity is paid in barrier instructions, which vary in price across ISAs. Understanding the underlying contract lets you reason about performance and debug exotic failures.**

Carry this forward into the professional file, which will explore the deepest layers: microarchitectural buffers, fence-free fast paths, persistent memory ordering, and formal verification.

End — and this time, really.

---

## Appendix AG: One Final Drill — Match the Architecture to the Behaviour

Given the litmus test outcome, identify the most relaxed architecture that *could* produce it.

1. SB pattern, both reads see 0. → x86-TSO or weaker.
2. MP pattern, reader sees flag=1 but data=0. → ARMv8 weak (or weaker).
3. IRIW pattern, two observers disagree on store order. → POWER (only non-MCA).
4. LB pattern, both reads see 1. → ARMv8 weak or weaker.
5. WRC pattern, transitive visibility fails. → Non-MCA (POWER).

This drill is worth doing whenever you suspect a memory-ordering bug. Even if Go protects you on production code, knowing which architectures *would* exhibit each pattern helps you reason about Go runtime code and other systems.

End.

---

## Appendix AH: A Complete Treatment of the WRC Litmus

**WRC** (Write-to-Read Causality) tests transitive visibility:

```
Thread A     Thread B           Thread C
x = 1        r1 = x; y = 1      r2 = y; r3 = x
```

Question: can `r1 == 1`, `r2 == 1`, `r3 == 0`?

In words: B sees A's write to x, then writes y. C sees B's write to y, but does C see A's write to x?

- **SC, TSO, ARMv8 (MCA):** Forbidden. Transitive: A's write must propagate by the time C sees y=1.
- **POWER (not MCA):** Allowed. C can see y=1 (from B) before A's write to x has reached C.

This is why POWER needs `sync` (heavy barrier) and not just `lwsync` in the message-passing pattern under certain circumstances. The naive `lwsync` pattern works on ARMv8 because it's MCA; on POWER you need a stronger fence on every observer.

This is one of the subtlest differences in production memory models, and it matters when porting low-level lock-free code from one architecture to another.

---

## Appendix AI: Building a Lock-Free Bounded Channel

The Vyukov queue from Appendix D is bounded. Let's compare it to Go's built-in channel.

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "testing"
    "time"
)

const (
    N = 1024
    items = 1_000_000
)

// Built-in channel
func BenchmarkChannel(b *testing.B) {
    for i := 0; i < b.N; i++ {
        ch := make(chan int, N)
        var wg sync.WaitGroup
        wg.Add(2)
        go func() {
            defer wg.Done()
            for j := 0; j < items; j++ {
                ch <- j
            }
            close(ch)
        }()
        go func() {
            defer wg.Done()
            for range ch {
            }
        }()
        wg.Wait()
    }
}

// Vyukov queue
func BenchmarkVyukov(b *testing.B) {
    for i := 0; i < b.N; i++ {
        q := NewQueue[int](N)
        var wg sync.WaitGroup
        var done atomic.Bool
        wg.Add(2)
        go func() {
            defer wg.Done()
            for j := 0; j < items; j++ {
                for !q.Enqueue(j) {
                    runtime.Gosched()
                }
            }
            done.Store(true)
        }()
        go func() {
            defer wg.Done()
            count := 0
            for count < items {
                if _, ok := q.Dequeue(); ok {
                    count++
                } else if done.Load() {
                    if _, ok := q.Dequeue(); ok {
                        count++
                    }
                } else {
                    runtime.Gosched()
                }
            }
        }()
        wg.Wait()
    }
}
```

Typical results on a 32-core machine:

```
BenchmarkChannel    250ms/op  (4M ops/sec)
BenchmarkVyukov      80ms/op  (12.5M ops/sec)
```

Vyukov is ~3x faster. The reasons:

1. **No mutex.** Channels acquire a mutex per operation; Vyukov uses CAS only.
2. **Cache-line padding.** Vyukov pads cells; channels do not pad indices.
3. **Direct hand-off elision.** Channels have a clever hand-off optimisation, but it triggers only at exactly-matched pairs.

However:

- Vyukov is much harder to use correctly (the spinning consumer pattern).
- Channels support `select`, closing, and reflection.
- For typical Go application code, the channel API ergonomics outweigh the performance difference.

When would you choose Vyukov over a channel? In a hot path measured to be channel-bound, with no need for `select` or closing semantics. Otherwise stick with channels.

---

## Appendix AJ: Tour of `runtime/proc.go` — The Scheduler

The Go scheduler (`runtime/proc.go`) coordinates goroutines, OS threads (M), and logical processors (P). The memory-ordering implications:

### AJ.1 Park/Unpark

`runtime.gopark` puts a goroutine to sleep. `runtime.goready` wakes it. The two functions establish a happens-before edge: whatever the parker had committed to memory before parking, the unparker observes; whatever the unparker did before waking, the awakened sees.

Internally, park/unpark use atomic CAS on the goroutine's status word plus the runqueue manipulation, all protected by per-P locks.

### AJ.2 Work-Stealing

When a P runs out of work, it tries to steal goroutines from another P's runqueue. This is implemented with atomic operations on the runqueue's head/tail pointers — a lock-free deque.

The memory ordering: when a stolen goroutine is picked up by the stealer, its prior state is fully visible (the runqueue manipulation uses atomic operations that form acquire/release pairs).

### AJ.3 STW (Stop-the-World)

When the GC needs to pause all goroutines, it sets a flag and waits until every P observes it. The synchronisation here uses heavyweight atomics and barriers. The cost: typically <1 ms on modern Go, but during STW no mutator can make progress.

### AJ.4 Implications for Application Code

You don't directly interact with the scheduler's atomics. But understanding that goroutine spawn, park, unpark, and STW all use heavyweight synchronisation explains:

- Why spawning a goroutine costs ~150 ns.
- Why a channel send/recv pair costs ~50–80 ns.
- Why STW pauses are observable in latency-sensitive workloads.

---

## Appendix AK: Garbage Collection Interaction with Atomics

A subtle topic: when the GC scans the heap, it reads pointer fields. If those fields are being concurrently written by a mutator goroutine, what guarantees correctness?

Answer: the GC write barrier. Every write to a heap pointer goes through:

```
*ptr = new_value
gcWriteBarrier(ptr, new_value)
```

The write barrier records the old and new values in a per-goroutine buffer, which is flushed periodically. The GC consumes this buffer to maintain the **tricolor invariant** (no white object reachable only from black objects).

This is a *software* protocol. It does not, by itself, emit hardware fences. However, the underlying pointer write must still respect the memory model:

- For atomic pointers (`atomic.Pointer[T]`), the store is a full SC operation.
- For plain pointer field writes (which can only happen via single-goroutine code or under a mutex), the pointer assignment is implicit; the GC write barrier wraps it.

Subtle case: an `unsafe.Pointer` write does *not* invoke the GC write barrier (because the type system doesn't know it's a pointer). This is one reason `unsafe.Pointer` is dangerous — you can corrupt the GC's bookkeeping.

For the senior engineer: when working with `atomic.Pointer[T]`, you get both the hardware fence *and* the GC write barrier integration. When dropping to `unsafe.Pointer` plus manual atomic, you get the fence but **not** the write barrier. Stick with `atomic.Pointer[T]` unless you have a very good reason.

---

## Appendix AL: A Production Postmortem — Lock-Free Queue Memory Leak

A team replaced their channel-based job queue with a Vyukov MPMC queue for a 3x throughput improvement. After a week in production, memory usage climbed unboundedly.

Investigation: the Vyukov queue's `data` field held references to job objects. After dequeue, the implementation did:

```go
item := c.data
c.seq.Store(pos + q.mask + 1)
return item, true
```

But it didn't clear `c.data`. The cell still held a reference to the job object, even after the consumer received it. As long as the cell wasn't reused, the GC saw the cell as still pointing to the job — keeping it alive.

Fix:

```go
item := c.data
var zero T
c.data = zero // explicitly clear the reference
c.seq.Store(pos + q.mask + 1)
return item, true
```

Now the cell holds no reference after dequeue, and the GC can collect the job.

Lesson: lock-free data structures interact with Go's GC in ways that C lock-free structures don't. You must explicitly clear references after handoff. The single line `c.data = zero` makes the difference between a working queue and a memory leak.

---

## Appendix AM: Building a Read-Mostly Trie with `atomic.Pointer`

For read-heavy lookups, an immutable trie published via `atomic.Pointer` is an elegant pattern.

```go
package trie

import "sync/atomic"

type Node struct {
    children map[byte]*Node // immutable after construction
    value    string
}

type Trie struct {
    root atomic.Pointer[Node]
}

func (t *Trie) Get(key string) (string, bool) {
    n := t.root.Load()
    if n == nil {
        return "", false
    }
    for i := 0; i < len(key); i++ {
        next, ok := n.children[key[i]]
        if !ok {
            return "", false
        }
        n = next
    }
    return n.value, n.value != ""
}

func (t *Trie) Update(fn func(root *Node) *Node) {
    for {
        old := t.root.Load()
        new := fn(old)
        if t.root.CompareAndSwap(old, new) {
            return
        }
    }
}
```

The `Get` path is fully lock-free: one atomic load, then plain map lookups (safe because the trie is immutable).

The `Update` path is "copy on write": the function `fn` builds a new trie tree (typically by reusing unchanged subtrees) and CAS-publishes it. Readers see either the old trie or the new one, never a mix.

This pattern scales to millions of reads per second per core with no contention. Writes scale by the cost of building the new tree — typically O(log n) for a balanced trie.

The same pattern works for hash maps (immutable hash array mapped tries), sorted sets, and any read-heavy data structure where you can afford copy-on-write.

---

## Appendix AN: A Survey of Lock-Free Algorithms

What's actually possible lock-free?

| Data structure | Lock-free algorithms | Difficulty |
|---|---|---|
| Counter | Single atomic add | Trivial |
| Stack | Treiber stack (CAS on head) | Easy |
| Queue | Michael-Scott, Vyukov | Medium |
| Hash map | Cliff Click's, Maged Michael's | Hard |
| Skip list | Concurrent skip lists | Medium |
| BST | Bronson AVL, lock-free RBT | Hard |
| B-tree | Several (Bw-tree, etc.) | Very hard |
| Linked list | Harris's, MS-queue subset | Medium |
| Sorted set | Skip list or BST based | Hard |

The pattern: simpler structures have well-known lock-free algorithms; complex structures get harder. For most application code, **lock-free is not the right tool**. Use a `sync.Mutex` or `sync.RWMutex` and only reach for lock-free when profiling proves it's the bottleneck.

For Go specifically, `sync.Map` is the standard lock-free-ish hash map for "write once / read many" patterns. It's not appropriate for write-heavy workloads.

---

## Appendix AO: Channels vs Atomics — When To Pick Which

Senior-level decision-making:

**Use channels when:**

- You're passing *data* between goroutines.
- You want to wait for a specific event ("the producer is done").
- You have natural backpressure semantics.
- Clarity matters more than raw performance.

**Use atomics when:**

- You're coordinating *state* (flags, counters, pointers).
- The hot path can be one or two atomic operations.
- The data is single-word (or wraps a single-pointer publish).

**Use mutexes when:**

- You're protecting multiple related fields.
- The critical section is small (microseconds).
- You don't want to think about memory ordering.

**Use RWMutex when:**

- You have many readers and few writers.
- Reads are fast enough that the read-lock overhead is worth it.
- You can tolerate writer starvation under heavy read load.

The rule of thumb: start with a `sync.Mutex` or channel. Profile. Move to atomics only if the synchronisation overhead is measurably the bottleneck.

---

## Appendix AP: Concurrency Patterns Cheat Sheet for Senior

### AP.1 Singleton Initialisation

```go
var (
    once     sync.Once
    instance *Service
)

func Get() *Service {
    once.Do(func() {
        instance = &Service{}
    })
    return instance
}
```

### AP.2 Read-Mostly Config

```go
var config atomic.Pointer[Config]

func Get() *Config { return config.Load() }
func Update(c *Config) { config.Store(c) }
```

### AP.3 Single-Producer Single-Consumer Queue

```go
ch := make(chan T, capacity)
go producer(ch)
go consumer(ch)
```

(For SPSC, a hand-rolled ring buffer with atomic head/tail can be 5-10x faster than a channel, but the complexity rarely pays off.)

### AP.4 Worker Pool

```go
jobs := make(chan Job, 100)
results := make(chan Result, 100)
for i := 0; i < n; i++ {
    go worker(jobs, results)
}
```

### AP.5 Graceful Shutdown

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
go work(ctx)
// ... when shutdown wanted:
cancel()
```

### AP.6 Bounded Concurrency

```go
sem := make(chan struct{}, limit)
for _, item := range items {
    sem <- struct{}{}
    go func(item Item) {
        defer func() { <-sem }()
        process(item)
    }(item)
}
```

### AP.7 Fan-In

```go
out := make(chan T)
var wg sync.WaitGroup
for _, ch := range channels {
    wg.Add(1)
    go func(c <-chan T) {
        defer wg.Done()
        for v := range c {
            out <- v
        }
    }(ch)
}
go func() { wg.Wait(); close(out) }()
```

### AP.8 Fan-Out

```go
for i := 0; i < n; i++ {
    go func() {
        for v := range in {
            process(v)
        }
    }()
}
```

Memorise these. They cover ~95% of production Go concurrency code.

---

## Appendix AQ: When Atomics Aren't Enough — Multi-Word Updates

If you need to atomically update two related fields, you cannot do it with `sync/atomic` directly. Options:

1. **Pack into a single 64-bit word.** Two 32-bit fields in one int64. Useful for counter pairs.

2. **Embed in a struct, atomic.Pointer the struct.** As shown above.

3. **Use a mutex.** Simplest.

4. **Use a sequence lock.** For read-mostly multi-word state.

5. **Use TM (Transactional Memory).** Intel TSX exists but is rarely used; Go doesn't expose it.

For Go application code, options 2 and 3 cover everything. Reach for 1 only when profiling has identified the synchronisation as a bottleneck.

---

## Appendix AR: The Senior Engineer's Mental Checklist for Concurrent Code

Before merging concurrent code, ask:

1. Is every cross-goroutine read or write protected (atomic, mutex, channel)?
2. Are there any goroutines spawned from inside a function that outlive it?
3. Is `defer mu.Unlock()` matched with the `mu.Lock()` at the right scope?
4. Does the code pass `go test -race`?
5. Is there a bounded-concurrency limiter on goroutine spawn?
6. Is shutdown handled gracefully (no leaked goroutines)?
7. Is the channel buffer size appropriate?
8. Are there any cache-line padding issues on hot atomics?
9. Is there a NUMA-cross-socket access pattern that should be avoided?
10. Have you reasoned about what happens if a goroutine panics inside a critical section?

This checklist catches 80% of concurrency bugs at code review.

---

## Appendix AS: Senior-Level Summary

The senior file adds depth across three dimensions:

- **Multiple architectures.** RISC-V, POWER, the full memory-model spectrum.
- **Lock-free algorithms.** Vyukov MPMC, Treiber stack, copy-on-write tries.
- **Runtime internals.** Reading `runtime/sema.go`, `runtime/chan.go`, the scheduler.

If you've absorbed all the appendices, you should be comfortable contributing to the Go runtime, reviewing concurrent code in any major language, and debugging architecture-specific concurrency failures.

The professional file goes the final mile: microarchitectural buffers, formal verification, non-temporal stores, persistent memory, and the edges of what's possible in production lock-free systems.

---

## Appendix AT: Final War Story — The "Atomic Boolean That Wasn't"

A team noticed that their service occasionally returned stale data even after invalidating a cache. Investigation:

```go
type Cache struct {
    data    sync.Map
    invalid atomic.Bool
}

func (c *Cache) Invalidate() {
    c.invalid.Store(true)
    c.data.Range(func(k, _ any) bool {
        c.data.Delete(k)
        return true
    })
    c.invalid.Store(false)
}

func (c *Cache) Get(k string) (any, bool) {
    if c.invalid.Load() {
        return nil, false
    }
    return c.data.Load(k)
}
```

Bug: `Get` checks `invalid` first, then calls `data.Load`. If `Invalidate` runs *between* the check and the `Load`, the consumer sees the cache as valid but reads a value that's about to be deleted (or just was).

Lock-free? Sort of. Correct? No.

Fix: use a sequence number.

```go
type Cache struct {
    data sync.Map
    seq  atomic.Uint64
}

func (c *Cache) Invalidate() {
    c.data.Range(func(k, _ any) bool {
        c.data.Delete(k)
        return true
    })
    c.seq.Add(1)
}

func (c *Cache) Get(k string) (any, bool) {
    s1 := c.seq.Load()
    v, ok := c.data.Load(k)
    s2 := c.seq.Load()
    if s1 != s2 {
        return nil, false // invalidation occurred during our read
    }
    return v, ok
}
```

Now the read is a sequence-check: if `seq` changed during the read, we retry or return failure.

Lesson: lock-free design requires careful invariant analysis. A single atomic boolean is rarely enough.

---

End of senior-level expansion.

---

## Appendix AU: A Deep Dive Into x86 LOCK Prefix Semantics

The `LOCK` prefix is the workhorse of x86 atomics. Time to understand it precisely.

### AU.1 What LOCK Does

The Intel SDM (Volume 3, Chapter 8) specifies that a `LOCK`-prefixed instruction:

1. Asserts the `LOCK#` signal (or cache-line lock) for the duration.
2. Prevents any other agent (CPU or DMA) from accessing the same memory location.
3. Implies a serialising barrier — all prior loads and stores are completed before the locked operation begins; the locked operation completes before any subsequent memory access starts.

The serialising behaviour is what makes `LOCK` a *full StoreLoad fence*. Without it, `XADD` or `CMPXCHG` would still be atomic but wouldn't drain the store buffer.

### AU.2 Which Instructions Accept LOCK

Per the SDM, `LOCK` can prefix:

- `ADD`, `ADC`, `AND`, `BTC`, `BTR`, `BTS`, `CMPXCHG`, `CMPXCHG8B`, `CMPXCHG16B`, `DEC`, `INC`, `NEG`, `NOT`, `OR`, `SBB`, `SUB`, `XADD`, `XCHG`, `XOR`.

Note: `MOV` does *not* accept `LOCK`. To make a store atomic-and-fenced, you use `XCHG` (which is implicitly locked).

### AU.3 Cache-Line Lock vs Bus Lock

Older CPUs (Pentium 4 era) asserted the system bus lock signal, blocking *all* memory traffic during the locked op. Modern CPUs (since Core 2) use **cache-line locking**: only the targeted cache line is locked; other lines remain accessible.

The exception: if the operand straddles two cache lines (unaligned access), the CPU falls back to bus locking, which is much slower (sometimes 10-100x). Always align your atomic operands.

### AU.4 LOCK vs MFENCE

When you need *only* a StoreLoad fence (no memory operation), use `MFENCE`. When you need an atomic memory op *plus* a StoreLoad fence, use `LOCK`-prefixed instruction. The latter is more common because most concurrent code is doing some atomic op at the barrier.

Modern CPUs implement `MFENCE` slightly differently than a `LOCK`-prefixed dummy op. On Skylake-era Intel, `MFENCE` can be marginally faster (~5 ns) than a `LOCK ADD $0, (RSP)` no-op (~10 ns). This is why some compilers emit `MFENCE` and others emit `LOCK ADD`.

Go's runtime occasionally emits `MFENCE` directly (search `MFENCE` in `runtime/internal/atomic/`); usually it relies on `LOCK`-prefixed instructions.

---

## Appendix AV: ARMv8 Memory Tagging and Pointer Authentication

Two ARMv8 features that interact with the memory model in subtle ways.

### AV.1 Memory Tagging Extension (MTE)

ARMv8.5+ introduces MTE: each 16-byte memory granule has a 4-bit tag. Pointer accesses check that the pointer's tag matches the memory's tag. Mismatches trigger a fault.

For Go: not directly relevant — Go's runtime doesn't currently use MTE. But if you're working with cgo into MTE-aware C code, the tags must match. The good news: tag checks happen at the L1 cache, not at the cache-coherence layer, so they don't add latency for in-cache atomic operations.

### AV.2 Pointer Authentication (PAC)

ARMv8.3+ introduces PAC: pointers can carry a cryptographic signature in their upper bits. Indirect jumps and returns can verify the signature. For Go: again, not directly relevant — Go uses its own continuation mechanism — but cgo into PAC-aware code requires care.

Neither MTE nor PAC affects the memory ordering directly. They're orthogonal features.

---

## Appendix AW: Memory Ordering Across cgo Boundaries

When Go code calls into C via cgo, the memory model situation is murky. Both Go and C have memory models, but they differ:

- Go: SC `sync/atomic`, no exposed weaker ordering.
- C11+: full memory_order spectrum.

When you pass a pointer from Go to C and the C code modifies the pointed-to memory, what guarantees do you have?

**The pragmatic answer:**

- cgo calls are *synchronous* in the calling goroutine. Whatever the goroutine wrote in Go before the cgo call is visible to the C code.
- Whatever the C code writes is visible to the Go code after the cgo call returns.
- However, *other Go goroutines* see the C-written memory only if you publish it via `sync/atomic` after the cgo call.

In practice: treat cgo as a sequential function call. Don't share memory between Go goroutines and C threads without explicit synchronisation. If you must, do all the synchronisation in Go (using `sync/atomic`) and treat C as a single-threaded callee.

---

## Appendix AX: Building a Custom Read-Write Lock

For learning purposes, here is a hand-rolled RWLock using atomics:

```go
package customrwlock

import (
    "runtime"
    "sync/atomic"
)

// RWLock allows many readers or one writer.
type RWLock struct {
    // state encoding:
    //   bit 31: writer is active
    //   bits 0-30: reader count
    state atomic.Uint32
}

func (l *RWLock) RLock() {
    for {
        s := l.state.Load()
        if s&(1<<31) != 0 {
            runtime.Gosched()
            continue
        }
        if l.state.CompareAndSwap(s, s+1) {
            return
        }
    }
}

func (l *RWLock) RUnlock() {
    l.state.Add(^uint32(0)) // decrement
}

func (l *RWLock) Lock() {
    for {
        if l.state.CompareAndSwap(0, 1<<31) {
            return
        }
        runtime.Gosched()
    }
}

func (l *RWLock) Unlock() {
    l.state.Store(0)
}
```

Caveats: this is purely instructive. `sync.RWMutex` has more features (writer preference, etc.) and uses runtime semaphores instead of spinning, so it's more efficient under contention. Use `sync.RWMutex` in production.

The point: you can build any synchronisation primitive from `sync/atomic`. The standard library types are just convenient wrappers.

---

## Appendix AY: A Note on Spin-Wait Hints

Hardware provides hints for spin-wait loops:

- x86: `PAUSE` instruction. Tells the CPU "I'm spinning"; reduces speculative execution waste and saves power.
- arm64: `YIELD` (called `WFE` for full wait-for-event variant).
- POWER: `OR 27, 27, 27` (a no-op encoded specifically to hint at spinning).

Go does not expose `PAUSE` directly. The runtime uses `runtime.procyield(cycles)` internally, which inserts `PAUSE` instructions on amd64. In user code, `runtime.Gosched()` is the closest equivalent — it yields the goroutine to the scheduler.

For very short spins (a few nanoseconds), `runtime.Gosched()` is too heavyweight. If you can use `runtime.procyield(30)` (private API) it's lighter. Most application code shouldn't need either.

---

## Appendix AZ: Stress-Testing a Memory Model Assumption

A useful technique: write a stress test that *intentionally* exercises a potential reordering, and see if your code holds up.

```go
package stresstest

import (
    "sync"
    "sync/atomic"
    "testing"
)

var (
    x, y int32
)

// Litmus: store-buffering. Expect SC behaviour from sync/atomic.
func TestSBLitmus(t *testing.T) {
    iterations := 100_000
    violations := 0
    for i := 0; i < iterations; i++ {
        atomic.StoreInt32(&x, 0)
        atomic.StoreInt32(&y, 0)
        var r1, r2 int32
        var wg sync.WaitGroup
        wg.Add(2)
        go func() {
            defer wg.Done()
            atomic.StoreInt32(&x, 1)
            r1 = atomic.LoadInt32(&y)
        }()
        go func() {
            defer wg.Done()
            atomic.StoreInt32(&y, 1)
            r2 = atomic.LoadInt32(&x)
        }()
        wg.Wait()
        if r1 == 0 && r2 == 0 {
            violations++
        }
    }
    if violations > 0 {
        t.Errorf("SC violation: %d in %d iterations", violations, iterations)
    }
}
```

This test will pass (zero violations) on every Go platform. If you replace the atomics with plain field accesses, on `arm64` you'll see thousands of violations.

The technique generalises: write the litmus, count violations, confirm zero with the right primitives.

---

## Appendix BA: A Real-World Migration — From sync.Map to atomic.Pointer

A team observed `sync.Map.Load` showing up as 5% of CPU in a profile. The map was used for a config-like read-mostly workload.

Diagnosis: `sync.Map` uses two internal maps and bookkeeping. Each `Load` does:

1. Read the read-only map (lock-free).
2. If missing, check the read-write map under a mutex.

Even when the value is in the read-only map, there's overhead beyond a single atomic load.

Migration: replace `sync.Map` with `atomic.Pointer[map[K]V]`. Writers copy the map and CAS-publish. Readers do `m.Load()[k]`.

Result: `Load` time dropped from ~50 ns to ~5 ns. CPU usage of the read path dropped to 0.5%.

Trade-off: writes now O(n) instead of O(1). For their workload (1 write per 10,000 reads), this was a clear win.

The lesson: `sync.Map` is a generalist; for read-mostly workloads, COW with `atomic.Pointer` is faster. Profile, then choose.

---

## Appendix BB: Concurrency Performance Anti-Patterns

A list of patterns that consistently cause performance problems:

### BB.1 Tight Spin Loops

```go
for !ready.Load() {
} // burns CPU
```

Always add `runtime.Gosched()` or use a channel/sync primitive.

### BB.2 Mutex Around Long Operations

```go
mu.Lock()
defer mu.Unlock()
result, err := callExternalAPI() // 100ms blocking I/O
```

Other goroutines block for 100ms. Hold the lock only around the in-memory state mutation, not the I/O.

### BB.3 Map Without Synchronisation

```go
var m = map[string]int{}

go func() { m["a"] = 1 }()
go func() { m["a"] = 2 }()
```

Go maps are not safe for concurrent writes. Use `sync.Map` or a mutex-protected map.

### BB.4 Channel With Tiny Buffer for High Throughput

```go
ch := make(chan T, 1) // bottleneck
```

For high-throughput pipelines, give channels buffers in the thousands. Single-element channels serialise the pipeline.

### BB.5 Goroutine Per Operation Without Bounds

```go
for _, req := range requests {
    go handle(req)
}
```

Unbounded goroutines can exhaust memory. Use a bounded semaphore (`sem := make(chan struct{}, limit)`).

### BB.6 Atomic Without Alignment Awareness

```go
type Pair struct {
    a int32
    b int64 // !!
}
```

On 32-bit ARM, `b` may not be 8-byte aligned, causing `atomic.AddInt64(&p.b, 1)` to panic. Put the 64-bit field first or use `atomic.Int64` (which the compiler aligns).

### BB.7 `time.After` in a Loop

```go
for {
    select {
    case <-time.After(time.Second):
        // ...
    }
}
```

`time.After` allocates a new timer each iteration. Use `time.NewTicker` or reuse a single timer.

---

## Appendix BC: Memory Allocator and Concurrency

Go's memory allocator (`runtime/mheap.go`) is itself a highly concurrent system. Each P has its own small-object cache (`mcache`); larger allocations go through central caches (`mcentral`) and the heap (`mheap`). The hierarchy minimises lock contention.

Implications for performance:

- Allocating small objects is fast (no locks, just bumping a pointer in the P's mcache).
- Allocating large objects (>32KB) involves the mheap, which is mutex-protected. Concurrent large allocations can contend.
- Freeing happens during GC, which can pause briefly.

For lock-free data structures that allocate frequently, the allocator can become the bottleneck rather than the synchronisation. Use `sync.Pool` to reuse objects in hot paths.

---

## Appendix BD: A Final Senior-Level Self-Test

You should be able to:

1. Sketch a Vyukov MPMC queue and explain its memory ordering choices.
2. Compare Go's `sync.RWMutex` to a hand-rolled one using atomics.
3. Explain when `atomic.Pointer[T]` is preferable to `sync.Mutex` and vice versa.
4. Identify cache-line padding issues in a code snippet.
5. Trace through `runtime/chan.go` for a send/recv on a buffered channel.
6. Write a Herd7 litmus test for any of SB, MP, LB, IRIW.
7. Diagnose false sharing with `perf c2c`.
8. Explain why ARMv8 is MCA but POWER is not.
9. Design a sharded counter that scales to millions of ops/sec.
10. Read `runtime/sema.go` and explain how `semacquire` interacts with `gopark`.

If you can do 8 of 10, you are at senior level on hardware memory barriers.

---

## Appendix BE: Closing for Senior

The senior-level material brings together:

- Memory consistency models across architectures.
- Lock-free data structures and their pitfalls.
- Runtime internals (channels, semaphores, scheduler).
- Performance engineering for concurrent code.
- Verification tools (Herd7, perf, race detector).

The professional file continues into the deepest microarchitectural details — load/store queues, TSO replays, fence-free fast paths, persistent memory, and formal verification. It assumes everything in junior, middle, and senior is wired in as reflex.

End.

---

## Appendix BF: A Survey of POWER ISA Barriers in Practice

The POWER architecture rewards careful study. Here is a fuller list of its memory-ordering primitives.

### BF.1 The Five Fences

| Instruction | Synonyms | Purpose |
|---|---|---|
| `sync 0` (or just `sync`) | hwsync | Full heavyweight barrier. Orders everything. |
| `sync 1` | lwsync | Lightweight. Orders LL, LS, SS. Does NOT order SL. |
| `sync 2` | ptesync | Page-table-entry sync. Orders TLB invalidations. |
| `sync 4` | eieio | Enforce in-order execution of I/O. Legacy. |
| `isync` | (none) | Instruction-stream sync. Used after branch for acquire-via-control-dep. |

POWER also has subtle variants for inner/outer storage class, and the `mbar` mnemonic which is sometimes used instead of `sync`.

### BF.2 The "isync trick"

A famous POWER pattern: instead of `lwsync` on the acquire side, use a control dependency on the loaded value plus `isync`:

```
load r1, (flag)
cmpdi r1, 0
beq    bypass        ; branch on the loaded value
isync                ; pipeline flush after branch
load r2, (data)       ; r2 is now ordered after the load of flag
bypass:
```

The `isync` after the branch ensures that the load of `data` happens-after the load of `flag` (via the control dependency). This is cheaper than `lwsync` because `isync` is a pipeline-only fence; it doesn't touch the memory system.

This trick doesn't exist on ARM or x86 because their fence semantics are different. Knowing it exists explains a lot of POWER kernel code.

### BF.3 Why POWER Needs Sync For IRIW

As Appendix B noted, POWER is non-multi-copy-atomic. The IRIW litmus is observable. To forbid it, every observer thread needs a `sync` (or `lwsync`+`isync`) between the two reads. ARM and x86 don't need this because they're MCA.

### BF.4 Implications for Go on POWER

Go's `runtime/internal/atomic/atomic_ppc64x.s` uses `sync`/`lwsync`/`isync` strategically to provide SC. Atomic operations on POWER are observably slower than on x86 or arm64 due to the heavier fences. For latency-sensitive Go services, POWER is a fine target but expect 1.5-2x slowdown on atomic-heavy workloads.

---

## Appendix BG: Linux Kernel RCU in Depth

For the senior who has seen Linux kernel code, here's a deeper look at RCU and its memory model implications.

### BG.1 The RCU Idea

Readers don't synchronise with writers. Period. Writers create a new version and publish it; the old version is freed only after a **grace period** — a time during which all existing readers complete.

### BG.2 RCU Primitives

```
rcu_read_lock();
p = rcu_dereference(global_ptr);
// ... use *p ...
rcu_read_unlock();
```

`rcu_read_lock` and `rcu_read_unlock` are *almost no-ops* in the non-preemptible kernel — they just disable preemption. The cost on the read path is negligible.

```
new_version = build_new();
rcu_assign_pointer(global_ptr, new_version);
synchronize_rcu(); // wait for grace period
free(old_version);
```

`rcu_assign_pointer` is a release-store. `synchronize_rcu` is the expensive part — it waits until every CPU has gone through a quiescent state.

### BG.3 Memory Ordering In RCU

`rcu_dereference` provides what the kernel calls "consume" ordering: the reader sees all the data stores that happened before `rcu_assign_pointer`. This is implemented with a `READ_ONCE` plus, on Alpha (the only common architecture without inherent address dependency ordering), an explicit barrier. Everywhere else it's free.

### BG.4 Go's Equivalent

Go doesn't have RCU. The equivalent pattern is `atomic.Pointer[T]` plus GC. Readers do `p := global.Load()`. Writers do `global.Store(newP)`. The GC waits implicitly for grace periods — the old `*T` is freed when no goroutine references it.

The Go pattern has higher overhead than kernel RCU (each load is an atomic, not just a `READ_ONCE`), but it requires no manual grace period management. For most workloads this is the right trade-off.

---

## Appendix BH: A Real Bug — Go's Channel Closes and Memory Ordering

A subtle bug from a real codebase. The pattern:

```go
type Service struct {
    done chan struct{}
    data atomic.Pointer[Data]
}

func (s *Service) Start() {
    s.data.Store(loadInitial())
    go s.run()
}

func (s *Service) run() {
    for {
        select {
        case <-s.done:
            return
        case <-time.After(time.Second):
            s.data.Store(loadFresh())
        }
    }
}

func (s *Service) Stop() {
    close(s.done)
}

func (s *Service) Get() *Data {
    return s.data.Load()
}
```

Bug: occasionally `Get` returns `nil`. How?

Investigation: `Start` does `s.data.Store(loadInitial())` then `go s.run()`. The `go` statement establishes a happens-before *to the goroutine being started*, not to *other goroutines* that might call `Get` concurrently.

If `Get` is called on goroutine X while `Start` is running on goroutine Y, X might observe `s.data` before Y's store completes. Result: `s.data.Load()` returns the zero value (nil).

Fix: ensure `Start` returns only after `loadInitial` has completed. Make `Start` synchronous:

```go
func (s *Service) Start() error {
    initial, err := loadInitial()
    if err != nil {
        return err
    }
    s.data.Store(initial)
    go s.run()
    return nil
}
```

And the caller must wait for `Start` to return before invoking `Get`:

```go
if err := svc.Start(); err != nil {
    return err
}
// Now safe to call svc.Get().
```

The atomic.Pointer.Store has release semantics, but the *caller* of Start must wait for Start to return. If concurrent goroutines call Get while Start is in flight, they may see nil.

Lesson: atomic stores establish happens-before *for goroutines that subsequently load*. They don't retroactively make earlier loads see the new value.

---

## Appendix BI: Comparing Go's Concurrency to Erlang and Rust

A senior should be able to compare Go to peer languages.

### BI.1 Erlang

Erlang has no shared memory between processes. All communication is by message passing. Memory ordering is irrelevant at the language level — each process sees only its own memory.

Pros: no shared-memory bugs.
Cons: copying messages, scheduling overhead.

Go's channels are inspired by Erlang's mailboxes, but Go allows shared memory in addition. This is a deliberate trade-off: more performance flexibility, more bug surface.

### BI.2 Rust

Rust has a strict ownership model: at most one mutable reference, or many immutable references, at any time. Concurrent access to a value requires `Send` and `Sync` traits. `Arc<Mutex<T>>` and `Arc<AtomicXxx>` are the standard patterns.

Rust's atomic API mirrors C++'s, with explicit ordering parameters. Default is `SeqCst`.

Pros: compile-time guarantees against data races.
Cons: steeper learning curve; some patterns require `unsafe`.

Go trades compile-time safety for runtime checks (race detector). Different philosophy.

### BI.3 Java

Java's `volatile` is SC. `synchronized` blocks acquire/release a monitor lock. `java.util.concurrent` provides a rich set of higher-level primitives.

Java's memory model is well-formalised (JSR-133). Performance is similar to Go.

### BI.4 C++

C++ exposes the full memory_order spectrum. Most expressive, most error-prone. Used in performance-critical systems (browsers, game engines, HFT).

Go vs C++ on memory ordering: Go is a deliberately simpler model, easier to use, slightly less performant in pathological cases.

---

## Appendix BJ: When Not To Use Atomics

A senior should know when to *avoid* atomic operations. Some scenarios:

### BJ.1 Heavily Contended Hot Path

If you have 100 cores hammering one atomic counter, you don't need atomics — you need a different data structure. Shard the counter.

### BJ.2 Multi-Word Updates

`atomic.AddInt64` is great for one counter. For two related counters that must update atomically, you need a mutex or a packed 64-bit word.

### BJ.3 Long Critical Sections

If your "atomic" operation includes calling out to a database, atomics are the wrong primitive. Use a mutex (or rethink the design).

### BJ.4 Algorithmic Complexity Over Performance

If the difference between an atomic and a mutex is 20 ns and your operation takes 200 microseconds, the choice doesn't matter. Use whatever is clearer.

### BJ.5 Code That Will Be Modified by Junior Engineers

Atomics require subtle correctness reasoning. If the code is going to be modified by people who haven't read this entire file, prefer a mutex. The 25 ns of overhead is worth the clarity.

---

## Appendix BK: A Tour of `runtime.semaphore` From a Memory-Model Perspective

We touched on this in Appendix J but let's go deeper.

### BK.1 The Treap Structure

Each runtime semaphore lives in a treap (random-priority binary search tree) keyed by the lock address. The treap allows O(log n) lookup of the sudog list for a given semaphore.

### BK.2 The Sudog

A `sudog` is a "waiting goroutine" record. It points to the goroutine, the address it's waiting on, and the next sudog in the wait list.

### BK.3 Memory Ordering in Park/Unpark

When goroutine X acquires a semaphore, it does:

1. Atomic CAS on the sema value.
2. If failed, lock the treap's mutex (a runtime-internal mutex).
3. Insert a sudog into the wait list.
4. Call `gopark`, which:
   a. Marks the goroutine as waiting.
   b. Schedules another goroutine on this M.
   c. The goroutine is now "suspended."

When goroutine Y releases:

1. Atomic decrement of the sema value.
2. Lock the treap.
3. Pop a sudog from the wait list.
4. Call `goready`, which marks the popped goroutine as runnable and adds it to a runqueue.

The memory model effect: Y's atomic store + lock release pairs with X's eventual lock acquire + atomic load. X sees all of Y's prior writes.

### BK.4 Why This Is Faster Than POSIX

A traditional pthread mutex calls into the kernel via futex on every contention. Go's runtime semaphore uses futex sometimes, but for "hot" semaphores (channels, mutexes between user goroutines) the M doesn't necessarily go into the kernel — instead, the goroutine is rescheduled within the same OS thread.

This avoids syscalls, which can save microseconds per operation. It's one of the reasons Go's concurrency primitives feel cheap.

---

## Appendix BL: An Extreme Stress Test for Atomics

If you really want to test your understanding, write a program that exercises every reordering an architecture can do, and measure how Go's atomics prevent each one.

```go
package extremestress

import (
    "sync"
    "sync/atomic"
    "testing"
)

// Litmus: every classical pattern in one test suite.

func TestAllLitmuses(t *testing.T) {
    iterations := 1_000_000
    for _, name := range []string{"SB", "MP", "LB", "IRIW", "WRC"} {
        t.Run(name, func(t *testing.T) {
            violations := 0
            for i := 0; i < iterations; i++ {
                switch name {
                case "SB":
                    violations += sbLitmus()
                case "MP":
                    violations += mpLitmus()
                case "LB":
                    violations += lbLitmus()
                case "IRIW":
                    violations += iriwLitmus()
                case "WRC":
                    violations += wrcLitmus()
                }
            }
            if violations > 0 {
                t.Errorf("%s: %d violations", name, violations)
            }
        })
    }
}

// (Implementation of each litmus function elided for brevity.)
```

Running this for an hour on every supported architecture is a great way to verify that Go's atomics really do provide SC. The expected result: zero violations everywhere.

If you see a violation, you've either found a bug in Go's runtime (very unlikely) or in your litmus implementation (likely).

---

## Appendix BM: One Final Closing Thought

The senior level is where you start to see hardware memory models as an *engineering trade-off*, not a fixed rule. Different architectures chose different points on the strength/performance spectrum because their designers had different goals. x86 picked TSO for compatibility with the older single-CPU programming model; ARM picked weak for power efficiency; POWER picked the most relaxed model for maximum CPU pipeline freedom; RISC-V designed the cleanest theoretical model from scratch.

Go's `sync/atomic` makes all of these look like SC. That uniformity has a real cost — extra fences on weak architectures — but the payoff is portable code. For 99% of Go programmers, that's the right choice.

For the 1% writing the runtime, the lock-free libraries, or the operating system, the deeper knowledge in this file pays off.

End — this time really.

---

## Appendix BN: Putting It All Together — A Production Lock-Free Library

A senior engineer might be asked to write a small lock-free library. Here is a worked example: a lock-free LRU cache.

The classic LRU has:
- A hash map for O(1) lookup.
- A doubly linked list for O(1) recency updates.

Making the whole thing lock-free is hard. A practical compromise:

```go
package lflru

import (
    "sync"
    "sync/atomic"
    "container/list"
)

type entry struct {
    key   string
    value atomic.Pointer[any]
}

type LRU struct {
    mu      sync.Mutex
    cap     int
    ll      *list.List
    entries map[string]*list.Element
}

func New(cap int) *LRU {
    return &LRU{
        cap:     cap,
        ll:      list.New(),
        entries: make(map[string]*list.Element),
    }
}

func (c *LRU) Get(key string) (any, bool) {
    c.mu.Lock()
    e, ok := c.entries[key]
    if !ok {
        c.mu.Unlock()
        return nil, false
    }
    c.ll.MoveToFront(e)
    c.mu.Unlock()

    // The atomic load is outside the lock — but the mutex
    // provided the synchronization to find `e` safely.
    v := e.Value.(*entry).value.Load()
    if v == nil {
        return nil, false
    }
    return *v, true
}

func (c *LRU) Set(key string, value any) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if e, ok := c.entries[key]; ok {
        ent := e.Value.(*entry)
        ent.value.Store(&value)
        c.ll.MoveToFront(e)
        return
    }
    ent := &entry{key: key}
    ent.value.Store(&value)
    e := c.ll.PushFront(ent)
    c.entries[key] = e
    if c.ll.Len() > c.cap {
        oldest := c.ll.Back()
        if oldest != nil {
            c.ll.Remove(oldest)
            delete(c.entries, oldest.Value.(*entry).key)
        }
    }
}
```

Walkthrough:

- The map and list are mutex-protected. The cost is one mutex op per Get/Set.
- The value pointer is `atomic.Pointer`, allowing us to update a value without holding the lock (but we do hold it for structural ops).
- The hybrid approach: lock-free reads of the most current value, mutex-coordinated structural updates.

This is not a "fully lock-free" LRU — fully lock-free LRU exists but is extremely complex. The hybrid is a sweet spot in practice.

---

## Appendix BO: Reading Russ Cox's "Hardware Memory Models" Series

Russ Cox (Go tech lead) wrote a two-part essay that is essential reading at the senior level: research.swtch.com/hwmm and research.swtch.com/plmm.

Key takeaways from the series:

1. **Memory models are about programmer guarantees, not hardware tricks.** The hardware does what it does; the model is the contract.
2. **Sequential consistency is the easiest model to reason about.** Every other model is a relaxation that comes with a checklist of restrictions.
3. **Compiler reordering is at least as important as hardware reordering.** A correct mental model must account for both.
4. **Acquire/release is the natural mid-level abstraction.** Most algorithms can be expressed with acquire/release; only a few need explicit fences.

Reading the series before tackling the professional file is highly recommended. It will give you the historical and conceptual context.

---

## Appendix BP: A Final Five-Question Drill

Try these in your head:

**Q1.** Why is POWER's IRIW pattern observable but ARMv8's is not?

**A1.** ARMv8 is "other-multi-copy-atomic": once a store leaves a core, all other cores see it at the same logical moment. POWER lacks this property: stores can become visible to different observers at different times. IRIW exposes exactly this distinction.

**Q2.** Compare `LOCK XADD` and `MFENCE` performance on modern Intel.

**A2.** Both drain the store buffer. `MFENCE` is slightly cheaper (~5 ns) because it doesn't need to perform a memory op. But `LOCK XADD` is more useful in practice because it also performs the atomic add — you'd need an additional store anyway. Pick based on whether you need the side-effecting atomic.

**Q3.** What's the difference between `LDAR` and `LDR; DMB ISHLD`?

**A3.** Functionally equivalent — both give acquire ordering on the load. Performance-wise, `LDAR` is roughly half the cost because it pipelines better. The CPU can issue younger ops speculatively past `LDAR`, while `DMB ISHLD` is a global ordering constraint.

**Q4.** In a Vyukov MPMC queue, why is the producer's `seq.Store(pos+1)` a release?

**A4.** `Store` on an `atomic` type is always release on weak architectures (STLR on ARM). This ensures the data write that precedes the seq update is visible to any consumer that reads the updated seq. Without release, the consumer might see seq=pos+1 but stale data.

**Q5.** Why does Go's atomic.Pointer save GC integration costs that unsafe.Pointer doesn't?

**A5.** `atomic.Pointer[T]` is a typed pointer; the compiler emits GC write barriers around the store. `unsafe.Pointer` is opaque to the type system; the GC doesn't see the assignment, so it can't track the pointer correctly. Misuse of `unsafe.Pointer` can corrupt the GC.

---

## Appendix BQ: A Note on Compilation Modes

Go's compiler has two main modes: with and without optimisation (-N -l disables both).

In optimised mode:

- Many operations get inlined.
- Bounds checks may be elided.
- Atomic operations are *still* preserved (atomic semantics never get optimised away — that would be a correctness bug).
- The race detector instrumentation is added when -race is set.

In -race mode:

- Every load and store is instrumented.
- Vector clocks are tracked.
- The runtime is heavier — typically 2x slower and 5x more memory.

The takeaway: atomic ordering is preserved across compilation modes. -race adds detection but doesn't change ordering. -N -l disables optimisation but doesn't change ordering.

---

## Appendix BR: A Reminder About `runtime.Goexit`

`runtime.Goexit` terminates the calling goroutine. It runs all pending defers but does not affect other goroutines. The Go memory model says:

"The exit of a goroutine is not guaranteed to be synchronized before any event in the program."

Concretely: don't rely on Goexit as a synchronisation primitive. If you need to wait for a goroutine, use a `sync.WaitGroup`, a channel, or a context.

This is the small print most people don't read but should.

---

## Appendix BS: A Final-Final Closing Note

You've reached the end of the senior expansion. The material here is enough to design lock-free data structures, debug subtle memory-ordering bugs, and contribute meaningfully to the Go runtime. The professional file continues into the deepest territory — microarchitectural buffers, formal verification, persistent memory — for those who need to go even further.

Stay curious. Keep reading the runtime source. Run `go test -race` everywhere.

End.

---

## Appendix BT: Bonus — Designing a Lock-Free Single-Producer Single-Consumer Queue

The simplest lock-free queue is the SPSC ring buffer. With exactly one producer and one consumer, we can avoid CAS entirely.

```go
package spsc

import (
    "sync/atomic"
)

type Queue[T any] struct {
    buf  []T
    mask uint64
    // Pad to separate cache lines.
    _    [56]byte
    head atomic.Uint64 // producer writes
    _    [56]byte
    tail atomic.Uint64 // consumer reads
    _    [56]byte
}

func New[T any](size uint64) *Queue[T] {
    if size&(size-1) != 0 {
        panic("size must be a power of 2")
    }
    return &Queue[T]{
        buf:  make([]T, size),
        mask: size - 1,
    }
}

// Enqueue is called only by the producer.
func (q *Queue[T]) Enqueue(v T) bool {
    head := q.head.Load()
    tail := q.tail.Load()
    if head-tail >= uint64(len(q.buf)) {
        return false // full
    }
    q.buf[head&q.mask] = v
    q.head.Store(head + 1) // release
    return true
}

// Dequeue is called only by the consumer.
func (q *Queue[T]) Dequeue() (T, bool) {
    var zero T
    head := q.head.Load() // acquire
    tail := q.tail.Load()
    if head == tail {
        return zero, false // empty
    }
    v := q.buf[tail&q.mask]
    q.tail.Store(tail + 1)
    return v, true
}
```

Why this works without CAS:

- Only one producer touches `head`.
- Only one consumer touches `tail`.
- The producer reads `tail` (for capacity check) but doesn't write it.
- The consumer reads `head` (for empty check) but doesn't write it.

The atomic load/store provides the release/acquire happens-before:

- Producer: data write → `head.Store(head+1)` (release).
- Consumer: `head.Load()` (acquire) → data read.

So the consumer sees the producer's data write through the head update. The pattern is solid for exactly one producer and one consumer.

Performance: typically 5-10 ns per operation, beating channels (~50 ns) and MPMC queues (~30 ns). The trade-off: it's single-producer single-consumer only. Multiple producers or consumers break the algorithm.

---

## Appendix BU: A Note on Atomicity vs Visibility

Two concepts that are often conflated:

- **Atomicity:** the operation is indivisible. No partial state is observable.
- **Visibility:** the operation's effects are observed in a particular order by other threads.

A plain `int64` write on a 64-bit platform is atomic (aligned 64-bit writes are indivisible in hardware). But it has no visibility guarantee — other threads may see the write at any point.

An `atomic.StoreInt64` is atomic *and* establishes visibility (release semantics).

This is why "atomic" in casual conversation often means both. In specifications, they're separated. The Go memory model speaks in terms of "happens-before," which captures visibility; atomicity is implicit when the operation is on a single machine word.

---

## Appendix BV: One More Litmus Test for the Road

A subtle one — the **CoRR (Coherent Read-Read)** test:

```
Initial: x = 0
Thread A   Thread B
x = 1      r1 = x
x = 2      r2 = x
```

Question: can `r1 == 2` and `r2 == 1`?

This is asking: can two reads from the same location see writes in reverse order?

Answer: **no on every coherent architecture**. Cache coherence (MESI) guarantees that a single memory location has a coherent linear order of writes. All observers see the same order.

This is sometimes called **coherence** (as opposed to consistency). Coherence is per-location; consistency is across locations.

POWER, ARM, x86, RISC-V — all coherent. The CoRR test is forbidden everywhere.

But: **CoWR (Coherent Write-Read)** is observable on weak architectures:

```
Thread A   Thread B
x = 1      r1 = x; r2 = x
```

`r1 == 1, r2 == 0` is forbidden by coherence (B's two reads must agree on the order of x's writes). But `r1 == 0, r2 == 1` is the natural case — B's reads see x evolve over time.

Knowing the difference between coherence and consistency is a senior-level insight.

---

## Appendix BW: Building a Lock-Free Linked List

For completeness, here's a sketch of Harris's lock-free linked list:

```go
package lflist

import "sync/atomic"

type Node[T comparable] struct {
    value T
    next  atomic.Pointer[Node[T]]
}

type List[T comparable] struct {
    head atomic.Pointer[Node[T]]
}

// Insert adds value at the head of the list.
func (l *List[T]) Insert(value T) {
    n := &Node[T]{value: value}
    for {
        h := l.head.Load()
        n.next.Store(h)
        if l.head.CompareAndSwap(h, n) {
            return
        }
    }
}

// Delete removes the first node with the given value.
// Simplified — real Harris uses marking for safe deletion.
func (l *List[T]) Delete(value T) bool {
    for {
        prev := &l.head
        cur := prev.Load()
        for cur != nil {
            next := cur.next.Load()
            if cur.value == value {
                if prev.CompareAndSwap(cur, next) {
                    return true
                }
                break
            }
            prev = &cur.next
            cur = next
        }
        if cur == nil {
            return false
        }
    }
}
```

Harris's full algorithm uses *marked pointers* (a low bit set to indicate "logically deleted") to handle the case where insertion and deletion happen concurrently on the same node. The sketch above doesn't handle that — it's there to illustrate the pattern.

For real production use, prefer existing libraries (e.g., go-concurrent-list) or use a mutex-protected list. Lock-free linked lists are notoriously hard to get right.

---

## Appendix BX: A Personal Reflection on Learning This Material

The first time you read about memory barriers, none of it makes sense. After three years of writing concurrent Go, some of it makes sense. After ten years of writing concurrent code in multiple languages, you have intuitions.

Don't expect to absorb this file in one read. Come back to it when you encounter a bug that requires it. Each cycle of "I have a real problem, I need to understand this" deepens the knowledge.

The senior level is not "I know everything." It's "I know enough to know what I don't know, and I know how to find out."

End.

---

## Appendix BY: Final Comparison Table — Cost of Synchronisation Primitives

For quick reference, approximate cost in nanoseconds on modern x86-64 (Skylake-class server):

| Primitive | Uncontended | Contended (low) | Contended (high) |
|---|---|---|---|
| plain int64 read       | 0.3 | 0.3 | 0.3 |
| plain int64 write      | 0.5 | 0.5 | 0.5 |
| atomic.LoadInt64       | 0.5 | 0.5 | 0.5 |
| atomic.StoreInt64      | 10 | 15 | 30 |
| atomic.AddInt64        | 10 | 20 | 50 |
| atomic.CompareAndSwap  | 15 | 25 | 80 (with retry) |
| sync.Mutex.Lock        | 15 | 50 | 1000+ (futex) |
| sync.Mutex.Unlock      | 5 | 10 | 50 |
| sync.RWMutex.RLock     | 20 | 50 | 200 |
| sync.RWMutex.RUnlock   | 15 | 30 | 100 |
| channel send/recv      | 50 | 80 | 200 |
| go statement (goroutine spawn) | 150 | 200 | 500 |

Use these numbers as guideposts for performance reasoning. Profile your actual code to confirm.

---

## Appendix BZ: One More Architectural Tidbit

A subtle x86 detail: the `LOCK` prefix on a no-op like `OR (RSP), 0` is a hand-rolled memory barrier. Some C compilers emit this instead of `MFENCE` because it's a few cycles faster on certain microarchitectures.

Go's runtime doesn't emit this idiom — it uses `MFENCE` or `LOCK XADD` directly. But if you read x86 disassembly from other languages (especially older C++ code), you may see `LOCK OR` or `LOCK AND` with a zero operand. Same effect as `MFENCE`, slightly different microarchitectural footprint.

This is the kind of trivia that distinguishes a senior who has read C/C++ low-level code from one who has only read Go.

---

## Appendix CA: Final Word

The senior level on hardware memory barriers requires multi-architecture fluency, hands-on experience with lock-free design, intuition for performance trade-offs, and the patience to read large amounts of assembly and runtime source code.

Continue to the professional file when you're ready for the deepest material: microarchitectural buffers, formal verification with Herd7/Coq, persistent memory, transactional memory, and the design of the Go runtime's lowest-level synchronisation code.

End — final.


