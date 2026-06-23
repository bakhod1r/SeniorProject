---
layout: default
title: Hardware Barriers — Interview
parent: Hardware Barriers
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/01-hardware-barriers/interview/
---

# Hardware Memory Barriers — Interview Questions

> Practice questions from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is a memory barrier?

**Model answer.** A memory barrier is a CPU instruction that prevents memory operations from being reordered across it. Without a barrier, the CPU may reorder loads and stores for performance; this reordering can break the assumptions of concurrent code. Common x86 barriers are MFENCE, LFENCE, SFENCE, and any LOCK-prefixed instruction. Common ARM barriers are DMB, DSB, and ISB.

**Common wrong answers.**
- "It's a software lock." (No — it's a CPU instruction, no kernel involvement.)
- "It makes a memory operation atomic." (Atomicity is separate; a fence orders, it doesn't atomicise.)

**Follow-up.** *How does Go expose memory barriers?* Through `sync/atomic`; you never write barriers directly.

---

### Q2. What are the four reorderings?

**Model answer.** LoadLoad, LoadStore, StoreStore, and StoreLoad. They describe whether an operation of one type can be reordered with a subsequent operation of another type.

**Follow-up.** *Which does x86-TSO permit?* Only StoreLoad. *Which does ARMv8 permit?* All four by default.

---

### Q3. What is the store buffer?

**Model answer.** A small FIFO inside each CPU core that holds stores that have not yet been written to the cache. It lets stores complete from the core's perspective immediately, so the pipeline doesn't stall. The downside: other cores can't see the store until it drains. This is why x86-TSO permits StoreLoad reordering.

---

### Q4. What does `MFENCE` do?

**Model answer.** It drains the store buffer of the issuing core, ordering all loads and stores on both sides of the fence. After MFENCE, the next memory operation sees a globally consistent view of memory.

**Follow-up.** *When does Go emit MFENCE?* Rarely in modern Go. The runtime uses XCHG (with implicit LOCK) or LOCK-prefixed RMW for full barriers, which is slightly cheaper.

---

### Q5. What does `LOCK XADD` do?

**Model answer.** Atomically: load the value from memory, add the register's value, store the result back. The LOCK prefix makes the entire RMW atomic and acts as a full memory barrier. Go uses LOCK XADD to implement `atomic.AddInt64`.

---

### Q6. Why does Go's `sync/atomic.Store` use XCHG instead of MOV on amd64?

**Model answer.** Because Go's `atomic.Store` provides full sequentially-consistent semantics on every platform. On x86, a plain MOV has release semantics for free but does NOT order with later loads to a different address (StoreLoad reordering). XCHG, with its implicit LOCK prefix, is a full barrier and prevents this reordering in a single instruction — slightly cheaper than MOV + MFENCE.

---

### Q7. What is acquire/release semantics?

**Model answer.** Acquire is a property of a load: no later operation can be reordered before it. Release is a property of a store: no earlier operation can be reordered after it. Together, a release-store paired with an acquire-load creates a happens-before edge: everything the writer did before the release is visible to the reader after the acquire.

---

### Q8. Why is "it works on my x86 laptop" not enough?

**Model answer.** x86-TSO forbids most reorderings; ARMv8 permits all four. Code that relies on x86's strong ordering can break on ARM servers. Always test on at least one weakly-ordered architecture.

---

### Q9. What does the race detector catch?

**Model answer.** Concurrent accesses to the same memory where at least one is a write and there is no synchronisation edge between them. It instruments every load/store and builds a vector clock per goroutine. It catches missing synchronization — including missing atomic ops — but only along the paths exercised by your tests.

---

### Q10. What is false sharing?

**Model answer.** When two goroutines update different variables that happen to live on the same 64-byte cache line. Every update invalidates the line on the other core, causing a coherence ping-pong. The fix is to pad hot atomics so they live on separate cache lines.

---

## Middle

### Q11. Walk me through what `atomic.AddInt64(&n, 1)` does on amd64.

**Model answer.** The compiler emits `MOVQ $1, AX; LOCK XADDQ AX, (BX); ADDQ $1, AX`. The LOCK XADDQ atomically adds 1 to memory and returns the old value in AX. The final ADDQ computes the new value (old + 1) for return. The LOCK prefix is a full memory barrier: it drains the store buffer and ensures the operation is globally visible before continuing.

---

### Q12. What about on arm64?

**Model answer.** On LSE-capable hardware (ARMv8.1+): `LDADDAL R1, R2, (R0)` — single instruction atomic add with both acquire and release semantics. On pre-LSE hardware: a LDAXR / ADD / STLXR / CBNZ loop. Go detects LSE at startup and chooses dynamically.

---

### Q13. Explain x86-TSO formally.

**Model answer.** TSO is defined by axioms: (1) stores from one core are globally ordered (no StoreStore reordering); (2) a core sees its own stores via store-to-load forwarding; (3) other cores see stores only after they drain from the issuing core's store buffer; (4) LOCK and MFENCE drain the buffer; (5) loads from a single core appear in program order globally. The only reordering allowed at the global level is StoreLoad: a store followed by a load to a different address may appear reordered.

---

### Q14. What is multi-copy atomicity?

**Model answer.** A memory model is multi-copy atomic if all observers agree on the order of stores to different locations. ARMv8, RISC-V WMO, and x86-TSO are multi-copy atomic. POWER is not — different cores can see writes in different orders. Non-multi-copy-atomic models need heavier fences (POWER's `sync`) for IRIW-style patterns.

---

### Q15. What is the IRIW litmus test?

**Model answer.** Two independent producers each write a variable; two independent observers each read both variables. If the observers can disagree on the order of the two writes, the model is not multi-copy atomic. The bad outcome: observer 1 sees X first, observer 2 sees Y first. POWER allows this; ARMv8 and x86-TSO forbid it.

---

### Q16. What is a sequence lock?

**Model answer.** A synchronisation primitive popularised by the Linux kernel for read-mostly state. Writers increment a sequence number to odd before writing and back to even after. Readers read the seq, the data, and the seq again; if both seq reads match and are even, the read is consistent. Otherwise retry. Allows many concurrent readers with no locking, at the cost of writer-on-reader contention.

---

### Q17. What is the Vyukov MPMC queue?

**Model answer.** A bounded, lock-free multi-producer, multi-consumer queue using a sequence number per cell. Each cell's seq tracks where it is in the queue's "round." Producers CAS the head and write when seq matches. Consumers CAS the tail and read when seq matches the next value. The acquire/release on the cell's seq synchronises the value write with the consumer's read.

---

### Q18. Why does `atomic.Pointer[T]` work for "publish a snapshot" patterns?

**Model answer.** The store has release semantics — everything the writer wrote into *T before publishing is visible to readers after the acquire-load. The pointed-to data must be immutable after publication. Readers do a single atomic load and then traverse the snapshot with plain reads. The pattern is Go-flavored RCU.

---

### Q19. What is the difference between `Store` and `StoreRel` in `runtime/internal/atomic`?

**Model answer.** `Store` is sequentially consistent: emits XCHG on amd64, STLR on arm64. `StoreRel` is release-only: emits plain MOV on amd64 (free release), STLR on arm64 (same). On x86, `StoreRel` is strictly cheaper because it skips the full barrier. The runtime uses `StoreRel` in places where it only needs release ordering. User code can't access `StoreRel` (it's in `internal/`).

---

### Q20. What is the Linux kernel's `smp_load_acquire`?

**Model answer.** A macro that performs an acquire-load. On x86: plain MOV (free acquire). On arm64: LDAR. On RISC-V: load + `fence r, rw`. Equivalent to Go's `atomic.Load` semantically, though Go's version is also full SC due to multi-copy atomicity in the target architectures.

---

## Senior

### Q21. Compare TSO, ARMv8-RC, and POWER. Which needs the heaviest fences?

**Model answer.** POWER is heaviest. It is not multi-copy atomic, so IRIW-style patterns need `sync` (the heavy fence). ARMv8 is multi-copy atomic and has cheap single-instruction acquire/release loads/stores (LDAR/STLR), so its fences are mid-weight. TSO is lightest — most reorderings are already forbidden by hardware, so user code rarely needs explicit fences (only for the StoreLoad case).

---

### Q22. What is the RISC-V `FENCE rw, w` instruction?

**Model answer.** A fence that orders prior reads and writes with subsequent writes. It is a release fence: anything that came before is observable before anything written after. Equivalent to ARM's `DMB ISHST` plus a release ordering, or x86's "release" portion of an XCHG.

---

### Q23. Describe MESI cache coherence.

**Model answer.** Each cache line is in one of four states: Modified (this core has the only dirty copy), Exclusive (this core has the only clean copy), Shared (multiple cores have clean copies), Invalid (no valid copy). Reads and writes trigger transitions; remote snoops cause invalidations or supplies. MESI guarantees coherence (single value per address) but not memory ordering (which is a separate concern).

---

### Q24. What's the difference between MESI and MOESI?

**Model answer.** MOESI adds an Owned state: a line that is modified but shared with other cores. The owner is responsible for supplying it on snoop; it doesn't need to write back to memory. Reduces memory bandwidth in workloads where shared dirty data is read by many cores. AMD's Zen cores use MOESI; Intel's use MESI/MESIF.

---

### Q25. Explain hazard pointers.

**Model answer.** A technique for safe memory reclamation in lock-free data structures (in non-GC languages). Each thread maintains pointers to nodes it is currently accessing. Before freeing a node, the freer scans every thread's hazard pointers; if any point to the node, defer freeing. Pros: precise; only delays freeing for actively-referenced nodes. Cons: O(N_threads) cost per access. In Go, the GC handles this automatically — no hazard pointers needed.

---

### Q26. Explain epoch-based reclamation.

**Model answer.** Time is divided into epochs. Threads announce their current epoch. To free a node, you wait until every thread has advanced past the epoch in which the node was retired. Cheaper per-access than hazard pointers (just a load and increment) but with bulk-frees and indefinite delays if a thread is stalled. In Go: again, GC handles it.

---

### Q27. What is RCU?

**Model answer.** Read-Copy-Update: a Linux kernel technique for read-mostly data structures. Readers traverse without locks. Writers create a new copy, modify, and atomically swap the pointer. After swap, the old structure is dead but readers may still hold pointers; wait for a "grace period" before freeing. In Go: `atomic.Pointer[T]` + immutable data is the Go equivalent; the GC replaces grace-period detection.

---

### Q28. What is Herd7?

**Model answer.** A formal verification tool from the diy7 suite. It interprets *litmus tests* (small programs in assembly-like syntax with an existential predicate) against *cat memory models* (formal specifications of memory ordering as relations between operations). For each litmus test, Herd7 enumerates all executions allowed by the model and reports whether the predicate is satisfiable. Used to verify lock-free algorithms against specific memory models.

---

### Q29. Why doesn't Go have relaxed atomics?

**Model answer.** Design choice: simplicity over expressiveness. The Go team chose full SC for `sync/atomic` to (1) simplify the API surface; (2) reduce the risk of subtle bugs from relaxed orderings; (3) align with Java's `volatile` semantics that many programmers already understand. The performance cost is small on TSO (x86) and modest on ARM (LDAR/STLR are not much slower than LDR/STR). Power-users can write inline assembly via `.s` files if absolutely needed.

---

### Q30. How does Go's scheduler use atomics?

**Model answer.** Heavily. Each P has a local run queue with atomic head/tail. Work-stealing uses CAS on the victim's runq. The global runq is mutex-protected, but accesses to it are atomic for visibility. The G/M/P state machine transitions are CAS-driven. The GC's mark queues are atomic. Without these, the scheduler couldn't be lock-free in its fast paths.

---

## Staff

### Q31. Walk me through a TSO replay.

**Model answer.** Core A executes a load to address X speculatively, completing it from its cache. Meanwhile, Core B writes X (invalidating A's copy). The invalidation arrives at A after A's load completes but before the load retires. A's MOB detects the conflict: a load returned a value, but the address was invalidated mid-execution. The MOB squashes the load and every younger instruction, then replays them. The replay sees the new value.

---

### Q32. Why is `LFENCE` Spectre-relevant?

**Model answer.** Intel re-documented `LFENCE` post-Spectre as a serialising instruction: it blocks speculative execution past it. This is used to insert a barrier between a bounds check and the indexed access, preventing speculative out-of-bounds reads that could leak via cache timing. Before Spectre, LFENCE was mostly used for ordering non-temporal loads (a rare need).

---

### Q33. Design a fence-free fast path for a read-mostly structure.

**Model answer.** Use `atomic.Pointer[T]` for the published structure; the structure is immutable after publication. Readers do one atomic load and then traverse with plain reads. On x86, `atomic.Pointer.Load` compiles to a plain MOV — zero fences on the read path. On arm64, it's an LDAR — one acquire-load. Writers create a new instance, populate it, and call `atomic.Pointer.Store` to publish. The GC handles old-instance reclamation.

---

### Q34. What is non-temporal memory and how does Go interact with it?

**Model answer.** Non-temporal memory access uses streaming stores (MOVNT*) that bypass the cache and write through a write-combining buffer. Used for bulk copies that would pollute the cache. Go's runtime uses non-temporal stores in `memmove` for large blocks. They need SFENCE for ordering with normal stores. From user code, you'd reach for them only in cgo for very specific bulk-copy scenarios.

---

### Q35. Compare Go's atomics to C++'s.

**Model answer.** Go provides only sequentially-consistent atomic operations (`memory_order_seq_cst` in C++ terms). C++ provides the full spectrum: relaxed, consume, acquire, release, acq_rel, seq_cst. Go's choice trades expressiveness for safety and simplicity. For 99% of code this is fine; for very hot lock-free paths C++ may eke out 10-30% more performance via relaxed ordering. Go's runtime (in `runtime/internal/atomic`) exposes finer-grained primitives but only to itself.

---

### Q36. Why does the Go runtime use a global lock for the global run queue but lock-free for local run queues?

**Model answer.** Local run queues are mostly single-producer (the owning P pushes), single-consumer (the owning P pops); steals from other Ps are rare and use CAS. The contention is low, so lock-free is cheap and fast. The global run queue is multi-producer, multi-consumer with potentially heavy contention; a well-tuned mutex is simpler and avoids livelock pathologies that pure lock-free designs can suffer.

---

### Q37. Describe the interaction between Go's GC and memory barriers.

**Model answer.** Two separate concepts. GC write barriers (in `runtime/mwbbuf.go`) are software hooks that record pointer writes for the concurrent collector — they ensure the GC can find new pointers during marking. Memory barriers (in `runtime/internal/atomic/*.s`) are CPU instructions that order memory operations across cores. They intersect when the GC publishes pointers (e.g. in the mark queue, in stack scanning), where the GC write barrier's slow path uses atomic operations that double as memory barriers.

---

### Q38. How would you verify a new lock-free algorithm for correctness?

**Model answer.** (1) Write the algorithm in pseudo-code with explicit happens-before claims. (2) Implement it; run `-race` on tests. (3) Stress-test with `GOMAXPROCS` set to various values, on both x86 and arm64. (4) Write a Herd7 litmus test for each critical sequence; run against ARMv8 and x86-TSO cat models. (5) Compare to published designs; cite prior art. (6) If any of these fail, refine. The combination of empirical testing, formal verification, and citation is how production code earns trust.

---

### Q39. You see `machine_clears.memory_ordering` very high in `perf`. What's happening?

**Model answer.** TSO replays. The CPU is speculating loads aggressively and frequently encountering invalidations that force squash + replay. Causes: heavy contention on a shared cache line (e.g. a lock variable, a counter). Mitigations: per-CPU sharding, reducing barrier density, padding hot atomics, switching to a less-contended algorithm.

---

### Q40. Explain how `sync.Once` is implemented and why it's correct.

**Model answer.** `sync.Once` has a `done` atomic flag (uint32) and a `Mutex`. Fast path: `atomic.LoadUint32(&o.done)` — if 1, return immediately. Slow path: acquire mutex, double-check `done`, run the closure, set `done` to 1 atomically, release mutex. The atomic load (acquire) on the fast path synchronises with the atomic store (release) on the slow path — so any goroutine that observes `done == 1` is guaranteed to see the closure's side effects via the happens-before edge.

---

That is forty questions across all levels. Use them as flashcards, as discussion prompts, or as a self-test before an interview. Each model answer should be deliverable in 1-3 minutes; longer answers indicate over-explanation, shorter ones may be too terse.
