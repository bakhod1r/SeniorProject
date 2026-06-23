# Memory Fences — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Hardware Instructions Reference](#hardware-instructions-reference)
3. [x86 TSO Formalised: Sewell et al.](#x86-tso-formalised-sewell-et-al)
4. [The Store Buffer, In Detail](#the-store-buffer-in-detail)
5. [Out-of-Order Execution and the Reorder Buffer](#out-of-order-execution-and-the-reorder-buffer)
6. [ARM Weak Ordering — DMB, DSB, ISB, LDAR, STLR](#arm-weak-ordering--dmb-dsb-isb-ldar-stlr)
7. [POWER and `lwsync` / `sync`](#power-and-lwsync--sync)
8. [How Go Compiles Each Atomic on Each Architecture](#how-go-compiles-each-atomic-on-each-architecture)
9. [Microbenchmarking Fence Cost](#microbenchmarking-fence-cost)
10. [Inspecting the Compiler Output](#inspecting-the-compiler-output)
11. [Race Detector and Vector Clocks Revisited](#race-detector-and-vector-clocks-revisited)
12. [Summary](#summary)

---

## Introduction

The professional level is where you stop talking about fences as an abstraction and stare at the actual instructions. You know which line in `runtime/internal/atomic/asm_amd64.s` emits `MFENCE`, what `LDAR` does inside an ARM core, and why `lwsync` is cheaper than `sync` on POWER. You can hand-write a microbenchmark that shows the store-buffer reordering on x86 when fences are absent, and you can read the disassembly of a Go binary to confirm the compiler emitted what you expected.

References are to Go 1.22 source; line numbers approximate. We assume mastery of `senior.md`.

---

## Hardware Instructions Reference

### x86 / x86-64 fences

| Instruction | Class | Effect |
|---|---|---|
| `MFENCE` | Full fence | Serialises all loads and stores. Drains store buffer; subsequent loads cannot pass; prior stores must be globally visible before subsequent stores. |
| `LFENCE` | Load fence | Serialises loads. Used with non-temporal loads (`MOVNTDQA`) and to prevent speculative loads. Also a speculation barrier post-Spectre. |
| `SFENCE` | Store fence | Serialises stores. Used with non-temporal stores (`MOVNTI`, `MOVNTDQ`); rarely needed in normal code because TSO already orders store→store. |
| `LOCK` prefix | Full fence + atomicity | A prefix on `ADD`, `SUB`, `INC`, `DEC`, `AND`, `OR`, `XOR`, `XCHG`, `CMPXCHG`, etc. Makes the instruction atomic across all CPUs and acts as a full memory barrier. |
| `XCHG` | Full fence | Implicitly LOCK-prefixed even without the prefix. Used in `atomic.StoreInt64` because it acts as a fence and a swap in one instruction. |
| `CPUID` | Serialising | Drains everything. Used in microbenchmarks to ensure measurement does not race with instruction issue. |

The `LOCK` prefix is the workhorse — Go's atomic store is `XCHG` (already locked); Go's atomic add is `LOCK XADD`; Go's CAS is `LOCK CMPXCHG`. `MFENCE` is rarely emitted by Go's compiler because the LOCK-prefixed alternatives are usually shorter and not noticeably more expensive.

### ARM64 fences

| Instruction | Class | Effect |
|---|---|---|
| `DMB SY` | Full data memory barrier, system | All loads and stores before are visible before any after, across the whole system. |
| `DMB ISH` | Inner shareable | Same as SY but only within the inner shareable domain — usually the cores of one CPU package. Cheaper. |
| `DMB ISHST` | Inner shareable, store | Orders prior stores before later stores. |
| `DMB ISHLD` | Inner shareable, load | Orders prior loads before later loads. |
| `DSB SY` | Data synchronisation barrier | Stronger: waits for all prior loads, stores, and side-effects to complete. Used for device I/O ordering. |
| `ISB` | Instruction synchronisation barrier | Flushes the pipeline. Used after changing system registers, page tables, etc. |
| `LDAR` | Load-acquire | A load that itself carries acquire semantics. Cheaper than `LDR + DMB`. |
| `STLR` | Store-release | A store that itself carries release semantics. Cheaper than `DMB + STR`. |
| `LDAXR` / `STLXR` | Load-acquire exclusive / store-release exclusive | Used in LL/SC loops for CAS. |
| `CASAL` (ARMv8.1) | Atomic CAS, acquire-release | Single-instruction CAS. Replaces LL/SC on newer cores. |
| `LDADD` (ARMv8.1) | Atomic add | Single-instruction fetch-and-add. Replaces LL/SC for add. |

Go's runtime uses `LDAR`/`STLR` for atomic load/store on ARM64; uses `LDAXR`/`STLXR` for older cores; uses `CASAL`/`LDADD`/`SWPAL` on cores that have ARMv8.1 atomics when `GOARM64` indicates support.

### POWER fences

| Instruction | Class | Effect |
|---|---|---|
| `sync` | Heavyweight sync | Full memory barrier. Roughly comparable to `MFENCE` or `DMB SY`. |
| `lwsync` | Lightweight sync | Orders load-load, load-store, store-store; does NOT order store-load. Used for release/acquire pairs. |
| `isync` | Instruction sync | Flushes the pipeline; used in acquire-side contexts. |
| `eieio` | Enforce in-order execution of I/O | Used for memory-mapped device I/O. |
| `lwarx` / `stwcx.` | Load-linked / store-conditional (32-bit) | LL/SC pair for CAS. |
| `ldarx` / `stdcx.` | LL/SC for 64-bit | Same for 64-bit operands. |

POWER is one of the weakest commercial memory models. `lwsync` is the workhorse for acquire/release pairs because it skips the (expensive) store-load ordering that real seq_cst would need. Go's `runtime/internal/atomic/asm_ppc64x.s` uses `sync` and `lwsync` depending on whether seq_cst or release/acquire is needed.

---

## x86 TSO Formalised: Sewell et al.

The most widely cited formalisation of x86's memory model is Sewell, Sarkar, Owens, Nardelli, and Myreen's 2010 paper:

> Peter Sewell, Susmit Sarkar, Scott Owens, Francesco Zappa Nardelli, and Magnus O. Myreen. "x86-TSO: A Rigorous and Usable Programmer's Model for x86 Multiprocessors." Communications of the ACM, July 2010.

The paper's model has two main components, intentionally simple enough to fit on a page:

1. **Each CPU has a FIFO store buffer.** Stores from that CPU first enter the buffer; they drain to memory in order.
2. **A lock acquires exclusive memory access.** While a CPU holds the lock, no other CPU may load or store. A `LOCK`-prefixed instruction or `MFENCE` drains the local store buffer and serialises with respect to the lock.

The full formalisation is a small-step operational semantics with a handful of rules. Sewell et al. proved that this model corresponds (up to a small list of caveats) to the behaviour Intel and AMD documented in their architecture manuals, and they validated it against a large suite of "litmus tests" — short multi-thread programs with a known correct outcome set.

Key litmus tests that the model explains:

- **SB (Store Buffering):** the store-then-load reorder we examined in `middle.md`. Without fences, both readers can see `0`. With `MFENCE` between the store and the load, neither can.
- **MP (Message Passing):** writer stores data then a flag; reader spins on the flag, then reads data. TSO guarantees correct behaviour without any explicit fence beyond aligned loads/stores — but only on TSO. On ARM the same code is wrong without fences.
- **IRIW (Independent Reads of Independent Writes):** four threads, two writers, two readers; tests whether readers agree on the order of independent writes. TSO does *not* allow IRIW reorderings (because all stores from one CPU are observed in order), but ARM weak does.

Sewell et al.'s paper remains the canonical reference. If you want to argue formally about x86 behaviour, cite it.

---

## The Store Buffer, In Detail

The store buffer is the single architectural feature that turns x86 from sequential consistency into TSO. Knowing what it does explains every TSO quirk.

### Structure

A store buffer is a small (16–60 entry) per-core FIFO. Each entry holds:

- The store's address.
- The store's data.
- Metadata (size, ordering attributes, possibly the cache state being prefetched).

When a store is issued by the core, it goes into the buffer rather than going directly to the L1 cache. The store waits until it can claim exclusive ownership of the line (cache state M). At that point it drains to L1.

### Why it exists

Without a store buffer, every store would have to wait for cache ownership before retiring. Many stores hit the cache in S or I state and would stall for tens or hundreds of cycles. With the buffer, the store retires immediately from the pipeline's point of view; subsequent instructions proceed; the buffer drains in the background.

### How it causes reordering

A store-then-load sequence on the same CPU works as follows without a fence:

1. Store `A = 1` issued; goes into store buffer; `A` cache line not yet owned.
2. Load `B` issued; cache line for `B` is in S or E state; load completes immediately.
3. From other CPUs' point of view, the load of `B` happened before the store of `A` became visible — the store is still in the buffer.

This is the SB litmus test reorder. To prevent it, `MFENCE` or any `LOCK`-prefixed instruction between the store and the load drains the buffer first.

### Store-to-load forwarding

If the load is from the same address as a buffered store, the CPU forwards the buffered value directly to the load — no need to wait for the store to drain or for the cache to respond. This forwarding is invisible architecturally; from the program's view, the load sees the store. The TSO model captures this rule with a special case.

### Implications for Go

Every `sync/atomic` store on x86 is either `XCHG` (implicitly locked) or `MOV + MFENCE`. Either way, the store buffer is drained. This is why Go's atomic store costs more than a plain `MOV` — the drain.

---

## Out-of-Order Execution and the Reorder Buffer

Modern x86 and ARM cores are dynamically scheduled. The pipeline fetches, decodes, and issues instructions; the actual execution happens out of order based on data availability; results are then retired (made architecturally visible) in program order from a structure called the reorder buffer (ROB).

### The pipeline

A simplified view:

```
Fetch → Decode → Rename → Issue → Execute → Writeback → Retire (in order)
                                       ↑           ↓
                                       └── ROB ────┘
```

Up to dozens of instructions can be in flight simultaneously. Loads and stores from different addresses may execute in any order subject to data dependencies; the ROB ensures that *architectural* state changes happen in program order.

### How fences interact with OOO

A memory fence is a serialising point. The ROB cannot retire any operation past the fence until all prior memory operations have committed. This stalls the pipeline briefly. On modern cores the stall is amortised — the front-end keeps fetching even though retire is blocked — so the cost is typically less than 10 cycles for an uncontended fence.

### Speculation and the Spectre family

Out-of-order execution allows speculative loads — a load may be issued and executed before its branch is resolved. If the branch was mispredicted, the load is squashed before retire, so architecturally it never happened. But the cache traces remain. The Spectre family of attacks exploits this.

`LFENCE` on x86 serves a dual purpose: it is a load fence, but it is also a speculation barrier. A speculative instruction stream is squashed when `LFENCE` is encountered. Compilers may insert `LFENCE` to mitigate certain Spectre variants. Go's compiler does not emit `LFENCE` in regular code; the runtime's atomic operations rely on `LOCK`-prefixed instructions for ordering.

---

## ARM Weak Ordering — DMB, DSB, ISB, LDAR, STLR

ARM's memory model is documented in the ARM Architecture Reference Manual, the chapter "Memory Order." We summarise the rules and the instructions Go emits.

### Default rules

Any load may be reordered with any other load or store, except:

- A load whose result feeds a later operation must wait for the load to complete (data dependency).
- A load and store to the same address must not be reordered with respect to each other.
- Stores to the same address from one CPU are observed in order by other CPUs.

Everything else is fair game without a barrier.

### The barrier hierarchy

```
ISB  ─ flush pipeline (most aggressive)
 │
DSB  ─ wait for all prior operations to complete
 │
DMB  ─ order memory operations (no waiting for completion)
```

`ISB` is used only when you change something that affects instruction fetch — page tables, system registers. Day-to-day concurrent Go code never needs `ISB`.

`DSB` is used for device I/O and for some kernel operations. Go's user-mode code does not emit `DSB`.

`DMB` is the workhorse. Most flavours:

- `DMB SY` — across the entire system.
- `DMB ISH` — within the inner shareable domain (usually one socket). Cheaper.
- `DMB ISHST` — store-store only.
- `DMB ISHLD` — load-load only.

### LDAR / STLR — fences attached to data ops

ARMv8 introduced load-acquire (`LDAR`) and store-release (`STLR`). These are loads and stores that carry one-sided ordering:

- `LDAR` is a load that subsequent operations cannot float above. It is acquire.
- `STLR` is a store that prior operations cannot sink below. It is release.

Together, `STLR` on the writer plus `LDAR` on the reader gives release/acquire ordering — strictly cheaper than `DMB ISH` because the fence is part of the data op, not an extra instruction.

Go uses `LDAR` and `STLR` for atomic load and store on ARM64.

### Achieving seq_cst on ARM

`LDAR` and `STLR` alone provide release/acquire, not seq_cst. The IRIW litmus test can still fail with only `LDAR`/`STLR`. For true seq_cst you need an extra full barrier.

In practice, Go's atomics combine `LDAR`/`STLR` with a careful choice of operation order, plus sometimes a `DMB ISH` on the store side, to achieve seq_cst. On ARMv8.1 cores the `CASAL`/`LDADDAL`/`SWPAL` instructions (with both A and L suffixes for acquire and release) provide seq_cst directly.

### Apple Silicon

The M1, M2, and M3 chips implement ARMv8.4-A with the LSE2 extension. They run native ARM code under the standard ARM model. They also have a "TSO mode" for Rosetta 2 to preserve x86 semantics when emulating x86-64 binaries. Go binaries on Apple Silicon use the standard ARM model — the runtime's atomics emit the right instructions.

---

## POWER and `lwsync` / `sync`

IBM's POWER architecture has one of the weakest commercially deployed memory models. Two main barrier instructions:

- `sync` — full barrier. Orders all memory operations before all after. Roughly 50–100 cycles.
- `lwsync` — lightweight sync. Orders load-load, load-store, store-store. Does NOT order store-load. Roughly 10–20 cycles. Sufficient for release/acquire.

POWER also has:

- `eieio` — for memory-mapped I/O ordering, not for normal memory.
- `isync` — instruction sync, often combined with a load to form an acquire fence in older POWER conventions.

Go's `runtime/internal/atomic/asm_ppc64x.s` uses these instructions when targeting POWER. The cost of seq_cst on POWER is higher than on ARM, which is higher than on x86. Go applications running on POWER hardware (typical in some banking and HPC environments) pay a measurable atomic cost.

---

## How Go Compiles Each Atomic on Each Architecture

A summary table. Cost is approximate cycle count for an uncontended operation.

### `atomic.Int64.Load`

| Architecture | Emitted instruction(s) | Cost |
|---|---|---|
| x86-64 | `MOVQ (mem)` | 1–4 cycles (cache-hit) |
| ARM64 | `LDAR (mem)` | 3–6 cycles |
| ARM64 v8.1 | `LDAR (mem)` (same) | 3–6 cycles |
| POWER9 | `lwsync; ld; cmp; bc; isync` (acquire pattern) | 20–30 cycles |

### `atomic.Int64.Store`

| Architecture | Emitted instruction(s) | Cost |
|---|---|---|
| x86-64 | `XCHGQ AX, (mem)` | 10–20 cycles |
| ARM64 | `STLR (mem)` | 5–10 cycles |
| POWER9 | `lwsync; std` | 20–30 cycles |

### `atomic.Int64.Add`

| Architecture | Emitted instruction(s) | Cost |
|---|---|---|
| x86-64 | `LOCK XADDQ` | 10–20 cycles |
| ARM64 (pre 8.1) | `LDAXR ... STLXR; CBNZ retry` | 10–25 cycles uncontended |
| ARM64 v8.1 | `LDADDAL` | 10–15 cycles |
| POWER9 | `lwarx; addi; stwcx.; bne retry; sync` | 30–50 cycles |

### `atomic.Int64.CompareAndSwap`

| Architecture | Emitted instruction(s) | Cost |
|---|---|---|
| x86-64 | `LOCK CMPXCHGQ` | 10–20 cycles |
| ARM64 (pre 8.1) | `LDAXR; CMP; BNE; STLXR; CBNZ` | 10–25 cycles uncontended |
| ARM64 v8.1 | `CASAL` | 10–15 cycles |
| POWER9 | `lwarx; cmp; bne; stwcx.; bne retry; sync` | 30–50 cycles |

Under contention, all of these can balloon to hundreds of cycles per operation as cache lines bounce between cores. The cycle figures above are the cost of the fence + atomicity itself in the best case.

---

## Microbenchmarking Fence Cost

You can measure fence cost yourself with Go's testing framework. A useful benchmark:

```go
package main

import (
    "sync/atomic"
    "testing"
)

var (
    x atomic.Int64
    y int64
)

func BenchmarkAtomicAdd(b *testing.B) {
    for i := 0; i < b.N; i++ {
        x.Add(1)
    }
}

func BenchmarkPlainAdd(b *testing.B) {
    for i := 0; i < b.N; i++ {
        y++
    }
}

func BenchmarkAtomicStore(b *testing.B) {
    for i := 0; i < b.N; i++ {
        x.Store(int64(i))
    }
}

func BenchmarkAtomicLoad(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = x.Load()
    }
}
```

On a typical x86-64 server:

- `BenchmarkPlainAdd`: ~0.3 ns/op (the compiler may even optimise it away).
- `BenchmarkAtomicAdd`: ~3–4 ns/op uncontended.
- `BenchmarkAtomicStore`: ~3–4 ns/op uncontended.
- `BenchmarkAtomicLoad`: ~0.3–0.5 ns/op (plain `MOV` on TSO).

On Apple Silicon M2:

- `BenchmarkPlainAdd`: ~0.2 ns/op.
- `BenchmarkAtomicAdd`: ~5–6 ns/op uncontended.
- `BenchmarkAtomicStore`: ~3 ns/op (`STLR`).
- `BenchmarkAtomicLoad`: ~1 ns/op (`LDAR`).

The atomic load cost is the most architecture-dependent number. On x86 it is free; on ARM it costs the acquire barrier.

### Demonstrating contention

```go
func BenchmarkAtomicAddContended(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            x.Add(1)
        }
    })
}
```

Run with `-cpu=1,2,4,8`. You will see the cost grow super-linearly as cache lines bounce.

---

## Inspecting the Compiler Output

To see what fences Go emits in your code:

### Method 1: `go tool compile -S`

```bash
go tool compile -S main.go > out.s
```

Search for `LOCK`, `XCHG`, `MFENCE` on x86; for `LDAR`, `STLR`, `LDAXR`, `STLXR`, `DMB` on ARM.

### Method 2: `go build` then `go tool objdump`

```bash
go build -o myapp .
go tool objdump -s '^main\.' myapp
```

This disassembles symbols matching the regex. Useful for inspecting one specific function.

### Method 3: `go build -gcflags=-S`

```bash
go build -gcflags=-S 2>&1 | less
```

Same as method 1 but for an entire build.

### Example output snippet

For an `atomic.Int64.Add` on amd64:

```
0x0010  LOCK XADDQ AX, (BX)
```

For the same call on arm64 (LSE atomics):

```
0x0010  LDADDAL X0, X1, (X2)
```

For the same call on arm64 without LSE (older cores):

```
0x0010  LDAXR  X3, (X0)
0x0014  ADD    X3, X3, X1
0x0018  STLXR  W4, X3, (X0)
0x001c  CBNZ   W4, -3(PC)
```

Reading these confirms what fence behaviour you are paying for.

---

## Race Detector and Vector Clocks Revisited

The race detector (`go run -race`) implements happens-before tracking using vector clocks. Each goroutine has a clock; each memory location has a clock for its last write. When a goroutine reads a location, the read's clock must be >= the location's last-write clock — otherwise a race is reported.

Atomic operations *do* establish happens-before edges via the race detector's tracking. The detector knows that an atomic load synchronises with an atomic store; it propagates clock entries accordingly.

If the race detector reports a race in code that uses atomics correctly, the most common explanation is mixed atomic and non-atomic access to the same memory location. The detector knows the location was written atomically but read non-atomically (or vice versa), and there is no happens-before edge for the non-atomic side.

To debug, look at the report's two stack traces. The non-atomic side will be plain field access; the atomic side will be a call into `sync/atomic`. The fix is almost always to make both sides atomic.

The race detector cannot exhaustively prove absence of races — it only flags races that occur in the test run. Use it with realistic load, multiple GOMAXPROCS values, and on every supported architecture, including ARM.

---

## Summary

At the professional level, fences are concrete instructions you can name, time, and inspect. You can cite Sewell et al. when arguing about x86 TSO behaviour; you can list the ARM barrier hierarchy; you can read `runtime/internal/atomic/asm_arm64.s` and explain what `LDAXR` and `STLXR` do; you can microbenchmark to confirm a fence costs what you expect. The runtime cost of seq_cst differs by architecture — almost free on x86 atomic loads, a few cycles on ARM, more on POWER — and your knowledge of those costs informs both algorithm choice (sharding versus a global counter, mutex versus atomic) and platform planning (do we run on ARM?). Reading the compiler output is the final confirmation: `go tool compile -S` shows you the bytes that will execute, and you can match each `LOCK` or `STLR` to the atomic call in your source.
