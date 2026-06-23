# Memory Model — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [CPU Memory Models](#cpu-memory-models)
3. [How Go Maps Its Memory Model to Hardware](#how-go-maps-its-memory-model-to-hardware)
4. [Memory Barriers and Their Cost](#memory-barriers-and-their-cost)
5. [The Race Detector Internals](#the-race-detector-internals)
6. [Vector Clocks and Happens-Before Tracking](#vector-clocks-and-happens-before-tracking)
7. [Atomics on Different Architectures](#atomics-on-different-architectures)
8. [Cache Coherence Protocols](#cache-coherence-protocols)
9. [The Cost of Sequentially Consistent Atomics](#the-cost-of-sequentially-consistent-atomics)
10. [Summary](#summary)

---

## Introduction

This file zooms in on what happens *below* Go's memory model — the CPU memory models that the runtime maps onto, the compiler-inserted fences, and the race detector's mechanisms. Most engineers do not need this level of detail; for those who do, it explains the costs of the discipline you have been following.

We touch x86's TSO model, ARM's weak model, the race detector's vector-clock tracking, and the assembly Go emits for atomic operations.

---

## CPU Memory Models

Each CPU architecture has its own memory model — the rules for what reorderings the CPU may do.

### Sequential consistency (the simplest)

> All operations happen in some global order that respects each thread's program order.

This is the strongest, most intuitive model. Almost no real CPU provides it; it is too expensive.

### Total Store Order (TSO)

> A read may be reordered with a later write to a different memory location, but writes from the same processor are seen in order by all other processors.

Provided by x86 / x86-64. A relatively strong model:

- Loads → loads: in order.
- Stores → stores: in order.
- Loads → stores: in order.
- Stores → loads: *may be reordered* (store buffer effect).

The reordering of "store followed by load" is the only difference from sequential consistency. A "MFENCE" instruction prevents it.

### Weak / partial ordering (ARM, PowerPC, Itanium)

ARM, especially in its early forms, provides few ordering guarantees. Any load or store may be reordered with any other (subject to data dependencies and program-order within the same address).

To enforce ordering, ARM uses explicit fences:

- `dmb ish` — full data memory barrier.
- `dmb ishst` — store barrier.
- `dmb ishld` — load barrier.
- `dsb` — stronger synchronisation barrier.

### Apple Silicon (M1, M2, M3)

ARM 64-bit, but with a twist: the M1 has a "TSO mode" enabled when running x86 code through Rosetta 2 to preserve x86 semantics. Native ARM code runs under the standard ARM model.

For Go code on Apple Silicon, the standard ARM model applies. The runtime inserts the needed fences.

### RISC-V

A weak model similar to ARM. Uses `fence` instructions for ordering.

---

## How Go Maps Its Memory Model to Hardware

The Go memory model says "sequentially consistent atomics." How does this translate to hardware?

### On x86

x86 is already strong. Most atomic operations require no explicit fence:

```
atomic.LoadInt64(&x):   MOV instruction (single-byte / single-word reads are atomic on x86)
atomic.StoreInt64(&x):  MOV (with implicit ordering for naturally-aligned addresses)
atomic.AddInt64(&x, 1): LOCK XADD
atomic.CAS:             LOCK CMPXCHG
```

`LOCK`-prefixed instructions are full memory barriers on x86. They serialise the local store buffer and enforce ordering with respect to other cores' caches.

For seq_cst guarantees, x86 needs:
- All atomic stores followed by a fence (or use of `XCHG`, which has an implicit lock).
- Or use `MFENCE` after each store.

Go's compiler emits the appropriate instructions; you do not need to think about it.

### On ARM

ARM is weaker. Atomic operations require explicit fences:

```
atomic.LoadInt64(&x):   LDAR (load-acquire)
atomic.StoreInt64(&x):  STLR (store-release)
atomic.AddInt64(&x, 1): LDXR + STXR loop with fences
atomic.CAS:             LDAXR + STLXR loop
```

`LDAR` and `STLR` are acquire/release variants — they provide the sequencing Go needs for seq_cst. ARMv8.1+ added `LDADDAL` and similar instructions that combine read-modify-write with seq_cst ordering.

### On RISC-V

Similar to ARM — explicit fences via `fence rw,rw`. The new AMO (atomic memory operations) extension provides primitives matching what Go needs.

### Putting it together

The Go runtime and compiler abstract away these differences. As a Go programmer, you write `atomic.AddInt64`; the runtime emits the right instructions for your platform.

Behaviour: identical. Cost: similar (1–10 ns per atomic op). Implementation: very different.

---

## Memory Barriers and Their Cost

A memory barrier is an instruction that forces ordering. Costs vary:

| Instruction | Architecture | Typical cost |
|---|---|---|
| `MFENCE` | x86 | ~20–30 cycles |
| `LOCK` prefix | x86 | ~10–30 cycles (with cache line bounce) |
| `dmb ish` | ARM | ~20–50 cycles |
| `dmb ishst` | ARM | ~10–20 cycles |
| `LDAR` / `STLR` | ARM | ~5–15 cycles |
| Plain MOV | x86 | ~1 cycle |
| Plain LDR / STR | ARM | ~1 cycle |

Atomic operations on contended cache lines are much slower because of cache invalidation:

| Operation | Latency |
|---|---|
| Uncontended atomic add | ~5 ns |
| Cross-core uncontended | ~30 ns (cache line transfer) |
| Heavy contention | ~100+ ns (cache line bouncing) |

This is why a single atomic counter incremented from many cores does *not* scale — the cache line owning the counter ping-pongs.

### When to use fences explicitly

In pure Go, you cannot insert fences manually; you use the `sync/atomic` package, which inserts them as needed.

If you write assembly (rare in app code), you have access to platform-specific instructions.

For most Go code, the lesson is: every `atomic.Op()` is a fence-emitting operation. Use them where needed; avoid them in hot loops where possible.

---

## The Race Detector Internals

The race detector is built on Google's *ThreadSanitizer* (TSan) library. Roughly:

### What it does

1. The compiler instruments every memory access (read or write) with a call into the race detector library.
2. The library maintains, for each memory location, the *vector clock* of the last accessing goroutine.
3. On each access, it compares the current goroutine's vector clock with the location's clock.
4. If neither dominates the other, there is a race: report it with both call stacks.

### Vector clocks

A vector clock is a per-goroutine timestamp vector. Goroutine A's vector clock has an entry for every goroutine, recording A's latest known clock of each.

When goroutine A synchronises with goroutine B (e.g., via a channel send/receive), they exchange clocks:
- A's clock receives B's entries (component-wise max).
- A's own clock is incremented.

If at any access A.clock[B] < B.clock[B] when B last wrote the same location, then B's write happens-before A's access. If A.clock[B] >= B.clock[B], A is "later or concurrent" — race if concurrent.

### Performance cost

Roughly:
- 2x–10x slower runtime.
- 5x–10x more memory (vector clocks for every memory location).
- Higher startup time.

Practical: use in tests and development. Not in production.

### What it cannot do

- Races that do not occur during the run.
- Races inside Cgo (C code is not instrumented).
- Races inside assembly code.

### How to interpret reports

A race report includes:
- The current access location (file:line).
- The previous conflicting access location.
- Goroutine IDs and creation stacks.

Read both stacks. The race is between them. Fix by adding synchronisation that establishes happens-before.

---

## Vector Clocks and Happens-Before Tracking

For deeper understanding:

### Initialisation

When goroutine G is created (e.g., via `go f()`):
- The creator's vector clock is incremented at the creator's slot.
- G inherits a copy of the creator's clock.
- G's slot is initialised to 0.

Now: anything the creator did before `go f()` is visible to G (creator's clock is "smaller" in G's view).

### Channel send/receive

A send:
- Sender's vector clock is "stamped" onto the channel's clock.

A receive:
- Receiver's clock merges with the channel's clock (component-wise max).

After receive, the receiver "knows" everything the sender knew at send time. Memory writes before the send are visible.

### Mutex unlock/lock

Symmetric to channel:
- Unlock stamps the mutex's clock.
- Lock merges with the mutex's clock.

### Race detection

When a read or write happens on memory location M:
- Compare the current goroutine's clock with M's last-write clock.
- If current's relevant entry is >= last writer's: OK (current is "after" last write).
- Else: race.

A read followed by another goroutine's write is also a race (unless synchronised).

### Cost

The data structure is O(n) per location, where n is the number of goroutines. For programs with many goroutines, the bookkeeping is heavy. The race detector uses *epoch-based* shortcuts to reduce memory.

---

## Atomics on Different Architectures

Go's `sync/atomic` provides operations on:
- `int32`, `int64`, `uint32`, `uint64`, `uintptr`.
- Pointers (`*T`).
- `bool`, `int`, `uintptr` (via generics in Go 1.19+).

### Aligned access

On many architectures, atomic operations require the address to be properly aligned. Go's compiler aligns struct fields appropriately. However:

- On 32-bit ARM, 64-bit atomics require 8-byte alignment of the variable. The compiler may not align fields of a 32-bit struct correctly; you may need explicit alignment.
- Go 1.19+ added `atomic.Int64` and `atomic.Uint64` structs that are always correctly aligned.

If you use the old function form (`atomic.AddInt64(&x, 1)`), make sure `x` is 64-bit aligned. Use the struct form to avoid this.

### Sub-word atomics

`atomic.LoadInt32` and friends work on 32-bit values. On most architectures, 32-bit aligned reads/writes are naturally atomic; the runtime adds fences for ordering.

`atomic.Bool` is implemented via `atomic.Int32` internally.

### CAS

Compare-and-swap is the building block of lock-free programming:

```go
swapped := atomic.CompareAndSwapInt64(&x, old, new)
```

On x86: `LOCK CMPXCHG`. On ARM: `LDXR` / `STXR` loop. Both ~5–10 ns uncontended.

CAS loops can livelock under heavy contention; the standard library uses backoff strategies for some primitives.

---

## Cache Coherence Protocols

Modern multi-core CPUs use cache coherence protocols. The most common is MESI:

### MESI states

Each cache line is in one of four states:

- **Modified.** The line has been written; this cache has the only valid copy.
- **Exclusive.** The line has been read; this cache has the only copy, unchanged.
- **Shared.** The line has been read by multiple caches; all have the same value.
- **Invalid.** The line is not in this cache (or has been invalidated).

### Transitions

- Read miss: line transitions from Invalid to Exclusive (if no other cache has it) or Shared.
- Write to Shared line: must transition to Modified, invalidating all other copies. This is the "invalidation broadcast."
- Read while in Modified: another cache needs the line. Original cache transitions to Shared (sends the line to the requester).
- Eviction: line goes back to Invalid (writes back if Modified).

### Implications

- A read of a value that another core just wrote: requires a cache line transfer. Cost ~30–60 ns.
- Two cores writing to the same cache line: ping-pong. Cost much higher.
- False sharing: two cores writing to *different* variables on the *same* cache line. Same ping-pong cost.

### MESI variants

- MOESI: adds Owned state, used by AMD.
- MESIF: adds Forwarding, used by Intel.

The protocol matters when squeezing out maximum performance. For most Go code, "do not share cache lines between cores" is sufficient guidance.

---

## The Cost of Sequentially Consistent Atomics

Go's choice to make atomics seq_cst trades some performance for simplicity.

### Comparison with C++ memory orders

C++ atomics support multiple orderings:

- `relaxed`: no ordering, only atomicity.
- `acquire` / `release`: half fences.
- `acq_rel`: both.
- `seq_cst`: full ordering.

Each weaker ordering allows the compiler / CPU to do more reordering, which can be faster.

Go: only seq_cst. On x86, the difference is small (most operations already provide TSO). On ARM, the difference is larger — relaxed atomics on ARM are much cheaper than seq_cst.

### When this hurts

Hot loops doing atomic loads on ARM. Counter scans, statistics aggregation, lock-free data structures. The seq_cst load is roughly 2x the cost of a relaxed load.

### Workarounds

- **Drop to unsafe.** You can do unsafe loads/stores via `unsafe.Pointer`, getting relaxed semantics. Not recommended; you lose the memory model guarantees.
- **Per-goroutine accumulation.** Combine results infrequently via atomics; do the hot work locally without atomics.
- **Assembly.** Write your own atomic in assembly. Last resort.

For 99% of Go code, the cost is irrelevant. The other 1% (high-frequency-trading, in-memory databases) may need extreme measures.

---

## Summary

CPU memory models vary: x86 has TSO (relatively strong), ARM has a weak model with explicit fences. Go's memory model is sequentially consistent for atomics on top of any of these — the runtime and compiler insert the right instructions per platform.

Memory barriers cost tens of cycles. Atomic ops on contended cache lines cost much more — cache line transfers dominate. Avoid sharing hot data across cores; use sharding or per-CPU accumulation.

The race detector instruments every memory access and tracks happens-before via vector clocks. It catches races that occur during execution; rare orderings can still slip through. Stress runs and design discipline complement the detector.

Go's seq_cst-only atomics are a deliberate simplification. They are easier to use correctly than C++'s memory orders, at the cost of some performance — primarily on ARM. For most workloads, the trade is worthwhile.

The next file (`specification`) gathers references for verifying claims against authoritative sources.
