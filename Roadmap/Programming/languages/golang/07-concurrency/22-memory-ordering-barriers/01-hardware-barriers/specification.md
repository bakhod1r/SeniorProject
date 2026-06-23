---
layout: default
title: Hardware Barriers — Specification
parent: Hardware Barriers
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/01-hardware-barriers/specification/
---

# Hardware Memory Barriers — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Intel SDM Volume 3A, §8 (Memory Ordering)](#intel-sdm-volume-3a-§8-memory-ordering)
3. [Intel SDM Volume 3A, §11 (Memory Cache Control)](#intel-sdm-volume-3a-§11-memory-cache-control)
4. [ARM ARM §B2 (Memory Ordering)](#arm-arm-§b2-memory-ordering)
5. [ARM ARM §B2.3 (Acquire/Release Instructions)](#arm-arm-§b23-acquirerelease-instructions)
6. [RISC-V ISA Manual §A (RVWMO)](#risc-v-isa-manual-§a-rvwmo)
7. [POWER ISA Book II (Storage Consistency)](#power-isa-book-ii-storage-consistency)
8. [Go Memory Model — Mapping to Hardware](#go-memory-model-—-mapping-to-hardware)
9. [Linux Kernel Memory Barriers Documentation](#linux-kernel-memory-barriers-documentation)
10. [C11/C++11 Memory Model](#c11c11-memory-model)
11. [Cross-Reference Table](#cross-reference-table)
12. [References](#references)

---

## Introduction

This file collects normative excerpts from the architectural manuals that define hardware memory barriers, paired with relevant Go memory model statements. It is the reference you consult when "I think this is right but I want to make sure" — the source of truth for every claim in the junior/middle/senior/professional files.

Citations are paraphrased where necessary for clarity; pointers to original sources are at the end.

---

## Intel SDM Volume 3A, §8 (Memory Ordering)

### §8.2 Memory Ordering

> The processor uses several techniques to optimize memory accesses. Stores can be reordered with respect to other stores in limited cases, and loads can be reordered with respect to other loads. The Pentium 4, Intel Xeon, and P6 family processors enforce a processor-ordering memory model that is stronger than the write-ordered processor model (§8.2.4) of earlier IA-32 processors but does not provide full sequential consistency (§8.2.1).

### §8.2.2 Memory Ordering in P6 and More Recent Processors

Key rules (paraphrased from §8.2.2):

1. Reads are not reordered with other reads.
2. Writes are not reordered with older reads.
3. Writes to memory are not reordered with other writes, with the following exceptions:
   - Writes executed with the CLFLUSH instruction.
   - Streaming stores (MOVNTI, MOVNTQ, etc.).
   - String operations.
4. Reads may be reordered with older writes to different locations but not with older writes to the same location.
5. Reads and writes are not reordered with locked instructions.
6. Reads and writes are not reordered with serializing instructions (MFENCE, etc.).
7. In a multiprocessor system, the following rules apply:
   - Each processor uses the same ordering rules as in a single-processor system.
   - All processors observe the writes by a single processor in the same order.
   - Writes from different processors are not totally ordered (but see §8.2.3.7).
   - Memory ordering obeys causality (memory ordering respects transitive visibility).
   - Locked instructions have total order across processors.

### §8.2.3.5 Inter-Processor Communication and Other Practices

The example illustrates the SB litmus test and confirms that x86 allows the bad outcome:

> When using shared memory to communicate between processors, you should use locks, MFENCE, or LFENCE/SFENCE to enforce the order required by the algorithm.

### §8.3 Serializing Instructions

> The Intel 64 and IA-32 architectures define several serializing instructions. These force the processor to complete all modifications to flags, registers, and memory by previous instructions and to drain all buffered writes to memory before the next instruction is fetched and executed.

Serializing instructions include:
- Privileged: INVD, INVEPT, INVLPG, INVVPID, LGDT, LIDT, LLDT, LTR, MOV (to control register), MOV (to debug register), WBINVD, WRMSR.
- Non-privileged: CPUID, IRET, RSM.

Memory-ordering instructions (LFENCE, SFENCE, MFENCE) are *not* listed as serializing in this sense; they only constrain memory operation order, not pipeline serialization (though Intel post-Spectre documents LFENCE as serializing).

### §8.2.5 Strengthening or Weakening the Memory Ordering Model

> The Intel 64 and IA-32 architectures provide several mechanisms for strengthening or weakening the memory ordering model to handle special programming situations.

Mechanisms:
- I/O instructions, locking instructions, the LOCK prefix, and serializing instructions force stronger ordering on the processor.
- The MFENCE, LFENCE, and SFENCE instructions provide memory ordering and serialization capability that is finer-grained than the LOCK prefix.

### §8.2.4 Fast-String Operation and Out-of-Order Stores

Streaming stores (`MOVNTI`, `MOVNTPS`, `MOVNTDQ`, `MASKMOVQ`) are weakly ordered:

> Streaming stores do not always follow the memory-ordering rules of the IA-32 architecture. They can be reordered with other stores. They should be followed by an SFENCE if the order needs to be enforced.

### §8.2.5.2 (Atomic Operations)

> Locked operations are atomic with respect to all other memory operations and all externally visible events.

This is the formal basis for `LOCK XADD`, `LOCK CMPXCHG`, etc. acting as full memory barriers.

---

## Intel SDM Volume 3A, §11 (Memory Cache Control)

### §11.10 Store Buffer

> Intel 64 and IA-32 processors temporarily store each write (store) to memory in a store buffer. The store buffer improves processor performance by allowing the processor to continue executing instructions without having to wait until a write to memory and/or to a cache is complete.

§11.10 confirms the existence and purpose of the store buffer. It is the architectural feature that creates the StoreLoad reordering.

### §11.3 Methods of Caching Available

> The memory type of a page or region affects how the processor caches data from that region and how it orders accesses to that region.

Memory types: UC (uncacheable), WC (write-combining), WT (write-through), WP (write-protect), WB (write-back). Almost all Go code runs on WB memory.

WC has weak ordering — needs SFENCE for ordering. WB has the ordering described in §8.2.

---

## ARM ARM §B2 (Memory Ordering)

### §B2.1 The Memory Ordering Model

The ARMv8 memory model is "weakly ordered". The architecture defines:

- **Coherence:** all observers agree on the order of writes to a single location.
- **Memory ordering:** the partial order between operations to different locations.

> The architecture supports the use of weak memory ordering with the use of explicit memory barriers and ordered memory operations.

### §B2.3 Memory Barriers

Three barrier instructions:
- **DMB (Data Memory Barrier):** ensures memory accesses before the barrier are observed before accesses after. Variants: `DMB SY`, `DMB ISH`, `DMB OSH`, `DMB NSH`, with `LD`/`ST` qualifiers.
- **DSB (Data Synchronization Barrier):** stronger than DMB; ensures completion of all prior accesses. Used in privileged code.
- **ISB (Instruction Synchronization Barrier):** flushes the pipeline; used after self-modifying code or after enabling/disabling MMU.

Shareability domains:
- `SY` — full system
- `OSH` — outer shareable
- `ISH` — inner shareable (typical for multi-core within one chip)
- `NSH` — non-shareable (single core)

For multi-core programming within one chip, `DMB ISH` is the right choice.

### §B2.3.4 Ordering Functions

> The DMB and DSB instructions take an argument that specifies the required level of system observability and the access type that the barrier applies to. The arguments are:
> - `SY`: full system, all accesses (loads and stores)
> - `LD`: full system, loads only
> - `ST`: full system, stores only
> Combined with shareability domains (`ISH`, `OSH`, `NSH`).

`DMB ISHST` orders stores only. `DMB ISHLD` orders loads only. `DMB ISH` orders both.

---

## ARM ARM §B2.3 (Acquire/Release Instructions)

### §B2.3.5 Load-Acquire / Store-Release

> The Load-Acquire instructions (LDAR, LDARB, LDARH, LDAPR) and Store-Release instructions (STLR, STLRB, STLRH) implement the one-way barriers described in this section.

Specifically:
- **Load-Acquire (LDAR):** memory accesses after the load are observed after the load. (Equivalent to LL and LS ordering for subsequent ops.)
- **Store-Release (STLR):** memory accesses before the store are observed before the store. (Equivalent to LS and SS ordering for prior ops.)

### §B2.3.6 LDAPR (Load-Acquire Processor)

> The Load-AcquirePC instruction LDAPR provides a weaker form of acquire — RCpc (release consistency with processor coherence) rather than RCsc (release consistency with sequential consistency).

LDAPR is cheaper than LDAR but provides weaker ordering. Go does not use LDAPR; it always uses LDAR for full RCsc.

### §B2.3.7 Exclusive Monitor (LDXR/STXR)

> The LDXR/STXR instruction pair provides the mechanism for implementing atomic read-modify-write operations on a memory location.

LDXR marks the address as monitored. STXR conditionally stores: succeeds (returns 0) only if no other access to the line has occurred since LDXR. Used to implement atomic operations.

LDAXR/STLXR are acquire/release variants.

---

## RISC-V ISA Manual §A (RVWMO)

### A.1 Definition

> The RISC-V architecture decouples the base ISA from extensions for memory consistency. The base ISA defines RVWMO ("RISC-V Weak Memory Order").

### A.2 Memory Model Rules

The model is defined in terms of a partial order over memory operations. Rules:

1. **Coherence:** stores to a single address are totally ordered.
2. **Program order is preserved for same-address operations.**
3. **Fences and atomic memory operations** establish ordering between different addresses.
4. **Multi-copy atomicity:** stores have a globally agreed order (unlike POWER).

### A.3 Fence Instruction

> The FENCE instruction is encoded with two 4-bit fields, PRED and SUCC, specifying which kinds of operations are ordered. The fields are subsets of {PI, PO, PR, PW, SI, SO, SR, SW} — but typically only the lower four bits {I, O, R, W} are used for the memory side.

Common fences:
- `FENCE RW, RW` — full memory barrier
- `FENCE R, R` — load-load
- `FENCE W, W` — store-store
- `FENCE R, RW` — acquire (orders prior reads with subsequent reads + writes)
- `FENCE RW, W` — release (orders prior reads + writes with subsequent writes)

### A.4 Atomic Memory Operations

> AMO instructions perform an atomic read-modify-write. They optionally carry `aq` (acquire) and `rl` (release) bits.

- `AMOADD.W rd, rs2, (rs1)` — atomic add, no ordering
- `AMOADD.W.AQ` — acquire
- `AMOADD.W.RL` — release
- `AMOADD.W.AQRL` — both (full SC)

The `LR` (Load-Reserved) / `SC` (Store-Conditional) pair has the same suffixes: `LR.W.AQ`, `SC.W.RL`.

### A.5 Ztso Extension

> The Ztso extension defines a memory model equivalent to x86-TSO.

If a hart implements Ztso, it has TSO semantics instead of WMO. Used for porting x86 code. Not yet widely deployed in production.

---

## POWER ISA Book II (Storage Consistency)

### Chapter 1 (Storage Model)

> The POWER ISA provides a weakly-consistent storage model. Storage accesses can be observed by different processors in different orders, except as required by the memory ordering instructions.

POWER is the most weakly ordered major architecture in production.

### Instructions

- **`sync`** — full memory barrier; orders all accesses.
- **`lwsync`** (lightweight sync) — orders most accesses except StoreLoad to a different address.
- **`isync`** — instruction synchronization; orders within a single hart.
- **`eieio`** — orders I/O accesses (legacy from PPC).

### Multi-Copy Non-Atomicity

POWER is *not* multi-copy atomic. Different observers can see stores from a single producer in different orders. The `sync` instruction provides the heavy barrier necessary to restore the multi-copy atomic view.

### Atomic Operations

POWER uses LL/SC (Load Reserved / Store Conditional) via `lwarx` / `stwcx.`. Sequence:

```
loop:
  lwarx  r1, 0, r3      ; load reserved
  add    r1, r1, r4      ; modify
  stwcx. r1, 0, r3      ; store conditional
  bne-   loop            ; retry if SC failed
```

Optional pre/post `lwsync` or `sync` for ordering.

---

## Go Memory Model — Mapping to Hardware

From `https://go.dev/ref/mem`:

### Synchronization

> A synchronizing operation establishes a synchronizes-before relationship between specific operations. The Go memory model uses synchronizes-before to define happens-before. Specifically:
> - A send on a channel synchronizes-before the corresponding receive.
> - The closing of a channel synchronizes-before a receive that returns because the channel is closed.
> - The unlocking of a sync.Mutex synchronizes-before any subsequent lock of the same mutex.
> - For sync/atomic operations, [the model is sequentially consistent].

### Atomic Operations

> The APIs in the sync/atomic package are collectively "atomic operations" that can be used to synchronize the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A synchronizes-before B. All the atomic operations executed in a program behave as though executed in some sequentially consistent order.

This single paragraph mandates SC semantics for `sync/atomic` on every platform. The hardware mapping is:

- **amd64:** plain MOV for loads (free acquire); XCHG for stores (full SC); LOCK-prefixed RMW for Add/CAS/Swap.
- **arm64:** LDAR for loads (acquire); STLR for stores (release; SC by multi-copy atomicity); LDADDAL/CASAL/SWPAL (LSE) or LDAXR/STLXR loops for RMW.
- **riscv64:** LW/LD + FENCE for loads; FENCE + SW/SD for stores; AMO with .AQRL for RMW.
- **ppc64le:** LWSYNC/SYNC around loads and stores; LWARX/STWCX. with SYNC for RMW.

### Locks

> sync.Mutex.Lock acquires the mutex. sync.Mutex.Unlock releases. For any sync.Mutex or sync.RWMutex variable l, and n < m, call n of l.Unlock() synchronizes-before call m of l.Lock() returns.

### Race conditions

> Programs that modify data being simultaneously accessed by other goroutines must serialize such access. (...) A Go implementation may [respond to data races by] ... formally, the Go memory model declares the result of a program with a data race to be undefined.

This is the post-Go-1.19 wording. Earlier versions had a more lenient stance.

---

## Linux Kernel Memory Barriers Documentation

From `Documentation/memory-barriers.txt` in the kernel source:

### Hierarchy

```
TYPE          GUARANTEE
============= ============================
GENERAL       all CPUs see all loads/stores in order
WRITE         all CPUs see prior stores before later stores
READ          all CPUs see prior loads before later loads
DATA DEPEND   loads dependent on prior loads are ordered
ACQUIRE       prior op completes before any later op
RELEASE       prior op completes before this op
CONTROL       conditional ordering via dependencies
MMIO          MMIO ops are ordered with each other
```

### Common Patterns

> The common pattern of using a memory barrier is to ensure that a write to one variable becomes visible to other CPUs before a write to a second variable. The most common idiom is:
> ```
> A = 1
> smp_wmb()
> B = 1
> ```
> A CPU that sees B == 1 is also guaranteed to see A == 1.

This is the publish-subscribe pattern, with `smp_wmb()` as the StoreStore barrier on the publisher side. Subscribers need `smp_rmb()`:
> ```
> if (B == 1) {
>     smp_rmb()
>     /* now A is also visible */
> }
> ```

Note: this kernel pattern is two-instruction (read, barrier, read). Go's atomic.Load is a single function call that includes the equivalent barrier on weak platforms.

---

## C11/C++11 Memory Model

C11 added `<stdatomic.h>`; C++11 added `<atomic>`. Both define:

- `memory_order_relaxed` — no ordering.
- `memory_order_consume` — dependency ordering (rarely used; mostly equivalent to acquire on practical compilers).
- `memory_order_acquire` — LoadLoad + LoadStore.
- `memory_order_release` — LoadStore + StoreStore.
- `memory_order_acq_rel` — both.
- `memory_order_seq_cst` — full SC.

Go's `sync/atomic` is equivalent to C11's `memory_order_seq_cst`. There is no Go equivalent to relaxed/acquire/release alone, except in the unavailable `runtime/internal/atomic`.

### Compatibility

When Go code (with SC atomics) and C code (with mixed orderings) share a memory location:
- C must use at least the strength Go uses (SC) to interoperate safely.
- C `_Atomic` with `memory_order_seq_cst` matches.

---

## Cross-Reference Table

| Concept | Intel SDM | ARM ARM | RISC-V | POWER ISA | Go |
|---------|-----------|---------|--------|-----------|-----|
| Full barrier | MFENCE / LOCK | DMB ISH | FENCE RW,RW | sync | atomic.Store / RMW |
| Load barrier | LFENCE | DMB ISHLD | FENCE R,R | lwsync (partial) | (implicit in atomic.Load) |
| Store barrier | SFENCE | DMB ISHST | FENCE W,W | lwsync (partial) | (implicit in atomic.Store) |
| Acquire load | (free in MOV) | LDAR | LR.AQ / FENCE R,RW | sync + lwarx | atomic.Load |
| Release store | (free in MOV) | STLR | SC.RL / FENCE RW,W | lwsync + stwcx. | atomic.Store |
| Atomic RMW | LOCK XADD/CMPXCHG | LDADDAL / CAS | AMO.AQRL | lwarx/stwcx. + sync | atomic.Add / CAS |
| Pipeline serialize | CPUID | ISB | FENCE.I | isync | (implicit in syscalls) |

---

## References

- Intel® 64 and IA-32 Architectures Software Developer's Manual, Volume 3A: System Programming Guide, Part 1. Order Number: 253668. Current revision available at intel.com.
- ARM® Architecture Reference Manual, ARMv8, for ARMv8-A architecture profile. DDI0487. Available at arm.com.
- The RISC-V Instruction Set Manual, Volume I: Unprivileged ISA. Current revision at riscv.org.
- Power ISA Version 3.1. Available at openpowerfoundation.org.
- The Go Memory Model. https://go.dev/ref/mem.
- Linux kernel Documentation/memory-barriers.txt. https://www.kernel.org/doc/Documentation/memory-barriers.txt.
- C11 standard ISO/IEC 9899:2011, §7.17 (Atomic types).
- C++11 standard ISO/IEC 14882:2011, §29 (Atomic operations library).
- Sewell et al., "x86-TSO: A Rigorous and Usable Programmer's Model for x86 Multiprocessors", CACM 2010.
- Maranget, Sarkar, Sewell, "A Tutorial Introduction to the ARM and POWER Relaxed Memory Models", 2012.
- Russ Cox, "Hardware Memory Models" — https://research.swtch.com/hwmm.
- Russ Cox, "Programming Language Memory Models" — https://research.swtch.com/plmm.
- Russ Cox, "Updating the Go Memory Model" — https://research.swtch.com/gomm.
