---
layout: default
title: Hardware Barriers — Professional
parent: Hardware Barriers
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/01-hardware-barriers/professional/
---

# Hardware Memory Barriers — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Memory Order Buffer in Depth](#the-memory-order-buffer-in-depth)
3. [Load/Store Queues](#loadstore-queues)
4. [TSO Replays and Memory Order Violations](#tso-replays-and-memory-order-violations)
5. [Speculative Execution and Memory Ordering](#speculative-execution-and-memory-ordering)
6. [Non-Temporal Stores and Write Combining](#non-temporal-stores-and-write-combining)
7. [RDTSC and the Need for Fencing](#rdtsc-and-the-need-for-fencing)
8. [Fence-Free Fast Paths](#fence-free-fast-paths)
9. [Formal Verification with Herd7 and Cat Models](#formal-verification-with-herd7-and-cat-models)
10. [Designing for a Specific Microarchitecture](#designing-for-a-specific-microarchitecture)
11. [The Go Runtime's Most Subtle Barrier Uses](#the-go-runtimes-most-subtle-barrier-uses)
12. [GC Write Barriers vs Memory Barriers](#gc-write-barriers-vs-memory-barriers)
13. [Stack Scanning and Memory Ordering](#stack-scanning-and-memory-ordering)
14. [Cross-Language ABI Considerations](#cross-language-abi-considerations)
15. [SIMD and Vector Memory Ordering](#simd-and-vector-memory-ordering)
16. [Transactional Memory and Barriers](#transactional-memory-and-barriers)
17. [Persistent Memory Barriers](#persistent-memory-barriers)
18. [Coding Patterns](#coding-patterns)
19. [Clean Code](#clean-code)
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
> Focus: microarchitectural buffers, load-store queues, TSO replays, speculative execution, non-temporal stores, persistent memory, formal verification, the Go runtime's deepest barrier uses.

At the professional level you should be able to argue about memory ordering at the level of individual microarchitectural buffers and pipeline stages. You should know why Intel's MOB has the structure it does, why TSO replays happen, why a CAS retry storm is a microarchitectural pathology, and how persistent memory introduces a new class of barrier (CLFLUSHOPT, CLWB, SFENCE, PCOMMIT). You should be able to read a research paper that proposes a new memory model and tell whether it makes sense, and you should be able to reason about Go runtime code that uses memory barriers in non-obvious ways.

This file is the deepest. It assumes everything from junior, middle, and senior. By the end you should be able to:

- Trace a memory operation through the load/store queues from issue to commit.
- Explain why TSO needs replay logic and when replays happen.
- Design a fence-free fast path for a hot data structure.
- Verify a memory-ordering invariant in Herd7 against any of the supported architectures.
- Read `runtime/asm_amd64.s`, `runtime/proc.go`, and `runtime/mwbbuf.go` and understand every barrier.
- Differentiate Optane-style persistent memory barriers from cache-coherence barriers.

---

## The Memory Order Buffer in Depth

Modern Intel cores (Sandy Bridge through Sapphire Rapids) implement the Memory Order Buffer as a unified structure handling all in-flight memory operations.

### Structure

The MOB has:
- A **load buffer** with ~72 entries (Skylake) / ~128 entries (Ice Lake).
- A **store buffer** with ~56-72 entries.
- A **store-to-load forwarding** network.
- A **memory order violation detector** for speculative loads.
- Address-comparison logic for snoop responses.

Each load buffer entry holds:
- The target virtual address (after the AGU computes it).
- The physical address (after TLB lookup).
- The instruction's age (sequence number).
- The data, once the load returns.
- Status flags: "issued", "completed", "speculative", etc.

Each store buffer entry holds the same plus the data to be written.

### Operation issue

When a load is dispatched, the AGU computes the address. The MOB checks:
1. Is there an older store to the same physical address? If yes, store-to-load forward the value.
2. Is the physical address ready (TLB hit)? If yes, fetch from L1.
3. Is there any older load to the same address with completed data? If yes, that's the value.

When a store is dispatched, the MOB allocates an entry but does not yet write to cache.

### Retirement

Loads retire when their data has arrived (or been forwarded). Stores retire when the instruction is committed — but the data write to cache happens asynchronously, after retirement.

After retirement, the store sits in the store buffer waiting for the cache line to become writable. Once it does (M state), the store is written and the entry is freed.

### Memory order violation detection

The MOB tracks the addresses of every speculatively-completed load. When a snoop (i.e. an invalidation from another core) arrives for an address matching one of these speculative loads, the MOB:
1. Squashes the speculative load and every younger instruction in the pipeline.
2. Re-executes them from the squashed point.

This is the mechanism that makes TSO actually work on an out-of-order core: the CPU speculates aggressively, but if any external event would have made the speculation incorrect, it rolls back.

### Cost of a memory order violation

A squash + replay costs ~30-100 cycles (pipeline depth). In contended atomic loops, you can see significant time spent in replays.

### Profiling

Intel's `perf` exposes counters for memory order violations:
- `machine_clears.memory_ordering` — counts MO violations.
- `mem_load_retired.l1_hit` — load completed from L1.
- `mem_load_retired.fb_hit` — load completed from a fill buffer.

If you see high `machine_clears.memory_ordering`, contention is causing TSO replays.

---

## Load/Store Queues

The terminology overlaps between "MOB" (Intel), "Load/Store Queue" (academic), and "Memory Pipeline" (ARM). They all refer to similar structures.

ARM's Cortex-A77 has:
- A 64-entry load queue.
- A 36-entry store queue.
- A 56-entry "memory data" structure that holds the actual data in flight.

The principles are the same as Intel's MOB:
- Loads can complete out of order, subject to ordering rules.
- Stores retire from the pipeline but write to cache later.
- Forwarding between in-flight stores and loads.
- Snoop-driven squashes for ordering violations.

The difference: ARM's weaker model means fewer ordering constraints, so the LSQ has less work to do. ARM cores can achieve higher per-core IPC for loosely-ordered workloads, at the cost of programmer-visible reorderings.

---

## TSO Replays and Memory Order Violations

A concrete walk-through of why TSO replays happen.

### Scenario

Core 0 is executing this sequence:

```
LOAD r1, [A]
... independent ops ...
LOAD r2, [B]
```

Core 0 speculatively executes both loads. Both complete. r1 holds the value of A at time T0; r2 holds the value of B at time T1. So far so good.

Meanwhile, Core 1 writes B (invalidating Core 0's cached copy at time T0.5). The invalidation arrives at Core 0 *after* it has used the cached value of B. From Core 0's perspective at T1, B was already changed — its load should have seen the new value.

The MOB detects this: it has a record of the load to B; an invalidation for B arrived; the load was issued at T1, but the value was determined at T0 (before the invalidation). This is a memory order violation.

The MOB squashes the load and all subsequent instructions, then replays them. On the replay, B's cache line is no longer present (invalidated); the load goes to L2/L3 to fetch the new value.

### Cost

The squash + replay flushes ~50 instructions of progress. If this happens once per 10,000 instructions, the cost is negligible. If it happens once per 100 instructions (heavy contention), the cost is 50%.

### Mitigation

- Reduce contention via per-CPU sharding.
- Reduce barrier density (fewer atomic ops).
- Avoid hot cache lines shared across cores.

---

## Speculative Execution and Memory Ordering

The interaction between speculation and memory ordering is subtle.

### Speculative loads

A core may issue loads speculatively, before the branch direction is confirmed. If the branch was mispredicted, the speculative loads are squashed without effect on architectural state. But:
- They may have touched the cache (transient effect — exploited by Spectre).
- They may have triggered TLB walks.
- They may have queued in the LSQ.

### Speculative stores

A core does *not* issue speculative stores to memory. Stores stay in the store buffer until the instruction retires (i.e. is no longer speculative). This is critical for memory model correctness: a misspeculated store must not be visible to other cores.

But the store may sit in the store buffer for a long time after retirement, waiting for cache line ownership.

### LFENCE as a speculation barrier

Intel's LFENCE is documented (post-Spectre) as a serialising instruction: it prevents speculative execution past it. This is used in two ways:
1. **Spectre mitigation:** insert LFENCE after a bounds check to prevent speculative array access past the bound.
2. **Read-side fences for memory ordering:** the LFENCE forces all prior loads to complete and stalls further issue.

Go's runtime uses LFENCE sparingly — usually in `crypto/...` for constant-time operations.

### Branchless code

In high-performance code, branches are sometimes eliminated to avoid speculative side channels. For example, comparing two byte arrays for equality:

```go
// Not constant-time
func equal(a, b []byte) bool {
    if len(a) != len(b) { return false }
    for i := range a {
        if a[i] != b[i] { return false }
    }
    return true
}

// Constant-time
func constantTimeEqual(a, b []byte) bool {
    if len(a) != len(b) { return false }
    var v byte
    for i := range a {
        v |= a[i] ^ b[i]
    }
    return v == 0
}
```

The constant-time version has no early-exit branch. Use `crypto/subtle.ConstantTimeCompare` in real code.

---

## Non-Temporal Stores and Write Combining

Non-temporal stores bypass the cache. They write directly to memory via a small "write-combining buffer" that aggregates adjacent stores into larger bus transactions.

### Instructions

x86: `MOVNTI`, `MOVNTPS`, `MOVNTDQ`, `VMOVNTPD`.

These instructions are used by:
- `runtime.memmove` for large copies (greater than the L2 cache).
- Some `crypto/...` code.
- Graphics drivers, network drivers.

### Why non-temporal?

For a 100 MB memcpy, you don't want to pollute the cache with the data being copied (you'll never use it again). Non-temporal stores write directly to memory, skipping the cache. This preserves cache state for the rest of the program.

### Why a write-combining buffer?

DRAM transactions are most efficient at 64-byte burst sizes. Non-temporal stores accumulate in a small buffer (usually 4-12 entries, each 64 bytes), then flush as a burst. This amortises DRAM latency.

### SFENCE for non-temporal stores

Non-temporal stores are weakly ordered with respect to each other and with normal stores. To enforce ordering, use SFENCE. Without SFENCE, the write-combining buffer may reorder stores.

In Go, this is invisible — the runtime's `memmove` handles SFENCE internally.

---

## RDTSC and the Need for Fencing

RDTSC (Read Time-Stamp Counter) is an x86 instruction that returns a 64-bit cycle counter. It is used for high-resolution timing.

### Problem

RDTSC is *not* a serialising instruction. The CPU may execute RDTSC out of order with respect to other instructions. If you want to time a region:

```
RDTSC                ; get start time
... code ...
RDTSC                ; get end time
```

The end-time RDTSC might execute before the `... code ...` finishes, giving a meaningless reading.

### Solution

Pair RDTSC with LFENCE (or CPUID, which is fully serialising):

```
LFENCE
RDTSC                ; start
... code ...
LFENCE
RDTSC                ; end
```

The LFENCE forces prior loads to complete, including the prior RDTSC. There is also RDTSCP, a variant that includes its own serialising behaviour.

### In Go

Go's `time.Now()` does not use RDTSC by default; it calls the OS clock_gettime. On Linux it uses VDSO (virtual dynamic shared object) for low-overhead clock reading. The VDSO implementation may use RDTSC internally with proper fencing — this is handled by the kernel/VDSO, not by Go.

If you absolutely need cycle-accurate timing in Go, you'd need cgo + inline assembly, or `runtime.nanotime()` (internal, not exported).

---

## Fence-Free Fast Paths

A well-designed lock-free algorithm can sometimes execute its fast path with zero barriers. The trick is data dependency.

### Example: per-CPU counter read

```go
func (c *PerCPUCounter) Sum() int64 {
    var total int64
    for i := range c.counters {
        total += c.counters[i].n.Load() // each is an atomic load
    }
    return total
}
```

Each load is an acquire-load (LDARW on arm64, plain MOV on amd64). The sum is non-atomic (we don't need the result to be consistent with any particular instant; we accept the eventual consistency).

On amd64 this is *literally* a loop of plain MOVQ instructions — zero fences. On arm64 it's LDARWs, which have a small overhead per load but no separate fence.

### Example: reading an `atomic.Pointer[T]` snapshot

```go
type Snapshot struct {
    Counters []int64
    Total    int64
    UpdatedAt time.Time
}

var snap atomic.Pointer[Snapshot]

func Read() *Snapshot {
    return snap.Load()
}
```

Reading the snapshot is one atomic load. On amd64: one MOVQ. On arm64: one LDAR. That's the entire read path. The fields of the Snapshot are accessed via plain reads — they don't need to be atomic because the Snapshot is immutable after publication.

This is the read-side magic of Go-flavoured RCU.

### Example: sequence lock optimistic read

```go
func (s *SeqLock[T]) ReadOptimistic() (T, bool) {
    seq1 := s.seq.Load()
    if seq1%2 != 0 {
        var zero T
        return zero, false // writer in progress
    }
    v := s.value
    seq2 := s.seq.Load()
    if seq1 == seq2 {
        return v, true
    }
    var zero T
    return zero, false
}
```

The optimistic path takes two atomic loads. If the sequence matches, the read is consistent. If not, the caller can fall back to a full lock. Two atomic loads is cheap; no full barrier.

### When fence-free is right

When you have read-mostly workloads, where contention is low, or where the algorithm has natural sync points (e.g. epoch boundaries). Don't try to make every algorithm fence-free; sometimes you need the barrier.

---

## Formal Verification with Herd7 and Cat Models

For the most subtle algorithms, you need formal verification. Herd7 from the diy7 suite is the standard tool. It interprets *litmus tests* against *cat memory models*.

### Cat models

A cat (Catalan) memory model defines a memory model in terms of relations on operations. For example, the *po* (program order) relation, the *rf* (reads-from) relation, the *co* (coherence order) relation. Constraints among these relations define which executions are allowed.

The ARMv8 cat model is about 200 lines. The x86-TSO cat model is about 50 lines. POWER is about 300 lines. RISC-V is about 150.

### Writing a litmus test

```
ARM SB
{ x = 0; y = 0; }
P0 | P1 ;
MOV W1, #1 | MOV W1, #1 ;
STR W1, [X3] | STR W1, [X4] ;
LDR W2, [X4] | LDR W2, [X3] ;
exists (P0:W2 = 0 /\ P1:W2 = 0)
```

The "exists" clause says "does there exist an execution where both loads see 0?" Herd7 checks all permitted executions and reports whether the predicate is satisfiable.

### Running Herd7

```
herd7 -model arm8.cat sb.litmus
```

For ARM8, the answer for SB is "Allowed" (the bad outcome can happen). For x86-TSO, the same test against the TSO cat is also Allowed. For SC, it would be Forbidden.

### Diy7

The diy7 tool generates litmus tests programmatically. You can ask "give me all litmus tests with X stores, Y loads, that distinguish ARMv8 from POWER" and it will generate them. Useful for stress-testing memory model implementations.

### Verifying Go code

Go's memory model has no official cat model yet, but informal reasoning + ARMv8 cat (since Go's atomics are SC over ARMv8's weaker hardware) is a reasonable proxy.

---

## Designing for a Specific Microarchitecture

Sometimes you need every cycle. Tips for hand-tuning concurrent code to a specific microarchitecture:

### Identify the bottleneck

Profile with `perf` or `pprof`. Common bottlenecks:
- Cache misses (high `mem_load_retired.l3_miss`).
- Memory order violations (high `machine_clears.memory_ordering`).
- Branch mispredictions (high `branch_misses`).
- Store buffer stalls (high `cycles_stalled_*`).

### Align hot data to cache lines

`runtime/internal/sys.CacheLinePadSize` is 64 on most platforms. Pad hot atomics so each fits on one line.

### Avoid 4K aliasing

Two cache lines that differ only in the upper bits (i.e. aliased in the L1 cache's index function) can cause spurious conflicts. The L1 index function uses bits ~6-12 of the address; aliasing at offset 4096 is common. Profile to detect.

### Use prefetch hints

`runtime/internal/sys.Prefetch(addr)` (internal) issues a prefetch hint. Useful in hot loops that traverse data in a predictable pattern. The compiler doesn't automatically prefetch.

### Use LSE on arm64

Set `GOARM64=v8.1` (or higher) to enable LSE atomics at compile time. The runtime detects at startup, but the compiler can also emit LSE directly if you specify a higher baseline.

### NUMA awareness

For multi-socket servers, use `numactl` to pin Go processes to a specific NUMA node. Within Go, `runtime.LockOSThread` + NUMA pinning can keep per-CPU shards on the right node.

---

## The Go Runtime's Most Subtle Barrier Uses

Some of the deepest barrier code in Go is in the scheduler.

### `findRunnable` and the global runq

`runtime.findRunnable` looks for work for the current P (processor). It checks:
1. Its local runq.
2. The global runq (under a mutex).
3. Network poller readiness.
4. Other Ps' runqs (work-stealing via atomic CAS).
5. The GC's mark queues.

Each of these involves careful memory ordering. The local runq's head/tail are atomic. Work-stealing uses CAS on the victim P's runq. The global runq is protected by `sched.lock`.

### `runqsteal`

Work-stealing in Go: take half of a victim P's local runq. The implementation in `runtime/proc.go` uses CAS on the victim's head, copying tasks to the stealer's queue. The memory ordering ensures the stolen tasks are visible to the stealer before they begin running.

### `goready` and the runqput fast path

`goready(g)` puts a goroutine into the local runq. The fast path is a few atomic ops on the head/tail; the slow path goes through the global runq.

### GC mark queues

The garbage collector maintains per-P mark queues. Each P pushes/pops gray objects atomically. Cross-P stealing uses CAS. The barriers ensure objects are scanned consistently.

### Mutex `state` field

`sync.Mutex.state` is a single int32 packed with multiple fields. Each transition is a CAS that atomically modifies all the bits. The complexity is dazzling; read `src/sync/mutex.go` carefully.

---

## GC Write Barriers vs Memory Barriers

A frequent source of confusion. The Go runtime has *both* kinds of "write barrier":

### Memory barrier (what we have been discussing)

A CPU instruction that prevents memory reordering. `MFENCE`, `DMB ISH`, etc.

### GC write barrier

A *software* mechanism inserted by the compiler around pointer writes during concurrent GC. It is a Go function call (or inline code) that records the write so the GC can find the new pointer during marking.

The two are unrelated. The GC write barrier exists for *garbage collection correctness* (avoiding missing pointers during concurrent marking). The memory barrier exists for *memory ordering correctness* (avoiding stale reads across threads).

The GC write barrier in Go is implemented in `runtime/mwbbuf.go`, `runtime/mbarrier.go`. It is dispatched via the compiler's pointer-write detection.

The memory barrier is implemented in `runtime/internal/atomic/*.s`.

### Interaction

Sometimes a GC write barrier *also* needs to be a memory barrier (e.g. when publishing a pointer that the GC must see). The runtime handles this by using atomic operations in the write barrier's slow path.

---

## Stack Scanning and Memory Ordering

When the GC scans goroutine stacks for live pointers, it must read the stack's contents. The goroutine being scanned might be running, paused, or suspended. The scanner uses several techniques:

1. **Stop-the-world (rare):** all goroutines are paused. No memory ordering issue.
2. **Cooperative preemption:** the running goroutine reaches a safe-point (function preamble, channel op, etc.) and stops itself. Then the scanner runs.
3. **Asynchronous preemption:** the runtime sends a signal that the goroutine handles, parking itself at a safe point. The scanner then reads the stack.

For (2) and (3), the scanner must see the goroutine's stack writes in the correct order. The synchronisation between the goroutine and the scanner is via atomic operations on the goroutine's `g.atomicstatus` field — a state machine implemented with CAS.

This is one of the most intricate concurrent algorithms in the Go runtime. Read `runtime/preempt.go` for details.

---

## Cross-Language ABI Considerations

When Go interoperates with C (cgo) or other languages, memory ordering rules must be reconciled.

### CGo

The C compiler may emit different barriers than the Go compiler. If you share memory between Go and C, the safest approach is:
- Use Go's `sync/atomic` for shared variables accessed from Go.
- Use C11 `_Atomic` (or `stdatomic.h`) on the C side.
- The C and Go atomic types should match in size and alignment.

In practice, cgo programs often use mutexes or message-passing instead of shared atomics. The marshalling cost of cgo calls is high (~200 ns per call), so shared atomics rarely matter.

### Rust

Rust's `std::sync::atomic` exposes `Ordering::Relaxed/Acquire/Release/AcqRel/SeqCst`. Go's atomics are all SeqCst. So Rust code can use a subset of Go's atomic semantics; Go code can't use Rust's relaxed mode without dropping into assembly.

### Java

Java's `volatile` is SeqCst. Java's `java.util.concurrent.atomic.*` types are similar to Go's `sync/atomic`. Direct equivalence.

### C++

C++11's `std::atomic<T>` with `memory_order_seq_cst` matches Go's `sync/atomic`. C++'s relaxed orderings have no Go equivalent.

---

## SIMD and Vector Memory Ordering

SIMD instructions (SSE, AVX, NEON, SVE) operate on wide registers. Memory ordering for SIMD loads/stores follows the same rules as scalar:
- Plain SIMD load on x86: ordered like scalar MOV.
- Plain SIMD store on x86: ordered like scalar MOV.
- Non-temporal SIMD store: weakly ordered; needs SFENCE.
- Aligned vs unaligned: irrelevant for ordering, matters for performance.

Go's compiler does not auto-vectorise except in a few cases. SIMD in Go is typically done via cgo or hand-written assembly. The atomic SIMD intrinsics (e.g. AVX-512's atomic vector ops) are not exposed in Go.

---

## Transactional Memory and Barriers

Intel TSX (Transactional Synchronization Extensions) and ARM TME (Transactional Memory Extension) provide hardware transactions: a block of code executes atomically as if under a global lock, with abort-on-conflict.

### TSX/TME barriers

A transaction implicitly forms a memory barrier: all memory operations within the transaction are ordered with respect to operations outside it. There is no separate fence inside a transaction.

### Go and TSX

Go does not expose TSX. The runtime team has experimented with using TSX for lock elision in `sync.Mutex`, but the current Go runtime does not include this.

Intel disabled TSX on most consumer chips (after CVE-2018-3640 / Spectre-class issues). It remains on some server SKUs.

ARM TME is shipping in some Neoverse cores but not widely used.

### When transactions are useful

Hot-contention paths where lock elision wins. Not generally useful in Go because the runtime doesn't support it.

---

## Persistent Memory Barriers

Persistent memory (Optane DC PMM, NVDIMM, CXL.mem with persistence) introduces new barriers.

### CLFLUSHOPT, CLWB, CLFLUSH

- `CLFLUSH addr` — flush cache line to memory; serializing.
- `CLFLUSHOPT addr` — like CLFLUSH but unordered with respect to other CLFLUSHOPTs.
- `CLWB addr` — write-back without invalidating (keep the line in cache).

After a flush, the data is in memory; for persistence, it must reach the durability domain (memory controller's write-pending queue or platform-equivalent).

### PCOMMIT (deprecated)

Originally `PCOMMIT` would commit pending writes to persistent memory. Intel deprecated it; modern persistent memory CPUs commit at the memory controller.

### Programming for persistence

```c
__atomic_store_n(&log->next_seq, new_seq, __ATOMIC_RELEASE); // publish
asm volatile("clwb %0" :: "m"(*log));                       // flush
asm volatile("sfence" ::: "memory");                         // ensure ordering
```

After this sequence, the new sequence number is durably persisted. Power loss won't lose it.

### Go and persistent memory

Go does not have first-class persistent memory support. Libraries like pmem.io provide C bindings; you'd cgo into them. Not a typical Go problem.

---

## Coding Patterns

### Lock elision (manual)

Try a CAS first; if it fails, fall back to a mutex.

```go
func (s *Stack) Push(v int) {
    head := s.head.Load()
    n := &node{val: v, next: head}
    if s.head.CompareAndSwap(head, n) {
        return
    }
    s.fallbackMu.Lock()
    n.next = s.head.Load()
    s.head.Store(n)
    s.fallbackMu.Unlock()
}
```

### Wait-free read of a snapshot

`atomic.Pointer[Snapshot]` + immutable Snapshot. Reads are wait-free.

### Lock-free MPSC queue with linked list

Used by Go's `runtime.netpoll` and many internal subsystems. Each producer atomically swaps the tail; the consumer reads the head, etc.

---

## Clean Code

- Document every barrier with a comment naming the litmus test or invariant.
- Cite published algorithms.
- Test with chaos: race detector, stress tests, multiple architectures.
- For very critical code, write a Herd7 litmus test alongside.

---

## Performance Tips

- Profile with `perf` for hardware counters.
- Use `pprof` for goroutine profiles, memory profiles.
- Reduce per-iteration barriers in hot loops by batching.
- Pad atomics, period.
- Test on real hardware, not VMs (VMs may emulate barriers differently).

---

## Best Practices

1. Always prefer high-level primitives (mutex, channel) until profiling.
2. Use typed atomics.
3. Document barrier intent.
4. Run race detector on every PR.
5. Verify with Herd7 for critical paths.
6. Test on every target architecture.

---

## Edge Cases and Pitfalls

### Pitfall: TSO replays in tight loops

A spin lock with `CompareAndSwap` repeatedly: each failed CAS may trigger an order-violation replay. Profile with `perf stat -e machine_clears.memory_ordering`. Mitigation: exponential backoff, or use `runtime.Gosched()`.

### Pitfall: VDSO clocks vs RDTSC

`time.Now()` uses VDSO, which is fast but may have ~1-10 ns jitter. For sub-nanosecond timing, RDTSC + LFENCE in assembly is needed.

### Pitfall: cgo and Go atomic interop

If C code reads a Go atomic, the C code must use compatible barriers. C11 `_Atomic` is compatible with Go's `sync/atomic`. Plain C `volatile` is not.

### Pitfall: weak isolation in transactional memory

Even with TSX, code outside a transaction can race with code inside. Wrap all accesses in transactions or you lose the benefit.

---

## Common Mistakes

- Confusing GC write barrier with memory barrier.
- Using RDTSC without LFENCE.
- Mixing CGo atomics with Go atomics carelessly.
- Skipping Herd7 verification for novel algorithms.

---

## Common Misconceptions

- "TSX is fast." It is, when not contended; under contention, aborts cascade.
- "Persistent memory is just slow RAM." It has very different ordering and durability semantics.
- "SIMD changes memory ordering." It doesn't; the rules are the same.

---

## Tricky Points

### Tricky 1: ARM "load-acquire" doesn't fully prevent reordering with subsequent stores

`LDAR` is acquire — no later operations can be reordered before it. But on certain ARM cores, two stores after `LDAR` can be reordered with each other (the acquire only orders them with respect to the `LDAR`, not with respect to each other). Use a `DMB ISHST` if you need StoreStore between them.

### Tricky 2: x86 `MOVZX` and atomicity

`MOVZX` (zero-extend move) is a single instruction; it's atomic. But it's not magical: only naturally-aligned, word-sized accesses are guaranteed atomic. Misaligned `MOVZX` can tear across cache lines.

### Tricky 3: POWER `eieio` for MMIO

`eieio` orders MMIO accesses on POWER. Not relevant for Go code that doesn't touch hardware directly.

### Tricky 4: AMD vs Intel memory models

Both are TSO. But microarchitectural details differ: AMD's `LFENCE` is not serialising by default; AMD's `LOCK MOV` is documented slightly differently. For portability, use `sync/atomic` and trust the runtime.

### Tricky 5: M1 Rosetta and TSO emulation

Apple's Rosetta 2 emulates x86-64 on Apple Silicon. To maintain x86 semantics, Apple's CPUs have a TSO mode that Rosetta enables. Native ARM64 code runs under the normal weak model. This means a Go program built for darwin/arm64 vs darwin/amd64 sees different memory semantics on the same machine.

---

## Test

### Test 1: TSO replay

When does a TSO replay happen?
**A:** When a speculatively-completed load's address is invalidated by another core's store before the load retires. The MOB squashes and replays.

### Test 2: Persistent memory flush

What's the difference between `CLFLUSH` and `CLFLUSHOPT`?
**A:** `CLFLUSH` is serializing (orders with respect to other memory ops); `CLFLUSHOPT` is unordered with other `CLFLUSHOPT`s, requiring an `SFENCE` for ordering. `CLFLUSHOPT` is faster for bulk flushes.

### Test 3: GC write barrier vs memory barrier

Are they the same?
**A:** No. GC write barrier records pointer writes for the concurrent collector; memory barrier orders memory operations across cores. Unrelated concerns; both exist in the Go runtime.

### Test 4: Fence-free fast path

How do you design a read-mostly structure with zero barriers on the read path on x86?
**A:** Use `atomic.Pointer[T]` for the published structure. On x86, `atomic.Pointer.Load` compiles to a plain MOV — no fence. The pointed-to structure is immutable after publication.

---

## Cheat Sheet

```
PROFESSIONAL CHEAT SHEET
========================

Microarch buffers
  Intel MOB: load buffer, store buffer, MO detector
  ARM LSQ: load queue, store queue
  TSO replay: snoop invalidates speculative load → squash + replay

Speculation barriers
  LFENCE: Spectre mitigation on Intel
  CSDB / SSBB: ARM alternatives
  IBRS / IBPB: branch prediction barriers

Non-temporal stores
  MOVNT* — bypass cache, write to memory via WC buffer
  SFENCE needed to order them

Timing
  RDTSC — non-serialising
  LFENCE + RDTSC or RDTSCP for ordered timing

Persistent memory
  CLFLUSH (slow, serializing)
  CLFLUSHOPT (fast, unordered)
  CLWB (write-back, keep in cache)
  SFENCE after flushes

GC write barrier ≠ memory barrier

Lock elision
  TSX/TME (rarely used in Go)
  Manual: try CAS, fall back to mutex
```

---

## Self-Assessment Checklist

- [ ] I can trace a load through the MOB from issue to retire.
- [ ] I can describe when TSO replays happen and how to detect them.
- [ ] I can implement a fence-free read fast path.
- [ ] I can verify a memory-ordering invariant in Herd7.
- [ ] I can read and explain `runtime/proc.go`'s work-stealing code.
- [ ] I understand the difference between GC and memory write barriers.
- [ ] I can program persistent memory with the correct barriers.

---

## Summary

The professional level requires fluency with microarchitectural buffers, formal verification, persistent memory, transactional memory, and the deepest barrier code in the Go runtime. You should understand TSO replays, fence-free fast paths, and the distinction between software (GC) and hardware (memory) write barriers.

This is the depth Go runtime contributors operate at. For 99% of Go programmers, this is overkill — but for those building highest-performance lock-free systems, it is necessary.

---

## What You Can Build

- Lock-elision schemes with hardware transaction fallback.
- Persistent-memory data structures (with cgo).
- Microarchitecture-specific lock-free queues optimised for a target CPU.
- Formal Herd7 proofs of memory ordering invariants.

---

## Further Reading

- Intel SDM Volume 3A, Chapter 8 and 11.
- Intel Optimization Manual.
- ARM ARM (Architecture Reference Manual), §B2 and §G1.
- "x86-TSO: A Rigorous and Usable Programmer's Model for x86 Multiprocessors", Sewell et al., CACM 2010.
- "A Tutorial Introduction to the ARM and POWER Relaxed Memory Models", Maranget, Sarkar, Sewell.
- "Persistent Memory Programming", Intel.
- The diy7 / Herd7 documentation.

---

## Related Topics

- [Senior file](senior.md) — memory model spectrum, RVWMO, MPMC queue.
- The Go runtime source: `src/runtime/`.
- Formal verification tools: Herd7, Coq's mechanised memory models.
- Persistent memory: pmem.io, PMDK.
