# Memory Fences — Specification

## Table of Contents
1. [Go Memory Model — Authoritative Text](#go-memory-model--authoritative-text)
2. [Sequentially Consistent Atomics — The Formal Rule](#sequentially-consistent-atomics--the-formal-rule)
3. [Happens-Before Definition](#happens-before-definition)
4. [Synchronisation Primitives in the Specification](#synchronisation-primitives-in-the-specification)
5. [Hardware Memory Models Referenced by the Runtime](#hardware-memory-models-referenced-by-the-runtime)
6. [Standard References](#standard-references)
7. [Summary](#summary)

---

## Go Memory Model — Authoritative Text

The Go Memory Model is published at [https://go.dev/ref/mem](https://go.dev/ref/mem). It has been revised twice — most recently in early 2022 to clarify the seq_cst guarantee for atomics. The version relevant to Go 1.19+ is the one we cite throughout this section.

The memory model is short by design — under 5000 words — and intentionally less formal than the C++ or Java memory model documents. It defines a partial order called *happens-before* and uses it to constrain what reads may observe.

The core sentence for fences:

> The APIs in the `sync/atomic` package are collectively "atomic operations" that can be used to synchronize the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B. All the atomic operations executed in a program behave as though executed in some sequentially consistent order.

Three properties follow:

1. **Atomic synchronizes-before atomic.** Synchronisation is via observation.
2. **All atomics share one global order.** This is sequential consistency.
3. **Implicit fences.** Atomics carry the fence needed to participate in this global order.

---

## Sequentially Consistent Atomics — The Formal Rule

Lamport (1979) defined sequential consistency as follows:

> The result of any execution is the same as if the operations of all the processors were executed in some sequential order, and the operations of each individual processor appear in this sequence in the order specified by its program.

Applied to Go atomics:

- Take every `sync/atomic` operation in the program from every goroutine.
- They participate in one total order `<` (the "atomic order").
- For each goroutine, its atomic operations appear in `<` in program order.
- Every read sees the value written by the most recent write to the same location in `<`.

This is the strongest memory ordering definable. Go does not provide weaker orderings (relaxed, acquire-only, release-only). Every atomic is at this seq_cst level.

### What this excludes

- The IRIW (Independent Reads of Independent Writes) anomaly. Two readers cannot disagree about the order of two atomic writes.
- The store-buffer reorder visible from two atomics. A store followed by a load to different atomic variables on the same goroutine cannot be reordered.
- Out-of-thin-air values. No atomic read may return a value never written.

### What this does NOT cover

The seq_cst guarantee applies only to atomic operations. Non-atomic memory accesses participate in happens-before via atomics, mutexes, channels, and goroutine creation — but they are not themselves part of the sequential order.

If you have a non-atomic write to `x` followed by an atomic store, and another goroutine does an atomic load and reads `x`, the non-atomic write is visible because the atomic store carries the release fence and the atomic load carries the acquire fence. The non-atomic operations are pulled into the partial order via the fences.

If two goroutines do non-atomic writes to the same location without intervening synchronisation, the behaviour is undefined — a data race.

---

## Happens-Before Definition

The memory model defines happens-before as the smallest partial order satisfying:

1. **Program order.** Within one goroutine, operation A precedes operation B in source order means A happens-before B.
2. **Goroutine creation.** The `go` statement that starts a goroutine happens-before the first statement of the new goroutine.
3. **Goroutine completion.** The exit of a goroutine does not (specifically) happen-before any event in another goroutine, unless synchronisation propagates it.
4. **Channel operations.**
   - A send on a channel happens-before the corresponding receive.
   - The close of a channel happens-before a receive that returns zero.
   - On an unbuffered channel, the receive happens-before the send completes.
5. **Mutex.** For any `sync.Mutex` or `sync.RWMutex`, the n-th call to `Unlock` happens-before the (n+1)-th call to `Lock` returns. Similarly for RLock/Unlock pairs.
6. **Once.** Completion of `f` passed to `sync.Once.Do(f)` happens-before any other `Once.Do(f)` returns.
7. **Atomics.** As stated above — atomic operations form one seq_cst order; an atomic synchronises-before any atomic that observes it.

Happens-before is transitive: A happens-before B and B happens-before C implies A happens-before C. This is the mechanism by which a chain of atomics, mutexes, and channels carries information across a program.

### Synchronization vs sequenced-before

Some specifications distinguish "sequenced-before" (within a thread) from "synchronizes-with" (across threads), and define happens-before as the transitive closure of both. Go's model conflates them into one relation called happens-before. The simpler formulation is equivalent.

---

## Synchronisation Primitives in the Specification

The memory model gives explicit happens-before rules for the following primitives, each of which compiles to one or more fences:

| Primitive | Happens-before edge |
|---|---|
| `chan send` / `chan recv` | The k-th send completes happens-before the k-th receive completes. |
| `close(ch)` | The close happens-before any receive that returns the zero value. |
| `sync.Mutex` | The n-th `Unlock` happens-before the (n+1)-th `Lock` returns. |
| `sync.RWMutex` | The n-th `Unlock` happens-before any subsequent `RLock` returns. |
| `sync.Once` | The first `Do(f)`'s `f` completes happens-before any later `Do` returns. |
| `sync.WaitGroup` | All `Done` calls happen-before `Wait` returns. |
| `sync/atomic` | As described above. |

Each of these primitives is implemented using atomic operations internally. The atomic operations carry the fences that implement the happens-before edges the spec promises.

### Implementation references

- `runtime/chan.go` — channel implementation, atomic + mutex.
- `runtime/sema.go` — semaphore implementation underlying Mutex.Lock contention paths.
- `sync/mutex.go` — Mutex with atomic state word.
- `sync/atomic/doc.go` — public API surface; implementation in `runtime/internal/atomic`.

---

## Hardware Memory Models Referenced by the Runtime

The Go runtime is implemented in Go plus assembly. The assembly emits architecture-specific fence instructions. Each supported architecture has its own memory model that the runtime maps onto Go's seq_cst guarantee.

### x86 / x86-64 — Total Store Order

Documented in the Intel® 64 and IA-32 Architectures Software Developer's Manual, Vol. 3A, §8.2 ("Memory Ordering"). Formalised by Sewell, Sarkar, Owens, Nardelli, Myreen (2010), "x86-TSO: A Rigorous and Usable Programmer's Model for x86 Multiprocessors."

The core rules:

1. Stores from the same CPU are observed in order by all others.
2. Loads do not pass earlier loads.
3. Loads do not pass earlier stores.
4. Stores do not pass earlier stores.
5. Stores *may* pass earlier loads from different addresses — the only allowed reordering.
6. `LOCK`-prefixed instructions and `MFENCE` prevent the rule-5 reordering.

### ARM / ARM64 — weak ordering

Documented in the ARM Architecture Reference Manual, ARMv8-A, Chapter B2 ("The AArch64 Application Level Memory Model"). The model is in some places stated as a series of allowed reorderings; in others, as the absence of ordering constraints.

The principal rules:

1. Any load may be reordered with any later operation except where data dependencies forbid.
2. Any store may be reordered with any later operation.
3. Same-address operations are ordered.
4. `DMB`, `DSB`, `ISB`, `LDAR`, `STLR` provide ordering.

Apple's M1, M2, M3 implement ARMv8.4-A and follow this model for native code.

### POWER — weak ordering

Documented in the Power ISA Version 3.1 specification. POWER is one of the weakest commercial memory models.

Principal rules:

1. Stores need not be observed in the same order by different CPUs.
2. `lwsync` orders load-load, load-store, store-store (but not store-load).
3. `sync` orders everything.
4. `isync` plus a control dependency provides acquire semantics.

### RISC-V — weak ordering with explicit fences

Documented in the RISC-V Instruction Set Manual, Volume I, Chapter 14 ("RVWMO Memory Consistency Model").

The model is called RVWMO (RISC-V Weak Memory Ordering). It is similar in spirit to ARM. Fences are provided via the `fence` instruction with explicit pred/succ masks.

### MIPS — relaxed

Older MIPS hardware has very weak ordering; modern MIPS implementations vary. Go has limited MIPS support (mainly for some embedded targets); the atomic implementation uses `sync` instructions.

---

## Standard References

This is the canonical reading list for memory models and fences.

### Memory model papers

- Sewell, Sarkar, Owens, Nardelli, Myreen (2010). "x86-TSO: A Rigorous and Usable Programmer's Model for x86 Multiprocessors." *Communications of the ACM*, July 2010. The reference description of x86 behaviour.
- Adve, Boehm (2010). "Memory Models: A Case for Rethinking Parallel Languages and Hardware." *Communications of the ACM*, August 2010. The argument for language-level memory models.
- Lamport (1979). "How to Make a Multiprocessor Computer That Correctly Executes Multiprocess Programs." *IEEE Transactions on Computers*. The original sequential consistency paper.
- Boehm, Adve (2008). "Foundations of the C++ Concurrency Memory Model." *PLDI 2008*. The C++ memory model foundation.

### Language specifications

- Go Memory Model — [https://go.dev/ref/mem](https://go.dev/ref/mem)
- C++ ISO/IEC 14882:2020, §32 (atomics) and §6.9.2 (memory model).
- Java Language Specification, §17 ("Threads and Locks"). JSR-133 update.
- C11 ISO/IEC 9899:2011, §7.17 (atomics).

### Hardware manuals

- Intel® 64 and IA-32 Architectures Software Developer's Manual, Vol. 3A, §8.2 (Memory Ordering).
- ARM Architecture Reference Manual, ARMv8-A, Chapter B2 (Memory Model).
- Power ISA Version 3.1, Book II, Chapter 1 (Storage Model).
- RISC-V Instruction Set Manual, Vol. I, Chapter 14 (RVWMO).

### Books

- Sorin, Hill, Wood. *A Primer on Memory Consistency and Cache Coherence*. Morgan & Claypool (free PDF from authors). The textbook treatment.
- Herlihy, Shavit. *The Art of Multiprocessor Programming*, 2nd ed., 2020. Standard reference for concurrent algorithms.
- Drepper. *What Every Programmer Should Know About Memory*. RedHat technical paper, 2007. Long but accessible.

### Russ Cox's series

- "Hardware Memory Models" — [https://research.swtch.com/hwmm](https://research.swtch.com/hwmm)
- "Programming Language Memory Models" — [https://research.swtch.com/plmm](https://research.swtch.com/plmm)
- "Updating the Go Memory Model" — [https://research.swtch.com/gomm](https://research.swtch.com/gomm)

These three posts are the single best plain-language tour of memory models for working programmers. Cox is one of the authors of the current Go memory model wording; the posts double as design rationale.

---

## Summary

The Go Memory Model is short and intentionally so. It defines happens-before, lists the primitives that establish happens-before edges, and gives `sync/atomic` the strongest definition any specification offers — full sequential consistency, one global order shared by all goroutines. The compiler implements that guarantee by mapping each atomic operation to architecture-specific fence instructions, drawing on the underlying hardware memory models documented by Intel, ARM, IBM, and the RISC-V consortium. The reference reading list — Sewell et al. on x86 TSO, Adve and Boehm on the case for language memory models, Russ Cox's blog series on hardware and programming-language memory models — is short, finishable, and worth working through if you intend to write or review lock-free code.
