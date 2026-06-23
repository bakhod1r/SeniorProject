# Compare-and-Swap (CAS) Algorithms — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The x86 `LOCK CMPXCHG` Instruction](#the-x86-lock-cmpxchg-instruction)
3. [How `atomic.CompareAndSwap` Compiles on amd64](#how-atomiccompareandswap-compiles-on-amd64)
4. [ARMv8 LL/SC and the `CAS` Instruction](#armv8-llsc-and-the-cas-instruction)
5. [Cache Coherence and CAS Cost](#cache-coherence-and-cas-cost)
6. [Memory Ordering: Sequential Consistency on Weak Architectures](#memory-ordering)
7. [Runtime Source — `runtime/internal/atomic`](#runtime-source)
8. [Compiler Intrinsics and SSA](#compiler-intrinsics-and-ssa)
9. [Cycle-Level Performance Analysis](#cycle-level-performance-analysis)
10. [False Sharing and Cache-Line Padding](#false-sharing-and-cache-line-padding)
11. [Spurious Failures and Their Origins](#spurious-failures-and-their-origins)
12. [Summary](#summary)
13. [Further Reading](#further-reading)

---

## Introduction

At the professional level, CAS is a single CPU instruction whose behaviour and cost you can predict at cycle-level granularity. You can read `runtime/internal/atomic/asm_amd64.s` and explain every instruction. You know why ARMv8 has both LL/SC and a dedicated CAS instruction. You understand the MESI protocol well enough to predict the cost of a contended CAS on N cores.

This file walks down to the hardware. References are to Go 1.22 source unless noted.

---

## The x86 `LOCK CMPXCHG` Instruction

x86 has `CMPXCHG` (compare-and-exchange) since the 486. The Intel SDM definition:

> `CMPXCHG r/m64, r64` — Compares the value in the `RAX` register with the destination operand. If the two values are equal, the source operand is loaded into the destination operand. Otherwise, the destination operand is loaded into the `RAX` register.

In pseudo-code:

```
temp = *dest
if RAX == temp:
    *dest = source
    ZF = 1
else:
    RAX = temp
    ZF = 0
```

The `ZF` (zero flag) indicates success.

Without the `LOCK` prefix, `CMPXCHG` is *not* atomic with respect to other CPUs — another core can write to `dest` between the read and the write. Add `LOCK` to make it atomic:

```asm
LOCK CMPXCHGQ source, (dest)
```

`LOCK` was historically a bus lock — the CPU asserted the `#LOCK` line, freezing other agents. Modern x86 (since Pentium Pro) uses **cache-line locking**: the CPU acquires exclusive ownership of the cache line containing `dest` for the duration of the instruction. No bus lock unless the line crosses cache boundaries (in which case the fallback to bus lock costs hundreds of cycles).

### What `LOCK` guarantees

1. **Atomicity** — the entire RMW (read-modify-write) is indivisible.
2. **Full memory barrier** — all loads/stores before `LOCK` in program order are globally visible before any load/store after. This is the `LOCK`-prefixed instruction's role as `mfence`-equivalent.
3. **Cache-coherent** — the line transitions to Modified state in this CPU's cache; all other CPUs invalidate their copies.

### Variants

- `LOCK CMPXCHG8B` — 64-bit compare-and-swap on 32-bit x86 (where registers are 32-bit). Operates on RAX:RDX vs the source RCX:RBX.
- `LOCK CMPXCHG16B` — 128-bit compare-and-swap on x86-64. Used for double-word CAS (e.g., pointer-and-version tag). Required CPU flag: `CMPXCHG16B` (essentially every CPU since 2005).

Go's `sync/atomic` exposes 32-bit and 64-bit CAS; the 128-bit form is not directly available but is used internally by the runtime in some places.

---

## How `atomic.CompareAndSwap` Compiles on amd64

From `runtime/internal/atomic/asm_amd64.s`:

```asm
// bool Cas64(uint64 *ptr, uint64 old, uint64 new)
// Atomically:
//     if *ptr == old { *ptr = new; return 1 } else { return 0 }
TEXT ·Cas64(SB), NOSPLIT, $0-25
    MOVQ ptr+0(FP),  BX
    MOVQ old+8(FP),  AX
    MOVQ new+16(FP), CX
    LOCK
    CMPXCHGQ CX, 0(BX)
    SETEQ ret+24(FP)
    RET
```

Step-by-step:

1. Load `ptr` into `BX`.
2. Load `old` into `AX` (the implicit register used by `CMPXCHG`).
3. Load `new` into `CX` (the source register for `CMPXCHG`).
4. Issue `LOCK CMPXCHGQ` — the actual atomic compare-and-swap.
5. `SETEQ` writes `1` if the zero flag is set (CAS succeeded), `0` otherwise, into the return slot.

The whole function is 5 instructions; the inner work is one instruction.

### Inlining

In Go 1.19+, simple atomic ops are intrinsified — the compiler emits the LOCK CMPXCHGQ directly at the call site, no function-call overhead. For `atomic.Int64.CompareAndSwap`, you may see in disassembly:

```asm
MOVQ <newval>, AX
LOCK
CMPXCHGQ <source>, (<dest>)
```

with the bool return picked up from the flags register.

The compiler-level intrinsic is defined in `cmd/compile/internal/ssagen/ssa.go` (the SSA generator handles atomic intrinsics specially). The relevant tag is `intrinsics.Atomic`.

### The 32-bit form

`CompareAndSwapInt32` compiles to `LOCK CMPXCHGL` (32-bit), identical pattern, faster on some CPUs because the smaller operand fits in lower-half registers.

### `Cas64Rel` and weak memory variants

Go does not expose acquire-only or release-only CAS variants — all CAS is sequentially consistent. On x86 this is essentially free (LOCK already provides a full barrier). On ARM and other weak-memory architectures, this costs barrier instructions; the runtime occasionally uses `Cas64Rel` (release-only CAS) internally where SC is unnecessary, but the public API is SC-only.

---

## ARMv8 LL/SC and the `CAS` Instruction

ARMv8 has two atomic mechanisms:

### Load-Linked / Store-Conditional (LDXR / STXR)

The original ARM atomic pattern. The CPU has an "exclusive monitor" per core. `LDXR` arms the monitor on a cache line; `STXR` succeeds if and only if the monitor is still armed.

```asm
// bool Cas64(uint64 *ptr, uint64 old, uint64 new)
TEXT ·Cas64(SB), NOSPLIT, $0-25
    MOVD ptr+0(FP),  R0
    MOVD old+8(FP),  R1
    MOVD new+16(FP), R2
again:
    LDAXR (R0), R3            // load-acquire exclusive
    CMP R1, R3
    BNE fail
    STLXR R2, (R0), R4        // store-release exclusive; R4=0 on success
    CBNZ R4, again            // retry on monitor cleared
    MOVB $1, ret+24(FP)
    RET
fail:
    CLREX                     // clear exclusive monitor
    MOVB $0, ret+24(FP)
    RET
```

Breakdown:

- `LDAXR` — Load-Acquire eXclusive. Reads memory and arms the monitor. The "Acquire" semantics provide a memory barrier.
- `CMP` and `BNE` — comparison; branch to fail path on mismatch.
- `STLXR` — Store-Release eXclusive. Writes only if the monitor is still armed. Result code (success=0, fail=1) in `R4`. The "Release" semantics provide a memory barrier in the other direction.
- `CBNZ R4, again` — loop if STXR failed (monitor was cleared, e.g., by context switch or cache invalidation from another core).
- `CLREX` — clear the monitor before returning on the value-mismatch path.

The LL/SC pair is wrapped in a retry loop because **STXR can fail spuriously**: a context switch, an interrupt, or even an unrelated cache eviction can clear the monitor. The retry is invisible to the caller — the function returns once it has either succeeded or definitively failed the value check.

### ARMv8.1 CAS Instruction

ARMv8.1 added a direct CAS instruction (`CAS`, `CASA`, `CASL`, `CASAL`):

```asm
CAS R1, R2, (R0)            // R1 = expected, R2 = new value, R0 = pointer
```

Equivalent to `CMPXCHG` on x86. Single instruction, no LL/SC loop. The CPU implements it via cache-coherent atomics.

Go's runtime uses ARMv8.1 CAS when the build target includes the LSE (Large System Extension) flag:

```bash
GOARCH=arm64 GOARM=8.1 go build
```

On Apple Silicon (M1, M2) and most modern ARM server CPUs, LSE is the default and CAS is used.

### Performance comparison

- LL/SC pair: ~5-10 cycles uncontended.
- ARMv8.1 CAS: ~3-5 cycles uncontended.
- x86 LOCK CMPXCHG: ~5-10 cycles uncontended.

Under contention, all three converge to "cache line bouncing dominates."

---

## Cache Coherence and CAS Cost

CAS is fundamentally a cache-coherence operation. To understand its cost, you must understand the cache-coherence protocol.

### MESI Protocol

Modern CPUs use **MESI** (Modified, Exclusive, Shared, Invalid) or a variant (MESIF, MOESI). Each cache line in each cache is in one state:

| State | Meaning |
|---|---|
| **M (Modified)** | This cache has the only valid copy; memory is stale. |
| **E (Exclusive)** | This cache has the only copy; memory is current. |
| **S (Shared)** | Multiple caches have this line; memory is current. |
| **I (Invalid)** | This cache's copy is stale. |

State transitions happen via inter-cache messages on the coherence interconnect (Intel UPI, AMD Infinity Fabric, ARM CCIX, etc.).

### What CAS does at the cache level

When CPU A wants to CAS on a memory address:

1. The line must be in M state in A's cache (exclusive write access).
2. If currently in S (shared with other caches), A sends "Read for Ownership" (RFO). Other caches invalidate their copies; A's transitions to M.
3. If currently in I (invalid), A reads from memory or from another cache that has it, then transitions to M.
4. CAS executes locally in M state.
5. The line stays in M until another CPU asks for it.

### Cost breakdown

| Scenario | Approximate cost |
|---|---|
| Line in M state already | ~5 cycles (one instruction) |
| Line in S state, need to RFO | ~30-50 cycles |
| Line in I state, must fetch from another L1 | ~30-50 cycles |
| Line in I state, must fetch from another socket's L3 | ~100-300 cycles |
| Line in I state, must fetch from DRAM | ~300+ cycles (rare for hot atomics) |

### The ping-pong scenario

Two cores A and B both CAS the same line:

1. A's line is M. A does its CAS. Line stays M.
2. B's CAS arrives. B's cache sends RFO. A's cache invalidates (transitions to I). Line moves to B (M).
3. B does its CAS. Line stays M in B.
4. A's next CAS RFOs. B invalidates. Line moves back to A.

Each transfer is ~30-100 cycles. With N cores all CASing the same line, throughput is bounded by (cycles per transfer) × N.

On an 8-core Intel Xeon doing CAS on a single line:

- 1 core: ~5 cycles per CAS = 200M ops/s/core.
- 8 cores contending: ~50 cycles per CAS = 80M ops/s aggregate.
- Per-core throughput at 8 cores: 10M ops/s — 20x slower.

This is the **cache-line bouncing tax**. It is unavoidable when multiple cores must write the same line.

---

## Memory Ordering

Go's atomics are sequentially consistent. On weak-memory architectures (ARM, POWER, RISC-V), this requires explicit barriers.

### x86 Total Store Order (TSO)

x86 already provides TSO: writes from a single CPU become visible to other CPUs in program order. Reads can be reordered ahead of earlier writes (store buffer effect), which is why a `Load` after a `Store` to the same line can hit the store buffer; but for atomic ops, the `LOCK` prefix provides full mfence semantics, so SC is essentially free.

### ARM Weak Memory Model

ARM allows much more reordering. Without barriers:

- Reads can be reordered before earlier reads (memory ordering not preserved).
- Writes can be reordered after later reads.
- Cross-CPU visibility is delayed and unordered.

To get SC on ARM, the compiler emits:

- `LDAR` (load-acquire) for atomic loads.
- `STLR` (store-release) for atomic stores.
- `LDAXR` and `STLXR` (load-acquire-exclusive, store-release-exclusive) for CAS.
- Optionally `DMB ISH` (data memory barrier, inner shareable) for additional fencing.

These instructions are slightly slower than the unfenced variants but pay for SC.

### Why Go picked SC over the cheaper acquire/release

C++ exposes `memory_order_relaxed`, `memory_order_acquire`, `memory_order_release`, `memory_order_seq_cst`. The lower orderings are faster on weak-memory architectures, but reasoning about them is hard. Programs that mix orderings often have subtle bugs that surface only on specific hardware.

Go chose simplicity: one ordering (SC), reasoning is straightforward, performance is acceptable on every supported architecture. The performance loss on ARM relative to acquire/release is single-digit nanoseconds — not nothing, but not a deal-breaker.

For applications where it does matter (HFT, high-throughput databases), the typical workaround is to minimise the number of atomic ops, not to reach for weaker orderings.

---

## Runtime Source

Key files in `runtime/internal/atomic/`:

| File | Contents |
|---|---|
| `atomic_amd64.go` | Go stubs that call assembly |
| `asm_amd64.s` | x86-64 assembly for Load, Store, Add, CAS, And, Or, Swap |
| `atomic_arm64.go` | ARM64 stubs |
| `asm_arm64.s` | ARM64 assembly, with LSE variants if `goarch.IsArm64==1 && goexperiment.IsArm64Lse==1` |
| `types.go` | Internal `Uintptr`, `Int64`, etc. types used by the runtime itself |

The public `sync/atomic` package re-exports these as the user-facing API. The runtime's internal copy is identical in semantics but lives in `runtime/internal/atomic` to avoid import cycles (the runtime cannot import `sync/atomic`).

### Reading the source

```bash
go env GOROOT
# then look at $GOROOT/src/runtime/internal/atomic/asm_amd64.s
```

Highly recommended: read the assembly for `Cas64`, `Xadd64`, `Load64`, `Store64`. They are short and they teach you exactly how the abstraction translates to hardware.

### Runtime use of CAS

The Go runtime itself uses CAS extensively:

- **Scheduler:** Goroutine state transitions (`runnable` → `running`) use CAS.
- **GC:** The work queue and mark bits use CAS.
- **Channels:** Fast path of send/receive uses CAS on the channel state word.
- **Mutex:** `sync.Mutex.state` is updated via CAS on the fast path.
- **WaitGroup:** Counter and waiter count packed into one word, updated via CAS.

If you read `runtime/proc.go`, `runtime/chan.go`, `runtime/mgcmark.go`, you see CAS everywhere. The runtime is a lock-free codebase wherever performance matters.

---

## Compiler Intrinsics and SSA

The Go compiler treats some atomic operations as intrinsics — instead of generating a function call, it emits the underlying instruction directly. This eliminates the function-call overhead (~5 ns) for hot atomics.

The intrinsification logic lives in `cmd/compile/internal/ssagen/ssa.go`. Search for `intrinsics` and `atomic`.

For `atomic.Int64.Add`:

```go
func (x *Int64) Add(delta int64) (new int64)
```

The compiler recognises this method, lowers it to an SSA `Op` (e.g., `OpAtomicAdd64`), and emits `LOCK XADDQ` directly. No function call.

For `atomic.Int64.CompareAndSwap`:

```go
func (x *Int64) CompareAndSwap(old, new int64) (swapped bool)
```

Lowered to `OpAtomicCompareAndSwap64`, emitting `LOCK CMPXCHGQ` directly.

Not all atomic ops are intrinsified on all architectures. The set has grown over Go releases. As of Go 1.22:

- amd64: all of Load, Store, Add, Swap, CAS, And, Or are intrinsified.
- arm64: same.
- 386 and arm (32-bit): Load64 and Store64 of int64 use a runtime helper because the instruction doesn't exist directly; CAS variants are intrinsified.

### Disassembling to verify

```bash
go build -gcflags="-S" mypackage 2>&1 | grep -A1 "atomic"
```

Or:

```bash
go tool objdump -s "MyFunc" mybinary
```

You will see the raw instructions and can confirm intrinsification.

---

## Cycle-Level Performance Analysis

Approximate cycle costs on a 3-4 GHz x86-64 CPU:

| Operation | Cycles | Wall time |
|---|---|---|
| Register-register MOV | 1 | 0.3 ns |
| Memory load (L1 hit) | 4 | 1.3 ns |
| Memory load (L2 hit) | 10-15 | 3-5 ns |
| Memory load (L3 hit) | 30-40 | 10-15 ns |
| Memory load (DRAM) | 100-300 | 30-100 ns |
| Aligned atomic load (LOCK not needed on x86) | ~4 | 1.3 ns |
| LOCK CMPXCHG (line in M) | ~20 | 7 ns |
| LOCK CMPXCHG (line in S, RFO required) | ~50 | 16 ns |
| LOCK CMPXCHG (cross-socket) | ~200-300 | 60-100 ns |
| Mutex Lock+Unlock (uncontended) | ~80 | 25 ns |
| Mutex Lock+Unlock (contended, kernel park) | ~3000+ | 1000+ ns |

The cost of CAS is not the instruction itself — it is the cache-coherence work to bring the line into M state. Optimisation = minimise contention so the line stays in M.

### Reading cycle counts on Linux

```bash
perf stat -e cache-misses,cache-references,cycles,instructions ./mybench
```

Or for cache-line-bouncing specifically:

```bash
perf stat -e mem_load_l3_miss_retired.remote_hitm ./mybench
```

(Exact event names vary by CPU.)

---

## False Sharing and Cache-Line Padding

The unit of cache coherence is the **cache line**, not the variable. On modern x86 and ARM, cache lines are 64 bytes. Two variables on the same line are subject to the same coherence traffic.

If CPU A writes variable `x` and CPU B writes variable `y`, but `x` and `y` are on the same line, both CPUs bounce the line back and forth even though they touch independent data. This is **false sharing**, and it can destroy performance.

### Detection

```go
type Bad struct {
    a atomic.Int64 // offset 0
    b atomic.Int64 // offset 8  — same cache line!
}
```

Two goroutines, one writing `Bad.a` and one writing `Bad.b`, contend as if they were writing the same variable.

### Fix: pad to cache-line boundary

```go
type Good struct {
    a atomic.Int64
    _ [56]byte    // pad to 64 bytes total
    b atomic.Int64
    _ [56]byte
}
```

Now `a` and `b` are on different lines. Independent writes do not contend.

### `runtime/internal/cpu.CacheLinePadSize`

The Go runtime exports the cache-line size:

```go
import "runtime/internal/cpu"

const cacheLine = cpu.CacheLinePadSize // 64 on x86, varies elsewhere
```

But this is internal. Public code typically hard-codes 64 (correct for all major architectures Go targets).

### The cost of padding

Padding wastes memory: each padded atomic costs 64 bytes instead of 8. For a structure with N counters, you spend 64N bytes. For most code this is acceptable; for cache-sensitive memory (e.g., per-goroutine state for many goroutines), it can balloon.

The trade-off is real and explicit: padded counters are faster under contention, less dense in memory.

### Sharding to avoid contention without padding overhead

```go
type Counter struct {
    shards [16]struct {
        v atomic.Int64
        _ [56]byte
    }
}
```

Goroutines pick a shard (hash by goroutine ID, or pin to processor) and write to their shard's counter. Read aggregates across all shards. Each shard is on its own cache line; contention is per-shard, not global.

The `sync.Pool` in the Go runtime uses this pattern with per-P (per-processor) shards.

---

## Spurious Failures and Their Origins

A CAS can fail for two reasons:

1. **Real failure:** the value at the address is not the expected `old`. Another thread wrote to it.
2. **Spurious failure:** the CAS failed for hardware reasons, even though the value still equals `old`.

### x86: no spurious failures

`LOCK CMPXCHG` is deterministic. If the value equals `old`, the CAS succeeds. No spurious failures.

### ARM with LL/SC: spurious failures possible

The exclusive monitor can be cleared by:

- A context switch (the kernel saves/restores the monitor, but conservatively clears it).
- An unrelated cache eviction (rare; the monitor is tied to the line).
- A cache-coherence event on the line from another CPU (even a read in some implementations).

The runtime wraps LL/SC in a retry loop, so the `Cas64` function returns once it has either truly succeeded or truly failed the comparison. **User code does not see spurious failures.**

### ARMv8.1 CAS: no spurious failures

The dedicated CAS instruction is atomic at the hardware level; no monitor, no spurious failure.

### Implication for user code

Go's `CompareAndSwap` returning `false` always means "the value did not match." Never "transient failure, please retry." If you wrap a CAS in a retry loop because the value changed, you are doing the right thing; you are not handling spurious failures (the runtime did that already).

---

## Summary

At the professional level, every line of a CAS-using Go function maps to a known sequence of CPU instructions, cache transactions, and barrier costs. You can:

- Read `runtime/internal/atomic/asm_amd64.s` and explain every instruction.
- Predict the cycle cost of a CAS based on cache-line state.
- Distinguish x86's LOCK CMPXCHG from ARM's LL/SC and ARMv8.1's CAS.
- Reason about false sharing and apply padding when it matters.
- Verify intrinsification with `go tool objdump`.
- Explain why Go picked sequential consistency and what it costs on ARM.

The specification level (next file) covers the formal Go memory model rules for CAS.

---

## Further Reading

- Intel Software Developer's Manual Vol 2A, "CMPXCHG — Compare and Exchange."
- ARM Architecture Reference Manual for ARMv8-A, sections C3.2 (LDXR/STXR) and C3.4 (LSE Atomic Instructions).
- AMD64 Architecture Programmer's Manual Vol 3, "CMPXCHG."
- Russ Cox, "Hardware Memory Models," <https://research.swtch.com/hwmm>.
- Russ Cox, "Programming Language Memory Models," <https://research.swtch.com/plmm>.
- Paul E. McKenney, *Is Parallel Programming Hard, And, If So, What Can You Do About It?* — free at <https://mirrors.edge.kernel.org/pub/linux/kernel/people/paulmck/perfbook/perfbook.html>. Chapter 14 on advanced synchronisation.
- Ulrich Drepper, "What Every Programmer Should Know About Memory," 2007. Section 6 on cache coherence.
- The Go source: `src/runtime/internal/atomic/`. Read it.
