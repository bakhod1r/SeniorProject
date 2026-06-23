---
layout: default
title: Hardware Barriers — Middle
parent: Hardware Barriers
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/01-hardware-barriers/middle/
---

# Hardware Memory Barriers — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Recap and Pivot](#recap-and-pivot)
3. [x86-TSO Formal Model](#x86-tso-formal-model)
4. [Litmus Tests Through the TSO Lens](#litmus-tests-through-the-tso-lens)
5. [ARMv8 Memory Model in Practice](#armv8-memory-model-in-practice)
6. [MOV vs MOV with LOCK Prefix](#mov-vs-mov-with-lock-prefix)
7. [Where MFENCE Actually Lives](#where-mfence-actually-lives)
8. [LFENCE Reconsidered](#lfence-reconsidered)
9. [SFENCE and Non-Temporal Stores](#sfence-and-non-temporal-stores)
10. [The `sync/atomic` to Hardware Mapping in Detail](#the-syncatomic-to-hardware-mapping-in-detail)
11. [`runtime/internal/atomic` Walk-Through](#runtimeinternalatomic-walk-through)
12. [Cache Coherence and MESI](#cache-coherence-and-mesi)
13. [False Sharing in Depth](#false-sharing-in-depth)
14. [Reading `go tool objdump`](#reading-go-tool-objdump)
15. [Building a Producer-Consumer with Atomics](#building-a-producer-consumer-with-atomics)
16. [Building a Sequence Lock](#building-a-sequence-lock)
17. [Coding Patterns](#coding-patterns)
18. [Clean Code](#clean-code)
19. [Error Handling](#error-handling)
20. [Security Considerations](#security-considerations)
21. [Performance Tips](#performance-tips)
22. [Best Practices](#best-practices)
23. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
24. [Common Mistakes](#common-mistakes)
25. [Common Misconceptions](#common-misconceptions)
26. [Tricky Points](#tricky-points)
27. [Test](#test)
28. [Cheat Sheet](#cheat-sheet)
29. [Self-Assessment Checklist](#self-assessment-checklist)
30. [Summary](#summary)
31. [What You Can Build](#what-you-can-build)
32. [Further Reading](#further-reading)
33. [Related Topics](#related-topics)

---

## Introduction
> Focus: x86-TSO formally, ARMv8 acquire/release in detail, exactly which assembly Go emits for each atomic operation on each platform, and how to diagnose false sharing.

The junior file gave you vocabulary and intuition. The middle file gives you precision. We move from "atomics use barriers" to "here is exactly which barrier, here is when, here is why, here is the cost." By the end of this file you should be able to:

- Recite the x86-TSO axioms.
- Predict the output of any small litmus test on x86, ARM, or RISC-V.
- Explain, instruction by instruction, what `atomic.AddInt64(&n, 1)` becomes on each platform.
- Detect false sharing in production code with `perf` counters.
- Implement a sequence lock from scratch with the right barriers.
- Read `runtime/internal/atomic/*.s` and understand each opcode.

We do not assume you can write CPU microcode. We do assume you remember everything in `junior.md`.

---

## Recap and Pivot

From the junior file:

- A memory barrier prevents reordering across it.
- The four reorderings are LL, LS, SS, SL.
- x86-TSO forbids LL, LS, SS; permits SL.
- ARMv8 weak permits all four; provides `LDAR`/`STLR` for cheap acquire/release.
- Store buffers, invalidate queues, MESI.
- `sync/atomic` is sequentially consistent; the runtime picks the right instructions per platform.

Pivot: we are now going to look at *exactly* what the runtime emits, not just "an atomic instruction." We will look at multiple architectures side by side and explain why each chose what it chose.

---

## x86-TSO Formal Model

The x86-TSO model has been formally specified in research papers (Sewell et al., "x86-TSO: A Rigorous and Usable Programmer's Model for x86 Multiprocessors", CACM 2010). The formal axioms are:

### Axiom 1: Write-to-cache order is per-core FIFO

Stores from a single core become globally visible in the order the core issued them. There is no StoreStore reordering at the global level.

### Axiom 2: A core sees its own stores immediately (store-to-load forwarding)

A load on a core sees a pending store from that same core's store buffer if the load's address matches. This is called store-to-load forwarding.

### Axiom 3: A core may see its own stores before other cores see them

The store sits in the local store buffer. Other cores see it only after the buffer drains. This is the source of StoreLoad reordering.

### Axiom 4: There is a total order on memory operations after they leave their buffers

Once stores have left their respective buffers and entered the global cache coherence protocol, all cores agree on their order. This means coherence guarantees a single timeline of when each store becomes visible.

### Axiom 5: LOCK and MFENCE drain the local store buffer

A `LOCK`-prefixed RMW or a standalone `MFENCE` forces the issuing core to drain its store buffer before continuing. After the fence, the next memory operation sees a consistent global state.

### Consequences for programmers

- Reads after writes to *the same address* see the new value immediately (forwarding).
- Reads after writes to *different addresses* may see stale values until the buffer drains.
- All other reorderings (LL, LS, SS) are forbidden.
- A single fence per "store followed by load to a different address" suffices for ordering.

### Why this matters for Go

`sync/atomic.Store` on amd64 uses `XCHG` (full-barrier RMW). This drains the store buffer of the issuing core. Subsequent loads, even to different addresses, will see globally consistent state. This means the Dekker case is fixed by `sync/atomic.Store` alone — no separate `MFENCE` is needed.

`sync/atomic.Load` on amd64 is a plain `MOV`. Why is this sufficient? Because the only reordering x86 permits is StoreLoad — that is, a store that the current core has issued *can* appear after a later load. But for `atomic.Load`, *we* are the load. There is no earlier *atomic store* in our same-core code that could be reordered past the load (atomicity is per-instruction). Cross-core, the atomic load sees whatever the global state is at issue time, modulo coherence. So a plain `MOV` is enough.

This is exactly the pattern: read the architecture's rules, find the cheapest instruction that satisfies them.

---

## Litmus Tests Through the TSO Lens

Let us walk through five canonical litmus tests and ask: on x86-TSO, can the bad outcome happen?

### Test 1: SB (Store Buffer)

```
Initial: x=0, y=0

P0:                 P1:
  x = 1              y = 1
  r0 = y             r1 = x

Bad outcome: r0 = 0 AND r1 = 0
```

**TSO verdict:** ALLOWED. Each core's store sits in its buffer; each core's load returns 0 from a not-yet-updated cache. Need `MFENCE` (or `LOCK`-prefix) between store and load on both sides to forbid.

### Test 2: MP (Message Passing)

```
Initial: x=0, ready=0

P0:                  P1:
  x = 42                wait until ready = 1
  ready = 1             r = x

Bad outcome: r = 0 (P1 sees ready=1 but old x)
```

**TSO verdict:** FORBIDDEN. The two stores on P0 must appear in order (StoreStore forbidden); the two loads on P1 must appear in order (LoadLoad forbidden). Hence if `ready` was seen as 1, the earlier store to `x` was already flushed.

**Verdict on ARM:** ALLOWED. Both reorderings can happen. Need `STLR` for the `ready` store and `LDAR` for the `ready` load.

This is the standard publish-subscribe pattern and explains why moving from x86 to ARM exposes hidden bugs.

### Test 3: LB (Load Buffer)

```
Initial: x=0, y=0

P0:                 P1:
  r0 = x              r1 = y
  y = 1               x = 1

Bad outcome: r0 = 1 AND r1 = 1 (both loads saw the *other* core's later store)
```

**TSO verdict:** FORBIDDEN. The load on each core must appear before the store on that core (LoadStore forbidden on TSO).

**ARM verdict:** Technically allowed in some models. Real-world ARM CPUs don't exhibit this because data dependencies block speculative stores, but the architecture permits it.

### Test 4: WRC (Write-to-Read Causality)

```
Initial: x=0, y=0

P0:                P1:                 P2:
  x = 1             r1 = x              r2 = y
                    y = 1               r3 = x

Bad outcome: r1=1, r2=1, r3=0 (P2 sees y=1, x=0)
```

**TSO verdict:** FORBIDDEN. TSO is "multi-copy atomic": when a store becomes visible to one other core, it is simultaneously visible to all others.

**ARM verdict:** Also forbidden on ARMv8 (which is multi-copy atomic), but allowed on POWER and on early ARMv7.

### Test 5: IRIW (Independent Reads of Independent Writes)

```
Initial: x=0, y=0

P0:        P1:        P2:                 P3:
  x = 1     y = 1      r0 = x              r2 = y
                       r1 = y              r3 = x

Bad outcome: r0=1, r1=0, r2=1, r3=0
(P2 sees x's write but not y's; P3 sees y's write but not x's)
```

**TSO verdict:** FORBIDDEN. The two stores must be totally ordered globally, so the two readers must agree on which came first.

**POWER verdict:** ALLOWED. POWER is *not* multi-copy atomic; different cores can see writes in different orders. This is why POWER programmers need `sync` or `lwsync` more often than ARM programmers.

**ARMv8 verdict:** Forbidden since ARMv8 is multi-copy atomic.

### Lessons

- Most litmus tests are *forbidden* on x86-TSO, *allowed* on weakly-ordered ARMv7/POWER, and *depending* on ARMv8.
- This is why x86 programmers grow lazy intuitions that bite them on other platforms.
- The Go memory model abstracts over all of this with sequential consistency — but only for `sync/atomic` operations. Plain access has no such guarantees.

---

## ARMv8 Memory Model in Practice

ARMv8 has a *weak* memory model with several useful features:

### Multi-copy atomicity

All cores agree on the order of any single variable's writes. Different variables may be seen in different orders (without barriers).

### Acquire/release loads and stores

- `LDAR Xt, [Xn]` — Load-Acquire. The load itself has acquire semantics: no later load or store can be reordered before it.
- `STLR Xt, [Xn]` — Store-Release. The store itself has release semantics: no earlier load or store can be reordered after it.

These are *cheaper* than `DMB` + plain load/store because they piggyback the barrier on the actual memory op. The CPU only stalls if and when needed, often not at all.

### `DMB ISH`, `DMB ISHST`, `DMB ISHLD`

Stand-alone fences. The `ISH` (inner shareable) variant is for multi-core within one chip; `OSH` and `SY` are for system-wide and outer shareable (rare in Go context). The suffixes:
- `DMB ISH` — full data memory barrier
- `DMB ISHST` — store-only barrier (like SFENCE)
- `DMB ISHLD` — load-only barrier (like LFENCE)

### Load/store-exclusive pair (`LDXR`/`STXR`)

The basis for atomic RMW on ARM pre-LSE. `LDXR` loads from memory and marks the cache line as monitored. `STXR` stores back; it succeeds (returns 0) only if no other core has touched the line since the `LDXR`. If it fails (returns nonzero), you loop and retry.

Variants:
- `LDAXR`/`STLXR` — acquire/release variants for atomic operations with full ordering.

### LSE (Large System Extension, ARMv8.1)

Single-instruction atomics: `LDADD`, `SWP`, `CAS`, `LDCLR`, `LDSET`, `LDEOR`. Each has variants with acquire (`A`), release (`L`), or both (`AL`) suffixes.

Examples:
- `LDADDAL X1, X2, [X0]` — atomic add with both acquire and release semantics
- `CASAL X1, X2, [X0]` — atomic compare-and-swap with full ordering
- `SWPAL X1, X2, [X0]` — atomic swap

On hardware with LSE support, these are dramatically faster than the LL/SC loop. Go's runtime detects LSE at startup on arm64 and uses it when available.

### Single example

A `sync/atomic.AddInt64(&n, 1)` on arm64 compiles to:

- On non-LSE cores:
  ```
  again:
      LDAXR  R1, (R0)
      ADD    R1, R1, #1
      STLXR  R2, R1, (R0)
      CBNZ   R2, again
  ```
- On LSE cores:
  ```
  MOVD   $1, R1
  LDADDAL R1, R1, (R0)
  ```

The LSE version is one instruction vs four in the worst case; it scales much better under contention.

---

## MOV vs MOV with LOCK Prefix

Subtle but critical: on x86, a `MOV` cannot take a `LOCK` prefix. `LOCK` can only be applied to a fixed list of read-modify-write instructions:

- `ADD`, `ADC`, `SUB`, `SBB`
- `AND`, `OR`, `XOR`
- `INC`, `DEC`, `NOT`, `NEG`
- `BTC`, `BTR`, `BTS`
- `CMPXCHG`, `CMPXCHG8B`, `CMPXCHG16B`
- `XADD`
- `XCHG` (always, even without `LOCK` prefix — it is implicit)

A `MOV` is a single store, not an RMW, and there is no `LOCK MOV`. To get atomic store-with-fence, you have two options:

1. `MOV` followed by `MFENCE`. Two instructions, ~30+ cycles total.
2. `XCHG` (which has implicit `LOCK`). One instruction, ~20-30 cycles total. As a bonus, `XCHG` is a swap, so you also get the old value back if you want it.

Go picks `XCHG`. The runtime's `Storeuintptr` on amd64 is:

```
TEXT runtime∕internal∕atomic·Storeuintptr(SB), NOSPLIT, $0-16
    JMP runtime∕internal∕atomic·Store64(SB)
```

And `Store64`:

```
TEXT runtime∕internal∕atomic·Store64(SB), NOSPLIT, $0-16
    MOVQ ptr+0(FP), BX
    MOVQ val+8(FP), AX
    XCHGQ AX, 0(BX)
    RET
```

`XCHGQ AX, 0(BX)` is the magic line. The `XCHG` is implicitly atomic and a full barrier.

### Why does Go give all stores full-barrier semantics?

It is conservative, simpler to reason about, and on x86 hardly more expensive than a release-only store. On ARM, the release-only `STLR` *would* be cheaper than `STLR` + `DMB ISH`, but Go's `sync/atomic.Store` is specified as full-barrier, so on ARM the runtime emits `STLR` for the store *and* relies on the architecture's multi-copy atomicity to provide the StoreLoad ordering needed.

On arm64, Go's `Store64` is:

```
TEXT runtime∕internal∕atomic·Store64(SB), NOSPLIT, $0-16
    MOVD ptr+0(FP), R0
    MOVD val+8(FP), R1
    STLR R1, (R0)
    RET
```

Just `STLR`. No standalone fence. The release semantics, combined with multi-copy atomicity, deliver SC ordering to other atomics. This is a place where ARM is genuinely cheaper than x86 for a release-store, despite the weaker base model.

---

## Where MFENCE Actually Lives

`MFENCE` is rarely emitted by the Go compiler today. It used to be emitted by older Go versions for `atomic.Store`; modern Go uses `XCHG` instead. So when does `MFENCE` show up?

1. **Hand-written runtime assembly.** A few places in `runtime/asm_amd64.s` use `MFENCE` directly, typically in scheduler hot paths where the runtime wants a fence without an associated atomic operation.
2. **CGo glue.** Some C code linked into a Go binary may use `MFENCE` directly via `__asm__`.
3. **Older Go versions.** Go 1.12 and earlier used `MOV` + `MFENCE` for some atomic stores; modern versions migrated to `XCHG`.
4. **Memory-mapped I/O code.** Drivers and DPDK-style code that needs a fence between writes to different memory-mapped regions sometimes use `MFENCE`. In pure Go this is unusual.

If you grep `runtime/internal/atomic/*.s` for `MFENCE`, you find very few occurrences in modern Go (1.21+). The instruction's role has been taken over by the `LOCK` prefix on RMW operations, which is slightly cheaper microarchitecturally.

### What `MFENCE` costs

On Skylake and Ice Lake, `MFENCE` takes around 30-40 cycles on an unloaded pipeline, and significantly more when there is in-flight memory traffic to drain. On AMD Zen 3/4 the cost is similar.

By contrast, a `LOCK XADD` on the same hardware takes around 20-30 cycles. Both fully drain the store buffer; both are full barriers.

---

## LFENCE Reconsidered

`LFENCE` is the load fence. Its original purpose was to serialise loads with non-temporal memory accesses. On normal write-back memory, x86 plain loads already do not reorder against each other, so `LFENCE`'s ordering role is rarely needed in normal code.

Then Spectre (2017) reframed the instruction. Intel documented `LFENCE` as a **serializing instruction** in the sense that it blocks speculative execution past it. The CPU must complete all prior instructions before issuing any after `LFENCE`. This is now its dominant use in security-sensitive code.

The Go runtime uses `LFENCE` in a few places:

- Some inline assembly in `crypto/internal/...` packages for constant-time operations.
- Read-side fast paths in scheduler code where the runtime wants to bound speculation.

User code essentially never needs `LFENCE`. If you find yourself reaching for it, double-check — you probably want a `LOCK`-prefixed RMW or `MFENCE`.

### `LFENCE` cost

Around 10-30 cycles on modern Intel; less expensive than `MFENCE` because it does not drain the store buffer.

---

## SFENCE and Non-Temporal Stores

`SFENCE` orders stores with non-temporal stores. Non-temporal stores are issued by `MOVNTDQ`, `MOVNTI`, `MOVNTPS`, etc. — instructions that bypass the cache and write directly to memory. These are used by memcpy/memset implementations for large buffers (the kernel and `runtime.memmove` use them).

Without `SFENCE`, a normal store and a subsequent non-temporal store could become visible out of order. `SFENCE` orders them.

`SFENCE` is essentially never needed in user Go code. It is relevant if:
- You write inline assembly that uses non-temporal stores.
- You are reading runtime/internal code that implements `memmove` for large buffers.

### Cost

Very cheap — around 5-10 cycles. It only orders against non-temporal stores, so it does not need to drain the regular store buffer.

---

## The `sync/atomic` to Hardware Mapping in Detail

Here is the full mapping table for Go 1.21+.

### amd64

| Go call | Assembly |
|---------|----------|
| `atomic.LoadInt32(&p)` | `MOVL (BX), AX` |
| `atomic.LoadInt64(&p)` | `MOVQ (BX), AX` |
| `atomic.LoadPointer(&p)` | `MOVQ (BX), AX` |
| `atomic.StoreInt32(&p, v)` | `XCHGL AX, (BX)` |
| `atomic.StoreInt64(&p, v)` | `XCHGQ AX, (BX)` |
| `atomic.StorePointer(&p, v)` | `XCHGQ AX, (BX)` |
| `atomic.AddInt32(&p, d)` | `LOCK XADDL AX, (BX)` |
| `atomic.AddInt64(&p, d)` | `LOCK XADDQ AX, (BX)` |
| `atomic.SwapInt32(&p, v)` | `XCHGL AX, (BX)` (LOCK implicit) |
| `atomic.SwapInt64(&p, v)` | `XCHGQ AX, (BX)` |
| `atomic.CompareAndSwapInt32(&p, o, n)` | `LOCK CMPXCHGL CX, (BX)` |
| `atomic.CompareAndSwapInt64(&p, o, n)` | `LOCK CMPXCHGQ CX, (BX)` |

### arm64

| Go call | Assembly (LSE) | Assembly (pre-LSE) |
|---------|---------------|-------------------|
| `atomic.LoadInt32(&p)` | `LDARW R1, (R0)` | `LDARW R1, (R0)` |
| `atomic.LoadInt64(&p)` | `LDAR R1, (R0)` | `LDAR R1, (R0)` |
| `atomic.StoreInt32(&p, v)` | `STLRW R1, (R0)` | `STLRW R1, (R0)` |
| `atomic.StoreInt64(&p, v)` | `STLR R1, (R0)` | `STLR R1, (R0)` |
| `atomic.AddInt32(&p, d)` | `LDADDALW R1, R2, (R0)` | LL/SC loop with `LDAXRW`/`STLXRW` |
| `atomic.AddInt64(&p, d)` | `LDADDAL R1, R2, (R0)` | LL/SC loop with `LDAXR`/`STLXR` |
| `atomic.SwapInt32` | `SWPALW R1, R2, (R0)` | LL/SC loop |
| `atomic.SwapInt64` | `SWPAL R1, R2, (R0)` | LL/SC loop |
| `atomic.CompareAndSwap*` | `CASAL R1, R2, (R0)` | LL/SC loop with `LDAXR`/`CMP`/`STLXR` |

### riscv64

| Go call | Assembly |
|---------|----------|
| `atomic.LoadInt32(&p)` | `LW + FENCE r,rw` |
| `atomic.LoadInt64(&p)` | `LD + FENCE r,rw` |
| `atomic.StoreInt32(&p, v)` | `FENCE rw,w + SW + FENCE rw,rw` |
| `atomic.StoreInt64(&p, v)` | `FENCE rw,w + SD + FENCE rw,rw` |
| `atomic.AddInt32(&p, d)` | `AMOADD.W.AQRL` |
| `atomic.AddInt64(&p, d)` | `AMOADD.D.AQRL` |
| `atomic.SwapInt32(&p, v)` | `AMOSWAP.W.AQRL` |
| `atomic.CompareAndSwapInt32` | `LR.W.AQ` + `SC.W.RL` loop |

The RISC-V `FENCE` instruction takes predecessor and successor masks: which operations on which sides must be ordered. `FENCE rw, rw` is a full barrier. `FENCE r, rw` orders prior reads with subsequent reads and writes.

We will explore RISC-V much more deeply in the senior file.

### ppc64le (selected)

| Go call | Assembly |
|---------|----------|
| `atomic.LoadInt64` | `LWSYNC; LD; ISYNC` (or `lwsync` based) |
| `atomic.StoreInt64` | `LWSYNC; STD; SYNC` |
| `atomic.AddInt64` | `LWSYNC; LWARX/STWCX. loop; ISYNC` |

POWER is the most baroque because it is not multi-copy atomic; ordering requires the heavier `sync` for some operations and `lwsync` (lightweight sync) for others.

---

## `runtime/internal/atomic` Walk-Through

Let us look at `runtime/internal/atomic/atomic_amd64.s` in detail. This file is in the Go source tree at `src/runtime/internal/atomic/atomic_amd64.s`. It defines the primitive operations that `sync/atomic` and the runtime itself rely on.

### `Load`

```asm
// func Load(ptr *uint32) uint32
TEXT ·Load(SB), NOSPLIT, $0-12
    MOVQ ptr+0(FP), AX
    MOVL (AX), AX
    MOVL AX, ret+8(FP)
    RET
```

A simple `MOVL`. No fence. On x86-TSO, a plain load has acquire semantics for free.

### `Store`

```asm
// func Store(ptr *uint32, val uint32)
TEXT ·Store(SB), NOSPLIT, $0-12
    MOVQ ptr+0(FP), BX
    MOVL val+8(FP), AX
    XCHGL AX, 0(BX)
    RET
```

`XCHGL` performs the store; the implicit `LOCK` makes it atomic and a full memory barrier.

### `Xadd`

```asm
// func Xadd(ptr *uint32, delta int32) uint32
TEXT ·Xadd(SB), NOSPLIT, $0-20
    MOVQ ptr+0(FP), BX
    MOVL delta+8(FP), AX
    MOVL AX, CX
    LOCK
    XADDL AX, 0(BX)
    ADDL CX, AX
    MOVL AX, ret+16(FP)
    RET
```

`LOCK XADDL` is the atomic exchange-and-add. It returns the *previous* value in `AX`. To return the *new* value (what Go's `atomic.AddInt32` documents), the runtime adds the delta back to the old value.

### `Cas`

```asm
// func Cas(ptr *uint32, old, new uint32) bool
TEXT ·Cas(SB), NOSPLIT, $0-17
    MOVQ ptr+0(FP), BX
    MOVL old+8(FP), AX
    MOVL new+12(FP), CX
    LOCK
    CMPXCHGL CX, 0(BX)
    SETEQ ret+16(FP)
    RET
```

`LOCK CMPXCHGL` compares `AX` with the memory location; if equal, stores `CX`; if not, loads memory into `AX`. The `ZF` flag is set on success; `SETEQ` extracts it.

### `Xchg`

```asm
// func Xchg(ptr *uint32, new uint32) uint32
TEXT ·Xchg(SB), NOSPLIT, $0-20
    MOVQ ptr+0(FP), BX
    MOVL new+8(FP), AX
    XCHGL AX, 0(BX)
    MOVL AX, ret+16(FP)
    RET
```

`XCHGL` swaps. Returns the old value (what was in memory before).

### `LoadAcq`

```asm
// func LoadAcq(ptr *uint32) uint32
TEXT ·LoadAcq(SB), NOSPLIT, $0-12
    JMP ·Load(SB)
```

On amd64, acquire-load is just a plain load. The function exists for symmetry with weakly-ordered platforms.

### `StoreRel`

```asm
// func StoreRel(ptr *uint32, val uint32)
TEXT ·StoreRel(SB), NOSPLIT, $0-12
    MOVQ ptr+0(FP), BX
    MOVL val+8(FP), AX
    MOVL AX, 0(BX)
    RET
```

Interesting! On amd64, a release-only store is a plain `MOVL`. No fence at all. This is because the natural `MOV` already has release semantics (it cannot be reordered past later operations except via the StoreLoad case, which is allowed). The full-barrier `XCHGL` is reserved for the SC-semantic `Store`. `StoreRel` is cheaper and used in places where the runtime knows it only needs release semantics, not full SC.

This is one of the very few places where the runtime exposes a relaxed-ordering primitive. It is not available to user code (it is in `internal/`), but its existence shows that the runtime *does* differentiate when it can.

### `runtime/internal/atomic/atomic_arm64.s`

The arm64 file has the same function set, but each function uses ARM-specific instructions:

```asm
// func Load(ptr *uint32) uint32
TEXT ·Load(SB), NOSPLIT, $0-12
    MOVD ptr+0(FP), R0
    LDARW R0, (R0)
    MOVW R0, ret+8(FP)
    RET

// func Store(ptr *uint32, val uint32)
TEXT ·Store(SB), NOSPLIT, $0-12
    MOVD ptr+0(FP), R0
    MOVW val+8(FP), R1
    STLRW R1, (R0)
    RET

// func LoadAcq(ptr *uint32) uint32
TEXT ·LoadAcq(SB), NOSPLIT, $0-12
    JMP ·Load(SB)

// func StoreRel(ptr *uint32, val uint32)
TEXT ·StoreRel(SB), NOSPLIT, $0-12
    JMP ·Store(SB)
```

Note that on arm64, `Load` and `LoadAcq` are the same — both use `LDARW`, which is acquire-load. Similarly `Store` and `StoreRel` both use `STLRW`. ARM does not provide a cheaper SC-load than `LDARW`, so the runtime does not differentiate.

For atomic RMW operations, the arm64 file dispatches between LSE and non-LSE paths based on a runtime flag set during startup. This dispatch is encoded by Go's go-runtime team via build-tag or runtime flag mechanisms.

---

## Cache Coherence and MESI

MESI ("Modified, Exclusive, Shared, Invalid") is the protocol most modern x86 and ARM cores use to keep their caches consistent. We sketch its rules.

### The four states per cache line

- **M (Modified):** This core has the only copy, and it differs from main memory. This core must write back before the line can be evicted.
- **E (Exclusive):** This core has the only copy, and it matches memory. Safe to upgrade to M without bus traffic if we want to write.
- **S (Shared):** Multiple cores have copies, all matching memory.
- **I (Invalid):** This core does not have a valid copy.

### Transitions on read

- Reading a line in M, E, or S state: hit. No bus traffic.
- Reading a line in I state: miss. Send read request on the coherence bus. Other cores snoop:
  - If any has it in M, that core writes back, transitions to S, and supplies us; we transition to S.
  - If any has it in E or S, they transition to S; we transition to S.
  - If no core has it, we read from memory and transition to E.

### Transitions on write

- Writing a line in M: hit, no bus traffic.
- Writing a line in E: silently upgrade to M.
- Writing a line in S: send "I want to modify" (RFO = Read For Ownership) on the bus. Other cores snoop and invalidate their copies, transitioning to I. We transition to M.
- Writing a line in I: miss. Send RFO. Other cores invalidate or supply; we transition to M.

### Costs

- L1 cache hit: ~4 cycles.
- L2 hit: ~12 cycles.
- L3 hit: ~40 cycles.
- Cache-coherent intervention (M-state line on a different core): ~80-200 cycles.
- DRAM: ~200-400 cycles.

A line that ping-pongs between two cores is constantly transitioning M ↔ I, paying intervention cost each time. This is the false sharing penalty.

### MOESI

POWER and some AMD cores use MOESI, adding an "Owned" state where a line can be both modified *and* shared. This allows a modified line to be supplied to a reader without write-back. The Go runtime doesn't care about MOESI vs MESI distinctions; it programs to the architectural memory model.

---

## False Sharing in Depth

Take a counter array used by multiple goroutines:

```go
type counters struct {
    a atomic.Int64
    b atomic.Int64
    c atomic.Int64
    d atomic.Int64
}

var c counters

// goroutine 1 does c.a.Add(1) in a tight loop
// goroutine 2 does c.b.Add(1) in a tight loop
```

The four `atomic.Int64`s are eight bytes each, totalling 32 bytes — they fit on one 64-byte cache line. Every `Add` triggers an RFO on the shared cache line. Goroutine 1 and 2 fight for ownership constantly. The throughput drops by 5-20x compared to padded versions.

### Diagnosis

Use `perf` on Linux:

```
$ perf stat -e cache-misses,cache-references,l1d.replacement ./your-prog
```

A high `cache-misses` count and frequent `l1d.replacement` events on the relevant line are the signature.

On Mac, `xcrun xctrace record --template "Time Profiler"` plus the System Trace template can show similar information.

In Go, `runtime/pprof` does not directly report false sharing — you have to suspect it and verify with hardware counters or a custom benchmark.

### Fix

Pad each hot atomic:

```go
type counters struct {
    a atomic.Int64
    _ [56]byte
    b atomic.Int64
    _ [56]byte
    c atomic.Int64
    _ [56]byte
    d atomic.Int64
    _ [56]byte
}
```

Now each counter lives on its own 64-byte line. Each goroutine has exclusive access to its line; no RFO storms.

Cost: 64 bytes per counter instead of 8. For four counters, 256 bytes vs 32. Negligible for most use cases; transformative for hot paths.

### When *not* to pad

If counters are typically accessed from one goroutine, padding wastes memory and slightly hurts cache density. Pad only when profiling shows the line is contended.

### `sync.Pool` and false sharing

`sync.Pool` internally uses per-P (per-processor) local pools to avoid contention. It pads aggressively — look at `src/sync/pool.go` and you will see `_pad` fields between hot fields. This is precisely false-sharing prevention.

---

## Reading `go tool objdump`

A practical workflow.

### Setup

```
$ go build -o myprog ./...
$ go tool objdump -s 'pkg\.func' ./myprog | less
```

### Reading the output

Typical output looks like:

```
TEXT pkg.MyFunc(SB) main.go
  main.go:42  0x123456  64488b0c2528000000   MOVQ FS:0x28, CX
  main.go:43  0x12345f  4885c9               TESTQ CX, CX
  main.go:43  0x123462  741a                 JE 0x12347e
  ...
```

Each line:
- Source line.
- Address in the binary.
- Raw bytes of the instruction.
- Disassembly.

### Finding atomic operations

Look for:
- `XCHG` or `XCHGL`/`XCHGQ` — atomic store or swap on amd64.
- `LOCK` prefix (sometimes printed before the next instruction) — atomic RMW.
- `MFENCE`, `LFENCE`, `SFENCE` — explicit fences.
- `LDAR`, `STLR`, `LDADDAL`, `CAS` (on arm64) — atomic operations.
- `DMB ISH` — fence on arm64.

### Practical exercise

Take a piece of code you wrote, compile it, dump the function, and identify every atomic operation. If you cannot find a fence where you expected one, you may have:
- Used the wrong primitive (e.g. plain assignment instead of `atomic.Store`).
- Hit a compiler optimization that eliminated the operation.
- Misunderstood when a particular primitive emits a fence.

This skill is invaluable. Every middle-level Go programmer should be able to read `objdump` output for atomic code.

---

## Building a Producer-Consumer with Atomics

Let us build a simple bounded ring buffer using only atomics (no mutex, no channel). This exercise shows where every barrier matters.

```go
package ringbuf

import (
    "sync/atomic"
    "unsafe"
)

type RingBuf[T any] struct {
    buf  []T
    head atomic.Uint64 // producer index (writes here)
    tail atomic.Uint64 // consumer index (reads here)
    _    [40]byte      // padding to put head and tail on separate lines (head: 8, atomic.Uint64 padded to 64? actually 8)
}

func New[T any](size int) *RingBuf[T] {
    return &RingBuf[T]{buf: make([]T, size)}
}

func (r *RingBuf[T]) Push(v T) bool {
    head := r.head.Load()
    tail := r.tail.Load()
    if head-tail >= uint64(len(r.buf)) {
        return false // full
    }
    r.buf[head%uint64(len(r.buf))] = v
    r.head.Store(head + 1) // publish
    return true
}

func (r *RingBuf[T]) Pop() (T, bool) {
    var zero T
    tail := r.tail.Load()
    head := r.head.Load() // acquire: pairs with Push's release
    if tail == head {
        return zero, false // empty
    }
    v := r.buf[tail%uint64(len(r.buf))]
    r.tail.Store(tail + 1)
    return v, true
}

// Suppress unused warning
var _ = unsafe.Sizeof(RingBuf[int]{})
```

This is a *single-producer, single-consumer* ring buffer (SPSC). It assumes only one goroutine ever calls `Push` and only one ever calls `Pop`. With those constraints, the atomics for `head` and `tail` give us correct synchronisation.

### Why this works

- The producer writes the slot, then publishes via `head.Store(head + 1)`. The release on this store ensures the slot write happens-before any consumer that observes the new head.
- The consumer reads `head.Load()` (acquire); if it sees the new head, it can read the slot safely. The acquire-release pair gives the happens-before edge.
- The producer reads `tail.Load()` to check if the buffer is full. This is an acquire, but in SPSC it suffices because the consumer's `tail.Store(tail + 1)` is a release.
- The slot write is *plain*. No atomic. This is correct because the SPSC discipline means only one goroutine writes any given slot at a time, and the publish-via-head establishes ordering with the consumer.

### MPMC variants

A multi-producer, multi-consumer (MPMC) ring is much harder. You need CAS loops to reserve slots, and you need to handle the case where producers race with each other to claim the next head. The "LMAX Disruptor" and "Vyukov MPSC queue" are well-known examples.

We will build an MPMC queue in the senior file.

### Verification

Run with `-race`. If the race detector doesn't complain in a single-producer, single-consumer test, the algorithm is likely correct. (The race detector tracks happens-before, so it sees the release-acquire edges through `head` and `tail`.)

---

## Building a Sequence Lock

A *sequence lock* (seqlock) is a synchronisation primitive popularised by the Linux kernel. It allows many readers to observe a consistent snapshot of a multi-word state without taking a real lock — at the cost of potential retries.

```go
package seqlock

import "sync/atomic"

type SeqLock[T any] struct {
    seq   atomic.Uint64
    value T
}

func (s *SeqLock[T]) Write(v T) {
    seq := s.seq.Load()
    s.seq.Store(seq + 1) // mark "writing in progress"
    s.value = v          // write protected data
    s.seq.Store(seq + 2) // mark "writing done"
}

func (s *SeqLock[T]) Read() T {
    for {
        seq1 := s.seq.Load()
        if seq1%2 != 0 {
            continue // writer in progress
        }
        v := s.value
        seq2 := s.seq.Load()
        if seq1 == seq2 {
            return v
        }
        // sequence number changed mid-read; retry
    }
}
```

### What barriers matter

- The writer's first `Store` must happen-before the value write. It is a release-store, so the value write is ordered after it from the reader's perspective. Wait — actually, we want the *opposite*: the value write must happen *before* the sequence number's "done" increment. The Store(seq+1) is a release, then the value write (a plain non-atomic assignment), then the Store(seq+2) is a release. The release on Store(seq+2) ensures the value write is published.
- The reader's first `Load(seq)` is an acquire. The plain read of `value` is ordered after it. The reader's second `Load(seq)` is also an acquire. If the second read equals the first, no writer ran during the read, so the value is consistent.

Wait — there is still a subtle hole. The plain read of `value` could in principle be reordered *before* the first sequence-number load. To prevent this, in C we would need a `LoadLoad` barrier (or use `volatile`). In Go, the acquire-Load on `seq` is sufficient: the acquire prevents subsequent loads from being reordered earlier.

### Limits

- Only suitable when writers are rare; readers may retry indefinitely if writes are frequent.
- The protected data must be byte-readable without tearing (no half-updates visible). Use atomic loads/stores or memcpy into a local buffer.

Real-world example: the Linux kernel's `jiffies` global; the Go runtime's `runtime.now()` (which uses a sequence-lock-like pattern internally to read monotonic time atomically).

---

## Coding Patterns

### Pattern: lazy initialization with `sync.Once`

```go
var (
    once   sync.Once
    config *Config
)

func GetConfig() *Config {
    once.Do(func() {
        config = loadConfig()
    })
    return config
}
```

Under the hood, `sync.Once` does:
1. Fast-path atomic load of an internal `done` flag.
2. If set, return immediately.
3. Else, acquire a mutex, double-check, run the closure, set `done` atomically, release.

The atomic load on the fast path is acquire; the atomic store on the slow path is release. This gives readers visibility into the closure's writes.

### Pattern: per-CPU counter

```go
type PerCPUCounter struct {
    counters []paddedCounter
}

type paddedCounter struct {
    n atomic.Int64
    _ [56]byte
}

func New() *PerCPUCounter {
    return &PerCPUCounter{counters: make([]paddedCounter, runtime.GOMAXPROCS(0))}
}

func (c *PerCPUCounter) Inc() {
    pid := runtime_procPin() // pseudo-code; real impl uses runtime/internal/sys
    c.counters[pid].n.Add(1)
    runtime_procUnpin()
}

func (c *PerCPUCounter) Sum() int64 {
    var total int64
    for i := range c.counters {
        total += c.counters[i].n.Load()
    }
    return total
}
```

The padding avoids false sharing. Per-CPU updates scale linearly with cores. Reads are O(n) in the number of CPUs.

### Pattern: read-mostly state with `atomic.Pointer`

```go
type Config struct {
    Servers []string
    Timeout time.Duration
}

var current atomic.Pointer[Config]

func Get() *Config {
    return current.Load()
}

func Update(c *Config) {
    current.Store(c)
}
```

Readers do a single atomic load. Updaters do a single atomic store. No copy needed because the structure is immutable after publication. The barrier semantics of `atomic.Pointer` give readers a consistent view.

The pattern requires that the pointed-to data is immutable: after `Update`, the returned pointer's data must not change. Otherwise concurrent readers may observe partial updates.

---

## Clean Code

- Wrap every `sync/atomic` use in a higher-level type with a clear name. Don't sprinkle `atomic.LoadInt32(&x)` throughout your code.
- Comment the *invariant* every atomic protects.
- Use Go 1.19+ typed atomics (`atomic.Bool`, `atomic.Int32`, `atomic.Pointer[T]`). They prevent accidentally mixing atomic and non-atomic access.
- For complex protocols (e.g. seqlocks, MPMC queues), keep the implementation in a single file with extensive comments. The barriers are easy to forget when reading code.
- Avoid `unsafe.Pointer` atomics unless necessary; `atomic.Pointer[T]` is type-safe.

---

## Error Handling

There is no "error" in atomic primitives. The errors are *logical* and *temporal*:

- Race-detector reports are pseudo-errors: they indicate a missing synchronization edge, not a runtime fault.
- A `LDAXR`/`STLXR` pair that loops more than a few times typically indicates contention — not an error, but a performance bug.
- A `CompareAndSwap` failure is *expected* in lock-free algorithms; you retry. It is not an error.
- A `SIGBUS` on misaligned atomic access on 32-bit ARM is a real runtime fault.

In Go, the typed atomics like `atomic.Int64` guarantee alignment, so SIGBUS on misalignment is essentially impossible from pure Go code.

---

## Security Considerations

We touched on this in the junior file. Middle-level additions:

- `LFENCE` as a Spectre mitigation: used in some kernel and crypto code paths.
- Constant-time operations: `crypto/subtle.ConstantTimeCompare` uses XOR-OR style code; barriers aren't directly involved but cache timing is.
- Atomic operations expose cache-line state transitions; on Spectre-vulnerable cores this can leak. Use `crypto/internal` packages for security-sensitive code.

---

## Performance Tips

- Avoid `MFENCE` if you can. Modern Go does not emit it for atomics; do not introduce it manually.
- Use `atomic.Pointer[T]` for "publish a snapshot" patterns. A single atomic store/load is much cheaper than a mutex.
- Per-CPU sharding for hot counters: reduces contention dramatically. `sync.Pool` does this internally.
- For RMW operations, prefer `LDADDAL` (LSE) on arm64 over LL/SC. Modern hardware has it; Go uses it automatically.
- For "increment then read" patterns, `Add` returns the new value — no separate load needed.
- For "test and set" patterns, `CompareAndSwap` is the right primitive.

---

## Best Practices

1. Profile before optimising. If your mutex isn't a bottleneck, don't replace it.
2. Run `-race` on every PR.
3. Run tests on `arm64` if you ship to ARM servers.
4. Document barrier intent in comments.
5. Use typed atomics, never raw `atomic.Load`/`Store` on `*int32` etc.
6. Pad hot atomics to 64 bytes for false-sharing prevention.
7. Prefer `sync.Mutex` for moderate contention; atomics for extreme hot paths.
8. Use `sync.Once` for one-shot initialization, not hand-rolled `atomic.Bool` flags.

---

## Edge Cases and Pitfalls

### Pitfall: typed atomic on platform without natural alignment

`atomic.Int64` is always 8-byte aligned, even on 32-bit ARM. The compiler enforces this. But raw `int64` is not automatically aligned. If you compute a pointer via `unsafe.Pointer` arithmetic into a misaligned `int64` and call `atomic.LoadInt64`, you get SIGBUS on 32-bit ARM.

### Pitfall: assuming `atomic.Pointer.Load` extends lifetime

`p.Load()` returns a pointer; the GC keeps the pointed-to object alive while you hold the pointer. But the *previous* value the pointer pointed to might be garbage-collected as soon as `Store` runs. If you use `unsafe` to bypass the GC, you lose this protection.

### Pitfall: forgetting alignment for embedded struct fields

If you have:

```go
type S struct {
    a int32          // 4 bytes
    b atomic.Int64   // 8 bytes
}
```

On 64-bit platforms, `a` is at offset 0; `b` is at offset 8 (the compiler pads). Aligned. Good.

But on 32-bit platforms, the compiler may *not* automatically 8-byte align `b`. With Go's typed atomics (Go 1.19+), the compiler enforces 8-byte alignment for `atomic.Int64`. With raw `int64`, it does not.

Always prefer typed atomics for portability.

### Pitfall: barriers inside loops with branch prediction

A `LOCK XADD` inside a hot loop can serialize the CPU. If you have:

```go
for i := 0; i < 1000000; i++ {
    counter.Add(1)
}
```

This loop is essentially CPU-bound by the cost of `LOCK XADD` (~20 cycles each). On a 4 GHz CPU, that is 20 million cycles, or 5 ms. If you instead accumulate locally and do a single `Add(n)` at the end, the time drops to a fraction.

### Pitfall: `runtime.LockOSThread` and barriers

`LockOSThread` pins a goroutine to an OS thread. The OS thread may still migrate between cores unless you also use `taskset` (Linux) or `pthread_setaffinity_np`. Atomics still work cross-core; the lock only affects scheduling, not cache placement.

---

## Common Mistakes

- Using `int64` directly across goroutines instead of `atomic.Int64`.
- Calling `atomic.LoadInt64(&x)` once and then assuming the value is stable for the rest of the function.
- Mixing `atomic.Pointer[T]` and raw pointer access via `unsafe.Pointer`.
- Putting `atomic.Store` *before* the data write instead of *after*. The publication must be the last operation.
- Hand-rolling double-checked locking instead of using `sync.Once`.
- Padding the struct but forgetting that two padded atomics can still share a line if the padding is wrong.

---

## Common Misconceptions

- "x86 needs no fences." It needs them for store-then-load to a different address; this is the StoreLoad case. The fences are *implicit* in `LOCK` prefixes; not invisible, just hidden.
- "ARM is slow because of fences." `LDAR`/`STLR` are often as fast as `LDR`/`STR` under low contention. The relative speed of ARM atomics vs x86 atomics depends on the specific microarchitecture and workload.
- "Atomic loads are slower than plain loads." On x86, an atomic load *is* a plain load. On ARM, `LDAR` is slightly slower than `LDR` but usually within 10%.
- "MFENCE blocks all CPU activity." It only serializes memory operations on the issuing core; the rest of the system continues.

---

## Tricky Points

### Tricky 1: `XCHG` is implicitly LOCK; `MOV` cannot be made LOCK

`XCHG mem, reg` is the only x86 instruction that has implicit `LOCK` semantics — it is always atomic, even without the prefix byte. Trying to write `LOCK MOV` is a syntax error; the assembler refuses.

### Tricky 2: Acquire-load forms a happens-before edge, but only with a paired release-store

An `LDAR` on a variable that no one ever release-stored to is useless ordering-wise. The acquire is half of an edge; without a matching release on the writer side, no edge forms. Always think in pairs.

### Tricky 3: Multi-copy atomicity affects which models need extra fences

POWER is not multi-copy atomic. It needs `sync` to provide IRIW-style ordering. ARM and x86 are multi-copy atomic. RISC-V's RVWMO is multi-copy atomic by default. Go's `sync/atomic` operations on POWER include the necessary `sync` instructions.

### Tricky 4: 32-bit ARM atomics use a fallback

32-bit ARM (`linux/arm`) doesn't have 64-bit atomic instructions on all microarchitectures. Go provides a software fallback that uses `kuser_cmpxchg64`, a kernel-provided helper. This is slower than hardware atomics but correct.

### Tricky 5: WASM has no atomics by default

The `wasm` Go target has no SMP, no shared memory across goroutines, so atomics degenerate to plain loads and stores. If you're targeting WebAssembly, the `runtime/internal/atomic/atomic_wasm.s` file shows the (trivial) implementation.

---

## Test

### Test 1: Predict assembly

`atomic.AddInt32(&n, 5)` on amd64 → ?

**Answer:** `MOVL $5, AX; LOCK XADDL AX, (BX); ADDL $5, AX; ...` (the runtime returns the *new* value, computed as old + delta).

### Test 2: Identify the bug

```go
type Stats struct {
    count atomic.Int64
    total atomic.Int64
}

func (s *Stats) Add(v int64) {
    s.count.Add(1)
    s.total.Add(v)
}
```

**Q:** What is wrong?
**A:** It is not atomic *across the two operations*. A reader who calls `s.count.Load()` and then `s.total.Load()` may see `count == 10, total == 0` or `count == 9, total == 1` (after another writer ran in between). To get a consistent (count, total) pair, you need a mutex or a more clever scheme like a seqlock.

### Test 3: Choose the platform

You see this in assembly: `LDADDAL X1, X2, [X0]`. What architecture?

**Answer:** ARMv8.1+ with LSE.

### Test 4: Identify the operation

`LOCK CMPXCHGL CX, (BX)` — what Go call does this implement?

**Answer:** `atomic.CompareAndSwapInt32` (or `atomic.Int32.CompareAndSwap`).

---

## Cheat Sheet

```
MIDDLE-LEVEL CHEAT SHEET
=======================

x86-TSO axioms
  - Stores from one core are globally ordered.
  - Store-to-load forwarding within a core.
  - Store buffer hides stores from other cores until drained.
  - LOCK/MFENCE drains the store buffer.

ARMv8 essentials
  - LDAR = acquire-load; STLR = release-store.
  - DMB ISH = full data memory barrier (all four orderings).
  - LSE = single-instruction atomics with .A/.L/.AL suffixes.

Go atomic → assembly (selected)
  amd64    arm64 (LSE)        riscv64
  LoadX    MOV       LDARW    LW + FENCE r,rw
  StoreX   XCHG      STLRW    FENCE rw,w + SW + FENCE rw,rw
  AddX     LOCK XADD LDADDALW AMOADD.W.AQRL
  CasX     LOCK CMPXCHG  CASALW LR.W.AQ + SC.W.RL loop

Reading objdump
  - go tool objdump -s 'pkg\.func' ./bin
  - Look for XCHG, LOCK, MFENCE, LDAR, STLR, DMB ISH.

False sharing
  - Two atomics on the same 64-byte line cause RFO storms.
  - Pad to a full cache line (typically [56]byte after 8-byte atomic).
  - Detect with perf stat -e cache-misses.

Sequence lock
  - Writer increments seq odd/even.
  - Reader retries while seq is odd or differs across two reads.
  - Cheap many-reader pattern when writers are rare.
```

---

## Self-Assessment Checklist

- [ ] I can recite the x86-TSO axioms.
- [ ] I can predict the outcome of SB, MP, LB, WRC, IRIW litmus tests on x86 and ARMv8.
- [ ] I know exactly what `atomic.AddInt64(&n, 1)` compiles to on amd64 and arm64.
- [ ] I can detect false sharing with `perf` or a custom benchmark.
- [ ] I can read `runtime/internal/atomic/*.s` and understand the LL/SC loops.
- [ ] I have implemented a sequence lock and tested it under contention.
- [ ] I can explain why `MFENCE` is rarely emitted by modern Go.
- [ ] I understand the difference between `Store` (full SC) and `StoreRel` (release-only) in `runtime/internal/atomic`.

---

## Summary

The middle level deepens the junior's foundation with precision:

- **x86-TSO** is a small set of axioms that explain every reordering. The store buffer is the source of StoreLoad. `LOCK`/`MFENCE` drains it.
- **ARMv8** provides `LDAR`/`STLR` for cheap single-instruction acquire/release, plus `DMB ISH` for full barriers. Multi-copy atomicity simplifies cross-thread ordering.
- **`sync/atomic`** maps to specific instructions on each platform. On amd64, `Load` is `MOV`, `Store` is `XCHG`, RMW uses `LOCK`-prefix. On arm64 with LSE, `LDADDAL`/`CASAL`/`SWPAL` provide single-instruction atomics.
- **`runtime/internal/atomic`** is the runtime's private atomic package, with per-architecture assembly files. It exposes both full-SC and release-only primitives; user code only gets full-SC via `sync/atomic`.
- **Cache coherence** (MESI) is automatic; **memory order** is the programmer's responsibility, via fences.
- **False sharing** is a real performance issue, diagnosed with `perf` and fixed with cache-line padding.
- **Sequence locks** are a classical pattern for many-reader, few-writer state.

The next file, `senior.md`, takes us into RISC-V WMO, MOESI, the Linux kernel's barrier macros, and how Go's runtime mirrors them. We will also tackle MPMC lock-free queues.

---

## What You Can Build

- A producer-consumer ring buffer.
- A sequence lock for read-mostly state.
- A per-CPU counter with cache-line padding.
- A read-mostly config update via `atomic.Pointer`.
- A profiling harness to detect false sharing.

---

## Further Reading

- Sewell et al., "x86-TSO: A Rigorous and Usable Programmer's Model for x86 Multiprocessors", CACM 2010.
- Maranget, Sarkar, Sewell, "A Tutorial Introduction to the ARM and POWER Relaxed Memory Models", 2012.
- The Linux kernel Documentation/memory-barriers.txt — exhaustive reference for hardware models.
- The Go runtime source: `src/runtime/internal/atomic/` directory.
- Russ Cox, "Hardware Memory Models" (research.swtch.com).
- Travis Downs, "Hardware Effects" GitHub repo.

---

## Related Topics

- [Junior file](junior.md) — vocabulary and intuition.
- [Senior file](senior.md) — RISC-V WMO, MESI/MOESI deep dive, MPMC queues.
- `sync.Mutex` internals (Roadmap section on mutexes).
- Garbage collection write barriers (`runtime/mwbbuf.go`).
- Lock-free data structures (Roadmap section on lock-free).
- The Go memory model (`go.dev/ref/mem`).

---

## Appendix A: A Side-By-Side Disassembly Tour

The single most clarifying exercise at the middle level is to take one Go program and disassemble it for `amd64`, `arm64`, and `riscv64`, looking at the *same* operation under three different ISAs. We'll do that here.

Program (`bench/atomic.go`):

```go
package atomicbench

import "sync/atomic"

var counter int64

//go:noinline
func IncFull() {
    atomic.AddInt64(&counter, 1)
}

//go:noinline
func IncCAS() {
    for {
        old := atomic.LoadInt64(&counter)
        if atomic.CompareAndSwapInt64(&counter, old, old+1) {
            return
        }
    }
}

//go:noinline
func ReadCounter() int64 {
    return atomic.LoadInt64(&counter)
}

//go:noinline
func PublishCounter(v int64) {
    atomic.StoreInt64(&counter, v)
}
```

### A.1 amd64

```
TEXT atomicbench.IncFull(SB)
    MOVQ    $1, AX
    LOCK
    XADDQ   AX, atomicbench.counter(SB)
    RET

TEXT atomicbench.IncCAS(SB)
loop:
    MOVQ    atomicbench.counter(SB), AX
    LEAQ    1(AX), CX
    LOCK
    CMPXCHGQ CX, atomicbench.counter(SB)
    JNE     loop
    RET

TEXT atomicbench.ReadCounter(SB)
    MOVQ    atomicbench.counter(SB), AX
    RET

TEXT atomicbench.PublishCounter(SB)
    MOVQ    val+0(FP), AX
    XCHGQ   AX, atomicbench.counter(SB)
    RET
```

Notice how every modifying operation has a `LOCK` prefix or implicit lock (`XCHGQ`). The `LOCK` prefix:

- Asserts the bus-lock or cache-line-lock signal so no other core can see the line in an intermediate state.
- Acts as a full StoreLoad fence — your store cannot pass any later load, and no later memory op can begin until the locked operation retires.
- Costs roughly 10–25 ns on modern Intel/AMD, depending on cache state.

`ReadCounter` is just a plain `MOVQ` because x86 loads are already acquire.

### A.2 arm64 (ARMv8.1+ with LSE)

```
TEXT atomicbench.IncFull(SB)
    MOVD    $1, R0
    MOVD    $counter, R1
    LDADDAL R0, R0, (R1)   // atomic add with acquire+release
    RET

TEXT atomicbench.IncCAS(SB)
loop:
    LDAXR   R0, (R1)        // load-exclusive-acquire
    ADD     R2, R0, $1
    STLXR   R3, R2, (R1)    // store-exclusive-release
    CBNZ    R3, loop
    RET

TEXT atomicbench.ReadCounter(SB)
    LDAR    R0, (R1)        // load-acquire
    RET

TEXT atomicbench.PublishCounter(SB)
    STLR    R0, (R1)        // store-release (+ MFENCE-like for SC)
    DMB     ISH             // emitted by Go for full SC store
    RET
```

`LDADDAL` is the ARMv8.1 LSE instruction "Load-Add with Acquire and Release ordering." On a CPU without LSE, the compiler falls back to an `LDAXR`/`STLXR` loop. Go's runtime detects LSE at startup and patches the runtime atomic stubs.

`LDAR`/`STLR` are single-instruction half-fences: load-acquire and store-release respectively. For full sequential consistency Go pairs `STLR` with a `DMB ISH` (Data Memory Barrier, Inner Shareable domain).

### A.3 riscv64

```
TEXT atomicbench.IncFull(SB)
    LI      T0, 1
    AMOADD.D.AQRL T0, T0, (T1)
    RET

TEXT atomicbench.IncCAS(SB)
loop:
    LR.D.AQ T0, (T1)
    ADDI    T2, T0, 1
    SC.D.RL T3, T2, (T1)
    BNEZ    T3, loop
    RET

TEXT atomicbench.ReadCounter(SB)
    LD      T0, 0(T1)
    FENCE   r,rw
    RET

TEXT atomicbench.PublishCounter(SB)
    FENCE   rw,w
    SD      A0, 0(T1)
    FENCE   rw,rw
    RET
```

RISC-V is the most explicit. The `FENCE` instruction takes a pair of sets: predecessors and successors. `FENCE rw,rw` is a full bidirectional barrier; `FENCE r,rw` is "no read can be reordered with later reads or writes" (an acquire fence in our terminology); `FENCE rw,w` is "no prior access can be reordered with later writes" (a release-ish fence).

The atomic instructions `LR.D.AQ` / `SC.D.RL` (load-reserved / store-conditional with acquire and release respectively) provide LL/SC semantics with embedded ordering. `AMOADD.D.AQRL` is the RISC-V Zaamo extension's single-instruction atomic add with both acquire and release.

### A.4 Putting Them Side By Side

| Operation | amd64 | arm64 (LSE) | riscv64 |
|---|---|---|---|
| atomic add | `LOCK XADDQ` | `LDADDAL` | `AMOADD.D.AQRL` |
| atomic CAS | `LOCK CMPXCHGQ` | `LDAXR`/`STLXR` loop | `LR.D.AQ`/`SC.D.RL` loop |
| atomic load | `MOVQ` | `LDAR` | `LD` + `FENCE r,rw` |
| atomic store (SC) | `XCHGQ` | `STLR` + `DMB ISH` | `FENCE rw,w` + `SD` + `FENCE rw,rw` |

Three observations:

1. **x86 is the cheapest for non-atomic loads** because all loads are acquire by default. The cost is concentrated on the store side.
2. **arm64 LSE is the cheapest for atomic RMW** because it has a single hardware instruction that does the whole thing. Older arm64 cores without LSE pay the LL/SC retry cost under contention.
3. **riscv64 is the most explicit and the easiest to reason about**, but you pay for that explicitness in instruction count.

---

## Appendix B: x86-TSO Axioms Restated With Examples

The middle file already introduced x86-TSO. Let us now state its axioms more carefully and walk through implications.

### B.1 The Axioms

Each CPU core has a per-core FIFO **store buffer**. The system runs as if executing the following procedure repeatedly:

1. **Issue Read.** A core may execute a load. The load first checks its own store buffer (newest-first); if a matching store is present, the load returns that value. Otherwise it reads from memory (cache).
2. **Issue Write.** A core may execute a store. The store goes into the tail of the local store buffer.
3. **Drain.** At any time, the oldest entry of any store buffer may move from the buffer into shared memory.
4. **MFENCE / LOCK Drain.** When a core executes a fence (`MFENCE`) or a locked instruction, its entire store buffer is drained to memory before the fence/instruction retires.

That is all of x86-TSO. From these four rules every observable reordering follows.

### B.2 What Is Forbidden

By examining the four rules, we can derive:

- **Load-Load (LL) reorder?** No. Loads from a single core execute in program order from that core's perspective. Reordering would require speculative execution to bypass the program-order constraint, and x86 forbids that for committed loads (speculative loads are squashed on misprediction).
- **Load-Store (LS) reorder?** No. A core never issues a store before a load that was earlier in program order; the load goes out first, and only then does the store enter the buffer.
- **Store-Store (SS) reorder?** No. The store buffer is FIFO. Stores leave it in the order they entered.
- **Store-Load (SL) reorder?** **YES.** The store sits in the buffer; the load can read from memory bypassing it. Other cores will see the load complete before they see the store, even though program order is store-then-load.

### B.3 The SB (Store Buffer) Litmus

```
Thread A           Thread B
x = 1              y = 1
r1 = y             r2 = x
```

Under SC: at least one of `r1`, `r2` must read `1`.

Under x86-TSO: `r1 == r2 == 0` is allowed because both stores can sit in their respective store buffers while both loads happen.

To forbid this on x86, insert an `MFENCE` (or use a `LOCK`-prefixed instruction) between the store and the load on each thread:

```
Thread A                      Thread B
x = 1                         y = 1
MFENCE                        MFENCE
r1 = y                        r2 = x
```

Now both store buffers drain before the loads, restoring SC.

This is *exactly* what Go's `atomic.StoreInt32` + `atomic.LoadInt32` does: the `XCHG` instruction acts as the implicit `MFENCE`.

### B.4 The MP (Message Passing) Litmus

```
Thread A           Thread B
x = 1              r1 = flag
flag = 1           r2 = x
```

Under SC: `r1 == 1 AND r2 == 0` is forbidden.

Under x86-TSO: also forbidden — because both writes leave the store buffer in program order (FIFO), and Thread B's two loads execute in program order. `MP` is "free" on x86 even without fences, because TSO is strong enough.

Under ARMv8 weak: `r1 == 1 AND r2 == 0` is **allowed** unless you put `DMB` between A's two stores and between B's two loads (or use `STLR`/`LDAR`).

### B.5 The IRIW (Independent Reads of Independent Writes) Litmus

```
Thread A    Thread B    Thread C            Thread D
x = 1       y = 1       r1 = x; r2 = y      r3 = y; r4 = x
```

Under SC: `r1 == 1, r2 == 0, r3 == 1, r4 == 0` is forbidden. (Two observers can't disagree on the order of two independent stores.)

Under x86-TSO: also forbidden, because x86 is **multi-copy atomic**: once a store leaves the buffer, every core sees it at the same global moment.

Under POWER: **allowed.** POWER's stores can become visible at different times to different observers. This is why POWER needs a heavier `sync` (full barrier) where ARMv8 only needs `DMB ISH`.

### B.6 Summary Table of Allowed Reorderings

| Architecture | LL | LS | SS | SL | Multi-copy atomic? |
|---|---|---|---|---|---|
| SC (theoretical)  | forbidden | forbidden | forbidden | forbidden | yes |
| x86-TSO           | forbidden | forbidden | forbidden | **allowed** | yes |
| SPARC PSO         | forbidden | forbidden | **allowed** | allowed | yes |
| SPARC RMO         | allowed | allowed | allowed | allowed | yes |
| ARMv7 / ARMv8 weak| allowed | allowed | allowed | allowed | yes (since ARMv8) |
| POWER             | allowed | allowed | allowed | allowed | **no** |
| RISC-V RVWMO      | allowed | allowed | allowed | allowed | yes |

This table is worth taping to your monitor.

---

## Appendix C: ARMv8 Acquire and Release in Detail

The middle file should give you enough fluency with arm64 to read assembly without panic. Let's go deeper.

### C.1 The LDAR Family

| Instruction | Description |
|---|---|
| `LDAR`  | Load-Acquire register (64-bit) |
| `LDARW` | Load-Acquire register (32-bit) |
| `LDARH` | Load-Acquire register (16-bit) |
| `LDARB` | Load-Acquire register (8-bit) |
| `LDAXR` | Load-Acquire Exclusive (paired with `STLXR`) |

`LDAR` guarantees that *no later memory operation* in program order from this core appears to occur before the load. This is one-way: stores *earlier* in program order can still be reordered with the `LDAR` (in particular, they can sit in the store buffer past it).

### C.2 The STLR Family

| Instruction | Description |
|---|---|
| `STLR`  | Store-Release register (64-bit) |
| `STLRW` | Store-Release register (32-bit) |
| `STLRH` | Store-Release register (16-bit) |
| `STLRB` | Store-Release register (8-bit) |
| `STLXR` | Store-Release Exclusive (paired with `LDAXR`) |

`STLR` guarantees that *no earlier memory operation* in program order from this core appears to occur after the store. This is the dual of `LDAR`.

### C.3 The Acquire/Release Sequence

The classic acquire/release pattern in ARMv8:

```
Producer (release):
    ; ... writes to data ...
    STLR    new_flag, (flag_addr)

Consumer (acquire):
    LDAR    r0, (flag_addr)
    ; ... reads from data — guaranteed to see producer's writes ...
```

The `STLR` forces all prior writes (the "data") to complete *before* the flag becomes visible. The `LDAR` forces all subsequent reads (the "data" reads in the consumer) to happen *after* the flag is read. Together they form a *release-acquire happens-before edge*.

**Crucial detail:** this pattern is *one-way*. A load *before* the `STLR` can still be reordered with it (a load could be moved past the `STLR`). For full SC you need an additional `DMB ISH` or use a different idiom.

### C.4 DMB Variants

ARMv8 has several `DMB` (Data Memory Barrier) flavours, each scoped to a different shareability domain and direction:

- `DMB SY` — system-wide full barrier (rarely used at the OS application level).
- `DMB ISH` — inner shareable, full barrier. This is the default for cross-thread synchronisation in user space.
- `DMB ISHST` — inner shareable, **store-store** only (cheaper, used for "publish" patterns).
- `DMB ISHLD` — inner shareable, **load-load + load-store** (used for "consume" patterns).
- `DMB NSH` — non-shareable (single core only, used for self-modifying code).
- `DMB OSH` — outer shareable (across NUMA / multi-socket).

In Go's runtime, the only one you typically see is `DMB ISH`. `DMB SY` shows up in OS code (Linux kernel) but rarely in user code.

### C.5 Why STLR Is Cheaper Than DMB + STR

A `DMB ISH` is a global barrier: every prior memory op must drain, every subsequent op must wait. The CPU's load/store unit must stall until the prior operations are observable.

An `STLR` is a *per-instruction* ordering constraint, applied only at the boundary of this one store. The CPU can pipeline more aggressively: it can issue younger loads speculatively, as long as it ensures their effects don't become visible before the store. The result is roughly 2–4x lower latency on modern ARM cores under realistic workloads.

This is why Go's `sync/atomic.StoreXxx` on arm64 emits `STLR + DMB ISH` (for full SC) rather than `DMB + STR + DMB`. The runtime saves one barrier and uses the cheaper store form.

---

## Appendix D: The LSE Extension and Why It Matters

ARMv8.1 introduced **Large System Extension (LSE)**, a set of atomic memory operations that avoid the LL/SC loop entirely. On a system with LSE:

- `LDADDAL`, `LDADDA`, `LDADDL`, `LDADD` — atomic add (with various ordering choices).
- `LDSETAL`, `LDCLRAL`, `LDEORAL` — atomic bit-set, bit-clear, bit-xor.
- `SWPAL` — atomic swap.
- `CASAL` — compare-and-swap.

Each "A" means "acquire ordering," each "L" means "release ordering." `LDADDAL` has both — full SC. `LDADDA` has only acquire (the L is dropped). And so on.

**Performance impact:** under contention, an LL/SC loop on ARMv8.0 can spin many times before the SC succeeds. Each spin is wasted work. LSE replaces this with a single instruction that the cache controller handles atomically — no wasted retries. On Apple M1, Graviton 2/3, Ampere Altra, the LSE versions are 2–10x faster under contention.

Go's runtime detects LSE at startup using `getauxval(AT_HWCAP)` and dispatches to LSE versions of the atomic stubs when present. You can check what your CPU has by reading `/proc/cpuinfo` on Linux:

```
flags : ... atomics ...
```

The `atomics` flag indicates LSE. Without it, Go's runtime falls back to LL/SC.

---

## Appendix E: The Go Runtime's Atomic Wrappers, Annotated

Open `$GOROOT/src/runtime/internal/atomic/atomic_arm64.s`. Here is the implementation of `Xadd64` (annotated):

```
// uint64 ·Xadd64(uint64 volatile* val, int64 delta)
// Atomically:
//     *val += delta;
//     return *val;
TEXT ·Xadd64(SB), NOSPLIT, $0-24
    MOVD    ptr+0(FP), R0
    MOVD    delta+8(FP), R1
    // Try LSE LDADDAL first; if not present, fall back to LL/SC.
    MOVBU   ·arm64HasATOMICS(SB), R3
    CBZ     R3, atomic_xadd64_loop  // no LSE? jump to loop
    LDADDAL R1, R2, (R0)
    ADD     R1, R2
    MOVD    R2, ret+16(FP)
    RET
atomic_xadd64_loop:
    LDAXR   R2, (R0)
    ADD     R1, R2, R3
    STLXR   R3, R4, (R0)
    CBNZ    R4, atomic_xadd64_loop
    MOVD    R3, ret+16(FP)
    RET
```

Walk through:

1. `arm64HasATOMICS` is set at runtime startup based on CPU detection.
2. If LSE is present, do a single `LDADDAL`: atomic load-add with acquire and release ordering.
3. Otherwise spin in an LL/SC loop using `LDAXR` (load-acquire-exclusive) and `STLXR` (store-release-exclusive).

The user calls `atomic.AddInt64(&counter, 1)`. The Go compiler emits a call to `runtime/internal/atomic.Xadd64`. The runtime stub dispatches to LSE or LL/SC. The user sees a single function call; under the hood, a CPU-detection branch decides which instruction sequence runs.

---

## Appendix F: A Performance Benchmark — CAS vs Add vs Swap

Let's measure. Save as `bench/atomic_test.go`:

```go
package atomicbench

import (
    "sync/atomic"
    "testing"
)

var counter int64

func BenchmarkAdd(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            atomic.AddInt64(&counter, 1)
        }
    })
}

func BenchmarkSwap(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        var i int64
        for pb.Next() {
            i++
            atomic.SwapInt64(&counter, i)
        }
    })
}

func BenchmarkCAS(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            for {
                old := atomic.LoadInt64(&counter)
                if atomic.CompareAndSwapInt64(&counter, old, old+1) {
                    break
                }
            }
        }
    })
}

func BenchmarkLoad(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        var v int64
        for pb.Next() {
            v = atomic.LoadInt64(&counter)
        }
        _ = v
    })
}
```

Run on a recent server (results illustrative, your numbers will vary):

```
goos: linux
goarch: amd64
cpu: AMD EPYC 7763 (64-core)
BenchmarkAdd-128       45000000     27.4 ns/op
BenchmarkSwap-128      43000000     28.1 ns/op
BenchmarkCAS-128       28000000     42.6 ns/op
BenchmarkLoad-128      ~unbounded    0.3 ns/op
```

Three observations:

1. **`Add` and `Swap` cost the same** because both compile to a single `LOCK XADDQ` / `XCHGQ`. The fact that they have different semantics doesn't affect the underlying hardware instruction's cost.
2. **`CAS` costs roughly 50% more** under contention because every retry is wasted work. With 128 goroutines racing, many CAS attempts fail.
3. **`Load` is essentially free** — a plain `MOVQ`. You can do these in your hot path without worry.

Now run the same benchmark on arm64 (Graviton 3, 64 cores):

```
BenchmarkAdd-64        38000000     24.5 ns/op
BenchmarkSwap-64       37000000     24.8 ns/op
BenchmarkCAS-64        29000000     38.2 ns/op
BenchmarkLoad-64       ~unbounded    0.5 ns/op
```

LSE makes `Add` and `Swap` essentially the same cost. Under contention LSE wins big because there is no LL/SC retry. The performance picture on modern arm64 is similar to amd64, sometimes better.

---

## Appendix G: False Sharing Microbenchmark

False sharing happens when two unrelated atomics live on the same cache line. Even though logically there is no contention, the cache coherence protocol forces the line to ping-pong between cores on every write.

```go
package fs

import (
    "sync/atomic"
    "testing"
)

type Bad struct {
    a int64
    b int64
}

type Good struct {
    a int64
    _ [56]byte // pad to 64-byte cache line
    b int64
    _ [56]byte
}

func BenchmarkFalseSharing(b *testing.B) {
    var bad Bad
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            atomic.AddInt64(&bad.a, 1)
            atomic.AddInt64(&bad.b, 1)
        }
    })
}

func BenchmarkNoFalseSharing(b *testing.B) {
    var good Good
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            atomic.AddInt64(&good.a, 1)
            atomic.AddInt64(&good.b, 1)
        }
    })
}
```

Typical results on a 32-core server:

```
BenchmarkFalseSharing-32     20000000     78.4 ns/op
BenchmarkNoFalseSharing-32   55000000     22.1 ns/op
```

Almost 4x speedup from padding. Why? With `Bad`, every core that writes `bad.b` invalidates the cache line containing `bad.a` for every other core. With `Good`, `a` and `b` live on different cache lines.

How to detect false sharing in production:

- Use `perf stat -e cache-misses,L1-dcache-load-misses ./your-program`.
- Look for high L1-dcache-load-misses on hot atomics.
- Use `perf c2c` (cache-to-cache) on Linux to see line ping-pong events.

Go 1.21+ provides `runtime/internal/cpu.CacheLineSize` but it isn't exposed publicly. In practice, hard-code 64 bytes — every architecture Go supports uses 64-byte cache lines, except some Apple Silicon variants that use 128. Add padding accordingly.

---

## Appendix H: A Complete Sequence Lock Implementation

The sequence lock (or "seqlock") is a classic synchronisation primitive for read-mostly state. Writers update a counter and the data; readers read the counter, then the data, then the counter again, and retry if the counter changed.

```go
package seqlock

import (
    "runtime"
    "sync/atomic"
)

type SeqLock struct {
    seq atomic.Uint64
}

// Write fences are required around the data update.
// The pattern: increment, update, increment.
func (s *SeqLock) Write(update func()) {
    // Pre-increment: odd value signals "write in progress."
    s.seq.Add(1)
    // Release fence is implicit in atomic.Add.

    update()

    // Post-increment: even value signals "write done."
    s.seq.Add(1)
}

// Read returns true if the read was consistent, false if the
// caller should retry.
func (s *SeqLock) Read(read func()) {
    for {
        start := s.seq.Load()
        if start&1 != 0 {
            // Write in progress; spin.
            runtime.Gosched()
            continue
        }
        read()
        end := s.seq.Load()
        if start == end {
            return
        }
        // The seq changed; readers retry.
    }
}
```

Usage:

```go
type Config struct {
    Endpoint string
    Timeout  time.Duration
}

var (
    sl  SeqLock
    cfg Config
)

func updateConfig(newCfg Config) {
    sl.Write(func() {
        cfg = newCfg
    })
}

func readConfig() (out Config) {
    sl.Read(func() {
        out = cfg
    })
    return
}
```

Why is this correct?

1. Writer pre-increments seq (becomes odd).
2. Writer updates `cfg`.
3. Writer post-increments seq (becomes even).
4. Reader loads seq (must be even, or retry).
5. Reader copies `cfg`.
6. Reader loads seq again. If it's the same, success.

The atomic increments provide the release/acquire barriers around the `cfg` update and read. The reader is guaranteed to see a consistent snapshot or detect the inconsistency and retry.

Caveats:

- The `read` function must not have side effects. It might be called multiple times.
- The data must not contain pointers that could be freed during a concurrent write (in Go this is mostly handled by GC, but in C you'd need hazard pointers).
- For very-large data, the copy cost dominates; consider `atomic.Pointer[T]` instead.

---

## Appendix I: `atomic.Pointer[T]` Deep Dive

Added in Go 1.19, `atomic.Pointer[T]` is the type-safe, generics-friendly way to atomically publish a pointer.

```go
var cfg atomic.Pointer[Config]

func updateConfig(c *Config) {
    cfg.Store(c)
}

func readConfig() *Config {
    return cfg.Load()
}
```

Under the hood on amd64:

- `Store`: `LOCK XCHG` (full barrier, releases the new pointer).
- `Load`: `MOV` (acquire on every load, free on x86).

On arm64:

- `Store`: `STLR` + `DMB ISH` (release with full SC).
- `Load`: `LDAR` (acquire).

The semantics: any reader who observes a particular pointer also observes every write the writer made *before* the `Store`. This makes `atomic.Pointer[T]` perfect for "publish a new immutable config snapshot" patterns:

```go
type Config struct {
    Endpoint string
    Timeout  time.Duration
    // ... many more fields ...
}

var current atomic.Pointer[Config]

func reloadConfig() error {
    newCfg, err := loadFromDisk()
    if err != nil {
        return err
    }
    current.Store(newCfg)
    return nil
}

func useConfig() {
    c := current.Load()
    // c is immutable; safe to read fields without further synchronisation.
    fmt.Println(c.Endpoint)
}
```

**Critical:** the readers must treat the `*Config` as **immutable**. If a reader writes to `c.Endpoint`, you have a race. Either copy-on-write or use a different primitive.

---

## Appendix J: Reading `objdump` Output Like a Pro

A short guide to reading the output of `go tool objdump`. Sample output for one function:

```
TEXT main.add(SB) /home/user/proj/main.go
  main.go:5     0x401234        488b442408              MOVQ 0x8(SP), AX
  main.go:5     0x401239        488b4c2410              MOVQ 0x10(SP), CX
  main.go:5     0x40123e        4801c8                  ADDQ CX, AX
  main.go:5     0x401241        4889442418              MOVQ AX, 0x18(SP)
  main.go:5     0x401246        c3                      RET
```

Columns: source location, address, opcode bytes, mnemonic.

To find a specific instruction, grep for the mnemonic:

```
go tool objdump -s '^main\.' your-binary | grep -E 'LOCK|XCHG|MFENCE|LDAR|STLR'
```

This shows you every atomic instruction in functions starting with `main.`. Useful for auditing.

A more aggressive form:

```
go tool objdump your-binary | awk '/^TEXT/{f=$2} /LOCK|XCHG|MFENCE/{print f, $0}'
```

This prints every function name that contains an atomic instruction.

---

## Appendix K: When MFENCE Actually Appears

The middle file already noted: Go rarely emits `MFENCE`. Why? Because `LOCK`-prefixed instructions already drain the store buffer, so a separate `MFENCE` is redundant. Go's runtime almost always pairs the fence with a memory operation.

The one place `MFENCE` does appear is in some very specific runtime paths. Search:

```
$ grep -r MFENCE $GOROOT/src/runtime/
```

You'll find a few uses in `lock_futex_amd64.s` and similar low-level files. They are needed when the runtime must establish a barrier *without* a memory operation — for example, to ensure that all prior stores are visible before the next syscall.

In user code, you never write `MFENCE` directly; the runtime does it for you.

---

## Appendix L: Compiler Intrinsics and `runtime.KeepAlive`

A subtle topic: even when you have the right atomic fence, the *compiler* can sometimes "lose" your variable if it thinks the variable is dead. `runtime.KeepAlive` exists to tell the compiler "no, this variable is still needed past this point."

```go
buf := make([]byte, 1024)
result := C.process(unsafe.Pointer(&buf[0]))
// Without KeepAlive, the GC could free buf before process returns.
runtime.KeepAlive(buf)
_ = result
```

This is not a memory barrier in the CPU sense, but it interacts with the same conversation. The Go compiler is also a reordering agent; `runtime.KeepAlive` is one of the tools that constrain it. Other tools include `//go:nosplit`, `//go:noinline`, and the explicit `sync/atomic` family.

---

## Appendix M: A Comparison of Mutexes and Atomics at the Hardware Level

When you call `sync.Mutex.Lock`, what actually happens?

1. **Fast path:** a single `atomic.CompareAndSwap` from 0 (unlocked) to 1 (locked). On x86: `LOCK CMPXCHG`. If it succeeds, you have the lock.
2. **Slow path (contention):** if the CAS fails, the goroutine parks on a runtime semaphore. The runtime sleeps the goroutine and switches to another.
3. **Wakeup:** when the holder calls `Unlock`, it does an `atomic.Store(0)` and wakes one waiter via `futex(FUTEX_WAKE)` on Linux.

So a `sync.Mutex` is *both* an atomic operation *and* a kernel-mediated wait. Under no contention, it costs about as much as one `atomic.Add`. Under contention, it costs a syscall (1000+ ns).

Compare with a hand-rolled spinlock:

```go
type spin struct { state atomic.Int32 }

func (s *spin) Lock() {
    for !s.state.CompareAndSwap(0, 1) {
        runtime.Gosched()
    }
}

func (s *spin) Unlock() {
    s.state.Store(0)
}
```

Under no contention: identical cost to `sync.Mutex`. Under contention: the spinner burns CPU doing wasted CAS attempts and Goscheds. On a 32-core machine running many contended spinlocks, you can saturate the cores doing nothing useful.

**Rule of thumb:** spin locks make sense only when you expect contention to be short (microseconds). For anything longer, prefer `sync.Mutex` so the runtime can park goroutines and free the CPU.

---

## Appendix N: A Deep Dive into `LOCK CMPXCHG`

The instruction is used everywhere; let's understand it deeply.

```
LOCK CMPXCHG dest, src
```

Semantics:

1. The CPU reads `dest`.
2. Compares it to `AX` (the accumulator).
3. If equal, writes `src` into `dest` and sets `ZF=1`.
4. If not equal, writes `dest`'s value into `AX` and sets `ZF=0`.
5. The `LOCK` prefix makes the read-compare-write sequence atomic.

In Go terms:

```go
swapped := atomic.CompareAndSwapInt64(&n, expected, new)
```

Behaviour:

- Read `n` into a CPU register.
- Compare it to `expected`.
- If equal, write `new` back, return `true`.
- If not equal, return `false`. (Some atomic packages also return the actual value; Go does not, but you can re-read.)

The CPU implementation involves acquiring the cache line in **Exclusive** or **Modified** state via the MESI protocol. If the line is in Shared state on this core, the CPU sends an "Invalidate" to all other cores holding the line and waits for acknowledgement. This is where the latency comes from — under contention, multiple cores may be sending Invalidate messages back and forth.

This is why a contended CAS is so much slower than an uncontended one: the cache-coherence traffic dominates.

---

## Appendix O: Why x86 Has Both XCHG and CMPXCHG

`XCHG mem, reg` is a swap. `CMPXCHG mem, reg` is a conditional swap (with comparison). Both are atomic on memory operands (with `LOCK` prefix implicit on `XCHG`, explicit on `CMPXCHG`).

When do you use which?

- `XCHG`: unconditional publish. "Set this to that, and tell me what was there before." Used in `atomic.SwapInt64`.
- `CMPXCHG`: conditional update. "Set this to that, but only if it's still what I expected." Used in `atomic.CompareAndSwap`.

The cost is identical (one `LOCK`-prefixed instruction). The difference is purely semantic.

---

## Appendix P: Multi-Word Atomics — Why Go Doesn't Have Them

A common question: "Can I atomically write two int64s as one operation?"

Short answer: **no**, not in Go, not in `sync/atomic`.

Longer answer:

- x86 has `LOCK CMPXCHG16B` (Intel) / `LOCK CMPXCHG16B` (AMD), which provides 128-bit CAS. Available on every modern x86-64 CPU.
- ARMv8.1 has `CASP` (compare-and-swap pair), 128-bit CAS.
- RISC-V has no standard 128-bit CAS; you'd need a software lock.

Go does not expose these instructions. The trade-off: portable simplicity. If you need to publish two related values atomically, you have several options:

1. **Pointer indirection.** Pack both values into a struct, hold an `atomic.Pointer[T]` to it. Update the pointer to a fresh struct on publish.
2. **Mutex.** Use `sync.Mutex` for the multi-word update.
3. **Sequence lock.** As in Appendix H.

The pointer-indirection pattern is by far the most common in idiomatic Go.

---

## Appendix Q: Race Detector Algorithm in One Page

The Go race detector is based on the **ThreadSanitizer (TSan)** algorithm, which uses **vector clocks** to track happens-before.

Each goroutine has a vector clock: an array of integers, one per goroutine. Whenever a synchronisation event occurs (atomic, mutex lock/unlock, channel op), the goroutine's vector clock is updated. When a memory access occurs, the race detector compares the accessor's clock to the clock of the most recent accessor of the same address.

If two accesses to the same address have *no* happens-before relationship (i.e., neither clock dominates the other), a race is reported.

Cost:
- Each instrumented load/store: 1 extra memory access (to the shadow location).
- Each sync op: vector clock update, ~10 ns.
- Memory: 8x for shadow state (each 8-byte word of program memory has 8 bytes of shadow).

Limitations:
- Only catches races that actually occur during the test run. Untouched code paths are not analysed.
- Some patterns (e.g., racing through pointer arithmetic in `unsafe`) may evade detection.
- Vector clocks scale poorly with extremely high goroutine counts (thousands of long-lived goroutines), though Go's implementation has many optimisations.

Despite limitations, it is by far the best tool we have. Run `-race` everywhere you can.

---

## Appendix R: The Compiler's Memory Model Promise

The Go compiler promises:

- A goroutine sees its own writes in program order.
- A goroutine that synchronises via `sync/atomic`, `sync.Mutex`, channel, or `sync.Once` sees writes from the synchronising peer in the order specified by the happens-before graph.
- No other guarantees about cross-goroutine ordering.

In particular, **the compiler is free to reorder** any operation that does not cross a synchronisation point. This includes:

- Load reordering within a function.
- Store reordering within a function.
- Hoisting loads out of loops.
- Eliminating "dead" stores.
- Inlining and re-ordering call sites.

Therefore: if you depend on a particular ordering of operations, you must mark the boundary with a synchronisation primitive. Even if your CPU happens to be x86-TSO and would preserve the order, the compiler might still rearrange before the CPU sees the code.

---

## Appendix S: Putting It Together — A Worked Code Review

Look at this code and identify all the bugs:

```go
type Server struct {
    started bool
    addr    string
    once    sync.Once
}

func (s *Server) Start(addr string) {
    s.once.Do(func() {
        s.addr = addr
        s.started = true
    })
}

func (s *Server) Addr() string {
    if s.started {
        return s.addr
    }
    return ""
}

func (s *Server) IsRunning() bool {
    return s.started
}
```

Bugs:

1. **`Addr()` and `IsRunning()` race on `s.started`.** Inside `Once.Do` the writes have release semantics, but only for goroutines that *also* call `s.once.Do`. A goroutine calling `Addr()` directly has no happens-before relationship with the `Once.Do` block.

2. **`s.addr` is also racy** for the same reason.

3. **Read pattern is fragile** even after the fix: `IsRunning()` returning `true` then `Addr()` returning `""` is possible if you simply atomic-ify `started`.

Fix:

```go
type Server struct {
    addr atomic.Pointer[string]
    once sync.Once
}

func (s *Server) Start(addr string) {
    s.once.Do(func() {
        s.addr.Store(&addr)
    })
}

func (s *Server) Addr() string {
    p := s.addr.Load()
    if p == nil {
        return ""
    }
    return *p
}

func (s *Server) IsRunning() bool {
    return s.addr.Load() != nil
}
```

Now:

- `Start` publishes the pointer with release semantics.
- `Addr()` and `IsRunning()` acquire-load the pointer.
- `IsRunning() == true` implies `Addr()` returns the value just stored.

The race detector would flag the original code immediately.

---

## Appendix T: Quick-Reference Conversion Table

| C++ memory_order | ARM equivalent | x86 equivalent | Go provides |
|---|---|---|---|
| `relaxed` | plain LDR/STR | plain MOV | Not directly (use unsafe or runtime/internal/atomic) |
| `consume` | LDR + DMB ISHLD (rare) | MOV | Not directly |
| `acquire` | LDAR | MOV | `atomic.LoadXxx` (implicitly stronger: SC) |
| `release` | STLR | MOV (loaded by acquire) | `atomic.StoreXxx` (implicitly stronger: SC) |
| `acq_rel` | LDADDAL | LOCK XADD | `atomic.AddXxx`, `atomic.CompareAndSwapXxx` |
| `seq_cst` | LDADDAL + ISB | LOCK XADD | `atomic.*` (default) |

Go gives you `seq_cst` everywhere. C++ gives you the full menu. There are pros and cons to each — Go's simplicity is its strength.

---

## Appendix U: Cache-Line Padding Patterns

The idiomatic ways to pad in Go:

### U.1 Explicit byte slice padding

```go
type Counter struct {
    v int64
    _ [56]byte // pad to 64
}
```

Pros: simple. Cons: hard to maintain if you change the alignment.

### U.2 Anonymous struct fields

```go
type Counter struct {
    _ [0]int64 // force alignment
    v int64
    _ [7]int64 // pad to 64 bytes total (8 * 8 = 64)
}
```

Pros: clearer intent. Cons: 8 instead of 56.

### U.3 Embedding for padding

```go
type cacheLinePad struct {
    _ [64]byte
}

type Counter struct {
    cacheLinePad
    v int64
    cacheLinePad
}
```

Pros: padded on both sides; protects against neighbours. Cons: 128 bytes per counter.

### U.4 Slice of padded counters

```go
type paddedCounter [64]byte

var counters [N]paddedCounter
```

Pros: each counter on its own line. Cons: must use `unsafe.Pointer` to access the int64 inside.

Go's runtime has `runtime/internal/cpu.CacheLinePadSize = 64` (or 128 on some platforms). Mirror this constant in your own code.

---

## Appendix V: A Note on Channel Semantics

Channels are not just convenient communication — they also provide memory ordering. The Go memory model says:

- A send on a channel **happens before** the corresponding receive completes.
- The closing of a channel **happens before** a receive that returns because the channel is closed.

In hardware terms: every send-then-recv pair is an SC synchronisation point. The runtime achieves this with a mutex (in the channel header) plus a wakeup; the cost is roughly 50–80 ns under no contention.

So a channel send followed by a channel receive is, at minimum, as strong as an atomic store followed by an atomic load. You can use channels as synchronisation primitives — they are often clearer than atomics. But they have higher overhead per operation.

Rule of thumb:
- Use channels for *communicating* (passing data + ownership).
- Use atomics for *coordinating* (small flags, counters, pointers).
- Use mutexes for *protecting* (multiple fields that change together).

---

## Appendix W: An Anti-Pattern Tour Specifically for Middle-Level Engineers

The mistakes get more sophisticated at this level. Three patterns to watch for:

### W.1 The "I'll cache the atomic load" pattern

```go
var ready atomic.Bool

func work() {
    isReady := ready.Load()
    for !isReady { // !! caching the result loses the acquire effect
        time.Sleep(time.Millisecond)
    }
    // ... use shared state, expecting it's safe ...
}
```

The bug: `isReady` is loaded once, then never re-checked. Even if the producer publishes new state, the consumer is looking at a stale local. Loop on `ready.Load()`, not a cached variable:

```go
for !ready.Load() {
    time.Sleep(time.Millisecond)
}
```

### W.2 The "I'll use atomic for read but not write" pattern

```go
var counter int64

func increment() {
    counter++ // plain write
}

func read() int64 {
    return atomic.LoadInt64(&counter) // atomic read
}
```

Half-atomic. The `LoadInt64` doesn't help if the `++` is racy. Either both atomic or neither.

### W.3 The "atomic without alignment" pattern

```go
type Pair struct {
    a int32
    b int64 // !! on 32-bit ARM, b is not 8-byte aligned
}

var p Pair
atomic.AddInt64(&p.b, 1) // crash or undefined behaviour on 32-bit
```

On 32-bit platforms, 64-bit atomic operations require 8-byte alignment of the target. The Go compiler does not enforce this automatically; the runtime checks and panics. To force alignment, put the 64-bit field first or use `atomic.Int64` (which is guaranteed aligned by the compiler).

---

## Appendix X: TLA+ for Concurrent Code (At a Glance)

For a middle engineer who wants to step into formal modelling: TLA+ is a specification language designed for distributed and concurrent systems. You can model a small protocol — say, the sequence lock from Appendix H — and use the TLC model checker to verify there are no observable races.

A minimal TLA+ spec for a seqlock looks like:

```
EXTENDS Naturals, TLC
VARIABLE seq, data, snapshot

Init == seq = 0 /\ data = 0 /\ snapshot = 0

Write == /\ seq' = seq + 2
         /\ data' = data + 1
         /\ UNCHANGED snapshot

Read  == /\ seq % 2 = 0
         /\ snapshot' = data
         /\ UNCHANGED <<seq, data>>

Next == Write \/ Read

Spec == Init /\ [][Next]_<<seq, data, snapshot>>
```

The TLC model checker will explore all interleavings up to some bound and report any state where the snapshot is inconsistent with the data writes. For middle-level reasoning, you usually don't need TLA+, but it's worth knowing it exists for the day you find a bug you can't reason about by inspection.

---

## Appendix Y: A Concrete Production Story — The "Phantom Stale Cache" Bug

A real story (anonymised). Setting: a Go service that caches a slice of `*User` records in memory, refreshed every 60 seconds from a database.

Original code:

```go
type Cache struct {
    users []*User
}

var c Cache

func reload() {
    fresh := loadFromDB()
    c.users = fresh
}

func getUser(id string) *User {
    for _, u := range c.users {
        if u.ID == id {
            return u
        }
    }
    return nil
}
```

Symptom: occasionally `getUser` would panic with a `nil pointer dereference` on `u.ID`. The panic was on arm64 only.

Root cause: `c.users = fresh` is a slice header assignment — three words (pointer, length, capacity). On `amd64` (TSO), the three writes were observed by other goroutines in program order. On `arm64` (weak), another goroutine could see the new pointer with the old length, or vice versa.

If the new pointer was paired with the old length (which was larger), the iteration would walk past the end of the new slice, hit garbage memory, and try to access `u.ID` of a junk address.

Fix:

```go
type Cache struct {
    users atomic.Pointer[[]*User]
}

var c Cache

func reload() {
    fresh := loadFromDB()
    c.users.Store(&fresh)
}

func getUser(id string) *User {
    p := c.users.Load()
    if p == nil {
        return nil
    }
    for _, u := range *p {
        if u.ID == id {
            return u
        }
    }
    return nil
}
```

Now `c.users` is a single pointer, atomically published. The slice header is part of the value pointed to, and its three words are read consistently as a unit.

Lesson: **never assume a multi-word value can be assigned atomically**. Even on x86, the only thing that's atomic is a single aligned machine word. Use `atomic.Pointer[T]` or a mutex for anything else.

---

## Appendix Z: Closing Mental Model for the Middle Level

If the junior file's mental model was "barriers are fences in a pipeline of memory ops," the middle file's mental model is:

> **The memory system is a distributed log. Each core has a private append-only buffer. Cache coherence is the protocol that replicates the log entries between cores. Barriers force a flush-and-sync of the local log to the global view, at varying granularities depending on the architecture.**

If you carry that model forward, the senior file's discussion of POWER's multi-copy-non-atomicity, RISC-V's per-fence predecessor/successor sets, and the Linux kernel's `smp_mb` family will be much easier to absorb. The atomic primitives Go exposes are the most polished surface of this distributed log: simple, portable, but with real cost.

End of middle-level expansion.

---

## Appendix AA: Eight Production-Realistic Worked Exercises

### Exercise 1: Boundary Counter

You need to count requests per second, exposed to a `/metrics` endpoint. Latency budget: requests must not slow down because of the counter.

Solution: `atomic.Int64`, increment in the handler, snapshot from the metrics endpoint. Cost per increment: 10–25 ns. No contention because all writers do the same `LOCK XADD`, which is essentially free under 1k req/s.

### Exercise 2: Generation Number

You need to invalidate all caches when configuration changes. Each cache stores its "generation" and re-reads if the global generation is newer.

Solution: `atomic.Uint64` as the global generation. Each cache stores the generation it built against. Compare-and-skip pattern. Cost: one `atomic.Load` per cache lookup.

### Exercise 3: Shutdown Coordination

You need 100 worker goroutines to finish processing their current item and exit when a shutdown is requested.

Solution: `atomic.Bool` for the shutdown flag, checked at the top of each iteration. Or, more idiomatically, a `context.Context` with cancellation — which internally uses `atomic.Pointer` plus a closed channel.

### Exercise 4: Single Flight

You want at most one goroutine at a time to perform an expensive lookup, with others waiting for the result.

Solution: `sync.Singleflight`, which uses a mutex internally. Cost: 25–50 ns when no waiter is present.

### Exercise 5: Hot Read Path with Rare Write

You have a small object that 99.99% of requests read and a background goroutine writes once per minute.

Solution: `atomic.Pointer[T]`. Writers publish a new pointer; readers do a single `atomic.Load`. No locking on the hot path.

### Exercise 6: Bounded Producer-Consumer

You need a fixed-size buffer between a producer and a consumer.

Solution: a buffered channel of the right capacity. Cost: 50–80 ns per send/recv pair. For lower-latency requirements, a hand-rolled ring buffer with `atomic.Uint64` head/tail indices, but the complexity is rarely worth it.

### Exercise 7: Read-Mostly Configuration

You have a `Config` struct with dozens of fields, read on every request, updated rarely.

Solution: `atomic.Pointer[Config]`. Copy-on-write. Readers do one `atomic.Load`. Writers build a new `*Config`, then `Store`.

### Exercise 8: Per-Goroutine Sharded Counters

You need a counter that scales to millions of writes per second across hundreds of goroutines.

Solution: shard the counter across `runtime.NumCPU()` slots, each padded to a cache line. Reads sum all slots; writes pick a slot based on `runtime.proc()` (not user-callable, but you can approximate with a goroutine-local pseudo-id).

These eight exercises cover 90% of the synchronisation patterns you'll need in production. Each maps to a small set of CPU instructions; the middle engineer is expected to know which.

---

## Appendix AB: Performance Anti-Pattern — Atomic Spinning Without Backoff

A common middle-level mistake:

```go
for !ready.Load() {
    // tight spin
}
```

On a multi-core machine with the writer on a different core, this spins thousands or millions of times. Each iteration:

- Reads the cache line (which is in Shared state).
- Decides not to proceed.
- Loops.

When the writer finally publishes, the cache line transitions to Modified on the writer's core, sending Invalidate messages to all spinners. The spinners' next read forces a cache miss, costing ~100 cycles.

**Better:** add a `runtime.Gosched()` or, for short waits, a `runtime.procyield(30)`:

```go
for !ready.Load() {
    runtime.Gosched() // yield to runtime
}
```

`runtime.Gosched` lets other goroutines run on the same OS thread. For *very* short waits, `PAUSE` (x86) or `YIELD` (arm64) instructions exist but Go does not expose them directly — `runtime.Gosched` is the polite spin.

**Best:** use a `sync.Cond` or a channel for waits longer than microseconds. The cost of a syscall is paid once, and the goroutine consumes no CPU while parked.

---

## Appendix AC: A Word on Wait-Free vs Lock-Free vs Lockless

Three terms, three different guarantees:

- **Lockless:** does not use a mutex. Does not say anything about progress under contention.
- **Lock-free:** at least one thread makes progress in a bounded number of steps, even under contention.
- **Wait-free:** every thread makes progress in a bounded number of steps, even under contention.

A naive CAS retry loop is lockless but not lock-free (one thread might spin forever if others keep winning). A Vyukov MPMC queue is lock-free. A true wait-free queue is much harder and rarely worth the complexity.

Go does not provide wait-free data structures in the standard library. `sync.Mutex` is *fair* in some sense but not wait-free. For most code, *lock-free with bounded retry* is the right target.

---

## Appendix AD: Closing Self-Test for the Middle Level

If you can answer these without checking, you've absorbed the middle file:

1. Recite the four x86-TSO axioms.
2. What instruction does `atomic.AddInt64(&n, 1)` compile to on amd64? arm64 with LSE? riscv64?
3. How does the seqlock pattern detect a writer's mid-update state?
4. Why does false sharing slow down `atomic.AddInt64` on a small struct?
5. What does `MFENCE` do that `LOCK XADD` does not? (Trick: nothing — `LOCK` is already a full barrier.)
6. Why does ARMv8 LSE make uncontended atomics about the same speed as on x86, but contended atomics dramatically faster than ARMv8.0?
7. Under what conditions does Go's `sync.Mutex.Lock` make a syscall? When does it not?
8. Why is `atomic.Pointer[T]` strictly better than `unsafe.Pointer` + `atomic.LoadPointer`?
9. What is multi-copy atomicity, and why does POWER lack it while ARMv8.0+ has it?
10. How does the race detector decide whether to emit a warning?

If you got 7+ of 10, you are ready for the senior file. If you got fewer, re-read the relevant appendices.

---

End of middle-level expansion. The senior file goes deeper into RISC-V WMO, POWER, and the full memory-model spectrum.

---

## Appendix AE: Disassembly of `sync.Mutex.Lock` — Annotated

Go's `sync.Mutex` is built on top of `runtime/internal/atomic` and `runtime.semacquire`. Let's walk through the fast path.

The Go source (`sync/mutex.go`, simplified):

```go
func (m *Mutex) Lock() {
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        return
    }
    m.lockSlow()
}
```

On amd64, this compiles to roughly:

```
TEXT sync.(*Mutex).Lock(SB)
    MOVQ    receiver+0(FP), BX
    XORL    AX, AX
    MOVL    $mutexLocked, CX
    LOCK
    CMPXCHGL CX, (BX)
    JE      done
    CALL    sync.(*Mutex).lockSlow(SB)
done:
    RET
```

Walk through:

1. `BX` holds the pointer to the mutex.
2. `AX = 0` (the expected old state, "unlocked").
3. `CX = 1` (the new state, "locked").
4. `LOCK CMPXCHGL CX, (BX)` — atomically: if `*BX == AX`, set `*BX = CX` and `ZF=1`; else `AX = *BX` and `ZF=0`.
5. If `ZF=1` (success), jump to `done`. Otherwise call the slow path.

Cost of the fast path: one `LOCK CMPXCHG`, ~15 ns on modern x86. The fast path is the only path that runs under no contention — which is the common case in real systems.

The slow path involves spinning briefly (in case the holder is about to release), then parking the goroutine via `runtime.semacquire`, which eventually calls into the kernel with `futex(FUTEX_WAIT)` on Linux.

---

## Appendix AF: The Linux Kernel's Barrier Macros and Their Go Counterparts

The Linux kernel uses a rich vocabulary of barrier macros, defined per-architecture. Knowing them helps when you read systems code or compare Go's runtime to the kernel's.

| Linux Macro | Meaning | x86 emit | arm64 emit | Go equivalent |
|---|---|---|---|---|
| `smp_mb()` | Full SMP barrier | `MFENCE` (or `LOCK ADD`) | `DMB ISH` | `atomic.*` full SC ops |
| `smp_rmb()` | Read-read barrier | (no-op on TSO) | `DMB ISHLD` | `atomic.LoadXxx` series |
| `smp_wmb()` | Write-write barrier | (no-op on TSO) | `DMB ISHST` | `atomic.StoreXxx` series |
| `smp_load_acquire()` | Acquire load | plain MOV | `LDAR` | `atomic.LoadXxx` |
| `smp_store_release()` | Release store | plain MOV | `STLR` | `atomic.StoreXxx` |
| `READ_ONCE()` | Volatile read (no fence) | plain MOV | plain LDR | (use `atomic.LoadXxx` for portability) |
| `WRITE_ONCE()` | Volatile write (no fence) | plain MOV | plain STR | (use `atomic.StoreXxx`) |

Note that on x86-TSO, `smp_rmb` and `smp_wmb` are no-ops — TSO already provides those orderings for free. The kernel macros optimise per-architecture; Go's `sync/atomic` always emits the full SC version, even when a weaker one would suffice.

The Linux kernel's `Documentation/memory-barriers.txt` is the gold standard reference for these macros and worth reading once in your life.

---

## Appendix AG: Comparing Java `volatile`, C++ `atomic<>`, and Go `sync/atomic`

Three different ecosystems, three different surface APIs, similar underlying machinery.

### Java `volatile`

```java
private volatile boolean ready;

void writer() {
    ready = true;   // SC store (release on weak, MOV on x86)
}

void reader() {
    if (ready) {    // SC load (acquire)
        // ...
    }
}
```

Java's `volatile` is full SC. Same model as Go's `sync/atomic`. No way to specify weaker ordering.

For atomic increment, Java uses `AtomicInteger.incrementAndGet()` or `VarHandle` since Java 9.

### C++ `<atomic>`

```cpp
std::atomic<bool> ready{false};

void writer() {
    ready.store(true, std::memory_order_release);
}

void reader() {
    if (ready.load(std::memory_order_acquire)) {
        // ...
    }
}
```

C++ lets you specify the exact ordering. Default is `seq_cst` (matches Go). `acquire`/`release` allow you to skip the StoreLoad fence for performance.

### Go `sync/atomic`

```go
var ready atomic.Bool

func writer() {
    ready.Store(true) // always SC
}

func reader() {
    if ready.Load() { // always SC
        // ...
    }
}
```

Go locks in `seq_cst`. Simpler API, slightly less expressive, harder to misuse.

The three are interoperable in concept: an SC Go atomic store is observationally equivalent to a Java `volatile` write or a C++ `atomic.store(seq_cst)`. The portability of high-level concurrent patterns is one reason Go made the choice it did.

---

## Appendix AH: Stress Testing Your Atomic Code

A short recipe:

```go
//go:build !race
package atomicstress

import (
    "runtime"
    "sync"
    "sync/atomic"
    "testing"
)

func TestAtomicCounterUnderLoad(t *testing.T) {
    var counter atomic.Int64
    var wg sync.WaitGroup
    n := runtime.NumCPU() * 4
    iters := 100_000

    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < iters; j++ {
                counter.Add(1)
            }
        }()
    }
    wg.Wait()

    expected := int64(n * iters)
    if got := counter.Load(); got != expected {
        t.Fatalf("expected %d, got %d", expected, got)
    }
}
```

Run with `go test -count 100 -timeout 60s`. If any iteration fails the equality check, you have a lost update — which means your atomic isn't atomic. (This particular test should never fail; it's a sanity check.)

For more interesting stress, use `go test -race` and inject random `runtime.Gosched()` between operations to perturb the scheduler.

For truly serious stress, use `go-fuzz` or `gotip`'s native fuzzing on concurrent code.

---

## Appendix AI: A Note on `atomic.Value`

`sync/atomic.Value` is the older sibling of `atomic.Pointer[T]`. Use cases overlap, but `atomic.Value` has a subtle restriction: the concrete type must be the same on every `Store`. The first store sets the type; subsequent stores must use the same concrete type or `Store` panics.

```go
var v atomic.Value
v.Store(42)
v.Store("hello") // panics! different type
```

`atomic.Pointer[T]` doesn't have this restriction because the type is fixed at compile time. Prefer `atomic.Pointer[T]` in new code (Go 1.19+). `atomic.Value` is still around for backwards compatibility and for situations where you can't express the type at compile time.

---

## Appendix AJ: Bonus — Implementing a Token Bucket With Atomics

```go
package ratelimit

import (
    "sync/atomic"
    "time"
)

type Bucket struct {
    tokens   atomic.Int64
    lastFill atomic.Int64 // unix nanos
    rate     int64        // tokens per second
    cap      int64
}

func NewBucket(rate, cap int64) *Bucket {
    b := &Bucket{rate: rate, cap: cap}
    b.tokens.Store(cap)
    b.lastFill.Store(time.Now().UnixNano())
    return b
}

func (b *Bucket) refill() {
    now := time.Now().UnixNano()
    last := b.lastFill.Load()
    elapsed := now - last
    if elapsed <= 0 {
        return
    }
    add := elapsed * b.rate / int64(time.Second)
    if add == 0 {
        return
    }
    if b.lastFill.CompareAndSwap(last, now) {
        // We won the race to refill.
        for {
            cur := b.tokens.Load()
            newVal := cur + add
            if newVal > b.cap {
                newVal = b.cap
            }
            if b.tokens.CompareAndSwap(cur, newVal) {
                return
            }
        }
    }
}

func (b *Bucket) Take() bool {
    b.refill()
    for {
        cur := b.tokens.Load()
        if cur <= 0 {
            return false
        }
        if b.tokens.CompareAndSwap(cur, cur-1) {
            return true
        }
    }
}
```

Walk-through:

- `tokens` is an atomic counter of available tokens.
- `lastFill` records when we last refilled; updates are guarded by a CAS to ensure only one goroutine refills per epoch.
- `Take` uses a CAS loop to atomically decrement only if there are tokens.

This is a real lock-free token bucket suitable for high-throughput rate limiting. The CAS loops are bounded under low contention (1–2 retries) and degrade gracefully under high contention.

A simpler approach using a mutex would also work and might be easier to read; choose based on contention level.

---

## Appendix AK: A Pop Quiz Drawn From Real Interviews

These five questions have all been asked in real Go-systems interviews. Try to answer each in 30 seconds.

**Q1.** What's the difference between `atomic.LoadInt32` and reading a `volatile int` in Java?

**A1.** Functionally identical: both are SC loads with acquire semantics. The implementation differs (Go uses `MOV` on x86, `LDAR` on arm64; Java uses similar) but the observable semantics match.

**Q2.** Why doesn't `runtime.Gosched()` flush the store buffer?

**A2.** Because `Gosched` is a scheduler hint, not a memory operation. It yields the current goroutine but doesn't emit any fence instruction. The runtime's scheduler internals do their own synchronisation when picking up the next goroutine, but the *current* goroutine's pending stores aren't drained by the act of yielding.

**Q3.** If you have two goroutines both calling `mu.Lock()` and only one wins, what happens to the loser?

**A3.** The fast-path CAS fails. The runtime then puts the goroutine on the mutex's wait list (a runtime semaphore) and parks it via `runtime.gopark`. On Linux this typically results in a `futex(FUTEX_WAIT)` syscall.

**Q4.** Why is `atomic.AddInt64(&n, 0)` not equivalent to `atomic.LoadInt64(&n)`?

**A4.** Both return the value of `n`, but `Add(0)` is a full RMW — `LOCK XADD` on x86 — which costs ~10–25 ns. `Load` is a plain `MOV`, which costs ~1 ns. They have the same semantics but very different cost.

**Q5.** When would you use a sequence lock instead of a mutex?

**A5.** When you have many readers, few writers, and the read operation is short enough that retrying on inconsistency is cheap. Mutex readers always block writers; seqlock readers don't block writers at all. The trade-off is that seqlock readers may need to retry.

---

## Appendix AL: One Last Visual

```
         atomic.AddInt64 (Go user code)
                  │
                  ▼
        runtime/internal/atomic.Xadd64
         (per-arch assembly stub)
                  │
        ┌─────────┼─────────────┬───────────────┐
        ▼         ▼             ▼               ▼
      x86       arm64 (LSE)   arm64 (no LSE)  riscv64
    LOCK XADD   LDADDAL       LDAXR/STLXR     AMOADD.D.AQRL
                              loop
        │         │             │               │
        └─────────┴─────────────┴───────────────┘
                  │
                  ▼
            Cache coherence
            (MESI/MOESI)
                  │
                  ▼
          Visible to other cores
```

This is the journey: Go user call → runtime wrapper → architecture-specific instruction → cache coherence → cross-core visibility. Every box matters; missing any single one leads to bugs.

---

End of middle file. Onward to senior.

---

## Appendix AM: Quick-Reference Sheet (Print and Tape to Monitor)

```
================================================================
                  GO ATOMIC <-> ASSEMBLY MAP
================================================================

  Operation               amd64           arm64 (LSE)     riscv64
  ----------------------  --------------  --------------  -------
  atomic.LoadInt64        MOVQ            LDAR            LD + FENCE r,rw
  atomic.StoreInt64       XCHGQ           STLR + DMB ISH  FENCE rw,w + SD + FENCE rw,rw
  atomic.AddInt64         LOCK XADDQ      LDADDAL         AMOADD.D.AQRL
  atomic.SwapInt64        XCHGQ           SWPAL           AMOSWAP.D.AQRL
  atomic.CASInt64         LOCK CMPXCHGQ   CASAL           LR.D.AQ / SC.D.RL
  atomic.AndInt64         LOCK ANDQ       LDCLRAL (inv)   AMOAND.D.AQRL
  atomic.OrInt64          LOCK ORQ        LDSETAL         AMOOR.D.AQRL

  fence types          (x86 instruction)
  --------------  ------------------------------------
  LoadLoad        (free under TSO)
  LoadStore       (free under TSO)
  StoreStore      (free under TSO)
  StoreLoad       MFENCE  or  LOCK-prefixed RMW

  Linux/POSIX             Go equivalent
  ----------------------  --------------------------------
  __sync_synchronize()    (n/a — use atomic.* SC)
  smp_mb()                (n/a — use atomic.* SC)
  smp_rmb()               (subsumed by atomic.Load*)
  smp_wmb()               (subsumed by atomic.Store*)
  smp_load_acquire(x)     atomic.LoadXxx(&x)
  smp_store_release(x,v)  atomic.StoreXxx(&x, v)

  ARMv8 mnemonic         Meaning
  --------------------   ----------------------------------
  LDR/STR                plain load/store
  LDAR/STLR              load-acquire / store-release
  LDAXR/STLXR            load-exclusive-acquire / store-exclusive-release
  LDADD                  atomic add, no ordering
  LDADDA                 atomic add, acquire
  LDADDL                 atomic add, release
  LDADDAL                atomic add, acquire+release (SC)
  DMB ISH                full SMP barrier
  DMB ISHST              store-store SMP barrier
  DMB ISHLD              load-load + load-store SMP barrier
  ISB                    flush instruction pipeline (rarely needed)
================================================================
```

If you can read all of the rows above without consulting a manual, you are firmly at the middle level.

---

## Appendix AN: Two Quick Code-Review Catches

Real review feedback patterns to internalise.

### Catch 1

```go
type Counter struct {
    sync.Mutex
    n int64
}

func (c *Counter) Inc() {
    c.Lock()
    defer c.Unlock()
    c.n++
}

func (c *Counter) Read() int64 {
    return c.n // !! lock not held
}
```

`Read` reads `c.n` without holding the lock. Even though writes are mutex-protected, the unsynchronised read makes this a data race. Either lock in `Read` or change `n` to `atomic.Int64`.

### Catch 2

```go
type Snapshot struct {
    timestamp time.Time
    data      []byte
}

var snap atomic.Pointer[Snapshot]

func update(d []byte) {
    s := snap.Load()
    s.timestamp = time.Now() // !! mutating loaded snapshot
    s.data = d
}
```

The reviewer should immediately notice that `update` is mutating the pointed-to struct in place, which races with every other reader. The whole point of `atomic.Pointer` is *copy on write*: build a new `*Snapshot`, then `Store` it. Never mutate the loaded value.

---

End for real.


