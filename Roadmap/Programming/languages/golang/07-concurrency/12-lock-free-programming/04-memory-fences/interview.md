# Memory Fences — Interview Questions

## Table of Contents
1. [Conceptual Questions](#conceptual-questions)
2. [Hardware Memory Model Questions](#hardware-memory-model-questions)
3. [Go-Specific Questions](#go-specific-questions)
4. [Cross-Language Questions](#cross-language-questions)
5. [Code Reading and Debugging](#code-reading-and-debugging)
6. [Algorithm Design](#algorithm-design)
7. [Performance Questions](#performance-questions)
8. [Senior / Architecture Questions](#senior--architecture-questions)
9. [Summary](#summary)

---

## Conceptual Questions

### Q1. What is a memory fence?

A memory fence (or memory barrier) is a CPU instruction that constrains the ordering of memory operations across it. No load or store may be reordered past the fence by either the compiler or the CPU. Fences exist because compilers and CPUs aggressively reorder memory operations for performance; without explicit fences, this reordering is visible to other threads and breaks lock-free algorithms.

### Q2. Why do compilers reorder memory operations?

To extract more performance. The compiler may move a load earlier so its result is ready when needed, or sink a store later so the data feeds the next instruction first. From the single-threaded point of view, the result is the same. From the multi-threaded point of view, another thread can see the reordered behaviour.

### Q3. Why do CPUs reorder memory operations?

To hide latency. A store may sit in the CPU's store buffer for many cycles before reaching the cache; a load may be issued speculatively before its operands are ready. Out-of-order execution and store buffers are the main mechanisms. A single thread cannot observe the reorder; another thread can.

### Q4. What is the difference between a compile-time fence and a runtime fence?

A compile-time fence prevents the compiler from reordering operations across it; a runtime fence prevents the CPU from doing the same. A correct memory fence is both — Go's `sync/atomic` calls satisfy both because the function is opaque to the compiler and the emitted instruction is a hardware fence.

### Q5. Name the four memory orderings.

Relaxed (atomic but no ordering), acquire (no later operation moves before the load), release (no earlier operation moves after the store), and sequentially consistent (full fence, single global order).

### Q6. What does it mean for an operation to act as an acquire fence?

An acquire fence on a load means: any memory operation that appears after the load in source code must execute (architecturally) after the load. Operations from before the load may freely move below. It is a one-way barrier.

### Q7. What does it mean for an operation to act as a release fence?

A release fence on a store means: any memory operation that appears before the store in source code must execute (architecturally) before the store. Operations from after the store may freely move above. It is a one-way barrier.

### Q8. What is sequential consistency, in one sentence?

All threads observe one global order of memory operations, and that order respects each thread's program order.

---

## Hardware Memory Model Questions

### Q9. Which CPU has Total Store Order? What does that mean?

x86 / x86-64. TSO permits exactly one memory reordering: a store followed by a load to a different address may be visible out of order. All other orderings (load-load, load-store, store-store) are forbidden. Sewell et al. (2010) is the formal description.

### Q10. Which CPUs have weak memory models?

ARM, ARM64, POWER, RISC-V, MIPS. They allow nearly any reordering unless explicit fence instructions forbid it.

### Q11. Name the three x86 fence instructions.

`MFENCE` (full), `LFENCE` (load fence, also a speculation barrier), `SFENCE` (store fence). The `LOCK` prefix on arithmetic and exchange instructions also acts as a full fence and is more common in practice.

### Q12. Name the three ARM barrier instructions.

`DMB` (data memory barrier), `DSB` (data synchronisation barrier — stronger, waits for completion), `ISB` (instruction synchronisation barrier — flushes pipeline). `DMB` has variants for shareable domain (`ISH`, `SY`) and direction (`ISHST`, `ISHLD`).

### Q13. What are `LDAR` and `STLR`?

ARM64 load-acquire register and store-release register instructions. They carry one-sided ordering: `LDAR` provides acquire semantics, `STLR` provides release. Pairing them gives release/acquire ordering without an explicit `DMB`.

### Q14. What are `lwsync` and `sync` on POWER?

`lwsync` is the lightweight sync — orders load-load, load-store, store-store but not store-load. Sufficient for release/acquire. `sync` is the heavyweight sync, ordering all of those. POWER is one of the weakest commercial memory models, so these instructions appear frequently.

### Q15. Why does x86 need any fence at all if its model is so strong?

Because of the store buffer: a store may sit in the buffer while a subsequent load to a different address completes. To prevent this single allowed reorder, `MFENCE` or a `LOCK`-prefixed instruction drains the store buffer.

### Q16. What is the store buffer?

A small per-core FIFO queue that holds stores waiting to drain to cache. Stores enter the buffer immediately on issue; they leave when the CPU can claim cache ownership. The buffer is the architectural feature responsible for TSO's allowed reorder.

### Q17. Cite a reference for the x86 memory model formalisation.

Sewell, Sarkar, Owens, Zappa Nardelli, Myreen (2010), "x86-TSO: A Rigorous and Usable Programmer's Model for x86 Multiprocessors." Published in *Communications of the ACM*, July 2010.

---

## Go-Specific Questions

### Q18. Does Go expose explicit fences?

No. `sync/atomic` provides no `Fence()` function. Every atomic operation already emits the right fence, and Go's design philosophy is to keep the API minimal.

### Q19. What ordering do Go atomics guarantee?

Sequential consistency. The Go memory model states: "All the atomic operations executed in a program behave as though executed in some sequentially consistent order."

### Q20. Why did Go choose sequential consistency instead of exposing all four orderings?

The Go team's reasoning: (1) every atomic must emit a fence anyway, so the per-op cost is small; (2) seq_cst is the easiest model to reason about; (3) other languages' weaker orderings are a source of subtle bugs in the wild. The cost is borne by weak hardware like ARM and POWER, where seq_cst is more expensive than relaxed or acquire/release.

### Q21. Does a `sync.Mutex` use fences?

Yes. `Lock` performs an atomic CAS (acquire fence). `Unlock` performs an atomic store (release fence). Together they sandwich the critical section.

### Q22. Does a channel operation involve a fence?

Yes. Channel sends and receives are implemented with atomics and a mutex; the memory model promises a happens-before edge from the send to the corresponding receive. Underneath, the fences live in the channel runtime's atomic operations.

### Q23. Is `runtime.Gosched()` a fence?

No. It is a scheduling hint. It yields the goroutine but does not establish any memory ordering. Do not use it to "ensure visibility."

### Q24. Is a failed `CompareAndSwap` a fence?

Yes. The Compare-and-Swap instruction is atomic and fenced regardless of whether the comparison succeeded. The fence cost is paid either way. On x86 a failed CMPXCHG still grabs the cache line; on ARM the LL/SC pair still emits its barriers.

### Q25. What is the most common atomic-related bug in Go?

Mixing atomic and non-atomic access to the same variable. The race detector catches it; the compiler does not.

### Q26. How do you find the fence instructions emitted by Go's compiler?

Use `go tool compile -S file.go` to see Go assembly, or `go tool objdump -s 'main\.f' binary` to disassemble a built binary. Look for `LOCK`, `XCHG`, `MFENCE` on x86; `LDAR`, `STLR`, `LDAXR`, `STLXR`, `DMB` on ARM.

### Q27. What atomic instruction does `atomic.Int64.Store` compile to on x86?

`XCHGQ`. The `XCHG` instruction is implicitly LOCK-prefixed and thus acts as a full fence and as a store in one instruction. An alternative would be `MOV` followed by `MFENCE`; Go chooses `XCHG` because it is shorter.

### Q28. What atomic instructions does `atomic.Int64.Add` compile to on ARM64?

On older cores, an LL/SC loop: `LDAXR`, arithmetic, `STLXR`, `CBNZ` retry. On ARMv8.1+ cores with the LSE extension, a single `LDADDAL` instruction does the same job.

---

## Cross-Language Questions

### Q29. What is C++'s `std::memory_order_acquire` equivalent in Go?

There is no direct equivalent. Every Go atomic load is at least acquire — actually seq_cst, which is stronger. When porting C++ code, replace `memory_order_acquire` with the matching Go atomic load and accept the stronger ordering.

### Q30. What does Java's `volatile` keyword guarantee, post-JSR-133?

Reads of a volatile field act as acquire loads; writes act as release stores. Roughly equivalent to release/acquire in C++. Maps cleanly to Go's `sync/atomic` (which is even stronger, at seq_cst).

### Q31. How does Java's `VarHandle` compare to Go atomics?

`VarHandle` exposes four orderings (`getPlain`, `getOpaque`, `getAcquire`, `getVolatile`) and matching setters. `getVolatile` corresponds to seq_cst — exactly what Go atomics provide. Go atomics are equivalent to `getVolatile` / `setVolatile`.

### Q32. C's `volatile` keyword — is it the same as Go's atomic?

No. C's `volatile` only prevents the compiler from caching the value in a register; it provides no ordering or atomicity guarantees against other threads. Go's `sync/atomic` is a real synchronisation primitive. Confusing them is a classic beginner mistake.

### Q33. When porting C code with `__atomic_*` builtins to Go, what do you need to consider?

If the C uses `__ATOMIC_RELAXED`, the Go version using `sync/atomic` will be strictly stronger (seq_cst), preserving correctness but possibly costing performance on weak hardware. If the C uses `__ATOMIC_SEQ_CST`, behaviour matches Go directly. If the C uses release/acquire, Go upgrades to seq_cst — also strictly safe.

---

## Code Reading and Debugging

### Q34. What is wrong with this code?

```go
var ready bool
var data int

go func() {
    data = 42
    ready = true
}()

for !ready {}
fmt.Println(data)
```

Two data races. `ready` is read and written without any synchronisation, and `data` is also read and written without synchronisation. The compiler may hoist `ready` into a register inside the loop, making it infinite. Even if it does not, on ARM the read of `data` may return 0. Fix: use `atomic.Bool` for `ready` and rely on its fence to publish `data`.

### Q35. What does this code guarantee on x86 versus ARM?

```go
var x, y atomic.Int64

go func() {
    x.Store(1)
    fmt.Println(y.Load())
}()

go func() {
    y.Store(1)
    fmt.Println(x.Load())
}()
```

On both architectures, Go's atomics guarantee seq_cst, so at least one of the printed values must be 1. If you wrote the same code with non-atomic `x` and `y` (or with `memory_order_relaxed` in C++), TSO on x86 could allow both to print 0, and ARM certainly would.

### Q36. Reading this assembly snippet, what does it do?

```
LOCK CMPXCHGQ CX, 0(BX)
```

A locked compare-and-exchange of 64-bit values on x86. Compares the value at memory address `BX` with `AX` (implicit); if equal, stores `CX` to `BX`. The `LOCK` prefix makes it atomic across all CPUs and acts as a full fence. This is the fundamental CAS instruction Go's `atomic.CompareAndSwap` compiles to on x86.

### Q37. Reading this ARM assembly, what does it do?

```
LDAXR X3, (X0)
CMP   X3, X1
BNE   fail
STLXR W4, X2, (X0)
CBNZ  W4, retry
```

A CAS implemented as load-linked / store-conditional. `LDAXR` does a load-acquire exclusive: reads `*X0` into `X3` and arms the exclusive monitor. Compare with the expected value in `X1`; if different, branch to `fail`. Otherwise `STLXR` attempts a store-release exclusive: writes `X2` to `*X0` only if the monitor is still armed; result (0 = success, 1 = failure) goes to `W4`. Retry if the store failed.

### Q38. The race detector reports a race on a field that is read with `atomic.Int64.Load`. What is the likely cause?

The field is being written somewhere without `atomic.Int64.Store` — a plain assignment. Mixed access is the most common pattern. Search the codebase for direct assignments to that field and replace them with atomic stores.

---

## Algorithm Design

### Q39. Walk through publishing a `*Config` safely with an atomic pointer.

```go
var cfg atomic.Pointer[Config]

func reload(c *Config) {
    cfg.Store(c) // release fence — publishes all writes to *c
}

func read() *Config {
    return cfg.Load() // acquire fence — sees all writes that happened before the matching store
}
```

The release fence on `Store` and the acquire fence on `Load` together create a happens-before edge from the producer to every consumer that successfully loads. All fields of the published `Config` are visible to consumers.

### Q40. Design a lock-free stop signal for a worker goroutine.

```go
var stop atomic.Bool

go func() {
    for !stop.Load() {
        work()
    }
}()

// elsewhere
stop.Store(true)
```

The atomic store publishes the new value; the atomic load reads it on each iteration. The fence guarantees the new value reaches the worker within a cache-coherence round trip — typically tens of nanoseconds.

### Q41. Why does Dekker's algorithm require a fence even though it uses only loads and stores?

Dekker's algorithm has the pattern: thread `i` writes its own `flag[i] = true`, then reads the other thread's `flag[j]`. On TSO, the store can be buffered and the load can return the stale value. Both threads then enter the critical section. The fence (a full memory barrier between the store and the load) drains the store buffer and prevents the reorder. Without it, mutual exclusion is broken.

### Q42. In Michael & Scott's lock-free queue, why is the CAS on `tail.next` a fence?

The CAS is the publication point of the new node. The producer writes `n.value` and `n.next = nil` before the CAS; the CAS atomically links the node into the list. Consumers reading the new node through a subsequent `tail.next` load (an acquire fence) are guaranteed to see the producer's writes to `n.value` because of the release semantics of the CAS. Without the fence, a consumer could observe the pointer but not the data.

---

## Performance Questions

### Q43. How expensive is an uncontended atomic increment on x86?

Approximately 10–20 CPU cycles, or 3–5 nanoseconds at 4 GHz. The cost is the `LOCK` prefix's serialisation of the store buffer and the cache line transition to Modified.

### Q44. How does atomic increment cost compare on x86 versus ARM64?

Uncontended, they are comparable — 3–5 ns on x86 and 3–6 ns on modern ARM64 (with LSE atomics). Under contention, both scale poorly due to cache-line bouncing, with ARM sometimes slightly faster due to weaker coherence requirements, sometimes slower depending on the chip.

### Q45. What dominates the cost of an atomic operation under contention?

Cache-line bouncing. When multiple cores compete for the same cache line, the line ping-pongs between caches; each transition is 30–100 cycles. Under heavy contention, this is 10–100x the cost of the uncontended atomic.

### Q46. How do you reduce fence cost without giving up correctness?

Several techniques: (a) shard the counter or data structure so each core operates on its own cache line; (b) pad atomic fields to 64 bytes to avoid false sharing; (c) batch updates so each atomic operation amortises multiple logical changes; (d) prefer single-writer designs where readers do not need to coordinate.

### Q47. Why does an atomic load cost almost nothing on x86 but more on ARM?

On x86 TSO, every load is already ordered against earlier loads and stores; a plain `MOV` is sufficient for an acquire load. Sequential consistency on the load side is free. On ARM the load must use `LDAR`, which carries an acquire fence — a few extra cycles relative to a plain `LDR`.

---

## Senior / Architecture Questions

### Q48. Your Go service was running fine on x86 EC2 and now crashes on Graviton. What is the likely cause?

Almost certainly a missing atomic somewhere. x86 TSO masks many reordering bugs that ARM's weak model exposes. Run the tests with `-race` on an ARM machine; the race detector will identify the location. Common patterns: a struct field updated by one goroutine and read by another with plain field access, or a flag checked in a busy loop without an atomic.

### Q49. You profile a hot path on ARM and see significant time in `LDAR`/`STLR`. What is your move?

First confirm the fence is actually the cost — under contention the cache-line bouncing usually dominates. If the atomic itself is the bottleneck, the standard moves are: shard the data structure, switch to read-mostly access patterns, batch writes, or accept the cost as the price of correctness. Going to weaker orderings is not an option in Go without falling out to assembly.

### Q50. A Java team is porting their lock-free queue to Go. What advice do you give them?

(1) Replace every `volatile` field with an `atomic.*` typed value. (2) Run `-race` constantly during the port. (3) Expect a slight performance loss on ARM because Go's seq_cst is stronger than Java's `volatile` and there is no `Opaque` equivalent. (4) Keep the algorithm structure unchanged — Go's stronger ordering preserves correctness. (5) Benchmark on both x86 and ARM before declaring the port complete.

### Q51. When would you not use Go's `sync/atomic`?

When a higher-level primitive is enough. For protecting compound state, a `sync.Mutex` is simpler, more debuggable, and similar in cost under low contention. For producer-consumer patterns, a channel is more idiomatic. Reach for `sync/atomic` only when the design genuinely needs lock-free behaviour: a single shared counter, a sentinel flag, a configuration pointer.

### Q52. Defend Go's choice not to expose `atomic.Fence()`.

Three arguments. First, every atomic operation already emits a fence — adding a fence without a payload offers no new capability. Second, hand-coded fence patterns are notoriously buggy across language history; the fewer ways to misuse the API, the better. Third, the Go memory model is intentionally minimal and orthogonal; adding a fence primitive would invite asking "what about relaxed atomics?" and the chain ends in C++-style complexity. The escape hatch — for the rare case it is needed — is to perform an unrelated atomic operation, which doubles as a fence.

### Q53. Cite three references that would help an engineer learn the formal background.

Sewell et al. (2010) on x86 TSO; Adve and Boehm (2010) on the case for language memory models; Sorin, Hill, Wood — *A Primer on Memory Consistency and Cache Coherence* — for the full textbook treatment. Russ Cox's research.swtch.com series is the best plain-language alternative.

### Q54. What is the IRIW litmus test and what does it tell you?

IRIW = Independent Reads of Independent Writes. Two writers write to two different variables; two readers each load both variables. The question is whether the two readers can disagree about the order of the writes. Under seq_cst, no. Under release/acquire only, yes — two observers can construct mutually inconsistent orderings. Go's seq_cst forbids IRIW, which is one of the main reasons it is harder to write certain optimisations: every Go atomic must participate in a single global order.

---

## Summary

Memory fences in Go are mostly invisible — and that is the point. You can answer most interview questions with three rules: every `sync/atomic` operation is a fence; every fence is sequentially consistent; mixing atomic and non-atomic access to one variable is always a bug. From those, you can reconstruct the rest: why x86 needs `MFENCE`, why ARM needs `DMB` or `LDAR`/`STLR`, why C++ exposes four orderings and Go exposes only one, and why a Go program correct on x86 may still fail on ARM if it cuts corners. The senior questions add hardware specifics — Sewell's TSO model, ARM weak ordering, POWER's `lwsync` — and porting stories that turn theory into something you can recognise in a stack trace.
